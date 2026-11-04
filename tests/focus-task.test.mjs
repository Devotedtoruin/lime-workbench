import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, parseBackup, parseStoredState } from '../js/state.js';
import { startFocus, settleFocus } from '../js/focus.js';
import { canCompleteFocusTask, completeFocusTask, disarmFocusTasks } from '../js/focus-task.js';
import { createStateStore } from '../js/storage.js';

const T0 = Date.UTC(2026, 9, 15, 9);
const task = (id, patch = {}) => ({ id, text: '同名任务 < 安全数据', done: false,
  date: '2026-10-15', time: '', timed: false, priority: 'high', tag: '工作', ...patch });
const focusAlert = (patch = {}) => ({ sourceKind: 'focus', sourceId: 'focus',
  label: '专注完成', text: '任务 A < 已专注', icon: 'tomato', dueAt: T0,
  snoozedUntil: null, taskId: 1, ...patch });
const reminder = (id, taskId) => ({ id, kind: 'timer', icon: 'alarm', label: '提醒',
  text: '提醒', minutes: 5, startAt: T0, endAt: T0 + 300_000, enabled: true,
  ...(taskId !== undefined ? { taskId } : {}) });
const reminderAlert = sourceId => ({ ...focusAlert(), sourceKind: 'reminder', sourceId });
const attention = sourceId => { const { taskId, ...alert } = reminderAlert(sourceId); return alert; };

function fixture() {
  const state = defaultState();
  state.todos = [task(1), task(2)];
  state.focus = startFocus({ ...state.focus, text: '任务 B 正在运行', taskId: 2 }, T0).session;
  state.reminders = [reminder('a-1', 1), reminder('b-2', 2), reminder('a-2', 1),
    reminder('legacy-string', '1'), reminder('unlinked')];
  state.pendingAlerts = [attention('a-1'), focusAlert(), attention('b-2'),
    attention('a-2'), attention('legacy-string'), attention('independent')];
  return state;
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function assertCommandError(state, expected, code, reason) {
  const before = structuredClone(state);
  assert.equal(canCompleteFocusTask(state, expected), false);
  assert.throws(() => completeFocusTask(state, expected, T0 + 5000), error =>
    error instanceof Error && error.code === code && error.reason === reason);
  assert.deepEqual(state, before);
}

test('explicit completion atomically finishes exact task A and acknowledges only its selected occurrence', () => {
  const state = freezeDeep(fixture()); const expected = { ...state.pendingAlerts[1] };
  assert.equal(canCompleteFocusTask(state, expected), true);
  const candidate = completeFocusTask(state, expected, T0 + 5000);
  assert.notEqual(candidate, state);
  assert.notEqual(candidate.todos, state.todos);
  assert.deepEqual(candidate.todos[0], { ...state.todos[0], done: true, completedAt: T0 + 5000 });
  assert.equal(state.todos[0].done, false);
  assert.equal(Object.hasOwn(state.todos[0], 'completedAt'), false);
  assert.equal(candidate.todos[1], state.todos[1]); // Equal text never targets B.
  assert.equal(candidate.focus, state.focus); // Old A alert must not stop, reset, or disarm current B.
  assert.equal(candidate.focus.taskId, 2);
  assert.equal(candidate.focus.running, true);
  assert.deepEqual(candidate.reminders.map(item => item.id), ['b-2', 'legacy-string', 'unlinked']);
  assert.deepEqual(candidate.pendingAlerts.map(item => item.sourceId),
    ['b-2', 'legacy-string', 'independent']);
  assert.equal(candidate.reminders[0], state.reminders[1]);
  assert.equal(candidate.pendingAlerts[0], state.pendingAlerts[2]);
  for (const key of Object.keys(state).filter(key => !['todos', 'reminders', 'pendingAlerts'].includes(key))) {
    assert.equal(candidate[key], state[key]);
  }
  assert.deepEqual(parseBackup(JSON.stringify(candidate)), candidate);
  assertCommandError(candidate, expected, 'FOCUS_TASK_STALE', 'occurrence');
});

test('focus completion never toggles a done task or overwrites existing completion history', () => {
  const state = fixture(); state.todos[0].completedAt = 0;
  const candidate = completeFocusTask(freezeDeep(state), state.pendingAlerts[1], T0 + 5000);
  assert.equal(candidate.todos[0].completedAt, 0);
  const stillPending = { ...candidate, pendingAlerts: state.pendingAlerts };
  assertCommandError(stillPending, state.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'done');
  assert.equal(stillPending.todos[0].completedAt, 0);
  const fresh = fixture();
  assert.equal(completeFocusTask(fresh, fresh.pendingAlerts[1], 0).todos[0].completedAt, 0);
});

test('current focus identity is not the completion target, including unlinked or same-A current sessions', () => {
  for (const taskId of [null, 1, 2]) {
    const state = fixture(); state.focus = { ...state.focus, taskId };
    const candidate = completeFocusTask(freezeDeep(state), state.pendingAlerts[1], T0 + 5000);
    assert.equal(candidate.focus, state.focus);
    assert.equal(candidate.todos[0].done, true);
    assert.equal(candidate.todos[1].done, false);
  }
});

test('source kind/id, deadline and numeric task identity must still match the exact selected occurrence', () => {
  const state = freezeDeep(fixture()); const selected = state.pendingAlerts[1];
  for (const expected of [
    { ...selected, dueAt: selected.dueAt - 1 }, { ...selected, dueAt: selected.dueAt + 1 },
    { ...selected, taskId: 2 },
    (({ taskId, ...unlinked }) => unlinked)(selected)
  ]) assertCommandError(state, expected, 'FOCUS_TASK_STALE', 'occurrence');
  const nonfocus = attention('b-2');
  assertCommandError(state, nonfocus, 'FOCUS_TASK_STALE', 'source');
  for (const expected of [null, {}, { ...selected, sourceId: 'other-focus' },
    { ...selected, taskId: '1' }, { ...selected, taskId: null }]) {
    assertCommandError(state, expected, 'FOCUS_TASK_STALE', 'invalid');
  }
  const replaced = fixture(); replaced.pendingAlerts[1] = focusAlert({ dueAt: T0 + 60_000 });
  assertCommandError(freezeDeep(replaced), selected, 'FOCUS_TASK_STALE', 'occurrence');
  const duplicate = fixture(); duplicate.pendingAlerts.push(focusAlert({ dueAt: T0 + 60_000, taskId: 2 }));
  assertCommandError(freezeDeep(duplicate), selected, 'FOCUS_TASK_STALE', 'occurrence');
  const acknowledged = fixture(); acknowledged.pendingAlerts.splice(1, 1);
  assertCommandError(freezeDeep(acknowledged), selected, 'FOCUS_TASK_STALE', 'occurrence');
});

test('text edits, labels and snoozes are not occurrence identity and cannot redirect the task', () => {
  const state = fixture(); const expected = { ...state.pendingAlerts[1] };
  state.pendingAlerts[1] = { ...state.pendingAlerts[1], text: '已编辑 A', label: '编辑标签',
    snoozedUntil: T0 + 300_000 };
  state.todos[0].text = '重命名后的 A';
  assert.equal(canCompleteFocusTask(state, expected), true);
  const candidate = completeFocusTask(freezeDeep(state), expected, T0 + 5000);
  assert.equal(candidate.todos[0].text, '重命名后的 A');
  assert.equal(candidate.todos[0].done, true);
  assert.equal(candidate.todos[1].done, false);
});

test('missing, completed, unlinked or ambiguous task identities fail closed without dismissing attention', () => {
  const missing = fixture(); missing.todos = [task(2)];
  assertCommandError(freezeDeep(missing), missing.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'missing');
  const done = fixture(); done.todos[0] = task(1, { done: true, completedAt: T0 - 1000 });
  assertCommandError(freezeDeep(done), done.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'done');
  const unlinked = fixture(); delete unlinked.pendingAlerts[1].taskId;
  assertCommandError(freezeDeep(unlinked), unlinked.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'unlinked');
  const duplicate = fixture(); duplicate.todos.push(task(1, { done: true }));
  assertCommandError(freezeDeep(duplicate), duplicate.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'ambiguous');
  const repeatedObject = fixture(); repeatedObject.todos.push(repeatedObject.todos[0]);
  assertCommandError(freezeDeep(repeatedObject), repeatedObject.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'ambiguous');
  const stringOnly = fixture(); stringOnly.todos = [task('1'), task(2)];
  assertCommandError(freezeDeep(stringOnly), stringOnly.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'missing');
});

test('invalid completion timestamps throw before producing a candidate or changing state', () => {
  const state = freezeDeep(fixture()); const before = structuredClone(state);
  for (const now of [undefined, null, '123', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER,
    Date.UTC(2101, 0, 1) + 1]) {
    assert.throws(() => completeFocusTask(state, state.pendingAlerts[1], now), RangeError);
    assert.deepEqual(state, before);
  }
});

test('timer expiry does not auto-complete tasks and restored A attention still safely targets A', () => {
  const state = fixture();
  const roundA = startFocus({ ...defaultState().focus, total: 5, remaining: 5,
    text: state.todos[0].text, taskId: 1 }, T0).session;
  const settled = settleFocus(roundA, T0 + 5000);
  assert.equal(settled.completed, true);
  assert.equal(state.todos[0].done, false);
  const alert = focusAlert({ ...settled.completionContext });
  state.pendingAlerts[1] = alert;
  const restored = parseStoredState(JSON.stringify(state));
  assert.equal(restored.todos[0].done, false);
  assert.equal(restored.focus.taskId, 2);
  const candidate = completeFocusTask(freezeDeep(restored), { ...alert }, T0 + 60_000);
  assert.equal(candidate.todos[0].done, true);
  assert.equal(candidate.todos[1].done, false);
  assert.equal(candidate.focus, restored.focus);
});

test('disarming clears matching numeric focus links and only pending focus metadata, never the timer or text', () => {
  const state = fixture(); state.focus.taskId = 1;
  state.pendingAlerts[1].snoozedUntil = T0 + 300_000;
  const before = structuredClone(state); freezeDeep(state);
  const candidate = disarmFocusTasks(state, [1, '2', -1, null]);
  assert.deepEqual(candidate.focus, { ...state.focus, taskId: null });
  const { taskId, ...unlinkedAlert } = state.pendingAlerts[1];
  assert.deepEqual(candidate.pendingAlerts[1], unlinkedAlert);
  assert.equal(Object.hasOwn(candidate.pendingAlerts[1], 'taskId'), false);
  for (const key of Object.keys(state).filter(key => !['focus', 'pendingAlerts'].includes(key))) {
    assert.equal(candidate[key], state[key]);
  }
  assert.equal(candidate.pendingAlerts[0], state.pendingAlerts[0]);
  assert.deepEqual(state, before);
  assert.equal(disarmFocusTasks(candidate, new Set([1])), candidate);
  assert.equal(canCompleteFocusTask(candidate, candidate.pendingAlerts[1]), false);
  assert.deepEqual(parseBackup(JSON.stringify(candidate)), candidate);
});

test('disarming A keeps current B intact, and disarming B leaves old A attention intact', () => {
  const state = freezeDeep(fixture());
  const disarmedA = disarmFocusTasks(state, new Set([1]));
  assert.equal(disarmedA.focus, state.focus);
  assert.equal(Object.hasOwn(disarmedA.pendingAlerts[1], 'taskId'), false);
  assert.equal(disarmedA.pendingAlerts[1].dueAt, state.pendingAlerts[1].dueAt);
  const disarmedB = disarmFocusTasks(state, [2]);
  assert.equal(disarmedB.focus.taskId, null);
  assert.equal(disarmedB.pendingAlerts, state.pendingAlerts);
  assert.equal(disarmedB.pendingAlerts[1], state.pendingAlerts[1]);
  for (const ids of [[], ['1', '2'], [0, -1, NaN, Infinity, {}, null], new Set([999])]) {
    assert.equal(disarmFocusTasks(state, ids), state);
  }
  const both = disarmFocusTasks(state, [1, 2]);
  assert.equal(both.focus.taskId, null);
  assert.equal(Object.hasOwn(both.pendingAlerts[1], 'taskId'), false);
});

test('disarmed task metadata cannot silently re-arm when the task is undone or recreated', () => {
  const state = fixture(); state.focus.taskId = 1;
  const disarmed = disarmFocusTasks(freezeDeep(state), [1]);
  const restoredTask = { ...disarmed, todos: [task(1), task(2)] };
  assert.equal(restoredTask.focus.taskId, null);
  assertCommandError(restoredTask, restoredTask.pendingAlerts[1], 'FOCUS_TASK_UNAVAILABLE', 'unlinked');
  assertCommandError(restoredTask, state.pendingAlerts[1], 'FOCUS_TASK_STALE', 'occurrence');
});

test('completion candidate is committed as one write and quota/conflict failures preserve the old state', () => {
  const original = fixture(); const raw = JSON.stringify(original);
  let bytes = raw; let writes = 0;
  const disk = { getItem: () => bytes, setItem: (_, value) => { writes++; bytes = value; } };
  const store = createStateStore(disk);
  const candidate = completeFocusTask(freezeDeep(original), original.pendingAlerts[1], T0 + 5000);
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.write(candidate), /quota/);
  assert.equal(bytes, raw); assert.deepEqual(store.rollback(), original);
  assert.equal(original.todos[0].done, false);
  disk.setItem = (_, value) => { writes++; bytes = value; };
  assert.equal(store.write(candidate), true);
  assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(bytes), candidate);
  const staleStore = createStateStore(disk);
  const external = { ...candidate, settings: { ...candidate.settings, displayName: 'other page' } };
  bytes = JSON.stringify(external);
  assert.throws(() => staleStore.write(original), error => error.code === 'STORAGE_CONFLICT');
  assert.deepEqual(JSON.parse(bytes), external);
  assert.equal(writes, 1);
});
