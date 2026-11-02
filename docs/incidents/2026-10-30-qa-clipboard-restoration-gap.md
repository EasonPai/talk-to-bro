# Incident: QA clipboard original not preserved (UI r2 verification)

Date: 2026-10-30. Tickets: #45 (T3-1), #46 (T4-3). Recorded by PM.

## What happened
Earlier QA runs on the UI r2 artifact touched the CfT clipboard (copy stub and real Copy clicks, sentinel values) without saving a recoverable copy of the original content first. Only hashes were recorded, and those cannot restore content. The original clipboard from before those runs is unrecoverable.

## Board decision (ceo-board-historical-clipboard-exception-20261030)
The Board accepts ONLY this historical restoration exception for the preservation gap reported on #45 and #46 for the current UI artifact.

Scope limits:
- It does not waive any functional or zoom must case.
- It is not a generic waiver and does not apply to future data protection.
- Nobody may claim the original clipboard content was restored.
- No clipboard, answer or storage content is recorded here or in the tickets.

## Going forward
Before any clipboard write, QA captures a recoverable baseline into protected, git-ignored local fixture state and restores from it. If no baseline can be captured, QA does not write.

## Related evidence
- #45 readback (extension/headless Chrome context only, not OS pbpaste interop): comment 6518830540.
- #46 T4-3: comments 6518702259 and the 125% large-window follow-up.
- Small-window (800x600) 493px width and 200% clipping remain an unresolved limitation, separate from this incident.
