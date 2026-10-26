// 鼠标聚光灯追踪（为 .rim 卡片注入 --mx / --my，并在滚动时自动避让以保证 60fps 流畅滑动）
let initialized = false;

export function initSpotlight() {
  if (initialized || typeof document === 'undefined') return;
  if (window.matchMedia?.('(pointer: coarse)').matches) return;
  initialized = true;

  let active = null;
  let rafId = 0;
  let lastX = 0;
  let lastY = 0;
  let scrollingUntil = 0;

  window.addEventListener('scroll', () => {
    scrollingUntil = performance.now() + 180;
  }, { passive: true, capture: true });

  function flushSpotlight() {
    rafId = 0;
    if (performance.now() < scrollingUntil) return;
    const el = document.elementFromPoint(lastX, lastY);
    const card = el?.closest?.('.rim');
    if (active && active !== card) {
      active.style.removeProperty('--mx');
      active.style.removeProperty('--my');
    }
    active = card || null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${Math.round(lastX - rect.left)}px`);
    card.style.setProperty('--my', `${Math.round(lastY - rect.top)}px`);
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (performance.now() < scrollingUntil) return;
    lastX = event.clientX;
    lastY = event.clientY;
    if (!rafId) {
      rafId = window.requestAnimationFrame(flushSpotlight);
    }
  }, { passive: true });
}
