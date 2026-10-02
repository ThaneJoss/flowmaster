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

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function fail(status: number, code: string, message: string): never {
    throw new ApiError(status, code, message);
}

export const now = () => new Date().toISOString();
const encoder = new TextEncoder();
export const hash = async (value: string) => Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    byte => byte.toString(16).padStart(2, "0"),
).join("");

async function rateLimit(env: Bindings, key: string, max: number, seconds: number) {
    const timestamp = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(timestamp / seconds);
    const row = await env.DB.prepare(
        "INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    ).bind(`${key}:${bucket}`, (bucket + 1) * seconds).first<{ count: number }>();
    if (row && row.count > max)
        fail(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
    if (Math.random() < .015)
        await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(timestamp - 60).run();
}

async function authenticate(req: Request, env: Bindings): Promise<Principal> {
    if (!env.DB)
        fail(503, "STORAGE_UNAVAILABLE", "尚未绑定 D1 数据库");
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32)
        fail(503, "NOT_CONFIGURED", "请在 Cloudflare 配置至少 32 位 ADMIN_TOKEN");
    const token = req.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || token.length > 4096)
        fail(401, "UNAUTHORIZED", "需要有效的 Bearer Token");
    const digest = await hash(token);
    if (digest === await hash(env.ADMIN_TOKEN))
        return { scope: "admin", id: "bootstrap-admin" };
    const record = await env.DB.prepare(
        "SELECT id,scope,expires_at,last_used_at FROM access_tokens WHERE hash = ?",
    ).bind(digest).first<{
        id: string;
        scope: Principal["scope"];
        expires_at: string | null;
        last_used_at: string | null;
    }>();
    const timestamp = Date.now();
    const stamp = new Date(timestamp).toISOString();
    if (!record || record.expires_at && record.expires_at <= stamp)
        fail(401, "UNAUTHORIZED", "Token 无效、已过期或已撤销");
    const cutoff = new Date(timestamp - 60000).toISOString();
    // Skip the extra round trip for recently used tokens. The SQL guard also
    // protects concurrent requests that both read an older timestamp.
    if (record.last_used_at === null || record.last_used_at < cutoff)
        await env.DB.prepare(
            "UPDATE access_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
        ).bind(stamp, record.id, cutoff).run();
    return { scope: record.scope, id: record.id };
}

export function requireScope(scope: string, required: "write" | "admin") {
    if (required === "admin" && scope !== "admin" || required === "write" && scope === "read")
        fail(403, "FORBIDDEN", required === "admin" ? "此操作需要管理员 Token" : "此 Token 仅有只读权限");
}

export function validateOrigin(req: Request, env: Bindings): void {
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
    if (origin && origin !== new URL(req.url).origin && !allowed.includes(origin))
        fail(403, "ORIGIN_NOT_ALLOWED", "当前前端域名未配置在 ALLOWED_ORIGINS 中");
}

export async function authorizeRequest(req: Request, env: Bindings): Promise<Principal> {
    validateOrigin(req, env);
    if (env.DB)
        await rateLimit(env, `ip:${req.headers.get("CF-Connecting-IP") || "local"}`, 360, 60);
    return authenticate(req, env);
}
