import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.ts";
test("Worker routes health to API and static requests to assets",async()=>{
  let assetCalls=0;
  const env={ASSETS:{fetch:async()=>{assetCalls++;return new Response("static");}}} as any;
  const health=await worker.fetch(new Request("https://example.com/api/v1/health"),env);
  assert.equal(health.status,200);assert.equal((await health.json() as any).data.name,"FlowMaster");assert.equal(assetCalls,0);
  assert.equal(await (await worker.fetch(new Request("https://example.com/"),env)).text(),"static");assert.equal(assetCalls,1);
  const missing=await worker.fetch(new Request("https://example.com/api/unknown"),env);assert.equal(missing.status,404);assert.equal(assetCalls,1);
});
