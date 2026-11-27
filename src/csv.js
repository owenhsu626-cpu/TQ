// 簡易 CSV 解析 / 產生（支援引號、逗號、換行、BOM）

export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_MAP = {
  姓名: 'name',
  name: 'name',
  店名: 'store',
  store: 'store',
  房號: 'room',
  room: 'room',
  桌次: 'table_no',
  table: 'table_no',
  table_no: 'table_no',
  交通方式: 'transport',
  交通: 'transport',
  transport: 'transport',
  buffet資格: 'buffet',
  buffet: 'buffet',
  備註: 'note',
  note: 'note',
  身分: 'role',
  身份: 'role',
  role: 'role',
};

const YES = new Set(['', '有', '是', 'y', 'yes', 'v', '1', 'true', '○', 'o']);
const NO = new Set(['無', '没有', '沒有', '否', 'n', 'no', 'x', '0', 'false', '×']);

const STAFF = new Set(['公司人員', '公司', '員工', 'staff', 'bs']);
const DEALER = new Set(['', '店家', '經銷商', 'dealer']);

/** 身分：「公司人員」= 1；空白或「店家」= 0。無法辨識回傳 null */
export function parseRole(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (STAFF.has(s)) return 1;
  if (DEALER.has(s)) return 0;
  return null;
}

/** Buffet資格：有 / 無；空白視為「有」。無法辨識回傳 null */
export function parseBuffet(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (YES.has(s)) return 1;
  if (NO.has(s)) return 0;
  return null;
}

/**
 * 解析名單 CSV：姓名,店名,房號,桌次,交通方式,Buffet資格,備註[,身分]
 * 身分（選填欄）：「公司人員」= 不填問卷、不領贈品；空白 = 一般店家。
 * 有表頭時依表頭欄名對應，否則依欄位順序。Buffet資格空白視為「有」。
 * 回傳 { rows: [{name, store, room, table_no, transport, buffet, note, staff}], errors: [string] }
 */
export function parseAttendeeCsv(text) {
  const raw = parseCsv(text);
  const errors = [];
  if (!raw.length) return { rows: [], errors: ['檔案沒有資料'] };
  let cols = ['name', 'store', 'room', 'table_no', 'transport', 'buffet', 'note'];
  let start = 0;
  const head = raw[0].map((c) => c.trim().toLowerCase());
  if (head.some((h) => HEADER_MAP[h] === 'name')) {
    cols = head.map((h) => HEADER_MAP[h] || null);
    start = 1;
    if (!cols.includes('store')) errors.push('表頭缺少「店名」欄');
  }
  const rows = [];
  const seen = new Set();
  for (let i = start; i < raw.length; i++) {
    const r = {};
    cols.forEach((c, j) => {
      if (c) r[c] = (raw[i][j] ?? '').trim();
    });
    const line = i + 1;
    if (!r.name || !r.store) {
      errors.push(`第 ${line} 行：姓名與店名必填`);
      continue;
    }
    const key = r.name + '\u0000' + r.store;
    if (seen.has(key)) {
      errors.push(`第 ${line} 行：${r.name}（${r.store}）重複`);
      continue;
    }
    const buffet = parseBuffet(r.buffet);
    if (buffet === null) {
      errors.push(`第 ${line} 行：Buffet資格需填「有」或「無」（目前為「${r.buffet}」）`);
      continue;
    }
    const staff = parseRole(r.role);
    if (staff === null) {
      errors.push(`第 ${line} 行：身分需空白或填「公司人員」（目前為「${r.role}」）`);
      continue;
    }
    seen.add(key);
    rows.push({
      name: r.name,
      store: r.store,
      room: r.room || '',
      table_no: r.table_no || '',
      transport: r.transport || '',
      buffet,
      note: r.note || '',
      staff,
    });
  }
  // 同一個店名不可同時是店家與公司人員
  const roleOf = new Map();
  for (const r of rows) {
    if (roleOf.has(r.store) && roleOf.get(r.store) !== r.staff) {
      errors.push(`店名「${r.store}」同時有店家與公司人員，請分開店名`);
      roleOf.set(r.store, -1);
    } else if (!roleOf.has(r.store)) roleOf.set(r.store, r.staff);
  }
  return { rows, errors };
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 產生 CSV（含 BOM，Excel 開啟中文不亂碼） */
export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
