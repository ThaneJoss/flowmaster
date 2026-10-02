# FlowMaster MCP

对外接口为 `POST /mcp`，采用官方 `@modelcontextprotocol/sdk` 的 Streamable HTTP 传输。浏览器工作区和外部 MCP 客户端使用相同工具。服务不配置或调用 LLM；模型调用由外部客户端自行决定。

## 连接与鉴权

| 项目 | 值 |
| --- | --- |
| 生产地址 | `https://flow.thanejoss.com/mcp` |
| 本地地址 | `http://127.0.0.1:8787/mcp` |
| 请求头 | `Authorization: Bearer <FlowMaster Token>` |
| 内容类型 | `Content-Type: application/json` |
| 接受类型 | `Accept: application/json, text/event-stream` |
| 初始化后的协议头 | `MCP-Protocol-Version: <initialize 协商的版本>` |
| 传输 | 无状态 Streamable HTTP，JSON 响应，无 SSE 会话 |

每个请求均须携带 Token。初始化使用 `initialize`，随后发送 `notifications/initialized`，再调用 `tools/list` 或 `tools/call`；也支持 `ping`。成功通知返回 202，无响应体。`GET /mcp`、`DELETE /mcp` 返回 405；本服务不建立会话，也无需保存 `Mcp-Session-Id`。`GET` / `DELETE` 的 405 响应同样先进行鉴权。`OPTIONS /mcp` 用于浏览器 CORS 预检。每个 HTTP 请求仅支持一条 JSON-RPC 消息，不接受批量数组；请求体最多 600,000 字节，包含 JSON-RPC 外层字段。

管理员使用至少 32 字符的 `ADMIN_TOKEN`，可在界面或通过 `tokens_create` 签发其他 Token。权限分为 `read`、`write`、`admin`；高权限包含低权限能力。签发 Token 的明文只在创建响应中返回一次，列表不返回密钥。

MCP 客户端需手动配置 Bearer Token。本服务不提供 OAuth 或 OAuth 元数据自动发现。Token 不得放入 URL。请求带 `Origin` 时，必须匹配服务同域或 `ALLOWED_ORIGINS` 中的精确 Origin；无 `Origin` 的服务端客户端仍须通过 Token 鉴权。CORS 允许 MCP 所需请求头并暴露 MCP 协议及会话相关响应头。

## 工具

调用格式：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "projects_create",
    "arguments": {
      "data": {
        "name": "表征性能研究",
        "description": "对照不同分类头的测试表现"
      }
    }
  }
}
```

`tools/list` 提供各工具的 `inputSchema`，客户端应据此构造参数。

| 工具 | 参数 | 权限 |
| --- | --- | --- |
| `workspace_get` | `{}` | read |
| `workspace_seed` | `{}`，只向空库导入示例 | admin |
| `projects_list`、`experiments_list` | `{limit?, offset?, q?}` | read |
| `hypotheses_list`、`resources_list` | `{limit?, offset?, q?, projectId?}` | read |
| `projects_get`、`hypotheses_get`、`experiments_get`、`resources_get` | `{id}` | read |
| `projects_create`、`hypotheses_create`、`experiments_create`、`resources_create` | `{data}` | write |
| `projects_update`、`hypotheses_update`、`experiments_update`、`resources_update` | `{id, data}`，`data` 为完整业务记录且包含最新 `revision` | write |
| `projects_delete`、`hypotheses_delete`、`experiments_delete`、`resources_delete` | `{id}` | write |
| `results_create` | `{hypothesisId, data: {nodeId, title, status, summary, duration?}}` | write |
| `tokens_list` | `{}` | admin |
| `tokens_create` | `{data: {name, scope, expiresInDays}}` | admin |
| `tokens_revoke` | `{id}` | admin |

列表默认 `limit: 50`、`offset: 0`；`limit` 为 1–200 的整数，`offset` 为非负整数，`q` 为搜索文本。`projectId` 筛选仅适用于假设和资源。列表成功响应在 `structuredContent.total` 中提供匹配总数。

`workspace_get` 返回 `projects`、`hypotheses`、`experiments`、`resources` 四个数组；快照最多 5,000 条记录及约 8 MB 的记录 JSON，超过后使用列表工具分页。删除非空项目会失败；删除假设会同时删除所属实验记录。

## 业务输入

创建时 `id` 可省略，由服务生成；更新是完整记录替换，需要最新 `revision`，不支持局部 PATCH。`updatedAt` 与新 revision 由服务生成。以下字段之外的具体限制以 `tools/list` 的输入 schema 为准。

| 集合 | 必需字段 | 其他字段 |
| --- | --- | --- |
| projects | `name` | `description` |
| hypotheses | `projectId`、`title`、`status`、`nodes`、`edges` | `description`、`baseline` |
| experiments | `hypothesisId`、`nodeId`、`title`、`status` | `summary`、`source`、`duration`、`logs` |
| resources | `projectId`、`name`、`type` | `url`、`description` |

`status` 为 `pending`、`running`、`verified`、`rejected`。资源 `type` 为 `dataset`、`model`、`document`、`code`；`model` 仅表示资源类别，不提供模型调用。资源 URL 为空或 HTTP(S) 地址，不能包含认证信息。

实验 `source` 默认 `manual`；历史 `agent` 来源用于兼容既有记录，不代表服务仍提供 Agent 执行。`logs` 为 `{time, message}` 数组。通过 `results_create` 录入手动实验时，服务同时更新关联节点状态、摘要与计时，且使用 revision 防止并发覆盖。

节点作为假设的 `nodes` 数组维护，连接作为 `edges` 数组维护。示例：

```json
{
  "name": "hypotheses_create",
  "arguments": {
    "data": {
      "projectId": "返回的项目ID",
      "title": "分类头未充分利用局部信息",
      "description": "检查不同分类头的性能差异",
      "baseline": "DINOv3 + MLP",
      "status": "pending",
      "nodes": [
        {"id": "baseline", "title": "训练基线", "type": "baseline", "status": "pending", "x": 40, "y": 250},
        {"id": "ablation", "title": "分类头消融", "type": "experiment", "status": "pending", "x": 240, "y": 250},
        {"id": "conclusion", "title": "记录结论", "type": "conclusion", "status": "pending", "x": 440, "y": 250}
      ],
      "edges": [
        {"source": "baseline", "target": "ablation"},
        {"source": "ablation", "target": "conclusion"}
      ]
    }
  }
}
```

此示例是 `tools/call` 的 `params`。ID 只允许字母、数字、下划线、短横线，不超过 100 字符。节点 ID 在一个假设内必须唯一，最多 120 个节点、360 条连线。禁止自环、重复连接、悬空连接和循环依赖。

节点 `type` 为 `baseline`、`observation`、`hypothesis`、`experiment`、`conclusion`。除了示例中的必需字段，还可包含 `inputs`、`output`、`summary`、`rationale`、`method`、`conclusion`、`nextAction`、`startedAt`、`duration`，默认空字符串。

`tokens_create` 的 `name` 为 1–80 字符，`scope` 为 `read`、`write`、`admin`，`expiresInDays` 为 1–365 的整数。

## 返回值和错误

工具成功时，JSON-RPC `result` 包含文本 `content` 和结构化 `structuredContent`：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{"type": "text", "text": "{\"data\":[],\"total\":0}"}],
    "structuredContent": {"data": [], "total": 0}
  }
}
```

`data` 为业务对象或数组，只有列表附带 `total`。删除 / 撤销返回 `data: {deleted: true}`。工具执行业务错误时，`result.isError` 为 `true`，结构化错误如下：

```json
{
  "isError": true,
  "content": [{"type": "text", "text": "{\"error\":{\"code\":\"REVISION_CONFLICT\",\"message\":\"记录已更新，请刷新后重试\"},\"status\":409}"}],
  "structuredContent": {
    "error": {"code": "REVISION_CONFLICT", "message": "记录已更新，请刷新后重试"},
    "status": 409
  }
}
```

上述 `status` 是业务状态，不表示该 JSON-RPC 响应的 HTTP 状态。鉴权、Origin、HTTP 传输问题可直接返回 HTTP 错误；协议错误由 JSON-RPC 错误表达；SDK 的参数 schema 校验错误可能只有 `isError: true` 和文本 `content`，不附带 `structuredContent`。客户端应同时处理 HTTP、JSON-RPC 和 `isError` 三层失败，并在缺少结构化错误时读取文本。

| 状态 | 情形 | 处理 |
| --- | --- | --- |
| 401 | Token 缺失、无效、过期或撤销 | 重新签发或重新连接 |
| 403 | 权限不足 / Origin 未允许 | 使用适当权限 Token / 配置 `ALLOWED_ORIGINS` |
| 404 | 记录或端点不存在 | 检查 ID 和 `/mcp` 地址 |
| 405 | 对 `/mcp` 使用 GET 或 DELETE | 使用 Streamable HTTP POST |
| 409 | revision 冲突 / 非空项目删除 / 非空库导入 | 刷新数据或先处理关联记录 |
| 413 | 请求体超过 600 KB / 工作区快照超过上限 | 缩小输入或分页查询 |
| 422 | 字段不合法 / 循环依赖 | 根据错误说明修正输入 |
| 429 | 请求频率超限 | 等待响应指定的重试时间后重试 |
| 503 | D1 或管理员 Secret 未配置 | 配置 `DB`、`ADMIN_TOKEN` 并应用迁移 |

自动重试应限于幂等读取。创建结果、签发 Token 等写入可能已完成，请先查询已有记录，不要盲目重试。

## 从 REST 迁移

旧 `/api`、`/api/*`（含 `/api/v1/*`）和 `/openapi.json` 返回 404。原工作区、集合 CRUD、实验结果和 Token 操作分别对应上述 MCP 工具；使用 `tools/list` 发现接口。原模型设置、连接测试和 Agent 分析功能已删除，没有对应工具。

D1 数据和既有 Token 继续使用，无需重建数据库或修改历史迁移。`ENCRYPTION_KEY`、`MODEL_ALLOWED_HOSTS` 不再是运行要求。历史模型配置行不会被新版本读取或自动删除。
