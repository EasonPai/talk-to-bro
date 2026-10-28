# Gemini Response Goldens Provenance & Test Dataset

This document establishes the verified origin, prompt, model version, and structure of the 5 Golden test cases used for **S7 (HTML-to-Markdown Extraction Fidelity)** in the M0-B Spike.

## Summary Table

| Case | Category | Gemini Prompt | Model | Structure Features | De-identification Status |
|---|---|---|---|---|---|
| `case1-table` | 表格比較 | 比較 meticulous 與 punctilious 的語氣與搭配 (用表格呈現) | Gemini 2.5 Flash | `<table>`, `<thead>`, `<tbody>`, `<h3>` | 100% De-identified (Pure vocabulary analysis) |
| `case2-nested-lists` | 巢狀清單 | 請條列 Talk To Bro 的操作步驟與檢查清單 | Gemini 2.5 Flash | `<ol>`, `<ul>`, `<li>` 雙層混合巢狀 | 100% De-identified (Generic technical steps) |
| `case3-formatting` | 富文本樣式 | 詳細說明 meticulous 的詞性與語氣 | Gemini 2.5 Flash | `<strong>`, `<em>`, `<code>`, `<blockquote>` | 100% De-identified |
| `case4-codeblock` | 程式碼區塊 | 提供 TypeScript 定義 BroTalk 介面的範例程式碼 | Gemini 2.5 Flash | `<pre><code class="language-typescript">`, `<button>Copy</button>` | 100% De-identified |
| `case5-citations` | 引用與思考過程 | 說明 meticulous 的拉丁語源並標註出處 | Gemini 2.5 Flash | `<model-thoughts>`, `<sup>`, `<sources-list>`, `<a>` | 100% De-identified (Oxford citation placeholder) |

## Provenance Details

### 1. `case1-table`
- **Source**: Extracted from Gemini response turn evaluating synonym differences.
- **HTML Container**: Wrapped in `<div class="model-response-text">` matching Gemini web client response renderer.
- **Conversion Assertion**: Multi-column Markdown table with alignment hyphens (`|---|---|---|`).

### 2. `case2-nested-lists`
- **Source**: Step-by-step user instruction response.
- **HTML Container**: Wrapped in `<div class="model-content">`.
- **Conversion Assertion**: Standard indentation (2 spaces) per nested level preserving numbered and bulleted types.

### 3. `case3-formatting`
- **Source**: Explanatory vocabulary note with quotes and warnings.
- **HTML Container**: Contains blockquote (`<blockquote>`) and mixed inline formatting (`<strong>`, `<em>`, `<code>`).
- **Conversion Assertion**: Preserves Markdown syntax (`**bold**`, `*italic*`, `` `code` ``, `> quote`).

### 4. `case4-codeblock`
- **Source**: Code synthesis turn.
- **HTML Container**: Contains Gemini code block envelope with copy button (`<div class="code-block-decoration"><button>Copy code</button></div>`).
- **Conversion Assertion**: Strips UI copy decoration, formats as fenced block with language identifier (```` ```typescript ... ````).

### 5. `case5-citations`
- **Source**: Academic/etymological response with internal reasoning and search references.
- **HTML Container**: Contains `<model-thoughts>` section and footer `<sources-list>` with search links.
- **Conversion Assertion**: Completely excludes thought block (`<model-thoughts>`) and sources list (`<sources-list>`), retaining only clean text and superscript reference markers.
