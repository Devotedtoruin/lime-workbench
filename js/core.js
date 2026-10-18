// core.js — 纯业务逻辑，无 DOM 依赖，可被 Node 单元测试直接引用

export const DEFAULT_SETTINGS = {
  salary: 8000,
  workHours: 8,
  onTime: '09:00',
  offTime: '18:00',
  payDay: 15,
  waterGoal: 2000,
  stepGoal: 6000,
  restDays: [0, 6], // 周六周日休息
  // 个性化：displayName 为空时界面用「你」；avatar 是 emoji，
  // avatarImage/logoImage 保留静态缩略图；AssetId 仅引用本机 IndexedDB 素材。
  displayName: '',
  avatar: '',
  avatarImage: '',
  avatarAssetId: '',
  workspaceName: '',
  logoMode: 'default',
  logoImage: '',
  logoAssetId: ''
};

/**
 * 称呼：没设置名字时用「你」，避免界面上出现写死的假名字。
 * 名字过长时截断，防止撑破问候语。
 */
export function displayNameOf(settings) {
  const name = String(settings?.displayName || '').trim();
  if (!name) return '你';
  return [...name].slice(0, 12).join('');
}

// Older browsers may lack Segmenter; keep combining marks, emoji modifiers, flags and ZWJ
// sequences together rather than truncating at an arbitrary number of code points.
function firstGrapheme(value) {
  if (typeof Intl?.Segmenter === 'function') {
    const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      .segment(value)[Symbol.iterator]().next().value;
    return segment?.segment || '';
  }
  const chars = [...value];
  if (!chars.length) return '';
  const regional = char => /[\u{1f1e6}-\u{1f1ff}]/u.test(char);
  const extension = char => /\p{Mark}|[\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}︎️]/u.test(char);
  let result = chars[0];
  let i = 1;
  if (regional(chars[0]) && i < chars.length && regional(chars[i])) result += chars[i++];
  while (i < chars.length) {
    if (extension(chars[i])) result += chars[i++];
    else if (chars[i] === '‍' && i + 1 < chars.length) {
      result += chars[i++] + chars[i++];
    } else break;
  }
  return result;
}

/** 头像：优先用上传的图片，其次完整的首个 emoji/grapheme，最后取名字首字。 */
export function avatarOf(settings) {
  const image = String(settings?.avatarImage || '');
  if (image.startsWith('data:image/')) return { kind: 'image', value: image };
  const emoji = String(settings?.avatar || '').trim();
  if (emoji) return { kind: 'text', value: firstGrapheme(emoji) };
  const name = String(settings?.displayName || '').trim();
  if (name) return { kind: 'text', value: firstGrapheme(name) };
  return { kind: 'text', value: '我' };
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function parseTime(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

/** 把 "09:00" 变成当天的 Date */
export function timeOnDate(hhmm, base = new Date()) {
  const { h, m } = parseTime(hhmm);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** 今天的有效在岗分钟数（下班后按整段工时算） */
export function workedMinutes(settings, now = new Date()) {
  const start = timeOnDate(settings.onTime, now);
  const end = timeOnDate(settings.offTime, now);
  const total = Math.max(0, (end - start) / 60000);
  const clamped = Math.min(Math.max((now - start) / 60000, 0), total);
  return Math.round(clamped);
}

/** 时薪 = 月薪 / (计薪天数 * 日工时)。计薪天数按自然月 22 个工作日估算 */
export function hourlyRate(settings) {
  const hours = Math.max(0.5, Number(settings.workHours) || 8);
  return (Number(settings.salary) || 0) / (22 * hours);
}

/** 今天已赚：按在岗时间累计，但每天最多计入配置的日工时（如 09–18 含午休）。 */
export function earnedToday(settings, now = new Date()) {
  if (settings.restDays.includes(now.getDay())) return 0;
  const hours = Math.max(0.5, Number(settings.workHours) || 8);
  const billableMinutes = Math.min(workedMinutes(settings, now), hours * 60);
  return (billableMinutes / 60) * hourlyRate(settings);
}

/**
 * 距离下班的可读文案。
 * 必须每秒都能看出变化：这是工作台里最常被盯着看的数字，
 * 之前超过 1 小时只显示「X小时Y分」，秒被丢掉，看起来像卡住了。
 */
export function countdownToOff(settings, now = new Date()) {
  const end = timeOnDate(settings.offTime, now);
  const diff = end - now;
  if (diff <= 0) return '已下班';
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}小时${m}分${pad(s)}秒` : `${m}分${pad(s)}秒`;
}

/** 下班倒计时的结构化数值，供 UI 做大号数字展示 */
export function offCountdown(settings, now = new Date()) {
  const end = timeOnDate(settings.offTime, now);
  const diff = Math.max(0, end - now);
  const total = Math.floor(diff / 1000);
  return {
    done: diff <= 0,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    totalSeconds: total
  };
}

/** 距离周末：休息日为 0 时返回 0 */
export function daysToWeekend(settings, now = new Date()) {
  const rest = settings.restDays.length ? settings.restDays : [0, 6];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (rest.includes(d.getDay())) return i;
  }
  return 0;
}

/** 距离发薪日天数；短月没有设定日期时按当月最后一天算。 */
export function daysToPayday(settings, now = new Date()) {
  const day = Math.min(31, Math.max(1, Math.trunc(Number(settings.payDay)) || 1));
  const payday = (year, month) => new Date(year, month,
    Math.min(day, new Date(year, month + 1, 0).getDate()));
  const thisMonth = payday(now.getFullYear(), now.getMonth());
  const next = thisMonth < new Date(now.getFullYear(), now.getMonth(), now.getDate())
    ? payday(now.getFullYear(), now.getMonth() + 1) : thisMonth;
  // 按本地日历日期而不是毫秒计数，避免时分和夏令时影响天数。
  const calendarDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  return calendarDay(next) - calendarDay(now);
}

/** 本月收入 / 支出 / 结余 */
export function monthSummary(records, d = new Date()) {
  const key = monthKey(d);
  let income = 0;
  let expense = 0;
  for (const r of records) {
    if (!r || !r.date || !r.date.startsWith(key)) continue;
    const amt = Number(r.amount) || 0;
    if (r.type === 'income') income += amt;
    else expense += amt;
  }
  return { income, expense, balance: income - expense };
}

export function money(n) {
  return `¥${(Number(n) || 0).toFixed(2)}`;
}

/** 极简记账解析："午饭28块" -> {amount:28, note:"午饭"} */
export function parseLedgerText(text) {
  const s = String(text || '').trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:元|块|块钱|rmb|¥)?/i);
  if (!m) return null;
  const amount = Math.abs(parseFloat(m[1]));
  const note = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  return { amount, note: note || '记一笔' };
}

/** 宠物等级：每 50 块钱经验升 1 级，最高 99 */
export function petLevel(totalEarned) {
  return Math.min(99, 1 + Math.floor((Number(totalEarned) || 0) / 50));
}

export const PET_TITLES = ['青柠见习生', '青柠熟练工', '青柠老油条', '青柠摸鱼王', '青柠自由人'];

export function petTitle(level) {
  return PET_TITLES[Math.min(PET_TITLES.length - 1, Math.floor((level - 1) / 20))];
}
