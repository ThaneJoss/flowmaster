<script setup>
import { onMounted, onBeforeUnmount, ref } from "vue";
const props=defineProps({ title: String, busy: Boolean });
const emit = defineEmits(["close"]);
const dialog = ref(null);
const onCancel = (event) => { event.preventDefault(); if(!props.busy)emit("close"); };
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<template><dialog ref="dialog" class="ui-modal" aria-labelledby="modal-title" @cancel="onCancel"><div class="toolbar"><h2 id="modal-title">{{ title }}</h2><button type="button" aria-label="关闭" :disabled="busy" @click="emit('close')">×</button></div><slot/></dialog></template>
