// タイル可能（周期つき）な value noise と fbm

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed) {
  const rand = mulberry32(seed);
  const SIZE = 1024;
  const values = new Float32Array(SIZE * SIZE).map(() => rand());
  const mod = (a, m) => ((a % m) + m) % m;
  const fade = (t) => t * t * (3 - 2 * t);

  // 格子 (px, py) ごとに繰り返す。px, py は整数（小数だと値の参照が壊れる）
  function noise(x, y, px, py) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = fade(x - xi);
    const fy = fade(y - yi);
    const x0 = mod(xi, px);
    const x1 = mod(xi + 1, px);
    const y0 = mod(yi, py);
    const y1 = mod(yi + 1, py);
    const v = (i, j) => values[(j % SIZE) * SIZE + (i % SIZE)];
    const a = v(x0, y0) + (v(x1, y0) - v(x0, y0)) * fx;
    const b = v(x0, y1) + (v(x1, y1) - v(x0, y1)) * fx;
    return a + (b - a) * fy;
  }

  function fbm(x, y, px, py, octaves = 4) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f, y * f, px * f, py * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  return { noise, fbm };
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// 高さマップ → OpenGL 形式（緑 = 上）の法線マップ。端はタイルとして回り込む
export function heightToNormal(height, w, h, strength) {
  const out = new Uint8Array(w * h * 3);
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const du = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
      const dv = (at(x, y - 1) - at(x, y + 1)) * 0.5 * strength;
      const len = Math.hypot(du, dv, 1);
      const i = (y * w + x) * 3;
      out[i] = Math.round((-du / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((-dv / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
    }
  }
  return out;
}

export const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
