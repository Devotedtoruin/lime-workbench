import { ref, watch, onBeforeUnmount } from 'vue';

// Animated number for KPI values.
//
// Counts from the previous value to the new one instead of snapping, so a water top-up or a
// finished focus session visibly lands. Behaviour we care about:
//   - first render shows the real value immediately; replaying 0 → target on every route
//     return made the KPI look reset;
//   - rapid updates retarget the running animation rather than queuing, so +250 spammed five
//     times still ends on the right number after one smooth pass;
//   - reduced-motion jumps straight to the value: the number is information, not decoration.
export function useAnimatedNumber(source, { duration = 520 } = {}) {
  const display = ref(0);
  const still = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  let frame = 0;
  let from = 0;
  let to = 0;
  let start = 0;
  let initialized = false;

  function step(now) {
    const elapsed = now - start;
    const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
    // ease-out-expo: fast departure, long settle — reads as a value arriving, not a crawl.
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    display.value = Math.round(from + (to - from) * eased);
    if (t < 1) frame = requestAnimationFrame(step);
    else frame = 0;
  }

  function run(next) {
    const target = Number(next) || 0;
    if (target === display.value) return;
    if (still?.matches) { display.value = target; return; }
    cancelAnimationFrame(frame);
    from = display.value;
    to = target;
    start = performance.now();
    frame = requestAnimationFrame(step);
  }

  watch(source, next => {
    const target = Number(next) || 0;
    if (!initialized) {
      // First mount: the number is information, not an entrance animation.
      initialized = true;
      display.value = target;
      return;
    }
    run(target);
  }, { immediate: true });
  onBeforeUnmount(() => cancelAnimationFrame(frame));

  return display;
}
