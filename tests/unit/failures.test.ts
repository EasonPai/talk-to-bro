// tests/unit/failures.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFailureInfo,
  stageOfFailure,
  heroStateOf,
  type FailureInfo
} from '../../src/shared/failures.ts';
import type { FailureCode, Talk } from '../../src/shared/types.ts';

const ALL_14_FAILURE_CODES: FailureCode[] = [
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

test('Failures Matrix - All 14 FailureCodes are exhaustively mapped with exact messages & hero states', () => {
  assert.equal(ALL_14_FAILURE_CODES.length, 14);

  for (const code of ALL_14_FAILURE_CODES) {
    const info: FailureInfo = getFailureInfo(code);

    assert.equal(info.code, code);
    assert.ok(typeof info.userMessage === 'string' && info.userMessage.length > 5, `userMessage for ${code} must not be empty`);
    assert.ok(info.moodName === '嚇到' || info.moodName === '已讀不回', `moodName for ${code} must match spec`);
    assert.ok(info.heroState === 'scared' || info.heroState === 'ignored', `heroState for ${code} must match spec`);
    assert.equal(typeof info.retryable, 'boolean');

    // Timeout codes have moodName '已讀不回' and heroState 'ignored'
    if (code === 'TIMEOUT_IDLE' || code === 'TIMEOUT_TOTAL') {
      assert.equal(info.moodName, '已讀不回');
      assert.equal(info.heroState, 'ignored');
    } else {
      assert.equal(info.moodName, '嚇到');
      assert.equal(info.heroState, 'scared');
    }
  }
});

test('Failures Matrix - Dynamic stage resolution (stageOfFailure)', () => {
  // 1. Explicit failure.stage takes precedence
  const explicitTalk: Partial<Talk> = {
    failure: { code: 'TAB_CLOSED', stage: 'send', at: 1000 }
  };
  assert.equal(stageOfFailure(explicitTalk, 'TAB_CLOSED'), 'send');

  // 2. Sent Talk (sentAt present) resolves to 'read' stage even for codes with defaultStage 'send'
  const sentTalk: Partial<Talk> = {
    sentAt: 12345,
    phase: 'waiting'
  };
  assert.equal(stageOfFailure(sentTalk, 'INTERNAL'), 'read');
  assert.equal(stageOfFailure(sentTalk, 'TAB_CLOSED'), 'read');
  assert.equal(stageOfFailure(sentTalk, 'TAB_UNRESPONSIVE'), 'read');

  // 3. Unsent Talk (no sentAt, queued/sending) resolves to defaultStage or 'send'
  const unsentTalk: Partial<Talk> = {
    phase: 'sending'
  };
  assert.equal(stageOfFailure(unsentTalk, 'TAB_CLOSED'), 'read'); // defaultStage
  assert.equal(stageOfFailure(unsentTalk, 'INPUT_NOT_FOUND'), 'send');
});

test('Failures Matrix - heroStateOf derived states', () => {
  assert.equal(heroStateOf(null), 'door');

  const inFlightTalk = { phase: 'waiting' } as Talk;
  assert.equal(heroStateOf(inFlightTalk), 'waiting');

  const doneTalk = { phase: 'done' } as Talk;
  assert.equal(heroStateOf(doneTalk), 'boss_speaks');

  const timeoutTalk = {
    phase: 'failed',
    failure: { code: 'TIMEOUT_IDLE' as FailureCode, stage: 'read' as const, at: 1000 }
  } as Talk;
  assert.equal(heroStateOf(timeoutTalk), 'ignored');

  const quotaTalk = {
    phase: 'failed',
    failure: { code: 'QUOTA_EXHAUSTED' as FailureCode, stage: 'read' as const, at: 1000 }
  } as Talk;
  assert.equal(heroStateOf(quotaTalk), 'scared');
});
