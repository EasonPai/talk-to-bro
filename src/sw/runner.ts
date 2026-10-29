// src/sw/runner.ts
import type {
  Talk,
  BroAdapter,
  RuntimeV1Storage,
  SessionV1Storage,
  ReadyResult,
  SendResult,
  ExtractResult,
  ReconcileDecision
} from '../shared/types.ts';
import type { StorageAreaLike } from '../shared/storage.ts';
import {
  getRuntimeStorage,
  saveRuntimeStorage,
  getSessionStorage,
  getSettingsStorage,
  writeAheadTalk,
  finalizeTerminalTalk
} from '../shared/storage.ts';
import { createTalk, transition, phaseDeadlineOf, stageOf } from '../shared/talk-machine.ts';
import { evaluateTick } from '../shared/tick.ts';
import { reconcile } from './reconcile.ts';
import { getBootReadyPromise, type BootResult } from './boot.ts';

export interface AlarmsLike {
  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
  clear(name: string): Promise<boolean> | boolean;
}

export interface RunnerDeps {
  storageLocal: StorageAreaLike;
  storageSession: StorageAreaLike;
  adapter: BroAdapter;
  alarms?: AlarmsLike;
  clock?: () => number;
}

export class SerializedMutex {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const res = this.queue.then(() => fn());
    this.queue = res.catch(() => {});
    return res;
  }
}

export class TalkRunner {
  private storageLocal: StorageAreaLike;
  private storageSession: StorageAreaLike;
  private adapter: BroAdapter;
  private alarms?: AlarmsLike;
  private now: () => number;
  private mutex = new SerializedMutex();
  private consecutiveDone = 0;

  constructor(deps: RunnerDeps) {
    this.storageLocal = deps.storageLocal;
    this.storageSession = deps.storageSession;
    this.adapter = deps.adapter;
    this.alarms = deps.alarms;
    this.now = deps.clock || (() => Date.now());
  }

  getMutex(): SerializedMutex {
    return this.mutex;
  }

  async boot(): Promise<BootResult> {
    const bootResult = await getBootReadyPromise(this.storageSession);
    await this.reconcile(bootResult.isNewBrowserSession);
    return bootResult;
  }

  async submit(text: string): Promise<{ accepted: boolean; talk?: Talk; reason?: string }> {
    // Step 1: Atomic validation and talk initiation within mutex
    const initResult = await this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);

      // Check if already busy with non-terminal talk
      if (runtime.lastTalk && runtime.lastTalk.phase !== 'done' && runtime.lastTalk.phase !== 'failed') {
        return { accepted: false, reason: 'BUSY' };
      }

      if (!text || !text.trim()) {
        return { accepted: false, reason: 'EMPTY' };
      }

      const settings = await getSettingsStorage(this.storageLocal);
      if (!settings?.broChatUrl) {
        let talk = createTalk(text, now);
        talk = transition(talk, { type: 'FAIL', code: 'NO_BRO_CHAT' }, now);
        await finalizeTerminalTalk(this.storageLocal, talk, now);
        return { accepted: true, talk };
      }

      let talk = createTalk(text, now);
      await writeAheadTalk(this.storageLocal, talk);
      this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
      this.consecutiveDone = 0;
      return { accepted: true, talk };
    });

    if (!initResult.accepted || initResult.talk?.phase === 'failed') {
      return initResult;
    }

    const talkId = initResult.talk!.id;

    // Step 2: Resolving Tab -> Sending
    await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.id !== talkId || talk.phase !== 'queued') return;
      talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1001 }, this.now());
      await writeAheadTalk(this.storageLocal, talk);
    });

    // Step 3: checkReady outside mutex (bounded call)
    let ready: ReadyResult;
    try {
      ready = await this.adapter.checkReady({ chatId: 'mock-chat', text });
    } catch (e) {
      ready = { ok: false, code: 'INTERNAL' as const };
    }

    // Step 4: Inspect checkReady in mutex and advance to SUBMITTING
    const readyStepRes = await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.id !== talkId || talk.phase !== 'sending') return talk;

      if (!ready.ok) {
        talk = transition(talk, { type: 'FAIL', code: ready.code }, this.now());
        await finalizeTerminalTalk(this.storageLocal, talk, this.now());
        this.alarms?.clear('ttb-watchdog');
        return talk;
      }

      // AWAIT SUBMITTING WRITE-AHEAD PRIOR TO SEND ACTION DISPATCH
      talk = transition(talk, { type: 'SUBMITTING' }, this.now());
      await writeAheadTalk(this.storageLocal, talk);
      return talk;
    });

    if (!readyStepRes || readyStepRes.phase !== 'submitting') {
      return { accepted: true, talk: readyStepRes ?? undefined };
    }

    // Step 5: Dispatch send action outside mutex (bounded call)
    let sendResult: SendResult;
    try {
      sendResult = await this.adapter.send({ talkId, text });
    } catch (e) {
      sendResult = { ok: false, code: 'INTERNAL' as const };
    }

    // Step 6: Confirm send within mutex
    const confirmedTalk = await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.id !== talkId || talk.phase !== 'submitting') return talk;

      if (!sendResult.ok) {
        talk = transition(talk, { type: 'FAIL', code: sendResult.code }, this.now());
        await finalizeTerminalTalk(this.storageLocal, talk, this.now());
        this.alarms?.clear('ttb-watchdog');
        return talk;
      }

      const sentTime = this.now();
      talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: sentTime }, sentTime);
      await writeAheadTalk(this.storageLocal, talk);
      return talk;
    });

    return { accepted: true, talk: confirmedTalk ?? undefined };
  }

  async tick(): Promise<Talk | null> {
    // 1. Atomic read and deadline check within mutex
    const talkToProcess = await this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.phase === 'done' || talk.phase === 'failed') return null;

      // Phase deadline check during watchdog tick for non-waiting phases (waiting is governed by evaluateTick)
      if (talk.phase !== 'waiting' && talk.phaseDeadlineAt !== null && now > talk.phaseDeadlineAt) {
        talk = transition(
          talk,
          {
            type: 'FAIL',
            code: stageOf(talk.phase) === 'send' ? 'EDITOR_BUSY' : 'EXTRACT_FAILED'
          },
          now
        );
        await finalizeTerminalTalk(this.storageLocal, talk, now);
        this.alarms?.clear('ttb-watchdog');
        return talk;
      }

      if (talk.phase !== 'waiting' && talk.phase !== 'extracting') {
        return null;
      }
      return talk;
    });

    if (!talkToProcess) return null;
    if (talkToProcess.phase === 'failed' || talkToProcess.phase === 'done') {
      return talkToProcess;
    }

    // 2. Handle extracting phase
    if (talkToProcess.phase === 'extracting') {
      let extractResult: ExtractResult;
      try {
        extractResult = await this.adapter.extract({ talkId: talkToProcess.id, text: talkToProcess.text });
      } catch (e) {
        extractResult = { error: 'EXTRACT_FAILED', reason: 'Exception in extract' };
      }

      return this.mutex.run(async () => {
        const now = this.now();
        const runtime = await getRuntimeStorage(this.storageLocal);
        let talk = runtime.lastTalk;
        if (!talk || talk.id !== talkToProcess.id || talk.phase !== 'extracting') return talk;

        if ('error' in extractResult) {
          talk = transition(talk, { type: 'FAIL', code: 'EXTRACT_FAILED' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
        } else {
          talk = transition(talk, { type: 'STREAM_COMPLETE', answerMarkdown: extractResult.markdown }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
        }
        this.alarms?.clear('ttb-watchdog');
        return talk;
      });
    }

    // 3. Handle waiting phase (probe outside mutex)
    let probe;
    try {
      probe = await this.adapter.probe({ talkId: talkToProcess.id, text: talkToProcess.text });
    } catch (e) {
      probe = {
        page: 'ready' as const,
        turn: 'streaming' as const,
        generating: true,
        textLength: talkToProcess.streamedChars ?? 0,
        textSig: talkToProcess.lastSig ?? '',
        quota: false
      };
    }

    // 4. Evaluate probe within mutex
    const evaluatedAction = await this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.id !== talkToProcess.id || talk.phase !== 'waiting') return { action: 'noop' as const, talk };

      const evalResult = evaluateTick(talk, probe, now, this.consecutiveDone);
      this.consecutiveDone = evalResult.nextConsecutiveDone;

      if (evalResult.growth && evalResult.newLength !== undefined && evalResult.newSig !== undefined) {
        talk = transition(
          talk,
          {
            type: 'STREAMING_GROWTH',
            textLength: evalResult.newLength,
            textSig: evalResult.newSig,
            lastGrowthAt: now
          },
          now
        );
        await writeAheadTalk(this.storageLocal, talk);
      }

      switch (evalResult.action) {
        case 'continue':
          return { action: 'continue' as const, talk };

        case 'complete': {
          talk = {
            ...talk,
            phase: 'extracting',
            phaseDeadlineAt: phaseDeadlineOf('extracting', now)
          };
          await writeAheadTalk(this.storageLocal, talk);
          return { action: 'extract' as const, talk };
        }

        case 'timeout_idle': {
          talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return { action: 'terminal' as const, talk };
        }

        case 'timeout_total': {
          talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_TOTAL' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return { action: 'terminal' as const, talk };
        }

        case 'quota_exhausted': {
          talk = transition(talk, { type: 'FAIL', code: 'QUOTA_EXHAUSTED' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return { action: 'terminal' as const, talk };
        }

        case 'signed_out': {
          talk = transition(talk, { type: 'FAIL', code: 'NOT_SIGNED_IN' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return { action: 'terminal' as const, talk };
        }

        case 'wrong_chat': {
          talk = transition(talk, { type: 'FAIL', code: 'BRO_CHAT_MISSING' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return { action: 'terminal' as const, talk };
        }
      }
    });

    if (evaluatedAction.action === 'extract' && evaluatedAction.talk) {
      const talk = evaluatedAction.talk;
      let extractResult: ExtractResult;
      try {
        extractResult = await this.adapter.extract({ talkId: talk.id, text: talk.text });
      } catch (e) {
        extractResult = { error: 'EXTRACT_FAILED', reason: 'Extract failed' };
      }

      return this.mutex.run(async () => {
        const now = this.now();
        const runtime = await getRuntimeStorage(this.storageLocal);
        let t = runtime.lastTalk;
        if (!t || t.id !== talk.id || t.phase !== 'extracting') return t;

        if ('error' in extractResult) {
          t = transition(t, { type: 'FAIL', code: 'EXTRACT_FAILED' }, now);
          await finalizeTerminalTalk(this.storageLocal, t, now);
        } else {
          t = transition(t, { type: 'STREAM_COMPLETE', answerMarkdown: extractResult.markdown }, now);
          await finalizeTerminalTalk(this.storageLocal, t, now);
        }
        this.alarms?.clear('ttb-watchdog');
        return t;
      });
    }

    return evaluatedAction.talk;
  }

  async reconcile(isNewBrowserSession = false): Promise<ReconcileDecision> {
    const now = this.now();
    const decision = await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      const session = await getSessionStorage(this.storageSession);
      const d = reconcile(runtime, session, now, isNewBrowserSession);
      let talk = runtime.lastTalk;

      if (!talk || talk.phase === 'done' || talk.phase === 'failed') return d;

      if (d.action === 'fail_interrupted') {
        talk = transition(talk, { type: 'FAIL', code: 'INTERRUPTED' }, now);
        talk = {
          ...talk,
          handoff: {
            status: 'deferred',
            copied: false,
            focused: false
          }
        };
        await finalizeTerminalTalk(this.storageLocal, talk, now);
        this.alarms?.clear('ttb-watchdog');
      }
      return d;
    });

    if (decision.action === 'restart_send') {
      // Step A: If queued or resolving_tab, advance to sending
      await this.mutex.run(async () => {
        const runtime = await getRuntimeStorage(this.storageLocal);
        let talk = runtime.lastTalk;
        if (!talk || (talk.phase !== 'queued' && talk.phase !== 'resolving_tab')) return;
        talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1001 }, this.now());
        await writeAheadTalk(this.storageLocal, talk);
      });

      // Step B: If in sending, drive checkReady -> submitting -> send
      const runtime = await getRuntimeStorage(this.storageLocal);
      const talk = runtime.lastTalk;
      if (talk && talk.phase === 'sending') {
        let ready: ReadyResult;
        try {
          ready = await this.adapter.checkReady({ chatId: 'mock-chat', text: talk.text });
        } catch (e) {
          ready = { ok: false, code: 'INTERNAL' as const };
        }

        const advancedToSubmitting = await this.mutex.run(async () => {
          let t = (await getRuntimeStorage(this.storageLocal)).lastTalk;
          if (!t || t.id !== talk.id || t.phase !== 'sending') return false;

          if (!ready.ok) {
            t = transition(t, { type: 'FAIL', code: ready.code }, this.now());
            await finalizeTerminalTalk(this.storageLocal, t, this.now());
            this.alarms?.clear('ttb-watchdog');
            return false;
          }

          t = transition(t, { type: 'SUBMITTING' }, this.now());
          await writeAheadTalk(this.storageLocal, t);
          return true;
        });

        if (advancedToSubmitting) {
          let sendResult: SendResult;
          try {
            sendResult = await this.adapter.send({ talkId: talk.id, text: talk.text });
          } catch (e) {
            sendResult = { ok: false, code: 'INTERNAL' as const };
          }

          await this.mutex.run(async () => {
            let t = (await getRuntimeStorage(this.storageLocal)).lastTalk;
            if (!t || t.id !== talk.id || t.phase !== 'submitting') return;

            if (!sendResult.ok) {
              t = transition(t, { type: 'FAIL', code: sendResult.code }, this.now());
              await finalizeTerminalTalk(this.storageLocal, t, this.now());
              this.alarms?.clear('ttb-watchdog');
            } else {
              const sentTime = this.now();
              t = transition(t, { type: 'SUBMIT_CONFIRMED', sentAt: sentTime }, sentTime);
              await writeAheadTalk(this.storageLocal, t);
              this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
            }
          });
        }
      }
    } else if (decision.action === 'verify_submit') {
      const runtime = await getRuntimeStorage(this.storageLocal);
      const talk = runtime.lastTalk;
      if (talk) {
        let probe;
        try {
          probe = await this.adapter.probe({ talkId: talk.id, text: talk.text });
        } catch (e) {
          probe = { turn: 'not_found' as const };
        }

        await this.mutex.run(async () => {
          let t = (await getRuntimeStorage(this.storageLocal)).lastTalk;
          if (!t || t.id !== talk.id || t.phase !== 'submitting') return;

          if (probe.turn === 'pending' || probe.turn === 'streaming' || probe.turn === 'complete') {
            t = transition(t, { type: 'SUBMIT_CONFIRMED', sentAt: now }, now);
            await writeAheadTalk(this.storageLocal, t);
            this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
          } else {
            t = transition(t, { type: 'FAIL', code: 'SUBMIT_UNCONFIRMED', maybeSent: true }, now);
            await finalizeTerminalTalk(this.storageLocal, t, now);
            this.alarms?.clear('ttb-watchdog');
          }
        });
      }
    } else if (decision.action === 'resume_extract') {
      const runtime = await getRuntimeStorage(this.storageLocal);
      const talk = runtime.lastTalk;
      if (talk && talk.phase === 'extracting') {
        let extractResult: ExtractResult;
        try {
          extractResult = await this.adapter.extract({ talkId: talk.id, text: talk.text });
        } catch (e) {
          extractResult = { error: 'EXTRACT_FAILED', reason: 'Extract failed' };
        }

        await this.mutex.run(async () => {
          let t = (await getRuntimeStorage(this.storageLocal)).lastTalk;
          if (!t || t.id !== talk.id || t.phase !== 'extracting') return;

          if ('error' in extractResult) {
            t = transition(t, { type: 'FAIL', code: 'EXTRACT_FAILED' }, now);
            await finalizeTerminalTalk(this.storageLocal, t, now);
          } else {
            t = transition(t, { type: 'STREAM_COMPLETE', answerMarkdown: extractResult.markdown }, now);
            await finalizeTerminalTalk(this.storageLocal, t, now);
          }
          this.alarms?.clear('ttb-watchdog');
        });
      }
    } else if (decision.action === 'resume_wait') {
      this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
    }

    return decision;
  }
}
