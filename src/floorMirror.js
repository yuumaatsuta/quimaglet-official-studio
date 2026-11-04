import * as THREE from 'three';

// 床に置いた物の、床への映り込みと接地の影。
// 映り込み：物の足元の床に寝かせた板に、床（y = 0）で鏡映しにした目から、その物だけを描いた画像を貼る。
// 物と照明だけを描くので軽い。画像は低い解像度で描き、さらにぼかして、艶のある木の床らしくする

// 目が止まっている間の、映り込みの描き直しの間隔（フレーム）
export const MIRROR_REFRESH = 4;

let nextLayer = 6; // 映り込みの描画で使うレイヤー（物ごとに 1 つ。1〜5 はほかで使用）

//   object: 映す物（中のメッシュをまとめて映り込みのレイヤーに入れる）
//   box: 物の外形（ワールド座標）
//   strength: 映り込みの濃さ、height: 床からこの高さ（m）までが映る（上ほど薄く）
export function floorMirror(object, box, { strength = 0.35, height = 0.1, size = 512, margin = 0.35 } = {}) {
  const layer = nextLayer++;
  object.traverse((o) => o.isMesh && o.layers.enable(layer));

  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
  const virtual = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  virtual.layers.set(layer);
  const textureMatrix = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  const x0 = box.min.x - margin;
  const x1 = box.max.x + margin;
  const z0 = box.min.z - margin;
  const z1 = box.max.z + margin;
  // 物の真下からの距離（板の端で消すため）。板の UV で、物の輪郭が [inner, 1 - inner] に来る
  const inner = new THREE.Vector2(margin / (x1 - x0), margin / (z1 - z0));

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, z1 - z0),
    new THREE.ShaderMaterial({
      uniforms: {
        tMirror: { value: rt.texture },
        textureMatrix: { value: textureMatrix },
        strength: { value: strength },
        texel: { value: 1 / size },
        inner: { value: inner },
      },
      vertexShader: `
uniform mat4 textureMatrix;
varying vec4 vCoord;
varying vec2 vUv;
void main() {
  vUv = uv;
  vCoord = textureMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
uniform sampler2D tMirror;
uniform float strength;
uniform float texel;
uniform vec2 inner;
varying vec4 vCoord;
varying vec2 vUv;
void main() {
  vec2 uv = vCoord.xy / vCoord.w;
  vec4 c = vec4(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float k = exp(-float(x * x + y * y) / 3.0);
      c += texture2D(tMirror, uv + vec2(float(x), float(y)) * texel * 1.5) * k;
      wsum += k;
    }
  }
  c /= wsum;
  // 物の輪郭から外へ離れるほど薄く、板の端で消える
  vec2 d = max(inner - vUv, vUv - (1.0 - inner)) / inner;
  float edge = 1.0 - smoothstep(0.0, 1.0, max(d.x, d.y));
  gl_FragColor = c * strength * edge;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
  plane.renderOrder = 2;
  plane.userData.noPick = true;

  // 映り込みの描画のときだけ、物の上の方を消す（床から離れた所ほど映らない）
  const fadeUniform = { value: 0 };
  const fadeHeight = { value: height };
  object.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, r) => {
        prev?.call(m, shader, r);
        shader.uniforms.uMirrorFade = fadeUniform;
        shader.uniforms.uMirrorHeight = fadeHeight;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vMirrorY;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvMirrorY = (modelMatrix * vec4(transformed, 1.0)).y;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vMirrorY;\nuniform float uMirrorFade;\nuniform float uMirrorHeight;')
          .replace(
            '#include <dithering_fragment>',
            '#include <dithering_fragment>\nif (uMirrorFade > 0.5) gl_FragColor *= 1.0 - smoothstep(0.0, uMirrorHeight, vMirrorY);',
          );
      };
      const key = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => `${key ? key() : ''}floorMirror`;
      m.needsUpdate = true;
    }
  });

  const eye = new THREE.Vector3();
  const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const corners = [
    new THREE.Vector3(x0, 0, z0),
    new THREE.Vector3(x1, 0, z0),
    new THREE.Vector3(x0, 0, z1),
    new THREE.Vector3(x1, 0, z1),
  ];
  const corner = new THREE.Vector3();
  const clear = new THREE.Color();
  let frame = 0;
  const lastEye = new THREE.Vector3(Infinity, 0, 0);
  plane.onBeforeRender = (renderer, scene, camera) => {
    // 照明も映り込みの描画に入れる（照明が増えたときのため、ときどき数え直す）
    if (frame++ % 120 === 0) scene.traverse((o) => o.isLight && o.layers.enable(layer));
    // 目が止まっている間は前の絵を使う（映る物は動かない）。光の変わり目（雷・天気）は
    // REFRESH フレームごとの描き直しで追いつく
    camera.getWorldPosition(eye);
    if (eye.distanceToSquared(lastEye) < 1e-10 && frame % MIRROR_REFRESH !== 0) return;
    lastEye.copy(eye);
    // 床で鏡映しにした目から、板の中心を見る。板全体が入る画角にする
    camera.getWorldPosition(eye);
    virtual.position.set(eye.x, -eye.y, eye.z);
    virtual.up.set(0, 1, 0);
    virtual.lookAt(center);
    virtual.updateMatrixWorld();
    let tx = 0;
    let ty = 0;
    for (const c of corners) {
      corner.copy(c).applyMatrix4(virtual.matrixWorldInverse);
      const dz = Math.max(0.01, -corner.z);
      tx = Math.max(tx, Math.abs(corner.x / dz));
      ty = Math.max(ty, Math.abs(corner.y / dz));
    }
    const hy = ty * 1.15 + 0.02;
    const hx = tx * 1.15 + 0.02;
    virtual.fov = THREE.MathUtils.radToDeg(2 * Math.atan(hy));
    virtual.aspect = hx / hy;
    virtual.updateProjectionMatrix();
    textureMatrix.copy(bias).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    const prevBg = scene.background;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    fadeUniform.value = 1;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, virtual);
    fadeUniform.value = 0;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadow;
    scene.background = prevBg;
  };
  return plane;
}

// 物の真下の、輪郭に沿ったやわらかい影（接地感）。直射日光の影とは別に、床との隙間に溜まる暗がり
export function footprintShadow(box, { spread = 0.06, opacity = 0.85 } = {}) {
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const w = sx + spread * 4;
  const d = sz + spread * 4;
  const px = 256 / Math.max(w, d); // 1m あたりの画素
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * px);
  canvas.height = Math.ceil(d * px);
  const ctx = canvas.getContext('2d');
  // 影の形を画面の外に描き、ぼかした影だけを中へずらして写す（ctx.filter が使えない環境でもぼける）
  const off = canvas.width * 2;
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = spread * px * 1.6;
  ctx.shadowOffsetX = off;
  ctx.fillStyle = '#000';
  const inset = spread * 0.6 * px;
  ctx.fillRect(spread * 2 * px + inset - off, spread * 2 * px + inset, sx * px - inset * 2, sz * px - inset * 2);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((box.min.x + box.max.x) / 2, 0.002, (box.min.z + box.max.z) / 2);
  mesh.renderOrder = 1;
  mesh.userData.noPick = true;
  return mesh;
}
