import * as THREE from 'three';

// Goods を選んだときに、ロボットが持ってくる紙のメニュー。
// ロボットの底のマグネット（robot.glb の底の中央）に、紙の上端を巻き付けた金属の棒がくっついている。
// 紙は少し古びた色で、手書きの字で、グッズを 2 列に並べる。近くに来ると下へ巻物のように広がる。
// 中身が多くて 1 枚に収まらないときは、スクロールすると上の棒に紙が巻き取られ、下の続きが出てくる。
// 中身は content.js の GOODS（管理画面 /admin/ の Goods）

const PAPER = {
  width: 0.4, // 紙の幅（m）
  px: 1100, // 紙の横の画素数（組み版の単位）
  view: 1.42, // 一度に見える紙の高さ（幅に対する比）。中身がこれより長いとスクロールする
  maxTexture: 4096, // 画像の高さの上限（スマホの GPU に収める。長いときは全体を縮めて描く）
  rodRadius: 0.0065,
  rollRadius: 0.012, // 棒に巻き付けた紙の太さ（巻き取る前）
  thickness: 0.0026, // 巻き取ったときに太る紙の厚み（見えるよう実物より厚め）
  unrollSeconds: 0.9,
};
const SWAY_MAX = 0.2; // 揺れの最大（rad）

const FONT = {
  // 手書きの字（index.html で Google Fonts を読む）。英数字は Caveat、日本語は Yomogi で書く
  hand: '"Caveat", "Yomogi", cursive',
  jp: '"Yomogi", "Caveat", cursive',
};
const INK = '#1f1a14';
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

  // 紙。canvas に全体を描き、見えている範囲だけを貼る（texture の repeat / offset でずらす）
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
  // 上から下へ広がる（巻物を下ろす）。紙の板の uv の y は上端が 1
  paperMat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPaperV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPaperV = uv.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal;\nvarying float vPaperV;')
      .replace('#include <map_fragment>', 'if (vPaperV < 1.0 - uReveal) discard;\n#include <map_fragment>');
  };
  const rollMat = new THREE.MeshStandardMaterial({ color: '#d9c9a4', emissive: '#d9c9a4', emissiveIntensity: 0.25, roughness: 0.95 });

  let paper = null;
  let viewH = PAPER.width * PAPER.view; // 見えている紙の高さ（m）
  // 棒に巻き付けた上の紙と、まだ巻かれている下の紙
  const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PAPER.width, 32), rollMat);
  topRoll.rotation.z = Math.PI / 2;
  const bottomRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PAPER.width, 32), rollMat);
  bottomRoll.rotation.z = Math.PI / 2;
  pivot.add(topRoll);

  // 下の端の金具：巻物の芯の金属の棒と、両端の小さな浮遊ユニット（下へ青く噴いて、紙の下端を宙に支える）
  const bottomRig = new THREE.Group();
  const bottomRod = new THREE.Mesh(new THREE.CylinderGeometry(PAPER.rodRadius * 0.85, PAPER.rodRadius * 0.85, rodLength, 20), metal);
  bottomRod.rotation.z = Math.PI / 2;
  bottomRig.add(bottomRoll, bottomRod);
  const hovers = [-1, 1].map((side) => hoverUnit(side, rodLength, metal, brass));
  for (const h of hovers) bottomRig.add(h.group);
  pivot.add(bottomRig);

  // 組み版の寸法（画素。canvas は大きすぎると縮めて描くので、組み版の単位で持つ）
  const page = { w: PAPER.px, h: PAPER.px * PAPER.view, view: PAPER.px * PAPER.view };
  const scroll = { now: 0, target: 0 };
  let regions = []; // 押せる所（購入ページへのリンク）。組み版の画素で { x, y, w, h, url }

  function buildPaperMesh() {
    if (paper) {
      pivot.remove(paper);
      paper.geometry.dispose();
    }
    const geo = new THREE.PlaneGeometry(PAPER.width, viewH, 12, 40);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i) - viewH / 2; // 上端が 0、下へ負
      const v = -y / viewH; // 上 0 → 下 1
      // 古い紙らしく、ゆるく反って、下の端が少し手前へ丸まる
      const z = 0.006 * Math.cos((x / PAPER.width) * Math.PI) - 0.012 * Math.sin(v * Math.PI) + 0.02 * Math.pow(v, 6);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    paper = new THREE.Mesh(geo, paperMat);
    paper.position.set(0, -PAPER.rollRadius * 0.6, PAPER.rollRadius * 0.4);
    paper.userData.noPick = true; // ロボットを押したことにしない（紙は main.js が別に調べる）
    pivot.add(paper);
  }

  // 中身を描く。フォントが届いてから描く（届く前に描くと別の字体になる）
  async function draw(goods) {
    await Promise.all([
      document.fonts.load(`700 40px "Caveat"`),
      document.fonts.load(`500 40px "Caveat"`),
      document.fonts.load(`400 30px "Yomogi"`, 'グッズ'),
    ]).catch(() => {});
    const images = await Promise.all((goods.items ?? []).map((it) => loadImage(it.image)));
    const W = PAPER.px;
    const ctx = canvas.getContext('2d');
    // 1 回目で高さを測り、2 回目で描く
    canvas.width = 8;
    canvas.height = 8;
    const contentH = Math.max(Math.round(W * PAPER.view), layout(ctx, goods, images, W, false).height);
    const s = Math.min(1, PAPER.maxTexture / contentH);
    canvas.width = Math.round(W * s);
    canvas.height = Math.round(contentH * s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    agedPaper(ctx, W, contentH);
    regions = layout(ctx, goods, images, W, true).regions;
    texture.needsUpdate = true;
    page.h = contentH;
    page.view = Math.min(contentH, W * PAPER.view);
    viewH = (PAPER.width * page.view) / W;
    scroll.now = scroll.target = 0;
    applyScroll();
    buildPaperMesh();
  }

  function applyScroll() {
    texture.repeat.set(1, page.view / page.h);
    texture.offset.set(0, 1 - (scroll.now + page.view) / page.h);
  }

  // 巻き取った長さ（m）から、巻いた紙の太さ
  const rolled = (meters) => Math.sqrt(PAPER.rollRadius ** 2 + (Math.max(0, meters) * PAPER.thickness) / Math.PI);
  const toMeters = (px) => (px / page.w) * PAPER.width;

  // 揺れ（棒を支点にした振り子）。ロボットの動きの加速度で揺れ、だんだん収まる
  const sway = { x: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, prev: null, vel: new THREE.Vector3(), first: true };
  const wp = new THREE.Vector3();
  const lv = new THREE.Vector3();
  const qParent = new THREE.Quaternion();
  const qWant = new THREE.Quaternion();
  const qSway = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  let unroll = 0;
  let time = 0;

  function update(dt, { visible, open }) {
    group.visible = visible;
    if (!visible) {
      unroll = 0;
      sway.first = true;
      scroll.now = scroll.target = 0;
      return;
    }
    // 広げ始めるのは、着いて揺れが収まってから。離れるときは、上まで戻してから巻き上げる
    const settled = Math.abs(sway.x) + Math.abs(sway.z) < 0.05;
    const target = open && (unroll > 0 || settled) ? 1 : 0;
    if (!open) scroll.target = 0;
    const step = dt / PAPER.unrollSeconds;
    const back = !open && scroll.now > 4; // 閉じるときは、まず巻き取った分を戻す
    if (!back) unroll = target > unroll ? Math.min(target, unroll + step) : Math.max(target, unroll - step * 1.4);
    const u = unroll * unroll * (3 - 2 * unroll);
    reveal.value = u;

    // スクロール：なめらかに追いかける
    scroll.target = THREE.MathUtils.clamp(scroll.target, 0, maxScroll());
    scroll.now += (scroll.target - scroll.now) * (1 - Math.exp(-dt * (back ? 6 : 10)));
    if (Math.abs(scroll.target - scroll.now) < 0.3) scroll.now = scroll.target;
    applyScroll();

    // 上の巻き：巻き取った分だけ太る。下の巻き：まだ見えていない分（広げる前は紙全体）
    const top = rolled(toMeters(scroll.now));
    topRoll.scale.set(top, 1, top);
    topRoll.position.set(0, 0, 0.002);
    const hidden = page.h - scroll.now - page.view * u;
    const bottom = rolled(toMeters(hidden)) * (hidden > 1 ? 1 : 0.6);
    bottomRoll.scale.set(bottom, 1, bottom);
    const py = paper ? paper.position.y : -0.008;
    const pz = paper ? paper.position.z : 0.005;
    // 下の端は浮遊ユニットで宙に浮く。噴射の揺らぎに合わせて、ほんのわずかに上下する
    time += dt;
    const hover = Math.sin(time * 2.6) * 0.0015 * u;
    bottomRig.position.set(0, py - viewH * u + hover, pz + 0.004 + 0.02 * u ** 6);
    if (hidden <= 1) bottomRoll.scale.set(PAPER.rodRadius + 0.003, 1, PAPER.rodRadius + 0.003); // 最後まで広げても、芯に少しだけ巻き残る
    // 巻いて運ぶ間は弱く、広げるときに強く噴く
    for (const h of hovers) h.update(time, 0.35 + 0.65 * u);

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
      sway.ax += ((lv.x - sway.vel.x) / dt - sway.ax) * blend;
      sway.az += ((lv.z - sway.vel.z) / dt - sway.az) * blend;
      sway.vel.copy(lv);
      sway.prev.copy(wp);
      const len = 0.06 + viewH * 0.5 * Math.max(0.2, u); // 振り子の長さ（広げるほど長く、ゆっくり）
      const k = 9.8 / len;
      const damping = 4.5;
      const fx = THREE.MathUtils.clamp(sway.ax, -1.6, 1.6) / len;
      const fz = THREE.MathUtils.clamp(sway.az, -1.6, 1.6) / len;
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

  function maxScroll() {
    return Math.max(0, page.h - page.view);
  }

  // スクロール。px は組み版の画素（下へ正）
  function scrollBy(px) {
    if (reveal.value < 0.98 || maxScroll() === 0) return false;
    scroll.target = THREE.MathUtils.clamp(scroll.target + px, 0, maxScroll());
    return true;
  }

  // 押した所（紙の uv）にあるリンク
  function linkAt(uv) {
    if (!uv || uv.y < 1 - reveal.value) return null;
    const x = uv.x * page.w;
    const y = (1 - uv.y) * page.view + scroll.now;
    return regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)?.url ?? null;
  }

  return {
    group,
    draw,
    update,
    linkAt,
    scrollBy,
    get paper() {
      return paper;
    },
    // 紙 1m あたりの組み版の画素（画面のドラッグ量をスクロール量にするため）
    get pagePxPerMeter() {
      return page.w / PAPER.width;
    },
    get scrollable() {
      return maxScroll() > 0;
    },
    // ロボットの下に吊るしたときの、マグネットの下から紙の下端までの長さと、紙の幅（m）
    get size() {
      return { width: PAPER.width + 0.05, depth: -pivot.position.y + PAPER.rollRadius + viewH + 0.075 }; // 下の浮遊ユニットの分も含める
    },
    get opened() {
      return reveal.value > 0.98;
    },
  };
}

// ---------- 下の端の浮遊ユニット ----------

// 棒の両端の真下に吊るした、手のひらほどの小さな浮遊機。黒い胴、真鍮の帯、下へ青く光る噴射口（噴射だけで浮く）
const HOVER_COLOR = new THREE.Color('#6fd0ff');
let hoverGlowTexture;
function hoverUnit(side, rodLength, metal, brass) {
  const group = new THREE.Group();
  group.position.set(side * (rodLength / 2 - 0.014), -0.034, 0);
  const dark = new THREE.MeshStandardMaterial({ color: '#25272c', metalness: 0.7, roughness: 0.4 });
  // 胴（縦の短い筒）と、上の丸いふた、真鍮の帯
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.026, 24), dark);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.014, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  cap.position.y = 0.013;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.005, 24), brass);
  band.position.y = -0.004;
  // 棒を上でつかむ支柱
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.024, 12), metal);
  arm.position.y = 0.024;
  const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0025, 8, 16), brass);
  clamp.rotation.y = Math.PI / 2;
  clamp.position.y = 0.034;
  // 外側の小さな点滅灯
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 8), metal);
  mast.rotation.z = Math.PI / 2;
  mast.position.set(side * 0.021, 0.004, 0);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.0028, 10, 8),
    new THREE.MeshBasicMaterial({ color: '#ff5a4a' }),
  );
  beacon.position.set(side * 0.028, 0.004, 0);
  // 噴射口（光る円盤）と、下へ広がる光
  const nozzleMat = new THREE.MeshBasicMaterial({ color: HOVER_COLOR, transparent: true });
  const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.011, 24), nozzleMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.y = -0.0135;
  if (!hoverGlowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(230,248,255,1)');
    r.addColorStop(0.3, 'rgba(110,200,255,0.6)');
    r.addColorStop(1, 'rgba(40,120,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    hoverGlowTexture = new THREE.CanvasTexture(c);
  }
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: hoverGlowTexture, color: HOVER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.position.y = -0.02;
  glow.scale.set(0.05, 0.05, 1);
  // 噴射の筋（下へ細く伸びて消える光）
  const jet = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: hoverGlowTexture, color: HOVER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  jet.position.y = -0.04;
  jet.scale.set(0.018, 0.06, 1);
  group.add(body, cap, band, arm, clamp, mast, beacon, nozzle, glow, jet);
  group.traverse((o) => o.isMesh && (o.userData.noPick = true));
  const phase = side * 1.3;
  return {
    group,
    update(t, power) {
      const flicker = 0.85 + 0.1 * Math.sin(t * 47 + phase) + 0.05 * Math.sin(t * 113 + phase * 2);
      const a = power * flicker;
      nozzleMat.opacity = 0.5 + 0.5 * a;
      glow.material.opacity = a;
      glow.scale.setScalar(0.035 + 0.03 * a);
      jet.material.opacity = 0.7 * a;
      jet.scale.set(0.016, 0.03 + 0.05 * a, 1);
      jet.position.y = -0.02 - (0.015 + 0.025 * a);
      // てっぺんの灯は 1 秒に 1 回ほど点く
      beacon.visible = (t + phase) % 1.1 < 0.12;
    },
  };
}

// ---------- 紙の地 ----------

function agedPaper(ctx, W, H) {
  const rand = mulberry32(31);
  // 地の色：中央は明るく、縁ほど焼けて濃い
  ctx.fillStyle = '#e7d9b8';
  ctx.fillRect(0, 0, W, H);
  // 焼けは 1 枚分ずつ繰り返す（長い紙でも、どこを見ても同じくらい古びている）
  const unit = W * PAPER.view;
  for (let y0 = 0; y0 < H; y0 += unit) {
    const g = ctx.createRadialGradient(W / 2, y0 + unit * 0.45, unit * 0.15, W / 2, y0 + unit / 2, Math.hypot(W, unit) * 0.62);
    g.addColorStop(0, 'rgba(250, 240, 214, 0.5)');
    g.addColorStop(0.7, 'rgba(190, 160, 110, 0.1)');
    g.addColorStop(1, 'rgba(120, 85, 40, 0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, unit);
  }
  // 左右の縁の焼け
  for (const [x0, x1] of [[0, 60], [W, W - 60]]) {
    const e = ctx.createLinearGradient(x0, 0, x1, 0);
    e.addColorStop(0, 'rgba(110, 70, 25, 0.35)');
    e.addColorStop(1, 'rgba(110, 70, 25, 0)');
    ctx.fillStyle = e;
    ctx.fillRect(Math.min(x0, x1), 0, 60, H);
  }
  // 紙の繊維と細かな汚れ
  const n = Math.round((W * H) / 130);
  for (let i = 0; i < n; i++) {
    const a = rand() * 0.07;
    ctx.fillStyle = rand() < 0.5 ? `rgba(90, 65, 30, ${a})` : `rgba(255, 250, 235, ${a})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 2.2, 1 + rand() * 1.2);
  }
  for (let i = 0; i < n / 35; i++) {
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
  ring(W * 0.84, Math.min(H - W * 0.15, unit * 0.88), W * 0.1, 0.12);
  ring(W * 0.13, unit * 0.18, W * 0.05, 0.06);
  if (H > unit * 1.5) ring(W * 0.2, H - unit * 0.3, W * 0.07, 0.08);
  // 折り目（縦に 1 本と、1 枚分ごとに横に 1 本）
  const crease = (x0, y0, x1, y1) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(100, 75, 40, 0.14)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.22)';
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2);
    ctx.lineTo(x1 + 2, y1 + 2);
    ctx.stroke();
  };
  crease(W * 0.5, 0, W * 0.505, H);
  for (let y = unit * 0.52; y < H; y += unit) crease(0, y, W, y - 6);
}

// ---------- 組み版 ----------

function layout(ctx, goods, images, W, paint) {
  const M = 84; // 左右の余白
  const GAP = 44; // 2 列のあいだ
  const colW = (W - M * 2 - GAP) / 2;
  const regions = [];
  const rand = mulberry32(7);
  let y = 92;

  // 手書きらしく、行ごとにわずかに傾けて書く
  const text = (s, x, yy, font, { color = INK, align = 'left', tilt = 0.012 } = {}) => {
    if (!paint) return;
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.translate(x, yy);
    ctx.rotate((rand() - 0.5) * tilt);
    ctx.fillText(s, 0, 0);
    // 手書きのインクのにじみ：ほんの少しずらして重ねる（細い字を読みやすく）
    ctx.globalAlpha = 0.35;
    ctx.fillText(s, 0.7, 0.5);
    ctx.restore();
  };
  // 手で引いた線（少し波打つ）
  const line = (x0, yy, x1, { width = 2.5, dash = false, color = 'rgba(43, 38, 32, 0.7)' } = {}) => {
    if (!paint) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash([14, 12]);
    ctx.beginPath();
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const yj = yy + Math.sin(i * 1.7 + x0) * 1.6 + (rand() - 0.5) * 1.4;
      if (i) ctx.lineTo(x, yj);
      else ctx.moveTo(x, yj);
    }
    ctx.stroke();
    ctx.restore();
  };

  // 見出し
  text('quimaglet official studio', W / 2, y, `500 40px ${FONT.hand}`, { align: 'center' });
  y += 128;
  text(goods.title || 'Goods', W / 2, y, `700 150px ${FONT.hand}`, { align: 'center', tilt: 0.03 });
  y += 26;
  line(W / 2 - 230, y, W / 2 + 230, { width: 4 });
  line(W / 2 - 200, y + 12, W / 2 + 210, { width: 2 });
  y += 62;
  const items = goods.items ?? [];
  text(`merchandise list — ${String(items.length).padStart(2, '0')} items`, W / 2, y, `500 40px ${FONT.hand}`, { align: 'center' });
  y += 58;

  // はじめの文章
  const intro = String(goods.body ?? '').trim();
  if (intro) {
    const font = `400 38px ${FONT.jp}`;
    ctx.font = font;
    for (const para of intro.split(/\n/)) {
      for (const l of wrap(ctx, para, W - M * 2)) {
        text(l, M, y, font);
        y += 60;
      }
    }
    y += 18;
  }
  line(M, y, W - M, { dash: true });
  y += 54;

  // 1 点分の枠（写真・スタンプ・名前・価格・説明・購入ページ）。下端を返す
  const cell = (it, img, x, top, index) => {
    const imgH = Math.round(colW * 0.74);
    if (paint) {
      ctx.save();
      ctx.translate(x + colW / 2, top + imgH / 2);
      ctx.rotate((index % 2 ? 1 : -1) * (0.012 + rand() * 0.02));
      // 台紙に貼った写真
      ctx.fillStyle = 'rgba(70, 50, 25, 0.18)';
      ctx.fillRect(-colW / 2 + 6, -imgH / 2 + 8, colW, imgH);
      ctx.fillStyle = '#f6efdc';
      ctx.fillRect(-colW / 2, -imgH / 2, colW, imgH);
      const pad = 12;
      const iw = colW - pad * 2;
      const ih = imgH - pad * 2;
      if (img) {
        const s = Math.max(iw / img.width, ih / img.height);
        const sw = iw / s;
        const sh = ih / s;
        ctx.globalAlpha = 0.93;
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, -iw / 2, -ih / 2, iw, ih);
        ctx.globalAlpha = 1;
      } else {
        // 写真がまだないもの：鉛筆の斜線と、手書きの no image
        ctx.save();
        ctx.beginPath();
        ctx.rect(-iw / 2, -ih / 2, iw, ih);
        ctx.clip();
        ctx.strokeStyle = 'rgba(43, 38, 32, 0.22)';
        ctx.lineWidth = 2;
        for (let k = -ih; k < iw + ih; k += 20) {
          ctx.beginPath();
          ctx.moveTo(-iw / 2 + k, -ih / 2);
          ctx.lineTo(-iw / 2 + k - ih, ih / 2);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(43, 38, 32, 0.45)';
        ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
        ctx.fillStyle = '#f6efdc';
        ctx.fillRect(-80, -26, 160, 46);
        ctx.fillStyle = 'rgba(43, 38, 32, 0.75)';
        ctx.font = `500 36px ${FONT.hand}`;
        ctx.textAlign = 'center';
        ctx.fillText('no image', 0, 10);
      }
      // 上の角を留めるマスキングテープ
      ctx.fillStyle = 'rgba(232, 220, 170, 0.75)';
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.translate((sx * colW) / 2 - sx * 18, -imgH / 2 + 4);
        ctx.rotate(sx * -0.7);
        ctx.fillRect(-40, -13, 80, 26);
        ctx.restore();
      }
      ctx.restore();
    }
    // 状況のスタンプ（写真の右下に、少し傾けて押す）
    const status = String(it.status ?? '').trim();
    if (status && paint) stamp(ctx, status, x + colW - 10, top + imgH - 40, index);

    let ty = top + imgH + 62;
    const nameFont = `400 50px ${FONT.jp}`;
    ctx.font = nameFont;
    for (const l of wrap(ctx, String(it.name ?? ''), colW)) {
      text(l, x, ty, nameFont);
      ty += 58;
    }
    if (it.price) {
      text(String(it.price), x, ty + 6, `700 56px ${FONT.hand}`);
      ty += 62;
    }
    const note = String(it.note ?? '').trim();
    if (note) {
      const noteFont = `400 33px ${FONT.jp}`;
      ctx.font = noteFont;
      for (const para of note.split(/\n/)) {
        for (const l of wrap(ctx, para, colW)) {
          text(l, x, ty + 2, noteFont, { color: 'rgba(43, 38, 32, 0.85)' });
          ty += 46;
        }
      }
    }
    if (it.url) {
      ty += 12;
      const label = 'online store →';
      const font = `700 44px ${FONT.hand}`;
      text(label, x, ty + 6, font, { color: '#2b3f6b' });
      if (paint) {
        ctx.font = font;
        line(x, ty + 16, x + ctx.measureText(label).width, { width: 2, color: 'rgba(43, 63, 107, 0.7)' });
      }
      ty += 44;
      regions.push({ x: x - 10, y: top - 10, w: colW + 20, h: ty - top + 10, url: it.url });
    }
    return ty;
  };

  // 2 列に並べる
  for (let i = 0; i < items.length; i += 2) {
    const rowTop = y;
    let rowBottom = y;
    for (let c = 0; c < 2 && i + c < items.length; c++) {
      const x = M + c * (colW + GAP);
      rowBottom = Math.max(rowBottom, cell(items[i + c], images[i + c], x, rowTop, i + c));
    }
    y = rowBottom + 40;
    if (i + 2 < items.length) {
      line(M + 30, y, W - M - 30, { dash: true, width: 2, color: 'rgba(43, 38, 32, 0.4)' });
      y += 50;
    }
  }

  // 結び
  y += 20;
  line(M, y, W - M, { width: 2.5 });
  y += 56;
  text('* 価格・在庫は変わることがあります。', M, y, `400 30px ${FONT.jp}`, { color: 'rgba(43, 38, 32, 0.8)' });
  text('tap outside to close', W - M, y, `500 30px ${FONT.hand}`, { color: 'rgba(43, 38, 32, 0.6)', align: 'right' });
  y += 90;
  return { height: Math.ceil(y), regions };
}

// ゴム印。枠と字を、ところどころインクが乗らないように押す
function stamp(ctx, status, right, centerY, seed) {
  const color = STAMP.find(([re]) => re.test(status))?.[1] ?? STAMP_ON;
  const rand = mulberry32(97 + seed * 13);
  ctx.save();
  ctx.font = `400 36px ${FONT.jp}`;
  const tw = ctx.measureText(status).width;
  const w = tw + 46;
  const h = 64;
  ctx.translate(right - w / 2, centerY);
  ctx.rotate(-0.12 + (rand() - 0.5) * 0.12);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(246, 239, 220, 0.55)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(status, 0, 3);
  // かすれ：インクを点々と抜く
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
