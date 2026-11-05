---
id: T-popover-reading
milestone: popup-reading
weight: 1
status: done
retries: 1
---

# Popover 原地加寬與閱讀模式

**交付：** 在同一工具列 Popup 內完成長 Answer 展開閱讀、收起與完整複製。

**Blocked by：** 無其他工單；董事會已批准設計與實作計畫。

**狀態：** 以團隊 work ledger 為準，不手動維護狀態鏡像。

## 核准依據

- [實作計畫及完整測試案例](../plans/2026-11-02-popover-reading-implementation-plan.md)
- [詳細規格](../specs/T-popover-reading-spec.md)
- 董事會原話：「批准计划，开始实作」。

## 驗收清單

- [ ] M1 must：完成 Answer 可用滑鼠、Enter、Space 展開及收起，不增加頁面或視窗。
- [ ] M2 must：同一 Answer 重繪維持模式，重新開啟預設緊湊，新請求恢復正常控制。
- [ ] M3 must：草稿逐字保留，切換不增加提交或 storage 寫入。
- [ ] M4 must：長中英文 Markdown 完整可讀，複製等於原始 Markdown，字級與縮放不降低。
- [ ] M5 must：正文捲動時工具列可用；焦點可見，隱藏控制不可聚焦，無整體水平溢出。
- [ ] M6 must：真實 action Popup 正常及小高度，各含 100%、150%、200%，六組尺寸與截圖證據。
- [ ] M7 must：緊湊、等待、完成、錯誤、Handoff、IME 與 Enter 行為不變，相關測試通過。
- [ ] S1 should：切換保留同段或鄰近閱讀位置，不要求像素精準。

## 執行與交付

先 work ack 並載入工單技能，依有效 Engineer 首次派工規範執行。
只在 PM 指定的 spoke worktree 修改，中央 ledger 指向主倉庫。
先證明隔離 CfT 可開啟真實 action Popup，再開始尺寸實作。
工具阻塞或 M6 無法完成時 work block，保留證據，不假報通過。
實作批次由 Engineer 獨占版本 0.1.2 → 0.1.3，所有版本欄位保持一致。
完成後附測試、實機證據、技能鏈與提交，用 work done 交回 PM；不自行驗收結案。
