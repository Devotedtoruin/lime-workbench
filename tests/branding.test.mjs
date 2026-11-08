import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceNameOf, workspaceLogoOf, DEFAULT_BRAND_ICON } from '../js/branding.js';
import { defaultState, parseBackup, parseStoredState, MAX_AVATAR_IMAGE_CHARS } from '../js/state.js';

const raster = 'data:image/png;base64,aGVsbG8=';

test('workspace identity defaults are independent of personal name and use a local logo', () => {
  assert.equal(workspaceNameOf({ displayName: '小林' }), '青柠工作台');
  assert.equal(workspaceNameOf({ workspaceName: '  青柠小站  ' }), '青柠小站');
  assert.deepEqual(workspaceLogoOf({}), { kind: 'image', value: DEFAULT_BRAND_ICON });
  assert.deepEqual(workspaceLogoOf({ logoMode: 'custom', logoImage: 'https://external.invalid/a.png' }), { kind: 'image', value: DEFAULT_BRAND_ICON });
});

test('avatar logo references current personal identity while custom logo remains independent', () => {
  assert.deepEqual(workspaceLogoOf({ logoMode: 'avatar', avatar: '🌿', displayName: '小林' }), { kind: 'text', value: '🌿' });
  assert.deepEqual(workspaceLogoOf({ logoMode: 'avatar', avatarImage: raster }), { kind: 'image', value: raster });
  assert.deepEqual(workspaceLogoOf({ logoMode: 'custom', logoImage: raster, avatar: '林' }), { kind: 'image', value: raster });
});

test('avatar-mode brand accepts legacy GIF/JPG accepted by backup validation', () => {
  for (const avatarImage of ['data:image/gif;base64,R0lGODlh', 'data:image/jpg;base64,aGVsbG8=']) {
    const state = defaultState(); Object.assign(state.settings, { logoMode: 'avatar', avatarImage });
    const restored = parseBackup(JSON.stringify(state));
    assert.deepEqual(workspaceLogoOf(restored.settings), { kind: 'image', value: avatarImage });
  }
});

test('legacy records gain safe brand defaults; custom brand survives backup round trip', () => {
  const state = defaultState();
  delete state.settings.workspaceName; delete state.settings.logoMode; delete state.settings.logoImage;
  const restored = parseBackup(JSON.stringify(state));
  assert.equal(restored.settings.workspaceName, '');
  assert.equal(restored.settings.logoMode, 'default');
  assert.equal(restored.settings.logoImage, '');
  Object.assign(restored.settings, { workspaceName: '青柠小站 <本机>', logoMode: 'custom', logoImage: raster });
  assert.deepEqual(parseBackup(JSON.stringify(restored)), restored);
});

test('strict identity validation rejects external URLs, script images, bidi and oversize fields', () => {
  for (const patch of [
    { workspaceName: '长'.repeat(41) }, { workspaceName: 'abc‮def' },
    { logoMode: 'remote' }, { logoImage: 'https://example.invalid/a.png' },
    { logoImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { logoImage: 'data:image/gif;base64,R0lGODlh' },
    { logoImage: 'data:image/png;base64,' + 'a'.repeat(MAX_AVATAR_IMAGE_CHARS) }
  ]) {
    const state = defaultState(); Object.assign(state.settings, patch);
    assert.throws(() => parseBackup(JSON.stringify(state)), /Invalid backup/);
    const safe = parseStoredState(JSON.stringify(state));
    assert.equal(workspaceLogoOf(safe.settings).value, DEFAULT_BRAND_ICON);
  }
});
