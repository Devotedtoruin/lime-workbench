import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('manifest declares the fields Chrome requires to offer installation', async () => {
  const m = JSON.parse(await read('public/manifest.webmanifest'));
  assert.ok(m.name && m.name.length > 0);
  assert.ok(m.short_name && m.short_name.length > 0);
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url, 'start_url is required for installability');
  assert.ok(m.theme_color, 'theme_color is used by the OS title bar');
  assert.ok(m.background_color, 'background_color prevents a white flash on launch');
});

test('manifest ships 192 and 512 PNG icons, both any and maskable', async () => {
  const m = JSON.parse(await read('public/manifest.webmanifest'));
  const icons = m.icons || [];
  // Chrome will not offer installation without a 192 and a 512 PNG. An SVG alone does not count.
  const png = icons.filter(i => i.type === 'image/png');
  for (const size of ['192x192', '512x512']) {
    assert.ok(png.some(i => i.sizes === size && i.purpose === 'any'), `missing ${size} any`);
    assert.ok(png.some(i => i.sizes === size && i.purpose === 'maskable'), `missing ${size} maskable`);
  }
});

test('manifest and its icons live in public/ so Vite copies them unhashed', async () => {
  const m = JSON.parse(await read('public/manifest.webmanifest'));
  for (const icon of m.icons) {
    const info = await stat(new URL(`public/${icon.src}`, root));
    assert.ok(info.size > 0, `${icon.src} is empty`);
  }
});

test('the built dist keeps the manifest and icons at stable, unhashed URLs', async (t) => {
  // `npm test` runs before `npm run build` in CI, so dist/ may not exist yet. Skip rather than
  // fail: this assertion protects the build output, and it runs locally after a build.
  const distIndex = new URL('dist/index.html', root);
  try {
    await stat(distIndex);
  } catch {
    t.skip('dist/ not built yet');
    return;
  }
  // The manifest's icon paths are relative to itself. Vite hashes assets by default, which
  // would move it to /assets/manifest-<hash>.webmanifest and break every icon path.
  const html = await read('dist/index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/,
    'manifest URL must stay literal');
  const m = JSON.parse(await read('dist/manifest.webmanifest'));
  for (const icon of m.icons) {
    const info = await stat(new URL(`dist/${icon.src}`, root));
    assert.ok(info.size > 0, `dist/${icon.src} missing after build`);
  }
});

test('manifest uses relative paths so a sub-path deploy also installs', async () => {
  const m = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(m.start_url, './', 'a leading slash breaks /repo-name/ hosting');
  assert.equal(m.scope, './');
});

test('index.html links the manifest and the iOS home-screen icon', async () => {
  const html = await read('index.html');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  // Root-absolute asset paths break sub-path hosting; every href/src must be relative.
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/, 'root-absolute paths break sub-path deploys');
});

test('service worker is scoped, versioned and skips cross-origin requests', async () => {
  const sw = await read('public/sw.js');
  assert.match(sw, /CACHE_VERSION\s*=\s*'v\d+'/, 'cache must be versioned so releases drop old shells');
  assert.match(sw, /url\.origin !== SCOPE\.origin/, 'third-party requests must not be intercepted');
  assert.match(sw, /request\.mode === 'navigate'/, 'navigations need their own strategy');
  assert.match(sw, /skipWaiting/, 'a waiting worker delays the next release');
  assert.match(sw, /clients\.claim/);
});

test('service worker resolves shell URLs against its own scope', async () => {
  const sw = await read('public/sw.js');
  // Using SCOPE means the same worker works at / and at /lime-workbench/.
  assert.match(sw, /new URL\(p, SCOPE\)/);
});
