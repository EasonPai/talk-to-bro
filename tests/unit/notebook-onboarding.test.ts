// tests/unit/notebook-onboarding.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTEBOOK_URL,
  provisionNotebookChat
} from '../../src/sw/notebook-onboarding.ts';
import { getSettingsStorage, getSessionStorage } from '../../src/shared/storage.ts';
import { TalkRunner } from '../../src/sw/runner.ts';
import type { BroAdapter } from '../../src/shared/types.ts';
import type { StorageAreaLike } from '../../src/shared/storage.ts';

function createMemoryStorage(): StorageAreaLike {
  const data: Record<string, unknown> = {};
  return {
    async get(keys) {
      if (!keys) return { ...data };
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in data) out[k] = data[k];
      }
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    }
  };
}

test('provisionNotebookChat - opens notebook, sends seed word, and saves new broChatUrl', async () => {
  const storageLocal = createMemoryStorage();
  const storageSession = createMemoryStorage();

  let createdUrl = '';
  let sentPayload: any = null;
  let getCount = 0;

  const tabsApi: any = {
    async create(props: any) {
      createdUrl = props.url;
      assert.equal(props.active, false);
      assert.equal(props.pinned, true);
      return { id: 77, windowId: 10, url: props.url, status: 'loading' };
    },
    async get(tabId: number) {
      assert.equal(tabId, 77);
      getCount += 1;
      if (getCount === 1) {
        return { id: 77, windowId: 10, url: DEFAULT_NOTEBOOK_URL, status: 'complete' };
      }
      return {
        id: 77,
        windowId: 10,
        url: 'https://gemini.google.com/app/newchat12345678',
        status: 'complete'
      };
    }
  };

  const scriptingApi: any = {
    async executeScript() {
      return [];
    }
  };

  const sendMessage = async (_tabId: number, msg: any) => {
    if (msg.action === 'TTB_PING') return { ok: true };
    if (msg.action === 'TTB_CHECK_READY') return { ok: true };
    if (msg.action === 'TTB_INSERT_AND_SEND') {
      sentPayload = msg;
      return { ok: true };
    }
    return { ok: false };
  };

  const res = await provisionNotebookChat(
    {
      storageLocal,
      storageSession,
      tabsApi,
      scriptingApi,
      sendMessage,
      now: () => 5000,
      pollIntervalMs: 1
    },
    'ephemeral'
  );

  assert.equal(res.ok, true);
  assert.equal(createdUrl, DEFAULT_NOTEBOOK_URL);
  assert.equal(sentPayload?.text, 'ephemeral');
  assert.equal(res.broChatUrl, 'https://gemini.google.com/app/newchat12345678');

  const settings = await getSettingsStorage(storageLocal);
  assert.equal(settings?.broChatUrl, 'https://gemini.google.com/app/newchat12345678');
  assert.equal(settings?.updatedAt, 5000);

  const session = await getSessionStorage(storageSession);
  assert.deepEqual(session?.broTab, { tabId: 77, windowId: 10 });
});

test('provisionNotebookChat - returns failure when redirect to new chat times out', async () => {
  const storageLocal = createMemoryStorage();
  const tabsApi: any = {
    async create(props: any) {
      return { id: 88, windowId: 10, url: props.url, status: 'complete' };
    },
    async get() {
      return { id: 88, windowId: 10, url: DEFAULT_NOTEBOOK_URL, status: 'complete' };
    }
  };

  const res = await provisionNotebookChat(
    {
      storageLocal,
      tabsApi,
      scriptingApi: { async executeScript() { return []; } },
      sendMessage: async (_tabId, msg) => {
        if (msg.action === 'TTB_PING' || msg.action === 'TTB_CHECK_READY' || msg.action === 'TTB_INSERT_AND_SEND') {
          return { ok: true };
        }
        return { ok: false };
      },
      pollIntervalMs: 1,
      redirectTimeoutMs: 10
    },
    'serendipity'
  );

  assert.equal(res.ok, false);
  const settings = await getSettingsStorage(storageLocal);
  assert.equal(settings, null);
});

test('TalkRunner - Case A: auto-provisions when broChatUrl is missing', async () => {
  const storageLocal = createMemoryStorage();
  const storageSession = createMemoryStorage();
  const adapter: BroAdapter = {
    async checkReady() { return { ok: true, editorHasOwnText: false }; },
    async send() { return { ok: true, sentAt: 1 }; },
    async probe() { return { state: 'streaming' }; },
    async extract() { return { ok: true, markdown: 'ok' }; }
  };
  let provisionedSeed = '';

  const runner = new TalkRunner({
    storageLocal,
    storageSession,
    adapter,
    onAutoProvision: async (seedText) => {
      provisionedSeed = seedText;
      await storageLocal.set({
        'settings:v1': { broChatUrl: 'https://gemini.google.com/app/auto123', updatedAt: 1 }
      });
      return { ok: true, broChatUrl: 'https://gemini.google.com/app/auto123' };
    }
  });

  const res = await runner.submit('ubiquitous');
  assert.equal(res.accepted, true);
  assert.equal(provisionedSeed, 'ubiquitous');
  assert.notEqual(res.talk?.phase, 'failed');
});

test('TalkRunner - Case B: auto-provisions after 3 consecutive Talk failures', async () => {
  const storageLocal = createMemoryStorage();
  const storageSession = createMemoryStorage();
  await storageLocal.set({
    'settings:v1': { broChatUrl: 'https://gemini.google.com/app/existing', updatedAt: 1 }
  });

  const adapter: BroAdapter = {
    async checkReady() { return { ok: false, code: 'TAB_UNRESPONSIVE' }; },
    async send() { return { ok: false, code: 'TAB_UNRESPONSIVE' }; },
    async probe() { return { state: 'not_found' }; },
    async extract() { return { ok: false, code: 'EXTRACT_FAILED' }; }
  };
  let provisionCalls = 0;
  let lastSeed = '';

  const runner = new TalkRunner({
    storageLocal,
    storageSession,
    adapter,
    onAutoProvision: async (seedText) => {
      provisionCalls += 1;
      lastSeed = seedText;
      return { ok: true, broChatUrl: 'https://gemini.google.com/app/recovered' };
    }
  });

  await runner.submit('word1');
  assert.equal(provisionCalls, 0);
  await runner.submit('word2');
  assert.equal(provisionCalls, 0);
  await runner.submit('word3');
  assert.equal(provisionCalls, 1);
  assert.equal(lastSeed, 'word3');
});
