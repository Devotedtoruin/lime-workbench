// agent.js — 本地办公助理与可选 AI 接口
//
// 自然语言解析只提出操作；写入记录与启动计时均由用户确认。
// 两层能力：
//   1) 本地规则引擎（离线、零成本、永远可用）—— 命令解析 + 数据洞察
//   2) 大模型（可选，配置后由用户明确发送）—— 自由对话、复杂意图
//
// 设计原则：
//   - 不联网也能完整使用（核心能力不依赖大模型）
//   - 大模型返回的任何"动作"都必须先经用户确认，绝不静默改数据
//   - 密钥明文保存在本机；仅明确发送时交给配置的服务，可随时清除

import { parseCommand, resolveLocalShortcut, preview, dateKey } from './command.js';
import { INPUT_RULES, inRange } from './input-rules.js';

const monthOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const AGENT_STORAGE_KEY = 'lime-agent-v1';
const KEY = AGENT_STORAGE_KEY;

export const DEFAULT_AGENT = {
  provider: 'none',      // 'none' | 'openai' | 'deepseek' | 'custom'
  apiKey: '',
  baseUrl: '',
  model: '',
  persona: '你是「青柠」，一个简洁、可靠的个人办公助理。负责记账、待办、健康打卡和工作提醒。使用正式、清晰的中文，不使用表情符号；只根据已有数据回答，信息不足时说明限制。',
  autoInsight: true
};

const PROVIDERS = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  custom: { base: '', model: '' }
};

function configObject(cfg) {
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg);
}

function cleanConfig(cfg) {
  const result = { ...DEFAULT_AGENT };
  if (!configObject(cfg)) return result;
  for (const key of ['apiKey', 'baseUrl', 'model', 'persona']) {
    if (typeof cfg[key] === 'string') result[key] = cfg[key];
  }
  if (['none', ...Object.keys(PROVIDERS)].includes(cfg.provider)) result.provider = cfg.provider;
  if (typeof cfg.autoInsight === 'boolean') result.autoInsight = cfg.autoInsight;
  return result;
}

export function loadAgentConfig() {
  try {
    return cleanConfig(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return { ...DEFAULT_AGENT };
  }
}

/** storage 被禁用或写满时不让设置对话框崩溃；调用方可据 false 提示未保存。 */
export function saveAgentConfig(cfg) {
  if (!validateAgentConfig(cfg).valid) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(cleanConfig(cfg)));
    return true;
  } catch {
    return false;
  }
}

/* ============================================================
 *  一、本地规则引擎（离线）
 * ============================================================ */

/** 今日 + 逾期未完成；逾期先，其次优先级与截止时间，不把数组顺序当紧急度。 */
function dueTodos(state, day) {
  const priority = { high: 0, medium: 1, low: 2 };
  return (Array.isArray(state.todos) ? state.todos : [])
    .filter(t => t && !t.done && validDate(t.date) && t.date <= day)
    .sort((a, b) => Number(b.date < day) - Number(a.date < day) ||
      (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1) ||
      a.date.localeCompare(b.date) ||
      (validTime(a.time) ? a.time : '24:00').localeCompare(validTime(b.time) ? b.time : '24:00') ||
      String(a.text).localeCompare(String(b.text)));
}

/** 今天的健康/工作快报 —— 完全本地，不需要联网 */
export function buildDailyBrief(state = {}, now = new Date()) {
  state = state || {};
  const lines = [];
  const d = dateKey(now);
  const water = (Array.isArray(state.water?.[d]) ? state.water[d] : [])
    .reduce((a, b) => a + (positiveNumber(b?.ml, 100_000) ? b.ml : 0), 0);
  const steps = state.steps?.[d] || 0;
  const study = state.study?.[d] || 0;
  const todos = dueTodos(state, d);
  const waterGoal = positiveNumber(state.settings?.waterGoal, 100_000) ? state.settings.waterGoal : 2000;

  lines.push(`今天是 ${now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}。`);
  if (todos.length) {
    lines.push(`今日及逾期还有 ${todos.length} 件待办未完成，优先处理「${todos[0].text}」。`);
  } else {
    lines.push('今日和逾期待办已清空。');
  }
  if (water > 0) lines.push(`今天已记录 ${water}ml 饮水${water < waterGoal ? `，距离目标 ${waterGoal}ml 还差 ${waterGoal - water}ml` : `，目标 ${waterGoal}ml 已达标`}。`);
  else lines.push(`今天暂无饮水记录，目标 ${waterGoal}ml。`);
  if (steps > 0) lines.push(`今天已记录 ${steps.toLocaleString()} 步。`);
  if (study > 0) lines.push(`今天累计专注学习了 ${Math.round(study / 60)} 分钟。`);

  const exp = (Array.isArray(state.ledger) ? state.ledger : [])
    .filter(r => r?.type === 'expense' && validDate(r.date) && r.date.startsWith(monthOf(now)) && positiveNumber(r.amount, 1_000_000_000));
  if (exp.length) {
    const total = exp.reduce((a, b) => a + b.amount, 0);
    lines.push(`本月已记录支出 ¥${total.toFixed(2)}，共 ${exp.length} 笔。`);
  }
  return lines.join(' ');
}

function monthExpenses(state, now) {
  return (Array.isArray(state?.ledger) ? state.ledger : [])
    .filter(r => r?.type === 'expense' && validDate(r.date) && r.date.startsWith(monthOf(now)) && positiveNumber(r.amount, 1_000_000_000));
}

/** 预算告警仅针对传入的参考值；不把默认值当作用户设置。 */
export function budgetAlert(state, budget = 3000, now = new Date()) {
  if (!positiveNumber(budget, 1_000_000_000)) return null;
  const total = monthExpenses(state, now).reduce((a, b) => a + b.amount, 0);
  if (total > budget) return `本月已记录支出 ¥${total.toFixed(2)}，已超出参考预算 ¥${budget}。`;
  if (total > budget * 0.8) return `本月已记录支出 ¥${total.toFixed(2)}，接近参考预算 ¥${budget}。`;
  return null;
}

/** 只有日累计学习秒数，不能据此推断连续专注或久坐。 */
export function breakReminder(state, now = new Date()) {
  const study = state?.study?.[dateKey(now)] || 0;
  return Number.isFinite(study) && study > 50 * 60
    ? `今天累计专注 ${Math.round(study / 60)} 分钟；累计记录不能确定本轮久坐时长，如已久坐，建议短暂活动。` : null;
}

/* ============================================================
 *  二、意图理解：先本地，后大模型
 * ============================================================ */

/**
 * 处理用户的一句话，返回 { intent, reply, needConfirm, shortcut? }
 * 优先走本地规则（快、免费、离线可用）
 */
export function understand(text, state, now = new Date()) {
  const local = parseCommand(text, now);
  if (local) {
    return {
      intent: local,
      reply: `请确认操作：${preview(local)}`,
      needConfirm: true
    };
  }

  const shortcut = resolveLocalShortcut(text);
  if (shortcut) {
    const pages = { sport: '运动', habits: '健康打卡', study: '专注', calendar: '日历与提醒', todo: '待办' };
    return {
      shortcut, intent: null, needConfirm: false,
      reply: shortcut.kind === 'prefill' ? `可打开${pages[shortcut.page]}并预填表单；尚未保存记录。` : `可打开${pages[shortcut.page]}页面。`
    };
  }

  // 只回答本地数据确实能够支持的咨询，不能用宽泛关键词代替用户的问题。
  const q = String(text || '').trim().replace(/[?？。！!]+$/, '');
  if (/^(?:今日|今天)?(?:快报|简报|总结|怎么样)$|^今天(?:做了什么|有什么待办|要做什么)$/.test(q)) {
    return { intent: null, reply: buildDailyBrief(state, now), needConfirm: false };
  }
  if (/^(?:(?:本月|这个月)(?:消费|支出|账单|花了多少)(?:元|钱)?|(?:消费|支出|账单)(?:总结)?|花了多少(?:元|钱)?)$/.test(q)) {
    const expenses = monthExpenses(state, now);
    const reply = expenses.length ? `本月已记录支出 ¥${expenses.reduce((sum, r) => sum + r.amount, 0).toFixed(2)}，共 ${expenses.length} 笔；仅依据本地账目。`
      : '本月暂无有效支出记录；无法据此判断实际消费金额。';
    return { intent: null, reply, needConfirm: false };
  }
  if (/^(?:(?:本月|这个月)?预算(?:怎么样|多少|情况|超了吗)?|是否超出预算)$/.test(q)) {
    const reply = budgetAlert(state, 3000, now) || '按参考预算 ¥3000，本月已记录支出未超过该值；参考预算并非已设置的个人预算。';
    return { intent: null, reply, needConfirm: false };
  }
  if (/^(?:累(?:了)?|休息(?:一下)?|(?:我)?(?:需要|该)?休息(?:吗)?|久坐提醒|摸鱼)$/.test(q)) {
    return { intent: null, reply: breakReminder(state, now) || '目前没有连续久坐时长数据，无法判断是否需要休息；如已久坐，建议短暂活动。', needConfirm: false };
  }

  // 本地不懂 → 仅标记可咨询 AI，由 UI 在用户明确发送后调用。
  return { intent: null, reply: null, needConfirm: false, needLLM: true };
}

/* ============================================================
 *  三、大模型调用（可选）
 * ============================================================ */

/** 保存允许停用服务/不保存密钥；实际请求必须校验完整配置和密钥。 */
export function validateAgentConfig(cfg, { requireKey = false } = {}) {
  const invalid = reply => ({ valid: false, endpoint: '', model: '', error: 'invalid_config', reply });
  if (!configObject(cfg)) return invalid('AI 配置无效，请重新填写。');
  if (cfg.provider === 'none') {
    return requireKey ? invalid('请先选择 AI 服务提供方。') : { valid: true, endpoint: '', model: '' };
  }
  if (!Object.hasOwn(PROVIDERS, cfg.provider)) return invalid('请选择有效的 AI 服务提供方。');
  if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== 'string') return invalid('请填写有效的 AI 服务地址。');
  let endpoint;
  try { endpoint = resolveAgentEndpoint(cfg); }
  catch (error) { return invalid(error.message); }
  if (cfg.model !== undefined && typeof cfg.model !== 'string') return invalid('请填写有效的 AI 模型名称。');
  const model = cfg.model?.trim() || PROVIDERS[cfg.provider].model;
  if (!model || /[\u0000-\u001f\u007f]/.test(model)) return invalid('请填写有效的 AI 模型名称。');
  if (cfg.apiKey !== undefined && typeof cfg.apiKey !== 'string' ||
    typeof cfg.apiKey === 'string' && /[\u0000-\u001f\u007f]/.test(cfg.apiKey) ||
    requireKey && !cfg.apiKey?.trim()) return invalid('请填写有效的 API Key。');
  return { valid: true, endpoint, model };
}

export function isLLMReady(cfg = loadAgentConfig()) {
  return validateAgentConfig(cfg, { requireKey: true }).valid;
}

/** 统一设置校验与实际发送地址；不允许凭据/参数/片段或远程明文传输。 */
export function resolveAgentEndpoint(cfg = loadAgentConfig()) {
  if (!configObject(cfg) || !Object.hasOwn(PROVIDERS, cfg.provider)) {
    throw new Error('请选择有效的 AI 服务提供方。');
  }
  const raw = cfg.baseUrl || PROVIDERS[cfg.provider].base;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('请填写 AI 服务地址。');
  const base = raw.trim();
  if (!/^https?:\/\//i.test(base) || /[\s\\?#]/.test(base)) {
    throw new Error('AI 服务地址必须是完整 HTTP(S) URL，不能含查询参数或片段。');
  }
  let url;
  try { url = new URL(base); } catch { throw new Error('AI 服务地址格式不正确。'); }
  if (url.username || url.password || base.slice(base.indexOf('://') + 3).split('/')[0].includes('@')) {
    throw new Error('AI 服务地址不能包含用户名或密码。');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('远程 AI 服务必须使用 HTTPS；仅 localhost、127.0.0.1 或 ::1 可使用 HTTP。');
  }
  // WHATWG URL 会把 127.1 / 十六进制主机规范化为回环；明文例外只接受明确的三个主机。
  const authority = base.slice(base.indexOf('://') + 3).split('/')[0];
  const inputHost = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.split(':')[0];
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(inputHost.toLowerCase())) {
    throw new Error('本地 HTTP 地址请使用 localhost、127.0.0.1 或 [::1]。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}

function llmError(error, reply, status) {
  return { reply, actions: [], error, ...(Number.isInteger(status) ? { status } : {}) };
}

export const AGENT_CONNECTION_PROMPT = '这是一次 API 连接测试，不包含个人数据。请只回复“连接测试成功”，不要生成任何动作。';

/** 显式配置的单次合成探测；不读取保存配置、不发送摘要/自定义人设、不返回模型文本或动作。 */
export async function checkAgentConnection(cfg, options = {}) {
  const validation = validateAgentConfig(cfg, { requireKey: true });
  if (!validation.valid) return { ok: false, error: validation.error, reply: validation.reply, actions: [] };
  const result = await askLLM(AGENT_CONNECTION_PROMPT, {
    provider: cfg.provider, baseUrl: cfg.baseUrl, model: validation.model,
    apiKey: cfg.apiKey, persona: DEFAULT_AGENT.persona
  }, null, { signal: options?.signal, timeoutMs: options?.timeoutMs ?? 10_000 });
  if (!result || result.error) {
    return {
      ok: false, error: result?.error || 'invalid_config',
      reply: result?.reply || 'AI 连接测试配置无效。', actions: [],
      ...(Number.isInteger(result?.status) ? { status: result.status } : {})
    };
  }
  return { ok: true, reply: '连接测试成功；仅验证本次地址、模型和测试密钥，未执行任何动作。', actions: [] };
}

function parseLLMContent(content) {
  const markers = [...content.matchAll(/^ACTIONS:\s*/gm)];
  if (!markers.length) {
    return /ACTIONS:/i.test(content) ? llmError('invalid_response', 'AI 返回的动作格式无效，未生成任何操作。')
      : { reply: content.trim(), actions: [] };
  }
  if (markers.length !== 1) return llmError('invalid_response', 'AI 返回了重复动作字段，未生成任何操作。');
  const marker = markers[0];
  let actions;
  try { actions = JSON.parse(content.slice(marker.index + marker[0].length).trim()); }
  catch { return llmError('invalid_response', 'AI 返回的动作 JSON 无效，未生成任何操作。'); }
  if (!Array.isArray(actions) || actions.length > 20 || actions.some(a => !normalizeAction(a))) {
    return llmError('invalid_response', 'AI 返回的动作未通过安全校验，未生成任何操作。');
  }
  return { reply: content.slice(0, marker.index).trim(), actions };
}

/**
 * OpenAI / DeepSeek 兼容接口；仅发送 text，state 必须由调用方显式传入。
 * 第四参数可传 { signal, timeoutMs }；失败提供可展示的 reply/error，未配置仍返回 null。
 * 返回的 actions 只是经 schema 检查的建议，必须由用户确认后才执行。
 */
export async function askLLM(text, cfg = loadAgentConfig(), state = null, options = {}) {
  // 保持未启用/无密钥时返回 null 的旧契约；其他无效配置提供明确错误。
  if (!configObject(cfg) || !cfg.provider || cfg.provider === 'none' ||
    cfg.apiKey === undefined || typeof cfg.apiKey === 'string' && !cfg.apiKey.trim()) return null;
  const validation = validateAgentConfig(cfg, { requireKey: true });
  if (!validation.valid) return llmError(validation.error, validation.reply);
  const { endpoint, model } = validation;
  const { signal, timeoutMs = 30_000 } = options || {};
  if (!positiveNumber(timeoutMs, 600_000) || signal &&
    (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    return llmError('invalid_config', 'AI 请求超时或取消参数无效。');
  }
  if (signal?.aborted) return llmError('aborted', 'AI 请求已取消，未生成任何操作。');

  const controller = new AbortController();
  let timeout, cancellation;
  let stopReason = null;
  let cancel;
  const stopped = new Promise((_, reject) => { cancel = reject; });
  const stop = reason => {
    if (stopReason) return;
    stopReason = reason;
    cancel(new Error(reason));
    controller.abort();
  };
  cancellation = () => stop('aborted');
  signal?.addEventListener('abort', cancellation, { once: true });
  timeout = setTimeout(() => stop('timeout'), timeoutMs);

  const sys = [
    cfg.persona || DEFAULT_AGENT.persona,
    '用户正在使用个人办公工作台。使用正式、简洁的中文，不使用表情符号；没有数据依据时说明限制。',
    '你可以建议动作，但必须以 JSON 数组返回，格式如：',
    '[{"kind":"ledger","type":"expense","amount":28,"note":"午饭","cat":"🍚 吃饭"}]',
    '可选 kind：ledger / todo / water / steps / study。不需要动作时返回空数组。不得输出 focus、reminder、navigate 或其他动作；启动计时和相对提醒仅由本地明确命令处理。',
    '数值必须是正数且有明确依据；steps 表示设置今天总步数，不是累加。',
    'todo 的 date 为 YYYY-MM-DD，time 可选且为 HH:mm；不要猜测模糊数字或意图。',
    '回答要简短（不超过 100 字），最后单独一行输出 ACTIONS: <json>'
  ].join('\n');

  try {
    const request = async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
        body: JSON.stringify({
          model: model.trim(),
          messages: [
            { role: 'system', content: sys },
            ...(state !== null && state !== undefined ? [{ role: 'system', content: '当前数据摘要：' + buildDailyBrief(state) }] : []),
            { role: 'user', content: String(text ?? '') }
          ],
          temperature: 0.4
        })
      });
      if (!response?.ok) {
        const status = Number.isInteger(response?.status) ? `（HTTP ${response.status}）` : '';
        return llmError('http', `AI 服务请求失败${status}，请检查服务地址、模型和 API Key。`, response?.status);
      }
      let data;
      try { data = await response.json(); }
      catch { return llmError('invalid_response', 'AI 服务返回了无效 JSON，未生成任何操作。'); }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 100_000 ||
        !Array.isArray(data.choices) || !configObject(data.choices[0]?.message) ||
        ['length', 'content_filter', 'tool_calls'].includes(data.choices[0]?.finish_reason)) {
        return llmError('invalid_response', 'AI 服务返回的内容缺失、被截断或格式不正确，未生成任何操作。');
      }
      return parseLLMContent(content);
    };
    return await Promise.race([request(), stopped]);
  } catch (e) {
    if (stopReason === 'timeout') return llmError('timeout', 'AI 请求超时，已停止等待，请稍后重试。');
    if (stopReason === 'aborted' || e?.name === 'AbortError') return llmError('aborted', 'AI 请求已取消，未生成任何操作。');
    return llmError('network', '无法连接 AI 服务，请检查网络、服务地址及跨域设置。');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancellation);
  }
}

function positiveNumber(value, max, min = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value >= min && value <= max;
}

function safeText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    [...value].every(char => {
      const cp = char.codePointAt(0);
      return char !== '<' && char !== '>' && cp >= 32 && cp !== 127 &&
        !(cp >= 0x202a && cp <= 0x202e) && !(cp >= 0x2066 && cp <= 0x2069);
    });
}

function validDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2100 && date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value) {
  return typeof value === 'string' && value.length === 5 && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const ACTION_FIELDS = {
  ledger: ['kind', 'type', 'amount', 'note', 'cat'],
  todo: ['kind', 'text', 'date', 'time', 'timed', 'priority', 'tag'],
  water: ['kind', 'ml'], steps: ['kind', 'steps'], study: ['kind', 'minutes']
};

/** 严格验证模型输出，不用绝对值/默认数字把无效 action 变成有效记录。 */
export function normalizeAction(a) {
  if (!configObject(a) || !Object.hasOwn(ACTION_FIELDS, a.kind) ||
    Object.keys(a).some(key => !ACTION_FIELDS[a.kind].includes(key))) return null;
  switch (a.kind) {
    case 'ledger': {
      if (!['income', 'expense'].includes(a.type) || !positiveNumber(a.amount, 1_000_000_000, 0.000001) ||
        a.note !== undefined && !safeText(a.note, 300) || a.cat !== undefined && !safeText(a.cat, 80)) return null;
      return { kind: 'ledger', payload: {
        type: a.type, amount: a.amount, note: a.note?.trim() || 'AI 记账', cat: a.cat?.trim() || '🎁 其他'
      } };
    }
    case 'todo': {
      if (!safeText(a.text, 300) || a.date !== undefined && !validDate(a.date) ||
        a.time !== undefined && a.time !== '' && !validTime(a.time) ||
        a.timed !== undefined && typeof a.timed !== 'boolean' ||
        a.priority !== undefined && !['low', 'medium', 'high'].includes(a.priority) ||
        a.tag !== undefined && !safeText(a.tag, 80)) return null;
      const payload = { text: a.text.trim(), date: a.date ?? dateKey(new Date()) };
      if (a.time !== undefined) Object.assign(payload, { time: a.time, timed: Boolean(a.time) });
      else if (a.timed === true) return null;
      if (a.priority !== undefined) payload.priority = a.priority;
      if (a.tag !== undefined) payload.tag = a.tag.trim();
      return { kind: 'todo', payload };
    }
    case 'water':
      return inRange(a.ml, INPUT_RULES.water) ? { kind: 'water', payload: { ml: a.ml } } : null;
    case 'steps':
      return inRange(a.steps, INPUT_RULES.steps) ? { kind: 'steps', payload: { steps: a.steps } } : null;
    case 'study':
      return positiveNumber(a.minutes, 1440) ? { kind: 'study', payload: { minutes: a.minutes } } : null;
    default:
      return null;
  }
}
