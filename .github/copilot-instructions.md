# GitHub Copilot Instructions for Talk To Bro

All instructions, architecture patterns, coding conventions, and operational guidelines for this repository are centralized in [AGENTS.md](../AGENTS.md).

Always read and strictly follow [AGENTS.md](../AGENTS.md) as the authoritative Single Source of Truth (SSOT).

## Core Policies

### 1. Version Synchronization (版本同步規範)
在 `talk-to-bro` 倉庫中，所有更改（包含程式碼、設定與文件）皆必須同步更新版本號，並保持以下三個檔案的版本號嚴格一致：
- `package.json`
- `package-lock.json`（包含頂層與 packages[""]）
- `manifest.json`

### 2. Implementation Workflow
- 遵循「先計畫後實作 (Plan First)」原則。
- 遵循雙向門原則（Two-Way Door Autonomy vs One-Way Door User Authorization）。
- 嚴格遵守 `AGENTS.md` 規範與 Chrome MV3 擴充套件架構。
