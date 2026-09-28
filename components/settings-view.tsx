"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Cloud, Code2, Copy, Eye, EyeOff, KeyRound, Link2, Loader2, Plug, Plus, RefreshCw, Shield, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ApiClient, type Connection } from "@/lib/client";
import { Choice, Empty, Field, formatDate } from "./fm-ui";
interface AccessToken {
    id: string;
    name: string;
    prefix: string;
    scope: string;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
}
const endpoints = [['GET', '/workspace', '读取完整工作区'], ['GET', '/{collection}', '分页查询项目、假设、实验或资源'], ['POST', '/{collection}', '创建记录'], ['GET', '/{collection}/{id}', '读取单条记录'], ['PUT', '/{collection}/{id}', '更新记录（携带 revision）'], ['DELETE', '/{collection}/{id}', '删除记录'], ['POST', '/hypotheses/{id}/results', '记录实验结果并更新节点'], ['POST', '/hypotheses/{id}/run', '调用模型分析节点'], ['GET / POST', '/tokens', '查询 / 创建访问 Token（管理员）'], ['DELETE', '/tokens/{id}', '撤销 Token（管理员）'], ['GET / PUT', '/settings/model', '读取 / 保存模型接口（管理员）']];
export default function SettingsView({ api, connection, onConnect, onDisconnect, section, onSection, onSeed }: {
    api: ApiClient;
    connection: Connection | null;
    onConnect: (c: Connection) => Promise<void>;
    onDisconnect: () => void;
    section: string;
    onSection: (s: string) => void;
    onSeed: () => Promise<void>;
}) {
    const [base, setBase] = useState(connection?.baseUrl || "");
    const [token, setToken] = useState("");
    const [remember, setRemember] = useState(false);
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);
    const [tokens, setTokens] = useState<AccessToken[]>([]);
    const [accessError, setAccessError] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [newSecret, setNewSecret] = useState("");
    const [revoke, setRevoke] = useState<AccessToken | null>(null);
    const [scope, setScope] = useState("write");
    const [days, setDays] = useState("30");
    const [model, setModel] = useState({ baseUrl: "https://api.openai.com/v1", model: "", hasKey: false });
    const [modelKey, setModelKey] = useState("");
    const [codeTab, setCodeTab] = useState("curl");
    const [loaded, setLoaded] = useState(false);
    const [permission, setPermission] = useState("");
    const getSettings = async () => { setLoaded(false); setAccessError(""); try {
        if (section === "tokens")
            setTokens(await api<AccessToken[]>("/tokens"));
        if (section === "model")
            setModel(await api("/settings/model"));
    }
    catch (e) {
        setAccessError((e as Error).message);
    }
    finally {
        setLoaded(true);
    } };
    useEffect(() => { if (connection && (section === "tokens" || section === "model"))
        void getSettings(); }, [section, connection]);
    const copy = async (s: string) => { try {
        await navigator.clipboard.writeText(s);
        toast.success("已复制");
    }
    catch {
        toast.error("复制失败，请手动选择并复制");
    } };
    const origin = connection?.baseUrl || (typeof window !== "undefined" ? window.location.origin : "https://your-worker.workers.dev");
    const snippets = { curl: `curl "${origin}/api/v1/hypotheses" \\\n  -H "Authorization: Bearer $FLOWMASTER_TOKEN"`, javascript: `const response = await fetch(\n  '${origin}/api/v1/hypotheses',\n  { headers: {\n    Authorization: \`Bearer \${token}\`\n  }}\n);\nconst { data } = await response.json();`, python: `import os, requests\n\nresponse = requests.get(\n    "${origin}/api/v1/hypotheses",\n    headers={"Authorization":\n        f"Bearer {os.environ['FLOWMASTER_TOKEN']}"}\n)\nresponse.raise_for_status()\nprint(response.json()["data"])` };
    const gated = <Empty title="先登录你的工作区" description="使用管理员 Token 登录，随后可管理接口和访问凭据。"><button className="btn primary" onClick={() => onSection("connection")}>前往登录<ArrowRight size={15}/></button></Empty>;
    return <section className="page-content settings-page"><div className="page-title"><div><div className="eyebrow">WORKSPACE SETTINGS</div><h1>系统设置</h1><p>连接研究工作区，配置接口与访问权限。</p></div><span className={`connection-pill ${connection ? "connected" : ""}`}><span />{connection ? "已登录" : "未登录"}</span></div><Tabs value={section} onValueChange={onSection} className="settings-tabs"><TabsList className="settings-nav" variant="line"><TabsTrigger value="connection"><Plug size={17}/>工作区登录</TabsTrigger><TabsTrigger value="tokens"><KeyRound size={17}/>访问 Token</TabsTrigger><TabsTrigger value="model"><Sparkles size={17}/>模型接口</TabsTrigger><TabsTrigger value="api"><Code2 size={17}/>API 文档</TabsTrigger></TabsList>
 <TabsContent value="connection"><div className="settings-grid"><section className="surface setting-card"><div className="section-heading"><span className="square-icon"><Cloud size={23}/></span><div><h2>管理员登录</h2><p>使用你的管理员 Token 进入工作区，无需注册账号。</p></div></div><form className="edit-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
        const url = base.trim().replace(/\/$/, "");
        if (url && !(url.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)))
            throw new Error("远程 API 地址必须使用 HTTPS");
        await onConnect({ baseUrl: url, token: token.trim(), remember });
        setToken("");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><Field label="服务地址" hint="留空使用当前网站的 API；填写域名即可，不包含 /api/v1。"><input type="url" value={base} onChange={e => setBase(e.target.value)} placeholder="https://flowmaster.your-domain.com"/></Field><Field label="访问 Token" hint="管理员请填写部署时设置的 ADMIN_TOKEN；它不是 Cloudflare 账号的 API Token。"><div className="password-field"><input required minLength={16} type={visible ? "text" : "password"} value={token} onChange={e => setToken(e.target.value)} placeholder="输入管理员或工作区 Token" autoComplete="current-password"/><button type="button" className="icon-btn" aria-label={visible ? "隐藏 Token" : "显示 Token"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></Field><div className="switch-row"><div><b>在此设备记住 Token</b><small>默认仅保留到本次浏览器会话结束。</small></div><Switch checked={remember} onCheckedChange={setRemember} aria-label="在此设备记住 Token"/></div>{remember && <p className="inline-note">开启后，Token 将保存在此浏览器的本地存储中。请仅在可信设备上使用。</p>}<div className="form-actions">{connection && <button type="button" className="btn" onClick={onDisconnect}>退出登录</button>}<button type="submit" className="btn primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16}/> : <Link2 size={16}/>}{connection ? "更新登录" : "登录工作区"}</button></div></form></section><div><section className="surface setting-card"><ShieldCheck size={28} className="primary-text"/><h3>唯一管理员如何登录</h3><p>服务地址留空，粘贴你保存的管理员 Token，然后点击「登录工作区」。</p><p>还没有或已遗失 Token？在 Cloudflare 控制台打开 Workers &amp; Pages → flowmaster → Settings → Variables and Secrets，设置或替换 Secret「ADMIN_TOKEN」，保存并部署。</p><p>使用至少 32 个字符的随机值，并保存到密码管理器。登录后，可以在「访问 Token」中为脚本创建单独的读写凭据。</p></section><details className="surface setting-card seed-card"><summary>可选：导入示例研究</summary><p>仅在主动导入时添加示例项目和实验记录。此操作只适用于空工作区。</p><button className="btn" disabled={!connection || busy} onClick={async () => { setBusy(true); try {
        await onSeed();
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>导入示例研究<ArrowRight size={15}/></button></details></div></div></TabsContent>
 <TabsContent value="tokens">{!connection ? gated : <section className="surface setting-card"><div className="surface-heading"><div><h2>访问 Token</h2><p>为应用或脚本签发独立凭据，按需控制访问范围。</p></div><button className="btn primary" disabled={!!accessError} onClick={() => setCreateOpen(true)}><Plus size={16}/>创建 Token</button></div><div className="info-banner"><Shield size={18}/>Token 仅在创建时显示一次，服务端只保存哈希值。</div>{accessError ? <div className="error-banner">{accessError}</div> : !loaded ? <div className="loading-state"><Loader2 className="spin"/>正在读取 Token…</div> : <><Table><TableHeader><TableRow><TableHead>名称 / 标识</TableHead><TableHead>权限</TableHead><TableHead>到期时间</TableHead><TableHead>最后使用</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{tokens.map(t => <TableRow key={t.id}><TableCell><strong>{t.name}</strong><small className="block-muted">{t.prefix}••••••••</small></TableCell><TableCell><span className="tiny-badge">{{ read: "只读", write: "读写", admin: "管理员" }[t.scope]}</span></TableCell><TableCell>{t.expiresAt ? formatDate(t.expiresAt) : "永久"}</TableCell><TableCell>{t.lastUsedAt ? formatDate(t.lastUsedAt) : "尚未使用"}</TableCell><TableCell><button className="text-btn danger" onClick={() => setRevoke(t)}><Trash2 size={14}/>撤销</button></TableCell></TableRow>)}</TableBody></Table>{!tokens.length && <Empty title="尚未创建访问 Token" description="为每一个接入应用创建单独的 Token，便于管理。"/>}</>}</section>}</TabsContent>
 <TabsContent value="model">{!connection ? gated : <div className="settings-grid"><section className="surface setting-card"><div className="section-heading"><span className="square-icon purple"><Sparkles size={23}/></span><div><h2>模型接口</h2><p>兼容 Chat Completions 格式的模型服务。</p></div></div>{accessError ? <div className="error-banner">{accessError}</div> : !loaded ? <div className="loading-state"><Loader2 className="spin"/>正在读取配置…</div> : <form className="edit-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
        const saved = await api("/settings/model", { method: "PUT", body: JSON.stringify({ baseUrl: model.baseUrl, model: model.model, ...(modelKey ? { apiKey: modelKey } : {}) }) });
        setModel(saved);
        setModelKey("");
        toast.success("模型接口已保存");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><Field label="Base URL" hint="填写 API 根路径，例如 https://api.example.com/v1。"><input required type="url" value={model.baseUrl} onChange={e => setModel({ ...model, baseUrl: e.target.value })}/></Field><Field label="调用 Token / API Key" hint={model.hasKey ? "已保存 Key；留空保留现有 Key。" : "Key 会加密保存，浏览器不会收到已保存的明文。"}><input type="password" value={modelKey} onChange={e => setModelKey(e.target.value)} required={!model.hasKey} autoComplete="new-password" placeholder={model.hasKey ? "•••••••• 已加密保存" : "输入模型服务的 API Key"}/></Field><Field label="模型名称"><input required maxLength={120} value={model.model} onChange={e => setModel({ ...model, model: e.target.value })} placeholder="填写服务商提供的模型 ID"/></Field><div className="form-actions"><button type="button" className="btn" disabled={busy || !model.hasKey} onClick={async () => { setBusy(true); try {
        const r = await api<{
            message: string;
        }>("/settings/model/test", { method: "POST" });
        toast.success(r.message);
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><RefreshCw size={15}/>测试已保存连接</button><button type="submit" className="btn primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16}/> : <Check size={16}/>}保存配置</button></div></form>}</section><section className="surface setting-card explanation"><Sparkles size={27} className="purple-text"/><h3>把研究上下文交给 Agent</h3><p>选中验证节点后，点击「Agent 分析」。系统将发送该假设、节点输入和上游观察，生成实验思路与后续建议。</p><p>模型分析会保存为实验记录，结论仍由研究者根据实际实验验证。</p><div className="info-banner">Agent 提供分析建议，不执行 Python 训练脚本。训练结果可通过 API 或「记录结果」写入。</div></section></div>}</TabsContent>
 <TabsContent value="api"><div className="api-doc-grid"><section className="surface setting-card"><div className="section-heading"><span className="square-icon"><Code2 size={23}/></span><div><h2>FlowMaster REST API</h2><p>版本 v1 · JSON · Bearer Token</p></div></div><Field label="API 基础地址"><div className="copy-field"><code>{origin}/api/v1</code><button className="icon-btn" aria-label="复制 API 地址" onClick={() => copy(`${origin}/api/v1`)}><Copy size={16}/></button></div></Field><h3>快速开始</h3><Tabs value={codeTab} onValueChange={setCodeTab}><TabsList className="code-tabs"><TabsTrigger value="curl">cURL</TabsTrigger><TabsTrigger value="javascript">JavaScript</TabsTrigger><TabsTrigger value="python">Python</TabsTrigger></TabsList><div className="code-block"><button aria-label="复制示例代码" onClick={() => copy(snippets[codeTab as keyof typeof snippets])}><Copy size={15}/></button><pre>{snippets[codeTab as keyof typeof snippets]}</pre></div></Tabs><div className="api-rules"><h3>响应格式</h3><code>{'{ "data": … }'}</code><p>错误返回 <code>{'{ "error": { "code", "message" } }'}</code>。集合查询支持 <code>?limit=50&offset=0&q=关键词</code>。</p><h3>写入与并发</h3><p>更新记录需携带读取到的 <code>revision</code>。版本冲突返回 409，请刷新后重试。删除假设会同步删除其关联实验。</p><a className="text-btn" href="/openapi.json" download>下载 OpenAPI 规范<ArrowRight size={15}/></a></div></section><section className="surface setting-card"><h2>接口速查</h2><p className="muted">collection 支持 projects、hypotheses、experiments、resources。</p><div className="endpoint-list">{endpoints.map(([method, path, desc]) => <div key={path + method}><span className={`method ${method.startsWith("GET") ? "get" : method === "DELETE" ? "delete" : "post"}`}>{method}</span><code>{path}</code><p>{desc}</p></div>)}</div></section></div></TabsContent></Tabs>
 <Dialog open={createOpen} onOpenChange={v => { if (!busy)
        setCreateOpen(v); }}><DialogContent className="fm-dialog"><DialogHeader><DialogTitle>创建访问 Token</DialogTitle><DialogDescription>为调用方选择最小必要的访问权限。</DialogDescription></DialogHeader><form className="edit-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); try {
        const t = await api<{
            token: string;
        }>("/tokens", { method: "POST", body: JSON.stringify({ name: f.get("name"), scope, expiresInDays: Number(days) }) });
        setCreateOpen(false);
        setNewSecret(t.token);
        await getSettings();
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}><Field label="名称"><input required name="name" maxLength={80} placeholder="例如：训练服务器"/></Field><Field label="权限"><Choice value={scope} onChange={setScope} items={[{ value: "read", label: "只读 · 查看研究数据" }, { value: "write", label: "读写 · 创建与修改研究" }, { value: "admin", label: "管理员 · 含设置和 Token 管理" }]}/></Field><Field label="有效期"><Choice value={days} onChange={setDays} items={[{ value: "7", label: "7 天" }, { value: "30", label: "30 天" }, { value: "90", label: "90 天" }, { value: "365", label: "365 天" }]}/></Field><div className="form-actions"><button className="btn primary" disabled={busy} type="submit">{busy ? <Loader2 size={16} className="spin"/> : <KeyRound size={16}/>}创建 Token</button></div></form></DialogContent></Dialog>
 <Dialog open={!!newSecret} onOpenChange={v => { if (!v)
        setNewSecret(""); }}><DialogContent className="fm-dialog"><DialogHeader><DialogTitle>Token 已创建</DialogTitle><DialogDescription>完整 Token 仅显示这一次，请立即复制并妥善保存。</DialogDescription></DialogHeader><div className="secret-display"><code>{newSecret}</code></div><button className="btn primary" onClick={() => copy(newSecret)}><Copy size={16}/>复制 Token</button></DialogContent></Dialog>
 <AlertDialog open={!!revoke} onOpenChange={v => { if (!v)
        setRevoke(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>撤销“{revoke?.name}”？</AlertDialogTitle><AlertDialogDescription>使用此 Token 的请求将立即失去访问权限。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="destructive-button" onClick={async (e) => { e.preventDefault(); setBusy(true); try {
        await api(`/tokens/${revoke?.id}`, { method: "DELETE" });
        setRevoke(null);
        await getSettings();
        toast.success("Token 已撤销");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setBusy(false);
    } }} disabled={busy}>确认撤销</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>;
}
