import { stripVTControlCharacters } from "node:util";

const help = `用法：node scripts/build-logs.mjs --account <account_id> --build <build_uuid>

也可用 CLOUDFLARE_ACCOUNT_ID 提供账号；CLOUDFLARE_API_TOKEN 必须从环境提供。
Token 必须是用户级 API Token，权限 Workers CI Read，资源限定到目标账号。
只读获取构建状态与所有日志页；不重试构建、不部署、不修改远端配置。
构建失败不代表日志读取失败：读取成功退出 0，请查看 build_outcome。
日志可能包含构建脚本打印的敏感信息；分享前检查，不要提交到 Git。`;

function options() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!["--account", "--build"].includes(flag) || !args[i + 1] || Object.hasOwn(values, flag)) {
      throw new Error("参数无效或重复；使用 --help 查看用法。");
    }
    values[flag] = args[i + 1];
  }
  const account = values["--account"] ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const build = values["--build"];
  if (!/^[a-f0-9]{32}$/i.test(account ?? "")) throw new Error("需要有效的 32 位 account_id。");
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(build ?? "")) {
    throw new Error("需要有效 build_uuid；可从 Cloudflare 构建详情 URL 的最后一段取得。");
  }
  return { account, build };
}

function safeText(value, token) {
  return stripVTControlCharacters(String(value))
    .replaceAll(token, "[REDACTED]")
    .replace(/(\b(?:Authorization\s*[:=]\s*)?Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
}

async function request(url, token) {
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    payload = await response.json();
  } catch {
    throw new Error(response
      ? `HTTP ${response.status}：响应无法读取或解析。`
      : "请求失败：网络错误、20 秒超时或重定向被拒绝。");
  }
  if (!response.ok || payload?.success !== true) {
    const codes = Array.isArray(payload?.errors)
      ? payload.errors.map(error => error?.code).filter(code => /^\d{1,12}$/.test(String(code))) : [];
    throw new Error(`Cloudflare HTTP ${response.status}，错误码 ${codes.join(", ") || "未提供"}；核对用户级 Token、Workers CI Read 权限及目标账号。`);
  }
  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error("Cloudflare 响应缺少有效 result。");
  }
  return payload.result;
}

async function main() {
  const config = options();
  if (!config) return console.log(help);
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error("缺少 CLOUDFLARE_API_TOKEN；未发送请求。请在环境设置中安全提供，不要粘贴到聊天或命令行。");
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.account}/builds/builds/${config.build}`;
  const build = await request(base, token);
  // Do not dump trigger/metadata: they can include environment variable values.
  console.log(`build_uuid: ${config.build}`);
  for (const key of ["status", "build_outcome"]) {
    const value = build[key];
    console.log(`${key}: ${value === null || value === undefined ? "未提供" : safeText(value, token)}`);
  }
  if (build.status !== "stopped") console.error("提示：构建尚未确认结束；本次日志是读取时的快照。结束后可再次运行。");

  let cursor;
  let count = 0;
  const seen = new Set();
  for (let page = 1; page <= 1000; page += 1) {
    const url = new URL(`${base}/logs`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const result = await request(url, token);
    if (!Array.isArray(result.lines)) throw new Error("日志响应缺少 lines 数组；日志读取不完整。");
    for (const line of result.lines) {
      if (!Array.isArray(line) || line.length !== 2 || line.some(value => !["string", "number"].includes(typeof value))) {
        throw new Error("日志行格式异常；日志读取不完整。");
      }
      console.log(`${safeText(line[0], token)}\t${safeText(line[1], token)}`);
      count += 1;
    }
    // Match Cloudflare's Workers Builds MCP: cursor alone does not mean more pages.
    if (result.truncated === false) {
      console.error(`日志读取完成：${page} 页，${count} 行。`);
      return;
    }
    if (result.truncated !== true || typeof result.cursor !== "string" || !result.cursor || seen.has(result.cursor)) {
      throw new Error("日志分页状态缺失或游标无效/重复；日志读取不完整。");
    }
    seen.add(result.cursor);
    cursor = result.cursor;
  }
  throw new Error("达到 1000 页读取上限；日志读取不完整。");
}

await main().catch(error => {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
});
