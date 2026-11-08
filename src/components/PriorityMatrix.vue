<script setup>
import { reactive, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { burstFrom } from '../lib/effects.js';

const emit = defineEmits(['edit-task']);
const wb = useWorkbench();

const QUADRANTS = [
  {
    id: 'q1',
    title: '重要且紧急',
    sub: '今日高优 · 立即执行',
    badgeClass: 'q-urgent-imp',
    priority: 'high',
    bucket: 'today'
  },
  {
    id: 'q2',
    title: '重要不紧急',
    sub: '排期高优 · 关键规划',
    badgeClass: 'q-imp',
    priority: 'high',
    bucket: 'tomorrow'
  },
  {
    id: 'q3',
    title: '紧急不重要',
    sub: '今日中优 · 快速处理',
    badgeClass: 'q-urgent',
    priority: 'medium',
    bucket: 'today'
  },
  {
    id: 'q4',
    title: '不重要不紧急',
    sub: '稍后低优 · 弹性跟进',
    badgeClass: 'q-low',
    priority: 'low',
    bucket: 'anytime'
  }
];

const draggingTaskId = ref(null);
const dragOverQuadrant = ref('');
const quickDrafts = reactive({ q1: '', q2: '', q3: '', q4: '' });
const openQuickAdd = ref('');

function onDragStart(task, event) {
  draggingTaskId.value = task.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
  }
}

function onDragEnd() {
  draggingTaskId.value = null;
  dragOverQuadrant.value = '';
}

function onDragOver(qId, event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOverQuadrant.value = qId;
}

function onDragLeave(qId) {
  if (dragOverQuadrant.value === qId) {
    dragOverQuadrant.value = '';
  }
}

function onDrop(qId, event) {
  event.preventDefault();
  const rawId = draggingTaskId.value || event.dataTransfer?.getData('text/plain');
  draggingTaskId.value = null;
  dragOverQuadrant.value = '';
  if (!rawId) return;
  wb.moveTaskToQuadrant(rawId, qId);
}

function submitQuadrantQuick(q) {
  const text = (quickDrafts[q.id] || '').trim();
  if (!text) return;
  const created = wb.addTodo(text, {
    bucket: q.bucket,
    priority: q.priority,
    tag: '个人计划'
  });
  if (created) {
    quickDrafts[q.id] = '';
    openQuickAdd.value = '';
  }
}

function completeTask(task, event) {
  wb.toggleTodo(task.id);
  burstFrom(event.currentTarget);
}

function subtaskSummary(taskId) {
  const subs = wb.getSubtasks(taskId);
  if (!subs.length) return null;
  const done = subs.filter(s => s.done).length;
  return `${done}/${subs.length}`;
}

function recurrenceLabel(taskId) {
  const freq = wb.getTaskRecurrence(taskId);
  if (freq === 'none') return '';
  return wb.RECURRENCE_LABELS[freq] || '';
}
</script>

<template>
  <div class="matrix-wrap">
    <div class="matrix-grid">
      <section
        v-for="q in QUADRANTS"
        :key="q.id"
        class="quadrant-cell"
        :class="[
          q.badgeClass,
          { 'is-drag-over': dragOverQuadrant === q.id }
        ]"
        :aria-label="q.title"
        @dragover="onDragOver(q.id, $event)"
        @dragleave="onDragLeave(q.id)"
        @drop="onDrop(q.id, $event)"
      >
        <header class="q-head">
          <div class="q-title-wrap">
            <span class="q-dot" aria-hidden="true"></span>
            <div>
              <h3>{{ q.title }}</h3>
              <small>{{ q.sub }}</small>
            </div>
          </div>
          <div class="q-head-actions">
            <span class="badge numeric">{{ wb.matrixQuadrants.value[q.id].length }}</span>
            <button
              class="btn-icon btn-xs"
              type="button"
              :title="`在「${q.title}」新建任务`"
              @click="openQuickAdd = openQuickAdd === q.id ? '' : q.id"
            >
              <img :src="asset('assets/icons/plus.svg')" alt="新建" />
            </button>
          </div>
        </header>

        <form
          v-if="openQuickAdd === q.id"
          class="q-quick-form"
          @submit.prevent="submitQuadrantQuick(q)"
        >
          <input
            v-model="quickDrafts[q.id]"
            class="input q-quick-input"
            maxlength="200"
            :placeholder="`添加至「${q.title}」…`"
            required
          />
          <button class="btn btn-primary btn-sm" type="submit">添加</button>
        </form>

        <div v-if="!wb.matrixQuadrants.value[q.id].length" class="q-empty">
          <span>拖拽任务卡片至此象限，或点击右上角 + 添加</span>
        </div>

        <TransitionGroup v-else name="list-anim" tag="ul" class="q-list">
          <li
            v-for="task in wb.matrixQuadrants.value[q.id].slice(0, 6)"
            :key="task.id"
            class="q-card"
            :class="{ 'is-dragging': draggingTaskId === task.id }"
            draggable="true"
            @dragstart="onDragStart(task, $event)"
            @dragend="onDragEnd"
          >
            <button
              class="q-check"
              type="button"
              :aria-label="`完成 ${task.text}`"
              @click="completeTask(task, $event)"
            >
              <img :src="asset('assets/icons/check.svg')" alt="" />
            </button>

            <div class="q-card-body" @click="emit('edit-task', task)">
              <strong class="q-card-title">{{ task.text }}</strong>
              <div class="q-card-meta">
                <span class="q-tag">{{ task.tag || '个人计划' }}</span>
                <span v-if="task.date" class="q-date numeric" :class="{ overdue: task.date < wb.todayStr.value }">
                  {{ task.date === wb.todayStr.value ? (task.time || '今天') : task.date.slice(5) }}
                </span>
                <span v-if="subtaskSummary(task.id)" class="q-sub-badge numeric" title="子步骤进度">
                  ✓ {{ subtaskSummary(task.id) }}
                </span>
                <span v-if="recurrenceLabel(task.id)" class="q-rec-badge" title="周期性任务">
                  ↻ {{ recurrenceLabel(task.id) }}
                </span>
              </div>
            </div>

            <!-- 移动端与键盘快捷换象限按钮组 + 快捷删除 -->
            <div class="q-move-pills" role="group" aria-label="快速移动象限或删除">
              <button
                v-for="target in QUADRANTS.filter(item => item.id !== q.id)"
                :key="target.id"
                type="button"
                class="q-move-btn"
                :title="`移至：${target.title}`"
                @click.stop="wb.moveTaskToQuadrant(task.id, target.id)"
              >
                {{ target.id.toUpperCase() }}
              </button>
              <button
                type="button"
                class="q-move-btn q-del-btn"
                title="删除任务"
                :aria-label="`删除 ${task.text}`"
                @click.stop="wb.deleteTodo(task.id)"
              >
                ×
              </button>
            </div>
          </li>
        </TransitionGroup>
      </section>
    </div>
  </div>
</template>

<style scoped>
.matrix-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  container-type: inline-size;
  container-name: matrix-box;
}
.matrix-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.quadrant-cell {
  display: flex; flex-direction: column; gap: 10px;
  min-height: 184px; padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), box-shadow var(--motion-fast);
}
.quadrant-cell.is-drag-over {
  border-color: var(--brand);
  border-style: dashed;
  background: color-mix(in srgb, var(--brand-pale) 55%, var(--surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent);
}

.q-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.q-title-wrap { display: flex; align-items: center; gap: 9px; min-width: 0; }
.q-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
.q-urgent-imp .q-dot { background: var(--coral); box-shadow: 0 0 0 3px color-mix(in srgb, var(--coral) 18%, transparent); }
.q-imp .q-dot { background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent); }
.q-urgent .q-dot { background: var(--amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 18%, transparent); }
.q-low .q-dot { background: var(--blue); box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 18%, transparent); }

.q-title-wrap h3 { font-size: var(--text-body); font-weight: 750; color: var(--ink); line-height: 1.2; }
.q-title-wrap small { display: block; margin-top: 2px; font-size: 11px; color: var(--muted); }
.q-head-actions { display: flex; align-items: center; gap: 4px; }

.q-quick-form { display: flex; gap: 6px; }
.q-quick-input { flex: 1; min-height: 32px; padding: 4px 10px; font-size: var(--text-sm); }

.q-empty {
  flex: 1; display: grid; place-items: center;
  padding: 16px 12px; border: 1px dashed color-mix(in srgb, var(--line-strong) 45%, var(--line));
  border-radius: 10px; color: var(--muted); font-size: 11.5px; text-align: center;
}

.q-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 7px;
  position: relative;
}
.q-card {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center; gap: 9px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  cursor: grab;
  box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast), opacity var(--motion-fast);
}
.q-card:hover {
  border-color: color-mix(in srgb, var(--brand) 38%, var(--line));
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.q-card:active { cursor: grabbing; }
.q-card.is-dragging { opacity: .45; transform: scale(.98); }

.q-check {
  width: 22px; height: 22px; padding: 0; border-radius: 6px;
  border: 1px solid var(--line-strong); background: var(--surface-soft);
  display: grid; place-items: center;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.q-check img { width: 12px; height: 12px; opacity: 0; transition: opacity var(--motion-fast); }
.q-check:hover { border-color: var(--brand); background: var(--brand-pale); }
.q-check:hover img { opacity: .7; }

.q-card-body { min-width: 0; cursor: pointer; }
.q-card-title {
  display: block; font-size: var(--text-sm); font-weight: 650; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.q-card-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 2px; font-size: 11px; color: var(--muted);
}
.q-tag {
  padding: 0 5px; border-radius: 4px; background: var(--surface-soft);
  border: 1px solid var(--line); font-size: 10.5px;
}
.q-date.overdue { color: var(--coral); font-weight: 650; }
.q-sub-badge, .q-rec-badge {
  padding: 0 5px; border-radius: 4px;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 10.5px; font-weight: 650;
}

.q-move-pills {
  display: flex; align-items: center; gap: 2px;
  opacity: 0; transition: opacity var(--motion-fast);
}
.q-card:hover .q-move-pills, .q-card:focus-within .q-move-pills { opacity: 1; }
@media (hover: none) {
  .q-move-pills { opacity: 1; }
}
.q-move-btn {
  padding: 2px 5px; border-radius: 5px;
  border: 1px solid var(--line); background: var(--surface-soft);
  color: var(--muted); font-family: var(--font-numeric); font-size: 10px; font-weight: 700;
}
.q-move-btn:hover {
  border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep);
}
.q-del-btn:hover {
  border-color: var(--coral); background: var(--coral-pale); color: var(--coral);
}

@container matrix-box (max-width: 600px) {
  .matrix-grid { grid-template-columns: 1fr; }
}
@media (max-width: 780px) {
  .matrix-grid { grid-template-columns: 1fr; }
}
</style>
