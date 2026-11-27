// Buffet 統一入口：大家掃同一個 QR Code。
// 同一支手機報到過 → 直接帶出身分；否則輸入姓名（同名選店）。
// 依報到資料顯示：兌換券 / 已兌換時間 / 請先報到 / 您沒有 Buffet 兌換券
(function () {
  const { api, esc, mdhm, tokenStore, CHECK_ICON } = window.BS;
  const { qrBlock, noticeBlock } = window.BS.coupon;
  const $ = (id) => document.getElementById(id);
  const steps = ['loading', 'stepSearch', 'stepChoose', 'stepMsg', 'stepCoupon'];

  let token = tokenStore.get();
  let data = null;
  let name = '';
  let pollTimer = null;

  function show(step) {
    steps.forEach((s) => ($(s).hidden = s !== step));
    clearInterval(pollTimer);
    if (step === 'stepCoupon') {
      pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !window.BS.coupon.isOpen()) load();
      }, 10000);
    }
  }

  function setHtml(el, html) {
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
  }

  function message(title, text, goCheckin) {
    $('msgTitle').textContent = title;
    $('msgText').textContent = text;
    $('msgGo').hidden = !goCheckin;
    show('stepMsg');
  }

  function render() {
    const a = data.attendee;
    const b = data.buffet;
    $('cName').textContent = a.name;
    $('cStore').textContent = a.store;
    $('myPage').href = '/me?t=' + encodeURIComponent(token);
    let html;
    if (!b.eligible) {
      html = noticeBlock('您沒有 Buffet 兌換券', '如有疑問請洽工作人員');
    } else if (b.redeemed_at) {
      html = `<div class="redeemed big-done"><div class="tick">${CHECK_ICON}</div>
        <strong>已兌換</strong><span>兌換時間 ${esc(mdhm(b.redeemed_at))}</span></div>`;
    } else {
      html = qrBlock('meal', b.code, '請出示此 QR Code 給工作人員掃描（每人一份）');
    }
    setHtml($('couponBody'), html);
    show('stepCoupon');
  }

  async function load() {
    if (!token) return show('stepSearch');
    try {
      data = await api('/api/me?t=' + encodeURIComponent(token));
      render();
    } catch (e) {
      if (e.status === 404) {
        tokenStore.clear();
        token = null;
        show('stepSearch');
      } else if (!data) {
        message('連線不穩', e.message, false);
      }
    }
  }

  async function identify(id) {
    $('searchBtn').disabled = true;
    try {
      const r = await api('/api/identify', { body: { name, id } });
      if (r.status === 'not_found') {
        message('查無資料', `查無「${name}」的資料，請確認姓名或洽工作人員。`, false);
      } else if (r.status === 'choose') {
        $('chooseName').textContent = name;
        $('chooseList').innerHTML = r.options
          .map((o) => `<button class="choice" type="button" data-id="${o.id}">${esc(o.store)}</button>`)
          .join('');
        show('stepChoose');
      } else if (r.status === 'checked_in') {
        token = r.token;
        tokenStore.set(token);
        show('loading');
        await load();
      } else {
        // confirm / closed：尚未報到
        message('尚未完成報到', '請先完成報到，即可取得 Buffet 兌換券。', true);
      }
    } catch (e) {
      $('searchErr').textContent = e.message;
      $('searchErr').hidden = false;
      show('stepSearch');
    } finally {
      $('searchBtn').disabled = false;
    }
  }

  $('searchForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    name = $('nameInput').value.trim();
    $('searchErr').hidden = true;
    if (!name) {
      $('searchErr').textContent = '請輸入姓名';
      $('searchErr').hidden = false;
      return;
    }
    $('nameInput').blur();
    identify(undefined);
  });

  $('chooseList').addEventListener('click', (ev) => {
    const b = ev.target.closest('.choice');
    if (b) identify(Number(b.dataset.id));
  });

  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => {
      show('stepSearch');
      $('nameInput').focus();
    })
  );

  $('notMe').addEventListener('click', () => {
    tokenStore.clear();
    token = null;
    data = null;
    $('nameInput').value = '';
    show('stepSearch');
    $('nameInput').focus();
  });

  window.BS.coupon.bind($('stepCoupon'), {
    token: () => token,
    info: () => ({ code: data.buffet.code, title: 'Buffet 兌換券', sub: `${data.attendee.name}｜${data.attendee.store}` }),
    after: load,
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data) load();
  });

  load();
})();
