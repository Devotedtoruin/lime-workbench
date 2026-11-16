<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import {
  WEBSITE_CATEGORIES,
  WEBSITE_CATALOG,
  canonicalUrlKey,
  getRolePresetLinks
} from '../../js/roles.js';
import EmptyState from '../components/EmptyState.vue';

const wb = useWorkbench();

const activeCategory = ref('全部');
const searchQuery = ref('');
const pinnedOnly = ref(false);
const catalogExpanded = ref(false);
const catalogCat = ref(wb.currentRole.value.presetCategory || '全部');

watch(() => wb.currentRole.value.presetCategory, cat => {
  if (cat && !catalogExpanded.value) catalogCat.value = cat;
});

const editorOpen = ref(false);
const formError = ref('');
const form = reactive({
  id: null,
  title: '',
  url: '',
  category: wb.currentRole.value.presetCategory || '通用效率',
  desc: '',
  pinned: false
});

function openEditor(link = null) {
  formError.value = '';
  if (link) {
    const meta = wb.getLinkMeta(link.url);
    form.id = link.id;
    form.title = link.title || '';
    form.url = link.url || '';
    form.category = meta.category || '通用效率';
    form.desc = meta.desc || '';
    form.pinned = Boolean(meta.pinned);
  } else {
    form.id = null;
    form.title = '';
    form.url = '';
    form.category = activeCategory.value !== '全部'
      ? activeCategory.value
      : (wb.currentRole.value.presetCategory || '通用效率');
    form.desc = '';
    form.pinned = false;
  }
  editorOpen.value = true;
}

function submitLink() {
  const title = form.title.trim();
  const url = form.url.trim();
  if (!title) {
    formError.value = '请填写网站名称';
    return;
  }
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    formError.value = '请输入以 http:// 或 https:// 开头的有效网址';
    return;
  }
  formError.value = '';
  const ok = wb.saveLinkRecord({
    id: form.id,
    title,
    url,
    category: form.category.trim() || '通用效率',
    desc: form.desc.trim(),
    pinned: form.pinned
  });
  if (ok) {
    editorOpen.value = false;
    wb.showToast(form.id ? '已更新网址书签' : '已添加到网址导航');
  }
}

const enrichedLinks = computed(() =>
  (wb.state.links || []).map((link, index) => {
    const meta = wb.getLinkMeta(link.url);
    return {
      ...link,
      orderIndex: index,
      category: meta.category || '通用效率',
      desc: meta.desc || '',
      pinned: Boolean(meta.pinned),
      visits: Number(meta.visits) || 0,
      lastVisitedAt: Number(meta.lastVisitedAt) || 0
    };
  })
);

const categoryTabs = computed(() => {
  const counts = new Map();
  for (const cat of WEBSITE_CATEGORIES) {
    if (cat !== '全部') counts.set(cat, 0);
  }
  for (const item of enrichedLinks.value) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  return [
    { name: '全部', count: enrichedLinks.value.length },
    ...Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
  ];
});

const filteredLinks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const list = enrichedLinks.value.filter(item => {
    if (activeCategory.value !== '全部' && item.category !== activeCategory.value) return false;
    if (pinnedOnly.value && !item.pinned) return false;
    if (!q) return true;
    return (
      String(item.title || '').toLowerCase().includes(q) ||
      String(item.url || '').toLowerCase().includes(q) ||
      String(item.desc || '').toLowerCase().includes(q) ||
      String(item.category || '').toLowerCase().includes(q)
    );
  });
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.orderIndex - b.orderIndex);
});

const groupedSections = computed(() => {
  if (activeCategory.value !== '全部') {
    return [{ category: activeCategory.value, items: filteredLinks.value }];
  }
  const map = new Map();
  for (const item of filteredLinks.value) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category).push(item);
  }
  const order = WEBSITE_CATEGORIES.filter(c => c !== '全部');
  return Array.from(map.entries())
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([category, items]) => ({ category, items }));
});

const totalVisits = computed(() =>
  enrichedLinks.value.reduce((sum, item) => sum + (item.visits || 0), 0)
);
const pinnedCount = computed(() =>
  enrichedLinks.value.filter(item => item.pinned).length
);

const savedKeySet = computed(() =>
  new Set((wb.state.links || []).map(l => canonicalUrlKey(l.url)))
);
function isSavedSite(url) {
  return savedKeySet.value.has(canonicalUrlKey(url));
}

const catalogFiltered = computed(() => {
  if (catalogCat.value === '全部') return WEBSITE_CATALOG;
  return WEBSITE_CATALOG.filter(s => s.category === catalogCat.value);
});

function syncCurrentRoleSites() {
  wb.importWebsitePresets(getRolePresetLinks(wb.currentRole.value.id));
}

function importCatalogCategory() {
  const items = catalogCat.value === '全部'
    ? getRolePresetLinks(wb.currentRole.value.id)
    : catalogFiltered.value;
  wb.importWebsitePresets(items);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
function initialOf(link) {
  return ([...String(link.title || hostOf(link.url) || 'W').trim()][0] || 'W').toUpperCase();
}
</script>

<template>
  <div class="page-shell bookmarks-page">
    <header class="page-head">
      <div>
        <h1>网址导航与收藏库</h1>
        <p class="sub">按职业与场景自动沉淀常用站点，支持分组检索、置顶直达与访问计数。</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-soft btn-sm" type="button" @click="syncCurrentRoleSites">
          <img :src="asset('assets/icons/rotate-ccw.svg')" alt="" />
          同步「{{ wb.currentRole.value.name }}」网站
        </button>
        <button
          class="btn btn-soft btn-sm"
          :class="{ 'is-active-btn': catalogExpanded }"
          type="button"
          @click="catalogExpanded = !catalogExpanded"
        >
          <img :src="asset('assets/icons/book-open.svg')" alt="" />
          {{ catalogExpanded ? '收起预设网站库' : `精选网站库 (${WEBSITE_CATALOG.length})` }}
        </button>
        <button class="btn btn-primary btn-sm" type="button" @click="openEditor()">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新增书签
        </button>
      </div>
    </header>

    <!-- 汇总条 -->
    <section class="panel glass rim stats-strip">
      <div class="stat-cell">
        <small>已记录书签</small>
        <strong class="numeric">{{ enrichedLinks.length }}</strong>
      </div>
      <div class="stat-cell">
        <small>置顶常用</small>
        <strong class="numeric">{{ pinnedCount }}</strong>
      </div>
      <div class="stat-cell">
        <small>累计访问次数</small>
        <strong class="numeric">{{ totalVisits }}</strong>
      </div>
      <div class="stat-cell">
        <small>当前身份偏好</small>
        <strong>{{ wb.currentRole.value.presetCategory }}</strong>
      </div>
    </section>

    <!-- 新增 / 编辑书签表单 -->
    <section v-if="editorOpen" class="panel glass rim editor-panel">
      <div class="panel-head">
        <h2 class="panel-title">{{ form.id ? '编辑网址书签' : '新增网址书签' }}</h2>
        <button class="btn btn-ghost btn-sm" type="button" @click="editorOpen = false">收起</button>
      </div>
      <form class="editor-form" novalidate @submit.prevent="submitLink">
        <div class="form-grid">
          <label class="field">
            <span>网站名称</span>
            <input
              v-model="form.title"
              class="input"
              :class="{ 'is-invalid': formError && !form.title.trim() }"
              maxlength="80"
              placeholder="例如：GitHub、中国知网、Figma"
              @input="formError = ''"
            />
          </label>
          <label class="field">
            <span>访问网址</span>
            <input
              v-model="form.url"
              class="input"
              :class="{ 'is-invalid': formError && form.title.trim() }"
              type="url"
              maxlength="2000"
              placeholder="https://"
              @input="formError = ''"
            />
          </label>
          <label class="field">
            <span>归属分组</span>
            <select v-model="form.category" class="input">
              <option v-for="c in WEBSITE_CATEGORIES.filter(x => x !== '全部')" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <label class="field">
            <span>用途备注（可选）</span>
            <input v-model="form.desc" class="input" maxlength="120" placeholder="简述该网站在工作流中的用途" />
          </label>
        </div>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <div class="editor-foot">
          <label class="pin-check">
            <input v-model="form.pinned" type="checkbox" class="checkbox" />
            <span>置顶到分组最前</span>
          </label>
          <div class="editor-btns">
            <button class="btn btn-soft btn-sm" type="button" @click="editorOpen = false">取消</button>
            <button class="btn btn-primary btn-sm" type="submit">{{ form.id ? '保存修改' : '保存书签' }}</button>
          </div>
        </div>
      </form>
    </section>

    <!-- 精选网站库抽屉 -->
    <section v-if="catalogExpanded" class="panel glass rim catalog-panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">内置精选网站库</h2>
          <p class="panel-sub">涵盖研发、设计、学术、财税与效率工具，可按分类一键收录或单独加入。</p>
        </div>
        <button class="btn btn-soft btn-sm" type="button" @click="importCatalogCategory">
          {{ catalogCat === '全部' ? `导入「${wb.currentRole.value.name}」推荐` : `一键收录「${catalogCat}」` }}
        </button>
      </div>
      <div class="cat-tabs">
        <button
          v-for="cat in WEBSITE_CATEGORIES"
          :key="cat"
          type="button"
          class="cat-tab"
          :class="{ 'is-active': catalogCat === cat }"
          @click="catalogCat = cat"
        >
          {{ cat }}
        </button>
      </div>
      <div class="catalog-grid">
        <article v-for="site in catalogFiltered" :key="site.url" class="catalog-card">
          <div class="catalog-copy">
            <strong>{{ site.title }}</strong>
            <small>{{ site.category }} · {{ hostOf(site.url) }}</small>
            <p>{{ site.desc }}</p>
          </div>
          <button
            type="button"
            class="btn btn-xs"
            :class="isSavedSite(site.url) ? 'btn-ghost' : 'btn-soft'"
            :disabled="isSavedSite(site.url)"
            @click="wb.importWebsitePresets([site])"
          >
            {{ isSavedSite(site.url) ? '已收录' : '收录' }}
          </button>
        </article>
      </div>
    </section>

    <!-- 过滤与分组列表 -->
    <section class="panel glass rim">
      <div class="filter-bar">
        <div class="cat-tabs" role="tablist" aria-label="网站分类筛选">
          <button
            v-for="tab in categoryTabs"
            :key="tab.name"
            type="button"
            role="tab"
            class="cat-tab"
            :class="{ 'is-active': activeCategory === tab.name }"
            :aria-selected="activeCategory === tab.name"
            @click="activeCategory = tab.name"
          >
            {{ tab.name }}
            <span class="numeric">{{ tab.count }}</span>
          </button>
        </div>
        <div class="filter-right">
          <input
            v-model="searchQuery"
            class="input search-input"
            type="search"
            placeholder="搜索站名、域名或用途…"
            aria-label="搜索网址书签"
          />
          <button
            type="button"
            class="btn btn-sm"
            :class="pinnedOnly ? 'btn-primary' : 'btn-soft'"
            @click="pinnedOnly = !pinnedOnly"
          >
            {{ pinnedOnly ? '仅看置顶' : '全部书签' }}
          </button>
        </div>
      </div>

      <EmptyState
        v-if="!enrichedLinks.length"
        icon="tags"
        title="暂未收录任何网站"
        text="可同步当前职业推荐站点，或从精选网站库与「新增书签」构建专属导航。"
        action-label="同步当前职业推荐网站"
        @action="syncCurrentRoleSites"
      />
      <p v-else-if="!filteredLinks.length" class="empty-filter">
        当前筛选条件下没有匹配的网站书签。
      </p>
      <div v-else class="groups-wrap">
        <div v-for="section in groupedSections" :key="section.category" class="group-block">
          <div class="group-head">
            <h3>{{ section.category }}</h3>
            <span class="numeric">{{ section.items.length }} 项</span>
          </div>
          <div class="site-grid">
            <a
              v-for="link in section.items"
              :key="link.id"
              class="site-card"
              :class="{ 'is-pinned': link.pinned }"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              @click="wb.recordLinkVisit(link.url)"
            >
              <div class="site-card-top">
                <span class="site-initial" aria-hidden="true">{{ initialOf(link) }}</span>
                <div class="site-title-wrap">
                  <strong>{{ link.title }}</strong>
                  <small>{{ hostOf(link.url) }}<template v-if="link.visits > 0"> · 访问 {{ link.visits }} 次</template></small>
                </div>
                <span class="site-card-actions" @click.prevent.stop>
                  <button
                    class="btn-icon btn-xs"
                    type="button"
                    :title="link.pinned ? '取消置顶' : '置顶此网站'"
                    :aria-label="link.pinned ? '取消置顶' : '置顶此网站'"
                    @click.prevent.stop="wb.toggleLinkPin(link.url)"
                  >
                    <img class="pin-img" :class="{ 'is-pinned': link.pinned }" :src="asset('assets/icons/sparkles.svg')" alt="" />
                  </button>
                  <button
                    class="btn-icon btn-xs"
                    type="button"
                    title="编辑书签"
                    aria-label="编辑书签"
                    @click.prevent.stop="openEditor(link)"
                  >
                    <img :src="asset('assets/icons/pencil.svg')" alt="" />
                  </button>
                  <button
                    class="btn-icon btn-xs is-danger"
                    type="button"
                    title="删除书签"
                    aria-label="删除书签"
                    @click.prevent.stop="wb.removeLinkRecord(link.id)"
                  >
                    <img :src="asset('assets/icons/trash.svg')" alt="" />
                  </button>
                </span>
              </div>
              <p v-if="link.desc" class="site-desc">{{ link.desc }}</p>
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.is-active-btn { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); }

.stats-strip {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
  padding: 14px 18px;
}
.stat-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stat-cell + .stat-cell { padding-left: 14px; border-left: 1px solid var(--line); }
.stat-cell small { font-size: var(--text-meta); color: var(--muted); }
.stat-cell strong { font-size: 20px; font-weight: 750; letter-spacing: -.02em; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.editor-form { display: flex; flex-direction: column; gap: 12px; }
.editor-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pin-check { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--ink-soft); cursor: pointer; }
.editor-btns { display: flex; gap: 8px; margin-left: auto; }

.cat-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cat-tab {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 32px; padding: 0 11px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface-soft);
  color: var(--ink-soft); font-size: var(--text-sm); font-weight: 600;
  transition: border-color var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast);
}
.cat-tab:hover { border-color: var(--line-strong); color: var(--ink); }
.cat-tab.is-active {
  border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep);
}
.cat-tab span { font-size: 11px; opacity: .75; }

.catalog-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;
  margin-top: 12px; max-height: 300px; overflow-y: auto;
}
.catalog-card {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--surface-soft);
}
.catalog-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.catalog-copy strong { font-size: var(--text-sm); font-weight: 650; }
.catalog-copy small { font-size: 11px; color: var(--muted); }
.catalog-copy p { margin: 2px 0 0; font-size: 11.5px; color: var(--ink-soft); line-height: 1.4; }

.filter-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--line);
}
.filter-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.search-input { width: 220px; }
.empty-filter { padding: 24px 0; text-align: center; color: var(--muted); font-size: var(--text-sm); }

.groups-wrap { display: flex; flex-direction: column; gap: 20px; }
.group-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.group-head h3 { font-size: var(--text-md); font-weight: 700; color: var(--ink); margin: 0; }
.group-head span { font-size: var(--text-meta); color: var(--muted); }

.site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.site-card {
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--surface-soft);
  text-decoration: none; color: var(--ink);
  transition: transform var(--motion-fast), border-color var(--motion-fast), background-color var(--motion-fast);
}
.site-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--brand) 36%, var(--line));
  background: var(--surface);
}
.site-card.is-pinned {
  border-color: color-mix(in srgb, var(--brand) 32%, var(--line));
}
.site-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.site-initial {
  width: 34px; height: 34px; flex: 0 0 34px; border-radius: 9px;
  display: grid; place-items: center;
  background: var(--surface); border: 1px solid var(--line);
  font-size: var(--text-body); font-weight: 750; color: var(--brand-deep);
}
.site-title-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.site-title-wrap strong { font-size: var(--text-body); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.site-title-wrap small { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.site-desc { margin: 0; font-size: var(--text-meta); color: var(--ink-soft); line-height: 1.45; }
.site-card-actions { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity var(--motion-fast); }
.site-card:hover .site-card-actions, .site-card:focus-within .site-card-actions { opacity: 1; }
.pin-img { opacity: 0.45; transition: opacity var(--motion-fast); }
.pin-img.is-pinned { opacity: 1; }

@media (max-width: 820px) {
  .stats-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stat-cell:nth-child(3) { padding-left: 0; border-left: 0; }
  .search-input { width: 100%; flex: 1; }
  .site-card-actions { opacity: 1; }
}
</style>
