// 由 data/sample-attendees.csv 產生 .wrangler/seed.sql（清空後灌入假資料）。
// 只用於測試站 / 本機：npm run db:seed:test、npm run db:seed:local
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAttendeeCsv } from '../src/csv.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || join(root, 'data/sample-attendees.csv');
const { rows, errors } = parseAttendeeCsv(readFileSync(src, 'utf8'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const tok = () => randomBytes(16).toString('base64url');
const q = (v) => "'" + String(v ?? '').replace(/'/g, "''") + "'";

const lines = ['DELETE FROM surveys;', 'DELETE FROM attendees;', 'DELETE FROM stores;'];
for (const s of [...new Set(rows.map((r) => r.store))]) {
  lines.push(`INSERT INTO stores (name, gift_token) VALUES (${q(s)}, ${q(tok())});`);
}
for (const r of rows) {
  lines.push(
    `INSERT INTO attendees (name, store_id, room, table_no, note, token) VALUES (${q(r.name)}, (SELECT id FROM stores WHERE name = ${q(
      r.store
    )}), ${q(r.room)}, ${q(r.table_no)}, ${q(r.note)}, ${q(tok())});`
  );
}
mkdirSync(join(root, '.wrangler'), { recursive: true });
writeFileSync(join(root, '.wrangler/seed.sql'), lines.join('\n') + '\n');
console.log(`seed.sql：${rows.length} 人、${new Set(rows.map((r) => r.store)).size} 家店`);
