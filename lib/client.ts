export interface Connection {
    baseUrl: string;
    token: string;
    remember: boolean;
}
// API responses are checked by the server's schemas; callers provide result types.
export type ApiClient = <T = any>(path: string, options?: RequestInit) => Promise<T>;
export const isRequestCancelled = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function makeClient(connection: Connection, sessionSignal?: AbortSignal): ApiClient {
    return async <T,>(path: string, options: RequestInit = {}) => {
        const signals = [AbortSignal.timeout(60000)];
        if (sessionSignal) signals.push(sessionSignal);
        if (options.signal) signals.push(options.signal);
        const signal = AbortSignal.any(signals);
        // A completed write may schedule a refresh after logout. Never send that
        // follow-up with the old session, even if fetch ignores cancellation.
        signal.throwIfAborted();
        const headers = new Headers({ "Content-Type": "application/json", "Authorization": `Bearer ${connection.token}` });
        new Headers(options.headers).forEach((value, key) => headers.set(key, value));
        const response = await fetch(`${connection.baseUrl.replace(/\/$/, "")}/api/v1${path}`, { ...options, headers, signal });
        let body: { data: T; error?: { message?: string } };
        try {
            body = await response.json();
        } catch {
            signal.throwIfAborted();
            throw new Error(`服务未返回 JSON（${response.status}），请检查 API 地址`);
        }
        // Cancellation may happen while the body is being decoded. Prevent an
        // old account's response from reaching any state-update continuation.
        signal.throwIfAborted();
        if (!response.ok) throw new Error(body.error?.message || `请求失败（${response.status}）`);
        return body.data;
    };
}
