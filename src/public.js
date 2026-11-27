// 參加者端 API
import {
  nowTw,
  windowState,
  json,
  HttpError,
  readJson,
  getSettings,
  parseQuestions,
  normName,
} from './util.js';
import { redeemMeal, redeemGift, giftRemaining } from './redeem.js';

const LOCK_MINUTES = 10;
const SURVEY_GRACE_MINUTES = 10; // 截止前已進入填寫者，截止後 10 分鐘內仍可送出

export async function handlePublic(request, env, path) {
  const db = env.DB;
  const method = request.method;

  if (path === '/api/status' && method === 'GET') return status(db);
  if (path === '/api/identify' && method === 'POST') return identify(db, await readJson(request));
  if (path === '/api/checkin' && method === 'POST') return checkin(db, await readJson(request));
  if (path === '/api/me' && method === 'GET') {
    const t = new URL(request.url).searchParams.get('t') || '';
    return me(db, t);
  }
  if (path === '/api/survey/start' && method === 'POST') return surveyStart(db, await readJson(request));
  if (path === '/api/survey/cancel' && method === 'POST') return surveyCancel(db, await readJson(request));
  if (path === '/api/survey/submit' && method === 'POST') return surveySubmit(db, await readJson(request));
  if (path === '/api/redeem/manual' && method === 'POST') return manualRedeem(db, await readJson(request));
  throw new HttpError(404, '找不到此功能');
}

function checkinWindow(s) {
  return { state: windowState(s.checkin_open_at, s.checkin_close_at), open_at: s.checkin_open_at, close_at: s.checkin_close_at };
}

async function status(db) {
  const s = await getSettings(db);
  return json({ ok: true, now: nowTw(), checkin: checkinWindow(s), survey: surveyWindow(s) });
}

/** 依 token 取得已報到的參加者（含店家），未報到視為無效 */
async function attendeeByToken(db, token) {
  if (!token || typeof token !== 'string' || token.length > 64) throw new HttpError(404, '連結無效，請重新掃碼查詢');
  const a = await db
    .prepare(
      `SELECT a.*, s.name AS store, s.gift_token, s.gift_redeemed_at, s.survey_lock_by, s.survey_lock_until
       FROM attendees a JOIN stores s ON s.id = a.store_id WHERE a.token = ?1`
    )
    .bind(token)
    .first();
  if (!a || !a.checked_in_at) throw new HttpError(404, '連結無效，請重新掃碼查詢');
  return a;
}

/**
 * 查詢姓名（精確比對）。
 * body: { name, id? }  id 為同名多筆時選擇的那一筆
 */
async function identify(db, body) {
  const name = normName(body.name);
  if (!name) throw new HttpError(400, '請輸入姓名');
  if (name.length > 50) throw new HttpError(400, '姓名過長');
  const { results } = await db
    .prepare(
      `SELECT a.id, a.name, s.name AS store, a.checked_in_at, a.token
       FROM attendees a JOIN stores s ON s.id = a.store_id WHERE a.name = ?1 ORDER BY s.name`
    )
    .bind(name)
    .all();
  if (!results.length) return json({ ok: true, status: 'not_found' });

  let pick = null;
  if (body.id !== undefined && body.id !== null) {
    pick = results.find((r) => r.id === Number(body.id));
    if (!pick) throw new HttpError(400, '資料不符，請重新查詢');
  } else if (results.length === 1) {
    pick = results[0];
  } else {
    return json({ ok: true, status: 'choose', options: results.map((r) => ({ id: r.id, store: r.store })) });
  }

  if (pick.checked_in_at) return json({ ok: true, status: 'checked_in', token: pick.token });

  const s = await getSettings(db);
  const w = checkinWindow(s);
  if (w.state !== 'open') return json({ ok: true, status: 'closed', checkin: w });
  return json({
    ok: true,
    status: 'confirm',
    attendee: { id: pick.id, name: pick.name, store: pick.store },
    rules: s.hotel_rules,
    rules_agree: s.hotel_rules_agree,
  });
}

/** 確認報到。body: { id, name, agreed: true } */
async function checkin(db, body) {
  const name = normName(body.name);
  const id = Number(body.id);
  if (body.agreed !== true) throw new HttpError(400, '請先勾選同意酒店住宿規範');
  const a = await db.prepare('SELECT id, name, token, checked_in_at FROM attendees WHERE id = ?1').bind(id).first();
  if (!a || a.name !== name) throw new HttpError(400, '資料不符，請重新查詢');
  if (a.checked_in_at) return json({ ok: true, token: a.token, already: true });

  const s = await getSettings(db);
  const w = checkinWindow(s);
  if (w.state !== 'open') throw new HttpError(403, '目前不在報到開放時間', { checkin: w });

  const now = nowTw();
  await db
    .prepare(
      `UPDATE attendees SET checked_in_at = ?1, checkin_method = 'self', rules_agreed_at = ?1
       WHERE id = ?2 AND checked_in_at IS NULL`
    )
    .bind(now, id)
    .run();
  return json({ ok: true, token: a.token });
}

function surveyWindow(s, ms = Date.now()) {
  return { state: windowState(s.survey_open_at, s.survey_close_at, ms), open_at: s.survey_open_at, close_at: s.survey_close_at };
}

async function storeSurvey(db, storeId) {
  return db
    .prepare(
      `SELECT v.submitted_at, a.name AS by_name, a.id AS by_id
       FROM surveys v JOIN attendees a ON a.id = v.attendee_id WHERE v.store_id = ?1`
    )
    .bind(storeId)
    .first();
}

async function lockHolder(db, a, now) {
  if (!a.survey_lock_by || !a.survey_lock_until || a.survey_lock_until <= now) return null;
  if (a.survey_lock_by === a.id) return { mine: true, name: a.name, until: a.survey_lock_until };
  const h = await db.prepare('SELECT name FROM attendees WHERE id = ?1').bind(a.survey_lock_by).first();
  return { mine: false, name: h ? h.name : '同店夥伴', until: a.survey_lock_until };
}

/** 完成頁資料 */
async function me(db, token) {
  const a = await attendeeByToken(db, token);
  const s = await getSettings(db);
  const now = nowTw();
  const done = await storeSurvey(db, a.store_id);
  const lock = done ? null : await lockHolder(db, a, now);
  const gift = await giftRemaining(db);
  return json({
    ok: true,
    now,
    attendee: {
      name: a.name,
      store: a.store,
      room: a.room,
      table_no: a.table_no,
      transport: a.transport,
      checked_in_at: a.checked_in_at,
    },
    notice: s.notice_text,
    // Buffet 兌換券：無資格時不提供 QR Code
    buffet: a.buffet_eligible
      ? { eligible: true, code: 'M:' + a.token, redeemed_at: a.meal_redeemed_at }
      : { eligible: false },
    survey: {
      ...surveyWindow(s),
      done: done ? { by: done.by_name, at: done.submitted_at, mine: done.by_id === a.id } : null,
      lock: lock ? { mine: lock.mine, by: lock.name } : null,
    },
    gift: done
      ? {
          code: 'G:' + a.gift_token,
          redeemed_at: a.gift_redeemed_at,
          sold_out: !a.gift_redeemed_at && gift.remaining <= 0,
        }
      : null,
  });
}

function addMinutes(iso, min) {
  return nowTw(Date.parse(iso) + min * 60000);
}

/** 進入問卷：取得店家填寫鎖（10 分鐘） */
async function surveyStart(db, body) {
  const a = await attendeeByToken(db, body.t);
  const s = await getSettings(db);
  const w = surveyWindow(s);
  if (w.state !== 'open') {
    return json({ ok: false, status: w.state === 'before' ? 'not_open' : 'closed', survey: w });
  }
  const now = nowTw();
  const until = addMinutes(now, LOCK_MINUTES);
  const res = await db
    .prepare(
      `UPDATE stores SET survey_lock_by = ?1, survey_lock_until = ?2
       WHERE id = ?3
         AND NOT EXISTS (SELECT 1 FROM surveys WHERE store_id = ?3)
         AND (survey_lock_by IS NULL OR survey_lock_by = ?1 OR survey_lock_until IS NULL OR survey_lock_until <= ?4)`
    )
    .bind(a.id, until, a.store_id, now)
    .run();
  if (res.meta.changes > 0) {
    return json({ ok: true, status: 'locked', until, questions: parseQuestions(s.survey_questions) });
  }
  return surveyBlocked(db, a);
}

async function surveyBlocked(db, a) {
  const done = await storeSurvey(db, a.store_id);
  if (done) return json({ ok: false, status: 'done', by: done.by_name, at: done.submitted_at });
  const fresh = await db.prepare('SELECT survey_lock_by, survey_lock_until FROM stores WHERE id = ?1').bind(a.store_id).first();
  const lock = await lockHolder(db, { ...a, ...fresh }, nowTw());
  return json({ ok: false, status: 'locked_by_other', by: lock ? lock.name : '同店夥伴' });
}

/** 離開問卷：釋放自己持有的鎖 */
async function surveyCancel(db, body) {
  const a = await attendeeByToken(db, body.t);
  await db
    .prepare('UPDATE stores SET survey_lock_by = NULL, survey_lock_until = NULL WHERE id = ?1 AND survey_lock_by = ?2')
    .bind(a.store_id, a.id)
    .run();
  return json({ ok: true });
}

function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, '問卷資料格式錯誤');
  const out = {};
  for (const q of questions) {
    let v = answers[q.id];
    if (v === undefined || v === null || v === '') {
      if (q.required) throw new HttpError(400, `請回答「${q.label}」`);
      continue;
    }
    if (q.type === 'rating') {
      v = Number(v);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new HttpError(400, `「${q.label}」請選擇 1–5 分`);
    } else if (q.type === 'single') {
      v = String(v);
      if (!(q.options || []).includes(v)) throw new HttpError(400, `「${q.label}」選項無效`);
    } else {
      v = String(v).trim().slice(0, 1000);
      if (!v && q.required) throw new HttpError(400, `請回答「${q.label}」`);
    }
    out[q.id] = v;
  }
  return out;
}

/** 送出問卷：UNIQUE(store_id) 兜底，後送出者被資料庫拒絕 */
async function surveySubmit(db, body) {
  const a = await attendeeByToken(db, body.t);
  const s = await getSettings(db);
  const now = nowTw();
  const holdsLock = a.survey_lock_by === a.id && a.survey_lock_until && a.survey_lock_until > now;

  const w = surveyWindow(s);
  if (w.state === 'before') return json({ ok: false, status: 'not_open', survey: w });
  if (w.state === 'after') {
    // 截止前已進入填寫且鎖仍有效者，給一點緩衝時間送出
    const graceOk = holdsLock && Date.now() < Date.parse(s.survey_close_at) + SURVEY_GRACE_MINUTES * 60000;
    if (!graceOk) return json({ ok: false, status: 'closed', survey: w });
  }

  const other = await lockHolder(db, a, now);
  if (other && !other.mine) return surveyBlocked(db, a);

  const answers = validateAnswers(parseQuestions(s.survey_questions), body.answers);
  try {
    await db.batch([
      db
        .prepare('INSERT INTO surveys (store_id, attendee_id, answers, submitted_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(a.store_id, a.id, JSON.stringify(answers), now),
      db.prepare('UPDATE stores SET survey_lock_by = NULL, survey_lock_until = NULL WHERE id = ?1').bind(a.store_id),
    ]);
  } catch (e) {
    if (String(e.message || e).includes('UNIQUE')) return surveyBlocked(db, a);
    throw e;
  }
  return json({ ok: true, status: 'submitted', at: now });
}

/**
 * 參加者畫面上的「人工兌換」：跳出「是否確認兌換？請由工作人員操作」，
 * 工作人員按下確認後送出（confirm: true）。kind = meal（Buffet）| gift
 */
async function manualRedeem(db, body) {
  const a = await attendeeByToken(db, body.t);
  const kind = body.kind;
  if (kind !== 'meal' && kind !== 'gift') throw new HttpError(400, '兌換項目錯誤');
  if (body.confirm !== true) throw new HttpError(400, '請由工作人員確認兌換');
  const r = kind === 'meal' ? await redeemMeal(db, { id: a.id }, 'manual') : await redeemGift(db, { id: a.store_id }, 'manual');
  return json({ ok: r.status === 'redeemed', ...r });
}
