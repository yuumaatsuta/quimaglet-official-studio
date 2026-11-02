import { ABOUT, escapeHtml } from './content.js';

// About を開いたときの画面。部屋の上に、画面いっぱいの文字が現れる。
// 左に壁ぞろえでメインの文章を流し、残りを quimaglet にまつわる言葉で大小ばらばらに埋め尽くす。
// スクロールで読み進める。後ろの部屋はうっすら見えたまま（ロボットがのぞきに来るのが見える）

// 言葉の敷き詰め方。1 行ずつ高さを決め、その高さで言葉（または小さな言葉を縦に積んだ束・縦書き）を並べ、
// 行の幅にぴったり合うよう、行ごと拡大縮小する（新聞の見出しを詰めたように、すき間なく埋まる）
const FILL = {
  rows: [
    // [割合, 行の高さの最小, 最大]（px）
    [0.22, 70, 140],
    [0.38, 34, 62],
    [0.4, 16, 28],
  ],
  stack: 0.38, // 高い行で、小さな言葉を縦に積んだ束にする割合
  vertical: 0.18, // 高い行で、短い日本語を縦書きにする割合
  invert: 0.05, // 白地に黒の言葉の割合
  rule: 0.1, // 上下に罫線を引く割合
  gap: 6, // 言葉どうしの横のすき間（px）
  rowGap: 3, // 行どうしのすき間（px）
  font: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif',
};

export function createAboutView({ onOpen, onClose } = {}) {
  const root = document.createElement('div');
  root.id = 'about-view';
  root.className = 'about-view';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'About');
  root.innerHTML = `
    <div class="about-scroll">
      <div class="about-page">
        <div class="about-main"></div>
        <div class="about-fill" aria-hidden="true"></div>
      </div>
    </div>
    <button type="button" class="about-close" aria-label="閉じる">×</button>`;
  document.body.append(root);
  const scroller = root.querySelector('.about-scroll');
  const page = root.querySelector('.about-page');
  const main = root.querySelector('.about-main');
  const fill = root.querySelector('.about-fill');
  const closeButton = root.querySelector('.about-close');
  let open = false;
  let returnFocus = null;
  let closeTimer = 0;

  function render() {
    // メインの文章：空行で段落。最初の段落は大きな見出しにする
    const paras = String(ABOUT.main).trim().split(/\n\s*\n/).filter(Boolean);
    main.innerHTML = paras
      .map((p, i) => {
        const lines = p.split('\n').map((l) => escapeHtml(l)).join('<br />');
        const latin = /^[\x00-\x7F\s―—'’.,!?:;()-]+$/.test(p);
        return `<p class="${i === 0 ? 'about-title' : latin ? 'about-en' : ''}" style="--d:${Math.min(i * 90, 1400)}ms">${lines}</p>`;
      })
      .join('');
    renderFill();
  }

  // 埋め尽くす言葉：行の幅にぴったり合わせて詰めながら、メインの文章の高さ（スマホは画面全体）まで並べる
  function renderFill() {
    fill.innerHTML = '';
    const cs = getComputedStyle(fill);
    const width = fill.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 10;
    if (width < 50) return;
    const target = Math.max(main.offsetHeight, scroller.clientHeight - 120) + 40;
    const words = ABOUT.fill.length ? ABOUT.fill : ['QUIMAGLET'];
    const r = rand(1234);
    let queue = [];
    let pass = 0;
    const next = () => {
      if (!queue.length) queue = shuffle(words, pass++ * 97 + 13);
      return String(queue.shift());
    };
    const frag = document.createDocumentFragment();
    let height = 0;
    let n = 0;
    while (height < target && n < 4000) {
      // 行の高さ
      let pick = r();
      let H = 24;
      for (const [share, lo, hi] of FILL.rows) {
        if ((pick -= share) <= 0) {
          H = lo + r() * (hi - lo);
          break;
        }
      }
      const cells = [];
      let used = 0;
      while (used < width) {
        const cell = makeCell(next, H, r);
        cells.push(cell);
        used += cell.w + (cells.length > 1 ? FILL.gap : 0);
        n += cell.words;
      }
      // 行の幅にぴったり合わせる。はみ出しすぎるなら最後の 1 つを外して、広げて合わせる
      const gaps = (k) => FILL.gap * (k - 1);
      const sum = (list) => list.reduce((a, c) => a + c.w, 0);
      let k = (width - gaps(cells.length)) / sum(cells);
      if (k < 0.78 && cells.length > 1) {
        const fewer = cells.slice(0, -1);
        const k2 = (width - gaps(fewer.length)) / sum(fewer);
        if (k2 < 1.5) {
          cells.pop();
          k = k2;
        }
      }
      const row = document.createElement('div');
      row.className = 'fill-row';
      row.style.height = `${(H * k).toFixed(1)}px`;
      for (const cell of cells) row.append(cell.render(k, n++));
      frag.append(row);
      height += H * k + FILL.rowGap;
    }
    fill.append(frag);
  }

  // 1 つの枠：言葉 1 つ（横書き）／小さな言葉を縦に積んだ束／縦書き。w はその枠の幅（px）
  function makeCell(next, H, r) {
    const roll = r();
    if (H > 60 && roll < FILL.stack) {
      const count = H > 100 ? 3 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2);
      const fs = (H / count) * 0.92;
      const texts = Array.from({ length: count }, next);
      const w = Math.max(...texts.map((t) => measure(t, fs)));
      return { w, words: count, render: (k, i) => stackEl(texts, fs * k, i, r) };
    }
    const text = next();
    const len = [...text].length;
    if (H > 60 && roll < FILL.stack + FILL.vertical && isJapanese(text) && len >= 2 && len <= 8) {
      const fs = (H / len) * 0.98;
      return { w: fs, words: 1, render: (k, i) => wordEl(text, fs * k, i, r, true) };
    }
    const fs = H * 0.9;
    return { w: measure(text, fs), words: 1, render: (k, i) => wordEl(text, fs * k, i, r, false) };
  }

  function wordEl(text, fs, i, r, vertical) {
    const el = document.createElement('span');
    el.textContent = isJapanese(text) ? text : text.toUpperCase();
    el.style.fontSize = `${fs.toFixed(1)}px`;
    el.style.setProperty('--o', (0.55 + r() * 0.45).toFixed(2));
    el.style.setProperty('--d', `${Math.min(i * 6, 1300)}ms`);
    if (vertical) el.classList.add('is-vertical');
    const deco = r();
    if (deco < FILL.invert) el.classList.add('is-invert');
    else if (deco < FILL.invert + FILL.rule) el.classList.add('is-rule');
    return el;
  }

  function stackEl(texts, fs, i, r) {
    const box = document.createElement('div');
    box.className = 'fill-stack';
    for (const t of texts) box.append(wordEl(t, fs, i++, r, false));
    return box;
  }

  function show() {
    if (open) return;
    open = true;
    clearTimeout(closeTimer);
    returnFocus = document.activeElement;
    root.hidden = false;
    root.classList.remove('is-closing');
    render();
    scroller.scrollTop = 0;
    // 明朝の字体が届いたら、測り直して詰め直す（届く前は代わりの字体の幅で並べている）
    const text = [ABOUT.main, ...ABOUT.fill].join('').toUpperCase();
    document.fonts
      ?.load(`900 40px ${FILL.font}`, text)
      .then(() => open && renderFill())
      .catch(() => {});
    // 1 フレーム待ってから現れるアニメーションを始める
    requestAnimationFrame(() => root.classList.add('is-open'));
    closeButton.focus({ preventScroll: true });
    history.replaceState(null, '', '#about');
    onOpen?.();
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    history.replaceState(null, '', location.pathname + location.search);
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.();
    closeTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-closing');
    }, 450);
  }

  closeButton.addEventListener('click', hide);
  addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  // 画面の大きさが変わったら、埋める言葉の量を合わせ直す
  let resizeTimer = 0;
  addEventListener('resize', () => {
    if (!open) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderFill, 200);
  });
  page.addEventListener('click', (e) => e.stopPropagation());

  return {
    open: show,
    close: hide,
    get isOpen() {
      return open;
    },
  };
}

// 言葉の幅（px）。canvas で同じ字体の幅を測る
const ctx = document.createElement('canvas').getContext('2d');
function measure(text, fs) {
  const t = isJapanese(text) ? text : text.toUpperCase();
  ctx.font = `900 100px ${FILL.font}`;
  return (ctx.measureText(t).width * fs) / 100;
}

function isJapanese(text) {
  return /[぀-ヿ一-鿿]/.test(text);
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
