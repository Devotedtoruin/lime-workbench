import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, TIMER_PRESETS, MIN_REMINDER_MINUTES, MAX_REMINDER_MINUTES,
  makeInterval, makeTimer, makeDaily, makeOnce, pauseReminder, resumeReminder,
  scanDue, advance, progress, humanRemain, fmt,
  nextInterval, nextDaily, timeToDate, remainSec
} from '../js/reminders.js';

const T0 = new Date(2026, 9, 12, 9, 0, 0).getTime(); // 周一 09:00

test('间隔提醒的下一次触发时间', () => {
  assert.equal(nextInterval(T0, 45, T0), T0 + 45 * 60000);
  assert.equal(nextInterval(T0, 45, T0 + 46 * 60000), T0 + 90 * 60000);
});

test('每天定点提醒：今天没到就今天，过了就明天', () => {
  const now = new Date(2026, 9, 12, 8, 0);
  assert.equal(nextDaily('09:00', now).getDate(), 12);
  const now2 = new Date(2026, 9, 12, 10, 0);
  assert.equal(nextDaily('09:00', now2).getDate(), 13);
});

test('时间字符串转 Date', () => {
  const d = timeToDate('14:30', new Date(2026, 9, 12));
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 30);
});

test('倒计时剩余秒数', () => {
  assert.equal(remainSec(T0, 25, T0), 25 * 60);
  assert.equal(remainSec(T0, 25, T0 + 25 * 60000), 0);
  assert.equal(remainSec(T0, 25, T0 + 30 * 60000), 0); // 超时不给负数
});

test('秒格式化', () => {
  assert.equal(fmt(65), '01:05');
  assert.equal(fmt(3661), '01:01:01');
  assert.equal(fmt(0), '00:00');
});

test('创建间隔提醒', () => {
  const r = makeInterval('water', 30);
  assert.equal(r.kind, 'interval');
  assert.equal(r.every, 30);
  assert.equal(r.label, '喝水');
  assert.ok(r.nextAt > Date.now());
});

test('创建倒计时', () => {
  const r = makeTimer('pomo');
  assert.equal(r.kind, 'timer');
  assert.equal(r.minutes, 25);
  assert.ok(r.endAt > r.startAt);
});

test('创建每日提醒', () => {
  const r = makeDaily('开会', '14:30');
  assert.equal(r.kind, 'daily');
  assert.equal(r.time, '14:30');
  assert.ok(r.nextAt > Date.now());
});

test('daily creation normalizes clock and missed occurrences advance once without a catch-up storm', () => {
  const now = new Date(2026, 9, 12, 8);
  const daily = makeDaily('日报', '9:00', '写日报', now);
  assert.equal(daily.time, '09:00');
  assert.equal(daily.nextAt, new Date(2026, 9, 12, 9).getTime());
  const reopened = new Date(2026, 9, 15, 10).getTime();
  assert.equal(scanDue([daily], reopened).length, 1);
  const next = advance(daily, reopened);
  assert.equal(next.nextAt, new Date(2026, 9, 16, 9).getTime());
  assert.equal(next.fired, 1);
  assert.equal(scanDue([next], reopened).length, 0);
  for (const invalid of ['24:00', '09:60', 'nonsense']) assert.throws(() => makeDaily('日报', invalid), RangeError);
});

test('扫描到期提醒', () => {
  const now = Date.now();
  const due = makeInterval('water', 1);
  due.nextAt = now - 1000; // 已过期
  const notDue = makeInterval('eyes', 60);
  const list = [due, notDue];
  const found = scanDue(list, now);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, due.id);
});

test('暂停的提醒不触发', () => {
  const r = makeInterval('water', 1);
  r.nextAt = Date.now() - 1000;
  r.enabled = false;
  assert.equal(scanDue([r], Date.now()).length, 0);
});

test('触发后推进到下一次', () => {
  const now = Date.now();
  const r = makeInterval('water', 30);
  r.nextAt = now - 1;
  const advanced = advance(r, now);
  assert.ok(advanced.nextAt > now);
  assert.equal(advanced.fired, 1);
});

test('倒计时只触发一次，推进后完成且不自动重启', () => {
  const now = Date.now();
  const r = makeTimer('pomo', 1);
  r.endAt = now - 1;
  assert.equal(scanDue([r], now).length, 1);
  const a = advance(r, now);
  assert.equal(a.endAt, r.endAt);
  assert.equal(a.minutes, 1);
  assert.equal(a.enabled, false);
  assert.equal(a.completed, true);
  assert.equal(a.fired, 1);
  assert.equal(scanDue([a], now + 60000).length, 0);
  assert.throws(() => resumeReminder(a, now + 60000), RangeError);
});

test('进度百分比', () => {
  const r = makeTimer('pomo', 25);
  const half = r.startAt + (r.endAt - r.startAt) / 2;
  const p = progress(r, half);
  assert.ok(p > 0.45 && p < 0.55);
});

test('人话倒计时', () => {
  const r = makeTimer('pomo', 25);
  assert.match(humanRemain(r, r.startAt), /还剩/);
  const iv = makeInterval('water', 45);
  assert.match(humanRemain(iv, iv.nextAt - 30 * 60000), /分/);
});

test('预设配置完整', () => {
  assert.ok(PRESETS.length >= 5);
  assert.ok(TIMER_PRESETS.length >= 5);
  PRESETS.forEach(p => assert.ok(p.every > 0 && p.label && p.icon));
  TIMER_PRESETS.forEach(p => assert.ok(p.minutes > 0 && p.label));
});

test('间隔和倒计时的分钟数必须为正且有界的有限数', () => {
  for (const minutes of [-1, 0, 0.5, Infinity, NaN, 'abc', MAX_REMINDER_MINUTES + 1]) {
    assert.throws(() => makeInterval('water', minutes), RangeError);
    assert.throws(() => makeTimer('pomo', minutes), RangeError);
    assert.throws(() => nextInterval(T0, minutes, T0), RangeError);
    assert.throws(() => remainSec(T0, minutes, T0), RangeError);
  }
  assert.equal(makeInterval('water', MIN_REMINDER_MINUTES).every, MIN_REMINDER_MINUTES);
  assert.equal(makeTimer('pomo', MAX_REMINDER_MINUTES).minutes, MAX_REMINDER_MINUTES);
  assert.equal(nextInterval(T0, MAX_REMINDER_MINUTES, T0), T0 + 86400000);
});

test('一次性提醒使用本地任务日期且只响一次', () => {
  const r = makeOnce('开会', '2026-10-12', '15:30', '开会提醒', new Date(T0));
  const expected = new Date(2026, 9, 12, 15, 30).getTime();
  assert.equal(r.kind, 'once');
  assert.equal(r.nextAt, expected);
  assert.equal(r.text, '开会提醒');
  assert.equal(scanDue([r], expected - 1).length, 0);
  assert.equal(scanDue([r], expected).length, 1);
  const a = advance(r, expected);
  assert.equal(a.enabled, false);
  assert.equal(a.completed, true);
  assert.equal(scanDue([a], expected + 86400000).length, 0);
});

test('一次性提醒拒绝过期、无效日期或时刻', () => {
  assert.throws(() => makeOnce('开会', '2026-10-12', '09:00', '', new Date(T0)), RangeError);
  assert.throws(() => makeOnce('开会', '2026-02-30', '15:30', '', new Date(T0 - 86400000)), RangeError);
  assert.throws(() => makeOnce('开会', '2026-10-12', '25:00', '', new Date(T0)), RangeError);
  assert.throws(() => timeToDate('24:00', new Date(T0)), RangeError);
});

test('暂停/继续不早响、不无限延长且不恢复已完成的提醒', () => {
  const r = makeInterval('water', 30);
  const half = r.startAt + 15 * 60000;
  const paused = pauseReminder(r, half);
  assert.equal(paused.enabled, false);
  assert.equal(paused.remainingMs, 15 * 60000);
  assert.equal(scanDue([paused], paused.nextAt + 1).length, 0);
  assert.equal(progress(paused, half + 86400000), progress(r, half));
  const resumedAt = half + 7200000;
  const resumed = resumeReminder(paused, resumedAt);
  assert.equal(resumed.nextAt, resumedAt + 15 * 60000);
  assert.equal(scanDue([resumed], resumed.nextAt - 1).length, 0);
  assert.equal(scanDue([resumed], resumed.nextAt).length, 1);

  const timer = makeTimer('pomo', 25);
  const stopped = pauseReminder(timer, timer.startAt + 10 * 60000);
  const continued = resumeReminder(stopped, timer.startAt + 3600000);
  assert.equal(continued.endAt - (timer.startAt + 3600000), 15 * 60000);
  assert.throws(() => pauseReminder(timer, timer.endAt), RangeError);
  assert.throws(() => resumeReminder({ ...timer, enabled: false }, Date.now()), RangeError);
});

test('暂停的一次性提醒过期后不能重新启用', () => {
  const r = makeOnce('开会', '2026-10-12', '15:30', undefined, new Date(T0));
  const paused = pauseReminder(r, T0 + 60000);
  assert.throws(() => resumeReminder(paused, r.nextAt + 1), RangeError);
  assert.equal(scanDue([paused], r.nextAt + 1).length, 0);
});

test('每日提醒按本地日历日期而不是固定 24 小时推进', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const start = new Date(2026, 2, 7, 12);
    const next = nextDaily('09:00', start);
    assert.equal(next.getDate(), 8);
    assert.equal(next.getHours(), 9);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
