// tests/unit/handoff.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { performHandoff, isPopupOpen, continueHandoffAfterPopupClose, type HandoffDeps } from '../../src/sw/handoff.ts';
import { createTalk, transition } from '../../src/shared/talk-machine.ts';
import { FakeAdapter } from '../helpers/fake-adapter.ts';
import type { StorageAreaLike } from '../../src/shared/storage.ts';
import type { Talk } from '../../src/shared/types.ts';

class MemoryStorage implements StorageAreaLike {
  private data: Record<string, any> = {};

  async get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>> {
    if (!keys) return { ...this.data };
    if (typeof keys === 'string') {
      return this.data[keys] !== undefined ? { [keys]: this.data[keys] } : {};
    }
    const res: Record<string, any> = {};
    const keyList = Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of keyList) {
      if (this.data[k] !== undefined) res[k] = this.data[k];
    }
    return res;
  }

  async set(items: Record<string, any>): Promise<void> {
    Object.assign(this.data, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete this.data[k];
  }

  async clear(): Promise<void> {
    this.data = {};
  }
}

test('Handoff - Deferred handoff is strictly preserved (zero startup focus jumps)', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let tabSwitchCalled = false;

  let talk = createTalk('Deferred Talk', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'INTERRUPTED' }, 1010);
  talk = {
    ...talk,
    handoff: {
      status: 'deferred',
      copied: false,
      focused: false
    }
  };

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    tabsApi: {
      update: async () => { tabSwitchCalled = true; return {} as any; },
      query: async () => [],
      get: async () => ({} as any),
      create: async () => ({} as any),
      sendMessage: async () => ({})
    } as any
  };

  const res = await performHandoff(deps, talk);
  assert.equal(res.status, 'deferred');
  assert.equal(res.copied, false);
  assert.equal(res.focused, false);
  assert.equal(tabSwitchCalled, false, 'Deferred handoff must never trigger automatic tab switch');
});

test('Handoff - Cancelled handoff persists and prevents auto re-triggering', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let tabSwitchCalled = false;

  let talk = createTalk('Cancelled Talk', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, 1010);
  talk = {
    ...talk,
    handoff: {
      status: 'cancelled',
      copied: false,
      focused: false
    }
  };

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    tabsApi: {
      update: async () => { tabSwitchCalled = true; return {} as any; }
    } as any
  };

  const res = await performHandoff(deps, talk);
  assert.equal(res.status, 'cancelled');
  assert.equal(tabSwitchCalled, false, 'Cancelled handoff must not execute tab switch');
});

test('Handoff - Popup open detection and pending countdown status', async () => {
  const runtimeWithPopup = {
    getContexts: async () => [{ contextType: 'POPUP' }]
  };
  assert.equal(await isPopupOpen(runtimeWithPopup), true);

  const runtimeWithoutPopup = {
    getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }]
  };
  assert.equal(await isPopupOpen(runtimeWithoutPopup), false);

  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let talk = createTalk('Popup Open Talk', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, 1010);

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    runtimeApi: runtimeWithPopup
  };

  const res = await performHandoff(deps, talk);
  assert.equal(res.status, 'pending', 'When popup is open, handoff must enter pending state for popup countdown');
  assert.equal(res.copied, false);
  assert.equal(res.focused, false);
});

test('Handoff - Popup closed execution: Offscreen copy, tab switch & shadow DOM notice', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let noticeMessage = '';
  adapter.showHandoffNotice = async (a) => { noticeMessage = a.message; };

  await storageLocal.set({
    'settings:v1': { broChatUrl: 'https://gemini.google.com/app/test-chat', updatedAt: 1000 }
  });

  let talk = createTalk('Hello Bro Handoff', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, 1010);
  await storageLocal.set({
    'runtime:v1': { lastTalk: talk, logByTalkId: {} }
  });

  let offscreenCreated = false;
  let offscreenClosed = false;
  let tabActivated = false;
  let windowFocused = false;

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    runtimeApi: {
      getContexts: async () => [] // no popup
    },
    offscreenApi: {
      createDocument: async () => { offscreenCreated = true; },
      closeDocument: async () => { offscreenClosed = true; }
    },
    tabsApi: {
      query: async () => [{ id: 101, windowId: 50, url: 'https://gemini.google.com/app/test-chat', pinned: true }],
      update: async (tabId: number, info: any) => {
        if (tabId === 101 && info.active) tabActivated = true;
        return { id: tabId } as any;
      }
    } as any,
    windowsApi: {
      update: async (winId: number, info: any) => {
        if (winId === 50 && info.focused) windowFocused = true;
        return {} as any;
      }
    }
  };

  // Provide alreadyCopied: true to simulate successful offscreen copy in unit test
  const res = await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });

  assert.equal(res.status, 'done');
  assert.equal(res.copied, true);
  assert.equal(res.focused, true);
  assert.equal(tabActivated, true, 'Bro Chat tab must be activated');
  assert.equal(windowFocused, true, 'Browser window must be focused');
  assert.ok(noticeMessage.includes('老大 30 秒沒出聲。'), 'Notice must contain exact FailureCode user message');
  assert.ok(noticeMessage.includes('Talk 已複製'), 'Notice must confirm Talk text was copied');

  // Verify storage updated atomically
  const updatedRuntime = (await storageLocal.get('runtime:v1'))['runtime:v1'];
  assert.equal(updatedRuntime.lastTalk.handoff.status, 'done');
});

test('Handoff - NO_BRO_CHAT failure opens Options page and records partial status', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let optionsPageOpened = false;

  let talk = createTalk('No Bro Chat Prompt', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'NO_BRO_CHAT' }, 1010);
  await storageLocal.set({
    'runtime:v1': { lastTalk: talk, logByTalkId: {} }
  });

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    runtimeApi: {
      getContexts: async () => [],
      openOptionsPage: async () => { optionsPageOpened = true; }
    }
  };

  const res = await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });

  assert.equal(res.status, 'partial', 'Status must be partial since Bro Chat tab could not be focused');
  assert.equal(res.copied, true);
  assert.equal(res.focused, false);
  assert.equal(optionsPageOpened, true, 'Options page must be opened for NO_BRO_CHAT');
});

test('Handoff - Explicit user action authorizes deferred handoff execution', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let tabSwitchCalled = false;
  let windowFocusCalled = false;

  await storageLocal.set({
    'settings:v1': { broChatUrl: 'https://gemini.google.com/app/deferred-chat', updatedAt: 1000 }
  });

  let talk = createTalk('Deferred Talk Authorization', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'INTERRUPTED' }, 1010);
  talk = {
    ...talk,
    handoff: {
      status: 'deferred',
      copied: false,
      focused: false
    }
  };
  await storageLocal.set({
    'runtime:v1': { lastTalk: talk, logByTalkId: {} }
  });

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    runtimeApi: { getContexts: async () => [] },
    tabsApi: {
      query: async () => [{ id: 501, windowId: 77, url: 'https://gemini.google.com/app/deferred-chat', pinned: true }],
      update: async (tabId: number, info: any) => {
        if (tabId === 501 && info.active) tabSwitchCalled = true;
        return { id: tabId } as any;
      }
    } as any,
    windowsApi: {
      update: async (winId: number, info: any) => {
        if (winId === 77 && info.focused) windowFocusCalled = true;
        return {} as any;
      }
    }
  };

  // Calling with authorizeDeferred: true executes the handoff and marks it done
  const res = await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true, authorizeDeferred: true });
  assert.equal(res.status, 'done');
  assert.equal(res.copied, true);
  assert.equal(res.focused, true);
  assert.equal(tabSwitchCalled, true);
  assert.equal(windowFocusCalled, true);

  const updatedRuntime = (await storageLocal.get('runtime:v1'))['runtime:v1'];
  assert.equal(updatedRuntime.lastTalk.handoff.status, 'done');
});

test('Handoff - Pre-action persisted cancelled check prevents execution', async () => {
  const storageLocal = new MemoryStorage();
  const adapter = new FakeAdapter();
  let tabSwitchCalled = false;

  let talk = createTalk('Cancel Race Talk', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, 1010);

  // In memory, handoff might look pending, but storage has persisted 'cancelled'
  const cancelledTalk: Talk = {
    ...talk,
    handoff: { status: 'cancelled', copied: false, focused: false }
  };
  await storageLocal.set({
    'runtime:v1': { lastTalk: cancelledTalk, logByTalkId: {} }
  });

  const deps: HandoffDeps = {
    storageLocal,
    adapter,
    runtimeApi: { getContexts: async () => [] },
    tabsApi: {
      update: async () => { tabSwitchCalled = true; return {} as any; }
    } as any
  };

  const res = await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });
  assert.equal(res.status, 'cancelled');
  assert.equal(tabSwitchCalled, false, 'Tab switch must not be called when storage is cancelled');
});

async function setupPendingB3(popupStates: boolean[]) {
  const storageLocal = new MemoryStorage();
  const calls = { offscreen: 0, tabs: 0, windows: 0 };
  let talk = createTalk('B3 Talk', 1000);
  talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, 1010);
  talk = { ...talk, handoff: { status: 'pending', copied: false, focused: false } };
  await storageLocal.set({
    'runtime:v1': { lastTalk: talk, logByTalkId: {} },
    'settings:v1': { broChatUrl: 'https://gemini.google.com/app/x', updatedAt: 1000 }
  });
  (globalThis as any).chrome = {
    runtime: { lastError: undefined, sendMessage: (_m: any, cb: any) => cb({ ok: true }) }
  };
  let polls = 0;
  const deps: HandoffDeps = {
    storageLocal,
    adapter: new FakeAdapter(),
    runtimeApi: {
      getContexts: async (f: any) => {
        if (f.contextTypes?.includes('POPUP')) {
          const open = popupStates[Math.min(polls++, popupStates.length - 1)];
          return open ? [{ contextType: 'POPUP' }] : [];
        }
        return [];
      }
    },
    offscreenApi: {
      createDocument: async () => { calls.offscreen++; },
      closeDocument: async () => {}
    },
    tabsApi: {
      query: async () => [{ id: 501, windowId: 77, url: 'https://gemini.google.com/app/x', pinned: true }],
      update: async () => { calls.tabs++; return {} as any; }
    } as any,
    windowsApi: { update: async () => { calls.windows++; return {} as any; } }
  };
  return { storageLocal, deps, talk, calls };
}

test.afterEach(() => { delete (globalThis as any).chrome; });

const noSleep = { pollMs: 10, maxWaitMs: 100, sleep: async () => {} };
const readTalk = async (s: MemoryStorage) => (await s.get('runtime:v1'))['runtime:v1'].lastTalk as Talk;

test('TC-B3.1 popup closes during pending countdown -> handoff completes exactly once', async () => {
  const { storageLocal, deps, talk, calls } = await setupPendingB3([true, true, false]);
  const res = await continueHandoffAfterPopupClose(deps, talk.id, noSleep);
  assert.ok(res);
  assert.ok(res!.status === 'done' || res!.status === 'partial');
  assert.equal(res!.focused, true);
  assert.equal(calls.tabs, 1);
  assert.equal(calls.windows, 1);
  const saved = await readTalk(storageLocal);
  assert.equal(saved.handoff?.status, res!.status);
  assert.equal(saved.handoff?.copied, res!.copied);

  // A second continuation or a late popup switch_tab request must not re-execute
  assert.equal(await continueHandoffAfterPopupClose(deps, talk.id, noSleep), null);
  await performHandoff(deps, talk, { forceClosed: true });
  assert.equal(calls.tabs, 1);
  assert.equal(calls.windows, 1);
});

test('TC-B3.2 cancel then popup disconnect -> zero external calls, status stays cancelled', async () => {
  const { storageLocal, deps, talk, calls } = await setupPendingB3([true, false]);
  const rt = (await storageLocal.get('runtime:v1'))['runtime:v1'];
  await storageLocal.set({
    'runtime:v1': { ...rt, lastTalk: { ...talk, handoff: { status: 'cancelled', copied: false, focused: false } } }
  });
  const res = await continueHandoffAfterPopupClose(deps, talk.id, noSleep);
  assert.equal(res, null);
  assert.deepEqual(calls, { offscreen: 0, tabs: 0, windows: 0 });
  assert.equal((await readTalk(storageLocal)).handoff?.status, 'cancelled');
});

test('TC-B3.3 two concurrent switch requests -> one execution', async () => {
  const { deps, talk, calls } = await setupPendingB3([false]);
  const [a, b] = await Promise.all([
    performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true }),
    performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true })
  ]);
  assert.equal(calls.tabs, 1);
  assert.equal(calls.windows, 1);
  assert.ok(a.status === 'done' || b.status === 'done');
  // A later request still holding the stale pending Talk must not execute again
  await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });
  assert.equal(calls.tabs, 1);
});

test('TC-B3.4 stale talkId completion never overwrites a newer Talk', async () => {
  const { storageLocal, deps, talk, calls } = await setupPendingB3([false]);
  let newer = createTalk('Newer Talk', 2000);
  const origUpdate = (deps.tabsApi as any).update;
  // The newer Talk replaces lastTalk while the older handoff is in flight
  (deps.tabsApi as any).update = async (...args: any[]) => {
    const rt = (await storageLocal.get('runtime:v1'))['runtime:v1'];
    await storageLocal.set({ 'runtime:v1': { ...rt, lastTalk: newer } });
    return origUpdate(...args);
  };
  await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });
  assert.equal(calls.tabs, 1);
  assert.deepEqual(await readTalk(storageLocal), newer);

  // Older id after the newer Talk is stored: no external calls at all
  (deps.tabsApi as any).update = origUpdate;
  assert.equal(await continueHandoffAfterPopupClose(deps, talk.id, noSleep), null);
  await performHandoff(deps, talk, { forceClosed: true, alreadyCopied: true });
  assert.equal(calls.tabs, 1);
  assert.deepEqual(await readTalk(storageLocal), newer);
});
