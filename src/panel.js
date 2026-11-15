// 家具やメニューから開く情報パネル（ロボットが映すホログラム）。URL の #about などでも直接開ける。
//   onRequest(id): メニューが押されたとき。渡すと、すぐには開かずに呼び出し側へ任せる
//     （ロボットが飛んできてから open する。main.js）
//   onClosing(): 閉じ始めたとき（消えていくアニメーションの最初）。onClose は消え終わってから
//   guard(fn): 押して閉じる操作を包む（連続タップ対策。main.js の act）
export function createPanel(sections, { onOpen, onClose, onClosing, onRequest, guard = (fn) => fn }) {
  const panel = document.getElementById('panel');
  const scrim = document.getElementById('panel-scrim');
  const kicker = document.getElementById('panel-kicker');
  const title = document.getElementById('panel-title');
  const body = document.getElementById('panel-body');
  const closeButton = panel.querySelector('.panel-close');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let returnFocus = null;
  let closing = false;

  let openSeq = 0;
  async function open(id) {
    const section = sections[id];
    if (!section) return;
    const seq = ++openSeq;
    if (panel.hidden) returnFocus = document.activeElement;
    closing = false;
    panel.classList.remove('is-closing');
    kicker.textContent = section.kicker ?? '';
    title.textContent = section.title;
    body.innerHTML = section.body;
    body.scrollTop = 0;
    panel.scrollTop = 0;
    panel.hidden = false;
    scrim.hidden = false;
    // ほとんど透明なまま一度置いて、光る文字などを描く下ごしらえを済ませてから映し始める
    // （映り始めのアニメーションと同時に描くと、そこで 0.2 秒ほど止まる）
    panel.classList.add('is-warming');
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
    panel.classList.remove('is-warming');
    if (seq !== openSeq || closing || panel.hidden) return;
    // アニメーションを毎回やり直す（別のページへ切り替えたときも映し直す）
    panel.style.animation = 'none';
    void panel.offsetWidth;
    panel.style.animation = '';
    closeButton.focus({ preventScroll: true });
    history.replaceState(null, '', `#${id}`);
    onOpen?.(id);
  }

  function finishClose() {
    if (!closing) return;
    closing = false;
    panel.hidden = true;
    panel.classList.remove('is-closing');
    onClose?.();
  }

  function close() {
    openSeq++;
    panel.classList.remove('is-warming');
    if (panel.hidden || closing) return;
    closing = true;
    scrim.hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    returnFocus?.focus?.({ preventScroll: true });
    onClosing?.();
    if (reducedMotion) return finishClose();
    panel.classList.add('is-closing');
    // animationend が来ない場合（タブが裏にあるなど）にも閉じ切る
    setTimeout(finishClose, 600);
  }

  panel.addEventListener('animationend', (e) => {
    if (e.target === panel && panel.classList.contains('is-closing')) finishClose();
  });
  const closeTap = guard(() => close());
  closeButton.addEventListener('click', closeTap);
  scrim.addEventListener('click', closeTap);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => (onRequest ? onRequest(el.dataset.open) : open(el.dataset.open)));
  });

  return {
    open,
    close,
    get isOpen() {
      return !panel.hidden && !closing;
    },
  };
}
