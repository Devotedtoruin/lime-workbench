# GitHub 上传与静态托管指南

> 2026-10-16。以下是维护者未来按需执行的步骤，不是本轮已提交 / 推送 / 部署的记录。当前基线与证据见 [README](../README.md)。

## 1. 先检查公开范围

- 需要 Git、自己的 GitHub 账号及 Node.js 22+。当前没有第三方 npm 依赖，不执行 `npm install` / `npm ci`。
- 检查 `git status`、`.gitignore` 与准备公开的内容；个人 JSON 备份、Key、环境文件、签名凭证、截图中的私人资料不能提交。
- `.gitignore` 仅影响尚未跟踪的匹配文件，不能删除已有历史，也不是密钥扫描器。发生泄漏先轮换密钥，再处理历史。
- 检查项目 MIT、[第三方声明](THIRD-PARTY.md)与 [Lucide / Feather 完整许可](licenses/LUCIDE-ISC.txt)。源码中保留的历史 GridStack vendor 仍须保留其原始版权与许可，即使它不进入当前站点。

## 2. 未来上传源码

在 GitHub 新建空仓库，不再额外生成已有的 README、License 或 `.gitignore`。先检查本地是否已有仓库、提交和远端；不要机械重做初始化或覆盖历史。

```bash
# 在真实项目根目录；以下需要维护者决定并执行
git status
git diff --cached
```

确认范围后可用命令行或 GitHub Desktop 暂存、审查和提交。首次上传使用自己的远端地址与分支名；已有远端先理解双方内容再合并，不为省事强推。本轮没有替维护者设置 Git 身份、创建远端、提交或推送。

公开源码和公开站点是两回事：源码仓库可包含工具、测试及历史文件，**站点不能直接指向仓库根目录**。

## 3. 仓库 CI：只验证，不部署

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)使用 Node 22：

1. `npm ci` 安装锁定依赖；
2. `npm test`；
3. `npm run build` 生成 Vue 产物到 `dist/`；
4. 检查 `dist` 中的 `index.html`、`sw.js`、`manifest.webmanifest` 与静态素材。

工作流权限仅 `contents: read`。没有真实天气 / AI 联网检查、强制浏览器安装或部署步骤。本机即使命令已验证，也不代表 GitHub job 已运行成功；以未来 Actions 的实际日志为准。

## 4. 未来静态托管：只部署经过核对的 dist

```bash
npm ci
npm run build
npm run preview
```

只部署 `dist/`，不部署仓库根目录。`src/` 为 Vue 组件与设计令牌，`js/` 为纯业务模块，`assets/` 由 Vite 构建钩子整体复制。运行资产、项目许可证、第三方声明及本地 Lucide / Feather 许可一起分发；`node_modules`、测试与开发工具不分发。

构建产物一致只能证明当前源码生成了这些文件，不能替代素材、个人资料与密钥审查。

### 选择 GitHub Pages 时

1. 由维护者另行批准托管方案，在 Settings → Pages 选择 GitHub Actions。
2. 另建部署工作流，并评估其 Pages 权限、环境、触发分支及 artifact。不要把现有只读 CI 误认为部署工作流。
3. Node 22 构建后，Pages artifact 的 `path` 必须为 **`dist`**，不是 `.`。其它托管平台也把发布目录设为 `dist`。
4. 发布动作与所需写权限仅属于明确批准的部署流程，不给普通 CI 添加自动发布权限。

本轮没有创建部署工作流、上传 artifact 或开启 Pages。不要选 `main / (root)` 直接把源码根目录当站点。

### 上线后再验收

- 按真正的 HTTPS 地址验证资源、PWA 安装及离线打开；项目子路径如 `/lime-workbench/` 也要验证 Service Worker scope。
- 确认站点不提供 `/tools/ai-probe.html`、`/tests/`、环境文件、备份、签名文件或历史 vendor。
- 天气与显式 AI 请求需联网，服务条款和 CORS 需另核对；本地合成服务测试不能证明真实第三方服务可用。
- 不从 Edge / Chrome 检查推断 Safari / iOS、系统通知、真实 GPS 或原生 WebView 全部可用。

## 5. 更新与排错

更新前执行单测与发布预检，按实际改动补充浏览器专项和人工检查；记录命令、环境、失败与跳过项，再由维护者决定提交 / 发布。

- **旧界面**：先检查 Service Worker 安装 / 激活及缓存版本，不贸然清站点数据；先导出记录。当前缓存 v29，应用版本、业务状态版本和设备外观版本是独立编号。
- **构建被阻止**：查看未知输出、缺失源文件或不安全路径提示；不要用删除整目录绕过保护。新临时输出能帮助区分旧产物问题。
- **CI 失败**：看实际日志，核对 Node 22、公开清单、许可文件和字节比对；本项目不需要补 `npm ci`。
- **远端拒绝推送**：检查默认分支、现有内容与历史，正常合并，不直接强推。
- **本地记录看似丢失**：核对协议、域名、端口和浏览器；找到原 origin 后先导出再迁移。

当前结果以本机实际运行的单测与构建为准；不要把历史记录当作本轮部署或测试证明。
