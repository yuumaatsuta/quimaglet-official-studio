import { ABOUT, escapeHtml } from './content.js';

// About を開いたときの画面。部屋（カメラの映像）の上に、ノイズ混じりで文字が映り込む。
// 本文（日本語の文章）とまわりの言葉（英語の短い文が中心）を同じ書体・同じ白でひとつの構成に組み、
// 本文がほかの文字に溶け込むようにする。余白は広めにとり、スクロールで読み進める。
// 映っている間もときどきノイズが走る（エラーのような乱れ）。文字のない所を押すと閉じる

const LAYOUT = {
  rowGap: [9, 20], // 段と段のあいだの余白（画面の高さに対する %）
  mainSpan: { wide: 5, narrow: 6 }, // 本文の幅（列数）。広い画面は 12 列、狭い画面は 6 列
};

const NOISE = {
  scale: 3, // ノイズを何分の 1 の大きさで描いて引き伸ばすか（粗いほど軽い）
  base: 0.09, // ふだんのざらつき
  intro: 0.5, // 映り始めのざらつき
  introSeconds: 1.4,
  burst: 0.38, // ときどき走る乱れの強さ
  burstEvery: [3.5, 8], // 乱れの間隔（秒）
  burstLength: [0.12, 0.42],
};

export function createAboutView({ onOpen, onClose } = {}) {
  const root = document.createElement('div');
  root.id = 'about-view';
  root.className = 'about-view';
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'About');
  root.innerHTML = `
    <canvas class="about-noise" aria-hidden="true"></canvas>
    <div class="about-scroll"><div class="about-page"></div></div>`;
  document.body.append(root);
  const noise = root.querySelector('.about-noise');
  const nctx = noise.getContext('2d');
  const scroller = root.querySelector('.about-scroll');
  const page = root.querySelector('.about-page');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let open = false;
  let returnFocus = null;
  let closeTimer = 0;
  let raf = 0;

  // ---------- 組み版 ----------

  function compose() {
    const narrow = innerWidth < 720;
    const cols = narrow ? 6 : 12;
    page.style.setProperty('--cols', cols);
    const r = rand(2024);
    const paras = String(ABOUT.main).trim().split(/\n\s*\n/).filter(Boolean);
    const fills = shuffle(ABOUT.fill.length ? ABOUT.fill : ['QUIMAGLET'], 11);
    const short = fills.filter((t) => [...t].length <= 18);
    const long = fills.filter((t) => [...t].length > 18);
    let si = 0;
    let li = 0;
    const nextShort = () => (short.length ? short[si++ % short.length] : fills[0]);
    const nextLong = () => (long.length ? long[li++ % long.length] : nextShort());
    let order = 0;

    const rows = [];
    const row = (blocks) => {
      const el = document.createElement('div');
      el.className = 'about-row';
      el.style.marginBottom = `${(LAYOUT.rowGap[0] + r() * (LAYOUT.rowGap[1] - LAYOUT.rowGap[0])).toFixed(1)}vh`;
      for (const b of blocks) el.append(b);
      rows.push(el);
    };
    const block = (text, size, start, span, { main = false, drop = 0 } = {}) => {
      const el = document.createElement(main ? 'p' : 'div');
      el.className = `about-block is-${size}${main ? ' is-main' : ''}`;
      if (!main && isJapanese(text) && [...text].length <= 14 && size !== 's' && r() < 0.5) el.classList.add('is-vertical');
      el.innerHTML = escapeHtml(text);
      el.style.gridColumn = `${start} / span ${Math.max(1, Math.min(span, cols - start + 1))}`;
      if (drop) el.style.marginTop = `${drop.toFixed(1)}vh`;
      el.style.setProperty('--d', `${180 + order++ * 140 + Math.floor(r() * 160)}ms`);
      if (!main) el.setAttribute('aria-hidden', 'true');
      return el;
    };
    const col = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

    // 書き出し：大きな言葉
    row([block(nextShort(), 'xl', narrow ? 1 : col(1, 5), cols)]);

    paras.forEach((p, i) => {
      // 本文は左にそろえる。横の空いた所に、小さな英文をずらして置く
      const span = narrow ? LAYOUT.mainSpan.narrow : LAYOUT.mainSpan.wide;
      const blocks = [block(p, 'm', 1, span, { main: true })];
      if (!narrow) blocks.push(block(nextLong(), r() < 0.5 ? 's' : 'm', col(8, 9), 4, { drop: r() * 14 }));
      row(blocks);
      // 合間：大きな一文か、散らばった小さな文
      if (i === paras.length - 1) return;
      if (r() < 0.5) {
        row([block(nextShort(), r() < 0.5 ? 'xl' : 'l', narrow ? 1 : col(2, 7), cols)]);
      } else if (narrow) {
        row([block(nextLong(), 's', col(2, 3), 4), block(nextShort(), 'l', 1, 6, { drop: 3 })]);
      } else {
        row([
          block(nextLong(), 's', col(1, 3), 3, { drop: r() * 6 }),
          block(nextShort(), 'l', col(5, 6), 4, { drop: r() * 10 }),
          block(nextLong(), 's', col(10, 11), 2, { drop: r() * 16 }),
        ]);
      }
    });

    // 締め：大きな言葉と小さな署名
    row([block(nextShort(), 'xl', narrow ? 1 : col(3, 6), cols)]);
    row([block('© QUIMAGLET', 's', narrow ? 1 : col(9, 10), 3)]);
    page.replaceChildren(...rows);
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
    // 文字の乱れ：横へずれる・色が分かれる・一部が一瞬消える
    if ((bursting || intro > 0.35) && !reducedMotion) {
      const shift = (Math.random() - 0.5) * (bursting ? 14 : 8);
      page.style.transform = `translate3d(${shift.toFixed(1)}px, 0, 0) skewX(${((Math.random() - 0.5) * 3).toFixed(2)}deg)`;
      page.classList.add('is-glitch');
      if (Math.random() < 0.35) {
        const blocks = page.querySelectorAll('.about-block');
        const b = blocks[Math.floor(Math.random() * blocks.length)];
        b?.classList.add('is-off');
        setTimeout(() => b?.classList.remove('is-off'), 60 + Math.random() * 120);
      }
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
    compose();
    scroller.scrollTop = 0;
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

  // 文字のない所を押したら閉じる（スクロールのためのドラッグでは click が来ないので閉じない）
  root.addEventListener('click', (e) => {
    if (!e.target.closest('.about-block')) hide();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  let resizeTimer = 0;
  addEventListener('resize', () => {
    if (!open) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(compose, 200);
  });

  return {
    open: show,
    close: hide,
    get isOpen() {
      return open;
    },
  };
}

function isJapanese(text) {
  return /[぀-ヿ一-鿿]/.test(text);
}

function rr(a, b) {
  return a + Math.random() * (b - a);
}

function rand(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const r = rand(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
