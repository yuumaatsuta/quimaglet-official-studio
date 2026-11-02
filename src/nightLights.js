import * as THREE from 'three';

// 夜になると、画面の手前に天井から丸い照明がいくつも下りてくる。
// 部屋の家具・ブラウン管・壁のメニューと重ならない所に、星空のようにばらばらの高さで吊るす。
// 下りてきた時はうっすら瞬くだけ。押すとじんわり明るくなり、ロボットや床の文字が見えるくらいに部屋を照らす。
// もう一度押すと消える。朝になると天井へ戻る

const NIGHT = {
  count: 16, // 吊るす数
  zNear: -4.5, // 吊るす前後の範囲（窓の面 z = -5 のあたり。手前ほど画面で大きい）
  zFar: -5.6,
  radius: [0.035, 0.065], // 玉の半径（m）
  lowest: 2.3, // これより低くは吊るさない（m）
  ndcY: [-0.15, 0.9], // 画面の縦のどこに玉を置くか（-1 = 下端、1 = 上端）
  spacing: 0.17, // 玉どうしの画面上の間隔（画面の短い辺に対する割合）
  idle: 1.2, // 消えている時の瞬きの明るさ
  on: 7, // 点いた時の玉の明るさ
  rampSeconds: 3.2, // 点く・消えるまでの時間（じんわり）
  dropSeconds: 2.6, // 下りてくるまでの時間
  color: '#ffd8a0', // 電球色
  lightIntensity: 6, // 部屋を照らす光の強さ（1 つあたり）
};

// ceilingY / halfWidth / backZ: 天井の高さ・部屋の幅の半分・奥の壁の z。
// keepClear: 壁に描いてあっても重ねたくない物（メニューの落書き・お知らせの投影）。root: 部屋の group
export function buildNightLights({ ceilingY, halfWidth, backZ, keepClear, root }) {
  const group = new THREE.Group();
  group.visible = false;
  const rand = mulberry32(31);

  const glow = glowTexture();
  const globeGeo = new THREE.SphereGeometry(1, 24, 16);
  const capGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.5, 12);
  const capMat = new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.5, metalness: 0.6 });
  const cordMat = new THREE.LineBasicMaterial({ color: '#141414' });
  const hitGeo = new THREE.SphereGeometry(1, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  const globes = [];
  for (let i = 0; i < NIGHT.count; i++) {
    const r = THREE.MathUtils.lerp(NIGHT.radius[0], NIGHT.radius[1], rand());
    const mat = new THREE.MeshStandardMaterial({
      color: '#fff6e8',
      roughness: 0.35,
      emissive: NIGHT.color,
      emissiveIntensity: 0,
    });
    const globe = new THREE.Mesh(globeGeo, mat);
    globe.scale.setScalar(r);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 1.05;
    globe.add(cap);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: NIGHT.color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    halo.scale.setScalar(9);
    globe.add(halo);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.scale.setScalar(2.6); // 押しやすいよう、見た目より大きく
    globe.add(hit);
    const cordGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
    const cord = new THREE.Line(cordGeo, cordMat);
    cord.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(globe, cord);
    group.add(holder);
    globes.push({
      holder,
      globe,
      halo,
      cord,
      mat,
      r,
      at: new THREE.Vector3(), // 下りきった時の玉の中心
      delay: rand() * 1.6, // 下りてくる順番をばらばらに
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.4,
      sway: 0.5 + rand() * 0.8,
    });
  }

  // 部屋を照らす光。玉の数だけ置くと重いので、左・中・右の 3 つにまとめる
  const lights = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(NIGHT.color, 0, 9, 2);
    group.add(l);
    return l;
  });

  // ---------- 置き場所 ----------
  // 目から窓の面の点に向けた線を部屋に飛ばし、壁・床・天井より手前の物に当たる所は避ける

  const ray = new THREE.Raycaster();
  ray.camera = new THREE.PerspectiveCamera(); // 部屋のスプライト（光のにじみ）に当てるのに要る
  const dir = new THREE.Vector3();
  const isKeepClear = (hit) => {
    for (let o = hit.object; o; o = o.parent) if (keepClear.includes(o)) return true;
    return false;
  };
  // 壁・床・天井（壁際の棚も壁の一部とみなす）
  const isStructure = (hit) => {
    const p = hit.point;
    return Math.abs(p.x) > halfWidth - 0.5 || p.y < 0.02 || p.y > ceilingY - 0.02 || p.z < backZ + 0.03;
  };
  // clearOnly: メニューの落書き・お知らせの投影だけを避ける（コードは家具の前を横切ってもよい）
  const blocked = (eye, point, clearOnly = false) => {
    dir.subVectors(point, eye).normalize();
    ray.set(eye, dir);
    ray.camera.position.copy(eye);
    ray.camera.lookAt(point);
    ray.camera.updateMatrixWorld();
    ray.far = 60;
    for (const hit of ray.intersectObject(root, true)) {
      if (!hit.object.isMesh || isInGroup(hit.object)) continue;
      if (isKeepClear(hit)) return true;
      return !clearOnly && !isStructure(hit);
    }
    return false;
  };
  const isInGroup = (o) => {
    for (; o; o = o.parent) if (o === group) return true;
    return false;
  };

  function layout(eye, win) {
    const pick = mulberry32(77);
    const placed = [];
    const minDim = Math.min(win.halfW, win.halfH);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let tries = 0;
    for (const g of globes) {
      let ok = false;
      while (!ok && tries < 900) {
        tries++;
        const nx = THREE.MathUtils.lerp(-0.94, 0.94, pick());
        const ny = THREE.MathUtils.lerp(NIGHT.ndcY[0], NIGHT.ndcY[1], pick());
        const sx = nx * win.halfW;
        const sy = ny * win.halfH;
        if (placed.some(([x, y]) => Math.hypot(x - sx, y - sy) < NIGHT.spacing * minDim)) continue;
        const z = THREE.MathUtils.lerp(NIGHT.zNear, NIGHT.zFar, pick());
        // 窓の面の点 → 目からの線上で、深さ z の所
        q.set(win.cx + sx, win.cy + sy, win.cz);
        const k = (eye.z - z) / (eye.z - win.cz);
        p.copy(eye).lerp(q, k);
        if (p.y < NIGHT.lowest || p.y > ceilingY - 0.5 || Math.abs(p.x) > halfWidth - 0.3) continue;
        // 玉のまわりが物に重ならないか、上へ伸びるコードがメニューの落書きを横切らないか確かめる
        const pad = g.r * 2.2;
        const probes = [
          [0, 0],
          [pad, 0],
          [-pad, 0],
          [0, pad],
          [0, -pad],
        ];
        const cord = [];
        for (let y = p.y + 0.3; y < ceilingY - 0.1; y += 0.3) cord.push([0, y - p.y]);
        const at = ([dx, dy]) => new THREE.Vector3(p.x + dx, p.y + dy, p.z);
        ok = !probes.some((d) => blocked(eye, at(d))) && !cord.some((d) => blocked(eye, at(d), true));
        if (ok) {
          g.at.copy(p);
          placed.push([sx, sy]);
        }
      }
      g.holder.visible = ok;
    }
    // 照らす光は、左・中・右の玉の近くに
    const shown = globes.filter((g) => g.holder.visible).sort((a, b) => a.at.x - b.at.x);
    lights.forEach((l, i) => {
      const g = shown[Math.round(((shown.length - 1) * i) / 2)];
      if (g) l.position.copy(g.at).add(new THREE.Vector3(0, -0.15, 0.3));
    });
  }

  // ---------- 動き ----------

  let night = false;
  let drop = 0; // 0 = 天井の中、1 = 下りきった
  let lit = false;
  let power = 0; // 点き具合 0〜1
  let lastKey = null;
  let lastT = 0;

  group.userData.update = (t, view) => {
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    if (!view?.win || !view?.eye) return;
    const key = `${view.win.halfW.toFixed(3)},${view.win.halfH.toFixed(3)}`;
    if (night && key !== lastKey) {
      lastKey = key;
      layout(view.eye, view.win);
    }
    // 下りる・上がる
    const goal = night ? 1 : 0;
    if (drop !== goal) {
      drop = THREE.MathUtils.clamp(drop + (goal ? dt : -dt * 1.4) / NIGHT.dropSeconds, 0, 1);
    }
    group.visible = drop > 0;
    if (!group.visible) return;
    // 点く・消える（ゆっくり温まる電球のように、始めはゆっくり）
    const want = lit && night ? 1 : 0;
    power = THREE.MathUtils.clamp(power + Math.sign(want - power) * (dt / NIGHT.rampSeconds), 0, 1);
    const glowK = power * power * (3 - 2 * power);

    for (const g of globes) {
      if (!g.holder.visible) continue;
      // 1 つずつ時間をずらして下りる。止まり際に少し弾んで、揺れが残る
      const span = 1 - 1.6 / (NIGHT.dropSeconds + 1.6);
      const local = THREE.MathUtils.clamp((drop - (g.delay / (NIGHT.dropSeconds + 1.6))) / span, 0, 1);
      const len = (ceilingY - g.at.y + g.r) * easeOutBack(local);
      const swing = Math.sin(t * g.sway + g.phase) * 0.012; // ゆっくり揺れる
      const x = g.at.x + swing;
      const y = ceilingY + g.r - len;
      g.globe.position.set(x, y, g.at.z + Math.cos(t * g.sway * 0.7 + g.phase) * 0.008);
      const pos = g.cord.geometry.attributes.position;
      pos.setXYZ(0, g.at.x, ceilingY + 0.1, g.at.z);
      pos.setXYZ(1, x, y + g.r * 1.2, g.globe.position.z);
      pos.needsUpdate = true;
      // 消えている時は星のように瞬く。点くと明るく
      const twinkle = NIGHT.idle * (0.55 + 0.45 * Math.sin(t * g.speed * 2 + g.phase)) * local;
      g.mat.emissiveIntensity = THREE.MathUtils.lerp(twinkle, NIGHT.on, glowK);
      g.halo.material.opacity = THREE.MathUtils.lerp(twinkle * 0.9, 0.85, glowK) * local;
    }
    for (const l of lights) l.intensity = NIGHT.lightIntensity * glowK * drop;
  };

  return {
    group,
    // 押せる所（玉）。main.js のクリック判定に使う
    hitTargets: globes.map((g) => g.globe),
    setNight(value) {
      if (value === night) return;
      night = value;
      lastKey = null;
      if (!night) lit = false;
    },
    toggle() {
      if (night && drop > 0.6) lit = !lit;
    },
    get active() {
      return night && drop > 0.6;
    },
  };
}

function easeOutBack(x) {
  const c = 1.4;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
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
