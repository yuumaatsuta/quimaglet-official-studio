import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 左手前の床に置いた、立体の QUIMAGLET。
// 文字は public/models/logo-letters.glb（Inter Black を Blender で 1 文字ずつ立体にし、縁を小さく丸めたもの。
// 文字の高さ ≒ 0.5、底 y = 0、前面 +z、左右・前後の中心が原点）。
// 大きさはそろえ、横は詰めて、前後と向きを大きく不揃いにして床に並べる。
// 質感は少し艶のある白の塗装。ところどころに小さなへこみがある

const LOGO = {
  height: 0.26, // 文字の高さ（m）
  // 並べる場所：左手前の床。窓（画面）の面 z = -5 のあたり。x は 1 文字目の左端
  x: -2.38,
  z: -4.85,
  // 全体の向き。左手前の文字を画面の中央の目から斜めに見るので、単語ごと目の方へ向ける
  // （向けないと、文字の側面が見えて字間が空いたように見える）
  yaw: 0.5,
  color: '#f2f1ed', // 少し温かみのある白
  gap: 0.0, // 標準の字間（m）。前後にずらすので、横は詰めて並べる
};

// 縦長の画面（スマホ）での置き方。窓が細く、横長と同じ置き方だと中央のブラウン管に重なるので、
// もっと手前の床で、画面の左端から右奥へ斜めに流し（前後で文字が重なる）、左に寄せる
const PORTRAIT = {
  front: 0.45, // 窓の面から目までの何割ぶん手前に置くか（手前ほど画面の下に見える）
  yaw: 0.4, // 単語の流れる向き（大きいほど奥へ向かう）
  left: -0.9, // 単語の左端の画面上の位置（-1 = 左端）
  right: 0.55, // 単語の右端がここ（画面の左右 -1〜1）を越えない大きさに縮める
};

// 1 文字ずつの置き方。横は詰め、前後と向きを大きく不揃いにして、床に無造作に並べた感じにする。
//   yaw: 向き（rad）/ dz: 前後（m、正で手前）/ gap: 字間の増減（m）/ lean: 傾き（rad、正で左へ）
const PLACE = [
  { yaw: -0.22, dz: 0.05, gap: 0.0, lean: 0 }, // Q
  { yaw: 0.16, dz: -0.1, gap: 0.02, lean: 0 }, // U
  { yaw: 0.0, dz: 0.03, gap: 0.03, lean: 0 }, // I（まっすぐ正面を向ける。細いので両隣と重ならないよう少し空ける）
  { yaw: -0.12, dz: -0.05, gap: -0.012, lean: 0 }, // M
  { yaw: 0.24, dz: 0.14, gap: 0.0, lean: 0 }, // A
  { yaw: -0.3, dz: -0.12, gap: -0.008, lean: 0 }, // G
  { yaw: 0.1, dz: 0.03, gap: -0.01, lean: 0 }, // L
  { yaw: -0.2, dz: -0.08, gap: 0.0, lean: 0 }, // E
  { yaw: 0.36, dz: 0.09, gap: 0.004, lean: 0 }, // T
];

export async function buildFloorLogo(manager) {
  const gltf = await new GLTFLoader(manager).loadAsync(`${import.meta.env.BASE_URL}models/logo-letters.glb`);
  const letters = [];
  gltf.scene.traverse((o) => o.isMesh && letters.push(o));
  letters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const { normal, rough } = dentTextures(mulberry32(5));
  const rand = mulberry32(9);
  const group = new THREE.Group();
  const word = new THREE.Group(); // 単語 1 つ分。画面の形に合わせて、まとめて置き直す
  group.add(word);
  const s = LOGO.height / 0.495; // モデルの文字の高さ（I・M など）を LOGO.height に
  let cursor = 0;

  letters.forEach((src, i) => {
    const p = PLACE[i] ?? PLACE[0];
    const geo = src.geometry.clone();
    addBoxUV(geo);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const w = (bb.max.x - bb.min.x) * s;
    const depth = (bb.max.z - bb.min.z) * s;

    // 文字ごとに、へこみの位置が違うよう模様をずらす
    const n = normal.clone();
    const r = rough.clone();
    const offset = new THREE.Vector2(rand(), rand());
    const rotation = rand() * Math.PI * 2;
    for (const t of [n, r]) {
      t.offset.copy(offset);
      t.rotation = rotation;
      t.needsUpdate = true;
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: LOGO.color,
      roughness: 1, // roughnessMap（0.18〜0.3 ほど）をそのまま使う
      roughnessMap: r,
      metalness: 0,
      normalMap: n,
      normalScale: new THREE.Vector2(0.4, 0.4),
      // 塗装の艶。へこみは艶の層にも出す
      clearcoat: 0.55,
      clearcoatRoughness: 0.12,
      clearcoatNormalMap: n,
      clearcoatNormalScale: new THREE.Vector2(0.4, 0.4),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(s);

    // もたれる文字は、倒れる側の底の角を支点に傾ける（床に沈まない・浮かない）
    const pivot = new THREE.Group();
    const half = ((bb.max.x - bb.min.x) / 2) * s;
    const side = p.lean > 0 ? -1 : 1; // 正（左へ傾く）なら左下の角が支点
    if (p.lean) {
      pivot.position.x = side * half;
      mesh.position.x = -side * half;
      pivot.rotation.z = p.lean;
    }
    pivot.add(mesh);

    const letter = new THREE.Group();
    letter.add(pivot);
    letter.rotation.y = p.yaw;

    // 単語の中での位置（単語の向きに沿って x、正面へ z）。全体の位置・向き・大きさは下の update で決める
    // 向きを崩した文字の、正面から見た幅で並べる（回転前の幅だと、すき間が空いて単語が切れて見える）
    const span = w * Math.abs(Math.cos(p.yaw)) + depth * Math.abs(Math.sin(p.yaw));
    // 前後のずれは単語の正面（目に向かう向き）にかける。真後ろにずらすと、斜めから見て横にずれて見える
    letter.position.set(cursor + span / 2, 0, p.dz);
    cursor += span + LOGO.gap + p.gap;
    word.add(letter);
  });
  const length = cursor;

  // 画面の形に合わせて置き直す（横長はそのまま、縦長は手前・斜め・左寄せ）
  let lastKey = null;
  group.userData.update = (t, view) => {
    const win = view?.win;
    const eye = view?.eye;
    if (!win || !eye) return;
    const key = `${win.halfW.toFixed(4)},${win.halfH.toFixed(4)}`;
    if (key === lastKey) return;
    lastKey = key;
    if (win.halfW >= win.halfH) {
      // 横長：いつもの場所。ただし横に長い画面では窓の縦が狭く、手前の床が画面の下に切れるので、
      // 文字の足元が画面の下端より上に、左端の Q が画面の左端より内側に見えるまで奥へずらす
      const toWinL = (z) => (eye.z - win.cz) / (eye.z - z);
      const p = new THREE.Vector3();
      const fits = (dz) => {
        const z = LOGO.z - dz;
        const x = Math.max(LOGO.x, eye.x + (win.cx - 0.9 * win.halfW - eye.x) / toWinL(z));
        word.position.set(x, 0, z);
        word.rotation.y = LOGO.yaw;
        word.scale.setScalar(1);
        word.updateMatrix();
        for (const letter of word.children) {
          p.copy(letter.position).applyMatrix4(word.matrix);
          const ndcY = (eye.y + (p.y - eye.y) * toWinL(p.z) - win.cy) / win.halfH;
          if (ndcY < -0.8) return false;
        }
        return true;
      };
      if (!fits(0)) {
        let lo = 0;
        let hi = 4;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) hi = mid;
          else lo = mid;
        }
        fits(hi);
      }
      return;
    }
    // 窓の面から目の距離に対する比で、ある深さ z の点が画面のどこに見えるかを出す
    const toWin = (z) => (eye.z - win.cz) / (eye.z - z);
    const ndcX = (x, z) => (eye.x + (x - eye.x) * toWin(z) - win.cx) / win.halfW;
    const z0 = win.cz + (eye.z - win.cz) * PORTRAIT.front;
    const x0 = eye.x + (win.cx + PORTRAIT.left * win.halfW - eye.x) / toWin(z0);
    const dir = { x: Math.cos(PORTRAIT.yaw), z: -Math.sin(PORTRAIT.yaw) };
    // 右端が PORTRAIT.right に収まる大きさを二分探索で探す
    let lo = 0.1;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      const end = ndcX(x0 + dir.x * length * mid, z0 + dir.z * length * mid);
      if (end <= PORTRAIT.right) lo = mid;
      else hi = mid;
    }
    word.position.set(x0, 0, z0);
    word.rotation.y = PORTRAIT.yaw;
    word.scale.setScalar(lo);
  };

  return group;
}

// 文字のモデルには UV がないので、面の向きごとに平らに投影して付ける（へこみの模様を貼るため）
function addBoxUV(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / 0.9; // 模様 1 枚が文字の高さのおよそ 2 倍
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (az >= ax && az >= ay) [u, v] = [x, y];
    else if (ax >= ay) [u, v] = [z + 0.37, y];
    else [u, v] = [x, z + 0.61];
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// へこみの模様：法線マップ（小さな浅いくぼみがまばらに）と、艶のむら（くぼみの中や、うっすらした擦れで少し曇る）
function dentTextures(rand) {
  const N = 512;
  const height = new Float32Array(N * N);
  const dents = 3; // 文字ごとに模様の位置をずらすので、見えるのは 1 文字に 0〜2 個ほど
  for (let d = 0; d < dents; d++) {
    const cx = rand() * N;
    const cy = rand() * N;
    const r = 6 + rand() ** 2 * 26; // ほとんどは小さく、たまに大きめ
    const depth = 0.3 + rand() * 0.4;
    const sx = 0.6 + rand() * 0.8; // 少し楕円に
    for (let y = Math.floor(cy - r * 2); y < cy + r * 2; y++) {
      for (let x = Math.floor(cx - r * 2); x < cx + r * 2; x++) {
        const dx = ((x - cx) / r) * sx;
        const dy = (y - cy) / r;
        const q = dx * dx + dy * dy;
        if (q > 4) continue;
        const xi = ((x % N) + N) % N;
        const yi = ((y % N) + N) % N;
        height[yi * N + xi] -= depth * Math.exp(-q * 1.6);
      }
    }
  }
  // ごく細かい凹凸（塗装の肌）
  for (let i = 0; i < height.length; i++) height[i] += (rand() - 0.5) * 0.015;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = normalCanvas.height = N;
  const nctx = normalCanvas.getContext('2d');
  const nimg = nctx.createImageData(N, N);
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = roughCanvas.height = N;
  const rctx = roughCanvas.getContext('2d');
  const rimg = rctx.createImageData(N, N);
  const at = (x, y) => height[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  const strength = 6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 3] = 255;
      // 艶：基本 0.18、くぼみの中と、ゆるい擦れのむらで少し曇らせる
      const smudge = 0.5 + 0.5 * Math.sin(x * 0.021 + Math.sin(y * 0.013) * 2) * Math.sin(y * 0.017 + 1.3);
      const g = Math.min(1, 0.18 + Math.max(0, -at(x, y)) * 0.12 + smudge * 0.06) * 255;
      rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = g;
      rimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const make = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  return { normal: make(normalCanvas), rough: make(roughCanvas) };
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
