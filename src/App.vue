<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useWorkbench } from './composables/useWorkbench.js';
import SideRail from './components/SideRail.vue';
import TopBar from './components/TopBar.vue';
import CommandPalette from './components/CommandPalette.vue';
import TaskDialog from './components/TaskDialog.vue';
import LedgerDialog from './components/LedgerDialog.vue';
import NotificationCenter from './components/NotificationCenter.vue';
import MobileNav from './components/MobileNav.vue';
import HomeView from './views/HomeView.vue';
import TodoView from './views/TodoView.vue';
import StudyView from './views/StudyView.vue';
import CalendarView from './views/CalendarView.vue';
import LedgerView from './views/LedgerView.vue';
import HabitsView from './views/HabitsView.vue';
import SportView from './views/SportView.vue';
import WeatherView from './views/WeatherView.vue';
import SettingsView from './views/SettingsView.vue';

const wb = useWorkbench();
// View Transitions already animate the page shell. Keep the CSS page-enter only as the
// fallback for browsers without it, otherwise both run and the new snapshot fades twice.
const supportsViewTransition = typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function';

const commandOpen = ref(false);
const notificationsOpen = ref(false);
const shortcutsOpen = ref(false);
const taskDialog = ref({ open: false, task: null });

const views = {
  home: HomeView,
  todo: TodoView,
  study: StudyView,
  calendar: CalendarView,
  ledger: LedgerView,
  habits: HabitsView,
  sport: SportView,
  weather: WeatherView,
  me: SettingsView
};
const currentView = computed(() => views[wb.currentPage.value] || HomeView);

function openTask(task = null) {
  taskDialog.value = { open: true, task };
}

// The top bar has advertised "Ctrl K" since the rebuilt UI but nothing ever listened for it.
// Bound here rather than in the palette so it works from every page, and ignored while a
// dialog or a text field owns the keyboard.
function isTyping(event) {
  const target = event.target;
  return target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function onKeydown(event) {
  const typing = isTyping(event);
  const mod = event.ctrlKey || event.metaKey;
  if (mod && (event.key === 'k' || event.key === 'K') && !event.altKey) {
    event.preventDefault();
    commandOpen.value = !commandOpen.value;
    return;
  }
  if (event.key === 'Escape' && shortcutsOpen.value) {
    shortcutsOpen.value = false;
    return;
  }
  if (typing || mod || event.altKey) return;
  const modalOpen = commandOpen.value || notificationsOpen.value ||
    taskDialog.value.open || shortcutsOpen.value;
  if (modalOpen) return;
  if (event.key === '?') {
    event.preventDefault();
    shortcutsOpen.value = true;
  } else if (event.key === 'n' || event.key === 'N') {
    event.preventDefault();
    openTask();
  } else if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    wb.goto('study');
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="scene" aria-hidden="true"></div>

  <div v-if="wb.storageBlocked.value" class="storage-banner" role="alert">
    <span>本地存储不可写：修改不会保存。请先导出备份，再检查浏览器存储设置。</span>
    <button class="btn btn-soft btn-sm" type="button" @click="wb.exportBackupData()">导出备份</button>
  </div>

  <div class="shell" :class="{ 'rail-collapsed': wb.railCollapsed.value }">
    <SideRail />

    <div class="content-col">
      <TopBar
        @open-command="commandOpen = true"
        @open-notifications="notificationsOpen = true"
      />

      <main class="content" id="mainContent" style="view-transition-name: main-content">
        <component
          :is="currentView"
          :key="wb.currentPage.value"
          :class="{ 'page-enter': !supportsViewTransition }"
          @open-command="commandOpen = true"
          @new-task="openTask"
        />
      </main>
    </div>
  </div>

  <MobileNav />

  <CommandPalette v-model:open="commandOpen" @new-task="openTask" />
  <TaskDialog v-model:open="taskDialog.open" :task="taskDialog.task" />
  <LedgerDialog v-model:open="wb.ledgerDialogOpen.value" />
  <NotificationCenter v-model:open="notificationsOpen" />

  <div v-if="shortcutsOpen" class="overlay" @click.self="shortcutsOpen = false">
    <section class="modal glass rim shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div class="modal-head">
        <h2 id="shortcuts-title">键盘快捷键</h2>
        <button class="btn btn-soft btn-sm" type="button" @click="shortcutsOpen = false">关闭</button>
      </div>
      <dl class="shortcut-list">
        <div><dt><kbd>Ctrl</kbd><kbd>K</kbd></dt><dd>打开快捷命令 / 搜索</dd></div>
        <div><dt><kbd>N</kbd></dt><dd>新建任务</dd></div>
        <div><dt><kbd>F</kbd></dt><dd>打开专注</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>显示这份快捷键</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>关闭当前弹层</dd></div>
      </dl>
    </section>
  </div>

  <div class="toast" :class="{ 'is-show': wb.toastVisible.value }" role="status" aria-live="polite">
    {{ wb.toastMessage.value }}
  </div>
  <div class="undo-bar" :class="{ 'is-show': wb.undoVisible.value }" role="status" aria-live="polite">
    <span>{{ wb.undoMessage.value }}</span>
    <button type="button" @click="wb.triggerUndo()">撤销</button>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  padding: var(--shell-gap);
  padding-top: calc(var(--shell-gap) + env(safe-area-inset-top));
  padding-left: calc(var(--sidebar-w) + var(--shell-gap) * 2);
  transition: padding-left var(--motion-slow) var(--ease-spring);
}
.shell.rail-collapsed { padding-left: calc(var(--sidebar-w-collapsed) + var(--shell-gap) * 2); }

.content-col {
  flex: 1;
  min-width: 0;
  max-width: var(--content-max);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--shell-gap);
}
.content { flex: 1; min-width: 0; }

@media (max-width: 860px) {
  .shell, .shell.rail-collapsed {
    padding: env(safe-area-inset-top) 0 calc(84px + env(safe-area-inset-bottom));
  }
  .content-col { gap: 10px; padding: 10px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left)); }
}

.storage-banner {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;
  margin: 8px 16px; padding: 10px 14px;
  border: 1px solid var(--coral);
  border-radius: var(--radius-control);
  background: var(--coral-pale); color: var(--ink);
  font-size: var(--text-body);
}

.shortcuts { width: min(440px, 100%); padding: 20px 22px 18px; }
.shortcuts .modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.shortcuts h2 { font-size: 17px; font-weight: 750; }
.shortcut-list { display: flex; flex-direction: column; gap: 2px; margin: 0; }
.shortcut-list > div { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.shortcut-list > div:last-child { border-bottom: 0; }
.shortcut-list dt { display: flex; gap: 4px; margin: 0; }
.shortcut-list dd { margin: 0; color: var(--muted); font-size: var(--text-body); }
.shortcut-list kbd {
  display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px;
  border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 6px;
  background: var(--surface-soft); color: var(--ink-soft); font-size: var(--text-2xs); font-weight: 650;
}
</style>
