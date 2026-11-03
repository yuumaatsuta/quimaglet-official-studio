import * as THREE from 'three';

// 窓の外の近未来の大都市。スタジオは高層の上の階にあり、窓（+x）の外に、
// 見下ろす街並みと、段々に細くなる超高層・円筒のタワーが、もやの奥まで続く。
// 夜は窓明かり・高架を流れる車の光・航空障害灯・空を掃くサーチライトが灯る。
// 文字や看板（ネオンサインなど）は置かない（遠目には崩れて見えるため）。
//
// 天気（weatherScene.js）から setLook() で、夜の度合い（0〜1）を受け取る。
// もやの色は scene.fog の色（地平の空の色）を使う

const CITY = {
  ground: -90, // 地面の高さ（m）。スタジオの床は 0
  x0: 24, // 窓からこの距離より先に建てる
  x1: 330,
  z0: -420,
  z1: 120,
  cell: 19, // 街区の大きさ
  haze: 0.003, // 街のもや（m あたり）。天気の霧に足す
};

// 高架道路（地面からの高さ・始点・終点）。車の光が流れる
const ROADS = [
  { y: 30, a: [20, -40], b: [330, -150] },
  { y: 46, a: [60, 120], b: [140, -420] },
  { y: 22, a: [200, 120], b: [260, -420] },
];

export function createCity(scene) {
  const rand = mulberry(7);
  const group = new THREE.Group();
  group.userData.noPick = true;
  scene.add(group);

  const uniforms = { uNight: { value: 0 }, uTime: { value: 0 } };

  // ---------- 建物 ----------

  const boxes = [];
  const cylinders = [];
  const tops = []; // 航空障害灯を付ける屋上（高い建物）
  const nearRoad = (x, z) =>
    ROADS.some(({ a, b }) => distToSegment(x, z, a, b) < 16);

  for (let x = CITY.x0; x < CITY.x1; x += CITY.cell) {
    for (let z = CITY.z0; z < CITY.z1; z += CITY.cell) {
      const cx = x + CITY.cell / 2 + (rand() - 0.5) * 4;
      const cz = z + CITY.cell / 2 + (rand() - 0.5) * 4;
      if (nearRoad(cx, cz)) continue;
      const far = Math.min(1, (cx - CITY.x0) / 160);
      // 手前は低め（スタジオの床より下で、見下ろす）、奥ほど高い塔が増える
      const r = rand();
      let h = 25 + rand() * 45 + far * 50;
      if (cx > 75 && r > 0.88 - far * 0.14) h = 140 + rand() * 120 * (0.5 + far);
      if (cx > 110 && r > 0.975) h = 260 + rand() * 140;
      const w = 9 + rand() * 7;
      const d = 9 + rand() * 7;
      const seed = rand();
      const tint = 0.55 + rand() * 0.35;
      const round = h > 120 && rand() < 0.35;
      if (round) {
        // 円筒の塔：途中で 1〜2 回細くなる
        let y = CITY.ground;
        let rad = Math.min(w, d) * 0.62;
        const tiers = 1 + Math.floor(rand() * 3);
        for (let t = 0; t < tiers; t++) {
          const th = t === tiers - 1 ? CITY.ground + h - y : h * (0.45 + rand() * 0.2);
          cylinders.push({ x: cx, z: cz, y, h: th, w: rad * 2, d: rad * 2, seed, tint });
          y += th;
          rad *= 0.72;
        }
        tops.push(new THREE.Vector3(cx, y, cz));
      } else {
        // 角の塔：高いものは段々に細くする（セットバック）
        let y = CITY.ground;
        let ww = w;
        let dd = d;
        const tiers = h > 110 ? 2 + Math.floor(rand() * 3) : 1;
        for (let t = 0; t < tiers; t++) {
          const th = t === tiers - 1 ? CITY.ground + h - y : h * (0.5 / tiers + 0.25 + rand() * 0.15);
          boxes.push({ x: cx, z: cz, y, h: th, w: ww, d: dd, seed: seed + t * 0.13, tint });
          y += th;
          ww *= 0.68 + rand() * 0.12;
          dd *= 0.68 + rand() * 0.12;
        }
        // 屋上の設備
        if (rand() < 0.5) boxes.push({ x: cx + (rand() - 0.5) * ww * 0.3, z: cz, y, h: 2 + rand() * 4, w: ww * 0.4, d: dd * 0.4, seed, tint: tint * 0.8, roof: true });
        if (h > 110) tops.push(new THREE.Vector3(cx, y, cz));
      }
    }
  }
  // 遠くにそびえる、ひときわ大きな塔（街の中心）
  for (const [x, z, h, w] of [
    [190, -300, 520, 46],
    [255, -190, 420, 34],
    [150, -380, 380, 30],
  ]) {
    let y = CITY.ground;
    let ww = w;
    for (let t = 0; t < 5; t++) {
      const th = t === 4 ? CITY.ground + h - y : h * 0.2;
      cylinders.push({ x, z, y, h: th, w: ww, d: ww, seed: rand(), tint: 0.6 });
      y += th;
      ww *= 0.8;
    }
    tops.push(new THREE.Vector3(x, y, z));
  }

  // 地面（暗いアスファルト）
  boxes.push({ x: 300, z: -150, y: CITY.ground - 1, h: 1, w: 1400, d: 1400, seed: 0, tint: 0.55, roof: true });
  // 高架道路と橋脚
  for (const road of ROADS) {
    const [ax, az] = road.a;
    const [bx, bz] = road.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ry = -Math.atan2(bz - az, bx - ax);
    boxes.push({ x: (ax + bx) / 2, z: (az + bz) / 2, y: CITY.ground + road.y - 2.2, h: 2.2, w: len, d: 15, ry, seed: 0, tint: 1.1, roof: true });
    for (let s = 0.04; s < 1; s += 0.09) {
      boxes.push({ x: ax + (bx - ax) * s, z: az + (bz - az) * s, y: CITY.ground, h: road.y - 2.2, w: 3, d: 3, ry, seed: 0, tint: 0.9, roof: true });
    }
  }

  const material = buildingMaterial(uniforms, false);
  const roundMaterial = buildingMaterial(uniforms, true);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1).translate(0, 0.5, 0);
  group.add(instanced(boxGeo, material, boxes), instanced(cylGeo, roundMaterial, cylinders));

  // ---------- 車の光 ----------

  group.add(carLights(uniforms));

  // ---------- 航空障害灯・空を飛ぶ乗り物・サーチライト ----------

  group.add(beacons(tops, uniforms), flyers(uniforms));
  const lights = searchlights(uniforms);
  group.add(lights.group);

  for (const o of group.children) {
    o.castShadow = false;
    o.receiveShadow = false;
    o.userData.noPick = true;
  }

  return {
    // night: 0（昼）〜 1（夜）
    setLook({ night }) {
      uniforms.uNight.value = night;
      lights.group.visible = night > 0.05;
    },
    update(t) {
      uniforms.uTime.value = t;
      lights.update(t);
    },
  };
}

function instanced(geometry, material, list) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  const m = new THREE.Matrix4();
  const seeds = new Float32Array(list.length);
  const color = new THREE.Color();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.ry ?? 0);
    m.compose(p.set(b.x, b.y, b.z), q, sc.set(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
    seeds[i] = b.roof ? -1 : b.seed;
    // 外壁：灰〜青みの灰。ところどころ少し暖かい色
    const warm = b.seed > 0.8 ? 0.06 : 0;
    color.setRGB(0.34 * b.tint + warm, 0.37 * b.tint, 0.42 * b.tint - warm * 0.5);
    mesh.setColorAt(i, color);
  });
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  return mesh;
}

// 外壁と窓。窓は格子で描き、夜はところどころ灯る。遠くて窓が数画素より小さくなる所は平均の明るさで塗る（ちらつき防止）。
// もやは街の中だけ強めにかける
function buildingMaterial(uniforms, round) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, envMapIntensity: 0.4 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uHaze: { value: CITY.haze } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aSeed;
varying vec3 vCityPos;
varying vec3 vCityLocal;
varying vec3 vCityScale;
varying vec3 vCityNormal;
varying float vSeed;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vCityLocal = position;
vCityScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vCityPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
vCityNormal = normal;
vSeed = aSeed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight, uTime, uHaze;
varying vec3 vCityPos;
varying vec3 vCityLocal;
varying vec3 vCityScale;
varying vec3 vCityNormal;
varying float vSeed;
float cityHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  bool side = abs(vCityNormal.y) < 0.5 && vSeed >= 0.0;
  // 壁の横方向の座標（m）
  float u = ${round ? 'atan(vCityLocal.z, vCityLocal.x) * 0.5 * vCityScale.x' : 'abs(vCityNormal.x) > 0.5 ? vCityLocal.z * vCityScale.z : vCityLocal.x * vCityScale.x'};
  float v = vCityPos.y;
  // 建物ごとの窓の形：格子窓・横長の帯窓・縦長のスリット
  float style = fract(vSeed * 5.31);
  vec2 cellSize = style < 0.45 ? vec2(2.4, 3.6) : style < 0.8 ? vec2(6.0, 3.9) : vec2(1.4, 4.2);
  vec4 pane = style < 0.45 ? vec4(0.18, 0.86, 0.25, 0.85) : style < 0.8 ? vec4(0.03, 0.97, 0.35, 0.8) : vec4(0.3, 0.7, 0.1, 0.92);
  vec2 g = vec2(u, v) / cellSize;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float win = step(pane.x, f.x) * step(f.x, pane.y) * step(pane.z, f.y) * step(f.y, pane.w);
  // 建物ごとの点灯の多さと色合い
  float ratio = 0.18 + 0.5 * fract(vSeed * 7.31);
  float h = cityHash(cell + vec2(vSeed * 113.0, floor(vCityNormal.x * 3.0 + vCityNormal.z * 7.0)));
  float lit = step(h, ratio);
  float hue = fract(h * 13.7 + vSeed * 3.1);
  vec3 lamp = hue < 0.55 ? vec3(1.0, 0.52, 0.2) : hue < 0.8 ? vec3(0.62, 0.78, 1.0) : hue < 0.92 ? vec3(0.15, 0.85, 1.0) : vec3(1.0, 0.18, 0.1);
  // ゆっくり点いたり消えたり
  lit *= step(0.02, fract(h * 91.0 + uTime * 0.004 * fract(vSeed * 17.0)));
  // 窓が小さく見える所は平均で塗る
  float px = max(fwidth(g.x), fwidth(g.y));
  float detail = 1.0 - smoothstep(0.25, 0.7, px);
  // 窓は壁の約 4 割なので、平均は点灯率 × 0.4
  float glow = mix(ratio * 0.4, win * lit, detail);
  vec3 avgLamp = vec3(1.0, 0.6, 0.35);
  vec3 lampCol = mix(avgLamp, lamp, detail);
  if (side) {
    // 昼：窓ガラスは外壁より暗く、少し青い
    float glass = mix(0.55, win, detail);
    diffuseColor.rgb *= mix(1.0, 0.55, glass * (1.0 - uNight));
    diffuseColor.rgb += vec3(0.0, 0.02, 0.05) * glass * (1.0 - uNight);
    totalEmissiveRadiance += lampCol * glow * uNight * 1.5;
  }
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float cityFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth) * exp(-uHaze * vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(cityFog, 0.0, 0.96));
#endif`,
      );
  };
  mat.customProgramCacheKey = () => `city${round}`;
  return mat;
}

// 高架を流れる車の光。行きは白いヘッドライト、帰りは赤いテールライト
function carLights(uniforms) {
  const PER = 260;
  const n = PER * ROADS.length;
  const pos = new Float32Array(n * 3);
  const a = new Float32Array(n * 4); // 道路の番号・進み具合・車線・速さ
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / PER);
    const dir = Math.random() < 0.5 ? 1 : -1;
    a.set([r, Math.random(), dir * (1.5 + Math.random() * 4.5), dir * (0.012 + Math.random() * 0.01)], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCar', new THREE.BufferAttribute(a, 4));
  const starts = ROADS.map((r) => new THREE.Vector3(r.a[0], CITY.ground + r.y + 1.4, r.a[1]));
  const ends = ROADS.map((r) => new THREE.Vector3(r.b[0], CITY.ground + r.y + 1.4, r.b[1]));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uA: { value: starts }, uB: { value: ends } },
      vertexShader: /* glsl */ `
        attribute vec4 aCar;
        uniform vec3 uA[${ROADS.length}];
        uniform vec3 uB[${ROADS.length}];
        uniform float uTime;
        varying vec3 vColor;
        void main() {
          int r = int(aCar.x + 0.5);
          vec3 a = uA[0], b = uB[0];
          for (int i = 0; i < ${ROADS.length}; i++) if (i == r) { a = uA[i]; b = uB[i]; }
          vec3 dir = b - a;
          vec3 side = normalize(vec3(-dir.z, 0.0, dir.x));
          float s = fract(aCar.y + uTime * aCar.w);
          vec3 p = a + dir * s + side * aCar.z;
          vColor = aCar.z > 0.0 ? vec3(1.0, 0.92, 0.8) : vec3(1.0, 0.12, 0.08);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(260.0 / -mv.z, 1.0, 4.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor * (0.25 + uNight * 1.6), smoothstep(0.5, 0.1, d) * (0.35 + 0.65 * uNight));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

// 高い建物の屋上の、赤くゆっくり点滅する航空障害灯
function beacons(tops, uniforms) {
  const pos = new Float32Array(tops.length * 3);
  const phase = new Float32Array(tops.length);
  tops.forEach((p, i) => {
    pos.set([p.x, p.y + 1.5, p.z], i * 3);
    phase[i] = Math.random();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vOn;
        void main() {
          float t = fract(uTime * 0.5 + aPhase);
          vOn = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.25, 0.5, t));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(900.0 / -mv.z, 2.0, 7.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vOn;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.12, 0.06) * (0.6 + uNight * 2.0), smoothstep(0.5, 0.0, d) * vOn * (0.4 + 0.6 * uNight));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

// 街の上をゆっくり横切る、空飛ぶ乗り物の灯り（白と赤のまたたき）
function flyers(uniforms) {
  const N = 18;
  const a = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) a.set([60 + Math.random() * 220, 10 + Math.random() * 90, Math.random(), (Math.random() < 0.5 ? 1 : -1) * (0.004 + Math.random() * 0.006)], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aFly', new THREE.BufferAttribute(a, 4));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aFly;
        uniform float uTime;
        varying float vOn;
        void main() {
          float s = fract(aFly.z + uTime * aFly.w);
          vec3 p = vec3(aFly.x, aFly.y, mix(-420.0, 120.0, s));
          vOn = step(0.7, fract(uTime * 1.3 + aFly.z * 9.0)) + 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(500.0 / -mv.z, 1.5, 4.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vOn;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.9) * (0.4 + uNight * 1.6), smoothstep(0.5, 0.0, d) * vOn * (0.3 + 0.7 * uNight));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pts.frustumCulled = false;
  return pts;
}

// 夜空をゆっくり掃くサーチライト（下から上へ薄れる光の筋）
function searchlights(uniforms) {
  const group = new THREE.Group();
  const beams = [];
  const geo = new THREE.CylinderGeometry(9, 0.6, 1, 24, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vH = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vN), vView)), 1.5);
        float a = (1.0 - vH) * (1.0 - vH) * edge * 0.16 * uNight;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  for (const [x, z, phase] of [
    [120, -200, 0],
    [210, -90, 2.1],
    [170, -330, 4.0],
    [260, -260, 1.2],
  ]) {
    const beam = new THREE.Mesh(geo, mat);
    beam.position.set(x, CITY.ground + 40, z);
    beam.scale.set(1, 420, 1);
    beam.userData.phase = phase;
    beam.frustumCulled = false;
    group.add(beam);
    beams.push(beam);
  }
  return {
    group,
    update(t) {
      for (const b of beams) {
        const p = b.userData.phase;
        b.rotation.set(0.35 * Math.sin(t * 0.11 + p), 0, 0.4 * Math.sin(t * 0.07 + p * 1.7), 'YXZ');
      }
    },
  };
}

function distToSegment(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
