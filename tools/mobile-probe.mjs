// Dev-only CDP probe: emulate a 390px phone, report overflow offenders and screenshot.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const url = process.argv[2] || 'http://127.0.0.1:5173/?page=home';
const out = process.argv[3] || join(tmpdir(), 'lime-shots', 'probe.png');
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 900);

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), 'lime-cdp-profile')}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch { /* retry */ }
    await sleep(250);
  }
  if (!target) throw new Error('no devtools target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise(resolve => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise(resolve => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2500);

  const expression = `(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) {
        const name = (el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')).slice(0, 90);
        out.push({ name, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
      }
    });
    return JSON.stringify({ vw, scrollW: document.documentElement.scrollWidth, offenders: out.slice(0, 25) }, null, 2);
  })()`;
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  console.log(result.result?.result?.value || JSON.stringify(result));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', out);
  ws.close();
  child.kill();
}
main().catch(error => { console.error(error); child.kill(); process.exit(1); });
