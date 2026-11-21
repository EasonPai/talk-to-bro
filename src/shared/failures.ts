// src/shared/failures.ts
import type { FailureCode, Talk, TalkStage } from './types.ts';

export type FailureMood = '需要協助' | '暫無回應';
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
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '尚未設定 Bro Chat 網址，請先前往設定。',
        retryable: false
      };
    case 'BRO_CHAT_MISSING':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '找不到設定的 Bro Chat 分頁或網址已失效，請檢查設定。',
        retryable: true
      };
    case 'NOT_SIGNED_IN':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '尚未登入 Google 帳號，請先登入 Bro Chat。',
        retryable: true
      };
    case 'INPUT_NOT_FOUND':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '找不到 Gemini 輸入框（頁面可能已改版或尚未載入完成）。',
        retryable: true
      };
    case 'EDITOR_BUSY':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: 'Bro Chat 目前正在回覆中，請稍候再送出。',
        retryable: true
      };
    case 'SUBMIT_UNCONFIRMED':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '無法確認 Talk 是否已送出，請先切至 Bro Chat 檢查是否已有重複訊息。',
        retryable: false
      };
    case 'TIMEOUT_IDLE':
      return {
        code,
        defaultStage: 'read',
        moodName: '暫無回應',
        heroState: 'ignored',
        userMessage: 'Bro 超過 30 秒沒有新回覆。',
        retryable: true
      };
    case 'TIMEOUT_TOTAL':
      return {
        code,
        defaultStage: 'read',
        moodName: '暫無回應',
        heroState: 'ignored',
        userMessage: '等待超過 3 分鐘，Bro 尚未完成回覆。',
        retryable: true
      };
    case 'QUOTA_EXHAUSTED':
      return {
        code,
        defaultStage: 'read',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: 'Gemini 目前已達使用上限，請稍後再試。',
        retryable: false
      };
    case 'TAB_UNRESPONSIVE':
      return {
        code,
        defaultStage: 'read',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: 'Bro Chat 分頁暫時無回應，請檢查分頁狀態。',
        retryable: true
      };
    case 'TAB_CLOSED':
      return {
        code,
        defaultStage: 'read',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: 'Bro Chat 分頁已關閉。',
        retryable: true
      };
    case 'EXTRACT_FAILED':
      return {
        code,
        defaultStage: 'read',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: 'Bro 已完成回覆，但無法擷取內容，請切至 Bro Chat 查看。',
        retryable: true
      };
    case 'INTERRUPTED':
      return {
        code,
        defaultStage: 'read',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '瀏覽器已重啟，上一次的 Talk 尚未完成。',
        retryable: true
      };
    case 'INTERNAL':
      return {
        code,
        defaultStage: 'send',
        moodName: '需要協助',
        heroState: 'scared',
        userMessage: '發生未預期的內部錯誤，請稍後再試或前往 Bro Chat。',
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
 * Derives the active display state from the Talk state.
 */
export function heroStateOf(t: Talk | null): HeroState {
  if (!t) return 'door';
  if (t.phase === 'done') return 'boss_speaks';
  if (t.phase === 'failed') {
    return t.failure?.code.startsWith('TIMEOUT') ? 'ignored' : 'scared';
  }
  return 'waiting';
}
