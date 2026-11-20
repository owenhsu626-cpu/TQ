-- 活動報到系統 初始資料表
-- 唯一性與「只能成功一次」的規則由資料庫保證（UNIQUE / 條件式 UPDATE），不靠前端。
-- 時間一律存台灣時間 ISO 字串，例如 2026-12-06T21:03:12+08:00（同格式可直接字串比較）。

CREATE TABLE stores (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,          -- 店名
  gift_token         TEXT NOT NULL UNIQUE,          -- 贈品 QR Code 內容（隨機）
  gift_redeemed_at   TEXT,                          -- NULL = 未兌換
  gift_redeemed_by   TEXT,                          -- 'scan' | 'manual' | 'staff'
  survey_lock_by     INTEGER,                       -- 正在填寫問卷的 attendees.id
  survey_lock_until  TEXT                           -- 填寫鎖到期時間
);

CREATE TABLE attendees (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,                 -- 姓名
  store_id           INTEGER NOT NULL REFERENCES stores(id),
  room               TEXT,                          -- 入住房號
  table_no           TEXT,                          -- 晚宴桌次
  note               TEXT,                          -- 備註（選填）
  token              TEXT NOT NULL UNIQUE,          -- 個人 token / 餐盒 QR Code 內容（隨機，報到後才會提供給本人）
  checked_in_at      TEXT,                          -- NULL = 未到
  checkin_method     TEXT,                          -- 'self' | 'staff'
  rules_agreed_at    TEXT,                          -- 住宿規範同意時間
  meal_redeemed_at   TEXT,                          -- NULL = 未領
  meal_redeemed_by   TEXT,                          -- 'scan' | 'manual' | 'staff'
  manual_fail_count  INTEGER NOT NULL DEFAULT 0,    -- 人工兌換碼輸入錯誤次數（防暴力猜碼）
  UNIQUE (name, store_id)
);
CREATE INDEX idx_attendees_name ON attendees(name);
CREATE INDEX idx_attendees_store ON attendees(store_id);

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

INSERT INTO settings (key, value) VALUES
  ('checkin_open_at',   ''),
  ('checkin_close_at',  ''),
  ('survey_open_at',    '2026-12-06T21:00:00+08:00'),
  ('survey_close_at',   '2026-12-07T08:30:00+08:00'),
  ('gift_stock',        '50'),
  ('manual_code',       '0000'),
  ('notice_text',       '請於晚宴開始前 10 分鐘入座。如有任何問題，請洽現場工作人員。'),
  ('hotel_rules',       '為維護飯店住宿品質、公共安全及環境整潔，請所有貴賓配合以下規範：

- **禁止吸菸：** 酒店室內及非指定吸菸區全面禁止吸菸，包含紙菸、電子菸及其他各類菸品，請至酒店指定吸菸區使用。
- **禁止明火：** 酒店客房及公共區域禁止使用蠟燭、香氛蠟燭、蚊香及其他可能產生明火或火源之物品。
- **設備維護：** 請妥善使用酒店內各項設備、寢具及物品，勿任意破壞、拆卸或攜出。
- **環境維護：** 請共同維護酒店環境整潔，避免造成設備損壞、嚴重髒污或異味。
- **損害賠償：** 如因個人故意或疏失，造成酒店設施、設備或物品損壞，或產生額外清潔及修繕費用，須依實際情況負擔相關賠償責任。

感謝您的配合，共同維護良好的住宿品質與公共安全。'),
  ('hotel_rules_agree', '我已詳閱並了解上述酒店住宿安全及注意事項，並同意遵守相關規定。如因個人行為造成酒店設施、設備或物品損壞，願依實際情況負擔相關賠償責任。'),
  ('survey_questions',  '[{"id":"q1","type":"rating","label":"整體活動滿意度","required":true},{"id":"q2","type":"single","label":"您最喜歡的活動環節","options":["大會議程","晚宴","住宿安排"],"required":true},{"id":"q3","type":"text","label":"其他建議","required":false}]');
