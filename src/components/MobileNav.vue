<script setup>
import { computed } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';

const wb = useWorkbench();

const items = [
  { id: 'home', label: '今天', icon: 'sun-medium' },
  { id: 'todo', label: '计划', icon: 'list-checks' },
  { id: 'study', label: '专注', icon: 'timer' },
  { id: 'calendar', label: '日历', icon: 'calendar-days' }
];
const moreActive = computed(() => !items.some(item => item.id === wb.currentPage.value));
</script>

<template>
  <nav class="mobile-nav" aria-label="移动端主导航">
    <button
      v-for="item in items"
      :key="item.id"
      class="mobile-tab"
      :class="{ 'is-active': wb.currentPage.value === item.id }"
      :aria-current="wb.currentPage.value === item.id ? 'page' : undefined"
      type="button"
      @click="wb.goto(item.id)"
    >
      <img :src="asset(`assets/icons/${item.icon}.svg`)" alt="" />
      <span>{{ item.label }}</span>
    </button>
    <button
      class="mobile-tab"
      :class="{ 'is-active': moreActive }"
      type="button"
      aria-label="打开更多页面"
      @click="wb.mobileDrawerOpen.value = true"
    >
      <img :src="asset('assets/icons/sliders-horizontal.svg')" alt="" />
      <span>更多</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-nav { display: none; }

@media (max-width: 860px) {
  .mobile-nav {
    position: fixed; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom));
    z-index: 35; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px;
    padding: 6px; border: 1px solid var(--line); border-radius: 18px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
  }
  .mobile-tab {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-height: 48px; border: 0; border-radius: 12px; background: transparent;
    color: var(--muted); font-size: 10.5px; font-weight: 600;
  }
  .mobile-tab img { width: 19px; height: 19px; opacity: .62; }
  .mobile-tab.is-active { background: var(--brand-pale); color: var(--brand-deep); }
  .mobile-tab.is-active img { opacity: .9; }
}
</style>
