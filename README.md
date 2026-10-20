# 青柠工作台 · Lime Workbench

浏览器优先、本地优先的个人工作台：任务、专注、提醒与生活记录集中在一处。无需账号或自建后端，记录保存在当前设备。

线上版本：<https://devotedtoruin.github.io/lime-workbench/>

技术栈 Vue 3 + Vite，以 Web / PWA 为主要形态。`src-tauri/` 内提供 Tauri 2 的 Windows 与 Android 配置，**尚未打包发布**，当前只支持浏览器使用。

## 功能

| 场景 | 能力 |
|---|---|
| 安排今天 | 任务新建、编辑、改期、完成、删除；今天 / 稍后 / 随时 / 已完成分组 |
| 全局检索 | Ctrl/Cmd + K 同时搜索任务、便签、账目、提醒、链接与运动记录 |
| 专注计时 | 1–180 分钟，暂停与恢复，可关联任务；7 / 30 / 90 天专注统计 |
| 提醒 | 间隔、定点、倒计时与任务提醒，支持知悉与延后 |
| 日常记录 | 分类收支、饮水、步数、运动与日历回顾 |
| 习惯打卡 | 自定义习惯、连续天数、近 7 天格子、今日进度 |
| 快速录入 | 同一输入框可写 `午饭28块`、`喝了300水`、`10分钟后提醒我开会`，预览确认后写入 |
| 个性化 | 工作台名称与头像、主题预设、强调色、明暗外观、布局密度、本地图片壁纸 |
| 可选联网 | 手动或定位查天气；OpenAI 兼容 API 由用户显式发送 |

## 使用边界

- 提醒依赖页面运行与浏览器权限，关闭页面或系统休眠后不保证准点送达；Service Worker 缓存不等于后台推送。
- 步数为手动填写的当天总数，运动记录独立；热量是 MET 估算，不作医学用途。
- 没有账号、云同步与跨设备同步。清站点数据、换浏览器或域名都可能丢失记录，需自行导出 JSON。
- PWA 首次联网完成缓存后才能离线打开已缓存页面；天气与 AI 不离线工作。
- AI Key 明文保存在本机，同 origin 脚本可读；不要填入生产凭据。

## 本地运行

需要 Node.js 22+：

```bash
npm install
npm start        # http://127.0.0.1:5173
```

持续使用同一 origin，`localhost` 与 `127.0.0.1` 不共享记录。开发模式不注册 Service Worker，正式构建才注册离线壳。

## 构建与测试

```bash
npm test         # Node Test Runner，无需真实天气 / AI 服务
npm run build    # 输出 dist/
```

只部署 `dist/`，不部署仓库根目录。

## 项目结构

```text
index.html               Vue 挂载入口
src/                     Vue 3 组件、组合式状态层与设计令牌
  components/            SideRail、TopBar、CommandPalette、TaskDialog 等
  composables/           useWorkbench（状态与持久化）、useWeather
  views/                 今天、计划、专注、日历、账本、习惯、运动、天气、设置
  styles/                base.css（设计令牌）、glass.css
js/                      纯业务逻辑：core、state、storage、reminders、focus、agent、weather、workspace
tests/                   Node 业务、边界与设计系统测试
tools/                   移动端探测、截图种子与原生配置检查
src-tauri/               Tauri 2 配置（未打包发布）
docs/                    使用指南、第三方声明与发布说明
```

业务状态、存储、计时、命令解析等由 `js/` 中的纯模块管理，`src/composables/useWorkbench.js` 负责接入 Vue 响应式层。

## 文档

- [使用指南](docs/GUIDE.md)
- [构建与发布](docs/PUBLISHING.md)
- [第三方声明](docs/THIRD-PARTY.md)

## License

项目代码采用 [MIT](LICENSE)。`assets/img/*.png` 来自 Twemoji（CC BY 4.0）；`assets/icons/*.svg` 来自 Lucide / Feather（ISC / MIT），授权文本见 [docs/licenses](docs/licenses)。第三方服务与素材不因本项目 MIT 而自动获得同一授权，详见 [第三方声明](docs/THIRD-PARTY.md)。
