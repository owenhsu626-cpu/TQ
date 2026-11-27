// 工作人員後台
(function () {
  const { api, esc, hm, mdhm, toast } = window.BS;
  const $ = (id) => document.getElementById(id);
  const METHOD = { self: '自助', staff: '櫃檯', scan: '掃碼', manual: '人工兌換' };

  let D = null; // dashboard 資料
  let lastRaw = '';
  let tab = 'overview';
  let filter = 'absent';
  let limit = 200;
  let pollTimer = null;
  let settings = null;
  let questions = [];

  // ---------- 登入 ----------
  function showLogin() {
    stopPoll();
    stopCamera();
    $('app').hidden = true;
    $('login').hidden = false;
    setTimeout(() => $('pw').focus(), 50);
  }

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('loginErr').hidden = true;
    $('loginBtn').disabled = true;
    try {
      await api('/api/admin/login', { body: { password: $('pw').value } });
      $('pw').value = '';
      start();
    } catch (e) {
      $('loginErr').textContent = e.message;
      $('loginErr').hidden = false;
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { body: {} }).catch(() => {});
    showLogin();
  });

  async function guard(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401) showLogin();
      else toast(e.message, true);
      throw e;
    }
  }

  // ---------- 資料同步（每 5 秒） ----------
  async function refresh() {
    try {
      const res = await fetch('/api/admin/dashboard', { credentials: 'same-origin' });
      if (res.status === 401) return showLogin();
      if (!res.ok) throw new Error();
      const raw = await res.text();
      $('sync').innerHTML = '<span class="lbl">已同步 </span>' + new Date().toLocaleTimeString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
      $('sync').classList.remove('err');
      if (raw === lastRaw) return;
      lastRaw = raw;
      D = JSON.parse(raw);
      renderAll();
    } catch {
      $('sync').textContent = '連線中斷，重試中…';
      $('sync').classList.add('err');
    }
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => document.visibilityState === 'visible' && refresh(), 5000);
  }
  function stopPoll() {
    clearInterval(pollTimer);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('app').hidden) refresh();
  });

  async function start() {
    $('login').hidden = true;
    lastRaw = '';
    await refresh();
    if (!D) return;
    $('app').hidden = false;
    const env = D.env;
    $('envBadge').textContent = env === 'production' ? '正式站' : env === 'test' ? '測試站' : '本機';
    $('envBadge').className = 'env ' + env;
    $('resetCard').hidden = env === 'production';
    initBuffetQr();
    document.title = $('envBadge').textContent + '｜報到後台';
    startPoll();
  }

  // ---------- 分頁 ----------
  document.querySelector('.tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + t));
    if (t !== 'scan') stopCamera();
    if (t === 'settings') loadSettings();
    renderAll();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    if (!D) return;
    renderStats();
    if (tab === 'people') renderPeople();
    if (tab === 'stores') renderStores();
  }

  // ---------- 總覽 ----------
  function pct(a, b) {
    return b ? Math.round((a / b) * 100) : 0;
  }
  function renderStats() {
    const t = D.totals;
    const r = pct(t.checked_in, t.attendees);
    $('stats').innerHTML = `
      <div class="stat"><p class="stat-label">報到人數</p>
        <p class="stat-num">${t.checked_in}<small> / ${t.attendees}</small></p>
        <div class="bar"><i style="width:${r}%"></i></div><p class="stat-sub">報到率 ${r}%・未到 ${t.attendees - t.checked_in} 人</p></div>
      <div class="stat"><p class="stat-label">Buffet 兌換券</p>
        <p class="stat-num">${t.meal}<small> / ${t.buffet_ready}</small></p>
        <div class="bar"><i style="width:${pct(t.meal, t.buffet_ready)}%"></i></div><p class="stat-sub">已兌換 / 有資格且已報到（有資格共 ${t.buffet_eligible} 人）</p></div>
      <div class="stat"><p class="stat-label">問卷（店家）</p>
        <p class="stat-num">${t.surveys}<small> / ${t.stores}</small></p>
        <div class="bar"><i style="width:${pct(t.surveys, t.stores)}%"></i></div><p class="stat-sub">已填店家 / 總店家數</p></div>
      <div class="stat"><p class="stat-label">贈品</p>
        <p class="stat-num">${t.gift_used}<small> / ${t.gift_stock}</small></p>
        <div class="bar"><i style="width:${pct(t.gift_used, t.gift_stock)}%"></i></div><p class="stat-sub">剩餘庫存 <strong>${t.gift_remaining}</strong> 份</p></div>`;
    $('cAbsent').textContent = t.attendees - t.checked_in;
    $('cPresent').textContent = t.checked_in;
    $('cAll').textContent = t.attendees;

    if (tab === 'overview') {
      const recent = D.attendees.filter((a) => a.checked_in_at).sort((a, b) => (a.checked_in_at < b.checked_in_at ? 1 : -1)).slice(0, 12);
      $('recent').innerHTML = recent.length
        ? `<table class="tbl"><thead><tr><th>時間</th><th>姓名</th><th>店名</th><th>房號</th><th>桌次</th><th>交通</th><th>方式</th></tr></thead><tbody>` +
          recent
            .map(
              (a) => `<tr><td class="c-status num">${esc(hm(a.checked_in_at))}</td><td class="c-name">${esc(a.name)}</td>
              <td class="c-wide">${esc(a.store)}</td><td data-l="房號">${esc(a.room)}</td><td data-l="桌次">${esc(a.table_no)}</td>
              <td data-l="交通">${esc(a.transport || '')}</td><td data-l="方式">${METHOD[a.checkin_method] || ''}</td></tr>`
            )
            .join('') +
          `</tbody></table>`
        : '<p class="muted">尚無人報到</p>';
    }
    fillSelect($('fStore'), [...new Set(D.attendees.map((a) => a.store))], '全部店家');
    fillSelect(
      $('fTable'),
      [...new Set(D.attendees.map((a) => a.table_no).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-TW', { numeric: true })),
      '全部桌次',
      (v) => v + ' 桌'
    );
    fillSelect(
      $('fTransport'),
      [...new Set(D.attendees.map((a) => a.transport).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-TW', { numeric: true })),
      '全部交通方式'
    );
  }

  function fillSelect(sel, values, allLabel, fmt = (v) => v) {
    const key = values.join('\u0001');
    if (sel.dataset.key === key) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(fmt(v))}</option>`).join('');
    sel.value = values.includes(cur) ? cur : '';
    sel.dataset.key = key;
  }

  // ---------- 名單 ----------
  document.querySelector('.seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    limit = 200;
    renderPeople();
  });
  ['q', 'fStore', 'fTable', 'fTransport'].forEach((id) =>
    $(id).addEventListener('input', () => {
      limit = 200;
      renderPeople();
    })
  );

  function renderPeople() {
    if (!D) return;
    const q = $('q').value.trim().toLowerCase();
    const st = $('fStore').value;
    const tb = $('fTable').value;
    const tr = $('fTransport').value;
    let list = D.attendees.filter((a) => {
      if (filter === 'absent' && a.checked_in_at) return false;
      if (filter === 'present' && !a.checked_in_at) return false;
      if (st && a.store !== st) return false;
      if (tb && String(a.table_no) !== tb) return false;
      if (tr && a.transport !== tr) return false;
      if (q && !`${a.name} ${a.store} ${a.room} ${a.transport || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (filter === 'present') list.sort((a, b) => (a.checked_in_at < b.checked_in_at ? 1 : -1));
    const total = list.length;
    list = list.slice(0, limit);
    if (!total) {
      $('peopleList').innerHTML = `<div class="empty">${filter === 'absent' && !q && !st && !tb && !tr ? '全部都已報到 🎉' : '沒有符合的資料'}</div>`;
      return;
    }
    $('peopleList').innerHTML =
      `<table class="tbl"><thead><tr><th>姓名</th><th>狀態</th><th>店名</th><th>房號</th><th>桌次</th><th>交通</th><th>Buffet</th><th>備註</th><th class="acts">操作</th></tr></thead><tbody>` +
      list.map(personRow).join('') +
      `</tbody></table>` +
      (total > limit ? `<div class="more"><button class="btn ghost small" type="button" data-more>顯示更多（共 ${total} 筆）</button></div>` : '');
  }

  function personRow(a) {
    const status = a.checked_in_at
      ? `<span class="pill done">已報到 ${esc(hm(a.checked_in_at))}</span>`
      : `<span class="pill no">未到</span>`;
    const meal = !a.buffet_eligible
      ? `<span class="pill no">無資格</span>`
      : a.meal_redeemed_at
      ? `<span class="pill done">已兌換 ${esc(hm(a.meal_redeemed_at))}</span>`
      : a.checked_in_at
      ? `<span class="pill warn">未兌換</span>`
      : '<span class="muted small">有資格</span>';
    let acts = '';
    if (!a.checked_in_at) acts += `<button class="btn small" data-act="checkin" data-id="${a.id}">代報到</button>`;
    else {
      if (a.buffet_eligible && !a.meal_redeemed_at) acts += `<button class="btn small" data-act="meal" data-id="${a.id}">兌換 Buffet</button>`;
      else if (a.meal_redeemed_at) acts += `<button class="btn ghost small" data-act="undo-meal" data-id="${a.id}">取消 Buffet</button>`;
      acts += `<button class="btn ghost small" data-act="undo-checkin" data-id="${a.id}">取消報到</button>`;
    }
    return `<tr>
      <td class="c-name">${esc(a.name)}</td>
      <td class="c-status">${status}</td>
      <td class="c-wide" data-l="店名">${esc(a.store)}${a.is_staff ? ' <span class="pill no">公司人員</span>' : ''}</td>
      <td class="num" data-l="房號">${esc(a.room || '—')}</td>
      <td class="num" data-l="桌次">${esc(a.table_no || '—')}</td>
      <td data-l="交通">${esc(a.transport || '—')}</td>
      <td data-l="Buffet">${meal}</td>
      <td class="c-wide" ${a.note ? 'data-l="備註"' : ''}>${esc(a.note || '')}</td>
      <td class="acts">${acts}</td></tr>`;
  }

  // ---------- 店家 ----------
  $('qStore').addEventListener('input', renderStores);
  function renderStores() {
    if (!D) return;
    const q = $('qStore').value.trim();
    const list = D.stores.filter((s) => !q || s.name.includes(q));
    if (!list.length) {
      $('storeList').innerHTML = '<div class="empty">沒有符合的店家</div>';
      return;
    }
    $('storeList').innerHTML =
      `<table class="tbl"><thead><tr><th>店名</th><th>贈品</th><th>報到</th><th>問卷</th><th class="acts">操作</th></tr></thead><tbody>` +
      list
        .map((s) => {
          const survey = s.survey_at
            ? `<span class="pill done">${esc(s.survey_by)} ${esc(hm(s.survey_at))}</span>`
            : s.lock_name
            ? `<span class="pill warn">${esc(s.lock_name)} 填寫中</span>`
            : '<span class="pill no">未填</span>';
          const gift = s.gift_redeemed_at
            ? `<span class="pill done">已兌換 ${esc(hm(s.gift_redeemed_at))}</span>`
            : s.survey_at
            ? '<span class="pill warn">可兌換</span>'
            : '<span class="pill no">未開放</span>';
          let acts = '';
          if (s.survey_at && !s.gift_redeemed_at) acts += `<button class="btn small" data-act="gift" data-id="${s.id}">兌換贈品</button>`;
          if (s.gift_redeemed_at) acts += `<button class="btn ghost small" data-act="undo-gift" data-id="${s.id}">取消兌換</button>`;
          if (s.lock_name) acts += `<button class="btn ghost small" data-act="unlock" data-id="${s.id}">解除填寫鎖</button>`;
          return `<tr><td class="c-name">${esc(s.name)}</td><td class="c-status">${gift}</td>
            <td data-l="報到">${s.checked} / ${s.members}</td><td class="c-wide" data-l="問卷">${survey}</td><td class="acts">${acts}</td></tr>`;
        })
        .join('') +
      `</tbody></table>`;
  }

  // ---------- 操作 ----------
  const REDEEM_MSG = {
    redeemed: '兌換成功',
    already: (r) => `已於 ${hm(r.at)} 兌換`,
    not_checked_in: '尚未報到，不能兌換 Buffet',
    not_eligible: '沒有 Buffet 兌換券',
    no_survey: '本店尚未填寫問卷',
    sold_out: '贈品已兌換完畢',
    not_found: '查無資料',
  };
  function redeemText(r) {
    const m = REDEEM_MSG[r.status];
    return typeof m === 'function' ? m(r) : m || '無法兌換';
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act], [data-more]');
    if (!b) return;
    if (b.dataset.more !== undefined) {
      limit += 200;
      return renderPeople();
    }
    const id = Number(b.dataset.id);
    const act = b.dataset.act;
    const a = D.attendees.find((x) => x.id === id);
    const s = D.stores.find((x) => x.id === id);
    const confirms = {
      checkin: a && `確認幫「${a.name}（${a.store}）」代為報到？\n請先向本人說明酒店住宿規範。`,
      'undo-checkin': a && `取消「${a.name}」的報到紀錄？`,
      meal: a && `確認兌換「${a.name}（${a.store}）」的 Buffet 兌換券？`,
      'undo-meal': a && `取消「${a.name}」的 Buffet 兌換紀錄？`,
      gift: s && `確認兌換「${s.name}」的店家贈品？`,
      'undo-gift': s && `取消「${s.name}」的贈品兌換紀錄？（庫存會加回 1）`,
      unlock: s && `解除「${s.name}」的問卷填寫鎖？（正在填寫的人送出時仍會成功）`,
    };
    if (confirms[act] && !confirm(confirms[act])) return;
    b.disabled = true;
    try {
      await guard(async () => {
        if (act === 'checkin') {
          const r = await api('/api/admin/checkin', { body: { id } });
          toast(r.status === 'checked_in' ? `${r.name} 報到完成` : `${r.name} 已於 ${hm(r.at)} 報到`);
        } else if (act === 'meal' || act === 'gift') {
          const r = await api('/api/admin/redeem', { body: { kind: act, id } });
          toast(redeemText(r), r.status !== 'redeemed');
        } else if (act.startsWith('undo-')) {
          await api('/api/admin/undo', { body: { kind: act.slice(5), id } });
          toast('已取消');
        } else if (act === 'unlock') {
          await api('/api/admin/survey-unlock', { body: { id } });
          toast('已解除');
        }
      });
    } catch {}
    b.disabled = false;
    lastRaw = '';
    refresh();
  });

  // ---------- 掃碼 ----------
  let scanner = null;
  let lastCode = '';
  let lastAt = 0;
  let busy = false;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  $('camStart').addEventListener('click', async () => {
    try {
      await loadScript('/vendor/html5-qrcode.min.js');
      scanner = new Html5Qrcode('reader', { verbose: false });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
        onScan,
        () => {}
      );
      $('camStart').hidden = true;
      $('camStop').hidden = false;
    } catch (e) {
      scanner = null;
      showResult('bad', '無法開啟相機', '', '請允許瀏覽器使用相機，或改用名單頁直接兌換');
    }
  });
  $('camStop').addEventListener('click', stopCamera);

  function stopCamera() {
    if (scanner) {
      const s = scanner;
      scanner = null;
      s.stop().catch(() => {}).finally(() => s.clear && s.clear());
    }
    $('camStart').hidden = false;
    $('camStop').hidden = true;
  }

  async function onScan(code) {
    const now = Date.now();
    if (busy || (code === lastCode && now - lastAt < 4000)) return;
    busy = true;
    lastCode = code;
    lastAt = now;
    try {
      const r = await guard(() => api('/api/admin/scan', { body: { code } }));
      const kind = r.kind === 'meal' ? 'Buffet' : r.kind === 'gift' ? '贈品' : '';
      const who = r.kind === 'meal' ? `${r.name || ''}｜${r.store || ''}` : r.store || '';
      if (r.status === 'invalid') showResult('bad', '無法辨識的 QR Code', '', '請確認是本活動的 Buffet 兌換券或贈品 QR Code');
      else if (r.status === 'redeemed')
        showResult('ok', `${kind}兌換成功`, who, r.kind === 'gift' ? `剩餘贈品 ${r.remaining} 份` : `桌次 ${r.table_no || '—'}・房號 ${r.room || '—'}`);
      else if (r.status === 'already') showResult('warn', `${kind}已於 ${hm(r.at)} 兌換`, who, '請勿重複發放');
      else showResult('bad', redeemText(r), who, kind);
      log(`${new Date().toLocaleTimeString('zh-TW', { hour12: false })} ${kind} ${who} — ${r.status === 'redeemed' ? '成功' : redeemText(r)}`);
      if (navigator.vibrate) navigator.vibrate(r.status === 'redeemed' ? 80 : [60, 60, 60]);
      lastRaw = '';
      refresh();
    } catch {
    } finally {
      setTimeout(() => (busy = false), 1200);
    }
  }

  function showResult(cls, title, who, sub) {
    $('scanResult').className = 'scan-result ' + cls;
    $('scanResult').innerHTML = `<p class="sr-title">${esc(title)}</p>${who ? `<p class="sr-who">${esc(who)}</p>` : ''}${sub ? `<p class="sr-sub">${esc(sub)}</p>` : ''}`;
  }
  function log(text) {
    const li = document.createElement('li');
    li.textContent = text;
    $('scanLog').prepend(li);
    while ($('scanLog').children.length > 50) $('scanLog').lastChild.remove();
  }

  // ---------- 匯入 ----------
  let csvText = '';
  async function readCsvFile(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('big5').decode(buf); // Excel 繁中預設編碼
    }
  }
  $('csvFile').addEventListener('change', async () => {
    const f = $('csvFile').files[0];
    $('importBtn').disabled = true;
    $('importInfo').hidden = true;
    if (!f) return;
    csvText = await readCsvFile(f);
    try {
      const r = await api('/api/admin/import', { body: { csv: csvText, dryRun: true } });
      info(`檔案檢查通過：${r.count} 人、${r.stores} 家店。確認匯入方式後按「匯入」。`);
      $('importBtn').disabled = false;
    } catch (e) {
      if (e.status === 401) return showLogin();
      info(e.message + (e.data && e.data.errors ? '\n' + e.data.errors.slice(0, 20).join('\n') : ''), true);
    }
  });
  function info(text, isErr) {
    $('importInfo').className = 'alert' + (isErr ? ' error' : '');
    $('importInfo').style.whiteSpace = 'pre-line';
    $('importInfo').textContent = text;
    $('importInfo').hidden = false;
  }
  $('importBtn').addEventListener('click', async () => {
    const mode = document.querySelector('input[name=mode]:checked').value;
    let confirmText;
    if (mode === 'replace') {
      confirmText = prompt('「清空後匯入」會刪除所有名單、報到、問卷與兌換紀錄。\n請輸入「確認清空」繼續：');
      if (confirmText !== '確認清空') return;
    } else if (!confirm('確認匯入名單？')) return;
    $('importBtn').disabled = true;
    try {
      const r = await guard(() => api('/api/admin/import', { body: { csv: csvText, mode, confirm: confirmText } }));
      info(`匯入完成：本次 ${r.imported} 人、${r.stores} 家店；目前名單共 ${r.total} 人。`);
      $('csvFile').value = '';
      lastRaw = '';
      refresh();
    } catch (e) {
      info(e.message, true);
      $('importBtn').disabled = false;
    }
  });

  $('resetBtn').addEventListener('click', async () => {
    const c = prompt('清空所有報到、問卷、Buffet 與贈品兌換紀錄（保留名單）。\n請輸入「確認清空」繼續：');
    if (c !== '確認清空') return;
    try {
      await guard(() => api('/api/admin/reset', { body: { confirm: c } }));
      toast('已清空測試紀錄');
      lastRaw = '';
      refresh();
    } catch {}
  });

  // ---------- Buffet 統一入口 QR Code ----------
  const BUFFET_URL = location.origin + '/buffet';
  function qrMatrix(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr;
  }
  function drawQr(ctx, qr, x, y, size) {
    const n = qr.getModuleCount();
    const cell = size / n;
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) ctx.fillRect(Math.floor(x + c * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
  }
  function download(canvas, name) {
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
    }, 'image/png');
  }
  function loadImg(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  }
  function initBuffetQr() {
    $('bqUrl').textContent = BUFFET_URL;
    $('bqUrl').href = BUFFET_URL;
    $('bqPreview').innerHTML = BS.qrSvg(BUFFET_URL);
  }
  $('bqPng').addEventListener('click', () => {
    const qr = qrMatrix(BUFFET_URL);
    const size = 1200;
    const margin = 120;
    const c = document.createElement('canvas');
    c.width = c.height = size + margin * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    drawQr(ctx, qr, margin, margin, size);
    download(c, 'buffet-entry-qrcode.png');
  });
  $('bqPoster').addEventListener('click', async () => {
    const W = 2480, H = 3508; // A4 300dpi
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    try {
      const [strip, logo] = await Promise.all([loadImg('/assets/strip-top.jpg'), loadImg('/assets/logo.png')]);
      const sh = 300;
      for (let x = 0; x < W; x += (strip.width * sh) / strip.height) ctx.drawImage(strip, x, 0, (strip.width * sh) / strip.height, sh);
      const bottom = await loadImg('/assets/strip-bottom.jpg');
      const bh = 360;
      for (let x = 0; x < W; x += (bottom.width * bh) / bottom.height) ctx.drawImage(bottom, x, H - bh, (bottom.width * bh) / bottom.height, bh);
      const lw = 1100;
      ctx.drawImage(logo, (W - lw) / 2, 470, lw, (logo.height * lw) / logo.width);
    } catch {}
    await document.fonts.ready.catch(() => {});
    const font = (w, px) => `${w} ${px}px 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e60013';
    ctx.font = font(700, 230);
    ctx.fillText('Buffet 兌換', W / 2, 920);
    ctx.fillStyle = '#000';
    ctx.font = font(400, 96);
    ctx.fillText('請用手機相機掃描 QR Code', W / 2, 1100);
    const qs = 1600;
    drawQr(ctx, qrMatrix(BUFFET_URL), (W - qs) / 2, 1250, qs);
    ctx.font = font(400, 80);
    ctx.fillStyle = '#4a5963';
    ctx.fillText('出示您的 Buffet 兌換券給工作人員', W / 2, 3000);
    ctx.font = font(300, 52);
    ctx.fillText(BUFFET_URL.replace(/^https?:\/\//, ''), W / 2, 3090);
    download(c, 'buffet-poster-A4.png');
  });

  // ---------- 設定 ----------
  const toLocal = (iso) => (iso ? iso.slice(0, 16) : '');
  const fromLocal = (v) => (v ? v.slice(0, 16) + ':00+08:00' : '');

  async function loadSettings() {
    try {
      const r = await guard(() => api('/api/admin/settings'));
      settings = r.settings;
      fillSettings();
    } catch {}
  }
  function fillSettings() {
    const f = $('settingsForm');
    for (const el of f.querySelectorAll('[name]')) {
      const v = settings[el.name] ?? '';
      el.value = el.type === 'datetime-local' ? toLocal(v) : v;
    }
    try {
      questions = JSON.parse(settings.survey_questions || '[]');
    } catch {
      questions = [];
    }
    renderQuestions();
    $('settingsErr').hidden = true;
  }

  function renderQuestions() {
    $('qEditor').innerHTML = questions
      .map(
        (q, i) => `<div class="qe" data-i="${i}">
        <div class="qe-row">
          <strong>${i + 1}.</strong>
          <select class="input" data-k="type" aria-label="題型">
            <option value="rating" ${q.type === 'rating' ? 'selected' : ''}>評分 1–5</option>
            <option value="single" ${q.type === 'single' ? 'selected' : ''}>單選</option>
            <option value="text" ${q.type === 'text' ? 'selected' : ''}>簡答</option>
          </select>
          <input class="input qe-label" data-k="label" value="${esc(q.label)}" placeholder="題目文字" aria-label="題目文字">
          <label class="qe-req"><input type="checkbox" data-k="required" ${q.required ? 'checked' : ''}>必填</label>
          <button class="btn ghost small" type="button" data-q="up" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button class="btn ghost small" type="button" data-q="down" ${i === questions.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          <button class="btn ghost small" type="button" data-q="del" aria-label="刪除">刪除</button>
        </div>
        ${q.type === 'single' ? `<textarea class="input" data-k="options" rows="3" placeholder="選項，一行一個">${esc((q.options || []).join('\n'))}</textarea>` : ''}
      </div>`
      )
      .join('') || '<p class="muted">尚無題目</p>';
  }
  $('qEditor').addEventListener('input', (ev) => {
    const box = ev.target.closest('.qe');
    const k = ev.target.dataset.k;
    if (!box || !k) return;
    const q = questions[Number(box.dataset.i)];
    if (k === 'required') q.required = ev.target.checked;
    else if (k === 'options') q.options = ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (k === 'type') {
      q.type = ev.target.value;
      if (q.type === 'single' && !q.options) q.options = ['選項一', '選項二'];
      renderQuestions();
    } else q[k] = ev.target.value;
  });
  $('qEditor').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-q]');
    if (!b) return;
    const i = Number(b.closest('.qe').dataset.i);
    if (b.dataset.q === 'del') {
      if (!confirm(`刪除第 ${i + 1} 題？`)) return;
      questions.splice(i, 1);
    } else {
      const j = b.dataset.q === 'up' ? i - 1 : i + 1;
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    renderQuestions();
  });
  $('qAdd').addEventListener('click', () => {
    const used = new Set(questions.map((q) => q.id));
    let n = questions.length + 1;
    while (used.has('q' + n)) n++;
    questions.push({ id: 'q' + n, type: 'rating', label: '', required: true });
    renderQuestions();
    $('qEditor').lastElementChild.querySelector('.qe-label').focus();
  });

  $('settingsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const out = {};
    for (const el of $('settingsForm').querySelectorAll('[name]')) {
      out[el.name] = el.type === 'datetime-local' ? fromLocal(el.value) : el.value;
    }
    out.survey_questions = JSON.stringify(questions);
    $('saveBtn').disabled = true;
    $('settingsErr').hidden = true;
    try {
      const r = await api('/api/admin/settings', { method: 'PUT', body: { settings: out } });
      settings = r.settings;
      fillSettings();
      toast('設定已儲存');
      lastRaw = '';
      refresh();
    } catch (e) {
      if (e.status === 401) return showLogin();
      $('settingsErr').textContent = e.message;
      $('settingsErr').hidden = false;
    } finally {
      $('saveBtn').disabled = false;
    }
  });

  // ---------- 啟動 ----------
  fetch('/api/admin/dashboard', { credentials: 'same-origin' }).then((r) => (r.status === 401 ? showLogin() : start()), showLogin);
})();
