# 开发工具

不参与应用运行。使用 Node.js 22+ 内置模块；`seed-probe.mjs` 与 `mobile-probe.mjs` 通过 CDP 驱动本机已安装的 Edge / Chrome。

## 常用命令

```bash
npm test        # Node Test Runner
npm run build   # Vite 生产构建，输出 dist/
npm start       # 开发服务 http://127.0.0.1:5173/
```

## 浏览器探测

先启动 `npm start`，再运行：

```bash
# 390px 视口横向溢出检查 + 截图
node tools/mobile-probe.mjs "http://127.0.0.1:5173/?page=home"

# 写入示例数据并截取多个页面
PREFIX=desktop WIDTH=1440 HEIGHT=1000 node tools/seed-probe.mjs "home,todo,ledger,calendar,me"
PREFIX=mobile  WIDTH=390  HEIGHT=900  PORT=9336 node tools/seed-probe.mjs "home,me"
```

| 工具 | 用途 |
|---|---|
| `mobile-probe.mjs` | 模拟 390px 视口检查横向溢出并截图 |
| `seed-probe.mjs` | 写入示例数据后逐页截图；使用独立临时 profile，不接触真实记录 |
| `check-native.mjs` | 只读检查 Tauri 配置（版本一致性、CSP、图标、构建钩子） |

截图仅用于本机目视核对。临时 profile 位于系统临时目录。
