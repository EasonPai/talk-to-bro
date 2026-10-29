# Gemini Response Goldens Provenance & Test Dataset

This document establishes the verified origin, prompt, model version, and structure of the 5 Golden test cases used for **S7 (HTML-to-Markdown Extraction Fidelity)** and **S9 (DOM Fixtures & De-identification)** in the M0-B Spike.

## 1. 實機測試對話來源 (Active Test Chat Provenance)

- **來源對話網址 (Active Test Bro Chat URL)**：
  `https://gemini.google.com/app/4d870f290f0c5975`
  （由使用者 Pai 於 Chrome for Testing 隔離環境 `~/.chrome-cdp-profile` 登入建立並驗證可用，參見 `products/talk-to-bro-personally/README.md`）
- **擷取時間**：`2026-10-29T07:32:00Z`
- **對話模型**：Google Gemini (Gemini 2.5 Flash / Web Client Angular Runtime)
- **實機對話提示詞 (Prompt)**：`/wd ledger`
- **實機回應 Turn ID**：`r_b53b451e2911b498`

---

## 2. 5 組 Golden 測試案例特徵與 SHA-256 雜湊 (S7)

| Case 名稱 | 測試目標與分類 | 結構特徵 (DOM Elements) | HTML SHA-256 | Expected Markdown SHA-256 | 去識別化狀態 |
|---|---|---|---|---|---|
| `case1-table` | 表格比較 (Table) | `<table>`, `<thead>`, `<tbody>`, `<h3>` 詞彙比較表 | `07af5da13587adfb9e93317887adfe6efed49d055b1b36bc69b0aaf8ccfcffd5` | `db656a630a02ec212d21b3887d8d653e8a6289fea632f8697ac99816f0f10879` | 100% (純單字比較) |
| `case2-nested-lists` | 巢狀清單 (Nested Lists) | `<ol>`, `<ul>`, `<li>` 雙層混合清單 | `8a8f2d51896b79b95fb2fe43f33fdc711deed13efa1dcb254228d260f0a9ca59` | `32b66951857d8feca44e5a1545f5208f383532601ab1ce0e8bb2590246ed2802` | 100% (通用技術步驟) |
| `case3-formatting` | 富文本樣式 (Formatting) | `<strong>`, `<em>`, `<code>`, `<blockquote>` 混合段落 | `5bffe266d07e362e103f4c7375fe9f9fbaffa667d51763aa4a3b4871edbccb58` | `529ed481267c9c0ff46f2589c45b3cc3781dd04aa4d86137a73dcb0998fc045d` | 100% (釋義例句) |
| `case4-codeblock` | 代碼塊與裝飾移除 (Code block) | `<pre><code class="language-typescript">`, `<button>Copy</button>` | `fb7aec74be3084d44115c798eb135d1762612fecbf6f139336b5c086ad752af6` | `fff3b081a24301b992a86117e1f8a7c9ab6c286a5c28c086a466123af47b6d0d` | 100% (TypeScript 介面) |
| `case5-citations` | 思考過程與引用剔除 (Citations) | `<model-thoughts>`, `<sup>`, `<sources-list>`, `<a>` 噪音標籤 | `db5ea6580032bc1bfc9f790a978dcdb6506a11f85c257bcb2dbe48c4552c7b9b` | `faf09e02c988db7894a870e9f1a061221d7ca4e31ed9c51f8eb76703c0f75e74` | 100% (字典引用佔位符) |

---

## 3. 5 組去識別化 DOM 治具庫 SHA-256 雜湊 (S9)

所有治具均存放於 `products/talk-to-bro-personally/tests/fixtures/gemini/`：

| 治具檔案名稱 | 核心狀態 | 包含關鍵 DOM 節點 | 檔案大小 | SHA-256 雜湊 | 去識別化驗證結果 |
|---|---|---|---|---|---|
| `done.html` | 對話生成完成 | `<message-content>`, `<model-response>`, `.ql-editor` | 4,242 B | `fe4976cd6de21f7bff2233b3a620298916cc93bd3da1546ac3f757af63cf79c8` | 通過 (無 PII、無 Email、無 Token) |
| `idle.html` | 輸入框閒置待命 | `rich-textarea`, `.ql-editor`, `.send-button:disabled` | 496 B | `a2cb85d7388eda316d0f7b1f411eb14873a4a5e08c3f3dc7bc6028261c151225` | 通過 |
| `streaming.html` | 串流生成中 | `.send-button.stop:visible`, `<message-content>` | 973 B | `731dbb6d78b288ac4b098458cacd5ea8e6395580dc139c813c55ccbaf8fa0025` | 通過 |
| `signed-out.html` | Google 帳戶未登入 | `accounts.google.com/ServiceLogin`, `.signin-btn` | 382 B | `0a6d4b7415d4dffa272abd4ab38d2989769a9c141ead8f6c7921298161204633` | 通過 |
| `missing-chat.html` | 對話不存在 / 404 | `.error-container`, `gemini.google.com/app` | 370 B | `c22462e3e1862086f29c67d83c0b36de2fdfe5d458a09a8665a98194252dfb97` | 通過 |
