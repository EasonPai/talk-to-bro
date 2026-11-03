// src/sw/ui-state.ts
import { getRuntimeStorage, getUiStorage, saveUiStorage, type StorageAreaLike } from '../shared/storage.ts';
import type { UiState } from '../shared/types.ts';

// Serialized UI queue for state mutations
export class UiQueue {
  private queue = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const res = this.queue.then(fn, fn);
    this.queue = res.then(() => {}, () => {});
    return res;
  }
}

// Action routing sync function
export async function syncActionRouting(storage?: StorageAreaLike, actionApi?: any): Promise<void> {
  try {
    const ui = await getUiStorage(storage || (globalThis as any).chrome?.storage?.local);
    const action = actionApi || (globalThis as any).chrome?.action;
    if (ui.mode === 'sidepanel') {
      await action?.setPopup({ popup: '' });
    } else {
      await action?.setPopup({ popup: 'popup.html' });
    }
  } catch (err) {
    console.error('[SW] Failed to sync action routing:', err);
  }
}

// Startup recovery for accepted talk vs UI draft clearing (M6 SW interruption recovery)
export async function reconcileUiOnBoot(storage?: StorageAreaLike): Promise<void> {
  try {
    if (!storage) return;
    const [runtime, ui] = await Promise.all([
      getRuntimeStorage(storage),
      getUiStorage(storage)
    ]);
    if (runtime.lastTalk && runtime.lastTalk.id) {
      if (ui.acceptedTalkId !== runtime.lastTalk.id) {
        if (ui.draft.trim() === runtime.lastTalk.text.trim()) {
          await saveUiStorage(storage, {
            ...ui,
            draft: '',
            revision: ui.revision + 1,
            acceptedTalkId: runtime.lastTalk.id
          });
          console.log('[SW] reconcileUiOnBoot: Cleared orphaned accepted draft.');
        } else {
          await saveUiStorage(storage, {
            ...ui,
            acceptedTalkId: runtime.lastTalk.id
          });
        }
      }
    }
  } catch (err) {
    console.error('[SW] reconcileUiOnBoot failed:', err);
  }
}
