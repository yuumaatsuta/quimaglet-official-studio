import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';
import { SECTIONS } from './content.js';
import { createHotspots } from './hotspots.js';
import { createInput, isTouchDevice } from './input.js';
import { createPanel } from './panel.js';
import { loadRoom } from './room.js';
import { KINDS, LOCATION, fetchCurrentWeather, weatherParams } from './weather.js';
import { createWeatherPanel } from './weatherPanel.js';
import { createWeather } from './weatherScene.js';
import { fitWindow, updateWindowCamera } from './windowCamera.js';

if (isTouchDevice()) document.documentElement.classList.add('is-touch');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bootLabel = document.getElementById('boot-label');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true; // シャッターの幕を巻き取り位置で切り取る
document.getElementById('app').append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#000');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const room = await loadRoom(CONFIG.modelUrl, (p) => {
  bootLabel.textContent = `LOADING... ${Math.floor(p * 100)}%`;
});
scene.add(room.group);
// 部屋ごとの見え方の上書き（目線の高さ・画角など）
const view = { ...CONFIG.view, ...room.view };
const camera = new THREE.PerspectiveCamera(50, 1, view.near, view.far);

// 部屋の中から周囲を撮り、映り込みと回り込む光に使う
// （床に窓の光が映り、壁の陰も部屋の色で持ち上がる）。天気が変わるたびに撮り直す。
// シャッターが閉まっていても、開いたときの部屋を撮る
let envBase = room.hasLights ? 0.3 : 1.0;
const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const cubeCamera = new THREE.CubeCamera(0.05, view.far, cubeTarget);
const envMixer = createEnvMixer();
// blend: 今の環境マップから、天気の移り変わりと同じ速さでなめらかに替える
// （光だけ先に変わって、あとから映り込みがいきなり替わると、暗くなるのが 2 段階に見える）
function captureEnvironment(blend = false) {
  if (!room.probe) return;
  const open = shutterOpen;
  setShutter(1, false);
  cubeCamera.position.copy(room.probe);
  cubeCamera.update(renderer, scene);
  setShutter(open, false);
  envMixer.capture(cubeTarget.texture, blend);
  envBase = room.hasLights ? 0.5 : 1.0;
}

// 環境マップを少しずつ切り替える。撮った周囲の画像（キューブ）を「元」と「行き先」で混ぜ、
// 混ぜた画像から部屋に当てる環境マップ（shown、ずっと同じ 1 枚）を作り直す
function createEnvMixer() {
  const SIZE = 256;
  const makeCube = () => new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType });
  const fromCube = makeCube();
  const toCube = makeCube();
  const mixCube = makeCube(); // いま部屋に当てている画像の元
  const mat = new THREE.ShaderMaterial({
    uniforms: { a: { value: null }, b: { value: null }, k: { value: 0 } },
    vertexShader: `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform samplerCube a;
uniform samplerCube b;
uniform float k;
varying vec3 vDir;
void main() { vec3 d = normalize(vDir); gl_FragColor = mix(textureCube(a, d), textureCube(b, d), k); }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  // 目のまわりを包む箱に、2 つの画像を方向ごとに混ぜて描き、それをキューブカメラで撮る
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  const mixScene = new THREE.Scene().add(box);
  const mixCamera = new THREE.CubeCamera(0.1, 10, mixCube);
  mixScene.add(mixCamera);
  let shown = null;
  let k = 1;

  const draw = (a, b, amount, target) => {
    mat.uniforms.a.value = a;
    mat.uniforms.b.value = b;
    mat.uniforms.k.value = amount;
    mixCamera.renderTarget = target;
    mixCamera.update(renderer, mixScene);
  };
  const apply = () => {
    shown = pmrem.fromCubemap(mixCube.texture, shown);
    scene.environment = shown.texture;
  };

  return {
    capture(cubeTexture, blend) {
      draw(cubeTexture, cubeTexture, 1, toCube);
      if (!shown || !blend) {
        draw(toCube.texture, toCube.texture, 1, mixCube);
        apply();
        k = 1;
        return;
      }
      // いま見えている画像（切り替えの途中なら混ざった画像）から始める
      draw(mixCube.texture, mixCube.texture, 0, fromCube);
      k = 0;
    },
    update(dt) {
      if (k >= 1) return;
      // weatherScene.js の移り変わりと同じ速さ
      k += (1 - k) * (1 - Math.exp(-dt * 1.8)) + dt * 0.01;
      if (k > 0.995) k = 1;
      draw(fromCube.texture, toCube.texture, k, mixCube);
      apply();
    },
  };
}

// ---------- シャッター ----------

// 開くと真っ暗な部屋に光が差し込む。閉まっている間は回り込む光も絞る
const SHUTTER_SECONDS = 7;
let shutterOpen = room.shutter ? 0 : 1;
let shutterProgress = shutterOpen;
let shutterTarget = shutterOpen;
function setShutter(open, moving) {
  shutterOpen = open;
  room.shutter?.setOpen(open, moving);
  weather?.setOpenness(open);
  scene.environmentIntensity = envBase * open;
}
function updateShutter(dt) {
  if (shutterProgress === shutterTarget) return;
  const dir = Math.sign(shutterTarget - shutterProgress);
  shutterProgress = THREE.MathUtils.clamp(shutterProgress + (dir * dt) / SHUTTER_SECONDS, 0, 1);
  if ((dir > 0 && shutterProgress >= shutterTarget) || (dir < 0 && shutterProgress <= shutterTarget)) {
    shutterProgress = shutterTarget;
  }
  // モーター駆動らしく、ほぼ一定の速さで、動き出しと止まり際だけ少しやわらかく
  const p = shutterProgress;
  const open = 0.85 * p + 0.15 * (0.5 - 0.5 * Math.cos(Math.PI * p));
  const moving = shutterProgress !== shutterTarget;
  setShutter(open, moving);
  if (!moving && open === 1) captureEnvironment();
}
function toggleShutter() {
  shutterTarget = shutterTarget > 0.5 ? 0 : 1;
}

// ---------- 天気 ----------

let weather = null;
if (room.weatherRig) {
  weather = createWeather({
    scene,
    renderer,
    rig: room.weatherRig,
    initial: weatherParams('clear', true),
    onSettled: () => captureEnvironment(true),
  });
}
setShutter(shutterOpen, false);
captureEnvironment();

if (weather) {
  // 最初の 1 回はすぐに切り替え、以降はなめらかに移り変わらせる
  let shown = false;
  const setWeather = (params) => {
    const instant = !shown;
    weather.set(params, { instant });
    shown = true;
    // 夜は吊り下げの照明を下ろす
    room.nightLights?.setNight(!!params.night);
    // 行き先の天気の環境マップを先に撮り、光と一緒に少しずつ替える
    if (!instant) weather.previewTarget(() => captureEnvironment(true));
  };

  const weatherPanel = CONFIG.weatherPanel
    ? createWeatherPanel({
        onShutter: room.shutter ? toggleShutter : null,
        onLive: applyLiveWeather,
        onManual: (kind, isDay) => {
          setWeather(weatherParams(kind, isDay));
          weatherPanel.setStatus(`試作：${KINDS[kind]}${isDay ? '' : '（夜）'}`);
        },
      })
    : null;

  async function applyLiveWeather() {
    weatherPanel?.setStatus(`${LOCATION.name}の天気を取得中…`);
    try {
      const now = await fetchCurrentWeather();
      if (weatherPanel && !weatherPanel.live) return;
      setWeather(now.params);
      const time = now.time.slice(11, 16);
      weatherPanel?.setStatus(
        `${LOCATION.name} ${time}　${KINDS[now.kind]}${now.isDay ? '' : '（夜）'}　${Math.round(now.temperature)}°C`,
      );
    } catch (err) {
      console.warn('[weather]', err);
      weatherPanel?.setStatus(`${LOCATION.name}の天気を取得できませんでした`);
    }
  }

  // ?weather=rain&night のように URL で天気を指定できる（試作の共有・確認用）
  const query = new URLSearchParams(location.search);
  const fixed = query.get('weather');
  if (fixed && KINDS[fixed] && weatherPanel) {
    weatherPanel.select(fixed, !query.has('night'));
  } else {
    applyLiveWeather();
  }
  setInterval(() => {
    if (!weatherPanel || weatherPanel.live) applyLiveWeather();
  }, CONFIG.weatherRefreshMinutes * 60 * 1000);
}

// ---------- 視点 ----------

const input = createInput();
let win;
let eyeDistance;
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  win = fitWindow(room.bounds, innerWidth / innerHeight, view.crop, view.eyeHeight);
  eyeDistance = Math.max(win.halfW, win.halfH) * view.distanceFactor;
}
onResize();
addEventListener('resize', onResize);

const motion = reducedMotion ? 0.3 : 1;
const eye = new THREE.Vector3(win.cx, win.cy, win.cz + eyeDistance);
const eyeTarget = new THREE.Vector3();

// ---------- ズーム（中央のブラウン管など、room.focus の物を押したとき） ----------
// 窓（画面）そのものを物の手前まで縮めて近づける。窓の見せ方（off-axis）はそのまま
const ZOOM = {
  margin: 1.35, // 物の大きさに対する余白（大きいほど引き気味）
  gap: 0.08, // 物の前面から窓までの距離（m）
  seconds: 1.4, // ズームにかかる時間
};
const zoom = { target: null, amount: 0, to: 0, focusWin: null };
const shownWin = { cx: 0, cy: 0, cz: 0, halfW: 1, halfH: 1 };
const robotEye = new THREE.Vector3();
const zoomBack = document.getElementById('zoom-back');

function focusWindow(obj) {
  // 床の影など、押せない飾りは大きさに含めない
  const box = new THREE.Box3();
  obj.traverse((o) => o.isMesh && !o.userData.noPick && box.expandByObject(o, true));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const aspect = innerWidth / innerHeight;
  let halfH = (size.y / 2) * ZOOM.margin;
  let halfW = halfH * aspect;
  const minHalfW = (size.x / 2) * ZOOM.margin;
  if (halfW < minHalfW) {
    halfW = minHalfW;
    halfH = halfW / aspect;
  }
  return { cx: c.x, cy: c.y, cz: box.max.z + ZOOM.gap, halfW, halfH };
}

function zoomTo(id) {
  const obj = room.focus?.get(id);
  if (!obj) return false;
  zoom.target = obj;
  zoom.focusWin = focusWindow(obj);
  zoom.to = 1;
  hotspots.setEnabled(false);
  document.body.classList.add('is-zoomed');
  zoomBack.hidden = false;
  return true;
}

function zoomOut() {
  if (!zoom.to) return;
  zoom.to = 0;
  document.body.classList.remove('is-zoomed');
  zoomBack.hidden = true;
}

zoomBack.addEventListener('click', zoomOut);
addEventListener('keydown', (e) => e.key === 'Escape' && zoomOut());
// ズーム中は画面のどこを押しても戻る
addEventListener('pointerup', (e) => {
  if (zoom.to && zoom.amount > 0.6 && e.target.tagName === 'CANVAS') zoomOut();
});

const ease = (x) => x * x * (3 - 2 * x);
function updateZoom(dt) {
  const step = dt / ZOOM.seconds;
  zoom.amount = zoom.to ? Math.min(1, zoom.amount + step) : Math.max(0, zoom.amount - step);
  if (!zoom.to && zoom.amount === 0 && zoom.target) {
    zoom.target = null;
    if (document.getElementById('panel').hidden) hotspots.setEnabled(true);
  }
  if (zoom.target) zoom.focusWin = focusWindow(zoom.target);
  const k = ease(zoom.amount);
  const fw = zoom.focusWin ?? win;
  for (const key of ['cx', 'cy', 'cz', 'halfW', 'halfH']) shownWin[key] = THREE.MathUtils.lerp(win[key], fw[key], k);
  return k;
}

// ---------- クリックできる家具とパネル ----------

const tooltip = document.getElementById('tooltip');
const hotspots = createHotspots({
  camera,
  root: room.group,
  hotspots: room.hotspots,
  sections: SECTIONS,
  tooltip,
  highlightColor: CONFIG.highlightColor,
  onSelect: (id) => zoomTo(id) || requestSection(id),
});
const panel = createPanel(SECTIONS, {
  onRequest: requestSection,
  onOpen: () => {
    zoomOut();
    hotspots.setEnabled(false);
    holo.beamTo = 1;
    document.body.classList.add('is-holo'); // 後ろの大きな文字を退かす
  },
  onClosing: () => {
    holo.beamTo = 0;
    document.body.classList.remove('is-holo');
    room.robot?.release({ win });
  },
  onClose: () => !zoom.target && !holo.pending && hotspots.setEnabled(true),
});

// ---------- ロボットを押す ----------
// クリック・タップすると、ぴょんと跳ねて首を振り、こちらを見る（studioRoom.js の poke）
const robotRay = new THREE.Raycaster();
const robotNdc = new THREE.Vector2();
let robotDown = null;
let robotPointer = null; // マウスの位置（ホバーでカーソルを変える）
let robotHovered = false;

function hitRobot(x, y) {
  if (!room.robot) return false;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  return robotRay.intersectObject(room.robot.object, true).some((h) => h.object.isMesh && !h.object.userData.noPick);
}

// 夜の吊り下げ照明（押すと点く・消える）
function hitNightLight(x, y) {
  const lights = room.nightLights;
  if (!lights?.active) return false;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  return robotRay.intersectObjects(lights.hitTargets, true).length > 0;
}

addEventListener('pointerdown', (e) => {
  robotDown = e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY } : null;
});
addEventListener('pointerup', (e) => {
  if (!robotDown) return;
  const moved = Math.hypot(e.clientX - robotDown.x, e.clientY - robotDown.y);
  robotDown = null;
  if (moved > 8) return;
  if (hitRobot(e.clientX, e.clientY)) room.robot.poke();
  else if (hitNightLight(e.clientX, e.clientY)) room.nightLights.toggle();
});
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') robotPointer = { x: e.clientX, y: e.clientY, dirty: true };
});

function updateRobotHover() {
  if (!robotPointer?.dirty) return;
  robotPointer.dirty = false;
  const over =
    !panel.isOpen && (hitRobot(robotPointer.x, robotPointer.y) || hitNightLight(robotPointer.x, robotPointer.y));
  if (over === robotHovered) return;
  robotHovered = over;
  document.body.style.cursor = over ? 'pointer' : '';
}

// ---------- ホログラム ----------
// メニューを押すと、ロボットが今いる所から画面の中央上まで飛んできて、
// 顔の下の投影口から光を当て、選んだページを半透明の青いパネル（ホログラム）として映す
const HOLO = {
  at: { sx: 0, sy: 0.7 }, // ロボットが止まる画面上の位置（窓の左右・上下の割合 -1〜1）。パネルの上端は style.css の --holo-top
  openDelay: 0.35, // 着いてから投影口を光らせ、パネルを映し始めるまで（秒）
  timeout: 6, // 飛んでくるのが遅いときは、これを過ぎたら先に映す
};
const holo = { pending: null, wait: 0, openIn: -1, beam: 0, beamTo: 0 };
const beamCanvas = document.getElementById('holo-beam');
const beamCtx = beamCanvas.getContext('2d');
const panelEl = document.getElementById('panel');
const emitterPos = new THREE.Vector3();

function requestSection(id) {
  if (!SECTIONS[id]) return;
  if (!room.robot || panel.isOpen) return panel.open(id);
  zoomOut();
  hotspots.setEnabled(false);
  holo.pending = id;
  holo.wait = 0;
  holo.openIn = -1;
  room.robot.summon(HOLO.at.sx, HOLO.at.sy);
}

// 飛んでくる途中で Esc を押したら取りやめる
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !holo.pending) return;
  holo.pending = null;
  holo.beamTo = 0;
  room.robot?.release({ win });
  if (!zoom.target) hotspots.setEnabled(true);
});

function updateHologram(dt, t) {
  if (holo.pending) {
    holo.wait += dt;
    if (holo.openIn < 0 && (room.robot.arrived || holo.wait > HOLO.timeout)) {
      holo.openIn = HOLO.openDelay;
      holo.beamTo = 0.6; // まず投影口だけ光らせる
    }
    if (holo.openIn >= 0 && (holo.openIn -= dt) <= 0) {
      const id = holo.pending;
      holo.pending = null;
      panel.open(id);
    }
  }
  holo.beam += (holo.beamTo - holo.beam) * (1 - Math.exp(-7 * dt));
  if (holo.beam < 0.002) holo.beam = 0;
  // 投影の光のちらつき
  const flicker = 0.88 + 0.08 * Math.sin(t * 23) * Math.sin(t * 7.3) + 0.04 * Math.sin(t * 61);
  room.robot?.setBeam(holo.beam, flicker);
  drawBeam(flicker);
}

// 投影口からパネルの上辺へ広がる光。3D の上に重ねた 2D の canvas に描く
function drawBeam(flicker) {
  const w = innerWidth;
  const h = innerHeight;
  const dpr = Math.min(devicePixelRatio, 2);
  if (beamCanvas.width !== Math.round(w * dpr) || beamCanvas.height !== Math.round(h * dpr)) {
    beamCanvas.width = Math.round(w * dpr);
    beamCanvas.height = Math.round(h * dpr);
  }
  beamCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  beamCtx.clearRect(0, 0, w, h);
  if (!room.robot || holo.beam === 0 || panelEl.hidden) return;

  const p = room.robot.emitter.getWorldPosition(emitterPos).project(camera);
  if (p.z > 1) return;
  const ex = ((p.x + 1) / 2) * w;
  const ey = ((1 - p.y) / 2) * h;
  const r = panelEl.getBoundingClientRect();
  if (r.top <= ey) return;
  const a = holo.beam * flicker;

  beamCtx.globalCompositeOperation = 'lighter';
  const fill = beamCtx.createLinearGradient(0, ey, 0, r.top);
  fill.addColorStop(0, `rgba(160, 210, 255, ${0.5 * a})`);
  fill.addColorStop(0.35, `rgba(70, 150, 255, ${0.22 * a})`);
  fill.addColorStop(1, `rgba(30, 80, 220, ${0.1 * a})`);
  beamCtx.fillStyle = fill;
  beamCtx.beginPath();
  beamCtx.moveTo(ex - 3, ey);
  beamCtx.lineTo(r.left, r.top);
  beamCtx.lineTo(r.right, r.top);
  beamCtx.lineTo(ex + 3, ey);
  beamCtx.closePath();
  beamCtx.fill();

  // 光の縁
  beamCtx.strokeStyle = `rgba(130, 195, 255, ${0.4 * a})`;
  beamCtx.lineWidth = 1;
  beamCtx.beginPath();
  beamCtx.moveTo(ex, ey);
  beamCtx.lineTo(r.left, r.top);
  beamCtx.moveTo(ex, ey);
  beamCtx.lineTo(r.right, r.top);
  beamCtx.stroke();

  // 投影口のにじみ
  const glow = beamCtx.createRadialGradient(ex, ey, 0, ex, ey, 22);
  glow.addColorStop(0, `rgba(220, 240, 255, ${0.9 * a})`);
  glow.addColorStop(0.4, `rgba(80, 160, 255, ${0.35 * a})`);
  glow.addColorStop(1, 'rgba(30, 80, 220, 0)');
  beamCtx.fillStyle = glow;
  beamCtx.fillRect(ex - 22, ey - 22, 44, 44);
  beamCtx.globalCompositeOperation = 'source-over';
}

// ---------- ループ ----------

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const k = updateZoom(dt);
  const w = shownWin;
  // ズーム中は見回しを控えめにする
  const look = motion * (1 - 0.6 * k);
  eyeTarget.set(
    w.cx + input.x * w.halfW * view.offsetX * look,
    w.cy + input.y * w.halfH * view.offsetY * look,
    w.cz + Math.max(w.halfW, w.halfH) * view.distanceFactor,
  );
  // ズームの移動中は目を窓にぴったり付ける（遅れると窓の裏側に回り込む）
  if (zoom.amount > 0 && zoom.amount < 1) eye.copy(eyeTarget);
  else eye.lerp(eyeTarget, 1 - Math.exp(-view.damping * dt));
  updateWindowCamera(camera, eye, w);

  updateShutter(dt);
  envMixer.update(dt);
  // ロボットはズーム前の窓を基準に動かす（ズームで通り道が変わらないように）
  robotEye.set(win.cx, win.cy, win.cz + eyeDistance);
  room.update(t, { eye: robotEye, win, liveEye: eye });
  weather?.update(dt, t);
  hotspots.update(dt);
  updateRobotHover();
  updateHologram(dt, t);
  // ほかのメニューを開いている（呼んでいる・ズームしている）間は、お知らせのロボットを画面の外へはけさせる
  room.newsProjector?.setAway(panel.isOpen || !!holo.pending || !!zoom.target);
  renderer.render(scene, camera);
});

// ---------- 起動完了 ----------

const boot = document.getElementById('boot');
requestAnimationFrame(() => {
  boot.classList.add('is-done');
  boot.addEventListener('transitionend', () => boot.remove(), { once: true });
});
// 真っ暗な部屋を少し見せてから、シャッターを上げる。
// ?shutter=0.4 のように開き具合を固定することもできる（見た目の確認用）
// ?lamps のように付けると、夜の吊り下げ照明が下りたら点ける（見た目の確認用）
if (new URLSearchParams(location.search).has('lamps')) {
  const wait = setInterval(() => {
    if (!room.nightLights?.active) return;
    room.nightLights.toggle();
    clearInterval(wait);
  }, 300);
}
const fixedShutter = new URLSearchParams(location.search).get('shutter');
if (room.shutter && fixedShutter !== null) {
  shutterProgress = shutterTarget = THREE.MathUtils.clamp(Number(fixedShutter) || 0, 0, 1);
  setShutter(shutterProgress, false);
} else if (room.shutter) {
  setTimeout(() => (shutterTarget = 1), CONFIG.shutterDelayMs);
}

const initial = location.hash.slice(1);
if (SECTIONS[initial]) requestSection(initial);
