# 发布与原生打包

> 2026-10-16。当前交付是 Web 产品与 Tauri 2 打包配置，**不是已生成的原生安装包**。本轮未提交 / 推送、部署、发布 GitHub Release、安装大型 SDK、原生编译或创建签名身份。当前结果以本机实际运行的单测与构建为准。

## 三种交付，分别验收

| 交付 | 当前定位 | 不能据此推断 |
|---|---|---|
| Web / PWA | 应用 1.0.0，缓存 v29，业务状态 v4，设备外观 v2；当前使用路线 | 页面缓存成功不证明天气 / AI 离线、关页提醒或所有浏览器均可用 |
| Windows | Tauri 2 中文 NSIS、当前用户安装配置 | 没有 exe 编译、签名、安装 / 升级成功结论 |
| Android | Tauri 移动入口与 Android 配置 | 没有签名 APK / AAB 或真机验收结论 |

GitHub 自动提供的 Source code zip / tar.gz 是源码，不是安装程序。Releases 可附加经过验证的产物；Packages 是包注册服务，Pages 是 Web 托管，三者都不能代替原生编译。

## Web：Vite 构建与安全输出

需要 Node.js 22+；前端使用 Vue 3 + Vite，首次需安装依赖。

```bash
npm install
npm run build   # 输出到 dist/
npm run preview # 可选：本机预览生产构建
```

`src/` 中是 Vue 单文件组件、组合式状态层与设计令牌，`js/` 中是纯业务模块；Vite 打包为 `dist/index.html`、哈希命名的 JS/CSS 与 `assets/` 静态素材，并复制 `manifest.webmanifest` 与 `sw.js`。不使用递归复制任意目录的发布脚本；`assets/` 由 `vite.config.js` 的构建钩子整体复制。

只部署经过核对的 `dist/`，不发布源码根目录。公开站点不应包含个人 JSON 备份、媒体原文件、真实 Key、工作私有链接、浏览器证据、环境文件、SDK 或签名材料。构建一致不是完整内容 / 隐私审计；截图也需脱敏。

仓库 [CI](../.github/workflows/ci.yml)使用 Node 22 执行 `npm ci`、单测与 Vite 构建，并检查 `dist` 关键文件，权限 `contents: read`，不自动部署。未来托管需单独授权并配置，见 [GitHub 指南](GITHUB.md)。

## Tauri 配置与安全边界

- 应用版本 `1.0.0`，固定标识 `app.lime.workbench`；package / Cargo / Tauri 产品版本保持一致，Web 缓存、业务状态和外观编号独立。
- `frontendDist: "../dist"`，只嵌入公开 Web 输出。`beforeBuildCommand` 运行 `npm run build`，不是打包整个仓库。
- 开发地址 `http://127.0.0.1:5173`，`beforeDevCommand` 运行 `npm run dev`。已有服务占用端口时先辨明归属，不随意杀进程。
- Windows 窗口 1280 × 820、最小 960 × 640，保留系统边框，不透明原生窗口；磨砂 / 玻璃只是 CSS 效果。
- Windows 配置 NSIS、`currentUser` 与简体中文。缺 WebView2 时默认下载 bootstrapper，首次安装可能需要网络；记录离线不代表安装器全离线。
- Android 最低 SDK 24、`versionCode: 1000000`；后续正式更新须按真实版本增加，不能据此断言满足未来商店 target API 政策。
- 仅本地 main 窗口 `core:default`，无 remote 原生授权；没有自定义 invoke、filesystem / shell / 原生 HTTP / notification 插件、托盘、开机启动或自动更新。
- CSP 限制脚本来自本机，不允许脚本 `unsafe-inline` / `unsafe-eval` 或远程脚本。动态主题样式不等于允许执行远程脚本。天气与自选 HTTPS API 的连接权限不是 AI 服务域名白名单。

浏览器的媒体播放、Blob / 本地字体和 API 连接结果不能外推到 Tauri WebView。原生外链策略、媒体选择与播放、下载 / 导出、CORS 和权限都要真实装机验证；不引入绕过 CORS 的原生 HTTP 能力。

## 环境检查不等于编译

```bash
node tools/check-native.mjs --platform windows
node tools/check-native.mjs --platform android
```

工具只检查已有命令、SDK 与配置，不安装、不联网拉包、不创建 Android 工程或签名。

- `status: "blocked"`，退出 2：缺少必要输入或前置条件。
- `status: "prerequisites-detected"`，退出 0：所检查前置条件存在，**不表示编译、安装或运行通过**。
- `nativeBuildVerified` 保持 false。静态 / 模拟测试也不等于原生编译。

## 未来 Windows 构建：先单独批准环境

需要维护者批准 Rust MSVC、Tauri 2 CLI、Visual Studio C++ Build Tools / Windows SDK、WebView2 的安装与磁盘 / 网络安排。不要通过自动拉 CLI 的命令偷换为已获安装授权。

仅在工具链已批准并安装后，从项目根运行未来示例（本轮未执行）：

```bash
cargo tauri dev
cargo tauri build --bundles nsis
```

产物通常在 `src-tauri/target/release/bundle/nsis/`；设置 Rust target 或 `CARGO_TARGET_DIR` 后以真实日志为准。记录版本、架构、文件名与 SHA-256，不上传整个 target。

发布前至少验证干净 Windows 的安装 / 启动 / 升级 / 卸载、中文界面、记录与备份、无网打开、媒体 / 字体、外链、API CORS 和缺 WebView2 流程。签名证书与 SmartScreen 风险另行评估，不承诺无安全提示。

## 未来 Android 构建：先决定签名身份

批准 JDK、Android Studio / SDK / build-tools / NDK 与 Rust Android targets；版本组合以当前 Tauri 官方要求为准。`JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 及生成工程需实际核对。

以下是未来示例，本轮未执行：

```bash
cargo tauri android init
cargo tauri android build --apk --target aarch64
# 商店路线通常使用 AAB
cargo tauri android build --aab --target aarch64
```

输出通常在 `src-tauri/gen/android/app/build/outputs/`，以实际 CLI / Gradle 日志为准。ARM64 不覆盖所有设备；debug 包不等于正式 release 包。

签名前明确身份、密码和备份方案。keystore、私钥与密码放仓库外受控位置，不进入源码、dist、压缩包或日志；丢失身份可能影响升级。本轮不创建密钥、不填写生产密码、不连接商店。`.gitignore` 是辅助防线，不替代人工检查。

必须真机验证返回键、软键盘、安全区域、旋转 / 恢复、权限拒绝、外链、文件选择、JSON 导入 / 导出、动态媒体、离线与不同 WebView。套壳不自动获得后台通知、健康数据、计步或同步。

## 数据迁移与发布清单

浏览器 / PWA 与 Tauri 存储相互独立，不自动共享记录、Key、媒体或外观。

- 先在旧端导出业务 JSON，再在新端明确导入并核对，保留原备份。业务状态 v4 可读取旧版本；未知未来格式不能手改版本降级。
- 头像静态图 / 动画封面随业务 JSON；**动态原文件、视频与字体 Blob 不在 JSON 中**。IndexedDB `lime-local-assets`、设备外观 v2、背景、旧布局与 AI Key 需分别保管 / 重新设置。JSON 导入不是完整媒体迁移。
- API Key 为客户端明文本地数据，不将生产 Key 编入 JS、Rust、前端 `.env` 或安装包。连接测试只用临时另填 Key；没有真实第三方 API 成功结论。
- 清站点数据、卸载、换应用标识或换 origin 可能失去数据，包装版不是云备份。“仅清理演示数据”只处理可证明来源的记录，未知来源不删除，不能当重置使用。

发布前逐项确认：

1. 重新运行单测与构建，核对当前源版本、命令、结果与未测项；不把历史浏览器 / ZIP 结果复用为本轮通过。
2. 在新目录构建并严格比对公开清单与字节内容，检查个人资料、许可和截图脱敏。
3. 原生路线记录工具链、架构、应用 ID、签名、checksum 与最低环境，经过真实装机 / 升级验收后才写“可安装”。
4. 明确天气服务用途 / 总流量 / 署名与 AI 数据政策；本机合成服务不证明公网服务可用。
5. 只有用户明确授权后才提交、推送、部署或创建 Release。本轮没有这些动作。

## 参考

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) · [Windows / WebView2](https://v2.tauri.app/distribute/windows-installer/) · [Android / Google Play](https://v2.tauri.app/distribute/google-play/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) · [GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages)
- [历史公开源码与结构研究](REFERENCE-ANALYSIS.md)：固定 SHA 研究与部分在线 HTML / CSS 分析，不是第三方现场拖拽、截图或当前产品验收；不复制竞品品牌或受限实现。
