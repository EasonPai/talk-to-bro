# Toolbar Popup Width Fix (102px collapse)

- **Date**: 2026-10-30
- **Author**: CTO (assignmentId `staff-20261030-cto-0930`, request `ceo-popup-width-diagnosis-20261030-1158`)
- **Status**: APPROVED by the Board (ask_user, relayed by CEO `ceo-approved-popup-width-20261030-1216`, recorded by PM 2026-10-30): fix, verify, and build and update the CDP test build (copy to `.scratch/talk-to-bro-personally/cft-ext`, reload extension `kppigaopbfjcdfcpobapdofifbkdgdom` on CDP 9222; no CfT relaunch). Deployment gate (section 5.3) approved. No commit/push/merge/deletion/data clearing. This does not accept the uncommitted popup redesign.
- **Stage**: M5 (feature). Acceptance follows the must cases below only.
- **Worktree**: `.worktrees/talk-to-bro-personally-dev`, HEAD `c6ede85`, with the uncommitted popup redesign kept as is.

## 1. Symptom

The Board reported that the real toolbar action popup renders text vertically and clips it. The popup page opened as a normal tab looks correct.

## 2. Root cause (runtime evidence)

The uncommitted redesign changed `src/popup/popup.css`:

```diff
 body {
-  width: 360px;
+  width: min(400px, calc(100vw / var(--ttb-zoom, 1)));
```

A Chrome action popup has no fixed viewport. Chrome sizes the popup window to the document's preferred width. The new rule makes the body width depend on `100vw`, which is the popup's own width. This is circular, so the layout settles near Chrome's minimum popup width (102px). In a normal tab, `100vw` is the tab width (over 400px), so the rule resolves to 400px and the bug does not show.

The existing `tests/popup-ui.test.mjs` opens `popup.html` in a tab with a fixed 400x600 viewport. That is the wrong surface, which is why it passed.

### Evidence

Probe: `.scratch/talk-to-bro-personally/popup-width/probe.mjs` (run with `node --experimental-websocket probe.mjs [--ab] [--zoom-ab]` on Node 20, or plain `node` on Node 22). It opens the real action popup through `chrome.windows.update(focused)` + `chrome.action.openPopup`, measures the new popup target, and exits 1 on `innerWidth < 300 || inputWidth < 200`, 2 when no real popup could be opened (inconclusive, never a pass).

| Run | innerWidth | body width | input width | --ttb-zoom |
| --- | --- | --- | --- | --- |
| Current artifact | 102 | 102px | 52 | 1 (active tab zoom really 1.0) |
| In-memory A/B: `body.style.width='400px'` | 400 | 400px | 350 | 1 |
| A/B fixed 400px + host zoom 1.25 | 500 | 400px | 450 | 1.25 |
| A/B fixed 400px + host zoom 2.0 | 800 | 400px | 748 | 2 |

The probe result on the current artifact was `FAIL` (exit 1) on three separate popup instances.

### Hypotheses ruled out

- **Zoom initialisation.** In the failing popup the active tab was a `file://` page with `chrome.tabs.getZoom = 1`, so `--ttb-zoom=1` is correct. Zoom does not cause the collapse.
- **Mixed scratch build.** `cft-ext/popup.css` and `popup.html` are byte-identical to `src/popup/`. The artifact (10:45) is newer than every popup source file (09:51).

## 3. Minimal fix

One line in `src/popup/popup.css`:

```css
body {
  width: 400px;
}
```

Why this is enough: `applyPopupZoom` sets `root.style.zoom = scale` with scale clamped to `[0.5, 2]` (`POPUP_MAX_WIDTH_PX / POPUP_BASE_WIDTH_PX`). A fixed 400 CSS px body yields 200 to 800 device-independent px, inside Chrome's 800px popup limit. The `100vw` clamp adds nothing except the circular dependency.

Not in scope: `max-height: calc(min(100dvh, 600px) / var(--ttb-zoom, 1))` on `.popup-container` has the same viewport dependency for height. No height defect is observed (A/B height 300 to 352). Recorded as a follow-up recommendation, not changed here.

## 4. Ticket

### T-popup-width: Real toolbar popup uses fixed base width

- **Change**: `src/popup/popup.css` body width only. No changes to `zoom.ts`, `popup.ts`, storage, service worker, or manifest.
- **Build source**: `npm run build` writes `products/talk-to-bro-personally/dist/`. Do not write into `.scratch/talk-to-bro-personally/cft-ext/` (the acceptance artifact) until the deployment gate below is approved.

| ID | Tag | Test case | Pass condition |
| --- | --- | --- | --- |
| TC1 | must | Run `probe.mjs` against the real action popup built from the fix | Exit 0. `innerWidth >= 300`, `inputWidth >= 200`. Exit 2 is inconclusive and must be rerun, not counted. |
| TC2 | must | Screenshot of the real popup | Placeholder, buttons and Last Talk text read horizontally. No vertical text or clipped labels. |
| TC3 | must | Host zoom: set the active tab zoom to 1.25 and 2.0 (`chrome.tabs.setZoom`), open the real popup | `--ttb-zoom` equals the tab zoom. `innerWidth` is 500 (+-2) and 800 (+-2). Restore zoom to the original value afterwards. |
| TC4 | must | State and authorisation preserved | `chrome.storage` contents (Last Talk, Bro Chat URL, Talk Log) are identical before and after the reload. No permission prompt and no manifest permission diff. |
| TC5 | must | `npm test` | Existing tests pass. |
| TC6 | should | Static check that `popup.css` body width uses no `vw` unit | Pass. Never blocks closure. |

## 5. Gates (gates 1 and 3 approved by the Board 2026-10-30 via CEO `ceo-approved-popup-width-20261030-1216`; gate 2 and 4 still apply)

1. The Board approves this plan. (Approved.)
2. The uncommitted popup redesign is still not accepted (continuation plan A1). This fix applies on top of it and does not commit it. Whether to commit the redesign plus this fix is a Board decision.
3. **Deployment gate.** Copying `dist/` into `cft-ext/` and reloading extension `kppigaopbfjcdfcpobapdofifbkdgdom` replaces the acceptance artifact. It needs Board approval. Do not relaunch CfT. Do not clear Last Talk.
4. No push, merge, or deletions.

## 6. Known probe limitation

`chrome.action.openPopup` times out on every second call while a previous popup is still open. The probe reports this as exit 2 (inconclusive). Rerun once. Never count exit 2 as a pass.
