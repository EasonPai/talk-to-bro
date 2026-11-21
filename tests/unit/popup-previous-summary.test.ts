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

test('T5-1: submitPreviousSummary renders Tidal Calm 前次 Talk label and makes zero storage calls', async () => {
  const origDoc = (globalThis as any).document;
  const origChrome = (globalThis as any).chrome;
  const card = { hidden: true, setAttribute: () => {} };
  const detail = { hidden: true };
  const label = { textContent: '' };
  const textEl = { textContent: '' };
  const answerEl = { textContent: '', hidden: true };
  let storageCalls = 0;

  (globalThis as any).document = {
    getElementById: (id: string) => {
      if (id === 'previous-card') return card;
      if (id === 'previous-detail') return detail;
      if (id === 'previous-label') return label;
      if (id === 'previous-text') return textEl;
      if (id === 'previous-answer') return answerEl;
      return null;
    },
    querySelector: () => null
  };
  (globalThis as any).chrome = {
    storage: {
      local: {
        set: () => { storageCalls++; },
        get: () => { storageCalls++; }
      }
    }
  };

  try {
    const popup = await import('../../src/popup/popup.ts');
    const createdAt = new Date(2026, 0, 1, 14, 30, 0).getTime();
    popup.submitPreviousSummary(talk({ text: 'serendipity', createdAt, answerMarkdown: 'line1\nline2' }));
    assert.equal(card.hidden, false);
    assert.equal(label.textContent, '前次 Talk・14:30「serendipity」');
    assert.equal(textEl.textContent, 'serendipity');
    assert.equal(answerEl.textContent, 'line1\nline2');
    assert.equal(storageCalls, 0);
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).chrome = origChrome;
  }
});
