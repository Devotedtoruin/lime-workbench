import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectNativeConfiguration, summarizeReadiness } from '../tools/check-native.mjs';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const fixture = () => ({
  config: json('src-tauri/tauri.conf.json'),
  capability: json('src-tauri/capabilities/default.json'),
  packageVersion: json('package.json').version,
  cargoText: readFileSync(new URL('src-tauri/Cargo.toml', root), 'utf8'),
  // Simulated presence: this unit suite never runs SDK tools or assumes native icons/builds exist.
  files: ['Cargo.toml', 'build.rs', 'tauri.conf.json', 'capabilities/default.json', 'src/lib.rs', 'src/main.rs', 'icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico']
});
const check = (data, id) => inspectNativeConfiguration(data).find(item => item.id === id);

test('checked-in native configuration meets the static policy with simulated inputs', () => {
  const failed = inspectNativeConfiguration(fixture()).filter(item => !item.ok);
  assert.deepEqual(failed, []);
});
test('versions must agree across package metadata, Rust and Tauri configuration', () => {
  const data = fixture();
  data.config.version = '1.0.1';
  assert.equal(check(data, 'version').ok, false);
  data.config.version = data.packageVersion;
  data.cargoText = data.cargoText.replace('version = "1.0.0"', 'version = "1.0.2"');
  assert.equal(check(data, 'version').ok, false);
});
test('missing required native entry file is blocked', () => {
  const data = fixture();
  data.files = data.files.filter(path => path !== 'src/lib.rs');
  assert.equal(check(data, 'inputs').ok, false);
});
test('missing PNG/ICO cannot appear ready merely because an SVG exists', () => {
  const data = fixture();
  data.files = data.files.filter(path => !path.endsWith('.ico'));
  data.files.push('../assets/icon.svg');
  assert.equal(check(data, 'icons').ok, false);
});
test('bundling repository root is rejected', () => {
  const data = fixture();
  data.config.build.frontendDist = '..';
  assert.equal(check(data, 'frontend').ok, false);
});
test('build/dev hooks use project scripts and do not wait for the server', () => {
  const data = fixture();
  data.config.build.beforeBuildCommand = 'cargo build';
  assert.equal(check(data, 'build-hook').ok, false);
  data.config.build.beforeDevCommand.wait = true;
  assert.equal(check(data, 'dev-hook').ok, false);
});
test('remote website, shell and filesystem capabilities are rejected', () => {
  for (const mutation of [data => { data.capability.remote = { urls: ['https://example.org'] }; }, data => { data.capability.permissions.push('shell:allow-execute'); }, data => { data.capability.permissions.push('fs:default'); }, data => { data.capability.windows = ['*']; }]) {
    const data = fixture();
    mutation(data);
    assert.equal(check(data, 'capabilities').ok, false);
  }
});
test('asset protocol must not expose user files', () => {
  const data = fixture();
  data.config.app.security.assetProtocol = { enable: true, scope: ['**'] };
  assert.equal(check(data, 'asset-protocol').ok, false);
});
test('script CSP rejects inline code, eval and external scripts', () => {
  for (const source of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:']) {
    const data = fixture();
    data.config.app.security.csp = data.config.app.security.csp.replace("script-src 'self'", `script-src 'self' ${source}`);
    assert.equal(check(data, 'csp').ok, false);
  }
});
test('network CSP allows chosen HTTPS AI services but not arbitrary HTTP', () => {
  const data = fixture();
  assert.equal(check(data, 'csp').ok, true);
  data.config.app.security.csp = data.config.app.security.csp.replace('https:', 'http:');
  assert.equal(check(data, 'csp').ok, false);
});
test('remote image URLs cannot bypass local avatar/background policy', () => {
  const data = fixture();
  data.config.app.security.csp = data.config.app.security.csp.replace("img-src 'self' data:", "img-src 'self' data: https:");
  assert.equal(check(data, 'csp').ok, false);
});
test('OS transparency and all-user installation are not this round', () => {
  const data = fixture();
  data.config.app.windows[0].transparent = true;
  data.config.bundle.windows.nsis.installMode = 'perMachine';
  assert.equal(check(data, 'window').ok, false);
  assert.equal(check(data, 'windows-installer').ok, false);
});
test('missing SDK is blocked, exit 2 and never a verified build', () => {
  const report = summarizeReadiness({ platform: 'windows', configuration: inspectNativeConfiguration(fixture()), environment: [{ id: 'rustc', ok: false, detail: 'mock: absent' }] });
  assert.equal(report.status, 'blocked');
  assert.equal(report.exitCode, 2);
  assert.deepEqual(report.missing, ['rustc']);
  assert.equal(report.nativeBuildVerified, false);
});
test('all prerequisite presence still does not prove native compilation', () => {
  const report = summarizeReadiness({ platform: 'android', configuration: inspectNativeConfiguration(fixture()), environment: [{ id: 'android-sdk', ok: true, detail: 'mock: present' }] });
  assert.equal(report.status, 'prerequisites-detected');
  assert.equal(report.exitCode, 0);
  assert.equal(report.nativeBuildVerified, false);
  assert.match(report.nextStep, /remain unverified/);
});
test('Rust entry retains mobile support without custom commands or privileged plugins', () => {
  const lib = readFileSync(new URL('src-tauri/src/lib.rs', root), 'utf8');
  const main = readFileSync(new URL('src-tauri/src/main.rs', root), 'utf8');
  assert.match(lib, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]/);
  assert.match(lib, /tauri::Builder::default\(\)/);
  assert.match(main, /lime_workbench_lib::run\(\)/);
  assert.doesNotMatch(lib, /invoke_handler|tauri::command|\.plugin\(/);
});
