# Popup Design Implementation

## Approval and Source

Status: COMPLETED — approved refinement implemented, independently reviewed
with disposition **ship**, and documented on 2026-10-29. This is completion of
the scoped Popup refinement, not real extension/Gemini end-to-end acceptance.
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

## Final implementation and incumbent comparison

Documentation compared `PRODUCT.md`, the confirmed shape brief and approved
contract above against current `src/popup/popup.html`, `popup.css`, `popup.ts`
and `zoom.ts`, with the committed incumbent Popup CSS as the token reference.
This is an ordinary Operate extension, not a replacement visual world.

- The compact Pip/status/settings header and always-visible Talk input precede
  the Answer-led reading region. The Answer toolbar/copy control stays outside
  the scrolling body; wide tables and code scroll locally.
- Existing charcoal ground (`#121316`), card ground (`#1e2025`), main text
  (`#e6e8eb`) and system body-font stack remain. Local border/muted/accent
  adjustments (`#383d48`, `#a7afbd`, `#a6c8ff`, hover `#c4daff`) retain the
  incumbent dark/cool-blue identity; they do not establish shared tokens.
- Answer body is 15px at 1.7 line height, with 20/18/16px Markdown headings,
  14px tables and 13/12/11px toolbar/control/support text. Readable ordinary
  type, restrained tonal layers, a small precise Pip frame and visible focus
  carry the refinement rather than new artwork or a display-font system.
- Baseline width is 400px, with 360px narrow-layout verification; zoom retains
  the 800px maximum. Flexible layout caps physical height at 600px and
  compensates spacing for zoom rather than retaining the old 240px Answer cap.
- Pip remains the same fox emoji across phases, explicitly approved only as a
  provisional portrait, not a final species choice. Phase/busy attributes,
  accessible status and small frame/motion treatments express true state;
  reduced-motion disables the waiting animation and portrait transition.
- Existing Answer rendering/copy, Enter, Shift+Enter, IME protection, Last Talk
  restoration, factual failure copy and Handoff policy remain. Handoff keeps
  its 1.5-second countdown, cancellation, deferred control and executed/partial
  outcomes; this pass does not change background delivery or readback.
- Implementation artifacts: `src/popup/{popup.html,popup.css,popup.ts,zoom.ts}`;
  focused tests: `tests/popup-ui.test.mjs` and `tests/unit/popup-zoom.test.ts`.

## Recorded validation results

The following are completed builder results supplied to this documenter handoff;
no tests, browser inspection or detector were rerun during documentation.

| Check | Recorded result |
| --- | --- |
| Runtime | `/opt/homebrew/bin/node` v23.9.0 |
| TypeScript | Local `tsc --noEmit` passed |
| Unit tests | `/opt/homebrew/bin/node --test tests/unit/popup-zoom.test.ts tests/unit/failures.test.ts` — 6 passed |
| Popup renderer tests | `/opt/homebrew/bin/node --test tests/popup-ui.test.mjs` — 6 passed |
| Production build | `PATH=/opt/homebrew/bin:$PATH npm run build` passed; `dist/` regenerated and ignored |
| Whitespace | `git diff --check` passed during implementation |

Browser evidence used CfT 156.0.8078.47 on CDP 9222. The owned `about:blank`
target rendered actual Popup HTML/CSS and esbuild-bundled Popup TypeScript with
synthetic Chrome and clipboard APIs, avoiding live extension storage and Gemini
calls. All owned targets were closed after tests.

The long Markdown/table/code Answer matrix covered base widths 400px and 360px
at zoom 1, 1.5 and 2: physical height <=600px, width <=800px, readable 15px
base type, Answer scrolling, and persistent input/copy controls. Separate
state/Handoff, copy, Last Talk, IME/keyboard and reduced-motion checks passed.
This does **not** mean every state was tested at every matrix size, or that a
full cross-product suite ran.

Evidence folder, relative to the worktree root:
`.scratch/impeccable/talk-popup/`.
It contains `baseline.png` and these 13 final captures:
`idle-400.png`, `waiting-400.png`, `answer-400.png`,
`long-answer-400-{1,1.5,2}.png`, `long-answer-360-{1,1.5,2}.png`,
`handoff-pending-400.png`, `handoff-cancelled-400.png`,
`handoff-deferred-400.png`, `handoff-partial-400.png`.
The builder and independent finish reviewer viewed all 13 final captures.

The detector ran **once**, exit **2**, with one cramped-padding warning for
`.input-card` using `calc(12px / var(--ttb-zoom, 1))`. The reviewer found the
intended rendered inset correct in the captures; the warning was unsupported
by the actual screenshots. `detector.json` remains in the evidence folder.
This is not a clean-detector claim, and the warning is not canonized as a new
system rule.

## Independent finish review

The fresh review is recorded from the supplied handoff, not repeated here.

1. **Persistence — pass:** PRODUCT and approved direction contract exist;
   all 13 final captures are valid; evidence is isolated-renderer scope only.
2. **Fidelity — match:** TYPE uses 15px Answer; MATERIAL keeps provisional Pip
   and a precise restrained frame; GROUND stays charcoal/cool blue.
   THESIS/FIRST VIEWPORT retain compact identity, persistent input and
   Answer-led space; STORY preserves truthful states/copy and unchanged
   Handoff; FORM/FINISH remain an ordinary code-led refinement without a new
   global design file or raster.
3. **Ceiling — reached:** the approved Operate refinement is complete within
   its scope; no new visual world or further material treatment is required.
4. **Material fixes — none:** the detector padding warning does not establish
   a rendered defect; no additional fixes were requested.
5. **Disposition — ship:** keep identity, exact Answer, keyboard/IME,
   local overflow, reduced motion and unchanged 1.5-second Handoff.
   This verdict is not real end-to-end acceptance.

## Documentation outcome, skills and limitations

- The documenter followed the shipped `impeccable_documenter.toml` role and
  read `reference/document.md` in full. Compared source and incumbent tokens
  support preservation, not a new global system. `DESIGN.md` and
  `.impeccable/design.json` are absent at both worktree and product roots;
  their absence is preserved intentionally, with no system migration.
- Skills actually read/applied in this documentation pass: **`impeccable` →
  `impeccable_documenter` role + `document` reference**. No nested agents or
  unrelated skills were invoked. The supplied upstream finish-review chain is
  **`impeccable` → `impeccable_finish_reviewer` role + `craft-floor` reference**;
  those upstream role/reference files were not reread in this pass.
  The approved implementation plan also records the builder's craft-floor
  requirement; no unreported builder skills are inferred.
- No shipping raster was added, so raster asset provenance is not applicable.
  Provisional Pip is not canonized as final character artwork. No new
  system-wide rule or defect workaround is promoted from this local surface.
- Actual extension-toolbar popup-host acceptance and real Gemini send/read
  end-to-end acceptance remain **unverified**. Synthetic renderer results
  cannot establish either, nor prove background Answer readback is fixed.
- No shared-extension reload, dirty spike overwrite, background/Options,
  CSP/permission change, dependency installation, commit, merge or push was
  performed for this refinement. Unrelated pre-existing dirty work is retained.
- Shared Graphify/CodeGraph coverage remains stale/not synced; dirty shared
  indexes were deliberately not rebuilt as a UI/documentation side effect.
- This documentation handoff updates only this implementation record and its
  surface snapshot. PRODUCT, source/tests and global design-file state remain
  untouched; documentation completes the scoped **ship** handoff.
