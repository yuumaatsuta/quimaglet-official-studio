import * as THREE from 'three';

// ブラウン管の画面に映像を流す。
// モデルのガラス面の形（ふくらみ）を前からの光線で写し取った曲面を、ガラスのすぐ手前に貼る。
// 映像はすべての画面で 1 本を共有する（読めないあいだは砂嵐）。

export const SCREEN_MODES = { video: 0, noise: 1, off: 2 };

// すべての画面で共有する値（映像・時間）
const shared = {
  map: { value: null },
  hasMap: { value: 0 },
  videoAspect: { value: 16 / 9 },
  time: { value: 0 },
};
let videoStarted = false;

// 流す映像（mp4 / webm）を決める。最初の 1 回だけ読み込む
export function startCrtVideo(url) {
  if (videoStarted || !url) return;
  videoStarted = true;
  const video = document.createElement('video');
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true; // 自動再生できるのは音なしの映像だけ
  video.playsInline = true;
  video.addEventListener(
    'playing',
    () => {
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      shared.map.value = texture;
      shared.hasMap.value = 1;
      if (video.videoWidth && video.videoHeight) shared.videoAspect.value = video.videoWidth / video.videoHeight;
    },
    { once: true },
  );
  video.addEventListener('error', () => console.info('[crt] 映像が読めないので砂嵐を映します:', url));
  // 自動再生が止められたら、最初に画面に触れたときに再生する
  video.play().catch(() => addEventListener('pointerdown', () => video.play().catch(() => {}), { once: true }));
}

export function updateCrtScreens(t) {
  shared.time.value = t;
}

// モデルに画面を貼る。rect は画面の範囲（モデルの元の座標。正面は +z）
export function addCrtScreen(model, rect, options) {
  const aspect = Math.abs((rect.x1 - rect.x0) / (rect.y1 - rect.y0)) || 4 / 3;
  const mesh = new THREE.Mesh(screenGeometry(model, rect), crtScreenMaterial({ aspect, ...options }));
  mesh.userData.aspect = aspect;
  mesh.userData.noPick = true;
  mesh.userData.isScreen = true;
  mesh.userData.noHighlight = true; // 複製すると映像・時間の共有が切れる
  model.add(mesh);
  return mesh;
}

//   mode: video（映像。なければ砂嵐）/ noise（いつも砂嵐）/ off（消えている画面）
//   seed: 画面ごとのずれ（砂嵐の模様・映像の明るさ・ちらつき）
//   aspect: 画面の縦横比（横 / 縦）。映像は上下に黒帯が出る 4:3 のテレビらしい映り方にする
export function crtScreenMaterial({ mode = 'video', seed = 0, aspect = 4 / 3 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      mode: { value: SCREEN_MODES[mode] ?? 0 },
      seed: { value: seed },
      aspect: { value: aspect },
      power: { value: 1.15 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float hasMap;
      uniform float videoAspect;
      uniform float time;
      uniform float mode;
      uniform float seed;
      uniform float aspect;
      uniform float power;
      varying vec2 vUv;

      const float LINES = 240.0;   // 走査線の本数
      const float OVERSCAN = 1.2;  // ブラウン管らしく、映像の端が少し画面の外にはみ出す

      // sin を使わない乱数（大きな値でも精度が落ちて縞模様にならない）
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // 画面の端ほど映像が引き伸ばされる、ブラウン管のゆがみ
      vec2 barrel(vec2 uv) {
        vec2 c = uv - 0.5;
        return 0.5 + c * (1.0 + 0.1 * dot(c, c));
      }

      // 画面の uv → 映像の uv（横長の映像を上下の黒帯つきで収める）
      vec2 pictureUv(vec2 uv) {
        float h = min(1.0, aspect / videoAspect * OVERSCAN);
        float w = h * videoAspect / aspect;
        return vec2((uv.x - 0.5) / w + 0.5, (uv.y - 0.5) / h + 0.5);
      }

      vec3 picture(vec2 uv) {
        vec2 p = pictureUv(uv);
        if (p.y < 0.0 || p.y > 1.0) return vec3(0.0);
        // 色ずれ（赤と青が左右にわずかにずれる）と、にじみ
        float ca = 0.0025;
        vec3 c;
        c.r = texture2D(map, vec2(p.x + ca, p.y)).r;
        c.g = texture2D(map, p).g;
        c.b = texture2D(map, vec2(p.x - ca, p.y)).b;
        c = c * 0.7 + texture2D(map, vec2(p.x + 0.004, p.y)).rgb * 0.15 + texture2D(map, vec2(p.x - 0.004, p.y)).rgb * 0.15;
        return c;
      }

      void main() {
        // ブラウン管らしく、四隅を丸く欠く
        vec2 q = abs(vUv - 0.5) * 2.0;
        vec2 corner = max(q - 0.86, 0.0) / 0.14;
        float mask = 1.0 - smoothstep(0.8, 1.0, length(corner));

        if (mode > 1.5) {
          // 消えている画面：くすんだ緑がかった灰色のガラスに、うっすら反射
          float sheen = smoothstep(0.9, 0.2, length(vUv - vec2(0.35, 0.7)));
          gl_FragColor = vec4(vec3(0.05, 0.058, 0.052) * (0.6 + 0.6 * sheen) * mask, 1.0);
        } else {
          vec2 uv = barrel(vUv);
          // 走査線ごとの小さな横揺れ
          float line = floor(uv.y * LINES);
          uv.x += (hash(vec2(line, mod(floor(time * 30.0), 512.0) + seed * 50.0)) - 0.5) * 0.002;

          vec3 color;
          if (mode < 0.5 && hasMap > 0.5) {
            color = picture(uv);
            // 少し暖色で、コントラストが強く、明るいところがにじむ
            color = pow(color, vec3(1.15)) * vec3(1.04, 1.0, 0.92);
            color += color * color * 0.12;
            color *= 0.9 + 0.2 * fract(seed * 7.13);
          } else {
            // 砂嵐の粒は 1 粒が 2 画素より小さくならないようにする（画面が小さく映るとき、
            // 画素より細かい粒は波打つ模様（モアレ）になって、画面がよれて見える）
            vec2 cells = clamp(floor(0.5 / max(fwidth(vUv), vec2(1e-5))), vec2(16.0), vec2(240.0, 180.0));
            float frame = mod(floor(time * 24.0), 512.0);
            float n = hash(floor(uv * cells) + vec2(frame * 61.0, frame * 17.0) + seed * 113.7);
            color = vec3(n * n * 0.6);
          }

          // 走査線と、蛍光体の縦じま（RGB）。画面が小さく映るときは細かい模様を消してちらつきを防ぐ
          float dy = fwidth(vUv.y) * LINES;
          float scanAmount = 0.3 * (1.0 - smoothstep(0.35, 0.9, dy));
          float scan = 1.0 - scanAmount * (0.5 + 0.5 * cos(uv.y * LINES * 6.28318));
          float dx = fwidth(vUv.x) * LINES * aspect * 3.0;
          float grille = 1.0 - smoothstep(0.35, 0.9, dx);
          float column = mod(floor(uv.x * LINES * aspect * 3.0), 3.0);
          vec3 triad = column < 0.5 ? vec3(1.0, 0.7, 0.7) : column < 1.5 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
          color *= mix(vec3(1.0), triad * 1.25, grille * 0.6);

          // ゆっくり流れる明るい帯、周辺の減光、電源のちらつき
          float roll = 1.0 + 0.05 * smoothstep(0.8, 1.0, sin((uv.y + time * 0.11 + seed) * 6.28318));
          float vignette = 1.0 - 0.5 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
          float flicker = 0.97 + 0.03 * sin(time * 50.0 + seed * 20.0);
          color *= scan * roll * vignette * flicker * power;

          // ガラスに映る、うっすらとした部屋の光
          color += vec3(0.02) * smoothstep(0.7, 0.1, length(vUv - vec2(0.3, 0.75)));
          gl_FragColor = vec4(color * mask, 1.0);
        }

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// 画面の範囲に格子を張り、各点から奥へ光線を飛ばしてガラス面の位置を拾う
function screenGeometry(model, rect, segX = 16, segY = 12) {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(model.matrixWorld);

  const geometry = new THREE.PlaneGeometry(1, 1, segX, segY);
  const pos = geometry.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = THREE.MathUtils.lerp(rect.x0, rect.x1, pos.getX(i) + 0.5);
    const y = THREE.MathUtils.lerp(rect.y0, rect.y1, pos.getY(i) + 0.5);
    origin.set(x, y, 2).applyMatrix4(model.matrixWorld);
    raycaster.set(origin, dir);
    const hit = raycaster.intersectObject(model, true)[0];
    if (hit) p.copy(hit.point).applyMatrix4(inverse);
    else p.set(x, y, 0);
    // ガラスとちらつかないよう、ほんの少し手前に浮かせる
    pos.setXYZ(i, x, y, p.z + 0.006);
  }
  geometry.computeVertexNormals();
  return geometry;
}
