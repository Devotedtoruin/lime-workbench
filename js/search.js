// Global search across everything the workbench stores.
//
// Kept as a pure function over the state object so it can be unit-tested without a browser,
// and so the palette only has to render results rather than know where anything lives.
//
// Matching rules, deliberately simple and predictable:
//   - literal substring, case-insensitive, trimmed. No fuzzy matching: a user typing "周报"
//     expects the task called 周报, not five items that happen to share those letters.
//   - results are grouped by kind and capped per group, because an unbounded list in a
//     palette makes the palette useless.
//   - a query shorter than one character returns nothing; the palette shows shortcuts instead.

const LIMIT_PER_KIND = 5;
const SNIPPET = 60;

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function has(haystack, needle) {
  return lower(haystack).includes(needle);
}

function clip(text, at = SNIPPET) {
  const chars = [...String(text || '')];
  return chars.length > at ? `${chars.slice(0, at).join('')}…` : chars.join('');
}

/**
 * @param {string} query raw user input
 * @param {object} state  the v5 business state
 * @param {object} opts   { today: 'YYYY-MM-DD' }
 * @returns {{ kind: string, id: string, title: string, meta: string, page: string, action?: object }[]}
 */
export function searchAll(query, state, opts = {}) {
  const q = lower(query).trim();
  if (!q) return [];
  const today = opts.today || '';
  const out = [];

  // Tasks — title and tag. The date stays visible even for finished tasks: knowing a task is
  // done is not the same as knowing when it was for, and the meta line is the only place
  // the palette can show it.
  for (const task of state.todos || []) {
    if (!has(task.text, q) && !has(task.tag, q)) continue;
    const when = task.date ? (task.date === today ? '今天' : task.date.slice(5)) : '随时';
    out.push({
      kind: 'task',
      id: `task-${task.id}`,
      title: clip(task.text, 80),
      meta: [
        task.done ? `已完成 · ${when}` : when,
        task.time || '',
        task.tag || ''
      ].filter(Boolean).join(' · '),
      page: 'todo'
    });
  }

  // Notes — title and body; the body snippet is what makes notes findable at all.
  for (const note of state.notes || []) {
    if (!has(note.title, q) && !has(note.body, q)) continue;
    const bodyHit = has(note.body, q);
    out.push({
      kind: 'note',
      id: `note-${note.id}`,
      title: clip(note.title || '（无标题）', 80),
      meta: bodyHit ? clip(note.body) : '工作便签',
      page: 'home'
    });
  }

  // Ledger — note and category. Amount is not searched as free text; it is a number.
  for (const entry of state.ledger || []) {
    if (!has(entry.note, q) && !has(entry.cat, q)) continue;
    const sign = entry.type === 'income' ? '+' : '-';
    out.push({
      kind: 'ledger',
      id: `ledger-${entry.id}`,
      title: clip(entry.note || entry.cat || '记账', 80),
      meta: `${sign}¥${Number(entry.amount || 0).toFixed(2)} · ${entry.date || ''}`,
      page: 'ledger'
    });
  }

  // Reminders.
  for (const reminder of state.reminders || []) {
    if (!has(reminder.label, q) && !has(reminder.text, q)) continue;
    out.push({
      kind: 'reminder',
      id: `reminder-${reminder.id}`,
      title: clip(reminder.label || reminder.text, 80),
      meta: reminder.enabled === false ? '已暂停' : '提醒',
      page: 'calendar'
    });
  }

  // Sport records.
  for (const record of state.sport || []) {
    if (!has(record.type, q)) continue;
    out.push({
      kind: 'sport',
      id: `sport-${record.id}`,
      title: `${record.type} ${record.minutes} 分钟`,
      meta: record.date || '',
      page: 'sport'
    });
  }

  // Links.
  for (const link of state.links || []) {
    if (!has(link.title, q) && !has(link.url, q)) continue;
    out.push({
      kind: 'link',
      id: `link-${link.id}`,
      title: clip(link.title || link.url, 80),
      meta: clip(link.url, 50),
      page: 'home'
    });
  }

  return groupCap(out, LIMIT_PER_KIND);
}

const KIND_ORDER = ['task', 'note', 'ledger', 'reminder', 'link', 'sport'];

function groupCap(items, limit) {
  const counts = new Map();
  const kept = [];
  for (const item of items) {
    const n = counts.get(item.kind) || 0;
    if (n >= limit) continue;
    counts.set(item.kind, n + 1);
    kept.push(item);
  }
  // Stable, meaningful order: tasks first (the most common thing to look for), then the rest.
  kept.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return kept;
}

export const KIND_LABELS = Object.freeze({
  task: '任务',
  note: '便签',
  ledger: '账目',
  reminder: '提醒',
  link: '链接',
  sport: '运动'
});
