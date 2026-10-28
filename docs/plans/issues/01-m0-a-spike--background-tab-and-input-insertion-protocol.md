# #25: [talk-to-bro-personally] 01: M0-A Spike — Background Tab & Input Insertion Protocol

## Parent
Part of #24

## What to build
Build a disposable minimal prototype extension (SW + adapter prototype, hardcoded Bro Chat URL) to verify the most critical browser background tab behaviors and assumptions before committing to full architecture implementation.

## Acceptance criteria
- [ ] S1: Opening a pinned background tab does not steal window or input focus from the current active tab (chrome.tabs.create({ active: false, pinned: true })).
- [ ] S2: Background unviewed tab accepts programmatic text insertion via insertText / DOM events and submits successfully, producing a valid user turn.
- [ ] S3 (Go/No-go Gate): Verify streaming DOM updates in hidden background tab. Send a multi-word Talk (10 words) while tab is hidden > 5 minutes; verify textLength continuously increases and matches foreground rendering (proves background rAF / timer throttling does not freeze stream).
- [ ] S4: Verify Bro completion signal reliability (10 consecutive runs observing stop button and modelDone lifecycle without premature completion).

## Blocked by
None (can start immediately)
