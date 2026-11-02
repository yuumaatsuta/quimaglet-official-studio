import * as THREE from 'three';
import { SECTIONS } from './content.js';

// 奥の壁にペンキで落書きしたメニュー（About / Works / News / Contact）。
// 1 語ずつ板にして壁にぴったり貼り、hotspot（押すとそのページ）にする。
// 文字は canvas に描く：吹き付けのにじみ・塗りムラ・飛沫・垂れで、手で塗った感じを出す

const PAINT = {
  font: '"Permanent Marker", "Marker Felt", Impact, sans-serif', // index.html で Google Fonts を読む
  color: '#ff3d8b', // ペンキの色（蛍光ピンク。昼のコンクリートでも夜でも目立つ）
  letterHeight: 0.38, // 文字の高さ（m）
  lineGap: 0.4, // 行の間隔（m）
};

// 置き場所：奥の壁の右上（右奥のブラウン管タワーより上）。x, y は 1 行目の左端・中心の高さ
const LAYOUT = {
  x: 0.45,
  y: 5.1,
  // 行ごとの、左右のずれ（m）・傾き（rad）・大きさ。手書きらしく少しずつ不揃いにする
  lines: [
    { dx: 0.0, rot: 0.06, scale: 1.0 },
    { dx: 0.32, rot: -0.04, scale: 1.08 },
    { dx: 0.1, rot: 0.03, scale: 0.95 },
    { dx: 0.22, rot: -0.07, scale: 1.02 },
  ],
};

const IDS = ['about', 'works', 'news', 'contact'];

export async function buildWallMenu({ wallZ, seed = 11 }) {
  await loadFont();
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const items = new Map();

  IDS.forEach((id, i) => {
    const line = LAYOUT.lines[i % LAYOUT.lines.length];
    const label = SECTIONS[id]?.label ?? id;
    const { texture, aspect, ratio, text } = paintWord(label, rand);
    const h = PAINT.letterHeight * line.scale * ratio; // 板は文字より上下に余白（垂れ・にじみ）がある
    const m = h / text.canvasH; // canvas の 1px が何 m か
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(h * aspect, h),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        roughness: 0.55, // 乾いたペンキはコンクリートより少しだけ艶がある
        metalness: 0,
        // 暗い部屋でも読めるよう、ほんの少しだけ自分で光らせる（ホバーで強まる）
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: texture,
        emissiveIntensity: 0.18,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    // 板の左端を行の左端に合わせる
    mesh.geometry.translate((h * aspect) / 2, 0, 0);
    // 見た目の板は垂れの余白で下の行に重なるので、押せるのは文字の部分だけにする（透明な当たり板）
    mesh.userData.noPick = true;
    const pad = 0.04; // 押しやすいよう少しだけ広げる（m）
    const hitW = text.w * m + pad * 2;
    const hitH = text.h * m + pad * 2;
    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(hitW, hitH),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    hit.position.set(text.x * m - pad + hitW / 2, h / 2 - (text.y * m - pad + hitH / 2), 0.001);
    hit.userData.noHighlight = true;

    const word = new THREE.Group();
    word.add(mesh, hit);
    word.position.set(LAYOUT.x + line.dx, LAYOUT.y - i * PAINT.lineGap, wallZ + 0.004);
    word.rotation.z = line.rot;
    word.userData.hotspotLabel = label;
    word.userData.noTooltip = true; // 文字そのものがメニューなので、ツールチップは出さない
    group.add(word);
    items.set(id, word);
  });

  return { group, items };
}

async function loadFont() {
  try {
    await Promise.race([
      document.fonts.load(`200px ${PAINT.font}`),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // 読めなければ代わりの字体で描く
  }
}

// 1 語を塗る。aspect は canvas の横 / 縦、ratio は canvas の縦 / 文字の高さ
function paintWord(text, rand) {
  const PX = 220; // 文字の高さ（px）
  const pad = { x: 70, top: 60, bottom: 150 }; // 下は垂れの分を広めに
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${PX}px ${PAINT.font}`;
  const textW = Math.ceil(measure.measureText(text).width);
  const w = textW + pad.x * 2;
  const h = PX + pad.top + pad.bottom;
  const H = h;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const baseY = pad.top + PX * 0.82;
  const y0 = 0;

  // 文字の形（マスク）。飛沫と垂れの位置を決めるのに使う
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = H;
  const mctx = mask.getContext('2d');
  mctx.font = `${PX}px ${PAINT.font}`;
  mctx.fillStyle = '#fff';
  mctx.fillText(text, pad.x, y0 + baseY);
  const alpha = mctx.getImageData(0, 0, w, H).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < H && alpha[(y * w + x) * 4 + 3] > 128;

  ctx.font = `${PX}px ${PAINT.font}`;
  ctx.fillStyle = PAINT.color;
  ctx.strokeStyle = PAINT.color;

  // 1. 吹き付けのにじみ（縁のぼんやりした粉）
  ctx.save();
  ctx.shadowColor = PAINT.color;
  ctx.shadowBlur = 22;
  ctx.globalAlpha = 0.35;
  ctx.fillText(text, pad.x, y0 + baseY);
  ctx.restore();

  // 2. 本体。少しずつずらして重ね塗りし、縁をわずかに不揃いに
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = i === 0 ? 1 : 0.5;
    ctx.fillText(text, pad.x + (rand() - 0.5) * 3, y0 + baseY + (rand() - 0.5) * 3);
  }
  ctx.globalAlpha = 1;

  // 3. 垂れ：文字の下端から、ところどころペンキが流れ落ちる
  const drips = Math.max(3, Math.round(textW / 90));
  for (let n = 0, tries = 0; n < drips && tries < 400; tries++) {
    const x = Math.round(pad.x + rand() * textW);
    // その列のいちばん下の塗り
    let y = -1;
    for (let yy = H - 1; yy >= 0; yy--) {
      if (solid(x, yy)) {
        y = yy;
        break;
      }
    }
    if (y < 0) continue;
    n++;
    const len = 18 + rand() ** 1.8 * 120;
    const width = 3 + rand() * 5;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + (rand() - 0.5) * 2, y + len);
    ctx.stroke();
    // 先にたまった玉
    ctx.beginPath();
    ctx.arc(x, y + len, width * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. 飛沫：文字のまわりに細かい粒
  for (let i = 0; i < 900; i++) {
    const x = Math.round(pad.x - 30 + rand() * (textW + 60));
    const y = Math.round(y0 + pad.top - 30 + rand() * (PX + 60));
    // 塗りの近くほど粒が多い
    let near = false;
    for (let k = 0; k < 4 && !near; k++) near = solid(x + Math.round((rand() - 0.5) * 40), y + Math.round((rand() - 0.5) * 40));
    if (!near) continue;
    ctx.globalAlpha = 0.25 + rand() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + rand() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 5. 塗りムラ：コンクリートに吸われて薄くなったところ（透明度を細かく揺らす）
  const img = ctx.getImageData(0, 0, w, H);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] === 0) continue;
    const p = (i - 3) / 4;
    const x = p % w;
    const y = (p / w) | 0;
    const blotch = 0.88 + 0.12 * Math.sin(x * 0.045 + Math.sin(y * 0.03) * 3) * Math.sin(y * 0.05 + x * 0.01);
    d[i] = Math.round(d[i] * blotch * (0.86 + rand() * 0.14));
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // text: 文字の部分の範囲（canvas の px。左上が原点）。当たり判定に使う
  return {
    texture,
    aspect: w / H,
    ratio: H / PX,
    text: { x: pad.x, y: pad.top, w: textW, h: PX, canvasH: H },
  };
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
