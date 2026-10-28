---
AI summary: []
Archived: false
Area/Resource: []
Complete Date: null
Created: "2026-10-27T04:31:00.000Z"
Favorite: false
Fleeting: false
Image: []
Parent item: []
Project: []
Project Archived: []
Project Area: []
Pulls: []
References: []
Related Back: []
Resource Pulls: []
Review Date: null
Root Area: []
Sub-item: []
Title: "[Inspiration] Talk To Bro Personally"
Type: Inspiration
URL: null
URL Base: []
Uni-Ref: []
Updated: "2026-10-28T12:51:00.000Z"
Updated (short): 10/28/2026
🌅 Daily  Divider: 🌅🌅🌅 DAILY PROPERTIES 🌅🌅🌅
🍳 Recipe Divider: 🥗🥗🥗 RECIPE BOOK PROPERTIES 🥗🥗🥗
🍳 Recipe Tags: []
👥 Office Divider: 👥👥👥 OFFICE PROPERTIES 👥👥👥
👥 Office Tags: []
📚 Author: []
📚 Book  Divider: 📚📚📚 BOOK TRACKER PROPERTIES 📚📚📚
📚 Book Status: null
📚 Date Finished: null
📚 Date Started: null
📚 Rating: null
🛍️ Shopping Divider: 🛍️🛍️🛍️ SHOPPING PROPERTIES 🛍️🛍️🛍️
🛍️ Shopping Price: null
---

<!-- nsync:callout icon="💡" color="gray_bg" -->
> 💡 ***Summary***<!-- nsync:br -->
> <!-- nsync:br -->
> **Talk To Bro Personally**：Chrome Extension，快捷鍵叫出 popup、輸入單字，自動送進已啟用翻譯 skill 的那個 Gemini chat，由 Bro（Gemini）回答，直接在 popup 顯示，不必手動開 Gemini 分頁貼上。
<!-- /nsync:callout -->
## Raw Inspiration
<!-- nsync:callout icon="🎙️" color="gray_bg" -->
> 🎙️ 原話照貼，不改寫。新 Capture 加在最下面，格式：`YYYY-MM-DD · 來源` 後接原文。
<!-- /nsync:callout -->
### 2026-10-27 · Android 分享<!-- nsync:toggle -->
	我想有一個Chrome Extension是可以讓我很快的把想查的單字打上去， 然後他會送到Gemini的服務裡面去，使用我在 gemini 定義的 skill。 拿到答案之後，在Extension popup顯示出來 ，這樣我就不用全部手動打開 gemini tab貼上去。
## Change Log
<!-- nsync:callout icon="📝" color="gray_bg" -->
> 📝 格式：`YYYY-MM-DD · 來源（Telegram／Notion AI／手動） · 變更摘要`；換 Stage 也要記一筆。最新的放最上面。
<!-- /nsync:callout -->
- 2026-10-28 · Notion AI · 新增 Look & Feel：小弟 Pip 替使用者去找老大 Bro；可愛、Pixel Art、Roguelike 風格；人設只在介面，不改 Answer。Glossary 新增 Pip、老大。版本 v1.1。
- 2026-10-28 · Notion AI · grill-with-docs 第 3 輪定案：用語 Lookup 改為 Talk；逾時改為「30 秒無新文字」＋總上限 3 分鐘；輸入上限放寬為 300 字元；新增本機 Talk Log 與成功率。Open questions 清空、MVP 皆有驗收標準 → Stage 由 Exploring 改為 BRD Ready。
- 2026-10-28 · Notion AI · grill-with-docs 第 2 輪定案：接受 Bro Chat 歷史累積（固定一個 chat URL）；Later 加入 Trigger Prefix；Bro Chat 分頁常駐重用、不搶焦點；popup 完整顯示最新一則回覆；失敗時複製輸入並切到 Bro Chat；成功指標從秒數改為「送得進、讀得回」。
- 2026-10-28 · Notion AI · grill-with-docs 第 1 輪定案：Bro＝Gemini；Backend 選 B（操作 Bro Chat 分頁，ADR-0001）；Gem 改稱 skill；每次查詢獨立、可用逗號輸入多個單字、上限 100 字元；與 Notion 單字庫分開；追問留 Later。新增 Glossary 與 ADR 區塊。
- 2026-10-28 · Notion AI · PRD 初稿：正式名稱定為 Talk To Bro Personally；BRD 區塊升級為 PRD（含 MVP 驗收標準 Acceptance criteria）並補 Tech Plan；Stage 由 Raw 改為 Exploring（Open questions 未清空，待 grill-with-docs 審閱）。
- 2026-10-27 · Android 分享 · 建立（inspiration-capture）。Inbox 建議：目前共有 9 則 Raw Inspiration；未發現明顯重複。建議新頁 Stage：Raw；其他 Inbox Raw 標題均已命名，無需改名。若要進一步合併、封存或換 Stage，交由 inspiration-triage 確認。
## PRD — Talk To Bro Personally
<!-- nsync:callout icon="📄" color="blue_bg" -->
> 📄 版本 v1.1（2026-10-28）· Owner：Pai · Stage：BRD Ready · 狀態：grill-with-docs 審閱完成（3 輪）
<!-- /nsync:callout -->
### Problem
查一個英文單字要：開新分頁 → 進 Gemini → 找到已啟用翻譯 skill 的那個 chat → 貼上單字 → 等回覆 → 切回原本頁面。步驟多、會打斷閱讀與工作節奏，所以常常懶得查。
### Target user
- Pai 本人（單一使用者、自用工具）。
- 使用桌機 Chrome，已登入 Google 帳號；Gemini（本文稱 **Bro**）裡已有一個啟用翻譯 skill 的 chat（**Bro Chat**，例：`https://gemini.google.com/app/b0326068972d84b2`）。
### Core scenarios
1. **閱讀中查字**：在網頁讀到生字 → 按快捷鍵叫出 popup → 輸入單字 → Enter → 在 popup 內讀到 Bro 的解釋，不離開目前頁面。
2. **一次查多個字／片語**：同上，輸入 phrase 或用逗號分隔的多個單字（例如 "take for granted, meticulous, wary"），Bro 會分開解釋。
3. **失敗時的退路（Handoff）**：自動送出或讀回失敗 → popup 顯示原因，把輸入複製到剪貼簿，並把 Bro Chat 分頁切到前面，貼上就能繼續。
### Features
- **MVP**：
	- **F1 快捷鍵叫出 popup**（Chrome commands，預設 `Alt+Shift+B`，可在 `chrome://extensions/shortcuts` 修改）。驗收：按下後 popup 開啟、輸入框自動 focus，可直接打字。
	- **F2 送出查詢（Talk To Bro）**：Enter 送出，空白輸入不送出；可用逗號分隔多個單字；上限 300 字元，超過時不送出並提示字數；送出後顯示 loading。驗收：輸入原樣送進 Bro Chat，由該 chat 已啟用的 skill 處理，extension 不另外觸發或設定 skill。
	- **F3 顯示回覆（Answer）**：在 popup 內以 Markdown render（標題、清單、粗體、表格）。只取 Bro Chat 裡最新一則回覆，原文照翻譯 skill 的格式完整顯示，不刪減、不改寫。驗收：等 Bro 回覆完成才顯示，內容與 Bro Chat 頁面上相同；過長可捲動；可一鍵複製。
	- **F4 錯誤處理**：未設定 Bro Chat、Google 未登入、Bro Chat 頁面找不到輸入框（Gemini 改版）、逾時（Bro 連續 30 秒沒有新文字，或總等待超過 3 分鐘；Bro 仍在輸出就繼續等）、額度用完，各有明確訊息，並執行 Handoff（複製輸入＋切到 Bro Chat）。驗收：任何失敗都不會只出現空白 popup。
	- **F5 保留最後一次查詢（Last Talk）**：popup 關掉再打開，仍看得到上一筆單字與回覆（或仍在等待中的狀態）。驗收：查詢途中關掉 popup，回覆不會遺失。
	- **F7 Bro Chat 分頁常駐**：已開著就重用；沒開就在背景開一個不搶焦點的 pinned 分頁。驗收：查詢過程中目前分頁不會被切換（Handoff 除外）；不會重複開出多個 Bro Chat 分頁。
	- **F8 Talk Log（試用期驗證）**：本機記錄每次 Talk 的結果（成功／送出失敗／讀回失敗）與時間，不存 Talk 內容與 Answer。驗收：設定頁顯示「送得進」與「讀得回」成功率。
	- **F6 設定頁（Options）**：設定 Bro Chat URL（MVP 只有一個），並顯示 Talk Log 成功率。驗收：設定存在本機，重開 Chrome 仍有效；URL 不是 `gemini.google.com` 時拒絕儲存。
- **Later**：
	- 選取網頁文字 → 右鍵選單／快捷鍵直接 Talk To Bro。
	- 查詢歷史（History）與搜尋。
	- 一鍵存進 Notion 單字庫（可與 [📄 Notion Page](https://app.notion.com/p/60fd6c4b93864459b00fc53fccff862d)<!-- nsync:mention-page --> 串接）。
	- 在 popup 內追問（Follow-up，多輪對話）。
	- 多個 Bro Chat 切換（例：查字 chat、改寫 chat）。
	- **Trigger Prefix（下一階段）**：設定一個 prefix，在任何 Gemini 對話中都能觸發翻譯 skill；到時可每次開新 chat，不再依賴固定 Bro Chat 的累積歷史。
### Look & Feel
- **角色**：popup 主角是很孱弱、有點膽小的小弟 **Pip**，替使用者去找老大；Bro 在畫面上是黑社會老大的形象。
- **風格**：可愛、Pixel Art、Roguelike（地下城、像素道具、狀態條的小冒險感）。
- **狀態即情緒**：
	- 等待輸入：Pip 在老大門口等你交代。
	- Loading：Pip 恭敬地等老大開口。
	- Answer：老大交代下來的話。
	- Handoff：Pip 嚇到，請你自己去找老大。
	- 逾時：老大不理人。
- **規則**：
	- 人設只在介面（外框、頭像、loading、錯誤訊息），不改寫 Answer（配合 F3）。
	- 像素字型只用在標題與按鈕；Answer 本文用一般字型，確保中英文好讀。
- 素材、色票、動畫細節另寫 Design Spec。
### Non-goals
- 不做通用的 Gemini 聊天客戶端。
- 不上架 Chrome Web Store；以 unpacked extension 自用。
- 不支援手機、其他瀏覽器。
- 不自建字典資料或發音資料；內容完全來自 Bro。
### Success metrics
- 查一個字的操作：從約 6 步降到 2 步（快捷鍵 → 輸入＋Enter）。
- **送得進**：每次 Talk 都確實送進 Bro Chat（以 Talk Log 驗證）。
- **讀得回**：每次都能把 Bro 的完整 Answer 讀回 popup（以 Talk Log 驗證）。
- 不設秒數指標：單字越多 Bro 處理越久，回應時間不是成敗標準。
- 試用 2 週：每週 ≥ 20 次查詢，且不再手動開 Gemini 分頁查字。
### Constraints
- **Gemini skill（舊稱 Gem）與 chat 沒有官方 API**：只能在 Gemini web／mobile app 使用。因此採 ADR-0001：由 extension 操作 Bro Chat 分頁。代價：Gemini 網頁改版就可能失效、有違反服務條款的風險；失效時執行 Handoff。
- Chrome Manifest V3：popup 一關閉，其中的 JS 就停止 → 送出請求與暫存結果必須放在 background service worker 與 `chrome.storage`。
- 個人設定（Bro Chat URL）只存在本機 `chrome.storage.local`，不經過任何自架 server。
### Open questions
- 目前沒有未決問題。
- 已定案（第 3 輪）：Lookup 改稱 Talk；逾時＝30 秒無新文字或總等待 3 分鐘；輸入上限 300 字元；本機 Talk Log 記錄成功率；Stage 改 BRD Ready。
- 已定案（第 2 輪）：接受 Bro Chat 歷史累積；分頁常駐重用；完整顯示最新一則回覆；失敗時 Handoff；成功指標＝送得進、讀得回。
- 已定案（第 1 輪）：Backend＝B（ADR-0001）；Bro＝Gemini；每次查詢獨立、可逗號輸入多字；上限 100 字元（第 3 輪改為 300）；與 Notion 單字庫分開；追問留 Later。
## Tech Plan
- **架構／工具組合**：Chrome Extension（Manifest V3, TypeScript）。`popup`（輸入＋顯示）、`background service worker`（呼叫 Bro、逾時與錯誤處理）、`options page`（設定）。`content script`（注入 Bro Chat 頁面：填入輸入、送出、等待並讀取最新回覆）。Markdown render 用輕量套件（如 marked ＋ DOMPurify）。
- **資料模型**（`chrome.storage.local`）：
	- `BroSettings`：chatUrl（Bro Chat）、idleTimeoutMs（預設 30000，無新文字的等待上限）、maxWaitMs（預設 180000）。
	- `LastTalk`：talk、answer、status（pending／done／error）、errorMessage、createdAt。
	- `TalkLog[]`：result（success／send_failed／read_failed）、createdAt；不含 Talk 內容。
- **整合（API、Bot、Shortcut）**：`chrome.tabs` 找到或開啟 Bro Chat 分頁 → `chrome.scripting`／content script 送出輸入 → `MutationObserver` 等回覆串流結束 → 回傳 service worker 存入 LastTalk。DOM selector 集中在一個檔案，Gemini 改版時只改一處。Chrome commands 提供快捷鍵。
- **開發步驟**：
	1. Scaffold MV3 extension（manifest、popup、service worker、options），以 unpacked 載入。
	2. 完成 popup UI 與快捷鍵（F1）。
	3. 實作 Bro adapter（content script 操作 Bro Chat），service worker 負責送出與逾時（F2、F4）。
	4. Markdown render、複製按鈕（F3）。
	5. LastTalk 暫存與恢復（F5）、Options 頁（F6）、Talk Log（F8）。
	6. 自用試用 2 週，依 Success metrics 檢查，決定是否進 Later。
## Glossary
**Bro**：Gemini 本身（Google 的 AI 服務）。用 Bro 取代「AI」這個字。<br>*Avoid*：AI、Gem、助理
**老大**：Bro 在畫面上的形象（黑社會老大）；只是視覺人設，不是另一個角色或服務。<br>*Avoid*：Boss
**Pip（小弟）**：popup 裡代表使用者去找老大的孱弱小角色，即 extension 的吉祥物。<br>*Avoid*：Kid、Runt、Lil Bro
**Skill**：Gemini 裡預先定義好的能力（舊稱 Gem），例如翻譯 skill。由 Bro Chat 帶著，extension 不觸發也不設定它。<br>*Avoid*：Gem
**Bro Chat**：Gemini 裡已啟用翻譯 skill 的那個 chat，以它的 URL 識別。<br>*Avoid*：Gemini tab、對話
**Talk**：使用者一次送給 Bro 的內容；可以是一個單字、片語，或用逗號分隔的多個單字（上限 300 字元）。<br>*Avoid*：Lookup、Query、Search
**Talk Log**：本機記錄每次 Talk 成敗的紀錄，只有結果與時間，不含內容。
**Answer**：Bro 對一次 Talk 的回覆，即 Bro Chat 裡最新的一則回覆。
**Handoff**：自動送出或讀回失敗時，把 Talk 複製到剪貼簿、把 Bro Chat 分頁切到前面，交回給使用者手動完成。<br>*Avoid*：Fallback、在 Gemini 開啟
**Trigger Prefix**：下一階段的功能；放在輸入開頭的固定字串，讓任何 Gemini 對話都觸發翻譯 skill。
## ADR
### ADR-0001 透過 Bro Chat 分頁使用 Bro，而不是 Gemini API
翻譯 skill 已在特定 Bro Chat 裡啟用，而 skill／chat 沒有官方 API。用 Gemini API 就得在 extension 另外維護一份 skill 指令，也要申請 API key。所以決定由 extension 操作 Bro Chat 分頁，直接沿用既有 skill 與訂閱額度；接受 Gemini 網頁改版會失效、可能違反服務條款的風險（2026-10-28，Accepted）。
### Result
TBD