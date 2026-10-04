<script setup>
import { ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import PageControls from "./PageControls.vue";
const props = defineProps({ project: Object, resources: Array, pendingId: String, loading: Boolean, query: { type: String, default: "" }, total: Number, offset: Number, nextOffset: { type: Number, default: null }, error: String });
const emit = defineEmits(["create", "edit", "remove", "filter", "page"]);
const search = ref(props.query);
watch(() => props.query, value => { search.value = value; });
const types = { dataset: "数据集", model: "模型资料", document: "文档", code: "代码" };
const safeUrl = value => { try { const u = new URL(value); return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password ? u.href : null; } catch { return null; } };
</script>
<template>
  <div class="toolbar"><div><h2>项目资料</h2><p class="muted">{{project.name}} 的资料，可在步骤和执行记录中引用。</p></div><UiButton variant="primary" @click="emit('create')">添加资料</UiButton></div>
  <form class="collection-search" @submit.prevent="emit('filter',search)"><input v-model="search" maxlength="200" aria-label="查找项目资料" placeholder="查找资料"><UiButton type="submit" :busy="loading">查找</UiButton></form>
  <p v-if="error" class="form-error" role="alert">{{error}} <UiButton @click="emit('page',offset)" :busy="loading">重新读取</UiButton></p><p v-if="loading" role="status">正在读取资料…</p>
  <div class="cards resource-cards"><article v-for="r in resources" :key="r.id" class="card"><span class="badge">{{types[r.type]}}</span><h3>{{r.name}}</h3><p>{{r.description}}</p><a v-if="safeUrl(r.url)" :href="safeUrl(r.url)" target="_blank" rel="noopener noreferrer">打开资料 ↗</a><div class="actions"><UiButton @click="emit('edit',r)" :busy="pendingId===r.id">编辑</UiButton><UiButton variant="danger" @click="emit('remove',r)" :busy="pendingId===r.id">删除</UiButton></div></article></div>
  <section v-if="!resources.length&&!loading&&!error" class="panel empty"><template v-if="!query"><h3>为项目添加参考资料</h3><p>保存文档、代码或数据链接，并在步骤或执行记录中关联。</p><UiButton @click="emit('create')">添加资料</UiButton></template><p v-else>没有匹配的资料。</p></section>
  <PageControls :key="project.id" :total="total" :offset="offset" :next-offset="nextOffset" :count="resources.length" :loading="loading" label="资料分页" @page="emit('page',$event)"/>
</template>
