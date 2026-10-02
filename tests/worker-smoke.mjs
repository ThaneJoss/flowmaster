import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const { Miniflare }=require(require.resolve("miniflare",{paths:[require.resolve("wrangler")]}));
const admin="smoke-admin-0123456789-0123456789-0123456789";
const mf=new Miniflare({name:"flowmaster-smoke",modules:true,scriptPath:path.resolve(".worker-build/index.js"),compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"smoke-db"},bindings:{ADMIN_TOKEN:admin,ENCRYPTION_KEY:"smoke-encryption-0123456789-0123456789-different"},assets:{directory:path.resolve("dist/client"),binding:"ASSETS",routerConfig:{has_user_worker:true,static_routing:{user_worker:["/api/*"]}}},cf:false});
try {
  const db=await mf.getD1Database("DB");
  for(const file of readdirSync("drizzle").filter(n=>n.endsWith(".sql")).sort())
    for(const sql of readFileSync("drizzle/"+file,"utf8").split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  const page=await mf.dispatchFetch("https://flowmaster.example/");
  assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('id="app"'));assert.ok(!html.includes(admin));assert.ok(!html.includes("/src/main.js"));
  const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);assert.ok(scripts.length);
  for(const script of scripts){const response=await mf.dispatchFetch(new URL(script,"https://flowmaster.example/"));assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
  const favicon=await mf.dispatchFetch("https://flowmaster.example/favicon.svg");assert.equal(favicon.status,200);
  const denied=await mf.dispatchFetch("https://flowmaster.example/api/v1/workspace");assert.equal(denied.status,401);
  const workspace=await mf.dispatchFetch("https://flowmaster.example/api/v1/workspace",{headers:{Authorization:"Bearer "+admin}});assert.equal(workspace.status,200);assert.deepEqual((await workspace.json()).data,{projects:[],hypotheses:[],experiments:[],resources:[]});
  const seed=await mf.dispatchFetch("https://flowmaster.example/api/v1/seed",{method:"POST",headers:{Authorization:"Bearer "+admin}});assert.equal(seed.status,201);
  const spec=await mf.dispatchFetch("https://flowmaster.example/openapi.json");assert.equal(spec.status,200);assert.equal((await spec.json()).openapi,"3.0.3");
  console.log("PASS: Vue assets, Worker routing, authentication and isolated D1 smoke test");
} finally { await mf.dispose(); }
