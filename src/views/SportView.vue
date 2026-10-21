<script setup>
import { computed, reactive } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench, SPORTS } from '../composables/useWorkbench.js';

const wb = useWorkbench();

const form = reactive({ type: 'run', minutes: '', distance: '' });

function kcalOf(type, minutes) {
  const sp = SPORTS.find(s => s.id === type) || SPORTS[0];
  return Math.round(sp.met * 60 * (minutes / 60));
}

const week = computed(() => {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const minutes = wb.state.sport.filter(r => r.date === key).reduce((s, r) => s + Number(r.minutes || 0), 0);
    return { key, label: d.toLocaleDateString('zh-CN', { weekday: 'short' }), minutes, today: i === 6 };
  });
});
const weekMax = computed(() => Math.max(...week.value.map(d => d.minutes), 1));
const weekTotal = computed(() => ({
  count: wb.state.sport.filter(r => week.value.some(d => d.key === r.date)).length,
  minutes: week.value.reduce((s, d) => s + d.minutes, 0)
}));

const recent = computed(() =>
  [...wb.state.sport].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 30)
);

function save() {
  if (wb.addSportRecord({ type: form.type, minutes: form.minutes, distance: form.distance || 0 })) {
    form.minutes = '';
    form.distance = '';
  }
}
function sportOf(type) { return SPORTS.find(s => s.id === type) || SPORTS[0]; }
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>运动记录</h1>
        <p class="sub">记录单次运动的时长与距离；每日总步数在生活习惯中更新。</p>
      </div>
      <span class="privacy"><img :src="asset('assets/icons/shield-check.svg')" alt="" />手动记录 · 不采集传感器</span>
    </header>

    <div class="sport-top">
      <section class="panel glass rim">
        <div class="panel-head">
          <h2 class="panel-title">单次运动记录</h2>
          <button class="btn btn-text btn-sm" type="button" @click="wb.goto('habits')">
            每日总步数<img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
          </button>
        </div>

        <div class="sport-picker">
          <button
            v-for="sp in SPORTS"
            :key="sp.id"
            type="button"
            class="sport-pick"
            :class="{ 'is-active': form.type === sp.id }"
            :aria-pressed="form.type === sp.id"
            @click="form.type = sp.id"
          >
            <img :src="asset(`assets/img/${sp.icon}.png`)" alt="" />
            <span>{{ sp.label }}</span>
          </button>
        </div>

        <form class="sport-form" @submit.prevent="save">
          <label class="field">
            <span>时长</span>
            <span class="unit-wrap">
              <input v-model="form.minutes" type="number" min="0.01" max="1440" step="0.01" inputmode="decimal" required placeholder="30" />
              <i>分钟</i>
            </span>
          </label>
          <label class="field">
            <span>距离 <small>可选</small></span>
            <span class="unit-wrap">
              <input v-model="form.distance" type="number" min="0" max="1000" step="0.1" inputmode="decimal" placeholder="5.0" />
              <i>公里</i>
            </span>
          </label>
          <button class="btn btn-primary" type="submit">保存运动</button>
        </form>
        <p class="tiny"><img :src="asset('assets/icons/info.svg')" alt="" />卡路里仅为估算，不是健康或医疗建议。</p>
      </section>

      <section class="panel glass rim">
        <div class="panel-head">
          <h2 class="panel-title">活动记录</h2>
          <span class="panel-sub">近 7 天：{{ weekTotal.count }} 次 · {{ weekTotal.minutes }} 分钟</span>
        </div>
        <div class="week-bars">
          <div v-for="d in week" :key="d.key" class="wb-col" :class="{ 'is-today': d.today }" :title="`${d.label} · ${d.minutes} 分钟`">
            <i :style="{ height: d.minutes > 0 ? `${Math.max(5, (d.minutes / weekMax) * 62)}px` : '0' }"></i>
            <span>{{ d.label }}</span>
          </div>
        </div>
        <div class="week-stats">
          <div><small>本周运动</small><strong class="numeric">{{ weekTotal.count }}<em>次</em></strong></div>
          <div><small>总时长</small><strong class="numeric">{{ weekTotal.minutes }}<em>分钟</em></strong></div>
          <div><small>估算消耗</small><strong class="numeric">{{ recent.filter(r => week.some(d => d.key === r.date)).reduce((s, r) => s + kcalOf(r.type, r.minutes), 0) }}<em>大卡</em></strong></div>
        </div>
      </section>
    </div>

    <section class="recent-block">
      <h2 class="section-title">最近运动</h2>
      <div v-if="!recent.length" class="empty">
        <span class="empty-art" aria-hidden="true"><img :src="asset('assets/icons/run.svg')" alt="" /></span>
        <strong>暂无单次运动记录</strong>
        <p>在上方选择活动类型并填写时长，距离为可选项。</p>
      </div>
      <ul v-else class="sport-list">
        <li v-for="r in recent" :key="r.id">
          <span class="sport-ico"><img :src="asset(`assets/img/${sportOf(r.type).icon}.png`)" alt="" /></span>
          <div class="sport-copy">
            <strong>{{ sportOf(r.type).label }} · {{ r.minutes }} 分钟<template v-if="r.distance"> · {{ r.distance }} km</template></strong>
            <small>{{ r.date }} · 约 {{ kcalOf(r.type, r.minutes) }} 大卡</small>
          </div>
          <button class="btn-icon is-danger" type="button" aria-label="删除运动记录" @click="wb.deleteSportRecord(r.id)">
            <img :src="asset('assets/icons/trash.svg')" alt="" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.privacy { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-meta); color: var(--muted); }
.privacy img { width: 16px; height: 16px; opacity: .6; }
.sport-top { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--shell-gap); align-items: start; }

.sport-picker { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.sport-pick {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 10px 6px; border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface); color: var(--ink-soft); font-size: var(--text-meta);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-fast);
}
.sport-pick:hover { transform: translateY(-1px); border-color: var(--line-strong); }
.sport-pick.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 650; }
.sport-pick img { width: 26px; height: 26px; object-fit: contain; }

.sport-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 10px; align-items: end; }
.unit-wrap { display: flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--surface); }
.unit-wrap:focus-within { border-color: var(--brand); box-shadow: var(--ring); }
.unit-wrap input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: var(--text-body); font-variant-numeric: tabular-nums; }
.unit-wrap i { font-style: normal; font-size: var(--text-meta); color: var(--muted); }
.tiny { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: var(--text-meta); color: var(--muted); }
.tiny img { width: 14px; height: 14px; opacity: .55; }

.week-bars { display: flex; align-items: flex-end; gap: 10px; height: 92px; padding-top: 6px; }
.wb-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%; }
.wb-col i { width: 100%; max-width: 26px; border-radius: 6px 6px 2px 2px; background: color-mix(in srgb, var(--brand) 45%, transparent); transition: height var(--motion-slow) var(--ease-out); }
.wb-col.is-today i { background: var(--brand); }
.wb-col span { font-size: var(--text-meta); color: var(--muted); }
.week-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.week-stats > div { display: flex; flex-direction: column; gap: 4px; }
.week-stats small { font-size: var(--text-meta); color: var(--muted); }
.week-stats strong { font-size: var(--text-md); font-weight: 700; }
.week-stats em { font-style: normal; font-size: var(--text-meta); font-weight: 400; color: var(--muted); margin-left: 2px; }

.section-title { font-size: var(--text-md); font-weight: 700; margin: 4px 0 10px; }
.sport-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sport-list li { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
.sport-ico { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 10px; background: var(--surface-soft); border: 1px solid var(--line); }
.sport-ico img { width: 22px; height: 22px; object-fit: contain; }
.sport-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sport-copy strong { font-size: var(--text-body); font-weight: 600; overflow-wrap: anywhere; }
.sport-copy small { font-size: var(--text-meta); color: var(--muted); }

@media (max-width: 1080px) {
  .sport-top { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .sport-picker { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .sport-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sport-form > .btn { grid-column: 1 / -1; }
}
</style>
