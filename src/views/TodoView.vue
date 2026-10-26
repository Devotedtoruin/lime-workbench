<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { breakdownSubtasksWithAI } from '../lib/ai-assist.js';
import PriorityMatrix from '../components/PriorityMatrix.vue';
import VirtualList from '../components/VirtualList.vue';

const emit = defineEmits(['new-task']);
const wb = useWorkbench();

const quickText = ref('');
const sortByTime = ref(false);
const viewMode = ref('list'); // 'list' | 'matrix'
const expandedTaskIds = reactive(new Set());
const inlineSubtaskInputs = reactive({});
const aiBreakingTaskId = ref(null);
const focusedTaskId = ref(null);
const virtualListRef = ref(null);

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

watch(rows, list => {
  if (!list.length) {
    focusedTaskId.value = null;
    return;
  }
  if (focusedTaskId.value && !list.some(t => t.id === focusedTaskId.value)) {
    focusedTaskId.value = list[0]?.id ?? null;
  }
});

const quickInput = ref(null);

function tomorrowKey() {
  const d = new Date(wb.nowDate.value);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addQuick() {
  if (!quickText.value.trim()) return;
  const filter = wb.todoFilter.value;
  const opts = { bucket: filter === 'anytime' ? 'anytime' : 'today' };
  if (filter === 'upcoming') opts.date = tomorrowKey();
  const created = wb.addTodo(quickText.value, opts);
  if (created) {
    quickText.value = '';
    focusedTaskId.value = created.id;
    requestAnimationFrame(() => quickInput.value?.focus());
  }
}

function deferTask(task) {
  if (wb.updateTodo(task.id, { date: tomorrowKey() })) wb.showToast('已推迟到明天');
}
function label(task) {
  if (!task.date) return '随时';
  const day = task.date === wb.todayStr.value ? '今天' : task.date.slice(5);
  return task.time ? `${day} ${task.time}` : day;
}

function toggleExpandSubtasks(taskId) {
  if (expandedTaskIds.has(taskId)) expandedTaskIds.delete(taskId);
  else expandedTaskIds.add(taskId);
}

function submitInlineSubtask(taskId) {
  const val = (inlineSubtaskInputs[taskId] || '').trim();
  if (!val) return;
  if (wb.addSubtask(taskId, val)) {
    inlineSubtaskInputs[taskId] = '';
  }
}

async function runInlineAiBreakdown(task) {
  if (!task?.id || aiBreakingTaskId.value) return;
  aiBreakingTaskId.value = task.id;
  try {
    const res = await breakdownSubtasksWithAI(task.text, task.tag);
    if (!res.ok) {
      wb.showToast(res.error || '未能生成有效步骤');
      return;
    }
    const existing = new Set(wb.getSubtasks(task.id).map(s => s.text.trim()));
    let added = 0;
    for (const step of res.steps) {
      if (existing.has(step)) continue;
      if (wb.addSubtask(task.id, step)) {
        existing.add(step);
        added++;
      }
    }
    expandedTaskIds.add(task.id);
    wb.showToast(
      res.mode === 'llm'
        ? `已拆解并添加 ${added} 项子步骤`
        : `已按本地模板生成 ${added} 项子步骤`
    );
  } finally {
    aiBreakingTaskId.value = null;
  }
}

/* ---------------- 任务列表上下键焦点巡航 ---------------- */
function isEditableTarget(el) {
  return el instanceof HTMLElement &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function onTaskListKeydown(event) {
  if (viewMode.value !== 'list' || !rows.value.length) return;
  if (document.querySelector('[role="dialog"]')) return;
  if (isEditableTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const list = rows.value;
  const currentIdx = list.findIndex(t => t.id === focusedTaskId.value);

  if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
    event.preventDefault();
    const nextIdx = currentIdx < 0 ? 0 : Math.min(list.length - 1, currentIdx + 1);
    focusedTaskId.value = list[nextIdx].id;
    virtualListRef.value?.scrollToIndex(nextIdx);
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
    event.preventDefault();
    const prevIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
    focusedTaskId.value = list[prevIdx].id;
    virtualListRef.value?.scrollToIndex(prevIdx);
    return;
  }

  if (currentIdx < 0) return;
  const activeTask = list[currentIdx];

  if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    wb.toggleTodo(activeTask.id);
  } else if (event.key === 'e' || event.key === 'E') {
    event.preventDefault();
    emit('new-task', activeTask);
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    const nextCandidate = list[currentIdx + 1]?.id ?? list[currentIdx - 1]?.id ?? null;
    if (wb.deleteTodo(activeTask.id)) {
      focusedTaskId.value = nextCandidate;
    }
  }
}

onMounted(() => {
  const prefill = wb.consumePrefill('todo');
  if (prefill?.text) quickText.value = prefill.text;
  window.addEventListener('keydown', onTaskListKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onTaskListKeydown);
});
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>任务与排期</h1>
        <p class="sub">集中管理日程待办、子任务步骤（Checklist）与周期重复事项，支持列表与四象限矩阵双视图。</p>
      </div>
      <div class="page-head-actions">
        <div class="segmented" aria-label="视图模式">
          <button type="button" :class="{ 'is-active': viewMode === 'list' }" @click="viewMode = 'list'">列表视图</button>
          <button type="button" :class="{ 'is-active': viewMode === 'matrix' }" @click="viewMode = 'matrix'">四象限矩阵</button>
        </div>
        <button class="btn btn-primary" type="button" @click="emit('new-task')">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新建任务
        </button>
      </div>
    </header>

    <!-- 自然语言快速添加 -->
    <form class="composer glass rim" @submit.prevent="addQuick">
      <img :src="asset('assets/icons/command.svg')" alt="" />
      <input
        ref="quickInput"
        v-model="quickText"
        maxlength="300"
        placeholder="快速录入待办事项，支持自动解析日期与时间（如：明天 15:00 项目周会）"
        aria-label="快速录入新任务"
        autocomplete="off"
      />
      <button class="btn btn-primary btn-sm" type="submit">录入</button>
    </form>

    <!-- 四象限矩阵模式 -->
    <section v-if="viewMode === 'matrix'" class="panel glass rim">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">四象限优先级矩阵</h2>
          <p class="panel-sub">拖拽任务卡片在四个象限之间移动，自动同步任务优先级与排期</p>
        </div>
      </div>
      <PriorityMatrix @edit-task="task => emit('new-task', task)" />
    </section>

    <template v-else>
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
          <span class="kbd-hint-pill" title="列表快捷键：↑/↓ 切换焦点，空格完成，E 编辑，Del 删除">
            <kbd>↑</kbd><kbd>↓</kbd> 焦点巡航 · <kbd>Space</kbd> 完成 · <kbd>E</kbd> 编辑
          </span>
          <button
            class="btn btn-soft btn-sm"
            type="button"
            :aria-pressed="sortByTime"
            @click="sortByTime = !sortByTime"
          >
            <img :src="asset('assets/icons/arrow-down-up.svg')" alt="" />
            {{ sortByTime ? '按计划时间' : '按创建时间' }}
          </button>
          <button class="btn btn-soft btn-sm" type="button" @click="wb.clearCompletedTodos()">
            <img :src="asset('assets/icons/trash.svg')" alt="" />清理已完成
          </button>
        </div>
      </div>

      <!-- 任务表（内置长列表虚拟滚动支持） -->
      <section class="panel glass rim list-panel">
        <div class="list-head">
          <span>任务事项</span>
          <span>优先级 / 分类 / 周期</span>
          <span>计划时间</span>
        </div>

        <div v-if="!rows.length" class="empty list-empty">
          <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/list-checks.svg')" alt="" /></span>
          <strong>当前筛选下暂无任务记录</strong>
          <p>可通过上方快速输入框录入事项，或点击下方按钮配置完整排期与子步骤。</p>
          <button v-if="wb.todoFilter.value !== 'done'" class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">新建任务</button>
        </div>

        <VirtualList
          v-else
          ref="virtualListRef"
          :items="rows"
          :item-height="66"
          :threshold="80"
          :max-height="600"
          tag="ul"
          list-class="task-list"
        >
          <template #default="{ item: task, index }">
            <li
              :data-vlist-index="index"
              :class="{ done: task.done, 'is-focused': focusedTaskId === task.id }"
              @click="focusedTaskId = task.id"
            >
              <div class="task-main-row">
                <input
                  class="checkbox"
                  type="checkbox"
                  :checked="task.done"
                  :aria-label="`完成${task.text}`"
                  @change="wb.toggleTodo(task.id)"
                />
                <div class="task-copy">
                  <strong>{{ task.text }}</strong>
                  <div class="task-sub-badges">
                    <button
                      type="button"
                      class="subtask-toggle-btn numeric"
                      @click.stop="toggleExpandSubtasks(task.id)"
                    >
                      <template v-if="wb.getSubtasks(task.id).length">
                        ✓ 子步骤 {{ wb.getSubtasks(task.id).filter(s => s.done).length }}/{{ wb.getSubtasks(task.id).length }}
                      </template>
                      <template v-else>
                        + 添加子步骤
                      </template>
                    </button>
                    <button
                      type="button"
                      class="subtask-ai-btn"
                      :disabled="aiBreakingTaskId === task.id"
                      title="将该任务自动拆解为可执行子步骤"
                      @click.stop="runInlineAiBreakdown(task)"
                    >
                      <img :src="asset('assets/icons/sparkles.svg')" alt="" />
                      {{ aiBreakingTaskId === task.id ? '拆解中…' : '智能拆解' }}
                    </button>
                    <span v-if="wb.getTaskRecurrence(task.id) !== 'none'" class="rec-pill">
                      ↻ {{ wb.RECURRENCE_LABELS[wb.getTaskRecurrence(task.id)] }}
                    </span>
                  </div>
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
                  <button class="btn-icon" type="button" title="编辑任务与子步骤 (E)" aria-label="编辑任务" @click.stop="emit('new-task', task)">
                    <img :src="asset('assets/icons/pencil.svg')" alt="" />
                  </button>
                  <button class="btn-icon" type="button" title="绑定为当前专注任务" aria-label="绑定为当前专注任务" @click.stop="wb.linkTaskToFocus(task.id, true)">
                    <img :src="asset('assets/icons/play.svg')" alt="" />
                  </button>
                  <button v-if="!task.done" class="btn-icon" type="button" title="顺延至明天" aria-label="顺延至明天" @click.stop="deferTask(task)">
                    <img :src="asset('assets/icons/calendar-plus.svg')" alt="" />
                  </button>
                  <button class="btn-icon is-danger" type="button" title="删除任务 (Del)" aria-label="删除任务" @click.stop="wb.deleteTodo(task.id)">
                    <img :src="asset('assets/icons/trash.svg')" alt="" />
                  </button>
                </div>
              </div>

              <!-- 展开的内联子步骤 Checklist -->
              <div v-if="expandedTaskIds.has(task.id)" class="inline-subtasks" @click.stop>
                <TransitionGroup v-if="wb.getSubtasks(task.id).length" name="list-anim" tag="ul" class="inline-subtask-list">
                  <li v-for="sub in wb.getSubtasks(task.id)" :key="sub.id" :class="{ done: sub.done }">
                    <input
                      type="checkbox"
                      class="checkbox"
                      :checked="sub.done"
                      @change="wb.toggleSubtask(task.id, sub.id)"
                    />
                    <span>{{ sub.text }}</span>
                    <button class="btn-icon btn-xs is-danger" type="button" @click="wb.removeSubtask(task.id, sub.id)">
                      <img :src="asset('assets/icons/x.svg')" alt="删除步骤" />
                    </button>
                  </li>
                </TransitionGroup>
                <form class="inline-subtask-form" @submit.prevent="submitInlineSubtask(task.id)">
                  <input
                    v-model="inlineSubtaskInputs[task.id]"
                    class="input inline-subtask-input"
                    maxlength="120"
                    placeholder="添加子步骤并按 Enter…"
                  />
                  <button class="btn btn-soft btn-sm" type="submit">添加</button>
                </form>
              </div>
            </li>
          </template>
        </VirtualList>

        <div v-if="rows.length" class="list-foot">
          <p class="foot-note">
            <img :src="asset('assets/icons/lightbulb.svg')" alt="" />
            提示：使用方向键 ↑/↓ 可快速巡航任务列表；完成周期重复任务后会自动生成下一周期排期。
          </p>
          <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">
            <img :src="asset('assets/icons/plus.svg')" alt="" />新建任务
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.composer {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px 8px 16px; border-radius: var(--radius-card);
  width: 100%;
}
.composer > img { width: 19px; height: 19px; opacity: .6; flex: 0 0 19px; }
.composer:focus-within { box-shadow: var(--ring); }
.composer input { flex: 1; min-width: 0; height: 40px; border: 0; background: transparent; outline: none; font-size: var(--text-body); }

.toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  margin-top: 2px; width: 100%;
}
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kbd-hint-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 99px;
  border: 1px solid var(--line); background: var(--surface-soft);
  font-size: var(--text-2xs); color: var(--muted);
}
.kbd-hint-pill kbd {
  padding: 1px 5px; border-radius: 4px;
  border: 1px solid var(--line-strong); background: var(--surface);
  font-size: 10px; font-weight: 650; color: var(--ink-soft);
}

.list-panel { padding: 0; overflow: hidden; width: 100%; }
.list-empty { max-width: none; margin: 0; padding: 46px 24px; border-top: 1px solid var(--line); }
.list-head {
  display: grid; grid-template-columns: 24px minmax(200px, 2.2fr) minmax(140px, 1fr) 96px 132px;
  gap: 14px; padding: 12px 20px; background: var(--surface-soft); border-bottom: 1px solid var(--line);
  font-size: var(--text-meta); font-weight: 600; color: var(--muted);
}
.list-head > span:nth-child(1) { grid-column: 2; }
.list-head > span:nth-child(2) { grid-column: 3; }
.list-head > span:nth-child(3) { grid-column: 4; text-align: left; }
:deep(.task-list) { list-style: none; margin: 0; padding: 0 20px; position: relative; }
:deep(.task-list > li) {
  border-bottom: 1px solid var(--line);
  padding: 11px 8px;
  margin: 0 -8px;
  border-radius: 10px;
  transition: background-color var(--motion-fast), box-shadow var(--motion-fast);
}
:deep(.task-list > li:last-child) { border-bottom: 0; }
:deep(.task-list > li.is-focused) {
  background: color-mix(in srgb, var(--brand-pale) 46%, transparent);
  box-shadow: inset 3px 0 0 var(--brand);
}
.task-main-row {
  display: grid; grid-template-columns: 24px minmax(200px, 2.2fr) minmax(140px, 1fr) 96px 132px;
  align-items: center; gap: 14px; min-height: 44px;
}
.task-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.task-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; line-height: 1.45; }
:deep(.task-list > li.done) .task-copy strong { text-decoration: line-through; color: var(--muted); }
.task-sub-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.subtask-toggle-btn {
  padding: 1px 7px; border-radius: 5px;
  border: 1px solid var(--line); background: var(--surface-soft);
  color: var(--ink-soft); font-size: 11px; font-weight: 600;
}
.subtask-toggle-btn:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); }
.subtask-ai-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 7px; border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--line));
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 11px; font-weight: 650;
}
.subtask-ai-btn img { width: 11px; height: 11px; }
.subtask-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.rec-pill {
  padding: 1px 7px; border-radius: 5px;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 11px; font-weight: 650;
}

.inline-subtasks {
  margin: 8px 0 4px 38px; padding: 10px 12px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--surface-soft);
  max-width: 640px; display: flex; flex-direction: column; gap: 8px;
}
.inline-subtask-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; position: relative; }
.inline-subtask-list li {
  display: flex; align-items: center; gap: 8px; font-size: var(--text-sm);
}
.inline-subtask-list li.done span { text-decoration: line-through; color: var(--muted); }
.inline-subtask-list li span { flex: 1; min-width: 0; }
.inline-subtask-form { display: flex; gap: 6px; }
.inline-subtask-input { flex: 1; min-height: 32px; padding: 4px 9px; font-size: var(--text-sm); }

.task-meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--text-meta); color: var(--muted); }
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
.task-due { font-size: var(--text-meta); color: var(--muted); white-space: nowrap; }
.task-due.overdue { color: var(--coral); font-weight: 600; }
.task-actions { display: flex; align-items: center; gap: 1px; justify-content: flex-end; }
.task-actions .btn-icon { width: 32px; height: 32px; flex-basis: 32px; }
.task-actions .btn-icon img { width: 15px; height: 15px; }

.foot-note { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--muted); }
.foot-note img { width: 16px; height: 16px; opacity: .6; }
.list-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 14px 20px; border-top: 1px solid var(--line); background: var(--surface-soft);
}

@container workbench (max-width: 860px) {
  .task-main-row { grid-template-columns: 24px minmax(0, 1fr) 96px 132px; }
  .task-meta { grid-column: 2; grid-row: 2; margin-top: 2px; }
  .list-head { display: none; }
}
@container workbench (max-width: 680px) {
  .list-panel { padding: 0; }
  .list-head { display: none; }
  :deep(.task-list) { padding: 0 14px; }
  .task-main-row { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; }
  .task-meta { grid-column: 2; grid-row: 2; }
  .task-due { grid-column: 2; grid-row: 3; }
  .task-actions { grid-column: 3; grid-row: 1 / 4; }
  .inline-subtasks { margin-left: 0; }
  .kbd-hint-pill { display: none; }
}
@media (max-width: 900px) {
  .task-main-row { grid-template-columns: 24px minmax(0, 1fr) 96px 132px; }
  .task-meta { grid-column: 2; grid-row: 2; margin-top: 2px; }
  .list-head { display: none; }
}
@media (max-width: 720px) {
  .list-panel { padding: 0; }
  .list-head { display: none; }
  :deep(.task-list) { padding: 0 14px; }
  .task-main-row { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; }
  .task-meta { grid-column: 2; grid-row: 2; }
  .task-due { grid-column: 2; grid-row: 3; }
  .task-actions { grid-column: 3; grid-row: 1 / 4; }
  .inline-subtasks { margin-left: 0; }
  .kbd-hint-pill { display: none; }
}
@media (max-width: 640px) {
  .segmented button { padding: 0 9px; }
  .segmented .tab-count { display: none; }
}
</style>
