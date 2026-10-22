<script setup>
import { computed, reactive, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { CATEGORIES, categoryIcon } from '../../js/command.js';

const wb = useWorkbench();

const type = ref('expense');
const filter = ref('month');
const form = reactive({ amount: '', note: '', cat: CATEGORIES[0] });

const filtered = computed(() => {
  const nowMonth = wb.todayStr.value.slice(0, 7);
  return wb.state.ledger
    .filter(r => {
      if (filter.value === 'month') return r.date.startsWith(nowMonth);
      if (filter.value === 'income') return r.type === 'income';
      if (filter.value === 'expense') return r.type === 'expense';
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
});

const summary = computed(() => {
  const income = filtered.value.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expense = filtered.value.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  return { income, expense, balance: income - expense };
});

const chart = computed(() => {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const total = wb.state.ledger
      .filter(r => r.type === 'expense' && r.date === key)
      .reduce((s, r) => s + r.amount, 0);
    return { key, label: i === 6 ? '今天' : d.toLocaleDateString('zh-CN', { weekday: 'narrow' }), total };
  });
  const max = Math.max(...days.map(d => d.total), 1);
  return { days, max, empty: days.every(d => d.total === 0) };
});

const currency = new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2
});
function money(n) { return currency.format(Number(n) || 0); }

function submit() {
  if (wb.addLedgerRecord({ type: type.value, amount: form.amount, note: form.note, cat: form.cat })) {
    form.amount = '';
    form.note = '';
  }
}
function catName(c) { return (c || '').slice(2).trim() || '未分类'; }

/* ---------------- 固定账目模板 ---------------- */
const templateDate = ref(wb.todayStr.value);
const showTemplateForm = ref(false);
const editingTemplateId = ref(null);
const templateForm = reactive({
  name: '', amount: '', type: 'expense', cat: CATEGORIES[0],
  note: '', frequency: 'manual', dayOfMonth: 1
});
const frequencies = [
  { id: 'manual', label: '手动模板' },
  { id: 'daily', label: '每天自动' },
  { id: 'weekday', label: '工作日自动' },
  { id: 'monthly', label: '每月自动' }
];
function frequencyLabel(t) {
  if (t.frequency === 'daily') return '每天自动';
  if (t.frequency === 'weekday') return '工作日自动';
  if (t.frequency === 'monthly') return `每月 ${t.dayOfMonth} 日自动`;
  return '手动';
}
function resetTemplateForm() {
  editingTemplateId.value = null;
  Object.assign(templateForm, { name: '', amount: '', type: 'expense', cat: CATEGORIES[0], note: '', frequency: 'manual', dayOfMonth: 1 });
  showTemplateForm.value = false;
}
function editTemplate(t) {
  editingTemplateId.value = t.id;
  Object.assign(templateForm, {
    name: t.name, amount: String(t.amount), type: t.type, cat: t.cat,
    note: t.note, frequency: t.frequency, dayOfMonth: t.dayOfMonth
  });
  showTemplateForm.value = true;
}
function saveTemplate() {
  const ok = editingTemplateId.value
    ? wb.updateLedgerTemplate(editingTemplateId.value, { ...templateForm })
    : wb.addLedgerTemplate({ ...templateForm });
  if (ok) resetTemplateForm();
}
function useTemplate(template) {
  if (wb.applyLedgerTemplate(template, templateDate.value)) {
    wb.showToast(`已记入 ${templateDate.value}`);
  }
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>账本</h1>
        <p class="sub">记录办公支出与收入，查看分类和收支变化。</p>
      </div>
      <button class="btn btn-primary" type="button" @click="wb.openLedgerDialog()">
        <img :src="asset('assets/icons/plus.svg')" alt="" />记一笔
      </button>
    </header>

    <div class="ledger-top">
      <!-- 概览 -->
      <section class="panel glass rim overview">
        <div class="overview-nums">
          <div>
            <small>所选范围支出</small>
            <strong class="numeric">{{ money(summary.expense) }}</strong>
            <span>收入 <b class="numeric">{{ money(summary.income) }}</b></span>
          </div>
        </div>
        <div class="overview-chart" role="img" aria-label="最近七天支出">
          <small class="chart-caption">最近 7 天</small>
          <div v-if="chart.empty" class="chart-empty">最近七天还没有支出记录</div>
          <div v-else class="bars">
            <div v-for="(d, i) in chart.days" :key="d.key" class="bar-col" :class="{ 'is-today': i === 6 }" :title="`${d.label} · ${money(d.total)}`">
              <i :style="{ height: d.total > 0 ? `${Math.max(5, (d.total / chart.max) * 42)}px` : '0' }"></i>
              <span>{{ d.label }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 记一笔表单 -->
      <section class="panel glass rim entry-panel">
        <div class="segmented">
          <button type="button" :class="{ 'is-active': type === 'expense' }" @click="type = 'expense'">支出</button>
          <button type="button" :class="{ 'is-active': type === 'income' }" @click="type = 'income'">收入</button>
        </div>
        <form class="entry-form" @submit.prevent="submit">
          <label class="field amount-field">
            <span>金额</span>
            <span class="amount-wrap"><b>¥</b><input v-model="form.amount" type="number" step="0.01" min="0.01" max="1000000000" inputmode="decimal" required placeholder="0.00" /></span>
          </label>
          <label class="field">
            <span>备注</span>
            <input v-model="form.note" class="input" maxlength="300" placeholder="办公用品、通勤、软件订阅…" />
          </label>
          <button class="btn btn-primary" type="submit">保存记录</button>
        </form>
        <div class="cat-grid">
          <button
            v-for="c in CATEGORIES"
            :key="c"
            type="button"
            class="cat-chip"
            :class="{ 'is-active': form.cat === c }"
            @click="form.cat = c"
          >
            <img :src="asset(`assets/icons/${categoryIcon(c)}.svg`)" alt="" />
            <span>{{ c.slice(2).trim() }}</span>
          </button>
        </div>
      </section>
    </div>

    <section class="panel glass rim templates-panel">
      <div class="panel-head">
        <h2 class="panel-title">固定模板</h2>
        <span class="panel-sub">点一下记入所选日期；每日 / 工作日 / 每月自动记账</span>
      </div>
      <div class="template-tools">
        <label class="field template-date">
          <span>记账日期</span>
          <input v-model="templateDate" class="input" type="date" />
        </label>
        <button class="btn btn-soft btn-sm" type="button" @click="showTemplateForm = !showTemplateForm">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新建模板
        </button>
      </div>

      <div v-if="wb.state.settings.ledgerTemplates.length" class="template-grid">
        <article v-for="t in wb.state.settings.ledgerTemplates" :key="t.id" class="template-card">
          <div class="template-head">
            <span class="template-icon"><img :src="asset(`assets/icons/${categoryIcon(t.cat)}.svg`)" alt="" /></span>
            <div class="template-copy">
              <strong>{{ t.name }}</strong>
              <small>{{ t.type === 'income' ? '收入' : '支出' }} · {{ money(t.amount) }} · {{ frequencyLabel(t) }}<template v-if="t.lastPosted"> · 上次 {{ t.lastPosted }}</template></small>
            </div>
          </div>
          <div class="template-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="useTemplate(t)">记入</button>
            <button v-if="t.frequency !== 'manual'" class="btn btn-text btn-sm" type="button" @click="wb.toggleLedgerTemplate(t.id)">
              {{ t.enabled ? '暂停' : '启用' }}
            </button>
            <button class="btn-icon" type="button" aria-label="编辑模板" @click="editTemplate(t)">
              <img :src="asset('assets/icons/pencil.svg')" alt="" />
            </button>
            <button class="btn-icon is-danger" type="button" aria-label="删除模板" @click="wb.deleteLedgerTemplate(t.id)">
              <img :src="asset('assets/icons/trash.svg')" alt="" />
            </button>
          </div>
        </article>
      </div>
      <p v-else class="template-empty">例如：工作日午餐 ¥25、每天通勤 ¥6。保存后可以一键记入，也可以自动记账。</p>
      <p class="template-note">自动记账只在打开应用或跨天时补记当天，不会在关闭页面后后台运行；删除自动记录后当天不会重新补记。每月 31 日按当月最后一天执行。</p>

      <form v-if="showTemplateForm" class="template-form" @submit.prevent="saveTemplate">
        <label class="field"><span>名称</span><input v-model="templateForm.name" class="input" maxlength="80" placeholder="午餐 / 通勤" required /></label>
        <label class="field"><span>金额</span><input v-model="templateForm.amount" class="input" type="number" min="0.01" step="0.01" placeholder="25" required /></label>
        <label class="field"><span>类型</span><select v-model="templateForm.type" class="input"><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label class="field"><span>分类</span><select v-model="templateForm.cat" class="input"><option v-for="c in CATEGORIES" :key="c" :value="c">{{ c.slice(2).trim() }}</option></select></label>
        <label class="field"><span>频率</span><select v-model="templateForm.frequency" class="input"><option v-for="f in frequencies" :key="f.id" :value="f.id">{{ f.label }}</option></select></label>
        <label v-if="templateForm.frequency === 'monthly'" class="field"><span>每月几号</span><input v-model.number="templateForm.dayOfMonth" class="input" type="number" min="1" max="31" /></label>
        <label class="field"><span>备注</span><input v-model="templateForm.note" class="input" maxlength="300" placeholder="默认用名称" /></label>
        <button class="btn btn-primary" type="submit">{{ editingTemplateId ? '更新模板' : '保存模板' }}</button>
        <button v-if="editingTemplateId" class="btn btn-ghost" type="button" @click="resetTemplateForm">取消</button>
      </form>
    </section>

    <div class="list-head">
      <h2>记录</h2>
      <div class="segmented">
        <button type="button" :class="{ 'is-active': filter === 'month' }" @click="filter = 'month'">本月</button>
        <button type="button" :class="{ 'is-active': filter === 'expense' }" @click="filter = 'expense'">支出</button>
        <button type="button" :class="{ 'is-active': filter === 'income' }" @click="filter = 'income'">收入</button>
        <button type="button" :class="{ 'is-active': filter === 'all' }" @click="filter = 'all'">全部</button>
      </div>
    </div>

    <section class="panel glass rim ledger-list-panel">
      <div v-if="!filtered.length" class="empty list-empty">
        <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/wallet-cards.svg')" alt="" /></span>
        <strong>所选范围暂无账目</strong>
        <p>记下办公支出与收入后，这里会按时间列出。</p>
        <button class="btn btn-soft btn-sm" type="button" @click="wb.openLedgerDialog()">记一笔</button>
      </div>
      <ul v-else class="ledger-list">
        <li v-for="r in filtered" :key="r.id">
          <span class="ledger-cat"><img :src="asset(`assets/icons/${categoryIcon(r.cat)}.svg`)" alt="" /></span>
          <div class="ledger-copy">
            <strong>{{ r.note }}</strong>
            <small>{{ r.date }} · {{ catName(r.cat) }}</small>
          </div>
          <span class="ledger-amount numeric" :class="r.type">{{ r.type === 'income' ? '+' : '-' }}{{ money(r.amount) }}</span>
          <button class="btn-icon is-danger" type="button" aria-label="删除账目" @click="wb.deleteLedgerRecord(r.id)">
            <img :src="asset('assets/icons/trash.svg')" alt="" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* The overview card holds one number and a small chart; on a wide page a 1fr column left it
   half empty next to the taller entry form. Let the chart take the remaining space. */
.ledger-top {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr);
  gap: var(--shell-gap);
  align-items: start;
}
.overview { display: flex; align-items: center; justify-content: space-between; gap: 28px; flex-wrap: wrap; }
.overview-nums { flex: 0 0 auto; }
.overview-chart { flex: 1 1 320px; min-width: 240px; }
.chart-caption { display: block; margin-bottom: 4px; font-size: var(--text-2xs); color: var(--muted); }
/* Bars should fill the card's remaining width instead of sitting in a small cluster. */
.bars { display: flex; align-items: flex-end; gap: 8px; width: 100%; min-height: 62px; }
.overview-nums small { font-size: var(--text-meta); color: var(--muted); }
.overview-nums strong { display: block; margin: 6px 0 4px; font-size: 32px; font-weight: 800; letter-spacing: -.03em; }
.overview-nums span { font-size: var(--text-sm); color: var(--muted); }
.overview-nums b { color: var(--ink-soft); font-weight: 650; }
.overview-chart { flex: 1 1 240px; min-width: 200px; }
.chart-empty { display: grid; place-items: center; min-height: 70px; font-size: var(--text-meta); color: var(--muted); border: 1px dashed var(--line); border-radius: 10px; }
.bars { display: flex; align-items: flex-end; gap: 10px; height: 74px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 5px; height: 100%; }
.bar-col i { display: block; width: 100%; max-width: 22px; border-radius: 5px 5px 2px 2px; background: color-mix(in srgb, var(--brand) 55%, transparent); }
.bar-col.is-today i { background: var(--brand); }
.bar-col span { font-size: var(--text-meta); color: var(--muted); }

.entry-panel { display: flex; flex-direction: column; gap: 14px; }
.entry-form { display: grid; grid-template-columns: minmax(110px, .8fr) minmax(0, 1.2fr); gap: 10px; align-items: end; }
.entry-form > .btn { grid-column: 1 / -1; }
.amount-wrap { display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--surface); }
.amount-wrap:focus-within { border-color: var(--brand); box-shadow: var(--ring); }
.amount-wrap b { color: var(--muted); font-weight: 600; }
.amount-wrap input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cat-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 32px; padding: 0 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft); font-size: var(--text-meta);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.cat-chip img { width: 13px; height: 13px; opacity: .7; }
.cat-chip.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 600; }
.cat-chip.is-active img { opacity: 1; }

.list-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
.list-head h2 { font-size: var(--text-md); font-weight: 700; }
.ledger-list-panel { padding: 0; }
.list-empty { max-width: none; margin: 0; padding: 40px 24px; border-top: 1px solid var(--line); }
.ledger-list { list-style: none; margin: 0; padding: 4px 20px; }
.ledger-list li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.ledger-list li:last-child { border-bottom: 0; }
.ledger-cat { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line); }
.ledger-cat img { width: 16px; height: 16px; opacity: .7; }
.ledger-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ledger-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; }
.ledger-copy small { font-size: var(--text-meta); color: var(--muted); }
.ledger-amount { font-size: 14.5px; font-weight: 700; white-space: nowrap; }
.ledger-amount.income { color: var(--brand-deep); }
.ledger-amount.expense { color: var(--ink); }

.template-tools { display: flex; align-items: flex-end; justify-content: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.template-date { min-width: 170px; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px; }
.template-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); }
.template-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.template-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border-radius: 9px; background: var(--surface); border: 1px solid var(--line); }
.template-icon img { width: 15px; height: 15px; opacity: .7; }
.template-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.template-copy strong { font-size: var(--text-body); font-weight: 650; }
.template-copy small { font-size: var(--text-meta); color: var(--muted); }
.template-actions { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.template-empty { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.template-note { margin: 10px 0 0; font-size: var(--text-meta); line-height: 1.6; color: var(--muted); }
.template-form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; gap: 8px; align-items: end; margin-top: 14px; padding: 14px; border: 1px dashed var(--line-strong); border-radius: 14px; }
.template-form .btn { align-self: end; }

@media (max-width: 1080px) {
  .ledger-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .entry-form { grid-template-columns: minmax(0, 1fr); }
  .template-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ledger-list { padding: 4px 14px; }
}
</style>
