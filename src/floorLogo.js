import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// 左手前の床に置いた、立体の QUIMAGLET（白い文字の縁を LED が光る）。
// 文字は public/models/logo-letters.glb（Inter Black を Blender で 1 文字ずつ立体にしたもの。
// 文字の高さ ≒ 0.5、底 y = 0、前面 +z、左右・前後の中心が原点）。
// 読める並びのまま、1 文字ずつ向き・傾き・前後・大きさを少しずつ崩して、置いただけのような感じにする

const LOGO = {
  height: 0.21, // 文字の高さ（m）
  // 並べる場所：左手前の床。窓（画面）の面 z = -5 のあたり。x は 1 文字目の左端
  x: -2.38,
  z: -4.85,
  // 全体の向き。左手前の文字を画面の中央の目から斜めに見るので、単語ごと目の方へ向ける
  // （向けないと、文字の側面が見えて字間が空いたように見える）
  yaw: 0.5,
  led: '#5cc8ff', // LED の色
  body: '#f4f4f2', // 文字の白
};

// 1 文字ずつの崩し（向き rad・前後 m・字間 m・大きさ・左右の傾き rad）
const JITTER = [
  { yaw: -0.22, dz: 0.03, gap: 0.0, scale: 1.08, lean: 0.0 }, // Q
  { yaw: 0.12, dz: -0.08, gap: 0.03, scale: 0.94, lean: 0.0 }, // U
  { yaw: 0.35, dz: 0.1, gap: 0.05, scale: 1.0, lean: 0.07 }, // I（少し傾いて立つ）
  { yaw: -0.08, dz: -0.04, gap: 0.04, scale: 1.12, lean: 0.0 }, // M
  { yaw: 0.28, dz: 0.12, gap: 0.0, scale: 0.96, lean: 0.0 }, // A
  { yaw: -0.3, dz: -0.1, gap: 0.05, scale: 1.04, lean: 0.0 }, // G
  { yaw: 0.18, dz: 0.06, gap: 0.02, scale: 0.9, lean: -0.05 }, // L
  { yaw: -0.15, dz: -0.02, gap: 0.05, scale: 1.0, lean: 0.0 }, // E
  { yaw: 0.4, dz: 0.14, gap: 0.03, scale: 1.06, lean: 0.0 }, // T
];

export async function buildFloorLogo(manager) {
  const gltf = await new GLTFLoader(manager).loadAsync(`${import.meta.env.BASE_URL}models/logo-letters.glb`);
  const letters = [];
  gltf.scene.traverse((o) => o.isMesh && letters.push(o));
  letters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: LOGO.body,
    roughness: 0.38,
    metalness: 0,
    // 暗い部屋でも白く見えるよう、ほんの少し自分で光らせる（縁の LED に照らされている感じ）
    emissive: '#dff2ff',
    emissiveIntensity: 0.16,
  });
  // LED：芯の細い線と、そのまわりのにじみ（太く薄い線を足し合わせる）
  const core = new LineMaterial({ color: new THREE.Color(LOGO.led).lerp(new THREE.Color('#ffffff'), 0.3), linewidth: 2.2, toneMapped: false });
  const halo = new LineMaterial({
    color: LOGO.led,
    linewidth: 9,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const lineMaterials = [core, halo];
  const setResolution = () => lineMaterials.forEach((m) => m.resolution.set(innerWidth, innerHeight));
  setResolution();
  addEventListener('resize', setResolution);

  const glowTexture = floorGlowTexture();
  const s = LOGO.height / 0.495; // モデルの文字の高さ（I・M など）を LOGO.height に
  const k = LOGO.height / 0.46; // 字間・前後のずれ（JITTER は高さ 0.46m のときの値）を大きさに合わせる
  let cursor = 0;
  letters.forEach((src, i) => {
    const j = JITTER[i] ?? JITTER[0];
    const geo = src.geometry.clone();
    geo.computeBoundingBox();
    const w = (geo.boundingBox.max.x - geo.boundingBox.min.x) * s * j.scale;
    const depth = (geo.boundingBox.max.z - geo.boundingBox.min.z) * s * j.scale;
    // 向きを崩した文字の、正面から見た幅（回転前の幅で並べると、すき間が空いて単語が切れて見える）
    const span = w * Math.abs(Math.cos(j.yaw)) + depth * Math.abs(Math.sin(j.yaw));

    const letter = new THREE.Group();
    const mesh = new THREE.Mesh(geo, body);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 角の辺だけ（曲面の細かい辺は拾わない）を LED にする
    const edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 28));
    const coreLine = new LineSegments2(edges, core);
    const haloLine = new LineSegments2(edges, halo);
    for (const l of [coreLine, haloLine]) l.userData.noPick = true;
    letter.add(mesh, coreLine, haloLine);
    letter.scale.setScalar(s * j.scale);

    // 傾けて立てるときは、底の片側の角を支点にする（床に沈まないよう、傾けた分だけ持ち上げる）
    const half = (geo.boundingBox.max.x - geo.boundingBox.min.x) / 2;
    const lift = Math.abs(Math.sin(j.lean)) * half * s * j.scale;
    letter.rotation.set(0, LOGO.yaw + j.yaw, j.lean);

    const along = cursor + span / 2;
    // 前後のずらし dz は、目に向かう向き（単語の正面）にかける。真後ろにずらすと、
    // 斜めから見たときに文字が横へずれて、字間が空いたり重なったりして見える
    const dz = j.dz * k;
    letter.position.set(
      LOGO.x + Math.cos(LOGO.yaw) * along + Math.sin(LOGO.yaw) * dz,
      lift,
      LOGO.z - Math.sin(LOGO.yaw) * along + Math.cos(LOGO.yaw) * dz,
    );
    cursor += span + (0.02 + j.gap * 0.5) * k;
    group.add(letter);

    // 床に落ちる LED の青い照り返し
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.9, 0.55 * k),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        color: LOGO.led,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    glow.rotation.set(-Math.PI / 2, 0, LOGO.yaw + j.yaw);
    glow.position.set(letter.position.x, 0.003, letter.position.z);
    glow.userData.noPick = true;
    group.add(glow);
  });

  // 縦長の画面（スマホ）では窓が細く、左手前の文字が画面の外へはみ出す。
  // 単語の左端を画面の左端の少し内側に合わせ、それでも入らなければ縮める（横長の画面ではそのまま）
  const wordWidth = cursor * Math.cos(LOGO.yaw); // 左右の幅（m）
  const anchor = new THREE.Vector3(LOGO.x, 0, LOGO.z);
  let lastHalfW = null;
  group.userData.update = (t, view) => {
    const win = view?.win;
    if (!win || win.halfW === lastHalfW) return;
    lastHalfW = win.halfW;
    const left = Math.max(LOGO.x, win.cx - win.halfW * 0.9);
    const fit = Math.min(1, (win.cx + win.halfW * 0.9 - left) / wordWidth);
    group.scale.setScalar(fit);
    group.position.set(left, 0, anchor.z).sub(anchor.clone().multiplyScalar(fit));
  };

  return group;
}

function floorGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
