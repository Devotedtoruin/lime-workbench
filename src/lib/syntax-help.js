// 全能输入框与命令面板共享的自然语言及斜杠语法速查定义
export const SYNTAX_CATEGORIES = [
  {
    id: 'todo',
    cmd: '/todo',
    title: '日程与任务排期',
    desc: '自动识别日期词（今天/明天/下周二）与具体时刻（15:00/下午三点）',
    examples: [
      { label: '15:00 项目进度评审', value: '15:00 项目进度评审' },
      { label: '明天 10:00 提交架构设计稿', value: '明天 10:00 提交架构设计稿' },
      { label: '下周二 下午两点 季度复盘', value: '下周二 14:00 季度复盘' }
    ]
  },
  {
    id: 'ledger',
    cmd: '/bill',
    title: '收支记账与分类识别',
    desc: '自动识别金额与消费场景并归入对应分类（餐饮/交通/居住/购物/办公/收入）',
    examples: [
      { label: '午餐 32 元 → 餐饮支出', value: '午餐 32 元' },
      { label: '打车去客户现场 45 元 → 交通', value: '打车 45 元' },
      { label: '办公键盘 299 元 → 购物', value: '办公键盘 299 元' },
      { label: '报销到账 680 元 → 收入', value: '报销到账 680 元' }
    ]
  },
  {
    id: 'focus',
    cmd: '/focus',
    title: '番茄专注与定时提醒',
    desc: '支持直接启动专注倒计时（1–180 分钟）或创建相对分钟提醒',
    examples: [
      { label: '开始专注 45 分钟', value: '开始专注 45 分钟' },
      { label: '记录专注 30 分钟', value: '记录专注 30 分钟' },
      { label: '20分钟后提醒我参加站会', value: '20分钟后提醒我参加站会' }
    ]
  },
  {
    id: 'health',
    cmd: '/life',
    title: '饮水、步数与运动记录',
    desc: '自动换算饮水容量（ml/杯/升）、更新当日总步数或记录运动时长与距离',
    examples: [
      { label: '喝了 300ml 水', value: '喝了 300ml 水' },
      { label: '走了 8500 步', value: '走了 8500 步' },
      { label: '跑步 5km 30分钟', value: '跑步 5km 30分钟' },
      { label: '骑行 45 分钟', value: '骑行 45 分钟' }
    ]
  },
  {
    id: 'workspace',
    cmd: '/note',
    title: '便签、常用链接与系统指令',
    desc: '支持通过前缀快速创建工作便签、保存外部链接或导出备份',
    examples: [
      { label: '便签：版本发布检查清单', value: '便签：版本发布检查清单' },
      { label: 'link: https://github.com', value: 'link: https://github.com' },
      { label: '导出备份', value: '导出备份' }
    ]
  }
];

export function matchSlashHelp(rawText) {
  const text = String(rawText || '').trim().toLowerCase();
  if (!text.startsWith('/')) return null;
  if (text === '/' || text === '/help' || text === '/?' || text === '/h' || text === '/语法') {
    return { active: true, filter: 'all', categories: SYNTAX_CATEGORIES };
  }
  const matched = SYNTAX_CATEGORIES.filter(
    c => c.cmd.startsWith(text) || `/${c.id}`.startsWith(text) || c.title.toLowerCase().includes(text.slice(1))
  );
  return {
    active: true,
    filter: text,
    categories: matched.length ? matched : SYNTAX_CATEGORIES
  };
}
