import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseClock, parseDateWord, preview, resolveLocalShortcut, sportMinutes, guessCategory, num, cnNum, stripNumber } from '../js/command.js';

const NOW = new Date(2026, 9, 12, 10, 0); // 周一

test('date words inside task titles remain intact while separate schedule prefixes are stripped', () => {
  assert.equal(parseCommand('09:30 晨会同步今日排期', NOW).payload.text, '晨会同步今日排期');
  assert.equal(parseCommand('整理今日项目周报', NOW).payload.text, '整理今日项目周报');
  assert.equal(parseCommand('明天 14:00 评审设计稿', NOW).payload.text, '评审设计稿');
});

test('数字提取', () => {
  assert.equal(num('午饭28块'), 28);
  assert.equal(num('12.5元'), 12.5);
  assert.equal(num('没有'), 0);
});

test('中文数字提取', () => {
  assert.equal(cnNum('喝了两杯水'), 2);
  assert.equal(cnNum('三瓶'), 3);
  assert.equal(cnNum('十个'), 10);
  assert.equal(cnNum('十五个'), 15);
});

test('去掉数字留下备注', () => {
  assert.equal(stripNumber('午饭28块'), '午饭');
  assert.equal(stripNumber('打车12.5元'), '打车');
  assert.equal(stripNumber('买了三杯奶茶'), '买了奶茶');
});

test('消费分类识别', () => {
  assert.equal(guessCategory('午饭28'), '🍚 吃饭');
  assert.equal(guessCategory('打车去公司'), '🚇 交通');
  assert.equal(guessCategory('房租2000'), '🏠 居住');
  assert.equal(guessCategory('工资到账'), '💼 收入');
});

test('解析记账', () => {
  const r = parseCommand('午饭28块', NOW);
  assert.equal(r.kind, 'ledger');
  assert.equal(r.payload.type, 'expense');
  assert.equal(r.payload.amount, 28);
  assert.equal(r.payload.note, '午饭');
  assert.equal(r.payload.cat, '🍚 吃饭');
});

test('解析收入', () => {
  const r = parseCommand('工资8000到账', NOW);
  assert.equal(r.kind, 'ledger');
  assert.equal(r.payload.type, 'income');
  assert.equal(r.payload.amount, 8000);
});

test('解析提醒 / 待办', () => {
  const r = parseCommand('提醒明天交房租', NOW);
  assert.equal(r.kind, 'todo');
  assert.ok(r.payload.text.includes('房租'));
});

test('解析饮水', () => {
  const r = parseCommand('喝了300水', NOW);
  assert.equal(r.kind, 'water');
  assert.equal(r.payload.ml, 300);
});

test('解析步数', () => {
  const r = parseCommand('走了8000步', NOW);
  assert.equal(r.kind, 'steps');
  assert.equal(r.payload.steps, 8000);
});

test('解析学习（小时→分钟）', () => {
  const r = parseCommand('今天学习2小时', NOW);
  assert.equal(r.kind, 'study');
  assert.equal(r.payload.minutes, 120);
});

test('解析不出东西时返回 null', () => {
  assert.equal(parseCommand('随便说点什么', NOW), null);
  assert.equal(parseCommand('', NOW), null);
});

test('预览文案', () => {
  assert.ok(preview(parseCommand('午饭28块', NOW)).includes('28'));
  assert.ok(preview(parseCommand('喝了300水', NOW)).includes('300'));
});

test('英文与中文运动词汇解析', () => {
  assert.deepEqual(parseCommand('run 30 minutes'), { kind: 'sport', payload: { type: 'run', minutes: 30, distance: 0 } });
  assert.deepEqual(parseCommand('跑步 5km 30分钟'), { kind: 'sport', payload: { type: 'run', minutes: 30, distance: 5 } });
  assert.deepEqual(parseCommand('cycle 12 km for 45 minutes'), { kind: 'sport', payload: { type: 'bike', minutes: 45, distance: 12 } });
});

test('英文步数与学习时长', () => {
  assert.equal(parseCommand('walked 6k steps').payload.steps, 6000);
  assert.equal(parseCommand('study 1 hour').payload.minutes, 60);
});

test('英文待办与时间解析', () => {
  const r = parseCommand('remind me tomorrow at 3pm to call mom', NOW);
  assert.equal(r.kind, 'todo');
  assert.equal(r.payload.timed, true);
  assert.equal(r.payload.time, '15:00');
});

test('生活记录支持 k 步数', () => {
  assert.equal(parseCommand('walked 6k steps').payload.steps, 6000);
});

test('中文时段、汉字时刻和冒号时刻解析', () => {
  assert.equal(parseClock('下午三点半开会'), '15:30');
  assert.equal(parseClock('今晚八点开会'), '20:00');
  assert.equal(parseClock('中午12点'), '12:00');
  assert.equal(parseClock('15:30开会'), '15:30');
  assert.equal(parseClock('at 3:30 pm to call mom'), '15:30');
  assert.equal(parseClock('25:30开会'), null);
  assert.equal(parseClock('100:30开会'), null);
  assert.equal(parseClock('15:300开会'), null);
  assert.equal(parseClock('七八点开会'), null);
  assert.equal(parseCommand('提醒25:30开会', NOW), null);
  assert.equal(parseCommand('提醒100:30开会', NOW), null);
});

test('日期词、下周指定星期和日期 + 时间的待办解析', () => {
  assert.equal(parseDateWord('明天星期三开会', NOW).getDate(), 13);
  assert.equal(parseDateWord('下周二开会', NOW).getDate(), 20);
  assert.equal(parseDateWord('下周星期二开会', NOW).getDate(), 20);
  assert.equal(parseDateWord('后天开会', NOW).getDate(), 14);
  assert.deepEqual(parseCommand('提醒明天下午三点开会', NOW), {
    kind: 'todo', payload: { text: '开会', date: '2026-10-13', time: '15:00', timed: true }
  });
  assert.deepEqual(parseCommand('明天星期二 15:30 开会', NOW), {
    kind: 'todo', payload: { text: '开会', date: '2026-10-13', time: '15:30', timed: true }
  });
  assert.deepEqual(parseCommand('明天交房租', NOW), {
    kind: 'todo', payload: { text: '交房租', date: '2026-10-13', time: null, timed: false }
  });
  assert.deepEqual(parseCommand('15:30 开会', NOW), {
    kind: 'todo', payload: { text: '开会', date: '2026-10-12', time: '15:30', timed: true }
  });
  assert.deepEqual(parseCommand('提醒我喝300水', NOW), {
    kind: 'todo', payload: { text: '喝300水', date: '2026-10-12', time: null, timed: false }
  });
  assert.equal(parseCommand('今天怎么样', NOW), null);
});

test('水费和水果记账不会被饮水规则误判', () => {
  assert.deepEqual(parseCommand('水费50元', NOW), {
    kind: 'ledger', payload: { type: 'expense', amount: 50, note: '水费', cat: '🏠 居住' }
  });
  assert.deepEqual(parseCommand('水果28元', NOW), {
    kind: 'ledger', payload: { type: 'expense', amount: 28, note: '水果', cat: '🍚 吃饭' }
  });
});

test('不将任意数字静默当作支出', () => {
  for (const text of ['项目123', '第2期报告', 'abc 123', '2026-10-30']) {
    assert.equal(parseCommand(text, NOW), null, text);
  }
  // 有明确消费名词的句子即使没写「元」也应记账
  assert.equal(parseCommand('水费50', NOW)?.payload.amount, 50);
  assert.equal(parseCommand('买猫粮50', NOW)?.payload.amount, 50);
  assert.equal(parseCommand('午饭28块', NOW)?.payload.amount, 28);
  assert.equal(parseCommand('coffee 4.5', NOW)?.payload.amount, 4.5);
  assert.equal(parseCommand('coffee 14.5', NOW)?.payload.amount, 14.5);
  assert.equal(parseCommand('coffee 124.5', NOW)?.payload.amount, 124.5);
});

test('收入与支出不会被互相误判', () => {
  // 旧实现会把「卖水果收入 100」判成支出（因为先匹配到「水果」→吃饭）
  assert.equal(parseCommand('卖水果收入 100', NOW)?.payload.type, 'income');
  assert.equal(parseCommand('卖出旧手机 800', NOW)?.payload.type, 'income');
  assert.equal(parseCommand('收到红包 200', NOW)?.payload.type, 'income');
  assert.equal(parseCommand('报销下来 350', NOW)?.payload.type, 'income');
  // 含「卖」但是支出的反例
  assert.equal(parseCommand('外卖 25', NOW)?.payload.type, 'expense');
  assert.equal(parseCommand('水费 50', NOW)?.payload.type, 'expense');
  assert.equal(parseCommand('出份子 600', NOW)?.payload.type, 'expense');
});

test('生活记录不会被记账规则抢走', () => {
  assert.equal(parseCommand('走了 6000 步', NOW)?.kind, 'steps');
  assert.equal(parseCommand('喝了 300 水', NOW)?.kind, 'water');
  assert.equal(parseCommand('跑步 30 分钟', NOW)?.kind, 'sport');
  assert.equal(parseCommand('学习 2 小时', NOW)?.kind, 'study');
});

test('金额和消费语义优先，不被运动/学习词抢占', () => {
  for (const [text, amount] of [
    ['买跑步机3000元', 3000], ['学习资料50元', 50], ['买跑步机3000', 3000],
    ['健身房会员300元', 300], ['买书100元', 100], ['买了2杯奶茶28元', 28]
  ]) {
    const result = parseCommand(text, NOW);
    assert.equal(result?.kind, 'ledger', text);
    assert.equal(result.payload.amount, amount, text);
  }
});

test('饮水必须正确换算容量，杯为250ml，瓶容量不猜', () => {
  for (const [text, ml] of [
    ['喝了2杯水', 500], ['喝了两杯水', 500], ['喝了300ml水', 300],
    ['饮水0.5升', 500], ['drank 2 glasses water', 500], ['drink 0.5 liters water', 500],
    ['a glass of water', 250]
  ]) assert.deepEqual(parseCommand(text, NOW), { kind: 'water', payload: { ml } }, text);
  for (const text of ['喝了2瓶水', '喝了0杯水', '喝了-300ml水', 'water 2', '喝水2', '喝了2杯500ml水']) {
    assert.equal(parseCommand(text, NOW), null, text);
  }
});

test('复合时长按单位相加，距离不会变成时长', () => {
  assert.deepEqual(parseCommand('学习1小时30分钟', NOW), { kind: 'study', payload: { minutes: 90 } });
  assert.deepEqual(parseCommand('study 1 hour 30 minutes', NOW), { kind: 'study', payload: { minutes: 90 } });
  assert.deepEqual(parseCommand('学习一小时三十分钟', NOW), { kind: 'study', payload: { minutes: 90 } });
  assert.deepEqual(parseCommand('跑步1小时30分钟', NOW), { kind: 'sport', payload: { type: 'run', minutes: 90, distance: 0 } });
  assert.equal(parseCommand('跑步5km', NOW), null);
  assert.deepEqual(resolveLocalShortcut('跑步5km'), { kind: 'prefill', page: 'sport', payload: { type: 'run', distance: 5 } });
  assert.equal(parseCommand('run 1 mile', NOW), null);
  assert.deepEqual(resolveLocalShortcut('run 1 mile'), { kind: 'prefill', page: 'sport', payload: { type: 'run', distance: 1.609344 } });
});

test('半小时、一刻钟、一个小时及复合时长换算', () => {
  for (const [text, minutes] of [
    ['学习半小时', 30], ['学习一刻钟', 15], ['学习一个小时', 60],
    ['学习一个小时三十分钟', 90], ['学习一小时一刻钟', 75], ['学习半小时15分钟', 45]
  ]) assert.deepEqual(parseCommand(text, NOW), { kind: 'study', payload: { minutes } }, text);
  assert.deepEqual(parseCommand('骑行半小时', NOW), { kind: 'sport', payload: { type: 'bike', minutes: 30, distance: 0 } });
  assert.equal(sportMinutes('半小时'), 30);
  assert.equal(sportMinutes('一个小时15分钟'), 75);
  assert.equal(parseCommand('学习半小时半小时', NOW), null);
});

test('专注启动与已完成学习记录明确区分', () => {
  for (const text of ['开始专注45分钟', '启动专注45分钟', '专注45分钟', '开始专注半小时', '专注一个小时一刻钟', '启动番茄钟一刻钟']) {
    const minutes = text.includes('半小时') ? 30 : text.includes('一个小时') ? 75 : text.includes('番茄钟') ? 15 : 45;
    const intent = parseCommand(text, NOW);
    assert.deepEqual(intent, { kind: 'focus', payload: { minutes } }, text);
    assert.match(preview(intent), /启动专注计时/);
    assert.match(preview(intent), /确认后开始/);
    assert.match(preview(intent), /不立即计入学习记录/);
  }
  for (const text of ['专注了45分钟', '已专注45分钟', '已经专注45分钟', '记录专注45分钟']) {
    const intent = parseCommand(text, NOW);
    assert.deepEqual(intent, { kind: 'study', payload: { minutes: 45 } }, text);
    assert.match(preview(intent), /记录已完成/);
    assert.doesNotMatch(preview(intent), /启动/);
  }
  assert.deepEqual(parseCommand('开始专注180分钟', NOW), { kind: 'focus', payload: { minutes: 180 } });
  for (const text of ['开始专注181分钟', '专注0分钟', '开始专注-45分钟', '开始专注1.5分钟']) {
    assert.equal(parseCommand(text, NOW), null, text);
  }
  assert.deepEqual(parseCommand('记录专注240分钟', NOW), { kind: 'study', payload: { minutes: 240 } });
});

test('相对提醒保留分钟期限并于确认时起计时', () => {
  for (const [text, minutes, content] of [
    ['10分钟后提醒我开会', 10, '开会'], ['提醒我10分钟后开会', 10, '开会'],
    ['半小时后提醒提交周报', 30, '提交周报'], ['提醒一个小时后发邮件', 60, '发邮件'],
    ['一刻钟后提醒我喝水', 15, '喝水'], ['1小时30分钟后提醒我提交第2期报告', 90, '提交第2期报告'],
    ['1440分钟后提醒我提交周报', 1440, '提交周报']
  ]) {
    const intent = parseCommand(text, NOW);
    assert.deepEqual(intent, { kind: 'reminder', payload: { minutes, text: content } }, text);
    assert.match(preview(intent), /确认后 .* 分钟提醒/);
    assert.match(preview(intent), /确认时开始倒计时/);
    assert.equal('date' in intent.payload, false);
    assert.equal('dueAt' in intent.payload, false);
  }
  for (const text of [
    '0分钟后提醒我开会', '-10分钟后提醒我开会', '1.5分钟后提醒我开会', '1441分钟后提醒我开会',
    '10秒后提醒我开会', '一天后提醒我开会', '10分钟后提醒我', '提醒我10分钟后',
    '大约10分钟后提醒开会', '10到20分钟后提醒开会', '十几分钟后提醒开会',
    '10分钟后提醒我开会吗', '不要10分钟后提醒我开会', '10分钟后提醒我开会并提醒喝水',
    '10分钟后提醒我专注45分钟', '10分钟后提醒我开会30分钟后提醒我写周报',
    '10分钟后提醒我开会花了50元'
  ]) assert.equal(parseCommand(text, NOW), null, text);
  assert.equal(parseCommand('提醒后天开会', NOW)?.kind, 'todo', '后天仍是绝对日期待办');
});

test('仅距离的运动预填没有非法零分钟', () => {
  assert.equal(parseCommand('骑行5公里', NOW), null);
  const shortcut = resolveLocalShortcut('骑行5公里');
  assert.deepEqual(shortcut, { kind: 'prefill', page: 'sport', payload: { type: 'bike', distance: 5 } });
  assert.equal('minutes' in shortcut.payload, false);
  assert.deepEqual(parseCommand('骑行5公里半小时', NOW), { kind: 'sport', payload: { type: 'bike', minutes: 30, distance: 5 } });
});

test('快捷入口严格白名单，导航和预填均不创建记录', () => {
  for (const text of ['骑行', '骑车', '自行车', '打开骑行', '打开自行车']) {
    assert.deepEqual(resolveLocalShortcut(text), { kind: 'prefill', page: 'sport', payload: { type: 'bike' } }, text);
  }
  for (const [text, type] of [['跑步', 'run'], ['游泳', 'swim'], ['散步', 'walk'], ['举铁', 'gym'], ['瑜伽', 'yoga'], ['篮球', 'ball'], ['徒步', 'hike']]) {
    assert.deepEqual(resolveLocalShortcut(text), { kind: 'prefill', page: 'sport', payload: { type } }, text);
  }
  for (const text of ['喝水', '饮水', '打开喝水']) {
    assert.deepEqual(resolveLocalShortcut(text), { kind: 'prefill', page: 'habits', payload: { field: 'water' } });
  }
  for (const [text, page] of [['专注', 'study'], ['番茄钟', 'study'], ['提醒', 'calendar'], ['倒计时', 'calendar'], ['打开待办', 'todo'], ['打开运动', 'sport']]) {
    assert.deepEqual(resolveLocalShortcut(text), { kind: 'navigate', page, payload: {} }, text);
  }
  for (const text of ['开会', '写周报', '发邮件']) {
    assert.deepEqual(resolveLocalShortcut(text), { kind: 'prefill', page: 'todo', payload: { text } });
  }
  for (const text of [
    '骑行怎么样', '买自行车500元', '骑行5公里花了20元', '喝水吗', '不喝水',
    '打开喝水或专注', '骑行跑步', '打开<svg>', '打开未知页面', '开会写周报',
    '写周报给领导', '骑行-5公里', '骑行0公里', '骑行大约5公里', '骑行5到10公里',
    '骑行5公里30分钟', '开始专注0分钟', '', null
  ]) assert.equal(resolveLocalShortcut(text), null, String(text));
});

test('新增计时与提醒仍强拒绝模糊数、问句、否定、多意图与金额', () => {
  for (const text of [
    '开始专注大概45分钟', '开始专注十几分钟', '开始专注三四十分钟', '开始专注45分钟吗',
    '不启动专注45分钟', '取消专注45分钟', '开始专注45分钟喝了300ml水',
    '开始专注45分钟并跑步30分钟', '骑行30分钟跑步20分钟',
    '开始专注45分钟午饭20元晚饭30元', '提醒10分钟后午饭-20元', '提醒午饭20元晚饭30元'
  ]) assert.equal(parseCommand(text, NOW), null, text);
});

test('设置今日总步数的预览不暗示累加', () => {
  assert.deepEqual(parseCommand('今天步数8000', NOW), { kind: 'steps', payload: { steps: 8000 } });
  assert.match(preview(parseCommand('走了8000步', NOW)), /设置今天总步数为 8000 步/);
  assert.match(preview(parseCommand('走了8000步', NOW)), /替换，不累加/);
});

test('模糊、否定、问句、无单位、多意图数字不生成记录', () => {
  for (const text of [
    '跑步3000', '学习50', 'study 2', '健身器材2件', '买跑步机',
    '今天喝了多少水', '喝了2杯水吗', '今天没有学习30分钟', '不是走了8000步',
    '准备学习30分钟', '大约走了8000步', '喝了200到300ml水', '学习20~30分钟',
    '走了8,000步', '走了-8000步', '走了0步', '走了1.5步',
    '学习0小时', '学习25小时', '学习30分钟20分钟', '学习2章节30分钟',
    '喝了300ml水学习30分钟', '走了8000步喝了300ml水',
    '午饭20元晚饭30元', '午饭20晚饭30', '午饭-28元', '水费NaN元', '午饭Infinity元'
  ]) assert.equal(parseCommand(text, NOW), null, text);
});
