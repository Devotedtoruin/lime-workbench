<script setup>
import { computed, ref } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { categoryIcon } from '../../js/command.js';

const props = defineProps({
  compact: { type: Boolean, default: false }
});

const wb = useWorkbench();

/* ---------------- 月度预算水位线编辑 ---------------- */
const editingBudget = ref(false);
const budgetDraft = ref('');

function openBudgetEditor() {
  budgetDraft.value = String(wb.monthlyBudget.value);
  editingBudget.value = true;
}

function saveBudget() {
  if (wb.setMonthlyBudget(budgetDraft.value)) {
    editingBudget.value = false;
  }
}

/* ---------------- 折线图：月度收支趋势（Recharts 同款交互） ---------------- */
const trendSpan = ref('month'); // '14d' | 'month'
const hoverIdx = ref(-1);

const currency = new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2
});
function money(n) { return currency.format(Number(n) || 0); }

function catName(c) {
  const s = String(c || '');
  return (/^[^\w\u4e00-\u9fa5]/.test(s) ? s.replace(/^[^\s]+\s*/, '').trim() : s.trim()) || '未分类';
}

const trendDays = computed(() => {
  const now = new Date(wb.nowDate.value);
  const list = [];
  if (trendSpan.value === '14d') {
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      list.push({
        key,
        short: `${d.getMonth() + 1}/${d.getDate()}`,
        label: i === 0 ? `今天 (${d.getMonth() + 1}月${d.getDate()}日)` : `${d.getMonth() + 1}月${d.getDate()}日`,
        isToday: i === 0
      });
    }
  } else {
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayDate = now.getDate();
    // 仅展示本月 1 日至今日的真实已发生日期，不渲染未来空白日期
    for (let day = 1; day <= todayDate; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      list.push({
        key,
        short: `${month + 1}/${day}`,
        label: day === todayDate ? `今天 (${month + 1}月${day}日)` : `${month + 1}月${day}日`,
        isToday: day === todayDate
      });
    }
  }

  const byDate = new Map();
  for (const r of wb.state.ledger || []) {
    if (!r || !r.date) continue;
    const entry = byDate.get(r.date) || { expense: 0, income: 0, count: 0 };
    const amt = Number(r.amount) || 0;
    if (r.type === 'income') entry.income += amt;
    else entry.expense += amt;
    entry.count += 1;
    byDate.set(r.date, entry);
  }

  return list.map(d => {
    const stat = byDate.get(d.key) || { expense: 0, income: 0, count: 0 };
    return {
      ...d,
      expense: Number(stat.expense.toFixed(2)),
      income: Number(stat.income.toFixed(2)),
      count: stat.count
    };
  });
});

const svgBox = { width: 580, height: 212, padL: 46, padR: 28, padT: 18, padB: 28 };

const lineGeometry = computed(() => {
  const pts = trendDays.value;
  const plotW = svgBox.width - svgBox.padL - svgBox.padR;
  const plotH = svgBox.height - svgBox.padT - svgBox.padB;
  const rawMax = Math.max(
    ...pts.map(p => Math.max(p.expense, p.income)),
    100
  );
  // 向上取整到整洁刻度
  const stepUnit = rawMax <= 200 ? 50 : rawMax <= 1000 ? 250 : rawMax <= 5000 ? 1000 : Math.ceil(rawMax / 4000) * 1000;
  const maxVal = Math.ceil(rawMax / stepUnit) * stepUnit;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const val = Math.round(maxVal * (1 - t));
    const y = svgBox.padT + plotH * t;
    return { val, y, label: val >= 1000 ? `¥${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `¥${val}` };
  });

  const count = pts.length;
  const stepX = count > 1 ? plotW / (count - 1) : 0;

  const coords = pts.map((p, idx) => {
    const x = count > 1 ? svgBox.padL + idx * stepX : svgBox.padL + plotW / 2;
    const yExp = svgBox.padT + plotH * (1 - p.expense / maxVal);
    const yInc = svgBox.padT + plotH * (1 - p.income / maxVal);
    return { ...p, idx, x, yExp, yInc };
  });

  function buildSmoothPath(points, key) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0][key].toFixed(1)}`;
    let d = `M ${points[0].x.toFixed(1)} ${points[0][key].toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const curr = points[i];
      const next = points[i + 1];
      const cpx = ((curr.x + next.x) / 2).toFixed(1);
      d += ` C ${cpx} ${curr[key].toFixed(1)}, ${cpx} ${next[key].toFixed(1)}, ${next.x.toFixed(1)} ${next[key].toFixed(1)}`;
    }
    return d;
  }

  const baseLineY = (svgBox.padT + plotH).toFixed(1);
  const expLine = buildSmoothPath(coords, 'yExp');
  const incLine = buildSmoothPath(coords, 'yInc');
  const expArea = coords.length > 1
    ? `${expLine} L ${coords.at(-1).x.toFixed(1)} ${baseLineY} L ${coords[0].x.toFixed(1)} ${baseLineY} Z`
    : '';
  const incArea = coords.length > 1
    ? `${incLine} L ${coords.at(-1).x.toFixed(1)} ${baseLineY} L ${coords[0].x.toFixed(1)} ${baseLineY} Z`
    : '';

  // 防碰撞 X 轴刻度采样：保证相邻标签最小间距 >= 48px，且始终保留首尾（今天）刻度
  const minGapPx = 48;
  const xLabels = [];
  for (let i = 0; i < coords.length; i += 1) {
    const pt = coords[i];
    if (i === 0) {
      xLabels.push(pt);
      continue;
    }
    if (i === coords.length - 1) {
      const prev = xLabels.at(-1);
      if (prev && pt.x - prev.x < minGapPx && xLabels.length > 1) {
        xLabels.pop();
      }
      xLabels.push(pt);
      continue;
    }
    const prev = xLabels.at(-1);
    if (!prev || pt.x - prev.x >= minGapPx) {
      xLabels.push(pt);
    }
  }

  return { coords, yTicks, xLabels, expLine, incLine, expArea, incArea, plotH, plotW, baseLineY };
});

const activePoint = computed(() => {
  const coords = lineGeometry.value.coords;
  if (!coords.length) return null;
  if (hoverIdx.value >= 0 && hoverIdx.value < coords.length) {
    return coords[hoverIdx.value];
  }
  return coords.find(c => c.isToday) || coords.at(-1);
});

/* ---------------- 环形饼图：消费分类结构（Recharts 同款交互） ---------------- */
const PALETTE = [
  '#287259', // 青柠主色
  '#3b82f6', // 现代蓝
  '#f59e0b', // 琥珀黄
  '#ec4899', // 珊瑚粉
  '#8b5cf6', // 鸢尾紫
  '#14b8a6', // 青碧色
  '#64748b'  // 石墨灰
];

const hoveredCat = ref('');

const categorySlices = computed(() => {
  const nowMonth = wb.todayStr.value.slice(0, 7);
  const monthExpenses = (wb.state.ledger || []).filter(
    r => r && r.type === 'expense' && String(r.date || '').startsWith(nowMonth)
  );
  // 若当月暂无支出，回退统计全部历史支出并标注
  const source = monthExpenses.length
    ? monthExpenses
    : (wb.state.ledger || []).filter(r => r && r.type === 'expense');

  const totals = new Map();
  let grandTotal = 0;
  for (const r of source) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    const cat = r.cat || '🎁 其他';
    totals.set(cat, (totals.get(cat) || 0) + amt);
    grandTotal += amt;
  }

  const sorted = [...totals.entries()]
    .map(([cat, amount]) => ({ cat, name: catName(cat), icon: categoryIcon(cat), amount }))
    .sort((a, b) => b.amount - a.amount);

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let accFraction = 0;

  const slices = sorted.map((item, idx) => {
    const fraction = grandTotal > 0 ? item.amount / grandTotal : 0;
    const dash = Math.max(0, fraction * circumference);
    const offset = -accFraction * circumference;
    accFraction += fraction;
    return {
      ...item,
      color: PALETTE[idx % PALETTE.length],
      percent: grandTotal > 0 ? Math.round(fraction * 100) : 0,
      dash: `${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`,
      offset: offset.toFixed(2)
    };
  });

  return {
    isCurrentMonth: monthExpenses.length > 0,
    grandTotal,
    radius,
    circumference,
    slices
  };
});

const focusedSlice = computed(() => {
  if (!hoveredCat.value) return null;
  return categorySlices.value.slices.find(s => s.cat === hoveredCat.value) || null;
});
</script>

<template>
  <div class="charts-wrap" :class="{ 'is-compact': props.compact }">
    <!-- 顶部：月度预算水位线横幅 -->
    <div class="budget-bar-card" :class="`is-${wb.budgetStatus.value.status}`">
      <div class="budget-head">
        <div class="budget-title-group">
          <span class="budget-dot" aria-hidden="true"></span>
          <strong>本月预算水位线</strong>
          <span class="budget-msg">{{ wb.budgetStatus.value.message }}</span>
        </div>
        <div class="budget-actions">
          <form v-if="editingBudget" class="budget-edit-form" @submit.prevent="saveBudget">
            <span class="budget-prefix">¥</span>
            <input
              v-model="budgetDraft"
              type="number"
              min="100"
              max="10000000"
              step="100"
              class="input budget-input numeric"
              aria-label="月度预算金额"
              required
            />
            <button class="btn btn-primary btn-sm" type="submit">保存</button>
            <button class="btn btn-ghost btn-sm" type="button" @click="editingBudget = false">取消</button>
          </form>
          <template v-else>
            <span class="budget-ratio numeric">
              <b>{{ money(wb.budgetStatus.value.expense) }}</b> / {{ money(wb.budgetStatus.value.budget) }}
            </span>
            <button class="btn btn-soft btn-sm budget-set-btn" type="button" @click="openBudgetEditor">
              <img :src="asset('assets/icons/sliders-horizontal.svg')" alt="" />调整预算
            </button>
          </template>
        </div>
      </div>
      <div class="budget-track" role="progressbar" :aria-valuenow="wb.budgetStatus.value.percent" aria-valuemin="0" aria-valuemax="100">
        <i class="budget-fill" :style="{ width: `${wb.budgetStatus.value.percent}%` }"></i>
      </div>
    </div>

    <!-- 主体：左折线趋势图 + 右分类占比饼状图 -->
    <div class="charts-grid">
      <!-- 1. 月度收支趋势折线图 -->
      <article class="chart-box">
        <div class="chart-box-head">
          <div class="chart-head-top">
            <h3>月度收支趋势分析</h3>
            <div class="chart-head-right">
              <div class="chart-legend" aria-hidden="true">
                <span><i class="dot exp"></i>支出</span>
                <span><i class="dot inc"></i>收入</span>
              </div>
              <div class="segmented chart-seg">
                <button type="button" :class="{ 'is-active': trendSpan === 'month' }" @click="trendSpan = 'month'">本月至今</button>
                <button type="button" :class="{ 'is-active': trendSpan === '14d' }" @click="trendSpan = '14d'">近 14 天</button>
              </div>
            </div>
          </div>
          <p class="chart-sub numeric">
            <template v-if="activePoint">
              <span class="chart-sub-date">{{ activePoint.label }}</span>
              <span class="chart-sub-sep" aria-hidden="true">·</span>
              <span>支出 <b class="exp-text">{{ money(activePoint.expense) }}</b></span>
              <span class="chart-sub-sep" aria-hidden="true">·</span>
              <span>收入 <b class="inc-text">{{ money(activePoint.income) }}</b></span>
            </template>
            <span v-else>悬浮或点击折线节点查看单日收支明细</span>
          </p>
        </div>

        <div class="svg-stage" @mouseleave="hoverIdx = -1">
          <svg
            :viewBox="`0 0 ${svgBox.width} ${svgBox.height}`"
            class="recharts-svg"
            role="img"
            aria-label="月度收支趋势折线图"
          >
            <defs>
              <linearGradient id="rcExpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--coral)" stop-opacity="0.24" />
                <stop offset="100%" stop-color="var(--coral)" stop-opacity="0.0" />
              </linearGradient>
              <linearGradient id="rcIncGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.24" />
                <stop offset="100%" stop-color="var(--brand)" stop-opacity="0.0" />
              </linearGradient>
            </defs>

            <!-- 水平参考网格线 -->
            <g class="grid-lines">
              <g v-for="t in lineGeometry.yTicks" :key="t.val">
                <line
                  :x1="svgBox.padL"
                  :x2="svgBox.width - svgBox.padR"
                  :y1="t.y"
                  :y2="t.y"
                  stroke="var(--line)"
                  stroke-dasharray="3 3"
                />
                <text
                  :x="svgBox.padL - 8"
                  :y="t.y + 4"
                  text-anchor="end"
                  class="axis-text numeric"
                >
                  {{ t.label }}
                </text>
              </g>
            </g>

            <!-- X 轴日期刻度 -->
            <g class="x-axis">
              <text
                v-for="pt in lineGeometry.xLabels"
                :key="pt.key"
                :x="pt.x"
                :y="svgBox.height - 7"
                text-anchor="middle"
                class="axis-text numeric"
                :class="{ 'is-today-tick': pt.isToday }"
              >
                {{ pt.isToday ? '今天' : pt.short }}
              </text>
            </g>

            <!-- 渐变面积与平滑折线 -->
            <path :d="lineGeometry.incArea" fill="url(#rcIncGrad)" />
            <path :d="lineGeometry.expArea" fill="url(#rcExpGrad)" />
            <path
              :d="lineGeometry.incLine"
              fill="none"
              stroke="var(--brand)"
              stroke-width="2.2"
              stroke-linecap="round"
            />
            <path
              :d="lineGeometry.expLine"
              fill="none"
              stroke="var(--coral)"
              stroke-width="2.4"
              stroke-linecap="round"
            />

            <!-- 悬浮准星线 -->
            <line
              v-if="activePoint"
              :x1="activePoint.x"
              :x2="activePoint.x"
              :y1="svgBox.padT"
              :y2="lineGeometry.baseLineY"
              stroke="var(--line-strong)"
              stroke-width="1"
              stroke-dasharray="4 3"
            />

            <!-- 数据节点与热区 -->
            <g v-for="pt in lineGeometry.coords" :key="pt.key">
              <circle
                v-if="pt.income > 0 || hoverIdx === pt.idx || pt.isToday"
                :cx="pt.x"
                :cy="pt.yInc"
                :r="hoverIdx === pt.idx ? 5 : pt.isToday ? 3.8 : 3"
                fill="var(--surface)"
                stroke="var(--brand)"
                stroke-width="2"
              />
              <circle
                v-if="pt.expense > 0 || hoverIdx === pt.idx || pt.isToday"
                :cx="pt.x"
                :cy="pt.yExp"
                :r="hoverIdx === pt.idx ? 5.5 : pt.isToday ? 4 : 3.2"
                fill="var(--surface)"
                stroke="var(--coral)"
                stroke-width="2.2"
              />
              <!-- 宽触发热区 -->
              <rect
                :x="pt.x - (lineGeometry.plotW / Math.max(lineGeometry.coords.length, 2)) / 2"
                :y="svgBox.padT"
                :width="Math.max(12, lineGeometry.plotW / Math.max(lineGeometry.coords.length, 2))"
                :height="lineGeometry.plotH"
                fill="transparent"
                class="hit-col"
                @mouseenter="hoverIdx = pt.idx"
                @click="hoverIdx = pt.idx"
              />
            </g>
          </svg>
        </div>
      </article>

      <!-- 2. 消费类别环形饼状图 -->
      <article class="chart-box pie-box">
        <div class="chart-box-head">
          <div class="chart-head-top">
            <h3>消费类别占比</h3>
            <button class="btn btn-text btn-sm" type="button" @click="wb.openLedgerDialog()">+ 记一笔</button>
          </div>
          <p class="chart-sub">
            {{ categorySlices.isCurrentMonth ? '当月各分类支出结构对比' : '历史累计支出结构对比' }}
          </p>
        </div>

        <div v-if="!categorySlices.slices.length" class="pie-empty">
          <img :src="asset('assets/icons/wallet-cards.svg')" alt="" />
          <span>暂无消费分类数据，记一笔账后自动生成饼图</span>
        </div>

        <div v-else class="pie-stage">
          <div class="donut-wrap" @mouseleave="hoveredCat = ''">
            <svg viewBox="0 0 156 156" class="donut-svg" role="img" aria-label="消费类别环形饼图">
              <circle
                cx="78"
                cy="78"
                :r="categorySlices.radius"
                fill="none"
                stroke="var(--surface-soft)"
                stroke-width="18"
              />
              <circle
                v-for="s in categorySlices.slices"
                :key="s.cat"
                cx="78"
                cy="78"
                :r="categorySlices.radius"
                fill="none"
                :stroke="s.color"
                :stroke-width="hoveredCat === s.cat ? 22 : 18"
                :stroke-dasharray="s.dash"
                :stroke-dashoffset="s.offset"
                transform="rotate(-90 78 78)"
                class="donut-slice"
                :class="{ 'is-dim': hoveredCat && hoveredCat !== s.cat }"
                @mouseenter="hoveredCat = s.cat"
                @click="hoveredCat = hoveredCat === s.cat ? '' : s.cat"
              />
            </svg>
            <div class="donut-center">
              <small>{{ focusedSlice ? focusedSlice.name : '总计支出' }}</small>
              <strong class="numeric">{{ money(focusedSlice ? focusedSlice.amount : categorySlices.grandTotal) }}</strong>
              <span v-if="focusedSlice" class="numeric">{{ focusedSlice.percent }}%</span>
            </div>
          </div>

          <ul class="pie-legend">
            <li
              v-for="s in categorySlices.slices.slice(0, 6)"
              :key="s.cat"
              :class="{ 'is-active': hoveredCat === s.cat }"
              @mouseenter="hoveredCat = s.cat"
              @mouseleave="hoveredCat = ''"
            >
              <span class="legend-swatch" :style="{ background: s.color }"></span>
              <span class="legend-name">{{ s.name }}</span>
              <span class="legend-pct numeric">{{ s.percent }}%</span>
              <strong class="legend-amt numeric">{{ money(s.amount) }}</strong>
            </li>
          </ul>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.charts-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
  container-type: inline-size;
  container-name: charts-box;
}

/* 月度预算水位条 */
.budget-bar-card {
  padding: 13px 16px; border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
  display: flex; flex-direction: column; gap: 9px;
}
.budget-bar-card.is-warning {
  border-color: color-mix(in srgb, var(--amber) 38%, var(--line));
  background: color-mix(in srgb, var(--amber-pale) 45%, var(--surface));
}
.budget-bar-card.is-over {
  border-color: color-mix(in srgb, var(--coral) 45%, var(--line));
  background: color-mix(in srgb, var(--coral-pale) 48%, var(--surface));
}
.budget-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.budget-title-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.budget-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); }
.budget-bar-card.is-warning .budget-dot { background: var(--amber); }
.budget-bar-card.is-over .budget-dot { background: var(--coral); }
.budget-title-group strong { font-size: var(--text-sm); font-weight: 700; color: var(--ink); }
.budget-msg { font-size: var(--text-meta); color: var(--muted); }
.budget-bar-card.is-over .budget-msg { color: var(--coral); font-weight: 600; }
.budget-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.budget-ratio { font-size: var(--text-meta); color: var(--muted); }
.budget-ratio b { color: var(--ink); font-weight: 700; }
.budget-edit-form { display: flex; align-items: center; gap: 6px; }
.budget-prefix { font-size: var(--text-sm); font-weight: 700; color: var(--muted); }
.budget-input { width: 110px; min-height: 32px; padding: 4px 8px; font-size: var(--text-sm); }
.budget-track {
  height: 7px; border-radius: 99px; overflow: hidden;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.budget-fill {
  display: block; height: 100%; border-radius: inherit;
  background: var(--brand);
  transition: width 360ms var(--ease-out), background-color 240ms;
}
.budget-bar-card.is-warning .budget-fill { background: var(--amber); }
.budget-bar-card.is-over .budget-fill { background: var(--coral); }

/* 双图栅格 */
.charts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.32fr) minmax(280px, 0.98fr);
  gap: 14px;
  align-items: stretch;
}
.chart-box {
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  display: flex; flex-direction: column; justify-content: space-between; gap: 10px;
  min-width: 0;
}
.chart-box-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.chart-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.chart-head-top h3 {
  font-size: var(--text-body);
  font-weight: 750;
  color: var(--ink);
  letter-spacing: -.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart-sub {
  margin: 0;
  min-height: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--text-meta);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.chart-sub-date {
  font-weight: 650;
  color: var(--ink-soft);
}
.chart-sub-sep { opacity: .55; }
.exp-text { color: var(--coral); font-weight: 700; }
.inc-text { color: var(--brand-deep); font-weight: 700; }
.chart-head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.chart-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--muted);
  font-weight: 600;
  white-space: nowrap;
}
.chart-legend span { display: inline-flex; align-items: center; gap: 4px; }
.chart-legend .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.chart-legend .dot.exp { background: var(--coral); }
.chart-legend .dot.inc { background: var(--brand); }
.chart-seg { flex: 0 0 auto; }
.chart-seg button { min-height: 26px; padding: 0 9px; font-size: 11.5px; white-space: nowrap; }

.svg-stage { width: 100%; overflow: hidden; }
.recharts-svg { display: block; width: 100%; height: auto; max-height: 215px; overflow: visible; }
.axis-text { font-size: 10.5px; fill: var(--muted); }
.axis-text.is-today-tick { fill: var(--brand-deep); font-weight: 700; }
.hit-col { cursor: crosshair; }

/* 环形图 */
.pie-empty {
  flex: 1; min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; color: var(--muted); font-size: var(--text-meta); text-align: center;
  border: 1px dashed var(--line); border-radius: 12px; padding: 16px;
}
.pie-empty img { width: 24px; height: 24px; opacity: .45; }
.pie-stage { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
.donut-wrap { position: relative; width: 142px; height: 142px; flex: 0 0 142px; display: grid; place-items: center; }
.donut-svg { width: 100%; height: 100%; overflow: visible; }
.donut-slice {
  cursor: pointer;
  transition: stroke-width 180ms var(--ease-out), opacity 180ms var(--ease-out);
}
.donut-slice.is-dim { opacity: .42; }
.donut-center {
  position: absolute; inset: 26px; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; pointer-events: none;
}
.donut-center small { font-size: 10.5px; color: var(--muted); max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.donut-center strong { font-size: 13px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; margin-top: 1px; }
.donut-center span { font-size: 10.5px; font-weight: 700; color: var(--brand-deep); }

.pie-legend {
  list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.pie-legend li {
  display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: center; gap: 7px; padding: 4px 7px; border-radius: 8px;
  font-size: var(--text-meta); cursor: pointer;
  transition: background-color var(--motion-fast);
}
.pie-legend li:hover, .pie-legend li.is-active { background: var(--surface-soft); }
.legend-swatch { width: 8px; height: 8px; border-radius: 2.5px; }
.legend-name { font-weight: 600; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend-pct { color: var(--muted); font-size: 11px; }
.legend-amt { color: var(--ink); font-weight: 700; }

/* 基于容器查询自适应：无论侧边栏展开还是收起，都按图表容器自身真实宽度响应式排布 */
@container charts-box (max-width: 820px) {
  .charts-grid { grid-template-columns: 1fr; }
}
@container charts-box (max-width: 480px) {
  .chart-legend { display: none; }
  .pie-stage { flex-direction: column; align-items: stretch; }
  .donut-wrap { margin: 0 auto; }
}
@media (max-width: 960px) {
  .charts-grid { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .pie-stage { flex-direction: column; align-items: stretch; }
  .donut-wrap { margin: 0 auto; }
}
</style>
