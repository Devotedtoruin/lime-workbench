// Explicit focus/task commands. No timers, storage writes, title lookup or automatic completion.
import { normalizePendingAlert } from './state.js';
import { isTaskId, uniqueTaskById } from './tasks.js';

const MAX_TIMESTAMP = Date.UTC(2101, 0, 1);

function commandError(code, reason, message) {
  const error = new Error(message);
  error.code = code;
  error.reason = reason;
  return error;
}

function selectedTask(state, expectedAlert) {
  let expected;
  try { expected = normalizePendingAlert(expectedAlert); } catch {
    throw commandError('FOCUS_TASK_STALE', 'invalid', '专注提醒无效，请重新打开提醒');
  }
  if (expected.sourceKind !== 'focus' || expected.sourceId !== 'focus' ||
      !Array.isArray(state?.pendingAlerts)) {
    throw commandError('FOCUS_TASK_STALE', 'source', '专注提醒已变化，请重新打开提醒');
  }
  // Treat repeated focus sources as ambiguous even if one happens to match the snapshot.
  const occurrences = state.pendingAlerts.filter(alert =>
    alert.sourceKind === expected.sourceKind && alert.sourceId === expected.sourceId);
  if (occurrences.length !== 1 || occurrences[0].dueAt !== expected.dueAt ||
      occurrences[0].taskId !== expected.taskId) {
    throw commandError('FOCUS_TASK_STALE', 'occurrence', '专注提醒已变化，请重新打开提醒');
  }
  const alert = occurrences[0];
  if (!isTaskId(alert.taskId)) {
    throw commandError('FOCUS_TASK_UNAVAILABLE', 'unlinked', '这段专注未关联任务');
  }
  const task = uniqueTaskById(state.todos, alert.taskId);
  if (!task) {
    const ambiguous = Array.isArray(state.todos) &&
      state.todos.filter(item => item?.id === alert.taskId).length > 1;
    throw commandError('FOCUS_TASK_UNAVAILABLE', ambiguous ? 'ambiguous' : 'missing',
      ambiguous ? '任务编号重复，无法安全完成任务' : '关联任务已不存在');
  }
  if (task.done) {
    throw commandError('FOCUS_TASK_UNAVAILABLE', 'done', '关联任务已完成');
  }
  return { alert, task };
}

/**
 * Whether this selected pending focus occurrence still names one unfinished task.
 * expectedAlert is the alert object/snapshot the user saw, NOT the current focus session.
 * Revalidates sourceKind/sourceId + dueAt + taskId; text and snooze are not identity.
 * Missing, done, unlinked, duplicate-ID and stale occurrences all return false.
 */
export function canCompleteFocusTask(state, expectedAlert) {
  try { selectedTask(state, expectedAlert); return true; } catch { return false; }
}

/**
 * Build an immutable state candidate for an EXPLICIT user completion action. The caller
 * must persist the candidate successfully before adopting it. Never toggles done, changes
 * a different task, or completes the session's current task (an A alert may coexist with B).
 * Preserves an existing completedAt, removes exact numeric task-linked reminders and their
 * pending reminder alerts, and acknowledges only the selected focus occurrence. Unrelated
 * objects and the current focus timer retain their references.
 *
 * On stale/invalid occurrence throws Error { code: 'FOCUS_TASK_STALE', reason }.
 * On unlinked/missing/done/ambiguous task throws Error { code: 'FOCUS_TASK_UNAVAILABLE',
 * reason: 'unlinked'|'missing'|'done'|'ambiguous' }. These errors have no state effects;
 * ordinary acknowledgement remains available. Repeated clicks therefore cannot undo
 * completion or overwrite completion history. Invalid now throws RangeError.
 */
export function completeFocusTask(state, expectedAlert, now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError('Invalid task completion timestamp');
  }
  const { alert, task } = selectedTask(state, expectedAlert);
  const completedTask = { ...task, done: true };
  if (!Object.hasOwn(task, 'completedAt')) completedTask.completedAt = now;
  const linkedReminders = state.reminders.filter(reminder => reminder.taskId === task.id);
  const removedSources = new Set(linkedReminders.map(reminder => reminder.id));
  return {
    ...state,
    todos: state.todos.map(item => item === task ? completedTask : item),
    reminders: linkedReminders.length
      ? state.reminders.filter(reminder => reminder.taskId !== task.id) : state.reminders,
    pendingAlerts: state.pendingAlerts.filter(item => item !== alert &&
      !(item.sourceKind === 'reminder' && removedSources.has(item.sourceId)))
  };
}

/**
 * Permanently disarm numeric task links when tasks are deleted/cleared/manually finished.
 * ids is an iterable of numeric IDs (e.g. Array or Set); strings are deliberately ignored.
 * This does NOT delete tasks, reset the timer, acknowledge attention, or restore links on
 * undo. Clears focus.taskId to null; removes matching pending focus alert.taskId while
 * preserving its dueAt/text/snooze. No-op returns state itself; unrelated objects/arrays
 * preserve references. Caller composes task/reminder deletion and persists one candidate.
 */
export function disarmFocusTasks(state, ids) {
  const selected = new Set([...ids].filter(isTaskId));
  if (!selected.size) return state;
  const focus = selected.has(state.focus.taskId) ? { ...state.focus, taskId: null } : state.focus;
  let changed = false;
  const alerts = state.pendingAlerts.map(alert => {
    if (alert.sourceKind !== 'focus' || !selected.has(alert.taskId)) return alert;
    const { taskId, ...unlinked } = alert;
    changed = true;
    return unlinked;
  });
  if (focus === state.focus && !changed) return state;
  return { ...state, focus, pendingAlerts: changed ? alerts : state.pendingAlerts };
}
