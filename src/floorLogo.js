import * as THREE from 'three';
import { MIRROR_REFRESH } from './floorMirror.js';
import { gltfLoader } from './gltf.js';

// 左手前の床に置いた、立体の QUIMAGLET。
// 文字は public/models/logo-letters.glb（Inter Black を Blender で 1 文字ずつ立体にし、縁を小さく丸めたもの。
// 文字の高さ ≒ 0.5、底 y = 0、前面 +z、左右・前後の中心が原点）。
// 大きさはそろえ、横は詰めて、前後と向きを大きく不揃いにして床に並べる。
// 質感は少し艶のある白の塗装。ところどころに小さなへこみがある。
// 部屋になじむよう、少しくすんだ白にし、足元に埃のくすみ、角に小さな塗装の剥げ、
// 床との接地の柔らかい影、艶のある床へのぼんやりした映り込みを足す

const LOGO = {
  height: 0.26, // 文字の高さ（m）
  // 並べる場所：左手前の床。窓（画面）の面 z = -5 のあたり。x は 1 文字目の左端
  x: -2.38,
  z: -4.85,
  // 全体の向き。左手前の文字を画面の中央の目から斜めに見るので、単語ごと目の方へ向ける
  // （向けないと、文字の側面が見えて字間が空いたように見える）
  yaw: 0.5,
  color: '#e3dfd5', // 少しくすんだ、温かみのある白（純白だと部屋から浮く）
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
// 床への映り込み：文字の下のほうだけが、艶のある床にぼんやり映る
const MIRROR = {
  layer: 5, // 映り込みの描画で使うレイヤー（文字と照明だけを描く）
  size: 256, // 映り込みの画像の解像度（低めにしてぼかす）
  strength: 0.09, // 映り込みの濃さ
  fade: 0.1, // 文字の足元からこの高さ（m）までが映る
};

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
  const gltf = await gltfLoader(manager).loadAsync(`${import.meta.env.BASE_URL}models/logo-letters.glb`);
  const letters = [];
  gltf.scene.traverse((o) => o.isMesh && letters.push(o));
  letters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const { normal, rough } = dentTextures(mulberry32(5));
  const mirrorUniform = { value: 0 }; // 1 のとき映り込み用に描く（足元だけを残す）
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
      // 塗装の艶（控えめ）。へこみは艶の層にも出す
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
      clearcoatNormalMap: n,
      clearcoatNormalScale: new THREE.Vector2(0.4, 0.4),
      envMapIntensity: 0.8,
    });
    weather(mat, mirrorUniform);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.enable(MIRROR.layer);
    mesh.add(contactShadow(geo, bb));
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
  word.add(floorReflection(length, mirrorUniform, word));

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

// 使い込んだ塗装：足元に埃のくすみ、角（面取りの丸み）に小さな剥げ。
// どちらも文字のモデルの座標（高さ 0〜0.5）で決めるので、大きさを変えても同じ見え方になる
function weather(mat, mirrorUniform) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMirror = mirrorUniform;
    shader.uniforms.uFade = { value: MIRROR.fade };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObj;
varying vec3 vObjN;
varying float vWorldY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vObj = position;
vObjN = normal;
vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObj;
varying vec3 vObjN;
varying float vWorldY;
uniform float uMirror;
uniform float uFade;
float wHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 271.3))) * 43758.5453); }
float wNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float wDirt;
float wChip;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float n = wNoise(vObj * 38.0) * 0.6 + wNoise(vObj * 9.0) * 0.4;
  // 足元のくすみ：床から 6cm ほど、まだらに。床に触れるところはもう少し濃く
  wDirt = (1.0 - smoothstep(0.0, 0.13, vObj.y)) * smoothstep(0.25, 0.75, n);
  wDirt += (1.0 - smoothstep(0.0, 0.03, vObj.y)) * 0.5;
  wDirt = clamp(wDirt, 0.0, 1.0);
  // 角の剥げ：正面・背面と側面のあいだの丸み（法線が斜め）にだけ、ごく小さく
  float az = abs(vObjN.z);
  float edge = smoothstep(0.12, 0.3, az) * (1.0 - smoothstep(0.85, 0.97, az));
  wChip = edge * smoothstep(0.66, 0.74, wNoise(vObj * 70.0 + 3.1));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.68, 0.6), wDirt * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.35, 0.33), wChip * 0.85);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.75, max(wDirt * 0.7, wChip));`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
material.clearcoat *= 1.0 - max(wDirt * 0.8, wChip);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
if (uMirror > 0.5) {
  // 映り込み用：足元ほど濃く、上は消える（艶のある床では足元だけがはっきり映る）
  float f = 1.0 - clamp(vWorldY / uFade, 0.0, 1.0);
  f *= f;
  gl_FragColor = vec4(gl_FragColor.rgb * f, f);
}`,
      );
  };
}

// 接地の影：文字の底の形を上から見た、柔らかい暗がり（直射日光の影とは別に、床との境目に溜まる）。
// 文字の中（モデルの座標）に置くので、向き・大きさに合わせて付いてくる
function contactShadow(geo, bb) {
  const m = 0.14; // 底の形のまわりに広げる余白（モデルの座標）
  const ppu = 220; // 1 単位あたりの画素数
  const x0 = bb.min.x - m;
  const z0 = bb.min.z - m;
  const w = bb.max.x - bb.min.x + m * 2;
  const d = bb.max.z - bb.min.z + m * 2;
  const W = Math.ceil(w * ppu);
  const H = Math.ceil(d * ppu);
  const foot = new Float32Array(W * H);

  // 床に触れている三角形（3 頂点とも低い）を上から見て塗る
  const pos = geo.attributes.position;
  const idx = geo.index;
  const tri = (idx ? idx.count : pos.count) / 3;
  const v = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < tri; t++) {
    const a = v(t * 3);
    const b = v(t * 3 + 1);
    const c = v(t * 3 + 2);
    if (pos.getY(a) > 0.02 || pos.getY(b) > 0.02 || pos.getY(c) > 0.02) continue;
    fillTri(
      foot,
      W,
      H,
      [(pos.getX(a) - x0) * ppu, (pos.getZ(a) - z0) * ppu],
      [(pos.getX(b) - x0) * ppu, (pos.getZ(b) - z0) * ppu],
      [(pos.getX(c) - x0) * ppu, (pos.getZ(c) - z0) * ppu],
    );
  }
  // 境目に溜まる濃い暗がり（細いぼかし）と、少し広がる薄い暗がり（太いぼかし）を重ねる
  const near = blur(foot, W, H, 3);
  const far = blur(foot, W, H, 14);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4 + 3] = Math.min(1, near[i] * 1.2 + far[i] * 2.2) * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: tex,
      color: '#000000',
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  // 板の +y（画像の上）が奥（-z）に向くよう寝かせる。画像の上の行 = z0
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x0 + w / 2, 0.004, z0 + d / 2);
  plane.renderOrder = 1;
  plane.userData.noPick = true;
  return plane;
}

function fillTri(out, W, H, p, q, r) {
  const minX = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0])));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0], q[0], r[0])));
  const minY = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1])));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
  const e = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const area = e(p, q, r[0], r[1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = e(q, r, x + 0.5, y + 0.5) / area;
      const w1 = e(r, p, x + 0.5, y + 0.5) / area;
      const w2 = e(p, q, x + 0.5, y + 0.5) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) out[y * W + x] = 1;
    }
  }
}

// 箱ぼかし 3 回（ガウスぼかしの近似）
function blur(src, W, H, r) {
  const a = Float32Array.from(src);
  const b = new Float32Array(W * H);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[y * W + Math.min(W - 1, Math.max(0, x + k))];
        b[y * W + x] = s / (2 * r + 1);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += b[Math.min(H - 1, Math.max(0, y + k)) * W + x];
        a[y * W + x] = s / (2 * r + 1);
      }
    }
  }
  return a;
}

// 床への映り込み。床に寝かせた板に、床で鏡映しにした目から文字（足元だけ）を描いた画像を貼る。
// 文字と照明だけを描くので軽い。画像は低い解像度で描き、さらにぼかして、艶のある木の床らしくする
function floorReflection(length, mirrorUniform, word) {
  const rt = new THREE.WebGLRenderTarget(MIRROR.size, MIRROR.size, { type: THREE.HalfFloatType });
  const virtual = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  virtual.layers.set(MIRROR.layer);
  const textureMatrix = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const w = length + 0.5;
  const zBack = -0.35;
  const zFront = 0.7;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, zFront - zBack),
    new THREE.ShaderMaterial({
      uniforms: {
        tMirror: { value: rt.texture },
        textureMatrix: { value: textureMatrix },
        strength: { value: MIRROR.strength },
        texel: { value: 1 / MIRROR.size },
      },
      vertexShader: `
uniform mat4 textureMatrix;
varying vec4 vCoord;
varying vec2 vUv;
void main() {
  vUv = uv;
  vCoord = textureMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform sampler2D tMirror;
uniform float strength;
uniform float texel;
varying vec4 vCoord;
varying vec2 vUv;
void main() {
  vec2 uv = vCoord.xy / vCoord.w;
  vec4 c = vec4(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float k = exp(-float(x * x + y * y) / 3.0);
      c += texture2D(tMirror, uv + vec2(float(x), float(y)) * texel * 1.5) * k;
      wsum += k;
    }
  }
  c /= wsum;
  // 板の縁で消す
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  gl_FragColor = c * strength * edge;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(length / 2, 0.005, (zBack + zFront) / 2);
  plane.renderOrder = 2;
  plane.userData.noPick = true;

  const eye = new THREE.Vector3();
  const center = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const corners = [
    [-w / 2, zBack],
    [w / 2, zBack],
    [-w / 2, zFront],
    [w / 2, zFront],
  ];
  const clear = new THREE.Color();
  let frame = 0;
  const lastEye = new THREE.Vector3(Infinity, 0, 0);
  plane.userData.mirror = true; // 周囲を撮るとき（main.js の captureEnvironment）は隠す
  plane.onBeforeRender = (renderer, scene, camera) => {
    // 照明も映り込みの描画に入れる（照明が増えたときのため、ときどき数え直す）
    if (frame++ % 120 === 0) scene.traverse((o) => o.isLight && o.layers.enable(MIRROR.layer));
    // 目が止まっている間は前の絵を使う（映る物は動かない）。光の変わり目（雷・天気）は
    // REFRESH フレームごとの描き直しで追いつく
    camera.getWorldPosition(eye);
    if (eye.distanceToSquared(lastEye) < 1e-10 && frame % MIRROR_REFRESH !== 0) return;
    lastEye.copy(eye);
    // 床（y = 0）で鏡映しにした目から、板の中心を見る。板全体が入る画角にする
    camera.getWorldPosition(eye);
    virtual.position.set(eye.x, -eye.y, eye.z);
    word.localToWorld(center.set(length / 2, 0, (zBack + zFront) / 2));
    virtual.up.set(0, 1, 0);
    virtual.lookAt(center);
    virtual.updateMatrixWorld();
    let tx = 0;
    let ty = 0;
    for (const [x, z] of corners) {
      word.localToWorld(corner.set(length / 2 + x, 0, z));
      corner.applyMatrix4(virtual.matrixWorldInverse);
      const dz = Math.max(0.01, -corner.z);
      tx = Math.max(tx, Math.abs(corner.x / dz));
      ty = Math.max(ty, Math.abs(corner.y / dz));
    }
    const hy = ty * 1.15 + 0.02;
    const hx = tx * 1.15 + 0.02;
    virtual.fov = THREE.MathUtils.radToDeg(2 * Math.atan(hy));
    virtual.aspect = hx / hy;
    virtual.updateProjectionMatrix();
    textureMatrix.copy(bias).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    const prevBg = scene.background;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    mirrorUniform.value = 1;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, virtual);
    mirrorUniform.value = 0;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
    scene.background = prevBg;
  };
  return plane;
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
