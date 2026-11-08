import * as THREE from 'three';

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
      if (changed) shadowMap.needsUpdate = true;
    },
    // 外から描き直しを頼む（物を急に置き換えたときなど）
    invalidate() {
      shadowMap.needsUpdate = true;
    },
  };
}

// 明るさが 0 の光を、描く計算から外す（見えない光も、画面の全ての点で計算されて重い）。
// 光の数が変わると描き方（シェーダー）を組み直すことになるので、先に裏で組み立て（compileAsync）、できてから切り替える。
// 一度組んだ描き方は残るので、2 回目からの切り替えはすぐ済む
export function createLightGate(renderer, scene, camera, { offDelay = 1 } = {}) {
  const state = new Map(); // 光 → { busy, off（0 のままの秒数） }
  let frame = 0;

  function collect() {
    scene.traverse((o) => {
      if (o.isLight && !state.has(o)) state.set(o, { busy: false, off: 0 });
    });
  }

  function switchTo(light, s, visible) {
    s.busy = true;
    const prev = light.visible;
    light.visible = visible;
    let job;
    try {
      job = renderer.compileAsync(scene, camera);
    } catch (e) {
      job = Promise.resolve();
    }
    light.visible = prev;
    job
      .catch(() => {})
      .then(() => {
        light.visible = visible;
        s.busy = false;
        s.off = 0;
      });
  }

  return {
    // 起動時：いま 0 の光を先に外しておく（シェーダーを最初からその形で組み立てる）
    prime() {
      collect();
      for (const light of state.keys()) if (light.intensity <= 1e-4) light.visible = false;
    },
    update(dt) {
      if (frame++ % 120 === 0) collect();
      for (const [light, s] of state) {
        if (s.busy) continue;
        const want = light.intensity > 1e-4;
        if (want && !light.visible) switchTo(light, s, true);
        else if (!want && light.visible) {
          // しばらく 0 のままなら外す（ちらつきで点いたり消えたりするたびに組み直さないように）
          s.off += dt;
          if (s.off > offDelay) switchTo(light, s, false);
        } else s.off = 0;
      }
    },
  };
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
