// src/shared/types.ts

export type TalkPhase =
  | 'queued'
  | 'resolving_tab'
  | 'sending'
  | 'submitting'
  | 'waiting'
  | 'extracting'
  | 'done'
  | 'failed';

export type FailureCode =
  | 'NO_BRO_CHAT'
  | 'BRO_CHAT_MISSING'
  | 'NOT_SIGNED_IN'
  | 'INPUT_NOT_FOUND'
  | 'EDITOR_BUSY'
  | 'SUBMIT_UNCONFIRMED'
  | 'TIMEOUT_IDLE'
  | 'TIMEOUT_TOTAL'
  | 'QUOTA_EXHAUSTED'
  | 'TAB_UNRESPONSIVE'
  | 'TAB_CLOSED'
  | 'EXTRACT_FAILED'
  | 'INTERRUPTED'
  | 'INTERNAL';

export interface SettingsV1 {
  broChatUrl: string | null;
  updatedAt: number;
}

export interface BroChatRef {
  url: string;
  chatId: string;
  accountIndex?: number;
  gemId?: string;
}

export interface ValidateBroChatUrlResult {
  valid: boolean;
  normalizedUrl?: string;
  ref?: BroChatRef;
  error?:
    | 'EMPTY'
    | 'INVALID_URL'
    | 'INVALID_PROTOCOL'
    | 'INVALID_HOSTNAME'
    | 'HAS_CREDENTIALS'
    | 'MISSING_CHAT_ID';
  message?: string;
}
