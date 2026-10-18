// Pure focus clock. Persist the returned session and apply each dayCredits delta together,
// exactly once. No timers, storage, notifications or implicit wall-clock reads live here.
import { todayKey } from './core.js';

const durationMs = session => Math.max(0, Math.min(session.total, session.remaining) * 1000);

function checkNow(now) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
    throw new RangeError('Focus now must be an epoch timestamp in milliseconds');
  }
}

function copySession(session) {
  return { ...session, text: session.text ?? '', taskId: session.taskId ?? null,
    creditRemainders: { ...session.creditRemainders } };
}

/** Display seconds only. Never save this rounded value back into the session. */
export function remainingFocus(session, now) {
  checkNow(now);
  const remaining = durationMs(session);
  return Math.ceil((session.running && session.dueAt !== null
    ? Math.min(remaining, Math.max(0, session.dueAt - now)) : remaining) / 1000);
}

function creditInterval(from, to, remainders, dayCredits) {
  while (from < to) {
    const localDate = new Date(from);
    const day = todayKey(localDate);
    // Calendar arithmetic, not +24h: local DST days can have 23 or 25 hours.
    const nextMidnight = new Date(localDate);
    nextMidnight.setHours(24, 0, 0, 0);
    const end = Math.min(to, nextMidnight.getTime());
    const milliseconds = (remainders[day] || 0) + end - from;
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds) dayCredits[day] = (dayCredits[day] || 0) + seconds;
    const remainder = milliseconds % 1000;
    if (remainder) remainders[day] = remainder;
    else delete remainders[day];
    from = end;
  }
}

/**
 * Settle a validated session up to now, capped at its dueAt and saved remaining.
 * Missing legacy lastCreditedAt uses dueAt - remaining; it never guesses a full total.
 * dayCredits is { localDayKey: wholeSeconds }; per-day millisecond carry is persisted
 * in creditRemainders. completed is true only on the running -> completed transition.
 * completionContext snapshots { dueAt, text, taskId } from that expired INPUT round,
 * or is null when no transition occurred. Start/pause/reset retain the snapshot even
 * if their returned session has a new deadline, so callers never attribute A's expiry to B.
 */
export function settleFocus(session, now) {
  checkNow(now);
  const next = copySession(session);
  const dayCredits = {};
  if (!session.running || session.dueAt === null) {
    return { session: next, dayCredits, completed: false, completionContext: null };
  }

  const remaining = Math.round(durationMs(session));
  const start = Math.max(0, session.dueAt - remaining, session.lastCreditedAt ?? 0);
  const end = Math.min(now, session.dueAt);
  if (end > start) creditInterval(start, end, next.creditRemainders, dayCredits);

  // A backwards wall-clock adjustment must not rewind either the credit cursor or
  // the countdown. Subsequent settlement resumes only after the cursor is reached.
  next.remaining = Math.min(remaining, Math.max(0, session.dueAt - now)) / 1000;
  next.lastCreditedAt = Math.max(session.lastCreditedAt ?? start, end);
  const completed = now >= session.dueAt;
  const completionContext = completed
    ? { dueAt: session.dueAt, text: session.text ?? '', taskId: session.taskId ?? null } : null;
  if (completed) {
    next.remaining = 0;
    next.running = false;
    next.dueAt = null;
    next.lastCreditedAt = null;
  }
  return { session: next, dayCredits, completed, completionContext };
}

/** Start/resume, or start a new round if the previous one completed. */
export function startFocus(session, now) {
  const result = settleFocus(session, now);
  const next = result.session;
  if (!next.running) {
    if (next.remaining <= 0) next.remaining = next.total;
    next.running = true;
    next.dueAt = now + Math.round(durationMs(next));
    next.lastCreditedAt = now;
  }
  return result;
}

/** Pausing must settle first; fractional remaining seconds survive pause/resume. */
export function pauseFocus(session, now) {
  const result = settleFocus(session, now);
  result.session.running = false;
  result.session.dueAt = null;
  result.session.lastCreditedAt = null;
  return result;
}

/** Reset/change duration after settlement. Keep task identity/text and per-day credit carry. */
export function resetFocus(session, now, total = session.total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > 86_400) {
    throw new RangeError('Focus total must be between 1 and 86400 seconds');
  }
  const result = pauseFocus(session, now);
  result.session.total = total;
  result.session.remaining = total;
  return result;
}
