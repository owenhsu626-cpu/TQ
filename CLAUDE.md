# 2026 台灣普利司通經銷商年度大會 — 活動報到系統

這個資料夾是給 Claude Code 的製作包。完整需求在 `docs/SPEC.md`，視覺規格在 `docs/DESIGN.md`。開始寫程式前先讀完這兩份。

## 要做什麼

一個手機優先（RWD）的活動報到網站，加一個工作人員後台：

- 參加者：掃 QR Code → 輸入姓名 → （同名時選店名）→ 確認身分 → 勾選住宿規範 → 報到完成頁（房號、桌次、注意事項、餐盒 QR、問卷、贈品 QR）
- 工作人員後台：報到人數、未到名單、代報到、掃碼或人工核銷餐盒與贈品、問卷與兌換統計、CSV 匯入匯出、各項設定

## 技術架構（已定案）

- **Cloudflare Workers**：同一個 Worker 提供前端頁面（靜態資源）與 `/api/*`
- **Cloudflare D1**：資料庫
- **兩個環境，資料完全分開**：
  - `test`：測試站，`test-checkin.<網域>`，D1 `checkin-test`
  - `production`：正式站，`checkin.<網域>`，D1 `checkin-prod`
  - 用 `wrangler.toml` 的 `[env.test]` / `[env.production]` 設定；網域由 Owen 提供
- 前端不要求框架，原生 HTML/CSS/JS 或輕量框架都可以，重點是在手機上載入快
- QR Code 產生：前端用輕量函式庫（例如 `qrcode`）產生；後台掃碼用相機（例如 `html5-qrcode`）

## 發佈流程（必須遵守）

1. 所有修改先部署到 **test**
2. 客戶在測試站確認
3. 確認後同一版部署到 **production**；正式站資料不受影響
4. 活動當天不部署新版，除非是緊急修正

`package.json` 提供：`npm run deploy:test`、`npm run deploy:prod`、`npm run db:migrate:test`、`npm run db:migrate:prod`、`npm run db:seed:test`（灌假資料，只能用於 test）。

## 一定要做對的規則

- **唯一性由 D1 保證，不靠前端判斷**：
  - 每家店只能有一份問卷 → `surveys.store_id` UNIQUE
  - 每家店只能兌換一次贈品 → `stores.gift_redeemed_at` 用條件式 UPDATE（`WHERE gift_redeemed_at IS NULL`）
  - 每人只能領一份餐盒，且必須已報到 → 條件式 UPDATE（`WHERE checked_in_at IS NOT NULL AND meal_redeemed_at IS NULL`）
  - 贈品限量：扣庫存與標記兌換在同一個 batch / transaction，庫存 <= 0 時拒絕
- **同店問卷填寫鎖定（必要）**：進入問卷時取得店家鎖（10 分鐘，存在 D1），其他同店的人看到「同店 OOO 正在填寫」；送出時再以 UNIQUE 限制兜底，後送者看到「本店已由 OOO 於 HH:MM 填寫完成」
- **時間一律以伺服器時間（Asia/Taipei）判斷**：報到開放時間、問卷開放時間（預設 12/6 21:00 – 12/7 08:30）
- 姓名搜尋為**精確比對**（去除前後空白），不做模糊搜尋
- 已報到的人再查詢 → 直接回到報到完成頁，不重複報到
- 住宿規範未勾選前「確認報到」按鈕必須 disabled；伺服器端也要驗證有勾選
- 參加者身分憑證：報到成功後發給該參加者一個隨機 token（存在 localStorage + URL），用來重新打開完成頁；QR Code 內容是不可猜的 token，不能是流水號
- 人工兌換按鈕：參加者畫面按「人工兌換」後，需要工作人員輸入 4 位數兌換碼確認（兌換碼在後台設定）
- 後台需登入密碼，test 與 production 各自獨立（用 Workers secret）

## RWD

- 參加者端以 360–430px 手機直式為主要設計尺寸，平板與桌機也要正常
- 後台要在筆電與手機上都好操作（未到名單在手機上改用卡片列表）
- 按鈕觸控區至少 44px；暗色手機、防窺片情境下 QR Code 要夠大（至少 220px）且留白足夠，完成頁提供「調亮顯示」切換（白底全螢幕 QR）

## 素材

`assets/` 內的素材都從客戶提供的主視覺 PDF 取出，用途見 `docs/DESIGN.md`。不要自行重畫 logo，只能使用 `assets/logo.png`。

## 待補（先用預設值，做成可在後台修改）

- 滿意度問卷題目：先放 3 題示範題（後台可編輯題目）
- 「簡單注意事項」文字：先放示範文字（後台可編輯，所有人相同）
- 正式名單：先用 `data/sample-attendees.csv`，之後由主辦方匯入 CSV
- HONOR Sans TC 是否有網頁授權未確認 → 先用 Noto Sans TC
