# 构建与发布

## Web / PWA

环境要求：Node.js 22.12+（CI 使用 Node.js 24），前端由 Vue 3 + Vite 8 构建。

```bash
npm ci
npm test          # Node.js 内置 Test Runner（非 Vitest）
npm run build     # 输出到 dist/；build:static 为同一构建的别名
npm run preview   # 本机预览生产构建
```

构建产物 `dist/` 可直接部署到任意静态托管。

- 只部署 `dist/`，不要部署根目录
- `dist/` 已包含 `index.html`、哈希命名的 JS/CSS、`assets/` 静态素材、`manifest.webmanifest` 与 `sw.js`
- Service Worker 需要 HTTPS 或本地回环地址提供的安全上下文；只在生产 Web 构建中注册，开发环境会注销旧 Worker 并清理本项目缓存
- 离线能力依赖首次在线加载与缓存：Worker 缓存应用外壳与已加载的同源资源，不缓存跨域天气与 AI 请求；本地业务数据独立保存在浏览器中，不随静态产物发布
- 天气与 AI 为可选联网能力：已保存城市与坐标时启动会刷新天气，浏览器定位由用户触发；保存有效 AI 配置后默认自动读取 `/models`（可关闭）
- **CSP**：构建的最后一步调用 [tools/gen-theme-meta.mjs](../tools/gen-theme-meta.mjs)，把 `Content-Security-Policy` meta 与首帧主题引导脚本写进源码入口及 `dist/index.html`。`npm run gen:meta` 可以单独重跑，`node tools/gen-theme-meta.mjs --check` 只校验，不重写文件
- meta 中的 `frame-src 'none'` 禁止本页加载子框架，不阻止外站嵌入本页。`frame-ancestors` 只在 HTTP 响应头中生效，当前静态产物不提供防嵌套响应头；需由支持自定义响应头的托管或代理层另行配置

### GitHub Pages

推送到 `master` 或手动触发后，由 [.github/workflows/pages.yml](../.github/workflows/pages.yml) 自动完成：`npm ci` → `npm test` → `npm run build` → 校验 `dist/index.html` 带 CSP → 添加 `404.html` 回退页 → 上传产物并部署 Pages。仓库的 Pages 发布源需设为 GitHub Actions。

线上地址：<https://devotedtoruin.github.io/lime-workbench/>

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 在 push、pull request 或手动触发时执行测试、构建、静态资源与 CSP 检查，不部署。工作台直接发布本仓库的构建产物，不经过博客源码仓库或博客成品仓库。

`package-lock.json` 必须提交：`npm ci` 没有锁文件会直接失败，两个工作流都会停在装依赖这一步。

## 桌面与移动端

[src-tauri/](../src-tauri/) 内保留了 Tauri 2 工程配置（Windows NSIS 目标与 Android 参数），**当前原生构建与发布未验证，也不在 CI 中编译**。

需要自行验证打包时：

1. Rust 最低版本声明为 1.77.2，实际还需满足锁定依赖要求；Windows 另需 Visual Studio Build Tools 的「使用 C++ 的桌面开发」与 WebView2
2. 安装 Tauri 2 CLI：`cargo install tauri-cli --version "^2" --locked`
3. 在 `src-tauri/` 内执行 `cargo tauri build` 验证 Windows 构建；Android 还需 JDK、Android SDK/NDK、Rust 目标与 `cargo tauri android init` 初始化，再执行 `cargo tauri android build`

上述原生流程尚未验证；成功构建后的输出目录为 `src-tauri/target/release/bundle/`（Windows）或 `src-tauri/gen/android/app/build/outputs/`（Android），原生产物不进入版本控制。

> 说明：[package.json](../package.json) 没有 Tauri 脚本，需通过 Cargo CLI 单独触发原生打包；[tauri.conf.json](../src-tauri/tauri.conf.json) 的 `beforeBuildCommand` 已配置调用前端构建。原生开发配置的 `devUrl` 仍为 `http://127.0.0.1:5173`，而当前 Vite 开发端口固定为 3000，验证开发模式前需先对齐端口。现有配置不代表已具备可交付的桌面或移动安装包。

## 发布检查清单

- [ ] `npm test` 全部通过
- [ ] `npm run build` 无警告地完成，并输出 `CSP 与主题色元数据已写入`
- [ ] `grep Content-Security-Policy dist/index.html` 有结果（CI 也会拦这一项）
- [ ] 用 `npm run preview` 实际打开页面，检查 PWA 安装与离线能力
- [ ] 发布应用代码或静态资源改动时，确认 [public/sw.js](../public/sw.js) 的 `CACHE_VERSION` 已递增（纯文档改动无需更新应用缓存）
