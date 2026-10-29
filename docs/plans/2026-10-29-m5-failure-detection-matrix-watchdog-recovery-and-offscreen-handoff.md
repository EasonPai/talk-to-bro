# Implementation Plan - Ticket 07 (#31: M5 — Failure Detection Matrix, Watchdog Recovery & Offscreen Handoff)

- **Date**: 2026-10-29
- **Product**: `talk-to-bro-personally`
- **Ticket**: [GitHub Issue #31: [talk-to-bro-personally] 07: M5 — Failure Detection Matrix, Watchdog Recovery & Offscreen Handoff](https://github.com/EasonPai/agentic-development/issues/31)
- **Assignee**: Engineer (`term_b7d9f995-f715-4d80-a6c1-9eb3991c39f7`)
- **Reviewers**: CTO (`term_c7268128-7eab-4ebe-80cc-eb8a142462c1`), PM (`term_29805068-4138-43f3-b3f4-97d1608f46af`)
- **Status**: Plan Approved by CTO with Technical Amendments; Proceeding to Implementation.

---

## 1. Objective & Scope

Implement a comprehensive, resilient failure detection and handoff architecture for Talk to Bro Personally. Ensure all 14 `FailureCode`s map exhaustively to human-centered Pip emotional states and clear user-facing messages with compile-time type exhaustiveness (`never` check verified via `tsc --noEmit`). Enforce strict 30s idle and 180s total watchdog timeout boundaries. Provide seamless dual-path Handoff: an interactive 1.5s countdown notice with persistent cancellation when the Action Popup is open, and automated serialized offscreen document clipboard copying with tab switching and a non-intrusive shadow DOM notice on the Gemini page when the Popup is closed. Guarantee zero focus jumps on browser restart by marking Handoff as deferred, and verify all 14 error paths using `debug:v1.forceFailure` fault injection (F4).

### In Scope & CTO Contract Clarifications
1. **Dynamic Stage & Exhaustive Failure Code Matrix (`src/shared/failures.ts`)**:
   - Maps all 14 `FailureCode`s (`NO_BRO_CHAT`, `BRO_CHAT_MISSING`, `NOT_SIGNED_IN`, `INPUT_NOT_FOUND`, `EDITOR_BUSY`, `SUBMIT_UNCONFIRMED`, `TIMEOUT_IDLE`, `TIMEOUT_TOTAL`, `QUOTA_EXHAUSTED`, `TAB_UNRESPONSIVE`, `TAB_CLOSED`, `EXTRACT_FAILED`, `INTERRUPTED`, `INTERNAL`).
   - Guarantees compile-time completeness using TypeScript `never` exhaustiveness checking in `switch`, strictly verified with `tsc --noEmit`.
   - **Dynamic Stage Accounting**: Stage (`'send'` vs `'read'`) is derived dynamically from the persisted Talk failure context (`talk.failure?.stage` or whether `sentAt` is present), NOT hardcoded per code. Specifically, `TAB_CLOSED`, `TAB_UNRESPONSIVE`, `INTERRUPTED`, and `INTERNAL` can occur at either stage.
   - `retryable` is purely human-facing UI guidance; it NEVER enables automatic resubmission.
2. **Stream Watchdog & Pure `evaluateTick` (`src/shared/tick.ts`)**:
   - Pure function strictly enforcing 30,000ms idle timeout (from last text growth / hash change) and 180,000ms total timeout from `sentAt`.
   - Text growth (length growth or signature change) immediately resets idle timer before timeout evaluation.
   - Settle stability check requires 2 consecutive non-generating complete probe signals.
3. **Popup-Open Handoff Flow (`src/popup/popup.ts`)**:
   - Displays Pip error mood and message.
   - Starts 1.5s visual countdown ONLY for `pending` (non-deferred, non-cancelled) handoffs: "Pip 帶你去找老大… (1.5s)" with a "留在這裡" [Cancel] button.
   - **Persistent Cancellation**: Clicking "留在這裡" persists `handoff.status = 'cancelled'` to storage so reopening/rerendering the popup does not restart the countdown.
   - If user does not cancel, writes Talk prompt text to clipboard via `navigator.clipboard.writeText`, requests Service Worker to switch to Bro Chat tab, and focuses the browser window.
   - SW validates that the Talk ID matches the current runtime Talk before committing state, preventing stale callback race conditions.
4. **Popup-Closed Handoff Flow (`src/sw/handoff.ts`, `src/offscreen/clipboard.ts`)**:
   - When failure occurs, checks `deferred` status first. If not deferred and no active POPUP context is found (checking `contexts.some(c => c.contextType === 'POPUP')`):
     - Sets action badge to `!`.
     - Serializes offscreen document lifecycle (single-operation lock).
     - Launches `offscreen.html` with reason `CLIPBOARD`, sends message, and waits for explicit ACK before closing the document.
     - Reuses existing `ensureBroTab` from `src/sw/tab.ts` (or opens Options page if `NO_BRO_CHAT`).
     - Real-world observation: `copied` and `focused` reflect actual boolean outcomes; `handoff.status` is set to `'done'` only if both succeed, otherwise `'partial'`.
     - Injects minimal Shadow DOM notice (`showHandoffNotice`) on Gemini page without scope-creeping into M6 pixel-art work.
5. **Browser Restart Deferred Handoff (`src/sw/reconcile.ts`, `src/popup/popup.ts`)**:
   - In `reconcile` upon detecting a new browser session (`isNewBrowserSession = true`), transitions unfinished Talk to `INTERRUPTED` and sets `handoff.status = 'deferred'`.
   - **Zero-jump guarantee**: Checks deferred status BEFORE branching into auto-handoff; never auto-copies, never switches tabs, and never steals focus on boot, even if popup is already open.
   - When user next opens the Popup, displays the interruption explanation and an autofocused primary button: "去找老大 ⏎". Explicit user interaction authorizes deferred handoff execution.
   - Real restart test exercises the actual `boot()` entry point with fresh boot sequence.
6. **Fault Injection & Automated Verification (`debug:v1.forceFailure`)**:
   - Service Worker checks `debug:v1.forceFailure` in `storage.local`; if present, forces transition to the target `FailureCode`.
   - Verifies all 14 error paths produce non-blank Popup UI, valid clipboard contents, and active tab switching in automated unit and Chrome for Testing live test harnesses (`scripts/test-m5-suite.js`).

### Explicitly Out of Scope
- Talk Log UI, options page success rate analytics, selector health check, and Pip pixel art sprite sheets (Ticket 08 / M6).
- Hardening, canary build, and 2-week trial validation (Ticket 09 / M7).

---

## 2. Architecture & Decision Flow

```mermaid
flowchart TD
  subgraph FailureDetection["Failure Detection & Triggering"]
    TickWatchdog["Stream Watchdog: evaluateTick()"]
    AdapterError["RealBroAdapter / Tab Errors"]
    FaultInjection["debug:v1.forceFailure Injection"]
    BootReconcile["SW boot() / Reconcile"]
    
    TickWatchdog -->|TIMEOUT_IDLE / TIMEOUT_TOTAL / QUOTA| FailSignal["talk-machine.ts: transition(FAIL, code)"]
    AdapterError -->|SIGN_IN / BUSY / UNRESPONSIVE / EXTRACT| FailSignal
    FaultInjection -->|Forced FailureCode| FailSignal
    BootReconcile -->|New session + active talk| InterruptedFail["transition(FAIL, INTERRUPTED) with handoff.status = deferred"]
  end

  subgraph Finalization["Atomic State Finalization"]
    FailSignal --> Finalize["finalizeTerminalTalk(runtime:v1)"]
    InterruptedFail --> Finalize
    Finalize --> SetBadge["Set Badge to exclamation mark"]
    Finalize --> CheckPopup{"Is Action Popup Open?"}
  end

  subgraph PopupOpenPath["Path A: Popup Open"]
    CheckPopup -->|Yes (contexts.length > 0)| ShowCountdown["Show 1.5s Countdown: Pip 帶你去找老大"]
    ShowCountdown --> UserChoice{"User Action within 1.5s"}
    UserChoice -->|Clicks 留在這裡| CancelHandoff["Cancel timer; Stay in popup"]
    UserChoice -->|Countdown expires| CopyNavigator["navigator.clipboard.writeText(talk.text)"]
    CopyNavigator --> ReqSwitch["chrome.runtime.sendMessage(handoff/switch_tab)"]
    ReqSwitch --> FocusTabWindow["Switch Bro Chat tab & Focus Window"]
  end

  subgraph PopupClosedPath["Path B: Popup Closed"]
    CheckPopup -->|No| CheckDeferred{"handoff.status == deferred?"}
    CheckDeferred -->|Yes (INTERRUPTED)| Defer["Remain silent; Wait for next popup open"]
    CheckDeferred -->|No| ExecOffscreen["Launch offscreen.html (reason: CLIPBOARD)"]
    ExecOffscreen --> CopyExec["document.execCommand(copy)"]
    CopyExec --> CloseOffscreen["Close offscreen document"]
    CloseOffscreen --> CheckNoBroChat{"code == NO_BRO_CHAT?"}
    CheckNoBroChat -->|Yes| OpenOptions["chrome.runtime.openOptionsPage()"]
    CheckNoBroChat -->|No| SwitchTab["chrome.tabs.update(active: true) & focus window"]
    SwitchTab --> ShowShadowNotice["Adapter: inject non-intrusive Shadow DOM banner"]
  end
```

---

## 3. Failure Detection Matrix Specification (14 FailureCodes)

| Code | Stage | Pip Mood | Pip State | User-Facing Message | Retryable |
| :--- | :---: | :---: | :---: | :--- | :---: |
| `NO_BRO_CHAT` | send | 嚇到 | `scared` | 還沒告訴 Pip 老大在哪，先去設定 Bro Chat。 | No |
| `BRO_CHAT_MISSING` | send | 嚇到 | `scared` | 老大搬家了，Bro Chat 網址好像失效。 | Yes |
| `NOT_SIGNED_IN` | send | 嚇到 | `scared` | 你還沒登入 Google，Pip 進不去。 | Yes |
| `INPUT_NOT_FOUND` | send | 嚇到 | `scared` | 找不到老大的耳朵（Gemini 可能改版了）。 | Yes |
| `EDITOR_BUSY` | send | 嚇到 | `scared` | 老大那邊正忙，Pip 不敢打斷。 | Yes |
| `SUBMIT_UNCONFIRMED` | send | 嚇到 | `scared` | 話好像沒遞到——也可能已經送出，先看一下有沒有重複再貼。 | No |
| `TIMEOUT_IDLE` | read | 老大不理人 | `ignored` | 老大 30 秒沒出聲。 | Yes |
| `TIMEOUT_TOTAL` | read | 老大不理人 | `ignored` | 等了 3 分鐘，老大還沒講完。 | Yes |
| `QUOTA_EXHAUSTED` | read | 嚇到 | `scared` | 老大今天見客見太多（額度用完）。 | No |
| `TAB_UNRESPONSIVE` | read | 嚇到 | `scared` | 老大的門被 Chrome 關起來了。 | Yes |
| `TAB_CLOSED` | read | 嚇到 | `scared` | Bro Chat 分頁被關掉了。 | Yes |
| `EXTRACT_FAILED` | read | 嚇到 | `scared` | 老大講完了，但 Pip 抄不下來。 | Yes |
| `INTERRUPTED` | read | 嚇到 | `scared` | Chrome 重開，Pip 半路被叫回來。 | Yes |
| `INTERNAL` | send | 嚇到 | `scared` | Pip 迷路了。 | Yes |

### Compile-Time Exhaustiveness Guarantee
In `src/shared/failures.ts`:
```typescript
export function getFailureInfo(code: FailureCode): FailureInfo {
  switch (code) {
    case 'NO_BRO_CHAT': return { ... };
    case 'BRO_CHAT_MISSING': return { ... };
    case 'NOT_SIGNED_IN': return { ... };
    case 'INPUT_NOT_FOUND': return { ... };
    case 'EDITOR_BUSY': return { ... };
    case 'SUBMIT_UNCONFIRMED': return { ... };
    case 'TIMEOUT_IDLE': return { ... };
    case 'TIMEOUT_TOTAL': return { ... };
    case 'QUOTA_EXHAUSTED': return { ... };
    case 'TAB_UNRESPONSIVE': return { ... };
    case 'TAB_CLOSED': return { ... };
    case 'EXTRACT_FAILED': return { ... };
    case 'INTERRUPTED': return { ... };
    case 'INTERNAL': return { ... };
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
```

---

## 4. Detailed Component Implementation Plan

### 4.1 Shared Failure Model (`src/shared/failures.ts`)
- Implement `FailureInfo` interface:
  ```typescript
  export interface FailureInfo {
    code: FailureCode;
    stage: 'send' | 'read';
    pipMoodName: '嚇到' | '老大不理人';
    pipState: 'scared' | 'ignored';
    userMessage: string;
    retryable: boolean;
  }
  ```
- Export `getFailureInfo(code: FailureCode): FailureInfo` with `never` guard.
- Export `pipStateOf(talk: Talk | null): PipState` (returns `'door'`, `'waiting'`, `'boss_speaks'`, `'scared'`, or `'ignored'`).

### 4.2 Watchdog Timeout Boundary Verification (`src/shared/tick.ts`)
- Verify and harden boundary evaluations in `evaluateTick`:
  - 29,999ms vs 30,000ms idle timeout.
  - 179,999ms vs 180,000ms total timeout.
  - Settle check (requires 2 consecutive stable complete ticks).
  - Probe misses count handling (5 consecutive misses triggers `TAB_UNRESPONSIVE`).

### 4.3 Service Worker Handoff Engine (`src/sw/handoff.ts`)
- Implement `performHandoff(talk: Talk, options: { popupOpen: boolean; storage: StorageAreaLike }): Promise<TalkHandoff>`:
  - Sequence strictly follows Tech Spec §4.3: **Write failure & Log atomically -> Copy Talk prompt -> Switch to Bro Chat tab -> Focus window**.
  - Offscreen document management:
    - Calls `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })`.
    - Creates `offscreen.html` if missing with reason `CLIPBOARD` and justification `"Handoff: Copy Talk to clipboard"`.
    - Sends message to offscreen document: `{ action: 'OFFSCREEN_COPY', text: talk.text }`.
    - Closes offscreen document cleanly.
  - Tab resolution & activation:
    - Reuses `findBroTab()` from `src/sw/tab.ts` or creates pinned tab.
    - Activates tab (`chrome.tabs.update(tabId, { active: true })`) and focuses window (`chrome.windows.update(tab.windowId, { focused: true })`).
    - Dispatches `adapter.showHandoffNotice` to the tab.
  - Updates `lastTalk.handoff` in `storage.local` with `{ status: 'done', copied: true, focused: true }`.

### 4.4 Non-Intrusive Gemini Shadow DOM Notice (`src/adapter/entry.ts`)
- Implement `showHandoffNotice({ message }: { message: string })`:
  - Locates or creates a fixed root element `#ttb-handoff-root` at `top: 16px; right: 16px; z-index: 2147483647`.
  - Attaches an open Shadow Root to encapsulate all styles and prevent page bleed or style contamination.
  - Displays:
    - Pixel-art styled Pip icon.
    - Message: `Pip 說：${message}`.
    - Dismiss `[✕]` button and auto-dismiss after 12 seconds.

### 4.5 Popup Interactive Handoff & Deferred State (`src/popup/popup.ts`, `popup.html`, `popup.css`)
- **Error Boundary**:
  - Enclose popup initialization in top-level try/catch.
  - If storage fails or rendering throws, show fallback UI with input element and raw error details (never a blank popup).
- **Handoff Countdown**:
  - If `talk.phase === 'failed'` and `talk.handoff?.status !== 'deferred'`:
    - Display error banner with `failureInfo.userMessage`.
    - Start 1.5s countdown: `Pip 帶你去找老大… (${countdown}s)`.
    - Add "留在這裡" [Cancel] button. If clicked, clearTimeout and set notice to "已留在目前分頁，Talk 內容已保留".
    - On expiration, write to clipboard via `navigator.clipboard.writeText(talk.text)` and send `{ action: 'handoff/switch_tab', talkId: talk.id }` to SW.
- **Deferred Handoff (Browser Restart `INTERRUPTED`)**:
  - If `talk.handoff?.status === 'deferred'`:
    - Display Pip "嚇到" mood and message: `"Chrome 重開，Pip 半路被叫回來。"`.
    - Display an autofocused primary button: `"去找老大 ⏎"`.
    - On click / Enter keypress: write clipboard, switch tab, focus window, and transition handoff status to `'done'`.

### 4.6 Fault Injection (`debug:v1.forceFailure`)
- In `src/sw/runner.ts`:
  - At the beginning of `submitTalk` or during `tick`:
    - Read `debug:v1` from storage.
    - If `debug.forceFailure` is present:
      - Trigger `transition(talk, { type: 'FAIL', code: debug.forceFailure }, now)`.
      - Delete `forceFailure` from `debug:v1` to prevent sticky failure loops.
      - Execute `finalizeTerminalTalk` and dispatch Handoff.

---

## 5. Verification & Test Strategy

### 5.1 Unit Tests (Node / TypeScript)
- `tests/unit/failures.test.ts`:
  - Exhaustive 14-code completeness test.
  - Compile-time type check ensuring `getFailureInfo` accepts all and only valid `FailureCode`s.
  - Stage mapping ('send' vs 'read') and Pip mood mapping ('scared' vs 'ignored').
- `tests/unit/tick.test.ts` (Existing + Boundary additions):
  - 29,999ms vs 30,000ms idle boundary.
  - 179,999ms vs 180,000ms total boundary.
  - Growth reset verification.
- `tests/unit/handoff.test.ts`:
  - Offscreen document launch, message sending, and cleanup.
  - Tab switching and window focus calls.
  - Handoff status transitions (`'pending'` -> `'done'` / `'partial'`).
  - Deferred handoff preservation on browser restart.

### 5.2 Chrome for Testing Live End-to-End Suite (`scripts/test-m5-suite.js`)
- Runs against live Extension in Chrome for Testing (`http://localhost:9222`):
  1. **Fault Injection Across All 14 Codes**:
     - Loop through all 14 `FailureCode`s via `debug:v1.forceFailure`.
     - Verify non-blank UI, correct error text, and correct Pip mood in Popup.
     - Verify clipboard content equals Talk prompt via `pbpaste`.
  2. **Popup Open vs Closed Verification**:
     - Test Popup open countdown (1.5s countdown, cancel button functionality).
     - Test Popup closed offscreen execution (background copy, badge `!`, tab switch, shadow DOM notice).
  3. **Browser Restart Deferred Verification**:
     - Simulate restart by clearing `session:v1` while Talk is in-flight.
     - Call `reconcile` / `boot()`.
     - Confirm no tab switch or focus jump occurs on boot.
     - Open Popup, verify deferred banner and "去找老大 ⏎" button.
     - Click "去找老大 ⏎", verify clipboard write and active tab switch.

---

## 6. File Impact Matrix

| File Path | Action | Description |
| :--- | :---: | :--- |
| `products/talk-to-bro-personally/src/shared/failures.ts` | **Create** | Exhaustive 14-code mapping with `never` guard, Pip mood, and user messages |
| `products/talk-to-bro-personally/src/sw/handoff.ts` | **Create** | Offscreen clipboard copying, tab activation, and handoff execution |
| `products/talk-to-bro-personally/src/adapter/entry.ts` | **Modify** | Add `showHandoffNotice` Shadow DOM banner on Gemini page |
| `products/talk-to-bro-personally/src/sw/runner.ts` | **Modify** | Wire `debug:v1.forceFailure` fault injection, connect `handoff.ts` |
| `products/talk-to-bro-personally/src/sw/index.ts` | **Modify** | Add message handlers for `handoff/switch_tab` |
| `products/talk-to-bro-personally/src/popup/popup.ts` | **Modify** | Implement 1.5s countdown, cancel button, and deferred handoff button |
| `products/talk-to-bro-personally/src/popup/popup.html` | **Modify** | Add markup structures for countdown, cancel, and deferred handoff |
| `products/talk-to-bro-personally/src/popup/popup.css` | **Modify** | Styling for error banners, countdown progress, and action buttons |
| `products/talk-to-bro-personally/tests/unit/failures.test.ts` | **Create** | Unit tests for failure matrix exhaustiveness and Pip states |
| `products/talk-to-bro-personally/tests/unit/handoff.test.ts` | **Create** | Unit tests for offscreen copy, tab switching, and deferred state |
| `products/talk-to-bro-personally/scripts/test-m5-suite.js` | **Create** | Live CfT verification harness for F4 fault injection across 14 codes |
