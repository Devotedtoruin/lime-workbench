import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { todayKey } from '../js/core.js';
import { defaultState, parseBackup, parseStoredState } from '../js/state.js';
import { remainingFocus, settleFocus, startFocus, pauseFocus, resetFocus } from '../js/focus.js';

const T0 = new Date(2026, 9, 12, 9, 0, 0, 0).getTime();
const DAY = todayKey(new Date(T0));
const fresh = (total = 1500) => ({ ...defaultState().focus, total, remaining: total });
const creditTotal = credits => Object.values(credits).reduce((sum, value) => sum + value, 0);
const applyCredits = (study, credits) => {
  for (const [day, seconds] of Object.entries(credits)) study[day] = (study[day] || 0) + seconds;
};
const roundTrip = session => parseStoredState(JSON.stringify({ focus: session })).focus;

function inTimezone(timezone, source) {
  const moduleURL = new URL('../js/focus.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `import assert from 'node:assert/strict';\n` +
    `import { startFocus, settleFocus } from ${JSON.stringify(moduleURL)};\n` + source],
  { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('start and remainingFocus use an explicit clock and preserve task text', () => {
  const idle = { ...fresh(), text: '写周报 < 两小时' };
  const started = startFocus(idle, T0);
  assert.deepEqual(started.dayCredits, {});
  assert.equal(started.completed, false);
  assert.equal(started.session.running, true);
  assert.equal(started.session.dueAt, T0 + 1500_000);
  assert.equal(started.session.lastCreditedAt, T0);
  assert.equal(started.session.text, idle.text);
  assert.equal(remainingFocus(started.session, T0), 1500);
  assert.equal(remainingFocus(started.session, T0 + 500), 1500);
  assert.equal(remainingFocus(started.session, T0 + 1000), 1499);
  assert.equal(remainingFocus(started.session, T0 + 1499_500), 1);
  assert.equal(remainingFocus(started.session, T0 + 1500_000), 0);
  assert.equal(remainingFocus(started.session, T0 + 1800_000), 0);
  assert.equal(remainingFocus(idle, T0 + 1800_000), 1500);
});

test('500ms ticks accumulate instead of dropping the entire focus credit', () => {
  let session = startFocus(fresh(3), T0).session;
  const study = {};
  for (let offset = 500; offset <= 3000; offset += 500) {
    const result = settleFocus(session, T0 + offset);
    session = result.session;
    applyCredits(study, result.dayCredits);
    assert.equal(result.completed, offset === 3000);
    assert.equal(session.remaining, (3000 - offset) / 1000);
    if (offset % 1000 === 500) assert.equal(session.creditRemainders[DAY], 500);
    else assert.equal(session.creditRemainders[DAY], undefined);
  }
  assert.deepEqual(study, { [DAY]: 3 });
  assert.equal(session.running, false);
  assert.equal(session.dueAt, null);
  assert.equal(session.lastCreditedAt, null);
});

test('irregular ticks and late completion credit exactly the configured round', () => {
  let session = startFocus(fresh(5), T0).session;
  const study = {};
  for (const offset of [17, 333, 501, 999, 1234, 2345, 4901, 50_000]) {
    const result = settleFocus(session, T0 + offset);
    session = result.session;
    applyCredits(study, result.dayCredits);
  }
  assert.deepEqual(study, { [DAY]: 5 });
  assert.equal(session.remaining, 0);
  assert.deepEqual(session.creditRemainders, {});
});

test('settlement never mutates input and returns an independent carry map', () => {
  const carry = Object.freeze({ [DAY]: 250 });
  const input = Object.freeze({ ...startFocus(fresh(5), T0).session, creditRemainders: carry });
  for (const action of [settleFocus, startFocus, pauseFocus, resetFocus]) {
    const result = action(input, T0 + 500);
    assert.notEqual(result.session, input);
    assert.notEqual(result.session.creditRemainders, carry);
    result.session.creditRemainders[DAY] = 1;
    assert.equal(input.creditRemainders[DAY], 250);
    assert.equal(input.remaining, 5);
  }
  const idle = Object.freeze({ ...fresh(5), creditRemainders: Object.freeze({}) });
  const result = settleFocus(idle, T0);
  result.session.creditRemainders[DAY] = 10;
  assert.deepEqual(idle.creditRemainders, {});
});

test('repeated settlement at the same instant cannot double-count', () => {
  const first = settleFocus(startFocus(fresh(5), T0).session, T0 + 1500);
  assert.deepEqual(first.dayCredits, { [DAY]: 1 });
  const second = settleFocus(first.session, T0 + 1500);
  assert.deepEqual(second.dayCredits, {});
  assert.equal(second.completed, false);
  assert.deepEqual(second.session, first.session);
  const done = settleFocus(second.session, T0 + 5000);
  assert.equal(done.completed, true);
  assert.deepEqual(done.dayCredits, { [DAY]: 4 });
  const repeatedDone = settleFocus(done.session, T0 + 50_000);
  assert.equal(repeatedDone.completed, false);
  assert.deepEqual(repeatedDone.dayCredits, {});
  assert.deepEqual(repeatedDone.session, done.session);
});

test('offline restoration settles only the saved remaining and stops at dueAt', () => {
  let session = startFocus(fresh(1500), T0).session;
  const beforeClose = settleFocus(session, T0 + 1200_500);
  session = roundTrip(beforeClose.session);
  assert.equal(session.remaining, 299.5);
  assert.equal(session.creditRemainders[DAY], 500);
  const restored = settleFocus(session, T0 + 86_400_000);
  assert.equal(restored.completed, true);
  assert.deepEqual(restored.dayCredits, { [DAY]: 300 });
  assert.equal(creditTotal(beforeClose.dayCredits) + creditTotal(restored.dayCredits), 1500);
  const reloadAgain = settleFocus(roundTrip(restored.session), T0 + 172_800_000);
  assert.equal(reloadAgain.completed, false);
  assert.deepEqual(reloadAgain.dayCredits, {});
});

test('restoration before expiry maintains its original dueAt and subsecond carry', () => {
  let session = startFocus(fresh(5), T0).session;
  session = roundTrip(settleFocus(session, T0 + 500).session);
  const restored = settleFocus(session, T0 + 2500);
  assert.deepEqual(restored.dayCredits, { [DAY]: 2 });
  assert.equal(restored.completed, false);
  assert.equal(restored.session.dueAt, T0 + 5000);
  assert.equal(restored.session.remaining, 2.5);
  assert.equal(restored.session.creditRemainders[DAY], 500);
  const done = settleFocus(roundTrip(restored.session), T0 + 5000);
  assert.deepEqual(done.dayCredits, { [DAY]: 3 });
});

test('missing legacy credit cursor infers the saved remaining interval, not a full total', () => {
  const legacy = { total: 1500, remaining: 10, running: true,
    dueAt: T0 + 10_000, lastCreditedAt: null };
  const normalized = parseBackup(JSON.stringify({ version: 2, focus: legacy })).focus;
  const result = settleFocus(normalized, T0 + 86_400_000);
  assert.deepEqual(result.dayCredits, { [DAY]: 10 });
  assert.equal(result.completed, true);
  assert.equal(result.session.text, '');
  assert.deepEqual(result.session.creditRemainders, {});
  const directLegacy = settleFocus(legacy, T0 + 1000);
  assert.deepEqual(directLegacy.dayCredits, { [DAY]: 1 });
  assert.equal(directLegacy.session.remaining, 9);
  assert.equal(directLegacy.session.text, '');
});

test('stale credit timestamps cannot grant more than remaining or total', () => {
  const session = { ...fresh(1500), remaining: 10, running: true,
    dueAt: T0 + 10_000, lastCreditedAt: T0 - 86_400_000 };
  const result = settleFocus(session, T0 + 86_400_000);
  assert.deepEqual(result.dayCredits, { [DAY]: 10 });
  assert.equal(result.completed, true);
  const zero = settleFocus({ ...session, remaining: 0 }, T0 + 86_400_000);
  assert.deepEqual(zero.dayCredits, {});
});

test('pause settles first and keeps exact fractional remaining across resume', () => {
  const session = startFocus({ ...fresh(5), text: '小任务' }, T0).session;
  const paused = pauseFocus(session, T0 + 1500);
  assert.deepEqual(paused.dayCredits, { [DAY]: 1 });
  assert.equal(paused.completed, false);
  assert.equal(paused.session.remaining, 3.5);
  assert.equal(paused.session.running, false);
  assert.equal(paused.session.dueAt, null);
  assert.equal(paused.session.lastCreditedAt, null);
  assert.equal(paused.session.creditRemainders[DAY], 500);
  assert.equal(remainingFocus(paused.session, T0 + 1_000_000), 4);
  const idle = settleFocus(roundTrip(paused.session), T0 + 1_000_000);
  assert.deepEqual(idle.dayCredits, {});
  assert.equal(idle.session.remaining, 3.5);
  const resumed = startFocus(idle.session, T0 + 1_000_000);
  assert.equal(resumed.session.dueAt, T0 + 1_003_500);
  assert.equal(resumed.session.text, '小任务');
  const done = settleFocus(resumed.session, T0 + 1_003_500);
  assert.deepEqual(done.dayCredits, { [DAY]: 4 });
  assert.equal(done.completed, true);
  assert.deepEqual(done.session.creditRemainders, {});
});

test('many subsecond pause/resume cycles do not extend a round or lose credit', () => {
  let now = T0;
  let session = fresh(2);
  let credited = 0;
  for (let i = 0; i < 8; i++) {
    session = startFocus(session, now).session;
    now += 250;
    const result = pauseFocus(session, now);
    session = roundTrip(result.session);
    credited += creditTotal(result.dayCredits);
    assert.equal(session.remaining, 2 - (i + 1) / 4);
    assert.equal(result.completed, i === 7);
    now += 10_000;
  }
  assert.equal(credited, 2);
});

test('reset and duration changes settle elapsed time before discarding the countdown', () => {
  const session = startFocus({ ...fresh(5), text: '计划 < 3' }, T0).session;
  const reset = resetFocus(session, T0 + 1500, 10);
  assert.deepEqual(reset.dayCredits, { [DAY]: 1 });
  assert.equal(reset.session.total, 10);
  assert.equal(reset.session.remaining, 10);
  assert.equal(reset.session.running, false);
  assert.equal(reset.session.text, '计划 < 3');
  assert.equal(reset.session.creditRemainders[DAY], 500);
  const next = settleFocus(startFocus(reset.session, T0 + 2000).session, T0 + 2500);
  assert.deepEqual(next.dayCredits, { [DAY]: 1 });
  assert.deepEqual(next.session.creditRemainders, {});
  const sameDuration = resetFocus(session, T0 + 1000);
  assert.equal(sameDuration.session.total, 5);
  assert.equal(sameDuration.session.remaining, 5);
});

test('pause/reset after expiry still credit only to deadline and signal completion', () => {
  const session = startFocus(fresh(5), T0).session;
  for (const action of [pauseFocus, resetFocus]) {
    const result = action(session, T0 + 1_000_000);
    assert.deepEqual(result.dayCredits, { [DAY]: 5 });
    assert.equal(result.completed, true);
    assert.equal(result.session.running, false);
    assert.equal(result.session.remaining, action === resetFocus ? 5 : 0);
    assert.deepEqual(settleFocus(result.session, T0 + 2_000_000).dayCredits, {});
  }
});

test('start on a running session settles without moving the deadline', () => {
  const session = startFocus(fresh(5), T0).session;
  const again = startFocus(session, T0 + 1500);
  assert.deepEqual(again.dayCredits, { [DAY]: 1 });
  assert.equal(again.session.dueAt, session.dueAt);
  assert.equal(again.session.remaining, 3.5);
  assert.equal(again.session.running, true);
});

test('start after completion opens a new round, without old idle time', () => {
  const session = startFocus(fresh(5), T0).session;
  const next = startFocus(session, T0 + 1_000_000);
  assert.equal(next.completed, true);
  assert.deepEqual(next.dayCredits, { [DAY]: 5 });
  assert.equal(next.session.total, 5);
  assert.equal(next.session.remaining, 5);
  assert.equal(next.session.dueAt, T0 + 1_005_000);
  assert.equal(next.session.lastCreditedAt, T0 + 1_000_000);
  assert.deepEqual(settleFocus(next.session, T0 + 1_000_500).dayCredits, {});
});

test('completion context snapshots the expired input before start/pause/reset transition', () => {
  const input = Object.freeze({ ...startFocus({ ...fresh(5), text: '任务 A < 完成', taskId: 123 }, T0).session,
    creditRemainders: Object.freeze({}) });
  const expected = { dueAt: T0 + 5000, text: '任务 A < 完成', taskId: 123 };
  for (const action of [settleFocus, startFocus, pauseFocus, resetFocus]) {
    const result = action(input, T0 + 60_000);
    assert.equal(result.completed, true);
    assert.deepEqual(result.completionContext, expected);
    assert.deepEqual(result.dayCredits, { [DAY]: 5 });
    assert.equal(result.session.text, input.text);
    assert.equal(result.session.taskId, input.taskId);
    assert.notEqual(result.completionContext, input);
    if (action === startFocus) {
      assert.equal(result.session.dueAt, T0 + 65_000);
      assert.notEqual(result.completionContext.dueAt, result.session.dueAt);
    } else assert.equal(result.session.dueAt, null);
    // Caller may select B immediately; neither returned session nor input can rewrite A's context.
    result.session.text = '任务 B'; result.session.taskId = 456;
    assert.deepEqual(result.completionContext, expected);
    result.completionContext.text = 'changed context';
    assert.equal(result.session.text, '任务 B');
    assert.equal(input.text, '任务 A < 完成');
    assert.equal(input.taskId, 123);
  }
  const changedDuration = resetFocus(input, T0 + 60_000, 20);
  assert.deepEqual(changedDuration.completionContext, expected);
  assert.equal(changedDuration.session.total, 20);
  assert.equal(changedDuration.session.remaining, 20);
});

test('completion context is null without an expiry transition and cannot repeat after reload', () => {
  const idle = { ...fresh(5), text: '关联任务', taskId: 123 };
  for (const action of [settleFocus, startFocus, pauseFocus, resetFocus]) {
    const result = action(idle, T0);
    assert.equal(result.completed, false);
    assert.equal(result.completionContext, null);
    assert.equal(result.session.taskId, 123);
  }
  const running = startFocus(idle, T0).session;
  for (const action of [settleFocus, startFocus, pauseFocus, resetFocus]) {
    const result = action(running, T0 + 4999);
    assert.equal(result.completed, false);
    assert.equal(result.completionContext, null);
    assert.equal(result.session.taskId, 123);
  }
  const done = settleFocus(running, T0 + 5000);
  assert.deepEqual(done.completionContext, { dueAt: T0 + 5000, text: idle.text, taskId: 123 });
  assert.equal(Object.hasOwn(done.session, 'completionContext'), false);
  for (const action of [settleFocus, startFocus, pauseFocus, resetFocus]) {
    const result = action(roundTrip(done.session), T0 + 60_000);
    assert.equal(result.completed, false);
    assert.equal(result.completionContext, null);
  }
  const paused = pauseFocus(running, T0 + 1500);
  const resumed = startFocus(roundTrip(paused.session), T0 + 60_000);
  assert.equal(paused.session.taskId, 123);
  assert.equal(resumed.session.taskId, 123);
});

test('unlinked legacy expiry reports null task identity instead of guessing from text', () => {
  const legacy = { total: 5, remaining: 5, running: true, dueAt: T0 + 5000,
    lastCreditedAt: T0 };
  const result = settleFocus(legacy, T0 + 5000);
  assert.deepEqual(result.completionContext, { dueAt: T0 + 5000, text: '', taskId: null });
  assert.equal(result.session.taskId, null);
  const named = settleFocus({ ...legacy, text: '已有同名任务' }, T0 + 5000);
  assert.deepEqual(named.completionContext,
    { dueAt: T0 + 5000, text: '已有同名任务', taskId: null });
});

test('cross-midnight credits split by local day and end exactly at midnight', () => {
  const midnight = new Date(2026, 9, 13, 0, 0, 0, 0).getTime();
  const previousDay = todayKey(new Date(midnight - 1));
  const nextDay = todayKey(new Date(midnight));
  const session = startFocus(fresh(4), midnight - 2000).session;
  const result = settleFocus(session, midnight + 20_000);
  assert.deepEqual(result.dayCredits, { [previousDay]: 2, [nextDay]: 2 });
  assert.equal(result.completed, true);
  const untilMidnight = settleFocus(startFocus(fresh(2), midnight - 2000).session, midnight + 20_000);
  assert.deepEqual(untilMidnight.dayCredits, { [previousDay]: 2 });
});

test('subsecond carry stays with its own local day across midnight and persisted pause', () => {
  const midnight = new Date(2026, 9, 13, 0, 0, 0, 0).getTime();
  const previousDay = todayKey(new Date(midnight - 1));
  const nextDay = todayKey(new Date(midnight));
  const session = startFocus(fresh(3), midnight - 1500).session;
  const result = pauseFocus(session, midnight + 500);
  assert.deepEqual(result.dayCredits, { [previousDay]: 1 });
  assert.deepEqual(result.session.creditRemainders, { [previousDay]: 500, [nextDay]: 500 });
  assert.equal(result.session.remaining, 1);
  const resumed = startFocus(roundTrip(result.session), midnight + 10_000);
  const done = settleFocus(resumed.session, midnight + 11_000);
  assert.deepEqual(done.dayCredits, { [nextDay]: 1 });
  assert.deepEqual(done.session.creditRemainders, { [previousDay]: 500, [nextDay]: 500 });
});

test('maximum-duration late offline restoration cannot charge unrelated later days', () => {
  const start = new Date(2026, 9, 12, 12, 0, 0, 0).getTime();
  const end = start + 86_400_000;
  const session = startFocus(fresh(86_400), start).session;
  const result = settleFocus(session, start + 7 * 86_400_000);
  assert.equal(result.completed, true);
  assert.equal(creditTotal(result.dayCredits), 86_400);
  assert.equal(Object.keys(result.dayCredits).at(-1), todayKey(new Date(end - 1)));
  assert.equal(result.session.remaining, 0);
});

test('backwards wall-clock changes cannot rewind the cursor or double-count', () => {
  const session = startFocus(fresh(5), T0).session;
  const first = settleFocus(session, T0 + 1500);
  const backwards = settleFocus(first.session, T0 + 500);
  assert.deepEqual(backwards.dayCredits, {});
  assert.equal(backwards.session.remaining, 3.5);
  assert.equal(backwards.session.lastCreditedAt, T0 + 1500);
  assert.equal(remainingFocus(backwards.session, T0 - 10_000), 4);
  const caughtUp = settleFocus(backwards.session, T0 + 1500);
  assert.deepEqual(caughtUp.dayCredits, {});
  const done = settleFocus(caughtUp.session, T0 + 5000);
  assert.equal(creditTotal(first.dayCredits) + creditTotal(done.dayCredits), 5);
});

test('future credit cursor causes no early credit and no countdown extension', () => {
  const session = { ...startFocus(fresh(5), T0).session, lastCreditedAt: T0 + 3000 };
  const result = settleFocus(session, T0 + 1000);
  assert.deepEqual(result.dayCredits, {});
  assert.equal(result.session.lastCreditedAt, T0 + 3000);
  assert.equal(result.session.remaining, 4);
  const done = settleFocus(result.session, T0 + 100_000);
  assert.deepEqual(done.dayCredits, { [DAY]: 2 });
});

test('epoch zero is a valid credit cursor, not a missing timestamp', () => {
  const session = startFocus(fresh(2), 0).session;
  const result = settleFocus(session, 1000);
  assert.equal(creditTotal(result.dayCredits), 1);
  assert.equal(result.session.lastCreditedAt, 1000);
  assert.equal(result.session.remaining, 1);
});

test('local day accounting differs from UTC day in Asia/Shanghai', () => {
  inTimezone('Asia/Shanghai', `
    const start = new Date('2026-10-12T23:59:58+08:00').getTime();
    const session = startFocus({ total: 4, remaining: 4, running: false,
      dueAt: null, lastCreditedAt: null }, start).session;
    const result = settleFocus(session, start + 60_000);
    assert.deepEqual(result.dayCredits, { '2026-10-12': 2, '2026-10-13': 2 });
  `);
});

test('local midnight splitting honors both 23h and 25h DST days', () => {
  inTimezone('America/New_York', `
    const idle = { total: 86_400, remaining: 86_400, running: false,
      dueAt: null, lastCreditedAt: null };
    const spring = new Date('2026-03-08T00:00:00-05:00').getTime();
    const springResult = settleFocus(startFocus(idle, spring).session, spring + 172_800_000);
    assert.deepEqual(springResult.dayCredits, { '2026-03-08': 82_800, '2026-03-09': 3600 });
    const autumn = new Date('2026-10-31T23:00:00-04:00').getTime();
    const autumnResult = settleFocus(startFocus(idle, autumn).session, autumn + 172_800_000);
    assert.deepEqual(autumnResult.dayCredits, { '2026-10-31': 3600, '2026-11-01': 82_800 });
  `);
});

test('invalid clock values and reset durations are rejected rather than producing NaN', () => {
  for (const now of [NaN, Infinity, -1, 1.5, '123', undefined, Number.MAX_SAFE_INTEGER]) {
    for (const action of [remainingFocus, settleFocus, startFocus, pauseFocus, resetFocus]) {
      assert.throws(() => action(fresh(), now), RangeError);
    }
  }
  for (const total of [0, -1, 0.5, 86_401, NaN, Infinity, '25']) {
    assert.throws(() => resetFocus(fresh(), T0, total), RangeError);
  }
});
