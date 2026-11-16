<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { CATEGORIES, categoryIcon, displayCategoryName, normalizeLedgerCategory } from '../../js/command.js';

const props = defineProps({
  open: Boolean,
  initialType: { type: String, default: 'expense' },
  record: { type: Object, default: null }
});
const emit = defineEmits(['update:open']);
const wb = useWorkbench();

const type = ref('expense');
const amount = ref('');
const note = ref('');
const cat = ref(CATEGORIES[0]);
const date = ref('');
const amountError = ref('');
const dateError = ref('');
const showCustomCat = ref(false);
const customCatName = ref('');
const customCatError = ref('');

const isEdit = computed(() => Boolean(props.record?.id));
const categories = computed(() => wb.allLedgerCategories?.value || CATEGORIES);

function formatCatLabel(c) {
  return displayCategoryName(c);
}

watch(() => props.open, open => {
  if (!open) return;
  amountError.value = '';
  dateError.value = '';
  showCustomCat.value = false;
  customCatName.value = '';
  customCatError.value = '';
  if (props.record?.id) {
    type.value = props.record.type === 'income' ? 'income' : 'expense';
    amount.value = String(props.record.amount ?? '');
    note.value = props.record.note || '';
    cat.value = normalizeLedgerCategory(props.record.cat || categories.value[0] || CATEGORIES[0]);
    date.value = props.record.date || wb.todayStr.value;
  } else {
    type.value = props.initialType;
    amount.value = '';
    note.value = '';
    cat.value = categories.value[0] || CATEGORIES[0];
    date.value = wb.todayStr.value;
  }
});

function close() { emit('update:open', false); }
function onEscape(event) {
  if (props.open && event.key === 'Escape') close();
}
onMounted(() => window.addEventListener('keydown', onEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape));

function addCustomCat() {
  const clean = customCatName.value.trim();
  if (!clean) {
    customCatError.value = '请输入分类名称';
    return;
  }
  const added = wb.addLedgerCategory(clean);
  if (added) {
    cat.value = added;
    customCatName.value = '';
    customCatError.value = '';
    showCustomCat.value = false;
  } else {
    customCatError.value = '分类已存在或超出限制';
  }
}

function submit() {
  const amt = Number(amount.value);
  let valid = true;
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1_000_000_000) {
    amountError.value = '请输入大于 0 的有效金额';
    valid = false;
  } else {
    amountError.value = '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date.value || ''))) {
    dateError.value = '请选择有效日期';
    valid = false;
  } else {
    dateError.value = '';
  }
  if (!valid) return;

  const payload = {
    type: type.value,
    amount: amount.value,
    note: note.value,
    cat: cat.value,
    date: date.value || wb.todayStr.value
  };
  const ok = isEdit.value
    ? wb.updateLedgerRecord(props.record.id, payload)
    : wb.addLedgerRecord(payload);
  if (ok) close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <section class="modal ledger-modal glass rim" role="dialog" aria-modal="true" :aria-label="isEdit ? '编辑账目' : '记一笔'">
        <div class="modal-head">
          <h2>{{ isEdit ? '编辑账目' : '记一笔' }}</h2>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
        </div>

        <form novalidate @submit.prevent="submit">
          <div class="segmented seg-spaced">
            <button type="button" :class="{ 'is-active': type === 'expense' }" @click="type = 'expense'">支出</button>
            <button type="button" :class="{ 'is-active': type === 'income' }" @click="type = 'income'">收入</button>
          </div>

          <label class="field">
            <span>金额（元）</span>
            <span class="amount-row" :class="{ 'is-invalid': amountError }">
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
                autofocus
                @input="amountError = ''"
              />
            </span>
            <p v-if="amountError" class="field-error" role="alert">{{ amountError }}</p>
          </label>

          <div class="form-grid form-grid-spaced">
            <label class="field">
              <span>备注</span>
              <input v-model="note" class="input" maxlength="300" placeholder="例如：办公用品、通勤、软件订阅" />
            </label>
            <label class="field">
              <span>日期</span>
              <input v-model="date" class="input numeric" :class="{ 'is-invalid': dateError }" type="date" @input="dateError = ''" />
              <p v-if="dateError" class="field-error" role="alert">{{ dateError }}</p>
            </label>
          </div>

          <p class="field-label cat-label-spaced">分类</p>
          <div class="cat-grid">
            <button
              v-for="c in categories"
              :key="c"
              type="button"
              class="cat-chip"
              :class="{ 'is-active': cat === c }"
              @click="cat = c"
            >
              <img :src="asset(`assets/icons/${categoryIcon(c)}.svg`)" alt="" />
              <span>{{ formatCatLabel(c) }}</span>
            </button>
            <button
              type="button"
              class="cat-chip cat-add-chip"
              @click="showCustomCat = !showCustomCat; customCatError = ''"
            >
              <img :src="asset('assets/icons/plus.svg')" alt="" />
              <span>自定义</span>
            </button>
          </div>

          <div v-if="showCustomCat" class="custom-cat-row">
            <input
              v-model="customCatName"
              class="input"
              :class="{ 'is-invalid': customCatError }"
              maxlength="12"
              placeholder="输入新分类名称"
              @input="customCatError = ''"
              @keydown.enter.prevent="addCustomCat"
            />
            <button class="btn btn-soft btn-sm" type="button" @click="addCustomCat">添加</button>
          </div>
          <p v-if="showCustomCat && customCatError" class="field-error" role="alert">{{ customCatError }}</p>

          <div class="modal-actions">
            <button class="btn btn-soft" type="button" @click="close">取消</button>
            <button class="btn btn-primary" type="submit">
              <img :src="asset('assets/icons/check.svg')" alt="" />{{ isEdit ? '保存修改' : '保存记录' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ledger-modal { width: min(520px, 100%); }
.seg-spaced { margin-bottom: 16px; }
.form-grid-spaced { margin-top: 14px; }
.cat-label-spaced { margin: 16px 0 8px; }
.amount-row {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--line-strong); border-radius: var(--radius-control);
  background: var(--surface); padding: 0 14px; min-height: 52px;
}
.amount-row:focus-within { border-color: var(--brand); box-shadow: var(--ring); }
.amount-row b { font-size: 20px; color: var(--muted); font-weight: 600; }
.amount-input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: var(--text-h1); font-weight: 700; letter-spacing: -.02em; }
.cat-grid { display: flex; flex-wrap: wrap; gap: 7px; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 11px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface);
  color: var(--ink-soft); font-size: var(--text-sm);
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.cat-chip img { width: 14px; height: 14px; opacity: .7; }
.cat-chip:hover { border-color: var(--line-strong); color: var(--ink); }
.cat-chip.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 600; }
.cat-chip.is-active img { opacity: 1; }
.cat-add-chip { border-style: dashed; color: var(--muted); }
.custom-cat-row { display: flex; gap: 8px; margin-top: 10px; }
.custom-cat-row .input { flex: 1; min-height: 36px; }
</style>
