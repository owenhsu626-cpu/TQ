// Worker 入口：/api/* 由程式處理，其餘交給靜態資源（public/）
import { err, HttpError } from './util.js';
import { handlePublic } from './public.js';
import { handleAdmin } from './admin.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function withHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (!env.DB) throw new HttpError(500, '資料庫未設定');
      const res = path.startsWith('/api/admin/') ? await handleAdmin(request, env, path) : await handlePublic(request, env, path);
      return withHeaders(res);
    } catch (e) {
      if (e instanceof HttpError) return withHeaders(err(e.message, e.status, e.extra));
      console.error(e);
      return withHeaders(err('系統忙碌中，請稍後再試', 500));
    }
  },
};
