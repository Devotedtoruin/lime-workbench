// reminders.js — 定时提醒 / 倒计时 / 番茄钟（纯逻辑层）
//
// 负责「到点就提醒」这件事的全部规则，UI 只负责画出来和播放声音。
// 三种模式：
//   · 间隔提醒（interval）  「每隔 45 分钟提醒我喝水」
//   · 定时提醒（once）      「14:30 提醒我开会」
//   · 倒计时（timer）       「专注 25 分钟」「睡 20 分钟」
//
// 设计原则：
//   - 纯函数计算"下一次该几点响"，可单测
//   - 页面切后台时用 setTimeout 补偿 + 时间戳比对，不依赖 tick 精度
//   - 全部数据可序列化到 localStorage

export const PRESETS = [
  { id: 'water', icon: 'water', label: '喝水', every: 45, unit: 'min', text: '该喝水啦 💧', color: '#4a90d9' },
  { id: 'eyes', icon: 'eye', label: '护眼', every: 20, unit: 'min', text: '看远处 20 秒，保护眼睛 👀', color: '#7b8fa8' },
  { id: 'posture', icon: 'muscle', label: '坐姿', every: 30, unit: 'min', text: '挺直腰背，起来动动 🧘', color: '#8a6bbf' },
  { id: 'stand', icon: 'run', label: '起身', every: 60, unit: 'min', text: '坐太久了，站起来走走 🚶', color: '#e0913c' },
  { id: 'mood', icon: 'star', label: '心情', every: 120, unit: 'min', text: '深呼吸，放松一下 ✨', color: '#d9534f' }
];

export const TIMER_PRESETS = [
  { id: 'pomo', icon: 'clock', label: '25 分钟', minutes: 25, text: '25 分钟倒计时已结束。此提醒不计入专注记录。' },
  { id: 'pomo50', icon: 'clock', label: '50 分钟', minutes: 50, text: '50 分钟倒计时已结束。此提醒不计入专注记录。' },
  { id: 'tea', icon: 'tea', label: '茶歇 15 分', minutes: 15, text: '茶歇结束，回工位啦 🍵' },
  { id: 'nap', icon: 'meditate', label: '午睡 20 分', minutes: 20, text: '午睡结束，醒醒神 😴' },
  { id: 'work', icon: 'laptop', label: '冲刺 90 分', minutes: 90, text: '深度工作结束 🎯' },
  { id: 'commute', icon: 'bike', label: '通勤 45 分', minutes: 45, text: '该下车啦 🚌' }
];

export const MIN_REMINDER_MINUTES = 1;
export const MAX_REMINDER_MINUTES = 1440; // 浏览器计时器与 UI 保持在 1 天内

function validMinutes(value) {
  const minutes = Number(value);
  if (typeof value === 'boolean' || value == null || !Number.isFinite(minutes) ||
      minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) {
    throw new RangeError(`分钟数须在 ${MIN_REMINDER_MINUTES}–${MAX_REMINDER_MINUTES} 之间`);
  }
  return minutes;
}

function validMs(value) {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) throw new RangeError('时间戳无效');
  return ms;
}

function validClock(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new RangeError('时间须为有效 HH:MM');
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** 时间字符串 "HH:MM" → 当天 Date */
export function timeToDate(hhmm, base = new Date()) {
  const { hour, minute } = validClock(hhmm);
  const d = new Date(validMs(base));
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** 下一次「每隔 N 分钟」该几点响 */
export function nextInterval(fromMs, everyMin, now = Date.now()) {
  const start = validMs(fromMs);
  const current = validMs(now);
  const step = validMinutes(everyMin) * 60000;
  const n = Math.max(1, Math.floor((current - start) / step) + 1);
  return start + n * step;
}

/** 下一次「每天 HH:MM」该几点响（按本地日期推进，避免夏令时漂移） */
export function nextDaily(hhmm, now = new Date()) {
  const current = new Date(validMs(now));
  const today = timeToDate(hhmm, current);
  if (today.getTime() > current.getTime()) return today;
  const tomorrow = new Date(current);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return timeToDate(hhmm, tomorrow);
}

/** 倒计时剩余秒数 */
export function remainSec(startMs, durationMin, now = Date.now()) {
  const end = validMs(startMs) + validMinutes(durationMin) * 60000;
  return Math.max(0, Math.ceil((end - validMs(now)) / 1000));
}

/** 秒 → "MM:SS" 或 "HH:MM:SS" */
export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** 生成一个新的「间隔提醒」 */
export function makeInterval(presetId, everyMin = null) {
  const p = PRESETS.find(x => x.id === presetId) || PRESETS[0];
  const every = validMinutes(everyMin ?? p.every);
  const startAt = Date.now();
  return {
    id: `${p.id}-${startAt}`,
    kind: 'interval',
    preset: p.id,
    icon: p.icon,
    label: p.label,
    text: p.text,
    color: p.color,
    every,
    startAt,
    nextAt: startAt + every * 60000,
    enabled: true,
    fired: 0
  };
}

/** 生成一个新的「倒计时」 */
export function makeTimer(presetId, minutes = null) {
  const p = TIMER_PRESETS.find(x => x.id === presetId) || TIMER_PRESETS[0];
  const mins = validMinutes(minutes ?? p.minutes);
  const startAt = Date.now();
  return {
    id: `${p.id}-${startAt}`,
    kind: 'timer',
    preset: p.id,
    icon: p.icon,
    label: p.label,
    text: p.text,
    color: '#7b8fa8',
    minutes: mins,
    startAt,
    endAt: startAt + mins * 60000,
    enabled: true
  };
}

/** 生成一个新的「每日定点提醒」 */
export function makeDaily(label, hhmm, text, now = new Date()) {
  const { hour, minute } = validClock(hhmm);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    id: `daily-${Date.now()}`,
    kind: 'daily',
    icon: 'alarm',
    label,
    text: text || label,
    time,
    nextAt: nextDaily(time, now).getTime(),
    enabled: true
  };
}

/** 从任务的本地日期和 HH:MM 创建一次性提醒；过期或无效日期不创建。 */
export function makeOnce(label, dateKey, hhmm, text = label, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) throw new RangeError('日期须为有效 YYYY-MM-DD');
  const [year, month, day] = match.slice(1).map(Number);
  const { hour, minute } = validClock(hhmm);
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (at.getFullYear() !== year || at.getMonth() + 1 !== month || at.getDate() !== day ||
      at.getHours() !== hour || at.getMinutes() !== minute) {
    throw new RangeError('日期或时间无效');
  }
  const nextAt = at.getTime();
  if (nextAt <= validMs(now)) throw new RangeError('一次性提醒必须在未来');
  return {
    id: `once-${Date.now()}`,
    kind: 'once',
    icon: 'alarm',
    label,
    text: text || label,
    date: dateKey,
    time: hhmm,
    nextAt,
    enabled: true
  };
}

/** 扫描到期提醒；已暂停或已完成的提醒不会再次触发。 */
export function scanDue(list, now = Date.now()) {
  const due = [];
  for (const r of list) {
    if (!r || !r.enabled || r.completed) continue;
    if (r.kind === 'timer') {
      if (Number.isFinite(r.endAt) && r.endAt <= now) due.push(r);
    } else if (Number.isFinite(r.nextAt) && r.nextAt <= now) {
      due.push(r);
    }
  }
  return due;
}

/** 响完一次后，间隔/每日提醒推进；倒计时/单次提醒完成并停用。 */
export function advance(reminder, now = Date.now()) {
  const current = validMs(now);
  if (!reminder.enabled || reminder.completed) return { ...reminder };
  const r = { ...reminder, fired: (reminder.fired || 0) + 1 };
  if (r.kind === 'interval') {
    r.startAt = current;
    r.nextAt = current + validMinutes(r.every) * 60000;
  }
  else if (r.kind === 'daily') r.nextAt = nextDaily(r.time, new Date(current)).getTime();
  else if (r.kind === 'timer' || r.kind === 'once') {
    r.enabled = false;
    r.completed = true;
  }
  return r;
}

/** 暂停时记住剩余时间；再次启用才能恢复计时。 */
export function pauseReminder(reminder, now = Date.now()) {
  const current = validMs(now);
  if (!reminder.enabled || reminder.completed) return { ...reminder };
  if (reminder.kind === 'interval') validMinutes(reminder.every);
  if (reminder.kind === 'timer') validMinutes(reminder.minutes);
  const deadline = reminder.kind === 'timer' ? reminder.endAt : reminder.nextAt;
  if (!Number.isFinite(deadline) || deadline <= current) throw new RangeError('到期的提醒不能暂停');
  return { ...reminder, enabled: false, pausedAt: current, remainingMs: deadline - current };
}

/** 恢复暂停的提醒；已完成或一次性已过期的提醒不能恢复。 */
export function resumeReminder(reminder, now = Date.now()) {
  const current = validMs(now);
  if (reminder.completed) throw new RangeError('已完成的提醒不能恢复');
  if (reminder.enabled) return { ...reminder };
  if (!Number.isFinite(reminder.pausedAt) || !Number.isFinite(reminder.remainingMs) ||
      reminder.remainingMs <= 0) throw new RangeError('提醒没有有效的暂停状态');
  const r = { ...reminder, enabled: true };
  if (r.kind === 'once') {
    if (r.nextAt <= current) throw new RangeError('过期的一次性提醒不能恢复');
  } else if (r.kind === 'daily') {
    r.nextAt = nextDaily(r.time, new Date(current)).getTime();
  } else if (r.kind === 'interval') {
    validMinutes(r.every);
    r.nextAt = current + r.remainingMs;
    r.startAt = r.nextAt - r.every * 60000;
  } else if (r.kind === 'timer') {
    validMinutes(r.minutes);
    r.endAt = current + r.remainingMs;
    r.startAt = r.endAt - r.minutes * 60000;
  } else {
    throw new RangeError('未知的提醒类型');
  }
  delete r.pausedAt;
  delete r.remainingMs;
  return r;
}

/** 进度百分比（用于进度环）；暂停时冻结进度。 */
export function progress(r, now = Date.now()) {
  if (r.completed) return 1;
  const current = !r.enabled && Number.isFinite(r.pausedAt) ? r.pausedAt : now;
  if (r.kind === 'once') return 0;
  if (r.kind === 'timer') {
    const total = r.endAt - r.startAt;
    return total > 0 ? Math.min(1, Math.max(0, (current - r.startAt) / total)) : 0;
  }
  const previous = new Date(r.nextAt);
  previous.setDate(previous.getDate() - 1);
  const start = r.kind === 'daily'
    ? timeToDate(r.time, previous).getTime()
    : (r.startAt ?? r.nextAt - r.every * 60000);
  const total = r.nextAt - start;
  return total > 0 ? Math.min(1, Math.max(0, (current - start) / total)) : 0;
}

/** 一句人话描述还剩多久 */
export function humanRemain(r, now = Date.now()) {
  if (r.completed) return '已完成';
  if (r.kind === 'timer') {
    const remaining = !r.enabled && Number.isFinite(r.remainingMs)
      ? r.remainingMs : r.endAt - now;
    return `${r.enabled ? '还剩' : '已暂停 · 剩余'} ${fmt(remaining / 1000)}`;
  }
  const remaining = !r.enabled && Number.isFinite(r.remainingMs)
    ? r.remainingMs : r.nextAt - now;
  const sec = Math.max(0, Math.round(remaining / 1000));
  if (sec < 60) return `${r.enabled ? '' : '已暂停 · '}${sec} 秒后`;
  if (sec < 3600) return `${r.enabled ? '' : '已暂停 · '}${Math.floor(sec / 60)} 分 ${sec % 60} 秒后`;
  return `${r.enabled ? '' : '已暂停 · '}${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分后`;
}

/* ---------------- 声音（Web Audio 合成，无需音频文件） ---------------- */
let audioCtx = null;
export function chime(kind = 'soft') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const notes = kind === 'urgent' ? [880, 660, 880] : kind === 'done' ? [523, 659, 784] : [660, 880];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.value = f;
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.start(t); o.stop(t + 0.14);
    });
  } catch { /* 浏览器禁止自动播放时静默 */ }
}
