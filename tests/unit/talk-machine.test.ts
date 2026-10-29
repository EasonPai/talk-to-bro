// tests/unit/talk-machine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTalk,
  transition,
  stageOf,
  phaseDeadlineOf
} from '../../src/shared/talk-machine.ts';
import type { FailureCode } from '../../src/shared/types.ts';

test('Talk State Machine - Initial creation and stage categorization', () => {
  const t0 = 1700000000000;
  const talk = createTalk('What is ledger?', t0, 'talk-test-1');

  assert.equal(talk.id, 'talk-test-1');
  assert.equal(talk.text, 'What is ledger?');
  assert.equal(talk.phase, 'queued');
  assert.equal(talk.createdAt, t0);
  assert.equal(talk.updatedAt, t0);
  assert.equal(talk.phaseDeadlineAt, t0 + 5_000);

  // Stage checks
  assert.equal(stageOf('queued'), 'send');
  assert.equal(stageOf('resolving_tab'), 'send');
  assert.equal(stageOf('sending'), 'send');
  assert.equal(stageOf('submitting'), 'send');
  assert.equal(stageOf('waiting'), 'read');
  assert.equal(stageOf('extracting'), 'read');
  assert.equal(stageOf('done'), 'read');
  assert.equal(stageOf('failed'), 'read');
});

test('Talk State Machine - Sequential Happy Path Transitions', () => {
  const t0 = 1700000000000;
  let talk = createTalk('Explain ledger', t0);

  // 1. Queued -> Sending (via TAB_RESOLVED)
  const t1 = t0 + 100;
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 42 }, t1);
  assert.equal(talk.phase, 'sending');
  assert.equal(talk.tabId, 42);
  assert.equal(talk.updatedAt, t1);
  assert.equal(talk.phaseDeadlineAt, t1 + 10_000);

  // 2. Sending -> Submitting
  const t2 = t1 + 200;
  talk = transition(talk, { type: 'SUBMITTING' }, t2);
  assert.equal(talk.phase, 'submitting');
  assert.equal(talk.phaseDeadlineAt, t2 + 15_000);

  // 3. Submitting -> Waiting
  const t3 = t2 + 300;
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: t3 }, t3);
  assert.equal(talk.phase, 'waiting');
  assert.equal(talk.sentAt, t3);
  assert.equal(talk.lastGrowthAt, t3);
  assert.equal(talk.streamedChars, 0);
  assert.equal(talk.phaseDeadlineAt, t3 + 30_000);

  // 4. Waiting -> Streaming growth
  const t4 = t3 + 1000;
  talk = transition(
    talk,
    { type: 'STREAMING_GROWTH', textLength: 120, textSig: '120:abcdef12', lastGrowthAt: t4 },
    t4
  );
  assert.equal(talk.phase, 'waiting');
  assert.equal(talk.streamedChars, 120);
  assert.equal(talk.lastSig, '120:abcdef12');
  assert.equal(talk.lastGrowthAt, t4);
  assert.equal(talk.phaseDeadlineAt, t4 + 30_000);

  // 5. Waiting -> Done (Stream Complete)
  const t5 = t4 + 2000;
  talk = transition(talk, { type: 'STREAM_COMPLETE', answerMarkdown: 'Ledger is a book of accounts.' }, t5);
  assert.equal(talk.phase, 'done');
  assert.equal(talk.answerMarkdown, 'Ledger is a book of accounts.');
  assert.equal(talk.phaseDeadlineAt, null, 'Terminal done phase deadline must be null');

  // Alternative path: resolving_tab and extracting transitions
  const tAlt = 1700000050000;
  let resolvingTalk = { ...createTalk('Alt', tAlt), phase: 'resolving_tab' as const, phaseDeadlineAt: tAlt + 15000 };
  resolvingTalk = transition(resolvingTalk, { type: 'TAB_RESOLVED', tabId: 88 }, tAlt + 10);
  assert.equal(resolvingTalk.phase, 'sending');
  assert.equal(resolvingTalk.tabId, 88);

  let extractingTalk = { ...resolvingTalk, phase: 'extracting' as const, phaseDeadlineAt: tAlt + 10000 };
  const doneFromExtracting = transition(extractingTalk, { type: 'STREAM_COMPLETE', answerMarkdown: 'Extracted markdown' }, tAlt + 20);
  assert.equal(doneFromExtracting.phase, 'done');
  assert.equal(doneFromExtracting.answerMarkdown, 'Extracted markdown');
  assert.equal(phaseDeadlineOf('done', tAlt), null);
  assert.equal(phaseDeadlineOf('failed', tAlt), null);
});

test('Talk State Machine - AC1 Phase Deadline Enforcement (Late transitions rejected)', () => {
  // Test Case: queued talk created at 1000 has deadline 6000. Late TAB_RESOLVED at 100000 must fail!
  const talkQueued = createTalk('Late queued test', 1000);
  assert.equal(talkQueued.phaseDeadlineAt, 6000);

  const lateQueued = transition(talkQueued, { type: 'TAB_RESOLVED', tabId: 1 }, 100000);
  assert.equal(lateQueued.phase, 'failed', 'Late transition must result in failed phase');
  assert.equal(lateQueued.failure?.code, 'INTERNAL');
  assert.equal(lateQueued.failure?.stage, 'send');
  assert.equal(lateQueued.phaseDeadlineAt, null);

  // Resolving tab past deadline -> TAB_UNRESPONSIVE
  const talkResolving = { ...talkQueued, phase: 'resolving_tab' as const, phaseDeadlineAt: 20000 };
  const lateResolving = transition(talkResolving, { type: 'TAB_RESOLVED', tabId: 1 }, 25000);
  assert.equal(lateResolving.phase, 'failed');
  assert.equal(lateResolving.failure?.code, 'TAB_UNRESPONSIVE');

  // Sending past deadline -> EDITOR_BUSY
  const talkSending = { ...talkQueued, phase: 'sending' as const, phaseDeadlineAt: 15000 };
  const lateSending = transition(talkSending, { type: 'SUBMITTING' }, 20000);
  assert.equal(lateSending.phase, 'failed');
  assert.equal(lateSending.failure?.code, 'EDITOR_BUSY');

  // Submitting past deadline -> SUBMIT_UNCONFIRMED
  const talkSubmitting = { ...talkQueued, phase: 'submitting' as const, phaseDeadlineAt: 20000 };
  const lateSubmitting = transition(talkSubmitting, { type: 'SUBMIT_CONFIRMED', sentAt: 10000 }, 25000);
  assert.equal(lateSubmitting.phase, 'failed');
  assert.equal(lateSubmitting.failure?.code, 'SUBMIT_UNCONFIRMED');
  assert.equal(lateSubmitting.failure?.maybeSent, true);

  // Waiting past deadline -> TIMEOUT_IDLE
  const talkWaiting = { ...talkQueued, phase: 'waiting' as const, phaseDeadlineAt: 35000, sentAt: 1000, lastGrowthAt: 1000 };
  const lateWaiting = transition(talkWaiting, { type: 'STREAM_COMPLETE', answerMarkdown: 'late' }, 40000);
  assert.equal(lateWaiting.phase, 'failed');
  assert.equal(lateWaiting.failure?.code, 'TIMEOUT_IDLE');

  // Extracting past deadline -> EXTRACT_FAILED
  const talkExtracting = { ...talkQueued, phase: 'extracting' as const, phaseDeadlineAt: 20000 };
  const lateExtracting = transition(talkExtracting, { type: 'STREAM_COMPLETE', answerMarkdown: 'late' }, 25000);
  assert.equal(lateExtracting.phase, 'failed');
  assert.equal(lateExtracting.failure?.code, 'EXTRACT_FAILED');
});

test('Talk State Machine - Terminal Immutability (done & failed are sealed)', () => {
  const t0 = 1700000000000;
  let doneTalk = createTalk('Test Done', t0);
  doneTalk = transition(doneTalk, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  doneTalk = transition(doneTalk, { type: 'SUBMITTING' }, t0 + 20);
  doneTalk = transition(doneTalk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  doneTalk = transition(doneTalk, { type: 'STREAM_COMPLETE', answerMarkdown: 'Answer' }, t0 + 40);

  assert.equal(doneTalk.phase, 'done');

  // Attempting late transitions on done talk must return talk unmodified
  const lateAttempt1 = transition(doneTalk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, t0 + 50);
  assert.equal(lateAttempt1, doneTalk);
  assert.equal(lateAttempt1.phase, 'done');

  const lateAttempt2 = transition(doneTalk, { type: 'TAB_RESOLVED', tabId: 99 }, t0 + 60);
  assert.equal(lateAttempt2, doneTalk);

  // Test failed state immutability
  let failedTalk = createTalk('Test Fail', t0);
  failedTalk = transition(failedTalk, { type: 'FAIL', code: 'NOT_SIGNED_IN' }, t0 + 10);
  assert.equal(failedTalk.phase, 'failed');
  assert.equal(failedTalk.failure?.code, 'NOT_SIGNED_IN');
  assert.equal(failedTalk.failure?.stage, 'send');
  assert.equal(failedTalk.phaseDeadlineAt, null);

  const lateAttempt3 = transition(failedTalk, { type: 'STREAM_COMPLETE', answerMarkdown: 'Late' }, t0 + 20);
  assert.equal(lateAttempt3, failedTalk);
  assert.equal(lateAttempt3.phase, 'failed');
});

test('Talk State Machine - Conservative stage categorization on failure', () => {
  const t0 = 1700000000000;

  // Failure during queued -> stage send
  const talk1 = transition(createTalk('T1', t0), { type: 'FAIL', code: 'NO_BRO_CHAT' }, t0 + 10);
  assert.equal(talk1.failure?.stage, 'send');
  assert.equal(talk1.failure?.maybeSent, false);

  // Failure during submitting -> stage send, maybeSent true
  let talk2 = createTalk('T2', t0);
  talk2 = transition(talk2, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  talk2 = transition(talk2, { type: 'SUBMITTING' }, t0 + 20);
  const failed2 = transition(talk2, { type: 'FAIL', code: 'SUBMIT_UNCONFIRMED' }, t0 + 30);
  assert.equal(failed2.failure?.stage, 'send');
  assert.equal(failed2.failure?.maybeSent, true);

  // Failure during waiting -> stage read
  let talk3 = createTalk('T3', t0);
  talk3 = transition(talk3, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  talk3 = transition(talk3, { type: 'SUBMITTING' }, t0 + 20);
  talk3 = transition(talk3, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  const failed3 = transition(talk3, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, t0 + 40);
  assert.equal(failed3.failure?.stage, 'read');
});

test('Talk State Machine - All 14 FailureCodes can transition to failed state', () => {
  const t0 = 1700000000000;
  const allCodes: FailureCode[] = [
    'NO_BRO_CHAT',
    'BRO_CHAT_MISSING',
    'NOT_SIGNED_IN',
    'INPUT_NOT_FOUND',
    'EDITOR_BUSY',
    'SUBMIT_UNCONFIRMED',
    'TIMEOUT_IDLE',
    'TIMEOUT_TOTAL',
    'QUOTA_EXHAUSTED',
    'TAB_UNRESPONSIVE',
    'TAB_CLOSED',
    'EXTRACT_FAILED',
    'INTERRUPTED',
    'INTERNAL'
  ];

  for (const code of allCodes) {
    const talk = createTalk(`Test ${code}`, t0);
    const failed = transition(talk, { type: 'FAIL', code }, t0 + 50);
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.failure?.code, code);
    assert.equal(failed.handoff?.status, 'pending');
    assert.equal(failed.phaseDeadlineAt, null);
  }
});

test('Talk State Machine - Disallowed transitions throw descriptive error', () => {
  const t0 = 1700000000000;
  const talk = createTalk('Invalid Transition Test', t0);

  // Cannot jump from queued straight to STREAM_COMPLETE
  assert.throws(
    () => transition(talk, { type: 'STREAM_COMPLETE', answerMarkdown: 'test' }, t0 + 10),
    /Invalid Talk transition/
  );

  // Cannot jump from queued straight to SUBMIT_CONFIRMED
  assert.throws(
    () => transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 10 }, t0 + 10),
    /Invalid Talk transition/
  );
});
