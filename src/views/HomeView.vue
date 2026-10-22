<script setup>
import { computed, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { burstFrom } from '../lib/effects.js';
import { reviewFor, reviewHeadline } from '../../js/review.js';
import EmptyState from '../components/EmptyState.vue';

const emit = defineEmits(['open-command', 'new-task']);
const wb = useWorkbench();

/* ---------------- 快速添加 ---------------- */
const quickText = ref('');
const quickInput = ref(null);
const noteDraft = ref({ open: false, id: null, title: '', body: '' });

function startNote(note = null) {
  noteDraft.value = note
    ? { open: true, id: note.id, title: note.title, body: note.body }
    : { open: true, id: null, title: '', body: '' };
  requestAnimationFrame(() => {
    document.querySelector('.notes-panel .inline-editor input')?.focus({ preventScroll: false });
  });
}

function submitQuick() {
  if (!quickText.value.trim()) { quickInput.value?.focus(); return; }
  if (wb.addTodo(quickText.value, { bucket: 'today' })) {
    quickText.value = '';
    requestAnimationFrame(() => quickInput.value?.focus());
  }
}
/* ---------------- KPI ---------------- */
// No "今日待办" card here: the task panel right below already carries that count and its list.
// A summary card duplicating the panel it sits above just teaches people to skip both.

const heroNow = computed(() => new Date(wb.nowTick.value).toLocaleTimeString('zh-CN', {
  hour: '2-digit', minute: '2-digit', hour12: false
}));

const workdayPct = computed(() => wb.todayShift.value.percent);

/* ---------------- 今日任务 ---------------- */
const agendaLimit = ref(6);
const todayTasks = computed(() => wb.openTodayTasks.value);
const shownTasks = computed(() => todayTasks.value.slice(0, agendaLimit.value));

// Completing is the one moment in this list worth a flourish: the ring starts where the
// pointer already is. Un-checking gets nothing — undoing should be quiet.
function completeTask(task, event) {
  const wasDone = task.done;
  wb.toggleTodo(task.id);
  if (!wasDone) burstFrom(event.currentTarget);
}

/* ---------------- 专注 ---------------- */
function toggleFocus() { wb.toggleFocusTimer(); }

/* ---------------- 便签瀑布流 ---------------- */
function saveNote() {
  const d = noteDraft.value;
  if (!d.title.trim()) return;
  if (wb.saveNoteRecord({ id: d.id, title: d.title, body: d.body })) noteDraft.value.open = false;
}
// Greedy shortest-column packing keeps the visual masonry while the source order stays readable.
const noteColumns = computed(() => {
  const buckets = [[], [], []];
  const heights = [0, 0, 0];
  for (const note of wb.state.notes || []) {
    const height = 96 + Math.min(140, Math.ceil((note.body?.length || 0) / 26) * 18);
    const shortest = heights.indexOf(Math.min(...heights));
    buckets[shortest].push(note);
    heights[shortest] += height;
  }
  return buckets;
});

/* ---------------- 工作链接 ---------------- */
const linkDraft = ref({ open: false, title: '', url: '' });
// Shared by the split menu and the panel header so "添加工作链接" opens the same editor.
function startLink() {
  linkDraft.value = { open: true, title: '', url: '' };
  requestAnimationFrame(() => {
    document.querySelector('.workspace-links .inline-editor input')?.focus({ preventScroll: false });
  });
}
function saveLink() {
  if (wb.saveLinkRecord(linkDraft.value)) linkDraft.value = { open: false, title: '', url: '' };
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function initialOf(link) { return ([...String(link.title || hostOf(link.url) || 'L').trim()][0] || 'L').toUpperCase(); }

/* ---------------- 近 7 天 sparkline ---------------- */
const spark = computed(() => {
  const values = wb.rhythmStats.value.dailyStudy;
  const width = 280, height = 52, pad = 6;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, pad + (height - pad * 2) * (1 - v / max)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const active = max > 0;
  return { line, area, last: pts.at(-1), active, width, height };
});

/* 提醒 next */
const nextUpcoming = computed(() => wb.upcomingReminders.value.slice(0, 4));

/* 今日复盘：只读汇总，数字全部来自已有记录 */
const todayReview = computed(() => reviewFor(wb.todayStr.value, wb.state));
const reviewLine = computed(() => reviewHeadline(todayReview.value));
const reviewDone = computed(() =>
  todayReview.value.completed.length + todayReview.value.finishedElsewhere.length);

function relTime(ms) {
  const diff = ms - Date.now();
  if (diff <= 0) return '即将';
  const min = Math.ceil(diff / 60000);
  if (min < 60) return `${min} 分钟后`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} 小时后` : `${Math.ceil(h / 24)} 天后`;
}
function taskTime(task) {
  if (task.date && task.date < wb.todayStr.value) return `逾期 ${task.date.slice(5)}`;
  return task.time || (task.date ? '今天' : '随时');
}
</script>

<template>
  <div class="home page-shell">
    <!-- 今日主视觉 -->
    <section class="hero">
      <article class="hero-main panel glass rim">
        <div class="hero-kicker">
          <span class="live-dot" aria-hidden="true"></span>
          {{ wb.formattedDate.value }} <span class="dot-sep">·</span> {{ wb.greetingText.value }}
        </div>
        <h1 class="hero-title">今天，<br /><span>把重要的事做完。</span></h1>
        <p class="hero-sub">
          <template v-if="wb.overdueCount.value"><b>{{ wb.overdueCount.value }}</b> 项已逾期 · </template>
          {{ todayTasks.length ? `还有 ${todayTasks.length} 项待办，先完成最重要的一件。` : '还没有安排，先写下一件事。' }}
        </p>

        <div class="hero-brief">
          <div><span>下一件事</span><strong>{{ todayTasks[0]?.text || '还没有安排' }}</strong></div>
          <div><span>下个节点</span><strong>{{ nextUpcoming[0]?.label || '暂无提醒' }}</strong></div>
        </div>

        <form class="hero-capture" @submit.prevent="submitQuick">
          <img :src="asset('assets/icons/sparkles.svg')" alt="" />
          <input
            ref="quickInput"
            v-model="quickText"
            class="hero-input"
            maxlength="200"
            placeholder="写下一件事，回车保存（如：15:00 项目评审）"
            aria-label="快速添加今日任务"
          />
          <button class="btn btn-primary" type="submit">添加</button>
          <button class="btn btn-ghost btn-sm hero-detail" type="button" @click="emit('new-task')">详细</button>
        </form>

        <div class="hero-now" aria-label="当前时间">
          <span class="hero-now-label">NOW</span>
          <strong class="hero-now-time numeric">{{ heroNow }}</strong>
          <small>{{ wb.offWorkStatus.value.sub }}</small>
        </div>

        <div class="hero-meta" aria-label="今日概览">
          <div><span>今日待办</span><strong class="numeric">{{ todayTasks.length }}</strong></div>
          <div><span>逾期</span><strong class="numeric warn">{{ wb.overdueCount.value }}</strong></div>
          <div><span>专注</span><strong class="numeric">{{ wb.studyTodayMinutes.value }}<em>min</em></strong></div>
          <div><span>工时</span><strong class="numeric">{{ workdayPct }}<em>%</em></strong></div>
        </div>
      </article>

      <aside class="hero-side">
        <article class="panel glass rim focus-hero">
          <div class="panel-head">
            <span class="focus-kicker"><i aria-hidden="true"></i>专注</span>
            <button class="btn-icon" type="button" title="设置专注时长" @click="wb.goto('study')">
              <img :src="asset('assets/icons/sliders-horizontal.svg')" alt="" />
            </button>
          </div>
          <div class="focus-dial" :style="{ '--p': wb.focusProgressPct.value }">
            <div class="focus-dial-inner">
              <p class="focus-clock numeric">{{ wb.focusClockText.value }}</p>
              <small>FOCUS</small>
            </div>
          </div>
          <div class="focus-row">
            <button
              class="focus-play"
              type="button"
              :aria-label="wb.state.focus.running ? '暂停专注' : '开始专注'"
              @click="toggleFocus"
            >
              <img :src="asset(`assets/icons/${wb.state.focus.running ? 'pause' : 'play'}.svg`)" alt="" />
            </button>
            <span class="focus-label">{{ wb.linkedFocusTask.value?.text || wb.state.focus.text || '选择任务，或写下这段要做的事' }}</span>
          </div>
          <div class="focus-track"><i :style="{ transform: `scaleX(${wb.focusProgressPct.value / 100})` }"></i></div>
          <button class="btn btn-text btn-sm focus-more-link" type="button" @click="wb.goto('study')">打开专注页</button>
        </article>

        <article class="panel glass rim pulse-card">
          <p class="pulse-kicker">工作日 · {{ wb.offWorkStatus.value.kicker }}</p>
          <strong class="pulse-clock numeric">{{ wb.offWorkStatus.value.value }}</strong>
          <p class="pulse-sub">{{ wb.offWorkStatus.value.sub }}</p>
          <div class="pulse-actions">
            <button class="btn btn-soft btn-sm" type="button" @click="wb.breakOpen.value = true">休息一下</button>
            <button class="btn btn-primary btn-sm" type="button" @click="wb.goto('standup')">写日报</button>
          </div>
          <button class="pulse-link" type="button" @click="wb.goto('me')">排班与午休设置 <span aria-hidden="true">→</span></button>
        </article>
      </aside>
    </section>
    <section class="blocks">
      <div
        v-for="block in wb.blocks.value"
        :key="block.id"
        class="block"
        :class="[`span-${block.span}`, `block-${block.id}`]"
      >        <!-- 今日任务 -->
        <section v-if="block.id === 'tasks'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">
              <img :src="asset('assets/icons/list-checks.svg')" alt="" />今日任务
              <span class="badge">{{ todayTasks.length }}</span>
            </h2>
            <div class="panel-actions">
              <button class="btn btn-text btn-sm" type="button" @click="wb.goto('todo', 'all')">
                全部计划<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
              </button>
            </div>
          </div>

          <div v-if="!todayTasks.length" class="empty">
            <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/leaf.svg')" alt="" /></span>
            <strong>今天还没有待办</strong>
            <p>在上方输入框写下会议、文档或项目事项，回车即可保存。</p>
            <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">添加今日任务</button>
          </div>

          <div v-else class="agenda">
            <article v-for="task in shownTasks" :key="task.id" class="agenda-row" :class="{ done: task.done }">
              <button
                class="agenda-check"
                type="button"
                :aria-label="`完成${task.text}`"
                :aria-pressed="task.done"
                @click="completeTask(task, $event)"
              >
                <img :src="asset('assets/icons/check.svg')" alt="" />
              </button>
              <div class="agenda-copy">
                <strong>{{ task.text }}</strong>
                <small>
                  <span class="prio" :class="task.priority" aria-hidden="true"></span>
                  {{ { high: '高优先级', medium: '中优先级', low: '低优先级' }[task.priority] || '中优先级' }}
                  · {{ task.tag || '个人计划' }}
                  <time class="agenda-time" :class="{ overdue: task.date && task.date < wb.todayStr.value }">{{ taskTime(task) }}</time>
                </small>
              </div>
              <span class="agenda-actions">
                <button class="btn-icon" type="button" title="设为专注任务" :aria-label="`专注${task.text}`" @click="wb.linkTaskToFocus(task.id, true)">
                  <img :src="asset('assets/icons/play.svg')" alt="" />
                </button>
                <button class="btn-icon" type="button" title="编辑任务" :aria-label="`编辑${task.text}`" @click="emit('new-task', task)">
                  <img :src="asset('assets/icons/pencil.svg')" alt="" />
                </button>
                <button class="btn-icon is-danger" type="button" title="删除任务" :aria-label="`删除${task.text}`" @click="wb.deleteTodo(task.id)">
                  <img :src="asset('assets/icons/trash.svg')" alt="" />
                </button>
              </span>
            </article>
          </div>

          <footer v-if="todayTasks.length > agendaLimit" class="panel-foot">
            <button class="btn btn-text btn-sm" type="button" @click="agendaLimit += 6">
              查看其余 {{ todayTasks.length - agendaLimit }} 项
            </button>
          </footer>
        </section>

        <!-- 接下来 -->
        <section v-else-if="block.id === 'reminders'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">接下来</h2>
            <span class="panel-sub">{{ wb.activeAlerts.value.length ? `${wb.activeAlerts.value.length} 条待知悉` : '暂无待知悉' }}</span>
          </div>
          <ol v-if="nextUpcoming.length" class="upcoming">
            <li v-for="item in nextUpcoming" :key="`${item.sourceKind}:${item.sourceId}`" class="upcoming-row">
              <span class="up-dot" aria-hidden="true"></span>
              <span class="up-copy"><strong>{{ item.label }}</strong><small>{{ relTime(item.dueAt) }}</small></span>
            </li>
          </ol>
          <EmptyState
            v-else
            icon="alarm-clock"
            title="暂无提醒"
            text="添加会议、截止或休息提醒。"
            action-label="添加提醒"
            @action="wb.goto('calendar')"
          />
          <button class="btn btn-text btn-sm" type="button" @click="wb.goto('calendar')">查看全部提醒</button>
        </section>

        <!-- 工作便签（瀑布流） -->
        <section v-else-if="block.id === 'notes'" class="panel glass rim card notes-panel">
          <div class="panel-head">
            <h2 class="panel-title"><img :src="asset('assets/icons/sticky-note.svg')" alt="" />工作便签 <span class="badge">{{ wb.state.notes.length }}</span></h2>
            <div class="panel-actions">
              <button class="btn btn-text btn-sm" type="button" @click="startNote()">
                <img :src="asset('assets/icons/plus.svg')" alt="" />新建
              </button>
            </div>
          </div>

          <form v-if="noteDraft.open" class="inline-editor" @submit.prevent="saveNote">
            <input v-model="noteDraft.title" class="input" maxlength="120" required placeholder="便签标题" />
            <textarea v-model="noteDraft.body" class="input" maxlength="5000" rows="3" placeholder="记下会议要点、待核对的想法…"></textarea>
            <div class="inline-editor-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="noteDraft.open = false">取消</button>
              <button class="btn btn-primary btn-sm" type="submit">保存便签</button>
            </div>
          </form>

          <EmptyState
            v-if="!wb.state.notes.length"
            icon="sticky-note"
            title="还没有便签"
            text="记下会议要点、待核对的想法，随时回来看。"
            action-label="新建便签"
            @action="startNote()"
          />
          <div v-else class="masonry">
            <div v-for="(column, ci) in noteColumns" :key="ci" class="masonry-col">
              <article v-for="note in column" :key="note.id" class="note card card-hover">
                <div class="note-head">
                  <h4>{{ note.title }}</h4>
                  <span class="note-tools">
                    <button class="btn-icon btn-xs" type="button" aria-label="编辑便签" @click="startNote(note)">
                      <img :src="asset('assets/icons/pencil.svg')" alt="" />
                    </button>
                    <button class="btn-icon btn-xs is-danger" type="button" aria-label="删除便签" @click="wb.removeNoteRecord(note.id)">
                      <img :src="asset('assets/icons/trash.svg')" alt="" />
                    </button>
                  </span>
                </div>
                <p v-if="note.body" class="note-body">{{ note.body }}</p>
              </article>
            </div>
          </div>
        </section>

        <!-- 工作链接 -->
        <section v-else-if="block.id === 'links'" class="panel glass rim card workspace-links">
          <div class="panel-head">
            <h2 class="panel-title"><img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />工作链接 <span class="badge">{{ wb.state.links.length }}</span></h2>
            <button class="btn btn-text btn-sm" type="button" @click="linkDraft.open ? (linkDraft.open = false) : startLink()">
              <img :src="asset('assets/icons/plus.svg')" alt="" />添加
            </button>
          </div>

          <form v-if="linkDraft.open" class="inline-editor" @submit.prevent="saveLink">
            <div class="inline-two">
              <input v-model="linkDraft.title" class="input" maxlength="80" required placeholder="名称，如：项目文档" />
              <input v-model="linkDraft.url" class="input" type="url" maxlength="2000" required placeholder="https://" />
            </div>
            <div class="inline-editor-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="linkDraft.open = false">取消</button>
              <button class="btn btn-primary btn-sm" type="submit">保存链接</button>
            </div>
          </form>

          <EmptyState
            v-if="!wb.state.links.length"
            icon="arrow-up-right"
            title="还没有快捷链接"
            text="把常用的文档、看板或后台添加到这里。"
            action-label="添加链接"
            @action="startLink"
          />
          <div v-else class="link-grid">
            <a
              v-for="link in wb.state.links"
              :key="link.id"
              class="link-card card card-hover"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="link.url"
            >
              <span class="link-initial" aria-hidden="true">{{ initialOf(link) }}</span>
              <span class="link-copy">
                <strong>{{ link.title }}</strong>
                <small>{{ hostOf(link.url) }}</small>
              </span>
              <button class="btn-icon btn-xs is-danger link-del" type="button" aria-label="删除链接" @click.prevent.stop="wb.removeLinkRecord(link.id)">
                <img :src="asset('assets/icons/trash.svg')" alt="" />
              </button>
            </a>
          </div>
        </section>

        <!-- 本月收支 -->
        <section v-else-if="block.id === 'ledger'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">本月收支</h2>
            <button class="btn btn-text btn-sm" type="button" @click="wb.goto('ledger')">
              记一笔<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
            </button>
          </div>
          <div class="month-grid">
            <div><small>收入</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.income.toFixed(2) }}</strong></div>
            <div><small>支出</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.expense.toFixed(2) }}</strong></div>
            <div><small>结余</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.balance.toFixed(2) }}</strong></div>
          </div>
        </section>

        <!-- 近 7 天 -->
        <section v-else-if="block.id === 'rhythm'" class="panel glass rim card">
          <div class="panel-head"><h2 class="panel-title">近 7 天</h2></div>
          <div class="rhythm-grid">
            <div><small>运动</small><strong class="numeric">{{ wb.rhythmStats.value.sportCount }}<em>次</em></strong></div>
            <div><small>专注</small><strong class="numeric">{{ wb.rhythmStats.value.studyTotalMin }}<em>分钟</em></strong></div>
            <div><small>完成</small><strong class="numeric">{{ wb.rhythmStats.value.doneCount }}<em>件</em></strong></div>
          </div>
          <div class="spark" role="img" aria-label="近 7 天每日专注趋势">
            <svg :viewBox="`0 0 ${spark.width} ${spark.height}`" preserveAspectRatio="none">
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--brand)" stop-opacity=".26" />
                  <stop offset="100%" stop-color="var(--brand)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path v-if="spark.active" :d="spark.area" fill="url(#sparkFill)" />
              <path :d="spark.line" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :opacity="spark.active ? 1 : .4" />
              <circle v-if="spark.active" :cx="spark.last[0]" :cy="spark.last[1]" r="2.6" fill="var(--brand)" />
            </svg>
          </div>
        </section>

        <section v-else-if="block.id === 'review'" class="panel glass rim card review-card">
          <div class="panel-head">
            <h2 class="panel-title">今日复盘</h2>
            <button class="btn btn-text btn-sm" type="button" @click="wb.goto('calendar')">看日历</button>
          </div>
          <p class="review-line">{{ todayReview.empty ? '完成一件事、记一笔或专注一次，今天的复盘会出现在这里。' : reviewLine }}</p>
          <div class="review-grid">
            <div><small>完成</small><strong class="numeric">{{ reviewDone }}<em>件</em></strong></div>
            <div><small>未完成</small><strong class="numeric">{{ todayReview.open.length }}<em>件</em></strong></div>
            <div><small>专注</small><strong class="numeric">{{ todayReview.focusMinutes }}<em>分</em></strong></div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 头部 */
.home-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.home-greeting { min-width: 0; }
.home-greeting h1 { font-size: 32px; font-weight: 800; letter-spacing: -.028em; line-height: 1.16; }
.greeting-sub { margin-top: 8px; font-size: var(--text-body); color: var(--muted); max-width: 62ch; }
.greeting-sub strong { color: var(--ink); font-weight: 700; }
.greeting-sub .warn { color: var(--coral); }

/* Split Button 快速添加 */
.quick-add { display: flex; align-items: center; gap: 10px; flex: 1 1 380px; max-width: 560px; min-width: 0; }
.quick-input {
  flex: 1; min-width: 0; min-height: 46px; padding: 10px 15px;
  border: 1px solid var(--line-strong); border-radius: var(--radius-control);
  background: var(--surface); font-size: var(--text-body); box-shadow: var(--shadow-sm);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.quick-input:focus { outline: none; border-color: var(--brand); box-shadow: var(--ring); }
.split-wrap { position: relative; display: inline-flex; flex: 0 0 auto; border-radius: var(--radius-control); box-shadow: var(--shadow-brand); }
.split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; padding-right: 14px; min-height: 46px; box-shadow: none; }
.split-caret { width: 42px; min-width: 42px; padding: 0; margin-left: -1px; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-color: rgb(255 255 255 / .28); min-height: 46px; box-shadow: none; }
.split-caret img { width: 15px; height: 15px; transition: transform var(--motion-base) var(--ease-spring); }
.split-wrap.is-open .split-caret img { transform: rotate(180deg); }
.split-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
  min-width: 274px; padding: 6px; border-radius: 16px;
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  animation: menu-pop var(--motion-fast) var(--ease-out);
}
@keyframes menu-pop { from { opacity: 0; transform: translateY(-5px) scale(.98); } to { opacity: 1; transform: none; } }
.split-menu button {
  display: flex; align-items: center; gap: 11px; width: 100%;
  min-height: 42px; padding: 7px 10px; border: 0; border-radius: 10px;
  background: transparent; color: var(--ink); text-align: left; font-size: var(--text-body);
  transition: background-color var(--motion-fast), color var(--motion-fast);
}
.split-menu button:hover { background: var(--brand-pale); color: var(--brand-deep); }
.split-menu img { width: 18px; height: 18px; opacity: .7; flex: 0 0 18px; }
.split-menu span { display: flex; flex-direction: column; min-width: 0; }
.split-menu small { font-size: var(--text-2xs); color: var(--muted); font-weight: 400; }

/* KPI */
/* KPI cards stretch to fill the row: four fixed columns on a 1900px page left each card 450px
   wide for one number. auto-fit with a sensible min keeps them dense on wide screens and folds
   to two columns on a phone. */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
  gap: var(--shell-gap);
}
.kpi {
  display: flex; flex-direction: column; gap: 0;
  padding: 16px 18px; text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--surface) var(--glass-alpha), transparent);
  background-image: linear-gradient(var(--glass-veil), var(--glass-veil));
  box-shadow: var(--shadow-sm), inset 0 1px 0 var(--glass-rim);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  min-height: 122px;
}
button.kpi { cursor: pointer; }
.kpi .icon-tile { width: 28px; height: 28px; flex-basis: 28px; border-radius: 0; background: transparent; border: 0; box-shadow: none; }
.kpi .icon-tile img { width: 18px; height: 18px; opacity: .55; }
.kpi-top { display: flex; align-items: center; gap: 9px; min-width: 0; margin-bottom: 12px; }
.kpi-label { font-size: var(--text-sm); font-weight: 600; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kpi-action {
  margin-left: auto; flex: 0 0 auto;
  min-height: 26px; padding: 0 9px; border-radius: 8px;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--brand-deep); font-size: var(--text-meta); font-weight: 650;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.kpi-action:hover { background: var(--brand-pale); border-color: var(--brand); }
.kpi-body { display: flex; align-items: center; gap: 11px; margin-top: auto; min-width: 0; }
.kpi-value { display: flex; align-items: baseline; gap: 5px; min-width: 0; flex-wrap: wrap; }
.kpi-value b { font-size: var(--text-h1); font-weight: 800; letter-spacing: -.03em; line-height: 1.05; white-space: nowrap; }
.kpi-value em { font-style: normal; font-size: var(--text-meta); color: var(--muted); font-weight: 550; white-space: nowrap; }
.kpi.is-quiet .kpi-value b { font-size: var(--text-lg); font-weight: 700; letter-spacing: -.01em; color: var(--ink-soft); }
.kpi-bar { display: block; height: 4px; margin-top: 12px; border-radius: 99px; background: var(--line); overflow: hidden; }
.kpi-bar i { display: block; width: 100%; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--brand), var(--lime)); transform-origin: left center; transition: transform var(--motion-slow) var(--ease-out); }
.kpi-sub { margin-top: 8px; font-size: var(--text-meta); color: var(--muted); line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 模块工具条 */
.blocks-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
.blocks-hint { display: flex; align-items: center; gap: 7px; font-size: var(--text-meta); color: var(--muted); }
.blocks-hint img { width: 15px; height: 15px; opacity: .55; }
.blocks-actions { display: flex; align-items: center; gap: 4px; }

/* 积木网格：12 列栅格 */
/* align-items:start lets each block keep its own height instead of stretching to match the
   tallest sibling in the same grid row. Without it an empty panel in a row with a tall
   neighbour rendered as a large blank rectangle. */
.blocks {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--shell-gap);
  align-items: start;
  grid-auto-flow: row dense;
}
.block { grid-column: span 4; min-width: 0; border-radius: var(--radius-card); transition: opacity var(--motion-fast); }
.block.span-4 { grid-column: span 4; }
.block.span-6 { grid-column: span 6; }
/* span-8 was missing from this list, so every 8-column block (today's tasks, notes, links)
   silently fell back to the 4-column default and left the right half of the row unused. */
.block.span-8 { grid-column: span 8; }
/* A panel showing only an empty state should not claim span-8 of a 1900px page. When the
   viewport is wide, let those blocks shrink to a third so the row fills with content-bearing
   neighbours instead of blank rectangles. The task block is exempt: it is the page's primary
   surface and stays wide even when empty, because that is where new work is added. */
@media (min-width: 1400px) {
  .block:has(> section > .empty):not(.block-tasks) { grid-column: span 4; }
}
.block.span-12 { grid-column: span 12; }
.block.is-dragging { opacity: .45; }
.block.is-drop { outline: 2px dashed var(--brand); outline-offset: 4px; }
.block-tools {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 8px; padding: 6px 8px;
  border: 1px dashed var(--line-strong); border-radius: var(--radius-control);
  background: var(--surface-soft); cursor: grab;
}
.drag-handle { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-meta); font-weight: 600; color: var(--muted); margin-right: auto; }
.drag-handle img { width: 14px; height: 14px; }

/* 任务列表 */
/* auto-FILL, not auto-fit: auto-fit collapses the empty tracks, so a single task stretched to
   the full panel width — which is exactly the "one line, mostly empty" problem this grid was
   meant to fix. auto-fill keeps the column width and lets the second column sit empty until
   there is something to put in it. */
.agenda {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 8px;
}
.agenda-row {
  display: grid; grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center; gap: 12px; padding: 12px 14px;
  border: 1px solid var(--line); border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface) 62%, transparent);
  transition: border-color var(--motion-fast), background-color var(--motion-fast),
    transform var(--motion-fast) var(--ease-out);
}
.agenda-row:hover {
  border-color: color-mix(in srgb, var(--brand) 26%, var(--line));
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  transform: translateY(-1px);
}
.agenda-check {
  width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center;
  padding: 0; border: 1px solid var(--line-strong); border-radius: 11px;
  background: var(--surface);
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.agenda-check img { width: 14px; height: 14px; opacity: 0; }
.agenda-check:hover { border-color: var(--brand); background: var(--brand-pale); }
.agenda-row.done .agenda-check { background: var(--cta-bg); border-color: var(--cta-bg); }
.agenda-row.done .agenda-check img { opacity: 1; filter: brightness(0) invert(1); }
.agenda-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.agenda-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; line-height: 1.5; }
.agenda-row.done .agenda-copy strong { text-decoration: line-through; color: var(--muted); }
/* Wrapping matters: as a non-wrapping flex row, a narrow cell squeezed priority / tag / time
   each into their own column, so the meta line read vertically one character at a time. */
.agenda-copy small {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: var(--text-meta); color: var(--muted); min-width: 0; line-height: 1.5;
}
.prio { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.prio.high { background: var(--coral); }
.prio.medium { background: var(--amber); }
.prio.low { background: var(--brand); }
.agenda-time { margin-left: auto; font-size: var(--text-meta); color: var(--muted); white-space: nowrap; flex: 0 0 auto; }
.agenda-time.overdue { color: var(--coral); font-weight: 600; }
.agenda-actions { display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity var(--motion-fast); }
/* Same rule as the habit rows: no hover on touch, so the buttons must stay visible there. */
@media (hover: hover) {
  .agenda-row:hover .agenda-actions,
  .agenda-row:focus-within .agenda-actions { opacity: 1; }
}
@media (hover: none) {
  .agenda-actions { opacity: 1; }
}
.agenda-actions .btn-icon { width: 32px; height: 32px; flex-basis: 32px; }
.agenda-actions .btn-icon img { width: 15px; height: 15px; }
.panel-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }

/* 专注卡 */
.focus-card { background-color: color-mix(in srgb, var(--brand-pale) 74%, var(--surface) 26%); border-color: color-mix(in srgb, var(--brand) 20%, var(--line)); }
.focus-kicker { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-sm); font-weight: 700; color: var(--brand-deep); }
.focus-kicker i { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.focus-clock { font-size: 40px; font-weight: 650; letter-spacing: -.03em; line-height: 1.1; margin: 10px 0 12px; }
.focus-row { display: flex; align-items: center; gap: 11px; min-width: 0; }
.focus-play {
  width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center;
  border: 1px solid var(--cta-bg); border-radius: 12px; background: var(--cta-bg); color: #fff;
  transition: transform var(--motion-fast) var(--ease-spring), background-color var(--motion-fast);
}
.focus-play:hover { background: var(--cta-bg-hover); transform: scale(1.04); }
.focus-play img { width: 16px; height: 16px; filter: brightness(0) invert(1); }
.focus-label { font-size: var(--text-sm); color: var(--ink-soft); min-width: 0; overflow-wrap: anywhere; line-height: 1.45; }
.focus-track { height: 3px; margin-top: 14px; border-radius: 99px; background: color-mix(in srgb, var(--brand) 16%, transparent); overflow: hidden; }
.focus-track i { display: block; width: 100%; height: 100%; background: var(--brand); transform-origin: left center; transition: transform var(--motion-slow) linear; }
.focus-more-link { margin-top: 8px; align-self: flex-start; }

/* 接下来 */
.upcoming { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; }
.upcoming-row { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.upcoming-row:last-child { border-bottom: 0; }
.up-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 3px var(--brand-pale); }
.up-copy { display: flex; flex-direction: column; min-width: 0; }
.up-copy strong { font-size: var(--text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-copy small { font-size: var(--text-2xs); color: var(--muted); }

/* 便签瀑布流 */
.notes-panel .masonry { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.masonry-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.note { padding: 13px 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); }
.note-head { display: flex; align-items: flex-start; gap: 8px; }
.note-head h4 { flex: 1; min-width: 0; font-size: var(--text-body); font-weight: 650; overflow-wrap: anywhere; line-height: 1.45; }
.note-tools { display: flex; gap: 1px; opacity: 0; transition: opacity var(--motion-fast); }
.note:hover .note-tools, .note:focus-within .note-tools { opacity: 1; }
.btn-xs { width: 26px; height: 26px; flex-basis: 26px; border-radius: 7px; }
.btn-xs img { width: 13px; height: 13px; }
.note-body { margin-top: 6px; font-size: var(--text-meta); color: var(--ink-soft); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.inline-editor { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--surface-soft); }
.inline-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 9px; }
.inline-editor-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* 工作链接 */
.link-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.link-card {
  position: relative; display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface-soft); text-decoration: none; color: var(--ink); min-width: 0;
}
.link-initial {
  width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center;
  border-radius: 9px; background: var(--surface); border: 1px solid var(--line);
  font-size: var(--text-sm); font-weight: 700; color: var(--ink-soft);
}
.link-copy { display: flex; flex-direction: column; min-width: 0; }
.link-copy strong { font-size: var(--text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-copy small { font-size: var(--text-2xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-del { position: absolute; top: 4px; right: 4px; opacity: 0; transition: opacity var(--motion-fast); }
.link-card:hover .link-del, .link-card:focus-within .link-del { opacity: 1; }

/* 收支 / 趋势 */
.month-grid, .rhythm-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.month-grid > div, .rhythm-grid > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.month-grid > div + div, .rhythm-grid > div + div { padding-left: 10px; border-left: 1px solid var(--line); }
.month-grid small, .rhythm-grid small { font-size: var(--text-meta); color: var(--muted); }
.month-grid strong, .rhythm-grid strong { font-size: var(--text-body); font-weight: 650; overflow-wrap: anywhere; }
.rhythm-grid em { font-style: normal; font-size: var(--text-meta); color: var(--muted); margin-left: 2px; font-weight: 400; }
.review-line { margin: -2px 0 12px; font-size: var(--text-body); color: var(--muted); }
.review-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.review-grid > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.review-grid > div + div { padding-left: 10px; border-left: 1px solid var(--line); }
.review-grid small { font-size: var(--text-2xs); color: var(--muted); }
.review-grid strong { font-size: 20px; font-weight: 750; letter-spacing: -.02em; }
.review-grid em { font-style: normal; margin-left: 2px; font-size: 11px; font-weight: 500; color: var(--muted); }
.review-empty { margin-top: 10px; font-size: var(--text-meta); color: var(--muted); line-height: 1.55; }.spark { margin-top: 12px; }
.spark svg { display: block; width: 100%; height: 54px; }

/* 今日头部与紧凑状态条 */
.today-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.today-eyebrow { font-size: var(--text-sm); font-weight: 600; color: var(--muted); letter-spacing: .02em; }
.today-eyebrow span { margin: 0 6px; opacity: .5; }
.today-copy h1 { display: flex; align-items: center; gap: 10px; margin-top: 4px; font-size: var(--text-hero); font-weight: 800; letter-spacing: -.03em; line-height: 1.1; }
.today-badge {
  display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 8px;
  border-radius: 9px; background: var(--brand-pale); color: var(--brand-deep);
  font-size: var(--text-body); font-weight: 750; letter-spacing: 0;
}
.today-sub { margin-top: 7px; max-width: 62ch; font-size: var(--text-body); color: var(--muted); }
.today-sub b { color: var(--coral); font-weight: 700; }
.today-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.today-board { display: flex; flex-direction: column; gap: 12px; }
.today-board .quick-add { flex: 1 1 auto; max-width: none; width: 100%; }
.quick-lead { width: 19px; height: 19px; flex: 0 0 19px; margin-left: 4px; opacity: .5; }
.stat-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.stat {
  position: relative; display: flex; flex-direction: column; gap: 3px; min-width: 0;
  padding: 12px 14px; text-align: left;
  border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface);
}
button.stat { cursor: pointer; }
.stat:hover { border-color: var(--line-strong); }
.stat-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-meta); font-weight: 600; color: var(--muted); }
.stat-head > img { width: 14px; height: 14px; flex: 0 0 14px; opacity: .55; }
.stat-head > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat-action {
  margin-left: auto; min-height: 24px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--brand-deep); font-size: var(--text-2xs); font-weight: 650;
}
.stat-action:hover { background: var(--brand-pale); border-color: var(--brand); }
.stat-body { display: flex; align-items: center; gap: 8px; min-width: 0; }
.stat-value { display: flex; align-items: baseline; gap: 4px; min-width: 0; flex-wrap: wrap; }
.stat-value b { font-size: 24px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; white-space: nowrap; }
.stat-value em { font-style: normal; font-size: var(--text-2xs); font-weight: 550; color: var(--muted); white-space: nowrap; }
.stat-track { display: block; height: 3px; margin-top: 4px; border-radius: 99px; background: var(--line); overflow: hidden; }
.stat-track i { display: block; width: 100%; height: 100%; border-radius: 99px; background: var(--brand); transform-origin: left center; transition: transform var(--motion-slow) var(--ease-out); }
.stat-sub { font-size: var(--text-2xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat.is-quiet .stat-value b { font-size: var(--text-lg); font-weight: 700; color: var(--ink-soft); }
/* ========== 新一代工作台视觉 ========== */
.hero { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(290px, .72fr); gap: 16px; }
.hero-main {
  position: relative; display: flex; flex-direction: column; min-height: 0;
  padding: 34px 36px 26px; overflow: hidden; border-radius: 28px;
}
.hero-main::after {
  content: ""; position: absolute; inset: auto -10% -45% 35%; height: 420px; pointer-events: none;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--brand) 26%, transparent), transparent 72%);
  filter: blur(10px);
}
.hero-kicker { display: flex; align-items: center; gap: 9px; font-size: 12.5px; font-weight: 600; letter-spacing: .04em; color: var(--muted); }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 14%, transparent); }
.dot-sep { opacity: .4; }
.hero-title { margin: 28px 0 12px; font-family: var(--font-display); font-size: clamp(42px, 4.4vw, 64px); font-weight: 600; line-height: 1.02; letter-spacing: -.045em; }
.hero-title span { display: block; margin-top: 8px; font-size: .62em; font-weight: 500; letter-spacing: -.03em; color: var(--muted); }
.hero-brief { display: flex; gap: 30px; margin-top: 22px; max-width: 72%; }
.hero-brief > div { min-width: 0; padding-left: 14px; border-left: 1px solid rgb(255 255 255 / .16); display: flex; flex-direction: column; gap: 3px; }
.hero-brief span { font-size: 11px; letter-spacing: .12em; color: rgb(235 247 238 / .45); }
.hero-brief strong { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; color: #eef7ee; }
.hero-sub { max-width: 48ch; color: var(--muted); font-size: 13.5px; line-height: 1.7; }
.hero-sub b { color: var(--coral); }
.hero-capture {
  display: flex; align-items: center; gap: 7px; margin-top: 26px; padding: 7px 7px 7px 14px;
  border: 1px solid var(--line); border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 66%, transparent);
  backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%);
}
.hero-capture > img { width: 17px; height: 17px; flex: 0 0 17px; opacity: .48; }
.hero-input { flex: 1; min-width: 0; height: 38px; border: 0; background: transparent; outline: none; font-size: 13.5px; }
.hero-detail { flex: 0 0 auto; }
.hero-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 21px; padding-top: 17px; border-top: 1px solid var(--line); }
.hero-meta > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hero-meta span { font-size: 11.5px; color: var(--muted); letter-spacing: .04em; }
.hero-meta strong { font-size: 25px; font-weight: 750; letter-spacing: -.035em; line-height: 1.1; }
.hero-meta strong.warn { color: var(--coral); }
.hero-meta em { margin-left: 2px; font-size: 11px; font-style: normal; font-weight: 500; color: var(--muted); }
.hero-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.focus-hero { display: flex; flex-direction: column; gap: 4px; padding: 20px; flex: 1; min-height: 0; }
.focus-hero .focus-clock { font-size: clamp(44px, 4.4vw, 64px); }
.focus-hero .focus-row { margin-top: 2px; }
.focus-hero .focus-more-link { align-self: flex-start; margin-top: auto; padding-left: 0; }
.pulse-card { padding: 17px 20px 18px; }
.pulse-kicker { font-size: 12.5px; font-weight: 650; letter-spacing: .02em; color: var(--muted); }
.pulse-clock { display: block; margin: 4px 0 2px; font-size: 28px; font-weight: 750; letter-spacing: -.035em; line-height: 1.15; }
.pulse-sub { font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.pulse-actions { display: flex; gap: 8px; margin-top: 11px; }
.pulse-link { margin-top: 10px; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 11.5px; text-align: left; }
.pulse-link:hover { color: var(--brand-deep); }
.pulse-actions .btn { flex: 1; }
.blocks { align-items: stretch; gap: 16px; }
.block { transition: none; }
.block > .panel { height: 100%; }
.blocks .span-4 { grid-column: span 4; }
.blocks .span-8 { grid-column: span 8; }
@media (max-width: 1100px) {
  .hero { grid-template-columns: 1fr; }
  .hero-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hero-main { min-height: 360px; }
}
@media (prefers-reduced-motion: reduce) { .hero-main::before { animation: none; } }

@media (max-width: 760px) {
  .hero-main { min-height: 0; padding: 24px 22px 20px; border-radius: 22px; }
  .hero-title { margin-top: 20px; font-size: 40px; }
  .hero-title span { font-size: .56em; }
  .hero-capture { flex-wrap: wrap; padding: 7px; }
  .hero-input { flex-basis: calc(100% - 26px); height: 34px; }
  .hero-capture .btn-primary { flex: 1; }
  .hero-detail { flex: 0 0 auto; }
  .hero-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
  .hero-meta strong { font-size: 22px; }
  .hero-side { grid-template-columns: 1fr; }
  .focus-hero { min-height: 260px; }
  .blocks { gap: 12px; }
}
/* ---- 深度视觉层：暗色主视觉 + 光晕 + 专注表盘 ---- */
@keyframes hero-glow {
  from { transform: translate3d(-3%, -2%, 0) scale(.96); opacity: .75; }
  to { transform: translate3d(4%, 3%, 0) scale(1.08); opacity: 1; }
}

.hero-main.panel.glass {
  background:
    radial-gradient(ellipse 60% 80% at 82% 0%, rgb(184 215 133 / .20), transparent 60%),
    linear-gradient(135deg, rgb(14 45 36 / .94), rgb(22 60 48 / .90) 55%, rgb(30 79 62 / .86));
  color: #eef7ee;
  border-color: rgb(184 215 133 / .20);
  box-shadow: 0 20px 50px -42px rgb(3 22 16 / .35), inset 0 1px 0 rgb(255 255 255 / .16);
  backdrop-filter: blur(24px) saturate(135%); -webkit-backdrop-filter: blur(24px) saturate(135%);
}
.hero-main::before {
  content: ""; position: absolute; width: 380px; height: 380px; right: 4%; top: -28%;
  background: radial-gradient(circle, rgb(184 215 133 / .22), transparent 66%);
  filter: blur(14px); pointer-events: none;
  animation: hero-glow 16s ease-in-out infinite alternate;
}
.hero-main::after {
  background: radial-gradient(closest-side, rgb(184 215 133 / .18), transparent 70%);
}
.hero-kicker, .hero-sub { color: rgb(235 247 238 / .62); }
.hero-kicker { position: relative; z-index: 1; }
.hero-title { position: relative; z-index: 1; max-width: 62%; color: #f4faf3; }
.hero-title span { color: #c9e6b8; }
.hero-sub b { color: #d7f0a8; }
.hero-capture {
  position: relative; z-index: 1; border-color: rgb(255 255 255 / .16);
  background: rgb(255 255 255 / .08);
  backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);
}
.hero-capture > img { opacity: .7; filter: brightness(0) invert(1); }
.hero-input { color: #f4faf3; }
.hero-input::placeholder { color: rgb(235 247 238 / .44); }
.hero-capture .btn-primary { background: #d4efa9; border-color: #d4efa9; color: #102a20; }
.hero-capture .btn-primary:hover:not(:disabled) { background: #e3f7c2; border-color: #e3f7c2; }
.hero-capture .btn-ghost { color: rgb(235 247 238 / .76); }
.hero-meta { position: relative; z-index: 1; border-color: rgb(255 255 255 / .14); }
.hero-meta span, .hero-meta em { color: rgb(235 247 238 / .52); }
.hero-meta strong { color: #f4faf3; }
.hero-meta strong.warn { color: #f0b7a4; }
.hero-now { position: absolute; right: 34px; top: 98px; z-index: 1; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
.hero-now::after {
  content: ""; position: absolute; right: -18px; top: -34px; width: 150px; height: 150px;
  border: 1px solid rgb(184 215 133 / .18); border-radius: 50%; pointer-events: none;
}
.hero-now-label { font-size: 13px; letter-spacing: .1em; color: rgb(235 247 238 / .42); }
.hero-now-time { font-size: clamp(48px, 4.4vw, 68px); font-weight: 600; letter-spacing: -.06em; line-height: 1; color: #f4faf3; }
.hero-now small { max-width: 170px; font-size: 11px; line-height: 1.45; color: rgb(235 247 238 / .52); }
.focus-dial {
  width: 158px; height: 158px; margin: 8px auto 2px; padding: 5px; border-radius: 50%;
  display: grid; place-items: center;
  background: conic-gradient(var(--brand) calc(var(--p, 0) * 1%), color-mix(in srgb, var(--line) 72%, transparent) 0);
  box-shadow: 0 10px 30px -24px color-mix(in srgb, var(--brand) 28%, transparent);
}
.focus-dial-inner { width: 100%; height: 100%; border-radius: 50%; display: grid; place-items: center; align-content: center; background: color-mix(in srgb, var(--surface) 42%, transparent); border: 1px solid rgb(255 255 255 / .38); }
.focus-hero .focus-clock { margin: 0; font-size: 44px; line-height: 1; }
.focus-dial small { margin-top: 5px; font-size: 13px; letter-spacing: .08em; color: var(--muted); }
@media (hover: hover) {
  .panel.glass { transition: transform .35s var(--ease-out), box-shadow .35s var(--ease-out), border-color .35s var(--ease-out); }
  .panel.glass:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--brand) 26%, var(--line-strong)); box-shadow: 0 28px 70px -38px rgb(9 40 30 / .42), inset 0 1px 0 rgb(255 255 255 / .6); }
  .focus-hero:hover, .pulse-card:hover { transform: translateY(-2px); }
}
@media (max-width: 1100px) {
  .hero-now { right: 28px; top: 40px; }
  .hero-title { max-width: 70%; }
}
@media (prefers-reduced-motion: reduce) { .hero-main::before { animation: none; } }

@media (max-width: 760px) {
  .hero-now { display: none; }
  .hero-title { max-width: 100%; }
  .focus-dial { width: 148px; height: 148px; }
  .focus-hero .focus-clock { font-size: 38px; }
}
/* 响应式 */
@media (max-width: 1280px) {
  .kpi-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .block.span-4 { grid-column: span 6; }
  .block.span-8 { grid-column: span 12; }
}
@media (max-width: 1080px) {
  .notes-panel .masonry { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .block, .block.span-4, .block.span-6, .block.span-8, .block.span-12 { grid-column: span 12; }
  .agenda { grid-template-columns: minmax(0, 1fr); }
  .home-greeting h1 { font-size: var(--text-h1); }
}
@media (max-width: 640px) {
  .quick-add { flex-basis: 100%; max-width: none; flex-wrap: nowrap; }
  .quick-input { flex: 1 1 0; width: auto; }
  .split-wrap { flex: 0 0 auto; }
  .today-copy h1 { font-size: 28px; }
  .today-actions { width: 100%; }
  .today-actions .btn { flex: 1; }
  .quick-lead { display: none; }
  .note-tools, .link-del { opacity: 1; }
  .btn-xs { min-width: 36px; min-height: 36px; }
  .stat { padding: 10px 12px; }
  .stat-value b { font-size: 21px; }
  .stat-sub { font-size: 11px; }
  .blocks-hint { display: none; }
  .blocks-bar { display: none; }
  .notes-panel .masonry { grid-template-columns: minmax(0, 1fr); }
  .agenda-row { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .agenda-check { width: 44px; height: 44px; flex-basis: 44px; grid-row: 1 / 3; }
  .agenda-actions { grid-column: 2 / -1; }
  .agenda-actions .btn-icon { width: 44px; height: 44px; flex-basis: 44px; }
  .agenda-time { grid-column: 3; grid-row: 1; }
  .inline-two { grid-template-columns: minmax(0, 1fr); }
}
</style>
