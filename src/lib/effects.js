// One-shot page-level effects, triggered by real user actions.
//
// Deliberately not a library and not a loop: these fire on completion moments only, animate
// a single element for under a second, then remove it. Nothing is left running afterwards.
//
// Skipped entirely for reduced-motion users — the action still completes, they just don't get
// the flourish. That is the intended alternative, not a degraded state.

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * A ring of light expanding from the element that was completed.
 * Used when a task is checked off: the pointer is already there, so the effect
 * originates where the user's attention is rather than from the screen centre.
 */
export function burstFrom(element) {
  if (!element || reducedMotion()) return;
  const box = element.getBoundingClientRect();
  const size = Math.max(box.width, box.height) * 3.2;
  const node = document.createElement('span');
  node.className = 'burst-ring';
  node.setAttribute('aria-hidden', 'true');
  node.style.left = `${box.left + box.width / 2}px`;
  node.style.top = `${box.top + box.height / 2}px`;
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  document.body.appendChild(node);
  node.addEventListener('animationend', () => node.remove(), { once: true });
  // Belt and braces: if the tab is hidden mid-animation, animationend never fires.
  setTimeout(() => node.remove(), 1200);
}

/**
 * A short edge pulse around the viewport.
 * Used when a focus session finishes: the moment is not attached to any control, so the
 * whole frame carries it — the visual equivalent of a quiet chime.
 */
export function edgePulse() {
  if (reducedMotion()) return;
  const node = document.createElement('span');
  node.className = 'edge-pulse';
  node.setAttribute('aria-hidden', 'true');
  document.body.appendChild(node);
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 1600);
}
