import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertNote, deleteNote, upsertLink, deleteLink, moveLink, reorderLink, normalizeWorkspaceUrl,
  selectWorkspaceView, previewNoteBody, WORKSPACE_VIEW_LIMITS
} from '../js/workspace.js';
import { defaultState, parseBackup, TEXT_LIMITS, COLLECTION_LIMITS } from '../js/state.js';

const NOW = Date.UTC(2026, 9, 13, 10);
const note = (id, patch = {}) => ({ id, title: '便签', body: '第一行\n\t第二行',
  createdAt: NOW - 1000, updatedAt: NOW, ...patch });
const link = (id, patch = {}) => ({ id, title: '链接', url: 'https://example.com/',
  createdAt: NOW - 1000, ...patch });
const invalid = operation => assert.throws(operation, error => error.code === 'WORKSPACE_INVALID');
const frozen = list => Object.freeze(list.map(record => Object.freeze(record)));

test('upsertNote creates independent notes with predictable timestamps and a nonempty default title', () => {
  const before = frozen([]);
  const input = Object.freeze({ title: '', body: '段落一\n\t段落二 <script>safe data</script>' });
  const next = upsertNote(before, input, NOW);
  assert.deepEqual(next, [{ id: NOW, title: '未命名便签', body: input.body,
    createdAt: NOW, updatedAt: NOW }]);
  assert.deepEqual(before, []);
  assert.equal(input.title, '');
  assert.deepEqual(upsertNote([], {}, 0), [{ id: 1, title: '未命名便签', body: '', createdAt: 0, updatedAt: 0 }]);
  assert.equal(upsertNote([], { title: '   ' }, NOW)[0].title, '未命名便签');
});

test('upsertNote edits in place, preserving id, creation and order without mutating old records', () => {
  const before = frozen([note(7), note(2)]);
  const next = upsertNote(before, Object.freeze({ id: 7, title: '更新', body: 'body\nline' }), NOW + 500);
  assert.deepEqual(next.map(item => item.id), [7, 2]);
  assert.deepEqual(next[0], { ...note(7), title: '更新', body: 'body\nline', updatedAt: NOW + 500 });
  assert.deepEqual(before[0], note(7));
  assert.notEqual(next, before); assert.notEqual(next[1], before[1]);
  assert.equal(upsertNote(before, { id: 7, body: '' }, NOW + 1000)[0].title, '便签');
  assert.equal(upsertNote(before, { id: 7 }, NOW - 5000)[0].updatedAt, NOW);
  const collision = upsertNote(frozen([note(NOW), note(NOW + 1)]), { title: '新增' }, NOW);
  assert.equal(collision[2].id, NOW + 2);
  assert.equal(upsertNote([], { id: 42, title: '指定编号' }, NOW)[0].id, 42);
});

test('note deletion preserves remaining order and never mutates the original list', () => {
  const before = frozen([note(8), note(3), note(5)]);
  assert.deepEqual(deleteNote(before, 3), [note(8), note(5)]);
  assert.equal(before.length, 3);
  invalid(() => deleteNote(before, 99));
  invalid(() => deleteNote(before, '3'));
});

test('note helpers enforce shared title/body bounds without accepting controls or unsafe shapes', () => {
  const exact = upsertNote([], { title: 'x'.repeat(TEXT_LIMITS.noteTitle),
    body: 'x'.repeat(TEXT_LIMITS.noteBody) }, NOW);
  assert.equal(exact[0].body.length, 5000);
  for (const input of [{ title: 'x'.repeat(121) }, { body: 'x'.repeat(5001) },
    { title: '\n' }, { title: 'a\tb' }, { body: 'bad\r' }, { body: 'bad\u0000' },
    { body: 'bad\u007f' }, { body: 'bad‮' }, { title: 'bad‎' },
    { body: null }, { id: -1 }, { id: 1.2 }, { createdAt: -1 }, { updatedAt: 'now' },
    { extra: 'reject' }, null, [], Object.assign(Object.create({ inherited: true }), { title: 'x' })]) {
    invalid(() => upsertNote([], input, NOW));
  }
  for (const now of [-1, NOW + 0.5, Infinity, 'now', Number.MAX_SAFE_INTEGER]) {
    invalid(() => upsertNote([], {}, now));
  }
  const getter = {};
  Object.defineProperty(getter, 'body', { get() { throw new Error('getter ran'); } });
  invalid(() => upsertNote([], getter, NOW));
  invalid(() => upsertNote([], { [Symbol('extra')]: true }, NOW));
  invalid(() => upsertNote([], JSON.parse('{"__proto__":{"poison":true}}'), NOW));
  assert.equal({}.poison, undefined);
});

test('note capacity allows update/delete but refuses additions, invalid list rows and duplicate IDs', () => {
  const before = frozen(Array.from({ length: COLLECTION_LIMITS.notes }, (_, i) => note(i + 1)));
  invalid(() => upsertNote(before, { body: 'overflow' }, NOW));
  assert.equal(upsertNote(before, { id: 1, body: 'edited' }, NOW).length, 100);
  assert.equal(deleteNote(before, 1).length, 99);
  invalid(() => upsertNote([note(1), note(1)], {}, NOW));
  invalid(() => deleteNote([{ ...note(1), unknown: true }], 1));
  const sparse = [note(1)]; sparse.length = 2;
  invalid(() => upsertNote(sparse, {}, NOW));
});

test('URL normalization supports ordinary, bare, Unicode, localhost and private HTTP hosts', () => {
  const cases = [
    [' example.com ', 'https://example.com/'],
    ['EXAMPLE.com/path?q=1#notes', 'https://example.com/path?q=1#notes'],
    ['//example.com/path', 'https://example.com/path'],
    ['https://例子.测试/', new URL('https://例子.测试/').href],
    ['http://localhost:5173/notes', 'http://localhost:5173/notes'],
    ['localhost:5173/notes', 'https://localhost:5173/notes'],
    ['127.0.0.1:8080', 'https://127.0.0.1:8080/'],
    ['http://192.168.1.3/', 'http://192.168.1.3/'],
    ['http://intranet/', 'http://intranet/'],
    ['http://[::1]:5173/', 'http://[::1]:5173/']
  ];
  for (const [raw, expected] of cases) assert.equal(normalizeWorkspaceUrl(raw), expected, raw);
});

test('URL normalization rejects non-web schemes, credentials, controls, parser tricks and expansion overflow', () => {
  for (const raw of ['', '  ', null, 1, {}, 'javascript:alert(1)', 'JaVaScRiPt:1',
    'data:text/html,x', 'file:///c:/private', 'mailto:user@example.com', 'ftp://example.com',
    'https:example.com', 'https://', 'https://user:pass@example.com/', 'https://user@example.com/',
    'https://@example.com/', 'https://example.com/ bad', 'https://example.com/\npath',
    '\thttps://example.com/', 'https://example.com/\u0000', 'https://example.com/‮',
    'https://example.com/‎', 'https://example.com\\@attacker.com',
    'https://example.com/' + 'a'.repeat(2000),
    'https://example.com/' + '汉'.repeat(300)]) {
    invalid(() => normalizeWorkspaceUrl(raw));
  }
  const prefix = 'https://example.com/';
  const exact = prefix + 'a'.repeat(TEXT_LIMITS.linkUrl - prefix.length);
  assert.equal(normalizeWorkspaceUrl(exact), exact);
});

test('upsertLink normalizes URL, assigns a default hostname title, and preserves existing identity/order', () => {
  const input = Object.freeze({ title: '', url: 'example.com/docs' });
  const created = upsertLink(frozen([]), input, NOW);
  assert.deepEqual(created, [{ id: NOW, title: 'example.com', url: 'https://example.com/docs', createdAt: NOW }]);
  assert.equal(input.url, 'example.com/docs');
  const before = frozen([link(9), link(3)]);
  const edited = upsertLink(before, { id: 9, title: '更新链接', url: 'http://localhost:80/' }, NOW + 1000);
  assert.deepEqual(edited[0], { ...link(9), title: '更新链接', url: 'http://localhost/' });
  assert.deepEqual(edited.map(item => item.id), [9, 3]);
  assert.deepEqual(before[0], link(9));
  assert.equal(upsertLink(before, { id: 9, title: '' }, NOW)[0].title, '链接');
  assert.equal(upsertLink(frozen([link(NOW)]), { url: 'example.org' }, NOW)[1].id, NOW + 1);
});

test('link deletion and bidirectional moves preserve IDs, metadata and immutable stored order', () => {
  const before = frozen([link(9), link(3), link(7)]);
  assert.deepEqual(deleteLink(before, 3), [link(9), link(7)]);
  assert.deepEqual(moveLink(before, 3, -1), [link(3), link(9), link(7)]);
  assert.deepEqual(moveLink(before, 3, 1), [link(9), link(7), link(3)]);
  assert.deepEqual(moveLink(before, 9, -1), before);
  assert.notEqual(moveLink(before, 9, -1), before);
  assert.deepEqual(moveLink(before, 7, 1), before);
  assert.equal(reorderLink, moveLink);
  assert.deepEqual(before.map(item => item.id), [9, 3, 7]);
  for (const direction of [0, 2, -2, '1', NaN]) invalid(() => moveLink(before, 3, direction));
  invalid(() => moveLink(before, 99, 1)); invalid(() => deleteLink(before, 99));
});

test('link helpers enforce caps, title bounds, record keys and valid existing collections', () => {
  const before = frozen(Array.from({ length: COLLECTION_LIMITS.links }, (_, i) => link(i + 1)));
  invalid(() => upsertLink(before, { url: 'example.net' }, NOW));
  assert.equal(upsertLink(before, { id: 1, title: 'edited' }, NOW).length, 100);
  assert.equal(deleteLink(before, 1).length, 99);
  assert.equal(upsertLink([], { title: 'x'.repeat(80), url: 'example.com' }, NOW)[0].title.length, 80);
  for (const input of [{ title: 'x'.repeat(81), url: 'example.com' }, { title: 'bad\n', url: 'example.com' },
    { url: 'example.com', updatedAt: NOW }, { url: 'example.com', extra: true },
    { url: 'example.com', createdAt: null }, { url: 'example.com', id: '1' },
    JSON.parse('{"url":"example.com","__proto__":{"poison":true}}')]) {
    invalid(() => upsertLink([], input, NOW));
  }
  const getter = { url: 'example.com' };
  Object.defineProperty(getter, 'title', { get() { throw new Error('getter ran'); } });
  invalid(() => upsertLink([], getter, NOW));
  invalid(() => upsertLink([link(1), link(1)], { url: 'example.com' }, NOW));
  invalid(() => moveLink([{ ...link(1), updatedAt: NOW }], 1, 1));
  invalid(() => deleteLink([link(1, { url: 'javascript:1' })], 1));
});

test('complete helper CRUD/reorder results survive strict backup round trips with all existing data', () => {
  const state = defaultState(); state.settings.salary = 12345;
  state.notes = upsertNote(state.notes, { body: 'first\n\tsecond' }, NOW);
  state.notes = upsertNote(state.notes, { id: NOW, title: '更新', body: '<b>data</b>\nline' }, NOW + 1000);
  state.links = upsertLink(state.links, { title: '内网', url: 'http://localhost:5173/' }, NOW);
  state.links = upsertLink(state.links, { title: '文档', url: 'example.com/docs' }, NOW + 1);
  state.links = moveLink(state.links, NOW + 1, -1);
  assert.deepEqual(parseBackup(JSON.stringify(state)), state);
  state.notes = deleteNote(state.notes, NOW);
  state.links = deleteLink(state.links, NOW);
  assert.deepEqual(parseBackup(JSON.stringify(state)), state);
  assert.equal(state.settings.salary, 12345);
});

test('workspace views bound notes to four and links to six without changing records or saved order', () => {
  const notes = frozen(Array.from({ length: 100 }, (_, index) => note(index + 1)));
  const links = frozen(Array.from({ length: 100 }, (_, index) => link(index + 1)));
  assert.deepEqual(WORKSPACE_VIEW_LIMITS, { notes: 4, links: 6 });
  const options = Object.freeze({ kind: 'notes', query: '', limit: 4 });
  assert.deepEqual(selectWorkspaceView(notes, options), { records: notes.slice(0, 4), total: 100, matched: 100, visible: 4, query: '' });
  assert.equal(selectWorkspaceView(links, { kind: 'links' }).visible, 6);
  assert.equal(selectWorkspaceView(notes, { limit: 8 }).visible, 8);
  assert.equal(selectWorkspaceView(notes, { limit: 104 }).visible, 100);
  assert.deepEqual(notes.map(record => record.id), Array.from({ length: 100 }, (_, index) => index + 1));
  assert.equal(selectWorkspaceView([], { kind: 'links' }).matched, 0);
  for (const options of [{ kind: 'other' }, { query: /x/ }, { limit: 0 }, { limit: 1.5 }]) {
    invalid(() => selectWorkspaceView(notes, options));
  }
});

test('workspace search is literal, trimmed, case-insensitive and includes full body and URL beyond previews', () => {
  const notes = frozen([note(3, { title: 'Alpha [draft]', body: 'a'.repeat(300) + ' DeepNeedle' }),
    note(1, { title: 'second', body: 'ALPHA literal .*' }), note(2, { title: 'other', body: 'unrelated' })]);
  assert.deepEqual(selectWorkspaceView(notes, { query: '  AlPhA ' }).records.map(record => record.id), [3, 1]);
  assert.equal(selectWorkspaceView(notes, { query: 'deepneedle' }).records[0].id, 3);
  assert.equal(selectWorkspaceView(notes, { query: '.*' }).matched, 1);
  assert.equal(selectWorkspaceView(notes, { query: '[' }).records[0].id, 3);
  assert.equal(selectWorkspaceView(notes, { query: 'missing' }).matched, 0);
  assert.equal(selectWorkspaceView(notes, { query: ' \t ' }).query, '');
  const links = frozen([link(8, { title: 'Documentation', url: 'https://example.com/' + 'a'.repeat(120) + '?PrivateNeedle=1#section' }),
    link(4, { title: 'other', url: 'https://elsewhere.test/' })]);
  assert.equal(selectWorkspaceView(links, { kind: 'links', query: 'DOCUMENTATION' }).records[0].id, 8);
  assert.equal(selectWorkspaceView(links, { kind: 'links', query: 'privateneedle=1#section' }).records[0].id, 8);
  assert.equal(selectWorkspaceView(links, { kind: 'links', query: 'ALPHA' }).matched, 0);
});

test('note previews preserve full stored text and truncate only at grapheme and four-line boundaries', () => {
  const family = '👨‍👩‍👧‍👦', accent = 'é';
  assert.deepEqual(previewNoteBody('short\nbody'), { text: 'short\nbody', truncated: false });
  assert.deepEqual(previewNoteBody(''), { text: '', truncated: false });
  assert.deepEqual(previewNoteBody(family.repeat(240)), { text: family.repeat(240), truncated: false });
  assert.deepEqual(previewNoteBody(family.repeat(241)), { text: family.repeat(240) + '…', truncated: true });
  assert.deepEqual(previewNoteBody(accent.repeat(241)), { text: accent.repeat(240) + '…', truncated: true });
  const body = 'one\ntwo\nthree\nfour\nfive';
  assert.deepEqual(previewNoteBody(body), { text: 'one\ntwo\nthree\nfour…', truncated: true });
  assert.equal(body, 'one\ntwo\nthree\nfour\nfive');
  const url = 'https://example.test/' + 'a'.repeat(150);
  assert.deepEqual(previewNoteBody(url, { maxChars: 100, maxLines: 1 }), { text: url.slice(0, 100) + '…', truncated: true });
  for (const options of [{ maxChars: 0 }, { maxLines: 0 }, { maxChars: 1.2 }]) invalid(() => previewNoteBody(body, options));
});
