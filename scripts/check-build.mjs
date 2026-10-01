import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Validate Vite's generated deployment config, never a placeholder directory. */
export function checkBuild(root = fileURLToPath(new URL("../", import.meta.url))) {
  const projectRoot = path.resolve(root);
  const pointerPath = path.join(projectRoot, ".wrangler/deploy/config.json");
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (cause) {
      throw new Error("Missing or invalid build configuration: " + file + ". Run pnpm build first.", { cause });
    }
  };
  const pointer = readJson(pointerPath);
  if (typeof pointer.configPath !== "string" || !pointer.configPath) {
    throw new Error("Vite deployment pointer has no configPath");
  }
  const configPath = path.resolve(path.dirname(pointerPath), pointer.configPath);
  const outputRoot = path.join(projectRoot, "dist");
  const requireOutputPath = (file) => {
    const relative = path.relative(outputRoot, file);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw new Error("Deployment artifact must be inside dist: " + file);
    }
  };
  requireOutputPath(configPath);
  const config = readJson(configPath);
  if (typeof config.main !== "string" || typeof config.assets?.directory !== "string") {
    throw new Error("Generated deployment config must include main and assets.directory");
  }
  const mainPath = path.resolve(path.dirname(configPath), config.main);
  const assetsPath = path.resolve(path.dirname(configPath), config.assets.directory);
  requireOutputPath(mainPath);
  requireOutputPath(assetsPath);
  if (!statSync(mainPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Missing built Worker entry: " + mainPath);
  }
  if (!statSync(assetsPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("Missing built client assets: " + assetsPath);
  }
  const hasJavaScript = (directory) => readdirSync(directory, { withFileTypes: true }).some(
    (entry) => entry.isDirectory()
      ? hasJavaScript(path.join(directory, entry.name))
      : entry.isFile() && /\.(?:m?js)$/.test(entry.name)
  );
  if (!hasJavaScript(assetsPath)) {
    throw new Error("No compiled JavaScript found in client assets: " + assetsPath + ". An empty directory is not a successful build.");
  }
  if (config.build?.command) {
    throw new Error("Generated deployment config must not start another build");
  }
  return { configPath, mainPath, assetsPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkBuild();
  console.log("Verified Worker and client assets using " + result.configPath);
}
