import * as THREE from 'three';

// メンバーの名前を、床のチップの真上に浮かぶ立体のホログラムにする（main.js の updateMember から動かす）。
// 文字を描いた板を前後に少しずつずらして重ね（奥の板は濃い青、手前の板は明るい水色）、厚みのある光の文字に見せる。
// ゆっくり左右に振れるので、厚みが分かる。走査線とちらつきはシェーダーで付ける
const LAYERS = 14;
const DEPTH = 0.045; // 文字の厚み（m）
const HEIGHT = 0.3; // 板の高さ（m）。幅は文字の長さで決まる
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
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(map, vUv);
    // 画面の走査線（流れる）と、文字の横の揺らぎ
    float scan = 0.78 + 0.22 * sin(gl_FragCoord.y * 1.7 - time * 9.0);
    float band = smoothstep(0.0, 0.04, abs(fract(vUv.y * 0.7 - time * 0.35) - 0.5));
    vec3 c = mix(color, t.rgb * color, front) * scan * mix(1.3, 1.0, band);
    // 奥の板は文字の芯だけ（にじみまで重ねるとぼやける）
    float al = mix(smoothstep(0.45, 0.75, t.a), t.a, front);
    gl_FragColor = vec4(c, al * opacity);
    #include <colorspace_fragment>
  }`;

export function createMemberHolo(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 10;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const layers = [];
  for (let i = 0; i < LAYERS; i++) {
    const back = i / (LAYERS - 1); // 0: いちばん手前、1: いちばん奥
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        color: { value: i === 0 ? new THREE.Color(1, 1, 1) : new THREE.Color().setRGB(0.12 + 0.2 * (1 - back), 0.35 + 0.3 * (1 - back), 0.95) },
        front: { value: i === 0 ? 1 : 0 },
        opacity: { value: 0 },
        time: { value: 0 },
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
  scene.add(group);

  // 名前（大きく）と、ローマ字（小さく、字間を空けて）を描く。板の横幅を文字に合わせる
  function draw(name, nameEn) {
    ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
    const font = 'Inter, "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif';
    let size = 150;
    ctx.font = `700 ${size}px ${font}`;
    const w = ctx.measureText(name).width;
    if (w > CANVAS.w - 80) {
      size *= (CANVAS.w - 80) / w;
      ctx.font = `700 ${size}px ${font}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const nameY = nameEn ? 170 : 200;
    // 光のにじみ → 芯
    ctx.shadowColor = 'rgba(70, 160, 255, 0.9)';
    ctx.shadowBlur = 22;
    ctx.fillStyle = 'rgb(150, 205, 255)';
    ctx.fillText(name, CANVAS.w / 2, nameY);
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgb(235, 246, 255)';
    ctx.fillText(name, CANVAS.w / 2, nameY);
    if (nameEn) {
      ctx.font = `500 46px ${font}`;
      ctx.letterSpacing = '14px';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgb(140, 200, 255)';
      ctx.fillText(nameEn.toUpperCase(), CANVAS.w / 2, 256);
      ctx.letterSpacing = '0px';
    }
    ctx.shadowBlur = 0;
    texture.needsUpdate = true;
  }

  const base = new THREE.Vector3();
  let shownFor = null;
  return {
    // 名前を描き直す（同じメンバーなら描かない）
    set(member) {
      if (shownFor === member) return;
      shownFor = member;
      draw(member.name ?? '', member.nameEn ?? '');
    },
    // at: 名前の中心の位置（ワールド）、a: 映り具合 0〜1、t: 時間（秒）
    update(at, a, t) {
      group.visible = a > 0.003 && !!at;
      if (!group.visible) return;
      base.copy(at);
      // 下から浮かび上がる
      group.position.set(base.x, base.y - (1 - a) * 0.18, base.z);
      group.rotation.y = 0.2 * Math.sin(t * 0.55);
      group.rotation.x = 0.03 * Math.sin(t * 0.8);
      const width = HEIGHT * (CANVAS.w / CANVAS.h);
      const glitch = Math.sin(t * 13.7) * Math.sin(t * 3.1) > 0.97 ? 0.012 : 0; // ときどき横にずれる
      for (const mesh of layers) {
        const back = mesh.userData.back;
        mesh.scale.set(width * (0.6 + 0.4 * a), HEIGHT, 1);
        mesh.position.set(back === 0 ? glitch : 0, 0, -back * DEPTH * a);
        mesh.material.uniforms.opacity.value = a * (back === 0 ? 1 : 0.75 - 0.35 * back);
        mesh.material.uniforms.time.value = t;
      }
    },
  };
}
