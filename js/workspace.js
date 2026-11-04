// Pure workspace operations. State validation is shared with backup/import validation.
import {
  TEXT_LIMITS, COLLECTION_LIMITS, validateText, validateWorkspaceTitle, normalizeNote, normalizeLink,
  normalizeNotes, normalizeLinks, validateWorkspaceUrl
} from './state.js';

const MAX_TIMESTAMP = Date.UTC(2101, 0, 1);
const NOTE_KEYS = ['id', 'title', 'body', 'createdAt', 'updatedAt'];
const LINK_KEYS = ['id', 'title', 'url', 'createdAt'];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function fail(message) {
  const error = new Error(message);
  error.code = 'WORKSPACE_INVALID';
  throw error;
}

function inputRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('工作台记录格式无效');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key) || !has(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      fail('工作台记录包含不支持的字段');
    }
  }
  return value;
}

function time(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
    fail('记录时间无效');
  }
  return value;
}

function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('记录编号无效');
  return value;
}

function validated(parse, value) {
  try { return parse(value); } catch { fail('记录格式或内容无效，请检查长度和输入字符'); }
}

function newId(list, now) {
  const used = new Set(list.map(item => item.id));
  let next = Math.max(1, now);
  while (used.has(next)) next++;
  return id(next);
}

function titleOf(record, limit, fallback) {
  if (!has(record, 'title')) return fallback;
  // Reject controls/oversized input before treating a whitespace-only label as unnamed.
  if (!validateWorkspaceTitle(record.title, limit, { allowEmpty: true })) fail('标题过长或包含不支持的字符');
  return record.title.trim() || fallback;
}

/** Accept a bare host or HTTP(S) URL; never turn a non-web scheme into a web link. */
export function normalizeWorkspaceUrl(raw) {
  if (!validateText(raw, TEXT_LIMITS.linkUrl)) fail('请输入有效网址，长度不能超过 2000 字符');
  const value = raw.trim();
  if (/\s|\\/.test(value)) fail('网址不能包含空白或反斜杠');
  let source;
  if (/^https?:\/\//i.test(value)) source = value;
  else if (value.startsWith('//')) source = `https:${value}`;
  else {
    // A host:port is not a URI scheme. This intentionally allows localhost and private hosts.
    const hostPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(value);
    const reservedScheme = /^(?:https?|javascript|vbscript|data|file|mailto|ftp|blob|about|chrome):/i.test(value);
    if (reservedScheme || (/^[a-z][a-z\d+.-]*:/i.test(value) && !hostPort)) {
      fail('仅支持 HTTP 或 HTTPS 网址');
    }
    source = `https://${value}`;
  }
  if (!validateWorkspaceUrl(source)) fail('请输入不含用户名和密码的 HTTP 或 HTTPS 网址');
  const normalized = new URL(source).href;
  if (!validateWorkspaceUrl(normalized)) fail('网址规范化后超过长度限制或格式无效');
  return normalized;
}

/** Create or replace a note without mutating the list, caller input, or existing records. */
export function upsertNote(list, note, now = Date.now()) {
  const records = validated(normalizeNotes, list);
  const input = inputRecord(note, NOTE_KEYS);
  time(now);
  if (has(input, 'id')) id(input.id);
  if (has(input, 'createdAt')) time(input.createdAt);
  if (has(input, 'updatedAt')) time(input.updatedAt);
  const index = has(input, 'id') ? records.findIndex(item => item.id === input.id) : -1;
  const existing = index < 0 ? null : records[index];
  if (!existing && records.length >= COLLECTION_LIMITS.notes) fail('便签最多保存 100 条，请先整理记录');
  const createdAt = existing?.createdAt ?? now;
  const saved = validated(normalizeNote, {
    id: existing?.id ?? (has(input, 'id') ? input.id : newId(records, now)),
    title: titleOf(input, TEXT_LIMITS.noteTitle, existing?.title || '未命名便签'),
    body: has(input, 'body') ? input.body : existing?.body ?? '',
    createdAt,
    // A wall clock rollback must not create an invalid note or discard its history.
    updatedAt: Math.max(now, existing?.updatedAt ?? createdAt)
  });
  if (existing) records[index] = saved;
  else records.push(saved);
  return records;
}

export function deleteNote(list, noteId) {
  const records = validated(normalizeNotes, list);
  id(noteId);
  if (!records.some(item => item.id === noteId)) fail('便签不存在，请刷新后重试');
  return records.filter(item => item.id !== noteId);
}

/** Link timestamps and IDs belong to the record; reordering/editing does not reset creation. */
export function upsertLink(list, record, now = Date.now()) {
  const records = validated(normalizeLinks, list);
  const input = inputRecord(record, LINK_KEYS);
  time(now);
  if (has(input, 'id')) id(input.id);
  if (has(input, 'createdAt')) time(input.createdAt);
  const index = has(input, 'id') ? records.findIndex(item => item.id === input.id) : -1;
  const existing = index < 0 ? null : records[index];
  if (!existing && records.length >= COLLECTION_LIMITS.links) fail('链接最多保存 100 条，请先整理记录');
  const url = normalizeWorkspaceUrl(has(input, 'url') ? input.url : existing?.url);
  const saved = validated(normalizeLink, {
    id: existing?.id ?? (has(input, 'id') ? input.id : newId(records, now)),
    title: titleOf(input, TEXT_LIMITS.linkTitle, existing?.title || new URL(url).hostname),
    url,
    createdAt: existing?.createdAt ?? now
  });
  if (existing) records[index] = saved;
  else records.push(saved);
  return records;
}

export function deleteLink(list, linkId) {
  const records = validated(normalizeLinks, list);
  id(linkId);
  if (!records.some(item => item.id === linkId)) fail('链接不存在，请刷新后重试');
  return records.filter(item => item.id !== linkId);
}

export function moveLink(list, linkId, direction) {
  const records = validated(normalizeLinks, list);
  id(linkId);
  if (direction !== -1 && direction !== 1) fail('链接移动方向必须是 -1 或 1');
  const index = records.findIndex(item => item.id === linkId);
  if (index < 0) fail('链接不存在，请刷新后重试');
  const destination = index + direction;
  if (destination >= 0 && destination < records.length) {
    [records[index], records[destination]] = [records[destination], records[index]];
  }
  return records;
}

export const reorderLink = moveLink;

export const WORKSPACE_VIEW_LIMITS = Object.freeze({ notes: 4, links: 6 });

/** Local-only presentation: preserve saved order and never mutate records or view options. */
export function selectWorkspaceView(records, { kind = 'notes', query = '', limit = WORKSPACE_VIEW_LIMITS[kind] } = {}) {
  if (!has(WORKSPACE_VIEW_LIMITS, kind) || !Array.isArray(records) || typeof query !== 'string' ||
      !Number.isSafeInteger(limit) || limit < 1) fail('工作台视图参数无效');
  const filter = query.trim().toLowerCase();
  const matches = filter ? records.filter(record =>
    [record.title, kind === 'notes' ? record.body : record.url].some(value =>
      String(value ?? '').toLowerCase().includes(filter))) : records;
  const visible = matches.slice(0, limit);
  return { records: visible, total: records.length, matched: matches.length, visible: visible.length, query: filter };
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const characters = value => graphemes ? Array.from(graphemes.segment(value), part => part.segment) : [...value];

/** A bounded, Unicode-safe preview; expanded rendering still uses the unmodified stored body. */
export function previewNoteBody(body, { maxChars = 240, maxLines = 4 } = {}) {
  if (typeof body !== 'string' || !Number.isSafeInteger(maxChars) || maxChars < 1 ||
      !Number.isSafeInteger(maxLines) || maxLines < 1) fail('便签预览参数无效');
  const lines = body.split('\n');
  const prefix = characters(lines.slice(0, maxLines).join('\n'));
  const truncated = lines.length > maxLines || prefix.length > maxChars;
  return { text: prefix.slice(0, maxChars).join('') + (truncated ? '…' : ''), truncated };
}
