# #28: [talk-to-bro-personally] 04: M2 — Talk Runner Engine, Watchdog & Fake Adapter

## Parent
Part of #24

## What to build
Implement the core Talk state machine, write-ahead storage persistence, alarm watchdog, boot reconciliation, and Talk Log metrics pure functions, completely decoupled from DOM and verified with a FakeAdapter.

## Acceptance criteria
- [ ] Pure state transition function transition(talk, event, now) implemented with immutable terminal states (done, failed) and deadline enforcement.
- [ ] Write-ahead protocol: SW records phase before dispatching actions; single write to runtime:v1 updates lastTalk and deduplicated logByTalkId.
- [ ] Single entry boot() and reconcile() handle browser restart (session:v1), terminal mid-execution, and alarm watchdog (chrome.alarms) without duplicate sends.
- [ ] Pure function computeStats(log) accurately calculates sent-in rate and read-back rate with zero-division handling and active talk exclusion.
- [ ] Runner test suite passes with FakeAdapter simulating delays, streaming speeds, watchdog triggers, and failures with 90%+ unit test coverage.

## Blocked by
#27 - [talk-to-bro-personally] 03: M1 — Extension Skeleton, Manifest V3 & Options Validation
