import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PENDING_ALERTS, upsertAlert, ackAlert, removeSourceAlerts,
  snoozeAlert, visibleAlerts, nextUpcoming, upcomingList, upcomingEntries
} from '../js/alerts.js';
import { defaultState, parseBackup, parseStoredState } from '../js/state.js';
import { advance, scanDue } from '../js/reminders.js';

const T0 = Date.UTC(2026, 9, 13, 9);
const alert = (id = 'water', patch = {}) => ({ sourceKind: 'reminder', sourceId: id,
  label: '喝水', text: '喝水 < 休息一下 >', icon: 'water', dueAt: T0,
  snoozedUntil: null, ...patch });
const reminder = (id = 'water', patch = {}) => ({ id, kind: 'interval', label: '喝水',
  text: '喝水 < 休息一下 >', icon: 'water', enabled: true, every: 1,
  startAt: T0 - 60_000, nextAt: T0, ...patch });
const candidate = (id, dueAt, patch = {}) => ({ sourceKind: 'reminder', sourceId: id,
  label: '喝水', dueAt, icon: 'water', isSnoozed: false, ...patch });
const freeze = list => Object.freeze(list.map(Object.freeze));

function queueDue(reminders, pending, now) {
  let alerts = pending;
  const due = scanDue(reminders, now);
  for (const item of due) alerts = upsertAlert(alerts, alert(item.id, {
    label: item.label, text: item.text, icon: item.icon,
    dueAt: item.kind === 'timer' ? item.endAt : item.nextAt
  }), now);
  return { alerts, reminders: reminders.map(item => due.includes(item) ? advance(item, now) : item) };
}

test('simultaneous reminders and focus queue separately; one acknowledgement never swallows others', () => {
  const original = freeze([]);
  const water = upsertAlert(original, alert('water'), T0);
  const eyes = upsertAlert(water, alert('eyes', { icon: 'eye', label: '护眼' }), T0);
  const all = upsertAlert(eyes, alert('focus', { sourceKind: 'focus', icon: 'tomato', label: '专注完成' }), T0);
  assert.deepEqual(all.map(a => `${a.sourceKind}:${a.sourceId}`),
    ['reminder:water', 'reminder:eyes', 'focus:focus']);
  assert.deepEqual(visibleAlerts(all, T0), all);
  const acknowledged = ackAlert(freeze(all), 'reminder', 'water');
  assert.deepEqual(acknowledged, all.slice(1));
  assert.strictEqual(acknowledged[0], all[1]);
  assert.strictEqual(acknowledged[1], all[2]);
  assert.equal(all.length, 3);
  assert.deepEqual(original, []);
  assert.deepEqual(removeSourceAlerts(all, 'focus', 'focus'), all.slice(0, 2));
});

test('source keys include kind and acknowledgement is safe for an absent source', () => {
  const list = freeze([alert('focus'), alert('focus', { sourceKind: 'focus' })]);
  assert.deepEqual(ackAlert(list, 'reminder', 'focus'), [list[1]]);
  assert.deepEqual(ackAlert(list, 'focus', 'focus'), [list[0]]);
  const absent = ackAlert(list, 'reminder', 'absent');
  assert.notStrictEqual(absent, list);
  assert.deepEqual(absent, list);
});

test('upsert updates the same source in stable order without mutating alert/list or unrelated records', () => {
  const list = freeze([alert('first'), alert('second')]);
  const emitted = Object.freeze(alert('first', { dueAt: T0 + 60_000, label: '再次喝水' }));
  const result = upsertAlert(list, emitted, T0 + 60_000);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, '再次喝水');
  assert.equal(result[0].dueAt, T0 + 60_000);
  assert.strictEqual(result[1], list[1]);
  assert.notStrictEqual(result, list);
  assert.notStrictEqual(result[0], emitted);
  assert.equal(list[0].dueAt, T0);
  const { snoozedUntil, ...unsnoozed } = alert('new');
  assert.equal(upsertAlert(list, unsnoozed, T0)[2].snoozedUntil, null);
});

test('snooze suppresses visibility until the exact deadline without changing source dueAt', () => {
  const list = freeze([alert('water'), alert('eyes')]);
  const snoozed = snoozeAlert(list, 'reminder', 'water', T0);
  assert.equal(snoozed[0].snoozedUntil, T0 + 300_000);
  assert.equal(snoozed[0].dueAt, T0);
  assert.strictEqual(snoozed[1], list[1]);
  assert.deepEqual(visibleAlerts(snoozed, T0), [list[1]]);
  assert.deepEqual(visibleAlerts(snoozed, T0 + 299_999), [list[1]]);
  assert.deepEqual(visibleAlerts(snoozed, T0 + 300_000), snoozed);
  assert.equal(list[0].snoozedUntil, null);
  const absent = snoozeAlert(list, 'reminder', 'absent', T0);
  assert.notStrictEqual(absent, list);
  assert.deepEqual(absent, list);
  assert.equal(snoozeAlert(list, 'reminder', 'water', T0, 1)[0].snoozedUntil, T0 + 60_000);
});

test('a new recurring interval occurrence preserves active snooze and replaces only that source', () => {
  const reminders = freeze([reminder('water'), reminder('eyes')]);
  let scanned = queueDue(reminders, [], T0);
  const expectedSchedule = structuredClone(scanned.reminders);
  scanned.alerts = snoozeAlert(scanned.alerts, 'reminder', 'water', T0);
  assert.deepEqual(scanned.reminders, expectedSchedule);
  const other = scanned.alerts[1];
  const next = queueDue(scanned.reminders, scanned.alerts, T0 + 60_000);
  assert.equal(next.alerts.length, 2);
  assert.equal(next.alerts[0].dueAt, T0 + 60_000);
  assert.equal(next.alerts[0].snoozedUntil, T0 + 300_000);
  assert.equal(next.alerts[1].snoozedUntil, null);
  assert.notStrictEqual(next.alerts[1], other); // the other interval also independently fired
  assert.deepEqual(visibleAlerts(next.alerts, T0 + 60_000).map(a => a.sourceId), ['eyes']);
  assert.equal(scanned.alerts[0].dueAt, T0);
  assert.equal(scanned.alerts[0].snoozedUntil, T0 + 300_000);
  assert.equal(next.reminders[0].nextAt, T0 + 120_000);
  const expired = upsertAlert(next.alerts, alert('water', { dueAt: T0 + 300_000 }), T0 + 300_000);
  assert.equal(expired[0].snoozedUntil, null);
  assert.equal(visibleAlerts(expired, T0 + 300_000).length, 2);
});

test('active snooze is not cleared by a duplicate scan while expired snooze remains purely read-only', () => {
  const list = freeze([alert('water', { snoozedUntil: T0 + 300_000 }), alert('eyes')]);
  const updated = upsertAlert(list, alert('water', { label: '更新提醒', snoozedUntil: null }), T0);
  assert.equal(updated[0].snoozedUntil, T0 + 300_000);
  assert.strictEqual(updated[1], list[1]);
  assert.deepEqual(visibleAlerts(list, T0 + 300_000), list);
  assert.deepEqual(visibleAlerts(list, T0 + 600_000), list);
  assert.equal(list[0].snoozedUntil, T0 + 300_000);
});

test('persisted pending alerts survive refresh, including completed source and snoozed focus', () => {
  const state = defaultState();
  const scanned = queueDue([reminder('one-shot', { kind: 'timer', minutes: 1, endAt: T0 })], [], T0);
  state.reminders = scanned.reminders;
  state.pendingAlerts = upsertAlert(scanned.alerts,
    alert('focus', { sourceKind: 'focus', icon: 'tomato', label: '专注完成' }), T0);
  state.pendingAlerts = snoozeAlert(state.pendingAlerts, 'focus', 'focus', T0);
  const text = JSON.stringify(state);
  for (const restored of [parseStoredState(text), parseBackup(text)]) {
    assert.deepEqual(restored.pendingAlerts, state.pendingAlerts);
    assert.equal(restored.reminders[0].completed, true);
    assert.deepEqual(visibleAlerts(restored.pendingAlerts, T0).map(a => a.sourceId), ['one-shot']);
    assert.deepEqual(nextUpcoming(restored.reminders, restored.pendingAlerts, T0),
      candidate('focus', T0 + 300_000,
        { sourceKind: 'focus', label: '专注完成', icon: 'tomato', isSnoozed: true }));
    assert.equal(visibleAlerts(restored.pendingAlerts, T0 + 300_000).length, 2);
  }
});

test('nextUpcoming selects earliest enabled incomplete schedule, keeping tie and labels stable', () => {
  const list = freeze([
    reminder('disabled', { enabled: false, nextAt: T0 + 1_000 }),
    reminder('completed', { completed: true, nextAt: T0 + 1_000 }),
    reminder('later', { nextAt: T0 + 60_000 }),
    reminder('first-tie', { kind: 'timer', endAt: T0 + 30_000 }),
    reminder('second-tie', { kind: 'once', nextAt: T0 + 30_000 })
  ]);
  assert.deepEqual(nextUpcoming(list, [], T0), candidate('first-tie', T0 + 30_000));
  const custom = reminder('original', { label: '<原始提醒标签>', nextAt: T0 + 2_000 });
  assert.equal(nextUpcoming([custom], [], T0).label, '<原始提醒标签>');
  assert.equal(nextUpcoming([], [], T0), null);
});

test('nextUpcoming distinguishes old pending occurrences from genuinely due but unscanned schedules', () => {
  const dueNow = reminder('now');
  const past = reminder('past', { nextAt: T0 - 60_000 });
  assert.deepEqual(nextUpcoming([dueNow], [], T0), candidate('now', T0));
  assert.deepEqual(nextUpcoming([past], [], T0), candidate('past', T0 - 60_000));
  assert.equal(nextUpcoming([], [alert('old', { dueAt: T0 - 60_000 })], T0), null);
  assert.equal(nextUpcoming([past], [alert('past', { dueAt: T0 - 60_000 })], T0), null);
  // An older occurrence of a recurring source must not hide a new due scan.
  assert.deepEqual(nextUpcoming([dueNow], [alert('now', { dueAt: T0 - 60_000 })], T0), candidate('now', T0));
  assert.deepEqual(nextUpcoming([reminder('old', { nextAt: T0 + 60_000 })],
    [alert('old', { dueAt: T0 - 60_000 })], T0), candidate('old', T0 + 60_000));
});

test('nextUpcoming includes future snooze deadlines, but never expired pending attention as future', () => {
  const alerts = freeze([alert('snoozed', { snoozedUntil: T0 + 300_000 }),
    alert('old', { dueAt: T0 - 1_000 }), alert('expired', { snoozedUntil: T0 })]);
  assert.deepEqual(nextUpcoming([], alerts, T0), candidate('snoozed', T0 + 300_000, { isSnoozed: true }));
  assert.deepEqual(nextUpcoming([reminder('earlier', { nextAt: T0 + 60_000 })], alerts, T0),
    candidate('earlier', T0 + 60_000));
  assert.equal(nextUpcoming([], alerts, T0 + 300_000), null);
  assert.deepEqual(nextUpcoming([reminder('snoozed')], alerts, T0),
    candidate('snoozed', T0 + 300_000, { isSnoozed: true }));
});

test('capacity 501 never drops records; updates/removal allowed while insertion beyond cap throws', () => {
  const list = freeze(Array.from({ length: MAX_PENDING_ALERTS }, (_, i) => alert(`r-${i}`)));
  assert.equal(MAX_PENDING_ALERTS, 501);
  assert.throws(() => upsertAlert(list, alert('overflow'), T0), /capacity/i);
  assert.equal(list.length, 501);
  assert.equal(list[500].sourceId, 'r-500');
  const updated = upsertAlert(list, alert('r-250', { label: '替换' }), T0);
  assert.equal(updated.length, 501);
  assert.equal(updated[250].label, '替换');
  assert.strictEqual(updated[0], list[0]);
  assert.strictEqual(updated[500], list[500]);
  const freed = ackAlert(list, 'reminder', 'r-250');
  assert.equal(upsertAlert(freed, alert('new'), T0).length, 501);
  assert.throws(() => visibleAlerts([...list, alert('extra')], T0), /capacity/i);
});

test('alert API rejects invalid data, duplicate sources, sparse arrays and accessor properties', () => {
  const bad = [
    null, [], { ...alert(), sourceKind: 'timer' }, { ...alert(), sourceId: 'x'.repeat(65) },
    { ...alert(), sourceKind: 'focus', sourceId: 'anything-else' },
    { ...alert(), label: 'x'.repeat(121) }, { ...alert(), text: 'x'.repeat(301) },
    { ...alert(), text: 'bad\u0000' }, { ...alert(), icon: '<script>' },
    { ...alert(), sourceId: 'valid\n' }, { ...alert(), dueAt: T0 + 0.5 },
    { ...alert(), dueAt: Infinity }, { ...alert(), snoozedUntil: 'later' },
    { ...alert(), unknown: true }
  ];
  for (const item of bad) assert.throws(() => upsertAlert([], item, T0));
  assert.throws(() => ackAlert([], 'focus', 'other'), /source/i);
  assert.throws(() => ackAlert([], 'reminder', '../unsafe'), /source/i);
  assert.throws(() => visibleAlerts([alert(), alert()], T0), /duplicate/i);
  const sparse = [alert()];
  sparse.length = 2;
  assert.throws(() => visibleAlerts(sparse, T0), /record/i);
  const getter = alert();
  Object.defineProperty(getter, 'label', { get() { throw new Error('getter ran'); } });
  assert.throws(() => upsertAlert([], getter, T0), /Invalid backup/);
  const { snoozedUntil, ...missingSnooze } = alert();
  assert.throws(() => visibleAlerts([missingSnooze], T0), /snooze/i);
  for (const now of [undefined, null, 'now', -1, T0 + 0.5, Infinity]) {
    assert.throws(() => visibleAlerts([], now));
    assert.throws(() => upsertAlert([], alert(), now));
    assert.throws(() => nextUpcoming([], [], now));
  }
  for (const minutes of [null, true, '5', 0, -1, 1441, Infinity, NaN]) {
    assert.throws(() => snoozeAlert([alert()], 'reminder', 'water', T0, minutes));
  }
  assert.throws(() => snoozeAlert([alert()], 'reminder', 'water', Date.UTC(2101, 0, 1)), /duration/i);
});

test('visible future dueAt records do not appear early and helpers never need storage/window globals', () => {
  const list = freeze([alert('future', { dueAt: T0 + 1_000 }), alert('ready')]);
  assert.deepEqual(visibleAlerts(list, T0), [list[1]]);
  assert.deepEqual(visibleAlerts(list, T0 + 1_000), list);
  assert.equal(nextUpcoming([null, { enabled: true }, reminder('bad', { nextAt: NaN })], [], T0), null);
  assert.equal(nextUpcoming([reminder('fallback', { icon: '<unsafe>', nextAt: T0 + 1000 })], [], T0).icon, 'bell');
});

test('upcomingEntries exposes all candidates so a capped preview can show exact remaining count', () => {
  const list = freeze(Array.from({ length: 8 }, (_, i) => reminder(`future-${i}`, { nextAt: T0 + (i + 1) * 60000 })));
  const all = upcomingEntries(list, [], T0);
  assert.equal(all.length, 8);
  assert.deepEqual(upcomingList(list, [], T0), all.slice(0, 5));
  assert.equal(all.length - upcomingList(list, [], T0).length, 3);
  assert.deepEqual(list.map(r => r.id), Array.from({ length: 8 }, (_, i) => `future-${i}`));
});

test('upcomingList returns several upcoming items earliest first, one per source, capped by limit', () => {
  const list = freeze([
    reminder('later', { nextAt: T0 + 60_000 }),
    reminder('disabled', { enabled: false, nextAt: T0 + 1_000 }),
    reminder('first', { kind: 'timer', endAt: T0 + 10_000 }),
    reminder('snoozed', { nextAt: T0 + 900_000 }),
    reminder('tie', { kind: 'once', nextAt: T0 + 60_000 })
  ]);
  const alerts = freeze([alert('snoozed', { snoozedUntil: T0 + 300_000 })]);
  const result = upcomingList(list, alerts, T0);
  assert.deepEqual(result.map(item => item.sourceId), ['first', 'later', 'tie', 'snoozed']);
  assert.equal(result[3].isSnoozed, true);
  assert.equal(result[3].dueAt, T0 + 300_000);
  assert.deepEqual(upcomingList(list, alerts, T0, 2).map(item => item.sourceId), ['first', 'later']);
  assert.deepEqual(upcomingList([], [], T0), []);
  assert.deepEqual(nextUpcoming(list, alerts, T0), result[0]);
  for (const limit of [0, -1, 1.5, 101, '3']) assert.throws(() => upcomingList(list, alerts, T0, limit));
});
