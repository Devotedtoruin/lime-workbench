// ═══════════════════════════════════════════════════════════════════════════
// src/lib/ai-assist.js — 智能语义解析与文本润色辅助层
//   1. 全能输入框复合指令解析（一句话拆解为多条待办 / 记账 / 习惯 / 运动动作）
//   2. 复杂任务拆解为可执行子步骤（Checklist）
//   3. 工作日报/周报多风格提炼与专业话术润色（工作汇报 / 精简日报 / 复盘周结）
//   当未配置外部接口密钥时，默认使用确定性本地规则引擎，不产生报错弹窗。
// ═══════════════════════════════════════════════════════════════════════════

import {
  loadAgentConfig,
  validateAgentConfig,
  isLLMReady,
  askLLM,
  normalizeAction
} from '../../js/agent.js';
import { parseCommand, preview as previewIntent } from '../../js/command.js';

export const STANDUP_POLISH_STYLES = [
  { id: 'report', label: '工作汇报', desc: '结构严谨、突出关键产出与业务价值' },
  { id: 'concise', label: '精简日报', desc: '短句要点、结论先行、适合站会同步' },
  { id: 'review', label: '复盘周结', desc: '阶段复盘、归纳沉淀与后续跟进规划' }
];

export function getAIStatus() {
  const cfg = loadAgentConfig();
  const v = validateAgentConfig(cfg, { requireKey: true });
  return {
    configured: Boolean(v.valid),
    model: v.model || cfg.model || '',
    baseUrl: v.endpoint || cfg.baseUrl || ''
  };
}

async function callJsonChat({ systemPrompt, userPrompt, maxTokens = 600, timeoutMs = 20000 }) {
  const cfg = loadAgentConfig();
  const v = validateAgentConfig(cfg, { requireKey: true });
  if (!v.valid) {
    return { ok: false, unconfigured: true, error: v.reply || '尚未配置有效的接口密钥' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 与 js/agent.js 一致：不跟随跨域重定向、不带凭据、不透传 Referer，
    // 避免重定向把 Bearer Key 转发到未配置的主机。
    const res = await fetch(v.endpoint, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: v.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      return { ok: false, error: `接口响应 HTTP ${res.status}` };
    }
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, error: '接口返回内容为空' };
    }
    return { ok: true, content: content.trim() };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? '服务请求超时' : '无法连接远端服务';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(raw) {
  const clean = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

/* ---------------- 1. 首页全能输入框：复合指令解析 ---------------- */

function splitCompositeSegments(text) {
  return String(text || '')
    .split(/[；;，,。\n]|(?:\s+(?:并且|顺便|同时|然后|另外|以及|再)\s*)|(?:并且|顺便|同时|然后|另外)/g)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function parseOmniboxWithAI(text, state) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false, error: '请输入指令内容' };

  const status = getAIStatus();
  if (status.configured && isLLMReady()) {
    const cfg = loadAgentConfig();
    const res = await askLLM(clean, cfg, state);
    const normalizedActions = (Array.isArray(res?.actions) ? res.actions : [])
      .map(normalizeAction)
      .filter(Boolean);
    if (res && !res.error && (normalizedActions.length || res.reply)) {
      return {
        ok: true,
        mode: 'llm',
        reply: res.reply || `已解析出 ${normalizedActions.length} 项可执行动作`,
        hint: '',
        actions: normalizedActions.map(act => ({
          ...act,
          summary: previewIntent(act) || act.payload?.text || act.payload?.note || '执行操作'
        }))
      };
    }
  }

  // 本地复合语句拆解：按连接词拆分为多个独立子句逐一通过 parseCommand 识别
  const segments = splitCompositeSegments(clean);
  const actions = [];
  const now = new Date();
  for (const seg of segments.slice(0, 6)) {
    const intent = parseCommand(seg, now);
    if (intent) {
      actions.push({
        ...intent,
        summary: previewIntent(intent)
      });
    }
  }
  if (!actions.length) {
    const single = parseCommand(clean, now);
    if (single) {
      actions.push({ ...single, summary: previewIntent(single) });
    }
  }
  return {
    ok: actions.length > 0,
    mode: 'local',
    reply: status.configured
      ? '已通过本地语义规则拆解复合指令'
      : '已通过本地语义引擎拆解指令（可在「设置 → AI」配置接口启用深度推理）',
    hint: status.configured ? '' : '当前为本地规则解析模式，配置 API Key 后支持长难句跨模块推理。',
    actions
  };
}

/* ---------------- 2. 任务 Checklist：自动拆解子步骤 ---------------- */

function buildLocalSubtasks(taskText) {
  const t = String(taskText || '').trim();
  if (/评审|汇报|周报|总结|报告|材料|PPT|演示/i.test(t)) {
    return [
      `梳理「${t}」核心目标与受众关注点`,
      '汇总相关业务数据、关键产出与对比指标',
      '撰写结构化初稿并补充图表说明',
      '内部预审校对核心结论并定稿输出'
    ];
  }
  if (/修复|bug|排查|优化|重构|开发|上线|接口|联调/i.test(t)) {
    return [
      `复现并定位「${t}」涉及的模块与边界条件`,
      '编写核心实现代码并自测关键路径',
      '补充回归验证与异常分支检查',
      '提交代码变更并同步联调验证结果'
    ];
  }
  if (/会议|沟通|对齐|访谈|讨论|同步/i.test(t)) {
    return [
      `明确「${t}」议程重点与待决策问题清单`,
      '提前准备背景材料并同步参会相关方',
      '记录会议核心结论、责任人与排期节点',
      '会后输出纪要并跟进待办落地'
    ];
  }
  return [
    `明确「${t}」交付标准与关键时间节点`,
    '准备所需资料、依赖项与前置条件',
    '推进核心环节执行并记录阶段进展',
    '复盘检查完成质量并归档输出成果'
  ];
}

export async function breakdownSubtasksWithAI(taskText, tag = '') {
  const clean = String(taskText || '').trim();
  if (!clean) return { ok: false, error: '请先填写任务名称' };

  const status = getAIStatus();
  if (status.configured) {
    const sys = [
      '你是项目管理与效率顾问。请将用户的任务拆解为 3 到 5 个具体、可执行、简洁的子步骤（Checklist）。',
      '只返回严格合法的 JSON 对象，格式为：{"steps":["步骤1","步骤2","步骤3","步骤4"]}',
      '每条步骤不超过 36 个字，动词开头，不要编号前缀，不要输出额外解释。'
    ].join('\n');
    const usr = `任务名称：${clean}${tag ? `\n分类标签：${tag}` : ''}`;
    const res = await callJsonChat({ systemPrompt: sys, userPrompt: usr, maxTokens: 360 });
    if (res.ok) {
      const parsed = extractJsonObject(res.content);
      const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
      const steps = rawSteps
        .map(s => String(s || '').replace(/^\d+[\.\、\)\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (steps.length >= 2) {
        return { ok: true, mode: 'llm', steps, hint: '' };
      }
    }
  }

  return {
    ok: true,
    mode: 'local',
    steps: buildLocalSubtasks(clean),
    hint: status.configured ? '' : '当前使用本地模板拆解；配置接口密钥后可根据具体上下文生成步骤。'
  };
}

/* ---------------- 3. 工作日报/周报：多风格提炼与专业话术润色 ---------------- */

function buildLocalStandupPolish({
  style = 'report',
  range = 'today',
  doneTasks = [],
  doingTasks = [],
  focusMinutes = 0,
  currentHighlights = '',
  currentBlockers = ''
}) {
  const periodLabel = range === 'week' ? '本周' : '今日';
  const doneCount = doneTasks.length;
  const doingCount = doingTasks.length;

  const tagGroups = new Map();
  for (const t of doneTasks) {
    const k = t.tag || '日常推进';
    tagGroups.set(k, (tagGroups.get(k) || 0) + 1);
  }
  const tagSummary = [...tagGroups.entries()]
    .map(([k, n]) => `${k} ${n} 项`)
    .join('、');

  const topDone = doneTasks.slice(0, 3).map(t => t.text).join('；');
  const topDoing = doingTasks.slice(0, 2).map(t => t.text).join('；');
  const draftH = String(currentHighlights || '').trim();
  const draftB = String(currentBlockers || '').trim();

  if (style === 'concise') {
    const lines = [];
    if (doneCount > 0) {
      lines.push(`- 已完成（${doneCount} 项）：${topDone}`);
    }
    if (doingCount > 0) {
      lines.push(`- 推进中（${doingCount} 项）：${topDoing}`);
    }
    if (focusMinutes > 0) {
      lines.push(`- 专注投入：累计 ${focusMinutes} 分钟`);
    }
    if (draftH) {
      lines.push(`- 补充要点：${draftH.replace(/\n+/g, '；')}`);
    }
    if (!lines.length) {
      lines.push(`- ${periodLabel}按计划推进常规事项，暂未录入新增节点。`);
    }
    const blockers = draftB
      ? `- 待协同：${draftB.replace(/^-\s*/, '')}`
      : '- 暂无阻塞，按期推进。';
    return { highlights: lines.join('\n'), blockers };
  }

  if (style === 'review') {
    const lines = [];
    if (doneCount > 0) {
      lines.push(`- 阶段交付复盘：${periodLabel}闭环 ${doneCount} 项任务（涵盖${tagSummary}），关键成果包括：${topDone}。`);
    }
    if (focusMinutes > 0) {
      lines.push(`- 效能与时间分配：累计深度专注 ${focusMinutes} 分钟，核心精力集中于高优先级事项。`);
    }
    if (draftH) {
      lines.push(`- 经验沉淀与补充：${draftH.replace(/^-\s*/, '')}`);
    }
    if (doingCount > 0) {
      lines.push(`- 下阶段跟进计划：重点推进「${topDoing}」等 ${doingCount} 项排期事项，确保节点衔接。`);
    }
    if (!lines.length) {
      lines.push(`- ${periodLabel}完成阶段性工作梳理，各项计划处于稳定筹备状态。`);
    }
    const blockers = draftB
      ? `- 风险复盘与跨方协同：${draftB.replace(/^-\s*/, '')}，建议在下一周期前完成对齐。`
      : '- 交付链路顺畅，当前周期无遗留阻塞风险。';
    return { highlights: lines.join('\n'), blockers };
  }

  // 默认 style === 'report'（工作汇报风）
  const highlightsLines = [];
  if (doneCount > 0) {
    highlightsLines.push(
      `- 核心产出：完成${periodLabel}关键交付共 ${doneCount} 项（${tagSummary}），重点落地：${topDone}。`
    );
  }
  if (focusMinutes > 0) {
    highlightsLines.push(
      `- 研发与执行投入：累计深度专注 ${focusMinutes} 分钟，保障重点事项按期推进。`
    );
  }
  if (doingCount > 0) {
    highlightsLines.push(
      `- 后续排期：持续推进${topDoing}${doingCount > 2 ? ` 等 ${doingCount} 项计划任务` : ''}。`
    );
  }
  if (draftH) {
    highlightsLines.push(`- 专项补充：${draftH.replace(/^-\s*/, '')}`);
  }
  if (!highlightsLines.length) {
    highlightsLines.push(`- ${periodLabel}各项常规工作稳步推进，按计划筹备下一阶段重点任务。`);
  }

  const blockerText = draftB
    ? `- 需重点关注与协同跟进：${draftB.replace(/^-\s*/, '')}`
    : '- 整体排期与交付节奏正常，暂无外部依赖阻塞风险。';

  return {
    highlights: highlightsLines.join('\n'),
    blockers: blockerText
  };
}

export async function polishStandupWithAI({
  style = 'report',
  range = 'today',
  doneTasks = [],
  doingTasks = [],
  focusMinutes = 0,
  notes = [],
  currentHighlights = '',
  currentBlockers = ''
}) {
  const styleMeta = STANDUP_POLISH_STYLES.find(s => s.id === style) || STANDUP_POLISH_STYLES[0];
  const status = getAIStatus();

  if (status.configured) {
    const periodLabel = range === 'week' ? '本周工作周报' : '今日工作日报';
    const stylePromptMap = {
      report: '【工作汇报风】结构严谨、结果导向，突出业务交付价值、核心进展与后续排期，适合向主管或团队正式汇报。',
      concise: '【精简日报风】短句要点、结论先行、去除修饰词，每条控制在 30 字以内，适合敏捷站会快速同步。',
      review: '【复盘周结风】总结阶段成果、归纳执行节奏与方法沉淀，并明确下一阶段规划与风险预防。'
    };
    const sys = [
      '你是研发与产品团队的工作汇报顾问。请根据提供的已完成事项、进行中事项、专注时长和草稿备注，提炼出专业、精炼的汇报要点。',
      `当前指定润色风格：${stylePromptMap[styleMeta.id] || stylePromptMap.report}`,
      '语言风格要求：专业克制、逻辑清晰、去口语化、无空洞套话。',
      '只返回严格合法的 JSON 对象，格式为：',
      '{"highlights":"- 核心产出要点1\\n- 核心产出要点2","blockers":"- 风险与协同说明（若无风险则写：- 整体进度正常，暂无外部阻塞风险）"}'
    ].join('\n');

    const usr = JSON.stringify({
      reportType: periodLabel,
      style: styleMeta.label,
      focusMinutes,
      completedTasks: doneTasks.map(t => ({ text: t.text, tag: t.tag })),
      inProgressTasks: doingTasks.map(t => ({ text: t.text, tag: t.tag, time: t.time })),
      recentNotes: notes.map(n => n.title),
      draftHighlights: currentHighlights,
      draftBlockers: currentBlockers
    });

    const res = await callJsonChat({ systemPrompt: sys, userPrompt: usr, maxTokens: 500 });
    if (res.ok) {
      const parsed = extractJsonObject(res.content);
      if (parsed && typeof parsed.highlights === 'string' && parsed.highlights.trim()) {
        return {
          ok: true,
          mode: 'llm',
          style: styleMeta.id,
          styleLabel: styleMeta.label,
          hint: '',
          highlights: parsed.highlights.trim(),
          blockers: typeof parsed.blockers === 'string' && parsed.blockers.trim()
            ? parsed.blockers.trim()
            : '- 整体进度正常，暂无外部阻塞风险'
        };
      }
    }
  }

  const local = buildLocalStandupPolish({
    style: styleMeta.id,
    range,
    doneTasks,
    doingTasks,
    focusMinutes,
    currentHighlights,
    currentBlockers
  });
  return {
    ok: true,
    mode: 'local',
    style: styleMeta.id,
    styleLabel: styleMeta.label,
    hint: status.configured ? '' : '当前使用本地结构化模板生成；在「设置 → AI」配置接口后可启用大模型深度润色。',
    ...local
  };
}
