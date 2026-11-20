// 工作人員後台 API（需登入）
import {
  nowTw,
  json,
  HttpError,
  readJson,
  getSettings,
  parseQuestions,
  safeEqual,
  randomToken,
  normName,
  SETTING_KEYS,
  parseTime,
} from './util.js';
import { parseAttendeeCsv, toCsv } from './csv.js';
import { redeemMeal, redeemGift, giftRemaining } from './redeem.js';

const COOKIE = 'bs_admin';
const SESSION_HOURS = 16;

// ---------- 登入 ----------

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sessionSecret(env) {
  // 密碼變更後舊的登入自動失效
  return 'bs-session:' + (env.ENV_NAME || '') + ':' + env.ADMIN_PASSWORD;
}

async function makeSession(env) {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  return exp + '.' + (await hmac(sessionSecret(env), 'admin:' + exp));
}

async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(sessionSecret(env), 'admin:' + exp));
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

// ---------- 路由 ----------

export async function handleAdmin(request, env, path) {
  const db = env.DB;
  const method = request.method;

  if (path === '/api/admin/login' && method === 'POST') {
    const body = await readJson(request);
    if (!env.ADMIN_PASSWORD) throw new HttpError(503, '尚未設定後台密碼（ADMIN_PASSWORD）');
    if (!safeEqual(String(body.password ?? ''), env.ADMIN_PASSWORD)) {
      await new Promise((r) => setTimeout(r, 800)); // 減緩暴力嘗試
      throw new HttpError(401, '密碼錯誤');
    }
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, await makeSession(env), SESSION_HOURS * 3600) });
  }
  if (path === '/api/admin/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, '', 0) });
  }

  if (!(await isAuthed(request, env))) throw new HttpError(401, '請先登入');

  if (path === '/api/admin/dashboard' && method === 'GET') return dashboard(db, env);
  if (path === '/api/admin/checkin' && method === 'POST') return staffCheckin(db, await readJson(request));
  if (path === '/api/admin/undo' && method === 'POST') return undo(db, await readJson(request));
  if (path === '/api/admin/scan' && method === 'POST') return scan(db, await readJson(request));
  if (path === '/api/admin/redeem' && method === 'POST') return staffRedeem(db, await readJson(request));
  if (path === '/api/admin/settings' && method === 'GET') return json({ ok: true, settings: await getSettings(db) });
  if (path === '/api/admin/settings' && method === 'PUT') return saveSettings(db, await readJson(request));
  if (path === '/api/admin/import' && method === 'POST') return importCsv(db, env, await readJson(request));
  if (path === '/api/admin/export' && method === 'GET') return exportCsv(db, new URL(request.url).searchParams.get('type'));
  if (path === '/api/admin/reset' && method === 'POST') return resetRecords(db, env, await readJson(request));
  if (path === '/api/admin/survey-unlock' && method === 'POST') return surveyUnlock(db, await readJson(request));
  throw new HttpError(404, '找不到此功能');
}

// ---------- 監控 ----------

async function dashboard(db, env) {
  const [att, stores, gift] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.name, a.store_id, s.name AS store, a.room, a.table_no, a.note,
                a.checked_in_at, a.checkin_method, a.meal_redeemed_at, a.meal_redeemed_by
         FROM attendees a JOIN stores s ON s.id = a.store_id ORDER BY s.name, a.name`
      )
      .all(),
    db
      .prepare(
        `SELECT s.id, s.name, s.gift_redeemed_at, s.gift_redeemed_by, s.survey_lock_by, s.survey_lock_until,
                (SELECT COUNT(*) FROM attendees a WHERE a.store_id = s.id) AS members,
                (SELECT COUNT(*) FROM attendees a WHERE a.store_id = s.id AND a.checked_in_at IS NOT NULL) AS checked,
                v.submitted_at AS survey_at, va.name AS survey_by,
                la.name AS lock_name
         FROM stores s
         LEFT JOIN surveys v ON v.store_id = s.id
         LEFT JOIN attendees va ON va.id = v.attendee_id
         LEFT JOIN attendees la ON la.id = s.survey_lock_by
         ORDER BY s.name`
      )
      .all(),
    giftRemaining(db),
  ]);
  const now = nowTw();
  const a = att.results;
  const st = stores.results.map((s) => ({
    ...s,
    lock_name: s.survey_lock_until && s.survey_lock_until > now && !s.survey_at ? s.lock_name : null,
  }));
  return json({
    ok: true,
    env: env.ENV_NAME || 'dev',
    now,
    totals: {
      attendees: a.length,
      checked_in: a.filter((x) => x.checked_in_at).length,
      meal: a.filter((x) => x.meal_redeemed_at).length,
      stores: st.length,
      surveys: st.filter((s) => s.survey_at).length,
      gift_stock: gift.stock,
      gift_used: gift.used,
      gift_remaining: gift.remaining,
    },
    attendees: a,
    stores: st,
  });
}

// ---------- 代報到 / 取消 ----------

async function staffCheckin(db, body) {
  const id = Number(body.id);
  const now = nowTw();
  const res = await db
    .prepare(
      `UPDATE attendees SET checked_in_at = ?1, checkin_method = 'staff', rules_agreed_at = ?1
       WHERE id = ?2 AND checked_in_at IS NULL`
    )
    .bind(now, id)
    .run();
  const a = await db.prepare('SELECT id, name, checked_in_at FROM attendees WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, '查無此人');
  return json({ ok: true, status: res.meta.changes ? 'checked_in' : 'already', at: a.checked_in_at, name: a.name });
}

/** 取消誤操作：kind = checkin | meal | gift */
async function undo(db, body) {
  const id = Number(body.id);
  if (body.kind === 'checkin') {
    const a = await db.prepare('SELECT meal_redeemed_at FROM attendees WHERE id = ?1').bind(id).first();
    if (!a) throw new HttpError(404, '查無此人');
    if (a.meal_redeemed_at) throw new HttpError(409, '此人已領餐盒，請先取消餐盒兌換');
    await db
      .prepare('UPDATE attendees SET checked_in_at = NULL, checkin_method = NULL, rules_agreed_at = NULL WHERE id = ?1')
      .bind(id)
      .run();
  } else if (body.kind === 'meal') {
    await db.prepare('UPDATE attendees SET meal_redeemed_at = NULL, meal_redeemed_by = NULL WHERE id = ?1').bind(id).run();
  } else if (body.kind === 'gift') {
    await db.prepare('UPDATE stores SET gift_redeemed_at = NULL, gift_redeemed_by = NULL WHERE id = ?1').bind(id).run();
  } else throw new HttpError(400, '項目錯誤');
  return json({ ok: true });
}

async function surveyUnlock(db, body) {
  await db.prepare('UPDATE stores SET survey_lock_by = NULL, survey_lock_until = NULL WHERE id = ?1').bind(Number(body.id)).run();
  return json({ ok: true });
}

// ---------- 兌換 ----------

async function scan(db, body) {
  const code = String(body.code ?? '').trim();
  const m = code.match(/^([MG]):([A-Za-z0-9_-]{10,64})$/);
  if (!m) return json({ ok: false, kind: null, status: 'invalid' });
  if (m[1] === 'M') {
    const r = await redeemMeal(db, { token: m[2] }, 'scan');
    return json({ ok: r.status === 'redeemed', kind: 'meal', ...r });
  }
  const r = await redeemGift(db, { token: m[2] }, 'scan');
  return json({ ok: r.status === 'redeemed', kind: 'gift', ...r, ...(await giftRemaining(db)) });
}

async function staffRedeem(db, body) {
  const id = Number(body.id);
  if (body.kind === 'meal') {
    const r = await redeemMeal(db, { id }, 'staff');
    return json({ ok: r.status === 'redeemed', kind: 'meal', ...r });
  }
  if (body.kind === 'gift') {
    const r = await redeemGift(db, { id }, 'staff');
    return json({ ok: r.status === 'redeemed', kind: 'gift', ...r });
  }
  throw new HttpError(400, '項目錯誤');
}

// ---------- 設定 ----------

function validTime(v) {
  return v === '' || (parseTime(v) !== null && /\+08:00$/.test(v));
}

function validateQuestions(raw) {
  let q;
  try {
    q = JSON.parse(raw);
  } catch {
    throw new HttpError(400, '問卷題目格式錯誤');
  }
  if (!Array.isArray(q)) throw new HttpError(400, '問卷題目格式錯誤');
  const ids = new Set();
  const out = q.map((x, i) => {
    const type = x.type;
    if (!['rating', 'single', 'text'].includes(type)) throw new HttpError(400, `第 ${i + 1} 題題型錯誤`);
    const label = String(x.label ?? '').trim();
    if (!label) throw new HttpError(400, `第 ${i + 1} 題缺少題目文字`);
    let id = String(x.id || '').trim() || 'q' + (i + 1);
    while (ids.has(id)) id += '_';
    ids.add(id);
    const item = { id, type, label, required: !!x.required };
    if (type === 'single') {
      const options = (x.options || []).map((o) => String(o).trim()).filter(Boolean);
      if (options.length < 2) throw new HttpError(400, `第 ${i + 1} 題至少需要 2 個選項`);
      item.options = [...new Set(options)];
    }
    return item;
  });
  return JSON.stringify(out);
}

async function saveSettings(db, body) {
  const s = body.settings || {};
  const updates = {};
  for (const k of SETTING_KEYS) {
    if (s[k] === undefined) continue;
    let v = String(s[k]);
    if (k.endsWith('_at')) {
      v = v.trim();
      if (!validTime(v)) throw new HttpError(400, '時間格式錯誤');
    } else if (k === 'gift_stock') {
      if (!/^\d{1,5}$/.test(v.trim())) throw new HttpError(400, '贈品數量需為整數');
      v = String(Number(v));
    } else if (k === 'manual_code') {
      if (!/^\d{4}$/.test(v.trim())) throw new HttpError(400, '人工兌換碼需為 4 位數字');
      v = v.trim();
    } else if (k === 'survey_questions') {
      v = validateQuestions(v);
    }
    updates[k] = v;
  }
  const cur = await getSettings(db);
  const merged = { ...cur, ...updates };
  for (const [a, b, label] of [
    ['checkin_open_at', 'checkin_close_at', '報到'],
    ['survey_open_at', 'survey_close_at', '問卷'],
  ]) {
    if (merged[a] && merged[b] && parseTime(merged[a]) >= parseTime(merged[b])) {
      throw new HttpError(400, `${label}結束時間必須晚於開始時間`);
    }
  }
  const stmts = Object.entries(updates).map(([k, v]) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)
  );
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true, settings: await getSettings(db) });
}

// ---------- 匯入匯出 ----------

async function importCsv(db, env, body) {
  const { rows, errors } = parseAttendeeCsv(body.csv || '');
  if (errors.length) return json({ ok: false, error: '名單有錯誤，未匯入任何資料', errors }, 400);
  if (!rows.length) throw new HttpError(400, '名單沒有資料');
  if (body.dryRun) {
    return json({ ok: true, dryRun: true, count: rows.length, stores: new Set(rows.map((r) => r.store)).size });
  }

  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  if (mode === 'replace') {
    if (body.confirm !== '確認清空') throw new HttpError(400, '請輸入「確認清空」');
    const c = await db.prepare('SELECT COUNT(*) AS n FROM attendees WHERE checked_in_at IS NOT NULL').first();
    if (env.ENV_NAME === 'production' && c.n > 0) {
      throw new HttpError(409, `正式站已有 ${c.n} 人報到，不能清空名單。請改用「新增 / 更新」模式。`);
    }
    await db.batch([db.prepare('DELETE FROM surveys'), db.prepare('DELETE FROM attendees'), db.prepare('DELETE FROM stores')]);
  }

  const storeNames = [...new Set(rows.map((r) => r.store))];
  const stmts = [];
  for (const name of storeNames) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO stores (name, gift_token) VALUES (?1, ?2)').bind(name, randomToken()));
  }
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO attendees (name, store_id, room, table_no, note, token)
           VALUES (?1, (SELECT id FROM stores WHERE name = ?2), ?3, ?4, ?5, ?6)
           ON CONFLICT(name, store_id) DO UPDATE SET room = excluded.room, table_no = excluded.table_no, note = excluded.note`
        )
        .bind(normName(r.name), r.store, r.room, r.table_no, r.note, randomToken())
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  const total = await db.prepare('SELECT COUNT(*) AS n FROM attendees').first();
  return json({ ok: true, mode, imported: rows.length, stores: storeNames.length, total: total.n });
}

const METHOD = { self: '自助', staff: '櫃檯', scan: '掃碼', manual: '人工兌換碼' };

async function exportCsv(db, type) {
  let name;
  let csv;
  const stamp = nowTw().slice(0, 16).replace(/[-:T]/g, '');
  if (type === 'attendees') {
    const { results } = await db
      .prepare(
        `SELECT a.*, s.name AS store FROM attendees a JOIN stores s ON s.id = a.store_id ORDER BY s.name, a.name`
      )
      .all();
    name = `報到紀錄_${stamp}.csv`;
    csv = toCsv(
      ['姓名', '店名', '房號', '桌次', '備註', '報到時間', '報到方式', '住宿規範同意時間', '餐盒領取時間', '餐盒兌換方式'],
      results.map((r) => [
        r.name,
        r.store,
        r.room,
        r.table_no,
        r.note,
        r.checked_in_at,
        METHOD[r.checkin_method] || '',
        r.rules_agreed_at,
        r.meal_redeemed_at,
        METHOD[r.meal_redeemed_by] || '',
      ])
    );
  } else if (type === 'surveys') {
    const s = await getSettings(db);
    const qs = parseQuestions(s.survey_questions);
    const { results } = await db
      .prepare(
        `SELECT s.name AS store, a.name AS by_name, v.submitted_at, v.answers
         FROM surveys v JOIN stores s ON s.id = v.store_id JOIN attendees a ON a.id = v.attendee_id ORDER BY v.submitted_at`
      )
      .all();
    const known = new Set(qs.map((q) => q.id));
    const extra = new Set();
    const parsed = results.map((r) => {
      let ans = {};
      try {
        ans = JSON.parse(r.answers);
      } catch {}
      Object.keys(ans).forEach((k) => known.has(k) || extra.add(k));
      return { ...r, ans };
    });
    const cols = [...qs.map((q) => ({ id: q.id, label: q.label })), ...[...extra].map((id) => ({ id, label: id }))];
    name = `問卷_${stamp}.csv`;
    csv = toCsv(
      ['店名', '填寫人', '送出時間', ...cols.map((c) => c.label)],
      parsed.map((r) => [r.store, r.by_name, r.submitted_at, ...cols.map((c) => r.ans[c.id] ?? '')])
    );
  } else if (type === 'stores') {
    const { results } = await db
      .prepare(
        `SELECT s.name, s.gift_redeemed_at, s.gift_redeemed_by,
                (SELECT COUNT(*) FROM attendees a WHERE a.store_id = s.id) AS members,
                (SELECT COUNT(*) FROM attendees a WHERE a.store_id = s.id AND a.checked_in_at IS NOT NULL) AS checked,
                v.submitted_at, va.name AS survey_by
         FROM stores s LEFT JOIN surveys v ON v.store_id = s.id LEFT JOIN attendees va ON va.id = v.attendee_id
         ORDER BY s.name`
      )
      .all();
    name = `店家兌換紀錄_${stamp}.csv`;
    csv = toCsv(
      ['店名', '名單人數', '已報到人數', '問卷填寫人', '問卷送出時間', '贈品兌換時間', '贈品兌換方式'],
      results.map((r) => [
        r.name,
        r.members,
        r.checked,
        r.survey_by,
        r.submitted_at,
        r.gift_redeemed_at,
        METHOD[r.gift_redeemed_by] || '',
      ])
    );
  } else throw new HttpError(400, '匯出類型錯誤');

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  });
}

/** 僅測試站：清空報到、問卷、兌換紀錄（保留名單） */
async function resetRecords(db, env, body) {
  if (env.ENV_NAME === 'production') throw new HttpError(403, '正式站不允許清空紀錄');
  if (body.confirm !== '確認清空') throw new HttpError(400, '請輸入「確認清空」');
  await db.batch([
    db.prepare('DELETE FROM surveys'),
    db.prepare(
      `UPDATE attendees SET checked_in_at = NULL, checkin_method = NULL, rules_agreed_at = NULL,
              meal_redeemed_at = NULL, meal_redeemed_by = NULL, manual_fail_count = 0`
    ),
    db.prepare('UPDATE stores SET gift_redeemed_at = NULL, gift_redeemed_by = NULL, survey_lock_by = NULL, survey_lock_until = NULL'),
  ]);
  return json({ ok: true });
}
