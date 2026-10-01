import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyBuild } from "./verify-build.mjs";
const mode = process.argv[2];
if (!["deploy", "preview", "check"].includes(mode) || process.argv.length !== 3) throw new Error("Use deploy, preview or check");
const root = fileURLToPath(new URL("../", import.meta.url));
function run(script, args) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("../node_modules/vite/bin/vite.js", ["build"]);
verifyBuild(root);
run("../node_modules/wrangler/bin/wrangler.js", mode === "check" ? ["deploy", "--dry-run"] : [mode]);
