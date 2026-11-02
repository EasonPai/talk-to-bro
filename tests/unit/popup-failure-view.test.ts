// tests/unit/popup-failure-view.test.ts — UI r2 T4-1 / T4-2 / T4-4
import test from 'node:test';
import assert from 'node:assert/strict';
import { failureViewOf, CLIPBOARD_COPIED_LINE, CLIPBOARD_NOT_COPIED_LINE } from '../../src/popup/view-state.ts';
import { getFailureInfo } from '../../src/shared/failures.ts';
import { finalizeTerminalTalk } from '../../src/shared/storage.ts';
import type { FailureCode, Talk } from '../../src/shared/types.ts';

const CODES: FailureCode[] = [
  'NO_BRO_CHAT', 'BRO_CHAT_MISSING', 'NOT_SIGNED_IN', 'INPUT_NOT_FOUND', 'EDITOR_BUSY', 'SUBMIT_UNCONFIRMED',
  'TIMEOUT_IDLE', 'TIMEOUT_TOTAL', 'QUOTA_EXHAUSTED', 'TAB_UNRESPONSIVE', 'TAB_CLOSED', 'EXTRACT_FAILED',
  'INTERRUPTED', 'INTERNAL'
];

const NARRATION: Partial<Record<FailureCode, string>> = {
  TIMEOUT_IDLE: '惡龍 已讀不回……',
  TIMEOUT_TOTAL: '惡龍 已讀不回……',
  QUOTA_EXHAUSTED: '惡龍今天見客太多。',
  NOT_SIGNED_IN: '勇者還沒登入，進不了城。'
};

test('T4-1: every FailureCode shows its narration above the unchanged userMessage', () => {
  for (const code of CODES) {
    const v = failureViewOf(code);
    assert.equal(v.userMessage, getFailureInfo(code).userMessage, code);
    assert.equal(v.narration, NARRATION[code] ?? '惡龍 無視了勇者……', code);
    assert.notEqual(v.narration, v.userMessage, `${code}: narration must not replace userMessage`);
    assert.doesNotMatch(v.userMessage, /Pip|老大|小弟/, code);
  }
});

test('T4-2: the clipboard success line follows handoff.copied exactly', () => {
  const lines = (copied: boolean, status: 'done' | 'partial') =>
    failureViewOf('TIMEOUT_IDLE', { status, copied, focused: true }).handoffLine;
  for (const status of ['done', 'partial'] as const) {
    assert.equal(lines(true, status), CLIPBOARD_COPIED_LINE);
    assert.equal(lines(false, status), CLIPBOARD_NOT_COPIED_LINE);
    assert.doesNotMatch(lines(false, status)!, /訊息已經複製/);
  }
  for (const status of ['pending', 'deferred', 'cancelled'] as const) {
    assert.equal(failureViewOf('TIMEOUT_IDLE', { status, copied: true, focused: false }).handoffLine, null);
  }
  assert.equal(failureViewOf('TIMEOUT_IDLE').handoffLine, null);
});

test('T4-4: a failed Talk writes a Talk Log entry with only result and time', async () => {
  const mem: Record<string, unknown> = {};
  const storage = {
    get: async (k: string) => ({ [k]: mem[k] }),
    set: async (o: Record<string, unknown>) => { Object.assign(mem, o); },
    remove: async (k: string) => { delete mem[k]; }
  };
  const talk = {
    id: 't1', text: 'secret word', phase: 'failed', createdAt: 1, updatedAt: 2, phaseDeadlineAt: null,
    failure: { code: 'TIMEOUT_IDLE', stage: 'read', at: 2 }
  } as unknown as Talk;
  const updated = await finalizeTerminalTalk(storage as never, talk, 99);
  assert.deepEqual(updated.logByTalkId.t1, { result: 'read_failed', at: 99 });
});
