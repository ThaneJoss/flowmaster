<script setup>
import UiButton from "./UiButton.vue";
defineProps({page:{type:Object,required:true},count:{type:Number,required:true},label:{type:String,default:"列表分页"}});
const emit=defineEmits(["more","retry"]);
</script>
<template>
  <div class="collection-pager" :aria-label="label" :aria-busy="page.loading">
    <span class="muted">已加载 {{count}}<template v-if="page.total!==null"> / 共 {{page.total}}</template><template v-if="page.loading"> · 加载中…</template></span>
    <p v-if="page.error" class="form-error" role="alert">{{page.error}}</p>
    <UiButton v-if="page.error||page.stale" :busy="page.loading" @click="emit('retry')">重新加载</UiButton>
    <UiButton v-else-if="page.nextOffset!==null" :busy="page.loading" @click="emit('more')">加载更多</UiButton>
  </div>
</template>
<style scoped>
.collection-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:12px 0;font-size:12px}.collection-pager .form-error{flex-basis:100%;margin:0;overflow-wrap:anywhere}.collection-pager :deep(button){font-size:12px}
</style>
