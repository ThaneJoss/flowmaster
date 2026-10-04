<script setup>
import { computed, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
const props = defineProps({ total: Number, offset: { type: Number, default: 0 }, nextOffset: { type: Number, default: null }, count: { type: Number, default: 0 }, loading: Boolean, label: { type: String, default: "列表分页" } });
const emit = defineEmits(["page"]);
// Follow server cursors: byte limits can shorten pages below the requested limit.
const visited = ref([0]);
watch(() => props.offset, (offset, previous) => {
  if (offset === 0) visited.value = [0];
  else visited.value = [...new Set([...visited.value.filter(value => value < offset), previous, offset].filter(value => Number.isInteger(value) && value <= offset))].sort((a, b) => a - b);
});
const previousOffset = computed(() => visited.value.findLast(value => value < props.offset) ?? 0);
const previousLabel = computed(() => visited.value.includes(props.offset) ? "上一页" : "回到首页");
</script>
<template>
  <div class="pagination" :aria-label="label" :aria-busy="loading">
    <small>共 {{total ?? '—'}} 条<template v-if="count"> · {{offset + 1}}–{{offset + count}}</template><template v-if="loading"> · 加载中…</template></small>
    <UiButton v-if="offset > 0" @click="emit('page',previousOffset)" :busy="loading">{{previousLabel}}</UiButton>
    <UiButton v-if="nextOffset !== null" @click="emit('page',nextOffset)" :busy="loading">下一页</UiButton>
  </div>
</template>
