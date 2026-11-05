// メンバーの紹介のホログラムのうち、名前以外を映す表示板（DOM）。名前は memberHolo.js の立体の文字。
// 楽器の前の床に置いたチップ（studioRoom.js の memberChip）の真上に浮かべ、チップから光を扇形に広げて映す。
// 板の位置と大きさは、main.js が毎フレーム、部屋の中の位置を画面に写して place で渡す。光は 3D の上に重ねた 2D の canvas に描く
export function createMemberCard({ onClose }) {
  const card = document.createElement('aside');
  card.className = 'member-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'member-name');
  card.innerHTML = '<button type="button" class="panel-close" aria-label="閉じる">×</button><div class="member-body"></div>';
  const body = card.querySelector('.member-body');
  card.querySelector('.panel-close').addEventListener('click', () => onClose());

  const beam = document.createElement('canvas');
  beam.className = 'member-beam';
  beam.setAttribute('aria-hidden', 'true');
  document.body.append(beam, card);
  const ctx = beam.getContext('2d');

  let closing = null;

  return {
    get isOpen() {
      return !card.hidden && !closing;
    },
    open(html) {
      clearTimeout(closing);
      closing = null;
      body.innerHTML = html;
      card.className = 'member-card';
      card.hidden = false;
      card.scrollTop = 0;
      card.querySelector('.panel-close').focus({ preventScroll: true });
    },
    // 画面上の位置と大きさ（px）。left・width はそのまま、top から height の高さの、決まった大きさの板（中身が多いときは板の中で送る）
    place({ left, top, width, height }) {
      const st = card.style;
      st.left = `${Math.round(left)}px`;
      st.top = `${Math.round(top)}px`;
      st.width = `${Math.round(width)}px`;
      st.height = `${Math.round(height)}px`;
    },
    close() {
      if (card.hidden || closing) return;
      card.classList.add('is-closing');
      closing = setTimeout(() => {
        card.hidden = true;
        closing = null;
      }, 400);
    },
    // emitter: チップの光の出口の画面上の位置 { x, y }（画面の外・後ろなら null）。a: 光の強さ 0〜1
    draw(emitter, a) {
      const w = innerWidth;
      const h = innerHeight;
      const dpr = Math.min(devicePixelRatio, 2);
      if (beam.width !== Math.round(w * dpr) || beam.height !== Math.round(h * dpr)) {
        beam.width = Math.round(w * dpr);
        beam.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!emitter || a <= 0.002) return;
      const { x: ex, y: ey } = emitter;

      // 出口のにじみ（カードが出る前から光らせる）
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, 26);
      glow.addColorStop(0, `rgba(220, 240, 255, ${0.9 * a})`);
      glow.addColorStop(0.4, `rgba(80, 160, 255, ${0.35 * a})`);
      glow.addColorStop(1, 'rgba(30, 80, 220, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(ex - 26, ey - 26, 52, 52);

      if (card.hidden) {
        ctx.globalCompositeOperation = 'source-over';
        return;
      }
      // カードのいちばん近い辺へ扇形に広げる（下の辺が出口より上にあれば下の辺、なければ横の辺）
      const r = card.getBoundingClientRect();
      let p1;
      let p2;
      if (r.bottom < ey - 12) {
        p1 = [r.left, r.bottom];
        p2 = [r.right, r.bottom];
      } else {
        const x = ex < r.left ? r.left : r.right;
        p1 = [x, r.top];
        p2 = [x, r.bottom];
      }
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const fill = ctx.createLinearGradient(ex, ey, mid[0], mid[1]);
      fill.addColorStop(0, `rgba(160, 210, 255, ${0.5 * a})`);
      fill.addColorStop(0.35, `rgba(70, 150, 255, ${0.2 * a})`);
      fill.addColorStop(1, `rgba(30, 80, 220, ${0.08 * a})`);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(...p1);
      ctx.lineTo(...p2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(130, 195, 255, ${0.4 * a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(...p1);
      ctx.moveTo(ex, ey);
      ctx.lineTo(...p2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
