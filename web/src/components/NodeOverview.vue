<script setup>
import { computed } from "vue";
import NodeText from "./NodeText.vue";
import { nodeTypeLabel, nodeProgressLabel, resultStatusLabel, resourceLabel } from "../../../lib/types.ts";

const props = defineProps({
  node: { type: Object, default: () => ({}) },
  experiments: { type: Array, default: () => [] },
  experimentTotal: { type: Number, default: null },
  historyLoading: { type: Boolean, default: false },
  resources: { type: Array, default: () => [] },
  nodeOptions: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
});
const emit = defineEmits(["edit", "result", "history"]);
const node = computed(() => props.node || {});
const entries = computed(() => Array.isArray(props.experiments) ? props.experiments : []);
const currentResult = computed(() => entries.value.find(item => item.id === node.value.currentResultId));
const summary = computed(() => node.value.summary ?? currentResult.value?.summary ?? "");
const resultStatus = computed(() => node.value.status ?? currentResult.value?.status);
const resultTone = computed(() => ["verified", "running", "rejected"].includes(resultStatus.value) ? resultStatus.value : "neutral");
const researchFields = [
  { key: "rationale", label: "研究思路", placeholder: "尚未记录这一步的目标与研究思路。" },
  { key: "method", label: "研究方法", placeholder: "尚未补充研究方法。" },
  { key: "conclusion", label: "研究结论", placeholder: "尚未形成研究结论。" },
  { key: "nextAction", label: "后续行动", placeholder: "尚未安排后续行动。" },
];
const nodeIndex = computed(() => new Map(props.nodeOptions.map(item => [item.id ?? item.value, item])));
const upstream = computed(() => [...new Set(props.edges.filter(edge => edge.target === node.value.id).map(edge => edge.source))].map(id => ({ id, node: nodeIndex.value.get(id) })));
const resourceIndex = computed(() => new Map(props.resources.map(item => [item.id, item])));
const linkedResources = computed(() => [...new Set(Array.isArray(node.value.resourceIds) ? node.value.resourceIds : [])].map(id => ({ id, resource: resourceIndex.value.get(id) })));
const resultResources = computed(() => [...new Set(Array.isArray(currentResult.value?.resourceIds) ? currentResult.value.resourceIds : [])].filter(id => !node.value.resourceIds?.includes(id)).map(id => ({ id, resource: resourceIndex.value.get(id) })));
const allResourceLinks = computed(() => [...linkedResources.value.map(item => ({ ...item, origin: "节点资料" })), ...resultResources.value.map(item => ({ ...item, origin: "当前结果资料" }))]);
const recent = computed(() => entries.value.slice(0, 4));
const older = computed(() => entries.value.slice(4));
const label = (labels, value, fallback) => value === undefined || value === null || value === "" ? fallback : Object.hasOwn(labels, value) ? labels[value] : String(value);
const statusText = value => label(resultStatusLabel, value, "未设置状态");
const hasText = value => value !== undefined && value !== null && String(value).trim() !== "";
function date(value) {
  if (!hasText(value)) return "未记录时间";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function safeUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function sourceLabel(value) { return value === "agent" ? "历史模型建议" : value === "manual" ? "实验记录" : hasText(value) ? `来源：${String(value)}` : "来源未记录"; }
</script>

<template>
  <article class="node-overview" aria-label="节点详情概览">
    <div class="overview-heading">
      <div class="overview-heading__meta"><span class="overview-eyebrow">节点概览</span><span class="overview-tag">{{label(nodeTypeLabel,node.type,'未设置类型')}}</span></div>
      <h2>{{hasText(node.title)?node.title:'未命名节点'}}</h2>
      <div class="overview-heading__status"><span class="overview-status" :class="'overview-status--'+resultTone"><span class="overview-dot" aria-hidden="true"/>{{statusText(resultStatus)}}</span><span class="overview-progress">进度 · {{label(nodeProgressLabel,node.progress,'未设置')}}</span></div>
      <div class="overview-actions"><button type="button" class="overview-action overview-action--primary" @click="emit('result')">录入实验结果</button><button type="button" class="overview-action" @click="emit('edit')">编辑节点</button></div>
    </div>

    <section class="overview-result" :class="'overview-result--'+resultTone" aria-label="结果摘要">
      <div class="overview-section-title"><h3>结果摘要</h3><span class="overview-result__label">{{node.currentResultId?'当前结果':'节点摘要'}}</span></div>
      <NodeText :value="summary" placeholder="还没有结果摘要。完成实验后，可以在这里留下关键发现。" :limit="900"/>
      <p v-if="currentResult?.source==='agent'" class="overview-note">历史模型建议，不代表真实实验验证。</p>
      <p v-else-if="!node.currentResultId&&hasText(summary)" class="overview-note">保留的节点摘要，尚未关联具体执行记录。</p>
      <div v-if="hasText(node.duration)||hasText(currentResult?.duration)||currentResult?.recordedAt" class="overview-result__meta"><span v-if="hasText(node.duration)||hasText(currentResult?.duration)">耗时 · {{hasText(node.duration)?node.duration:currentResult?.duration}}</span><span v-if="currentResult?.recordedAt">{{date(currentResult.recordedAt)}}{{currentResult.recordedAtInferred?' · 历史时间推断':''}}</span></div>
    </section>

    <dl class="overview-facts"><div><dt>开始时间</dt><dd>{{hasText(node.startedAt)?node.startedAt:'未记录'}}</dd></div><div><dt>上游依赖</dt><dd>{{upstream.length?`${upstream.length} 个节点`:'无上游依赖'}}</dd></div></dl>

    <section v-for="field in researchFields" :key="field.key" class="overview-section"><h3>{{field.label}}</h3><NodeText :value="node[field.key]" :placeholder="field.placeholder"/></section>

    <section class="overview-section overview-artifacts"><h3>输入与输出</h3><div class="overview-artifact"><span class="overview-artifact__label">输入</span><NodeText :value="node.inputs" placeholder="未填写输入信息" code :limit="600"/></div><div class="overview-artifact"><span class="overview-artifact__label">输出</span><NodeText :value="node.output" placeholder="未填写输出信息" code :limit="600"/></div></section>

    <details v-if="upstream.length||allResourceLinks.length" :key="node.id+'-references'" class="overview-disclosure"><summary>依赖与关联资料 <span>{{upstream.length+allResourceLinks.length}}</span></summary><div class="overview-disclosure__body"><div v-if="upstream.length" class="overview-reference-group"><h4>上游节点</h4><ul class="overview-reference-list"><li v-for="parent in upstream" :key="parent.id"><span class="overview-reference-mark" aria-hidden="true">↳</span><div><strong>{{parent.node?.title||parent.node?.label||'未知节点'}}</strong><small v-if="parent.node?.type">{{label(nodeTypeLabel,parent.node.type,'未设置类型')}}</small><small v-else-if="!parent.node">{{parent.id}}</small></div></li></ul></div><div v-if="allResourceLinks.length" class="overview-reference-group"><h4>关联资料</h4><ul class="overview-reference-list"><li v-for="item in allResourceLinks" :key="item.id"><span class="overview-reference-mark" aria-hidden="true">↗</span><div><a v-if="safeUrl(item.resource?.url)" :href="safeUrl(item.resource.url)" target="_blank" rel="noopener noreferrer">{{item.resource.name||item.id}}</a><strong v-else>{{item.resource?.name||'未找到的资料'}}</strong><small>{{item.origin}}<template v-if="item.resource?.type"> · {{label(resourceLabel,item.resource.type,'其他资料')}}</template><template v-if="!item.resource"> · {{item.id}}</template></small><NodeText v-if="item.resource?.description" :value="item.resource.description" :limit="360"/></div></li></ul></div></div></details>

    <section class="overview-section overview-history"><div class="overview-section-title"><h3>实验记录</h3><span class="overview-count">{{experimentTotal??'—'}}</span></div><p v-if="!entries.length" class="overview-empty">{{historyLoading?'正在加载实验记录…':'暂无已加载的实验记录。'}}</p><ul v-else class="overview-history-list"><li v-for="record in recent" :key="record.id"><button type="button" class="overview-history-item" @click="emit('history',record)"><div class="overview-history-item__top"><strong>{{hasText(record.title)?record.title:'未命名记录'}}</strong><span class="overview-history-arrow" aria-hidden="true">↗</span></div><div class="overview-history-item__meta"><span class="overview-history-status" :class="{ 'is-verified':record.status==='verified', 'is-rejected':record.status==='rejected' }">{{statusText(record.status)}}</span><span>{{sourceLabel(record.source)}}</span><span v-if="record.id===node.currentResultId">当前结果</span></div><p v-if="hasText(record.summary)" class="overview-history-item__preview">{{record.summary}}</p><small>{{date(record.recordedAt||record.updatedAt)}}{{record.recordedAtInferred?' · 历史时间推断':''}}</small></button></li></ul>
      <details v-if="older.length" :key="node.id+'-history'" class="overview-disclosure overview-history-more"><summary>其余 {{older.length}} 条记录</summary><ul class="overview-history-list"><li v-for="record in older" :key="record.id"><button type="button" class="overview-history-item" @click="emit('history',record)"><div class="overview-history-item__top"><strong>{{hasText(record.title)?record.title:'未命名记录'}}</strong><span class="overview-history-arrow" aria-hidden="true">↗</span></div><div class="overview-history-item__meta"><span>{{statusText(record.status)}}</span><span>{{sourceLabel(record.source)}}</span><span v-if="record.id===node.currentResultId">当前结果</span></div><small>{{date(record.recordedAt||record.updatedAt)}}{{record.recordedAtInferred?' · 历史时间推断':''}}</small></button></li></ul></details>
    </section>
  </article>
</template>

<style scoped>
.node-overview{--overview-border:#e7ebf1;--overview-muted:#778397;display:flex;flex-direction:column;gap:22px;min-width:0;color:#253249;font-size:13px;line-height:1.7}
.overview-heading{min-width:0}
.overview-heading__meta,.overview-heading__status,.overview-actions,.overview-section-title,.overview-result__meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.overview-heading__meta{margin-bottom:10px}
.overview-eyebrow{color:var(--overview-muted);font-size:10px;font-weight:650;letter-spacing:.12em}
.overview-tag{border:1px solid #e1e7f0;border-radius:5px;padding:1px 7px;color:#526580;background:#f8fafd;font-size:10px;overflow-wrap:anywhere}
.overview-heading h2{margin:0 0 12px;font-size:21px;font-weight:650;line-height:1.45;letter-spacing:-.035em;overflow-wrap:anywhere}
.overview-heading__status{gap:12px;font-size:11px}
.overview-status{display:inline-flex;align-items:center;gap:6px;color:#6b778c}
.overview-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.overview-status--verified{color:#21846a}.overview-status--running{color:#396dc0}.overview-status--rejected{color:#b85b56}
.overview-progress{color:var(--overview-muted)}
.overview-actions{margin-top:18px;gap:8px}
.overview-action{min-height:36px;padding:7px 13px;border:1px solid #dce3ed;border-radius:7px;background:#fff;color:#536783;font-size:12px;font-weight:550;line-height:1.6;cursor:pointer}
.overview-action:hover{border-color:#bbc9dd;background:#f5f8fc;color:#2f5688}
.overview-action--primary{background:#eff4fc;border-color:#d5e1f5;color:#315e9d}
.overview-action--primary:hover{background:#e5eefb;border-color:#bbceed}
.overview-result{padding:17px 18px;border:1px solid #dce6f3;border-left:3px solid #7894bd;border-radius:10px;background:#f6f9fe;color:#314b6c}
.overview-result--verified{background:#f2faf7;border-color:#d6ebe2;border-left-color:#5ca78c;color:#2d5949}
.overview-result--running{background:#f3f7ff;border-color:#dce6fa;border-left-color:#7398db;color:#365580}
.overview-result--rejected{background:#fcf6f5;border-color:#efdfdc;border-left-color:#c78e82;color:#79514a}
.overview-section-title{justify-content:space-between;margin-bottom:11px}
.overview-section-title h3,.overview-section>h3{margin:0;font-size:12px;font-weight:650;letter-spacing:.01em}
.overview-result__label{color:inherit;opacity:.7;font-size:10px}
.overview-note{margin:10px 0 0;font-size:11px;opacity:.7;line-height:1.65}
.overview-result__meta{gap:7px 16px;border-top:1px solid currentColor;border-color:color-mix(in srgb,currentColor 12%,transparent);margin-top:13px;padding-top:9px;font-size:10px;opacity:.75}
.overview-facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin:0;padding:0 0 19px;border-bottom:1px solid var(--overview-border)}
.overview-facts dt{font-size:10px;color:var(--overview-muted);margin-bottom:4px}
.overview-facts dd{margin:0;color:#56677e;font-size:12px;overflow-wrap:anywhere}
.overview-section{min-width:0}
.overview-section>h3{margin-bottom:8px;color:#445570}
.overview-artifacts{display:grid;gap:13px}
.overview-artifacts>h3{margin-bottom:0}
.overview-artifact{min-width:0}
.overview-artifact__label{display:block;margin-bottom:6px;color:var(--overview-muted);font-size:10px;font-weight:550}
.overview-disclosure{min-width:0;border-top:1px solid var(--overview-border);padding-top:14px}
.overview-disclosure>summary{color:#53647d;cursor:pointer;font-size:12px;font-weight:600;overflow-wrap:anywhere}
.overview-disclosure>summary>span{margin-left:6px;color:var(--overview-muted);font-size:10px;font-weight:400}
.overview-disclosure__body{display:grid;gap:18px;padding-top:15px}
.overview-reference-group h4{margin:0 0 9px;font-size:10px;color:var(--overview-muted);font-weight:550}
.overview-reference-list,.overview-history-list{list-style:none;margin:0;padding:0}
.overview-reference-list{display:grid;gap:12px}
.overview-reference-list li{display:flex;gap:8px;min-width:0}
.overview-reference-mark{color:#8a9cb6;font-size:12px;flex:none}
.overview-reference-list li>div{min-width:0;flex:1}
.overview-reference-list strong,.overview-reference-list a{display:block;font-size:12px;font-weight:550;overflow-wrap:anywhere}
.overview-reference-list a{color:#426da6;text-decoration:none}
.overview-reference-list a:hover{text-decoration:underline}
.overview-reference-list small{display:block;margin-top:2px;color:var(--overview-muted);font-size:10px;overflow-wrap:anywhere}
.overview-history{padding-top:18px;border-top:1px solid var(--overview-border)}
.overview-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;border-radius:5px;padding:1px 6px;background:#f0f3f7;color:#7b879b;font-size:10px}
.overview-empty{margin:0;color:var(--overview-muted);font-size:12px}
.overview-history-list li+li{border-top:1px solid #edf0f5}
.overview-history-item{display:block;width:100%;min-width:0;min-height:0;margin:0;padding:12px 0;background:transparent;border:0;border-radius:5px;text-align:left;cursor:pointer;color:inherit}
.overview-history-item:hover{background:#f7f9fc;color:inherit}
.overview-history-item__top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}
.overview-history-item__top strong{font-size:12px;font-weight:550;line-height:1.6;overflow-wrap:anywhere}
.overview-history-arrow{color:#9aaac0;font-size:12px;flex:none}
.overview-history-item__meta{display:flex;gap:4px 10px;flex-wrap:wrap;margin-top:4px;color:#8792a5;font-size:10px;line-height:1.6}
.overview-history-status{color:#657990}.overview-history-status.is-verified{color:#32866e}.overview-history-status.is-rejected{color:#b07466}
.overview-history-item__preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 3px;font-size:11px;color:#6f7e92;line-height:1.7}
.overview-history-item>small{display:block;margin-top:5px;font-size:10px;color:#9aa4b5}
.overview-history-more{margin-top:8px;padding-top:11px}
.overview-history-more>.overview-history-list{margin-top:6px}
.node-overview :where(button,a,summary):focus-visible{outline:2px solid #2563eb;outline-offset:4px}
@media(max-width:420px){.node-overview{gap:19px}.overview-heading h2{font-size:19px}.overview-result{padding:14px}.overview-actions .overview-action{flex:1}.overview-facts{gap:10px}}
</style>
