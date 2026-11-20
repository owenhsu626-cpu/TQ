// 餐盒與贈品兌換：一律用條件式 UPDATE 保證只成功一次，失敗再查原因。
import { nowTw } from './util.js';

/**
 * 餐盒兌換。where 為 { token } 或 { id }。
 * 回傳 { status: 'redeemed'|'already'|'not_checked_in'|'not_found', name, store, at }
 */
export async function redeemMeal(db, where, by) {
  const now = nowTw();
  const [col, val] = where.token !== undefined ? ['token', where.token] : ['id', where.id];
  const res = await db
    .prepare(
      `UPDATE attendees SET meal_redeemed_at = ?1, meal_redeemed_by = ?2
       WHERE ${col} = ?3 AND checked_in_at IS NOT NULL AND meal_redeemed_at IS NULL`
    )
    .bind(now, by, val)
    .run();
  const row = await db
    .prepare(
      `SELECT a.id, a.name, s.name AS store, a.room, a.table_no, a.checked_in_at, a.meal_redeemed_at
       FROM attendees a JOIN stores s ON s.id = a.store_id WHERE a.${col} = ?1`
    )
    .bind(val)
    .first();
  if (!row) return { status: 'not_found' };
  const info = { id: row.id, name: row.name, store: row.store, room: row.room, table_no: row.table_no };
  if (res.meta.changes > 0) return { status: 'redeemed', at: now, ...info };
  if (!row.checked_in_at) return { status: 'not_checked_in', ...info };
  return { status: 'already', at: row.meal_redeemed_at, ...info };
}

/**
 * 贈品兌換（以店家為單位）。where 為 { token } 或 { id }。
 * 扣庫存與標記兌換在同一個 UPDATE 內完成：已兌換店數 < 總數量 才會成功。
 * 回傳 { status: 'redeemed'|'already'|'no_survey'|'sold_out'|'not_found', store, at }
 */
export async function redeemGift(db, where, by) {
  const now = nowTw();
  const [col, val] = where.token !== undefined ? ['gift_token', where.token] : ['id', where.id];
  const res = await db
    .prepare(
      `UPDATE stores SET gift_redeemed_at = ?1, gift_redeemed_by = ?2
       WHERE ${col} = ?3 AND gift_redeemed_at IS NULL
         AND EXISTS (SELECT 1 FROM surveys WHERE surveys.store_id = stores.id)
         AND (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'gift_stock')
             > (SELECT COUNT(*) FROM stores WHERE gift_redeemed_at IS NOT NULL)`
    )
    .bind(now, by, val)
    .run();
  const row = await db
    .prepare(
      `SELECT s.id, s.name, s.gift_redeemed_at,
              (SELECT a.name FROM surveys v JOIN attendees a ON a.id = v.attendee_id WHERE v.store_id = s.id) AS survey_by
       FROM stores s WHERE s.${col} = ?1`
    )
    .bind(val)
    .first();
  if (!row) return { status: 'not_found' };
  const info = { store_id: row.id, store: row.name };
  if (res.meta.changes > 0) return { status: 'redeemed', at: now, ...info };
  if (row.gift_redeemed_at) return { status: 'already', at: row.gift_redeemed_at, ...info };
  if (!row.survey_by) return { status: 'no_survey', ...info };
  return { status: 'sold_out', ...info };
}

/** 贈品剩餘數量 */
export async function giftRemaining(db) {
  const r = await db
    .prepare(
      `SELECT (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'gift_stock') AS stock,
              (SELECT COUNT(*) FROM stores WHERE gift_redeemed_at IS NOT NULL) AS used`
    )
    .first();
  return { stock: r.stock || 0, used: r.used || 0, remaining: Math.max(0, (r.stock || 0) - (r.used || 0)) };
}
