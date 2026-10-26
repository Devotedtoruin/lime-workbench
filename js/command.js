// command.js — 自然语言指令解析
// 目标：在输入框里"说一句人话"，系统自动决定要做什么。
// 例：
//   午饭28块                → 记一笔支出 28 元，备注「午饭」
//   收入 工资8000           → 记一笔收入
//   提醒 15点 开会          → 添加待办「开会」
//   喝了300水               → 饮水 +300ml
//   走了8000步              → 设置今天总步数 8000（不是追加）
//   今天学习2小时           → 学习计时 +120 分钟
//   明天 缴房租             → 待办（明天）
//
// 解析失败会返回 null，由 UI 走"普通记一笔"兜底。

import { parseLedgerPhrase } from './ledger-keywords.js';

const NUMBER_RE = /-?\d+(?:\.\d+)?/;

function scaleNumber(value, text) {
  const lower = String(text).toLowerCase();
  if (/\d+(?:\.\d+)?\s*k\b/.test(lower)) return value * 1000;
  return value;
}

export function num(text) {
  const m = text.match(NUMBER_RE);
  return m ? scaleNumber(Math.abs(parseFloat(m[0])), text) : 0;
}

/** 把中文数字（一~九十九）转成阿拉伯数字，足够日常使用 */
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnNum(text) {
  const m = text.match(/([零一二两三四五六七八九十]+)\s*(?:个|瓶|杯|次)?/);
  if (!m) return 0;
  const s = m[1];
  if (!/^(?:[零一二两三四五六七八九]|[一二两三四五六七八九]?十[一二三四五六七八九]?)$/.test(s)) return 0;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (a ? CN_DIGIT[a] : 1) * 10 + (b ? CN_DIGIT[b] : 0);
  }
  return CN_DIGIT[s] ?? 0;
}

/** 去掉数字和单位，留下"人话"的备注 */
export function stripNumber(text) {
  return text
    .replace(NUMBER_RE, ' ')
    .replace(/[零一二两三四五六七八九十]+(?=[个瓶杯次])/, ' ')
    .replace(/(块钱|毫升|分钟|小时|元|块|米|ml|步|个|瓶|杯|次)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/([一-鿿])\s+([一-鿿])/g, '$1$2')
    .trim();
}

/**
 * 消费分类：覆盖生活场景，用关键词猜。
 * 目标是「说人话就不用选分类」，所以场景越全越好。
 */
export function guessCategory(text) {
  const t = String(text).toLowerCase();
  const rules = [
    [/剪发|理发|烫发|染发|洗剪吹|剪头|美甲|美容|护肤|按摩|spa|美发/, '💇 个人护理'],
    [/早|午|晚|饭|餐|吃|外卖|奶茶|咖啡|零食|水果|火锅|烧烤|寿司|披萨|汉堡|面|粉|粥|便当|下午茶/, '🍚 吃饭'],
    [/打车|地铁|公交|高铁|机票|火车|加油|停车|滴滴|通勤|过路费|骑车|共享单车/, '🚇 交通'],
    [/房租|水电|水费|电费|物业|网费|宽带|燃气|暖气|家政|维修|装修|家具/, '🏠 居住'],
    [/衣|鞋|帽|包|淘宝|京东|拼多多|购物|数码|电子|家电|手机|电脑/, '🛍 购物'],
    [/电影|游戏|唱|旅游|门票|酒店|健身|会员|娱乐|酒吧|剧本杀|展览|演出/, '🎮 娱乐'],
    [/工资|奖金|兼职|报销|红包|退款|转账|稿费|利息|分红/, '💼 收入'],
    [/药|医|体检|挂号|牙|眼科|疫苗|住院|门诊|保健/, '🏥 医疗'],
    [/书|课|培训|学费|考试|教材|文具|补习|网课/, '📚 学习'],
    [/礼|礼物|份子|随礼|生日|结婚|红包|送/, '🎁 社交'],
    [/快递|运费|跑腿|代购|物流/, '📦 杂项'],
    [/养|猫|狗|宠物|粮|猫砂/, '🐾 宠物'],
    [/保险|社保|公积金|税|还款|贷款|分期|花呗|信用卡/, '💳 固定支出'],
    [/水|电|燃气|话费|流量|充值|宽带/, '🔌 日用']
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return '🎁 其他';
}

/** 记账分类（含图标）——UI 渲染用 */
export const CATEGORIES = [
  '🍚 吃饭', '🚇 交通', '🏠 居住', '🛍 购物', '🎮 娱乐', '💼 收入',
  '🏥 医疗', '📚 学习', '🎁 社交', '💇 个人护理', '🐾 宠物', '💳 固定支出', '🔌 日用', '📦 杂项', '🎁 其他'
];

const CATEGORY_ICONS = {
  '🍚 吃饭': 'coffee', '🚇 交通': 'bike', '🏠 居住': 'house', '🛍 购物': 'wallet',
  '🎮 娱乐': 'goal', '💼 收入': 'wallet-cards', '🏥 医疗': 'circle-alert',
  '📚 学习': 'book-open', '🎁 社交': 'sparkles', '💇 个人护理': 'person-standing',
  '🐾 宠物': 'leaf', '💳 固定支出': 'calendar-clock', '🔌 日用': 'zap',
  '📦 杂项': 'inbox', '🎁 其他': 'tags'
};

export function categoryIcon(category) {
  return CATEGORY_ICONS[category] || 'tags';
}

const WEEK = { 周日: 0, 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 星期日: 0, 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6 };

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDateWord(text, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const s = String(text || '');
  if (/大后天/.test(s)) { d.setDate(d.getDate() + 3); return d; }
  if (/后天|\bday after tomorrow\b/i.test(s)) { d.setDate(d.getDate() + 2); return d; }
  if (/明天|明晚|明日|\btomorrow\b/i.test(s)) { d.setDate(d.getDate() + 1); return d; }
  if (/今天|今晚|今日|\btoday\b|\btonight\b/i.test(s)) return d;
  const wk = s.match(/(下周(?:星期|周)?|周|星期)([一二三四五六日天])/);
  if (wk) {
    const target = WEEK[(wk[1].startsWith('下周') ? '周' : wk[1]) + (wk[2] === '天' ? '日' : wk[2])];
    const offset = (target - d.getDay() + 7) % 7;
    const nextWeek = 7 - ((d.getDay() + 6) % 7) + ((target + 6) % 7);
    d.setDate(d.getDate() + (wk[1].startsWith('下周') ? nextWeek : offset || 7));
    return d;
  }
  if (/下周/.test(s)) { d.setDate(d.getDate() + 7); return d; }
  return d;
}

const CLOCK_RE = /(?<![\dA-Za-z.零一二两三四五六七八九十百千])(?<period>凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚)?\s*(?<hour>\d{1,2}|[零一二两三四五六七八九十]{1,3})(?:(?:[:：](?<colonMinute>\d{2}))|(?:点|时)(?<chineseMinute>半|[零一二两三四五六七八九十]{1,3}|\d{1,2})?分?|(?<onlyMeridiem>am|pm)\b)\s*(?<meridiem>am|pm)?(?!\d)/i;

/** 识别中文/英文时刻：下午三点、15:30、3pm、at 3:30 pm */
export function parseClock(text) {
  const m = CLOCK_RE.exec(String(text || ''));
  if (!m) return null;
  const { period, hour: rawHour, colonMinute, chineseMinute, onlyMeridiem, meridiem } = m.groups;
  let hour = /^\d+$/.test(rawHour) ? Number(rawHour) : cnNum(rawHour);
  let minute = colonMinute ? Number(colonMinute) : chineseMinute === '半' ? 30
    : chineseMinute ? (/^\d+$/.test(chineseMinute) ? Number(chineseMinute) : cnNum(chineseMinute)) : 0;
  if (!/^\d+$/.test(rawHour) && !hour && rawHour !== '零' ||
    chineseMinute && chineseMinute !== '半' && !/^\d+$/.test(chineseMinute) && !minute && chineseMinute !== '零') return null;
  const part = (meridiem || onlyMeridiem || '').toLowerCase();
  if (part && (hour < 1 || hour > 12)) return null;
  if (part === 'pm' && hour < 12) hour += 12;
  if (part === 'am' && hour === 12) hour = 0;
  if (!part && /下午|傍晚|晚上|今晚/.test(period || '') && hour < 12) hour += 12;
  // 晚上/今晚十二点 is midnight at the end of the day, not noon.
  if (!part && /晚上|今晚|夜里|明晚/.test(period || '') && hour === 12) hour = 0;
  if (!part && /凌晨|清晨|早上|上午/.test(period || '') && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const DATE_WORD_RE = /大后天|后天|明天|明晚|明日|今天|今晚|今日|下周(?:星期|周)?[一二三四五六日天]?|(?:周|星期)[一二三四五六日天]|\bday after tomorrow\b|\b(?:today|tomorrow|tonight)\b/gi;
const TODO_RE = /提醒|待办|记得|别忘|安排|计划|^\s*约(?!\d)|\b(?:remind|todo|task|remember|schedule)\b/i;
const CURRENCY_RE = /(?:[¥￥]\s*(-?\d+(?:\.\d+)?))|(-?\d+(?:\.\d+)?)\s*(?:元|块钱?|rmb\b)/i;

function ledgerAmount(text) {
  const currency = CURRENCY_RE.exec(text);
  return currency ? Math.abs(Number(currency[1] || currency[2])) : num(text) || cnNum(text);
}

function todoContent(text) {
  return text
    .replace(/^\s*(?:提醒|待办|记得|别忘|安排|计划|约|remind(?:\s+me)?|todo|task|remember|schedule)\s*/i, '')
    .replace(/^\s*(?:我|me|please)\s*/i, '')
    .replace(CLOCK_RE, ' ')
    .replace(/(?<![一-鿿])(?:大后天|后天|明天|明晚|明日|今天|今晚|今日|下周(?:星期|周)?[一二三四五六日天]?|(?:周|星期)[一二三四五六日天])|\bday after tomorrow\b|\b(?:today|tomorrow|tonight)\b/gi, ' ')
    .replace(/(?<![一-鿿])(?:周|星期)[一二三四五六日天]/g, ' ')
    .replace(/\b(?:at|on|for|to)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 消费/收入类关键词 */
const SPEND_RE = /花|付|买|吃|打车|消费|支出|报销|饭|餐|购|充值|缴|交|租|花销|剪发|理发|看电影|\b(?:coffee|lunch|dinner|breakfast|taxi)\b/i;
const EARN_RE = /赚|收|工资|奖金|兼职工资|红包|退款|报销下来|进账|到账|salary|income|paid|paycheck/i;

/** 中英运动词汇 → 统一类型 */
export const SPORT_ALIASES = {
  run: /跑步|慢跑|running|run|jogging|jog/i,
  walk: /走路|散步|步行|walking|walk/i,
  bike: /骑行|骑车|自行车|cycling|bike|bicycle|cycle/i,
  swim: /游泳|swimming|swim/i,
  gym: /力量|举铁|健身|strength|gym|workout|weights/i,
  yoga: /瑜伽|拉伸|yoga|stretch/i,
  ball: /球类|乒乓|篮球|足球|tennis|badminton|pingpong|basketball|football/i,
  hike: /徒步|爬山|登山|hiking|hike|trek/i
};
export function sportType(text) {
  return Object.entries(SPORT_ALIASES).find(([, re]) => re.test(String(text)))?.[0] || null;
}
const QUANTITY = '(?:\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十]+)';
const DURATION_RE = new RegExp(`(${QUANTITY}|半)\\s*(?:个\\s*)?(小时|刻钟|hours?\\b|hrs?\\b|分钟|minutes?\\b|mins?\\b|分(?!钟))`, 'gi');
const WATER_RE = new RegExp(`(${QUANTITY})\\s*(毫升|ml\\b|升|liters?\\b|litres?\\b|l\\b|杯|glasses?\\b|cups?\\b|瓶|bottles?\\b)`, 'gi');
const STEPS_RE = new RegExp(`(${QUANTITY})\\s*(k)?\\s*(?:步(?!行)|steps?\\b)`, 'gi');
const DISTANCE_RE = /(\d+(?:\.\d+)?)\s*(km\b|公里|mile(?:s)?\b|英里)/gi;

function quantity(value) {
  return /^\d/.test(value) ? Number(value) : cnNum(value);
}

function positive(value, max, integer = false) {
  return Number.isFinite(value) && value > 0 && value <= max && (!integer || Number.isSafeInteger(value));
}

/** 时长必须带单位；半小时/一刻钟/一个小时及复合时长可换算，重复单位不猜。 */
export function sportMinutes(text) {
  const matches = [...String(text).matchAll(DURATION_RE)];
  if (!matches.length || matches.length > 2) return 0;
  let minutes = 0;
  const units = new Set();
  for (const match of matches) {
    const scale = /小时|hour|hr/i.test(match[2]) ? 60 : /刻钟/.test(match[2]) ? 15 : 1;
    if (units.has(scale)) return 0;
    units.add(scale);
    const n = match[1] === '半' ? 0.5 : quantity(match[1]);
    if (!positive(n, 1440 / scale)) return 0;
    minutes += n * scale;
  }
  return positive(minutes, 1440) ? minutes : 0;
}

function unexplainedNumber(text, ...patterns) {
  const rest = patterns.reduce((s, re) => s.replace(re, ' '), text).replace(DATE_WORD_RE, ' ');
  return /\d|[零一二两三四五六七八九十百千万半]/.test(rest);
}

const QUESTION_RE = /怎么样|怎么|如何|怎样|多少|什么|几|吗|呢|能否|是否|[?？]|\b(?:how|why|what|whether)\b|^\s*(?:can|could|should|would)\b/i;
const UNCERTAIN_RE = /不(?:是|要|用|想|会)?|没|未|取消|撤销|别(?!忘)|打算|准备|可能|大概|大约|左右|差不多|至少|最多|[约~～]|\b(?:not|never|maybe|about|roughly|approximately|don't)\b/i;
const UNSAFE_NUMBER_RE = /(?:^|[^\w])[+-]\s*\d|[负負]\s*(?:\d|[零一二两三四五六七八九十])|\d[,.]\d{3}(?:\D|$)|\d\s*[-—–至到]\s*\d|\d+\s*(?:多|几)|\d(?:\.\d+)?e[+-]?\d|\b(?:NaN|Infinity)\b/i;

function blockedCommand(text, explicitTodo = false) {
  // 旧有「约明天开会」「别忘交房租」是明确待办指令，不等于模糊数量/否定。
  const candidate = explicitTodo ? text.replace(/^\s*约(?!\s*(?:\d|[零一二两三四五六七八九十半]))/, '') : text;
  return QUESTION_RE.test(candidate) || UNCERTAIN_RE.test(candidate) || UNSAFE_NUMBER_RE.test(candidate);
}

/** 相对期限只保留分钟数；UI 在确认执行时计算截止时间，不在解析时起计时。 */
function relativeReminder(text) {
  const marker = text.match(/提醒(?:我)?/g);
  if (!marker || marker.length !== 1) return null;
  const [before, after] = text.split(/提醒(?:我)?/);
  const phrase = before.trim() || after.trim();
  const duration = phrase.match(/^(.*?)\s*(?:以后|之后|后)\s*(.*)$/);
  if (!duration) return null;
  const durationText = duration[1].trim();
  const minutes = sportMinutes(durationText);
  if (!positive(minutes, 1440, true) || durationText.replace(DURATION_RE, '').trim()) return null;
  const content = (before.trim() ? `${duration[2]} ${after}` : duration[2]).trim().replace(/\s+/g, ' ');
  // 不把额外时间、金额或另一条记录悄悄吞进提醒文字。任务编号等数字仍可作备注。
  if (!content || content.length > 300 || /[<>\u0000-\u001f\u007f]/.test(content) ||
    CURRENCY_RE.test(content) || /[¥￥]|(?:和|并且|然后|同时|再)\s*(?:提醒|记录|开始|启动)/.test(content) ||
    [...content.matchAll(DURATION_RE)].length || parseClock(content) || content.search(DATE_WORD_RE) !== -1) return null;
  return { kind: 'reminder', payload: { minutes, text: content } };
}

function ledgerIntent(ledger) {
  if (!ledger || !positive(ledger.amount, 1_000_000_000)) return null;
  const payload = { type: ledger.type, amount: ledger.amount, note: ledger.note, cat: ledger.cat };
  if (ledger.needClarify) {
    Object.assign(payload, { needClarify: true, candidates: ledger.candidates, confidence: ledger.confidence });
  }
  return { kind: 'ledger', payload };
}

/** 不改记账引擎本身；只拦住不能安全选一个金额的复合/符号输入。 */
function ambiguousLedgerNumber(text) {
  const withoutQuantities = text
    .replace(/\d+(?:\.\d+)?\s*(?:个|件|杯|瓶|份|次|天|周|月|年|小时|分钟|秒|步|毫升|公里|ml\b|km\b|kg\b|g\b)/gi, ' ')
    .replace(/[A-Za-z]+\s*\d+(?!\.\d)/g, ' ');
  const currencies = [...withoutQuantities.matchAll(/(?:[¥￥]\s*\d+(?:\.\d+)?)|(?:\d+(?:\.\d+)?\s*(?:元|块钱?|圆|rmb\b))/gi)];
  if (currencies.length > 1) return true;
  const rest = withoutQuantities.replace(/(?:[¥￥]\s*\d+(?:\.\d+)?)|(?:\d+(?:\.\d+)?\s*(?:元|块钱?|圆|rmb\b))/gi, ' ');
  return currencies.length ? /\d/.test(rest) : [...rest.matchAll(/\d+(?:\.\d+)?/g)].length > 1;
}

/**
 * 「今晚 12 点」means the midnight that ends today, i.e. tomorrow's date.
 * Other date phrases keep their parsed day.
 */
function resolveTodoDate(text, now, time) {
  const parsed = parseDateWord(text, now);
  if (time === '00:00' && /晚上|今晚|夜里|明晚/.test(text)) {
    const next = new Date(parsed);
    next.setDate(next.getDate() + 1);
    return next;
  }
  return parsed;
}

/**
 * 主入口：把一句话变成一个"意图"
 * @returns {{kind:string, payload:object}|null}
 */
export function parseCommand(raw, now = new Date()) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const explicitTodo = TODO_RE.test(text);
  if (blockedCommand(text, explicitTodo)) return null;
  if (ambiguousLedgerNumber(text) && CURRENCY_RE.test(text)) return null;
  // 相对提醒不能降级为无期限待办。无效/缺内容/重复期限均要求澄清。
  if (/提醒/.test(text) && /(?:\d|小时|刻钟|分钟|分|秒|天|hours?|minutes?|mins?|hrs?)\s*(?:以后|之后|后)/i.test(text)) {
    return relativeReminder(text);
  }

  const time = parseClock(text);
  const clockLike = /\d+\s*[:：]\s*\d+|(?:\d+|[零一二两三四五六七八九十百千]+)\s*(?:点(?!\d)|时(?!长))|\d+\s*(?:am|pm)\b/i;
  if (clockLike.test(text) && !time) return null;
  const hasDate = text.search(DATE_WORD_RE) !== -1;
  const isQuestion = QUESTION_RE.test(text);
  const date = resolveTodoDate(text, now, time);
  const futureDate = hasDate && dateKey(date) !== dateKey(now);
  // 提醒和明确的将来/时刻优先，避免「明天15:30喝水」被记成喝了15ml。
  if (explicitTodo || !isQuestion && (time || futureDate) && !CURRENCY_RE.test(text)) {
    const content = todoContent(text);
    return content ? { kind: 'todo', payload: { text: content, date: dateKey(date), time, timed: !!time } } : null;
  }

  // 金额/消费语义先交给已有引擎，防止「买跑步机」「学习资料」被生活词抢占。
  // 引擎的型号剔除会吞掉英文消费词后多位小数的前位；仅保护明确消费词后的金额。
  const ledgerText = text.replace(/\b(coffee|lunch|dinner|breakfast|taxi)\s*(?=\d)/gi, '$1 ¥');
  const ledger = parseLedgerPhrase(ledgerText);
  if (ledger && (CURRENCY_RE.test(text) || /[¥￥]|买|购买|购入|花了|支付|付了|消费|费用|器材|资料/.test(text))) {
    return ambiguousLedgerNumber(text) ? null : ledgerIntent(ledger);
  }

  const waterPhrase = /饮水|补水|喝(?:了)?(?:\s|水|\d|[零一二两三四五六七八九十])|\b(?:drink|drank|water|hydration)\b/i.test(text) && !/水费|水果/.test(text);
  const stepPhrase = /\d\s*(?:k\s*)?(?:步(?!行)|steps?\b)|步数|\bsteps?\b/i.test(text);
  const studyPhrase = /学习|看书|专注|自习|背单词|刷题|\b(?:study|studied|focus|read|learn)\b/i.test(text);
  const exercises = Object.entries(SPORT_ALIASES).filter(([, re]) => re.test(text));
  const exercise = exercises[0]?.[0] || null;
  // 一句话混有多个记录意图不能任意择一（运动 + 明确步数属于步数记录）。
  if (exercises.length > 1 || [waterPhrase, stepPhrase, studyPhrase, !!exercise && !stepPhrase].filter(Boolean).length > 1) return null;

  /* -------- 运动记录：必须有有效时长；仅距离由快捷入口预填，不产生非法记录 -------- */
  if (exercise && !stepPhrase) {
    const duration = [...text.matchAll(DURATION_RE)];
    const distances = [...text.matchAll(DISTANCE_RE)];
    const minutes = sportMinutes(text);
    if (duration.length && !minutes || distances.length > 1) return null;
    const distance = distances.length ? Number(distances[0][1]) * (/mile|英里/i.test(distances[0][2]) ? 1.609344 : 1) : 0;
    if (distances.length && !positive(distance, 1000)) return null;
    if (minutes && !unexplainedNumber(text, DURATION_RE, DISTANCE_RE)) {
      return { kind: 'sport', payload: { type: exercise, minutes, distance } };
    }
    return null;
  }

  /* -------- 饮水：杯按 250ml；瓶没有统一容量，不猜 -------- */
  if (waterPhrase) {
    const amounts = [...text.matchAll(WATER_RE)];
    if (amounts.length > 1) return null;
    let ml = 0;
    if (amounts.length) {
      const [full, value, unit] = amounts[0];
      if (/瓶|bottle/i.test(unit)) return null;
      ml = quantity(value) * (/杯|glass|cup/i.test(unit) ? 250 : /^(?:升|l|liters?|litres?)$/i.test(unit) ? 1000 : 1);
      if (unexplainedNumber(text.replace(full, ' '))) return null;
    } else {
      // 保留既有「喝了300水」简写，其余裸数字不猜。
      const shorthand = text.match(/^\s*(?:今天|今日)?\s*喝(?:了)?\s*(\d+(?:\.\d+)?)\s*水\s*$/);
      if (shorthand) ml = Number(shorthand[1]);
      else if (/\b(?:a|one)\s+(?:glass|cup)\s+(?:of\s+)?water\b/i.test(text)) ml = 250;
    }
    return positive(ml, 100_000) ? { kind: 'water', payload: { ml } } : null;
  }

  /* -------- 步数：设置今天总量，必须有步单位/步数标签 -------- */
  if (stepPhrase) {
    const amounts = [...text.matchAll(STEPS_RE)];
    const labelled = text.match(/^(?:今天|今日)?\s*步数\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(k)?\s*$/i);
    if (amounts.length > 1 || !amounts.length && !labelled) return null;
    const amount = amounts[0] || labelled;
    const steps = quantity(amount[1]) * (amount[2] ? 1000 : 1);
    if (amounts.length && unexplainedNumber(text, STEPS_RE)) return null;
    return positive(steps, 100_000_000, true) ? { kind: 'steps', payload: { steps } } : null;
  }

  /* -------- 学习记录 / 启动专注：未来计时与既有完成记录明确区分 -------- */
  if (studyPhrase || /番茄钟/.test(text)) {
    const minutes = sportMinutes(text);
    if (!minutes || unexplainedNumber(text, DURATION_RE)) return null;
    const completedFocus = /专注\s*了|(?:已|已经)\s*专注|(?:记录|补记|记下)\s*(?:了\s*)?专注/.test(text);
    const focusPhrase = /^(?:(?:开始|启动)\s*)?(?:专注(?:计时)?|番茄钟)\s*/.test(text);
    if (focusPhrase && !completedFocus) {
      // 主界面当前支持 1..180 分钟；不生成会被确认执行拒绝的启动参数。
      if (text.replace(/^(?:(?:开始|启动)\s*)?(?:专注(?:计时)?|番茄钟)\s*/, '').replace(DURATION_RE, '').trim()) return null;
      return positive(minutes, 180, true) ? { kind: 'focus', payload: { minutes } } : null;
    }
    return { kind: 'study', payload: { minutes } };
  }

  /* -------- 提醒 / 待办（日期短语可以不带「提醒」） -------- */
  const isTodo = !isQuestion && hasDate && !CURRENCY_RE.test(text) && !EARN_RE.test(text)
    && (!SPEND_RE.test(text) || !num(text));
  if (isTodo) {
    const content = todoContent(text);
    if (content) {
      return {
        kind: 'todo',
        payload: { text: content, date: dateKey(resolveTodoDate(text, now, time)), time, timed: !!time }
      };
    }
  }

  /* -------- 其余记账仍复用专门引擎，不从任意裸数字创造支出 -------- */
  return !time && !ambiguousLedgerNumber(text) ? ledgerIntent(ledger) : null;
}

const SPORT_SHORTCUTS = {
  run: ['跑步', '慢跑', 'run', 'running', 'jog', 'jogging'],
  walk: ['走路', '散步', '步行', 'walk', 'walking'],
  bike: ['骑行', '骑车', '自行车', 'cycle', 'cycling', 'bike', 'bicycle'],
  swim: ['游泳', 'swim', 'swimming'],
  gym: ['力量', '力量训练', '举铁', '健身', 'strength', 'gym', 'workout', 'weights'],
  yoga: ['瑜伽', '拉伸', 'yoga', 'stretch'],
  ball: ['球类', '乒乓', '乒乓球', '篮球', '足球', '羽毛球', '网球', 'tennis', 'badminton', 'pingpong', 'basketball', 'football'],
  hike: ['徒步', '爬山', '登山', 'hike', 'hiking', 'trek']
};

/** 本地快捷入口只导航/预填，不生成记录；绝不使用子串匹配扩张白名单。 */
export function resolveLocalShortcut(raw) {
  const text = String(raw || '').trim();
  if (!text || blockedCommand(text)) return null;
  const target = text.replace(/^打开\s*/, '').toLowerCase();
  const entry = (kind, page, payload = {}) => ({ kind, page, payload });
  for (const [type, names] of Object.entries(SPORT_SHORTCUTS)) {
    if (names.includes(target)) return entry('prefill', 'sport', { type });
    // 仅距离不能保存运动：将明确距离带入表单，时长由用户补全，不能默认 0。
    const distance = target.match(new RegExp(`^(${names.join('|')})\\s*(${QUANTITY})\\s*(公里|km|英里|miles?)$`, 'i'));
    if (distance) {
      const value = quantity(distance[2]) * (/英里|mile/i.test(distance[3]) ? 1.609344 : 1);
      return positive(value, 1000) ? entry('prefill', 'sport', { type, distance: value }) : null;
    }
  }
  if (['喝水', '饮水'].includes(target)) return entry('prefill', 'habits', { field: 'water' });
  if (['开会', '写周报', '发邮件'].includes(target)) return entry('prefill', 'todo', { text: target });
  const pages = {
    sport: ['运动'], habits: ['习惯', '健康', '健康打卡'], study: ['学习', '专注', '番茄钟'],
    calendar: ['日历', '提醒', '倒计时'], todo: ['待办', '任务']
  };
  for (const [page, names] of Object.entries(pages)) {
    if (names.includes(target)) return entry('navigate', page);
  }
  return null;
}

const COMMAND_SEPARATOR = /[，,；;。\n]+|(?:然后|接着|并且|同时|顺便)/;
// A counted unit is the reliable end of one command (“28元”“300ml”“30分钟”)，which is where
// users naturally start the next instruction without punctuation.
const COMMAND_UNIT_TAIL = /(?:元|块|块钱|毫升|ml|步|分钟|小时|钟头|公里|km|英里|杯|瓶|次)$/;

function stripLeadingConnector(part) {
  return part.trim()
    .replace(/^(?:再|又|还|也|另外|此外|顺便|以及|然后|接着|并且|同时)\s*/, '')
    .trim();
}

function parseEvery(parts, now) {
  if (parts.length < 2 || parts.length > 8) return null;
  const intents = [];
  for (const part of parts) {
    const intent = parseCommand(part, now);
    if (!intent) return null;
    intents.push(intent);
  }
  return intents;
}

function splitPositions(text) {
  const positions = [];
  for (let index = 1; index < text.length; index += 1) {
    const head = text.slice(0, index);
    if (/\s$/.test(head) || COMMAND_UNIT_TAIL.test(head)) positions.push(index);
  }
  return positions;
}

/**
 * Greedy segmentation over unit/whitespace boundaries. A split is accepted only when both the
 * head and the whole remainder parse; one ambiguous remainder is then segmented recursively.
 * This catches “午饭28元明天下午3点开会” and “午饭28元 喝水300ml” without guessing.
 */
function segmentCommands(text, now) {
  const cache = new Map();
  const parse = value => {
    if (!cache.has(value)) cache.set(value, parseCommand(value, now));
    return cache.get(value);
  };
  const walk = (value, depth) => {
    if (depth >= 8) return null;
    const key = `!${value}`;
    if (cache.has(key)) return cache.get(key);
    cache.set(key, null);
    for (const index of splitPositions(value)) {
      const head = value.slice(0, index).trim();
      const tail = value.slice(index).trim();
      if (!head || !tail) continue;
      const first = parse(head);
      if (!first) continue;
      // Prefer a fully segmented tail; only then fall back to one command that may have
      // swallowed the following instruction.
      const rest = walk(tail, depth + 1);
      if (rest) {
        const result = [first, ...rest];
        cache.set(key, result);
        return result;
      }
      const second = parse(tail);
      if (second) {
        const result = [first, second];
        cache.set(key, result);
        return result;
      }
    }
    return null;
  };
  return walk(text, 0);
}

/**
 * Parse one or more commands from a single sentence.
 *
 * The single-command parser stays conservative. A sentence is only split when punctuation /
 * conjunctions separate complete intents, or when every part on both sides of a unit/whitespace
 * boundary is independently valid. “明天下午三点开会” therefore stays one task.
 */
export function parseCommandList(raw, now = new Date()) {
  const text = String(raw || '').trim();
  if (!text) return [];
  // A single command may also swallow the next one (`午饭28元喝水300ml` is parsed by the ledger
  // engine as one note). Always try segments first and only fall back to the single parser.
  const separated = parseEvery(
    text.split(COMMAND_SEPARATOR).map(stripLeadingConnector).filter(Boolean),
    now
  );
  if (separated) return separated;
  return segmentCommands(text, now) || [];
}

/** 一句话预览，给用户看"我理解成了什么" */
export function preview(intent) {
  if (!intent) return '';
  const p = intent.payload;
  switch (intent.kind) {
    case 'ledger':
      return `${p.type === 'income' ? '收入' : '支出'} ${p.amount} 元 · ${p.note} · ${p.cat}`;
    case 'todo':
      return `待办：${p.text}（${p.date}${p.time ? ` ${p.time}` : ''}）`;
    case 'water':
      return `饮水 +${p.ml} ml`;
    case 'steps':
      return `设置今天总步数为 ${p.steps} 步（替换，不累加）`;
    case 'focus':
      return `启动专注计时 ${p.minutes} 分钟（确认后开始，不立即计入学习记录）`;
    case 'reminder':
      return `相对提醒：${p.text}（确认后 ${p.minutes} 分钟提醒，确认时开始倒计时）`;
    case 'study':
      return `记录已完成学习 / 专注 +${p.minutes} 分钟`;
    case 'sport':
      return `运动 ${p.type} · ${p.minutes || '—'} 分钟${p.distance ? ` · ${p.distance} km` : ''}`;
    default:
      return '';
  }
}
