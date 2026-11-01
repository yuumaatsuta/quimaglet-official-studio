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

// ---------- クリックできる家具とパネル ----------

const tooltip = document.getElementById('tooltip');
const hotspots = createHotspots({
  camera,
  root: room.group,
  hotspots: room.hotspots,
  sections: SECTIONS,
  tooltip,
  highlightColor: CONFIG.highlightColor,
  onSelect: (id) => panel.open(id),
});
const panel = createPanel(SECTIONS, {
  onOpen: () => hotspots.setEnabled(false),
  onClose: () => hotspots.setEnabled(true),
});

// ---------- ループ ----------

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  eyeTarget.set(
    win.cx + input.x * win.halfW * view.offsetX * motion,
    win.cy + input.y * win.halfH * view.offsetY * motion,
    win.cz + eyeDistance,
  );
  eye.lerp(eyeTarget, 1 - Math.exp(-view.damping * dt));
  updateWindowCamera(camera, eye, win);

  updateShutter(dt);
  room.update(t, { eye, win });
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
