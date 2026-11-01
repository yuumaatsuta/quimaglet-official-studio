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
let envMap = null;
function captureEnvironment() {
  if (!room.probe) return;
  const open = shutterOpen;
  setShutter(1, false);
  cubeCamera.position.copy(room.probe);
  cubeCamera.update(renderer, scene);
  setShutter(open, false);
  const next = pmrem.fromCubemap(cubeTarget.texture);
  scene.environment = next.texture;
  envMap?.dispose();
  envMap = next;
  envBase = room.hasLights ? 0.5 : 1.0;
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
    onSettled: captureEnvironment,
  });
}
setShutter(shutterOpen, false);
captureEnvironment();

if (weather) {
  // 最初の 1 回はすぐに切り替え、以降はなめらかに移り変わらせる
  let shown = false;
  const setWeather = (params) => {
    weather.set(params, { instant: !shown });
    shown = true;
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
  onSelect: (id) => zoomTo(id) || panel.open(id),
});
const panel = createPanel(SECTIONS, {
  onOpen: () => {
    zoomOut();
    hotspots.setEnabled(false);
  },
  onClose: () => !zoom.target && hotspots.setEnabled(true),
});

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
  // ロボットはズーム前の窓を基準に動かす（ズームで通り道が変わらないように）
  robotEye.set(win.cx, win.cy, win.cz + eyeDistance);
  room.update(t, { eye: robotEye, win });
  weather?.update(dt, t);
  hotspots.update(dt);
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
const fixedShutter = new URLSearchParams(location.search).get('shutter');
if (room.shutter && fixedShutter !== null) {
  shutterProgress = shutterTarget = THREE.MathUtils.clamp(Number(fixedShutter) || 0, 0, 1);
  setShutter(shutterProgress, false);
} else if (room.shutter) {
  setTimeout(() => (shutterTarget = 1), CONFIG.shutterDelayMs);
}

const initial = location.hash.slice(1);
if (SECTIONS[initial]) panel.open(initial);
