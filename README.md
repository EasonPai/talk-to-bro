# Talk To Bro Personally (隨身聊)

`talk-to-bro-personally` 是 `agentic-development` 專案底下的獨立子產品。
旨在打造一個輕量、極速的桌面 Chrome MV3 擴充套件，讓使用者（Pai）在瀏覽器任何分頁閱讀時，能透過快捷鍵直接叫出彈出視窗（Popup），輸入英文單字或片語，由背景常駐的 Gemini（**Bro**）使用已啟用翻譯 Skill 的對話（**Bro Chat**）進行解答，並在 Popup 中無縫讀取結果，徹底免除頻繁切換分頁與手動貼上的繁瑣步驟。

---

## 核心特色與架構原則

- **流暢查字體驗**：全域快捷鍵呼叫 Popup，即打即查（支援單字、片語或逗號分隔多字查詢），不打斷既有閱讀與工作節奏。
- **人設與外觀風格（Look & Feel）**：
  - **Pip**：扮演熱心奔走的小弟（Pixel Art / Roguelike 風格），負責在介面上替使用者向老大請教。
  - **Bro**：在背後深思熟慮的老大（Gemini），專注提供高質量的翻譯與單字解析。
- **堅固的 MV3 核心架構**：
  - **Service Worker 主導時間推進**：SW 每秒輪詢（probe）背景 Bro Chat 分頁，杜絕背景分頁定時器節流（throttle）造成的逾時失準。
  - **單一真實狀態（SSOT）**：以 `chrome.storage` 作為全域狀態來源，SW 為唯一狀態寫入者，Popup 僅響應與渲染。
  - **Write-ahead 預先防護**：送出前先標記狀態，重啟或中斷時絕不盲目重複發送。
  - **零阻礙退路（Handoff）**：遇到未預期 DOM 改版、超時或驗證失敗時，自動將輸入複製至剪貼簿並導引至 Bro Chat，保證永不卡死。

---

## 目錄結構

```
products/talk-to-bro-personally/
├── README.md               # 產品總覽與架構說明
├── src/                    # Chrome MV3 擴充套件原始碼
│   ├── manifest.json       # MV3 Manifest
│   ├── popup/              # Popup 前端 (HTML/CSS/TS)
│   ├── background/         # Service Worker (SW)
│   ├── adapter/            # Gemini DOM 介接與選擇器 (Isolated World)
│   └── offscreen/          # Offscreen Document (剪貼簿與音效輔助)
├── tests/                  # 單元測試與 E2E 整合測試
└── docs/                   # 產品規格與文件
    ├── prd/                # 產品需求規格書 (PRD v1.1)
    ├── tech-spec/          # 技術設計與架構規格 (Tech Spec v1.0)
    ├── plans/              # 實作開發計畫 (Implementation Plans)
    ├── knowledge/          # 知識沉澱與架構筆記 (Knowledge Transfer)
    └── retrospectives/     # 開發工作階段回顧 (Retrospectives)
```

---

## 相關文件與外部連結

- **產品需求規格書 (PRD)**：[`docs/prd/2026-10-28-talk-to-bro-personally-prd.md`](docs/prd/2026-10-28-talk-to-bro-personally-prd.md)
  - 雲端 Notion 來源：[Notion PRD v1.1](https://app.notion.com/p/3c20e8c693da42eeb1e9436942b79aef)
- **技術方案與開發計畫 (Tech Spec)**：[`docs/tech-spec/2026-10-28-talk-to-bro-personally-tech-design-and-plan.md`](docs/tech-spec/2026-10-28-talk-to-bro-personally-tech-design-and-plan.md)
  - 雲端 Notion 來源：[Arena Talk To Bro Personally](https://app.notion.com/p/hi-eason/Arena-Talk-To-Bro-Personally-90e76761366241b98283f2aac3795b28?source=copy_link)
- **全專案產品清單**：[`products/README.md`](../README.md)
- **通用術語表**：[`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)
