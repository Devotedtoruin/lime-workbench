<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { CATEGORIES, categoryIcon } from '../../js/command.js';
import LedgerCharts from '../components/LedgerCharts.vue';
import VirtualList from '../components/VirtualList.vue';

const wb = useWorkbench();

const type = ref('expense');
const filter = ref('month');
const catFilter = ref('all');
const searchQuery = ref('');
const form = reactive({ amount: '', note: '', cat: CATEGORIES[0], date: wb.todayStr.value });

const customCatInput = ref('');
const showCustomCatForm = ref(false);
const categories = computed(() => wb.allLedgerCategories?.value || CATEGORIES);

onMounted(() => {
  const prefill = wb.consumePrefill('ledger');
  if (prefill) {
    type.value = prefill.type === 'income' ? 'income' : 'expense';
    if (prefill.amount) form.amount = String(prefill.amount);
    if (prefill.note) form.note = prefill.note;
    if (prefill.cat) form.cat = prefill.cat;
  }
});

function isCustomCategory(c) {
  return !CATEGORIES.includes(c);
}

function addCustomCat() {
  const name = customCatInput.value.trim();
  if (!name) return;
  if (wb.addLedgerCategory(name)) {
    customCatInput.value = '';
    showCustomCatForm.value = false;
    form.cat = `🏷 ${name}`;
  }
}

function removeCustomCat(c) {
  const clean = String(c).replace(/^🏷\s*/, '').trim();
  wb.removeLedgerCategory(clean);
  if (form.cat === c) form.cat = CATEGORIES[0];
  if (catFilter.value === c) catFilter.value = 'all';
}

const filtered = computed(() => {
  const nowMonth = wb.todayStr.value.slice(0, 7);
  const q = searchQuery.value.trim().toLowerCase();
  return wb.state.ledger
    .filter(r => {
      if (filter.value === 'month' && !r.date.startsWith(nowMonth)) return false;
      if (filter.value === 'income' && r.type !== 'income') return false;
      if (filter.value === 'expense' && r.type !== 'expense') return false;
      if (catFilter.value !== 'all' && r.cat !== catFilter.value) return false;
      if (q) {
        const hay = `${r.note || ''} ${r.cat || ''} ${r.date || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
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
  const now = new Date(wb.nowDate.value);
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
  if (wb.addLedgerRecord({ type: type.value, amount: form.amount, note: form.note, cat: form.cat, date: form.date || wb.todayStr.value })) {
    form.amount = '';
    form.note = '';
  }
}
function catName(c) {
  const s = String(c || '');
  return (/^[^\w\u4e00-\u9fa5]/.test(s) ? s.replace(/^[^\s]+\s*/, '').trim() : s.trim()) || '未分类';
}

/* ---------------- 固定账目与每月订阅模板 ---------------- */
const templateDate = ref(wb.todayStr.value);
const showTemplateForm = ref(false);
const editingTemplateId = ref(null);
const templateForm = reactive({
  name: '', amount: '', type: 'expense', cat: CATEGORIES[0],
  note: '', frequency: 'monthly', dayOfMonth: 1, reminderDays: 3
});
const frequencies = [
  { id: 'monthly', label: '每月固定（月初生成待确认账单）' },
  { id: 'manual', label: '手动模板' },
  { id: 'daily', label: '每天自动' },
  { id: 'weekday', label: '工作日自动' }
];
function frequencyLabel(t) {
  if (t.frequency === 'daily') return '每天自动';
  if (t.frequency === 'weekday') return '工作日自动';
  if (t.frequency === 'monthly') return `每月 ${t.dayOfMonth} 日 · 待确认入账`;
  return '手动';
}
function resetTemplateForm() {
  editingTemplateId.value = null;
  Object.assign(templateForm, { name: '', amount: '', type: 'expense', cat: CATEGORIES[0], note: '', frequency: 'monthly', dayOfMonth: 1, reminderDays: 3 });
  showTemplateForm.value = false;
}
function fillSubscriptionPreset(preset) {
  editingTemplateId.value = null;
  Object.assign(templateForm, {
    name: preset.name,
    amount: String(preset.amount),
    type: preset.type || 'expense',
    cat: preset.cat || CATEGORIES[0],
    note: preset.note || preset.name,
    frequency: 'monthly',
    dayOfMonth: preset.dayOfMonth || 1,
    reminderDays: preset.reminderDays ?? 3
  });
  showTemplateForm.value = true;
}
function editTemplate(t) {
  editingTemplateId.value = t.id;
  Object.assign(templateForm, {
    name: t.name, amount: String(t.amount), type: t.type, cat: t.cat,
    note: t.note, frequency: t.frequency, dayOfMonth: t.dayOfMonth, reminderDays: t.reminderDays ?? 3
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
  if (template.frequency === 'monthly') {
    wb.confirmMonthlyBill(template.id, templateDate.value);
    return;
  }
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
        <p class="sub">记录办公支出、日常收支与每月固定订阅，支持自定义分类、二次编辑与图表分析。</p>
      </div>
      <button class="btn btn-primary" type="button" @click="wb.openLedgerDialog()">
        <img :src="asset('assets/icons/plus.svg')" alt="" />记一笔
      </button>
    </header>

    <!-- 月度收支趋势折线图 & 消费类别环形图 & 月度预算警戒线 -->
    <section class="panel glass rim charts-panel">
      <div class="panel-head">
        <h2 class="panel-title">
          <img :src="asset('assets/icons/activity.svg')" alt="" />月度财务可视化分析
        </h2>
        <span class="panel-sub">收支趋势折线图 · 消费分类占比环形图 · 预算水位监控</span>
      </div>
      <LedgerCharts />
    </section>

    <div class="ledger-top">
      <!-- 概览 -->
      <section class="panel glass rim overview">
        <div class="overview-nums">
          <div>
            <small>所选范围支出</small>
            <strong class="numeric">{{ money(summary.expense) }}</strong>
            <span>收入 <b class="numeric">{{ money(summary.income) }}</b> · 结余 <b class="numeric">{{ money(summary.balance) }}</b></span>
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
          <span
            v-for="c in categories"
            :key="c"
            class="cat-chip-wrap"
          >
            <button
              type="button"
              class="cat-chip"
              :class="{ 'is-active': form.cat === c, 'is-custom': isCustomCategory(c) }"
              @click="form.cat = c"
            >
              <img :src="asset(`assets/icons/${categoryIcon(c)}.svg`)" alt="" />
              <span>{{ catName(c) }}</span>
            </button>
            <button
              v-if="isCustomCategory(c)"
              type="button"
              class="cat-del"
              title="删除自定义分类"
              :aria-label="`删除分类 ${catName(c)}`"
              @click.stop="removeCustomCat(c)"
            >
              ×
            </button>
          </span>
          <button
            type="button"
            class="cat-chip cat-add-btn"
            @click="showCustomCatForm = !showCustomCatForm"
          >
            <img :src="asset('assets/icons/plus.svg')" alt="" />
            <span>自定义分类</span>
          </button>
        </div>
        <form v-if="showCustomCatForm" class="custom-cat-form" @submit.prevent="addCustomCat">
          <input
            v-model="customCatInput"
            class="input"
            maxlength="24"
            placeholder="输入分类名称，如：宠物、咖啡、数码"
            required
          />
          <button class="btn btn-soft btn-sm" type="submit">添加</button>
        </form>
      </section>
    </div>

    <section class="panel glass rim templates-panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">固定支出与订阅管理</h2>
          <p class="panel-sub">支持房租、云服务、软件会员等每月固定账目，月初自动生成待确认账单卡片，点击确认后正式入账</p>
        </div>
      </div>

      <!-- 本月待确认固定账单卡片区 -->
      <div v-if="wb.pendingMonthlyBills?.value?.length" class="pending-bills-box" role="region" aria-label="本月待确认固定账单">
        <div class="pending-bills-head">
          <div class="pending-bills-title">
            <span class="pending-dot" aria-hidden="true"></span>
            <strong>本月待确认固定账单（{{ wb.pendingMonthlyBills.value.length }} 笔）</strong>
            <small>确认后将按所选记账日期正式计入当月账本流水</small>
          </div>
          <button
            v-if="wb.pendingMonthlyBills.value.length > 1"
            class="btn btn-primary btn-xs"
            type="button"
            @click="wb.confirmAllMonthlyBills()"
          >
            全部确认入账
          </button>
        </div>
        <TransitionGroup name="list-anim" tag="div" class="pending-bills-grid">
          <article v-for="bill in wb.pendingMonthlyBills.value" :key="bill.id" class="pending-bill-card">
            <div class="pending-bill-info">
              <span class="template-icon"><img :src="asset(`assets/icons/${categoryIcon(bill.cat)}.svg`)" alt="" /></span>
              <div>
                <strong>{{ bill.name }}</strong>
                <small class="numeric">{{ bill.statusLabel }} · {{ catName(bill.cat) }}</small>
              </div>
            </div>
            <div class="pending-bill-right">
              <strong class="pending-bill-amt numeric">{{ bill.type === 'income' ? '+' : '-' }}{{ money(bill.amount) }}</strong>
              <button class="btn btn-primary btn-xs" type="button" @click="wb.confirmMonthlyBill(bill.id, templateDate)">
                确认入账
              </button>
              <button class="btn btn-ghost btn-xs" type="button" @click="wb.skipMonthlyBill(bill.id)">
                跳过本月
              </button>
            </div>
          </article>
        </TransitionGroup>
      </div>

      <div class="template-tools">
        <label class="field template-date">
          <span>记账日期</span>
          <input v-model="templateDate" class="input numeric" type="date" />
        </label>
        <div class="preset-sub-chips">
          <span class="preset-sub-label">快速添加订阅模板：</span>
          <button
            v-for="p in wb.SUBSCRIPTION_PRESETS"
            :key="p.name"
            type="button"
            class="preset-sub-btn"
            @click="fillSubscriptionPreset(p)"
          >
            + {{ p.name }}
          </button>
        </div>
        <button class="btn btn-soft btn-sm" type="button" @click="showTemplateForm = !showTemplateForm">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新建模板
        </button>
      </div>

      <div v-if="wb.upcomingRenewals.value.length" class="renewal-strip">
        <p class="renewal-title">订阅与续费排期</p>
        <div v-for="r in wb.upcomingRenewals.value" :key="r.id" class="renewal-row" :class="{ 'is-soon': r.dueSoon }">
          <span class="renewal-when numeric">{{ r.days === 0 ? '今天' : `${r.days} 天后` }}</span>
          <div class="renewal-copy">
            <strong>{{ r.name }}</strong>
            <small class="numeric">{{ r.nextDate }} · {{ money(r.amount) }} · 提前 {{ r.reminderDays }} 天提醒</small>
          </div>
          <button class="btn btn-soft btn-sm" type="button" @click="useTemplate(r)">确认记入</button>
        </div>
      </div>

      <TransitionGroup v-if="wb.state.settings.ledgerTemplates.length" name="list-anim" tag="div" class="template-grid">
        <article v-for="t in wb.state.settings.ledgerTemplates" :key="t.id" class="template-card">
          <div class="template-head">
            <span class="template-icon"><img :src="asset(`assets/icons/${categoryIcon(t.cat)}.svg`)" alt="" /></span>
            <div class="template-copy">
              <strong>{{ t.name }}</strong>
              <small class="numeric">{{ t.type === 'income' ? '收入' : '支出' }} · {{ money(t.amount) }} · {{ frequencyLabel(t) }}<template v-if="t.frequency === 'monthly'"> · 提前 {{ t.reminderDays }} 天提醒</template><template v-if="t.lastPosted"> · 上次 {{ t.lastPosted }}</template></small>
            </div>
          </div>
          <div class="template-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="useTemplate(t)">
              {{ t.frequency === 'monthly' ? '确认入账' : '记入' }}
            </button>
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
      </TransitionGroup>
      <p v-else class="template-empty">例如：每月房租 ¥2800、云服务订阅 ¥68、工作日午餐 ¥25。点击上方快捷标签可一键创建。</p>
      <p class="template-note">每月固定支出在月初自动生成「待确认账单卡片」，点击确认后正式记入账本；每日/工作日模板在打开工作台时自动补记当日流水。</p>

      <form v-if="showTemplateForm" class="template-form" @submit.prevent="saveTemplate">
        <label class="field"><span>名称</span><input v-model="templateForm.name" class="input" maxlength="80" placeholder="房租 / 云服务 / 午餐" required /></label>
        <label class="field"><span>金额</span><input v-model="templateForm.amount" class="input numeric" type="number" min="0.01" step="0.01" placeholder="2800" required /></label>
        <label class="field"><span>类型</span><select v-model="templateForm.type" class="input"><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label class="field"><span>分类</span><select v-model="templateForm.cat" class="input"><option v-for="c in categories" :key="c" :value="c">{{ catName(c) }}</option></select></label>
        <label class="field"><span>频率</span><select v-model="templateForm.frequency" class="input"><option v-for="f in frequencies" :key="f.id" :value="f.id">{{ f.label }}</option></select></label>
        <label v-if="templateForm.frequency === 'monthly'" class="field"><span>每月几号</span><input v-model.number="templateForm.dayOfMonth" class="input numeric" type="number" min="1" max="31" /></label>
        <label v-if="templateForm.frequency === 'monthly'" class="field"><span>提前几天提醒</span><input v-model.number="templateForm.reminderDays" class="input numeric" type="number" min="0" max="30" /></label>
        <label class="field"><span>备注</span><input v-model="templateForm.note" class="input" maxlength="300" placeholder="默认用名称" /></label>
        <button class="btn btn-primary" type="submit">{{ editingTemplateId ? '更新模板' : '保存模板' }}</button>
        <button v-if="editingTemplateId" class="btn btn-ghost" type="button" @click="resetTemplateForm">取消</button>
      </form>
    </section>

    <div class="list-head">
      <h2>流水记录 <span v-if="filtered.length" class="badge numeric">{{ filtered.length }}</span></h2>
      <div class="list-filters">
        <input
          v-model="searchQuery"
          class="input ledger-search"
          type="search"
          placeholder="搜索备注或分类…"
          aria-label="搜索账目"
        />
        <select v-model="catFilter" class="input ledger-cat-select" aria-label="按分类筛选">
          <option value="all">全部分类</option>
          <option v-for="c in categories" :key="c" :value="c">{{ catName(c) }}</option>
        </select>
        <div class="segmented">
          <button type="button" :class="{ 'is-active': filter === 'month' }" @click="filter = 'month'">本月</button>
          <button type="button" :class="{ 'is-active': filter === 'expense' }" @click="filter = 'expense'">支出</button>
          <button type="button" :class="{ 'is-active': filter === 'income' }" @click="filter = 'income'">收入</button>
          <button type="button" :class="{ 'is-active': filter === 'all' }" @click="filter = 'all'">全部</button>
        </div>
      </div>
    </div>

    <section class="panel glass rim ledger-list-panel">
      <div v-if="!filtered.length" class="empty list-empty">
        <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/wallet-cards.svg')" alt="" /></span>
        <strong>所选范围暂无账目</strong>
        <p>记下办公支出与收入后，这里会按时间列出。</p>
        <button class="btn btn-soft btn-sm" type="button" @click="wb.openLedgerDialog()">记一笔</button>
      </div>
      <VirtualList
        v-else
        :items="filtered"
        :item-height="60"
        :threshold="80"
        :max-height="600"
        tag="ul"
        list-class="ledger-list"
      >
        <template #default="{ item: r, index }">
          <li :data-vlist-index="index">
            <span class="ledger-cat"><img :src="asset(`assets/icons/${categoryIcon(r.cat)}.svg`)" alt="" /></span>
            <div class="ledger-copy">
              <strong>{{ r.note }}</strong>
              <small class="numeric">{{ r.date }} · {{ catName(r.cat) }}</small>
            </div>
            <span class="ledger-amount numeric" :class="r.type">{{ r.type === 'income' ? '+' : '-' }}{{ money(r.amount) }}</span>
            <div class="ledger-row-actions">
              <button class="btn-icon" type="button" title="编辑账目" aria-label="编辑账目" @click="wb.openLedgerDialog(r)">
                <img :src="asset('assets/icons/pencil.svg')" alt="" />
              </button>
              <button class="btn-icon is-danger" type="button" title="删除账目" aria-label="删除账目" @click="wb.deleteLedgerRecord(r.id)">
                <img :src="asset('assets/icons/trash.svg')" alt="" />
              </button>
            </div>
          </li>
        </template>
      </VirtualList>
    </section>
  </div>
</template>

<style scoped>
.ledger-top {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr);
  gap: var(--shell-gap);
  align-items: start;
}
.overview { display: flex; align-items: center; justify-content: space-between; gap: 28px; flex-wrap: wrap; }
.overview-nums { flex: 0 0 auto; }
.overview-chart { flex: 1 1 240px; min-width: 200px; }
.chart-caption { display: block; margin-bottom: 4px; font-size: var(--text-2xs); color: var(--muted); }
.overview-nums small { font-size: var(--text-meta); color: var(--muted); }
.overview-nums strong { display: block; margin: 6px 0 4px; font-size: 32px; font-weight: 800; letter-spacing: -.03em; }
.overview-nums span { font-size: var(--text-sm); color: var(--muted); }
.overview-nums b { color: var(--ink-soft); font-weight: 650; }
.chart-empty { display: grid; place-items: center; min-height: 70px; font-size: var(--text-meta); color: var(--muted); border: 1px dashed var(--line); border-radius: 10px; }
.bars { display: flex; align-items: flex-end; gap: 10px; height: 74px; width: 100%; }
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
.cat-grid { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cat-chip-wrap { position: relative; display: inline-flex; align-items: center; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 32px; padding: 0 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-soft); font-size: var(--text-meta);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.cat-chip.is-custom { padding-right: 22px; }
.cat-chip img { width: 13px; height: 13px; opacity: .7; }
.cat-chip.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 600; }
.cat-chip.is-active img { opacity: 1; }
.cat-del {
  position: absolute; right: 5px; width: 16px; height: 16px; padding: 0;
  border: 0; border-radius: 50%; background: transparent;
  color: var(--muted); font-size: 12px; line-height: 1; display: grid; place-items: center;
}
.cat-del:hover { background: var(--coral-pale); color: var(--coral); }
.cat-add-btn { border-style: dashed; color: var(--muted); }
.custom-cat-form { display: flex; gap: 8px; }
.custom-cat-form .input { flex: 1; min-height: 34px; }

.pending-bills-box {
  margin-bottom: 16px; padding: 14px 16px; border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--brand) 38%, var(--line));
  background: color-mix(in srgb, var(--brand-pale) 45%, var(--surface));
  display: flex; flex-direction: column; gap: 10px;
}
.pending-bills-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
}
.pending-bills-title {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.pending-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--brand);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 22%, transparent);
}
.pending-bills-title strong { font-size: var(--text-sm); font-weight: 700; color: var(--brand-deep); }
.pending-bills-title small { font-size: var(--text-2xs); color: var(--muted); }
.pending-bills-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 8px; position: relative;
}
.pending-bill-card {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--surface); border: 1px solid var(--line);
}
.pending-bill-info {
  display: flex; align-items: center; gap: 9px; min-width: 0;
}
.pending-bill-info strong { display: block; font-size: var(--text-body); font-weight: 650; }
.pending-bill-info small { font-size: var(--text-2xs); color: var(--muted); }
.pending-bill-right {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
}
.pending-bill-amt { font-size: 14px; font-weight: 750; color: var(--ink); margin-right: 4px; }

.preset-sub-chips {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1;
}
.preset-sub-label { font-size: var(--text-2xs); color: var(--muted); font-weight: 600; }
.preset-sub-btn {
  min-height: 28px; padding: 0 10px; border-radius: 99px;
  border: 1px dashed var(--line-strong); background: var(--surface);
  color: var(--ink-soft); font-size: var(--text-2xs); font-weight: 600;
}
.preset-sub-btn:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); }

.list-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
.list-head h2 { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-md); font-weight: 700; }
.list-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ledger-search { width: 170px; min-height: 36px; }
.ledger-cat-select { width: auto; min-width: 118px; min-height: 36px; }
.ledger-list-panel { padding: 0; }
.list-empty { max-width: none; margin: 0; padding: 40px 24px; border-top: 1px solid var(--line); }
:deep(.ledger-list) { list-style: none; margin: 0; padding: 4px 20px; position: relative; }
:deep(.ledger-list li) { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
:deep(.ledger-list li:last-child) { border-bottom: 0; }
.ledger-cat { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line); }
.ledger-cat img { width: 16px; height: 16px; opacity: .7; }
.ledger-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ledger-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; }
.ledger-copy small { font-size: var(--text-meta); color: var(--muted); }
.ledger-amount { font-size: 14.5px; font-weight: 700; white-space: nowrap; }
.ledger-amount.income { color: var(--brand-deep); }
.ledger-amount.expense { color: var(--ink); }
.ledger-row-actions { display: flex; align-items: center; gap: 2px; }

.renewal-strip { display: grid; gap: 6px; margin: 0 0 14px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--surface) 54%, transparent); }
.renewal-title { margin: 0 0 3px; font-size: var(--text-meta); font-weight: 700; color: var(--muted); letter-spacing: .06em; }
.renewal-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
.renewal-row:first-of-type { border-top: 0; }
.renewal-when { min-width: 46px; font-size: var(--text-meta); font-weight: 650; color: var(--muted); }
.renewal-row.is-soon .renewal-when { color: var(--brand-deep); }
.renewal-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.renewal-copy strong { font-size: var(--text-body); font-weight: 650; }
.renewal-copy small { font-size: var(--text-meta); color: var(--muted); }
.template-tools { display: flex; align-items: flex-end; justify-content: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.template-date { min-width: 170px; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px; position: relative; }
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

@container workbench (max-width: 960px) {
  .ledger-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1080px) {
  .ledger-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .entry-form { grid-template-columns: minmax(0, 1fr); }
  .template-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  :deep(.ledger-list) { padding: 4px 14px; }
  .ledger-search { flex: 1; }
  .pending-bill-card { flex-direction: column; align-items: flex-start; }
  .pending-bill-right { width: 100%; justify-content: flex-end; }
}
</style>
