import * as THREE from 'three';

// Goods を選んだときに、ロボットが持ってくる紙のメニュー。
// ロボットの底のマグネット（robot.glb の底の中央）に、紙の上端を巻き付けた金属の棒がくっついている。
// 紙は少し古びた色で、手書きの字で、グッズを 2 列に並べる。近くに来ると下へ巻物のように広がる。
// 中身が多くて 1 枚に収まらないときは、スクロールすると上の棒に紙が巻き取られ、下の続きが出てくる。
// グッズの写真を押すと、紙の中の並びが替わって、そのグッズが紙の幅いっぱいに大きく載る（もう一度押すか ← all items で戻る）。
// 中身は content.js の GOODS（管理画面 /admin/ の Goods）

const PAPER = {
  width: 0.4, // 紙の幅（m）
  px: 1100, // 紙の横の画素数（組み版の単位）
  view: 1.42, // 一度に見える紙の高さ（幅に対する比）。中身がこれより長いとスクロールする
  res: 1.25, // 組み版の 1 画素を、画像の何画素で描くか（大きいほど字がくっきり）
  maxTexture: 8192, // 画像の縦横の上限（GPU の上限がこれより小さければそちら。長いときは全体を縮めて描く）
  rodRadius: 0.0065,
  rollRadius: 0.012, // 棒に巻き付けた紙の太さ（巻き取る前）
  thickness: 0.0026, // 巻き取ったときに太る紙の厚み（見えるよう実物より厚め）
  unrollSeconds: 0.9,
  swapSeconds: 0.45, // 並びを替えるとき、前の絵から次の絵へ移り変わる時間
};
const SWAY_MAX = 0.2; // 揺れの最大（rad）

const FONT = {
  // 手書きの字（index.html で Google Fonts を読む）。英数字は Caveat、日本語は Yomogi で書く
  hand: '"Caveat", "Yomogi", cursive',
  jp: '"Yomogi", "Caveat", cursive',
};
const INK = '#1f1a14';
const STAMP = [
  [/売り切れ|完売|sold/i, '#a3352b'],
  [/準備|近日|予定|soon/i, '#9a6a12'],
  [/予約/, '#2b4f8a'],
];
const STAMP_ON = '#2f6b3a';

export function createGoodsPaper() {
  const group = new THREE.Group(); // ロボットの底のマグネットに付ける（マグネットの一番下が原点）
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: 0.35 });

  // 揺れの支点（棒の中心）。棒の上の面がマグネットに触れる。紙と棒はこの下で揺れる
  const pivot = new THREE.Group();
  pivot.position.y = -PAPER.rodRadius;
  group.add(pivot);

  const rodLength = PAPER.width + 0.05;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(PAPER.rodRadius, PAPER.rodRadius, rodLength, 20), metal);
  rod.rotation.z = Math.PI / 2;
  const knobGeo = new THREE.SphereGeometry(PAPER.rodRadius * 1.9, 16, 12);
  const knobL = new THREE.Mesh(knobGeo, brass);
  const knobR = new THREE.Mesh(knobGeo, brass);
  knobL.position.x = -rodLength / 2;
  knobR.position.x = rodLength / 2;
  pivot.add(rod, knobL, knobR);

  // 紙。canvas に全体を描き、見えている範囲だけを貼る（texture の repeat / offset でずらす）
  let texture = paperTexture(document.createElement('canvas'));
  const reveal = { value: 0 };
  // 並びを替えるときは、前の絵（uPrev。そのときの見えていた範囲 uPrevUv = (offset.y, repeat.y)）から次の絵へ移り変わる
  const prevTex = { value: null };
  const prevUv = { value: new THREE.Vector2(0, 1) };
  const mix = { value: 1 };
  const paperMat = new THREE.MeshStandardMaterial({
    map: texture,
    emissive: '#ffffff',
    emissiveMap: texture,
    emissiveIntensity: 0.42, // 暗い部屋でも読めるように、少しだけ自分で明るい
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  // 上から下へ広がる（巻物を下ろす）。紙の板の uv の y は上端が 1
  paperMat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = reveal;
    shader.uniforms.uPrev = prevTex;
    shader.uniforms.uPrevUv = prevUv;
    shader.uniforms.uMix = mix;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPaperUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPaperUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n#define PAPER_BIAS -0.7\nuniform float uReveal;\nuniform float uMix;\nuniform sampler2D uPrev;\nuniform vec2 uPrevUv;\nvarying vec2 vPaperUv;',
      )
      .replace(
        '#include <map_fragment>',
        [
          'if (vPaperUv.y < 1.0 - uReveal) discard;',
          // 画面では紙が小さく映るので、縮めた画像（ミップマップ）を少し細かい段から取る（細い字がぼやけて薄くならないように）
          'vec4 sampledDiffuseColor = texture2D(map, vMapUv, PAPER_BIAS);',
          'diffuseColor *= sampledDiffuseColor;',
          'vec4 prevTexel = texture2D(uPrev, vec2(vPaperUv.x, uPrevUv.x + vPaperUv.y * uPrevUv.y), PAPER_BIAS);',
          'if (uMix < 1.0) diffuseColor.rgb = mix(prevTexel.rgb, diffuseColor.rgb, uMix);',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#ifdef USE_EMISSIVEMAP',
          'vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv, PAPER_BIAS);',
          'if (uMix < 1.0) emissiveColor = mix(prevTexel, emissiveColor, uMix);',
          'totalEmissiveRadiance *= emissiveColor.rgb;',
          '#endif',
        ].join('\n'),
      );
  };
  const rollMat = new THREE.MeshStandardMaterial({ color: '#d9c9a4', emissive: '#d9c9a4', emissiveIntensity: 0.25, roughness: 0.95 });

  let paper = null;
  let viewH = PAPER.width * PAPER.view; // 見えている紙の高さ（m）
  // 棒に巻き付けた上の紙と、まだ巻かれている下の紙
  const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PAPER.width, 32), rollMat);
  topRoll.rotation.z = Math.PI / 2;
  const bottomRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PAPER.width, 32), rollMat);
  bottomRoll.rotation.z = Math.PI / 2;
  pivot.add(topRoll);

  // 下の端の金具：巻物の芯の金属の棒と、両端の小さな浮遊ユニット（下へ青い光を放って、紙の下端を宙に支える）
  const bottomRig = new THREE.Group();
  const bottomRod = new THREE.Mesh(new THREE.CylinderGeometry(PAPER.rodRadius * 0.85, PAPER.rodRadius * 0.85, rodLength, 20), metal);
  bottomRod.rotation.z = Math.PI / 2;
  bottomRig.add(bottomRoll, bottomRod);
  const hovers = [-1, 1].map((side) => hoverUnit(side, rodLength));
  for (const h of hovers) bottomRig.add(h.group);
  pivot.add(bottomRig);

  // 組み版の寸法（画素。canvas は大きすぎると縮めて描くので、組み版の単位で持つ）
  const page = { w: PAPER.px, h: PAPER.px * PAPER.view, view: PAPER.px * PAPER.view };
  const scroll = { now: 0, target: 0 };
  let regions = []; // 押せる所。組み版の画素で { x, y, w, h, url }（購入ページ）か { ..., focus }（写真：大きくする・戻す）
  let source = null; // 描く中身 { goods, images, maxTexture }
  let focus = -1; // 大きく載せているグッズ（-1 ならふだんの 2 列）
  const fade = { t: 1, old: null };

  function buildPaperMesh() {
    if (paper) {
      pivot.remove(paper);
      paper.geometry.dispose();
    }
    const geo = new THREE.PlaneGeometry(PAPER.width, viewH, 12, 40);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i) - viewH / 2; // 上端が 0、下へ負
      const v = -y / viewH; // 上 0 → 下 1
      // 古い紙らしく、ゆるく反って、下の端が少し手前へ丸まる
      const z = 0.006 * Math.cos((x / PAPER.width) * Math.PI) - 0.012 * Math.sin(v * Math.PI) + 0.02 * Math.pow(v, 6);
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    paper = new THREE.Mesh(geo, paperMat);
    paper.position.set(0, -PAPER.rollRadius * 0.6, PAPER.rollRadius * 0.4);
    paper.userData.noPick = true; // ロボットを押したことにしない（紙は main.js が別に調べる）
    pivot.add(paper);
  }

  // 中身を描く。フォントが届いてから描く（届く前に描くと別の字体になる）。
  // maxTexture：GPU の画像の大きさの上限（main.js が renderer から渡す）
  async function draw(goods, { maxTexture = 4096 } = {}) {
    await Promise.all([
      document.fonts.load(`700 40px "Caveat"`),
      document.fonts.load(`500 40px "Caveat"`),
      document.fonts.load(`400 30px "Yomogi"`, 'グッズ'),
    ]).catch(() => {});
    const images = await Promise.all((goods.items ?? []).map((it) => loadImage(it.image)));
    source = { goods, images, maxTexture: Math.min(PAPER.maxTexture, maxTexture) };
    focus = -1;
    swapTexture(await render(focus), true);
    page.view = Math.min(page.h, PAPER.px * PAPER.view);
    viewH = (PAPER.width * page.view) / PAPER.px;
    scroll.now = scroll.target = 0;
    applyScroll();
    buildPaperMesh();
  }

  // 組み版を 1 枚の画像に描く。f：大きく載せるグッズ。
  // 描くのに手間がかかるので、少しずつ区切って描く（その間も部屋の動きは止めない）
  async function render(f) {
    const { goods, images, maxTexture } = source;
    const W = PAPER.px;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    // 1 回目で高さを測り、2 回目で描く
    c.width = 8;
    c.height = 8;
    const contentH = Math.max(Math.round(W * PAPER.view), (await layout(ctx, goods, images, W, false, f)).height);
    const s = Math.min(PAPER.res, maxTexture / contentH, maxTexture / W);
    c.width = Math.round(W * s);
    c.height = Math.round(contentH * s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    // 紙の地（細かな繊維を何万も描くので重い）は一度だけ描いて取っておき、並びを替えるときは写すだけにする
    const g = paperGround(W, contentH, s);
    ctx.drawImage(g.canvas, 0, 0, W * g.s, contentH * g.s, 0, 0, W, contentH);
    const out = await layout(ctx, goods, images, W, true, f);
    return { texture: paperTexture(c), height: contentH, regions: out.regions, anchors: out.anchors };
  }

  // 描いた画像に貼り替える。instant でなければ、今の絵から少しずつ移り変わる
  function swapTexture(r, instant) {
    if (fade.old) {
      fade.old.dispose();
      fade.old = null;
    }
    if (instant) {
      texture.dispose();
      prevTex.value = null;
      fade.t = 1;
      mix.value = 1;
    } else {
      prevTex.value = texture;
      prevUv.value.set(texture.offset.y, texture.repeat.y);
      fade.old = texture;
      fade.t = 0;
      mix.value = 0;
    }
    texture = r.texture;
    paperMat.map = texture;
    paperMat.emissiveMap = texture;
    regions = r.regions;
    page.h = r.height;
  }

  // グッズ i を大きく載せる（-1 でふだんの 2 列に戻す）。並びを替えたら、そのグッズが見える所までスクロールする
  let rendering = false;
  async function setFocus(i, { instant = false } = {}) {
    if (!source || i === focus || rendering) return false;
    if (!instant && (reveal.value < 0.98 || fade.t < 1)) return false;
    const was = focus;
    focus = i;
    rendering = true;
    const r = await render(i).finally(() => (rendering = false));
    swapTexture(r, instant);
    const at = i >= 0 ? r.anchors.focus : r.anchors[was];
    scroll.now = scroll.target = THREE.MathUtils.clamp((at ?? 0) - 40, 0, maxScroll());
    applyScroll();
    return true;
  }

  function applyScroll() {
    texture.repeat.set(1, page.view / page.h);
    texture.offset.set(0, 1 - (scroll.now + page.view) / page.h);
  }

  // 巻き取った長さ（m）から、巻いた紙の太さ
  const rolled = (meters) => Math.sqrt(PAPER.rollRadius ** 2 + (Math.max(0, meters) * PAPER.thickness) / Math.PI);
  const toMeters = (px) => (px / page.w) * PAPER.width;

  // 揺れ（棒を支点にした振り子）。ロボットの動きの加速度で揺れ、だんだん収まる
  const sway = { x: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, prev: null, vel: new THREE.Vector3(), first: true };
  const wp = new THREE.Vector3();
  const lv = new THREE.Vector3();
  const qParent = new THREE.Quaternion();
  const qWant = new THREE.Quaternion();
  const qSway = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  let unroll = 0;
  let time = 0;

  function update(dt, { visible, open }) {
    group.visible = visible;
    if (!visible) {
      unroll = 0;
      sway.first = true;
      scroll.now = scroll.target = 0;
      return;
    }
    // 広げ始めるのは、着いて揺れが収まってから。離れるときは、上まで戻してから巻き上げる
    const settled = Math.abs(sway.x) + Math.abs(sway.z) < 0.05;
    const target = open && (unroll > 0 || settled) ? 1 : 0;
    if (!open) scroll.target = 0;
    const step = dt / PAPER.unrollSeconds;
    const back = !open && scroll.now > 4; // 閉じるときは、まず巻き取った分を戻す
    if (!back) unroll = target > unroll ? Math.min(target, unroll + step) : Math.max(target, unroll - step * 1.4);
    const u = unroll * unroll * (3 - 2 * unroll);
    reveal.value = u;
    if (fade.t < 1) {
      fade.t = Math.min(1, fade.t + dt / PAPER.swapSeconds);
      mix.value = fade.t * fade.t * (3 - 2 * fade.t);
      if (fade.t === 1) {
        prevTex.value = null;
        fade.old?.dispose();
        fade.old = null;
      }
    }

    // スクロール：なめらかに追いかける
    scroll.target = THREE.MathUtils.clamp(scroll.target, 0, maxScroll());
    scroll.now += (scroll.target - scroll.now) * (1 - Math.exp(-dt * (back ? 6 : 10)));
    if (Math.abs(scroll.target - scroll.now) < 0.3) scroll.now = scroll.target;
    applyScroll();

    // 上の巻き：巻き取った分だけ太る。下の巻き：まだ見えていない分（広げる前は紙全体）
    const top = rolled(toMeters(scroll.now));
    topRoll.scale.set(top, 1, top);
    topRoll.position.set(0, 0, 0.002);
    const hidden = page.h - scroll.now - page.view * u;
    const bottom = rolled(toMeters(hidden)) * (hidden > 1 ? 1 : 0.6);
    bottomRoll.scale.set(bottom, 1, bottom);
    const py = paper ? paper.position.y : -0.008;
    const pz = paper ? paper.position.z : 0.005;
    // 下の端は浮遊ユニットで宙に浮く。噴射の揺らぎに合わせて、ほんのわずかに上下する
    time += dt;
    const hover = Math.sin(time * 2.6) * 0.0015 * u;
    bottomRig.position.set(0, py - viewH * u + hover, pz + 0.004 + 0.02 * u ** 6);
    if (hidden <= 1) bottomRoll.scale.set(PAPER.rodRadius + 0.003, 1, PAPER.rodRadius + 0.003); // 最後まで広げても、芯に少しだけ巻き残る
    // 巻いて運ぶ間は弱く、広げるときに強く噴く
    for (const h of hovers) h.update(time, 0.35 + 0.65 * u);

    // 揺れ
    if (dt > 0) {
      group.getWorldPosition(wp);
      if (sway.first) {
        sway.prev = wp.clone();
        sway.vel.set(0, 0, 0);
        sway.ax = sway.az = 0;
        sway.x = sway.z = sway.vx = sway.vz = 0;
        sway.first = false;
      }
      lv.copy(wp).sub(sway.prev).divideScalar(dt);
      // 加速度。コマごとのばらつきで暴れないよう、なめらかにする
      const blend = 1 - Math.exp(-dt * 10);
      sway.ax += ((lv.x - sway.vel.x) / dt - sway.ax) * blend;
      sway.az += ((lv.z - sway.vel.z) / dt - sway.az) * blend;
      sway.vel.copy(lv);
      sway.prev.copy(wp);
      const len = 0.06 + viewH * 0.5 * Math.max(0.2, u); // 振り子の長さ（広げるほど長く、ゆっくり）
      const k = 9.8 / len;
      const damping = 4.5;
      const fx = THREE.MathUtils.clamp(sway.ax, -1.6, 1.6) / len;
      const fz = THREE.MathUtils.clamp(sway.az, -1.6, 1.6) / len;
      // 加速した向きと反対へ振れる（引っ張られて遅れる）。コマ落ちしても暴れないよう細かく刻んで解く
      const n = Math.ceil(dt / (1 / 120));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        sway.vz += (-k * sway.z - damping * sway.vz + fx) * h;
        sway.vx += (-k * sway.x - damping * sway.vx - fz) * h;
        sway.z = THREE.MathUtils.clamp(sway.z + sway.vz * h, -SWAY_MAX, SWAY_MAX);
        sway.x = THREE.MathUtils.clamp(sway.x + sway.vx * h, -SWAY_MAX, SWAY_MAX);
      }
      // ロボットが首を傾けても、紙は鉛直に吊り下がる（向きは左右の向きだけ追う）
      group.parent?.getWorldQuaternion(qParent);
      eul.setFromQuaternion(qParent, 'YXZ');
      qWant.setFromAxisAngle(UP, eul.y).multiply(qSway.setFromEuler(eul.set(sway.x, 0, sway.z)));
      pivot.quaternion.copy(qParent.invert()).multiply(qWant);
    }
  }

  function maxScroll() {
    return Math.max(0, page.h - page.view);
  }

  // スクロール。px は組み版の画素（下へ正）
  function scrollBy(px) {
    if (reveal.value < 0.98 || maxScroll() === 0) return false;
    scroll.target = THREE.MathUtils.clamp(scroll.target + px, 0, maxScroll());
    return true;
  }

  // 押した所（紙の uv）にあるもの：{ url }（購入ページ）か { focus }（写真：大きくする・戻す）か null
  function actionAt(uv) {
    if (!uv || uv.y < 1 - reveal.value || fade.t < 1) return null;
    const x = uv.x * page.w;
    const y = (1 - uv.y) * page.view + scroll.now;
    return regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
  }

  return {
    group,
    draw,
    update,
    actionAt,
    setFocus,
    scrollBy,
    get focus() {
      return focus;
    },
    // 今の紙の画像（main.js で、並びを替えたらすぐ GPU へ送る）
    get texture() {
      return texture;
    },
    get paper() {
      return paper;
    },
    // 紙 1m あたりの組み版の画素（画面のドラッグ量をスクロール量にするため）
    get pagePxPerMeter() {
      return page.w / PAPER.width;
    },
    get scrollable() {
      return maxScroll() > 0;
    },
    // ロボットの下に吊るしたときの、マグネットの下から紙の下端までの長さと、紙の幅（m）
    get size() {
      return { width: PAPER.width + 0.05, depth: -pivot.position.y + PAPER.rollRadius + viewH + 0.075 }; // 下の浮遊ユニットの分も含める
    },
    get opened() {
      return reveal.value > 0.98;
    },
  };
}

// ---------- 下の端の浮遊ユニット ----------

// 棒の両端の真下に吊るした、小さな浮遊機。白い艶のある涙形の殻に、青く光る輪と細い光の筋。
// 底のリングから下へ青い光を放って、紙の下端を宙に支える（羽根などの回る部品はない）
const HOVER_COLOR = new THREE.Color('#5fd8ff');
let hoverGlowTexture;
function hoverUnit(side, rodLength) {
  const group = new THREE.Group();
  group.position.set(side * (rodLength / 2 - 0.014), -0.034, 0);
  const shell = new THREE.MeshPhysicalMaterial({ color: '#eef1f4', metalness: 0.1, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  const graphite = new THREE.MeshStandardMaterial({ color: '#1b1e24', metalness: 0.8, roughness: 0.3 });
  const lightMat = new THREE.MeshBasicMaterial({ color: HOVER_COLOR, transparent: true });

  // 殻：上が丸く、下へすぼまる涙形（回転体）
  const profile = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    const r = Math.sin(a) * (0.018 - 0.006 * (i / 16));
    profile.push(new THREE.Vector2(Math.max(0.0005, r), 0.016 * Math.cos(a) - (i / 16) * 0.004));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  // 胴を一周する光の輪と、その下の黒い継ぎ目
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0182, 0.0011, 8, 48), lightMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.002;
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.0176, 0.0168, 0.003, 32), graphite);
  seam.position.y = -0.0055;
  // 前後に走る細い光の筋（縦の 2 本）
  const stripGeo = new THREE.BoxGeometry(0.0012, 0.012, 0.0008);
  const strips = [1, -1].map((s) => {
    const m = new THREE.Mesh(stripGeo, lightMat);
    m.position.set(0, 0.006, s * 0.0168);
    return m;
  });
  // 棒をつかむ、細い黒の支柱と光る継ぎ目
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.003, 0.02, 12), graphite);
  arm.position.y = 0.025;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0068, 0.0018, 8, 24), graphite);
  collar.rotation.y = Math.PI / 2;
  collar.position.y = 0.034;
  // 底の放射リング（光る輪と、中の黒いレンズ）
  const emitter = new THREE.Mesh(new THREE.TorusGeometry(0.0085, 0.0016, 8, 40), lightMat);
  emitter.rotation.x = Math.PI / 2;
  emitter.position.y = -0.0185;
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 32), graphite);
  lens.rotation.x = Math.PI / 2;
  lens.position.y = -0.0184;
  if (!hoverGlowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(230,250,255,1)');
    r.addColorStop(0.3, 'rgba(100,215,255,0.55)');
    r.addColorStop(1, 'rgba(40,130,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    hoverGlowTexture = new THREE.CanvasTexture(c);
  }
  const sprite = () =>
    new THREE.Sprite(
      new THREE.SpriteMaterial({ map: hoverGlowTexture, color: HOVER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
  const glow = sprite();
  glow.position.y = -0.022;
  // 下へ伸びる、細く消えていく光の柱
  const beam = sprite();
  const ringGlow = sprite();
  ringGlow.position.y = -0.002;
  group.add(body, ring, seam, ...strips, arm, collar, emitter, lens, glow, beam, ringGlow);
  group.traverse((o) => o.isMesh && (o.userData.noPick = true));
  const phase = side * 1.3;
  return {
    group,
    update(t, power) {
      const flicker = 0.88 + 0.08 * Math.sin(t * 31 + phase) + 0.04 * Math.sin(t * 97 + phase * 2);
      const a = power * flicker;
      lightMat.opacity = 0.55 + 0.45 * a;
      glow.material.opacity = a;
      glow.scale.setScalar(0.03 + 0.03 * a);
      beam.material.opacity = 0.55 * a;
      beam.scale.set(0.012, 0.03 + 0.06 * a, 1);
      beam.position.y = -0.022 - (0.015 + 0.03 * a);
      // 胴の光の輪が、ゆっくり息をするように明るくなる
      ringGlow.material.opacity = 0.25 + 0.2 * Math.sin(t * 2.2 + phase);
      ringGlow.scale.set(0.05, 0.012, 1);
    },
  };
}

function paperTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- 紙の地 ----------

// 描いた紙の地を取っておく（倍率 s ごと。足りなくなったら、1 枚分の余裕を持たせて描き直す）
let ground = null;
function paperGround(W, H, s) {
  if (!ground || ground.s < s - 1e-3 || ground.H < H) {
    const gh = Math.ceil(H + W * PAPER.view * 2);
    const c = document.createElement('canvas');
    c.width = Math.round(W * s);
    c.height = Math.round(gh * s);
    const ctx = c.getContext('2d');
    ctx.setTransform(s, 0, 0, s, 0, 0);
    agedPaper(ctx, W, gh);
    ground = { canvas: c, s, H: gh };
  }
  return ground;
}

function agedPaper(ctx, W, H) {
  const rand = mulberry32(31);
  // 地の色：中央は明るく、縁ほど焼けて濃い
  ctx.fillStyle = '#e7d9b8';
  ctx.fillRect(0, 0, W, H);
  // 焼けは 1 枚分ずつ繰り返す（長い紙でも、どこを見ても同じくらい古びている）
  const unit = W * PAPER.view;
  for (let y0 = 0; y0 < H; y0 += unit) {
    const g = ctx.createRadialGradient(W / 2, y0 + unit * 0.45, unit * 0.15, W / 2, y0 + unit / 2, Math.hypot(W, unit) * 0.62);
    g.addColorStop(0, 'rgba(250, 240, 214, 0.5)');
    g.addColorStop(0.7, 'rgba(190, 160, 110, 0.1)');
    g.addColorStop(1, 'rgba(120, 85, 40, 0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, unit);
  }
  // 左右の縁の焼け
  for (const [x0, x1] of [[0, 60], [W, W - 60]]) {
    const e = ctx.createLinearGradient(x0, 0, x1, 0);
    e.addColorStop(0, 'rgba(110, 70, 25, 0.35)');
    e.addColorStop(1, 'rgba(110, 70, 25, 0)');
    ctx.fillStyle = e;
    ctx.fillRect(Math.min(x0, x1), 0, 60, H);
  }
  // 紙の繊維と細かな汚れ
  const n = Math.round((W * H) / 130);
  for (let i = 0; i < n; i++) {
    const a = rand() * 0.07;
    ctx.fillStyle = rand() < 0.5 ? `rgba(90, 65, 30, ${a})` : `rgba(255, 250, 235, ${a})`;
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 2.2, 1 + rand() * 1.2);
  }
  for (let i = 0; i < n / 35; i++) {
    ctx.strokeStyle = `rgba(110, 85, 50, ${0.03 + rand() * 0.05})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x = rand() * W;
    const y = rand() * H;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, x + (rand() - 0.5) * 50, y + (rand() - 0.5) * 50);
    ctx.stroke();
  }
  // しみ（コーヒーの輪じみと、うすい水じみ）
  const ring = (x, y, r, a) => {
    ctx.lineWidth = r * 0.06;
    ctx.strokeStyle = `rgba(120, 75, 30, ${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.94, rand(), 0, Math.PI * 1.7);
    ctx.stroke();
    const f = ctx.createRadialGradient(x, y, 0, x, y, r);
    f.addColorStop(0, `rgba(150, 105, 50, ${a * 0.25})`);
    f.addColorStop(1, 'rgba(150, 105, 50, 0)');
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ring(W * 0.84, Math.min(H - W * 0.15, unit * 0.88), W * 0.1, 0.12);
  ring(W * 0.13, unit * 0.18, W * 0.05, 0.06);
  if (H > unit * 1.5) ring(W * 0.2, H - unit * 0.3, W * 0.07, 0.08);
  // 折り目（縦に 1 本と、1 枚分ごとに横に 1 本）
  const crease = (x0, y0, x1, y1) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(100, 75, 40, 0.14)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 250, 235, 0.22)';
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2);
    ctx.lineTo(x1 + 2, y1 + 2);
    ctx.stroke();
  };
  crease(W * 0.5, 0, W * 0.505, H);
  for (let y = unit * 0.52; y < H; y += unit) crease(0, y, W, y - 6);
}

// ---------- 組み版 ----------

// focus：大きく載せるグッズの番号（-1 ならふだんの 2 列）。
// 返すもの：height 全体の高さ、regions 押せる所、anchors 並びを替えたときにスクロールして見せる所（番号ごとの枠の上端と、focus の大きな枠の上端）
async function layout(ctx, goods, images, W, paint, focus = -1) {
  // 描くときは、少し描いたら 1 コマ譲る（一度に全部描くと、そのあいだ画面が止まる）
  let slice = performance.now();
  const breathe = async () => {
    if (!paint || performance.now() - slice < 10) return;
    await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    slice = performance.now();
  };
  const M = 84; // 左右の余白
  const GAP = 44; // 2 列のあいだ
  const colW = (W - M * 2 - GAP) / 2;
  const regions = [];
  const anchors = {};
  const rand = mulberry32(7);
  let y = 92;

  // 手書きらしく、行ごとにわずかに傾けて書く
  const text = (s, x, yy, font, { color = INK, align = 'left', tilt = 0.012 } = {}) => {
    if (!paint) return;
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.translate(x, yy);
    ctx.rotate((rand() - 0.5) * tilt);
    // 細い手書きの字は、画面で小さく映るとかすれて薄くなるので、同じインクで縁取って少し太らせる
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, 0, 0);
    ctx.fillText(s, 0, 0);
    // 手書きのインクのにじみ：ほんの少しずらして重ねる（細い字を読みやすく）
    ctx.globalAlpha = 0.35;
    ctx.fillText(s, 0.7, 0.5);
    ctx.restore();
  };
  // 手で引いた線（少し波打つ）
  const line = (x0, yy, x1, { width = 2.5, dash = false, color = 'rgba(43, 38, 32, 0.7)' } = {}) => {
    if (!paint) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash([14, 12]);
    ctx.beginPath();
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const yj = yy + Math.sin(i * 1.7 + x0) * 1.6 + (rand() - 0.5) * 1.4;
      if (i) ctx.lineTo(x, yj);
      else ctx.moveTo(x, yj);
    }
    ctx.stroke();
    ctx.restore();
  };

  // 見出し
  text('quimaglet official studio', W / 2, y, `500 42px ${FONT.hand}`, { align: 'center' });
  y += 128;
  text(goods.title || 'Goods', W / 2, y, `700 150px ${FONT.hand}`, { align: 'center', tilt: 0.03 });
  y += 26;
  line(W / 2 - 230, y, W / 2 + 230, { width: 4 });
  line(W / 2 - 200, y + 12, W / 2 + 210, { width: 2 });
  y += 62;
  const items = goods.items ?? [];
  text(`merchandise list — ${String(items.length).padStart(2, '0')} items`, W / 2, y, `500 42px ${FONT.hand}`, { align: 'center' });
  y += 50;
  text('tap a photo to enlarge', W / 2, y, `500 34px ${FONT.hand}`, { align: 'center', color: 'rgba(43, 38, 32, 0.6)' });
  y += 56;

  // はじめの文章
  const intro = String(goods.body ?? '').trim();
  if (intro) {
    const font = `400 42px ${FONT.jp}`;
    ctx.font = font;
    for (const para of intro.split(/\n/)) {
      for (const l of wrap(ctx, para, W - M * 2)) {
        text(l, M, y, font);
        y += 66;
      }
    }
    y += 18;
  }
  line(M, y, W - M, { dash: true });
  y += 54;

  // 台紙に貼った写真（中心 cx, cy、大きさ w×h）。写真は枠いっぱいに切り抜いて貼る
  const photo = (img, cx, cy, w, h, index) => {
    if (!paint) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((index % 2 ? 1 : -1) * (0.012 + rand() * 0.02) * Math.min(1, colW / w));
    ctx.fillStyle = 'rgba(70, 50, 25, 0.18)';
    ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    ctx.fillStyle = '#f6efdc';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const pad = w > colW ? 18 : 12;
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    if (img) {
      const s = Math.max(iw / img.width, ih / img.height);
      const sw = iw / s;
      const sh = ih / s;
      ctx.globalAlpha = 0.93;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, -iw / 2, -ih / 2, iw, ih);
      ctx.globalAlpha = 1;
    } else {
      // 写真がまだないもの：鉛筆の斜線と、手書きの no image
      ctx.save();
      ctx.beginPath();
      ctx.rect(-iw / 2, -ih / 2, iw, ih);
      ctx.clip();
      ctx.strokeStyle = 'rgba(43, 38, 32, 0.22)';
      ctx.lineWidth = 2;
      for (let k = -ih; k < iw + ih; k += 20) {
        ctx.beginPath();
        ctx.moveTo(-iw / 2 + k, -ih / 2);
        ctx.lineTo(-iw / 2 + k - ih, ih / 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(43, 38, 32, 0.45)';
      ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
      ctx.fillStyle = '#f6efdc';
      ctx.fillRect(-80, -26, 160, 46);
      ctx.fillStyle = 'rgba(43, 38, 32, 0.75)';
      ctx.font = `500 36px ${FONT.hand}`;
      ctx.textAlign = 'center';
      ctx.fillText('no image', 0, 10);
    }
    // 上の角を留めるマスキングテープ
    ctx.fillStyle = 'rgba(232, 220, 170, 0.75)';
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate((sx * w) / 2 - sx * 18, -h / 2 + 4);
      ctx.rotate(sx * -0.7);
      ctx.fillRect(-40, -13, 80, 26);
      ctx.restore();
    }
    ctx.restore();
  };

  // 写真の下の文字（名前・価格・説明・購入ページ）。big は大きく載せたとき。文字の下端を返す
  const details = (it, x, top, w, big) => {
    const k = big ? 1.18 : 1;
    let ty = top + Math.round(62 * k);
    const nameFont = `400 ${Math.round(56 * k)}px ${FONT.jp}`;
    ctx.font = nameFont;
    for (const l of wrap(ctx, String(it.name ?? ''), w)) {
      text(l, x, ty, nameFont);
      ty += Math.round(64 * k);
    }
    if (it.price) {
      text(String(it.price), x, ty + 6, `700 ${Math.round(60 * k)}px ${FONT.hand}`);
      ty += Math.round(66 * k);
    }
    const note = String(it.note ?? '').trim();
    if (note) {
      const noteFont = `400 ${Math.round(38 * k)}px ${FONT.jp}`;
      ctx.font = noteFont;
      for (const para of note.split(/\n/)) {
        for (const l of wrap(ctx, para, w)) {
          text(l, x, ty + 2, noteFont, { color: 'rgba(43, 38, 32, 0.88)' });
          ty += Math.round(54 * k);
        }
      }
    }
    if (it.url) {
      ty += 12;
      const label = 'online store →';
      const font = `700 ${Math.round(48 * k)}px ${FONT.hand}`;
      text(label, x, ty + 6, font, { color: '#2b3f6b' });
      if (paint) {
        ctx.font = font;
        line(x, ty + 16, x + ctx.measureText(label).width, { width: 2, color: 'rgba(43, 63, 107, 0.7)' });
      }
      ty += Math.round(48 * k);
    }
    return ty;
  };

  // ふだんの 1 点分の枠。写真を押すと大きく載せる。写真の下（文字）を押すと購入ページ。下端を返す
  const cell = (it, img, x, top, index) => {
    const imgH = Math.round(colW * 0.74);
    anchors[index] = top;
    photo(img, x + colW / 2, top + imgH / 2, colW, imgH, index);
    const status = String(it.status ?? '').trim();
    if (status && paint) stamp(ctx, status, x + colW - 10, top + imgH - 40, index);
    regions.push({ x: x - 10, y: top - 10, w: colW + 20, h: imgH + 20, focus: index });
    const ty = details(it, x, top + imgH, colW, false);
    if (it.url) regions.push({ x: x - 10, y: top + imgH + 10, w: colW + 20, h: ty - top - imgH, url: it.url });
    return ty;
  };

  // 大きく載せた 1 点（紙の幅いっぱい）。写真は元の縦横比のまま（縦長すぎ・横長すぎは少し切る）。
  // 上の ← all items か、大きな写真を押すと、ふだんの並びに戻す
  const bigCell = (it, img, top, index) => {
    const w = W - M * 2;
    anchors.focus = top;
    const back = '← all items';
    const backFont = `700 56px ${FONT.hand}`;
    text(back, M, top + 46, backFont, { color: '#2b3f6b' });
    ctx.font = backFont;
    regions.push({ x: M - 16, y: top - 10, w: ctx.measureText(back).width + 40, h: 76, focus: -1 });
    top += 90;
    const aspect = img ? img.height / img.width : 0.7;
    const h = Math.round(w * THREE.MathUtils.clamp(aspect, 0.55, 1.15));
    photo(img, W / 2, top + h / 2, w, h, index);
    const status = String(it.status ?? '').trim();
    if (status && paint) stamp(ctx, status, W - M - 14, top + h - 48, index);
    regions.push({ x: M - 10, y: top - 10, w: w + 20, h: h + 20, focus: -1 });
    const ty = details(it, M, top + h + 8, w, true);
    if (it.url) regions.push({ x: M - 10, y: top + h + 18, w: w + 20, h: ty - top - h - 8, url: it.url });
    return ty;
  };

  // 大きく載せるものがあれば先頭に置き、残りを 2 列に並べる
  const order = items.map((_, i) => i);
  if (focus >= 0 && items[focus]) {
    y = bigCell(items[focus], images[focus], y, focus) + 50;
    await breathe();
    order.splice(focus, 1);
    if (order.length) {
      line(M, y, W - M, { dash: true });
      y += 54;
    }
  }
  for (let n = 0; n < order.length; n += 2) {
    const rowTop = y;
    let rowBottom = y;
    for (let c = 0; c < 2 && n + c < order.length; c++) {
      const i = order[n + c];
      const x = M + c * (colW + GAP);
      rowBottom = Math.max(rowBottom, cell(items[i], images[i], x, rowTop, i));
      await breathe();
    }
    y = rowBottom + 40;
    if (n + 2 < order.length) {
      line(M + 30, y, W - M - 30, { dash: true, width: 2, color: 'rgba(43, 38, 32, 0.4)' });
      y += 50;
    }
  }

  // 結び
  y += 20;
  line(M, y, W - M, { width: 2.5 });
  y += 58;
  text('* 価格・在庫は変わることがあります。', M, y, `400 34px ${FONT.jp}`, { color: 'rgba(43, 38, 32, 0.82)' });
  text('tap outside to close', W - M, y, `500 34px ${FONT.hand}`, { color: 'rgba(43, 38, 32, 0.6)', align: 'right' });
  y += 92;
  return { height: Math.ceil(y), regions, anchors };
}

// ゴム印。枠と字を、ところどころインクが乗らないように押す
function stamp(ctx, status, right, centerY, seed) {
  const color = STAMP.find(([re]) => re.test(status))?.[1] ?? STAMP_ON;
  const rand = mulberry32(97 + seed * 13);
  ctx.save();
  ctx.font = `400 40px ${FONT.jp}`;
  const tw = ctx.measureText(status).width;
  const w = tw + 46;
  const h = 64;
  ctx.translate(right - w / 2, centerY);
  ctx.rotate(-0.12 + (rand() - 0.5) * 0.12);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(246, 239, 220, 0.55)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(status, 0, 3);
  // かすれ：インクを点々と抜く
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.5})`;
    ctx.fillRect((rand() - 0.5) * w, (rand() - 0.5) * h, 1 + rand() * 3, 1 + rand() * 2);
  }
  ctx.restore();
}

// 1 行に収まるように折り返す（日本語は 1 文字ずつ、英語は単語ごと）
function wrap(ctx, text, maxWidth) {
  const lines = [];
  const tokens = String(text).match(/[A-Za-z0-9.,'’!?:;/()&%+\-]+\s*|\s+|./gu) ?? [];
  let line = '';
  for (const tk of tokens) {
    const next = line + tk;
    if (ctx.measureText(next.trimEnd()).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = tk.trimStart();
    } else {
      line = next;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

// 画像は別のサイトのものでも描けるよう、CORS で読む（読めなければ写真なしの枠にする）
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  const url = /^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : `${import.meta.env.BASE_URL}${src.replace(/^\//, '')}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
