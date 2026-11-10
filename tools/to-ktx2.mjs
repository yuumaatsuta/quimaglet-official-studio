// 画像を KTX2（Basis Universal）にする。GPU がそのまま使える圧縮形式なので、
// GPU へ送るのが速く（展開がいらない）、GPU のメモリも RGBA の 1/4〜1/8 で済む。
// サイトは src/gltf.js の KTX2Loader で、端末の GPU に合う形式へ別スレッドで変換して使う。
//
//   node tools/to-ktx2.mjs model   元.glb   先.glb
//   node tools/to-ktx2.mjs texture 元.webp  先.ktx2  color|data|normal-hq
//
// model:   GLB の中の画像だけを差し替える（頂点などは 1 バイトも変えない）。
//          使い道は材質から決める（色 = sRGB、ラフネス・金属 = そのままの値、ノーマル）
// texture: 部屋の壁・床などの画像。上下を反転して書く（TextureLoader で読んだときと同じ向きになる）
//
// 形式（元の画像と比べた PSNR は tools 外で測った値）:
//   色・ラフネス・ノーマル = ETC1S（ファイルが小さい。WebP の 1〜1.4 倍）。色 32〜37dB、ノーマル 36〜46dB
//   ラフネス・金属は 30〜46dB（UASTC にすると 40dB 台になるが、1 枚 200KB 以上増え、画面では見分けがつかない）
//   部屋のノーマル（normal-hq）= UASTC。広く大きく映るので崩れが目立つ。元が可逆 WebP なので、こちらの方が小さい
//   UASTC は Zstandard で縮める
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const [mode, src, dst, kindArg] = process.argv.slice(2);

const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

const ETC1S = { isUASTC: false, qualityLevel: 255, compressionLevel: 2 };
const UASTC = { isUASTC: true, needSupercompression: true, uastcLDRQualityLevel: 2 };
const OPTIONS = {
  color: { ...ETC1S, isPerceptual: true },
  data: { ...ETC1S, isPerceptual: false },
  normal: { ...ETC1S, isNormalMap: true, isPerceptual: false },
  'normal-hq': { ...UASTC, isNormalMap: true, isPerceptual: false },
};

export async function encode(bytes, kind, isYFlip = false) {
  return encodeToKTX2(new Uint8Array(bytes), { ...OPTIONS[kind], generateMipmap: true, isYFlip, imageDecoder });
}

if (mode === 'texture') {
  const out = await encode(readFileSync(src), kindArg ?? 'color', true);
  writeFileSync(dst, out);
  console.log(dst, `${(out.length / 1024) | 0}KB`);
} else if (mode === 'model') {
  await model(src, dst);
}

async function model(src, dst) {
  const glb = readFileSync(src);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));

  // 画像ごとの使い道
  const kinds = new Map();
  const mark = (info, kind) => {
    if (!info) return;
    const t = json.textures[info.index];
    const source = t.extensions?.EXT_texture_webp?.source ?? t.extensions?.KHR_texture_basisu?.source ?? t.source;
    kinds.set(source, kinds.get(source) === 'color' ? 'color' : kind);
  };
  for (const m of json.materials ?? []) {
    mark(m.pbrMetallicRoughness?.baseColorTexture, 'color');
    mark(m.emissiveTexture, 'color');
    mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'data');
    mark(m.occlusionTexture, 'data');
    mark(m.normalTexture, 'normal');
  }

  // 画像のデータを KTX2 に差し替える
  const views = json.bufferViews.map((v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  for (const [i, image] of (json.images ?? []).entries()) {
    if (image.mimeType === 'image/ktx2') continue;
    const kind = kinds.get(i) ?? 'color';
    const out = await encode(views[image.bufferView], kind);
    console.log(`  ${image.name ?? i}: ${kind} ${(views[image.bufferView].length / 1024) | 0}KB -> ${(out.length / 1024) | 0}KB`);
    views[image.bufferView] = Buffer.from(out);
    image.mimeType = 'image/ktx2';
  }
  for (const t of json.textures ?? []) {
    const source = t.extensions?.EXT_texture_webp?.source ?? t.source;
    if (t.extensions) delete t.extensions.EXT_texture_webp;
    delete t.source;
    t.extensions = { ...t.extensions, KHR_texture_basisu: { source } };
  }
  const swap = (list) => [...new Set((list ?? []).map((e) => (e === 'EXT_texture_webp' ? 'KHR_texture_basisu' : e)))];
  json.extensionsUsed = swap(json.extensionsUsed);
  json.extensionsRequired = swap(json.extensionsRequired);
  if (!json.extensionsUsed.includes('KHR_texture_basisu')) json.extensionsUsed.push('KHR_texture_basisu');
  if (!json.extensionsRequired.includes('KHR_texture_basisu')) json.extensionsRequired.push('KHR_texture_basisu');

  // バッファを詰め直す（区切りは 8 バイト境界）
  let offset = 0;
  const parts = [];
  for (const [i, v] of json.bufferViews.entries()) {
    const pad = (8 - (offset % 8)) % 8;
    if (pad) parts.push(Buffer.alloc(pad));
    offset += pad;
    v.byteOffset = offset;
    v.byteLength = views[i].length;
    parts.push(views[i]);
    offset += views[i].length;
  }
  parts.push(Buffer.alloc((4 - (offset % 4)) % 4));
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = offset;

  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + newBin.length, 8);
  const chunk = (bytes, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(bytes.length, 0);
    h.write(type, 4);
    return Buffer.concat([h, bytes]);
  };
  writeFileSync(dst, Buffer.concat([header, chunk(jsonBytes, 'JSON'), chunk(newBin, 'BIN\0')]));
  console.log(dst, `${(glb.length / 1024) | 0}KB -> ${((12 + 16 + jsonBytes.length + newBin.length) / 1024) | 0}KB`);
}
