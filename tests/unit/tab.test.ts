// tests/unit/tab.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBroTab, isSameGeminiChat, type TabsApiLike } from '../../src/sw/tab.ts';
import { MemoryStorage } from '../helpers/fake-adapter.ts';

class FakeTabsApi implements TabsApiLike {
  public tabs: Map<number, chrome.tabs.Tab> = new Map();
  public nextId = 100;
  public updateCalls: Array<{ tabId: number; update: chrome.tabs.UpdateProperties }> = [];
  public createCalls: Array<chrome.tabs.CreateProperties> = [];

  async get(tabId: number): Promise<chrome.tabs.Tab> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    return tab;
  }

  async query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    return Array.from(this.tabs.values());
  }

  async create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    this.createCalls.push(createProperties);
    const id = ++this.nextId;
    const tab: chrome.tabs.Tab = {
      id,
      index: this.tabs.size,
      pinned: Boolean(createProperties.pinned),
      highlighted: false,
      windowId: 1,
      active: Boolean(createProperties.active),
      incognito: false,
      selected: false,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      groupId: -1,
      status: 'complete',
      url: createProperties.url
    };
    this.tabs.set(id, tab);
    return tab;
  }

  async update(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
    this.updateCalls.push({ tabId, update: updateProperties });
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    Object.assign(tab, updateProperties);
    return tab;
  }
}

test('Tab Lifecycle - isSameGeminiChat matches exact chats and multi-account prefixes', () => {
  // Same app chat
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/app/4d870f290f0c5975?hl=en',
      'https://gemini.google.com/app/4d870f290f0c5975'
    ),
    true
  );

  // Same gem chat
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/gem/gem-writer/4d870f290f0c5975',
      'https://gemini.google.com/gem/gem-writer/4d870f290f0c5975#hash'
    ),
    true
  );

  // Same account index /u/1
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/u/1/app/4d870f290f0c5975',
      'https://gemini.google.com/u/1/app/4d870f290f0c5975'
    ),
    true
  );

  // Different account index (/u/1 vs /u/2 or default)
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/u/1/app/4d870f290f0c5975',
      'https://gemini.google.com/u/2/app/4d870f290f0c5975'
    ),
    false
  );
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/app/4d870f290f0c5975',
      'https://gemini.google.com/u/1/app/4d870f290f0c5975'
    ),
    false
  );

  // Different chat IDs
  assert.equal(
    isSameGeminiChat(
      'https://gemini.google.com/app/4d870f290f0c5975',
      'https://gemini.google.com/app/different-chat'
    ),
    false
  );
});

test('Tab Lifecycle - ensureBroTab rejects invalid URL with NO_BRO_CHAT', async () => {
  const tabsApi = new FakeTabsApi();
  const session = new MemoryStorage();

  const res = await ensureBroTab('https://evil.com/fake', session, tabsApi);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NO_BRO_CHAT');
});

test('Tab Lifecycle - ensureBroTab reuses cached tab from session storage and ensures pinned', async () => {
  const tabsApi = new FakeTabsApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  // Seed existing tab in fake API
  tabsApi.tabs.set(105, {
    id: 105,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    url: targetUrl
  });

  // Seed cache in session storage
  await session.set({ 'session:v1': { bootId: 'b1', broTab: { tabId: 105, windowId: 1 } } });

  const res = await ensureBroTab(targetUrl, session, tabsApi);
  assert.equal(res.ok, true);
  assert.equal(res.tabId, 105);

  // Verified tab was pinned
  assert.ok(tabsApi.updateCalls.some(c => c.tabId === 105 && c.update.pinned === true));
  // No new tab created
  assert.equal(tabsApi.createCalls.length, 0);
});

test('Tab Lifecycle - ensureBroTab discovers open tab, pins it, and updates session cache', async () => {
  const tabsApi = new FakeTabsApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  // Seed open matching tab without cache
  tabsApi.tabs.set(201, {
    id: 201,
    index: 1,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    groupId: -1,
    url: targetUrl
  });

  const res = await ensureBroTab(targetUrl, session, tabsApi);
  assert.equal(res.ok, true);
  assert.equal(res.tabId, 201);
  assert.equal(tabsApi.createCalls.length, 0);

  // Check cache updated in session storage
  const sessData: any = await session.get('session:v1');
  assert.equal(sessData['session:v1']?.broTab?.tabId, 201);
});

test('Tab Lifecycle - ensureBroTab creates pinned background tab (active: false) when none exists', async () => {
  const tabsApi = new FakeTabsApi();
  const session = new MemoryStorage();
  const targetUrl = 'https://gemini.google.com/app/4d870f290f0c5975';

  const res = await ensureBroTab(targetUrl, session, tabsApi);
  assert.equal(res.ok, true);
  assert.ok(res.tabId);

  // Verified create call had active: false (no focus stealing) and pinned: true
  assert.equal(tabsApi.createCalls.length, 1);
  assert.equal(tabsApi.createCalls[0].active, false, 'Tab creation must strictly be background (active: false)');
  assert.equal(tabsApi.createCalls[0].pinned, true, 'Tab creation must be pinned');
  assert.equal(tabsApi.createCalls[0].url, targetUrl);
});
