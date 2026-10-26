import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFor, reviewHeadline } from '../js/review.js';

const DAY = '2026-10-18';

function state(over = {}) {
  return {
    todos: [
      { id: 1, text: '写周报', done: true, date: DAY, time: '18:00', completedAt: Date.UTC(2026, 9, 18, 10) },
      { id: 2, text: '对齐视觉', done: false, date: DAY, time: '14:30' },
      { id: 3, text: '明天的会', done: false, date: '2026-10-19', time: '' },
      { id: 4, text: '提前完成的事', done: true, date: '2026-10-20', completedAt: Date.UTC(2026, 9, 18, 3) }
    ],
    study: { [DAY]: 3300 },
    water: { [DAY]: [{ ml: 250 }, { ml: 500 }] },
    steps: { [DAY]: 4200 },
    sport: [{ id: 9, type: 'run', minutes: 30, distance: 5, date: DAY }],
    habits: [
      { id: 'a', name: '早起', target: 1, log: { [DAY]: 1 } },
      { id: 'b', name: '读书', target: 1, log: {} }
    ],
    ...over
  };
}

test('review separates done, open and out-of-day completions', () => {
  const r = reviewFor(DAY, state());
  assert.deepEqual(r.completed.map(t => t.text), ['写周报']);
  assert.deepEqual(r.open.map(t => t.text), ['对齐视觉']);
  assert.deepEqual(r.finishedElsewhere.map(t => t.text), ['提前完成的事']);
});

test('review reads focus, water, steps and sport from the day', () => {
  const r = reviewFor(DAY, state());
  assert.equal(r.focusMinutes, 55);
  assert.equal(r.water, 750);
  assert.equal(r.steps, 4200);
  assert.deepEqual(r.sport, [{ id: 9, type: 'run', minutes: 30, distance: 5 }]);
});

test('review reports habit completion against targets', () => {
  const r = reviewFor(DAY, state());
  assert.equal(r.habitsDone, 1);
  assert.equal(r.habits.length, 2);
  assert.equal(r.habits.find(h => h.name === '读书').done, false);
});

test('review does not claim data for a day with nothing on it', () => {
  const r = reviewFor('2026-01-01', state());
  assert.equal(r.empty, true);
  assert.equal(r.focusMinutes, 0);
  assert.equal(r.water, 0);
  assert.deepEqual(r.completed, []);
});

test('review uses recorded counts rather than estimating', () => {
  const r = reviewFor(DAY, state({ study: {}, water: {}, steps: {} }));
  assert.equal(r.focusMinutes, 0);
  assert.equal(r.water, 0);
  assert.equal(r.steps, 0);
});

test('headline states only what happened', () => {
  assert.equal(reviewHeadline(reviewFor(DAY, state())), '完成 2 项 · 专注 55 分钟 · 习惯 1/2');
  const quiet = reviewFor('2026-01-01', state());
  assert.equal(reviewHeadline(quiet), '这一天没有记录');
});

test('headline omits habits when none are defined', () => {
  const r = reviewFor(DAY, state({ habits: [] }));
  assert.equal(reviewHeadline(r), '完成 2 项 · 专注 55 分钟');
});
