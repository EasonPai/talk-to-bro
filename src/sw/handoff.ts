// src/sw/handoff.ts
import type { Talk, TalkHandoff, BroAdapter } from '../shared/types.ts';
import { getFailureInfo } from '../shared/failures.ts';
import { getRuntimeStorage, getSettingsStorage, type StorageAreaLike } from '../shared/storage.ts';
import { ensureBroTab, type TabsApiLike } from './tab.ts';

export interface HandoffDeps {
  storageLocal: StorageAreaLike;
  storageSession?: StorageAreaLike;
  adapter: BroAdapter;
  tabsApi?: TabsApiLike;
  windowsApi?: {
    update: (windowId: number, updateInfo: { focused: boolean }) => Promise<any>;
  };
  runtimeApi?: {
    getContexts?: (filter: { contextTypes?: string[] }) => Promise<any[]>;
    openOptionsPage?: () => Promise<void>;
  };
  offscreenApi?: {
    createDocument: (options: { url: string; reasons: string[]; justification: string }) => Promise<void>;
    closeDocument: () => Promise<void>;
  };
}

let offscreenLock: Promise<any> = Promise.resolve();
const activeHandoffClaims = new Set<string>();

/**
 * Serialized helper to copy text using MV3 Offscreen Document.
 * Ensures only one offscreen document is created at a time, waits for explicit ACK,
 * and cleanly closes the offscreen document.
 */
export async function copyViaOffscreen(
  text: string,
  deps?: Pick<HandoffDeps, 'offscreenApi' | 'runtimeApi'>
): Promise<boolean> {
  // Serialize offscreen operations
  const unlock = offscreenLock;
  let resolveLock: () => void;
  offscreenLock = new Promise<void>(res => { resolveLock = res; });
  await unlock;

  const offscreen = deps?.offscreenApi || (typeof chrome !== 'undefined' ? (chrome as any).offscreen : null);
  const runtime = deps?.runtimeApi || (typeof chrome !== 'undefined' ? chrome.runtime : null);

  if (!offscreen || !runtime) {
    resolveLock!();
    return false;
  }

  try {
    const getContexts = runtime.getContexts || (typeof chrome !== 'undefined' ? (chrome as any).runtime?.getContexts : undefined);
    let exists = false;
    if (typeof getContexts === 'function') {
      try {
        const contexts = await getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        exists = contexts && contexts.length > 0;
      } catch {
        exists = false;
      }
    }

    if (!exists) {
      await offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Handoff: Copy Talk to clipboard'
      });
    }

    // Send copy command and await explicit ACK
    const ack = await new Promise<{ ok?: boolean } | null>(resolve => {
      chrome.runtime.sendMessage(
        { action: 'OFFSCREEN_COPY', text },
        response => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        }
      );
    });

    try {
      await offscreen.closeDocument();
    } catch {
      // document may have closed
    }

    return !!(ack && ack.ok);
  } catch (e) {
    console.warn('[Handoff] Offscreen copy failed:', e);
    return false;
  } finally {
    resolveLock!();
  }
}

/**
 * Checks whether an Action Popup is currently open.
 */
export async function isPopupOpen(runtimeApi?: HandoffDeps['runtimeApi']): Promise<boolean> {
  const runtime = runtimeApi || (typeof chrome !== 'undefined' ? chrome.runtime : null);
  const getContexts = runtime?.getContexts || (typeof chrome !== 'undefined' ? (chrome as any).runtime?.getContexts : undefined);
  if (typeof getContexts !== 'function') return false;

  try {
    const contexts = await getContexts({ contextTypes: ['POPUP'] });
    return Array.isArray(contexts) && contexts.some((c: any) => c.contextType === 'POPUP');
  } catch {
    return false;
  }
}

/**
 * Executes the complete failure Handoff workflow per Tech Spec §4.3 and CTO clarifications:
 * 1. Deferred and cancelled handoffs are never automatically triggered.
 * 2. If popup is open, starts in 'pending' state (countdown handled by popup).
 * 3. If popup is closed (or triggered by popup countdown completion):
 *    - Copies Talk text (offscreen or pre-copied).
 *    - Switches to Bro Chat tab using ensureBroTab and focuses window.
 *    - Injects non-intrusive Shadow DOM notice on Gemini page.
 *    - Updates talk handoff status to 'done' (both succeeded) or 'partial'.
 */
export async function performHandoff(
  deps: HandoffDeps,
  talk: Talk,
  options?: {
    forceClosed?: boolean;
    alreadyCopied?: boolean;
    authorizeDeferred?: boolean;
  }
): Promise<TalkHandoff> {
  // 1. Guard: cancelled handoffs must NEVER run
  if (talk.handoff?.status === 'cancelled') {
    return talk.handoff;
  }

  // 2. Guard: deferred handoffs must NOT auto-run unless explicit user action authorized it
  if (talk.handoff?.status === 'deferred' && !options?.authorizeDeferred) {
    return talk.handoff;
  }

  // 3. Guard: already completed (done or partial) and not explicitly re-authorized
  if (
    (talk.handoff?.status === 'done' || talk.handoff?.status === 'partial') &&
    !options?.authorizeDeferred
  ) {
    return talk.handoff;
  }

  // 4. Check if Action Popup is open
  const popupActive = !options?.forceClosed && (await isPopupOpen(deps.runtimeApi));
  if (popupActive) {
    // Popup will display countdown and manage cancellation
    return {
      status: 'pending',
      copied: false,
      focused: false
    };
  }

  // 5. Deduplicate concurrent in-flight handoffs for the same talkId
  if (activeHandoffClaims.has(talk.id)) {
    return talk.handoff || { status: 'pending', copied: false, focused: false };
  }
  activeHandoffClaims.add(talk.id);

  try {
    // 6. Pre-action check: verify persisted Talk state to guard against concurrent cancellation
    const currentRuntime = await getRuntimeStorage(deps.storageLocal);
    if (
      currentRuntime.lastTalk?.id !== talk.id ||
      currentRuntime.lastTalk?.handoff?.status === 'cancelled'
    ) {
      return (
        currentRuntime.lastTalk?.handoff || {
          status: 'cancelled',
          copied: false,
          focused: false
        }
      );
    }

    // Set Action Badge to '!'
    if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: '!' }).catch(() => {});
    }

    // A. Copy Talk text
    let copied = !!options?.alreadyCopied;
    if (!copied) {
      copied = await copyViaOffscreen(talk.text, deps);
    }

    // B. Switch to Bro Chat tab & Focus Window
    let focused = false;
    const failureCode = talk.failure?.code || 'INTERNAL';

    if (failureCode === 'NO_BRO_CHAT') {
      // Cannot switch to a nonexistent Bro Chat tab; open Options page
      const openOptions =
        deps.runtimeApi?.openOptionsPage ||
        (typeof chrome !== 'undefined' ? chrome.runtime?.openOptionsPage : null);
      if (typeof openOptions === 'function') {
        try {
          await openOptions();
        } catch (e) {
          console.warn('[Handoff] Failed to open options page:', e);
        }
      }
      focused = false;
    } else {
      // Resolve bro chat tab
      const settings = await getSettingsStorage(deps.storageLocal);
      const broChatUrl = settings?.broChatUrl;

      if (broChatUrl) {
        try {
          const tabRes = await ensureBroTab(broChatUrl, deps.storageSession, deps.tabsApi);
          if (tabRes.ok && tabRes.tabId) {
            const tabs = deps.tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : null);
            const windows =
              deps.windowsApi || (typeof chrome !== 'undefined' ? chrome.windows : null);

            // Activate tab
            if (tabs?.update) {
              await tabs.update(tabRes.tabId, { active: true });
            }

            // Focus window
            let winId = tabRes.windowId;
            if (!winId && tabs?.get) {
              try {
                const t = await tabs.get(tabRes.tabId);
                winId = t.windowId;
              } catch {}
            }

            if (windows?.update && winId) {
              try {
                await windows.update(winId, { focused: true });
                focused = true;
              } catch {
                focused = false;
              }
            } else {
              focused = false;
            }

            // Injected shadow DOM notice on Gemini page
            const failureInfo = getFailureInfo(failureCode);
            const noticeMsg = `${failureInfo.userMessage}${copied ? '（Talk 已複製，Ctrl+V 貼上）' : ''}`;
            deps.adapter.showHandoffNotice({ message: noticeMsg }).catch(() => {});
          }
        } catch (e) {
          console.warn('[Handoff] Tab switch failed:', e);
          focused = false;
        }
      }
    }

    const resultStatus: TalkHandoff['status'] = copied && focused ? 'done' : 'partial';
    const handoffResult: TalkHandoff = {
      status: resultStatus,
      copied,
      focused
    };

    // Atomically update lastTalk with the observed handoff outcome if it matches current Talk
    const runtime = await getRuntimeStorage(deps.storageLocal);
    if (runtime.lastTalk && runtime.lastTalk.id === talk.id) {
      const updatedTalk: Talk = {
        ...runtime.lastTalk,
        handoff: handoffResult
      };
      await deps.storageLocal.set({
        'runtime:v1': {
          ...runtime,
          lastTalk: updatedTalk
        }
      });
    }

    return handoffResult;
  } finally {
    activeHandoffClaims.delete(talk.id);
  }
}
