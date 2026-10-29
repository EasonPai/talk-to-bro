# #29: [talk-to-bro-personally] 05: M3 — Real Bro Adapter, Selector Isolation & Tab Lifecycle

## Parent
Part of #24

## What to build
Implement real Gemini DOM interaction in an isolated content script world, selector configuration with fallback candidates, and robust background tab management (finding, creating, pinning, and reusing Bro Chat).

## Acceptance criteria
- [ ] adapter/selectors.ts isolates all Gemini DOM selectors (custom elements, rich editor, buttons, turns) with multiple fallback candidates.
- [ ] ensureBroTab finds, caches, or creates a pinned background Bro Chat tab without stealing focus, matching account prefix /u/N and chatId.
- [ ] checkReady verifies signed-in state, chat URL match, and draft protection: existing non-matching text returns EDITOR_BUSY without clearing user drafts.
- [ ] Text insertion via document.execCommand("insertText") preserves raw text and verifies normalize(editor.innerText) === normalize(text).
- [ ] Submit verification: clicks send button after write-ahead, verifies matching new user-query turn with userTurnVerified: true (F2, F7).

## Blocked by
#28 - [talk-to-bro-personally] 04: M2 — Talk Runner Engine, Watchdog & Fake Adapter
