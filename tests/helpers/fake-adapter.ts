// tests/helpers/fake-adapter.ts
import type {
  BroAdapter,
  ReadyResult,
  SendResult,
  ProbeResult,
  ExtractResult,
  FailureCode
} from '../../src/shared/types.ts';
import { computeTextSignature } from '../../src/shared/tick.ts';

export class FakeAdapter implements BroAdapter {
  public checkReadyResult: ReadyResult = { ok: true, editorHasOwnText: false };
  public sendResult: SendResult = { ok: true };
  public probeQueue: ProbeResult[] = [];
  public defaultProbe: ProbeResult = {
    page: 'ready',
    turn: 'complete',
    generating: false,
    textLength: 50,
    textSig: computeTextSignature('Hello, this is a response from Fake Bro Gemini!'),
    quota: false
  };
  public extractResult: ExtractResult = {
    markdown: '## Hello Bro\n\nThis is the markdown answer from Fake Bro.'
  };

  public checkReadyCalls = 0;
  public sendCalls = 0;
  public probeCalls = 0;
  public extractCalls = 0;
  public handoffNotices: string[] = [];

  async checkReady(_a: { chatId: string; text: string }): Promise<ReadyResult> {
    this.checkReadyCalls++;
    return this.checkReadyResult;
  }

  async send(_a: { talkId: string; text: string }): Promise<SendResult> {
    this.sendCalls++;
    return this.sendResult;
  }

  async probe(_a: { talkId: string; text: string }): Promise<ProbeResult> {
    this.probeCalls++;
    if (this.probeQueue.length > 0) {
      return this.probeQueue.shift()!;
    }
    return this.defaultProbe;
  }

  async extract(_a: { talkId: string; text: string }): Promise<ExtractResult> {
    this.extractCalls++;
    return this.extractResult;
  }

  async selfCheck(): Promise<Record<string, boolean>> {
    return { editor: true, sendButton: true };
  }

  async showHandoffNotice(a: { message: string }): Promise<void> {
    this.handoffNotices.push(a.message);
  }
}

export class MemoryStorage {
  private data: Record<string, unknown> = {};

  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (!keys) return { ...this.data };
    if (typeof keys === 'string') {
      return { [keys]: this.data[keys] };
    }
    if (Array.isArray(keys)) {
      const res: Record<string, unknown> = {};
      for (const k of keys) res[k] = this.data[k];
      return res;
    }
    return { ...this.data };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) delete this.data[k];
  }

  async clear(): Promise<void> {
    this.data = {};
  }
}

export class FakeAlarms {
  public alarms = new Map<string, { periodInMinutes?: number; delayInMinutes?: number }>();

  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void {
    this.alarms.set(name, alarmInfo);
  }

  clear(name: string): boolean {
    return this.alarms.delete(name);
  }
}
