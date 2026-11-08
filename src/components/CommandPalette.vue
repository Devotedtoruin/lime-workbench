<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { understand, askLLM, normalizeAction, isLLMReady, loadAgentConfig, resolveAgentEndpoint, looksLikeAssistantRequest, loadAgentSession, saveAgentSession, clearAgentSession } from '../../js/agent.js';
import { parseCommandList, preview } from '../../js/command.js';
import { searchAll, KIND_LABELS } from '../../js/search.js';
import { SYNTAX_CATEGORIES, matchSlashHelp } from '../lib/syntax-help.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['update:open', 'new-task']);
const wb = useWorkbench();

const input = ref('');
const inputEl = ref(null);
// One sentence may carry several commands, so the parse result is a list; `intent` keeps the
// single-command call sites readable.
const intents = ref([]);
const intent = computed(() => intents.value[0] || null);
// Local shortcuts (bare "跑步" / "打开日历") only navigate or prefill; they never write a record.
const shortcut = ref(null);
const savedSession = loadAgentSession();
const chatHistory = ref(savedSession?.messages || []);
const sessionId = ref(savedSession?.id || newSessionId());
const sessionCount = computed(() => chatHistory.value.filter(message => message.role === 'user').length);

function newSessionId() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 8);
}
function persistSession() {
  saveAgentSession({ id: sessionId.value, messages: chatHistory.value });
}
function resetSession() {
  clearAgentSession();
  chatHistory.value = [];
  sessionId.value = newSessionId();
  intents.value = [];
  shortcut.value = null;
  reply.value = '';
  needLLM.value = false;
}
const reply = ref('');
const needLLM = ref(false);
const sending = ref(false);
const includeSummary = ref(false);
const suggestions = ['/help', '明天 15:00 提交周报', '午餐 32 元', '骑行 30 分钟', '开始专注 45 分钟', '便签：版本发布清单'];

const slashHelp = computed(() => matchSlashHelp(input.value));
const canSendAI = computed(() => needLLM.value && isLLMReady() && !slashHelp.value);

function applyExample(val) {
  input.value = val;
  nextTick(() => inputEl.value?.focus());
}

const SHORTCUT_PAGES = { sport: '运动', habits: '健康打卡', study: '专注', calendar: '日历与提醒', todo: '待办' };

/** resolveLocalShortcut 产出的形状是 { kind: 'prefill' | 'navigate', page, payload }。 */
function describeShortcut(sc) {
  if (!sc) return '';
  const page = SHORTCUT_PAGES[sc.page] || sc.page;
  if (sc.kind !== 'prefill') return `前往「${page}」页面`;
  const payload = sc.payload || {};
  if (sc.page === 'sport') return `打开运动并预填${payload.distance ? ` ${payload.distance} 公里` : '运动项目'} · 仍需补全时长`;
  if (sc.page === 'habits') return '打开健康打卡并预填一杯水';
  if (sc.page === 'todo') return `打开待办并预填「${payload.text}」`;
  return `打开${page}并预填表单`;
}

const results = computed(() => {
  if (slashHelp.value) return [];
  return searchAll(input.value, wb.state, { today: wb.todayStr.value });
});
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
    intents.value = [];
    shortcut.value = null;
    reply.value = '';
    needLLM.value = false;
    await nextTick();
    inputEl.value?.focus();
  }
});

watch(input, value => {
  const text = value.trim();
  intents.value = [];
  shortcut.value = null;
  reply.value = '';
  needLLM.value = false;
  // `/help` 由语法速查面板独占，不做命令解析也不进检索。
  if (!text || text.startsWith('/')) return;
  if (looksLikeAssistantRequest(text)) { needLLM.value = true; return; }
  const list = parseCommandList(text, wb.nowDate.value);
  if (list.length) {
    intents.value = list;
    return;
  }
  const result = understand(text, wb.state, wb.nowDate.value);
  if (result.intent) intents.value = [result.intent];
  else if (result.shortcut) shortcut.value = result.shortcut;
  else if (result.reply) reply.value = result.reply;
  else if (result.needLLM) needLLM.value = true;
});

function close() { emit('update:open', false); }

function onGlobalKey(event) {
  if (props.open && event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function execute() {
  if (shortcut.value) {
    if (wb.execShortcut(shortcut.value)) close();
    return;
  }
  if (!intents.value.length) return;
  let completed = 0;
  for (const item of intents.value) {
    if (wb.execIntent(item)) completed += 1;
  }
  if (completed === intents.value.length) close();
  else reply.value = `已执行 ${completed}/${intents.value.length} 项；其余项目未写入，请检查预览。`;
}

async function sendAI() {
  if (!canSendAI.value || sending.value) return;
  const cfg = loadAgentConfig();
  let endpoint;
  try { endpoint = resolveAgentEndpoint(cfg); } catch (error) { reply.value = error.message; return; }
  const question = input.value.trim();
  const history = chatHistory.value.slice(-8);
  sending.value = true;
  try {
    const res = await askLLM(question, cfg, includeSummary.value ? wb.state : null, { history });
    const answer = res?.reply || 'AI 没有返回内容，本地规则与检索仍可正常使用。';
    reply.value = answer;
    const actions = (Array.isArray(res?.actions) ? res.actions : []).map(normalizeAction).filter(Boolean);
    if (actions.length) intents.value = actions;
    chatHistory.value.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    if (chatHistory.value.length > 20) chatHistory.value = chatHistory.value.slice(-20);
    persistSession();
  } catch (error) {
    reply.value = error?.message || '请求未完成，请检查网络连接或接口配置';
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
    if (intent.value || shortcut.value) execute();
    else if (showResults.value) openResult(results.value[activeIndex.value]);
    else if (canSendAI.value) sendAI();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay command-overlay" @click.self="close">
      <section class="command glass rim" role="dialog" aria-modal="true" aria-label="全局命令与检索">
        <div class="command-row">
          <img :src="asset('assets/icons/search.svg')" alt="" />
          <input
            ref="inputEl"
            v-model="input"
            maxlength="300"
            autocomplete="off"
            placeholder="输入 /help 查看语法，或直接输入待办、记账、检索关键字…"
            aria-label="输入命令或搜索"
            @keydown="onKeydown"
          />
          <button
            class="btn btn-soft btn-sm cmd-help-btn"
            type="button"
            @click="input = input.trim() === '/help' ? '' : '/help'"
          >
            {{ slashHelp ? '收起语法' : '/help 语法' }}
          </button>
          <button class="btn-icon" type="button" aria-label="关闭" @click="close">
            <img :src="asset('assets/icons/x.svg')" alt="" />
          </button>
        </div>

        <div class="command-body">
          <!-- /help 交互式语法速查面板 -->
          <div v-if="slashHelp" class="slash-help-panel">
            <div class="slash-help-head">
              <strong>自然语言快记与分类语法速查</strong>
              <span>点击任意示例可直接填入输入框</span>
            </div>
            <div class="slash-help-grid">
              <article v-for="cat in slashHelp.categories" :key="cat.id" class="slash-cat">
                <div class="slash-cat-top">
                  <strong>{{ cat.title }}</strong>
                  <code>{{ cat.cmd }}</code>
                </div>
                <p>{{ cat.desc }}</p>
                <div class="slash-examples">
                  <button
                    v-for="ex in cat.examples"
                    :key="ex.value"
                    type="button"
                    class="slash-chip"
                    @click="applyExample(ex.value)"
                  >
                    {{ ex.label }}
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div v-else-if="!input.trim()" class="command-hint">
            <p class="hint-title">快速录入指令或全局检索（输入 <code>/help</code> 查看完整语法）</p>
            <div class="suggest">
              <button v-for="s in suggestions" :key="s" type="button" @click="applyExample(s)">{{ s }}</button>
            </div>
            <p class="hint-foot">本地优先解析 · 支持任务、收支、专注、饮水、运动与便签检索</p>
          </div>

          <div v-else-if="intents.length || shortcut" class="command-preview">
            <span class="icon-tile tile-soft"><img :src="asset('assets/icons/sparkles.svg')" alt="" /></span>
            <div class="preview-copy">
              <strong v-if="shortcut">{{ describeShortcut(shortcut) }}</strong>
              <strong v-else-if="intents.length === 1">{{ preview(intents[0]) }}</strong>
              <ol v-else class="preview-list">
                <li v-for="(item, i) in intents" :key="i">{{ i + 1 }}. {{ preview(item) }}</li>
              </ol>
              <small v-if="shortcut">快捷动作就绪 · 按 Enter 立即执行</small>
              <small v-else-if="intents.length > 1">本地解析 · {{ intents.length }} 项 · 确认后依次写入</small>
              <small v-else>语法识别就绪 · 按 Enter 写入工作台</small>
            </div>
            <div class="preview-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="close">取消</button>
              <button class="btn btn-primary btn-sm" type="button" @click="execute">
                <img :src="asset('assets/icons/check.svg')" alt="" />{{ intents.length > 1 ? '确认全部' : '确认执行' }}
              </button>
            </div>
          </div>

          <!-- 搜索结果与命令预览可以同时出现：一句话既可能是要写入的命令，
               也可能只是要找一条记录。写入预览在上（Enter 优先执行它），结果在下。 -->
          <div v-if="showResults" class="command-results" :class="{ 'has-preview': intents.length || shortcut }">
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
              <img :src="asset('assets/icons/arrow-up-right.svg')" alt="" />
            </button>
          </div>

          <div v-else-if="!slashHelp && !intents.length && !shortcut && canSendAI" class="command-ai">
            <p class="ai-copy">
              未匹配本地解析规则。确认后可将文本发送至已配置的外部服务 <strong>{{ endpointOrigin }}</strong> 进行解析。
            </p>
            <label class="ai-summary">
              <input v-model="includeSummary" type="checkbox" class="checkbox" />
              附带当日工作台概览上下文
            </label>
            <div class="preview-actions">
              <button class="btn btn-soft btn-sm" type="button" @click="close">取消</button>
              <button class="btn btn-primary btn-sm" type="button" :disabled="sending" @click="sendAI">
                {{ sending ? '请求处理中…' : '发送解析请求' }}
              </button>
            </div>
          </div>

          <div v-else-if="!slashHelp && !intents.length && !shortcut && !showResults" class="command-message">
            <p>{{ reply || '未匹配到对应的本地指令或历史记录。输入 /help 可查看支持的记账、任务与提醒语法规则。' }}</p>
          </div>

          <div v-if="reply && (intents.length || canSendAI)" class="command-message"><p>{{ reply }}</p></div>
        </div>

        <div class="command-foot">
          <span><kbd>↵</kbd> 确认 <kbd>↑↓</kbd> 选择结果 <kbd>Esc</kbd> 关闭</span>
          <span class="command-session">
            AI 会话 #{{ sessionId }} · {{ sessionCount }} 轮
            <button v-if="sessionCount" type="button" class="session-reset" @click="resetSession">新会话</button>
          </span>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-overlay { align-items: flex-start; padding-top: min(12vh, 120px); }
.command {
  width: min(680px, 100%); border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-rim);
  overflow: hidden; animation: modal-in var(--motion-base) var(--ease-spring);
}
.command-row { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 18px; border-bottom: 1px solid var(--line); }
.command-row > img { width: 18px; height: 18px; opacity: .55; flex: 0 0 18px; }
.command-row input { flex: 1; min-width: 0; border: 0; background: transparent; font-size: var(--text-md); outline: none; border-radius: 6px; }
.command-row input:focus-visible { outline: none; }
.cmd-help-btn { min-height: 30px; padding: 0 10px; font-size: var(--text-meta); }

.command-body { padding: 16px 18px; max-height: min(68vh, 540px); overflow-y: auto; }
.command-hint .hint-title { font-size: var(--text-sm); font-weight: 650; color: var(--ink-soft); margin-bottom: 10px; }
.command-hint .hint-title code { padding: 1px 6px; border-radius: 5px; background: var(--surface-soft); border: 1px solid var(--line); font-family: var(--font-numeric); font-size: var(--text-meta); color: var(--brand-deep); }
.suggest { display: flex; flex-wrap: wrap; gap: 8px; }
.suggest button {
  border: 1px solid var(--line); border-radius: 9px;
  background: var(--surface-soft); color: var(--ink-soft);
  min-height: 32px; padding: 0 12px; font-size: var(--text-sm); font-weight: 550;
  transition: border-color var(--motion-fast), color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-fast);
}
.suggest button:hover { border-color: var(--brand); color: var(--brand-deep); background: var(--brand-pale); transform: translateY(-1px); }
.hint-foot { margin-top: 14px; font-size: var(--text-meta); color: var(--muted); }

/* /help 语法面板 */
.slash-help-panel { display: flex; flex-direction: column; gap: 12px; }
.slash-help-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.slash-help-head strong { font-size: var(--text-body); font-weight: 700; color: var(--ink); }
.slash-help-head span { font-size: var(--text-meta); color: var(--muted); }
.slash-help-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.slash-cat {
  padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
  display: flex; flex-direction: column; gap: 6px;
}
.slash-cat:last-child:nth-child(odd) { grid-column: 1 / -1; }
.slash-cat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.slash-cat-top strong { font-size: var(--text-sm); font-weight: 700; color: var(--ink); }
.slash-cat-top code {
  padding: 1px 6px; border-radius: 5px; background: var(--surface);
  border: 1px solid var(--line); font-family: var(--font-numeric); font-size: 11px; color: var(--brand-deep);
}
.slash-cat p { font-size: var(--text-2xs); color: var(--muted); line-height: 1.45; }
.slash-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.slash-chip {
  padding: 4px 9px; border-radius: 7px; border: 1px solid var(--line);
  background: var(--surface); color: var(--ink-soft);
  font-size: var(--text-2xs); font-weight: 550; text-align: left;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.slash-chip:hover { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); }

.command-preview { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.preview-copy { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 180px; }
.preview-copy strong { font-size: var(--text-body); font-weight: 650; }
.preview-copy small { font-size: var(--text-meta); color: var(--muted); }
.preview-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: var(--text-body); line-height: 1.55; }
.preview-list li { overflow-wrap: anywhere; }
.preview-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.command-ai { display: flex; flex-direction: column; gap: 12px; }
.ai-copy { font-size: var(--text-body); color: var(--ink-soft); line-height: 1.65; }
.ai-summary { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--muted); }
.command-message { font-size: var(--text-body); color: var(--ink-soft); line-height: 1.7; }

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
  font-size: var(--text-2xs); font-weight: 650; color: var(--muted);
}
.result-row.is-active .result-kind { background: var(--surface); color: var(--brand-deep); border-color: color-mix(in srgb, var(--brand) 24%, var(--line)); }
.result-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.result-copy strong { font-size: var(--text-body); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-copy small { font-size: var(--text-2xs); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-row > img { width: 14px; height: 14px; opacity: 0; flex: 0 0 14px; }
.result-row.is-active > img { opacity: .5; }
.command-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px; border-top: 1px solid var(--line);
  font-size: var(--text-meta); color: var(--muted);
}
.command-session { display: inline-flex; align-items: center; gap: 7px; }
.session-reset { border: 0; background: transparent; color: var(--brand-deep); padding: 0; font-size: inherit; text-decoration: underline; }
@media (max-width: 640px) {
  .slash-help-grid { grid-template-columns: 1fr; }
}
</style>
