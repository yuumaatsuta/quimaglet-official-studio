import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAdaptiveResolution } from './adaptiveResolution.js';
import { CONFIG } from './config.js';
import { createAboutView } from './aboutView.js';
import { GOODS, MEMBERS, NEWS_LIST, SECTIONS, loadContent, memberHtml } from './content.js';
import { createGoodsPaper } from './goodsPaper.js';
import { createHotspots, isPickable, isShown } from './hotspots.js';
import { createInput, isTouchDevice } from './input.js';
import { createMemberCard } from './memberCard.js';
import { createMemberHolo } from './memberHolo.js';
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
const maxPixelRatio = Math.min(devicePixelRatio, 1.75);
renderer.setPixelRatio(maxPixelRatio);
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

// 読み込みの表示。ファイルのダウンロードで 90% まで、残りはシェーダーの組み立て（precompile）
let bootShown = 0;
function onBootProgress(p) {
  bootShown = Math.max(bootShown, Math.floor(p * 90));
  bootLabel.textContent = `LOADING... ${bootShown}%`;
}

// 文章とお知らせ（backend/ の API。読めなければ public/content.json）。
// 部屋のモデルと同時に読み始め、壁のメニューとお知らせを作る直前に待つ（studioRoom.js）
const contentReady = loadContent().then(() => performance.mark('q:content'));
const room = await loadRoom(CONFIG.modelUrl, onBootProgress, contentReady);
performance.mark('q:room');
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
// プラネタリウム：星を映し始めたらシャッターを閉め、やめたら元の開き具合に戻す
let skyShut = false;
let shutterBeforeSky = 1;
let lampHold = false;
function updatePlanetariumShutter() {
  const on = !!room.planetarium?.on;
  if (on !== skyShut) {
    skyShut = on;
    if (on) {
      shutterBeforeSky = shutterTarget;
      shutterTarget = 0;
    } else {
      shutterTarget = shutterBeforeSky;
    }
  }
  // 閉まっている間も蛍光灯は消さない（シャッターが開き始めたら、ふだんの扱いに戻す）
  if (on) lampHold = true;
  else if (shutterOpen > 0) lampHold = false;
  weather?.setLampHold(lampHold);
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
// 描く前に、すべての材質のシェーダーをまとめて組み立てておく。
// 何もしないと、最初に描くときに 1 つずつ組み立てるので、その間（Windows では十数秒）画面が止まる。
// まとめて渡すと GPU 側で並べて組み立て、待つ間も読み込み画面は動く。
// 周囲を撮るとき（描き先が画像）と画面に描くときでは、同じ材質でも別のシェーダーになるので両方作る。
// 組み立ての進み具合はわからないので、表示は 99% へ向けて少しずつ進める
onBootProgress(1);
const creep = setInterval(() => {
  bootShown += (99 - bootShown) * 0.25;
  bootLabel.textContent = `LOADING... ${Math.floor(bootShown)}%`;
}, 400);
await precompile();
clearInterval(creep);
bootLabel.textContent = 'LOADING... 100%';
performance.mark('q:compiled');
setShutter(shutterOpen, false);
captureEnvironment();
performance.mark('q:env');

async function precompile() {
  setShutter(1, false); // 開いたときにだけ見える物も含める
  const jobs = [];
  renderer.setRenderTarget(cubeTarget, 0);
  jobs.push(renderer.compileAsync(scene, cubeCamera.children[0]));
  renderer.setRenderTarget(null);
  jobs.push(renderer.compileAsync(scene, camera));
  try {
    await Promise.all(jobs);
  } catch (e) {
    console.info('[boot] シェーダーの先読みに失敗しました（描くときに組み立てます）', e);
  }
}

if (weather) {
  // 最初の 1 回はすぐに切り替え、以降はなめらかに移り変わらせる
  let shown = false;
  const setWeather = (params) => {
    const instant = !shown;
    weather.set(params, { instant });
    shown = true;
    // 夜は月を下ろす（触れると星空を映す）
    room.planetarium?.setNight(!!params.night);
    // 左上のロゴ：昼は黒、夜は白（style.css）
    document.body.classList.toggle('is-night', !!params.night);
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
const zoom = { target: null, amount: 0, to: 0, focusWin: null, opts: null };
const shownWin = { cx: 0, cy: 0, cz: 0, halfW: 1, halfH: 1 };
const robotEye = new THREE.Vector3();
const zoomBack = document.getElementById('zoom-back');

// opts.window()：窓をじかに決める（メンバーのホログラム。main.js の memberWindow）。opts.margin：余白。opts.top / opts.bottom()：画面の上下で空けておく画素（ロゴやボタンの分）。
// 物の大きさは、床の影など押せない飾りを含めずに測る（物そのものが押せない飾りのとき＝壁の投影は、それを測る）
function focusWindow(obj, opts = {}) {
  if (opts.window) return opts.window();
  const box = new THREE.Box3();
  obj.traverse((o) => o.isMesh && (o === obj || !o.userData.noPick) && box.expandByObject(o, true));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const margin = opts.margin ?? ZOOM.margin;
  const top = opts.top?.() ?? 0;
  const bottom = opts.bottom?.() ?? 0;
  const usable = Math.max(0.3, (innerHeight - top - bottom) / innerHeight);
  const aspect = innerWidth / innerHeight;
  let halfH = ((size.y / 2) * margin) / usable;
  let halfW = halfH * aspect;
  const minHalfW = (size.x / 2) * margin;
  if (halfW < minHalfW) {
    halfW = minHalfW;
    halfH = halfW / aspect;
  }
  // 空けておく上下の画素の分だけ、物を空いている所の中央へずらす
  const perPx = (2 * halfH) / innerHeight;
  return { cx: c.x, cy: c.y + ((top - bottom) / 2) * perPx, cz: box.max.z + ZOOM.gap, halfW, halfH };
}

function zoomToObject(obj, opts = null) {
  zoom.target = obj;
  zoom.opts = opts;
  zoom.focusWin = focusWindow(obj, opts ?? {});
  zoom.to = 1;
  hotspots.setEnabled(false);
  document.body.classList.add('is-zoomed');
}

function zoomTo(id) {
  const obj = room.focus?.get(id);
  if (!obj) return false;
  zoomToObject(obj);
  zoomBack.hidden = false;
  return true;
}

function zoomOut() {
  if (!zoom.to) return;
  zoom.to = 0;
  document.body.classList.remove('is-zoomed');
  zoomBack.hidden = true;
  if (news.index >= 0) endNews();
  if (member.key) closeMember();
}

zoomBack.addEventListener('click', zoomOut);
addEventListener('keydown', (e) => e.key === 'Escape' && zoomOut());
// ズーム中は画面のどこを押しても戻る（お知らせを読んでいる間は、下のボタンか Esc で）
addEventListener('pointerup', (e) => {
  if (zoom.to && zoom.amount > 0.6 && e.target.tagName === 'CANVAS' && news.index < 0) zoomOut();
});

const ease = (x) => x * x * (3 - 2 * x);
function updateZoom(dt) {
  const step = dt / ZOOM.seconds;
  zoom.amount = zoom.to ? Math.min(1, zoom.amount + step) : Math.max(0, zoom.amount - step);
  if (!zoom.to && zoom.amount === 0 && zoom.target) {
    zoom.target = null;
    zoom.opts = null;
    if (document.getElementById('panel').hidden && !holo.pending && !about.isOpen && !goods.open && news.index < 0) {
      hotspots.setEnabled(true);
    }
  }
  if (zoom.target) zoom.focusWin = focusWindow(zoom.target, zoom.opts ?? {});
  const k = ease(zoom.amount);
  const fw = zoom.focusWin ?? win;
  for (const key of ['cx', 'cy', 'cz', 'halfW', 'halfH']) shownWin[key] = THREE.MathUtils.lerp(win[key], fw[key], k);
  return k;
}

// ---------- クリックできる家具とパネル ----------

const tooltip = document.getElementById('tooltip');
// メンバーの楽器：紹介が登録されていない楽器は押せなくし、チップも置かない
for (const [key, m] of room.members ?? []) {
  const info = memberFor(key);
  if (info) {
    m.object.userData.hotspotLabel = info.part ? `${info.name}（${info.part}）` : info.name;
  } else {
    room.hotspots.delete(`member:${key}`);
    m.object.traverse((o) => o.userData.hotspotId === `member:${key}` && delete o.userData.hotspotId);
    m.object.traverse((o) => o.userData.setGlow && (o.visible = false));
  }
}
const hotspots = createHotspots({
  camera,
  root: room.group,
  hotspots: room.hotspots,
  sections: SECTIONS,
  tooltip,
  highlightColor: CONFIG.highlightColor,
  onSelect: (id) => (id.startsWith('member:') ? openMember(id.slice(7)) : zoomTo(id) || requestSection(id)),
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
  onClose: () => !zoom.target && !holo.pending && !about.isOpen && !goods.open && hotspots.setEnabled(true),
});

// About だけは、ホログラムではなく画面いっぱいの文字で見せる（aboutView.js）。
// 読んでいる間、お知らせのロボットは画面の外へはけ、往復するロボットがときどき目の前までのぞきに来る
const about = createAboutView({
  onOpen: () => {
    zoomOut();
    hotspots.setEnabled(false);
    document.body.classList.add('is-about');
    room.robot?.setPeek?.(true);
  },
  onClose: () => {
    document.body.classList.remove('is-about');
    room.robot?.setPeek?.(false);
    if (!zoom.target && !panel.isOpen && !holo.pending && !goods.open) hotspots.setEnabled(true);
  },
});

// ---------- Goods ----------
// Goods だけは、ロボットが底のマグネットに紙のメニューを吊るして、目の前の読みやすい所まで持ってくる（goodsPaper.js）。
// 紙の外を押すか Esc で、紙を巻き上げて帰っていく。紙の中の ONLINE STORE を押すと購入ページを開く
const goodsPaper = createGoodsPaper();
goodsPaper.group.visible = false;
room.robot?.carry?.add(goodsPaper.group);
const goodsReady = goodsPaper.draw(GOODS);
const goodsSr = document.getElementById('goods-sr');
const goods = { open: false, releaseIn: -1 };
const GOODS_ROLL_UP = 0.55; // 閉じるとき、紙を巻き上げてから帰るまで（秒）

async function openGoods() {
  if (!room.robot?.carry) return panel.open('goods'); // ロボットがいない部屋では、ほかと同じパネルで見せる
  zoomOut();
  hotspots.setEnabled(false);
  goods.open = true;
  goods.releaseIn = -1;
  document.body.classList.add('is-goods'); // 紙に重なる IMMERSE ボタンを隠す
  history.replaceState(null, '', '#goods');
  await goodsReady;
  if (!goods.open) return;
  room.robot.deliver(goodsPaper.size);
  // 読み上げ・キーボード用に、同じ中身を見えない文章でも置く（購入ページのリンクもここから辿れる）
  goodsSr.innerHTML = `<h2>${SECTIONS.goods.title}</h2>${SECTIONS.goods.body}`;
  goodsSr.hidden = false;
  goodsSr.focus({ preventScroll: true });
}

function closeGoods() {
  if (!goods.open) return;
  goods.open = false;
  goods.releaseIn = GOODS_ROLL_UP;
  goodsSr.hidden = true;
  document.body.classList.remove('is-goods');
  history.replaceState(null, '', location.pathname + location.search);
  if (!zoom.target && !panel.isOpen && !holo.pending && !about.isOpen) hotspots.setEnabled(true);
}

// ほかのメニューを選んだときは、巻き上げを待たずにすぐ帰す
function dropGoods() {
  if (!goods.open && goods.releaseIn < 0) return;
  closeGoods();
  goods.releaseIn = -1;
  room.robot?.release({ win });
}

function updateGoods(dt) {
  if (goods.releaseIn >= 0 && (goods.releaseIn -= dt) <= 0) {
    goods.releaseIn = -1;
    room.robot?.release({ win });
  }
  const robot = room.robot;
  goodsPaper.update(dt, {
    visible: !!robot?.carrying,
    open: goods.open && !!robot?.delivering && !!robot?.arrived,
  });
}

function hitGoodsPaper(x, y) {
  const paperMesh = goodsPaper.paper;
  if (!paperMesh || !goodsPaper.group.visible) return null;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  return robotRay.intersectObject(paperMesh, false)[0] ?? null;
}

addEventListener('keydown', (e) => e.key === 'Escape' && closeGoods());

// 紙が長いときのスクロール（上の棒に巻き取られ、下の続きが出てくる）。ホイール・ドラッグ・矢印キー
addEventListener(
  'wheel',
  (e) => {
    if (!goods.open) return;
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
    if (goodsPaper.scrollBy(e.deltaY * k * goodsPxPerScreenPx())) e.preventDefault();
  },
  { passive: false },
);
addEventListener('keydown', (e) => {
  if (!goods.open) return;
  const step = { ArrowDown: 120, ArrowUp: -120, PageDown: 600, PageUp: -600, ' ': 600 }[e.key];
  if (step && goodsPaper.scrollBy(step)) e.preventDefault();
});
let goodsDrag = null;
addEventListener('pointerdown', (e) => {
  goodsDrag = goods.open && e.target.tagName === 'CANVAS' ? { y: e.clientY, k: goodsPxPerScreenPx() } : null;
});
addEventListener('pointermove', (e) => {
  if (!goodsDrag || !goods.open) return;
  goodsPaper.scrollBy(-(e.clientY - goodsDrag.y) * goodsDrag.k);
  goodsDrag.y = e.clientY;
});
addEventListener('pointerup', () => (goodsDrag = null));
addEventListener('pointercancel', () => (goodsDrag = null));

// 画面の 1 画素が、紙の組み版の何画素にあたるか（紙の位置で、上下 10cm が画面で何画素か測る）
const goodsA = new THREE.Vector3();
const goodsB = new THREE.Vector3();
function goodsPxPerScreenPx() {
  const paperMesh = goodsPaper.paper;
  if (!paperMesh) return 1;
  paperMesh.getWorldPosition(goodsA);
  goodsB.copy(goodsA).setY(goodsA.y + 0.1);
  goodsA.project(camera);
  goodsB.project(camera);
  const px = (Math.abs(goodsB.y - goodsA.y) * innerHeight) / 2;
  return px > 1 ? (goodsPaper.pagePxPerMeter * 0.1) / px : 1;
}

// ---------- お知らせを読む ----------
// 一覧は 1 台目のロボットのホログラム（News のパネル）。記事を押すと、2 台目のロボットが映している壁に近づき、
// その記事の本文を映してもらって読む。前の記事・News 一覧・次の記事のボタンも、本文の URL も、投影の中にあって押せる。
// 投影の外を押すと閉じる。壁の投影（最新のお知らせ）を直接押しても、その記事を読める。
// （#news-nav はキーボードと読み上げ用。見た目は投影の中のボタン）
const news = { index: -1, aspect: 0 };
const newsNav = document.getElementById('news-nav');
const newsLink = newsNav.querySelector('.news-nav-link');
const newsSr = document.getElementById('news-sr');
const NEWS_READ = {
  minAspect: 0.56, // 縦長の画面では、映す形も縦長に（幅÷高さ。これより細くはしない）
  maxAspect: 4 / 3,
  margin: 1.04,
};

// 読むときに映す形：ボタンとロゴの分を除いた、画面の空いている所の形
function newsAspect() {
  const space = innerHeight - newsTop() - newsBottom();
  return THREE.MathUtils.clamp(innerWidth / Math.max(1, space), NEWS_READ.minAspect, NEWS_READ.maxAspect);
}
function newsTop() {
  const logo = document.querySelector('.site-header .logo');
  return (logo ? logo.getBoundingClientRect().bottom : 60) + 6;
}
function newsBottom() {
  return 16;
}

function showNews(i) {
  const p = room.newsProjector;
  news.index = i;
  news.aspect = newsAspect();
  const article = NEWS_LIST[i];
  p.read(article, { aspect: news.aspect, index: i, total: NEWS_LIST.length });
  // 前の記事＝ひとつ古い記事、次の記事＝ひとつ新しい記事（一覧は新しい順）
  newsNav.querySelector('[data-news-go="prev"]').disabled = i >= NEWS_LIST.length - 1;
  newsNav.querySelector('[data-news-go="next"]').disabled = i <= 0;
  const url = String(article.body ?? '').match(/https?:\/\/[^\s<]+/)?.[0];
  newsLink.hidden = !url;
  if (url) newsLink.href = url;
  newsSr.textContent = `${article.date ?? ''} ${article.title ?? ''} ${article.body ?? ''}`;
  history.replaceState(null, '', `#news-${i + 1}`);
}

function openNews(i) {
  const p = room.newsProjector;
  if (!p || !NEWS_LIST.length) return;
  i = THREE.MathUtils.clamp(i | 0, 0, NEWS_LIST.length - 1);
  if (holo.pending) {
    holo.pending = null;
    holo.beamTo = 0;
    room.robot?.release({ win });
  }
  if (panel.isOpen) panel.close();
  if (about.isOpen) about.close();
  dropGoods();
  newsNav.hidden = false;
  showNews(i);
  document.body.classList.add('is-news');
  zoomToObject(p.screen, { margin: NEWS_READ.margin, top: newsTop, bottom: newsBottom });
  zoomBack.hidden = true;
}

// 読むのをやめる（ズームを戻すのは zoomOut）
function endNews() {
  news.index = -1;
  newsNav.hidden = true;
  newsSr.textContent = '';
  document.body.classList.remove('is-news');
  room.newsProjector?.read(null);
  if (/^#news-\d+$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}

newsNav.addEventListener('click', (e) => newsGo(e.target.closest('[data-news-go]')?.dataset.newsGo));
function newsGo(go) {
  if (!go || news.index < 0) return;
  if (go === 'prev') showNews(Math.min(NEWS_LIST.length - 1, news.index + 1));
  else if (go === 'next') showNews(Math.max(0, news.index - 1));
  else if (go === 'close') zoomOut();
  else if (go === 'list') {
    zoomOut();
    requestSection('news');
  }
}

// 読んでいる記事の投影のどこを指しているか（投影の外なら null）
const newsUv = new THREE.Vector2();
function hitNewsCard(x, y) {
  const p = room.newsProjector;
  if (!p || news.index < 0) return null;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  const hit = robotRay.intersectObject(p.screen, false)[0];
  return hit?.uv ? newsUv.copy(hit.uv) : null;
}
// 投影の中のボタン・リンクを押す。投影の外なら閉じる
function pressNews(x, y) {
  const uv = hitNewsCard(x, y);
  if (!uv) {
    if (zoom.amount > 0.6) zoomOut();
    return;
  }
  const a = room.newsProjector.actionAt(uv);
  if (a?.url) window.open(a.url, '_blank', 'noopener');
  else if (a?.go) newsGo(a.go);
}
addEventListener('keydown', (e) => {
  if (news.index < 0) return;
  if (e.key === 'ArrowLeft' && news.index < NEWS_LIST.length - 1) showNews(news.index + 1);
  if (e.key === 'ArrowRight' && news.index > 0) showNews(news.index - 1);
});
// 画面の形が大きく変わったら（スマホを横にしたなど）、映す形も替える
addEventListener('resize', () => {
  if (news.index >= 0 && Math.abs(newsAspect() - news.aspect) > 0.06) showNews(news.index);
});
// ホログラムの一覧で記事を押したとき
document.getElementById('panel-body').addEventListener('click', (e) => {
  const item = e.target.closest('[data-news]');
  if (item) openNews(Number(item.dataset.news));
});

// 壁に映っている最新のお知らせを押したか（手前に家具などがあればそちらが先）
function hitNewsWall(x, y) {
  const p = room.newsProjector;
  if (!p?.shown || news.index >= 0 || zoom.target || panel.isOpen || goods.open || about.isOpen) return false;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  const hit = robotRay
    .intersectObject(room.group, true)
    .find((h) => h.object.isMesh && isShown(h.object) && (h.object === p.screen || !h.object.userData.noPick));
  return hit?.object === p.screen;
}

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
  return robotRay.intersectObject(room.robot.object, true).some((h) => h.object.isMesh && isPickable(h.object));
}

// 夜の月（触れると星空を映す・消す）
function hitMoon(x, y) {
  const sky = room.planetarium;
  if (!sky?.active) return false;
  robotNdc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  robotRay.setFromCamera(robotNdc, camera);
  return robotRay.intersectObjects(sky.hitTargets, true).some((h) => isShown(h.object.parent));
}

let goodsAtDown = false; // 押し始めたときに Goods の紙が出ていたか（Goods を開いたその押し上げで閉じないように）
addEventListener('pointerdown', (e) => {
  robotDown = e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY } : null;
  goodsAtDown = goods.open;
});
addEventListener('pointerup', (e) => {
  if (!robotDown) return;
  const moved = Math.hypot(e.clientX - robotDown.x, e.clientY - robotDown.y);
  robotDown = null;
  if (moved > 8) return;
  if (news.index >= 0) {
    pressNews(e.clientX, e.clientY);
    return;
  }
  if (goods.open) {
    if (!goodsAtDown) return; // 壁の GOODS を押して開いた、その押し上げ
    // 紙の中ならリンクだけ、ロボットなら跳ねる、それ以外（紙の外）を押したら閉じる
    const hit = hitGoodsPaper(e.clientX, e.clientY);
    if (hit) {
      const url = goodsPaper.linkAt(hit.uv);
      if (url) window.open(url, '_blank', 'noopener');
    } else if (hitRobot(e.clientX, e.clientY)) room.robot.poke();
    else closeGoods();
    return;
  }
  if (hitRobot(e.clientX, e.clientY)) room.robot.poke();
  else if (hitMoon(e.clientX, e.clientY)) room.planetarium.toggle();
  else if (hitNewsWall(e.clientX, e.clientY)) openNews(0);
});
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') robotPointer = { x: e.clientX, y: e.clientY, dirty: true };
});

function updateRobotHover() {
  if (!robotPointer?.dirty) return;
  robotPointer.dirty = false;
  let newsAction = null;
  if (news.index >= 0) {
    const uv = hitNewsCard(robotPointer.x, robotPointer.y);
    newsAction = uv ? room.newsProjector.actionAt(uv) : null;
    room.newsProjector.hover(newsAction?.go);
  }
  const over = news.index >= 0
    ? !!newsAction
    : goods.open
    ? !!goodsPaper.linkAt(hitGoodsPaper(robotPointer.x, robotPointer.y)?.uv)
    : !panel.isOpen &&
      (hitRobot(robotPointer.x, robotPointer.y) || hitMoon(robotPointer.x, robotPointer.y) || hitNewsWall(robotPointer.x, robotPointer.y));
  if (over === robotHovered) return;
  robotHovered = over;
  document.body.style.cursor = over ? 'pointer' : '';
}

// ---------- メンバー ----------
// 楽器に触れると、カメラが楽器の前の床のチップへ寄り、チップの真上にそのメンバーの紹介をホログラムで映す。
// 名前は立体の光の文字（memberHolo.js）、ほかは名前の下の表示板（memberCard.js）。
// 表示板は楽器に少しかぶり、左右の奥に楽器が見える。表示板の外を押すか、戻る・Esc で閉じる
//   layout（m、チップからの高さ・幅）: width 表示板の幅、top/bottom 表示板の上端・下端、name 名前の中心、
//   view 寄ったときに映す範囲（w 幅、top 床からの高さ）
const MEMBER = {
  openAt: 0.75, // ズームがここまで進んだら映し始める
  front: 0.15, // 窓（画面）をチップのどれだけ手前に置くか
  backButton: 96, // 下で空けておく画素（戻るボタンの分）
  wide: { width: 0.85, top: 1.27, bottom: 0.42, name: 1.47, view: { w: 2.9, top: 1.72 } },
  tall: { width: 1.0, top: 1.48, bottom: 0.4, name: 1.7, view: { w: 1.3, top: 1.95 } },
};
const member = { key: null, beam: 0, beamTo: 0 };
const memberCard = createMemberCard({ onClose: () => zoomOut() });
const memberHolo = createMemberHolo(scene);
const chipPos = new THREE.Vector3();
const memberAt = new THREE.Vector3();
const memberP = new THREE.Vector3();

function memberFor(key) {
  return MEMBERS.find((m) => m.instrument === key && m.name) ?? null;
}
const memberLayout = () => (innerWidth / innerHeight < 1 ? MEMBER.tall : MEMBER.wide);

// チップの真上のホログラムが、戻るボタンの上の空きの真ん中に来る窓
function memberWindow(chip) {
  const L = memberLayout();
  const aspect = innerWidth / innerHeight;
  const usable = Math.max(0.4, (innerHeight - MEMBER.backButton) / innerHeight);
  const low = -0.06; // チップの下に少し床を見せる
  const halfH = Math.max((L.view.top - low) / 2 / usable, L.view.w / 2 / aspect);
  const b = (MEMBER.backButton * 2 * halfH) / innerHeight;
  return { cx: chip.x, cy: (L.view.top + low) / 2 - b / 2, cz: chip.z + MEMBER.front, halfW: halfH * aspect, halfH };
}

function openMember(key) {
  const m = room.members?.get(key);
  const info = memberFor(key);
  const chip = m?.chip();
  if (!chip || !info) return;
  // ほかに開いているもの・呼んでいるものはやめる
  if (holo.pending) {
    holo.pending = null;
    holo.beamTo = 0;
    room.robot?.release({ win });
  }
  if (panel.isOpen) panel.close();
  if (about.isOpen) about.close();
  dropGoods();
  if (news.index >= 0) endNews();
  member.key = key;
  member.beamTo = 0;
  memberHolo.set(info);
  // 縦横が変わったら（スマホを回したら）置き方の変わったチップへ寄り直す
  zoomToObject(m.shown(), { window: () => memberWindow(m.chip().getWorldPosition(chipPos)) });
  zoomBack.hidden = false;
}

function closeMember() {
  member.key = null;
  member.beamTo = 0;
  memberCard.close();
}

// 部屋の中の点を画面の画素へ
function toScreen(v) {
  v.project(camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, front: v.z < 1 };
}

function updateMember(dt, t) {
  if (member.key && !memberCard.isOpen && zoom.amount >= MEMBER.openAt) {
    memberCard.open(memberHtml(memberFor(member.key)));
    member.beamTo = 1;
  }
  // 着く少し前から、チップの出口だけ光らせる
  if (member.key && !memberCard.isOpen && zoom.amount > 0.4) member.beamTo = 0.5;
  member.beam += (member.beamTo - member.beam) * (1 - Math.exp(-7 * dt));
  if (member.beam < 0.002) member.beam = 0;
  const flicker = 0.88 + 0.08 * Math.sin(t * 23) * Math.sin(t * 7.3) + 0.04 * Math.sin(t * 61);
  let lit = null;
  for (const [key, m] of room.members ?? []) {
    const chip = m.chip();
    const on = key === member.key || (!member.key && key === member.last);
    chip?.userData.setGlow(on ? member.beam * flicker : 0);
    if (on && chip && member.beam > 0) lit = chip;
  }
  if (member.key) member.last = member.key;

  let at = null;
  if (lit) {
    const L = memberLayout();
    const c = lit.getWorldPosition(chipPos);
    // 名前の立体の文字（表示板が映ってから浮かび上がる）
    const nameA = memberCard.isOpen || !member.key ? Math.max(0, (member.beam - 0.5) * 2) : 0;
    memberHolo.update(memberAt.set(c.x, L.name, c.z), nameA * flicker, t);
    // 表示板：チップの真上の、部屋の中の板の四隅を画面に写す
    const tl = toScreen(memberP.set(c.x - L.width / 2, L.top, c.z));
    const br = toScreen(memberP.set(c.x + L.width / 2, L.bottom, c.z));
    const width = Math.min(br.x - tl.x, innerWidth - 24);
    const left = Math.min(Math.max((tl.x + br.x) / 2 - width / 2, 12), innerWidth - 12 - width);
    memberCard.place({ left, top: tl.y, width, height: Math.max(120, br.y - tl.y) });
    const e = toScreen(lit.userData.emitter.getWorldPosition(memberP));
    if (e.front) at = e;
  } else {
    memberHolo.update(null, 0, t);
  }
  memberCard.draw(at, member.beam * flicker);
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
  if (id === 'goods') {
    if (goods.open) return;
    if (holo.pending) {
      holo.pending = null;
      holo.beamTo = 0;
    }
    if (panel.isOpen) panel.close();
    if (about.isOpen) about.close();
    openGoods();
    return;
  }
  dropGoods();
  if (id === 'about') {
    // ロボットを呼んでいる途中・ほかのページを映している途中なら、やめてから開く
    if (holo.pending) {
      holo.pending = null;
      holo.beamTo = 0;
      room.robot?.release({ win });
    }
    if (panel.isOpen) panel.close();
    about.open();
    return;
  }
  if (about.isOpen) about.close();
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

// ?perf を付けると、1 フレームの描画の量を window.__perf に数える（重さを測るとき用）
const perf = new URLSearchParams(location.search).has('perf') ? { frames: 0, calls: 0, triangles: 0, ms: 0 } : null;
if (perf) {
  renderer.info.autoReset = false;
  window.__perf = perf;
  Object.defineProperty(perf, 'three', { value: { THREE, scene, renderer, camera } });
}

// GPU が追いつかない端末でだけ、描く解像度を下げる（adaptiveResolution.js）
// ?res=1 のように付けると解像度を固定する（重さを測るとき用）
const fixedRes = Number(new URLSearchParams(location.search).get('res'));
if (fixedRes) renderer.setPixelRatio(fixedRes);
const resolution = fixedRes
  ? { ratio: fixedRes, frame() {} }
  : createAdaptiveResolution(renderer, { max: maxPixelRatio, min: Math.max(0.6, maxPixelRatio * 0.6) });

const clock = new THREE.Clock();
renderer.setAnimationLoop((now) => {
  resolution.frame(now);
  const start = perf && performance.now();
  if (perf) renderer.info.reset();
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
  // 星を映している間は、シャッターを閉めて部屋を暗くする（蛍光灯とメニューを照らす光は点けたまま）
  updatePlanetariumShutter();
  const dim = room.planetarium?.dim ?? 0;
  weather?.setDim(dim);
  scene.environmentIntensity = envBase * shutterOpen * (1 - dim);
  weather?.update(dt, t);
  hotspots.update(dt);
  updateRobotHover();
  updateHologram(dt, t);
  updateGoods(dt);
  updateMember(dt, t);
  // ほかのメニューを開いている（呼んでいる・ズームしている）間は、お知らせのロボットを画面の外へはけさせる
  // （お知らせを読んでいる間は、newsProjector.read で映し続ける）
  room.newsProjector?.setAway(panel.isOpen || !!holo.pending || !!zoom.target || about.isOpen || goods.open);
  renderer.render(scene, camera);
  if (perf) {
    if (!perf.frames) performance.mark('q:frame');
    perf.frames++;
    perf.ratio = resolution.ratio;
    perf.calls += renderer.info.render.calls;
    perf.triangles += renderer.info.render.triangles;
    perf.ms += performance.now() - start;
  }
});

// ---------- 起動完了 ----------

const boot = document.getElementById('boot');
requestAnimationFrame(() => {
  boot.classList.add('is-done');
  boot.addEventListener('transitionend', () => boot.remove(), { once: true });
});
// 真っ暗な部屋を少し見せてから、シャッターを上げる。
// ?shutter=0.4 のように開き具合を固定することもできる（見た目の確認用）
// ?stars のように付けると、夜の月が下りたら星空を映す（見た目の確認用）
if (new URLSearchParams(location.search).has('stars')) {
  const wait = setInterval(() => {
    if (!room.planetarium?.active) return;
    room.planetarium.toggle(true);
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
else if (/^news-\d+$/.test(initial)) openNews(Number(initial.slice(5)) - 1);
