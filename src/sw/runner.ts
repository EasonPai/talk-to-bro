// src/sw/runner.ts
import type {
  Talk,
  FailureCode,
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
import { evaluateTick, TOTAL_TIMEOUT_MS } from '../shared/tick.ts';
import { validateBroChatUrl } from '../shared/validate.ts';
import { reconcile } from './reconcile.ts';
import { getBootReadyPromise, type BootResult } from './boot.ts';
import { performHandoff, continueHandoffAfterPopupClose } from './handoff.ts';
import { getFailureInfo } from '../shared/failures.ts';
import type { DebugV1Storage } from '../shared/types.ts';
import type { TabsApiLike } from './tab.ts';

export interface AlarmsLike {
  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
  clear(name: string): Promise<boolean> | boolean;
}

export const FAST_PROBE_MS = 2000;

export interface FastTimersLike {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RunnerDeps {
  fastTimers?: FastTimersLike;
  storageLocal: StorageAreaLike;
  storageSession?: StorageAreaLike;
  adapter: BroAdapter;
  alarms?: AlarmsLike;
  clock?: () => number;
  tabsApi?: TabsApiLike;
  windowsApi?: any;
  runtimeApi?: any;
  offscreenApi?: any;
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
  private storageSession?: StorageAreaLike;
  private adapter: BroAdapter;
  private alarms?: AlarmsLike;
  private clock: () => number;
  private tabsApi?: TabsApiLike;
  private windowsApi?: any;
  private runtimeApi?: any;
  private offscreenApi?: any;
  private mutex = new SerializedMutex();
  private fastTimers?: FastTimersLike;
  private fastHandle: unknown = null;
  private fastTalkId: string | null = null;
  private tickInFlight = false;

  constructor(deps: RunnerDeps) {
    this.fastTimers = deps.fastTimers;
    this.storageLocal = deps.storageLocal;
    this.storageSession = deps.storageSession;
    this.adapter = deps.adapter;
    this.alarms = deps.alarms;
    this.clock = deps.clock || (() => Date.now());
    this.tabsApi = deps.tabsApi;
    this.windowsApi = deps.windowsApi;
    this.runtimeApi = deps.runtimeApi;
    this.offscreenApi = deps.offscreenApi;
  }

  now(): number {
    return this.clock();
  }

  private async handleFailure(talk: Talk, code: FailureCode, now: number, maybeSent?: boolean): Promise<Talk> {
    let failedTalk = transition(talk, { type: 'FAIL', code, maybeSent }, now);
    await finalizeTerminalTalk(this.storageLocal, failedTalk, now);
    this.alarms?.clear('ttb-watchdog');

    const handoffDeps = {
      storageLocal: this.storageLocal,
      storageSession: this.storageSession,
      adapter: this.adapter,
      tabsApi: this.tabsApi,
      windowsApi: this.windowsApi,
      runtimeApi: this.runtimeApi,
      offscreenApi: this.offscreenApi
    };

    performHandoff(handoffDeps, failedTalk)
      .then((handoffRes) => {
        // Popup open: it runs the countdown; if it closes uncancelled, the SW completes the handoff
        if (handoffRes.status === 'pending') {
          continueHandoffAfterPopupClose(handoffDeps, failedTalk.id).catch((err) =>
            console.warn('[TalkRunner] Popup close continuation error:', err)
          );
        }
      })
      .catch((err) => console.warn('[TalkRunner] Handoff execution error:', err));

    return failedTalk;
  }

  getMutex(): SerializedMutex {
    return this.mutex;
  }

  async boot(): Promise<BootResult> {
    const bootResult = await getBootReadyPromise(this.storageSession as any);
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

      // Check debug:v1.forceFailure
      const debugData = (await this.storageLocal.get('debug:v1'))?.['debug:v1'] as DebugV1Storage | undefined;
      if (debugData?.forceFailure) {
        const forcedCode = debugData.forceFailure;
        await this.storageLocal.set({ 'debug:v1': { ...debugData, forceFailure: undefined } });

        let talk = createTalk(text, now);
        const failureInfo = getFailureInfo(forcedCode);
        if (failureInfo.defaultStage === 'read') {
          talk = transition(talk, { type: 'TAB_RESOLVED', tabId: 1 }, now);
          talk = transition(talk, { type: 'SUBMITTING' }, now);
          talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: now }, now);
        }
        const failedTalk = await this.handleFailure(talk, forcedCode, now);
        return { accepted: true, talk: failedTalk };
      }

      const settings = await getSettingsStorage(this.storageLocal);
      if (!settings?.broChatUrl) {
        let talk = createTalk(text, now);
        const failedTalk = await this.handleFailure(talk, 'NO_BRO_CHAT', now);
        return { accepted: true, talk: failedTalk };
      }

      let talk = createTalk(text, now);
      await writeAheadTalk(this.storageLocal, talk);
      this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
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
      const initialTabId = (this.adapter as any).getActiveTabId?.() || 1;
      talk = transition(talk, { type: 'TAB_RESOLVED', tabId: initialTabId }, this.now());
      if (talk.phase === 'failed') {
        await finalizeTerminalTalk(this.storageLocal, talk, this.now());
        this.alarms?.clear('ttb-watchdog');
        return;
      }
      await writeAheadTalk(this.storageLocal, talk);
    });

    // Step 3: checkReady outside mutex (bounded call)
    let ready: ReadyResult;
    try {
      const settings = await getSettingsStorage(this.storageLocal);
      const chatRes = settings?.broChatUrl ? validateBroChatUrl(settings.broChatUrl) : null;
      const chatId = chatRes?.valid && chatRes.ref ? chatRes.ref.chatId : '';
      ready = await this.adapter.checkReady({ chatId, text });
    } catch (e) {
      ready = { ok: false, code: 'INTERNAL' as const };
    }

    // Step 4: Inspect checkReady in mutex and advance to SUBMITTING
    const readyStepRes = await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.id !== talkId || talk.phase !== 'sending') return talk;

      const actualTabId = (this.adapter as any).getActiveTabId?.() || talk.tabId;
      if (actualTabId && actualTabId !== talk.tabId) {
        talk = { ...talk, tabId: actualTabId };
      }

      if (!ready.ok) {
        return this.handleFailure(talk, ready.code, this.now());
      }

      // AWAIT SUBMITTING WRITE-AHEAD PRIOR TO SEND ACTION DISPATCH
      talk = transition(talk, { type: 'SUBMITTING' }, this.now());
      if (talk.phase === 'failed') {
        await finalizeTerminalTalk(this.storageLocal, talk, this.now());
        this.alarms?.clear('ttb-watchdog');
        return talk;
      }
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
        return this.handleFailure(talk, sendResult.code, this.now());
      }

      const sentTime = this.now();
      talk = transition(talk, { type: 'SUBMIT_CONFIRMED', sentAt: sentTime }, sentTime);
      if (talk.phase === 'failed') {
        await finalizeTerminalTalk(this.storageLocal, talk, sentTime);
        this.alarms?.clear('ttb-watchdog');
        return talk;
      }
      await writeAheadTalk(this.storageLocal, talk);
      return talk;
    });

    await this.syncFastProbe();
    return { accepted: true, talk: confirmedTalk ?? undefined };
  }

  private stopFastProbe(): void {
    if (this.fastHandle !== null) this.fastTimers?.clearTimeout(this.fastHandle);
    this.fastHandle = null;
    this.fastTalkId = null;
  }

  // Idempotent: the fast loop runs exactly while lastTalk is `waiting`, bound to that Talk id.
  private async syncFastProbe(): Promise<void> {
    if (!this.fastTimers) return;
    const talk = (await getRuntimeStorage(this.storageLocal)).lastTalk;
    if (!talk || talk.phase !== 'waiting') {
      this.stopFastProbe();
      return;
    }
    if (this.fastHandle !== null && this.fastTalkId === talk.id) return;
    this.stopFastProbe();
    const talkId = talk.id;
    this.fastTalkId = talkId;
    this.fastHandle = this.fastTimers.setTimeout(() => {
      this.fastHandle = null;
      this.tick(talkId)
        .catch((err) => console.warn('[TalkRunner] Fast probe error:', err))
        .then(() => this.syncFastProbe())
        .catch(() => {});
    }, FAST_PROBE_MS);
  }

  // Single-flight: a tick that starts while another runs is skipped (alarm and fast path share this).
  async tick(expectedTalkId?: string): Promise<Talk | null> {
    if (this.tickInFlight) return null;
    this.tickInFlight = true;
    try {
      return await this.tickOnce(expectedTalkId);
    } finally {
      this.tickInFlight = false;
      await this.syncFastProbe();
    }
  }

  private async tickOnce(expectedTalkId?: string): Promise<Talk | null> {
    // 0. Check debug:v1.forceFailure during tick
    const debugData = (await this.storageLocal.get('debug:v1'))?.['debug:v1'] as DebugV1Storage | undefined;
    if (debugData?.forceFailure) {
      const forcedCode = debugData.forceFailure;
      await this.storageLocal.set({ 'debug:v1': { ...debugData, forceFailure: undefined } });
      return this.mutex.run(async () => {
        const now = this.now();
        const runtime = await getRuntimeStorage(this.storageLocal);
        let talk = runtime.lastTalk;
        if (!talk || talk.phase === 'done' || talk.phase === 'failed') return null;
        return this.handleFailure(talk, forcedCode, now);
      });
    }

    // 1. Atomic read and deadline check within mutex
    const talkToProcess = await this.mutex.run(async () => {
      const now = this.now();
      const runtime = await getRuntimeStorage(this.storageLocal);
      let talk = runtime.lastTalk;
      if (!talk || talk.phase === 'done' || talk.phase === 'failed') return null;
      if (expectedTalkId !== undefined && talk.id !== expectedTalkId) return null;

      // Absolute total timeout enforcement for waiting phase BEFORE awaiting probe
      if (talk.phase === 'waiting') {
        const totalElapsed = now - (talk.sentAt ?? talk.createdAt);
        if (totalElapsed >= TOTAL_TIMEOUT_MS) {
          return this.handleFailure(talk, 'TIMEOUT_TOTAL', now);
        }
      }

      // Phase deadline check during watchdog tick for non-waiting phases (waiting is governed by evaluateTick)
      if (talk.phase !== 'waiting' && talk.phaseDeadlineAt !== null && now > talk.phaseDeadlineAt) {
        return this.handleFailure(talk, stageOf(talk.phase) === 'send' ? 'EDITOR_BUSY' : 'EXTRACT_FAILED', now);
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
          return this.handleFailure(talk, 'EXTRACT_FAILED', now);
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

      const evalResult = evaluateTick(talk, probe, now, talk.doneStreak ?? 0);
      const streakChanged = (talk.doneStreak ?? 0) !== evalResult.nextConsecutiveDone;
      if (streakChanged) {
        talk = { ...talk, doneStreak: evalResult.nextConsecutiveDone };
      }

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
      } else if (streakChanged) {
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
          return { action: 'terminal' as const, talk: await this.handleFailure(talk, 'TIMEOUT_IDLE', now) };
        }

        case 'timeout_total': {
          return { action: 'terminal' as const, talk: await this.handleFailure(talk, 'TIMEOUT_TOTAL', now) };
        }

        case 'quota_exhausted': {
          return { action: 'terminal' as const, talk: await this.handleFailure(talk, 'QUOTA_EXHAUSTED', now) };
        }

        case 'signed_out': {
          return { action: 'terminal' as const, talk: await this.handleFailure(talk, 'NOT_SIGNED_IN', now) };
        }

        case 'wrong_chat': {
          return { action: 'terminal' as const, talk: await this.handleFailure(talk, 'BRO_CHAT_MISSING', now) };
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
          return this.handleFailure(t, 'EXTRACT_FAILED', now);
        } else {
          t = transition(t, { type: 'STREAM_COMPLETE', answerMarkdown: extractResult.markdown }, now);
          await finalizeTerminalTalk(this.storageLocal, t, now);
          this.alarms?.clear('ttb-watchdog');
          return t;
        }
      });
    }

    return evaluatedAction.talk;
  }

  async reconcile(isNewBrowserSession = false): Promise<ReconcileDecision> {
    const now = this.now();
    const decision = await this.mutex.run(async () => {
      const runtime = await getRuntimeStorage(this.storageLocal);
      const session = this.storageSession ? await getSessionStorage(this.storageSession) : null;
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
        const initialTabId = (this.adapter as any).getActiveTabId?.() || talk.tabId || 1;
        talk = transition(talk, { type: 'TAB_RESOLVED', tabId: initialTabId }, this.now());
        if (talk.phase === 'failed') {
          await finalizeTerminalTalk(this.storageLocal, talk, this.now());
          this.alarms?.clear('ttb-watchdog');
          return;
        }
        await writeAheadTalk(this.storageLocal, talk);
      });

      // Step B: If in sending, drive checkReady -> submitting -> send
      const runtime = await getRuntimeStorage(this.storageLocal);
      const talk = runtime.lastTalk;
      if (talk && talk.phase === 'sending') {
        let ready: ReadyResult;
        try {
          const settings = await getSettingsStorage(this.storageLocal);
          const chatRes = settings?.broChatUrl ? validateBroChatUrl(settings.broChatUrl) : null;
          const chatId = chatRes?.valid && chatRes.ref ? chatRes.ref.chatId : '';
          ready = await this.adapter.checkReady({ chatId, text: talk.text });
        } catch (e) {
          ready = { ok: false, code: 'INTERNAL' as const };
        }

        const advancedToSubmitting = await this.mutex.run(async () => {
          let t = (await getRuntimeStorage(this.storageLocal)).lastTalk;
          if (!t || t.id !== talk.id || t.phase !== 'sending') return false;

          const actualTabId = (this.adapter as any).getActiveTabId?.() || t.tabId;
          if (actualTabId && actualTabId !== t.tabId) {
            t = { ...t, tabId: actualTabId };
          }

          if (!ready.ok) {
            t = transition(t, { type: 'FAIL', code: ready.code }, this.now());
            await finalizeTerminalTalk(this.storageLocal, t, this.now());
            this.alarms?.clear('ttb-watchdog');
            return false;
          }

          t = transition(t, { type: 'SUBMITTING' }, this.now());
          if (t.phase === 'failed') {
            await finalizeTerminalTalk(this.storageLocal, t, this.now());
            this.alarms?.clear('ttb-watchdog');
            return false;
          }

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
              if (t.phase === 'failed') {
                await finalizeTerminalTalk(this.storageLocal, t, sentTime);
                this.alarms?.clear('ttb-watchdog');
              } else {
                await writeAheadTalk(this.storageLocal, t);
                this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
              }
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
            if (t.phase === 'failed') {
              await finalizeTerminalTalk(this.storageLocal, t, now);
              this.alarms?.clear('ttb-watchdog');
            } else {
              await writeAheadTalk(this.storageLocal, t);
              this.alarms?.create('ttb-watchdog', { periodInMinutes: 0.5 });
            }
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

    await this.syncFastProbe();
    return decision;
  }
}
