# T-3：清空 Bro Chat 輸入框後送出本次問題

狀態：待董事會審查。需求已確認，尚未實作。

## 診斷與證據

工單見 [T-3](../tickets/T-3.md)。董事會回報 `claude`、`haiku`、`Anthropology` 失敗，一般詞偶爾失敗。

於既有隔離 CfT、CDP 9222 重現：

1. Gemini 輸入框有不同的兩字元文字；沒有 Stop 按鈕，送出按鈕可用。
2. 透過真正 extension `talk/submit` 送出 `claude`，Talk 進入 `failed`，`EDITOR_BUSY`、send stage、`maybeSent=false`；原稿仍保留。
3. 真正 adapter `TTB_CHECK_READY` 對四個詞都回覆 `User draft present in editor`。
4. 空編輯器下依序送出 `claude`、`haiku`、`Anthropology`、`apple`，四個 Talk 都完成 `done`。

已確認目前可重現原因是不同草稿遭拒，不是特定詞封鎖。不能據此聲稱所有歷史偶發失敗都相同。空框對照開始時，先前兩字元草稿已不在；不宣稱是本次清空操作移除了它。對照結束後還原測試開始時的空框狀態。

實測環境為 Chrome 156.0.8078.47，與 [CfT 文件](../testing/chrome-for-testing-setup.md) 鎖定的 .80 有差異，未自行升級瀏覽器。這是明確的環境限制，不是詞彙特殊處理證據。

## 董事會決定與授權

董事會明確指示：

> 如果 Gemini 的輸入框有文字就清除它，然後使用我們的文字來送出。

經 grilling 確認的確切流程：

**發現文字 → 明確清空 → 插入本次文字 → 精確驗證 → 送出一次。**

這不是僅略過 busy 判斷，也不是「選取舊文字後直接覆寫」就算完成。

- 僅限已設定 Bro Chat 的未送出輸入；不刪歷史對話、已送出 Talk 或 Popup／側邊欄草稿。
- 直接自動執行，不每次跳確認，不新增備份／復原／設定功能。
- 原有不同 Bro Chat 草稿會被丟棄。這是刻意改變舊規則，具備本次董事會明確刪除授權。
- Gemini 正在生成時不按 Stop；插入失敗不送，無法確認已送出的內容不重送。
- 本次對照實驗的暫存與還原不是產品需求，不將實驗備份機制帶入實作。

## 現況與方案

[entry.ts](../../src/adapter/entry.ts) 的 `checkReady` 與 `insertAndSend` 皆拒絕不同非空草稿。插入流程目前已會選取編輯器内容，但尚沒有獨立的「清空成功」驗證步驟。

推薦並經董事會確認的方向是改動同一 adapter seam：

1. `checkReady` 保持唯讀，繼續檢查登入、指定聊天、editor 與生成狀態。不同文字不再單獨造成 `EDITOR_BUSY`。
2. `insertAndSend` 在實際修改前確認目標 editor 與生成狀態，再明確清空舊內容並驗證空框。
3. 繼續沿用既有原文插入、精確內容驗證、send button 等待、單次 click 與新 user turn 驗證。

替代方案「只改善草稿 busy 提示」仍會阻擋查字，不符合新授權。另一方案「僅刪掉 guard、直接以插入覆蓋」沒有獨立清空步驟，已被董事會糾正，不採用。

## 實作細節與安全邊界

### 清空與插入

- 使用 editor 的 owner document、selection/range 與現有可通知 Gemini 編輯模型的編輯命令。限定 selection 在該 editor，不對整個頁面 selectAll。
- 舊框有內容時先執行刪除；確認 editor 已空，才重新建立插入 selection 並插入本次原文。空框則直接進入插入。
- 不以 `innerHTML = ''` 或 HTML 字串 fallback 繞過 Gemini 編輯模型。具體命令需真實 CfT 驗證，不能只用 mock 推定框架已同步。
- 清空失敗或插入不一致，沿用適當失敗型別（例如現有 `INPUT_NOT_FOUND`）並提供明確 reason；不得當作成功或繼續點 send。
- 保留 [normalizeText](../../src/adapter/entry.ts) 的 NFC／換行規則；不縮減空格、tab 或 trim 本次問題。空白-only 舊框亦不得混入新問題。
- 本次內容插入後若遭其他操作修改，精確驗證應失敗，不盲目重新清空並重試。

### 生成與單次送出

- 仍將生成中視為 busy，不使用 Stop。不放寬其他 `EDITOR_BUSY` 分支、不改 send button 等待期限。
- [runner.ts](../../src/sw/runner.ts) 的 write-ahead、單次 adapter send、sending deadline、`maybeSent` 與中斷恢復規則不變。若必須改動，先回報計畫矛盾，不自行擴大重送條件。
- 重啟或未確認送出不能再清框重送；清空只發生在原本允許執行插入的階段。
- 不新增全域草稿狀態、權限、外部服務或字詞特例。

## 預計影響與文件一致性

- 主變更為 [entry.ts](../../src/adapter/entry.ts) 的兩處草稿分支與清空／插入流程。
- 對應 DOM 行為測試可在 adapter 測試群新增一個小型案例檔。既有 [adapter-real.test.ts](../../tests/unit/adapter-real.test.ts) 主要測訊息 wiring，不足以單獨證明真實清空步驟。
- 沿用 [selectors.test.ts](../../tests/unit/selectors.test.ts)、[runner.test.ts](../../tests/unit/runner.test.ts) 與 [talk-machine.test.ts](../../tests/unit/talk-machine.test.ts) 的相關保護，不修改無關測項。
- 在新規格與既有相關技術規格中對齊「Bro Chat 草稿可清除」的授權範圍。不要留下新舊相反規則同時指導實作；僅更新直接相關段落，不重寫架構。
- 所有變更同步 [package.json](../../package.json)、[package-lock.json](../../package-lock.json) 頂層與根套件、[manifest.json](../../manifest.json)。本計畫版本為 0.1.12，實作前重新確認最新基準。

## 驗收

feature 深度；must 擋結案，should 不擋結案。

| ID | 等級 | 可觀察結果 |
| --- | --- | --- |
| M1 | must | 不同非空 Bro Chat 草稿下，claude／haiku／Anthropology／apple 不因原稿而被 `checkReady` 拒絕；原稿在 readiness 階段仍未被修改。 |
| M2 | must | 真正 send 路徑依序清空、驗證空、插入、驗證原文、click 一次；新 user turn 僅含本次問題，不附加舊稿。覆蓋空框、不同文字、同文字與空白-only 框。 |
| M3 | must | 清空失敗、框仍非空、插入失敗或內容不一致都不 click；有明確失敗 reason。 |
| M4 | must | 本次問題的空格、tab、Unicode 與換行原文保留；不修改既有 normalization 契約。 |
| M5 | must | 生成中不清框、不按 Stop、不 click；保留其他 busy 分支與 deadline 行為。 |
| M6 | must | write-ahead／中斷／送出未確認情境不重送、不因新清框規則再執行 send；僅在既有可插入階段清空。 |
| M7 | must | 正確候選 build 的真實 CfT 對照中，四詞皆在預設草稿及空框情境完成對應 Answer；记录候選 commit、extension bundle 身分與各 Talk 結果，不能僅用 API accepted 當完成。 |
| M8 | must | Popup 與側邊欄沿用同一 SW／adapter 行為；本次 Popup 草稿、歷史與非目標分頁不被新清空流程修改。版本四欄一致，build／type-check 通過。 |
| S1 | should | 新發現的其他偶發 `EDITOR_BUSY` 分支另開後續工單；未在本次重現的分支不臆測修復。 |

測試先建立會因舊程式草稿拒絕／缺少獨立清空而失敗的 adapter DOM regression，再改程式。覆蓋實際 call-site，而非只 mock `RealBroAdapter` 回傳 ok。

開發與 QA 只跑新案例及相關測試，例如：

```bash
node --test tests/unit/adapter-editor.test.ts tests/unit/selectors.test.ts tests/unit/adapter-real.test.ts tests/unit/runner.test.ts tests/unit/talk-machine.test.ts
npm run build
npx tsc --noEmit
```

新檔名為建議，實作可依現有結構調整。以 Node >=22 與團隊 `test-run` 記錄實際 selector、非零案例數與結果。CfT 必須遵循隔離 profile/CDP 9222，優先既有分頁，不接日常瀏覽器；遇環境或版本差異明確記錄，不自行改設定。PM 在合併／發布前才跑完整套件。

## 交付流程

grilling 已確認共同理解與明確清空流程，診斷／grilling 證據在本機團隊 evidence 目錄。此計畫先 `work submit-plan T-3` 送審；董事會核准後由 PM 更新規格、派 Engineer 實作。Architect 不在此階段修改產品程式。
