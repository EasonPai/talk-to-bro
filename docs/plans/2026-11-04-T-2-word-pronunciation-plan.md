# T-2 回覆英文單字點擊發音計畫

狀態：待董事會審查。需求與技術方向已確認，不代表實作已獲核准。

## 目的與範圍

閱讀 Bro 回覆時，直接點英文單字即可聽發音。Popup 與側邊欄必須一致。

董事會已確認：

- 一般文字、標題、清單與表格可點；連結、程式碼與操作按鈕不可觸發。
- 平常維持閱讀外觀，滑鼠移入單字時才顯示淡底色或細底線。
- 拖曳選字不發音；既有複製與閱讀展開操作不變。
- 詞內撇號與連字號保留，例如 `don't`、`mother-in-law`；不朗讀周邊標點、數字或整句。
- 固定 `en-US`、正常語速，不新增口音、語速或鍵盤逐詞操作。
- 最新點擊中止前一次播放，不排隊。
- 不要求在關閉介面、切換回答或離頁時主動停止；交由瀏覽器生命週期處理。
- 不可播放時顯示簡短提示，不接雲端語音，不新增擴充套件權限。
- 先驗證原生語音在真實擴充套件頁面可用；不可用則回報董事會，不自行更換方案。

## 現況與設計依據

- [popup.ts](../../src/popup/popup.ts) 已共用於 Popup 與側邊欄，依 host 區分版面。回答經 marked 與 DOMPurify 後寫入 DOM，再處理連結。
- [popup.css](../../src/popup/popup.css) 已定義回答內標題、清單、表格與程式碼樣式，可加限定於可發音詞的 hover 樣式。
- 回答會因狀態更新重建，應在穩定的回答容器上委派事件，避免每次渲染累積 listener。
- 目前沒有語音實作或共用短提示 helper；不應挪用翻譯失敗狀態、修改 SW 或新增 storage 寫入者。
- 原生語音於 MV3 頁面的可用性尚未實測。此文件不主張已播放成功。

## 方案比較與選擇

董事會選擇「清理後文字節點包裝」：走訪回答中的可處理文字節點，將英文詞包為輕量 span，使用委派點擊與原生 Web Speech API。

替代方案是按滑鼠座標定位文字偏移。它不改 DOM，但 hover、詞邊界與定位相容性更複雜，對本次範圍沒有足夠收益，故不採用。喇叭按鈕與雲端語音不符合已確認範圍。

## 實作順序與邊界

### 1. 原生語音可行性門檻

遵循 [CfT 規範](../testing/chrome-for-testing-setup.md)，使用隔離 profile、CDP 9222 與 headless 設定。優先使用既有測試分頁，不操作日常瀏覽器。

在實際載入的擴充套件 Popup 與側邊欄文件中，以真實點擊觸發 `SpeechSynthesisUtterance`，設定 `lang = 'en-US'`、正常 rate，先 cancel 再 speak。記錄瀏覽器版本、extension origin、host、voice 清單、語音載入時機及 start/end/error 結果。API 存在或 mock 通過不算播放成功。

headless 環境可能沒有可用音訊。若無法取得實際播放證據，明確回報驗證限制並停在門檻，不把 API 事件冒充人工聽音驗證，不擅自切換 headless 設定。若需可聽驗證或環境調整，由董事會決定。

### 2. 單字標記與互動

保留 marked → DOMPurify → DOM 的順序。只在清理後 DOM 上處理文字節點；透過 DOM API 建立 span，不將回覆文字拼接為 HTML。

排除 `a`、`pre`、`code`、按鈕與其他互動元素內的文字。以 ASCII 英文字母為基本詞，允許字母間的直／彎撇號及連字號；不要將含數字識別字拆成可朗讀片段。這是 Architect 提出的分詞規則，實作以代表案例固定行為，不加入語言辨識套件。

在共用回答容器委派事件，確認目標是可發音詞且沒有非折疊 selection，並確認該 pointer gesture 沒有拖曳選字，才播放。不要阻止文字選取、改寫剪貼簿或攔截原有控制項。

僅加 hover 樣式，不新增逐詞 tab stop、按鈕語意或全域快捷鍵。重複渲染不重複包裝或綁定 listener。

### 3. 語音與錯誤處理

語音狀態只存在各 extension document，不進 SW 或全域 storage。兩個 host 共用程式邏輯，但本單不新增跨文件播放仲裁。

檢查 API 與可用英文 voice，處理非同步 voice 載入，不將初次空清單直接視為永久不可用。實際點擊後若沒有可用英文語音，顯示提示，不靜默忽略或退回其他語言。

每次有效點擊先 cancel 再建立新 utterance。保留目前 utterance 的有效參照，以事件或 token 區分新舊播放；舊的 cancelled/interrupted 事件不得覆蓋新播放或報錯。真正的錯誤顯示可存取的非阻塞短提示，與翻譯錯誤分離。

不增加自動離頁停止功能，不保證瀏覽器在文件銷毀後持續播放。

## 預計影響

- [popup.ts](../../src/popup/popup.ts)：清理後處理入口、委派互動與短提示整合。
- [popup.css](../../src/popup/popup.css)：hover 與提示樣式。
- 可在同目錄抽出單一 pronunciation 模組，僅在能讓分詞／事件測試更簡單時採用，不建立通用框架。
- 優先擴充 [popup-reading.test.ts](../../tests/unit/popup-reading.test.ts)，host 回歸參考 [ui-sidepanel.test.ts](../../tests/unit/ui-sidepanel.test.ts)。若既有 mock 不適合真實 DOM 互動，使用現有瀏覽器驗證方式補足，不以重寫 mock 取代實際互動證據。
- 所有變更同步 [package.json](../../package.json)、[package-lock.json](../../package-lock.json) 與 [manifest.json](../../manifest.json) 的版本；實作前重新確認基準，避免覆蓋他人更新。

## 驗收與測試

本單以 feature 深度驗收，以下 must 皆需通過。

| ID | 等級 | 案例與可觀察結果 |
| --- | --- | --- |
| M1 | must | 真實 CfT 擴充套件兩個 host，由點擊啟動英文語音，記錄播放與限制證據；無法驗證則回報阻擋，不宣稱通過。 |
| M2 | must | 段落、標題、清單、表格內點詞只送出該詞；`don't`、`mother-in-law`、彎撇號詞維持完整；標點、純數字及含數字識別字不被誤讀。 |
| M3 | must | 連結、行內／區塊程式碼與按鈕不發音；連結、複製、閱讀展開維持原行為。 |
| M4 | must | 單擊發音；拖曳選字與已有文字選取的點擊不發音，不破壞複製結果。 |
| M5 | must | 快速連點取消前次，僅最新詞播放；舊取消事件不造成錯誤提示或污染新播放。 |
| M6 | must | API 缺少、無英文 voice、實際播放失敗皆有短提示；初始空 voice 清單後延遲載入可恢復；無外部服務請求或新增權限。 |
| M7 | must | 重複渲染後一次點擊只播放一次；hover 提示不改變回答文字、Markdown 結構或造成明顯版面位移。 |
| M8 | must | Popup 與側邊欄皆通過相關互動與建置驗證，版本四個欄位一致。 |
| S1 | should | 手動聽音確認系統英文 voice 的清晰度；若門檻證據不足以證實功能可用，仍須依 M1 阻擋，而非用此項豁免。 |

單元測試以既有 runner 選取實際新增／修改檔案，記錄 selector 與非零案例數；透過 `test-run --role <desk> --ticket T-2 -- <command>` 留證。另執行 `npm run build`，真實瀏覽器覆蓋 selection、hover 與兩個 host。QA 只跑 must 與相關回歸；PM 在合併／發布前跑一次完整套件。

## 提交與後續

本計畫附 [grilling 報告](../../.scratch/orca-team/evidence/T-2-grill-report.md)（本機執行證據，不作為產品文件依賴）。董事會已確認需求與方案，尚待透過 work 審核本計畫。PM 核准流程完成後才能派 Engineer 實作。
