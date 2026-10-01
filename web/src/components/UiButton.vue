<script setup>
defineProps({ variant: { type: String, default: "" }, busy: Boolean });
</script>
<template><button :class="variant" :disabled="busy"><slot /></button></template>
