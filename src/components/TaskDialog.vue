<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { breakdownSubtasksWithAI } from '../lib/ai-assist.js';

const props = defineProps({
  open: Boolean,
  task: { type: Object, default: null }
});
const emit = defineEmits(['update:open']);
const wb = useWorkbench();

const form = reactive({
  text: '',
  date: '',
  time: '',
  priority: 'medium',
  tag: '个人计划',
  recurrence: 'none',
  subtasks: []
});
const newSubtaskText = ref('');
const aiBreakingDown = ref(false);
const isEdit = computed(() => Boolean(props.task?.id));
const titleId = 'task-dialog-title';

watch(() => props.open, open => {
  if (!open) return;
  const t = props.task;
  form.text = t?.text || '';
  form.date = t?.date ?? wb.todayStr.value;
  form.time = t?.time || '';
  form.priority = t?.priority || 'medium';
  form.tag = t?.tag || '个人计划';
  form.recurrence = t?.id ? wb.getTaskRecurrence(t.id) : 'none';
  form.subtasks = t?.id ? wb.getSubtasks(t.id).map(s => ({ ...s })) : [];
  newSubtaskText.value = '';
  aiBreakingDown.value = false;
});

function close() { emit('update:open', false); }

function onEscape(event) {
  if (props.open && event.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape));

function addDraftSubtask() {
  const clean = newSubtaskText.value.trim();
  if (!clean) return;
  if (form.subtasks.length >= 20) {
    wb.showToast('单个任务最多添加 20 项子步骤');
    return;
  }
  form.subtasks.push({
    id: `sub-${Date.now()}-${form.subtasks.length}`,
    text: clean.slice(0, 120),
    done: false
  });
  newSubtaskText.value = '';
}

function removeDraftSubtask(idx) {
  form.subtasks.splice(idx, 1);
}

async function requestAiBreakdown() {
  const cleanTitle = form.text.trim();
  if (!cleanTitle) {
    wb.showToast('请先输入任务内容后再使用 AI 拆解');
    return;
  }
  if (aiBreakingDown.value) return;
  aiBreakingDown.value = true;
  try {
    const res = await breakdownSubtasksWithAI(cleanTitle, form.tag);
    if (!res.ok) {
      wb.showToast(res.error || 'AI 拆解未返回有效步骤');
      return;
    }
    let added = 0;
    const existing = new Set(form.subtasks.map(s => s.text.trim()));
    for (const step of res.steps) {
      if (form.subtasks.length >= 20) break;
      if (existing.has(step)) continue;
      form.subtasks.push({
        id: `sub-${Date.now()}-${form.subtasks.length}-${added}`,
        text: step.slice(0, 120),
        done: false
      });
      existing.add(step);
      added++;
    }
    wb.showToast(
      res.mode === 'llm'
        ? `AI 已拆解并填入 ${added} 项执行步骤`
        : `已根据任务语义智能生成 ${added} 项执行步骤`
    );
  } finally {
    aiBreakingDown.value = false;
  }
}

function submit() {
  // 如果子步骤输入框还有未回车文本，自动并入
  if (newSubtaskText.value.trim() && form.subtasks.length < 20) {
    addDraftSubtask();
  }
  const payload = {
    text: form.text.trim(),
    date: form.date || '',
    time: form.date ? form.time : '',
    priority: form.priority,
    tag: form.tag.trim() || '个人计划',
    recurrence: form.recurrence,
    subtasks: form.subtasks
  };
  const ok = isEdit.value
    ? wb.updateTodo(props.task.id, payload)
    : Boolean(wb.addTodo(payload.text, payload));
  if (ok) close();
}

function remove() {
  if (!isEdit.value) return;
  const id = props.task.id;
  close();
  wb.askConfirm({
    title: '删除任务',
    message: '删除这个任务？关联提醒与子步骤会一并移除，删除后可短暂撤销。',
    confirmText: '删除任务',
    danger: true,
    onConfirm: () => wb.deleteTodo(id)
  });
}

function onOverlay(event) { if (event.target === event.currentTarget) close(); }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click="onOverlay">
      <section class="modal glass rim" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="modal-head">
          <h2 :id="titleId">{{ isEdit ? '编辑任务与子步骤' : '新建任务' }}</h2>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
        </div>

        <form @submit.prevent="submit">
          <label class="field">
            <span>任务内容</span>
            <input v-model="form.text" class="input" maxlength="300" required placeholder="例如：整理季度产品评审材料" autofocus />
          </label>

          <div class="form-grid" style="margin-top: 14px">
            <label class="field">
              <span>计划日期</span>
              <input v-model="form.date" class="input" type="date" />
            </label>
            <label class="field">
              <span>提醒时间</span>
              <input v-model="form.time" class="input" type="time" :disabled="!form.date" />
            </label>
            <label class="field">
              <span>优先级</span>
              <select v-model="form.priority" class="input">
                <option value="high">高优先级（重要）</option>
                <option value="medium">中优先级</option>
                <option value="low">低优先级</option>
              </select>
            </label>
            <label class="field">
              <span>周期重复规则</span>
              <select v-model="form.recurrence" class="input">
                <option value="none">不重复（单次）</option>
                <option value="daily">每天重复</option>
                <option value="weekday">每个工作日（周一至周五）</option>
                <option value="weekly">每周重复</option>
                <option value="monthly">每月重复</option>
              </select>
            </label>
            <label class="field" style="grid-column: 1 / -1">
              <span>分类标签</span>
              <input v-model="form.tag" class="input" maxlength="80" placeholder="个人计划 / 研发协同 / 财务报销" />
            </label>
          </div>

          <!-- 子任务 (Checklist) 拆解区 -->
          <div class="subtask-section">
            <div class="subtask-head">
              <span>子任务拆解（Checklist）</span>
              <div class="subtask-head-right">
                <button
                  class="btn btn-soft btn-xs ai-subtask-btn"
                  type="button"
                  :disabled="aiBreakingDown || !form.text.trim()"
                  @click="requestAiBreakdown"
                >
                  <img :src="asset('assets/icons/sparkles.svg')" alt="" />
                  {{ aiBreakingDown ? '拆解中…' : 'AI 拆解步骤' }}
                </button>
                <small class="numeric">{{ form.subtasks.filter(s => s.done).length }}/{{ form.subtasks.length }}</small>
              </div>
            </div>
            <div class="subtask-add-row">
              <input
                v-model="newSubtaskText"
                class="input subtask-input"
                maxlength="120"
                placeholder="输入具体执行步骤后按添加…"
                @keydown.enter.prevent="addDraftSubtask"
              />
              <button class="btn btn-soft btn-sm" type="button" @click="addDraftSubtask">添加步骤</button>
            </div>
            <TransitionGroup v-if="form.subtasks.length" name="list-anim" tag="ul" class="subtask-list">
              <li v-for="(sub, idx) in form.subtasks" :key="sub.id" :class="{ done: sub.done }">
                <input v-model="sub.done" type="checkbox" class="checkbox" />
                <input v-model="sub.text" class="subtask-edit-input" maxlength="120" />
                <button class="btn-icon btn-xs is-danger" type="button" title="移除步骤" @click="removeDraftSubtask(idx)">
                  <img :src="asset('assets/icons/x.svg')" alt="移除" />
                </button>
              </li>
            </TransitionGroup>
          </div>

          <div class="modal-actions">
            <button v-if="isEdit" class="btn btn-ghost btn-danger-text" type="button" @click="remove">
              <img :src="asset('assets/icons/trash.svg')" alt="" />删除
            </button>
            <span style="flex: 1"></span>
            <button class="btn btn-soft" type="button" @click="close">取消</button>
            <button class="btn btn-primary" type="submit">
              <img :src="asset('assets/icons/check.svg')" alt="" />{{ isEdit ? '保存修改' : '创建任务' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.subtask-section {
  margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 8px;
}
.subtask-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: var(--text-sm); font-weight: 650; color: var(--ink-soft);
}
.subtask-head-right {
  display: flex; align-items: center; gap: 8px;
}
.subtask-head small { color: var(--muted); }
.ai-subtask-btn {
  display: inline-flex; align-items: center; gap: 4px;
  min-height: 26px; padding: 0 9px; border-radius: 6px;
  border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 11.5px; font-weight: 650;
}
.ai-subtask-btn img { width: 12px; height: 12px; }
.ai-subtask-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.subtask-add-row { display: flex; gap: 8px; }
.subtask-input { flex: 1; min-height: 36px; }
.subtask-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px;
  max-height: 170px; overflow-y: auto; position: relative;
}
.subtask-list li {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface-soft);
}
.subtask-edit-input {
  flex: 1; min-width: 0; border: 0; background: transparent;
  outline: none; font-size: var(--text-sm); color: var(--ink);
}
.subtask-list li.done .subtask-edit-input {
  text-decoration: line-through; color: var(--muted);
}
</style>
