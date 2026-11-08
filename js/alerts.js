// Persistent attention queue. Pure functions only: callers decide when to save or notify.
import { COLLECTION_LIMITS, normalizePendingAlert, validateText, TEXT_LIMITS } from './state.js';

export const MAX_PENDING_ALERTS = COLLECTION_LIMITS.pendingAlerts;
const MAX_TIMESTAMP = Date.UTC(2101, 0, 1);
const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ICON_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const sourceKey = (kind, id) => `${kind}:${id}`;
const matches = (alert, kind, id) => alert.sourceKind === kind && alert.sourceId === id;
const validTimestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
const validSlug = (value, re) => {
  const match = typeof value === 'string' && re.exec(value);
  return Boolean(match && match[0].length === value.length);
};

function checkNow(now) {
  if (!validTimestamp(now)) throw new RangeError('Invalid alert timestamp');
  return now;
}

function checkSource(sourceKind, sourceId) {
  if (!['reminder', 'focus'].includes(sourceKind) || !validSlug(sourceId, SLUG_RE) ||
      (sourceKind === 'focus' && sourceId !== 'focus')) {
    throw new TypeError('Invalid alert source');
  }
}

function checkList(list) {
  if (!Array.isArray(list)) throw new TypeError('Invalid pending alerts');
  if (list.length > MAX_PENDING_ALERTS) throw new RangeError('Pending alert capacity exceeded');
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(list, i);
    if (!descriptor || !has(descriptor, 'value')) throw new TypeError('Invalid pending alert record');
    const alert = normalizePendingAlert(descriptor.value);
    // Omitting snoozedUntil is convenient only for a newly emitted alert, not stored queue records.
    if (!has(descriptor.value, 'snoozedUntil')) throw new TypeError('Invalid pending alert snooze');
    const key = sourceKey(alert.sourceKind, alert.sourceId);
    if (seen.has(key)) throw new TypeError('Duplicate pending alert source');
    seen.add(key);
  }
  return list;
}

/** Add/update one source without dropping other simultaneous alerts or an active snooze. */
export function upsertAlert(list, alert, now) {
  checkList(list);
  checkNow(now);
  const next = normalizePendingAlert(alert);
  const index = list.findIndex(item => matches(item, next.sourceKind, next.sourceId));
  if (index === -1) {
    if (list.length === MAX_PENDING_ALERTS) throw new RangeError('Pending alert capacity exceeded');
    return [...list, next];
  }
  const previous = list[index];
  if (previous.snoozedUntil !== null && previous.snoozedUntil > now) {
    next.snoozedUntil = previous.snoozedUntil;
  }
  const result = list.slice();
  result[index] = next;
  return result;
}

/** Acknowledge only this source. Recurring reminder schedules are intentionally untouched. */
export function ackAlert(list, sourceKind, sourceId) {
  checkList(list);
  checkSource(sourceKind, sourceId);
  return list.filter(alert => !matches(alert, sourceKind, sourceId));
}

/** Source deletion/reset uses the same removal rule as acknowledgement. */
export const removeSourceAlerts = ackAlert;

/** Delay attention, not the underlying schedule. At the deadline it becomes visible again. */
export function snoozeAlert(list, sourceKind, sourceId, now, minutes = 5) {
  checkList(list);
  checkSource(sourceKind, sourceId);
  checkNow(now);
  const snoozedUntil = now + minutes * 60_000;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440 ||
      !validTimestamp(snoozedUntil)) throw new RangeError('Invalid snooze duration');
  return list.map(alert => matches(alert, sourceKind, sourceId) ? { ...alert, snoozedUntil } : alert);
}

/** Reading/clock ticks never mutate or expire persisted snooze fields. */
export function visibleAlerts(list, now) {
  checkList(list);
  checkNow(now);
  return list.filter(alert => alert.dueAt <= now &&
    (alert.snoozedUntil === null || alert.snoozedUntil <= now));
}

/**
 * Earliest active schedule or future attention-snooze deadline. Unscanned overdue schedules
 * remain candidates (the UI clamps their countdown to zero); already queued past occurrences
 * do not pretend to be future events. Ties keep reminder/list order stable.
 */
/** All upcoming sources, earliest first and one entry per source (stable on ties). */
export function upcomingEntries(reminders, alerts, now) {
  if (!Array.isArray(reminders)) throw new TypeError('Invalid reminders');
  checkList(alerts);
  checkNow(now);
  const pendingBySource = new Map(alerts.map(alert =>
    [sourceKey(alert.sourceKind, alert.sourceId), alert]));
  const bySource = new Map();
  let order = 0;
  const select = next => {
    const key = sourceKey(next.sourceKind, next.sourceId);
    const current = bySource.get(key);
    if (!current || next.dueAt < current.item.dueAt) bySource.set(key, { item: next, order: current?.order ?? order++ });
  };
  for (const reminder of reminders) {
    if (!reminder || reminder.enabled !== true || reminder.completed) continue;
    if (!['interval', 'daily', 'timer', 'once'].includes(reminder.kind) ||
        !validSlug(reminder.id, SLUG_RE) || !validateText(reminder.label, TEXT_LIMITS.reminderLabel)) continue;
    const dueAt = reminder.kind === 'timer' ? reminder.endAt : reminder.nextAt;
    if (!validTimestamp(dueAt)) continue;
    const pending = pendingBySource.get(sourceKey('reminder', reminder.id));
    if (dueAt <= now && pending && pending.dueAt >= dueAt) continue;
    select({ sourceKind: 'reminder', sourceId: reminder.id, label: reminder.label, dueAt,
      icon: validSlug(reminder.icon, ICON_RE) ? reminder.icon : 'bell', isSnoozed: false });
  }
  for (const alert of alerts) {
    if (alert.snoozedUntil === null || alert.snoozedUntil <= now) continue;
    select({ sourceKind: alert.sourceKind, sourceId: alert.sourceId, label: alert.label,
      dueAt: alert.snoozedUntil, icon: alert.icon, isSnoozed: true });
  }
  return [...bySource.values()].sort((a, b) => a.item.dueAt - b.item.dueAt || a.order - b.order)
    .map(entry => entry.item);
}

export function upcomingList(reminders, alerts, now, limit = 5) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid limit');
  return upcomingEntries(reminders, alerts, now).slice(0, limit);
}

export function nextUpcoming(reminders, alerts, now) {
  return upcomingList(reminders, alerts, now, 1)[0] ?? null;
}
