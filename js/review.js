// Daily review: what actually happened on a given day, assembled from existing records.
//
// READ-ONLY. Every number here is derived from data the app already stores (completed tasks,
// focus seconds, water entries, step totals, sport rows, habits). Nothing is estimated, and a
// day with no activity returns empty groups rather than a filled-in template.
//
// The point of the review is honesty about a finished day: what got done, what slipped, and
// how much time actually went to focus. It is not a score.

import { minutesOn } from './focus-stats.js';
import { isDone } from './habits.js';

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function reviewFor(day, state) {
  const completed = [];
  const open = [];

  for (const task of state.todos || []) {
    if (task.date !== day) continue;
    if (task.done) completed.push({ id: task.id, text: task.text, time: task.time || '' });
    else open.push({ id: task.id, text: task.text, time: task.time || '' });
  }
  // Tasks finished on this day but scheduled for another day still count as done today.
  const finishedElsewhere = (state.todos || []).filter(task => {
    if (!task.done || !task.completedAt || task.date === day) return false;
    return dayKey(new Date(task.completedAt)) === day;
  }).map(task => ({ id: task.id, text: task.text, time: task.time || '' }));

  const water = (state.water?.[day] || []).reduce((sum, entry) => sum + Number(entry.ml || 0), 0);
  const steps = Number(state.steps?.[day] || 0);
  const sport = (state.sport || []).filter(r => r.date === day)
    .map(r => ({ id: r.id, type: r.type, minutes: r.minutes, distance: r.distance || 0 }));

  const habits = (state.habits || []).map(h => ({
    id: h.id,
    name: h.name,
    done: isDone(h, day),
    count: h.log?.[day] || 0,
    target: h.target || 1
  }));

  return {
    day,
    completed,
    finishedElsewhere,
    open,
    focusMinutes: minutesOn(state.study, day),
    water,
    steps,
    sport,
    habits,
    habitsDone: habits.filter(h => h.done).length,
    // Free-text note the user may keep for the day; stored under settings, so it survives
    // without a new state field.
    note: (state.reviewNotes || {})[day] || '',
    empty: completed.length === 0 && finishedElsewhere.length === 0 && open.length === 0 &&
      minutesOn(state.study, day) === 0 && water === 0 && steps === 0 && sport.length === 0
  };
}

/** A short, factual one-liner for the day — used as the heading of the review card. */
export function reviewHeadline(review) {
  const parts = [];
  if (review.completed.length + review.finishedElsewhere.length) {
    parts.push(`完成 ${review.completed.length + review.finishedElsewhere.length} 项`);
  }
  if (review.focusMinutes) parts.push(`专注 ${review.focusMinutes} 分钟`);
  if (review.habitsDone) parts.push(`习惯 ${review.habitsDone}/${review.habits.length}`);
  if (!parts.length) return '这一天没有记录';
  return parts.join(' · ');
}

export { dayKey as reviewDayKey };
