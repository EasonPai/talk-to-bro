// src/sw/adapter-real.ts
import type {
  BroAdapter,
  ReadyResult,
  SendResult,
  ProbeResult,
  ExtractResult
} from '../shared/types.ts';
import type { StorageAreaLike } from '../shared/storage.ts';
import { ensureBroTab, type TabsApiLike } from './tab.ts';

export interface ScriptingApiLike {
  executeScript(injection: chrome.scripting.ScriptInjection<any, any>): Promise<any[]>;
}

export interface RealBroAdapterDeps {
  getTargetUrl: () => Promise<string | null> | string | null;
  storageSession?: StorageAreaLike;
  tabsApi?: TabsApiLike;
  scriptingApi?: ScriptingApiLike;
  sendMessage?: (tabId: number, message: any) => Promise<any>;
}

export class RealBroAdapter implements BroAdapter {
  private getTargetUrl: () => Promise<string | null> | string | null;
  private storageSession?: StorageAreaLike;
  private tabsApi?: TabsApiLike;
  private scriptingApi?: ScriptingApiLike;
  private sendMsg: (tabId: number, message: any) => Promise<any>;
  private activeTabId: number | null = null;

  constructor(deps: RealBroAdapterDeps) {
    this.getTargetUrl = deps.getTargetUrl;
    this.storageSession = deps.storageSession;
    this.tabsApi = deps.tabsApi;
    this.scriptingApi = deps.scriptingApi;
    this.sendMsg = deps.sendMessage || ((tabId, msg) => chrome.tabs.sendMessage(tabId, msg));
  }

  getActiveTabId(): number | null {
    return this.activeTabId;
  }

  private async resolveTab(): Promise<{ ok: boolean; tabId?: number; code?: 'NO_BRO_CHAT' | 'TAB_CLOSED' | 'INTERNAL'; reason?: string }> {
    const url = await this.getTargetUrl();
    if (!url) {
      return { ok: false, code: 'NO_BRO_CHAT', reason: 'No broChatUrl configured' };
    }

    const tabRes = await ensureBroTab(url, this.storageSession, this.tabsApi);
    if (!tabRes.ok || !tabRes.tabId) {
      return {
        ok: false,
        code: tabRes.code === 'NO_BRO_CHAT' ? 'NO_BRO_CHAT' : 'TAB_CLOSED',
        reason: tabRes.reason || 'Failed to locate or open Bro Chat tab'
      };
    }

    this.activeTabId = tabRes.tabId;
    return { ok: true, tabId: tabRes.tabId };
  }

  private async ensureAdapterInjected(tabId: number): Promise<boolean> {
    // 1. Ping existing adapter
    try {
      const pingRes = await this.sendMsg(tabId, { action: 'TTB_PING' });
      if (pingRes && pingRes.ok) {
        return true;
      }
    } catch {
      // Ping failed, adapter not yet injected
    }

    // 2. On-demand injection into ISOLATED world
    const scripting = this.scriptingApi || (typeof chrome !== 'undefined' ? chrome.scripting : undefined);
    if (!scripting) {
      return false;
    }

    try {
      await scripting.executeScript({
        target: { tabId },
        files: ['adapter.js'],
        world: 'ISOLATED' as any
      });
      return true;
    } catch {
      return false;
    }
  }

  async checkReady(args: { chatId: string; text: string }): Promise<ReadyResult> {
    const tabRes = await this.resolveTab();
    if (!tabRes.ok || !tabRes.tabId) {
      return { ok: false, code: tabRes.code || 'NO_BRO_CHAT' };
    }

    const injected = await this.ensureAdapterInjected(tabRes.tabId);
    if (!injected) {
      return { ok: false, code: 'TAB_UNRESPONSIVE' };
    }

    const targetUrl = (await this.getTargetUrl()) || undefined;
    try {
      const response = await this.sendMsg(tabRes.tabId, {
        action: 'TTB_CHECK_READY',
        chatId: args.chatId,
        text: args.text,
        targetUrl
      });
      return response || { ok: false, code: 'INTERNAL' };
    } catch {
      return { ok: false, code: 'TAB_UNRESPONSIVE' };
    }
  }

  async send(args: { talkId: string; text: string }): Promise<SendResult> {
    const tabRes = await this.resolveTab();
    if (!tabRes.ok || !tabRes.tabId) {
      return { ok: false, code: tabRes.code || 'TAB_CLOSED' };
    }

    const injected = await this.ensureAdapterInjected(tabRes.tabId);
    if (!injected) {
      return { ok: false, code: 'TAB_UNRESPONSIVE' };
    }

    try {
      const response = await this.sendMsg(tabRes.tabId, {
        action: 'TTB_INSERT_AND_SEND',
        talkId: args.talkId,
        text: args.text
      });

      if (!response) {
        return { ok: false, code: 'SUBMIT_UNCONFIRMED' };
      }

      if (!response.ok) {
        return { ok: false, code: response.code || 'SUBMIT_UNCONFIRMED' };
      }

      return { ok: true, sentAt: response.sentAt || Date.now() };
    } catch {
      return { ok: false, code: 'TAB_UNRESPONSIVE' };
    }
  }

  async probe(args: { talkId: string; text: string }): Promise<ProbeResult> {
    const tabRes = await this.resolveTab();
    if (!tabRes.ok || !tabRes.tabId) {
      return {
        page: 'wrong_chat',
        turn: 'not_found',
        generating: false,
        textLength: 0,
        textSig: '',
        quota: false
      };
    }

    try {
      const response = await this.sendMsg(tabRes.tabId, {
        action: 'TTB_PROBE',
        talkId: args.talkId,
        text: args.text
      });

      if (!response) {
        return {
          page: 'loading',
          turn: 'not_found',
          generating: false,
          textLength: 0,
          textSig: '',
          quota: false
        };
      }

      return response;
    } catch {
      return {
        page: 'wrong_chat',
        turn: 'not_found',
        generating: false,
        textLength: 0,
        textSig: '',
        quota: false
      };
    }
  }

  async extract(args: { talkId: string; text: string }): Promise<ExtractResult> {
    const tabRes = await this.resolveTab();
    if (!tabRes.ok || !tabRes.tabId) {
      return { error: 'EXTRACT_FAILED', reason: 'Tab not available for extract' };
    }

    try {
      const response = await this.sendMsg(tabRes.tabId, {
        action: 'TTB_EXTRACT',
        talkId: args.talkId,
        text: args.text
      });
      return response || { error: 'EXTRACT_FAILED', reason: 'No extract response' };
    } catch (e: any) {
      return { error: 'EXTRACT_FAILED', reason: e.message || 'Extract failed' };
    }
  }
}
