<script setup>
import { computed, ref } from "vue";
import UiButton from "./UiButton.vue";
import FlowCanvas from "./FlowCanvas.vue";
const props = defineProps({ project: Object, hypotheses: Array, current: Object, selectedId: String, busy: Boolean, loading: Boolean });
const emit = defineEmits(["create-flow", "edit-flow", "remove-flow", "select-flow", "select-node", "add-node", "move-node", "layout"]);
const search = ref("");
const visible = computed(() => props.hypotheses.filter(h => `${h.title} ${h.description}`.toLowerCase().includes(search.value.toLowerCase())));
</script>
<template>
  <div v-if="loading" class="panel" role="status">正在读取项目流程…</div>
  <div v-else class="workspace" :class="{'without-inspector':!selectedId}">
    <aside class="panel flow-list"><div class="toolbar"><h2>流程</h2><UiButton @click="emit('create-flow')" aria-label="新建流程">＋</UiButton></div><input v-model="search" aria-label="查找当前项目流程" placeholder="查找流程"><div class="list"><button v-for="h in visible" :key="h.id" class="item" :class="{selected:current?.id===h.id}" @click="emit('select-flow',h.id)"><strong>{{h.title}}</strong><small>{{h.nodes.length}} 个步骤</small></button><p v-if="!visible.length" class="muted">{{hypotheses.length?'没有匹配的流程':'还没有流程'}}</p></div></aside>
    <div v-if="current" class="stack"><section class="panel"><div class="toolbar"><div><h2>{{current.title}}</h2><p class="muted">{{current.description||'为这个流程添加说明，让执行目标更清楚。'}}</p></div><div class="row"><UiButton @click="emit('edit-flow',current)" :busy="busy">编辑流程</UiButton><UiButton variant="danger" @click="emit('remove-flow',current)" :busy="busy">删除流程</UiButton></div></div><p v-if="current.baseline" class="muted">基线：{{current.baseline}}</p></section><FlowCanvas :key="current.id" :hypothesis="current" :selected-id="selectedId" :busy="busy" @select="emit('select-node',$event)" @move="emit('move-node',$event)" @add="emit('add-node',$event)" @layout="emit('layout',$event)"/><p v-if="!selectedId&&current.nodes.length" class="muted">选择一个步骤，查看目标、当前结果与执行历史。</p></div>
    <section v-else class="panel empty"><h2>为 {{project.name}} 创建第一个流程</h2><p>先写清目标，再逐步添加步骤和执行记录。</p><UiButton variant="primary" @click="emit('create-flow')">新建流程</UiButton></section>
    <slot/>
  </div>
</template>
