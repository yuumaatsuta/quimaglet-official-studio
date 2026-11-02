import * as THREE from 'three';

// 夜になると、画面の手前に天井からマイクが 1 本垂れてくる。
// マイクに触れると、カメラの後ろのプロジェクターから部屋じゅうに星空を映す（プラネタリウム）。
// 同時にカメラの真上の小さな明かりが点き、手前のロボットと床の文字がうっすら見える。
// もう一度触れると消える。朝になるとマイクは天井へ戻る

const SKY = {
  micZ: -4.7, // マイクを吊るす前後の位置（窓の面 z = -5 の少し手前）
  micScale: 1.25,
  // マイクを置く画面上の候補（窓の左右・上下の割合 -1〜1）。前から順に、物に重ならない所を使う
  // 左の壁の明るいコンクリートの前あたり（メニュー・お知らせ・ブラウン管に重ねない）
  spots: [
    [-0.62, 0.12],
    [-0.7, 0.25],
    [-0.55, 0.3],
    [0.6, 0.6],
    [-0.3, 0.75],
  ],
  dropSeconds: 2.4, // 下りてくるまでの時間
  rampSeconds: 4.5, // 星が浮かび上がるまでの時間
  stars: 26, // 星の明るさ
  starAngle: 1.0, // 投影の広がり（光の円錐の半分の角、ラジアン）
  spin: 0.012, // 星空がゆっくり回る速さ（ラジアン / 秒）
  fill: 0.55, // カメラの真上の明かりの強さ
  fillColor: '#ffdcb8',
  dim: 0.8, // 星を映している間、蛍光灯と回り込む光をどれだけ落とすか（0〜1）
};

// ceilingY / halfWidth / backZ: 天井の高さ・部屋の幅の半分・奥の壁の z。
// keepClear: 重ねたくない物（メニューの落書き・お知らせの投影）。root: 部屋の group
export function buildPlanetarium({ ceilingY, halfWidth, backZ, keepClear, root }) {
  const group = new THREE.Group();

  // ---------- マイク ----------

  const pivot = new THREE.Group(); // 天井の付け根。ここを中心に揺れる
  pivot.visible = false;
  group.add(pivot);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6).translate(0, -0.5, 0),
    new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }),
  );
  pivot.add(cable);
  const { mic, led, length: micLength } = buildMic();
  mic.scale.setScalar(SKY.micScale);
  pivot.add(mic);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = -0.15;
  mic.add(hit); // 押しやすいよう、見た目より大きく

  // ---------- 星を映すプロジェクター（カメラの後ろ）と、手元の明かり（カメラの真上） ----------

  const starMap = starTexture();
  const projector = new THREE.SpotLight('#ffffff', 0, 0, SKY.starAngle, 0.25, 0);
  projector.map = starMap;
  projector.shadow.camera.near = 0.2;
  projector.shadow.camera.far = 30;
  group.add(projector, projector.target);

  const fill = new THREE.SpotLight(SKY.fillColor, 0, 0, 0.62, 0.9, 0);
  group.add(fill, fill.target);

  // ---------- マイクの置き場所 ----------
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

  const len = micLength * SKY.micScale;
  let cableLength = 1;
  function layout(eye, win) {
    const k = (eye.z - SKY.micZ) / (eye.z - win.cz);
    const p = new THREE.Vector3();
    for (const [sx, sy] of SKY.spots) {
      // 窓の面の点 → 目からの線上で、マイクを吊るす深さの所（マイクの真ん中）
      p.set(win.cx + sx * win.halfW, win.cy + sy * win.halfH, win.cz);
      p.sub(eye).multiplyScalar(k).add(eye);
      if (p.y + len / 2 > ceilingY - 0.4) continue;
      const probes = [
        [0, 0],
        [0, len / 2],
        [0, -len / 2],
        [0.08, 0],
        [-0.08, 0],
      ];
      if (probes.some(([dx, dy]) => blocked(eye, new THREE.Vector3(p.x + dx, p.y + dy, p.z)))) continue;
      break;
    }
    pivot.position.set(p.x, ceilingY, p.z);
    cableLength = ceilingY - (p.y + len / 2);

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
  let kick = 0; // 触れたときの揺れ
  let lastKey = null;
  let lastT = 0;
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3();

  group.userData.update = (t, view) => {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    if (!view?.win || !view?.eye) return;
    const key = `${view.win.halfW.toFixed(3)},${view.win.halfH.toFixed(3)}`;
    if (key !== lastKey) {
      lastKey = key;
      layout(view.eye, view.win);
    }

    // マイクが下りる・上がる。止まり際に少し弾む
    const goal = night ? 1 : 0;
    if (drop !== goal) drop = THREE.MathUtils.clamp(drop + (goal ? dt : -dt * 1.4) / SKY.dropSeconds, 0, 1);
    pivot.visible = drop > 0;
    const reach = cableLength * easeOutBack(drop);
    cable.scale.y = Math.max(0.001, reach);
    mic.position.y = -reach;
    kick *= Math.exp(-dt * 1.6);
    pivot.rotation.z = Math.sin(t * 1.1) * (0.012 + kick * 0.06);
    pivot.rotation.x = Math.cos(t * 0.8) * (0.008 + kick * 0.03);

    // 星：プロジェクターのランプが温まるように、少し瞬いてからじんわり浮かび上がる
    const want = on && night ? 1 : 0;
    power = THREE.MathUtils.clamp(power + Math.sign(want - power) * (dt / SKY.rampSeconds), 0, 1);
    const glow = power * power * (3 - 2 * power);
    const flicker = want && power < 0.2 ? 0.6 + 0.4 * Math.sin(t * 37) * Math.sin(t * 11) : 1;
    projector.intensity = SKY.stars * glow * glow * flicker;
    fill.intensity = SKY.fill * glow;
    // 星空はゆっくり回る（投影の向きを軸のまわりに傾ける）
    axis.subVectors(projector.target.position, projector.position).normalize();
    up.set(0, 1, 0).applyAxisAngle(axis, t * SKY.spin);
    projector.shadow.camera.up.copy(up);

    // マイクの小さなランプ：待機中は赤くゆっくり点滅、投影中は青
    const blink = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2)) ** 4;
    led.material.emissive.lerpColors(STANDBY, ACTIVE, glow);
    led.material.emissiveIntensity = THREE.MathUtils.lerp(blink * 3, 2.5, glow) * drop;
    group.userData.dim = glow * SKY.dim;
  };
  group.userData.dim = 0;

  return {
    group,
    // 押せる所（マイク）。main.js のクリック判定に使う
    hitTargets: [mic],
    setNight(value) {
      if (value === night) return;
      night = value;
      if (!night) on = false;
    },
    // instant: 待たずにすぐ映す（確認用）
    toggle(instant = false) {
      if (!(night && drop > 0.6)) return;
      on = !on;
      kick = 1;
      if (instant) power = on ? 1 : 0;
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

const STANDBY = new THREE.Color('#ff2a1a');
const ACTIVE = new THREE.Color('#3aa0ff');

// 吊り下げ用のボーカルマイク（頭が下）。原点がしっぽ（ケーブルの付け根）
function buildMic() {
  const mic = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.42, metalness: 0.55 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d8d8dc', roughness: 0.18, metalness: 1 });
  const add = (geo, mat, y, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z);
    m.castShadow = true;
    mic.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.009, 0.013, 0.022, 16), chrome, -0.011); // ケーブルの差し込み
  add(new THREE.CylinderGeometry(0.0165, 0.0215, 0.15, 24), body, -0.097); // 持ち手
  add(new THREE.CylinderGeometry(0.0265, 0.0225, 0.016, 24), chrome, -0.18); // 頭との境の輪
  // 頭：網の球と、中のスポンジ
  const headY = -0.188 - 0.042;
  add(new THREE.SphereGeometry(0.039, 20, 14), new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.95 }), headY);
  const grille = add(
    new THREE.SphereGeometry(0.044, 32, 20),
    new THREE.MeshStandardMaterial({
      color: '#c9c9ce',
      roughness: 0.3,
      metalness: 1,
      alphaMap: meshTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
    headY,
  );
  grille.scale.y = 1.08;
  const led = add(
    new THREE.SphereGeometry(0.0032, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#220000', emissive: '#ff2a1a', emissiveIntensity: 0 }),
    -0.06,
    0.0185,
  );
  led.castShadow = false;
  return { mic, led, length: 0.188 + 0.042 * 2 * 1.08 };
}

// マイクの頭の網目（白い所が金属）
function meshTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 32, 8);
  g.fillRect(0, 0, 8, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 13);
  return t;
}

// 投影する星空。黒地に大小の星と、斜めに流れる天の川
function starTexture() {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const rand = mulberry32(2024);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2;
  const tints = ['255,255,255', '214,228,255', '255,238,214', '200,216,255', '255,222,200'];
  const dot = (x, y, r, a, tint) => {
    g.fillStyle = `rgba(${tint},${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  g.globalCompositeOperation = 'lighter';

  // 天の川：画面を斜めに横切る淡い帯と、細かい星の集まり
  const band = (s) => {
    const x = s * size;
    const y = size * 0.95 - s * size * 0.85;
    return [x, y];
  };
  for (let i = 0; i < 90; i++) {
    const [x, y] = band(rand());
    const off = gauss() * size * 0.05;
    const r = size * (0.04 + rand() * 0.06);
    const grad = g.createRadialGradient(x + off, y + off, 0, x + off, y + off, r);
    grad.addColorStop(0, 'rgba(190,200,255,0.05)');
    grad.addColorStop(1, 'rgba(190,200,255,0)');
    g.fillStyle = grad;
    g.fillRect(x + off - r, y + off - r, r * 2, r * 2);
  }
  for (let i = 0; i < 3200; i++) {
    const [x, y] = band(rand());
    const off = gauss() * size * 0.09;
    dot(x + off * 0.7, y + off, 0.5 + rand() * 0.5, 0.12 + rand() * 0.3, tints[(rand() * tints.length) | 0]);
  }

  // ふつうの星：ほとんどは暗く、ときどき明るい
  for (let i = 0; i < 2200; i++) {
    const m = rand() ** 5;
    dot(rand() * size, rand() * size, 0.6 + m * 1.8, 0.25 + 0.75 * m, tints[(rand() * tints.length) | 0]);
  }
  // 明るい星：にじみを付ける
  for (let i = 0; i < 45; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const tint = tints[(rand() * tints.length) | 0];
    const r = 7 + rand() * 9;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${tint},0.9)`);
    grad.addColorStop(0.25, `rgba(${tint},0.3)`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    dot(x, y, 2.2, 1, '255,255,255');
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
