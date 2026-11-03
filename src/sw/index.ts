// src/sw/index.ts
// Background Service Worker for Talk To Bro Personally (MV3)
import { getBootReadyPromise } from './boot.ts';
import { TalkRunner } from './runner.ts';
import { getRuntimeStorage, saveRuntimeStorage, getSettingsStorage, getUiStorage, saveUiStorage } from '../shared/storage.ts';
import { computeStats } from '../shared/stats.ts';
import { RealBroAdapter } from './adapter-real.ts';
import { performHandoff } from './handoff.ts';
import type { Talk, UiState } from '../shared/types.ts';

const ALARM_NAME = 'ttb-watchdog';

// Serialized UI queue for state mutations
class UiQueue {
  private queue = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const res = this.queue.then(fn, fn);
    this.queue = res.then(() => {}, () => {});
    return res;
  }
}
const uiQueue = new UiQueue();

// Action routing sync function
export async function syncActionRouting(): Promise<void> {
  try {
    const ui = await getUiStorage(chrome.storage?.local);
    if (ui.mode === 'sidepanel') {
      await chrome.action?.setPopup({ popup: '' });
    } else {
      await chrome.action?.setPopup({ popup: 'popup.html' });
    }
  } catch (err) {
    console.error('[SW] Failed to sync action routing:', err);
  }
}

// Action click listener when in sidepanel mode
chrome.action?.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    try {
      await (chrome as any).sidePanel?.open({ windowId: tab.windowId });
    } catch (err) {
      console.error('[SW] Failed to open side panel on action click:', err);
    }
  }
});

// Real Bro Adapter connected to background Gemini tab and on-demand injected content script
const realAdapter = new RealBroAdapter({
  getTargetUrl: async () => {
    try {
      const settings = await getSettingsStorage(chrome.storage?.local);
      return settings?.broChatUrl || null;
    } catch {
      return null;
    }
  },
  storageSession: chrome.storage?.session
});

// Singleton runner instance in SW
const runner = new TalkRunner({
  storageLocal: chrome.storage?.local,
  storageSession: chrome.storage?.session,
  adapter: realAdapter,
  alarms: chrome.alarms,
  fastTimers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as any) }
});

// Single entry boot
const readyPromise = getBootReadyPromise(chrome.storage?.session);

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  await readyPromise;
  if (alarm.name === ALARM_NAME) {
    await runner.tick();
  }
});

// Message hub
chrome.runtime?.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'PING') {
    sendResponse({ ok: true, version: '0.1.0' });
    return true;
  }

  if (msg.action === 'GET_SETTINGS') {
    chrome.storage.local.get('settings:v1').then((res) => {
      sendResponse({ ok: true, settings: res['settings:v1'] || null });
    });
    return true;
  }

  if (msg.action === 'SET_SETTINGS') {
    chrome.storage.local.set({ 'settings:v1': msg.settings }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'ui/getState') {
    (async () => {
      const state = await getUiStorage(chrome.storage?.local);
      sendResponse({ ok: true, state });
    })();
    return true;
  }

  if (msg.action === 'ui/saveDraft') {
    uiQueue.run(async () => {
      if (typeof msg.text !== 'string') {
        sendResponse({ ok: false, error: 'INVALID_DRAFT_PAYLOAD' });
        return;
      }
      const current = await getUiStorage(chrome.storage?.local);
      const next: UiState = {
        ...current,
        draft: msg.text,
        revision: current.revision + 1
      };
      await saveUiStorage(chrome.storage?.local, next);
      sendResponse({ ok: true, revision: next.revision });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  if (msg.action === 'ui/setMode') {
    uiQueue.run(async () => {
      const mode = msg.mode === 'sidepanel' ? 'sidepanel' : 'popup';
      const current = await getUiStorage(chrome.storage?.local);
      const next: UiState = {
        ...current,
        mode,
        draft: typeof msg.draft === 'string' ? msg.draft : current.draft,
        revision: current.revision + 1
      };
      await saveUiStorage(chrome.storage?.local, next);
      if (mode === 'sidepanel') {
        await chrome.action?.setPopup({ popup: '' });
      } else {
        await chrome.action?.setPopup({ popup: 'popup.html' });
      }
      sendResponse({ ok: true, state: next });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  if (msg.action === 'talk/submit') {
    (async () => {
      await readyPromise;
      const result = await runner.submit(msg.text);
      if (result.accepted && result.talk) {
        const acceptedTalk = result.talk;
        // M6: Conditionally clear draft only if it matches submitted text
        await uiQueue.run(async () => {
          const currentUi = await getUiStorage(chrome.storage?.local);
          if (currentUi.draft.trim() === msg.text.trim()) {
            await saveUiStorage(chrome.storage?.local, {
              ...currentUi,
              draft: '',
              revision: currentUi.revision + 1,
              acceptedTalkId: acceptedTalk.id
            });
          }
        });
      }
      sendResponse(result);
    })();
    return true;
  }

  if (msg.action === 'talk/reconcile') {
    (async () => {
      await readyPromise;
      const decision = await runner.reconcile();
      sendResponse({ ok: true, decision });
    })();
    return true;
  }

  if (msg.action === 'talk/getState') {
    (async () => {
      await readyPromise;
      const runtime = await getRuntimeStorage(chrome.storage.local);
      sendResponse({ ok: true, talk: runtime.lastTalk });
    })();
    return true;
  }

  if (msg.action === 'talk/getStats') {
    (async () => {
      await readyPromise;
      const runtime = await getRuntimeStorage(chrome.storage.local);
      const stats = computeStats(runtime.logByTalkId);
      sendResponse({ ok: true, stats });
    })();
    return true;
  }

  if (msg.action === 'handoff/switch_tab') {
    (async () => {
      await readyPromise;
      const runtime = await getRuntimeStorage(chrome.storage.local);
      if (runtime.lastTalk && runtime.lastTalk.id === msg.talkId) {
        const handoff = await performHandoff(
          {
            storageLocal: chrome.storage.local,
            storageSession: chrome.storage.session,
            adapter: realAdapter
          },
          runtime.lastTalk,
          {
            forceClosed: true,
            alreadyCopied: !!msg.alreadyCopied,
            authorizeDeferred: !!msg.authorizeDeferred || !!msg.explicitUserAction
          }
        );
        sendResponse({ ok: true, handoff });
      } else {
        sendResponse({ ok: false, error: 'TALK_NOT_FOUND' });
      }
    })();
    return true;
  }

  if (msg.action === 'handoff/cancel') {
    (async () => {
      await readyPromise;
      const runtime = await getRuntimeStorage(chrome.storage.local);
      if (runtime.lastTalk && runtime.lastTalk.id === msg.talkId) {
        const updatedTalk: Talk = {
          ...runtime.lastTalk,
          handoff: {
            status: 'cancelled',
            copied: false,
            focused: false
          }
        };
        await saveRuntimeStorage(chrome.storage.local, {
          ...runtime,
          lastTalk: updatedTalk
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'TALK_NOT_FOUND' });
      }
    })();
    return true;
  }

  return false;
});

// Top-level startup invocation
(async () => {
  await readyPromise;
  await syncActionRouting();
  await runner.boot();
  console.log('[SW] Talk To Bro Personally Service Worker initialized and reconciled.');
})();
