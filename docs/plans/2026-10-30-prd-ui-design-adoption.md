# PRD v1.2 UI Design Adoption (日式 RPG × LINE)

- **Date**: 2026-10-30
- **Author**: CTO (assignmentId `staff-20261030-cto-0930`, request `ceo-prd-ui-plan-20261030-1224`)
- **Revision**: r2, answering `ceo-ui-plan-revision-20261030-1230`. r1 is kept at `.scratch/talk-to-bro-personally/prd-pull-20261030/plan-r1.md`.
- **Status**: APPROVED by CEO under the Board's 2026-10-30 12:24 delegated review and approval authority. Decision event `ceo-approved-prd-ui-r2-20261030-1233`. PM may ticket and dispatch T1-T5 serially. Approval includes the section 5 browser restriction below.
- **Stage**: M5 feature. Accept against the must cases only.
- **Worktree**: `.worktrees/talk-to-bro-personally-dev` (HEAD `c6ede85` plus the uncommitted popup redesign).
- **Sequencing**: Implementation starts only after PM closes the popup width fix QA (`2026-10-30-toolbar-popup-width-fix.md`). The 400px fixed body width stays.

## 1. Source provenance

| Item | Value |
| --- | --- |
| Notion page | `3c20e8c6-93da-42ee-b1e9-436942b79aef`, title now `[Inspiration] Talk To Bro` (renamed from `... Personally`) |
| Identity check | `created_time` 2026-10-27T04:31:00Z equals the local PRD `Created` field |
| Notion `last_edited_time` | 2026-10-30T04:22:00Z |
| Pull time | 2026-10-30T04:26:19Z (`.scratch/talk-to-bro-personally/prd-pull-20261030/pull-time.txt`) |
| Pull method | `python3 -m nsync pull <id>` from `products/agentic-env/tools/notion-sync`, isolated `NSYNC_WORKSPACE_DIR`/`NSYNC_CONFIG` under the scratch dir. Read-only. No push. No global install. |
| Requirements used by this plan | `docs/design/2026-10-30-prd-v1.2-ui-excerpt.md` (portable excerpt, not canonical) |
| Mockup | `docs/design/2026-10-30-talk-to-bro-final-ui.html` (byte copy of the Notion attachment, 434,773 bytes, sha256 prefix `36fac7cdb226`) |
| Canonical local PRD | `docs/prd/2026-10-28-talk-to-bro-personally-prd.md` stays v1.1. Not updated. |

**Why an excerpt.** The existing `notion_to_portable_markdown` leaves the `<callout>` and `<embed>` nested inside the `UI 設計（最終版）` toggle. A second pass returns the text unchanged, and `check_markdown_violations` still flags `raw_notion_callout`. nsync was not modified and no tags were stripped by hand. The excerpt records source, diff and the local mockup reference. The formatter bug is a follow-up for agentic-env, outside this plan.

### PRD diff v1.1 to v1.2 (UI-relevant only)

- Product name becomes **Talk To Bro**.
- Look & Feel changes from Pip/老大 Pixel Roguelike to **日式 RPG × LINE**. Bro is 惡龍. The user is 勇者.
- New section `UI 設計（最終版）` with the mockup and principles (only one message plus a 上一則 card, state as joke, jokes in copy).
- Glossary: 惡龍 replaces 老大, 勇者 replaces Pip.
- F1 to F8, timeouts, Handoff and ADR-0001 are unchanged.

### Design facts (measured from the mockup)

- Popup frame `.pop` is 380×620 px. 4 states: idle, read and waiting, answer, 已讀不回 with automatic Handoff.
- Palette: night `#120e2a`, window `#14164a`, LINE green `#06C755`, user bubble `#8DE055`, chat bg `#7a8fbf`, text `#1e1e1e`, accent `#ffd75e`.
- Assets: 3 unique JPEGs. 勇者 avatar 160×160, 惡龍 avatar 160×160, background 760×509. Rendered with `image-rendering: pixelated`.
- Dark theme only. Has `prefers-reduced-motion` handling.

## 2. Mapping design to current state

`Talk` (`src/shared/types.ts`) already carries `phase`, `text`, `sentAt` (set only on `SUBMIT_CONFIRMED` in `runner.ts`), `lastGrowthAt`, `answerMarkdown`, `failure.code`, `handoff.status/copied`. `tick.ts` has `TOTAL_TIMEOUT_MS = 180_000` and `IDLE_TIMEOUT_MS = 30_000`. No new storage key, SW message or permission is needed.

| Design state | Talk condition | View |
| --- | --- | --- |
| 1 閒置 | `lastTalk == null` | Header 惡龍 Bro 在線上. RPG box 「野生的惡龍 Bro 出現了！勇者要怎麼做？」. Input. |
| 2a 送出中 | `phase` in `queued`, `resolving_tab`, `sending`, `submitting` (no `sentAt`) | User bubble with a pending mark, **no 已讀**. RPG box 「勇者 把訊息傳給惡龍……」. No HUD. |
| 2b 已讀，詠唱中 | `phase` in `waiting`, `extracting` (`sentAt` set) | 已讀 + `sentAt` time on the user bubble. Typing dots. HUD: patience = `now - sentAt` of 3:00, silence = `now - (lastGrowthAt ?? sentAt)` of 30 s. RPG box 「惡龍 正在詠唱咒文……」. |
| 3 惡龍回了 | `phase == 'done'` | User bubble + 惡龍 bubble with the existing Answer renderer output. Copy button. RPG box 「惡龍 回覆了！勇者 獲得了 知識 ×1。」 Footer `SOURCE: TRUST ME BRO`. |
| 4 失敗 / Handoff | `phase == 'failed'` | See failure rules. Existing countdown, cancel and deferred `goto-bro-btn` behaviour unchanged. |

HUD and animation are display only. They read Talk fields and never change timeouts or phases.

### Failure rules (F4)

- The existing `getFailureInfo(code).userMessage` stays the primary error text for every code. It already names the concrete cause and the recovery action (for example "先去設定 Bro Chat"). Only the persona nouns in that copy change (Pip and 老大 become 勇者 and 惡龍). The cause and recovery wording stay.
- The RPG narration is an extra line above it, never a replacement:

| FailureCode | Narration line |
| --- | --- |
| `TIMEOUT_IDLE`, `TIMEOUT_TOTAL` | 惡龍 已讀不回…… |
| `QUOTA_EXHAUSTED` | 惡龍今天見客太多。 |
| `NOT_SIGNED_IN` | 勇者還沒登入，進不了城。 |
| all other codes | 惡龍 無視了勇者…… |

- 「勇者 使用了 剪貼簿！訊息已經複製。」 shows only when `handoff.copied === true`. When `copied` is false, show the existing not-copied text instead.

### 冒險之書 上一則 card (view-only)

- Persistent storage is unchanged. `lastTalk` still holds only the newest Talk. Talk Log still holds only result and time.
- When the user submits a new Talk while the popup is open, `popup.ts` copies the previous `lastTalk` into a module variable `previousSummary = { text: first 40 chars, at: createdAt }` before sending. It lives only in this popup document.
- The card renders at the top as 「📖 冒險之書・上一則 HH:MM「…」」. Activating it (click or Enter) expands it in place to the previous text and, if any, the first 3 lines of the previous answer, also held only in memory. It collapses again on second activation.
- Closing the popup discards it. On reopen the popup restores only the newest Last Talk and shows no 上一則 card. Nothing is invented.
- No list, search or history.

## 3. Contracts that must not change

- Talk submission, 300-char limit, Enter submit, Shift+Enter newline, IME guard (`isComposing` / keyCode 229).
- Handoff policy, countdown, cancel (`handoff/cancel`), deferred tab switch (`handoff/switch_tab` on failed Talks) and element IDs.
- Clipboard via offscreen document. Last Talk restore on reopen (F5). Talk Log records only result and time.
- Active-tab zoom mirroring (`zoom.ts`) and the 400px body width.
- No SW, manifest or storage-schema change.

## 4. Tickets

One writer for all files below: the Engineer assigned by PM. Tickets run serially T1 to T5 in the worktree. Changed paths: `src/popup/popup.html`, `popup.css`, `popup.ts`, new `src/popup/assets/*`, `src/shared/failures.ts` (copy strings only), `scripts/build.mjs` only if assets need copying, `tests/popup-ui.test.mjs`, `tests/unit/*`.

### T1 Shell, tokens, assets, idle state

- **Source**: excerpt `UI 設計（最終版）`, mockup state 1, Glossary.
- **Depends**: width fix QA closed.
- **Change**: palette tokens, LINE header (avatar, 惡龍 Bro, status line), RPG narration box, input as LINE composer, assets bundled. All user-visible copy and aria labels in `src/popup` and `src/shared/failures.ts` use 惡龍/勇者.
- **AC**: idle popup follows mockup state 1 within 400px width and ≤600px height. Text stays horizontal. Assets load from the package.

| ID | Tag | Test case |
| --- | --- | --- |
| T1-1 | must | Real toolbar action popup at host zoom 100/125/200%. Width probe exits 0. Screenshot each. `innerWidth` 400/500/800 (±2). Input ≥ 200. Height ≤ 600. |
| T1-2 | must | `rg -n "Pip\|老大\|小弟" src/popup src/shared/failures.ts` finds no user-visible string. |
| T1-3 | must | Built `dist/` contains the 3 assets. Opening the popup makes no external network request. |
| T1-4 | should | Body text contrast ≥ 4.5:1 on header and bubbles. |

### T2 Sending and waiting states with HUD

- **Source**: mockup state 2, PRD HUD bullet, design principle 已讀＝送到.
- **Depends**: T1.
- **Change**: 2a and 2b views from the mapping table. A 1 s view-only timer while in 2b, stopped on close or phase change.
- **AC**: 已讀 appears only once `sentAt` exists. HUD matches elapsed time. Timeout logic untouched.

| ID | Tag | Test case |
| --- | --- | --- |
| T2-1 | must | Unit test of the view-state function: `queued`/`sending`/`submitting` without `sentAt` give 送出中 and no 已讀. `waiting` with `sentAt` gives 已讀. |
| T2-2 | must | Unit test of HUD values: patience at 0 s, 24 s, 180 s. Silence at 4 s and 30 s, with and without `lastGrowthAt`. |
| T2-3 | must | Real popup screenshots of 2a and 2b, using the QA fixture rules in section 5. |
| T2-4 | must | `prefers-reduced-motion: reduce` stops typing and bar animation. |

### T3 Answer state

- **Source**: mockup state 3.
- **Depends**: T2.
- **Change**: 惡龍 bubble wraps the existing Answer renderer output. Copy button keeps its ID. Narration and Source footer. No 「去 Bro Chat」 button, because `handoff/switch_tab` runs `performHandoff` (copy and handoff state) and a done-Talk switch would need a SW change.
- **AC**: long answers scroll inside the chat area. Input and Copy stay visible. Answer text is not rewritten (F3).

| ID | Tag | Test case |
| --- | --- | --- |
| T3-1 | must | Real popup with a done Talk at 100/125/200%. Screenshot. Copy writes the Answer Markdown to the clipboard of the QA context. |
| T3-2 | must | Existing long-answer scroll test in `tests/popup-ui.test.mjs` passes after selector updates. |
| T3-3 | must | Close and reopen. The newest Last Talk answer restores. |

### T4 Failure and Handoff state

- **Source**: mockup state 4, PRD F4, other-endings line.
- **Depends**: T3.
- **Change**: failure rules in section 2. Countdown, cancel and deferred button restyled only.
- **AC**: every failure shows its narration plus the specific `userMessage`. The clipboard line follows `copied`.

| ID | Tag | Test case |
| --- | --- | --- |
| T4-1 | must | Unit test: for every `FailureCode`, the rendered failure view contains `getFailureInfo(code).userMessage`. Narration lines match the table. |
| T4-2 | must | Unit test: `copied` true shows the clipboard line. `copied` false never shows it. |
| T4-3 | must | Real popup screenshots of a `TIMEOUT_IDLE` failure at 100/125/200% using the fixture rules. Countdown, cancel and deferred button work by keyboard. |
| T4-4 | must | Talk Log entry for a failure contains only result and time. |

### T5 冒險之書 上一則 card

- **Source**: excerpt Look & Feel 只留一則, design principle 只有一則, mockup header chip.
- **Depends**: T4.
- **Change**: section 2 card. `popup.ts` only.
- **AC**: card appears after a second Talk in the same popup session, collapses and expands, and never persists.

| ID | Tag | Test case |
| --- | --- | --- |
| T5-1 | must | Unit test: submitting with a previous `lastTalk` sets `previousSummary` to its first 40 chars and time. Submitting with no previous Talk leaves it empty. |
| T5-2 | must | Real popup, two Talks in one session: card shows the first Talk. Enter expands and collapses it. Screenshot. |
| T5-3 | must | Close and reopen: no card, newest Last Talk restored. `chrome.storage.local` keys and Talk Log entries match the pre-test snapshot plus only the expected newest Talk and its result-and-time log entry. No previous text is persisted. |

### Across all tickets

| ID | Tag | Test case |
| --- | --- | --- |
| X-1 | must | `npm test` passes. |
| X-2 | must | Keyboard only: Tab order card, input, actions, settings. Focus ring visible. Enter/Shift+Enter and Chinese IME composition behave as before. |
| X-3 | must | Narration region is `role="status"` with `aria-live="polite"`. Avatars are decorative (`alt=""`). The card is a `button` with `aria-expanded`. |
| X-4 | must | QA uses the real toolbar action popup. A normal tab never replaces it. |

## 5. QA fixture and data protection

- Use only the existing project CfT instance on CDP 9222 with `~/.chrome-cdp-profile`. Do not launch a second browser or use another profile. This restriction follows AGENTS.md and supersedes r2's proposed separate-profile preference.
- States 2a, 2b, 3 and 4 may use synthetic fixtures in the real action Popup. The QA ticket records `chrome.storage.local` and `chrome.storage.session` snapshots before fixture setup and restores the original values afterwards, with a diff showing equality. Snapshot files stay in ignored scratch space and are not posted to GitHub. Do not clear the profile or its real Last Talk and Bro Chat URL.
- Screenshots from fixtures prove rendering only. They never count as real Gemini send or read. Real submits, if needed, require the same snapshot/restore protection. Restore clipboard and tab zoom after checks, and remove temporary `debug.forceFailure` changes.
- Only one QA writer touches a given browser profile at a time. No shared browser writes between QA and other roles.

## 6. Decisions (CEO, 2026-10-30)

- **D1 Assets**: approved for local self-use testing. No public release.
- **D2 冒險之書**: in scope as the view-only card (T5). Full history is not required.
- **D3 Size**: 400px width, height ≤ 600px.

## 7. Out of scope

- Command menu items 「貼一張圖」, 「讀上一則」, 「逃跑」. A Talk is text only. Only 傳訊息 maps to an existing action.
- 「去 Bro Chat」 on a done Talk (needs a SW change).
- Toolbar icon lighting up when the answer is ready (SW badge change).
- Light theme.
- nsync formatter fix and canonical PRD replacement.
- M6/M7 backend work and any product rewrite.

## 8. Gates

No commit, push, merge or deletion. Local CfT test deployment only after CEO approval and PM dispatch. No public release.
