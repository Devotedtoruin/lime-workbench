# 青柠工作台 · Lime Workbench

本地优先的个人工作与日常事务协同平台（Local-First Personal & Work Operations Workbench）。支持离线任务排期、番茄专注计时、班次与提醒管理、Markdown 结构化工作日报、分类收支账本以及日常健康打卡。无需注册账号，全量业务数据持久化于本地浏览器。

线上演示：<https://devotedtoruin.github.io/lime-workbench/>

技术架构：Vue 3 + Vite，Web / PWA 优先架构；`src-tauri/` 包含 Tauri 2 桌面端与移动端工程配置。

## 核心设计理念

围绕个人日常办公与生活管理的完整时间轴构建闭环：

- **工作排期与规划**：概览当日待办事项、逾期提醒、排班工时进度与下一日程节点。
- **高效执行与记录**：全能自然语言快记框（支持 `/help` 交互式语法速查）、番茄专注计时、工作便签检索、常用链接管理与多类型定时提醒。
- **结构化复盘与汇报**：自动汇总当日/本周已完成事项、进行中任务、专注工时与便签记录，支持生成标准 Markdown 格式工作日报，提供实时预览、一键复制与 `.md` 文件下载。
- **生活与财务管理**：全屏呼吸休息计时、日常饮水与步数追踪、运动记录、周期习惯打卡，以及支持自定义分类与固定周期模板的收支账本。

## 视觉与交互设计系统

- **现代精密线性美学**：遵循 60-30-10 色彩配比，结合克制的半透明毛玻璃表面、1px 边缘折射高光与跟随指针的柔光反馈。
- **物理弹簧微动效**：按钮具备细腻的内高光、悬浮微抬升与按压回弹效果；支持路由视图平滑过渡与任务完成波纹反馈，并完整适配 `prefers-reduced-motion` 无障碍降级。
- **可定制 12 列网格看板**：首页支持按需显隐模块、调整卡片排列顺序与栅格跨度（`1/3`、`1/2`、`2/3`、`通栏`），布局配置自动持久化于本地。
- **等宽数字对齐规范**：所有计时器、财务金额、统计指标与进度百分比均强制采用 `tabular-nums` 等宽数字排版，消除数值变化时的视觉抖动。

## 功能矩阵

| 模块 | 核心能力 |
|---|---|
| 自然语言快记 | 一句话可含多条指令（逗号/分号/空格分隔，或金额等单位后接新任务），逐条预览确认并依次写入；`午饭28块`、`喝了300水`、`10分钟后提醒我开会`；`/help` 打开语法速查面板 |
| 全局快捷键 | `Ctrl/Cmd + K` 命令面板，`N` 新建任务，`F` 专注页，`D` 日报页，`R` 休息模式，`?` 快捷键说明 |
| 外观与个性化 | 工作台名称与个人头像、8 款桌面主题预设、7 种品牌强调色、明暗外观切换、卡片质感、布局密度、玻璃通透度与自定义壁纸 |
| AI 会话 | 命令面板有会话 ID、最近上下文与新会话；同一标签页刷新后仍可继续；AI 返回的多个动作会一起预览并依次执行 |
| AI 配置 | 兼容 OpenAI 接口；可一键探测 `/models` 远端模型（也可在保存后自动读取，可关闭）；地址、模型、Key、人设与会话可一键清除 |
| 可选联网 | 手动或定位查天气；OpenAI 兼容 API 只在明确发送或开启自动读取模型列表时请求 |

## 本地开发

环境要求：Node.js 22+

```bash
npm install
npm start        # 启动本地开发服务器
```

请注意保持使用同一访问源（Origin），`localhost` 与 `127.0.0.1` 的浏览器本地存储相互独立；开发环境下默认不注册 Service Worker。

## 构建与测试

```bash
npm test         # Node Test Runner：业务 / 边界 / 设计系统 / CSP 测试
npm run build    # 编译生产环境静态产物至 dist/（构建后自动写入 CSP）
npm run preview  # 预览生产构建，http://127.0.0.1:4173
npm run gen:meta # 单独重写 index.html 的 CSP 与首帧主题引导脚本
```

生产部署仅需发布 `dist/` 目录。代码推送至主分支后，由 GitHub Actions 自动执行测试、构建与 GitHub Pages 部署。

`package-lock.json` **必须提交**：CI 用 `npm ci` 安装依赖，缺少锁文件会在跑测试之前直接失败。

## 目录结构

```text
index.html               应用挂载入口与元数据声明
src/
  App.vue                应用外壳、全局快捷键、模态框与通知挂载
  components/            顶栏、侧边导航栏、命令面板、任务与记账弹窗等通用组件
  composables/           useWorkbench（响应式状态与操作封装）、useWeather
  views/                 今日 / 任务 / 专注 / 日报 / 日历 / 账本 / 习惯 / 运动 / 天气 / 设置视图
  styles/                base.css（设计系统令牌）、glass.css（表面材质与微动效）
js/                      纯函数业务逻辑：状态校验、本地存储、命令解析、主题色、提醒、专注、账单、天气等
tests/                   Node.js 单元测试套件（覆盖业务规则、边界条件与设计系统约束）
assets/                  矢量图标与视觉素材
public/                  PWA 清单、Service Worker 与应用图标
tools/                   构建检查与辅助脚本（含 CSP/主题元数据生成）
src-tauri/               Tauri 2 跨平台客户端配置
docs/                    使用指南、发布流程与第三方许可声明
```

## 数据安全与隐私声明

- **纯本地存储**：默认无服务端账号与云端同步，结构化数据存储于 `localStorage`，头像与自定义壁纸作为压缩后的本地图片保存（不上传）。
- **数据备份**：清理浏览器站点数据或更换设备前，请通过「设置 → 数据与备份」导出 JSON 备份文件；导入会覆盖当前记录，备份中不含 AI Key 与外观偏好。
- **按需联网**：只有手动查询天气（Open-Meteo / Nominatim）或你明确发送 AI 请求时才出站；CSP 的 `connect-src` 只放行 HTTPS 与本地回环地址。
- **CSP**：`index.html` 与构建后的 `dist/index.html` 都带 `Content-Security-Policy`——脚本仅允许带 nonce 的引导脚本与同源打包产物，`object-src` / `frame-ancestors` / `form-action` 关闭。
- **AI Key 是明文**：保存在 `localStorage`，同源脚本与共享设备可读，不要填入生产凭据；可随时在设置里一键清除。

## 相关文档

- [使用指南](docs/GUIDE.md)
- [构建与发布](docs/PUBLISHING.md)
- [第三方许可声明](docs/THIRD-PARTY.md)
- [辅助工具说明](tools/README.md)

## 开源许可

本项目源码基于 [MIT License](LICENSE) 开源。`assets/img/*.png` 图标源自 Twemoji（CC BY 4.0），`assets/icons/*.svg` 图标源自 Lucide / Feather（ISC / MIT），完整授权文本参见 [docs/licenses](docs/licenses) 与 [第三方声明](docs/THIRD-PARTY.md)。
