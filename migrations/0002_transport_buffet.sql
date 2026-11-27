-- 新增交通方式、Buffet 資格；人工兌換改為確認視窗，不再使用兌換碼
-- meal_redeemed_at / meal_redeemed_by 沿用為「Buffet 兌換券」兌換紀錄
ALTER TABLE attendees ADD COLUMN transport TEXT;                              -- 交通方式：例如「1 號車」、「自行開車前往」
ALTER TABLE attendees ADD COLUMN buffet_eligible INTEGER NOT NULL DEFAULT 1;  -- Buffet 資格：1 = 有、0 = 無
DELETE FROM settings WHERE key = 'manual_code';
