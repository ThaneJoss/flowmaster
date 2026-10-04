<script setup>
import UiButton from "./UiButton.vue";
import PageControls from "./PageControls.vue";
defineProps({ records: Array, total: Number, offset: Number, limit: Number, nextOffset: { type: Number, default: null }, loading: Boolean, hypotheses: Array, currentResultId: String, nodeMode: Boolean, pendingId: String });
const emit = defineEmits(["page", "show", "edit", "remove", "jump", "select-result"]);
const statuses = { pending: "待判定", running: "判定中", verified: "已验证", rejected: "未通过" };
const date = input => input ? new Date(input).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录";
</script>
<template>
  <div class="record-list" :aria-busy="loading||undefined">
    <p v-if="loading" role="status">正在读取执行记录…</p>
    <article v-for="record in records" :key="record.id" class="record-card">
      <div class="toolbar"><h3><button class="text-button" @click="emit('show',record)">{{record.title}}</button></h3><span class="badge" :class="record.status">{{statuses[record.status]}}</span></div>
      <div class="row"><span v-if="record.source==='agent'" class="badge">历史模型建议</span><span v-else-if="record.id===currentResultId" class="badge verified">当前结果</span><small>{{date(record.recordedAt)}}{{record.recordedAtInferred?' · 历史时间推断':''}}</small><small v-if="record.duration">耗时 {{record.duration}}</small></div>
      <p class="record-summary">{{record.summary||'未填写结果摘要'}}</p>
      <button v-if="!nodeMode" class="text-button record-origin" @click="emit('jump',record)">{{hypotheses.find(h=>h.id===record.hypothesisId)?.title||'查看所属流程'}} / {{record.nodeTitle||'所属步骤'}} ↗</button>
      <div class="actions"><UiButton @click="emit('show',record)">详情</UiButton><UiButton @click="emit('edit',record)" :busy="pendingId===record.id">修正</UiButton><UiButton v-if="nodeMode&&record.source==='manual'&&record.id!==currentResultId" @click="emit('select-result',record)" :busy="pendingId===record.id">设为当前结果</UiButton><UiButton variant="danger" @click="emit('remove',record)" :busy="pendingId===record.id">删除</UiButton></div>
    </article>
    <p v-if="!records.length&&!loading" class="empty">还没有执行记录。</p>
    <PageControls :total="total" :offset="offset" :next-offset="nextOffset" :count="records.length" :loading="loading" :label="nodeMode?'执行历史分页':'执行记录分页'" @page="emit('page',$event)"/>
  </div>
</template>
