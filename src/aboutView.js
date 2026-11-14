// About を開いたときの画面。バンドが作ったデザインを、部屋の上にそのまま映す（地は透明。写真だけ不透明）。
// 映り始めと、映っている間ときどき、ノイズが走って絵が乱れる（エラーのような乱れ）。
// PC：見開きを 5 つに分けた絵を、画面の四隅とまんなかに置き、文字どうしが重ならない範囲でいちばん大きく映す。
//   横長でも高さが足りない画面（表示拡大 150% のノート PC など）は、PC 版のまま少し縦にスクロールさせる。
// スマホ（縦長の画面や、横幅が狭すぎて PC 用では文字が小さくなりすぎる画面）：縦に長い 1 枚を、幅を合わせて縦へスクロールして読む。
// 文字や写真のない所（透明な所）を押す・Esc で閉じる

// PC 用の 5 枚。w, h は絵の大きさ、ink は文字や写真のある塊（絵の中の矩形 [x, y, 幅, 高さ]）。
// 5 枚とも元の見開きと同じ縮尺なので、同じ倍率で縮めれば文字の大きさがそろう
const PIECES = {
  title: { src: 'about-pc-title.webp', w: 2285, h: 723, ink: [[9, 4, 1449, 288], [2, 336, 2279, 244], [2, 650, 2129, 69]] },
  atsuta: { src: 'about-pc-atsuta.webp', w: 1699, h: 413, ink: [[4, 4, 1691, 405]] },
  center: { src: 'about-pc-center.webp', w: 1997, h: 423, ink: [[10, 4, 1584, 91], [4, 139, 1757, 44], [4, 295, 1989, 124]] },
  mizuki: { src: 'about-pc-mizuki.webp', w: 1129, h: 1699, ink: [[0, 4, 1125, 985], [2, 1048, 694, 91], [2, 1187, 922, 68], [3, 1375, 1075, 324]] },
  asaba: {
    src: 'about-pc-asaba.webp',
    w: 2881,
    h: 2102,
    ink: [[2532, 4, 345, 713], [1613, 801, 1252, 102], [4, 963, 2863, 347], [37, 1395, 2833, 491], [40, 1971, 2829, 131]],
  },
  // 埋め草：画面が横に広く、美月さんと瑛太さんの塊が離れすぎたときだけ、そのあいだに出す（you弑me の一節）
  lyric: { src: 'about-pc-lyric.webp', w: 1055, h: 2313, fill: true },
};
const LYRIC = {
  minWidth: 64, // 空きがこれより狭いなら出さない（px）
  minRatio: 0.3, // 文字の高さが、ほかの絵の倍率のこれ未満にしかできないなら出さない（文字が小さすぎる）
  maxSqueeze: 0.8, // 空きが細いときは、横にここまで縮める（これ以上細いなら全体を小さくする）
};
const PHONE = { src: 'about-sp.webp', w: 1088, h: 9537 };
const PC_MIN_SCALE = 0.2; // これより小さく縮めないと収まらない画面では、スマホ用の縦長の絵にする
const PC_MAX_SCALE = 0.75;

const NOISE = {
  scale: 3, // ノイズを何分の 1 の大きさで描いて引き伸ばすか（粗いほど軽い）
  base: 0.07, // ふだんのざらつき
  intro: 0.5, // 映り始めのざらつき
  introSeconds: 1.2,
  burst: 0.32, // ときどき走る乱れの強さ
  burstEvery: [4, 9], // 乱れの間隔（秒）
  burstLength: [0.1, 0.32],
};

// 絵の中の文字（読み上げ用。見た目は絵）
const TEXT = `
<h2>quimaglet</h2>
<p>quimaglet focuses on creating music that offers companionship to those struggling with feelings of loneliness—the kind that strikes unexpectedly at 2:00 a.m.—or a sense of detachment from society.</p>
<p>不意に訪れる孤独感や、社会との距離感に悩む人に寄り添いたい。</p>
<p>音楽だけでなく、映像・アートワーク・システム・ライブ演出まで独自の世界観を作り出すアーティスト集団。</p>
<p>quimagletは神奈川県相模原市で結成された。quimaglet -きまぐれ- は楽曲のジャンルがアイデンティティのように感じられ無意識に縛られる世の中で、表現したい思想、景色、体験、寄り添いたい人に向けて、広大な音楽の海から常にメンバーの色を活かした気まぐれなジャンルで曲を構成し、歌い上げられるアーティストでありたいという思いからつけられた。</p>
<h3>VoGt. 渡辺 美月（作詞・作曲 / プロモーション）</h3>
<p>Moonfusion. An expansive singing voice and an expressive, emotion-filled delivery.</p>
<h3>GtCho. 熱田 悠馬（作詞・作曲 / アートワーク / エンジニア）</h3>
<p>Responsible for intricate guitar work—blending alternative, jazz, and bossa nova—as well as visual presentation.</p>
<h3>ba. 内田 泰河（編曲 / グッズ企画・デザイン）</h3>
<p>With its distinctive melodic lines and memorable phrases, it elevates the ensemble.</p>
<h3>Key. 浅葉 瑛太（作詞・作曲 / 編曲）</h3>
<p>From a young age, I was intensely preoccupied with the question of why we live, and I went through life harboring a persistent, underlying sense of fear. In hindsight, I realize I grew up in a rather "cushy" environment—one where "happiness" was always close at hand. My family background, in fact, allowed me to take for granted a wide range of experiences. Above all, it was the opportunity to learn the piano that, I believe, shaped me into the musician I am today.</p>
<p>Through the various failures I experienced during my student years, I came to realize that I am, in essence, "nobody"—someone who simply happened to be born to exceptional parents capable of bringing happiness into my immediate life. Since then, the very concept of "self-affirmation" has vanished from my vocabulary; at times, I even feel that my life lacks any inherent value. Because I am unable to love myself and have anchored my purpose for living in others, I consider myself a fragile person. I rely solely on the judgment of those around me, and I am frequently tossed about by an unattainable desire—the longing to be someone's "special" person.</p>
<p>Because I myself constantly live with such a sense of loneliness, I write my songs with the hope that they—infused with my own deepest feelings—will reach others who carry that same loneliness.</p>
<p>I thought I was the one in control, but I became ensnared by words—losing the very things I meant to cherish by lumping them all together under labels like "love." It feels so hollow when words and intentions fail to align. I kept tuning in, frame by frame—even on the days when I couldn't quite get a grip—just to ensure I wouldn't miss a single one of your signals or the messages you sent my way.</p>`;

export function createAboutView({ onOpen, onClose } = {}) {
  const base = import.meta.env.BASE_URL;
  const root = document.createElement('div');
  root.id = 'about-view';
  root.className = 'about-view';
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'About');
  root.innerHTML = `
    <div class="about-scroll">
      <div class="about-page">
        <div class="about-pc">
          ${Object.keys(PIECES).map((k) => `<img class="about-sheet about-piece" data-piece="${k}" alt="" decoding="async" />`).join('')}
        </div>
        <img class="about-sheet about-phone" alt="" decoding="async" />
        <div class="sr-only">${TEXT}</div>
      </div>
    </div>
    <canvas class="about-noise" aria-hidden="true"></canvas>`;
  document.body.append(root);
  const noise = root.querySelector('.about-noise');
  const nctx = noise.getContext('2d');
  const scroller = root.querySelector('.about-scroll');
  const page = root.querySelector('.about-page');
  const pieceEls = Object.fromEntries([...root.querySelectorAll('.about-piece')].map((el) => [el.dataset.piece, el]));
  const phoneEl = root.querySelector('.about-phone');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let open = false;
  let returnFocus = null;
  let closeTimer = 0;
  let raf = 0;

  // ---------- 大きさと置き方 ----------

  let mode = '';

  // 画面の上に重なっているロゴや設定ボタン。絵の文字がこれらに重ならないようにする
  function obstacles(gap) {
    return [...document.querySelectorAll('.site-header .logo img, .settings-toggle')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 4 && r.height > 4)
      .map((r) => ({ x0: r.left - gap, y0: r.top - gap, x1: r.right + gap, y1: r.bottom + gap }));
  }

  // 上の段の絵を、ロゴや設定ボタンと横で重なる文字の塊がその下に来るまで下げる
  function clearTop(piece, x, y, k, obs) {
    for (const [rx, ry, rw] of piece.ink) {
      for (const o of obs) {
        if (x + rx * k < o.x1 && x + (rx + rw) * k > o.x0) y = Math.max(y, o.y1 - ry * k);
      }
    }
    return y;
  }

  // 倍率 k のときの 5 枚の置き場所（画面の座標）。四隅の 4 枚はそれぞれの角に寄せ、
  // まんなかの 1 枚は、上の段と浅葉さんの塊（Key. の見出し）とのあいだに、浅葉さんの文章と左をそろえて置く。
  // beside：題字をロゴの下ではなく右に置く
  function placePieces(k, box, beside) {
    const P = PIECES;
    const logo = box.obs[0];
    const tx = beside && logo ? Math.max(box.l, logo.x1) : box.l;
    const ax = box.r - P.atsuta.w * k;
    const at = {
      title: [tx, clearTop(P.title, tx, box.t, k, box.obs)],
      atsuta: [ax, clearTop(P.atsuta, ax, box.t, k, box.obs)],
      mizuki: [box.l, box.b - P.mizuki.h * k],
      asaba: [box.r - P.asaba.w * k, box.b - P.asaba.h * k],
    };
    const topBottom = Math.max(at.title[1] + P.title.h * k, at.atsuta[1] + P.atsuta.h * k);
    const keyTop = at.asaba[1] + P.asaba.ink[1][1] * k;
    const cx = Math.max(at.asaba[0] + P.asaba.ink[2][0] * k, box.l + P.mizuki.w * k + box.gap);
    const cy = (topBottom + keyTop - P.center.h * k) / 2;
    at.center = [cx, cy];
    return at;
  }

  // 美月さん（左下）と瑛太さん（右下）のあいだの空き。広ければ一節の絵を置く場所 [x, y, 幅, 高さ] を、狭ければ null を返す。
  // 幅は空きいっぱい（左右のブロックとの距離は保つ）。空きが広いほど、絵を横に引き伸ばす
  function placeLyric(at, k, box) {
    const P = PIECES;
    const L = P.lyric;
    const g = box.gap * 1.3;
    const x0 = at.mizuki[0] + P.mizuki.w * k + g;
    const x1 = at.asaba[0] + Math.min(...P.asaba.ink.map((r) => r[0])) * k - g;
    const above = Math.max(at.center[1] + P.center.h * k, at.title[1] + P.title.h * k, at.atsuta[1] + P.atsuta.h * k);
    const y0 = above + g;
    const y1 = box.b;
    const w = x1 - x0;
    // 高さの倍率：ほかの絵と同じ倍率まで。空きが細すぎて横に縮めきれないときは小さくする
    const sy = Math.min(k, (y1 - y0) / L.h, w / (L.w * LYRIC.maxSqueeze));
    if (w < LYRIC.minWidth || sy < k * LYRIC.minRatio) return null;
    const h = L.h * sy;
    // 縦は美月さんの絵と高さのまんなかをそろえる（空きからははみ出さない）
    const mid = at.mizuki[1] + (P.mizuki.h * k) / 2;
    const y = Math.min(Math.max(mid - h / 2, y0), y1 - h);
    return [x0, y, w, h];
  }


  // 文字の塊どうし・ロゴや設定ボタンと重ならず、画面からはみ出さないか
  function fits(k, box, beside) {
    const at = placePieces(k, box, beside);
    const rects = box.obs.map((o) => ({ ...o, name: 'header' }));
    const g = box.gap;
    for (const [name, [x, y]] of Object.entries(at)) {
      for (const [rx, ry, rw, rh] of PIECES[name].ink) {
        const r = { name, x0: x + rx * k, y0: y + ry * k, x1: x + (rx + rw) * k, y1: y + (ry + rh) * k };
        if (r.x0 < box.l - 0.5 || r.x1 > box.r + 0.5 || r.y0 < box.t - 0.5 || r.y1 > box.b + 0.5) return false;
        rects.push(r);
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.name === b.name) continue;
        // ロゴ・設定ボタンのまわりの余白は obstacles() で付けてある
        const m = a.name === 'header' || b.name === 'header' ? 0 : g;
        if (a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m) return false;
      }
    }
    return true;
  }

  function pcScale(box, beside) {
    let lo = 0;
    let hi = PC_MAX_SCALE;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, box, beside)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function setSrc(el, file) {
    if (!el.getAttribute('src')) el.src = `${base}images/${file}`;
  }

  function layout() {
    const W = innerWidth;
    const H = innerHeight;
    const narrow = W < 720;
    const top = narrow ? 70 : 64; // スマホ用：ロゴとメニューの下から
    const side = narrow ? 14 : 16;
    const gap = Math.max(14, W * 0.012);
    const box = { l: side, r: W - side, t: 16, b: H - 12, gap, obs: obstacles(gap * 0.6) };
    // 題字はロゴの下か右か、大きく映せる方に置く
    const below = W >= H ? pcScale(box, false) : 0;
    const right = W >= H ? pcScale(box, true) : 0;
    let k = Math.max(below, right);
    let beside = right > below;
    // 横長の画面（PC）で高さが足りないときは、文字を小さくしすぎず、PC 版の置き方のまま縦に少しスクロールさせる
    let pageH = 0;
    if (k < PC_MIN_SCALE && W >= H && !narrow) {
      const fitsAt = (h) => {
        const b = { ...box, b: h - 12 };
        return pcScale(b, false) >= PC_MIN_SCALE || pcScale(b, true) >= PC_MIN_SCALE;
      };
      let lo = H;
      let hi = H * 3;
      if (fitsAt(hi)) {
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          if (fitsAt(mid)) hi = mid;
          else lo = mid;
        }
        pageH = Math.ceil(hi);
        box.b = pageH - 12;
        const b2 = pcScale(box, false);
        const r2 = pcScale(box, true);
        k = Math.max(b2, r2);
        beside = r2 > b2;
      }
    }
    mode = k >= PC_MIN_SCALE ? 'pc' : 'phone';
    root.dataset.mode = mode;
    if (mode === 'pc') {
      page.style.padding = '';
      page.style.height = pageH ? `${pageH}px` : '';
      const at = placePieces(k, box, beside);
      const lyric = placeLyric(at, k, box);
      if (lyric) at.lyric = lyric;
      for (const [name, el] of Object.entries(pieceEls)) {
        const p = PIECES[name];
        el.hidden = !at[name];
        if (!at[name]) continue;
        const [x, y, w = p.w * k, h = p.h * k] = at[name];
        setSrc(el, p.src);
        el.style.width = `${w.toFixed(1)}px`;
        el.style.height = `${h.toFixed(1)}px`;
        el.style.left = `${x.toFixed(1)}px`;
        el.style.top = `${y.toFixed(1)}px`;
      }
    } else {
      page.style.height = '';
      setSrc(phoneEl, PHONE.src);
      const w = Math.min(W - side * 2, 600);
      phoneEl.style.width = `${w.toFixed(0)}px`;
      phoneEl.style.height = `${((w * PHONE.h) / PHONE.w).toFixed(0)}px`;
      page.style.padding = `${top}px ${side}px 28px`;
    }
  }

  // ---------- ノイズと乱れ ----------

  let t0 = 0;
  let nextBurst = 0;
  let burstEnd = 0;
  let img = null;

  function resizeNoise() {
    const w = Math.ceil(innerWidth / NOISE.scale);
    const h = Math.ceil(innerHeight / NOISE.scale);
    if (noise.width !== w || noise.height !== h || !img) {
      noise.width = w;
      noise.height = h;
      img = nctx.createImageData(w, h);
    }
  }

  function frame(now) {
    if (root.hidden) return;
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    if (t > nextBurst && !reducedMotion && open) {
      burstEnd = t + rr(...NOISE.burstLength);
      nextBurst = burstEnd + rr(...NOISE.burstEvery);
    }
    const bursting = t < burstEnd;
    const intro = Math.max(0, 1 - t / NOISE.introSeconds);
    const level = Math.max(NOISE.base, NOISE.intro * intro * intro, bursting ? NOISE.burst : 0);
    drawNoise(level, bursting || intro > 0.4);
    // 絵の乱れ：横へずれて、色が左右に分かれる
    if ((bursting || intro > 0.35) && !reducedMotion) {
      const shift = (Math.random() - 0.5) * (bursting ? 12 : 8);
      page.style.transform = `translate3d(${shift.toFixed(1)}px, 0, 0) skewX(${((Math.random() - 0.5) * 2).toFixed(2)}deg)`;
      page.classList.add('is-glitch');
    } else if (page.classList.contains('is-glitch')) {
      page.style.transform = '';
      page.classList.remove('is-glitch');
    }
  }

  // 画面全体のざらつき。乱れているときは、横に走る帯も描く
  function drawNoise(level, bands) {
    resizeNoise();
    const d = img.data;
    const w = noise.width;
    const h = noise.height;
    const a = level * 255;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = (Math.random() * a) | 0;
    }
    if (bands) {
      const count = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < count; k++) {
        const y0 = Math.floor(Math.random() * h);
        const bh = 1 + Math.floor(Math.random() * 6);
        const tint = Math.random() < 0.5 ? [255, 255, 255] : [Math.random() < 0.5 ? 255 : 40, 60, 255];
        for (let y = y0; y < Math.min(h, y0 + bh); y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            d[i] = tint[0];
            d[i + 1] = tint[1];
            d[i + 2] = tint[2];
            d[i + 3] = Math.random() * 120;
          }
        }
      }
    }
    nctx.putImageData(img, 0, 0);
  }

  // ---------- 開く・閉じる ----------

  function show() {
    if (open) return;
    open = true;
    clearTimeout(closeTimer);
    returnFocus = document.activeElement;
    root.hidden = false;
    root.classList.remove('is-closing');
    layout();
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    requestAnimationFrame(() => root.classList.add('is-open'));
    root.focus({ preventScroll: true });
    history.replaceState(null, '', '#about');
    t0 = performance.now();
    nextBurst = NOISE.introSeconds + rr(1.5, 3.5);
    burstEnd = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    onOpen?.();
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    // 消えるときも一瞬乱れる
    burstEnd = (performance.now() - t0) / 1000 + 0.35;
    history.replaceState(null, '', location.pathname + location.search);
    document.body.classList.remove('is-about-scrolled');
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.();
    closeTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-closing');
      cancelAnimationFrame(raf);
    }, 420);
  }

  // 押した所が絵の透明な所（文字も写真もない所）か。絵ごとに、読み込んだら一度だけ小さく写して透明度を控えておく
  const masks = new Map();
  for (const el of [...Object.values(pieceEls), phoneEl]) {
    el.addEventListener('load', () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(el.naturalWidth / 8));
      c.height = Math.max(1, Math.round(el.naturalHeight / 8));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(el, 0, 0, c.width, c.height);
      masks.set(el, { w: c.width, h: c.height, a: g.getImageData(0, 0, c.width, c.height).data });
    });
  }
  function onInk(e) {
    const els = mode === 'pc' ? Object.values(pieceEls).filter((el) => !el.hidden) : [phoneEl];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const m = masks.get(el);
      if (!m) return true;
      // 押した所のまわり（文字の隙間を押しても閉じないよう、少し広く）に色があるか
      const cx = Math.floor(u * m.w);
      const cy = Math.floor(v * m.h);
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
          if (m.a[(y * m.w + x) * 4 + 3] > 40) return true;
        }
      }
    }
    return false;
  }
  // 何もない所を押したら閉じる（スクロールのためのドラッグでは click が来ないので閉じない）
  root.addEventListener('click', (e) => {
    if (!onInk(e)) hide();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  // スマホ版をスクロールしている間は、左上のロゴを隠す（文字に重なるので）
  scroller.addEventListener('scroll', () => document.body.classList.toggle('is-about-scrolled', open && scroller.scrollTop > 8), {
    passive: true,
  });
  addEventListener('resize', () => open && layout());

  return {
    open: show,
    close: hide,
    get isOpen() {
      return open;
    },
  };
}

function rr(a, b) {
  return a + Math.random() * (b - a);
}
