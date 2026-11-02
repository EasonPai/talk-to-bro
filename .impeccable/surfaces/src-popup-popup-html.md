---
version: 1
slug: "src-popup-popup-html"
primary_target: "src/popup/popup.html"
related_targets: ["src/popup/popup.css","src/popup/popup.ts","src/popup/zoom.ts"]
---

# Popup Design Implementation

## Approval and Source

Status: COMPLETED — approved Operate refinement implemented, independently
reviewed with disposition **ship**, and documented on 2026-10-29.
Mode: Operate. This is isolated-renderer completion, not actual extension-host
or real Gemini end-to-end acceptance.
The user requested implementation of the confirmed
`2026-10-29-popup-design-shape.md` brief on 2026-10-29.
Work only in `.worktrees/talk-to-bro-personally-dev`.

## Changes

1. Rework `src/popup/popup.html` and `popup.css` into a compact Pip/status header,
   persistent Talk input, and primary Answer/error region. Preserve existing
   element IDs, factual copy, controls and interaction order.
2. Keep the existing Pip emoji as a consistent provisional portrait; use its
   frame/state treatment rather than replacing it with unrelated emoji.
   Do not invent final character artwork. Expose view-only phase/mood information
   in `popup.ts` for styling and accessible status, without changing Talk,
   clipboard, submission, focus, restoration or Handoff policy.
3. Use a 400px baseline width, readable 15px Answer typography, bounded flexible
   reading height, persistent Answer actions, local table/code overflow,
   visible keyboard focus and reduced-motion support. Keep the active-tab zoom
   integration; update its shared base-width constant and dependent tests so the
   800px maximum remains correct.
4. Add focused Popup rendering tests for stable character identity, phase/status
   presentation and preservation of Answer/Handoff behavior. Reuse existing
   test/build tooling; do not install dependencies speculatively.

## Approved validation plan

- Read the Impeccable craft floor immediately before UI edits.
- Inspect an isolated rendered baseline before editing. Browser inspection uses
  the existing CfT on port 9222; do not control the daily-use browser.
- Run TypeScript checks, relevant Popup/zoom/failure tests, and a production
  build. Do not run older verification scripts that overwrite `spikes/m0-b`,
  reload the shared extension, or seed its real storage.
- Verify idle, waiting, complete, errors and Handoff variants, long Markdown,
  wide tables/code, copy and keyboard controls at 400px/360px and 100%/150%/200%
  zoom with reduced-motion checks. Use synthetic data in an isolated test page,
  not real Gemini queries or real extension storage.
- Run the bundled Impeccable detector once over the finished Popup; distinguish
  detector warnings from verified rendered failures.
- Review the diff and preserve all pre-existing worktree changes. Record results
  and limitations here. Real Gemini send/read acceptance remains separate.

## Boundaries

No background/adapter/Options changes, timeout changes, permission/CSP edits,
new features, global installs, commits, merge, or push.
Do not overwrite dirty spike files. No live picker injection.
This is an extension of the existing visual system, not a new identity:
do not create or replace `DESIGN.md` as an incidental task.
Shared graph rebuilds are not part of this UI implementation; record outstanding
documentation/index work rather than replacing unrelated dirty graph outputs.

## Direction contract

THESIS: Pip carries the Talk; the complete Answer owns the reading space.
Refuse a large character scene or a stack of equally weighted cards.

OWN-WORLD: Retain the charcoal ground and cool blue accent. A small stepped
portrait frame carries the existing provisional Pip; ordinary readable controls
and text carry the task. State is expressed with text and a small frame marker.

STORY: Open, type, press Enter, wait on truthful state, read and copy. A failure
shows its cause and existing Handoff controls without changing their policy.

FIRST VIEWPORT: A compact identity/status row and settings control above the
persistent input. The completed Answer gets the remaining bounded height;
its copy toolbar remains visible while only the answer body scrolls.

FORM: Approved local Popup refinement, code-led, with no concept lottery or
replacement world. seed: none (unavailable).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This ordinary extension preserves the existing design-file state: no new global
DESIGN.md or raster assets are authorized. Documentation records the scoped
changes and the unchanged identity instead.

## Completed snapshot and evidence

Canonical completion record:
`docs/plans/2026-10-29-popup-design-implementation.md`, including incumbent
source/token comparison, exact validation commands, five-section finish review,
documentation outcome and limitations.

- Shipped local refinement: compact Pip/status header, persistent Talk input,
  Answer-led remaining height and fixed copy toolbar; 400px baseline, 15px
  Answer body, local table/code overflow, visible focus and reduced motion.
  Existing charcoal/cool-blue identity and factual behavior remain. The same
  fox emoji is approved as provisional Pip only, not a final species choice.
- Existing Enter/Shift+Enter/IME, Last Talk, exact Answer/copy and 1.5-second
  Handoff policy remain; no background/Options/CSP/permission change.
- Supplied builder validation passed: local TypeScript, unit zoom/failure
  tests (6), Popup renderer tests (6), production build and `git diff --check`.
  Node was `/opt/homebrew/bin/node` v23.9.0; CfT 156.0.8078.47 used CDP 9222.
  No tests or detector were rerun for documentation.
- Actual HTML/CSS and bundled Popup TS ran in owned `about:blank` targets with
  synthetic Chrome/clipboard APIs; all targets were closed. The long-Answer
  matrix covered 400/360 base widths × zoom 1/1.5/2, <=600px physical height and
  <=800px width, readable base type, scrolling and persistent input/copy.
  Separate state/Handoff/copy/Last Talk/IME/keyboard/reduced-motion checks
  passed; not every state ran at every size and no cross-product suite ran.
- Evidence is at worktree-relative `.scratch/impeccable/talk-popup/`:
  `baseline.png` plus 13 final captures (idle, waiting, Answer, six long-Answer
  matrix captures and pending/cancelled/deferred/partial Handoff), all viewed
  by builder and independent reviewer.
- Detector ran once, exit 2; `detector.json` records one input-card padding
  warning for `calc(12px / var(--ttb-zoom, 1))`. Reviewer judged the rendered
  inset correct, not a material defect. No clean-detector claim.
- Fresh independent finish verdict: **ship**, persistence pass, fidelity match,
  approved Operate ceiling reached, material fixes none. Preserve identity,
  exact Answer, keyboard/IME, local overflow, reduced motion and Handoff.
- Documenter compared current Popup sources and committed incumbent CSS.
  Absent worktree/product `DESIGN.md` and `.impeccable/design.json` remain
  absent; no shared tokens/system migration or shipping raster. Asset
  provenance is not applicable; provisional character art is not canonized.
- Actual toolbar popup-host and real Gemini send/read acceptance remain
  unverified. Shared Graphify/CodeGraph coverage remains stale/not synced;
  no shared-index rebuild, dependency installation, shared-extension reload,
  spike overwrite, commit, merge or push. Unrelated dirty work is preserved.
- Documentation skills: `impeccable` → `impeccable_documenter` role +
  `document` reference. Supplied upstream reviewer chain: `impeccable` →
  `impeccable_finish_reviewer` role + `craft-floor` reference (not reread here).
  No nested agent, unrelated skill or UI re-review in this handoff.
