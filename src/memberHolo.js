import * as THREE from 'three';

// メンバーの名前を、床のチップの真上に浮かぶ立体のホログラムにする（main.js の updateMember から動かす）。
// 文字を描いた板を前後に少しずつずらして重ね（奥の板は濃い青、手前の板は明るい水色）、厚みのある光の文字に見せる。
// 位置・大きさ・向きは固定（正面向き）。走査線と、たまに起きる映りの乱れはシェーダーだけで付け、板そのものは動かさない
const LAYERS = 14;
const DEPTH = 0.045; // 文字の厚み（m）
const HEIGHT = 0.22; // 板の高さ（m）。幅は文字の長さで決まる
const CANVAS = { w: 1024, h: 300 };

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 color;
  uniform float opacity;
  uniform float time;
  uniform float front; // 1: いちばん手前の板（文字の色とにじみをそのまま）、0: 奥の板（側面の色で塗る）
  uniform float glitch; // 映りの乱れ（-1〜1、ふだんは 0）
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 uv = vUv;
    // 乱れている間だけ、横の帯ごとに像が左右へずれる（板そのものは動かさない）
    float row = floor(uv.y * 9.0 + floor(time * 30.0) * 3.1);
    uv.x += glitch * (hash(row) - 0.5) * 0.05 * step(0.45, hash(row + 7.0));
    vec4 t = texture2D(map, uv);
    // 画面の走査線（ゆっくり流れる）と、ときどき通る明るい帯
    float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 1.7 - time * 2.0);
    float band = smoothstep(0.0, 0.04, abs(fract(vUv.y * 0.7 - time * 0.12) - 0.5));
    vec3 c = mix(color, t.rgb * color, front) * scan * mix(1.2, 1.0, band) * (1.0 - 0.35 * abs(glitch));
    // 奥の板は文字の芯だけ（にじみまで重ねるとぼやける）
    float al = mix(smoothstep(0.45, 0.75, t.a), t.a, front);
    gl_FragColor = vec4(c, al * opacity);
    #include <colorspace_fragment>
  }`;

// たまに起きる映りの乱れ（-1〜1）。約 4.5 秒ごとに 0.25 秒だけ、細かく揺れる。それ以外は 0
function glitch(t) {
  const period = 4.5;
  const k = Math.floor(t / period);
  const start = ((k * 0.618) % 1) * (period - 0.4); // 毎回違う時刻に起きる
  const local = t - k * period - start;
  if (local < 0 || local > 0.25) return 0;
  const env = Math.sin((local / 0.25) * Math.PI);
  return env * Math.sign(Math.sin(t * 90)) * (0.5 + 0.5 * Math.abs(Math.sin(t * 37)));
}

export function createMemberHolo(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // いちばん手前の板だけの絵（名前に、小さい日本語の名前を足したもの）。小さい字は厚みを付けるとつぶれるので、奥の板には描かない
  const frontCanvas = document.createElement('canvas');
  frontCanvas.width = CANVAS.w;
  frontCanvas.height = CANVAS.h;
  const frontCtx = frontCanvas.getContext('2d');
  const frontTexture = new THREE.CanvasTexture(frontCanvas);
  frontTexture.colorSpace = THREE.SRGBColorSpace;
  frontTexture.anisotropy = 4;

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 10;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const layers = [];
  for (let i = 0; i < LAYERS; i++) {
    const back = i / (LAYERS - 1); // 0: いちばん手前、1: いちばん奥
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: i === 0 ? frontTexture : texture },
        color: { value: i === 0 ? new THREE.Color(1, 1, 1) : new THREE.Color().setRGB(0.12 + 0.2 * (1 - back), 0.35 + 0.3 * (1 - back), 0.95) },
        front: { value: i === 0 ? 1 : 0 },
        opacity: { value: 0 },
        time: { value: 0 },
        glitch: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 20 - i; // 奥の板から描き、手前の板を上に重ねる
    mesh.userData.back = back;
    mesh.userData.noPick = true;
    layers.push(mesh);
    group.add(mesh);
  }
  // 文字の後ろの暗い影（後ろの壁の落書きやブラウン管に重なっても読めるように）。いちばん奥に、ふつうの重ね方で描く
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = CANVAS.w;
  shadowCanvas.height = CANVAS.h;
  const shadowCtx = shadowCanvas.getContext('2d');
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: '#020611', map: shadowTexture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  shadow.renderOrder = 20 - LAYERS; // 文字の板（20 - i）より先に描く
  shadow.userData.noPick = true;
  group.add(shadow);
  scene.add(group);

  // 名前（大きく）と、ローマ字（小さく、字間を空けて）を描く。板の横幅を文字に合わせる
  // 英語の名前を主役に：名は細く、姓は太く、字間を空けて 1 行に。下に小さく日本語の名前と、両脇の細い線
  function draw(name, nameEn) {
    const font = 'Inter, "Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", sans-serif';
    const en = String(nameEn || '').trim().toUpperCase();
    const [first, ...rest] = (en || name).split(/\s+/);
    const last = rest.join(' ');
    const sub = en ? name : '';
    let size = 120;
    const spacing = () => `${Math.round(size * 0.1)}px`;
    // 名・空き・姓の幅を測って、はみ出すなら縮める
    const measure = (c) => {
      c.letterSpacing = spacing();
      c.font = `300 ${size}px ${font}`;
      const a = c.measureText(first).width;
      c.font = `800 ${size}px ${font}`;
      const b = last ? c.measureText(last).width : 0;
      return { a, b, gap: last ? size * 0.32 : 0 };
    };
    let m = measure(ctx);
    const max = CANVAS.w - 60;
    if (m.a + m.gap + m.b > max) {
      size *= max / (m.a + m.gap + m.b);
      m = measure(ctx);
    }
    const nameY = sub ? 160 : 190;
    const x0 = (CANVAS.w - (m.a + m.gap + m.b)) / 2;
    const paint = (c, stroke, withSub = true) => {
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.letterSpacing = spacing();
      c.font = `300 ${size}px ${font}`;
      if (stroke) c.strokeText(first, x0, nameY);
      c.fillText(first, x0, nameY);
      if (last) {
        c.font = `800 ${size}px ${font}`;
        if (stroke) c.strokeText(last, x0 + m.a + m.gap, nameY);
        c.fillText(last, x0 + m.a + m.gap, nameY);
      }
      if (sub && withSub) {
        c.textAlign = 'center';
        c.font = `600 42px ${font}`;
        c.letterSpacing = '12px';
        if (stroke) c.strokeText(sub, CANVAS.w / 2, 242);
        c.fillText(sub, CANVAS.w / 2, 242);
      }
      c.letterSpacing = '0px';
    };

    // 光のにじみ → 芯。奥の板の絵は名前だけ、手前の板の絵は日本語の名前と線も
    for (const [c, withSub] of [[ctx, false], [frontCtx, true]]) {
      c.clearRect(0, 0, CANVAS.w, CANVAS.h);
      c.shadowColor = 'rgba(70, 160, 255, 0.9)';
      c.shadowBlur = 22;
      c.fillStyle = 'rgb(150, 205, 255)';
      paint(c, false, withSub);
      c.shadowBlur = 6;
      c.fillStyle = 'rgb(235, 246, 255)';
      paint(c, false, withSub);
      c.shadowBlur = 0;
    }
    // 日本語の名前の両脇の細い線
    if (sub) {
      const ctx = frontCtx;
      ctx.font = `600 42px ${font}`;
      ctx.letterSpacing = '12px';
      const sw = ctx.measureText(sub).width;
      ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(140, 200, 255, 0.85)';
      ctx.shadowBlur = 8;
      ctx.fillRect(CANVAS.w / 2 - sw / 2 - 110, 228, 80, 2);
      ctx.fillRect(CANVAS.w / 2 + sw / 2 + 30, 228, 80, 2);
    }
    texture.needsUpdate = true;
    frontTexture.needsUpdate = true;

    // 影：文字を太らせて（縁取り）、大きくぼかす
    const sc = shadowCtx;
    sc.clearRect(0, 0, CANVAS.w, CANVAS.h);
    sc.filter = 'blur(12px)';
    sc.fillStyle = sc.strokeStyle = '#fff';
    sc.lineJoin = 'round';
    sc.lineWidth = 30;
    paint(sc, true);
    sc.filter = 'none';
    shadowTexture.needsUpdate = true;
  }

  let shownFor = null;
  return {
    // 名前を描き直す（同じメンバーなら描かない）
    set(member) {
      if (shownFor === member) return;
      shownFor = member;
      draw(member.name ?? '', member.nameEn ?? '');
    },
    // at: 名前の中心の位置（ワールド）、a: 映り具合 0〜1（出るとき・消えるときの濃さだけに使う）、t: 時間（秒）
    update(at, a, t) {
      group.visible = a > 0.003 && !!at;
      if (!group.visible) return;
      // 位置・大きさ・厚み・向きは固定。変わるのは濃さと、シェーダーの中の映りの乱れだけ
      group.position.copy(at);
      group.rotation.set(0, 0, 0);
      const g = glitch(t);
      const width = HEIGHT * (CANVAS.w / CANVAS.h);
      shadow.scale.set(width, HEIGHT, 1);
      shadow.position.set(0, 0, -DEPTH - 0.01);
      shadow.material.opacity = 0.88 * a;
      for (const mesh of layers) {
        const back = mesh.userData.back;
        mesh.scale.set(width, HEIGHT, 1);
        mesh.position.set(0, 0, -back * DEPTH);
        const u = mesh.material.uniforms;
        u.opacity.value = a * (back === 0 ? 1 : 0.75 - 0.35 * back);
        u.time.value = t;
        u.glitch.value = g;
      }
    },
  };
}
