import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { queueTextures } from './textureQueue.js';

// GLB を読むローダー。public/models の GLB は頂点を Draco で圧縮している
// （tools/compress-models.py。圧縮しないと 1 本 2MB を超え、読み込みが重い）。
// 展開は別スレッド（Web Worker）で行うので、読み込み中も画面が止まらない。
// 展開のプログラム（public/draco/）は three の examples/jsm/libs/draco/gltf/ の写し
const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
draco.preload();

// 画像は KTX2（tools/to-ktx2.mjs）。GPU がそのまま使える圧縮形式なので、GPU へ送るのが速く、メモリも少なくて済む。
// 端末の GPU に合う形式への変換は別スレッドで行う。変換のプログラム（public/basis/）は three の
// examples/jsm/libs/basis/ の写し。どの形式に変換するかは GPU で決まるので、レンダラーを作ってから決める（useRenderer）
const ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);

export function useRenderer(renderer) {
  ktx2.detectSupport(renderer);
  ktx2.init(); // 変換のプログラムを先に読み始めておく
}

export function gltfLoader(manager) {
  return (
    new GLTFLoader(manager)
      .setDRACOLoader(draco)
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder)
      // 読み終えたモデルの画像は、すぐ GPU へ送り始める（textureQueue.js）
      .register(() => ({ name: 'quimaglet_upload', afterRoot: async (gltf) => queueTextures(gltf.scene) }))
  );
}

// KTX2 の画像を 1 枚読む。読み込みの進み具合は manager に数える
export async function loadKTX2(url, manager) {
  manager?.itemStart(url);
  try {
    return await ktx2.loadAsync(url);
  } catch (e) {
    manager?.itemError(url);
    throw e;
  } finally {
    manager?.itemEnd(url);
  }
}
