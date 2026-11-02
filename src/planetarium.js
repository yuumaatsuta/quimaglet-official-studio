import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// 夜になると、画面の手前に天井からマイクが 1 本垂れてくる。マイクの中は青く光っている。
// 触れるとバチバチと火花が散って中が赤く光り、カメラの後ろのプロジェクターから部屋じゅうに星空を映す（プラネタリウム）。
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
  zapSeconds: 0.9, // 触れてからバチバチしている時間
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
  const { mic, coreMat, head, headSize, length: micLength } = buildMic();
  mic.scale.setScalar(SKY.micScale);
  pivot.add(mic);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = -0.11;
  mic.add(hit); // 押しやすいよう、見た目より大きく
  // 頭の中の光：格子のすき間から漏れる光のにじみと、まわりを少し照らす光
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: BLUE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }),
  );
  halo.scale.setScalar(0.24);
  halo.position.copy(head);
  mic.add(halo);
  const glowLight = new THREE.PointLight(BLUE, 0, 1.6, 2);
  glowLight.position.copy(head);
  mic.add(glowLight);
  // 触れたときの火花（頭のまわりに走る、ぎざぎざの稲妻）
  const sparkMat = new THREE.LineBasicMaterial({ color: ZAP, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sparks = [];
  for (let i = 0; i < 7; i++) {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
    const line = new THREE.Line(geo, sparkMat);
    line.frustumCulled = false;
    line.visible = false;
    mic.add(line);
    sparks.push(line);
  }
  const sp = new THREE.Vector3();
  const sd = new THREE.Vector3();
  const zapSparks = () => {
    for (const line of sparks) {
      line.visible = Math.random() < 0.75;
      if (!line.visible) continue;
      // 頭の表面のどこかから、外へ向かってぎざぎざに伸ばす
      sd.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      sp.set(sd.x * headSize.x, sd.y * headSize.y, sd.z * headSize.z).add(head);
      const length = 0.035 + Math.random() * 0.06;
      const arr = line.geometry.attributes.position;
      for (let k = 0; k < 8; k++) {
        const f = (k / 7) * length;
        const j = k === 0 ? 0 : 0.009;
        arr.setXYZ(
          k,
          sp.x + sd.x * f + (Math.random() - 0.5) * j,
          sp.y + sd.y * f + (Math.random() - 0.5) * j,
          sp.z + sd.z * f + (Math.random() - 0.5) * j,
        );
      }
      arr.needsUpdate = true;
    }
  };

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
  let zapping = -1; // バチバチしている残り時間（< 0 なら していない）
  let zapTo = false; // バチバチが終わったら点けるか消すか
  let nextZap = 0;
  let red = 0; // 中の光の色 0 = 青、1 = 赤
  const glowColor = new THREE.Color();
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

    // マイクの中の光：ふだんは青くゆっくり息をするように。触れるとバチバチして、赤に変わる
    red = THREE.MathUtils.clamp(red + (on ? dt : -dt) * 2.5, 0, 1);
    glowColor.lerpColors(BLUE, RED, red);
    let level = (0.75 + 0.25 * Math.sin(t * 1.7)) * drop;
    mic.position.x = 0;
    if (zapping >= 0) {
      zapping -= dt;
      if (t >= nextZap) {
        nextZap = t + 0.04 + Math.random() * 0.05;
        zapSparks();
      }
      const flash = Math.random();
      glowColor.lerp(ZAP, flash);
      level = 0.3 + flash * 2.2;
      mic.position.x = (Math.random() - 0.5) * 0.006;
      sparkMat.opacity = 0.5 + Math.random() * 0.5;
      if (zapping < 0) {
        on = zapTo;
        for (const line of sparks) line.visible = false;
      }
    }
    coreMat.emissive.copy(glowColor);
    coreMat.emissiveIntensity = 2.2 * level;
    halo.material.color.copy(glowColor);
    halo.material.opacity = 0.55 * Math.min(1, level);
    glowLight.color.copy(glowColor);
    glowLight.intensity = 0.35 * level;
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
      if (!night) {
        on = false;
        zapping = -1;
        for (const line of sparks) line.visible = false;
      }
    },
    // instant: 待たずにすぐ映す（確認用）
    toggle(instant = false) {
      if (!(night && drop > 0.6) || zapping >= 0) return;
      kick = 1;
      if (instant) {
        on = !on;
        power = red = on ? 1 : 0;
        return;
      }
      // バチバチしてから切り替える
      zapping = SKY.zapSeconds;
      zapTo = !on;
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

const BLUE = new THREE.Color('#2f7dff');
const RED = new THREE.Color('#ff2a18');
const ZAP = new THREE.Color('#e6f1ff');

// 1950 年代のステージ用のような、楕円の頭に横の格子が巻いたクロームのマイク。
// 立てた向きで作ってから逆さにし、台座の端からケーブルで吊るす（原点がケーブルの付け根、マイクは -y へ伸びる）
function buildMic() {
  const mic = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.z = Math.PI;
  mic.add(body);
  // 夜の暗い部屋でもクロームだとわかるよう、ほんの少しだけ自分で光らせる
  const chrome = new THREE.MeshStandardMaterial({ color: '#e4e6ea', roughness: 0.12, metalness: 1, emissive: '#272a30' });
  const black = new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.45, metalness: 0.3 });
  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // 台座：根元が細く、頭のほうが太い、角を落とした箱。前に黒い板とスイッチ
  const baseGeo = new RoundedBoxGeometry(0.03, 0.075, 0.028, 3, 0.006);
  const pos = baseGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.72 + 0.28 * ((pos.getY(i) + 0.0375) / 0.075);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  baseGeo.computeVertexNormals();
  add(baseGeo, chrome, 0, 0.0375, 0);
  add(new THREE.BoxGeometry(0.017, 0.038, 0.002), black, 0, 0.042, 0.0142);
  add(new THREE.BoxGeometry(0.005, 0.01, 0.003), chrome, 0, 0.046, 0.0158);

  // 首の継ぎ手：左右の板と、横に通したボルト・六角のナット
  for (const x of [-0.013, 0.013]) add(new THREE.BoxGeometry(0.004, 0.032, 0.016), chrome, x, 0.086, 0);
  add(new THREE.CylinderGeometry(0.005, 0.005, 0.032, 12).rotateZ(Math.PI / 2), chrome, 0, 0.092, 0);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 6).rotateZ(Math.PI / 2), chrome, 0.017, 0.092, 0);
  add(new THREE.CylinderGeometry(0.011, 0.013, 0.012, 20), chrome, 0, 0.104, 0);

  // 頭：中の光る芯と、横に巻いた格子、上の丸い蓋と下の帯
  const HX = 0.036;
  const HY = 0.05;
  const HZ = 0.033;
  const headY = 0.108 + HY;
  const coreMat = new THREE.MeshStandardMaterial({ color: '#050608', roughness: 0.8, emissive: BLUE, emissiveIntensity: 0 });
  add(new THREE.SphereGeometry(1, 24, 16).scale(HX * 0.86, HY * 0.9, HZ * 0.86), coreMat, 0, headY, 0).castShadow = false;
  for (let i = 0; i <= 10; i++) {
    const yy = -0.036 + i * 0.0072;
    const s = Math.sqrt(1 - (yy / HY) ** 2);
    const pts = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * HX * s, 0, Math.sin(a) * HZ * s));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.0027, 6, true), chrome, 0, headY + yy, 0);
  }
  const cap = Math.acos(0.8);
  add(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, cap).scale(HX, HY, HZ), chrome, 0, headY, 0);
  add(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, Math.PI - cap, cap).scale(HX, HY, HZ), chrome, 0, headY, 0);

  return { mic, coreMat, head: new THREE.Vector3(0, -headY, 0), headSize: new THREE.Vector3(HX, HY, HZ), length: headY + HY };
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
