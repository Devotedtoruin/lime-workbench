<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useWorkbench } from '../composables/useWorkbench.js';
import { todayKey } from '../../js/core.js';

const props = defineProps({
  open: Boolean,
  task: { type: Object, default: null }
});
const emit = defineEmits(['update:open']);
const wb = useWorkbench();

const form = reactive({ text: '', date: '', time: '', priority: 'medium', tag: '个人计划' });
const isEdit = computed(() => Boolean(props.task?.id));
const titleId = 'task-dialog-title';

watch(() => props.open, open => {
  if (!open) return;
  const t = props.task;
  form.text = t?.text || '';
  form.date = t?.date ?? todayKey();
  form.time = t?.time || '';
  form.priority = t?.priority || 'medium';
  form.tag = t?.tag || '个人计划';
});

function close() { emit('update:open', false); }

function submit() {
  const payload = {
    text: form.text.trim(),
    date: form.date || '',
    time: form.date ? form.time : '',
    priority: form.priority,
    tag: form.tag.trim() || '个人计划'
  };
  const ok = isEdit.value ? wb.updateTodo(props.task.id, payload) : Boolean(wb.addTodo(payload.text, payload));
  if (ok) close();
}

function remove() {
  if (!isEdit.value) return;
  if (!window.confirm('删除这个任务？关联提醒会一并移除，可短暂撤销。')) return;
  wb.deleteTodo(props.task.id);
  close();
}

function onOverlay(event) { if (event.target === event.currentTarget) close(); }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click="onOverlay">
      <section class="modal glass rim" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="modal-head">
          <h2 :id="titleId">{{ isEdit ? '编辑任务' : '新建任务' }}</h2>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img src="/assets/icons/x.svg" alt="" />
          </button>
        </div>

        <form @submit.prevent="submit">
          <label class="field">
            <span>任务内容</span>
            <input v-model="form.text" class="input" maxlength="300" required placeholder="例如：整理会议纪要" autofocus />
          </label>

          <div class="form-grid" style="margin-top: 14px">
            <label class="field">
              <span>日期</span>
              <input v-model="form.date" class="input" type="date" />
            </label>
            <label class="field">
              <span>时间</span>
              <input v-model="form.time" class="input" type="time" :disabled="!form.date" />
            </label>
            <label class="field">
              <span>优先级</span>
              <select v-model="form.priority" class="input">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label class="field">
              <span>标签</span>
              <input v-model="form.tag" class="input" maxlength="80" placeholder="个人计划" />
            </label>
          </div>

          <div class="modal-actions">
            <button v-if="isEdit" class="btn btn-ghost btn-danger-text" type="button" @click="remove">
              <img src="/assets/icons/trash.svg" alt="" />删除
            </button>
            <span style="flex: 1"></span>
            <button class="btn btn-soft" type="button" @click="close">取消</button>
            <button class="btn btn-primary" type="submit">
              <img src="/assets/icons/check.svg" alt="" />{{ isEdit ? '保存修改' : '创建任务' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
