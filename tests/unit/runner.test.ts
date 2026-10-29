// tests/unit/runner.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TalkRunner } from '../../src/sw/runner.ts';
import { FakeAdapter, MemoryStorage, FakeAlarms } from '../helpers/fake-adapter.ts';
import { getRuntimeStorage, saveSettingsStorage, saveSessionStorage } from '../../src/shared/storage.ts';
import { computeTextSignature } from '../../src/shared/tick.ts';
import { resetBootForTesting } from '../../src/sw/boot.ts';
import type { ProbeResult } from '../../src/shared/types.ts';

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

test('Talk Runner - CTO Review Probe 1: Fresh browser boot via runner.boot() transitions active talk to INTERRUPTED', async () => {
  const h = createHarness();
  const t0 = 2000;
  h.setTime(t0);

  // Seed local runtime with a waiting Talk
  const waitingTalk = {
    id: 'talk-browser-crash',
    text: 'Waiting before crash',
    phase: 'waiting' as const,
    createdAt: t0 - 1000,
    updatedAt: t0 - 500,
    phaseDeadlineAt: t0 + 29500,
    sentAt: t0 - 500
  };
  await h.storageLocal.set({ 'runtime:v1': { lastTalk: waitingTalk, logByTalkId: {} } });

  // Leave session storage completely empty (as after browser restart)
  await h.storageSession.clear();
  resetBootForTesting();

  // Call real startup path runner.boot()!
  const bootResult = await h.runner.boot();
  assert.equal(bootResult.isNewBrowserSession, true, 'isNewBrowserSession must be true on fresh boot');

  // Assert talk transitioned to failed / INTERRUPTED with deferred handoff
  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.lastTalk?.phase, 'failed', 'Active talk must be failed on fresh browser boot');
  assert.equal(runtime.lastTalk?.failure?.code, 'INTERRUPTED');
  assert.equal(runtime.lastTalk?.handoff?.status, 'deferred');
  assert.equal(runtime.logByTalkId['talk-browser-crash']?.result, 'read_failed');
});

test('Talk Runner - CTO Review Probe 2: Same-session phase recovery drives pipeline forward', async () => {
  // Scenario 2A: Seed queued -> boot() drives through resolving, sending, submitting to waiting!
  const hA = createHarness();
  await saveSettingsStorage(hA.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await saveSessionStorage(hA.storageSession, { bootId: 'existing-session-boot-id' });
  const queuedTalk = {
    id: 'talk-recover-queued',
    text: 'Recover queued',
    phase: 'queued' as const,
    createdAt: hA.getTime(),
    updatedAt: hA.getTime(),
    phaseDeadlineAt: hA.getTime() + 5000
  };
  await hA.storageLocal.set({ 'runtime:v1': { lastTalk: queuedTalk, logByTalkId: {} } });

  await hA.runner.boot();
  assert.equal(hA.adapter.checkReadyCalls, 1, 'checkReady must be called');
  assert.equal(hA.adapter.sendCalls, 1, 'send must be dispatched to adapter on recover');
  const runtimeA = await getRuntimeStorage(hA.storageLocal);
  assert.equal(runtimeA.lastTalk?.phase, 'waiting');

  // Scenario 2B: Seed sending -> boot() does not throw and drives sendCalls=1
  const hB = createHarness();
  await saveSettingsStorage(hB.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await saveSessionStorage(hB.storageSession, { bootId: 'existing-session-boot-id' });
  const sendingTalk = {
    id: 'talk-recover-sending',
    text: 'Recover sending',
    phase: 'sending' as const,
    createdAt: hB.getTime(),
    updatedAt: hB.getTime(),
    phaseDeadlineAt: hB.getTime() + 10000,
    tabId: 1001
  };
  await hB.storageLocal.set({ 'runtime:v1': { lastTalk: sendingTalk, logByTalkId: {} } });

  await hB.runner.boot();
  assert.equal(hB.adapter.checkReadyCalls, 1);
  assert.equal(hB.adapter.sendCalls, 1);
  const runtimeB = await getRuntimeStorage(hB.storageLocal);
  assert.equal(runtimeB.lastTalk?.phase, 'waiting');

  // Scenario 2C: Seed extracting -> boot() drives extractCalls=1 and completes to done
  const hC = createHarness();
  await saveSettingsStorage(hC.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await saveSessionStorage(hC.storageSession, { bootId: 'existing-session-boot-id' });
  const extractingTalk = {
    id: 'talk-recover-extracting',
    text: 'Recover extracting',
    phase: 'extracting' as const,
    createdAt: hC.getTime(),
    updatedAt: hC.getTime(),
    phaseDeadlineAt: hC.getTime() + 10000
  };
  await hC.storageLocal.set({ 'runtime:v1': { lastTalk: extractingTalk, logByTalkId: {} } });

  await hC.runner.boot();
  assert.equal(hC.adapter.extractCalls, 1, 'extract must be executed on resume_extract');
  const runtimeC = await getRuntimeStorage(hC.storageLocal);
  assert.equal(runtimeC.lastTalk?.phase, 'done');
  assert.equal(runtimeC.logByTalkId['talk-recover-extracting']?.result, 'success');
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

  const decision = await h.runner.reconcile(true);
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
  const queuedTalk = { id: 'talk-queued', text: 'queued', phase: 'queued' as const, createdAt: hQueued.getTime(), updatedAt: hQueued.getTime(), phaseDeadlineAt: hQueued.getTime() + 5000 };
  await hQueued.storageLocal.set({ 'runtime:v1': { lastTalk: queuedTalk, logByTalkId: {} } });
  const recDecision = await hQueued.runner.reconcile();
  assert.equal(recDecision.action, 'restart_send');
  const queuedRuntime = await getRuntimeStorage(hQueued.storageLocal);
  assert.equal(queuedRuntime.lastTalk?.phase, 'waiting');

  // Submit throws unexpected error in adapter -> catches and marks INTERNAL
  const hThrow = createHarness();
  await saveSettingsStorage(hThrow.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await hThrow.runner.boot();
  hThrow.adapter.checkReady = async () => { throw new Error('Explosion'); };
  const throwRes = await hThrow.runner.submit('Unexpected error');
  assert.equal(throwRes.talk?.phase, 'failed');
  assert.equal(throwRes.talk?.failure?.code, 'INTERNAL');
});

test('Talk Runner - CTO Review Probe 4: Mutex Liveness & Watchdog non-waiting deadline enforcement', async () => {
  const h = createHarness();
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.boot();

  // Test 4A: Tick terminates talk stuck in sending past phaseDeadlineAt
  const stuckSendingTalk = {
    id: 'talk-stuck-sending',
    text: 'Stuck sending',
    phase: 'sending' as const,
    createdAt: h.getTime(),
    updatedAt: h.getTime(),
    phaseDeadlineAt: h.getTime() + 10000,
    tabId: 1001
  };
  await h.storageLocal.set({ 'runtime:v1': { lastTalk: stuckSendingTalk, logByTalkId: {} } });
  
  // Advance time past deadline
  h.advanceTime(10001);
  const expiredTalk = await h.runner.tick();
  assert.equal(expiredTalk?.phase, 'failed');
  assert.equal(expiredTalk?.failure?.code, 'EDITOR_BUSY');

  // Test 4B: External adapter awaiting never holds mutex - other mutex callers proceed immediately
  let adapterHangingResolve: () => void;
  const adapterPromise = new Promise<void>(resolve => { adapterHangingResolve = resolve; });
  h.adapter.send = async () => {
    await adapterPromise;
    return { ok: true, sentAt: h.getTime() };
  };

  // Submit starts, enters submitting, awaits send outside mutex
  const submitPromise = h.runner.submit('Send with delay');
  // Wait a microtask for submit to release mutex during send
  await new Promise(r => setTimeout(r, 10));

  // Verify mutex is free and getRuntimeStorage or mutex.run can execute immediately without waiting for send
  let probeRan = false;
  await h.runner.getMutex().run(async () => {
    probeRan = true;
  });
  assert.equal(probeRan, true, 'Mutex must not be locked during async adapter.send execution');

  // Unblock hanging adapter call
  adapterHangingResolve!();
  const submitRes = await submitPromise;
  assert.equal(submitRes.accepted, true);
  assert.equal(submitRes.talk?.phase, 'waiting');
});

test('Talk Runner - CTO Review 2 Probe 1: Growth at 31s refreshes idle deadline and does NOT fail TIMEOUT_IDLE', async () => {
  const h = createHarness();
  h.setTime(1000);
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.boot();
  const subRes = await h.runner.submit('Growth refresh test');
  assert.equal(subRes.accepted, true);
  assert.equal(subRes.talk?.phase, 'waiting');

  // Advance to 32000 (past initial 30s idle deadline) and provide probe with text growth
  h.setTime(32000);
  h.adapter.defaultProbe = {
    page: 'ready',
    turn: 'streaming',
    generating: true,
    textLength: 8,
    textSig: computeTextSignature('growth!!'),
    quota: false
  };

  const tickTalk = await h.runner.tick();
  assert.equal(tickTalk?.phase, 'waiting');
  assert.equal(tickTalk?.streamedChars, 8);
  assert.equal(tickTalk?.lastGrowthAt, 32000);
  // Idle deadline must be refreshed to 32000 + 30000 = 62000
  assert.equal(tickTalk?.phaseDeadlineAt, 62000);
});

test('Talk Runner - CTO Review 2 Probe 2: Hung probe never blocks absolute total timeout (TIMEOUT_TOTAL)', async () => {
  const h = createHarness();
  h.setTime(1000);
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await h.runner.boot();
  await h.runner.submit('Probe hung test');

  // Adapter probe returns a never-settling Promise
  h.adapter.probe = () => new Promise(() => {});

  // Advance time past 180s total timeout
  h.setTime(182000);

  const tickTalk = await h.runner.tick();
  assert.equal(tickTalk?.phase, 'failed');
  assert.equal(tickTalk?.failure?.code, 'TIMEOUT_TOTAL');
  assert.equal(tickTalk?.failure?.stage, 'read');

  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.lastTalk?.phase, 'failed');
  assert.equal(runtime.lastTalk?.failure?.code, 'TIMEOUT_TOTAL');
  assert.equal(runtime.logByTalkId[tickTalk!.id]?.result, 'read_failed');
});

test('Talk Runner - CTO Review 2 Probe 3: Late checkReady rejection on recovery does NOT dispatch send and atomically records to logByTalkId', async () => {
  const h = createHarness();
  h.setTime(1000);
  await saveSettingsStorage(h.storageLocal, { broChatUrl: 'https://gemini.google.com/app/test', updatedAt: 1 });
  await saveSessionStorage(h.storageSession, { bootId: 'existing-session-boot-id' });

  // Seed sending Talk with deadline 11000
  const sendingTalk = {
    id: 'talk-late-checkready',
    text: 'Late checkready recovery',
    phase: 'sending' as const,
    createdAt: 1000,
    updatedAt: 1000,
    phaseDeadlineAt: 11000,
    tabId: 1001
  };
  await h.storageLocal.set({ 'runtime:v1': { lastTalk: sendingTalk, logByTalkId: {} } });

  // checkReady resolves ok, but clock advances to 20000 during the async check
  h.adapter.checkReady = async () => {
    h.setTime(20000);
    return { ok: true, chatId: 'mock-chat' };
  };

  await h.runner.boot();

  // sendCalls must be 0 because transition to SUBMITTING rejected late execution
  assert.equal(h.adapter.sendCalls, 0, 'adapter.send must not be called when transition failed due to deadline');

  const runtime = await getRuntimeStorage(h.storageLocal);
  assert.equal(runtime.lastTalk?.phase, 'failed');
  assert.equal(runtime.lastTalk?.failure?.code, 'EDITOR_BUSY');
  assert.equal(runtime.lastTalk?.failure?.stage, 'send');

  // logByTalkId must be atomically populated with terminal outcome
  const logEntry = runtime.logByTalkId['talk-late-checkready'];
  assert.ok(logEntry, 'logByTalkId must contain finalized terminal entry');
  assert.equal(logEntry?.result, 'send_failed');
  assert.equal(logEntry?.at, 20000);
});
