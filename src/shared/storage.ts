// src/shared/storage.ts
import type {
  Talk,
  LogEntry,
  RuntimeV1Storage,
  SessionV1Storage,
  SettingsV1
} from './types.ts';

export const RUNTIME_STORAGE_KEY = 'runtime:v1';
export const SESSION_STORAGE_KEY = 'session:v1';
export const SETTINGS_STORAGE_KEY = 'settings:v1';
export const MAX_LOG_ENTRIES = 2_000;

export interface StorageAreaLike {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
  clear?(): Promise<void>;
}

export async function getRuntimeStorage(storage: StorageAreaLike): Promise<RuntimeV1Storage> {
  const result = await storage.get(RUNTIME_STORAGE_KEY);
  const data = result[RUNTIME_STORAGE_KEY] as RuntimeV1Storage | undefined;
  return {
    lastTalk: data?.lastTalk ?? null,
    logByTalkId: data?.logByTalkId ?? {}
  };
}

export async function saveRuntimeStorage(
  storage: StorageAreaLike,
  runtime: RuntimeV1Storage
): Promise<void> {
  await storage.set({ [RUNTIME_STORAGE_KEY]: runtime });
}

export async function getSessionStorage(storage: StorageAreaLike): Promise<SessionV1Storage | null> {
  const result = await storage.get(SESSION_STORAGE_KEY);
  return (result[SESSION_STORAGE_KEY] as SessionV1Storage) ?? null;
}

export async function saveSessionStorage(
  storage: StorageAreaLike,
  session: SessionV1Storage
): Promise<void> {
  await storage.set({ [SESSION_STORAGE_KEY]: session });
}

export async function getSettingsStorage(storage: StorageAreaLike): Promise<SettingsV1 | null> {
  const result = await storage.get(SETTINGS_STORAGE_KEY);
  return (result[SETTINGS_STORAGE_KEY] as SettingsV1) ?? null;
}

export async function saveSettingsStorage(
  storage: StorageAreaLike,
  settings: SettingsV1
): Promise<void> {
  await storage.set({ [SETTINGS_STORAGE_KEY]: settings });
}

/**
 * Trims logByTalkId FIFO if size exceeds MAX_LOG_ENTRIES (2000).
 */
export function evictOldestLogEntries(
  logByTalkId: Record<string, LogEntry>,
  maxEntries = MAX_LOG_ENTRIES
): Record<string, LogEntry> {
  const entries = Object.entries(logByTalkId);
  if (entries.length <= maxEntries) return logByTalkId;

  // Sort ascending by timestamp `at` (oldest first)
  entries.sort((a, b) => a[1].at - b[1].at);
  const keepCount = maxEntries;
  const pruned = entries.slice(entries.length - keepCount);

  const result: Record<string, LogEntry> = {};
  for (const [id, entry] of pruned) {
    result[id] = entry;
  }
  return result;
}

/**
 * Write-ahead update: writes the current talk state to storage before dispatching action.
 */
export async function writeAheadTalk(
  storage: StorageAreaLike,
  talk: Talk
): Promise<RuntimeV1Storage> {
  const current = await getRuntimeStorage(storage);
  const updated: RuntimeV1Storage = {
    ...current,
    lastTalk: talk
  };
  await saveRuntimeStorage(storage, updated);
  return updated;
}

/**
 * Atomic terminal write: records terminal talk and exactly one deduplicated log entry in runtime:v1.
 */
export async function finalizeTerminalTalk(
  storage: StorageAreaLike,
  talk: Talk,
  now: number
): Promise<RuntimeV1Storage> {
  const current = await getRuntimeStorage(storage);
  const nextLogs = { ...current.logByTalkId };

  // Only record to logByTalkId if not already recorded (deduplicated by talkId)
  if (!nextLogs[talk.id]) {
    let resultType: LogEntry['result'];
    if (talk.phase === 'done') {
      resultType = 'success';
    } else {
      resultType = talk.failure?.stage === 'read' ? 'read_failed' : 'send_failed';
    }
    nextLogs[talk.id] = {
      result: resultType,
      at: now
    };
  }

  const boundedLogs = evictOldestLogEntries(nextLogs, MAX_LOG_ENTRIES);
  const updated: RuntimeV1Storage = {
    lastTalk: talk,
    logByTalkId: boundedLogs
  };

  await saveRuntimeStorage(storage, updated);
  return updated;
}
