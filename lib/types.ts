export type Status = "pending" | "running" | "verified" | "rejected";
export type NodeProgress = "pending" | "in_progress" | "completed";
export type NodeType = "baseline" | "observation" | "hypothesis" | "experiment" | "conclusion";
// A readable single-column layout of all 120 nodes needs more than 10,000px.
export const MAX_NODE_COORDINATE = 30000;
export interface FlowNode {
    id: string;
    title: string;
    type: NodeType;
    status: Status;
    progress?: NodeProgress;
    currentResultId?: string | null;
    resourceIds?: string[];
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
    recordedAt?: string;
    recordedAtInferred?: boolean;
    nodeTitle?: string;
    resourceIds?: string[];
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
export type CollectionRecord<K extends Collection> = Workspace[K][number];
export interface MutationResult<T> { data: T; affectedHypothesis?: Hypothesis; deletedExperimentIds?: string[] }
export interface Page<T> { data: T[]; total: number }
export const nodeProgressLabel: Record<NodeProgress, string> = { pending: "待开始", in_progress: "进行中", completed: "已完成" };
export const resultStatusLabel: Record<Status, string> = { pending: "待判定", running: "判定中", verified: "已验证", rejected: "未通过" };
export const statusLabel: Record<Status, string> = { pending: "待验证", running: "验证中", verified: "已验证", rejected: "已丢弃" };
export const nodeTypeLabel: Record<NodeType, string> = { baseline: "基线训练", observation: "结果观察", hypothesis: "研究假设", experiment: "实验验证", conclusion: "研究结论" };
export const resourceLabel = { dataset: "数据集", model: "模型", document: "文档", code: "代码" };
export const uid = () => crypto.randomUUID();
export const emptyNode = (id: string, title = "新的验证节点", x = 40, y = 220): FlowNode => ({ id, title, type: "experiment", status: "pending", progress: "pending", x, y, inputs: "", output: "", summary: "", rationale: "", method: "", conclusion: "", nextAction: "", startedAt: "", duration: "" });
