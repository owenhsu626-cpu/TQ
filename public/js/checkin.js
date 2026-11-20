// 報到流程：輸入姓名 → （同名選店）→ 確認身分 → 住宿規範 → 報到完成頁
(function () {
  const { api, esc, md, mdhm, tokenStore } = window.BS;
  const $ = (id) => document.getElementById(id);
  const steps = ['stepSearch', 'stepChoose', 'stepConfirm', 'stepRules', 'stepNotFound', 'stepClosed'];
  let current = { name: '', attendee: null };

  function show(step) {
    steps.forEach((s) => ($(s).hidden = s !== step));
    const home = step === 'stepSearch';
    document.body.classList.toggle('home', home);
    document.body.classList.toggle('inner-bg', !home);
    $('hero').hidden = !home;
    $('innerTop').hidden = home;
    if (!home) window.scrollTo(0, 0);
    if (home) $('savedBox').hidden = !savedName;
  }

  function goMe(token) {
    tokenStore.set(token);
    location.href = '/me?t=' + encodeURIComponent(token);
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

  // 已存的 token：提示可直接回到完成頁
  let savedName = '';
  const saved = tokenStore.get();
  if (saved) {
    api('/api/me?t=' + encodeURIComponent(saved))
      .then((r) => {
        savedName = r.attendee.name;
        $('savedBox').querySelector('strong').textContent = `${r.attendee.name}（${r.attendee.store}）您已完成報到`;
        $('savedLink').href = '/me?t=' + encodeURIComponent(saved);
        if (!$('stepSearch').hidden) $('savedBox').hidden = false;
      })
      .catch((e) => {
        if (e.status === 404) tokenStore.clear();
      });
  }
  $('savedClear').addEventListener('click', () => {
    tokenStore.clear();
    savedName = '';
    $('savedBox').hidden = true;
    $('nameInput').focus();
  });

  // 報到開放時間提示
  api('/api/status')
    .then((r) => {
      if (r.checkin.state !== 'open') {
        $('openInfo').textContent = (r.checkin.state === 'before' ? '報到尚未開放。' : '報到已截止。') + windowText(r.checkin);
        $('openInfo').hidden = false;
      }
    })
    .catch(() => {});

  show('stepSearch');
})();
