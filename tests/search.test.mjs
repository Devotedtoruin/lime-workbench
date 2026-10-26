import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAll, KIND_LABELS } from '../js/search.js';

const state = {
  todos: [
    { id: 1, text: '提交周报', done: false, date: '2026-10-18', time: '18:00', tag: '文档' },
    { id: 2, text: '完成 Q4 复盘', done: true, date: '2026-10-17', time: '', tag: '项目' },
    { id: 3, text: '买菜', done: false, date: '', time: '', tag: '生活' }
  ],
  notes: [
    { id: 11, title: '周会要点', body: '下周一灰度，周四评审' },
    { id: 12, title: '灵感', body: '可以加一个专注热力图' }
  ],
  ledger: [
    { id: 21, type: 'expense', amount: 45.5, note: '打印周报', cat: '🔌 日用', date: '2026-10-15' },
    { id: 22, type: 'income', amount: 1200, note: '项目奖金', cat: '💼 收入', date: '2026-10-02' }
  ],
  reminders: [
    { id: 31, label: '喝水', text: '该喝水啦', enabled: true },
    { id: 32, label: '护眼', text: '看远处', enabled: false }
  ],
  links: [
    { id: 41, title: '项目文档', url: 'https://example.com/docs' }
  ],
  sport: [
    { id: 51, type: 'run', minutes: 32, date: '2026-10-17' }
  ]
};

const opts = { today: '2026-10-18' };

test('empty or whitespace query returns nothing', () => {
  assert.deepEqual(searchAll('', state, opts), []);
  assert.deepEqual(searchAll('   ', state, opts), []);
  assert.deepEqual(searchAll(null, state, opts), []);
});

test('searches task text and tag, case-insensitively', () => {
  const byText = searchAll('周报', state, opts);
  assert.ok(byText.some(r => r.kind === 'task' && r.title === '提交周报'));
  const byTag = searchAll('文档', state, opts);
  assert.ok(byTag.some(r => r.kind === 'task' && r.title === '提交周报'));
  assert.equal(searchAll('Q4', state, opts).length > 0, true);
  assert.equal(searchAll('q4', state, opts).length > 0, true);
});

test('searches note body, not just the title', () => {
  const hits = searchAll('灰度', state, opts);
  const note = hits.find(r => r.kind === 'note');
  assert.ok(note, 'body match must surface the note');
  assert.equal(note.title, '周会要点');
  assert.match(note.meta, /灰度/);
});

test('ledger results carry the signed amount and date', () => {
  const [expense] = searchAll('打印周报', state, opts).filter(r => r.kind === 'ledger');
  assert.equal(expense.meta, '-¥45.50 · 2026-10-15');
  const [income] = searchAll('项目奖金', state, opts).filter(r => r.kind === 'ledger');
  assert.equal(income.meta, '+¥1200.00 · 2026-10-02');
});

test('reminders, links and sport records are searchable', () => {
  assert.ok(searchAll('喝水', state, opts).some(r => r.kind === 'reminder'));
  assert.ok(searchAll('example.com', state, opts).some(r => r.kind === 'link'));
  assert.ok(searchAll('run', state, opts).some(r => r.kind === 'sport'));
});

test('results are grouped with tasks first and carry a destination page', () => {
  const hits = searchAll('周', state, opts);
  const kinds = hits.map(r => r.kind);
  const firstTask = kinds.indexOf('task');
  const firstOther = kinds.findIndex(k => k !== 'task');
  if (firstTask >= 0 && firstOther >= 0) assert.ok(firstTask < firstOther);
  for (const hit of hits) assert.ok(hit.page, `${hit.kind} must name a page`);
});

test('per-kind results are capped so the palette stays readable', () => {
  const many = {
    ...state,
    todos: Array.from({ length: 40 }, (_, i) => ({
      id: 100 + i, text: `任务 ${i}`, done: false, date: '', time: '', tag: ''
    }))
  };
  const hits = searchAll('任务', many, opts).filter(r => r.kind === 'task');
  assert.equal(hits.length, 5);
});

test('today dates render as 今天, other dates as month-day', () => {
  const today = searchAll('提交周报', state, opts).find(r => r.kind === 'task');
  assert.match(today.meta, /今天/);
  const past = searchAll('Q4', state, opts).find(r => r.kind === 'task');
  assert.match(past.meta, /10-17/);
});

test('long bodies are clipped rather than dumped into the palette', () => {
  const long = { ...state, notes: [{ id: 99, title: '长文', body: '关键词' + 'x'.repeat(500) }] };
  const [hit] = searchAll('关键词', long, opts);
  assert.ok([...hit.meta].length <= 61, 'snippet must stay bounded');
});

test('every kind has a display label', () => {
  for (const kind of ['task', 'note', 'ledger', 'reminder', 'link', 'sport']) {
    assert.ok(KIND_LABELS[kind], `${kind} needs a label`);
  }
});
