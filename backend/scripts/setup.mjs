// はじめの 1 回だけ：Cloudflare に D1 を作り、表と今のサイトの中身を入れ、2 つの Worker を公開する。
// 先に npx wrangler login でログインしておく。何度動かしても、すでにあるものは作り直さない
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd, quiet = false) => {
  console.log(`\n> ${cmd}`);
  const out = execSync(`npx wrangler ${cmd}`, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (!quiet) process.stdout.write(out);
  return out;
};
const toml = () => readFileSync('wrangler.toml', 'utf8');

// 1. D1（データベース）
let id = '';
try {
  id = JSON.parse(run('d1 list --json', true)).find((d) => d.name === 'quimaglet')?.uuid ?? '';
} catch {}
if (!id) id = run('d1 create quimaglet').match(/database_id\s*[=:]\s*"?([0-9a-f-]{36})/)?.[1] ?? '';
if (!id) throw new Error('D1 の id を読み取れませんでした。wrangler d1 list で確かめてください');
writeFileSync('wrangler.toml', toml().replace(/database_id = "[^"]*"/g, `database_id = "${id}"`));
console.log(`D1: ${id}`);

// 2. 表と、今のサイトの中身（public/content.json）
run('d1 execute quimaglet --remote --file schema.sql --yes');
execSync('node scripts/seed.mjs', { stdio: 'inherit' });
run('d1 execute quimaglet --remote --file seed.sql --yes');

// 3. 公開側の Worker。その URL を、管理画面側の PUBLIC_BASE に書く
const out = run('deploy');
const url = out.match(/https:\/\/quimaglet-api\.[\w-]+\.workers\.dev/)?.[0];
if (!url) throw new Error('公開側の URL を読み取れませんでした');
writeFileSync('wrangler.toml', toml().replace(/PUBLIC_BASE = "[^"]*"/, `PUBLIC_BASE = "${url}"`));

// 4. 管理画面の Worker
const outAdmin = run('deploy --env admin');
const adminUrl = outAdmin.match(/https:\/\/quimaglet-admin\.[\w-]+\.workers\.dev/)?.[0];

console.log(`
できました。
  サイトが読む API : ${url}/api/content
  管理画面         : ${adminUrl}
次は README の「3. 管理画面にログインをかける（Cloudflare Access）」をしてください。
それまで管理画面は開けても、読み込み・保存はできません。`);
