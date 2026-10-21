<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open']);
const wb = useWorkbench();

const alerts = computed(() => wb.activeAlerts.value);
const upcoming = computed(() => wb.upcomingReminders.value.slice(0, 6));

function close() { emit('update:open', false); }
function onEscape(event) {
  if (props.open && event.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape));

function fmtDue(ms) {
  const d = new Date(ms);
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function countdown(ms) {
  const sec = Math.max(0, Math.ceil((ms - Date.now()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function act(alert, action) {
  wb.handleAlert(alert, action);
  if (wb.activeAlerts.value.length === 0) close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <section class="modal notif-modal glass rim" role="dialog" aria-modal="true" aria-label="提醒中心">
        <div class="modal-head">
          <h2>提醒中心</h2>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
        </div>

        <section v-if="alerts.length" class="alert-block">
          <p class="block-title"><span class="pulse-dot" aria-hidden="true"></span>{{ alerts.length }} 条待知悉</p>
          <article v-for="alert in alerts" :key="`${alert.sourceKind}:${alert.sourceId}`" class="alert-card">
            <div class="alert-copy">
              <strong>{{ alert.label }}</strong>
              <p>{{ alert.text }}</p>
              <small>到点：{{ fmtDue(alert.dueAt) }}</small>
            </div>
            <div class="alert-actions">
              <button
                v-if="wb.canCompleteFocusTask(alert)"
                class="btn btn-soft btn-sm"
                type="button"
                @click="act(alert, 'complete-task')"
              >完成关联任务</button>
              <button class="btn btn-soft btn-sm" type="button" @click="act(alert, 'snooze')">延后 5 分钟</button>
              <button class="btn btn-primary btn-sm" type="button" @click="act(alert, 'ack')">已知悉</button>
            </div>
          </article>
        </section>

        <section class="upcoming-block">
          <p class="block-title">接下来</p>
          <div v-if="!upcoming.length" class="empty" style="padding: 22px">
            <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/alarm-clock.svg')" alt="" /></span>
            <strong>暂无待触发的提醒</strong>
            <p>可在「日历提醒」页添加会议、截止或休息提醒。</p>
            <button class="btn btn-soft btn-sm" type="button" @click="close(); wb.goto('calendar')">去添加提醒</button>
          </div>
          <ol v-else class="upcoming-list">
            <li v-for="item in upcoming" :key="`${item.sourceKind}:${item.sourceId}`" class="upcoming-item">
              <span class="up-dot" aria-hidden="true"></span>
              <span class="up-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ fmtDue(item.dueAt) }}{{ item.isSnoozed ? ' · 已延后' : '' }}</small>
              </span>
              <time class="up-clock numeric">{{ countdown(item.dueAt) }}</time>
            </li>
          </ol>
        </section>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.notif-modal { width: min(520px, 100%); }
.block-title { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); font-weight: 700; color: var(--muted); letter-spacing: .02em; margin-bottom: 10px; }
.pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--coral); box-shadow: 0 0 0 4px color-mix(in srgb, var(--coral) 16%, transparent); }
.alert-block { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.alert-card { padding: 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--surface-soft); }
.alert-copy strong { font-size: var(--text-body); font-weight: 650; }
.alert-copy p { margin: 4px 0 0; font-size: var(--text-body); color: var(--ink-soft); line-height: 1.6; }
.alert-copy small { display: block; margin-top: 4px; font-size: var(--text-meta); color: var(--muted); }
.alert-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.upcoming-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.upcoming-item { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.upcoming-item:last-child { border-bottom: 0; }
.up-dot { width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px var(--brand-pale); }
.up-copy strong { display: block; font-size: var(--text-body); font-weight: 600; }
.up-copy small { font-size: var(--text-meta); color: var(--muted); }
.up-clock { font-size: var(--text-meta); color: var(--ink-soft); font-weight: 600; white-space: nowrap; }
</style>
