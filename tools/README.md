# 开发工具与验证入口

2026-10-17。工具不参与应用运行或公开发布。使用 Node.js 22+ 内置模块；`seed-probe.mjs` 与 `mobile-probe.mjs` 通过 CDP 驱动本机已安装的 Edge / Chrome。

## 检查与构建

```bash
npm test        # Node Test Runner：业务、边界、外观与 Vue 设计系统断言
npm run build   # Vite 生产构建，输出 dist/
npm start       # 本机开发服务 http://127.0.0.1:5173/
```

## 浏览器探测

先启动 `npm start`，再运行：

```bash
# 390px 视口横向溢出检查 + 截图
node tools/mobile-probe.mjs "http://127.0.0.1:5173/?page=home"

# 写入一份完整 v4 示例数据，并截取多个页面
PREFIX=desktop WIDTH=1440 HEIGHT=1000 node tools/seed-probe.mjs "home,todo,ledger,calendar,me"
PREFIX=mobile  WIDTH=390  HEIGHT=900  PORT=9336 node tools/seed-probe.mjs "home,me"
```

| 工具 | 范围与边界 |
|---|---|
| `mobile-probe.mjs` | 模拟 390px 手机视口，列出超出视口右边界的元素（`DIV.scene` 是背景层的固定 inset，属于预期）；输出整页截图 |
| `seed-probe.mjs` | 先写入一份合法 v4 状态记录（任务、账本、便签、链接、提醒、运动、饮水步数、专注），再逐页截图；使用独立临时 profile，不接触真实个人记录 |
| `check-native.mjs` | 只读检查 Tauri 配置：版本一致、CSP、能力、图标、构建钩子；`blocked` 退出 2，前置条件存在不等于原生编译成功 |

截图只用于本机目视核对，不作为像素级回归或发布证据；临时 profile 在系统临时目录。

## 边界

- 无头浏览器不能证明真实音频、系统通知必达、真实 GPS、Safari / iOS 或原生装机行为。
- 天气与 AI 需要真实第三方服务；本地探测不替代其可用性结论。
- `npm run build` 会生成 `dist/`，它不是源码；交付前按需重新构建。
