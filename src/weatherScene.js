import * as THREE from 'three';

// 窓の外の空・景色・雨・雪・稲光と、天気に合わせた室内の光。
// set() で目標の天気を渡すと、数秒かけてなめらかに移り変わる。
//
// rig（部屋側が用意するもの）:
//   lights: { sun, sky, hemi, lamp }  lampMaterial: 蛍光灯のマテリアル
//   landTexture: 空を透明にした景色  horizonY: 水平線の高さ
//   outside: { x0, x1, z0, z1 }  雨や雪を降らせる範囲（窓の外）
export function createWeather({ scene, renderer, rig, initial, onSettled }) {
  const NUM_KEYS = ['sun', 'sky', 'hemi', 'cloudCover', 'fog', 'rain', 'snow', 'thunder', 'lamp', 'exposure'];
  const COLOR_KEYS = ['sunColor', 'skyColor', 'skyTop', 'skyHorizon', 'cloudColor', 'land'];

  const toState = (p) => {
    const s = {};
    for (const k of NUM_KEYS) s[k] = p[k];
    for (const k of COLOR_KEYS) s[k] = new THREE.Color(p[k]);
    return s;
  };
  const current = toState(initial);
  let target = toState(initial);
  let pending = false;

  // ---------- 空（シェーダー） ----------

  const center = new THREE.Vector3(rig.outside.x0, rig.horizonY, (rig.outside.z0 + rig.outside.z1) / 2);
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uCloud: { value: new THREE.Color() },
    uCover: { value: 0 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uCenter: { value: center },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uCloud, uCenter;
        uniform float uCover, uTime, uFlash;
        varying vec3 vWorld;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
          return s;
        }

        void main() {
          vec3 d = normalize(vWorld - uCenter);
          float e = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uTop, pow(e, 0.45));

          // 雲：空を平面に投影してノイズで描き、ゆっくり流す
          vec2 p = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.006, uTime * 0.003);
          float n = fbm(p);
          float m = smoothstep(1.0 - uCover - 0.05, 1.0 - uCover + 0.3, n) * smoothstep(-0.02, 0.1, d.y);
          vec3 cloud = uCloud * (0.82 + 0.36 * fbm(p * 2.7 + 7.0));
          col = mix(col, cloud, m);
          col += uFlash * vec3(0.75, 0.8, 1.0);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  sky.position.copy(center);
  sky.renderOrder = -10;
  sky.userData.noPick = true;
  scene.add(sky);

  // ---------- 景色（街並み・木々） ----------

  const R = 90;
  const landHeight = (Math.PI * R * 768) / 2048;
  const land = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, landHeight, 96, 1, true, 0, Math.PI),
    new THREE.MeshBasicMaterial({ map: rig.landTexture, transparent: true, alphaTest: 0.02, side: THREE.BackSide, depthWrite: false }),
  );
  // テクスチャの水平線（上から 58%）を horizonY に合わせる
  land.position.set(center.x, rig.horizonY + landHeight * (0.58 - 0.5), center.z);
  land.renderOrder = -5;
  land.userData.noPick = true;
  scene.add(land);

  scene.fog = new THREE.FogExp2(0xffffff, 0);

  // ---------- 雨と雪 ----------

  const { x0, x1, z0, z1 } = rig.outside;
  const Y0 = -6;
  const Y1 = 16;
  const rand = (a, b) => a + Math.random() * (b - a);

  const RAIN_MAX = 4000;
  const RAIN_LEN = 0.5;
  const RAIN_SLANT = 0.06;
  const drops = Array.from({ length: RAIN_MAX }, () => ({ x: rand(x0, x1), y: rand(Y0, Y1), z: rand(z0, z1), v: rand(13, 18) }));
  const rainPos = new Float32Array(RAIN_MAX * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(
    rainGeo,
    new THREE.LineBasicMaterial({ color: '#c8d2dc', transparent: true, opacity: 0, depthWrite: false }),
  );
  rain.frustumCulled = false;
  rain.userData.noPick = true;
  scene.add(rain);

  const SNOW_MAX = 3000;
  const flakes = Array.from({ length: SNOW_MAX }, () => ({
    x: rand(x0, x1), y: rand(Y0, Y1), z: rand(z0, z1), v: rand(0.6, 1.2), phase: rand(0, Math.PI * 2),
  }));
  const snowPos = new Float32Array(SNOW_MAX * 3);
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({ size: 0.13, map: dotTexture(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
  );
  snow.frustumCulled = false;
  snow.userData.noPick = true;
  scene.add(snow);

  // ---------- 稲光 ----------

  let flash = 0;
  let nextStrike = 3;
  let strikeQueue = [];

  // ---------- 反映 ----------

  const { sun, sky: skyLight, hemi, lamp } = rig.lights;
  const lampBase = rig.lampMaterial.emissiveIntensity;

  // シャッターの開き具合（0 = 閉まって真っ暗）。日差しはシャッターの影で遮られるので、
  // ここでは窓からの柔らかい光と回り込む光だけを絞る
  let openness = 1;
  // 蛍光灯：シャッターが動き出したら、チカチカしてから点く
  let now = 0;
  let lampStart = openness > 0 ? -10 : Infinity;
  const lampPower = () => {
    if (openness <= 0) return 0;
    const s = now - lampStart;
    if (s > 0.9) return 1;
    return [0.05, 0.12, 0.3, 0.38, 0.55].some((on, i) => s > on && s < on + (i === 4 ? 1 : 0.05)) ? 1 : 0.08;
  };

  function apply() {
    const c = current;
    const lampOn = lampPower();
    // 日差しは基本的にシャッターの影で遮る。ただ細い部材は影の判定から漏れるので、
    // 閉じきっている間だけは光そのものを切る
    sun.intensity = c.sun * Math.min(1, openness * 25);
    sun.color.copy(c.sunColor);
    skyLight.intensity = (c.sky + flash * 10) * openness;
    skyLight.color.copy(c.skyColor);
    hemi.intensity = (c.hemi + flash * 1.5) * (0.02 + 0.98 * openness);
    lamp.intensity = c.lamp * 30 * lampOn;
    rig.lampMaterial.emissiveIntensity = lampBase * 0.4 * openness + c.lamp * 2.5 * lampOn;
    renderer.toneMappingExposure = c.exposure;

    skyUniforms.uTop.value.copy(c.skyTop);
    skyUniforms.uHorizon.value.copy(c.skyHorizon);
    skyUniforms.uCloud.value.copy(c.cloudColor);
    skyUniforms.uCover.value = c.cloudCover;
    skyUniforms.uFlash.value = flash * 0.6;
    land.material.color.copy(c.land);

    scene.fog.color.copy(c.skyHorizon);
    scene.fog.density = c.fog;

    rain.material.opacity = Math.min(1, c.rain) * 0.5;
    rain.visible = c.rain > 0.01;
    rainGeo.setDrawRange(0, Math.round(RAIN_MAX * Math.min(1, c.rain / 1.5)) * 2);
    snow.material.opacity = Math.min(1, c.snow) * 0.9;
    snow.visible = c.snow > 0.01;
  }

  function step(dt) {
    const k = 1 - Math.exp(-dt * 1.8);
    let diff = 0;
    for (const key of NUM_KEYS) {
      const d = target[key] - current[key];
      current[key] += d * k;
      diff = Math.max(diff, Math.abs(d) / (Math.abs(target[key]) + 1));
    }
    for (const key of COLOR_KEYS) {
      const a = current[key];
      const b = target[key];
      diff = Math.max(diff, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
      a.lerp(b, k);
    }
    if (pending && diff < 0.004) {
      pending = false;
      onSettled?.();
    }
  }

  function animateParticles(dt, t) {
    if (rain.visible) {
      const n = rainGeo.drawRange.count / 2;
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        d.x -= d.v * dt * RAIN_SLANT;
        if (d.y < Y0) {
          d.y = Y1;
          d.x = rand(x0, x1);
        }
        const j = i * 6;
        rainPos[j] = d.x;
        rainPos[j + 1] = d.y;
        rainPos[j + 2] = d.z;
        rainPos[j + 3] = d.x + RAIN_LEN * RAIN_SLANT;
        rainPos[j + 4] = d.y + RAIN_LEN;
        rainPos[j + 5] = d.z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (snow.visible) {
      for (let i = 0; i < SNOW_MAX; i++) {
        const f = flakes[i];
        f.y -= f.v * dt;
        if (f.y < Y0) f.y = Y1;
        const j = i * 3;
        snowPos[j] = f.x + Math.sin(t * 0.8 + f.phase) * 0.35;
        snowPos[j + 1] = f.y;
        snowPos[j + 2] = f.z + Math.cos(t * 0.6 + f.phase) * 0.35;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
  }

  function animateLightning(dt, t) {
    if (current.thunder > 0.5 && t > nextStrike) {
      // 一度の雷で 2〜3 回またたく
      strikeQueue = [0, 0.09, 0.22].slice(0, 2 + Math.round(Math.random())).map((o) => t + o);
      nextStrike = t + rand(5, 13);
    }
    if (strikeQueue.length && t >= strikeQueue[0]) {
      strikeQueue.shift();
      flash = rand(0.7, 1);
    }
    flash *= Math.exp(-dt * 14);
  }

  apply();

  return {
    set(params, { instant = false } = {}) {
      target = toState(params);
      if (instant) {
        for (const k of NUM_KEYS) current[k] = target[k];
        for (const k of COLOR_KEYS) current[k].copy(target[k]);
        apply();
        onSettled?.();
        pending = false;
        return;
      }
      pending = true;
    },
    // 移り変わる先の天気をいったん部屋に当てて fn を呼び、元に戻す（行き先の環境マップを先に撮るため）
    previewTarget(fn) {
      const saved = {};
      for (const k of NUM_KEYS) saved[k] = current[k];
      for (const k of COLOR_KEYS) saved[k] = current[k].clone();
      for (const k of NUM_KEYS) current[k] = target[k];
      for (const k of COLOR_KEYS) current[k].copy(target[k]);
      apply();
      fn();
      for (const k of NUM_KEYS) current[k] = saved[k];
      for (const k of COLOR_KEYS) current[k].copy(saved[k]);
      apply();
    },
    setOpenness(value) {
      if (openness <= 0 && value > 0) lampStart = now;
      openness = value;
      apply();
    },
    get openness() {
      return openness;
    },
    update(dt, t) {
      now = t;
      skyUniforms.uTime.value = t;
      step(dt);
      animateLightning(dt, t);
      animateParticles(dt, t);
      apply();
    },
  };
}

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
