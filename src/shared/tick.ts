// src/shared/tick.ts
import type { Talk, ProbeResult } from './types.ts';

export const IDLE_TIMEOUT_MS = 30_000;
export const TOTAL_TIMEOUT_MS = 180_000;

/**
 * 32-bit FNV-1a hash for fast, collision-resistant text signature generation.
 */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeTextSignature(text: string): string {
  return `${text.length}:${fnv1a(text)}`;
}

export interface TickEvaluationResult {
  action:
    | 'continue'
    | 'complete'
    | 'timeout_idle'
    | 'timeout_total'
    | 'quota_exhausted'
    | 'signed_out'
    | 'wrong_chat';
  growth: boolean;
  newLength?: number;
  newSig?: string;
  nextConsecutiveDone: number;
}

/**
 * Pure function evaluating a single stream watchdog tick probe.
 *
 * Strict contract:
 * 1. Checks fatal page state / quota limits first.
 * 2. Accounts for probe text / signature growth BEFORE evaluating idle timeout.
 * 3. Requires two consecutive stable completed probes before returning 'complete'.
 * 4. Strictly enforces boundary timeouts:
 *    - total timeout: now - sentAt >= 180_000
 *    - idle timeout: now - lastGrowthAt >= 30_000
 */
export function evaluateTick(
  talk: Talk,
  probe: ProbeResult,
  now: number,
  consecutiveDoneCount = 0
): TickEvaluationResult {
  // 1. Catastrophic page states
  if (probe.page === 'signed_out') {
    return { action: 'signed_out', growth: false, nextConsecutiveDone: 0 };
  }
  if (probe.page === 'wrong_chat') {
    return { action: 'wrong_chat', growth: false, nextConsecutiveDone: 0 };
  }
  if (probe.quota) {
    return { action: 'quota_exhausted', growth: false, nextConsecutiveDone: 0 };
  }

  // 2. Growth detection (Accounted for BEFORE idle timeout evaluation)
  const previousChars = talk.streamedChars ?? 0;
  const previousSig = talk.lastSig ?? '';
  const currentChars = probe.textLength;
  const currentSig = probe.textSig;

  const hasGrowth = (currentChars > previousChars) || (currentSig !== previousSig && currentChars > 0);
  const effectiveLastGrowthAt = hasGrowth ? now : (talk.lastGrowthAt ?? talk.sentAt ?? now);

  // 3. Two consecutive stable signals check for completion
  let nextConsecutiveDone = consecutiveDoneCount;
  if (probe.turn === 'complete' && !probe.generating) {
    nextConsecutiveDone = hasGrowth ? 1 : consecutiveDoneCount + 1;
    if (nextConsecutiveDone >= 2) {
      return {
        action: 'complete',
        growth: hasGrowth,
        newLength: currentChars,
        newSig: currentSig,
        nextConsecutiveDone
      };
    }
  } else {
    nextConsecutiveDone = 0;
  }

  // 4. Exact deadline boundary operator checks
  if (talk.sentAt !== undefined && (now - talk.sentAt >= TOTAL_TIMEOUT_MS)) {
    return {
      action: 'timeout_total',
      growth: hasGrowth,
      newLength: currentChars,
      newSig: currentSig,
      nextConsecutiveDone
    };
  }

  if (now - effectiveLastGrowthAt >= IDLE_TIMEOUT_MS) {
    return {
      action: 'timeout_idle',
      growth: hasGrowth,
      newLength: currentChars,
      newSig: currentSig,
      nextConsecutiveDone
    };
  }

  return {
    action: 'continue',
    growth: hasGrowth,
    newLength: hasGrowth ? currentChars : undefined,
    newSig: hasGrowth ? currentSig : undefined,
    nextConsecutiveDone
  };
}
