// tests/unit/adapter-real.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { RealBroAdapter, type ScriptingApiLike } from '../../src/sw/adapter-real.ts';
import { MemoryStorage } from '../helpers/fake-adapter.ts';
import type { TabsApiLike } from '../../src/sw/tab.ts';

class MockTabsApi implements TabsApiLike {
  public tabs: Map<number, chrome.tabs.Tab> = new Map();

  async get(tabId: number): Promise<chrome.tabs.Tab> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('Not found');
    return tab;
  }

  async query(): Promise<chrome.tabs.Tab[]> {
    return Array.from(this.tabs.values());
  }

  async create(props: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    const tab: chrome.tabs.Tab = {
      id: 999,
      index: 0,
      pinned: true,
      highlighted: false,
      windowId: 1,
      active: false,
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: 'complete',
      url: props.url
    };
    this.tabs.set(999, tab);
    return tab;
  }

  async update(tabId: number, props: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
    const tab = this.tabs.get(tabId);
    if (tab) Object.assign(tab, props);
    return tab!;
  }
}

class MockScriptingApi implements ScriptingApiLike {
  public injections: any[] = [];

  async executeScript(injection: chrome.scripting.ScriptInjection<any, any>): Promise<any[]> {
    this.injections.push(injection);
    return [{ result: true }];
  }
}

test('RealBroAdapter - checkReady checks settings, ensures tab, pings/injects and queries content', async () => {
  const tabsApi = new MockTabsApi();
  const scriptingApi = new MockScriptingApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  // Seed open tab
  tabsApi.tabs.set(1001, {
    id: 1001,
    index: 0,
    pinned: true,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: targetUrl
  });

  const sentMessages: any[] = [];
  let pingCount = 0;

  const adapter = new RealBroAdapter({
    getTargetUrl: () => targetUrl,
    storageSession: session,
    tabsApi,
    scriptingApi,
    sendMessage: async (tabId, msg) => {
      sentMessages.push({ tabId, msg });
      if (msg.action === 'TTB_PING') {
        pingCount++;
        // First ping throws to verify on-demand scripting.executeScript injection
        if (pingCount === 1) throw new Error('Not loaded yet');
        return { ok: true, buildId: 'ttb-build-0.1.0' };
      }
      if (msg.action === 'TTB_CHECK_READY') {
        return { ok: true };
      }
      return null;
    }
  });

  const ready = await adapter.checkReady({ chatId: '4d870f290f0c5975', text: 'Hello' });
  assert.equal(ready.ok, true);
  assert.equal(adapter.getActiveTabId(), 1001);

  // Verified on-demand injection into ISOLATED world was triggered when ping failed
  assert.equal(scriptingApi.injections.length, 1);
  assert.equal(scriptingApi.injections[0].target.tabId, 1001);
  assert.deepEqual(scriptingApi.injections[0].files, ['adapter.js']);
  assert.equal(scriptingApi.injections[0].world, 'ISOLATED');

  // Verified TTB_CHECK_READY message sent with targetUrl
  const checkReadyMsg = sentMessages.find(m => m.msg.action === 'TTB_CHECK_READY');
  assert.ok(checkReadyMsg);
  assert.equal(checkReadyMsg.msg.targetUrl, targetUrl);
});

test('RealBroAdapter - send dispatches TTB_INSERT_AND_SEND and handles submission verification', async () => {
  const tabsApi = new MockTabsApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  tabsApi.tabs.set(1001, {
    id: 1001,
    index: 0,
    pinned: true,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: targetUrl
  });

  const adapter = new RealBroAdapter({
    getTargetUrl: () => targetUrl,
    storageSession: session,
    tabsApi,
    sendMessage: async (_tabId, msg) => {
      if (msg.action === 'TTB_PING') return { ok: true };
      if (msg.action === 'TTB_INSERT_AND_SEND') {
        return { ok: true, userTurnVerified: true, sentAt: 1700000005000 };
      }
      return null;
    }
  });

  const sendRes = await adapter.send({ talkId: 't1', text: 'Prompt text' });
  assert.equal(sendRes.ok, true);
  if (sendRes.ok) {
    assert.equal(sendRes.sentAt, 1700000005000);
  }
});

test('RealBroAdapter - Error handling when no broChatUrl is configured', async () => {
  const adapter = new RealBroAdapter({
    getTargetUrl: () => null
  });

  const ready = await adapter.checkReady({ chatId: 'chat-1', text: 'Hello' });
  assert.equal(ready.ok, false);
  assert.equal(ready.code, 'NO_BRO_CHAT');

  const send = await adapter.send({ talkId: 't1', text: 'Hello' });
  assert.equal(send.ok, false);
  assert.equal(send.code, 'NO_BRO_CHAT');

  const probeRes = await adapter.probe({ talkId: 't1', text: 'Hello' });
  assert.equal(probeRes.page, 'wrong_chat');

  const extractRes = await adapter.extract({ talkId: 't1', text: 'Hello' });
  assert.ok('error' in extractRes);
  assert.equal(extractRes.error, 'EXTRACT_FAILED');
});

test('RealBroAdapter - probe and extract forwarding and response handling', async () => {
  const tabsApi = new MockTabsApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  tabsApi.tabs.set(1001, {
    id: 1001,
    index: 0,
    pinned: true,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: targetUrl
  });

  const adapter = new RealBroAdapter({
    getTargetUrl: () => targetUrl,
    storageSession: session,
    tabsApi,
    sendMessage: async (_tabId, msg) => {
      if (msg.action === 'TTB_PING') return { ok: true };
      if (msg.action === 'TTB_PROBE') {
        return {
          page: 'ready',
          turn: 'streaming',
          generating: true,
          textLength: 120,
          textSig: '120:abcdef',
          quota: false
        };
      }
      if (msg.action === 'TTB_EXTRACT') {
        return {
          markdown: '# Model Answer\n\nContent here',
          html: '<h1>Model Answer</h1><p>Content here</p>'
        };
      }
      return null;
    }
  });

  const probe = await adapter.probe({ talkId: 't1', text: 'hello' });
  assert.equal(probe.page, 'ready');
  assert.equal(probe.turn, 'streaming');
  assert.equal(probe.generating, true);
  assert.equal(probe.textLength, 120);

  const ext = await adapter.extract({ talkId: 't1', text: 'hello' });
  assert.ok('markdown' in ext);
  assert.equal(ext.markdown, '# Model Answer\n\nContent here');
});

test('RealBroAdapter - Message failure fallback handling for probe and extract', async () => {
  const tabsApi = new MockTabsApi();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  tabsApi.tabs.set(1001, {
    id: 1001,
    index: 0,
    pinned: true,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: targetUrl
  });

  const adapter = new RealBroAdapter({
    getTargetUrl: () => targetUrl,
    tabsApi,
    sendMessage: async () => {
      throw new Error('Tab closed');
    }
  });

  const probe = await adapter.probe({ talkId: 't1', text: 'hello' });
  assert.equal(probe.page, 'wrong_chat');

  const ext = await adapter.extract({ talkId: 't1', text: 'hello' });
  assert.ok('error' in ext);
  assert.equal(ext.error, 'EXTRACT_FAILED');
});
