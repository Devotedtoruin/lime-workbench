import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaskId, taskBucket, selectTodayTasks, uniqueTaskById } from '../js/tasks.js';

const TODAY = '2026-10-15';
const task = (id, patch = {}) => ({ id, text: `任务 ${id}`, done: false, date: TODAY,
  time: '', timed: false, priority: 'medium', tag: '工作', ...patch });

test('task buckets keep overdue/today together and completed/undated/future separate', () => {
  for (const [input, expected] of [
    [task(1, { date: '2026-10-01' }), 'today'], [task(2), 'today'],
    [task(3, { date: '2026-10-16' }), 'upcoming'], [task(4, { date: '' }), 'anytime'],
    [task(5, { done: true, date: '2026-10-01' }), 'done'],
    [task(6, { done: true, date: '' }), 'done'],
    [task(7, { done: true, date: '2026-10-16' }), 'done']
  ]) assert.equal(taskBucket(input, TODAY), expected);
  assert.equal(taskBucket(task(8, { date: '2026-10-16' }), '2026-10-16'), 'today');
});

test('today selector is deterministic by date/priority/time, stable on ties, and immutable', () => {
  const todos = Object.freeze([
    task(1, { date: '' }), task(2, { date: '2026-10-16' }), task(3, { done: true }),
    task(4, { priority: 'low', time: '07:00' }),
    task(5, { priority: 'high', time: '' }),
    task(6, { priority: 'medium', time: '' }),
    task(7, { priority: 'high', time: '15:00' }),
    task(8, { priority: 'high', time: '09:00' }),
    task(9, { priority: 'medium', time: '08:00' }),
    task(10, { date: '2026-10-13', priority: 'low' }),
    task(11, { date: '2026-10-13', priority: 'high', time: '23:00' }),
    task(12, { priority: 'high', time: '09:00' }),
    task(13, { date: '2026-10-12', priority: 'low' })
  ].map(Object.freeze));
  const before = structuredClone(todos);
  const selected = selectTodayTasks(todos, TODAY);
  assert.deepEqual(selected.map(item => item.id), [13, 11, 10, 8, 12, 7, 5, 9, 6, 4]);
  assert.deepEqual(todos, before);
  assert.notEqual(selected, todos);
  for (const item of selected) assert.equal(item, todos.find(original => original.id === item.id));
  selected.pop();
  assert.equal(todos.length, 13);
  assert.deepEqual(selectTodayTasks(todos, TODAY).map(item => item.id),
    [13, 11, 10, 8, 12, 7, 5, 9, 6, 4]);
});

test('today selector excludes undated/done and changes only with the supplied day', () => {
  const todos = [task(1, { date: '' }), task(2), task(3, { done: true }),
    task(4, { date: '2026-10-16' })];
  assert.deepEqual(selectTodayTasks([], TODAY), []);
  assert.deepEqual(selectTodayTasks(todos, '2026-10-14'), []);
  assert.deepEqual(selectTodayTasks(todos, TODAY).map(item => item.id), [2]);
  assert.deepEqual(selectTodayTasks(todos, '2026-10-16').map(item => item.id), [2, 4]);
});

test('task identity is positive safe numeric only, never a title or coerced DOM string', () => {
  for (const id of [1, Number.MAX_SAFE_INTEGER]) assert.equal(isTaskId(id), true);
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '1', '', true, null, undefined, {}, []]) {
    assert.equal(isTaskId(id), false);
    assert.equal(uniqueTaskById([task(1)], id), null);
  }
  const a = task(1, { text: '同名任务' }); const b = task(2, { text: '同名任务', done: true });
  const todos = Object.freeze([Object.freeze(a), Object.freeze(b)]);
  assert.equal(uniqueTaskById(todos, 1), a);
  assert.equal(uniqueTaskById(todos, 2), b); // Selector identifies; commands check unfinished status.
  assert.equal(uniqueTaskById(todos, 3), null);
  assert.equal(uniqueTaskById(todos, '同名任务'), null);
  assert.equal(uniqueTaskById([a, { ...a, done: true }], 1), null);
  assert.equal(uniqueTaskById([a, a], 1), null);
  assert.equal(uniqueTaskById([{ id: '1' }, a], 1), a);
  assert.equal(uniqueTaskById([null, a], 1), a);
  assert.equal(uniqueTaskById(null, 1), null);
});
