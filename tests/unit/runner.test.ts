// tests/unit/runner.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TalkRunner } from '../../src/sw/runner.ts';
import { FakeAdapter, MemoryStorage, FakeAlarms } from '../helpers/fake-adapter.ts';
import { getRuntimeStorage, saveSettingsStorage } from '../../src/shared/storage.ts';
import { computeTextSignature } from '../../src/shared/tick.ts';
import type { ProbeResult } from '../../src/shared/types.ts';

import { resetBootForTesting } from '../../src/sw/boot.ts';

function createHarness() {
  resetBootForTesting();
  const storageLocal = new MemoryStorage();
  const storageSession = new MemoryStorage();
  const adapter = new FakeAdapter();
  const alarms = new FakeAlarms();
  let currentTime = 1700000000000;
  const clock = () => currentTime;

  const runner = new TalkRunner({
    storageLocal,
    storageSession,
    adapter,
    alarms,
    clock
  });

  return {
    runner,
    storageLocal,
    storageSession,
    adapter,
    alarms,
    getTime: () => currentTime,
    setTime: (t: number) => { currentTime = t; },
    advanceTime: (ms: number) => { currentTime += ms; }
  };
}

test('Talk Runner - Happy path execution with streaming, completion and storage persistence', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, {
    broChatUrl: 'https://gemini.google.com/app/4d870f290f0c5975',
    updatedAt: h.getTime()
  });
  await h.runner.boot();

  // 1. Submit prompt
  const subRes = await h.runner.submit('Tell me about ledger');
  assert.equal(subRes.accepted, true);
  assert.equal(subRes.talk?.phase, 'waiting');
  assert.equal(subRes.talk?.text, 'Tell me about ledger');
  assert.equal(h.adapter.checkReadyCalls, 1);
  assert.equal(h.adapter.sendCalls, 1);
  assert.ok(h.alarms.alarms.has('ttb-watchdog'), 'Watchdog alarm must be scheduled');

  // 2. First probe: Streaming chunk arrives
  h.advanceTime(2000);
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 40,
    textSig: computeTextSignature('Ledger is a financial book'),
    quota: false
  };
  let talk = await h.runner.tick();
  assert.equal(talk?.phase, 'waiting');
  assert.equal(talk?.streamedChars, 40);

  // 3. Second probe: Turn complete (1st complete signal)
  h.advanceTime(2000);
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'complete',
    generating: false,
    textLength: 80,
    textSig: computeTextSignature('Ledger is a financial book where all transactions are chronologically recorded.'),
    quota: false
  };
  talk = await h.runner.tick();
  assert.equal(talk?.phase, 'waiting', 'Must wait for 2nd stable complete signal');

  // 4. Third probe: Stable complete signal (2nd signal) -> Extracts answer & finalizes!
  h.advanceTime(1000);
  talk = await h.runner.tick();
  assert.equal(talk?.phase, 'done');
  assert.equal(talk?.answerMarkdown, '## Hello Bro\n\nThis is the markdown answer from Fake Bro.');
  assert.equal(talk?.phaseDeadlineAt, null);
  assert.equal(h.adapter.extractCalls, 1);
  assert.equal(h.alarms.alarms.has('ttb-watchdog'), false, 'Watchdog alarm must be cleared on completion');

  // 5. Verify runtime storage & log persistence
  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.lastTalk?.phase, 'done');
  assert.equal(runtime.logByTalkId[talk!.id]?.result, 'success');
});

test('Talk Runner - Busy rejection when talk is active', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, {
    broChatUrl: 'https://gemini.google.com/app/test',
    updatedAt: h.getTime()
  });

  const res1 = await h.runner.submit('Talk 1');
  assert.equal(res1.accepted, true);

  // Attempting second talk while first is in 'waiting' phase
  const res2 = await h.runner.submit('Talk 2');
  assert.equal(res2.accepted, false);
  assert.equal(res2.reason, 'BUSY');
});

test('Talk Runner - Input validation rejection', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, {
    broChatUrl: 'https://gemini.google.com/app/test',
    updatedAt: h.getTime()
  });

  const resEmpty = await h.runner.submit('   ');
  assert.equal(resEmpty.accepted, false);
  assert.equal(resEmpty.reason, 'EMPTY');
});

test('Talk Runner - Immediate failure when broChatUrl is missing', async () => {
  const h = createHarness();
  // settings has no broChatUrl
  const res = await h.runner.submit('Prompt without settings');
  assert.equal(res.accepted, true);
  assert.equal(res.talk?.phase, 'failed');
  assert.equal(res.talk?.failure?.code, 'NO_BRO_CHAT');
  assert.equal(res.talk?.failure?.stage, 'send');
});

test('Talk Runner - Adapter send-stage failures', async () => {
  // Test checkReady failure: NOT_SIGNED_IN
  const h1 = createHarness();
  await saveSettingsStorage(h1.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  h1.adapter.checkReadyResult = { ok: false, code: 'NOT_SIGNED_IN' };
  const res1 = await h1.runner.submit('Test not signed in');
  assert.equal(res1.talk?.phase, 'failed');
  assert.equal(res1.talk?.failure?.code, 'NOT_SIGNED_IN');
  assert.equal(res1.talk?.failure?.stage, 'send');

  // Test send dispatch failure: EDITOR_BUSY
  const h2 = createHarness();
  await saveSettingsStorage(h2.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  h2.adapter.sendResult = { ok: false, code: 'EDITOR_BUSY' };
  const res2 = await h2.runner.submit('Test editor busy');
  assert.equal(res2.talk?.phase, 'failed');
  assert.equal(res2.talk?.failure?.code, 'EDITOR_BUSY');
  assert.equal(res2.talk?.failure?.stage, 'send');
});

test('Talk Runner - Stream Watchdog idle timeout failure', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.submit('Test idle timeout');

  // Static probe (no growth)
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 0,
    textSig: '',
    quota: false
  };

  // Advance time past 30,000ms idle threshold
  h.advanceTime(30_001);
  const talk = await h.runner.tick();
  assert.equal(talk?.phase, 'failed');
  assert.equal(talk?.failure?.code, 'TIMEOUT_IDLE');
  assert.equal(talk?.failure?.stage, 'read');

  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.logByTalkId[talk!.id]?.result, 'read_failed');
  assert.equal(h.alarms.alarms.has('ttb-watchdog'), false);
});

test('Talk Runner - Stream Watchdog total timeout failure', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.submit('Test total timeout');

  // Continuously advance and simulate tiny increments so idle timeout doesn't fire, until 180s total
  h.advanceTime(180_001);
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 5,
    textSig: '5:xyz',
    quota: false
  };

  const talk = await h.runner.tick();
  assert.equal(talk?.phase, 'failed');
  assert.equal(talk?.failure?.code, 'TIMEOUT_TOTAL');
  assert.equal(talk?.failure?.stage, 'read');
});

test('Talk Runner - Stream Watchdog quota and catastrophic failures', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.submit('Test quota failure');

  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: false,
    textLength: 0,
    textSig: '',
    quota: true
  };

  const talk = await h.runner.tick();
  assert.equal(talk?.phase, 'failed');
  assert.equal(talk?.failure?.code, 'QUOTA_EXHAUSTED');
});

test('Talk Runner - Extract failure during completion', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.submit('Test extract failure');

  h.adapter.extractResult = { error: 'EXTRACT_FAILED', reason: 'DOM corrupted' };
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'complete',
    generating: false,
    textLength: 50,
    textSig: computeTextSignature('complete text'),
    quota: false
  };

  // Signal 1
  await h.runner.tick();
  // Signal 2 (triggers extract -> failure)
  const talk = await h.runner.tick();
  assert.equal(talk?.phase, 'failed');
  assert.equal(talk?.failure?.code, 'EXTRACT_FAILED');
});

test('Talk Runner - Reconcile handles browser restart crash recovery', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.submit('Crash during talk');

  // Simulate browser restart: session storage cleared!
  await h.storageSession.clear();

  const decision = await h.runner.reconcile();
  assert.equal(decision.action, 'fail_interrupted');

  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.lastTalk?.phase, 'failed');
  assert.equal(runtime.lastTalk?.failure?.code, 'INTERRUPTED');
  assert.equal(runtime.lastTalk?.handoff?.status, 'deferred', 'Handoff must be deferred on browser restart');
});

test('Talk Runner - Reconcile submitting phase probe check prevents duplicate sends', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.boot();

  // Manually put talk in submitting phase (as if SW crashed right after clicking send)
  const now = h.getTime();
  let talk = {
    id: 'talk-crash-submitting',
    text: 'Crash in submitting',
    phase: 'submitting' as const,
    createdAt: now,
    updatedAt: now,
    phaseDeadlineAt: now + 15000
  };
  await h.storageLocal.set({ 'runtime:v1': { lastTalk: talk, logByTalkId: {} } });

  // Scenario A: Probe indicates turn was submitted (pending/streaming)
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 10,
    textSig: '10:abc',
    quota: false
  };

  const decisionA = await h.runner.reconcile();
  assert.equal(decisionA.action, 'verify_submit');
  const runtimeA = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtimeA.lastTalk?.phase, 'waiting', 'Must advance to waiting without duplicate send');
  assert.equal(h.adapter.sendCalls, 0, 'Must NOT re-dispatch send');

  // Scenario B: Probe indicates turn was NOT found -> conservatively fail with SUBMIT_UNCONFIRMED
  talk.phase = 'submitting';
  await h.storageLocal.set({ 'runtime:v1': { lastTalk: talk, logByTalkId: {} } });
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'not_found',
    generating: false,
    textLength: 0,
    textSig: '',
    quota: false
  };

  const decisionB = await h.runner.reconcile();
  assert.equal(decisionB.action, 'verify_submit');
  const runtimeB = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtimeB.lastTalk?.phase, 'failed');
  assert.equal(runtimeB.lastTalk?.failure?.code, 'SUBMIT_UNCONFIRMED');
  assert.equal(runtimeB.lastTalk?.failure?.maybeSent, true);
  assert.equal(h.adapter.sendCalls, 0, 'Must NEVER re-dispatch send blindly');
});

test('Talk Runner - Edge cases: mutex, non-waiting tick, signed_out, wrong_chat, restart_send and internal error', async () => {
  const h = createHarness();
  assert.ok(h.runner.getMutex());

  // Tick when no talk exists
  const noTalk = await h.runner.tick();
  assert.equal(noTalk, null);

  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.boot();

  // Tick when probe returns signed_out
  await h.runner.submit('Probe signed out');
  h.adapter.defaultProbe = { page: 'signed_out', turn: 'not_found', generating: false, textLength: 0, textSig: '', quota: false };
  const signedOutTalk = await h.runner.tick();
  assert.equal(signedOutTalk?.phase, 'failed');
  assert.equal(signedOutTalk?.failure?.code, 'NOT_SIGNED_IN');

  // Tick when probe returns wrong_chat
  const hWrong = createHarness();
  await saveSettingsStorage(hWrong.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await hWrong.runner.boot();
  await hWrong.runner.submit('Probe wrong chat');
  hWrong.adapter.defaultProbe = { page: 'wrong_chat', turn: 'not_found', generating: false, textLength: 0, textSig: '', quota: false };
  const wrongChatTalk = await hWrong.runner.tick();
  assert.equal(wrongChatTalk?.phase, 'failed');
  assert.equal(wrongChatTalk?.failure?.code, 'BRO_CHAT_MISSING');

  // Reconcile restart_send from queued phase
  const hQueued = createHarness();
  await saveSettingsStorage(hQueued.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await hQueued.runner.boot();
  const queuedTalk = { id: 'talk-queued', text: 'queued', phase: 'queued' as const, createdAt: 1, updatedAt: 1, phaseDeadlineAt: 5000 };
  await hQueued.storageLocal.set({ 'runtime:v1': { lastTalk: queuedTalk, logByTalkId: {} } });
  const recDecision = await hQueued.runner.reconcile();
  assert.equal(recDecision.action, 'restart_send');
  const queuedRuntime = await getRuntimeStorage(hQueued.storageLocal);
  assert.equal(queuedRuntime.lastTalk?.phase, 'sending');

  // Submit throws unexpected error in adapter -> catches and marks INTERNAL
  const hThrow = createHarness();
  await saveSettingsStorage(hThrow.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await hThrow.runner.boot();
  hThrow.adapter.checkReady = async () => { throw new Error('Explosion'); };
  const throwRes = await hThrow.runner.submit('Unexpected error');
  assert.equal(throwRes.talk?.phase, 'failed');
  assert.equal(throwRes.talk?.failure?.code, 'INTERNAL');
});
