export const CONFIG = {
  // Blender から書き出した部屋。存在しなければコードで組んだ仮の部屋を使う
  modelUrl: `${import.meta.env.BASE_URL}models/room.glb`,

  view: {
    // 画面（窓）が部屋の開口部をどれだけ埋めるか。1 で壁際ぴったり
    crop: 0.92,
    // 目の位置 = 窓の大きさ × この係数。大きいほどパースが弱く（望遠寄りに）なる
    distanceFactor: 1.6,
    // 入力 ±1 に対して、目を窓の半幅・半高の何割まで動かすか
    offsetX: 0.5,
    offsetY: 0.35,
    // 目の追従の速さ（大きいほど機敏）
    damping: 4,
    near: 0.05,
    far: 300,
  },

  // ブラウン管に流す映像（音なし・ループ）。public/videos/ に置いたファイルか、外部の URL。
  // null か、読めないときは砂嵐になる
  crtVideo: `${import.meta.env.BASE_URL}videos/crt.mp4`,

  // ホバー時に家具をほんのり光らせる色
  highlightColor: '#ff5fa8',

  // サイトを開いてからシャッターが上がり始めるまで（ミリ秒）
  shutterDelayMs: 1200,

  // 窓の外の天気を淵野辺の現在の天気に合わせる（Open-Meteo）。何分ごとに取り直すか
  weatherRefreshMinutes: 10,
  // 試作用の天気切り替えボタンを出す
  weatherPanel: true,
};
