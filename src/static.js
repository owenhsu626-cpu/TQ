// 靜態檔案（由 scripts/build-assets.mjs 打包進 Worker）
import ASSETS from './static-assets.gen.js';

const cache = new Map();

function body(path) {
  let b = cache.get(path);
  if (!b) {
    const a = ASSETS[path];
    if (a.text !== undefined) b = new TextEncoder().encode(a.text);
    else {
      const bin = atob(a.b64);
      b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    }
    cache.set(path, b);
  }
  return b;
}

/** URL 路徑 → 檔案路徑（/ → /index.html、/me → /me.html、/admin/ → /admin/index.html） */
function resolve(pathname) {
  if (ASSETS[pathname] && !pathname.endsWith('/index.html')) return { file: pathname };
  if (pathname.endsWith('/')) {
    const f = pathname + 'index.html';
    if (ASSETS[f]) return { file: f };
  } else {
    if (ASSETS[pathname + '.html']) return { file: pathname + '.html' };
    if (ASSETS[pathname + '/index.html']) return { redirect: pathname + '/' };
  }
  if (pathname.endsWith('/index.html')) return { redirect: pathname.slice(0, -10) };
  if (pathname.endsWith('.html') && ASSETS[pathname]) return { redirect: pathname.slice(0, -5) };
  return null;
}

export function serveStatic(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  const r = resolve(pathname);
  if (!r) return new Response('找不到此頁面', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (r.redirect) return Response.redirect(new URL(r.redirect + url.search, url).toString(), 301);

  const a = ASSETS[r.file];
  const isHtml = r.file.endsWith('.html');
  const headers = {
    'content-type': a.type,
    etag: a.etag,
    // HTML 每次確認更新；其他檔案快取 1 小時（更新後最慢 1 小時生效）
    'cache-control': isHtml ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
  if (isHtml) headers['x-frame-options'] = 'DENY';
  if (request.headers.get('if-none-match') === a.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body(r.file), { headers });
}
