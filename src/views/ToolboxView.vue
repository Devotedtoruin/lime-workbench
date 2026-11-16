<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import {
  formatJsonTool,
  testRegexTool,
  convertTimestampTool,
  encodeDecodeTool,
  generateUuids,
  contrastRatioTool,
  typeScaleTool,
  calculateGpa,
  formatCitation,
  calculateFreelanceQuote,
  splitContractPhases,
  dateDiffTool,
  convertUnitTool
} from '../../js/toolbox.js';

const wb = useWorkbench();

const GROUPS = [
  { id: 'dev', label: '研发编码', desc: 'JSON 格式化 · 正则测试 · 时间戳/UUID · 编解码' },
  { id: 'design', label: '产品与设计', desc: 'WCAG 对比度检测 · 字号比例尺 CSS 生成' },
  { id: 'study', label: '学术与学习', desc: '加权 GPA 计算 · GB7714 / APA 引文生成' },
  { id: 'finance', label: '自由职业与经营', desc: '工时报价反推 · 分期合同拆账联动账本' },
  { id: 'general', label: '通用效率', desc: '日期工作日推算 · 常用单位与汇率换算' }
];

const activeGroup = ref(wb.toolboxTarget.value.group || wb.currentRole.value.defaultToolGroup || 'general');
const activeSubTool = ref(wb.toolboxTarget.value.tool || '');

watch(() => wb.toolboxTarget.value, target => {
  if (target?.group) activeGroup.value = target.group;
  if (target?.tool) activeSubTool.value = target.tool;
}, { deep: true });

watch(() => wb.currentRole.value.defaultToolGroup, grp => {
  if (!wb.toolboxTarget.value.group && grp) activeGroup.value = grp;
});

/* ---------------- 1. 研发工具组 ---------------- */
const jsonInput = ref('{\n  "workbench": "lime",\n  "version": 2,\n  "modules": ["projects", "bookmarks", "notes"]\n}');
const jsonSortKeys = ref(false);
const jsonMinify = ref(false);
const jsonRes = computed(() => formatJsonTool(jsonInput.value, { sortKeys: jsonSortKeys.value, minify: jsonMinify.value }));

const regexPat = ref('(\\d{4})-(\\d{2})-(\\d{2})');
const regexFlags = ref('g');
const regexSample = ref('版本计划于 2026-11-15 冻结，并于 2026-12-01 正式发布。');
const regexRes = computed(() => testRegexTool(regexPat.value, regexFlags.value, regexSample.value));

const tsInput = ref(String(Math.floor(Date.now() / 1000)));
const tsRes = computed(() => convertTimestampTool(tsInput.value));
const uuids = ref(generateUuids(4));
function refreshTsNow() {
  tsInput.value = String(Math.floor(Date.now() / 1000));
}

const codecMode = ref('url-enc');
const codecInput = ref('https://example.com/?q=青柠工作台');
const codecRes = computed(() => encodeDecodeTool(codecMode.value, codecInput.value));

/* ---------------- 2. 设计工具组 ---------------- */
const fgHex = ref('#1F2937');
const bgHex = ref('#F8FAFC');
const contrastRes = computed(() => contrastRatioTool(fgHex.value, bgHex.value));

const typeBase = ref(16);
const typeRatio = ref(1.25);
const typeRows = computed(() => typeScaleTool(typeBase.value, typeRatio.value));
const typeCssSnippet = computed(() =>
  typeRows.value.map(r => `  --${r.token}: ${r.rem}rem; /* ${r.px}px */`).join('\n')
);

/* ---------------- 3. 学术工具组 ---------------- */
const gpaScale = ref(4);
const gpaCourses = reactive([
  { name: '数据结构与算法', credit: 4, score: 91 },
  { name: '操作系统原理', credit: 3.5, score: 86 },
  { name: '软件工程实践', credit: 3, score: 88 }
]);
const gpaRes = computed(() => calculateGpa(gpaCourses, gpaScale.value));
function addCourseRow() {
  if (gpaCourses.length >= 20) return;
  gpaCourses.push({ name: `课程 ${gpaCourses.length + 1}`, credit: 2, score: 85 });
}

const citeStyle = ref('gb');
const citeFields = reactive({
  author: '张三, 李四',
  year: String(new Date().getFullYear()),
  title: '本地优先个人工作台架构设计',
  source: '计算机应用研究',
  pages: '112-119'
});
const citeText = computed(() => formatCitation(citeStyle.value, citeFields));

/* ---------------- 4. 自由职业与经营 ---------------- */
const quoteForm = reactive({ hourlyRate: 350, hours: 32, bufferPct: 15, taxPct: 6 });
const quoteRes = computed(() => calculateFreelanceQuote(quoteForm));

const contractTotal = ref(12000);
const contractPhases = reactive([
  { name: '签约首付款', pct: 40 },
  { name: '设计开发验收', pct: 30 },
  { name: '上线交付尾款', pct: 30 }
]);
const splitRes = computed(() => splitContractPhases(contractTotal.value, contractPhases));
function pushPhaseTodo(phase) {
  wb.addTodo(`[回款节点] ${phase.name}（¥${phase.amount}）`, {
    bucket: 'today',
    date: wb.todayStr.value,
    priority: 'high',
    tag: '客户回款'
  });
  wb.showToast(`已推送「${phase.name}」至今日待办`);
}
function recordPhaseIncome(phase) {
  const ok = wb.addLedgerRecord({
    type: 'income',
    amount: phase.amount,
    cat: '💼 收入',
    note: `合同阶段回款 · ${phase.name}`
  });
  if (ok) wb.showToast(`已记入账本收入 ¥${phase.amount}`);
}

/* ---------------- 5. 通用效率 ---------------- */
const startDate = ref(wb.todayStr.value);
const endDate = ref(wb.todayStr.value);
const dateRes = computed(() => dateDiffTool(startDate.value, endDate.value));

const unitCategory = ref('currency');
const unitValue = ref(100);
const unitFrom = ref('USD');
const unitTo = ref('CNY');
const customFxRate = ref(7.24);
const UNIT_OPTIONS = {
  currency: ['USD', 'CNY'],
  length: ['km', 'm', 'cm', 'mm', 'inch', 'ft'],
  weight: ['kg', 'g', 'jin', 'lb'],
  data: ['GB', 'MB', 'KB', 'TB']
};
watch(unitCategory, cat => {
  const opts = UNIT_OPTIONS[cat] || ['m', 'cm'];
  unitFrom.value = opts[0];
  unitTo.value = opts[1] || opts[0];
});
const unitRes = computed(() =>
  convertUnitTool(unitCategory.value, unitValue.value, unitFrom.value, unitTo.value, customFxRate.value)
);
</script>

<template>
  <div class="page-shell toolbox-page">
    <header class="page-head">
      <div>
        <h1>职业专属工具箱</h1>
        <p class="sub">完全离线计算，针对研发、设计、学术、自由职业与日常排期提供即时实用工具。</p>
      </div>
    </header>

    <!-- 工具组分类选项卡 -->
    <div class="group-tabs" role="tablist" aria-label="工具箱职业分类">
      <button
        v-for="g in GROUPS"
        :key="g.id"
        type="button"
        role="tab"
        class="group-tab"
        :class="{ 'is-active': activeGroup === g.id }"
        :aria-selected="activeGroup === g.id"
        @click="activeGroup = g.id; activeSubTool = ''"
      >
        <strong>{{ g.label }}</strong>
        <small>{{ g.desc }}</small>
      </button>
    </div>

    <!-- 1. 研发编码 -->
    <div v-if="activeGroup === 'dev'" class="tool-grid">
      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'json-fmt' }">
        <div class="panel-head">
          <h2 class="panel-title">JSON 格式化与校验</h2>
          <div class="tool-actions">
            <label class="inline-check"><input v-model="jsonSortKeys" type="checkbox" class="checkbox" />键排序</label>
            <label class="inline-check"><input v-model="jsonMinify" type="checkbox" class="checkbox" />单行压缩</label>
            <button v-if="jsonRes.ok" class="btn btn-soft btn-xs" type="button" @click="wb.copyText(jsonRes.output)">复制结果</button>
          </div>
        </div>
        <div class="two-pane">
          <textarea v-model="jsonInput" class="input code-area" rows="8" placeholder="粘贴原始 JSON 字符串…"></textarea>
          <textarea class="input code-area" rows="8" readonly :value="jsonRes.ok ? jsonRes.output : ''"></textarea>
        </div>
        <p v-if="!jsonRes.ok" class="field-error" role="alert">{{ jsonRes.error }}</p>
        <p v-else class="tool-meta">{{ jsonRes.stats }}</p>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'regex-test' }">
        <div class="panel-head">
          <h2 class="panel-title">正则表达式在线调试</h2>
          <span class="badge numeric">{{ regexRes.ok ? `匹配 ${regexRes.matches.length} 处` : '语法异常' }}</span>
        </div>
        <div class="regex-bar">
          <input v-model="regexPat" class="input code-inline" placeholder="正则表达式（不含斜杠）" />
          <input v-model="regexFlags" class="input code-inline flags-input" placeholder="g" maxlength="6" />
        </div>
        <textarea v-model="regexSample" class="input" rows="3" placeholder="输入待匹配测试文本…"></textarea>
        <p v-if="!regexRes.ok" class="field-error" role="alert">{{ regexRes.error }}</p>
        <ul v-else-if="regexRes.matches.length" class="match-list">
          <li v-for="(m, idx) in regexRes.matches.slice(0, 12)" :key="idx">
            <code class="numeric">#{{ idx + 1 }} @{{ m.index }}</code>
            <strong>{{ m.text }}</strong>
            <span v-if="m.groups.length">分组: {{ m.groups.join(' | ') }}</span>
          </li>
        </ul>
        <p v-else class="tool-meta">当前文本下未匹配到任何结果。</p>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'timestamp' }">
        <div class="panel-head">
          <h2 class="panel-title">时间戳转换 & UUID 生成</h2>
          <button class="btn btn-soft btn-xs" type="button" @click="refreshTsNow">填入当前时间戳</button>
        </div>
        <input v-model="tsInput" class="input numeric" placeholder="输入 10/13 位时间戳或 2026-11-15 12:00:00" />
        <p v-if="!tsRes.ok" class="field-error" role="alert">{{ tsRes.error }}</p>
        <dl v-else class="kv-grid numeric">
          <div><dt>秒级 (s)</dt><dd>{{ tsRes.seconds }}</dd></div>
          <div><dt>毫秒级 (ms)</dt><dd>{{ tsRes.milliseconds }}</dd></div>
          <div><dt>本地时间</dt><dd>{{ tsRes.local }}</dd></div>
          <div><dt>ISO 8601</dt><dd>{{ tsRes.iso }}</dd></div>
        </dl>
        <div class="uuid-box">
          <div class="uuid-head">
            <span>UUID v4 批量生成</span>
            <button class="btn btn-soft btn-xs" type="button" @click="uuids = generateUuids(4)">重新生成</button>
          </div>
          <div class="uuid-list">
            <button v-for="u in uuids" :key="u" type="button" class="uuid-chip numeric" @click="wb.copyText(u)">{{ u }}</button>
          </div>
        </div>
      </section>

      <section class="panel glass rim">
        <div class="panel-head">
          <h2 class="panel-title">URL / Base64 编解码</h2>
          <div class="segmented">
            <button type="button" :class="{ 'is-active': codecMode === 'url-enc' }" @click="codecMode = 'url-enc'">URL 编码</button>
            <button type="button" :class="{ 'is-active': codecMode === 'url-dec' }" @click="codecMode = 'url-dec'">URL 解码</button>
            <button type="button" :class="{ 'is-active': codecMode === 'base64-enc' }" @click="codecMode = 'base64-enc'">Base64 编码</button>
            <button type="button" :class="{ 'is-active': codecMode === 'base64-dec' }" @click="codecMode = 'base64-dec'">Base64 解码</button>
          </div>
        </div>
        <textarea v-model="codecInput" class="input code-area" rows="3" placeholder="输入原文或编码文本…"></textarea>
        <p v-if="!codecRes.ok" class="field-error" role="alert">{{ codecRes.error }}</p>
        <div v-else class="codec-output">
          <code class="numeric">{{ codecRes.output }}</code>
          <button class="btn btn-soft btn-xs" type="button" @click="wb.copyText(codecRes.output)">复制</button>
        </div>
      </section>
    </div>

    <!-- 2. 产品与设计 -->
    <div v-else-if="activeGroup === 'design'" class="tool-grid">
      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'contrast' }">
        <div class="panel-head">
          <h2 class="panel-title">WCAG 色彩对比度与格式转换</h2>
          <strong class="numeric ratio-badge">{{ contrastRes.ok ? contrastRes.ratioText : '无效色值' }}</strong>
        </div>
        <div class="color-inputs">
          <label class="field">
            <span>文字前景色</span>
            <div class="color-row">
              <input v-model="fgHex" type="color" class="color-picker" aria-label="文字前景色选择器" />
              <input v-model="fgHex" class="input numeric" maxlength="7" />
            </div>
          </label>
          <label class="field">
            <span>背景底色</span>
            <div class="color-row">
              <input v-model="bgHex" type="color" class="color-picker" aria-label="背景底色选择器" />
              <input v-model="bgHex" class="input numeric" maxlength="7" />
            </div>
          </label>
        </div>
        <p v-if="!contrastRes.ok" class="field-error" role="alert">{{ contrastRes.error }}</p>
        <template v-else>
          <div class="contrast-preview" :style="{ color: fgHex, backgroundColor: bgHex }">
            <strong>设计系统可读性实时示例 · AaBbCc 123</strong>
            <span>对比度 {{ contrastRes.ratioText }} · 正文 {{ contrastRes.aaNormal ? '通过 AA' : '未达 AA' }} · 大字号 {{ contrastRes.aaLarge ? '通过 AA' : '未达标' }}</span>
          </div>
          <div class="wcag-grid">
            <div :class="contrastRes.aaNormal ? 'is-pass' : 'is-fail'">AA 正文 (≥4.5:1)：{{ contrastRes.aaNormal ? '通过' : '不通过' }}</div>
            <div :class="contrastRes.aaaNormal ? 'is-pass' : 'is-fail'">AAA 正文 (≥7.0:1)：{{ contrastRes.aaaNormal ? '通过' : '不通过' }}</div>
            <div :class="contrastRes.aaLarge ? 'is-pass' : 'is-fail'">AA 大字号 (≥3.0:1)：{{ contrastRes.aaLarge ? '通过' : '不通过' }}</div>
            <div class="hsl-line numeric">前景 {{ contrastRes.fgHsl }}</div>
          </div>
        </template>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'type-scale' }">
        <div class="panel-head">
          <h2 class="panel-title">字号阶梯比例尺生成器</h2>
          <button class="btn btn-soft btn-xs" type="button" @click="wb.copyText(`:root {\n${typeCssSnippet}\n}`)">复制 CSS 变量</button>
        </div>
        <div class="form-grid form-grid-2">
          <label class="field">
            <span>基准正文字号 (px)</span>
            <input v-model.number="typeBase" class="input numeric" type="number" min="10" max="32" />
          </label>
          <label class="field">
            <span>递增比例</span>
            <select v-model.number="typeRatio" class="input numeric">
              <option :value="1.125">1.125 · 大二度</option>
              <option :value="1.2">1.200 · 小三度</option>
              <option :value="1.25">1.250 · 大三度</option>
              <option :value="1.333">1.333 · 纯四度</option>
              <option :value="1.414">1.414 · 增四度</option>
              <option :value="1.618">1.618 · 黄金分割</option>
            </select>
          </label>
        </div>
        <div class="scale-list">
          <div v-for="row in typeRows" :key="row.token" class="scale-row">
            <code class="numeric">--{{ row.token }}</code>
            <span class="numeric">{{ row.px }}px / {{ row.rem }}rem</span>
            <strong :style="{ fontSize: `${Math.min(34, row.px)}px` }">{{ row.label }} 示例</strong>
          </div>
        </div>
      </section>
    </div>

    <!-- 3. 学术与学习 -->
    <div v-else-if="activeGroup === 'study'" class="tool-grid">
      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'gpa-calc' }">
        <div class="panel-head">
          <h2 class="panel-title">GPA 加权绩点计算器</h2>
          <div class="segmented">
            <button type="button" :class="{ 'is-active': gpaScale === 4 }" @click="gpaScale = 4">4.0 标准</button>
            <button type="button" :class="{ 'is-active': gpaScale === 5 }" @click="gpaScale = 5">5.0 制</button>
          </div>
        </div>
        <div class="gpa-summary">
          <div><small>加权 GPA</small><strong class="numeric">{{ gpaRes.gpa.toFixed(2) }}</strong></div>
          <div><small>有效总学分</small><strong class="numeric">{{ gpaRes.totalCredits }}</strong></div>
          <div><small>计入课程数</small><strong class="numeric">{{ gpaRes.count }} 门</strong></div>
        </div>
        <div class="course-list">
          <div v-for="(c, idx) in gpaCourses" :key="idx" class="course-row">
            <input v-model="c.name" class="input" placeholder="课程名称" />
            <input v-model.number="c.credit" class="input numeric" type="number" min="0.5" max="20" step="0.5" placeholder="学分" />
            <input v-model.number="c.score" class="input numeric" type="number" min="0" max="100" placeholder="百分制" />
            <button class="btn-icon btn-xs is-danger" type="button" :disabled="gpaCourses.length <= 1" @click="gpaCourses.splice(idx, 1)">
              <img :src="asset('assets/icons/trash.svg')" alt="删除" />
            </button>
          </div>
        </div>
        <button class="btn btn-soft btn-sm mt-10" type="button" @click="addCourseRow">
          <img :src="asset('assets/icons/plus.svg')" alt="" />添加课程
        </button>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'citation' }">
        <div class="panel-head">
          <h2 class="panel-title">参考文献引文生成器</h2>
          <div class="segmented">
            <button type="button" :class="{ 'is-active': citeStyle === 'gb' }" @click="citeStyle = 'gb'">GB/T 7714</button>
            <button type="button" :class="{ 'is-active': citeStyle === 'apa' }" @click="citeStyle = 'apa'">APA 7th</button>
          </div>
        </div>
        <div class="form-grid">
          <label class="field"><span>作者</span><input v-model="citeFields.author" class="input" /></label>
          <label class="field"><span>发表年份</span><input v-model="citeFields.year" class="input numeric" /></label>
          <label class="field"><span>文献题名</span><input v-model="citeFields.title" class="input" /></label>
          <label class="field"><span>期刊 / 出版社</span><input v-model="citeFields.source" class="input" /></label>
          <label class="field"><span>页码（可选）</span><input v-model="citeFields.pages" class="input numeric" placeholder="如 112-119" /></label>
        </div>
        <div class="cite-box">
          <p>{{ citeText }}</p>
          <button class="btn btn-primary btn-sm" type="button" @click="wb.copyText(citeText)">复制标准引文</button>
        </div>
      </section>
    </div>

    <!-- 4. 自由职业与经营 -->
    <div v-else-if="activeGroup === 'finance'" class="tool-grid">
      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'quote-calc' }">
        <div class="panel-head">
          <h2 class="panel-title">项目报价与时薪反推计算</h2>
          <button class="btn btn-soft btn-xs" type="button" @click="wb.copyText(`报价总计 ¥${quoteRes.total}（基准工时 ${quoteForm.hours}h × ¥${quoteForm.hourlyRate}，含缓冲 ${quoteForm.bufferPct}% 与税费 ${quoteForm.taxPct}%）`)">
            复制报价单
          </button>
        </div>
        <div class="form-grid form-grid-2">
          <label class="field"><span>期望时薪 (¥/h)</span><input v-model.number="quoteForm.hourlyRate" class="input numeric" type="number" min="0" /></label>
          <label class="field"><span>预估工时 (h)</span><input v-model.number="quoteForm.hours" class="input numeric" type="number" min="0" /></label>
          <label class="field"><span>需求沟通与修改缓冲 (%)</span><input v-model.number="quoteForm.bufferPct" class="input numeric" type="number" min="0" max="100" /></label>
          <label class="field"><span>开票税率 (%)</span><input v-model.number="quoteForm.taxPct" class="input numeric" type="number" min="0" max="50" /></label>
        </div>
        <dl class="kv-grid numeric">
          <div><dt>基准研发费</dt><dd>¥{{ quoteRes.base }}</dd></div>
          <div><dt>风险缓冲费</dt><dd>¥{{ quoteRes.bufferAmount }}</dd></div>
          <div><dt>税费预留</dt><dd>¥{{ quoteRes.taxAmount }}</dd></div>
          <div><dt>建议含税报价</dt><dd class="is-strong">¥{{ quoteRes.total }}</dd></div>
        </dl>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'phase-split' }">
        <div class="panel-head">
          <h2 class="panel-title">合同分期拆账（联动待办 / 账本）</h2>
        </div>
        <label class="field">
          <span>合同总金额 (¥)</span>
          <input v-model.number="contractTotal" class="input numeric" type="number" min="0" />
        </label>
        <div class="phase-list">
          <div v-for="(p, idx) in splitRes" :key="idx" class="phase-row">
            <input v-model="contractPhases[idx].name" class="input" />
            <input v-model.number="contractPhases[idx].pct" class="input numeric pct-input" type="number" min="0" max="100" />
            <strong class="numeric phase-amt">¥{{ p.amount.toLocaleString() }}</strong>
            <button class="btn btn-soft btn-xs" type="button" @click="pushPhaseTodo(p)">推待办</button>
            <button class="btn btn-primary btn-xs" type="button" @click="recordPhaseIncome(p)">记入账</button>
          </div>
        </div>
      </section>
    </div>

    <!-- 5. 通用效率 -->
    <div v-else class="tool-grid">
      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'date-diff' }">
        <div class="panel-head">
          <h2 class="panel-title">日期天数与工作日推算</h2>
        </div>
        <div class="form-grid form-grid-2">
          <label class="field"><span>开始日期</span><input v-model="startDate" class="input" type="date" /></label>
          <label class="field"><span>结束日期</span><input v-model="endDate" class="input" type="date" /></label>
        </div>
        <p v-if="!dateRes.ok" class="field-error" role="alert">{{ dateRes.error }}</p>
        <dl v-else class="kv-grid numeric">
          <div><dt>间隔自然日</dt><dd>{{ dateRes.absDays }} 天</dd></div>
          <div><dt>含工作日（周一至五）</dt><dd>{{ dateRes.workdays }} 天</dd></div>
          <div><dt>含周末天数</dt><dd>{{ dateRes.weekends }} 天</dd></div>
          <div><dt>折合周数</dt><dd>{{ dateRes.weeks }} 周</dd></div>
        </dl>
      </section>

      <section class="panel glass rim" :class="{ 'is-highlight': activeSubTool === 'unit-conv' }">
        <div class="panel-head">
          <h2 class="panel-title">汇率与常用单位换算</h2>
          <div class="segmented">
            <button type="button" :class="{ 'is-active': unitCategory === 'currency' }" @click="unitCategory = 'currency'">美元/人民币</button>
            <button type="button" :class="{ 'is-active': unitCategory === 'length' }" @click="unitCategory = 'length'">长度</button>
            <button type="button" :class="{ 'is-active': unitCategory === 'weight' }" @click="unitCategory = 'weight'">重量</button>
            <button type="button" :class="{ 'is-active': unitCategory === 'data' }" @click="unitCategory = 'data'">存储</button>
          </div>
        </div>
        <div class="form-grid form-grid-3">
          <label class="field"><span>数值</span><input v-model.number="unitValue" class="input numeric" type="number" step="any" /></label>
          <label class="field">
            <span>源单位</span>
            <select v-model="unitFrom" class="input">
              <option v-for="u in UNIT_OPTIONS[unitCategory]" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
          <label class="field">
            <span>目标单位</span>
            <select v-model="unitTo" class="input">
              <option v-for="u in UNIT_OPTIONS[unitCategory]" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
        </div>
        <label v-if="unitCategory === 'currency'" class="field fx-field">
          <span>参考汇率 (1 USD = ? CNY)</span>
          <input v-model.number="customFxRate" class="input numeric" type="number" step="0.01" min="0.01" />
        </label>
        <div class="conv-result numeric">
          <small>换算结果</small>
          <strong>{{ unitRes.ok ? `${unitRes.result} ${unitTo}` : unitRes.error }}</strong>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.group-tabs {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;
}
.group-tab {
  display: flex; flex-direction: column; gap: 3px; text-align: left;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-soft);
  transition: border-color var(--motion-fast), background-color var(--motion-fast);
}
.group-tab:hover { border-color: var(--line-strong); color: var(--ink); }
.group-tab.is-active {
  border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep);
}
.group-tab strong { font-size: var(--text-body); font-weight: 700; }
.group-tab small { font-size: 11px; color: var(--muted); line-height: 1.4; }

.tool-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--shell-gap);
}
.is-highlight { border-color: var(--brand); }
.tool-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.inline-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ink-soft); cursor: pointer; }
.two-pane { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.code-area { font-family: var(--font-numeric); font-size: 12px; line-height: 1.55; }
.tool-meta { margin: 8px 0 0; font-size: var(--text-meta); color: var(--muted); }

.regex-bar { display: flex; gap: 8px; margin-bottom: 8px; }
.code-inline { font-family: var(--font-numeric); flex: 1; }
.flags-input { flex: 0 0 72px; text-align: center; }
.match-list {
  list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px;
}
.match-list li {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; border-radius: 8px; background: var(--surface-soft); border: 1px solid var(--line);
  font-size: 12px;
}
.match-list code { color: var(--brand-deep); font-weight: 700; }

.kv-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
  margin: 12px 0 0;
}
.kv-grid > div {
  padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-soft);
}
.kv-grid dt { font-size: 11px; color: var(--muted); }
.kv-grid dd { margin: 3px 0 0; font-size: var(--text-body); font-weight: 700; color: var(--ink); word-break: break-all; }
.kv-grid dd.is-strong { color: var(--brand-deep); font-size: 18px; }

.uuid-box { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.uuid-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: var(--text-meta); color: var(--muted); }
.uuid-list { display: grid; gap: 6px; }
.uuid-chip {
  text-align: left; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface-soft);
  font-size: 12px; color: var(--ink-soft);
}
.uuid-chip:hover { border-color: var(--brand); color: var(--brand-deep); }

.codec-output {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  margin-top: 10px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface-soft);
}
.codec-output code { flex: 1; font-size: 12px; word-break: break-all; }

.color-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.color-row { display: flex; gap: 8px; align-items: center; }
.color-picker { width: 42px; height: 38px; padding: 2px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; }
.ratio-badge { font-size: 18px; color: var(--brand-deep); }
.contrast-preview {
  margin-top: 12px; padding: 16px; border-radius: 12px; border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 4px;
}
.contrast-preview span { font-size: 12px; opacity: .88; }
.wcag-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px;
}
.wcag-grid > div {
  padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); font-size: 12px; font-weight: 600;
}
.wcag-grid .is-pass { background: var(--brand-pale); color: var(--brand-deep); border-color: transparent; }
.wcag-grid .is-fail { background: var(--coral-pale); color: var(--coral); border-color: transparent; }

.scale-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.scale-row {
  display: grid; grid-template-columns: 110px 120px minmax(0, 1fr); align-items: center; gap: 10px;
  padding: 7px 10px; border-radius: 8px; background: var(--surface-soft); border: 1px solid var(--line);
}
.scale-row code { font-size: 12px; color: var(--brand-deep); }
.scale-row span { font-size: 12px; color: var(--muted); }
.scale-row strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.gpa-summary {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
  padding: 12px; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line); margin-bottom: 12px;
}
.gpa-summary small { display: block; font-size: 11px; color: var(--muted); }
.gpa-summary strong { font-size: 20px; font-weight: 800; color: var(--ink); }
.course-list { display: flex; flex-direction: column; gap: 7px; }
.course-row { display: grid; grid-template-columns: 1.5fr .7fr .7fr auto; gap: 6px; align-items: center; }

.cite-box {
  margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
}
.cite-box p { margin: 0; font-size: var(--text-body); line-height: 1.6; }

.phase-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.phase-row { display: grid; grid-template-columns: 1.3fr 68px 100px auto auto; gap: 6px; align-items: center; }
.pct-input { text-align: center; }
.phase-amt { text-align: right; font-size: var(--text-sm); color: var(--brand-deep); }

.conv-result {
  margin-top: 14px; padding: 14px; border-radius: 10px; background: var(--brand-pale);
  display: flex; align-items: baseline; justify-content: space-between;
}
.conv-result small { font-size: var(--text-meta); color: var(--brand-deep); }
.conv-result strong { font-size: 22px; font-weight: 800; color: var(--brand-deep); }

.form-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mt-10 { margin-top: 10px; }
.fx-field { margin-top: 10px; max-width: 240px; }

@media (max-width: 980px) {
  .group-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tool-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .group-tabs, .two-pane, .color-inputs, .form-grid-2, .form-grid-3 { grid-template-columns: 1fr; }
  .phase-row { grid-template-columns: 1fr 72px 1fr; }
}
</style>
