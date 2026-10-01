import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkBuild } from "../scripts/check-build.mjs";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "flowmaster-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file: string, content: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write(".wrangler/deploy/config.json", JSON.stringify({ configPath: "../../dist/server/wrangler.json" }));
  write("dist/server/wrangler.json", JSON.stringify({ main: "index.js", assets: { directory: "../client" } }));
  write("dist/server/index.js", "export default {};");
  write("dist/client/assets/app.js", "console.log('fixture');");
  return { root, write };
}

test("accepts generated config with Worker and compiled client assets", (t) => {
  const { root } = fixture(t);
  assert.equal(checkBuild(root).assetsPath, path.join(root, "dist/client"));
});

test("rejects a clean checkout without the Vite deployment pointer", (t) => {
  const { root } = fixture(t);
  rmSync(path.join(root, ".wrangler"), { recursive: true });
  assert.throws(() => checkBuild(root), /Missing or invalid build configuration/);
});

test("rejects a missing client directory", (t) => {
  const { root } = fixture(t);
  rmSync(path.join(root, "dist/client"), { recursive: true });
  assert.throws(() => checkBuild(root), /Missing built client assets/);
});

test("rejects placeholder assets without compiled JavaScript", (t) => {
  const { root, write } = fixture(t);
  rmSync(path.join(root, "dist/client"), { recursive: true });
  write("dist/client/.gitkeep", "");
  assert.throws(() => checkBuild(root), /No compiled JavaScript/);
});

test("rejects a missing Worker entry", (t) => {
  const { root } = fixture(t);
  rmSync(path.join(root, "dist/server/index.js"));
  assert.throws(() => checkBuild(root), /Missing built Worker entry/);
});

test("rejects source directories instead of generated assets", (t) => {
  const { root, write } = fixture(t);
  write("dist/server/wrangler.json", JSON.stringify({ main: "index.js", assets: { directory: "../../public" } }));
  assert.throws(() => checkBuild(root), /Deployment artifact must be inside dist/);
});

test("rejects recursive builds in the generated deployment config", (t) => {
  const { root, write } = fixture(t);
  write("dist/server/wrangler.json", JSON.stringify({
    main: "index.js", assets: { directory: "../client" }, build: { command: "pnpm build" },
  }));
  assert.throws(() => checkBuild(root), /must not start another build/);
});
