// src/sw/notebook-onboarding.ts
import { validateBroChatUrl } from '../shared/validate.ts';
import {
  getSessionStorage,
  saveSessionStorage,
  saveSettingsStorage,
  type StorageAreaLike
} from '../shared/storage.ts';
import type { TabsApiLike } from './tab.ts';
import type { ScriptingApiLike } from './adapter-real.ts';

export const DEFAULT_NOTEBOOK_URL = 'https://gemini.google.com/notebook/72c84a6c-a0a6-4765-973d-3211da724b62';
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export interface NotebookOnboardingDeps {
  storageLocal: StorageAreaLike;
  storageSession?: StorageAreaLike;
  tabsApi?: TabsApiLike;
  scriptingApi?: ScriptingApiLike;
  sendMessage?: (tabId: number, message: any) => Promise<any>;
  notebookUrl?: string;
  now?: () => number;
  pollIntervalMs?: number;
  loadTimeoutMs?: number;
  readyTimeoutMs?: number;
  redirectTimeoutMs?: number;
}

export interface NotebookOnboardingResult {
  ok: boolean;
  broChatUrl?: string;
  tabId?: number;
  reason?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(
  tabsApi: TabsApiLike,
  tabId: number,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await tabsApi.get(tabId);
      if (tab && tab.status === 'complete') {
        return true;
      }
    } catch {
      return false;
    }
    await delay(pollIntervalMs);
  }
  return false;
}

async function ensureAdapterReady(
  tabId: number,
  scriptingApi: ScriptingApiLike | undefined,
  sendMessage: (tabId: number, message: any) => Promise<any>,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let injected = false;

  while (Date.now() < deadline) {
    try {
      const ping = await sendMessage(tabId, { action: 'TTB_PING' });
      if (!ping?.ok && !injected && scriptingApi) {
        await scriptingApi.executeScript({
          target: { tabId },
          files: ['adapter.js'],
          world: 'ISOLATED' as any
        });
        injected = true;
      }
    } catch {
      if (!injected && scriptingApi) {
        try {
          await scriptingApi.executeScript({
            target: { tabId },
            files: ['adapter.js'],
            world: 'ISOLATED' as any
          });
          injected = true;
        } catch {
          // Retry on next poll
        }
      }
    }

    try {
      const ready = await sendMessage(tabId, { action: 'TTB_CHECK_READY' });
      if (ready && ready.ok) {
        return true;
      }
    } catch {
      // Retry on next poll
    }

    await delay(pollIntervalMs);
  }

  return false;
}

async function waitForNewChatUrl(
  tabsApi: TabsApiLike,
  tabId: number,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await tabsApi.get(tabId);
      if (tab?.url) {
        const res = validateBroChatUrl(tab.url);
        if (res.valid && res.normalizedUrl) {
          return res.normalizedUrl;
        }
      }
    } catch {
      return null;
    }
    await delay(pollIntervalMs);
  }
  return null;
}

/**
 * Automatically opens the configured Gemini Notebook URL, seeds it with the user's
 * current input word, waits for the new chat URL, and persists it to settings:v1.
 */
export async function provisionNotebookChat(
  deps: NotebookOnboardingDeps,
  seedText: string
): Promise<NotebookOnboardingResult> {
  const tabsApi = deps.tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : undefined);
  const scriptingApi = deps.scriptingApi || (typeof chrome !== 'undefined' ? chrome.scripting : undefined);
  const sendMessage =
    deps.sendMessage ||
    ((tabId: number, msg: any) => chrome.tabs.sendMessage(tabId, msg));

  if (!tabsApi) {
    return { ok: false, reason: 'Chrome tabs API is not available' };
  }

  const notebookUrl = deps.notebookUrl || DEFAULT_NOTEBOOK_URL;
  const now = deps.now || (() => Date.now());
  const pollIntervalMs = deps.pollIntervalMs ?? 250;
  const loadTimeoutMs = deps.loadTimeoutMs ?? 15000;
  const readyTimeoutMs = deps.readyTimeoutMs ?? 15000;
  const redirectTimeoutMs = deps.redirectTimeoutMs ?? 20000;

  let tab: chrome.tabs.Tab;
  try {
    tab = await tabsApi.create({
      url: notebookUrl,
      active: false,
      pinned: true
    });
  } catch (err) {
    return { ok: false, reason: `Failed to open notebook tab: ${(err as Error).message}` };
  }

  if (!tab.id) {
    return { ok: false, reason: 'Created notebook tab has no ID' };
  }

  const loaded = await waitForTabComplete(tabsApi, tab.id, loadTimeoutMs, pollIntervalMs);
  if (!loaded) {
    return { ok: false, tabId: tab.id, reason: 'Notebook tab did not finish loading in time' };
  }

  const ready = await ensureAdapterReady(tab.id, scriptingApi, sendMessage, readyTimeoutMs, pollIntervalMs);
  if (!ready) {
    return { ok: false, tabId: tab.id, reason: 'Notebook chat input did not become ready in time' };
  }

  try {
    const sendRes = await sendMessage(tab.id, {
      action: 'TTB_INSERT_AND_SEND',
      text: seedText
    });
    if (!sendRes?.ok) {
      return { ok: false, tabId: tab.id, reason: sendRes?.reason || 'Failed to send seed text' };
    }
  } catch (err) {
    return { ok: false, tabId: tab.id, reason: `Failed to send seed text: ${(err as Error).message}` };
  }

  const newChatUrl = await waitForNewChatUrl(tabsApi, tab.id, redirectTimeoutMs, pollIntervalMs);
  if (!newChatUrl) {
    return { ok: false, tabId: tab.id, reason: 'Timed out waiting for new Gemini chat URL' };
  }

  await saveSettingsStorage(deps.storageLocal, {
    broChatUrl: newChatUrl,
    updatedAt: now()
  });

  if (deps.storageSession) {
    try {
      const session = (await getSessionStorage(deps.storageSession)) || { bootId: 'auto-boot' };
      session.broTab = { tabId: tab.id, windowId: tab.windowId || 0 };
      await saveSessionStorage(deps.storageSession, session);
    } catch {
      // Non-fatal: tab cache update failed
    }
  }

  return {
    ok: true,
    broChatUrl: newChatUrl,
    tabId: tab.id
  };
}
