<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { asset } from '../lib/assets.js';
import { useWorkbench } from '../composables/useWorkbench.js';
import EmptyState from '../components/EmptyState.vue';

const wb = useWorkbench();

const MODE_LABELS = {
  all: '全部视图',
  milestone: '里程碑项目',
  client: '客户合同与回款',
  course: '课程与备考进度'
};
const STATUS_LABELS = {
  active: '进行中',
  done: '已达成',
  paused: '已搁置'
};

const activeMode = ref('all');
const createOpen = ref(false);
const formError = ref('');
const newMilestoneDrafts = reactive({});
const highlightedId = ref(null);
const editingProjectId = ref(null);
const editProjectForm = reactive({
  mode: 'milestone',
  name: '',
  meta: '',
  target: '',
  amount: '',
  deadline: ''
});
const editingMilestone = reactive({ projectId: null, milestoneId: null, text: '' });

const form = reactive({
  mode: wb.currentRole.value.defaultProjectMode || 'milestone',
  name: '',
  meta: '',
  target: '',
  amount: '',
  deadline: wb.todayStr.value,
  milestonesText: ''
});

function openCreate() {
  formError.value = '';
  form.mode = activeMode.value !== 'all' ? activeMode.value : (wb.currentRole.value.defaultProjectMode || 'milestone');
  form.name = '';
  form.meta = '';
  form.target = '';
  form.amount = '';
  form.deadline = wb.todayStr.value;
  form.milestonesText = '';
  createOpen.value = true;
}

function submitProject() {
  if (!form.name.trim()) {
    formError.value = '请填写项目、客户或课程名称';
    return;
  }
  formError.value = '';
  const milestones = form.milestonesText
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  const created = wb.addProject({
    mode: form.mode,
    name: form.name,
    meta: form.meta,
    target: form.target,
    amount: form.mode === 'client' ? Number(form.amount) || 0 : 0,
    deadline: form.deadline,
    milestones
  });
  if (created) {
    createOpen.value = false;
  }
}

const filteredProjects = computed(() => {
  const list = wb.projectsList.value || [];
  if (activeMode.value === 'all') return list;
  return list.filter(p => p.mode === activeMode.value);
});

const summaryStats = computed(() => {
  const list = wb.projectsList.value || [];
  let totalMilestones = 0;
  let doneMilestones = 0;
  let clientAmount = 0;
  for (const p of list) {
    totalMilestones += (p.milestones || []).length;
    doneMilestones += (p.milestones || []).filter(m => m.done).length;
    if (p.mode === 'client') clientAmount += Number(p.amount) || 0;
  }
  return {
    activeCount: list.filter(p => p.status === 'active').length,
    doneCount: list.filter(p => p.status === 'done').length,
    completionPct: totalMilestones ? Math.round((doneMilestones / totalMilestones) * 100) : 0,
    clientAmount
  };
});

function projectProgress(project) {
  const list = project.milestones || [];
  if (!list.length) return project.status === 'done' ? 100 : 0;
  const done = list.filter(m => m.done).length;
  return Math.round((done / list.length) * 100);
}

function addInlineMilestone(projectId) {
  const txt = String(newMilestoneDrafts[projectId] || '').trim();
  if (!txt) return;
  if (wb.addProjectMilestone(projectId, txt)) {
    newMilestoneDrafts[projectId] = '';
  }
}

function startEditProject(proj) {
  editingProjectId.value = proj.id;
  editProjectForm.mode = proj.mode || 'milestone';
  editProjectForm.name = proj.name || '';
  editProjectForm.meta = proj.meta || '';
  editProjectForm.target = proj.target || '';
  editProjectForm.amount = proj.amount ? String(proj.amount) : '';
  editProjectForm.deadline = proj.deadline || '';
}
function cancelEditProject() {
  editingProjectId.value = null;
}
function saveEditProject(projId) {
  if (!editProjectForm.name.trim()) {
    wb.showToast('项目名称不能为空');
    return;
  }
  const ok = wb.updateProject(projId, {
    mode: editProjectForm.mode,
    name: editProjectForm.name,
    meta: editProjectForm.meta,
    target: editProjectForm.target,
    amount: editProjectForm.mode === 'client' ? Number(editProjectForm.amount) || 0 : 0,
    deadline: editProjectForm.deadline
  });
  if (ok) {
    editingProjectId.value = null;
    wb.showToast('项目信息已更新');
  }
}

function startEditMilestone(projectId, ms) {
  editingMilestone.projectId = projectId;
  editingMilestone.milestoneId = ms.id;
  editingMilestone.text = ms.text || '';
}
function cancelEditMilestone() {
  editingMilestone.projectId = null;
  editingMilestone.milestoneId = null;
  editingMilestone.text = '';
}
function saveEditMilestone() {
  if (!editingMilestone.projectId || !editingMilestone.milestoneId) return;
  if (wb.editProjectMilestone(editingMilestone.projectId, editingMilestone.milestoneId, editingMilestone.text)) {
    cancelEditMilestone();
  }
}

async function applyFocusedProject(target) {
  if (!target || target.kind !== 'project' || !target.id) return;
  if (Date.now() - Number(target.ts || 0) > 10_000) return;
  activeMode.value = 'all';
  highlightedId.value = target.id;
  await nextTick();
  const el = document.getElementById(`project-card-${target.id}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

watch(() => wb.focusEntity.value, target => {
  applyFocusedProject(target);
});

onMounted(() => {
  applyFocusedProject(wb.focusEntity.value);
});
</script>

<template>
  <div class="page-shell projects-page">
    <header class="page-head">
      <div>
        <h1>{{ wb.currentRole.value.projectTermLabel || '项目与进度看板' }}</h1>
        <p class="sub">按项目里程碑、客户交付回款或课程备考拆分阶段节点，支持直接推送待办与回款入账。</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-soft btn-sm" type="button" @click="wb.seedRoleSampleProjects()">
          <img :src="asset('assets/icons/sparkles.svg')" alt="" />
          生成「{{ wb.currentRole.value.name }}」示例
        </button>
        <button class="btn btn-primary btn-sm" type="button" @click="openCreate">
          <img :src="asset('assets/icons/plus.svg')" alt="" />新建推进项
        </button>
      </div>
    </header>

    <section class="panel glass rim stats-strip">
      <div class="stat-cell">
        <small>进行中项目</small>
        <strong class="numeric">{{ summaryStats.activeCount }}</strong>
      </div>
      <div class="stat-cell">
        <small>已达成归档</small>
        <strong class="numeric">{{ summaryStats.doneCount }}</strong>
      </div>
      <div class="stat-cell">
        <small>节点整体达成率</small>
        <strong class="numeric">{{ summaryStats.completionPct }}%</strong>
      </div>
      <div class="stat-cell">
        <small>客户合同总额</small>
        <strong class="numeric">¥{{ summaryStats.clientAmount.toLocaleString() }}</strong>
      </div>
    </section>

    <section v-if="createOpen" class="panel glass rim">
      <div class="panel-head">
        <h2 class="panel-title">新建项目 / 客户合同 / 课程计划</h2>
        <button class="btn btn-ghost btn-sm" type="button" @click="createOpen = false">收起</button>
      </div>
      <form class="create-form" novalidate @submit.prevent="submitProject">
        <div class="form-grid">
          <label class="field">
            <span>看板类型</span>
            <select v-model="form.mode" class="input">
              <option value="milestone">里程碑项目（研发 / 设计 / 通用）</option>
              <option value="client">客户合同与回款（自由职业）</option>
              <option value="course">课程与备考进度（学术学习）</option>
            </select>
          </label>
          <label class="field">
            <span>{{ form.mode === 'client' ? '项目 / 客户名称' : form.mode === 'course' ? '课程 / 考试名称' : '项目名称' }}</span>
            <input
              v-model="form.name"
              class="input"
              :class="{ 'is-invalid': formError }"
              maxlength="80"
              placeholder="输入名称…"
              @input="formError = ''"
            />
          </label>
          <label class="field">
            <span>{{ form.mode === 'client' ? '结算规则 / 客户方' : form.mode === 'course' ? '学分 / 授课老师' : '技术栈 / 归属领域' }}</span>
            <input v-model="form.meta" class="input" maxlength="100" placeholder="例如：首付 40% + 尾款 60%" />
          </label>
          <label class="field">
            <span>目标日期</span>
            <input v-model="form.deadline" class="input" type="date" />
          </label>
          <label v-if="form.mode === 'client'" class="field">
            <span>合同金额 (¥)</span>
            <input v-model.number="form.amount" class="input numeric" type="number" min="0" placeholder="0" />
          </label>
          <label class="field">
            <span>交付标准 / 阶段目标</span>
            <input v-model="form.target" class="input" maxlength="140" placeholder="一句说清本阶段达成标准" />
          </label>
        </div>
        <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
        <label class="field">
          <span>拆解子节点（每行一个里程碑，选填）</span>
          <textarea
            v-model="form.milestonesText"
            class="input"
            rows="3"
            placeholder="例如：&#10;完成原型设计走查&#10;完成核心接口联调&#10;上线部署与复盘归档"
          ></textarea>
        </label>
        <div class="create-foot">
          <button class="btn btn-soft btn-sm" type="button" @click="createOpen = false">取消</button>
          <button class="btn btn-primary btn-sm" type="submit">确认创建</button>
        </div>
      </form>
    </section>

    <section class="panel glass rim">
      <div class="mode-bar">
        <div class="segmented">
          <button
            v-for="(label, key) in MODE_LABELS"
            :key="key"
            type="button"
            :class="{ 'is-active': activeMode === key }"
            @click="activeMode = key"
          >
            {{ label }}
          </button>
        </div>
      </div>

      <EmptyState
        v-if="!filteredProjects.length"
        icon="briefcase"
        title="当前视图下暂无推进项目"
        text="可新建项目里程碑、客户合同或学习课程，或一键加载当前身份示例模板体验。"
        action-label="生成示例项目"
        @action="wb.seedRoleSampleProjects()"
      />
      <div v-else class="project-grid">
        <article
          v-for="proj in filteredProjects"
          :id="`project-card-${proj.id}`"
          :key="proj.id"
          class="project-card"
          :class="{ 'is-highlighted': highlightedId === proj.id }"
        >
          <div class="proj-head">
            <div class="proj-title-block">
              <div class="proj-kicker">
                <span>{{ MODE_LABELS[proj.mode] }}</span>
                <template v-if="proj.meta"><span>·</span><span>{{ proj.meta }}</span></template>
                <template v-if="proj.deadline"><span>·</span><time class="numeric">截止 {{ proj.deadline }}</time></template>
              </div>
              <h3>{{ proj.name }}</h3>
              <p v-if="proj.target" class="proj-target">{{ proj.target }}</p>
            </div>
            <div class="proj-head-actions">
              <select
                class="input status-select"
                :value="proj.status"
                aria-label="项目状态"
                @change="wb.updateProject(proj.id, { status: $event.target.value })"
              >
                <option v-for="(sLabel, sKey) in STATUS_LABELS" :key="sKey" :value="sKey">{{ sLabel }}</option>
              </select>
              <button
                class="btn-icon btn-xs"
                type="button"
                title="编辑项目信息"
                aria-label="编辑项目信息"
                @click="editingProjectId === proj.id ? cancelEditProject() : startEditProject(proj)"
              >
                <img :src="asset('assets/icons/pencil.svg')" alt="" />
              </button>
              <button class="btn-icon btn-xs is-danger" type="button" title="删除项目" @click="wb.deleteProject(proj.id)">
                <img :src="asset('assets/icons/trash.svg')" alt="删除" />
              </button>
            </div>
          </div>

          <form v-if="editingProjectId === proj.id" class="proj-edit-form" @submit.prevent="saveEditProject(proj.id)">
            <div class="form-grid">
              <label class="field">
                <span>名称</span>
                <input v-model="editProjectForm.name" class="input" maxlength="80" />
              </label>
              <label class="field">
                <span>类型</span>
                <select v-model="editProjectForm.mode" class="input">
                  <option value="milestone">里程碑项目</option>
                  <option value="client">客户合同与回款</option>
                  <option value="course">课程与备考进度</option>
                </select>
              </label>
              <label class="field">
                <span>补充属性</span>
                <input v-model="editProjectForm.meta" class="input" maxlength="100" />
              </label>
              <label class="field">
                <span>目标日期</span>
                <input v-model="editProjectForm.deadline" class="input" type="date" />
              </label>
              <label v-if="editProjectForm.mode === 'client'" class="field">
                <span>合同金额 (¥)</span>
                <input v-model.number="editProjectForm.amount" class="input numeric" type="number" min="0" />
              </label>
              <label class="field">
                <span>阶段目标</span>
                <input v-model="editProjectForm.target" class="input" maxlength="140" />
              </label>
            </div>
            <div class="create-foot">
              <button class="btn btn-soft btn-xs" type="button" @click="cancelEditProject">取消</button>
              <button class="btn btn-primary btn-xs" type="submit">保存项目</button>
            </div>
          </form>

          <div class="progress-block">
            <div class="progress-head numeric">
              <span>进度 {{ projectProgress(proj) }}%（{{ (proj.milestones || []).filter(m => m.done).length }}/{{ (proj.milestones || []).length }} 节点）</span>
              <strong v-if="proj.mode === 'client' && proj.amount > 0">合同 ¥{{ proj.amount.toLocaleString() }}</strong>
            </div>
            <div class="progress-track">
              <i :style="{ width: `${projectProgress(proj)}%` }"></i>
            </div>
          </div>

          <ul v-if="(proj.milestones || []).length" class="ms-list">
            <li v-for="ms in proj.milestones" :key="ms.id" class="ms-row" :class="{ 'is-done': ms.done }">
              <template v-if="editingMilestone.projectId === proj.id && editingMilestone.milestoneId === ms.id">
                <input
                  v-model="editingMilestone.text"
                  class="input ms-edit-input"
                  maxlength="120"
                  @keydown.enter.prevent="saveEditMilestone"
                  @keydown.esc.prevent="cancelEditMilestone"
                />
                <div class="ms-actions">
                  <button class="btn btn-primary btn-xs" type="button" @click="saveEditMilestone">保存</button>
                  <button class="btn btn-soft btn-xs" type="button" @click="cancelEditMilestone">取消</button>
                </div>
              </template>
              <template v-else>
                <label class="ms-check">
                  <input
                    type="checkbox"
                    class="checkbox"
                    :checked="ms.done"
                    @change="wb.toggleProjectMilestone(proj.id, ms.id)"
                  />
                  <span>{{ ms.text }}</span>
                </label>
                <div class="ms-actions">
                  <button
                    v-if="!ms.done"
                    class="btn btn-text btn-xs"
                    type="button"
                    title="将该节点推送为今日高优待办"
                    @click="wb.pushMilestoneToTodo(proj, ms)"
                  >
                    推送待办
                  </button>
                  <button
                    class="btn-icon btn-xs"
                    type="button"
                    title="编辑节点"
                    aria-label="编辑节点"
                    @click="startEditMilestone(proj.id, ms)"
                  >
                    <img :src="asset('assets/icons/pencil.svg')" alt="" />
                  </button>
                  <button
                    class="btn-icon btn-xs is-danger"
                    type="button"
                    title="移除节点"
                    @click="wb.deleteProjectMilestone(proj.id, ms.id)"
                  >
                    <img :src="asset('assets/icons/x.svg')" alt="" />
                  </button>
                </div>
              </template>
            </li>
          </ul>

          <form class="ms-add-form" @submit.prevent="addInlineMilestone(proj.id)">
            <input
              v-model="newMilestoneDrafts[proj.id]"
              class="input ms-input"
              maxlength="120"
              placeholder="新增阶段节点或里程碑，回车确认…"
            />
            <button class="btn btn-soft btn-sm" type="submit">添加节点</button>
            <button
              v-if="proj.mode === 'client' && proj.amount > 0"
              class="btn btn-sm"
              :class="proj.paidRecorded ? 'btn-soft' : 'btn-primary'"
              type="button"
              :disabled="proj.paidRecorded"
              @click="wb.recordProjectPaymentToLedger(proj, proj.amount, '项目结算')"
            >
              {{ proj.paidRecorded ? '已全额入账' : '全额入账' }}
            </button>
          </form>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.stats-strip {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
  padding: 14px 18px;
}
.stat-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stat-cell + .stat-cell { padding-left: 14px; border-left: 1px solid var(--line); }
.stat-cell small { font-size: var(--text-meta); color: var(--muted); }
.stat-cell strong { font-size: 20px; font-weight: 750; letter-spacing: -.02em; color: var(--ink); }

.create-form { display: flex; flex-direction: column; gap: 12px; }
.create-foot { display: flex; justify-content: flex-end; gap: 8px; }
.mode-bar { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }

.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
.project-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px 18px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--surface-soft);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.project-card.is-highlighted {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-pale);
}
.proj-edit-form {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; border-radius: 10px;
  border: 1px solid var(--line-strong); background: var(--surface);
}
.ms-edit-input { flex: 1; min-width: 0; min-height: 30px; font-size: var(--text-sm); }
.proj-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.proj-title-block { min-width: 0; flex: 1; }
.proj-kicker { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); margin-bottom: 4px; }
.proj-title-block h3 { margin: 0; font-size: var(--text-md); font-weight: 750; color: var(--ink); }
.proj-target { margin: 4px 0 0; font-size: var(--text-sm); color: var(--ink-soft); line-height: 1.5; }
.proj-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.status-select { min-height: 30px; padding: 2px 8px; font-size: 12px; width: auto; }

.progress-block { display: flex; flex-direction: column; gap: 6px; }
.progress-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); }
.progress-head strong { color: var(--brand-deep); }
.progress-track { height: 6px; border-radius: 99px; background: var(--surface); overflow: hidden; border: 1px solid var(--line); }
.progress-track i { display: block; height: 100%; border-radius: inherit; background: var(--brand); transition: width var(--motion-base); }

.ms-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ms-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 10px; border-radius: 9px; background: var(--surface); border: 1px solid var(--line);
}
.ms-check { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--ink); cursor: pointer; flex: 1; min-width: 0; }
.ms-row.is-done .ms-check span { text-decoration: line-through; color: var(--muted); }
.ms-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

.ms-add-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ms-input { flex: 1; min-width: 160px; min-height: 32px; font-size: var(--text-sm); }

@media (max-width: 820px) {
  .stats-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stat-cell:nth-child(3) { padding-left: 0; border-left: 0; }
  .project-grid { grid-template-columns: 1fr; }
}
</style>
