// About を開いたときの画面。バンドが作った 1 見開きのデザイン（public/images/about-*.webp）を、
// 部屋の上に映す。映り始めと、映っている間ときどき、ノイズが走って絵が乱れる（エラーのような乱れ）。
// 横長の画面では見開き全体を画面に収め、縦長の画面（スマホ）では高さを合わせて横へスクロールして読む。
// 絵の外を押す・閉じるボタン・Esc で閉じる

const SHEET = {
  ratio: 4152 / 2921, // 元のデザインの縦横比
  src: 'images/about-3200.webp',
  srcset: 'images/about-1800.webp 1800w, images/about-3200.webp 3200w',
};

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
<p>Because I myself constantly live with such a sense of loneliness, I write my songs with the hope that they—infused with my own deepest feelings—will reach others who carry that same loneliness.</p>`;

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
        <img class="about-sheet" alt="" decoding="async"
          src="${base}${SHEET.src}"
          srcset="${SHEET.srcset.replace(/images\//g, `${base}images/`)}" />
        <div class="sr-only">${TEXT}</div>
      </div>
    </div>
    <canvas class="about-noise" aria-hidden="true"></canvas>
    <button type="button" class="about-close" aria-label="About を閉じる">× CLOSE</button>`;
  document.body.append(root);
  const noise = root.querySelector('.about-noise');
  const nctx = noise.getContext('2d');
  const scroller = root.querySelector('.about-scroll');
  const page = root.querySelector('.about-page');
  const sheet = root.querySelector('.about-sheet');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let open = false;
  let returnFocus = null;
  let closeTimer = 0;
  let raf = 0;

  // ---------- 大きさ ----------

  // 横長の画面：見開き全体を収める。縦長の画面：高さを合わせ、横へスクロールして読む
  function layout() {
    const narrow = innerWidth < 720;
    const top = narrow ? 70 : 86; // ロゴとメニューの下から
    const bottom = narrow ? 70 : 64; // 閉じるボタンの上まで
    const side = narrow ? 12 : 32;
    const availW = innerWidth - side * 2;
    const availH = innerHeight - top - bottom;
    const portrait = innerWidth < innerHeight;
    const h = portrait ? availH : Math.min(availH, availW / SHEET.ratio);
    const w = h * SHEET.ratio;
    sheet.style.width = `${w.toFixed(0)}px`;
    sheet.style.height = `${h.toFixed(0)}px`;
    page.style.padding = `${top}px ${side}px ${bottom}px`;
    // srcset は表示幅で選ばせる
    sheet.sizes = `${Math.ceil(w)}px`;
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
      sheet.style.transform = `translate3d(${shift.toFixed(1)}px, 0, 0) skewX(${((Math.random() - 0.5) * 2).toFixed(2)}deg)`;
      page.classList.add('is-glitch');
    } else if (page.classList.contains('is-glitch')) {
      sheet.style.transform = '';
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
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.();
    closeTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-closing');
      cancelAnimationFrame(raf);
    }, 420);
  }

  // 絵の外を押したら閉じる（スクロールのためのドラッグでは click が来ないので閉じない）
  root.addEventListener('click', (e) => {
    if (e.target.closest('.about-close') || !e.target.closest('.about-sheet')) hide();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && hide());
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
