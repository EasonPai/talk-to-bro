// src/sw/boot.ts
import type { StorageAreaLike } from '../shared/storage.ts';
import { getSessionStorage, saveSessionStorage } from '../shared/storage.ts';

export interface BootResult {
  bootId: string;
  isNewBrowserSession: boolean;
}

let readyPromise: Promise<BootResult> | null = null;

/**
 * Initializes SW boot state:
 * - session:v1 survives SW restarts within the same browser session.
 * - Only changes bootId when session:v1 is empty (new browser session).
 * - All listeners must await `bootReady()` before handling events.
 */
export async function initBoot(sessionStorage: StorageAreaLike): Promise<BootResult> {
  const existing = await getSessionStorage(sessionStorage);
  if (existing && existing.bootId) {
    return {
      bootId: existing.bootId,
      isNewBrowserSession: false
    };
  }

  const newBootId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `boot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  await saveSessionStorage(sessionStorage, {
    bootId: newBootId
  });

  return {
    bootId: newBootId,
    isNewBrowserSession: true
  };
}

export function getBootReadyPromise(sessionStorage: StorageAreaLike): Promise<BootResult> {
  if (!readyPromise) {
    readyPromise = initBoot(sessionStorage);
  }
  return readyPromise;
}

export function resetBootForTesting(): void {
  readyPromise = null;
}
