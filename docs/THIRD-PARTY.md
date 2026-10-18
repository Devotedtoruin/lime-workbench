# 第三方素材与在线服务

2026-10-16。根目录 [MIT](../LICENSE)适用于项目自身代码；第三方素材和服务适用独立条款，不因项目 MIT 自动改为同一授权。此清单区分**当前公开分发、源码历史保留及在线服务**。

## 当前随应用分发的图标与图像

| 范围 | 来源与许可 | 说明 |
|---|---|---|
| `assets/img/*.png` 中公开清单列出的文件 | [Twemoji](https://github.com/twitter/twemoji)，Twitter, Inc. 及贡献者；[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（[图像许可原文](https://github.com/twitter/twemoji/blob/master/LICENSE-GRAPHICS)） | 原始 72×72 PNG 部分改为语义文件名，例如 `home.png`；仅重命名，不主张原创。再分发保留作者、来源、许可链接及必要修改说明；本文为署名的一部分 |
| `assets/icons/*.svg` 中公开清单列出的文件 | [Lucide Icons](https://lucide.dev/)，ISC；其中部分源自 Cole Bemis 的 Feather Icons，适用附带 MIT | [本地完整 ISC / Feather MIT 文本](licenses/LUCIDE-ISC.txt)随公开分发保留；[上游许可](https://github.com/lucide-icons/lucide/blob/main/LICENSE)。只使用 SVG，不集成 Lucide JS 包 |
| `assets/brand.svg` | 本项目应用图标 / 标识 | 不属于 Lucide 目录或 Twemoji PNG |

当前分发以 Vite 构建产物 `dist/` 为准；构建会把 `assets/` 静态素材整体复制进 `dist/assets`，目录中存在文件即代表会被分发。替换素材或公开商用前仍须核对来源、条款与实际署名。

## 已移除的历史依赖

第四轮曾使用 GridStack 14.0.0（MIT）作为自由布局引擎。当前 Vue 3 版本采用固定自然高度布局，不再加载该库，相关 vendor 文件与声明已从仓库移除。

## 字体与用户媒体

默认使用设备本地 / 系统字体，没有运行时 Google Fonts 或字体 CDN。用户可自行选择本地 WOFF2、图片、动画或视频，选择行为不把文件上传项目或媒体服务器，也不自动授权向他人再分发。

动态原文件、视频和字体 Blob 保存在本机 IndexedDB，**不随业务 JSON 备份**；静态封面可能随身份记录导出。用户应保留原文件，并自行核对字体 / 图片 / 视频的使用权。未来随包附带字体或新素材时，需另审对应许可并保存完整文本。

## 天气与地理编码

- **[Open-Meteo](https://open-meteo.com/en/terms)**：请求会发送经纬度、参数与网络元数据。免费 API 仅限非商业用途且有调用限额；[天气数据 CC BY 4.0](https://open-meteo.com/en/licence)要求来源、许可及必要修改说明。天气页展示 Open-Meteo / CC BY 4.0 链接；首页建议的完整预报与来源在天气页。服务不可用时不提供伪实时天气，离线资源缓存不替代在线数据。
- **[OpenStreetMap Nominatim 公共服务](https://operations.osmfoundation.org/policies/nominatim/)**：城市搜索 / 反地理编码发送查询词或坐标。公共服务整个应用总流量最高每秒 1 次，需有效应用标识、缓存与清晰的 [© OpenStreetMap contributors 署名](https://www.openstreetmap.org/copyright)，禁止不合规自动补全 / 批量查询。当前客户端会话内重复查询去重、串行请求间隔不低于 1.1 秒，天气页显示来源。**这不等于全站统一限流或跨会话持久缓存**；浏览器不能自设 User-Agent，仅依赖 Referer 也不能当成全面合规证明。公众规模发布前应补齐或选择适合规模的服务 / 代理。
- **Geolocation** 需浏览器授权及安全上下文，手动城市不必申请 GPS；保存坐标后，开页可能联网刷新天气。不要声称全部数据永不离开设备。同名城市存在歧义时要求补充省份 / 国家，不自动猜第一项。

以上是当前实现边界，不是对服务条款的法律保证；公开或商业使用前重新核对服务商要求。

## 可选 AI 服务

支持用户自选 OpenAI chat-completions 兼容服务；兼容协议不等于所有厂商原生接口均可用。本地规则无需模型，输入不会自动发送；用户明确点击后才向展示的地址发送文字与认证 Key，附带当日摘要默认关闭，模型写入建议需另行确认。

Key 是 `localStorage` 明文，不是安全密钥托管。同 origin 页面 / 脚本、共享设备或不可信扩展可能访问，生产场景需另评估可信代理与权限控制。费用、数据政策、额度和 CORS 由所选提供方决定；取消或超时不能撤回已被接收的请求。

保存连接不发请求。“测试连接”需另填临时 Key 并确认后才发固定短句，不附个人摘要、不执行动作。**本地合成 HTTP/CORS 验证不证明真实第三方账号、模型或公网 CORS 可用**；真实服务尚无通过结论，不使用用户保存 Key 取证。
