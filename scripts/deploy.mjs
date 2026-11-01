// GitHub Pages に公開する（npm run deploy）。
// https://<ユーザー名>.github.io/<リポジトリ名>/ 向けにビルドし、dist/ を gh-pages ブランチに上書きで push する
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd) => execSync(cmd).toString().trim();

const remote = out('git remote get-url origin');
const repo = remote.replace(/\.git$/, '').split('/').pop();
const name = out('git config user.name');
const email = out('git config user.email');

sh(`npx vite build --base=/${repo}/`);
writeFileSync('dist/.nojekyll', ''); // _ で始まるファイルも配信させる
sh('git init -q -b gh-pages', 'dist');
sh(`git -c user.name="${name}" -c user.email="${email}" add -A`, 'dist');
sh(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Deploy ${new Date().toISOString()}"`, 'dist');
sh(`git push -f "${remote}" gh-pages`, 'dist');
console.log(`\n公開しました: https://${remote.split('/').at(-2)}.github.io/${repo}/（反映まで 1〜2 分）`);
