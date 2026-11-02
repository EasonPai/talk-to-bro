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
