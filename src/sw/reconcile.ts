// src/sw/reconcile.ts
import type {
  RuntimeV1Storage,
  SessionV1Storage,
  ReconcileDecision,
  Talk
} from '../shared/types.ts';
import { TOTAL_TIMEOUT_MS } from '../shared/tick.ts';

/**
 * Pure decision matrix for startup / wake reconciliation:
 *
 * Scenarios:
 * 1. Terminal or no active talk -> noop.
 * 2. isNewBrowserSession is true OR session is null (browser quit & restarted)
 *    -> active talk fails with INTERRUPTED (handoff: deferred).
 * 3. Worker rebooted within active browser session:
 *    - queued/resolving_tab -> restart_send from resolving_tab.
 *    - sending -> restart_send from sending.
 *    - submitting -> verify_submit (NEVER re-submit blindly; probe first to avoid duplicate sends).
 *    - waiting -> resume_wait.
 *    - extracting -> resume_extract.
 */
export function reconcile(
  runtime: RuntimeV1Storage,
  session: SessionV1Storage | null,
  now: number,
  isNewBrowserSession = false
): ReconcileDecision {
  const talk: Talk | null = runtime.lastTalk;

  // 1. Terminal or non-existent talk requires no recovery
  if (!talk || talk.phase === 'done' || talk.phase === 'failed') {
    return { action: 'noop' };
  }

  // 2. Browser was restarted (session was empty at boot or isNewBrowserSession is true)
  if (isNewBrowserSession || !session || !session.bootId) {
    return { action: 'fail_interrupted', reason: 'browser_restart' };
  }

  // 3. Worker rebooted within active browser session
  switch (talk.phase) {
    case 'queued':
    case 'resolving_tab':
      return { action: 'restart_send', fromPhase: 'resolving_tab' };

    case 'sending':
      return { action: 'restart_send', fromPhase: 'resolving_tab' };

    case 'submitting':
      // Never re-click send automatically. Probe user turn first.
      return { action: 'verify_submit' };

    case 'waiting':
      return { action: 'resume_wait' };

    case 'extracting':
      return { action: 'resume_extract' };
  }
}
