// 視点を動かす入力。PC はマウス位置、スマホはジャイロ（なければ指の位置）。
// 結果は state.x / state.y に -1〜1 で入る。
// IMMERSE ボタンを押すまでは動かさない（正面のまま）。もう一度押すと止めて正面に戻る。

const GYRO_RANGE = 25; // この角度（度）傾けると端まで動く
const GYRO_SMOOTH = 0.5;
const GYRO_DRIFT = 0.002; // 基準の姿勢をゆっくり今の姿勢に寄せる

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const wrapDeg = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

export function isTouchDevice() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function createInput() {
  const state = { x: 0, y: 0, mode: 'pointer', enabled: false };
  const touch = isTouchDevice();
  let gyroReady = false;

  const button = document.getElementById('immerse');
  button?.addEventListener('click', async () => {
    state.enabled = !state.enabled;
    button.setAttribute('aria-pressed', String(state.enabled));
    document.documentElement.classList.toggle('is-immersed', state.enabled);
    state.x = 0;
    state.y = 0;
    // ジャイロの許可は、ボタンを押した操作の中で取る（iOS）
    if (state.enabled && touch && !gyroReady) {
      gyroReady = true;
      await setupGyro(state);
    }
  });

  addEventListener('pointermove', (e) => {
    if (!state.enabled || state.mode === 'gyro') return;
    if (e.pointerType !== 'mouse' && e.buttons === 0) return;
    state.x = (e.clientX / innerWidth - 0.5) * 2;
    state.y = (0.5 - e.clientY / innerHeight) * 2;
  });

  // 指を離したら正面に戻す
  addEventListener('pointerup', (e) => {
    if (!state.enabled || state.mode === 'gyro' || e.pointerType === 'mouse') return;
    state.x = 0;
    state.y = 0;
  });

  return state;
}

async function setupGyro(state) {
  let base = null;

  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    state.mode = 'gyro';
    // 止めているあいだは、次に始めたときの姿勢を正面にする
    if (!state.enabled) {
      base = null;
      return;
    }
    if (!base) base = { beta: e.beta, gamma: e.gamma };

    const db = wrapDeg(e.beta, base.beta);
    const dg = wrapDeg(e.gamma, base.gamma);
    base.beta += db * GYRO_DRIFT;
    base.gamma += dg * GYRO_DRIFT;

    // 画面の向き（横持ち）に合わせて軸を入れ替える
    let h = dg;
    let v = db;
    const angle = (((screen.orientation?.angle ?? 0) % 360) + 360) % 360;
    if (angle === 90) [h, v] = [-db, dg];
    else if (angle === 270) [h, v] = [db, -dg];
    else if (angle === 180) [h, v] = [-dg, -db];

    state.x += (clamp1(h / GYRO_RANGE) - state.x) * GYRO_SMOOTH;
    state.y += (clamp1(-v / GYRO_RANGE) - state.y) * GYRO_SMOOTH;
  }

  const listen = () => addEventListener('deviceorientation', onOrientation);

  // iOS はユーザー操作の中で許可を取る必要がある
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) === 'granted') listen();
    } catch {
      // 拒否されたら指の位置で動かす
    }
  } else {
    listen();
  }
}
