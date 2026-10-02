import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBuild } from "../scripts/verify-build.mjs";
test("Vue build verifier rejects missing or uncompiled assets", t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),"flowmaster-vue-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.throws(()=>verifyBuild(root));
  mkdirSync(path.join(root,"dist/client"),{recursive:true});
  writeFileSync(path.join(root,"dist/client/index.html"),'<div id="app"></div><script src="/src/main.js"></script>');
  assert.throws(()=>verifyBuild(root),/not built/);
  writeFileSync(path.join(root,"dist/client/index.html"),'<div id="app"></div><script src="/assets/main.js"></script>');
  assert.throws(()=>verifyBuild(root),/missing/);
  mkdirSync(path.join(root,"dist/client/assets"));writeFileSync(path.join(root,"dist/client/assets/main.js"),"export {}");
  assert.equal(verifyBuild(root),path.join(root,"dist/client"));
});
