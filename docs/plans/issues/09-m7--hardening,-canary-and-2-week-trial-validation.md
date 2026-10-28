# #33: [talk-to-bro-personally] 09: M7 — Hardening, Canary & 2-Week Trial Validation

## Parent
Part of #24

## What to build
Remove development debug overrides, build release-ready v0.1.0 unpacked extension bundle, establish daily canary checklist, and validate against PRD success metrics over the 2-week trial.

## Acceptance criteria
- [ ] Clean build: remove debug defaults, enforce strict TS compile with zero warnings, package unpacked v0.1.0.
- [ ] 10-minute manual sanity check verified: F1-F8 manual validation, IME composition Enter keydown, background tab hidden > 5 minutes, consecutive queries, long chat history query.
- [ ] Daily canary procedure documented and verified: "Pip Knocks on Door" and selector health checks pass without red indicators.
- [ ] 2-week trial metric tracking: verify query operation reduced from 6 steps to 2 steps, weekly volume >= 20 queries, and zero manual tab switching required.

## Blocked by
#32 - [talk-to-bro-personally] 08: M6 — Talk Log UI, Selector Health Check & Pip Pixel Art
