<script setup>
import { computed } from "vue";
import UiField from "./UiField.vue";
import UiButton from "./UiButton.vue";
import ResourcePicker from "./ResourcePicker.vue";
import RecordList from "./RecordList.vue";
const props = defineProps({ draft: Object, node: Object, hypothesis: Object, upstream: Array, dirty: Boolean, conflicted: Boolean, resources: Array, visibleResources: Array, resourceQuery: String, resourceTotal: Number, resourceOffset: Number, resourceNextOffset: { type: Number, default: null }, resourceLoading: Boolean, resourceError: String, history: Array, historyTotal: Number, historyOffset: Number, historyLimit: Number, historyNextOffset: { type: Number, default: null }, historyLoading: Boolean, historyError: String, saving: Boolean, currentResult: Object, resultLoading: Boolean, pendingRecordId: String });
const emit = defineEmits(["update:upstream", "save", "remove", "new-record", "edit-record", "remove-record", "show-record", "history-page", "select-result", "resources", "reload-result", "resource-filter", "resource-page"]);
const types = { baseline: "基线", observation: "观察", hypothesis: "假设", experiment: "实验", conclusion: "结论" };
const statuses = { pending: "待判定", running: "判定中", verified: "已验证", rejected: "未通过" };
const progress = { pending: "待开始", in_progress: "进行中", completed: "已完成" };
const parents = computed(() => props.hypothesis.nodes.filter(n => n.id !== props.node.id));
const advanced = computed(() => {
  const fields = [["inputs", "输入"], ["method", "研究方法"]];
  if (["baseline", "experiment", "observation"].includes(props.draft.type)) fields.push(["output", "输出说明"]);
  if (["conclusion", "hypothesis", "experiment"].includes(props.draft.type)) fields.push(["conclusion", "研究结论"]);
  fields.push(["nextAction", "后续行动"]);
  return fields;
});
function toggleParent(id, checked) { emit("update:upstream", checked ? [...new Set([...props.upstream, id])] : props.upstream.filter(value => value !== id)); }
const date = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录";
</script>
<template>
  <section class="inspector">
    <div class="toolbar"><h2>步骤详情</h2><UiButton variant="danger" @click="emit('remove')" :busy="saving">删除步骤</UiButton></div>
    <p v-if="dirty" class="unsaved" role="status">有未保存的修改；切换项目、流程或步骤会保留，刷新页面或退出后丢失。</p>
    <p v-if="conflicted" class="form-error">服务端也修改了草稿字段，保存前请核对。</p>
    <form @submit.prevent="emit('save')">
      <UiField label="步骤标题"><input v-model="draft.title" required maxlength="200"></UiField>
      <UiField label="目标 / 说明"><textarea v-model="draft.rationale" maxlength="16000" placeholder="这一步希望完成什么？"/></UiField>
      <div class="form-grid"><UiField label="步骤类型"><select v-model="draft.type" aria-label="步骤类型"><option v-for="(label,key) in types" :key="key" :value="key">{{label}}</option></select></UiField><UiField label="执行进度"><select v-model="draft.progress" aria-label="执行进度"><option :value="undefined" disabled>未设置</option><option v-for="(label,key) in progress" :key="key" :value="key">{{label}}</option></select></UiField></div>
      <UiField label="开始时间（可选）" hint="保留实际开始时间；新增或修正执行记录不会改写它。"><input v-model="draft.startedAt" maxlength="100" placeholder="例如 2026-10-02 09:30"></UiField>
      <details v-if="parents.length" class="form-section"><summary>依赖步骤 <small>{{upstream.length}} 项</small></summary><div class="choice-list"><label v-for="parent in parents" :key="parent.id" class="check"><input type="checkbox" :checked="upstream.includes(parent.id)" @change="toggleParent(parent.id,$event.target.checked)">{{parent.title}}</label></div></details>
      <details class="form-section"><summary>研究细节（可选）</summary><UiField v-for="[key,label] in advanced" :key="key" :label="label"><textarea v-model="draft[key]" maxlength="16000"/></UiField></details>
      <details class="form-section"><summary>关联资料 <small>{{draft.resourceIds?.length||0}} 项</small></summary><ResourcePicker v-model="draft.resourceIds" :resources="resources" :visible-resources="visibleResources" :query="resourceQuery" :total="resourceTotal" :offset="resourceOffset" :next-offset="resourceNextOffset" :loading="resourceLoading" :error="resourceError" @filter="emit('resource-filter',$event)" @page="emit('resource-page',$event)"/><UiButton @click="emit('resources')">管理项目资料</UiButton></details>
      <div class="actions"><UiButton type="submit" variant="primary" :busy="saving">保存步骤</UiButton></div>
    </form>
    <section class="current-result"><div class="toolbar"><h3>当前结果</h3><UiButton variant="primary" @click="emit('new-record')" :busy="saving">记录一次执行</UiButton></div>
      <template v-if="node.currentResultId"><span class="badge" :class="node.status">{{statuses[node.status]}}</span><p class="log">{{node.summary||'未填写摘要'}}</p><small v-if="node.duration">耗时 {{node.duration}}</small><p v-if="currentResult" class="muted">{{date(currentResult.recordedAt)}}{{currentResult.recordedAtInferred?'（由历史数据推断）':''}}</p><UiButton v-if="currentResult" @click="emit('edit-record',currentResult)" :busy="pendingRecordId===currentResult.id">修正这条记录</UiButton><small v-else-if="resultLoading">正在读取当前记录…</small><UiButton v-else @click="emit('reload-result')">重新读取当前记录</UiButton></template>
      <template v-else-if="node.summary||node.duration||node.status!=='pending'"><p class="muted">历史步骤摘要，尚未关联执行记录。原内容已保留；新增执行记录后会显示新的当前结果。</p><span class="badge" :class="node.status">{{statuses[node.status]}}</span><p class="log">{{node.summary||'未填写摘要'}}</p><small v-if="node.duration">耗时 {{node.duration}}</small></template>
      <p v-else class="muted">还没有当前结果。记录一次执行，或从历史记录中选择真实执行结果。</p>
    </section>
    <section class="step-history"><h3>执行历史</h3><p v-if="historyError" class="form-error">{{historyError}} <UiButton @click="emit('history-page',historyOffset)">重新读取</UiButton></p><RecordList :key="node.id" :records="history" :total="historyTotal" :offset="historyOffset" :limit="historyLimit" :next-offset="historyNextOffset" :loading="historyLoading" :hypotheses="[hypothesis]" :current-result-id="node.currentResultId" :pending-id="pendingRecordId" node-mode @page="emit('history-page',$event)" @show="emit('show-record',$event)" @edit="emit('edit-record',$event)" @remove="emit('remove-record',$event)" @select-result="emit('select-result',$event)"/></section>
  </section>
</template>
