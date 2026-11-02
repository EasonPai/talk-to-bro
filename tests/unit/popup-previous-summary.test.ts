// tests/unit/popup-previous-summary.test.ts — UI r2 T5-1
import test from 'node:test';
import assert from 'node:assert/strict';
import { previousSummaryOf } from '../../src/popup/view-state.ts';
import type { Talk } from '../../src/shared/types.ts';

const talk = (over: Partial<Talk>): Talk => ({ id: 't1', text: 'meticulous', phase: 'done', createdAt: 1000, updatedAt: 2000, phaseDeadlineAt: null, ...over });

test('T5-1: a previous Talk becomes first 40 chars plus createdAt', () => {
  const s = previousSummaryOf(talk({ text: 'x'.repeat(60), createdAt: 4242 }));
  assert.equal(s?.text, 'x'.repeat(40));
  assert.equal(s?.at, 4242);
  assert.equal(s?.answerLines, null);
});

test('T5-1: no previous Talk leaves the summary empty', () => {
  assert.equal(previousSummaryOf(null), null);
  assert.equal(previousSummaryOf(undefined), null);
});

test('T5-1: keeps only the first 3 answer lines and counts characters not UTF-16 units', () => {
  const s = previousSummaryOf(talk({ text: '😀'.repeat(45), answerMarkdown: 'a\n\nb\nc\nd\ne' }));
  assert.equal(Array.from(s!.text).length, 40);
  assert.deepEqual(s?.answerLines, ['a', 'b', 'c']);
});
