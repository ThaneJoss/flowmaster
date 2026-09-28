"use client";
import { Check, Circle, Loader2, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Status, statusLabel } from "@/lib/types";
export function Badge({ status }: {
    status: Status;
}) { return <span className={`badge ${status}`}>{statusLabel[status]}</span>; }
export function StatusIcon({ status }: {
    status: Status;
}) { const Icon = status === "verified" ? Check : status === "rejected" ? X : status === "running" ? Loader2 : Circle; return <span className={`status-icon ${status}`}><Icon size={13}/></span>; }
export function Choice({ value, onChange, items, label }: {
    value: string;
    onChange: (v: string) => void;
    items: {
        value: string;
        label: string;
    }[];
    label?: string;
}) { return <Select value={value} onValueChange={onChange}><SelectTrigger className="choice" aria-label={label || "选择"}><SelectValue /></SelectTrigger><SelectContent>{items.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent></Select>; }
export const statuses = Object.entries(statusLabel).map(([value, label]) => ({ value, label }));
export function Field({ label, children, hint }: {
    label: string;
    children: React.ReactNode;
    hint?: string;
}) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Empty({ title, description, children }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
}) { return <div className="empty-state"><div className="empty-symbol">◇</div><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>; }
export function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
export function downloadJson(name: string, data: unknown) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
