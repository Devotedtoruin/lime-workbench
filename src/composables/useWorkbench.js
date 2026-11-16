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
  defaultAppearance, loadAppearance, saveAppearance, applyAppearance, resetAppearance, validateAppearance, WIDGET_NAMES
} from '../../js/appearance.js';
import {
  PRESETS, TIMER_PRESETS, makeInterval, makeTimer, makeDaily, makeOnce,
  pauseReminder, resumeReminder, scanDue, advance, progress, humanRemain, chime
} from '../../js/reminders.js';
import { CATEGORIES, categoryIcon, preview, parseCommand, normalizeLedgerCategory } from '../../js/command.js';
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
import {
  ROLE_IDS, ROLE_PROFILES, WEBSITE_CATALOG, NOTE_FOLDERS,
  canonicalUrlKey, getRoleProfile, getRolePresetLinks,
  isValidRoleId, planLinkImports, resolveRoleBlocks
} from '../../js/roles.js';

const RAIL_COLLAPSED_KEY = 'lime-rail-collapsed-v2';
const BLOCKS_LAYOUT_KEY = 'lime-blocks-layout-v2';
const STANDUP_DRAFT_KEY = 'lime-standup-draft-v1';
const EXT_STORAGE_KEY = 'lime-workbench-ext-v1';

export const DEFAULT_BLOCKS = [
  { id: 'role-hub', title: '职业专属工作台', span: 12, core: true },
  { id: 'matrix', title: '四象限优先级矩阵', span: 8, widget: 'tasks' },
  { id: 'tasks', title: '今日任务清单', span: 4, core: true },
  { id: 'charts', title: '月度收支与分类图表', span: 8, widget: 'ledger' },
  { id: 'ledger', title: '本月收支与预算', span: 4, widget: 'ledger' },
  { id: 'notes', title: '工作便签（瀑布流）', span: 4, widget: 'notes' },
  { id: 'links', title: '工作链接', span: 4, widget: 'links' },
  { id: 'reminders', title: '近期提醒', span: 4, widget: 'reminders' },
  { id: 'rhythm', title: '近 7 天趋势', span: 6, widget: 'rhythm' },
  { id: 'review', title: '今日复盘', span: 6, widget: 'work' }
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
  projects: '项目进度',
  study: '专注',
  standup: '日报',
  calendar: '日历与提醒',
  bookmarks: '网址导航',
  notes: '知识笔记库',
  toolbox: '职业工具箱',
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
  const nowTick = ref(Date.now());
  const minuteTick = ref(Date.now());
  const currentPage = ref(new URLSearchParams(location.search).get('page') || 'home');
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
  const editingLedgerRecord = ref(null);
  function openLedgerDialog(record = null) {
    editingLedgerRecord.value = record ? { ...record } : null;
    ledgerDialogOpen.value = true;
  }
  function closeLedgerDialog() {
    ledgerDialogOpen.value = false;
    editingLedgerRecord.value = null;
  }
  try {
    railCollapsed.value = localStore.getItem(RAIL_COLLAPSED_KEY) === 'true';
  } catch { /* ignore */ }

  function toggleRailCollapsed() {
    railCollapsed.value = !railCollapsed.value;
    try { localStore.setItem(RAIL_COLLAPSED_KEY, String(railCollapsed.value)); } catch { /* ignore */ }
  }

  // 扩展存储状态（子任务清单、周期性任务规则、月度预算水位线、历史日报归档、独立模块显隐、默认休息时长、月度账单确认状态、多职业角色配置、网址/笔记扩展元数据与项目看板）
  function cleanExtState() {
    return {
      monthlyBudget: 3000,
      breakMinutes: 5,
      roleId: 'general',
      roleChosen: false,
      roleLinksSeeded: false,
      showAllModules: false,
      subtasks: {},
      recurrence: {},
      reportArchive: [],
      hiddenBlocks: [],
      confirmedMonthlyBills: {},
      skippedMonthlyBills: {},
      linkMeta: {},
      noteMeta: {},
      projects: []
    };
  }
  function sanitizeLinkMeta(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      out[key] = {
        category: String(val.category || '通用效率').slice(0, 24),
        desc: String(val.desc || '').slice(0, 120),
        pinned: Boolean(val.pinned),
        visits: Math.max(0, Number(val.visits) || 0),
        lastVisitedAt: Math.max(0, Number(val.lastVisitedAt) || 0)
      };
    }
    return out;
  }
  function sanitizeNoteMeta(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [key, val] of Object.entries(raw)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const folder = String(val.folder || '工作复盘').slice(0, 24);
      out[String(key)] = {
        folder: NOTE_FOLDERS.includes(folder) ? folder : folder || '工作复盘',
        pinned: Boolean(val.pinned)
      };
    }
    return out;
  }
  function sanitizeProjects(raw) {
    if (!Array.isArray(raw)) return [];
    const validModes = new Set(['milestone', 'client', 'course']);
    const validStatus = new Set(['active', 'done', 'paused']);
    return raw.slice(0, 80).filter(p => p && typeof p === 'object' && String(p.name || '').trim()).map(p => ({
      id: String(p.id || `proj-${Date.now()}`),
      mode: validModes.has(p.mode) ? p.mode : 'milestone',
      name: String(p.name).trim().slice(0, 80),
      meta: String(p.meta || '').trim().slice(0, 100),
      target: String(p.target || '').trim().slice(0, 140),
      status: validStatus.has(p.status) ? p.status : 'active',
      amount: Math.max(0, Number(p.amount) || 0),
      paidRecorded: Boolean(p.paidRecorded),
      paidAt: Number(p.paidAt) || 0,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(p.deadline || '')) ? String(p.deadline) : '',
      milestones: Array.isArray(p.milestones)
        ? p.milestones.slice(0, 40).filter(m => m && String(m.text || '').trim()).map((m, idx) => ({
          id: String(m.id || `ms-${Date.now()}-${idx}`),
          text: String(m.text).trim().slice(0, 120),
          done: Boolean(m.done)
        }))
        : [],
      createdAt: Number(p.createdAt) || Date.now(),
      updatedAt: Number(p.updatedAt) || Date.now()
    }));
  }
  function loadExtState() {
    const fallback = cleanExtState();
    try {
      const parsed = JSON.parse(localStore.getItem(EXT_STORAGE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object') return fallback;
      const budget = Number(parsed.monthlyBudget);
      const bMins = Number(parsed.breakMinutes);
      return {
        monthlyBudget: Number.isFinite(budget) && budget >= 100 && budget <= 10_000_000 ? budget : 3000,
        breakMinutes: Number.isInteger(bMins) && bMins >= 1 && bMins <= 120 ? bMins : 5,
        roleId: isValidRoleId(parsed.roleId) ? parsed.roleId : 'general',
        roleChosen: Boolean(parsed.roleChosen),
        roleLinksSeeded: Boolean(parsed.roleLinksSeeded),
        showAllModules: Boolean(parsed.showAllModules),
        subtasks: parsed.subtasks && typeof parsed.subtasks === 'object' && !Array.isArray(parsed.subtasks) ? parsed.subtasks : {},
        recurrence: parsed.recurrence && typeof parsed.recurrence === 'object' && !Array.isArray(parsed.recurrence) ? parsed.recurrence : {},
        reportArchive: Array.isArray(parsed.reportArchive) ? parsed.reportArchive.slice(0, 60).map(item => ({
          ...item,
          doneCount: Number(item?.doneCount ?? item?.stats?.done) || 0,
          doingCount: Number(item?.doingCount ?? item?.stats?.doing) || 0,
          focusMinutes: Number(item?.focusMinutes ?? item?.stats?.focus) || 0,
          stats: {
            done: Number(item?.stats?.done ?? item?.doneCount) || 0,
            doing: Number(item?.stats?.doing ?? item?.doingCount) || 0,
            focus: Number(item?.stats?.focus ?? item?.focusMinutes) || 0
          }
        })) : [],
        hiddenBlocks: Array.isArray(parsed.hiddenBlocks) ? parsed.hiddenBlocks.filter(x => typeof x === 'string') : [],
        confirmedMonthlyBills: parsed.confirmedMonthlyBills && typeof parsed.confirmedMonthlyBills === 'object' ? parsed.confirmedMonthlyBills : {},
        skippedMonthlyBills: parsed.skippedMonthlyBills && typeof parsed.skippedMonthlyBills === 'object' ? parsed.skippedMonthlyBills : {},
        linkMeta: sanitizeLinkMeta(parsed.linkMeta),
        noteMeta: sanitizeNoteMeta(parsed.noteMeta),
        projects: sanitizeProjects(parsed.projects)
      };
    } catch {
      return fallback;
    }
  }
  const extState = reactive(loadExtState());
  function saveExtState() {
    try {
      localStore.setItem(EXT_STORAGE_KEY, JSON.stringify({
        monthlyBudget: extState.monthlyBudget,
        breakMinutes: extState.breakMinutes,
        roleId: extState.roleId,
        roleChosen: extState.roleChosen,
        roleLinksSeeded: extState.roleLinksSeeded,
        showAllModules: extState.showAllModules,
        subtasks: extState.subtasks,
        recurrence: extState.recurrence,
        reportArchive: extState.reportArchive.slice(0, 60),
        hiddenBlocks: extState.hiddenBlocks,
        confirmedMonthlyBills: extState.confirmedMonthlyBills,
        skippedMonthlyBills: extState.skippedMonthlyBills,
        linkMeta: extState.linkMeta,
        noteMeta: extState.noteMeta,
        projects: extState.projects.slice(0, 80)
      }));
    } catch { /* ignore */ }
  }

  const breakMinutes = computed(() => extState.breakMinutes || 5);
  function setBreakMinutes(rawMins) {
    const mins = Math.round(Number(rawMins) || 0);
    if (!Number.isInteger(mins) || mins < 1 || mins > 120) {
      showToast('休息时长需设置在 1–120 分钟之间');
      return false;
    }
    extState.breakMinutes = mins;
    saveExtState();
    showToast(`默认休息时长已设为 ${mins} 分钟`);
    return true;
  }

  // 首页看板布局（顺序与跨列宽度持久化 + 模块显隐同步）
  function loadSavedBlocks() {
    const defaults = DEFAULT_BLOCKS.map(b => ({ ...b }));
    try {
      const raw = JSON.parse(localStore.getItem(BLOCKS_LAYOUT_KEY) || 'null');
      if (!Array.isArray(raw)) return defaults;
      const byId = new Map(defaults.map(b => [b.id, b]));
      const ordered = [];
      for (const item of raw) {
        if (item && byId.has(item.id)) {
          const base = byId.get(item.id);
          const span = [4, 6, 8, 12].includes(Number(item.span)) ? Number(item.span) : base.span;
          ordered.push({ ...base, span });
          byId.delete(item.id);
        }
      }
      if (byId.has('role-hub')) {
        ordered.unshift(byId.get('role-hub'));
        byId.delete('role-hub');
      }
      for (const rest of byId.values()) ordered.push(rest);
      return ordered;
    } catch {
      return defaults;
    }
  }
  const blocks = ref(loadSavedBlocks());
  function persistBlocksLayout() {
    try {
      localStore.setItem(BLOCKS_LAYOUT_KEY, JSON.stringify(blocks.value.map(b => ({ id: b.id, span: b.span }))));
    } catch { /* ignore */ }
  }
  function isBlockVisible(blockOrId) {
    const block = typeof blockOrId === 'string'
      ? blocks.value.find(b => b.id === blockOrId)
      : blockOrId;
    if (!block) return false;
    if (extState.hiddenBlocks.includes(block.id)) return false;
    if (block.core) return true;
    if (block.widget && appearance.widgets?.[block.widget] === false) return false;
    return true;
  }
  const visibleBlocks = computed(() =>
    blocks.value.filter(b => isBlockVisible(b))
  );
  function moveBlock(blockId, delta) {
    const list = [...blocks.value];
    const idx = list.findIndex(b => b.id === blockId);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    blocks.value = list;
    persistBlocksLayout();
  }
  function setBlockSpan(blockId, span) {
    const validSpan = [4, 6, 8, 12].includes(Number(span)) ? Number(span) : 4;
    blocks.value = blocks.value.map(b => b.id === blockId ? { ...b, span: validSpan } : b);
    persistBlocksLayout();
  }
  function toggleBlockVisible(blockId) {
    const block = blocks.value.find(b => b.id === blockId);
    if (!block) return;
    const currentlyVisible = isBlockVisible(block);
    if (currentlyVisible) {
      if (!extState.hiddenBlocks.includes(block.id)) {
        extState.hiddenBlocks = [...extState.hiddenBlocks, block.id];
      }
    } else {
      extState.hiddenBlocks = extState.hiddenBlocks.filter(id => id !== block.id);
      if (block.widget && appearance.widgets?.[block.widget] === false) {
        updateAppearance({
          widgets: { ...appearance.widgets, [block.widget]: true }
        });
      }
    }
    saveExtState();
  }
  function resetBlocksLayout() {
    const resolved = resolveRoleBlocks(extState.roleId, DEFAULT_BLOCKS);
    blocks.value = resolved.blocks;
    extState.hiddenBlocks = resolved.hiddenBlocks;
    saveExtState();
    persistBlocksLayout();
    const allTrue = Object.fromEntries(WIDGET_NAMES.map(name => [name, true]));
    updateAppearance({ widgets: allTrue });
    showToast(`已恢复「${currentRole.value.name}」默认看板布局`);
  }

  // 多职业身份角色、模块映射与常用网站预设包
  const currentRole = computed(() => getRoleProfile(extState.roleId));
  const visibleNavPages = computed(() => {
    if (extState.showAllModules) return PAGE_ORDER;
    return currentRole.value.navPages;
  });

  function syncLinkMetaFromList(candidates) {
    let changed = false;
    for (const item of Array.isArray(candidates) ? candidates : []) {
      const key = canonicalUrlKey(item?.url);
      if (!key) continue;
      const cur = extState.linkMeta[key];
      if (!cur) {
        extState.linkMeta = {
          ...extState.linkMeta,
          [key]: {
            category: String(item.category || '通用效率').slice(0, 24),
            desc: String(item.desc || '').slice(0, 120),
            pinned: false,
            visits: 0,
            lastVisitedAt: 0
          }
        };
        changed = true;
      } else if ((!cur.category || cur.category === '通用效率') && item.category && !cur.desc && item.desc) {
        extState.linkMeta = {
          ...extState.linkMeta,
          [key]: { ...cur, category: item.category, desc: item.desc }
        };
        changed = true;
      }
    }
    if (changed) saveExtState();
  }

  function importWebsitePresets(candidates, { silent = false } = {}) {
    syncLinkMetaFromList(candidates);
    const list = planLinkImports(state.links || [], candidates);
    if (!list.length) {
      if (!silent) showToast('所选常用网站均已在列表中');
      return 0;
    }
    let added = 0;
    const baseNow = Date.now();
    for (let i = 0; i < list.length; i++) {
      if ((state.links || []).length >= COLLECTION_LIMITS.links) break;
      try {
        state.links = upsertLink(state.links || [], {
          title: list[i].title,
          url: list[i].url
        }, baseNow + i);
        added++;
      } catch { /* skip invalid entry */ }
    }
    if (added > 0 && save()) {
      if (!silent) showToast(`已导入 ${added} 个常用网站`);
    } else if (!added && !silent) {
      showToast('常用链接已达数量上限或无可导入网站');
    }
    return added;
  }

  function applyRoleFrame(roleId, { applyLayout = true, seedLinks = true, silent = false } = {}) {
    const profile = getRoleProfile(roleId);
    extState.roleId = profile.id;
    extState.roleChosen = true;
    extState.roleLinksSeeded = true;

    if (applyLayout) {
      const resolved = resolveRoleBlocks(profile.id, DEFAULT_BLOCKS);
      blocks.value = resolved.blocks;
      extState.hiddenBlocks = resolved.hiddenBlocks;
      persistBlocksLayout();
      const allTrue = Object.fromEntries(WIDGET_NAMES.map(name => [name, true]));
      updateAppearance({ widgets: allTrue });
    }
    saveExtState();

    let imported = 0;
    if (seedLinks) {
      imported = importWebsitePresets(getRolePresetLinks(profile.id), { silent: true });
    }

    if (!extState.showAllModules && !profile.navPages.includes(currentPage.value)) {
      goto('home');
    }

    if (!silent) {
      const suffix = imported > 0 ? `，并自动记录 ${imported} 个常用网站` : '';
      showToast(`已切换至「${profile.name}」工作台视图${suffix}`);
    }
  }

  function dismissRolePrompt() {
    extState.roleChosen = true;
    saveExtState();
  }

  function toggleShowAllModules() {
    extState.showAllModules = !extState.showAllModules;
    saveExtState();
    showToast(extState.showAllModules ? '已展开全部侧栏功能模块' : `已按「${currentRole.value.name}」聚焦常用模块`);
  }

  // 跨页快捷预填状态与日报草稿持久化
  const prefillState = reactive({ sport: null, habits: null, todo: null, ledger: null, note: null, link: null, kind: '' });
  function consumePrefill(page) {
    const data = prefillState[page];
    prefillState[page] = null;
    if (prefillState.kind === page) prefillState.kind = '';
    return data;
  }
  function loadStandupDraft() {
    try {
      const parsed = JSON.parse(localStore.getItem(STANDUP_DRAFT_KEY) || '{}');
      return {
        blockers: typeof parsed.blockers === 'string' ? parsed.blockers.slice(0, 300) : '',
        highlights: typeof parsed.highlights === 'string' ? parsed.highlights.slice(0, 300) : ''
      };
    } catch {
      return { blockers: '', highlights: '' };
    }
  }
  const standupDraft = reactive(loadStandupDraft());
  watch(standupDraft, val => {
    try {
      localStore.setItem(STANDUP_DRAFT_KEY, JSON.stringify({
        blockers: String(val.blockers || '').slice(0, 300),
        highlights: String(val.highlights || '').slice(0, 300)
      }));
    } catch { /* ignore */ }
  }, { deep: true });

  // 通用剪贴板复制工具
  async function copyText(text) {
    const content = String(text ?? '');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        showToast('已复制到剪贴板');
        return true;
      }
    } catch { /* fallback below */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('已复制到剪贴板');
      return true;
    } catch {
      showToast('复制失败，请手动选择复制');
      return false;
    }
  }

  // 全局非阻塞确认弹层（替代原生 window.confirm）
  const confirmState = reactive({
    open: false,
    title: '请确认操作',
    message: '',
    confirmText: '确认',
    cancelText: '取消',
    danger: false,
    onConfirm: null
  });
  function askConfirm({ title = '请确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false, onConfirm = null } = {}) {
    confirmState.title = title;
    confirmState.message = message;
    confirmState.confirmText = confirmText;
    confirmState.cancelText = cancelText;
    confirmState.danger = Boolean(danger);
    confirmState.onConfirm = onConfirm;
    confirmState.open = true;
  }
  function closeConfirm() {
    confirmState.open = false;
    confirmState.onConfirm = null;
  }
  function acceptConfirm() {
    const fn = confirmState.onConfirm;
    closeConfirm();
    if (typeof fn === 'function') fn();
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
    // The bar colour used to be written here as a literal pair, which drifted from base.css and
    // only refreshed the first meta tag. applyAppearance() now owns that write.
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
  const PAGE_ORDER = ['home', 'todo', 'projects', 'study', 'standup', 'calendar', 'bookmarks', 'notes', 'toolbox', 'ledger', 'habits', 'sport', 'weather', 'me'];
  const todoFilter = ref('today');
  const toolboxTarget = ref({ group: '', tool: '', ts: 0 });
  const focusEntity = ref({ kind: '', id: null, ts: 0 });
  function openToolbox(group = '', tool = '') {
    toolboxTarget.value = { group: String(group || ''), tool: String(tool || ''), ts: Date.now() };
    goto('toolbox');
  }
  function openEntity(item) {
    if (!item || !item.page) return;
    focusEntity.value = {
      kind: String(item.kind || ''),
      id: item.entityId ?? null,
      ts: Date.now()
    };
    goto(item.page);
  }

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

  // 日期与统计计算属性（按分钟级更新，避免每秒触发全量图表与列表重算）
  const nowDate = computed(() => new Date(minuteTick.value));
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

  function setClockMinutes(date, totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    date.setHours(h, m, 0, 0);
    return date;
  }

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
      start = setClockMinutes(new Date(day), on);
      end = setClockMinutes(new Date(day), off);
      active = now >= start && now < end;
      done = now >= end;
      before = now < start;
    } else {
      const todayOn = setClockMinutes(new Date(day), on);
      const todayOff = setClockMinutes(new Date(day), off);
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
    const rawSpan = Math.max(0, (end - start) / 60000);
    const elapsed = before ? 0 : Math.max(0, Math.min(now, end) - start) / 60000;
    let breakMinutes = 0;
    let totalBreakSpan = 0;
    let inBreak = false;
    const breakOn = timeMinutes(settings.breakStart);
    const breakOff = timeMinutes(settings.breakEnd);
    if (settings.breakStart && settings.breakEnd && breakOn !== breakOff) {
      const breakStart = setClockMinutes(new Date(start), breakOn);
      if (breakOn < on) breakStart.setDate(breakStart.getDate() + 1);
      const breakEnd = setClockMinutes(new Date(breakStart), breakOff);
      if (breakEnd <= breakStart) breakEnd.setDate(breakEnd.getDate() + 1);
      totalBreakSpan = Math.max(0, (Math.min(end, breakEnd) - Math.max(start, breakStart)) / 60000);
      breakMinutes = Math.max(0, (Math.min(now, end, breakEnd) - Math.max(start, breakStart)) / 60000);
      if (before) breakMinutes = 0;
      inBreak = active && now >= breakStart && now < breakEnd;
    }
    const netTotal = Math.max(1, rawSpan - totalBreakSpan);
    const worked = Math.max(0, Math.round(Math.min(rawSpan, elapsed) - Math.min(breakMinutes, elapsed)));
    const percent = rawSpan > 0 ? Math.max(0, Math.min(100, Math.round((worked / netTotal) * 100))) : 0;
    const remaining = Math.max(0, Math.floor((end - now) / 1000));
    return {
      start, end, active, done, before, inBreak, total: netTotal, worked, percent, remaining,
      overnight,
      range: `${settings.onTime}–${settings.offTime}${overnight ? '（跨夜）' : ''}`,
      clock: remaining >= 3600
        ? `${Math.floor(remaining / 3600)}:${pad(Math.floor((remaining % 3600) / 60))}:${pad(remaining % 60)}`
        : `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`
    };
  }

  const todayShift = computed(() => shiftMetrics(todaySchedule.value, new Date(nowTick.value), todaySchedule.value.scheduleSource));

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
    if (metrics.inBreak) {
      return {
        kicker: '午休时间',
        value: `${s.breakEnd} 复工`,
        sub: `距离下班 ${metrics.clock} · 已在岗 ${metrics.worked} 分钟`,
        quiet: false
      };
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
    if (Array.isArray(opts.subtasks) && opts.subtasks.length) {
      setSubtasks(task.id, opts.subtasks);
    }
    if (opts.recurrence && opts.recurrence !== 'none') {
      setTaskRecurrence(task.id, opts.recurrence);
    }
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
    const nextDate = patch.date !== undefined ? patch.date : task.date;
    const nextTime = nextDate ? (patch.time !== undefined ? patch.time : task.time) : '';
    if (patch.time && !nextDate) {
      showToast('设置具体时间时需选择日期');
      return false;
    }
    Object.assign(task, {
      text: title,
      date: nextDate,
      time: nextTime,
      timed: Boolean(nextDate && nextTime),
      priority: patch.priority || task.priority,
      tag
    });
    if (Array.isArray(patch.subtasks)) {
      setSubtasks(task.id, patch.subtasks);
    }
    if (patch.recurrence !== undefined) {
      setTaskRecurrence(task.id, patch.recurrence);
    }
    const warn = syncTaskReminder(task);
    if (!save()) return false;
    if (warn) showToast(warn);
    return true;
  }

  // 子任务清单与周期性任务规则
  function getSubtasks(taskId) {
    const key = String(taskId);
    return Array.isArray(extState.subtasks[key]) ? extState.subtasks[key] : [];
  }
  function setSubtasks(taskId, items) {
    const key = String(taskId);
    const cleaned = (Array.isArray(items) ? items : [])
      .map((item, idx) => ({
        id: item.id || `${Date.now()}-${idx}`,
        text: String(item.text || '').trim().slice(0, 120),
        done: Boolean(item.done)
      }))
      .filter(item => item.text.length > 0)
      .slice(0, 20);
    if (cleaned.length) {
      extState.subtasks = { ...extState.subtasks, [key]: cleaned };
    } else {
      const next = { ...extState.subtasks };
      delete next[key];
      extState.subtasks = next;
    }
    saveExtState();
  }
  function addSubtask(taskId, rawText) {
    const text = String(rawText || '').trim().slice(0, 120);
    if (!text) return false;
    const current = getSubtasks(taskId);
    if (current.length >= 20) {
      showToast('单个任务最多添加 20 项子步骤');
      return false;
    }
    setSubtasks(taskId, [...current, { id: `sub-${Date.now()}-${current.length}`, text, done: false }]);
    return true;
  }
  function toggleSubtask(taskId, subId) {
    const current = getSubtasks(taskId);
    const updated = current.map(s => String(s.id) === String(subId) ? { ...s, done: !s.done } : s);
    setSubtasks(taskId, updated);
  }
  function removeSubtask(taskId, subId) {
    const current = getSubtasks(taskId);
    setSubtasks(taskId, current.filter(s => String(s.id) !== String(subId)));
  }

  const RECURRENCE_LABELS = {
    none: '不重复',
    daily: '每天',
    weekday: '每个工作日',
    weekly: '每周',
    monthly: '每月'
  };
  function getTaskRecurrence(taskId) {
    const freq = extState.recurrence[String(taskId)];
    return ['daily', 'weekday', 'weekly', 'monthly'].includes(freq) ? freq : 'none';
  }
  function setTaskRecurrence(taskId, freq) {
    const key = String(taskId);
    if (['daily', 'weekday', 'weekly', 'monthly'].includes(freq)) {
      extState.recurrence = { ...extState.recurrence, [key]: freq };
    } else {
      const next = { ...extState.recurrence };
      delete next[key];
      extState.recurrence = next;
    }
    saveExtState();
  }
  function computeNextRecurrenceDate(baseDateStr, freq) {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(String(baseDateStr))
      ? new Date(`${baseDateStr}T09:00:00`)
      : new Date(nowDate.value);
    const next = new Date(base);
    if (freq === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (freq === 'weekday') {
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() === 0 || next.getDay() === 6);
    } else if (freq === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (freq === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    }
    return todayKey(next);
  }

  // 四象限优先级矩阵映射与跨象限拖拽同步
  function tomorrowDateStr() {
    const d = new Date(nowDate.value);
    d.setDate(d.getDate() + 1);
    return todayKey(d);
  }
  function quadrantOfTask(task) {
    const isImportant = task.priority === 'high';
    const isUrgent = Boolean(task.date && task.date <= todayStr.value);
    if (isImportant && isUrgent) return 'q1';       // 重要且紧急
    if (isImportant && !isUrgent) return 'q2';      // 重要不紧急
    if (!isImportant && isUrgent) return 'q3';      // 紧急不重要
    return 'q4';                                    // 不重要不紧急
  }
  const matrixQuadrants = computed(() => {
    const open = state.todos.filter(t => !t.done);
    const buckets = { q1: [], q2: [], q3: [], q4: [] };
    for (const task of open) {
      buckets[quadrantOfTask(task)].push(task);
    }
    return buckets;
  });
  function moveTaskToQuadrant(taskId, quadrantId) {
    const task = state.todos.find(t => String(t.id) === String(taskId));
    if (!task) return false;
    const today = todayStr.value;
    const tomorrow = tomorrowDateStr();
    const futureDate = task.date && task.date > today ? task.date : tomorrow;
    const patch = {};
    if (quadrantId === 'q1') {
      patch.priority = 'high';
      patch.date = task.date && task.date <= today ? task.date : today;
    } else if (quadrantId === 'q2') {
      patch.priority = 'high';
      patch.date = futureDate;
    } else if (quadrantId === 'q3') {
      patch.priority = 'medium';
      patch.date = task.date && task.date <= today ? task.date : today;
    } else if (quadrantId === 'q4') {
      patch.priority = 'low';
      patch.date = task.date && task.date > today ? task.date : '';
    } else {
      return false;
    }
    const ok = updateTodo(task.id, patch);
    if (ok) {
      const names = {
        q1: '重要且紧急（今日高优）',
        q2: '重要不紧急（排期高优）',
        q3: '紧急不重要（今日中优）',
        q4: '不重要不紧急（稍后低优）'
      };
      showToast(`已移至「${names[quadrantId]}」`);
    }
    return ok;
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
      // 若配置了周期重复规则，自动生成下一周期的任务实例
      const freq = getTaskRecurrence(task.id);
      if (freq !== 'none' && state.todos.length < COLLECTION_LIMITS.todos) {
        const nextDate = computeNextRecurrenceDate(task.date || todayStr.value, freq);
        const exists = state.todos.some(t => !t.done && t.text === task.text && t.date === nextDate);
        if (!exists) {
          const nextTask = {
            id: nextId(),
            text: task.text,
            done: false,
            date: nextDate,
            time: task.time || '',
            timed: Boolean(nextDate && task.time),
            priority: task.priority || 'medium',
            tag: task.tag || '个人计划'
          };
          state.todos.unshift(nextTask);
          syncTaskReminder(nextTask);
          setTaskRecurrence(nextTask.id, freq);
          const subs = getSubtasks(task.id);
          if (subs.length) {
            setSubtasks(nextTask.id, subs.map(s => ({ ...s, done: false })));
          }
          showToast(`已完成，并自动排入下一周期（${nextDate}）`);
        }
      }
    }
    save();
  }

  function deleteTodo(id) {
    const idx = state.todos.findIndex(t => String(t.id) === String(id));
    if (idx < 0) return false;
    const removed = { ...state.todos[idx] };
    const savedSubs = getSubtasks(id);
    const savedFreq = getTaskRecurrence(id);
    state.todos.splice(idx, 1);
    setSubtasks(id, []);
    setTaskRecurrence(id, 'none');
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
      if (savedSubs.length) setSubtasks(removed.id, savedSubs);
      if (savedFreq !== 'none') setTaskRecurrence(removed.id, savedFreq);
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

  // 账本操作与自定义分类
  const allLedgerCategories = computed(() => {
    const custom = Array.isArray(state.settings.ledgerCats) ? state.settings.ledgerCats : [];
    const seen = new Set(CATEGORIES);
    const seenClean = new Set(CATEGORIES.map(c => c.replace(/^[^\s]+\s*/, '').trim()));
    const extras = [];
    for (const c of custom) {
      const clean = String(c || '').replace(/^🏷\s*/, '').trim();
      if (clean && !seen.has(clean) && !seenClean.has(clean)) {
        seen.add(clean);
        seenClean.add(clean);
        extras.push(clean);
      }
    }
    return [...CATEGORIES, ...extras];
  });

  function addLedgerCategory(rawName) {
    const clean = String(rawName || '').replace(/^🏷\s*/, '').trim();
    if (!clean || !validateText(clean, TEXT_LIMITS.ledgerCategoryName)) {
      showToast(`分类名称需在 1–${TEXT_LIMITS.ledgerCategoryName} 字以内`);
      return null;
    }
    const current = Array.isArray(state.settings.ledgerCats) ? [...state.settings.ledgerCats] : [];
    if (current.length >= COLLECTION_LIMITS.ledgerCats) {
      showToast('自定义分类已达上限');
      return null;
    }
    if (
      current.some(c => String(c).replace(/^🏷\s*/, '').trim() === clean) ||
      CATEGORIES.some(c => c.replace(/^[^\s]+\s*/, '').trim() === clean || c === clean)
    ) {
      showToast('该分类已存在');
      return null;
    }
    state.settings.ledgerCats = [...current, clean];
    if (!save()) return null;
    showToast(`已添加分类「${clean}」`);
    return clean;
  }

  function removeLedgerCategory(catLabel) {
    const raw = String(catLabel || '').replace(/^🏷\s*/, '').trim();
    const current = Array.isArray(state.settings.ledgerCats) ? state.settings.ledgerCats : [];
    const exists = current.some(c => c === raw || String(c).replace(/^🏷\s*/, '').trim() === raw);
    if (!exists) return false;
    state.settings.ledgerCats = current.filter(c => c !== raw && String(c).replace(/^🏷\s*/, '').trim() !== raw);
    if (!save()) return false;
    showToast(`已移除自定义分类「${raw}」`);
    return true;
  }

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
      cat: normalizeLedgerCategory(cat || CATEGORIES[0]),
      date: when
    });
    if (!save()) return false;
    return true;
  }

  function updateLedgerRecord(id, { type, amount, note, cat, date }) {
    const item = state.ledger.find(r => String(r.id) === String(id));
    if (!item) return false;
    const amt = Math.abs(Number(amount ?? item.amount) || 0);
    if (!amt || !Number.isFinite(amt) || amt > 1_000_000_000) {
      showToast('请输入有效金额');
      return false;
    }
    const cleanNote = String(note ?? item.note ?? '').trim() || '记一笔';
    if (!validateText(cleanNote, TEXT_LIMITS.ledgerNote)) {
      showToast('备注内容无效');
      return false;
    }
    const when = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? item.date)) ? String(date ?? item.date) : item.date;
    Object.assign(item, {
      type: (type ?? item.type) === 'income' ? 'income' : 'expense',
      amount: amt,
      note: cleanNote,
      cat: normalizeLedgerCategory((cat ?? item.cat) || CATEGORIES[0]),
      date: when
    });
    if (!save()) return false;
    showToast('账目已更新');
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
      cat: normalizeLedgerCategory(cat || CATEGORIES[0]), note: String(note || '').trim() || clean,
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
      cat: normalizeLedgerCategory(cat || CATEGORIES[0]), note: String(note || '').trim() || clean,
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
      // 每月固定支出/订阅改为生成待确认账单卡片，由用户点击确认后入账
      if (template.frequency === 'monthly') continue;
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

  // 每月固定支出与订阅预设
  const SUBSCRIPTION_PRESETS = [
    { name: '房租与物业', amount: 2800, type: 'expense', cat: '🏠 居住', frequency: 'monthly', dayOfMonth: 1, reminderDays: 3, note: '每月固定房租与物业费' },
    { name: '云服务订阅', amount: 68, type: 'expense', cat: '📚 学习', frequency: 'monthly', dayOfMonth: 5, reminderDays: 3, note: '云服务器与开发者工具订阅' },
    { name: '办公软件会员', amount: 35, type: 'expense', cat: '📚 学习', frequency: 'monthly', dayOfMonth: 10, reminderDays: 3, note: '效率与协作软件月度订阅' },
    { name: '宽带与通讯套餐', amount: 99, type: 'expense', cat: '🏠 居住', frequency: 'monthly', dayOfMonth: 1, reminderDays: 3, note: '宽带及手机通讯月租' }
  ];

  // 月初/当月待确认固定账单（每月订阅模板在当月尚未确认入账且未跳过时生成待确认卡片）
  const pendingMonthlyBills = computed(() => {
    const currentMonth = todayStr.value.slice(0, 7); // YYYY-MM
    const todayDay = Number(todayStr.value.slice(8, 10)) || 1;
    const confirmedIds = Array.isArray(extState.confirmedMonthlyBills?.[currentMonth])
      ? extState.confirmedMonthlyBills[currentMonth].map(String)
      : [];
    const skippedIds = Array.isArray(extState.skippedMonthlyBills?.[currentMonth])
      ? extState.skippedMonthlyBills[currentMonth].map(String)
      : [];

    return (state.settings.ledgerTemplates || [])
      .filter(t => t.frequency === 'monthly' && t.enabled)
      .filter(t => {
        const tid = String(t.id);
        if (confirmedIds.includes(tid) || skippedIds.includes(tid)) return false;
        if (t.lastPosted && String(t.lastPosted).startsWith(currentMonth)) return false;
        const alreadyInLedger = state.ledger.some(r =>
          r.date && r.date.startsWith(currentMonth) &&
          Number(r.amount).toFixed(2) === Number(t.amount).toFixed(2) &&
          r.note === (t.note || t.name)
        );
        return !alreadyInLedger;
      })
      .map(t => {
        const diff = t.dayOfMonth - todayDay;
        const statusLabel = diff === 0
          ? '今日到期'
          : diff < 0
            ? `本月 ${t.dayOfMonth} 日账单待确认`
            : `本月 ${t.dayOfMonth} 日扣款 · 月初预生成`;
        return {
          ...t,
          monthKey: currentMonth,
          statusLabel,
          isDue: diff <= (t.reminderDays ?? 3)
        };
      });
  });

  function confirmMonthlyBill(templateId, customDate = todayStr.value) {
    const t = (state.settings.ledgerTemplates || []).find(item => String(item.id) === String(templateId));
    if (!t) return false;
    const currentMonth = todayStr.value.slice(0, 7);
    const when = /^\d{4}-\d{2}-\d{2}$/.test(String(customDate)) ? customDate : todayStr.value;
    const ok = addLedgerRecord({
      type: t.type,
      amount: t.amount,
      note: t.note || t.name,
      cat: t.cat,
      date: when
    });
    if (!ok) return false;
    t.lastPosted = when;
    save();
    const prev = Array.isArray(extState.confirmedMonthlyBills[currentMonth])
      ? extState.confirmedMonthlyBills[currentMonth]
      : [];
    if (!prev.map(String).includes(String(t.id))) {
      extState.confirmedMonthlyBills = {
        ...extState.confirmedMonthlyBills,
        [currentMonth]: [...prev, String(t.id)]
      };
      saveExtState();
    }
    showToast(`已确认入账「${t.name}」¥${Number(t.amount).toFixed(2)}`);
    return true;
  }

  function confirmAllMonthlyBills() {
    const list = [...pendingMonthlyBills.value];
    if (!list.length) return 0;
    let count = 0;
    for (const bill of list) {
      if (confirmMonthlyBill(bill.id, todayStr.value)) count += 1;
    }
    if (count > 1) {
      showToast(`已批量确认入账 ${count} 笔本月固定账单`);
    }
    return count;
  }

  function skipMonthlyBill(templateId) {
    const t = (state.settings.ledgerTemplates || []).find(item => String(item.id) === String(templateId));
    if (!t) return false;
    const currentMonth = todayStr.value.slice(0, 7);
    const prev = Array.isArray(extState.skippedMonthlyBills[currentMonth])
      ? extState.skippedMonthlyBills[currentMonth]
      : [];
    if (!prev.map(String).includes(String(t.id))) {
      extState.skippedMonthlyBills = {
        ...extState.skippedMonthlyBills,
        [currentMonth]: [...prev, String(t.id)]
      };
      saveExtState();
    }
    showToast(`已跳过本月「${t.name}」待确认账单`);
    return true;
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

  // 便签与知识笔记库操作（Workspace + noteMeta）
  function getNoteMeta(id) {
    const found = extState.noteMeta?.[String(id)];
    return {
      folder: found?.folder || '工作复盘',
      pinned: Boolean(found?.pinned)
    };
  }
  function updateNoteMeta(id, patch = {}) {
    const key = String(id || '');
    if (!key) return;
    const prev = getNoteMeta(key);
    extState.noteMeta = {
      ...extState.noteMeta,
      [key]: {
        folder: patch.folder !== undefined ? String(patch.folder || '工作复盘').slice(0, 24) : prev.folder,
        pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : prev.pinned
      }
    };
    saveExtState();
  }
  function toggleNotePin(id) {
    const prev = getNoteMeta(id);
    updateNoteMeta(id, { pinned: !prev.pinned });
  }

  function saveNoteRecord({ id, title, body, folder, pinned }) {
    try {
      const record = { title: String(title || '').trim(), body: String(body || '') };
      if (id) record.id = Number(id);
      const next = upsertNote(state.notes || [], record, Date.now());
      state.notes = next;
      if (!save()) return false;
      const saved = id
        ? next.find(n => n.id === Number(id))
        : next[0];
      if (saved && (folder !== undefined || pinned !== undefined)) {
        updateNoteMeta(saved.id, { folder, pinned });
      }
      return saved ? saved.id : true;
    } catch (err) {
      showToast(err.message || '便签内容无效');
      return false;
    }
  }

  function removeNoteRecord(id) {
    const before = [...(state.notes || [])];
    const target = before.find(n => n.id === id);
    if (!target) return;
    const prevMeta = extState.noteMeta?.[String(id)] ? { ...extState.noteMeta[String(id)] } : null;
    state.notes = deleteNote(before, id);
    if (!save()) return;
    if (prevMeta) {
      const nextMeta = { ...extState.noteMeta };
      delete nextMeta[String(id)];
      extState.noteMeta = nextMeta;
      saveExtState();
    }
    showUndo(`已删除笔记「${target.title}」`, () => {
      state.notes = before;
      save();
      if (prevMeta) {
        extState.noteMeta = { ...extState.noteMeta, [String(id)]: prevMeta };
        saveExtState();
      }
    });
  }

  // 网址导航与常用链接操作（Workspace + linkMeta）
  function getLinkMeta(url) {
    const key = canonicalUrlKey(url);
    const saved = extState.linkMeta?.[key];
    if (saved) return saved;
    const matched = WEBSITE_CATALOG.find(item => canonicalUrlKey(item.url) === key);
    return {
      category: matched?.category || '通用效率',
      desc: matched?.desc || '',
      pinned: false,
      visits: 0,
      lastVisitedAt: 0
    };
  }
  function updateLinkMeta(url, patch = {}) {
    const key = canonicalUrlKey(url);
    if (!key) return;
    const prev = getLinkMeta(url);
    extState.linkMeta = {
      ...extState.linkMeta,
      [key]: {
        category: patch.category !== undefined ? String(patch.category || '通用效率').slice(0, 24) : prev.category,
        desc: patch.desc !== undefined ? String(patch.desc || '').slice(0, 120) : prev.desc,
        pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : prev.pinned,
        visits: patch.visits !== undefined ? Math.max(0, Number(patch.visits) || 0) : prev.visits,
        lastVisitedAt: patch.lastVisitedAt !== undefined ? Math.max(0, Number(patch.lastVisitedAt) || 0) : prev.lastVisitedAt
      }
    };
    saveExtState();
  }
  function toggleLinkPin(url) {
    const cur = getLinkMeta(url);
    updateLinkMeta(url, { pinned: !cur.pinned });
  }
  function recordLinkVisit(url) {
    const cur = getLinkMeta(url);
    updateLinkMeta(url, { visits: (cur.visits || 0) + 1, lastVisitedAt: Date.now() });
  }

  function saveLinkRecord({ id, title, url, category, desc, pinned }) {
    try {
      const cleanUrl = String(url || '').trim();
      const record = { title: String(title || '').trim(), url: cleanUrl };
      if (id) record.id = Number(id);
      state.links = upsertLink(state.links || [], record, Date.now());
      if (!save()) return false;
      if (category !== undefined || desc !== undefined || pinned !== undefined) {
        updateLinkMeta(cleanUrl, { category, desc, pinned });
      }
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

  // 项目进度 / 客户合同与回款 / 课程与备考看板（Projects）
  const projectsList = computed(() => extState.projects || []);
  function addProject(payload = {}) {
    const name = String(payload.name || '').trim();
    if (!name) {
      showToast('请填写项目 / 客户 / 课程名称');
      return false;
    }
    const milestones = Array.isArray(payload.milestones)
      ? payload.milestones
        .map(m => (typeof m === 'string' ? { text: m, done: false } : m))
        .filter(m => m && String(m.text || '').trim())
        .map((m, idx) => ({
          id: `ms-${Date.now()}-${idx}`,
          text: String(m.text).trim().slice(0, 120),
          done: Boolean(m.done)
        }))
      : [];
    const entry = {
      id: `proj-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      mode: ['milestone', 'client', 'course'].includes(payload.mode) ? payload.mode : (currentRole.value.defaultProjectMode || 'milestone'),
      name: name.slice(0, 80),
      meta: String(payload.meta || '').trim().slice(0, 100),
      target: String(payload.target || '').trim().slice(0, 140),
      status: ['active', 'done', 'paused'].includes(payload.status) ? payload.status : 'active',
      amount: Math.max(0, Number(payload.amount) || 0),
      paidRecorded: Boolean(payload.paidRecorded),
      paidAt: Number(payload.paidAt) || 0,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(payload.deadline || '')) ? String(payload.deadline) : '',
      milestones,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    extState.projects = [entry, ...(extState.projects || [])].slice(0, 80);
    saveExtState();
    showToast(`已创建「${entry.name}」`);
    return entry;
  }
  function updateProject(projectId, patch = {}) {
    const list = [...(extState.projects || [])];
    const idx = list.findIndex(p => p.id === projectId);
    if (idx < 0) return false;
    const prev = list[idx];
    const nextName = patch.name !== undefined ? String(patch.name).trim().slice(0, 80) : prev.name;
    if (!nextName) {
      showToast('名称不能为空');
      return false;
    }
    list[idx] = {
      ...prev,
      mode: ['milestone', 'client', 'course'].includes(patch.mode) ? patch.mode : prev.mode,
      name: nextName,
      meta: patch.meta !== undefined ? String(patch.meta).trim().slice(0, 100) : prev.meta,
      target: patch.target !== undefined ? String(patch.target).trim().slice(0, 140) : prev.target,
      status: ['active', 'done', 'paused'].includes(patch.status) ? patch.status : prev.status,
      amount: patch.amount !== undefined ? Math.max(0, Number(patch.amount) || 0) : prev.amount,
      paidRecorded: patch.paidRecorded !== undefined ? Boolean(patch.paidRecorded) : Boolean(prev.paidRecorded),
      paidAt: patch.paidAt !== undefined ? (Number(patch.paidAt) || 0) : (Number(prev.paidAt) || 0),
      deadline: patch.deadline !== undefined ? (/^\d{4}-\d{2}-\d{2}$/.test(String(patch.deadline)) ? String(patch.deadline) : '') : prev.deadline,
      updatedAt: Date.now()
    };
    extState.projects = list;
    saveExtState();
    return true;
  }
  function deleteProject(projectId) {
    const before = [...(extState.projects || [])];
    const target = before.find(p => p.id === projectId);
    if (!target) return false;
    extState.projects = before.filter(p => p.id !== projectId);
    saveExtState();
    showUndo(`已删除「${target.name}」`, () => {
      extState.projects = before;
      saveExtState();
    });
    return true;
  }
  function addProjectMilestone(projectId, text) {
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) {
      showToast('请输入节点名称');
      return false;
    }
    extState.projects = (extState.projects || []).map(p => {
      if (p.id !== projectId) return p;
      const ms = [...(p.milestones || []), { id: `ms-${Date.now()}`, text: clean, done: false }];
      return { ...p, milestones: ms, updatedAt: Date.now() };
    });
    saveExtState();
    return true;
  }
  function toggleProjectMilestone(projectId, milestoneId) {
    extState.projects = (extState.projects || []).map(p => {
      if (p.id !== projectId) return p;
      const ms = (p.milestones || []).map(m => m.id === milestoneId ? { ...m, done: !m.done } : m);
      const allDone = ms.length > 0 && ms.every(m => m.done);
      return {
        ...p,
        milestones: ms,
        status: allDone ? 'done' : p.status === 'done' ? 'active' : p.status,
        updatedAt: Date.now()
      };
    });
    saveExtState();
  }
  function deleteProjectMilestone(projectId, milestoneId) {
    extState.projects = (extState.projects || []).map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: (p.milestones || []).filter(m => m.id !== milestoneId),
        updatedAt: Date.now()
      };
    });
    saveExtState();
  }
  function editProjectMilestone(projectId, milestoneId, text) {
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) {
      showToast('节点名称不能为空');
      return false;
    }
    extState.projects = (extState.projects || []).map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: (p.milestones || []).map(m => m.id === milestoneId ? { ...m, text: clean } : m),
        updatedAt: Date.now()
      };
    });
    saveExtState();
    showToast('节点已更新');
    return true;
  }
  function pushMilestoneToTodo(project, milestone) {
    if (!project || !milestone) return false;
    const targetText = `[${project.name}] ${milestone.text}`;
    const exists = (state.todos || []).some(t => !t.done && t.text === targetText);
    if (exists) {
      showToast(`「${milestone.text}」已在未完成待办中`);
      return false;
    }
    const task = addTodo(targetText, {
      bucket: 'today',
      date: project.deadline || todayStr.value,
      priority: 'high',
      tag: project.mode === 'course' ? '学习课程' : project.mode === 'client' ? '客户交付' : '项目里程碑'
    });
    if (task) showToast(`已推送「${milestone.text}」至今日待办`);
    return Boolean(task);
  }
  function recordProjectPaymentToLedger(project, amount, noteLabel = '') {
    if (project?.paidRecorded) {
      showToast('该项目款项已全额入账，如需调整请前往账本编辑');
      return false;
    }
    const val = Number(amount || project?.amount || 0);
    if (!Number.isFinite(val) || val <= 0) {
      showToast('请输入有效的入账金额');
      return false;
    }
    const ok = addLedgerRecord({
      type: 'income',
      amount: val,
      cat: '💼 收入',
      note: `${project?.name || '客户项目'}${noteLabel ? ` · ${noteLabel}` : ' 回款'}`
    });
    if (ok) {
      if (project?.id) {
        updateProject(project.id, { paidRecorded: true, paidAt: Date.now() });
      }
      showToast(`已记入账本收入 ¥${val.toFixed(2)}`);
    }
    return ok;
  }
  function seedRoleSampleProjects(roleId = currentRole.value.id) {
    const presets = {
      developer: [
        {
          mode: 'milestone',
          name: '工作台 v2.4 核心重构',
          meta: '前端工程 · Vue 3 + Vite',
          target: '完成导航扩容与单元测试全量绿灯',
          deadline: todayStr.value,
          milestones: [
            { text: '梳理本地存储 Schema 兼容校验', done: true },
            { text: '完成响应式看板与快捷键接入', done: false },
            { text: '补充核心模块单测并执行静态构建', done: false }
          ]
        }
      ],
      creator: [
        {
          mode: 'milestone',
          name: '新品落地页视觉升级',
          meta: 'UI/UX 设计 · Figma 交付',
          target: '输出暗色适配规范与高对比组件库',
          deadline: todayStr.value,
          milestones: [
            { text: '检查主按钮 WCAG AA 对比度', done: true },
            { text: '导出字体与间距比例尺 Token', done: false },
            { text: '设计评审走查与动效标注', done: false }
          ]
        }
      ],
      student: [
        {
          mode: 'course',
          name: '数据结构与算法专项复盘',
          meta: '专业核心课 · 4 学分',
          target: '完成图论与动态规划专题刷题与错题卡片',
          deadline: todayStr.value,
          milestones: [
            { text: '整理树与图遍历模板笔记', done: true },
            { text: '完成 15 道经典动态规划题解', done: false },
            { text: '全真限时模考与耗时分析', done: false }
          ]
        }
      ],
      freelance: [
        {
          mode: 'client',
          name: '品牌官网改版与前端交付',
          meta: '客户 A · 首付 40% / 验收 60%',
          target: '本周五前完成响应式页面联调与尾款请款',
          amount: 12000,
          deadline: todayStr.value,
          milestones: [
            { text: '签约确认需求并收到 40% 首付款', done: true },
            { text: '完成核心交互页面部署预览', done: false },
            { text: '提交最终交付包并开具发票请尾款', done: false }
          ]
        }
      ],
      general: [
        {
          mode: 'milestone',
          name: '个人月度效能提升计划',
          meta: '日常目标 · 每周复盘',
          target: '建立稳定的任务整理与知识沉淀节奏',
          deadline: todayStr.value,
          milestones: [
            { text: '整理本周高优待办与常用网址书签', done: true },
            { text: '沉淀 2 篇工作复盘 Markdown 笔记', done: false },
            { text: '核对本月预算水位与固定账单', done: false }
          ]
        }
      ]
    };
    const list = presets[roleId] || presets.general;
    const existingNames = new Set((extState.projects || []).map(p => p.name));
    let count = 0;
    for (const tpl of list) {
      if (!existingNames.has(tpl.name)) {
        addProject(tpl);
        count++;
      }
    }
    if (!count) showToast('示例项目已在看板中');
    return count;
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

  // 每秒心跳：更新专注倒计时、下班倒计时与到期提醒；分钟级时钟仅在跨分钟时更新
  setInterval(() => {
    const now = Date.now();
    nowTick.value = now;
    if (Math.floor(now / 60000) !== Math.floor(minuteTick.value / 60000)) {
      minuteTick.value = now;
    }
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

  // 快捷跳转与预填执行器
  function execShortcut(shortcut) {
    if (!shortcut || !shortcut.page) return false;
    if (shortcut.kind === 'prefill' && shortcut.payload) {
      prefillState[shortcut.page] = { ...shortcut.payload, ts: Date.now() };
      if (shortcut.page === 'todo' && shortcut.payload.text) {
        goto('todo');
        showToast(`已为你带入「${shortcut.payload.text}」`);
        return true;
      }
    }
    goto(shortcut.page);
    return true;
  }

  // 快捷命令执行器：本地解析或 AI 建议都必须由用户确认后调用一次
  function execIntent(intent) {
    if (!intent) return false;
    const p = intent.payload || {};
    switch (intent.kind) {
      case 'ledger': {
        const ok = addLedgerRecord({ type: p.type, amount: p.amount, note: p.note, cat: p.cat });
        if (ok) showToast(`已记入${p.type === 'income' ? '收入' : '支出'} ¥${Number(p.amount).toFixed(2)} · ${p.note || '记一笔'}`);
        return ok;
      }
      case 'todo': {
        const task = addTodo(p.text || '新任务', {
          bucket: 'today', date: p.date, time: p.time, priority: p.priority, tag: p.tag, text: p.text
        });
        if (task) showToast(`已添加待办「${task.text}」`);
        return Boolean(task);
      }
      case 'sport': {
        const ok = addSportRecord({ type: p.type, minutes: p.minutes, distance: p.distance || 0 });
        if (ok) showToast(`已记录运动 ${p.minutes} 分钟`);
        return ok;
      }
      case 'water': {
        const ok = addWater(Number(p.ml));
        if (ok) showToast(`已记录饮水 +${p.ml} ml`);
        return ok;
      }
      case 'steps': {
        const ok = updateSteps(Number(p.steps));
        if (ok) showToast(`今日步数已更新为 ${p.steps} 步`);
        return ok;
      }
      case 'focus':
        if (!setFocusDuration(Number(p.minutes))) return false;
        applyFocusSettlement(startFocus(state.focus, Date.now()));
        showToast(`已启动 ${p.minutes} 分钟专注计时`);
        return true;
      case 'reminder': {
        const minutes = Number(p.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          showToast('提醒时长需为 1–1440 分钟');
          return false;
        }
        const ok = addCountdownTimer('custom', minutes, String(p.text || '').slice(0, TEXT_LIMITS.reminderLabel));
        if (ok) showToast(`已添加 ${minutes} 分钟后提醒「${p.text}」`);
        return ok;
      }
      case 'study': {
        const seconds = Number(p.minutes) * 60;
        if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86400) {
          showToast('学习时长无效');
          return false;
        }
        state.study[todayKey()] = (state.study[todayKey()] || 0) + seconds;
        if (!save()) return false;
        showToast(`已累计专注学习 +${p.minutes} 分钟`);
        return true;
      }
      case 'note': {
        const title = String(p.title || '').trim();
        if (!title) {
          showToast('便签标题不能为空');
          return false;
        }
        const savedId = saveNoteRecord({ title, body: String(p.body || '').trim() });
        if (savedId) showToast(`已记录便签「${title}」`);
        return Boolean(savedId);
      }
      default:
        return false;
    }
  }

  // 备份导入与导出（完整工作台 Bundle + 向下兼容旧版纯 state 备份；绝不包含 AI 密钥）
  function sanitizeExtState(raw) {
    const fallback = cleanExtState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
    const budget = Number(raw.monthlyBudget);
    const bMins = Number(raw.breakMinutes);
    return {
      monthlyBudget: Number.isFinite(budget) && budget >= 100 && budget <= 10_000_000 ? budget : 3000,
      breakMinutes: Number.isInteger(bMins) && bMins >= 1 && bMins <= 120 ? bMins : 5,
      roleId: isValidRoleId(raw.roleId) ? raw.roleId : 'general',
      roleChosen: Boolean(raw.roleChosen),
      roleLinksSeeded: Boolean(raw.roleLinksSeeded),
      showAllModules: Boolean(raw.showAllModules),
      subtasks: raw.subtasks && typeof raw.subtasks === 'object' && !Array.isArray(raw.subtasks) ? raw.subtasks : {},
      recurrence: raw.recurrence && typeof raw.recurrence === 'object' && !Array.isArray(raw.recurrence) ? raw.recurrence : {},
      reportArchive: Array.isArray(raw.reportArchive) ? raw.reportArchive.slice(0, 60).map(item => ({
        ...item,
        doneCount: Number(item?.doneCount ?? item?.stats?.done) || 0,
        doingCount: Number(item?.doingCount ?? item?.stats?.doing) || 0,
        focusMinutes: Number(item?.focusMinutes ?? item?.stats?.focus) || 0,
        stats: {
          done: Number(item?.stats?.done ?? item?.doneCount) || 0,
          doing: Number(item?.stats?.doing ?? item?.doingCount) || 0,
          focus: Number(item?.stats?.focus ?? item?.focusMinutes) || 0
        }
      })) : [],
      hiddenBlocks: Array.isArray(raw.hiddenBlocks) ? raw.hiddenBlocks.filter(x => typeof x === 'string') : [],
      confirmedMonthlyBills: raw.confirmedMonthlyBills && typeof raw.confirmedMonthlyBills === 'object' && !Array.isArray(raw.confirmedMonthlyBills) ? raw.confirmedMonthlyBills : {},
      skippedMonthlyBills: raw.skippedMonthlyBills && typeof raw.skippedMonthlyBills === 'object' && !Array.isArray(raw.skippedMonthlyBills) ? raw.skippedMonthlyBills : {},
      linkMeta: sanitizeLinkMeta(raw.linkMeta),
      noteMeta: sanitizeNoteMeta(raw.noteMeta),
      projects: sanitizeProjects(raw.projects)
    };
  }

  function sanitizeBlocksLayout(raw) {
    const defaults = DEFAULT_BLOCKS.map(b => ({ ...b }));
    if (!Array.isArray(raw)) return defaults;
    const byId = new Map(defaults.map(b => [b.id, b]));
    const ordered = [];
    for (const item of raw) {
      if (item && byId.has(item.id)) {
        const base = byId.get(item.id);
        const span = [4, 6, 8, 12].includes(Number(item.span)) ? Number(item.span) : base.span;
        ordered.push({ ...base, span });
        byId.delete(item.id);
      }
    }
    if (byId.has('role-hub')) {
      ordered.unshift(byId.get('role-hub'));
      byId.delete('role-hub');
    }
    for (const rest of byId.values()) ordered.push(rest);
    return ordered;
  }

  function exportBackupData() {
    try {
      const stateSnapshot = JSON.parse(JSON.stringify(state));
      parseBackup(JSON.stringify(stateSnapshot));
      const bundle = {
        format: 'lime-workbench-bundle',
        bundleVersion: 1,
        exportedAt: Date.now(),
        state: stateSnapshot,
        extState: {
          monthlyBudget: extState.monthlyBudget,
          breakMinutes: extState.breakMinutes,
          roleId: extState.roleId,
          roleChosen: extState.roleChosen,
          roleLinksSeeded: extState.roleLinksSeeded,
          showAllModules: extState.showAllModules,
          subtasks: extState.subtasks,
          recurrence: extState.recurrence,
          reportArchive: extState.reportArchive.slice(0, 60),
          hiddenBlocks: extState.hiddenBlocks,
          confirmedMonthlyBills: extState.confirmedMonthlyBills,
          skippedMonthlyBills: extState.skippedMonthlyBills,
          linkMeta: extState.linkMeta,
          noteMeta: extState.noteMeta,
          projects: extState.projects.slice(0, 80)
        },
        blocks: blocks.value.map(b => ({ id: b.id, span: b.span })),
        appearance: JSON.parse(JSON.stringify(appearance))
      };
      const compact = JSON.stringify(bundle);
      const pretty = JSON.stringify(bundle, null, 2);
      const json = pretty.length <= MAX_BACKUP_CHARS ? pretty : compact;
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `lime-workbench-${todayKey()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('完整工作台备份已导出（不含 AI 密钥）');
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
      const rawText = await file.text();
      let parsed;
      try { parsed = JSON.parse(rawText); } catch { parsed = null; }

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.format === 'lime-workbench-bundle') {
        const importedState = parseBackup(JSON.stringify(parsed.state));
        store.writeReplacement(importedState);
        Object.assign(state, importedState);

        if (parsed.extState) {
          Object.assign(extState, sanitizeExtState(parsed.extState));
          saveExtState();
        }
        if (parsed.blocks) {
          blocks.value = sanitizeBlocksLayout(parsed.blocks);
          persistBlocksLayout();
        }
        if (parsed.appearance && validateAppearance(parsed.appearance)) {
          updateAppearance(parsed.appearance);
        }
        showToast('完整工作台备份已成功导入');
        return true;
      }

      const imported = parseBackup(rawText);
      store.writeReplacement(imported);
      Object.assign(state, imported);
      showToast('备份已成功导入');
      return true;
    } catch {
      showToast('备份文件格式无效，未覆盖当前数据');
      return false;
    }
  }

  // 月度预算水位线与超支告警 + 历史工作日报归档时间线
  const monthlyBudget = computed(() => extState.monthlyBudget || 3000);
  function setMonthlyBudget(rawVal) {
    const val = Math.round(Number(rawVal) || 0);
    if (!Number.isFinite(val) || val < 100 || val > 10_000_000) {
      showToast('月度预算需设置在 100 – 10,000,000 元之间');
      return false;
    }
    extState.monthlyBudget = val;
    saveExtState();
    showToast(`月度预算已更新为 ¥${val.toLocaleString()}`);
    return true;
  }
  const budgetStatus = computed(() => {
    const budget = monthlyBudget.value;
    const expense = currentMonthSummary.value.expense || 0;
    const remaining = budget - expense;
    const rawPct = budget > 0 ? (expense / budget) * 100 : 0;
    const percent = Math.min(100, Math.round(rawPct));
    const status = rawPct > 100 ? 'over' : rawPct >= 80 ? 'warning' : 'normal';
    const message = status === 'over'
      ? `已超出月度预算 ¥${Math.abs(remaining).toFixed(2)}（${Math.round(rawPct)}%）`
      : status === 'warning'
        ? `已使用 ${Math.round(rawPct)}% 预算，剩余额度 ¥${remaining.toFixed(2)}`
        : `预算水位正常，剩余可用 ¥${remaining.toFixed(2)}`;
    return { budget, expense, remaining, rawPct: Math.round(rawPct), percent, status, message };
  });

  const reportArchive = computed(() => extState.reportArchive || []);
  function archiveStandupReport(payload = {}) {
    const { title, range = 'today', markdown, stats = {}, doneCount, doingCount, focusMinutes } = payload;
    const cleanMd = String(markdown || '').trim();
    if (!cleanMd) {
      showToast('日报内容为空，无法归档');
      return false;
    }
    const doneVal = Number(doneCount ?? stats.done) || 0;
    const doingVal = Number(doingCount ?? stats.doing) || 0;
    const focusVal = Number(focusMinutes ?? stats.focus) || 0;
    const date = todayStr.value;
    const entry = {
      id: `rep-${Date.now()}`,
      date,
      range: range === 'week' ? 'week' : 'today',
      title: String(title || `${date} 工作${range === 'week' ? '周报' : '日报'}`).slice(0, 120),
      markdown: cleanMd.slice(0, 20000),
      doneCount: doneVal,
      doingCount: doingVal,
      focusMinutes: focusVal,
      stats: {
        done: doneVal,
        doing: doingVal,
        focus: focusVal
      },
      createdAt: Date.now()
    };
    const existingIdx = extState.reportArchive.findIndex(r => r.date === date && r.range === entry.range);
    const list = [...extState.reportArchive];
    if (existingIdx >= 0) {
      entry.id = list[existingIdx].id;
      list.splice(existingIdx, 1, entry);
    } else {
      list.unshift(entry);
    }
    extState.reportArchive = list.slice(0, 60);
    saveExtState();
    showToast(existingIdx >= 0 ? '已更新今日归档记录' : '已归档至历史日报时间线');
    return true;
  }
  function deleteArchivedReport(id) {
    const idx = extState.reportArchive.findIndex(r => String(r.id) === String(id));
    if (idx < 0) return false;
    const removed = { ...extState.reportArchive[idx] };
    const next = [...extState.reportArchive];
    next.splice(idx, 1);
    extState.reportArchive = next;
    saveExtState();
    showUndo(`已删除归档「${removed.title}」`, () => {
      const restored = [...extState.reportArchive];
      restored.splice(Math.min(idx, restored.length), 0, removed);
      extState.reportArchive = restored;
      saveExtState();
    });
    return true;
  }

  function clearAllData() {
    const fresh = defaultState();
    try {
      store.writeReplacement(fresh);
    } catch {
      // A locked store (corrupt snapshot, disabled storage) must not report success: the old
      // records would still be there on the next load.
      showToast('清空失败：本机存储为只读，请先导出备份或清理站点数据');
      return false;
    }
    Object.assign(state, fresh);
    Object.assign(extState, cleanExtState());
    saveExtState();
    blocks.value = DEFAULT_BLOCKS.map(b => ({ ...b }));
    standupDraft.blockers = '';
    standupDraft.highlights = '';
    try {
      localStore.removeItem(BLOCKS_LAYOUT_KEY);
    } catch { /* ignore */ }
    showToast('已清空本机工作台记录');
    return true;
  }

  if (typeof window !== 'undefined') {
    autoPostLedgerTemplates();
    watch(todayStr, () => autoPostLedgerTemplates());
    if (!extState.roleLinksSeeded) {
      extState.roleLinksSeeded = true;
      saveExtState();
      if ((state.links || []).length === 0) {
        importWebsitePresets(getRolePresetLinks(extState.roleId), { silent: true });
      } else {
        syncLinkMetaFromList(WEBSITE_CATALOG);
      }
    }
  }

  singleton = {
    state,
    extState,
    appearance,
    storageBlocked,
    nowTick,
    nowDate,
    currentPage,
    todoFilter,
    toolboxTarget,
    openToolbox,
    focusEntity,
    openEntity,
    railCollapsed,
    mobileDrawerOpen,
    breakOpen,
    ledgerDialogOpen,
    editingLedgerRecord,
    openLedgerDialog,
    closeLedgerDialog,
    blocks,
    visibleBlocks,
    moveBlock,
    setBlockSpan,
    isBlockVisible,
    toggleBlockVisible,
    resetBlocksLayout,
    ROLE_IDS,
    ROLE_PROFILES,
    currentRole,
    visibleNavPages,
    applyRoleFrame,
    dismissRolePrompt,
    toggleShowAllModules,
    importWebsitePresets,
    prefillState,
    consumePrefill,
    standupDraft,
    copyText,
    confirmState,
    askConfirm,
    closeConfirm,
    acceptConfirm,
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
    monthlyBudget,
    setMonthlyBudget,
    budgetStatus,
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
    execShortcut,
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
    getSubtasks,
    setSubtasks,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    RECURRENCE_LABELS,
    getTaskRecurrence,
    setTaskRecurrence,
    quadrantOfTask,
    matrixQuadrants,
    moveTaskToQuadrant,
    addWater,
    undoWater,
    updateSteps,
    allLedgerCategories,
    addLedgerCategory,
    removeLedgerCategory,
    addLedgerRecord,
    updateLedgerRecord,
    deleteLedgerRecord,
    addLedgerTemplate,
    updateLedgerTemplate,
    toggleLedgerTemplate,
    deleteLedgerTemplate,
    applyLedgerTemplate,
    autoPostLedgerTemplates,
    SUBSCRIPTION_PRESETS,
    pendingMonthlyBills,
    confirmMonthlyBill,
    confirmAllMonthlyBills,
    skipMonthlyBill,
    upcomingRenewals,
    breakMinutes,
    setBreakMinutes,
    reportArchive,
    archiveStandupReport,
    deleteArchivedReport,
    addSportRecord,
    habits,
    habitToday,
    addHabit,
    checkInHabit,
    clearHabitDay,
    uncheckHabitToday: clearHabitDay,
    deleteHabit,
    deleteSportRecord,
    toggleFocusTimer,
    setFocusDuration,
    linkTaskToFocus,
    setFocusIntentText,
    getNoteMeta,
    updateNoteMeta,
    toggleNotePin,
    saveNoteRecord,
    removeNoteRecord,
    getLinkMeta,
    updateLinkMeta,
    toggleLinkPin,
    recordLinkVisit,
    saveLinkRecord,
    removeLinkRecord,
    moveLinkRecord,
    projectsList,
    addProject,
    updateProject,
    deleteProject,
    addProjectMilestone,
    editProjectMilestone,
    toggleProjectMilestone,
    deleteProjectMilestone,
    pushMilestoneToTodo,
    recordProjectPaymentToLedger,
    seedRoleSampleProjects,
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
