import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 窓の外の近未来の大都市。スタジオは地上 90m ほどの高層階にあり、窓（+x）の外に、
// 実在の超高層建築を手本にした街並みがもやの奥まで続き、空には空飛ぶ車が行き交う。
//
// 手本にした建物の形（そっくりそのままではなく、形の特徴だけを借りている）
//   ・ねじれながら細くなる三角形の塔 …… 上海中心（上海タワー）
//   ・正方形が上で 45° 回った、三角の面でできた塔と尖塔 …… ワン・ワールドトレードセンター
//   ・上が一段細くなる双子の塔 …… 東京都庁舎
//   ・ガラスのピラミッドを頂く三つの段違いの塔 …… 新宿パークタワー
//   ・屋上を斜めに切り落とした塔 …… シティグループ・センター
//   ・末広がりの節を積み重ねた塔 …… 台北 101
//   ・極端に細い格子窓の塔 …… 432 パーク・アベニュー
// ふつうのビルは、ガラスのカーテンウォール・タワーマンションのバルコニー・
// 格子窓のオフィス・縦のルーバー・低層の商業棟、の 5 種類の外壁で描き分ける。
//
// 光の当たり方は部屋のライト（シャッターで絞られる）を使わず、天気の値から
// このファイルの中で計算する（シャッターを閉めても外の景色の明るさは変わらない）。
// 文字や看板（ネオンサインなど）は置かない（遠目には崩れて見えるため）。

const GROUND = -90; // 地面の高さ（m）。スタジオの床は 0
const EYE = { x: 0, y: 1.15, z: -2.38 }; // 部屋の目の位置（窓の外をどの向きに見るかの基準）

// 目から距離 R、向き k（x に 1 進むあいだに -z へ k 進む）の地点
const at = (R, k) => {
  const n = Math.hypot(1, k);
  return [EYE.x + R / n, EYE.z - (R * k) / n];
};
// 窓から見える向きはおよそ k = 1.0〜2.4（スマホは 2.0〜2.4）。視点の揺れのぶん広めに建てる
const K_MIN = 0.5;
const K_MAX = 3.6;
const VIEW_K = 1.6; // 見える範囲のまんなか

// 空の車道（目からの距離・高さ・片側の長さ・片道あたりの台数・速さ m/s）。
// 窓の前を横切る向きに通す。最後の 2 本は奥へ向かう道
const LANES = [];
{
  const n = Math.hypot(1, VIEW_K);
  const side = [VIEW_K / n, 1 / n];
  for (const [R, y, half, count, speed] of [
    [36, 3.2, 55, 3, 8],
    [62, 9, 75, 4, 11],
    [105, -4, 105, 5, 14],
    [165, 20, 150, 6, 17],
    [250, 6, 200, 7, 20],
    [380, 38, 280, 8, 24],
    [620, 16, 420, 10, 28],
  ]) {
    const [cx, cz] = at(R, VIEW_K);
    LANES.push({ a: [cx - side[0] * half, y, cz - side[1] * half], b: [cx + side[0] * half, y, cz + side[1] * half], count, speed });
  }
  for (const [k, y, count] of [
    [1.15, 24, 10],
    [2.15, 32, 10],
  ]) {
    const [ax, az] = at(60, k);
    const [bx, bz] = at(1100, k);
    LANES.push({ a: [ax, y, az], b: [bx, y + 30, bz], count, speed: 30 });
  }
}

export function createCity(scene) {
  const rand = mulberry(11);
  const group = new THREE.Group();
  group.userData.noPick = true;
  scene.add(group);

  const uniforms = {
    uNight: { value: 0 },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.75, 0.75).normalize() },
    uSunCol: { value: new THREE.Color() },
    uSkyTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uAmbK: { value: 1 },
    uExt: { value: 0.0013 },
    uFlash: { value: 0 },
  };

  // ---------- 建物 ----------

  const parts = [];
  const tops = []; // 航空障害灯（赤）
  const strobes = []; // 高い塔の頂の白い閃光灯
  const add = (geo, b) => parts.push(withAttributes(geo, b));

  buildLandmarks(add, rand, tops, strobes);
  buildBlocks(add, rand, tops);

  // 地面（暗いアスファルト）
  add(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2).translate(800, GROUND, -1200), {
    wall: [0.06, 0.06, 0.065], style: 9, seed: 0,
  });

  const buildings = new THREE.Mesh(mergeGeometries(parts), buildingMaterial(uniforms));
  buildings.frustumCulled = false;
  group.add(buildings);

  // ---------- 空飛ぶ車・航空障害灯・街灯・サーチライト ----------

  const cars = flyingCars(uniforms);
  group.add(cars.body, cars.lights, beacons(tops, strobes, uniforms), streetLights(rand, uniforms));
  const lights = searchlights(uniforms);
  group.add(lights.group);

  for (const o of group.children) {
    o.castShadow = false;
    o.receiveShadow = false;
    o.userData.noPick = true;
  }

  return {
    // 天気の値をそのまま受け取る（シャッターの開き具合は関係させない）
    setLook({ night, sun, sunColor, skyTop, horizon, fog, glow, flash }) {
      const u = uniforms;
      u.uNight.value = night;
      u.uSunCol.value.copy(sunColor).multiplyScalar(sun * 0.32);
      u.uSkyTop.value.copy(skyTop);
      u.uHorizon.value.copy(horizon);
      u.uGlow.value.copy(glow);
      u.uExt.value = 0.00035 + fog * 0.12;
      u.uAmbK.value = 0.62;
      u.uFlash.value = flash;
      lights.group.visible = night > 0.05;
    },
    update(t) {
      uniforms.uTime.value = t;
      lights.update(t);
    },
  };
}

// ---------------------------------------------------------------------------
// 形
// ---------------------------------------------------------------------------

const box = (w, h, d, x, y, z, ry = 0) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(ry).translate(x, y, z);

// 角錐（ガラスのピラミッドの屋根）
const pyramid = (w, h, d, x, y, z) =>
  new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w, h, d).translate(x, y + h / 2, z);

// 屋上を斜めに切り落とした箱
function slanted(w, h, d, drop, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h - 0.01) p.setY(i, h - drop * (0.5 - p.getX(i) / w));
  }
  g.computeVertexNormals();
  return g.translate(x, y, z);
}

// 輪（点の並び）を下から順に積んで、側面と屋根をつくる。輪の点は上から見て角度が増える順
function loft(rings, smooth) {
  const pos = [];
  const idx = [];
  const n = rings[0].length;
  if (smooth) {
    for (const r of rings) for (const p of r) pos.push(...p);
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * n + i;
        const b = j * n + ((i + 1) % n);
        const c = (j + 1) * n + ((i + 1) % n);
        const d = (j + 1) * n + i;
        idx.push(a, c, b, a, d, c);
      }
    }
  } else {
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < n; i++) {
        const s = pos.length / 3;
        for (const p of [rings[j][i], rings[j][(i + 1) % n], rings[j + 1][(i + 1) % n], rings[j + 1][i]]) pos.push(...p);
        idx.push(s, s + 2, s + 1, s, s + 3, s + 2);
      }
    }
  }
  const top = rings[rings.length - 1];
  const c = pos.length / 3;
  const cx = top.reduce((s, p) => s + p[0], 0) / n;
  const cz = top.reduce((s, p) => s + p[2], 0) / n;
  pos.push(cx, top[0][1], cz);
  for (const p of top) pos.push(...p);
  for (let i = 0; i < n; i++) idx.push(c, c + 1 + ((i + 1) % n), c + 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 建物ごとの値を頂点に持たせる
//   wall: 外壁（柱・スパンドレル・バルコニー）の色  glass: ガラスの色
//   style: 外壁の種類（0 カーテンウォール 1 マンション 2 格子窓 3 縦ルーバー 4 商業棟 9 窓なし）
//   curve: 円い塔の半径（窓の横方向を角度から測る）。0 なら平らな面
//   ratio: 夜に灯っている割合  refl: ガラスの映り込みの強さ
function withAttributes(geo, b) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const fill = (key, arr) => {
    const a = new Float32Array(n * arr.length);
    for (let i = 0; i < n; i++) a.set(arr, i * arr.length);
    g.setAttribute(key, new THREE.BufferAttribute(a, arr.length));
  };
  fill('color', b.wall);
  fill('aGlass', b.glass ?? [0.1, 0.12, 0.14]);
  fill('aInfo', [b.seed ?? 0, b.style ?? 9, b.curve ?? 0, b.ratio ?? 0.4]);
  fill('aCenter', [b.cx ?? 0, b.base ?? GROUND, b.cz ?? 0, b.refl ?? 0.2]);
  return g;
}

const GLASS = [
  [0.16, 0.22, 0.28], // 青みの灰
  [0.17, 0.25, 0.24], // 緑がかった
  [0.24, 0.21, 0.18], // ブロンズ
  [0.3, 0.32, 0.35], // 銀
  [0.09, 0.1, 0.12], // 黒
];
const WALL = {
  metal: [[0.55, 0.57, 0.6], [0.2, 0.21, 0.23], [0.42, 0.43, 0.45]],
  stone: [[0.5, 0.47, 0.42], [0.6, 0.6, 0.57], [0.4, 0.4, 0.39], [0.38, 0.3, 0.25], [0.24, 0.24, 0.25]],
  white: [[0.78, 0.78, 0.75], [0.66, 0.64, 0.6]],
};
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// ---------- 手本のある大きな塔 ----------

function buildLandmarks(add, rand, tops, strobes) {
  const B = (x, z, extra) => ({ cx: x, cz: z, base: GROUND, seed: rand(), ratio: 0.5, ...extra });

  // ねじれながら細くなる三角形の塔（上海中心）
  {
    const [x, z] = at(1250, 1.35);
    const H = 620;
    const R = 40;
    const rings = [];
    for (let j = 0; j <= 48; j++) {
      const t = j / 48;
      const s = 1 - 0.5 * Math.pow(t, 1.15);
      const rot = t * 2.1;
      const ring = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const r = R * s * (1 - 0.14 * Math.cos(3 * a));
        ring.push([x + Math.cos(a + rot) * r, GROUND + t * H, z + Math.sin(a + rot) * r]);
      }
      rings.push(ring);
    }
    add(loft(rings, true), B(x, z, { style: 0, curve: R * 0.8, wall: [0.55, 0.58, 0.62], glass: [0.2, 0.27, 0.32], refl: 0.35, ratio: 0.55 }));
    add(box(2, 40, 2, x, GROUND + H, z), B(x, z, { style: 9, wall: [0.4, 0.4, 0.42] }));
    strobes.push(new THREE.Vector3(x, GROUND + H + 40, z));
  }

  // 正方形が上で 45° 回る、三角の面の塔と尖塔（ワン・ワールドトレードセンター）
  {
    const [x, z] = at(820, 1.85);
    const H = 420;
    const h = 30;
    const level = (y, t) => {
      const ring = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        // 下は正方形（角 45°・135°…）、上は 45° 回った小さな正方形（角 0°・90°…）
        const bottom = i % 2 === 1 ? h * Math.SQRT2 : h;
        const top = (i % 2 === 0 ? h * Math.SQRT2 : h) * 0.55;
        const r = bottom + (top - bottom) * t;
        ring.push([x + Math.cos(a) * r, y, z + Math.sin(a) * r]);
      }
      return ring;
    };
    add(box(h * 2.05, 55, h * 2.05, x, GROUND, z), B(x, z, { style: 3, wall: [0.7, 0.71, 0.72], glass: [0.2, 0.24, 0.28] }));
    add(loft([level(GROUND + 55, 0), level(GROUND + H, 1)], false), B(x, z, { style: 0, wall: [0.6, 0.62, 0.66], glass: [0.22, 0.28, 0.34], refl: 0.42, ratio: 0.5 }));
    add(new THREE.CylinderGeometry(1.2, 2.2, 120, 8).translate(x, GROUND + H + 60, z), B(x, z, { style: 9, wall: [0.75, 0.76, 0.78] }));
    strobes.push(new THREE.Vector3(x, GROUND + H + 120, z));
  }

  // 上が一段細くなる双子の塔（東京都庁舎）
  {
    const [x, z] = at(720, 1.2);
    const stone = [0.66, 0.63, 0.58];
    add(box(120, 38, 60, x, GROUND, z), B(x, z, { style: 4, wall: stone, glass: [0.14, 0.16, 0.18] }));
    for (const s of [-1, 1]) {
      const tx = x + s * 27;
      add(box(40, 200, 40, tx, GROUND, z), B(tx, z, { style: 2, wall: stone, glass: [0.12, 0.14, 0.16], ratio: 0.55 }));
      add(box(28, 45, 28, tx, GROUND + 200, z, Math.PI / 4), B(tx, z, { style: 2, wall: stone, glass: [0.12, 0.14, 0.16], ratio: 0.5 }));
      tops.push(new THREE.Vector3(tx, GROUND + 245, z));
    }
  }

  // ガラスのピラミッドを頂く、三つの段違いの塔（新宿パークタワー）
  {
    const [x, z] = at(300, 2.08);
    for (const [dx, dz, h] of [
      [0, 0, 235],
      [30, -16, 212],
      [-6, -34, 190],
    ]) {
      const bx = x + dx;
      const bz = z + dz;
      add(box(28, h, 28, bx, GROUND, bz), B(bx, bz, { style: 3, wall: [0.6, 0.6, 0.6], glass: [0.15, 0.2, 0.24], ratio: 0.5 }));
      add(pyramid(28, 22, 28, bx, GROUND + h, bz), B(bx, bz, { style: 0, wall: [0.35, 0.38, 0.4], glass: [0.18, 0.22, 0.26], refl: 0.5 }));
      tops.push(new THREE.Vector3(bx, GROUND + h + 22, bz));
    }
  }

  // 屋上を斜めに切り落とした塔（シティグループ・センター）
  {
    const [x, z] = at(640, 1.05);
    add(slanted(44, 275, 44, 40, x, GROUND + 30, z), B(x, z, { style: 2, wall: [0.74, 0.74, 0.72], glass: [0.12, 0.13, 0.15], ratio: 0.5 }));
    add(box(20, 30, 20, x, GROUND, z), B(x, z, { style: 9, wall: [0.5, 0.5, 0.5] }));
    tops.push(new THREE.Vector3(x, GROUND + 305, z));
  }

  // 末広がりの節を積み重ねた塔（台北 101）
  {
    const [x, z] = at(1500, 2.25);
    const glass = { style: 0, wall: [0.32, 0.4, 0.38], glass: [0.16, 0.26, 0.24], refl: 0.3, ratio: 0.45 };
    const sq = (y, half) => [0, 1, 2, 3].map((i) => {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      return [x + Math.cos(a) * half * Math.SQRT2, y, z + Math.sin(a) * half * Math.SQRT2];
    });
    add(loft([sq(GROUND, 40), sq(GROUND + 110, 30)], false), B(x, z, glass));
    let y = GROUND + 110;
    for (let i = 0; i < 8; i++) {
      add(loft([sq(y, 24), sq(y + 34, 30)], false), B(x, z, glass));
      y += 34;
    }
    add(loft([sq(y, 18), sq(y + 30, 13)], false), B(x, z, glass));
    add(new THREE.CylinderGeometry(0.8, 2, 60, 6).translate(x, y + 60, z), B(x, z, { style: 9, wall: [0.5, 0.5, 0.5] }));
    strobes.push(new THREE.Vector3(x, y + 90, z));
  }

  // 極端に細い格子窓の塔（432 パーク・アベニュー）
  {
    const [x, z] = at(540, 2.45);
    add(box(26, 400, 26, x, GROUND, z), B(x, z, { style: 2, wall: [0.82, 0.82, 0.8], glass: [0.08, 0.09, 0.11], ratio: 0.4 }));
    tops.push(new THREE.Vector3(x, GROUND + 400, z));
  }
}

// ---------- 街区（ふつうのビル） ----------

// 高い塔が集まる地区（中心からの距離で密度が上がる）
const CLUSTERS = [
  [...at(520, 1.5), 260],
  [...at(1150, 1.15), 380],
  [...at(260, 2.2), 140],
  [...at(900, 2.4), 260],
];
const cluster = (x, z) => Math.min(1, CLUSTERS.reduce((s, [cx, cz, r]) => s + Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r)), 0));

function laneDistance(x, z, lane) {
  const [ax, , az] = lane.a;
  const [bx, , bz] = lane.b;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return { d: Math.hypot(x - (ax + dx * t), z - (az + dz * t)), y: lane.a[1] + (lane.b[1] - lane.a[1]) * t };
}

function buildBlocks(add, rand, tops) {
  const STEP = 84; // 街区 64m ＋ 道路 20m
  for (let x = 6; x < 1500; x += STEP) {
    for (let z = -2300; z < 120; z += STEP) {
      const cx = x + STEP / 2;
      const cz = z + STEP / 2;
      const dx = cx - EYE.x;
      const R = Math.hypot(dx, cz - EYE.z);
      const k = (EYE.z - cz) / dx;
      if (k < K_MIN || k > K_MAX || R < 30 || R > 2000) continue;
      // 街区を 1〜4 区画に分ける
      const split = rand();
      const lots =
        split < 0.25
          ? [[0, 0, 64, 64]]
          : split < 0.55
            ? [[-17, 0, 30, 64], [17, 0, 30, 64]]
            : [[-17, -17, 30, 30], [17, -17, 30, 30], [-17, 17, 30, 30], [17, 17, 30, 30]];
      for (const [ox, oz, lw, ld] of lots) {
        if (rand() < 0.08) continue; // 空き地・公園
        building(add, rand, tops, cx + ox, cz + oz, lw, ld, R);
      }
    }
  }
}

function building(add, rand, tops, x, z, lw, ld, R) {
  const cl = cluster(x, z);
  let h;
  if (R < 75) h = 14 + rand() * 48; // 窓のすぐ外は見下ろす低いビル
  else {
    h = 22 + rand() * 55 + cl * 70;
    if (rand() < 0.1 + cl * 0.45) h = 100 + rand() * (110 + cl * 190);
  }
  // 空の車道の下は、車道より低く抑える（車が建物を突き抜けないように）
  for (const lane of LANES) {
    const { d, y } = laneDistance(x, z, lane);
    if (d < Math.max(lw, ld) * 0.75 + 14 && GROUND + h > y - 14) h = Math.max(10, y - 22 - GROUND);
  }

  const r = rand();
  const glassy = h > 100 ? 0.65 : 0.4; // 高い塔ほどガラス張りが多い
  const style = h < 40 && rand() < 0.4 ? 4 : r < glassy ? 0 : r < glassy + 0.17 ? 1 : r < glassy + 0.27 ? 2 : 3;
  const wall = style === 0 ? pick(rand, WALL.metal) : style === 1 ? pick(rand, WALL.white) : pick(rand, WALL.stone);
  const b = {
    style,
    wall,
    glass: pick(rand, GLASS),
    seed: rand(),
    ratio: style === 1 ? 0.25 + rand() * 0.35 : 0.12 + rand() * 0.4,
    refl: style === 0 ? 0.2 + rand() * 0.25 : 0.08 + rand() * 0.08,
    cx: x,
    cz: z,
    base: GROUND,
  };
  const roof = { ...b, style: 9, wall: wall.map((c) => c * 0.75) };

  let w = lw - 4 - rand() * 6;
  let d = ld - 4 - rand() * 6;
  let y = GROUND;

  // 高いビルは低層の商業棟の上に建てる
  if (h > 70 && rand() < 0.55) {
    const ph = 10 + rand() * 12;
    add(box(lw - 3, ph, ld - 3, x, y, z), { ...b, style: 4, wall: pick(rand, WALL.stone), seed: rand() });
    y += ph;
    w *= 0.6 + rand() * 0.2;
    d *= 0.6 + rand() * 0.2;
  }
  const top = GROUND + h;
  const shape = rand();
  if (h > 90 && shape < 0.16) {
    // 円い塔
    const rad = Math.min(w, d) / 2;
    add(new THREE.CylinderGeometry(rad, rad, top - y, 28).translate(x, (top + y) / 2, z), { ...b, curve: rad });
    if (rand() < 0.5) add(new THREE.CylinderGeometry(rad * 0.6, rad * 0.6, 6, 20).translate(x, top + 3, z), roof);
    if (h > 140) tops.push(new THREE.Vector3(x, top + 6, z));
    return;
  }
  if (h > 90 && shape < 0.28) {
    // 角を落とした八角形の塔
    const rad = Math.min(w, d) / 2 / Math.cos(Math.PI / 8);
    add(new THREE.CylinderGeometry(rad, rad, top - y, 8).rotateY(Math.PI / 8).translate(x, (top + y) / 2, z), b);
    if (h > 140) tops.push(new THREE.Vector3(x, top, z));
    return;
  }
  // 角の塔。高いものは 1〜3 回セットバックする
  const steps = h > 150 ? 1 + Math.floor(rand() * 3) : h > 100 && rand() < 0.5 ? 1 : 0;
  for (let i = 0; i <= steps; i++) {
    const th = i === steps ? top - y : (top - y) * (0.45 + rand() * 0.2);
    add(box(w, th, d, x, y, z), b);
    y += th;
    if (i < steps) {
      w *= 0.72 + rand() * 0.1;
      d *= 0.72 + rand() * 0.1;
    }
  }
  // 屋上：ピラミッド・斜めの屋根・アンテナ・設備
  const crown = rand();
  if (h > 110 && crown < 0.16) {
    add(pyramid(w, Math.min(w, d) * 0.6, d, x, y, z), { ...b, style: 0, wall: [0.3, 0.32, 0.34], refl: 0.4 });
    y += Math.min(w, d) * 0.6;
  } else if (h > 110 && crown < 0.26) {
    add(slanted(w, 14, d, 14, x, y, z), { ...b, style: 0, refl: 0.35 });
    y += 14;
  } else {
    for (let i = 0, m = 1 + Math.floor(rand() * 3); i < m; i++) {
      add(box(w * (0.2 + rand() * 0.25), 2.5 + rand() * 4, d * (0.2 + rand() * 0.25), x + (rand() - 0.5) * w * 0.4, y, z + (rand() - 0.5) * d * 0.4), roof);
    }
    if (h > 120 && crown < 0.5) {
      const mh = 12 + rand() * 25;
      add(box(1, mh, 1, x + w * 0.2, y, z - d * 0.2), roof);
      y += mh;
    }
  }
  if (h > 140) tops.push(new THREE.Vector3(x, y, z));
}

// ---------------------------------------------------------------------------
// 光の当て方（部屋のライトを使わず、天気の値から計算する）
// ---------------------------------------------------------------------------

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSkyTop, uHorizon, uGlow;
uniform float uNight, uTime, uExt, uFlash, uAmbK;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// 映り込む空（下向きは街と地面の暗い色）
vec3 skyAt(vec3 r) {
  float e = r.y;
  vec3 s = mix(uHorizon, uSkyTop, pow(clamp(e, 0.0, 1.0), 0.45)) + uGlow * exp(-max(e, 0.0) * 9.0);
  vec3 g = uHorizon * 0.32 + uGlow * 0.3;
  return mix(g, s, smoothstep(-0.12, 0.04, e));
}
// まわりから回り込む光（上は空、下は地面の照り返し）
vec3 ambientAt(vec3 n) {
  vec3 up = mix(uHorizon, uSkyTop, 0.35);
  vec3 dn = uHorizon * 0.22 + uGlow * 0.4;
  return (mix(dn, up, n.y * 0.5 + 0.5) * uAmbK + uFlash * vec3(0.75, 0.8, 1.0));
}
// もや：低いところほど濃い
vec3 cityFog(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  float hgt = max(wp.y - (${GROUND.toFixed(1)}), 0.0);
  float k = uExt * (0.4 + 0.8 * exp(-hgt / 150.0));
  float f = 1.0 - exp(-k * d);
  return mix(col, uHorizon + uGlow * 0.25, clamp(f, 0.0, 0.985));
}
`;

// 外壁とガラスと窓明かり。窓・柱・床の線は、画面の 1 画素の幅でならして描く（遠くでちらつかない）
function buildingMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 aGlass;
      attribute vec4 aInfo;
      attribute vec4 aCenter;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vWall;
      varying vec3 vGlass;
      varying vec4 vInfo;
      varying vec4 vCenter;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vWall = color;
        vGlass = aGlass;
        vInfo = aInfo;
        vCenter = aCenter;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${LIGHT_GLSL}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vWall;
      varying vec3 vGlass;
      varying vec4 vInfo;
      varying vec4 vCenter;

      // 周期 period ごとに [a, b]（周期に対する割合）を占める帯が、この画素をどれだけ覆うか
      float stripe(float x, float period, float a, float b) {
        float t = x / period;
        float fw = max(fwidth(t), 1e-4);
        float t0 = t - fw * 0.5;
        float t1 = t + fw * 0.5;
        float F1 = floor(t1) * (b - a) + clamp(fract(t1), a, b) - a;
        float F0 = floor(t0) * (b - a) + clamp(fract(t0), a, b) - a;
        return clamp((F1 - F0) / fw, 0.0, 1.0);
      }

      void main() {
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float seed = vInfo.x;
        float style = vInfo.y;
        float curve = vInfo.z;
        float ratio = vInfo.w;
        float refl = vCenter.w;
        bool facade = abs(n.y) < 0.5 && style < 8.5;

        // 壁の上の座標（m）。u は横、v は建物の足元からの高さ
        float u;
        if (curve > 0.0) u = atan(vWorld.z - vCenter.z, vWorld.x - vCenter.x) * curve;
        else u = dot(vWorld.xz, normalize(vec2(-n.z, n.x) + 1e-5));
        float v = vWorld.y - vCenter.y;

        float glass = 0.0, win = 0.0, bright = 0.0, floorH = 4.0, zoneW = 8.0;
        if (facade) {
          if (style < 0.5) {
            // ガラスのカーテンウォール：1.5m ごとの方立と、床ごとのスパンドレル
            floorH = 4.0; zoneW = 6.0 + 6.0 * fract(seed * 3.7);
            float mull = stripe(u, 1.5, 0.0, 0.07);
            float span = stripe(v, floorH, 0.0, 0.22);
            glass = 1.0 - mull;
            win = (1.0 - mull) * (1.0 - span);
            bright = mull * 0.6;
          } else if (style < 1.5) {
            // タワーマンション：白いバルコニーの床、すりガラスの手すり、住戸ごとの仕切り
            floorH = 3.1; zoneW = 6.0;
            float slab = stripe(v, floorH, 0.0, 0.09);
            float rail = stripe(v, floorH, 0.09, 0.4);
            float part = stripe(u, 6.0, 0.0, 0.07);
            float mull = stripe(u, 1.8, 0.0, 0.04);
            glass = (1.0 - slab) * (1.0 - part) * (1.0 - mull * 0.8);
            win = glass * (1.0 - rail);
            bright = slab + rail * 0.45 + part * 0.3;
          } else if (style < 2.5) {
            // 格子窓のオフィス（石張り）
            floorH = 3.8; zoneW = 4.4 + 4.4 * floor(fract(seed * 5.1) * 2.0);
            glass = stripe(u, 2.2, 0.16, 0.84) * stripe(v, floorH, 0.28, 0.86);
            win = glass;
          } else if (style < 3.5) {
            // 縦のルーバー
            floorH = 4.0; zoneW = 7.2;
            float fin = stripe(u, 1.2, 0.0, 0.28);
            float slab = stripe(v, floorH, 0.0, 0.12);
            glass = (1.0 - fin) * (1.0 - slab);
            win = glass;
            bright = fin * 0.5 + slab * 0.2;
          } else {
            // 低層の商業棟：階ごとの横長の窓
            floorH = 5.0; zoneW = 9.0;
            glass = stripe(v, floorH, 0.12, 0.88) * (1.0 - stripe(u, 3.0, 0.0, 0.03));
            win = glass;
          }
        }

        // 外壁：床ごと・区画ごとに少しずつ汚れ方を変える
        float fl = floor(v / floorH);
        float zn = floor(u / zoneW);
        vec3 wallCol = vWall * mix(1.0, 1.3, bright) * (0.93 + 0.07 * h21(vec2(fl, zn + seed * 31.0)));
        if (!facade) {
          // 屋上と地面：砂利まじりのむら
          wallCol = vWall * (style > 8.5 ? 1.0 : 0.62) * (0.85 + 0.15 * h21(floor(vWorld.xz * 0.6)));
        }

        vec3 amb = ambientAt(n);
        float ndl = max(dot(n, uSunDir), 0.0);
        float ao = 0.5 + 0.5 * smoothstep(0.0, 70.0, vWorld.y - (${GROUND.toFixed(1)}));
        vec3 col = wallCol * (amb * ao + uSunCol * ndl);

        if (glass > 0.001) {
          // ガラス：1 枚ずつわずかに傾いていて、映る空がばらつく
          float detail = 1.0 - smoothstep(0.15, 0.6, fwidth(u / 1.5));
          vec2 pid = vec2(floor(u / 1.5), fl);
          vec3 tilt = (vec3(h21(pid), h21(pid + 3.1), h21(pid + 7.7)) - 0.5) * 0.05 * detail;
          vec3 nn = normalize(n + tilt);
          vec3 R = reflect(-V, nn);
          float cosv = clamp(dot(nn, V), 0.0, 1.0);
          float F = refl + (1.0 - refl) * pow(1.0 - cosv, 5.0);
          vec3 sky = skyAt(R);
          // 水平に近い映り込みには、向かいのビル群が映る
          sky = mix(sky, uHorizon * 0.3 + uGlow * 0.3, smoothstep(0.25, -0.02, R.y) * 0.7);
          vec3 inside = vGlass * (amb * 0.22);
          vec3 g = mix(inside, sky, F) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 400.0) * 25.0 * F;

          // 窓明かり：フロアの区画ごとに灯る。遠くて 1 フロアが数画素より小さければ平均で塗る
          float h = h21(vec2(zn, fl) + seed * 97.0);
          float hf = h21(vec2(fl, seed * 13.0));
          float lit = step(h, ratio);
          if (hf < 0.1) lit = 1.0; else if (hf > 0.88) lit = 0.0;
          lit *= step(0.015, fract(h * 71.0 + uTime * 0.003 * fract(seed * 7.0)));
          float ld = 1.0 - smoothstep(0.3, 0.9, fwidth(v / floorH));
          float hc = fract(h * 13.7 + seed * 3.1);
          vec3 lamp;
          if (style > 0.5 && style < 1.5) lamp = hc < 0.6 ? vec3(1.0, 0.62, 0.32) : vec3(1.0, 0.8, 0.6);
          else lamp = hc < 0.5 ? vec3(0.72, 0.85, 1.0) : hc < 0.94 ? vec3(1.0, 0.8, 0.55) : vec3(0.3, 0.85, 1.0);
          float inten = mix(1.0, 0.55 + 0.9 * fract(h * 29.0), ld);
          float ceil_ = mix(0.8, 0.55 + 0.6 * fract(v / floorH), ld);
          lit = mix(ratio * 0.95, lit, ld);
          lamp = mix(vec3(0.9, 0.85, 0.8), lamp, ld);
          // 昼もオフィスの照明は点いているが、外の明るさに負けてほとんど見えない
          float power = mix(0.05, 1.15, uNight);
          vec3 emit = lamp * lit * inten * ceil_ * power * (1.0 - F * 0.6);
          // 窓の部分だけが室内（スパンドレルは不透明なガラス）
          g = mix(mix(inside * 0.6, sky, F), g + emit, win / max(glass, 1e-3));
          col = mix(col, g, glass);
        }

        // 夜：通りの灯りが低い外壁を下から照らす
        col += wallCol * uGlow * 0.7 * exp(-(vWorld.y - (${GROUND.toFixed(1)})) / 45.0);

        gl_FragColor = vec4(cityFog(col, vWorld), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------
// 空飛ぶ車：4 つの推進ポッドで浮かぶ流線形の車。空の車道を行き交う
// ---------------------------------------------------------------------------

function carGeometry() {
  const parts = [];
  const piece = (g, part) => {
    g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
    parts.push(g);
  };
  // 車体：前を低く絞ったくさび形
  const body = new THREE.BoxGeometry(4.8, 0.7, 2.0, 2, 1, 1).toNonIndexed();
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    if (x > 2) p.setY(i, y > 0 ? 0.05 : -0.3);
    if (x < -2 && y > 0) p.setY(i, 0.3);
    if (Math.abs(x) > 2) p.setZ(i, p.getZ(i) * 0.82);
  }
  body.computeVertexNormals();
  piece(body.translate(0, 0.35, 0), 0);
  // 屋根（ガラス張りのキャビン）
  const cabin = new THREE.BoxGeometry(2.5, 0.6, 1.6).toNonIndexed();
  const c = cabin.attributes.position;
  for (let i = 0; i < c.count; i++) {
    if (c.getY(i) > 0) {
      c.setX(i, c.getX(i) * 0.62 - 0.25);
      c.setZ(i, c.getZ(i) * 0.85);
    }
  }
  cabin.computeVertexNormals();
  piece(cabin.translate(-0.3, 0.95, 0), 1);
  // 推進ポッド
  for (const x of [1.55, -1.55]) {
    for (const z of [1.2, -1.2]) piece(new THREE.CylinderGeometry(0.2, 0.24, 1.1, 10).rotateZ(Math.PI / 2).translate(x, 0.18, z * 0.9), 2);
  }
  return mergeGeometries(parts);
}

// 車道を走る位置と向き（車体と灯りで同じ計算を使う）
const CAR_GLSL = /* glsl */ `
uniform vec3 uA[${LANES.length}];
uniform vec3 uB[${LANES.length}];
// aCar: 車道の番号・走り出しの位置・速さ（m/s、負なら逆向き）・車道の中心からの横のずれ
mat4 carMatrix(vec4 aCar, float t) {
  int li = int(aCar.x + 0.5);
  vec3 a = uA[0], b = uB[0];
  for (int i = 0; i < ${LANES.length}; i++) if (i == li) { a = uA[i]; b = uB[i]; }
  vec3 d = b - a;
  float len = length(d);
  float s = fract(aCar.y + t * aCar.z / len);
  vec3 dir = d / len;
  vec3 fwd = aCar.z > 0.0 ? dir : -dir;
  vec3 side = normalize(vec3(-dir.z, 0.0, dir.x));
  vec3 p = a + d * s + side * aCar.w + vec3(0.0, sin(t * 0.7 + aCar.y * 40.0) * 0.35, 0.0);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) + side * sin(t * 0.5 + aCar.y * 23.0) * 0.04);
  vec3 z = normalize(cross(fwd, up));
  up = cross(z, fwd);
  return mat4(vec4(fwd, 0.0), vec4(up, 0.0), vec4(z, 0.0), vec4(p, 1.0));
}
`;

function flyingCars(uniforms) {
  const list = [];
  const rand = mulberry(5);
  LANES.forEach((lane, li) => {
    for (const dir of [1, -1]) {
      for (let i = 0; i < lane.count; i++) {
        list.push([li, (i + rand() * 0.7) / lane.count, dir * lane.speed * (0.8 + rand() * 0.4), dir * (2.2 + rand() * 1.5)]);
      }
    }
  });
  const carAttr = new Float32Array(list.flat());
  const PAINT = [[0.04, 0.04, 0.05], [0.6, 0.6, 0.62], [0.55, 0.04, 0.03], [0.82, 0.82, 0.8], [0.1, 0.13, 0.18], [0.35, 0.3, 0.25]];
  const paint = new Float32Array(list.length * 3);
  for (let i = 0; i < list.length; i++) paint.set(PAINT[Math.floor(rand() * PAINT.length)], i * 3);
  const laneUniforms = {
    uA: { value: LANES.map((l) => new THREE.Vector3(l.a[0], l.a[1], l.a[2])) },
    uB: { value: LANES.map((l) => new THREE.Vector3(l.b[0], l.b[1], l.b[2])) },
  };

  // 車体
  const geo = new THREE.InstancedBufferGeometry().copy(carGeometry());
  geo.instanceCount = list.length;
  geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(carAttr, 4));
  geo.setAttribute('aPaint', new THREE.InstancedBufferAttribute(paint, 3));
  const body = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...laneUniforms },
      vertexShader: /* glsl */ `
        uniform float uTime;
        ${CAR_GLSL}
        attribute vec4 aCar;
        attribute vec3 aPaint;
        attribute float aPart;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vPaint;
        varying float vPart;
        varying vec3 vLocal;
        void main() {
          mat4 m = carMatrix(aCar, uTime);
          vec4 wp = modelMatrix * m * vec4(position, 1.0);
          vWorld = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * mat3(m) * normal);
          vPaint = aPaint;
          vPart = aPart;
          vLocal = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${LIGHT_GLSL}
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vPaint;
        varying float vPart;
        varying vec3 vLocal;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, n);
          float cosv = clamp(dot(n, V), 0.0, 1.0);
          vec3 amb = ambientAt(n);
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 base = vPart < 0.5 ? vPaint : vPart < 1.5 ? vec3(0.02, 0.025, 0.03) : vec3(0.12, 0.12, 0.13);
          float refl = vPart < 0.5 ? 0.06 : vPart < 1.5 ? 0.25 : 0.04;
          float F = refl + (1.0 - refl) * pow(1.0 - cosv, 5.0);
          vec3 col = base * (amb + uSunCol * ndl);
          col = mix(col, skyAt(R), F) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 200.0) * 20.0 * F;
          // 推進ポッドの下は青白く光る。車体の前と後ろの縁に細い灯り
          float glow = mix(0.6, 3.0, uNight);
          if (vPart > 1.5 && n.y < -0.3) col += vec3(0.3, 0.75, 1.0) * glow;
          if (vPart < 0.5 && vLocal.x > 2.2) col += vec3(1.0, 0.95, 0.85) * glow;
          if (vPart < 0.5 && vLocal.x < -2.3 && vLocal.y > 0.2) col += vec3(1.0, 0.08, 0.05) * glow;
          gl_FragColor = vec4(cityFog(col, vWorld), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  body.frustumCulled = false;

  // 灯りのにじみ（前の 2 灯・後ろの 2 灯・下の青い光）
  const OFFS = [
    [2.45, 0.3, 0.6, 0],
    [2.45, 0.3, -0.6, 0],
    [-2.45, 0.45, 0.65, 1],
    [-2.45, 0.45, -0.65, 1],
    [0, -0.15, 0, 2],
  ];
  const lgeo = new THREE.InstancedBufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(OFFS.map((o) => o.slice(0, 3)).flat(), 3));
  lgeo.setAttribute('aKind', new THREE.Float32BufferAttribute(OFFS.map((o) => o[3]), 1));
  lgeo.setAttribute('aCar', new THREE.InstancedBufferAttribute(carAttr, 4));
  lgeo.instanceCount = list.length;
  const lights = new THREE.Points(
    lgeo,
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...laneUniforms },
      vertexShader: /* glsl */ `
        uniform float uTime, uNight;
        ${CAR_GLSL}
        attribute vec4 aCar;
        attribute float aKind;
        varying vec3 vColor;
        void main() {
          mat4 m = carMatrix(aCar, uTime);
          vec4 wp = modelMatrix * m * vec4(position, 1.0);
          vec3 fwd = normalize(mat3(m)[0]);
          vec3 toCam = normalize(cameraPosition - wp.xyz);
          float facing = aKind < 0.5 ? dot(fwd, toCam) : aKind < 1.5 ? -dot(fwd, toCam) : 0.6;
          vec3 c = aKind < 0.5 ? vec3(1.0, 0.95, 0.85) : aKind < 1.5 ? vec3(1.0, 0.1, 0.06) : vec3(0.3, 0.7, 1.0);
          float k = (0.25 + 0.75 * smoothstep(-0.2, 0.6, facing)) * mix(0.35, 1.0, uNight);
          vColor = c * k;
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((aKind > 1.5 ? 2600.0 : 1200.0) / -mv.z, 2.0, aKind > 1.5 ? 70.0 : 40.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-d * d * 5.0) + 0.6 * exp(-d * d * 40.0);
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  lights.frustumCulled = false;
  return { body, lights };
}

// ---------------------------------------------------------------------------
// 灯り
// ---------------------------------------------------------------------------

// 高い建物の屋上の赤い航空障害灯（ゆっくり点滅）と、塔の頂の白い閃光灯
function beacons(tops, strobes, uniforms) {
  const all = [...tops.map((p) => [p, 0]), ...strobes.map((p) => [p, 1])];
  const pos = new Float32Array(all.length * 3);
  const info = new Float32Array(all.length * 2);
  all.forEach(([p, kind], i) => {
    pos.set([p.x, p.y + 1.5, p.z], i * 3);
    info.set([Math.random(), kind], i * 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec2 aInfo;
        uniform float uTime;
        varying float vOn;
        varying float vKind;
        void main() {
          vKind = aInfo.y;
          float t = fract(uTime * (aInfo.y > 0.5 ? 0.8 : 0.5) + aInfo.x);
          vOn = aInfo.y > 0.5 ? step(t, 0.06) : smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.25, 0.5, t));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((aInfo.y > 0.5 ? 6000.0 : 2500.0) / -mv.z, 2.0, 12.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vOn;
        varying float vKind;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          vec3 c = vKind > 0.5 ? vec3(1.0, 1.0, 1.0) : vec3(1.0, 0.12, 0.06);
          gl_FragColor = vec4(c * (0.6 + uNight * 2.0), smoothstep(0.5, 0.0, d) * vOn * (0.35 + 0.65 * uNight));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

// 通りの街灯（遠くの地面に、夜だけ橙と白の点が格子状に並ぶ）
function streetLights(rand, uniforms) {
  const pos = [];
  const col = [];
  for (let x = 6; x < 1500; x += 84) {
    for (let z = -2300; z < 120; z += 84) {
      const R = Math.hypot(x - EYE.x, z - EYE.z);
      const k = (EYE.z - z) / (x - EYE.x);
      if (k < K_MIN || k > K_MAX || R < 120) continue;
      const warm = rand() < 0.6;
      for (let s = 0; s < 84; s += 21) {
        pos.push(x + s, GROUND + 8, z, x, GROUND + 8, z + s);
        for (let i = 0; i < 2; i++) col.push(...(warm ? [1.0, 0.55, 0.22] : [0.85, 0.9, 1.0]));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(1400.0 / -mv.z, 1.0, 3.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor * 1.4, smoothstep(0.5, 0.1, d) * uNight);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

// 夜空をゆっくり掃くサーチライト（下から上へ薄れる光の筋）
function searchlights(uniforms) {
  const group = new THREE.Group();
  const beams = [];
  const geo = new THREE.CylinderGeometry(14, 0.8, 1, 24, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vH = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vN), vView)), 1.5);
        float a = (1.0 - vH) * (1.0 - vH) * edge * 0.12 * uNight;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  for (const [R, k, phase] of [
    [700, 1.3, 0],
    [950, 1.9, 2.1],
    [1300, 1.1, 4.0],
    [1100, 2.5, 1.2],
  ]) {
    const [x, z] = at(R, k);
    const beam = new THREE.Mesh(geo, mat);
    beam.position.set(x, GROUND + 60, z);
    beam.scale.set(1, 900, 1);
    beam.userData.phase = phase;
    beam.frustumCulled = false;
    group.add(beam);
    beams.push(beam);
  }
  return {
    group,
    update(t) {
      for (const b of beams) {
        const p = b.userData.phase;
        b.rotation.set(0.35 * Math.sin(t * 0.11 + p), 0, 0.4 * Math.sin(t * 0.07 + p * 1.7), 'YXZ');
      }
    },
  };
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
