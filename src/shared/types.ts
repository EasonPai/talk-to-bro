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

export type TalkStage = 'send' | 'read';

export interface TalkFailure {
  code: FailureCode;
  stage: TalkStage;
  at: number;
  maybeSent?: boolean;
}

export interface TalkHandoff {
  status: 'pending' | 'deferred' | 'done' | 'partial' | 'cancelled';
  copied: boolean;
  focused: boolean;
}

export interface Talk {
  id: string;                     // UUID
  text: string;                   // Original prompt text, un-trimmed
  phase: TalkPhase;
  createdAt: number;
  updatedAt: number;
  phaseDeadlineAt: number | null; // Null only when terminal (done or failed)
  sentAt?: number;                // Timestamp when user turn was confirmed
  lastGrowthAt?: number;          // Timestamp when response text growth was last seen
  lastSig?: string;               // Text signature: length + FNV-1a hash
  streamedChars?: number;         // Character count for Pip progress display
  doneStreak?: number;            // Consecutive stable complete probes; absent reads as 0
  tabId?: number;                 // Active Gemini tab ID
  answerMarkdown?: string;        // Extracted Markdown answer
  failure?: TalkFailure;          // Populated when phase === 'failed'
  handoff?: TalkHandoff;          // Populated when phase === 'failed'
}

export interface LogEntry {
  result: 'success' | 'send_failed' | 'read_failed';
  at: number;
}

export interface SettingsV1 {
  broChatUrl: string | null;
  updatedAt: number;
}

export interface RuntimeV1Storage {
  lastTalk: Talk | null;
  logByTalkId: Record<string, LogEntry>;
}

export interface SessionV1Storage {
  bootId: string;
  broTab?: {
    tabId: number;
    windowId: number;
  };
}

export interface DebugV1Storage {
  forceFailure?: FailureCode;
  verbose?: boolean;
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

// BroAdapter interfaces for runner decoupling
export type ReadyResult =
  | { ok: true; editorHasOwnText: boolean }
  | { ok: false; code: FailureCode };

export type SendResult =
  | { ok: true; sentAt?: number }
  | { ok: false; code: FailureCode };

export interface ProbeResult {
  page: 'ready' | 'signed_out' | 'wrong_chat' | 'loading';
  turn: 'not_found' | 'pending' | 'streaming' | 'complete';
  generating: boolean;    // Stop button is present
  textLength: number;     // Model turn length
  textSig: string;        // Length + FNV-1a hash
  quota: boolean;         // Quota limit hit
}

export type ExtractResult =
  | { markdown: string }
  | { error: 'EXTRACT_FAILED'; reason: string };

export interface BroAdapter {
  checkReady(a: { chatId: string; text: string }): Promise<ReadyResult>;
  send(a: { talkId: string; text: string }): Promise<SendResult>;
  probe(a: { talkId: string; text: string }): Promise<ProbeResult>;
  extract(a: { talkId: string; text: string }): Promise<ExtractResult>;
  selfCheck(): Promise<Record<string, boolean>>;
  showHandoffNotice(a: { message: string }): Promise<void>;
}

// TalkEvent for state machine
export type TalkEvent =
  | { type: 'TAB_RESOLVED'; tabId: number }
  | { type: 'INPUT_READY' }
  | { type: 'SUBMITTING' }
  | { type: 'SUBMIT_CONFIRMED'; sentAt: number }
  | { type: 'STREAMING_GROWTH'; textLength: number; textSig: string; lastGrowthAt: number }
  | { type: 'STREAM_COMPLETE'; answerMarkdown: string }
  | { type: 'FAIL'; code: FailureCode; maybeSent?: boolean };

// Tick evaluation
export type TickAction =
  | { action: 'continue'; growth: boolean; newSig?: string; newLength?: number; consecutiveDone: number }
  | { action: 'complete' }
  | { action: 'timeout_idle' }
  | { action: 'timeout_total' }
  | { action: 'quota_exhausted' }
  | { action: 'signed_out' }
  | { action: 'wrong_chat' };

// Talk stats
export interface TalkStats {
  total: number;
  successCount: number;
  sendFailedCount: number;
  readFailedCount: number;
  sentInRate: number | null;   // null when total === 0
  readBackRate: number | null; // null when (success + read_failed) === 0
  formattedSentInRate: string; // e.g. "19/20 (95.0%)" or "尚無樣本"
  formattedReadBackRate: string;
}

// UI state and persistence models for T-1
export type UiMode = 'popup' | 'sidepanel';

export interface UiState {
  mode: UiMode;
  draft: string;
  revision: number;
  acceptedTalkId?: string;
}

// Reconcile decision
export type ReconcileDecision =
  | { action: 'noop' }
  | { action: 'fail_interrupted'; reason: 'browser_restart' }
  | { action: 'restart_send'; fromPhase: 'resolving_tab' }
  | { action: 'verify_submit' }
  | { action: 'resume_wait' }
  | { action: 'resume_extract' };
