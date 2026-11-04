// サイトの文章とお知らせ。
// 中身は public/content.json（管理画面 /admin/ から書き換える）を起動時に読み込んで、下の入れ物を書き換える。
// 読み込めなかったときは、ここに書いてある仮の文章のまま表示する。

// 部屋の中のクリック対象（hotspot）ごとのパネル内容。キーは Blender のオブジェクト名 `hs_<キー>` と対応する
export const SECTIONS = {
  about: { label: 'About', kicker: 'Bookshelf', title: 'About', body: '' },
  works: { label: 'Works', kicker: 'Desk', title: 'Works', body: '<p>ここに制作実績が入ります。</p>' },
  news: { label: 'News', kicker: 'Poster', title: 'News', body: '<p>ここにお知らせが入ります。</p>' },
  goods: { label: 'Goods', kicker: 'Merch', title: 'Goods', body: '<p>グッズの情報はここに入ります。</p>' },
  contact: { label: 'Contact', kicker: 'Telephone', title: 'Contact', body: '<p>お問い合わせはこちらから。</p>' },
};

// About を開いたときに画面いっぱいに出す文章（aboutView.js）。
// main: 左に壁ぞろえで流すメインの文章（空行で段落を分ける）。fill: まわりを埋め尽くす言葉
export const ABOUT = {
  main: 'QUIMAGLET',
  fill: ['QUIMAGLET'],
};

// Goods を選んだときに、ロボットが持ってくる紙のメニュー（goodsPaper.js）。
// items: { name, status, price, note, image, url }
export const GOODS = {
  title: 'Goods',
  body: '',
  items: [],
};

// 2 台目のロボットが奥の壁（メニューの下）に映す、最新のお知らせ（newsProjector.js）。
// image は画像の URL か public/ に置いた画像のパス（例: 'images/news-latest.jpg'）。空なら仮のサムネイルを描く
export const LATEST_NEWS = {
  date: '2026.11.01',
  title: 'QUIMAGLET OFFICIAL STUDIO のウェブサイトを公開しました',
  body: 'ここに最新のお知らせの本文が入ります。',
  image: null,
};

// お知らせの全部（新しい順）。一覧は 1 台目のロボットのホログラム、本文は 2 台目が壁に映す（main.js・newsProjector.js）
// { date, title, body, image }
export const NEWS_LIST = [{ ...LATEST_NEWS }];

// ホログラムに映す一覧。押すと、2 台目のロボットが映している壁に近づいて本文を読む
export function newsListHtml() {
  return `<ul class="news-list">${NEWS_LIST.map(
    (n, i) => `<li><button type="button" class="news-link" data-news="${i}"><span class="news-date">${escapeHtml(n.date ?? '')}</span><span class="news-title">${escapeHtml(n.title ?? '')}</span>${n.body ? `<span class="news-excerpt">${escapeHtml(excerpt(n.body))}</span>` : ''}<span class="news-more">本文を読む →</span></button></li>`,
  ).join('')}</ul>`;
}
function excerpt(text) {
  const t = String(text).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}
SECTIONS.news.body = newsListHtml();

// public/content.json を読んで上の入れ物を書き換える。待ちすぎないよう、時間がかかるときは仮の文章のまま進む
export async function loadContent(timeoutMs = 4000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // 管理画面で書き換えた直後でも新しい中身が届くよう、毎回別の URL にする
    const res = await fetch(`${import.meta.env.BASE_URL}content.json?t=${Date.now()}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`content.json: ${res.status}`);
    applyContent(await res.json());
  } catch (err) {
    console.warn('[content]', err);
  }
}

export function applyContent(data) {
  const pages = data?.pages ?? {};
  for (const id of ['works', 'contact']) {
    const page = pages[id];
    if (!page) continue;
    if (page.title) SECTIONS[id].title = page.title;
    SECTIONS[id].body = textToHtml(page.body ?? '');
  }
  if (pages.about) {
    if (pages.about.title) SECTIONS.about.title = pages.about.title;
    ABOUT.main = pages.about.main ?? ABOUT.main;
    ABOUT.fill = (pages.about.fill ?? []).filter((w) => String(w).trim());
    SECTIONS.about.body = textToHtml(ABOUT.main);
  }
  if (pages.goods) {
    const g = pages.goods;
    if (g.title) SECTIONS.goods.title = g.title;
    const items = (g.items ?? []).filter((it) => it.name);
    Object.assign(GOODS, { title: g.title || 'Goods', body: g.body ?? '', items });
    SECTIONS.goods.body = textToHtml(g.body ?? '') + (items.length ? `<ul class="goods-list">${items.map(goodsItem).join('')}</ul>` : '');
  }
  const news = (data?.news ?? []).filter((n) => n.title || n.body);
  if (news.length) {
    NEWS_LIST.length = 0;
    for (const n of news) NEWS_LIST.push({ date: n.date ?? '', title: n.title ?? '', body: n.body ?? '', image: n.image || null });
    SECTIONS.news.body = newsListHtml();
    const latest = news[0];
    Object.assign(LATEST_NEWS, {
      date: latest.date ?? '',
      title: latest.title ?? '',
      body: (latest.body ?? '').replace(/https?:\/\/\S+/g, '').trim(),
      image: latest.image || null,
    });
  }
}

// グッズ 1 点。status は「販売中」「予約受付中」「準備中」「売り切れ」など自由に書ける（色は言葉で決める）
const GOODS_STATUS = [
  [/売り切れ|完売|sold/i, 'is-sold'],
  [/準備|近日|予定|soon/i, 'is-soon'],
  [/予約/, 'is-pre'],
];
function goodsItem(it) {
  const status = String(it.status ?? '').trim();
  const cls = GOODS_STATUS.find(([re]) => re.test(status))?.[1] ?? 'is-on';
  const img = it.image ? `<img class="goods-image" src="${escapeHtml(it.image)}" alt="" loading="lazy" />` : '<div class="goods-image is-empty" aria-hidden="true"></div>';
  const name = escapeHtml(it.name);
  const title = it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${name}</a>` : name;
  return `<li class="goods-item">${img}<div class="goods-text">${status ? `<span class="goods-status ${cls}">${escapeHtml(status)}</span>` : ''}<h3>${title}</h3>${it.price ? `<p class="goods-price">${escapeHtml(it.price)}</p>` : ''}${it.note ? textToHtml(it.note) : ''}</div></li>`;
}

// 管理画面で書くのはふつうの文章。空行で段落、改行はそのまま、URL とメールアドレスはリンクにする
export function textToHtml(text) {
  return String(text)
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((para) => `<p>${para.split('\n').map(linkify).join('<br />')}</p>`)
    .join('');
}

function linkify(line) {
  return escapeHtml(line)
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => `<a href="mailto:${m}">${m}</a>`);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
