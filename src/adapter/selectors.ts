// src/adapter/selectors.ts

export interface DomSelectors {
  editor: string[];
  sendButton: string[];
  stopButton: string[];
  userTurn: string[];
  userTurnText: string[];
  modelTurn: string[];
  modelBody: string[];
  modelDone: string[];
  signIn: string[];
}

export const SELECTORS: DomSelectors = {
  editor: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[aria-label*="prompt" i]',
    '#mock-editor'
  ],
  sendButton: [
    'button.send-button:not(.stop)',
    'button[aria-label*="Send" i]',
    'button[aria-label*="傳送" i]',
    'button[mattooltip*="Send" i]',
    '#mock-send-btn'
  ],
  stopButton: [
    'button.send-button.stop',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="停止" i]',
    '#mock-stop-btn'
  ],
  userTurn: [
    'user-query',
    '.user-query',
    '[data-turn-type="user"]'
  ],
  userTurnText: [
    '.query-text',
    'user-query-content',
    '.query-content'
  ],
  modelTurn: [
    'model-response',
    '.model-response',
    '[data-turn-type="model"]'
  ],
  modelBody: [
    'message-content .markdown',
    '.model-response-text .markdown',
    '.model-body-content'
  ],
  modelDone: [
    'message-actions',
    '.response-footer',
    '.model-done-actions'
  ],
  signIn: [
    'a[href*="ServiceLogin"]',
    'a[href*="accounts.google.com"][href*="signin" i]'
  ]
};

/**
 * Queries the first matching element from the candidate selector list.
 */
export function queryOne<T extends Element = HTMLElement>(
  key: keyof DomSelectors,
  root: ParentNode = document
): T | null {
  const list = SELECTORS[key] || [];
  for (const selector of list) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Queries all matching elements for the candidate selector list.
 */
export function queryAll<T extends Element = HTMLElement>(
  key: keyof DomSelectors,
  root: ParentNode = document
): T[] {
  const list = SELECTORS[key] || [];
  for (const selector of list) {
    const els = root.querySelectorAll<T>(selector);
    if (els && els.length > 0) {
      return Array.from(els);
    }
  }
  return [];
}
