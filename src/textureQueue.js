import { nextTask } from './nextTask.js';

// 画像（テクスチャ）を、読み込んだ順に 1 枚ずつ GPU へ送っておく。
// 何もしないと最初の描画でまとめて送ることになり、その間（1 秒ほど）画面が止まる。
// モデルを読み終えるたびに送り始めるので、ほかのファイルをダウンロードしている間に済む。
// シェーダーの組み立てと重なると、送るのが組み立ての後に待たされて遅くなるので、組み立ての前に送り終える（main.js の precompile）
let renderer = null;
const queue = [];
const sent = new WeakSet();
let running = null;

export function setTextureUploader(r) {
  renderer = r;
  pump();
}

// 物の中の材質が使う画像を、送る列に並べる
export function queueTextures(root) {
  root.traverse((o) => {
    for (const m of o.material ? [o.material].flat() : []) {
      for (const v of Object.values(m)) if (v?.isTexture) queue.push(v);
      for (const u of Object.values(m.uniforms ?? {})) if (u?.value?.isTexture) queue.push(u.value);
    }
  });
  pump();
}

export function queueTexture(texture) {
  queue.push(texture);
  pump();
}

// 列に並んだ画像を送り終えるまで待つ
export function texturesUploaded() {
  return running ?? Promise.resolve();
}

function pump() {
  if (!renderer || running || !queue.length) return;
  running = (async () => {
    while (queue.length) {
      const t = queue.shift();
      // 動画は毎フレーム送る。描き先の画像は GPU の中で作る。画像がまだ無い物は、描くときに送る
      if (sent.has(t) || t.isVideoTexture || t.isRenderTargetTexture || t.isCubeTexture || !t.image) continue;
      sent.add(t);
      renderer.initTexture(t);
      await nextTask();
    }
    running = null;
  })();
}
