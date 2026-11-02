import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LATEST_NEWS } from './content.js';

// 2 台目のロボット。サイトを開いて少しすると画面の左から飛んできて、
// 奥の壁（落書きメニューの下）に最新のお知らせをプロジェクターのように映す。
// ほかのメニューが開いている間（setAway(true)）は映すのをやめて画面の外へはけ、閉じたらまた戻ってくる

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

  // 壁の投影面。文字と画像は canvas に描く
  const card = drawCard();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(NEWS.aspect, 1),
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
  };

  function layout() {
    // 投影面：メニューの下、左右は部屋の中央
    const top = (menu.userData.bottom ?? 3.4) - NEWS.gap;
    const h = Math.max(0.6, Math.min(NEWS.maxHeight, NEWS.maxWidth / NEWS.aspect, top - NEWS.minBottom));
    const w = h * NEWS.aspect;
    screen.scale.set(h, h, 1);
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

    const show = t > NEWS.delay && !st.away;
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
    // ほかのメニューが開いている間は true（画面の外へはける）
    setAway(v) {
      st.away = v;
    },
  };
}

// お知らせのカード：左上に NEWS、左にサムネイル、右にタイトルと本文
function drawCard() {
  const W = 1280;
  const H = 960; // 4:3
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const font = (w, px) => `${w} ${px}px Inter, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;
  let image = null;

  function wrap(text, x, y, maxW, lineH, maxLines) {
    let line = '';
    let n = 0;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const next = line + chars[i];
      if (ctx.measureText(next).width > maxW && line) {
        n++;
        if (n === maxLines) {
          ctx.fillText(`${line.slice(0, -1)}…`, x, y);
          return y + lineH;
        }
        ctx.fillText(line, x, y);
        y += lineH;
        line = chars[i];
      } else {
        line = next;
      }
    }
    if (line) ctx.fillText(line, x, y);
    return y + lineH;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // 投影の地：壁に当たった光のむら（中央が明るく、端が暗い）
    const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.62);
    bg.addColorStop(0, 'rgba(30, 90, 220, 0.72)');
    bg.addColorStop(1, 'rgba(10, 32, 120, 0.62)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#eaf4ff';
    ctx.shadowColor = 'rgba(120, 190, 255, 0.9)';
    ctx.shadowBlur = 14;
    // 左上の NEWS
    ctx.font = font(900, 84);
    ctx.textBaseline = 'top';
    ctx.fillText('NEWS', 64, 50);
    ctx.font = font(600, 38);
    ctx.globalAlpha = 0.85;
    ctx.fillText(LATEST_NEWS.date ?? '', 360, 82);
    ctx.globalAlpha = 1;

    // サムネイル
    const tx = 64;
    const ty = 176;
    const tw = 520;
    const th = 390;
    ctx.shadowBlur = 0;
    if (image) {
      const s = Math.max(tw / image.width, th / image.height);
      const sw = tw / s;
      const sh = th / s;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, tx, ty, tw, th);
      ctx.globalAlpha = 1;
    } else {
      // 仮のサムネイル
      const g = ctx.createLinearGradient(tx, ty, tx + tw, ty + th);
      g.addColorStop(0, 'rgba(140, 200, 255, 0.55)');
      g.addColorStop(1, 'rgba(40, 90, 220, 0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle = 'rgba(235, 245, 255, 0.85)';
      ctx.font = font(900, 54);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('QUIMAGLET', tx + tw / 2, ty + th / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    ctx.strokeStyle = 'rgba(200, 230, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.strokeRect(tx, ty, tw, th);

    // タイトルと本文
    // タイトルはサムネイルの右、本文はその下に横いっぱい（壁に映しても読める大きさ）
    const x = tx + tw + 48;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(120, 190, 255, 0.9)';
    ctx.shadowBlur = 10;
    ctx.font = font(800, 56);
    wrap(LATEST_NEWS.title ?? '', x, ty, W - x - 64, 74, 5);
    const by = ty + th + 44;
    ctx.fillStyle = 'rgba(200, 230, 255, 0.6)';
    ctx.fillRect(tx, by, 120, 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(500, 42);
    wrap(LATEST_NEWS.body ?? '', tx, by + 30, W - tx * 2, 62, 4);

    // 走査線と、縁のにじみ
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'destination-out';
    for (let yy = 0; yy < H; yy += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, yy, W, 1);
    }
    const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, W * 0.66);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    texture.needsUpdate = true;
  }

  draw();
  if (LATEST_NEWS.image) {
    const img = new Image();
    img.onload = () => {
      image = img;
      draw();
    };
    img.src = `${import.meta.env.BASE_URL}${LATEST_NEWS.image}`;
  }
  return { texture };
}
