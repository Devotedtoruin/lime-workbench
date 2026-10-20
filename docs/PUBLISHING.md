# 构建与发布

## Web / PWA

需要 Node.js 22+。

```bash
npm install
npm run build     # 输出到 dist/
npm run preview   # 本机预览生产构建
```

构建产物 `dist/` 可直接部署到任意静态托管。

- 只部署 `dist/`，不要部署仓库根目录
- `dist/` 已包含 `index.html`、哈希命名的 JS/CSS、`assets/` 静态素材、`manifest.webmanifest` 与 `sw.js`
- Service Worker 需要 HTTPS 或 localhost 才能注册

### GitHub Pages

推送到 `master` 后由 `.github/workflows/pages.yml` 自动完成：`npm ci` → `npm test` → `npm run build` → 部署 Pages。

线上地址：<https://devotedtoruin.github.io/lime-workbench/>

`.github/workflows/ci.yml` 只做构建检查，不部署。

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
- [ ] `npm run build` 无警告地完成
- [ ] 用 `npm run preview` 实际打开页面，检查 PWA 安装与离线能力
- [ ] 确认 `sw.js` 的 `CACHE_VERSION` 已随本次改动递增
