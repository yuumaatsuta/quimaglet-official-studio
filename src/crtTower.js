import * as THREE from 'three';
import { addCrtScreen, crtScreenMaterial } from './crtScreen.js';

// 部屋の角に積み上げたブラウン管のタワー。
// ブラウン管を段ごとに弧状に並べ（上の段ほど小さく、角へ寄る）、1 台ずつ壁から伸びるアームで支える。
// 3 種類のブラウン管をランダムに選び、向き・大きさ・映るもの（映像 / 砂嵐 / 消えている）を少しずつ変える。

// 画面の範囲はモデルの元の座標（正面は +z）
const MODELS = [
  { url: 'models/crt01.glb', screen: { x0: -0.33, x1: 0.33, y0: 0.19, y1: 0.64 } },
  { url: 'models/crt02.glb', screen: { x0: -0.34, x1: 0.33, y0: 0.24, y1: 0.78 } },
  { url: 'models/crt03.glb', screen: { x0: -0.3, x1: 0.3, y0: 0.31, y1: 0.82 } },
];

// 段ごとの並べ方。r: 角からの距離、angles: 奥の壁から横の壁へ向かう角度（度）
const TIERS = [
  { r: 1.6, angles: [10, 45, 80] },
  { r: 1.3, angles: [14, 46, 78] },
  { r: 1.0, angles: [24, 66] },
  { r: 0.75, angles: [22, 68] },
  { r: 0.5, angles: [45] },
];
const TV_WIDTH = 0.56; // すべて同じ幅（m）。0.4m ≒ 14 インチ、0.56m ≒ 20 インチ
const GAP = 0.06; // 隣のブラウン管とのすき間
const BASE_Y = 0.3; // 一番下の段の高さ（床から浮かせてアームで支える）
const TIER_GAP = 0.13; // 段と段のすき間（アームが通る）
const WALL_GAP = 0.15; // 壁とのすき間（アームの長さの最低限）

export async function loadCrtTemplates(loader) {
  const base = import.meta.env.BASE_URL;
  return Promise.all(
    MODELS.map(async (item) => {
      const model = (await loader.loadAsync(base + item.url)).scene;
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });
      const box = new THREE.Box3().setFromObject(model);
      // 画面は 1 回だけ作り、複製で使い回す（形を光線で拾うのが重いため）
      addCrtScreen(model, item.screen);
      return { model, width: box.max.x - box.min.x, minY: box.min.y, box };
    }),
  );
}

//   corner: 角の床の点、along: 奥の壁に沿って部屋へ入る向き、side: 横の壁に沿って部屋へ入る向き
//   target: ブラウン管の画面を向ける先（床の点）
export function buildCrtTower({ templates, corner, along, side, target, rand, armMaterial }) {
  const group = new THREE.Group();
  let floor = BASE_Y; // この段のブラウン管の底の高さ

  for (const tier of TIERS) {
    let top = floor;
    const placed = []; // この段に置いたブラウン管の床の上の輪郭
    for (const deg of tier.angles) {
      const tpl = templates[Math.floor(rand() * templates.length)];
      const tv = instance(tpl, TV_WIDTH, rand);
      const jitter = (rand() - 0.5) * 0.3;

      // 隣と近すぎたら、少しずつ横の壁側へずらす。ずらしきれなければ角から少し離す
      let a = deg + (rand() - 0.5) * 4;
      let r = tier.r;
      let outline;
      for (let tries = 0; tries < 80; tries++) {
        place(tv, tpl, TV_WIDTH, a, r, floor, jitter, { corner, along, side, target });
        outline = footprint(tv, tpl);
        if (!placed.some((other) => overlaps(outline, other))) break;
        a += 2;
        if (a > 88) {
          a = deg;
          r += 0.06;
        }
      }
      placed.push(outline);
      group.add(tv, arm(tv, tpl, floor, { corner, along, side }, rand() < 0.5 ? -1 : 1, armMaterial));
      top = Math.max(top, new THREE.Box3().setFromObject(tv).max.y);
    }
    floor = top + TIER_GAP;
  }
  return group;
}

// 角から角度 deg・距離 r の位置に置き、画面を target へ向ける（少しだけ不揃いに）
function place(tv, tpl, width, deg, r, floor, jitter, { corner, along, side, target }) {
  const a = THREE.MathUtils.degToRad(deg);
  const pos = corner.clone().addScaledVector(along, Math.cos(a) * r).addScaledVector(side, Math.sin(a) * r);
  tv.scale.setScalar(width / tpl.width);
  tv.rotation.y = Math.atan2(target.x - pos.x, target.z - pos.z) + jitter;
  tv.position.set(pos.x, floor - tpl.minY * tv.scale.x, pos.z);
  keepOffWalls(tv, corner, along, side);
}

// 床に落とした輪郭（回転した長方形の 4 隅、すき間込み）
function footprint(tv, tpl) {
  const { min, max } = tpl.box;
  const s = tv.scale.x;
  const g = GAP / 2 / s;
  const cos = Math.cos(tv.rotation.y);
  const sin = Math.sin(tv.rotation.y);
  return [
    [min.x - g, min.z - g],
    [max.x + g, min.z - g],
    [max.x + g, max.z + g],
    [min.x - g, max.z + g],
  ].map(([x, z]) => [tv.position.x + (x * cos + z * sin) * s, tv.position.z + (-x * sin + z * cos) * s]);
}

// 2 つの長方形が重なるか（分離軸）
function overlaps(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1;
      const nz = x1 - x2;
      const project = (p) => p.map(([x, z]) => x * nx + z * nz);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function instance(tpl, width, rand) {
  const tv = tpl.model.clone(true);
  tv.scale.setScalar(width / tpl.width);
  // すべての画面に同じ映像を流す（画面ごとに明るさ・ちらつきだけ少し変える）。
  // 一部を砂嵐や消えた画面にしたいときは mode を 'noise' / 'off' にする
  const seed = rand();
  tv.traverse((obj) => {
    if (obj.userData.isScreen) obj.material = crtScreenMaterial({ mode: 'video', seed, aspect: obj.userData.aspect });
  });
  return tv;
}

// 壁にめり込まないよう、部屋の内側へ押し出す
function keepOffWalls(tv, corner, along, side) {
  tv.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(tv);
  for (const dir of [along, side]) {
    // dir の向きに測った、ブラウン管の一番壁側の位置
    const axis = Math.abs(dir.x) > 0.5 ? 'x' : 'z';
    const sign = Math.sign(dir[axis]);
    const nearest = sign > 0 ? box.min[axis] : box.max[axis];
    const depth = (nearest - corner[axis]) * sign;
    if (depth < WALL_GAP) tv.position[axis] += (WALL_GAP - depth) * sign;
  }
}

// 壁から伸びるモニターアーム：壁の取付板 → 2 本の腕（肘で折れる）→ 支柱 → ブラウン管の底の受け板
const ARM_R = 0.018;
function arm(tv, tpl, floor, { corner, along, side }, bend, material) {
  const group = new THREE.Group();
  const add = (geometry, position, quaternion) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (quaternion) mesh.quaternion.copy(quaternion);
    mesh.castShadow = true;
    mesh.userData.noPick = true;
    group.add(mesh);
  };

  // ブラウン管の底の中心
  const c = tpl.box.getCenter(new THREE.Vector3()).multiplyScalar(tv.scale.x);
  c.y = 0;
  c.applyAxisAngle(new THREE.Vector3(0, 1, 0), tv.rotation.y);
  const mount = new THREE.Vector3(tv.position.x + c.x, floor, tv.position.z + c.z);
  const armY = floor - 0.09;

  // 底の受け板と、そこから下へ降りる短い支柱
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tv.rotation.y);
  add(new THREE.BoxGeometry(0.2, 0.014, 0.2), mount.clone().setY(floor - 0.007), yaw);
  add(new THREE.CylinderGeometry(ARM_R * 1.4, ARM_R * 1.4, floor - armY, 12), mount.clone().setY((floor + armY) / 2));

  // 近いほうの壁へ
  const rel = mount.clone().sub(corner);
  const toBack = rel.dot(side); // 奥の壁までの距離
  const toSide = rel.dot(along); // 横の壁までの距離
  const normal = toBack < toSide ? side : along; // 壁から部屋へ向かう向き
  const wall = mount.clone().addScaledVector(normal, -Math.min(toBack, toSide)).setY(armY);
  const start = mount.clone().setY(armY);

  // 肘：途中で横へ折れる
  const across = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0));
  const reach = start.distanceTo(wall);
  const elbow = start.clone().lerp(wall, 0.5).addScaledVector(across, bend * Math.min(0.2, reach * 0.35));
  bar(add, start, elbow);
  bar(add, elbow, wall.clone().addScaledVector(normal, 0.02));
  for (const p of [start, elbow]) add(new THREE.CylinderGeometry(ARM_R * 1.7, ARM_R * 1.7, 0.05, 14), p);

  // 壁の取付板
  const plateQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  add(new THREE.BoxGeometry(0.09, 0.2, 0.014), wall.clone().addScaledVector(normal, 0.007), plateQ);
  return group;
}

// 2 点を結ぶ丸棒
function bar(add, a, b) {
  const length = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  add(new THREE.CylinderGeometry(ARM_R, ARM_R, length, 10), a.clone().lerp(b, 0.5), q);
}
