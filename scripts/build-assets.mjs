// 把 public/ 打包成 src/static-assets.gen.js，由 Worker 直接提供靜態檔案。
// wrangler.toml 的 [build] 會在 dev / deploy 前自動執行，不需手動跑。
// （不用 Workers Assets 上傳：部署環境的代理會改寫上傳用的授權標頭。）
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};
const TEXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = {};
let total = 0;
for (const file of walk(pub).sort()) {
  const ext = extname(file).toLowerCase();
  if (!TYPES[ext] || file.endsWith('.gitkeep')) continue;
  const buf = readFileSync(file);
  total += buf.length;
  const path = '/' + relative(pub, file).split('\\').join('/');
  entries[path] = {
    type: TYPES[ext],
    etag: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"',
    ...(TEXT.has(ext) ? { text: buf.toString('utf8') } : { b64: buf.toString('base64') }),
  };
}

writeFileSync(
  join(root, 'src/static-assets.gen.js'),
  '// 自動產生（scripts/build-assets.mjs），請勿手動修改\nexport default ' + JSON.stringify(entries) + ';\n'
);
console.log(`static assets: ${Object.keys(entries).length} files, ${(total / 1024).toFixed(0)} KB`);
