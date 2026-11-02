// 部屋の中のクリック対象（hotspot）ごとのパネル内容。
// キーは Blender のオブジェクト名 `hs_<キー>` と対応する。
export const SECTIONS = {
  about: {
    label: 'About',
    kicker: 'Bookshelf',
    title: 'About',
    body: `
      <p>ここにスタジオの紹介文が入ります。QUIMAGLET OFFICIAL STUDIO が何をしている場所なのか、どんな人たちがいるのかを書きます。</p>
      <p>本棚にはスタジオの歩みが詰まっています。</p>
    `,
  },
  works: {
    label: 'Works',
    kicker: 'Desk',
    title: 'Works',
    body: `
      <p>ここに制作実績が入ります。</p>
      <ul>
        <li>Project A — 2026</li>
        <li>Project B — 2025</li>
        <li>Project C — 2025</li>
      </ul>
    `,
  },
  news: {
    label: 'News',
    kicker: 'Poster',
    title: 'News',
    body: `
      <p><strong>2026.11.01</strong><br />ウェブサイトを公開しました。</p>
      <p><strong>2026.10.15</strong><br />ここにお知らせが入ります。</p>
    `,
  },
  contact: {
    label: 'Contact',
    kicker: 'Telephone',
    title: 'Contact',
    body: `
      <p>お仕事のご相談・お問い合わせはこちらから。</p>
      <p><a href="mailto:hello@example.com">hello@example.com</a></p>
    `,
  },
};

// 2 台目のロボットが奥の壁（メニューの下）に映す、最新のお知らせ（newsProjector.js）。
// image は public/ に置いた画像のパス（例: 'images/news-latest.jpg'）。null なら仮のサムネイルを描く
export const LATEST_NEWS = {
  date: '2026.11.01',
  title: 'QUIMAGLET OFFICIAL STUDIO のウェブサイトを公開しました',
  body: 'スタジオの中をそのまま歩くように見て回れる、新しいウェブサイトを公開しました。壁のメニューを押すと、ロボットが各ページを映してくれます。ここに最新のお知らせの本文が入ります。',
  image: null,
};
