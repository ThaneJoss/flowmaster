import { env } from "cloudflare:workers";
import { handleApi, type Bindings } from "@/lib/server/api";
const handler = (request: Request) => handleApi(request, env as unknown as Bindings);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
