// tests/unit/tick.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTick,
  fnv1a,
  computeTextSignature,
  IDLE_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS
} from '../../src/shared/tick.ts';
import { createTalk, transition } from '../../src/shared/talk-machine.ts';
import type { ProbeResult } from '../../src/shared/types.ts';

test('Stream Watchdog - FNV-1a hash and signature generation', () => {
  const hash1 = fnv1a('hello world');
  const hash2 = fnv1a('hello world');
  const hash3 = fnv1a('hello world!');

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 8);
  assert.equal(hash1, hash2, 'Identical strings must have identical FNV-1a hash');
  assert.notEqual(hash1, hash3, 'Different strings must produce different hashes');

  const sig = computeTextSignature('Sample Gemini output');
  assert.equal(sig, `20:${fnv1a('Sample Gemini output')}`);
});

test('Stream Watchdog - Growth evaluated BEFORE idle timeout', () => {
  const sentAt = 1700000000000;
  let talk = createTalk('Test Prompt', sentAt);
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, sentAt + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, sentAt + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt }, sentAt + 30);

  // Even if 35 seconds elapsed since sentAt, but text grew in this probe:
  // Growth is credited first and idle timeout must NOT fire!
  const now = sentAt + 35_000;
  const growthProbe: ProbeResult = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 100,
    textSig: computeTextSignature('A'.repeat(100)),
    quota: false
  };

  const res = evaluateTick(talk, growthProbe, now, 0);
  assert.equal(res.growth, true);
  assert.equal(res.action, 'continue', 'Growth must be accounted for before idle check');
  assert.equal(res.newLength, 100);
});

test('Stream Watchdog - Two consecutive stable complete signals required', () => {
  const sentAt = 1700000000000;
  let talk = createTalk('Test Completion', sentAt);
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, sentAt + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, sentAt + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt }, sentAt + 30);
  talk = transition(
    talk,
    { type: 'STREAMING_GROWTH', textLength: 80, textSig: computeTextSignature('B'.repeat(80)), lastGrowthAt: sentAt + 1000 },
    sentAt + 1000
  );

  const completeProbe: ProbeResult = {
    page: 'ready',
    turn: 'complete',
    generating: false,
    textLength: 80,
    textSig: computeTextSignature('B'.repeat(80)),
    quota: false
  };

  // 1st complete probe: should continue with nextConsecutiveDone = 1
  const tick1 = evaluateTick(talk, completeProbe, sentAt + 2000, 0);
  assert.equal(tick1.action, 'continue', 'First complete signal must not finalize');
  assert.equal(tick1.nextConsecutiveDone, 1);

  // 2nd complete probe (stable): should now trigger complete!
  const tick2 = evaluateTick(talk, completeProbe, sentAt + 3000, tick1.nextConsecutiveDone);
  assert.equal(tick2.action, 'complete', 'Second stable complete signal must declare completion');
  assert.equal(tick2.nextConsecutiveDone, 2);

  // Interruption check: if generating resumed between ticks, stability resets
  const generatingProbe: ProbeResult = {
    ...completeProbe,
    generating: true
  };
  const tickReset = evaluateTick(talk, generatingProbe, sentAt + 4000, tick1.nextConsecutiveDone);
  assert.equal(tickReset.action, 'continue');
  assert.equal(tickReset.nextConsecutiveDone, 0, 'Generating flag must reset consecutive count');
});

test('Stream Watchdog - Idle timeout exact boundary (29,999ms vs 30,000ms)', () => {
  const sentAt = 1700000000000;
  let talk = createTalk('Test Idle', sentAt);
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, sentAt + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, sentAt + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt }, sentAt + 30);

  const staticProbe: ProbeResult = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 0,
    textSig: '',
    quota: false
  };

  // 1ms before timeout: must continue
  const tick29999 = evaluateTick(talk, staticProbe, sentAt + IDLE_TIMEOUT_MS - 1, 0);
  assert.equal(tick29999.action, 'continue');

  // Exact 30,000ms: must trigger timeout_idle
  const tick30000 = evaluateTick(talk, staticProbe, sentAt + IDLE_TIMEOUT_MS, 0);
  assert.equal(tick30000.action, 'timeout_idle');
});

test('Stream Watchdog - Total timeout exact boundary (179,999ms vs 180,000ms)', () => {
  const sentAt = 1700000000000;
  let talk = createTalk('Test Total', sentAt);
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, sentAt + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, sentAt + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt }, sentAt + 30);
  // Keep refreshing lastGrowthAt so idle timeout never fires
  talk = transition(
    talk,
    { type: 'STREAMING_GROWTH', textLength: 10, textSig: '10:abc', lastGrowthAt: sentAt + 175_000 },
    sentAt + 175_000
  );

  const staticProbe: ProbeResult = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 10,
    textSig: '10:abc',
    quota: false
  };

  // 1ms before total timeout: must continue
  const tick179999 = evaluateTick(talk, staticProbe, sentAt + TOTAL_TIMEOUT_MS - 1, 0);
  assert.equal(tick179999.action, 'continue');

  // Exact 180,000ms: must trigger timeout_total
  const tick180000 = evaluateTick(talk, staticProbe, sentAt + TOTAL_TIMEOUT_MS, 0);
  assert.equal(tick180000.action, 'timeout_total');
});

test('Stream Watchdog - Fatal page states and quota limits', () => {
  const sentAt = 1700000000000;
  let talk = createTalk('Test Catastrophe', sentAt);
  talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, sentAt + 10);
  talk = transition(talk, { type: 'SUBMITTING' }, sentAt + 20);
  talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt }, sentAt + 30);

  // Signed out
  const signedOutProbe: ProbeResult = {
    page: 'signed_out',
    turn: 'not_found',
    generating: false,
    textLength: 0,
    textSig: '',
    quota: false
  };
  assert.equal(evaluateTick(talk, signedOutProbe, sentAt + 1000, 0).action, 'signed_out');

  // Wrong chat
  const wrongChatProbe: ProbeResult = {
    page: 'wrong_chat',
    turn: 'not_found',
    generating: false,
    textLength: 0,
    textSig: '',
    quota: false
  };
  assert.equal(evaluateTick(talk, wrongChatProbe, sentAt + 1000, 0).action, 'wrong_chat');

  // Quota hit
  const quotaProbe: ProbeResult = {
    page: 'ready',
    turn: 'streaming',
    generating: false,
    textLength: 10,
    textSig: '10:abc',
    quota: true
  };
  assert.equal(evaluateTick(talk, quotaProbe, sentAt + 1000, 0).action, 'quota_exhausted');
});
