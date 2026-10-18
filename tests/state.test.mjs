import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_STATE_VERSION, MAX_BACKUP_CHARS, TEXT_LIMITS, COLLECTION_LIMITS,
  MAX_AVATAR_IMAGE_CHARS, defaultState, normalizeState, parseBackup, parseStoredState,
  validateText, validateNoteBody, validateWorkspaceUrl, normalizeNote, normalizeLink,
  normalizeNotes, normalizeLinks, normalizePendingAlert, SUPPORTED_STATE_VERSIONS
} from '../js/state.js';

const DAY = '2026-10-12';
const T0 = Date.UTC(2026, 9, 12, 9);
const encoded = value => JSON.stringify(value);
const rejects = value => assert.throws(() => parseBackup(encoded(value)), /Invalid backup/);

function legacyState() {
  return {
    settings: {
      salary: 12345, workHours: 7.5, onTime: '08:30', offTime: '17:30', payDay: 28,
      waterGoal: 2600, stepGoal: 8000, restDays: [6, 0],
      place: '上海 · 徐汇', coord: { lat: 31.2, lon: 121.4 }
    },
    todos: [
      { id: T0, text: '交周报', done: false, date: DAY, time: '15:30', timed: true,
        priority: 'high', tag: '工作' },
      { id: T0 + 1, text: '随时处理', done: false, date: '', time: '', timed: false,
        priority: 'medium', tag: '个人计划' }
    ],
    ledger: [{ id: T0, type: 'expense', amount: 28.5, note: '午餐', cat: '🍚 吃饭', date: DAY }],
    water: { [DAY]: [{ ml: 300, time: T0 }, { ml: 250, time: T0 + 60_000 }] },
    steps: { [DAY]: 3000 }, study: { [DAY]: 3600 },
    sport: [{ id: T0, type: 'run', minutes: 30, distance: 5.2,
      date: DAY, startAt: T0, weight: 60 }],
    reminders: [
      { id: `water-${T0}`, kind: 'interval', preset: 'water', icon: 'water', label: '喝水',
        text: '喝水吧', color: '#4a90d9', every: 45, startAt: T0,
        nextAt: T0 + 45 * 60_000, enabled: true, fired: 1 },
      { id: `pomo-${T0}`, kind: 'timer', preset: 'pomo', icon: 'tomato', label: '番茄钟',
        text: '休息一下', color: '#7b8fa8', minutes: 25, startAt: T0,
        endAt: T0 + 25 * 60_000, enabled: false },
      { id: `daily-${T0}`, kind: 'daily', icon: 'alarm', label: '开会', text: '去开会',
        time: '14:30', nextAt: T0 + 5 * 60_000, enabled: true }
    ],
    notifOn: false, soundOn: true, earnedTotal: 1234.5,
    pet: { name: '青柠', img: 'lemon.png' }
  };
}

test('schema version 4 explicitly supports v1/v2/v3/v4 without accepting future or coercible versions', () => {
  assert.equal(CURRENT_STATE_VERSION, 4);
  assert.deepEqual(SUPPORTED_STATE_VERSIONS, [1, 2, 3, 4]);
  assert.equal(Object.isFrozen(SUPPORTED_STATE_VERSIONS), true);
  for (const version of SUPPORTED_STATE_VERSIONS) {
    assert.equal(parseBackup(encoded({ version, todos: [] })).version, CURRENT_STATE_VERSION);
  }
  for (const version of [0, 5, '4', null, false, 2.5]) rejects({ version, todos: [] });
});

test('fresh defaults include independent nested values and a version', () => {
  const a = defaultState();
  const b = defaultState();
  assert.equal(a.version, CURRENT_STATE_VERSION);
  assert.equal(a.focus.remaining, 1500);
  assert.equal(a.focus.dueAt, null);
  a.settings.restDays.push(2);
  a.pet.name = 'changed';
  a.focus.remaining = 12;
  a.pendingAlerts.push({ sourceKind: 'focus' });
  assert.deepEqual(b.pendingAlerts, []);
  assert.deepEqual(b.settings.restDays, [0, 6]);
  assert.equal(b.pet.name, '青柠');
  assert.equal(b.focus.remaining, 1500);
});

test('legacy unversioned and explicit v1 backups migrate without losing valid data', () => {
  for (const legacy of [legacyState(), { version: 1, ...legacyState() }]) {
    const imported = parseBackup(encoded(legacy));
    assert.equal(imported.version, CURRENT_STATE_VERSION);
    for (const [key, value] of Object.entries(legacy)) {
      if (key === 'settings') {
        // Keep every legacy setting, while also filling new default fields.
        assert.deepEqual(imported.settings, { ...defaultState().settings, ...value });
      } else if (key !== 'version') assert.deepEqual(imported[key], value, key);
    }
    assert.deepEqual(imported.focus, defaultState().focus);
    assert.equal(imported.todos[1].date, '');
    assert.equal(imported.todos[1].time, '');
  }
});

test('current backups preserve focus, reminders, and other data through round trips', () => {
  const state = parseBackup(encoded(legacyState()));
  state.focus = { total: 3600, remaining: 1199.5, running: true,
    dueAt: T0 + 1_200_000, lastCreditedAt: T0 + 500,
    text: '完成 < 3 个任务 > 放松', taskId: state.todos[0].id, creditRemainders: { [DAY]: 500 } };
  state.settings.displayName = '小林';
  state.settings.focusMinutes = 25;
  state.reminders.push({ id: 'once-123', kind: 'once', icon: 'alarm', label: '开会',
    text: '开会', date: DAY, time: '17:30', nextAt: T0 + 30_600_000,
    enabled: true, taskId: state.todos[0].id });
  state.reminders[0] = { ...state.reminders[0], enabled: false,
    pausedAt: T0 + 10_000, remainingMs: 2_690_000 };
  state.reminders[1] = { ...state.reminders[1], enabled: false, completed: true, fired: 1 };
  assert.deepEqual(parseBackup(encoded(state)), state);
  assert.deepEqual(parseStoredState(encoded(state)), state);
  assert.deepEqual(normalizeState(state, { strict: true }), state);
});

test('older partial state receives defaults without shared nested structures', () => {
  const restored = parseBackup('{"settings":{"salary":9500},"todos":[]}');
  assert.equal(restored.settings.salary, 9500);
  assert.equal(restored.settings.workHours, defaultState().settings.workHours);
  assert.deepEqual(restored.water, {});
  assert.deepEqual(restored.focus, defaultState().focus);
});

test('strict backup rejects malformed, empty, unsupported, and unrelated JSON', () => {
  for (const input of ['{', 'null', '[]', '123', '"text"', '{}',
    '{"version":99,"todos":[]}', '{"version":0,"todos":[]}']) {
    assert.throws(() => parseBackup(input), /Invalid backup/);
  }
  assert.throws(() => parseBackup(new Uint8Array(0)), /Invalid backup/);
  assert.throws(() => parseBackup(' '.repeat(MAX_BACKUP_CHARS + 1)), /Invalid backup/);
  rejects({ version: CURRENT_STATE_VERSION, todos: [], secret: 'unrelated' });
});

test('malformed local data is recoverable; invalid rows drop without losing valid rows', () => {
  assert.deepEqual(parseStoredState('{'), defaultState());
  assert.deepEqual(parseStoredState(encoded({ version: 99, todos: [] })), defaultState());
  assert.deepEqual(parseStoredState('x'.repeat(MAX_BACKUP_CHARS + 1)), defaultState());
  const raw = legacyState();
  raw.todos.unshift({ id: 1, text: 'invalid\u0000title' });
  raw.settings.waterGoal = 'unbounded';
  raw.water[DAY].push({ ml: -200, time: T0 });
  raw.steps[DAY] = -1;
  const repaired = parseStoredState(encoded(raw));
  assert.equal(repaired.todos.length, 2);
  assert.equal(repaired.todos[0].text, '交周报');
  assert.equal(repaired.settings.salary, raw.settings.salary);
  assert.equal(repaired.settings.waterGoal, defaultState().settings.waterGoal);
  assert.equal(repaired.water[DAY].length, 2);
  assert.equal(repaired.steps[DAY], undefined);
  assert.equal(repaired.ledger.length, 1);
  assert.equal(raw.settings.waterGoal, 'unbounded'); // normalization never mutates its input
});

test('ordinary symbols and HTML-shaped text round-trip unchanged as safe-sink data', () => {
  const symbols = '进度 < 3 > 1 & "引号" \'单引号\'';
  const markup = '<img src=x onerror=alert(1)>';
  const raw = legacyState();
  raw.todos[0].text = symbols;
  raw.todos[0].tag = '<工作>';
  raw.ledger[0].note = markup;
  raw.ledger[0].cat = '<script>alert(1)</script>';
  raw.reminders[0].label = '<img src=x>';
  raw.reminders[0].text = '<button>Click</button>';
  raw.settings.place = '<b>city</b>';
  raw.settings.displayName = '<script>bad</script>';
  raw.pet.name = '<svg/onload=1>';
  raw.focus = { ...defaultState().focus, text: symbols };
  const imported = parseBackup(encoded(raw));
  for (const recovered of [imported, parseStoredState(encoded(raw)), parseBackup(encoded(imported))]) {
    assert.equal(recovered.todos[0].text, symbols);
    assert.equal(recovered.todos[0].tag, '<工作>');
    assert.equal(recovered.ledger[0].note, markup);
    assert.equal(recovered.ledger[0].cat, '<script>alert(1)</script>');
    assert.equal(recovered.reminders[0].label, '<img src=x>');
    assert.equal(recovered.reminders[0].text, '<button>Click</button>');
    assert.equal(recovered.settings.place, '<b>city</b>');
    assert.equal(recovered.settings.displayName, '<script>bad</script>');
    assert.equal(recovered.pet.name, '<svg/onload=1>');
    assert.equal(recovered.focus.text, symbols);
  }
  // This is validation, not escaping: rendering must assign textContent or escape HTML.
  assert.equal(validateText(markup, TEXT_LIMITS.taskText), true);
});

test('asset paths, IDs and enumerated attributes still reject injection-shaped values', () => {
  const candidates = [
    state => { state.pet.img = '../../icons/x.png'; },
    state => { state.pet.img = 'javascript:alert(1)'; },
    state => { state.pet.img = '<img>.png'; },
    state => { state.reminders[0].icon = 'x" onerror="alert(1)'; },
    state => { state.reminders[0].id = 'x" onclick="alert(1)'; },
    state => { state.todos[0].id = '<script>'; },
    state => { state.todos[0].priority = 'high" onmouseover="alert(1)'; },
    state => { state.ledger[0].type = 'income" onclick="alert(1)'; }
  ];
  for (const poison of candidates) {
    const raw = legacyState();
    poison(raw);
    rejects(raw);
    assert.doesNotMatch(encoded(parseStoredState(encoded(raw))), /<|>|onerror|onclick|onmouseover|javascript:/);
  }
});

test('prototype keys rejected on import and never installed in recovered maps', () => {
  const attack = '{"todos":[],"steps":{"__proto__":10,"constructor":20,' +
    '"2026-10-12":5},"settings":{"__proto__":{"isAdmin":true}}}';
  assert.throws(() => parseBackup(attack), /Invalid backup/);
  const stored = parseStoredState(attack);
  assert.equal(stored.steps[DAY], 5);
  assert.equal(Object.hasOwn(stored.steps, '__proto__'), false);
  assert.equal(Object.hasOwn(stored.steps, 'constructor'), false);
  assert.equal({}.isAdmin, undefined);
  assert.equal(stored.settings.isAdmin, undefined);
  assert.equal(stored.settings.salary, defaultState().settings.salary);
  const ownProto = JSON.parse('{"todos":[],"__proto__":{"isAdmin":true}}');
  assert.throws(() => normalizeState(ownProto, { strict: true }), /Invalid backup/);
});

test('direct object normalization refuses accessor properties without executing them', () => {
  const raw = { todos: [] };
  Object.defineProperty(raw, 'pet', { enumerable: true, get() { throw new Error('getter ran'); } });
  assert.throws(() => normalizeState(raw, { strict: true }), /Invalid backup/);
  assert.deepEqual(normalizeState(raw), defaultState());
  const todos = [];
  Object.defineProperty(todos, '0', { enumerable: true, get() { throw new Error('getter ran'); } });
  assert.throws(() => normalizeState({ todos }, { strict: true }), /Invalid backup/);
  assert.deepEqual(normalizeState({ todos }).todos, []);
});

test('numeric bounds, fields, and valid calendar/time values are enforced', () => {
  const poison = [
    state => { state.ledger[0].amount = -1; },
    state => { state.ledger[0].amount = 1e99; },
    state => { state.settings.salary = '8000'; },
    state => { state.settings.payDay = 33; },
    state => { state.settings.focusMinutes = 2000; },
    state => { state.settings.restDays = [0, 0]; },
    state => { state.reminders[0].taskId = '<script>'; },
    state => { state.steps[DAY] = -100; },
    state => { state.study[DAY] = 1e15; },
    state => { state.sport[0].distance = -5; },
    state => { state.reminders[0].every = 0; },
    state => { state.reminders[0].pausedAt = T0; },
    state => { state.reminders[0].remainingMs = -5; },
    state => { state.reminders[0].enabled = false; state.reminders[0].pausedAt = T0;
      state.reminders[0].remainingMs = 46 * 60_000; },
    state => { state.reminders[1].completed = true; state.reminders[1].enabled = true; },
    state => { state.todos[0].date = '2026-02-30'; },
    state => { state.ledger[0].date = '2026-13-01'; },
    state => { state.ledger[0].date = '2026-10-12\n'; },
    state => { state.todos[0].time = '25:90'; },
    state => { state.todos[0].time = '09:00\n'; },
    state => { state.reminders[2].time = '24:00'; },
    state => { state.water[DAY][0].time = 'yesterday'; }
  ];
  for (const mutate of poison) {
    const state = legacyState();
    mutate(state);
    rejects(state);
  }
  rejects({ todos: [{ id: 1, text: 'Undated timed todo', date: '', time: '09:00' }] });
  const repaired = parseStoredState(encoded({ todos: [{ id: 1, text: 'recover', date: '', time: '09:00' }] }));
  assert.equal(repaired.todos[0].time, '');
  assert.equal(repaired.todos[0].timed, false);
});

test('arrays and day-maps are capped, rejecting too many records on import', () => {
  const todos = Array.from({ length: 2001 }, (_, i) => ({ id: i + 1, text: 'ok' }));
  rejects({ todos });
  assert.equal(parseStoredState(encoded({ todos })).todos.length, 2000);
  const dayMap = {};
  for (let i = 0; i < 3661; i++) {
    const date = new Date(Date.UTC(2000, 0, 1 + i));
    dayMap[date.toISOString().slice(0, 10)] = 1;
  }
  rejects({ steps: dayMap });
  assert.equal(Object.keys(parseStoredState(encoded({ steps: dayMap })).steps).length, 3660);
  const raw = legacyState();
  raw.todos[0].text = 'x'.repeat(301);
  rejects(raw);
  assert.equal(parseStoredState(encoded(raw)).todos.length, 1);
});

test('focus timestamps and duration must be finite and internally consistent', () => {
  const good = { total: 1500, remaining: 10, running: true, dueAt: T0 + 10_000, lastCreditedAt: null };
  assert.deepEqual(parseBackup(encoded({ focus: good })).focus,
    { ...good, text: '', taskId: null, creditRemainders: {} });
  const bad = [
    { ...good, total: 0 }, { ...good, total: 86_401 },
    { ...good, remaining: 2000 }, { ...good, remaining: -1 },
    { ...good, dueAt: null }, { ...good, dueAt: -1 }, { ...good, lastCreditedAt: 'now' }
  ];
  for (const entry of bad) {
    rejects({ focus: entry });
    assert.deepEqual(parseStoredState(encoded({ focus: entry })).focus, defaultState().focus);
  }
});

test('legacy focus migration fills text, carry and null task link without discarding the clock', () => {
  const old = { total: 1500, remaining: 300, running: true,
    dueAt: T0 + 300_000, lastCreditedAt: T0 };
  const expected = { ...old, text: '', taskId: null, creditRemainders: {} };
  for (const version of [undefined, 1, 2, 3]) {
    const raw = { focus: old };
    if (version !== undefined) raw.version = version;
    assert.deepEqual(parseBackup(encoded(raw)).focus, expected);
    assert.deepEqual(parseStoredState(encoded(raw)).focus, expected);
  }
  const paused = { ...expected, remaining: 299.5, running: false,
    dueAt: null, lastCreditedAt: null, text: '暂停 < 再继续', creditRemainders: { [DAY]: 500 } };
  assert.deepEqual(parseBackup(encoded({ focus: paused })).focus, paused);
  const a = defaultState();
  const b = defaultState();
  assert.equal(a.focus.text, '');
  a.focus.creditRemainders[DAY] = 500;
  assert.deepEqual(b.focus.creditRemainders, {});
});

test('focus task identity is nullable numeric data and never inferred from matching titles', () => {
  const clock = { ...defaultState().focus, total: 900, remaining: 75.5, running: true,
    dueAt: T0 + 75_500, lastCreditedAt: T0, text: '交周报 < 专注',
    creditRemainders: { [DAY]: 500 } };
  for (const taskId of [null, 1, Number.MAX_SAFE_INTEGER]) {
    const focus = { ...clock, taskId };
    const raw = { focus, todos: legacyState().todos };
    for (const restored of [parseBackup(encoded(raw)), parseStoredState(encoded(raw)),
      normalizeState(raw, { strict: true })]) assert.deepEqual(restored.focus, focus);
  }
  const withoutLink = { ...clock }; delete withoutLink.taskId;
  assert.deepEqual(parseBackup(encoded({ focus: withoutLink })).focus, { ...clock, taskId: null });
  const matching = { ...legacyState(), focus: { ...withoutLink, text: '交周报' } };
  assert.equal(parseStoredState(encoded(matching)).focus.taskId, null);
});

test('bad focus task metadata rejects import but recovery only disarms the link, preserving the clock', () => {
  const clock = { ...defaultState().focus, total: 900, remaining: 75.5, running: true,
    dueAt: T0 + 75_500, lastCreditedAt: T0, text: '继续 < 不重置',
    creditRemainders: { [DAY]: 500 } };
  for (const taskId of ['123', '', 'task-a', 0, -1, 1.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, true, false, {}, [], undefined]) {
    const focus = { ...clock, taskId };
    const raw = { version: 3, focus };
    assert.throws(() => normalizeState(raw, { strict: true }), /Invalid backup: state.focus.taskId/);
    assert.deepEqual(normalizeState(raw).focus, { ...clock, taskId: null });
    // JSON omits undefined and encodes NaN/Infinity as null; those serialized forms are legal.
    if (taskId !== undefined && !(typeof taskId === 'number' && !Number.isFinite(taskId))) rejects(raw);
    assert.deepEqual(parseStoredState(encoded(raw)).focus, { ...clock, taskId: null });
    assert.equal(raw.focus.taskId, taskId);
  }
});

test('focus text and per-day millisecond carry are bounded and keyed by valid dates', () => {
  const base = defaultState().focus;
  for (const focus of [
    { ...base, text: 'x'.repeat(TEXT_LIMITS.focusText + 1) },
    { ...base, text: 'control\u0000' },
    { ...base, remaining: NaN },
    { ...base, creditRemainders: { [DAY]: 1000 } },
    { ...base, creditRemainders: { [DAY]: -1 } },
    { ...base, creditRemainders: { [DAY]: 0.5 } },
    { ...base, creditRemainders: { '2026-02-30': 500 } },
    { ...base, creditRemainders: [] }
  ]) rejects({ focus });
  const attack = '{"focus":{"creditRemainders":{"__proto__":500,"2026-10-12":250}}}';
  assert.throws(() => parseBackup(attack), /Invalid backup/);
  const repaired = parseStoredState(attack);
  assert.deepEqual(repaired.focus.creditRemainders, { [DAY]: 250 });
  assert.equal(Object.hasOwn(repaired.focus.creditRemainders, '__proto__'), false);
});

test('shared validateText accepts printable symbols but rejects controls and overlength input', () => {
  const printable = '<>&"\' 中文 🙂';
  assert.equal(validateText(printable, printable.length), true);
  assert.equal(validateText(printable, printable.length - 1), false);
  assert.equal(validateText('', 300), false);
  assert.equal(validateText('  ', 300), false);
  assert.equal(validateText('', 300, { allowEmpty: true }), true);
  assert.equal(validateText('  ', 300, { allowEmpty: true }), true);
  for (const value of [null, 1, [], {}]) assert.equal(validateText(value, 300), false);
  for (const max of [-1, 2.5, NaN, Infinity]) assert.equal(validateText('ok', max), false);
  for (const control of ['\u0000', '\t', '\n', '\r', '\u001f', '\u007f', '\u0085', '\u009f',
    '‪', '‮', '⁦', '⁩']) {
    const text = `a${control}b`;
    assert.equal(validateText(text, 300), false);
    rejects({ todos: [{ id: 1, text }] });
    assert.deepEqual(parseStoredState(encoded({ todos: [{ id: 1, text }] })).todos, []);
  }
});

test('exported text limits match field-specific backup bounds', () => {
  assert.deepEqual(TEXT_LIMITS, {
    taskText: 300, taskTag: 80, ledgerNote: 300, ledgerCategory: 80,
    reminderLabel: 120, reminderText: 300, place: 120, displayName: 80,
    avatar: 32, workspaceName: 40, petName: 80, focusText: 300, ledgerCategoryName: 24,
    noteTitle: 120, noteBody: 5000, linkTitle: 80, linkUrl: 2000
  });
  assert.equal(Object.isFrozen(TEXT_LIMITS), true);
  const setters = {
    taskText: (s, v) => { s.todos[0].text = v; },
    taskTag: (s, v) => { s.todos[0].tag = v; },
    ledgerNote: (s, v) => { s.ledger[0].note = v; },
    ledgerCategory: (s, v) => { s.ledger[0].cat = v; },
    reminderLabel: (s, v) => { s.reminders[0].label = v; },
    reminderText: (s, v) => { s.reminders[0].text = v; },
    place: (s, v) => { s.settings.place = v; },
    displayName: (s, v) => { s.settings.displayName = v; },
    avatar: (s, v) => { s.settings.avatar = v; },
    workspaceName: (s, v) => { s.settings.workspaceName = v; },
    petName: (s, v) => { s.pet.name = v; },
    focusText: (s, v) => { s.focus = { ...defaultState().focus, text: v }; },
    ledgerCategoryName: (s, v) => { s.settings.ledgerCats = [v]; }
  };
  for (const [name, setter] of Object.entries(setters)) {
    const raw = legacyState();
    setter(raw, 'x'.repeat(TEXT_LIMITS[name]));
    assert.doesNotThrow(() => parseBackup(encoded(raw)), name);
    setter(raw, 'x'.repeat(TEXT_LIMITS[name] + 1));
    rejects(raw);
  }
});

test('exported collection limits match caps for each live-input collection', () => {
  assert.deepEqual(COLLECTION_LIMITS, { todos: 2000, ledger: 5000, sport: 2000,
    reminders: 500, pendingAlerts: 501, datedMaps: 3660, waterPerDay: 200, waterTotal: 10000,
    ledgerCats: 60, notes: 100, links: 100, habits: 20 });
  assert.equal(Object.isFrozen(COLLECTION_LIMITS), true);
  for (const field of ['todos', 'ledger', 'sport', 'reminders']) {
    const row = legacyState()[field][0];
    const records = Array.from({ length: COLLECTION_LIMITS[field] }, (_, i) =>
      ({ ...row, id: field === 'reminders' ? `rem-${i}` : i + 1 }));
    assert.equal(parseBackup(encoded({ [field]: records }))[field].length, COLLECTION_LIMITS[field]);
    records.push({ ...records[0] });
    rejects({ [field]: records });
    assert.equal(parseStoredState(encoded({ [field]: records }))[field].length, COLLECTION_LIMITS[field]);
  }
  const cats = Array(COLLECTION_LIMITS.ledgerCats).fill('分类');
  assert.equal(parseBackup(encoded({ settings: { ledgerCats: cats } })).settings.ledgerCats.length, 60);
  cats.push('额外');
  rejects({ settings: { ledgerCats: cats } });
  assert.equal(parseStoredState(encoded({ settings: { ledgerCats: cats } })).settings.ledgerCats.length, 60);
  const water = Array.from({ length: COLLECTION_LIMITS.waterPerDay }, () => ({ ml: 250 }));
  assert.equal(parseBackup(encoded({ water: { [DAY]: water } })).water[DAY].length, 200);
  water.push({ ml: 250 });
  rejects({ water: { [DAY]: water } });
  assert.equal(parseStoredState(encoded({ water: { [DAY]: water } })).water[DAY].length, 200);
  const waterMap = {};
  for (let i = 0; i < 50; i++) {
    const day = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
    waterMap[day] = Array.from({ length: 200 }, () => ({ ml: 250 }));
  }
  assert.equal(Object.values(parseBackup(encoded({ water: waterMap })).water).flat().length, 10000);
  waterMap['2026-12-31'] = [{ ml: 250 }];
  rejects({ water: waterMap });
  assert.equal(Object.values(parseStoredState(encoded({ water: waterMap })).water).flat().length, 10000);
});

test('optional task completedAt persists validated timestamps but never invents legacy history', () => {
  const raw = legacyState();
  raw.todos[0].done = true;
  const legacyDone = parseBackup(encoded(raw)).todos[0];
  assert.equal(legacyDone.done, true);
  assert.equal(Object.hasOwn(legacyDone, 'completedAt'), false);
  raw.todos[0].completedAt = T0 + 1000;
  assert.equal(parseBackup(encoded(raw)).todos[0].completedAt, T0 + 1000);
  assert.equal(parseStoredState(encoded(raw)).todos[0].completedAt, T0 + 1000);
  raw.todos[0].completedAt = 0;
  assert.equal(parseBackup(encoded(raw)).todos[0].completedAt, 0);
  for (const completedAt of [-1, T0 + 0.5, 'now', null, Number.MAX_SAFE_INTEGER]) {
    raw.todos[0].completedAt = completedAt;
    rejects(raw);
    const repaired = parseStoredState(encoded(raw)).todos[0];
    assert.equal(repaired.done, true);
    assert.equal(Object.hasOwn(repaired, 'completedAt'), false);
  }
});

function storedAlert(sourceId = 'water-123', patch = {}) {
  return { sourceKind: 'reminder', sourceId, label: '喝水 < 每天 >', text: '该喝水啦 & 放松',
    icon: 'water', dueAt: T0, snoozedUntil: null, ...patch };
}

test('pending alerts preserve simultaneous sources, snoozes, order, and current version round trips', () => {
  const state = defaultState();
  state.pendingAlerts = [storedAlert(), storedAlert('eyes-456', { snoozedUntil: T0 + 300_000 }),
    storedAlert('focus', { sourceKind: 'focus', label: '专注完成', icon: 'tomato' })];
  for (const recovered of [parseBackup(encoded(state)), parseStoredState(encoded(state)),
    normalizeState(state, { strict: true })]) {
    assert.equal(recovered.version, CURRENT_STATE_VERSION);
    assert.deepEqual(recovered.pendingAlerts, state.pendingAlerts);
    assert.notStrictEqual(recovered.pendingAlerts, state.pendingAlerts);
    assert.notStrictEqual(recovered.pendingAlerts[0], state.pendingAlerts[0]);
  }
  assert.deepEqual(parseBackup(encoded(parseBackup(encoded(state)))), state);
});

test('old backups lacking pending alerts receive empty independent queues without losing other state', () => {
  for (const version of [undefined, 1, 2, 3]) {
    const state = legacyState();
    if (version !== undefined) state.version = version;
    state.focus = { ...defaultState().focus, total: 86_400, remaining: 86_400 };
    state.settings.focusMinutes = 1440;
    const imported = parseBackup(encoded(state));
    assert.equal(imported.version, CURRENT_STATE_VERSION);
    assert.deepEqual(imported.pendingAlerts, []);
    assert.equal(imported.settings.focusMinutes, 1440);
    assert.equal(imported.focus.total, 86_400);
    assert.deepEqual(imported.reminders, state.reminders);
    imported.pendingAlerts.push(storedAlert());
    assert.deepEqual(parseStoredState(encoded(state)).pendingAlerts, []);
  }
});

test('pending alert strict validation rejects unsafe, overlength, missing and unknown fields', () => {
  const patches = [
    { sourceKind: 'timer' }, { sourceKind: null }, { sourceId: '' }, { sourceId: 42 },
    { sourceId: 'x'.repeat(65) }, { sourceId: 'x\n' }, { sourceId: '../x' },
    { sourceKind: 'focus', sourceId: 'another-focus' },
    { label: '' }, { label: '  ' }, { label: 'x'.repeat(121) }, { label: 'control\u0000' },
    { text: '' }, { text: '  ' }, { text: 'x'.repeat(301) }, { text: 'bidi‮' },
    { icon: '<svg>' }, { icon: 'x'.repeat(33) }, { icon: 'bell\n' },
    { dueAt: null }, { dueAt: 'now' }, { dueAt: -1 }, { dueAt: T0 + 0.5 },
    { dueAt: Number.MAX_SAFE_INTEGER }, { snoozedUntil: 'later' }, { snoozedUntil: -1 },
    { snoozedUntil: T0 + 0.5 }, { snoozedUntil: Number.MAX_SAFE_INTEGER }, { unrecognized: true }
  ];
  for (const patch of patches) {
    const alerts = [storedAlert('good'), storedAlert('bad', patch), storedAlert('another-good')];
    rejects({ pendingAlerts: alerts });
    assert.deepEqual(parseStoredState(encoded({ pendingAlerts: alerts })).pendingAlerts.map(a => a.sourceId),
      ['good', 'another-good']);
  }
  for (const key of Object.keys(storedAlert())) {
    const missing = storedAlert();
    delete missing[key];
    rejects({ pendingAlerts: [missing] });
    assert.deepEqual(parseStoredState(encoded({ pendingAlerts: [missing] })).pendingAlerts, []);
  }
  for (const pendingAlerts of [null, 'alert', {}, [null], [1]]) {
    rejects({ pendingAlerts });
    assert.deepEqual(parseStoredState(encoded({ pendingAlerts })).pendingAlerts, []);
  }
  const edge = storedAlert('x'.repeat(64), { label: 'x'.repeat(120), text: 'x'.repeat(300),
    icon: 'x'.repeat(32), dueAt: 0, snoozedUntil: Date.UTC(2101, 0, 1) });
  assert.deepEqual(parseBackup(encoded({ pendingAlerts: [edge] })).pendingAlerts, [edge]);
});

test('only focus alerts accept an optional numeric taskId and preserve it through v1/v2/v3 round trips', () => {
  for (const taskId of [1, Number.MAX_SAFE_INTEGER]) {
    const alert = storedAlert('focus', { sourceKind: 'focus', taskId,
      snoozedUntil: T0 + 300_000 });
    assert.deepEqual(normalizePendingAlert(alert), alert);
    const live = { ...alert }; delete live.snoozedUntil;
    assert.deepEqual(normalizePendingAlert(live), { ...alert, snoozedUntil: null });
    for (const version of SUPPORTED_STATE_VERSIONS) {
      const raw = { version, pendingAlerts: [alert] };
      assert.deepEqual(parseBackup(encoded(raw)).pendingAlerts, [alert]);
      assert.deepEqual(parseStoredState(encoded(raw)).pendingAlerts, [alert]);
    }
  }
  const legacy = storedAlert('focus', { sourceKind: 'focus' });
  assert.equal(Object.hasOwn(parseBackup(encoded({ pendingAlerts: [legacy] })).pendingAlerts[0], 'taskId'), false);
  assert.equal(Object.hasOwn(normalizePendingAlert(legacy), 'taskId'), false);
});

test('invalid or misplaced pending task metadata is disarmed without dropping the valid alert in recovery', () => {
  const original = storedAlert('focus', { sourceKind: 'focus', snoozedUntil: T0 + 300_000 });
  for (const taskId of [null, '123', 'task-a', '', 0, -1, 0.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, false, {}, [], undefined]) {
    const bad = { ...original, taskId };
    assert.throws(() => normalizePendingAlert(bad), /Invalid backup/);
    assert.throws(() => normalizeState({ pendingAlerts: [bad] }, { strict: true }), /Invalid backup/);
    assert.deepEqual(normalizeState({ pendingAlerts: [bad] }).pendingAlerts, [original]);
    if (taskId !== undefined) rejects({ pendingAlerts: [bad] });
    assert.deepEqual(parseStoredState(encoded({ pendingAlerts: [bad] })).pendingAlerts, [original]);
    assert.equal(bad.taskId, taskId);
  }
  for (const taskId of [1, 'legacy-task', null]) {
    const reminderAlert = storedAlert('rem-1', { taskId });
    rejects({ pendingAlerts: [reminderAlert] });
    assert.throws(() => normalizePendingAlert(reminderAlert), /Invalid backup/);
    assert.deepEqual(parseStoredState(encoded({ pendingAlerts: [reminderAlert] })).pendingAlerts,
      [storedAlert('rem-1')]);
  }
  // This restriction does not change the legacy reminder record's own taskId contract.
  const raw = legacyState(); raw.reminders[0].taskId = 'legacy-task';
  assert.equal(parseBackup(encoded(raw)).reminders[0].taskId, 'legacy-task');
});

test('pending alerts reject duplicate source on import and repair first valid records in stable order', () => {
  const first = storedAlert('same', { snoozedUntil: T0 + 300_000 });
  const duplicate = storedAlert('same', { label: 'newer duplicate', dueAt: T0 + 60_000 });
  const focus = storedAlert('focus', { sourceKind: 'focus' });
  const reminderFocus = storedAlert('focus');
  const raw = { pendingAlerts: [first, focus, duplicate, storedAlert('last'), reminderFocus] };
  rejects(raw);
  assert.deepEqual(parseStoredState(encoded(raw)).pendingAlerts,
    [first, focus, storedAlert('last'), reminderFocus]);
  assert.equal(raw.pendingAlerts.length, 5);
  const invalidFirst = storedAlert('same', { text: 'bad\u0000' });
  assert.deepEqual(parseStoredState(encoded({ pendingAlerts: [invalidFirst, first] })).pendingAlerts, [first]);
  assert.deepEqual(parseBackup(encoded({ pendingAlerts: [focus, reminderFocus] })).pendingAlerts,
    [focus, reminderFocus]);
});

test('pending alert capacity is 501 including focus; imports reject overflow and recovery remains bounded', () => {
  const alerts = Array.from({ length: 500 }, (_, i) => storedAlert(`rem-${i}`));
  alerts.push(storedAlert('focus', { sourceKind: 'focus' }));
  assert.equal(parseBackup(encoded({ pendingAlerts: alerts })).pendingAlerts.length, 501);
  alerts.push(storedAlert('overflow'));
  rejects({ pendingAlerts: alerts });
  assert.deepEqual(parseStoredState(encoded({ pendingAlerts: alerts })).pendingAlerts, alerts.slice(0, 501));
  assert.equal(alerts.length, 502);
});

test('pending alert direct-object normalization rejects accessors without running getters', () => {
  const malicious = storedAlert();
  Object.defineProperty(malicious, 'dueAt', { get() { throw new Error('getter ran'); } });
  assert.throws(() => normalizeState({ pendingAlerts: [malicious] }, { strict: true }), /Invalid backup/);
  assert.deepEqual(normalizeState({ pendingAlerts: [malicious, storedAlert('good')] }).pendingAlerts,
    [storedAlert('good')]);
  const sparse = [storedAlert()];
  sparse.length = 2;
  assert.throws(() => normalizeState({ pendingAlerts: sparse }, { strict: true }), /Invalid backup/);
  assert.deepEqual(normalizeState({ pendingAlerts: sparse }).pendingAlerts, [storedAlert()]);
});

function storedNote(id = 1, patch = {}) {
  return { id, title: '工作 < 便签 >', body: '第一行\n\t第二行 & <img src=x onerror=alert(1)>',
    createdAt: T0, updatedAt: T0 + 1000, ...patch };
}

function storedLink(id = 1, patch = {}) {
  return { id, title: '工作 < 文档 >', url: 'http://localhost:5173/path?q=1#notes',
    createdAt: T0, ...patch };
}

test('notes and links migrate old v1/v2 states as independent empty collections', () => {
  for (const version of [undefined, 1, 2, 3]) {
    const raw = legacyState();
    if (version !== undefined) raw.version = version;
    for (const state of [parseBackup(encoded(raw)), parseStoredState(encoded(raw))]) {
      assert.deepEqual(state.notes, []);
      assert.deepEqual(state.links, []);
      assert.equal(state.version, CURRENT_STATE_VERSION);
      assert.deepEqual(state.todos, raw.todos);
    }
  }
  const a = defaultState(); const b = defaultState();
  a.notes.push(storedNote()); a.links.push(storedLink());
  assert.deepEqual(b.notes, []); assert.deepEqual(b.links, []);
});

test('workspace records round trip multiline safe-sink data without escaping or losing order', () => {
  const state = defaultState();
  state.notes = [storedNote(4), storedNote(2, { title: '未命名便签', body: '' })];
  state.links = [storedLink(8), storedLink(3, { url: 'https://example.org/?q=%3Cdata%3E' })];
  for (const restored of [parseBackup(encoded(state)), parseStoredState(encoded(state)),
    normalizeState(state, { strict: true })]) {
    assert.deepEqual(restored, state);
    assert.notEqual(restored.notes, state.notes);
    assert.notEqual(restored.notes[0], state.notes[0]);
    assert.notEqual(restored.links[0], state.links[0]);
  }
  assert.deepEqual(normalizeNote(state.notes[0]), state.notes[0]);
  assert.deepEqual(normalizeLink(state.links[0]), state.links[0]);
  assert.deepEqual(normalizeNotes(state.notes), state.notes);
  assert.deepEqual(normalizeLinks(state.links), state.links);
});

test('notes reject invalid and missing fields, titles, controls, timestamps and unknown keys', () => {
  const patches = [{ id: 0 }, { id: -1 }, { id: '1' }, { id: 0.5 }, { id: 1e99 },
    { title: '' }, { title: '   ' }, { title: 'title\nline' }, { title: 'title\tline' },
    { title: 'x'.repeat(121) }, { title: `title${String.fromCodePoint(8232)}line` },
    { body: null }, { body: 'x'.repeat(5001) }, { body: 'bad\rline' }, { body: 'bad\u0000' },
    { body: 'bad\u001f' }, { body: 'bad\u007f' }, { body: 'bad\u0085' },
    ...[1564, 8206, 8207, 8234, 8238, 8294, 8297].map(cp => ({ body: `bad${String.fromCodePoint(cp)}` })),
    { createdAt: -1 }, { createdAt: T0 + 0.1 }, { createdAt: 'now' },
    { updatedAt: null }, { updatedAt: Number.MAX_SAFE_INTEGER }, { updatedAt: T0 - 1 },
    { arbitrary: true }];
  for (const patch of patches) {
    const notes = [storedNote(1), storedNote(2, patch), storedNote(3)];
    rejects({ notes });
    assert.deepEqual(parseStoredState(encoded({ notes })).notes, [storedNote(1), storedNote(3)]);
  }
  for (const key of Object.keys(storedNote())) {
    const missing = storedNote(); delete missing[key];
    rejects({ notes: [missing] });
    assert.deepEqual(parseStoredState(encoded({ notes: [missing] })).notes, []);
  }
  for (const notes of [null, {}, 'note', [null], [1]]) rejects({ notes });
  const edge = storedNote(Number.MAX_SAFE_INTEGER, { title: 'x'.repeat(120), body: 'x'.repeat(5000),
    createdAt: 0, updatedAt: Date.UTC(2101, 0, 1) });
  assert.deepEqual(parseBackup(encoded({ notes: [edge] })).notes, [edge]);
  assert.equal(validateNoteBody('line\n\tline'), true);
  assert.equal(validateNoteBody(''), true);
  assert.equal(validateText('line\n\tline', 5000), false); // Existing alert/text sinks stay single-line.
});

test('link URL and record validation rejects schemes, credentials, parser tricks and unknown fields', () => {
  for (const url of ['https://example.com/', 'http://localhost/', 'http://127.0.0.1:8080/a',
    'http://192.168.1.4/', 'http://intranet/', 'http://[::1]:5173/', 'HTTPS://example.com/a?q=1#x']) {
    assert.equal(validateWorkspaceUrl(url), true, url);
    assert.equal(parseBackup(encoded({ links: [storedLink(1, { url })] })).links[0].url, url);
  }
  const patches = [{ id: 0 }, { id: 1.5 }, { id: '2' }, { title: '' }, { title: ' ' },
    { title: 'bad\n' }, { title: 'x'.repeat(81) },
    ...['javascript:alert(1)', 'data:text/html,hello', 'ftp://example.com', 'file:///etc/passwd',
      '//example.com', 'example.com', 'https:example.com', 'https://',
      'https://user:pass@example.com/', 'https://user@example.com/', 'https://@example.com/',
      'https://example.com/\npath', 'https://example.com/ bad', 'https://example.com/\u0000',
      'https://example.com/‮', 'https://example.com/‎',
      'https://example.com\\@bad.com', 'https://example.com/' + 'a'.repeat(2000), null]
      .map(url => ({ url })),
    { createdAt: -1 }, { createdAt: T0 + 0.5 }, { createdAt: 'now' },
    { updatedAt: T0 }, { arbitrary: true }];
  for (const patch of patches) {
    rejects({ links: [storedLink(1), storedLink(2, patch), storedLink(3)] });
    assert.deepEqual(parseStoredState(encoded({ links: [storedLink(1), storedLink(2, patch), storedLink(3)] })).links,
      [storedLink(1), storedLink(3)]);
  }
  for (const key of Object.keys(storedLink())) {
    const missing = storedLink(); delete missing[key];
    rejects({ links: [missing] });
    assert.deepEqual(parseStoredState(encoded({ links: [missing] })).links, []);
  }
  const prefix = 'https://example.com/';
  const edge = storedLink(Number.MAX_SAFE_INTEGER, { title: 'x'.repeat(80),
    url: prefix + 'a'.repeat(2000 - prefix.length), createdAt: 0 });
  assert.deepEqual(parseBackup(encoded({ links: [edge] })).links, [edge]);
});

test('workspace caps and duplicate IDs reject on import and recover first valid rows in stored order', () => {
  for (const [field, factory] of [['notes', storedNote], ['links', storedLink]]) {
    const records = Array.from({ length: COLLECTION_LIMITS[field] }, (_, i) => factory(i + 1));
    assert.equal(parseBackup(encoded({ [field]: records }))[field].length, 100);
    records.push(factory(101));
    rejects({ [field]: records });
    assert.equal(parseStoredState(encoded({ [field]: records }))[field].length, 100);
    const duplicates = [factory(3), factory(1), factory(3), factory(2)];
    rejects({ [field]: duplicates });
    assert.deepEqual(parseStoredState(encoded({ [field]: duplicates }))[field],
      [factory(3), factory(1), factory(2)]);
  }
  assert.equal(MAX_BACKUP_CHARS, 2_000_000);
});

test('workspace accessors, symbol/unknown/prototype keys and sparse rows cannot leak into safe records', () => {
  for (const [field, factory] of [['notes', storedNote], ['links', storedLink]]) {
    const poison = JSON.parse(encoded(factory()).slice(0, -1) + ',"__proto__":{"polluted":true}}');
    rejects({ [field]: [poison] });
    assert.deepEqual(normalizeState({ [field]: [poison] })[field], []);
    assert.equal({}.polluted, undefined);
    for (const object of [Object.assign(Object.create({ polluted: true }), factory()),
      { ...factory(), [Symbol('unexpected')]: true }]) {
      assert.throws(() => normalizeState({ [field]: [object] }, { strict: true }), /Invalid backup/);
      assert.deepEqual(normalizeState({ [field]: [object] })[field], []);
    }
    const accessor = factory();
    Object.defineProperty(accessor, 'title', { get() { throw new Error('getter ran'); } });
    assert.throws(() => normalizeState({ [field]: [accessor] }, { strict: true }), /Invalid backup/);
    assert.deepEqual(normalizeState({ [field]: [accessor, factory(2)] })[field], [factory(2)]);
    const sparse = [factory()]; sparse.length = 2;
    assert.throws(() => normalizeState({ [field]: sparse }, { strict: true }), /Invalid backup/);
    assert.deepEqual(normalizeState({ [field]: sparse })[field], [factory()]);
  }
});

test('avatar joined emoji are bounded in UTF-16 units without a two-code-point restriction', () => {
  for (const avatar of ['👩‍💻', '👨‍👩‍👧‍👦', '🏳️‍🌈', '👍🏽']) {
    assert.equal(parseBackup(encoded({ settings: { avatar } })).settings.avatar, avatar);
  }
  assert.equal(TEXT_LIMITS.avatar, 32);
  assert.doesNotThrow(() => parseBackup(encoded({ settings: { avatar: 'x'.repeat(32) } })));
  rejects({ settings: { avatar: 'x'.repeat(33) } });
});

test('avatar data URLs stay image-only, bounded and free of trailing controls', () => {
  for (const mime of ['png', 'jpeg', 'jpg', 'webp', 'gif']) {
    const avatarImage = `data:image/${mime};base64,YQ==`;
    assert.equal(parseBackup(encoded({ settings: { avatarImage } })).settings.avatarImage, avatarImage);
  }
  for (const avatarImage of ['https://example.com/avatar.png', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,YQ==',
    'data:image/png;base64,YQ==\n', 'data:image/png;base64,YQ==\u0000',
    'data:image/png;base64,' + 'A'.repeat(MAX_AVATAR_IMAGE_CHARS)]) {
    rejects({ settings: { avatarImage } });
    assert.equal(parseStoredState(encoded({ settings: { avatarImage } })).settings.avatarImage, '');
  }
});
