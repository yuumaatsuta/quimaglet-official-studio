import * as THREE from 'three';

// 夜になると、画面の手前に天井から月が 1 つ下りてくる。月はふだん青く弱い、今にも消えそうな光。
// 触れると月の色（黄色）にじんわり光り、カメラの後ろのプロジェクターから部屋じゅうに星空を映す（プラネタリウム）。
// 同時にカメラの真上の小さな明かりが点き、手前のロボットと床の文字がうっすら見える。
// もう一度触れると青い光に戻り、星も消える。触れると振り子のようにゆらりと揺れる。朝になると月は天井へ戻る

const SKY = {
  moonZ: -4.7, // 月を吊るす前後の位置（窓の面 z = -5 の少し手前）
  moonRadius: 0.13, // 月の半径（m）
  // 月を置く画面上の候補（窓の左右・上下の割合 -1〜1）。前から順に、物に重ならない所を使う
  // 左の壁の明るいコンクリートの前の、少し高い所（メニュー・お知らせ・ブラウン管に重ねない）
  spots: [
    [-0.62, 0.45],
    [-0.7, 0.5],
    [-0.55, 0.55],
    [-0.62, 0.3],
    [0.6, 0.65],
  ],
  dropSeconds: 2.4, // 下りてくるまでの時間
  warmSeconds: 1.6, // 触れてから月の色に光りきるまで
  rampSeconds: 4.5, // 星が浮かび上がるまでの時間
  stars: 26, // 星の明るさ
  starAngle: 1.0, // 投影の広がり（光の円錐の半分の角、ラジアン）
  spin: 0.003, // 星空がゆっくり回る速さ（ラジアン / 秒）
  fill: 0.55, // カメラの真上の明かりの強さ
  fillColor: '#ffdcb8',
  dim: 0.8, // 星を映している間、蛍光灯と回り込む光をどれだけ落とすか（0〜1）
  swing: 0.09, // 触れたときの振り子の振れ幅（ラジアン）
  swingDamping: 0.55, // 振り子の揺れのおさまる速さ
};

const FAINT = new THREE.Color('#4f7dff'); // ふだんの青い弱い光
const MOON = new THREE.Color('#ffd36a'); // 触れたあとの月の色

// ceilingY / halfWidth / backZ: 天井の高さ・部屋の幅の半分・奥の壁の z。
// keepClear: 重ねたくない物（メニューの落書き・お知らせの投影）。root: 部屋の group
export function buildPlanetarium({ ceilingY, halfWidth, backZ, keepClear, root }) {
  const group = new THREE.Group();

  // ---------- 月 ----------

  const R = SKY.moonRadius;
  const pivot = new THREE.Group(); // 天井の付け根。ここを中心に振り子のように揺れる
  pivot.visible = false;
  group.add(pivot);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 1, 6).translate(0, -0.5, 0),
    new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }),
  );
  cable.userData.noPick = true;
  pivot.add(cable);

  // 月の玉。原点がケーブルの付け根（玉の上の小さな金具）
  const moon = new THREE.Group();
  pivot.add(moon);
  const surface = moonTexture();
  const moonMat = new THREE.MeshStandardMaterial({
    map: surface,
    emissiveMap: surface,
    emissive: FAINT,
    emissiveIntensity: 0,
    roughness: 0.95,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), moonMat);
  ball.position.y = -R - 0.012;
  ball.rotation.z = 0.2;
  moon.add(ball);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.014, 0.016, 16),
    new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.4, metalness: 0.8 }),
  );
  cap.position.y = -0.008;
  moon.add(cap);
  // 押しやすいよう月より少しだけ大きく。メニューなど部屋の押せる物の判定は遮らない（noPick）
  const hit = new THREE.Mesh(new THREE.SphereGeometry(R * 1.2, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.copy(ball.position);
  hit.userData.noPick = true;
  moon.add(hit);
  // 月のまわりの光のにじみと、まわりを少し照らす光
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: FAINT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }),
  );
  halo.scale.setScalar(R * 6);
  halo.position.copy(ball.position);
  halo.userData.noPick = true;
  moon.add(halo);
  const glowLight = new THREE.PointLight(FAINT, 0, 3, 2);
  glowLight.position.copy(ball.position);
  moon.add(glowLight);

  // ---------- 星を映すプロジェクター（カメラの後ろ）と、手元の明かり（カメラの真上） ----------

  // 星空の画像は、実際の星表から作ったもの（tools/gen-starsky.mjs）。
  // 夏の夜空：わし座のあたりを中心に、天の川が上のはくちょう座・こと座から下のいて座・さそり座へ通る。
  // 読み込むまでは真っ黒の 1 画素を載せておく（あとから差し替えてもシェーダーを作り直さないように）
  const projector = new THREE.SpotLight('#ffffff', 0, 0, SKY.starAngle, 0.25, 0);
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  projector.map = blank;
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/starsky.jpg`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    projector.map = tex;
  });
  projector.shadow.camera.near = 0.2;
  projector.shadow.camera.far = 30;
  group.add(projector, projector.target);

  const fill = new THREE.SpotLight(SKY.fillColor, 0, 0, 0.62, 0.9, 0);
  group.add(fill, fill.target);

  // ---------- 月の置き場所 ----------
  // 目から窓の面の点に向けた線を部屋に飛ばし、壁・床・天井より手前の物に当たる所は避ける

  const ray = new THREE.Raycaster();
  ray.camera = new THREE.PerspectiveCamera(); // 部屋のスプライトに当てるのに要る
  const dir = new THREE.Vector3();
  const isIn = (o, list) => {
    for (; o; o = o.parent) if (list.includes(o)) return true;
    return false;
  };
  const isStructure = (p) =>
    Math.abs(p.x) > halfWidth - 0.5 || p.y < 0.02 || p.y > ceilingY - 0.02 || p.z < backZ + 0.03;
  const blocked = (eye, point) => {
    dir.subVectors(point, eye).normalize();
    ray.set(eye, dir);
    ray.camera.position.copy(eye);
    ray.camera.lookAt(point);
    ray.camera.updateMatrixWorld();
    ray.far = 60;
    for (const h of ray.intersectObject(root, true)) {
      if (!h.object.isMesh || isIn(h.object, [group])) continue;
      return isIn(h.object, keepClear) || !isStructure(h.point);
    }
    return false;
  };

  let cableLength = 1;
  let omega = 2; // 振り子の角振動数（ひもの長さで決まる）
  function layout(eye, win) {
    const k = (eye.z - SKY.moonZ) / (eye.z - win.cz);
    const p = new THREE.Vector3();
    for (const [sx, sy] of SKY.spots) {
      // 窓の面の点 → 目からの線上で、月を吊るす深さの所（月の中心）
      p.set(win.cx + sx * win.halfW, win.cy + sy * win.halfH, win.cz);
      p.sub(eye).multiplyScalar(k).add(eye);
      if (p.y + R > ceilingY - 0.4) continue;
      const probes = [
        [0, 0],
        [0, R],
        [0, -R],
        [R, 0],
        [-R, 0],
      ];
      if (probes.some(([dx, dy]) => blocked(eye, new THREE.Vector3(p.x + dx, p.y + dy, p.z)))) continue;
      break;
    }
    pivot.position.set(p.x, ceilingY, p.z);
    cableLength = ceilingY - (p.y + R + 0.012);
    omega = Math.sqrt(9.8 / (cableLength + R));

    // プロジェクターは目の少し上・後ろから、奥の壁の中央へ向ける
    projector.position.set(eye.x, Math.min(ceilingY - 0.3, eye.y + 0.45), eye.z + 1.6);
    projector.target.position.set(eye.x, eye.y + 0.9, backZ);
    // 手元の明かりは目の真上から、手前の床（ロボットと文字のあたり）へ
    fill.position.set(eye.x, Math.min(ceilingY - 0.2, eye.y + 1.8), eye.z + 0.2);
    fill.target.position.set(win.cx - win.halfW * 0.2, 0.2, win.cz - 0.6);
  }

  // ---------- 動き ----------

  let night = false;
  let drop = 0; // 0 = 天井の中、1 = 下りきった
  let on = false;
  let power = 0; // 星の点き具合 0〜1
  let warm = 0; // 月の光 0 = 青く弱い、1 = 月の色
  let swingT = -1; // 触れてからの時間（< 0 なら揺れていない）
  let lastKey = null;
  let lastT = 0;
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3();
  const glowColor = new THREE.Color();
  // 消えかけの電球のような、ゆっくりした揺らぎと、ときどきの暗転（決まった時刻ごとに決まる）
  const hash = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };

  group.userData.update = (t, view) => {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    if (!view?.win || !view?.eye) return;
    const key = `${view.win.halfW.toFixed(3)},${view.win.halfH.toFixed(3)}`;
    if (key !== lastKey) {
      lastKey = key;
      layout(view.eye, view.win);
    }

    // 月が下りる・上がる。止まり際に少し弾む
    const goal = night ? 1 : 0;
    if (drop !== goal) drop = THREE.MathUtils.clamp(drop + (goal ? dt : -dt * 1.4) / SKY.dropSeconds, 0, 1);
    pivot.visible = drop > 0;
    const reach = cableLength * easeOutBack(drop);
    cable.scale.y = Math.max(0.001, reach);
    moon.position.y = -reach;
    ball.rotation.y = t * 0.05; // ゆっくり自転

    // 揺れ：ふだんはごくわずかに。触れると、ひもの長さに合った速さの振り子が 0 から振れ始め、だんだんおさまる
    let swingZ = Math.sin(t * omega) * 0.006;
    let swingX = Math.cos(t * omega * 0.93) * 0.004;
    if (swingT >= 0) {
      swingT += dt;
      const a = SKY.swing * Math.exp(-swingT * SKY.swingDamping);
      swingZ += a * Math.sin(swingT * omega);
      swingX += a * 0.3 * Math.sin(swingT * omega * 0.97);
      if (a < 0.0005) swingT = -1;
    }
    pivot.rotation.z = swingZ;
    pivot.rotation.x = swingX;

    // 星：プロジェクターのランプが温まるように、じんわり浮かび上がる
    const want = on && night ? 1 : 0;
    power = THREE.MathUtils.clamp(power + Math.sign(want - power) * (dt / SKY.rampSeconds), 0, 1);
    const glow = power * power * (3 - 2 * power);
    projector.intensity = SKY.stars * glow * glow;
    fill.intensity = SKY.fill * glow;
    // 星空はゆっくり回る（投影の向きを軸のまわりに傾ける）
    axis.subVectors(projector.target.position, projector.position).normalize();
    up.set(0, 1, 0).applyAxisAngle(axis, t * SKY.spin);
    projector.shadow.camera.up.copy(up);

    // 月の光：ふだんは青く弱く、消えそうに揺らぐ。触れると月の色へじんわり明るくなる
    warm = THREE.MathUtils.clamp(warm + (want ? dt : -dt) / SKY.warmSeconds, 0, 1);
    const w = warm * warm * (3 - 2 * warm);
    const waver = 0.5 * Math.sin(t * 1.3) + 0.3 * Math.sin(t * 3.7 + 1) + 0.2 * Math.sin(t * 8.3 + 2);
    const blackout = hash(Math.floor(t * 5)) > 0.92 ? 0.3 : 1; // ときどき一瞬ふっと暗くなる
    const faint = (0.32 + 0.1 * waver) * blackout;
    const level = THREE.MathUtils.lerp(faint, 1, w) * drop;
    glowColor.lerpColors(FAINT, MOON, w);
    moonMat.emissive.copy(glowColor);
    moonMat.emissiveIntensity = THREE.MathUtils.lerp(0.55, 1.5, w) * level;
    halo.material.color.copy(glowColor);
    halo.material.opacity = THREE.MathUtils.lerp(0.35, 0.6, w) * level;
    glowLight.color.copy(glowColor);
    glowLight.intensity = THREE.MathUtils.lerp(0.15, 1.2, w) * level;
    group.userData.dim = glow * SKY.dim;
  };
  group.userData.dim = 0;

  return {
    group,
    // 押せる所（月）。main.js のクリック判定に使う
    hitTargets: [moon],
    setNight(value) {
      if (value === night) return;
      night = value;
      if (!night) on = false;
    },
    // instant: 待たずにすぐ映す（確認用）
    toggle(instant = false) {
      if (!(night && drop > 0.6)) return;
      on = !on;
      swingT = 0;
      if (instant) power = warm = on ? 1 : 0;
    },
    get active() {
      return night && drop > 0.6;
    },
    // 星を映している間、部屋の明かりを落とす割合（main.js で蛍光灯と回り込む光に掛ける）
    get dim() {
      return group.userData.dim;
    },
  };
}

// 月の表面（正距円筒）。明るい灰色の地に、暗い「海」と、縁の明るいクレーター
function moonTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d4c8';
  g.fillRect(0, 0, w, h);
  const rand = mulberry32(11);
  // 細かいざらつき
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // 海：いくつかの暗いまだらを重ねる（表側＝画像の中央あたりに多め）
  const blob = (x, y, r, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(105,102,96,${a})`);
    grad.addColorStop(0.7, `rgba(105,102,96,${a * 0.7})`);
    grad.addColorStop(1, 'rgba(105,102,96,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const seas = [
    [470, 190, 70],
    [540, 230, 55],
    [430, 260, 60],
    [580, 170, 45],
    [500, 300, 40],
    [380, 210, 50],
    [620, 260, 35],
    [200, 240, 40],
    [820, 200, 30],
  ];
  for (const [x, y, r] of seas) {
    for (let k = 0; k < 5; k++) blob(x + (rand() - 0.5) * r, y + (rand() - 0.5) * r * 0.7, r * (0.5 + rand() * 0.6), 0.35);
  }
  // クレーター：暗い窪みと、片側の明るい縁
  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    const y = h * 0.08 + rand() * h * 0.84;
    const r = 2 + rand() ** 3 * 22;
    g.fillStyle = `rgba(90,88,82,${0.25 + rand() * 0.25})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(245,242,232,${0.35 + rand() * 0.3})`;
    g.lineWidth = Math.max(1, r * 0.22);
    g.beginPath();
    g.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.9);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function easeOutBack(x) {
  const c = 1.4;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
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
