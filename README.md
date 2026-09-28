# FlowMaster

根据提供的截图实现研究功能，并采用 [ThaneJoss/webapps](https://github.com/ThaneJoss/webapps) 视觉规范的中文智能研究编排平台。前端、REST API 和 Cloudflare D1 共用同一套研究数据。可部署到你自己的 **Cloudflare Workers + D1**，无需 OpenAI / ChatGPT 的托管服务账号。

## 功能

- 三栏研究界面：项目与假设列表、可缩放流程图、节点详情。
- 项目、假设、节点的创建、编辑和删除；假设搜索与状态筛选。
- 节点拖动、画布平移、缩放、适配、自动布局、上游连线编辑；后端拒绝循环依赖。
- 节点输入/输出、结果摘要、研究思路、结论、后续行动与执行日志。
- 实验结果录入、查询和 JSON 导出；API 可从训练脚本写入结果。
- 数据集、模型、代码和文档的链接/元数据管理。
- REST API、页面内 API 文档和可导入 Postman / Swagger 的 OpenAPI 规范。
- Token 创建、只读/读写/管理员权限、有效期和即时撤销。
- 兼容 Chat Completions 的模型接口；支持配置 Base URL、模型名和调用 Key。
- Agent 分析上下文并保存建议；**不执行训练脚本，不把模型建议标记为实验验证通过**。
- 桌面与移动端布局、键盘操作、确认对话框和错误提示。

首页默认展示与截图对应的**演示工作区**，示例数据可编辑但刷新后还原。连接 API 后，所有研究记录保存在 D1；浏览器存储仅用于选择保留的访问凭据。真实工作区不会被演示数据自动覆盖。

## 界面风格

界面沿用 `webapps` 的浅灰底色（`#f6f7f9`）、白色 16px 圆角卡片、深色正文（`#182230`）、辅助文字（`#526075`）与蓝色主色（`#2563eb`）。导航、按钮、标签、输入框、卡片和减少动态效果的规则保持一致，研究画布和三栏工作流保留。详见 [docs/DESIGN.md](docs/DESIGN.md)。

## 技术栈

React 19 + TypeScript + Vinext/Vite、Shadcn/Radix UI、Cloudflare Workers、D1、Drizzle schema/migrations、Zod。依赖版本由 `pnpm-lock.yaml` 锁定。

## 部署到 Cloudflare

此项目使用 **Workers** 部署完整前后端，不是只上传静态文件的 Pages 项目。

### 当前生产配置

- 访问地址：[https://flow.thanejoss.com](https://flow.thanejoss.com)
- Worker：`flowmaster`
- D1：`flowmaster-db`，绑定名 `DB`，配置中已填写生产数据库 ID。
- 前端与 API 共用上述域名，`ALLOWED_ORIGINS` 留空即可；工作区连接中的服务地址也留空。
- 界面时间统一显示为北京时间（`Asia/Shanghai`），保证 Cloudflare 服务端与浏览器首次渲染一致。
- 管理员 Token 和模型加密密钥通过 Cloudflare Secrets 设置，不写入仓库。

Cloudflare Git 构建参数应设置为：`main` 分支、仓库根目录、构建命令 `pnpm build` 和部署命令 `npx wrangler deploy`（也可使用 `pnpm run deploy`）。根目录的 `wrangler.jsonc` 是唯一的部署配置来源；Vite 直接读取它，生成的部署配置保留账号、域名、D1、`ASSETS` 绑定与 `/api/*` 优先进入 Worker 的规则。更新已有部署时复用数据库与 Secrets，不要重复创建或更换密钥。

`dist/` 是构建产物，不提交到 Git。如果日志在依赖安装完成后直接执行 `npx wrangler deploy`，并报 `dist/server/index.js` 不存在，说明部署前尚未生成产物。根配置的 `build.command` 会让 Wrangler 先运行 `pnpm build`；已经显式构建时，默认部署命令读取 Vite 生成的配置，不重复构建。Cloudflare 控制台的构建命令仍建议明确填写为 `pnpm build`。

以下初始化步骤供首次部署到其他账号时使用；更换账号时需同步修改 `account_id`、数据库 ID 和自定义域名。

### 1. 安装依赖

建议使用 Node.js 24。安装项目指定的 pnpm 版本：

```bash
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

### 2. 登录并创建数据库

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create flowmaster-db --config wrangler.jsonc
```

将上一步返回的 `database_id` 填入配置：

```bash
node scripts/configure-cloudflare.mjs YOUR_D1_DATABASE_UUID
pnpm db:migrate:remote
```

`wrangler.jsonc` 中的 `name` 默认是 `flowmaster`。如果修改数据库名称，请同时修改配置中的 `database_name`。数据库 ID 是资源标识，不是访问凭据。

### 3. 构建并部署

```bash
pnpm build
pnpm deploy:check
pnpm run deploy
```

首次发布时，未设置管理员 Token 的 API 会返回 503，研究数据不会公开。

### 4. 设置服务端 Secrets

生成**两个不同**的随机值，每个至少 32 个字符：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

分别通过交互式输入保存，不要把真实值写进源码或 `wrangler.jsonc`：

```bash
pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc
pnpm exec wrangler secret put ENCRYPTION_KEY --config wrangler.jsonc
```

- `ADMIN_TOKEN`：初始管理员凭据。请自行保存在密码管理器中；首次连接前端时需要使用它。
- `ENCRYPTION_KEY`：加密模型 Key 的独立密钥。更换后需要在设置中重新输入模型 Key。
- `ALLOWED_ORIGINS`：前端与 API 在同一个域名时留空。分开部署时，在配置的 `vars` 中填写允许的**精确 Origin**，多个使用逗号分隔，例如 `https://research.example.com,https://dev.example.com`；不能使用 `*`。
- `MODEL_ALLOWED_HOSTS`：可选的模型服务域名白名单，使用逗号分隔。留空时，管理员可配置公共 HTTPS 域名。

设置 Secrets 后无需重新构建前端。修改 `vars` 后需执行 `pnpm run deploy`。

### 5. 连接工作区

1. 打开 [https://flow.thanejoss.com](https://flow.thanejoss.com)（自行部署到其他账号时使用对应站点 URL）。
2. 进入 **系统设置 → 工作区连接**。
3. 服务地址留空，输入 `ADMIN_TOKEN`，点击“连接工作区”。
4. 如需截图中的示例，点击“导入示例研究”。此操作仅对空工作区可用。
5. 在 **访问 Token** 中为前端日常使用和外部脚本分别签发凭据。完整 Token 只显示一次。
6. 在 **模型接口** 中填写服务商 Base URL（通常以 `/v1` 结尾）、模型 ID 和调用 Key，然后保存并测试。

测试模型连接会发起一次小型真实请求，按模型服务商规则可能计费。没有模型 Key 时，项目、假设、资源和手动实验记录仍可正常使用。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
# 将两个示例 Secret 替换为你自己生成的不同随机值
pnpm db:migrate:local
pnpm dev
```

打开开发服务器显示的本地地址。D1 的本地数据保存在项目的 `.wrangler/state` 中，与线上数据库隔离。不要提交 `.dev.vars`。测试使用独立临时数据库，不会改动真实数据。

构建包检查：

```bash
pnpm build
pnpm test:worker
```

`test:worker` 在本地 Workers 运行时直接请求编译后的入口，检查服务端渲染、静态资源、鉴权与 D1 读写，不等同于浏览器视觉测试。

## API 使用

基础路径：`https://flow.thanejoss.com/api/v1`

所有业务请求携带：

```http
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json
```

正常响应为 `{ "data": ... }`，错误为 `{ "error": { "code": "...", "message": "..." } }`。`GET /health` 无需认证。

| 权限 | 能力 |
| --- | --- |
| `read` | 查询研究项目、假设、实验、资源 |
| `write` | 查询、创建、更新、删除研究记录，运行 Agent 分析 |
| `admin` | 以上所有操作，以及 Token、模型接口、示例导入管理 |

这是**单个共享工作区**。Token 控制操作权限，不隔离不同用户的数据；未实现多租户账号体系。

### 查询假设

```bash
export FLOWMASTER_URL="https://flow.thanejoss.com"
# 在自己的终端设置 FLOWMASTER_TOKEN，请勿提交到代码仓库
curl "$FLOWMASTER_URL/api/v1/hypotheses?limit=50&offset=0" \
  -H "Authorization: Bearer $FLOWMASTER_TOKEN"
```

支持 `limit`（1–200）、`offset`、`q`，以及适用于假设/资源的 `projectId`。响应头 `X-Total-Count` 包含匹配总数。工作区快照 `/workspace` 上限为 5000 条或 8 MB；更大规模请使用分页接口。

### 写入训练结果并更新节点

```bash
curl -X POST "$FLOWMASTER_URL/api/v1/hypotheses/HYPOTHESIS_ID/results" \
  -H "Authorization: Bearer $FLOWMASTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "NODE_ID",
    "title": "CLS 传递性检查",
    "status": "verified",
    "summary": "局部信息可在线性探针中复现，准确率 0.91。",
    "duration": "12 分钟"
  }'
```

状态值：`pending`、`running`、`verified`、`rejected`。此接口在一个数据库事务中保存实验并更新节点。它不会自动改变整个假设的结论状态；请由研究者在“编辑假设”中确认。

### 修改记录

先 `GET /hypotheses/{id}`，保留返回的 `revision`，编辑后将完整对象 `PUT` 到同一路径。服务端会递增版本。缺少或过期的 `revision` 返回 409；刷新后再提交，避免覆盖其他编辑。

直接 `POST /experiments` 只创建实验记录；需要同时更新节点时使用 `/hypotheses/{id}/results`。删除节点保留历史实验；删除假设会删除其所有实验。

完整接口见 [docs/API.md](docs/API.md) 和 [public/openapi.json](public/openapi.json)。站点的“系统设置 → API 文档”提供 cURL、JavaScript、Python 示例。

## 数据和安全实现

- 所有业务 API 强制 Bearer Token；未配置管理员 Secret 时拒绝访问。
- 随机 Token 使用 256 位随机数，数据库仅保存 SHA-256 哈希。
- 模型 Key 使用 AES-GCM 加密保存，查询配置只返回 `hasKey`。
- 模型调用从 Worker 发出，不把已保存的 Key 返回前端；禁止重定向及 IP / 本地域名地址。
- 更换模型服务域名必须重新填写 Key，避免旧 Key 被无意发送到其他服务。
- CORS 精确来源匹配；SQL 预编译；输入校验；D1 外键约束与版本冲突检测。
- 每个 IP 每分钟最多 360 次认证 API 请求；模型测试/分析每个 Token 每类每分钟最多 10 次。
- Token 默认保存在 `sessionStorage`；勾选“记住”后保存在本设备 `localStorage`，断开连接会删除两处凭据。
- 示例工作区不读取真实私密数据；页面服务端渲染也只包含公开示例。

## 文件结构

```text
app/                      页面、样式与 API 路由
components/flowmaster.tsx  工作区和编辑交互
components/flow-canvas.tsx 流程图交互
components/settings-view.tsx 连接、Token、模型与 API 设置
components/ui/            UI 基础组件
lib/server/api.ts         API、鉴权、D1 与模型调用
lib/server/validation.ts  输入校验与流程图约束
lib/demo.ts               截图对应的演示数据
lib/types.ts              前后端共享数据类型
db/schema.ts              D1 数据库结构
drizzle/                  数据库迁移
public/openapi.json       API 规范
wrangler.jsonc            自有 Cloudflare 部署配置
tests/                    API 集成与编译后 Worker 测试
```

仓库包含源码、锁文件、数据库迁移、接口文档和测试。`dist`、依赖目录、真实 Token 和本地数据库不提交到 Git。克隆后按上面的步骤构建，再部署到自己的 Cloudflare 账号。

## 验证与边界

交付时已执行 TypeScript 检查、生产构建、D1 API 集成测试以及编译后 Worker 冒烟测试。模型请求通过模拟服务验证请求格式、鉴权和返回处理，**未使用你的实际服务商 Key 做真实调用**。

生产域名已通过 HTTPS 页面与静态资源、API 鉴权和 D1 读取检查。桌面 Chromium 已验证系统设置导航、管理员连接工作区、读取 Token 列表与断开连接，并检查 UTC 和北京时间环境中的首次渲染。移动端视觉与 WebMCP 尚未验收；WebMCP 在支持的浏览器中暴露“读取假设”和“打开假设”工具。

全仓 ESLint 仍有 31 个既有错误，主要涉及 React Hooks 和 `any` 类型；本次修改文件的 ESLint 检查通过。

资源管理保存链接与元数据，不包含文件上传。Agent 生成研究建议，不托管 Python、GPU 训练或任意脚本；这些任务可在你自己的环境执行，再通过 API 回传结果。

## Cloudflare 官方参考

- [Workers 静态资源与运行逻辑](https://developers.cloudflare.com/workers/static-assets/)
- [D1 数据库迁移](https://developers.cloudflare.com/d1/reference/migrations/)
- [Secrets 配置](https://developers.cloudflare.com/workers/configuration/secrets/)
