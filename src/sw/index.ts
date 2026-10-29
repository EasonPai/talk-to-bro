// src/sw/index.ts
// Background Service Worker for Talk To Bro Personally (MV3)
import { getBootReadyPromise } from './boot.ts';
import { TalkRunner } from './runner.ts';
import { getRuntimeStorage, getSettingsStorage } from '../shared/storage.ts';
import { computeStats } from '../shared/stats.ts';
import { RealBroAdapter } from './adapter-real.ts';

const ALARM_NAME = 'ttb-watchdog';

// Real Bro Adapter connected to background Gemini tab and on-demand injected content script
const realAdapter = new RealBroAdapter({
  getTargetUrl: async () => {
    try {
      const settings = await getSettingsStorage(chrome.storage?.local);
      return settings.broChatUrl;
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
  alarms: chrome.alarms
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

  return false;
});

// Top-level startup invocation
(async () => {
  await readyPromise;
  await runner.boot();
  console.log('[SW] Talk To Bro Personally Service Worker initialized and reconciled.');
})();
