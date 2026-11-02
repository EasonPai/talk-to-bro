# Talk To Bro Personally (隨身聊)

<!-- impeccable:product-schema 1 -->

## Platform

web

桌面 Chrome Manifest V3 擴充套件，採 unpacked 自用安裝；不是手機 App，
也不支援其他瀏覽器。現有 manifest 的最低 Chrome 版本為 132。

## Users

主要使用者是 Pai 本人。在桌面 Chrome 閱讀網頁或工作時，需要查英文單字、
片語或逗號分隔的多個單字，不想為此切換分頁、尋找對話及反覆貼上內容。
使用者已登入 Google，並有一個預先啟用翻譯 skill 的 Bro Chat。

## Product Purpose

以「快捷鍵 → 輸入並按 Enter」完成一次 Talk，在 Popup 讀到完整 Answer，
盡量不打斷原本的閱讀與工作。

成功以「送得進 Bro Chat、讀得回完整 Answer」衡量，不承諾固定回覆秒數。
PRD 的試用目標是兩週內每週至少 20 次查詢，且不再手動開 Gemini 分頁查字；
這是驗證目標，不是已達成的成果。

## Positioning

沿用特定 Bro Chat 已啟用的翻譯 skill 與既有使用環境，由擴充套件操作該分頁，
而非另建字典、通用聊天客戶端，或透過 Gemini API 維護另一份 skill 指令。
extension 不負責啟用、設定或重新觸發 skill。

## Operating Context

- 預設快捷鍵為 `Alt+Shift+B`，可於 `chrome://extensions/shortcuts` 自訂。
  Popup 開啟後應直接接受輸入；Options 用於設定唯一的 Bro Chat URL。
- 正常 Talk 重用背景 Bro Chat 分頁；必要時建立不搶焦點的 pinned 分頁。
  Handoff 才將 Bro Chat 帶到前景。
- Popup 關閉不應中止 Talk；重新開啟應恢復最後一次輸入、等待狀態或 Answer。
- 既有實作使用 vanilla TypeScript、esbuild、marked、DOMPurify、
  Turndown 與 GFM 轉換；套件打包於擴充套件，不依賴 CDN。
- 從本產品目錄執行 `npm run build`，以 `dist/` 作為建置輸出；
  現有測試入口包括 `npm test`、`npm run verify` 及分階段驗證腳本。
  這些入口的存在不代表本次 init 已執行或通過它們。

## Capabilities and Constraints

以下是已確認的產品契約，不是全部功能已通過驗收的宣告。

- 一次 Talk 可包含單字、片語或逗號分隔的多字，最多 300 字元；
  空白或超限輸入不送出，並明確提示原因。有效輸入原樣送出。
- Answer 是本次 Talk 對應的最新完整回覆；完成後以 Markdown 呈現標題、
  清單、粗體與表格，保留原文、不刪減、不改寫，支援捲動與複製。
- 等待上限為連續 30 秒無新文字，或總等待 3 分鐘；不得以人設文案掩蓋
  真實等待、失敗或未完成狀態。
- 未設定、未登入、DOM 不相容、逾時或額度問題應有明確錯誤。
  Handoff 將 Talk 複製至剪貼簿並引導至 Bro Chat，讓使用者能手動繼續。
  不自動重送、不覆寫既有草稿，也不停止使用者原本的生成。
- 本機設定、Last Talk 與 Talk Log 使用 `chrome.storage.local`；
  Service Worker 是狀態唯一寫入者。Talk Log 僅記結果與時間，
  不含 Talk／Answer 內容；Last Talk 本身會保存最近一次內容。
  Talk 仍會送至 Gemini，不代表離線翻譯或資料完全不離開本機。
- 只接受合法的 `gemini.google.com` Bro Chat URL；不經自架 server，
  不要求 Gemini API key。Gemini DOM 改版與服務條款風險是既有取捨，
  不宣稱此整合獲官方支援。
- MVP 不含選取文字查詢、可搜尋歷史、Notion 單字庫、Popup 追問、
  多 Bro Chat 或 Trigger Prefix；這些仍屬 Later，不得順帶實作。
- 此開發 worktree 已有原始碼與測試；另有 Popup 縮放及 Answer 讀回問題的
  調查／修復草案。原始碼存在不等於問題已修復、已發布或已完成實機驗收。

## Brand Commitments

- 名稱是 **Talk To Bro Personally（隨身聊）**。
- **Pip（小弟）** 是替使用者去找老大的孱弱、膽小小角色；
  **Bro** 指 Gemini，**老大** 是其介面人設，不是另一個服務。
- 保留 PRD 已定案的可愛、Pixel Art／Roguelike 身分；這是既有約束，
  不是本文件另行制定的視覺系統。素材、色票、動畫細節另行決定。
- 人設只影響介面外框、角色、等待與錯誤表達，絕不改寫 Answer。
  像素字型僅用於標題與按鈕，Answer 本文使用易讀的一般字型。
- 主要介面文案沿用繁體中文；Answer 須保留中英文閱讀品質。
  使用既定用語 Talk、Answer、Bro Chat、Talk Log、Handoff，
  不將 Talk 改稱 Lookup、Query 或 Search。

## Evidence on Hand

路徑皆相對於本產品目錄：

- [產品總覽](README.md)。
- [PRD v1.1](docs/prd/2026-10-28-talk-to-bro-personally-prd.md)：
  使用者、MVP、非目標、術語、人設與成功指標的主要來源。
- [技術設計 v1.0](docs/tech-spec/2026-10-28-talk-to-bro-personally-tech-design-and-plan.md)：
  架構及驗證策略；實作現況須另查當前來源。
- `manifest.json`、`package.json`、`src/popup/popup.html`、
  `src/options/options.html` 與 `tests/`：已有開發中實作及測試。
- [既有問題調查草案](docs/plans/2026-10-29-talk-bugs-zoom-and-completion-return.md)：
  縮放與 Answer 讀回的待驗證假設，不是修復完成證據。
- 2026-10-29 使用者確認：產品定義維持 PRD v1.1；
  實際開發位置是 `.worktrees/talk-to-bro-personally-dev` 下的本產品目錄。
- 本次 init 未驗證真實 Talk 成功率、兩週試用結果或修復驗收；
  不得將需求目標或調查假設包裝為已證實成果。

## Product Principles

1. 保護閱讀節奏：正常路徑不搶焦點，不要求手動搬運內容。
2. 尊重原文：Talk 原樣送出，Answer 完整讀回，人設不介入答案。
3. 可靠優先：呈現真實狀態，避免重複送出，失敗仍能 Handoff。
4. 保持單人自用範圍：先驗證固定 Bro Chat 的核心流程，不擴張成通用聊天工具。

## Open Decisions

- 尚未建立新的素材、色票、動畫或完整設計系統；本次 init 不作視覺決策。
- 未另行指定無障礙合規等級或額外使用者需求；鍵盤查詢與中英文
  Answer 易讀性仍是已確認的基本產品要求。
- Live picker 未配置。現有 MV3 CSP 僅允許封裝腳本，不為工具注入放寬
  extension CSP；獨立預覽及其與 extension API 的相容性需另行評估。
