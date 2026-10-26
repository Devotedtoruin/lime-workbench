// theme.js — 文档级主题色
//
// 构建期：tools/gen-theme-meta.mjs 把首帧主题引导脚本 + CSP 写进 index.html 与
// dist/index.html；引导脚本在样式表加载前改好 <meta name="theme-color">，避免浅色闪白。
// 运行期：js/appearance.js 的 applyAppearance() 调用 applyThemeColor()，让标题栏跟随
// 用户选择的明暗，而不是只跟随系统偏好。
//
// 颜色单一事实源：src/styles/base.css 的 --bg（浅色）与 [data-theme="dark"] 的 --bg。
// 两者不一致会让安装后的应用标题栏与页面底色打架；tests/theme.test.mjs 会比对。

export const THEME_COLORS = Object.freeze({ light: '#f8fafc', dark: '#0a0e1a' });

const isTheme = value => Object.prototype.hasOwnProperty.call(THEME_COLORS, value);

/**
 * 切换文档主题色。返回是否改动过 DOM。
 * 直接写 <meta name="theme-color"> 的 content：浏览器 UI（标题栏、安装后窗口边框）读的是
 * meta 的值，注入 `meta[content="…"] { … }` 只改颜色查找表、改不动它们。
 * 不抛错：主题色只是装饰，任何 DOM 缺失都应静默跳过。
 */
export function applyThemeColor(theme, doc = globalThis.document) {
  if (!isTheme(theme) || !doc?.documentElement) return false;
  const colour = THEME_COLORS[theme];
  let changed = false;
  const metas = typeof doc.querySelectorAll === 'function'
    ? [...doc.querySelectorAll('meta[name="theme-color"]')]
    : [];
  if (!metas.length && doc.head && typeof doc.createElement === 'function') {
    const meta = doc.createElement('meta');
    meta.name = 'theme-color';
    metas.push(meta);
    doc.head.appendChild(meta);
  }
  for (const meta of metas) {
    if (meta.content !== colour) { meta.content = colour; changed = true; }
  }
  doc.documentElement.style?.setProperty?.('color-scheme', theme);
  return changed;
}
