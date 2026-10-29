# Gemini Response Goldens Provenance & Test Dataset

This document establishes the verified origin, prompt, model version, and structure of the Golden test cases used for **S7 (HTML-to-Markdown Extraction Fidelity)** and **S9 (DOM Fixtures & De-identification)** in the M0-B Spike.

## 1. 實機測試對話來源 (Active Test Chat Provenance)

- **來源對話網址 (Active Test Bro Chat URL)**：
  `https://gemini.google.com/app/4d870f290f0c5975`
  （由使用者 Pai 於 Chrome for Testing 隔離環境 `~/.chrome-cdp-profile` 登入建立並驗證可用，參見 `products/talk-to-bro-personally/README.md`）
- **擷取時間**：`2026-10-29T07:32:00Z`
- **對話模型**：Google Gemini (Gemini 2.5 Flash / Web Client Angular Runtime)
- **實機對話提示詞 (Prompt)**：`/wd ledger`
- **實機回應 Turn ID**：`r_b53b451e2911b498`
- **實機回應原始檔案**：
  - HTML: `case1-real-ledger.html` (SHA-256: `dd45bb43cab6eb18df7a5f3e80b5a781a1309a677e5bfe11154757a37bf0040c`)
  - Converted Markdown: `case1-real-ledger.md` (SHA-256: `369438842fea71a9a8cbbbed22d133735fedfd1eaf742e60afb7b0c5dcace7d8`)
- **真實對話與單元治具分類原則**：
  - **Live Production Turn (真實實機生成對話)**：`case1-real-ledger.html` 為直接自上述實機 Gemini 對話 URL 即時擷取之真實 Angular DOM 回應（Turn ID `r_b53b451e2911b498`），驗證真實世界完整 Gemini 輸出的 Markdown 轉譯保真度。
  - **Synthetic Unit Cases (合成語法極限案例)**：`case1-table`, `case2-nested-lists`, `case3-formatting`, `case4-codeblock`, `case5-citations` 為涵蓋 Markdown 各類邊界規格（如表格、雙層巢狀清單、斜體加粗、代碼塊裝飾標籤與思維模型節點剔除）之精準單元測試治具，外層均包覆真實 Gemini DOM 容器。

---

## 2. Golden 測試案例特徵與 SHA-256 雜湊 (S7)

| Case 名稱 | 分類 | 測試目標與 DOM 結構 | HTML SHA-256 | Expected Markdown SHA-256 | 去識別化審查 |
|---|---|---|---|---|---|
| `case1-real-ledger` | **Live Production Turn** | 真實 Gemini 對話回應（`r_b53b451e2911b498`），包含 `<h3>`、清單、粗體與會計/區塊鏈釋義 | `dd45bb43cab6eb18df7a5f3e80b5a781a1309a677e5bfe11154757a37bf0040c` | `369438842fea71a9a8cbbbed22d133735fedfd1eaf742e60afb7b0c5dcace7d8` | 通過 (無 PII / 無 Email) |
| `case1-table` | Synthetic Unit | 表格比較 (Table)：`<table>`, `<thead>`, `<tbody>`, `<h3>` 詞彙比較表 | `07af5da13587adfb9e93317887adfe6efed49d055b1b36bc69b0aaf8ccfcffd5` | `db656a630a02ec212d21b3887d8d653e8a6289fea632f8697ac99816f0f10879` | 通過 (單字釋義比較) |
| `case2-nested-lists` | Synthetic Unit | 巢狀清單 (Nested Lists)：`<ol>`, `<ul>`, `<li>` 雙層混合清單 | `8a8f2d51896b79b95fb2fe43f33fdc711deed13efa1dcb254228d260f0a9ca59` | `32b66951857d8feca44e5a1545f5208f383532601ab1ce0e8bb2590246ed2802` | 通過 (技術步驟) |
| `case3-formatting` | Synthetic Unit | 富文本樣式 (Formatting)：`<strong>`, `<em>`, `<code>`, `<blockquote>` 混合段落 | `5bffe266d07e362e103f4c7375fe9f9fbaffa667d51763aa4a3b4871edbccb58` | `529ed481267c9c0ff46f2589c45b3cc3781dd04aa4d86137a73dcb0998fc045d` | 通過 (例句段落) |
| `case4-codeblock` | Synthetic Unit | 代碼塊與裝飾移除：`<pre><code class="language-typescript">`, `<button>Copy</button>` | `fb7aec74be3084d44115c798eb135d1762612fecbf6f139336b5c086ad752af6` | `fff3b081a24301b992a86117e1f8a7c9ab6c286a5c28c086a466123af47b6d0d` | 通過 (TypeScript 介面) |
| `case5-citations` | Synthetic Unit | 思考過程與引用剔除：`<model-thoughts>`, `<sup>`, `<sources-list>`, `<a>` 噪音標籤 | `db5ea6580032bc1bfc9f790a978dcdb6506a11f85c257bcb2dbe48c4552c7b9b` | `faf09e02c988db7894a870e9f1a061221d7ca4e31ed9c51f8eb76703c0f75e74` | 通過 (引用佔位符) |

---

## 3. 5 組去識別化 DOM 治具庫 SHA-256 雜湊 (S9)

所有治具均存放於 `products/talk-to-bro-personally/tests/fixtures/gemini/`：

| 治具檔案名稱 | 核心狀態 | 包含關鍵 DOM 節點 | 檔案大小 | SHA-256 雜湊 | 去識別化驗證結果 |
|---|---|---|---|---|---|
| `done.html` | 對話生成完成 | `<message-content>`, `<model-response>`, `.ql-editor` | 4,319 B | `fe4976cd6de21f7bff2233b3a620298916cc93bd3da1546ac3f757af63cf79c8` | 通過 (無 PII、無 Email、無 Token) |
| `idle.html` | 輸入框閒置待命 | `rich-textarea`, `.ql-editor`, `.send-button:disabled` | 641 B | `a2cb85d7388eda316d0f7b1f411eb14873a4a5e08c3f3dc7bc6028261c151225` | 通過 |
| `streaming.html` | 串流生成中 | `.send-button.stop:visible`, `<message-content>` | 1,145 B | `731dbb6d78b288ac4b098458cacd5ea8e6395580dc139c813c55ccbaf8fa0025` | 通過 |
| `signed-out.html` | Google 帳戶未登入 | `accounts.google.com/ServiceLogin`, `.signin-btn` | 370 B | `0a6d4b7415d4dffa272abd4ab38d2989769a9c141ead8f6c7921298161204633` | 通過 |
| `missing-chat.html` | 對話不存在 / 404 | `.error-container`, `gemini.google.com/app` | 375 B | `c22462e3e1862086f29c67d83c0b36de2fdfe5d458a09a8665a98194252dfb97` | 通過 |
