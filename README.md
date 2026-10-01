# FlowMaster

中文研究工作区：Vue 3 静态前端、Vite 构建、独立 Cloudflare Worker API、D1 数据库。没有 React、Next、Vinext、RSC、SSR 或 Cloudflare Vite 插件。

## 功能与数据兼容

- 项目、假设、节点、实验记录和资源管理
- 三栏研究工作区：假设列表、可缩放流程图、节点详情
- 拖动节点、方向键调整位置、自动布局、上游连接编辑与服务端 DAG 校验
- 实验结果录入、历史日志、JSON 导出
- Token 登录、权限与到期时间、Token 签发和撤销
- 模型配置、连接测试、Agent 分析；模型只给建议，不执行训练，也不覆盖真实实验计时
- 响应式布局、键盘可操作弹窗和统一的浅灰 / 白色 / 蓝色主题

沿用现有 /api/v1 接口、D1 SQL 表结构、数据库 ID 和 Secret 名称。无需迁移或重置已有业务数据。仍为单个共享工作区，不是多租户系统。

## 明确的构建与发布流程

前端源码位于 web/，Vite 输出 dist/client/。Worker 源码位于 worker/index.ts，由 Wrangler 直接打包，不依赖前端框架生成 Worker。根目录 wrangler.jsonc 是唯一 Worker 配置。

发布脚本先运行 Vite，再检查 HTML / JavaScript 产物，最后启动 Wrangler：
- pnpm run deploy：构建并发布生产
- pnpm run deploy:preview：构建并运行 wrangler preview
- pnpm run deploy:check：构建并进行 Wrangler dry-run，不发布

直接运行 npx wrangler preview 不会替你完成这条流程。Wrangler 4.92.0 的 preview 在运行自定义构建之前检查静态资源目录；因此根配置不再把 build.command 当作构建兜底，也不创建空目录掩盖缺失产物。

### Cloudflare Git 构建设置

- 根目录：仓库根目录
- 构建命令：pnpm build
- 生产部署命令：pnpm run deploy
- 非生产分支 / 预览部署命令：pnpm run deploy:preview
- 生产分支：main
- Node.js：24，pnpm：package.json 中固定的 11.25.0

发布脚本会再次构建，确保发布步骤本身拿到完整产物。仓库提交不会自动修改控制台设置。预览绑定仍由 Cloudflare 的预览配置管理，不要为测试随意接入生产数据库或真实模型凭据。

## 安装与验证

pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:worker

pnpm test:worker 会构建 Vue、执行 Wrangler dry-run，再启动隔离的本地 Worker / D1 做静态资源、API 鉴权和数据读写检查。API 测试使用模拟模型响应，不会调用真实模型。CI 使用上述命令，不持有生产部署凭据。

pnpm build 只构建和检查前端产物，不发布。
pnpm deploy:check 会在构建后检查 Worker 打包，不发布。

## 本地开发

1. 将 .dev.vars.example 复制为 .dev.vars，填入两个不同的、至少 32 字符的本地测试随机值
2. pnpm db:migrate:local
3. pnpm build
4. 终端一运行 pnpm dev:api（Worker 在 8787）
5. 终端二运行 pnpm dev（Vite 提供前端，/api 代理到 8787）

也可以先 pnpm build，再 pnpm start 预览完整打包后的本地应用。

## 已有 Cloudflare 环境

- Worker：flowmaster
- 域名：https://flow.thanejoss.com
- D1：flowmaster-db，绑定 DB
- 已有 Secrets：ADMIN_TOKEN、ENCRYPTION_KEY
- ALLOWED_ORIGINS 同域留空；MODEL_ALLOWED_HOSTS 可选模型域名白名单

不要重建数据库或更换现有 ENCRYPTION_KEY。首次部署新账号时才创建 D1、修改 wrangler.jsonc 中账号/域名/数据库 ID 并执行 pnpm db:migrate:remote。

管理员使用 Worker Secret ADMIN_TOKEN 登录，不要使用 Cloudflare API Token。模型 Key 通过设置界面提交，服务端加密保存。模型连接测试和 Agent 分析会调用所配置的服务并可能收费。

## 安全与会话

默认只在浏览器当前会话保存连接凭据；“在此设备记住登录”为显式可选项。退出或切换账号时取消旧请求，清空工作区、模型设置和 Token 列表。已在服务端完成的写入不能通过取消浏览器请求撤销。

前端通过 Vue 文本插值展示研究内容，不把模型响应或资源描述作为 HTML 注入。资源链接仅允许 HTTP(S)，新窗口使用 noopener/noreferrer。业务 API 校验 Origin、权限、输入和 revision。

## 文档

- docs/API.md：接口说明
- web/public/openapi.json：OpenAPI 3.0.3 规范
- docs/DESIGN.md：视觉规范
- docs/VALIDATION.json：本次重写的验证状态

本分支是架构重写，需要通过远端 CI 及浏览器功能验收后再合并。旧 React 版本的测试通过记录不能当作 Vue 版的验证结果。
