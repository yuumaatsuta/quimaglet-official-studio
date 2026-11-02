import * as THREE from 'three';
import { SECTIONS } from './content.js';

// 奥の壁にペンキで落書きしたメニュー（About / Works / News / Contact）。
// 1 語ずつ板にして壁にぴったり貼り、hotspot（押すとそのページ）にする。
// 文字は canvas に描く：1 文字ずつ傾き・高さ・大きさを揺らし、吹き付けのにじみ・塗りムラ・飛沫・垂れ、
// 語ごとの添え書き（下線・星・丸囲み・矢印）で、別々の人が別々の時に描いたような不揃いさを出す

const PAINT = {
  font: '"Permanent Marker", "Marker Felt", Impact, sans-serif', // index.html で Google Fonts を読む
  color: '#1c2a6e', // 紺のペンキ
  letterHeight: 0.44, // 文字の高さの基準（m）。語ごとの scale を掛ける
  emissive: 0, // ペンキは光らない（シャッターを閉めた暗い部屋では見えなくなる）。ホバーのホログラムだけが光る
};

// 置き場所：奥の壁の中央、蛍光灯の真下（夜にいちばん明るく照らされる所）。
// 左右のブラウン管タワーの間に、語ごとにばらばらに散らす。x は語の左端、y は語の中心の高さ（m）
//   scale: 大きさ / rot: 傾き（rad）/ skew: 斜体の強さ / jitter: 文字ごとの崩れ（0〜1）
//   deco: 添え書き（underline / star / ring / arrow / none）/ drips: 垂れの多さ
// 画面に収める設定（横に長い画面で、壁の上のほうが見切れるとき）
const FIT = {
  top: 0.8, // 窓の上端から何割の高さまでに収めるか（上はヘッダーと、呼ばれたロボットの場所）
  lowest: 2.95, // メニューの下端をここ（m）より下げない（その下に News の投影が入る）
  minHeight: 1.15, // 画面がとても横長でも、メニューの高さはこれ（m）以上を保つ
};

const WORDS = [
  { id: 'about', x: -1.6, y: 4.72, scale: 1.18, rot: -0.16, skew: -0.12, jitter: 0.6, deco: 'underline', drips: 1.2 },
  { id: 'works', x: 0.3, y: 4.9, scale: 0.92, rot: 0.13, skew: 0.18, jitter: 1.0, deco: 'star', drips: 0.6 },
  { id: 'news', x: -1.35, y: 4.06, scale: 1.12, rot: 0.2, skew: 0.05, jitter: 0.8, deco: 'ring', drips: 0.9 },
  { id: 'contact', x: 0.02, y: 3.7, scale: 1.05, rot: -0.09, skew: -0.2, jitter: 0.5, deco: 'arrow', drips: 1.5 },
];

export async function buildWallMenu({ wallZ, seed = 23 }) {
  await loadFont();
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const items = new Map();

  for (const word of WORDS) {
    const label = SECTIONS[word.id]?.label ?? word.id;
    const { texture, aspect, ratio, text } = paintWord(label, word, rand);
    const h = PAINT.letterHeight * word.scale * ratio; // 板は文字より上下に余白（垂れ・にじみ）がある
    const m = h / text.canvasH; // canvas の 1px が何 m か
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(h * aspect, h),
      glitchMaterial(texture),
    );
    // 板の中心を語の中心に合わせる（ホバーで大きくするときに、その場でふくらむように）
    mesh.geometry.translate((h * aspect) / 2 - (text.x + text.w / 2) * m, h / 2 - (text.y + text.h / 2) * m, 0);
    // 見た目の板は垂れや添え書きの余白で他の語に重なるので、押せるのは文字の部分だけにする（透明な当たり板）
    mesh.userData.noPick = true;
    mesh.userData.noHighlight = true;
    const pad = 0.05; // 押しやすいよう少しだけ広げる（m）
    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(text.w * m + pad * 2, text.h * m + pad * 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    hit.position.z = 0.001;
    hit.userData.noHighlight = true;

    const obj = new THREE.Group();
    obj.add(mesh, hit);
    obj.position.set(word.x + (text.w * m) / 2, word.y, wallZ + 0.004);
    obj.rotation.z = word.rot;
    obj.userData.hotspotLabel = label;
    obj.userData.noTooltip = true; // 文字そのものがメニューなので、ツールチップは出さない
    obj.userData.hoverScale = 0.03; // ホバーでわずかに前へ出る（hotspots.js）
    // ホバーすると、実はホログラムだったかのようにグリッチが走る（hotspots.js が毎フレーム 0〜1 を渡す）
    const uniforms = mesh.material.userData.uniforms;
    obj.userData.onHover = (amount) => {
      uniforms.uGlitch.value = amount;
      uniforms.uTime.value = performance.now() / 1000;
    };
    group.add(obj);
    items.set(word.id, obj);
  }

  // 横に長い画面ほど窓（画面）の縦が狭くなり、壁の上のほうが画面の外に出てメニューが見切れる。
  // 画面の形が変わるたびに、目から見えている壁の範囲を出し、はみ出すときは全体を下げ、
  // 下げすぎてブラウン管のタワーに重なるようなら縮める
  group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const obj of items.values()) box.expandByObject(obj.children[1], true); // 当たり板（文字の部分）
  box.max.y += 0.12; // 星などの添え書きの分
  box.min.y -= 0.18; // 垂れの分
  const center = box.getCenter(new THREE.Vector3());
  let lastKey = null;
  group.userData.update = (t, view) => {
    const win = view?.win;
    const eye = view?.eye;
    if (!win || !eye) return;
    const key = `${win.halfW.toFixed(4)},${win.halfH.toFixed(4)}`;
    if (key === lastKey) return;
    lastKey = key;
    // 窓の上端（ヘッダーの分だけ内側）を、目から奥の壁まで延ばした高さ
    const k = (eye.z - wallZ) / (eye.z - win.cz);
    const top = eye.y + (win.cy + win.halfH * FIT.top - eye.y) * k;
    const height = box.max.y - box.min.y;
    let scale = 1;
    let shift = 0;
    if (box.max.y > top) {
      const floor = Math.min(FIT.lowest, top - FIT.minHeight); // ここより下には下げない
      scale = Math.min(1, (top - floor) / height);
      // 縮めた後の上端を top に合わせる
      shift = top - (center.y + (box.max.y - center.y) * scale);
    }
    // 中心を支点に縮める（壁からは離さないので z はそのまま）
    group.scale.set(scale, scale, 1);
    group.position.set(center.x * (1 - scale), center.y * (1 - scale) + shift, 0);
    // 縮めて下げた後の下端（News の投影がこの下に入る。newsProjector.js）
    group.userData.bottom = box.min.y * scale + center.y * (1 - scale) + shift;
  };
  group.userData.bottom = box.min.y;

  return { group, items };
}

// ペンキの板のマテリアル。普段はただの塗料だが、uGlitch（0〜1）を上げると
// 横に細切れにずれる・色がずれる・水色に光る・走査線・瞬断が起き、ホログラムの正体が見える
function glitchMaterial(texture) {
  const uniforms = { uGlitch: { value: 0 }, uTime: { value: 0 }, uBaseEmissive: { value: PAINT.emissive } };
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    roughness: 0.55, // 乾いたペンキはコンクリートより少しだけ艶がある
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uGlitch;
        uniform float uTime;
        uniform float uBaseEmissive;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 paint = vec4(0.0);
        vec3 glitchGlow = vec3(0.0);
        #ifdef USE_MAP
          vec2 guv = vMapUv;
          float g = uGlitch;
          float tick = floor(uTime * 14.0);
          // 横の帯ごとに、ときどき大きく横へずれる
          float band = floor(guv.y * 18.0);
          float r = gHash(vec2(band, tick));
          guv.x += (r > 0.72 ? (r - 0.72) * 1.1 * (gHash(vec2(band, tick + 7.0)) - 0.5) : 0.0) * g;
          // 細かい揺れ
          guv.x += (gHash(vec2(floor(guv.y * 120.0), floor(uTime * 40.0))) - 0.5) * 0.008 * g;
          // 色ずれ（赤と青を左右へ）
          float split = 0.012 * g * (0.6 + 0.8 * gHash(vec2(tick, 3.0)));
          vec4 cR = texture2D(map, guv + vec2(split, 0.0));
          vec4 cG = texture2D(map, guv);
          vec4 cB = texture2D(map, guv - vec2(split, 0.0));
          paint = cG;
          float a = max(max(cR.a, cG.a), cB.a);
          // ホログラムの色（水色。ずれた縁は赤紫・青に分かれる）
          vec3 holo = vec3(0.12 * cR.a + 0.02, 0.5 * cG.a, 1.0 * cB.a + 0.05 * cG.a);
          float scan = 0.7 + 0.3 * sin(guv.y * 420.0 - uTime * 18.0);
          float drop = step(0.07, gHash(vec2(tick, 11.0))); // ときどき一瞬消える
          paint.rgb = mix(cG.rgb, holo, g);
          paint.a = mix(cG.a, a * scan * mix(1.0, drop, 0.8), g);
          glitchGlow = holo * scan * 0.75 * g;
          diffuseColor *= paint;
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance = paint.rgb * uBaseEmissive + glitchGlow;',
      );
  };
  return mat;
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

// 1 語を塗る。aspect は canvas の横 / 縦、ratio は canvas の縦 / 文字の高さ、
// text は文字の部分の範囲（canvas の px。左上が原点）
function paintWord(label, word, rand) {
  const PX = 220; // 文字の高さ（px）
  const pad = { x: 110, top: 90, bottom: 170 }; // 下は垂れの分を広めに
  const font = (size) => `${Math.round(size)}px ${PAINT.font}`;
  const measure = document.createElement('canvas').getContext('2d');

  // 1 文字ずつの崩れ（大きさ・傾き・上下・字間）
  const j = word.jitter;
  const letters = [];
  let advance = 0;
  for (const ch of label) {
    const size = PX * (1 + (rand() - 0.5) * 0.24 * j);
    measure.font = font(size);
    const cw = measure.measureText(ch).width;
    letters.push({
      ch,
      size,
      x: advance,
      dy: (rand() - 0.5) * PX * 0.16 * j,
      rot: (rand() - 0.5) * 0.3 * j,
      cw,
    });
    advance += cw * (0.9 + rand() * 0.14 * j);
  }
  const textW = Math.ceil(advance);
  const w = textW + pad.x * 2;
  const H = PX + pad.top + pad.bottom;
  const baseY = pad.top + PX * 0.82;

  // 文字と添え書きを描く（マスクと本体の両方で同じ形を使う）
  const drawText = (c, ox = 0, oy = 0) => {
    for (const l of letters) {
      c.save();
      c.translate(pad.x + l.x + l.cw / 2 + ox, baseY + l.dy + oy);
      c.transform(1, 0, word.skew, 1, 0, 0); // 斜体
      c.rotate(l.rot);
      c.font = font(l.size);
      c.fillText(l.ch, -l.cw / 2, 0);
      c.restore();
    }
  };
  const drawDeco = (c) => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const left = pad.x;
    const right = pad.x + textW;
    if (word.deco === 'underline') {
      // 勢いのある下線（右へ跳ね上がる）
      c.lineWidth = 13;
      c.beginPath();
      c.moveTo(left - 10, baseY + 34);
      c.quadraticCurveTo((left + right) / 2, baseY + 52, right + 30, baseY + 14);
      c.stroke();
    } else if (word.deco === 'star') {
      // 右上に星
      const cx = right + 52;
      const cy = pad.top + 10;
      c.lineWidth = 9;
      c.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        const r = 40;
        if (i === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      c.stroke();
    } else if (word.deco === 'ring') {
      // 語をぐるっと囲む、閉じきらない楕円
      c.lineWidth = 9;
      c.beginPath();
      c.ellipse((left + right) / 2, pad.top + PX * 0.45, textW / 2 + 60, PX * 0.72, -0.06, 0.15, Math.PI * 2 + 0.05);
      c.stroke();
    } else if (word.deco === 'arrow') {
      // 左から語を指す矢印
      const y = pad.top + PX * 0.5;
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(left - 100, y + 30);
      c.quadraticCurveTo(left - 60, y - 10, left - 18, y);
      c.moveTo(left - 42, y - 22);
      c.lineTo(left - 16, y);
      c.lineTo(left - 46, y + 16);
      c.stroke();
    }
  };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAINT.color;
  ctx.strokeStyle = PAINT.color;

  // 形のマスク。飛沫と垂れの位置を決めるのに使う
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = H;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = mctx.strokeStyle = '#fff';
  drawText(mctx);
  drawDeco(mctx);
  const alpha = mctx.getImageData(0, 0, w, H).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < H && alpha[(y * w + x) * 4 + 3] > 128;

  // 1. 吹き付けのにじみ（縁のぼんやりした粉）
  ctx.save();
  ctx.shadowColor = PAINT.color;
  ctx.shadowBlur = 16 + rand() * 14;
  ctx.globalAlpha = 0.3;
  drawText(ctx);
  drawDeco(ctx);
  ctx.restore();

  // 2. 本体。少しずつずらして重ね塗りし、縁をわずかに不揃いに
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = i === 0 ? 1 : 0.5;
    drawText(ctx, (rand() - 0.5) * 3, (rand() - 0.5) * 3);
  }
  ctx.globalAlpha = 1;
  drawDeco(ctx);

  // 3. 垂れ：塗りの下端から、ところどころペンキが流れ落ちる
  const drips = Math.max(2, Math.round((textW / 90) * word.drips));
  for (let n = 0, tries = 0; n < drips && tries < 400; tries++) {
    const x = Math.round(pad.x - 40 + rand() * (textW + 80));
    let y = -1;
    for (let yy = H - 1; yy >= 0; yy--) {
      if (solid(x, yy)) {
        y = yy;
        break;
      }
    }
    if (y < 0) continue;
    n++;
    const len = Math.min(H - y - 12, 16 + rand() ** 1.8 * 130);
    const width = 3 + rand() * 5;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + (rand() - 0.5) * 2, y + len);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + len, width * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. 飛沫：塗りのまわりに細かい粒
  for (let i = 0; i < 1100; i++) {
    const x = Math.round(rand() * w);
    const y = Math.round(rand() * H);
    let near = false;
    for (let k = 0; k < 4 && !near; k++) near = solid(x + Math.round((rand() - 0.5) * 44), y + Math.round((rand() - 0.5) * 44));
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
  const phase = rand() * 10;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] === 0) continue;
    const p = (i - 3) / 4;
    const x = p % w;
    const y = (p / w) | 0;
    const blotch = 0.86 + 0.14 * Math.sin(x * 0.045 + phase + Math.sin(y * 0.03) * 3) * Math.sin(y * 0.05 + x * 0.01);
    d[i] = Math.round(d[i] * blotch * (0.84 + rand() * 0.16));
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    texture,
    aspect: w / H,
    ratio: H / PX,
    text: { x: pad.x, y: pad.top - PX * 0.08, w: textW, h: PX * 1.08, canvasH: H },
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
