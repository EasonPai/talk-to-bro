// src/sw/index.ts
// Background Service Worker for Talk To Bro Personally (MV3)
import { getBootReadyPromise } from './boot.ts';
import { TalkRunner } from './runner.ts';
import { getRuntimeStorage } from '../shared/storage.ts';
import { computeStats } from '../shared/stats.ts';
import type { BroAdapter, ReadyResult, SendResult, ProbeResult, ExtractResult } from '../shared/types.ts';

const ALARM_NAME = 'ttb-watchdog';

// Minimal placeholder adapter for SW runtime until M3 brings real DOM adapter
const defaultAdapter: BroAdapter = {
  async checkReady() {
    return { ok: true, editorHasOwnText: false };
  },
  async send() {
    return { ok: true };
  },
  async probe() {
    return {
      page: 'ready',
      turn: 'complete',
      generating: false,
      textLength: 0,
      textSig: '0:00000000',
      quota: false
    };
  },
  async extract() {
    return { markdown: '' };
  },
  async selfCheck() {
    return {};
  },
  async showHandoffNotice() {}
};

// Singleton runner instance in SW
const runner = new TalkRunner({
  storageLocal: chrome.storage?.local,
  storageSession: chrome.storage?.session,
  adapter: defaultAdapter,
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
