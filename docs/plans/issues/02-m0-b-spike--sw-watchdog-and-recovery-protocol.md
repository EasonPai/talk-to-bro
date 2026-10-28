# #26: [talk-to-bro-personally] 02: M0-B Spike — SW Watchdog & Recovery Protocol

## Parent
Part of #24

## What to build
Verify SW lifecycle survival, browser discard/freeze recovery, HTML-to-Markdown conversion fidelity against real Gemini responses, and offscreen clipboard capabilities.

## Acceptance criteria
- [ ] S5: SW survives 3-minute streaming wait without timing out prematurely; alarm watchdog (chrome.alarms) and reconcile recover cleanly when SW is manually terminated (chrome://serviceworker-internals).
- [ ] S6: Tab discard and freeze recovery verified via chrome://discards; tab reloads cleanly before submit and restored pinned tabs are reused without duplicate tab spawns.
- [ ] S7: Markdown extraction fidelity verified against 5 real Gemini responses (tables, bold, lists, citations); golden tests show no content divergence.
- [ ] S8: Offscreen document clipboard copy (chrome.offscreen with CLIPBOARD reason) successfully copies Talk text to clipboard when popup is closed.
- [ ] S9: Capture and de-identify raw DOM fixtures (idle, streaming, done, signed-out, missing-chat) into test/fixtures/gemini/.

## Blocked by
#25 - [talk-to-bro-personally] 01: M0-A Spike — Background Tab & Input Insertion Protocol
