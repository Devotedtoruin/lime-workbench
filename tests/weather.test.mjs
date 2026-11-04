import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWMO, advice, geocode, reverseGeocode, fetchWeather, getPosition, autoWeather, WeatherError } from '../js/weather.js';

const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

async function withFetch(mock, check) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await check(); }
  finally { globalThis.fetch = previous; }
}

test('WMO 天气代码解码', () => {
  assert.equal(decodeWMO(0).txt, '晴');
  assert.equal(decodeWMO(61).txt, '小雨');
  assert.equal(decodeWMO(95).txt, '雷阵雨');
  assert.equal(decodeWMO(999).txt, '未知'); // 未知代码兜底
});

test('降水概率高时建议带伞', () => {
  const wx = {
    current: { temp: 20, feels: 20, humidity: 60, wind: 5, code: 0, txt: '晴', icon: 'sun' },
    days: [{ date: '2026-10-12', pop: 70, min: 15, max: 22, code: 61, txt: '小雨', icon: 'rain' }]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('伞')));
});

test('低温时提醒保暖', () => {
  const wx = {
    current: { temp: -3, feels: -6, humidity: 50, wind: 5, code: 0, txt: '晴', icon: 'sun' },
    days: [{ date: '2026-10-12', pop: 0, min: -5, max: 2, code: 0, txt: '晴', icon: 'sun' }]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('保暖') || t.text.includes('冷')));
});

test('高温时提醒防晒', () => {
  const wx = {
    current: { temp: 35, feels: 38, humidity: 40, wind: 3, code: 0, txt: '晴', icon: 'sun' },
    days: [{ date: '2026-10-12', pop: 0, min: 28, max: 36, code: 0, txt: '晴', icon: 'sun' }]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('防晒') || t.text.includes('喝水')));
});

test('明天有雨会提前说', () => {
  const wx = {
    current: { temp: 22, feels: 22, humidity: 50, wind: 3, code: 0, txt: '晴', icon: 'sun' },
    days: [
      { date: '2026-10-12', pop: 0, min: 15, max: 25, code: 0, txt: '晴', icon: 'sun' },
      { date: '2026-10-13', pop: 80, min: 14, max: 20, code: 61, txt: '小雨', icon: 'rain' }
    ]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('明天')));
});

test('天气好时给运动建议', () => {
  const wx = {
    current: { temp: 22, feels: 22, humidity: 50, wind: 3, code: 0, txt: '晴', icon: 'sun' },
    days: [{ date: '2026-10-12', pop: 0, min: 15, max: 25, code: 0, txt: '晴', icon: 'sun' }]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('跑')));
});

test('大风提醒', () => {
  const wx = {
    current: { temp: 22, feels: 22, humidity: 50, wind: 45, code: 2, txt: '多云', icon: 'suncloud' },
    days: [{ date: '2026-10-12', pop: 0, min: 15, max: 25, code: 2, txt: '多云', icon: 'suncloud' }]
  };
  const tips = advice(wx);
  assert.ok(tips.some(t => t.text.includes('风')));
});

test('下班前一小时的通勤提醒可以用固定时间复现', () => {
  const now = new Date(2026, 9, 12, 17, 20);
  const wx = {
    current: { temp: 4, feels: 2, humidity: 50, wind: 3, code: 0, txt: '晴', icon: 'sun' },
    days: [{ date: '2026-10-12', pop: 0, min: 0, max: 10, code: 0, txt: '晴', icon: 'sun' }]
  };
  const tips = advice(wx, { offTime: '18:00' }, now);
  assert.ok(tips.some(t => t.text.includes('快下班')));
  assert.ok(!advice(wx, { offTime: '18:00' }, new Date(2026, 9, 12, 12)).some(t => t.text.includes('快下班')));
});

test('危险风雨和未知数据不输出跑步建议', () => {
  const base = { current: { temp: 20, feels: 20, humidity: 40, code: 0, wind: 5 }, days: [{ pop: 0, code: 0 }] };
  const run = weather => advice(weather).some(t => t.icon === 'run');
  assert.ok(run(base));
  assert.equal(run({ ...base, current: { ...base.current, wind: 45 } }), false);
  assert.equal(run({ ...base, days: [{ pop: 70, code: 0 }] }), false);
  assert.equal(run({ ...base, days: [{ pop: 0, code: 95 }] }), false);
  assert.equal(run({ ...base, current: { ...base.current, wind: null } }), false);
  assert.equal(run({ ...base, days: [{ pop: null, code: 0 }] }), false);
});

test('天气请求先校验经纬度、预报天数且缺测值保持 null', async () => {
  await withFetch(async url => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('latitude'), '31.2');
    assert.equal(u.searchParams.get('forecast_days'), '5');
    return response({
      current: { temperature_2m: null, apparent_temperature: 'bad', weather_code: null, relative_humidity_2m: 0 },
      daily: { time: ['2026-10-12'], temperature_2m_max: [null], precipitation_probability_max: ['bad'], weather_code: [null] },
      hourly: { time: ['2026-10-12T00:00'], precipitation_probability: [null] }
    });
  }, async () => {
    const wx = await fetchWeather(31.2, 121.5);
    assert.equal(wx.current.temp, null);
    assert.equal(wx.current.feels, null);
    assert.equal(wx.current.code, null);
    assert.equal(wx.current.txt, '未知');
    assert.equal(wx.current.humidity, 0);
    assert.equal(wx.days[0].max, null);
    assert.equal(wx.days[0].pop, null);
    assert.equal(wx.hourly[0].pop, null);
    assert.equal(decodeWMO(null).txt, '未知');
    assert.equal(JSON.stringify(wx).includes('NaN'), false);
  });
  let calls = 0;
  await withFetch(() => { calls++; throw new Error('must not be called'); }, async () => {
    await assert.rejects(fetchWeather(91, 0), error => error instanceof WeatherError && error.code === 'invalid-coordinates');
    await assert.rejects(fetchWeather(20, Infinity), error => error.code === 'invalid-coordinates');
    await assert.rejects(fetchWeather(20, 30, 0), error => error.code === 'invalid-days');
    assert.throws(() => reverseGeocode('bad', 30), error => error.code === 'invalid-coordinates');
    assert.equal(await geocode(''), null);
  });
  assert.equal(calls, 0);
});

test('服务失败返回可区分的错误信息；超时会中止悬挂的 fetch', async () => {
  await withFetch(async () => response({}, 429), async () => {
    await assert.rejects(fetchWeather(10, 20), error => error instanceof WeatherError &&
      error.provider === 'Open-Meteo' && error.code === 'rate-limited' && error.status === 429 && error.message.includes('频繁'));
  });
  let signal;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 8000 ? 0 : delay, ...args);
  try {
    await withFetch((_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    }, async () => {
      await assert.rejects(fetchWeather(10, 21), error => error.code === 'timeout' && error.message.includes('超时'));
      assert.equal(signal.aborted, true);
    });
  } finally { globalThis.setTimeout = originalTimeout; }
});

test('手动地点查询只选精准城市/区且使用真实返回地点名称', async () => {
  const results = [
    { category: 'place', name: '朝阳区', lat: '43.86', lon: '125.29', display_name: '朝阳区, 长春市, 吉林省',
      address: { city_district: '朝阳区', city: '长春市', state: '吉林省', country: '中国' } },
    { category: 'place', name: '朝阳区', lat: '39.92', lon: '116.44', display_name: '朝阳区, 北京市',
      address: { city_district: '朝阳区', city: '北京市', state: '北京市', country: '中国' } }
  ];
  let calls = 0;
  await withFetch(async (url, options) => {
    calls++;
    const query = new URL(url).searchParams;
    assert.equal(query.get('addressdetails'), '1');
    assert.equal(query.get('limit'), '10');
    assert.equal(query.get('layer'), 'address');
    assert.equal(options.headers?.['User-Agent'], undefined);
    return response(results);
  }, async () => {
    const place = await geocode('北京市 朝阳区');
    assert.equal(place.lat, 39.92);
    assert.equal(place.lon, 116.44);
    assert.match(place.name, /朝阳区 · 北京市/);
    assert.equal(await geocode('北京市 朝阳区'), place);
    assert.equal(calls, 1);
    assert.equal(await geocode('朝阳区'), null); // 同名跨地区，不猜第一个
  });
});

test('同一城市的行政区排在前也选用户输入的城市', async () => {
  await withFetch(async () => response([
    { category: 'place', name: '朝阳区', lat: '39.92', lon: '116.44', address: { city_district: '朝阳区', city: '北京市', country: '中国' } },
    { category: 'place', name: '北京市', lat: '39.90', lon: '116.40', address: { city: '北京市', country: '中国' } }
  ]), async () => {
    const chosen = await geocode('北京市');
    assert.equal(chosen.lat, 39.90);
    assert.equal(chosen.lon, 116.40);
    assert.match(chosen.name, /^北京市/);
  });
});

test('非精确地名和不合法结果不静默选首项；搜索可返回无结果', async () => {
  await withFetch(async () => response([
    { category: 'place', name: 'New York', lat: '40.7', lon: '-74', address: { city: 'New York', country: '美国' } }
  ]), async () => {
    assert.equal(await geocode('York'), null);
  });
  await withFetch(async () => response([
    { category: 'place', name: '测试镇', lat: 'NaN', lon: '500', address: { town: '测试镇' } }
  ]), async () => {
    assert.equal(await geocode('测试镇'), null);
  });
  await withFetch(async () => response([]), async () => {
    assert.equal(await geocode('不存在的城镇'), null);
  });
});

// 以下 payload 来自 Nominatim 真实返回（tools/dump-fixtures.html 抓取），
// 覆盖「官方名带后缀」和「跨国同名」两类真实情况。
test('官方地名带后缀时仍能解析（东京 → 东京都/東京都）', async () => {
  await withFetch(async () => response([
    { category: 'boundary', type: 'administrative', name: '东京都/東京都', lat: '35.6768601', lon: '139.7638947',
      display_name: '东京都/東京都, 日本', address: { city: '东京都/東京都', country: '日本' } }
  ]), async () => {
    const place = await geocode('东京');
    assert.ok(place, '唯一且无歧义的结果不应被判为无匹配');
    assert.equal(Math.round(place.lat), 36);
    assert.match(place.name, /东京都/);
  });
});

test('拉丁字母不做包含匹配（York 不匹配 New York）', async () => {
  await withFetch(async () => response([
    { category: 'place', name: 'NewYork', lat: '40.7', lon: '-74', address: { city: 'NewYork', country: '美国' } }
  ]), async () => {
    assert.equal(await geocode('York'), null);
  });
});

test('跨国同名城市仍然拒绝猜测（白山市 → 中国 vs 日本）', async () => {
  await withFetch(async () => response([
    { category: 'boundary', type: 'administrative', name: '白山市', lat: '41.9368950', lon: '126.4183792',
      display_name: '白山市, 浑江区, 吉林省, 中国',
      address: { city: '白山市', county: '浑江区', state: '吉林省', country: '中国' } },
    { category: 'boundary', type: 'administrative', name: '白山市', lat: '36.5143504', lon: '136.5658067',
      display_name: '白山市, 石川县, 日本', address: { city: '白山市', country: '日本' } }
  ]), async () => {
    assert.equal(await geocode('白山市'), null);
  });
});

test('带省份的查询可以消解同名歧义（吉林省白山市）', async () => {
  await withFetch(async () => response([
    { category: 'boundary', type: 'administrative', name: '白山市', lat: '41.9368950', lon: '126.4183792',
      display_name: '白山市, 浑江区, 吉林省, 中国',
      address: { city: '白山市', county: '浑江区', state: '吉林省', country: '中国' } },
    { category: 'boundary', type: 'administrative', name: '白山市', lat: '36.5143504', lon: '136.5658067',
      display_name: '白山市, 石川县, 日本', address: { city: '白山市', country: '日本' } }
  ]), async () => {
    const place = await geocode('吉林省 白山市');
    assert.ok(place);
    assert.equal(Math.round(place.lat), 42);
    assert.match(place.name, /吉林省/);
  });
});

test('Nominatim 同会话去重缓存且不同请求串行遵守每秒间隔', async () => {
  const times = [];
  await withFetch(async (url, options) => {
    times.push(Date.now());
    assert.equal(options.headers?.['User-Agent'], undefined);
    const q = new URL(url).searchParams.get('q');
    return response([{ category: 'place', name: q, lat: '10', lon: '20', address: { city: q, country: '中国' } }]);
  }, async () => {
    const [first, same, next] = await Promise.all([
      geocode('缓存城市甲'), geocode('缓存城市甲'), geocode('缓存城市乙')
    ]);
    assert.equal(first, same);
    assert.notEqual(first.name, next.name);
    assert.equal(times.length, 2);
    assert.ok(times[1] - times[0] >= 1000, String(times));
  });
});

test('反查地点给出用户认得出的城市名，失败时可以不阻断天气', async () => {
  await withFetch(async url => {
    assert.equal(new URL(url).pathname, '/reverse');
    // 真实 Nominatim 返回：city 字段是市辖区，市名只在 display_name 里。
    return response({
      display_name: '红旗街道, 浑江区, 白山市, 浑江区, 吉林省, 134300, 中国',
      address: { suburb: '红旗街道', city: '浑江区', county: '浑江区', state: '吉林省', country: '中国' }
    });
  }, async () => {
    const place = await reverseGeocode(41.943, 126.42);
    // 不能显示成「红旗街道 · 浑江区」——用户无法确认这是哪里。
    assert.equal(place.name, '白山市 · 吉林省');
    assert.doesNotMatch(place.name, /街道/);
    assert.equal(await reverseGeocode(41.943, 126.42), place);
  });
});

test('反查直辖市时给出市名而不是区名', async () => {
  await withFetch(async () => response({
    display_name: '东华门街道, 首都功能核心区, 东城区, 北京市, 100010, 中国',
    address: { suburb: '东华门街道', city_district: '东城区', state: '北京市', country: '中国' }
  }), async () => {
    const place = await reverseGeocode(39.9042, 116.4074);
    // 首个分量必须是「北京市」，而不是街道或区。
    assert.equal(place.name.split(' · ')[0], '北京市');
    assert.doesNotMatch(place.name, /街道|东城区/);
  });
});

test('Nominatim 的 429 错误结构化，失败不缓存并可重试', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return calls === 1 ? response({}, 429) : response([
      { category: 'place', name: '重试市', lat: '34', lon: '114', address: { city: '重试市', country: '中国' } }
    ]);
  }, async () => {
    await assert.rejects(geocode('重试市'), error => error instanceof WeatherError &&
      error.provider === 'Nominatim' && error.code === 'rate-limited' && error.status === 429);
    assert.equal((await geocode('重试市')).lat, 34);
    assert.equal(calls, 2);
  });
});

test('没有显式调用定位/网络时不请求；无定位时自动天气结构化降级', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    await withFetch(() => { throw new Error('unexpected request'); }, async () => {
      assert.equal(await getPosition(), null);
      assert.deepEqual(await autoWeather(), { ok: false, reason: 'no-location', message: '无法获取定位，请手动输入城市' });
    });
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});
