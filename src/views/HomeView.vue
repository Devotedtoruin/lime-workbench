<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { burstFrom } from '../lib/effects.js';
import { reviewFor, reviewHeadline } from '../../js/review.js';
import { parseCommand, resolveLocalShortcut, preview as previewCommand } from '../../js/command.js';
import { previewNoteBody } from '../../js/workspace.js';
import { SYNTAX_CATEGORIES, matchSlashHelp } from '../lib/syntax-help.js';
import { parseOmniboxWithAI } from '../lib/ai-assist.js';
import EmptyState from '../components/EmptyState.vue';
import PriorityMatrix from '../components/PriorityMatrix.vue';
import LedgerCharts from '../components/LedgerCharts.vue';

const emit = defineEmits(['open-command', 'new-task']);
const wb = useWorkbench();

/* ---------------- 全能一句话快记 & /help 语法面板 (Omnibox) ---------------- */
const quickText = ref('');
const quickInput = ref(null);
const quickForceTodo = ref(false);
const manualHelpOpen = ref(false);
const aiParsing = ref(false);
const aiParsedResult = ref(null);
const noteDraft = ref({ open: false, id: null, title: '', body: '' });
const linkDraft = ref({ open: false, id: null, title: '', url: '' });

watch(quickText, val => {
  quickForceTodo.value = false;
  if (!val.trim()) aiParsedResult.value = null;
  if (val.trim() && !val.trim().startsWith('/')) {
    manualHelpOpen.value = false;
  }
});

const slashMatch = computed(() => matchSlashHelp(quickText.value));
const showHelpPanel = computed(() => Boolean(slashMatch.value || manualHelpOpen.value));
const helpCategories = computed(() => slashMatch.value?.categories || SYNTAX_CATEGORIES);

function toggleHelpPanel() {
  if (slashMatch.value) {
    quickText.value = '';
    manualHelpOpen.value = false;
  } else {
    manualHelpOpen.value = !manualHelpOpen.value;
  }
  nextTick(() => quickInput.value?.focus());
}

function fillQuickExample(exampleText) {
  quickText.value = exampleText;
  manualHelpOpen.value = false;
  nextTick(() => quickInput.value?.focus());
}

function describeShortcut(sc) {
  if (!sc) return '';
  if (sc.type === 'note') return `新建便签 · ${sc.title || '快速便签'}`;
  if (sc.type === 'link') return `添加工作链接 · ${sc.title || sc.url || '常用链接'}`;
  if (sc.type === 'export') return '导出工作台数据备份 (.json)';
  if (sc.type === 'navigate') return `前往「${sc.label || sc.page}」页面`;
  return '执行快捷动作';
}

const quickResolution = computed(() => {
  const text = quickText.value.trim();
  if (!text || text.startsWith('/')) return null;
  if (!quickForceTodo.value) {
    const shortcut = resolveLocalShortcut(text);
    if (shortcut) {
      return {
        kind: 'shortcut',
        shortcut,
        badge: '快捷指令',
        summary: describeShortcut(shortcut),
        canForceTodo: true
      };
    }
    const intent = parseCommand(text, wb.nowDate.value);
    if (intent && intent.kind !== 'todo') {
      return {
        kind: 'intent',
        intent,
        badge: '智能识别',
        summary: previewCommand(intent),
        canForceTodo: true
      };
    }
    if (intent && intent.kind === 'todo') {
      return {
        kind: 'todo-intent',
        intent,
        badge: '待办排期',
        summary: previewCommand(intent),
        canForceTodo: false
      };
    }
  }
  return {
    kind: 'todo',
    badge: '今日待办',
    summary: `新建待办事项「${text}」`,
    canForceTodo: false
  };
});

function startNote(note = null) {
  noteDraft.value = note
    ? { open: true, id: note.id, title: note.title || '', body: note.body || '' }
    : { open: true, id: null, title: '', body: '' };
  requestAnimationFrame(() => {
    document.querySelector('.notes-panel .inline-editor input')?.focus({ preventScroll: false });
  });
}

function startLink(link = null) {
  linkDraft.value = link && link.id
    ? { open: true, id: link.id, title: link.title || '', url: link.url || '' }
    : { open: true, id: null, title: link?.title || '', url: link?.url || '' };
  requestAnimationFrame(() => {
    document.querySelector('.workspace-links .inline-editor input')?.focus({ preventScroll: false });
  });
}

onMounted(() => {
  const notePrefill = wb.consumePrefill('note');
  if (notePrefill) {
    startNote({ id: null, title: notePrefill.title || '', body: notePrefill.body || '' });
  }
  const linkPrefill = wb.consumePrefill('link');
  if (linkPrefill) {
    startLink({ id: null, title: linkPrefill.title || '', url: linkPrefill.url || '' });
  }
});

watch(() => wb.prefillState.kind, kind => {
  if (kind === 'note') {
    const p = wb.consumePrefill('note');
    if (p) startNote({ id: null, title: p.title || '', body: p.body || '' });
  } else if (linkPrefillTrigger(kind)) {
    const p = wb.consumePrefill('link');
    if (p) startLink({ id: null, title: p.title || '', url: p.url || '' });
  }
});
function linkPrefillTrigger(kind) { return kind === 'link'; }

function submitQuick() {
  const text = quickText.value.trim();
  if (!text) { quickInput.value?.focus(); return; }
  if (text.startsWith('/')) {
    manualHelpOpen.value = true;
    return;
  }
  const res = quickResolution.value;
  let handled = false;
  if (res?.kind === 'shortcut') {
    const sc = res.shortcut;
    if (sc.type === 'note' && !sc.body) {
      startNote({ id: null, title: sc.title || '', body: '' });
      handled = true;
    } else if (sc.type === 'link' && !sc.url) {
      startLink({ id: null, title: sc.title || '', url: '' });
      handled = true;
    } else {
      handled = wb.execShortcut(sc);
    }
  } else if (res?.kind === 'intent') {
    handled = wb.execIntent(res.intent);
  } else {
    handled = Boolean(wb.addTodo(text, { bucket: 'today' }));
  }
  if (handled) {
    quickText.value = '';
    quickForceTodo.value = false;
    manualHelpOpen.value = false;
    aiParsedResult.value = null;
    requestAnimationFrame(() => quickInput.value?.focus());
  }
}

async function triggerAiOmnibox() {
  const text = quickText.value.trim();
  if (!text || aiParsing.value) return;
  aiParsing.value = true;
  manualHelpOpen.value = false;
  try {
    const res = await parseOmniboxWithAI(text, wb.state);
    if (!res.ok) {
      wb.showToast(res.error || '未能解析该指令');
      return;
    }
    aiParsedResult.value = res;
  } finally {
    aiParsing.value = false;
  }
}

function executeAiAction(act, index) {
  if (wb.execIntent(act)) {
    if (aiParsedResult.value?.actions) {
      aiParsedResult.value.actions.splice(index, 1);
      if (!aiParsedResult.value.actions.length) {
        aiParsedResult.value = null;
        quickText.value = '';
      }
    }
  }
}

function executeAllAiActions() {
  const list = aiParsedResult.value?.actions || [];
  if (!list.length) return;
  let count = 0;
  for (const act of list) {
    if (wb.execIntent(act)) count++;
  }
  aiParsedResult.value = null;
  quickText.value = '';
  if (count > 0) {
    wb.showToast(`已批量执行 ${count} 项操作`);
  }
}

/* ---------------- 首页看板模块定制 ---------------- */
const customizingBlocks = ref(false);
const BLOCK_NAMES = {
  matrix: '四象限优先级矩阵',
  tasks: '今日任务清单',
  charts: '收支趋势与分类饼图',
  ledger: '本月收支与预算',
  reminders: '近期提醒',
  notes: '工作便签',
  links: '常用链接',
  rhythm: '近 7 天趋势',
  review: '今日复盘'
};
const SPAN_OPTIONS = [
  { span: 4, label: '1/3 宽' },
  { span: 6, label: '1/2 宽' },
  { span: 8, label: '2/3 宽' },
  { span: 12, label: '通栏' }
];

/* ---------------- KPI ---------------- */
const heroNow = computed(() => new Date(wb.nowTick.value).toLocaleTimeString('zh-CN', {
  hour: '2-digit', minute: '2-digit', hour12: false
}));
const workdayPct = computed(() => wb.todayShift.value.percent);

/* ---------------- 今日任务 ---------------- */
const agendaLimit = ref(6);
const todayTasks = computed(() => wb.openTodayTasks.value);
const shownTasks = computed(() => todayTasks.value.slice(0, agendaLimit.value));

function completeTask(task, event) {
  const wasDone = task.done;
  wb.toggleTodo(task.id);
  if (!wasDone) burstFrom(event.currentTarget);
}

function subtaskBadge(taskId) {
  const subs = wb.getSubtasks(taskId);
  if (!subs.length) return '';
  return `${subs.filter(s => s.done).length}/${subs.length}`;
}

function recurrenceBadge(taskId) {
  const freq = wb.getTaskRecurrence(taskId);
  return freq !== 'none' ? wb.RECURRENCE_LABELS[freq] : '';
}

/* ---------------- 专注 ---------------- */
function toggleFocus() { wb.toggleFocusTimer(); }

/* ---------------- 便签瀑布流（搜索 + 展开/收起 + 复制） ---------------- */
const noteQuery = ref('');
const expandedNotes = reactive(new Set());

function saveNote() {
  const d = noteDraft.value;
  if (!d.title.trim()) return;
  if (wb.saveNoteRecord({ id: d.id, title: d.title, body: d.body })) noteDraft.value.open = false;
}

const filteredNotes = computed(() => {
  const q = noteQuery.value.trim().toLowerCase();
  const list = wb.state.notes || [];
  if (!q) return list;
  return list.filter(n =>
    String(n.title || '').toLowerCase().includes(q) ||
    String(n.body || '').toLowerCase().includes(q)
  );
});

function getNoteDisplay(note) {
  const full = String(note.body || '');
  const info = previewNoteBody(full, 140);
  const expanded = expandedNotes.has(note.id);
  return {
    text: expanded ? full : info.preview,
    truncated: info.truncated,
    expanded
  };
}

function toggleNoteExpand(id) {
  if (expandedNotes.has(id)) expandedNotes.delete(id);
  else expandedNotes.add(id);
}

const noteColumns = computed(() => {
  const buckets = [[], [], []];
  const heights = [0, 0, 0];
  for (const note of filteredNotes.value) {
    const height = 96 + Math.min(140, Math.ceil((note.body?.length || 0) / 26) * 18);
    const shortest = heights.indexOf(Math.min(...heights));
    buckets[shortest].push(note);
    heights[shortest] += height;
  }
  return buckets;
});

/* ---------------- 工作链接（编辑 + 排序） ---------------- */
function saveLink() {
  if (wb.saveLinkRecord(linkDraft.value)) {
    linkDraft.value = { open: false, id: null, title: '', url: '' };
  }
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
const nextUpcoming = computed(() => {
  const renewals = wb.upcomingRenewals.value
    .filter(item => item.dueSoon)
    .map(item => ({
      sourceKind: 'renewal',
      sourceId: `renewal-${item.id}`,
      label: `${item.name} 续费`,
      dueAt: new Date(`${item.nextDate}T09:00:00`).getTime()
    }));
  return [...wb.upcomingReminders.value, ...renewals]
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 4);
});

/* 今日复盘 */
const todayReview = computed(() => reviewFor(wb.todayStr.value, wb.state));
const reviewLine = computed(() => reviewHeadline(todayReview.value));
const reviewDone = computed(() =>
  todayReview.value.completed.length + todayReview.value.finishedElsewhere.length);

function relTime(ms) {
  const diff = ms - wb.nowTick.value;
  if (diff <= 0) return '即将到期';
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
    <!-- 现代 SaaS 极简指挥头部（替代旧版墨绿大横幅） -->
    <section class="saas-header panel glass rim">
      <div class="saas-top-row">
        <div class="saas-identity">
          <div class="saas-eyebrow">
            <span class="status-pill">
              <i class="status-dot" :class="{ active: !wb.offWorkStatus.value.quiet }"></i>
              {{ wb.offWorkStatus.value.kicker }} · {{ wb.offWorkStatus.value.value }}
            </span>
            <span class="date-label">{{ wb.formattedDate.value }}</span>
            <span class="clock-badge numeric">{{ heroNow }}</span>
          </div>
          <h1 class="saas-title">{{ wb.greetingText.value }}，欢迎回到{{ wb.workspaceName.value }}</h1>
          <p class="saas-subtitle">
            <template v-if="wb.overdueCount.value">
              <b class="overdue-pill numeric">{{ wb.overdueCount.value }} 项逾期</b>
            </template>
            {{ todayTasks.length ? `今日共有 ${todayTasks.length} 项待办事项，首要任务：「${todayTasks[0]?.text}」` : '今日暂无待办积压，可通过下方全能命令栏快速录入任务、账目或打卡。' }}
          </p>
        </div>

        <!-- 右侧：紧凑型专注与班次快捷舱 -->
        <div class="saas-pods">
          <div class="focus-pod">
            <button
              class="focus-pod-play"
              type="button"
              :aria-label="wb.state.focus.running ? '暂停专注' : '开始专注'"
              @click="toggleFocus"
            >
              <img :src="asset(`assets/icons/${wb.state.focus.running ? 'pause' : 'play'}.svg`)" alt="" />
            </button>
            <div class="focus-pod-copy" @click="wb.goto('study')">
              <span class="pod-kicker">专注计时 · {{ wb.state.focus.running ? '进行中' : '就绪' }}</span>
              <strong class="pod-clock numeric">{{ wb.focusClockText.value }}</strong>
              <small>{{ wb.linkedFocusTask.value?.text || wb.state.focus.text || '点击进入专注视图' }}</small>
            </div>
          </div>

          <div class="quick-action-pod">
            <button class="btn btn-soft btn-sm" type="button" @click="wb.openLedgerDialog()">
              <img :src="asset('assets/icons/wallet-cards.svg')" alt="" />记一笔
            </button>
            <button class="btn btn-primary btn-sm" type="button" @click="openNewTask()">
              <img :src="asset('assets/icons/plus.svg')" alt="" />新建任务
            </button>
          </div>
        </div>
      </div>

      <!-- 全能命令输入框 (Omnibox) -->
      <div class="omnibox-wrap">
        <form class="omnibox-bar" @submit.prevent="submitQuick">
          <span class="omnibox-icon" aria-hidden="true">
            <img :src="asset('assets/icons/command.svg')" alt="" />
          </span>
          <input
            ref="quickInput"
            v-model="quickText"
            class="omnibox-input"
            maxlength="200"
            placeholder="一句话快记：待办排期、记账（如：午餐 35 元）、饮水、提醒，或输入 /help 查看语法指南…"
            aria-label="全能快速录入框"
            @keydown.esc="manualHelpOpen = false"
          />
          <button
            class="omnibox-help-btn"
            type="button"
            :class="{ 'is-active': showHelpPanel }"
            title="查看支持的自动识别语法 (/help)"
            @click="toggleHelpPanel"
          >
            /help 语法
          </button>
          <button
            class="omnibox-ai-btn"
            type="button"
            :disabled="aiParsing || !quickText.trim()"
            title="解析复合长句（如：记录午餐 35 元，并添加明天 14:00 评审会议）"
            @click="triggerAiOmnibox"
          >
            <img :src="asset('assets/icons/sparkles.svg')" alt="" />
            {{ aiParsing ? '解析中…' : '复合解析' }}
          </button>
          <button class="btn btn-primary btn-sm omnibox-submit" type="submit">
            {{ quickResolution && quickResolution.kind !== 'todo' && quickResolution.kind !== 'todo-intent' ? '执行' : '录入' }}
          </button>
          <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">
            <img :src="asset('assets/icons/plus.svg')" alt="" />完整表单
          </button>
        </form>

        <!-- 复合指令解析确认抽屉 -->
        <div v-if="aiParsedResult" class="omnibox-ai-tray" role="region" aria-label="复合指令解析结果">
          <div class="ai-tray-head">
            <div class="ai-tray-title">
              <img :src="asset('assets/icons/sparkles.svg')" alt="" />
              <strong>{{ aiParsedResult.mode === 'llm' ? '接口模型复合解析' : '本地复合指令拆解' }}</strong>
              <span>{{ aiParsedResult.reply }}</span>
              <button
                v-if="aiParsedResult.mode === 'local'"
                type="button"
                class="btn btn-text btn-xs"
                @click="wb.goto('me')"
              >
                配置接口
              </button>
            </div>
            <div class="ai-tray-actions">
              <button
                v-if="aiParsedResult.actions?.length > 1"
                type="button"
                class="btn btn-primary btn-xs"
                @click="executeAllAiActions"
              >
                全部执行 ({{ aiParsedResult.actions.length }})
              </button>
              <button type="button" class="btn btn-ghost btn-xs" @click="aiParsedResult = null">关闭</button>
            </div>
          </div>
          <ul v-if="aiParsedResult.actions?.length" class="ai-tray-list">
            <li v-for="(act, idx) in aiParsedResult.actions" :key="idx">
              <span class="ai-act-kind">{{ act.kind === 'ledger' ? '记账' : act.kind === 'todo' ? '任务' : '动作' }}</span>
              <span class="ai-act-summary">{{ act.summary }}</span>
              <button type="button" class="btn btn-soft btn-xs" @click="executeAiAction(act, idx)">执行</button>
            </li>
          </ul>
        </div>

        <!-- /help 悬浮交互式语法速查面板 -->
        <div v-else-if="showHelpPanel" class="omnibox-help-popover" role="region" aria-label="快捷输入语法说明">
          <div class="help-pop-head">
            <div>
              <strong>全能输入框 · 自动识别语法说明</strong>
              <span>支持自然语言识别记账分类、任务排期、专注时长与日常打卡 · 点击任一示例直接填入</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" @click="toggleHelpPanel">收起</button>
          </div>
          <div class="help-pop-grid">
            <div v-for="cat in helpCategories" :key="cat.id" class="help-pop-card">
              <div class="help-pop-card-head">
                <strong>{{ cat.title }}</strong>
                <code>{{ cat.cmd }}</code>
              </div>
              <p>{{ cat.desc }}</p>
              <div class="help-pop-chips">
                <button
                  v-for="ex in cat.examples"
                  :key="ex.value"
                  type="button"
                  class="help-example-chip"
                  @click="fillQuickExample(ex.value)"
                >
                  {{ ex.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 实时意图解析反馈条 -->
        <div v-else-if="quickResolution" class="omnibox-preview" role="status" aria-live="polite">
          <span class="preview-badge">{{ quickResolution.badge }}</span>
          <strong class="preview-summary">{{ quickResolution.summary }}</strong>
          <button
            v-if="quickResolution.canForceTodo"
            type="button"
            class="preview-switch"
            @click="quickForceTodo = true"
          >
            仅存为今日待办
          </button>
          <button
            v-else-if="quickForceTodo"
            type="button"
            class="preview-switch"
            @click="quickForceTodo = false"
          >
            恢复智能识别
          </button>
        </div>
      </div>

      <!-- 4 栏执行官 KPI 指标带 -->
      <div class="kpi-strip" aria-label="今日关键指标">
        <article class="kpi-card" @click="wb.goto('todo')">
          <div class="kpi-top">
            <span>今日待办事项</span>
            <span v-if="wb.overdueCount.value" class="kpi-tag is-coral numeric">{{ wb.overdueCount.value }} 逾期</span>
            <span v-else class="kpi-tag">进行中</span>
          </div>
          <strong class="kpi-val numeric">{{ todayTasks.length }}<em>项</em></strong>
          <small>已完成 {{ reviewDone }} 项 · 点击管理计划</small>
        </article>

        <article class="kpi-card" @click="wb.goto('study')">
          <div class="kpi-top">
            <span>今日专注累计</span>
            <span class="kpi-tag is-brand numeric">{{ wb.studyPercent.value }}%</span>
          </div>
          <strong class="kpi-val numeric">{{ wb.studyTodayMinutes.value }}<em>分钟</em></strong>
          <small>近 7 日累计 {{ wb.rhythmStats.value.studyTotalMin }} 分钟</small>
        </article>

        <article class="kpi-card" @click="wb.goto('ledger')">
          <div class="kpi-top">
            <span>本月支出 / 预算</span>
            <span
              class="kpi-tag numeric"
              :class="wb.budgetStatus.value.status === 'over' ? 'is-coral' : wb.budgetStatus.value.status === 'warning' ? 'is-amber' : 'is-brand'"
            >
              已用 {{ wb.budgetStatus.value.rawPct }}%
            </span>
          </div>
          <strong class="kpi-val numeric">¥{{ wb.currentMonthSummary.value.expense.toFixed(0) }}</strong>
          <small>月度预算 ¥{{ wb.monthlyBudget.value }} · 收入 ¥{{ wb.currentMonthSummary.value.income.toFixed(0) }}</small>
        </article>

        <article class="kpi-card" @click="wb.goto('habits')">
          <div class="kpi-top">
            <span>班次与健康状态</span>
            <span class="kpi-tag numeric">在岗 {{ workdayPct }}%</span>
          </div>
          <strong class="kpi-val numeric">{{ wb.waterTodayMl.value }}<em>ml</em></strong>
          <small>今日步数 {{ wb.stepsToday.value.toLocaleString() }} 步 · 习惯 {{ wb.habitToday.value.done }}/{{ wb.habitToday.value.total }}</small>
        </article>
      </div>
    </section>

    <!-- 看板定制工具栏 -->
    <div class="blocks-bar">
      <div class="blocks-hint">
        <img :src="asset('assets/icons/layout-dashboard.svg')" alt="" />
        <span>{{ customizingBlocks ? '布局定制模式：点击开关显隐模块、调整卡片顺序与栅格宽度（自动持久化）' : '工作台核心模块看板' }}</span>
      </div>
      <div class="blocks-actions">
        <button
          v-if="customizingBlocks"
          class="btn btn-ghost btn-sm"
          type="button"
          @click="wb.resetBlocksLayout()"
        >
          <img :src="asset('assets/icons/rotate-ccw.svg')" alt="" />恢复默认布局
        </button>
        <button
          class="btn btn-sm"
          :class="customizingBlocks ? 'btn-primary' : 'btn-soft'"
          type="button"
          @click="customizingBlocks = !customizingBlocks"
        >
          <img :src="asset(`assets/icons/${customizingBlocks ? 'check' : 'sliders-horizontal'}.svg`)" alt="" />
          {{ customizingBlocks ? '完成布局定制' : '定制看板布局' }}
        </button>
      </div>
    </div>

    <div v-if="customizingBlocks" class="blocks-customizer panel glass rim">
      <span class="customizer-label">启用模块：</span>
      <div class="customizer-chips">
        <button
          v-for="b in wb.blocks.value"
          :key="b.id"
          type="button"
          class="chip"
          :class="{ 'is-active': wb.isBlockVisible(b.id) }"
          @click="wb.toggleBlockVisible(b.id)"
        >
          {{ BLOCK_NAMES[b.id] || b.title || b.id }}
          <small>{{ wb.isBlockVisible(b.id) ? '显示中' : '已隐藏' }}</small>
        </button>
      </div>
    </div>

    <!-- 12 列现代 Bento 积木网格 -->
    <section class="blocks">
      <div
        v-for="(block, bi) in wb.visibleBlocks.value"
        :key="block.id"
        class="block"
        :class="[`span-${block.span}`, `block-${block.id}`]"
      >
        <div v-if="customizingBlocks" class="block-tools">
          <span class="drag-handle">
            <strong>{{ BLOCK_NAMES[block.id] || block.title || block.id }}</strong>
          </span>
          <div class="span-pills" role="group" aria-label="模块宽度">
            <button
              v-for="opt in SPAN_OPTIONS"
              :key="opt.span"
              type="button"
              class="span-pill"
              :class="{ 'is-active': block.span === opt.span }"
              @click="wb.setBlockSpan(block.id, opt.span)"
            >
              {{ opt.label }}
            </button>
          </div>
          <button
            class="btn-icon btn-xs"
            type="button"
            title="前移"
            :disabled="bi === 0"
            @click="wb.moveBlock(block.id, -1)"
          >
            <img :src="asset('assets/icons/chevron-left.svg')" alt="前移" />
          </button>
          <button
            class="btn-icon btn-xs"
            type="button"
            title="后移"
            :disabled="bi === wb.visibleBlocks.value.length - 1"
            @click="wb.moveBlock(block.id, 1)"
          >
            <img :src="asset('assets/icons/chevron-right.svg')" alt="后移" />
          </button>
          <button
            class="btn-icon btn-xs is-danger"
            type="button"
            title="隐藏此模块"
            @click="wb.toggleBlockVisible(block.id)"
          >
            <img :src="asset('assets/icons/x.svg')" alt="隐藏" />
          </button>
        </div>

        <!-- 1. 四象限交互式优先级矩阵 -->
        <section v-if="block.id === 'matrix'" class="panel glass rim card">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">
                <img :src="asset('assets/icons/goal.svg')" alt="" />交互式四象限优先级矩阵
              </h2>
              <p class="panel-sub">拖拽任务卡片跨象限移动，自动同步更新优先级与今日/排期状态</p>
            </div>
            <div class="panel-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">
                <img :src="asset('assets/icons/plus.svg')" alt="" />新建任务
              </button>
            </div>
          </div>
          <PriorityMatrix @edit-task="task => emit('new-task', task)" />
        </section>

        <!-- 2. 月度收支趋势折线图与消费分类饼图 -->
        <section v-else-if="block.id === 'charts'" class="panel glass rim card">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">
                <img :src="asset('assets/icons/wallet-cards.svg')" alt="" />财务收支可视化分析
              </h2>
              <p class="panel-sub">月度收支趋势折线与消费类别占比环图，支持预算水位实时监控</p>
            </div>
            <div class="panel-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="wb.openLedgerDialog()">+ 记一笔</button>
              <button class="btn btn-text btn-sm" type="button" @click="wb.goto('ledger')">
                进入账本<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
              </button>
            </div>
          </div>
          <LedgerCharts compact />
        </section>

        <!-- 3. 今日任务清单 -->
        <section v-else-if="block.id === 'tasks'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">
              <img :src="asset('assets/icons/list-checks.svg')" alt="" />今日任务清单
              <span class="badge numeric">{{ todayTasks.length }}</span>
            </h2>
            <div class="panel-actions">
              <button class="btn btn-text btn-sm" type="button" @click="wb.goto('todo', 'all')">
                全部任务<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
              </button>
            </div>
          </div>

          <div v-if="!todayTasks.length" class="empty">
            <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/list-checks.svg')" alt="" /></span>
            <strong>暂无今日待办事项</strong>
            <p>可通过顶部命令框快速录入，或点击下方按钮配置详细排期与子步骤。</p>
            <button class="btn btn-soft btn-sm" type="button" @click="emit('new-task')">新建任务</button>
          </div>

          <TransitionGroup v-else name="list-anim" tag="div" class="agenda">
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
                  {{ { high: '高优', medium: '中优', low: '低优' }[task.priority] || '中优' }}
                  · {{ task.tag || '个人计划' }}
                  <span v-if="subtaskBadge(task.id)" class="sub-pill numeric">子步骤 {{ subtaskBadge(task.id) }}</span>
                  <span v-if="recurrenceBadge(task.id)" class="sub-pill">↻ {{ recurrenceBadge(task.id) }}</span>
                  <time class="agenda-time numeric" :class="{ overdue: task.date && task.date < wb.todayStr.value }">{{ taskTime(task) }}</time>
                </small>
              </div>
              <span class="agenda-actions">
                <button class="btn-icon" type="button" title="绑定为当前专注任务" :aria-label="`专注${task.text}`" @click="wb.linkTaskToFocus(task.id, true)">
                  <img :src="asset('assets/icons/play.svg')" alt="" />
                </button>
                <button class="btn-icon" type="button" title="编辑任务与子步骤" :aria-label="`编辑${task.text}`" @click="emit('new-task', task)">
                  <img :src="asset('assets/icons/pencil.svg')" alt="" />
                </button>
                <button class="btn-icon is-danger" type="button" title="删除任务" :aria-label="`删除${task.text}`" @click="wb.deleteTodo(task.id)">
                  <img :src="asset('assets/icons/trash.svg')" alt="" />
                </button>
              </span>
            </article>
          </TransitionGroup>

          <footer v-if="todayTasks.length > agendaLimit" class="panel-foot">
            <button class="btn btn-text btn-sm" type="button" @click="agendaLimit += 6">
              展开其余 {{ todayTasks.length - agendaLimit }} 项
            </button>
          </footer>
        </section>

        <!-- 4. 近期提醒 -->
        <section v-else-if="block.id === 'reminders'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">
              <img :src="asset('assets/icons/alarm-clock.svg')" alt="" />近期提醒
            </h2>
            <span class="panel-sub">{{ wb.activeAlerts.value.length ? `${wb.activeAlerts.value.length} 条待处理` : '状态正常' }}</span>
          </div>
          <TransitionGroup v-if="nextUpcoming.length" name="list-anim" tag="ol" class="upcoming">
            <li v-for="item in nextUpcoming" :key="`${item.sourceKind}:${item.sourceId}`" class="upcoming-row">
              <span class="up-dot" aria-hidden="true"></span>
              <span class="up-copy"><strong>{{ item.label }}</strong><small class="numeric">{{ relTime(item.dueAt) }}</small></span>
            </li>
          </TransitionGroup>
          <EmptyState
            v-else
            icon="alarm-clock"
            title="暂无近期提醒"
            text="可配置定点提醒、周期提醒或倒计时。"
            action-label="配置提醒"
            @action="wb.goto('calendar')"
          />
          <button class="btn btn-text btn-sm" type="button" @click="wb.goto('calendar')">管理全部提醒</button>
        </section>

        <!-- 5. 工作便签（搜索 + 展开/收起 + 一键复制） -->
        <section v-else-if="block.id === 'notes'" class="panel glass rim card notes-panel">
          <div class="panel-head">
            <h2 class="panel-title">
              <img :src="asset('assets/icons/sticky-note.svg')" alt="" />工作便签
              <span class="badge numeric">{{ wb.state.notes.length }}</span>
            </h2>
            <div class="panel-actions notes-head-actions">
              <input
                v-if="wb.state.notes.length > 1"
                v-model="noteQuery"
                class="input note-search-input"
                type="search"
                placeholder="检索便签…"
                aria-label="检索便签"
              />
              <button class="btn btn-text btn-sm" type="button" @click="startNote()">
                <img :src="asset('assets/icons/plus.svg')" alt="" />新建
              </button>
            </div>
          </div>

          <form v-if="noteDraft.open" class="inline-editor" @submit.prevent="saveNote">
            <input v-model="noteDraft.title" class="input" maxlength="120" required placeholder="便签标题" />
            <textarea v-model="noteDraft.body" class="input" maxlength="5000" rows="3" placeholder="记录会议纪要、技术要点或备忘信息…"></textarea>
            <div class="inline-editor-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="noteDraft.open = false">取消</button>
              <button class="btn btn-primary btn-sm" type="submit">保存便签</button>
            </div>
          </form>

          <EmptyState
            v-if="!wb.state.notes.length"
            icon="sticky-note"
            title="暂无工作便签"
            text="记录会议要点、核对清单或临时备忘。"
            action-label="新建便签"
            @action="startNote()"
          />
          <p v-else-if="!filteredNotes.length" class="empty-inline">未找到匹配「{{ noteQuery }}」的便签记录。</p>
          <div v-else class="masonry">
            <div v-for="(column, ci) in noteColumns" :key="ci" class="masonry-col">
              <article v-for="note in column" :key="note.id" class="note card card-hover">
                <div class="note-head">
                  <h4>{{ note.title }}</h4>
                  <span class="note-tools">
                    <button
                      class="btn-icon btn-xs"
                      type="button"
                      title="复制内容"
                      aria-label="复制便签"
                      @click="wb.copyText(note.body ? `${note.title}\n${note.body}` : note.title)"
                    >
                      <img :src="asset('assets/icons/copy.svg')" alt="" />
                    </button>
                    <button class="btn-icon btn-xs" type="button" title="编辑便签" aria-label="编辑便签" @click="startNote(note)">
                      <img :src="asset('assets/icons/pencil.svg')" alt="" />
                    </button>
                    <button class="btn-icon btn-xs is-danger" type="button" title="删除便签" aria-label="删除便签" @click="wb.removeNoteRecord(note.id)">
                      <img :src="asset('assets/icons/trash.svg')" alt="" />
                    </button>
                  </span>
                </div>
                <template v-if="note.body">
                  <p class="note-body">{{ getNoteDisplay(note).text }}</p>
                  <button
                    v-if="getNoteDisplay(note).truncated"
                    type="button"
                    class="note-expand-btn"
                    @click="toggleNoteExpand(note.id)"
                  >
                    {{ getNoteDisplay(note).expanded ? '收起' : '展开全文' }}
                  </button>
                </template>
              </article>
            </div>
          </div>
        </section>

        <!-- 6. 常用链接（支持二次编辑与左右排序） -->
        <section v-else-if="block.id === 'links'" class="panel glass rim card workspace-links">
          <div class="panel-head">
            <h2 class="panel-title">
              <img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />常用链接
              <span class="badge numeric">{{ wb.state.links.length }}</span>
            </h2>
            <button class="btn btn-text btn-sm" type="button" @click="linkDraft.open ? (linkDraft.open = false) : startLink()">
              <img :src="asset('assets/icons/plus.svg')" alt="" />添加
            </button>
          </div>

          <form v-if="linkDraft.open" class="inline-editor" @submit.prevent="saveLink">
            <div class="inline-two">
              <input v-model="linkDraft.title" class="input" maxlength="80" required placeholder="链接名称，如：项目仓库" />
              <input v-model="linkDraft.url" class="input" type="url" maxlength="2000" required placeholder="https://" />
            </div>
            <div class="inline-editor-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="linkDraft.open = false">取消</button>
              <button class="btn btn-primary btn-sm" type="submit">{{ linkDraft.id ? '更新链接' : '保存链接' }}</button>
            </div>
          </form>

          <EmptyState
            v-if="!wb.state.links.length"
            icon="arrow-up-right"
            title="暂无常用链接"
            text="收藏高频访问的文档、代码库或内部系统。"
            action-label="添加链接"
            @action="startLink()"
          />
          <div v-else class="link-grid">
            <a
              v-for="(link, li) in wb.state.links"
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
              <span class="link-tools" @click.prevent.stop>
                <button
                  v-if="wb.state.links.length > 1"
                  class="btn-icon btn-xs"
                  type="button"
                  title="前移"
                  aria-label="前移链接"
                  :disabled="li === 0"
                  @click.prevent.stop="wb.moveLinkRecord(link.id, -1)"
                >
                  <img :src="asset('assets/icons/chevron-left.svg')" alt="" />
                </button>
                <button
                  v-if="wb.state.links.length > 1"
                  class="btn-icon btn-xs"
                  type="button"
                  title="后移"
                  aria-label="后移链接"
                  :disabled="li === wb.state.links.length - 1"
                  @click.prevent.stop="wb.moveLinkRecord(link.id, 1)"
                >
                  <img :src="asset('assets/icons/chevron-right.svg')" alt="" />
                </button>
                <button
                  class="btn-icon btn-xs"
                  type="button"
                  title="编辑链接"
                  aria-label="编辑链接"
                  @click.prevent.stop="startLink(link)"
                >
                  <img :src="asset('assets/icons/pencil.svg')" alt="" />
                </button>
                <button
                  class="btn-icon btn-xs is-danger"
                  type="button"
                  title="删除链接"
                  aria-label="删除链接"
                  @click.prevent.stop="wb.removeLinkRecord(link.id)"
                >
                  <img :src="asset('assets/icons/trash.svg')" alt="" />
                </button>
              </span>
            </a>
          </div>
        </section>

        <!-- 7. 本月收支快览 -->
        <section v-else-if="block.id === 'ledger'" class="panel glass rim card">
          <div class="panel-head">
            <h2 class="panel-title">本月收支与预算</h2>
            <button class="btn btn-text btn-sm" type="button" @click="wb.goto('ledger')">
              账本明细<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
            </button>
          </div>
          <div class="month-grid">
            <div><small>本月收入</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.income.toFixed(2) }}</strong></div>
            <div><small>本月支出</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.expense.toFixed(2) }}</strong></div>
            <div><small>当月结余</small><strong class="numeric">{{ '¥' + wb.currentMonthSummary.value.balance.toFixed(2) }}</strong></div>
          </div>
          <div class="mini-budget">
            <div class="mini-budget-head">
              <span>预算执行率（¥{{ wb.monthlyBudget.value }}）</span>
              <strong class="numeric">{{ wb.budgetStatus.value.rawPct }}%</strong>
            </div>
            <div class="mini-budget-track">
              <i :style="{ width: `${wb.budgetStatus.value.percent}%` }" :class="`is-${wb.budgetStatus.value.status}`"></i>
            </div>
          </div>
        </section>

        <!-- 8. 近 7 天趋势 -->
        <section v-else-if="block.id === 'rhythm'" class="panel glass rim card">
          <div class="panel-head"><h2 class="panel-title">近 7 天趋势</h2></div>
          <div class="rhythm-grid">
            <div><small>运动次数</small><strong class="numeric">{{ wb.rhythmStats.value.sportCount }}<em>次</em></strong></div>
            <div><small>专注累计</small><strong class="numeric">{{ wb.rhythmStats.value.studyTotalMin }}<em>分钟</em></strong></div>
            <div><small>完成事项</small><strong class="numeric">{{ wb.rhythmStats.value.doneCount }}<em>项</em></strong></div>
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

        <!-- 9. 今日复盘 -->
        <section v-else-if="block.id === 'review'" class="panel glass rim card review-card">
          <div class="panel-head">
            <h2 class="panel-title">今日复盘</h2>
            <button class="btn btn-text btn-sm" type="button" @click="wb.goto('standup')">生成日报</button>
          </div>
          <p class="review-line">{{ todayReview.empty ? '完成任务、记录收支或开启专注后，此处将自动生成当日进度汇总。' : reviewLine }}</p>
          <div class="review-grid">
            <div><small>已完成</small><strong class="numeric">{{ reviewDone }}<em>项</em></strong></div>
            <div><small>待处理</small><strong class="numeric">{{ todayReview.open.length }}<em>项</em></strong></div>
            <div><small>已专注</small><strong class="numeric">{{ todayReview.focusMinutes }}<em>分</em></strong></div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ========== 现代 SaaS 极简指挥头部 ========== */
.saas-header {
  display: flex; flex-direction: column; gap: 18px;
  padding: 24px 26px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}

.saas-top-row {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20px; flex-wrap: wrap;
}
.saas-identity { flex: 1; min-width: 280px; }
.saas-eyebrow {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 10px; font-size: var(--text-meta); color: var(--muted);
}
.status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px;
  background: var(--surface-soft); border: 1px solid var(--line);
  color: var(--ink-soft); font-weight: 650;
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); }
.status-dot.active { background: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); }
.date-label { font-weight: 550; }
.clock-badge {
  padding: 2px 8px; border-radius: 6px;
  background: var(--brand-pale); color: var(--brand-deep);
  font-weight: 700;
}
.saas-title {
  font-size: clamp(22px, 2.4vw, 28px);
  font-weight: 800; letter-spacing: -.03em; color: var(--ink); line-height: 1.25;
}
.saas-subtitle {
  margin-top: 6px; font-size: var(--text-body); color: var(--muted);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.overdue-pill {
  padding: 1px 8px; border-radius: 6px;
  background: var(--coral-pale); color: var(--coral);
  font-size: var(--text-meta); font-weight: 700;
}

/* 右侧快捷专注舱 */
.saas-pods {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.focus-pod {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 12px;
  background: var(--surface-soft); border: 1px solid var(--line);
  min-width: 230px;
}
.focus-pod-play {
  width: 38px; height: 38px; flex: 0 0 38px; border-radius: 10px;
  border: 0; background: var(--cta-bg); color: var(--cta-fg);
  display: grid; place-items: center;
  box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast) var(--ease-spring), background-color var(--motion-fast);
}
.focus-pod-play:hover { transform: scale(1.05); background: var(--cta-bg-hover); }
.focus-pod-play img { width: 16px; height: 16px; filter: brightness(0) invert(1); }
.focus-pod-copy { display: flex; flex-direction: column; min-width: 0; cursor: pointer; }
.pod-kicker { font-size: 11px; font-weight: 650; color: var(--muted); }
.pod-clock { font-size: 20px; font-weight: 800; letter-spacing: -.03em; color: var(--ink); line-height: 1.15; }
.focus-pod-copy small {
  font-size: 11px; color: var(--muted); max-width: 170px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.quick-action-pod { display: flex; flex-direction: column; gap: 6px; }

/* 全能命令栏 (Omnibox) */
.omnibox-wrap { position: relative; display: flex; flex-direction: column; gap: 8px; }
.omnibox-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--line-strong) 55%, var(--line));
  background: var(--surface-soft);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), box-shadow var(--motion-fast);
}
.omnibox-bar:focus-within {
  background: var(--surface);
  border-color: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 16%, transparent);
}
.omnibox-icon { display: grid; place-items: center; opacity: .55; }
.omnibox-icon img { width: 17px; height: 17px; }
.omnibox-input {
  flex: 1; min-width: 0; height: 36px; border: 0; background: transparent;
  outline: none; font-size: var(--text-body); color: var(--ink);
}
.omnibox-input::placeholder { color: var(--muted); opacity: .75; }
.omnibox-help-btn {
  height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface);
  color: var(--brand-deep); font-family: var(--font-numeric); font-size: 11.5px; font-weight: 650;
  white-space: nowrap;
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.omnibox-help-btn:hover, .omnibox-help-btn.is-active {
  background: var(--brand-pale);
  border-color: color-mix(in srgb, var(--brand) 38%, var(--line));
}
.omnibox-ai-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--brand) 32%, var(--line));
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 11.5px; font-weight: 650; white-space: nowrap;
  transition: transform var(--motion-fast), background-color var(--motion-fast);
}
.omnibox-ai-btn img { width: 13px; height: 13px; }
.omnibox-ai-btn:hover:not(:disabled) { transform: translateY(-1px); }
.omnibox-ai-btn:disabled { opacity: .5; cursor: not-allowed; }

.omnibox-ai-tray {
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 35%, var(--line));
  background: var(--surface);
  box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: 10px;
}
.ai-tray-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.ai-tray-title { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: var(--text-sm); }
.ai-tray-title img { width: 15px; height: 15px; }
.ai-tray-title strong { color: var(--brand-deep); font-weight: 700; }
.ai-tray-title span { color: var(--muted); font-size: var(--text-meta); }
.ai-tray-actions { display: flex; align-items: center; gap: 6px; }
.ai-tray-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.ai-tray-list li {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 8px;
  background: var(--surface-soft); border: 1px solid var(--line);
  font-size: var(--text-sm);
}
.ai-act-kind {
  padding: 1px 6px; border-radius: 5px;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 11px; font-weight: 700; flex: 0 0 auto;
}
.ai-act-summary { flex: 1; min-width: 0; font-weight: 600; color: var(--ink); }

/* /help 语法速查浮层 */
.omnibox-help-popover {
  padding: 16px 18px; border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--brand) 32%, var(--line));
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  animation: fade-in var(--motion-fast) var(--ease-out);
}
.help-pop-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--line);
}
.help-pop-head strong { display: block; font-size: var(--text-body); font-weight: 750; color: var(--ink); }
.help-pop-head span { display: block; margin-top: 2px; font-size: var(--text-meta); color: var(--muted); }
.help-pop-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.help-pop-card {
  padding: 11px 12px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface-soft);
  display: flex; flex-direction: column; gap: 6px;
}
.help-pop-card-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.help-pop-card-head strong { font-size: var(--text-sm); font-weight: 700; color: var(--ink); }
.help-pop-card-head code {
  padding: 1px 6px; border-radius: 5px;
  background: var(--brand-pale); color: var(--brand-deep);
  font-family: var(--font-numeric); font-size: 10.5px;
}
.help-pop-card p { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.help-pop-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
.help-example-chip {
  padding: 3px 8px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-soft); font-size: 11px; font-weight: 600;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.help-example-chip:hover {
  border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep);
}

/* 智能意图预览条 */
.omnibox-preview {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; border-radius: 10px;
  background: var(--brand-pale);
  border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--line));
  font-size: var(--text-sm);
}
.preview-badge {
  padding: 2px 7px; border-radius: 5px;
  background: var(--brand); color: #fff;
  font-size: 11px; font-weight: 700;
}
.preview-summary { flex: 1; min-width: 140px; color: var(--ink); font-weight: 650; }
.preview-switch {
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink-soft); font-size: 11.5px; font-weight: 600;
}

/* 4 栏 KPI 指标卡 */
.kpi-strip {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
}
.kpi-card {
  padding: 14px 16px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface-soft);
  display: flex; flex-direction: column; gap: 4px;
  cursor: pointer;
  transition: transform var(--motion-fast), border-color var(--motion-fast), background-color var(--motion-fast), box-shadow var(--motion-fast);
}
.kpi-card:hover {
  transform: translateY(-1px);
  background: var(--surface);
  border-color: color-mix(in srgb, var(--brand) 36%, var(--line));
  box-shadow: var(--shadow-sm);
}
.kpi-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.kpi-top > span:first-child { font-size: var(--text-meta); font-weight: 650; color: var(--muted); }
.kpi-tag {
  padding: 1px 6px; border-radius: 5px;
  background: var(--surface); border: 1px solid var(--line);
  font-size: 10.5px; font-weight: 650; color: var(--muted);
}
.kpi-tag.is-brand { background: var(--brand-pale); color: var(--brand-deep); border-color: transparent; }
.kpi-tag.is-amber { background: var(--amber-pale); color: var(--amber); border-color: transparent; }
.kpi-tag.is-coral { background: var(--coral-pale); color: var(--coral); border-color: transparent; }
.kpi-val { font-size: 24px; font-weight: 800; letter-spacing: -.03em; color: var(--ink); line-height: 1.15; margin-top: 2px; }
.kpi-val em { margin-left: 3px; font-size: 12px; font-style: normal; font-weight: 550; color: var(--muted); }
.kpi-card small { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 模块工具条 */
.blocks-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 2px; }
.blocks-hint { display: flex; align-items: center; gap: 7px; font-size: var(--text-meta); font-weight: 600; color: var(--muted); }
.blocks-hint img { width: 15px; height: 15px; opacity: .6; }
.blocks-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.blocks-customizer {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 16px; border-radius: var(--radius-card);
}
.customizer-label { font-size: var(--text-meta); font-weight: 650; color: var(--muted); }
.customizer-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.customizer-chips .chip {
  padding: 5px 11px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--surface-soft); color: var(--ink-soft); font-size: var(--text-meta); font-weight: 600;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.customizer-chips .chip.is-active { background: var(--brand-pale); border-color: color-mix(in srgb, var(--brand) 30%, var(--line)); color: var(--brand-deep); }
.customizer-chips .chip small { margin-left: 5px; font-size: 11px; opacity: .7; font-weight: 400; }

/* 积木网格：12 列栅格 */
.blocks {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--shell-gap);
  align-items: stretch;
  grid-auto-flow: row dense;
}
.block { grid-column: span 4; min-width: 0; border-radius: var(--radius-card); display: flex; flex-direction: column; }
.block > .panel { flex: 1; height: 100%; }
.block.span-4 { grid-column: span 4; }
.block.span-6 { grid-column: span 6; }
.block.span-8 { grid-column: span 8; }
.block.span-12 { grid-column: span 12; }
.block-tools {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 8px; padding: 6px 10px;
  border: 1px dashed var(--line-strong); border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.drag-handle { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-meta); font-weight: 650; color: var(--ink-soft); margin-right: auto; }
.span-pills { display: inline-flex; align-items: center; gap: 3px; background: var(--surface); padding: 2px; border-radius: 8px; border: 1px solid var(--line); }
.span-pill {
  padding: 2px 8px; border: 0; border-radius: 6px; background: transparent;
  color: var(--muted); font-size: 11px; font-weight: 600;
}
.span-pill.is-active { background: var(--brand-pale); color: var(--brand-deep); }

/* 任务列表 */
.agenda { display: flex; flex-direction: column; gap: 8px; }
.agenda-row {
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface-soft);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-fast);
}
.agenda-row:hover {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
  background: var(--surface);
  transform: translateY(-1px);
}
.agenda-check {
  width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center;
  padding: 0; border: 1px solid var(--line-strong); border-radius: 8px;
  background: var(--surface);
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.agenda-check img { width: 13px; height: 13px; opacity: 0; }
.agenda-check:hover { border-color: var(--brand); background: var(--brand-pale); }
.agenda-row.done .agenda-check { background: var(--cta-bg); border-color: var(--cta-bg); }
.agenda-row.done .agenda-check img { opacity: 1; filter: brightness(0) invert(1); }
.agenda-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.agenda-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; line-height: 1.4; }
.agenda-row.done .agenda-copy strong { text-decoration: line-through; color: var(--muted); }
.agenda-copy small {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: var(--text-meta); color: var(--muted); min-width: 0;
}
.sub-pill {
  padding: 0 5px; border-radius: 4px; background: var(--brand-pale); color: var(--brand-deep);
  font-size: 10.5px; font-weight: 650;
}
.prio { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.prio.high { background: var(--coral); }
.prio.medium { background: var(--amber); }
.prio.low { background: var(--brand); }
.agenda-time { margin-left: auto; font-size: var(--text-meta); color: var(--muted); white-space: nowrap; }
.agenda-time.overdue { color: var(--coral); font-weight: 600; }
.agenda-actions { display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity var(--motion-fast); }
@media (hover: hover) {
  .agenda-row:hover .agenda-actions,
  .agenda-row:focus-within .agenda-actions { opacity: 1; }
}
@media (hover: none) {
  .agenda-actions { opacity: 1; }
}
.agenda-actions .btn-icon { width: 30px; height: 30px; flex-basis: 30px; }
.agenda-actions .btn-icon img { width: 14px; height: 14px; }
.panel-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }

/* 即将到来提醒 */
.upcoming { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.upcoming-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface-soft);
}
.up-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); flex: 0 0 7px; }
.up-copy { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.up-copy strong { font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-copy small { font-size: var(--text-meta); color: var(--muted); white-space: nowrap; }

/* 便签瀑布流 */
.notes-head-actions { display: flex; align-items: center; gap: 6px; }
.note-search-input { width: 136px; min-height: 30px; padding: 3px 9px; font-size: var(--text-meta); }
.empty-inline { margin: 8px 0; font-size: var(--text-sm); color: var(--muted); }
.notes-panel .masonry {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px; align-items: start;
}
.masonry-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.note {
  padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface-soft);
}
.note-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.note-head h4 { font-size: var(--text-body); font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; }
.note-tools { display: flex; gap: 1px; opacity: 0; transition: opacity var(--motion-fast); }
.note:hover .note-tools, .note:focus-within .note-tools { opacity: 1; }
.btn-xs { width: 26px; height: 26px; flex-basis: 26px; border-radius: 7px; }
.btn-xs img { width: 13px; height: 13px; }
.note-body { margin-top: 6px; font-size: var(--text-meta); color: var(--ink-soft); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.note-expand-btn {
  margin-top: 6px; padding: 0; border: 0; background: transparent;
  color: var(--brand-deep); font-size: var(--text-2xs); font-weight: 650;
}
.note-expand-btn:hover { text-decoration: underline; }
.inline-editor { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--surface-soft); }
.inline-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 9px; }
.inline-editor-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* 常用链接 */
.link-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.link-card {
  position: relative; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface-soft); text-decoration: none; color: var(--ink); min-width: 0;
}
.link-initial {
  width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center;
  border-radius: 8px; background: var(--surface); border: 1px solid var(--line);
  font-size: var(--text-sm); font-weight: 700; color: var(--ink-soft);
}
.link-copy { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.link-copy strong { font-size: var(--text-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-copy small { font-size: var(--text-2xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-tools {
  display: flex; align-items: center; gap: 1px; flex: 0 0 auto;
  opacity: 0; transition: opacity var(--motion-fast);
}
.link-card:hover .link-tools, .link-card:focus-within .link-tools { opacity: 1; }

/* 收支 / 预算 / 趋势 */
.month-grid, .rhythm-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.month-grid > div, .rhythm-grid > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.month-grid > div + div, .rhythm-grid > div + div { padding-left: 10px; border-left: 1px solid var(--line); }
.month-grid small, .rhythm-grid small { font-size: var(--text-meta); color: var(--muted); }
.month-grid strong, .rhythm-grid strong { font-size: var(--text-body); font-weight: 700; overflow-wrap: anywhere; }
.rhythm-grid em { font-style: normal; font-size: var(--text-meta); color: var(--muted); margin-left: 2px; font-weight: 400; }

.mini-budget { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.mini-budget-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--text-meta); color: var(--muted); }
.mini-budget-head strong { color: var(--ink); }
.mini-budget-track { height: 6px; border-radius: 99px; background: var(--surface-soft); overflow: hidden; }
.mini-budget-track i { display: block; height: 100%; border-radius: inherit; background: var(--brand); }
.mini-budget-track i.is-warning { background: var(--amber); }
.mini-budget-track i.is-over { background: var(--coral); }

.review-line { margin: -2px 0 12px; font-size: var(--text-body); color: var(--muted); }
.review-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.review-grid > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.review-grid > div + div { padding-left: 10px; border-left: 1px solid var(--line); }
.review-grid small { font-size: var(--text-2xs); color: var(--muted); }
.review-grid strong { font-size: 20px; font-weight: 750; letter-spacing: -.02em; }
.review-grid em { font-style: normal; margin-left: 2px; font-size: 11px; font-weight: 500; color: var(--muted); }
.spark { margin-top: 12px; }
.spark svg { display: block; width: 100%; height: 54px; }

@container workbench (max-width: 1120px) {
  .block.span-4 { grid-column: span 6; }
  .block.span-8 { grid-column: span 12; }
  .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .help-pop-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container workbench (max-width: 820px) {
  .block, .block.span-4, .block.span-6, .block.span-8, .block.span-12 { grid-column: span 12; }
  .help-pop-grid { grid-template-columns: 1fr; }
}
@media (max-width: 1280px) {
  .block.span-4 { grid-column: span 6; }
  .block.span-8 { grid-column: span 12; }
  .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .help-pop-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .block, .block.span-4, .block.span-6, .block.span-8, .block.span-12 { grid-column: span 12; }
  .help-pop-grid { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .saas-header { padding: 18px 16px; }
  .saas-pods { width: 100%; flex-direction: column; align-items: stretch; }
  .quick-action-pod { flex-direction: row; }
  .quick-action-pod .btn { flex: 1; }
  .omnibox-bar { flex-wrap: wrap; padding: 8px; }
  .omnibox-input { flex-basis: calc(100% - 30px); }
  .omnibox-submit { flex: 1; }
  .kpi-strip { grid-template-columns: 1fr; }
  .note-tools, .link-tools { opacity: 1; }
  .inline-two { grid-template-columns: 1fr; }
}
</style>
