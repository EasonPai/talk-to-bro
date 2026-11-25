# T-3 Spec: clear Bro Chat editor, then send

Authoritative plan: [plan](../plans/2026-11-05-T-3-clear-bro-editor-plan.md) (Board approved 2026-11-05). Ticket: [T-3](../tickets/T-3.md).

## Behavior
- If the Bro Chat Gemini editor holds a different unsent draft, discard it automatically: clear -> verify empty -> insert this Talk's text -> verify exact text -> click send once.
- `checkReady` stays read-only and no longer returns `EDITOR_BUSY` merely because of a different draft.
- Unchanged: generating => busy (never press Stop); clear/insert failure => no send; unconfirmed send never resent; write-ahead and interruption rules in `runner.ts`; `normalizeText` rules.
- Scope: only the configured Bro Chat unsent input. Do not touch history, sent Talks, or Popup/side-panel drafts. No confirmation prompt, backup, recovery, or setting. No `innerHTML`/HTML fallback.

## Acceptance
M1-M8 in the plan are must; S1 is should. Real-CfT check (CDP 9222, existing tab) of claude, haiku, Anthropology, apple with a pre-existing draft and with an empty editor is mandatory (M7).

## Touch files
`src/adapter/entry.ts`, one new adapter DOM test file, related existing tests only if needed, `package.json`, `package-lock.json`, `manifest.json` (version 0.1.12 on top of the then-current main value).
