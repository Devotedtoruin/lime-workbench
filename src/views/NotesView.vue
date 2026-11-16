<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import { NOTE_FOLDERS, NOTE_TEMPLATES } from '../../js/roles.js';
import { renderMarkdownSafe, noteWordStats } from '../../js/markdown.js';
import EmptyState from '../components/EmptyState.vue';

const wb = useWorkbench();

const activeFolder = ref('全部');
const query = ref('');
const selectedId = ref(wb.state.notes?.[0]?.id ?? null);
const viewMode = ref('split'); // 'edit' | 'split' | 'preview'
const titleError = ref('');

const draft = reactive({
  id: null,
  title: '',
  folder: '工作复盘',
  pinned: false,
  body: ''
});
const loadedSnapshot = reactive({
  id: null,
  title: '',
  folder: '工作复盘',
  pinned: false,
  body: ''
});

function syncSnapshot() {
  loadedSnapshot.id = draft.id;
  loadedSnapshot.title = draft.title;
  loadedSnapshot.folder = draft.folder;
  loadedSnapshot.pinned = draft.pinned;
  loadedSnapshot.body = draft.body;
}

const isDirty = computed(() => (
  draft.id !== loadedSnapshot.id ||
  draft.title !== loadedSnapshot.title ||
  draft.folder !== loadedSnapshot.folder ||
  draft.pinned !== loadedSnapshot.pinned ||
  draft.body !== loadedSnapshot.body
));

function loadIntoDraft(note) {
  titleError.value = '';
  if (!note) {
    draft.id = null;
    draft.title = '';
    draft.folder = activeFolder.value !== '全部' ? activeFolder.value : '工作复盘';
    draft.pinned = false;
    draft.body = '';
    syncSnapshot();
    return;
  }
  const meta = wb.getNoteMeta(note.id);
  draft.id = note.id;
  draft.title = note.title || '';
  draft.folder = meta.folder || '工作复盘';
  draft.pinned = Boolean(meta.pinned);
  draft.body = note.body || '';
  syncSnapshot();
}

function flushDirtyDraft() {
  if (!isDirty.value) return false;
  const hasContent = Boolean(draft.id || draft.title.trim() || draft.body.trim());
  if (!hasContent) return false;
  const title = draft.title.trim() || '未命名笔记';
  const savedId = wb.saveNoteRecord({
    id: draft.id,
    title,
    body: draft.body,
    folder: draft.folder,
    pinned: draft.pinned
  });
  if (savedId) {
    if (typeof savedId === 'number') draft.id = savedId;
    draft.title = title;
    syncSnapshot();
    return true;
  }
  return false;
}

const enrichedNotes = computed(() =>
  (wb.state.notes || []).map(note => {
    const meta = wb.getNoteMeta(note.id);
    return {
      ...note,
      folder: meta.folder || '工作复盘',
      pinned: Boolean(meta.pinned)
    };
  })
);

const folderCounts = computed(() => {
  const map = new Map(NOTE_FOLDERS.map(f => [f, 0]));
  for (const n of enrichedNotes.value) {
    map.set(n.folder, (map.get(n.folder) || 0) + 1);
  }
  return [
    { name: '全部', count: enrichedNotes.value.length },
    ...Array.from(map.entries()).map(([name, count]) => ({ name, count }))
  ];
});

const filteredNotes = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = enrichedNotes.value.filter(n => {
    if (activeFolder.value !== '全部' && n.folder !== activeFolder.value) return false;
    if (!q) return true;
    return (
      String(n.title || '').toLowerCase().includes(q) ||
      String(n.body || '').toLowerCase().includes(q) ||
      String(n.folder || '').toLowerCase().includes(q)
    );
  });
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
});

watch(filteredNotes, list => {
  if (!list.length) {
    if (draft.id !== null) loadIntoDraft(null);
    return;
  }
  const found = list.find(n => n.id === selectedId.value);
  if (!found && !draft.id && !draft.title && !draft.body) {
    selectedId.value = list[0].id;
    loadIntoDraft(list[0]);
  }
}, { immediate: true });

function applyFocusedNote(target) {
  if (!target || target.kind !== 'note' || !target.id) return;
  if (Date.now() - Number(target.ts || 0) > 10_000) return;
  const hit = enrichedNotes.value.find(n => String(n.id) === String(target.id));
  if (!hit) return;
  flushDirtyDraft();
  activeFolder.value = '全部';
  query.value = '';
  selectedId.value = hit.id;
  loadIntoDraft(hit);
}

watch(() => wb.focusEntity.value, target => {
  applyFocusedNote(target);
});

onMounted(() => {
  if (wb.focusEntity.value?.kind === 'note' && wb.focusEntity.value?.id && Date.now() - Number(wb.focusEntity.value.ts || 0) <= 10_000) {
    applyFocusedNote(wb.focusEntity.value);
  } else if (selectedId.value) {
    const initial = enrichedNotes.value.find(n => n.id === selectedId.value);
    if (initial) loadIntoDraft(initial);
  }
  window.addEventListener('keydown', onSaveHotkey);
});
onBeforeUnmount(() => {
  flushDirtyDraft();
  window.removeEventListener('keydown', onSaveHotkey);
});

function onSaveHotkey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCurrentNote();
  }
}

function selectNote(note) {
  if (note.id === draft.id) return;
  if (flushDirtyDraft()) wb.showToast('已自动保存上一篇修改');
  selectedId.value = note.id;
  loadIntoDraft(note);
}

function createNewBlank() {
  if (flushDirtyDraft()) wb.showToast('已自动保存上一篇修改');
  selectedId.value = null;
  loadIntoDraft(null);
}

function createFromTemplate(tpl) {
  if (flushDirtyDraft()) wb.showToast('已自动保存上一篇修改');
  selectedId.value = null;
  titleError.value = '';
  draft.id = null;
  draft.title = tpl.title;
  draft.folder = tpl.folder;
  draft.pinned = false;
  draft.body = tpl.body;
  syncSnapshot();
  activeFolder.value = '全部';
}

function saveCurrentNote() {
  const title = draft.title.trim();
  if (!title) {
    titleError.value = '请填写笔记标题';
    return false;
  }
  titleError.value = '';
  const savedId = wb.saveNoteRecord({
    id: draft.id,
    title,
    body: draft.body,
    folder: draft.folder,
    pinned: draft.pinned
  });
  if (savedId) {
    if (typeof savedId === 'number') {
      draft.id = savedId;
      selectedId.value = savedId;
    }
    syncSnapshot();
    wb.showToast('笔记已保存至知识库');
    return true;
  }
  return false;
}

function removeSelectedNote(note) {
  wb.removeNoteRecord(note.id);
  if (selectedId.value === note.id) {
    selectedId.value = null;
    loadIntoDraft(null);
  }
}

function exportMarkdown() {
  const title = draft.title.trim() || '未命名笔记';
  const content = `# ${title}\n\n${draft.body || ''}`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  wb.showToast('已导出 Markdown 文件');
}

const wordStats = computed(() => noteWordStats(draft.body));
const renderedPreview = computed(() => renderMarkdownSafe(draft.body));

function formatTime(ts) {
  if (!ts) return '刚刚';
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="page-shell notes-page">
    <header class="page-head">
      <div>
        <h1>知识笔记库</h1>
        <p class="sub">分笔记本整理复盘、技术沉淀与文献卡片，支持 Markdown 实时渲染与首页便签双向同步。</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary btn-sm" type="button" @click="createNewBlank">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新建空白笔记
        </button>
      </div>
    </header>

    <div class="notes-workspace">
      <!-- 左栏：笔记本分组与快速模板 -->
      <aside class="panel glass rim folders-pane">
        <p class="pane-label">笔记本分组</p>
        <div class="folder-list">
          <button
            v-for="f in folderCounts"
            :key="f.name"
            type="button"
            class="folder-btn"
            :class="{ 'is-active': activeFolder === f.name }"
            @click="activeFolder = f.name"
          >
            <span>{{ f.name }}</span>
            <small class="numeric">{{ f.count }}</small>
          </button>
        </div>

        <p class="pane-label pane-label-spaced">结构化模板</p>
        <div class="template-list">
          <button
            v-for="tpl in NOTE_TEMPLATES"
            :key="tpl.id"
            type="button"
            class="tpl-btn"
            @click="createFromTemplate(tpl)"
          >
            <strong>{{ tpl.label }}</strong>
            <small>{{ tpl.folder }}</small>
          </button>
        </div>
      </aside>

      <!-- 中栏：笔记检索列表 -->
      <section class="panel glass rim list-pane">
        <div class="list-search">
          <input
            v-model="query"
            class="input"
            type="search"
            placeholder="检索标题或正文关键词…"
            aria-label="检索笔记"
          />
        </div>

        <EmptyState
          v-if="!filteredNotes.length"
          icon="book-open"
          title="当前分组暂无笔记"
          text="从左侧选择模板快速新建，或点击「新建空白笔记」。"
          action-label="新建笔记"
          @action="createNewBlank"
        />
        <div v-else class="note-list">
          <article
            v-for="note in filteredNotes"
            :key="note.id"
            class="note-row"
            :class="{ 'is-selected': selectedId === note.id }"
            @click="selectNote(note)"
          >
            <div class="note-row-top">
              <strong>{{ note.title }}</strong>
              <span class="note-row-actions" @click.stop>
                <button
                  class="btn-icon btn-xs"
                  type="button"
                  :title="note.pinned ? '取消置顶' : '置顶'"
                  @click="wb.toggleNotePin(note.id)"
                >
                  <img :src="asset('assets/icons/sparkles.svg')" alt="" class="pin-img" :class="{ 'is-pinned': note.pinned }" />
                </button>
                <button
                  class="btn-icon btn-xs is-danger"
                  type="button"
                  title="删除笔记"
                  @click="removeSelectedNote(note)"
                >
                  <img :src="asset('assets/icons/trash.svg')" alt="" />
                </button>
              </span>
            </div>
            <p class="note-row-excerpt">{{ (note.body || '暂无正文').slice(0, 56) }}</p>
            <div class="note-row-meta">
              <span>{{ note.folder }}</span>
              <span>·</span>
              <time class="numeric">{{ formatTime(note.updatedAt || note.createdAt) }}</time>
            </div>
          </article>
        </div>
      </section>

      <!-- 右栏：Markdown 编辑器与实时预览 -->
      <section class="panel glass rim editor-pane">
        <div class="editor-toolbar">
          <div class="editor-title-group">
            <input
              v-model="draft.title"
              class="input title-input"
              :class="{ 'is-invalid': titleError }"
              maxlength="120"
              placeholder="输入笔记标题…"
              @input="titleError = ''"
            />
            <p v-if="titleError" class="field-error" role="alert">{{ titleError }}</p>
          </div>
          <div class="editor-controls">
            <select v-model="draft.folder" class="input folder-select" aria-label="选择笔记本分组">
              <option v-for="f in NOTE_FOLDERS" :key="f" :value="f">{{ f }}</option>
            </select>
            <div class="segmented">
              <button type="button" :class="{ 'is-active': viewMode === 'edit' }" @click="viewMode = 'edit'">编辑</button>
              <button type="button" :class="{ 'is-active': viewMode === 'split' }" @click="viewMode = 'split'">分栏</button>
              <button type="button" :class="{ 'is-active': viewMode === 'preview' }" @click="viewMode = 'preview'">阅读</button>
            </div>
          </div>
        </div>

        <div class="editor-body-wrap" :class="`mode-${viewMode}`">
          <textarea
            v-if="viewMode === 'edit' || viewMode === 'split'"
            v-model="draft.body"
            class="input md-textarea"
            maxlength="5000"
            placeholder="支持 # 标题、**加粗**、`代码`、- [ ] 任务清单、> 引用、[链接](https://...) 等 Markdown 语法…"
          ></textarea>
          <div
            v-if="viewMode === 'preview' || viewMode === 'split'"
            class="md-preview"
            v-html="renderedPreview"
          ></div>
        </div>

        <footer class="editor-statusbar">
          <span class="numeric status-stats">
            {{ wordStats.chars }} 字 · {{ wordStats.lines }} 行 · 约 {{ wordStats.readMinutes }} 分钟阅读
            <em class="sync-flag" :class="{ 'is-dirty': isDirty }">{{ isDirty ? '未保存修改' : (draft.id ? '已同步' : '草稿') }}</em>
          </span>
          <div class="status-actions">
            <button class="btn btn-soft btn-sm" type="button" @click="wb.copyText(`# ${draft.title}\n\n${draft.body}`)">
              <img :src="asset('assets/icons/copy.svg')" alt="" />复制 Markdown
            </button>
            <button class="btn btn-soft btn-sm" type="button" @click="exportMarkdown">
              <img :src="asset('assets/icons/download.svg')" alt="" />导出 .md
            </button>
            <button class="btn btn-primary btn-sm" type="button" @click="saveCurrentNote">
              <img :src="asset('assets/icons/check.svg')" alt="" />{{ draft.id ? '保存修改' : '保存到知识库' }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.notes-workspace {
  display: grid;
  grid-template-columns: 200px 280px minmax(0, 1fr);
  gap: var(--shell-gap);
  align-items: stretch;
  min-height: 620px;
}
.folders-pane, .list-pane, .editor-pane {
  display: flex; flex-direction: column; min-width: 0;
}
.pane-label {
  margin: 0 0 8px; font-size: var(--text-2xs); font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
}
.pane-label-spaced { margin-top: 16px; }
.pin-img { opacity: .4; transition: opacity var(--motion-fast); }
.pin-img.is-pinned { opacity: 1; }
.status-stats { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sync-flag { font-style: normal; font-size: 11px; color: var(--muted); }
.sync-flag.is-dirty { color: var(--amber); font-weight: 650; }
.folder-list, .template-list { display: flex; flex-direction: column; gap: 4px; }
.folder-btn {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 34px; padding: 0 10px; border-radius: 8px;
  border: 1px solid transparent; background: transparent;
  color: var(--ink-soft); font-size: var(--text-sm); font-weight: 600;
}
.folder-btn:hover { background: var(--surface-soft); color: var(--ink); }
.folder-btn.is-active { background: var(--brand-pale); color: var(--brand-deep); border-color: color-mix(in srgb, var(--brand) 25%, transparent); }
.folder-btn small { font-size: 11px; color: var(--muted); }

.tpl-btn {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 32px; padding: 0 10px; border-radius: 8px;
  border: 1px dashed var(--line-strong); background: var(--surface-soft);
  color: var(--ink-soft); font-size: 12px;
}
.tpl-btn:hover { border-color: var(--brand); background: var(--brand-pale); color: var(--brand-deep); }
.tpl-btn strong { font-weight: 600; }
.tpl-btn small { font-size: 10.5px; color: var(--muted); }

.list-search { margin-bottom: 10px; }
.note-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 540px; }
.note-row {
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface-soft);
  transition: border-color var(--motion-fast), background-color var(--motion-fast);
}
.note-row:hover { background: var(--surface); border-color: var(--line-strong); }
.note-row.is-selected {
  border-color: var(--brand); background: var(--brand-pale);
}
.note-row-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.note-row-top strong { font-size: var(--text-sm); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note-row-actions { display: flex; gap: 2px; flex-shrink: 0; }
.note-row-excerpt { margin: 4px 0; font-size: 12px; color: var(--muted); line-height: 1.45; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note-row-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }

.editor-toolbar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding-bottom: 12px; border-bottom: 1px solid var(--line);
}
.editor-title-group { flex: 1; min-width: 220px; }
.title-input { font-size: var(--text-md); font-weight: 700; }
.editor-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.folder-select { width: 128px; }

.editor-body-wrap {
  flex: 1; display: grid; gap: 12px; margin: 12px 0; min-height: 410px;
}
.editor-body-wrap.mode-split { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.editor-body-wrap.mode-edit, .editor-body-wrap.mode-preview { grid-template-columns: 1fr; }

.md-textarea {
  resize: none; height: 100%; min-height: 400px;
  font-family: var(--font-numeric); line-height: 1.65;
}
.md-preview {
  padding: 14px 16px; border-radius: var(--radius-control);
  border: 1px solid var(--line); background: var(--surface-soft);
  overflow-y: auto; max-height: 480px; line-height: 1.7; font-size: var(--text-body);
}
.md-preview :deep(h1), .md-preview :deep(h2), .md-preview :deep(h3), .md-preview :deep(h4) {
  margin: 14px 0 6px; font-weight: 750; color: var(--ink);
}
.md-preview :deep(h1:first-child), .md-preview :deep(h2:first-child) { margin-top: 0; }
.md-preview :deep(p) { margin: 6px 0; color: var(--ink-soft); }
.md-preview :deep(ul), .md-preview :deep(ol) { margin: 6px 0 8px 18px; color: var(--ink-soft); }
.md-preview :deep(ul.md-task-list) { list-style: none; margin-left: 0; padding-left: 0; }
.md-preview :deep(ul.md-task-list li) { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.md-preview :deep(.md-check) {
  width: 16px; height: 16px; display: inline-grid; place-items: center;
  border-radius: 4px; border: 1px solid var(--line-strong); font-size: 11px;
}
.md-preview :deep(li.is-checked .md-check) { background: var(--brand); border-color: var(--brand); color: #fff; }
.md-preview :deep(li.is-checked span:last-child) { text-decoration: line-through; color: var(--muted); }
.md-preview :deep(blockquote) {
  margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--brand);
  background: var(--surface); color: var(--muted); border-radius: 0 8px 8px 0;
}
.md-preview :deep(pre) {
  margin: 8px 0; padding: 10px 12px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--line);
  overflow-x: auto; font-size: 12px;
}
.md-preview :deep(code) { font-family: var(--font-numeric); background: var(--surface); padding: 1px 5px; border-radius: 4px; }
.md-preview :deep(a) { color: var(--brand-deep); text-decoration: underline; }
.md-preview :deep(.md-empty) { color: var(--muted); }

.editor-statusbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding-top: 10px; border-top: 1px solid var(--line);
  font-size: var(--text-meta); color: var(--muted);
}
.status-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }

@media (max-width: 1100px) {
  .notes-workspace { grid-template-columns: 1fr; }
  .note-list { max-height: 240px; }
  .editor-body-wrap.mode-split { grid-template-columns: 1fr; }
}
</style>
