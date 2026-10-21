// Pointer-position lighting for .spot surfaces.
//
// One delegated listener for the whole app instead of per-card handlers: cards are
// created and destroyed constantly (views swap, masonry reorders), and binding each
// one would mean re-attaching listeners on every render. The listener only writes
// two custom properties, which composite on the GPU — no layout, no repaint of
// siblings, and nothing runs when the pointer leaves a spot surface.
//
// Opt out entirely for coarse pointers (touch) and reduced-motion users: on touch
// there is no hover to track, and the effect is decorative.

const SPOT_SELECTOR = '.spot, .panel.glass';

export function initSpotlight() {
  if (typeof window === 'undefined' || !window.matchMedia) return;

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!fine.matches || still.matches) return;

  let active = null;

  function paint(event) {
    const card = event.target.closest?.(SPOT_SELECTOR);
    if (!card) {
      if (active) active = null;
      return;
    }
    if (card !== active) active = card;
    const box = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${Math.round(event.clientX - box.left)}px`);
    card.style.setProperty('--my', `${Math.round(event.clientY - box.top)}px`);
  }

  // passive: we never preventDefault, so the browser can scroll immediately.
  document.addEventListener('pointermove', paint, { passive: true });
  document.addEventListener('pointerleave', () => { active = null; }, { passive: true });
}
