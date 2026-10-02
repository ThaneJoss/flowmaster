import { schemas, tokenSchema, resultSchema } from "./validation.ts";
import { demoWorkspace } from "../demo.ts";
import type { Collection, Experiment, Hypothesis, Workspace } from "../types.ts";
import { z } from "zod";
export interface Bindings {
    DB: D1Database;
    ADMIN_TOKEN?: string;
    ALLOWED_ORIGINS?: string;
}
export interface Principal {
    id: string;
    scope: "read" | "write" | "admin";
}
export class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))), v => v.toString(16).padStart(2, "0")).join("");
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
async function readBody(req: Request) { if (!req.headers.get("content-type")?.includes("application/json"))
    fail(415, "CONTENT_TYPE", "请求必须使用 application/json"); if (Number(req.headers.get("content-length")) > 600000)
    fail(413, "PAYLOAD_TOO_LARGE", "请求内容过大"); const reader = req.body?.getReader(); if (!reader)
    fail(400, "EMPTY_BODY", "请求内容不能为空"); const chunks: Uint8Array[] = []; let total = 0; while (true) {
    const { value, done } = await reader!.read();
    if (done)
        break;
    total += value.length;
    if (total > 600000) {
        await reader!.cancel();
        fail(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
    }
    chunks.push(value);
} const b = new Uint8Array(total); let offset = 0; for (const chunk of chunks) {
    b.set(chunk, offset);
    offset += chunk.length;
} try {
    return JSON.parse(new TextDecoder().decode(b));
}
catch {
    fail(400, "INVALID_JSON", "请求不是有效 JSON");
} }
function validate<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> { const result = schema.safeParse(value); if (!result.success)
    fail(422, "VALIDATION_ERROR", result.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("；")); return result.data as z.output<S>; }
interface Row {
    id: string;
    kind: string;
    data: string;
    revision: number;
    updated_at: string;
}
const unpack = (row: Row) => ({ ...JSON.parse(row.data), id: row.id, revision: row.revision, updatedAt: row.updated_at });
async function get(db: D1Database, kind: string, id: string) { const row = await db.prepare("SELECT id,kind,data,revision,updated_at FROM documents WHERE kind = ? AND id = ?").bind(kind, id).first<Row>(); return row ? unpack(row) : null; }
async function requireRecord(db: D1Database, kind: string, id: string) { const row = await get(db, kind, id); return row || fail(404, "NOT_FOUND", "记录不存在"); }
function insert(db: D1Database, kind: string, item: any) { return db.prepare("INSERT INTO documents (id,kind,project_id,parent_id,data,revision,updated_at) VALUES (?,?,?,?,?,1,?)").bind(item.id, kind, item.projectId || null, item.hypothesisId || null, JSON.stringify(item), item.updatedAt); }
async function validateRelations(db: D1Database, kind: string, item: any) { if (kind === "hypotheses" || kind === "resources")
    await requireRecord(db, "projects", item.projectId); if (kind === "experiments") {
    const h = await requireRecord(db, "hypotheses", item.hypothesisId);
    if (!h.nodes.some((n: any) => n.id === item.nodeId))
        fail(422, "NODE_NOT_FOUND", "节点不属于该假设");
} }
async function rateLimit(env: Bindings, key: string, max: number, seconds: number) { const bucket = Math.floor(Date.now() / 1000 / seconds), expires = (bucket + 1) * seconds; const row = await env.DB.prepare("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(`${key}:${bucket}`, expires).first<{
    count: number;
}>(); if (row && row.count > max)
    fail(429, "RATE_LIMITED", "请求过于频繁，请稍后再试"); if (Math.random() < .015)
    await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000) - 60).run(); }
async function authenticate(req: Request, env: Bindings): Promise<Principal> { if (!env.DB)
    fail(503, "STORAGE_UNAVAILABLE", "尚未绑定 D1 数据库"); if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32)
    fail(503, "NOT_CONFIGURED", "请在 Cloudflare 配置至少 32 位 ADMIN_TOKEN"); const token = req.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1]; if (!token || token.length > 4096)
    fail(401, "UNAUTHORIZED", "需要有效的 Bearer Token"); const digest = await hash(token!); const adminHash = await hash(env.ADMIN_TOKEN!); if (digest === adminHash)
    return { scope: "admin", id: "bootstrap-admin" }; const t = await env.DB.prepare("SELECT id,scope,expires_at,last_used_at FROM access_tokens WHERE hash = ?").bind(digest).first<{
    id: string;
    scope: Principal["scope"];
    expires_at: string | null;
    last_used_at: string | null;
}>();
    const timestamp = Date.now(), stamp = new Date(timestamp).toISOString();
    if (!t || t.expires_at && t.expires_at <= stamp)
        fail(401, "UNAUTHORIZED", "Token 无效、已过期或已撤销");
    const cutoff = new Date(timestamp - 60000).toISOString();
    // Avoid a database round trip for recently used tokens, while retaining
    // the SQL guard when concurrent requests both observe a stale timestamp.
    if (t!.last_used_at === null || t!.last_used_at < cutoff)
        await env.DB.prepare("UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)").bind(stamp, t!.id, cutoff).run();
    return { scope: t!.scope, id: t!.id };
}
function requireScope(scope: string, required: "write" | "admin") { if (required === "admin" && scope !== "admin" || required === "write" && scope === "read")
    fail(403, "FORBIDDEN", required === "admin" ? "此操作需要管理员 Token" : "此 Token 仅有只读权限"); }
export function validateOrigin(req: Request, env: Bindings): void {
    const origin = req.headers.get("Origin"), allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (origin && origin !== new URL(req.url).origin && !allowed.includes(origin))
        fail(403, "ORIGIN_NOT_ALLOWED", "当前前端域名未配置在 ALLOWED_ORIGINS 中");
}
export async function authorizeRequest(req: Request, env: Bindings): Promise<Principal> {
    validateOrigin(req, env);
    if (env.DB)
        await rateLimit(env, `ip:${req.headers.get("CF-Connecting-IP") || "local"}`, 360, 60);
    return authenticate(req, env);
}
async function saveResult(env: Bindings, h: Hypothesis, body: z.infer<typeof resultSchema>) {
    const node = h.nodes.find(n => n.id === body.nodeId);
    if (!node)
        fail(422, "NODE_NOT_FOUND", "节点不存在");
    const stamp = now();
    const exp: Experiment = { id: crypto.randomUUID(), updatedAt: stamp, revision: 1, hypothesisId: h.id, nodeId: body.nodeId, title: body.title, status: body.status, summary: body.summary, duration: body.duration, source: "manual", logs: [{ time: stamp, message: "手动录入实验结果" }, { time: stamp, message: body.summary }] };
    const updated = { ...h, updatedAt: stamp, revision: (h.revision || 1) + 1, nodes: h.nodes.map(n => n.id === body.nodeId ? { ...n, status: body.status, summary: body.summary, duration: body.duration, startedAt: stamp } : n) };
    // D1 executes this batch transactionally. The guarded INSERT runs only when
    // the preceding optimistic UPDATE changed the expected hypothesis revision.
    const result = await env.DB.batch([env.DB.prepare("UPDATE documents SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND kind = 'hypotheses' AND revision = ?").bind(JSON.stringify(updated), stamp, h.id, h.revision || 1), env.DB.prepare("INSERT INTO documents (id,kind,parent_id,data,revision,updated_at) SELECT ?, 'experiments', ?, ?, 1, ? WHERE changes() = 1").bind(exp.id, h.id, JSON.stringify(exp), stamp)]);
    if (!result[0].meta.changes)
        fail(409, "REVISION_CONFLICT", "假设已被其他操作更新，请刷新后重试");
    return exp;
}
async function route(req: Request, env: Bindings, trustedPrincipal?: Principal) {
    const url = new URL(req.url), path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/$/, "") || "/", parts = path.split("/").filter(Boolean), method = req.method;
    if (path === "/health" && method === "GET") {
        validateOrigin(req, env);
        return json({ name: "FlowMaster", version: "1.0.0" });
    }
    if (method === "OPTIONS") {
        validateOrigin(req, env);
        return new Response(null, { status: 204 });
    }
    const principal = trustedPrincipal ?? await authorizeRequest(req, env);
    if (!["GET", "HEAD"].includes(method))
        requireScope(principal.scope, "write");
    if (path === "/workspace" && method === "GET") {
        const size = await env.DB.prepare("SELECT COALESCE(SUM(length(data)),0) AS bytes FROM documents").first<{
            bytes: number;
        }>();
        if ((size?.bytes || 0) > 8000000)
            fail(413, "WORKSPACE_TOO_LARGE", "工作区超过前端加载上限，请使用分页 API 读取");
        const rows = await env.DB.prepare("SELECT id,kind,data,revision,updated_at FROM documents ORDER BY updated_at DESC LIMIT 5001").all<Row>();
        if (rows.results.length > 5000)
            fail(413, "WORKSPACE_TOO_LARGE", "工作区超过前端加载上限，请使用分页 API 读取");
        const state: Workspace = { projects: [], hypotheses: [], experiments: [], resources: [] };
        for (const row of rows.results)
            (state[row.kind as Collection] as any[]).push(unpack(row));
        return json(state);
    }
    if (path === "/seed" && method === "POST") {
        requireScope(principal.scope, "admin");
        const existing = await env.DB.prepare("SELECT count(*) AS total FROM documents").first<{
            total: number;
        }>();
        if (existing?.total)
            fail(409, "WORKSPACE_NOT_EMPTY", "只能向空工作区导入示例，现有内容未改变");
        const statements = [];
        for (const [kind, items] of Object.entries(demoWorkspace))
            for (const item of items)
                statements.push(insert(env.DB, kind, { ...item, updatedAt: now() }));
        await env.DB.batch(statements);
        return json({ imported: statements.length }, 201);
    }
    if (parts[0] === "tokens") {
        requireScope(principal.scope, "admin");
        if (parts.length === 1 && method === "GET") {
            const rows = await env.DB.prepare("SELECT id,name,prefix,scope,created_at AS createdAt,expires_at AS expiresAt,last_used_at AS lastUsedAt FROM access_tokens ORDER BY created_at DESC").all();
            return json(rows.results);
        }
        if (parts.length === 1 && method === "POST") {
            const b = validate(tokenSchema, await readBody(req));
            const token = `fm_${Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, "0")).join("")}`;
            const id = crypto.randomUUID(), createdAt = now(), expiresAt = new Date(Date.now() + b.expiresInDays * 86400000).toISOString();
            await env.DB.prepare("INSERT INTO access_tokens (id,name,prefix,hash,scope,created_at,expires_at) VALUES (?,?,?,?,?,?,?)").bind(id, b.name, token.slice(0, 11), await hash(token), b.scope, createdAt, expiresAt).run();
            return json({ id, name: b.name, token, scope: b.scope, createdAt, expiresAt }, 201);
        }
        if (parts.length === 2 && method === "DELETE") {
            const result = await env.DB.prepare("DELETE FROM access_tokens WHERE id = ?").bind(parts[1]).run();
            if (!result.meta.changes)
                fail(404, "NOT_FOUND", "Token 不存在");
            return json({ deleted: true });
        }
    }
    if (parts[0] === "hypotheses" && parts.length === 3 && parts[2] === "results" && method === "POST") {
        const h = await requireRecord(env.DB, "hypotheses", parts[1]) as Hypothesis;
        const body = validate(resultSchema, await readBody(req));
        const exp = await saveResult(env, h, body);
        return json(exp, 201);
    }
    const kind = parts[0] as Collection;
    if (Object.hasOwn(schemas, kind)) {
        const schema = schemas[kind];
        if (parts.length === 1 && method === "GET") {
            const limit = Number(url.searchParams.get("limit") || 50), offset = Number(url.searchParams.get("offset") || 0);
            if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0)
                fail(422, "INVALID_PAGINATION", "limit 需要在 1–200 之间，offset 不能为负数");
            const q = (url.searchParams.get("q") || "").slice(0, 200);
            const parent = url.searchParams.get("projectId");
            const where = "kind = ? AND (? = '' OR data LIKE ?) AND (? IS NULL OR project_id = ?)";
            const params = [kind, q, `%${q}%`, parent, parent];
            const results = await env.DB.batch([env.DB.prepare(`SELECT id,kind,data,revision,updated_at FROM documents WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).bind(...params, limit, offset), env.DB.prepare(`SELECT count(*) AS total FROM documents WHERE ${where}`).bind(...params)]);
            const response = json(results[0].results.map(r => unpack(r as unknown as Row)));
            response.headers.set("X-Total-Count", String((results[1].results[0] as any).total));
            return response;
        }
        if (parts.length === 1 && method === "POST") {
            const b = validate(schema as z.ZodType<any>, await readBody(req));
            const item = { ...b, id: b.id || crypto.randomUUID(), revision: 1, updatedAt: now() };
            await validateRelations(env.DB, kind, item);
            if (await env.DB.prepare("SELECT id FROM documents WHERE id = ?").bind(item.id).first())
                fail(409, "ALREADY_EXISTS", "该 ID 已存在");
            await insert(env.DB, kind, item).run();
            return json(item, 201);
        }
        if (parts.length === 2) {
            const id = parts[1];
            if (method === "GET")
                return json(await requireRecord(env.DB, kind, id));
            if (method === "PUT") {
                const current = await requireRecord(env.DB, kind, id);
                const b = validate(schema as z.ZodType<any>, await readBody(req));
                if (!b.revision || b.revision !== current.revision)
                    fail(409, "REVISION_CONFLICT", "记录已更新或缺少 revision，请刷新后重试");
                if (b.id && b.id !== id)
                    fail(422, "ID_MISMATCH", "请求中的 ID 与路径不一致");
                const item = { ...b, id, revision: current.revision + 1, updatedAt: now() };
                await validateRelations(env.DB, kind, item);
                const result = await env.DB.prepare("UPDATE documents SET data = ?, project_id = ?, parent_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND kind = ? AND revision = ?").bind(JSON.stringify(item), item.projectId || null, item.hypothesisId || null, item.updatedAt, id, kind, b.revision).run();
                if (!result.meta.changes)
                    fail(409, "REVISION_CONFLICT", "记录已更新，请刷新后重试");
                return json(item);
            }
            if (method === "DELETE") {
                await requireRecord(env.DB, kind, id);
                if (kind === "projects" && await env.DB.prepare("SELECT id FROM documents WHERE project_id = ? LIMIT 1").bind(id).first())
                    fail(409, "PROJECT_NOT_EMPTY", "请先删除项目下的假设和资源");
                const statements = [env.DB.prepare("DELETE FROM documents WHERE kind = ? AND id = ?").bind(kind, id)];
                if (kind === "hypotheses")
                    statements.push(env.DB.prepare("DELETE FROM documents WHERE kind = 'experiments' AND parent_id = ?").bind(id));
                await env.DB.batch(statements);
                return json({ deleted: true });
            }
        }
    }
    return fail(404, "NOT_FOUND", "接口不存在或请求方法不支持");
}
// Internal business adapter. A supplied principal must come from
// authorizeRequest for the originating request; never accept it from input.
export async function handleApi(req: Request, env: Bindings, trustedPrincipal?: Principal): Promise<Response> { const origin = req.headers.get("Origin"), url = new URL(req.url), allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean); let response: Response; try {
    response = await route(req, env, trustedPrincipal);
}
catch (error) {
    const e = error instanceof ApiError ? error : null;
    if (!e)
        console.error("FlowMaster API failure", error instanceof Error ? error.name : "unknown");
    response = new Response(JSON.stringify({ error: { code: e?.code || "INTERNAL_ERROR", message: e?.message || "服务暂时不可用，请检查数据库迁移或稍后重试" } }), { status: e?.status || 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
} response.headers.set("Cache-Control", "no-store"); response.headers.set("X-Content-Type-Options", "nosniff"); response.headers.set("Referrer-Policy", "no-referrer"); response.headers.set("Vary", "Origin"); if (response.status === 429)
    response.headers.set("Retry-After", "60"); if (origin && (origin === url.origin || allowed.includes(origin))) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
    response.headers.set("Access-Control-Expose-Headers", "X-Total-Count");
    response.headers.set("Access-Control-Max-Age", "600");
} return response; }
