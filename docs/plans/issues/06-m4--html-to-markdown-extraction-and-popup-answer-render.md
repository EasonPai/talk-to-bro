# #30: [talk-to-bro-personally] 06: M4 — HTML to Markdown Extraction & Popup Answer Render

## Parent
Part of #24

## What to build
Extract the latest model turn into clean Markdown while preserving citations and links, and render the complete answer in Popup with GFM Markdown, safe HTML sanitization, and one-click copy.

## Acceptance criteria
- [ ] html-to-md.ts extracts only the target model turn, stripping thoughts and UI noise (button, mat-icon) while faithfully preserving headers, lists, bold text, tables, and external citation links.
- [ ] Golden tests verify HTML fixtures convert to identical expected .md without text truncation or rewrite (F3).
- [ ] Popup renders Answer using bundled marked (GFM) and DOMPurify with strict CSP (script-src "self").
- [ ] One-click copy button copies raw stored Markdown to clipboard.
- [ ] Last Talk restoration (F5): reopening Popup immediately restores previous Talk input, Markdown Answer, or active loading state from runtime:v1.lastTalk.

## Blocked by
#29 - [talk-to-bro-personally] 05: M3 — Real Bro Adapter, Selector Isolation & Tab Lifecycle
