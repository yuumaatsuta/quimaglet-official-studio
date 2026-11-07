import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CONFIG } from './config.js';
import { addCrtScreen, startCrtVideo, updateCrtScreens } from './crtScreen.js';
import { buildCrtTower, loadCrtTemplates } from './crtTower.js';
import { floorMirror, footprintShadow } from './floorMirror.js';
import { mergeStatic } from './mergeStatic.js';
import { addRoomShade, addShelfShade } from './ambientShade.js';
import { wallShadow } from './wallShadow.js';
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
const SHELF_HEIGHT = 0.84;
const OCCLUDERS = 4; // 周りを暗くする大きな物の数の上限（ambientShade.js） // コンクリートの棚に載る、木の升目棚の高さ

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

export async function buildStudioRoom(onProgress, contentReady) {
  RectAreaLightUniformsLib.init();

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => onProgress?.(loaded / total);
  const [textures, furniture, crtTemplates, floorLogo] = await Promise.all([
    loadTextures(manager),
    loadFurniture(manager),
    loadCrtTemplates(gltfLoader(manager)),
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
  // 壁と床・天井の角、左の壁の出っ張り（コンクリートの棚と木の棚）の上下の暗がり（ambientShade.js）
  const roomShape = {
    room: { x0: -W / 2, x1: W / 2, z0: -D, z1: 0, y1: H },
    block: { x0: -W / 2, x1: -W / 2 + 0.32, y0: LEDGE_Y - 0.12, y1: LEDGE_Y + SHELF_HEIGHT, top: -0.3 },
    // 大きな物の外形（家具とタワーを置いてから入れる。使わない枠は強さ 0）
    occluders: {
      min: { value: Array.from({ length: OCCLUDERS }, () => new THREE.Vector3()) },
      max: { value: Array.from({ length: OCCLUDERS }, () => new THREE.Vector3()) },
      strength: { value: Array.from({ length: OCCLUDERS }, () => new THREE.Vector2()) }, // x: 床、y: 壁
    },
  };
  addRoomShade(concrete, roomShape);
  addRoomShade(floorMat, roomShape);
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
    mesh.userData.merge = true; // 動かない部品。最後にまとめて描く（mergeStatic.js）
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
    mesh.userData.merge = true;
    group.add(mesh);
    return mesh;
  }

  // ---------- 躯体 ----------

  box(W + 2 * T, T, D, floorMat, 0, -T / 2, -D / 2, woodUV);
  // 天井は床の照り返しを拾いすぎて茶色くならないよう、環境光を弱める
  const ceilingMat = concrete.clone();
  ceilingMat.envMapIntensity = 0.2;
  addRoomShade(ceilingMat, roomShape); // 複製では付け直しが要る
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
  group.add(buildCubbyShelf({ box, textures }));

  // 家具（public/models/ の GLB）
  // クリックできる家具。focus のものは、押すとそこへズームする（main.js）
  const hotspots = new Map();
  const focus = new Map();
  const members = new Map(); // 楽器のキー → { object: 押せる物, shown(): 見えている置き方, chip(): チップ }
  for (const item of furniture) {
    group.add(item);
    const key = item.userData.member;
    if (key) {
      tagHotspot(hotspots, `member:${key}`, item);
      const shown = () => item.userData.shown?.() ?? item;
      members.set(key, { object: item, shown, chip: () => shown().userData.chip });
    }
    const f = item.userData.focus;
    if (!f) continue;
    item.userData.hotspotLabel = f.label;
    tagHotspot(hotspots, f.id, item);
    focus.set(f.id, item);
  }

  // 奥の壁の右上に、ペンキで落書きしたメニュー。押すとロボットがそのページを映す
  await contentReady; // 壁のメニューとお知らせは、文章を読んでから作る
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
  const rightTower = buildCrtTower({
    templates: crtTemplates, corner: new THREE.Vector3(W / 2, 0, -D),
    along: new THREE.Vector3(-1, 0, 0), side: new THREE.Vector3(0, 0, 1),
    target: towerTarget, rand: towerRand, armMaterial: steel,
  });
  // 左奥の角（左の壁のコンクリート棚の出の分だけ内側から）
  const leftTower = buildCrtTower({
    templates: crtTemplates, corner: new THREE.Vector3(-W / 2 + 0.32, 0, -D),
    along: new THREE.Vector3(1, 0, 0), side: new THREE.Vector3(0, 0, 1),
    target: towerTarget, rand: towerRand, armMaterial: steel,
  });
  group.add(rightTower, leftTower);
  // 大きな物（ソファ・タワー）の周りの床と壁の暗がり
  const occ = [
    ...FURNITURE.flatMap((it, i) => (it.occluder ? [[furniture[i], it.occluder]] : [])),
    // タワーが壁に落とす影は wallShadow が形に沿って描くので、壁は薄く
    [leftTower, [0.55, 0.25]],
    [rightTower, [0.55, 0.25]],
  ];
  occ.forEach(([obj, k], i) => {
    if (i >= OCCLUDERS) return;
    obj.updateMatrixWorld(true);
    // 床の影など、飾りの板は測らない
    const b = new THREE.Box3();
    obj.traverse((o) => o.isMesh && !o.userData.noPick && b.expandByObject(o, true));
    roomShape.occluders.min.value[i].copy(b.min);
    roomShape.occluders.max.value[i].copy(b.max);
    roomShape.occluders.strength.value[i].set(...(Array.isArray(k) ? k : [k, k]));
  });
  // タワーが奥の壁と左の壁に落とす影（ブラウン管とアームの形に沿って）
  group.add(
    wallShadow(leftTower, { wall: 'z', at: -D, light: WALL_LIGHT.back }),
    wallShadow(leftTower, { wall: 'x', at: -W / 2, light: WALL_LIGHT.left }),
    wallShadow(rightTower, { wall: 'z', at: -D, light: WALL_LIGHT.back }),
  );

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

  // 窓枠・アーム・手すりなど、動かない小さな部品をまとめる（描く回数を減らす）
  mergeStatic(group);

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
    // メンバーの楽器とチップ（main.js が紹介のホログラムを映す）
    members,
    // 夜の月と星空の投影（planetarium.js）
    planetarium,
    hasLights: true,
    // view: { eye, win, liveEye }（main.js）。画面の端を知りたい物（ロボット）に渡す。
    // eye はズームや見回しに左右されない目、liveEye は実際の目（画面上の位置に合わせたいとき）
    update(t, view) {
      shutter.update(t);
      updateCrtScreens(t);
      for (const item of furniture) item.userData.update?.(t, view);
      for (const m of members.values()) m.chip()?.userData.update(t);
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
    roughness: 0.8,
    // 薄く塗装した木。窓の光と部屋がうっすら映る
    clearcoat: 0.35,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  };
  const wood = new THREE.MeshPhysicalMaterial({ ...woodProps });
  const inner = new THREE.MeshPhysicalMaterial({ ...woodProps, color: '#efe2d2' });
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
  const height = SHELF_HEIGHT;
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

  // 升目の奥・隅・本の足元の暗がり（ambientShade.js）。本の足元の影の画像は、本を並べてから作る
  const shade = {
    front: x0 + depth, back: x0 + 0.012, y0, y1: y0 + height, rows, rowPitch: (height - t) / rows,
    z0, z1, colPitch: (len - t) / cols, t, contact: { value: null },
  };
  addShelfShade(wood, shade);
  addShelfShade(inner, shade);

  // 升目の中身（本）。升目の内側の範囲を渡す
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const yb = y0 + t + (r * (height - t)) / rows;
    const yt = y0 + ((r + 1) * (height - t)) / rows;
    for (let c = 0; c < cols; c++) {
      const za = z0 + t + (c * (len - t)) / cols;
      const zb = z0 + ((c + 1) * (len - t)) / cols;
      cells.push({ yb, yt, za, zb, row: r });
    }
  }
  return shelfBooks(cells, { front: x0 + depth, back: x0 + 0.012, shade });
}

// 升目に入れた本。半分ほどの升目に、立てて並べた本・寄りかかった本・平積みの本を入れる。
// 背表紙は部屋（+x）へ向ける。文字は描かない（遠目には崩れて見えるため）。色は落ち着いた布・紙の色
function shelfBooks(cells, { front, back, shade }) {
  const rand = mulberry32(29);
  const r = (a, b) => a + rand() * (b - a);
  const COLORS = [
    '#1f2a3a', '#2b3b52', '#5a1f24', '#7a2e2a', '#3d4a2c', '#556040', '#b8a98a', '#d9d0bd',
    '#e6e1d6', '#1b1b1d', '#3a3a3c', '#7c7f84', '#a9832f', '#8a5a2b', '#2f4f4f', '#6b4c6b',
    '#c45c3b', '#efe9dc', '#4a6a7a', '#9c2f2f',
  ];
  const books = []; // { w: 厚み(z), h: 高さ(y), d: 奥行き(x), x, y, z, rx, ry, color }
  const feet = []; // 棚板に落とす足元の影 { x, z, d, w, ry, row, strength }
  const color = () => new THREE.Color(COLORS[Math.floor(rand() * COLORS.length)]).multiplyScalar(r(0.85, 1.08));
  const maxDepth = front - back - 0.01;

  for (const cell of cells) {
    const mode = rand();
    const ch = cell.yt - cell.yb;
    const cw = cell.zb - cell.za;
    if (mode < 0.5) continue; // 空の升目
    if (mode < 0.9) {
      // 立てて並べる。左右どちらかから詰め、最後の 1 冊を寄りかからせることもある
      const fromLeft = rand() < 0.5;
      const fill = mode < 0.7 ? r(0.85, 0.98) : r(0.4, 0.7);
      let used = 0;
      const series = rand() < 0.35 ? { h: ch * r(0.72, 0.92), d: r(0.15, 0.21), color: color() } : null; // 揃いの本
      const row = [];
      while (used < cw * fill) {
        const w = series ? r(0.022, 0.03) : r(0.014, 0.048);
        if (used + w > cw - 0.004) break;
        const h = series ? series.h * r(0.99, 1.0) : Math.min(ch - 0.008, ch * r(0.62, 0.95));
        const d = Math.min(maxDepth, series ? series.d : r(0.12, 0.23));
        row.push({ w, h, d, color: series && rand() < 0.85 ? series.color.clone() : color() });
        used += w + r(0, 0.002);
      }
      let z = fromLeft ? cell.za : cell.zb;
      for (const b of row) {
        const zc = fromLeft ? z + b.w / 2 : z - b.w / 2;
        books.push({ ...b, x: front - 0.012 - b.d / 2 - r(0, 0.015), y: cell.yb, z: zc, rx: 0, ry: r(-0.02, 0.02), row: cell.row, floor: true });
        z += (fromLeft ? 1 : -1) * (b.w + 0.0015);
      }
      // 空きがあれば、最後の 1 冊を隣に寄りかからせる
      const gap = fromLeft ? cell.zb - z : z - cell.za;
      if (row.length && gap > 0.06 && rand() < 0.7) {
        const w = r(0.016, 0.035);
        const h = Math.min(ch - 0.01, ch * r(0.7, 0.9));
        const a = Math.min(r(0.18, 0.42), Math.asin(Math.min(1, (gap - w) / h)));
        // 底の外側の角を床に、上の角を隣の本に当てる
        const s = fromLeft ? 1 : -1;
        const zBase = z + s * (h * Math.sin(a) + w * Math.cos(a));
        const zc = zBase - s * ((h / 2) * Math.sin(a) + (w / 2) * Math.cos(a));
        const yc = (h / 2) * Math.cos(a) + (w / 2) * Math.sin(a);
        const d = Math.min(maxDepth, r(0.13, 0.2));
        books.push({ w, h, d, x: front - 0.02 - 0.08, y: cell.yb + yc, z: zc, rx: -s * a, ry: 0, color: color(), centered: true });
        // 足元の影：底の角から、寄りかかった先の本の下まで（傾いた本の下は薄暗い）
        const span = h * Math.sin(a) + w * Math.cos(a);
        feet.push({ x: front - 0.1, z: zBase - (s * span) / 2, d, w: span, ry: 0, row: cell.row, strength: 0.55 });
      }
    } else {
      // 平積み（大判の本・雑誌）。上に小さな本を立てることもある
      let y = cell.yb;
      const n = 2 + Math.floor(rand() * 4);
      const zc = rand() < 0.5 ? cell.za + cw * 0.38 : cell.zb - cw * 0.38;
      for (let i = 0; i < n && y < cell.yt - 0.06; i++) {
        const thick = r(0.012, 0.035);
        const w = Math.min(cw * 0.8, r(0.17, 0.27));
        books.push({ w, h: thick, d: Math.min(maxDepth, r(0.16, 0.24)), x: front - 0.015 - 0.11, y, z: zc + r(-0.01, 0.01), rx: 0, ry: r(-0.08, 0.08), color: color(), row: cell.row, floor: i === 0 });
        y += thick;
      }
    }
  }

  for (const b of books) if (b.floor) feet.push({ x: b.x, z: b.z, d: b.d, w: b.w, ry: b.ry, row: b.row, strength: 1 });
  shade.contact.value = shelfContactTexture(feet, shade);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = addShelfShade(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 }), shade);
  const mesh = new THREE.InstancedMesh(geo, mat, books.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  books.forEach((b, i) => {
    e.set(b.rx, b.ry, 0, 'YXZ');
    q.setFromEuler(e);
    // 立てた本は底を棚板に付ける（centered の本は中心の高さを直接持つ）
    p.set(b.x, b.centered ? b.y : b.y + b.h / 2, b.z);
    m.compose(p, q, sc.set(b.d, b.h, b.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, b.color);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.noPick = true;
  return mesh;
}

// 棚板の上の、本の足元の影の画像。横が棚の長さ（z）、縦が段ごとの奥行き（x、入口 0 → 奥 1）。
// 本の底の形を塗り、少しぼかす（接地した所ほど濃く、周りへ 1〜2cm にじむ）
function shelfContactTexture(feet, { front, back, z0, z1, rows }) {
  const PX = 0.004; // 1 画素 4mm
  const W = Math.ceil((z1 - z0) / PX);
  const RH = Math.ceil((front - back) / PX); // 1 段の縦の画素数
  const H = RH * rows;
  const a = new Float32Array(W * H);
  for (const ft of feet) {
    const c = Math.cos(ft.ry);
    const s = Math.sin(ft.ry);
    const ex = (Math.abs(c) * ft.d + Math.abs(s) * ft.w) / 2;
    const ez = (Math.abs(s) * ft.d + Math.abs(c) * ft.w) / 2;
    for (let j = Math.floor((front - ft.x - ex) / PX); j <= Math.ceil((front - ft.x + ex) / PX); j++) {
      if (j < 0 || j >= RH) continue;
      for (let i = Math.floor((ft.z - ez - z0) / PX); i <= Math.ceil((ft.z + ez - z0) / PX); i++) {
        if (i < 0 || i >= W) continue;
        // 画素の中心を本の向きに戻して、底の長方形の中か調べる
        const dx = front - j * PX - PX / 2 - ft.x;
        const dz = z0 + i * PX + PX / 2 - ft.z;
        const lx = c * dx - s * dz;
        const lz = s * dx + c * dz;
        if (Math.abs(lx) <= ft.d / 2 && Math.abs(lz) <= ft.w / 2) {
          const k = (ft.row * RH + j) * W + i;
          a[k] = Math.max(a[k], ft.strength);
        }
      }
    }
  }
  // 横と縦に 2 回ずつ箱でぼかす（段の境目はまたがない）
  const blur = (horizontal, r) => {
    const src = a.slice();
    const n = horizontal ? W : RH;
    for (let line = 0; line < (horizontal ? H : W * rows); line++) {
      const at = horizontal
        ? (t) => line * W + t
        : (t) => (Math.floor(line / W) * RH + t) * W + (line % W);
      let sum = 0;
      for (let t = -r; t <= r; t++) sum += t >= 0 && t < n ? src[at(t)] : 0;
      for (let t = 0; t < n; t++) {
        a[at(t)] = sum / (2 * r + 1);
        const add = t + r + 1;
        const sub = t - r;
        if (add < n) sum += src[at(add)];
        if (sub >= 0) sum -= src[at(sub)];
      }
    }
  };
  for (let k = 0; k < 2; k++) {
    blur(true, 2);
    blur(false, 2);
  }
  const data = new Uint8Array(W * H);
  for (let k = 0; k < data.length; k++) data[k] = Math.round(Math.min(1, a[k]) * 255);
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
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
//   member: メンバーの楽器（content.js の INSTRUMENTS のキー）。触れると、chip { x, z } に置いた
//     床のチップの真上に、そのメンバーの紹介をホログラムで映す（main.js・memberHolo.js・memberCard.js）。
//     チップは楽器の横・少し手前に置き、寄ったときに楽器とホログラムが横に並んで映るようにする。
//     chip.narrow { x, z }：縦長の画面でのチップの位置（楽器に narrow がないとき）
//   occluder: 周りの床と壁を暗くする強さ（ambientShade.js。大きな物の足元の暗がり）。[床, 壁] でも書ける
const FURNITURE = [
  // 部屋の中央・奥寄り（奥の壁から 1.6m）。モデルの正面は -z 向きなので 180° 回す
  { url: 'models/sofa.glb', x: 0, z: -D + 1.6, rotationY: Math.PI, width: 2.1, fabric: '#6e6a65', occluder: [0.6, 0.45] },
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
  {
    url: 'models/keyboard.glb', x: 1.9, z: -7.4, rotationY: Math.PI / 2, width: 1.25, mirror: true,
    // 縦長の画面（スマホ）では楽器が画面の外に出るので、鍵盤の手前の端の前に置き、目を鍵盤の側（右）へ少し回り込ませる
    member: 'keyboard', chip: { x: 1.0, z: -6.95, narrow: { x: 1.55, z: -6.5, turn: 0.4 } },
  },
  // 左奥のブラウン管のタワーに立てかけたギター（Gretsch の生成モデル。ピックガードのでっぱりは平らにしてある）。
  // 正面（+z）を部屋の手前へ向け、後ろへ傾けて、いちばん下の段のブラウン管にもたせかける
  {
    url: 'models/guitar-gretsch.glb', x: -1.39, z: -8.35, rotationY: 0.29, rotationX: -0.27, width: 0.45,
    mirror: { height: 0.3, strength: 0.3 },
    member: 'gretsch', chip: { x: -0.5, z: -7.75, narrow: { x: -1.15, z: -7.45 } },
    // 生成モデルの金属っぽさが強く、ボディがぎらつくので抑える
    tone: { metalness: 0, envMapIntensity: 0.15, minRoughness: 0.7 },
  },
  // 左の壁、コンクリートの棚の下に掛けたギター（HB の生成モデル）。正面を部屋へ向け、ヘッドの下を壁のハンガーで支える。
  // 縦長の画面（スマホ）では左の壁の下の方が映らないので、左のタワーの左寄りに、Gretsch と角度を変えて立てかける
  {
    url: 'models/guitar-hb.glb', x: -W / 2 + 0.065, z: -7.85, rotationY: Math.PI / 2, width: 0.4, wall: { y: 0.22 },
    // turn：寄ったときに目を右へ回り込ませる量（窓の半幅に対する割合）。壁に掛けて横を向いたギターを正面寄りから見る
    member: 'hb', chip: { x: -2.0, z: -7.4, turn: 0.85 },
    narrow: {
      x: -1.95, z: -7.9, rotationY: 0.85, rotationX: -0.24, rotationZ: -0.07, wall: null, mirror: { height: 0.3, strength: 0.3 },
      chip: { x: -1.65, z: -7.05, turn: 0.45 },
    },
  },
  // HB の前の床に置いたエフェクターボード（生成モデル）。踏む側（モデルの +z）を部屋の内側へ向け、斜めに置く。
  // モデルは奥の脚が長いので、手前へ 11° 傾けて、手前の辺と奥の脚の両方を床に付ける。
  // 縦長の画面では、タワーに立てかけた HB の前に置く
  {
    url: 'models/pedalboard.glb', x: -2.5, z: -7.8, rotationY: Math.PI / 2 - 0.5, rotationX: 0.19, width: 0.6, sink: 0.02,
    mirror: { height: 0.15, strength: 0.3 },
    narrow: { x: -1.8, z: -7.3, rotationY: 0.8 },
  },
  // エフェクターボードの奥の床に置いたワウペダル（白い生成モデル。モデルの +z がかかと側）
  {
    url: 'models/wah.glb', x: -2.25, z: -8.5, rotationY: Math.PI / 2 - 0.3, width: 0.11, sink: 0.002,
    mirror: { height: 0.08, strength: 0.3 },
    narrow: { x: -1.52, z: -7.75, rotationY: 0.6 },
  },
  // 右奥のブラウン管のタワー（キーボードの奥）の、いちばん下の段に立てかけたベース（白いジャズベースの生成モデル）。
  // Gretsch とは向きを変え、左へ大きく振って、少しひねって立てかける
  {
    url: 'models/bass-white.glb', x: 1.7, z: -8.36, rotationY: -0.75, rotationX: -0.33, rotationZ: 0.05, width: 0.415,
    mirror: { height: 0.3, strength: 0.3 },
    // 縦長の画面では、ベースの左前に置き、目をベースの正面の側（左）へ少し回り込ませる
    member: 'bass', chip: { x: 0.85, z: -7.85, narrow: { x: 1.35, z: -7.6, turn: -0.35 } },
  },
  // 宙に浮かぶロボットの頭（Lavvy robot）
  { url: 'models/robot.glb', x: -0.8, z: -D + 4.3, rotationY: 0.35, width: 0.42, float: 2.4, wander: true },
];

async function loadFurniture(manager) {
  const loader = gltfLoader(manager);
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
        if (item.tone) {
          const { minRoughness, ...props } = item.tone;
          Object.assign(obj.material, props);
          // minRoughness: 艶の強い所（roughness の小さい所）も、これより鈍くする（光の照り返しを広く弱く）
          if (minRoughness) {
            obj.material.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, ${minRoughness.toFixed(3)});`,
              );
            };
            obj.material.customProgramCacheKey = () => `minRough${minRoughness}`;
          }
        }
      });
      if (item.screen) addCrtScreen(model, item.screen);
      // 幅を実寸に合わせ、床（y = 0）に接地させる
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(item.width / size.x);
      if (item.wander) return robotWander(model, item);
      if (item.float) return floating(model, item);
      if (!item.narrow) return place(model, item);
      // narrow: 縦長の画面では別の置き方にする。両方の置き方を作っておき、画面の縦横比で切り替える
      // 複製には材質も別に持たせる（映り込み mirror の仕掛けが、同じ材質に二重にかからないように）。
      // 置く前に複製する（材質の onBeforeCompile は複製されないので、tone の minRoughness は付け直さない）
      const copy = model.clone();
      copy.traverse((o) => {
        if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      });
      const wide = place(model, item);
      const tall = place(copy, { ...item, ...item.narrow });
      const both = new THREE.Group();
      both.add(wide, tall);
      both.userData.box = wide.userData.box;
      both.userData.member = item.member;
      // いま見えている方の置き方（ズームや光の出どころに使う）
      both.userData.shown = () => (wide.visible ? wide : tall);
      const fit = () => {
        const isTall = innerWidth / innerHeight < NARROW_ASPECT;
        wide.visible = !isTall;
        tall.visible = isTall;
      };
      fit();
      addEventListener('resize', fit);
      return both;
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

// 壁際の物が壁に落とす影の向き（光の進む向き）。窓（右）と天井から、手前寄りに差す光
const WALL_LIGHT = {
  left: new THREE.Vector3(-1, -0.75, -0.35),
  back: new THREE.Vector3(-0.55, -0.7, -1),
};

// この縦横比（横 / 縦）より縦長の画面では、FURNITURE の narrow の置き方を使う
const NARROW_ASPECT = 0.8;

// 大きさを合わせた家具を、傾け・向きを変えて床（または壁）に置き、影や映り込みを付ける
function place(model, item) {
  // 先に前後へ傾け（x）、それから向きを変える（y）。立てかける物が、向けた方へ傾くように
  // 位置は原点に戻してから測る（narrow 用に、置いた後のモデルを複製して渡すことがある）
  model.position.set(0, 0, 0);
  model.rotation.set(item.rotationX ?? 0, item.rotationY ?? 0, item.rotationZ ?? 0, 'YXZ');
  model.updateMatrixWorld(true);
  const box = modelBox(model);
  // sink: 床に少し沈める（m）。脚やケーブルだけで接地して、本体が浮いて見える物向け
  model.position.set(item.x, (item.wall?.y ?? 0) - box.min.y - (item.sink ?? 0), item.z);

  const group = new THREE.Group();
  group.add(model);
  if (item.wall) {
    model.updateMatrixWorld(true);
    group.add(wallHanger(modelBox(model)));
    // 壁に落ちる影（ギターとハンガーの形に沿って）
    group.add(wallShadow(group, { wall: 'x', at: -W / 2, light: WALL_LIGHT.left }));
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
  if (item.member && item.chip) {
    const chip = memberChip();
    // chip.narrow: 縦長の画面では別の所に置く（縦長の置き方で動く物と重ならないように）
    const put = () => {
      const at = item.chip.narrow && innerWidth / innerHeight < NARROW_ASPECT ? item.chip.narrow : item.chip;
      chip.position.set(at.x, 0, at.z);
      // チップの光の出る向き（楽器の方を少し向く）
      chip.rotation.y = Math.atan2(item.x - at.x, item.z - at.z);
      chip.userData.turn = at.turn ?? 0;
    };
    put();
    if (item.chip.narrow) addEventListener('resize', put);
    group.add(chip);
    group.userData.member = item.member;
    group.userData.chip = chip;
    group.userData.instrumentAt = new THREE.Vector3(item.x, 0, item.z); // 楽器を置いた所（寄るときの画面の寄せ先）
  }
  // 置いた後の位置で測り直す（box は動かす前の座標）。on で上に載せるときに使う
  model.updateMatrixWorld(true);
  group.userData.box = modelBox(model);
  return group;
}

// メンバーの紹介を映すチップ。床に置いた黒い円盤で、上面の輪とレンズが青く光る。
// 触れていない間はゆっくり明滅して、押せることを知らせる。setGlow(0〜1) で映している間の明るさ
function memberChip() {
  const chip = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.06, 0.018, 40),
    // 艶のある上塗りで、部屋の明かりが本体に映り込む
    new THREE.MeshPhysicalMaterial({ color: '#16181c', metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }),
  );
  body.position.y = 0.009;
  body.castShadow = true;
  body.receiveShadow = true;
  const glowMat = (opacity) =>
    new THREE.MeshBasicMaterial({ color: '#7cc4ff', transparent: true, opacity, toneMapped: false, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.036, 0.044, 48), glowMat(0.5));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0185;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 32), glowMat(0.7));
  lens.rotation.x = -Math.PI / 2;
  lens.position.y = 0.019;
  // ホバーの発光は本体だけ（輪とレンズは自分で光らせる）
  ring.userData.noHighlight = lens.userData.noHighlight = true;
  const emitter = new THREE.Object3D();
  emitter.position.y = 0.022;
  // 接地の影：本体の真下とその周りに溜まる暗がり
  const { shadow: shadowTex, light: lightTex } = chipFloorTextures();
  const floorPlane = (map, size, opts) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, ...opts }),
    );
    m.rotation.x = -Math.PI / 2;
    m.userData.noPick = m.userData.noHighlight = true;
    return m;
  };
  const shadow = floorPlane(shadowTex, 0.2, { opacity: 0.85 });
  shadow.position.y = 0.0012;
  // 床への映り込み：輪の青い光が艶のある床に映ってにじむ（明滅と映している間の明るさに合わせる）
  const light = floorPlane(lightTex, 0.36, { color: '#5aa8ff', blending: THREE.AdditiveBlending, opacity: 0 });
  light.position.y = 0.0016;
  chip.add(shadow, light, body, ring, lens, emitter);
  let glow = 0;
  chip.userData.emitter = emitter;
  chip.userData.setGlow = (a) => (glow = a);
  chip.userData.update = (t) => {
    const idle = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
    ring.material.opacity = Math.min(1, idle + glow * 0.65);
    lens.material.opacity = Math.min(1, 0.5 + glow * 0.5);
    lens.material.color.setRGB(0.49 + glow * 0.4, 0.77 + glow * 0.2, 1);
    light.material.opacity = Math.min(1, 0.8 * idle + 0.6 * glow);
  };
  return chip;
}

// チップの床の影と光の映り込みの画像（全チップで共有）
let chipFloor;
function chipFloorTextures() {
  if (chipFloor) return chipFloor;
  const size = 128;
  const make = (paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    paint(canvas.getContext('2d'), size / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  chipFloor = {
    // 板 0.2m のうち、本体（半径 0.06m）の縁まで濃く、その外へやわらかく消える
    shadow: make((ctx, r) => {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.75, 'rgba(0,0,0,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }),
    // 板 0.36m。本体の縁のすぐ外がいちばん明るく、外へ広がって消える輪（本体の下は影の上なので暗いまま）
    light: make((ctx, r) => {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.38, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }),
  };
  return chipFloor;
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
    concreteAlbedo: ['concrete_albedo.webp', true],
    concreteNormal: ['concrete_normal.webp'],
    concreteRough: ['concrete_roughness.webp'],
    woodAlbedo: ['wood_albedo.webp', true],
    woodNormal: ['wood_normal.webp'],
    woodRough: ['wood_roughness.webp'],
    shelfAlbedo: ['shelf_albedo.webp', true],
    shelfNormal: ['shelf_normal.webp'],
    shelfRough: ['shelf_roughness.webp'],
    shutterAlbedo: ['shutter_albedo.webp', true],
    shutterRough: ['shutter_roughness.webp'],
    pavingAlbedo: ['paving_albedo.webp', true],
    pavingNormal: ['paving_normal.webp'],
    pavingRough: ['paving_roughness.webp'],
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, [name, srgb]]) => [key, await load(name, srgb)]),
  );
  const textures = Object.fromEntries(entries);
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
