# FlowMaster API v1

完整可机器读取的规范：`public/openapi.json`（部署后 `/openapi.json`）。

## 端点

| 方法 | 路径（省略 /api/v1） | 权限 | 用途 |
| --- | --- | --- | --- |
| GET | /health | 公开 | 存活检查，不证明数据库/Secrets 已配置 |
| GET | /workspace | read | 工作区快照 |
| POST | /seed | admin | 向空库导入示例 |
| GET | /projects | read | 查询项目 |
| POST | /projects | write | 创建项目 |
| GET / PUT / DELETE | /projects/{id} | read / write / write | 项目 CRUD |
| GET / POST | /hypotheses | read / write | 查询或创建假设 |
| GET / PUT / DELETE | /hypotheses/{id} | read / write / write | 假设 CRUD |
| POST | /hypotheses/{id}/results | write | 保存实验结果并更新节点 |
| POST | /hypotheses/{id}/run | write | 对指定节点调用模型分析 |
| GET / POST | /experiments | read / write | 查询或创建独立实验记录 |
| GET / PUT / DELETE | /experiments/{id} | read / write / write | 实验 CRUD |
| GET / POST | /resources | read / write | 资源查询或创建 |
| GET / PUT / DELETE | /resources/{id} | read / write / write | 资源 CRUD |
| GET / POST | /tokens | admin | Token 查询或创建 |
| DELETE | /tokens/{id} | admin | 撤销 Token |
| GET / PUT | /settings/model | admin | 模型设置 |
| POST | /settings/model/test | admin | 小型实际模型连接测试 |

所有路径也支持 CORS `OPTIONS`。完整记录更新使用 PUT；不提供 PATCH。节点作为假设的 `nodes` 数组维护，连接作为 `edges` 数组维护。

## 创建一个研究流程

首先创建项目：

```json
{"name":"表征性能研究","description":"对照不同分类头的测试表现"}
```

将返回的项目 ID 填入假设请求 `POST /hypotheses`：

```json
{
  "projectId":"返回的项目ID",
  "title":"分类头未充分利用局部信息",
  "description":"检查不同分类头的性能差异",
  "baseline":"DINOv3 + MLP",
  "status":"pending",
  "nodes":[
    {"id":"baseline","title":"训练基线","type":"baseline","status":"pending","x":40,"y":250},
    {"id":"ablation","title":"分类头消融","type":"experiment","status":"pending","x":240,"y":250},
    {"id":"conclusion","title":"记录结论","type":"conclusion","status":"pending","x":440,"y":250}
  ],
  "edges":[
    {"source":"baseline","target":"ablation"},
    {"source":"ablation","target":"conclusion"}
  ]
}
```

ID 可省略由服务生成；自行提供时只允许字母、数字、下划线、短横线，不超过 100 字符。节点 ID 在一个假设内必须唯一，最多 120 个节点、360 条连线。禁止自环、重复连接、悬空连接和循环依赖。

## 常见错误

| 状态码 | 情形 | 处理 |
| --- | --- | --- |
| 401 | Token 缺失、无效、过期或撤销 | 重新签发或重新连接 |
| 403 | 权限不足 / Origin 未允许 | 更换适当权限的 Token / 配置 ALLOWED_ORIGINS |
| 404 | 记录或接口不存在 | 检查 ID 和路径 |
| 409 | revision 冲突 / 非空项目删除 / 非空库导入 | 刷新最新数据或先处理关联记录 |
| 413 | 请求体超过 600 KB / 快照超过上限 | 缩小输入或使用分页查询 |
| 422 | 字段不合法 / 形成循环依赖 | 根据 error.message 修正输入 |
| 429 | 请求频率超限 | 等待 Retry-After 后重试 |
| 502 | 模型错误、超时或不兼容返回 | 检查 Base URL、Key、模型和额度 |
| 503 | D1、管理员 Secret 或加密 Secret 未配置 | 按部署说明配置并应用迁移 |

自动重试建议仅针对 GET 等幂等读取。创建实验结果或调用模型可能已产生记录/费用，不应盲目重试；先查询已有结果。
