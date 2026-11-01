import { KINDS, LOCATION } from './weather.js';

// 試作用：天気を手で切り替えるボタン。本番では CONFIG.weatherPanel を false にして消す
export function createWeatherPanel({ onLive, onManual, onShutter }) {
  const root = document.createElement('div');
  root.className = 'weather-panel';
  root.innerHTML = `
    <p class="weather-status" aria-live="polite"></p>
    <div class="weather-row">
      <button type="button" data-live>${LOCATION.name}の今</button>
      ${['clear', 'cloudy', 'rain', 'snow', 'fog', 'thunder']
        .map((k) => `<button type="button" data-kind="${k}">${KINDS[k]}</button>`)
        .join('')}
    </div>
    <div class="weather-row">
      <button type="button" data-day="1">昼</button>
      <button type="button" data-day="0">夜</button>
      ${onShutter ? '<button type="button" data-shutter>シャッター開閉</button>' : ''}
    </div>
  `;
  document.body.append(root);

  const status = root.querySelector('.weather-status');
  let manual = { kind: 'clear', isDay: true };
  let live = true;

  function render() {
    root.querySelector('[data-live]').classList.toggle('is-active', live);
    root.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('is-active', !live && b.dataset.kind === manual.kind));
    root.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('is-active', !live && (b.dataset.day === '1') === manual.isDay));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-shutter')) {
      onShutter();
      return;
    }
    if (b.hasAttribute('data-live')) {
      live = true;
      render();
      onLive();
      return;
    }
    if (b.dataset.kind) manual.kind = b.dataset.kind;
    if (b.dataset.day) manual.isDay = b.dataset.day === '1';
    live = false;
    render();
    onManual(manual.kind, manual.isDay);
  });

  render();

  return {
    get live() {
      return live;
    },
    select(kind, isDay) {
      manual = { kind, isDay };
      live = false;
      render();
      onManual(kind, isDay);
    },
    setStatus(text) {
      status.textContent = text;
    },
  };
}
