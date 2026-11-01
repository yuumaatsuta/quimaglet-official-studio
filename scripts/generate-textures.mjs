// 部屋のテクスチャを public/textures/ に書き出す。
//   node scripts/generate-textures.mjs
// 実写のテクスチャに差し替えるときは、同じファイル名・同じ実寸で置き換えればよい。

import { mkdirSync } from 'node:fs';
import { clamp01, createNoise, heightToNormal, mulberry32, smoothstep, toByte } from './lib/noise.mjs';
import { writePNG } from './lib/png.mjs';

const OUT = new URL('../public/textures/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const out = (name) => new URL(name, OUT);

concrete();
wood();
shelfWood();
shutter();
paving();
outside();

// ---------------------------------------------------------------------------
// 打ち放しコンクリート：7.2m × 3.6m（型枠 1800×900 が 4 列 × 4 段）
// ---------------------------------------------------------------------------
function concrete() {
  const W = 1024;
  const H = 512;
  const COLS = 4;
  const ROWS = 4;
  const pw = W / COLS;
  const ph = H / ROWS;
  const HOLE_R = 2.6; // ≒ 18mm
  const { fbm, noise } = createNoise(11);
  const rand = mulberry32(5);

  const tone = Array.from({ length: COLS * ROWS }, () => (rand() - 0.5) * 0.07);
  // 型枠ごとのわずかな打ちムラ（上下方向のグラデーション）
  const tilt = Array.from({ length: COLS * ROWS }, () => (rand() - 0.5) * 0.05);

  const albedo = new Uint8Array(W * H * 3);
  const rough = new Uint8Array(W * H);
  const height = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const pi = Math.floor(x / pw);
      const pj = Math.floor(y / ph);
      const panel = pj * COLS + pi;
      const lx = x - pi * pw;
      const ly = y - pj * ph;

      const big = fbm(u * 5, v * 5, 5, 5, 5);
      const mid = fbm(u * 40, v * 40, 40, 40, 3);
      const fine = noise(u * 900, v * 450, 900, 450);
      const grain = rand();
      // 雨垂れのような縦方向のムラ
      const streak = smoothstep(0.55, 0.85, fbm(u * 36, v * 2, 36, 2, 3));

      let L = 0.69;
      L += (big - 0.5) * 0.13;
      L += (mid - 0.5) * 0.06;
      L += (fine - 0.5) * 0.035;
      L += (grain - 0.5) * 0.03;
      L += tone[panel] + tilt[panel] * (ly / ph - 0.5);
      L -= streak * 0.035;

      let h = 0.5 + (mid - 0.5) * 0.25 + (fine - 0.5) * 0.15 + (grain - 0.5) * 0.06;
      let r = 0.86 + (mid - 0.5) * 0.12;

      // 型枠の継ぎ目
      const dx = Math.min(lx, pw - lx);
      const dy = Math.min(ly, ph - ly);
      const dj = Math.min(dx, dy);
      if (dj < 1.6) {
        const k = 1 - dj / 1.6;
        L -= 0.12 * k;
        h -= 0.55 * k;
      } else if (dj < 3) {
        L += 0.015; // 継ぎ目脇のわずかなノロ
      }

      // セパ穴（パネルあたり 4 × 2）
      const cx = (Math.floor((lx / pw) * 4) + 0.5) * (pw / 4);
      const cy = (Math.floor((ly / ph) * 2) + 0.5) * (ph / 2);
      const dh = Math.hypot(lx - cx, ly - cy);
      if (dh < HOLE_R) {
        const k = dh / HOLE_R;
        L = 0.2 + 0.18 * k * k;
        h -= 1.2 * (1 - k * k);
        r = 0.95;
      } else if (dh < HOLE_R + 2.5) {
        L -= 0.04 * (1 - (dh - HOLE_R) / 2.5);
      }

      // 気泡（ピンホール）
      if (grain < 0.0035) {
        L -= 0.16;
        h -= 0.5;
      }

      const i = y * W + x;
      albedo[i * 3] = toByte(L * 1.0);
      albedo[i * 3 + 1] = toByte(L * 0.985);
      albedo[i * 3 + 2] = toByte(L * 0.955);
      rough[i] = toByte(clamp01(r));
      height[i] = h;
    }
  }

  writePNG(out('concrete_albedo.png'), W, H, 3, albedo);
  writePNG(out('concrete_normal.png'), W, H, 3, heightToNormal(height, W, H, 2.2));
  writePNG(out('concrete_roughness.png'), W, H, 1, rough);
  console.log('concrete: 7.2m x 3.6m');
}

// ---------------------------------------------------------------------------
// フローリング：1.0m（板 10 枚）× 2.0m。板は縦（テクスチャの v 方向）に流れる
// ---------------------------------------------------------------------------
function wood() {
  const W = 512;
  const H = 1024;
  const PLANKS = 10;
  const pw = W / PLANKS;
  const { fbm } = createNoise(23);
  const rand = mulberry32(9);

  // 列ごとに板の継ぎ目位置を決める（縦にタイルするよう周期 H で閉じる）
  const columns = [];
  let boardId = 0;
  for (let c = 0; c < PLANKS; c++) {
    const start = rand() * H;
    const cuts = [start];
    let p = start;
    for (;;) {
      const len = 460 + rand() * 460;
      if (p + len > start + H - 260) break;
      p += len;
      cuts.push(p);
    }
    cuts.push(start + H);
    const boards = cuts.slice(0, -1).map(() => ({
      id: boardId++,
      tone: rand(),
      dark: rand() < 0.12,
    }));
    columns.push({ cuts, boards });
  }

  const albedo = new Uint8Array(W * H * 3);
  const rough = new Uint8Array(W * H);
  const height = new Float32Array(W * H);
  const light = [196, 116, 42];
  const deep = [150, 74, 22];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = Math.min(PLANKS - 1, Math.floor(x / pw));
      const col = columns[c];
      const lx = x - c * pw;
      // y を start 基準の位置に直して、どの板かを探す
      let yy = y;
      if (yy < col.cuts[0]) yy += H;
      let b = 0;
      while (b < col.boards.length - 1 && yy >= col.cuts[b + 1]) b++;
      const board = col.boards[b];
      const fromEnd = Math.min(yy - col.cuts[b], col.cuts[b + 1] - yy);

      const nx = (x / W) * 128;
      const ny = (y / H) * 6 + board.id * 3;
      const grain = fbm(nx, ny, 128, 6, 4);
      // 板の中での位置（m）から板目を描く。板ごとに芯からの距離を変える
      const fig = woodFigure(fbm, (yy - col.cuts[b]) / 512, lx * (0.1 / pw), board.id, null);

      const t = 0.35 + board.tone * 0.4 + (grain - 0.5) * 0.35;
      let rgb = deep.map((d, i) => d + (light[i] - d) * clamp01(t));
      let k = 0.95 + grain * 0.1 - fig.late * 0.16 - fig.pore * 0.07;
      if (board.dark) k *= 0.9;

      let h = 0.5 + (grain - 0.5) * 0.05 - fig.late * 0.05 - fig.pore * 0.12;
      let r = 0.32 + board.tone * 0.1 + fig.pore * 0.15;

      // 板の側面と端の継ぎ目
      const edge = Math.min(lx, pw - lx, fromEnd);
      if (edge < 1) {
        k *= 0.45;
        h -= 0.8;
        r = 0.7;
      } else if (edge < 3) {
        k *= 0.94;
        h -= 0.15 * (1 - (edge - 1) / 2);
      }

      const i = y * W + x;
      albedo[i * 3] = Math.min(255, Math.round(rgb[0] * k));
      albedo[i * 3 + 1] = Math.min(255, Math.round(rgb[1] * k));
      albedo[i * 3 + 2] = Math.min(255, Math.round(rgb[2] * k));
      rough[i] = toByte(clamp01(r));
      height[i] = h;
    }
  }

  writePNG(out('wood_albedo.png'), W, H, 3, albedo);
  writePNG(out('wood_normal.png'), W, H, 3, heightToNormal(height, W, H, 3));
  writePNG(out('wood_roughness.png'), W, H, 1, rough);
  console.log('wood: 1.0m x 2.0m');
}

// 板目（フラットソーン）の模様。丸太の年輪を板の面で切った形をそのまま計算する：
// 芯からの距離 = √(板面までの距離² + 横方向²)。板面までの距離が長さ方向にゆらぐので
// 山形（タケノコ状）の模様になる。along / across は m。
// period を渡すと長さ方向に周期的になる（タイル用）
function woodFigure(fbm, along, across, seed, period, rings = 190, sway = 1) {
  const s = seed * 1.618;
  const wave = period
    ? sway * (0.03 * Math.sin((2 * Math.PI * along) / period + s) + 0.012 * Math.sin((4 * Math.PI * along) / period + s * 2))
    : sway * (0.03 * Math.sin(along * 1.9 + s) + 0.012 * Math.sin(along * 4.3 + s * 2));
  const d0 = 0.06 + ((seed * 0.37) % 1) * 0.12;
  const c0 = ((seed * 0.53) % 1) * 0.1 - 0.05;
  const px = period ? Math.round(period * 6) : 64;
  const warp = (fbm(((along / (period ?? 10.67)) * px) % 1e6, across * 8 + seed * 5, px, 1e6, 3) - 0.5) * 0.012;
  const dist = Math.hypot(d0 + wave, across - c0) + warp;
  const f = (((dist * rings) % 1) + 1) % 1;
  // 晩材（濃い年輪の線）：片側がくっきり、反対側がぼける
  const late = smoothstep(0.55, 0.86, f) * (1 - smoothstep(0.9, 1.0, f));
  // 導管：木目に沿った細かい筋
  const pp = period ? Math.round(period * 10) : 100;
  const pore = smoothstep(0.6, 0.75, fbm(((along / (period ?? 10)) * pp) % 1e6, across * 700 + seed * 13, pp, 1e6, 2));
  return { late, pore };
}

// ---------------------------------------------------------------------------
// 升目棚の木：2.4m（木目の方向）× 1.2m。明るい飴色の板目
// ---------------------------------------------------------------------------
function shelfWood() {
  const W = 1024;
  const H = 512;
  const ALONG = 2.4;
  const ACROSS = 1.2;
  const { fbm } = createNoise(41);
  const albedo = new Uint8Array(W * H * 3);
  const rough = new Uint8Array(W * H);
  const height = new Float32Array(W * H);
  const light = [218, 148, 72];
  const late = [160, 90, 36];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const along = (x / W) * ALONG;
      const across = (y / H) * ACROSS - ACROSS / 2;
      const fig = woodFigure(fbm, along, across, 3, ALONG, 85, 2.2);
      const tone = fbm((x / W) * 3, (y / H) * 6, 3, 6, 3);
      const base = light.map((v) => v * (0.9 + tone * 0.18));
      const rgb = base.map((v, i) => v + (late[i] - v) * fig.late * 0.7);
      const k = 1 - fig.pore * 0.08;
      const i = y * W + x;
      albedo[i * 3] = Math.min(255, Math.round(rgb[0] * k));
      albedo[i * 3 + 1] = Math.min(255, Math.round(rgb[1] * k));
      albedo[i * 3 + 2] = Math.min(255, Math.round(rgb[2] * k));
      rough[i] = toByte(0.48 + fig.late * 0.08 + fig.pore * 0.2);
      height[i] = 0.5 - fig.late * 0.06 - fig.pore * 0.18;
    }
  }

  writePNG(out('shelf_albedo.png'), W, H, 3, albedo);
  writePNG(out('shelf_normal.png'), W, H, 3, heightToNormal(height, W, H, 2.5));
  writePNG(out('shelf_roughness.png'), W, H, 1, rough);
  console.log('shelf: 2.4m (grain) x 1.2m');
}

// ---------------------------------------------------------------------------
// ガレージシャッター（亜鉛メッキ鋼板）：2m × 2m。雨垂れ・くすみ・小傷
// スラットの凹凸は形状で作るので、ここでは色と光沢のムラだけ
// ---------------------------------------------------------------------------
function shutter() {
  const S = 512;
  const { fbm, noise } = createNoise(57);
  const rand = mulberry32(21);
  const albedo = new Uint8Array(S * S * 3);
  const rough = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const blotch = fbm(u * 6, v * 6, 6, 6, 4);
      // 上から下へ流れる雨垂れ
      const streak = smoothstep(0.5, 0.8, fbm(u * 60, v * 3, 60, 3, 3));
      // 亜鉛メッキの細かなまだら（スパングル）
      const spangle = noise(u * 160, v * 160, 160, 160);
      const scratch = rand() < 0.0015 ? 0.1 : 0;
      let L = 0.62 + (blotch - 0.5) * 0.12 + (spangle - 0.5) * 0.05 - streak * 0.08 + scratch;
      const i = y * S + x;
      albedo[i * 3] = toByte(L * 0.97);
      albedo[i * 3 + 1] = toByte(L * 0.99);
      albedo[i * 3 + 2] = toByte(L * 1.0);
      rough[i] = toByte(0.42 + (blotch - 0.5) * 0.2 + streak * 0.2 + (spangle - 0.5) * 0.08);
    }
  }
  writePNG(out('shutter_albedo.png'), S, S, 3, albedo);
  writePNG(out('shutter_roughness.png'), S, S, 1, rough);
  console.log('shutter: 2m x 2m');
}

// ---------------------------------------------------------------------------
// 窓の外の景色：街並みと木々（横 2048 × 縦 768、水平線は上から 58%）。
// 空は天気に合わせてシェーダーで描くので、ここでは透明にしておく
// ---------------------------------------------------------------------------
function outside() {
  const W = 2048;
  const H = 768;
  const HORIZON = Math.round(H * 0.58);
  const { fbm } = createNoise(31);
  const rand = mulberry32(17);
  const img = new Uint8Array(W * H * 4);
  const set = (x, y, c) => {
    const i = (y * W + x) * 4;
    img[i] = Math.round(c[0]);
    img[i + 1] = Math.round(c[1]);
    img[i + 2] = Math.round(c[2]);
    img[i + 3] = 255;
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const haze = [214, 222, 228];

  // 遠くの街並み（霞んだ高層ビル）
  const skyline = new Float32Array(W).fill(HORIZON);
  const shade = new Float32Array(W);
  let x = 0;
  while (x < W) {
    const w = 12 + rand() * 46;
    const tall = rand() < 0.12;
    const hgt = tall ? 50 + rand() * 90 : 6 + rand() * 34;
    const s = rand();
    for (let i = Math.floor(x); i < Math.min(W, x + w); i++) {
      if (HORIZON - hgt < skyline[i]) {
        skyline[i] = HORIZON - hgt;
        shade[i] = s;
      }
    }
    x += w + (rand() < 0.4 ? rand() * 60 : 0);
  }
  for (let xx = 0; xx < W; xx++) {
    for (let y = Math.floor(skyline[xx]); y < HORIZON; y++) {
      const base = mix([158, 170, 184], [190, 198, 206], shade[xx]);
      const win = (y + xx) % 7 === 0 ? 6 : 0;
      set(xx, y, mix(base.map((v) => v - win), haze, 0.2));
    }
  }

  // 木々（手前ほど濃く、水平線付近は霞む）
  for (let xx = 0; xx < W; xx++) {
    const top = HORIZON + 6 - 22 * fbm((xx / W) * 40, 0.5, 40, 1, 4);
    for (let y = Math.max(0, Math.floor(top)); y < H; y++) {
      const n = fbm((xx / W) * 90, (y / H) * 34, 90, 34, 5);
      const n2 = fbm((xx / W) * 12, (y / H) * 5, 12, 5, 3);
      const d = clamp01((y - HORIZON) / (H - HORIZON));
      let c = mix([46, 78, 44], [128, 160, 86], n * 0.8 + n2 * 0.3);
      c = mix(c, [170, 182, 178], 0.5 * (1 - d) * (1 - d));
      set(xx, y, c);
    }
  }

  writePNG(out('outside_land.png'), W, H, 4, img);
  console.log('outside_land: horizon at 58%, sky transparent');
}

// ---------------------------------------------------------------------------
// バルコニーの石畳：1.2m × 1.2m。300×600 の石板を半枚ずらしで張る（馬目地）。
// 石ごとに色味を変え、花崗岩の粒・表面の凹凸・角の面取り・目地を入れる
// ---------------------------------------------------------------------------
function paving() {
  const S = 512;
  const ROWS = 4; // 1 段 300mm
  const PER_ROW = 2; // 1 枚 600mm
  const JOINT = 3.5; // ≒ 8mm
  const CHAMFER = 3;
  const { fbm, noise } = createNoise(73);
  const rand = mulberry32(31);
  const palette = [
    [178, 172, 162],
    [162, 157, 149],
    [190, 183, 170],
    [152, 148, 142],
    [172, 162, 148],
  ];
  const stones = Array.from({ length: ROWS * PER_ROW }, () => ({
    color: palette[Math.floor(rand() * palette.length)],
    tone: (rand() - 0.5) * 0.08,
    seed: rand() * 50,
  }));

  const albedo = new Uint8Array(S * S * 3);
  const rough = new Uint8Array(S * S);
  const height = new Float32Array(S * S);
  const rowH = S / ROWS;
  const tileW = S / PER_ROW;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const row = Math.floor(y / rowH);
      const xs = (x + (row % 2) * (tileW / 2)) % S;
      const col = Math.floor(xs / tileW);
      const stone = stones[row * PER_ROW + col];
      const lx = xs - col * tileW;
      const ly = y - row * rowH;
      const edge = Math.min(lx, tileW - lx, ly, rowH - ly);

      const u = x / S;
      const v = y / S;
      // 石の中で連続する座標（xs）で描き、テクスチャの継ぎ目をまたぐ石でも柄が切れないように
      const blotch = fbm((xs / S) * 8 + stone.seed, v * 8, 1e6, 8, 4);
      const grainN = noise(u * 300, v * 300, 300, 300);
      const speck = rand();

      let L = 1 + stone.tone + (blotch - 0.5) * 0.18 + (grainN - 0.5) * 0.1;
      if (speck < 0.06) L *= 0.72; // 黒い粒（雲母・角閃石）
      else if (speck > 0.97) L *= 1.12; // 白い粒（石英）
      let rgb = stone.color.map((c) => c * L);
      let h = 0.6 + (grainN - 0.5) * 0.12 + (blotch - 0.5) * 0.06;
      let r = 0.78 + (blotch - 0.5) * 0.12;

      if (edge < JOINT / 2) {
        // 目地（モルタル）
        const m = 0.9 + (grainN - 0.5) * 0.15;
        rgb = [118, 114, 108].map((c) => c * m);
        h = 0.05;
        r = 0.95;
      } else if (edge < JOINT / 2 + CHAMFER) {
        // 角の面取り：目地へ向かって下がり、少し暗くなる
        const k = (edge - JOINT / 2) / CHAMFER;
        h = 0.2 + (h - 0.2) * k;
        rgb = rgb.map((c) => c * (0.85 + 0.15 * k));
      }

      const i = y * S + x;
      albedo[i * 3] = Math.min(255, Math.round(rgb[0]));
      albedo[i * 3 + 1] = Math.min(255, Math.round(rgb[1]));
      albedo[i * 3 + 2] = Math.min(255, Math.round(rgb[2]));
      rough[i] = toByte(clamp01(r));
      height[i] = h;
    }
  }

  writePNG(out('paving_albedo.png'), S, S, 3, albedo);
  writePNG(out('paving_normal.png'), S, S, 3, heightToNormal(height, S, S, 4));
  writePNG(out('paving_roughness.png'), S, S, 1, rough);
  console.log('paving: 1.2m x 1.2m (300x600 stones)');
}
