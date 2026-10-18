// Dev-only CDP seed: writes a complete valid v4 state record, then screenshots given pages.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.env.PORT || 9334);
const BASE = process.env.BASE || 'http://127.0.0.1:5173/';
const OUT = join(tmpdir(), 'lime-shots');
mkdirSync(OUT, { recursive: true });

const day = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const now = Date.now();

const state = {
  version: 4,
  settings: {
    salary: 8000, workHours: 8, onTime: '09:00', offTime: '18:00', payDay: 15,
    waterGoal: 2000, stepGoal: 6000, restDays: [0, 6],
    displayName: '小林', avatar: '🌿', avatarImage: '', avatarAssetId: '',
    workspaceName: '青柠工作台', logoMode: 'default', logoImage: '', logoAssetId: '',
    focusMinutes: 25
  },
  todos: [
    { id: now + 1, text: '完成 Q4 项目复盘文档', done: false, date: day(0), time: '10:00', timed: true, priority: 'high', tag: '项目' },
    { id: now + 2, text: '和设计对齐新版工作台视觉', done: false, date: day(0), time: '14:30', timed: true, priority: 'medium', tag: '协作' },
    { id: now + 3, text: '整理本周会议纪要', done: true, date: day(0), time: '', timed: false, priority: 'low', tag: '文档', completedAt: now },
    { id: now + 4, text: '提交周报', done: false, date: day(0), time: '18:00', timed: true, priority: 'high', tag: '文档' }
  ],
  ledger: [
    { id: now + 301, type: 'expense', amount: 45.5, note: '办公用品', cat: '🔌 日用', date: day(0) },
    { id: now + 302, type: 'expense', amount: 128, note: '软件订阅', cat: '💳 固定支出', date: day(-1) },
    { id: now + 303, type: 'income', amount: 1200, note: '项目奖金', cat: '💼 收入', date: day(-2) }
  ],
  water: { [day(0)]: [{ ml: 250, time: now }, { ml: 500, time: now }] },
  steps: { [day(0)]: 4200 },
  study: { [day(0)]: 3300, [day(-1)]: 5400, [day(-2)]: 2700 },
  sport: [
    { id: now + 401, type: 'run', minutes: 32, distance: 5.2, date: day(-1), startAt: now },
    { id: now + 402, type: 'bike', minutes: 40, distance: 12, date: day(-3), startAt: now }
  ],
  reminders: [
    { id: `task-${now}`, kind: 'once', preset: 'custom', icon: 'bell', label: '提交周报', text: '待办：提交周报', enabled: true, date: day(0), time: '18:00', nextAt: now + 3600000, taskId: now + 4 },
    { id: `water-${now}`, kind: 'interval', preset: 'water', icon: 'water', label: '喝水', text: '该喝水啦', enabled: true, every: 45, startAt: now, nextAt: now + 1800000 }
  ],
  pendingAlerts: [],
  notes: [
    { id: now + 101, title: '周会要点', body: '1. 新版本下周一灰度\n2. 设计稿评审改到周四\n3. 需要补一份数据看板说明', createdAt: now, updatedAt: now },
    { id: now + 102, title: '灵感记录', body: '工作台首页可以加一个专注热力图，按周展示专注时长分布。', createdAt: now, updatedAt: now },
    { id: now + 103, title: '待确认', body: 'API Key 存储方式需要再确认，当前为本地明文，考虑改为会话级。\n另外评估一下 IndexedDB 大文件支持。\n还有导入导出的边界情况。', createdAt: now, updatedAt: now }
  ],
  links: [
    { id: now + 201, title: '项目文档', url: 'https://example.com/docs', createdAt: now },
    { id: now + 202, title: '设计规范', url: 'https://example.com/design', createdAt: now },
    { id: now + 203, title: '数据看板', url: 'https://example.com/dashboard', createdAt: now }
  ],
  notifOn: false, soundOn: true, earnedTotal: 0,
  pet: { name: '青柠', img: 'lemon.png' },
  focus: { total: 1500, remaining: 1500, running: false, dueAt: null, lastCreditedAt: null, text: '', taskId: null, creditRemainders: {} }
};

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), `lime-cdp-seed-${PORT}`)}`,
  'about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch { /* retry */ }
    await sleep(250);
  }
  if (!target) throw new Error('no devtools target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise(resolve => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  const width = Number(process.env.WIDTH || 1440);
  const height = Number(process.env.HEIGHT || 1000);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Page.navigate', { url: BASE });
  await sleep(2000);
  const seeded = await send('Runtime.evaluate', { expression: `localStorage.setItem('lime-workbench-v1', ${JSON.stringify(JSON.stringify(state))}); 'seeded'`, returnByValue: true });
  console.log(seeded.result?.result?.value);

  const pages = (process.argv[2] || 'home,todo,ledger,calendar,me').split(',');
  for (const page of pages) {
    await send('Page.navigate', { url: `${BASE}?page=${page}` });
    await sleep(1800);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = `${OUT}/${process.env.PREFIX || 'seed'}-${page}.png`;
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('shot', page);
  }
  ws.close();
  child.kill();
}
main().catch(error => { console.error(error); child.kill(); process.exit(1); });
