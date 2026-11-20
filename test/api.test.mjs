// API 整合測試（含並發）：對本機 wrangler dev 或「測試站」執行，絕對不要對正式站執行。
//   npm run dev                       # 另一個終端機
//   npm test                          # 預設 BASE=http://127.0.0.1:8787、ADMIN_PASSWORD 取自 .dev.vars
//   BASE=https://test-checkin.xxx ADMIN_PASSWORD=... npm test
// 測試會先「清空測試紀錄」並修改設定，結束後還原設定。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let PW = process.env.ADMIN_PASSWORD;
if (!PW) {
  try {
    PW = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/ADMIN_PASSWORD\s*=\s*"?([^"\n]+)/)[1];
  } catch {}
}
let cookie = '';
let original;

async function call(path, body, method) {
  const res = await fetch(BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, ...(await res.json()) };
}
const admin = (p, b, m) => call('/api/admin/' + p, b, m);
const iso = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';

async function checkinByName(name, store) {
  let r = await call('/api/identify', { name });
  if (r.status === 'choose') r = await call('/api/identify', { name, id: r.options.find((o) => o.store === store).id });
  if (r.status === 'checked_in') return r.token;
  assert.equal(r.status, 'confirm');
  const c = await call('/api/checkin', { id: r.attendee.id, name, agreed: true });
  assert.ok(c.token);
  return c.token;
}

before(async () => {
  assert.ok(PW, '需要 ADMIN_PASSWORD');
  const l = await admin('login', { password: PW });
  assert.equal(l.ok, true);
  const d = await admin('dashboard');
  assert.notEqual(d.env, 'production', '禁止對正式站執行測試');
  original = (await admin('settings')).settings;
  await admin('reset', { confirm: '確認清空' });
  await admin('settings', {
    settings: { checkin_open_at: '', checkin_close_at: '', survey_open_at: iso(Date.now() - 3600e3), survey_close_at: iso(Date.now() + 3600e3), gift_stock: '50' },
  }, 'PUT');
});

after(async () => {
  if (original) await admin('settings', { settings: original }, 'PUT');
  await admin('reset', { confirm: '確認清空' });
});

test('姓名精確比對、同名選店、查無資料', async () => {
  assert.equal((await call('/api/identify', { name: '王小' })).status, 'not_found');
  const r = await call('/api/identify', { name: '　王小明 ' });
  assert.equal(r.status, 'choose');
  assert.equal(r.options.length, 2);
});

test('未勾選規範不能報到；已報到再查詢回到同一 token', async () => {
  const r = await call('/api/identify', { name: '賴怡君' });
  const bad = await call('/api/checkin', { id: r.attendee.id, name: '賴怡君', agreed: false });
  assert.equal(bad.status, 400);
  const t1 = await checkinByName('賴怡君');
  const t2 = await checkinByName('賴怡君');
  assert.equal(t1, t2);
  assert.ok(t1.length >= 20);
});

test('報到時間外不能報到', async () => {
  await admin('settings', { settings: { checkin_open_at: iso(Date.now() + 3600e3) } }, 'PUT');
  const r = await call('/api/identify', { name: '邱建宏' });
  assert.equal(r.status, 'closed');
  await admin('settings', { settings: { checkin_open_at: '' } }, 'PUT');
});

test('餐盒：未報到不能領；10 次並發掃碼只成功 1 次', async () => {
  const d = await admin('dashboard');
  const p = d.attendees.find((a) => a.name === '郭雅婷');
  const no = await admin('redeem', { kind: 'meal', id: p.id });
  assert.equal(no.status, 'not_checked_in');
  const t = await checkinByName('郭雅婷');
  const rs = await Promise.all(Array.from({ length: 10 }, () => admin('scan', { code: 'M:' + t })));
  assert.equal(rs.filter((r) => r.status === 'redeemed').length, 1);
  assert.equal(rs.filter((r) => r.status === 'already').length, 9);
});

test('問卷：同店填寫鎖、後送出者被拒、本店已完成', async () => {
  const a = await checkinByName('林雅婷', '大安輪胎行');
  const b = await checkinByName('廖俊傑');
  const sa = await call('/api/survey/start', { t: a });
  assert.equal(sa.status, 'locked');
  const sb = await call('/api/survey/start', { t: b });
  assert.equal(sb.status, 'locked_by_other');
  assert.equal(sb.by, '林雅婷');
  const subB = await call('/api/survey/submit', { t: b, answers: { q1: 5, q2: '晚宴' } });
  assert.equal(subB.status, 'locked_by_other');
  const subA = await call('/api/survey/submit', { t: a, answers: { q1: 4, q2: '晚宴', q3: '很好' } });
  assert.equal(subA.status, 'submitted');
  const again = await call('/api/survey/start', { t: b });
  assert.equal(again.status, 'done');
  assert.equal(again.by, '林雅婷');
  const me = await call('/api/me?t=' + encodeURIComponent(b));
  assert.ok(me.gift && me.gift.code.startsWith('G:'));
});

test('問卷：鎖已釋放時兩人同時送出，資料庫只收 1 份', async () => {
  const a = await checkinByName('劉冠廷');
  const b = await checkinByName('賴俊傑');
  const rs = await Promise.all([
    call('/api/survey/submit', { t: a, answers: { q1: 3, q2: '大會議程' } }),
    call('/api/survey/submit', { t: b, answers: { q1: 2, q2: '住宿安排' } }),
  ]);
  assert.equal(rs.filter((r) => r.status === 'submitted').length, 1);
  assert.equal(rs.filter((r) => r.status === 'done').length, 1);
});

test('問卷：必填驗證、未開放', async () => {
  const t = await checkinByName('賴冠廷', '新竹車業');
  const r = await call('/api/survey/submit', { t, answers: { q1: 9 } });
  assert.equal(r.status, 400);
  await admin('settings', { settings: { survey_open_at: iso(Date.now() + 3600e3), survey_close_at: iso(Date.now() + 7200e3) } }, 'PUT');
  assert.equal((await call('/api/survey/start', { t })).status, 'not_open');
  await admin('settings', { settings: { survey_open_at: iso(Date.now() - 3600e3), survey_close_at: iso(Date.now() + 3600e3) } }, 'PUT');
});

test('贈品：未填問卷不能領；限量 1 份時兩店並發只成功 1 次；重複掃顯示已兌換', async () => {
  const t1 = await checkinByName('李佳穎');
  const s1 = await call('/api/me?t=' + encodeURIComponent(t1));
  assert.equal(s1.gift, null);
  await call('/api/survey/submit', { t: t1, answers: { q1: 5, q2: '晚宴' } });
  const t2 = await checkinByName('李郁婷');
  await call('/api/survey/submit', { t: t2, answers: { q1: 5, q2: '晚宴' } });
  const d = await admin('dashboard');
  await admin('settings', { settings: { gift_stock: String(d.totals.gift_used + 1) } }, 'PUT');
  const g1 = (await call('/api/me?t=' + encodeURIComponent(t1))).gift.code;
  const g2 = (await call('/api/me?t=' + encodeURIComponent(t2))).gift.code;
  const rs = await Promise.all([admin('scan', { code: g1 }), admin('scan', { code: g2 })]);
  assert.equal(rs.filter((r) => r.status === 'redeemed').length, 1);
  assert.equal(rs.filter((r) => r.status === 'sold_out').length, 1);
  const winner = rs[0].status === 'redeemed' ? g1 : g2;
  assert.equal((await admin('scan', { code: winner })).status, 'already');
  await admin('settings', { settings: { gift_stock: '50' } }, 'PUT');
});

test('人工兌換碼：錯誤 5 次鎖定', async () => {
  const t = await checkinByName('楊郁婷');
  for (let i = 0; i < 5; i++) {
    const r = await call('/api/redeem/manual', { t, kind: 'meal', code: '9999' });
    assert.equal(r.status, 403);
  }
  const r = await call('/api/redeem/manual', { t, kind: 'meal', code: original.manual_code });
  assert.equal(r.status, 429);
});

test('無效 QR、無效 token、未登入', async () => {
  assert.equal((await admin('scan', { code: 'hello' })).status, 'invalid');
  assert.equal((await admin('scan', { code: 'M:xxxxxxxxxxxxxxxxxxxx' })).status, 'not_found');
  assert.equal((await call('/api/me?t=nope')).status, 404);
  const saved = cookie;
  cookie = '';
  assert.equal((await admin('dashboard')).status, 401);
  cookie = saved;
});

test('CSV 匯入檢查', async () => {
  const bad = await admin('import', { csv: '姓名,店名\n王一,\n', dryRun: true });
  assert.equal(bad.status, 400);
  const ok = await admin('import', { csv: '﻿姓名,店名,房號,桌次,備註\n王一,"新店, 測試",101,9,\n', dryRun: true });
  assert.equal(ok.count, 1);
});
