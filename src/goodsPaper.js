import * as THREE from 'three';

// Goods を選んだときに、ロボットが持ってくる紙のメニュー。
// ロボットの底のマグネット（robot.glb の底の中央）に、紙の上端を巻き付けた金属の棒がくっついている。
// 紙は少し古びた色で、タイプライターの字と明朝体で組む。近くに来ると下へ巻物のように広がる。
// 中身は content.js の GOODS（管理画面 /admin/ の Goods）

const PAPER = {
  width: 0.4, // 紙の幅（m）。高さは中身の量で決まる
  px: 1100, // 紙の横の画素数
  rodRadius: 0.0065,
  rollRadius: 0.012, // 棒に巻き付けた紙の太さ
  unrollSeconds: 0.9,
};
const SWAY_MAX = 0.2; // 揺れの最大（rad）

const FONT = {
  type: '"Special Elite", "Courier New", monospace', // タイプライター（index.html で読む）
  serif: '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
};
const INK = '#2a241d';
const STAMP = [
  [/売り切れ|完売|sold/i, '#a3352b'],
  [/準備|近日|予定|soon/i, '#9a6a12'],
  [/予約/, '#2b4f8a'],
];
const STAMP_ON = '#2f6b3a';

export function createGoodsPaper() {
  const group = new THREE.Group(); // ロボットの底のマグネットに付ける（マグネットの一番下が原点）
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: 0.35 });

  // 揺れの支点（棒の中心）。棒の上の面がマグネットに触れる。紙と棒はこの下で揺れる
  const pivot = new THREE.Group();
  pivot.position.y = -PAPER.rodRadius;
  group.add(pivot);

  const rodLength = PAPER.width + 0.05;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(PAPER.rodRadius, PAPER.rodRadius, rodLength, 20), metal);
  rod.rotation.z = Math.PI / 2;
  const knobGeo = new THREE.SphereGeometry(PAPER.rodRadius * 1.9, 16, 12);
  const knobL = new THREE.Mesh(knobGeo, brass);
  const knobR = new THREE.Mesh(knobGeo, brass);
  knobL.position.x = -rodLength / 2;
  knobR.position.x = rodLength / 2;
  pivot.add(rod, knobL, knobR);

  // 紙
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const reveal = { value: 0 };
  const paperMat = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: '#ffffff',
    emissiveMap: texture,
    emissiveIntensity: 0.42, // 暗い部屋でも読めるように、少しだけ自分で明るい
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  // 上から下へ広がる（巻物を下ろす）。uv の y は上端が 1
  paperMat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal;')
      .replace('#include <map_fragment>', 'if (vMapUv.y < 1.0 - uReveal) discard;\n#include <map_fragment>');
  };
  const rollMat = new THREE.MeshStandardMaterial({ color: '#d9c9a4', emissive: '#d9c9a4', emissiveIntensity: 0.25, roughness: 0.95 });

  let paper = null;
  let paperH = 0.5;
  // 棒に巻き付けた上端と、まだ巻かれている下の端
  const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(PAPER.rollRadius, PAPER.rollRadius, PAPER.width, 24), rollMat);
  topRoll.rotation.z = Math.PI / 2;
  const bottomRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PAPER.width, 24), rollMat);
  bottomRoll.rotation.z = Math.PI / 2;
  pivot.add(topRoll, bottomRoll);

  let regions = []; // 押せる所（購入ページへのリンク）。canvas の画素で { x, y, w, h, url }

  function buildPaperMesh() {
    if (paper) {
      pivot.remove(paper);
      paper.geometry.dispose();
    }
    const geo = new THREE.PlaneGeometry(PAPER.width, paperH, 12, 40);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i) - paperH / 2; // 上端が 0、下へ負
      const v = -y / paperH; // 上 0 → 下 1
      // 古い紙らしく、ゆるく反って、下の端が少し手前へ丸まる
      const z = 0.006 * Math.cos((x / PAPER.width) * Math.PI) - 0.012 * Math.sin(v * Math.PI) + 0.02 * Math.pow(v, 6);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    paper = new THREE.Mesh(geo, paperMat);
    paper.position.set(0, -PAPER.rollRadius * 0.6, PAPER.rollRadius * 0.4);
    paper.userData.noPick = true; // ロボットを押したことにしない（紙は main.js が別に調べる）
    paper.userData.goodsPaper = true;
    pivot.add(paper);
  }

  // 中身を描く。フォントが届いてから描く（届く前に描くと別の字体になる）
  async function draw(goods) {
    await Promise.all([
      document.fonts.load(`40px ${FONT.type}`),
      document.fonts.load(`400 30px ${FONT.serif}`),
      document.fonts.load(`700 46px ${FONT.serif}`),
    ]).catch(() => {});
    const images = await Promise.all((goods.items ?? []).map((it) => loadImage(it.image)));
    const W = PAPER.px;
    const ctx = canvas.getContext('2d');
    // 1 回目で高さを測り、2 回目で描く
    canvas.width = W;
    canvas.height = 10;
    const height = Math.max(Math.round(W * 1.3), layout(ctx, goods, images, W, false).height);
    canvas.width = W;
    canvas.height = height;
    agedPaper(ctx, W, height);
    regions = layout(ctx, goods, images, W, true).regions;
    texture.needsUpdate = true;
    paperH = (PAPER.width * height) / W;
    buildPaperMesh();
  }

  // 揺れ（棒を支点にした振り子）。ロボットの動きの加速度で揺れ、だんだん収まる
  const sway = { x: 0, z: 0, vx: 0, vz: 0, prev: null, vel: new THREE.Vector3(), first: true };
  const wp = new THREE.Vector3();
  const qParent = new THREE.Quaternion();
  const qWant = new THREE.Quaternion();
  const qSway = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  const lv = new THREE.Vector3();
  let unroll = 0;

  function update(dt, { visible, open }) {
    group.visible = visible;
    if (!visible) {
      unroll = 0;
      sway.first = true;
      return;
    }
    // 着いたら下へ広げ、離れるときは巻き上げる
    // 広げ始めるのは、着いて揺れが収まってから
    const settled = Math.abs(sway.x) + Math.abs(sway.z) < 0.05;
    const target = open && (unroll > 0 || settled) ? 1 : 0;
    const step = dt / PAPER.unrollSeconds;
    unroll = target > unroll ? Math.min(target, unroll + step) : Math.max(target, unroll - step * 1.4);
    const u = unroll * unroll * (3 - 2 * unroll);
    reveal.value = u;
    const r = THREE.MathUtils.lerp(0.026, 0.009, u);
    bottomRoll.scale.set(r, 1, r);
    bottomRoll.position.set(0, paper ? paper.position.y - paperH * u : -0.02, (paper ? paper.position.z : 0) + 0.003);
    bottomRoll.visible = u < 0.995;

    // 揺れ
    if (dt > 0) {
      group.getWorldPosition(wp);
      if (sway.first) {
        sway.prev = wp.clone();
        sway.vel.set(0, 0, 0);
        sway.ax = sway.az = 0;
        sway.x = sway.z = sway.vx = sway.vz = 0;
        sway.first = false;
      }
      lv.copy(wp).sub(sway.prev).divideScalar(dt);
      // 加速度。コマごとのばらつきで暴れないよう、なめらかにする
      const blend = 1 - Math.exp(-dt * 10);
      sway.ax = (sway.ax ?? 0) + ((lv.x - sway.vel.x) / dt - (sway.ax ?? 0)) * blend;
      sway.az = (sway.az ?? 0) + ((lv.z - sway.vel.z) / dt - (sway.az ?? 0)) * blend;
      const ax = sway.ax;
      const az = sway.az;
      sway.vel.copy(lv);
      sway.prev.copy(wp);
      const len = 0.06 + paperH * 0.5 * Math.max(0.2, u); // 振り子の長さ（広げるほど長く、ゆっくり）
      const k = 9.8 / len;
      const damping = 4.5;
      const fx = THREE.MathUtils.clamp(ax, -1.6, 1.6) / len;
      const fz = THREE.MathUtils.clamp(az, -1.6, 1.6) / len;
      // 加速した向きと反対へ振れる（引っ張られて遅れる）。コマ落ちしても暴れないよう細かく刻んで解く
      const n = Math.ceil(dt / (1 / 120));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        sway.vz += (-k * sway.z - damping * sway.vz + fx) * h;
        sway.vx += (-k * sway.x - damping * sway.vx - fz) * h;
        sway.z = THREE.MathUtils.clamp(sway.z + sway.vz * h, -SWAY_MAX, SWAY_MAX);
        sway.x = THREE.MathUtils.clamp(sway.x + sway.vx * h, -SWAY_MAX, SWAY_MAX);
      }
      // ロボットが首を傾けても、紙は鉛直に吊り下がる（向きは左右の向きだけ追う）
      group.parent?.getWorldQuaternion(qParent);
      eul.setFromQuaternion(qParent, 'YXZ');
      qWant.setFromAxisAngle(UP, eul.y).multiply(qSway.setFromEuler(eul.set(sway.x, 0, sway.z)));
      pivot.quaternion.copy(qParent.invert()).multiply(qWant);
    }
  }

  // 押した所（紙の uv）にあるリンク
  function linkAt(uv) {
    if (!uv || uv.y < 1 - reveal.value) return null;
    const x = uv.x * canvas.width;
    const y = (1 - uv.y) * canvas.height;
    return regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.url ?? null;
  }

  return {
    group,
    draw,
    update,
    linkAt,
    get paper() {
      return paper;
    },
    // ロボットの下に吊るしたときの、マグネットの上面から紙の下端までの長さと、紙の幅（m）
    get size() {
      return { width: PAPER.width + 0.05, depth: -pivot.position.y + PAPER.rollRadius + paperH };
    },
    get opened() {
      return reveal.value > 0.98;
    },
  };
}

// ---------- 紙の地 ----------

function agedPaper(ctx, W, H) {
  const rand = mulberry32(31);
  // 地の色：中央は明るく、縁ほど焼けて濃い
  ctx.fillStyle = '#e7d9b8';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, 'rgba(250, 240, 214, 0.55)');
  g.addColorStop(0.7, 'rgba(190, 160, 110, 0.12)');
  g.addColorStop(1, 'rgba(120, 85, 40, 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 紙の繊維と細かな汚れ
  for (let i = 0; i < 9000; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const a = rand() * 0.07;
    ctx.fillStyle = rand() < 0.5 ? `rgba(90, 65, 30, ${a})` : `rgba(255, 250, 235, ${a})`;
    ctx.fillRect(x, y, 1 + rand() * 2.2, 1 + rand() * 1.2);
  }
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(110, 85, 50, ${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = rand() * W;
    const y = rand() * H;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, x + (rand() - 0.5) * 50, y + (rand() - 0.5) * 50);
    ctx.stroke();
  }
  // しみ（コーヒーの輪じみと、うすい水じみ）
  const ring = (x, y, r, a) => {
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = `rgba(120, 75, 30, ${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.94, rand(), 0, Math.PI * 1.7);
    ctx.stroke();
    const f = ctx.createRadialGradient(x, y, 0, x, y, r);
    f.addColorStop(0, `rgba(150, 105, 50, ${a * 0.25})`);
    f.addColorStop(1, 'rgba(150, 105, 50, 0)');
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ring(W * 0.82, H * 0.86, W * 0.1, 0.13);
  ring(W * 0.14, H * 0.2, W * 0.05, 0.06);
  // 折り目（横に 1 本、縦に 1 本）
  const crease = (x0, y0, x1, y1) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(100, 75, 40, 0.16)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.25)';
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2);
    ctx.lineTo(x1 + 2, y1 + 2);
    ctx.stroke();
  };
  crease(0, H * 0.52, W, H * 0.515);
  crease(W * 0.5, 0, W * 0.505, H);
  // 縁の焼け
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(110, 70, 25, 0.22)';
  ctx.strokeRect(0, 0, W, H);
}

// ---------- 組み版 ----------

function layout(ctx, goods, images, W, paint) {
  const M = 86; // 左右の余白
  const regions = [];
  let y = 96;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  const text = (s, x, yy, font, color = INK, align = 'left') => {
    if (!paint) return;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    // インクのかすれ：少しずらして薄く重ねる
    ctx.globalAlpha = 0.9;
    ctx.fillText(s, x, yy);
    ctx.globalAlpha = 0.18;
    ctx.fillText(s, x + 0.8, yy + 0.6);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  };
  const rule = (yy, dash = false) => {
    if (!paint) return;
    ctx.strokeStyle = 'rgba(42, 36, 29, 0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash(dash ? [10, 9] : []);
    ctx.beginPath();
    ctx.moveTo(M, yy);
    ctx.lineTo(W - M, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // 見出し
  text('QUIMAGLET  OFFICIAL  STUDIO', W / 2, y, `30px ${FONT.type}`, INK, 'center');
  y += 112;
  text(String(goods.title || 'Goods').toUpperCase(), W / 2, y, `112px ${FONT.type}`, INK, 'center');
  y += 34;
  rule(y);
  rule(y + 8);
  y += 46;
  text('MERCHANDISE  LIST', M, y, `24px ${FONT.type}`);
  text(`No. ${String((goods.items ?? []).length).padStart(2, '0')}`, W - M, y, `24px ${FONT.type}`, INK, 'right');
  y += 54;

  // はじめの文章
  const intro = String(goods.body ?? '').trim();
  if (intro) {
    ctx.font = `400 34px ${FONT.serif}`;
    for (const para of intro.split(/\n/)) {
      for (const line of wrap(ctx, para, W - M * 2)) {
        text(line, M, y, `400 34px ${FONT.serif}`);
        y += 56;
      }
    }
    y += 22;
  }
  rule(y, true);
  y += 44;

  // 1 点ずつ
  const items = goods.items ?? [];
  const thumb = 210;
  items.forEach((it, i) => {
    const top = y;
    const tx = M + thumb + 40;
    const tw = W - M - tx;
    // 写真（なければ、斜線の枠に NO IMAGE）
    if (paint) {
      const img = images[i];
      ctx.save();
      ctx.translate(M + thumb / 2, top + thumb / 2);
      ctx.rotate((i % 2 ? 1 : -1) * 0.025);
      ctx.fillStyle = '#f4ecd8';
      ctx.fillRect(-thumb / 2 - 8, -thumb / 2 - 8, thumb + 16, thumb + 16);
      if (img) {
        const s = Math.max(thumb / img.width, thumb / img.height);
        const sw = thumb / s;
        const sh = thumb / s;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, -thumb / 2, -thumb / 2, thumb, thumb);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = 'rgba(42, 36, 29, 0.35)';
        ctx.lineWidth = 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(-thumb / 2, -thumb / 2, thumb, thumb);
        ctx.clip();
        for (let k = -thumb; k < thumb * 2; k += 18) {
          ctx.beginPath();
          ctx.moveTo(-thumb / 2 + k, -thumb / 2);
          ctx.lineTo(-thumb / 2 + k - thumb, thumb / 2);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeRect(-thumb / 2, -thumb / 2, thumb, thumb);
        ctx.fillStyle = 'rgba(42, 36, 29, 0.7)';
        ctx.font = `22px ${FONT.type}`;
        ctx.textAlign = 'center';
        ctx.fillText('NO IMAGE', 0, 8);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }

    // 名前・価格・説明
    let ty = top + 44;
    ctx.font = `700 46px ${FONT.serif}`;
    const nameLines = wrap(ctx, String(it.name ?? ''), tw - 10);
    for (const line of nameLines) {
      text(line, tx, ty, `700 46px ${FONT.serif}`);
      ty += 60;
    }
    if (it.price) {
      text(String(it.price), tx, ty + 2, `36px ${FONT.type}`);
      ty += 50;
    }
    const note = String(it.note ?? '').trim();
    if (note) {
      ctx.font = `400 31px ${FONT.serif}`;
      for (const para of note.split(/\n/)) {
        for (const line of wrap(ctx, para, tw)) {
          text(line, tx, ty + 4, `400 31px ${FONT.serif}`, 'rgba(42, 36, 29, 0.88)');
          ty += 48;
        }
      }
    }
    if (it.url) {
      ty += 10;
      const label = 'ONLINE STORE  →';
      text(label, tx, ty + 6, `30px ${FONT.type}`, '#3b3326');
      if (paint) {
        ctx.font = `30px ${FONT.type}`;
        const lw = ctx.measureText(label).width;
        ctx.strokeStyle = 'rgba(42, 36, 29, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty + 14);
        ctx.lineTo(tx + lw, ty + 14);
        ctx.stroke();
      }
      ty += 40;
    }
    const bottom = Math.max(top + thumb + 10, ty);
    if (it.url) regions.push({ x: M - 10, y: top - 16, w: W - M * 2 + 20, h: bottom - top + 26, url: it.url });

    // 状況のスタンプ（右上に、少し傾けて押す）
    const status = String(it.status ?? '').trim();
    if (status && paint) stamp(ctx, status, W - M - 8, top + 4, i);

    y = bottom + 36;
    if (i < items.length - 1) {
      rule(y, true);
      y += 44;
    }
  });

  // 結び
  y += 30;
  rule(y);
  y += 50;
  text('* 価格・在庫は変わることがあります。', M, y, `400 24px ${FONT.serif}`, 'rgba(42, 36, 29, 0.8)');
  text('TAP OUTSIDE TO CLOSE', W - M, y, `20px ${FONT.type}`, 'rgba(42, 36, 29, 0.6)', 'right');
  y += 80;
  return { height: Math.ceil(y), regions };
}

// ゴム印。枠と字を、ところどころインクが乗らないように押す
function stamp(ctx, status, right, top, seed) {
  const color = STAMP.find(([re]) => re.test(status))?.[1] ?? STAMP_ON;
  const rand = mulberry32(97 + seed * 13);
  ctx.save();
  ctx.font = `700 36px ${FONT.serif}`;
  const tw = ctx.measureText(status).width;
  const w = tw + 50;
  const h = 68;
  ctx.translate(right - w / 2, top + h / 2);
  ctx.rotate(-0.08 + (rand() - 0.5) * 0.08);
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(status, 0, 2);
  // かすれ：紙の色の点を散らす
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.5})`;
    ctx.fillRect((rand() - 0.5) * w, (rand() - 0.5) * h, 1 + rand() * 3, 1 + rand() * 2);
  }
  ctx.restore();
}

// 1 行に収まるように折り返す（日本語は 1 文字ずつ、英語は単語ごと）
function wrap(ctx, text, maxWidth) {
  const lines = [];
  const tokens = String(text).match(/[A-Za-z0-9.,'’!?:;/()&%+\-]+\s*|\s+|./gu) ?? [];
  let line = '';
  for (const tk of tokens) {
    const next = line + tk;
    if (ctx.measureText(next.trimEnd()).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = tk.trimStart();
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

// 画像は別のサイトのものでも描けるよう、CORS で読む（読めなければ写真なしの枠にする）
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  const url = /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : `${import.meta.env.BASE_URL}${src.replace(/^\//, '')}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
