import { emptyNode, type Hypothesis, type Workspace } from "./types.ts";
const time = "2026-09-28T06:20:00.000Z";
const base = { updatedAt: time, revision: 1 };
const nodes = [
    { ...emptyNode("n1", "DINOv3 + MLP\n基线训练", 35, 250), type: "baseline" as const, status: "verified" as const, summary: "基线训练已完成，记录测试集准确率。" },
    { ...emptyNode("n2", "发现某测试子集\n效果很差", 202, 250), type: "observation" as const, status: "verified" as const, summary: "测试子集的准确率显著低于整体测试集。" },
    { ...emptyNode("n3", "提出假设：局部判别\n信息未有效传递到 CLS", 369, 250), type: "hypothesis" as const, status: "verified" as const },
    { ...emptyNode("n4", "检查局部能量\n是否具有判别信息", 536, 250), status: "verified" as const, summary: "局部 patch 响应包含可分辨类别的信息。" },
    { ...emptyNode("n5", "检查这些信息\n是否传递到 CLS", 703, 250), status: "verified" as const, inputs: "异常测试子集、局部 patch 响应、CLS 表征", output: "传递性检验结果", summary: "局部判别信息可在 CLS 中被观测到", rationale: "在 DINOv3 + MLP 基线中，某测试样本集表现明显偏低，因此怀疑局部判别信息没有进入全局 CLS 表征。", method: "先验证局部能量本身是否包含可分辨信息，再检查这些信息是否能够传递并保留在 CLS 表征中。", conclusion: "实验发现局部能量确实存在分辨信息，而且这些信息已经成功传递到 CLS，因此原假设不能解释测试子集性能下降。", nextAction: "继续检查 MLP Head 利用方式、分布偏移等其它潜在原因。", startedAt: "14:08", duration: "12 分钟" },
    { ...emptyNode("n6", "信息已传递\n到 CLS", 870, 250), type: "conclusion" as const, status: "verified" as const },
    { ...emptyNode("n7", "丢弃假设", 1037, 250), type: "conclusion" as const, status: "rejected" as const },
    { ...emptyNode("n8", "局部能量\n存在分辨信息", 580, 443), type: "conclusion" as const, status: "verified" as const }
];
const hypothesis: Hypothesis = { ...base, id: "h-cls", projectId: "p-dino", title: "局部判别信息未传递到 CLS 假设", description: "测试效果差是因为局部判别信息没有有效传递到 CLS 表征", baseline: "DINOv3 + MLP", status: "rejected", nodes, edges: [{ source: "n1", target: "n2" }, { source: "n2", target: "n3" }, { source: "n3", target: "n4" }, { source: "n4", target: "n5" }, { source: "n5", target: "n6" }, { source: "n6", target: "n7" }, { source: "n4", target: "n8" }, { source: "n8", target: "n5" }] };
function secondary(id: string, title: string, status: Hypothesis["status"], projectId = "p-dino"): Hypothesis { return { ...base, id, title, description: title, projectId, baseline: "DINOv3 + MLP", status, nodes: [{ ...emptyNode(`${id}-1`, "整理实验基线", 40, 250), type: "baseline", status: "verified" }, { ...emptyNode(`${id}-2`, "设计验证实验", 240, 250), status }, { ...emptyNode(`${id}-3`, "记录实验结论", 440, 250), type: "conclusion" }], edges: [{ source: `${id}-1`, target: `${id}-2` }, { source: `${id}-2`, target: `${id}-3` }] }; }
export const demoWorkspace: Workspace = {
    projects: [{ ...base, id: "p-dino", name: "定位测试子集性能下降原因", description: "DINOv3 表征与下游分类性能研究" }, { ...base, id: "p-rag", name: "检索增强训练", description: "检索策略与训练效果对比" }, { ...base, id: "p-modal", name: "多模态对齐分析", description: "视觉与文本表征的对齐实验" }],
    hypotheses: [hypothesis, secondary("h-mlp", "测试效果差是因为 MLP Head 没有充分利用 DINOv3 已包含的判别信息", "running"), secondary("h-shift", "测试效果差是因为该测试子集与训练集存在表征分布偏移", "pending"), secondary("h-detail", "测试效果差是因为训练过程抑制了细粒度局部特征", "pending"), secondary("h-rag", "检索上下文相关性影响回答质量", "pending", "p-rag"), secondary("h-modal", "图文表征尺度差异影响对齐", "verified", "p-modal")],
    experiments: [{ ...base, id: "exp-cls", hypothesisId: "h-cls", nodeId: "n5", title: "CLS 传递性检查", status: "verified", summary: "局部判别信息可在 CLS 中被观测到，原假设被丢弃。", source: "manual", duration: "12 分钟", logs: [{ time: "14:08", message: "提出传递性检查" }, { time: "14:12", message: "发现局部能量可区分类别" }, { time: "14:18", message: "观测到 CLS 中存在对应判别信号" }, { time: "14:20", message: "结论：丢弃假设" }] }],
    resources: [{ ...base, id: "r-dataset", projectId: "p-dino", name: "异常测试子集", type: "dataset", url: "", description: "用于检查局部 patch 响应与 CLS 表征的测试样本。" }, { ...base, id: "r-model", projectId: "p-dino", name: "DINOv3 + MLP 基线", type: "model", url: "", description: "当前研究使用的视觉表征与分类头。" }, { ...base, id: "r-notes", projectId: "p-dino", name: "传递性检验笔记", type: "document", url: "", description: "局部判别信息与 CLS 信号的观察记录。" }]
};
