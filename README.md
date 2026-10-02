# FlowMaster

中文研究工作区，以“项目 → 流程 → 步骤 → 执行记录”组织研究。Vue 3 / Vite 提供静态前端，Cloudflare Worker 通过 MCP 工具访问 D1。所有 Token 访问同一个共享工作区。

连接工作区后创建项目，在“流程”组织步骤与依赖，录入真实执行记录，在“记录”回溯历史，在“资料”维护引用资源。Token 和 MCP 接入集中在“连接与设置”。执行记录是结果的事实来源，步骤展示所选记录的结果。

画布支持拖动、键盘移动、缩放和按宽度换行布局。工作区按项目加载，记录按需分页，写入增量更新；导出会读取全部所需页。服务不调用 LLM 或执行实验，保留历史模型建议。

## MCP 接入

服务地址为 `https://flow.thanejoss.com/mcp`，本地为 `http://127.0.0.1:8787/mcp`。使用 Streamable HTTP，每个请求携带 `Authorization: Bearer <FlowMaster Token>`，响应为 JSON，无 SSE 会话。

管理员使用 `ADMIN_TOKEN` 连接，在设置或 `tokens_create` 中签发 read / write / admin Token，再手动配置到 MCP 客户端。不提供 OAuth 自动发现；不要将 Token 放入 URL。工具与兼容规则见 [API.md](docs/API.md) 和 [MIGRATION.md](docs/MIGRATION.md)。

旧 REST `/api/*` 和 OpenAPI 文档已关闭。已有 MCP CRUD、D1 数据及 Token 保留，本轮无需新增数据库迁移。

## 本地开发

推荐 Node.js 24，最低版本见 `package.json`；pnpm 固定为 11.25.0。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

将 `.dev.vars` 的 `ADMIN_TOKEN` 替换为至少 32 字符的随机值，然后：

```sh
pnpm db:migrate:local
pnpm build
```

终端一运行 `pnpm dev:api`，Worker 监听 8787；终端二运行 `pnpm dev`，Vite 将 `/mcp` 代理到 Worker。也可构建后运行 `pnpm start` 预览打包应用。`dev:api` 是启动脚本名，对外协议仍为 MCP。

## 构建与发布

前端位于 `web/`，输出到 `dist/client/`；Worker 入口为 `worker/index.ts`。根目录 `wrangler.jsonc` 是唯一 Worker 配置。

| 命令 | 用途 |
| --- | --- |
| `pnpm check` | TypeScript 检查 |
| `pnpm build` | 构建并检查前端产物 |
| `pnpm run deploy:check` | 构建与 Wrangler dry-run，不发布 |
| `pnpm run deploy:preview` | 构建并运行 Wrangler preview |
| `pnpm run deploy` | 构建并发布生产 |
| `pnpm test` | 单元及集成测试脚本 |
| `pnpm test:worker` | 构建、Worker dry-run 与隔离本地 Worker / D1 检查 |

发布脚本先构建并检查产物，再启动 Wrangler。直接运行 `npx wrangler preview` 不会完成前端构建。

Cloudflare Git 构建使用仓库根目录、构建命令 `pnpm build`、生产命令 `pnpm run deploy`、预览命令 `pnpm run deploy:preview`，生产分支 `main`。提交代码不会自动修改控制台配置。

## Cloudflare 配置

- Worker：`flowmaster`，域名：`https://flow.thanejoss.com`
- D1：`flowmaster-db`，绑定 `DB`
- Secret：`ADMIN_TOKEN`，至少 32 字符；这不是 Cloudflare API Token
- `ALLOWED_ORIGINS`：逗号分隔的精确 Origin，同域留空

现有环境沿用数据库与迁移。首次部署到新账号时才创建 D1、修改 Wrangler 账号 / 域名 / 数据库 ID，并运行 `pnpm db:migrate:remote`。`ENCRYPTION_KEY`、`MODEL_ALLOWED_HOSTS` 已不再使用。

## 文档

- [MCP 工具与响应](docs/API.md)
- [架构、加载与导出边界](docs/ARCHITECTURE.md)
- [交互与视觉规范](docs/DESIGN.md)
- [兼容迁移与手动验收清单](docs/MIGRATION.md)
- [验证状态](docs/VALIDATION.json)
