// 參加者端與後台共用的小工具
(function () {
  const TOKEN_KEY = 'bs_checkin_token';

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.method = opts.method || 'POST';
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch {
      const e = new Error('網路連線不穩，請稍後再試');
      e.status = 0;
      throw e;
    }
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      const e = new Error(data.error || '系統忙碌中，請稍後再試');
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  /** 極簡 Markdown：段落、- 清單、**粗體**。先跳脫 HTML。 */
  function md(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let html = '';
    let inList = false;
    let para = [];
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const flush = () => {
      if (para.length) html += '<p>' + para.map(inline).join('<br>') + '</p>';
      para = [];
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const m = line.match(/^\s*[-*•]\s+(.*)$/);
      if (m) {
        flush();
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(m[1]) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim() === '') flush();
        else para.push(line);
      }
    }
    flush();
    if (inList) html += '</ul>';
    return html;
  }

  // ISO（+08:00）→ 台灣時間顯示
  function parts(iso) {
    if (!iso) return null;
    const d = new Date(Date.parse(iso) + 8 * 3600e3);
    const p = (n) => String(n).padStart(2, '0');
    return { M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: p(d.getUTCHours()), m: p(d.getUTCMinutes()) };
  }
  function hm(iso) {
    const t = parts(iso);
    return t ? `${t.h}:${t.m}` : '';
  }
  function mdhm(iso) {
    const t = parts(iso);
    return t ? `${t.M}/${t.D} ${t.h}:${t.m}` : '';
  }

  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: 'QR Code' });
  }

  let toastTimer;
  function toast(msg, isError) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  const store = {
    get() {
      try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
    },
    set(t) {
      try { localStorage.setItem(TOKEN_KEY, t); } catch {}
    },
    clear() {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
    },
  };

  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  window.BS = { api, esc, md, hm, mdhm, qrSvg, toast, tokenStore: store, CHECK_ICON };
})();
