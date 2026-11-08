import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPolarity, detectCategory, extractAmount, chineseNumber,
  parseLedgerPhrase, buildNote, CATEGORIES, LEDGER_CATEGORIES
} from '../js/ledger-keywords.js';

/* ============================================================
 * 收支极性：赚 / 卖 / 收 / 出 四个核心字
 * ============================================================ */

test('「赚」明确判为收入', () => {
  for (const s of ['赚了 500', '今天赚到 300', '净赚 1200', '挣了 200']) {
    assert.equal(detectPolarity(s).polarity, 'income', s);
  }
});

test('「卖」判为收入，但「外卖」是支出', () => {
  assert.equal(detectPolarity('卖出旧手机 800').polarity, 'income');
  assert.equal(detectPolarity('卖掉闲置 300').polarity, 'income');
  assert.equal(detectPolarity('转卖 200').polarity, 'income');
  // 关键反例：「外卖」含「卖」但一定是支出
  assert.equal(detectPolarity('外卖 25').polarity, 'expense');
  assert.equal(detectPolarity('美团外卖 32').polarity, 'expense');
});

test('「收」要后接款项名词才算收入，收快递不算', () => {
  assert.equal(detectPolarity('收到红包 200').polarity, 'income');
  assert.equal(detectPolarity('收租 3500').polarity, 'income');
  assert.equal(detectPolarity('报销下来 350').polarity, 'income');
  // 反例：收快递 / 收衣服 / 收货 不是收款
  assert.notEqual(detectPolarity('收快递 12').polarity, 'income');
  assert.notEqual(detectPolarity('收衣服 50').polarity, 'income');
});

test('「出」不单独作为判定信号', () => {
  // 「出份子」是支出短语；裸「出」不应把句子判成收入
  assert.equal(detectPolarity('出份子 600').polarity, 'expense');
  assert.equal(detectPolarity('支出 100').polarity, 'expense');
  // 「出差」只是场景标签，不该被当成收入
  assert.notEqual(detectPolarity('出差住宿 800').polarity, 'income');
});

test('支出动词：花 / 付 / 买 / 交 / 充', () => {
  for (const s of ['花了 50 买奶茶', '付了房租 3000', '买了双鞋 599', '交话费 100', '充值 200']) {
    assert.equal(detectPolarity(s).polarity, 'expense', s);
  }
});

test('收入名词与支出名词都能独立判定', () => {
  assert.equal(detectPolarity('工资 15000').polarity, 'income');
  assert.equal(detectPolarity('年终奖 30000').polarity, 'income');
  assert.equal(detectPolarity('稿费 2000').polarity, 'income');
  assert.equal(detectPolarity('房租 3000').polarity, 'expense');
  assert.equal(detectPolarity('水费 50').polarity, 'expense');
});

test('收支双信号冲突时以更靠后的动词为准', () => {
  // 先"花"后"卖回" → 结论在最后，判收入
  assert.equal(detectPolarity('花了 100 然后卖出 200').polarity, 'income');
});

/* ============================================================
 * 分类：长词优先 + 强特征覆盖
 * ============================================================ */

test('水费/水果/奶茶 不会被当成喝水', () => {
  assert.equal(detectCategory('水费 50', 'expense').cat, 'housing');
  assert.equal(detectCategory('水果 28', 'expense').cat, 'food');
  assert.equal(detectCategory('奶茶 18', 'expense').cat, 'drink');
  assert.equal(detectCategory('咖啡 25', 'expense').cat, 'drink');
});

test('宠物场景优先于「粮」「药」「疫苗」等通用词', () => {
  assert.equal(detectCategory('猫粮 120', 'expense').cat, 'pet');
  assert.equal(detectCategory('狗粮 200', 'expense').cat, 'pet');
  assert.equal(detectCategory('猫砂 60', 'expense').cat, 'pet');
  assert.equal(detectCategory('宠物疫苗 300', 'expense').cat, 'pet');
  assert.equal(detectCategory('驱虫 80', 'expense').cat, 'pet');
});

test('健身补剂归运动，不归吃饭', () => {
  assert.equal(detectCategory('蛋白粉 300', 'expense').cat, 'sport');
  assert.equal(detectCategory('健身房年卡 2000', 'expense').cat, 'sport');
  assert.equal(detectCategory('私教课 500', 'expense').cat, 'sport');
});

test('器材归购物，数码归数码，两者都不归运动记录', () => {
  // 「跑步机」是买东西，不是运动记录；归购物更符合直觉。
  assert.equal(detectCategory('跑步机 3000', 'expense').cat, 'shopping');
  assert.equal(detectCategory('手机壳 39', 'expense').cat, 'digital');
  assert.equal(detectCategory('蓝牙耳机 499', 'expense').cat, 'digital');
  assert.equal(detectCategory('华为手机 4999', 'expense').cat, 'digital');
});

test('订阅服务单独成类', () => {
  assert.equal(detectCategory('视频会员 25', 'expense').cat, 'subscription');
  assert.equal(detectCategory('云盘续费 68', 'expense').cat, 'subscription');
});

test('小众场景也能分类：白事 / 香火钱 / 氪金 / 打赏 / 虚拟货币', () => {
  assert.equal(detectCategory('白事 500', 'expense').cat, 'social');
  assert.equal(detectCategory('香火钱 100', 'expense').cat, 'social');
  assert.equal(detectCategory('份子钱 600', 'expense').cat, 'social');
  assert.equal(detectCategory('氪金 648', 'expense').cat, 'fun');
  assert.equal(detectCategory('打赏主播 50', 'expense').cat, 'fun');
  assert.equal(detectCategory('买币 1000', 'expense').cat, 'fixed');
});

test('交通与生活服务分类', () => {
  assert.equal(detectCategory('加油 300', 'expense').cat, 'transport');
  assert.equal(detectCategory('停车费 15', 'expense').cat, 'transport');
  assert.equal(detectCategory('打车 35', 'expense').cat, 'transport');
  assert.equal(detectCategory('理发 45', 'expense').cat, 'care');
  assert.equal(detectCategory('打印 2', 'expense').cat, 'care');
});

test('收入侧细分：工资 / 变卖 / 报销 / 人情 / 投资 / 兼职', () => {
  assert.equal(detectCategory('工资到账 15000', 'income').cat, 'income');
  assert.equal(detectCategory('卖出旧手机 800', 'income').cat, 'income');
  assert.equal(detectCategory('报销下来 350', 'income').cat, 'income');
  assert.equal(detectCategory('收到红包 200', 'income').cat, 'social');
  assert.equal(detectCategory('利息到账 12.5', 'income').cat, 'income');
  assert.equal(detectCategory('接了个私活 3000', 'income').cat, 'income');
});

/* ============================================================
 * 金额抽取
 * ============================================================ */

test('金额抽取：货币单位优先', () => {
  assert.equal(extractAmount('午饭 28 元').amount, 28);
  assert.equal(extractAmount('¥50').amount, 50);
  assert.equal(extractAmount('剪头发 45 块').amount, 45);
  assert.equal(extractAmount('coffee 4.5').amount, 4.5);
});

test('金额抽取：万 / k 单位', () => {
  assert.equal(extractAmount('工资 1.5万').amount, 15000);
  assert.equal(extractAmount('收入 2w').amount, 20000);
  assert.equal(extractAmount('赚了 3k').amount, 3000);
});

test('金额抽取：剔除型号/数量/时间等假数字', () => {
  // iPhone15 的 15 不能当金额；真金额是 6999
  assert.equal(extractAmount('买了 iPhone15 6999 元').amount, 6999);
  // 有货币单位时优先货币单位，不受公里数干扰
  assert.equal(extractAmount('跑步 5 公里 花了 20 元').amount, 20);
  // 时间不能当金额
  assert.equal(extractAmount('15:30 交周报').amount, null);
  // 数量单位不能当金额
  assert.equal(extractAmount('买了 3 个').amount, null);
});

test('生活记录不会被当成记账（步数/饮水/运动/学习）', () => {
  // 「走了 6000 步」是步数记录，不是 6000 元支出
  assert.equal(parseLedgerPhrase('走了 6000 步'), null);
  assert.equal(parseLedgerPhrase('walked 6k steps'), null);
  assert.equal(parseLedgerPhrase('喝了 300ml 水'), null);
  assert.equal(parseLedgerPhrase('跑步 30 分钟'), null);
  assert.equal(parseLedgerPhrase('学习 2 小时'), null);
  // 但真的花了钱仍然要记账
  assert.ok(parseLedgerPhrase('跑步机 3000 元'));
  assert.ok(parseLedgerPhrase('买水 5 元'));
});

test('中文数字金额', () => {
  assert.equal(chineseNumber('三百'), 300);
  assert.equal(chineseNumber('五十'), 50);
  assert.equal(chineseNumber('十五'), 15);
  assert.equal(chineseNumber('一百五'), 150);
  assert.equal(chineseNumber('两千'), 2000);
  assert.equal(extractAmount('水费 五十 元').amount, 50);
});

test('中文金额省略尾数、零与万位', () => {
  assert.equal(chineseNumber('一千五'), 1500);
  assert.equal(chineseNumber('两千五'), 2500);
  assert.equal(chineseNumber('一万五'), 15000);
  assert.equal(chineseNumber('一百零五'), 105);
  assert.equal(chineseNumber('三百零二'), 302);
  assert.equal(chineseNumber('一千零五十'), 1050);
  assert.equal(chineseNumber('一万零五百'), 10500);
  assert.equal(chineseNumber('十二万'), 120000);
  assert.equal(extractAmount('买菜一千五块').amount, 1500);
  assert.equal(extractAmount('房租一万五块').amount, 15000);
  assert.equal(extractAmount('一百零五块').amount, 105);
});

test('没有金额时返回 null', () => {
  assert.equal(extractAmount('今天天气不错').amount, null);
  assert.equal(parseLedgerPhrase('今天天气不错'), null);
});

/* ============================================================
 * 端到端：一句话 → 账目
 * ============================================================ */

test('端到端：日常生活场景', () => {
  const cases = [
    ['午饭 28 元', 'expense', 28, 'food'],
    ['水费 50 元', 'expense', 50, 'housing'],
    ['水果 28 元', 'expense', 28, 'food'],
    ['剪头发 45', 'expense', 45, 'care'],
    ['打车 35', 'expense', 35, 'transport'],
    ['猫粮 120', 'expense', 120, 'pet'],
    ['奶茶 18', 'expense', 18, 'drink'],
    ['房租 3000', 'expense', 3000, 'housing'],
    ['电影票 45', 'expense', 45, 'fun']
  ];
  for (const [text, type, amount, catId] of cases) {
    const r = parseLedgerPhrase(text);
    assert.ok(r, `应能解析: ${text}`);
    assert.equal(r.type, type, `${text} 类型`);
    assert.equal(r.amount, amount, `${text} 金额`);
    assert.equal(r.catId, catId, `${text} 分类`);
  }
});

test('端到端：收入场景（赚 / 卖 / 收）', () => {
  const cases = [
    ['卖出旧手机 800', 'income', 800],
    ['收到红包 200', 'income', 200],
    ['报销下来 350', 'income', 350],
    ['工资到账 15000', 'income', 15000],
    ['赚了 500', 'income', 500],
    ['退押金 500', 'income', 500]
  ];
  for (const [text, type, amount] of cases) {
    const r = parseLedgerPhrase(text);
    assert.ok(r, `应能解析: ${text}`);
    assert.equal(r.type, type, `${text} 类型`);
    assert.equal(r.amount, amount, `${text} 金额`);
  }
});

test('端到端：不会把支出误判成收入', () => {
  for (const text of ['外卖 25', '水费 50', '交房租 3000', '出份子 600', '罚款 200']) {
    const r = parseLedgerPhrase(text);
    assert.ok(r, `应能解析: ${text}`);
    assert.equal(r.type, 'expense', `${text} 不应判为收入`);
  }
});

test('端到端：不会把收入误判成支出', () => {
  for (const text of ['卖水果收入 100', '卖出去 200', '收到转账 500']) {
    const r = parseLedgerPhrase(text);
    assert.ok(r, `应能解析: ${text}`);
    assert.equal(r.type, 'income', `${text} 不应判为支出`);
  }
});

test('低置信度时给出候选而不是硬猜', () => {
  // 「杂项 88」有分类词但分类本身很泛，置信度应偏低并给出候选。
  const r = parseLedgerPhrase('其他 88 元');
  assert.ok(r, '应能解析出金额');
  assert.ok(r.confidence < 0.8, `置信度应偏低，实际 ${r.confidence}`);
  // 明确的句子不该触发澄清
  const clear = parseLedgerPhrase('午饭 28 元');
  assert.equal(clear.needClarify, undefined);
});

test('备注会去掉金额与动词，保留可读内容', () => {
  assert.equal(parseLedgerPhrase('午饭 28 元').note, '午饭');
  assert.equal(parseLedgerPhrase('花了 50 买奶茶').note.includes('奶茶'), true);
  assert.equal(buildNote('买咖啡 4.5', 4.5), '买咖啡');
  assert.equal(buildNote('28', 28), '记一笔');
});

test('所有分类标签都是唯一且非空的', () => {
  const labels = CATEGORIES;
  assert.equal(new Set(labels).size, labels.length, '分类标签不应重复');
  assert.ok(labels.every(l => typeof l === 'string' && l.trim().length > 0));
  assert.ok(labels.every(l => l === LEDGER_CATEGORIES[Object.keys(LEDGER_CATEGORIES)
    .find(k => LEDGER_CATEGORIES[k].label === l)].label), '标签应能反查回定义');
});

test('每个分类都有对应的图标', () => {
  for (const [id, def] of Object.entries(LEDGER_CATEGORIES)) {
    assert.ok(def.icon && typeof def.icon === 'string', `${id} 缺少图标`);
    assert.ok(def.label && typeof def.label === 'string', `${id} 缺少标签`);
  }
});

test('金额为 0 或负数不产生账目', () => {
  assert.equal(parseLedgerPhrase('花了 0 元'), null);
  assert.equal(parseLedgerPhrase(''), null);
  assert.equal(parseLedgerPhrase('   '), null);
  assert.equal(parseLedgerPhrase(null), null);
});
