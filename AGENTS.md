# AGENTS

Welcome to **Talk To Bro** (`talk-to-bro`). This document serves as the Single Source of Truth (SSOT) for all AI agent workflows, conventions, and operational guidelines in this repository.

---

## 專案定位與核心架構

`talk-to-bro` 是一個輕量、極速的桌面 Chrome MV3 擴充套件，讓使用者在瀏覽器任何分頁閱讀時，能透過快捷鍵直接叫出彈出視窗（Popup），輸入英文單字或片語，由背景常駐的 Gemini（**Bro**）使用已啟用翻譯 Skill 的對話（**Bro Chat**）進行解答，並在 Popup 中無縫讀取結果。

### 核心架構原則
1. **Service Worker (SW) 主導時間推進**：SW 每秒輪詢背景 Bro Chat 分頁，杜絕定時器節流問題。
2. **單一真實狀態 (SSOT)**：以 `chrome.storage.local` 作為全域狀態來源，SW 為唯一狀態寫入者，Popup 僅響應與渲染。
3. **Write-ahead 預先防護**：送出前先標記狀態，重啟或中斷時絕不重複發送。
4. **零阻礙退路 (Handoff)**：遇到未預期 DOM 改版或逾時，自動將輸入複製至剪貼簿並導引至 Bro Chat。

---

## 開發環境與規範

### 運行環境要求
- **Node.js >= 22**（專案以 `.nvmrc` 指定，`pretest` 會強制檢查 `node >= 22`）。
- **套件管理**：使用 `npm`。
- **版本同步**：本倉庫所有更改（含程式碼、設定與文件）皆須同步更新版本號，並保持 `package.json`、`package-lock.json`（頂層與根套件）及 `manifest.json` 的版本一致。

### 常用命令
```bash
# 建置擴充套件 (產出於 dist/)
npm run build

# 執行全套單元測試與覆蓋率報告
npm test

# 驗證特定階段 E2E / 驗證腳本
npm run verify
npm run verify:m3
npm run verify:m4
npm run verify:m5
```

---

## Agent 行為與編程規範

### 圖表規範 (Diagrams & Visualizations)
- **強制使用 Mermaid**：所有流程圖、架構圖、狀態圖一律使用 Mermaid（` ```mermaid ... ``` `）語法。
- **嚴格禁止純文字 ASCII 框線圖**。
- **終端機環境與窄寬度自動降級規範 (CLI / Terminal & Narrow Width Degradation)**：當處於終端機（CLI / Terminal）環境、窄寬度檢視或發生寬度降級（導致 Mermaid 無法圖形渲染、排版破版或僅顯示原始碼）時，**將自動降級，不再輸出 Mermaid**，改用終端機原生友善、排版清晰的等寬程式碼區塊（` ```text `）或結構化流程清單呈現。
- **嚴格禁止在節點標籤內使用 HTML 標籤**（如 `<br>`, `<br/>`, `<b>` 等）。換行改用圓括號 `( ... )` 或連字號 ` - `。
- 節點標籤若包含特殊字元，一律使用雙引號包覆（例如：`id["Bro Chat (Gemini)"]`）。

### 檔案超連結 (Clickable Links)
- 輸出中所有涉及本專案檔案、路徑或程式碼符號時，必須使用 Markdown 點擊連結（`[filename](file:///absolute/path/to/file)`）。

### 操作自主原則 (Two-Way Door Principle)
- **可逆操作 (Two-Way Door)**：分支建立、測試執行、依賴安裝、無未提交變更之分支切換，自主執行。
- **不可逆操作 (One-Way Door)**：任何可能導致資料遺失或破壞性變更的操作（`rm -rf`, `git reset --hard`, `git push --force` 等），必須先取得使用者授權。

<!-- AGENTIC_TEAM:START -->
## Optional agentic team (company)

Read `tools/roles/config/team-config.json` before applying company rules. Only when `enabled` is exactly `true`, read `tools/roles/config/team-rules.md` and the installed `ep-agentic-orca-team` Skill. Role authority comes exclusively from `tools/roles/config/executive-roles.json`; identity checks use `python3 tools/roles/executive-identity.py` from the project root. If the Skill is unavailable, the pinned local rules and CLI remain available for recovery checks.

When disabled (company dissolved), role claiming, dispatch and direct-manager reporting rules do not apply. General project rules continue to apply. Installation and deployment do not authorize role appointment, desk (terminal) launch or product work. Terminal titles and checkpoints provide context, never authority. Do not proceed if status reports conflict or partially-applied.
<!-- AGENTIC_TEAM:END -->

<!-- AGENTIC_SETUP:CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- AGENTIC_SETUP:CODEGRAPH_END -->

<!-- AGENTIC_SETUP:GRAPHIFY_START -->
## graphify

This project maintains a curated knowledge graph at `graphify-out/` covering domain models, architecture, and cross-file relationships.

### Rules & Navigation
- **Query first:** For codebase concepts, architecture, or cross-document relationships, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for connection paths and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, significantly smaller and cleaner than raw search or reading whole files.
- **Wiki navigation:** If `graphify-out/wiki/index.md` exists, use it for structured domain and component navigation.
- **Architecture review:** Read `graphify-out/GRAPH_REPORT.md` only for high-level architecture overview or when query/explain do not surface enough context.
- **Graph Rebuild Rules (DO NOT run `graphify update .`):**
  Never run bare `graphify update .`. Scope extraction to docs/ and root specifications.
<!-- AGENTIC_SETUP:GRAPHIFY_END -->

<!-- AGENTIC_SETUP:CFT_START -->
## Conventions

### Web UI Verification & Chrome for Testing (CfT)

- **前端驗證與瀏覽器操作規範**：
  - 嚴禁直接在終端機使用 `open http://...` 啟動日常個人瀏覽器。
  - 所有 Web UI、靜態 HTML Artifacts 預覽、實機前端測試與 CDP 遠端除錯，**一律強制遵循 [`docs/testing/chrome-for-testing-setup.md`](docs/testing/chrome-for-testing-setup.md)**。
  - 必須透過 Chrome for Testing 實例搭配專用隔離 Profile (`~/.chrome-cdp-profile`) 與 CDP Port 9222 進行驗證，並優先喚醒現有分頁，禁止重複開新分頁。
<!-- AGENTIC_SETUP:CFT_END -->

<!-- AGENTIC_SETUP:SKILL_TRACKING_START -->
### Agent Skills Execution Tracking

- **Skill 執行鏈與多層級追蹤規範 (Skill Call-Chain & Multi-Skill Tracking)**：
  - 當 Agent 在對話或回覆中**執行或觸發任何 Skill**，或任務涉及 Skill 時，必須在回覆的**最開頭**明確標註所使用的 Skill 調用鏈：
    - 若前次對話有使用 Skill：`> **前次對話使用 Skill**：[Skill 調用鏈]`
    - 若本次對話有觸發 Skill：`> **本次觸發 Skill**：[Skill 調用鏈]`
    - **無使用則不顯示原則 (Omit If None)**：若前次或本次對話**沒有使用任何 Skill**，則**不需要**輸出該行（切勿輸出「無」）。若兩者皆無使用 Skill，則最開頭完全不需要保留任何 Skill 追蹤行。
  - **全鏈路展開與窮舉原則 (Complete Call-Chain Enumeration)**：
    - **禁止只列入口 Skill**：只要當前回合中（包含主 Agent 與任何派出的 Subagent）有讀取任何 `SKILL.md` 或實際套用多個技能規範，**必須全部列出，不得遺漏**。
    - **串聯調用表示法**：當入口 Skill 內部調用或串聯了其他子技能時，使用 `→` 展開調用鏈，同層多個技能以 `,` 分隔（例如：`` `ep-skill-handbook` → [`diagram-design`, `show-me`, `asd-ste100`] ``）。
    - **跨 Subagent 匯總**：若透過 Subagent 執行特定技能，必須要求 Subagent 回報其使用的所有 Skills，並於主回覆中匯總標註 `(via Subagent)`（例如：`` `ep-agentic-brd` → [`speckit-specify`, `speckit-clarify`] (via Subagent) ``）。
    - **跨輪次完整繼承**：下一輪對話的「前次對話使用 Skill」必須完整保留上一輪展開後的完整調用鏈，不得自行縮減。
<!-- AGENTIC_SETUP:SKILL_TRACKING_END -->

<!-- AGENTIC_SETUP:FILE_LINKS_START -->
### Clickable File References (檔案一律附可點擊連結)

- **適用範圍**：Agent 在回覆、報告、計畫、交接訊息中提到**專案內檔案**（含 worktree 內檔案）時，一律提供點擊即可開啟該檔的連結。
- **對話回覆 / 終端輸出**：顯示文字可只寫檔名，不必列出完整路徑；連結目標使用絕對路徑 `file://` URL，例如 `[SKILL.md](file:///abs/path/to/SKILL.md)`。路徑含空白或非 ASCII 字元時須 URL 編碼。
- **提交進版控的文件**（docs、計畫、README 等）：使用相對路徑 Markdown 連結，例如 `[team-rules.md](../config/team-rules.md)`，禁止寫入本機絕對路徑。
- **指定行號**：行號寫在顯示文字（例如 `[team-setup.py:660](file:///abs/path/team-setup.py)`），連結仍指向檔案本身。
- **例外**：程式碼區塊內的指令與外部網址（照常使用 https 連結）不受此限。
<!-- AGENTIC_SETUP:FILE_LINKS_END -->

<!-- AGENTIC_SETUP:DYNAMIC_SKILL_SANDBOX_START -->
### Skill Management & Discovery Protocol (Skill Manager 統一管理與嚴格邊界協議)

為保持專案主幹乾淨並精確控制專案受影響範圍，所有 Skills 統一遵循以下管理與查找邊界原則：

1. **查找優先順序與嚴格邊界 (Discovery Precedence & Strict Scope Boundary)**：
   當需要調用或尋找任何 Skill 時，Agent 必須強制遵循以下順序查找：
   - **優先級 1（最高優先）**：專案本地與 Worktree 專用目錄 `.agents/skills/<skill-name>/`（專門放置本專案或當前 Worktree 特化/正在開發的 Skills）。
   - **優先級 2**：由 Skill Manager 在專案根目錄建立的各 Agent 目錄（如 `.<agent>/skills/<skill-name>/`，包含 `.claude/skills/`, `.codex/skills/`, `.gemini/skills/`, `.cursor/skills/`, `.copilot/skills/`, `.hermes/skills/`, `.opencode/skills/`, `.grok/skills/` 等）。
   - **嚴格邊界限制（禁止越界查找）**：若上述兩個位置皆找不到，**絕對禁止**逕自前往全域路徑、主機快取（如 `~/.cache/`）或遠端網路抓取/Clone。缺少 Skill 時必須明確向使用者回報，由使用者透過 Skill Manager UI/CLI 統一安裝與管理至專案中。

2. **Git 忽略與主幹乾淨 (Gitignore Hygiene)**：
   - 所有由 Skill Manager 管理並 Symlink 到專案根目錄的各 Agent skills 目錄（如 `.<agent>/skills/*`），一律加入 `.gitignore`，不提交進版控。
   - 僅本專案或 Worktree 本地專屬的 `.agents/skills/` 視專案需求納入版控。

3. **Antigravity CLI (agy) 技能橋接與過濾機制 (Skill Discovery Bridge & Exclude Filter)**：
   - 透過受版控追蹤的 `.agents/skills.json` 將 Skill Manager 建立於 `.gemini/skills/` 的技能橋接至 `agy`，確保所有模型與工具皆可探索與調用技能。
   - 使用 `exclude` 陣列（如排除 `poteto-.*`、`principle-.*`），精簡技能清單，避免注入過多不相關的規則或技能。

4. **Git Worktree 技能符號連結注意事項 (Worktrees Lack Symlinks)**：
   - Git Worktree（如 `.worktrees/*`）為獨立目錄，建立時不會自動繼承根目錄被 `.gitignore` 忽略的 `.<agent>/skills/` 符號連結（symlinks）。
   - 若在 Worktree 內需要使用外部技能，需執行 link-worktree-skills 腳本（`products/agentic-env/scripts/link-worktree-skills.sh` 或相關工具腳本）建立符號連結與 local exclude 忽略。

5. **`ep-*` 專屬技能單一維護來源原則 (Source of Truth for `ep-*` Skills)**：
   - 所有 `ep-*` 技能的唯一編輯與維護來源（Source of Truth）一律嚴格限定於 GitHub `EasonPai/ep-skills` 的本機 checkout（位於 `skills/<category>/<skill>/`）。**不寫死路徑**：一律執行 `bash .agents/skills/ep-agentic-env-setup/scripts/resolve-ep-skills-root.sh`（或任一 `.<agent>/skills/ep-agentic-env-setup/scripts/` 下同名腳本），只編輯它印出的目錄。腳本從目前專案往上逐層尋找 `ep-skills/source/ep-skills` 或 `ep-skills`，並驗證 origin 為 `EasonPai/ep-skills` 且含 `scripts/publish-skills.sh`。
   - 解析失敗時**回報 blocked**，嚴禁自行猜測或改用其他副本；特殊位置可用 `EP_SKILLS_ROOT` 臨時覆蓋（同樣會驗證）。
   - **嚴格禁止**直接在專案的 `.<agent>/skills/ep-*`（symlinks）或 `~/.skills-manager/skills/ep-*` 快取中進行編輯。
   - 修改完成後，必須在 `ep-skills` 儲存庫中透過 `scripts/publish-skills.sh` 進行版本提交、推送到遠端 origin，並觸發 Skills Manager 刷新安裝；嚴禁在發布流程中使用強制推送（never force push）。
<!-- AGENTIC_SETUP:DYNAMIC_SKILL_SANDBOX_END -->
