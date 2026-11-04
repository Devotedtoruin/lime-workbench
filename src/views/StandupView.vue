<script setup>
import { computed, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { STANDUP_POLISH_STYLES, polishStandupWithAI } from '../lib/ai-assist.js';

const wb = useWorkbench();
const copied = ref(false);
const range = ref('today');
const formatMode = ref('markdown'); // 'markdown' | 'plain'
const previewMode = ref('rendered'); // 'rendered' | 'source'
const polishStyle = ref('report'); // 'report' | 'concise' | 'review'
const aiPolishing = ref(false);
const aiPolishedPreview = ref(null);
const lastPolishBackup = ref(null);

const dayKey = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const weekStart = computed(() => {
  const d = new Date(wb.nowDate.value);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
});

const since = computed(() =>
  range.value === 'week' ? weekStart.value : new Date(`${wb.todayStr.value}T00:00:00`)
);

const done = computed(() => wb.state.todos
  .filter(t => t.done && t.completedAt && new Date(t.completedAt) >= since.value)
  .slice(0, 16));

const doing = computed(() => wb.openTodayTasks.value.slice(0, 12));
const notes = computed(() => wb.state.notes.slice(0, 6));

const focus = computed(() => {
  if (range.value === 'today') return wb.studyTodayMinutes.value;
  let seconds = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(wb.nowDate.value);
    d.setDate(d.getDate() - i);
    seconds += wb.state.study[dayKey(d)] || 0;
  }
  return Math.floor(seconds / 60);
});

const reportTitle = computed(() =>
  range.value === 'week'
    ? `工作周报 · ${dayKey(weekStart.value)} 至 ${wb.todayStr.value}`
    : `工作日报 · ${wb.todayStr.value}`
);

async function runAiPolish(styleId = polishStyle.value) {
  if (aiPolishing.value) return;
  polishStyle.value = styleId;
  aiPolishing.value = true;
  try {
    const res = await polishStandupWithAI({
      style: styleId,
      range: range.value,
      doneTasks: done.value,
      doingTasks: doing.value,
      focusMinutes: focus.value,
      notes: notes.value,
      currentHighlights: wb.standupDraft.highlights,
      currentBlockers: wb.standupDraft.blockers
    });
    if (res.ok) {
      aiPolishedPreview.value = res;
      wb.showToast(
        res.mode === 'llm'
          ? `已生成「${res.styleLabel}」风格润色建议`
          : `已按「${res.styleLabel}」模板提炼要点`
      );
    }
  } finally {
    aiPolishing.value = false;
  }
}

function applyAiPolish() {
  if (!aiPolishedPreview.value) return;
  lastPolishBackup.value = {
    highlights: wb.standupDraft.highlights,
    blockers: wb.standupDraft.blockers
  };
  wb.standupDraft.highlights = aiPolishedPreview.value.highlights;
  wb.standupDraft.blockers = aiPolishedPreview.value.blockers;
  aiPolishedPreview.value = null;
  wb.showToast('已替换至日报草稿，可随时撤销');
}

function undoAiPolish() {
  if (!lastPolishBackup.value) return;
  wb.standupDraft.highlights = lastPolishBackup.value.highlights;
  wb.standupDraft.blockers = lastPolishBackup.value.blockers;
  lastPolishBackup.value = null;
  wb.showToast('已恢复润色前的草稿内容');
}

const markdownSummary = computed(() => {
  const lines = [];
  lines.push(`# ${reportTitle.value}`);
  lines.push('');
  lines.push(`> **专注时长**：${focus.value} 分钟 ｜ **已完成**：${done.value.length} 项 ｜ **进行中**：${doing.value.length} 项`);
  lines.push('');
  lines.push(`## 一、${range.value === 'week' ? '本周已完成事项' : '今日已完成事项'}`);
  if (done.value.length) {
    for (const t of done.value) {
      const tag = t.tag ? ` \`${t.tag}\`` : '';
      lines.push(`- [x] ${t.text}${tag}`);
    }
  } else {
    lines.push('- 暂无已完成事项');
  }

  lines.push('');
  lines.push('## 二、进行中与后续计划');
  if (doing.value.length) {
    for (const t of doing.value) {
      const due = t.time ? ` (${t.time})` : '';
      const tag = t.tag ? ` \`${t.tag}\`` : '';
      lines.push(`- [ ] ${t.text}${due}${tag}`);
    }
  } else {
    lines.push('- 暂无待处理事项');
  }

  if (wb.standupDraft.highlights.trim()) {
    lines.push('');
    lines.push('## 三、关键产出与补充说明');
    for (const row of wb.standupDraft.highlights.trim().split('\n')) {
      const clean = row.trim();
      if (clean) lines.push(clean.startsWith('-') ? clean : `- ${clean}`);
    }
  }

  if (notes.value.length) {
    lines.push('');
    lines.push(`## ${wb.standupDraft.highlights.trim() ? '四' : '三'}、相关工作便签`);
    for (const n of notes.value) {
      lines.push(`- **${n.title}**${n.body ? `：${n.body.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`);
    }
  }

  lines.push('');
  lines.push('## 风险与协同需求');
  const blockers = wb.standupDraft.blockers.trim();
  if (blockers) {
    for (const row of blockers.split('\n')) {
      const clean = row.trim();
      if (clean) lines.push(clean.startsWith('-') ? clean : `- ${clean}`);
    }
  } else {
    lines.push('- 进度正常，暂无阻塞风险');
  }

  return lines.join('\n');
});

const plainSummary = computed(() => {
  const lines = [];
  lines.push(`【${reportTitle.value}】`);
  lines.push(`概览：专注 ${focus.value} 分钟 · 已完成 ${done.value.length} 项 · 进行中 ${doing.value.length} 项`);
  lines.push('');
  lines.push(range.value === 'week' ? '【本周已完成】' : '【今日已完成】');
  lines.push(done.value.length ? done.value.map((t, i) => `${i + 1}. ${t.text}`).join('\n') : '- 暂无已完成事项');
  lines.push('');
  lines.push('【进行中与计划】');
  lines.push(doing.value.length ? doing.value.map((t, i) => `${i + 1}. ${t.text}${t.time ? ` (${t.time})` : ''}`).join('\n') : '- 暂无进行中事项');
  if (wb.standupDraft.highlights.trim()) {
    lines.push('');
    lines.push('【关键产出与补充】');
    lines.push(wb.standupDraft.highlights.trim());
  }
  if (notes.value.length) {
    lines.push('');
    lines.push('【工作便签】');
    lines.push(notes.value.map(n => `- ${n.title}`).join('\n'));
  }
  lines.push('');
  lines.push('【风险与协同需求】');
  lines.push(wb.standupDraft.blockers.trim() || '进度正常，暂无阻塞风险');
  return lines.join('\n');
});

const activeOutput = computed(() =>
  formatMode.value === 'markdown' ? markdownSummary.value : plainSummary.value
);

async function copyReport(forceMarkdown = false) {
  const text = forceMarkdown ? markdownSummary.value : activeOutput.value;
  await wb.copyText(text);
  copied.value = true;
  wb.showToast(`${range.value === 'week' ? '周报' : '日报'}（${forceMarkdown || formatMode.value === 'markdown' ? 'Markdown' : '纯文本'}）已复制到剪贴板`);
  setTimeout(() => { copied.value = false; }, 1800);
}

function downloadMarkdown() {
  const filename = `${range.value === 'week' ? '工作周报' : '工作日报'}-${wb.todayStr.value}.md`;
  const blob = new Blob([markdownSummary.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  wb.showToast(`已下载 ${filename}`);
}

function saveAsNote() {
  const title = `${wb.todayStr.value} ${range.value === 'week' ? '周报归档' : '日报归档'}`;
  if (wb.saveNoteRecord({ title, body: activeOutput.value })) {
    wb.showToast('已归档至工作便签');
  }
}

const activeArchiveId = ref(null);
function saveToArchive() {
  wb.archiveStandupReport({
    range: range.value,
    title: reportTitle.value,
    markdown: markdownSummary.value,
    doneCount: done.value.length,
    doingCount: doing.value.length,
    focusMinutes: focus.value
  });
}

async function copyArchived(item) {
  await wb.copyText(item.markdown);
  wb.showToast(`已复制归档：${item.title}`);
}

function downloadArchived(item) {
  const filename = `${item.title.replace(/\s+/g, '-')}.md`;
  const blob = new Blob([item.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  wb.showToast(`已下载 ${filename}`);
}
</script>

<template>
  <div class="page-shell standup-page">
    <header class="page-head standup-head">
      <div>
        <p class="eyebrow">{{ wb.formattedDate.value }} · 进度复盘与文档输出</p>
        <h1>工作日报</h1>
        <p class="sub">自动汇总已完成任务、进行中事项、专注时长与工作便签，支持导出标准 Markdown 文档或直接分享至工作群。</p>
      </div>
      <div class="standup-head-actions">
        <div class="segmented" aria-label="汇总周期">
          <button type="button" :class="{ 'is-active': range === 'today' }" @click="range = 'today'">今日日报</button>
          <button type="button" :class="{ 'is-active': range === 'week' }" @click="range = 'week'">本周周报</button>
        </div>
      </div>
    </header>

    <section class="standup-stats" aria-label="关键指标概览">
      <div class="stat-card panel glass rim">
        <span>已完成事项</span>
        <strong class="numeric">{{ done.length }}<em>项</em></strong>
      </div>
      <div class="stat-card panel glass rim">
        <span>进行中事项</span>
        <strong class="numeric">{{ doing.length }}<em>项</em></strong>
      </div>
      <div class="stat-card panel glass rim">
        <span>累计专注时长</span>
        <strong class="numeric">{{ focus }}<em>分钟</em></strong>
      </div>
      <div class="stat-card panel glass rim">
        <span>关联工作便签</span>
        <strong class="numeric">{{ wb.state.notes.length }}<em>条</em></strong>
      </div>
    </section>

    <div class="standup-grid">
      <!-- 左侧：数据来源明细与补充录入 -->
      <section class="panel glass rim standup-flow">
        <div class="panel-head">
          <h2 class="panel-title">
            <img :src="asset('assets/icons/clipboard-list.svg')" alt="" />进展明细与补充填写
          </h2>
          <button
            v-if="lastPolishBackup"
            class="btn btn-ghost btn-xs"
            type="button"
            @click="undoAiPolish"
          >
            <img :src="asset('assets/icons/rotate-ccw.svg')" alt="" />撤销上次替换
          </button>
        </div>

        <!-- 输入区上方：多风格智能润色工具栏 -->
        <div class="polish-toolbar" role="toolbar" aria-label="日报润色风格工具栏">
          <div class="polish-toolbar-left">
            <span class="polish-toolbar-label">
              <img :src="asset('assets/icons/sparkles.svg')" alt="" />智能提炼润色：
            </span>
            <div class="polish-style-Group">
              <button
                v-for="st in STANDUP_POLISH_STYLES"
                :key="st.id"
                type="button"
                class="polish-style-btn"
                :class="{ 'is-active': polishStyle === st.id }"
                :disabled="aiPolishing"
                :title="st.desc"
                @click="polishStyle = st.id"
              >
                {{ st.label }}
              </button>
            </div>
          </div>
          <button
            class="btn btn-soft btn-xs ai-polish-btn"
            type="button"
            :disabled="aiPolishing"
            @click="runAiPolish(polishStyle)"
          >
            {{ aiPolishing ? '提炼中…' : '生成预览' }}
          </button>
        </div>

        <!-- 润色结果预览与替换卡片 -->
        <div v-if="aiPolishedPreview" class="standup-ai-card">
          <div class="standup-ai-card-head">
            <div class="standup-ai-badge">
              <img :src="asset('assets/icons/sparkles.svg')" alt="" />
              <strong>{{ aiPolishedPreview.styleLabel }} · {{ aiPolishedPreview.mode === 'llm' ? '接口模型润色预览' : '本地结构化提炼预览' }}</strong>
            </div>
            <div class="standup-ai-actions">
              <button class="btn btn-primary btn-xs" type="button" @click="applyAiPolish">确认替换草稿</button>
              <button class="btn btn-ghost btn-xs" type="button" @click="aiPolishedPreview = null">关闭</button>
            </div>
          </div>
          <p v-if="aiPolishedPreview.hint" class="standup-ai-hint">
            <span>{{ aiPolishedPreview.hint }}</span>
            <button type="button" class="link-inline-btn" @click="wb.goto('me')">前往设置</button>
          </p>
          <div class="standup-ai-body">
            <div>
              <small>关键产出与补充说明</small>
              <pre>{{ aiPolishedPreview.highlights }}</pre>
            </div>
            <div>
              <small>风险项与协同需求</small>
              <pre>{{ aiPolishedPreview.blockers }}</pre>
            </div>
          </div>
        </div>

        <div class="draft-fields">
          <label class="field">
            <span>关键产出 / 补充说明</span>
            <textarea
              v-model="wb.standupDraft.highlights"
              class="input standup-input"
              rows="2"
              maxlength="400"
              placeholder="补充未列入待办的关键成果、阶段结论或明日重点计划（自动保存草稿）"
            ></textarea>
          </label>
          <label class="field">
            <span>风险项 / 协同需求</span>
            <textarea
              v-model="wb.standupDraft.blockers"
              class="input standup-input"
              rows="2"
              maxlength="300"
              placeholder="记录当前面临的进度阻碍、跨团队依赖或需协调事项（自动保存草稿）"
            ></textarea>
          </label>
        </div>

        <div class="flow-group">
          <div class="flow-group-head">
            <p class="flow-label"><i class="flow-dot done"></i>已完成事项</p>
            <span class="badge numeric">{{ done.length }}</span>
          </div>
          <TransitionGroup v-if="done.length" name="list-anim" tag="ul" class="flow-list">
            <li v-for="t in done" :key="t.id">
              <span class="flow-check"><img :src="asset('assets/icons/check.svg')" alt="" /></span>
              <span class="flow-text">{{ t.text }}</span>
              <span v-if="t.tag" class="flow-meta">{{ t.tag }}</span>
            </li>
          </TransitionGroup>
          <p v-else class="flow-empty">当前周期内暂无已完成事项记录。</p>
        </div>

        <div class="flow-group">
          <div class="flow-group-head">
            <p class="flow-label"><i class="flow-dot doing"></i>进行中事项</p>
            <span class="badge numeric">{{ doing.length }}</span>
          </div>
          <TransitionGroup v-if="doing.length" name="list-anim" tag="ul" class="flow-list">
            <li v-for="(t, idx) in doing" :key="t.id">
              <span class="flow-index numeric">{{ String(idx + 1).padStart(2, '0') }}</span>
              <span class="flow-text">{{ t.text }}</span>
              <span v-if="t.time" class="flow-meta numeric">{{ t.time }}</span>
            </li>
          </TransitionGroup>
          <p v-else class="flow-empty">当前无待处理的今日事项。</p>
        </div>

        <div class="flow-group">
          <div class="flow-group-head">
            <p class="flow-label"><i class="flow-dot note"></i>近期工作便签</p>
            <span class="badge numeric">{{ notes.length }}</span>
          </div>
          <TransitionGroup v-if="notes.length" name="list-anim" tag="ul" class="flow-list">
            <li v-for="n in notes" :key="n.id">
              <span class="flow-index"><img :src="asset('assets/icons/sticky-note.svg')" alt="" /></span>
              <span class="flow-text">{{ n.title }}</span>
            </li>
          </TransitionGroup>
          <p v-else class="flow-empty">暂无工作便签记录。</p>
        </div>

        <div class="standup-actions">
          <button class="btn btn-soft btn-sm" type="button" @click="wb.goto('todo')">管理任务列表</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="wb.goto('study')">查看专注统计</button>
        </div>
      </section>

      <!-- 右侧：Markdown 预览、复制与下载面板 -->
      <section class="panel glass rim standup-draft">
        <div class="panel-head standup-draft-head">
          <div>
            <h2 class="panel-title">文档生成与预览</h2>
            <p class="panel-sub">支持标准 Markdown 语法与纯文本格式无缝切换</p>
          </div>
          <div class="draft-mode-switches">
            <div class="segmented" aria-label="输出格式">
              <button type="button" :class="{ 'is-active': formatMode === 'markdown' }" @click="formatMode = 'markdown'">Markdown</button>
              <button type="button" :class="{ 'is-active': formatMode === 'plain' }" @click="formatMode = 'plain'">纯文本</button>
            </div>
            <div v-if="formatMode === 'markdown'" class="segmented" aria-label="预览方式">
              <button type="button" :class="{ 'is-active': previewMode === 'rendered' }" @click="previewMode = 'rendered'">排版预览</button>
              <button type="button" :class="{ 'is-active': previewMode === 'source' }" @click="previewMode = 'source'">源码</button>
            </div>
          </div>
        </div>

        <!-- 结构化 Markdown 渲染预览 -->
        <article
          v-if="formatMode === 'markdown' && previewMode === 'rendered'"
          class="md-rendered"
          aria-label="Markdown 渲染预览"
        >
          <header class="md-doc-head">
            <h3>{{ reportTitle }}</h3>
            <p class="md-quote">
              <span>专注时长：<strong class="numeric">{{ focus }}</strong> 分钟</span>
              <span aria-hidden="true">·</span>
              <span>已完成：<strong class="numeric">{{ done.length }}</strong> 项</span>
              <span aria-hidden="true">·</span>
              <span>进行中：<strong class="numeric">{{ doing.length }}</strong> 项</span>
            </p>
          </header>

          <section class="md-section">
            <h4>一、{{ range === 'week' ? '本周已完成事项' : '今日已完成事项' }}</h4>
            <ul v-if="done.length" class="md-task-list">
              <li v-for="t in done" :key="t.id" class="is-done">
                <span class="md-box checked" aria-hidden="true">✓</span>
                <span>{{ t.text }}</span>
                <code v-if="t.tag">{{ t.tag }}</code>
              </li>
            </ul>
            <p v-else class="md-muted">暂无已完成事项</p>
          </section>

          <section class="md-section">
            <h4>二、进行中与后续计划</h4>
            <ul v-if="doing.length" class="md-task-list">
              <li v-for="t in doing" :key="t.id">
                <span class="md-box" aria-hidden="true"></span>
                <span>{{ t.text }}</span>
                <small v-if="t.time" class="numeric">({{ t.time }})</small>
                <code v-if="t.tag">{{ t.tag }}</code>
              </li>
            </ul>
            <p v-else class="md-muted">暂无待处理事项</p>
          </section>

          <section v-if="wb.standupDraft.highlights.trim()" class="md-section">
            <h4>三、关键产出与补充说明</h4>
            <p class="md-pre">{{ wb.standupDraft.highlights.trim() }}</p>
          </section>

          <section v-if="notes.length" class="md-section">
            <h4>{{ wb.standupDraft.highlights.trim() ? '四' : '三' }}、相关工作便签</h4>
            <ul class="md-bullet-list">
              <li v-for="n in notes" :key="n.id">
                <strong>{{ n.title }}</strong>
                <span v-if="n.body">：{{ n.body.replace(/\s+/g, ' ').slice(0, 60) }}</span>
              </li>
            </ul>
          </section>

          <section class="md-section">
            <h4>风险与协同需求</h4>
            <p class="md-pre">{{ wb.standupDraft.blockers.trim() || '进度正常，暂无阻塞风险' }}</p>
          </section>
        </article>

        <!-- Markdown 源码 / 纯文本预览 -->
        <pre v-else class="standup-preview">{{ activeOutput }}</pre>

        <div class="standup-draft-btns">
          <button class="btn btn-soft" type="button" @click="saveToArchive">
            <img :src="asset('assets/icons/calendar-clock.svg')" alt="" />归档至历史时间线
          </button>
          <button class="btn btn-soft" type="button" @click="saveAsNote">
            <img :src="asset('assets/icons/sticky-note.svg')" alt="" />存为工作便签
          </button>
          <button class="btn btn-soft" type="button" @click="downloadMarkdown">
            <img :src="asset('assets/icons/download.svg')" alt="" />下载 .md 文件
          </button>
          <button class="btn btn-primary standup-copy" type="button" @click="copyReport(false)">
            <img :src="asset('assets/icons/copy.svg')" alt="" />
            {{ copied ? '已复制到剪贴板' : formatMode === 'markdown' ? '复制 Markdown' : '复制纯文本' }}
          </button>
        </div>
        <p class="tiny">所有汇总内容均在本地实时生成，支持直接粘贴至飞书、企业微信、钉钉或本地 Markdown 知识库。</p>
      </section>
    </div>

    <!-- 历史日报与周报归档时间线 -->
    <section class="panel glass rim archive-panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">
            <img :src="asset('assets/icons/calendar-days.svg')" alt="" />历史日报与周报归档时间线
          </h2>
          <p class="panel-sub">按日期保存的阶段性产出快照，方便季度复盘、绩效述职与工作回溯</p>
        </div>
        <span class="badge numeric">已归档 {{ wb.reportArchive.value.length }} 篇</span>
      </div>

      <div v-if="!wb.reportArchive.value.length" class="archive-empty">
        <p>暂无归档记录。点击上方「归档至历史时间线」即可将当日日报或本周周报冻结保存为历史快照。</p>
      </div>
      <TransitionGroup v-else name="list-anim" tag="div" class="archive-timeline">
        <article
          v-for="item in wb.reportArchive.value"
          :key="item.id"
          class="archive-card"
          :class="{ 'is-expanded': activeArchiveId === item.id }"
        >
          <div class="archive-head" @click="activeArchiveId = activeArchiveId === item.id ? null : item.id">
            <div class="archive-title-row">
              <span class="archive-badge" :class="item.range === 'week' ? 'is-week' : 'is-day'">
                {{ item.range === 'week' ? '周报' : '日报' }}
              </span>
              <strong>{{ item.title }}</strong>
              <span class="archive-metrics numeric">
                已完成 {{ item.doneCount ?? item.stats?.done ?? 0 }} 项 · 进行中 {{ item.doingCount ?? item.stats?.doing ?? 0 }} 项 · 专注 {{ item.focusMinutes ?? item.stats?.focus ?? 0 }}m
              </span>
            </div>
            <div class="archive-actions" @click.stop>
              <button class="btn btn-ghost btn-sm" type="button" @click="activeArchiveId = activeArchiveId === item.id ? null : item.id">
                {{ activeArchiveId === item.id ? '收起' : '查看' }}
              </button>
              <button class="btn btn-soft btn-sm" type="button" @click="copyArchived(item)">复制</button>
              <button class="btn btn-soft btn-sm" type="button" @click="downloadArchived(item)">下载 .md</button>
              <button class="btn-icon is-danger" type="button" title="删除归档" aria-label="删除归档" @click="wb.deleteArchivedReport(item.id)">
                <img :src="asset('assets/icons/trash.svg')" alt="" />
              </button>
            </div>
          </div>
          <pre v-if="activeArchiveId === item.id" class="archive-body">{{ item.markdown }}</pre>
        </article>
      </TransitionGroup>
    </section>
  </div>
</template>

<style scoped>
.standup-head { align-items: flex-end; }
.standup-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.eyebrow { margin: 0 0 6px; font-size: var(--text-meta); font-weight: 650; letter-spacing: .04em; color: var(--brand-deep); }

.standup-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--shell-gap); }
.stat-card { padding: 16px 20px; border-radius: var(--radius-card); display: flex; flex-direction: column; gap: 6px; }
.stat-card span { font-size: var(--text-meta); font-weight: 600; color: var(--muted); }
.stat-card strong { font-size: 28px; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; color: var(--ink); }
.stat-card em { margin-left: 4px; font-size: var(--text-meta); font-style: normal; font-weight: 500; color: var(--muted); }

.standup-grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(360px, .95fr); gap: var(--shell-gap); align-items: start; }
.standup-flow, .standup-draft { padding: 22px; }

.polish-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 8px 10px; margin-bottom: 12px;
  border-radius: 10px; border: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}
.polish-toolbar-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.polish-toolbar-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: var(--text-meta); font-weight: 650; color: var(--ink-soft);
}
.polish-toolbar-label img { width: 13px; height: 13px; }
.polish-style-Group { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.polish-style-btn {
  min-height: 26px; padding: 0 10px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-soft); font-size: var(--text-2xs); font-weight: 600;
  transition: all var(--motion-fast);
}
.polish-style-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.polish-style-btn.is-active {
  border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 700;
}
.ai-polish-btn {
  border-color: color-mix(in srgb, var(--brand) 30%, var(--line));
  background: var(--brand-pale); color: var(--brand-deep);
}
.ai-polish-btn img { width: 14px; height: 14px; }

.standup-ai-card {
  margin-bottom: 14px; padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 34%, var(--line));
  background: color-mix(in srgb, var(--brand-pale) 40%, var(--surface));
  display: flex; flex-direction: column; gap: 10px;
}
.standup-ai-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.standup-ai-badge {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--text-sm); color: var(--brand-deep);
}
.standup-ai-badge img { width: 14px; height: 14px; }
.standup-ai-actions { display: flex; align-items: center; gap: 6px; }
.standup-ai-hint {
  margin: 0; font-size: var(--text-2xs); color: var(--muted);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.link-inline-btn {
  padding: 0; border: 0; background: transparent;
  color: var(--brand-deep); font-size: var(--text-2xs); font-weight: 650;
  text-decoration: underline; cursor: pointer;
}
.standup-ai-body {
  display: grid; gap: 8px;
}
.standup-ai-body small {
  display: block; margin-bottom: 3px;
  font-size: var(--text-2xs); font-weight: 650; color: var(--muted);
}
.standup-ai-body pre {
  margin: 0; padding: 8px 10px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  font-family: var(--font-sans); font-size: var(--text-sm); line-height: 1.55;
  white-space: pre-wrap; color: var(--ink);
}

.draft-fields {
  display: grid; gap: 12px; padding-bottom: 18px; margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.standup-input { width: 100%; resize: vertical; min-height: 62px; }

.flow-group { padding: 16px 0; border-bottom: 1px solid var(--line); }
.flow-group:last-of-type { border-bottom: 0; }
.flow-group-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.flow-label { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--text-sm); font-weight: 650; color: var(--ink-soft); }
.flow-dot { width: 7px; height: 7px; border-radius: 50%; }
.flow-dot.done { background: var(--brand); }
.flow-dot.doing { background: var(--amber); }
.flow-dot.note { background: var(--blue); }
.flow-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; position: relative; }
.flow-list li {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 10px; background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  font-size: var(--text-body);
}
.flow-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.flow-meta { font-size: var(--text-2xs); color: var(--muted); white-space: nowrap; }
.flow-check, .flow-index {
  width: 22px; height: 22px; flex: 0 0 22px; display: grid; place-items: center;
  border-radius: 6px; background: var(--surface); border: 1px solid var(--line);
  color: var(--muted); font-size: 11px; font-weight: 650;
}
.flow-check { background: var(--brand-pale); border-color: color-mix(in srgb, var(--brand) 25%, transparent); }
.flow-check img, .flow-index img { width: 12px; height: 12px; opacity: .8; }
.flow-empty { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.standup-actions { display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--line); }

.standup-draft { position: sticky; top: 84px; }
.standup-draft-head { flex-wrap: wrap; align-items: flex-start; gap: 12px; }
.draft-mode-switches { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.md-rendered {
  margin: 14px 0; padding: 18px 20px; max-height: 52vh; overflow: auto;
  border: 1px solid var(--line); border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  display: flex; flex-direction: column; gap: 14px;
}
.md-doc-head { padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.md-doc-head h3 { font-size: var(--text-md); font-weight: 750; color: var(--ink); letter-spacing: -.01em; }
.md-quote {
  margin-top: 8px; padding: 7px 11px; border-radius: 8px;
  background: var(--surface-soft); border: 1px solid var(--line);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: var(--text-meta); color: var(--ink-soft);
}
.md-section { display: flex; flex-direction: column; gap: 7px; }
.md-section h4 { font-size: var(--text-sm); font-weight: 700; color: var(--brand-deep); letter-spacing: -.005em; }
.md-task-list, .md-bullet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: var(--text-sm); }
.md-task-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--ink); }
.md-task-list li.is-done { color: var(--ink-soft); }
.md-box {
  width: 16px; height: 16px; flex: 0 0 16px; border-radius: 4px;
  border: 1px solid var(--line-strong); background: var(--surface);
  display: inline-grid; place-items: center; font-size: 10px; font-weight: 800; color: var(--cta-fg);
}
.md-box.checked { background: var(--brand); border-color: var(--brand); }
.md-task-list code {
  padding: 1px 6px; border-radius: 5px; background: var(--surface-soft);
  border: 1px solid var(--line); font-size: var(--text-2xs); color: var(--muted);
}
.md-pre { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); white-space: pre-wrap; line-height: 1.65; }
.md-muted { margin: 0; font-size: var(--text-meta); color: var(--muted); }

.standup-preview {
  margin: 14px 0; padding: 16px 18px; max-height: 52vh; overflow: auto;
  white-space: pre-wrap; font-family: var(--font-numeric); font-size: 12.5px; line-height: 1.72;
  color: var(--ink); background: color-mix(in srgb, var(--surface-soft) 84%, transparent);
  border: 1px solid var(--line); border-radius: 14px;
}
.standup-draft-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.standup-copy { flex: 1; min-width: 140px; }
.standup-draft .tiny { margin: 10px 0 0; color: var(--muted); font-size: var(--text-meta); }

.archive-panel { padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.archive-empty {
  padding: 24px 16px; border: 1px dashed var(--line); border-radius: 12px;
  text-align: center; font-size: var(--text-sm); color: var(--muted);
}
.archive-timeline { display: flex; flex-direction: column; gap: 10px; position: relative; }
.archive-card {
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--surface-soft); overflow: hidden;
  transition: border-color var(--motion-fast);
}
.archive-card.is-expanded { border-color: var(--brand); background: var(--surface); }
.archive-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; cursor: pointer; flex-wrap: wrap;
}
.archive-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.archive-badge {
  padding: 2px 8px; border-radius: 6px; font-size: var(--text-2xs); font-weight: 700;
}
.archive-badge.is-day { background: var(--brand-pale); color: var(--brand-deep); }
.archive-badge.is-week { background: var(--blue-pale); color: var(--blue); }
.archive-metrics { font-size: var(--text-meta); color: var(--muted); }
.archive-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.archive-body {
  margin: 0; padding: 14px 16px; border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 65%, transparent);
  font-family: var(--font-numeric); font-size: 12.5px; line-height: 1.7;
  white-space: pre-wrap; max-height: 360px; overflow: auto;
}

@container workbench (max-width: 960px) {
  .standup-grid { grid-template-columns: 1fr; }
  .standup-draft { position: static; }
}
@container workbench (max-width: 640px) {
  .standup-stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 1040px) {
  .standup-grid { grid-template-columns: 1fr; }
  .standup-draft { position: static; }
}
@media (max-width: 680px) {
  .standup-stats { grid-template-columns: repeat(2, 1fr); }
  .standup-flow, .standup-draft { padding: 16px; }
  .standup-draft-btns { flex-direction: column; }
}
</style>
