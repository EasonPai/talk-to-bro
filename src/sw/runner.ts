// src/sw/runner.ts
import type {
  Talk,
  BroAdapter,
  RuntimeV1Storage,
  SessionV1Storage,
  SettingsV1,
  FailureCode,
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
import { createTalk, transition } from '../shared/talk-machine.ts';
import { evaluateTick } from '../shared/tick.ts';
import { reconcile } from './reconcile.ts';
import { getBootReadyPromise } from './boot.ts';

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

  async boot(): Promise<void> {
    await getBootReadyPromise(this.storageSession);
    await this.reconcile();
  }

  async submit(text: string): Promise<{ accepted: boolean; talk?: Talk; reason?: string }> {
    return this.mutex.run(async () => {
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

      // Step 1: Create Talk in queued phase and write-ahead
      let talk = createTalk(text, now);
      await writeAheadTalk(this.storageLocal, talk);
      this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
      this.consecutiveDone = 0;

      try {
        // Step 2: Resolving Tab
        const tabId = 1001; // Mock tab ID in M2
        talk = transition(talk, { type: 'TAB_RESOLVED', tabId }, this.now());
        await writeAheadTalk(this.storageLocal, talk);

        // Step 3: Sending phase (checkReady)
        const ready = await this.adapter.checkReady({ chatId: 'mock-chat', text });
        if (!ready.ok) {
          talk = transition(talk, { type: 'FAIL', code: ready.code }, this.now());
          await finalizeTerminalTalk(this.storageLocal, talk, this.now());
          this.alarms?.clear('ttb-watchdog');
          return { accepted: true, talk };
        }

        // Step 4: Submitting phase (AWAIT WRITE-AHEAD PRIOR TO SEND ACTION)
        talk = transition(talk, { type: 'SUBMITTING' }, this.now());
        await writeAheadTalk(this.storageLocal, talk);

        // Now dispatch actual send
        const sendResult = await this.adapter.send({ talkId: talk.id, text });
        if (!sendResult.ok) {
          talk = transition(talk, { type: 'FAIL', code: sendResult.code }, this.now());
          await finalizeTerminalTalk(this.storageLocal, talk, this.now());
          this.alarms?.clear('ttb-watchdog');
          return { accepted: true, talk };
        }

        // Send confirmed
        const sentTime = this.now();
        talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: sentTime }, sentTime);
        await writeAheadTalk(this.storageLocal, talk);

        return { accepted: true, talk };
      } catch (err) {
        talk = transition(talk, { type: 'FAIL', code: 'INTERNAL' }, this.now());
        await finalizeTerminalTalk(this.storageLocal, talk, this.now());
        this.alarms?.clear('ttb-watchdog');
        return { accepted: true, talk };
      }
    });
  }

  async tick(): Promise<Talk | null> {
    return this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;

      if (!talk || talk.phase !== 'waiting') {
        return talk;
      }

      const probe = await this.adapter.probe({ talkId: talk.id, text: talk.text });
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
          return talk;

        case 'complete': {
          const extractResult = await this.adapter.extract({ talkId: talk.id, text: talk.text });
          if ('error' in extractResult) {
            talk = transition(talk, { type: 'FAIL', code: 'EXTRACT_FAILED' }, now);
            await finalizeTerminalTalk(this.storageLocal, talk, now);
          } else {
            talk = transition(talk, { type: 'STREAM_COMPLETE', answerMarkdown: extractResult.markdown }, now);
            await finalizeTerminalTalk(this.storageLocal, talk, now);
          }
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }

        case 'timeout_idle': {
          talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_IDLE' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }

        case 'timeout_total': {
          talk = transition(talk, { type: 'FAIL', code: 'TIMEOUT_TOTAL' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }

        case 'quota_exhausted': {
          talk = transition(talk, { type: 'FAIL', code: 'QUOTA_EXHAUSTED' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }

        case 'signed_out': {
          talk = transition(talk, { type: 'FAIL', code: 'NOT_SIGNED_IN' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }

        case 'wrong_chat': {
          talk = transition(talk, { type: 'FAIL', code: 'BRO_CHAT_MISSING' }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
          return talk;
        }
      }
    });
  }

  async reconcile(): Promise<ReconcileDecision> {
    return this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);
      const session = await getSessionStorage(this.storageSession);

      const decision = reconcile(runtime, session, now);
      let talk = runtime.lastTalk;

      if (!talk) return decision;

      if (decision.action === 'fail_interrupted') {
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
      } else if (decision.action === 'verify_submit') {
        const probe = await this.adapter.probe({ talkId: talk.id, text: talk.text });
        if (probe.turn === 'pending' || probe.turn === 'streaming' || probe.turn === 'complete') {
          talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: now }, now);
          await writeAheadTalk(this.storageLocal, talk);
        } else {
          talk = transition(talk, { type: 'FAIL', code: 'SUBMIT_UNCONFIRMED', maybeSent: true }, now);
          await finalizeTerminalTalk(this.storageLocal, talk, now);
          this.alarms?.clear('ttb-watchdog');
        }
      } else if (decision.action === 'restart_send') {
        // Safe to re-trigger from sending
        talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1001 }, now);
        await writeAheadTalk(this.storageLocal, talk);
      }

      return decision;
    });
  }
}
