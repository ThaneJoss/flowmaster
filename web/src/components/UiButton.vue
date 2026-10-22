<script setup>
defineProps({ variant: { type: String, default: "" }, busy: Boolean, type: { type: /** @type {import("vue").PropType<"button" | "submit" | "reset">} */ (String), default: "button" } });
</script>
<template><button :type="type" :class="variant" :disabled="busy" :aria-busy="busy||undefined"><slot /></button></template>
