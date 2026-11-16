import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOmniboxWithAI,
  breakdownSubtasksWithAI,
  polishStandupWithAI
} from '../src/lib/ai-assist.js';
import { DEFAULT_AGENT, saveAgentConfig } from '../js/agent.js';

function mockLocalStorage(t, initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key)
  };
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  });
  return map;
}

const VALID_CFG = {
  ...DEFAULT_AGENT,
  provider: 'custom',
  apiKey: 'test-key-123',
  baseUrl: 'https://example.test/v1',
  model: 'fake-model'
};

test('parseOmniboxWithAI locally splits composite instructions including unpunctuated phrases', async t => {
  mockLocalStorage(t);
  const res = await parseOmniboxWithAI('午饭28元 喝水300ml 明天开会', {});
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'local');
  assert.equal(res.llmFailed, false);
  assert.deepEqual(res.actions.map(a => a.kind), ['ledger', 'water', 'todo']);
});

test('parseOmniboxWithAI flags llmFailed and errorReason when configured external AI fails', async t => {
  mockLocalStorage(t);
  saveAgentConfig(VALID_CFG);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 502,
    json: async () => ({})
  }));

  const res = await parseOmniboxWithAI('午饭28元，明天开会', {});
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'local');
  assert.equal(res.llmFailed, true);
  assert.match(res.errorReason, /HTTP 502/);
  assert.match(res.reply, /外部 AI 调用失败/);
  assert.equal(res.actions.length, 2);
});

test('breakdownSubtasksWithAI and polishStandupWithAI surface llmFailed on HTTP error instead of silent fallback', async t => {
  mockLocalStorage(t);
  saveAgentConfig(VALID_CFG);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network down');
  });

  const subRes = await breakdownSubtasksWithAI('整理季度复盘文档', '项目');
  assert.equal(subRes.ok, true);
  assert.equal(subRes.mode, 'local');
  assert.equal(subRes.llmFailed, true);
  assert.ok(subRes.errorReason.length > 0);
  assert.ok(subRes.steps.length >= 2);
  assert.match(subRes.hint, /外部 AI 拆解失败/);

  const standupRes = await polishStandupWithAI({
    style: 'report',
    range: 'today',
    doneTasks: [{ text: '上线登录重构', tag: '前端' }],
    doingTasks: [{ text: '接口联调', time: '16:00' }],
    focusMinutes: 90
  });
  assert.equal(standupRes.ok, true);
  assert.equal(standupRes.mode, 'local');
  assert.equal(standupRes.llmFailed, true);
  assert.ok(standupRes.errorReason.length > 0);
  assert.match(standupRes.hint, /外部 AI 润色失败/);
  assert.match(standupRes.highlights, /上线登录重构/);
});
