import type { Bindings } from "../lib/server/api.ts";
import { handleMcp } from "../lib/server/mcp.ts";

interface Env extends Bindings { ASSETS: Fetcher }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname === "/mcp/") return handleMcp(request, env);
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/mcp/") || pathname === "/openapi.json") return Response.json({ error: { code: "NOT_FOUND", message: "接口不存在；请使用 /mcp" } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
