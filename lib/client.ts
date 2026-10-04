import type { MutationResult } from "./types.ts";

export interface Connection {
    baseUrl: string;
    token: string;
    remember: boolean;
}
// Keep the UI's collection operations local; all requests use MCP tools over /mcp.
export interface ApiPage<T> { data: T[]; total: number; nextOffset: number | null }
export interface ApiClient {
    <T = any>(path: string, options?: RequestInit): Promise<T>;
    page<T>(path: string, options?: RequestInit): Promise<ApiPage<T>>;
    mutation<T>(path: string, options?: RequestInit): Promise<MutationResult<T>>;
}
export interface ApiError extends Error { status?: number; code?: string | number }
export const isRequestCancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";

const protocolVersion = "2025-11-25";
interface ToolCall { name: string; arguments: Record<string, unknown> }
export interface ToolPayload<T = unknown> extends MutationResult<T> {
    total?: number;
    nextOffset?: number | null;
    status?: number;
}
export interface CallOptions { signal?: AbortSignal | null }
export type McpClient = <T>(name: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<ToolPayload<T>>;
export class McpError extends Error implements ApiError {
    code?: string | number;
    status?: number;
    constructor(message: string) { super(message); this.name = "McpError"; }
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const errorMessage = (value: unknown) => isRecord(value) && typeof value.message === "string" ? value.message : undefined;
const isOffset = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function requestError(message: string, status?: unknown, details?: unknown): ApiError {
    const error = new McpError(message);
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) error.status = status;
    if (isRecord(details) && (typeof details.code === "string" || typeof details.code === "number" && Number.isFinite(details.code))) error.code = details.code;
    return error;
}

function endpointFor(baseUrl: string): string {
    const base = baseUrl.trim().replace(/\/+$/, "");
    if (!base) return "/mcp";
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
        throw new Error("服务地址需要 HTTPS，且不能包含账号、查询参数或片段");
    }
    return base.endsWith("/mcp") ? base : `${base}/mcp`;
}

function toolFor(path: string, options: RequestInit): ToolCall {
    const method = (options.method || "GET").toUpperCase();
    const [pathname, query = ""] = path.split("?");
    const data = () => {
        if (typeof options.body !== "string") throw new Error("MCP 工具参数需要 JSON 请求体");
        return JSON.parse(options.body) as unknown;
    };
    if (pathname === "/workspace" && method === "GET") return { name: "workspace_get", arguments: {} };
    if (pathname === "/seed" && method === "POST") return { name: "workspace_seed", arguments: {} };
    if (pathname === "/tokens" && method === "GET") return { name: "tokens_list", arguments: {} };
    if (pathname === "/tokens" && method === "POST") return { name: "tokens_create", arguments: { data: data() } };
    const token = /^\/tokens\/([^/?#]+)$/.exec(pathname);
    if (token && method === "DELETE") return { name: "tokens_revoke", arguments: { id: decodeURIComponent(token[1]) } };
    const result = /^\/hypotheses\/([^/?#]+)\/results$/.exec(pathname);
    if (result && method === "POST") return { name: "results_create", arguments: { hypothesisId: decodeURIComponent(result[1]), data: data() } };
    const collection = /^\/(projects|hypotheses|experiments|resources)(?:\/([^/?#]+))?$/.exec(pathname);
    if (collection) {
        const [, name, encodedId] = collection;
        const id = encodedId ? decodeURIComponent(encodedId) : undefined;
        if (method === "GET" && id) return { name: `${name}_get`, arguments: { id } };
        if (method === "GET") {
            const args: Record<string, unknown> = {};
            for (const [key, value] of new URLSearchParams(query)) {
                if (!["limit", "offset", "q", "projectId", "status", "hypothesisId", "nodeId"].includes(key)) throw new Error(`不支持的列表参数：${key}`);
                if (key === "limit" || key === "offset") {
                    const number = Number(value);
                    if (!value.trim() || !isOffset(number) || key === "limit" && number === 0) throw new Error(`无效的分页参数：${key}`);
                    args[key] = number;
                } else args[key] = value;
            }
            return { name: `${name}_list`, arguments: args };
        }
        if (method === "POST" && !id) return { name: `${name}_create`, arguments: { data: data() } };
        if (method === "PUT" && id) return { name: `${name}_update`, arguments: { id, data: data() } };
        if (method === "DELETE" && id) return { name: `${name}_delete`, arguments: { id } };
    }
    throw new Error("不支持的 MCP 操作");
}

// A caller may stop waiting without cancelling initialization for other callers.
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        pending.then(value => {
            signal.removeEventListener("abort", aborted);
            if (signal.aborted) reject(signal.reason); else resolve(value);
        }, error => {
            signal.removeEventListener("abort", aborted);
            reject(signal.aborted ? signal.reason : error);
        });
    });
}

export function makeMcpClient(connection: Connection, sessionSignal?: AbortSignal): McpClient {
    const endpoint = endpointFor(connection.baseUrl);
    const token = connection.token;
    let nextId = 0;
    let mcpSessionId: string | null = null;
    let initialization: Promise<void> | null = null;
    const requestSignal = (caller?: AbortSignal | null) => AbortSignal.any([
        AbortSignal.timeout(60000), ...(sessionSignal ? [sessionSignal] : []), ...(caller ? [caller] : []),
    ]);

    async function rpc(method: string, params: unknown, signal: AbortSignal, notification = false): Promise<unknown> {
        signal.throwIfAborted();
        const id = notification ? undefined : ++nextId;
        const headers = new Headers({
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": `Bearer ${token}`,
            "MCP-Protocol-Version": protocolVersion,
        });
        if (mcpSessionId) headers.set("Mcp-Session-Id", mcpSessionId);
        // Only the configured MCP endpoint receives the token. Callers cannot
        // override auth, credentials or redirects through RequestInit.
        const response = await fetch(endpoint, {
            method: "POST", headers, signal, credentials: "omit", redirect: "error",
            body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
        });
        signal.throwIfAborted();
        if (notification && response.ok) return;
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            signal.throwIfAborted();
            throw requestError(`服务未返回 MCP JSON（${response.status}），请检查服务地址`, response.status);
        }
        // Decoding can finish after logout; never publish the old session's data.
        signal.throwIfAborted();
        const error = isRecord(body) ? body.error : undefined;
        if (!response.ok || error) throw requestError(errorMessage(error) || `MCP 请求失败（${response.status}）`, response.status, error);
        if (!isRecord(body) || body.jsonrpc !== "2.0" || body.id !== id || !("result" in body)) throw new Error("服务返回了无效的 MCP 响应");
        if (method === "initialize") mcpSessionId = response.headers.get("Mcp-Session-Id");
        return body.result;
    }

    function initialize(): Promise<void> {
        if (!initialization) {
            const signal = requestSignal();
            initialization = (async () => {
                const result = await rpc("initialize", {
                    protocolVersion, capabilities: {}, clientInfo: { name: "flowmaster-web", version: "2.0.0" },
                }, signal) as { protocolVersion?: string } | null;
                if (result?.protocolVersion !== protocolVersion) throw new Error("服务不支持当前 MCP 协议版本");
                await rpc("notifications/initialized", {}, signal, true);
                signal.throwIfAborted();
            })().catch(error => {
                // A transient initialization failure must remain retryable.
                initialization = null;
                mcpSessionId = null;
                throw error;
            });
        }
        return initialization;
    }

    return async <T,>(name: string, args: Record<string, unknown> = {}, options: CallOptions = {}): Promise<ToolPayload<T>> => {
        const signal = requestSignal(options.signal);
        signal.throwIfAborted();
        const call = { name, arguments: args };
        await waitFor(initialize(), signal);
        signal.throwIfAborted();
        const result = await rpc("tools/call", call, signal);
        signal.throwIfAborted();
        if (!isRecord(result)) throw new Error("服务返回了无效的 MCP 工具结果");
        let payload = result.structuredContent;
        const content = Array.isArray(result.content) ? result.content : [];
        const text = content.find((item: unknown) => isRecord(item) && item.type === "text" && typeof item.text === "string")?.text as string | undefined;
        if (!payload) {
            if (text) {
                try { payload = JSON.parse(text); } catch { /* Report an invalid tool response below. */ }
            }
        }
        const error = isRecord(payload) ? payload.error : undefined;
        if (result.isError || error) throw requestError(errorMessage(error) || text || "MCP 工具调用失败", isRecord(payload) ? payload.status : undefined, error);
        if (!isRecord(payload) || !("data" in payload)) throw new Error("服务返回了无效的 MCP 工具结果");
        if (payload.affectedHypothesis !== undefined && !isRecord(payload.affectedHypothesis) || payload.deletedExperimentIds !== undefined && (!Array.isArray(payload.deletedExperimentIds) || payload.deletedExperimentIds.some(id => typeof id !== "string"))) {
            throw new Error("服务返回了无效的 MCP 工具结果");
        }
        return payload as unknown as ToolPayload<T>;
    };
}

export function parsePage<T>(payload: ToolPayload<T[]>, offset: unknown = 0): ApiPage<T> {
    if (!isOffset(offset) || !Array.isArray(payload.data) || !isOffset(payload.total)) throw new Error("服务返回了无效的 MCP 分页结果");
    let nextOffset = payload.nextOffset;
    // Legacy servers may return short pages under their byte budget.
    if (!Object.hasOwn(payload, "nextOffset")) nextOffset = offset + payload.data.length < payload.total ? offset + payload.data.length : null;
    if (nextOffset !== null && (!isOffset(nextOffset) || nextOffset <= offset)) throw new Error("服务返回了无法继续的 MCP 分页结果");
    return { data: payload.data, total: payload.total, nextOffset };
}

/** Compatibility adapter for existing integrations; new UI uses named operations. */
export function makeClient(connection: Connection, sessionSignal?: AbortSignal): ApiClient {
    const callTool = makeMcpClient(connection, sessionSignal);
    async function request(path: string, options: RequestInit = {}, listOnly = false) {
        options.signal?.throwIfAborted();
        sessionSignal?.throwIfAborted();
        const call = toolFor(path, options);
        if (listOnly && !/^(projects|hypotheses|experiments|resources)_list$/.test(call.name)) throw new Error("分页请求需要集合列表操作");
        return { payload: await callTool(call.name, call.arguments, options), call };
    }

    const client: ApiClient = async <T,>(path: string, options?: RequestInit) => (await request(path, options)).payload.data as T;
    client.page = async <T,>(path: string, options?: RequestInit): Promise<ApiPage<T>> => {
        const { payload, call } = await request(path, options, true);
        return parsePage(payload as ToolPayload<T[]>, call.arguments.offset ?? 0);
    };
    client.mutation = async <T,>(path: string, options?: RequestInit): Promise<MutationResult<T>> => {
        const { payload } = await request(path, options);
        return {
            data: payload.data as T,
            ...(payload.affectedHypothesis === undefined ? {} : { affectedHypothesis: payload.affectedHypothesis as unknown as MutationResult<T>["affectedHypothesis"] }),
            ...(payload.deletedExperimentIds === undefined ? {} : { deletedExperimentIds: payload.deletedExperimentIds as string[] }),
        };
    };
    return client;
}
