# FlowMaster 视觉规范

视觉参考来自同一所有者的 [ThaneJoss/webapps](https://github.com/ThaneJoss/webapps)，读取版本为 `63f5342b503f25f0dffce2abbbe6ceb4737dc2e0`。

参考文件：

- `src/styles.css`：颜色、导航、按钮、标记、字体、动效与无障碍焦点。
- `uno.config.ts`：卡片、边框、阴影和页面留白。
- `src/components/AppHeader.vue` / `src/features/catalog/AppCard.vue`：导航与内容层级。

| 规则 | 采用值 |
| --- | --- |
| 页面底色 | `#f6f7f9` |
| 卡片背景 | `#ffffff` |
| 主文字 | `#182230` |
| 辅助文字 | `#526075` |
| 主色 | `#2563eb` |
| 主色交互 | `#1d4ed8` |
| 激活背景 | `#eff4ff` |
| 边框 | `#e2e6ec` |
| 面板圆角 | `16px` |
| 控件圆角 | `8px` |
| 卡片阴影 | `0 1px 3px rgba(16, 24, 40, 0.04)` |
| 主导航高度 | `72px`（移动端 `64px`） |
| 字体 | Inter / Segoe UI / PingFang SC / Hiragino Sans GB / Microsoft YaHei |
| 常规交互时长 | `180ms` |

`app/globals.css` 保留研究工作区的布局与行为样式，`app/webapps-theme.css` 统一产品各个视图的视觉规则。界面继续采用 FlowMaster 自己的标志，标志主色与圆角与 Web Apps 一致。

本次调整只同步视觉规范，未修改 `webapps` 仓库，也没有复制它的应用目录或修改其站点入口。FlowMaster 的 API、数据结构、Token 权限和 Cloudflare 部署方式保持兼容。
