// Device-local presentation preferences. Never included in the main-state backup.
export const APPEARANCE_STORAGE_KEY = 'lime-appearance-v2';
export const LEGACY_APPEARANCE_STORAGE_KEY = 'lime-appearance-v1';
export const MAX_BACKGROUND_IMAGE_CHARS = 1_500_000;
export const WIDGET_NAMES = Object.freeze(['focus', 'reminders', 'weather', 'work', 'rhythm', 'ledger', 'quick', 'notes', 'links']);
const legacyChoices = {
  theme: ['light', 'dark', 'system'], preset: ['aurora', 'mint', 'sunset', 'plain'],
  density: ['compact', 'standard', 'comfortable'], accent: ['green', 'blue', 'violet', 'amber'],
  font: ['system', 'sans', 'serif']
};
const choices = {
  ...legacyChoices,
  preset: [...legacyChoices.preset, 'ocean', 'paper', 'forest', 'twilight'],
  accent: [...legacyChoices.accent, 'cyan', 'rose', 'graphite'],
  font: [...legacyChoices.font, 'mono', 'numeric', 'custom'],
  motion: ['system', 'play', 'paused'], cardStyle: ['glass', 'solid', 'hairline']
};
const legacyRanges = { opacity: [0.3, 1], backgroundBlur: [0, 24], panelBlur: [0, 24], radius: [8, 24] };
const ranges = { ...legacyRanges, backgroundDim: [0, 0.8], fontScale: [0.9, 1.2] };
const legacyKeys = ['version', ...Object.keys(legacyChoices), ...Object.keys(legacyRanges), 'backgroundImage', 'widgets'];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const dataImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const assetId = /^[a-z0-9-]{1,80}$/;

export function defaultAppearance() {
  return {
    version: 2, theme: 'system', preset: 'aurora', opacity: 0.52,
    backgroundBlur: 4, panelBlur: 14, radius: 12, density: 'compact',
    accent: 'green', font: 'system', backgroundImage: '',
    backgroundAssetId: '', fontAssetId: '', motion: 'system', cardStyle: 'solid',
    backgroundDim: 0, fontScale: 1,
    widgets: Object.fromEntries(WIDGET_NAMES.map(name => [name, true]))
  };
}

export function isRasterDataUrl(value, maxChars = MAX_BACKGROUND_IMAGE_CHARS) {
  if (typeof value !== 'string' || value.length > maxChars) return false;
  const match = dataImage.exec(value);
  return Boolean(match && match[0].length === value.length);
}

/** Asset references are bounded opaque local identifiers, never URLs or CSS. */
export function isAppearanceAssetId(value) {
  if (typeof value !== 'string') return false;
  const match = assetId.exec(value);
  return value === '' || Boolean(match && match[0].length === value.length);
}

function dataProperties(value, keys) {
  if (!plain(value)) return false;
  const props = Reflect.ownKeys(value);
  return props.length === keys.length && props.every(key => keys.includes(key) &&
    own(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function validRecord(value, version) {
  const allowedChoices = version === 1 ? legacyChoices : choices;
  const allowedRanges = version === 1 ? legacyRanges : ranges;
  if (!dataProperties(value, version === 1 ? legacyKeys : Object.keys(defaultAppearance()))) return false;
  if (value.version !== version) return false;
  for (const [key, allowed] of Object.entries(allowedChoices)) if (!allowed.includes(value[key])) return false;
  for (const [key, [min, max]] of Object.entries(allowedRanges)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return false;
  }
  if (value.backgroundImage !== '' && !isRasterDataUrl(value.backgroundImage)) return false;
  if (version === 2 && (!isAppearanceAssetId(value.backgroundAssetId) || !isAppearanceAssetId(value.fontAssetId))) return false;
  return dataProperties(value.widgets, WIDGET_NAMES) && WIDGET_NAMES.every(key => typeof value.widgets[key] === 'boolean');
}

/** Strict, whole-record validation; invalid saves never replace a good preference record. */
export function validateAppearance(value) {
  try { return validRecord(value, 2); } catch { return false; }
}

/** Older v2 records may predate a widget/field; fill known defaults before judging them. */
function fillAppearance(value) {
  if (!plain(value) || value.version !== 2) return null;
  const defaults = defaultAppearance();
  const merged = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (own(value, key)) merged[key] = value[key];
  }
  if (plain(value.widgets)) merged.widgets = { ...defaults.widgets, ...value.widgets };
  return validateAppearance(merged) ? merged : null;
}

function storageOrDefault(storage) {
  return storage === undefined ? globalThis.localStorage : storage;
}
function copy(config) { return { ...config, widgets: { ...config.widgets } }; }
const MAX_RECORD_CHARS = MAX_BACKGROUND_IMAGE_CHARS + 10_000;
function parseRecord(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_RECORD_CHARS) throw new Error('Invalid appearance record');
  return JSON.parse(raw);
}

/** Read-only migration/status. Damaged/future records are protected until an explicit reset. */
export function readAppearanceStatus(storage) {
  const result = (status, canSave, source, appearance = defaultAppearance()) => ({ appearance, status, canSave, source });
  try {
    const target = storageOrDefault(storage);
    if (!target || typeof target.getItem !== 'function') return result('unavailable', false, 'default');
    const raw = target.getItem(APPEARANCE_STORAGE_KEY);
    if (raw !== null && raw !== undefined) {
      let parsed;
      try { parsed = parseRecord(raw); } catch { return result('corrupt', false, 'v2'); }
      if (validateAppearance(parsed)) return result('ready', true, 'v2', copy(parsed));
      const filled = fillAppearance(parsed);
      if (filled) return result('migrated', true, 'v2', copy(filled));
      const future = plain(parsed) && typeof parsed.version === 'number' && parsed.version > 2;
      return result(future ? 'future' : 'corrupt', false, 'v2');
    }
    const legacyRaw = target.getItem(LEGACY_APPEARANCE_STORAGE_KEY);
    if (legacyRaw === null || legacyRaw === undefined) return result('missing', true, 'default');
    try {
      const legacy = parseRecord(legacyRaw);
      if (validRecord(legacy, 1)) return result('migrated', true, 'v1', { ...defaultAppearance(), ...copy(legacy), version: 2 });
      if (plain(legacy) && typeof legacy.version === 'number' && legacy.version > 1) return result('future', false, 'v1');
    } catch { /* Keep the original v1 bytes, including invalid records. */ }
    return result('corrupt', false, 'v1');
  } catch { return result('unavailable', false, 'default'); }
}

/** Safe even when localStorage is denied, corrupt, or from an unsupported schema version. */
export function loadAppearance(storage) { return readAppearanceStatus(storage).appearance; }

/** Returns a boolean, not {ok}. Protected v2/v1 bytes survive every ordinary save. */
export function saveAppearance(config, storage) {
  if (!validateAppearance(config)) return false;
  try {
    const target = storageOrDefault(storage);
    if (!target || typeof target.setItem !== 'function' || !readAppearanceStatus(target).canSave) return false;
    target.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(copy(config)));
    return true;
  } catch { return false; }
}

/** Explicit recovery only. The caller must obtain reset confirmation before invoking this API. */
export function resetAppearance(storage) {
  try {
    const target = storageOrDefault(storage);
    if (!target || typeof target.setItem !== 'function') return false;
    target.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(defaultAppearance()));
    return true;
  } catch { return false; }
}

/** Main's existing theme toggle can persist the theme without losing settings or bypassing protection. */
export function setAppearanceTheme(theme, storage) {
  if (!choices.theme.includes(theme)) return false;
  const { appearance, canSave } = readAppearanceStatus(storage);
  return canSave && saveAppearance({ ...appearance, theme }, storage);
}

/** Preview only: never touches storage, fetches fonts, or resolves local media assets. */
export function applyAppearance(config) {
  const safe = validateAppearance(config) ? copy(config) : defaultAppearance();
  const doc = globalThis.document;
  if (!doc?.documentElement) return safe;
  const root = doc.documentElement;
  root.style.setProperty('--glass-alpha', `${Number((safe.opacity * 100).toFixed(3))}%`);
  root.style.setProperty('--panel-blur', `${safe.panelBlur}px`);
  // The glass CSS consumes --glass-blur; without this the "外壳虚化" slider wrote an unused token.
  root.style.setProperty('--glass-blur', `${safe.panelBlur}px`);
  root.style.setProperty('--background-blur', `${safe.backgroundBlur}px`);
  root.style.setProperty('--panel-radius', `${safe.radius}px`);
  root.style.setProperty('--background-dim', String(safe.backgroundDim));
  root.style.setProperty('--font-scale', String(safe.fontScale));
  for (const element of [root, doc.body].filter(Boolean)) {
    for (const key of ['density', 'accent', 'font', 'preset', 'cardStyle', 'motion']) element.dataset[key] = safe[key];
  }
  const image = safe.backgroundImage ? `url("${safe.backgroundImage}")` : 'none';
  // .scene consumes this on :root; the fixed #workbenchBackground layer is a legacy hook.
  root.style.setProperty('--background-image', image);
  const background = doc.getElementById('workbenchBackground');
  if (background) {
    // The alphabet allowed above cannot break out of a quoted CSS url().
    background.style.backgroundImage = image;
    background.style.setProperty('--background-image', image);
  }
  doc.querySelectorAll('[data-widget]').forEach(element => {
    const name = element.dataset.widget;
    if (['task', 'tasks', 'taskcore', 'task-core', 'todos'].includes(name) || element.hasAttribute('data-task-core')) {
      element.hidden = false;
    } else if (WIDGET_NAMES.includes(name)) element.hidden = !safe.widgets[name];
  });
  if (typeof doc.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    doc.dispatchEvent(new globalThis.CustomEvent('lime:appearance-change', {
      detail: { appearance: copy(safe), widgets: { ...safe.widgets } }
    }));
  }
  return safe;
}
