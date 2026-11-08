// Pure task identity and agenda selectors. Explicit dates keep rendering and counts in agreement.
const PRIORITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

/** Numeric task identity only; never coerce DOM strings or infer an ID from a title. */
export function isTaskId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

/** Existing plan buckets, including unfinished overdue tasks in today's bucket. */
export function taskBucket(task, today) {
  if (task.done) return 'done';
  if (!task.date) return 'anytime';
  return task.date <= today ? 'today' : 'upcoming';
}

/**
 * Unfinished, explicitly dated tasks due on/before today. New array, original task objects;
 * date ascending, priority high/medium/low, time ascending (undated time last), stable ties.
 * Input tasks/dates are already schema-validated by the caller. Never sort todos in place.
 */
export function selectTodayTasks(todos, today) {
  return todos.filter(task => taskBucket(task, today) === 'today').sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1) ||
    (a.time || '24:00').localeCompare(b.time || '24:00'));
}

/** Return the one exact numeric ID match, or null for missing/invalid/ambiguous identity. */
export function uniqueTaskById(todos, id) {
  if (!Array.isArray(todos) || !isTaskId(id)) return null;
  let found = null;
  for (const task of todos) {
    if (!task || task.id !== id) continue;
    if (found !== null) return null;
    found = task;
  }
  return found;
}
