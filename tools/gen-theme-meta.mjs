// gen-theme-meta.mjs — 把 CSP 与首帧主题引导写回 HTML。
//
// 为什么需要这一步：生产构建没有任何 CSP，任何同 origin 的注入都能直接读 localStorage
// 里的 AI Key。因此文档外壳加一层 CSP：
//   - script-src 使用每次构建生成的 nonce + 入口 <script> 的 sha256 哈希。
//   - style-src 使用 'unsafe-inline'，因为脚本里大量 `el.style.x=` 在严格 CSP 下需要它
//     （在现代访问策略中它的行为近似 nonce：带 nonce 的样式表仍然只能由可信脚本插入）。
//     样式注入读不到 Key，所以这是可接受的取舍，而不是安全边界。
//   - 真正的边界是 connect-src / frame-ancestors / object-src / base-uri / form-action。
//
// 用法：
//   node tools/gen-theme-meta.mjs          # 写入 index.html 与（若存在）dist/index.html
//   node tools/gen-theme-meta.mjs --check  # 只校验一致性
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { THEME_COLORS } from '../js/theme.js';

const ROOT = process.cwd();
const FILES = [
  { path: 'index.html', script: /<script type="module" src="src\/main\.js"><\/script>/ },
  { path: 'dist/index.html', script: /<script type="module" crossorigin src="\.\/assets\/[^"]+?\.js"><\/script>/ }
];
const MARK = '<!-- lime:csp -->';
const NONCE = randomBytes(16).toString('base64url');

const sha256 = text => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;

/** 内联引导脚本：首帧前定主题，避免浅色闪白；并把 nonce 交给运行期样式节点。 */
export const bootScript = nonce => `!function(){try{var m=${JSON.stringify(THEME_COLORS)},t=localStorage.getItem('lime-appearance-v2'),v=t?JSON.parse(t).theme:'system',d=v==='dark'||(v==='system'&&matchMedia('(prefers-color-scheme:dark)').matches),a=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<a.length;i++)a[i].content=m[d?'dark':'light'];window.__limeCspNonce=${JSON.stringify(nonce)};var s=document.createElement('style');s.setAttribute('nonce',${JSON.stringify(nonce)});s.textContent='html{color-scheme:'+(d?'dark':'light')+'}';document.head.appendChild(s)}catch(e){}}();`;

export function cspFor(scriptContent, nonce) {
  const scriptHashes = [];
  if (scriptContent) scriptHashes.push(`'${sha256(scriptContent)}'`);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    // 只允许 HTTPS 与本地回环：自定义本地模型地址需要 localhost，其余一律不出站。
    // 注意 http://[::1]:* 不是合法 CSP source（浏览器会丢弃并报错），回环 IPv6 改用 https/本机
    // 域名之外的写法没有必要；IPv6 用户填 https://[::1] 走 https: 一项即可。
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
    // frame-ancestors 只能在 HTTP 头里生效，写在 <meta> 里会被浏览器忽略；
    // 静态托管无法下发响应头，如需防嵌套请在反向代理 / Pages 前置层加 X-Frame-Options。
  ].join('; ');
}

function rewrite(html, { script, dist }) {
  const match = html.match(script);
  if (!match && dist) return null;
  const scriptTag = match ? match[0] : '';
  const csp = cspFor(scriptTag, NONCE);
  const boot = `<script data-lime-boot nonce="${NONCE}">${bootScript(NONCE)}</script>`;
  const block = `${MARK}\n${boot}\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n${MARK}`;
  if (html.includes(MARK)) return html.replace(new RegExp(`${MARK}[\\s\\S]*?${MARK}`), block);
  return html.replace('</head>', `${block}\n</head>`);
}

function main() {
  const check = process.argv.includes('--check');
  const problems = [];
  for (const { path, script } of FILES) {
    const full = resolve(ROOT, path);
    let html;
    try { html = readFileSync(full, 'utf8'); } catch { continue; }
    // dev 源码没有 dist 入口；dist 检查也必须能跑。
    if (path.startsWith('dist/') && !html.includes('<script type="module"')) continue;
    if (check) {
      if (!html.includes('http-equiv="Content-Security-Policy"')) problems.push(`${path}: 缺少 CSP`);
      if (!html.includes('data-lime-boot')) problems.push(`${path}: 缺少首帧主题引导脚本`);
      for (const color of Object.values(THEME_COLORS)) {
        if (!html.includes(`content="${color}"`)) problems.push(`${path}: 主题色 ${color} 与 js/theme.js 不一致`);
      }
      continue;
    }
    const next = rewrite(html, { script, dist: path.startsWith('dist/') });
    if (next === null) { problems.push(`${path}: 找不到入口脚本标签，无法生成脚本哈希`); continue; }
    if (next !== html) writeFileSync(full, next);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(check ? 'CSP 与主题色元数据一致' : 'CSP 与主题色元数据已写入');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
