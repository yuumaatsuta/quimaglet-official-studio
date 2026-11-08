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
  // いまの光の点き方で、画面用と画像用の描き方を組み立てる
  function compileAll() {
    const prev = renderer.getRenderTarget();
    for (const t of [null, ...targets]) {
      try {
        renderer.setRenderTarget(t);
        renderer.compile(scene, camera);
      } catch (e) {
        // 組み立てられなかった分は、描くときに組み立てる
      }
    }
    renderer.setRenderTarget(prev);
  }
  function switchTo(g, visible) {
    busy = true;
    setAll(g, visible);
    compileAll();
    setAll(g, g.shown);
    allReady(renderer).then(() => {
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
    prime() {
      collect();
      for (const g of groups.values()) {
        if ([...g.lights].every((l) => l.intensity <= 1e-4)) {
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
      setAll(g, true);
      compileAll();
      setAll(g, false);
      // できあがるまでは、ほかの切り替えをしない（裏の組み立てに、新しい組み立てを重ねない）
      busy = true;
      allReady(renderer).then(() => (busy = false));
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
