<script setup>
import { computed, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';

const wb = useWorkbench();
const blockers = ref('');
const copied = ref(false);
const range = ref('today');

const dayKey = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = dayKey(new Date());
const weekStart = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
})();
const since = computed(() => range.value === 'week' ? weekStart : new Date(`${today}T00:00:00`));
const done = computed(() => wb.state.todos
  .filter(t => t.done && t.completedAt && new Date(t.completedAt) >= since.value)
  .slice(0, 8));
const doing = computed(() => wb.openTodayTasks.value.slice(0, 6));
const notes = computed(() => wb.state.notes.slice(0, 3));
const focus = computed(() => {
  if (range.value === 'today') return wb.studyTodayMinutes.value;
  let seconds = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    seconds += wb.state.study[dayKey(d)] || 0;
  }
  return Math.floor(seconds / 60);
});

const summary = computed(() => {
  const lines = [];
  lines.push(range.value === 'week' ? `【本周进展】` : `【今日进展】`);
  lines.push(done.value.length ? done.value.map(t => `- ${t.text}`).join('\n') : '- 今天还没有勾选完成项');
  lines.push('');
  lines.push(`【进行中】`);
  lines.push(doing.value.length ? doing.value.map(t => `- ${t.text}`).join('\n') : '- 暂无进行中任务');
  lines.push('');
  lines.push(`【数据】${range.value === 'week' ? '本周' : '今日'}专注 ${focus.value} 分钟 · 完成 ${done.value.length} 项 · 当前待办 ${doing.value.length} 项`);
  if (notes.value.length) {
    lines.push('');
    lines.push(`【便签】`);
    lines.push(notes.value.map(n => `- ${n.title}`).join('\n'));
  }
  lines.push('');
  lines.push(`【风险 / 需要协助】`);
  lines.push(blockers.value.trim() || '暂无');
  return lines.join('\n');
});

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summary.value);
  } catch {
    const area = document.createElement('textarea');
    area.value = summary.value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  copied.value = true;
  wb.showToast(`${range.value === 'week' ? '周报' : '站会摘要'}已复制`);
  setTimeout(() => { copied.value = false; }, 1800);
}
</script>

<template>
  <div class="page-shell standup-page">
    <header class="page-head standup-head">
      <div>
        <p class="eyebrow">DAILY STANDUP · {{ wb.formattedDate.value }}</p>
        <h1>把今天讲清楚。</h1>
        <p class="sub">从任务、专注与便签里自动汇总今日进展。改一下阻塞项，复制到站会或日报。</p>
      </div>
      <div class="standup-head-actions">
        <div class="segmented" aria-label="汇总范围">
          <button type="button" :class="{ 'is-active': range === 'today' }" @click="range = 'today'">今日</button>
          <button type="button" :class="{ 'is-active': range === 'week' }" @click="range = 'week'">本周</button>
        </div>
        <button class="btn btn-primary" type="button" @click="copySummary">
          <img :src="asset('assets/icons/copy.svg')" alt="" />
          {{ copied ? '已复制' : '复制摘要' }}
        </button>
      </div>
    </header>

    <section class="standup-stats">
      <div><span>已完成</span><strong class="numeric">{{ done.length }}</strong></div>
      <div><span>进行中</span><strong class="numeric">{{ doing.length }}</strong></div>
      <div><span>专注</span><strong class="numeric">{{ focus }}<em>min</em></strong></div>
      <div><span>便签</span><strong class="numeric">{{ wb.state.notes.length }}</strong></div>
    </section>

    <div class="standup-grid">
      <section class="panel glass rim standup-flow">
        <div class="panel-head">
          <h2 class="panel-title">今日时间线</h2>
          <span class="panel-sub">完成任务 / 进行中 / 便签</span>
        </div>

        <div class="flow-group">
          <p class="flow-label"><i class="flow-dot done"></i>已完成</p>
          <ul v-if="done.length" class="flow-list">
            <li v-for="t in done" :key="t.id">
              <span class="flow-check"><img :src="asset('assets/icons/check.svg')" alt="" /></span>
              <span>{{ t.text }}</span>
            </li>
          </ul>
          <p v-else class="flow-empty">还没有完成项。先去勾掉第一件。</p>
        </div>

        <div class="flow-group">
          <p class="flow-label"><i class="flow-dot doing"></i>进行中</p>
          <ul v-if="doing.length" class="flow-list">
            <li v-for="t in doing" :key="t.id">
              <span class="flow-index numeric">{{ String(doing.indexOf(t) + 1).padStart(2, '0') }}</span>
              <span>{{ t.text }}</span>
            </li>
          </ul>
          <p v-else class="flow-empty">今天没有未完成任务。</p>
        </div>

        <div class="flow-group">
          <p class="flow-label"><i class="flow-dot note"></i>工作便签</p>
          <ul v-if="notes.length" class="flow-list">
            <li v-for="n in notes" :key="n.id">
              <span class="flow-index"><img :src="asset('assets/icons/sticky-note.svg')" alt="" /></span>
              <span>{{ n.title }}</span>
            </li>
          </ul>
          <p v-else class="flow-empty">会议要点和临时想法可以记在便签里。</p>
        </div>

        <div class="standup-actions">
          <button class="btn btn-soft btn-sm" type="button" @click="wb.goto('todo')">去处理任务</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="wb.goto('study')">查看专注</button>
        </div>
      </section>

      <section class="panel glass rim standup-draft">
        <div class="panel-head">
          <h2 class="panel-title">{{ range === 'week' ? '周报稿' : '站会稿' }}</h2>
          <span class="badge">{{ range === 'week' ? '本周汇总' : '今日自动生成' }}</span>
        </div>
        <label class="field">
          <span>风险 / 需要协助</span>
          <textarea v-model="blockers" class="input standup-input" rows="2" maxlength="200" placeholder="例如：等待设计稿，接口联调被阻塞"></textarea>
        </label>
        <pre class="standup-preview">{{ summary }}</pre>
        <button class="btn btn-primary standup-copy" type="button" @click="copySummary">
          <img :src="asset('assets/icons/copy.svg')" alt="" />
          {{ copied ? '已复制到剪贴板' : '复制这段摘要' }}
        </button>
        <p class="tiny">摘要只在本机生成，复制前不会发送到任何服务。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.standup-head { align-items: flex-end; }
.standup-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.eyebrow { margin: 0 0 8px; font-size: 11px; font-weight: 650; letter-spacing: .14em; color: var(--muted); }
.standup-head h1 { margin: 0; font-family: var(--font-display); font-size: clamp(34px, 4vw, 54px); font-weight: 600; letter-spacing: -.04em; }
.standup-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.standup-stats > div { padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius-card); background: color-mix(in srgb, var(--surface) 62%, transparent); backdrop-filter: blur(12px); }
.standup-stats span { font-size: 11.5px; color: var(--muted); }
.standup-stats strong { display: block; margin-top: 4px; font-size: 30px; font-weight: 750; letter-spacing: -.04em; }
.standup-stats em { margin-left: 2px; font-size: 11px; font-style: normal; color: var(--muted); }
.standup-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 16px; align-items: start; }
.standup-flow, .standup-draft { padding: 24px; }
.flow-group { padding: 18px 0; border-top: 1px solid var(--line); }
.flow-label { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 12px; font-weight: 650; color: var(--muted); }
.flow-dot { width: 6px; height: 6px; border-radius: 50%; }
.flow-dot.done { background: var(--brand); }
.flow-dot.doing { background: var(--amber); }
.flow-dot.note { background: var(--blue); }
.flow-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.flow-list li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.flow-check, .flow-index { width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center; border-radius: 7px; background: var(--surface-soft); color: var(--muted); font-size: 10px; }
.flow-check img, .flow-index img { width: 12px; height: 12px; opacity: .7; }
.flow-empty { margin: 0; font-size: 12.5px; color: var(--muted); }
.standup-actions { display: flex; gap: 8px; padding-top: 18px; border-top: 1px solid var(--line); }
.standup-draft { position: sticky; top: 84px; }
.standup-input { width: 100%; resize: vertical; min-height: 66px; }
.standup-preview {
  margin: 14px 0; padding: 16px; max-height: 40vh; overflow: auto;
  white-space: pre-wrap; font-family: var(--font-sans); font-size: 12.5px; line-height: 1.75;
  color: var(--ink-soft); background: color-mix(in srgb, var(--surface-soft) 76%, transparent);
  border: 1px solid var(--line); border-radius: 14px;
}
.standup-copy { width: 100%; }
.standup-draft .tiny { margin: 10px 0 0; }
@media (max-width: 980px) {
  .standup-grid { grid-template-columns: 1fr; }
  .standup-draft { position: static; }
}
@media (max-width: 640px) {
  .standup-head h1 { font-size: 36px; }
  .standup-stats { grid-template-columns: repeat(2, 1fr); }
  .standup-flow, .standup-draft { padding: 18px; }
}
</style>
