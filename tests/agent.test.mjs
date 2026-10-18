import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  understand, normalizeAction, buildDailyBrief, budgetAlert, breakReminder,
  askLLM, resolveAgentEndpoint, loadAgentConfig, saveAgentConfig, DEFAULT_AGENT, isLLMReady,
  validateAgentConfig, checkAgentConnection, AGENT_CONNECTION_PROMPT
} from '../js/agent.js';

const NOW = new Date(2026, 9, 12, 10, 0);
const STATE = {
  settings: {},
  todos: [{ id: 1, text: '交房租', done: false, date: '2026-10-12' }],
  ledger: [{ id: 1, type: 'expense', amount: 28, note: '午饭', date: '2026-10-12' }],
  water: { '2026-10-12': [{ ml: 300, time: 1 }] },
  steps: { '2026-10-12': 8000 },
  study: { '2026-10-12': 3600 }
};

test('understand 能识别记账意图', () => {
  const r = understand('午饭28块', STATE, NOW);
  assert.equal(r.intent.kind, 'ledger');
  assert.equal(r.needConfirm, true);
});

test('understand 本地启动/记录/相对提醒均需要确认且不修改状态、不联网', t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('本地理解不应联网'); });
  const before = structuredClone(STATE);
  for (const [text, kind] of [
    ['开始专注45分钟', 'focus'], ['专注45分钟', 'focus'], ['已专注45分钟', 'study'],
    ['记录专注45分钟', 'study'], ['10分钟后提醒我开会', 'reminder'], ['提醒我半小时后写周报', 'reminder']
  ]) {
    const result = understand(text, STATE, NOW);
    assert.equal(result.intent.kind, kind, text);
    assert.equal(result.needConfirm, true);
    assert.equal(result.shortcut, undefined);
    assert.equal(result.needLLM, undefined);
    assert.match(result.reply, /请确认操作/);
    assert.doesNotMatch(result.reply, /我记下了|已启动/);
  }
  assert.deepEqual(STATE, before);
  assert.equal(requests, 0);
});

test('understand 快捷入口在AI之前，本地离线只导航/预填不自动记录', t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('快捷入口不应联网'); });
  const before = structuredClone(STATE);
  for (const [text, shortcut] of [
    ['骑行', { kind: 'prefill', page: 'sport', payload: { type: 'bike' } }],
    ['骑行5公里', { kind: 'prefill', page: 'sport', payload: { type: 'bike', distance: 5 } }],
    ['喝水', { kind: 'prefill', page: 'habits', payload: { field: 'water' } }],
    ['专注', { kind: 'navigate', page: 'study', payload: {} }],
    ['倒计时', { kind: 'navigate', page: 'calendar', payload: {} }],
    ['开会', { kind: 'prefill', page: 'todo', payload: { text: '开会' } }],
    ['打开写周报', { kind: 'prefill', page: 'todo', payload: { text: '写周报' } }]
  ]) {
    const result = understand(text, STATE, NOW);
    assert.deepEqual(result.shortcut, shortcut, text);
    assert.equal(result.intent, null);
    assert.equal(result.needConfirm, false);
    assert.equal(result.needLLM, undefined);
    if (shortcut.kind === 'prefill') assert.match(result.reply, /尚未保存记录/);
  }
  assert.deepEqual(STATE, before);
  assert.equal(requests, 0);
});

test('本地问答用正式口吻且不把缺失记录当真实情况，不泛化不相关问题', () => {
  const brief = buildDailyBrief({}, NOW);
  assert.match(brief, /暂无饮水记录/);
  assert.doesNotMatch(brief, /还没喝水|摸鱼|[\p{Extended_Pictographic}]/u);
  const spending = understand('本月花了多少', STATE, NOW);
  assert.match(spending.reply, /28\.00/);
  assert.match(spending.reply, /本地账目/);
  assert.match(understand('本月花了多少', {}, NOW).reply, /无法据此判断实际消费/);
  assert.match(understand('预算怎么样', STATE, NOW).reply, /参考预算/);
  assert.match(understand('休息一下', {}, NOW).reply, /无法判断/);
  for (const text of ['怎么合理安排预算', '学习怎么样更有效', '提醒我开会吗', '不要骑行', '今天没喝水', '怎么休息更好']) {
    const result = understand(text, STATE, NOW);
    assert.equal(result.intent, null, text);
    assert.equal(result.shortcut, undefined, text);
    assert.equal(result.reply, null, text);
    assert.equal(result.needLLM, true, text);
  }
  for (const reply of [buildDailyBrief(STATE, NOW), budgetAlert({ ledger: [{ type: 'expense', amount: 4000, date: '2026-10-01' }] }, 3000, NOW), breakReminder(STATE, NOW), DEFAULT_AGENT.persona]) {
    assert.doesNotMatch(reply, /摸鱼|[\p{Extended_Pictographic}]/u);
  }
});

test('understand 能给日报', () => {
  const r = understand('今天怎么样', STATE, NOW);
  assert.equal(r.intent, null);
  assert.ok(r.reply.includes('待办'));
});

test('understand 不懂时交给大模型', () => {
  const r = understand('给我讲个笑话', STATE, NOW);
  assert.equal(r.intent, null);
  assert.equal(r.reply, null);
  assert.equal(r.needLLM, true);
});

test('日报内容正确', () => {
  const s = buildDailyBrief(STATE, NOW);
  assert.ok(s.includes('交房租'));
  assert.ok(s.includes('300'));
  assert.ok(s.includes('8,000'));
});

test('预算告警', () => {
  assert.equal(budgetAlert({ ledger: [] }, 3000, NOW), null);
  const over = budgetAlert({ ledger: [{ type: 'expense', amount: 4000, date: '2026-10-01' }] }, 3000, NOW);
  assert.ok(over.includes('超出'));
});

test('久坐提醒', () => {
  assert.ok(breakReminder(STATE, NOW));
  assert.equal(breakReminder({ study: {} }, NOW), null);
});

test('大模型 action 归一化', () => {
  const it = normalizeAction({ kind: 'ledger', type: 'expense', amount: 28, note: '午饭' });
  assert.equal(it.kind, 'ledger');
  assert.equal(it.payload.amount, 28);
  assert.equal(normalizeAction({ kind: 'unknown' }), null);
  assert.equal(normalizeAction(null), null);
});

test('日报只统计今日/逾期未完成，并按优先级和时间而非数组首条排序', () => {
  const todos = [
    { text: '明天的任务', date: '2026-10-13', done: false, priority: 'high' },
    { text: '低优先级', date: '2026-10-12', done: false, priority: 'low', time: '08:00' },
    { text: '稍晚高优先级', date: '2026-10-12', done: false, priority: 'high', time: '15:00' },
    { text: '早间高优先级', date: '2026-10-12', done: false, priority: 'high', time: '09:00' },
    { text: '已完成', date: '2026-10-11', done: true },
    { text: '无日期', done: false }
  ];
  const before = structuredClone(todos);
  const brief = buildDailyBrief({ todos }, NOW);
  assert.match(brief, /3 件待办/);
  assert.match(brief, /优先处理「早间高优先级」/);
  assert.doesNotMatch(brief, /明天的任务|无日期|已完成|最急/);
  assert.deepEqual(todos, before, '排序不能修改state.todos');
  todos.push({ text: '逾期任务', date: '2026-10-11', done: false, priority: 'medium', time: '10:00' });
  assert.match(buildDailyBrief({ todos }, NOW), /优先处理「逾期任务」/);
  assert.match(buildDailyBrief({ todos: [{ text: '未来', date: '2026-10-13', done: false }] }, NOW), /今日和逾期待办已清空/);
});

test('日报使用动态waterGoal且不将累计学习说成连续', () => {
  const brief = buildDailyBrief({ ...STATE, settings: { waterGoal: 250 }, water: STATE.water }, NOW);
  assert.match(brief, /目标 250ml 已达标/);
  assert.match(brief, /今天累计专注学习了 60 分钟/);
  const higher = buildDailyBrief({ ...STATE, settings: { waterGoal: 3000 } }, NOW);
  assert.match(higher, /还差 2700ml/);
  assert.match(breakReminder(STATE, NOW), /今天累计专注 60 分钟/);
  assert.doesNotMatch(breakReminder(STATE, NOW), /连续|已经专注很久/);
  assert.doesNotThrow(() => buildDailyBrief(null, NOW));
});

test('normalizeAction拒绝非有限数、字符串、无效零、负数和超出实时录入范围的值', () => {
  const fields = [
    ['ledger', 'amount', 1_000_000_000], ['water', 'ml', 5_000],
    ['steps', 'steps', 200_000], ['study', 'minutes', 1440]
  ];
  for (const [kind, field, max] of fields) {
    const base = kind === 'ledger' ? { kind, type: 'expense' } : { kind };
    for (const value of [undefined, null, '', '28', true, 0, -1, NaN, Infinity, -Infinity, max + 1, {}, []]) {
      if (kind === 'steps' && value === 0) assert.deepEqual(normalizeAction({ kind, steps: 0 }), { kind, payload: { steps: 0 } });
      else assert.equal(normalizeAction({ ...base, [field]: value }), null, `${kind}.${field}: ${String(value)}`);
    }
    assert.ok(normalizeAction({ ...base, [field]: max }));
  }
  assert.equal(normalizeAction({ kind: 'steps', steps: 1.5 }), null);
  assert.equal(normalizeAction({ kind: 'water', ml: 1.5 }), null);
  assert.equal(normalizeAction({ kind: 'water', ml: 100_000 }), null);
  assert.equal(normalizeAction({ kind: 'steps', steps: 100_000_000 }), null);
  assert.equal(normalizeAction({ kind: 'ledger', type: 'garbage', amount: 28 }), null);
  assert.equal(normalizeAction({ kind: 'water', ml: 250, payload: { ml: 999 } }), null);
  assert.equal(normalizeAction([{ kind: 'water', ml: 250 }]), null);
  assert.equal(normalizeAction({ kind: 'ledger', type: 'expense', amount: 0.0000001 }), null);
});

test('AI白名单不接受本地focus/reminder/shortcut/navigate或任意模型动作', () => {
  for (const action of [
    { kind: 'focus', minutes: 45 }, { kind: 'reminder', minutes: 10, text: '开会' },
    { kind: 'navigate', page: 'study' }, { kind: 'prefill', page: 'sport', payload: { type: 'bike' } },
    { kind: 'sport', type: 'bike', minutes: 30 }, { kind: 'delete', id: 1 },
    { kind: 'constructor' }, { kind: '__proto__' }
  ]) assert.equal(normalizeAction(action), null, action.kind);
});

test('todo动作保留有效date/time，并拒绝坏日期/时间与不安全文本', () => {
  assert.deepEqual(normalizeAction({ kind: 'todo', text: '开会', date: '2026-10-13', time: '15:30' }), {
    kind: 'todo', payload: { text: '开会', date: '2026-10-13', time: '15:30', timed: true }
  });
  assert.ok(normalizeAction({ kind: 'todo', text: '闰年', date: '2028-02-29' }));
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '1899-01-01', '2101-01-01', '2026-10-13\n', '', null, '<script>']) {
    assert.equal(normalizeAction({ kind: 'todo', text: '开会', date }), null, String(date));
  }
  for (const time of ['24:00', '15:60', '3:30', '15:30Z', '15:30\n', '<script>', null, 1530]) {
    assert.equal(normalizeAction({ kind: 'todo', text: '开会', date: '2026-10-13', time }), null, String(time));
  }
  for (const text of ['', ' ', '<img src=x onerror=alert(1)>', '文本\u0000', '任务‮']) {
    assert.equal(normalizeAction({ kind: 'todo', text }), null, text);
  }
  assert.equal(normalizeAction({ kind: 'todo', text: '任务', timed: true }), null);
  assert.equal(normalizeAction({ kind: 'ledger', type: 'expense', amount: 28, note: '<script>' }), null);
});

const CFG = { ...DEFAULT_AGENT, provider: 'custom', apiKey: 'fake-test-key', baseUrl: 'https://example.test/v1/', model: 'fake-model' };
const response = (content = '好的\nACTIONS: []', extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  ...extra
});

function mockStorage(t, storage) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  });
}

test('配置load/save容忍storage异常且过滤不合法字段', t => {
  mockStorage(t, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } });
  assert.deepEqual(loadAgentConfig(), DEFAULT_AGENT);
  assert.equal(saveAgentConfig(CFG), false);
  globalThis.localStorage.getItem = () => '[1,2]';
  assert.deepEqual(loadAgentConfig(), DEFAULT_AGENT);
  globalThis.localStorage.getItem = () => '{"provider":"custom","apiKey":{},"autoInsight":"yes"}';
  assert.deepEqual(loadAgentConfig(), { ...DEFAULT_AGENT, provider: 'custom' });
  globalThis.localStorage.getItem = () => '{invalid';
  assert.deepEqual(loadAgentConfig(), DEFAULT_AGENT);
  let saved;
  globalThis.localStorage.setItem = (_key, value) => { saved = JSON.parse(value); };
  assert.equal(saveAgentConfig(CFG), true);
  assert.deepEqual(saved, CFG);
});

test('resolveAgentEndpoint规范化尾斜杠、完整endpoint与默认provider', () => {
  assert.equal(resolveAgentEndpoint(CFG), 'https://example.test/v1/chat/completions');
  assert.equal(resolveAgentEndpoint({ ...CFG, baseUrl: 'https://example.test/v1////' }), 'https://example.test/v1/chat/completions');
  assert.equal(resolveAgentEndpoint({ ...CFG, baseUrl: 'https://example.test/v1/chat/completions/' }), 'https://example.test/v1/chat/completions');
  assert.equal(resolveAgentEndpoint({ provider: 'openai' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(resolveAgentEndpoint({ provider: 'deepseek' }), 'https://api.deepseek.com/v1/chat/completions');
  for (const baseUrl of ['http://127.0.0.1:8080/v1', 'http://localhost:8000/v1', 'http://[::1]:8080/v1']) {
    assert.equal(resolveAgentEndpoint({ ...CFG, baseUrl }), `${baseUrl}/chat/completions`);
  }
});

test('不安全URL拒绝且askLLM绝不fetch', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('should not fetch'); });
  for (const baseUrl of [
    'http://example.test/v1', 'http://localhost.example.test/v1', 'http://127.0.0.2/v1',
    'http://127.1/v1', 'http://2130706433/v1', 'http://0x7f000001/v1', 'http://localhost./v1',
    'https://user:pass@example.test/v1', 'https://@example.test/v1', 'https://example.test/v1?q=secret',
    'https://example.test/v1#secret', 'https://example.test/v1?', 'https://example.test/v1#',
    'file:///v1', 'javascript:alert(1)', '//example.test/v1', 'not-a-url', '', 'https://example.test\\evil/v1'
  ]) {
    const cfg = { ...CFG, baseUrl };
    assert.throws(() => resolveAgentEndpoint(cfg), undefined, baseUrl);
    const result = await askLLM('hello', cfg);
    assert.equal(result.error, 'invalid_config', baseUrl);
    assert.deepEqual(result.actions, []);
    assert.ok(result.reply);
  }
  assert.equal(calls, 0);
});

test('askLLM默认无摘要，只有显式state才附摘要；假Key且全部mock无网络', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return response('建议喝水\nACTIONS: [{"kind":"water","ml":250}]');
  });
  assert.deepEqual(await askLLM('hello', CFG), { reply: '建议喝水', actions: [{ kind: 'water', ml: 250 }] });
  assert.equal(calls[0].url, resolveAgentEndpoint(CFG));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-test-key');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].body.messages.length, 2);
  assert.equal(calls[0].body.messages.at(-1).content, 'hello');
  assert.doesNotMatch(JSON.stringify(calls[0].body), /当前数据摘要|交房租/);
  await askLLM('hello', CFG, STATE);
  assert.equal(calls[1].body.messages.length, 3);
  assert.match(calls[1].body.messages[1].content, /^当前数据摘要：/);
  await askLLM('hello', CFG, null, { timeoutMs: 1000 });
  assert.equal(calls[2].body.messages.length, 2);
});

test('askLLM未配置保持null兼容且不请求', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(); });
  assert.equal(await askLLM('hello', DEFAULT_AGENT), null);
  assert.equal(await askLLM('hello', { ...CFG, apiKey: '' }), null);
  assert.equal(await askLLM('hello', null), null);
  assert.equal(isLLMReady(null), false);
  assert.equal(calls, 0);
});

test('askLLM已取消signal不会发请求；进行中取消终止且返回明确信息', async t => {
  let calls = 0, requestSignal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    calls++;
    requestSignal = options.signal;
    return new Promise(() => {}); // mock故意忽略abort，race仍必须可靠结束
  });
  const pre = new AbortController();
  pre.abort();
  const already = await askLLM('hello', CFG, null, { signal: pre.signal });
  assert.equal(already.error, 'aborted');
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = askLLM('hello', CFG, null, { signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  const result = await pending;
  assert.equal(result.error, 'aborted');
  assert.match(result.reply, /取消/);
  assert.deepEqual(result.actions, []);
  assert.equal(requestSignal.aborted, true);
});

test('askLLM超时终止fetch和response body阶段，计时器包含整次请求', async t => {
  let requestSignal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  });
  const timeout = await askLLM('hello', CFG, null, { timeoutMs: 5 });
  assert.equal(timeout.error, 'timeout');
  assert.match(timeout.reply, /超时/);
  assert.equal(requestSignal.aborted, true);
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return response('', { json: () => new Promise(() => {}) });
  };
  assert.equal((await askLLM('hello', CFG, null, { timeoutMs: 5 })).error, 'timeout');
  assert.equal(requestSignal.aborted, true);
});

test('askLLM清晰处理HTTP、网络、配置、坏response与截断', async t => {
  t.mock.method(globalThis, 'fetch', async () => response('', { ok: false, status: 401 }));
  const http = await askLLM('hello', CFG);
  assert.equal(http.error, 'http');
  assert.match(http.reply, /HTTP 401/);
  globalThis.fetch = async () => { throw new TypeError('secret-url/api-key should not be reflected'); };
  const network = await askLLM('hello', CFG);
  assert.equal(network.error, 'network');
  assert.doesNotMatch(network.reply, /secret-url|api-key/);
  assert.equal((await askLLM('hello', { ...CFG, model: '' })).error, 'invalid_config');
  assert.equal((await askLLM('hello', CFG, null, { timeoutMs: 0 })).error, 'invalid_config');
  for (const data of [null, {}, { choices: {} }, { choices: [] }, { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: [] } }] }, { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: 'ok' }, finish_reason: 'length' }] }]) {
    globalThis.fetch = async () => response('', { json: async () => data });
    assert.equal((await askLLM('hello', CFG)).error, 'invalid_response');
  }
  globalThis.fetch = async () => response('', { json: async () => { throw new Error('bad json'); } });
  assert.equal((await askLLM('hello', CFG)).error, 'invalid_response');
});

test('askLLM动作数组schema守卫：全批拒绝，不执行部分坏数据或贪婪匹配', async t => {
  t.mock.method(globalThis, 'fetch', async () => response());
  for (const content of [
    'ok\nACTIONS: {}', 'ok\nACTIONS: null', 'ok\nACTIONS: [1]',
    'ok\nACTIONS: [{"kind":"water","ml":0}]',
    'ok\nACTIONS: [{"kind":"water","ml":250},{"kind":"study","minutes":"30"}]',
    'ok\nACTIONS: [{"kind":"todo","text":"开会","date":"2026-02-30"}]',
    'ok\nACTIONS: [{"kind":"water","ml":250,"evil":true}]',
    'ok\nACTIONS: [{"kind":"focus","minutes":45}]',
    'ok\nACTIONS: [{"kind":"reminder","minutes":10,"text":"开会"}]',
    'ok\nACTIONS: [{"kind":"water","ml":250},{"kind":"navigate","page":"study"}]',
    'ok\nACTIONS: [{"kind":"water","ml":250}] trailing',
    'ok\nACTIONS: []\nACTIONS: []', 'ok\nACTIONS: [',
    `ok\nACTIONS: ${JSON.stringify(Array.from({ length: 21 }, () => ({ kind: 'water', ml: 250 })))}`
  ]) {
    globalThis.fetch = async () => response(content);
    const result = await askLLM('hello', CFG);
    assert.equal(result.error, 'invalid_response', content);
    assert.deepEqual(result.actions, []);
  }
  const valid = { kind: 'todo', text: '开会 [周会]', date: '2026-10-13', time: '15:30' };
  globalThis.fetch = async () => response(`好的\nACTIONS: ${JSON.stringify([valid])}`);
  assert.deepEqual(await askLLM('hello', CFG), { reply: '好的', actions: [valid] });
  globalThis.fetch = async () => response('普通回复，没有建议动作');
  assert.deepEqual(await askLLM('hello', CFG), { reply: '普通回复，没有建议动作', actions: [] });
});

test('共享配置校验：none可保存、custom必须有模型，readiness严格匹配有效地址/模型/key', t => {
  let stored;
  mockStorage(t, { getItem: () => null, setItem: (_key, value) => { stored = JSON.parse(value); } });
  assert.deepEqual(validateAgentConfig(DEFAULT_AGENT), { valid: true, endpoint: '', model: '' });
  assert.equal(saveAgentConfig(DEFAULT_AGENT), true);
  assert.equal(stored.provider, 'none');
  assert.equal(isLLMReady(DEFAULT_AGENT), false);
  assert.equal(validateAgentConfig({ ...CFG, apiKey: '' }).valid, true);
  assert.equal(isLLMReady({ ...CFG, apiKey: '' }), false);
  assert.deepEqual(validateAgentConfig({ ...CFG, model: '  example-model  ' }), {
    valid: true, endpoint: 'https://example.test/v1/chat/completions', model: 'example-model'
  });
  for (const config of [null, {}, { ...CFG, provider: 'unknown' }, { ...CFG, model: '  ' },
    { ...CFG, model: 123 }, { ...CFG, model: 'bad\nmodel' }, { ...CFG, baseUrl: 'http://remote.test' },
    { ...CFG, apiKey: 'key\nleak' }, { ...CFG, apiKey: {} }]) {
    assert.equal(validateAgentConfig(config, { requireKey: true }).valid, false);
    assert.equal(isLLMReady(config), false);
    assert.equal(saveAgentConfig(config), false);
  }
  assert.equal(isLLMReady(CFG), true);
  assert.equal(isLLMReady({ provider: 'openai', apiKey: 'fake-key' }), true);
});

test('checkAgentConnection仅使用显式配置、固定合成prompt和默认人设，不读已保存key/个人数据或返回动作/服务文本', async t => {
  let reads = 0;
  mockStorage(t, { getItem() { reads++; return JSON.stringify({ ...CFG, apiKey: 'saved-key-must-not-send' }); } });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return response('provider-text-must-not-display\nACTIONS: [{"kind":"water","ml":250}]');
  });
  const config = { ...CFG, persona: 'private-persona-must-not-send', state: STATE };
  const before = structuredClone(config);
  const success = await checkAgentConnection(config);
  assert.deepEqual(success.actions, []);
  assert.equal(success.ok, true);
  assert.doesNotMatch(JSON.stringify(success), /provider-text|water|saved-key|private-persona/);
  assert.equal(reads, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-test-key');
  assert.equal(calls[0].body.messages.length, 2);
  assert.ok(calls[0].body.messages[0].content.startsWith(DEFAULT_AGENT.persona));
  assert.equal(calls[0].body.messages[1].content, AGENT_CONNECTION_PROMPT);
  assert.equal(AGENT_CONNECTION_PROMPT, '这是一次 API 连接测试，不包含个人数据。请只回复“连接测试成功”，不要生成任何动作。');
  assert.doesNotMatch(JSON.stringify(calls[0].body), /当前数据摘要|private-persona|交房租|saved-key/);
  assert.deepEqual(config, before);
  for (const invalid of [undefined, null, {}, { ...CFG, apiKey: '' }, { ...CFG, model: '' }]) {
    const result = await checkAgentConnection(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_config');
    assert.deepEqual(result.actions, []);
  }
  assert.equal(calls.length, 1);
  assert.equal(reads, 0);
});

test('checkAgentConnection安全返回401/429/500、invalid JSON和网络失败，不反射响应错误正文', async t => {
  t.mock.method(globalThis, 'fetch', async () => response());
  for (const status of [401, 429, 500]) {
    globalThis.fetch = async () => response('', {
      ok: false, status, json() { throw new Error('must-not-read-provider-error-body'); }
    });
    const result = await checkAgentConnection(CFG);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'http');
    assert.equal(result.status, status);
    assert.match(result.reply, new RegExp(`HTTP ${status}`));
    assert.deepEqual(result.actions, []);
  }
  globalThis.fetch = async () => response('', { json: async () => { throw new Error('secret-body'); } });
  assert.equal((await checkAgentConnection(CFG)).error, 'invalid_response');
  globalThis.fetch = async () => { throw new Error('https://secret.test/?key=secret-key'); };
  const network = await checkAgentConnection(CFG);
  assert.equal(network.error, 'network');
  assert.doesNotMatch(network.reply, /secret/);
});

test('checkAgentConnection整次请求10秒默认超时及显式取消，包括不响应abort的mock', async t => {
  let delay, requestSignal;
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    delay = ms;
    return originalSetTimeout(fn, 2, ...args);
  });
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  });
  const timeout = await checkAgentConnection(CFG);
  assert.equal(delay, 10_000);
  assert.equal(timeout.error, 'timeout');
  assert.equal(timeout.ok, false);
  assert.equal(requestSignal.aborted, true);
  const controller = new AbortController();
  const pending = checkAgentConnection(CFG, { signal: controller.signal });
  controller.abort();
  const canceled = await pending;
  assert.equal(canceled.error, 'aborted');
  assert.deepEqual(canceled.actions, []);
  assert.equal(requestSignal.aborted, true);
});
