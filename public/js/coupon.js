// 兌換券共用元件（完成頁、Buffet 入口共用）：QR Code 區塊、調亮顯示、人工兌換確認視窗
(function () {
  const { api, esc, hm, mdhm, qrSvg, toast, CHECK_ICON } = window.BS;

  const LABEL = { meal: 'Buffet 兌換券', gift: '店家贈品' };

  function qrBlock(kind, code, caption) {
    return `<div class="qr-box">
      <div class="qr" role="img" aria-label="${LABEL[kind]} QR Code">${qrSvg(code)}</div>
      <p class="qr-caption">${esc(caption)}</p>
      <div class="qr-actions">
        <button class="btn soft small" type="button" data-bright="${kind}">調亮顯示</button>
        <button class="btn ghost small" type="button" data-manual="${kind}">人工兌換</button>
      </div></div>`;
  }

  function redeemedBlock(title, at, sub) {
    return `<div class="redeemed"><div class="tick">${CHECK_ICON}</div><strong>${esc(title)}</strong>` +
      `<span class="muted">${esc(sub || mdhm(at))}</span></div>`;
  }

  function noticeBlock(title, sub) {
    return `<div class="redeemed none"><strong>${esc(title)}</strong>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</div>`;
  }

  // ---------- 動態建立：調亮顯示 + 確認視窗 ----------
  let built = false;
  function build() {
    if (built) return;
    built = true;
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="bright" id="cpBright" hidden role="dialog" aria-modal="true" aria-label="QR Code 調亮顯示">
        <p class="bright-title" id="cpBrightTitle"></p>
        <div class="bright-qr" id="cpBrightQr"></div>
        <p class="bright-sub" id="cpBrightSub"></p>
        <button class="btn ghost" type="button" id="cpBrightClose">關閉</button>
      </div>
      <div class="modal" id="cpManual" hidden role="dialog" aria-modal="true" aria-labelledby="cpManualTitle">
        <div class="card">
          <h2 class="card-title" id="cpManualTitle">人工兌換</h2>
          <p class="confirm-q">是否確認兌換？</p>
          <p class="confirm-staff">請由工作人員操作</p>
          <p class="muted" id="cpManualWhat" style="margin:0 0 16px"></p>
          <div class="btn-row">
            <button class="btn" type="button" id="cpManualOk">確認兌換</button>
            <button class="btn ghost" type="button" id="cpManualCancel">取消</button>
          </div>
        </div>
      </div>`
    );
    document.getElementById('cpBrightClose').addEventListener('click', () => (document.getElementById('cpBright').hidden = true));
    document.getElementById('cpManualCancel').addEventListener('click', () => (document.getElementById('cpManual').hidden = true));
  }

  const MSG = {
    redeemed: () => '兌換成功',
    already: (r) => `已於 ${hm(r.at)} 兌換`,
    not_checked_in: () => '尚未完成報到',
    not_eligible: () => '您沒有 Buffet 兌換券',
    no_survey: () => '本店尚未填寫問卷',
    sold_out: () => '贈品已兌換完畢',
  };

  /**
   * 綁定 root 內的 [data-bright] / [data-manual] 按鈕。
   * opts.token()：個人 token
   * opts.info(kind)：{ code, title, sub }
   * opts.after()：兌換後重新載入
   */
  function bind(root, opts) {
    build();
    let kind = null;
    const ok = document.getElementById('cpManualOk');
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        const r = await api('/api/redeem/manual', { body: { t: opts.token(), kind, confirm: true } });
        document.getElementById('cpManual').hidden = true;
        toast((MSG[r.status] || (() => '無法兌換'))(r), r.status !== 'redeemed');
      } catch (e) {
        document.getElementById('cpManual').hidden = true;
        toast(e.message, true);
      } finally {
        ok.disabled = false;
        opts.after();
      }
    };
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-bright], [data-manual]');
      if (!b) return;
      if (b.dataset.bright) {
        const i = opts.info(b.dataset.bright);
        if (!i || !i.code) return;
        document.getElementById('cpBrightTitle').textContent = i.title;
        document.getElementById('cpBrightSub').textContent = i.sub;
        document.getElementById('cpBrightQr').innerHTML = qrSvg(i.code);
        document.getElementById('cpBright').hidden = false;
      } else {
        kind = b.dataset.manual;
        const i = opts.info(kind);
        document.getElementById('cpManualWhat').textContent = `兌換項目：${i.title}（${i.sub}）`;
        document.getElementById('cpManual').hidden = false;
        ok.focus();
      }
    });
  }

  function isOpen() {
    const m = document.getElementById('cpManual');
    return !!m && !m.hidden;
  }

  window.BS.coupon = { qrBlock, redeemedBlock, noticeBlock, bind, isOpen, LABEL };
})();
