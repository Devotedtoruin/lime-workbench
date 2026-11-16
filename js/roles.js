// Pure multi-role identity profiles, website presets, and notebook templates.
// Keeps role definitions and frame/module mappings pure and testable without DOM dependencies.

export const ROLE_IDS = Object.freeze([
  'general',
  'developer',
  'creator',
  'student',
  'freelance'
]);

export const ALL_NAV_PAGES = Object.freeze([
  'home',
  'todo',
  'projects',
  'study',
  'standup',
  'calendar',
  'bookmarks',
  'notes',
  'toolbox',
  'ledger',
  'habits',
  'sport',
  'weather',
  'me'
]);

export const WEBSITE_CATEGORIES = Object.freeze([
  '全部',
  '开发研发',
  '设计创意',
  '学术学习',
  '财务经营',
  '通用效率'
]);

export const WEBSITE_CATALOG = Object.freeze([
  // 开发研发
  { title: 'GitHub', url: 'https://github.com', category: '开发研发', desc: '代码托管与开源协作平台', roles: ['developer', 'creator'] },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org', category: '开发研发', desc: 'Web API 与前端标准权威文档', roles: ['developer'] },
  { title: 'Vue.js 中文文档', url: 'https://cn.vuejs.org', category: '开发研发', desc: '渐进式 JavaScript 框架文档', roles: ['developer'] },
  { title: 'TypeScript 手册', url: 'https://www.typescriptlang.org', category: '开发研发', desc: '类型系统与语言规范手册', roles: ['developer'] },
  { title: 'Can I use', url: 'https://caniuse.com', category: '开发研发', desc: '浏览器特性兼容性即时查询', roles: ['developer'] },
  { title: 'Vite 官方文档', url: 'https://cn.vitejs.dev', category: '开发研发', desc: '下一代前端构建工具指南', roles: ['developer'] },
  { title: 'RegExr 正则调试', url: 'https://regexr.com', category: '开发研发', desc: '正则表达式语法与在线匹配', roles: ['developer'] },

  // 设计创意
  { title: 'Figma', url: 'https://www.figma.com', category: '设计创意', desc: '在线界面设计与原型协作工具', roles: ['creator', 'developer'] },
  { title: 'Excalidraw', url: 'https://excalidraw.com', category: '设计创意', desc: '手绘风格架构图与白板草图', roles: ['creator', 'developer', 'general'] },
  { title: 'Icones 图标库', url: 'https://icones.js.org', category: '设计创意', desc: '海量开源矢量图标一站检索', roles: ['creator', 'developer'] },
  { title: 'Dribbble', url: 'https://dribbble.com', category: '设计创意', desc: 'UI 与交互设计灵感社区', roles: ['creator'] },
  { title: '即时设计', url: 'https://js.design', category: '设计创意', desc: '中文在线 UI 设计与切图交付', roles: ['creator'] },
  { title: 'Realtime Colors', url: 'https://www.realtimecolors.com', category: '设计创意', desc: '网页配色方案实时预览对比', roles: ['creator'] },
  { title: 'Awwwards', url: 'https://www.awwwards.com', category: '设计创意', desc: '全球网页排版与交互佳作索引', roles: ['creator'] },

  // 学术学习
  { title: 'Semantic Scholar', url: 'https://www.semanticscholar.org', category: '学术学习', desc: '学术论文检索与引文关系图谱', roles: ['student'] },
  { title: 'arXiv 预印本库', url: 'https://arxiv.org', category: '学术学习', desc: '计算机、数学与物理论文预印本', roles: ['student', 'developer'] },
  { title: '中国知网 CNKI', url: 'https://www.cnki.net', category: '学术学习', desc: '中文期刊论文与硕博学位文献库', roles: ['student'] },
  { title: 'WolframAlpha', url: 'https://www.wolframalpha.com', category: '学术学习', desc: '符号计算、微积分与科学知识引擎', roles: ['student'] },
  { title: 'DeepL 翻译', url: 'https://www.deepl.com', category: '学术学习', desc: '高精度外文文献与长句段落翻译', roles: ['student', 'general', 'creator'] },
  { title: 'GitHub Education', url: 'https://education.github.com', category: '学术学习', desc: '高校学生开发者工具与学术包', roles: ['student'] },
  { title: 'Zotero 文档', url: 'https://www.zotero.org', category: '学术学习', desc: '开源文献管理与引文插件生态', roles: ['student'] },

  // 财务经营
  { title: '国家税务总局', url: 'https://www.chinatax.gov.cn', category: '财务经营', desc: '个税与企业税务政策申报入口', roles: ['freelance'] },
  { title: '全国发票查验平台', url: 'https://inv-veri.chinatax.gov.cn', category: '财务经营', desc: '增值税电子发票真伪官方核验', roles: ['freelance', 'general'] },
  { title: '中国外汇交易中心', url: 'https://www.chinamoney.com.cn', category: '财务经营', desc: '人民币汇率中间价与市场参考', roles: ['freelance'] },
  { title: '国家企业信用公示', url: 'https://www.gsxt.gov.cn', category: '财务经营', desc: '客户与合作方工商资质核查', roles: ['freelance'] },
  { title: 'Notion 工作区', url: 'https://www.notion.so', category: '财务经营', desc: '客户合同归档与项目文档协作', roles: ['freelance', 'creator', 'general'] },
  { title: 'Stripe Docs', url: 'https://docs.stripe.com', category: '财务经营', desc: '独立产品全球订阅与收款开发文档', roles: ['freelance', 'developer'] },

  // 通用效率
  { title: '中国政府网', url: 'https://www.gov.cn', category: '通用效率', desc: '法定节假日安排与公共政务查询', roles: ['general', 'freelance'] },
  { title: 'PairDrop 局域传', url: 'https://pairdrop.net', category: '通用效率', desc: '电脑与手机局域网免登录传文件', roles: ['general', 'developer', 'student'] },
  { title: 'TinyPNG 图像压缩', url: 'https://tinypng.com', category: '通用效率', desc: '无损画质减小图片体积', roles: ['general', 'creator', 'developer'] },
  { title: 'Squoosh 格式转换', url: 'https://squoosh.app', category: '通用效率', desc: '浏览器端离线图片压缩与转换', roles: ['general', 'creator'] },
  { title: '草料二维码', url: 'https://cli.im', category: '通用效率', desc: '网址文本转二维码与扫码测试', roles: ['general', 'creator', 'freelance'] }
]);

export const NOTE_FOLDERS = Object.freeze([
  '工作复盘',
  '技术沉淀',
  '会议纪要',
  '读书卡片',
  '灵感草稿'
]);

export const NOTE_TEMPLATES = Object.freeze([
  {
    id: 'meeting',
    label: '会议纪要',
    folder: '会议纪要',
    title: '项目对齐会议纪要',
    body: '## 会议目标\n- 明确本阶段交付范围与里程碑节点\n\n## 核心结论\n1. \n2. \n\n## 待办与负责人\n- [ ] 确认接口字段文档\n- [ ] 输出初版设计走查清单\n'
  },
  {
    id: 'tech',
    label: '技术复盘',
    folder: '技术沉淀',
    title: '问题排查与技术复盘',
    body: '## 现象描述\n> 简述报错表现或性能瓶颈\n\n## 根因定位\n- \n\n## 修复与长效防线\n- [ ] 补充单元测试回归\n- [ ] 更新团队开发规范\n'
  },
  {
    id: 'reading',
    label: '读书卡片',
    folder: '读书卡片',
    title: '文献 / 读书摘要卡片',
    body: '## 核心观点\n- \n\n## 关键摘录\n> \n\n## 个人启发与行动\n- '
  },
  {
    id: 'weekly',
    label: '项目周结',
    folder: '工作复盘',
    title: '本周项目交付复盘',
    body: '## 本周关键进展\n- \n\n## 风险与卡点\n- \n\n## 下周优先级\n1. \n2. \n'
  }
]);

export const ROLE_PROFILES = Object.freeze({
  general: Object.freeze({
    id: 'general',
    name: '通用效能',
    badge: '全模块均衡',
    icon: 'sun-medium',
    workspaceLabel: '日常综合工作台',
    tagline: '涵盖任务排期、项目里程碑、知识笔记、分组网址导航与通用工具箱',
    greetingSubtitle: '先看清今日待办与项目进度，再稳步推进账目、笔记与生活节律',
    omniboxPlaceholder: '快速录入待办、记账或饮水，输入 /help 查看语法…',
    navPages: ['home', 'todo', 'projects', 'study', 'standup', 'calendar', 'bookmarks', 'notes', 'toolbox', 'ledger', 'habits', 'sport', 'weather', 'me'],
    mobileTabs: ['home', 'todo', 'bookmarks', 'projects'],
    kpiOrder: ['tasks', 'focus', 'ledger', 'shift'],
    presetCategory: '通用效率',
    defaultToolGroup: 'general',
    defaultProjectMode: 'milestone',
    projectTermLabel: '目标与里程碑',
    homeTools: [
      { id: 'date-diff', label: '日期与工作日推算', group: 'general' },
      { id: 'unit-conv', label: '单位与汇率换算', group: 'general' },
      { id: 'json-fmt', label: 'JSON 格式化校验', group: 'dev' }
    ],
    blocksLayout: [
      { id: 'role-hub', span: 12 },
      { id: 'matrix', span: 8 },
      { id: 'tasks', span: 4 },
      { id: 'notes', span: 6 },
      { id: 'links', span: 6 },
      { id: 'charts', span: 8 },
      { id: 'ledger', span: 4 },
      { id: 'reminders', span: 4 },
      { id: 'rhythm', span: 4 },
      { id: 'review', span: 4 }
    ]
  }),

  developer: Object.freeze({
    id: 'developer',
    name: '研发工程师',
    badge: '代码与交付',
    icon: 'command',
    workspaceLabel: '工程研发工作台',
    tagline: '配备研发实用工具箱（JSON/正则/时间戳）、版本里程碑、技术知识库与开发文档导航',
    greetingSubtitle: '聚焦代码冲刺、版本里程碑与技术文档，常用开发工具和站点一屏直达',
    omniboxPlaceholder: '录入联调任务、技术便签或 开始专注 45 分钟，/help 看语法…',
    navPages: ['home', 'todo', 'projects', 'study', 'toolbox', 'bookmarks', 'notes', 'standup', 'calendar', 'me'],
    mobileTabs: ['home', 'todo', 'toolbox', 'bookmarks'],
    kpiOrder: ['focus', 'tasks', 'shift', 'ledger'],
    presetCategory: '开发研发',
    defaultToolGroup: 'dev',
    defaultProjectMode: 'milestone',
    projectTermLabel: '版本迭代里程碑',
    homeTools: [
      { id: 'json-fmt', label: 'JSON 格式化 / 压缩', group: 'dev' },
      { id: 'regex-test', label: '正则表达式测试器', group: 'dev' },
      { id: 'timestamp', label: '时间戳转换 & UUID', group: 'dev' }
    ],
    blocksLayout: [
      { id: 'role-hub', span: 12 },
      { id: 'tasks', span: 6 },
      { id: 'notes', span: 6 },
      { id: 'links', span: 6 },
      { id: 'matrix', span: 6 },
      { id: 'reminders', span: 4 },
      { id: 'rhythm', span: 4 },
      { id: 'review', span: 4 }
    ]
  }),

  creator: Object.freeze({
    id: 'creator',
    name: '产品与设计',
    badge: '创意与排期',
    icon: 'sparkles',
    workspaceLabel: '产品创意空间',
    tagline: '配备配色对比度与排版比例工具、需求交付里程碑、Markdown 文档库与设计资源导航',
    greetingSubtitle: '按四象限梳理需求优先级，高效联动配色对比度工具、灵感笔记与设计站点',
    omniboxPlaceholder: '记录需求评审、设计灵感或 明天 15:00 对齐会…',
    navPages: ['home', 'todo', 'projects', 'notes', 'bookmarks', 'toolbox', 'calendar', 'standup', 'me'],
    mobileTabs: ['home', 'notes', 'bookmarks', 'projects'],
    kpiOrder: ['tasks', 'focus', 'shift', 'ledger'],
    presetCategory: '设计创意',
    defaultToolGroup: 'design',
    defaultProjectMode: 'milestone',
    projectTermLabel: '需求与设计交付',
    homeTools: [
      { id: 'contrast', label: 'WCAG 对比度检测', group: 'design' },
      { id: 'type-scale', label: '字号与间距比例尺', group: 'design' },
      { id: 'date-diff', label: '排期工作日推算', group: 'general' }
    ],
    blocksLayout: [
      { id: 'role-hub', span: 12 },
      { id: 'matrix', span: 8 },
      { id: 'notes', span: 4 },
      { id: 'links', span: 6 },
      { id: 'tasks', span: 6 },
      { id: 'reminders', span: 4 },
      { id: 'rhythm', span: 4 },
      { id: 'review', span: 4 }
    ]
  }),

  student: Object.freeze({
    id: 'student',
    name: '学生与研究',
    badge: '研习与自律',
    icon: 'book-open',
    workspaceLabel: '研习与学术空间',
    tagline: '配备课程与考试进度看板、GPA 绩点与引文生成器、读书知识库及学术文献导航',
    greetingSubtitle: '紧跟课程进度、番茄学习曲线与读书卡片，学术检索和引文工具随时可用',
    omniboxPlaceholder: '开始专注 45 分钟、记录文献摘要或 喝水 300ml…',
    navPages: ['home', 'study', 'projects', 'todo', 'notes', 'bookmarks', 'toolbox', 'calendar', 'habits', 'me'],
    mobileTabs: ['home', 'study', 'projects', 'notes'],
    kpiOrder: ['focus', 'tasks', 'shift', 'ledger'],
    presetCategory: '学术学习',
    defaultToolGroup: 'study',
    defaultProjectMode: 'course',
    projectTermLabel: '课程与备考进度',
    homeTools: [
      { id: 'gpa-calc', label: 'GPA 加权绩点计算', group: 'study' },
      { id: 'citation', label: 'GB7714 / APA 引文生成', group: 'study' },
      { id: 'date-diff', label: '考试倒计时天数', group: 'general' }
    ],
    blocksLayout: [
      { id: 'role-hub', span: 12 },
      { id: 'tasks', span: 6 },
      { id: 'rhythm', span: 6 },
      { id: 'notes', span: 6 },
      { id: 'links', span: 6 },
      { id: 'reminders', span: 6 },
      { id: 'review', span: 6 }
    ]
  }),

  freelance: Object.freeze({
    id: 'freelance',
    name: '自由职业/经营',
    badge: '现金流与客户',
    icon: 'wallet-cards',
    workspaceLabel: '独立经营工作台',
    tagline: '配备客户合同与回款看板、工时报价与分期拆账工具、月度收支预算及财税资源导航',
    greetingSubtitle: '实时掌控客户项目回款节点、月度预算水位，一键生成项目报价并联动账本',
    omniboxPlaceholder: '输入 收款 4800 元、云服务续费 68 元，或客户交付待办…',
    navPages: ['home', 'ledger', 'projects', 'todo', 'toolbox', 'bookmarks', 'notes', 'standup', 'calendar', 'me'],
    mobileTabs: ['home', 'ledger', 'projects', 'bookmarks'],
    kpiOrder: ['ledger', 'tasks', 'focus', 'shift'],
    presetCategory: '财务经营',
    defaultToolGroup: 'finance',
    defaultProjectMode: 'client',
    projectTermLabel: '客户合同与回款',
    homeTools: [
      { id: 'quote-calc', label: '项目报价与时薪反推', group: 'finance' },
      { id: 'phase-split', label: '分期回款拆账转账本', group: 'finance' },
      { id: 'unit-conv', label: '汇率与常用单位换算', group: 'general' }
    ],
    blocksLayout: [
      { id: 'role-hub', span: 12 },
      { id: 'charts', span: 8 },
      { id: 'ledger', span: 4 },
      { id: 'tasks', span: 6 },
      { id: 'links', span: 6 },
      { id: 'reminders', span: 6 },
      { id: 'review', span: 6 }
    ]
  })
});

export function isValidRoleId(roleId) {
  return typeof roleId === 'string' && Object.prototype.hasOwnProperty.call(ROLE_PROFILES, roleId);
}

export function getRoleProfile(roleId) {
  return isValidRoleId(roleId) ? ROLE_PROFILES[roleId] : ROLE_PROFILES.general;
}

export function getRolePresetLinks(roleId) {
  const profile = getRoleProfile(roleId);
  return WEBSITE_CATALOG.filter(item => item.roles.includes(profile.id));
}

export function getWebsiteCatalog(category = '全部', roleId = '') {
  const cat = String(category || '全部').trim();
  return WEBSITE_CATALOG.filter(item => {
    if (cat && cat !== '全部' && item.category !== cat) return false;
    if (roleId && isValidRoleId(roleId) && roleId !== 'general' && !cat) {
      return item.roles.includes(roleId);
    }
    return true;
  });
}

export function resolveRoleBlocks(roleId, defaultBlocks) {
  const profile = getRoleProfile(roleId);
  const byId = new Map((Array.isArray(defaultBlocks) ? defaultBlocks : []).map(b => [b.id, { ...b }]));
  const ordered = [];

  for (const item of profile.blocksLayout) {
    const base = byId.get(item.id);
    if (!base) continue;
    const span = [4, 6, 8, 12].includes(item.span) ? item.span : base.span;
    ordered.push({ ...base, span });
    byId.delete(item.id);
  }

  const hiddenBlocks = [];
  for (const rest of byId.values()) {
    ordered.push(rest);
    hiddenBlocks.push(rest.id);
  }

  return { blocks: ordered, hiddenBlocks };
}

export function canonicalUrlKey(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    const pathname = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}${pathname}${u.search}`;
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
}

export function planLinkImports(existingLinks, candidates) {
  const seen = new Set((Array.isArray(existingLinks) ? existingLinks : []).map(item => canonicalUrlKey(item?.url)));
  const toImport = [];
  for (const cand of Array.isArray(candidates) ? candidates : []) {
    if (!cand || !cand.url || !cand.title) continue;
    const key = canonicalUrlKey(cand.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    toImport.push({
      title: String(cand.title).trim(),
      url: String(cand.url).trim()
    });
  }
  return toImport;
}
