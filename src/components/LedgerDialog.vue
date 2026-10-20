<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { CATEGORIES, categoryIcon } from '../../js/command.js';

const props = defineProps({
  open: Boolean,
  initialType: { type: String, default: 'expense' }
});
const emit = defineEmits(['update:open']);
const wb = useWorkbench();

const type = ref('expense');
const amount = ref('');
const note = ref('');
const cat = ref(CATEGORIES[0]);

watch(() => props.open, open => {
  if (!open) return;
  type.value = props.initialType;
  amount.value = '';
  note.value = '';
  cat.value = CATEGORIES[0];
});

function close() { emit('update:open', false); }
function onEscape(event) {
  if (props.open && event.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape));
function submit() {
  if (wb.addLedgerRecord({ type: type.value, amount: amount.value, note: note.value, cat: cat.value })) close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <section class="modal ledger-modal glass rim" role="dialog" aria-modal="true" aria-label="记一笔">
        <div class="modal-head">
          <h2>记一笔</h2>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
        </div>

        <form @submit.prevent="submit">
          <div class="segmented" style="margin-bottom: 16px">
            <button type="button" :class="{ 'is-active': type === 'expense' }" @click="type = 'expense'">支出</button>
            <button type="button" :class="{ 'is-active': type === 'income' }" @click="type = 'income'">收入</button>
          </div>

          <label class="field">
            <span>金额（元）</span>
            <span class="amount-row">
              <b>¥</b>
              <input
                v-model="amount"
                class="amount-input numeric"
                type="number"
                step="0.01"
                min="0.01"
                max="1000000000"
                inputmode="decimal"
                placeholder="0.00"
                required
                autofocus
              />
            </span>
          </label>

          <label class="field" style="margin-top: 14px">
            <span>备注</span>
            <input v-model="note" class="input" maxlength="300" placeholder="例如：办公用品、通勤、软件订阅" />
          </label>

          <p class="field-label" style="margin: 16px 0 8px">分类</p>
          <div class="cat-grid">
            <button
              v-for="c in CATEGORIES"
              :key="c"
              type="button"
              class="cat-chip"
              :class="{ 'is-active': cat === c }"
              @click="cat = c"
            >
              <img :src="asset(`assets/icons/${categoryIcon(c)}.svg`)" alt="" />
              <span>{{ c.slice(2).trim() }}</span>
            </button>
          </div>

          <div class="modal-actions">
            <button class="btn btn-soft" type="button" @click="close">取消</button>
            <button class="btn btn-primary" type="submit">
              <img :src="asset('assets/icons/check.svg')" alt="" />保存记录
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ledger-modal { width: min(520px, 100%); }
.amount-row {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--line-strong); border-radius: var(--radius-control);
  background: var(--surface); padding: 0 14px; min-height: 52px;
}
.amount-row:focus-within { border-color: var(--brand); box-shadow: var(--ring); }
.amount-row b { font-size: 20px; color: var(--muted); font-weight: 600; }
.amount-input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
.cat-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 11px; border-radius: var(--radius-pill);
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-soft); font-size: 12.5px;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.cat-chip img { width: 14px; height: 14px; opacity: .7; }
.cat-chip:hover { border-color: var(--line-strong); color: var(--ink); }
.cat-chip.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 600; }
.cat-chip.is-active img { opacity: 1; }
</style>
