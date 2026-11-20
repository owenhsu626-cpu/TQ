// 報到流程：輸入姓名 → （同名選店）→ 確認身分 → 住宿規範 → 報到完成頁
(function () {
  const { api, esc, md, mdhm, tokenStore } = window.BS;
  const $ = (id) => document.getElementById(id);
  const steps = ['stepSearch', 'stepChoose', 'stepConfirm', 'stepRules', 'stepNotFound', 'stepClosed'];
  let current = { name: '', attendee: null };
  let surveyOpen = false; // 問卷開放期間：查詢後直接進入問卷
  let savedName = '';
  let savedToken = '';
  let lastStatus = null;

  function show(step) {
    steps.forEach((s) => ($(s).hidden = s !== step));
    const home = step === 'stepSearch';
    document.body.classList.toggle('home', home);
    document.body.classList.toggle('inner-bg', !home);
    $('hero').hidden = !home;
    $('innerTop').hidden = home;
    if (!home) window.scrollTo(0, 0);
    // 問卷開放時，問卷卡片已含「我的頁面」入口，不再重複顯示已報到提示
    $('surveyBox').hidden = !(home && surveyOpen);
    $('savedBox').hidden = !(home && savedName && !surveyOpen);
  }

  function goMe(token) {
    tokenStore.set(token);
    location.href = '/me?t=' + encodeURIComponent(token) + (surveyOpen ? '&survey=1' : '');
  }

  function busy(btn, on) {
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>處理中';
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  function windowText(w) {
    const a = w.open_at ? mdhm(w.open_at) : '';
    const b = w.close_at ? mdhm(w.close_at) : '';
    if (a && b) return `報到開放時間：${a} – ${b}`;
    if (a) return `報到開放時間：${a} 起`;
    if (b) return `報到截止時間：${b}`;
    return '';
  }

  function handle(r) {
    if (r.status === 'not_found') {
      $('nfName').textContent = current.name;
      show('stepNotFound');
    } else if (r.status === 'choose') {
      $('chooseName').textContent = current.name;
      $('chooseList').innerHTML = r.options
        .map((o) => `<button class="choice" type="button" data-id="${o.id}">${esc(o.store)}</button>`)
        .join('');
      show('stepChoose');
    } else if (r.status === 'checked_in') {
      goMe(r.token);
    } else if (r.status === 'closed') {
      const before = r.checkin.state === 'before';
      $('closedTitle').textContent = before ? '報到尚未開放' : '報到已截止';
      $('closedText').textContent = (windowText(r.checkin) || '') + (before ? '' : '\n如需協助請洽報到櫃檯。');
      show('stepClosed');
    } else if (r.status === 'confirm') {
      current.attendee = r.attendee;
      $('cfName').textContent = r.attendee.name;
      $('cfStore').textContent = r.attendee.store;
      $('rulesText').innerHTML = md(r.rules);
      $('agreeText').textContent = r.rules_agree;
      $('agree').checked = false;
      $('agreeBox').classList.remove('on');
      $('checkinBtn').disabled = true;
      $('checkinErr').hidden = true;
      show('stepConfirm');
    }
  }

  async function identify(id, btn) {
    btn && busy(btn, true);
    try {
      handle(await api('/api/identify', { body: { name: current.name, id } }));
    } catch (e) {
      $('searchErr').textContent = e.message;
      $('searchErr').hidden = false;
      show('stepSearch');
    } finally {
      btn && busy(btn, false);
    }
  }

  $('searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('nameInput').value.trim();
    $('searchErr').hidden = true;
    if (!name) {
      $('searchErr').textContent = '請輸入姓名';
      $('searchErr').hidden = false;
      $('nameInput').focus();
      return;
    }
    current = { name, attendee: null };
    $('nameInput').blur();
    identify(undefined, $('searchBtn'));
  });

  $('chooseList').addEventListener('click', (ev) => {
    const b = ev.target.closest('.choice');
    if (b) identify(Number(b.dataset.id), null);
  });

  $('cfYes').addEventListener('click', () => show('stepRules'));

  $('agree').addEventListener('change', () => {
    const on = $('agree').checked;
    $('checkinBtn').disabled = !on;
    $('agreeBox').classList.toggle('on', on);
  });

  $('checkinBtn').addEventListener('click', async () => {
    if (!$('agree').checked || !current.attendee) return;
    const btn = $('checkinBtn');
    busy(btn, true);
    $('checkinErr').hidden = true;
    try {
      const r = await api('/api/checkin', {
        body: { id: current.attendee.id, name: current.attendee.name, agreed: true },
      });
      goMe(r.token);
    } catch (e) {
      $('checkinErr').textContent = e.message;
      $('checkinErr').hidden = false;
      busy(btn, false);
      btn.disabled = !$('agree').checked;
    }
  });

  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => {
      show('stepSearch');
      $('nameInput').focus();
    })
  );

  $('savedClear').addEventListener('click', () => {
    tokenStore.clear();
    savedName = '';
    savedToken = '';
    $('savedBox').hidden = true;
    renderSurveyBox(lastStatus, null);
    show('stepSearch');
    $('nameInput').focus();
  });

  function rangeText(w) {
    const a = w.open_at ? mdhm(w.open_at) : '';
    const b = w.close_at ? mdhm(w.close_at) : '';
    return a && b ? `${a} – ${b}` : b ? `至 ${b}` : a ? `${a} 起` : '';
  }

  /** 首頁的問卷入口：依是否已有本機報到資料、本店是否已填寫顯示不同按鈕 */
  function renderSurveyBox(status, me) {
    const w = status && status.survey;
    surveyOpen = !!w && w.state === 'open';
    if (!surveyOpen) return;
    const range = rangeText(w);
    $('surveyText').textContent =
      (range ? `填寫時間 ${range}・` : '') + '每店一份，完成即可兌換贈品';
    $('stepSearch').querySelector('.card-title').textContent = '報到／填寫問卷';
    const go = $('surveyGo');
    if (me) {
      const s = me.survey;
      const href = '/me?t=' + encodeURIComponent(savedToken);
      if (s.done) {
        go.textContent = s.done.mine ? '問卷已完成，查看贈品 QR Code' : `本店已由 ${s.done.by} 完成，查看贈品`;
        go.href = href;
      } else {
        go.textContent = `${me.attendee.name}，開始填寫問卷`;
        go.href = href + '&survey=1';
      }
      go.hidden = false;
      $('surveyHint').hidden = true;
    } else {
      go.hidden = true;
      $('surveyHint').hidden = false;
    }
  }

  // 已存的 token（已報到）與開放狀態一起載入
  const saved = tokenStore.get();
  const meReq = saved
    ? api('/api/me?t=' + encodeURIComponent(saved)).catch((e) => {
        if (e.status === 404) tokenStore.clear();
        return null;
      })
    : Promise.resolve(null);
  Promise.all([api('/api/status').catch(() => null), meReq]).then(([status, me]) => {
    lastStatus = status;
    if (me) {
      savedName = me.attendee.name;
      savedToken = saved;
      $('savedBox').querySelector('strong').textContent = `${me.attendee.name}（${me.attendee.store}）您已完成報到`;
      $('savedLink').href = '/me?t=' + encodeURIComponent(saved);
    }
    if (status && status.checkin.state !== 'open') {
      $('openInfo').textContent = (status.checkin.state === 'before' ? '報到尚未開放。' : '報到已截止。') + windowText(status.checkin);
      $('openInfo').hidden = false;
    }
    renderSurveyBox(status, me);
    if (!$('stepSearch').hidden) show('stepSearch');
  });

  show('stepSearch');
})();
