# Chrome for Testing (CfT) 環境設定指南

本文件為 **talk-to-bro** 專案中 **Chrome for Testing（CfT）** 的安裝、環境配置、啟動參數與版本鎖定的**單一真實來源 (Single Source of Truth, SSOT)**。

通用專案規範與 Git 協作守則請參考根目錄的 [`AGENTS.md`](../../AGENTS.md)。

---

## 1. 為什麼需要 Chrome for Testing？

本專案各項 Web UI 原型、前端畫面實機驗證與 CDP 遠端除錯強制要求使用 Chrome for Testing，核心優勢如下：

1. **版本固定不自動更新**：一般 Chrome 會在背景自動無感升級，容易導致測試環境與 API 行為在不同時期或不同開發者間產生漂移。CfT 專為自動化與測試設計，絕不自動更新。
2. **獨立 Profile 完全隔離**：使用專用的 `--user-data-dir="$HOME/.chrome-cdp-profile"`，絕不污染日常個人瀏覽器的登入帳號、Cookie 與外掛設定。
3. **原生支援 CDP 遠端除錯**：透過 `--remote-debugging-port=9222` 開放 Chrome DevTools Protocol 連線，讓驗證腳本、AI Agent 與外部 DevTools 能直接精確監控 DOM、網路請求與前端介面狀態。

---

## 2. 下載與安裝

使用 `@puppeteer/browsers` CLI 一行安裝至使用者目錄：

```bash
# 專案目前鎖定版本：156.0.8078.80
npx @puppeteer/browsers install chrome@156.0.8078.80 \
  --install-dir ~/Applications/chrome-for-testing
```

- 若需查詢最新或特定版本：[googlechromelabs.github.io/chrome-for-testing](https://googlechromelabs.github.io/chrome-for-testing/)
- 若欲安裝最新 stable 版，可指定 `chrome@stable`。

---

## 3. 多平台可執行檔路徑對照表

安裝完成後，各作業系統可執行檔的路徑格式如下：

| 平台 | 路徑格式 | 本機範例 (以 156.0.8078.80 為例) |
| --- | --- | --- |
| macOS Apple Silicon (M 系列) | `~/Applications/chrome-for-testing/chrome/mac_arm-<版本>/chrome-mac-arm64/Google Chrome for Testing.app` | `~/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app` |
| macOS Intel | `~/Applications/chrome-for-testing/chrome/mac-<版本>/chrome-mac-x64/Google Chrome for Testing.app` | `~/Applications/chrome-for-testing/chrome/mac-156.0.8078.80/chrome-mac-x64/Google Chrome for Testing.app` |
| Linux x64 | `~/Applications/chrome-for-testing/chrome/linux-<版本>/chrome-linux64/chrome` | `~/Applications/chrome-for-testing/chrome/linux-156.0.8078.80/chrome-linux64/chrome` |

**驗證安裝：**

```bash
# macOS Apple Silicon 為例
ls ~/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/
# 輸出中應包含 "Google Chrome for Testing.app"
```

---

## 4. 啟動（搭配 CDP Remote Debugging）

啟動帶有 Remote Debugging Port 的 CfT 實例，供實機驗證使用：

```bash
# macOS Apple Silicon 為例（請依實際安裝路徑調整）
open -na \
  "$HOME/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app" \
  --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-cdp-profile"
```

### 啟動參數說明

| 啟動參數 | 說明 |
| --- | --- |
| `--remote-debugging-port=9222` | 開啟 CDP 連線埠，供腳本或外部 DevTools 連入 |
| `--user-data-dir` | 使用獨立的 Profile 目錄（全域使用者目錄：$HOME/.chrome-cdp-profile），完全隔離個人平常使用的 Chrome 資料 |

---

## 5. 確認 CDP 連線正常

在終端機執行：

```bash
curl http://localhost:9222/json/version
```

**預期回傳：**
應回傳含有 `"Browser": "Chrome/156.0.8078.80"` 與 `"webSocketDebuggerUrl"` 的 JSON 物件。

---

## 6. 前端 UI 預覽與實機驗證（強制規範）

為落實測試環境與個人日常瀏覽器之嚴格隔離，**任何開啟、預覽或手動驗證本專案 Web UI / 靜態 HTML Artifacts 的操作，一律強制使用 Chrome for Testing**，嚴禁在終端機裸調用 `open http://...`（此舉會啟動日常個人瀏覽器）。

### 核心原則：優先聚焦現有分頁、禁止重複開啟、依賴即時更新

1. **開發中代碼自動即時更新（Dev Server / HMR）**：
   在開發模式下，當前端代碼或 HTML 檔案修改存檔時，若開發伺服器具備 Live Reload / HMR，會自動注入或重新整理，**無需手動頻繁開關視窗，嚴禁每次修改都開新分頁**。

2. **分頁已存在時：喚醒現有分頁（不重複開分頁）**：
   若 CfT 視窗已經開啟目標網址或連接埠，透過 CDP `activate` 喚醒焦點即可：
   ```bash
   # 1. 查詢目標分頁（以 port 5173 或特定路徑為例）的 targetId
   TARGET_URL="http://localhost:5173"
   TARGET_ID=$(curl -s http://localhost:9222/json/list | grep -B 3 "$TARGET_URL" | grep '"id":' | head -n 1 | awk -F '"' '{print $4}')

   # 2. 喚醒該分頁至前景焦點
   curl -s -X PUT "http://localhost:9222/json/activate/$TARGET_ID"
   ```

3. **初次開啟或分頁尚未建立時**：
   - **透過 CDP 開啟新分頁**：
     ```bash
     TARGET_URL="http://localhost:5173"
     curl -s -X PUT "http://localhost:9222/json/new?$TARGET_URL"
     open -a "$HOME/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app"
     ```
   - **或直接以指定 CfT 應用程式路徑開啟（macOS Apple Silicon 範例）**：
     ```bash
     open -a \
       "$HOME/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app" \
       "http://localhost:5173"
     ```

---

## 7. 版本鎖定與維護規範 (SSOT)

為確保專案成員與測試環境一致性：

1. **單一真實來源**：本文件為本專案中 CfT 版本號、安裝指令與啟動路徑的唯一權威出處。
2. **版本升級程序**：版本異動時，**僅需在此文件更新版本號與路徑**，並在 commit message 中說明升級原因。其他引用文件（如 `AGENTS.md`）均透過超連結引用，無需重複修改路徑。
