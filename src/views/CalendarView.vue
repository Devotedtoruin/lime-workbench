<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { PRESETS, TIMER_PRESETS } from '../../js/reminders.js';
import { reviewFor, reviewHeadline } from '../../js/review.js';

const emit = defineEmits(['new-task']);
const wb = useWorkbench();

/* 日历 */
const cursor = ref(new Date(wb.nowDate.value));
const selectedDate = ref(wb.todayStr.value);

const monthLabel = computed(() => `${cursor.value.getFullYear()}年${cursor.value.getMonth() + 1}月`);
const calendarCells = computed(() => {
  const y = cursor.value.getFullYear();
  const m = cursor.value.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push({ empty: true, key: `pad-${i}` });
  const schedules = wb.state.settings.workSchedule || [];
  const reminders = wb.state.reminders || [];
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = wb.state.todos.filter(t => t.date === date).length;
    const hasShift = schedules.some(s => s.date === date);
    const hasReminder = reminders.some(r => r.kind === 'once' && r.date === date && !r.completed);
    cells.push({
      empty: false,
      day: d,
      date,
      count,
      hasShift,
      hasReminder,
      today: date === wb.todayStr.value,
      selected: date === selectedDate.value,
      key: date
    });
  }
  return cells;
});
const dayTasks = computed(() => wb.state.todos.filter(t => t.date === selectedDate.value));
const selectedShift = computed(() =>
  (wb.state.settings.workSchedule || []).find(s => s.date === selectedDate.value) || null
);
const selectedLabel = computed(() => selectedDate.value === wb.todayStr.value ? '今天' : selectedDate.value);
const review = computed(() => reviewFor(selectedDate.value, wb.state));
const reviewTitle = computed(() => reviewHeadline(review.value));

function prevMonth() {
  const d = new Date(cursor.value);
  d.setDate(1); d.setMonth(d.getMonth() - 1);
  cursor.value = d;
}
function nextMonth() {
  const d = new Date(cursor.value);
  d.setDate(1); d.setMonth(d.getMonth() + 1);
  cursor.value = d;
}
function pickDate(cell) {
  if (cell.empty) return;
  selectedDate.value = cell.date;
}
function addTaskOnSelected() {
  emit('new-task', { id: '', text: '', date: selectedDate.value, time: '', priority: 'medium', tag: '个人计划' });
}

/* 定时提醒 */
const schedule = reactive({ label: '', repeat: 'once', date: wb.todayStr.value, time: '18:00' });

onMounted(() => {
  const prefill = wb.consumePrefill('reminder');
  if (prefill?.label) schedule.label = prefill.label;
});

function addSchedule() {
  if (wb.addScheduledReminder({ ...schedule })) schedule.label = '';
}

/* 周期提醒 */
const customInterval = reactive({ label: '', every: 45 });
function addInterval() {
  const every = Number(customInterval.every);
  wb.addIntervalReminder('custom', every, customInterval.label.trim() || `每 ${every} 分钟提醒`);
  customInterval.label = '';
}

/* 倒计时 */
const customTimer = ref(25);
function addTimer() {
  wb.addCountdownTimer('custom', customTimer.value, `倒计时 ${customTimer.value} 分钟`);
}

function scheduleText(r) {
  if (r.kind === 'timer') return `${r.minutes} 分钟倒计时`;
  if (r.kind === 'interval') return `每 ${r.every} 分钟`;
  if (r.kind === 'once') return `${r.date} ${r.time}`;
  return `每天 ${r.time}`;
}
function toggleSound() {
  wb.state.soundOn = !wb.state.soundOn;
  wb.save();
  if (wb.state.soundOn) wb.showToast('提醒声已开启');
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>日历与提醒</h1>
        <p class="sub">安排会议、任务截止时间与工作间歇提醒，支持在日历中直接勾选或编辑任务。</p>
      </div>
      <div class="page-head-actions">
        <button class="btn btn-soft" type="button" :aria-pressed="wb.state.soundOn" @click="toggleSound">
          <img :src="asset(`assets/icons/${wb.state.soundOn ? 'volume-2' : 'volume-x'}.svg`)" alt="" />
          提醒声 {{ wb.state.soundOn ? '开' : '关' }}
        </button>
        <button class="btn btn-primary" type="button" @click="emit('new-task', { id: '', text: '', date: selectedDate, time: '', priority: 'medium', tag: '个人计划' })">
          <img :src="asset('assets/icons/plus.svg')" alt="" />添加任务
        </button>
      </div>
    </header>

    <div class="cal-layout">
      <!-- 月历 -->
      <section class="panel glass rim cal-panel">
        <div class="cal-head">
          <button class="btn-icon" type="button" aria-label="上个月" @click="prevMonth"><img :src="asset('assets/icons/chevron-left.svg')" alt="" /></button>
          <strong>{{ monthLabel }}</strong>
          <button class="btn-icon" type="button" aria-label="下个月" @click="nextMonth"><img :src="asset('assets/icons/chevron-right.svg')" alt="" /></button>
        </div>
        <div class="cal-grid">
          <span v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w" class="cal-week">{{ w }}</span>
          <button
            v-for="cell in calendarCells"
            :key="cell.key"
            type="button"
            class="cal-cell"
            :class="{ 'is-empty': cell.empty, 'is-today': cell.today, 'is-selected': cell.selected }"
            :disabled="cell.empty"
            :aria-label="cell.date || undefined"
            @click="pickDate(cell)"
          >
            <span>{{ cell.day }}</span>
            <span v-if="cell.count || cell.hasShift || cell.hasReminder" class="cal-dots" aria-hidden="true">
              <i v-if="cell.count" class="cal-dot" title="有任务"></i>
              <i v-if="cell.hasShift" class="cal-dot is-shift" title="已排班"></i>
              <i v-if="cell.hasReminder" class="cal-dot is-rem" title="有提醒"></i>
            </span>
          </button>
        </div>

        <div class="cal-day">
          <div class="cal-day-head">
            <div class="cal-day-title-row">
              <h2 class="cal-day-title">{{ selectedLabel }}</h2>
              <span v-if="selectedShift" class="badge numeric">
                排班 {{ selectedShift.onTime }}–{{ selectedShift.offTime }}
              </span>
            </div>
            <button class="btn btn-text btn-sm" type="button" @click="addTaskOnSelected">
              <img :src="asset('assets/icons/plus.svg')" alt="" />在这一天添加任务
            </button>
          </div>
          <div v-if="!dayTasks.length" class="empty" style="padding: 20px">
            <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/calendar-days.svg')" alt="" /></span>
            <p>这一天还没有安排。</p>
          </div>
          <TransitionGroup v-else name="list-anim" tag="ul" class="cal-tasks">
            <li v-for="task in dayTasks" :key="task.id" :class="{ done: task.done }">
              <input
                class="checkbox"
                type="checkbox"
                :checked="task.done"
                :aria-label="`完成${task.text}`"
                @change="wb.toggleTodo(task.id)"
              />
              <span :class="{ done: task.done }">{{ task.text }}</span>
              <em class="numeric">{{ task.time || '全天' }}</em>
              <div class="cal-task-actions">
                <button class="btn-icon btn-xs" type="button" title="编辑任务" aria-label="编辑任务" @click="emit('new-task', task)">
                  <img :src="asset('assets/icons/pencil.svg')" alt="" />
                </button>
                <button class="btn-icon btn-xs is-danger" type="button" title="删除任务" aria-label="删除任务" @click="wb.deleteTodo(task.id)">
                  <img :src="asset('assets/icons/trash.svg')" alt="" />
                </button>
              </div>
            </li>
          </TransitionGroup>

          <!-- 当日回顾：全部由已有记录推导，没有记录就不填内容 -->
          <div class="day-review">
            <div class="review-head">
              <h3>当日回顾</h3>
              <span class="badge">{{ reviewTitle }}</span>
            </div>

            <div v-if="review.empty" class="review-empty">
              这一天还没有任何记录。完成任务、专注或喝水后，这里会自动汇总。
            </div>

            <template v-else>
              <div v-if="review.completed.length || review.finishedElsewhere.length" class="review-group">
                <p class="review-label">完成</p>
                <ul>
                  <li v-for="t in [...review.completed, ...review.finishedElsewhere]" :key="t.id" class="is-done">
                    <img :src="asset('assets/icons/circle-check.svg')" alt="" />{{ t.text }}
                  </li>
                </ul>
              </div>

              <div v-if="review.open.length" class="review-group">
                <p class="review-label">未完成</p>
                <ul>
                  <li v-for="t in review.open" :key="t.id">
                    <img :src="asset('assets/icons/clock-3.svg')" alt="" />{{ t.text }}
                    <em class="numeric">{{ t.time || '全天' }}</em>
                  </li>
                </ul>
              </div>

              <div class="review-metrics">
                <span><small>专注</small><strong class="numeric">{{ review.focusMinutes }}<em>分钟</em></strong></span>
                <span><small>饮水</small><strong class="numeric">{{ review.water }}<em>ml</em></strong></span>
                <span><small>步数</small><strong class="numeric">{{ review.steps }}</strong></span>
                <span v-if="review.sport.length"><small>运动</small><strong class="numeric">{{ review.sport.reduce((s, r) => s + Number(r.minutes || 0), 0) }}<em>分钟</em></strong></span>
                <span v-if="review.habits.length"><small>习惯</small><strong class="numeric">{{ review.habitsDone }}<em>/{{ review.habits.length }}</em></strong></span>
              </div>
            </template>
          </div>
        </div>
      </section>

      <div class="cal-side">
        <!-- 定时提醒 -->
        <section class="panel glass rim">
          <div class="panel-head"><h2 class="panel-title">定时提醒</h2><span class="badge">按本机时区</span></div>
          <form class="schedule-form" @submit.prevent="addSchedule">
            <label class="field">
              <span>提醒事项</span>
              <input v-model="schedule.label" class="input" maxlength="120" required placeholder="例如：每日下班前复盘" />
            </label>
            <div class="schedule-row">
              <label class="field">
                <span>重复</span>
                <select v-model="schedule.repeat" class="input">
                  <option value="once">仅一次</option>
                  <option value="daily">每天</option>
                </select>
              </label>
              <label v-if="schedule.repeat === 'once'" class="field">
                <span>日期</span>
                <input v-model="schedule.date" class="input" type="date" required />
              </label>
              <label class="field">
                <span>时间</span>
                <input v-model="schedule.time" class="input" type="time" required />
              </label>
            </div>
            <button class="btn btn-primary" type="submit">添加定时提醒</button>
          </form>
          <p class="tiny">网页需保持运行；后台或关闭浏览器时不能保证准点通知，重新打开后会补显到期提醒。</p>
        </section>

        <!-- 周期提醒 -->
        <section class="panel glass rim">
          <div class="panel-head"><h2 class="panel-title">周期提醒</h2></div>
          <div class="preset-chips">
            <button v-for="p in PRESETS" :key="p.id" class="preset-chip" type="button" @click="wb.addIntervalReminder(p.id, p.every)">
              <img :src="asset(`assets/img/${p.icon}.png`)" alt="" />
              <span>{{ p.label }}</span>
              <em>每 {{ p.every }} 分</em>
            </button>
          </div>
          <form class="custom-row" @submit.prevent="addInterval">
            <input v-model="customInterval.label" class="input" maxlength="300" placeholder="自定义提醒内容" />
            <label class="every-label">每 <input v-model.number="customInterval.every" class="input every-input" type="number" min="1" max="1440" /> 分钟</label>
            <button class="btn btn-soft" type="submit">添加</button>
          </form>
        </section>

        <!-- 倒计时 -->
        <section class="panel glass rim">
          <div class="panel-head"><h2 class="panel-title">倒计时</h2></div>
          <div class="preset-chips">
            <button v-for="p in TIMER_PRESETS" :key="p.id" class="preset-chip timer" type="button" @click="wb.addCountdownTimer(p.id, p.minutes)">
              <img :src="asset(`assets/img/${p.icon}.png`)" alt="" />
              <span>{{ p.label }}</span>
              <em>{{ p.minutes }} 分</em>
            </button>
          </div>
          <form class="custom-row" @submit.prevent="addTimer">
            <label class="every-label">自定义时长 <input v-model.number="customTimer" class="input every-input" type="number" min="1" max="1440" /> 分钟</label>
            <button class="btn btn-soft" type="submit">开始</button>
          </form>
        </section>
      </div>
    </div>

    <!-- 进行中的提醒 -->
    <section class="panel glass rim">
      <div class="panel-head"><h2 class="panel-title">进行中的提醒 <span class="badge">{{ wb.state.reminders.length }}</span></h2></div>
      <div v-if="!wb.state.reminders.length" class="empty">
        <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/bell.svg')" alt="" /></span>
        <strong>还没有提醒</strong>
        <p>选择上面的预设，或创建自己的提醒。</p>
      </div>
      <TransitionGroup v-else name="list-anim" tag="ul" class="rem-list">
        <li v-for="r in wb.state.reminders" :key="r.id" class="rem-card" :class="{ completed: r.completed }">
          <span class="rem-icon" :style="{ '--tone': r.color || 'var(--brand)' }">
            <img :src="asset(`assets/img/${r.icon || 'bell'}.png`)" alt="" />
          </span>
          <div class="rem-copy">
            <strong>{{ r.label }}</strong>
            <small>{{ r.completed ? '已完成' : wb.humanRemain(r) }} · {{ scheduleText(r) }}</small>
            <span class="rem-bar"><i :style="{ width: `${wb.reminderProgress(r)}%` }"></i></span>
          </div>
          <div class="rem-actions">
            <button
              v-if="!r.completed"
              class="btn-icon"
              type="button"
              :title="r.enabled ? '暂停提醒' : '继续提醒'"
              :aria-label="r.enabled ? '暂停提醒' : '继续提醒'"
              @click="wb.toggleReminderPause(r.id)"
            >
              <img :src="asset(`assets/icons/${r.enabled ? 'pause' : 'play'}.svg`)" alt="" />
            </button>
            <button class="btn-icon is-danger" type="button" title="删除提醒" aria-label="删除提醒" @click="wb.deleteReminderById(r.id)">
              <img :src="asset('assets/icons/trash.svg')" alt="" />
            </button>
          </div>
        </li>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.cal-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(290px, .8fr); gap: var(--shell-gap); align-items: start; }
.cal-side { display: flex; flex-direction: column; gap: var(--shell-gap); min-width: 0; }

.cal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.cal-head strong { font-size: var(--text-md); font-weight: 750; }
.cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.cal-week { display: grid; place-items: center; min-height: 30px; font-size: var(--text-2xs); font-weight: 700; color: var(--muted); }
.cal-cell {
  position: relative; display: grid; place-items: center;
  min-height: 44px; border: 1px solid transparent; border-radius: 10px;
  background: transparent; color: var(--ink-soft); font-size: var(--text-body); font-variant-numeric: tabular-nums;
  transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast);
}
.cal-cell:hover:not(.is-empty) { background: var(--surface-soft); border-color: var(--line); }
.cal-cell.is-empty { pointer-events: none; }
.cal-cell.is-today { color: var(--brand-deep); font-weight: 750; }
.cal-cell.is-today::after { content: "今"; position: absolute; bottom: 3px; font-size: 9px; color: var(--brand); }
.cal-cell.is-selected { background: var(--brand-pale); border-color: var(--brand); color: var(--brand-deep); font-weight: 700; }
.cal-dots { position: absolute; top: 5px; right: 6px; display: inline-flex; gap: 3px; }
.cal-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--brand); }
.cal-dot.is-shift { background: var(--blue); }
.cal-dot.is-rem { background: var(--amber); }
.cal-day { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.cal-day-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.cal-day-title-row { display: flex; align-items: center; gap: 8px; }
.cal-day-head h2, .cal-day-head .cal-day-title { font-size: var(--text-body); font-weight: 700; }
.cal-tasks { list-style: none; margin: 0; padding: 0; position: relative; }
.cal-tasks li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: var(--text-body); }
.cal-tasks li:last-child { border-bottom: 0; }
.cal-tasks span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.cal-tasks span.done { text-decoration: line-through; color: var(--muted); }
.cal-tasks em { font-style: normal; font-size: var(--text-meta); color: var(--muted); }
.cal-task-actions { display: flex; align-items: center; gap: 2px; }
.btn-xs { width: 28px; height: 28px; flex-basis: 28px; border-radius: 7px; }
.btn-xs img { width: 14px; height: 14px; }

/* ---------- 当日回顾 ---------- */
.day-review { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.review-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.review-head h3 { font-size: var(--text-body); font-weight: 700; }
.review-empty { font-size: var(--text-sm); color: var(--muted); line-height: 1.7; }
.review-group { margin-bottom: 12px; }
.review-label { margin: 0 0 6px; font-size: var(--text-2xs); font-weight: 700; color: var(--muted); letter-spacing: .06em; }
.review-group ul { list-style: none; margin: 0; padding: 0; }
.review-group li { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
.review-group li img { width: 15px; height: 15px; flex: 0 0 15px; opacity: .6; }
.review-group li.is-done { color: var(--ink-soft); }
.review-group li.is-done img { opacity: .85; }
.review-group li em { margin-left: auto; font-style: normal; font-size: var(--text-2xs); color: var(--muted); white-space: nowrap; }
.review-metrics { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.review-metrics span {
  display: flex; flex-direction: column; gap: 2px; min-width: 84px;
  padding: 9px 12px; border-radius: var(--radius-control);
  border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 52%, transparent);
}
.review-metrics small { font-size: var(--text-2xs); color: var(--muted); }
.review-metrics strong { font-size: var(--text-md); font-weight: 750; }
.review-metrics strong em { font-style: normal; margin-left: 2px; font-size: 11px; font-weight: 600; color: var(--muted); }

.schedule-form { display: flex; flex-direction: column; gap: 11px; }
.schedule-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.tiny { margin-top: 10px; font-size: var(--text-sm); color: var(--muted); line-height: 1.6; }

.preset-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.preset-chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft);
  font-size: var(--text-meta); transition: border-color var(--motion-fast), background-color var(--motion-fast);
}
.preset-chip:hover { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); }
.preset-chip img { width: 17px; height: 17px; object-fit: contain; }
.preset-chip em { font-style: normal; font-size: var(--text-meta); color: var(--muted); }
.custom-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.custom-row .input { flex: 1 1 160px; }
.every-label { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--muted); white-space: nowrap; }
.every-input { width: 72px; min-height: 38px; text-align: center; }

.rem-list { list-style: none; margin: 0; padding: 0; position: relative; }
.rem-card { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.rem-card:last-child { border-bottom: 0; }
.rem-card.completed { opacity: .6; }
.rem-icon { width: 38px; height: 38px; flex: 0 0 38px; display: grid; place-items: center; border-radius: 11px; background: var(--surface-soft); border: 1px solid var(--line); }
.rem-icon img { width: 22px; height: 22px; object-fit: contain; }
.rem-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.rem-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; }
.rem-copy small { font-size: var(--text-meta); color: var(--muted); }
.rem-bar { height: 3px; margin-top: 5px; border-radius: 99px; background: var(--line); overflow: hidden; }
.rem-bar i { display: block; height: 100%; border-radius: 99px; background: var(--brand); }
.rem-actions { display: flex; gap: 1px; }
.rem-actions .btn-icon { width: 34px; height: 34px; flex-basis: 34px; }
.rem-actions .btn-icon img { width: 15px; height: 15px; }

@container workbench (max-width: 960px) {
  .cal-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1080px) {
  .cal-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .schedule-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cal-cell { min-height: 40px; }
}
</style>
