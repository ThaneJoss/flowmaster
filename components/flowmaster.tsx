"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, Boxes, Check, ChevronDown, ChevronRight, Clock, Code2, Database, Ellipsis, ExternalLink, FileText, FlaskConical, Folder, FolderOpen, Home, Layers, Lightbulb, Link2, Loader2, Menu, Network, Pencil, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Sidebar, SidebarContent, SidebarProvider } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Collection, type Experiment, type FlowNode, type Hypothesis, type Project, type Resource, type Status, type Workspace, emptyNode, nodeTypeLabel, resourceLabel, uid } from "@/lib/types";
import { demoWorkspace } from "@/lib/demo";
import { type Connection, makeClient } from "@/lib/client";
import { Badge, Choice, Empty, Field, StatusIcon, downloadJson, formatDate, statuses } from "./fm-ui";
import FlowCanvas from "./flow-canvas";
import SettingsView from "./settings-view";
const navItems = [{ id: "workspace", label: "工作台", icon: Home }, { id: "hypotheses", label: "假设验证", icon: FlaskConical }, { id: "experiments", label: "实验记录", icon: FileText }, { id: "resources", label: "资源管理", icon: Boxes }, { id: "settings", label: "系统设置", icon: Settings }];
const blank: Workspace = { projects: [], hypotheses: [], experiments: [], resources: [] };
type Modal = {
    type: "hypothesis" | "project" | "node" | "experiment" | "resource" | "log";
    item?: any;
};
export default function FlowMaster() {
    const [data, setData] = useState<Workspace>(() => structuredClone(demoWorkspace));
    const [connection, setConnection] = useState<Connection | null>(null);
    const [tab, setTab] = useState("hypotheses");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [selected, setSelected] = useState("h-cls");
    const [selectedNode, setSelectedNode] = useState("n5");
    const [expanded, setExpanded] = useState<string[]>(["p-dino"]);
    const [details, setDetails] = useState(true);
    const [listOpen, setListOpen] = useState(false);
    const [modal, setModal] = useState<Modal | null>(null);
    const [confirm, setConfirm] = useState<{
        title: string;
        description: string;
        action: () => Promise<void>;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState(false);
    const [settingsTab, setSettingsTab] = useState("connection");
    const [mobile, setMobile] = useState(false);
    const api = useMemo(() => makeClient(connection || { baseUrl: "", token: "", remember: false }), [connection]);
    const hypothesis = data.hypotheses.find(h => h.id === selected);
    const node = hypothesis?.nodes.find(n => n.id === selectedNode);
    const project = data.projects.find(p => p.id === hypothesis?.projectId);
    const changeSelection = useCallback((h: Hypothesis) => { setSelected(h.id); setSelectedNode(h.nodes.find(n => n.type === "experiment")?.id || h.nodes[0]?.id || ""); setTab("hypotheses"); setListOpen(false); setExpanded(p => p.includes(h.projectId) ? p : [...p, h.projectId]); setDetails(true); }, []);
    const load = async (client = api) => { const result = await client<Workspace>("/workspace"); setData(result); return result; };
    const connect = async (c: Connection) => { const result = await makeClient(c)<Workspace>("/workspace"); setConnection(c); setData(result); localStorage.removeItem("flowmaster.connection"); sessionStorage.removeItem("flowmaster.connection"); (c.remember ? localStorage : sessionStorage).setItem("flowmaster.connection", JSON.stringify(c)); if (result.hypotheses[0])
        changeSelection(result.hypotheses[0]);
    else
        setSelected(""); toast.success("已连接工作区"); };
    useEffect(() => { const media = matchMedia("(max-width: 1279px)"); const update = () => { setMobile(media.matches); if (media.matches)
        setDetails(false); }; update(); media.addEventListener("change", update); try {
        const saved = sessionStorage.getItem("flowmaster.connection") || localStorage.getItem("flowmaster.connection");
        if (saved) {
            const c = JSON.parse(saved);
            makeClient(c)<Workspace>("/workspace").then(d => { setConnection(c); setData(d); if (d.hypotheses[0])
                changeSelection(d.hypotheses[0]);
            else
                setSelected(""); }).catch(() => toast.error("上次的连接已失效，请在设置中重新连接"));
        }
    }
    catch { } return () => media.removeEventListener("change", update); }, [changeSelection]);
    const disconnect = () => { setConnection(null); setData(structuredClone(demoWorkspace)); setSelected("h-cls"); setSelectedNode("n5"); localStorage.removeItem("flowmaster.connection"); sessionStorage.removeItem("flowmaster.connection"); toast.success("已断开连接，切换至演示工作区"); };
    const save = async (kind: Collection, item: any) => { const exists = (data[kind] as {
        id: string;
    }[]).some(i => i.id === item.id); const value = { ...item, updatedAt: new Date().toISOString() }; try {
        const saved = connection ? await api(`/${kind}${exists ? `/${item.id}` : ""}`, { method: exists ? "PUT" : "POST", body: JSON.stringify(value) }) : value;
        setData(d => ({ ...d, [kind]: exists ? (d[kind] as any[]).map(i => i.id === item.id ? saved : i) : [...(d[kind] as any[]), saved] }));
        return saved;
    }
    catch (e) {
        toast.error((e as Error).message);
        throw e;
    } };
    const remove = async (kind: Collection, id: string) => { if (connection)
        await api(`/${kind}/${id}`, { method: "DELETE" }); setData(d => ({ ...d, [kind]: (d[kind] as any[]).filter(i => i.id !== id), ...(kind === "hypotheses" ? { experiments: d.experiments.filter(i => i.hypothesisId !== id) } : {}) })); toast.success("已删除"); };
    const requestRemove = (kind: Collection, id: string, name: string) => setConfirm({ title: `删除“${name}”？`, description: kind === "hypotheses" ? "该假设下的节点和实验记录也会一并删除。此操作无法撤销。" : "此操作无法撤销。", action: () => remove(kind, id) });
    const editGraph = async (h: Hypothesis) => { await save("hypotheses", h); };
    const safeEditGraph = async (h: Hypothesis) => { try {
        await editGraph(h);
    }
    catch {
        setData(d => ({ ...d, hypotheses: d.hypotheses.map(v => ({ ...v })) }));
    } };
    const runAgent = async () => { if (!hypothesis || !node)
        return; if (!connection) {
        setTab("settings");
        setSettingsTab("connection");
        toast.info("请先连接服务，并在模型接口中配置调用 Key");
        return;
    } setRunning(true); try {
        await api(`/hypotheses/${hypothesis.id}/run`, { method: "POST", body: JSON.stringify({ nodeId: node.id }) });
        await load();
        toast.success("Agent 分析已保存至实验记录");
    }
    catch (e) {
        toast.error((e as Error).message);
    }
    finally {
        setRunning(false);
    } };
    const formRef = useRef<HTMLFormElement>(null);
    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!modal || busy)
            return;
        setBusy(true);
        const f = new FormData(e.currentTarget), get = (k: string) => String(f.get(k) || "").trim();
        const common = { id: modal.item?.id || uid(), updatedAt: new Date().toISOString(), revision: modal.item?.revision };
        try {
            if (modal.type === "project") {
                const p = await save("projects", { ...common, name: get("name"), description: get("description") });
                setExpanded(v => [...v, p.id]);
            }
            if (modal.type === "hypothesis") {
                const id = common.id;
                const h: Hypothesis = { ...common, projectId: get("projectId"), title: get("title"), description: get("description"), baseline: get("baseline"), status: get("status") as Status, nodes: modal.item?.nodes || [{ ...emptyNode(`${id}-1`, "整理基线", 40, 250), type: "baseline" }, emptyNode(`${id}-2`, "设计验证实验", 240, 250), { ...emptyNode(`${id}-3`, "记录实验结论", 440, 250), type: "conclusion" }], edges: modal.item?.edges || [{ source: `${id}-1`, target: `${id}-2` }, { source: `${id}-2`, target: `${id}-3` }] };
                const saved = await save("hypotheses", h);
                changeSelection(saved);
            }
            if (modal.type === "node" && hypothesis) {
                const n: FlowNode = { ...(modal.item || emptyNode(common.id, "", 80 + hypothesis.nodes.length * 25, 480)), title: get("title"), type: get("type") as FlowNode["type"], status: get("status") as Status, inputs: get("inputs"), output: get("output"), summary: get("summary"), rationale: get("rationale"), method: get("method"), conclusion: get("conclusion"), nextAction: get("nextAction") };
                const exists = hypothesis.nodes.some(v => v.id === n.id);
                const parents = f.getAll("parents").map(String);
                const edges = [...hypothesis.edges.filter(v => v.target !== n.id), ...parents.map(source => ({ source, target: n.id }))];
                const seen = new Set<string>();
                const stack = new Set<string>();
                const visit = (id: string): boolean => { if (stack.has(id))
                    return true; if (seen.has(id))
                    return false; stack.add(id); for (const x of edges.filter(v => v.source === id))
                    if (visit(x.target))
                        return true; stack.delete(id); seen.add(id); return false; };
                if (visit(n.id))
                    throw new Error("连线形成了循环，请重新选择上游节点");
                await editGraph({ ...hypothesis, nodes: exists ? hypothesis.nodes.map(v => v.id === n.id ? n : v) : [...hypothesis.nodes, n], edges });
                setSelectedNode(n.id);
            }
            if (modal.type === "resource") {
                await save("resources", { ...common, projectId: get("projectId"), name: get("name"), type: get("type"), url: get("url"), description: get("description") });
            }
            if (modal.type === "experiment" && hypothesis && node) {
                const result = { title: get("title"), status: get("status") as Status, summary: get("summary"), duration: get("duration"), nodeId: node.id };
                if (connection) {
                    await api(`/hypotheses/${hypothesis.id}/results`, { method: "POST", body: JSON.stringify(result) });
                    await load();
                }
                else {
                    const now = new Date().toISOString();
                    setData(d => ({ ...d, hypotheses: d.hypotheses.map(h => h.id === hypothesis.id ? { ...h, nodes: h.nodes.map(n => n.id === node.id ? { ...n, status: result.status, summary: result.summary, duration: result.duration } : n) } : h), experiments: [{ ...common, ...result, hypothesisId: hypothesis.id, source: "manual", logs: [{ time: now, message: "记录实验结果" }, { time: now, message: result.summary }] }, ...d.experiments] }));
                }
            }
            toast.success(connection ? "已保存" : "已更新演示工作区（刷新后还原）");
            setModal(null);
        }
        catch (err) {
            toast.error((err as Error).message);
        }
        finally {
            setBusy(false);
        }
    };
    const matched = data.hypotheses.filter(h => (statusFilter === "all" || h.status === statusFilter) && `${h.title} ${h.description} ${h.nodes.map(n => n.title).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
    useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="全局搜索"]')?.focus();
    } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
    const apiState = useRef({ data, changeSelection });
    apiState.current = { data, changeSelection };
    useEffect(() => { const context = (document as any).modelContext; if (!context?.registerTool)
        return; const controller = new AbortController(); for (const tool of [{ name: "list_research_hypotheses", description: "读取当前 FlowMaster 工作区中的假设与状态，不包含凭据。", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ hypotheses: apiState.current.data.hypotheses.map(({ id, title, status }) => ({ id, title, status })) }) }, { name: "open_research_hypothesis", description: "打开现有假设的流程图，仅改变页面选择，不修改记录。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async (input: unknown) => { const id = (input as any)?.id; if (typeof id !== "string")
                throw new Error("id 必须是字符串"); const h = apiState.current.data.hypotheses.find(v => v.id === id); if (!h)
                throw new Error("假设不存在"); apiState.current.changeSelection(h); await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); return { id: h.id, title: h.title }; } }]) {
        try {
            Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => { });
        }
        catch { }
    } return () => controller.abort(); }, []);
    const detailBody = node && hypothesis ? <><div className="detail-top"><h2>节点详情</h2><button className="icon-btn" aria-label="关闭节点详情" onClick={() => setDetails(false)}><X size={19}/></button></div><div className="selected-node-heading"><span className="square-icon"><FileText size={22}/></span><strong>{node.title.replaceAll("\n", "")}</strong><Badge status={node.status}/></div><section className="detail-section script-section"><div className="section-heading"><Database size={22}/><div><h3>实验结构化信息</h3><p>节点输入、输出与验证结果</p></div><button className="icon-btn" aria-label="编辑节点" onClick={() => setModal({ type: "node", item: node })}><Pencil size={15}/></button></div><dl className="details-table">{[["节点名称", node.title.replaceAll("\n", "")], ["节点类型", nodeTypeLabel[node.type]], ["上游节点", hypothesis.edges.filter(e => e.target === node.id).map(e => hypothesis.nodes.find(n => n.id === e.source)?.title.replaceAll("\n", "")).join("、") || "起始节点"], ["下游节点", hypothesis.edges.filter(e => e.source === node.id).map(e => hypothesis.nodes.find(n => n.id === e.target)?.title.replaceAll("\n", "")).join("、") || "结束节点"], ["输入", node.inputs || "未设置"], ["输出", node.output || "未记录"], ["结果摘要", node.summary || "等待实验结果"], ["开始时间", node.startedAt || "—"], ["耗时", node.duration || "—"]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}<div><dt>状态</dt><dd><Badge status={node.status}/></dd></div></dl></section><section className="detail-section agent-section"><div className="section-heading"><Sparkles size={23}/><div><h3>Agent 编写说明</h3><p>研究思路与结论记录</p></div><span className="tiny-badge">{connection ? "研究笔记" : "示例"}</span></div><dl className="agent-table">{[["起因", node.rationale], ["实验思路", node.method], ["结论", node.conclusion], ["后续行动", node.nextAction]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "尚未填写，可编辑或运行 Agent 分析。"}</dd></div>)}</dl></section><section className="detail-section log-section"><div className="section-heading"><Clock size={17}/><h3>执行日志</h3><button className="text-btn" onClick={() => setModal({ type: "log", item: data.experiments.filter(e => e.hypothesisId === hypothesis.id && e.nodeId === node.id) })}>查看全部<ChevronRight size={14}/></button></div><div className="timeline">{data.experiments.filter(e => e.hypothesisId === hypothesis.id && e.nodeId === node.id).flatMap(e => e.logs).slice(-4).map((log, i) => <div key={i}><i /><time>{log.time.includes("T") ? formatDate(log.time).split(" ").pop() : log.time}</time><span>{log.message}</span></div>)}{!data.experiments.some(e => e.hypothesisId === hypothesis.id && e.nodeId === node.id) && <p className="muted">暂无执行记录</p>}</div></section><div className="detail-actions"><button className="btn" onClick={() => setModal({ type: "experiment" })}><Plus size={16}/>记录结果</button><button className="btn primary" disabled={running} onClick={() => void runAgent()}>{running ? <Loader2 size={16} className="spin"/> : <Sparkles size={16}/>} {running ? "分析中…" : "Agent 分析"}</button></div></> : null;
    return <><a className="skip-link" href="#workspace-main">跳转到研究工作区</a><Toaster position="top-center" richColors/><header className="app-header"><a href="#" className="brand" onClick={e => { e.preventDefault(); setTab("workspace"); }}><img src="/favicon.svg" alt=""/><div><b>FlowMaster</b><span>智能研究编排平台</span></div></a><nav aria-label="主导航">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); setQuery(""); }}><Icon size={20}/><span>{label}</span></button>)}</nav><div className="header-actions"><div className="global-search"><Search size={17}/><input placeholder="搜索假设、节点关键词…" aria-label="全局搜索" value={query} onChange={e => { setQuery(e.target.value); setTab("hypotheses"); }} onKeyDown={e => { if (e.key === "Enter" && matched[0])
        changeSelection(matched[0]); }}/><kbd>⌘ K</kbd></div><button className="icon-btn" title="查看实验动态" onClick={() => { setTab("experiments"); setQuery(""); }}><Bell size={21}/>{data.experiments.length > 0 && <i className="notification-dot"/>}</button><DropdownMenu><DropdownMenuTrigger asChild><button className="profile" aria-label="工作区菜单"><span className="avatar"><UserRound size={23}/></span><span><b>{connection ? "我的工作区" : "研究员"}</b><small>{connection ? "服务已连接" : "演示工作区"}</small></span><ChevronDown size={14}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setTab("settings"); setSettingsTab("connection"); }}>连接与身份</DropdownMenuItem><DropdownMenuItem onSelect={() => downloadJson("flowmaster-workspace.json", data)}>导出当前工作区</DropdownMenuItem>{connection && <DropdownMenuItem onSelect={disconnect}>断开连接</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div></header>
 <main id="workspace-main" tabIndex={-1} className={`app-main ${tab === "hypotheses" ? "flow-layout" : ""} ${details && node && !mobile ? "with-detail" : ""}`}>
 {tab === "hypotheses" && <><SidebarProvider className={`sidebar-shell ${listOpen ? "mobile-open" : ""}`}><Sidebar collapsible="none" className="fm-sidebar"><SidebarContent><div className="sidebar-heading"><h2>假设列表 <span>{data.hypotheses.length}</span></h2><button className="add-square" aria-label="新建假设" onClick={() => data.projects.length ? setModal({ type: "hypothesis" }) : setModal({ type: "project" })}><Plus size={20}/></button></div><div className="sidebar-search"><Search size={16}/><input placeholder="搜索假设…" aria-label="搜索假设" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-btn" aria-label="清空搜索" onClick={() => setQuery("")}><X size={14}/></button>}</div><div className="sidebar-filter"><span>全部研究</span><Choice value={statusFilter} onChange={setStatusFilter} items={[{ value: "all", label: "所有状态" }, ...statuses]} label="假设状态筛选"/></div><div className="project-list">{data.projects.map(p => { const opened = expanded.includes(p.id) || !!query; const list = matched.filter(h => h.projectId === p.id); return <div className="project-group" key={p.id}><div className="project-heading"><button className="project-title" onClick={() => setExpanded(v => v.includes(p.id) ? v.filter(i => i !== p.id) : [...v, p.id])}>{opened ? <ChevronDown size={15}/> : <ChevronRight size={15}/>} {opened ? <FolderOpen size={19}/> : <Folder size={19}/>}<span>{p.name}</span></button><DropdownMenu><DropdownMenuTrigger asChild><button className="icon-btn" aria-label={`${p.name}操作`}><Ellipsis size={15}/></button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => setModal({ type: "project", item: p })}>编辑项目</DropdownMenuItem><DropdownMenuItem onSelect={() => setModal({ type: "hypothesis", item: { projectId: p.id } })}>添加假设</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { if (data.hypotheses.some(h => h.projectId === p.id) || data.resources.some(r => r.projectId === p.id)) {
        toast.error("请先删除此项目下的假设和资源");
        return;
    } requestRemove("projects", p.id, p.name); }}>删除项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>{opened && <div className="hypothesis-list">{list.map(h => <button className={`hypothesis-item ${selected === h.id ? "selected" : ""}`} key={h.id} onClick={() => changeSelection(h)}><div className="hypothesis-meta"><Badge status={h.status}/></div><div className="hypothesis-text"><StatusIcon status={h.status}/><span>{h.description || h.title}</span></div><span className="hypothesis-foot">{h.nodes.length} 个节点<ArrowRight size={13}/></span></button>)}{!list.length && <p className="no-match">{query ? "没有匹配的假设" : "暂无假设"}</p>}</div>}</div>; })}</div><button className="new-project" onClick={() => setModal({ type: "project" })}><Plus size={16}/>新建研究项目</button><div className="sidebar-bottom"><span className={`connection-dot ${connection ? "connected" : ""}`}/><div><b>{connection ? "已连接云端工作区" : "演示工作区"}</b><small>{connection ? "数据保存至 Cloudflare" : "示例数据 · 刷新后还原"}</small></div><button className="icon-btn" title="连接设置" onClick={() => { setTab("settings"); setSettingsTab("connection"); }}><Settings size={16}/></button></div></SidebarContent></Sidebar></SidebarProvider><section className="flow-main">{hypothesis ? <><div className="flow-heading"><div className="breadcrumb"><button className="icon-btn mobile-list-toggle" aria-label="展开假设列表" onClick={() => setListOpen(!listOpen)}><Menu size={18}/></button><Folder size={14}/>{project?.name}<ChevronRight size={13}/><span>假设验证</span><div className="grow"/><span className="autosave">{connection ? "云端已保存" : "演示模式"}</span></div><div className="flow-title"><h1>{hypothesis.title}</h1><Badge status={hypothesis.status}/><DropdownMenu><DropdownMenuTrigger asChild><button className="icon-btn" aria-label="假设操作"><Ellipsis size={20}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setModal({ type: "hypothesis", item: hypothesis })}><Pencil size={14}/>编辑假设</DropdownMenuItem><DropdownMenuItem onSelect={() => downloadJson(`${hypothesis.id}.json`, hypothesis)}><ArrowDownToLine size={14}/>导出流程 JSON</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => requestRemove("hypotheses", hypothesis.id, hypothesis.title)}><Trash2 size={14}/>删除假设</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><p className="flow-subtitle">基线：<strong>{hypothesis.baseline || "未设置"}</strong><i />问题：{project?.description || hypothesis.description}</p></div><FlowCanvas key={hypothesis.id} hypothesis={hypothesis} project={project?.name || "研究任务"} selected={selectedNode} onSelect={id => { setSelectedNode(id); setDetails(true); }} onChange={safeEditGraph} onAdd={() => setModal({ type: "node" })} onToggleDetail={() => setDetails(v => !v)}/><div className="flow-footer"><span><Network size={14}/>{hypothesis.nodes.length} 个节点 <i /> {hypothesis.edges.length} 条连线</span><span>上次更新 {formatDate(hypothesis.updatedAt)}</span></div></> : <Empty title="开始你的第一个研究假设" description="先创建研究项目，再添加需要验证的假设。"><button className="btn primary" onClick={() => setModal({ type: data.projects.length ? "hypothesis" : "project" })}><Plus size={16}/>新建研究</button></Empty>}</section>{node && details && !mobile && <aside className="node-details">{detailBody}</aside>}{mobile && <Sheet open={details && !!node} onOpenChange={setDetails}><SheetContent className="mobile-details"><SheetHeader className="sr-only"><SheetTitle>节点详情</SheetTitle><SheetDescription>查看和编辑研究节点</SheetDescription></SheetHeader>{detailBody}</SheetContent></Sheet>}</>}
 {tab === "workspace" && <section className="page-content dashboard"><div className="page-title"><div><div className="eyebrow">RESEARCH WORKSPACE</div><h1>让每一个假设，都有迹可循。</h1><p>从观察出发，让实验连接问题与答案。</p></div><button className="btn primary" onClick={() => setModal({ type: data.projects.length ? "hypothesis" : "project" })}><Plus size={17}/>新建假设</button></div><div className="stat-grid">{[{ title: "研究项目", value: data.projects.length, icon: Folder, sub: "持续探索中的研究方向" }, { title: "研究假设", value: data.hypotheses.length, icon: Lightbulb, sub: "从问题到可验证的假设" }, { title: "验证中", value: data.hypotheses.filter(h => h.status === "running").length, icon: Activity, sub: "正在推进的研究" }, { title: "实验记录", value: data.experiments.length, icon: FlaskConical, sub: "保留每一次验证的依据" }].map(({ title, value, icon: Icon, sub }) => <article className="stat-card" key={title}><span className="stat-icon"><Icon size={22}/></span><p>{title}</p><strong>{value.toString().padStart(2, "0")}</strong><small>{sub}</small></article>)}</div><div className="dashboard-grid"><section className="surface"><div className="surface-heading"><h2>最近研究</h2><button className="text-btn" onClick={() => setTab("hypotheses")}>全部假设<ArrowRight size={15}/></button></div>{[...data.hypotheses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map(h => <button className="recent-row" key={h.id} onClick={() => changeSelection(h)}><span className="square-icon"><FlaskConical size={21}/></span><span><b>{h.title}</b><small>{data.projects.find(p => p.id === h.projectId)?.name} · {h.nodes.length} 个节点</small></span><Badge status={h.status}/><ChevronRight size={17}/></button>)}{!data.hypotheses.length && <Empty title="暂无研究"/>}</section><section className="surface activity-card"><div className="surface-heading"><h2>研究动态</h2><Clock size={17}/></div>{data.experiments.slice(0, 5).map(exp => <button className="activity-row" key={exp.id} onClick={() => setModal({ type: "log", item: [exp] })}><i /><div><time>{formatDate(exp.updatedAt)}</time><b>{exp.title}</b><p>{exp.summary}</p></div></button>)}{!data.experiments.length && <Empty title="暂无实验动态"/>}<div className="api-tip"><Code2 size={23}/><h3>将研究接入你的工作流</h3><p>通过 REST API 创建假设、写入实验结果，让脚本和前端保持同步。</p><button className="text-btn" onClick={() => { setTab("settings"); setSettingsTab("api"); }}>查看 API 文档<ArrowRight size={15}/></button></div></section></div></section>}
 {tab === "experiments" && <section className="page-content"><div className="page-title"><div><div className="eyebrow">EXPERIMENT LOGS</div><h1>实验记录</h1><p>追踪每一步验证，保留可复现的研究依据。</p></div><button className="btn" onClick={() => downloadJson("flowmaster-experiments.json", data.experiments)}><ArrowDownToLine size={16}/>导出记录</button></div><div className="surface"><div className="table-toolbar"><div className="sidebar-search"><Search size={16}/><input placeholder="搜索实验名称或结果…" aria-label="搜索实验" value={query} onChange={e => setQuery(e.target.value)}/></div><Choice value={statusFilter} onChange={setStatusFilter} items={[{ value: "all", label: "所有状态" }, ...statuses]} label="实验状态"/><span className="muted">共 {data.experiments.length} 条记录</span></div><Table><TableHeader><TableRow><TableHead>实验名称</TableHead><TableHead>关联假设</TableHead><TableHead>状态</TableHead><TableHead>来源</TableHead><TableHead>更新时间</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{data.experiments.filter(x => (statusFilter === "all" || x.status === statusFilter) && `${x.title} ${x.summary}`.includes(query)).map(exp => <TableRow key={exp.id}><TableCell><button className="table-link" onClick={() => setModal({ type: "log", item: [exp] })}><FlaskConical size={17}/>{exp.title}</button></TableCell><TableCell className="truncate-cell"><button onClick={() => { const h = data.hypotheses.find(h => h.id === exp.hypothesisId); if (h) {
        changeSelection(h);
        setSelectedNode(exp.nodeId);
    } }}>{data.hypotheses.find(h => h.id === exp.hypothesisId)?.title || "—"}</button></TableCell><TableCell><Badge status={exp.status}/></TableCell><TableCell>{exp.source === "agent" ? "Agent 分析" : "实验记录"}</TableCell><TableCell>{formatDate(exp.updatedAt)}</TableCell><TableCell><button className="icon-btn" aria-label="删除实验记录" onClick={() => requestRemove("experiments", exp.id, exp.title)}><Trash2 size={15}/></button></TableCell></TableRow>)}</TableBody></Table>{!data.experiments.filter(x => (statusFilter === "all" || x.status === statusFilter) && `${x.title} ${x.summary}`.includes(query)).length && <Empty title="暂无匹配的实验" description="在假设流程中选择节点，即可记录实验结果。"/>}</div></section>}
 {tab === "resources" && <section className="page-content"><div className="page-title"><div><div className="eyebrow">RESEARCH RESOURCES</div><h1>资源管理</h1><p>将数据集、模型、文档和代码关联到研究项目。</p></div><button className="btn primary" onClick={() => data.projects.length ? setModal({ type: "resource" }) : setModal({ type: "project" })}><Plus size={16}/>添加资源</button></div><div className="resource-toolbar"><div className="sidebar-search"><Search size={16}/><input placeholder="搜索资源…" aria-label="搜索资源" value={query} onChange={e => setQuery(e.target.value)}/></div><span className="muted">{data.resources.length} 项资源</span></div><div className="resource-grid">{data.resources.filter(r => `${r.name} ${r.description}`.includes(query)).map(r => <article className={`resource-card ${r.type}`} key={r.id}><div className="resource-card-top"><span className="resource-icon">{r.type === "dataset" ? <Database /> : r.type === "model" ? <Layers /> : r.type === "code" ? <Code2 /> : <FileText />}</span><DropdownMenu><DropdownMenuTrigger asChild><button className="icon-btn" aria-label={`${r.name}操作`}><Ellipsis size={19}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setModal({ type: "resource", item: r })}>编辑资源</DropdownMenuItem><DropdownMenuItem onSelect={() => requestRemove("resources", r.id, r.name)}>删除资源</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><span className="resource-type">{resourceLabel[r.type]}</span><h3>{r.name}</h3><p>{r.description || "暂无说明"}</p><div className="resource-project"><Folder size={14}/>{data.projects.find(p => p.id === r.projectId)?.name}</div><footer><small>{formatDate(r.updatedAt)}</small>{r.url ? <a className="text-btn" href={r.url} target="_blank" rel="noreferrer">打开资源<ExternalLink size={14}/></a> : <button className="text-btn" onClick={() => setModal({ type: "resource", item: r })}>添加链接<Link2 size={14}/></button>}</footer></article>)}</div>{!data.resources.filter(r => `${r.name} ${r.description}`.includes(query)).length && <Empty title="暂无匹配的资源"/>}</section>}
 {tab === "settings" && <SettingsView api={api} connection={connection} onConnect={connect} onDisconnect={disconnect} section={settingsTab} onSection={setSettingsTab} onSeed={async () => { await api("/seed", { method: "POST" }); const d = await load(); if (d.hypotheses[0])
        changeSelection(d.hypotheses[0]); toast.success("示例研究已导入"); }}/>}
 </main>
 <Dialog open={!!modal} onOpenChange={v => { if (!v && !busy)
        setModal(null); }}><DialogContent className={`fm-dialog ${modal?.type === "node" ? "wide-dialog" : ""}`}><DialogHeader><DialogTitle>{modal?.type === "hypothesis" ? (modal.item?.id ? "编辑假设" : "新建研究假设") : modal?.type === "project" ? (modal.item?.id ? "编辑研究项目" : "新建研究项目") : modal?.type === "node" ? (modal.item ? "编辑验证节点" : "添加验证节点") : modal?.type === "resource" ? (modal.item ? "编辑资源" : "添加研究资源") : modal?.type === "log" ? "实验详情与执行日志" : "记录实验结果"}</DialogTitle><DialogDescription>{modal?.type === "log" ? "查看实验摘要与完整的执行过程。" : connection ? "修改将保存到当前工作区。" : "当前为演示工作区，修改在刷新后还原。"}</DialogDescription></DialogHeader>{modal?.type === "log" ? <div className="log-modal">{(modal.item as Experiment[]).map(exp => <section key={exp.id}><div className="surface-heading"><h3>{exp.title}</h3><Badge status={exp.status}/></div><p className="result-text">{exp.summary}</p><div className="timeline">{exp.logs.map((log, i) => <div key={i}><i /><time>{log.time.includes("T") ? formatDate(log.time) : log.time}</time><span>{log.message}</span></div>)}</div></section>)}{!modal.item.length && <Empty title="暂无执行记录"/>}</div> : <form key={`${modal?.type}-${modal?.item?.id || "new"}`} ref={formRef} onSubmit={submit} className="edit-form">{modal?.type === "project" && <><Field label="项目名称"><input name="name" required maxLength={120} defaultValue={modal.item?.name} placeholder="例如：定位测试子集性能下降原因"/></Field><Field label="研究说明"><textarea name="description" defaultValue={modal.item?.description} rows={3} placeholder="这个项目主要研究什么问题？"/></Field></>}
 {(modal?.type === "hypothesis" || modal?.type === "resource") && <Field label="所属项目"><FormChoice name="projectId" defaultValue={modal.item?.projectId || project?.id || data.projects[0]?.id} items={data.projects.map(p => ({ value: p.id, label: p.name }))}/></Field>}
 {modal?.type === "hypothesis" && <><Field label="假设标题"><input name="title" required maxLength={200} defaultValue={modal.item?.title} placeholder="用一句话描述待验证的假设"/></Field><Field label="问题描述"><textarea name="description" defaultValue={modal.item?.description} rows={3}/></Field><div className="form-row"><Field label="实验基线"><input name="baseline" defaultValue={modal.item?.baseline} placeholder="例如 DINOv3 + MLP"/></Field><Field label="假设状态"><FormChoice name="status" defaultValue={modal.item?.status || "pending"} items={statuses}/></Field></div></>}
 {modal?.type === "node" && <><Field label="节点名称"><input name="title" required maxLength={200} defaultValue={modal.item?.title.replaceAll("\n", "")}/></Field><div className="form-row"><Field label="节点类型"><FormChoice name="type" defaultValue={modal.item?.type || "experiment"} items={Object.entries(nodeTypeLabel).map(([value, label]) => ({ value, label }))}/></Field><Field label="验证状态"><FormChoice name="status" defaultValue={modal.item?.status || "pending"} items={statuses}/></Field></div><div className="field"><span>上游节点</span><div className="parent-picker">{hypothesis?.nodes.filter(n => n.id !== modal.item?.id).map(n => <ParentCheck key={n.id} id={n.id} label={n.title.replaceAll("\n", "")} checked={!!hypothesis.edges.find(e => e.source === n.id && e.target === modal.item?.id)}/>)}</div></div><div className="form-row"><Field label="输入"><textarea name="inputs" defaultValue={modal.item?.inputs} rows={2}/></Field><Field label="输出"><textarea name="output" defaultValue={modal.item?.output} rows={2}/></Field></div><Field label="结果摘要"><textarea name="summary" defaultValue={modal.item?.summary} rows={2}/></Field><details className="advanced-fields"><summary>研究说明与后续行动</summary>{[["rationale", "起因"], ["method", "实验思路"], ["conclusion", "结论"], ["nextAction", "后续行动"]].map(([key, label]) => <Field key={key} label={label}><textarea name={key} defaultValue={modal.item?.[key]} rows={2}/></Field>)}</details></>}
 {modal?.type === "experiment" && <><Field label="实验名称"><input name="title" required maxLength={200} defaultValue={node?.title.replaceAll("\n", "")}/></Field><div className="form-row"><Field label="验证状态"><FormChoice name="status" defaultValue="verified" items={statuses}/></Field><Field label="耗时"><input name="duration" placeholder="例如：12 分钟"/></Field></div><Field label="实验结果与依据"><textarea name="summary" required rows={6} placeholder="记录观察结果、指标和结论…"/></Field></>}
 {modal?.type === "resource" && <><Field label="资源名称"><input name="name" required maxLength={200} defaultValue={modal.item?.name}/></Field><Field label="类型"><FormChoice name="type" defaultValue={modal.item?.type || "dataset"} items={Object.entries(resourceLabel).map(([value, label]) => ({ value, label }))}/></Field><Field label="资源链接" hint="可填写数据集、模型仓库或文档的 HTTP(S) 地址。"><input type="url" name="url" pattern="https?://.*" defaultValue={modal.item?.url} placeholder="https://…"/></Field><Field label="资源说明"><textarea name="description" defaultValue={modal.item?.description} rows={3}/></Field></>}
 <div className="form-actions">{modal?.type === "node" && modal.item && hypothesis && <button type="button" className="btn danger ghost" onClick={() => { const n = modal.item; setConfirm({ title: "删除这个节点？", description: "与该节点相连的所有连线将同时删除，历史实验记录会保留。", action: async () => { await editGraph({ ...hypothesis, nodes: hypothesis.nodes.filter(v => v.id !== n.id), edges: hypothesis.edges.filter(v => v.source !== n.id && v.target !== n.id) }); setModal(null); setSelectedNode(hypothesis.nodes.find(v => v.id !== n.id)?.id || ""); } }); }}><Trash2 size={15}/>删除节点</button>}<div className="grow"/><button type="button" className="btn" disabled={busy} onClick={() => setModal(null)}>取消</button><button type="submit" className="btn primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin"/> : <Check size={16}/>}保存</button></div></form>}</DialogContent></Dialog>
 <AlertDialog open={!!confirm} onOpenChange={v => { if (!v && !busy)
        setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction className="destructive-button" disabled={busy} onClick={async (e) => { e.preventDefault(); setBusy(true); try {
        await confirm?.action();
        setConfirm(null);
    }
    catch (err) {
        toast.error((err as Error).message);
    }
    finally {
        setBusy(false);
    } }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
function FormChoice({ name, defaultValue, items }: {
    name: string;
    defaultValue: string;
    items: {
        value: string;
        label: string;
    }[];
}) { const [value, setValue] = useState(defaultValue || items[0]?.value || ""); return <><input type="hidden" name={name} value={value}/><Choice value={value} onChange={setValue} items={items} label={name}/></>; }
function ParentCheck({ id, label, checked }: {
    id: string;
    label: string;
    checked: boolean;
}) { const [value, setValue] = useState(checked); return <label className="check-row"><Checkbox checked={value} onCheckedChange={v => setValue(v === true)}/>{value && <input type="hidden" name="parents" value={id}/>}<span>{label}</span></label>; }
