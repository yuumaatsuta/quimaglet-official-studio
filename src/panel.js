// 家具やメニューから開く情報パネル。URL の #about などでも直接開ける。
export function createPanel(sections, { onOpen, onClose }) {
  const panel = document.getElementById('panel');
  const scrim = document.getElementById('panel-scrim');
  const kicker = document.getElementById('panel-kicker');
  const title = document.getElementById('panel-title');
  const body = document.getElementById('panel-body');
  const closeButton = panel.querySelector('.panel-close');
  let returnFocus = null;

  function open(id) {
    const section = sections[id];
    if (!section) return;
    returnFocus = document.activeElement;
    kicker.textContent = section.kicker ?? '';
    title.textContent = section.title;
    body.innerHTML = section.body;
    panel.hidden = false;
    scrim.hidden = false;
    // アニメーションを毎回やり直す
    panel.style.animation = 'none';
    void panel.offsetWidth;
    panel.style.animation = '';
    closeButton.focus();
    history.replaceState(null, '', `#${id}`);
    onOpen?.(id);
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    scrim.hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    returnFocus?.focus?.();
    onClose?.();
  }

  closeButton.addEventListener('click', close);
  scrim.addEventListener('click', close);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => open(el.dataset.open));
  });

  return { open, close };
}
