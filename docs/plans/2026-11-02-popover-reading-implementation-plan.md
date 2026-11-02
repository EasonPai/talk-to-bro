---
ticket: T-popover-reading
stage: feature
dependsOn: []
touches:
  - src/popup/popup.html
  - src/popup/popup.css
  - src/popup/popup.ts
  - src/popup/zoom.ts
  - tests/unit/popup-shell.test.ts
  - tests/unit/popup-view-state.test.ts
  - tests/unit/popup-zoom.test.ts
  - tests/unit/popup-reading.test.ts
  - package.json
  - package-lock.json
  - manifest.json
---

# T-popover-reading 實作計畫

日期：2026-11-02。責任角色：Architect。狀態：送董事會審閱，未授權實作。

依據[已批准短設計](2026-11-02-popover-expanded-reading-design.md)，
在同一個工具列 Popup 加入手動展開閱讀與收起。正文完整保留，增加可視閱讀空間。
計畫批准前，不派 Engineer、不修改產品程式、不操作真實 Bro Chat。

## 1. 固定範圍與現況

董事會已選方案 A「加寬＋閱讀模式」，未選只加寬或新開閱讀頁。
PM 事件 `pm-popover-design-approved-20261102-01` 轉達原話
「批准此设计，继续制定实作计划」。
重新開啟 Popup 預設緊湊，不寫入閱讀偏好。

以下為靜態程式證據，不代表本次已驗證瀏覽器行為。

| 接點 | 現況與實作影響 |
|---|---|
| [popup.css](../../src/popup/popup.css) 第 19–37、136–144 行 | 400px 基準寬，600px 高度限制，既有 main 與正文可分別捲動。閱讀模式需明確交接捲動所有權。 |
| [zoom.ts](../../src/popup/zoom.ts) 第 4–29 行 | 沿用目前 active-tab zoom 與 800px 寬度上限。不能以提高 zoom 冒充擴容，也不能為了加寬降低正文縮放。 |
| [popup.ts](../../src/popup/popup.ts) 第 180–275、342–344、414–425 行 | 儲存狀態變動會重繪、切換容器、處理輸入及排程尺寸調整。新增模式必須與這些重繪相容。 |
| [view-state.ts](../../src/popup/view-state.ts) 第 118–142 行 | 忙碌階段寫入目前 Talk，完成轉換清空一次；普通終態重繪保留草稿。本單不改此契約。 |
| [popup.ts](../../src/popup/popup.ts) 第 402–413 行 | 複製使用原始 Markdown，不可改成畫面可見片段或純文字轉換。 |
| [manifest.json](../../manifest.json) 第 18–24 行 | 使用 Chrome action 的 default_popup。獨立 HTML 並非真正 Popup 主機驗證。 |

不改 SW、共享 Talk 型別、storage 寫入者、Gemini adapter、timeout、Handoff、
Options、權限或 CSP。不新增依賴、字型、素材、持久設定或新閱讀視窗。
沿用現有繁體中文、像素人設、色彩及可讀正文尺寸。

## 2. 實作本地閱讀狀態

在 [popup.ts](../../src/popup/popup.ts) 的文件生命週期內保存
`readingMode`，初始為 `false`。這是純顯示狀態，不是新的 Talk 狀態。
保持既有 runtime storage 為業務狀態來源。

1. 在完成 Answer 的工具列新增原生 button，文字在「展開閱讀」與「收起」間切換。
   使用 `aria-expanded`，並以 `aria-controls` 指向既有正文容器。
2. 只有目前 `done` 且有可顯示 Answer 時允許展開。非完成狀態不顯示入口。
   若展開時完成 Answer 消失或進入另一個請求，回到緊湊模式，恢復該狀態既有控制。
3. 同一完成 Answer 的無關 storage 重繪維持模式，不把每次 render 當作初始化。
   若完成 Answer 換成另一則，重設模式與閱讀錨點，避免套用上一則的位置。
4. 切換只更新根節點模式標記與佈局，不呼叫提交、取消、Handoff 或 storage 寫入。
   不重建 textarea，不設定 textarea.value，也不借用 busy→terminal 轉換清空草稿。
5. 不改 Enter、Shift+Enter、IME、既有等待與錯誤流程。
   能沿用現有 DOM 與區域 ID，就不要新增平行 renderer。

優先將少量協調邏輯留在現有 Popup 模組。只有測試確實需要時，才抽出尺寸計算
或模式轉換的純函式，不另建設定層、全域 store 或通用閱讀框架。

## 3. 限制尺寸，保留正文縮放

先在隔離 CfT 的真實 action Popup 量測目前緊湊模式，記錄縮放、可用螢幕範圍、
Popup 內外尺寸及正文 clientWidth/clientHeight。不得將 Chrome 的寬高上限當作
每個螢幕都能取得的可用空間。

Architect 建議的閱讀模式基準寬為 560 個未縮放 CSS px。
這是送審的實作選擇，不是董事會已指定的數值。

1. 保留既有有效縮放 `z`。緊湊模式維持原有 400px 基準。
   閱讀模式要求的可見寬上限為 `min(560 * z, 800, 可用螢幕寬度)`，
   CSS 佈局寬度再除以 `z`。不得同時放大 CSS 寬度與 zoom 兩次。
2. 閱讀模式沿用 600px 可見高度上限，並受實際可用高度約束。
   高度限制只設定一次，再扣除仍顯示的標題、工具列、邊框與間距。
   所有 flex 中間層允許收縮，正文使用剩餘高度。
3. 不拿目前緊湊 Popup 的 innerWidth 當作永久寬度上限。
   先要求受限尺寸，再觀察真實主機結果；不得以反覆量測自身結果製造 resize 迴圈。
   螢幕尺寸只提供上界，最終仍以 Popup 主機實測判定控制項是否完整。
4. 100% 與 150% 在有足夠空間時應加寬。200% 可能已達 800px，
   此時不承諾繼續加寬，改由收起非正文區增加正文高度。
5. 必要時調整 [zoom.ts](../../src/popup/zoom.ts) 的模式尺寸參數，
   同步其呼叫處與既有測試。不要改寫目前縮放來源或全域 zoom 行為。
6. 若實際平台不能滿足正文與工具列可達性，停止並用 `work block` 呈報尺寸證據。
   不暗中改為新頁、側欄、縮字或只驗獨立 HTML。

## 4. 交接捲動、焦點與閱讀位置

閱讀模式收起角色敘述、上一則卡片與輸入區。保留緊湊標題、複製、
收起及既有必要識別。非正文裝飾與空白不再佔用閱讀高度。
收起後依目前 Talk 狀態恢復原有介面，不能無條件顯示本來不該出現的卡片。

閱讀模式只有正文擁有主要垂直捲動；外層與 main 不再形成第二個閱讀捲動區。
工具列位於正文捲動容器之外。表格與程式碼維持區域橫向捲動，長字串不得
撐寬整個 Popup。不要用 overflow:hidden 把未能閱讀的內容裁掉。

展開前記錄目前第一個可見正文區塊及其相對位移。
完成寬度重排與既有尺寸排程後，將該區塊恢復到鄰近閱讀位置。
同一 Answer 重繪時使用相同方式；區塊不存在時才退回受限比例位置。
不以跨寬度沿用原 scrollTop 作為已保留段落的證據。
此項屬 should，不要求像素精準，也不增加一般化內容定位系統。

切換按鈕使用滑鼠、Enter 與 Space。焦點留在仍存在的切換按鈕上。
隱藏區域使用實際 hidden 或等價不可聚焦機制，不只設定透明。
若狀態變動移除目前焦點所在工具列，焦點回到新狀態合理且可用的控制。
收起不強制聚焦 textarea，以免把閱讀位置拉走。

## 5. 按順序完成可驗證改動

1. 建立受控基線。在[既有 CfT 規範](../testing/chrome-for-testing-setup.md)
   指定的隔離環境，用可丟棄的擴充套件測試副本載入合成 Answer。
   不覆寫真實 Last Talk、Bro Chat 設定或共享擴充套件儲存。
   先證明能開啟及量測真正的 action Popup，再開始尺寸實作。
2. 實作模式按鈕、本地狀態與重繪整合。
   先驗證草稿、無關重繪與非完成狀態，不改業務狀態機。
3. 實作閱讀模式佈局與尺寸計算。
   對照相同內容、相同 zoom 的基線，量測正文區域與截圖。
4. 補上本節行為測試，執行既有建置與測試。
   檢查完一組結果再集中修正，不為每個 CSS 微調重跑全套。
5. Engineer 完成自驗後以 `work done` 交回，由 PM 安排驗收。
   Architect 可依有效角色政策執行 `work verify`，不自派 Engineer，
   也不以一則完成訊息取代 ledger 狀態轉換。

優先擴充 [popup-shell.test.ts](../../tests/unit/popup-shell.test.ts) 的現有 DOM 測試，
使用 [popup-zoom.test.ts](../../tests/unit/popup-zoom.test.ts) 驗證尺寸計算。
只有既有測試無合適入口時，才新增 `tests/unit/popup-reading.test.ts`。
[popup-view-state.test.ts](../../tests/unit/popup-view-state.test.ts) 保留現有草稿回歸案例；
不為了新增測試而改變該純狀態模組。

## 6. 依驗收案例提交證據

| 案例 | 等級 | 操作與通過條件 |
|---|---|---|
| M1 模式入口 | must | 完成 Answer 可用滑鼠、Enter、Space 展開及收起。未完成時不提供錯誤入口。目標數與視窗數不增加。 |
| M2 生命週期與重繪 | must | 同一 Answer 的無關 storage 事件保持展開。關閉再開回緊湊。新請求或 Answer 失效時恢復正常狀態控制。 |
| M3 草稿與業務隔離 | must | 在 done 狀態輸入未送出草稿，往返切換及無關重繪後逐字相同。提交訊息及 storage 寫入次數不因切換增加。 |
| M4 完整內容與複製 | must | 長中英文 Markdown 含標題、清單、寬表格、程式碼與長字串。正文無摘要或截斷，複製值逐字等於原始 Markdown。正文尺寸及 zoom 不因展開而降低。 |
| M5 捲動與焦點 | must | 正文垂直捲動時工具列可見且可聚焦。隱藏區域不進 Tab 順序。頁面無整體水平溢出，表格與程式碼可獨立橫向閱讀。 |
| M6 真實 Popup 尺寸 | must | 在真實 action Popup 跑正常與小可用高度兩種環境，各含 100%、150%、200%，共六組。控制項完整可達，無裁切。正常空間下展開的正文可視區域較基線增加。 |
| M7 既有行為回歸 | must | 緊湊模式、等待、完成、錯誤與 Handoff 的原有行為不變。IME 與 Enter 契約不變，既有相關測試通過。 |
| S1 閱讀位置 | should | 在長 Answer 中段切換，記錄第一個可見區塊。重排後保持同段或鄰近位置，不要求絕對像素相同。 |

M6 每組記錄螢幕可用尺寸、瀏覽器視窗尺寸、實際 tab zoom、Popup 視口、
document 與正文的 client/scroll 尺寸、模式、工具列位置及截圖。
小高度以測試環境實測可用高度小於正常情境為準，不能只縮小普通分頁冒充
Popup 空間受限。保留六組實測數據，不把螢幕高度或預期 CSS 高度當成結果。
實際 action Popup 若無法由既有 CfT 環境開啟，M6 標示未驗證並呈報阻擋。
一般 HTML 測試只補足 DOM 行為，不替代 M6。

使用既有工具，不為本單新增套件。實作後的必要命令如下。

```bash
npm test
npm run build
git diff --check
```

依既有 runner 支援的選檔方式先跑 Popup 測試，再於交付時執行上述檢查。
不用未確認的測試旗標，也不直接執行可能覆寫 spike 或真實 storage 的舊驗證腳本。
記錄 Node >=22、實際命令與結果。UI 完成後依 Impeccable 規範集中檢視並跑一次 detector。
測試失敗、工具限制與未完成實機案例都要明列，不能以 build 通過代替視覺驗收。

## 7. 版本、交付與回復

本次只有規劃文件與董事會要求的同步版本變動。
PM 已以 `pm-plan-receipt-ack-20261102-02` 確認 Architect 獨占 0.1.1 → 0.1.2。
同步 [package.json](../../package.json)、[package-lock.json](../../package-lock.json)
根與 root package 版本、[manifest.json](../../manifest.json)。
依賴套件自己的版本不改。這不是發布或產品實作完成的宣告。

Engineer 實作批次需由 PM 另行協調當時下一版本，不硬編碼重用 0.1.2，
且版本檔屬共用衝突範圍，不允許其他席位同時寫入。
只交付本計畫列出的 Popup、直接相關測試與版本檔變更。
建置輸出是否追蹤依現有規範，不新增依賴或外部安裝。

若須回復，移除閱讀模式相關變更並保留原緊湊流程。
不清除 storage、不回滾別人的提交，也不使用破壞性 Git 命令。

## 8. 送審自審與限制

已批准的產品決策是同一 Popup、方案 A、完整 Answer、手動切換、
當次文件生命週期與不改業務流程。尺寸 560px、錨點策略及 DOM 協調是
Architect 的送審建議，只有本計畫批准後才可實作。

`grill-with-docs` 載入 `grilling` 與 `domain-modeling`。
本單不新增領域術語或難以逆轉的架構決策，因此不建立 glossary 或 ADR。
送審前自審記錄保存於專案 scratch 的
`.scratch/orca-team/evidence/T-popover-reading-grill-report.md`。

目前只完成靜態調查與計畫自審，沒有執行產品測試、UI 修改或真實 Popup 驗收。
`superpowers:writing-plans` 不可用，依 PM 指示使用已部署規劃流程，
不搜尋全域、不安裝替代技能。
