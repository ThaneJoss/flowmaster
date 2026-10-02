export interface Connection {
    baseUrl: string;
    token: string;
    remember: boolean;
}
// Keep the UI's collection operations local; all requests use MCP tools over /mcp.
export type ApiClient = <T = any>(path: string, options?: RequestInit) => Promise<T>;
export const isRequestCancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";

const protocolVersion = "2025-11-25";
interface ToolCall { name: string; arguments: Record<string, unknown> }
interface ToolPayload { data?: unknown; error?: { message?: string }; status?: number }
interface ToolResult {
    structuredContent?: ToolPayload;
    content?: { type: string; text?: string }[];
    isError?: boolean;
}
interface RpcResponse {
    jsonrpc?: string;
    id?: number;
    result?: unknown;
    error?: { message?: string };
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
                if (!["limit", "offset", "q", "projectId"].includes(key)) throw new Error(`不支持的列表参数：${key}`);
                args[key] = key === "limit" || key === "offset" ? Number(value) : value;
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

export function makeClient(connection: Connection, sessionSignal?: AbortSignal): ApiClient {
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
        let body: RpcResponse;
        try {
            body = await response.json() as RpcResponse;
        } catch {
            signal.throwIfAborted();
            throw new Error(`服务未返回 MCP JSON（${response.status}），请检查服务地址`);
        }
        // Decoding can finish after logout; never publish the old session's data.
        signal.throwIfAborted();
        if (!response.ok || body?.error) throw new Error(body?.error?.message || `MCP 请求失败（${response.status}）`);
        if (body?.jsonrpc !== "2.0" || body.id !== id || !("result" in body)) throw new Error("服务返回了无效的 MCP 响应");
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

    return async <T,>(path: string, options: RequestInit = {}) => {
        const signal = requestSignal(options.signal);
        signal.throwIfAborted();
        const call = toolFor(path, options);
        await waitFor(initialize(), signal);
        signal.throwIfAborted();
        const result = await rpc("tools/call", call, signal) as ToolResult | null;
        signal.throwIfAborted();
        let payload = result?.structuredContent;
        const text = result?.content?.find(item => item.type === "text" && typeof item.text === "string")?.text;
        if (!payload) {
            if (text) {
                try { payload = JSON.parse(text) as ToolPayload; } catch { /* Report an invalid tool response below. */ }
            }
        }
        if (result?.isError || payload?.error) throw new Error(payload?.error?.message || text || "MCP 工具调用失败");
        if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("服务返回了无效的 MCP 工具结果");
        return payload.data as T;
    };
}
