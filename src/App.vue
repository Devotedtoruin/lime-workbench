<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useWorkbench } from './composables/useWorkbench.js';
import SideRail from './components/SideRail.vue';
import TopBar from './components/TopBar.vue';
import CommandPalette from './components/CommandPalette.vue';
import TaskDialog from './components/TaskDialog.vue';
import LedgerDialog from './components/LedgerDialog.vue';
import NotificationCenter from './components/NotificationCenter.vue';
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

const commandOpen = ref(false);
const notificationsOpen = ref(false);
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
function onKeydown(event) {
  const isK = event.key === 'k' || event.key === 'K';
  if (!isK || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const target = event.target;
  const typing = target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  // Inside a text field Ctrl+K still opens the palette: it is the documented shortcut and
  // there is no editing command on it, so taking it costs nothing.
  if (typing && !event.ctrlKey) return;
  event.preventDefault();
  commandOpen.value = !commandOpen.value;
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="scene" aria-hidden="true"></div>

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
          class="page-enter"
          @open-command="commandOpen = true"
          @new-task="openTask"
        />
      </main>
    </div>
  </div>

  <CommandPalette v-model:open="commandOpen" @new-task="openTask" />
  <TaskDialog v-model:open="taskDialog.open" :task="taskDialog.task" />
  <LedgerDialog v-model:open="wb.ledgerDialogOpen.value" />
  <NotificationCenter v-model:open="notificationsOpen" />

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
  .shell, .shell.rail-collapsed { padding: 0; padding-bottom: 24px; }
  .content-col { gap: 10px; padding: 8px; }
}
</style>
