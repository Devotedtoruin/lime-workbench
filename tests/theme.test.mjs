import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { THEME_COLORS, applyThemeColor } from '../js/theme.js';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

function fakeDoc({ contents = [THEME_COLORS.light, THEME_COLORS.dark], head = true, style = true } = {}) {
  const metas = contents.map(content => ({ tagName: 'META', name: 'theme-color', content }));
  const appended = [];
  const props = {};
  return {
    metas,
    appended,
    props,
    doc: {
      documentElement: { style: style ? { setProperty: (k, v) => { props[k] = v; } } : undefined },
      head: head ? { appendChild: node => appended.push(node) } : null,
      querySelectorAll: () => metas,
      createElement: () => ({ name: '', content: '' })
    }
  };
}

test('theme colours mirror the CSS background tokens used by base.css', async () => {
  const css = await read('src/styles/base.css');
  for (const colour of Object.values(THEME_COLORS)) {
    assert.ok(css.toLowerCase().includes(colour.toLowerCase()), `base.css no longer defines ${colour}`);
  }
});

test('applyThemeColor rewrites every theme-color meta so browser chrome follows the choice', () => {
  const { doc, metas, props } = fakeDoc();
  assert.equal(applyThemeColor('dark', doc), true);
  assert.deepEqual(metas.map(m => m.content), [THEME_COLORS.dark, THEME_COLORS.dark]);
  assert.equal(props['color-scheme'], 'dark');
});

test('applyThemeColor is idempotent', () => {
  const { doc } = fakeDoc();
  applyThemeColor('dark', doc);
  assert.equal(applyThemeColor('dark', doc), false, 'a second identical call must be a no-op');
  assert.equal(applyThemeColor('light', doc), true);
});

test('applyThemeColor creates a meta only when the document has none', () => {
  const { doc, appended } = fakeDoc({ contents: [] });
  assert.equal(applyThemeColor('light', doc), true);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].name, 'theme-color');
  assert.equal(appended[0].content, THEME_COLORS.light);
});

test('applyThemeColor refuses unknown themes and missing DOM instead of throwing', () => {
  const { doc, metas } = fakeDoc();
  assert.equal(applyThemeColor('sepia', doc), false);
  assert.equal(applyThemeColor('dark', null), false);
  // A document without documentElement is not ours to decorate.
  assert.equal(applyThemeColor('dark', { documentElement: null, querySelectorAll: () => metas }), false);
  assert.equal(metas[0].content, THEME_COLORS.light, 'a rejected call must not rewrite metas');
});

test('the shipped index.html carries a CSP, a nonce-scoped boot script and the theme pair', async () => {
  const html = await read('index.html');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]+">/);
  assert.match(html, /data-lime-boot nonce="[A-Za-z0-9_-]+"/);
  const nonce = html.match(/data-lime-boot nonce="([^"]+)"/)[1];
  assert.ok(html.includes(`'nonce-${nonce}'`), 'CSP must whitelist the boot nonce');
  for (const colour of Object.values(THEME_COLORS)) {
    assert.ok(html.includes(`content="${colour}"`), `missing theme-color ${colour}`);
  }
  for (const directive of ['script-src', "object-src 'none'", "base-uri 'self'", "form-action 'none'"]) {
    assert.ok(html.includes(directive), `CSP is missing ${directive}`);
  }
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-eval'/);
});

test('the CSP omits directives that <meta> cannot enforce and sources browsers reject', async () => {
  const html = await read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  // Chromium ignores frame-ancestors in a meta tag and drops http://[::1]:* as an invalid source.
  assert.doesNotMatch(csp, /frame-ancestors/);
  assert.doesNotMatch(csp, /\[::1\]:\*/);
  assert.match(csp, /connect-src[^;]*https:/);
  assert.match(csp, /connect-src[^;]*http:\/\/localhost:\*/);
});
