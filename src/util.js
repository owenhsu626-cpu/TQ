// 共用工具：時間（Asia/Taipei）、token、JSON 回應、設定讀取

const TW_OFFSET_MS = 8 * 3600 * 1000;

/** 伺服器現在時間，台灣時間 ISO 字串：2026-12-06T21:03:12+08:00 */
export function nowTw(ms = Date.now()) {
  return new Date(ms + TW_OFFSET_MS).toISOString().slice(0, 19) + '+08:00';
}

/** 解析設定裡的時間字串；空白回傳 null */
export function parseTime(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * 判斷時間區間狀態。空白的開始 = 立即開放；空白的結束 = 不截止。
 * 回傳 'before' | 'open' | 'after'
 */
export function windowState(openAt, closeAt, ms = Date.now()) {
  const o = parseTime(openAt);
  const c = parseTime(closeAt);
  if (o !== null && ms < o) return 'before';
  if (c !== null && ms >= c) return 'after';
  return 'open';
}

/** 不可猜的隨機 token（128 bit，base64url） */
export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = btoa(String.fromCharCode(...a));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function err(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, '請以 JSON 送出');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '資料格式錯誤');
  }
}

export const SETTING_KEYS = [
  'checkin_open_at',
  'checkin_close_at',
  'survey_open_at',
  'survey_close_at',
  'gift_stock',
  'notice_text',
  'hotel_rules',
  'hotel_rules_agree',
  'survey_questions',
];

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  for (const k of SETTING_KEYS) if (s[k] === undefined) s[k] = '';
  return s;
}

export function parseQuestions(raw) {
  try {
    const q = JSON.parse(raw || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

/** 字串常數時間比較 */
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** 姓名只去除前後空白（含全形空白），精確比對 */
export function normName(s) {
  return String(s ?? '').trim();
}
