// tests/unit/reconcile.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../../src/sw/reconcile.ts';
import { initBoot, getBootReadyPromise, resetBootForTesting } from '../../src/sw/boot.ts';
import { createTalk, transition } from '../../src/shared/talk-machine.ts';
import { MemoryStorage } from '../helpers/fake-adapter.ts';
import type { RuntimeV1Storage, SessionV1Storage } from '../../src/shared/types.ts';

test('Reconcile - Noop when talk is null, done, or failed', () => {
  const t0 = 1700000000000;
  const session: SessionV1Storage = { bootId: 'boot-1' };

  // Null lastTalk
  assert.deepEqual(reconcile({ lastTalk: null, logByTalkId: {} }, session, t0), { action: 'noop' });

  // Done lastTalk
  let doneTalk = createTalk('Done', t0);
  doneTalk = transition(doneTalk, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  doneTalk = transition(doneTalk, { type: 'SUBMITTING' }, t0 + 20);
  doneTalk = transition(doneTalk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  doneTalk = transition(doneTalk, { type: 'STREAM_COMPLETE', answerMarkdown: 'ans' }, t0 + 40);
  assert.deepEqual(reconcile({ lastTalk: doneTalk, logByTalkId: {} }, session, t0 + 50), { action: 'noop' });

  // Failed lastTalk
  const failedTalk = transition(createTalk('Fail', t0), { type: 'FAIL', code: 'INTERNAL' }, t0 + 10);
  assert.deepEqual(reconcile({ lastTalk: failedTalk, logByTalkId: {} }, session, t0 + 50), { action: 'noop' });
});

test('Reconcile - Browser restart (empty session or isNewBrowserSession) transitions active talk to fail_interrupted', () => {
  const t0 = 1700000000000;
  const activeTalk = createTalk('Active during browser crash', t0);

  // session is null -> Chrome was closed and reopened
  const decision1 = reconcile({ lastTalk: activeTalk, logByTalkId: {} }, null, t0 + 500);
  assert.deepEqual(decision1, { action: 'fail_interrupted', reason: 'browser_restart' });

  // isNewBrowserSession is true even if session object exists
  const session: SessionV1Storage = { bootId: 'boot-new' };
  const decision2 = reconcile({ lastTalk: activeTalk, logByTalkId: {} }, session, t0 + 500, true);
  assert.deepEqual(decision2, { action: 'fail_interrupted', reason: 'browser_restart' });
});

test('Reconcile - Worker reboot within same browser session recovers correctly per phase', () => {
  const t0 = 1700000000000;
  const session: SessionV1Storage = { bootId: 'boot-active-session' };

  // 1. Queued -> restart_send from resolving_tab
  const queuedTalk = createTalk('Queued', t0);
  assert.deepEqual(
    reconcile({ lastTalk: queuedTalk, logByTalkId: {} }, session, t0 + 100, false),
    { action: 'restart_send', fromPhase: 'resolving_tab' }
  );

  // 2. Sending -> restart_send from resolving_tab
  let sendingTalk = transition(queuedTalk, { type: 'TAB_RESOLVED', tabId: 1 }, t0 + 10);
  assert.deepEqual(
    reconcile({ lastTalk: sendingTalk, logByTalkId: {} }, session, t0 + 100, false),
    { action: 'restart_send', fromPhase: 'resolving_tab' }
  );

  // 3. Submitting -> verify_submit (NEVER duplicate send!)
  let submittingTalk = transition(sendingTalk, { type: 'SUBMITTING' }, t0 + 20);
  assert.deepEqual(
    reconcile({ lastTalk: submittingTalk, logByTalkId: {} }, session, t0 + 100, false),
    { action: 'verify_submit' }
  );

  // 4. Waiting -> resume_wait
  let waitingTalk = transition(submittingTalk, { type: 'SUBMIT_CONFIRMED', sentAt: t0 + 30 }, t0 + 30);
  assert.deepEqual(
    reconcile({ lastTalk: waitingTalk, logByTalkId: {} }, session, t0 + 100, false),
    { action: 'resume_wait' }
  );

  // 5. Extracting -> resume_extract
  const extractingTalk = { ...waitingTalk, phase: 'extracting' as const };
  assert.deepEqual(
    reconcile({ lastTalk: extractingTalk, logByTalkId: {} }, session, t0 + 100, false),
    { action: 'resume_extract' }
  );
});

test('Boot Engine - Preserves bootId across SW restarts and handles singleton promise', async () => {
  resetBootForTesting();
  const sessionStorage = new MemoryStorage();

  // Fresh boot: creates new bootId
  const boot1 = await initBoot(sessionStorage);
  assert.ok(boot1.bootId);
  assert.equal(boot1.isNewBrowserSession, true);

  // Subsequent SW wake with existing session storage: retains same bootId
  const boot2 = await initBoot(sessionStorage);
  assert.equal(boot2.bootId, boot1.bootId, 'bootId must be preserved across SW restarts');
  assert.equal(boot2.isNewBrowserSession, false);

  // Singleton promise concurrency check
  resetBootForTesting();
  const [resA, resB] = await Promise.all([
    getBootReadyPromise(sessionStorage),
    getBootReadyPromise(sessionStorage)
  ]);
  assert.equal(resA.bootId, resB.bootId);
});
