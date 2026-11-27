# 2026 台灣普利司通經銷商年度大會 — 活動報到系統

Cloudflare Workers + D1。一個 Worker 同時提供前端頁面（`public/`）與 `/api/*`。
`public/` 在 `wrangler dev` / `wrangler deploy` 前會自動打包進 Worker（`scripts/build-assets.mjs` → `src/static-assets.gen.js`），不需手動建置。

**測試站：** https://test-checkin.bcb.com.tw （後台 `/admin/`；D1 `checkin-test`，APAC；備用網址 https://bridgestone-checkin-test.owenhsu626.workers.dev）
需求見 `docs/SPEC.md`，視覺見 `docs/DESIGN.md`。

| 網址 | 用途 |
| --- | --- |
| `/` | 參加者報到（輸入姓名 → 選店 → 確認身分 → 住宿規範 → 完成） |
| `/me?t=<token>` | 報到完成頁（房號、桌次、交通方式、注意事項、Buffet 兌換券、問卷、贈品 QR） |
| `/buffet` | Buffet 統一入口（現場張貼的 QR Code；後台「匯入匯出」可下載 QR／A4 海報） |
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
# 測試站 D1 已建立（checkin-test）
npx wrangler d1 create checkin-prod --location apac   # 把 database_id 填入 wrangler.toml [env.production]
npx wrangler secret put ADMIN_PASSWORD --env production
npm run db:migrate:prod
```

網域：測試站 `test-checkin.bcb.com.tw` 已綁定；正式站發佈時取消 `wrangler.toml` 中 `checkin.bcb.com.tw` 的 `routes` 註解。

## 發佈流程

1. `npm run deploy:test` → 客戶在測試站確認（可用 `BASE=https://test-checkin.bcb.com.tw ADMIN_PASSWORD=... npm test` 跑測試）
2. 確認後同一版 `npm run deploy:prod`（正式站資料不受影響）
3. 活動當天不部署，除非緊急修正
4. 資料表有變動時，新增 `migrations/000N_xxx.sql`，先 `db:migrate:test`、確認後再 `db:migrate:prod`

## 上線前檢查

- [ ] 問卷開放時間、贈品數量、注意事項、問卷題目
- [ ] 後台 → 匯入匯出：匯入正式名單 CSV（`姓名,店名,房號,桌次,交通方式,Buffet資格,備註`，UTF-8 或 Excel Big5 皆可）
- [ ] 在**正式站**後台下載 Buffet 入口海報並列印（QR Code 指向下載時的站台）
- [ ] 用手機實際掃一次 Buffet 與贈品 QR Code（後台掃碼需 HTTPS 才能開相機）

## 規則實作位置

| 規則 | 實作 |
| --- | --- |
| 每店一份問卷 | `surveys.store_id UNIQUE`（`src/public.js` surveySubmit） |
| 同店填寫鎖 10 分鐘 | `stores.survey_lock_by/until` 條件式 UPDATE（surveyStart） |
| 每店一次贈品、限量 | 單一條件式 UPDATE：未兌換 + 已填問卷 + 已兌換數 < 總數（`src/redeem.js`） |
| 每人一份 Buffet、須有資格且已報到 | 條件式 UPDATE（`src/redeem.js`） |
| 時間判斷 | 一律伺服器時間（台灣時間），`src/util.js` |
| 人工兌換 | 參加者畫面跳出確認視窗，由工作人員按「確認兌換」（伺服器要求 `confirm: true`） |
| 後台登入 | `ADMIN_PASSWORD` secret + HMAC 簽章 cookie（16 小時），兩站各自獨立 |
