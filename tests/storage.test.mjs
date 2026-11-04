import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateStore, unavailableStorage } from '../js/storage.js';
import { defaultState, MAX_BACKUP_CHARS, CURRENT_STATE_VERSION, SUPPORTED_STATE_VERSIONS } from '../js/state.js';

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}

test('persisted state validates and round trips without changing the candidate', () => {
  const disk = memoryStorage();
  const store = createStateStore(disk);
  const candidate = defaultState(); candidate.settings.displayName = '我 < 同事';
  assert.equal(store.write(candidate), true);
  assert.deepEqual(store.rollback(), candidate);
});

test('quota failure leaves the previous state intact for rollback', () => {
  const old = defaultState(); old.settings.salary = 9000;
  const disk = memoryStorage(JSON.stringify(old));
  const store = createStateStore(disk);
  disk.setItem = () => { throw new Error('quota'); };
  const next = defaultState(); next.settings.salary = 12000;
  assert.throws(() => store.write(next), /quota/);
  assert.deepEqual(store.rollback(), old);
  assert.deepEqual(JSON.parse(disk.getItem()), old);
  assert.equal(store.canWrite, true);
  disk.setItem = (_, value) => { disk.getItem = () => value; };
  assert.equal(store.write(next), true);
  assert.deepEqual(store.rollback(), next);
});

test('disabled local storage cannot crash the read or report a successful save', () => {
  const store = createStateStore(unavailableStorage());
  assert.ok(store.readError);
  assert.deepEqual(store.initial, defaultState());
  assert.equal(store.canWrite, false);
  assert.match(store.blockedReason, /不允许本地存储/);
  assert.equal(store.rawText(), null);
  assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
  assert.throws(() => store.writeReplacement(defaultState()), error => error.code === 'STORAGE_READONLY');
});

test('invalid writes and over-limit backups do not alter storage', () => {
  const disk = memoryStorage(); const store = createStateStore(disk);
  const candidate = defaultState(); candidate.settings.salary = -5;
  assert.throws(() => store.write(candidate), /Invalid backup/);
  assert.equal(disk.getItem(), null);
  assert.throws(() => store.write({ ...defaultState(), huge: 'x'.repeat(MAX_BACKUP_CHARS) }), /容量上限/);
  assert.equal(disk.getItem(), null);
});

test('another page update is never overwritten by a stale snapshot', () => {
  const disk = memoryStorage(); const first = createStateStore(disk); const second = createStateStore(disk);
  const next = defaultState(); next.settings.displayName = '另一个窗口';
  first.write(next);
  assert.throws(() => second.write(defaultState()), error => error.code === 'STORAGE_CONFLICT');
  assert.deepEqual(second.rollback(), next);
  assert.deepEqual(second.refresh(), next);
  assert.equal(second.write(next), true);
});

test('missing fresh storage is writable and supported v1/v2/v3 migration preserves repairable rows', () => {
  const fresh = createStateStore(memoryStorage());
  assert.equal(fresh.readError, null);
  assert.equal(fresh.canWrite, true);
  assert.equal(fresh.blockedReason, '');
  assert.equal(fresh.rawText(), null);
  assert.equal(fresh.write(defaultState()), true);
  for (const version of [undefined, ...SUPPORTED_STATE_VERSIONS]) {
    const legacy = { settings: { salary: 12345 }, todos: [{ id: 1, text: 'valid' },
      { id: 2, text: 'bad\u0000' }], ledger: [] };
    if (version !== undefined) legacy.version = version;
    const raw = JSON.stringify(legacy);
    const disk = memoryStorage(raw); const store = createStateStore(disk);
    assert.equal(store.canWrite, true);
    assert.equal(store.rawText(), raw);
    assert.equal(store.initial.version, CURRENT_STATE_VERSION);
    assert.equal(store.initial.todos.length, 1);
    assert.equal(store.initial.settings.salary, 12345);
    assert.deepEqual(store.initial.notes, []); assert.deepEqual(store.initial.links, []);
    assert.equal(store.write(store.initial), true);
    assert.deepEqual(JSON.parse(disk.getItem()), store.initial);
  }
});

test('v3 task links persist and repair independently without read-only lock or timer/alert loss', () => {
  const now = Date.UTC(2026, 9, 12, 9);
  const valid = defaultState();
  valid.focus = { ...valid.focus, remaining: 15.5, running: true, dueAt: now + 15_500,
    lastCreditedAt: now, text: '不要丢掉计时', taskId: 123 };
  valid.pendingAlerts = [{ sourceKind: 'focus', sourceId: 'focus', label: '专注完成',
    text: '旧任务 < A', icon: 'tomato', dueAt: now - 1000, snoozedUntil: now + 300_000,
    taskId: 456 }];
  const disk = memoryStorage(); const store = createStateStore(disk);
  assert.equal(store.write(valid), true);
  assert.equal(JSON.parse(disk.getItem()).version, CURRENT_STATE_VERSION);
  assert.deepEqual(store.rollback(), valid);
  assert.deepEqual(createStateStore(disk).initial, valid);
  const damaged = structuredClone(valid);
  damaged.focus.taskId = '123'; damaged.pendingAlerts[0].taskId = null;
  const raw = JSON.stringify(damaged); const repairDisk = memoryStorage(raw);
  const recovered = createStateStore(repairDisk);
  assert.equal(recovered.canWrite, true);
  assert.equal(recovered.rawText(), raw); // Initialization never silently writes repairs.
  assert.deepEqual(recovered.initial.focus, { ...valid.focus, taskId: null });
  const { taskId, ...unlinked } = valid.pendingAlerts[0];
  assert.deepEqual(recovered.initial.pendingAlerts, [unlinked]);
  assert.equal(recovered.write(recovered.initial), true);
  assert.deepEqual(JSON.parse(repairDisk.getItem()), recovered.initial);
  assert.throws(() => recovered.write(damaged), /Invalid backup/);
  assert.deepEqual(JSON.parse(repairDisk.getItem()), recovered.initial);
});

test('corrupt JSON, unsupported roots and future versions lock writes and preserve raw backup exactly', () => {
  const blocked = ['{truncated', '', 'null', '[]', '123', '"text"', '{}', '{"version":2}',
    '{"version":99,"todos":[{"id":1,"text":"future-data"}]}',
    '{"version":0,"todos":[]}', '{"version":"2","todos":[]}',
    '{"todos":[],"unexpected":"do not discard me"}', 'x'.repeat(MAX_BACKUP_CHARS + 1)];
  for (const raw of blocked) {
    const disk = memoryStorage(raw); const store = createStateStore(disk);
    assert.equal(store.canWrite, false, raw.slice(0, 40));
    assert.equal(store.readError.code, 'STORAGE_READONLY');
    assert.match(store.blockedReason, /只读.*原始备份/);
    assert.equal(store.rawText(), raw);
    assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
    // An extra option cannot bypass the explicit recovery API.
    assert.throws(() => store.write(defaultState(), { replaceInvalid: true }),
      error => error.code === 'STORAGE_READONLY');
    assert.equal(disk.getItem(), raw);
    assert.equal(store.rawText(), raw);
    assert.equal(store.refresh().version, CURRENT_STATE_VERSION);
    assert.equal(store.canWrite, false);
  }
});

test('confirmed replacement alone unlocks invalid state only after validation and durable success', () => {
  const raw = '{"version":99,"notes":[{"future":"keep me"}]}';
  const disk = memoryStorage(raw); const store = createStateStore(disk);
  // Represents the controller boundary; refusing the dialog must not call replacement.
  const confirmedImport = (candidate, confirmed) => confirmed ? store.writeReplacement(candidate) : false;
  assert.equal(confirmedImport(defaultState(), false), false);
  assert.equal(disk.getItem(), raw); assert.equal(store.canWrite, false);
  const invalid = defaultState(); invalid.settings.salary = -1;
  assert.throws(() => confirmedImport(invalid, true), /Invalid backup/);
  assert.equal(store.canWrite, false); assert.equal(store.rawText(), raw);
  const originalSet = disk.setItem;
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => confirmedImport(defaultState(), true), /quota/);
  assert.equal(store.canWrite, false); assert.equal(store.rawText(), raw);
  assert.equal(disk.getItem(), raw);
  disk.setItem = originalSet;
  const replacement = defaultState(); replacement.settings.displayName = '确认导入';
  assert.equal(confirmedImport(replacement, true), true);
  assert.equal(store.canWrite, true); assert.equal(store.readError, null);
  assert.equal(store.blockedReason, '');
  assert.deepEqual(store.rollback(), replacement);
  assert.deepEqual(JSON.parse(store.rawText()), replacement);
  assert.equal(store.write(replacement), true);
});

test('refreshing externally broken/future JSON locks ordinary writes even if disk later becomes valid', () => {
  for (const raw of ['{broken', '{"version":100,"todos":[]}']) {
    const disk = memoryStorage(JSON.stringify(defaultState())); const store = createStateStore(disk);
    disk.setItem(null, raw);
    assert.deepEqual(store.refresh(), defaultState());
    assert.equal(store.canWrite, false); assert.equal(store.rawText(), raw);
    assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
    assert.equal(disk.getItem(), raw);
    disk.setItem(null, JSON.stringify(defaultState()));
    store.refresh();
    assert.equal(store.canWrite, false); // A refresh is not user consent to replace unrecognized data.
    assert.equal(store.writeReplacement(defaultState()), true);
    assert.equal(store.canWrite, true);
  }
});

test('an ordinary save detecting an external corrupt/future record locks without overwriting', () => {
  for (const raw of ['{broken', '{"version":100,"todos":[]}']) {
    const disk = memoryStorage(); const store = createStateStore(disk);
    disk.setItem(null, raw);
    assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
    assert.equal(store.canWrite, false); assert.equal(store.rawText(), raw);
    assert.equal(disk.getItem(), raw); assert.deepEqual(store.rollback(), defaultState());
  }
});

test('confirmed replacement still detects another page update and never defaults to overwrite', () => {
  const raw = '{broken'; const disk = memoryStorage(raw); const store = createStateStore(disk);
  const other = defaultState(); other.settings.displayName = 'other-page';
  disk.setItem(null, JSON.stringify(other));
  assert.throws(() => store.writeReplacement(defaultState()), error => error.code === 'STORAGE_CONFLICT');
  assert.deepEqual(JSON.parse(disk.getItem()), other);
  assert.deepEqual(store.rollback(), other);
  assert.equal(store.canWrite, false);
  assert.equal(store.writeReplacement(other), true);
  assert.equal(store.canWrite, true);
});

test('security errors during refresh or save lock writes and retain the last readable raw snapshot', () => {
  for (const operation of ['refresh', 'write']) {
    const state = defaultState(); state.settings.displayName = 'preserved';
    const raw = JSON.stringify(state); const disk = memoryStorage(raw); const store = createStateStore(disk);
    const originalGet = disk.getItem;
    disk.getItem = () => { throw new Error('SecurityError: blocked'); };
    assert.throws(() => operation === 'refresh' ? store.refresh() : store.write(defaultState()),
      error => error.code === 'STORAGE_READONLY');
    assert.equal(store.canWrite, false); assert.equal(store.rawText(), raw);
    assert.deepEqual(store.rollback(), state);
    assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
    disk.getItem = originalGet;
    assert.equal(store.writeReplacement(state), true);
    assert.equal(store.canWrite, true);
  }
});

test('initial security read failure can recover only through a confirmed retry after permissions work', () => {
  const disk = memoryStorage(); const originalGet = disk.getItem;
  disk.getItem = () => { throw new Error('initial read denied'); };
  const store = createStateStore(disk);
  assert.equal(store.canWrite, false);
  disk.getItem = originalGet;
  store.refresh();
  assert.equal(store.canWrite, false);
  assert.throws(() => store.write(defaultState()), error => error.code === 'STORAGE_READONLY');
  assert.equal(store.writeReplacement(defaultState()), true);
  assert.equal(store.canWrite, true);
});
