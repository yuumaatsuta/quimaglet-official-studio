// 検索エンジンと SNS 向けの設定（タイトル・説明文・キーワード・制作者・公式の外部ページ）。
// 中身は管理画面の「サイト設定」で書き換える（content の site）。空の項目は下の既定を使う。
//   ・公開するとき（vite build）：vite.config.js が管理画面の設定を読んで index.html の <head> に書き込む
//     （JavaScript を動かさない検索エンジンや SNS のリンクの表示も、これを読む）
//   ・開いたとき：管理画面で変えた後まだ公開し直していなくても、読み込んだ設定で <head> を書き換える（applySeo）
// 制作者（author）は画面には出さず、<head> の meta と構造化データ（JSON-LD）、/humans.txt にだけ書く

export const SITE_URL = 'https://quimaglet.studio/';

export const DEFAULT_SEO = {
  title: 'quimaglet ~きまぐれ~ 公式サイト | QUIMAGLET OFFICIAL STUDIO',
  description:
    'ここは、社会に疲れた人々に寄り添う音楽的表現を探求するアーティスト集団 quimaglet の制作スタジオです。音楽・映像・アートワーク・ライブ演出をデザインし、独自の世界観を作り上げます。スタジオでは球体型制作支援ロボット Lovvy が、お知らせ・作品・グッズ・メンバーなど様々な情報を提示してくれます。',
  keywords:
    'quimaglet, きまぐれ, キマグレ, QUIMAGLET, バンド, アーティスト集団, 相模原, 淵野辺, 神奈川, インディーズ, オルタナティブ, ジャズ, ボサノヴァ, 渡辺美月, 熱田悠馬, 内田泰河, 浅葉瑛太, 公式サイト',
  author: 'Yuuma Atsuta 熱田悠馬',
  sameAs: '',
};

// 設定と既定を合わせる（空の項目は既定）
export function seoFields(site = {}) {
  const pick = (k) => String(site?.[k] ?? '').trim() || DEFAULT_SEO[k];
  return {
    title: pick('title'),
    description: pick('description'),
    keywords: pick('keywords'),
    author: pick('author'),
    // 公式 SNS・配信ページなど（1 行に 1 つ。「名前 URL」でも URL だけでもよい）
    sameAs: String(site?.sameAs ?? DEFAULT_SEO.sameAs)
      .split(/\n/)
      .map((l) => l.match(/https?:\/\/\S+/)?.[0])
      .filter(Boolean),
  };
}

// 構造化データ（Google などが読む、サイトとバンドの説明）
export function structuredData(site, { members = [], image = '' } = {}) {
  const f = seoFields(site);
  const creator = { '@type': 'Person', name: f.author };
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: f.title,
      url: SITE_URL,
      inLanguage: 'ja',
      description: f.description,
      author: creator,
      creator,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'MusicGroup',
      name: 'quimaglet',
      alternateName: ['きまぐれ', 'QUIMAGLET'],
      url: SITE_URL,
      description: f.description,
      foundingLocation: { '@type': 'Place', name: '神奈川県相模原市' },
      ...(image ? { image } : {}),
      ...(members.length
        ? {
            member: members
              .filter((m) => m?.name)
              .map((m) => ({
                '@type': 'Person',
                name: m.name,
                ...(m.nameEn ? { alternateName: m.nameEn } : {}),
                ...(m.part ? { roleName: m.part } : {}),
              })),
          }
        : {}),
      ...(f.sameAs.length ? { sameAs: f.sameAs } : {}),
    },
  ];
}

// <head> に書く meta の一覧（[属性名, 値, content]）
function metaList(f) {
  return [
    ['name', 'description', f.description],
    ['name', 'keywords', f.keywords],
    ['name', 'author', f.author],
    ['name', 'creator', f.author],
    ['property', 'og:title', f.title],
    ['property', 'og:description', f.description],
    ['name', 'twitter:title', f.title],
    ['name', 'twitter:description', f.description],
  ];
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// JSON-LD を <script> の中に安全に入れる（</script> で閉じられないように）
const ldJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

// 公開するときに index.html へ書き込む分（vite.config.js）
export function seoHeadHtml(site, opts) {
  const f = seoFields(site);
  return [
    `<title>${esc(f.title)}</title>`,
    ...metaList(f).map(([attr, key, content]) => `<meta ${attr}="${key}" content="${esc(content)}" />`),
    `<script type="application/ld+json" id="seo-ld">${ldJson(structuredData(site, opts))}</script>`,
  ].join('\n    ');
}

// 開いたときに、読み込んだ設定で <head> を書き換える
export function applySeo(site, opts) {
  if (typeof document === 'undefined') return;
  const f = seoFields(site);
  document.title = f.title;
  for (const [attr, key, content] of metaList(f)) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.append(el);
    }
    el.setAttribute('content', content);
  }
  let ld = document.getElementById('seo-ld');
  if (!ld) {
    ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'seo-ld';
    document.head.append(ld);
  }
  ld.textContent = ldJson(structuredData(site, opts));
  const desc = document.getElementById('site-desc');
  if (desc) desc.textContent = f.description;
}

// /humans.txt（サイトを作った人。画面には出さない）
export function humansTxt(site) {
  const f = seoFields(site);
  return `/* TEAM */\nSite: ${SITE_URL}\nDesign & Development: ${f.author}\n\n/* SITE */\nLanguage: Japanese\nStandards: HTML5, CSS3, WebGL (three.js)\n`;
}
