# M3 Implementation Plan: Real Bro Adapter, Selector Isolation & Tab Lifecycle

**Ticket**: [GitHub Issue #29: 05: M3 — Real Bro Adapter, Selector Isolation & Tab Lifecycle](https://github.com/EasonPai/agentic-development/issues/29)  
**Parent Epic**: [GitHub Issue #24](https://github.com/EasonPai/agentic-development/issues/24)  
**Date**: 2026-10-29  
**Author**: Engineer  
**Status**: Ready for Review (PM / CTO)

---

## 1. Objectives & Boundaries

The purpose of M3 is to implement the real Gemini web client DOM interaction layer and Chrome MV3 background tab lifecycle manager, replacing the `FakeAdapter` from M2 with a robust, production-grade `BroAdapter` connected to an isolated content script.

### Pragmatic Engineering Boundaries (CTO Pragmatic Scope)
- **Included in M3**:
  1. Complete DOM selector isolation with multiple fallback selectors (`selectors.ts`).
  2. Tab finder, creator, pinner, and cacher (`ensureBroTab`) matching `/u/N` and `chatId` without stealing user focus.
  3. `checkReady` checking signed-in status, URL match, and draft protection (leaving non-matching existing drafts untouched and returning `EDITOR_BUSY`).
  4. Text insertion via `document.execCommand("insertText")` with NFC text normalization.
  5. Send dispatch and turn verification with baseline tagging and `userTurnVerified: true` (F2, F7).
  6. Real `BroAdapter` bridge in SW connecting Runner to the tab via `chrome.tabs.sendMessage`.
  7. Automated unit test suite with >=90% test coverage and CfT live verification.
- **Excluded / Deferred (Anti-Scope-Creep)**:
  - Markdown AST extraction, cleanup, and rich formatting (deferred to M4).
  - Popup full answer rendering & PiP streaming display (deferred to M4).
  - Network proxy interception, cookie spoofing, or cross-origin injection.

---

## 2. Proposed Architecture & Component Design

```
+--------------------------------------------------------------------------+
| Service Worker (Background)                                              |
|                                                                          |
|  +--------------------+        +--------------------+                    |
|  |   TalkRunner (M2)  | -----> |   RealBroAdapter   |                    |
|  +--------------------+        +--------------------+                    |
|                                          |                               |
|                                          | chrome.tabs.sendMessage       |
|                                          v                               |
+------------------------------------------|-------------------------------+
                                           |
+------------------------------------------|-------------------------------+
| Gemini Web Page (Isolated Content Script)|                               |
|                                          v                               |
|  +--------------------------------------------------------------------+  |
|  | content.ts                                                         |  |
|  |   - checkReady()       (Sign-in check, Draft protection)          |  |
|  |   - insertAndSend()    (execCommand insertText, click send button) |  |
|  |   - probe()            (streaming length, generating flag, turns)  |  |
|  |   - extract()          (raw HTML container retrieval)             |  |
|  +--------------------------------------------------------------------+  |
|                                  |                                       |
|                                  v                                       |
|  +--------------------------------------------------------------------+  |
|  | selectors.ts                                                       |  |
|  |   Multi-candidate CSS selectors for custom elements & Shadow DOM   |  |
|  +--------------------------------------------------------------------+  |
+--------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### AC1: Selector Isolation (`src/adapter/selectors.ts`)
Isolate all CSS selectors into candidate arrays with robust fallbacks:
```typescript
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
```
Helper query functions (`queryOne(key)`, `queryAll(key)`) iterate candidates sequentially.

### AC2: Bro Tab Lifecycle Management (`src/sw/tab.ts`)
- **Normalized URL matching**: Extracts `chatId` and user prefix `/u/N` using regex:
  `^https:\/\/gemini\.google\.com(?:\/u\/(\d+))?\/app\/([a-zA-Z0-9_-]+)`
- **`ensureBroTab(targetUrl: string)` algorithm**:
  1. Query active tabs via `chrome.tabs.query({ url: "*://gemini.google.com/*" })`.
  2. If a tab matches the exact normalized `chatId` (and account index if present):
     - Check if tab is cached in `session:v1` (`session.broTab`).
     - Update cache with `{ tabId, windowId }`.
     - Ensure tab is pinned (`chrome.tabs.update(tabId, { pinned: true })` if not pinned).
     - Return `{ ok: true, tabId }`.
  3. If no matching tab exists:
     - Create a new background pinned tab:
       `chrome.tabs.create({ url: targetUrl, active: false, pinned: true })`.
     - Await tab load completion (`status === 'complete'`) with a bounded timeout (15s).
     - Cache in `session:v1`.
     - Return `{ ok: true, tabId }`.
  4. Focus protection: Never pass `active: true` during creation or reuse; active user window/tab focus is strictly preserved.

### AC3: `checkReady`, Sign-in Verification & Draft Protection (`src/adapter/content.ts`)
- When `checkReady` is received:
  1. Inspect `signIn` selectors: if found, return `{ ok: false, code: 'NOT_SIGNED_IN' }`.
  2. Inspect current location `window.location.href`: if chatId mismatch, return `{ ok: false, code: 'BRO_CHAT_MISSING' }`.
  3. Inspect `editor` selector: if missing, return `{ ok: false, code: 'INPUT_NOT_FOUND' }`.
  4. Inspect `stopButton`: if visible and not `display: none`, return `{ ok: false, code: 'EDITOR_BUSY' }`.
  5. **Draft Protection (F5)**:
     - Read current `editor.innerText`.
     - Normalize text (`normalizeText(editor.innerText)`).
     - If text is non-empty and does NOT equal `normalizeText(incomingPrompt)`:
       - **Preserve Draft**: Do NOT clear or overwrite `editor.innerHTML`.
       - Return `{ ok: false, code: 'EDITOR_BUSY', reason: 'User draft present in editor' }`.
  6. Return `{ ok: true }`.

### AC4: Text Insertion via `document.execCommand("insertText")`
- Algorithm in `insertAndSend(text: string)`:
  1. Mark baselines (`markBaselines()` sets `data-ttb-seen="1"` on all existing user and model turns).
  2. Focus editor: `editor.focus()`.
  3. Select all contents:
     ```typescript
     const selection = window.getSelection();
     const range = document.createRange();
     range.selectNodeContents(editor);
     selection?.removeAllRanges();
     selection?.addRange(range);
     ```
  4. Execute `document.execCommand('insertText', false, text)`.
  5. Verify insertion:
     If `normalize(editor.innerText) !== normalize(text)`:
     Fallback to synthetic paragraph injection with `InputEvent`:
     ```typescript
     editor.innerHTML = `<p>${escapeHtml(text)}</p>`;
     editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
     ```
  6. Confirm `normalize(editor.innerText) === normalize(text)`.

### AC5: Submit Verification (F2, F7)
- Locate `sendButton`:
  - Poll for enabled send button (up to 3,000ms, 100ms intervals).
  - If disabled or missing, dispatch `Enter` `KeyboardEvent`.
  - Otherwise, call `sendButton.click()`.
- User turn confirmation:
  - Poll for new `userTurn` element without `data-ttb-seen="1"` (up to 5,000ms).
  - Verify `normalize(newTurn.textContent).includes(normalize(text))`.
  - Return `{ ok: true, userTurnVerified: true, sentAt: Date.now() }`.

### RealBroAdapter Bridge (`src/sw/adapter-real.ts`)
Implements `BroAdapter` interface for `TalkRunner`:
```typescript
export class RealBroAdapter implements BroAdapter {
  constructor(private targetUrl: string) {}

  async checkReady(args: { chatId: string; text: string }): Promise<ReadyResult>;
  async send(args: { talkId: string; text: string }): Promise<SendResult>;
  async probe(args: { talkId: string; text: string }): Promise<ProbeResult>;
  async extract(args: { talkId: string; text: string }): Promise<ExtractResult>;
}
```
All calls ensure tab availability via `ensureBroTab(this.targetUrl)` and forward requests to the content script via `chrome.tabs.sendMessage`.

---

## 4. Build Configuration & Manifest Updates

1. Update `scripts/build.mjs`:
   - Add `src/adapter/content.ts` to esbuild entry points, compiling to `dist/content.js`.
2. Update `src/manifest.json`:
   - Register content script:
     ```json
     "content_scripts": [
       {
         "matches": ["https://gemini.google.com/*"],
         "js": ["content.js"],
         "run_at": "document_idle"
       }
     ]
     ```
   - Ensure permissions include `"tabs"`, `"scripting"`, `"storage"`, `"alarms"`.
   - Host permissions include `"https://gemini.google.com/*"`.

---

## 5. Verification Plan

### Automated Unit Tests
- `tests/unit/selectors.test.ts`:
  - Verify selector lists contain expected fallback classes and attributes.
  - Test `queryOne` / `queryAll` matching priority.
- `tests/unit/tab.test.ts`:
  - Test `ensureBroTab` with fake Chrome Tabs API.
  - Test `/u/N` multi-account normalization and tab reuse.
  - Verify pinned tab creation without focus stealing (`active: false`).
- `tests/unit/content-adapter.test.ts`:
  - Test `checkReady` with mock DOM: signed out, editor busy, draft present rejection.
  - Test `insertAndSend` text insertion, normalization, and user turn verification.
  - Test `probe` generating state detection.
- `tests/unit/adapter-real.test.ts`:
  - Test `RealBroAdapter` wrapping `chrome.tabs.sendMessage` with error mapping (`TAB_CLOSED`, `TAB_UNRESPONSIVE`).

### Integration & CfT Verification
- Run `npm test` to verify >=90% test coverage across all M3 components.
- Run `npm run build` and `npm run verify` to confirm M1 and MV3 bundle validity.
- Verify live content script injection and communication on Chrome for Testing instance (port 9222).

---

## 6. Review Gate

This implementation plan is submitted for PM and CTO review. Once approved, implementation will proceed systematically.
