<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./components/UiButton.vue";
import UiField from "./components/UiField.vue";
import UiModal from "./components/UiModal.vue";
import ProjectList from "./components/ProjectList.vue";
import ProjectWorkspace from "./components/ProjectWorkspace.vue";
import StepInspector from "./components/StepInspector.vue";
import ProjectRecords from "./components/ProjectRecords.vue";
import ProjectResources from "./components/ProjectResources.vue";
import RecordForm from "./components/RecordForm.vue";
import ConnectionSettings from "./components/ConnectionSettings.vue";
import { useNavigation } from "./composables/useNavigation.js";
import { useWorkspace } from "./composables/useWorkspace.ts";
import { useNodeDrafts } from "../../lib/node-drafts.ts";
import { isRequestCancelled } from "../../lib/client.ts";
import { emptyNode } from "../../lib/types.ts";
import { layoutNodes, newNodePosition } from "../../lib/canvas-layout.ts";

const ws = useWorkspace();
const { connection, connecting, projects, allProjects, allHypotheses, allResources, hypotheses, resources, records, recordsTotal, nodeHistory, nodeHistoryTotal, tokens, loading, errors } = ws;
const { projectsTotal, projectsOffset, projectsNextOffset, hypothesesTotal, hypothesesOffset, hypothesesNextOffset, resourcesTotal, resourcesOffset, resourcesNextOffset, recordsOffset: recordOffset, recordsNextOffset, nodeHistoryOffset: historyOffset, nodeHistoryNextOffset } = ws;
const { route, go, project: navigateProject } = useNavigation();
const mainElement = ref(null), notice = ref(""), modal = ref(null), modalBusy = ref(false), settingsError = ref(""), focused = ref(false);
const projectQuery = ref(""), flowQuery = ref(""), resourceQuery = ref("");
const recordFilters = ref({ q: "", status: "", hypothesisId: "" });
const recordLimit = 30, historyLimit = 10;
const savedFilters = new Map(), loadedProjects = new Set();
let noticeTimer, projectSearchTimer, flowSearchTimer, resourceSearchTimer, navigationVersion = 0, resultVersion = 0, historyKey = "", loadedRecordProject = "", projectLoad = null;
const currentProject = computed(() => allProjects.value.find(item => item.id === route.value.projectId) || null);
const current = computed(() => allHypotheses.value.find(item => item.id === route.value.hypothesisId && item.projectId === route.value.projectId) || null);
const projectResources = computed(() => allResources.value.filter(item => item.projectId === route.value.projectId));
const projectFlows = computed(() => allHypotheses.value.filter(item => item.projectId === route.value.projectId));
const selectedNode = computed(() => current.value?.nodes.find(item => item.id === route.value.nodeId) || null);
const { nodeDraft, upstream, dirty: nodeDirty, conflicted: nodeConflicted, clear: clearDrafts, acknowledge: acknowledgeNode } = useNodeDrafts(allHypotheses, current, selectedNode);
const canvasBusy = computed(() => !!current.value && ws.isPending(`hypothesis:${current.value.id}`));
const pendingRecordId = computed(() => [...records.value, ...nodeHistory.value].find(item => ws.isPending(`record:${item.id}`))?.id || "");
const pendingResourceId = computed(() => resources.value.find(item => ws.isPending(`resource:${item.id}`))?.id || "");
const pendingTokenId = computed(() => tokens.value.find(item => ws.isPending(`token:${item.id}`))?.id || "");
const currentResult = computed(() => ws.resultCache.get(selectedNode.value?.currentResultId) || null);
const resultLoading = ref(false);
const resultStatuses = { pending: "待判定", running: "判定中", verified: "已验证", rejected: "未通过" };
const field = (key, label, type = "text", options) => ({ key, label, type, options });
const clone = value => JSON.parse(JSON.stringify(value));
const date = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录";
const safeUrl = value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };

function message(text) { notice.value = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = ""; }, 8000); }
async function perform(action, success) {
  try { const value = await action(); if (success) message(success); return value; }
  catch (error) { if (!isRequestCancelled(error)) message(error.message || "操作失败"); return undefined; }
}
function closeModal() { if (!modalBusy.value) modal.value = null; }
function form(title, fields, value, submit, description = "") { modal.value = { kind: "form", title, fields, value: clone(value), submit, description, error: "" }; }
function confirmAction(title, description, submit) { modal.value = { kind: "confirm", title, description, submit, error: "" }; }
async function submitModal(value) {
  const target = modal.value;
  if (!target || modalBusy.value) return;
  modalBusy.value = true; target.error = "";
  try { await target.submit(value ?? target.value); if (modal.value === target) modal.value = null; }
  catch (error) { if (!isRequestCancelled(error) && modal.value === target) target.error = (error.message || "操作失败") + (error.status === 409 ? "；请关闭表单后重新打开，核对最新内容再提交。" : ""); }
  finally { modalBusy.value = false; }
}
function download(value, name) {
  const url = URL.createObjectURL(value instanceof Blob ? value : new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setProjectTab(tab) { navigateProject(currentProject.value.id, tab, current.value?.id || route.value.hypothesisId || "", selectedNode.value?.id || route.value.nodeId || ""); }
function selectFlow(id) { navigateProject(currentProject.value.id, "flows", id); }
function selectNode(id) { navigateProject(currentProject.value.id, "flows", current.value.id, id); }

async function readSettings() {
  settingsError.value = "";
  try { await ws.listTokens(); } catch (error) { if (!isRequestCancelled(error)) settingsError.value = error.message; }
}
async function connect(value, redirect = true) {
  await perform(async () => {
    loadedProjects.clear(); savedFilters.clear(); projectLoad = null; historyKey = ""; loadedRecordProject = ""; await ws.connect(value); settingsError.value = ""; message("工作区已连接");
    if (redirect) go("projects");
  });
}
function disconnect() { clearTimeout(projectSearchTimer); clearTimeout(flowSearchTimer); clearTimeout(resourceSearchTimer); clearDrafts(); ws.disconnect(); modal.value = null; settingsError.value = ""; loadedRecordProject = ""; historyKey = ""; savedFilters.clear(); loadedProjects.clear(); projectLoad = null; projectQuery.value = ""; flowQuery.value = ""; resourceQuery.value = ""; go("settings"); }

function loadProjects(offset = 0) { return perform(() => ws.refreshProjects({ q: projectQuery.value, offset })); }
function loadFlows(offset = 0) { return perform(() => ws.loadHypotheses({ q: flowQuery.value, offset })); }
function loadResources(offset = 0) { return perform(() => ws.loadResources({ q: resourceQuery.value, offset })); }
function searchProjects(query) { projectQuery.value = query; clearTimeout(projectSearchTimer); projectSearchTimer = setTimeout(() => loadProjects(), 200); }
function searchFlows(query) { flowQuery.value = query; clearTimeout(flowSearchTimer); flowSearchTimer = setTimeout(() => loadFlows(), 200); }
function searchResources(query) { resourceQuery.value = query; clearTimeout(resourceSearchTimer); resourceSearchTimer = setTimeout(() => loadResources(), 200); }

async function ensureProject(id, refresh = false) {
  if (projectLoad?.id === id) return projectLoad.promise;
  if (!refresh && ws.projectId.value === id && loadedProjects.has(id)) return;
  const promise = ws.selectProject(id);
  const task = { id, promise };
  projectLoad = task;
  try { await promise; if (ws.projectId.value === id) loadedProjects.add(id); }
  finally { if (projectLoad === task) projectLoad = null; }
}
async function loadRecords(offset = recordOffset.value) {
  await perform(() => ws.loadRecords({ ...recordFilters.value, offset, limit: recordLimit }));
}
function filterRecords(filters) { recordFilters.value = filters; savedFilters.set(currentProject.value.id, { ...filters }); loadRecords(0); }
async function loadHistory(offset = historyOffset.value) {
  const flow = current.value, node = selectedNode.value;
  if (!flow || !node) return;
  await perform(() => ws.loadNodeHistory(flow.id, node.id, { offset, limit: historyLimit }));
}
async function hydrateResources(ids, force = false) {
  const missing = [...new Set(ids || [])].filter(id => force || !allResources.value.some(item => item.id === id));
  for (let offset = 0; offset < missing.length; offset += 5) await Promise.all(missing.slice(offset, offset + 5).map(id => ws.getResource(id)));
}
async function loadCurrentResult(force = false) {
  const version = ++resultVersion;
  const node = selectedNode.value;
  if (!node) { resultLoading.value = false; return; }
  const id = selectedNode.value?.currentResultId;
  resultLoading.value = true;
  try {
    const record = id ? force || !ws.resultCache.has(id) ? await ws.getResult(id) : ws.resultCache.get(id) : null;
    await hydrateResources([...(node.resourceIds || []), ...(record?.resourceIds || [])], force);
  } catch (error) { if (!isRequestCancelled(error) && version === resultVersion) message(error.message); }
  finally { if (version === resultVersion) resultLoading.value = false; }
}
watch(connection, (value, previous) => { if (previous && value !== previous) clearDrafts(); });
watch(() => [recordsTotal.value, loading.records], ([total, busy]) => { if (!busy && !errors.records && route.value.tab === "records" && recordOffset.value > 0 && recordOffset.value >= total) loadRecords(0); });
watch(() => [nodeHistoryTotal.value, loading.nodeHistory], ([total, busy]) => { if (!busy && !errors.nodeHistory && route.value.tab === "flows" && selectedNode.value && historyOffset.value > 0 && historyOffset.value >= total) loadHistory(0); });
watch(() => [current.value?.id, selectedNode.value?.id, selectedNode.value?.currentResultId], () => { resultLoading.value = false; loadCurrentResult(); });
watch(() => [route.value.page, route.value.projectId, route.value.tab], (next, previous) => {
  if (previous && next.every((value, index) => value === previous[index])) return;
  closeModal(); focused.value = false;
  clearTimeout(projectSearchTimer); clearTimeout(flowSearchTimer); clearTimeout(resourceSearchTimer);
  if (next[1] !== previous?.[1]) { flowQuery.value = ""; resourceQuery.value = ""; }
  if (previous?.[0] === "settings" && next[0] !== "settings" && connecting.value) { clearDrafts(); ws.disconnect(); }
});
watch(() => [connection.value, route.value.page, route.value.projectId, route.value.tab, route.value.hypothesisId, route.value.nodeId], async () => {
  const version = ++navigationVersion;
  if (!connection.value) return;
  if (route.value.page === "settings") { await readSettings(); return; }
  if (route.value.page === "projects") {
    if (route.value.legacyTab && projectsTotal.value === 1) navigateProject(projects.value[0].id, route.value.legacyTab, "", "", true);
    return;
  }
  const requestedProject = route.value.projectId;
  let project = currentProject.value;
  if (!project) {
    try { project = await ws.getProject(requestedProject); }
    catch (error) {
      if (version !== navigationVersion || isRequestCancelled(error)) return;
      message(error.status === 404 ? "该项目已不存在，请选择其他项目。" : error.message);
      if (error.status === 404) go("projects", true);
      return;
    }
  }
  if (version !== navigationVersion) return;
  if (ws.projectId.value !== project.id) {
    recordFilters.value = savedFilters.get(project.id) || { q: "", status: "", hypothesisId: "" };
    recordOffset.value = 0; historyOffset.value = 0; loadedRecordProject = ""; historyKey = "";
  }
  await perform(() => ensureProject(project.id));
  if (version !== navigationVersion || errors.project || ws.projectId.value !== project.id) return;
  if (route.value.tab === "flows") {
    if (route.value.hypothesisId && !current.value) {
      try { await ws.getHypothesis(route.value.hypothesisId); }
      catch (error) { if (version !== navigationVersion || isRequestCancelled(error)) return; if (error.status !== 404) { message(error.message); return; } }
      if (version !== navigationVersion) return;
    }
    if (!current.value && hypotheses.value.length) { navigateProject(project.id, "flows", hypotheses.value[0].id, "", true); return; }
    if (current.value && route.value.nodeId && !selectedNode.value) { message("该步骤已删除，历史执行记录仍可在“记录”中查看。"); navigateProject(project.id, "flows", current.value.id, "", true); return; }
    const nextKey = selectedNode.value ? `${current.value.id}/${selectedNode.value.id}` : "";
    if (nextKey && nextKey !== historyKey) { historyKey = nextKey; await loadHistory(0); if (errors.nodeHistory) historyKey = ""; }
    else if (!nextKey && historyKey) { historyKey = ""; historyOffset.value = 0; await ws.loadNodeHistory("", ""); }
  } else if (route.value.tab === "records") {
    if (loadedRecordProject !== project.id) { loadedRecordProject = project.id; await loadRecords(0); if (errors.records) loadedRecordProject = ""; }
  }
}, { immediate: true });

function editProject(item) {
  const original = item ? clone(item) : null;
  form(original ? "编辑项目" : "新建项目", [field("name", "项目名称"), field("description", "项目说明", "textarea")], original || { name: "", description: "" }, async value => {
    if (original) { await ws.updateProject(original.id, { name: value.name, description: value.description, revision: original.revision }); message("项目已保存"); }
    else { const created = await ws.createProject(value); navigateProject(created.id); message("项目已创建，接下来新建一个流程。"); }
  });
}
function removeProject(item) { const target = clone(item); confirmAction("删除项目", `将删除“${target.name}”。若项目仍有流程或资料，请先处理这些内容。`, async () => { await ws.deleteProject(target.id); if (route.value.projectId === target.id) go("projects"); message("项目已删除"); }); }
function editFlow(item) {
  const original = item ? clone(item) : null, projectId = currentProject.value.id;
  form(original ? "编辑流程" : "新建流程", [field("title", "流程名称"), field("description", "流程目标 / 说明", "textarea"), field("baseline", "基线（可选）")], original || { title: "", description: "", baseline: "" }, async value => {
    const data = { title: value.title, description: value.description, baseline: value.baseline, projectId };
    const saved = original ? await ws.updateHypothesis(original.id, { ...data, revision: original.revision }) : await ws.createHypothesis({ ...data, status: "pending", nodes: [], edges: [] });
    if (route.value.projectId === projectId) navigateProject(projectId, "flows", saved.id);
    message(original ? "流程已保存" : "流程已创建，接下来添加一个步骤。");
  });
}
function removeFlow(item) { const target = clone(item); confirmAction("删除流程", `“${target.title}”的步骤和关联执行记录都会删除，无法从页面恢复。`, async () => { await ws.deleteHypothesis(target.id); if (route.value.hypothesisId === target.id) navigateProject(target.projectId); message("流程已删除"); }); }
function addNode({ width } = {}) {
  const flow = current.value;
  if (!flow) return;
  const projectId = flow.projectId, hypothesisId = flow.id;
  form("添加步骤", [field("title", "步骤标题"), field("type", "步骤类型", "select", [{ value: "experiment", label: "实验" }, { value: "baseline", label: "基线" }, { value: "observation", label: "观察" }, { value: "hypothesis", label: "假设" }, { value: "conclusion", label: "结论" }]), field("rationale", "目标 / 说明", "textarea")], { title: "", type: "experiment", rationale: "" }, async value => {
    const latest = allHypotheses.value.find(item => item.id === hypothesisId);
    if (!latest) throw new Error("流程已删除，请重新选择。");
    const { x, y } = newNodePosition(latest.nodes, width), node = { ...emptyNode(crypto.randomUUID(), value.title, x, y), ...value, progress: "pending", resourceIds: [] };
    await ws.createNode(hypothesisId, node);
    if (route.value.projectId === projectId) navigateProject(projectId, "flows", hypothesisId, node.id);
    message("步骤已添加，可以记录一次执行。");
  });
}
function saveNode() {
  const flow = current.value, draft = nodeDraft.value;
  if (!flow || !draft) return;
  const submitted = clone(draft), parents = [...upstream.value];
  const keys = ["title", "type", "progress", "inputs", "output", "rationale", "method", "conclusion", "nextAction", "startedAt", "resourceIds"];
  const same = (a, b) => Array.isArray(a) || Array.isArray(b) ? (a || []).length === (b || []).length && (a || []).every(id => (b || []).includes(id)) : a === b;
  const patch = Object.fromEntries(keys.filter(key => submitted[key] !== undefined && !same(submitted[key], selectedNode.value[key])).map(key => [key, submitted[key]]));
  const storedParents = flow.edges.filter(edge => edge.target === submitted.id).map(edge => edge.source);
  const parentPatch = same(parents, storedParents) ? undefined : parents;
  if (!Object.keys(patch).length && parentPatch === undefined) { message("没有待保存的步骤修改"); return; }
  const commit = async () => {
    const saved = await ws.updateNode(flow.id, submitted.id, patch, parentPatch);
    const savedParents = saved.edges.filter(edge => edge.target === submitted.id).map(edge => edge.source);
    acknowledgeNode(flow.id, submitted, savedParents, saved.nodes.find(item => item.id === submitted.id));
    message("步骤已保存");
  };
  if (nodeConflicted.value) confirmAction("确认保存冲突字段", "服务端也修改了草稿中的字段。确认后使用当前草稿；取消可继续核对。", commit);
  else perform(commit);
}
function removeNode() { const flow = current.value, node = selectedNode.value; if (!flow || !node) return; confirmAction("删除步骤", `删除“${node.title}”及相关依赖，保留历史执行记录。`, async () => { await ws.deleteNode(flow.id, node.id); if (route.value.nodeId === node.id) navigateProject(flow.projectId, "flows", flow.id); message("步骤已删除，执行历史仍然保留。"); }); }
function moveNode(position) { const flow = current.value; if (flow) perform(() => ws.moveNode(flow.id, position.id, { x: position.x, y: position.y })); }
function layout({ width, complete }) { const flow = current.value; if (flow) perform(async () => { await ws.layout(flow.id, layoutNodes(flow.nodes, flow.edges, width).map(({ id, x, y }) => ({ id, x, y }))); await complete?.(); }); }

function recordForm(record = null) {
  const original = record ? clone(record) : null;
  const flow = current.value, node = selectedNode.value;
  modal.value = { kind: "record", title: original ? "修正执行记录" : "记录一次执行", record: original, hypotheses: [...hypotheses.value], resources: [...resources.value], hypothesisId: flow?.id || "", nodeId: node?.id || "", initialTitle: nodeDraft.value?.title || node?.title || "", error: "", submit: async ({ hypothesisId, data }) => {
    if (original) await ws.updateResult(original.id, { ...data, hypothesisId: original.hypothesisId, nodeId: original.nodeId, source: original.source, revision: original.revision });
    else await ws.createResult(hypothesisId, data);
    message(original ? "执行记录已修正" : "执行记录已保存，并设为当前结果");
  } };
  if (original?.resourceIds?.length) perform(() => hydrateResources(original.resourceIds));
}
function removeRecord(record) { const target = clone(record); confirmAction("删除执行记录", `删除“${target.title}”。若它是当前结果，步骤会清空当前结果；不会自动改用其他历史记录。`, async () => { await ws.deleteResult(target.id); message("执行记录已删除"); }); }
function showRecord(record) { modal.value = { kind: "record-detail", title: record.title, record: clone(record) }; if (record.resourceIds?.length) perform(() => hydrateResources(record.resourceIds)); }
function jumpToRecord(record) { perform(async () => {
  let flow;
  try { flow = await ws.getHypothesis(record.hypothesisId); }
  catch (error) { if (error.status === 404) { message("原流程已删除，记录仍保留在当前列表。"); return; } throw error; }
  closeModal();
  if (!flow.nodes.some(item => item.id === record.nodeId)) { message("原步骤已删除，正在打开所属流程；记录可继续查看和修正。"); navigateProject(flow.projectId, "flows", flow.id); return; }
  navigateProject(flow.projectId, "flows", flow.id, record.nodeId);
}); }
function selectResult(record) {
  const flow = current.value, node = selectedNode.value;
  if (!flow || !node || record.source !== "manual") return;
  confirmAction("设为当前结果", `步骤将显示“${record.title}”的结果判定、摘要和耗时；执行进度与开始时间不变。`, async () => { await ws.selectResult(flow.id, node.id, record.id); message("当前结果已更新"); });
}
function editResource(item) {
  const original = item ? clone(item) : null, projectId = currentProject.value.id;
  form(original ? "编辑资料" : "添加资料", [field("name", "资料名称"), field("type", "资料类型", "select", [{ value: "document", label: "文档" }, { value: "code", label: "代码" }, { value: "dataset", label: "数据集" }, { value: "model", label: "模型资料" }]), field("url", "链接", "url"), field("description", "说明", "textarea")], original || { name: "", type: "document", url: "", description: "" }, async value => {
    const data = { name: value.name, type: value.type, url: value.url, description: value.description, projectId };
    if (original) await ws.updateResource(original.id, { ...data, revision: original.revision }); else await ws.createResource(data);
    message("资料已保存，可在步骤或执行记录中关联。");
  });
}
function removeResource(item) { const target = clone(item); confirmAction("删除资料", `删除“${target.name}”。已被步骤或执行记录引用的资料需要先解除关联。`, async () => { await ws.deleteResource(target.id); message("资料已删除"); }); }
function createToken() {
  form("创建访问 Token", [field("name", "名称"), field("scope", "权限", "select", [{ value: "read", label: "只读" }, { value: "write", label: "读写" }, { value: "admin", label: "管理员" }]), field("expiresInDays", "有效天数（1–365）", "number")], { name: "", scope: "read", expiresInDays: 30 }, async value => {
    const created = await ws.createToken({ ...value, expiresInDays: Number(value.expiresInDays) });
    modal.value = { kind: "token", title: "请保存新 Token", token: created.token, description: "完整 Token 仅显示这一次，关闭后无法再次查看。" };
  });
}
function revokeToken(token) { confirmAction("撤销访问 Token", `使用“${token.name}”的客户端将立即失去访问权限。`, async () => { await ws.revokeToken(token.id); message("Token 已撤销"); }); }
function seed() { confirmAction("导入示例项目", "仅可向空工作区导入，不会覆盖已有数据。", async () => { await ws.seed(); go("projects"); message("示例项目已导入"); }); }
function exportWorkspace() { perform(async () => download(await ws.exportWorkspace(), "flowmaster-workspace.json")); }
function exportRecords() { const filters = { ...recordFilters.value }; perform(async () => download(await ws.exportRecords(filters), "flowmaster-records.json")); }
function refreshProject() {
  const id = currentProject.value?.id;
  if (!id) return;
  perform(async () => {
    await ws.getProject(id);
    await ensureProject(id, true);
    if (route.value.projectId !== id) return;
    if (route.value.tab === "records") await loadRecords();
    else if (route.value.tab === "flows") {
      if (route.value.hypothesisId) {
        try { await ws.getHypothesis(route.value.hypothesisId); }
        catch (error) { if (error.status !== 404) throw error; }
        if (route.value.projectId !== id) return;
      }
      if (!current.value && hypotheses.value.length) navigateProject(id, "flows", hypotheses.value[0].id, "", true);
      else if (route.value.nodeId && !selectedNode.value) navigateProject(id, "flows", current.value?.id || "", "", true);
      else if (selectedNode.value) { await loadHistory(); await loadCurrentResult(true); }
    }
  });
}
function retryProject() { const r = route.value; navigateProject(r.projectId, r.tab, r.hypothesisId, r.nodeId, true); }

onMounted(() => { try { const saved = sessionStorage.getItem("flowmaster.connection") || localStorage.getItem("flowmaster.connection"); if (saved) connect(JSON.parse(saved), false); } catch { message("无法读取已保存的连接，请重新连接工作区。"); } });
onBeforeUnmount(() => { clearTimeout(noticeTimer); clearTimeout(projectSearchTimer); clearTimeout(flowSearchTimer); clearTimeout(resourceSearchTimer); clearDrafts(); });
</script>

<template>
  <a class="skip" href="#main" @click.prevent="mainElement?.focus()">跳到内容</a>
  <header v-show="!focused" class="app-header"><a class="brand" href="#projects"><span class="logo">F</span>FlowMaster</a><nav class="main-nav" aria-label="主导航"><a href="#projects" :class="{active:route.page!=='settings'}" :aria-current="route.page!=='settings'?'page':undefined">项目</a><a href="#settings" :class="{active:route.page==='settings'}" :aria-current="route.page==='settings'?'page':undefined">连接与设置</a></nav><div id="connection"><span v-if="connection" class="connection-status badge verified">已连接工作区</span><span v-else class="muted">{{connecting?'正在恢复连接…':'未连接'}}</span><UiButton v-if="connection" @click="disconnect">退出</UiButton></div></header>
  <div class="shell">
    <main ref="mainElement" id="main" tabindex="-1" :class="{workbench:route.page==='project'&&route.tab==='flows','focus-mode':focused}">
      <ProjectList v-if="route.page==='projects'" :projects="projects" :query="projectQuery" :total="projectsTotal" :offset="projectsOffset" :next-offset="projectsNextOffset" :error="errors.projects" @filter="searchProjects" @page="loadProjects" :connected="!!connection" :loading="loading.projects||connecting" :exporting="loading.export" @create="editProject()" @edit="editProject" @remove="removeProject" @open="navigateProject($event.id)" @settings="go('settings')" @export="exportWorkspace" @refresh="loadProjects(projectsOffset)"/>
      <ConnectionSettings v-else-if="route.page==='settings'" :key="connection?.baseUrl||'local'" :connection="connection" :connecting="connecting" :tokens="tokens" :tokens-loading="loading.tokens" :settings-error="settingsError" :docs-open="route.docs" :pending-token-id="pendingTokenId" @connect="connect" @disconnect="disconnect" @create-token="createToken" @revoke-token="revokeToken" @refresh-tokens="readSettings" @seed="seed"/>
      <template v-else-if="currentProject&&connection">
        <div v-show="!focused" class="project-heading"><a href="#projects">← 全部项目</a><div class="toolbar"><div><h1>{{currentProject.name}}</h1><p class="muted">{{currentProject.description}}</p></div><UiButton @click="refreshProject" :busy="loading.project">刷新项目</UiButton></div></div>
        <div v-show="!focused" class="project-tabs" role="navigation" aria-label="项目内容"><button v-for="[tab,label] in [['flows','流程'],['records','记录'],['resources','资料']]" :key="tab" :class="{active:route.tab===tab}" :aria-current="route.tab===tab?'page':undefined" @click="setProjectTab(tab)">{{label}}</button><span class="muted">当前项目：{{currentProject.name}}</span></div>
        <p v-if="errors.project" class="form-error">{{errors.project}} <UiButton @click="refreshProject">重新读取</UiButton></p>
        <ProjectWorkspace :key="currentProject.id" v-if="route.tab==='flows'" :project="currentProject" :hypotheses="hypotheses" :current="current" :selected-id="selectedNode?.id" :busy="canvasBusy" :loading="loading.hypotheses||loading.project" :query="flowQuery" :total="hypothesesTotal" :offset="hypothesesOffset" :next-offset="hypothesesNextOffset" :error="errors.hypotheses" @filter="searchFlows" @page="loadFlows" @focus="focused=$event" @create-flow="editFlow()" @edit-flow="editFlow" @remove-flow="removeFlow" @select-flow="selectFlow" @select-node="selectNode" @add-node="addNode" @move-node="moveNode" @layout="layout">
          <StepInspector v-if="nodeDraft&&selectedNode&&current" :draft="nodeDraft" :node="selectedNode" :hypothesis="current" v-model:upstream="upstream" :dirty="nodeDirty" :conflicted="nodeConflicted" :resources="projectResources" :visible-resources="resources" :resource-query="resourceQuery" :resource-total="resourcesTotal" :resource-offset="resourcesOffset" :resource-next-offset="resourcesNextOffset" :resource-loading="loading.resources" :resource-error="errors.resources" @resource-filter="searchResources" @resource-page="loadResources" :history="nodeHistory" :history-total="nodeHistoryTotal" :history-next-offset="nodeHistoryNextOffset" :history-offset="historyOffset" :history-limit="historyLimit" :history-loading="loading.nodeHistory" :history-error="errors.nodeHistory" :saving="canvasBusy" :current-result="currentResult" :result-loading="resultLoading" :pending-record-id="pendingRecordId" @save="saveNode" @remove="removeNode" @new-record="recordForm()" @edit-record="recordForm" @remove-record="removeRecord" @show-record="showRecord" @history-page="loadHistory" @select-result="selectResult" @resources="setProjectTab('resources')" @reload-result="loadCurrentResult(true)"/>
        </ProjectWorkspace>
        <ProjectRecords :key="currentProject.id" v-else-if="route.tab==='records'" :project="currentProject" :hypotheses="projectFlows" :visible-hypotheses="hypotheses" :hypothesis-query="flowQuery" :hypothesis-total="hypothesesTotal" :hypothesis-offset="hypothesesOffset" :hypothesis-next-offset="hypothesesNextOffset" :hypothesis-loading="loading.hypotheses" @hypothesis-filter="searchFlows" @hypothesis-page="loadFlows" :records="records" :total="recordsTotal" :offset="recordOffset" :next-offset="recordsNextOffset" :limit="recordLimit" :loading="loading.records" :error="errors.records" :exporting="loading.export" :pending-id="pendingRecordId" :filters="recordFilters" @filter="filterRecords" @page="loadRecords" @create="recordForm()" @show="showRecord" @edit="recordForm" @remove="removeRecord" @jump="jumpToRecord" @export="exportRecords"/>
        <ProjectResources :key="currentProject.id" v-else :project="currentProject" :resources="resources" :loading="loading.resources" :query="resourceQuery" :total="resourcesTotal" :offset="resourcesOffset" :next-offset="resourcesNextOffset" :error="errors.resources" @filter="searchResources" @page="loadResources" :pending-id="pendingResourceId" @create="editResource()" @edit="editResource" @remove="removeResource"/>
      </template>
      <section v-else class="panel empty"><h1>{{connecting?'正在恢复工作区…':connection?'正在读取项目或暂时无法读取':'请先连接工作区'}}</h1><p>连接后会打开指定的项目与步骤。</p><UiButton v-if="connection" @click="retryProject" :busy="loading.project">重新读取项目</UiButton><UiButton v-else-if="!connecting" @click="go('settings')">前往连接与设置</UiButton></section>
      <p v-if="errors.projects" class="form-error">{{errors.projects}}</p>
    </main>
  </div>
  <div id="notice" role="status" aria-live="polite">{{notice}}</div>
  <UiModal v-if="modal" :title="modal.title" :busy="modalBusy" @close="closeModal"><p v-if="modal.description" class="muted">{{modal.description}}</p><p v-if="modal.error" class="form-error" role="alert">{{modal.error}}</p>
    <form v-if="modal.kind==='form'" @submit.prevent="submitModal()"><UiField v-for="item in modal.fields" :key="item.key" :label="item.label"><textarea v-if="item.type==='textarea'" v-model="modal.value[item.key]" maxlength="16000"/><select v-else-if="item.type==='select'" v-model="modal.value[item.key]"><option v-for="option in item.options" :key="option.value" :value="option.value">{{option.label}}</option></select><input v-else v-model="modal.value[item.key]" :type="item.type" :maxlength="item.type==='url'?2000:200" :min="item.type==='number'?1:undefined" :max="item.type==='number'?365:undefined" :required="['title','name'].includes(item.key)"></UiField><div class="actions"><UiButton @click="closeModal" :busy="modalBusy">取消</UiButton><UiButton type="submit" variant="primary" :busy="modalBusy">保存</UiButton></div></form>
    <RecordForm v-else-if="modal.kind==='record'" :record="modal.record" :hypotheses="projectFlows" :visible-hypotheses="hypotheses" :hypothesis-query="flowQuery" :hypothesis-total="hypothesesTotal" :hypothesis-offset="hypothesesOffset" :hypothesis-next-offset="hypothesesNextOffset" :hypothesis-loading="loading.hypotheses" :hypothesis-error="errors.hypotheses" @hypothesis-filter="searchFlows" @hypothesis-page="loadFlows" :resources="projectResources" :visible-resources="resources" :resource-query="resourceQuery" :resource-total="resourcesTotal" :resource-offset="resourcesOffset" :resource-next-offset="resourcesNextOffset" :resource-loading="loading.resources" :resource-error="errors.resources" @resource-filter="searchResources" @resource-page="loadResources" :initial-hypothesis-id="modal.hypothesisId" :initial-node-id="modal.nodeId" :initial-title="modal.initialTitle" :busy="modalBusy" @submit="submitModal" @cancel="closeModal"/>
    <div v-else-if="modal.kind==='confirm'" class="actions"><UiButton @click="closeModal" :busy="modalBusy">取消</UiButton><UiButton variant="primary" @click="submitModal()" :busy="modalBusy">确认</UiButton></div>
    <div v-else-if="modal.kind==='record-detail'" class="record-detail"><span class="badge" :class="modal.record.status">{{resultStatuses[modal.record.status]}}</span><span v-if="modal.record.source==='agent'" class="badge">历史模型建议，不代表真实执行</span><p class="muted">记录时间：{{date(modal.record.recordedAt)}}{{modal.record.recordedAtInferred?'（由历史数据推断）':''}}</p><p v-if="modal.record.duration">实际耗时：{{modal.record.duration}}</p><p class="log">{{modal.record.summary}}</p><section v-if="modal.record.resourceIds?.length"><h3>关联资料</h3><p v-for="id in modal.record.resourceIds" :key="id"><a v-if="safeUrl(projectResources.find(r=>r.id===id)?.url)" :href="safeUrl(projectResources.find(r=>r.id===id)?.url)" target="_blank" rel="noopener noreferrer">{{projectResources.find(r=>r.id===id)?.name}} ↗</a><span v-else>{{projectResources.find(r=>r.id===id)?.name||'资料名称暂不可用'}}</span></p></section><details v-if="modal.record.logs?.length"><summary>记录日志</summary><p v-for="(log,index) in modal.record.logs" :key="index" class="log"><small>{{log.time}}</small><br>{{log.message}}</p></details><div class="actions"><UiButton @click="jumpToRecord(modal.record)">打开所属步骤</UiButton><UiButton @click="recordForm(modal.record)">修正记录</UiButton><UiButton @click="download(modal.record,'flowmaster-record.json')">导出此记录</UiButton></div></div>
    <div v-else-if="modal.kind==='token'"><textarea readonly :value="modal.token" aria-label="新建 Token"/><div class="actions"><UiButton @click="closeModal">我已保存，关闭</UiButton></div></div>
  </UiModal>
</template>
