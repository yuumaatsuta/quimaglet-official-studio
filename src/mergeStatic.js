import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 動かない部品（userData.merge の付いたメッシュ）を、材質と影の設定が同じものごとに 1 つのメッシュへまとめる。
// 窓枠・ブラウン管のアーム・バルコニーの手すりなどは小さな部品が数百あり、1 つずつ描くと
// 画面と影でそれぞれ数百回の描画になる（CPU の負担が大きい）。形と位置はそのままなので見た目は変わらない。
// まとめた後は元の部品を消すので、位置を後から動かす物には印を付けないこと
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.merge || Array.isArray(o.material)) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!o.userData.noPick}|${o.visible}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });

  let removed = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      g.clearGroups();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    });
    const indexed = geos.every((g) => g.index);
    const merged = mergeGeometries(indexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue; // 属性がそろわないときは、まとめずにそのまま
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.visible = first.visible;
    if (first.userData.noPick) mesh.userData.noPick = true;
    root.add(mesh);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      removed++;
    }
  }
  return removed;
}
