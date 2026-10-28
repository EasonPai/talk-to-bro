# #27: [talk-to-bro-personally] 03: M1 — Extension Skeleton, Manifest V3 & Options Validation

## Parent
Part of #24

## What to build
Scaffold the production extension structure, Manifest V3 configuration, esbuild bundling pipeline, Options page with strict Bro Chat URL validation, and Popup autofocus with the global shortcut.

## Acceptance criteria
- [ ] MV3 manifest.json configured with permissions (storage, tabs, scripting, alarms, offscreen, clipboardWrite), host_permissions (https://gemini.google.com/*), and _execute_action shortcut (Alt+Shift+B).
- [ ] Build script (scripts/build.mjs) bundles TS into ESM SW, IIFE adapter, popup, options, and offscreen pages without runtime framework dependencies.
- [ ] Options page (options.html / options.ts) strictly validates validateBroChatUrl (HTTPS, exact hostname gemini.google.com, no user/pass, valid chat path) and persists to settings:v1 in chrome.storage.local. Rejects evil/spoofed URLs.
- [ ] Popup autofocus verified: pressing shortcut Alt+Shift+B opens popup with input automatically focused and ready for typing (F1).
- [ ] Unit tests for validateBroChatUrl pass with 100% boundary coverage.

## Blocked by
#26 - [talk-to-bro-personally] 02: M0-B Spike — SW Watchdog & Recovery Protocol
