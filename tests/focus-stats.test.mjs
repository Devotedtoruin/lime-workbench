import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutesOn, dailySeries, rangeSummary, heatmapWeeks, focusStreak, currentTaskFocus, focusDayKey
} from '../js/focus-stats.js';

const today = new Date(2026, 9, 18, 15, 0, 0); // 2026-10-18 is a Sunday

// study stores seconds per day
const study = {
  '2026-10-18': 1800, // 30 min
  '2026-10-17': 3600, // 60 min
  '2026-10-16': 900,  // 15 min
  '2026-10-10': 600   // 10 min, previous week
};

test('minutesOn converts seconds and treats missing days as zero', () => {
  assert.equal(minutesOn(study, '2026-10-18'), 30);
  assert.equal(minutesOn(study, '2026-01-01'), 0);
  assert.equal(minutesOn(undefined, '2026-01-01'), 0);
});

test('dailySeries returns the window oldest-first ending today', () => {
  const series = dailySeries(study, 7, today);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).day, '2026-10-18');
  assert.equal(series[0].day, '2026-10-12');
  assert.equal(series.at(-1).minutes, 30);
});

test('rangeSummary totals the window and finds the best day', () => {
  const s = rangeSummary(study, 7, today);
  assert.equal(s.total, 105);
  assert.equal(s.best.day, '2026-10-17');
  assert.equal(s.best.minutes, 60);
  assert.equal(s.average, 15);
});

test('rangeSummary compares against the previous equal window', () => {
  const s = rangeSummary(study, 7, today);
  // Previous 7 days contain 2026-10-10 with 10 minutes.
  assert.equal(s.previous, 10);
  assert.equal(s.changePercent, 950);
});

test('rangeSummary reports no change percent when there is no baseline', () => {
  const s = rangeSummary({ '2026-10-18': 1200 }, 7, today);
  assert.equal(s.previous, 0);
  assert.equal(s.changePercent, null, 'a first week must not claim a percent trend');
});

test('heatmapWeeks aligns rows to Sunday and stops at today', () => {
  const h = heatmapWeeks(study, 2, today);
  const first = new Date(`${h.start}T00:00:00`);
  assert.equal(first.getDay(), 0, 'grid starts on Sunday');
  assert.equal(h.cells.at(-1).day, '2026-10-18', 'grid ends on today');
  assert.equal(h.cells.some(c => c.day > '2026-10-18'), false, 'no future cells are drawn');
});

test('heatmap intensity buckets minutes into 0..4', () => {
  const h = heatmapWeeks(study, 2, today);
  const byDay = Object.fromEntries(h.cells.map(c => [c.day, c.level]));
  assert.equal(byDay['2026-10-18'], 3, '30 minutes');
  assert.equal(byDay['2026-10-17'], 4, '60 minutes');
  assert.equal(byDay['2026-10-16'], 2, '15 minutes');
  assert.equal(byDay['2026-10-15'], 0, 'nothing logged');
});

test('focusStreak counts consecutive days ending today', () => {
  assert.equal(focusStreak(study, today), 3);
});

test('focusStreak keeps yesterday\'s run while today is still open', () => {
  const lastWeek = { '2026-10-17': 1200, '2026-10-16': 600 };
  assert.equal(focusStreak(lastWeek, today), 2);
});

test('focusStreak is zero with no data', () => {
  assert.equal(focusStreak({}, today), 0);
});

test('currentTaskFocus returns the linked task, or null when absent', () => {
  const state = { focus: { taskId: 7 }, todos: [{ id: 7, text: '周报' }, { id: 8, text: '别的' }] };
  assert.deepEqual(currentTaskFocus(state), { id: 7, text: '周报' });
  assert.equal(currentTaskFocus({ focus: { taskId: null }, todos: [] }), null);
  assert.equal(currentTaskFocus({ focus: { taskId: 99 }, todos: [] }), null);
  assert.equal(currentTaskFocus(undefined), null);
});

test('focusDayKey formats a local day', () => {
  assert.equal(focusDayKey(new Date(2026, 9, 18, 23, 59)), '2026-10-18');
});
