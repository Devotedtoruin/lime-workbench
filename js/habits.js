// Habit tracking: the check-in half of "生活习惯", next to water and steps.
//
// Stored shape (v5 compatible — an absent `habits` array reads as "no habits yet"):
//   { id, name, icon, target, createdAt, log: { 'YYYY-MM-DD': count } }
//
// `target` is how many times a day counts as done (1 for most, 2+ for "drink water twice a
// day" style habits). The log stores the count, not a boolean, so a partially-done day is
// visible instead of silently rounding up.
//
// Everything here is pure and date-injected so streaks can be unit-tested without a clock.

export const HABIT_LIMITS = Object.freeze({
  name: 24,
  habits: 20,
  target: 10,
  logDays: 730
});

export const HABIT_ICONS = Object.freeze([
  'sunrise', 'book-open', 'droplet', 'run', 'leaf', 'moon', 'briefcase', 'coffee'
]);

function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' for a Date, in local time (not UTC — a habit day is a local day). */
export function habitDay(date = new Date()) {
  return key(date);
}

export function normaliseHabit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, HABIT_LIMITS.name);
  if (!name) return null;
  const target = Math.min(HABIT_LIMITS.target, Math.max(1, Math.round(Number(raw.target) || 1)));
  // Counts are clamped to the global ceiling, not to this habit's target: a user who lowers
  // the target should keep the history of days they did more, rather than silently losing it.
  const log = {};
  if (raw.log && typeof raw.log === 'object') {
    for (const [day, count] of Object.entries(raw.log)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const n = Math.max(0, Math.min(HABIT_LIMITS.target, Math.round(Number(count) || 0)));
      if (n > 0) log[day] = n;
    }
  }
  return {
    // Keep the caller's id type. The rest of the state uses numeric ids and the backup
    // validator enforces that, so coercing to a string here made every habit fail to save.
    id: raw.id,
    name,
    icon: HABIT_ICONS.includes(raw.icon) ? raw.icon : 'leaf',
    target,
    createdAt: Number(raw.createdAt) || Date.now(),
    log
  };
}

/** Whether a habit reached its target on a given day. */
export function isDone(habit, day) {
  return (habit.log?.[day] || 0) >= (habit.target || 1);
}

/**
 * Consecutive days ending today (or yesterday, so an unchecked today does not zero the
 * streak the user has been keeping). Passing `today` keeps this testable.
 */
export function streakOf(habit, today = habitDay()) {
  const start = new Date(`${today}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  // Today still open: count from yesterday so the streak survives until the day ends.
  if (!isDone(habit, today)) start.setDate(start.getDate() - 1);
  let streak = 0;
  const cursor = new Date(start);
  for (let i = 0; i < HABIT_LIMITS.logDays; i++) {
    if (!isDone(habit, key(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** The last `days` days as [{ day, count, done }], oldest first. */
export function recentDays(habit, days = 7, today = habitDay()) {
  const end = new Date(`${today}T00:00:00`);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const day = key(d);
    const count = habit.log?.[day] || 0;
    out.push({ day, count, done: count >= (habit.target || 1) });
  }
  return out;
}

/** How many habits are complete today, and the proportion — for the summary line. */
export function todayProgress(habits, today = habitDay()) {
  const list = Array.isArray(habits) ? habits : [];
  const done = list.filter(h => isDone(h, today)).length;
  return { done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 };
}

/**
 * Returns a new habit with one increment applied to `day`, clamped to [0, target].
 * Increments past the target are ignored rather than wrapping, so a double-tap
 * cannot silently un-check the habit.
 */
export function checkIn(habit, day = habitDay()) {
  const current = habit.log?.[day] || 0;
  const target = habit.target || 1;
  if (current >= target) return habit;
  return { ...habit, log: { ...habit.log, [day]: current + 1 } };
}

/** Clears a day entirely (used by "undo today"). */
export function clearDay(habit, day = habitDay()) {
  if (!habit.log?.[day]) return habit;
  const log = { ...habit.log };
  delete log[day];
  return { ...habit, log };
}
