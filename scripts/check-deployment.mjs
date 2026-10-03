import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const knownBindingTypes = new Set(["d1", "secret_text", "plain_text", "json", "assets"]);
let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`失败：${message}`);
}

function existsAs(filename, kind) {
  if (typeof filename !== "string" || !filename) return false;
  try {
    const stat = statSync(path.resolve(root, filename));
    return kind === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

function bindingType(binding) {
  return knownBindingTypes.has(binding?.type) ? binding.type : "其他或未知类型";
}

// Resolve only the two bindings this application needs. Other local binding
// kinds still count as overrides, so a Dashboard D1 cannot hide a local KV DB.
function localBinding(config, name) {
  const previews = config.previews ?? {};
  const candidates = [];
  if (Object.hasOwn(previews.vars ?? {}, name)) {
    candidates.push({ type: typeof previews.vars[name] === "string" ? "plain_text" : "json" });
  }
  for (const [kind, settings] of Object.entries(previews)) {
    if (kind === "vars" || kind === "unsafe") continue;
    const bindings = Array.isArray(settings) ? settings
      : settings?.bindings ?? settings?.producers ?? (settings?.binding ? [settings] : []);
    for (const binding of bindings) {
      const bindingName = ["durable_objects", "send_email", "ratelimits"].includes(kind)
        ? binding?.name : binding?.binding;
      if (bindingName !== name) continue;
      candidates.push({ type: kind === "d1_databases" ? "d1" : kind, database_id: binding.database_id });
    }
  }
  if (config.assets?.binding === name) candidates.push({ type: "assets" });
  for (const binding of previews.unsafe?.bindings ?? []) {
    if (binding.name === name) candidates.push({ type: binding.type, database_id: binding.database_id });
  }
  if (candidates.length > 1) return { type: "ambiguous" };
  return candidates[0];
}

function checkBinding(name, binding, source) {
  if (!binding) {
    fail(`预览 ${name} 未配置（${source}）。`);
    return;
  }
  const expected = name === "DB" ? "d1" : "secret_text";
  if (binding.type !== expected) {
    fail(`预览 ${name} 类型为 ${bindingType(binding)}，需要 ${expected}（${source}）。`);
  } else if (name === "DB" && !uuid.test(binding.database_id ?? "")) {
    fail(`预览 DB 已声明为 d1，但缺少有效数据库 ID（${source}）。`);
  } else {
    console.log(`通过：预览 ${name} 已配置，类型 ${expected}（${source}）。`);
  }
}

function apiCodes(payload) {
  if (!Array.isArray(payload?.errors)) return "未提供";
  // Error messages can contain supplied configuration. Print numeric codes only.
  const codes = payload.errors.map(error => error?.code)
    .filter(code => /^(?:\d{1,12})$/.test(String(code)));
  return codes.length ? codes.join(", ") : "未提供";
}

async function checkRemote(config) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token?.trim()) {
    fail("无法远端验证：未提供 CLOUDFLARE_API_TOKEN；未发送请求。");
    return;
  }
  if (!/^[a-f0-9]{32}$/i.test(config.account_id ?? "") || !config.name) {
    fail("无法远端验证：wrangler.jsonc 需要有效 account_id 和 Worker name；未发送请求。");
    return;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.account_id)}/workers/workers/${encodeURIComponent(config.name)}`;
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    payload = await response.json();
  } catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "请求超过 15 秒"
      : response ? `HTTP ${response.status} 响应无法解析或读取` : "网络连接失败或重定向被拒绝";
    fail(`无法远端验证：${reason}；未输出响应内容。`);
    return;
  }
  if (!response.ok || payload?.success !== true) {
    fail(`无法远端验证：HTTP ${response.status}，Cloudflare code ${apiCodes(payload)}。请核对账号、API 权限及 Worker Previews 功能状态。`);
    return;
  }
  const worker = payload.result;
  if (!worker || typeof worker !== "object" || Array.isArray(worker)) {
    fail(`无法远端验证：HTTP ${response.status} 返回的 Worker 数据格式异常。`);
    return;
  }
  const defaults = worker.preview_defaults?.env ?? {};
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    fail(`无法远端验证：HTTP ${response.status} 返回的 preview_defaults 格式异常。`);
    return;
  }
  console.log("通过：已只读获取 Cloudflare 预览默认值。");
  for (const name of ["DB", "ADMIN_TOKEN"]) {
    const local = localBinding(config, name);
    checkBinding(name, local ?? defaults[name], local ? "本地预览配置覆盖默认值" : "Dashboard 预览默认值");
  }
  console.log("未验证：Secret 长度、D1 表结构/迁移、数据库访问权限、预览配额及部署运行结果。");
}

async function main() {
  if (args.some(arg => !["--remote", "--help", "-h"].includes(arg))) {
    fail("不支持的参数；使用 --help 查看用法。");
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`用法：node scripts/check-deployment.mjs [--remote]

默认只读检查 Node、声明的 pnpm/Wrangler 版本、Worker 入口、已构建的静态目录和 D1 配置。
固定检查 wrangler.jsonc 的顶层生产配置，不使用 CLOUDFLARE_ENV 命名环境。
请先运行 pnpm build。本地预览绑定未声明时，会标记依赖 Dashboard，且不据此判失败。
--remote 额外用 CLOUDFLARE_API_TOKEN 发一次只读 GET，检查预览默认值的 DB/ADMIN_TOKEN 类型。
远端验证缺少 Token、请求失败或必需绑定缺失时，命令退出非零。
不读取 .dev.vars，不输出 Secret/变量值，不执行构建、部署、上传或迁移。
检查通过不代表远端发布、运行、Secret 长度、数据库迁移或配额已验证。`);
    return;
  }

  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  console.log(`Node：${process.version}（项目要求 ${manifest.engines?.node ?? "未声明"}）`);
  console.log(`包管理器声明：${manifest.packageManager ?? "未声明"}（未运行包管理器）`);
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || major === 22 && minor < 13) fail("需要 Node.js >=22.13.0；建议使用项目指定的 Node.js 24。");

  let config;
  try {
    const installed = JSON.parse(readFileSync(require.resolve("wrangler/package.json"), "utf8"));
    const pinned = manifest.devDependencies?.wrangler;
    if (installed.version !== pinned) {
      fail("已安装 Wrangler 与 package.json 固定版本不一致；请使用 frozen-lockfile 安装依赖。");
      return;
    }
    console.log(`Wrangler：${installed.version}（与项目固定版本一致）`);
    // Suppress library logging and update checks: diagnostics may include values
    // from configuration. This API reads Wrangler config, not .dev.vars/.env.
    process.env.WRANGLER_LOG = "none";
    process.env.WRANGLER_WRITE_LOGS = "false";
    process.env.WRANGLER_SEND_METRICS = "false";
    const { unstable_readConfig } = await import("wrangler");
    config = unstable_readConfig({ config: path.join(root, "wrangler.jsonc"), env: "" }, { hideWarnings: true, useRedirectIfAvailable: false });
  } catch {
    fail("无法加载固定版本 Wrangler 或解析 wrangler.jsonc；请检查依赖及配置格式（未输出可能包含变量值的原始错误）。");
    return;
  }

  if (existsAs(config.main, "file")) console.log("通过：Worker 入口文件存在。");
  else fail("Worker 入口文件不存在；请检查 wrangler.jsonc 的 main。");
  if (config.assets?.binding !== "ASSETS") fail("静态资源需要 ASSETS 绑定。");
  if (existsAs(config.assets?.directory, "directory") && existsAs(path.join(config.assets.directory, "index.html"), "file")) {
    console.log("通过：静态资源目录和 index.html 存在。");
  } else {
    fail("静态资源目录或 index.html 不存在；请先运行 pnpm build。");
  }
  const databases = config.d1_databases.filter(database => database.binding === "DB");
  if (databases.length === 1 && uuid.test(databases[0].database_id ?? "")) console.log("通过：生产 DB 已声明有效 D1 数据库 ID（未查询远端）。");
  else fail("生产配置需要唯一 DB 绑定和有效 D1 数据库 ID。");

  for (const name of ["DB", "ADMIN_TOKEN"]) {
    const binding = localBinding(config, name);
    if (binding) checkBinding(name, binding, "本地预览配置");
    else console.log(`未验证：预览 ${name} 依赖 Dashboard 预览默认值。`);
  }
  if (args.includes("--remote")) await checkRemote(config);
  else console.log("未验证：远端绑定、Secret、迁移和部署结果；可用 --remote 只读核对预览默认值。");
  console.log(failures ? `诊断结束：${failures} 项失败。` : "诊断结束：已执行的检查通过；未验证项不代表部署成功。");
}

await main().catch(() => fail("诊断无法完成；未输出可能包含配置值的原始错误。"));
if (failures) process.exitCode = 1;
