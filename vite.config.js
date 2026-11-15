import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { SITE_URL, humansTxt, seoFields, seoHeadHtml } from './src/seo.js';

// 検索エンジン・SNS 向けの設定（管理画面の「サイト設定」）を、公開するときに index.html へ書き込む（src/seo.js）。
// 管理画面の設定はバックエンドの /api/content から読む。読めなければ public/content.json、それもなければ既定の文
export default defineConfig(({ mode }) => {
  const api = (loadEnv(mode, process.cwd(), 'VITE_').VITE_CONTENT_API ?? '').replace(/\/$/, '');
  let content = null;
  const load = async () => {
    if (content) return content;
    try {
      const res = await fetch(`${api}/api/content`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(String(res.status));
      content = await res.json();
    } catch (err) {
      console.warn(`[seo] 管理画面の設定を読めなかったので、控えか既定の文で書きます（${err.message}）`);
      try {
        content = JSON.parse(readFileSync('public/content.json', 'utf8'));
      } catch {
        content = {};
      }
    }
    return content;
  };

  return {
    plugins: [
      {
        name: 'quimaglet-seo',
        async transformIndexHtml(html) {
          const doc = await load();
          const head = seoHeadHtml(doc.site, { members: doc.members ?? [], image: api ? `${api}/site/og-image` : '' });
          const desc = seoFields(doc.site).description.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          return html
            .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n    ${head}\n    <!-- seo:end -->`)
            .replace('<p class="sr-only" id="site-desc"></p>', `<p class="sr-only" id="site-desc">${desc}</p>`);
        },
        // 制作者（/humans.txt）と、検索エンジンに知らせるページの一覧（/sitemap.xml）
        async generateBundle() {
          const doc = await load();
          this.emitFile({ type: 'asset', fileName: 'humans.txt', source: humansTxt(doc.site) });
          const today = new Date().toISOString().slice(0, 10);
          this.emitFile({
            type: 'asset',
            fileName: 'sitemap.xml',
            source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
          });
        },
      },
    ],
  };
});
