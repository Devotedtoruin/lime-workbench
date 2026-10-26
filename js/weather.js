// weather.js — 用户主动查询天气与位置（模块加载不发起定位或网络请求）。
// Nominatim 公共服务要求整体最多 1 请求/秒、非自动补全、有效 Referer/UA、归属标注和缓存。
// 浏览器不能自定义 User-Agent；使用浏览器 Referer。此处按当前页面会话串行限速/缓存，
// 多用户共享服务仍需部署代理集中限流。政策：https://operations.osmfoundation.org/policies/nominatim/
// Open-Meteo 免费端点仅限非商业用途，限 600/分钟、5000/小时、10000/天且需归属标注。
// 条款：https://open-meteo.com/en/terms

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 8000;
const NOMINATIM_GAP_MS = 1100;
const GEO_CACHE_TTL_MS = 30 * 60 * 1000;
const GEO_CACHE_MAX = 60;
const geoCache = new Map();
let geoQueue = Promise.resolve();
let lastGeoRequestAt = -Infinity;

export class WeatherError extends Error {
  constructor(provider, code, message, status = null) {
    super(message);
    this.name = 'WeatherError';
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

function coordinates(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (lat == null || lon == null || String(lat).trim() === '' || String(lon).trim() === '' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new WeatherError('location', 'invalid-coordinates', '经纬度无效，请重新选择地点');
  }
  return { lat: latitude, lon: longitude };
}

async function fetchJson(url, provider, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  let timer;
  try {
    // 请求和 JSON 读取共同受时限约束，即使测试/代理未遵守 AbortSignal 也不挂起。
    const response = await Promise.race([
      (async () => {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) {
          const code = r.status === 429 ? 'rate-limited' : 'http';
          throw new WeatherError(provider, code,
            r.status === 429 ? `${provider} 请求过于频繁，请稍后再试` : `${provider} 服务暂不可用（HTTP ${r.status}）`, r.status);
        }
        try { return await r.json(); }
        catch (error) {
          throw new WeatherError(provider, 'invalid-response', `${provider} 返回的数据无法解析`);
        }
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new WeatherError(provider, 'timeout', `${provider} 请求超时，请稍后再试`));
        }, FETCH_TIMEOUT_MS);
      })
    ]);
    return response;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Request canceled', 'AbortError');
    if (error instanceof WeatherError) throw error;
    throw new WeatherError(provider, 'network', `${provider} 网络请求失败，请检查连接`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function cachedGeocode(key, request) {
  const hit = geoCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  geoCache.delete(key);
  const scheduled = geoQueue.catch(() => {}).then(async () => {
    const wait = Math.max(0, NOMINATIM_GAP_MS - (Date.now() - lastGeoRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeoRequestAt = Date.now();
    return request();
  });
  geoQueue = scheduled.catch(() => {});
  const promise = scheduled.catch(error => { geoCache.delete(key); throw error; });
  geoCache.set(key, { promise, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  if (geoCache.size > GEO_CACHE_MAX) geoCache.delete(geoCache.keys().next().value);
  return promise;
}

/** WMO 天气代码 → 中文 + 图标 */
const WMO = {
  0: { txt: '晴', icon: 'sun' },
  1: { txt: '晴间多云', icon: 'suncloud' },
  2: { txt: '多云', icon: 'suncloud' },
  3: { txt: '阴', icon: 'cloud' },
  45: { txt: '雾', icon: 'fog' },
  48: { txt: '冻雾', icon: 'fog' },
  51: { txt: '毛毛雨', icon: 'rain' },
  53: { txt: '毛毛雨', icon: 'rain' },
  55: { txt: '毛毛雨', icon: 'rain' },
  61: { txt: '小雨', icon: 'rain' },
  63: { txt: '中雨', icon: 'rain' },
  65: { txt: '大雨', icon: 'rain' },
  66: { txt: '冻雨', icon: 'rain' },
  67: { txt: '冻雨', icon: 'rain' },
  71: { txt: '小雪', icon: 'snow' },
  73: { txt: '中雪', icon: 'snow' },
  75: { txt: '大雪', icon: 'snow' },
  77: { txt: '雪粒', icon: 'snow' },
  80: { txt: '阵雨', icon: 'rain' },
  81: { txt: '阵雨', icon: 'rain' },
  82: { txt: '暴雨', icon: 'rain' },
  85: { txt: '阵雪', icon: 'snow' },
  86: { txt: '阵雪', icon: 'snow' },
  95: { txt: '雷阵雨', icon: 'storm' },
  96: { txt: '雷暴伴冰雹', icon: 'storm' },
  99: { txt: '雷暴伴冰雹', icon: 'storm' }
};
export function decodeWMO(code) {
  const value = code === null || code === undefined || code === '' ? NaN : Number(code);
  return Number.isInteger(value) ? WMO[value] || { txt: '未知', icon: 'cloud' }
    : { txt: '未知', icon: 'cloud' };
}

/** 请求定位只发生于显式调用；拒绝授权/无可用定位时返回 null。 */
export function getPosition(timeout = 8000) {
  return new Promise(resolve => {
    const location = typeof navigator === 'undefined' ? null : navigator.geolocation;
    if (!location || !Number.isFinite(timeout) || timeout < 1 || timeout > 30000) return resolve(null);
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);
    try {
      location.getCurrentPosition(
        pos => {
          try { finish(coordinates(pos?.coords?.latitude, pos?.coords?.longitude)); }
          catch { finish(null); }
        },
        () => finish(null),
        { timeout, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }
      );
    } catch { finish(null); }
  });
}

/**
 * 从 Nominatim 地址里挑一个「打工人认得出的地名」。
 *
 * 关键点：不要用街道（suburb）。查天气的人想知道的是「我在哪个城市」，
 * 而不是「我在哪条街道」。实测把白山市中心显示成「红旗街道 · 浑江区」，
 * 用户完全无法确认这是不是自己所在的地方。
 *
 * 中文地址还有个坑：Nominatim 常把市辖区（浑江区）当成 city 字段，
 * 真正的市名（白山市）只出现在 display_name 里。因此对中文优先取
 * display_name 中以「市」结尾的分量。
 *
 * @param {object} address   Nominatim address 对象
 * @param {string} displayName Nominatim display_name
 * @param {boolean} keepDistrict 手动搜索时为 true：用户自己输入了区名，
 *   回显出来才能确认匹配到了哪里。定位反查时为 false，只给城市。
 */
function locationName(address = {}, displayName = '', keepDistrict = false) {
  const city = address.city || address.town || address.municipality ||
    address.village || address.county || address.state || '';
  const region = address.state || address.province || '';
  const country = address.country || '';

  // 中文：display_name 里以「市」结尾的分量通常才是用户认知里的城市名。
  const parts = String(displayName).split(',').map(s => s.trim()).filter(Boolean);
  const cityFromDisplay = parts.find(part => /市$/u.test(part) && part.length <= 8);

  let primary = city;
  if (cityFromDisplay && /[\p{Script=Han}]/u.test(cityFromDisplay)) {
    // 只有当结构化字段给的不是「市」级名称时才采用 display_name 里的市名。
    primary = /市$/u.test(city) ? city : cityFromDisplay;
  }

  // 用户主动搜索时，把匹配到的区/县一并回显（例如「朝阳区 · 北京市」）。
  const district = address.city_district || address.district || address.borough || '';
  const showDistrict = keepDistrict && district && district !== primary &&
    !String(primary).includes(district);

  const secondary = showDistrict ? primary
    : [region, country].find(value => value && value !== primary) || '';
  return [showDistrict ? district : primary, secondary].filter(Boolean).join(' · ');
}

/** 经纬度 → 城市名；请求与搜索共享一秒间隔。 */
export function reverseGeocode(lat, lon) {
  const coord = coordinates(lat, lon);
  const key = `reverse:${coord.lat.toFixed(4)},${coord.lon.toFixed(4)}`;
  return cachedGeocode(key, async () => {
    const params = new URLSearchParams({ format: 'json', addressdetails: '1', lat: String(coord.lat), lon: String(coord.lon), zoom: '10', 'accept-language': 'zh-CN' });
    const data = await fetchJson(`${NOMINATIM}/reverse?${params}`, 'Nominatim');
    if (!data || typeof data !== 'object' || !data.address) return null;
    return { name: locationName(data.address, data.display_name) || '当前位置', detail: data.display_name || '' };
  });
}

function canonical(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[市区县省]$/u, '');
}

function placeComponents(place) {
  const a = place.address || {};
  return [place.name, a.city, a.town, a.municipality, a.village, a.county,
    a.city_district, a.district, a.suburb, a.borough, a.state, a.country].filter(Boolean);
}

/**
 * Nominatim 有时返回带官方后缀的名字（查「东京」得到 name「东京都/東京都」），
 * 纯精确相等会漏掉唯一且无歧义的结果。仅在**纯汉字、长度 ≥ 2** 且用户输入是
 * 地点名前缀时放宽；拉丁字母不做包含匹配，避免「York」误配到「New York」。
 */
function prefixOfName(place, normalized) {
  if (!/^[\p{Script=Han}]{2,}$/u.test(normalized)) return false;
  const name = canonical(place.name);
  return name.length > normalized.length && name.startsWith(normalized);
}

function matchingPlace(place, parts) {
  if (!place || !['place', 'boundary', undefined].includes(place.category ?? place.class)) return false;
  const values = placeComponents(place).map(canonical);
  if (!values.length) return false;
  const a = place.address || {};
  const combinations = [
    [a.country, a.state, a.city, a.city_district],
    [a.state, a.city, a.city_district], [a.state, a.city],
    [a.city, a.city_district], [a.city_district, a.city],
    [a.state, a.town], [a.town, a.suburb], [a.city, a.suburb]
  ].map(parts => parts.filter(Boolean).join('')).filter(Boolean);
  const simplified = value => canonical(value).replace(/[省市区县]/gu, '').replace(/\s/g, '');
  return parts.every(part => {
    const normalized = canonical(part);
    return values.includes(normalized) || prefixOfName(place, normalized) ||
      /[\p{Script=Han}]/u.test(normalized) &&
      combinations.some(combination => simplified(combination) === simplified(normalized));
  });
}

function chosenPlace(rows, query) {
  if (!Array.isArray(rows)) throw new WeatherError('Nominatim', 'invalid-response', '地点查询结果格式有误');
  const parts = query.split(/[,，、]|\s+/u).map(s => s.trim()).filter(Boolean);
  const matched = rows.filter(row => {
    if (!matchingPlace(row, parts)) return false;
    try { coordinates(row.lat, row.lon); return true; } catch { return false; }
  });
  if (!matched.length) return null;
  const lastPart = canonical(parts.at(-1));
  const exact = matched.filter(row => canonical(row.name) === lastPart);
  const suffix = matched.filter(row => {
    const name = canonical(row.name);
    return /[\p{Script=Han}]/u.test(lastPart) && name.length >= 2 && lastPart.endsWith(name);
  });
  const candidates = exact.length ? exact : suffix.length ? suffix : matched;
  // 同名城市/区跨地区时拒绝猜测：要求用户输入省份/国家等更多信息。
  const first = candidates[0];
  const coord = coordinates(first.lat, first.lon);
  const isDistinct = candidates.slice(1).some(row => {
    const other = coordinates(row.lat, row.lon);
    const a = first.address || {};
    const b = row.address || {};
    return Math.abs(other.lat - coord.lat) > 0.2 || Math.abs(other.lon - coord.lon) > 0.2 ||
      a.country && b.country && canonical(a.country) !== canonical(b.country) ||
      a.state && b.state && canonical(a.state) !== canonical(b.state);
  });
  if (isDistinct) return null;
  const a = first.address || {};
  // 手动搜索时保留区/县，让用户能确认匹配到了哪个同名地点。
  const base = locationName(a, first.display_name, true) || first.name || '';
  return { ...coord, name: base || first.display_name || query,
    detail: first.display_name || '' };
}

/** 手动城市查询：无匹配或同名地点有歧义时返回 null，网络失败抛 WeatherError。 */
export function geocode(city) {
  const query = String(city || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > 120) return Promise.resolve(null);
  const key = `search:${query.toLocaleLowerCase()}`;
  return cachedGeocode(key, async () => {
    const params = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '10', layer: 'address', q: query, 'accept-language': 'zh-CN' });
    const rows = await fetchJson(`${NOMINATIM}/search?${params}`, 'Nominatim');
    return chosenPlace(rows, query);
  });
}

/** 拉天气；坐标和预报天数先验证，错误携带 provider/code/status。 */
export async function fetchWeather(lat, lon, days = 5, options = {}) {
  const coord = coordinates(lat, lon);
  if (!Number.isInteger(days) || days < 1 || days > 16) {
    throw new WeatherError('Open-Meteo', 'invalid-days', '预报天数须在 1–16 天之间');
  }
  const params = new URLSearchParams({
    latitude: String(coord.lat), longitude: String(coord.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    timezone: 'auto', forecast_days: String(days)
  });
  const json = await fetchJson(`${OPEN_METEO}?${params}`, 'Open-Meteo', options);
  if (!json || typeof json !== 'object' || !json.current || !json.daily) {
    throw new WeatherError('Open-Meteo', 'invalid-response', '天气数据格式有误，请稍后再试');
  }
  return normalize(json);
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function weatherCode(value) {
  const n = finite(value);
  return n !== null && Number.isInteger(n) ? n : null;
}

function probability(value) {
  const n = finite(value);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

function normalize(j) {
  const cur = j.current || {};
  const daily = j.daily || {};
  const hourly = j.hourly || {};
  const days = (Array.isArray(daily.time) ? daily.time : []).map((t, i) => {
    const code = weatherCode(daily.weather_code?.[i]);
    return {
      date: typeof t === 'string' ? t : null,
      max: finite(daily.temperature_2m_max?.[i]),
      min: finite(daily.temperature_2m_min?.[i]),
      code,
      pop: probability(daily.precipitation_probability_max?.[i]),
      sunrise: typeof daily.sunrise?.[i] === 'string' ? daily.sunrise[i] : null,
      sunset: typeof daily.sunset?.[i] === 'string' ? daily.sunset[i] : null,
      ...decodeWMO(code)
    };
  });
  const currentCode = weatherCode(cur.weather_code);
  return {
    current: {
      temp: finite(cur.temperature_2m),
      feels: finite(cur.apparent_temperature),
      humidity: probability(cur.relative_humidity_2m),
      wind: finite(cur.wind_speed_10m),
      code: currentCode,
      ...decodeWMO(currentCode)
    },
    days,
    hourly: (Array.isArray(hourly.time) ? hourly.time : []).map((t, i) => ({
      time: typeof t === 'string' ? t : null,
      temp: finite(hourly.temperature_2m?.[i]),
      pop: probability(hourly.precipitation_probability?.[i]),
      code: weatherCode(hourly.weather_code?.[i])
    })),
    timezone: typeof j.timezone === 'string' ? j.timezone : null
  };
}

/* ============================================================
 *  生活建议：把天气变成「打工人能用的一句话」
 * ============================================================ */
export function advice(wx, profile = {}, now = new Date()) {
  const tips = [];
  const cur = wx?.current;
  const today = wx?.days?.[0];
  if (!cur) return tips;

  const rainCodes = [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  const pop = probability(today?.pop);
  const raining = rainCodes.includes(cur.code) || rainCodes.includes(today?.code);
  if (pop !== null && pop >= 60 || raining) {
    tips.push({ icon: 'umbrella', text: '今天可能下雨，出门记得带伞 ☔' });
  } else if (pop !== null && pop >= 30) {
    tips.push({ icon: 'umbrella', text: `降水概率 ${pop}%，建议备把伞` });
  }

  const t = finite(cur.feels ?? cur.temp);
  if (t !== null && t <= 0) tips.push({ icon: 'warning', text: '零下了，注意保暖，别冻着' });
  else if (t !== null && t <= 10) tips.push({ icon: 'warning', text: '挺冷的，出门加件外套' });
  else if (t !== null && t >= 33) tips.push({ icon: 'sun', text: '高温天，多喝水少暴晒' });
  else if (t !== null && t >= 28) tips.push({ icon: 'sun', text: '有点热，注意防晒' });

  const humidity = probability(cur.humidity);
  if (humidity !== null && humidity >= 85) tips.push({ icon: 'warning', text: '湿度很大，体感会更闷' });
  const wind = finite(cur.wind);
  if (wind !== null && wind >= 40) tips.push({ icon: 'wind', text: '风很大，注意安全' });

  const tomorrowPop = probability(wx?.days?.[1]?.pop);
  if (tomorrowPop !== null && tomorrowPop >= 60) {
    tips.push({ icon: 'umbrella', text: `明天大概率下雨（${tomorrowPop}%），提前安排` });
  }

  // now 可注入固定日期供测试，未提供时只使用一次实时钟。
  const match = /^(\d{1,2}):(\d{2})$/.exec(profile?.offTime || '');
  if (match && Number(match[1]) <= 23 && Number(match[2]) <= 59) {
    const off = new Date(now);
    off.setHours(Number(match[1]), Number(match[2]), 0, 0);
    const diff = off - new Date(now);
    if (diff > 0 && diff < 3600000 && (pop !== null && pop >= 40 || t !== null && t < 6)) {
      tips.push({ icon: 'umbrella', text: '快下班了，出门前记得看一眼天气' });
    }
  }

  // 全天有高降水概率/雨雪雷暴或大风时，即使此刻晴也不建议室外跑步。
  if ([0, 1, 2].includes(cur.code) && t !== null && t > 8 && t < 30 &&
      wind !== null && wind < 30 && pop !== null && pop < 30 && !raining &&
      ![71, 73, 75, 77, 85, 86].includes(today?.code)) {
    tips.push({ icon: 'run', text: '天气不错，下班去跑跑步吧 🏃' });
  }
  return tips;
}

/** 一键搞定：仅被用户调用时才定位 → 城市名 → 天气 → 建议。 */
export async function autoWeather(profile = {}, options = {}) {
  const checkCanceled = () => { if (options.signal?.aborted) throw new DOMException('Request canceled', 'AbortError'); };
  checkCanceled();
  const pos = await getPosition();
  checkCanceled();
  if (!pos) return { ok: false, reason: 'no-location', message: '无法获取定位，请手动输入城市' };
  let place = null;
  try { place = await reverseGeocode(pos.lat, pos.lon); }
  catch { /* 地址查询失败仍可按坐标显示天气 */ }
  try {
    checkCanceled();
    const wx = await fetchWeather(pos.lat, pos.lon, 5, options);
    return {
      ok: true,
      place: place?.name || '当前位置',
      coord: pos,
      weather: wx,
      tips: advice(wx, profile)
    };
  } catch (error) {
    checkCanceled();
    return { ok: false, reason: 'weather-unavailable', message: error.message || '天气获取失败',
      code: error.code || 'unknown', status: error.status ?? null };
  }
}
