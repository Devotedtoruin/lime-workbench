<script setup>
import { computed, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { rangeSummary, heatmapWeeks, focusStreak } from '../../js/focus-stats.js';

const wb = useWorkbench();

const customMinutes = ref(wb.state.settings.focusMinutes || 25);
const durationPresets = [15, 25, 50, 90];
const intentText = ref(wb.state.focus.text || '');

/* ---------------- 专注记录 ---------------- */
const ranges = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' }
];
const rangeDays = ref(7);
const rangeLabel = computed(() => ranges.find(r => r.days === rangeDays.value)?.label || '7 天');

const summary = computed(() => rangeSummary(wb.state.study, rangeDays.value, new Date()));
const heat = computed(() => heatmapWeeks(wb.state.study, 8, new Date()));
const streak = computed(() => focusStreak(wb.state.study, new Date()));

// Bars scale against the busiest day in the window so a quiet week still shows shape.
// Zero days keep a visible stub: a 0px bar looks like the day is missing from the chart
// rather than like it was a day nobody focused.
const peak = computed(() => Math.max(1, ...summary.value.series.map(d => d.minutes)));
function barHeight(minutes) {
  return minutes === 0 ? 0 : Math.max(6, Math.round((minutes / peak.value) * 100));
}
function shortDay(day) {
  return day.slice(5).replace('-', '/');
}

const statusText = computed(() => {
  const f = wb.state.focus;
  if (f.running) return '专注计时进行中';
  if (wb.focusRemainingSec.value <= 0) return '这一段已完成 · 休息后可再开始';
  return `准备开始 · ${Math.round(f.total / 60)} 分钟`;
});

function applyMinutes(minutes) {
  if (wb.setFocusDuration(Number(minutes))) customMinutes.value = Number(minutes);
}
function applyIntent() {
  if (wb.setFocusIntentText(intentText.value)) wb.showToast('专注事项已保存');
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>专注</h1>
        <p class="sub">为会议准备、周报和文档工作设定专注时段。</p>
      </div>
      <button class="btn btn-soft" type="button" @click="applyMinutes(Math.round(wb.state.focus.total / 60))">
        <img :src="asset('assets/icons/rotate-ccw.svg')" alt="" />重置
      </button>
    </header>

    <div class="focus-top">
    <section class="focus-hero panel glass rim">
      <div class="hero-top">
        <span class="focus-kicker"><i aria-hidden="true"></i>专注时段</span>
        <span class="badge">{{ wb.state.focus.running ? '计时中' : '未开始' }}</span>
      </div>
      <p class="hero-clock numeric" :class="{ running: wb.state.focus.running }">{{ wb.focusClockText.value }}</p>
      <p class="hero-status">{{ statusText }}</p>
      <div class="hero-track"><i :style="{ transform: `scaleX(${wb.focusProgressPct.value / 100})` }"></i></div>

      <div class="hero-presets">
        <button
          v-for="m in durationPresets"
          :key="m"
          class="btn btn-soft btn-sm"
          type="button"
          :class="{ 'is-picked': Math.round(wb.state.focus.total / 60) === m }"
          @click="applyMinutes(m)"
        >{{ m }} 分钟</button>
      </div>

      <div class="hero-controls">
        <button
          class="btn btn-primary hero-play"
          type="button"
          @click="wb.toggleFocusTimer()"
        >
          <img :src="asset(`assets/icons/${wb.state.focus.running ? 'pause' : 'play'}.svg`)" alt="" />
          {{ wb.state.focus.running ? '暂停专注' : '开始专注' }}
        </button>
        <form class="hero-custom" @submit.prevent="applyMinutes(customMinutes)">
          <label class="sr-only" for="focusMinutes">自定义专注时长（分钟）</label>
          <input id="focusMinutes" v-model.number="customMinutes" class="input" type="number" min="1" max="180" step="1" inputmode="numeric" />
          <button class="btn btn-soft" type="submit">应用时长</button>
        </form>
      </div>

      <p class="hero-total">今天已专注 <strong class="numeric">{{ wb.studyTodayMinutes.value }}</strong> 分钟</p>
    </section>

    <section class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">本次专注任务</h2>
        <span class="badge" :class="{ 'badge-brand': wb.linkedFocusTask.value }">
          {{ wb.linkedFocusTask.value ? '已关联任务' : '独立专注事项' }}
        </span>
      </div>
      <label class="field">
        <span>预期完成的工作</span>
        <input
          v-model="intentText"
          class="input"
          maxlength="300"
          placeholder="例如：整理会议纪要并完成周报初稿"
          @change="applyIntent"
        />
        <small>手动修改事项会解除任务关联；计时中请先暂停再修改。</small>
      </label>

      <div class="linked-task" v-if="wb.linkedFocusTask.value">
        <span class="icon-tile tile-soft"><img :src="asset('assets/icons/list-checks.svg')" alt="" /></span>
        <div>
          <strong>{{ wb.linkedFocusTask.value.text }}</strong>
          <small>关联任务 · 到点后可选择完成</small>
        </div>
        <button class="btn btn-soft btn-sm" type="button" @click="wb.toggleTodo(wb.linkedFocusTask.value.id)">
          标记完成
        </button>
      </div>

      <div class="pick-tasks" v-if="wb.openTodayTasks.value.length">
        <p class="pick-title">从今日任务中关联：</p>
        <div class="pick-list">
          <button
            v-for="task in wb.openTodayTasks.value.slice(0, 6)"
            :key="task.id"
            class="pick-chip"
            type="button"
            @click="wb.linkTaskToFocus(task.id)"
          >{{ task.text }}</button>
        </div>
      </div>
    </section>
    </div>

    <!-- 专注记录 -->
    <section class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">专注记录</h2>
        <div class="segmented focus-range" role="tablist" aria-label="统计范围">
          <button
            v-for="r in ranges"
            :key="r.days"
            type="button"
            role="tab"
            :aria-selected="rangeDays === r.days"
            :class="{ 'is-active': rangeDays === r.days }"
            @click="rangeDays = r.days"
          >{{ r.label }}</button>
        </div>
      </div>

      <div class="focus-stats">
        <div class="stat">
          <small>{{ rangeLabel }}合计</small>
          <strong class="numeric">{{ summary.total }}<em>分钟</em></strong>
        </div>
        <div class="stat">
          <small>日均</small>
          <strong class="numeric">{{ summary.average }}<em>分钟</em></strong>
        </div>
        <div class="stat">
          <small>最长一天</small>
          <strong class="numeric">{{ summary.best.minutes }}<em>分钟</em></strong>
        </div>
        <div class="stat">
          <small>连续专注</small>
          <strong class="numeric">{{ streak }}<em>天</em></strong>
        </div>
        <div class="stat stat-change">
          <small>较上一段</small>
          <strong v-if="summary.changePercent !== null" class="numeric" :class="{ up: summary.changePercent >= 0, down: summary.changePercent < 0 }">
            {{ summary.changePercent >= 0 ? '+' : '' }}{{ summary.changePercent }}%
          </strong>
          <strong v-else class="numeric muted-value">—</strong>
        </div>
      </div>

      <div v-if="summary.total === 0" class="empty">
        <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/timer.svg')" alt="" /></span>
        <strong>这段时间还没有专注记录</strong>
        <p>开始一次专注后，这里会按天累计你的时长。</p>
      </div>

      <template v-else>
        <p class="group-label">近 {{ rangeDays }} 天</p>
        <div class="bar-chart" :aria-label="`近 ${rangeDays} 天每日专注分钟数`">
          <div v-for="d in summary.series" :key="d.day" class="bar-col" :title="`${d.day} · ${d.minutes} 分钟`">
            <i :style="{ height: `${barHeight(d.minutes)}%` }" :class="{ 'is-zero': d.minutes === 0 }"></i>
            <span>{{ shortDay(d.day) }}</span>
          </div>
        </div>

        <p class="group-label">近 8 周热力</p>
        <div class="heatmap" role="img" :aria-label="`近 8 周专注热力图，共 ${heat.cells.length} 天`">
          <i
            v-for="c in heat.cells"
            :key="c.day"
            class="heat-cell"
            :class="`level-${c.level}`"
            :title="`${c.day} · ${c.minutes} 分钟`"
          ></i>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
/* Timer and task panel side by side on a wide screen. Stacked, the timer alone took a third of
   a 1200px-tall page before the user reached anything else. */
.focus-top {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr);
  gap: var(--shell-gap);
  align-items: start;
}
@container workbench (max-width: 960px) {
  .focus-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1180px) {
  .focus-top { grid-template-columns: minmax(0, 1fr); }
}

/* Vertical rhythm scales with the viewport: on a 1200px-tall screen the fixed paddings added up
   to a hero that filled a third of the page before any content below it. */
.focus-hero {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: clamp(20px, 3.2vh, 34px) clamp(18px, 3vw, 28px);
}
.hero-top { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.focus-kicker { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-sm); font-weight: 700; color: var(--brand-deep); }
.focus-kicker i { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.hero-clock {
  font-size: clamp(52px, 7vw, 76px); font-weight: 650; letter-spacing: -.045em; line-height: 1.05;
  margin: clamp(8px, 1.4vh, 16px) 0 4px;
}
.hero-clock.running { color: var(--brand-deep); }
.hero-status { font-size: var(--text-body); color: var(--muted); }
.hero-track { width: min(520px, 100%); height: 4px; margin-top: clamp(10px, 1.6vh, 18px); border-radius: 99px; background: var(--line); overflow: hidden; }
.hero-track i { display: block; width: 100%; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--brand), var(--lime)); transform-origin: left center; transition: transform var(--motion-slow) linear; }
.hero-presets { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; margin-top: clamp(10px, 1.6vh, 18px); }
.btn.is-picked { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); }
.hero-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: clamp(10px, 1.6vh, 18px); }
.hero-play { min-height: 46px; padding: 0 24px; }
.hero-custom { display: flex; align-items: center; gap: 8px; }
.hero-custom .input { width: 96px; min-height: 44px; text-align: center; }
.hero-total { margin-top: 18px; font-size: var(--text-sm); color: var(--muted); }
.hero-total strong { color: var(--ink); font-weight: 700; }
.linked-task { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); }
.linked-task > div { flex: 1; min-width: 0; }
.linked-task strong { display: block; font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; }
.linked-task small { font-size: var(--text-meta); color: var(--muted); }
.pick-tasks { margin-top: 16px; }
.pick-title { font-size: var(--text-meta); color: var(--muted); margin-bottom: 8px; }
.pick-list { display: flex; flex-wrap: wrap; gap: 7px; }
.pick-chip { border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--surface); min-height: 32px; padding: 0 12px; font-size: var(--text-meta); color: var(--ink-soft); }
.pick-chip:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); }

/* ---------- 专注记录 ---------- */
.focus-range { margin-left: auto; }
.focus-stats {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;
  margin-bottom: 18px;
}
.stat {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; border-radius: var(--radius-control);
  border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 55%, transparent);
}
.stat small { font-size: var(--text-2xs); color: var(--muted); }
.stat strong { font-size: 21px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; }
.stat strong em { font-style: normal; margin-left: 3px; font-size: var(--text-2xs); font-weight: 600; color: var(--muted); }
.stat-change strong.up { color: var(--brand-deep); }
.stat-change strong.down { color: var(--coral); }
.muted-value { color: var(--muted); }

.group-label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-soft); margin: 0 0 9px; }

.bar-chart {
  display: flex; align-items: flex-end; gap: 4px;
  height: 120px; padding: 10px 12px 0;
  border: 1px solid var(--line); border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface) 45%, transparent);
  margin-bottom: 18px;
}
.bar-col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 5px; }
.bar-col i {
  display: block; width: 100%; border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, var(--brand), color-mix(in srgb, var(--brand) 55%, transparent));
  transition: height var(--motion-slow) var(--ease-out);
  min-height: 2px;
}
/* Zero days: a 3px neutral stub on the baseline, so the day is visibly present but empty. */
.bar-col i.is-zero {
  background: color-mix(in srgb, var(--muted) 30%, transparent);
  min-height: 3px;
}
.bar-col span { font-size: 10.5px; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; }

.heatmap {
  display: grid; grid-auto-flow: column;
  grid-template-rows: repeat(7, 12px);
  gap: 3px; overflow-x: auto; padding-bottom: 4px;
}
.heat-cell { width: 12px; height: 12px; border-radius: 3px; background: var(--line); }
.heat-cell.level-1 { background: color-mix(in srgb, var(--brand) 26%, var(--surface)); }
.heat-cell.level-2 { background: color-mix(in srgb, var(--brand) 48%, var(--surface)); }
.heat-cell.level-3 { background: color-mix(in srgb, var(--brand) 72%, var(--surface)); }
.heat-cell.level-4 { background: var(--brand); }

@media (max-width: 900px) {
  .focus-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .focus-range { margin-left: 0; }
}
</style>
