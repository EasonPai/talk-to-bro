// src/shared/failures.ts
import type { FailureCode, Talk, TalkStage } from './types.ts';

export type FailureMood = '嚇到' | '已讀不回';
export type HeroState = 'door' | 'waiting' | 'boss_speaks' | 'scared' | 'ignored';

export interface FailureInfo {
  code: FailureCode;
  defaultStage: TalkStage;
  moodName: FailureMood;
  heroState: 'scared' | 'ignored';
  userMessage: string;
  retryable: boolean;
}

/**
 * Returns comprehensive metadata for any FailureCode.
 * Uses a strict switch with a compile-time TypeScript `never` exhaustiveness check.
 */
export function getFailureInfo(code: FailureCode): FailureInfo {
  switch (code) {
    case 'NO_BRO_CHAT':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '勇者還沒告訴惡龍在哪，先去設定 Bro Chat。',
        retryable: false
      };
    case 'BRO_CHAT_MISSING':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '惡龍搬家了，Bro Chat 網址好像失效。',
        retryable: true
      };
    case 'NOT_SIGNED_IN':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '你還沒登入 Google，勇者進不去。',
        retryable: true
      };
    case 'INPUT_NOT_FOUND':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '找不到惡龍的耳朵（Gemini 可能改版了）。',
        retryable: true
      };
    case 'EDITOR_BUSY':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '惡龍那邊正忙，勇者不敢打斷。',
        retryable: true
      };
    case 'SUBMIT_UNCONFIRMED':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '話好像沒遞到——也可能已經送出，先看一下有沒有重複再貼。',
        retryable: false
      };
    case 'TIMEOUT_IDLE':
      return {
        code,
        defaultStage: 'read',
        moodName: '已讀不回',
        heroState: 'ignored',
        userMessage: '惡龍 30 秒沒出聲。',
        retryable: true
      };
    case 'TIMEOUT_TOTAL':
      return {
        code,
        defaultStage: 'read',
        moodName: '已讀不回',
        heroState: 'ignored',
        userMessage: '等了 3 分鐘，惡龍還沒講完。',
        retryable: true
      };
    case 'QUOTA_EXHAUSTED':
      return {
        code,
        defaultStage: 'read',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '惡龍今天見客見太多（額度用完）。',
        retryable: false
      };
    case 'TAB_UNRESPONSIVE':
      return {
        code,
        defaultStage: 'read',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '惡龍的門被 Chrome 關起來了。',
        retryable: true
      };
    case 'TAB_CLOSED':
      return {
        code,
        defaultStage: 'read',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: 'Bro Chat 分頁被關掉了。',
        retryable: true
      };
    case 'EXTRACT_FAILED':
      return {
        code,
        defaultStage: 'read',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '惡龍講完了，但勇者抄不下來。',
        retryable: true
      };
    case 'INTERRUPTED':
      return {
        code,
        defaultStage: 'read',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: 'Chrome 重開，勇者半路被叫回來。',
        retryable: true
      };
    case 'INTERNAL':
      return {
        code,
        defaultStage: 'send',
        moodName: '嚇到',
        heroState: 'scared',
        userMessage: '勇者迷路了。',
        retryable: true
      };
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/**
 * Dynamically resolves the failure stage ('send' vs 'read') based on the actual Talk context.
 * As clarified by CTO, TAB_CLOSED, TAB_UNRESPONSIVE, INTERRUPTED, and INTERNAL can occur at either stage.
 */
export function stageOfFailure(
  talk: Partial<Pick<Talk, 'sentAt' | 'failure' | 'phase'>>,
  code: FailureCode
): TalkStage {
  if (talk.failure?.stage) {
    return talk.failure.stage;
  }
  if (talk.sentAt !== undefined) {
    return 'read';
  }
  if (talk.phase === 'waiting' || talk.phase === 'extracting') {
    return 'read';
  }
  return getFailureInfo(code).defaultStage;
}

/**
 * Derives the active hero (勇者) emotional / display state from the Talk state.
 */
export function heroStateOf(t: Talk | null): HeroState {
  if (!t) return 'door';
  if (t.phase === 'done') return 'boss_speaks';
  if (t.phase === 'failed') {
    return t.failure?.code.startsWith('TIMEOUT') ? 'ignored' : 'scared';
  }
  return 'waiting';
}
