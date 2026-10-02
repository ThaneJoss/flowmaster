<script setup>
import { ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import RecordList from "./RecordList.vue";
const props = defineProps({ project: Object, hypotheses: Array, records: Array, total: Number, offset: Number, limit: Number, loading: Boolean, error: String, exporting: Boolean, pendingId: String, filters: Object });
const emit = defineEmits(["filter", "page", "create", "show", "edit", "remove", "jump", "export"]);
const query = ref(props.filters.q || "");
const status = ref(props.filters.status || "");
const flow = ref(props.filters.hypothesisId || "");
watch(() => props.filters, value => { query.value = value.q || ""; status.value = value.status || ""; flow.value = value.hypothesisId || ""; });
function filter() { emit("filter", { q: query.value, status: status.value, hypothesisId: flow.value }); }
</script>
<template>
  <section class="panel"><div class="toolbar"><div><h2>执行记录</h2><p class="muted">当前范围：{{project.name}} · 按记录时间查看每次执行</p></div><div class="row"><UiButton @click="emit('export')" :busy="exporting">导出筛选结果（全部页）</UiButton><UiButton variant="primary" @click="emit('create')" :busy="!hypotheses.some(h=>h.nodes.length)">记录一次执行</UiButton></div></div>
    <form class="record-filters" @submit.prevent="filter"><input v-model="query" aria-label="搜索当前项目执行记录" placeholder="搜索标题或摘要"><select v-model="status" aria-label="筛选结果判定" @change="filter"><option value="">全部结果</option><option value="pending">待判定</option><option value="running">判定中</option><option value="verified">已验证</option><option value="rejected">未通过</option></select><select v-model="flow" aria-label="筛选流程" @change="filter"><option value="">全部流程</option><option v-for="h in hypotheses" :key="h.id" :value="h.id">{{h.title}}</option></select><UiButton type="submit" :busy="loading">查找</UiButton></form>
    <p v-if="error" class="form-error">{{error}} <UiButton @click="emit('page',offset)">重新读取</UiButton></p>
    <RecordList :records="records" :total="total" :offset="offset" :limit="limit" :loading="loading" :hypotheses="hypotheses" :pending-id="pendingId" @page="emit('page',$event)" @show="emit('show',$event)" @edit="emit('edit',$event)" @remove="emit('remove',$event)" @jump="emit('jump',$event)"/>
  </section>
</template>
