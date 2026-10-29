// src/sw/tab.ts
import { validateBroChatUrl } from '../shared/validate.ts';
import type { StorageAreaLike } from '../shared/storage.ts';
import { getSessionStorage, saveSessionStorage } from '../shared/storage.ts';

export interface EnsureBroTabResult {
  ok: boolean;
  tabId?: number;
  windowId?: number;
  code?: 'NO_BRO_CHAT' | 'TAB_CLOSED' | 'TAB_UNRESPONSIVE' | 'INTERNAL';
  reason?: string;
}

export interface TabsApiLike {
  get(tabId: number): Promise<chrome.tabs.Tab>;
  query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  update(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab>;
  onUpdated?: {
    addListener(callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
    removeListener(callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void): void;
  };
}

/**
 * Checks if two Gemini URLs refer to the same exact chat and account prefix.
 */
export function isSameGeminiChat(urlA: string, urlB: string): boolean {
  const refA = validateBroChatUrl(urlA);
  const refB = validateBroChatUrl(urlB);
  if (!refA || !refA.valid || !refA.ref || !refB || !refB.valid || !refB.ref) return false;

  // Account index must match (e.g. both default / undefined, or both /u/1)
  if (refA.ref.accountIndex !== refB.ref.accountIndex) return false;

  // Canonical normalized chat URL must match exactly
  return refA.normalizedUrl === refB.normalizedUrl;
}

/**
 * Ensures a pinned background Gemini tab is available for the given target Bro Chat URL.
 * Strictly guarantees active: false to prevent focus theft.
 */
export async function ensureBroTab(
  targetUrl: string,
  storageSession?: StorageAreaLike,
  tabsApi?: TabsApiLike
): Promise<EnsureBroTabResult> {
  const tabs = tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : undefined);
  if (!tabs) {
    return { ok: false, code: 'INTERNAL', reason: 'Chrome tabs API is not available' };
  }

  const targetRef = validateBroChatUrl(targetUrl);
  if (!targetRef || !targetRef.valid) {
    return { ok: false, code: 'NO_BRO_CHAT', reason: 'Invalid or missing broChatUrl' };
  }

  // 1. Check cached tab in session storage
  if (storageSession) {
    try {
      const session = await getSessionStorage(storageSession);
      if (session?.broTab?.tabId) {
        try {
          const cachedTab = await tabs.get(session.broTab.tabId);
          if (cachedTab && cachedTab.url && isSameGeminiChat(cachedTab.url, targetUrl)) {
            if (!cachedTab.pinned) {
              await tabs.update(cachedTab.id!, { pinned: true });
            }
            return { ok: true, tabId: cachedTab.id, windowId: cachedTab.windowId };
          }
        } catch {
          // Cached tab closed or gone, proceed to query
        }
      }
    } catch {
      // Session storage read failure, proceed to query
    }
  }

  // 2. Query open Gemini tabs
  let geminiTabs: chrome.tabs.Tab[] = [];
  try {
    geminiTabs = await tabs.query({ url: '*://gemini.google.com/*' });
  } catch (e) {
    return { ok: false, code: 'INTERNAL', reason: 'Failed to query open tabs' };
  }

  // Find matching tab
  for (const tab of geminiTabs) {
    if (tab.id && tab.url && isSameGeminiChat(tab.url, targetUrl)) {
      if (!tab.pinned) {
        try {
          await tabs.update(tab.id, { pinned: true });
        } catch {
          // Ignore pin failure
        }
      }

      if (storageSession) {
        try {
          const session = (await getSessionStorage(storageSession)) || { bootId: 'auto-boot' };
          session.broTab = { tabId: tab.id, windowId: tab.windowId || 0 };
          await saveSessionStorage(storageSession, session);
        } catch {
          // Ignore cache save error
        }
      }

      return { ok: true, tabId: tab.id, windowId: tab.windowId };
    }
  }

  // 3. Create a new pinned background tab (active: false strictly preserves user focus)
  let newTab: chrome.tabs.Tab;
  try {
    newTab = await tabs.create({
      url: targetRef.normalizedUrl,
      active: false,
      pinned: true
    });
  } catch (e) {
    return { ok: false, code: 'INTERNAL', reason: 'Failed to create new tab' };
  }

  if (!newTab.id) {
    return { ok: false, code: 'INTERNAL', reason: 'Created tab missing tab ID' };
  }

  const tabId = newTab.id;

  // 4. Await tab load if onUpdated is available
  if (tabs.onUpdated && newTab.status !== 'complete') {
    await new Promise<void>((resolve) => {
      let timeoutId: any;
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeoutId);
          tabs.onUpdated?.removeListener(listener);
          resolve();
        }
      };

      timeoutId = setTimeout(() => {
        tabs.onUpdated?.removeListener(listener);
        resolve(); // resolve on timeout to allow subsequent readiness checks
      }, 15000);

      tabs.onUpdated?.addListener(listener);
    });
  }

  // Update session cache
  if (storageSession) {
    try {
      const session = (await getSessionStorage(storageSession)) || { bootId: 'auto-boot' };
      session.broTab = { tabId, windowId: newTab.windowId || 0 };
      await saveSessionStorage(storageSession, session);
    } catch {
      // Ignore cache save error
    }
  }

  return { ok: true, tabId, windowId: newTab.windowId };
}
