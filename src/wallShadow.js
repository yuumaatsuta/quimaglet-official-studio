import * as THREE from 'three';

// 壁に掛けた物・壁際の物が、うしろの壁に落とすやわらかい影。
// 部屋の光（窓・蛍光灯・回り込む光）は影を作らないので、壁から浮いて見える。そこで、
// 物の形（三角形）を光の向きに沿って壁へ写して描き、壁から離れた部分ほど薄く・大きくぼかす。
//
//   object: 影を落とす物（置いた後の位置で測る）
//   wall: 'x'（左の壁。部屋の内向きが +x）か 'z'（奥の壁。内向きが +z）
//   at: 壁の面の座標
//   light: 光の進む向き（壁へ向かう向き。wall の成分が負）
//   floor: これより下には描かない（床にめり込まない）
export function wallShadow(object, { wall, at, light, floor = 0, opacity = 1 }) {
  const L = light.clone().normalize();
  const axis = wall;
  const other = wall === 'x' ? 'z' : 'x';
  const PX = 160; // 1m あたりの画素
  const MAX_DIST = 1.3; // これより壁から離れた所は影を落とさない
  // 壁からの距離ごとの、ぼかしの大きさ（m）と濃さ
  const BANDS = [
    { upTo: 0.12, blur: 0.02, alpha: 0.7 },
    { upTo: 0.45, blur: 0.06, alpha: 0.5 },
    { upTo: MAX_DIST, blur: 0.14, alpha: 0.32 },
  ];

  object.updateMatrixWorld(true);
  const meshes = [];
  object.traverse((o) => {
    if (o.isMesh && o.visible && o.geometry?.attributes.position) meshes.push(o);
  });
  const p = new THREE.Vector3();
  const project = (v) => {
    const d = v[axis] - at;
    const t = -d / L[axis];
    return [v[other] + L[other] * t, v.y + L.y * t, d];
  };

  // 1. 写る範囲（物ごとの外形の箱の角を写して測る）
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  const box = new THREE.Box3();
  for (const o of meshes) {
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (box.min[axis] - at > MAX_DIST) continue;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const [u, v] = project(p);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  }
  if (!Number.isFinite(u0)) return new THREE.Group();
  const margin = BANDS[BANDS.length - 1].blur * 2.5;
  u0 -= margin;
  u1 += margin;
  v1 += margin;
  v0 = Math.max(floor, v0 - margin);
  const w = u1 - u0;
  const h = v1 - v0;
  const px = Math.min(PX, 2048 / Math.max(w, h));
  const cw = Math.ceil(w * px);
  const ch = Math.ceil(h * px);
  // 左の壁は、壁の面を部屋から見ると左右が z の逆向きになる
  const flip = wall === 'x';
  const X = (u) => (flip ? u1 - u : u - u0) * px;
  const Y = (v) => (v1 - v) * px;

  // 2. 三角形を、壁からの距離の帯ごとの白黒の画素に塗る（数が多いので canvas の図形描画は使わない）
  const masks = BANDS.map(() => new Uint8Array(cw * ch));
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const n = pos.count;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const [u, v, d] = project(p);
      sx[i] = X(u);
      sy[i] = Y(v);
      sd[i] = d;
    }
    const count = index ? index.count : n;
    for (let k = 0; k < count; k += 3) {
      const a = index ? index.getX(k) : k;
      const b = index ? index.getX(k + 1) : k + 1;
      const c = index ? index.getX(k + 2) : k + 2;
      const d = (sd[a] + sd[b] + sd[c]) / 3;
      if (d < -0.02 || d > MAX_DIST) continue;
      let band = 0;
      while (d > BANDS[band].upTo) band++;
      fillTriangle(masks[band], cw, ch, sx[a], sy[a], sx[b], sy[b], sx[c], sy[c]);
    }
  }

  // 3. 帯ごとにぼかして重ねる
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const shape = document.createElement('canvas');
  shape.width = cw;
  shape.height = ch;
  const sctx = shape.getContext('2d');
  const image = sctx.createImageData(cw, ch);
  BANDS.forEach((band, bi) => {
    const m = masks[bi];
    if (!m.some((x) => x)) return;
    for (let i = 0; i < m.length; i++) image.data[i * 4 + 3] = m[i] ? 255 : 0;
    sctx.putImageData(image, 0, 0);
    const layer = document.createElement('canvas');
    layer.width = cw;
    layer.height = ch;
    const g = layer.getContext('2d');
    // 形を画面の外に描き、ぼかした影だけを中へずらして写す（ctx.filter が使えない環境でもぼける）
    const off = cw + 100;
    g.shadowColor = '#000';
    g.shadowBlur = band.blur * px;
    g.shadowOffsetX = off;
    g.drawImage(shape, -off, 0);
    ctx.globalAlpha = band.alpha;
    ctx.drawImage(layer, 0, 0);
  });

  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    }),
  );
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  if (wall === 'x') {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(at + 0.003, cv, cu);
  } else {
    mesh.position.set(cu, cv, at + 0.003);
  }
  mesh.renderOrder = 1;
  mesh.userData.noPick = true;
  mesh.userData.noHighlight = true;
  return mesh;
}

// 三角形の中の画素に 1 を立てる（画素の中心で判定。1 画素より小さい三角形は、その画素を塗る）
function fillTriangle(mask, w, h, ax, ay, bx, by, cx, cy) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(h - 1, Math.floor(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;
  if (maxX - minX < 1 && maxY - minY < 1) {
    mask[minY * w + minX] = 1;
    return;
  }
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-6) return;
  const s = area > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5;
      const e0 = ((bx - ax) * (py - ay) - (by - ay) * (qx - ax)) * s;
      const e1 = ((cx - bx) * (py - by) - (cy - by) * (qx - bx)) * s;
      const e2 = ((ax - cx) * (py - cy) - (ay - cy) * (qx - cx)) * s;
      if (e0 >= 0 && e1 >= 0 && e2 >= 0) mask[y * w + x] = 1;
    }
  }
}
