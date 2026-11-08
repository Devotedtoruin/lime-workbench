<script setup>
import { computed } from 'vue';

// 环形进度：r=18 周长 113.1
const props = defineProps({
  percent: { type: Number, default: 0 },
  tone: { type: String, default: 'brand' },
  size: { type: Number, default: 44 }
});
const C = 2 * Math.PI * 18;
const offset = computed(() => C * (1 - Math.max(0, Math.min(100, props.percent)) / 100));
const stroke = computed(() => ({
  brand: 'var(--brand)',
  violet: 'var(--violet)',
  blue: 'var(--blue)',
  amber: 'var(--amber)'
}[props.tone] || 'var(--brand)'));
</script>

<template>
  <span class="ring" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <svg viewBox="0 0 44 44">
      <circle class="track" cx="22" cy="22" r="18" />
      <circle class="fill" cx="22" cy="22" r="18" :style="{ stroke, strokeDashoffset: offset }" />
    </svg>
  </span>
</template>

<style scoped>
.ring { position: relative; display: grid; place-items: center; flex: 0 0 auto; }
svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
circle { fill: none; stroke-width: 3.6; stroke-linecap: round; }
.track { stroke: color-mix(in srgb, var(--muted) 18%, transparent); }
.fill { stroke-dasharray: 113.1; transition: stroke-dashoffset var(--motion-slow) var(--ease-out); }
</style>
