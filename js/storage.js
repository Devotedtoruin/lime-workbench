// Local persistence is transactional: validate and write before committing a replacement.
import {
  defaultState, parseStoredState, parseBackup, MAX_BACKUP_CHARS, SUPPORTED_STATE_VERSIONS
} from './state.js';

export const STORAGE_KEY = 'lime-workbench-v1';

function readonlyError(message, cause) {
  const error = new Error(`${message}；已进入只读模式，原记录不会被覆盖。请导出原始备份，确认后导入有效备份或清空记录`);
  error.code = 'STORAGE_READONLY';
  if (cause) error.cause = cause;
  return error;
}

// A missing key is fresh. A broken/unsupported root is NOT fresh. Valid legacy roots may
// still repair invalid rows with parseStoredState without losing all of their valid data.
function inspectSnapshot(snapshot) {
  if (snapshot === null) return null;
  if (typeof snapshot !== 'string' || snapshot.length === 0 || snapshot.length > MAX_BACKUP_CHARS) {
    return readonlyError('本地记录为空、格式无效或超出容量上限');
  }
  let raw;
  try { raw = JSON.parse(snapshot); } catch (error) {
    return readonlyError('本地记录 JSON 已损坏', error);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return readonlyError('本地记录根格式无效');
  if (Object.hasOwn(raw, 'version') && !SUPPORTED_STATE_VERSIONS.includes(raw.version)) {
    return readonlyError('本地记录使用未来版本或不支持的版本');
  }
  const keys = Object.keys(defaultState());
  if (!Object.keys(raw).some(key => key !== 'version' && keys.includes(key)) ||
      Object.keys(raw).some(key => !keys.includes(key))) {
    return readonlyError('本地记录缺少工作台数据或包含不支持的根字段');
  }
  return null;
}

export function createStateStore(storage, key = STORAGE_KEY) {
  let snapshot = null;
  let readError = null;

  function lock(error) {
    // Lock is sticky: ordinary reads/refreshes cannot authorize destructive recovery.
    if (!readError) readError = error;
  }

  function readSnapshot() {
    let current;
    try { current = storage.getItem(key); } catch (error) {
      lock(readonlyError(error?.message || '浏览器不允许读取本地存储', error));
      throw readError;
    }
    return current;
  }

  function acceptSnapshot(current) {
    snapshot = current;
    const invalid = inspectSnapshot(current);
    if (invalid) lock(invalid);
  }

  try { acceptSnapshot(readSnapshot()); } catch { /* Defaults are only a view, never a replacement. */ }
  const initial = parseStoredState(snapshot);

  function encode(candidate) {
    const encoded = JSON.stringify(candidate);
    if (typeof encoded !== 'string') throw new Error('Invalid backup: no state data');
    if (encoded.length > MAX_BACKUP_CHARS) throw new Error('工作台数据已达备份容量上限，请先导出并整理记录');
    // Never export or persist data which the application cannot import itself.
    parseBackup(encoded);
    return encoded;
  }

  function persist(candidate, replacement) {
    if (readError && !replacement) throw readError;
    const encoded = encode(candidate);
    const current = readSnapshot();
    const changed = current !== snapshot;
    if (changed) acceptSnapshot(current);
    else {
      const invalid = inspectSnapshot(current);
      if (invalid) lock(invalid);
    }
    if (readError && !replacement) throw readError;
    if (changed) {
      const error = new Error('另一个页面更新了记录，已同步最新数据；请重新操作');
      error.code = 'STORAGE_CONFLICT';
      throw error;
    }
    // Quota/write failures leave snapshot and any read-only lock intact; a retry may succeed.
    storage.setItem(key, encoded);
    snapshot = encoded;
    readError = null;
    return true;
  }

  return {
    initial,
    get readError() { return readError; },
    get canWrite() { return readError === null; },
    get blockedReason() { return readError?.message || ''; },
    rawText() { return snapshot; },
    write(candidate) { return persist(candidate, false); },
    // Intentional replacement only: the UI must obtain user confirmation for import/reset.
    // Validation, external-update checks and actual setItem success still precede unlocking.
    writeReplacement(candidate) { return persist(candidate, true); },
    rollback() { return parseStoredState(snapshot); },
    refresh() {
      acceptSnapshot(readSnapshot());
      return parseStoredState(snapshot);
    }
  };
}

export function unavailableStorage() {
  return {
    getItem() { throw new Error('浏览器不允许本地存储，记录无法保存；请调整浏览器设置'); },
    setItem() { throw new Error('浏览器不允许本地存储，记录无法保存；请调整浏览器设置'); }
  };
}
