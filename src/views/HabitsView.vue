<script setup>
import { computed, reactive, ref } from 'vue';
import { useWorkbench } from '../composables/useWorkbench.js';
import { HABIT_ICONS, isDone, streakOf, recentDays } from '../../js/habits.js';
import ProgressRing from '../components/ProgressRing.vue';

const wb = useWorkbench();

const customWater = ref('');
const stepInput = ref('');

const weekData = computed(() => {
  const out = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const water = (wb.state.water[key] || []).reduce((s, i) => s + i.ml, 0);
    const steps = wb.state.steps[key] || 0;
    out.push({
      key,
      label: d.toLocaleDateString('zh-CN', { weekday: 'short' }),
      water,
      steps,
      done: water >= wb.state.settings.waterGoal * 0.7 && steps >= wb.state.settings.stepGoal * 0.7,
      today: offset === 0
    });
  }
  return out;
});

function addCustomWater() {
  const ml = Number(customWater.value);
  if (wb.addWater(ml)) customWater.value = '';
}
function saveSteps() { if (wb.updateSteps(stepInput.value)) stepInput.value = ''; }

/* ---------------- 习惯打卡 ---------------- */
const formOpen = ref(false);
const draft = reactive({ name: '', icon: 'leaf', target: 1 });

function toggleHabitForm() {
  formOpen.value = !formOpen.value;
  if (formOpen.value) Object.assign(draft, { name: '', icon: 'leaf', target: 1 });
}

function saveHabit() {
  if (wb.addHabit({ name: draft.name, icon: draft.icon, target: draft.target })) {
    formOpen.value = false;
    Object.assign(draft, { name: '', icon: 'leaf', target: 1 });
  }
}

function removeHabit(habit) {
  if (!window.confirm(`删除习惯「${habit.name}」？打卡记录会一起移除。`)) return;
  wb.deleteHabit(habit.id);
}

function isHabitDone(habit) { return isDone(habit, wb.todayStr.value); }
function partialOf(habit) { return habit.log?.[wb.todayStr.value] || 0; }
function weekOf(habit) { return recentDays(habit, 7, wb.todayStr.value); }
function streakText(habit) {
  const n = streakOf(habit, wb.todayStr.value);
  if (!n) return '还没开始';
  return `${n} 天连续`;
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>生活习惯</h1>
        <p class="sub">记录每日饮水与总步数，配合工作间歇安排活动。</p>
      </div>
      <button class="btn btn-soft" type="button" @click="wb.goto('calendar')">
        <img src="/assets/icons/bell.svg" alt="" />设置提醒
      </button>
    </header>

    <div class="habit-columns">
      <!-- 饮水 -->
      <section class="panel glass rim habit-panel">
        <div class="panel-head">
          <h2 class="panel-title">每日饮水</h2>
          <span class="badge">今天</span>
        </div>
        <div class="habit-main">
          <ProgressRing :percent="wb.waterPercent.value" :size="64" />
          <p class="habit-value numeric">
            <strong>{{ wb.waterTodayMl.value }}</strong>
            <span>/ {{ wb.state.settings.waterGoal }} ml</span>
          </p>
        </div>
        <div class="habit-track"><i :style="{ width: `${wb.waterPercent.value}%` }"></i></div>
        <div class="water-buttons">
          <button class="btn btn-soft btn-sm" type="button" @click="wb.addWater(150)">+150 ml</button>
          <button class="btn btn-soft btn-sm" type="button" @click="wb.addWater(250)">+250 ml</button>
          <button class="btn btn-soft btn-sm" type="button" @click="wb.addWater(500)">+500 ml</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="wb.undoWater()">
            <img src="/assets/icons/rotate-ccw.svg" alt="" />撤销
          </button>
        </div>
        <form class="custom-water" @submit.prevent="addCustomWater">
          <input v-model="customWater" class="input" type="number" min="1" max="5000" step="1" inputmode="numeric" placeholder="自定义 ml，如 350" />
          <button class="btn btn-primary btn-sm" type="submit">记录</button>
        </form>
        <p class="tiny">每次记录累加到当天；撤销仅移除最近一次记录。</p>
      </section>

      <!-- 步数 -->
      <section class="panel glass rim habit-panel">
        <div class="panel-head">
          <h2 class="panel-title">每日总步数</h2>
          <button class="btn btn-text btn-sm" type="button" @click="wb.goto('sport')">
            单次运动<img src="/assets/icons/arrow-up-right.svg" alt="" />
          </button>
        </div>
        <div class="habit-main">
          <ProgressRing :percent="wb.stepsPercent.value" tone="violet" :size="64" />
          <p class="habit-value numeric">
            <strong>{{ wb.stepsToday.value }}</strong>
            <span>/ {{ wb.state.settings.stepGoal }} 步</span>
          </p>
        </div>
        <div class="habit-track"><i :style="{ width: `${wb.stepsPercent.value}%` }"></i></div>
        <form class="custom-water" @submit.prevent="saveSteps">
          <input v-model="stepInput" class="input" type="number" min="0" max="200000" step="1" inputmode="numeric" placeholder="今天的累计步数，如 6000" />
          <button class="btn btn-primary btn-sm" type="submit">更新</button>
        </form>
        <p class="tiny">保存后覆盖当天总步数，不累加。运动时长与距离单独记录。</p>
      </section>
    </div>

    <!-- 习惯打卡 -->
    <section class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">习惯打卡</h2>
        <div class="panel-actions">
          <span v-if="wb.habits.value.length" class="panel-sub">
            今日 {{ wb.habitToday.value.done }}/{{ wb.habitToday.value.total }}
          </span>
          <button class="btn btn-soft btn-sm" type="button" @click="toggleHabitForm">
            <img src="/assets/icons/plus.svg" alt="" />{{ formOpen ? '收起' : '添加习惯' }}
          </button>
        </div>
      </div>

      <form v-if="formOpen" class="habit-form" @submit.prevent="saveHabit">
        <label class="field">
          <span>习惯名称</span>
          <input v-model="draft.name" class="input" :maxlength="24" placeholder="例如：早起、读书 30 分、不熬夜" required />
        </label>
        <label class="field">
          <span>每天目标次数</span>
          <input v-model.number="draft.target" class="input" type="number" min="1" max="10" step="1" />
        </label>
        <div class="field habit-icon-field">
          <span>图标</span>
          <div class="icon-picks">
            <button
              v-for="ic in HABIT_ICONS"
              :key="ic"
              type="button"
              class="icon-pick"
              :class="{ 'is-active': draft.icon === ic }"
              :aria-label="ic"
              :aria-pressed="draft.icon === ic"
              @click="draft.icon = ic"
            >
              <img :src="`/assets/icons/${ic}.svg`" alt="" />
            </button>
          </div>
        </div>
        <button class="btn btn-primary" type="submit">保存习惯</button>
      </form>

      <div v-if="!wb.habits.value.length" class="empty">
        <span class="empty-art" aria-hidden="true">🌱</span>
        <strong>还没有习惯</strong>
        <p>添加一个想坚持的习惯，每天点一下打卡，连续天数会自动累计。</p>
      </div>

      <ul v-else class="habit-list">
        <li v-for="habit in wb.habits.value" :key="habit.id" class="habit-row">
          <button
            class="habit-check"
            type="button"
            :class="{ 'is-done': isHabitDone(habit), 'is-partial': partialOf(habit) > 0 }"
            :aria-label="`打卡 ${habit.name}`"
            :aria-pressed="isHabitDone(habit)"
            @click="wb.checkInHabit(habit.id)"
          >
            <img src="/assets/icons/check.svg" alt="" />
          </button>

          <span class="habit-icon"><img :src="`/assets/icons/${habit.icon}.svg`" alt="" /></span>

          <div class="habit-copy">
            <strong>{{ habit.name }}</strong>
            <small>
              <template v-if="habit.target > 1">{{ partialOf(habit) }}/{{ habit.target }} · </template>
              {{ streakText(habit) }}
            </small>
          </div>

          <div class="habit-week" :aria-label="`${habit.name} 近 7 天`">
            <i
              v-for="d in weekOf(habit)"
              :key="d.day"
              class="habit-day"
              :class="{ 'is-done': d.done, 'is-partial': !d.done && d.count > 0, 'is-today': d.day === wb.todayStr.value }"
              :title="`${d.day} · ${d.count}`"
            ></i>
          </div>

          <button class="btn-icon is-danger habit-del" type="button" :aria-label="`删除 ${habit.name}`" @click="removeHabit(habit)">
            <img src="/assets/icons/trash.svg" alt="" />
          </button>
        </li>
      </ul>
    </section>

    <!-- 近 7 天 -->
    <section class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">近 7 天习惯记录</h2>
        <span class="panel-sub">每日饮水与步数汇总</span>
      </div>
      <div class="week-days">
        <div v-for="day in weekData" :key="day.key" class="week-day" :class="{ today: day.today, done: day.done }">
          <i class="week-dot" aria-hidden="true"></i>
          <span>{{ day.label }}</span>
          <small>{{ day.steps }} 步</small>
          <small>{{ day.water }} ml</small>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.habit-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--shell-gap); }
.habit-panel { display: flex; flex-direction: column; }
.habit-main { display: flex; align-items: center; gap: 16px; margin: 8px 0 16px; }
.habit-value { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.habit-value strong { font-size: 34px; font-weight: 800; letter-spacing: -.03em; }
.habit-value span { font-size: 13px; color: var(--muted); }
.habit-track { height: 6px; border-radius: 99px; background: var(--line); overflow: hidden; margin-bottom: 16px; }
.habit-track i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--brand), var(--lime)); transition: width var(--motion-slow) var(--ease-out); }
.water-buttons { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.custom-water { display: flex; gap: 8px; }
.custom-water .input { flex: 1; min-width: 0; }
.tiny { margin-top: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }

.week-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.week-day {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 14px 6px; border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.week-day.today { border-color: var(--brand); background: var(--brand-pale); }
.week-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line-strong); background: var(--surface); margin-bottom: 2px; }
.week-day.done .week-dot { border-color: var(--brand); background: var(--brand); box-shadow: inset 0 0 0 3px var(--surface); }
.week-day span { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.week-day small { font-size: 12px; color: var(--muted); white-space: nowrap; }

/* ---------- 习惯打卡 ---------- */
.habit-form {
  display: grid; grid-template-columns: minmax(0, 2fr) auto auto; gap: 12px;
  align-items: end; margin-bottom: 16px; padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.habit-icon-field { min-width: 0; }
.icon-picks { display: flex; gap: 4px; flex-wrap: wrap; }
.icon-pick {
  width: 34px; height: 34px; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--surface); transition: border-color var(--motion-fast), background-color var(--motion-fast);
}
.icon-pick img { width: 16px; height: 16px; opacity: .6; }
.icon-pick:hover { border-color: var(--line-strong); }
.icon-pick.is-active { border-color: var(--brand); background: var(--brand-pale); }
.icon-pick.is-active img { opacity: 1; }

/* Multiple columns on a desktop-width panel: two habits stacked in one full-width row is the
   same empty-space problem as the task list. auto-fill keeps the column width when there are
   fewer habits than columns, instead of stretching each row across the whole page. */
.habit-list {
  list-style: none; margin: 0; padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: 8px;
  align-items: start;
}
.habit-row {
  display: grid; grid-template-columns: 34px 30px minmax(0, 1fr) auto auto;
  align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface) 58%, transparent);
  transition: border-color var(--motion-fast), background-color var(--motion-fast);
}
.habit-row:hover { border-color: color-mix(in srgb, var(--brand) 24%, var(--line)); background: color-mix(in srgb, var(--surface) 80%, transparent); }

.habit-check {
  width: 34px; height: 34px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface);
  transition: background-color var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast) var(--ease-spring);
}
.habit-check img { width: 15px; height: 15px; opacity: 0; transition: opacity var(--motion-fast); }
.habit-check:hover { border-color: var(--brand); background: var(--brand-pale); transform: scale(1.05); }
.habit-check.is-partial { border-color: var(--brand); background: color-mix(in srgb, var(--brand-pale) 60%, var(--surface)); }
.habit-check.is-done { background: var(--cta-bg); border-color: var(--cta-bg); }
.habit-check.is-done img { opacity: 1; filter: brightness(0) invert(1); }

.habit-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--surface-soft); }
.habit-icon img { width: 17px; height: 17px; opacity: .66; }

.habit-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.habit-copy strong { font-size: 13.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.habit-copy small { font-size: 11.5px; color: var(--muted); }

.habit-week { display: flex; gap: 4px; }
.habit-day {
  width: 12px; height: 12px; border-radius: 3px;
  border: 1px solid var(--line-strong); background: var(--surface);
}
.habit-day.is-partial { background: color-mix(in srgb, var(--brand) 38%, var(--surface)); border-color: color-mix(in srgb, var(--brand) 50%, var(--line)); }
.habit-day.is-done { background: var(--brand); border-color: var(--brand); }
.habit-day.is-today { box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 26%, transparent); }

/* Hidden only where hovering is possible. On touch there is no hover, so an opacity:0 control
   would be permanently invisible and the habit could never be deleted. */
.habit-del { opacity: 0; transition: opacity var(--motion-fast); }
@media (hover: hover) {
  .habit-row:hover .habit-del, .habit-row:focus-within .habit-del { opacity: 1; }
}
@media (hover: none) {
  .habit-del { opacity: 1; }
}

@media (max-width: 900px) {
  .habit-columns { grid-template-columns: minmax(0, 1fr); }
  .habit-form { grid-template-columns: minmax(0, 1fr); }
  .habit-row { grid-template-columns: 34px 30px minmax(0, 1fr) auto; }
  .habit-week { display: none; }
}

@media (max-width: 620px) {
  .week-days { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .habit-value strong { font-size: 27px; }
}
</style>
