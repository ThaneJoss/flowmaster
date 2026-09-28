import { z } from "zod";
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().max(16000).default("");
const title = z.string().trim().min(1).max(200);
export const status = z.enum(["pending", "running", "verified", "rejected"]);
const base = { id: id.optional(), updatedAt: z.string().optional(), revision: z.number().int().positive().optional() };
export const nodeSchema = z.object({ id, title, type: z.enum(["baseline", "observation", "hypothesis", "experiment", "conclusion"]), status, x: z.number().min(0).max(10000), y: z.number().min(0).max(10000), inputs: text, output: text, summary: text, rationale: text, method: text, conclusion: text, nextAction: text, startedAt: z.string().max(100).default(""), duration: z.string().max(100).default("") });
const edgeSchema = z.object({ source: id, target: id });
export const schemas = {
    projects: z.object({ ...base, name: title, description: text }),
    hypotheses: z.object({ ...base, projectId: id, title, description: text, baseline: z.string().max(200).default(""), status, nodes: z.array(nodeSchema).max(120), edges: z.array(edgeSchema).max(360) }).superRefine((h, ctx) => { const ids = new Set(h.nodes.map(n => n.id)); if (ids.size !== h.nodes.length) {
        ctx.addIssue({ code: "custom", message: "节点 ID 不能重复" });
        return;
    } const edges = new Set<string>(); for (const e of h.edges) {
        const key = `${e.source}->${e.target}`;
        if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target || edges.has(key)) {
            ctx.addIssue({ code: "custom", message: "连线不能重复或引用无效节点" });
            return;
        }
        edges.add(key);
    } const seen = new Set<string>(), active = new Set<string>(); const visit = (key: string): boolean => { if (active.has(key))
        return true; if (seen.has(key))
        return false; active.add(key); for (const e of h.edges.filter(e => e.source === key)) {
        if (visit(e.target))
            return true;
    } active.delete(key); seen.add(key); return false; }; for (const key of ids)
        if (visit(key)) {
            ctx.addIssue({ code: "custom", message: "流程不能包含循环依赖" });
            return;
        } }),
    experiments: z.object({ ...base, hypothesisId: id, nodeId: id, title, status, summary: text, source: z.enum(["manual", "agent"]).default("manual"), duration: z.string().max(100).default(""), logs: z.array(z.object({ time: z.string().max(100), message: z.string().max(16000) })).max(200).default([]) }),
    resources: z.object({ ...base, projectId: id, name: title, type: z.enum(["dataset", "model", "document", "code"]), url: z.string().max(2000).refine(s => !s || /^https?:\/\//i.test(s) && (() => { try {
            const u = new URL(s);
            return !u.username && !u.password;
        }
        catch {
            return false;
        } })(), "资源链接必须是 HTTP(S) 地址").default(""), description: text })
};
export const tokenSchema = z.object({ name: z.string().trim().min(1).max(80), scope: z.enum(["read", "write", "admin"]), expiresInDays: z.number().int().min(1).max(365) });
export const modelSchema = z.object({ baseUrl: z.string().url().max(2000), model: z.string().trim().min(1).max(120), apiKey: z.string().trim().min(1).max(4096).optional() });
export const resultSchema = z.object({ nodeId: id, title, status, summary: z.string().trim().min(1).max(16000), duration: z.string().max(100).default("") });
