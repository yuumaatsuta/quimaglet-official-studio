// 手元で動かす（http://127.0.0.1:8788）。1 つの Worker で、管理画面と、サイトが読む API（/api/content・/images/…）の両方を受ける。
// ログインは省く（.dev.vars の DEV_AUTH_BYPASS）。データは .wrangler/state に置く。はじめての時は表と今のサイトの中身を入れる。
// サイト側は VITE_CONTENT_API=http://127.0.0.1:8788 npm run dev で、この中身を読む
import { execSync, spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
const persist = '--persist-to .wrangler/state';
execSync(`npx wrangler d1 execute quimaglet --env admin --local ${persist} --file schema.sql`, { stdio: 'inherit' });
execSync('node scripts/seed.mjs', { stdio: 'inherit' });
execSync(`npx wrangler d1 execute quimaglet --env admin --local ${persist} --file seed.sql`, { stdio: 'inherit' });
spawn(`npx wrangler dev --env admin ${persist} --port 8788`, { stdio: 'inherit', shell: true });
