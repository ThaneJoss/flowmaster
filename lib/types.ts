export type Status = "pending" | "running" | "verified" | "rejected";
export type NodeType = "baseline" | "observation" | "hypothesis" | "experiment" | "conclusion";
export interface FlowNode {
    id: string;
    title: string;
    type: NodeType;
    status: Status;
    x: number;
    y: number;
    inputs: string;
    output: string;
    summary: string;
    rationale: string;
    method: string;
    conclusion: string;
    nextAction: string;
    startedAt: string;
    duration: string;
}
export interface Edge {
    source: string;
    target: string;
}
export interface BaseRecord {
    id: string;
    updatedAt: string;
    revision?: number;
}
export interface Project extends BaseRecord {
    name: string;
    description: string;
}
export interface Hypothesis extends BaseRecord {
    projectId: string;
    title: string;
    description: string;
    baseline: string;
    status: Status;
    nodes: FlowNode[];
    edges: Edge[];
}
export interface Experiment extends BaseRecord {
    hypothesisId: string;
    nodeId: string;
    title: string;
    status: Status;
    summary: string;
    source: "manual" | "agent";
    duration: string;
    logs: {
        time: string;
        message: string;
    }[];
}
export interface Resource extends BaseRecord {
    projectId: string;
    name: string;
    type: "dataset" | "model" | "document" | "code";
    url: string;
    description: string;
}
export interface Workspace {
    projects: Project[];
    hypotheses: Hypothesis[];
    experiments: Experiment[];
    resources: Resource[];
}
export type Collection = keyof Workspace;
export const statusLabel: Record<Status, string> = { pending: "待验证", running: "验证中", verified: "已验证", rejected: "已丢弃" };
export const nodeTypeLabel: Record<NodeType, string> = { baseline: "基线训练", observation: "结果观察", hypothesis: "研究假设", experiment: "实验验证", conclusion: "研究结论" };
export const resourceLabel = { dataset: "数据集", model: "模型", document: "文档", code: "代码" };
export const uid = () => crypto.randomUUID();
export const emptyNode = (id: string, title = "新的验证节点", x = 40, y = 220): FlowNode => ({ id, title, type: "experiment", status: "pending", x, y, inputs: "", output: "", summary: "", rationale: "", method: "", conclusion: "", nextAction: "", startedAt: "", duration: "" });
