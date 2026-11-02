// tests/unit/popup-view-state.test.ts — T2-1 / T2-2
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendViewOf, hudOf, submitOutcomeOf, draftActionOf, isTalkBusy, shouldFocusInput, BUSY_NOTICE } from '../../src/popup/view-state.ts';
import type { Talk } from '../../src/shared/types.ts';

const talk = (phase: string, extra: Partial<Talk> = {}) =>
  ({ id: 't', text: 'hi', phase, createdAt: 0, updatedAt: 0, phaseDeadlineAt: null, ...extra }) as Talk;

test('T2-1: 送出中 phases without sentAt show no 已讀', () => {
  for (const p of ['queued', 'resolving_tab', 'sending', 'submitting']) {
    const v = sendViewOf(talk(p));
    assert.equal(v.kind, 'sending', p);
    assert.equal(v.readReceipt, false, p);
    assert.equal(hudOf(talk(p), 1000), null, p);
  }
});

test('T2-1: waiting with sentAt shows 已讀, without sentAt it does not', () => {
  assert.equal(sendViewOf(talk('waiting', { sentAt: 5 })).readReceipt, true);
  assert.equal(sendViewOf(talk('extracting', { sentAt: 5 })).kind, 'reading');
  assert.equal(sendViewOf(talk('waiting')).readReceipt, false);
  assert.equal(sendViewOf(null).kind, 'none');
  assert.equal(sendViewOf(talk('done', { sentAt: 5 })).kind, 'none');
  assert.equal(sendViewOf(talk('failed', { sentAt: 5 })).kind, 'none');
});

test('T2-2: patience at 0 s, 24 s and 180 s', () => {
  const t = talk('waiting', { sentAt: 1000 });
  assert.equal(hudOf(t, 1000)!.patience.label, '0:00 / 3:00');
  assert.equal(hudOf(t, 25_000)!.patience.label, '0:24 / 3:00');
  assert.equal(hudOf(t, 25_000)!.patience.ratio, 24_000 / 180_000);
  const full = hudOf(t, 181_000)!.patience;
  assert.equal(full.label, '3:00 / 3:00');
  assert.equal(full.ratio, 1);
  assert.equal(hudOf(t, 500)!.patience.elapsedMs, 0, 'clock skew clamps to 0');
});

test('T2-2: silence at 4 s and 30 s, with and without lastGrowthAt', () => {
  const noGrowth = talk('waiting', { sentAt: 1000 });
  assert.equal(hudOf(noGrowth, 5000)!.silence.label, '0:04 / 0:30');
  assert.equal(hudOf(noGrowth, 31_000)!.silence.ratio, 1);
  const grown = talk('waiting', { sentAt: 1000, lastGrowthAt: 20_000 });
  assert.equal(hudOf(grown, 24_000)!.silence.label, '0:04 / 0:30');
  assert.equal(hudOf(grown, 50_000)!.silence.label, '0:30 / 0:30');
  assert.equal(hudOf(grown, 50_000)!.patience.label, '0:49 / 3:00');
});

test('B-1/B-2: a BUSY reply yields the BUSY notice and no accepted Talk (so no render, no previous-summary change)', () => {
  const o = submitOutcomeOf({ accepted: false, reason: 'BUSY' });
  assert.deepEqual(o, { kind: 'busy', message: '上一題還在處理中，請稍候' });
  assert.equal(BUSY_NOTICE, '上一題還在處理中，請稍候');
  assert.equal(submitOutcomeOf({ accepted: false, reason: 'EMPTY' }).kind, 'none');
  assert.equal(submitOutcomeOf(undefined).kind, 'none');
  const t = talk('waiting');
  assert.deepEqual(submitOutcomeOf({ accepted: true, talk: t }), { kind: 'accepted', talk: t });
});

test('B-3: opening with a done or failed Talk never writes talk.text', () => {
  for (const p of ['done', 'failed']) assert.equal(draftActionOf(false, talk(p)), 'keep', p);
  assert.equal(draftActionOf(false, null), 'keep');
});

test('B-3b: re-rendering a terminal Talk leaves the user draft alone, including repeats after the transition', () => {
  assert.equal(draftActionOf(false, talk('done')), 'keep');
  assert.equal(draftActionOf(false, talk('failed')), 'keep');
});

test('B-3c: waiting shows its text; waiting to done or failed clears once', () => {
  assert.equal(draftActionOf(false, talk('waiting')), 'show_talk_text');
  let wasBusy = false;
  const seq = ['queued', 'waiting', 'extracting', 'done', 'done'];
  const actions = seq.map((p) => {
    const a = draftActionOf(wasBusy, talk(p));
    wasBusy = !['done', 'failed'].includes(p);
    return a;
  });
  assert.deepEqual(actions, ['show_talk_text', 'show_talk_text', 'show_talk_text', 'clear', 'keep']);
  assert.equal(draftActionOf(true, talk('failed')), 'clear');
});

test('I-1/I-2: the composer is locked, and Enter is ignored, in exactly the six busy phases', () => {
  for (const p of ['queued', 'resolving_tab', 'sending', 'submitting', 'waiting', 'extracting']) {
    assert.equal(isTalkBusy(talk(p)), true, p);
  }
  for (const p of ['done', 'failed']) assert.equal(isTalkBusy(talk(p)), false, p);
  assert.equal(isTalkBusy(null), false, 'idle');
});

test('I-3: focus moves to the input only on a busy-to-terminal transition', () => {
  assert.equal(shouldFocusInput(true, talk('done')), true);
  assert.equal(shouldFocusInput(true, talk('failed')), true);
  assert.equal(shouldFocusInput(false, talk('done')), false, 'plain terminal re-render keeps focus elsewhere');
  assert.equal(shouldFocusInput(false, talk('failed')), false);
  assert.equal(shouldFocusInput(true, talk('waiting')), false);
  assert.equal(shouldFocusInput(false, null), false);
});
