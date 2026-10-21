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
      <div v-if="!filtered.length" class="empty" style="margin: 8px">
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

@media (max-width: 1080px) {
  .ledger-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .entry-form { grid-template-columns: minmax(0, 1fr); }
  .ledger-list { padding: 4px 14px; }
}
</style>
