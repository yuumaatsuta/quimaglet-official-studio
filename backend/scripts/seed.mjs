// サイトの今の中身（../public/content.json）を、D1 に入れる SQL（seed.sql）にする。
// お知らせには id と「公開」を付ける。すでに中身があるときは上書きしない（INSERT OR IGNORE）
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const src = new URL('../../public/content.json', import.meta.url);
const doc = JSON.parse(readFileSync(src, 'utf8'));
doc.news = (doc.news ?? []).map((n) => ({ id: randomUUID(), status: 'published', publishAt: '', image: '', ...n, image: n.image || '' }));
const data = JSON.stringify(doc).replace(/'/g, "''");
const now = new Date().toISOString();
const sql = `INSERT OR IGNORE INTO content (id, data, version, updated_at, updated_by) VALUES (1, '${data}', 1, '${now}', 'seed');
INSERT INTO revisions (version, data, at, by) SELECT 1, data, updated_at, 'seed' FROM content WHERE id = 1 AND updated_by = 'seed' AND NOT EXISTS (SELECT 1 FROM revisions);
`;
writeFileSync(new URL('../seed.sql', import.meta.url), sql);
console.log(`seed.sql を作りました（お知らせ ${doc.news.length} 件）`);
