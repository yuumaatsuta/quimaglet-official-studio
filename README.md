# QUIMAGLET OFFICIAL STUDIO

画面を「部屋をのぞく窓」に見立てた、1部屋で完結するサイト。three.js + Vite。

```sh
npm install
npm run dev      # 開発サーバー
npm run build    # dist/ に書き出し（静的ホスティングにそのまま置ける）
npm run deploy   # GitHub Pages に公開 → https://quimaglet.studio/
```

## 仕組み

| ファイル | 役割 |
|---|---|
| `src/windowCamera.js` | off-axis projection。目の位置に合わせて視錐台をずらし、画面を窓に見せる |
| `src/input.js` | 視点の入力。IMMERSE ボタンを押すまで動かない。PC はマウス、スマホはジャイロ（iOS はボタンを押したときに許可を取る）、なければ指 |
| `src/crtScreen.js` | ブラウン管の画面。`public/videos/crt.mp4` を置くと流れる（音なし・ループ。`config.js` の `crtVideo` で変更）。なければ砂嵐 |
| `src/crtTower.js` | 奥の左右の角のブラウン管タワー（1 台ずつ壁からのアームで支える）。`TIERS`（段ごとの距離・角度）、`TV_WIDTH`（全台共通の幅）、`GAP`（間隔）で形を変える。並びは `studioRoom.js` の `mulberry32(7)` の数字を変えると組み替わる |
| `src/room.js` | `public/models/room.glb` を読む。なければ `studioRoom.js` の部屋 |
| `src/studioRoom.js` | 写真から起こしたコンクリートのスタジオ（6m × 6m × 奥行 8m、家具なし） |
| シャッター | `studioRoom.js` の `buildShutter`。開くと 1.2 秒後に 7 秒かけて上がる（`config.js` の `shutterDelayMs`）。`?shutter=0.4` で開き具合を固定できる |
| 家具 | `studioRoom.js` の `FURNITURE`（位置・向き・幅・布の色・浮遊の高さ）。OBJ は `blender -b -P scripts/blender/optimize_model.py -- 入力.obj public/models/名前.glb` で軽くしてから置く |
| ロボット | `studioRoom.js` の `WANDER`（速さ・高さ・立ち止まる確率・見回す時間・画面外で待つ時間）。画面の端は目と窓から毎フレーム計算するので、PC でもスマホでも画面の外から外へ往復する |
| `src/weather.js` | 天気ごとの見え方（プリセット）と、淵野辺の現在の天気の取得（Open-Meteo、10 分ごと） |
| `src/weatherScene.js` | 空（シェーダー）・景色・雨・雪・霧・稲光と、天気に合わせた室内の光 |
| `src/weatherPanel.js` | 試作用の天気切り替えボタン（`config.js` の `weatherPanel: false` で消える）。`?weather=rain&night` のように URL でも指定できる |
| `scripts/generate-textures.mjs` | `public/textures/` のコンクリート・床・窓の外のテクスチャを生成（`node scripts/generate-textures.mjs`）。実写に差し替えるときは同じファイル名・同じ実寸で置き換える |
| `src/hotspots.js` | 家具のホバー発光・ツールチップ・クリック判定 |
| `src/panel.js` | 情報パネル。`#about` などの URL でも直接開く |
| `src/content.js` | パネルの文章（ここを書き換える） |
| `src/config.js` | 視点の動く量・距離などの調整値 |

## Blender で部屋を作るときの約束

1. **単位と向き**
   - 1 単位 = 1m、床を高さ 0 に置く
   - 見る側（手前）の壁は作らない。手前の開口部を Blender の **-Y 側**（glTF では +Z）に向け、部屋は +Y 方向（奥）へ伸ばす
   - 開口部の幅・高さ = 画面に映る範囲になる（バウンディングボックスから自動計算）
2. **クリックできる物**
   - オブジェクト名を `hs_` + `content.js` のキーにする：`hs_about` `hs_works` `hs_news` `hs_contact`
   - 複数パーツは Empty の子にして、Empty に名前を付ければまとめて対象になる
   - キーを増やしたら `content.js` にも同じキーを追加する
3. **ライティング（どちらか）**
   - **焼き込み（推奨・軽い）**：Cycles でライトをテクスチャに Bake し、ライトは書き出さない → 環境光だけで表示される
   - **リアルタイム**：Point / Spot / Sun ライトを置き、書き出し時に「Punctual Lights」を有効化。明るさは Blender 側の W 値と見え方が異なるので要調整
4. **書き出し**：File → Export → glTF 2.0 (.glb)
   - Include: Selected Objects をオフ（すべて）、Custom Properties 任意
   - Transform: +Y Up をオン
   - Mesh: Apply Modifiers をオン
   - 軽量化するなら `npx gltfpack -i room.glb -o room.glb -cc -tc`（meshopt 圧縮にも対応済み）
5. `public/models/room.glb` に置いて再読み込みすれば、仮の部屋と差し替わる

目安：GLB は 5〜10MB 以内、テクスチャは 2K 以下。
