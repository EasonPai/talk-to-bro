# Minimal local company (team) rules

Contents: 1 Scope and authority · 2 Wording · 3 Delivery workflow (work model) · 4 Precedence and bound skills · 5 Edge-case budget and stages · 6 Onboarding · 7 Messaging and delivery · 8 Operating modes · 9 Turn hygiene, services and browser · 10 Launch · 11 Task continuity · 12 Limits and dissolution

## 1. Scope and authority

- These rules apply only when `team-config.json` has `enabled=true` and deployment status is clean.
- `executive-roles.json` is the authoritative role policy. Read it before role recovery.
- Appointments:
  - The Board (`human`) appoints CEO.
  - The Board or CEO appoints every other role; PM may also appoint Engineer and QA.
  - **Board liaison**: whoever staffed the current squad reports to the Board for it (CEO for full company, PM for PM-led squad; CEO default). Other desks reach the Board through `work` transitions.
  - **Every report to the Board ends with three lines**:
    `Status:` one sentence;
    `Decision needed:` what the Board must decide, or `none`;
    `Next step:` what happens next and who does it, plus `Team recommendation:` the squad's advised option and why.
  - Seats: Engineer and QA may run multiple desks (`Engineer#1`, `Engineer#2`) up to `project-tools.json` `seats`. Only the Board changes seat counts; CEO staffs or offboards seats (`--seat N`). Seat 1 is the plain role.
  - Consultant is optional: appointed only on request, reports to assigner (`reportsTo: assigner`).
- A terminal title cannot create appointment authority. Reinstatement (`rebind`) requires current provenance.
- A `stale_config` identity status never pauses work; rebind only when explicitly instructed.
- PM tracks progress without acquiring technical acceptance.

## 2. Wording

- The config value `human` means the Board (董事會).
- In plans, tickets, messages and reports always write "the Board"/「董事會」, never "human"/「人類」/「使用者」.
- Use company terms (onboard/入職, reinstate/復職, appoint/任命, direct manager/直屬主管).

## 3. Delivery workflow (work model)

`T` below denotes `python3 <ep-agentic-orca-team>/scripts/team-setup.py --project <repo>`. Full CLI parameters and syntax: see `references/work-workflow-guide.md`.

- **One source of truth**: Work state lives only in the ledger `.scratch/orca-team/events.jsonl`, and only `T work <action> <id>` changes it. Never edit ticket frontmatter status/retries by hand. Messages and terminal output never change state.
- **Turn loop & whoami**:
  - Every turn starts with `T whoami` (CLI hooks inject it at session start and after compaction).
  - Serve the oldest ticket first (marked NOW, then NEXT); do not skip ahead.
  - **Do not end a turn while YOUR MOVE is non-empty** (`canEndTurn: no`).
- **Ticket Lifecycle (`--kind ticket`)**:
  0. **Intake**: CEO/PM/Board runs `work open <id> --kind ticket --title "..."`. PM routes via `work plan <id>` (to CTO; default for any plan-worthy change) or `work ready <id> --reason "..."` (only for trivial typo, copy text, single config value).
  1. **CTO Plan**: Does root-cause and design under plans dir naming ticket ID and must/should test cases, then runs `work submit-plan <id> --plan <path>`. CTO never dispatches directly to Engineer.
  2. **Board Approval**: Board decides; liaison records `work approve|return <id> --role Board --evidence "..."`.
  3. **PM Dispatch**: Guided by `to-tickets` (under `docs/tickets/`). PM runs `to-spec` once before first dispatch. Dispatches with `work dispatch <id> --to <Engineer> --touches a,b` (or `work dispatch-batch`). When `workflow.engineerWorktree: true`, manage worktrees via `work spawn` and `work unspawn`.
  4. **Engineer Implementation**: Runs `work ack <id>` -> `skill-load --role <desk> --ticket <id>` -> implement & pass test cases -> `work done <id> --note "..."` (or `work block <id>` -> PM `work unblock`).
  5. **QA Verification**: PM runs `work dispatch <id> --to QA`. QA verifies strictly against acceptance criteria: `work verify <id> --pass|--fail --evidence "..."`. Fail returns to same Engineer. QA never extends scope or edits code.
  6. **Closure & Post-merge Cleanup**: Ticket done only on QA pass. Once merge is Board-approved, PM cleans spoke in the same turn: `work unspawn <id> --worktree <path>`, then `git branch -d <branch>` (never `-D`).
- **Fast Track (Small Tickets)**: Approved plan, 1 to `workflow.fastMaxTouches` (default 3) `--touches` paths, no `dependsOn`, no schema/security changes. Dispatched with `--fast`. On `work done`, routes directly to verifier without PM hop. Retry cap is `workflow.fastRetries` (default 4).
- **Verify Once, Completely**: The verifier's first fail lists all defects against AC in one evidence block. Later rounds only re-check those items plus regressions.
- **Task path (`--kind task`)**: Opener runs `work dispatch` -> desk `work ack` / `work done` -> opener `work close`. Only CEO/Board cancels (`work cancel`). Closed items older than `workflow.archiveDays` move to archive.

## 4. Precedence and bound skills

- **Precedence**: Board live instruction > non-overridable company rules > bound skills > other company defaults.
- **Non-overridable rules**: Board authority and appointments, reporting lines and delivery proof, authorization for destructive/irreversible operations (One-Way Door), CfT browser rules and headless default, edge-case budget and retry cap, honest evidence.
- **Bound skills** (`project-tools.json`):
  - At ticket start, run `T skill-load --role <desk> --ticket <id>`.
  - Router skills: load leaves in full with `skill-load --leaves <a,b>` before applying; cite only leaves loaded in full this ticket.
  - Leaves nest up to `skillChain.maxDepth` (default 5). Load down to the level applied.
  - Report skills honestly: **invoked** (started with Skill tool) vs **loaded/read** (skill-load or file read only); never call a read skill "used".
  - On conflict: follow skill on method, company rule on non-overridable policy; report one `policy_conflict` event to direct manager (`reportTo`).

## 5. Edge-case budget and stages

- Each ticket test case is tagged `must` (blocks closure) or `should` (never blocks closure; PM files as follow-up).
- QA fails a ticket only on a failed must case, broken functionality, data loss, security issue, or faked results.
- Acceptance depth follows milestone stage: `spike` (happy path & fatal assumptions), `feature` (listed must cases only), `hardening` (exhaustive edge cases).
- Retry cap: Past `workflow.maxQaRetries` (default 2 fails), ticket becomes blocked with `decisionNeeded` for CTO and Board.
- **Test scope by role (開發跑相關、發布前跑全部)**:
  - Engineer: Run only ticket test cases + existing tests for changed code. Iterate on failing cases only.
  - QA: Verify with ticket must cases + related tests; never run full suite as acceptance.
  - PM: Run full suite once before merging to trunk or publishing/releasing.
  - QA subagent (every role except QA): when you do QA yourself, start a Task subagent with `model` = `workflow.qaSubagentModel` in `project-tools.json` (default `claude-haiku-5.5`; `whoami` shows it) that only runs the must cases and related tests and reports selector, count and failing output (no code edits). You decide acceptance; reminder only, not script-enforced. A QA seat runs tests itself. If the subagent cannot run them or the check needs design judgement, do it directly and state why.
  - Run tests via `T test-run --role <desk> --ticket <id> -- <test command>`: output and exit code pass through, and the count, exit and time are recorded so the dashboard (往返與測試) shows per-ticket test runs and round trips at no extra token cost.
  - Every report names actual tests run (selector and count). Zero selected tests is not evidence.

## 6. Onboarding

- Every role follows AGENTS.md; ready ACK includes `agentsSha256` (`shasum -a 256 AGENTS.md`). Do not re-read if already injected by CLI.
- **Context budget**: Onboarding loads only `team-rules.md` and own role entry in `executive-roles.json`. Load `orca-cli`, `orchestration` and references only on first need, section by section.
- Full access to project skills (`.agents/skills`, `.<agent>/skills`). In worktrees without symlinks, run `link-worktree-skills` first.

## 7. Messaging and delivery

Full transport syntax and proof states: see `references/messaging-and-handoffs.md`.

- Senders deliver company events via `T send --to <recipient> --event-id <id> --role <Role> --type <type> --subject "..." --body "..."` (mailbox send, one wake-up, status ledger). Never call `orca orchestration send` or `orca terminal send` directly.
- Work results and blockers are `work` transitions (section 3), which wake the next owner.
- Script owns work delivery: wakes owner, retries once, escalates once to manager (`reportTo`, fallback CEO).
- **Delivery proof**: `turn_started` (delivered), `input_accepted` (busy, wake queued; OK), `agent_prompt_blocked` (menu stuck; escalate `blocked`, do not answer menu).
- On wake: Run `T inbox --terminal <own desk>`, reply `received` to non-work events, act on YOUR MOVE, pass `--ack <delivery_id>`, end turn only when `canEndTurn: yes`.

## 8. Operating modes

Three mutually exclusive modes switched only by Board (`work unattended on --until HH:MM` / `off`, `work longrun on` / `off`). Detailed supervisor loop: see `references/operating-modes.md`.

- **Standard mode (event-driven, default)**: All roles end turns after dispatch or report; desks resume when woken.
- **Long-run mode (長跑模式)**: Like standard mode, but all Board-facing reports load `/bro` skill (plain words, no jargon, concise; keep IDs/commands/links) and list `bro` in Skill tracking line.
- **Unattended mode (Board away)**: Keeps Mac awake on AC power (caffeinate). Supervisors maintain context with `inbox --wait` blocking loop until dispatches settle.

## 9. Turn hygiene, services and browser

- Never leave turn-attached background processes (cannot receive messages while waiting).
- Long-lived services (browsers, dev servers) run in a dedicated Orca service terminal (`orca terminal create`). Short one-off processes use detached start (`setsid`/`nohup`, log under `.scratch/`).
- **Headless by default**: CfT runs with `--headless=new` on isolated profile and CDP port, unless `browser.headless: false` in `project-tools.json`. Only the Board toggles headless mode.

## 10. Launch

- Launch every company member through `prepare-launch` and run printed argv.
- Copilot members use `copilot --yolo --model <model>`. AGY members use `--dangerously-skip-permissions`. Pi uses `--approve`. Never bypass Board approvals.

## 11. Task continuity

- Ledger is the continuity record: after restart, compaction, or Board interruption, `T whoami` shows what each desk owes (resume oldest first).
- Hooks inject `whoami` at session start and after compaction, and refuse turn end while YOUR MOVE is non-empty.
- **Watchdog** (`work watch --once`): Finds Stalls (exceeding `workflow.handoffMinutes`) and re-wakes owners up to `maxWakes` before marking UNDELIVERED. The per-team launchd schedule is installed by the approved deploy and removed by the approved disable; a teamId already used by another project is refused.

## 12. Limits and dissolution

- No automatic quota replacement or writer fencing. Non-Orca environments follow procedures manually.
- Dissolve company only at Board-confirmed safe point after dispatch stops and all desks offboard.
