# 2026 台灣普利司通經銷商年度大會 — 活動報到系統

Cloudflare Workers + D1。一個 Worker 同時提供前端頁面（`public/`）與 `/api/*`。
需求見 `docs/SPEC.md`，視覺見 `docs/DESIGN.md`。

| 網址 | 用途 |
| --- | --- |
| `/` | 參加者報到（輸入姓名 → 選店 → 確認身分 → 住宿規範 → 完成） |
| `/me?t=<token>` | 報到完成頁（房號、桌次、注意事項、餐盒 QR、問卷、贈品 QR） |
| `/admin/` | 工作人員後台（需密碼） |

## 本機開發

```bash
npm install
echo 'ADMIN_PASSWORD="test1234"' > .dev.vars
npm run db:migrate:local
npm run db:seed:local      # 灌入 data/sample-attendees.csv
npm run dev                # http://localhost:8787
npm test                   # 另開終端機；API 與並發測試（會清空本機紀錄）
```

## 第一次部署（需 Cloudflare 帳號權限）

```bash
npx wrangler login
npx wrangler d1 create checkin-test     # 把 database_id 填入 wrangler.toml [env.test]
npx wrangler d1 create checkin-prod     # 把 database_id 填入 wrangler.toml [env.production]
npx wrangler secret put ADMIN_PASSWORD --env test
npx wrangler secret put ADMIN_PASSWORD --env production
npm run db:migrate:test
npm run db:migrate:prod
npm run db:seed:test                    # 只限測試站
```

取得網域後，把 `wrangler.toml` 內 `routes` 的註解取消並改成實際網域
（`test-checkin.<網域>`、`checkin.<網域>`）。

## 發佈流程

1. `npm run deploy:test` → 客戶在測試站確認（可用 `BASE=https://test-checkin.<網域> ADMIN_PASSWORD=... npm test` 跑測試）
2. 確認後同一版 `npm run deploy:prod`（正式站資料不受影響）
3. 活動當天不部署，除非緊急修正
4. 資料表有變動時，新增 `migrations/000N_xxx.sql`，先 `db:migrate:test`、確認後再 `db:migrate:prod`

## 上線前檢查

- [ ] 正式站後台 → 設定：**人工兌換碼改掉預設 0000**
- [ ] 問卷開放時間、贈品數量、注意事項、問卷題目
- [ ] 後台 → 匯入匯出：匯入正式名單 CSV（`姓名,店名,房號,桌次,備註`，UTF-8 或 Excel Big5 皆可）
- [ ] 用手機實際掃一次餐盒與贈品 QR Code（後台掃碼需 HTTPS 才能開相機）

## 規則實作位置

| 規則 | 實作 |
| --- | --- |
| 每店一份問卷 | `surveys.store_id UNIQUE`（`src/public.js` surveySubmit） |
| 同店填寫鎖 10 分鐘 | `stores.survey_lock_by/until` 條件式 UPDATE（surveyStart） |
| 每店一次贈品、限量 | 單一條件式 UPDATE：未兌換 + 已填問卷 + 已兌換數 < 總數（`src/redeem.js`） |
| 每人一份餐盒、須已報到 | 條件式 UPDATE（`src/redeem.js`） |
| 時間判斷 | 一律伺服器時間（台灣時間），`src/util.js` |
| 人工兌換碼 | 伺服器比對，同一人錯 5 次鎖定，需改由後台兌換 |
| 後台登入 | `ADMIN_PASSWORD` secret + HMAC 簽章 cookie（16 小時），兩站各自獨立 |
