// src/popup/view-state.ts
// Pure, display-only view model for T2 (sending / waiting). Reads Talk fields; never changes timeouts or phases.
import type { FailureCode, Talk, TalkHandoff } from '../shared/types.ts';
import { getFailureInfo } from '../shared/failures.ts';

// Mirrors tick.ts (TOTAL_TIMEOUT_MS / IDLE_TIMEOUT_MS) for display only.
export const HUD_PATIENCE_TOTAL_MS = 180_000;
export const HUD_SILENCE_TOTAL_MS = 30_000;

const SENDING_PHASES = ['queued', 'resolving_tab', 'sending', 'submitting'];
const WAITING_PHASES = ['waiting', 'extracting'];

export type SendViewKind = 'none' | 'sending' | 'reading';

export interface SendView {
  kind: SendViewKind;
  /** 已讀 is shown only once the user turn was confirmed (sentAt exists). */
  readReceipt: boolean;
  sentAt: number | null;
  narration: string;
  typing: boolean;
}

export interface HudMeter {
  elapsedMs: number;
  totalMs: number;
  /** 0..1, clamped */
  ratio: number;
  label: string;
}

export interface Hud {
  patience: HudMeter;
  silence: HudMeter;
}

export function sendViewOf(talk: Talk | null): SendView {
  const none: SendView = { kind: 'none', readReceipt: false, sentAt: null, narration: '', typing: false };
  if (!talk) return none;
  if (SENDING_PHASES.includes(talk.phase)) {
    return { kind: 'sending', readReceipt: false, sentAt: null, narration: '勇者 把訊息傳給惡龍……', typing: false };
  }
  if (WAITING_PHASES.includes(talk.phase)) {
    const hasSent = typeof talk.sentAt === 'number';
    return {
      kind: 'reading',
      readReceipt: hasSent,
      sentAt: hasSent ? (talk.sentAt as number) : null,
      narration: '惡龍 正在詠唱咒文……',
      typing: true
    };
  }
  return none;
}

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function meter(elapsed: number, total: number): HudMeter {
  const elapsedMs = Math.max(0, elapsed);
  return {
    elapsedMs,
    totalMs: total,
    ratio: Math.min(1, elapsedMs / total),
    label: `${formatClock(Math.min(elapsedMs, total))} / ${formatClock(total)}`
  };
}

/** HUD exists only once sentAt exists (state 2b). */
export function hudOf(talk: Talk | null, now: number): Hud | null {
  if (!talk || !WAITING_PHASES.includes(talk.phase) || typeof talk.sentAt !== 'number') return null;
  return {
    patience: meter(now - talk.sentAt, HUD_PATIENCE_TOTAL_MS),
    silence: meter(now - (talk.lastGrowthAt ?? talk.sentAt), HUD_SILENCE_TOTAL_MS)
  };
}

export function formatSentTime(sentAt: number): string {
  const d = new Date(sentAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface FailureView {
  /** RPG narration shown above (never replacing) userMessage. */
  narration: string;
  userMessage: string;
  badge: string;
  /** Handoff status line for done/partial; the clipboard success line only when copied === true. */
  handoffLine: string | null;
}

export const CLIPBOARD_COPIED_LINE = '勇者 使用了 剪貼簿！訊息已經複製。';
export const CLIPBOARD_NOT_COPIED_LINE = '已切換至惡龍分頁（剪貼簿未寫入，內容保留在輸入框）。';

export function failureNarrationOf(code: FailureCode): string {
  switch (code) {
    case 'TIMEOUT_IDLE':
    case 'TIMEOUT_TOTAL':
      return '惡龍 已讀不回……';
    case 'QUOTA_EXHAUSTED':
      return '惡龍今天見客太多。';
    case 'NOT_SIGNED_IN':
      return '勇者還沒登入，進不了城。';
    default:
      return '惡龍 無視了勇者……';
  }
}

export function failureViewOf(code: FailureCode, handoff?: TalkHandoff): FailureView {
  const info = getFailureInfo(code);
  const executed = handoff?.status === 'done' || handoff?.status === 'partial';
  return {
    narration: failureNarrationOf(code),
    userMessage: info.userMessage,
    badge: info.moodName,
    handoffLine: executed ? (handoff!.copied === true ? CLIPBOARD_COPIED_LINE : CLIPBOARD_NOT_COPIED_LINE) : null
  };
}

export interface PreviousSummary {
  /** First 40 characters of the previous Talk text. */
  text: string;
  at: number;
  /** First 3 non-empty lines of the previous answer, or null. Memory only. */
  answerLines: string[] | null;
}

export const PREVIOUS_TEXT_MAX_CHARS = 40;

/** T5: builds the in-memory 冒險之書 summary from the Talk being replaced; null when there is no previous Talk. */
export function previousSummaryOf(prev: Talk | null | undefined): PreviousSummary | null {
  if (!prev || typeof prev.text !== 'string' || prev.text.trim().length === 0) return null;
  const lines = (prev.answerMarkdown ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return {
    text: Array.from(prev.text.trim()).slice(0, PREVIOUS_TEXT_MAX_CHARS).join(''),
    at: prev.createdAt,
    answerLines: lines.length > 0 ? lines : null
  };
}

export const BUSY_NOTICE = '上一題還在處理中，請稍候';

export type SubmitOutcome =
  | { kind: 'accepted'; talk: Talk }
  | { kind: 'busy'; message: string }
  | { kind: 'none' };

/** #49: maps the SW reply to the one UI reaction. EMPTY and unknown replies do nothing. */
export function submitOutcomeOf(res: { accepted?: boolean; talk?: Talk; reason?: string } | null | undefined): SubmitOutcome {
  if (res?.accepted && res.talk) return { kind: 'accepted', talk: res.talk };
  if (res && res.accepted === false && res.reason === 'BUSY') return { kind: 'busy', message: BUSY_NOTICE };
  return { kind: 'none' };
}

export type DraftAction = 'show_talk_text' | 'clear' | 'keep';

const isBusyPhase = (t: Talk | null) => !!t && t.phase !== 'done' && t.phase !== 'failed';

/**
 * #49 draft rules. A busy Talk shows its in-flight text. The input is cleared once when this popup
 * sees busy become done/failed. Any other render never writes talk.text, so the user's draft survives.
 */
export function draftActionOf(wasBusy: boolean, next: Talk | null): DraftAction {
  if (!next) return 'keep';
  if (isBusyPhase(next)) return 'show_talk_text';
  return wasBusy ? 'clear' : 'keep';
}

/** #50: the composer is locked exactly while a Talk is in flight. */
export function isTalkBusy(talk: Talk | null | undefined): boolean {
  return isBusyPhase(talk ?? null);
}

/** #50: focus moves to the input only on a busy-to-terminal transition seen in this popup. */
export function shouldFocusInput(wasBusy: boolean, next: Talk | null): boolean {
  return draftActionOf(wasBusy, next) === 'clear';
}
