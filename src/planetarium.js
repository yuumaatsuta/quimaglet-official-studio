import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 夜になると、画面の手前に天井からマイクが 1 本垂れてくる。
// マイクに触れると、カメラの後ろのプロジェクターから部屋じゅうに星空を映す（プラネタリウム）。
// 同時にカメラの真上の小さな明かりが点き、手前のロボットと床の文字がうっすら見える。
// もう一度触れると消える。朝になるとマイクは天井へ戻る

const SKY = {
  micZ: -4.7, // マイクを吊るす前後の位置（窓の面 z = -5 の少し手前）
  micScale: 1.5,
  // マイクを置く画面上の候補（窓の左右・上下の割合 -1〜1）。前から順に、物に重ならない所を使う
  // 左の壁の明るいコンクリートの前の、少し高い所（メニュー・お知らせ・ブラウン管に重ねない）
  spots: [
    [-0.62, 0.45],
    [-0.7, 0.5],
    [-0.55, 0.55],
    [-0.62, 0.3],
    [0.6, 0.65],
  ],
  dropSeconds: 2.4, // 下りてくるまでの時間
  rampSeconds: 4.5, // 星が浮かび上がるまでの時間
  stars: 26, // 星の明るさ
  starAngle: 1.0, // 投影の広がり（光の円錐の半分の角、ラジアン）
  spin: 0.003, // 星空がゆっくり回る速さ（ラジアン / 秒）
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
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = -0.09;
  mic.add(hit); // 押しやすいよう、見た目より大きく

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

// 吊り下げ用の、四角い銀色のマイク（昔の放送局のような箱形）。原点がケーブルの付け根
function buildMic() {
  const mic = new THREE.Group();
  // 夜の暗い部屋でも銀色に見えるよう、ほんの少しだけ自分で光らせる
  const silver = new THREE.MeshStandardMaterial({ color: '#d2d5da', roughness: 0.26, metalness: 1, emissive: '#30333a' });
  const add = (geo, mat, y, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, y, z);
    m.castShadow = true;
    mic.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.006, 0.008, 0.026, 16), silver, -0.013); // 首
  add(new THREE.SphereGeometry(0.011, 16, 12), silver, -0.029); // 首の付け根の玉
  // 箱：角を丸めた銀の枠と、前後の網（横長のすき間）
  const W = 0.078, H = 0.11, Dp = 0.05;
  const bodyY = -0.036 - H / 2;
  add(new RoundedBoxGeometry(W, H, Dp, 4, 0.014), silver, bodyY);
  const grilleTex = grilleTexture();
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, emissiveMap: grilleTex, emissive: '#3a3d44', roughness: 0.38, metalness: 0.9 });
  const gw = W - 0.018, gh = H - 0.026;
  const front = add(new THREE.PlaneGeometry(gw, gh), grilleMat, bodyY + 0.002, Dp / 2 + 0.0006);
  const back = add(new THREE.PlaneGeometry(gw, gh), grilleMat, bodyY + 0.002, -Dp / 2 - 0.0006);
  back.rotation.y = Math.PI;
  front.castShadow = back.castShadow = false;
  // 下の枠に小さなランプ
  const led = add(
    new THREE.SphereGeometry(0.0028, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#220000', emissive: '#ff2a1a', emissiveIntensity: 0 }),
    bodyY - H / 2 + 0.0065,
    Dp / 2 + 0.0008,
  );
  led.castShadow = false;
  return { mic, led, length: 0.036 + H };
}

// マイクの網：銀の地に、横長のすき間が並ぶ
function grilleTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd1';
  g.fillRect(0, 0, 64, 256);
  for (let y = 6; y < 250; y += 9) {
    g.fillStyle = '#1a1b1e';
    g.fillRect(5, y, 54, 4);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(5, y + 4, 54, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function easeOutBack(x) {
  const c = 1.4;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}
