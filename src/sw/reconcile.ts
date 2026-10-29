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
 * 2. session is null (browser quit & restarted) -> active talk fails with INTERRUPTED (handoff: deferred).
 * 3. SW restart within same browser session:
 *    - queued/resolving_tab/sending -> restart_send from resolving_tab (safe; hasn't submitted yet).
 *    - submitting -> verify_submit (NEVER re-submit blindly; probe first to avoid duplicate sends).
 *    - waiting -> resume_wait (if not past 180s total timeout).
 *    - extracting -> resume_extract.
 */
export function reconcile(
  runtime: RuntimeV1Storage,
  session: SessionV1Storage | null,
  now: number
): ReconcileDecision {
  const talk: Talk | null = runtime.lastTalk;

  // 1. Terminal or non-existent talk requires no recovery
  if (!talk || talk.phase === 'done' || talk.phase === 'failed') {
    return { action: 'noop' };
  }

  // 2. Browser was restarted (session:v1 is empty / cleared by browser quit)
  if (!session || !session.bootId) {
    return { action: 'fail_interrupted', reason: 'browser_restart' };
  }

  // 3. Worker rebooted within active browser session
  switch (talk.phase) {
    case 'queued':
    case 'resolving_tab':
    case 'sending':
      return { action: 'restart_send', fromPhase: 'resolving_tab' };

    case 'submitting':
      // Never re-click send automatically. Probe user turn first.
      return { action: 'verify_submit' };

    case 'waiting': {
      // If 180s total deadline already passed while SW was asleep, let watchdog fail it
      if (talk.sentAt !== undefined && (now - talk.sentAt >= TOTAL_TIMEOUT_MS)) {
        return { action: 'resume_wait' };
      }
      return { action: 'resume_wait' };
    }

    case 'extracting':
      return { action: 'resume_extract' };
  }
}
