import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// GLB を読むローダー。public/models の GLB は頂点を Draco で圧縮している
// （tools/compress-models.py。圧縮しないと 1 本 2MB を超え、読み込みが重い）。
// 展開は別スレッド（Web Worker）で行うので、読み込み中も画面が止まらない。
// 展開のプログラム（public/draco/）は three の examples/jsm/libs/draco/gltf/ の写し
const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
draco.preload();

export function gltfLoader(manager) {
  return new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
}
