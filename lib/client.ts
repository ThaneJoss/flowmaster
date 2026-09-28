export interface Connection {
    baseUrl: string;
    token: string;
    remember: boolean;
}
// API responses are checked by the server's schemas; callers provide result types.
export type ApiClient = <T = any>(path: string, options?: RequestInit) => Promise<T>;
export function makeClient(connection: Connection): ApiClient { return async <T,>(path: string, options: RequestInit = {}) => { const response = await fetch(`${connection.baseUrl.replace(/\/$/, "")}/api/v1${path}`, { ...options, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${connection.token}`, ...options.headers }, signal: options.signal || AbortSignal.timeout(60000) }); let body: any; try {
    body = await response.json();
}
catch {
    throw new Error(`服务未返回 JSON（${response.status}），请检查 API 地址`);
} if (!response.ok)
    throw new Error(body.error?.message || `请求失败（${response.status}）`); return body.data as T; }; }
