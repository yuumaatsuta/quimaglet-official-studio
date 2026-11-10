// 使い方（scratchpad などで puppeteer-core を入れて）: node gen-starsky.mjs stars.8.json mw.json ../tools/texture-src/starsky.jpg（その後 to-ktx2.mjs で public/textures/starsky.ktx2 に）
// データ: d3-celestial（https://github.com/ofrohn/d3-celestial）の data/stars.8.json（ヨール輝星表ほか）と data/mw.json（天の川の輪郭）
// 実際の星表（d3-celestial の stars.8.json / mw.json）から、プロジェクターに載せる星空の画像を作る。
// 画像はプロジェクターの光の円錐（半角 HALF_ANGLE）にそのまま合う心射図法（投影する点から見て正しい角度になる）
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [starsPath, mwPath, out] = process.argv.slice(2);
const stars = JSON.parse(fs.readFileSync(starsPath, 'utf8')).features
  .filter((f) => f.properties.mag <= 7.2)
  .map((f) => [f.geometry.coordinates[0], f.geometry.coordinates[1], f.properties.mag, parseFloat(f.properties.bv) || 0.6]);
const mw = JSON.parse(fs.readFileSync(mwPath, 'utf8')).features.map((f) => ({ id: f.id, polys: f.geometry.coordinates }));
console.log('stars', stars.length, 'mw', mw.map((m) => m.id).join(','));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
});
const page = await browser.newPage();
const url = await page.evaluate(
  ({ stars, mw }) => {
    const N = 2048;
    const HALF = Math.tan(1.0); // planetarium.js の starAngle
    const D = Math.PI / 180;
    // 中心：天の川の銀経 30° あたり（わし座のそば）。上にこと座・はくちょう座、下にいて座・さそり座
    const ra0 = 281.3 * D;
    const de0 = -2.7 * D;
    // 天の川が縦にまっすぐ通るよう、図を回す
    const ROT = -25 * D;
    const toRa = (lon) => (lon < 0 ? lon + 360 : lon) * D;

    function project(lon, lat) {
      const a = toRa(lon) - ra0;
      const de = lat * D;
      const cosc = Math.sin(de0) * Math.sin(de) + Math.cos(de0) * Math.cos(de) * Math.cos(a);
      if (cosc < 0.25) return null;
      const xi = (Math.cos(de) * Math.sin(a)) / cosc;
      const eta = (Math.cos(de0) * Math.sin(de) - Math.sin(de0) * Math.cos(de) * Math.cos(a)) / cosc;
      // 空を見上げた向き：東が左
      const x0 = -xi, y0 = eta;
      const x = x0 * Math.cos(ROT) - y0 * Math.sin(ROT);
      const y = x0 * Math.sin(ROT) + y0 * Math.cos(ROT);
      return [(x / HALF) * 0.5 * N + N / 2, N / 2 - (y / HALF) * 0.5 * N];
    }
    function unproject(px, py) {
      const x = ((px - N / 2) / (0.5 * N)) * HALF;
      const y = ((N / 2 - py) / (0.5 * N)) * HALF;
      const xi = -(x * Math.cos(-ROT) - y * Math.sin(-ROT));
      const eta = x * Math.sin(-ROT) + y * Math.cos(-ROT);
      const rho = Math.hypot(xi, eta);
      if (rho < 1e-9) return [ra0, de0];
      const c = Math.atan(rho);
      const de = Math.asin(Math.cos(c) * Math.sin(de0) + (eta * Math.sin(c) * Math.cos(de0)) / rho);
      const ra = ra0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(de0) * Math.cos(c) - eta * Math.sin(de0) * Math.sin(c));
      return [ra, de];
    }

    // ---- 天の川：段階ごとの輪郭を正距円筒の図に塗り重ね、それを心射図法へ引き直す ----
    const EW = 4096, EH = 2048;
    const eq = document.createElement('canvas');
    eq.width = EW; eq.height = EH;
    const e = eq.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, EW, EH);
    e.globalCompositeOperation = 'lighter';
    for (const level of mw) {
      e.fillStyle = 'rgba(48,48,48,1)';
      // 継ぎ目は赤経 12h。極を囲む輪郭は図の上で閉じないので、あとで銀河の緯度で天の川の帯の外を消す
      for (const poly of level.polys) {
        for (const shift of [0]) {
          e.beginPath();
          for (const ring of poly) {
            let prev = null;
            ring.forEach(([lon, lat], i) => {
              let x = (0.5 - lon / 360) * EW; // 東が左
              prev = x;
              const y = ((90 - lat) / 180) * EH;
              i ? e.lineTo(x + shift, y) : e.moveTo(x + shift, y);
            });
            e.closePath();
          }
          e.fill('evenodd');
        }
      }
    }
    const eqData = e.getImageData(0, 0, EW, EH).data;
    const M = 1024;
    const mwC = document.createElement('canvas');
    mwC.width = mwC.height = M;
    const mc = mwC.getContext('2d');
    const img = mc.createImageData(M, M);
    // まだらにする細かい揺らぎ（暗黒星雲の筋っぽさ）
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vnoise = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.2;
    const mwVal = new Float32Array(M * M);
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < M; x++) {
        const [ra, de] = unproject(((x + 0.5) / M) * N, ((y + 0.5) / M) * N);
        let lonN = ((ra / D) % 360 + 540) % 360 - 180;
        const ex = Math.min(EW - 1, Math.max(0, Math.floor((0.5 - lonN / 360) * EW)));
        const ey = Math.min(EH - 1, Math.max(0, Math.floor(((90 - de / D) / 180) * EH)));
        let v = eqData[(ey * EW + ex) * 4] / 255; // 0〜1（段の重なり）
        // 銀河の緯度 b（天の川の帯は |b| < 25° ほど）
        const sb = Math.sin(de) * Math.sin(27.12825 * D) + Math.cos(de) * Math.cos(27.12825 * D) * Math.cos(ra - 192.85948 * D);
        const gb = Math.abs(Math.asin(Math.max(-1, Math.min(1, sb)))) / D;
        v *= Math.min(1, Math.max(0, (32 - gb) / 10));
        v = Math.pow(v, 1.5) * (0.35 + 1.1 * fbm(x / 34, y / 34));
        mwVal[y * M + x] = v;
        const i = (y * M + x) * 4;
        img.data[i] = Math.min(255, v * 105);
        img.data[i + 1] = Math.min(255, v * 112);
        img.data[i + 2] = Math.min(255, v * 135);
        img.data[i + 3] = 255;
      }
    }
    mc.putImageData(img, 0, 0);

    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(16px)';
    g.drawImage(mwC, 0, 0, N, N);
    g.filter = 'none';

    // 天の川の中の、ひとつひとつは見えない細かい星
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 140000; i++) {
      const x = rnd() * N, y = rnd() * N;
      const v = mwVal[Math.floor((y / N) * M) * M + Math.floor((x / N) * M)];
      if (rnd() > v * 0.9) continue;
      g.fillStyle = `rgba(225,230,255,${0.08 + rnd() * 0.22})`;
      g.fillRect(x, y, 1, 1);
    }

    // ---- 星：明るさ（等級）で大きさ、色（B-V）で色味 ----
    const bvColor = (bv) => {
      const stops = [[-0.3, [165, 190, 255]], [0, [235, 240, 255]], [0.5, [255, 247, 236]], [1.0, [255, 218, 175]], [1.6, [255, 190, 135]]];
      if (bv <= stops[0][0]) return stops[0][1];
      for (let i = 1; i < stops.length; i++) {
        if (bv <= stops[i][0]) {
          const [b0, c0] = stops[i - 1], [b1, c1] = stops[i];
          const k = (bv - b0) / (b1 - b0);
          return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
        }
      }
      return stops[stops.length - 1][1];
    };
    stars.sort((a, b) => b[2] - a[2]); // 暗い星から
    for (const [lon, lat, mag, bv] of stars) {
      const p = project(lon, lat);
      if (!p || p[0] < -20 || p[1] < -20 || p[0] > N + 20 || p[1] > N + 20) continue;
      const [r, gg, b] = bvColor(bv);
      const a = Math.max(0.2, Math.min(1, 0.32 + (6.9 - mag) / 4.5));
      const rad = Math.max(0.65, Math.min(2.8, 2.2 - 0.27 * mag));
      if (mag < 2.6) {
        const gr = 3.5 + (2.6 - mag) * 3;
        const grad = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], gr);
        grad.addColorStop(0, `rgba(${r},${gg},${b},0.75)`);
        grad.addColorStop(0.3, `rgba(${r},${gg},${b},0.18)`);
        grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = grad;
        g.fillRect(p[0] - gr, p[1] - gr, gr * 2, gr * 2);
      }
      g.fillStyle = `rgba(${r},${gg},${b},${a})`;
      g.beginPath();
      g.arc(p[0], p[1], rad, 0, Math.PI * 2);
      g.fill();
    }
    return c.toDataURL('image/jpeg', 0.9);
  },
  { stars, mw },
);
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote', out, fs.statSync(out).size);
await browser.close();
