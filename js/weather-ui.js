// Weather requests belong to the settings snapshot that started them, never a later import or tab update.
import { autoWeather, geocode, fetchWeather, advice } from './weather.js';

export function createWeatherController({ getState, save, renderWeather, toast = () => {}, setBusy = () => {},
  services = { autoWeather, geocode, fetchWeather, advice } }) {
  let revision = 0, active = null;
  const locationStamp = () => JSON.stringify([getState().settings.place, getState().settings.coord]);
  function invalidate() {
    revision++; active?.controller.abort(); active = null; setBusy(false);
  }
  function begin(kind) {
    const run = { kind, revision: ++revision, location: locationStamp(), controller: new AbortController() };
    active?.controller.abort(); active = run; setBusy(true); return run;
  }
  const current = run => active === run && run.revision === revision && run.location === locationStamp() && !run.controller.signal.aborted;
  function finish(run) { if (active === run) { active = null; setBusy(false); } }
  async function request(kind, input) {
    if (active && active.kind !== 'saved' && kind !== 'saved') return false;
    const city = String(input || '').trim();
    if (kind === 'city' && !city) { toast('请输入城市名称'); return false; }
    const run = begin(kind), options = { signal: run.controller.signal };
    try {
      let result;
      if (kind === 'auto') {
        result = await services.autoWeather({ ...getState().settings }, options);
        if (!current(run)) return false;
        if (!result.ok) { toast(result.message || '未能更新天气，请手动搜索城市'); return false; }
      } else {
        const settings = getState().settings;
        const place = kind === 'saved' ? { ...settings.coord, name: settings.place } : await services.geocode(city);
        if (!current(run)) return false;
        if (!place) { toast('没有找到精确地点，请补充省份或国家'); return false; }
        const weather = await services.fetchWeather(place.lat, place.lon, 5, options);
        result = { weather, place: place.name, coord: { lat: place.lat, lon: place.lon } };
      }
      if (!current(run)) return false;
      if (kind !== 'saved') {
        Object.assign(getState().settings, { place: result.place, coord: result.coord });
        if (!save()) return false;
      }
      renderWeather(result.weather, result.place, services.advice(result.weather, getState().settings));
      if (kind !== 'saved') toast('天气已更新');
      return true;
    } catch (error) {
      if (current(run) && kind !== 'saved' && error?.name !== 'AbortError') toast(error?.message || '天气查询失败，可以稍后重试');
      return false;
    } finally { finish(run); }
  }
  return {
    invalidate,
    city: value => request('city', value),
    locate: () => request('auto'),
    refreshSaved() {
      const settings = getState().settings;
      return settings.coord && settings.place ? request('saved') : Promise.resolve(false);
    }
  };
}
