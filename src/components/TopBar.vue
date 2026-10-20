<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench, PAGE_LABELS } from '../composables/useWorkbench.js';
import { useWeather } from '../composables/useWeather.js';

const wb = useWorkbench();
const weather = useWeather();

const emit = defineEmits(['open-command', 'open-notifications']);

const canGoBack = ref(false);
const pageLabel = computed(() => PAGE_LABELS[wb.currentPage.value] || '今天');
const weatherLabel = computed(() => {
  const w = weather.weatherData;
  if (!w.loaded) return '天气';
  return `${w.summary} ${w.temp}`;
});

const alertCount = computed(() => wb.activeAlerts.value.length);
// Without a saved name/avatar, show a neutral placeholder instead of "我" next to "你".
const hasIdentity = computed(() =>
  Boolean(wb.state.settings.displayName?.trim() || wb.state.settings.avatar?.trim() || wb.state.settings.avatarImage)
);

function onScroll() {
  canGoBack.value = window.scrollY > 8;
}
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header class="topbar glass rim" :class="{ 'is-scrolled': canGoBack }">
    <div class="topbar-left">
      <button
        class="btn-icon menu-btn"
        type="button"
        aria-label="打开导航菜单"
        :aria-expanded="wb.mobileDrawerOpen.value"
        @click="wb.mobileDrawerOpen.value = true"
      >
        <span class="menu-bars" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
      <div class="crumb">
        <span class="crumb-page">{{ pageLabel }}</span>
        <span class="crumb-sep" aria-hidden="true">·</span>
        <span class="crumb-now">{{ wb.formattedDate.value }}</span>
      </div>
    </div>

    <div class="topbar-actions">
      <!-- 快捷命令 -->
      <button class="command-trigger" type="button" aria-haspopup="dialog" @click="emit('open-command')">
        <img :src="asset('assets/icons/search.svg')" alt="" />
        <span>快捷命令</span>
        <kbd>Ctrl K</kbd>
      </button>

      <!-- 天气胶囊 -->
      <button class="weather-pill" type="button" title="查看天气与通勤" @click="wb.goto('weather')">
        <img :src="weather.weatherData.icon" alt="" />
        <span>{{ weatherLabel }}</span>
        <small>{{ weather.weatherData.place }}</small>
      </button>

      <!-- 提醒 -->
      <button
        class="btn-icon notif-btn"
        type="button"
        aria-label="待处理提醒"
        title="待处理提醒"
        @click="emit('open-notifications')"
      >
        <img :src="asset('assets/icons/bell.svg')" alt="" />
        <span v-if="alertCount" class="notif-badge">{{ alertCount }}</span>
      </button>

      <!-- 真实个人头像（替代旧的播放按钮） -->
      <button class="topbar-avatar" type="button" title="设置与美化" @click="wb.goto('me')">
        <span class="avatar-frame" aria-hidden="true">
          <img v-if="wb.userAvatar.value.kind === 'image'" :src="wb.userAvatar.value.value" alt="" />
          <img v-else-if="!hasIdentity" class="avatar-placeholder" :src="asset('assets/icons/circle-user-round.svg')" alt="" />
          <template v-else>{{ wb.userAvatar.value.value }}</template>
        </span>
        <span v-if="hasIdentity" class="avatar-name">{{ wb.userDisplayName.value }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky; top: var(--shell-gap); z-index: 30;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  min-height: 62px; padding: 8px 12px 8px 16px;
  border-radius: calc(var(--radius-card) - 2px);
  transition: box-shadow var(--motion-base) var(--ease-out), border-color var(--motion-base);
}
.topbar.is-scrolled { box-shadow: var(--shadow-md), inset 0 1px 0 var(--glass-rim); border-color: var(--line-strong); }

.topbar-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.menu-btn { display: none; }
.menu-bars { position: relative; display: block; width: 18px; height: 12px; }
.menu-bars i { position: absolute; left: 0; width: 18px; height: 2px; border-radius: 2px; background: currentColor; }
.menu-bars i:nth-child(1) { top: 0; }
.menu-bars i:nth-child(2) { top: 5px; }
.menu-bars i:nth-child(3) { top: 10px; }

.crumb { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.crumb-page { font-size: 13px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; }
.crumb-sep { color: var(--muted); opacity: .6; }
.crumb-now { font-size: 13px; color: var(--muted); }

.topbar-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }

.command-trigger {
  display: flex; align-items: center; gap: 9px;
  width: clamp(150px, 20vw, 260px); min-height: 38px; padding: 0 10px 0 12px;
  border: 1px solid var(--line); border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
  color: var(--muted); text-align: left;
  transition: border-color var(--motion-fast), color var(--motion-fast), background-color var(--motion-fast);
}
.command-trigger:hover { border-color: var(--line-strong); color: var(--ink-soft); background: var(--surface); }
.command-trigger img { width: 17px; height: 17px; opacity: .6; }
.command-trigger span { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
kbd {
  font-family: inherit; font-size: 12px; color: var(--muted);
  border: 1px solid var(--line); border-radius: 5px; background: var(--surface);
  padding: 1px 5px; white-space: nowrap;
}

.weather-pill {
  display: flex; align-items: center; gap: 7px;
  min-height: 38px; padding: 0 12px;
  border: 1px solid transparent; border-radius: var(--radius-pill);
  background: transparent; color: var(--ink-soft);
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.weather-pill:hover { background: var(--surface-soft); border-color: var(--line); }
.weather-pill img { width: 20px; height: 20px; object-fit: contain; }
.weather-pill span { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.weather-pill small { font-size: 11.5px; color: var(--muted); white-space: nowrap; }

.notif-btn { position: relative; width: 38px; height: 38px; flex-basis: 38px; }
.notif-badge {
  position: absolute; top: 3px; right: 3px;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--coral); color: #fff;
  font-size: 10px; font-weight: 750; line-height: 16px; text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 顶栏头像 */
.topbar-avatar {
  display: flex; align-items: center; gap: 8px;
  min-height: 38px; padding: 3px 10px 3px 4px;
  border: 1px solid var(--line); border-radius: var(--radius-pill);
  background: var(--surface); box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast) var(--ease-spring), border-color var(--motion-fast);
}
.topbar-avatar:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--brand) 34%, var(--line)); }
.avatar-frame {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%; overflow: hidden;
  display: grid; place-items: center;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 13px; font-weight: 750;
}
.avatar-frame img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { width: 18px !important; height: 18px !important; object-fit: contain; opacity: .55; }
.avatar-name { font-size: 12.5px; font-weight: 650; max-width: 90px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 1180px) {
  .command-trigger { width: 44px; padding: 0; justify-content: center; }
  .command-trigger span, .command-trigger kbd { display: none; }
}
@media (max-width: 860px) {
  .topbar { top: 8px; margin: 0 8px; border-radius: var(--radius-card); min-height: 56px; padding: 6px 8px; }
  .menu-btn { display: grid; }
  .crumb-now { display: none; }
  .weather-pill { padding: 0 8px; }
  .weather-pill small { display: none; }
  .avatar-name { display: none; }
  .topbar-avatar { padding: 3px; border-color: transparent; background: transparent; box-shadow: none; }
}
@media (max-width: 560px) {
  .crumb { display: none; }
}
</style>
