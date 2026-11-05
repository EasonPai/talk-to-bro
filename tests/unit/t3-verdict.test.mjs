import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertIdle, assertAnswer } from '../../scripts/lib/t3-verdict.mjs';

const valid = { beforeCount: 4, afterCount: 5, userText: 'claude', word: 'claude', answer: '# claude\n字彙解釋', pairedAnswer: 'claude 字彙解釋', phase: 'done' };
test('M7 rejects pending responses even when Stop is absent', () => {
  assert.throws(() => assertIdle({ stop: false, pending: true }), /PRECONDITION_GENERATING/);
  assert.throws(() => assertIdle({ stop: true, pending: false }), /PRECONDITION_GENERATING/);
  assert.doesNotThrow(() => assertIdle({ stop: false, pending: false }));
});
test('M7 accepts only one new exact last user turn', () => {
  assert.throws(() => assertAnswer({ ...valid, afterCount: 4 }), /LAST_NEW_USER_TURN/);
  assert.throws(() => assertAnswer({ ...valid, userText: 'claude\nclaude' }), /LAST_NEW_USER_TURN/);
  assert.throws(() => assertAnswer({ ...valid, userText: 'old draft claude' }), /LAST_NEW_USER_TURN/);
  assert.doesNotThrow(() => assertAnswer(valid));
});
test('M7 rejects refusals, word mentions without headings, and missing paired Answers', () => {
  assert.throws(() => assertAnswer({ ...valid, answer: '# claude\n我是文字型 AI，這超出我的能力範圍了。' }), /REFUSAL/);
  assert.throws(() => assertAnswer({ ...valid, answer: 'Earlier response mentioned claude' }), /HEADING/);
  assert.throws(() => assertAnswer({ ...valid, pairedAnswer: 'apple 字彙解釋' }), /PAIRED_ANSWER/);
  assert.throws(() => assertAnswer({ ...valid, phase: 'failed' }), /TALK_NOT_DONE/);
});
