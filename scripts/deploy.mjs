import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkBuild } from "./check-build.mjs";

const mode = process.argv[2];
if (!["deploy", "preview", "check"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/deploy.mjs deploy|preview|check");
}
const root = fileURLToPath(new URL("../", import.meta.url));
function run(script, args) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Build before invoking Wrangler: a clean checkout has no dist/client.
// Select the generated config explicitly so deploy and preview use the same outputs.
run("./run-framework.mjs", ["build"]);
const { configPath } = checkBuild(root);
const args = mode === "preview"
  ? ["versions", "upload"]
  : ["deploy", ...(mode === "check" ? ["--dry-run"] : [])];
run("../node_modules/wrangler/bin/wrangler.js", [...args, "--config", configPath]);
