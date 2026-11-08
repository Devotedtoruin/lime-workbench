// Focus statistics over the stored per-day minute map.
//
// The state keeps `study` as { 'YYYY-MM-DD': seconds }, written by the focus timer. This module
// only reads it: no new storage, no new state version. Pure and date-injected so the numbers
// can be tested without a clock.
//
// Days with no entry are real zeros, not missing data — the timer only writes when a session
// actually credits time, so an absent day means nothing was focused.

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDay(key) {
  const d = new Date(`${key}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Minutes focused on one day. */
export function minutesOn(study, day) {
  const seconds = Number(study?.[day] || 0);
  return Math.round(seconds / 60);
}

/** Minutes per day for the last `days` days, oldest first. */
export function dailySeries(study, days = 7, today = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    out.push({ day: key, minutes: minutesOn(study, key) });
  }
  return out;
}

/** Totals for the current window plus a comparison against the previous equal window. */
export function rangeSummary(study, days = 7, today = new Date()) {
  const current = dailySeries(study, days, today);
  const total = current.reduce((sum, d) => sum + d.minutes, 0);

  const prevEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  prevEnd.setDate(prevEnd.getDate() - days);
  const previous = dailySeries(study, days, prevEnd);
  const prevTotal = previous.reduce((sum, d) => sum + d.minutes, 0);

  return {
    total,
    previous: prevTotal,
    // Percentage change, or null when there is no baseline to compare against: showing
    // "+100%" for a first week of work would be a made-up trend.
    changePercent: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
    average: Math.round(total / days),
    best: current.reduce((best, d) => (d.minutes > best.minutes ? d : best), { day: '', minutes: 0 }),
    days,
    series: current
  };
}

/**
 * A weekly heatmap over the last `weeks` weeks (Sunday-first rows), for the calendar-style
 * grid. Each cell carries its intensity 0..4 so the caller does not have to re-derive it.
 */
export function heatmapWeeks(study, weeks = 8, today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Walk back to the Sunday that starts this week so columns line up, then to the start of
  // the first week in the window. The grid ends on today, not on Saturday: showing days that
  // have not happened yet would pad the heatmap with cells nobody can fill.
  const startOffset = end.getDay();
  const start = new Date(end);
  start.setDate(start.getDate() - startOffset - (weeks - 1) * 7);

  const cells = [];
  const cursor = new Date(start);
  for (let i = 0; i < weeks * 7; i++) {
    if (cursor > end) break; // the grid ends today; future days are not drawn at all
    const key = dayKey(cursor);
    cells.push({ day: key, minutes: minutesOn(study, key), level: intensity(minutesOn(study, key)) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return { cells, weeks, start: dayKey(start), end: dayKey(end) };
}

/** Buckets minutes into 0..4 so the grid reads as a gradient without needing a legend. */
function intensity(minutes) {
  if (minutes <= 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

/** Current streak of consecutive days with any focus time, ending today. */
export function focusStreak(study, today = new Date()) {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (minutesOn(study, dayKey(cursor)) === 0) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (let i = 0; i < 3660; i++) {
    if (minutesOn(study, dayKey(cursor)) <= 0) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Focus minutes attributed to tasks.
 *
 * The state does not link a focus session to a task id after the fact, so this attributes the
 * linked task recorded at session time (`focus.taskId`) only while a session is running: that
 * is the one attribution the data actually supports. Completed focus per task is not stored,
 * and this function must not invent it.
 */
export function currentTaskFocus(state) {
  const id = state?.focus?.taskId;
  if (id === null || id === undefined) return null;
  const task = (state.todos || []).find(t => String(t.id) === String(id));
  if (!task) return null;
  return { id: task.id, text: task.text };
}

export { dayKey as focusDayKey, parseDay };
