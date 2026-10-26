# 构建与发布

## Web / PWA

需要 Node.js 22+。

```bash
npm install
npm run build     # 输出到 dist/
npm run preview   # 本机预览生产构建
```

构建产物 `dist/` 可直接部署到任意静态托管。

- 只部署 `dist/`，不要部署根目录
- `dist/` 已包含 `index.html`、哈希命名的 JS/CSS、`assets/` 静态素材、`manifest.webmanifest` 与 `sw.js`
- Service Worker 需要 HTTPS 或 localhost 才能注册
- **CSP**：构建的最后一步调用 `tools/gen-theme-meta.mjs`，把 `Content-Security-Policy` 与首帧主题引导脚本写进 `dist/index.html`（入口脚本的哈希在 Vite 改名之后才能算）。`npm run gen:meta` 可以单独重跑，`--check` 只校验。

### GitHub Pages

推送到 `master` 后由 `.github/workflows/pages.yml` 自动完成：`npm ci` → `npm test` → `npm run build` → 校验 `dist/index.html` 带 CSP → 部署 Pages。

线上地址：<https://devotedtoruin.github.io/lime-workbench/>

`.github/workflows/ci.yml` 只做构建检查，不部署。

`package-lock.json` 必须提交：`npm ci` 没有锁文件会直接失败，两个工作流都会停在装依赖这一步。

## 桌面与移动端

`src-tauri/` 内保留了 Tauri 2 的工程配置，**当前未打包发布，也不在 CI 中编译**。

需要自行打包时：

1. 安装 Rust 1.77+ 与 Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」）
2. 安装 Tauri CLI：`cargo install tauri-cli`
3. 在 `src-tauri/` 内执行 `cargo tauri build`（Windows）或 `cargo tauri android build`（Android）

产物会出现在 `src-tauri/target/release/bundle/` 或 `src-tauri/gen/android/app/build/outputs/`，均不进入版本控制。

> 说明：仓库的 `package.json` 中没有 Tauri 相关脚本，前端构建与原生打包目前是两条独立路径。若后续要正式发布桌面版，建议引入 `@tauri-apps/cli` 并把打包步骤纳入 CI。

## 发布检查清单

- [ ] `npm test` 全部通过
- [ ] `npm run build` 无警告地完成，并输出 `CSP 与主题色元数据已写入`
- [ ] `grep Content-Security-Policy dist/index.html` 有结果（CI 也会拦这一项）
- [ ] 用 `npm run preview` 实际打开页面，检查 PWA 安装与离线能力
- [ ] 确认 `public/sw.js` 的 `CACHE_VERSION` 已随本次改动递增
