// 响应式全局状态中心（Vue 3 Composition API）
// 100% 兼容原有 localStorage 数据格式（lime-workbench-v4、lime-appearance-v2、lime-agent-v1）
import { reactive, ref, computed, watch } from 'vue';
import {
  displayNameOf, avatarOf, todayKey, monthKey, workedMinutes,
  offCountdown, timeOnDate, monthSummary, pad
} from '../../js/core.js';
import { defaultState, parseBackup, MAX_BACKUP_CHARS, validateText, TEXT_LIMITS, COLLECTION_LIMITS } from '../../js/state.js';
import { createStateStore, unavailableStorage, STORAGE_KEY } from '../../js/storage.js';
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

const RAIL_COLLAPSED_KEY = 'lime-rail-collapsed-v2';

export const DEFAULT_BLOCKS = [
  { id: 'tasks', title: '今日任务', span: 8, core: true },
  { id: 'reminders', title: '接下来（提醒）', span: 4, widget: 'reminders' },
  { id: 'notes', title: '工作便签（瀑布流）', span: 4, widget: 'notes' },
  { id: 'links', title: '工作链接', span: 4, widget: 'links' },
  { id: 'ledger', title: '本月收支', span: 4, widget: 'ledger' },
  { id: 'rhythm', title: '近 7 天趋势', span: 4, widget: 'rhythm' },
  { id: 'review', title: '今日复盘', span: 4 }
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
  standup: '日报',
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
  // Below 45% the glass stops guaranteeing readable text on the saturated presets.
  if (appearance.opacity < 0.45) appearance.opacity = 0.45;
  const storageBlocked = ref(Boolean(store.readError));
  const nowTick = ref(Date.now());  const currentPage = ref(new URLSearchParams(location.search).get('page') || 'home');
  if (!PAGE_LABELS[currentPage.value]) currentPage.value = 'home';
  function syncDocumentTitle() {
    document.title = `${workspaceNameOf(state.settings)} · ${PAGE_LABELS[currentPage.value] || '今天'}`;
  }
  syncDocumentTitle();
  watch(currentPage, syncDocumentTitle);

  // 侧边栏状态（极简悬浮可折叠岛 + 移动端隐藏式抽屉）
  const railCollapsed = ref(false);
  const mobileDrawerOpen = ref(false);
  const breakOpen = ref(false);
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

  const blocks = ref(DEFAULT_BLOCKS.map(b => ({ ...b })));

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
      storageBlocked.value = false;
      return true;
    } catch (error) {
      const rolled = store.rollback();
      Object.assign(state, rolled);
      // A multi-tab conflict is recoverable (reload / retry); a read-only store or a full quota
      // is not, and needs a persistent banner rather than a 2.2s toast.
      if (!store.canWrite || error?.name === 'QuotaExceededError' ||
        error?.name === 'NS_ERROR_DOM_QUOTA_REACHED') storageBlocked.value = true;
      const message = String(error?.message || '');
      showToast(message.startsWith('Invalid backup:')
        ? '数据超出可保存上限或格式异常，请先导出并清理记录'
        : (message || '保存失败：本地存储空间不足或受限'));
      return false;
    }
  }

  // Another tab is the writer: adopt its record instead of keeping a stale snapshot, which
  // otherwise turns the next local save into a STORAGE_CONFLICT and discards the local action.
  function refreshFromStorage() {
    try {
      const latest = store.refresh();
      if (store.readError) {
        storageBlocked.value = true;
        return;
      }
      Object.assign(state, latest);
    } catch { /* storage unavailable; keep the current view */ }
  }
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) refreshFromStorage();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromStorage();
  });

  // 主题与外观同步
  function syncThemeDOM() {
    const theme = appearance.theme;
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    // applyAppearance() stamps data-preset on <body> as well; without the matching theme
    // attribute the body-level light scene tokens win over the dark ones for every child.
    document.body.dataset.theme = dark ? 'dark' : '';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a0e1a' : '#f4f6fb');
    applyAppearance(JSON.parse(JSON.stringify(appearance)));
  }

  function updateAppearance(patch) {
    if (patch.opacity !== undefined) {
      patch = { ...patch, opacity: Math.max(0.45, Number(patch.opacity) || 0.45) };
    }
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
  }

  // 路由导航
  //
  // Page changes run inside a View Transition when the browser supports it, so the old view
  // and the new one cross-fade over one frame instead of blinking. The nav order decides the
  // direction: moving down the rail slides the new page in from below, moving up slides it in
  // from above, which gives the rail a spatial memory. Firefox without support simply swaps
  // immediately — the same page, just without the transition.
  const PAGE_ORDER = ['home', 'todo', 'study', 'standup', 'calendar', 'ledger', 'habits', 'sport', 'weather', 'me'];
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

  let viewTransitionBusy = false;
  let pendingNavigation = null;

  function goto(page, filter = null) {
    const target = PAGE_LABELS[page] ? page : 'home';
    if (filter) todoFilter.value = filter;

    // A navigation during an in-flight transition must not call commitPage(): the running
    // transition's update callback would overwrite it. Remember the last target and replay it.
    if (viewTransitionBusy) {
      pendingNavigation = { page: target, filter };
      return;
    }

    const from = PAGE_ORDER.indexOf(currentPage.value);
    const to = PAGE_ORDER.indexOf(target);
    const direction = to === from ? 0 : to > from ? 1 : -1;
    document.documentElement.dataset.navDir = direction > 0 ? 'down' : direction < 0 ? 'up' : '';

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reduced || target === currentPage.value) {
      commitPage(target);
      return;
    }
    viewTransitionBusy = true;
    const transition = document.startViewTransition(() => commitPage(target));
    const finish = () => {
      viewTransitionBusy = false;
      const pending = pendingNavigation;
      pendingNavigation = null;
      if (pending) goto(pending.page, pending.filter);
    };
    transition.finished.then(finish, finish);
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

  function timeMinutes(value) {
    const [h, m] = String(value || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
  }
  function scheduleFor(dateKey) {
    return (state.settings.workSchedule || []).find(item => item.date === dateKey) || null;
  }
  const todaySchedule = computed(() => {
    const today = state.settings.workSchedule || [];
    const nowMinutes = nowDate.value.getHours() * 60 + nowDate.value.getMinutes();
    const yesterday = new Date(nowDate.value);
    yesterday.setDate(yesterday.getDate() - 1);
    const previous = scheduleFor(todayKey(yesterday));
    const current = scheduleFor(todayStr.value);
    // An overnight shift belongs to the date it starts. Early in the morning, yesterday's
    // 22:00–06:00 schedule is still the active shift.
    const usePrevious = !current && previous &&
      timeMinutes(previous.offTime) <= timeMinutes(previous.onTime) &&
      nowMinutes < timeMinutes(previous.onTime);
    const active = current || (usePrevious ? previous : null);
    return active
      ? { ...state.settings, ...active, scheduleOverride: true, scheduleSource: current ? 'today' : 'previous' }
      : { ...state.settings, scheduleOverride: false, scheduleSource: 'default' };
  });

  function shiftMetrics(settings, now, source = 'default') {
    const on = timeMinutes(settings.onTime);
    const off = timeMinutes(settings.offTime);
    const overnight = off <= on;
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    let start;
    let end;
    let active;
    let done;
    let before;
    if (!overnight) {
      start = new Date(day); start.setHours(on, 0, 0, 0);
      end = new Date(day); end.setHours(off, 0, 0, 0);
      active = now >= start && now < end;
      done = now >= end;
      before = now < start;
    } else {
      const todayOn = new Date(day); todayOn.setHours(on, 0, 0, 0);
      const todayOff = new Date(day); todayOff.setHours(off, 0, 0, 0);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes < off) {
        if (source === 'today') {
          start = todayOn;
          end = new Date(todayOff); end.setDate(end.getDate() + 1);
          active = false;
          before = true;
        } else {
          start = new Date(todayOn); start.setDate(start.getDate() - 1);
          end = todayOff;
          active = true;
        }
      } else if (nowMinutes >= on) {
        start = todayOn;
        end = new Date(todayOff); end.setDate(end.getDate() + 1);
        active = true;
      } else {
        if (source === 'previous') {
          // The night shift already ended; keep the previous shift for the on-duty total.
          start = new Date(todayOn); start.setDate(start.getDate() - 1);
          end = todayOff;
          active = false;
        } else {
          // A night shift scheduled for today has not started yet.
          start = todayOn;
          end = new Date(todayOff); end.setDate(end.getDate() + 1);
          active = false;
          before = true;
        }
      }
      done = !active && !before;
    }
    const total = Math.max(0, (end - start) / 60000);
    const elapsed = before ? 0 : Math.max(0, Math.min(now, end) - start) / 60000;
    let breakMinutes = 0;
    const breakOn = timeMinutes(settings.breakStart);
    const breakOff = timeMinutes(settings.breakEnd);
    if (settings.breakStart && settings.breakEnd) {
      const breakStart = new Date(start);
      breakStart.setHours(breakOn, 0, 0, 0);
      if (breakOn < on) breakStart.setDate(breakStart.getDate() + 1);
      const breakEnd = new Date(breakStart);
      breakEnd.setHours(breakOff, 0, 0, 0);
      if (breakEnd <= breakStart) breakEnd.setDate(breakEnd.getDate() + 1);
      breakMinutes = Math.max(0, (Math.min(now, end, breakEnd) - Math.max(start, breakStart)) / 60000);
      if (before) breakMinutes = 0;
    }
    const worked = Math.max(0, Math.round(Math.min(total, elapsed) - Math.min(breakMinutes, elapsed)));
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((worked / total) * 100))) : 0;
    const remaining = Math.max(0, Math.floor((end - now) / 1000));
    return {
      start, end, active, done, before, total, worked, percent, remaining,
      overnight,
      range: `${settings.onTime}–${settings.offTime}${overnight ? '（跨夜）' : ''}`,
      clock: remaining >= 3600
        ? `${Math.floor(remaining / 3600)}:${pad(Math.floor((remaining % 3600) / 60))}:${pad(remaining % 60)}`
        : `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`
    };
  }

  const todayShift = computed(() => shiftMetrics(todaySchedule.value, nowDate.value, todaySchedule.value.scheduleSource));

  const offWorkStatus = computed(() => {
    const s = todaySchedule.value;
    const now = nowDate.value;
    const isRest = !s.scheduleOverride && s.restDays.includes(now.getDay());
    const metrics = todayShift.value;
    const breakText = s.breakStart && s.breakEnd ? ` · 午休 ${s.breakStart}–${s.breakEnd}` : '';
    if (isRest) {
      return { kicker: '今天休息', value: '周末愉快', sub: `默认班次 ${s.onTime}–${s.offTime}`, quiet: true };
    }
    if (metrics.before) {
      return { kicker: '待上班', value: `${s.onTime} 上班`, sub: `今日工作时段 ${metrics.range}${breakText}`, quiet: true };
    }
    if (metrics.done) {
      return { kicker: '已经下班', value: '下班啦', sub: `今日在岗 ${metrics.worked} 分钟${metrics.overnight ? '（跨夜）' : ''}`, quiet: true };
    }
    return {
      kicker: '距离下班',
      value: metrics.clock,
      sub: `${metrics.range}${breakText} · 已在岗 ${metrics.worked} 分钟`,
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
    if (warn) showToast(warn);
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
    if (warn) showToast(warn);
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
    if (list.length >= COLLECTION_LIMITS.waterPerDay) {
      showToast(`今天最多记录 ${COLLECTION_LIMITS.waterPerDay} 次饮水`);
      return false;
    }
    const totalEntries = Object.values(state.water).reduce((sum, entries) => sum + entries.length, 0);
    if (totalEntries >= COLLECTION_LIMITS.waterTotal) {
      showToast('饮水记录已达总量上限，请先导出并清理');
      return false;
    }
    list.push({ ml: amount, time: Date.now() });
    state.water[key] = list;
    if (!save()) return false;
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
    return true;
  }

  // 账本操作
  function addLedgerRecord({ type = 'expense', amount, note = '', cat = CATEGORIES[0], date = todayKey() }) {
    if (state.ledger.length >= COLLECTION_LIMITS.ledger) {
      showToast(`账目最多保存 ${COLLECTION_LIMITS.ledger} 条，请先导出并清理`);
      return false;
    }
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
    const when = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayKey();
    state.ledger.unshift({
      id: nextId(),
      type: type === 'income' ? 'income' : 'expense',
      amount: amt,
      note: cleanNote,
      cat: cat || CATEGORIES[0],
      date: when
    });
    if (!save()) return false;
    return true;
  }

  /* ---------------- 排班与固定记账模板 ---------------- */
  function addWorkTemplate({ name, onTime, offTime, breakStart, breakEnd }) {
    const clean = String(name || '').trim();
    const timeOk = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (!clean || !validateText(clean, TEXT_LIMITS.taskTag)) { showToast('模板名称无效'); return false; }
    if (![onTime, offTime, breakStart, breakEnd].every(timeOk)) { showToast('班次时间格式无效'); return false; }
    if ((state.settings.workTemplates || []).length >= COLLECTION_LIMITS.workTemplates) {
      showToast('班次模板最多保存 20 个'); return false;
    }
    state.settings.workTemplates.unshift({
      id: nextId(), name: clean, onTime, offTime, breakStart, breakEnd
    });
    if (!save()) return false;
    showToast('班次模板已保存');
    return true;
  }

  function updateWorkTemplate(id, { name, onTime, offTime, breakStart, breakEnd }) {
    const item = (state.settings.workTemplates || []).find(t => String(t.id) === String(id));
    if (!item) return false;
    const clean = String(name || '').trim();
    const timeOk = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (!clean || !validateText(clean, TEXT_LIMITS.taskTag) || ![onTime, offTime, breakStart, breakEnd].every(timeOk) ||
        onTime === offTime) {
      showToast('班次模板内容无效'); return false;
    }
    Object.assign(item, { name: clean, onTime, offTime, breakStart, breakEnd });
    if (!save()) return false;
    showToast('班次模板已更新');
    return true;
  }

  function deleteWorkTemplate(id) {
    const list = state.settings.workTemplates || [];
    const idx = list.findIndex(item => String(item.id) === String(id));
    if (idx < 0) return;
    list.splice(idx, 1);
    save();
  }

  function applyWorkSchedule({ date, onTime, offTime, breakStart, breakEnd }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) { showToast('请选择有效日期'); return false; }
    const timeOk = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));
    if (![onTime, offTime, breakStart, breakEnd].every(timeOk)) { showToast('班次时间格式无效'); return false; }
    if (offTime === onTime) { showToast('上下班时间不能相同'); return false; }
    const list = state.settings.workSchedule || [];
    const idx = list.findIndex(item => item.date === date);
    const entry = { id: idx >= 0 ? list[idx].id : nextId(), date, onTime, offTime, breakStart, breakEnd };
    if (idx >= 0) list.splice(idx, 1, entry);
    else {
      if (list.length >= COLLECTION_LIMITS.workSchedule) { showToast('排班记录已达上限'); return false; }
      list.push(entry);
    }
    if (!save()) return false;
    showToast(`${date} 的班次已设定`);
    return true;
  }

  function removeWorkSchedule(date) {
    const list = state.settings.workSchedule || [];
    const idx = list.findIndex(item => item.date === date);
    if (idx < 0) return;
    list.splice(idx, 1);
    save();
  }

  function addLedgerTemplate({ name, type = 'expense', amount, cat = CATEGORIES[0], note = '', frequency = 'manual', dayOfMonth = 1, enabled = true, reminderDays = 3 }) {
    const clean = String(name || '').trim();
    const amt = Math.abs(Number(amount) || 0);
    if (!clean || !validateText(clean, TEXT_LIMITS.taskTag)) { showToast('模板名称无效'); return false; }
    if (!amt || amt > 1_000_000) { showToast('模板金额需在 0.01–1000000 之间'); return false; }
    if ((state.settings.ledgerTemplates || []).length >= COLLECTION_LIMITS.ledgerTemplates) {
      showToast('固定账目模板最多保存 30 个'); return false;
    }
    state.settings.ledgerTemplates.unshift({
      id: nextId(), name: clean, type: type === 'income' ? 'income' : 'expense', amount: amt,
      cat: cat || CATEGORIES[0], note: String(note || '').trim() || clean,
      frequency: ['daily', 'weekday', 'monthly', 'manual'].includes(frequency) ? frequency : 'manual',
      dayOfMonth: Math.min(31, Math.max(1, Number(dayOfMonth) || 1)), enabled: Boolean(enabled),
      lastPosted: '', reminderDays: Math.min(30, Math.max(0, Number(reminderDays) || 0))
    });
    if (!save()) return false;
    autoPostLedgerTemplates(true);
    showToast('固定账目模板已保存');
    return true;
  }

  function updateLedgerTemplate(id, { name, type = 'expense', amount, cat = CATEGORIES[0], note = '', frequency = 'manual', dayOfMonth = 1, enabled = true, reminderDays = 3 }) {
    const item = (state.settings.ledgerTemplates || []).find(t => String(t.id) === String(id));
    if (!item) return false;
    const clean = String(name || '').trim();
    const amt = Math.abs(Number(amount) || 0);
    if (!clean || !validateText(clean, TEXT_LIMITS.taskTag) || !amt || amt > 1_000_000) {
      showToast('模板名称或金额无效'); return false;
    }
    Object.assign(item, {
      name: clean, type: type === 'income' ? 'income' : 'expense', amount: amt,
      cat: cat || CATEGORIES[0], note: String(note || '').trim() || clean,
      frequency: ['daily', 'weekday', 'monthly', 'manual'].includes(frequency) ? frequency : 'manual',
      dayOfMonth: Math.min(31, Math.max(1, Number(dayOfMonth) || 1)), enabled: Boolean(enabled),
      reminderDays: Math.min(30, Math.max(0, Number(reminderDays) || 0))
    });
    if (!save()) return false;
    autoPostLedgerTemplates(true);
    showToast('固定账目模板已更新');
    return true;
  }

  function toggleLedgerTemplate(id) {
    const item = (state.settings.ledgerTemplates || []).find(t => String(t.id) === String(id));
    if (!item) return false;
    item.enabled = !item.enabled;
    if (!save()) return false;
    autoPostLedgerTemplates(true);
    showToast(item.enabled ? '已启用自动记账' : '已暂停自动记账');
    return true;
  }

  function deleteLedgerTemplate(id) {
    const list = state.settings.ledgerTemplates || [];
    const idx = list.findIndex(item => String(item.id) === String(id));
    if (idx < 0) return;
    list.splice(idx, 1);
    save();
  }

  function applyLedgerTemplate(template, date = todayKey()) {
    if (!template) return false;
    return addLedgerRecord({
      type: template.type,
      amount: template.amount,
      note: template.note || template.name,
      cat: template.cat,
      date
    });
  }

  function templateMatchesToday(template, date) {
    const [year, month, day] = String(date).split('-').map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    if (template.frequency === 'daily') return true;
    if (template.frequency === 'weekday') return weekday >= 1 && weekday <= 5;
    if (template.frequency === 'monthly') {
      const daysInMonth = new Date(year, month, 0).getDate();
      return day === Math.min(template.dayOfMonth, daysInMonth);
    }
    return false;
  }

  function autoPostLedgerTemplates(silent = false) {
    const date = todayKey();
    let posted = 0;
    for (const template of state.settings.ledgerTemplates || []) {
      if (!template.enabled || template.lastPosted === date || !templateMatchesToday(template, date)) continue;
      const duplicate = state.ledger.some(r => r.date === date &&
        Number(r.amount).toFixed(2) === Number(template.amount).toFixed(2) &&
        r.note === (template.note || template.name) && r.cat === template.cat);
      if (duplicate) { template.lastPosted = date; continue; }
      if (state.ledger.length >= COLLECTION_LIMITS.ledger) break;
      state.ledger.unshift({
        id: nextId(), type: template.type, amount: template.amount,
        note: template.note || template.name, cat: template.cat, date
      });
      template.lastPosted = date;
      posted += 1;
    }
    if (posted) {
      save();
      if (!silent) showToast(`已自动记录 ${posted} 笔固定账目`);
    }
    return posted;
  }

  const upcomingRenewals = computed(() => {
    const now = nowDate.value;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const build = (template, year, month) => {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return new Date(year, month, Math.min(template.dayOfMonth, lastDay));
    };
    return (state.settings.ledgerTemplates || [])
      .filter(template => template.frequency === 'monthly' && template.enabled)
      .map(template => {
        let next = build(template, now.getFullYear(), now.getMonth());
        if (next < start) {
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          next = build(template, nextMonth.getFullYear(), nextMonth.getMonth());
        }
        const days = Math.round((next - start) / 86400000);
        return { ...template, nextDate: todayKey(next), days, dueSoon: days <= template.reminderDays };
      })
      .sort((a, b) => a.days - b.days);
  });

  function deleteLedgerRecord(id) {    const idx = state.ledger.findIndex(r => r.id === id);
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
    return true;
  }

  const habitToday = computed(() => todayProgress(state.habits, todayStr.value));

  function addSportRecord({ type = 'run', minutes, distance = 0 }) {
    if (state.sport.length >= COLLECTION_LIMITS.sport) {
      showToast(`运动记录最多保存 ${COLLECTION_LIMITS.sport} 条，请先导出并清理`);
      return false;
    }
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
    const result = state.focus.running
      ? pauseFocus(state.focus, Date.now())
      : startFocus(state.focus, Date.now());
    applyFocusSettlement(result);
  }

  function setFocusDuration(minutes, { reset = false } = {}) {
    const mins = Number(minutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 180) {
      showToast('专注时长需为 1–180 分钟整数');
      return false;
    }
    if (!reset) state.settings.focusMinutes = mins;
    applyFocusSettlement(resetFocus(state.focus, Date.now(), mins * 60));
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

  function ensureReminderCapacity() {
    if (state.reminders.length < COLLECTION_LIMITS.reminders) return true;
    showToast(`提醒最多保存 ${COLLECTION_LIMITS.reminders} 条，请先删除不再需要的提醒`);
    return false;
  }

  function addIntervalReminder(presetId, everyMinutes, customLabel = '') {
    if (!ensureReminderCapacity()) return false;
    try {
      const r = makeInterval(presetId, Number(everyMinutes));
      r.id = uniqueReminderId(presetId);
      if (customLabel) {
        r.label = customLabel.slice(0, TEXT_LIMITS.reminderLabel);
        r.text = `该「${r.label}」了`;
      }
      state.reminders.push(r);
      if (!save()) return false;
      return true;
    } catch (err) {
      showToast(err.message || '提醒间隔无效');
      return false;
    }
  }

  function addCountdownTimer(presetId, minutes, customLabel = '') {
    if (!ensureReminderCapacity()) return false;
    try {
      const r = makeTimer(presetId, Number(minutes));
      r.id = uniqueReminderId(presetId);
      if (customLabel) {
        r.label = customLabel.slice(0, TEXT_LIMITS.reminderLabel);
        r.text = customLabel;
      }
      state.reminders.push(r);
      if (!save()) return false;
      return true;
    } catch (err) {
      showToast(err.message || '倒计时设置无效');
      return false;
    }
  }

  function addScheduledReminder({ label, repeat, date, time }) {
    if (!ensureReminderCapacity()) return false;
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
        return true;
      }
      default:
        return false;
    }
  }

  // 备份导入与导出
  function exportBackupData() {
    try {
      // Validate the compact form first: pretty-printing adds ~15% and can push a record that
      // still saves correctly over the strict 2 MB import limit.
      const compact = JSON.stringify(state);
      parseBackup(compact);
      const pretty = JSON.stringify(state, null, 2);
      const json = pretty.length <= MAX_BACKUP_CHARS ? pretty : compact;
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

  if (typeof window !== 'undefined') {
    autoPostLedgerTemplates();
    watch(todayStr, () => autoPostLedgerTemplates());
  }

  singleton = {
    state,
    appearance,
    storageBlocked,
    nowTick,
    currentPage,
    todoFilter,
    railCollapsed,
    mobileDrawerOpen,
    breakOpen,
    ledgerDialogOpen,
    openLedgerDialog,
    closeLedgerDialog,
    blocks,
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
    todaySchedule,
    todayShift,
    addWorkTemplate,
    updateWorkTemplate,
    deleteWorkTemplate,
    applyWorkSchedule,
    removeWorkSchedule,
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
    addLedgerTemplate,
    updateLedgerTemplate,
    toggleLedgerTemplate,
    deleteLedgerTemplate,
    applyLedgerTemplate,
    autoPostLedgerTemplates,
    upcomingRenewals,
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
