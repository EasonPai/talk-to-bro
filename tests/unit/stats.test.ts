// tests/unit/stats.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../../src/shared/stats.ts';
import type { LogEntry } from '../../src/shared/types.ts';

test('Talk Log Stats - Zero division handling for empty log', () => {
  const emptyLog: Record<string, LogEntry> = {};
  const stats = computeStats(emptyLog);

  assert.equal(stats.total, 0);
  assert.equal(stats.successCount, 0);
  assert.equal(stats.sendFailedCount, 0);
  assert.equal(stats.readFailedCount, 0);
  assert.equal(stats.sentInRate, null, 'sentInRate must be null when total is 0');
  assert.equal(stats.readBackRate, null, 'readBackRate must be null when denominator is 0');
  assert.equal(stats.formattedSentInRate, '尚無樣本');
  assert.equal(stats.formattedReadBackRate, '尚無樣本');
});

test('Talk Log Stats - 100% Success rate', () => {
  const log: Record<string, LogEntry> = {
    't-1': { result: 'success', at: 1000 },
    't-2': { result: 'success', at: 2000 },
    't-3': { result: 'success', at: 3000 }
  };
  const stats = computeStats(log);

  assert.equal(stats.total, 3);
  assert.equal(stats.successCount, 3);
  assert.equal(stats.sentInRate, 1.0);
  assert.equal(stats.readBackRate, 1.0);
  assert.equal(stats.formattedSentInRate, '3/3 (100.0%)');
  assert.equal(stats.formattedReadBackRate, '3/3 (100.0%)');
});

test('Talk Log Stats - Accurate ratio calculations with mixed results', () => {
  // Scenario: 7 success, 1 read_failed, 2 send_failed (total 10)
  const log: Record<string, LogEntry> = {
    't-1': { result: 'success', at: 1 },
    't-2': { result: 'success', at: 2 },
    't-3': { result: 'success', at: 3 },
    't-4': { result: 'success', at: 4 },
    't-5': { result: 'success', at: 5 },
    't-6': { result: 'success', at: 6 },
    't-7': { result: 'success', at: 7 },
    't-8': { result: 'read_failed', at: 8 },
    't-9': { result: 'send_failed', at: 9 },
    't-10': { result: 'send_failed', at: 10 }
  };

  const stats = computeStats(log);
  assert.equal(stats.total, 10);
  assert.equal(stats.successCount, 7);
  assert.equal(stats.readFailedCount, 1);
  assert.equal(stats.sendFailedCount, 2);

  // 送得進率 = (7 + 1) / 10 = 0.8 (80.0%)
  assert.equal(stats.sentInRate, 0.8);
  assert.equal(stats.formattedSentInRate, '8/10 (80.0%)');

  // 讀得回率 = 7 / (7 + 1) = 0.875 (87.5%)
  assert.equal(stats.readBackRate, 0.875);
  assert.equal(stats.formattedReadBackRate, '7/8 (87.5%)');
});

test('Talk Log Stats - Zero read denominator with only send failures', () => {
  const log: Record<string, LogEntry> = {
    't-1': { result: 'send_failed', at: 1 },
    't-2': { result: 'send_failed', at: 2 },
    't-3': { result: 'send_failed', at: 3 }
  };

  const stats = computeStats(log);
  assert.equal(stats.total, 3);
  assert.equal(stats.successCount, 0);
  assert.equal(stats.sendFailedCount, 3);
  assert.equal(stats.readFailedCount, 0);

  // 送得進率 = 0 / 3 = 0.0%
  assert.equal(stats.sentInRate, 0);
  assert.equal(stats.formattedSentInRate, '0/3 (0.0%)');

  // 讀得回率 denominator is 0 (0 success + 0 read_failed) -> null / 尚無樣本
  assert.equal(stats.readBackRate, null);
  assert.equal(stats.formattedReadBackRate, '尚無樣本');
});
