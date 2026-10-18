// 响应式全局状态中心（Vue 3 Composition API）
// 100% 兼容原有 localStorage 数据格式（lime-workbench-v4、lime-appearance-v2、lime-agent-v1）
import { reactive, ref, computed, watch } from 'vue';
import {
  displayNameOf, avatarOf, todayKey, monthKey, workedMinutes,
  offCountdown, timeOnDate, monthSummary, money, pad
} from '../../js/core.js';
import { defaultState, parseBackup, MAX_BACKUP_CHARS, validateText, TEXT_LIMITS, COLLECTION_LIMITS } from '../../js/state.js';
import { createStateStore, unavailableStorage } from '../../js/storage.js';
import {
  defaultAppearance, loadAppearance, saveAppearance, applyAppearance, resetAppearance, WIDGET_NAMES
} from '../../js/appearance.js';
import {
  PRESETS, TIMER_PRESETS, makeInterval, makeTimer, makeDaily, makeOnce,
  pauseReminder, resumeReminder, scanDue, advance, progress, humanRemain, chime
} from '../../js/reminders.js';
import { CATEGORIES, categoryIcon, preview, parseCommand } from '../../js/command.js';
import { remainingFocus, settleFocus, startFocus, pauseFocus, resetFocus } from '../../js/focus.js';
import { upsertAlert, ackAlert, snoozeAlert, visibleAlerts, upcomingEntries, removeSourceAlerts } from '../../js/alerts.js';
import { taskBucket, selectTodayTasks, uniqueTaskById } from '../../js/tasks.js';
import { canCompleteFocusTask, completeFocusTask, disarmFocusTasks } from '../../js/focus-task.js';
import { upsertNote, upsertLink, deleteNote, deleteLink, reorderLink, selectWorkspaceView, previewNoteBody } from '../../js/workspace.js';
import {
  HABIT_LIMITS, HABIT_ICONS, habitDay, normaliseHabit, checkIn, clearDay, todayProgress
} from '../../js/habits.js';
import { workspaceNameOf } from '../../js/branding.js';
import { INPUT_RULES, inRange } from '../../js/input-rules.js';

const LAYOUT_ORDER_KEY = 'lime-modular-blocks-v1';
const RAIL_COLLAPSED_KEY = 'lime-rail-collapsed-v2';

export const DEFAULT_BLOCKS = [
  { id: 'tasks', title: '今日任务', span: 8, core: true },
  { id: 'focus', title: '专注计时', span: 4, widget: 'focus' },
  { id: 'reminders', title: '接下来（提醒）', span: 4, widget: 'reminders' },
  { id: 'notes', title: '工作便签（瀑布流）', span: 8, widget: 'notes' },
  { id: 'links', title: '工作链接', span: 8, widget: 'links' },
  { id: 'ledger', title: '本月收支', span: 4, widget: 'ledger' },
  { id: 'rhythm', title: '近 7 天趋势', span: 4, widget: 'rhythm' }
];

export const SPORTS = [
  { id: 'run', label: '跑步', icon: 'run', met: 9.8 },
  { id: 'walk', label: '走路', icon: 'hike', met: 3.5 },
  { id: 'bike', label: '骑行', icon: 'bike', met: 7.5 },
  { id: 'swim', label: '游泳', icon: 'swim', met: 8.0 },
  { id: 'gym', label: '力量', icon: 'weights', met: 6.0 },
  { id: 'yoga', label: '瑜伽', icon: 'meditate', met: 3.0 },
  { id: 'ball', label: '球类', icon: 'pingpong', met: 7.0 },
  { id: 'hike', label: '徒步', icon: 'hike', met: 6.0 }
];

export const PAGE_LABELS = {
  home: '今天',
  todo: '计划',
  study: '专注',
  calendar: '日历与提醒',
  ledger: '账本',
  habits: '生活习惯',
  sport: '运动',
  weather: '天气与通勤',
  me: '设置与美化'
};

let singleton = null;

export function useWorkbench() {
  if (singleton) return singleton;

  let localStore;
  try { localStore = window.localStorage; } catch { localStore = unavailableStorage(); }
  const store = createStateStore(localStore);

  const state = reactive(store.initial);
  const appearance = reactive(loadAppearance());
  const nowTick = ref(Date.now());
  const currentPage = ref(new URLSearchParams(location.search).get('page') || 'home');
  if (!PAGE_LABELS[currentPage.value]) currentPage.value = 'home';

  // 侧边栏状态（极简悬浮可折叠岛 + 移动端隐藏式抽屉）
  const railCollapsed = ref(false);
  const mobileDrawerOpen = ref(false);
  const ledgerDialogOpen = ref(false);
  function openLedgerDialog() { ledgerDialogOpen.value = true; }
  function closeLedgerDialog() { ledgerDialogOpen.value = false; }
  try {
    railCollapsed.value = localStore.getItem(RAIL_COLLAPSED_KEY) === 'true';
  } catch { /* ignore */ }

  function toggleRailCollapsed() {
    railCollapsed.value = !railCollapsed.value;
    try { localStore.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed.value)); } catch { /* ignore */ }
  }

  // 自定义积木模块顺序与宽窄（Modular Blocks）
  const blocks = ref(loadBlocks());
  const layoutEditing = ref(false);

  function loadBlocks() {
    try {
      const raw = localStore.getItem(LAYOUT_ORDER_KEY);
      if (!raw) return DEFAULT_BLOCKS.map(b => ({ ...b }));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_BLOCKS.map(b => ({ ...b }));
      const map = new Map(DEFAULT_BLOCKS.map(b => [b.id, { ...b }]));
      const ordered = [];
      for (const item of parsed) {
        if (item && map.has(item.id)) {
          const base = map.get(item.id);
          if ([4, 6, 8, 12].includes(item.span)) base.span = item.span;
          ordered.push(base);
          map.delete(item.id);
        }
      }
      for (const rest of map.values()) ordered.push(rest);
      return ordered;
    } catch {
      return DEFAULT_BLOCKS.map(b => ({ ...b }));
    }
  }

  function saveBlocks() {
    try {
      localStore.setItem(LAYOUT_ORDER_KEY, JSON.stringify(blocks.value.map(({ id, span }) => ({ id, span }))));
    } catch { /* ignore */ }
  }

  function moveBlock(id, delta) {
    const list = [...blocks.value];
    const idx = list.findIndex(b => b.id === id);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= list.length) return;
    const [item] = list.splice(idx, 1);
    list.splice(target, 0, item);
    blocks.value = list;
    saveBlocks();
  }

  function reorderBlocksByDrag(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const list = [...blocks.value];
    const fromIdx = list.findIndex(b => b.id === fromId);
    const toIdx = list.findIndex(b => b.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    blocks.value = list;
    saveBlocks();
  }

  function toggleBlockSpan(id) {
    const item = blocks.value.find(b => b.id === id);
    if (!item) return;
    item.span = item.span === 4 ? 8 : item.span === 8 ? 12 : 4;
    saveBlocks();
  }

  function resetBlocks() {
    blocks.value = DEFAULT_BLOCKS.map(b => ({ ...b }));
    saveBlocks();
    showToast('已恢复默认模块积木布局');
  }

  // Toast 与 Undo
  const toastMessage = ref('');
  const toastVisible = ref(false);
  let toastTimer = null;
  function showToast(msg) {
    toastMessage.value = msg;
    toastVisible.value = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastVisible.value = false; }, 2200);
  }

  const undoMessage = ref('');
  const undoVisible = ref(false);
  let pendingUndoFn = null;
  let undoTimer = null;
  function showUndo(msg, fn) {
    undoMessage.value = msg;
    pendingUndoFn = fn;
    undoVisible.value = true;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoVisible.value = false; pendingUndoFn = null; }, 6500);
  }
  function triggerUndo() {
    if (pendingUndoFn) pendingUndoFn();
    pendingUndoFn = null;
    undoVisible.value = false;
    clearTimeout(undoTimer);
  }

  // 持久化保存
  function save() {
    try {
      // 清理遗留的独立 logo 模式，始终以个人头像/默认青柠为准
      if (state.settings.logoMode === 'custom') {
        state.settings.logoMode = 'default';
      }
      store.write(JSON.parse(JSON.stringify(state)));
      return true;
    } catch (error) {
      const rolled = store.rollback();
      Object.assign(state, rolled);
      showToast(error.message || '保存失败：本地存储空间不足或受限');
      return false;
    }
  }

  // 主题与外观同步
  function syncThemeDOM() {
    const theme = appearance.theme;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a0e1a' : '#f4f6fb');
    applyAppearance(JSON.parse(JSON.stringify(appearance)));
  }

  function updateAppearance(patch) {
    Object.assign(appearance, patch);
    // 强制保持运动开启（移除右上角暂停动态媒体开关后不再锁死动画）
    appearance.motion = 'system';
    syncThemeDOM();
    saveAppearance(JSON.parse(JSON.stringify(appearance)));
  }

  function toggleDarkTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    const next = isDark ? 'light' : 'dark';
    updateAppearance({ theme: next });
    try { localStore.setItem('lime-theme', next); } catch { /* ignore */ }
  }

  function resetAppearanceToDefault() {
    resetAppearance();
    Object.assign(appearance, defaultAppearance());
    syncThemeDOM();
    showToast('已恢复默认主题外观');
  }

  // 路由导航
  //
  // Page changes run inside a View Transition when the browser supports it, so the old view
  // and the new one cross-fade over one frame instead of blinking. The nav order decides the
  // direction: moving down the rail slides the new page in from below, moving up slides it in
  // from above, which gives the rail a spatial memory. Firefox without support simply swaps
  // immediately — the same page, just without the transition.
  const PAGE_ORDER = ['home', 'todo', 'study', 'calendar', 'ledger', 'habits', 'sport', 'weather', 'me'];
  const todoFilter = ref('today');

  function commitPage(target) {
    currentPage.value = target;
    mobileDrawerOpen.value = false;
    const url = new URL(location.href);
    url.searchParams.set('page', target);
    history.pushState({ page: target }, '', url);
    document.title = `${workspaceNameOf(state.settings)} · ${PAGE_LABELS[target]}`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function goto(page, filter = null) {
    const target = PAGE_LABELS[page] ? page : 'home';
    if (filter) todoFilter.value = filter;

    const from = PAGE_ORDER.indexOf(currentPage.value);
    const to = PAGE_ORDER.indexOf(target);
    const direction = to === from ? 0 : to > from ? 1 : -1;
    document.documentElement.dataset.navDir = direction > 0 ? 'down' : direction < 0 ? 'up' : '';

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reduced || target === currentPage.value) {
      commitPage(target);
      return;
    }
    document.startViewTransition(() => commitPage(target));
  }

  // 个人形象计算属性（彻底废除独立 Logo，统一展示个人头像 + 昵称 + 工作台名称）
  const workspaceName = computed(() => workspaceNameOf(state.settings));
  const userDisplayName = computed(() => displayNameOf(state.settings));
  const userAvatar = computed(() => avatarOf(state.settings));

  // 日期与统计计算属性
  const nowDate = computed(() => new Date(nowTick.value));
  const todayStr = computed(() => todayKey(nowDate.value));

  const greetingText = computed(() => {
    const h = nowDate.value.getHours();
    const prefix = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
    return state.settings.displayName?.trim() ? `${prefix}，${userDisplayName.value}` : prefix;
  });

  const formattedDate = computed(() =>
    nowDate.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  );

  const openTodayTasks = computed(() => selectTodayTasks(state.todos, todayStr.value));
  const overdueCount = computed(() => openTodayTasks.value.filter(t => t.date && t.date < todayStr.value).length);

  const waterTodayMl = computed(() =>
    (state.water[todayStr.value] || []).reduce((sum, item) => sum + Number(item.ml || 0), 0)
  );
  const waterPercent = computed(() =>
    state.settings.waterGoal ? Math.min(100, Math.round((waterTodayMl.value / state.settings.waterGoal) * 100)) : 0
  );

  const stepsToday = computed(() => state.steps[todayStr.value] || 0);
  const stepsPercent = computed(() =>
    state.settings.stepGoal ? Math.min(100, Math.round((stepsToday.value / state.settings.stepGoal) * 100)) : 0
  );

  const studyTodayMinutes = computed(() => Math.floor((state.study[todayStr.value] || 0) / 60));
  const studyPercent = computed(() => Math.min(100, Math.round(((state.study[todayStr.value] || 0) / 3600) * 100)));

  const offWorkStatus = computed(() => {
    const s = state.settings;
    const now = nowDate.value;
    const isRest = s.restDays.includes(now.getDay());
    const { done, hours, minutes, seconds } = offCountdown(s, now);
    const beforeWork = !isRest && now < timeOnDate(s.onTime, now);
    if (isRest) {
      return { kicker: '今天休息', value: '周末愉快', sub: `工作日 ${s.onTime}–${s.offTime}`, quiet: true };
    }
    if (beforeWork) {
      return { kicker: '待上班', value: `${s.onTime} 上班`, sub: `今日工作时段 ${s.onTime}–${s.offTime}`, quiet: true };
    }
    if (done) {
      return { kicker: '已经下班', value: '下班啦', sub: `今日在岗 ${workedMinutes(s, now)} 分钟`, quiet: true };
    }
    const clock = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    return {
      kicker: '距离下班',
      value: clock,
      sub: `${s.onTime}–${s.offTime} · 已在岗 ${workedMinutes(s, now)} 分钟`,
      quiet: false
    };
  });

  const currentMonthSummary = computed(() => monthSummary(state.ledger, nowDate.value));

  const rhythmStats = computed(() => {
    const now = nowDate.value;
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const weekAgoKey = todayKey(weekAgo);
    const sportCount = (state.sport || []).filter(r => r.date >= weekAgoKey).length;
    const dailyStudy = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return Math.round((state.study[todayKey(d)] || 0) / 60);
    });
    const studyTotalMin = dailyStudy.reduce((a, b) => a + b, 0);
    const doneCount = (state.todos || []).filter(t => {
      if (!t.done || !t.completedAt) return false;
      const day = todayKey(new Date(t.completedAt));
      return day >= weekAgoKey && day <= todayStr.value;
    }).length;
    return { sportCount, studyTotalMin, doneCount, dailyStudy };
  });

  // 辅助生成真实 ID
  function nextId() {
    const latest = Math.max(
      0,
      ...state.todos.map(x => x.id),
      ...state.ledger.map(x => x.id),
      ...state.sport.map(x => x.id)
    );
    return Math.max(Date.now(), latest + 1);
  }

  function uniqueReminderId(prefix) {
    const base = `${prefix}-${Date.now()}`;
    let id = base, idx = 1;
    while (state.reminders.some(r => r.id === id) || state.pendingAlerts.some(a => a.sourceId === id)) {
      id = `${base}-${idx++}`;
    }
    return id;
  }

  // 任务操作
  function syncTaskReminder(task) {
    const previous = state.reminders.find(r => String(r.taskId) === String(task.id));
    const sameTime = previous && !task.done && previous.date === task.date && previous.time === task.time;
    const removed = state.reminders.filter(r => String(r.taskId) === String(task.id));
    if (!sameTime) {
      for (const r of removed) state.pendingAlerts = removeSourceAlerts(state.pendingAlerts, 'reminder', r.id);
    }
    state.reminders = state.reminders.filter(r => String(r.taskId) !== String(task.id));
    if (task.done || !task.date || !task.time) return '';
    if (state.reminders.length >= COLLECTION_LIMITS.reminders) return '任务已保存，但提醒数量已达上限';
    try {
      const label = task.text.slice(0, TEXT_LIMITS.reminderLabel);
      const body = task.text.length > 296 ? task.text : `待办：${task.text}`;
      const reminder = sameTime ? { ...previous, label, text: body } : makeOnce(label, task.date, task.time, body);
      if (!sameTime) reminder.id = uniqueReminderId('task');
      reminder.taskId = task.id;
      state.reminders.push(reminder);
      return '';
    } catch {
      return '任务已保存，但提醒时间已过';
    }
  }

  function addTodo(rawText, opts = {}) {
    const raw = String(rawText || '').trim();
    if (!raw) return null;
    if (state.todos.length >= COLLECTION_LIMITS.todos) {
      showToast('任务数量已达上限');
      return null;
    }
    const parsed = parseCommand(raw, new Date());
    const payload = parsed?.kind === 'todo' ? parsed.payload : {};
    const bucket = opts.bucket || 'today';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = opts.date !== undefined
      ? opts.date
      : (payload.date || (bucket === 'tomorrow' ? todayKey(tomorrow) : bucket === 'anytime' ? '' : todayKey()));
    const time = opts.time !== undefined ? opts.time : (payload.time || '');
    const text = (opts.text || payload.text || raw).slice(0, TEXT_LIMITS.taskText);
    const tag = (opts.tag || '个人计划').slice(0, TEXT_LIMITS.taskTag);
    if (!validateText(text, TEXT_LIMITS.taskText) || !validateText(tag, TEXT_LIMITS.taskTag)) {
      showToast('任务内容或标签格式无效');
      return null;
    }
    const task = {
      id: nextId(),
      text,
      done: false,
      date,
      time: date ? time : '',
      timed: Boolean(date && time),
      priority: opts.priority || 'medium',
      tag
    };
    state.todos.unshift(task);
    const warn = syncTaskReminder(task);
    if (!save()) return null;
    showToast(warn || `已添加任务 · ${task.text}`);
    return task;
  }

  function updateTodo(id, patch) {
    const task = state.todos.find(t => String(t.id) === String(id));
    if (!task) return false;
    const title = (patch.text ?? task.text).trim();
    const tag = (patch.tag ?? task.tag).trim() || '个人计划';
    if (!validateText(title, TEXT_LIMITS.taskText) || !validateText(tag, TEXT_LIMITS.taskTag)) {
      showToast('请检查任务标题与标签');
      return false;
    }
    if (patch.time && !patch.date) {
      showToast('设置具体时间时需选择日期');
      return false;
    }
    Object.assign(task, {
      text: title,
      date: patch.date ?? task.date,
      time: patch.date ? (patch.time ?? task.time) : '',
      timed: Boolean(patch.date && patch.time),
      priority: patch.priority || task.priority,
      tag
    });
    const warn = syncTaskReminder(task);
    if (!save()) return false;
    showToast(warn || '任务已更新');
    return true;
  }

  function toggleTodo(id) {
    const task = state.todos.find(t => String(t.id) === String(id));
    if (!task) return;
    task.done = !task.done;
    if (task.done) task.completedAt = Date.now();
    else delete task.completedAt;
    syncTaskReminder(task);
    if (task.done) {
      const disarmed = disarmFocusTasks(JSON.parse(JSON.stringify(state)), [task.id]);
      state.focus = disarmed.focus;
      state.pendingAlerts = disarmed.pendingAlerts;
    }
    save();
  }

  function deleteTodo(id) {
    const idx = state.todos.findIndex(t => String(t.id) === String(id));
    if (idx < 0) return false;
    const removed = { ...state.todos[idx] };
    state.todos.splice(idx, 1);
    const linked = state.reminders.filter(r => String(r.taskId) === String(id));
    state.reminders = state.reminders.filter(r => String(r.taskId) !== String(id));
    for (const r of linked) state.pendingAlerts = removeSourceAlerts(state.pendingAlerts, 'reminder', r.id);
    const disarmed = disarmFocusTasks(JSON.parse(JSON.stringify(state)), [removed.id]);
    state.focus = disarmed.focus;
    state.pendingAlerts = disarmed.pendingAlerts;
    if (!save()) return false;
    showUndo(`已删除任务「${removed.text}」`, () => {
      state.todos.splice(Math.min(idx, state.todos.length), 0, removed);
      for (const r of linked) state.reminders.push(r);
      save();
      showToast('已恢复任务');
    });
    return true;
  }

  function clearCompletedTodos() {
    const completed = state.todos.filter(t => t.done);
    if (!completed.length) {
      showToast('没有可清理的已完成任务');
      return;
    }
    const snapshot = [...state.todos];
    state.todos = state.todos.filter(t => !t.done);
    if (!save()) return;
    showUndo(`已清理 ${completed.length} 项已完成任务`, () => {
      state.todos = snapshot;
      save();
    });
  }

  // 饮水与步数
  function addWater(ml) {
    const amount = Number(ml);
    if (!inRange(amount, INPUT_RULES.water)) {
      showToast('饮水量需为 1–5000 ml 的整数');
      return false;
    }
    const key = todayKey();
    const list = state.water[key] ? [...state.water[key]] : [];
    list.push({ ml: amount, time: Date.now() });
    state.water[key] = list;
    if (!save()) return false;
    showToast(`饮水 +${amount} ml`);
    return true;
  }

  function undoWater() {
    const key = todayKey();
    const list = state.water[key] || [];
    if (!list.length) {
      showToast('今天还没有可撤销的饮水记录');
      return false;
    }
    list.pop();
    state.water[key] = [...list];
    if (!save()) return false;
    showToast('已撤销最近一次饮水记录');
    return true;
  }

  function updateSteps(rawSteps) {
    const num = Number(rawSteps);
    if (!Number.isInteger(num) || num < 0 || num > 200000) {
      showToast('请输入 0–200000 的整数步数');
      return false;
    }
    state.steps[todayKey()] = num;
    if (!save()) return false;
    showToast(`今日步数已更新为 ${num} 步`);
    return true;
  }

  // 账本操作
  function addLedgerRecord({ type = 'expense', amount, note = '', cat = CATEGORIES[0] }) {
    const amt = Math.abs(Number(amount) || 0);
    if (!amt || !Number.isFinite(amt) || amt > 1_000_000_000) {
      showToast('请输入有效金额');
      return false;
    }
    const cleanNote = (note || '').trim() || '记一笔';
    if (!validateText(cleanNote, TEXT_LIMITS.ledgerNote)) {
      showToast('备注内容无效');
      return false;
    }
    state.ledger.unshift({
      id: nextId(),
      type: type === 'income' ? 'income' : 'expense',
      amount: amt,
      note: cleanNote,
      cat: cat || CATEGORIES[0],
      date: todayKey()
    });
    if (!save()) return false;
    showToast(type === 'income' ? `已记收入 ${money(amt)}` : `已记支出 ${money(amt)}`);
    return true;
  }

  function deleteLedgerRecord(id) {
    const idx = state.ledger.findIndex(r => r.id === id);
    if (idx < 0) return;
    const removed = { ...state.ledger[idx] };
    state.ledger.splice(idx, 1);
    if (!save()) return;
    showUndo(`已删除账目「${removed.note}」`, () => {
      state.ledger.splice(Math.min(idx, state.ledger.length), 0, removed);
      save();
    });
  }

  // 运动操作
  /* ---------------- 习惯打卡 ---------------- */
  const habits = computed(() => state.habits || []);

  function addHabit({ name, icon = 'leaf', target = 1 }) {
    const clean = String(name || '').trim().slice(0, HABIT_LIMITS.name);
    if (!clean) { showToast('习惯名称不能为空'); return false; }
    if (clean !== String(name || '').trim()) showToast(`习惯名称最多 ${HABIT_LIMITS.name} 字`);
    if (state.habits.length >= COLLECTION_LIMITS.habits) {
      showToast('习惯数量已达上限');
      return false;
    }
    if (state.habits.some(h => h.name === clean)) {
      showToast('已经有同名习惯了');
      return false;
    }
    const created = normaliseHabit({
      id: nextId(),
      name: clean,
      icon: HABIT_ICONS.includes(icon) ? icon : 'leaf',
      target: Math.min(HABIT_LIMITS.target, Math.max(1, Math.round(Number(target) || 1))),
      createdAt: Date.now(),
      log: {}
    });
    if (!created) { showToast('习惯格式无效'); return false; }
    state.habits = [...state.habits, created];
    if (!save()) { state.habits = state.habits.filter(h => h.id !== created.id); return false; }
    return true;
  }

  function checkInHabit(id, day = habitDay()) {
    const idx = state.habits.findIndex(h => String(h.id) === String(id));
    if (idx < 0) return false;
    const before = state.habits[idx];
    const after = checkIn(before, day);
    if (after === before) return false;
    state.habits.splice(idx, 1, after);
    if (!save()) { state.habits.splice(idx, 1, before); return false; }
    return true;
  }

  function clearHabitDay(id, day = habitDay()) {
    const idx = state.habits.findIndex(h => String(h.id) === String(id));
    if (idx < 0) return false;
    const before = state.habits[idx];
    const after = clearDay(before, day);
    if (after === before) return false;
    state.habits.splice(idx, 1, after);
    if (!save()) { state.habits.splice(idx, 1, before); return false; }
    return true;
  }

  function deleteHabit(id) {
    const idx = state.habits.findIndex(h => String(h.id) === String(id));
    if (idx < 0) return false;
    const removed = state.habits[idx];
    state.habits = state.habits.filter(h => String(h.id) !== String(id));
    if (!save()) { state.habits = [...state.habits, removed]; return false; }
    showToast('习惯已删除');
    return true;
  }

  const habitToday = computed(() => todayProgress(state.habits, todayStr.value));

  function addSportRecord({ type = 'run', minutes, distance = 0 }) {
    const mins = Number(minutes) || 0;
    const dist = Number(distance) || 0;
    if (!inRange(mins, INPUT_RULES.sportMinutes) || !inRange(dist, INPUT_RULES.sportDistance)) {
      showToast('请填写有效的运动时长（1–1440 分钟）与距离');
      return false;
    }
    state.sport.push({
      id: nextId(),
      type,
      minutes: mins,
      distance: dist,
      date: todayKey(),
      startAt: Date.now()
    });
    if (!save()) return false;
    showToast(`已记录 ${mins} 分钟运动`);
    return true;
  }

  function deleteSportRecord(id) {
    const idx = state.sport.findIndex(r => r.id === id);
    if (idx < 0) return;
    const removed = { ...state.sport[idx] };
    state.sport.splice(idx, 1);
    if (!save()) return;
    showUndo('已删除运动记录', () => {
      state.sport.push(removed);
      save();
    });
  }

  // 专注计时引擎
  const focusRemainingSec = computed(() => remainingFocus(state.focus, nowTick.value));
  const focusClockText = computed(() => {
    const rem = focusRemainingSec.value;
    return `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}`;
  });
  const focusProgressPct = computed(() =>
    state.focus.total ? Math.min(100, Math.max(0, (1 - focusRemainingSec.value / state.focus.total) * 100)) : 0
  );
  const linkedFocusTask = computed(() => uniqueTaskById(state.todos, state.focus.taskId));

  function applyFocusSettlement(result) {
    const completed = result.completionContext;
    if (result.completed && completed) {
      try {
        state.pendingAlerts = upsertAlert(state.pendingAlerts, {
          sourceKind: 'focus',
          sourceId: 'focus',
          label: '专注时段已完成',
          text: completed.text || '本次专注已结束，可安排休息或开始下一项任务。',
          icon: 'alarm',
          dueAt: completed.dueAt,
          snoozedUntil: null,
          ...(completed.taskId !== null ? { taskId: completed.taskId } : {})
        }, Date.now());
      } catch { /* ignore */ }
    }
    for (const [day, seconds] of Object.entries(result.dayCredits)) {
      state.study[day] = (state.study[day] || 0) + seconds;
    }
    state.focus = { ...result.session };
    save();
    if (result.completed) {
      if (state.soundOn) chime('done');
      showToast('专注时段已完成！');
    }
  }

  function toggleFocusTimer() {
    nowTick.value = Date.now();
    const wasRunning = state.focus.running;
    const result = wasRunning ? pauseFocus(state.focus, Date.now()) : startFocus(state.focus, Date.now());
    applyFocusSettlement(result);
    if (!result.completed) showToast(wasRunning ? '专注已暂停' : '专注开始');
  }

  function setFocusDuration(minutes, { reset = false } = {}) {
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
      showToast('专注时长需为 1–180 分钟整数');
      return false;
    }
    if (!reset) state.settings.focusMinutes = mins;
    applyFocusSettlement(resetFocus(state.focus, Date.now(), mins * 60));
    showToast(`专注时长已设为 ${mins} 分钟`);
    return true;
  }

  function linkTaskToFocus(taskId, goStudy = false) {
    const task = uniqueTaskById(state.todos, taskId);
    if (!task || task.done) {
      showToast('无法关联已完成或不存在的任务');
      return false;
    }
    if (state.focus.running) {
      showToast('请先暂停当前专注，再切换关联任务');
      return false;
    }
    state.focus = { ...state.focus, text: task.text, taskId: task.id };
    save();
    showToast(`已将「${task.text}」设为当前专注任务`);
    if (goStudy) goto('study');
    return true;
  }

  function setFocusIntentText(text) {
    if (state.focus.running) {
      showToast('计时进行中，请先暂停再修改专注事项');
      return false;
    }
    const clean = String(text || '').trim().slice(0, 300);
    state.focus = { ...state.focus, text: clean, taskId: null };
    save();
    return true;
  }

  // 便签与链接操作（Workspace）
  function saveNoteRecord({ id, title, body }) {
    try {
      const record = { title: String(title || '').trim(), body: String(body || '') };
      if (id) record.id = Number(id);
      state.notes = upsertNote(state.notes || [], record, Date.now());
      if (!save()) return false;
      showToast('便签已保存');
      return true;
    } catch (err) {
      showToast(err.message || '便签内容无效');
      return false;
    }
  }

  function removeNoteRecord(id) {
    const before = [...(state.notes || [])];
    const target = before.find(n => n.id === id);
    if (!target) return;
    state.notes = deleteNote(before, id);
    if (!save()) return;
    showUndo(`已删除便签「${target.title}」`, () => {
      state.notes = before;
      save();
    });
  }

  function saveLinkRecord({ id, title, url }) {
    try {
      const record = { title: String(title || '').trim(), url: String(url || '').trim() };
      if (id) record.id = Number(id);
      state.links = upsertLink(state.links || [], record, Date.now());
      if (!save()) return false;
      showToast('工作链接已保存');
      return true;
    } catch (err) {
      showToast(err.message || '请输入有效的名称和 https:// 网址');
      return false;
    }
  }

  function removeLinkRecord(id) {
    const before = [...(state.links || [])];
    const target = before.find(l => l.id === id);
    if (!target) return;
    state.links = deleteLink(before, id);
    if (!save()) return;
    showUndo(`已删除链接「${target.title}」`, () => {
      state.links = before;
      save();
    });
  }

  function moveLinkRecord(id, direction) {
    try {
      state.links = reorderLink(state.links || [], id, direction);
      save();
    } catch (err) {
      showToast(err.message || '排序失败');
    }
  }

  // 提醒与到期扫描
  const activeAlerts = computed(() => visibleAlerts(state.pendingAlerts, nowTick.value));
  const upcomingReminders = computed(() => upcomingEntries(state.reminders, state.pendingAlerts, nowTick.value));

  function handleAlert(alert, action) {
    if (action === 'view') {
      goto(alert.sourceKind === 'focus' ? 'study' : 'calendar');
      return;
    }
    try {
      if (action === 'complete-task') {
        const next = completeFocusTask(JSON.parse(JSON.stringify(state)), alert, Date.now());
        Object.assign(state, next);
        showToast('关联任务已完成');
      } else if (action === 'ack') {
        state.pendingAlerts = ackAlert(state.pendingAlerts, alert.sourceKind, alert.sourceId);
      } else if (action === 'snooze') {
        state.pendingAlerts = snoozeAlert(state.pendingAlerts, alert.sourceKind, alert.sourceId, Date.now(), 5);
        showToast('已延后 5 分钟提醒');
      }
      save();
    } catch (err) {
      showToast(err.message || '操作失败');
    }
  }

  function addIntervalReminder(presetId, everyMinutes, customLabel = '') {
    try {
      const r = makeInterval(presetId, Number(everyMinutes));
      r.id = uniqueReminderId(presetId);
      if (customLabel) {
        r.label = customLabel.slice(0, TEXT_LIMITS.reminderLabel);
        r.text = `该「${r.label}」了`;
      }
      state.reminders.push(r);
      if (!save()) return false;
      showToast(`已开启「${r.label}」提醒`);
      return true;
    } catch (err) {
      showToast(err.message || '提醒间隔无效');
      return false;
    }
  }

  function addCountdownTimer(presetId, minutes, customLabel = '') {
    try {
      const r = makeTimer(presetId, Number(minutes));
      r.id = uniqueReminderId(presetId);
      if (customLabel) {
        r.label = customLabel.slice(0, TEXT_LIMITS.reminderLabel);
        r.text = customLabel;
      }
      state.reminders.push(r);
      if (!save()) return false;
      showToast(`已开始「${r.label}」倒计时`);
      return true;
    } catch (err) {
      showToast(err.message || '倒计时设置无效');
      return false;
    }
  }

  function addScheduledReminder({ label, repeat, date, time }) {
    const clean = String(label || '').trim();
    if (!validateText(clean, TEXT_LIMITS.reminderLabel)) {
      showToast('请填写提醒事项名称');
      return false;
    }
    try {
      const now = new Date();
      const r = repeat === 'daily'
        ? makeDaily(clean, time, clean, now)
        : makeOnce(clean, date, time, clean, now);
      r.id = uniqueReminderId(repeat);
      state.reminders.push(r);
      if (!save()) return false;
      showToast(`已添加定时提醒「${clean}」`);
      return true;
    } catch (err) {
      showToast(err.message || '请选择未来的有效日期与时间');
      return false;
    }
  }

  function toggleReminderPause(id) {
    const idx = state.reminders.findIndex(r => r.id === id);
    if (idx < 0) return;
    try {
      const cur = state.reminders[idx];
      state.reminders[idx] = cur.enabled ? pauseReminder(cur) : resumeReminder(cur);
      save();
    } catch {
      showToast('该提醒已过期，无法恢复');
    }
  }

  function deleteReminderById(id) {
    const idx = state.reminders.findIndex(r => r.id === id);
    if (idx < 0) return;
    const removed = { ...state.reminders[idx] };
    state.reminders.splice(idx, 1);
    state.pendingAlerts = removeSourceAlerts(state.pendingAlerts, 'reminder', id);
    if (!save()) return;
    showUndo(`已删除提醒「${removed.label}」`, () => {
      state.reminders.push(removed);
      save();
    });
  }

  // 每秒心跳：更新专注倒计时、下班倒计时与到期提醒
  setInterval(() => {
    const now = Date.now();
    nowTick.value = now;
    if (state.focus.running) {
      const res = settleFocus(state.focus, now);
      if (res.completed || Object.keys(res.dayCredits).length > 0) {
        applyFocusSettlement(res);
      }
    }
    const due = scanDue(state.reminders, now);
    if (due.length > 0) {
      let pending = state.pendingAlerts;
      try {
        for (const r of due) {
          pending = upsertAlert(pending, {
            sourceKind: 'reminder',
            sourceId: r.id,
            label: r.label,
            text: r.text || r.label,
            icon: r.icon || 'bell',
            dueAt: r.kind === 'timer' ? r.endAt : r.nextAt,
            snoozedUntil: null
          }, now);
        }
        state.pendingAlerts = pending;
        state.reminders = state.reminders.map(r => due.some(d => d.id === r.id) ? advance(r, now) : r);
        save();
        if (state.soundOn) chime('done');
      } catch { /* ignore */ }
    }
  }, 1000);

  // 初始化应用外观与路由监听
  syncThemeDOM();
  if (state.focus.running) {
    applyFocusSettlement(settleFocus(state.focus, Date.now()));
  }
  window.addEventListener('popstate', e => {
    const p = e.state?.page || new URLSearchParams(location.search).get('page') || 'home';
    currentPage.value = PAGE_LABELS[p] ? p : 'home';
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (appearance.theme === 'system') syncThemeDOM();
  });

  // 快捷命令执行器：本地解析或 AI 建议都必须由用户确认后调用一次
  function execIntent(intent) {
    if (!intent) return false;
    const p = intent.payload || {};
    switch (intent.kind) {
      case 'ledger':
        return addLedgerRecord({ type: p.type, amount: p.amount, note: p.note, cat: p.cat });
      case 'todo':
        return Boolean(addTodo(p.text || '新任务', {
          bucket: 'today', date: p.date, time: p.time, priority: p.priority, tag: p.tag, text: p.text
        }));
      case 'sport':
        return addSportRecord({ type: p.type, minutes: p.minutes, distance: p.distance || 0 });
      case 'water':
        return addWater(Number(p.ml));
      case 'steps':
        return updateSteps(Number(p.steps));
      case 'focus':
        if (!setFocusDuration(Number(p.minutes))) return false;
        applyFocusSettlement(startFocus(state.focus, Date.now()));
        showToast(`已开始 ${p.minutes} 分钟专注`);
        return true;
      case 'reminder': {
        const minutes = Number(p.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          showToast('提醒时长需为 1–1440 分钟');
          return false;
        }
        return addCountdownTimer('custom', minutes, String(p.text || '').slice(0, TEXT_LIMITS.reminderLabel));
      }
      case 'study': {
        const seconds = Number(p.minutes) * 60;
        if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86400) {
          showToast('学习时长无效');
          return false;
        }
        state.study[todayKey()] = (state.study[todayKey()] || 0) + seconds;
        if (!save()) return false;
        showToast(`已记录专注 ${p.minutes} 分钟`);
        return true;
      }
      default:
        return false;
    }
  }

  // 备份导入与导出
  function exportBackupData() {
    try {
      const json = JSON.stringify(state, null, 2);
      parseBackup(json);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lime-workbench-${todayKey()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('工作台数据备份已导出');
    } catch {
      showToast('导出失败：请检查当前数据');
    }
  }

  async function importBackupFile(file) {
    if (!file) return false;
    if (file.size > MAX_BACKUP_CHARS * 4) {
      showToast('备份文件体积过大');
      return false;
    }
    try {
      const imported = parseBackup(await file.text());
      store.writeReplacement(imported);
      Object.assign(state, imported);
      showToast('备份已成功导入');
      return true;
    } catch {
      showToast('备份文件格式无效，未覆盖当前数据');
      return false;
    }
  }

  function clearAllData() {
    const fresh = defaultState();
    store.writeReplacement(fresh);
    Object.assign(state, fresh);
    showToast('已清空本机工作台记录');
  }

  singleton = {
    state,
    appearance,
    nowTick,
    currentPage,
    todoFilter,
    railCollapsed,
    mobileDrawerOpen,
    ledgerDialogOpen,
    openLedgerDialog,
    closeLedgerDialog,
    blocks,
    layoutEditing,
    toastMessage,
    toastVisible,
    undoMessage,
    undoVisible,
    workspaceName,
    userDisplayName,
    userAvatar,
    greetingText,
    formattedDate,
    todayStr,
    openTodayTasks,
    overdueCount,
    waterTodayMl,
    waterPercent,
    stepsToday,
    stepsPercent,
    studyTodayMinutes,
    studyPercent,
    offWorkStatus,
    currentMonthSummary,
    rhythmStats,
    focusRemainingSec,
    focusClockText,
    focusProgressPct,
    linkedFocusTask,
    activeAlerts,
    upcomingReminders,
    save,
    showToast,
    showUndo,
    triggerUndo,
    execIntent,
    goto,
    toggleRailCollapsed,
    moveBlock,
    reorderBlocksByDrag,
    toggleBlockSpan,
    resetBlocks,
    updateAppearance,
    toggleDarkTheme,
    resetAppearanceToDefault,
    addTodo,
    updateTodo,
    toggleTodo,
    deleteTodo,
    clearCompletedTodos,
    addWater,
    undoWater,
    updateSteps,
    addLedgerRecord,
    deleteLedgerRecord,
    addSportRecord,
    habits,
    habitToday,
    addHabit,
    checkInHabit,
    clearHabitDay,
    deleteHabit,
    deleteSportRecord,
    toggleFocusTimer,
    setFocusDuration,
    linkTaskToFocus,
    setFocusIntentText,
    saveNoteRecord,
    removeNoteRecord,
    saveLinkRecord,
    removeLinkRecord,
    moveLinkRecord,
    handleAlert,
    addIntervalReminder,
    addCountdownTimer,
    addScheduledReminder,
    toggleReminderPause,
    deleteReminderById,
    exportBackupData,
    importBackupFile,
    clearAllData,
    canCompleteFocusTask: alert => canCompleteFocusTask(state, alert),
    humanRemain: r => humanRemain(r, nowTick.value),
    reminderProgress: r => Math.round(progress(r, nowTick.value) * 100)
  };

  return singleton;
}
