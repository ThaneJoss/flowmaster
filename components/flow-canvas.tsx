"use client";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Check, FileText, GitBranch, Lightbulb, Maximize, Minus, MousePointer2, Move, Plus, Scan, Search, X, Play, PanelRightOpen } from "lucide-react";
import type { FlowNode, Hypothesis } from "@/lib/types";
const W = 146, H = 128;
const icons = { baseline: Play, observation: BarChart3, hypothesis: Lightbulb, experiment: Search, conclusion: Check };
export default function FlowCanvas({ hypothesis, selected, onSelect, onChange, onAdd, onToggleDetail, project }: {
    hypothesis: Hypothesis;
    selected: string;
    onSelect: (id: string) => void;
    onChange: (h: Hypothesis) => Promise<void>;
    onAdd: () => void;
    onToggleDetail: () => void;
    project: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ x: 16, y: 32, z: .8 });
    const [nodes, setNodes] = useState(hypothesis.nodes);
    const [legend, setLegend] = useState(true);
    const drag = useRef<{
        id: string;
        x: number;
        y: number;
        ox: number;
        oy: number;
        moved: boolean;
    } | null>(null);
    useEffect(() => setNodes(hypothesis.nodes), [hypothesis]);
    const fit = () => { if (!ref.current)
        return; const ns = hypothesis.nodes; if (!ns.length)
        return; const maxX = Math.max(...ns.map(n => n.x + W)) + 25, maxY = Math.max(...ns.map(n => n.y + H)) + 35; const minX = Math.min(0, ...ns.map(n => n.x)), minY = Math.min(0, ...ns.map(n => n.y)); const z = Math.min(1.2, (ref.current.clientWidth - 40) / (maxX - minX), (ref.current.clientHeight - 85) / (maxY - minY)); setView({ x: (ref.current.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (ref.current.clientHeight - (maxY - minY) * z) / 2 - minY * z + 10, z }); };
    useEffect(() => { const ro = new ResizeObserver(fit); if (ref.current)
        ro.observe(ref.current); fit(); return () => ro.disconnect(); }, [hypothesis.id]); // position changes preserve the viewport
    const zoom = (d: number) => setView(v => { const z = Math.max(.25, Math.min(2, v.z + d)); const cx = (ref.current?.clientWidth || 800) / 2, cy = (ref.current?.clientHeight || 600) / 2; return { z, x: cx - (cx - v.x) * z / v.z, y: cy - (cy - v.y) * z / v.z }; });
    const autoLayout = async () => { const levels = new Map<string, number>(); const ns = hypothesis.nodes; for (let pass = 0; pass < ns.length; pass++)
        for (const n of ns) {
            const parents = hypothesis.edges.filter(e => e.target === n.id).map(e => e.source);
            if (parents.every(p => levels.has(p)))
                levels.set(n.id, parents.length ? Math.max(...parents.map(p => levels.get(p)!)) + 1 : 0);
        } const counts = new Map<number, number>(); const updated = ns.map(n => { const level = levels.get(n.id) || 0; const row = counts.get(level) || 0; counts.set(level, row + 1); return { ...n, x: 35 + level * 176, y: 210 + row * 185 }; }); await onChange({ ...hypothesis, nodes: updated }); };
    return <div className="canvas-wrap"><div className="canvas-toolbar"><div className="tool-group"><button title="缩小" aria-label="缩小" onClick={() => zoom(-.1)}><Minus size={16}/></button><span>{Math.round(view.z * 100)}%</span><button title="放大" aria-label="放大" onClick={() => zoom(.1)}><Plus size={16}/></button></div><button className="tool-btn" title="适配画布" onClick={fit}><Scan size={17}/><span>适配画布</span></button><button className="tool-btn" onClick={() => void autoLayout()}><GitBranch size={16}/><span>自动布局</span></button><button className="tool-btn" onClick={() => setLegend(!legend)}><span className="legend-toggle"/>图例</button><div className="toolbar-spacer"/><button className="tool-btn primary-text" onClick={onAdd}><Plus size={16}/>节点</button><button className="icon-btn detail-toggle" title="显示节点详情" onClick={onToggleDetail}><PanelRightOpen size={18}/></button></div>
 {legend && <div className="canvas-legend"><span><i className="blue"/>当前查看</span><span><i className="green"/>已验证</span><span><i className="gray"/>待验证</span><span><i className="red"/>结论</span></div>}
 <div ref={ref} className="graph-stage" aria-label="假设验证流程画布" onWheel={e => { if (e.ctrlKey || e.metaKey) {
        zoom(e.deltaY > 0 ? -.05 : .05);
    } }} onPointerDown={e => { if (e.target !== e.currentTarget)
        return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: "pan", x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false }; }} onPointerMove={e => { const d = drag.current; if (d?.id === "pan")
        setView(v => ({ ...v, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })); }} onPointerUp={() => { if (drag.current?.id === "pan")
        drag.current = null; }}>
 <div className="graph-world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
 <svg className="graph-edges" width="4500" height="3500" aria-hidden="true"><defs>{["blue", "green", "gray"].map((c) => <marker key={c} id={`arrow-${c}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={c === "green" ? "var(--status-success)" : c === "gray" ? "var(--graph-muted)" : "var(--brand)"}/></marker>)}</defs>
 {nodes[0] && <path d={`M ${nodes[0].x + W / 2} ${nodes[0].y - 105} V ${nodes[0].y - 3}`} stroke="var(--graph-muted)" strokeWidth="1.5" strokeDasharray="6 5" fill="none" markerEnd="url(#arrow-gray)"/>}
 {hypothesis.edges.map((e, i) => { const a = nodes.find(n => n.id === e.source), b = nodes.find(n => n.id === e.target); if (!a || !b)
        return null; let d; const branch = Math.abs(a.y - b.y) > 70; if (!branch) {
        d = `M ${a.x + W} ${a.y + H / 2} C ${a.x + W + 18} ${a.y + H / 2} ${b.x - 18} ${b.y + H / 2} ${b.x - 4} ${b.y + H / 2}`;
    }
    else if (b.y > a.y) {
        d = `M ${a.x + W / 2} ${a.y + H} V ${b.y - 18} Q ${a.x + W / 2} ${b.y - 6} ${b.x + W / 2} ${b.y - 6} L ${b.x + W / 2} ${b.y - 3}`;
    }
    else {
        d = `M ${a.x + W} ${a.y + H / 2} H ${b.x + W / 2 - 16} Q ${b.x + W / 2} ${a.y + H / 2} ${b.x + W / 2} ${a.y + H / 2 - 16} V ${b.y + H + 4}`;
    } ; return <path key={i} d={d} stroke={branch ? "var(--status-success)" : "var(--brand)"} strokeWidth="2.3" fill="none" markerEnd={`url(#arrow-${branch ? "green" : "blue"})`}/>; })}</svg>
 {nodes[0] && <div className="task-node" style={{ left: nodes[0].x, top: nodes[0].y - 190 }}><span>主任务</span><p>{project}</p></div>}
 {nodes.map(n => {
            const Icon = n.id === selected ? FileText : n.status === "rejected" ? X : icons[n.type];
            return <button key={n.id} className={`flow-node ${n.type === "conclusion" ? n.status : ""} ${selected === n.id ? "selected" : ""}`} style={{ left: n.x, top: n.y, width: W, height: H }} onClick={() => onSelect(n.id)} onDoubleClick={() => onToggleDetail()} aria-label={`节点：${n.title.replaceAll("\n", "")}`} aria-pressed={selected === n.id} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y, moved: false }; }} onPointerMove={e => { const d = drag.current; if (d?.id !== n.id)
                return; const dx = (e.clientX - d.x) / view.z, dy = (e.clientY - d.y) / view.z; if (Math.abs(dx) + Math.abs(dy) > 5)
                d.moved = true; if (d.moved)
                setNodes(prev => prev.map(v => v.id === n.id ? { ...v, x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) } : v)); }} onPointerUp={() => { if (drag.current?.moved)
                void onChange({ ...hypothesis, nodes }); drag.current = null; }} onKeyDown={e => { const d = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key]; if (d && e.altKey) {
                e.preventDefault();
                void onChange({ ...hypothesis, nodes: nodes.map(v => v.id === n.id ? { ...v, x: Math.max(0, v.x + d[0]), y: Math.max(0, v.y + d[1]) } : v) });
            } }}>
 {selected === n.id && <span className="viewing">当前查看</span>}<span className={`node-icon ${n.type}`}><Icon size={26} strokeWidth={1.8}/></span><span className="node-title">{n.title}</span><i className="node-handle left"/><i className="node-handle right"/></button>;
        })}
 </div></div>
 <button className="minimap" title="适配全部节点" aria-label="适配全部节点" onClick={fit}><svg viewBox="0 0 1220 650">{nodes.map(n => <rect key={n.id} x={n.x} y={n.y} width={W} height={H} rx="12" fill={n.id === selected ? "var(--brand)" : n.status === "rejected" ? "var(--graph-rejected)" : "var(--graph-muted)"}/>)}<rect x={-view.x / view.z} y={-view.y / view.z} width={(ref.current?.clientWidth || 800) / view.z} height={(ref.current?.clientHeight || 600) / view.z} fill="var(--graph-selection-fill)" stroke="var(--brand)" strokeWidth="5"/></svg><span><Minus size={12}/><Maximize size={12}/></span></button>
 <div className="canvas-hint"><MousePointer2 size={13}/>选择节点查看详情<span>·</span><Move size={13}/>拖动编排</div>
 </div>;
}
