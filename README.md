# FlowMaster

中文研究工作区：Vue 3 静态前端、Vite 构建、独立 Cloudflare Worker MCP 服务、D1 数据库。

## 功能与数据兼容

- 项目、假设、节点、实验记录和资源管理
- 三栏研究工作区：假设列表、可缩放流程图、节点详情
- 拖动节点、方向键调整位置、按画布宽度换行的自动布局、上游连接编辑与服务端 DAG 校验
- 手动录入实验结果、查看历史日志、JSON 导出
- Token 登录、权限与到期时间、Token 签发和撤销
- 通过 MCP 工具读取和维护工作区，供支持 Streamable HTTP 的客户端使用
- 响应式布局、键盘可操作弹窗和统一的浅灰 / 白色 / 蓝色主题

已移除模型服务配置、模型 API Key 管理、模型连接测试和 Agent 分析。FlowMaster 不再主动调用 LLM API。历史实验的 `source: "agent"` 标记及已有研究内容仍可读取。

**接口兼容性变更：** 对外接口统一为 `/mcp`，前端也通过 MCP 访问工作区。旧 `/api`、`/api/v1/*` 和 `/openapi.json` 返回 404；旧 REST 客户端必须改用 MCP。D1 表结构、数据库 ID 和现有 Token 沿用，无需迁移或重置已有业务数据；历史模型设置不会自动从数据库清除。仍为单个共享工作区，不是多租户系统。

## MCP 接入

服务地址为 `https://flow.thanejoss.com/mcp`，本地为 `http://127.0.0.1:8787/mcp`。使用 Streamable HTTP，每个请求携带 `Authorization: Bearer <FlowMaster Token>`。支持 `initialize`、`notifications/initialized`、`ping`、`tools/list` 和 `tools/call`。

Token 需手动配置：管理员通过 `ADMIN_TOKEN` 登录，在界面或 `tokens_create` 工具中签发 `read`、`write` 或 `admin` Token，再填入 MCP 客户端的 Bearer Token 设置。本服务不提供 OAuth 登录或自动发现；需要客户端支持手动 Bearer Token。不要将 Token 放入 URL 或提交到仓库。

服务使用官方 `@modelcontextprotocol/sdk` 的无状态 Streamable HTTP 传输，返回 JSON，不维护会话或提供 SSE 通知流。`GET /mcp` 和 `DELETE /mcp` 返回 405。完整工具参数、响应格式和迁移说明见 [docs/API.md](docs/API.md)。

## 构建与发布

前端源码位于 `web/`，Vite 输出 `dist/client/`。Worker 源码位于 `worker/index.ts`，由 Wrangler 直接打包。根目录 `wrangler.jsonc` 是唯一 Worker 配置。

发布脚本先运行 Vite，再检查 HTML / JavaScript 产物，最后启动 Wrangler：

- `pnpm run deploy`：构建并发布生产
- `pnpm run deploy:preview`：构建并运行 Wrangler preview
- `pnpm run deploy:check`：构建并进行 Wrangler dry-run，不发布

直接运行 `npx wrangler preview` 不会替你完成这条流程。Wrangler 4.92.0 的 preview 在运行自定义构建之前检查静态资源目录，因此需要先构建前端。

### Cloudflare Git 构建设置

- 根目录：仓库根目录
- 构建命令：`pnpm build`
- 生产部署命令：`pnpm run deploy`
- 非生产分支 / 预览部署命令：`pnpm run deploy:preview`
- 生产分支：`main`
- Node.js：24，pnpm：`package.json` 中固定的 11.25.0

发布脚本会再次构建，确保发布步骤拿到完整产物。仓库提交不会自动修改控制台设置，预览绑定仍由 Cloudflare 的预览配置管理。

## 安装与验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:worker
```

`pnpm test:worker` 会构建 Vue、执行 Wrangler dry-run，再启动隔离的本地 Worker / D1 检查静态资源和 MCP 工作流。CI 不需要生产部署凭据或模型服务凭据。

`pnpm build` 只构建和检查前端产物；`pnpm deploy:check` 还会检查 Worker 打包，均不会发布。本次 MCP 迁移已通过类型检查、前端构建及 Worker dry-run 打包；按要求未运行测试，验证状态见 [docs/VALIDATION.json](docs/VALIDATION.json)。

## 本地开发

1. 将 `.dev.vars.example` 复制为 `.dev.vars`，将 `ADMIN_TOKEN` 替换为至少 32 字符的本地随机值
2. `pnpm db:migrate:local`
3. `pnpm build`
4. 终端一运行 `pnpm dev:api`（Worker 在 8787）
5. 终端二运行 `pnpm dev`（Vite 提供前端，`/mcp` 代理到 8787）

也可以先 `pnpm build`，再 `pnpm start` 预览完整打包后的本地应用。`dev:api` 是本地 Worker 启动脚本的名称，服务对外使用 MCP。

## 已有 Cloudflare 环境

- Worker：`flowmaster`
- 域名：`https://flow.thanejoss.com`
- D1：`flowmaster-db`，绑定 `DB`
- 必需 Secret：`ADMIN_TOKEN`（至少 32 字符）
- `ALLOWED_ORIGINS`：逗号分隔的精确 Origin；前端与 MCP 同域时留空

首次部署新账号时才创建 D1、修改 `wrangler.jsonc` 中账号 / 域名 / 数据库 ID 并执行 `pnpm db:migrate:remote`。现有环境沿用数据库和迁移文件。`ENCRYPTION_KEY` 和 `MODEL_ALLOWED_HOSTS` 已不再使用；服务启动和工具调用不依赖它们。

管理员使用 Worker Secret `ADMIN_TOKEN` 登录，不要使用 Cloudflare API Token。MCP 客户端不带 `Origin` 时仍须提供有效 Token；带 `Origin` 的请求必须来自同域或 `ALLOWED_ORIGINS`。

## 安全与会话

默认只在浏览器当前会话保存连接凭据；“在此设备记住登录”为显式可选项。退出或切换账号时取消旧请求，清空工作区和 Token 列表。已在服务端完成的写入不能通过取消浏览器请求撤销。

前端通过 Vue 文本插值展示研究内容。资源链接仅允许 HTTP(S)，新窗口使用 `noopener/noreferrer`。MCP 工具校验 Origin、权限、输入和 revision；跨域响应允许 MCP 必需请求头并暴露 MCP 响应头。

## 文档

- [docs/API.md](docs/API.md)：MCP 接入、工具与错误说明
- [docs/DESIGN.md](docs/DESIGN.md)：视觉规范
- [docs/VALIDATION.json](docs/VALIDATION.json)：当前变更的验证状态
