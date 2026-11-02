// src/sw/index.ts
// Background Service Worker for Talk To Bro Personally (MV3)
import { getBootReadyPromise } from './boot.ts';
import { TalkRunner } from './runner.ts';
import { getRuntimeStorage, saveRuntimeStorage, getSettingsStorage } from '../shared/storage.ts';
import { computeStats } from '../shared/stats.ts';
import { RealBroAdapter } from './adapter-real.ts';
import { performHandoff } from './handoff.ts';
import type { Talk } from '../shared/types.ts';

const ALARM_NAME = 'ttb-watchdog';

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

  if (msg.action === 'talk/submit') {
    (async () => {
      await readyPromise;
      const result = await runner.submit(msg.text);
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
  await runner.boot();
  console.log('[SW] Talk To Bro Personally Service Worker initialized and reconciled.');
})();
