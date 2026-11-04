// GPU が追いつかない端末でだけ、描く解像度を少しずつ下げる（速い端末は最大の解像度のまま）。
// この部屋は画素ごとの光の計算（窓の面光源・映り込み）が重く、内蔵 GPU では解像度がそのまま重さになる。
//
// - 1 秒ごとにフレームの間隔の平均を見て、45fps を切っていたら 15% 下げる
// - 下げても速くならないとき（画面の更新が 30fps に絞られている省電力モードなど）は元に戻し、以後は下げない
// - 余裕が 3 秒続いたら 1 段戻す。戻してすぐ遅くなったら、しばらく戻さない（行ったり来たりしない）
export function createAdaptiveResolution(renderer, { max, min }) {
  const SLOW = 1000 / 45;
  const FAST = 1000 / 57;
  const STEP = 0.85;
  const WARMUP = 3000; // 描き始めはシェーダーの組み立てや映像の読み込みで引っかかるので見ない

  let ratio = max;
  let prev = 0;
  let start = 0;
  let sum = 0;
  let count = 0;
  let good = 0;
  let lastRaise = -Infinity;
  let raiseBlockedUntil = 0;
  let check = null; // 下げた直後：{ before: 下げる前の平均, ratio: 下げる前の解像度 }

  const set = (r) => {
    ratio = r;
    renderer.setPixelRatio(r); // 大きさ（setSize）もこの中で設定し直される
  };

  return {
    get ratio() {
      return ratio;
    },
    frame(now) {
      if (!start) start = now;
      const d = now - prev;
      prev = now;
      if (now - start < WARMUP || d > 250) {
        // 裏に回っていた・一時的な引っかかりは数えない
        sum = count = 0;
        return;
      }
      sum += d;
      count++;
      if (sum < 1000) return;
      const avg = sum / count;
      sum = count = 0;

      if (check) {
        // 下げて速くならないなら、GPU のせいではない。元に戻し、これ以上は下げない
        if (avg > check.before * 0.92) {
          min = check.ratio;
          set(check.ratio);
        }
        check = null;
        return;
      }
      if (avg > SLOW && ratio > min) {
        if (now - lastRaise < 5000) raiseBlockedUntil = now + 60000;
        check = { before: avg, ratio };
        set(Math.max(min, ratio * STEP));
        good = 0;
      } else if (avg < FAST && ratio < max) {
        if (++good >= 3 && now > raiseBlockedUntil) {
          set(Math.min(max, ratio / STEP));
          lastRaise = now;
          good = 0;
        }
      } else {
        good = 0;
      }
    },
  };
}
