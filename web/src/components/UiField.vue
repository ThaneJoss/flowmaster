<script setup>
defineProps({ label: String, hint: String });
</script>
<template><label class="field"><span>{{ label }}</span><slot/><small v-if="hint">{{ hint }}</small></label></template>
