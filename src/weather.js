// 天気の種類ごとの見え方（昼）と、淵野辺の現在の天気の取得。

// 淵野辺駅あたり（相模原市中央区）
export const LOCATION = { name: '淵野辺', latitude: 35.5687, longitude: 139.395 };

export const KINDS = {
  clear: '晴れ',
  partly: '晴れ時々曇り',
  cloudy: '曇り',
  rain: '雨',
  snow: '雪',
  fog: '霧',
  thunder: '雷雨',
};

// 色は16進、数値は強さ。night() で夜用に変換する
const PRESETS = {
  clear: {
    sun: 5.5, sunColor: '#ffe1b3',
    sky: 3.2, skyColor: '#e4eeff',
    hemi: 0.25,
    skyTop: '#4f8fd8', skyHorizon: '#dbe6ee',
    cloudCover: 0.12, cloudColor: '#ffffff',
    land: '#ffffff', fog: 0.003,
    rain: 0, snow: 0, thunder: 0, lamp: 0, exposure: 1.0,
  },
  partly: {
    sun: 4.2, sunColor: '#ffe4bd',
    sky: 3.6, skyColor: '#e6eefa',
    hemi: 0.3,
    skyTop: '#5d93d0', skyHorizon: '#dbe3ea',
    cloudCover: 0.5, cloudColor: '#f4f6f8',
    land: '#f2f2f2', fog: 0.004,
    rain: 0, snow: 0, thunder: 0, lamp: 0, exposure: 1.05,
  },
  cloudy: {
    sun: 0.3, sunColor: '#e8e8e8',
    sky: 4.5, skyColor: '#e8ecf0',
    hemi: 0.45,
    skyTop: '#9aa4ae', skyHorizon: '#d0d5d9',
    cloudCover: 0.9, cloudColor: '#c4c9ce',
    land: '#b8bdbf', fog: 0.006,
    rain: 0, snow: 0, thunder: 0, lamp: 0, exposure: 1.25,
  },
  rain: {
    sun: 0, sunColor: '#e0e0e0',
    sky: 3.0, skyColor: '#c9d1d8',
    hemi: 0.4,
    skyTop: '#6c7782', skyHorizon: '#a6afb6',
    cloudCover: 1.0, cloudColor: '#88919a',
    land: '#8c9393', fog: 0.011,
    rain: 1, snow: 0, thunder: 0, lamp: 0.35, exposure: 1.35,
  },
  snow: {
    sun: 0, sunColor: '#ffffff',
    sky: 4.5, skyColor: '#eef2f6',
    hemi: 0.5,
    skyTop: '#b5bec8', skyHorizon: '#e3e7eb',
    cloudCover: 1.0, cloudColor: '#d9dee3',
    land: '#e6eaed', fog: 0.013,
    rain: 0, snow: 1, thunder: 0, lamp: 0.2, exposure: 1.25,
  },
  fog: {
    sun: 0.15, sunColor: '#f0f0f0',
    sky: 3.6, skyColor: '#e3e6e8',
    hemi: 0.45,
    skyTop: '#c2c7cb', skyHorizon: '#d8dbdd',
    cloudCover: 1.0, cloudColor: '#d0d4d7',
    land: '#c8cccd', fog: 0.024,
    rain: 0, snow: 0, thunder: 0, lamp: 0.2, exposure: 1.25,
  },
  thunder: {
    sun: 0, sunColor: '#d0d0d0',
    sky: 2.0, skyColor: '#b8c0c8',
    hemi: 0.3,
    skyTop: '#454d56', skyHorizon: '#7b838a',
    cloudCover: 1.0, cloudColor: '#59616a',
    land: '#6a7070', fog: 0.012,
    rain: 1.5, snow: 0, thunder: 1, lamp: 1, exposure: 1.4,
  },
};

const darken = (hex, k, tint = [0.75, 0.85, 1.25]) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.min(255, Math.round(v * k * tint[i])));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

function night(p) {
  return {
    ...p,
    sun: 0,
    sky: p.sky * 0.05,
    skyColor: '#8fa6d6',
    hemi: p.hemi * 0.12,
    skyTop: darken(p.skyTop, 0.08),
    skyHorizon: darken(p.skyHorizon, 0.13),
    cloudColor: darken(p.cloudColor, 0.12),
    land: darken(p.land, 0.16),
    lamp: 1,
    exposure: 1.1,
    night: true, // 夜はマイクを下ろす（planetarium.js）
  };
}

export function weatherParams(kind, isDay) {
  const base = PRESETS[kind] ?? PRESETS.clear;
  return isDay ? { ...base } : night(base);
}

// WMO 天気コード → 種類
// https://open-meteo.com/en/docs （WMO Weather interpretation codes）
export function kindFromCode(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

// 霧雨・小雨は雨脚を弱く、強い雨は強く
function rainAmount(code) {
  if (code >= 51 && code <= 57) return 0.4;
  if (code === 61 || code === 80) return 0.7;
  if (code === 65 || code === 82) return 1.4;
  return 1;
}

// 現在の淵野辺の天気（Open-Meteo、15 分ごとに更新されるデータ）
export async function fetchCurrentWeather() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: LOCATION.latitude,
    longitude: LOCATION.longitude,
    current: 'temperature_2m,weather_code,is_day,cloud_cover',
    timezone: 'Asia/Tokyo',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const { current } = await res.json();
  const code = current.weather_code;
  const kind = kindFromCode(code);
  const isDay = current.is_day === 1;
  const params = weatherParams(kind, isDay);
  if (kind === 'rain') params.rain *= rainAmount(code);
  if (kind === 'clear' || kind === 'partly') params.cloudCover = Math.max(0.05, current.cloud_cover / 100) * 0.9;
  return {
    kind,
    isDay,
    temperature: current.temperature_2m,
    time: current.time,
    params,
  };
}
