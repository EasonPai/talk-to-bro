# Spike Report: M0-B Spike — SW 守護行程、復原協定與 Markdown 擷取驗證 (Ticket 02 / #26)

- **日期**：2026-10-29
- **所屬產品**：[talk-to-bro-personally](file:///Volumes/Extended/Documents/Developments/projects/agentic-development/products/talk-to-bro-personally/README.md)
- **工單依據**：[GitHub Issue #26: M0-B Spike](https://github.com/EasonPai/agentic-development/issues/26)（Parent: #24 Epic, Blocked by: #25）
- **實作分支**：`feat/talk-to-bro-personally/dev`
- **執行角色**：Engineer (Reports to CTO / PM)
- **驗證環境**：Chrome for Testing 154.0.8037.92（符合專案產品規格 Chrome $\ge 132$），隔離 Profile (`~/.chrome-cdp-profile`)
- **可重現驗證指令**：`node products/talk-to-bro-personally/spikes/m0-b/test-runner.js`
- **驗證結果**：**ALL ACCEPTANCE CRITERIA PASSED (GO)**

---

## 1. 執行總結 (Executive Summary)

針對 CTO（Codex）審查指示（包含真實 SW 終止重開、真實分頁丟棄斷言、非破壞性剪貼簿還原、實機 Bro Chat 回應與 raw DOM 治具追溯），M0-B Spike 測試 Harness 與報告已全面強化並落實實機檢驗。所有 5 項驗收條件（S5～S9）全數實機驗證通過，且剪貼簿操作已加入「備份 $\rightarrow$ 寫入測試 $\rightarrow$ 實機 `pbpaste` 驗證 $\rightarrow$ 還原原剪貼簿」防護，達成 100% 零破壞性與真機可重現性。

```mermaid
flowchart TD
    subgraph M0_B_Results["M0-B Spike 實機驗收結果矩陣"]
        S5["S5: SW 守護與自癒 - 通過 (真實 SW 終止與重開自癒，Write-ahead 零重複送出 + 3分鐘逾期 timed_out_total + alarms 註冊)"]
        S6["S6: 分頁 Discard 復原 - 通過 (實機 chrome.tabs.discard 強制丟棄斷言成立，ensureBroTab 自動 reload 復原，釘選重用率 100%)"]
        S7["S7: Markdown 擷取保真度 - 通過 (5/5 組 Golden 測試 100% 吻合，PROVENANCE.md 追溯文檔完備，含真實 Turn)"]
        S8["S8: Offscreen 剪貼簿操作 - 通過 (Popup 關閉狀態 pbpaste 讀回 100% 一致，文件安全關閉，且原剪貼簿完整還原)"]
        S9["S9: DOM 治具庫建立 - 通過 (5 組治具全數通過自動化去識別化掃描、SHA-256 校驗與 DOM 語法檢驗)"]
        
        S5 --> S6 --> S7 --> S8 --> S9
    end

    S9 --> Pass["驗收結論：GO！核心架構防護、退路 (Handoff) 協定與生命週期自癒完全成立"]
```

---

## 2. 逐項實機驗收標準評估 (Acceptance Criteria Evaluation)

| 項目代號 | 驗收標準 (Acceptance Criteria) | 實機測試方法與協定 | 實測數值 / 狀態 | 判定結果 |
| :--- | :--- | :--- | :--- | :--- |
| **S5** | SW 守護、3 分鐘存活與強制終止自癒 | 寫入 `lastTalk`（`submitAttemptCount: 1`）後以 `chrome.runtime.reload()` 真正終止並重開 SW 行程；驗證重開後 `reconcile()` 自動接續且**絕不重發**；驗證 3 分鐘 deadline 過期處置與 `chrome.alarms` 守護 | `realSwTerminatedAndRestarted: true`，`writeAheadMaintained: true`，`submitAttemptCount: 1`（零重複送出），重啟順暢接續 `resumed_monitoring`；逾期正確轉換為 `timed_out_total`；守護 alarm `ttb-spike-watchdog` 註冊在案 | **PASS** |
| **S6** | 分頁 Discard / Freeze 恢復與釘選重用 | 透過實機 `chrome.tabs.discard` 強制丟棄分頁記憶體，強制斷言 `wasDiscardedBefore === true`；調用 `ensureBroTab` 觸發 reload 復原與重用 | `tabId: 328112598`，`wasDiscardedBefore: true`（斷言嚴格成立），`recoveredFromDiscard: true`，`discardedAfter: false`，`fixtureTabsCount: 1`（零多開重複分頁） | **PASS** |
| **S7** | Markdown 擷取保真度 (5 種結構 Golden 測試) | 5 組真實 Gemini 結構 HTML（包含實機對話真實 Angular Turn、表格、巢狀清單、粗體斜體、程式碼塊、引用上標與思考過程），比對 Golden 基準 | **5/5 通過**（100% 吻合），來源追溯文件 [`PROVENANCE.md`](file:///Volumes/Extended/Documents/Developments/projects/agentic-development/.worktrees/talk-to-bro-personally-dev/products/talk-to-bro-personally/spikes/m0-b/goldens/PROVENANCE.md) 詳載來源 Chat URL、Prompt 與 SHA-256 | **PASS** |
| **S8** | Offscreen Document 剪貼簿操作 (Popup 關閉) | 執行前備份原有剪貼簿；在無前景視窗狀態下調用 `chrome.offscreen` 寫入 Talk 文本，透過 macOS `pbpaste` 實機讀回剪貼簿驗證；測試完成後自動還原開發者原有剪貼簿 | `clipboardReadBackMatched: true`，`systemClipboardValue` 與動態 payload 完全吻合；`offscreenClosed: true` 依約釋放；`clipboardRestored: true`（非破壞性） | **PASS** |
| **S9** | 去識別化 raw DOM 治具庫建立 | 收集 5 大關鍵場景 DOM HTML（`done.html` 採真實 Gemini 對話節點），透過測試 harness 自動執行正則與語法結構掃描 | 5 組治具全數計算 SHA-256，無個人 email、帳號與 token（`deidentified: true`），且 DOM 關鍵容器節點完備（`domValid: true`） | **PASS** |

---

## 3. 核心技術發現與解決方案 (Technical Insights)

### 1. 真實 Service Worker 行程終止與 Write-Ahead 自癒
- **行程終止與重開**：透過擴充套件重載或 CDP 關閉 worker，驗證擴充套件在全新行程啟動時，頂層立即觸發 `reconcile()`。
- **Write-Ahead 防重複防護**：`reconcile()` 檢查到 `submitAttemptCount === 1` 時，**僅接管輪詢（`TTB_PROBE`），絕對不再次調用發送**。
- **3 分鐘上限**：若重啟時或警報觸發時 `now > phaseDeadlineAt`，狀態機立即將 phase 轉為 `failed` 並標記 `failure.code = 'TIMEOUT_TOTAL'`。

### 2. 實機分頁丟棄 (Tab Discard) 與無損復原
- **實機行為**：調用 `chrome.tabs.discard(tabId)` 會強制將分頁從記憶體中清除（`tab.discarded === true`）。
- **嚴格驗證**：Harness 在調用 `ensureBroTab` 之前與之後均嚴格讀取 `tab.discarded`，證實丟棄前 `true`、復原後 `false`，且全域分頁數維持 1 個，原 `tabId` 100% 重複利用。

### 3. 非破壞性剪貼簿防護
- 測試 Harness 在執行 S8 前先將開發者既有之系統剪貼簿讀出備份，寫入動態 Payload 驗證完畢後，立即還原原剪貼簿，符合全域安全防護規範。

---

## 4. 交付成果清單 (Deliverables)

```
products/talk-to-bro-personally/
├── spikes/
│   └── m0-b/
│       ├── manifest.json         # MV3 配置 (tabs, scripting, storage, alarms, offscreen, clipboardWrite)
│       ├── sw.js                 # 核心 SW (Write-ahead, reconcile, ensureBroTab, offscreen copy)
│       ├── adapter.js            # DOM 探針與選擇器
│       ├── markdown.js           # HTML 轉 Markdown 序列化引擎
│       ├── offscreen.html        # Offscreen Document 載體
│       ├── offscreen.js          # Offscreen 剪貼簿代理 (textarea + execCommand)
│       ├── runner.html           # 測試儀表板頁面
│       ├── runner.js             # 儀表板與 DOM 測試調度器
│       ├── fixtures/
│       │   ├── long-stream.html  # MessageChannel 巨集任務長串流治具
│       │   ├── long-stream.js
│       │   └── real-gemini-turn.html # 實機對話擷取之真實 Turn
│       ├── goldens/
│       │   ├── PROVENANCE.md     # 5 組 Golden 治具來源、提示詞、實機 URL 與 SHA-256
│       │   ├── case1-table.html / .md
│       │   ├── case2-nested-lists.html / .md
│       │   ├── case3-formatting.html / .md
│       │   ├── case4-codeblock.html / .md
│       │   └── case5-citations.html / .md
│       ├── spike-results.json    # 實機測試產出之完整 JSON 驗證數據
│       └── test-runner.js        # 強化版自動化驗收測試腳本 (含 pbpaste 還原, discard 斷言, de-id 掃描)
└── tests/
    └── fixtures/
        └── gemini/
            ├── idle.html         # 空白閒置真實 DOM 治具
            ├── streaming.html    # 正在生成真實 DOM 治具
            ├── done.html         # 生成完成真實 DOM 治具 (採用實機對話 DOM)
            ├── signed-out.html   # 未登入 Google 帳號真實 DOM 治具
            └── missing-chat.html # 對話不存在/已被刪除真實 DOM 治具
```

---

## 5. 後續建議與 Milestone 推進 (Next Steps)

Spike M0-B 之所有技術疑慮與審查缺口已 100% 補齊，可重現指令 `node products/talk-to-bro-personally/spikes/m0-b/test-runner.js` 實測全綠。
技術風險全數解除，請 CTO 審查結案 Ticket 02 (#26)，並放行 Milestone 1 (Ticket 03 / #27: M1 — Extension Skeleton, Manifest V3 & Options Validation)。
