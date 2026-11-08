<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';

const wb = useWorkbench();
const defaultMins = computed(() => Number(wb.breakMinutes?.value) || 5);
const total = ref(defaultMins.value * 60);
const left = ref(defaultMins.value * 60);
const customMins = ref(defaultMins.value);
const running = ref(false);
let timer = null;

const clock = computed(() => {
  const m = Math.floor(left.value / 60);
  const s = left.value % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});
const progress = computed(() => total.value ? 1 - left.value / total.value : 0);

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  running.value = false;
}
function tick() {
  if (left.value <= 0) {
    stop();
    wb.showToast('休息结束，回到工作状态');
    return;
  }
  left.value -= 1;
}
function start() {
  if (running.value) { stop(); return; }
  if (left.value <= 0) left.value = total.value;
  running.value = true;
  timer = setInterval(tick, 1000);
}
function choose(minutes) {
  const m = Math.min(120, Math.max(1, Math.round(Number(minutes) || 5)));
  stop();
  customMins.value = m;
  total.value = m * 60;
  left.value = total.value;
}
function applyCustom() {
  const m = Math.min(120, Math.max(1, Math.round(Number(customMins.value) || 5)));
  choose(m);
  start();
}
function saveAsDefault() {
  const m = Math.min(120, Math.max(1, Math.round(Number(customMins.value) || Math.round(total.value / 60) || 5)));
  choose(m);
  if (typeof wb.setBreakMinutes === 'function') {
    wb.setBreakMinutes(m);
  }
}
function close() {
  stop();
  wb.breakOpen.value = false;
}
function onKey(event) {
  if (event.key === 'Escape' && wb.breakOpen.value) close();
}
let previousOverflow = '';
watch(() => wb.breakOpen.value, open => {
  if (open) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const m = defaultMins.value;
    customMins.value = m;
    total.value = m * 60;
    left.value = total.value;
    start();
  } else {
    stop();
    document.body.style.overflow = previousOverflow;
  }
});
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  stop();
  document.body.style.overflow = previousOverflow;
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="break">
      <div v-if="wb.breakOpen.value" class="break-overlay" role="dialog" aria-modal="true" aria-label="休息计时">
        <div class="break-glow" aria-hidden="true"></div>
        <article class="break-card glass">
          <button class="break-close" type="button" aria-label="关闭休息" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
          <p class="break-eyebrow">TAKE A MOMENT</p>
          <h2>离开屏幕，<br />让眼睛和肩颈松一松。</h2>
          <div class="breath-wrap">
            <div class="breath-ring" :class="{ 'is-running': running }" :style="{ '--p': progress }">
              <span class="breath-time numeric">{{ clock }}</span>
              <small>{{ running ? '计时中' : '已暂停' }} · 默认 {{ defaultMins }} 分钟</small>
            </div>
          </div>
          <div class="break-presets" aria-label="预设休息时长">
            <button v-for="m in [3, 5, 10, 15]" :key="m" type="button" :class="{ 'is-active': total === m * 60 }" @click="choose(m)">{{ m }} 分钟</button>
          </div>
          <form class="break-custom" @submit.prevent="applyCustom">
            <label class="break-custom-field">
              <span>自定义时长</span>
              <input
                v-model.number="customMins"
                type="number"
                min="1"
                max="120"
                step="1"
                inputmode="numeric"
                aria-label="自定义休息分钟数"
              />
              <em>分钟</em>
            </label>
            <button class="btn btn-soft btn-xs" type="submit">应用</button>
            <button class="btn btn-ghost btn-xs" type="button" @click="saveAsDefault">设为默认</button>
          </form>
          <div class="break-actions">
            <button class="btn btn-primary" type="button" @click="start">{{ running ? '暂停' : '开始休息' }}</button>
            <button class="btn btn-soft" type="button" @click="close">回到工作</button>
          </div>
          <p class="break-hint">起身走动、远眺或补充水分。可在「设置 → 目标」中修改默认休息时长。</p>
        </article>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.break-overlay {
  position: fixed; inset: 0; z-index: 120; display: grid; place-items: center;
  padding: 24px; overflow: auto;
  background: rgb(8 16 24 / .52);
  backdrop-filter: blur(22px) saturate(130%); -webkit-backdrop-filter: blur(22px) saturate(130%);
}
.break-glow {
  position: absolute; width: min(70vw, 760px); aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--brand) 26%, transparent), transparent 66%);
  animation: break-breathe 9s ease-in-out infinite;
  pointer-events: none;
}
.break-card {
  position: relative; width: min(540px, 100%); padding: 34px 36px 30px; border-radius: 30px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--line-strong) 42%, transparent);
  box-shadow: 0 40px 100px -40px rgb(0 0 0 / .5), inset 0 1px 0 rgb(255 255 255 / .5);
}
.break-close { position: absolute; top: 16px; right: 16px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); display: grid; place-items: center; }
.break-close img { width: 15px; height: 15px; opacity: .6; }
.break-eyebrow { margin: 0; font-size: 10.5px; letter-spacing: .2em; color: var(--muted); }
.break-card h2 { margin: 14px 0 20px; font-family: var(--font-display); font-size: clamp(28px, 4vw, 40px); font-weight: 500; line-height: 1.18; letter-spacing: -.035em; }
.breath-wrap { display: grid; place-items: center; padding: 8px 0 18px; }
.breath-ring {
  width: min(230px, 58vw); aspect-ratio: 1; border-radius: 50%; display: grid; place-content: center; text-align: center;
  border: 1px solid color-mix(in srgb, var(--brand) 32%, transparent);
  background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 68%);
  box-shadow: 0 0 0 18px color-mix(in srgb, var(--brand) 5%, transparent), 0 0 70px color-mix(in srgb, var(--brand) 18%, transparent);
}
.breath-ring.is-running { animation: breath 6s ease-in-out infinite; }
.breath-time { font-size: 42px; font-weight: 700; letter-spacing: -.04em; }
.breath-ring small { margin-top: 2px; font-size: 11px; color: var(--muted); letter-spacing: .04em; }
.break-presets { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.break-presets button { min-height: 34px; padding: 0 15px; border-radius: 99px; border: 1px solid var(--line); background: transparent; color: var(--muted); font-size: 12px; }
.break-presets button.is-active { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); font-weight: 600; }
.break-custom {
  display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;
  margin-top: 12px;
}
.break-custom-field {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 99px;
  border: 1px solid var(--line); background: var(--surface-soft);
  font-size: 12px; color: var(--muted);
}
.break-custom-field input {
  width: 48px; border: 0; background: transparent; text-align: center;
  font-size: 13px; font-weight: 700; color: var(--ink); outline: none;
  font-variant-numeric: tabular-nums;
}
.break-custom-field em { font-style: normal; }
.break-actions { display: flex; gap: 10px; margin-top: 18px; }
.break-actions .btn { flex: 1; }
.break-hint { margin: 14px 0 0; text-align: center; font-size: 11.5px; color: var(--muted); }
@keyframes breath { 0%, 100% { transform: scale(.94); } 50% { transform: scale(1.04); } }
@keyframes break-breathe { 0%, 100% { transform: scale(.92); opacity: .6; } 50% { transform: scale(1.06); opacity: 1; } }
.break-enter-active, .break-leave-active { transition: opacity .28s var(--ease-out); }
.break-enter-from, .break-leave-to { opacity: 0; }
@media (max-width: 520px) {
  .break-card { padding: 26px 20px 22px; border-radius: 24px; }
  .break-actions { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .break-glow, .breath-ring.is-running { animation: none; }
}
</style>
