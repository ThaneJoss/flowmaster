<script setup>
import { ref, watch } from "vue";
import UiField from "./UiField.vue";
import UiButton from "./UiButton.vue";
const props = defineProps({ connection: Object, connecting: Boolean, tokens: Array, tokensLoading: Boolean, settingsError: String, docsOpen: Boolean, pendingTokenId: String });
const emit = defineEmits(["connect", "disconnect", "create-token", "revoke-token", "refresh-tokens", "seed"]);
const baseUrl = ref(props.connection?.baseUrl || "");
const token = ref("");
const remember = ref(false);
const switching = ref(false);
watch(() => props.connection, value => { if (value) { token.value = ""; switching.value = false; baseUrl.value = value.baseUrl || ""; } });
const date = input => input ? new Date(input).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
function connect() { emit("connect", { baseUrl: baseUrl.value, token: token.value, remember: remember.value }); }
</script>
<template>
  <div class="toolbar"><div><h1>连接与设置</h1><p class="muted">管理工作区连接、访问权限与外部接入。</p></div></div>
  <div class="settings-stack">
    <section class="panel"><h2>工作区连接</h2><template v-if="connection"><p>当前连接：{{connection.baseUrl||'当前站点'}}</p><div class="row"><UiButton @click="switching=!switching">{{switching?'收起连接表单':'切换工作区'}}</UiButton><UiButton @click="emit('disconnect')">退出并清除凭据</UiButton></div></template>
      <form v-if="!connection||switching" class="connection-form" @submit.prevent="connect"><p class="muted">填写 FlowMaster 访问 Token；默认只在当前浏览器会话中保存。</p><UiField label="服务地址（当前站点留空）"><input v-model="baseUrl" type="url" maxlength="2000" placeholder="https://your-workspace.example"></UiField><UiField label="访问 Token"><input v-model="token" type="password" required maxlength="4096" autocomplete="new-password"></UiField><label class="check"><input v-model="remember" type="checkbox">在此设备记住登录</label><div class="actions"><UiButton v-if="connecting" @click="emit('disconnect')">取消连接</UiButton><UiButton type="submit" variant="primary" :busy="connecting">{{connecting?'正在连接…':'连接工作区'}}</UiButton></div></form>
    </section>
    <section v-if="connection" class="panel"><div class="toolbar"><h2>访问 Token</h2><div class="row"><UiButton @click="emit('refresh-tokens')" :busy="tokensLoading">刷新</UiButton><UiButton @click="emit('create-token')" :busy="!!settingsError">创建 Token</UiButton></div></div><p v-if="settingsError" class="form-error">{{settingsError}}。Token 管理需要管理员权限。</p><p v-else-if="tokensLoading" role="status">正在读取访问权限…</p><div v-else class="table-wrap"><table><thead><tr><th>名称</th><th>前缀</th><th>权限</th><th>到期时间</th><th>操作</th></tr></thead><tbody><tr v-for="item in tokens" :key="item.id"><td>{{item.name}}</td><td>{{item.prefix}}…</td><td>{{({read:'只读',write:'读写',admin:'管理员'})[item.scope]||item.scope}}</td><td>{{date(item.expiresAt)}}</td><td><UiButton variant="danger" @click="emit('revoke-token',item)" :busy="pendingTokenId===item.id">撤销</UiButton></td></tr></tbody></table><p v-if="!tokens.length" class="muted">尚未创建访问 Token。</p></div></section>
    <details class="panel" :open="docsOpen"><summary>MCP 接入说明</summary><div class="documentation"><p>使用站点下的 <code>/mcp</code> 地址，通过 Streamable HTTP 连接。Authorization 使用 <code>Bearer YOUR_TOKEN</code>；读写权限与当前工作区相同。</p><p>先发送 initialize（协议版本 2025-11-25），再发送 notifications/initialized。请求包含 Accept: application/json, text/event-stream 与 MCP-Protocol-Version: 2025-11-25。使用 tools/list 发现工具，再通过 tools/call 调用。</p><p>项目、流程和资料使用对应的 projects_*、hypotheses_*、resources_* 工具；步骤使用 nodes_*；执行记录使用 results_create、experiments_*。修正当前执行记录会同步步骤结果，历史模型建议保留为参考，可修正，但不能设为当前真实结果。</p><p>列表返回 data、total 和 nextOffset，支持 limit/offset；继续读取时使用 nextOffset，直到它为 null，短页不代表结束。执行记录可按 projectId、hypothesisId、nodeId、q 和 status 筛选。写入需使用最新 revision，冲突时刷新后核对。</p><p>完整字段以 tools/list 返回的输入说明为准。工具错误会返回 isError 和具体原因。</p></div></details>
    <details v-if="connection&&!settingsError" class="panel"><summary>示例与初始化</summary><p>示例仅可导入空工作区，不覆盖已有项目。</p><UiButton @click="emit('seed')">导入示例项目</UiButton></details>
  </div>
</template>
