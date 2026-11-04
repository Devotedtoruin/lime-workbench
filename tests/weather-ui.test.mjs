import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherController } from '../js/weather-ui.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  let state = { settings: { place: '', coord: null } }, writes = 0;
  const rendered = [], messages = [], busy = [];
  const services = { geocode: async name => ({ name, lat: 1, lon: 2 }), fetchWeather: async () => ({ current: {} }),
    advice: () => [], autoWeather: async () => ({ ok: false, message: '定位失败' }), ...overrides };
  const controller = createWeatherController({ getState: () => state, save() { writes++; return true; },
    renderWeather: (...args) => rendered.push(args), toast: m => messages.push(m), setBusy: b => busy.push(b), services });
  return { controller, rendered, messages, busy, get state() { return state; }, get writes() { return writes; },
    replace(settings = { place: '', coord: null }) { state = { settings }; controller.invalidate(); } };
}

test('a delayed geocode cannot restore location after import, reset or external replacement', async () => {
  const pending = deferred(), env = fixture({ geocode: () => pending.promise });
  const request = env.controller.city('旧地点');
  env.replace({ place: '导入地点', coord: { lat: 10, lon: 20 } });
  pending.resolve({ name: '旧地点', lat: 1, lon: 2 });
  assert.equal(await request, false); assert.equal(env.writes, 0); assert.equal(env.rendered.length, 0);
  assert.equal(env.state.settings.place, '导入地点'); assert.equal(env.busy.at(-1), false);
});

test('a delayed forecast is aborted and cannot render after replacement', async () => {
  const pending = deferred(); let signal;
  const env = fixture({ fetchWeather: (lat, lon, days, options) => { signal = options.signal; return pending.promise; } });
  const request = env.controller.city('旧地点'); await Promise.resolve();
  env.replace(); assert.equal(signal.aborted, true);
  pending.resolve({ current: {} }); assert.equal(await request, false);
  assert.equal(env.writes, 0); assert.equal(env.rendered.length, 0);
});

test('a saved-location startup cannot replace a newer manual query or clear its busy status', async () => {
  const pending = deferred(); let count = 0;
  const env = fixture({ fetchWeather: () => ++count === 1 ? pending.promise : Promise.resolve({ newer: true }) });
  env.replace({ place: '旧地点', coord: { lat: 1, lon: 2 } });
  const old = env.controller.refreshSaved();
  const current = env.controller.city('新地点'); await current;
  pending.resolve({ older: true }); await old;
  assert.equal(env.rendered.length, 1); assert.equal(env.rendered[0][1], '新地点'); assert.equal(env.writes, 1);
});

test('successful selection saves before rendering, and duplicate manual submissions are bounded', async () => {
  const pending = deferred(), env = fixture({ geocode: () => pending.promise });
  const first = env.controller.city('杭州'); assert.equal(await env.controller.city('重复'), false);
  pending.resolve({ name: '杭州', lat: 30, lon: 120 }); assert.equal(await first, true);
  assert.equal(env.writes, 1); assert.equal(env.state.settings.place, '杭州'); assert.equal(env.rendered.length, 1);
});

test('failed persistence must not display the queried city as saved success', async () => {
  const rendered = []; let writes = 0;
  const state = { settings: { place: '', coord: null } };
  const controller = createWeatherController({ getState: () => state, save() { writes++; return false; },
    renderWeather: value => rendered.push(value), services: { geocode: async () => ({ name: '示例', lat: 1, lon: 2 }),
      fetchWeather: async () => ({}), advice: () => [] } });
  assert.equal(await controller.city('示例'), false); assert.equal(writes, 1); assert.equal(rendered.length, 0);
});

test('external location changes invalidate even before their storage listener runs', async () => {
  const pending = deferred(), env = fixture({ geocode: () => pending.promise });
  const run = env.controller.city('旧地点'); env.state.settings.place = '新地点';
  pending.resolve({ name: '旧地点', lat: 1, lon: 2 }); await run;
  assert.equal(env.writes, 0); assert.equal(env.state.settings.place, '新地点');
});
