# FlowMaster MCP

对外接口为 `POST /mcp`，采用官方 `@modelcontextprotocol/sdk` 的无状态 Streamable HTTP 传输。浏览器工作区和外部 MCP 客户端使用相同工具。服务不配置或调用 LLM，也不实际执行实验。

## 连接与鉴权

| 项目 | 值 |
| --- | --- |
| 服务地址 | `https://flow.thanejoss.com/mcp` |
| 本地地址 | `http://127.0.0.1:8787/mcp` |
| 鉴权 | `Authorization: Bearer <FlowMaster Token>` |
| 内容类型 | `Content-Type: application/json` |
| 接受类型 | `Accept: application/json, text/event-stream` |
| 初始化后的协议头 | `MCP-Protocol-Version: <initialize 协商的版本>` |
| 传输 | 无状态 Streamable HTTP，JSON 响应，无 SSE 会话 |

每个请求均须携带 Token。先 `initialize`，再发送 `notifications/initialized`，随后使用 `tools/list`、`tools/call`；也支持 `ping`。成功通知返回 202，无响应体。`GET /mcp`、`DELETE /mcp` 在鉴权后返回 405；`OPTIONS /mcp` 用于 CORS 预检。每个 HTTP 请求只接受一条 JSON-RPC 消息，不接受批量数组，请求体上限为 600,000 字节，包含协议外层字段。

管理员使用至少 32 字符的 `ADMIN_TOKEN`，可在界面或 `tokens_create` 中签发其他 Token。权限为 `read`、`write`、`admin`，高权限包含低权限能力。Token 明文只在创建响应中返回一次，列表只返回元信息。

客户端需手动配置 Bearer Token；不提供 OAuth 或自动发现。Token 不得放入 URL。带 `Origin` 的请求必须来自同域或 `ALLOWED_ORIGINS` 中的精确 Origin；无 `Origin` 的服务端客户端仍须鉴权。CORS 允许 MCP 所需请求头并暴露协议相关响应头。

## 领域名称

界面的“项目 / 流程 / 步骤 / 执行记录 / 资料”分别对应 `projects / hypotheses / nodes / experiments / resources`。工具保留原名称以兼容已有客户端。`tools/list` 的输入 schema 是参数限制的依据。

## 读取工具

| 工具 | 参数 | 权限 |
| --- | --- | --- |
| `projects_list` | `{limit?, offset?, q?}` | read |
| `hypotheses_list` | `{limit?, offset?, q?, projectId?, status?}` | read |
| `resources_list` | `{limit?, offset?, q?, projectId?}` | read |
| `experiments_list` | `{limit?, offset?, q?, projectId?, hypothesisId?, nodeId?, status?}` | read |
| `projects_get`、`hypotheses_get`、`experiments_get`、`resources_get` | `{id}` | read |
| `workspace_get` | `{}`，兼容全工作区快照 | read |
| `tokens_list` | `{}` | admin |

列表默认 `limit: 50`、`offset: 0`；`limit` 为 1–200 的整数，`offset` 为非负整数，`q` 为搜索文本。多条件组合用于缩小范围，例如项目 + 流程 + 步骤 + 状态。`nodeId` 可能只在所属流程内唯一，读取单步骤历史时同时提供 `hypothesisId`。列表返回 `{data: [], total, nextOffset}`，`total` 表示匹配记录总数。执行记录按固定录入时间倒序，再按 ID 排序；修订不会把它移到最新录入位置，旧记录使用兼容推断时间。其他集合按 `updatedAt` 倒序及 ID 排序。

列表同时受条数与 UTF-8 JSON 字节数限制，一页少于 `limit` 条也可能有下一页。`nextOffset` 为下一次请求的 `offset`，为 `null` 才表示末页。客户端必须保留筛选条件并使用返回的 `nextOffset`；不能以短页判断结束，也不能自行将 `offset` 加上请求的 `limit`。

```json
{"data": [{"id": "example", "name": "示例项目"}], "total": 8, "nextOffset": 1}
```

后续请求保留原筛选条件并传入 `offset: 1`。单页 `structuredContent` 控制在 1,000,000 字节以内；MCP 文本结果和协议封装会增加实际传输字节数。分页期间其他客户端的增删改可能改变排序与总数，列表和分页导出都不是固定时点快照。

`workspace_get` 返回四类集合：`projects`、`hypotheses`、`experiments`、`resources`，保留 5,000 条记录 / 8,000,000 UTF-8 字节记录 JSON 的上限。大工作区请分页读取；浏览器登录和完整导出不依赖该快照工具。

## 项目、流程与资料写入

| 工具 | 参数 | 权限 |
| --- | --- | --- |
| `projects_create`、`hypotheses_create`、`resources_create` | `{data}` | write |
| `projects_update`、`hypotheses_update`、`resources_update` | `{id, data}`，待更新字段及最新 revision | write |
| `projects_delete`、`hypotheses_delete`、`resources_delete` | `{id}` | write |
| `workspace_seed` | `{}`，只向空库导入示例 | admin |

创建时 ID 可省略，由服务生成。更新支持部分字段，`data.revision` 必需；未提供字段沿用既有值，也兼容旧客户端的完整记录输入。`updatedAt` 和新 revision 由服务维护。合并后的单条文档 JSON 不得超过 600,000 UTF-8 字节，小补丁也受此限制，超限返回 `DOCUMENT_TOO_LARGE` / 413。项目必需 `name`；流程必需 `projectId`、`title`、`status`、`nodes`、`edges`；资料必需 `projectId`、`name`、`type`。具体可选字段见 schema。

资料 `type` 为 `dataset`、`model`、`document`、`code`；`model` 只是类别，不提供模型调用。资料 URL 为空或不含认证信息的 HTTP(S) 地址。步骤 / 记录通过 `resourceIds` 引用同项目资料；`resourceIds` 最多 50 项且不重复。被引用资料不能删除或移动到其他项目。

非空项目不能删除。删除流程会删除其执行记录，响应附带删除记录 ID，供客户端同步清理缓存。删除步骤则保留历史，二者语义不同。

## 步骤工具

所有步骤写入均需 `write` 权限和所属流程的最新 `revision`，成功后 `data` 返回更新后的完整流程。每次接续写入使用返回的新 revision。

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `nodes_create` | `{hypothesisId, revision, node}` | 添加完整步骤 |
| `nodes_update` | `{hypothesisId, revision, nodeId, patch, upstream?}` | 编辑步骤属性及可选上游依赖 |
| `nodes_move` | `{hypothesisId, revision, nodeId, x, y}` | 移动单个步骤 |
| `nodes_layout` | `{hypothesisId, revision, positions: [{id, x, y}]}` | 保存全部步骤坐标，各 ID 恰好一次 |
| `nodes_delete` | `{hypothesisId, revision, nodeId}` | 删除步骤及相关依赖，保留记录 |
| `nodes_select_result` | `{hypothesisId, revision, nodeId, resultId}` | 选择真实当前结果，`null` 为清空 |

节点类型为 `baseline`、`observation`、`hypothesis`、`experiment`、`conclusion`。节点的 `progress` 为 `pending`、`in_progress`、`completed`，表示执行进度；`status` 仍为 `pending`、`running`、`verified`、`rejected`，用于兼容结果结论，二者含义不同。

`nodes_update.patch` 不接受 `id`、`x`、`y`、`currentResultId`、`status`、`summary`、`duration`。位置和当前结果使用专用工具，结果字段通过记录操作维护。`upstream` 提供完整上游步骤 ID 数组，省略时不改依赖。已有当前结果时，`status`、`summary`、`duration` 由当前记录派生，步骤编辑不能将它们改成另一份结果。

ID 只允许字母、数字、下划线、短横线，不超过 100 字符。步骤 ID 在流程内唯一；最多 120 个步骤、360 条依赖，禁止自环、重复、悬空连接和循环依赖。

创建新步骤时，结果初始化为 `status: "pending"`、空摘要和空耗时，`progress` 未提供时为 `pending`，`currentResultId` 为 `null`。旧步骤缺少 `progress` 时继续保持未设置，不根据结果结论推断执行进度。

`hypotheses_update` 可只更新流程元信息，无需再次携带整张图；旧整流程更新继续支持，但同样保护当前结果关联与派生值。既有 `progress`、`resourceIds` 不会仅因旧客户端省略字段而丢失；新客户端优先使用步骤工具，降低整份记录替换的范围。

## 执行记录与当前结果

| 工具 | 参数 | 权限 |
| --- | --- | --- |
| `results_create` | `{hypothesisId, data: {nodeId, title, status, summary, duration?, resourceIds?}}` | write |
| `experiments_create` | `{data}`，完整执行记录输入 | write |
| `experiments_update` | `{id, data}`，待更新字段及最新 revision | write |
| `experiments_delete` | `{id}` | write |

`results_create` 与兼容的 `experiments_create` 都要求非空摘要，新结果为 `source: "manual"`，关联实际步骤并设为当前结果。执行记录是结果的事实来源；步骤 `currentResultId` 指向它，`status`、`summary`、`duration` 是同步维护的兼容投影。

修正当前记录会原子更新记录及流程，修正非当前记录不覆盖当前结果。删除当前记录会令步骤 `currentResultId: null`、`status: "pending"`、`summary: ""`、`duration: ""`，不会自动挑选另一条历史记录。`nodes_select_result` 可显式选择同一步骤的真实历史记录；不能选择 `source: "agent"` 的历史建议。

`recordedAt` 由服务生成，表示录入时间；修正不改变它。旧数据缺失或无效时使用首个有效 ISO 日期日志时间，或回退到旧 `updatedAt`，并返回 `recordedAtInferred: true`；新记录为 `false`。修订保留该标记，不把推断时间伪装为实测时间。`nodeTitle` 记录步骤标题快照。既有记录的 `hypothesisId`、`nodeId`、`source`、`recordedAt`、`nodeTitle` 不能被修订改写。新建记录不信任客户端提供的 `recordedAt`；`results_create` 不接受 `startedAt` 或 `recordedAt`。

步骤 `startedAt` 是用户维护的实际开始时间，创建 / 修正 / 删除结果不会以录入时间覆盖它。删除步骤后，其历史记录仍可修正结果内容和资料引用，并通过 `nodeTitle` 说明原归属；不能向已删除步骤创建新记录。

历史 `source: "agent"` 继续可读，不能伪造新建、改成另一来源或设为真实当前结果。没有 `currentResultId` 的旧步骤保留旧摘要；显式 `null` 则代表已清空当前结果。详见 [兼容说明](MIGRATION.md)。

调用示例（`tools/call` 的完整消息）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "results_create",
    "arguments": {
      "hypothesisId": "flow_1",
      "data": {
        "nodeId": "baseline",
        "title": "基线执行第 1 次",
        "status": "verified",
        "summary": "完成对照实验并记录指标。",
        "duration": "42 分钟",
        "resourceIds": ["dataset_1"]
      }
    }
  }
}
```

## Token 管理

`tokens_create` 接受 `{data: {name, scope, expiresInDays}}`；`name` 为 1–80 字符，`scope` 为 `read`、`write`、`admin`，`expiresInDays` 为 1–365 的整数。`tokens_revoke` 接受 `{id}`。两者以及 `tokens_list` 均需管理员权限。

## 返回值与增量更新

工具结果包含文本 `content` 和结构化 `structuredContent`。兼容 `data` 原有形状，新增元信息置于同级：

| 操作 | `structuredContent` |
| --- | --- |
| 单条读取 / 集合创建更新 | `{data: 业务记录}` |
| 列表 | `{data: 业务记录[], total, nextOffset}` |
| 步骤操作 | `{data: 更新后的Hypothesis}` |
| `results_create`、`experiments_create/update` | `{data: 执行记录, affectedHypothesis}` |
| `experiments_delete` | `{data: {deleted: true, id, collection}, affectedHypothesis}` |
| `hypotheses_delete` | `{data: {deleted: true, id, collection}, deletedExperimentIds}` |
| 其他集合删除 | `{data: {deleted: true, id, collection}}` |

`affectedHypothesis` 表示同步更新的流程。客户端可合并返回记录和流程，无需每次回读全库。旧客户端只读 `data` 仍能使用 CRUD；新增字段不能视为另一条独立工具响应。Token 撤销返回 `{data: {deleted: true, id}}`，不适用业务集合缓存元信息。

工具执行业务错误时，`result.isError: true`，结构化内容为：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "记录已更新，请刷新后重试"
  },
  "status": 409
}
```

此 `status` 是业务状态，不是 JSON-RPC 响应的 HTTP 状态。鉴权 / Origin / 传输问题可能直接返回 HTTP 错误；协议错误通过 JSON-RPC 表达；SDK schema 校验错误可能只有 `isError` 和文本，无结构化错误。客户端应处理这三层失败。

| 状态 | 情形 | 处理 |
| --- | --- | --- |
| 401 | Token 缺失、无效、过期、撤销 | 重新连接或签发 Token |
| 403 | 权限不足 / Origin 未允许 | 使用合适权限 / 配置 Origin |
| 404 | 记录或端点不存在 | 检查 ID 和 `/mcp` 地址 |
| 405 | 对 `/mcp` 使用 GET / DELETE | 使用 POST |
| 409 | revision 冲突、删除关联数据受限等 | 读取最新记录，处理关联后再操作 |
| 413 | 请求体、合并后文档或旧快照超限 | 缩小记录 / 请求，快照改为分页读取 |
| 422 | 字段、引用、步骤依赖不合法 | 根据错误说明修改输入 |
| 429 | 请求频率超限 | 等待重试时间 |
| 503 | DB 或 ADMIN_TOKEN 未配置 | 配置绑定与 Secret |

写入返回不确定时，先查询已有结果，不盲目重试创建记录或签发 Token。revision 冲突需要核对新内容，不应自动以旧数据覆盖。

## 兼容边界

`/api`、`/api/*`、`/openapi.json` 仍返回 404。既有 MCP CRUD 工具保留，但须遵守统一的结果和关联规则。没有模型配置、连接测试或 Agent 分析工具。D1 数据、既有 Token 及历史迁移保留；新增业务字段不要求新建数据库。完整迁移说明见 [MIGRATION.md](MIGRATION.md)。
