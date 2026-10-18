<script setup>
import { computed, ref } from 'vue';
import { useWorkbench } from '../composables/useWorkbench.js';

const emit = defineEmits(['new-task']);
const wb = useWorkbench();

const quickText = ref('');
const sortByTime = ref(false);

const tabs = [
  { id: 'today', label: '今天' },
  { id: 'upcoming', label: '稍后' },
  { id: 'anytime', label: '随时' },
  { id: 'all', label: '全部' },
  { id: 'done', label: '已完成' }
];

const counts = computed(() => {
  const c = { today: 0, upcoming: 0, anytime: 0, done: 0 };
  for (const t of wb.state.todos) {
    if (t.done) c.done++;
    const bucket = t.done ? 'done' : !t.date ? 'anytime' : t.date <= wb.todayStr.value ? 'today' : 'upcoming';
    if (bucket in c && bucket !== 'done') c[bucket]++;
  }
  return c;
});

const rows = computed(() => {
  const filter = wb.todoFilter.value;
  const list = wb.state.todos.filter(task => {
    if (filter === 'all') return true;
    if (filter === 'done') return task.done;
    if (task.done) return false;
    if (filter === 'today') return task.date && task.date <= wb.todayStr.value;
    if (filter === 'upcoming') return task.date && task.date > wb.todayStr.value;
    return !task.date;
  });
  return [...list].sort((a, b) => {
    const done = Number(a.done) - Number(b.done);
    if (done) return done;
    const byDate = (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
    if (byDate) return byDate;
    if (sortByTime.value) return (a.time || '23:59').localeCompare(b.time || '23:59');
    return Number(b.id) - Number(a.id);
  });
});

const quickInput = ref(null);

function addQuick() {
  if (!quickText.value.trim()) return;
  if (wb.addTodo(quickText.value, { bucket: wb.todoFilter.value })) {
    quickText.value = '';
    // Same as the home composer: keep focus in the field so a second task can be typed
    // immediately instead of requiring a click back into the input.
    requestAnimationFrame(() => quickInput.value?.focus());
  }
}
function label(task) {
  if (!task.date) return '随时';
  const day = task.date === wb.todayStr.value ? '今天' : task.date.slice(5);
  return task.time ? `${day} ${task.time}` : day;
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>计划</h1>
        <p class="sub">管理会议、周报与文档任务，按日期跟进进度。</p>
      </div>
      <div class="page-head-actions">
        <button class="btn btn-primary" type="button" @click="emit('new-task')">
          <img src="/assets/icons/plus.svg" alt="" />新建任务
        </button>
      </div>
    </header>

    <!-- 自然语言快速添加 -->
    <form class="composer glass rim" @submit.prevent="addQuick">
      <img src="/assets/icons/sparkles.svg" alt="" />
      <input
        ref="quickInput"
        v-model="quickText"
        maxlength="300"
        placeholder="添加任务，例如：明天下午 3 点开项目会议"
        aria-label="新任务"
        autocomplete="off"
      />
      <button class="btn btn-primary btn-sm" type="submit">添加</button>
    </form>
    <p class="composer-hint">输入后按 Enter 添加，日期与时间会自动识别</p>

    <!-- 工具条 -->
    <div class="toolbar">
      <div class="segmented" role="tablist" aria-label="任务筛选">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="wb.todoFilter.value === tab.id"
          :class="{ 'is-active': wb.todoFilter.value === tab.id }"
          @click="wb.todoFilter.value = tab.id"
        >
          {{ tab.label }}
          <span v-if="tab.id !== 'all'" class="tab-count">{{ counts[tab.id] }}</span>
        </button>
      </div>
      <div class="toolbar-actions">
        <button
          class="btn btn-soft btn-sm"
          type="button"
          :aria-pressed="sortByTime"
          @click="sortByTime = !sortByTime"
        >
          <img src="/assets/icons/arrow-down-up.svg" alt="" />
          {{ sortByTime ? '按时间' : '按创建' }}
        </button>
        <button class="btn btn-soft btn-sm" type="button" @click="wb.clearCompletedTodos()">
          <img src="/assets/icons/trash.svg" alt="" />清理已完成
        </button>
      </div>
    </div>

    <!-- 任务表 -->
    <section class="panel glass rim list-panel">
      <div class="list-head">
        <span>任务</span>
        <span>优先级 / 标签</span>
        <span>安排</span>
      </div>

      <div v-if="!rows.length" class="empty" style="margin: 16px">
        <span class="empty-art" aria-hidden="true">🗂️</span>
        <strong>这里还没有任务</strong>
        <p>一句话就能创建任务，例如「明天下午三点交周报」。</p>
        <button v-if="wb.todoFilter.value !== 'done'" class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">新建任务</button>
      </div>

      <ul v-else class="task-list">
        <li v-for="task in rows" :key="task.id" :class="{ done: task.done }">
          <input
            class="checkbox"
            type="checkbox"
            :checked="task.done"
            :aria-label="`完成${task.text}`"
            @change="wb.toggleTodo(task.id)"
          />
          <div class="task-copy">
            <strong>{{ task.text }}</strong>
          </div>
          <div class="task-meta">
            <span class="prio-badge" :class="task.priority">
              <i class="prio" :class="task.priority" aria-hidden="true"></i>
              {{ { high: '高', medium: '中', low: '低' }[task.priority] || '中' }}
            </span>
            <span class="task-tag">{{ task.tag || '个人计划' }}</span>
          </div>
          <span class="task-due" :class="{ overdue: task.date && task.date < wb.todayStr.value }">{{ label(task) }}</span>
          <div class="task-actions">
            <button class="btn-icon" type="button" title="编辑任务" aria-label="编辑任务" @click="emit('new-task', task)">
              <img src="/assets/icons/pencil.svg" alt="" />
            </button>
            <button class="btn-icon" type="button" title="设为专注任务" aria-label="设为专注任务" @click="wb.linkTaskToFocus(task.id, true)">
              <img src="/assets/icons/play.svg" alt="" />
            </button>
            <button class="btn-icon is-danger" type="button" title="删除任务" aria-label="删除任务" @click="wb.deleteTodo(task.id)">
              <img src="/assets/icons/trash.svg" alt="" />
            </button>
          </div>
        </li>
      </ul>

      <!-- A quiet second entry point at the bottom of the list. With three tasks the page used
           to end two thirds of the way up a large screen, leaving the rest as bare background. -->
      <div v-if="rows.length" class="list-foot">
        <p class="foot-note">
          <img src="/assets/icons/lightbulb.svg" alt="" />
          一句话也可以创建任务。试试「明天下午三点交周报」。
        </p>
        <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">
          <img src="/assets/icons/plus.svg" alt="" />新建任务
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Full width, but with the spare space given to a metadata column rather than to the gap
   between the task name and its date. Capping the width made the list float away from the
   left-aligned page heading; splitting the row into checkbox / task / priority / due / actions
   uses the width instead of hiding it. */
.composer {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px 8px 16px; border-radius: var(--radius-card);
  width: 100%;
}
.composer > img { width: 19px; height: 19px; opacity: .6; flex: 0 0 19px; }
.composer input { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; outline: none; font-size: 14px; }
.composer-hint { margin-top: -12px; padding-left: 4px; font-size: 12px; color: var(--muted); }

.toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  margin-top: 6px; width: 100%;
}
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.list-panel { padding: 0; overflow: hidden; width: 100%; }
/* The title column is capped rather than 1fr: a full-width title column was 1280px of mostly
   empty line with the metadata pushed to the far right. minmax(0, 720px) keeps the text
   readable and hands the leftover width to the metadata column. */
.list-head {
  display: grid; grid-template-columns: 24px minmax(0, 720px) minmax(220px, 1fr) 110px 112px;
  gap: 14px; padding: 12px 20px; background: var(--surface-soft); border-bottom: 1px solid var(--line);
  font-size: 12px; font-weight: 600; color: var(--muted);
}
/* Header labels sit over their own columns so the alignment reads as a table. */
.list-head > span:nth-child(1) { grid-column: 2; }
.list-head > span:nth-child(2) { grid-column: 3; }
.list-head > span:nth-child(3) { grid-column: 4; text-align: left; }
.task-list { list-style: none; margin: 0; padding: 0 20px; }
.task-list li {
  display: grid; grid-template-columns: 24px minmax(0, 720px) minmax(220px, 1fr) 110px 112px;
  align-items: center; gap: 14px; min-height: 64px; padding: 11px 0;
  border-bottom: 1px solid var(--line);
}
.task-list li:last-child { border-bottom: 0; }
.task-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.task-copy strong { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; line-height: 1.5; }
.task-list li.done .task-copy strong { text-decoration: line-through; color: var(--muted); }

/* Priority and tag as their own column, so the width is used for information instead of
   being turned into a gap between the title and the date. */
.task-meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--muted); }
.prio-badge {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface-soft);
}
.prio-badge.high { color: var(--coral); border-color: color-mix(in srgb, var(--coral) 26%, var(--line)); }
.prio-badge.medium { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 26%, var(--line)); }
.prio-badge.low { color: var(--brand-deep); border-color: color-mix(in srgb, var(--brand) 26%, var(--line)); }
.task-tag { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prio { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.prio.high { background: var(--coral); }
.prio.medium { background: var(--amber); }
.prio.low { background: var(--brand); }
.task-due { font-size: 12px; color: var(--muted); white-space: nowrap; }
.task-due.overdue { color: var(--coral); font-weight: 600; }
.task-actions { display: flex; align-items: center; gap: 1px; justify-content: flex-end; }
.task-actions .btn-icon { width: 34px; height: 34px; flex-basis: 34px; }
.task-actions .btn-icon img { width: 15px; height: 15px; }

.foot-note { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.foot-note img { width: 16px; height: 16px; opacity: .6; }
.list-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 14px 20px; border-top: 1px solid var(--line); background: var(--surface-soft);
}

@media (max-width: 900px) {
  /* Priority/tag folds under the title on narrower screens; the row keeps three columns. */
  .task-list li { grid-template-columns: 24px minmax(0, 1fr) 110px 112px; }
  .task-meta { grid-column: 2; grid-row: 2; margin-top: 2px; }
  .list-head { display: none; }
}
@media (max-width: 720px) {
  .list-panel { padding: 0; }
  .list-head { display: none; }
  .task-list { padding: 0 14px; }
  .task-list li { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; padding: 13px 0; }
  .task-meta { grid-column: 2; grid-row: 2; }
  .task-due { grid-column: 2; grid-row: 3; }
  .task-actions { grid-column: 3; grid-row: 1 / 4; }
}
</style>
