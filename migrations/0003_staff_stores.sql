-- 公司人員：以部門為「店名」，不填問卷、不領贈品（照常報到、可用 Buffet）
ALTER TABLE stores ADD COLUMN is_staff INTEGER NOT NULL DEFAULT 0;
