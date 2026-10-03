# Cloudflare 部署与排查

GitHub 检查、生产打包和 Cloudflare 分支预览是不同步骤。先确认失败阶段，再改对应配置；本地构建通过不能证明远端账号权限、预览默认设置或数据库迁移已就绪。

## 构建设置

| 项目 | 配置 |
| --- | --- |
| 根目录 | 仓库根目录 |
| Node.js | `24`，读取 `.node-version`；检查控制台 `NODE_VERSION` 覆盖值 |
| pnpm | `11.25.0`，与 `package.json` 的 `packageManager` 一致；检查 `PNPM_VERSION` 覆盖值 |
| 构建命令 | `pnpm check` |
| 生产部署命令 | `pnpm run deploy` |
| 非生产分支部署命令 | `pnpm run deploy:preview` |
| 生产分支 | `main` |

部署脚本先执行 Vite 构建、校验产物，再调用固定版本的 Wrangler，因此构建阶段无需再次运行 `pnpm build`。必须使用 `pnpm run deploy`，避免与 pnpm 自带的 `deploy` 命令混淆。

Vite、TypeScript、Wrangler 位于 `devDependencies`。安装阶段不能省略开发依赖；自定义安装命令应使用 `pnpm install --frozen-lockfile --prod=false`。保留锁文件与依赖安装安全校验，遇到安装失败先查看具体错误，不要通过关闭校验掩盖问题。

GitHub CI 在 PR 和 `main` push 上执行；它与 Workers Builds 是独立系统。CI 无 Cloudflare 凭证时只执行本地部署诊断。

## 生产与预览配置

| 配置 | 生产 | 分支预览 |
| --- | --- | --- |
| Worker 代码和前端产物 | `worker/index.ts`、`dist/client/` | 使用同一份构建代码 |
| D1 `DB` | `wrangler.jsonc` 顶层 `d1_databases` | `previews.d1_databases` 或控制台的预览默认绑定 |
| `ADMIN_TOKEN` | 生产 Worker Secret | 独立的预览 Secret 默认值 |
| `ALLOWED_ORIGINS` | 顶层 `vars` | `previews.vars` 或预览默认值；同域留空 |

当前仓库没有固定预览数据库 ID，因此依赖 Cloudflare 控制台的预览默认设置。这种配置合法，但本地文件无法证明远端值存在。准备分支预览时：

1. 创建独立的预览 D1 数据库，在该数据库上执行 `drizzle/` 中的迁移。
2. 在预览默认设置中，将绑定名 `DB` 指向该数据库。
3. 为预览配置至少 32 字符的 `ADMIN_TOKEN` Secret。
4. 完成只读诊断，再运行分支预览发布。

生产 `ADMIN_TOKEN`、预览 `ADMIN_TOKEN` 和部署用的 Cloudflare API Token 是不同用途的凭据。将 Secret 配置到相应 Worker 环境，不要提交到 Git。

`pnpm db:migrate:remote` 使用顶层生产 `DB` 配置。迁移预览库时，先在仓库根目录创建独立配置 `wrangler.preview-migrations.jsonc`，填入实际预览数据库名和 UUID；不要填生产数据库 ID：

```json
{
  "name": "flowmaster-preview-migrations",
  "compatibility_date": "2026-05-15",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "flowmaster-preview-db",
    "database_id": "REPLACE_WITH_PREVIEW_DATABASE_UUID",
    "migrations_dir": "drizzle"
  }]
}
```

核对目标后，使用独立配置执行：

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config wrangler.preview-migrations.jsonc
```

远端迁移要求目标数据库出现在所选配置中，仅把命令参数换成一个未配置的数据库名会失败。`migrations_dir` 相对配置文件所在目录解析，因此上述文件应放在仓库根目录。Wrangler D1 的 `--preview` 参数使用 `preview_database_id`，不等价于 Worker 的 `previews.d1_databases`，不能通过给生产迁移命令加 `--preview` 猜测目标。

## 只读诊断

```sh
# 构建并检查生产打包，不上传、不修改数据库
pnpm run deploy:check

# 检查本地配置与已生成的静态资源
pnpm run deploy:doctor

# 使用环境中已有的 CLOUDFLARE_API_TOKEN，只读检查预览默认绑定
pnpm run deploy:doctor --remote
```

诊断命令不创建预览、不上传代码、不迁移数据库，也不输出 Token 或变量值。远端检查需要有读取相应 Worker 配置权限的 Cloudflare API Token；只检查绑定是否存在及类型，不能验证密钥长度、数据库表结构或所有发布权限。

`wrangler preview` 没有 dry-run，且会在打包上传前查询或创建远端预览。不要把它当作无副作用的本地检查，也不要把 `deploy:check` 的成功当作预览部署成功。

## 按失败阶段定位

### 让 agent 或命令行读取 Workers Builds 日志

GitHub 的 Cloudflare check 可能只有构建详情链接，没有日志正文。`wrangler tail` 查看的是 Worker **运行时**日志；本项目固定的 Wrangler 4.92.0 没有读取 Workers Builds 历史构建日志的命令。可以使用以下两种官方途径。

**Agent：Cloudflare Workers Builds MCP**

在支持远程 MCP 和 OAuth 的客户端中连接 `https://builds.mcp.cloudflare.com/mcp`，通过 Cloudflare 登录授权并选择账号。它使用 Streamable HTTP，提供 `workers_builds_list_builds`、`workers_builds_get_build`、`workers_builds_get_build_logs`。已知构建 ID 时，让 agent 调用：

```json
{"buildUUID":"替换为构建详情 URL 最后一段的 UUID"}
```

先用 `workers_builds_get_build` 确认目标构建及实际命令，再用 `workers_builds_get_build_logs` 读取日志。多账号时明确目标账号；连接 MCP 需要在客户端完成，仓库中的应用 MCP 接口不提供 Cloudflare 账号访问能力。参见 [Cloudflare 官方 Workers Builds MCP](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/workers-builds)。

**命令行：只读 Builds API**

在 [Cloudflare 个人 API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建**用户级** Token，授予目标账号的 **Workers CI Read** 权限，并通过环境设置提供 `CLOUDFLARE_API_TOKEN`。Builds API 不支持账号级 Token；这里的读取 Token 与构建系统发布时使用的 build token 不同。已知构建 UUID 时，无需额外授予 Workers Scripts Read 或任何写权限。

```sh
pnpm run builds:logs --account <ACCOUNT_ID> --build <BUILD_UUID>
```

命令先 GET 构建状态，再 GET `/accounts/{account_id}/builds/builds/{build_uuid}/logs`；按 `truncated` 和 `cursor` 读取后续页，拒绝重复或缺失游标。不触发重试或部署，不展开构建详情中的环境变量字段。构建本身失败时，成功取回日志仍退出 0；网络、鉴权或不完整日志会退出非零。运行中的构建只能取得当时的日志快照。

输出会遮蔽当前读取 Token 和 Bearer 值，但无法保证识别构建脚本打印的所有敏感内容；分享前检查日志，不要提交到 Git。详细来源：[Builds API 指南](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) · [获取日志接口及读取权限](https://developers.cloudflare.com/api/resources/workers_builds/subresources/builds/subresources/logs/methods/get/)。

### 对照错误定位

| 失败阶段 | 优先核对 |
| --- | --- |
| 安装依赖 | 日志中的 Node/pnpm 版本、锁文件校验错误、是否省略开发依赖 |
| Vite 构建 | 具体编译错误与缺失模块；是否在仓库根目录执行 |
| Worker 打包 | Wrangler 的具体错误、入口与 `dist/client` 是否存在 |
| 创建或上传预览 | Cloudflare API 错误码、账号/Worker 目标、预览权限及远端限制 |
| 页面可打开但无法登录 | 对应环境的 `DB`、`ADMIN_TOKEN`、D1 迁移和 Origin 设置 |

Wrangler 预览上传成功后，还会读取默认设置来输出绑定警告。后续读取失败也可能使整个命令退出非零，因此应保留“部署成功”信息及最后错误一起判断，不能只看红色状态。

排查时提供构建命令、Node/pnpm 版本、失败阶段最后一段错误及错误码即可。不要粘贴 Token、Authorization 请求头或完整环境变量。
