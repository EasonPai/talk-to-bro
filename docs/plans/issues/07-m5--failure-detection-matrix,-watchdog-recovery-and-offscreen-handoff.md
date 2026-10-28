# #31: [talk-to-bro-personally] 07: M5 — Failure Detection Matrix, Watchdog Recovery & Offscreen Handoff

## Parent
Part of #24

## What to build
Implement exhaustive error detection covering all 14 FailureCodes, 30s idle and 180s total timeouts, offscreen document clipboard copying when popup is closed, and smooth handoff to Bro Chat tab.

## Acceptance criteria
- [ ] Exhaustive failures.ts mapping all 14 FailureCodes with exact Pip states and user-facing messages (type-checked with never).
- [ ] evaluateTick pure function strictly enforces 30s idle timeout (from last text growth/hash change) and 180s total timeout from sentAt.
- [ ] Handoff with Popup open: displays countdown notice, writes clipboard via navigator.clipboard, switches to Bro Chat tab and focuses window.
- [ ] Handoff with Popup closed: launches offscreen.html with reason CLIPBOARD, copies Talk text, switches to Bro Chat tab, and displays non-intrusive shadow DOM notice on Gemini page.
- [ ] Browser restart INTERRUPTED failure marks Handoff as deferred until user next opens Popup, preventing unexpected focus jumps on startup.
- [ ] Fault injection tests via debug:v1.forceFailure verify every code produces non-blank UI, clipboard content, and active tab switch (F4).

## Blocked by
#30 - [talk-to-bro-personally] 06: M4 — HTML to Markdown Extraction & Popup Answer Render
