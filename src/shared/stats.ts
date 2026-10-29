// src/shared/stats.ts
import type { LogEntry, TalkStats } from './types.ts';

/**
 * Pure function to compute Talk Log metrics according to PRD / Tech Spec F8:
 * - 送得進率 (sent-in rate) = (success + read_failed) / total
 * - 讀得回率 (read-back rate) = success / (success + read_failed)
 *
 * Guarantees:
 * - Zero-division safe: returns null and displays "尚無樣本" when denominator is 0.
 * - Active talk exclusion: only counts finalized entries in logByTalkId.
 */
export function computeStats(logByTalkId: Record<string, LogEntry>): TalkStats {
  const entries = Object.values(logByTalkId);
  const total = entries.length;

  let successCount = 0;
  let sendFailedCount = 0;
  let readFailedCount = 0;

  for (const entry of entries) {
    if (entry.result === 'success') successCount++;
    else if (entry.result === 'send_failed') sendFailedCount++;
    else if (entry.result === 'read_failed') readFailedCount++;
  }

  const sentInNumerator = successCount + readFailedCount;
  const sentInRate = total === 0 ? null : sentInNumerator / total;

  const readBackDenominator = successCount + readFailedCount;
  const readBackRate = readBackDenominator === 0 ? null : successCount / readBackDenominator;

  const formattedSentInRate =
    total === 0
      ? '尚無樣本'
      : `${sentInNumerator}/${total} (${(sentInRate! * 100).toFixed(1)}%)`;

  const formattedReadBackRate =
    readBackDenominator === 0
      ? '尚無樣本'
      : `${successCount}/${readBackDenominator} (${(readBackRate! * 100).toFixed(1)}%)`;

  return {
    total,
    successCount,
    sendFailedCount,
    readFailedCount,
    sentInRate,
    readBackRate,
    formattedSentInRate,
    formattedReadBackRate
  };
}
