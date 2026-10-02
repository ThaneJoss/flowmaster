import { handleApi, type Bindings } from "../lib/server/api.ts";

interface Env extends Bindings { ASSETS: Fetcher }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) return handleApi(request, env);
    if (pathname === "/api" || pathname.startsWith("/api/")) return Response.json({ error: { code: "NOT_FOUND", message: "接口不存在" } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
