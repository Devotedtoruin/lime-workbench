<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { readLocalImage } from '../../js/media.js';
import { DEFAULT_AGENT, loadAgentConfig, saveAgentConfig, validateAgentConfig, isLLMReady, checkAgentConnection } from '../../js/agent.js';

const wb = useWorkbench();

const settingsSections = [
  { id: 'settings-identity', label: '形象' },
  { id: 'settings-appearance', label: '外观' },
  { id: 'settings-modules', label: '模块' },
  { id: 'settings-goals', label: '目标' },
  { id: 'settings-ai', label: 'AI' },
  { id: 'settings-data', label: '数据' }
];
function jumpTo(id) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/* ---------------- 形象 ---------------- */
const identity = reactive({
  workspaceName: wb.state.settings.workspaceName || '',
  displayName: wb.state.settings.displayName || '',
  avatar: wb.state.settings.avatar || '',
  avatarImage: wb.state.settings.avatarImage || ''
});
const avatarBusy = ref(false);
const avatarInput = ref(null);
// A blank draft should preview as a neutral placeholder, not a literal "我" avatar.
const hasIdentityDraft = computed(() =>
  Boolean(identity.displayName?.trim() || identity.avatar?.trim() || identity.avatarImage)
);

watch(() => wb.state.settings, s => {
  identity.workspaceName = s.workspaceName || '';
  identity.displayName = s.displayName || '';
  identity.avatar = s.avatar || '';
  identity.avatarImage = s.avatarImage || '';
}, { deep: true });

async function pickAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  avatarBusy.value = true;
  try {
    identity.avatarImage = await readLocalImage(file, { kind: 'avatar' });
    wb.showToast('头像已选择，保存后应用');
  } catch (error) {
    wb.showToast(error.message || '图片处理失败');
  } finally {
    avatarBusy.value = false;
  }
}

function removeAvatarImage() {
  identity.avatarImage = '';
  wb.showToast('已移除图片，保存后使用文字头像');
}

function saveIdentity() {
  const s = wb.state.settings;
  const name = identity.workspaceName.trim();
  if ([...name].length > 40) { wb.showToast('工作台名称最多 40 字'); return; }
  if ([...identity.displayName].length > 80) { wb.showToast('称呼最多 80 字'); return; }
  if ([...identity.avatar].length > 32) { wb.showToast('头像文字最多 32 字'); return; }
  s.workspaceName = name;
  s.displayName = identity.displayName.trim();
  s.avatar = identity.avatar.trim();
  s.avatarImage = identity.avatarImage;
  s.avatarAssetId = '';
  s.logoMode = 'default';
  s.logoImage = '';
  s.logoAssetId = '';
  if (wb.save()) wb.showToast('工作台名称与个人形象已保存');
}

/* ---------------- 美化 ---------------- */
// Swatches mirror the actual --scene-a/b/c colours in base.css. They used to be hand-written
// previews that drifted from the real backdrop, so the button and the page disagreed.
const presetList = [
  { id: 'aurora', name: '极光', css: 'linear-gradient(135deg,#78cdbe,#92a8dc 55%,#bad6e8)' },
  { id: 'mint', name: '薄荷', css: 'linear-gradient(135deg,#60c69e,#85cdc7 55%,#d9f0b8)' },
  { id: 'sunset', name: '日落', css: 'linear-gradient(135deg,#efa87a,#b48fcd 55%,#efc891)' },
  { id: 'plain', name: '纯净', css: 'linear-gradient(135deg,#dfe6ec,#f2f5f8)' },
  { id: 'ocean', name: '海雾蓝', css: 'linear-gradient(135deg,#49afc8,#6c9ad6 55%,#a0d8db)' },
  { id: 'paper', name: '暖纸', css: 'linear-gradient(135deg,#dbc89e,#cec1aa 55%,#e2d0b0)' },
  { id: 'forest', name: '森林', css: 'linear-gradient(135deg,#60a060,#86ac80 55%,#cbc682)' },
  { id: 'twilight', name: '暮紫', css: 'linear-gradient(135deg,#9c84cd,#7094c7 55%,#d2a5c6)' }
];
const accents = [
  { id: 'green', name: '青柠绿', color: '#287259' },
  { id: 'blue', name: '海雾蓝', color: '#34698a' },
  { id: 'violet', name: '鸢尾紫', color: '#725b94' },
  { id: 'amber', name: '琥珀金', color: '#8b632c' },
  { id: 'cyan', name: '湖水青', color: '#176d79' },
  { id: 'rose', name: '玫瑰', color: '#9b4369' },
  { id: 'graphite', name: '石墨', color: '#52616c' }
];
const themes = [
  { id: 'system', name: '跟随系统', icon: 'monitor' },
  { id: 'light', name: '浅色', icon: 'sun-medium' },
  { id: 'dark', name: '深色', icon: 'moon' }
];
const cardStyles = [
  { id: 'glass', name: '液态磨砂玻璃' },
  { id: 'solid', name: '纯净实色' },
  { id: 'hairline', name: '极简细边框' }
];
const widgetOptions = [
  { id: 'focus', name: '专注计时' },
  { id: 'reminders', name: '接下来（提醒）' },
  { id: 'weather', name: '顶栏天气' },
  { id: 'work', name: '下班倒计时' },
  { id: 'rhythm', name: '近 7 天记录' },
  { id: 'ledger', name: '本月收支' },
  { id: 'quick', name: '饮水与步数' },
  { id: 'notes', name: '工作便签' },
  { id: 'links', name: '工作链接' }
];

const bgInput = ref(null);
const bgBusy = ref(false);

async function pickBackground(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  bgBusy.value = true;
  try {
    const poster = await readLocalImage(file, { kind: 'background' });
    wb.updateAppearance({ backgroundImage: poster, backgroundAssetId: '' });
    wb.showToast('桌面壁纸已应用');
  } catch (error) {
    wb.showToast(error.message || '壁纸处理失败');
  } finally {
    bgBusy.value = false;
  }
}
function removeBackground() {
  wb.updateAppearance({ backgroundImage: '', backgroundAssetId: '' });
  wb.showToast('壁纸已移除');
}

function setWidget(id, value) {
  const next = { ...wb.appearance.widgets, [id]: value };
  wb.updateAppearance({ widgets: next });
}

/* ---------------- 工作与目标 ---------------- */
const work = reactive({
  onTime: wb.state.settings.onTime || '09:00',
  offTime: wb.state.settings.offTime || '18:00',
  waterGoal: wb.state.settings.waterGoal || 2000,
  stepGoal: wb.state.settings.stepGoal || 6000
});
function saveWork() {
  const on = work.onTime, off = work.offTime;
  if (!/^\d{2}:\d{2}$/.test(on) || !/^\d{2}:\d{2}$/.test(off) || off <= on) {
    wb.showToast('下班时间需晚于上班时间（暂只支持同日班次）');
    return;
  }
  const water = Number(work.waterGoal), steps = Number(work.stepGoal);
  if (!Number.isInteger(water) || water < 250 || water > 10000) { wb.showToast('饮水目标需为 250–10000 ml'); return; }
  if (!Number.isInteger(steps) || steps < 500 || steps > 50000) { wb.showToast('步数目标需为 500–50000'); return; }
  Object.assign(wb.state.settings, { onTime: on, offTime: off, waterGoal: water, stepGoal: steps });
  if (wb.save()) wb.showToast('工作与目标设置已保存');
}

/* ---------------- AI 连接 ---------------- */
const savedAgent = loadAgentConfig();
const agent = reactive({ ...savedAgent });
const agentStatus = ref(isLLMReady(savedAgent) ? '已配置' : '本地模式（未启用 AI）');
const agentTestKey = ref('');
const agentTesting = ref(false);
const agentResult = ref('尚未验证；保存配置不等于连接成功。');

const agentEndpoint = computed(() => {
  const v = validateAgentConfig({ ...agent });
  return v.valid && v.endpoint ? `目标：${new URL(v.endpoint).origin} · 模型：${v.model}` : v.reply || '';
});

function saveAgent() {
  const validation = validateAgentConfig({ ...agent });
  if (!validation.valid) { wb.showToast('配置无效：' + validation.reply); return; }
  if (!saveAgentConfig({ ...agent })) { wb.showToast('保存失败：本机存储不可用'); return; }
  agentStatus.value = isLLMReady(loadAgentConfig()) ? '已配置未验证' : '本地模式（未启用 AI）';
  wb.showToast('AI 配置已保存在本机；未发送请求');
}
function clearAgentKey() {
  const next = { ...loadAgentConfig(), apiKey: '' };
  if (!validateAgentConfig(next).valid) next.provider = 'none';
  if (!saveAgentConfig(next)) {
    wb.showToast('清除失败：本机存储不可用，Key 仍在');
    return;
  }
  Object.assign(agent, loadAgentConfig());
  agentStatus.value = '本地模式（未启用 AI）';
  wb.showToast('已清除保存的 API Key');
}
async function testAgent() {
  if (agentTesting.value) return;
  const config = { ...agent, apiKey: agentTestKey.value || '', persona: DEFAULT_AGENT.persona };
  const v = validateAgentConfig(config, { requireKey: true });
  if (!v.valid) { agentResult.value = `未发送：${v.reply}`; return; }
  if (!window.confirm(`确认发送一次 API 连接测试？\n目标来源：${new URL(v.endpoint).origin}\n模型：${v.model}\n将仅发送固定合成提示，不发送个人数据。`)) {
    agentResult.value = '已取消连接测试，未发送请求。';
    return;
  }
  agentTesting.value = true;
  agentResult.value = '正在测试连接（最多 10 秒）…';
  try {
    const res = await checkAgentConnection(config, { timeoutMs: 10000 });
    agentResult.value = res.reply;
  } catch {
    agentResult.value = '连接测试未完成，请检查网络或服务设置。';
  } finally {
    agentTesting.value = false;
  }
}

/* ---------------- 数据 ---------------- */
const importFile = ref(null);
async function onImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!window.confirm('导入将覆盖当前工作台的任务、账目、习惯和提醒。建议先导出备份。是否继续？')) return;
  await wb.importBackupFile(file);
}
function clearData() {
  if (!window.confirm('确定清空工作台数据？包括待办、账本和提醒，不清除外观与 AI 设置；此操作不可撤销。')) return;
  wb.clearAllData();
}
</script>

<template>
  <div class="page-shell">
    <header class="page-head">
      <div>
        <h1>设置与美化</h1>
        <p class="sub">工作台形象、主题外观与本地数据。全部只保存在本机，随时可改。</p>
      </div>
    </header>

    <nav class="settings-nav" aria-label="设置分区">
      <button v-for="item in settingsSections" :key="item.id" type="button" @click="jumpTo(item.id)">
        {{ item.label }}
      </button>
    </nav>

    <!-- 形象 -->
    <section id="settings-identity" class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">工作台与个人形象</h2>
        <span class="badge badge-brand">仅此设备 · 无需注册</span>
      </div>

      <div class="identity-row">
        <span class="identity-avatar" :class="{ 'has-image': identity.avatarImage }">
          <img v-if="identity.avatarImage" :src="identity.avatarImage" alt="头像预览" />
          <img v-else-if="!hasIdentityDraft" class="identity-avatar-placeholder" :src="asset('assets/icons/circle-user-round.svg')" alt="" />
          <template v-else>{{ identity.avatar.trim() || identity.displayName.trim().slice(0, 1) || '我' }}</template>
        </span>
        <div class="identity-copy">
          <strong>{{ identity.workspaceName.trim() || '青柠工作台' }}</strong>
          <small v-if="hasIdentityDraft">问候时称呼为「{{ identity.displayName.trim() || identity.avatar.trim() }}」· 侧边栏与顶栏都会显示这个头像</small>
          <small v-else>还没有设置称呼和头像，首页只显示通用问候；设置后会显示在侧边栏与顶栏。</small>
          <div class="identity-actions">
            <label class="btn btn-soft btn-sm file-btn">
              <img :src="asset('assets/icons/upload.svg')" alt="" />
              {{ avatarBusy ? '处理中…' : '选择头像图片' }}
              <input ref="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="pickAvatar" />
            </label>
            <button v-if="identity.avatarImage" class="btn btn-ghost btn-sm" type="button" @click="removeAvatarImage">
              移除图片
            </button>
          </div>
        </div>
      </div>

      <div class="form-grid identity-grid">
        <label class="field">
          <span>工作台名称</span>
          <input v-model="identity.workspaceName" class="input" maxlength="40" placeholder="青柠工作台" />
        </label>
        <label class="field">
          <span>首页怎么称呼你</span>
          <input v-model="identity.displayName" class="input" maxlength="80" placeholder="留空只显示通用问候" />
        </label>
        <label class="field">
          <span>图片缺失时的文字 / 表情</span>
          <input v-model="identity.avatar" class="input" maxlength="32" placeholder="如：我、青柠、一个表情" />
        </label>
      </div>
      <p class="tiny">图片优先，文字作回退。支持 PNG、JPEG、WebP，头像会自动压缩为 256px 并为本地保存。</p>
      <div class="actions-row">
        <button class="btn btn-primary" type="button" @click="saveIdentity">
          <img :src="asset('assets/icons/check.svg')" alt="" />保存名称与形象
        </button>
      </div>
    </section>

    <!-- 主题与外观 -->
    <section id="settings-appearance" class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">主题与外观</h2>
        <span class="badge">即时预览 · 自动保存</span>
      </div>

      <p class="group-label">桌面主题</p>
      <div class="preset-grid">
        <button
          v-for="p in presetList"
          :key="p.id"
          type="button"
          class="preset-btn"
          :class="{ 'is-active': wb.appearance.preset === p.id }"
          :aria-pressed="wb.appearance.preset === p.id"
          @click="wb.updateAppearance({ preset: p.id })"
        >
          <span class="preset-swatch" :style="{ background: p.css }" aria-hidden="true"></span>
          <span>{{ p.name }}</span>
        </button>
      </div>

      <p class="group-label">明暗外观</p>
      <div class="theme-grid">
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          class="theme-btn"
          :class="{ 'is-active': wb.appearance.theme === t.id }"
          @click="wb.updateAppearance({ theme: t.id })"
        >
          <img :src="asset(`assets/icons/${t.icon}.svg`)" alt="" />
          {{ t.name }}
        </button>
      </div>

      <p class="group-label">品牌强调色</p>
      <div class="accent-row">
        <button
          v-for="a in accents"
          :key="a.id"
          type="button"
          class="accent-dot"
          :class="{ 'is-active': wb.appearance.accent === a.id }"
          :style="{ '--dot': a.color }"
          :aria-label="a.name"
          :title="a.name"
          @click="wb.updateAppearance({ accent: a.id })"
        />
        <span class="accent-name">{{ accents.find(a => a.id === wb.appearance.accent)?.name }}</span>
      </div>

      <p class="group-label">卡片质感</p>
      <div class="segmented">
        <button
          v-for="c in cardStyles"
          :key="c.id"
          type="button"
          :class="{ 'is-active': wb.appearance.cardStyle === c.id }"
          @click="wb.updateAppearance({ cardStyle: c.id })"
        >{{ c.name }}</button>
      </div>

      <p class="group-label">布局密度</p>
      <div class="segmented">
        <button
          v-for="d in [{ id: 'compact', name: '紧凑' }, { id: 'standard', name: '标准' }, { id: 'comfortable', name: '宽松' }]"
          :key="d.id"
          type="button"
          :class="{ 'is-active': wb.appearance.density === d.id }"
          @click="wb.updateAppearance({ density: d.id })"
        >{{ d.name }}</button>
      </div>

      <!-- 玻璃通透度：这是液态玻璃最直接的一档。数值越低，背后的光透得越多。 -->
      <p class="group-label">玻璃通透度（外壳）</p>
      <div class="slider-row">
        <input
          class="range"
          type="range"
          min="45"
          max="100"
          step="2"
          :value="Math.round(wb.appearance.opacity * 100)"
          aria-label="玻璃不透明度"
          @input="wb.updateAppearance({ opacity: Number($event.target.value) / 100 })"
        />
        <span class="slider-value numeric">{{ Math.round(wb.appearance.opacity * 100) }}%</span>
      </div>
      <p class="tiny">只影响侧栏、顶栏与弹层。为保证正文可读，最低 45%；内容卡片使用实色底。</p>

      <p class="group-label">外壳虚化</p>
      <div class="slider-row">
        <input
          class="range"
          type="range"
          min="0"
          max="24"
          step="1"
          :value="wb.appearance.panelBlur"
          aria-label="外壳虚化程度"
          @input="wb.updateAppearance({ panelBlur: Number($event.target.value) })"
        />
        <span class="slider-value numeric">{{ wb.appearance.panelBlur }}px</span>
      </div>

      <div class="wallpaper-row">
        <div>
          <p class="group-label" style="margin: 0 0 4px">桌面壁纸</p>
          <p class="tiny" style="margin: 0">选择本地图片作为桌面背景，只保存在本机，记录备份不包含。</p>
        </div>
        <div class="wallpaper-actions">
          <label class="btn btn-soft btn-sm file-btn">
            <img :src="asset('assets/icons/upload.svg')" alt="" />
            {{ bgBusy ? '处理中…' : '选择壁纸' }}
            <input ref="bgInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="pickBackground" />
          </label>
          <button v-if="wb.appearance.backgroundImage" class="btn btn-ghost btn-sm" type="button" @click="removeBackground">移除壁纸</button>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-ghost btn-sm" type="button" @click="wb.resetAppearanceToDefault()">恢复默认外观</button>
      </div>
    </section>

    <!-- 首页模块 -->
    <section id="settings-modules" class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">首页内置模块</h2>
        <span class="panel-sub">隐藏不会删除记录</span>
      </div>
      <div class="widget-grid">
        <label v-for="w in widgetOptions" :key="w.id" class="widget-item">
          <input
            class="checkbox"
            type="checkbox"
            :checked="wb.appearance.widgets[w.id] !== false"
            @change="setWidget(w.id, $event.target.checked)"
          />
          <span>{{ w.name }}</span>
        </label>
      </div>
      <div class="actions-row">
        <button class="btn btn-soft btn-sm" type="button" @click="wb.resetBlocks()">恢复默认模块顺序</button>
      </div>
    </section>

    <!-- 工作与目标 -->
    <section id="settings-goals" class="panel glass rim">
      <div class="panel-head"><h2 class="panel-title">工作与生活目标</h2></div>
      <div class="form-grid">
        <label class="field"><span>上班时间</span><input v-model="work.onTime" class="input" type="time" /></label>
        <label class="field"><span>下班时间</span><input v-model="work.offTime" class="input" type="time" /></label>
        <label class="field"><span>饮水目标（ml）</span><input v-model.number="work.waterGoal" class="input" type="number" min="250" max="10000" step="1" inputmode="numeric" /></label>
        <label class="field"><span>步数目标</span><input v-model.number="work.stepGoal" class="input" type="number" min="500" max="50000" step="1" inputmode="numeric" /></label>
      </div>
      <div class="actions-row">
        <button class="btn btn-primary" type="button" @click="saveWork">保存工作与目标</button>
      </div>
    </section>

    <!-- AI -->
    <section id="settings-ai" class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">AI 服务连接</h2>
        <span class="badge">{{ agentStatus }}</span>
      </div>
      <p class="tiny">
        常见的任务、记账和生活记录由本地规则处理。连接 AI 后，也只有你明确点击发送按钮才会向服务商发送当前输入。
        API Key 以明文保存在本机浏览器存储中；这是实验连接，不适合生产密钥或敏感数据。
      </p>
      <div class="form-grid">
        <label class="field">
          <span>服务商</span>
          <select v-model="agent.provider" class="input">
            <option value="none">本地规则（不连接）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI 兼容</option>
            <option value="custom">自定义兼容接口</option>
          </select>
        </label>
        <label class="field">
          <span>API Key</span>
          <input v-model="agent.apiKey" class="input" type="password" maxlength="500" autocomplete="off" spellcheck="false" placeholder="只保存在本机浏览器" />
        </label>
        <label class="field">
          <span>Base URL</span>
          <input v-model="agent.baseUrl" class="input" type="url" maxlength="2000" spellcheck="false" placeholder="使用服务商默认地址" />
        </label>
        <label class="field">
          <span>模型名称</span>
          <input v-model="agent.model" class="input" maxlength="200" spellcheck="false" placeholder="使用服务商默认模型" />
        </label>
      </div>
      <div class="actions-row">
        <button class="btn btn-primary" type="button" @click="saveAgent">保存配置</button>
        <button class="btn btn-ghost btn-danger-text" type="button" @click="clearAgentKey">清除 API Key</button>
      </div>

      <div class="agent-test">
        <p class="tiny">{{ agentEndpoint }}</p>
        <div class="test-row">
          <input v-model="agentTestKey" class="input" type="password" maxlength="500" autocomplete="off" placeholder="临时测试 Key（仅本次使用）" />
          <button class="btn btn-soft btn-sm" type="button" :disabled="agentTesting" @click="testAgent">{{ agentTesting ? '测试中…' : '测试连接' }}</button>
        </div>
        <p class="tiny">{{ agentResult }}</p>
      </div>
    </section>

    <!-- 数据 -->
    <section id="settings-data" class="panel glass rim">
      <div class="panel-head"><h2 class="panel-title">数据与备份</h2></div>
      <p class="tiny">当前数据保存在这个浏览器的本地存储。备份只包含工作台记录，不包含 AI Key 或外观偏好。</p>
      <div class="actions-row">
        <button class="btn btn-soft btn-sm" type="button" @click="wb.exportBackupData()">
          <img :src="asset('assets/icons/download.svg')" alt="" />导出备份
        </button>
        <label class="btn btn-soft btn-sm file-btn">
          <img :src="asset('assets/icons/upload.svg')" alt="" />导入备份
          <input ref="importFile" type="file" accept="application/json" hidden @change="onImport" />
        </label>
        <button class="btn btn-ghost btn-sm btn-danger-text" type="button" @click="clearData">清空本机数据</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-nav {
  position: sticky; top: 84px; z-index: 5;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 5px; border: 1px solid var(--line); border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-sm);
  width: fit-content;
}
.settings-nav button {
  min-height: 32px; padding: 0 13px; border: 0; border-radius: var(--radius-pill);
  background: transparent; color: var(--muted); font-size: var(--text-sm); font-weight: 600;
}
.settings-nav button:hover { background: var(--surface-soft); color: var(--ink); }
.settings-nav button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
section[id^="settings-"] { scroll-margin-top: 140px; }
@media (max-width: 640px) {
  .settings-nav { top: 76px; width: 100%; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }`n  section[id^="settings-"] { scroll-margin-top: 124px; }
  .settings-nav::-webkit-scrollbar { display: none; }
  .settings-nav button { flex: 0 0 auto; }
}
.identity-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; }
.identity-avatar {
  width: 76px; height: 76px; flex: 0 0 76px; border-radius: 22px; overflow: hidden;
  display: grid; place-items: center;
  background: var(--brand-pale); color: var(--brand-deep);
  font-size: 30px; font-weight: 750; border: 1px solid color-mix(in srgb, var(--brand) 22%, var(--line));
  box-shadow: var(--shadow-sm);
}
.identity-avatar.has-image { border-color: var(--line); }
.identity-avatar img { width: 100%; height: 100%; object-fit: cover; }
.identity-avatar-placeholder { width: 32px !important; height: 32px !important; object-fit: contain; opacity: .5; }
.identity-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.identity-copy strong { font-size: var(--text-lg); font-weight: 750; letter-spacing: -.015em; }
.identity-copy small { font-size: var(--text-meta); color: var(--muted); }
.identity-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.file-btn { cursor: pointer; }
.identity-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
/* Form fields stop widening past a readable measure: at 1878px three columns gave each input
   ~600px, so a short value sat in a very long box and the label was far from its end. */
.form-grid { max-width: 1180px; }
.tiny { font-size: var(--text-sm); color: var(--muted); line-height: 1.7; }
.actions-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }

.group-label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-soft); margin: 18px 0 9px; }
.preset-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.preset-btn {
  display: flex; align-items: center; gap: 9px;
  min-height: 56px; padding: 8px; border: 1px solid var(--line-strong);
  border-radius: 12px; background: var(--surface); color: var(--ink-soft); font-size: var(--text-sm);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}
.preset-btn:hover { border-color: var(--line-strong); }
.preset-btn.is-active { border-color: var(--brand); color: var(--brand-deep); font-weight: 650; }
.preset-swatch { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 9px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .35); }

.theme-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.theme-btn {
  display: inline-flex; align-items: center; gap: 7px;
  min-height: 38px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control);
  background: var(--surface); color: var(--ink-soft); font-size: var(--text-sm);
}
.theme-btn img { width: 16px; height: 16px; opacity: .68; }
.theme-btn.is-active { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); font-weight: 650; }
.theme-btn.is-active img { opacity: 1; }

.accent-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.accent-dot {
  width: 26px; height: 26px; padding: 0; border-radius: 50%;
  border: 2px solid transparent; background: var(--dot);
  box-shadow: inset 0 0 0 2px var(--surface);
  transition: transform var(--motion-fast) var(--ease-spring), box-shadow var(--motion-fast);
}
.accent-dot:hover { transform: scale(1.12); }
.accent-dot.is-active { border-color: var(--dot); box-shadow: inset 0 0 0 2px var(--surface), 0 0 0 3px color-mix(in srgb, var(--dot) 26%, transparent); }
.accent-name { font-size: var(--text-meta); color: var(--muted); }

.slider-row { display: flex; align-items: center; gap: 12px; }
.slider-value {
  min-width: 52px; text-align: right; font-size: var(--text-sm); font-weight: 650;
  color: var(--ink-soft); font-variant-numeric: tabular-nums;
}
.range {
  flex: 1; min-width: 0; height: 22px; margin: 0;
  -webkit-appearance: none; appearance: none;
  background: transparent; cursor: pointer;
}
.range::-webkit-slider-runnable-track {
  height: 5px; border-radius: 99px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--brand) 62%, transparent),
    color-mix(in srgb, var(--brand) 18%, transparent));
}
.range::-moz-range-track {
  height: 5px; border-radius: 99px;
  background: color-mix(in srgb, var(--brand) 34%, transparent);
}
.range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; margin-top: -6.5px;
  border-radius: 50%; border: 2px solid var(--surface);
  background: var(--brand); box-shadow: var(--shadow-sm);
  transition: transform var(--motion-fast) var(--ease-spring);
}
.range::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--surface); background: var(--brand);
}
.range:hover::-webkit-slider-thumb { transform: scale(1.12); }

.wallpaper-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
.wallpaper-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.widget-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.widget-item { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); font-size: var(--text-sm); cursor: pointer; }

.agent-test { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
.test-row { display: flex; gap: 8px; margin: 8px 0; }
.test-row .input { flex: 1; min-width: 0; }

@media (max-width: 1000px) {
  .identity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .widget-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .identity-grid { grid-template-columns: minmax(0, 1fr); }
  .widget-grid { grid-template-columns: minmax(0, 1fr); }
  .test-row { flex-direction: column; }
}
</style>
