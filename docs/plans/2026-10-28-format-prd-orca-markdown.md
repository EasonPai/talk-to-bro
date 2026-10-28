# Plan: Talk To Bro Personally PRD Markdown 相容性修復與排版優化

- **日期**：2026-10-28
- **所屬產品**：[talk-to-bro-personally](file:///Volumes/Extended/Documents/Developments/projects/agentic-development/products/talk-to-bro-personally/README.md)
- **目標檔案**：[`products/talk-to-bro-personally/docs/prd/2026-10-28-talk-to-bro-personally-prd.md`](file:///Volumes/Extended/Documents/Developments/projects/agentic-development/products/talk-to-bro-personally/docs/prd/2026-10-28-talk-to-bro-personally-prd.md)
- **狀態**：Approved by User (執行中)

---

## 1. 目標 (Objective)
修復使用 Notion Sync 下載的 PRD 檔案中的非標準 XML 標籤（`<callout>`、`<mention-page>`）、Notion 專有語法（`{toggle="true"}`）以及 Tab 縮排（`\t`），確保該檔案在 Orca Markdown 預覽器中 100% 正常渲染、無語法樹（AST）崩潰、標題正常進入目錄、清單層級分明。

---

## 2. 修復規格與對照表

| 原有 Notion 語法 | 修正後標準 Markdown | 效益 |
| :--- | :--- | :--- |
| `<callout icon="💡" ...>\n\t內容\n</callout>` | `> 💡 內容`（標準 Blockquote） | 解決未閉合 XML 節點衝突，維持圖示與引言視覺 |
| `<mention-page url="..."/>` | `[📄 Notion Page](url)` | 消除自閉合 HTML 標籤導致的 DOM 節點吞噬 |
| `### 標題 {toggle="true"}` | `### 標題` | 移除 Notion 私有標籤，確保 Orca 目錄正確識別標題 |
| 首行或巢狀清單帶 `\t` (Tab) | 改為標準兩空格 `  ` 縮排 | 避免 CommonMark 將文字誤判為 `<pre><code>` 程式碼塊 |
| 詞彙表中的 `<br>*Avoid*：...` | 結尾兩空格換行 + 緊湊排版 | 避免 HTML `<br>` 破壞文字預覽 |

---

## 3. 執行步驟
1. 完整保留開頭 YAML frontmatter（第 1-46 行不變動）。
2. 將 4 處 `<callout>` 區塊轉為乾淨的 Markdown Blockquotes（保留 💡, 🎙️, 📝, 📄 Emoji）。
3. 將第 93 行的 `<mention-page url="..."/>` 轉為標準 Markdown 連結。
4. 去除 `### 2026-10-27 · Android 分享 {toggle="true"}` 的 `{toggle="true"}` 標記。
5. 將所有 Tab（`\t`）縮排調整為標準 Markdown 兩空格縮排。
6. 驗證整份檔案在 CommonMark 下無破裂的 HTML 標籤。
