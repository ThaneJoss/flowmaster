<script setup>
import { computed } from "vue";
const props = defineProps({
  value: { default: "" },
  placeholder: { type: String, default: "未填写" },
  code: Boolean,
  limit: { type: Number, default: 720 },
});
const text = computed(() => {
  if (props.value === null || props.value === undefined) return "";
  if (typeof props.value === "string") return props.value;
  if (typeof props.value === "object") {
    try { return JSON.stringify(props.value, null, 2); } catch { return String(props.value); }
  }
  return String(props.value);
});
const hasText = computed(() => text.value.trim().length > 0);
const long = computed(() => text.value.length > props.limit || text.value.split("\n").length > 12);
const preview = computed(() => text.value.split("\n").slice(0, 5).join("\n").slice(0, Math.min(props.limit, 260)).trimEnd());
</script>

<template>
  <div class="node-text" :class="{ 'node-text--code': code }">
    <p v-if="!hasText" class="node-text__empty">{{placeholder}}</p>
    <details v-else-if="long" :key="text" class="node-text__disclosure">
      <summary><span class="node-text__preview">{{preview}}…</span><span class="node-text__toggle"><span class="node-text__expand">展开完整内容</span><span class="node-text__collapse">收起内容</span><span aria-hidden="true"> ↕</span></span></summary>
      <pre v-if="code" class="node-text__content">{{text}}</pre>
      <p v-else class="node-text__content">{{text}}</p>
    </details>
    <pre v-else-if="code" class="node-text__content">{{text}}</pre>
    <p v-else class="node-text__content">{{text}}</p>
  </div>
</template>

<style scoped>
.node-text{min-width:0;max-width:100%;font-size:13px;line-height:1.8;color:inherit}
.node-text__content,.node-text__preview{margin:0;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;tab-size:2}
.node-text__empty{margin:0;color:#8a94a5;font-size:12px;font-style:normal}
.node-text--code{padding:13px 14px;border:1px solid #e4e9f0;border-radius:10px;background:#f7f9fc;color:#37465d}
.node-text--code .node-text__content,.node-text--code .node-text__preview{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;line-height:1.8}
.node-text__disclosure{min-width:0}
.node-text__disclosure>summary{display:block;list-style:none;cursor:pointer;border-radius:4px}
.node-text__disclosure>summary::-webkit-details-marker{display:none}
.node-text__disclosure>summary:focus-visible{outline:2px solid #2563eb;outline-offset:5px}
.node-text__preview{display:block}
.node-text__toggle{display:block;margin-top:8px;color:#426393;font-size:11px;font-weight:600;line-height:1.6}
.node-text__collapse{display:none}
.node-text__disclosure[open] .node-text__preview,.node-text__disclosure[open] .node-text__expand{display:none}
.node-text__disclosure[open] .node-text__collapse{display:inline}
.node-text__disclosure[open] .node-text__toggle{margin:0 0 10px}
</style>
