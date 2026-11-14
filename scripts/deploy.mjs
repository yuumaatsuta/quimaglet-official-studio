// GitHub Pages に公開する（npm run deploy）。dist/ を gh-pages ブランチに上書きで push する。
// public/CNAME（独自ドメイン。例 quimaglet.studio）があれば、そのドメインの直下（/）向けにビルドする。
// CNAME は dist/ にも入るので、上書きで push しても GitHub のドメイン設定は消えない。
// なければ https://<ユーザー名>.github.io/<リポジトリ名>/ 向け
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd) => execSync(cmd).toString().trim();

const remote = out('git remote get-url origin');
const repo = remote.replace(/\.git$/, '').split('/').pop();
const name = out('git config user.name');
const email = out('git config user.email');

const domain = existsSync('public/CNAME') ? readFileSync('public/CNAME', 'utf8').trim() : '';

sh(`npx vite build --base=${domain ? '/' : `/${repo}/`}`);
writeFileSync('dist/.nojekyll', ''); // _ で始まるファイルも配信させる
// 文章とお知らせは管理画面（/admin/）が GitHub の main に直接書く。手元が古くても上書きしないよう、
// GitHub 上の最新の public/content.json で公開する（手元にも取り込むには git pull）
try {
  sh('git fetch -q origin main');
  const remote = execSync('git show origin/main:public/content.json').toString();
  writeFileSync('dist/content.json', remote);
  if (remote.trim() !== readFileSync('public/content.json', 'utf8').trim()) {
    console.warn('\n※ 管理画面で更新された content.json（GitHub の main）で公開します。手元に取り込むには git pull してください\n');
  }
} catch {
  console.warn('\n※ GitHub の content.json を取れなかったので、手元の content.json で公開します\n');
}
sh('git init -q -b gh-pages', 'dist');
sh(`git -c user.name="${name}" -c user.email="${email}" add -A`, 'dist');
sh(`git -c user.name="${name}" -c user.email="${email}" commit -q --allow-empty -m "Deploy ${new Date().toISOString()}"`, 'dist');
sh(`git push -f "${remote}" gh-pages`, 'dist');
const url = domain ? `https://${domain}/` : `https://${remote.split('/').at(-2)}.github.io/${repo}/`;
console.log(`\n公開しました: ${url}（反映まで 1〜2 分）`);
