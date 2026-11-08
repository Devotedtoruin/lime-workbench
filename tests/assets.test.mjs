import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const srcRoot = new URL('../src/', import.meta.url);

async function collectVueFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...await collectVueFiles(url));
    else if (entry.name.endsWith('.vue')) files.push(url);
  }
  return files;
}

test('templates resolve icons through asset(), never as root-absolute URLs', async () => {
  const offenders = [];
  for (const file of await collectVueFiles(srcRoot)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      // "/assets/..." resolves against the domain root. On GitHub Pages the app lives under
      // /lime-workbench/, so the browser requests the wrong URL and every icon 404s.
      if (/(?<![:\w-])src="\/assets\//.test(line) || /:src="`\/assets\//.test(line)) {
        const name = fileURLToPath(file).split(/[\\/]src[\\/]/).pop();
        offenders.push(`${name}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `import asset() from src/lib/assets.js and drop the leading slash: ${offenders.join(', ')}`);
});

test('the asset helper prefixes paths with the build base', async () => {
  const helper = await readFile(new URL('lib/assets.js', srcRoot), 'utf8');
  assert.match(helper, /import\.meta\.env\.BASE_URL/, 'must use Vite BASE_URL so sub-path deploys work');
});
