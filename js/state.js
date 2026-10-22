// State and backup validation. This module is pure: callers decide when to read/write storage.
import { DEFAULT_SETTINGS } from './core.js';
import { HABIT_LIMITS } from './habits.js';

export const CURRENT_STATE_VERSION = 6;
export const STATE_VERSION = CURRENT_STATE_VERSION;
export const SUPPORTED_STATE_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6]);
export const MAX_BACKUP_CHARS = 2_000_000;

// The same bounds apply to live input and backup validation (lengths are UTF-16 code units).
export const TEXT_LIMITS = Object.freeze({
  taskText: 300, taskTag: 80, ledgerNote: 300, ledgerCategory: 80,
  reminderLabel: 120, reminderText: 300, place: 120, displayName: 80,
  avatar: 32, workspaceName: 40, petName: 80, focusText: 300, ledgerCategoryName: 24,
  noteTitle: 120, noteBody: 5000, linkTitle: 80, linkUrl: 2000
});
export const COLLECTION_LIMITS = Object.freeze({
  todos: 2_000, ledger: 5_000, sport: 2_000, reminders: 500, pendingAlerts: 501,
  datedMaps: 3660, waterPerDay: 200, waterTotal: 10_000, ledgerCats: 60,
  notes: 100, links: 100, habits: 20, workTemplates: 20, workSchedule: 366, ledgerTemplates: 30
});

const BAD = Symbol('invalid state value');
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const ROOT_KEYS = ['version', 'settings', 'todos', 'ledger', 'water', 'steps', 'study', 'sport',
  'reminders', 'pendingAlerts', 'notes', 'links', 'habits', 'notifOn', 'soundOn', 'earnedTotal', 'pet', 'focus'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ASSET_RE = /^[a-zA-Z0-9_-]{1,48}\.(?:png|jpg|jpeg|webp|gif)$/;
const LOCAL_ASSET_ID_RE = /^[a-z0-9-]{1,80}$/;
const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const COLOR_RE = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const MAX_TIMESTAMP = Date.UTC(2101, 0, 1);

export function defaultState() {
  return {
    version: STATE_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      restDays: [...DEFAULT_SETTINGS.restDays],
      workTemplates: [],
      workSchedule: [],
      ledgerTemplates: []
    },
    todos: [], ledger: [], water: {}, steps: {}, study: {}, sport: [], reminders: [], pendingAlerts: [],
    notes: [], links: [], habits: [],
    notifOn: false, soundOn: true, earnedTotal: 0,
    pet: { name: '青柠', img: 'lemon.png' },
    focus: { total: 1500, remaining: 1500, running: false, dueAt: null, lastCreditedAt: null,
      text: '', taskId: null, creditRemainders: {} }
  };
}

function invalid(ctx, path) {
  if (ctx.strict) throw new Error(`Invalid backup: ${path}`);
  return BAD;
}

function record(value, keys, ctx, path) {
  if (!plain(value)) return invalid(ctx, path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return invalid(ctx, path);
    // Also reject accessor properties when normalizeState is called with a non-JSON object.
    if (!has(Object.getOwnPropertyDescriptor(value, key), 'value')) return invalid(ctx, `${path}.${key}`);
    if (!keys.includes(key)) invalid(ctx, `${path}.${key}`);
  }
  return value;
}

function field(obj, key, parser, fallback, ctx, path) {
  if (!has(obj, key)) return fallback;
  const value = parser(obj[key], ctx, `${path}.${key}`);
  return value === BAD ? fallback : value;
}

function required(obj, key, parser, ctx, path) {
  return has(obj, key) ? parser(obj[key], ctx, `${path}.${key}`) : invalid(ctx, `${path}.${key}`);
}

function number(min, max, integer = false) {
  return (value, ctx, path) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max &&
    (!integer || Number.isSafeInteger(value)) ? value : invalid(ctx, path);
}

const bool = (value, ctx, path) => typeof value === 'boolean' ? value : invalid(ctx, path);
const timestamp = number(0, MAX_TIMESTAMP, true);
const idNumber = number(1, Number.MAX_SAFE_INTEGER, true);

function taskId(value, ctx, path) {
  return typeof value === 'number' ? idNumber(value, ctx, path) : pattern(SLUG_RE)(value, ctx, path);
}

function safeText(value) {
  return [...value].every(char => {
    const cp = char.codePointAt(0);
    return cp >= 32 && !(cp >= 127 && cp <= 159) &&
      !(cp >= 0x202a && cp <= 0x202e) && !(cp >= 0x2066 && cp <= 0x2069);
  });
}

/** Text is data, not markup. Callers must use textContent or escape it at HTML sinks. */
export function validateText(value, max, { allowEmpty = false } = {}) {
  return Number.isSafeInteger(max) && max >= 0 && typeof value === 'string' &&
    value.length <= max && (allowEmpty || value.trim().length > 0) && safeText(value);
}

const WORKSPACE_BIDI_RE = /[؜‎‏‪-‮⁦-⁩]/;

/** Workspace titles reject directional controls without changing existing alert/text sinks. */
export function validateWorkspaceTitle(value, max, { allowEmpty = false } = {}) {
  return validateText(value, max, { allowEmpty }) && !WORKSPACE_BIDI_RE.test(value) &&
    [...value].every(char => ![8232, 8233].includes(char.codePointAt(0)));
}

/** Notes alone permit LF and tabs; ordinary labels/alerts retain their single-line contract. */
export function validateNoteBody(value) {
  return typeof value === 'string' && value.length <= TEXT_LIMITS.noteBody &&
    safeText(value.replace(/[\n\t]/g, '')) && !WORKSPACE_BIDI_RE.test(value);
}

/** Persisted links must already be absolute HTTP(S), without credentials or parser tricks. */
export function validateWorkspaceUrl(value) {
  if (!validateWorkspaceTitle(value, TEXT_LIMITS.linkUrl) || /\s|\\/.test(value) ||
      !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && Boolean(authority) &&
      !url.username && !url.password && !authority.includes('@');
  } catch {
    return false;
  }
}

function text(max, allowEmpty = false) {
  return (value, ctx, path) =>
    validateText(value, max, { allowEmpty }) ? value : invalid(ctx, path);
}

function choice(values) {
  return (value, ctx, path) => values.includes(value) ? value : invalid(ctx, path);
}

/**
 * 头像缩略图：只接受 PNG/JPEG/WebP/GIF 的 data URL，且限制体积。
 * 不接受 SVG（可内嵌脚本）和任何 http(s) 外链（会泄露 IP 且可被替换）。
 */
const AVATAR_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_AVATAR_IMAGE_CHARS = 300_000;

function dataImage(value, ctx, path) {
  if (typeof value !== 'string') return invalid(ctx, path);
  if (value === '') return '';
  if (value.length > MAX_AVATAR_IMAGE_CHARS) return invalid(ctx, path);
  const match = AVATAR_IMAGE_RE.exec(value);
  return match && match[0].length === value.length ? value : invalid(ctx, path);
}

function pattern(re) {
  return (value, ctx, path) => {
    const match = typeof value === 'string' && re.exec(value);
    return match && match[0].length === value.length ? value : invalid(ctx, path);
  };
}

function dateKey(value, ctx, path) {
  const match = typeof value === 'string' && DATE_RE.exec(value);
  if (!match || match[0].length !== value.length) return invalid(ctx, path);
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : invalid(ctx, path);
}

function optionalDate(value, ctx, path) {
  return value === '' ? '' : dateKey(value, ctx, path);
}

function nullableTimestamp(value, ctx, path) {
  return value === null ? null : timestamp(value, ctx, path);
}

function nullableTaskId(value, ctx, path) {
  return value === null ? null : idNumber(value, ctx, path);
}

function restDays(value, ctx, path) {
  if (!Array.isArray(value) || value.length > 7 ||
      value.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(value).size !== value.length) return invalid(ctx, path);
  return [...value];
}

const WORK_TEMPLATE_KEYS = ['id', 'name', 'onTime', 'offTime', 'breakStart', 'breakEnd'];
function workTemplate(value, ctx, path) {
  const obj = record(value, WORK_TEMPLATE_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', taskId, ctx, path);
  const name = required(obj, 'name', text(TEXT_LIMITS.taskTag), ctx, path);
  const onTime = required(obj, 'onTime', pattern(TIME_RE), ctx, path);
  const offTime = required(obj, 'offTime', pattern(TIME_RE), ctx, path);
  const breakStart = required(obj, 'breakStart', pattern(TIME_RE), ctx, path);
  const breakEnd = required(obj, 'breakEnd', pattern(TIME_RE), ctx, path);
  if ([id, name, onTime, offTime, breakStart, breakEnd].includes(BAD)) return BAD;
  if (onTime === offTime) return invalid(ctx, path);
  return { id, name, onTime, offTime, breakStart, breakEnd };
}

const WORK_SCHEDULE_KEYS = ['id', 'date', 'onTime', 'offTime', 'breakStart', 'breakEnd'];
function workScheduleEntry(value, ctx, path) {
  const obj = record(value, WORK_SCHEDULE_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', taskId, ctx, path);
  const date = required(obj, 'date', dateKey, ctx, path);
  const onTime = required(obj, 'onTime', pattern(TIME_RE), ctx, path);
  const offTime = required(obj, 'offTime', pattern(TIME_RE), ctx, path);
  const breakStart = required(obj, 'breakStart', pattern(TIME_RE), ctx, path);
  const breakEnd = required(obj, 'breakEnd', pattern(TIME_RE), ctx, path);
  if ([id, date, onTime, offTime, breakStart, breakEnd].includes(BAD)) return BAD;
  if (onTime === offTime) return invalid(ctx, path);
  return { id, date, onTime, offTime, breakStart, breakEnd };
}

const LEDGER_TEMPLATE_KEYS = ['id', 'name', 'type', 'amount', 'cat', 'note', 'frequency', 'dayOfMonth', 'enabled', 'lastPosted'];
function ledgerTemplate(value, ctx, path) {
  const obj = record(value, LEDGER_TEMPLATE_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', taskId, ctx, path);
  const name = required(obj, 'name', text(TEXT_LIMITS.taskTag), ctx, path);
  const type = required(obj, 'type', choice(['income', 'expense']), ctx, path);
  const amount = required(obj, 'amount', number(0.01, 1_000_000), ctx, path);
  const cat = required(obj, 'cat', text(TEXT_LIMITS.ledgerCategory, true), ctx, path);
  const note = required(obj, 'note', text(TEXT_LIMITS.ledgerNote, true), ctx, path);
  const frequency = required(obj, 'frequency', choice(['daily', 'weekday', 'monthly', 'manual']), ctx, path);
  const dayOfMonth = required(obj, 'dayOfMonth', number(1, 31, true), ctx, path);
  const enabled = required(obj, 'enabled', bool, ctx, path);
  const lastPosted = field(obj, 'lastPosted', value => value === '' ? '' : pattern(DATE_RE)(value, ctx, path), '', ctx, path);
  if ([id, name, type, amount, cat, note, frequency, dayOfMonth, enabled].includes(BAD)) return BAD;
  return { id, name, type, amount, cat, note, frequency, dayOfMonth, enabled, lastPosted };
}

function settings(value, ctx, path) {
  const keys = [...Object.keys(DEFAULT_SETTINGS), 'place', 'coord', 'displayName', 'focusMinutes',
    'avatar', 'avatarImage', 'weatherAt', 'ledgerCats'];
  const obj = record(value, keys, ctx, path);
  if (obj === BAD) return BAD;
  const result = {
    ...DEFAULT_SETTINGS,
    restDays: [...DEFAULT_SETTINGS.restDays],
    workTemplates: [],
    workSchedule: [],
    ledgerTemplates: []
  };
  const fields = {
    salary: number(0, 10_000_000), workHours: number(0.5, 24),
    onTime: pattern(TIME_RE), offTime: pattern(TIME_RE),
    breakStart: pattern(TIME_RE), breakEnd: pattern(TIME_RE),
    payDay: number(1, 31, true),
    workspaceName: (v, c, p) => validateWorkspaceTitle(v, TEXT_LIMITS.workspaceName, { allowEmpty: true }) ? v : invalid(c, p),
    logoMode: choice(['default', 'custom', 'avatar']),
    logoImage: (v, c, p) => v === '' || typeof v === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(v)
      ? dataImage(v, c, p) : invalid(c, p),
    // Local references may outlive their IndexedDB blobs (for example after backup import).
    // Validate syntax only; missing assets must not discard the static poster or other data.
    avatarAssetId: (v, c, p) => v === '' ? '' : pattern(LOCAL_ASSET_ID_RE)(v, c, p),
    logoAssetId: (v, c, p) => v === '' ? '' : pattern(LOCAL_ASSET_ID_RE)(v, c, p),
    waterGoal: number(1, 100_000), stepGoal: number(1, 1_000_000), restDays,
    workTemplates: (v, c, p) => array(v, COLLECTION_LIMITS.workTemplates, workTemplate, c, p),
    workSchedule: (v, c, p) => array(v, COLLECTION_LIMITS.workSchedule, workScheduleEntry, c, p),
    ledgerTemplates: (v, c, p) => array(v, COLLECTION_LIMITS.ledgerTemplates, ledgerTemplate, c, p)
  };
  for (const [key, parser] of Object.entries(fields)) {
    result[key] = field(obj, key, parser, result[key], ctx, path);
  }
  if (has(obj, 'place')) {
    const place = text(TEXT_LIMITS.place, true)(obj.place, ctx, `${path}.place`);
    if (place !== BAD) result.place = place;
  }
  if (has(obj, 'displayName')) {
    const displayName = text(TEXT_LIMITS.displayName, true)(obj.displayName, ctx, `${path}.displayName`);
    if (displayName !== BAD) result.displayName = displayName;
  }
  // 头像：一个 emoji/短字符，或者一张 data:image 缩略图（上限约 200KB base64）。
  if (has(obj, 'avatar')) {
    const avatar = text(TEXT_LIMITS.avatar, true)(obj.avatar, ctx, `${path}.avatar`);
    if (avatar !== BAD) result.avatar = avatar;
  }
  if (has(obj, 'avatarImage')) {
    const avatarImage = dataImage(obj.avatarImage, ctx, `${path}.avatarImage`);
    if (avatarImage !== BAD) result.avatarImage = avatarImage;
  }
  if (has(obj, 'weatherAt')) {
    const weatherAt = timestamp(obj.weatherAt, ctx, `${path}.weatherAt`);
    if (weatherAt !== BAD) result.weatherAt = weatherAt;
  }
  // 自定义分类：用户在账本里自己加的分类标签。
  if (has(obj, 'ledgerCats')) {
    const cats = array(obj.ledgerCats, COLLECTION_LIMITS.ledgerCats, text(TEXT_LIMITS.ledgerCategoryName), ctx, `${path}.ledgerCats`);
    if (cats !== BAD) result.ledgerCats = cats;
  }
  if (has(obj, 'focusMinutes')) {
    const focusMinutes = number(1, 1440, true)(obj.focusMinutes, ctx, `${path}.focusMinutes`);
    if (focusMinutes !== BAD) result.focusMinutes = focusMinutes;
  }
  if (has(obj, 'coord')) {
    const coord = record(obj.coord, ['lat', 'lon'], ctx, `${path}.coord`);
    if (coord !== BAD) {
      const lat = required(coord, 'lat', number(-90, 90), ctx, `${path}.coord`);
      const lon = required(coord, 'lon', number(-180, 180), ctx, `${path}.coord`);
      if (lat !== BAD && lon !== BAD) result.coord = { lat, lon };
    }
  }
  return result;
}

function array(value, limit, parse, ctx, path) {
  if (!Array.isArray(value)) return invalid(ctx, path);
  if (value.length > limit) invalid(ctx, path);
  const result = [];
  for (let i = 0; i < Math.min(value.length, limit); i++) {
    if (!has(value, i)) {
      invalid(ctx, `${path}[${i}]`);
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!has(descriptor, 'value')) {
      invalid(ctx, `${path}[${i}]`);
      continue;
    }
    const parsed = parse(descriptor.value, ctx, `${path}[${i}]`);
    if (parsed !== BAD) result.push(parsed);
  }
  return result;
}

function uniqueById(value, ctx, path) {
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (seen.has(item.id)) {
      invalid(ctx, `${path}: duplicate id ${item.id}`);
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

const NOTE_KEYS = ['id', 'title', 'body', 'createdAt', 'updatedAt'];
const LINK_KEYS = ['id', 'title', 'url', 'createdAt'];
const HABIT_KEYS = ['id', 'name', 'icon', 'target', 'createdAt', 'log'];

function workspaceRecord(value, keys, ctx, path) {
  const obj = record(value, keys, ctx, path);
  if (obj === BAD) return BAD;
  if (Reflect.ownKeys(obj).some(key => !keys.includes(key))) return invalid(ctx, path);
  return obj;
}

function note(value, ctx, path) {
  const obj = workspaceRecord(value, NOTE_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const result = {
    id: required(obj, 'id', idNumber, ctx, path),
    title: required(obj, 'title', (v, c, p) =>
      validateWorkspaceTitle(v, TEXT_LIMITS.noteTitle) ? v : invalid(c, p), ctx, path),
    body: required(obj, 'body', (v, c, p) => validateNoteBody(v) ? v : invalid(c, p), ctx, path),
    createdAt: required(obj, 'createdAt', timestamp, ctx, path),
    updatedAt: required(obj, 'updatedAt', timestamp, ctx, path)
  };
  if (Object.values(result).includes(BAD)) return BAD;
  return result.updatedAt >= result.createdAt ? result : invalid(ctx, `${path}.updatedAt`);
}

function link(value, ctx, path) {
  const obj = workspaceRecord(value, LINK_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const result = {
    id: required(obj, 'id', idNumber, ctx, path),
    title: required(obj, 'title', (v, c, p) =>
      validateWorkspaceTitle(v, TEXT_LIMITS.linkTitle) ? v : invalid(c, p), ctx, path),
    url: required(obj, 'url', (v, c, p) => validateWorkspaceUrl(v) ? v : invalid(c, p), ctx, path),
    createdAt: required(obj, 'createdAt', timestamp, ctx, path)
  };
  return Object.values(result).includes(BAD) ? BAD : result;
}

function workspaceCollection(value, limit, parser, ctx, path) {
  const parsed = array(value, limit, parser, ctx, path);
  if (parsed === BAD) return BAD;
  const seen = new Set();
  return parsed.filter(item => {
    if (seen.has(item.id)) {
      invalid(ctx, `${path}: duplicate id ${item.id}`);
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/** Habit log: { 'YYYY-MM-DD': count }. Bounded so a corrupt file cannot grow without limit. */
function habitLog(value, ctx, path) {
  if (!plain(value)) return invalid(ctx, path);
  const entries = Object.entries(value);
  if (entries.length > HABIT_LIMITS.logDays) return invalid(ctx, path);
  const out = {};
  for (const [day, count] of entries) {
    if (!DATE_RE.test(day)) return invalid(ctx, `${path}.${day}`);
    const n = number(0, HABIT_LIMITS.target, true)(count, ctx, `${path}.${day}`);
    if (n === BAD) return BAD;
    if (n > 0) out[day] = n;
  }
  return out;
}

function habit(value, ctx, path) {
  const obj = workspaceRecord(value, HABIT_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  const result = {
    id: required(obj, 'id', idNumber, ctx, path),
    name: required(obj, 'name', (v, c, p) =>
      validateWorkspaceTitle(v, HABIT_LIMITS.name) ? v : invalid(c, p), ctx, path),
    icon: field(obj, 'icon', (v, c, p) =>
      typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : invalid(c, p), 'leaf', ctx, path),
    target: field(obj, 'target', number(1, HABIT_LIMITS.target, true), 1, ctx, path),
    createdAt: required(obj, 'createdAt', timestamp, ctx, path),
    log: field(obj, 'log', habitLog, {}, ctx, path)
  };
  return Object.values(result).includes(BAD) ? BAD : result;
}

/** Strict shared record/collection parsers for pure workspace operations. */
export function normalizeNote(value) { return note(value, { strict: true }, 'note'); }
export function normalizeLink(value) { return link(value, { strict: true }, 'link'); }
export function normalizeNotes(value) {
  return workspaceCollection(value, COLLECTION_LIMITS.notes, note, { strict: true }, 'notes');
}
export function normalizeLinks(value) {
  return workspaceCollection(value, COLLECTION_LIMITS.links, link, { strict: true }, 'links');
}

function todo(value, ctx, path) {
  const obj = record(value, ['id', 'text', 'done', 'date', 'time', 'timed', 'priority', 'tag',
    'completedAt'], ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', idNumber, ctx, path);
  const title = required(obj, 'text', text(TEXT_LIMITS.taskText), ctx, path);
  if (id === BAD || title === BAD) return BAD;
  const date = field(obj, 'date', optionalDate, '', ctx, path);
  const time = field(obj, 'time', pattern(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/), '', ctx, path);
  if (!date && time) {
    invalid(ctx, `${path}.time`);
  }
  const result = {
    id, text: title, done: field(obj, 'done', bool, false, ctx, path),
    date, time: date ? time : '',
    timed: field(obj, 'timed', bool, Boolean(time), ctx, path) && Boolean(date && time),
    priority: field(obj, 'priority', choice(['low', 'medium', 'high']), 'medium', ctx, path),
    tag: field(obj, 'tag', text(TEXT_LIMITS.taskTag), '个人计划', ctx, path)
  };
  if (has(obj, 'completedAt')) {
    const completedAt = timestamp(obj.completedAt, ctx, `${path}.completedAt`);
    if (completedAt !== BAD) result.completedAt = completedAt;
  }
  // Do not invent completion history for legacy tasks from their scheduled date or ID.
  return result;
}

function ledgerEntry(value, ctx, path) {
  const obj = record(value, ['id', 'type', 'amount', 'note', 'cat', 'date'], ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', idNumber, ctx, path);
  const type = required(obj, 'type', choice(['income', 'expense']), ctx, path);
  const amount = required(obj, 'amount', number(0.000001, 1_000_000_000), ctx, path);
  const date = required(obj, 'date', dateKey, ctx, path);
  if ([id, type, amount, date].includes(BAD)) return BAD;
  return { id, type, amount, date,
    note: field(obj, 'note', text(TEXT_LIMITS.ledgerNote), '记一笔', ctx, path),
    cat: field(obj, 'cat', text(TEXT_LIMITS.ledgerCategory, true), '', ctx, path) };
}

function waterEntry(value, ctx, path) {
  const obj = record(value, ['ml', 'time'], ctx, path);
  if (obj === BAD) return BAD;
  const ml = required(obj, 'ml', number(0.001, 100_000), ctx, path);
  if (ml === BAD) return BAD;
  const result = { ml };
  if (has(obj, 'time')) {
    const time = timestamp(obj.time, ctx, `${path}.time`);
    if (time !== BAD) result.time = time;
  }
  return result;
}

function datedMap(value, maxDays, parse, ctx, path) {
  if (!plain(value)) return invalid(ctx, path);
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length > maxDays) invalid(ctx, path);
  const result = {};
  for (const key of keys.slice(0, maxDays)) {
    if (!has(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      invalid(ctx, `${path}.${key}`);
      continue;
    }
    if (dateKey(key, ctx, `${path}.${key}`) === BAD) continue;
    const parsed = parse(value[key], ctx, `${path}.${key}`);
    if (parsed !== BAD) result[key] = parsed;
  }
  return result;
}

function waterMap(value, ctx, path) {
  let entries = 0;
  return datedMap(value, COLLECTION_LIMITS.datedMaps, (day, context, dayPath) => {
    const list = array(day, COLLECTION_LIMITS.waterPerDay, waterEntry, context, dayPath);
    if (list === BAD) return BAD;
    if (entries + list.length > COLLECTION_LIMITS.waterTotal) {
      invalid(context, dayPath);
      const available = Math.max(0, COLLECTION_LIMITS.waterTotal - entries);
      list.length = available;
    }
    entries += list.length;
    return list;
  }, ctx, path);
}

function sportEntry(value, ctx, path) {
  const obj = record(value, ['id', 'type', 'minutes', 'distance', 'date', 'startAt', 'weight'], ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', idNumber, ctx, path);
  const type = required(obj, 'type', choice(['run', 'walk', 'bike', 'swim', 'gym', 'yoga', 'ball', 'hike']), ctx, path);
  const minutes = required(obj, 'minutes', number(0, 1440), ctx, path);
  const date = required(obj, 'date', dateKey, ctx, path);
  if ([id, type, minutes, date].includes(BAD)) return BAD;
  const result = { id, type, minutes, distance: field(obj, 'distance', number(0, 100_000), 0, ctx, path), date };
  if (has(obj, 'startAt')) {
    const startAt = timestamp(obj.startAt, ctx, `${path}.startAt`);
    if (startAt !== BAD) result.startAt = startAt;
  }
  if (has(obj, 'weight')) {
    const weight = number(0, 1000)(obj.weight, ctx, `${path}.weight`);
    if (weight !== BAD) result.weight = weight;
  }
  return result;
}

function reminder(value, ctx, path) {
  const obj = record(value, ['id', 'kind', 'preset', 'icon', 'label', 'text', 'color', 'every',
    'minutes', 'startAt', 'nextAt', 'endAt', 'date', 'time', 'enabled', 'fired',
    'completed', 'pausedAt', 'remainingMs', 'taskId'], ctx, path);
  if (obj === BAD) return BAD;
  const id = required(obj, 'id', pattern(SLUG_RE), ctx, path);
  const kind = required(obj, 'kind', choice(['interval', 'daily', 'timer', 'once']), ctx, path);
  const label = required(obj, 'label', text(TEXT_LIMITS.reminderLabel), ctx, path);
  if ([id, kind, label].includes(BAD)) return BAD;
  const result = {
    id, kind, label,
    text: field(obj, 'text', text(TEXT_LIMITS.reminderText), label, ctx, path),
    icon: field(obj, 'icon', pattern(/^[a-zA-Z0-9_-]{1,32}$/), 'bell', ctx, path),
    enabled: field(obj, 'enabled', bool, true, ctx, path)
  };
  if (has(obj, 'preset')) result.preset = field(obj, 'preset', pattern(SLUG_RE), 'custom', ctx, path);
  if (has(obj, 'taskId')) {
    const linkedTask = taskId(obj.taskId, ctx, `${path}.taskId`);
    if (linkedTask !== BAD) result.taskId = linkedTask;
  }
  if (has(obj, 'color')) result.color = field(obj, 'color', pattern(COLOR_RE), '#7b8fa8', ctx, path);
  if (has(obj, 'fired')) result.fired = field(obj, 'fired', number(0, 1_000_000, true), 0, ctx, path);
  if (has(obj, 'completed')) result.completed = field(obj, 'completed', bool, false, ctx, path);
  if (kind === 'interval') {
    result.every = required(obj, 'every', number(1, 1440), ctx, path);
    result.startAt = required(obj, 'startAt', timestamp, ctx, path);
    result.nextAt = required(obj, 'nextAt', timestamp, ctx, path);
    if ([result.every, result.startAt, result.nextAt].includes(BAD)) return BAD;
  } else if (kind === 'timer') {
    result.minutes = required(obj, 'minutes', number(1, 1440), ctx, path);
    result.startAt = required(obj, 'startAt', timestamp, ctx, path);
    result.endAt = required(obj, 'endAt', timestamp, ctx, path);
    if ([result.minutes, result.startAt, result.endAt].includes(BAD)) return BAD;
  } else {
    result.time = required(obj, 'time', pattern(TIME_RE), ctx, path);
    result.nextAt = required(obj, 'nextAt', timestamp, ctx, path);
    if ([result.time, result.nextAt].includes(BAD)) return BAD;
    if (kind === 'once') {
      result.date = required(obj, 'date', dateKey, ctx, path);
      if (result.date === BAD) return BAD;
    }
  }
  if (has(obj, 'pausedAt') !== has(obj, 'remainingMs') ||
      (has(obj, 'completed') && result.completed && result.enabled)) {
    return invalid(ctx, path);
  }
  if (has(obj, 'pausedAt')) {
    const maxPauseMs = kind === 'interval' ? result.every * 60_000 :
      kind === 'timer' ? result.minutes * 60_000 :
      kind === 'daily' ? 90_000_000 : MAX_TIMESTAMP;
    result.pausedAt = timestamp(obj.pausedAt, ctx, `${path}.pausedAt`);
    result.remainingMs = number(1, maxPauseMs, true)(obj.remainingMs, ctx, `${path}.remainingMs`);
    if ([result.pausedAt, result.remainingMs].includes(BAD) || result.enabled || result.completed) {
      return invalid(ctx, path);
    }
  }
  // Other known fields from an old reminder kind are intentionally discarded.
  return result;
}

const PENDING_ALERT_KEYS = ['sourceKind', 'sourceId', 'label', 'text', 'icon', 'dueAt',
  'snoozedUntil', 'taskId'];

function pendingAlert(value, ctx, path) {
  const obj = record(value, PENDING_ALERT_KEYS, ctx, path);
  if (obj === BAD) return BAD;
  if (Object.getOwnPropertyNames(obj).some(key => !PENDING_ALERT_KEYS.includes(key))) {
    return invalid(ctx, path);
  }
  const result = {
    sourceKind: required(obj, 'sourceKind', choice(['reminder', 'focus']), ctx, path),
    sourceId: required(obj, 'sourceId', pattern(SLUG_RE), ctx, path),
    label: required(obj, 'label', text(TEXT_LIMITS.reminderLabel), ctx, path),
    text: required(obj, 'text', text(TEXT_LIMITS.reminderText), ctx, path),
    icon: required(obj, 'icon', pattern(/^[a-zA-Z0-9_-]{1,32}$/), ctx, path),
    dueAt: required(obj, 'dueAt', timestamp, ctx, path),
    snoozedUntil: required(obj, 'snoozedUntil', nullableTimestamp, ctx, path)
  };
  if (Object.values(result).includes(BAD)) return BAD;
  if (result.sourceKind === 'focus' && result.sourceId !== 'focus') {
    return invalid(ctx, `${path}.sourceId`);
  }
  if (has(obj, 'taskId')) {
    // Link damage must not erase an otherwise valid attention record. Only focus alerts
    // may carry task identity; strict import rejects bad or misplaced metadata.
    const linkedTask = result.sourceKind === 'focus'
      ? idNumber(obj.taskId, ctx, `${path}.taskId`) : invalid(ctx, `${path}.taskId`);
    if (linkedTask !== BAD) result.taskId = linkedTask;
  }
  return result;
}

/** Shared strict validator for a live alert; unlike persisted records, a new alert may omit snooze. */
export function normalizePendingAlert(value) {
  const ctx = { strict: true };
  const obj = record(value, PENDING_ALERT_KEYS, ctx, 'pendingAlert');
  return pendingAlert(has(obj, 'snoozedUntil') ? obj : { ...obj, snoozedUntil: null },
    ctx, 'pendingAlert');
}

function pendingAlerts(value, ctx, path) {
  const parsed = array(value, COLLECTION_LIMITS.pendingAlerts, pendingAlert, ctx, path);
  if (parsed === BAD) return BAD;
  const seen = new Set();
  const result = [];
  for (const alert of parsed) {
    const source = `${alert.sourceKind}:${alert.sourceId}`;
    if (seen.has(source)) {
      invalid(ctx, `${path}: duplicate source ${source}`);
      continue;
    }
    seen.add(source);
    result.push(alert);
  }
  // Recovery keeps the first valid source in stored order; import rejects duplicates.
  return result;
}

function pet(value, ctx, path) {
  const obj = record(value, ['name', 'img'], ctx, path);
  if (obj === BAD) return BAD;
  return {
    name: field(obj, 'name', text(TEXT_LIMITS.petName), '青柠', ctx, path),
    img: field(obj, 'img', pattern(ASSET_RE), 'lemon.png', ctx, path)
  };
}

function focus(value, ctx, path) {
  const obj = record(value, ['total', 'remaining', 'running', 'dueAt', 'lastCreditedAt',
    'text', 'taskId', 'creditRemainders'], ctx, path);
  if (obj === BAD) return BAD;
  const parseField = (key, parser, fallback) =>
    has(obj, key) ? parser(obj[key], ctx, `${path}.${key}`) : fallback;
  const result = {
    total: parseField('total', number(1, 86_400, true), 1500),
    // Fractional seconds preserve time left when paused between timer ticks.
    remaining: parseField('remaining', number(0, 86_400), 1500),
    running: parseField('running', bool, false),
    dueAt: parseField('dueAt', nullableTimestamp, null),
    lastCreditedAt: parseField('lastCreditedAt', nullableTimestamp, null),
    text: parseField('text', text(TEXT_LIMITS.focusText, true), ''),
    // Repair invalid links independently; never discard a legal running timer for link damage.
    taskId: field(obj, 'taskId', nullableTaskId, null, ctx, path),
    creditRemainders: parseField('creditRemainders', (v, c, p) =>
      datedMap(v, COLLECTION_LIMITS.datedMaps, number(0, 999, true), c, p), {})
  };
  if (Object.values(result).includes(BAD) || result.remaining > result.total ||
      (result.running && result.dueAt === null)) {
    return invalid(ctx, path);
  }
  return result;
}

/**
 * Normalize an already-parsed state. Default: repair stored data by dropping malformed entries
 * and replacing invalid fields with defaults. { strict: true } rejects on the first invalid field.
 * Both modes migrate unversioned/version-1/version-2/version-3/version-4 states to the current version-6 shape.
 */
export function normalizeState(raw, { strict = false } = {}) {
  const ctx = { strict };
  const obj = record(raw, ROOT_KEYS, ctx, 'state');
  if (obj === BAD) return defaultState();
  if (has(obj, 'version') && !SUPPORTED_STATE_VERSIONS.includes(obj.version)) {
    invalid(ctx, 'state.version');
    return defaultState();
  }
  if (strict && !ROOT_KEYS.some(key => key !== 'version' && has(obj, key))) {
    throw new Error('Invalid backup: no state data');
  }
  const result = defaultState();
  result.settings = field(obj, 'settings', settings, result.settings, ctx, 'state');
  result.todos = field(obj, 'todos', (v, c, p) => array(v, COLLECTION_LIMITS.todos, todo, c, p), [], ctx, 'state');
  result.ledger = field(obj, 'ledger', (v, c, p) => array(v, COLLECTION_LIMITS.ledger, ledgerEntry, c, p), [], ctx, 'state');
  result.water = field(obj, 'water', waterMap, {}, ctx, 'state');
  result.steps = field(obj, 'steps', (v, c, p) => datedMap(v, COLLECTION_LIMITS.datedMaps, number(0, 100_000_000, true), c, p), {}, ctx, 'state');
  result.study = field(obj, 'study', (v, c, p) => datedMap(v, COLLECTION_LIMITS.datedMaps, number(0, 100_000_000, true), c, p), {}, ctx, 'state');
  result.sport = field(obj, 'sport', (v, c, p) => array(v, COLLECTION_LIMITS.sport, sportEntry, c, p), [], ctx, 'state');
  result.reminders = field(obj, 'reminders', (v, c, p) => {
    const parsed = array(v, COLLECTION_LIMITS.reminders, reminder, c, p);
    return parsed === BAD ? BAD : uniqueById(parsed, c, p);
  }, [], ctx, 'state');
  result.pendingAlerts = field(obj, 'pendingAlerts', pendingAlerts, [], ctx, 'state');
  result.notes = field(obj, 'notes', (v, c, p) =>
    workspaceCollection(v, COLLECTION_LIMITS.notes, note, c, p), [], ctx, 'state');
  result.links = field(obj, 'links', (v, c, p) =>
    workspaceCollection(v, COLLECTION_LIMITS.links, link, c, p), [], ctx, 'state');
  result.habits = field(obj, 'habits', (v, c, p) =>
    workspaceCollection(v, COLLECTION_LIMITS.habits, habit, c, p), [], ctx, 'state');
  result.notifOn = field(obj, 'notifOn', bool, false, ctx, 'state');
  result.soundOn = field(obj, 'soundOn', bool, true, ctx, 'state');
  result.earnedTotal = field(obj, 'earnedTotal', number(0, 1_000_000_000_000), 0, ctx, 'state');
  result.pet = field(obj, 'pet', pet, result.pet, ctx, 'state');
  result.focus = field(obj, 'focus', focus, result.focus, ctx, 'state');
  return result;
}

/** Invalid/missing localStorage is recoverable: return fresh defaults without writing/deleting it. */
export function parseStoredState(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BACKUP_CHARS) return defaultState();
  try {
    return normalizeState(JSON.parse(text));
  } catch {
    return defaultState();
  }
}

/** Strict import: throw on malformed/oversized/unsupported data; caller must not replace state on error. */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BACKUP_CHARS) {
    throw new Error('Invalid backup: file size');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Invalid backup: JSON');
  }
  return normalizeState(raw, { strict: true });
}
