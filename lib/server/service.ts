import { z } from "zod";
import { demoWorkspace } from "../demo.ts";
import type { Collection, Experiment, FlowNode, Hypothesis, Workspace } from "../types.ts";
import { schemas, tokenSchema, resultSchema, nodeOperationSchemas } from "./validation.ts";
import { fail, hash, now, requireScope, type Bindings, type Principal } from "./auth.ts";

export interface ServiceResult<T = unknown> {
    data: T;
    status?: number;
    total?: number;
    affectedHypothesis?: Hypothesis;
    deletedExperimentIds?: string[];
}
interface Row { id: string; kind: Collection; data: string; revision: number; updated_at: string }
type Document = Record<string, any>;
type NodeOperation = keyof typeof nodeOperationSchemas;
const encoder = new TextEncoder();
function serializeDocument(value: Document): string {
    const serialized = JSON.stringify(value);
    if (encoder.encode(serialized).byteLength > 600000) fail(413, "DOCUMENT_TOO_LARGE", "单条研究记录超过 600 KB，请减少字段内容或拆分研究流程");
    return serialized;
}
const collections = new Set<Collection>(["projects", "hypotheses", "experiments", "resources"]);
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => {
    const result = schema.safeParse(value);
    if (!result.success) fail(422, "VALIDATION_ERROR", result.error.issues.slice(0, 3).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；"));
    return result.data;
};
const validTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function unpack(row: Row): Document {
    const record = { ...JSON.parse(row.data), id: row.id, revision: row.revision, updatedAt: row.updated_at };
    if (row.kind === "experiments" && !validTime(record.recordedAt)) {
        const first = record.logs?.find((log: { time?: string }) => validTime(log.time))?.time;
        record.recordedAt = first ? new Date(first).toISOString() : row.updated_at;
        record.recordedAtInferred = true;
    }
    return record;
}
const resourceIds = (record: Document): string[] => record.resourceIds || [];
const hypothesisResources = (h: Hypothesis): string[] => [...new Set(h.nodes.flatMap(resourceIds))];
const resourceGuard = "NOT EXISTS (SELECT 1 FROM json_each(?) ref LEFT JOIN documents r ON r.id = ref.value AND r.kind = 'resources' AND r.project_id = ? WHERE r.id IS NULL)";
const referencedResource = `(EXISTS (SELECT 1 FROM documents h, json_each(h.data, '$.nodes') n, json_each(n.value, '$.resourceIds') ref WHERE h.kind = 'hypotheses' AND ref.value = ?) OR EXISTS (SELECT 1 FROM documents e, json_each(e.data, '$.resourceIds') ref WHERE e.kind = 'experiments' AND ref.value = ?))`;
const recordTime = `COALESCE(CASE WHEN json_extract(data, '$.recordedAt') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' AND julianday(json_extract(data, '$.recordedAt')) IS NOT NULL THEN json_extract(data, '$.recordedAt') END, (SELECT json_extract(log.value, '$.time') FROM json_each(data, '$.logs') log WHERE json_extract(log.value, '$.time') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' AND julianday(json_extract(log.value, '$.time')) IS NOT NULL ORDER BY CAST(log.key AS INTEGER) LIMIT 1), updated_at)`;
const clearedResult = { currentResultId: null, status: "pending" as const, summary: "", duration: "" };
const projection = (record: Experiment) => ({ currentResultId: record.id, status: record.status, summary: record.summary, duration: record.duration });

export function createWorkspaceService(env: Bindings, principal: Principal) {
    const db = env.DB;
    const requireWrite = () => requireScope(principal.scope, "write");
    const kindCheck = (kind: Collection) => { if (!collections.has(kind)) fail(404, "NOT_FOUND", "记录类型不存在"); };
    async function rawGet(kind: Collection, id: string): Promise<Document | null> {
        const row = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents WHERE kind = ? AND id = ?").bind(kind, id).first<Row>();
        return row ? unpack(row) : null;
    }
    async function required(kind: Collection, id: string): Promise<Document> {
        const item = await rawGet(kind, id);
        return item || fail(404, "NOT_FOUND", "记录不存在");
    }
    async function children(hypothesisId: string): Promise<Experiment[]> {
        const rows = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents WHERE kind = 'experiments' AND parent_id = ? ORDER BY updated_at DESC,id").bind(hypothesisId).all<Row>();
        return rows.results.map(unpack) as Experiment[];
    }
    async function withSnapshots(items: Document[], hypotheses?: Hypothesis[]): Promise<Document[]> {
        const ids = [...new Set(items.filter(item => !item.nodeTitle).map(item => item.hypothesisId))];
        let available = hypotheses;
        if (!available && ids.length) {
            const rows = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents WHERE kind = 'hypotheses' AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<Row>();
            available = rows.results.map(unpack) as Hypothesis[];
        }
        const byId = new Map((available || []).map(h => [h.id, h]));
        return items.map(item => ({ ...item, nodeTitle: item.nodeTitle || byId.get(item.hypothesisId)?.nodes.find(n => n.id === item.nodeId)?.title || `已删除节点 (${item.nodeId})` }));
    }
    function revision(record: Document, expected: unknown) {
        if (!Number.isInteger(expected) || expected !== record.revision) fail(409, "REVISION_CONFLICT", "记录已更新或缺少 revision，请刷新后重试");
    }
    function updated(record: Document, value: Document, stamp = now()) {
        return { ...value, id: record.id, revision: record.revision + 1, updatedAt: stamp };
    }
    function updateStatement(kind: Collection, item: Document, expected: number, extra = "", params: unknown[] = []) {
        return db.prepare(`UPDATE documents SET data = ?, project_id = ?, parent_id = ?, revision = revision + 1, updated_at = ? WHERE kind = ? AND id = ? AND revision = ? ${extra}`)
            .bind(serializeDocument(item), item.projectId || null, item.hypothesisId || null, item.updatedAt, kind, item.id, expected, ...params);
    }
    async function checkResources(ids: string[], projectId: string) {
        if (!ids.length) return;
        const invalid = await db.prepare("SELECT ref.value AS id FROM json_each(?) ref LEFT JOIN documents r ON r.id = ref.value AND r.kind = 'resources' AND r.project_id = ? WHERE r.id IS NULL LIMIT 1").bind(JSON.stringify([...new Set(ids)]), projectId).first();
        if (invalid) fail(422, "RESOURCE_PROJECT_MISMATCH", "关联资料必须存在且属于同一项目");
    }
    async function checkReferences(id: string) {
        const row = await db.prepare(`SELECT 1 AS used WHERE ${referencedResource}`).bind(id, id).first();
        if (row) fail(409, "RESOURCE_IN_USE", "资料仍被步骤或实验记录引用，请先解除关联");
    }
    async function conflict(changed: number | undefined) {
        if (!changed) fail(409, "REVISION_CONFLICT", "记录、关联资料或研究流程已变化，请刷新后重试");
    }
    async function snapshot(): Promise<ServiceResult<Workspace>> {
        const size = await db.prepare("SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM documents").first<{ bytes: number }>();
        if ((size?.bytes || 0) > 8000000) fail(413, "WORKSPACE_TOO_LARGE", "工作区超过整表加载上限，请使用分页工具读取");
        const rows = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents ORDER BY updated_at DESC,id LIMIT 5001").all<Row>();
        if (rows.results.length > 5000) fail(413, "WORKSPACE_TOO_LARGE", "工作区超过整表加载上限，请使用分页工具读取");
        const data: Workspace = { projects: [], hypotheses: [], experiments: [], resources: [] };
        for (const row of rows.results) (data[row.kind] as Document[]).push(unpack(row));
        data.experiments = await withSnapshots(data.experiments, data.hypotheses) as Experiment[];
        return { data };
    }
    async function list(kind: Collection, options: Record<string, unknown> = {}): Promise<ServiceResult<Document[]>> {
        kindCheck(kind);
        const query = parse(z.object({
            limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
            q: z.string().max(200).optional(), projectId: z.string().optional(), hypothesisId: z.string().optional(), nodeId: z.string().optional(),
            status: z.enum(["pending", "running", "verified", "rejected"]).optional(),
        }), options);
        const where = ["kind = ?"], params: unknown[] = [kind];
        if (query.q) { where.push("data LIKE ?"); params.push(`%${query.q}%`); }
        if (query.projectId) {
            where.push(kind === "experiments" ? "parent_id IN (SELECT id FROM documents WHERE kind = 'hypotheses' AND project_id = ?)" : kind === "projects" ? "id = ?" : "project_id = ?");
            params.push(query.projectId);
        }
        if (query.hypothesisId && kind === "experiments") { where.push("parent_id = ?"); params.push(query.hypothesisId); }
        if (query.nodeId && kind === "experiments") { where.push("json_extract(data,'$.nodeId') = ?"); params.push(query.nodeId); }
        if (query.status) { where.push("json_extract(data,'$.status') = ?"); params.push(query.status); }
        const condition = where.join(" AND ");
        const order = kind === "experiments" ? `julianday(${recordTime}) DESC,id` : "updated_at DESC,id";
        const results = await db.batch([
            db.prepare(`SELECT id,kind,data,revision,updated_at FROM documents WHERE ${condition} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, query.limit, query.offset),
            db.prepare(`SELECT count(*) AS total FROM documents WHERE ${condition}`).bind(...params),
        ]);
        let items = (results[0].results as unknown as Row[]).map(unpack);
        if (kind === "experiments") items = await withSnapshots(items);
        return { data: items, total: Number((results[1].results[0] as { total: number }).total) };
    }
    async function get(kind: Collection, id: string): Promise<ServiceResult<Document>> {
        kindCheck(kind);
        const data = await required(kind, id);
        return { data: kind === "experiments" ? (await withSnapshots([data]))[0] : data };
    }
    async function saveHypothesis(current: Hypothesis, input: unknown, allowSelection = false): Promise<ServiceResult<Hypothesis>> {
        const raw = parse(z.record(z.unknown()), input);
        revision(current, raw.revision);
        const value = parse(schemas.hypotheses, { ...current, ...raw });
        if (value.id && value.id !== current.id) fail(422, "ID_MISMATCH", "请求中的 ID 与记录不一致");
        await required("projects", value.projectId);
        const previousNodes = new Map(current.nodes.map(node => [node.id, node]));
        value.nodes = value.nodes.map(node => {
            const previous = previousNodes.get(node.id);
            if (!previous) {
                if (node.currentResultId) fail(422, "RESULT_SELECTION_REQUIRED", "请用选择结果操作关联已有实验");
                return { ...node, status: "pending" as const, summary: "", duration: "", progress: node.progress || "pending" as const, currentResultId: null };
            }
            const next = { ...node,
                ...(node.progress === undefined && previous.progress !== undefined ? { progress: previous.progress } : {}),
                ...(node.resourceIds === undefined && previous.resourceIds !== undefined ? { resourceIds: previous.resourceIds } : {}),
            };
            if (!allowSelection) {
                if (node.currentResultId !== undefined && node.currentResultId !== previous.currentResultId) fail(422, "RESULT_SELECTION_REQUIRED", "请用选择结果操作更改当前结果");
                if (previous.currentResultId !== undefined) next.currentResultId = previous.currentResultId;
                if (previous.currentResultId) Object.assign(next, { status: previous.status, summary: previous.summary, duration: previous.duration });
                else if (previous.currentResultId === null) Object.assign(next, clearedResult);
            }
            return next;
        });
        const incomingIds = new Set(value.nodes.map(node => node.id));
        const changedNodeIds = [...new Set([
            ...current.nodes.filter(node => !incomingIds.has(node.id)).map(node => node.id),
            ...value.nodes.filter(node => !previousNodes.has(node.id) || previousNodes.get(node.id)!.title !== node.title).map(node => node.id),
        ])];
        let records: Experiment[] = [];
        if (value.projectId !== current.projectId) records = await children(current.id);
        else if (changedNodeIds.length) {
            const rows = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents WHERE kind='experiments' AND parent_id=? AND json_extract(data,'$.nodeId') IN (SELECT value FROM json_each(?))").bind(current.id, JSON.stringify(changedNodeIds)).all<Row>();
            records = rows.results.map(unpack) as Experiment[];
        }
        for (const node of value.nodes) {
            if (!previousNodes.has(node.id) && records.some(record => record.nodeId === node.id)) fail(409, "NODE_ID_REUSED", "该节点 ID 已用于历史实验，请使用新的节点 ID");
        }
        const references = [...new Set([...value.nodes.flatMap(resourceIds), ...records.flatMap(resourceIds)])];
        await checkResources(references, value.projectId);
        const stamp = now(), next = updated(current, value, stamp) as Hypothesis;
        const statements = [updateStatement("hypotheses", next, current.revision!, `AND ${resourceGuard}`, [JSON.stringify(references), value.projectId])];
        // Preserve the identity and original recording time of records whose
        // node is removed. Each dependent write is guarded by the preceding CAS.
        for (const record of records) {
            if (previousNodes.has(record.nodeId) && (!incomingIds.has(record.nodeId) || value.nodes.find(node => node.id === record.nodeId)?.title !== previousNodes.get(record.nodeId)!.title) && !record.nodeTitle) {
                const preserved = updated(record, { ...record, nodeTitle: previousNodes.get(record.nodeId)!.title }, stamp);
                statements.push(updateStatement("experiments", preserved, record.revision!, "AND changes() = 1"));
            }
        }
        const results = await db.batch(statements);
        await conflict(results[0].meta.changes);
        return { data: next };
    }
    async function createExperiment(input: unknown): Promise<ServiceResult<Experiment>> {
        requireWrite();
        const value = parse(schemas.experiments, input);
        value.summary = parse(resultSchema, value).summary;
        if (value.source && value.source !== "manual") fail(422, "LEGACY_SOURCE_ONLY", "新结果必须为真实录入；历史模型建议不能重新创建");
        const hypothesis = await required("hypotheses", value.hypothesisId) as Hypothesis;
        const node = hypothesis.nodes.find(item => item.id === value.nodeId);
        if (!node) fail(422, "NODE_NOT_FOUND", "节点不属于该研究流程");
        const stamp = now();
        const record: Experiment = { ...value, source: "manual", id: value.id || crypto.randomUUID(), revision: 1, updatedAt: stamp, recordedAt: stamp, recordedAtInferred: false, nodeTitle: node.title };
        if (await db.prepare("SELECT id FROM documents WHERE id = ?").bind(record.id).first()) fail(409, "ALREADY_EXISTS", "该 ID 已存在");
        await checkResources(resourceIds(record), hypothesis.projectId);
        const next = updated(hypothesis, { ...hypothesis, nodes: hypothesis.nodes.map(item => item.id === record.nodeId ? { ...item, ...projection(record) } : item) }, stamp) as Hypothesis;
        const results = await db.batch([
            updateStatement("hypotheses", next, hypothesis.revision!, `AND ${resourceGuard}`, [JSON.stringify(resourceIds(record)), hypothesis.projectId]),
            db.prepare("INSERT INTO documents (id,kind,parent_id,data,revision,updated_at) SELECT ?, 'experiments', ?, ?, 1, ? WHERE changes() = 1").bind(record.id, hypothesis.id, serializeDocument(record), stamp),
        ]);
        await conflict(results[0].meta.changes);
        return { data: record, affectedHypothesis: next, status: 201 };
    }
    async function updateExperiment(id: string, input: unknown): Promise<ServiceResult<Experiment>> {
        requireWrite();
        const current = await required("experiments", id) as Experiment;
        const raw = parse(z.record(z.unknown()), input);
        revision(current, raw.revision);
        for (const key of ["hypothesisId", "nodeId", "source"] as const) {
            if (raw[key] !== undefined && raw[key] !== current[key]) fail(422, "IMMUTABLE_RELATION", "实验的研究流程、节点和来源不能修改");
        }
        const hypothesis = await required("hypotheses", current.hypothesisId) as Hypothesis;
        const snapshot = (await withSnapshots([current], [hypothesis]))[0];
        const value = parse(schemas.experiments, { ...current, ...raw, hypothesisId: current.hypothesisId, nodeId: current.nodeId, source: current.source,
            recordedAt: current.recordedAt, recordedAtInferred: current.recordedAtInferred, nodeTitle: snapshot.nodeTitle,
            resourceIds: raw.resourceIds === undefined ? current.resourceIds : raw.resourceIds,
        });
        if (raw.summary !== undefined && raw.summary !== current.summary) value.summary = parse(resultSchema, value).summary;
        if (value.id && value.id !== id) fail(422, "ID_MISMATCH", "请求中的 ID 与记录不一致");
        await checkResources(resourceIds(value), hypothesis.projectId);
        const stamp = now(), record = updated(current, value, stamp) as Experiment;
        const next = updated(hypothesis, { ...hypothesis, nodes: hypothesis.nodes.map(node => node.currentResultId === id ? { ...node, ...projection(record) } : node) }, stamp) as Hypothesis;
        const results = await db.batch([
            updateStatement("hypotheses", next, hypothesis.revision!, `AND EXISTS (SELECT 1 FROM documents WHERE kind='experiments' AND id=? AND revision=?) AND ${resourceGuard}`, [id, current.revision, JSON.stringify(resourceIds(record)), hypothesis.projectId]),
            updateStatement("experiments", record, current.revision!, "AND changes() = 1"),
        ]);
        await conflict(results[0].meta.changes);
        return { data: record, affectedHypothesis: next };
    }
    async function removeExperiment(id: string): Promise<ServiceResult> {
        requireWrite();
        const record = await required("experiments", id) as Experiment;
        const hypothesis = await required("hypotheses", record.hypothesisId) as Hypothesis;
        const next = updated(hypothesis, { ...hypothesis, nodes: hypothesis.nodes.map(node => node.currentResultId === id ? { ...node, ...clearedResult } : node) }) as Hypothesis;
        const results = await db.batch([
            updateStatement("hypotheses", next, hypothesis.revision!, "AND EXISTS (SELECT 1 FROM documents WHERE kind='experiments' AND id=? AND revision=?)", [id, record.revision]),
            db.prepare("DELETE FROM documents WHERE kind='experiments' AND id=? AND revision=? AND changes()=1").bind(id, record.revision),
        ]);
        await conflict(results[0].meta.changes);
        return { data: { deleted: true, id, collection: "experiments" }, affectedHypothesis: next };
    }
    async function create(kind: Collection, input: unknown): Promise<ServiceResult> {
        requireWrite(); kindCheck(kind);
        if (kind === "experiments") return createExperiment(input);
        const value = parse(schemas[kind], input) as Document;
        const item: Document = { ...value, id: value.id || crypto.randomUUID(), revision: 1, updatedAt: now() };
        if (await db.prepare("SELECT id FROM documents WHERE id = ?").bind(item.id).first()) fail(409, "ALREADY_EXISTS", "该 ID 已存在");
        if (kind === "hypotheses" || kind === "resources") await required("projects", item.projectId);
        const refs = kind === "hypotheses" ? hypothesisResources(item as Hypothesis) : [];
        if (kind === "hypotheses") {
            if (item.nodes.some((node: FlowNode) => node.currentResultId)) fail(422, "RESULT_SELECTION_REQUIRED", "新研究流程不能引用已有实验结果");
            item.nodes = item.nodes.map((node: FlowNode) => ({ ...node, ...clearedResult, progress: node.progress || "pending" }));
            await checkResources(refs, item.projectId);
        }
        const result = await db.prepare(`INSERT INTO documents (id,kind,project_id,parent_id,data,revision,updated_at) SELECT ?,?,?,NULL,?,1,? WHERE ${resourceGuard}`)
            .bind(item.id, kind, item.projectId || null, serializeDocument(item), item.updatedAt, JSON.stringify(refs), item.projectId || null).run();
        await conflict(result.meta.changes);
        return { data: item, status: 201 };
    }
    async function update(kind: Collection, id: string, input: unknown): Promise<ServiceResult> {
        requireWrite(); kindCheck(kind);
        if (kind === "experiments") return updateExperiment(id, input);
        const current = await required(kind, id);
        if (kind === "hypotheses") return saveHypothesis(current as Hypothesis, input);
        const raw = parse(z.record(z.unknown()), input);
        revision(current, raw.revision);
        const value = parse(schemas[kind], { ...current, ...raw }) as Document;
        if (value.id && value.id !== id) fail(422, "ID_MISMATCH", "请求中的 ID 与记录不一致");
        let guard = "", args: unknown[] = [];
        if (kind === "resources") {
            await required("projects", value.projectId);
            if (value.projectId !== current.projectId) {
                await checkReferences(id);
                guard = `AND NOT ${referencedResource}`;
                args = [id, id];
            }
        }
        const item = updated(current, value);
        const result = await updateStatement(kind, item, current.revision, guard, args).run();
        await conflict(result.meta.changes);
        return { data: item };
    }
    async function remove(kind: Collection, id: string): Promise<ServiceResult> {
        requireWrite(); kindCheck(kind);
        if (kind === "experiments") return removeExperiment(id);
        const current = await required(kind, id);
        if (kind === "projects" && await db.prepare("SELECT id FROM documents WHERE project_id = ? LIMIT 1").bind(id).first()) fail(409, "PROJECT_NOT_EMPTY", "请先删除项目下的研究流程和资料");
        let guard = "", params: unknown[] = [];
        if (kind === "resources") { await checkReferences(id); guard = `AND NOT ${referencedResource}`; params = [id, id]; }
        const experiments = kind === "hypotheses" ? await children(id) : [];
        // Foreign keys cascade a hypothesis's experiments in this same write.
        const result = await db.prepare(`DELETE FROM documents WHERE kind=? AND id=? AND revision=? ${guard}`).bind(kind, id, current.revision, ...params).run();
        await conflict(result.meta.changes);
        return { data: { deleted: true, id, collection: kind }, ...(kind === "hypotheses" ? { deletedExperimentIds: experiments.map(record => record.id) } : {}) };
    }
    async function createResult(hypothesisId: string, input: unknown): Promise<ServiceResult<Experiment>> {
        requireWrite();
        const value = parse(resultSchema, input), stamp = now();
        return createExperiment({ ...value, hypothesisId, source: "manual", logs: [{ time: stamp, message: "手动录入实验结果" }, { time: stamp, message: value.summary }] });
    }
    async function node(operation: NodeOperation, input: unknown): Promise<ServiceResult<Hypothesis>> {
        requireWrite();
        const args = parse(nodeOperationSchemas[operation], input) as any;
        const current = await required("hypotheses", args.hypothesisId) as Hypothesis;
        revision(current, args.revision);
        const next: Hypothesis = { ...current, nodes: current.nodes.map(item => ({ ...item })), edges: current.edges.map(edge => ({ ...edge })) };
        const index = next.nodes.findIndex(item => item.id === args.nodeId);
        if (!["create", "layout"].includes(operation) && index < 0) fail(404, "NODE_NOT_FOUND", "节点不存在");
        if (operation === "create") next.nodes.push(args.node);
        if (operation === "update") {
            Object.assign(next.nodes[index], args.patch);
            if (args.upstream !== undefined) next.edges = [...next.edges.filter(edge => edge.target !== args.nodeId), ...args.upstream.map((source: string) => ({ source, target: args.nodeId }))];
        }
        if (operation === "move") Object.assign(next.nodes[index], { x: args.x, y: args.y });
        if (operation === "layout") {
            const positions = new Map<string, { x: number; y: number }>(args.positions.map((position: { id: string; x: number; y: number }) => [position.id, position]));
            if (positions.size !== args.positions.length || positions.size !== next.nodes.length || next.nodes.some(item => !positions.has(item.id))) fail(422, "INVALID_LAYOUT", "布局必须恰好包含当前所有节点");
            next.nodes = next.nodes.map(item => ({ ...item, ...positions.get(item.id)! }));
        }
        if (operation === "delete") {
            next.nodes.splice(index, 1);
            next.edges = next.edges.filter(edge => edge.source !== args.nodeId && edge.target !== args.nodeId);
        }
        if (operation === "select_result") {
            if (args.resultId === null) Object.assign(next.nodes[index], clearedResult);
            else {
                const result = await required("experiments", args.resultId) as Experiment;
                if (result.hypothesisId !== current.id || result.nodeId !== args.nodeId || result.source !== "manual") fail(422, "INVALID_CURRENT_RESULT", "当前结果必须是该节点的真实实验记录");
                Object.assign(next.nodes[index], projection(result));
            }
        }
        return saveHypothesis(current, next, operation === "select_result");
    }
    async function seed(): Promise<ServiceResult> {
        requireScope(principal.scope, "admin");
        if ((await db.prepare("SELECT count(*) AS total FROM documents").first<{ total: number }>())?.total) fail(409, "WORKSPACE_NOT_EMPTY", "只能向空工作区导入示例，现有内容未改变");
        const stamp = now(), statements: D1PreparedStatement[] = [];
        for (const [kind, items] of Object.entries(demoWorkspace)) for (const item of items) {
            const guard = statements.length ? "changes() = 1" : "NOT EXISTS (SELECT 1 FROM documents)";
            statements.push(db.prepare(`INSERT INTO documents (id,kind,project_id,parent_id,data,revision,updated_at) SELECT ?,?,?,?,?,1,? WHERE ${guard}`).bind(item.id, kind, (item as Document).projectId || null, (item as Document).hypothesisId || null, serializeDocument({ ...item, revision: 1, updatedAt: stamp }), stamp));
        }
        const results = await db.batch(statements);
        if (!results[0].meta.changes) fail(409, "WORKSPACE_NOT_EMPTY", "只能向空工作区导入示例，现有内容未改变");
        return { data: { imported: statements.length }, status: 201 };
    }
    async function listTokens(): Promise<ServiceResult> {
        requireScope(principal.scope, "admin");
        const result = await db.prepare("SELECT id,name,prefix,scope,created_at AS createdAt,expires_at AS expiresAt,last_used_at AS lastUsedAt FROM access_tokens ORDER BY created_at DESC").all();
        return { data: result.results };
    }
    async function createToken(input: unknown): Promise<ServiceResult> {
        requireScope(principal.scope, "admin");
        const value = parse(tokenSchema, input), token = `fm_${Array.from(crypto.getRandomValues(new Uint8Array(32)), part => part.toString(16).padStart(2, "0")).join("")}`;
        const id = crypto.randomUUID(), createdAt = now(), expiresAt = new Date(Date.now() + value.expiresInDays * 86400000).toISOString();
        await db.prepare("INSERT INTO access_tokens (id,name,prefix,hash,scope,created_at,expires_at) VALUES (?,?,?,?,?,?,?)").bind(id, value.name, token.slice(0, 11), await hash(token), value.scope, createdAt, expiresAt).run();
        return { data: { id, name: value.name, prefix: token.slice(0, 11), token, scope: value.scope, createdAt, expiresAt, lastUsedAt: null }, status: 201 };
    }
    async function revokeToken(id: string): Promise<ServiceResult> {
        requireScope(principal.scope, "admin");
        const result = await db.prepare("DELETE FROM access_tokens WHERE id = ?").bind(id).run();
        if (!result.meta.changes) fail(404, "NOT_FOUND", "Token 不存在");
        return { data: { deleted: true, id } };
    }
    return { workspace: snapshot, seed, list, get, create, update, remove, createResult, node, listTokens, createToken, revokeToken };
}
