import test from 'node:test';
import assert from 'node:assert/strict';
import {
  habitDay, normaliseHabit, isDone, streakOf, recentDays, todayProgress, checkIn, clearDay,
  HABIT_LIMITS
} from '../js/habits.js';

const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
const day = (y, m, d) => habitDay(at(y, m, d));

function habit(over = {}) {
  return { id: 'h1', name: '早起', icon: 'sunrise', target: 1, createdAt: 0, log: {}, ...over };
}

test('habitDay uses the local calendar day, not UTC', () => {
  // Late-evening local time must still count as that local day.
  assert.equal(habitDay(new Date(2026, 9, 18, 23, 30)), '2026-10-18');
  assert.equal(habitDay(new Date(2026, 9, 18, 0, 15)), '2026-10-18');
});

test('normaliseHabit trims, bounds and defaults', () => {
  const h = normaliseHabit({ id: 'x', name: '  读书  ', target: 99, log: { '2026-10-18': 3 } });
  assert.equal(h.name, '读书');
  assert.equal(h.target, HABIT_LIMITS.target);
  // The logged count is preserved as recorded; only lowering the target must not erase history.
  assert.equal(h.log['2026-10-18'], 3);
  assert.equal(h.icon, 'leaf', 'unknown icon falls back');
});

test('normaliseHabit drops invalid log entries and empty names', () => {
  assert.equal(normaliseHabit({ name: '   ' }), null);
  const h = normaliseHabit({ id: 'x', name: 'ok', log: { 'not-a-date': 2, '2026-10-18': 0 } });
  assert.deepEqual(h.log, {}, 'bad dates and zero counts are not stored');
});

test('isDone respects a multi-count target', () => {
  const h = habit({ target: 2, log: { '2026-10-18': 1 } });
  assert.equal(isDone(h, '2026-10-18'), false);
  assert.equal(isDone({ ...h, log: { '2026-10-18': 2 } }, '2026-10-18'), true);
});

test('streak counts backwards from today', () => {
  const h = habit({ log: {
    '2026-10-18': 1, '2026-10-17': 1, '2026-10-16': 1
  } });
  assert.equal(streakOf(h, '2026-10-18'), 3);
});

test('an unfinished today does not zero yesterday\'s streak', () => {
  const h = habit({ log: { '2026-10-17': 1, '2026-10-16': 1 } });
  assert.equal(streakOf(h, '2026-10-18'), 2, 'today still open');
});

test('a gap ends the streak', () => {
  const h = habit({ log: { '2026-10-18': 1, '2026-10-15': 1 } });
  assert.equal(streakOf(h, '2026-10-18'), 1);
});

test('streak is zero when nothing is logged', () => {
  assert.equal(streakOf(habit(), '2026-10-18'), 0);
});

test('recentDays returns the requested window, oldest first, ending today', () => {
  const days = recentDays(habit(), 7, '2026-10-18');
  assert.equal(days.length, 7);
  assert.equal(days.at(-1).day, '2026-10-18');
  assert.equal(days[0].day, '2026-10-12');
});

test('todayProgress reports done, total and percent', () => {
  const habits = [
    habit({ id: 'a', log: { '2026-10-18': 1 } }),
    habit({ id: 'b', log: {} }),
    habit({ id: 'c', target: 2, log: { '2026-10-18': 2 } })
  ];
  assert.deepEqual(todayProgress(habits, '2026-10-18'), { done: 2, total: 3, percent: 67 });
  assert.deepEqual(todayProgress([], '2026-10-18'), { done: 0, total: 0, percent: 0 });
});

test('checkIn increments once and clamps at the target', () => {
  const once = checkIn(habit({ target: 2 }), '2026-10-18');
  assert.equal(once.log['2026-10-18'], 1);
  const twice = checkIn(once, '2026-10-18');
  assert.equal(twice.log['2026-10-18'], 2);
  const past = checkIn(twice, '2026-10-18');
  assert.equal(past, twice, 'no change past the target');
});

test('checkIn does not mutate the original habit', () => {
  const original = habit();
  const next = checkIn(original, '2026-10-18');
  assert.deepEqual(original.log, {});
  assert.notEqual(next, original);
});

test('clearDay removes only that day', () => {
  const h = habit({ log: { '2026-10-18': 1, '2026-10-17': 1 } });
  const cleared = clearDay(h, '2026-10-18');
  assert.equal(cleared.log['2026-10-18'], undefined);
  assert.equal(cleared.log['2026-10-17'], 1);
});

test('clearDay on an empty day returns the same object', () => {
  const h = habit();
  assert.equal(clearDay(h, '2026-10-18'), h);
});
