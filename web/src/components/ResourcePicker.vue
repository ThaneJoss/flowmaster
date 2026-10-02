<script setup>
import { computed } from "vue";
const props = defineProps({ modelValue: { type: Array, default: () => [] }, resources: { type: Array, default: () => [] }, disabled: Boolean });
const emit = defineEmits(["update:modelValue"]);
const missing = computed(() => props.modelValue.filter(id => !props.resources.some(r => r.id === id)));
function toggle(id, checked) { emit("update:modelValue", checked ? [...new Set([...props.modelValue, id])] : props.modelValue.filter(value => value !== id)); }
</script>
<template>
  <fieldset class="resource-picker" :disabled="disabled"><legend>关联资料</legend><p v-if="!resources.length&&!missing.length" class="muted">暂无资料，可在当前项目的“资料”中添加。</p><label v-for="r in resources" :key="r.id" class="check"><input type="checkbox" :checked="modelValue.includes(r.id)" @change="toggle(r.id,$event.target.checked)">{{r.name}}</label><label v-for="id in missing" :key="id" class="check"><input type="checkbox" checked @change="toggle(id,$event.target.checked)">已不可用的资料 <small>{{id}}</small></label></fieldset>
</template>
