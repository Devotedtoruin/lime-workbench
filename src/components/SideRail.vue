<script setup>
import { computed } from 'vue';
import { useWorkbench } from '../composables/useWorkbench.js';

const wb = useWorkbench();
// A brand-new workspace has no saved avatar or nickname; show a neutral placeholder instead
// of the "我" fallback avatar next to the "你" fallback greeting, which reads like two names.
const hasIdentity = computed(() =>
  Boolean(wb.state.settings.displayName?.trim() || wb.state.settings.avatar?.trim() || wb.state.settings.avatarImage)
);

// Two-character labels keep every row on the same text rhythm; page headings keep the full names.
const navItems = [
  { page: 'home', label: '今天', icon: 'sun-medium' },
  { page: 'todo', label: '计划', icon: 'list-checks' },
  { page: 'study', label: '专注', icon: 'timer' },
  { page: 'calendar', label: '日历', icon: 'calendar-days' }
];
const lifeItems = [
  { page: 'ledger', label: '账本', icon: 'wallet-cards' },
  { page: 'habits', label: '习惯', icon: 'leaf' },
  { page: 'sport', label: '运动', icon: 'activity' },
  { page: 'weather', label: '天气', icon: 'cloud-sun' }
];

const drawerOpen = computed(() => wb.mobileDrawerOpen.value);
function navigate(page) {
  wb.goto(page);
  wb.mobileDrawerOpen.value = false;
}
</script>

<template>
  <button
    v-if="drawerOpen"
    class="rail-backdrop"
    type="button"
    aria-label="关闭导航"
    @click="wb.mobileDrawerOpen.value = false"
  />

  <aside
    class="rail glass rim"
    :class="{ 'is-collapsed': wb.railCollapsed.value, 'is-mobile-open': drawerOpen }"
    aria-label="主导航"
  >
    <!-- 品牌 -->
    <a class="rail-brand" href="#home" aria-label="返回今天" @click.prevent="navigate('home')">
      <span class="rail-mark">
        <img src="/assets/brand.svg" alt="" />
      </span>
      <span class="rail-brand-copy">
        <strong>{{ wb.workspaceName.value }}</strong>
        <small>本地优先 · 无需账号</small>
      </span>
    </a>

    <nav class="rail-nav">
      <p class="rail-group">工作</p>
      <button
        v-for="item in navItems"
        :key="item.page"
        type="button"
        class="rail-item"
        :class="{ 'is-active': wb.currentPage.value === item.page }"
        :aria-current="wb.currentPage.value === item.page ? 'page' : undefined"
        :title="wb.railCollapsed.value ? item.label : undefined"
        @click="navigate(item.page)"
      >
        <img :src="`/assets/icons/${item.icon}.svg`" alt="" />
        <span class="rail-label">{{ item.label }}</span>
        <span
          v-if="item.page === 'todo' && wb.state.todos.filter(t => !t.done).length"
          class="rail-count"
        >{{ wb.state.todos.filter(t => !t.done).length }}</span>
      </button>

      <p class="rail-group">生活</p>
      <button
        v-for="item in lifeItems"
        :key="item.page"
        type="button"
        class="rail-item"
        :class="{ 'is-active': wb.currentPage.value === item.page }"
        :aria-current="wb.currentPage.value === item.page ? 'page' : undefined"
        :title="wb.railCollapsed.value ? item.label : undefined"
        @click="navigate(item.page)"
      >
        <img :src="`/assets/icons/${item.icon}.svg`" alt="" />
        <span class="rail-label">{{ item.label }}</span>
      </button>

      <p class="rail-group">个人</p>
      <button
        type="button"
        class="rail-item"
        :class="{ 'is-active': wb.currentPage.value === 'me' }"
        :aria-current="wb.currentPage.value === 'me' ? 'page' : undefined"
        title="设置与美化"
        @click="navigate('me')"
      >
        <img src="/assets/icons/settings.svg" alt="" />
        <span class="rail-label">设置</span>
      </button>
    </nav>

    <div class="rail-foot">
      <!-- 真实个人头像：未设置时显示中性人像图标，而不是「我 + 你」两个代词 -->
      <button class="rail-user" type="button" title="设置头像与称呼" @click="navigate('me')">
        <span class="rail-avatar" aria-hidden="true">
          <img v-if="wb.userAvatar.value.kind === 'image'" :src="wb.userAvatar.value.value" alt="" />
          <img v-else-if="!hasIdentity" class="rail-avatar-placeholder" src="/assets/icons/circle-user-round.svg" alt="" />
          <template v-else>{{ wb.userAvatar.value.value }}</template>
        </span>
        <span class="rail-user-copy">
          <strong>{{ wb.state.settings.displayName?.trim() || '设置形象' }}</strong>
          <small>{{ hasIdentity ? '点此编辑形象' : '头像与称呼' }}</small>
        </span>
      </button>

      <div class="rail-tools">
        <button
          class="btn-icon rail-tool"
          type="button"
          :aria-label="wb.appearance.theme === 'dark' ? '切换到浅色外观' : '切换到深色外观'"
          :title="wb.appearance.theme === 'dark' ? '浅色外观' : '深色外观'"
          @click="wb.toggleDarkTheme()"
        >
          <img :src="`/assets/icons/${wb.appearance.theme === 'dark' ? 'sun-medium' : 'moon'}.svg`" alt="" />
        </button>
        <button
          class="btn-icon rail-tool"
          type="button"
          :aria-label="wb.railCollapsed.value ? '展开侧边栏' : '收起侧边栏'"
          :aria-pressed="wb.railCollapsed.value"
          :title="wb.railCollapsed.value ? '展开侧边栏' : '收起侧边栏'"
          @click="wb.toggleRailCollapsed()"
        >
          <img
            src="/assets/icons/panel-left.svg"
            alt=""
            :style="{ transform: wb.railCollapsed.value ? 'rotate(180deg)' : 'none', transition: 'transform 220ms var(--ease-spring)' }"
          />
        </button>
        <button
          class="btn-icon rail-tool rail-close"
          type="button"
          aria-label="关闭导航"
          @click="wb.mobileDrawerOpen.value = false"
        >
          <img src="/assets/icons/x.svg" alt="" />
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  position: fixed;
  z-index: 40;
  inset: var(--shell-gap) auto var(--shell-gap) var(--shell-gap);
  width: var(--sidebar-w);
  border-radius: calc(var(--radius-card) + 6px);
  display: flex;
  flex-direction: column;
  padding: 18px 12px 12px;
  overflow: hidden;
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  transition: width var(--motion-slow) var(--ease-spring), transform var(--motion-slow) var(--ease-spring);
}
.rail.is-collapsed { width: var(--sidebar-w-collapsed); }

/* 品牌 */
.rail-brand {
  display: flex; align-items: center; gap: 11px;
  padding: 2px 8px 18px; text-decoration: none; color: var(--ink);
  min-width: 0;
}
.rail-mark {
  width: 38px; height: 38px; flex: 0 0 38px; border-radius: 12px;
  display: grid; place-items: center; overflow: hidden;
  background: var(--brand-grad); box-shadow: var(--shadow-brand);
  transition: transform var(--motion-base) var(--ease-spring);
}
.rail-brand:hover .rail-mark { transform: translateY(-1px) scale(1.04); }
.rail-mark img { width: 100%; height: 100%; object-fit: cover; }
.rail-brand-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.rail-brand-copy strong {
  font-size: 15.5px; font-weight: 800; letter-spacing: -.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--brand-deep);
}
.rail-brand-copy small { font-size: 12px; color: var(--muted); letter-spacing: .02em; white-space: nowrap; }

/* 导航 */
.rail-nav { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 2px; padding: 0 2px 8px; overscroll-behavior: contain; }
.rail-group {
  margin: 14px 10px 6px; font-size: 12px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
}
.rail-group:first-child { margin-top: 0; }
.rail-item {
  position: relative; display: flex; align-items: center; gap: 11px;
  width: 100%; min-height: 42px; padding: 0 11px;
  border: 1px solid transparent; border-radius: var(--radius-control);
  background: transparent; color: var(--ink-soft); text-align: left;
  font-size: 13.5px; font-weight: 550;
  transition: background-color var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}
.rail-item img { width: 19px; height: 19px; flex: 0 0 19px; opacity: .66; transition: transform var(--motion-fast), opacity var(--motion-fast); }
/* Neutral hover: the rail itself is glass, so a soft neutral tint reads as a highlight without
   saturating the brand hue into a green wash. */
.rail-item:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
.rail-item:hover img { opacity: .9; transform: scale(1.06); }
.rail-item.is-active {
  background: var(--brand-pale);
  border-color: color-mix(in srgb, var(--brand) 16%, transparent);
  color: var(--brand-deep); font-weight: 700;
}
.rail-item.is-active img { opacity: 1; }
.rail-item.is-active::before {
  content: ""; position: absolute; left: -1px; top: 11px; bottom: 11px;
  width: 3px; border-radius: 0 3px 3px 0;
  background: var(--brand); box-shadow: 0 0 0 0 transparent;
}
.rail-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-count {
  min-width: 20px; height: 19px; padding: 0 6px; display: inline-grid; place-items: center;
  border-radius: 6px; background: var(--surface); border: 1px solid var(--line);
  color: var(--muted); font-size: 11.5px; font-weight: 650; font-variant-numeric: tabular-nums;
}

/* 底部：个人头像 */
.rail-foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 6px; }
.rail-user {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
  padding: 6px; border: 1px solid transparent; border-radius: var(--radius-control);
  background: transparent; text-align: left;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.rail-user:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); border-color: var(--line); }
.rail-avatar {
  width: 34px; height: 34px; flex: 0 0 34px; border-radius: 10px; overflow: hidden;
  display: grid; place-items: center;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 15px; font-weight: 750;
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--line));
}
.rail-avatar img { width: 100%; height: 100%; object-fit: cover; }
.rail-avatar-placeholder { width: 19px !important; height: 19px !important; object-fit: contain; opacity: .55; }
.rail-user-copy { display: flex; flex-direction: column; min-width: 0; }
.rail-user-copy strong { font-size: 13px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-user-copy small { font-size: 12px; color: var(--muted); white-space: nowrap; }
.rail-tools { display: flex; align-items: center; gap: 1px; }
.rail-tool { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 9px; }
.rail-tool img { width: 17px; height: 17px; }
.rail-close { display: none; }

/* ---------- 收起为纯图标 ---------- */
.rail.is-collapsed .rail-brand { justify-content: center; padding: 2px 0 16px; }
.rail.is-collapsed .rail-brand-copy,
.rail.is-collapsed .rail-label,
.rail.is-collapsed .rail-count,
.rail.is-collapsed .rail-group,
.rail.is-collapsed .rail-user-copy { display: none; }
.rail.is-collapsed .rail-item { justify-content: center; padding: 0; }
.rail.is-collapsed .rail-nav { align-items: stretch; }
.rail.is-collapsed .rail-foot { flex-direction: column; align-items: center; gap: 4px; }
.rail.is-collapsed .rail-user { flex: 0 0 auto; padding: 3px; }
.rail.is-collapsed .rail-tools { flex-direction: column; }

/* ---------- 移动端 off-canvas 抽屉 ---------- */
@media (max-width: 860px) {
  .rail {
    inset: 0 auto 0 0;
    height: 100%;
    border-radius: 0 calc(var(--radius-card) + 6px) calc(var(--radius-card) + 6px) 0;
    transform: translateX(calc(-100% - 24px));
    width: min(300px, 84vw);
    padding-top: 22px;
  }
  .rail.is-mobile-open { transform: none; }
  .rail.is-collapsed { width: min(300px, 84vw); }
  .rail.is-collapsed .rail-brand { justify-content: flex-start; padding: 2px 8px 18px; }
  .rail.is-collapsed .rail-brand-copy { display: flex; }
  .rail.is-collapsed .rail-label, .rail.is-collapsed .rail-group { display: block; }
  .rail.is-collapsed .rail-count { display: inline-grid; }
  .rail.is-collapsed .rail-item { justify-content: flex-start; padding: 0 11px; }
  .rail.is-collapsed .rail-foot { flex-direction: row; align-items: center; }
  .rail.is-collapsed .rail-user { flex: 1; padding: 6px; }
  .rail.is-collapsed .rail-user-copy { display: flex; }
  .rail.is-collapsed .rail-tools { flex-direction: row; }
  .rail-tool.collapse-btn { display: none; }
  .rail-close { display: grid; }
  .rail-backdrop {
    position: fixed; inset: 0; z-index: 39; border: 0; padding: 0;
    background: rgb(15 23 42 / .42);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    animation: fade-in var(--motion-base) var(--ease-out);
  }
}
</style>
