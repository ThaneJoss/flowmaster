import { ApiError, authorizeRequest, fail, requireScope, validateOrigin, type Bindings, type Principal } from "./auth.ts";
import { createWorkspaceService, type ServiceResult } from "./service.ts";
import { schemas } from "./validation.ts";
import type { Collection } from "../types.ts";

// Keep the existing import surface for the Worker and other HTTP adapters.
export { ApiError, authorizeRequest, fail, hash, now, requireScope, validateOrigin, type Bindings, type Principal } from "./auth.ts";

function json(result: ServiceResult): Response {
    const body = {
        data: result.data,
        ...(result.affectedHypothesis === undefined ? {} : { affectedHypothesis: result.affectedHypothesis }),
        ...(result.deletedExperimentIds === undefined ? {} : { deletedExperimentIds: result.deletedExperimentIds }),
    };
    const response = new Response(JSON.stringify(body), {
        status: result.status ?? 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    if (result.total !== undefined)
        response.headers.set("X-Total-Count", String(result.total));
    return response;
}

async function readBody(req: Request): Promise<unknown> {
    if (!req.headers.get("content-type")?.includes("application/json"))
        fail(415, "CONTENT_TYPE", "请求必须使用 application/json");
    if (Number(req.headers.get("content-length")) > 600000)
        fail(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
    const reader = req.body?.getReader();
    if (!reader)
        fail(400, "EMPTY_BODY", "请求内容不能为空");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            total += value.length;
            if (total > 600000) {
                await reader.cancel();
                fail(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        fail(400, "INVALID_JSON", "请求不是有效 JSON");
    }
}

async function route(req: Request, env: Bindings, trustedPrincipal?: Principal): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/v1/, "").replace(/\/$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    const method = req.method;
    if (path === "/health" && method === "GET") {
        validateOrigin(req, env);
        return json({ data: { name: "FlowMaster", version: "1.0.0" } });
    }
    if (method === "OPTIONS") {
        validateOrigin(req, env);
        return new Response(null, { status: 204 });
    }
    if (trustedPrincipal)
        validateOrigin(req, env);
    const principal = trustedPrincipal ?? await authorizeRequest(req, env);
    if (!["GET", "HEAD"].includes(method))
        requireScope(principal.scope, "write");
    const service = createWorkspaceService(env, principal);
    if (path === "/workspace" && method === "GET")
        return json(await service.workspace());
    if (path === "/seed" && method === "POST")
        return json(await service.seed());
    if (parts[0] === "tokens") {
        requireScope(principal.scope, "admin");
        if (parts.length === 1 && method === "GET")
            return json(await service.listTokens());
        if (parts.length === 1 && method === "POST")
            return json(await service.createToken(await readBody(req)));
        if (parts.length === 2 && method === "DELETE")
            return json(await service.revokeToken(parts[1]));
    }
    if (parts[0] === "hypotheses" && parts.length === 3 && parts[2] === "results" && method === "POST")
        return json(await service.createResult(parts[1], await readBody(req)));
    const collection = parts[0] as Collection;
    if (Object.hasOwn(schemas, collection)) {
        if (parts.length === 1 && method === "GET") {
            const query: Record<string, unknown> = Object.create(null);
            // Match URLSearchParams.get(): use the first value of repeated keys.
            url.searchParams.forEach((value, key) => {
                if (!Object.hasOwn(query, key))
                    query[key] = value;
            });
            return json(await service.list(collection, query));
        }
        if (parts.length === 1 && method === "POST")
            return json(await service.create(collection, await readBody(req)));
        if (parts.length === 2) {
            const id = parts[1];
            if (method === "GET")
                return json(await service.get(collection, id));
            if (method === "PUT")
                return json(await service.update(collection, id, await readBody(req)));
            if (method === "DELETE")
                return json(await service.remove(collection, id));
        }
    }
    return fail(404, "NOT_FOUND", "接口不存在或请求方法不支持");
}

// A supplied principal must come from authorizeRequest for the originating
// request. Never accept it from request input.
export async function handleApi(req: Request, env: Bindings, trustedPrincipal?: Principal): Promise<Response> {
    const origin = req.headers.get("Origin");
    const url = new URL(req.url);
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    let response: Response;
    try {
        response = await route(req, env, trustedPrincipal);
    } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        if (!apiError)
            console.error("FlowMaster API failure", error instanceof Error ? error.name : "unknown");
        response = new Response(JSON.stringify({ error: {
            code: apiError?.code || "INTERNAL_ERROR",
            message: apiError?.message || "服务暂时不可用，请检查数据库迁移或稍后重试",
        } }), {
            status: apiError?.status || 500,
            headers: { "Content-Type": "application/json; charset=utf-8" },
        });
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Vary", "Origin");
    if (response.status === 429)
        response.headers.set("Retry-After", "60");
    if (origin && (origin === url.origin || allowed.includes(origin))) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
        response.headers.set("Access-Control-Expose-Headers", "X-Total-Count");
        response.headers.set("Access-Control-Max-Age", "600");
    }
    return response;
}
