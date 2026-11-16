<script setup>
import { computed } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';

const wb = useWorkbench();

const TAB_META = {
  home: { label: '今天', icon: 'sun-medium' },
  todo: { label: '任务', icon: 'list-checks' },
  projects: { label: '项目', icon: 'briefcase' },
  study: { label: '专注', icon: 'timer' },
  standup: { label: '日报', icon: 'clipboard-list' },
  calendar: { label: '日历', icon: 'calendar-days' },
  bookmarks: { label: '网址', icon: 'tags' },
  notes: { label: '笔记', icon: 'book-open' },
  toolbox: { label: '工具', icon: 'zap' },
  ledger: { label: '账本', icon: 'wallet-cards' },
  habits: { label: '习惯', icon: 'leaf' },
  sport: { label: '运动', icon: 'activity' },
  weather: { label: '天气', icon: 'cloud-sun' },
  me: { label: '设置', icon: 'settings' }
};

const items = computed(() => {
  const ids = wb.currentRole.value.mobileTabs || ['home', 'todo', 'study', 'standup'];
  return ids.map(id => ({ id, ...(TAB_META[id] || TAB_META.home) }));
});
const moreActive = computed(() => !items.value.some(item => item.id === wb.currentPage.value));
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
    position: fixed; left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); bottom: calc(8px + env(safe-area-inset-bottom));
    z-index: 35; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px;
    padding: 5px; border: 1px solid var(--line); border-radius: 16px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
  }
  .mobile-tab {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    min-height: 48px; min-width: 44px; padding: 4px 2px; border: 0; border-radius: 12px; background: transparent;
    color: var(--muted); font-size: var(--text-2xs); font-weight: 600;
    transition: background-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
  }
  .mobile-tab:active { transform: scale(.96); }
  .mobile-tab img { width: 19px; height: 19px; opacity: .62; }
  .mobile-tab.is-active { background: var(--brand-pale); color: var(--brand-deep); }
  .mobile-tab.is-active img { opacity: .9; }
}
</style>
