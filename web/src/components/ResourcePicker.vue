<script setup>
import { computed, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import PageControls from "./PageControls.vue";
const props = defineProps({ modelValue: { type: Array, default: () => [] }, resources: { type: Array, default: () => [] }, visibleResources: Array, disabled: Boolean, query: { type: String, default: "" }, total: Number, offset: Number, nextOffset: { type: Number, default: null }, loading: Boolean, error: String });
const emit = defineEmits(["update:modelValue", "filter", "page"]);
const search = ref(props.query);
watch(() => props.query, value => { search.value = value; });
const page = computed(() => props.visibleResources || props.resources);
const options = computed(() => [...new Map([...props.resources.filter(resource => props.modelValue.includes(resource.id)), ...page.value].map(resource => [resource.id, resource])).values()]);
const missing = computed(() => props.modelValue.filter(id => !props.resources.some(r => r.id === id)));
function toggle(id, checked) { emit("update:modelValue", checked ? [...new Set([...props.modelValue, id])] : props.modelValue.filter(value => value !== id)); }
</script>
<template>
  <fieldset class="resource-picker" :disabled="disabled"><legend>关联资料</legend>
    <div v-if="total !== undefined" class="collection-search"><input v-model="search" maxlength="200" aria-label="查找可关联资料" placeholder="查找资料" @keydown.enter.prevent="emit('filter',search)"><UiButton :busy="loading" @click="emit('filter',search)">查找</UiButton></div>
    <p v-if="error" class="form-error" role="alert">{{error}} <UiButton :busy="loading" @click="emit('page',offset)">重新读取</UiButton></p>
    <p v-if="!options.length&&!missing.length&&!loading" class="muted">{{query?'没有匹配的资料。':'暂无资料，可在当前项目的“资料”中添加。'}}</p>
    <div class="choice-list"><label v-for="r in options" :key="r.id" class="check"><input type="checkbox" :checked="modelValue.includes(r.id)" @change="toggle(r.id,$event.target.checked)">{{r.name}}</label><label v-for="id in missing" :key="id" class="check"><input type="checkbox" checked @change="toggle(id,$event.target.checked)">资料名称暂不可用 <small>{{id}}</small></label></div>
    <PageControls v-if="total !== undefined" :total="total" :offset="offset" :next-offset="nextOffset" :count="page.length" :loading="loading" label="关联资料分页" @page="emit('page',$event)"/>
  </fieldset>
</template>
