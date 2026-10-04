<script setup>
import { ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import PageControls from "./PageControls.vue";
const props = defineProps({ projects: Array, connected: Boolean, loading: Boolean, exporting: Boolean, query: { type: String, default: "" }, total: Number, offset: Number, nextOffset: { type: Number, default: null }, error: String });
const emit = defineEmits(["create", "edit", "remove", "open", "settings", "export", "refresh", "filter", "page"]);
const search = ref(props.query);
watch(() => props.query, value => { search.value = value; });
const date = value => value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
</script>
<template>
  <div class="toolbar page-heading">
    <div><h1>项目</h1><p class="muted">进入一个项目，组织流程、记录每次执行并关联资料。</p></div>
    <div v-if="connected" class="row"><UiButton @click="emit('refresh')" :busy="loading">刷新项目</UiButton><UiButton @click="emit('export')" :busy="exporting">导出完整工作区</UiButton><UiButton variant="primary" @click="emit('create')">新建项目</UiButton></div>
  </div>
  <section v-if="!connected" class="panel empty"><h2>连接你的工作区</h2><p>连接后即可新建项目或继续已有研究。</p><UiButton variant="primary" @click="emit('settings')">前往连接与设置</UiButton></section>
  <template v-else>
    <form class="collection-search" @submit.prevent="emit('filter',search)"><input v-model="search" maxlength="200" placeholder="查找项目" aria-label="查找项目"><UiButton type="submit" :busy="loading">查找</UiButton></form>
    <p v-if="error" class="form-error" role="alert">{{error}} <UiButton @click="emit('refresh')" :busy="loading">重新读取</UiButton></p>
    <p v-if="loading" role="status">正在读取项目…</p>
    <div class="cards project-cards"><article v-for="p in projects" :key="p.id" class="card"><h2><button class="text-button" @click="emit('open',p)">{{p.name}}</button></h2><p>{{p.description||'尚未填写项目说明'}}</p><small>更新于 {{date(p.updatedAt)}}</small><div class="actions"><UiButton variant="primary" @click="emit('open',p)">进入项目</UiButton><UiButton @click="emit('edit',p)">编辑</UiButton><UiButton variant="danger" @click="emit('remove',p)">删除</UiButton></div></article></div>
    <section v-if="!projects.length&&!loading&&!error" class="panel empty"><template v-if="!query"><h2>创建第一个项目</h2><p>项目内可以建立多个流程，每个步骤都能留下执行记录。</p><UiButton variant="primary" @click="emit('create')">新建项目</UiButton></template><p v-else>没有匹配的项目。</p></section>
    <PageControls :total="total" :offset="offset" :next-offset="nextOffset" :count="projects.length" :loading="loading" label="项目分页" @page="emit('page',$event)"/>
  </template>
</template>
