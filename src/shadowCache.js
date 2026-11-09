import * as THREE from 'three';
import { nextTask } from './nextTask.js';

// 日差しの影（影の地図）を、影を落とす物が動いたときだけ描き直す。
// 部屋の家具やブラウン管はほとんど動かないので、ふだんは前に描いた影をそのまま使う（毎フレーム約 100 万枚の三角形を描かずに済む）。
// 影を落とす物の位置・向き・見え方が変わったフレームと、影を落とす光が点いた・消えたフレームだけ描き直す。
// いつも揺れている物（ロボット）は影の地図に入れず、sunBlob.js の軽い影を付ける
export function createShadowCache(renderer, scene) {
  const shadowMap = renderer.shadowMap;
  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = true;

  let casters = [];
  let matrices = new Float64Array(0);
  let shown = new Uint8Array(0);
  const lightState = new Map(); // 影を落とす光 → 点いているか
  let frame = 0;
  // 動き続けている間（シャッターの開け閉めなど）は、描き直しを 1 秒に 15 回までにする。止まったら最後の形を必ず描く
  const MIN_GAP = 1000 / 15;
  let lastDraw = -Infinity;
  let pending = false;

  const visibleInTree = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  function collect() {
    const list = [];
    scene.traverse((o) => {
      if (o.isMesh && o.castShadow) list.push(o);
    });
    if (list.length === casters.length && list.every((o, i) => o === casters[i])) return;
    casters = list;
    matrices = new Float64Array(list.length * 16);
    shown = new Uint8Array(list.length);
    shadowMap.needsUpdate = true;
  }

  return {
    // 描く直前に呼ぶ（main.js のループ）
    update() {
      // 増えた・消えた物を、ときどき数え直す
      if (frame++ % 60 === 0) collect();
      scene.updateMatrixWorld();
      let changed = false;
      for (let i = 0; i < casters.length; i++) {
        const o = casters[i];
        const v = visibleInTree(o) ? 1 : 0;
        if (v !== shown[i]) {
          shown[i] = v;
          changed = true;
        }
        if (!v) continue;
        const e = o.matrixWorld.elements;
        const base = i * 16;
        for (let k = 0; k < 16; k++) {
          if (matrices[base + k] !== e[k]) {
            matrices[base + k] = e[k];
            changed = true;
          }
        }
      }
      scene.traverseVisible((o) => {
        if (!o.isLight || !o.castShadow) return;
        if (!lightState.has(o)) changed = true;
        lightState.set(o, frame);
      });
      // 消えた光（見えなくなった光）が点き直したときにも描き直す
      for (const [light, seen] of lightState) {
        if (seen !== frame) {
          lightState.delete(light);
          changed = true;
        }
      }
      if (changed) pending = true;
      const now = performance.now();
      if (pending && (now - lastDraw >= MIN_GAP || !changed)) {
        shadowMap.needsUpdate = true;
        pending = false;
        lastDraw = now;
      }
    },
    // 外から描き直しを頼む（物を急に置き換えたときなど）
    invalidate() {
      shadowMap.needsUpdate = true;
    },
  };
}

// 組み立て中のシェーダーが全部できあがるまで待つ（GPU 側で並べて組み立てている間は、画面は止まらない）。
// compileAsync の待ち方は、待っている間に描いたフレームで「できている」と判定されてしまうことがあり、
// できる前のシェーダーで描いて画面が数秒止まっていた。ここでは renderer の全てのシェーダーを見て待つ
export function allReady(renderer) {
  return new Promise((resolve) => {
    const check = () => {
      if (renderer.info.programs.every((p) => p.isReady())) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

// めったに変わらない光（userData.gate に組の名前を付けた光。プラネタリウムの光、天井の蛍光灯）を、点いていない間は描く計算から外す。
// 光の数が変わると、全ての材質の描き方（シェーダー）を組み直すことになる。天気やシャッターで細かく明るさが変わる光まで外すと、
// 組み合わせごとに組み直しが起きて重くなる（起動直後に 80 本ほど組み立てていた）ので、外すのは決まった光だけにし、組ごとにまとめて切り替える。
// 切り替えるときは、画面に描く形と、画像に描く形（床の映り込み・周囲の撮影）の両方を裏で組み立て、全部できてから切り替える
//   targets: 画像に描くときの描き先（main.js の cubeTarget）
export function createLightGate(renderer, scene, camera, { offDelay = 1, targets = [] } = {}) {
  const groups = new Map(); // 組の名前 → { lights, shown, off }
  let busy = false;
  let frame = 0;

  function collect() {
    scene.traverse((o) => {
      const name = o.isLight && o.userData.gate;
      if (!name) return;
      if (!groups.has(name)) groups.set(name, { lights: new Set(), shown: true, off: 0 });
      groups.get(name).lights.add(o);
    });
  }
  const setAll = (g, v) => {
    for (const l of g.lights) l.visible = v;
  };
  // その組を visible にした形で、画面用・画像用・影用の描き方を組み立てる。
  // 物のまとまりごとに区切り、区切りの間（画面を描く間）は今の点き方に戻しておく
  async function compileWith(g, visible) {
    const around = () => {
      setAll(g, visible);
      return () => setAll(g, g.shown);
    };
    await compileSliced(renderer, scene, camera, { targets: [null, ...targets], around });
    const undo = around();
    compileShadows(renderer, scene, camera, targets[0] ?? null);
    undo();
  }
  function switchTo(g, visible) {
    busy = true;
    compileWith(g, visible)
      .then(() => allReady(renderer))
      .then(() => {
        g.shown = visible;
        setAll(g, visible);
        busy = false;
        g.off = 0;
        gate.onSwitch?.();
      });
  }

  const gate = {
    onSwitch: null, // 切り替えた後に呼ぶ（main.js：影を描き直す）
    // 起動時：全部 0 の組は先に外しておく（シェーダーを最初からその形で組み立てる）
    //   keep: すぐ点くとわかっている組（夜の月の光など）。今は 0 でも外さない
    prime(keep = []) {
      collect();
      for (const [name, g] of groups) {
        if (!keep.includes(name) && [...g.lights].every((l) => l.intensity <= 1e-4)) {
          g.shown = false;
          setAll(g, false);
        }
      }
    },
    // その組を点けた形の描き方を、裏で組み立てておく（夜になったときのプラネタリウムなど）
    prepare(name) {
      collect();
      const g = groups.get(name);
      if (!g || g.shown || busy) return;
      // できあがるまでは、ほかの切り替えをしない（裏の組み立てに、新しい組み立てを重ねない）
      busy = true;
      compileWith(g, true)
        .then(() => allReady(renderer))
        .then(() => (busy = false));
    },
    update(dt) {
      if (frame++ % 120 === 0) collect();
      if (busy) return;
      for (const g of groups.values()) {
        const want = [...g.lights].some((l) => l.intensity > 1e-4);
        if (want && !g.shown) return switchTo(g, true);
        if (!want && g.shown) {
          // しばらく 0 のままなら外す（ちらつきで点いたり消えたりするたびに組み直さないように）
          g.off += dt;
          if (g.off > offDelay) return switchTo(g, false);
        } else g.off = 0;
      }
    },
  };
  return gate;
}

// 日差しの当たっている所にだけ落ちる、ロボットのやわらかい影。
// ロボットからの日差しの向きの直線が、床・奥の壁・左の壁に当たる所に、ぼかした楕円を置く。
// 影の地図（getShadowMask：日なたで 1、日陰で 0）を読み、日なたにだけ濃く出す（窓枠の影や部屋の暗がりには出さない）
let blobTexture;
function softDisc() {
  if (blobTexture) return blobTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  blobTexture = new THREE.CanvasTexture(canvas);
  return blobTexture;
}

//   target: 影を落とす物、sun: 日差し（DirectionalLight）、radius: 影の半径（m）、
//   planes: 影を受ける面 [{ normal, constant }]（THREE.Plane。部屋の内側を向ける）、full: この明るさの日差しで一番濃くなる
export function sunBlob(target, sun, { radius, planes, strength = 0.5, full = 5.5 }) {
  const material = new THREE.ShadowMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const map = { value: softDisc() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blobMap = map;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBlobUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlobUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBlobUv;\nuniform sampler2D blobMap;')
      // ShadowMaterial は日陰を濃くする材質。逆に、日なたの所だけ濃くする
      .replace('opacity * ( 1.0 - getShadowMask() )', 'opacity * getShadowMask() * texture2D( blobMap, vBlobUv ).a');
  };
  material.customProgramCacheKey = () => 'sunBlob';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noPick = true;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;

  const toSun = new THREE.Vector3();
  const p = new THREE.Vector3();
  const hit = new THREE.Vector3();
  const along = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  mesh.userData.update = () => {
    const k = Math.min(1, sun.intensity / full);
    if (k <= 0.01 || !target.visible) {
      mesh.visible = false;
      return;
    }
    toSun.subVectors(sun.position, sun.target.position).normalize();
    target.getWorldPosition(p);
    // いちばん近くで当たる面
    let best = null;
    let bestT = Infinity;
    for (const plane of planes) {
      const facing = plane.normal.dot(toSun);
      if (facing <= 0.02) continue; // 日の当たらない向きの面
      const t = plane.distanceToPoint(p) / facing;
      if (t > 0 && t < bestT) {
        bestT = t;
        best = plane;
      }
    }
    if (!best) {
      mesh.visible = false;
      return;
    }
    const n = best.normal;
    hit.copy(p).addScaledVector(toSun, -bestT).addScaledVector(n, 0.004);
    // 面の上で、日差しの向きに伸ばす（斜めから当たるほど長い）
    const facing = n.dot(toSun);
    along.copy(toSun).addScaledVector(n, -facing);
    if (along.lengthSq() < 1e-6) along.set(n.y === 0 ? 0 : 1, n.y === 0 ? 1 : 0, 0);
    along.normalize();
    side.crossVectors(along, n);
    basis.makeBasis(side, along, n);
    quat.setFromRotationMatrix(basis);
    // 遠くに落ちるほど大きく、薄く
    const r = radius * (1 + 0.12 * bestT);
    scale.set(2 * r, (2 * r) / Math.max(facing, 0.3), 1);
    mesh.matrix.compose(hit, quat, scale);
    mesh.matrixWorldNeedsUpdate = true;
    material.opacity = (strength * k) / (1 + 0.25 * bestT);
    mesh.visible = true;
  };
  return mesh;
}

// 日差しの影を描くときのシェーダー（影の地図に奥行きを描く材質）を、裏で組み立てておく。
// renderer.compile は画面に描く材質しか組み立てないので、何もしないと最初に影を描くときにその場で組み立てて止まる。
// 影を描くときと同じ材質（three の WebGLShadowMap が選ぶもの）にいったん差し替えて組み立てる。
//   target: 画面以外の描き先（影の地図と同じく、色の変換なしで描く）
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
export function compileShadows(renderer, scene, camera, target) {
  let lit = false;
  scene.traverseVisible((o) => (lit ||= o.isDirectionalLight && o.castShadow));
  if (!lit || !renderer.shadowMap.enabled) return;
  const plain = new THREE.MeshDepthMaterial();
  // WebGLShadowMap.getDepthMaterial と同じ値を写す（シェーダーは材質そのものでなく値で決まるので、複製でよい）
  const variant = (m) => {
    const d = plain.clone();
    d.side = m.shadowSide ?? SHADOW_SIDE[m.side];
    d.visible = m.visible;
    d.wireframe = m.wireframe;
    d.alphaMap = m.alphaMap;
    d.alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
    d.map = m.map;
    d.clipShadows = m.clipShadows;
    d.clippingPlanes = m.clippingPlanes;
    d.clipIntersection = m.clipIntersection;
    d.displacementMap = m.displacementMap;
    d.displacementScale = m.displacementScale;
    d.displacementBias = m.displacementBias;
    return d;
  };
  const casters = new Set();
  scene.traverseVisible((o) => {
    if ((o.isMesh || o.isLine || o.isPoints) && o.castShadow) casters.add(o);
  });
  // renderer.compile は見えない物も含めて全ての材質を組み立てるので、影を落とさない物は材質をいったん外す
  const swapped = new Map();
  scene.traverse((o) => {
    if (!o.material) return;
    swapped.set(o, o.material);
    if (!casters.has(o)) o.material = null;
    else if (o.customDepthMaterial) o.material = o.customDepthMaterial;
    else o.material = Array.isArray(o.material) ? o.material.map(variant) : variant(o.material);
  });
  const prev = renderer.getRenderTarget();
  // 影を描くときは霧（scene.fog）を渡さない。霧があるとシェーダーが別物になる
  const fog = scene.fog;
  scene.fog = null;
  try {
    renderer.setRenderTarget(target);
    renderer.compile(scene, camera);
  } catch {
    // 組み立てられなかった分は、描くときに組み立てる
  }
  scene.fog = fog;
  renderer.setRenderTarget(prev);
  for (const [o, m] of swapped) o.material = m;
}

// renderer.compile を、物のまとまりごとに区切って行う（全部を一度に組み立てると、シェーダーを作る準備だけで 0.4 秒ほど止まる）。
// 光と霧・環境マップは scene 全体のものを使う（compile の 3 つめの引数）。
//   targets: 描き先の一覧（null は画面）
//   around: 区切りごとに、組み立てる前に呼ぶ（戻り値の関数を組み立てた後に呼ぶ）。区切りの間に画面を描くときの状態に戻すため
export async function compileSliced(renderer, scene, camera, { targets = [null], around = null, budget = 25 } = {}) {
  // compile は、渡した物の中の光も scene の光に足して数える（同じ光を 2 回数えて、違うシェーダーになる）。
  // 光を含むまとまりはさらに分け、光そのものは渡さない
  const hasLight = new Set();
  scene.traverse((o) => {
    if (o.isLight) for (let p = o; p; p = p.parent) hasLight.add(p);
  });
  const parts = [];
  const split = (o, depth) => {
    for (const c of o.children) {
      if (c.isLight) continue;
      if (hasLight.has(c) || (depth < 1 && c.children.length && !c.material)) split(c, depth + 1);
      else parts.push(c);
    }
  };
  split(scene, 0);
  let slice = performance.now();
  for (const part of parts) {
    const undo = around?.();
    const prev = renderer.getRenderTarget();
    for (const t of targets) {
      try {
        renderer.setRenderTarget(t);
        renderer.compile(part, camera, scene);
      } catch {
        // 組み立てられなかった分は、描くときに組み立てる
      }
    }
    renderer.setRenderTarget(prev);
    undo?.();
    if (performance.now() - slice > budget) {
      await nextTask();
      slice = performance.now();
    }
  }
}
