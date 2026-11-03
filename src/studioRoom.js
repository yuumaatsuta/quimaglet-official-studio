import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CONFIG } from './config.js';
import { addCrtScreen, startCrtVideo, updateCrtScreens } from './crtScreen.js';
import { buildCrtTower, loadCrtTemplates } from './crtTower.js';
import { floorMirror, footprintShadow } from './floorMirror.js';
import { tagHotspot } from './hotspots.js';
import { buildWallMenu } from './wallMenu.js';
import { buildFloorLogo } from './floorLogo.js';
import { buildNewsProjector } from './newsProjector.js';
import { buildPlanetarium } from './planetarium.js';

// 写真から起こしたコンクリート打ち放しのスタジオ（家具なし）。
// 寸法は型枠（1800×900）の枚数から割り出したもの。単位は m。
//
//   x: 左の壁 -W/2 → 右の窓 +W/2
//   y: 床 0 → 天井 H
//   z: 奥の壁 -D → 手前（画面＝窓）0
const W = 6.0;
const H = 6.0;
const D = 10.0;
const T = 0.25; // 壁・床・天井の厚み
// 左の壁のコンクリート棚の天端。人の腰〜胸の高さにして、空間の大きさが伝わるように
const LEDGE_Y = 1.5;

// 右の窓まわり
const PIER = 0.85; // 奥の角に残るコンクリートの柱の幅
const WIN_Z0 = -D + PIER; // 窓の奥端
const WIN_Z1 = -0.3; // 窓の手前端
const BAYS = Math.round((WIN_Z1 - WIN_Z0) / 0.98); // ドア 1 枚 ≒ 1m
const DOOR_H = 3.3;
const HEAD_Y = 5.55;

// テクスチャ 1 枚が表す実寸
const CONCRETE_TILE = { u: 7.2, v: 3.6 };
const WOOD_TILE = { u: 1.0, v: 2.0 };

export async function buildStudioRoom(onProgress) {
  RectAreaLightUniformsLib.init();

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => onProgress?.(loaded / total);
  const [textures, furniture, crtTemplates, floorLogo] = await Promise.all([
    loadTextures(manager),
    loadFurniture(manager),
    loadCrtTemplates(new GLTFLoader(manager)),
    buildFloorLogo(manager),
  ]);
  startCrtVideo(CONFIG.crtVideo);
  const group = new THREE.Group();

  const concrete = new THREE.MeshStandardMaterial({
    map: textures.concreteAlbedo,
    normalMap: textures.concreteNormal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: textures.concreteRough,
    roughness: 1,
  });
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: textures.woodAlbedo,
    normalMap: textures.woodNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: textures.woodRough,
    roughness: 1,
    clearcoat: 0.3,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.7, // 窓際で空が映り込みすぎて白く飛ばないように
  });
  const steel = new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.45, metalness: 0.6 });
  const pipeMat = new THREE.MeshStandardMaterial({ color: '#8a8d90', roughness: 0.35, metalness: 0.85 });
  const woodTrim = new THREE.MeshStandardMaterial({ color: '#9c7148', roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#e9ebea', roughness: 0.4 });

  // 箱を置き、テクスチャを実寸（ワールド座標）で貼る
  function box(w, h, d, mat, x, y, z, uv = concreteUV) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (uv) applyWorldUV(geo, new THREE.Vector3(x, y, z), uv);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function pipe(from, to, radius, mat = pipeMat) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // ---------- 躯体 ----------

  box(W + 2 * T, T, D, floorMat, 0, -T / 2, -D / 2, woodUV);
  // 天井は床の照り返しを拾いすぎて茶色くならないよう、環境光を弱める
  const ceilingMat = concrete.clone();
  ceilingMat.envMapIntensity = 0.2;
  box(W + 2 * T, T, D + T, ceilingMat, 0, H + T / 2, -(D + T) / 2);
  box(W + 2 * T, H, T, concrete, 0, H / 2, -D - T / 2);
  box(T, H, D, concrete, -W / 2 - T / 2, H / 2, -D / 2);

  // 右の壁：奥の柱・窓の上の梁・手前の袖壁
  const rx = W / 2 + T / 2;
  box(T, H, PIER, concrete, rx, H / 2, -D + PIER / 2);
  box(T, H - HEAD_Y, WIN_Z1 - WIN_Z0, concrete, rx, (H + HEAD_Y) / 2, (WIN_Z0 + WIN_Z1) / 2);
  box(T, H, -WIN_Z1, concrete, rx, H / 2, WIN_Z1 / 2);

  // 手前の壁：画面には映さず、日差しを遮る影だけを落とす
  const front = box(W + 2 * T, H, T, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), 0, H / 2, T / 2, null);
  front.receiveShadow = false;
  front.userData.noPick = true;

  // 左の壁のコンクリート棚（壁と一体の片持ちスラブ）
  box(0.32, 0.12, D, concrete, -W / 2 + 0.16, LEDGE_Y - 0.06, -D / 2);

  // コンクリートの棚の上に載る、升目の木の棚
  buildCubbyShelf({ box, textures });

  // 家具（public/models/ の GLB）
  // クリックできる家具。focus のものは、押すとそこへズームする（main.js）
  const hotspots = new Map();
  const focus = new Map();
  for (const item of furniture) {
    group.add(item);
    const f = item.userData.focus;
    if (!f) continue;
    item.userData.hotspotLabel = f.label;
    tagHotspot(hotspots, f.id, item);
    focus.set(f.id, item);
  }

  // 奥の壁の右上に、ペンキで落書きしたメニュー。押すとロボットがそのページを映す
  const wallMenu = await buildWallMenu({ wallZ: -D });
  group.add(wallMenu.group);
  for (const [id, mesh] of wallMenu.items) tagHotspot(hotspots, id, mesh);

  // 2 台目のロボット：少しすると左から飛んできて、メニューの下に最新のお知らせを映す
  const newsProjector = await buildNewsProjector({ manager, wallZ: -D, menu: wallMenu.group });
  group.add(newsProjector.group);

  // 夜になると画面の手前に下りてくる月（触れると部屋に星空を映す）
  const planetarium = buildPlanetarium({
    ceilingY: H,
    halfWidth: W / 2,
    backZ: -D,
    keepClear: [wallMenu.group, newsProjector.group],
    root: group,
  });
  group.add(planetarium.group);

  // 左手前の床に置いた、立体の QUIMAGLET
  group.add(floorLogo);

  // 奥の左右の角に積み上げたブラウン管のタワー。画面は部屋の手前の中央へ向ける
  const towerTarget = new THREE.Vector3(0, 0, -3.5);
  const towerRand = mulberry32(7);
  // 右奥の角
  group.add(buildCrtTower({
    templates: crtTemplates, corner: new THREE.Vector3(W / 2, 0, -D),
    along: new THREE.Vector3(-1, 0, 0), side: new THREE.Vector3(0, 0, 1),
    target: towerTarget, rand: towerRand, armMaterial: steel,
  }));
  // 左奥の角（左の壁のコンクリート棚の出の分だけ内側から）
  group.add(buildCrtTower({
    templates: crtTemplates, corner: new THREE.Vector3(-W / 2 + 0.32, 0, -D),
    along: new THREE.Vector3(1, 0, 0), side: new THREE.Vector3(0, 0, 1),
    target: towerTarget, rand: towerRand, armMaterial: steel,
  }));

  // 左上の斜めのコンクリート面（奥の角で天井に取り付き、手前は 45° のハンチになる）
  group.add(slopedSlab(concrete));

  // ---------- 窓（黒いスチールサッシ） ----------

  buildWindowWall({ group, box, steel, woodTrim, white });

  // ---------- 設備：配管と蛍光灯 ----------

  // 壁を回る配管（左の壁では木の棚の上を通る）
  const py = 3.6;
  pipe([-W / 2 + 0.05, py, -D + 0.05], [W / 2 - 0.05, py, -D + 0.05], 0.014);
  pipe([-W / 2 + 0.05, py, -D + 0.05], [-W / 2 + 0.05, py, 0], 0.014);
  // 天井を奥行き方向に走る配管
  for (const [x, r] of [
    [-0.6, 0.02],
    [0.9, 0.016],
    [1.05, 0.016],
    [2.1, 0.022],
    [2.25, 0.016],
  ]) {
    pipe([x, H - 0.06, -D], [x, H - 0.06, 0], r);
  }

  // 奥の壁際に吊られた蛍光灯
  const tubeZ = -D + 0.75;
  const tubeY = 5.7; // 天井近くまで上げる（縦長の画面で、下の落書きメニューに重ならないように）
  // 奥の壁の中央。夜はこの真下の壁がいちばん明るいので、落書きのメニューもここに描く（wallMenu.js）
  const tubeX0 = -1.8;
  const tubeX1 = 1.8;
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#f4f2ee', emissive: '#fff8ee', emissiveIntensity: 1.2, roughness: 0.3 });
  const tube = pipe([tubeX0, tubeY, tubeZ], [tubeX1, tubeY, tubeZ], 0.055, tubeMat);
  tube.castShadow = false;
  // 点灯時（夜・雨の日）に下へ落ちる光
  const lamp = new THREE.RectAreaLight('#fff4e6', 0, tubeX1 - tubeX0, 0.12);
  lamp.position.set((tubeX0 + tubeX1) / 2, tubeY - 0.07, tubeZ);
  lamp.lookAt((tubeX0 + tubeX1) / 2, 0, tubeZ + 0.5);
  group.add(lamp);
  // 同じ蛍光灯から奥の壁（落書きのメニュー）へ向かう光。プラネタリウムで部屋を暗くしても、これだけは残す
  const menuLamp = new THREE.RectAreaLight('#fff4e6', 0, tubeX1 - tubeX0, 0.12);
  menuLamp.position.set((tubeX0 + tubeX1) / 2, tubeY - 0.05, tubeZ - 0.04);
  menuLamp.lookAt(-0.2, 4.1, -D);
  group.add(menuLamp);
  pipe([tubeX0 - 0.12, tubeY, tubeZ], [tubeX0, tubeY, tubeZ], 0.065);
  pipe([tubeX1, tubeY, tubeZ], [tubeX1 + 0.14, tubeY, tubeZ], 0.065);
  pipe([tubeX0 - 0.1, tubeY + 0.1, tubeZ], [tubeX1 + 0.1, tubeY + 0.1, tubeZ], 0.012);
  for (const x of [tubeX0 + 0.2, -0.5, 0.5, tubeX1 - 0.2]) pipe([x, tubeY + 0.1, tubeZ], [x, H, tubeZ], 0.006);

  // ---------- 外：バルコニー・手すり（空と景色は weatherScene.js） ----------

  buildBalcony({ box, white, textures });
  const shutter = buildShutter({ group, box, textures });

  // ---------- 光 ----------

  // 右手前の高い位置から差し込む午後の日差し
  const sun = new THREE.DirectionalLight('#ffe1b3', 5.5);
  sun.target.position.set(0, 0, -D / 2);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(1, 0.95, 0.62).normalize().multiplyScalar(30));
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 8, far: 55 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);

  // 窓面からの柔らかい天空光
  const sky = new THREE.RectAreaLight('#e4eeff', 3.2, WIN_Z1 - WIN_Z0, HEAD_Y);
  sky.position.set(W / 2 - 0.02, HEAD_Y / 2, (WIN_Z0 + WIN_Z1) / 2);
  sky.lookAt(0, HEAD_Y / 2, (WIN_Z0 + WIN_Z1) / 2);
  group.add(sky);

  const hemi = new THREE.HemisphereLight('#dfe6ee', '#4d4640', 0.25);
  group.add(hemi);

  // 床のブラウン管が見やすいよう、座ったくらいの目線
  const EYE = 1.15;
  return {
    group,
    // 窓（画面）は部屋の途中に置き、目は奥の壁から約 7.6m。
    // 手前の 1.5m ほどは目の後ろ側になり映らないが、そこの窓からも光は入る
    bounds: { centerX: 0, floorY: 0, width: W, height: H, windowZ: -D + 5.0 },
    // 人の目の高さ・写真に近い広角
    view: { eyeHeight: EYE, distanceFactor: 0.95 },
    // 部屋の中央から環境マップを撮る位置
    probe: new THREE.Vector3(0, 2, -D / 2),
    // 天気の演出に使うもの（weatherScene.js）
    weatherRig: {
      lights: { sun, sky, hemi, lamp, menuLamp },
      lampMaterial: tubeMat,
      landTexture: textures.land,
      horizonY: EYE,
      outside: { x0: W / 2 + 0.4, x1: W / 2 + 30, z0: -D - 16, z1: 10 },
    },
    shutter,
    hotspots,
    focus,
    // メニューで呼ぶとホログラムを映すロボット（robotWander）。いなければ null
    robot: furniture.find((f) => f.userData.robot)?.userData.robot ?? null,
    // お知らせを映す 2 台目のロボット（newsProjector.js）
    newsProjector,
    // 夜の月と星空の投影（planetarium.js）
    planetarium,
    hasLights: true,
    // view: { eye, win, liveEye }（main.js）。画面の端を知りたい物（ロボット）に渡す。
    // eye はズームや見回しに左右されない目、liveEye は実際の目（画面上の位置に合わせたいとき）
    update(t, view) {
      shutter.update(t);
      updateCrtScreens(t);
      for (const item of furniture) item.userData.update?.(t, view);
      floorLogo.userData.update(t, view);
      wallMenu.group.userData.update(t, view);
      newsProjector.group.userData.update(t, view);
      planetarium.group.userData.update(t, view);
    },
  };
}

function buildWindowWall({ box, steel, woodTrim, white, group }) {
  const x = W / 2 + 0.05; // サッシ面
  const bay = (WIN_Z1 - WIN_Z0) / BAYS;
  const F = 0.07; // 見付け
  const DEPTH = 0.12; // 見込み

  const frame = (h, d, y, z) => box(DEPTH, h, d, steel, x, y, z, null);

  // 外枠
  frame(HEAD_Y, F, HEAD_Y / 2, WIN_Z0 + F / 2);
  frame(HEAD_Y, F, HEAD_Y / 2, WIN_Z1 - F / 2);
  frame(F, WIN_Z1 - WIN_Z0, HEAD_Y - F / 2, (WIN_Z0 + WIN_Z1) / 2);
  frame(F, WIN_Z1 - WIN_Z0, F / 2, (WIN_Z0 + WIN_Z1) / 2);
  // ドア上の無目と欄間の中間桟
  box(DEPTH, 0.1, WIN_Z1 - WIN_Z0, steel, x, DOOR_H, (WIN_Z0 + WIN_Z1) / 2, null);
  frame(0.05, WIN_Z1 - WIN_Z0, 4.45, (WIN_Z0 + WIN_Z1) / 2);

  for (let i = 0; i < BAYS; i++) {
    const z0 = WIN_Z0 + i * bay;
    const zc = z0 + bay / 2;
    // 方立
    if (i > 0) frame(HEAD_Y, F, HEAD_Y / 2, z0);
    // ドアの横桟（ガラスを 3 段に分ける）
    for (const y of [1.15, 2.2]) frame(0.045, bay - F, y, zc);
    // ドアの内側に見える木の額縁
    for (const s of [-1, 1]) {
      box(0.03, DOOR_H - 0.12, 0.03, woodTrim, x - DEPTH / 2 - 0.015, DOOR_H / 2, zc + s * (bay / 2 - F / 2 - 0.02), null);
    }
  }

  // 中央の両開きドアの取っ手
  for (const s of [-1, 1]) {
    const z = WIN_Z0 + Math.floor(BAYS / 2) * bay + s * 0.12;
    box(0.03, 0.02, 0.02, white, x - DEPTH / 2 - 0.03, 1.05, z, null);
    box(0.02, 0.22, 0.02, white, x - DEPTH / 2 - 0.05, 1.05, z, null);
  }

  // ガラス（影を落とさない）
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WIN_Z1 - WIN_Z0, HEAD_Y),
    new THREE.MeshPhysicalMaterial({
      color: '#e8f0f2',
      transparent: true,
      opacity: 0.07,
      roughness: 0.03,
      metalness: 0,
      depthWrite: false,
    }),
  );
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(x + 0.01, HEAD_Y / 2, (WIN_Z0 + WIN_Z1) / 2);
  group.add(glass);

  // 柱のスイッチプレート
  box(0.01, 0.12, 0.07, white, W / 2 - 0.005, 1.25, -D + PIER - 0.2, null);
}

// 写真の左の壁上段にある、明るい木の升目棚（3 段・幅 0.6m ごとの仕切り）
function buildCubbyShelf({ box, textures }) {
  const woodProps = {
    map: textures.shelfAlbedo,
    normalMap: textures.shelfNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: textures.shelfRough,
    roughness: 1,
  };
  const wood = new THREE.MeshStandardMaterial({ ...woodProps });
  const inner = new THREE.MeshStandardMaterial({ ...woodProps, color: '#efe2d2' });
  const rand = mulberry32(13);

  // 板ごとに、長い方向へ木目が流れるよう UV を張る（テクスチャは 2.4m × 1.2m）。
  // 板ごとに柄の位置をずらし、同じ模様が並ばないようにする
  const board = (w, h, d, mat, x, y, z) => {
    const size = { x: w, y: h, z: d };
    const c = { x, y, z };
    const offU = rand() * 2.4;
    const offV = 0.5 + (rand() - 0.5) * 0.5;
    return box(w, h, d, mat, x, y, z, (p, n) => {
      const normalAxis = Math.abs(n.x) > 0.5 ? 'x' : Math.abs(n.y) > 0.5 ? 'y' : 'z';
      const [a, b] = ['x', 'y', 'z'].filter((k) => k !== normalAxis);
      const along = size[a] >= size[b] ? a : b;
      const across = along === a ? b : a;
      return [(p[along] - c[along]) / 2.4 + offU, (p[across] - c[across]) / 1.2 + offV];
    });
  };
  const t = 0.025; // 板厚
  const depth = 0.32;
  const height = 0.84;
  const rows = 3;
  const cell = 0.45;
  const y0 = LEDGE_Y; // コンクリートの棚の上面
  const x0 = -W / 2;
  const xc = x0 + depth / 2;
  const z0 = -D + 0.02;
  const z1 = -0.3;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;

  board(0.012, height, len, inner, x0 + 0.006, y0 + height / 2, zc); // 背板
  for (let r = 0; r <= rows; r++) {
    const y = y0 + t / 2 + (r * (height - t)) / rows;
    board(depth, t, len, wood, xc, y, zc);
  }
  const cols = Math.round(len / cell);
  for (let c = 0; c <= cols; c++) {
    const z = z0 + t / 2 + (c * (len - t)) / cols;
    board(depth, height, t, wood, xc, y0 + height / 2, z);
  }
}

// ---------------------------------------------------------------------------
// ガレージシャッター（窓の外側）。曲面に成形したスラットを積み重ねた幕・座板・
// ガイドレール・巻き取りボックス。setOpen(0〜1) で巻き上がる。
// 巻き上がった幕は窓の上の梁の高さで切り取る（＝ボックスに巻き込まれる）
// ---------------------------------------------------------------------------
function buildShutter({ group, box, textures }) {
  const x = W / 2 + T + 0.06; // 外壁面のすぐ外
  const z0 = WIN_Z0 - 0.06;
  const z1 = WIN_Z1 + 0.06;
  const len = z1 - z0;
  const PITCH = 0.075; // スラット 1 枚の高さ
  const SAMPLES = 10; // 1 枚あたりの断面の分割
  const BAR = 0.075; // 座板の高さ
  const curtainH = HEAD_Y + 0.1;
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), HEAD_Y + 0.02);

  // スラットの断面：外へふくらむ弧と、上下の噛み合わせの溝
  const profile = (y) => {
    const t = (y % PITCH) / PITCH;
    const bulge = 0.011 * Math.pow(Math.sin(Math.PI * t), 0.7);
    const groove = t < 0.1 ? -0.004 * Math.sin((Math.PI * t) / 0.1) : 0;
    return bulge + groove;
  };
  const rows = Math.ceil(curtainH / PITCH) * SAMPLES;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let j = 0; j <= rows; j++) {
    const y = (j / rows) * curtainH;
    const dx = profile(y);
    for (const z of [z0, z1]) {
      positions.push(dx, y, z);
      uvs.push(z / 2, y / 2);
    }
    if (j < rows) {
      const a = j * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const steel = new THREE.MeshStandardMaterial({
    map: textures.shutterAlbedo,
    roughnessMap: textures.shutterRough,
    roughness: 1,
    metalness: 0.7,
    side: THREE.DoubleSide,
    clippingPlanes: [clip],
    clipShadows: true,
  });
  const curtain = new THREE.Mesh(geo, steel);
  curtain.castShadow = true;
  curtain.receiveShadow = true;
  const moving = new THREE.Group();
  moving.position.x = x;
  moving.add(curtain);
  curtain.position.y = BAR;

  // 座板（アルミの押出材）と下端のゴム
  const alu = new THREE.MeshStandardMaterial({ color: '#b6babd', roughness: 0.35, metalness: 0.85 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
  for (const [w, h, y, mat] of [
    [0.05, BAR - 0.015, 0.015 + (BAR - 0.015) / 2, alu],
    [0.03, 0.015, 0.0075, rubber],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len - 0.01), mat);
    m.position.set(0.005, y, (z0 + z1) / 2);
    m.castShadow = true;
    moving.add(m);
  }
  group.add(moving);

  // ガイドレール（コの字の溝形鋼）
  const railMat = new THREE.MeshStandardMaterial({ color: '#7d8286', roughness: 0.5, metalness: 0.7 });
  for (const [z, s] of [[z0, -1], [z1, 1]]) {
    box(0.1, HEAD_Y + 0.25, 0.012, railMat, x, (HEAD_Y + 0.25) / 2, z + s * 0.045, null);
    box(0.012, HEAD_Y + 0.25, 0.05, railMat, x - 0.044, (HEAD_Y + 0.25) / 2, z + s * 0.02, null);
    box(0.012, HEAD_Y + 0.25, 0.05, railMat, x + 0.044, (HEAD_Y + 0.25) / 2, z + s * 0.02, null);
  }

  // 巻き取りボックス（窓の上の梁の外側）
  box(0.5, 0.55, len + 0.2, railMat, W / 2 + T + 0.25, HEAD_Y + 0.3, (z0 + z1) / 2, null);

  let open = 0;
  let wobble = 0;
  return {
    setOpen(value, moving_ = false) {
      open = THREE.MathUtils.clamp(value, 0, 1);
      wobble = moving_ ? 1 : 0;
      moving.position.y = open * (HEAD_Y - BAR + 0.01);
    },
    update(t) {
      // 巻き上げ中はわずかに震える
      moving.position.x = x + wobble * 0.0025 * Math.sin(t * 37) * Math.sin(t * 5.3);
    },
    get open() {
      return open;
    },
  };
}

function buildBalcony({ box, white, textures }) {
  const bx = W / 2 + T;
  const depth = 1.6;
  // バルコニーの床
  // 床は石畳（300×600 の馬目地）。石板の長手をバルコニーに沿わせる（テクスチャは 1.2m 角）
  const deck = new THREE.MeshStandardMaterial({
    map: textures.pavingAlbedo,
    normalMap: textures.pavingNormal,
    roughnessMap: textures.pavingRough,
    roughness: 1,
  });
  box(depth, 0.2, D + 4, deck, bx + depth / 2, -0.1, -D / 2, (p) => [p.z / 1.2, (p.x - bx) / 1.2]);
  // 白い手すり
  const rx = bx + depth - 0.05;
  box(0.05, 0.05, D + 4, white, rx, 1.1, -D / 2, null);
  for (const y of [0.3, 0.55, 0.8]) box(0.03, 0.03, D + 4, white, rx, y, -D / 2, null);
  for (let z = -D - 2; z <= 2; z += 1.4) box(0.04, 1.1, 0.04, white, rx, 0.55, z, null);
}

// 左の壁と天井の入隅をふさぐ斜め面。
// 写真では、奥の角（A）から手前へ下りてくる斜めの稜線が左の壁に見え、
// 配管の少し上（B）からは一定の断面（45°）で手前へ続いている。
function slopedSlab(material) {
  const LOW = 3.75;
  const RUN = H - LOW; // 45° なので天井側へも同じだけ張り出す
  const A = new THREE.Vector3(-W / 2, H, -D + 0.15);
  const B = new THREE.Vector3(-W / 2, LOW, -D + 2.4);
  const C = new THREE.Vector3(-W / 2 + RUN, H, -D + 2.4);
  const B2 = new THREE.Vector3(-W / 2, LOW, 0);
  const C2 = new THREE.Vector3(-W / 2 + RUN, H, 0);
  const tris = [A, B, C, B, B2, C2, B, C2, C];
  const geo = new THREE.BufferGeometry().setFromPoints(tris);
  geo.computeVertexNormals();
  // 斜め面に沿って実寸の UV を張る（u は奥行き、v は斜面の上り方向）
  const slopeDir = C.clone().sub(B).normalize();
  geo.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      tris.flatMap((p) => [(p.z + D) / CONCRETE_TILE.u, p.clone().sub(B).dot(slopeDir) / CONCRETE_TILE.v]),
      2,
    ),
  );
  const mesh = new THREE.Mesh(geo, material.clone());
  mesh.material.side = THREE.DoubleSide;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- UV ----------

// 面の向きごとに、ワールド座標をそのままテクスチャ座標にする（壁・天井・床の継ぎ目が揃う）
function concreteUV(p, n) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  if (ay > ax && ay > Math.abs(n.z)) return [(p.x + W / 2) / CONCRETE_TILE.u, (p.z + D) / CONCRETE_TILE.v];
  if (ax > Math.abs(n.z)) return [(p.z + D) / CONCRETE_TILE.u, p.y / CONCRETE_TILE.v];
  return [(p.x + W / 2) / CONCRETE_TILE.u, p.y / CONCRETE_TILE.v];
}

function woodUV(p) {
  return [p.x / WOOD_TILE.u, p.z / WOOD_TILE.v];
}

function applyWorldUV(geo, offset, fn) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).add(offset);
    n.fromBufferAttribute(nor, i);
    const [u, v] = fn(p, n);
    uv.setXY(i, u, v);
  }
}

// ---------- テクスチャ ----------

// ---------- 家具 ----------

// public/models/ の GLB を読み込んで置く。モデルは scripts/blender/optimize_model.py で軽くしたもの。
//   width: 実寸の幅（m）。生成モデルは大きさがまちまちなので、幅を基準に拡大縮小する
//   rotationY: モデルの正面をカメラ（+z）へ向ける回転
//   fabric: 布の色（指定すると布の質感に置き換える。生成モデルの金属感・テカリ・焼き込まれた陰影を消す）
//   screen: 映像を流す画面の範囲（モデルの元の座標）。映像は config.js の crtVideo
//   focus: 押すとそこへズームする（id とツールチップの文字）
//   on: 床ではなく、この url の家具の上に載せる（左右・前後の中心を揃える。x, z は無視）
//     onOffset: { y, z } 揃えた位置からのずれ（m）。y は下の家具の天面から、載せる物の底までの高さ
//     rotationX: 前後の傾き（負で後ろが下がる）
//     天面が平らでない物（ブラウン管の後ろの斜面など）は、Blender で接地する傾き・ずれを計算して指定する
//   float: 床に置かず、この高さ（中心, m）に浮かせてゆっくり漂わせる
//   wall: { y } 床に置かず壁に掛ける（下端の高さ y。ネックの上の方に壁のハンガーを付ける）
//   mirror: 床への映り込みと、輪郭に沿った接地の影を付ける（src/floorMirror.js）
//   wander: 画面の外から外へ左右に往復させ、ときどき立ち止まって見回させる（robotWander）
const FURNITURE = [
  // 部屋の中央・奥寄り（奥の壁から 1.6m）。モデルの正面は -z 向きなので 180° 回す
  { url: 'models/sofa.glb', x: 0, z: -D + 1.6, rotationY: Math.PI, width: 2.1, fabric: '#6e6a65' },
  // 部屋の中央、ソファの手前の床に置いたブラウン管（blown TV 03）。画面をこちらへ向ける
  {
    url: 'models/crt.glb', x: 0, z: -D + 4.0, rotationY: 0, width: 0.42,
    screen: { x0: -0.3, x1: 0.3, y0: 0.31, y1: 0.82 },
    focus: { id: 'tv', label: 'TV' },
  },
  // 中央のブラウン管の上に載せた宇宙ヘルメット（space 3d helmet）。
  // ブラウン管の天面は前 1/3 だけ平らで後ろは斜面なので、22° 後ろへ傾けて、前は天面の角・後ろは斜面に接地させる。
  // 傾き・ずれは width 0.38（ブラウン管 0.42）での計算値。大きさを変えたら計算し直す
  {
    url: 'models/helmet.glb', on: 'models/crt.glb', x: 0, z: 0, rotationY: 0, width: 0.38,
    rotationX: -0.384, onOffset: { y: -0.0576, z: 0.01 },
  },
  // 右奥のブラウン管のタワーの前の床に置いたキーボード（Roland FANTOM の生成モデル）。
  // モデルの鍵盤側は +z 向きなので、90° 回して鍵盤を窓（+x）へ向ける。白鍵の黒い点はテクスチャで消してある
  { url: 'models/keyboard.glb', x: 1.9, z: -7.4, rotationY: Math.PI / 2, width: 1.25, mirror: true },
  // 左奥のブラウン管のタワーに立てかけたギター（Gretsch の生成モデル。ピックガードのでっぱりは平らにしてある）。
  // 正面（+z）を部屋の手前へ向け、後ろへ傾けて、いちばん下の段のブラウン管にもたせかける
  {
    url: 'models/guitar-gretsch.glb', x: -1.39, z: -8.35, rotationY: 0.29, rotationX: -0.27, width: 0.45,
    mirror: { height: 0.3, strength: 0.3 },
  },
  // 左の壁、コンクリートの棚の下に掛けたギター（HB の生成モデル）。正面を部屋へ向け、ヘッドの下を壁のハンガーで支える
  { url: 'models/guitar-hb.glb', x: -W / 2 + 0.065, z: -7.85, rotationY: Math.PI / 2, width: 0.4, wall: { y: 0.22 } },
  // 右奥のブラウン管のタワー（キーボードの奥）の、いちばん下の段に立てかけたベース（白いジャズベースの生成モデル）。
  // Gretsch とは向きを変え、左へ大きく振って、少しひねって立てかける
  {
    url: 'models/bass-white.glb', x: 1.7, z: -8.36, rotationY: -0.75, rotationX: -0.33, rotationZ: 0.05, width: 0.415,
    mirror: { height: 0.3, strength: 0.3 },
  },
  // 宙に浮かぶロボットの頭（Lavvy robot）
  { url: 'models/robot.glb', x: -0.8, z: -D + 4.3, rotationY: 0.35, width: 0.42, float: 2.4, wander: true },
];

async function loadFurniture(manager) {
  const loader = new GLTFLoader(manager);
  const base = import.meta.env.BASE_URL;
  const groups = await Promise.all(
    FURNITURE.map(async (item) => {
      const gltf = await loader.loadAsync(base + item.url);
      const model = gltf.scene;
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (item.fabric) obj.material = fabricMaterial(obj.material, item.fabric);
      });
      if (item.screen) addCrtScreen(model, item.screen);
      // 幅を実寸に合わせ、床（y = 0）に接地させる
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(item.width / size.x);
      if (item.wander) return robotWander(model, item);
      if (item.float) return floating(model, item);
      // 先に前後へ傾け（x）、それから向きを変える（y）。立てかける物が、向けた方へ傾くように
      model.rotation.set(item.rotationX ?? 0, item.rotationY ?? 0, item.rotationZ ?? 0, 'YXZ');
      model.updateMatrixWorld(true);
      const box = modelBox(model);
      model.position.set(item.x, (item.wall?.y ?? 0) - box.min.y, item.z);

      const group = new THREE.Group();
      group.add(model);
      if (item.wall) {
        model.updateMatrixWorld(true);
        group.add(wallHanger(modelBox(model)));
      }
      // mirror: 床への映り込みと、輪郭に沿った接地の影を付ける（背の低い、角張った物向け）
      if (item.mirror) {
        model.updateMatrixWorld(true);
        const placed = modelBox(model);
        group.add(footprintShadow(placed), floorMirror(model, placed, item.mirror === true ? {} : item.mirror));
      } else if (!item.on && !item.wall) {
        // 上に載せる物は、床用の接地影を付けない（下の家具の中に埋もれる）
        const center = box.getCenter(new THREE.Vector3());
        group.add(contactShadow(box, item.x + center.x, item.z + center.z));
      }
      if (item.focus) group.userData.focus = item.focus;
      // 置いた後の位置で測り直す（box は動かす前の座標）。on で上に載せるときに使う
      model.updateMatrixWorld(true);
      group.userData.box = modelBox(model);
      return group;
    }),
  );
  // on: 下の家具の上に載せ、中心を揃える
  FURNITURE.forEach((item, i) => {
    if (!item.on) return;
    const below = groups[FURNITURE.findIndex((f) => f.url === item.on)]?.userData.box;
    const box = groups[i].userData.box;
    if (!below || !box) return;
    const a = below.getCenter(new THREE.Vector3());
    const b = box.getCenter(new THREE.Vector3());
    const off = item.onOffset ?? {};
    groups[i].position.set(a.x - b.x, below.max.y - box.min.y + (off.y ?? 0), a.z - b.z + (off.z ?? 0));
  });
  return groups;
}

// 壁のギターハンガー：黒い小さな台座と、ネックを両側から受ける 2 本の腕（左の壁、x = -W / 2 に付ける）。
// ヘッドの付け根（ギターの上から 2 割弱の所）の高さに置く
function wallHanger(box) {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#16171a', metalness: 0.6, roughness: 0.45 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.9 });
  const y = box.max.y - (box.max.y - box.min.y) * 0.19;
  const z = (box.min.z + box.max.z) / 2;
  const x0 = -W / 2;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.09), black);
  plate.position.set(x0 + 0.006, y - 0.01, z);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.06, 12), black);
  stem.rotation.z = Math.PI / 2;
  stem.position.set(x0 + 0.04, y - 0.015, z);
  g.add(plate, stem);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.07, 10), rubber);
    arm.rotation.z = Math.PI / 2 - 0.25;
    arm.position.set(x0 + 0.075, y - 0.008, z + s * 0.026);
    g.add(arm);
  }
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

// モデルの外形。頂点から正確に測る（傾けた物は、標準の測り方だと箱が膨らんで浮く）。
// ブラウン管に後から貼った映像の板は含めない
function modelBox(model) {
  const box = new THREE.Box3();
  model.traverse((o) => o.isMesh && !o.userData.isScreen && box.expandByObject(o, true));
  return box;
}

// 宙に浮かせ、上下にふわふわ揺れながら、ゆっくり首を振らせる
function floating(model, item) {
  // 回転の中心をモデルの中心にする
  model.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  model.position.sub(center);
  const pivot = new THREE.Group();
  pivot.add(model);
  const yaw = item.rotationY ?? 0;
  pivot.userData.update = (t) => {
    pivot.position.set(
      item.x + Math.sin(t * 0.23) * 0.12,
      item.float + Math.sin(t * 0.9) * 0.07 + Math.sin(t * 0.37) * 0.04,
      item.z + Math.cos(t * 0.19) * 0.1,
    );
    pivot.rotation.set(Math.sin(t * 0.6) * 0.06, yaw + Math.sin(t * 0.31) * 0.45, Math.sin(t * 0.73) * 0.05);
  };
  pivot.userData.update(0);
  return pivot;
}

// ---------- 往復するロボット ----------

// 画面（窓）のすぐ手前を、画面の外から外へ左右に往復する。
// 途中でときどき立ち止まり、きょろきょろ見回してから、また進む。端に着いたら少し待って折り返す
const WANDER = {
  front: 0.6, // 窓の面からどれだけ手前（目の側）を飛ぶか（m）。窓より奥だと左右の壁にぶつかる
  height: 0.4, // 高さ。窓の中心から、窓の半分の高さの何割ぶん上か
  speed: 0.55, // 進む速さ（m/秒）
  accel: 0.5, // 加速・減速（m/秒²）
  margin: 0.45, // 画面の端からどれだけ外まで出るか（m）
  stopChance: 0.65, // 1 回の横断で立ち止まる確率
  look: [3.5, 6.5], // 見回す時間（秒）
  wait: [1.5, 4.5], // 画面の外で待つ時間（秒）
  // メニューで呼ばれたとき（summon）。画面の中央上まで飛んできて、顔の下からホログラムを映す
  summonSpeed: 1.6, // 呼ばれて飛ぶ速さ（m/秒）
  summonAccel: 1.4,
  projectPitch: 0.3, // 映すときのうつむき（rad）。投影口を下のパネルへ向ける
  // About を読んでいる間（setPeek）。ときどき目の前まで来て、こちらを確かめ、首をかしげて戻る
  peekDistance: 0.62, // 目からどれだけ手前で止まるか（m）
  peekSpeed: 1.25,
  peekAccel: 1.1,
  peekFirst: [2.5, 4.5], // 読み始めてから最初に来るまで（秒）
  peekEvery: [9, 16], // 戻ってから次に来るまで（秒）
  peekStare: 1.2, // 止まってじっと見る時間（秒）
  peekTilt: 0.42, // 首をかしげる角度（rad）
  // Goods を選んだとき（deliver）。画面の外で紙のメニューを底のマグネットにくっつけ、読みやすい所まで持ってくる
  deliverSpeed: 1.6,
  deliverAccel: 1.3,
  deliverFill: 0.94, // 紙の高さが、画面の高さのこの割合になるまで近づく（ロボットは上に見切れる）
  deliverFillW: 0.97, // 紙の幅が、画面の幅のこの割合を超えないようにする（縦長の画面）
  deliverAt: 0, // 紙の中心を置く、画面の上下の位置（-1〜1）
  deliverMin: 0.3, // 目からこれより近づかない（m）
};

// 顔の下の光るスロット（ホログラムの投影口）。robot.glb の元の座標（底 y = 0、正面 +z）
const ROBOT_EMITTER = new THREE.Vector3(0, 0.087, 0.27);
const HOLO_COLOR = new THREE.Color('#4aa8ff');

// 投影口に重ねる青い光の玉
let glowTexture;
function holoGlow() {
  if (!glowTexture) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(220,240,255,1)');
    g.addColorStop(0.25, 'rgba(90,170,255,0.8)');
    g.addColorStop(1, 'rgba(20,60,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      color: HOLO_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.userData.noPick = true;
  return sprite;
}

function robotWander(model, item) {
  model.updateMatrixWorld(true);
  const modelBox = new THREE.Box3().setFromObject(model);
  const center = modelBox.getCenter(new THREE.Vector3());
  const size = modelBox.getSize(new THREE.Vector3());
  model.position.sub(center);
  // body: 位置と向き。head: 見回し・傾き（body の中で回す）
  const body = new THREE.Group();
  const head = new THREE.Group();
  head.add(model);
  body.add(head);
  // 底の中央のマグネット（robot.glb の底の楕円の板）。Goods の紙の棒をここにくっつける（main.js / goodsPaper.js）。
  // 頭と一緒に傾くが、紙は goodsPaper.js が鉛直に吊り直す
  const carry = new THREE.Group();
  carry.position.y = -size.y / 2;
  head.add(carry);

  // 投影口。光の玉と、ロボットの下側を青く照らす光を付ける（映していない間は消しておく）
  const emitter = new THREE.Object3D();
  emitter.position.copy(ROBOT_EMITTER);
  const glow = holoGlow();
  glow.scale.setScalar(0.35); // モデルの元の大きさで。実寸ではおよそ 15cm
  const light = new THREE.PointLight(HOLO_COLOR, 0, 1.6, 2);
  emitter.add(glow, light);
  model.add(emitter);

  const rand = (a, b) => a + Math.random() * (b - a);
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const st = {
    dir: 1, // 進む向き（+1 = 右へ）
    x: null,
    speed: 0,
    mode: 'wait', // move / look / wait
    timer: rand(1, 2.5),
    stopAt: null, // 立ち止まる位置（画面の左右の割合 0〜1）
    glanceTimer: 0,
    yaw: 0,
    pitch: 0,
    yawTarget: 0,
    pitchTarget: 0,
    last: 0,
    y: null, // 高さ。呼ばれた後に元の高さへなめらかに戻るよう、状態として持つ
    summon: null, // 呼ばれた先（画面上の位置 { sx, sy }。-1〜1）
    arrived: false,
    beam: 0, // ホログラムの投影の強さ（main.js から）
    pokeT: null, // 押されてからの時間（秒）。反応していないときは null
    curious: false, // 押された後の、きょろきょろ見回している間
    pz: null, // 奥行き。ふだんは往復する通り道、のぞき込むときだけ目の前まで出てくる
    roll: 0, // 首のかしげ
    rollTarget: 0,
    peekOn: false, // About を読んでいる間
    peekTimer: 0,
    peek: null, // のぞき込みの途中 { phase: in / stare / tilt / out, t, side, backX }
    deliver: null, // 紙を持ってくる途中 { width, depth }（紙の幅と、マグネットから紙の下端までの長さ）
    deliverPhase: null, // fetch: 画面の外へ紙を取りに行く / bring: 紙を持って目の前へ
    carrying: false, // 紙を吊るしている（持ってきてから、画面の外へ出るまで）
  };

  // 画面上の位置（窓の左右・上下の割合 -1〜1）を、目から見てその位置に重なる深さ z の点にする
  function screenPoint(eye, win, sx, sy, z) {
    const k = (eye.z - z) / (eye.z - win.cz);
    return {
      x: eye.x + (win.cx + sx * win.halfW - eye.x) * k,
      y: eye.y + (win.cy + sy * win.halfH - eye.y) * k,
    };
  }

  // 窓の左右の縁を、目からロボットの深さまで延ばした x（画面の端）
  function edges(view, z) {
    if (!view) return { left: -W / 2, right: W / 2, y: item.float, z: item.z };
    const { eye, win } = view;
    const k = (eye.z - z) / (eye.z - win.cz);
    const at = (x) => eye.x + (x - eye.x) * k;
    const yWin = win.cy + win.halfH * WANDER.height;
    return { left: at(win.cx - win.halfW), right: at(win.cx + win.halfW), y: eye.y + (yWin - eye.y) * k };
  }

  function planCrossing() {
    st.mode = 'move';
    st.stopAt = Math.random() < WANDER.stopChance ? rand(0.3, 0.7) : null;
  }

  let lastView = null;
  body.userData.update = (t, view) => {
    lastView = view ?? lastView;
    const dt = Math.min(t - st.last, 0.1);
    st.last = t;
    const z = view ? view.win.cz + WANDER.front : item.z;
    const e = edges(view, z);
    const outL = e.left - WANDER.margin;
    const outR = e.right + WANDER.margin;
    if (st.x === null) st.x = outL;

    // 進む方向を向き、少しだけこちらに顔を向ける
    const travelYaw = st.dir * (Math.PI / 2 - 0.35);

    if (st.pz === null) st.pz = z;
    st.laneZ = z;
    st.rollTarget = 0;
    // About を読んでいる間は、ときどき目の前までのぞきに来る
    if (st.peekOn && st.mode !== 'summon' && st.mode !== 'peek' && st.mode !== 'deliver') {
      st.peekTimer -= dt;
      if (st.peekTimer <= 0) {
        st.mode = 'peek';
        st.peek = { phase: 'in', t: 0, side: Math.random() < 0.5 ? -1 : 1, backX: 0 };
        st.speed = 0;
        st.curious = false;
      }
    }

    if (st.mode === 'peek') {
      const pk = st.peek;
      pk.t += dt;
      const eye = view?.liveEye ?? view?.eye;
      // 目の真ん前より少し横・少し下（顔が画面の中ほどに大きく来る）
      const front = eye
        ? { x: eye.x + pk.side * 0.08, y: eye.y - 0.06, z: eye.z - WANDER.peekDistance }
        : { x: st.x, y: st.y, z: st.pz };
      if (pk.phase === 'in' || pk.phase === 'out') {
        const goal = pk.phase === 'in' ? front : { x: pk.backX, y: e.y, z };
        const dx = goal.x - st.x;
        const dy = goal.y - st.y;
        const dz = goal.z - st.pz;
        const dist = Math.hypot(dx, dy, dz);
        const cap = Math.min(WANDER.peekSpeed, Math.sqrt(2 * WANDER.peekAccel * dist));
        st.speed = Math.min(st.speed + WANDER.peekAccel * dt, cap);
        const step = Math.min(dist, st.speed * dt);
        if (dist > 1e-4) {
          st.x += (dx / dist) * step;
          st.y += (dy / dist) * step;
          st.pz += (dz / dist) * step;
        }
        // 進む方を向く。近づき終わる手前からは、こちら（正面）を向く
        const travel = Math.abs(dx) + Math.abs(dz) > 1e-3 ? Math.atan2(dx, dz) : 0;
        const near = pk.phase === 'in' ? THREE.MathUtils.smoothstep(dist, 0.12, 0.6) : 1;
        st.yawTarget = travel * near;
        st.pitchTarget = 0;
        if (dist < 0.02) {
          if (pk.phase === 'in') {
            pk.phase = 'stare';
            pk.t = 0;
            st.speed = 0;
          } else {
            st.mode = 'move';
            st.stopAt = null;
            st.peek = null;
            st.peekTimer = rand(...WANDER.peekEvery);
          }
        }
      } else {
        // じっと見る → 首をかしげる。目が動いても目の前に留まる
        st.x = damp(st.x, front.x, 3, dt);
        st.y = damp(st.y, front.y, 3, dt);
        st.pz = damp(st.pz, front.z, 3, dt);
        st.yawTarget = 0;
        st.pitchTarget = -0.06; // 少し見上げてのぞき込む
        if (pk.phase === 'stare' && pk.t > WANDER.peekStare) {
          pk.phase = 'tilt';
          pk.t = 0;
        } else if (pk.phase === 'tilt') {
          // 「？」と大きくかしげ、少し戻して、もう一度小さくかしげる
          st.rollTarget = pk.t < 0.9 ? pk.side * WANDER.peekTilt : pk.t < 1.3 ? pk.side * 0.1 : pk.t < 1.9 ? pk.side * 0.28 : 0;
          if (pk.t > 2.2) {
            pk.phase = 'out';
            pk.t = 0;
            // 通り道の、今いるあたりへ戻ってから、また往復を続ける
            pk.backX = THREE.MathUtils.clamp(st.x, e.left + 0.3, e.right - 0.3);
            st.dir = Math.random() < 0.5 ? -1 : 1;
          }
        }
      }
    } else if (st.mode === 'deliver' && st.deliverPhase === 'fetch') {
      // 画面に見えているときは、まず紙を取りに画面の外（近い方の端）まで飛んでいく
      const ef = edges(view, st.pz);
      const goalX = st.dir > 0 ? ef.right + WANDER.margin : ef.left - WANDER.margin;
      const dx = goalX - st.x;
      const dy = e.y - st.y;
      const dz = z - st.pz;
      const dist = Math.hypot(dx, dy, dz);
      st.speed = Math.min(st.speed + WANDER.deliverAccel * dt, WANDER.deliverSpeed);
      const step = Math.min(dist, st.speed * dt);
      if (dist > 1e-4) {
        st.x += (dx / dist) * step;
        st.y += (dy / dist) * step;
        st.pz += (dz / dist) * step;
      }
      st.yawTarget = Math.atan2(dx, dz);
      st.pitchTarget = 0;
      if (dist < 0.02) {
        // 画面の外で紙をくっつけて、引き返す
        st.deliverPhase = 'bring';
        st.carrying = true;
        st.speed = 0;
      }
    } else if (st.mode === 'deliver') {
      // 紙を持って、目の前の読みやすい所へ。紙が画面の高さの大部分を占める深さで止まる
      const eye = view?.liveEye ?? view?.eye;
      let goal = { x: st.x, y: st.y, z: st.pz };
      if (eye) {
        const { win } = view;
        const depth = st.deliver.depth;
        const span = eye.z - win.cz;
        const k = Math.max(
          depth / (WANDER.deliverFill * 2 * win.halfH),
          st.deliver.width / (WANDER.deliverFillW * 2 * win.halfW),
          WANDER.deliverMin / span,
        );
        const gz = eye.z - k * span;
        const c = screenPoint(eye, win, 0, WANDER.deliverAt, gz);
        goal = { x: c.x, y: c.y - (carry.position.y - depth / 2), z: gz };
      }
      const dx = goal.x - st.x;
      const dy = goal.y - st.y;
      const dz = goal.z - st.pz;
      const dist = Math.hypot(dx, dy, dz);
      if (st.arrived) {
        // 着いたら、目が動いてもその前に留まる
        st.x = damp(st.x, goal.x, 3, dt);
        st.y = damp(st.y, goal.y, 3, dt);
        st.pz = damp(st.pz, goal.z, 3, dt);
        st.speed = 0;
      } else {
        const cap = Math.min(WANDER.deliverSpeed, Math.sqrt(2 * WANDER.deliverAccel * dist));
        st.speed = Math.min(st.speed + WANDER.deliverAccel * dt, cap);
        const step = Math.min(dist, st.speed * dt);
        if (dist > 1e-4) {
          st.x += (dx / dist) * step;
          st.y += (dy / dist) * step;
          st.pz += (dz / dist) * step;
        }
        if (dist < 0.015) st.arrived = true;
      }
      // 遠いうちは進む方を向き、近づいたらこちらを向いて、少しうつむいて紙を見せる
      const travel = Math.abs(dx) + Math.abs(dz) > 1e-3 ? Math.atan2(dx, dz) : 0;
      const near = THREE.MathUtils.smoothstep(dist, 0.12, 0.7);
      st.yawTarget = travel * near;
      st.pitchTarget = (1 - near) * 0.16;
      st.rollTarget = st.arrived ? Math.sin(t * 0.7) * 0.05 : 0;
    } else if (st.mode === 'summon') {
      // 呼ばれた位置（画面の中央上）へ飛ぶ。目が動いても画面上の同じ位置に留まるよう、毎回計算し直す
      const eye = view?.liveEye ?? view?.eye;
      const goal = eye ? screenPoint(eye, view.win, st.summon.sx, st.summon.sy, z) : { x: item.x, y: item.float };
      const dx = goal.x - st.x;
      const dy = goal.y - st.y;
      const dist = Math.hypot(dx, dy);
      const cap = Math.min(WANDER.summonSpeed, Math.sqrt(2 * WANDER.summonAccel * dist));
      st.speed = Math.min(st.speed + WANDER.summonAccel * dt, cap);
      const step = Math.min(dist, st.speed * dt);
      if (dist > 1e-4) {
        st.x += (dx / dist) * step;
        st.y += (dy / dist) * step;
      }
      if (Math.abs(dx) > 0.02) st.dir = Math.sign(dx);
      // 遠いうちは進む方を向き、近づいたらこちらを向いて、うつむいて投影口を下へ向ける
      const near = THREE.MathUtils.smoothstep(dist, 0.15, 0.6);
      st.yawTarget = near * st.dir * (Math.PI / 2 - 0.35);
      st.pitchTarget = (1 - near) * WANDER.projectPitch;
      if (dist < 0.02) st.arrived = true;
    } else if (st.mode === 'wait') {
      // 画面の外で待機。待ち終えたら向きを変えて出発
      st.x = st.dir > 0 ? outL : outR;
      st.speed = 0;
      st.yawTarget = travelYaw;
      st.pitchTarget = 0;
      st.timer -= dt;
      st.carrying = false; // 画面の外に出たら、紙はしまう
      if (st.timer <= 0) planCrossing();
    } else if (st.mode === 'move') {
      const goal = st.stopAt !== null ? outL + (outR - outL) * st.stopAt : st.dir > 0 ? outR : outL;
      const dist = Math.max(0, (goal - st.x) * st.dir);
      // 止まる場所の手前でなめらかに減速する
      const cap = st.stopAt !== null ? Math.sqrt(2 * WANDER.accel * dist) : WANDER.speed;
      st.speed = Math.min(st.speed + WANDER.accel * dt, WANDER.speed, cap);
      st.x += st.dir * st.speed * dt;
      st.yawTarget = travelYaw;
      st.pitchTarget = 0;
      if (st.stopAt !== null && dist < 0.01) {
        st.mode = 'look';
        st.timer = rand(...WANDER.look);
        st.glanceTimer = 0;
      } else if (st.stopAt === null && (st.dir > 0 ? st.x >= outR : st.x <= outL)) {
        st.mode = 'wait';
        st.timer = rand(...WANDER.wait);
        st.dir *= -1;
      }
    } else {
      // 立ち止まって見回す：左右・こちら・上下へ、間をおいて視線を移す
      st.speed = 0;
      st.glanceTimer -= dt;
      // 押された後（curious）は、せわしなく広く見回す
      if (st.glanceTimer <= 0) {
        st.glanceTimer = st.curious ? rand(0.3, 0.75) : rand(0.6, 1.4);
        const range = st.curious ? 1.6 : 1.3;
        // 前と同じ側ばかり見ないよう、ときどき反対側へ大きく振る
        let yaw = rand(-range, range);
        if (st.curious && Math.sign(yaw) === Math.sign(st.yawTarget) && Math.random() < 0.6) yaw = -yaw;
        st.yawTarget = yaw;
        st.pitchTarget = st.curious ? rand(-0.35, 0.3) : rand(-0.25, 0.2);
      }
      st.timer -= dt;
      if (st.timer <= 0) {
        st.stopAt = null; // 残りは止まらずに抜ける
        st.mode = 'move';
        st.curious = false;
      }
    }

    // 押されたときの反応：ぴょんと跳ねて首を振り、投影口がぱっと光る。跳ねている間はこちらを見上げ、
    // 着地したら、きょろきょろと周りを見回す（look モードの curious）
    let hop = 0;
    let roll = 0;
    let blink = 0;
    if (st.pokeT !== null) {
      st.pokeT += dt;
      const p = st.pokeT;
      hop = Math.abs(Math.sin(p * 7.5)) * 0.11 * Math.exp(-p * 2.6);
      roll = Math.sin(p * 17) * 0.32 * Math.exp(-p * 3.2);
      blink = Math.exp(-p * 3.5);
      if (p < 0.55 && st.mode !== 'summon' && st.mode !== 'deliver') {
        st.yawTarget = 0;
        st.pitchTarget = -0.18; // 少し見上げる（びっくり）
      }
      if (p > 2.5) st.pokeT = null;
    }
    const g = Math.max(st.beam, blink * 0.9);
    glow.material.opacity = g;
    glow.visible = g > 0.001;
    light.intensity = Math.max(st.beam * 2, blink * 1.5);

    // 見回しは機敏に、移動中の向き変えはゆったり（押された直後はすばやく振り向く）
    const rate = st.curious ? 7 : st.mode === 'look' || (st.pokeT !== null && st.pokeT < 0.55) ? 6 : 2.5;
    st.yaw = damp(st.yaw, st.yawTarget, st.mode === 'peek' ? 4 : rate, dt);
    st.pitch = damp(st.pitch, st.pitchTarget, rate, dt);
    st.roll = damp(st.roll, st.rollTarget, 3.2, dt);
    // のぞき込み以外は、通り道の奥行きへなめらかに戻る
    if (st.mode !== 'peek' && st.mode !== 'deliver') st.pz = damp(st.pz, z, st.carrying ? 1.2 : 2, dt);

    // 普段の高さ。呼ばれた後は、ここへゆっくり戻る
    if (st.y === null) st.y = e.y;
    else if (st.mode !== 'summon' && st.mode !== 'peek' && st.mode !== 'deliver') st.y = damp(st.y, e.y, 1.5, dt);

    // 進むときに少し前のめり。映している間は揺れを小さくする
    const lean = Math.min(1, st.speed / WANDER.speed);
    const bob = (st.mode === 'summon' || st.mode === 'deliver') && st.arrived ? (st.mode === 'deliver' ? 0.2 : 0.35) : 1;
    const still = st.mode === 'peek' && st.peek?.phase !== 'in' && st.peek?.phase !== 'out' ? 0.3 : 1;
    body.position.set(st.x, st.y + (Math.sin(t * 0.9) * 0.06 + Math.sin(t * 0.37) * 0.03) * bob * still + hop, st.pz);
    body.rotation.set(0, st.yaw, 0);
    head.rotation.set(st.pitch + Math.sin(t * 0.6) * 0.04 + lean * 0.12, 0, Math.sin(t * 0.73) * 0.04 * still + roll + st.roll);
  };
  body.userData.update(0);

  // main.js から操作する（メニューを押したときのホログラム演出）
  body.userData.robot = {
    emitter,
    // 画面上の位置 sx, sy（-1〜1）へ呼ぶ
    // About を読んでいる間だけ、ときどき目の前までのぞきに来る。やめると、のぞき込みの途中なら戻る
    setPeek(on) {
      if (on === st.peekOn) return;
      st.peekOn = on;
      if (on) st.peekTimer = rand(...WANDER.peekFirst);
      else if (st.mode === 'peek' && st.peek.phase !== 'out') {
        const e = edges(lastView, st.laneZ ?? st.pz);
        st.peek.phase = 'out';
        st.peek.backX = THREE.MathUtils.clamp(st.x, e.left + 0.3, e.right - 0.3);
      }
    },
    summon(sx, sy) {
      if (st.mode === 'peek') st.peek = null;
      st.carrying = false;
      st.deliver = null;
      st.summon = { sx, sy };
      st.arrived = false;
      st.curious = false;
      st.mode = 'summon';
    },
    // 呼び出しを解いて、近い方の画面の端から出て行かせる（そのまま普段の往復に戻る）
    // Goods の紙を持ってくる。size: { width, depth }（goodsPaper.js の size）
    deliver(paperSize) {
      if (st.mode === 'peek') st.peek = null;
      st.deliver = paperSize;
      // 画面に見えているなら、紙を取りに画面の外へ行ってから持ってくる（その場で紙が現れないように）
      const ef = edges(lastView, st.pz);
      const onScreen = st.x > ef.left - 0.3 && st.x < ef.right + 0.3;
      if (onScreen && !st.carrying) {
        st.deliverPhase = 'fetch';
        const mid = (ef.left + ef.right) / 2;
        st.dir = st.x >= mid ? 1 : -1;
      } else {
        st.deliverPhase = 'bring';
        st.carrying = true;
      }
      st.arrived = false;
      st.curious = false;
      st.summon = null;
      st.speed = Math.min(st.speed, 0.3);
      st.mode = 'deliver';
    },
    carry,
    get carrying() {
      return st.carrying;
    },
    get delivering() {
      return st.mode === 'deliver';
    },
    release(view) {
      if (st.mode === 'deliver') {
        st.deliver = null;
        // 紙を取りに行く途中なら、紙は持っていない
        if (st.deliverPhase === 'fetch') st.carrying = false;
        st.deliverPhase = null;
      }
      else if (st.mode !== 'summon') return;
      const center = view ? view.win.cx : 0;
      st.dir = st.x >= center ? 1 : -1;
      st.mode = 'move';
      st.stopAt = null;
      st.summon = null;
      st.arrived = false;
    },
    get arrived() {
      return st.arrived;
    },
    // 投影の強さ 0〜1。投影口の光とロボットの下を照らす光（次の update で反映）
    setBeam(v, flicker = 1) {
      st.beam = v * flicker;
    },
    // 押されたときの反応。歩いている途中なら立ち止まって、少しこちらを見てから、また進む
    // 押されたときの反応。その場で跳ねてから、しばらく周りを見回し、また進む（映している間は跳ねるだけ）
    poke() {
      st.pokeT = 0;
      if (st.mode === 'move' || st.mode === 'look') {
        st.mode = 'look';
        st.timer = 3.8;
        st.glanceTimer = 0.55; // 跳ね終わるまではこちらを見上げたまま
        st.curious = true;
        st.speed = 0;
      }
    },
    object: body,
  };
  return body;
}

// 生成モデルのテクスチャは撮影時の光と青みが焼き込まれているので、
// 色を一色に寄せて模様（布目・縫い目）の明暗だけを残し、部屋の光で陰影が付くようにする
function fabricMaterial(src, color) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    map: src.map,
    normalMap: src.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.35,
    // 起毛した布の、縁がふわっと明るくなる感じ
    sheen: 0.35,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#d8d0c4'),
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec3 texel = texture2D( map, vMapUv ).rgb;
        float l = dot( texel, vec3( 0.2126, 0.7152, 0.0722 ) );
        // 明暗の幅を縮め（平均 0.2 前後）、色味は捨てて color の色にする
        diffuseColor.rgb *= clamp( 0.75 + ( l - 0.2 ) * 1.2, 0.45, 1.15 );
      #endif`,
    );
  };
  return mat;
}

// 家具の真下のやわらかい影（接地感）。直射日光の影とは別に、床との隙間に溜まる暗がり
let contactShadowTexture;
function contactShadow(box, x, z) {
  if (!contactShadowTexture) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    contactShadowTexture = new THREE.CanvasTexture(canvas);
  }
  const size = box.getSize(new THREE.Vector3());
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.15, size.z * 1.3),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.002, z);
  mesh.userData.noPick = true;
  return mesh;
}

async function loadTextures(manager) {
  const loader = new THREE.TextureLoader(manager);
  const base = `${import.meta.env.BASE_URL}textures/`;
  const load = async (name, srgb) => {
    const tex = await loader.loadAsync(base + name);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const files = {
    concreteAlbedo: ['concrete_albedo.png', true],
    concreteNormal: ['concrete_normal.png'],
    concreteRough: ['concrete_roughness.png'],
    woodAlbedo: ['wood_albedo.png', true],
    woodNormal: ['wood_normal.png'],
    woodRough: ['wood_roughness.png'],
    shelfAlbedo: ['shelf_albedo.png', true],
    shelfNormal: ['shelf_normal.png'],
    shelfRough: ['shelf_roughness.png'],
    shutterAlbedo: ['shutter_albedo.png', true],
    shutterRough: ['shutter_roughness.png'],
    pavingAlbedo: ['paving_albedo.png', true],
    pavingNormal: ['paving_normal.png'],
    pavingRough: ['paving_roughness.png'],
    land: ['outside_land.png', true],
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, [name, srgb]]) => [key, await load(name, srgb)]),
  );
  const textures = Object.fromEntries(entries);
  textures.land.wrapS = textures.land.wrapT = THREE.ClampToEdgeWrapping;
  return textures;
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
