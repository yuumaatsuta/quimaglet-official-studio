import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { tagHotspot } from './hotspots.js';
import { buildStudioRoom } from './studioRoom.js';

// Blender の GLB を読む。ファイルがなければ、写真から起こしたスタジオを組む。
//
// GLB 側の約束ごと:
// - 1 単位 = 1m、床が y = 0、部屋の手前（開口部）が z = 0、奥が -z
//   （手前の位置がずれていても読み込み時に z = 0 へ合わせる）
// - クリックさせたい物は `hs_about` のように `hs_` + content.js のキーで名前を付ける
//   （親の Empty に付ければ子のメッシュもまとめて対象になる）
export async function loadRoom(url, onProgress, contentReady) {
  if (!(await exists(url))) return buildStudioRoom(onProgress, contentReady);

  const loader = gltfLoader();
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  await contentReady;
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  model.position.z -= box.max.z;
  box.setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  const hotspots = new Map();
  let hasLights = false;
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
    if (obj.isLight) hasLights = true;
  });
  // 親から順に登録するので、入れ子の hs_ は内側が優先される
  model.traverse((obj) => {
    if (obj.name.startsWith('hs_')) {
      tagHotspot(hotspots, obj.name.slice(3).replace(/[._]?\d+$/, ''), obj);
    }
  });

  return {
    group: model,
    bounds: {
      centerX: (box.min.x + box.max.x) / 2,
      floorY: box.min.y,
      width: size.x,
      height: size.y,
    },
    view: {},
    probe: new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + 1.6, box.min.z / 2),
    hotspots,
    hasLights,
    update() {},
  };
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    // 開発サーバーは存在しないパスに index.html を返すことがある
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}
