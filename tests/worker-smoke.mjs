import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare } = require(require.resolve("miniflare", { paths: [require.resolve("wrangler")] }));
const admin = "smoke-admin-0123456789-0123456789-0123456789";
const mf = new Miniflare({
  name: "flowmaster-smoke",
  modules: true,
  scriptPath: path.resolve(".worker-build/index.js"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "smoke-db" },
  bindings: { ADMIN_TOKEN: admin },
  assets: {
    directory: path.resolve("dist/client"),
    binding: "ASSETS",
    routerConfig: { has_user_worker: true, static_routing: { user_worker: ["/mcp", "/mcp/*", "/api", "/api/*", "/openapi.json"] } },
  },
  cf: false,
});
const mcpHeaders = {
  Authorization: `Bearer ${admin}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "MCP-Protocol-Version": "2025-11-25",
};
let requestId = 0;
const rpc = async (method, params) => {
  const id = ++requestId;
  const response = await mf.dispatchFetch("https://flowmaster.example/mcp", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200, method);
  const message = await response.json();
  assert.equal(message.jsonrpc, "2.0");
  assert.equal(message.id, id);
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  return message.result;
};
const callTool = async (name, args = {}) => {
  const result = await rpc("tools/call", { name, arguments: args });
  assert.notEqual(result.isError, true, name);
  const text = result.content.find(item => item.type === "text");
  assert.ok(text, `${name} includes a text result`);
  assert.deepEqual(JSON.parse(text.text), result.structuredContent);
  return result.structuredContent.data;
};
try {
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("drizzle").filter(n => n.endsWith(".sql")).sort())
    for (const sql of readFileSync(`drizzle/${file}`, "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean))
      await db.prepare(sql).run();
  const page = await mf.dispatchFetch("https://flowmaster.example/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('id="app"'));
  assert.ok(!html.includes(admin));
  assert.ok(!html.includes("/src/main.js"));
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length);
  for (const script of scripts) {
    const response = await mf.dispatchFetch(new URL(script, "https://flowmaster.example/"));
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
  }
  const favicon = await mf.dispatchFetch("https://flowmaster.example/favicon.svg");
  assert.equal(favicon.status, 200);
  for (const pathname of ["/api", "/api/v1", "/api/v1/workspace", "/openapi.json"]) {
    const response = await mf.dispatchFetch(`https://flowmaster.example${pathname}`);
    assert.equal(response.status, 404, pathname);
  }
  const denied = await mf.dispatchFetch("https://flowmaster.example/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: mcpHeaders.Accept },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} }),
  });
  assert.equal(denied.status, 401);
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "flowmaster-smoke", version: "1.0.0" },
  });
  assert.equal(initialized.protocolVersion, "2025-11-25");
  assert.ok(initialized.capabilities.tools);
  const notification = await mf.dispatchFetch("https://flowmaster.example/mcp", {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(notification.status, 202);
  const listed = await rpc("tools/list", {});
  assert.ok(listed.tools.some(tool => tool.name === "workspace_get"));
  assert.ok(listed.tools.some(tool => tool.name === "workspace_seed"));
  assert.deepEqual(await callTool("workspace_get"), { projects: [], hypotheses: [], experiments: [], resources: [] });
  const seed = await callTool("workspace_seed");
  assert.ok(seed.imported > 0);
  const workspace = await callTool("workspace_get");
  assert.equal(workspace.hypotheses.length, 6);
  console.log("PASS: Vue assets, Worker MCP routing, authentication and isolated D1 smoke test");
} finally {
  await mf.dispose();
}
