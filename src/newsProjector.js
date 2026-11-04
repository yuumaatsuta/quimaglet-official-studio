import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LATEST_NEWS } from './content.js';

// 2 台目のロボット。サイトを開いて少しすると画面の左から飛んできて、
// 奥の壁（落書きメニューの下）に最新のお知らせをプロジェクターのように映す。
// ほかのメニューが開いている間（setAway(true)）は映すのをやめて画面の外へはけ、閉じたらまた戻ってくる。
// お知らせの本文を読むとき（read(...)）は、選んだ記事を壁いっぱいに映す。縦長の画面（スマホ）で読むときは、映す形も縦長にする

const NEWS = {
  delay: 10, // サイトを開いてから出てくるまで（秒）
  // 立ち位置：奥の壁の前、少し左。ここから壁の投影面へ光を当てる
  // 立ち位置：投影面の左横・少し手前。メニューに重ならないよう、投影面の中ほどの高さ
  stand: { x: -1.95, z: 2.3, above: -0.45 }, // z は奥の壁からの距離、above は投影面の上端からの高さ（m）
  width: 0.42, // ロボットの幅（m）。1 台目と同じ
  speed: 1.5, // 飛ぶ速さ（m/秒）
  accel: 1.2,
  // 投影面（奥の壁）。上端は落書きメニューの下端から gap 下
  gap: 0.12,
  // 投影の大きさ。左右のブラウン管のタワーの間の壁いっぱいに、メニューの下からソファの上まで
  maxHeight: 2.0, // 高さ（m）
  maxWidth: 2.6, // 幅（m）。カードは 4:3
  minBottom: 1.0, // 下端をここより下げない（ソファに隠れる）
  aspect: 4 / 3,
  color: '#7fc4ff', // 投影の光の色
};

// 顔の下の光るスロット（robot.glb の元の座標）。studioRoom.js の ROBOT_EMITTER と同じ
const EMITTER = new THREE.Vector3(0, 0.087, 0.27);

export async function buildNewsProjector({ manager, wallZ, menu }) {
  const gltf = await new GLTFLoader(manager).loadAsync(`${import.meta.env.BASE_URL}models/robot.glb`);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(NEWS.width / size.x);
  model.updateMatrixWorld(true);
  model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));

  const group = new THREE.Group();
  const body = new THREE.Group(); // 位置と向き
  const head = new THREE.Group(); // うつむき・揺れ
  head.add(model);
  body.add(head);
  group.add(body);

  const emitter = new THREE.Object3D();
  emitter.position.copy(EMITTER);
  model.add(emitter);
  const lamp = new THREE.PointLight(NEWS.color, 0, 1.4, 2); // 投影口のまわりを照らす
  emitter.add(lamp);

  // 壁の投影面。文字と画像は canvas に描く（形が変わると描き直す）
  const card = drawCard();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: card.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
    }),
  );
  screen.userData.noPick = true;
  group.add(screen);
  card.onTexture = (tex) => {
    screen.material.map = tex;
    screen.material.needsUpdate = true;
  };

  // 投影口から投影面の四隅へ広がる光（薄い四角錐）
  const beamGeo = new THREE.BufferGeometry();
  const beamPos = new Float32Array(4 * 3 * 3);
  const beamFade = new Float32Array(4 * 3);
  for (let f = 0; f < 4; f++) beamFade.set([1, 0.12, 0.12], f * 3);
  beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3));
  beamGeo.setAttribute('fade', new THREE.BufferAttribute(beamFade, 1));
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(NEWS.color) }, uOpacity: { value: 0 } },
    vertexShader: `attribute float fade; varying float vFade;
      void main() { vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vFade;
      void main() { gl_FragColor = vec4(uColor * vFade * uOpacity * 0.22, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.userData.noPick = true;
  group.add(beam);

  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const apex = new THREE.Vector3();
  const target = new THREE.Vector3();
  const off = new THREE.Vector3();
  const stand = new THREE.Vector3();
  const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

  const st = {
    pos: null,
    speed: 0,
    yaw: 0,
    pitch: 0,
    away: false,
    on: 0, // 投影の強さ 0〜1
    last: 0,
    reading: false, // お知らせの本文を映している
    aspect: NEWS.aspect,
  };

  function layout() {
    // 投影面：メニューの下、左右は部屋の中央
    const top = (menu.userData.bottom ?? 3.4) - NEWS.gap;
    const h = Math.max(0.6, Math.min(NEWS.maxHeight, NEWS.maxWidth / st.aspect, top - NEWS.minBottom));
    const w = h * st.aspect;
    screen.scale.set(w, h, 1);
    screen.position.set(0, top - h / 2, wallZ + 0.008);
    corners[0].set(-w / 2, top, wallZ + 0.01);
    corners[1].set(w / 2, top, wallZ + 0.01);
    corners[2].set(w / 2, top - h, wallZ + 0.01);
    corners[3].set(-w / 2, top - h, wallZ + 0.01);
    target.set(0, top - h / 2, wallZ);
    stand.set(NEWS.stand.x, top + NEWS.stand.above, wallZ + NEWS.stand.z);
  }

  // 画面の外（左）の待機場所：窓のすぐ手前の、画面の左端より外
  function offstage(view) {
    if (!view) return off.set(-4, stand.y, wallZ + 6);
    const { eye, win } = view;
    const z = win.cz + 0.6;
    const k = (eye.z - z) / (eye.z - win.cz);
    const left = eye.x + (win.cx - win.halfW - eye.x) * k;
    const y = eye.y + (win.cy + win.halfH * 0.35 - eye.y) * k;
    return off.set(left - 0.6, y, z);
  }

  group.userData.update = (t, view) => {
    const dt = Math.min(t - st.last, 0.1);
    st.last = t;
    layout();
    offstage(view);
    if (st.pos === null) st.pos = off.clone();

    // 本文を読んでいる間は、ほかの事情にかかわらず映す
    const show = st.reading || (t > NEWS.delay && !st.away);
    // はけるときは、まず投影を消してから飛ぶ
    const goal = show ? stand : off;
    const beamDone = st.on < 0.02;
    const canMove = show || beamDone;

    const d = new THREE.Vector3().subVectors(goal, st.pos);
    const dist = d.length();
    if (canMove && dist > 1e-4) {
      const cap = Math.min(NEWS.speed, Math.sqrt(2 * NEWS.accel * dist));
      st.speed = Math.min(st.speed + NEWS.accel * dt, cap);
      st.pos.addScaledVector(d, Math.min(1, (st.speed * dt) / dist));
    } else {
      st.speed = 0;
    }
    const arrived = show && dist < 0.03;

    // 向き：飛んでいる間は進む方へ、着いたら投影面へ（モデルの正面は +z）
    let yawTo;
    let pitchTo = 0;
    if (arrived || (show && dist < 0.5)) {
      apex.copy(st.pos);
      const dx = target.x - apex.x;
      const dz = target.z - apex.z;
      yawTo = Math.atan2(dx, dz);
      pitchTo = Math.atan2(apex.y - target.y, Math.hypot(dx, dz)); // 正でうつむく
    } else if (dist > 0.05) {
      yawTo = Math.atan2(d.x, d.z);
    } else {
      yawTo = st.yaw;
    }
    // 角度は近い回り方で追う
    let dy = yawTo - st.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.yaw = damp(st.yaw, st.yaw + dy, 3, dt);
    st.pitch = damp(st.pitch, pitchTo, 3, dt);

    const bob = arrived ? 0.35 : 1;
    body.position.set(st.pos.x, st.pos.y + (Math.sin(t * 0.85) * 0.05 + Math.sin(t * 0.41) * 0.025) * bob, st.pos.z);
    body.rotation.set(0, st.yaw, 0);
    head.rotation.set(st.pitch + Math.sin(t * 0.55) * 0.03, 0, Math.sin(t * 0.7) * 0.03);

    // 投影：着いてから点き、はけるときは消える。点くときは少しちらつく
    st.on = damp(st.on, arrived ? 1 : 0, arrived ? 2.2 : 8, dt);
    if (st.on < 0.002) st.on = 0;
    const flicker = st.on < 0.85 ? 0.6 + 0.4 * Math.abs(Math.sin(t * 37) * Math.sin(t * 11)) : 0.94 + 0.06 * Math.sin(t * 23) * Math.sin(t * 7.1);
    const a = st.on * flicker;
    screen.material.opacity = a;
    screen.visible = a > 0.002;
    beam.visible = a > 0.002;
    beamMat.uniforms.uOpacity.value = a;
    lamp.intensity = a * 1.2;

    if (beam.visible) {
      body.updateMatrixWorld(true);
      emitter.getWorldPosition(apex);
      group.worldToLocal(apex);
      for (let f = 0; f < 4; f++) {
        const c0 = corners[f];
        const c1 = corners[(f + 1) % 4];
        beamPos.set([apex.x, apex.y, apex.z, c0.x, c0.y, c0.z, c1.x, c1.y, c1.z], f * 9);
      }
      beamGeo.attributes.position.needsUpdate = true;
    }
  };

  return {
    group,
    screen,
    // ふだんの投影がはっきり映っているか（壁の投影を押して読めるのは、このときだけ）
    get shown() {
      return st.on > 0.5 && !st.reading;
    },
    // ほかのメニューが開いている間は true（画面の外へはける）
    setAway(v) {
      st.away = v;
    },
    // お知らせの本文を映す。article が null なら、ふだんの最新のお知らせに戻す。
    // aspect：映す形（幅÷高さ）。index / total：何件目か
    read(article, { aspect = NEWS.aspect, index = 0, total = 1 } = {}) {
      st.reading = !!article;
      st.aspect = article ? aspect : NEWS.aspect;
      card.draw(article ? { article, aspect: st.aspect, index, total } : null);
      layout();
      // 映し直す：一瞬弱まって、ちらつきながら戻る
      st.on = Math.min(st.on, 0.35);
    },
    // 投影面の uv（左下 0,0・右上 1,1）にあるもの：{ go: 'prev' | 'list' | 'next' } か { url } か null
    actionAt(uv) {
      return st.reading && uv ? card.actionAt(uv) : null;
    },
    // マウスが乗っているボタン（明るくする）
    hover(go) {
      card.hover(go);
    },
  };
}

// お知らせのカード。
// ふだん：左上に NEWS、左にサムネイル、右にタイトルと本文の出だし（最新の 1 件。4:3）。
// 本文を読むとき：選んだ記事のタイトルと本文の全部。形は画面に合わせる（縦長もある）
function drawCard() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let texture = new THREE.CanvasTexture(canvas);
  const font = (w, px) => `${w} ${px}px Inter, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
  const images = new Map(); // 画像の URL → 読み込んだ画像（読み込み中は null）
  let current = null;
  // 本文を読むときに押せる所（組む大きさ W×H の座標）。links：本文中の URL、buttons：下の 3 つのボタン
  let size = { W: 1, H: 1 };
  let links = [];
  let buttons = [];
  let hovered = null;
  const LINK_COLOR = '#9fe2ff';

  // 画像を読み込んで、読めたら描き直す。外の画像（URL）も使えるが、CORS を許可していない所の画像は読めない（仮のサムネイルのまま）
  function imageFor(src) {
    if (!src) return null;
    if (images.has(src)) return images.get(src);
    images.set(src, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      images.set(src, img);
      draw(current);
    };
    img.src = /^https?:/.test(src) ? src : `${import.meta.env.BASE_URL}${src}`;
    return null;
  }

  // 折り返し。英語は単語の切れ目で、日本語は 1 文字ずつ。長い URL などは途中で折る。
  // paint=false なら描かずに行数だけ数える。maxLines に達したら最後の行を … で切る。
  // linkify=true なら URL を色付き・下線で描き、押せる所として控える
  function wrap(text, x, y, maxW, lineH, maxLines = Infinity, paint = true, linkify = false) {
    const tokens = String(text).match(/https?:\/\/[^\s<>"'、。「」）]+\s*|[A-Za-z0-9'’.,:;!?\-/@#%&_=+~()"$*]+\s*|\s+|./gu) ?? [];
    let line = []; // [{ t: 文字, url }]
    let lines = 0;
    const str = (l) => l.map((p) => p.t).join('');
    const push = (l, t, url) => {
      const last = l[l.length - 1];
      if (last && last.url === url) last.t += t;
      else l.push({ t, url });
    };
    const emit = (l, cut) => {
      lines++;
      if (paint) {
        if (cut) {
          const last = l[l.length - 1];
          last.t = `${last.t.replace(/\s+$/, '').slice(0, -1)}…`;
        }
        let xx = x;
        const base = ctx.fillStyle;
        for (const p of l) {
          const w = ctx.measureText(p.t).width;
          if (p.url) {
            const tw = ctx.measureText(p.t.replace(/\s+$/, '')).width;
            ctx.fillStyle = LINK_COLOR;
            ctx.fillText(p.t, xx, y);
            ctx.fillRect(xx, y + lineH * 0.66, tw, Math.max(2, lineH * 0.04));
            links.push({ url: p.url, x0: xx, y0: y - lineH * 0.15, x1: xx + tw, y1: y + lineH * 0.85 });
            ctx.fillStyle = base;
          } else ctx.fillText(p.t, xx, y);
          xx += w;
        }
      }
      y += lineH;
    };
    for (let i = 0; i < tokens.length; i++) {
      let tok = tokens[i];
      const url = linkify && /^https?:\/\//.test(tok) ? tok.trim() : null;
      // 句読点や閉じかっこは行の頭に来ないよう、はみ出しても前の行に付ける
      const tail = /^[、。，．,.」』）)！？!?ー・…]/.test(tok) && str(line).trim();
      if (tail || ctx.measureText(str(line) + tok).width <= maxW) {
        push(line, tok, url);
        continue;
      }
      if (str(line).trim()) {
        if (lines + 1 >= maxLines) {
          emit(line, true);
          return { y, lines, cut: true };
        }
        emit(line);
      }
      line = [];
      tok = tok.replace(/^\s+/, '');
      // 1 行に入らない長いかたまりは文字で折る
      while (ctx.measureText(tok).width > maxW) {
        let n = 1;
        while (n < tok.length && ctx.measureText(tok.slice(0, n + 1)).width <= maxW) n++;
        if (lines + 1 >= maxLines) {
          emit([{ t: tok.slice(0, n), url }], true);
          return { y, lines, cut: true };
        }
        emit([{ t: tok.slice(0, n), url }]);
        tok = tok.slice(n);
      }
      if (tok) line = [{ t: tok, url }];
    }
    if (str(line).trim()) emit(line);
    return { y, lines, cut: false };
  }

  // 本文（改行・空行あり）を、入るいちばん大きい文字で描く。いちばん小さくても入らなければ途中まで
  function body(text, x, y, maxW, maxH, sizes) {
    const paras = String(text).trim().split('\n');
    for (let si = 0; si < sizes.length; si++) {
      const px = sizes[si];
      const lh = Math.round(px * 1.6);
      ctx.font = font(500, px);
      let h = 0;
      for (const p of paras) h += p.trim() ? wrap(p, x, 0, maxW, lh, Infinity, false).lines * lh : lh * 0.6;
      if (h > maxH && si < sizes.length - 1) continue;
      let yy = y;
      for (const p of paras) {
        if (!p.trim()) {
          yy += lh * 0.6;
          continue;
        }
        const left = Math.floor((y + maxH - yy) / lh);
        if (left < 1) break;
        const r = wrap(p, x, yy, maxW, lh, left, true, true);
        yy = r.y;
        if (r.cut) break;
      }
      return;
    }
  }

  function thumb(img, x, y, w, h) {
    if (img) {
      const s = Math.max(w / img.width, h / img.height);
      const sw = w / s;
      const sh = h / s;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
      ctx.globalAlpha = 1;
    } else {
      // 仮のサムネイル
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, 'rgba(140, 200, 255, 0.55)');
      g.addColorStop(1, 'rgba(40, 90, 220, 0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(235, 245, 255, 0.85)';
      ctx.font = font(900, Math.round(w / 9.6));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('QUIMAGLET', x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }

  // 投影の地（壁に当たった光のむら。中央が明るく、端が暗い）
  function ground(W, H) {
    const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, Math.max(W, H) * 0.62);
    bg.addColorStop(0, 'rgba(30, 90, 220, 0.72)');
    bg.addColorStop(1, 'rgba(10, 32, 120, 0.62)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  // 走査線と、縁のにじみ
  function finish(W, H) {
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = 0; yy < H; yy += 4) ctx.fillRect(0, yy, W, 1);
    const edge = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.55, W / 2, H / 2, Math.hypot(W, H) * 0.52);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function glow(blur, color = '#eaf4ff') {
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(120, 190, 255, 0.9)';
    ctx.shadowBlur = blur;
  }

  // 組む大きさ（W×H）と、canvas の画素の倍率。canvas の大きさが変わったら texture を作り直す
  function setup(W, H, scale) {
    const cw = Math.round(W * scale);
    const ch = Math.round(H * scale);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      texture.dispose();
      texture = new THREE.CanvasTexture(canvas);
      api.texture = texture;
      api.onTexture?.(texture);
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
  }

  // ふだんの、最新のお知らせ
  function drawLatest() {
    const W = 1280;
    const H = 960;
    setup(W, H, 1);
    ground(W, H);
    glow(14);
    ctx.font = font(900, 84);
    ctx.fillText('NEWS', 64, 50);
    ctx.font = font(600, 38);
    ctx.globalAlpha = 0.85;
    ctx.fillText(LATEST_NEWS.date ?? '', 360, 82);
    ctx.globalAlpha = 1;
    const tx = 64;
    const ty = 176;
    const tw = 520;
    const th = 390;
    ctx.shadowBlur = 0;
    thumb(imageFor(LATEST_NEWS.image), tx, ty, tw, th);
    const x = tx + tw + 48;
    glow(10, '#ffffff');
    ctx.font = font(800, 56);
    wrap(LATEST_NEWS.title ?? '', x, ty, W - x - 64, 74, 5);
    const by = ty + th + 44;
    ctx.fillStyle = 'rgba(200, 230, 255, 0.6)';
    ctx.fillRect(tx, by, 120, 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(500, 42);
    wrap(LATEST_NEWS.body ?? '', tx, by + 30, W - tx * 2, 62, 4);
    finish(W, H);
  }

  // 下のボタン（前の記事・News 一覧・次の記事）。壁に映った光の枠として描く。押せる所は buttons に控える
  function drawButtons(W, H, m, portrait, index, total) {
    const items = [
      { go: 'prev', label: '← 前の記事', disabled: index >= total - 1 },
      { go: 'list', label: 'News 一覧', disabled: false },
      { go: 'next', label: '次の記事 →', disabled: index <= 0 },
    ];
    const bh = portrait ? 116 : 78;
    const gap = portrait ? 16 : 24;
    let px = portrait ? 40 : 32;
    let pad = portrait ? 26 : 34;
    const widths = () => {
      ctx.font = font(700, px);
      return items.map((b) => ctx.measureText(b.label).width + pad * 2);
    };
    let ws = widths();
    while (ws.reduce((a, b) => a + b, 0) + gap * 2 > W - m * 2 && px > 20) {
      px -= 2;
      pad = Math.max(16, pad - 2);
      ws = widths();
    }
    const total_w = ws.reduce((a, b) => a + b, 0) + gap * 2;
    let x = (W - total_w) / 2;
    const y = H - m - bh + (portrait ? 8 : 12);
    buttons = [];
    items.forEach((b, i) => {
      const w = ws[i];
      const on = hovered === b.go && !b.disabled;
      ctx.globalAlpha = b.disabled ? 0.28 : 1;
      ctx.shadowBlur = 0;
      ctx.fillStyle = on ? 'rgba(150, 210, 255, 0.38)' : 'rgba(120, 190, 255, 0.14)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, bh, bh / 2);
      ctx.fill();
      ctx.strokeStyle = on ? 'rgba(235, 248, 255, 0.95)' : 'rgba(170, 220, 255, 0.75)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(120, 190, 255, 0.9)';
      ctx.shadowBlur = on ? 18 : 10;
      ctx.stroke();
      glow(on ? 14 : 8, '#ffffff');
      ctx.font = font(700, px);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, x + w / 2, y + bh / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = 1;
      if (!b.disabled) buttons.push({ go: b.go, x0: x, y0: y, x1: x + w, y1: y + bh });
      x += w + gap;
    });
    ctx.shadowBlur = 0;
    return y;
  }

  // 本文を読むときの 1 件。横長なら画像は左上・タイトルはその右、縦長なら画像を上に横いっぱい。いちばん下にボタン
  function drawArticle({ article, aspect, index, total }) {
    const portrait = aspect < 1;
    const W = portrait ? 860 : 1280;
    const H = Math.round(W / aspect);
    setup(W, H, portrait ? 2 : 1.5);
    size = { W, H };
    links = [];
    ground(W, H);
    const m = portrait ? 52 : 64;
    // 見出しの行：NEWS・日付・何件目か
    glow(14);
    ctx.font = font(900, portrait ? 64 : 72);
    ctx.fillText('NEWS', m, m - 10);
    const nw = ctx.measureText('NEWS').width;
    ctx.font = font(600, portrait ? 32 : 36);
    ctx.globalAlpha = 0.85;
    const dy = m + (portrait ? 18 : 22);
    ctx.fillText(article.date ?? '', m + nw + 28, dy);
    ctx.textAlign = 'right';
    ctx.fillText(`${index + 1} / ${total}`, W - m, dy);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    let y = m + (portrait ? 96 : 108);

    const src = article.image;
    const img = imageFor(src);
    if (src && !portrait) {
      const tw = 440;
      const th = 330;
      ctx.shadowBlur = 0;
      thumb(img, m, y, tw, th);
      glow(10, '#ffffff');
      ctx.font = font(800, 52);
      const x = m + tw + 44;
      const r = wrap(article.title ?? '', x, y, W - x - m, 68, 5);
      y = Math.max(y + th, r.y) + 36;
    } else {
      if (src) {
        const tw = W - m * 2;
        const th = Math.round(tw * 0.56);
        ctx.shadowBlur = 0;
        thumb(img, m, y, tw, th);
        y += th + 36;
      }
      glow(10, '#ffffff');
      ctx.font = font(800, portrait ? 50 : 56);
      y = wrap(article.title ?? '', m, y, W - m * 2, portrait ? 66 : 74, 4).y + 20;
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200, 230, 255, 0.6)';
    ctx.fillRect(m, y, 120, 4);
    y += 34;
    const by = drawButtons(W, H, m, portrait, index, total);
    glow(8, '#ffffff');
    body(article.body ?? '', m, y, W - m * 2, by - y - (portrait ? 30 : 26), portrait ? [44, 40, 36, 32, 29, 26] : [44, 40, 36, 33, 30, 27, 24]);
    finish(W, H);
  }

  // uv にあるボタンかリンク（押しやすいよう、少し広めに取る）
  function actionAt(uv) {
    const x = uv.x * size.W;
    const y = (1 - uv.y) * size.H;
    const inside = (r, m) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m;
    const b = buttons.find((r) => inside(r, 10));
    if (b) return { go: b.go };
    const l = links.find((r) => inside(r, 8));
    return l ? { url: l.url } : null;
  }

  function hover(go) {
    if ((go ?? null) === hovered) return;
    hovered = go ?? null;
    if (current) draw(current);
  }

  function draw(what) {
    current = what;
    if (what) drawArticle(what);
    else {
      links = [];
      buttons = [];
      hovered = null;
      drawLatest();
    }
    texture.needsUpdate = true;
  }

  const api = { texture, draw, actionAt, hover, onTexture: null };
  draw(null);
  return api;
}
