<script setup>
import { computed, ref } from "vue";
import UiButton from "./UiButton.vue";
const props = defineProps({ project: Object, resources: Array, pendingId: String, loading: Boolean });
const emit = defineEmits(["create", "edit", "remove"]);
const query = ref("");
const visible = computed(() => props.resources.filter(r => `${r.name} ${r.description}`.toLowerCase().includes(query.value.toLowerCase())));
const types = { dataset: "数据集", model: "模型资料", document: "文档", code: "代码" };
const safeUrl = value => { try { const u = new URL(value); return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password ? u.href : null; } catch { return null; } };
</script>
<template>
  <div class="toolbar"><div><h2>项目资料</h2><p class="muted">{{project.name}} 的资料，可在步骤和执行记录中引用。</p></div><UiButton variant="primary" @click="emit('create')">添加资料</UiButton></div><input v-model="query" class="project-search" aria-label="查找项目资料" placeholder="查找资料"><p v-if="loading" role="status">正在读取资料…</p>
  <div class="cards"><article v-for="r in visible" :key="r.id" class="card"><span class="badge">{{types[r.type]}}</span><h3>{{r.name}}</h3><p>{{r.description}}</p><a v-if="safeUrl(r.url)" :href="safeUrl(r.url)" target="_blank" rel="noopener noreferrer">打开资料 ↗</a><div class="actions"><UiButton @click="emit('edit',r)" :busy="pendingId===r.id">编辑</UiButton><UiButton variant="danger" @click="emit('remove',r)" :busy="pendingId===r.id">删除</UiButton></div></article></div><section v-if="!resources.length&&!loading" class="panel empty"><h3>为项目添加参考资料</h3><p>保存文档、代码或数据链接，并在步骤或执行记录中关联。</p><UiButton @click="emit('create')">添加资料</UiButton></section><p v-else-if="!visible.length&&!loading" class="panel empty">没有匹配的资料。</p>
</template>
