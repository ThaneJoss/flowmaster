import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export function verifyBuild(root = fileURLToPath(new URL("../", import.meta.url))) {
  const directory = path.join(root, "dist/client");
  const index = readFileSync(path.join(directory, "index.html"), "utf8");
  if (!index.includes('id="app"') || index.includes("/src/main.js")) throw new Error("Vue production HTML was not built");
  const assets = path.join(directory, "assets");
  if (!statSync(assets, { throwIfNoEntry: false })?.isDirectory() || !readdirSync(assets).some(name => name.endsWith(".js"))) throw new Error("Vue JavaScript assets are missing");
  console.log("Verified Vue static production assets");
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) verifyBuild();
