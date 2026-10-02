import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.ts";

const admin = "routing-admin-0123456789-0123456789-0123456789";
const db = {
  prepare: () => ({
    bind: () => ({
      first: async () => ({ count: 1 }),
      run: async () => ({ success: true }),
    }),
  }),
};

test("Worker serves static assets and rejects retired REST routes without asset fallback", async () => {
  let assetCalls = 0;
  const env = { ASSETS: { fetch: async () => { assetCalls++; return new Response("static"); } } } as any;
  assert.equal(await (await worker.fetch(new Request("https://example.com/"), env)).text(), "static");
  assert.equal(assetCalls, 1);
  for (const pathname of ["/api", "/api/unknown", "/api/v1", "/api/v1/health", "/api/v1/workspace", "/openapi.json"]) {
    const response = await worker.fetch(new Request(`https://example.com${pathname}`), env);
    assert.equal(response.status, 404, pathname);
    assert.equal(assetCalls, 1, `${pathname} must not reach ASSETS`);
  }
});

test("MCP requires authentication and rejects unsupported authenticated methods", async () => {
  const env = { DB: db, ADMIN_TOKEN: admin, ASSETS: { fetch: async () => { throw new Error("MCP must not reach ASSETS"); } } } as any;
  const denied = await worker.fetch(new Request("https://example.com/mcp", { method: "POST" }), env);
  assert.equal(denied.status, 401);
  for (const method of ["GET", "DELETE"]) {
    const response = await worker.fetch(new Request("https://example.com/mcp", { method, headers: { Authorization: `Bearer ${admin}` } }), env);
    assert.equal(response.status, 405, method);
  }
});

test("MCP fails closed when storage or administrator configuration is missing", async () => {
  for (const bindings of [{ ADMIN_TOKEN: admin }, { DB: db }]) {
    const env = { ...bindings, ASSETS: { fetch: async () => { throw new Error("MCP must not reach ASSETS"); } } } as any;
    const response = await worker.fetch(new Request("https://example.com/mcp", { method: "POST", headers: { Authorization: `Bearer ${admin}` } }), env);
    assert.equal(response.status, 503);
  }
});
