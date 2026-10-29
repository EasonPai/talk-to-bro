// src/shared/validate.ts
import type { ValidateBroChatUrlResult, BroChatRef } from './types';

export function validateBroChatUrl(input: string | null | undefined): ValidateBroChatUrlResult {
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      valid: false,
      error: 'EMPTY',
      message: 'Bro Chat URL 不能為空，請輸入 Gemini 對話網址。'
    };
  }

  const trimmed = input.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'INVALID_URL',
      message: '無效的 URL 格式，請確認包含完整協定與網址。'
    };
  }

  // 1. Protocol must be HTTPS
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'INVALID_PROTOCOL',
      message: '協定必須是 HTTPS，不支援 HTTP 或其他協定。'
    };
  }

  // 2. Hostname must EXACTLY equal 'gemini.google.com'
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'gemini.google.com') {
    return {
      valid: false,
      error: 'INVALID_HOSTNAME',
      message: '網域名稱必須完全等於 gemini.google.com，禁止惡意或非官方網址。'
    };
  }

  // 3. No credentials allowed (user:pass)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'HAS_CREDENTIALS',
      message: 'URL 不得包含使用者名稱或密碼等身分憑證。'
    };
  }

  // 4. Must match valid chat path patterns
  // Pattern 1: [/u/N]/app/<chatId>
  // Pattern 2: [/u/N]/gem/<gemId>/<chatId>
  const pathname = parsed.pathname;

  const appMatch = pathname.match(/^(?:\/u\/(\d+))?\/app\/([a-zA-Z0-9_-]+)$/);
  const gemMatch = pathname.match(/^(?:\/u\/(\d+))?\/gem\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);

  if (appMatch) {
    const accountIndex = appMatch[1] !== undefined ? parseInt(appMatch[1], 10) : undefined;
    const chatId = appMatch[2];
    const prefix = accountIndex !== undefined ? `/u/${accountIndex}` : '';
    const normalizedUrl = `https://gemini.google.com${prefix}/app/${chatId}`;

    const ref: BroChatRef = {
      url: normalizedUrl,
      chatId,
      accountIndex
    };

    return {
      valid: true,
      normalizedUrl,
      ref
    };
  }

  if (gemMatch) {
    const accountIndex = gemMatch[1] !== undefined ? parseInt(gemMatch[1], 10) : undefined;
    const gemId = gemMatch[2];
    const chatId = gemMatch[3];
    const prefix = accountIndex !== undefined ? `/u/${accountIndex}` : '';
    const normalizedUrl = `https://gemini.google.com${prefix}/gem/${gemId}/${chatId}`;

    const ref: BroChatRef = {
      url: normalizedUrl,
      chatId,
      accountIndex,
      gemId
    };

    return {
      valid: true,
      normalizedUrl,
      ref
    };
  }

  return {
    valid: false,
    error: 'MISSING_CHAT_ID',
    message: '路徑必須包含特定的對話 Chat ID（例如 /app/<id> 或 /gem/<gemId>/<id>），首頁或無效路徑無法做為 Bro Chat。'
  };
}
