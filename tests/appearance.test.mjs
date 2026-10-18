import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  APPEARANCE_STORAGE_KEY, LEGACY_APPEARANCE_STORAGE_KEY, MAX_BACKGROUND_IMAGE_CHARS, WIDGET_NAMES,
  defaultAppearance, loadAppearance, readAppearanceStatus, saveAppearance, resetAppearance, setAppearanceTheme,
  validateAppearance, isRasterDataUrl, isAppearanceAssetId, applyAppearance
} from '../js/appearance.js';

function fakeStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[APPEARANCE_STORAGE_KEY, initial]]);
  return { data, writes: 0, getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { this.writes++; data.set(key, value); } };
}
const raster = 'data:image/png;base64,AA==';

test('default appearance is independent, complete, and compact glass', () => {
  const a = defaultAppearance(), b = defaultAppearance();
  assert.equal(a.version, 2); assert.equal(a.preset, 'aurora');
  assert.equal(APPEARANCE_STORAGE_KEY, 'lime-appearance-v2');
  assert.equal(LEGACY_APPEARANCE_STORAGE_KEY, 'lime-appearance-v1');
  assert.equal(a.backgroundAssetId, ''); assert.equal(a.fontAssetId, '');
  assert.equal(a.motion, 'system'); assert.equal(a.cardStyle, 'glass');
  assert.equal(a.backgroundDim, 0); assert.equal(a.fontScale, 1);
  assert.equal(a.opacity, 0.52); assert.equal(a.radius, 12);
  assert.equal(a.panelBlur, 14); assert.equal(a.backgroundBlur, 4);
  assert.equal(a.density, 'compact'); assert.equal(a.backgroundImage, '');
  assert.deepEqual(Object.keys(a.widgets), WIDGET_NAMES);
  assert.ok(Object.values(a.widgets).every(Boolean));
  a.widgets.focus = false; assert.equal(b.widgets.focus, true);
  assert.ok(validateAppearance(b));
});

test('read failures, corrupt JSON, missing storage and unsupported versions return safe defaults', () => {
  for (const storage of [null, fakeStorage(), fakeStorage('{'), fakeStorage('null'), fakeStorage('[]'),
    fakeStorage(JSON.stringify({ ...defaultAppearance(), version: 9 })),
    { getItem() { throw new Error('denied'); } }]) {
    assert.deepEqual(loadAppearance(storage), defaultAppearance());
  }
});

test('loads a complete valid record and stores only appearance at the dedicated key', () => {
  const storage = fakeStorage();
  const config = { ...defaultAppearance(), theme: 'dark', backgroundImage: raster };
  config.widgets.notes = false;
  assert.equal(saveAppearance(config, storage), true);
  assert.equal(storage.writes, 1); assert.equal(storage.data.size, 1);
  assert.deepEqual(loadAppearance(storage), config);
  const loaded = loadAppearance(storage); loaded.widgets.notes = true;
  assert.equal(loadAppearance(storage).widgets.notes, false);
});

test('invalid numeric boundaries, choices, missing and unexpected fields cannot overwrite good data', () => {
  const storage = fakeStorage(JSON.stringify(defaultAppearance()));
  const bad = [
    { opacity: 0.299 }, { opacity: 1.01 }, { opacity: NaN }, { opacity: '0.8' },
    { panelBlur: -1 }, { backgroundBlur: 25 }, { radius: 7.9 }, { radius: 24.1 },
    { theme: 'auto' }, { preset: 'custom' }, { font: 'javascript' }, { density: 'dense' },
    { accent: 'red' }, { version: 1 }, { extra: true }, { widgets: { focus: true } },
    { motion: 'auto' }, { cardStyle: 'transparent' }, { backgroundDim: -0.001 }, { backgroundDim: 0.801 },
    { backgroundDim: '0.2' }, { fontScale: 0.899 }, { fontScale: 1.201 }, { fontScale: Infinity },
    { backgroundAssetId: null }, { fontAssetId: 'https://example.com/font.woff2' },
    { widgets: { ...defaultAppearance().widgets, tasks: false } },
    { widgets: { ...defaultAppearance().widgets, focus: 'false' } }
  ];
  const missing = defaultAppearance(); delete missing.opacity;
  for (const patch of bad) assert.equal(saveAppearance({ ...defaultAppearance(), ...patch }, storage), false);
  // Spreading the missing record above supplies its absent key again; check the record itself too.
  assert.equal(saveAppearance(missing, storage), false);
  assert.equal(storage.writes, 0);
  assert.deepEqual(loadAppearance(storage), defaultAppearance());
});

test('all range endpoints and enum options are accepted', () => {
  assert.ok(validateAppearance({ ...defaultAppearance(), opacity: 0.3, radius: 8, panelBlur: 0, backgroundBlur: 0, backgroundDim: 0, fontScale: 0.9 }));
  assert.ok(validateAppearance({ ...defaultAppearance(), opacity: 1, radius: 24, panelBlur: 24, backgroundBlur: 24, backgroundDim: 0.8, fontScale: 1.2 }));
  for (const [key, values] of Object.entries({ theme: ['light', 'dark', 'system'],
    preset: ['aurora', 'mint', 'sunset', 'plain', 'ocean', 'paper', 'forest', 'twilight'],
    accent: ['green', 'blue', 'violet', 'amber', 'cyan', 'rose', 'graphite'], density: ['compact', 'standard', 'comfortable'],
    font: ['system', 'sans', 'serif', 'mono', 'numeric', 'custom'], motion: ['system', 'play', 'paused'], cardStyle: ['glass', 'solid', 'hairline'] })) {
    for (const value of values) assert.ok(validateAppearance({ ...defaultAppearance(), [key]: value }));
  }
});

test('SVG, external URLs, CSS-breakout payloads, whitespace and oversize images are rejected', () => {
  const bad = ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/gif;base64,AA==', 'data:image/png;base64,AA==\n',
    'data:image/png;base64,AA==");url(https://example.com)', 'data:image/png;base64,',
    `data:image/jpeg;base64,${'A'.repeat(MAX_BACKGROUND_IMAGE_CHARS)}`];
  for (const backgroundImage of bad) {
    assert.equal(isRasterDataUrl(backgroundImage), false);
    assert.equal(validateAppearance({ ...defaultAppearance(), backgroundImage }), false);
  }
  assert.ok(isRasterDataUrl(raster));
  assert.ok(isRasterDataUrl('data:image/jpeg;base64,AA=='));
  assert.ok(isRasterDataUrl('data:image/webp;base64,AA=='));
});

test('accessors and non-plain objects are rejected without invoking their getters', () => {
  let reads = 0;
  const config = defaultAppearance();
  Object.defineProperty(config, 'preset', { enumerable: true, get() { reads++; return 'aurora'; } });
  assert.equal(validateAppearance(config), false); assert.equal(reads, 0);
  const widgets = defaultAppearance().widgets;
  Object.defineProperty(widgets, 'notes', { enumerable: true, get() { reads++; return true; } });
  assert.equal(validateAppearance({ ...defaultAppearance(), widgets }), false); assert.equal(reads, 0);
  assert.equal(validateAppearance(new Date()), false);
});

test('quota errors report false and do not claim persistence', () => {
  const storage = { getItem() { return JSON.stringify(defaultAppearance()); }, setItem() { throw new Error('quota'); } };
  assert.equal(saveAppearance(defaultAppearance(), storage), false);
  assert.equal(saveAppearance(defaultAppearance(), null), false);
  assert.equal(setAppearanceTheme('dark', storage), false);
  assert.deepEqual(loadAppearance(storage), defaultAppearance());
});

test('theme synchronization preserves every other committed appearance field', () => {
  const config = { ...defaultAppearance(), opacity: 0.5, preset: 'sunset', backgroundImage: raster };
  config.widgets.quick = false;
  const storage = fakeStorage(JSON.stringify(config));
  assert.equal(setAppearanceTheme('dark', storage), true);
  assert.deepEqual(loadAppearance(storage), { ...config, theme: 'dark' });
  assert.equal(setAppearanceTheme('bad', storage), false); assert.equal(storage.writes, 1);
});

function legacyAppearance(patch = {}) {
  const config = { ...defaultAppearance(), ...patch, version: 1 };
  for (const key of ['backgroundAssetId', 'fontAssetId', 'motion', 'cardStyle', 'backgroundDim', 'fontScale']) delete config[key];
  return config;
}

test('v1 migration is read-only, preserves exact legacy bytes and copies every preference into v2', () => {
  const legacy = legacyAppearance({ theme: 'dark', preset: 'sunset', font: 'serif', backgroundImage: raster,
    opacity: 0.6, backgroundBlur: 7, panelBlur: 20, radius: 22, density: 'comfortable', accent: 'amber' });
  legacy.widgets.quick = false;
  const bytes = ` \n${JSON.stringify(legacy, null, 2)}\n `;
  const storage = fakeStorage(); storage.data.set(LEGACY_APPEARANCE_STORAGE_KEY, bytes);
  const status = readAppearanceStatus(storage);
  assert.deepEqual(Object.keys(status).sort(), ['appearance', 'canSave', 'source', 'status']);
  assert.equal(status.status, 'migrated'); assert.equal(status.source, 'v1'); assert.equal(status.canSave, true);
  assert.deepEqual(status.appearance, { ...defaultAppearance(), ...legacy, version: 2 });
  assert.equal(storage.writes, 0); assert.equal(storage.data.get(LEGACY_APPEARANCE_STORAGE_KEY), bytes);
  assert.equal(storage.data.has(APPEARANCE_STORAGE_KEY), false);
  const loaded = loadAppearance(storage); loaded.widgets.quick = true;
  assert.equal(loadAppearance(storage).widgets.quick, false); assert.equal(storage.writes, 0);
  assert.equal(saveAppearance(status.appearance, storage), true); assert.equal(storage.writes, 1);
  assert.equal(storage.data.get(LEGACY_APPEARANCE_STORAGE_KEY), bytes);
  assert.equal(readAppearanceStatus(storage).source, 'v2'); assert.equal(readAppearanceStatus(storage).status, 'ready');
});

test('valid v2 wins over any v1 record and reads never rewrite either key', () => {
  const config = { ...defaultAppearance(), font: 'mono', motion: 'paused', cardStyle: 'solid',
    backgroundDim: 0.4, fontScale: 1.2, backgroundAssetId: 'background-01', fontAssetId: 'font-02' };
  const bytes = `\n${JSON.stringify(config, null, 2)}\n`;
  const storage = fakeStorage(bytes); storage.data.set(LEGACY_APPEARANCE_STORAGE_KEY, '{old bytes');
  assert.deepEqual(readAppearanceStatus(storage), { appearance: config, status: 'ready', canSave: true, source: 'v2' });
  assert.equal(storage.writes, 0); assert.equal(storage.data.get(APPEARANCE_STORAGE_KEY), bytes);
  assert.equal(storage.data.get(LEGACY_APPEARANCE_STORAGE_KEY), '{old bytes');
  assert.equal(setAppearanceTheme('light', storage), true);
  assert.deepEqual(loadAppearance(storage), { ...config, theme: 'light' });
  assert.equal(storage.data.get(LEGACY_APPEARANCE_STORAGE_KEY), '{old bytes');
});

test('corrupt and future v2/v1 records block normal saves and theme changes until explicit reset', () => {
  const cases = [
    [APPEARANCE_STORAGE_KEY, ' { invalid JSON ', 'corrupt'],
    [APPEARANCE_STORAGE_KEY, JSON.stringify({ ...defaultAppearance(), version: 8 }), 'future'],
    [APPEARANCE_STORAGE_KEY, JSON.stringify({ ...defaultAppearance(), fontScale: 99 }), 'corrupt'],
    [LEGACY_APPEARANCE_STORAGE_KEY, 'null', 'corrupt'],
    [LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify({ ...legacyAppearance(), version: 8 }), 'future'],
    [LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify({ ...legacyAppearance(), extra: 'do not erase' }), 'corrupt']
  ];
  for (const [key, bytes, expected] of cases) {
    const storage = fakeStorage(); storage.data.set(key, bytes);
    if (key === APPEARANCE_STORAGE_KEY) storage.data.set(LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify(legacyAppearance({ theme: 'dark' })));
    const before = new Map(storage.data), status = readAppearanceStatus(storage);
    assert.equal(status.status, expected); assert.equal(status.canSave, false);
    assert.equal(status.source, key === APPEARANCE_STORAGE_KEY ? 'v2' : 'v1');
    assert.deepEqual(status.appearance, defaultAppearance()); assert.equal(storage.writes, 0);
    assert.equal(saveAppearance(defaultAppearance(), storage), false); assert.equal(setAppearanceTheme('dark', storage), false);
    assert.equal(storage.writes, 0); assert.deepEqual(storage.data, before);
    assert.equal(resetAppearance(storage), true); assert.equal(storage.writes, 1);
    assert.equal(storage.data.get(APPEARANCE_STORAGE_KEY), JSON.stringify(defaultAppearance()));
    assert.equal(storage.data.get(LEGACY_APPEARANCE_STORAGE_KEY), before.get(LEGACY_APPEARANCE_STORAGE_KEY));
    assert.equal(readAppearanceStatus(storage).canSave, true);
  }
});

test('missing/unavailable statuses and reset return explicit booleans without claiming failed writes', () => {
  const storage = fakeStorage();
  assert.deepEqual(readAppearanceStatus(storage), { appearance: defaultAppearance(), status: 'missing', canSave: true, source: 'default' });
  assert.deepEqual(readAppearanceStatus(null), { appearance: defaultAppearance(), status: 'unavailable', canSave: false, source: 'default' });
  assert.equal(resetAppearance(null), false);
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readAppearanceStatus(denied).status, 'unavailable');
  assert.equal(saveAppearance(defaultAppearance(), denied), false); assert.equal(resetAppearance(denied), false);
  assert.equal(resetAppearance(storage), true); assert.equal(storage.writes, 1);
});

test('asset references accept only empty or 1–80 lowercase ASCII letters, digits and hyphens', () => {
  for (const id of ['', 'a', '-', 'background-01', 'a'.repeat(80)]) {
    assert.equal(isAppearanceAssetId(id), true);
    assert.equal(validateAppearance({ ...defaultAppearance(), backgroundAssetId: id, fontAssetId: id }), true);
  }
  for (const id of [null, undefined, 1, {}, [], 'A', 'a_b', 'a.b', 'a/b', 'a\\b', 'a b', 'ä', 'a'.repeat(81),
    'a\n', 'a\r', 'a ', 'a\u0000', 'https://example.com/a', 'blob:local', 'url(x)', '\";color:red']) {
    assert.equal(isAppearanceAssetId(id), false);
    for (const key of ['backgroundAssetId', 'fontAssetId']) assert.equal(validateAppearance({ ...defaultAppearance(), [key]: id }), false);
  }
});

function fakeElement(widget) {
  const properties = new Map();
  return { dataset: widget ? { widget } : {}, hidden: true,
    style: { setProperty(key, value) { properties.set(key, value); }, properties },
    hasAttribute() { return false; } };
}

test('preview applies percentage CSS tokens, both dataset locations, strict background and widget visibility without storage writes', () => {
  const beforeDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const beforeStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const root = fakeElement(), body = fakeElement(), background = fakeElement();
  const widgets = [...WIDGET_NAMES, 'taskcore', 'tasks'].map(fakeElement);
  let storageReads = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    documentElement: root, body, getElementById: id => id === 'workbenchBackground' ? background : null,
    querySelectorAll: () => widgets
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { storageReads++; throw new Error('must not read'); } });
  try {
    const config = { ...defaultAppearance(), preset: 'mint', font: 'serif', backgroundImage: raster,
      backgroundDim: 0.6, fontScale: 1.15, motion: 'paused', cardStyle: 'hairline' };
    config.widgets.notes = false;
    applyAppearance(config);
    assert.equal(root.style.properties.get('--glass-alpha'), '52%');
    assert.equal(root.style.properties.get('--panel-blur'), '14px');
    assert.equal(root.style.properties.get('--background-blur'), '4px');
    assert.equal(root.style.properties.get('--panel-radius'), '12px');
    assert.equal(root.style.properties.get('--background-dim'), '0.6'); assert.equal(root.style.properties.get('--font-scale'), '1.15');
    assert.equal(root.dataset.preset, 'mint'); assert.equal(body.dataset.font, 'serif');
    assert.equal(root.dataset.motion, 'paused'); assert.equal(body.dataset.cardStyle, 'hairline');
    assert.equal(background.style.backgroundImage, `url("${raster}")`);
    assert.equal(background.style.properties.get('--background-image'), `url("${raster}")`);
    assert.equal(widgets.find(item => item.dataset.widget === 'notes').hidden, true);
    assert.equal(widgets.find(item => item.dataset.widget === 'focus').hidden, false);
    assert.equal(widgets.find(item => item.dataset.widget === 'taskcore').hidden, false);
    assert.equal(widgets.find(item => item.dataset.widget === 'tasks').hidden, false);
    assert.equal(storageReads, 0);
    applyAppearance(defaultAppearance()); assert.equal(background.style.backgroundImage, 'none');
  } finally {
    if (beforeDoc) Object.defineProperty(globalThis, 'document', beforeDoc); else delete globalThis.document;
    if (beforeStorage) Object.defineProperty(globalThis, 'localStorage', beforeStorage); else delete globalThis.localStorage;
  }
});

test('appearance event has an isolated {appearance, widgets} snapshot and custom font remains runtime-owned', () => {
  const before = new Map(['document', 'CustomEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const root = fakeElement(), body = fakeElement(); let event;
  root.style.setProperty('--font-local', 'LimeUserFont');
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    documentElement: root, body, getElementById: () => null, querySelectorAll: () => [],
    dispatchEvent(value) { event = value; }
  } });
  try {
    const config = { ...defaultAppearance(), font: 'custom', fontAssetId: 'font-01', backgroundAssetId: 'background-02' };
    const applied = applyAppearance(config);
    assert.equal(root.dataset.font, 'custom'); assert.equal(root.style.properties.get('--font-local'), 'LimeUserFont');
    assert.equal(event.type, 'lime:appearance-change'); assert.deepEqual(Object.keys(event.detail).sort(), ['appearance', 'widgets']);
    assert.deepEqual(event.detail.appearance, config); assert.deepEqual(event.detail.widgets, config.widgets);
    event.detail.appearance.widgets.notes = false; event.detail.widgets.focus = false;
    assert.equal(config.widgets.notes, true); assert.equal(applied.widgets.notes, true);
    assert.equal(event.detail.appearance.widgets.focus, true); assert.equal(applied.widgets.focus, true);
  } finally {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('DOM-free apply is safe and returns normalized defaults for malformed input', () => {
  assert.deepEqual(applyAppearance(null), defaultAppearance());
});


test('Vue design system keeps liquid-glass tokens and a floating collapsible rail', async () => {
  const base = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8');
  const glass = await readFile(new URL('../src/styles/glass.css', import.meta.url), 'utf8');
  const rail = await readFile(new URL('../src/components/SideRail.vue', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
  const topbar = await readFile(new URL('../src/components/TopBar.vue', import.meta.url), 'utf8');

  // Liquid glass: blur + saturation + specular rim + 12-column grid tokens.
  assert.match(base, /--glass-blur:\s*26px/);
  assert.match(base, /--glass-saturate:\s*180%/);
  assert.match(base, /--glass-rim:/);
  assert.match(glass, /\.glass\s*\{[^}]*backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\)/);
  assert.match(glass, /\.rim::before\s*\{[^}]*mask-composite:\s*exclude/);
  assert.match(glass, /\.card-hover:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/);
  assert.match(glass, /\.spot::after,\s*\.panel\.glass::after\s*\{[^}]*radial-gradient/);

  // Floating-island collapsible sidebar with a phone off-canvas drawer.
  assert.match(base, /--sidebar-w:\s*240px/);
  assert.match(base, /--sidebar-w-collapsed:\s*76px/);
  assert.match(rail, /\.rail\.is-collapsed\s*\{\s*width:\s*var\(--sidebar-w-collapsed\)/);
  assert.match(rail, /translateX\(calc\(-100% - 24px\)\)/);
  assert.match(app, /padding-left:\s*calc\(var\(--sidebar-w\) \+ var\(--shell-gap\) \* 2\)/);

  // The retired top-right media toggle must not come back; the avatar replaces it.
  assert.doesNotMatch(topbar, /motionToggle|暂停动态媒体/);
  assert.match(topbar, /class="topbar-avatar"/);
  assert.doesNotMatch(topbar, /独立 Logo|logoUpload/);
});

test('appearance defaults stay compatible while identity drops the independent logo UI', async () => {
  const settings = await readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /独立 Logo|logoUpload|logoMode\s*=\s*'custom'/);
  assert.match(settings, /个人形象/);
  assert.match(settings, /选择头像图片/);
  // Simplified beautification: presets, accents, theme, card style, density, wallpaper.
  for (const label of ['桌面主题', '明暗外观', '品牌强调色', '卡片质感', '布局密度', '桌面壁纸']) {
    assert.ok(settings.includes(label), label);
  }
  // Removed over-complex controls.
  for (const removed of ['面板不透明度', '玻璃虚化', '背景虚化', '本地 WOFF2', '动态媒体']) {
    assert.ok(!settings.includes(removed), removed);
  }
});
