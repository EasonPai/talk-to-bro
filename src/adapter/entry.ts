// src/adapter/entry.ts
// Bro Adapter IIFE Entrypoint (injected on-demand into ISOLATED world)
import { queryOne, queryAll } from './selectors.ts';
import { validateBroChatUrl } from '../shared/validate.ts';
import { htmlToMarkdown } from './html-to-md.ts';

declare const __TTB_BUILD_ID__: string;
export const BUILD_ID = typeof __TTB_BUILD_ID__ !== 'undefined' ? __TTB_BUILD_ID__ : 'ttb-build-0.1.0-dev';

/**
 * Normalizes text string for reliable DOM comparison (NFC and newlines only).
 * Strictly preserves spaces and tabs so distinct drafts (e.g. "a  b" vs "a b")
 * are not falsely treated as equal and raw text reaches Gemini unchanged.
 */
export function normalizeText(str: string | null | undefined): string {
  return (str || '')
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/, '');
}

/**
 * Checks whether a draft is empty (pure whitespace or null/empty).
 */
export function isDraftEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}

/**
 * Tags existing user and model turns to mark the baseline before new user turn submission.
 */
export function markBaselines() {
  const userTurns = queryAll('userTurn');
  const modelTurns = queryAll('modelTurn');
  for (const el of userTurns) {
    el.setAttribute('data-ttb-seen', '1');
  }
  for (const el of modelTurns) {
    el.setAttribute('data-ttb-seen', '1');
  }
  return { userCount: userTurns.length, modelCount: modelTurns.length };
}

/**
 * Performs readiness check, verifying sign-in, URL match, and draft protection.
 */
export async function checkReady(args: { chatId?: string; text?: string; targetUrl?: string }) {
  if (queryOne('signIn')) {
    return { ok: false, code: 'NOT_SIGNED_IN' };
  }

  if (args.targetUrl) {
    const currentRef = validateBroChatUrl(window.location.href);
    const targetRef = validateBroChatUrl(args.targetUrl);
    if (!currentRef || !targetRef || currentRef.normalizedUrl !== targetRef.normalizedUrl) {
      return { ok: false, code: 'BRO_CHAT_MISSING', reason: 'Current URL does not match target chat URL' };
    }
  }

  const editor = queryOne<HTMLElement>('editor');
  if (!editor) {
    return { ok: false, code: 'INPUT_NOT_FOUND', reason: 'Editor element not found' };
  }

  const stopBtn = queryOne('stopButton');
  if (stopBtn && getComputedStyle(stopBtn).display !== 'none') {
    return { ok: false, code: 'EDITOR_BUSY', reason: 'Bro is currently generating response' };
  }

  // Draft protection: If editor already has non-empty text that doesn't match prompt, preserve it!
  const existingText = editor.innerText || '';
  if (!isDraftEmpty(existingText) && normalizeText(existingText) !== normalizeText(args.text || '')) {
    return { ok: false, code: 'EDITOR_BUSY', reason: 'User draft present in editor' };
  }

  return { ok: true };
}

/**
 * Safely inserts text via document.execCommand("insertText") and dispatches submission.
 */
export async function insertAndSend(text: string) {
  const editor = queryOne<HTMLElement>('editor');
  if (!editor) {
    return { ok: false, code: 'INPUT_NOT_FOUND', reason: 'Editor not found' };
  }

  // 1. Immediate Draft Re-check before DOM selection/mutation
  const existingDraft = editor.innerText || '';
  if (!isDraftEmpty(existingDraft) && normalizeText(existingDraft) !== normalizeText(text)) {
    return { ok: false, code: 'EDITOR_BUSY', reason: 'User draft present in editor prior to insert' };
  }

  // 2. Mark baselines on existing turns
  markBaselines();

  // 3. Focus and select content
  editor.focus();
  let inserted = false;
  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    inserted = document.execCommand('insertText', false, text);
    try {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {}
  } catch {
    inserted = false;
  }

  // 4. Verify insertion strictly (NFC + newline normalized equality)
  if (!inserted || normalizeText(editor.innerText) !== normalizeText(text)) {
    return {
      ok: false,
      code: 'INPUT_NOT_FOUND',
      reason: 'Raw text insertion verification failed; default innerHTML fallback disallowed'
    };
  }

  // 5. Locate send button (poll up to 3,000ms)
  const startTime = Date.now();
  let sendBtn: HTMLElement | null = null;
  while (Date.now() - startTime < 3000) {
    sendBtn = queryOne<HTMLElement>('sendButton');
    if (sendBtn && !(sendBtn as any).disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
      break;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!sendBtn || (sendBtn as any).disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
    return { ok: false, code: 'EDITOR_BUSY', reason: 'Send button disabled or unavailable' };
  }

  // 6. Click send button at most once
  sendBtn.click();

  // 7. Verify new post-baseline user turn with exact normalized equality
  const waitTurnStart = Date.now();
  let verifiedUserTurn = false;
  while (Date.now() - waitTurnStart < 5000) {
    const userTurns = queryAll('userTurn');
    const newTurns = userTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
    if (newTurns.length > 0) {
      const latestTurn = newTurns[newTurns.length - 1];
      const lines = queryAll<HTMLElement>('userTurnText', latestTurn);
      const observedText = lines.length > 0
        ? lines.map(l => (l.textContent || '').trim()).join('\n')
        : (latestTurn.textContent || '').replace(/^你說了\s*/, '').trim();
      if (normalizeText(observedText) === normalizeText(text)) {
        verifiedUserTurn = true;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (!verifiedUserTurn) {
    return { ok: false, code: 'SUBMIT_UNCONFIRMED', reason: 'Matching user turn not observed' };
  }

  return { ok: true, userTurnVerified: true, sentAt: Date.now() };
}

/**
 * Probes active turn state and text streaming progress.
 */
export function probe() {
  const editor = queryOne('editor');
  if (!editor) {
    return {
      page: queryOne('signIn') ? 'signed_out' : 'loading',
      turn: 'not_found',
      generating: false,
      textLength: 0,
      textSig: '',
      quota: false
    };
  }

  const stopBtn = queryOne('stopButton');
  const isGenerating = Boolean(stopBtn && getComputedStyle(stopBtn).display !== 'none');

  const modelTurns = queryAll('modelTurn');
  const newModelTurns = modelTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
  const activeModelTurn = newModelTurns.length > 0 ? newModelTurns[newModelTurns.length - 1] : null;

  let textLen = 0;
  let hasDoneAction = false;
  let rawHtml = '';

  if (activeModelTurn) {
    const body = queryOne('modelBody', activeModelTurn) || activeModelTurn;
    textLen = (body.textContent || '').length;
    rawHtml = body.innerHTML || '';

    const doneEl = queryOne('modelDone', activeModelTurn);
    hasDoneAction = Boolean(doneEl && getComputedStyle(doneEl).display !== 'none');
  }

  let turnState: 'not_found' | 'pending' | 'streaming' | 'complete' = 'not_found';
  if (activeModelTurn) {
    if (isGenerating) {
      turnState = 'streaming';
    } else if (hasDoneAction && textLen > 0) {
      turnState = 'complete';
    } else if (textLen > 0) {
      turnState = 'streaming';
    } else {
      turnState = 'pending';
    }
  }

  return {
    page: 'ready',
    turn: turnState,
    generating: isGenerating,
    textLength: textLen,
    textSig: `${textLen}:${rawHtml.slice(0, 100)}`,
    quota: false
  };
}

/**
 * Extracts and converts model body HTML to high-fidelity Markdown.
 */
export function extract() {
  const modelTurns = queryAll('modelTurn');
  const newModelTurns = modelTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
  const activeModelTurn = newModelTurns.length > 0 ? newModelTurns[newModelTurns.length - 1] : null;

  if (!activeModelTurn) {
    return { error: 'EXTRACT_FAILED', reason: 'Model turn element not found' };
  }

  const body = queryOne('modelBody', activeModelTurn) || activeModelTurn;
  const rawHtml = body.innerHTML || '';
  const markdown = htmlToMarkdown(body as HTMLElement);
  return { markdown, html: rawHtml };
}

// Runtime IIFE Initialization in Browser / ISOLATED World
if (typeof window !== 'undefined') {
  const guardKey = `__ttb_${BUILD_ID}__`;

  if (!(window as any)[guardKey]) {
    (window as any)[guardKey] = true;

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.action === 'TTB_PING') {
          sendResponse({ ok: true, buildId: BUILD_ID });
          return false;
        }

        if (msg.action === 'TTB_CHECK_READY') {
          checkReady(msg).then(sendResponse);
          return true;
        }

        if (msg.action === 'TTB_INSERT_AND_SEND') {
          insertAndSend(msg.text).then(sendResponse);
          return true;
        }

        if (msg.action === 'TTB_PROBE') {
          sendResponse(probe());
          return false;
        }

        if (msg.action === 'TTB_EXTRACT') {
          sendResponse(extract());
          return false;
        }
      });
    }

    console.log('[BroAdapter] Adapter initialized with build ID:', BUILD_ID);
  }
}
