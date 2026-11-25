# T-1 側邊欄與跨工作階段恢復計畫

日期：2026-11-03。
工單：T-1，Popup 釘選至側邊欄並跨工作階段恢復狀態。
狀態：設計範圍已由董事會確認；本文件待技術計畫審核，不授權實作。
交付方式：一張端到端需求單，不拆成可各自宣稱完成的 UI 與儲存工單。
驗收階段：feature，只以本計畫的 must 測項阻擋結案。

## 設計範圍與核准

本功能讓閱讀網頁時的 Talk To Bro 保持可見，也讓關閉介面或退出 Chrome 後的草稿與回答不遺失。保留目前 Popup 的查字入口及人設，不建立新聊天產品。

董事會逐項確認 Q1–Q12，最後答覆「是」，授權依共同理解撰寫送審計畫。PM 的事件 `pm-t1-requirements-20261103` 另確認跨分頁側邊欄、重啟不自動顯示、一張端到端需求單及真實 CfT 驗收。這些答覆均不是產品實作核准。

已確認的契約如下。

- 保留 Popup。釘選立即切到 Chrome 原生側邊欄，取消釘選立即切回 Popup。
- 側邊欄在同一視窗跨分頁保持開啟。不使用分頁專屬側邊欄。
- 模式偏好、未送出草稿、最近一次 Talk 及完整 Answer 跨介面及瀏覽器工作階段保存。多視窗共用一份內容。
- 同時修改草稿時，以最後成功保存的修改為準。Talk 成功接受後，原文屬於 Talk，不再是未送出草稿。拒絕提交保留草稿。
- 只切換發起操作的視窗。不強制關閉其他視窗正在使用的介面。其他視窗下次透過 Talk To Bro 圖示開啟時使用新偏好。
- Chrome 的側邊欄關閉按鈕只收起介面，不取消釘選。
- 完全退出並重開 Chrome 不自動顯示 Talk To Bro。下次主動開啟才恢復偏好與內容。
- 瀏覽器重啟時，未完成 Talk 維持中斷及既有 Handoff 行為，不自動重送。
- 最低 Chrome 提升至 141。這是實作批次的變更，本文件批次不修改最低版本。
- 不要求捲動位置、焦點或展開閱讀模式跨瀏覽器重啟精準恢復。同一已開啟介面的既有閱讀行為保留。
- 不加入多筆對話工作區、跨裝置同步、網頁內浮動視窗、歷史搜尋或新視覺系統。

用語見 [GLOSSARY.md](../../GLOSSARY.md)。關閉、取消釘選及重啟恢復是不同操作。

## 選定的技術路徑

董事會在 Q11 選擇共用目前的 HTML、呈現邏輯與樣式，建置成 Popup 與側邊欄兩個入口。另一條路是獨立側邊欄 UI，較容易自由安排版面，但需要維護兩套呈現與互動。本次沒有不同內容或新視覺需求，選共用介面。

以下是 Architect 的技術提案，不是已驗證的 API 行為。

1. 以目前 Popup HTML 為單一模板，建置輸出 `popup.html` 與 `sidepanel.html`。兩者共用封裝腳本、樣式及 DOM ID。不手動複製第二份來源 HTML。
2. 在入口初始化時明確辨識 host。Popup 保留現有寬高、縮放及閱讀行為；側邊欄依 Chrome 提供的可用寬高排版，不套用 Popup 的固定 body 寬度或 600px 外框高度限制。
3. Service Worker 仍是所有儲存狀態的唯一寫入者。新模式與草稿使用獨立的 `ui:v1` key，不放入 `runtime:v1`。
4. 既有 Talk、Answer、完成紀錄、計時及 Handoff 繼續使用目前的 Talk runner 與儲存路徑。畫面切換不得新增 Talk 或觸發重送。

throughput checkpoint: 先驗證 Chrome 真實能力，再完成一張工單內的狀態與雙入口整合，最後驗收整條使用流程。

## 現況與需要改變的原因

- [popup.ts:547–560](../../src/popup/popup.ts) 初始化讀取 `runtime:v1` 的 `lastTalk`，並訂閱 storage 變化。完成回答來自保存的 `answerMarkdown`。
- [view-state.ts:146–178](../../src/popup/view-state.ts) 區分等待中 Talk 的文字與畫面草稿。現有 busy 到 terminal 的轉換會清輸入，不能原封不動套到共享持久草稿。
- [storage.ts:8–42](../../src/shared/storage.ts) 以整個 key 取代 runtime。`writeAheadTalk` 與 `finalizeTerminalTalk` 讀取、修改並寫回同一 key。
- [runner.ts:140–179](../../src/sw/runner.ts) 及後續 mutation 使用序列化 mutex。UI 若直接修改 runtime，會與 Talk 的寫回競爭，可能覆蓋新回答。
- [reconcile.ts:37–42](../../src/sw/reconcile.ts) 將新瀏覽器工作階段的未完成 Talk 標記中斷。此規則保留。
- [popup.css:19–31](../../src/popup/popup.css) 固定 body 寬度，其他 wrapper 限制 Popup 高度。側邊欄不能直接沿用這些外框尺寸。
- [build.mjs:16–104](../../scripts/build.mjs) 已建置 Popup 腳本及複製 HTML、CSS。此處增加第二份由同一模板產生的輸出。
- [manifest.json](../../manifest.json) 目前只有 `action.default_popup`，尚無側邊欄宣告或權限。

## Chrome 能力與實機前置門檻

官方依據如下。

- [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)：`sidePanel` 權限及 `side_panel.default_path` 提供全域側邊欄；`open({windowId})` 開啟該視窗的全域面板。
- [sidePanel.open](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-open)：只可在使用者動作後開啟。
- [sidePanel.close](https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-close)：Chrome 141 起可用。使用 `windowId`，不依賴後續版本更動的 `tabId` 回退行為。
- [action API](https://developer.chrome.com/docs/extensions/reference/api/action)：指定 Popup 時不會收到 `action.onClicked`。

官方文件沒有證明「Popup 點擊經 runtime message 到 SW」一定保留開啟面板的動作資格，也沒有保證 Chrome 在重啟時如何恢復側邊欄可見狀態。這兩點不能用 mock 通過代替。

Engineer 在隔離 spoke、依 [CfT 設定](../testing/chrome-for-testing-setup.md) 使用真實 unpacked extension，先驗證 M1。瀏覽器操作必須經隔離 CfT，不使用日常 Chrome。

M1 必須證明三條實際 API 路徑。

1. Popup 點擊釘選後可開啟 `sidepanel.html`，保存最新草稿，並關閉 Popup。先嘗試由點擊 handler 直接發起 `sidePanel.open`，不要先等待無關 storage 或 boot Promise。若需要 SW 配合，驗證真實 message 路徑，不能假設點擊資格可以跨任意 await 傳遞。
2. 側邊欄取消釘選可在同一視窗開啟 Popup，並用 `sidePanel.close({windowId})` 關閉側邊欄。先證明兩個 API 的可用時序，不先關閉唯一可顯示錯誤的來源畫面。
3. 已釘選並開啟的側邊欄，在完整退出並恢復瀏覽器視窗後不自動顯示。驗證一般啟動與恢復上次分頁兩種啟動設定；同時驗證第一次 action 點擊及 SW 冷啟動。

允許在已核准的工單內寫最小能力驗證，不視為已交付產品。若其中一條路徑不成立，保留截圖、Chrome 版本、API 錯誤及重現步驟，執行 `work block T-1`，由 PM 轉 Architect 與董事會處理。不自行改成雙擊、手動關閉、提高到其他最低版本或放棄「不自動顯示」。

## UI 狀態及儲存責任

新模型預計如下，實際名稱可依現有型別規範微調。

```ts
type UiMode = 'popup' | 'sidepanel';

interface UiState {
  mode: UiMode;
  draft: string;
  revision: number;
}
```

revision 由 SW 增加，用於識別草稿版本，不使用客戶端時間決定先後。模式與草稿更新是欄位級命令，不能用舊快照覆蓋另一欄。

- 沒有 `ui:v1` 的既有安裝預設 Popup、空草稿。保留原本 `runtime:v1`，不清除 Talk 或紀錄。
- UI 只經 runtime message 讀寫模式與草稿。新命令在 SW 邊界驗證 payload，保存錯誤回傳明確失敗。
- UI mutations 在獨立序列化佇列內讀取最新 UI 狀態並寫回，不與 Talk runner 共用整個 runtime 寫回。
- 同一 host 的輸入保存依輸入順序送出，不允許較舊請求在較新輸入後寫回。不同 host 以 SW 成功寫入順序決定最新草稿。
- 不以 debounce 加 unload 事件作為唯一保存機制。每次 input 都排入保存，關閉再開必須恢復最後成功保存的版本。
- input 事件保存 IME 中間草稿，但不觸發提交或重組正在 composition 的文字。遠端草稿更新延後至本地 composition 結束再套用。
- 模式切換與提交前必須保留當下輸入及其保存結果。切換的最新草稿交接與點擊資格時序由 M1 驗證，不允許以「等稍後保存」作為成功條件。
- Talk 成功接受後，只可條件式清除本次提交所對應的草稿版本。若其他 host 已保存較新草稿，保留較新版本。拒絕提交不清除。
- Answer 的終態重繪不再無條件清除持久草稿。等待中的 Talk 原文仍由 Talk 呈現，不能將它自動保存回未送出草稿。
- runtime 與 ui 的讀取不是跨 key 交易。初始化與重繪必須依 Talk 的 busy 狀態、草稿版本與訂閱更新收斂，不在兩個 key 同時寫入新的一套 Talk 副本。
- 已接受 Talk 與 UI 草稿清除之間可能有 SW 中斷。實作需記錄足以識別「該草稿已被這次 Talk 接受」的關聯，或使用等效可恢復設計；啟動只補做條件式清除，不再提交 Talk。M6 要驗證此中斷點。

revision、提交關聯及必要的模式切換協調是技術責任，不是新增多對話或獨立視窗狀態。不要引入通用事件框架、雲端服務或第二個全域狀態來源。

## 模式與介面生命週期

持久偏好與目前視窗是否開啟分開處理。不把 `onClosed` 等同取消釘選，也不保存「啟動後自動打開」旗標。

- Popup 模式設定 action Popup。釘選模式清除 action 的 Popup 路由，讓明確 action 點擊開啟全域側邊欄。
- 選擇一條 action 路由，不同時讓 `openPanelOnActionClick` 與自訂 `onClicked` 各開一次。建議使用可辨識 `windowId` 的自訂 action handler。
- action 點擊不得先 await 無關工作而失去動作資格。SW 冷啟動與 saved mode 的路由初始化必須列入 M1、M8，而不是只測已暖機的 SW。
- SW 初始化讀取 UI 偏好並設定路由，不呼叫 `sidePanel.open` 或 `action.openPopup`。Chrome 自身恢復可見面板的情況，採用 M1 證實可行的抑制時序。
- 不在一般 SW 重新啟動時關閉所有面板。瀏覽器新工作階段與 SW 暫停後重啟必須用現有 session 邊界區分。
- 釘選與取消釘選是一個有明確成功或失敗的 UI 操作。只在來源內容已保存及目標開啟成功後完成來源關閉。
- API 開啟、保存或路由設定失敗，顯示錯誤並保持來源內容。恢復上一個已提交偏好及路由；若恢復本身失敗，也需顯示該失敗，不回傳成功。
- 多視窗的 mode 命令需序列化，避免兩次切換的失敗回滾覆蓋較新的已成功偏好。只回滾自己仍擁有的版本。
- 其他視窗可繼續使用目前 host，觀察共享內容，但不因偏好變更被強制切換。host 類型不等於最新偏好。
- 不因開關 host、跨分頁或 UI 初始化呼叫 `talk/submit`。既有 `_execute_action` 快捷鍵遵循選定模式。

## 版面與行為保留

延續目前 Pip、色彩、字型、正文格式及文案，不重做 DESIGN 或素材。

- 釘選操作放在既有工具區，提供明確名稱、鍵盤操作、焦點及操作中狀態。不要用單一無名稱圖示表達兩個不同操作。
- 側邊欄填滿可用高度，正文捲動時保留回答操作。窄寬度保留輸入、錯誤、複製與取消釘選入口。
- 表格及程式碼使用局部水平捲動，不造成整體水平溢出。不為容納版面縮小正文。
- Popup 既有縮放與展開閱讀模式保留。側邊欄不得修改正在閱讀的網頁 zoom。
- 點擊釘選不觸發 Enter 提交，重繪不改寫 Answer，不改變 clipboard 內容格式。
- 舊請求完成時保留較新的草稿、已開啟 host 與使用者閱讀操作。

## 變更邊界

預計修改下列來源及其直接相依測試。

- [popup.html](../../src/popup/popup.html)、[popup.ts](../../src/popup/popup.ts)、[popup.css](../../src/popup/popup.css)、[view-state.ts](../../src/popup/view-state.ts) 與 [zoom.ts](../../src/popup/zoom.ts)：新增 host 行為、釘選操作、持久草稿呈現與側邊欄尺寸。
- [sw/index.ts](../../src/sw/index.ts)：新 UI messages、action 路由及生命週期銜接。
- [shared/types.ts](../../src/shared/types.ts)、[shared/validate.ts](../../src/shared/validate.ts)、[shared/storage.ts](../../src/shared/storage.ts)：新 UI 型別、payload 驗證與獨立 key 存取。
- [sw/boot.ts](../../src/sw/boot.ts)、[sw/runner.ts](../../src/sw/runner.ts)：只在提交關聯及啟動恢復確有需要時改動。不得修改等待上限、重送政策或擴大 handoff 權限。
- [build.mjs](../../scripts/build.mjs) 及 [manifest.json](../../manifest.json)：產生側邊欄入口，宣告 `sidePanel`、`side_panel.default_path` 與最低 Chrome 141。
- [package.json](../../package.json) 及 [package-lock.json](../../package-lock.json)：實作版本同步；若既有 Chrome 型別缺少 141 API，僅更新必要的 Chrome typings，不用不安全型別轉換。
- 必要時用一個小型 UI 協調模組隔離新操作，不為單一 feature 建立通用 routing 或 state 框架。

不改 Adapter、Options、翻譯內容或既有 Bro Chat。PM 派工時保留以上完整 touches，不將共用狀態與 UI 拆給平行席位。

## 驗收測項

所有 must 都以實際使用結果驗證。mock 用於可控的 mutation 與失敗測試，不能取代 Chrome host、啟動與真實操作。

| ID | 等級 | 測試與通過條件 |
| --- | --- | --- |
| M1 | must | 真實 CfT 證明釘選、取消釘選、Chrome 不自動恢复面板及 SW 冷啟動路由。記錄 API 時序、版本與證據；不成立就阻塞，不繼續宣稱核心假設已驗證。 |
| M2 | must | Popup 輸入包含換行、中英文與 IME 草稿，釘選後逐字相同；取消釘選立即回到同視窗 Popup，草稿與完整回答不變。切換不增加 Talk 提交次數。 |
| M3 | must | 側邊欄在同視窗至少兩個一般分頁切換與分頁導覽後保持可用；標準 action 圖示與既有快捷鍵遵循保存模式。 |
| M4 | must | 關閉 Popup 或側邊欄後再開恢復最新成功保存的草稿、最近回答與偏好。側邊欄 X 不取消釘選，也不自動重開。 |
| M5 | must | 完整退出 CfT 再以同一隔離 profile 重開，Talk To Bro 不自動顯示。第一次主動開啟恢復模式、草稿與完整回答。分別覆蓋一般啟動與恢復上次分頁，不能用 SW 重啟代替瀏覽器重啟。 |
| M6 | must | 拒絕提交保留草稿；成功接受後不把 Talk 原文當作未送出草稿。保存新的草稿後，舊 Talk 完成不能清除它。覆蓋 Talk 接受與草稿條件清除之間的 SW 中斷，不重送也不誤清新草稿。 |
| M7 | must | 兩視窗共用最新草稿與回答。同 host 的快速修改不倒序覆蓋，兩 host 以最後成功保存為準；模式更新不覆蓋草稿。切換 A 不關閉 B；B 下次開啟使用新偏好。 |
| M8 | must | UI 保存與 Talk runner 更新交錯時，完整回答、寫前狀態及紀錄不遺失。SW 在同工作階段重啟不關掉開啟面板；新工作階段未完成 Talk 中斷，不自動重送，既有 Handoff 可用。 |
| M9 | must | 注入 draft 保存、mode 保存、面板開啟、Popup 開啟及路由設定失敗，均顯示原因並保留來源內容；不以成功回應掩蓋失敗。故障回滾不覆蓋另一視窗較新已成功操作。 |
| M10 | must | 真實 Popup 正常及小高度，以及側邊欄窄及一般寬度，各覆蓋 100%、150%、200% 三組。共 12 組長中英文 Markdown，正文完整可讀、複製等於原文、操作可見、無整體水平溢出。記錄實際 viewport 與截圖，不要求 Chrome 接受虛構固定面板寬度。 |
| M11 | must | Enter、Shift+Enter、IME、等待、完成、错误、Handoff、閱讀展開與收起、鍵盤焦點及 reduced motion 的既有行為通過相關測試。初始化與切換不重放動畫或重送。 |
| M12 | must | `dist/` 含兩個可載入的真實入口；無新增 CSP 放寬。既有安裝缺少新 key 可恢復原 Last Talk；新版本的四個版本欄位一致，最低 Chrome 141 明確。完成一次真實 Talk，在兩個 host 讀到同一份完整回答並完整複製。 |
| S1 | should | 同一 host 內的呈現更新盡量保留鄰近閱讀位置；不要求跨關閉或瀏覽器重啟精準恢復。 |
| S2 | should | 釘選與取消釘選提示不干擾正文閱讀；可依實機使用改善非阻擋性的動效或提示細節。 |

M10 的 12 組為 4 個 host/尺寸情境乘以 3 個縮放比例，不是虛構已執行數量。M12 的真實 Talk 使用董事會既有 Bro Chat，遵守既有產品傳送範圍；不批次新增測試查詢或修改對話設定。

## 測試工具與交付順序

沿用 npm、Node >=22、esbuild、TypeScript 與 Node test runner。不新增測試框架。

預計以現有 [popup-view-state.test.ts](../../tests/unit/popup-view-state.test.ts)、[popup-reading.test.ts](../../tests/unit/popup-reading.test.ts)、[storage.test.ts](../../tests/unit/storage.test.ts)、[runner.test.ts](../../tests/unit/runner.test.ts) 與 [reconcile.test.ts](../../tests/unit/reconcile.test.ts) 加入直接相關案例。新 UI 協調或 storage 模組才新增相應測試檔。

預計執行命令如下。實際數量依當次 runner 輸出回報，不預先宣稱通過。

```bash
node scripts/check-node-version.mjs
node --test tests/unit/popup-view-state.test.ts tests/unit/popup-reading.test.ts tests/unit/storage.test.ts tests/unit/runner.test.ts tests/unit/reconcile.test.ts
npx tsc --noEmit
npm run build
git diff --check
```

每次測試經團隊 `test-run --role <desk> --ticket T-1 -- <command>` 記錄。Engineer 開發只跑相關測試，失敗只重跑相應案例。發布或合併前由 PM 跑一次完整測試。

1. PM 取得本計畫核准後，產生 T-1 詳細規格及工單，確保測項與本計畫一致。spawn 隔離 spoke，完整 touches 派給一個 Engineer 席位。
2. Engineer 先 ack、載入技能，驗證 M1 的真實能力並留下證據。
3. 實作獨立 UI 狀態與條件式草稿清除，證明不破壞 Talk 儲存。
4. 整合共享雙 host、操作路由與版面，再完成跨視窗和重啟驗證。
5. Engineer 以 work done 交回 PM，附提交、實際測試選擇器及數量、CfT Chrome 版本、12 組尺寸證據和技能鏈。
6. PM 依有效角色規範派驗收。Architect 本次規劃不自行判產品通過。驗收者逐項證明 M1–M12，should 列後續建議，不擴大驗收。

沒有真實 host 或瀏覽器重啟證據時不判完成。能力、工具、型別或 API 阻塞都以 work block 回報，不提供假成功替代。

## 文件批次與後續版本

本批次僅新增此計畫、術語及本機 grilling 證據，將目前 0.1.6 的四個版本欄位同步至 0.1.7。沒有新增側邊欄權限、修改最低 Chrome 或實作功能。

Engineer 實作批次另行增版，依派工時最新版本決定，不搶先占用固定版本。更新 manifest、package 與 lock 根套件，保留其他席位與 PM 的既有變更。

角色指派 `assign-architect-20261102-pm`。本機 grilling 證據在 `.scratch/orca-team/evidence/T-1-grill-report.md`，不提交 terminal handle 或其他本機身份資料至版控。
