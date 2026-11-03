// tests/unit/storage.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRuntimeStorage,
  saveRuntimeStorage,
  getSessionStorage,
  saveSessionStorage,
  getUiStorage,
  saveUiStorage,
  DEFAULT_UI_STATE,
  writeAheadTalk,
  finalizeTerminalTalk,
  evictOldestLogEntries,
  MAX_LOG_ENTRIES
} from '../../src/shared/storage.ts';
import { createTalk, transition } from '../../src/shared/talk-machine.ts';
import { MemoryStorage } from '../helpers/fake-adapter.ts';
import type { LogEntry } from '../../src/shared/types.ts';

test('Storage - Write-ahead updates lastTalk before action dispatch', async () => {
  const storage = new MemoryStorage();
  const t0 = 1700000000000;
  const talk = createTalk('Write ahead test', t0, 'talk-wa-1');

  await writeAheadTalk(storage, talk);

  const runtime = await getRuntimeStorage(storage);
  assert.equal(runtime.lastTalk?.id, 'talk-wa-1');
  assert.equal(runtime.lastTalk?.phase, 'queued');
  assert.deepEqual(runtime.logByTalkId, {}, 'Write-ahead must not write to logByTalkId');
});

test('Storage - Atomic terminal write updates lastTalk and logByTalkId simultaneously', async () => {
  const storage = new MemoryStorage();
  const t0 = 1700000000000;
  let talk = createTalk('Terminal write test', t0, 'talk-term-1');
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, t0 + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  talk = transition(talk, { type: 'STREAM_COMPLETE', answerMarkdown: 'Done markdown' }, t0 + 40);

  const tEnd = t0 + 50;
  await finalizeTerminalTalk(storage, talk, tEnd);

  const runtime = await getRuntimeStorage(storage);
  assert.equal(runtime.lastTalk?.phase, 'done');
  assert.equal(runtime.lastTalk?.answerMarkdown, 'Done markdown');
  assert.ok(runtime.logByTalkId['talk-term-1'], 'Log entry must be created with talk ID');
  assert.equal(runtime.logByTalkId['talk-term-1'].result, 'success');
  assert.equal(runtime.logByTalkId['talk-term-1'].at, tEnd);
});

test('Storage - Log entry categorization on failure (send_failed vs read_failed)', async () => {
  const storage = new MemoryStorage();
  const t0 = 1700000000000;

  // Send failure
  let sendFailTalk = createTalk('Send fail', t0, 'talk-send-fail');
  sendFailTalk = transition(sendFailTalk, { type: 'FAIL', code: 'EDITOR_BUSY' }, t0 + 10);
  await finalizeTerminalTalk(storage, sendFailTalk, t0 + 15);

  let runtime = await getRuntimeStorage(storage);
  assert.equal(runtime.logByTalkId['talk-send-fail']?.result, 'send_failed');

  // Read failure
  let readFailTalk = createTalk('Read fail', t0, 'talk-read-fail');
  readFailTalk = transition(readFailTalk, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  readFailTalk = transition(readFailTalk, { type: 'SUBMITTING' }, t0 + 20);
  readFailTalk = transition(readFailTalk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  readFailTalk = transition(readFailTalk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, t0 + 40);
  await finalizeTerminalTalk(storage, readFailTalk, t0 + 45);

  runtime = await getRuntimeStorage(storage);
  assert.equal(runtime.logByTalkId['talk-read-fail']?.result, 'read_failed');
});

test('Storage - Deduplication: duplicate finalization preserves single entry', async () => {
  const storage = new MemoryStorage();
  const t0 = 1700000000000;
  let talk = createTalk('Dedup test', t0, 'talk-dedup-1');
  talk = transition(talk, { type: 'FAIL', code: 'INTERNAL' }, t0 + 10);

  // Finalize twice
  await finalizeTerminalTalk(storage, talk, t0 + 20);
  await finalizeTerminalTalk(storage, talk, t0 + 30);

  const runtime = await getRuntimeStorage(storage);
  assert.equal(Object.keys(runtime.logByTalkId).length, 1);
  assert.equal(runtime.logByTalkId['talk-dedup-1'].at, t0 + 20, 'Initial finalize timestamp must be preserved');
});

test('Storage - FIFO log eviction caps logByTalkId at 2000 entries', () => {
  const log: Record<string, LogEntry> = {};
  const baseTime = 100000;

  // Populate 2005 entries
  for (let i = 1; i <= 2005; i++) {
    log[`talk-${i}`] = {
      result: i % 2 === 0 ? 'success' : 'read_failed',
      at: baseTime + i
    };
  }

  assert.equal(Object.keys(log).length, 2005);
  const evicted = evictOldestLogEntries(log, MAX_LOG_ENTRIES);

  assert.equal(Object.keys(evicted).length, 2000);
  // Oldest 5 entries (talk-1 through talk-5) must be removed
  for (let i = 1; i <= 5; i++) {
    assert.equal(evicted[`talk-${i}`], undefined, `talk-${i} must be evicted`);
  }
  // Newest entries (talk-6 through talk-2005) must be retained
  assert.ok(evicted['talk-6']);
  assert.ok(evicted['talk-2005']);
});

test('Storage - Session storage preservation and isolation', async () => {
  const storage = new MemoryStorage();
  assert.equal(await getSessionStorage(storage), null);

  await saveSessionStorage(storage, {
    bootId: 'boot-uuid-12345',
    broTab: { tabId: 99, windowId: 1 }
  });

  const session = await getSessionStorage(storage);
  assert.equal(session?.bootId, 'boot-uuid-12345');
  assert.equal(session?.broTab?.tabId, 99);
});

test('Storage - UI storage defaults and independence from runtime storage (M6/M8/M12)', async () => {
  const storage = new MemoryStorage();

  // 1. Missing key returns default UiState
  const initialUi = await getUiStorage(storage);
  assert.deepEqual(initialUi, DEFAULT_UI_STATE);
  assert.equal(initialUi.mode, 'popup');
  assert.equal(initialUi.draft, '');
  assert.equal(initialUi.revision, 0);

  // 2. Set runtime talk
  const t0 = 1700000000000;
  const talk = createTalk('Test Talk', t0, 'talk-ui-iso-1');
  await writeAheadTalk(storage, talk);

  // 3. Save UI storage
  await saveUiStorage(storage, {
    mode: 'sidepanel',
    draft: 'Draft text for sidepanel',
    revision: 1
  });

  // Verify UI storage updated
  const updatedUi = await getUiStorage(storage);
  assert.equal(updatedUi.mode, 'sidepanel');
  assert.equal(updatedUi.draft, 'Draft text for sidepanel');
  assert.equal(updatedUi.revision, 1);

  // 4. Verify runtime:v1 is completely unaffected
  const runtime = await getRuntimeStorage(storage);
  assert.equal(runtime.lastTalk?.id, 'talk-ui-iso-1');
  assert.equal(runtime.lastTalk?.text, 'Test Talk');
});
