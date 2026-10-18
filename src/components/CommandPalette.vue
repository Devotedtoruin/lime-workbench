<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useWorkbench } from '../composables/useWorkbench.js';
import { understand, askLLM, normalizeAction, isLLMReady, loadAgentConfig, resolveAgentEndpoint } from '../../js/agent.js';
import { preview } from '../../js/command.js';
import { searchAll, KIND_LABELS } from '../../js/search.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open', 'new-task']);
const wb = useWorkbench();

const input = ref('');
const inputEl = ref(null);
const intent = ref(null);
const reply = ref('');
const needLLM = ref(false);
const sending = ref(false);
const includeSummary = ref(false);
const suggestions = ['明天下午3点提交周报', '办公用品 45 元', '骑车 30 分钟', '开始专注 45 分钟', '10 分钟后提醒我开会'];

const canSendAI = computed(() => needLLM.value && isLLMReady());

// Two modes in one field, decided by what the text looks like:
//   - it parses as a command ("午饭28块") → show the write preview, Enter commits;
//   - it matches stored records → show the search results, Enter opens the record's page.
// Search runs first for display so a query that happens to parse still lets you find things,
// but the preview stays available above it.
const results = computed(() => searchAll(input.value, wb.state, { today: wb.todayStr.value }));
const activeIndex = ref(0);
const showResults = computed(() => results.value.length > 0);

watch(results, () => { activeIndex.value = 0; });

function moveActive(delta) {
  if (!showResults.value) return;
  const n = results.value.length;
  activeIndex.value = (activeIndex.value + delta + n) % n;
}

function openResult(item) {
  wb.goto(item.page);
  close();
}

watch(() => props.open, async open => {
  if (open) {
    input.value = '';
    intent.value = null;
    reply.value = '';
    needLLM.value = false;
    await nextTick();
    inputEl.value?.focus();
  }
});

watch(input, value => {
  const text = value.trim();
  intent.value = null;
  reply.value = '';
  needLLM.value = false;
  if (!text) return;
  const result = understand(text, wb.state, new Date());
  if (result.intent) intent.value = result.intent;
  else if (result.reply) reply.value = result.reply;
  else if (result.needLLM) needLLM.value = true;
});

function close() { emit('update:open', false); }

function execute() {
  if (intent.value && wb.execIntent(intent.value)) close();
}

async function sendAI() {
  if (!canSendAI.value || sending.value) return;
  const cfg = loadAgentConfig();
  let endpoint;
  try { endpoint = resolveAgentEndpoint(cfg); } catch (error) { reply.value = error.message; return; }
  sending.value = true;
  try {
    const res = await askLLM(input.value.trim(), cfg, includeSummary.value ? wb.state : null);
    reply.value = res?.reply || 'AI 没有返回内容，本地功能仍可正常使用。';
    const actions = (Array.isArray(res?.actions) ? res.actions : []).map(normalizeAction).filter(Boolean);
    if (actions.length) intent.value = actions[0];
  } catch (error) {
    reply.value = error?.message || '请求失败，请稍后重试';
  } finally {
    sending.value = false;
  }
}

const endpointOrigin = computed(() => {
  try { return new URL(resolveAgentEndpoint(loadAgentConfig())).origin; } catch { return ''; }
});

function onKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return; }
  if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return; }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    // Order matters: a parsed command is an explicit intent to write, so it wins over simply
    // finding a record with a similar word. Otherwise Enter on "午饭28块" would open the ledger
    // page instead of recording the expense.
    if (intent.value) execute();
    else if (showResults.value) openResult(results.value[activeIndex.value]);
    else if (canSendAI.value) sendAI();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay command-overlay" @click.self="close">
      <section class="command glass rim" role="dialog" aria-modal="true" aria-label="快捷命令">
        <div class="command-row">
          <img src="/assets/icons/search.svg" alt="" />
          <input
            ref="inputEl"
            v-model="input"
            maxlength="300"
            autocomplete="off"
            placeholder="输入任务、记账或生活记录，例如：明天下午3点开项目会"
            aria-label="输入命令"
            @keydown="onKeydown"
          />
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img src="/assets/icons/x.svg" alt="" />
          </button>
        </div>

        <div class="command-body">
          <div v-if="!input.trim()" class="command-hint">
            <p class="hint-title">说一句话就能完成</p>
            <div class="suggest">
              <button v-for="s in suggestions" :key="s" type="button" @click="input = s">{{ s }}</button>
            </div>
            <p class="hint-foot">本地优先 · 不会自动联网</p>
          </div>

          <div v-else-if="intent" class="command-preview">
            <span class="icon-tile tile-soft"><img src="/assets/icons/sparkles.svg" alt="" /></span>
            <div class="preview-copy">
              <strong>{{ preview(intent) }}</strong>
              <small>本地解析 · 确认后写入工作台</small>
            </div>
            <div class="preview-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="close">取消</button>
              <button class="btn btn-primary btn-sm" type="button" @click="execute">
                <img src="/assets/icons/check.svg" alt="" />确认
              </button>
            </div>
          </div>

          <!-- 搜索结果与命令预览可以同时出现：一句话既可能是要写入的命令，
               也可能只是要找一条记录。写入预览在上（Enter 优先执行它），结果在下。 -->
          <div v-if="showResults" class="command-results" :class="{ 'has-preview': intent }">
            <button
              v-for="(item, i) in results"
              :key="item.id"
              type="button"
              class="result-row"
              :class="{ 'is-active': i === activeIndex }"
              @click="openResult(item)"
              @mouseenter="activeIndex = i"
            >
              <span class="result-kind">{{ KIND_LABELS[item.kind] }}</span>
              <span class="result-copy">
                <strong>{{ item.title }}</strong>
                <small>{{ item.meta }}</small>
              </span>
              <img src="/assets/icons/arrow-up-right.svg" alt="" />
            </button>
          </div>

          <div v-else-if="canSendAI" class="command-ai">
            <p class="ai-copy">
              本地规则未识别。点击发送后，这句话将发往 <strong>{{ endpointOrigin }}</strong>（可选附带今日摘要）。
            </p>
            <label class="ai-summary">
              <input v-model="includeSummary" type="checkbox" class="checkbox" />
              同时附带今天的工作台摘要
            </label>
            <div class="preview-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="close">取消</button>
              <button class="btn btn-primary btn-sm" type="button" :disabled="sending" @click="sendAI">
                {{ sending ? '请求中…' : '发送给 AI' }}
              </button>
            </div>
          </div>

          <div v-else class="command-message">
            <p>{{ reply || '暂未识别。可以到「设置与美化」连接 AI 服务，或用更明确的时间、数量与动作描述。' }}</p>
          </div>

          <div v-if="reply && (intent || canSendAI)" class="command-message"><p>{{ reply }}</p></div>
        </div>

        <div class="command-foot">
          <span><kbd>↵</kbd> 确认 <kbd>Esc</kbd> 关闭</span>
          <span>本地优先 · AI 仅明确点击发送</span>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-overlay { align-items: flex-start; padding-top: min(14vh, 140px); }
.command {
  width: min(620px, 100%); border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  overflow: hidden; animation: modal-in var(--motion-base) var(--ease-spring);
}
.command-row { display: flex; align-items: center; gap: 11px; padding: 12px 12px 12px 18px; border-bottom: 1px solid var(--line); }
.command-row > img { width: 19px; height: 19px; opacity: .55; flex: 0 0 19px; }
.command-row input { flex: 1; min-width: 0; border: 0; background: transparent; font-size: 15px; outline: none; }
.command-body { padding: 16px 18px; }
.command-hint .hint-title { font-size: 13px; font-weight: 650; color: var(--ink-soft); margin-bottom: 10px; }
.suggest { display: flex; flex-wrap: wrap; gap: 8px; }
.suggest button {
  border: 1px solid var(--line); border-radius: var(--radius-pill);
  background: var(--surface-soft); color: var(--ink-soft);
  min-height: 34px; padding: 0 13px; font-size: 12.5px;
  transition: border-color var(--motion-fast), color var(--motion-fast), background-color var(--motion-fast);
}
.suggest button:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); }
.hint-foot { margin-top: 14px; font-size: 12px; color: var(--muted); }
.command-preview { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.preview-copy { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 180px; }
.preview-copy strong { font-size: 14px; font-weight: 650; }
.preview-copy small { font-size: 12px; color: var(--muted); }
.preview-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.command-ai { display: flex; flex-direction: column; gap: 12px; }
.ai-copy { font-size: 13px; color: var(--ink-soft); line-height: 1.65; }
.ai-summary { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.command-message { font-size: 13px; color: var(--ink-soft); line-height: 1.7; }

/* 搜索结果 */
.command-results { display: flex; flex-direction: column; gap: 2px; }
.command-results.has-preview { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.result-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 10px; text-align: left;
  border: 1px solid transparent; border-radius: 9px;
  background: transparent; color: var(--ink);
  transition: background-color var(--motion-fast), border-color var(--motion-fast);
}
.result-row.is-active { background: var(--brand-pale); border-color: color-mix(in srgb, var(--brand) 22%, transparent); }
.result-kind {
  flex: 0 0 auto; min-width: 38px; padding: 2px 6px; text-align: center;
  border-radius: 5px; background: var(--surface-soft); border: 1px solid var(--line);
  font-size: 11.5px; font-weight: 650; color: var(--muted);
}
.result-row.is-active .result-kind { background: var(--surface); color: var(--brand-deep); border-color: color-mix(in srgb, var(--brand) 24%, var(--line)); }
.result-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.result-copy strong { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-copy small { font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-row > img { width: 14px; height: 14px; opacity: 0; flex: 0 0 14px; }
.result-row.is-active > img { opacity: .5; }
.command-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px; border-top: 1px solid var(--line);
  font-size: 12px; color: var(--muted);
}
</style>
