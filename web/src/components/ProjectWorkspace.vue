<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import FlowCanvas from "./FlowCanvas.vue";
import NodeDrawer from "./NodeDrawer.vue";
import PageControls from "./PageControls.vue";
const props = defineProps({ project: Object, hypotheses: Array, current: Object, selectedId: String, busy: Boolean, loading: Boolean, query: { type: String, default: "" }, total: Number, offset: Number, nextOffset: { type: Number, default: null }, error: String });
const emit = defineEmits(["create-flow", "edit-flow", "remove-flow", "select-flow", "select-node", "add-node", "move-node", "layout", "filter", "page", "focus"]);
const search = ref(props.query), focused = ref(false), sidebarOpen = ref(true), inspectorOpen = ref(!!props.selectedId), descriptionOpen = ref(false);
let canvasSelection = "", sidebarBeforeFocus = true;
watch(() => props.query, value => { search.value = value; });
watch(() => props.selectedId, id => { if (!id) inspectorOpen.value = false; else if (id !== canvasSelection) inspectorOpen.value = true; canvasSelection = ""; });
watch(() => props.current?.id, () => { descriptionOpen.value = false; });
function selectNode(id) { canvasSelection = id; emit("select-node", id); }
function inspectNode(id) { emit("select-node", id); inspectorOpen.value = true; }
function toggleFocus(value) {
  focused.value = value;
  if (value) { sidebarBeforeFocus = sidebarOpen.value; sidebarOpen.value = false; inspectorOpen.value = false; }
  else sidebarOpen.value = sidebarBeforeFocus;
  emit("focus", value);
}
function selectedNodeElement() { return [...document.querySelectorAll(".node[data-node-id]")].find(element => element.dataset.nodeId === props.selectedId); }
function escape(event) {
  if (event.key === "Escape" && focused.value && !event.defaultPrevented && !event.isComposing && !document.querySelector("dialog[open]")) { event.preventDefault(); toggleFocus(false); }
}
window.addEventListener("keydown", escape);
onBeforeUnmount(() => { window.removeEventListener("keydown", escape); if (focused.value) emit("focus", false); });
</script>
<template>
  <div class="workspace-heading"><div class="row"><UiButton class="sidebar-toggle" :aria-expanded="sidebarOpen" aria-controls="hypothesis-list" @click="sidebarOpen=!sidebarOpen"><span aria-hidden="true">☷</span> {{sidebarOpen?'收起列表':'流程列表'}}</UiButton><h2>{{focused?'研究画布':'研究流程'}}</h2></div><div v-if="!focused" class="workspace-stats"><span><b>{{total ?? '—'}}</b> 匹配流程</span></div></div>
  <div class="workspace" :class="{'sidebar-open':sidebarOpen}">
    <aside v-if="sidebarOpen" id="hypothesis-list" class="hypothesis-sidebar flow-list" aria-label="流程列表">
      <div class="sidebar-heading"><h2>流程 <span>{{total ?? '—'}}</span></h2><UiButton @click="emit('create-flow')" aria-label="新建流程">＋</UiButton></div>
      <form class="sidebar-filters collection-search" @submit.prevent="emit('filter',search)"><input v-model="search" maxlength="200" aria-label="查找当前项目流程" placeholder="查找流程"><UiButton type="submit" :busy="loading">查找</UiButton></form>
      <div class="hypothesis-items"><button v-for="h in hypotheses" :key="h.id" class="hypothesis-item item" :class="{selected:current?.id===h.id}" :aria-current="current?.id===h.id?'true':undefined" :title="h.title" @click="emit('select-flow',h.id)"><strong>{{h.title}}</strong><small>{{h.nodes.length}} 个步骤</small></button><p v-if="!hypotheses.length&&!loading" class="empty">{{query?'没有匹配的流程':'还没有流程'}}</p>
        <p v-if="error" class="form-error" role="alert">{{error}} <UiButton @click="emit('page',offset)" :busy="loading">重新读取</UiButton></p>
        <PageControls :key="project.id" :total="total" :offset="offset" :next-offset="nextOffset" :count="hypotheses.length" :loading="loading" label="流程分页" @page="emit('page',$event)"/>
      </div>
    </aside>
    <div v-if="current" class="flow-main">
      <section class="flow-heading" aria-label="当前研究流程"><div class="flow-title-row"><div class="flow-title"><div class="flow-breadcrumb"><span>{{project.name}}</span><span aria-hidden="true">/</span><span>研究流程</span></div><h2>{{current.title}}</h2></div><div class="flow-actions"><UiButton @click="emit('edit-flow',current)" :busy="busy">编辑流程</UiButton><details class="hypothesis-menu"><summary aria-label="更多流程操作">•••</summary><div><UiButton variant="danger" @click="emit('remove-flow',current)" :busy="busy">删除流程</UiButton></div></details></div></div>
        <div v-if="!focused&&(current.baseline||current.description)" class="flow-context"><span v-if="current.baseline" class="baseline" :title="current.baseline"><b>基线</b> {{current.baseline}}</span><button v-if="current.description" class="text-button" :aria-expanded="descriptionOpen" @click="descriptionOpen=!descriptionOpen">流程说明 {{descriptionOpen?'↑':'↓'}}</button></div><p v-if="descriptionOpen&&!focused" class="log research-description">{{current.description}}</p>
      </section>
      <FlowCanvas :key="current.id" :hypothesis="current" :selected-id="selectedId" :busy="busy" :focused="focused" @select="selectNode" @inspect="inspectNode" @focus="toggleFocus" @move="emit('move-node',$event)" @add="emit('add-node',$event)" @layout="emit('layout',$event)"/>
      <button v-if="selectedId&&!inspectorOpen" class="selected-node-hint" @click="inspectorOpen=true"><span class="selection-dot"/>已选中：<strong>{{current.nodes.find(node=>node.id===selectedId)?.title}}</strong><span>查看详情 →</span></button>
    </div>
    <section v-else class="panel empty"><template v-if="loading"><p role="status">正在读取项目流程…</p></template><template v-else><h2>为 {{project.name}} 创建流程</h2><p>先写清目标，再逐步添加步骤和执行记录。</p><UiButton variant="primary" @click="emit('create-flow')">新建流程</UiButton></template></section>
  </div>
  <NodeDrawer v-if="inspectorOpen&&selectedId&&current" title="步骤详情" :content-key="selectedId" :return-focus="selectedNodeElement" @close="inspectorOpen=false"><slot/></NodeDrawer>
</template>
