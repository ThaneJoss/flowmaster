<script setup>
import { computed, ref } from "vue";
import UiButton from "./UiButton.vue";
const props = defineProps({ projects: Array, connected: Boolean, loading: Boolean, exporting: Boolean });
const emit = defineEmits(["create", "edit", "remove", "open", "settings", "export", "refresh"]);
const search = ref("");
const visible = computed(() => props.projects.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(search.value.toLowerCase())));
const date = value => value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
</script>
<template>
  <div class="toolbar">
    <div><h1>项目</h1><p class="muted">进入一个项目，组织流程、记录每次执行并关联资料。</p></div>
    <div v-if="connected" class="row"><UiButton @click="emit('refresh')" :busy="loading">刷新项目</UiButton><UiButton @click="emit('export')" :busy="exporting">导出完整工作区</UiButton><UiButton variant="primary" @click="emit('create')">新建项目</UiButton></div>
  </div>
  <section v-if="!connected" class="panel empty"><h2>连接你的工作区</h2><p>连接后即可新建项目或继续已有研究。</p><UiButton variant="primary" @click="emit('settings')">前往连接与设置</UiButton></section>
  <template v-else>
    <input v-if="projects.length" v-model="search" class="project-search" placeholder="查找项目" aria-label="查找项目">
    <p v-if="loading" role="status">正在读取项目…</p>
    <div class="cards project-cards"><article v-for="p in visible" :key="p.id" class="card"><h2><button class="text-button" @click="emit('open',p)">{{p.name}}</button></h2><p>{{p.description||'尚未填写项目说明'}}</p><small>更新于 {{date(p.updatedAt)}}</small><div class="actions"><UiButton variant="primary" @click="emit('open',p)">进入项目</UiButton><UiButton @click="emit('edit',p)">编辑</UiButton><UiButton variant="danger" @click="emit('remove',p)">删除</UiButton></div></article></div>
    <section v-if="!projects.length&&!loading" class="panel empty"><h2>创建第一个项目</h2><p>项目内可以建立多个流程，每个步骤都能留下执行记录。</p><UiButton variant="primary" @click="emit('create')">新建项目</UiButton></section>
    <p v-else-if="!visible.length&&!loading" class="panel empty">没有匹配的项目。</p>
  </template>
</template>
