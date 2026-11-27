// 報到完成頁：房號、桌次、交通方式、注意事項、Buffet 兌換券、問卷、贈品 QR
(function () {
  const { api, esc, md, hm, mdhm, toast, tokenStore, CHECK_ICON } = window.BS;
  const { qrBlock, redeemedBlock, noticeBlock } = window.BS.coupon;
  const $ = (id) => document.getElementById(id);

  // token：URL 優先，其次 localStorage
  const params = new URLSearchParams(location.search);
  let token = params.get('t') || tokenStore.get();
  if (token) {
    tokenStore.set(token);
    if (params.get('t') !== token) history.replaceState(null, '', '/me?t=' + encodeURIComponent(token));
  }

  let data = null;
  let pollTimer = null;
  let lockUntil = null;
  let lockTimer = null;

  function setHtml(el, html) {
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
  }

  function surveyRange(s) {
    const a = s.open_at ? mdhm(s.open_at) : '';
    const b = s.close_at ? mdhm(s.close_at) : '';
    return a && b ? `${a} – ${b}` : a ? `${a} 起` : b ? `至 ${b}` : '';
  }

  function render() {
    const d = data;
    $('aName').textContent = d.attendee.name;
    $('aStore').textContent = d.attendee.store;
    $('aTime').textContent = mdhm(d.attendee.checked_in_at);
    for (const [id, v] of [['aRoom', d.attendee.room], ['aTable', d.attendee.table_no], ['aTransport', d.attendee.transport]]) {
      $(id).textContent = v || '請洽櫃檯';
      $(id).classList.toggle('empty', !v);
    }
    setHtml($('notice'), md(d.notice));

    // Buffet 兌換券
    const bf = d.buffet;
    setHtml(
      $('mealBody'),
      !bf.eligible
        ? noticeBlock('您沒有 Buffet 兌換券', '如有疑問請洽工作人員')
        : bf.redeemed_at
        ? redeemedBlock(`Buffet 已兌換 ${hm(bf.redeemed_at)}`, bf.redeemed_at)
        : qrBlock('meal', bf.code, '用餐時請出示此 QR Code 給工作人員掃描（每人一份）')
    );

    // 問卷（公司人員不顯示問卷與贈品）
    const s = d.survey;
    $('surveyCard').hidden = !s;
    let sh = '';
    if (!s) {
      // 公司人員
    } else if (s.done) {
      sh = s.done.mine
        ? `<div class="redeemed"><div class="tick">${CHECK_ICON}</div><strong>您已完成填寫，感謝！</strong><span class="muted">${esc(mdhm(s.done.at))}</span></div>`
        : `<div class="redeemed"><div class="tick">${CHECK_ICON}</div><strong>本店已由 ${esc(s.done.by)} 於 ${esc(hm(s.done.at))} 填寫完成</strong><span class="muted">感謝您的配合</span></div>`;
    } else if (s.state === 'before') {
      sh = `<p class="status pending">尚未開放</p><p class="muted" style="margin-bottom:0">開放時間：${esc(surveyRange(s))}</p>`;
    } else if (s.state === 'after') {
      sh = `<p class="status pending">問卷已截止</p><p class="muted" style="margin-bottom:0">開放時間：${esc(surveyRange(s))}</p>`;
    } else if (s.lock && !s.lock.mine) {
      sh = `<div class="alert">同店 <strong>${esc(s.lock.by)}</strong> 正在填寫，請稍候。</div>
        <button class="btn ghost block" type="button" data-refresh>重新整理</button>`;
    } else {
      sh = `<p style="margin-top:0">每家店填寫一份問卷，完成後即可兌換店家贈品。</p>
        <p class="muted small">開放時間：${esc(surveyRange(s))}</p>
        <button class="btn block" type="button" id="surveyStart">填寫問卷</button>`;
    }
    setHtml($('surveyBody'), sh);

    // 贈品
    $('giftCard').hidden = !d.gift;
    if (d.gift) {
      setHtml(
        $('giftBody'),
        d.gift.redeemed_at
          ? redeemedBlock(`贈品已兌換 ${hm(d.gift.redeemed_at)}`, d.gift.redeemed_at)
          : d.gift.sold_out
          ? noticeBlock('贈品已兌換完畢', '感謝您填寫問卷')
          : qrBlock('gift', d.gift.code, '店家贈品：請出示此 QR Code 給工作人員掃描（每店一份）')
      );
    }
  }

  async function load() {
    if (!token) return showInvalid('請先回到首頁輸入姓名查詢。');
    try {
      data = await api('/api/me?t=' + encodeURIComponent(token));
      $('loading').hidden = true;
      if ($('surveyView').hidden) $('page').hidden = false;
      render();
    } catch (e) {
      if (e.status === 404) {
        tokenStore.clear();
        showInvalid(e.message);
      } else if (!data) {
        $('loading').innerHTML = `<p>${esc(e.message)}</p><button class="btn block" type="button" onclick="location.reload()">重新載入</button>`;
      }
    }
  }

  function showInvalid(msg) {
    $('loading').hidden = true;
    $('page').hidden = true;
    $('invalidMsg').textContent = msg;
    $('invalid').hidden = false;
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && $('surveyView').hidden && !window.BS.coupon.isOpen()) load();
    }, 15000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && $('surveyView').hidden) load();
  });

  // ---------- 調亮顯示 / 人工兌換（共用元件） ----------
  window.BS.coupon.bind($('page'), {
    token: () => token,
    info: (kind) =>
      kind === 'meal'
        ? { code: data.buffet.code, title: 'Buffet 兌換券', sub: `${data.attendee.name}｜${data.attendee.store}` }
        : { code: data.gift && data.gift.code, title: '店家贈品', sub: data.attendee.store },
    after: load,
  });

  // ---------- 問卷 ----------
  function questionHtml(q) {
    const name = 'a_' + q.id;
    const req = q.required ? '<span class="req" aria-label="必填">*</span>' : '';
    let body = '';
    if (q.type === 'rating') {
      body = `<div class="rating" role="radiogroup" aria-label="${esc(q.label)}">` +
        [1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}"><span>${n}</span></label>`).join('') +
        `</div><div class="rating-ends"><span>非常不滿意</span><span>非常滿意</span></div>`;
    } else if (q.type === 'single') {
      body = `<div class="opts" role="radiogroup" aria-label="${esc(q.label)}">` +
        (q.options || []).map((o) => `<label><input type="radio" name="${name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('') +
        `</div>`;
    } else {
      body = `<textarea class="input" name="${name}" maxlength="1000" rows="4" aria-label="${esc(q.label)}"></textarea>`;
    }
    return `<fieldset class="q" style="border:0;margin:0;padding-left:0;padding-right:0"><legend class="q-label">${esc(q.label)}${req}</legend>${body}</fieldset>`;
  }

  let questions = [];
  async function startSurvey(btn) {
    btn.disabled = true;
    try {
      const r = await api('/api/survey/start', { body: { t: token } });
      if (!r.ok) {
        const msg = {
          done: `本店已由 ${r.by} 於 ${hm(r.at)} 填寫完成`,
          locked_by_other: `同店 ${r.by} 正在填寫，請稍候`,
          not_open: '問卷尚未開放',
          closed: '問卷已截止',
        }[r.status];
        toast(msg || '目前無法填寫', true);
        return load();
      }
      questions = r.questions;
      lockUntil = Date.parse(r.until);
      $('surveyForm').innerHTML =
        questions.map(questionHtml).join('') +
        `<div class="alert error" id="surveyErr" role="alert" hidden></div>
         <div class="stack" style="margin-top:8px">
           <button class="btn block" type="submit" id="surveySubmit">送出問卷</button>
           <button class="btn ghost block" type="button" id="surveyCancel">先不填，返回</button>
         </div>`;
      $('page').hidden = true;
      $('surveyView').hidden = false;
      window.scrollTo(0, 0);
      history.pushState({ survey: 1 }, '');
      tickLock();
      clearInterval(lockTimer);
      lockTimer = setInterval(tickLock, 15000);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function tickLock() {
    const left = Math.max(0, Math.ceil((lockUntil - Date.now()) / 60000));
    $('lockLeft').textContent = left > 0 ? `（已為您保留填寫權 ${left} 分鐘）` : '（保留時間已到，送出時若同店無人填寫仍可送出）';
  }

  function closeSurvey(fromPop) {
    clearInterval(lockTimer);
    $('surveyView').hidden = true;
    $('page').hidden = false;
    if (!fromPop && history.state && history.state.survey) history.back();
    load();
  }

  async function cancelSurvey(fromPop) {
    api('/api/survey/cancel', { body: { t: token } }).catch(() => {});
    closeSurvey(fromPop);
  }

  window.addEventListener('popstate', () => {
    if (!$('surveyView').hidden) cancelSurvey(true);
  });

  $('surveyForm').addEventListener('click', (ev) => {
    if (ev.target.id === 'surveyCancel') cancelSurvey(false);
  });

  $('surveyForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData($('surveyForm'));
    const answers = {};
    for (const q of questions) {
      const v = fd.get('a_' + q.id);
      if (v !== null && String(v).trim() !== '') answers[q.id] = q.type === 'rating' ? Number(v) : String(v).trim();
      else if (q.required) {
        $('surveyErr').textContent = `請回答「${q.label}」`;
        $('surveyErr').hidden = false;
        return;
      }
    }
    const btn = $('surveySubmit');
    btn.disabled = true;
    $('surveyErr').hidden = true;
    try {
      const r = await api('/api/survey/submit', { body: { t: token, answers } });
      if (r.ok) {
        toast('問卷已送出，感謝您的填寫！');
        closeSurvey(false);
        return;
      }
      const msg = {
        done: `本店已由 ${r.by} 於 ${hm(r.at)} 填寫完成`,
        locked_by_other: `同店 ${r.by} 正在填寫，請稍候`,
        not_open: '問卷尚未開放',
        closed: '問卷已截止',
      }[r.status];
      toast(msg || '無法送出', true);
      closeSurvey(false);
    } catch (e) {
      $('surveyErr').textContent = e.message;
      $('surveyErr').hidden = false;
      btn.disabled = false;
    }
  });

  // ---------- 事件委派 ----------
  $('page').addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.refresh !== undefined) load();
    else if (t.id === 'surveyStart') startSurvey(t);
  });

  // 從首頁問卷入口進來（?survey=1）：問卷開放且本店未填寫時直接開始填寫
  async function autoSurvey() {
    if (params.get('survey') !== '1') return;
    history.replaceState(null, '', '/me?t=' + encodeURIComponent(token));
    if (!data || !data.survey) return;
    const s = data.survey;
    const btn = $('surveyStart');
    if (s.state === 'open' && !s.done && !(s.lock && !s.lock.mine) && btn) return startSurvey(btn);
    $('surveyCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  load().then(autoSurvey).then(startPolling);
})();
