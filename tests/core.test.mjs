import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, workedMinutes, hourlyRate, earnedToday,
  countdownToOff, offCountdown, daysToWeekend, daysToPayday, monthSummary,
  parseLedgerText, petLevel, petTitle, todayKey, displayNameOf, avatarOf
} from '../js/core.js';

const S = { ...DEFAULT_SETTINGS, salary: 8000, workHours: 8, onTime: '09:00', offTime: '18:00', payDay: 15 };

test('时薪 = 月薪 / 22 天 / 8 小时', () => {
  assert.equal(hourlyRate(S), 8000 / 22 / 8);
});

test('上班前不算工时', () => {
  const now = new Date(2026, 9, 12, 8, 0);
  assert.equal(workedMinutes(S, now), 0);
});

test('工时正常累计', () => {
  const now = new Date(2026, 9, 12, 12, 0);
  assert.equal(workedMinutes(S, now), 180);
});

test('下班后按满工时算', () => {
  const now = new Date(2026, 9, 12, 22, 0);
  assert.equal(workedMinutes(S, now), 540);
});

test('周末不赚钱', () => {
  const sat = new Date(2026, 9, 10, 15, 0); // 2026-10-10 是周六
  assert.equal(sat.getDay(), 6);
  assert.equal(earnedToday(S, sat), 0);
});

test('工作日按时薪计钱', () => {
  const mon = new Date(2026, 9, 12, 10, 0); // 周一 10:00，已工作 60 分钟
  assert.equal(mon.getDay(), 1);
  assert.ok(Math.abs(earnedToday(S, mon) - hourlyRate(S)) < 1e-9);
});

test('在岗 9 小时、计薪 8 小时时日收入不超过日薪', () => {
  const off = new Date(2026, 9, 12, 18, 0);
  const late = new Date(2026, 9, 12, 23, 0);
  assert.equal(workedMinutes(S, off), 540); // 显示在岗时长保留 09–18
  assert.equal(earnedToday(S, off), 8000 / 22);
  assert.equal(earnedToday(S, late), 8000 / 22);
});

test('下班倒计时文案：任何时长都要能看到秒在走', () => {
  const now = new Date(2026, 9, 12, 17, 0, 0);
  // 超过 1 小时也必须带秒，否则盯着看会以为卡住了（用户实测反馈）。
  assert.equal(countdownToOff(S, now), '1小时0分00秒');
  assert.equal(countdownToOff(S, new Date(2026, 9, 12, 17, 0, 1)), '59分59秒');
  assert.equal(countdownToOff(S, new Date(2026, 9, 12, 17, 59, 30)), '0分30秒');
  const late = new Date(2026, 9, 12, 20, 0);
  assert.equal(countdownToOff(S, late), '已下班');
});

test('下班倒计时结构化数值可供大号数字展示', () => {
  const r = offCountdown(S, new Date(2026, 9, 12, 17, 30, 45));
  assert.deepEqual(
    { done: r.done, hours: r.hours, minutes: r.minutes, seconds: r.seconds },
    { done: false, hours: 0, minutes: 29, seconds: 15 });
  const done = offCountdown(S, new Date(2026, 9, 12, 19, 0, 0));
  assert.equal(done.done, true);
  assert.equal(done.totalSeconds, 0);
});

test('距离周末', () => {
  assert.equal(daysToWeekend(S, new Date(2026, 9, 10)), 0); // 周六
  assert.equal(daysToWeekend(S, new Date(2026, 9, 9)), 1);  // 周五
});

test('距离发薪日（含跨月）', () => {
  assert.equal(daysToPayday(S, new Date(2026, 9, 15)), 0);
  assert.equal(daysToPayday(S, new Date(2026, 9, 12)), 3);
  assert.equal(daysToPayday(S, new Date(2026, 9, 20)), 26); // 到 11-15
});

test('月底发薪日按短月最后一天计算，并忽略当天时分', () => {
  const lastDay = { ...S, payDay: 31 };
  assert.equal(daysToPayday(lastDay, new Date(2026, 1, 27, 23, 59)), 1);
  assert.equal(daysToPayday(lastDay, new Date(2026, 1, 28, 23, 59)), 0);
  assert.equal(daysToPayday(lastDay, new Date(2026, 2, 1, 12)), 30);
  assert.equal(daysToPayday(lastDay, new Date(2028, 1, 28)), 1); // 闰年
  assert.equal(daysToPayday(lastDay, new Date(2028, 1, 29, 17)), 0);
});

test('月度收支汇总', () => {
  const rows = [
    { date: '2026-10-01', type: 'expense', amount: 28 },
    { date: '2026-10-02', type: 'income', amount: 100 },
    { date: '2026-09-30', type: 'expense', amount: 999 }
  ];
  const s = monthSummary(rows, new Date(2026, 9, 5));
  assert.equal(s.expense, 28);
  assert.equal(s.income, 100);
  assert.equal(s.balance, 72);
});

test('自然语言记账解析', () => {
  assert.deepEqual(parseLedgerText('午饭28块'), { amount: 28, note: '午饭' });
  assert.deepEqual(parseLedgerText('打车12.5元'), { amount: 12.5, note: '打车' });
  assert.equal(parseLedgerText('没有数字'), null);
});

test('宠物等级与称号', () => {
  assert.equal(petLevel(0), 1);
  assert.equal(petLevel(120), 3);
  assert.equal(petTitle(1), '青柠见习生');
});

test('今天日期键格式', () => {
  assert.match(todayKey(new Date(2026, 9, 5)), /^2026-10-05$/);
});

test('personalization defaults use the real name and retain image-first object rendering', () => {
  assert.equal(displayNameOf(DEFAULT_SETTINGS), '你');
  assert.equal(displayNameOf({ displayName: '  小林  ' }), '小林');
  assert.deepEqual(avatarOf(DEFAULT_SETTINGS), { kind: 'text', value: '我' });
  assert.deepEqual(avatarOf(), { kind: 'text', value: '我' });
  assert.deepEqual(avatarOf({ displayName: '青柠', avatar: '' }), { kind: 'text', value: '青' });
  const image = 'data:image/png;base64,YQ==';
  assert.deepEqual(avatarOf({ avatarImage: image, avatar: '👩‍💻', displayName: '青柠' }),
    { kind: 'image', value: image });
});

test('avatarOf returns the first complete grapheme rather than two code points or partial ZWJ emoji', () => {
  for (const value of ['👩‍💻', '👨‍👩‍👧‍👦', '🏳️‍🌈', '👍🏽', '🇨🇳', '1️⃣', 'é']) {
    assert.deepEqual(avatarOf({ avatar: `${value}次` }), { kind: 'text', value }, value);
    assert.deepEqual(avatarOf({ displayName: `${value}名字` }), { kind: 'text', value }, value);
  }
  assert.deepEqual(avatarOf({ avatar: 'AB' }), { kind: 'text', value: 'A' });
});

test('avatarOf fallback keeps joined emoji, modifiers, flags and combining marks intact without Segmenter', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
  try {
    Object.defineProperty(Intl, 'Segmenter', { ...descriptor, value: undefined });
    for (const value of ['👩‍💻', '👨‍👩‍👧‍👦', '🏳️‍🌈', '👍🏽', '🇨🇳', '1️⃣', 'é']) {
      assert.deepEqual(avatarOf({ avatar: `${value}次` }), { kind: 'text', value }, value);
      assert.deepEqual(avatarOf({ displayName: `${value}名字` }), { kind: 'text', value }, value);
    }
    assert.deepEqual(avatarOf({ avatar: 'AB' }), { kind: 'text', value: 'A' });
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    else delete Intl.Segmenter;
  }
});
