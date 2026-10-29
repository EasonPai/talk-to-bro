// src/shared/talk-machine.ts
import type {
  Talk,
  TalkPhase,
  TalkStage,
  TalkEvent,
  FailureCode
} from './types.ts';
import { TOTAL_TIMEOUT_MS } from './tick.ts';

export const PHASE_DEADLINES_MS: Record<Exclude<TalkPhase, 'done' | 'failed'>, number> = {
  queued: 5_000,
  resolving_tab: 15_000,
  sending: 10_000,
  submitting: 15_000,
  waiting: 30_000,
  extracting: 10_000
};

export function stageOf(phase: TalkPhase): TalkStage {
  switch (phase) {
    case 'queued':
    case 'resolving_tab':
    case 'sending':
    case 'submitting':
      return 'send';
    case 'waiting':
    case 'extracting':
    case 'done':
    case 'failed':
      return 'read';
  }
}

export function phaseDeadlineOf(phase: TalkPhase, now: number): number | null {
  if (phase === 'done' || phase === 'failed') return null;
  return now + (PHASE_DEADLINES_MS[phase] ?? 10_000);
}

export function createTalk(text: string, now: number, id?: string): Talk {
  const talkId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `talk-${now}-${Math.random().toString(36).slice(2, 9)}`);
  return {
    id: talkId,
    text,
    phase: 'queued',
    createdAt: now,
    updatedAt: now,
    phaseDeadlineAt: phaseDeadlineOf('queued', now)
  };
}

export function transition(talk: Talk, event: TalkEvent, now: number): Talk {
  // Terminal states (done, failed) are immutable; drop late events
  if (talk.phase === 'done' || talk.phase === 'failed') {
    return talk;
  }

  // Any FAIL event transitions immediately to failed terminal state
  if (event.type === 'FAIL') {
    const stage = stageOf(talk.phase);
    return {
      ...talk,
      phase: 'failed',
      updatedAt: now,
      phaseDeadlineAt: null,
      failure: {
        code: event.code,
        stage,
        at: now,
        maybeSent: event.maybeSent ?? (talk.phase === 'submitting')
      },
      handoff: {
        status: 'pending',
        copied: false,
        focused: false
      }
    };
  }

  // Phase Deadline Enforcement (AC1 contract):
  // If current timestamp exceeds phaseDeadlineAt, reject late success transition and enter failed state
  if (talk.phaseDeadlineAt !== null && now > talk.phaseDeadlineAt) {
    let failureCode: FailureCode;
    switch (talk.phase) {
      case 'queued':
        failureCode = 'INTERNAL';
        break;
      case 'resolving_tab':
        failureCode = 'TAB_UNRESPONSIVE';
        break;
      case 'sending':
        failureCode = 'EDITOR_BUSY';
        break;
      case 'submitting':
        failureCode = 'SUBMIT_UNCONFIRMED';
        break;
      case 'waiting':
        failureCode = (talk.sentAt !== undefined && (now - talk.sentAt >= TOTAL_TIMEOUT_MS))
          ? 'TIMEOUT_TOTAL'
          : 'TIMEOUT_IDLE';
        break;
      case 'extracting':
        failureCode = 'EXTRACT_FAILED';
        break;
    }

    const stage = stageOf(talk.phase);
    return {
      ...talk,
      phase: 'failed',
      updatedAt: now,
      phaseDeadlineAt: null,
      failure: {
        code: failureCode,
        stage,
        at: now,
        maybeSent: talk.phase === 'submitting'
      },
      handoff: {
        status: 'pending',
        copied: false,
        focused: false
      }
    };
  }

  switch (talk.phase) {
    case 'queued': {
      if (event.type === 'TAB_RESOLVED') {
        return {
          ...talk,
          phase: 'sending',
          tabId: event.tabId,
          updatedAt: now,
          phaseDeadlineAt: phaseDeadlineOf('sending', now)
        };
      }
      break;
    }

    case 'resolving_tab': {
      if (event.type === 'TAB_RESOLVED') {
        return {
          ...talk,
          phase: 'sending',
          tabId: event.tabId,
          updatedAt: now,
          phaseDeadlineAt: phaseDeadlineOf('sending', now)
        };
      }
      break;
    }

    case 'sending': {
      if (event.type === 'SUBMITTING') {
        return {
          ...talk,
          phase: 'submitting',
          updatedAt: now,
          phaseDeadlineAt: phaseDeadlineOf('submitting', now)
        };
      }
      break;
    }

    case 'submitting': {
      if (event.type === 'SUBMIT_CONFIRMED') {
        return {
          ...talk,
          phase: 'waiting',
          sentAt: event.sentAt,
          lastGrowthAt: event.sentAt,
          streamedChars: 0,
          updatedAt: now,
          phaseDeadlineAt: phaseDeadlineOf('waiting', now)
        };
      }
      break;
    }

    case 'waiting': {
      if (event.type === 'STREAMING_GROWTH') {
        return {
          ...talk,
          streamedChars: event.textLength,
          lastSig: event.textSig,
          lastGrowthAt: event.lastGrowthAt,
          updatedAt: now,
          phaseDeadlineAt: phaseDeadlineOf('waiting', now)
        };
      }
      if (event.type === 'STREAM_COMPLETE') {
        return {
          ...talk,
          phase: 'done',
          answerMarkdown: event.answerMarkdown,
          updatedAt: now,
          phaseDeadlineAt: null
        };
      }
      break;
    }

    case 'extracting': {
      if (event.type === 'STREAM_COMPLETE') {
        return {
          ...talk,
          phase: 'done',
          answerMarkdown: event.answerMarkdown,
          updatedAt: now,
          phaseDeadlineAt: null
        };
      }
      break;
    }
  }

  // If transition was not handled, throw descriptive error to prevent silent corruption
  throw new Error(`Invalid Talk transition: event "${event.type}" is not allowed in phase "${talk.phase}"`);
}
