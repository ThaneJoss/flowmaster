<script setup>
import { computed, ref } from "vue";
import UiField from "./UiField.vue";
import UiButton from "./UiButton.vue";
import ResourcePicker from "./ResourcePicker.vue";
const props = defineProps({ record: Object, hypotheses: Array, resources: Array, initialHypothesisId: String, initialNodeId: String, initialTitle: String, busy: Boolean });
const emit = defineEmits(["submit", "cancel"]);
const hypothesisId = ref(props.record?.hypothesisId || props.initialHypothesisId || props.hypotheses[0]?.id || "");
const nodeId = ref(props.record?.nodeId || props.initialNodeId || "");
const nodes = computed(() => props.hypotheses.find(h => h.id === hypothesisId.value)?.nodes || []);
const value = ref({ title: props.record?.title || props.initialTitle || nodes.value.find(n => n.id === nodeId.value)?.title || "", status: props.record?.status || "pending", summary: props.record?.summary || "", duration: props.record?.duration || "", resourceIds: [...(props.record?.resourceIds || [])] });
const statuses = { pending: "待判定", running: "判定中", verified: "已验证", rejected: "未通过" };
const date = input => input ? new Date(input).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录";
function selectNode() { if (!value.value.title.trim()) value.value.title = nodes.value.find(n => n.id === nodeId.value)?.title || ""; }
function submit() { emit("submit", { hypothesisId: hypothesisId.value, data: { ...value.value, ...(props.record ? { revision: props.record.revision } : { nodeId: nodeId.value }) } }); }
</script>
<template>
  <form @submit.prevent="submit">
    <p v-if="record" class="muted">修正这条执行记录。仅当它是步骤的当前结果时，步骤展示会同步更新。</p>
    <p v-if="record?.source==='agent'" class="form-error">这是历史模型建议，不代表真实执行，也不能设为当前结果。</p>
    <template v-if="!record"><UiField label="所属流程"><select v-model="hypothesisId" required @change="nodeId='' "><option value="" disabled>选择流程</option><option v-for="h in hypotheses" :key="h.id" :value="h.id">{{h.title}}</option></select></UiField><UiField label="所属步骤"><select v-model="nodeId" required @change="selectNode"><option value="" disabled>选择步骤</option><option v-for="n in nodes" :key="n.id" :value="n.id">{{n.title}}</option></select></UiField></template>
    <p v-else class="muted">记录时间：{{date(record.recordedAt)}}{{record.recordedAtInferred?'（由历史数据推断）':''}}</p>
    <UiField label="记录标题"><input v-model="value.title" required maxlength="200"></UiField>
    <UiField label="结果判定"><select v-model="value.status"><option v-for="(label,key) in statuses" :key="key" :value="key">{{label}}</option></select></UiField>
    <UiField label="结果摘要"><textarea v-model="value.summary" required maxlength="16000" placeholder="记录发生了什么、观察到了什么，以及判断依据。"/></UiField>
    <UiField label="实际耗时（可选）"><input v-model="value.duration" maxlength="100" placeholder="例如 35 分钟"></UiField>
    <ResourcePicker v-model="value.resourceIds" :resources="resources" :disabled="busy"/>
    <div class="actions"><UiButton @click="emit('cancel')" :busy="busy">取消</UiButton><UiButton type="submit" variant="primary" :busy="busy">{{record?'保存修正':'保存执行记录'}}</UiButton></div>
  </form>
</template>
