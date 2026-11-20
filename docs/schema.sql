-- 建議的 D1 資料表（Claude Code 可依實作調整，但唯一性限制必須保留）

CREATE TABLE stores (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,          -- 店名
  gift_token         TEXT NOT NULL UNIQUE,          -- 贈品 QR Code 內容（隨機）
  gift_redeemed_at   TEXT,                          -- NULL = 未兌換
  gift_redeemed_by   TEXT,                          -- 'scan' | 'manual' | 'staff'
  survey_lock_by     INTEGER REFERENCES attendees(id),
  survey_lock_until  TEXT                           -- 填寫鎖到期時間
);

CREATE TABLE attendees (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,                 -- 姓名
  store_id           INTEGER NOT NULL REFERENCES stores(id),
  room               TEXT,                          -- 入住房號
  table_no           TEXT,                          -- 晚宴桌次
  note               TEXT,                          -- 備註（選填）
  token              TEXT NOT NULL UNIQUE,          -- 個人 token / 餐盒 QR Code 內容（隨機）
  checked_in_at      TEXT,                          -- NULL = 未到
  checkin_method     TEXT,                          -- 'self' | 'staff'
  rules_agreed_at    TEXT,                          -- 住宿規範同意時間
  meal_redeemed_at   TEXT,                          -- NULL = 未領
  meal_redeemed_by   TEXT,                          -- 'scan' | 'manual' | 'staff'
  UNIQUE (name, store_id)
);
CREATE INDEX idx_attendees_name ON attendees(name);

CREATE TABLE surveys (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id           INTEGER NOT NULL UNIQUE REFERENCES stores(id),  -- 每店一份
  attendee_id        INTEGER NOT NULL REFERENCES attendees(id),
  answers            TEXT NOT NULL,                 -- JSON
  submitted_at       TEXT NOT NULL
);

CREATE TABLE settings (
  key                TEXT PRIMARY KEY,
  value              TEXT NOT NULL
);

-- 預設設定（時間為台灣時間 ISO 字串）
INSERT INTO settings (key, value) VALUES
  ('checkin_open_at',   ''),                          -- 空白 = 立即開放
  ('checkin_close_at',  ''),
  ('survey_open_at',    '2026-12-06T21:00:00+08:00'),
  ('survey_close_at',   '2026-12-07T08:30:00+08:00'),
  ('gift_stock',        '50'),
  ('manual_code',       '0000'),                      -- 人工兌換碼，上線前務必修改
  ('notice_text',       '請於晚宴開始前 10 分鐘入座。如有任何問題，請洽現場工作人員。'),
  ('hotel_rules',       ''),                          -- 由 docs/hotel-rules.md 匯入
  ('survey_questions',  '[{"id":"q1","type":"rating","label":"整體活動滿意度"},{"id":"q2","type":"single","label":"您最喜歡的活動環節","options":["大會議程","晚宴","住宿安排"]},{"id":"q3","type":"text","label":"其他建議"}]');

-- 關鍵寫入範例（以條件式 UPDATE 保證只成功一次）
-- 餐盒：UPDATE attendees SET meal_redeemed_at = ?, meal_redeemed_by = ?
--       WHERE token = ? AND checked_in_at IS NOT NULL AND meal_redeemed_at IS NULL;
-- 贈品：UPDATE stores SET gift_redeemed_at = ?, gift_redeemed_by = ?
--       WHERE gift_token = ? AND gift_redeemed_at IS NULL
--         AND EXISTS (SELECT 1 FROM surveys WHERE surveys.store_id = stores.id)
--         AND (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'gift_stock')
--             > (SELECT COUNT(*) FROM stores WHERE gift_redeemed_at IS NOT NULL);
