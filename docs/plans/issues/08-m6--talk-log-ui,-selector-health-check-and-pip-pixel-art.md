# #32: [talk-to-bro-personally] 08: M6 — Talk Log UI, Selector Health Check & Pip Pixel Art

## Parent
Part of #24

## What to build
Implement the Options page metrics dashboard (sent-in / read-back success rates), selector health check diagnostic tool, Pip character sprite UI with 5 emotional states, and local developer documentation.

## Acceptance criteria
- [ ] Options page displays "Sent In" and "Read Back" success rates with exact numerator/denominator and "No samples yet" empty state (F8).
- [ ] Selector health check (selfCheck()) renders real-time traffic lights for each Gemini selector in selectors.ts.
- [ ] Pip character UI renders 5 emotional states (door, waiting, boss_speaks, scared, ignored) derived purely from Talk state with Roguelike status bar.
- [ ] Pixel typography applied to UI chrome/buttons (subsetted font), while Answer body retains readable standard system fonts.
- [ ] Comprehensive local README.md documenting installation, unpacking, Bro Chat setup, selector maintenance guide, and troubleshooting.

## Blocked by
#31 - [talk-to-bro-personally] 07: M5 — Failure Detection Matrix, Watchdog Recovery & Offscreen Handoff
