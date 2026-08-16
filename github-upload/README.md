# 每日運動紀錄 Fitness Record

一個單一檔案的運動紀錄工具：重量訓練逐組追蹤、九種運動、精選教學影片、進步曲線。
紀錄存在**使用者自己的 Google 雲端硬碟**（App 專用隱藏區 `appDataFolder`），沒有伺服器、沒有資料庫，開發者也讀不到任何人的資料。

**線上版：** https://daniellllin.github.io/fitness-record/

---

## 功能

| 分頁 | 內容 |
|---|---|
| 記錄訓練 | 重量訓練、高強度間歇、混合健身、爬山、健行、跑步、自行車、游泳、羽球，各有專屬欄位 |
| 歷史紀錄 | 依運動類型／時間範圍／關鍵字篩選，重訓可展開逐組明細 |
| 統計分析 | 本月次數與時數、連續天數、近 12 週趨勢、部位訓練量分布、單一動作預估 1RM 進步曲線、PR 排行 |
| 影片庫 | 45 則依部位與運動分類的高評價教學，可自行加入收藏 |
| 資料備份 | 立即同步、切換帳號、匯出 JSON／CSV、匯入、自訂動作 |

重量訓練會**自動帶入上次的重量與次數**，並顯示動作要領與對應的教學影片。

## 技術

- 單一 HTML 檔，無建置流程、無外部相依（圖表為自製 SVG）
- 登入：Google Identity Services（瀏覽器端 token 流程）
- 儲存：Google Drive REST API，`drive.appdata` 範圍，單一 `fitness-record.json`
- 離線：localStorage 快取（依帳號分開），跨裝置以 id 聯集合併，刪除以墓碑同步
- 支援淺色／深色主題與手機版面

只使用非敏感範圍（`drive.appdata`、`openid`、`email`、`profile`），不需通過 Google 的敏感／受限範圍審查。

## 自行架設

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案並啟用 Google Drive API
2. 設定 OAuth 同意畫面（外部），建立 **OAuth 用戶端 ID → 網頁應用程式**
3. 「已授權的 JavaScript 來源」填入你的網域（例如 `https://你的帳號.github.io`；本機測試再加 `http://localhost:8080`）
4. 把用戶端 ID 填入 `index.html` 開頭的 `CONFIG.CLIENT_ID`，或在登入畫面貼上

完整圖文步驟見 [setup.html](setup.html)。

## 在自己電腦執行

下載 `index.html`、`啟動運動紀錄.bat`、`server.js`、`serve.ps1` 到同一個資料夾，雙擊 `.bat` 即可（會開在 `http://localhost:8080`）。
不能直接雙擊 `index.html` — Google 登入不接受 `file://` 來源。

## 授權

MIT
