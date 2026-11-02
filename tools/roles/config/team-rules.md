# Minimal local company (team) rules

Contents: 1 Scope and authority · 2 Wording · 3 Delivery workflow (work model) · 4 Precedence and bound skills · 5 Edge-case budget and stages · 6 Onboarding · 7 Messaging and delivery · 8 Operating modes · 9 Turn hygiene, services and browser · 10 Launch · 11 Task continuity · 12 Limits and dissolution

## 1. Scope and authority

- These rules apply only when the adjacent team-config.json has enabled=true and deployment status is clean.
- executive-roles.json is the only effective role policy. Read it before role recovery. The effective executive-roles.json is authoritative if it differs.
- Appointments:
  - The Board (`human`) appoints CEO.
  - The Board or CEO appoints every other role; PM may also appoint Engineer and QA.
  - **Board liaison**: whoever staffed the current team reports to the Board for it: the Board-appointed desk that made the latest appointment (CEO for the full company, PM for a PM-led squad; CEO if nobody has appointed yet). Other desks never take Board decisions to the Board themselves; they reach it through `work` transitions, which wake the liaison.
  - **Every report to the Board ends with three lines**: `Status:` one sentence; `Decision needed:` what the Board must decide, or `none`; `Next step:` what happens next and who does it, plus `Team recommendation:` the squad's advised option and why (gather the Architect's or other desks' view first when the choice is technical). A report without a next step or recommendation is incomplete. The liaison never ends a Board conversation with results only.
  - Seats: Engineer and QA may run several desks (`Engineer#1`, `Engineer#2`) up to `project-tools.json` `seats`; other roles have one seat. Only the Board changes seat counts; CEO staffs or offboards seats (`--seat N`) and announces it. Seat 1 is the plain role. Reports use the seat label as `--role`.
  - Consultant is optional: skip it when staffing the company; CEO (or CTO/PM) appoints it only on request, and it reports to its appointer (`reportsTo: assigner`).
- A terminal title cannot create appointment authority.
- Reinstatement (`rebind`) requires current provenance; checkpoints cannot revive offboarded (revoked) tasks.
- A `stale_config` identity status never pauses work: act under the current binding and do not ask whether to rebind. Rebind only when the Board, CEO or PM explicitly instructs it.
- PM tracks progress without acquiring technical acceptance.

## 2. Wording

- The config value `human` means the Board (董事會).
- In plans, tickets, messages and reports always write "the Board"/「董事會」, never "human"/「人類」/「使用者」.
- Use company terms (onboard/入職, reinstate/復職, appoint/任命, direct manager/直屬主管).

## 3. Delivery workflow (work model)

`T` below means `python3 <ep-agentic-orca-team>/scripts/team-setup.py --project <repo>`.

- **One source of truth**: work state lives only in the ledger `.scratch/orca-team/events.jsonl`, and only `T work <action> <id>` changes it. The command checks the state, the acting desk (from `ORCA_TERMINAL_HANDLE`; `--role` only where no desk is bound, `--role Board` for the Board's decisions; only `approve`/`return` record them, and the Board liaison desk may record them for the Board with `--evidence` quoting the Board's exact words, logged as `relayedBy`) and the gates, writes nothing on refusal, and wakes the next owner (when the Board owns the next move, it wakes the Board liaison, who presents the decision to the Board). Ticket frontmatter `status`/`retries` are mirrors it writes; never edit them by hand. Messages, notices and terminal output are never work items and never change state.
- **Every turn starts with `T whoami`** (also appended to `T inbox`; CLI hooks inject it at session start and after compaction). It lists YOUR MOVE, QUEUE, WAITING ON OTHERS, STUCK (no assignee event for workflow.stallMinutes, default 30) and PENDING BOARD, each with the exact next command. **Do not end a turn while YOUR MOVE is non-empty** (`canEndTurn: no`) Serve the oldest ticket first (whoami marks it NOW, the rest NEXT); do not skip ahead: continue, or record `work done` / `work block`.
- Ticket path (`--kind ticket`, development work):
  0. **Intake**: CEO, PM or the Board runs `work open <id> --kind ticket --title "..."`. PM routes it: `work plan <id>` (to CTO; the default for any new, large or plan-worthy change) or, only for a typo, copy text, one config value or an approved retry, `work ready <id> --reason "<trivial reason>"`. When in doubt, plan.
  1. **CTO** does root-cause and design, saves the plan under the plans dir of project-tools.json naming every ticket ID it covers (acceptance criteria and must/should test cases per ticket), and runs `work submit-plan <id> --plan <path>` (refused if the plan does not name the ticket). CTO never hands work to Engineer.
  2. **The Board** decides; the Board liaison desk (or the Board's own unbound terminal) records it with `work approve|return <id> --role Board --evidence "<the Board's words>"`.
  3. **PM** opens ticket files per project-tools.json (ticketing.skill, null = file tickets in ticketing.fileDir; a configured skill missing from the project means report blocked to CEO, never install it), copying CTO's test cases, then `work dispatch <id> --to <Engineer desk> --touches a,b` (refused while another open item touches the same paths, or if the desk is unbound). For parallel work the Architect declares `touches:` and `dependsOn:` in each approved plan's frontmatter; PM then runs `work dispatch-batch --items T-1,T-2 --to Engineer,Engineer#2` (all checks first, nothing dispatched on any failure; limited by `workflow.maxParallel`, default 1; PM cannot override a declared dependency; PM merges in the listed order). A new seat's terminal runs in its spoke worktree but binds to the main workspace: `prepare-launch --role Engineer --seat 2 --terminal-worktree <path>`; its model comes from the profile's optional `seats` map (e.g. `"Engineer#2"`), else the role's, and `--cli/--model/--effort` give a one-off override that is recorded as differing from the profile. PM gives each Engineer seat its own worktree or branch and sets the merge order (with `workflow.engineerWorktree: true`, `work spawn <id>` creates the worktree and links skills for the existing desk, which keeps its terminal where it is and must act on the worktree explicitly (absolute paths or `git -C <worktree>`, never the trunk checkout); add `--new-seat` to also reserve a new Engineer/QA seat for parallel work, which is launched fresh with `prepare-launch` because Orca cannot move a live terminal; seat numbers never repeat; `work unspawn <id> --worktree <path> [--seat N]` removes a clean spoke); rebase conflicts return to the owning seat.
  - PM opens tickets with the bound `to-tickets` skill. Before the **first** dispatch to an Engineer, PM runs `to-spec` once. This is a rule PM follows, not a check the script enforces; later dispatches do not repeat it.
  - **Worktree creation**: use `work spawn` with `--project <main-project-root>`. It creates `.worktrees/<ticket-id>-<title-slug>` from that root's checked-out commit using Git, with the exact branch name (e.g. `T-79-adapt-clear-data-advanced-popover`, no account or role prefix). It verifies Orca discovery and the explicit parent at the main project root, then runs the shared initializer. A failure preserves the checkout for inspection and reserves no seat; report the error, do not launch or dispatch into it. Do not bypass this with an inferred-base `orca worktree create`.
  - **Orca setup hook**: call `python3 <ep-agentic-orca-team>/scripts/worktree_setup.py --project <main-project-root>` from the new checkout. This same initializer validates the project and branch and links available project skills; it never installs dependencies, appoints roles or dispatches work. Git-created spokes call it directly because they do not run Orca creation hooks. An Orca UI setup error does not imply agent startup was blocked; check its configured startup policy.
  4. **Engineer** runs `work ack <id>`, then `skill-load --role <desk> --ticket <id>` (section 4), implements and passes the test cases, and finishes with `work done <id> --note "<outcome, commits, skill chain>"` (refused without a skill-load record for this ticket). Plan gaps or blockers: `work block <id> --reason "..."`; PM routes them to CTO and resolves with `work unblock <id>`. Engineer never hands off to QA and needs no CTO code review.
  5. **QA**: PM runs `work dispatch <id> --to QA`. QA verifies only against acceptance criteria and test cases and records `work verify <id> --pass|--fail --evidence "<cases run / failing case IDs and reproduction>"`. A fail returns the ticket to the same Engineer desk. QA never extends scope, adds tests, changes requirements or edits code.
  6. **Close**: a QA pass is the only way a ticket becomes done. PM dispatches the next ticket and reports to CEO when all are done or blocked.
- Task path (`--kind task`, small non-development work such as research or an ops step): the opener runs `work dispatch <id> --to <desk>`, the desk runs `work ack` / `work done`, and the opener checks the result and runs `work close <id>`.
- Only CEO or the Board cancels: `work cancel <id> --reason "..."`. `work list`, `work show <id>` and the dashboard read the same ledger. Final items older than workflow.archiveDays (default 7) move to `.scratch/orca-team/archive/` when the dashboard runs.

## 4. Precedence and bound skills

- **Precedence**: Board's live instruction > non-overridable company rules > bound skills > other company defaults.
- **Non-overridable rules**: Board authority and appointment authority (including human-only roles), reporting lines and delivery proof, authorization for destructive or irreversible operations, CfT browser rules and headless default, the edge-case budget and retry cap, and honest evidence (no faked results).
- **Bound skills**: project-tools.json `skills` maps a role (or "*" for every role) to skill names.
  - At the start of every ticket run `team-setup.py skill-load --role <desk label> --ticket <id>`; earlier-turn reads never count (changes apply without reinstatement). It prints each bound entry plus a leaf index and logs a skill-load record.
  - Router skills: before applying any leaf (principle, routed skill or playbook), load it in full with `skill-load --leaves <a,b>` (or `--all-leaves`). Applying a leaf from the entry or index alone is a violation; cite only leaves loaded in full this ticket.
  - Leaves can nest (up to 5 levels by default, per-role via `skillChain.maxDepth`; items marked ↗ are other skills listed but not expanded, load them by name if needed; the index shows chains like `architect > references/x.md`). Load down to the level you apply: a leaf's own leaves follow the same rule, and `--leaves` accepts a name or a full chain.
  - `work done --note` carries the skill chain: entries and leaves loaded for this ticket.
  - Skill-chain files (`.scratch/orca-team/skill-chains/<desk>.jsonl`) hold only `skill-load` records plus at most one short line naming the leaves applied. Verdicts, test methods and evidence go in the ticket or the `work` note/evidence, never in the skill chain.
  - `skill-report` (also run by `dashboard`) keeps the newest 50 records per desk, archives older ones under `archive/YYYY-MM/`, and writes the Chinese summary `skill-chains/SUMMARY.md` for the Board. With `"skillChain": {"autoReport": true}` in project-tools.json, every `skill-load` also does this (default off; toggle anytime, no redeploy).
  - A bound skill missing from the project skill directories is reported blocked, never installed by the desk.
  - Only the Board binds skills; CEO edits `skills` and announces the change to affected desks.
- **On conflict**: follow the skill on method (how to test, design, review, debug, write); follow the company rule on anything non-overridable, and send one `policy_conflict` event (skill, rule, chosen action) to the direct manager (`reportTo`) and record it with record-event; CTO or the Board resolves it with decision_made.

## 5. Edge-case budget and stages

- Each ticket test case is tagged must (blocks closure) or should (never blocks).
- QA fails a ticket only on a failed must case, broken functionality, data loss or security issue, or faked results; every other finding is a follow-up recommendation, which PM files as a new ticket without blocking closure.
- Acceptance depth follows the milestone stage in project-tools.json:
  - spike: happy path and core assumption only; validates core feasibility and fatal assumptions.
  - feature: listed must cases only; acceptance follows approved AC without extra scope.
  - hardening: exhaustive edge cases; exception matrices and prolonged observation.
- Retry cap: `work verify --fail` counts retries; past workflow.maxQaRetries (default 2) the ticket goes to blocked with decisionNeeded, and PM asks CTO and the Board to relax, split or continue (then `work unblock` or `work cancel`). whoami and the dashboard list it under PENDING BOARD.
- Blockers are substantive breakage, fabricated success or async deadlock; other suggestions belong in follow-up work.
- Separate executed evidence, static review, third-party claims and unverified checks.

## 6. Onboarding

- **Onboarding gate**: every role, however appointed (prepare-launch prompt or the Board typing "You are <Role>"), follows AGENTS.md, and its received/ready ACK includes agentsSha256 (first 12 hex of sha256 of AGENTS.md, computed with `shasum -a 256 AGENTS.md`).
  - If the agent CLI already injected AGENTS.md as custom instructions, do not re-read it; otherwise read it in full first.
  - A supervisor treats an ACK without a matching agentsSha256 as not onboarded.
- **Context budget**: onboarding loads only team-rules and the own role entry in executive-roles.json. Load orca-cli, orchestration and skill references only when first needed, and only the needed section (for example `orca skills get orchestration --reference references/messaging-and-gates.md`).
- **Skills access**: roles keep full access to the project's skills (.agents/skills and the agent skill directories such as .claude/skills, .github/skills, .gemini/skills); the role contract limits authority, not tools, so roles discover and use matching skills during development under AGENTS.md rules.
  - In a git worktree without skill links, run the project's link-worktree-skills script first; unreachable skills are reported as blocked.

## 7. Messaging and delivery

- Before the first Orca messaging (not at onboarding), load the current messaging reference from `orca skills get orchestration --reference references/messaging-and-gates.md` and the needed orca-cli section for arguments; load full guides only when a section is insufficient.
- Background work requires a verified direct manager (`reportTo`). No reporting line means no background start.
- **Event contents**: events carry the appointment ID (`assignmentId`), unique eventId, source, destination, policy revision and evidence.
- **ACKs**: acknowledge receipt (received ACK) correlated to the original eventId, then completed or blocked. input_accepted does not prove receipt. Unknown delivery requires a correlated ACK, not blind resubmission. Retry with the same deduplication identifiers.
- **Delivery (both modes)**: senders deliver every company event only with `python3 <ep-agentic-orca-team>/scripts/team-setup.py --project <repo> send --to <recipient desk> --event-id <eventId> --role <Role> --type <event type> --subject "<one line>" --body "<details>"` (mailbox send, then one wake-up of the recipient desk, then the status ledger; it exits non-zero naming the failed step and is idempotent per eventId; never call `orca orchestration send` or `orca terminal send` for company events directly).
  - Mailbox enqueue alone does not wake an idle desk.
  - Work results and blockers are `work` transitions (section 3), which wake the next owner themselves; use `send` only for other company events (received, policy_conflict, awaiting_timeout, mode announcements).
  - **The script owns work delivery**: a `work` transition wakes the next owner, retries a failed Wake once, escalates once to the owner's `reportTo` (fallback CEO; Board-owned items go to the Board liaison) and records every attempt as a Delivery record in the ledger. The Watchdog (section 11) re-wakes Stalled owners. Never resend or re-wake by hand; a `notify` status that names an escalation or `undelivered` is information, not a task to retry.
  - One wake-up per eventId; never resend the original event.
  - Report completed, blocked and paused events only this way, never as plain terminal input. Output in one's own terminal is not delivery.
- **Delivery proof**:
  - `turn_started` means delivered.
  - `input_accepted` means the recipient is busy and the wake-up is queued until its turn ends, which is acceptable.
  - `agent_prompt_blocked` means the recipient shows a menu or cannot take input: never resend and never answer its menu, immediately escalate `blocked` (target desk, observed state) to the direct manager (`reportTo`) and the Board.
- **On being woken**, a desk runs `python3 <ep-agentic-orca-team>/scripts/team-setup.py --project <repo> inbox --terminal <own desk>` (heartbeats filtered; the output ends with the desk's whoami), replies received (with the original eventId) to non-work events, acts on YOUR MOVE, passes --ack <delivery_id>, and ends its turn only when canEndTurn is yes.

## 8. Operating modes

- The company runs in one of three modes: standard (default), unattended or long-run. Only one is active at a time, and only the Board switches modes (for example "enter unattended mode until 07:00" / "enter long-run mode" / "return to standard mode").
- The switch is `T work unattended on --until HH:MM` / `T work unattended off` (`--role Board`; the Board liaison relays the Board's words with `--evidence`). `--until` is required and the mode ends itself then. whoami shows the current mode; the CEO also announces a switch to every desk with `send`.
- Unattended mode keeps the Mac awake (caffeinate) only on AC power while a desk (not the Board) has open work; it holds only while the Watch schedule is installed (so a later run can release it), never wakes a sleeping Mac and grants no new authority: every Board gate and One-Way Door still waits for the Board, who is notified on macOS.
- **Standard mode (event-driven, default)**:
  - Every role, including CEO, PM and CTO, ends its turn once its work is dispatched or reported, so the Board can address any desk directly at any time; desks resume only when woken by events.
  - No blocking wait loops. awaitingTimeoutMs escalations are not tracked automatically; the Board is present.
- **Long-run mode (長跑模式)**:
  - Switch: `T work longrun on` / `T work longrun off` (`--role Board`; the Board liaison relays with `--evidence`). It has no `--until` and stays on until the Board turns it off. It is refused while unattended mode is on, and the reverse is also refused.
  - Every other rule is the same as standard mode.
  - Before any output meant for the Board (liaison decision requests, completed or blocked reports, PENDING BOARD summaries and direct answers to the Board), load the `/bro` skill and write the report in its style: plain words, no jargon, short. Keep commands, ticket IDs and file links unchanged, and list `bro` in the Skill tracking line. whoami shows `mode: longrun` with this reminder. If `bro` is unreachable, report blocked.
- **Unattended mode (Board away)**:
  - Supervisors (CEO, PM, CTO or any appointer) must not end their turn while any dispatch is open.
  - Repeat `python3 <ep-agentic-orca-team>/scripts/team-setup.py --project <repo> inbox --terminal <own desk> --wait --timeout-ms 900000` (exit 3 = timeout checkpoint; never hand-parse raw `check --wait` output), passing --ack <delivery_id> after handling each batch, until every expected dispatch settles.
  - If no received ACK arrives within 120000 ms of a send, the wake-up above counts as the single nudge. If still no received ACK by policy.awaitingTimeoutMs, escalate awaiting_timeout to the direct manager (`reportTo`) and never resend the original dispatch.
  - This blocking wait is not polling; looping over terminal read/list remains forbidden. A timeout or empty result is a checkpoint, not failure.
  - After three consecutive empty waits, run `orca orchestration worker-list --json` and act only on each row's `nextAction`; otherwise keep waiting.
  - When cumulative wait exceeds policy.awaitingTimeoutMs, send awaiting_timeout to the direct manager (`reportTo`) once per appointment, then keep waiting.
  - Leave the loop only on settlement or positive proof the worker stopped (see the orchestration skill's Outcome rules); the Board can interrupt a waiting desk with Esc without losing mail.

## 9. Turn hygiene, services and browser

- Never leave turn-attached background processes; a turn waiting on background shells cannot receive messages.
- Run long-lived services (browsers, dev servers) in a dedicated Orca service terminal (`orca terminal create`) and record its handle in the task file.
- Use a detached start (setsid/nohup, log under .scratch/) only for short one-off processes, record the PID, and stop every service when done.
- Browsers follow the project CfT rules (AGENTS.md): one CfT instance launched in that service terminal on the isolated profile and CDP port; other agents attach via CDP and never launch a second browser on the same profile.
- **Headless by default**: the service terminal launches CfT with `--headless=new` unless project-tools.json `browser.headless` is false (missing means true); headless desks never call CDP `/json/activate` or `open -a` the browser, so no window pops up.
  - Only the Board toggles it ("turn headless off/on"); CEO updates `browser.headless`, the service terminal restarts the single CfT instance in the new mode.
  - A step needing human hands (for example OAuth login) temporarily runs headed and returns to headless afterwards.

## 10. Launch

- Launch every company member through `prepare-launch` and run its printed argv.
- Copilot members always start with `copilot --yolo --model <model>`. Never launch a Copilot member without `--yolo` (for example via a bare `orca agent launch`).
- AGY members use `--dangerously-skip-permissions`. Pi executes tools without per-call approval by default; use `--approve` for noninteractive project trust, not a nonexistent `--yolo` flag. These launch modes do not bypass Board approvals or override custom extension restrictions. Check the prepared command before launch and report permission prompts as blockers rather than claiming unattended readiness.

## 11. Task continuity

- The ledger is the continuity record: after a restart, compaction or an inserted Board request, `T whoami` shows what each desk still owes; resume YOUR MOVE items oldest first and preserve approval gates.
- Hooks (written by deploy unless `--no-hooks`: `.claude/settings.json`, `.codex/hooks.json` (trust once with `/hooks`), `.github/hooks/orca-team.json`, `.agents/hooks.json`) inject whoami at session start, re-inject it after agy condenses context, and refuse one turn end while YOUR MOVE is non-empty. They only speed things up; the whoami rule above applies without them.
- **Watchdog** (`T work watch --once`, zero tokens): finds Stalls (the owner has not made a `work` transition on an item for `workflow.handoffMinutes` (Board items: `boardHandoffMinutes`) since it entered its state or since the last Wake; receipts, acks and status events are not progress; a desk terminal silent for `idleMinutes` is woken at once; acked `in_progress` work is never a Stall) and re-delivers within `workflow.maxWakes` Wakes plus one escalation per item state; then the item shows as UNDELIVERED in whoami and on the dashboard. A Stalled Board item also posts one macOS notification. The Watch schedule (`T work watch --install` / `--uninstall --role Board`, the Board liaison relays with `--evidence`; Board opt-in, machine-local launchd job every `workflow.watchMinutes`) runs it; plan/apply never installs it. An UNDELIVERED item is retried automatically every `workflow.retryMinutes`. Supervisors act on UNDELIVERED items (reassign, unblock, ask the Board, or `T work rewake <item>` to reset the wake budget and retry); nobody polls.
- Optional personal notes may live under the product docs/operations/task-continuity/<agent-key>.md (standalone: docs/operations/task-continuity/), but they never hold work state.
- First run on an existing project: PM runs `T work migrate --output <file>`, confirms each open entry's state and desk, sets `confirmed: true`, then `T work migrate --apply <file>`.

## 12. Limits and dissolution

- No automatic compact percentage, quota replacement, paid fallback, multi-instance role registry or writer fencing is implemented.
- Non-Orca environments can follow these procedures manually but cannot claim automatic terminal orchestration.
- Dissolve (disable) only at a Board-confirmed safe point after dispatch stops and every role is offboarded (bindings released).
- Deployment locking does not fence running agent file writes.
