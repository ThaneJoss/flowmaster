<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./components/UiButton.vue";
import UiField from "./components/UiField.vue";
import UiModal from "./components/UiModal.vue";
import FlowCanvas from "./components/FlowCanvas.vue";
import { makeClient, isRequestCancelled } from "../../lib/client.ts";
import { emptyNode, statusLabel, nodeTypeLabel, resourceLabel } from "../../lib/types.ts";

const clone=value=>JSON.parse(JSON.stringify(value));
const openProject=id=>{projectId.value=id;location.hash="workspace";};
const blank=()=>({projects:[],hypotheses:[],experiments:[],resources:[]});
const data=ref(blank()),connection=ref(null),busy=ref(false),notice=ref(""),modal=ref(null);
const projectId=ref(""),hypothesisId=ref(""),nodeId=ref(""),search=ref(""),status=ref("");
const tokens=ref([]),model=ref(null),settingsError=ref(""),nodeDraft=ref(null),upstream=ref([]);
const nav=[["workspace","研究工作区"],["projects","项目管理"],["experiments","实验记录"],["resources","资源库"],["api","API 文档"],["settings","系统设置"]];
const route=ref(resolveRoute()),mainElement=ref(null);
let session=null,api=null,timer;
const field=(key,label,type="text",options)=>({key,label,type,options});
const statuses=Object.entries(statusLabel).map(([value,label])=>({value,label}));
const projectOptions=computed(()=>data.value.projects.map(p=>({value:p.id,label:p.name})));
const hypotheses=computed(()=>data.value.hypotheses.filter(h=>(!projectId.value||h.projectId===projectId.value)&&(!status.value||h.status===status.value)&&(!search.value||(h.title+" "+h.description).toLowerCase().includes(search.value.toLowerCase()))));
const current=computed(()=>hypotheses.value.find(h=>h.id===hypothesisId.value)||hypotheses.value[0]||null);
const selectedNode=computed(()=>current.value?.nodes.find(n=>n.id===nodeId.value)||null);
const experiments=computed(()=>data.value.experiments.filter(e=>(!status.value||e.status===status.value)&&(!projectId.value||data.value.hypotheses.some(h=>h.id===e.hypothesisId&&h.projectId===projectId.value))&&(!search.value||(e.title+" "+e.summary).toLowerCase().includes(search.value.toLowerCase()))));
const resources=computed(()=>data.value.resources.filter(r=>(!projectId.value||r.projectId===projectId.value)&&(!search.value||(r.name+" "+r.description).toLowerCase().includes(search.value.toLowerCase()))));
const nodeFields=[["inputs","输入"],["output","输出"],["summary","结果摘要"],["rationale","研究思路"],["method","研究方法 / Agent 建议"],["conclusion","研究结论"],["nextAction","后续行动"]];
const projectName=id=>data.value.projects.find(p=>p.id===id)?.name||"未知项目";
const hypothesisName=id=>data.value.hypotheses.find(h=>h.id===id)?.title||"已删除的假设";
const date=value=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—";
const safeUrl=value=>{try{const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
watch(selectedNode,n=>{nodeDraft.value=n?clone(n):null;upstream.value=current.value?.edges.filter(e=>e.target===n?.id).map(e=>e.source)||[];},{immediate:true});
watch(route,()=>{search.value="";status.value="";closeModal();if(route.value==="settings"&&api)run(loadSettings);});

function message(text){notice.value=text;clearTimeout(timer);timer=setTimeout(()=>notice.value="",7000);}
async function run(action){if(busy.value)return;busy.value=true;try{await action();}catch(error){if(!isRequestCancelled(error)){message(error.message||"操作失败");if(modal.value)modal.value.error=error.message;}}finally{busy.value=false;}}
function requireApi(){if(!api)throw new Error("请先登录工作区");return api;}
function assertSession(client){if(client!==api)throw new DOMException("Session changed","AbortError");}
async function refresh(client=requireApi()){assertSession(client);const workspace=await client("/workspace");assertSession(client);data.value=workspace;}
function clearConnection(){session?.abort();session=null;api=null;connection.value=null;data.value=blank();tokens.value=[];model.value=null;nodeId.value="";hypothesisId.value="";projectId.value="";localStorage.removeItem("flowmaster.connection");sessionStorage.removeItem("flowmaster.connection");}
function forget(){clearConnection();modal.value=null;}
function closeModal(){if(busy.value&&modal.value?.submit===connect)clearConnection();modal.value=null;}
async function connect(value){
  let baseUrl=(value.baseUrl||"").trim().replace(/\/$/,"");
  if(baseUrl){const u=new URL(baseUrl);if(u.username||u.password||u.search||u.hash||!(u.protocol==="https:"||u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))throw new Error("服务地址需要 HTTPS，且不能包含账号、查询参数或片段");}
  const c={baseUrl,token:value.token.trim(),remember:!!value.remember};
  if(!c.token)throw new Error("请输入访问 Token");
  clearConnection();const candidate=new AbortController();session=candidate;api=makeClient(c,candidate.signal);const client=api;
  try{await refresh(client);assertSession(client);connection.value=c;(c.remember?localStorage:sessionStorage).setItem("flowmaster.connection",JSON.stringify(c));message("工作区已连接");if(route.value==="settings")await loadSettings();}
  catch(error){if(session===candidate)clearConnection();throw error;}
}
function login(){modal.value={kind:"form",title:"登录工作区",description:"填写 FlowMaster 管理员或访问 Token，不是 Cloudflare API Token。默认仅当前浏览器会话保存。",fields:[field("baseUrl","服务地址（同域留空）","url"),field("token","访问 Token","password"),field("remember","在此设备记住登录","checkbox")],value:{baseUrl:connection.value?.baseUrl||"",token:"",remember:false},submit:connect};}
function form(title,fields,value,submit,description=""){modal.value={kind:"form",title,fields,value:clone(value),submit,description,error:""};}
function confirmAction(title,description,submit){modal.value={kind:"confirm",title,description,submit,error:""};}
async function submitModal(){const m=modal.value;await run(async()=>{m.error="";await m.submit(m.value);if(modal.value===m)modal.value=null;});}
async function save(kind,item){const client=requireApi();const exists=data.value[kind].some(i=>i.id===item.id);await client("/"+kind+(exists?"/"+item.id:""),{method:exists?"PUT":"POST",body:JSON.stringify(item)});await refresh(client);message("已保存");}
function editProject(item){form(item?"编辑项目":"新建项目",[field("name","项目名称"),field("description","项目说明","textarea")],item||{name:"",description:""},v=>save("projects",v));}
function editHypothesis(item){
  if(!data.value.projects.length){message("请先创建项目");return;}
  form(item?"编辑假设":"新建假设",[field("projectId","所属项目","select",projectOptions.value),field("title","假设标题"),field("description","假设说明","textarea"),field("baseline","基线"),field("status","状态","select",statuses)],item||{projectId:projectId.value||data.value.projects[0].id,title:"",description:"",baseline:"",status:"pending",nodes:[],edges:[]},v=>save("hypotheses",v));
}
function editResource(item){
  if(!data.value.projects.length){message("请先创建项目");return;}
  form(item?"编辑资源":"添加资源",[field("projectId","所属项目","select",projectOptions.value),field("name","资源名称"),field("type","类型","select",Object.entries(resourceLabel).map(([value,label])=>({value,label}))),field("url","链接","url"),field("description","说明","textarea")],item||{projectId:projectId.value||data.value.projects[0].id,name:"",type:"document",url:"",description:""},v=>save("resources",v));
}
function remove(kind,item){confirmAction("确认删除","删除后无法从页面恢复。删除假设也会删除其关联实验记录。",async()=>{const client=requireApi();await client("/"+kind+"/"+item.id,{method:"DELETE"});await refresh(client);message("已删除");});}
function addNode(){const h=current.value;if(!h)return;form("添加流程节点",[field("title","节点标题"),field("type","节点类型","select",Object.entries(nodeTypeLabel).map(([value,label])=>({value,label})))],{title:"新的验证节点",type:"experiment"},async v=>{const node={...emptyNode(crypto.randomUUID(),v.title,40+(h.nodes.length%3)*230,40+Math.floor(h.nodes.length/3)*160),type:v.type};await save("hypotheses",{...h,nodes:[...h.nodes,node]});nodeId.value=node.id;});}
async function saveNode(){const h=current.value,n=nodeDraft.value;if(!h||!n)return;await save("hypotheses",{...h,nodes:h.nodes.map(i=>i.id===n.id?clone(n):i),edges:[...h.edges.filter(e=>e.target!==n.id),...upstream.value.map(source=>({source,target:n.id}))]});}
function deleteNode(){const h=current.value,n=selectedNode.value;if(!n)return;confirmAction("删除流程节点","节点和相关连线将被移除，历史实验记录保留。",()=>save("hypotheses",{...h,nodes:h.nodes.filter(i=>i.id!==n.id),edges:h.edges.filter(e=>e.source!==n.id&&e.target!==n.id)}));}
function moveNode(position){run(()=>save("hypotheses",{...current.value,nodes:current.value.nodes.map(n=>n.id===position.id?{...n,x:position.x,y:position.y}:n)}));}
function layout(){run(async()=>{const h=current.value,levels=new Map();function level(id,seen=new Set()){if(levels.has(id))return levels.get(id);if(seen.has(id))return 0;seen.add(id);const parents=h.edges.filter(e=>e.target===id).map(e=>e.source);const value=parents.length?Math.max(...parents.map(p=>level(p,new Set(seen))))+1:0;levels.set(id,value);return value;}const rows=new Map();const nodes=h.nodes.map(n=>{const col=level(n.id),row=rows.get(col)||0;rows.set(col,row+1);return {...n,x:40+col*240,y:40+row*150};});await save("hypotheses",{...h,nodes});});}
function resultForm(){const h=current.value,n=selectedNode.value;if(!n)return;form("录入实验结果",[field("title","实验标题"),field("status","结果状态","select",statuses),field("duration","实际耗时"),field("summary","结果摘要","textarea")],{nodeId:n.id,title:n.title,status:"pending",duration:"",summary:""},async v=>{const client=requireApi();await client("/hypotheses/"+h.id+"/results",{method:"POST",body:JSON.stringify(v)});await refresh(client);message("实验结果已保存");});}
function analyze(){const h=current.value,n=selectedNode.value;if(!n)return;confirmAction("运行 Agent 分析","将把该假设、节点及上游研究内容发送到你配置的模型服务，可能产生模型费用。它只给出建议，不运行实验。",async()=>{const client=requireApi();await client("/hypotheses/"+h.id+"/run",{method:"POST",body:JSON.stringify({nodeId:n.id})});await refresh(client);message("分析完成，建议和日志已保存");});}
function showExperiment(e){modal.value={kind:"detail",title:e.title,record:e};}
function editExperiment(e){form("编辑实验记录",[field("title","标题"),field("status","状态","select",statuses),field("duration","耗时"),field("summary","摘要","textarea")],e,v=>save("experiments",v),"编辑历史记录不会重新计算流程节点；更新节点结果请使用“录入实验结果”。");}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function loadSettings(){
  const client=requireApi();settingsError.value="";
  try{const [list,config]=await Promise.all([client("/tokens"),client("/settings/model")]);assertSession(client);tokens.value=list;model.value=config;}
  catch(error){if(isRequestCancelled(error))throw error;settingsError.value=error.message;}
}
function configureModel(){form("配置模型服务",[field("baseUrl","Base URL","url"),field("model","模型名称"),field("apiKey","API Key（留空保留已有 Key）","password")],{baseUrl:model.value?.baseUrl||"https://api.openai.com/v1",model:model.value?.model||"",apiKey:""},async v=>{const client=requireApi();const payload={baseUrl:v.baseUrl,model:v.model,...(v.apiKey?{apiKey:v.apiKey}:{})};const saved=await client("/settings/model",{method:"PUT",body:JSON.stringify(payload)});assertSession(client);model.value=saved;message("模型配置已保存");});}
function testModel(){confirmAction("测试模型连接","向配置的模型服务发送一个简短请求，可能产生少量费用。",async()=>{const client=requireApi();const result=await client("/settings/model/test",{method:"POST"});message(result.message);});}
function createToken(){form("创建访问 Token",[field("name","名称"),field("scope","权限","select",[{value:"read",label:"只读"},{value:"write",label:"读写"},{value:"admin",label:"管理员"}]),field("expiresInDays","有效天数（1–365）","number")],{name:"",scope:"read",expiresInDays:30},async v=>{const client=requireApi();const created=await client("/tokens",{method:"POST",body:JSON.stringify({...v,expiresInDays:Number(v.expiresInDays)})});await loadSettings();assertSession(client);modal.value={kind:"token",title:"请保存新 Token",token:created.token,description:"完整 Token 仅显示这一次。关闭后无法再次查看。"};});}
function revoke(t){confirmAction("撤销 Token","使用此 Token 的客户端将立即失去访问权限。",async()=>{await requireApi()("/tokens/"+t.id,{method:"DELETE"});await loadSettings();});}
function seed(){confirmAction("导入示例研究","仅允许向空工作区导入，不会覆盖现有数据。",async()=>{const client=requireApi();await client("/seed",{method:"POST"});await refresh(client);message("示例已导入");});}
function resolveRoute(){const next=location.hash.slice(1);return nav.some(([id])=>id===next)?next:"workspace";}
function hashChanged(){route.value=resolveRoute();}
onMounted(()=>{window.addEventListener("hashchange",hashChanged);try{const saved=sessionStorage.getItem("flowmaster.connection")||localStorage.getItem("flowmaster.connection");if(saved)run(()=>connect(JSON.parse(saved)));}catch{forget();}});
onBeforeUnmount(()=>{session?.abort();clearTimeout(timer);window.removeEventListener("hashchange",hashChanged);});
</script>

<template>
<a class="skip" href="#main" @click.prevent="mainElement?.focus()">跳到内容</a>
<header><a class="brand" href="#workspace"><span class="logo">F</span>FlowMaster</a><span class="muted">研究流程 · 从假设到证据</span><div id="connection"><span v-if="connection" class="connection-status badge verified">工作区已连接</span><UiButton v-if="connection" @click="run(()=>refresh())" :busy="busy">刷新</UiButton><UiButton v-if="connection" @click="forget">退出</UiButton><UiButton v-else variant="primary" @click="login" :busy="busy">管理员登录</UiButton></div></header>
<div class="shell"><nav aria-label="主导航"><a v-for="[id,label] in nav" :key="id" :href="'#'+id" :class="{active:route===id}" :aria-current="route===id?'page':undefined">{{label}}</a><small>Vue 3 · Cloudflare Workers</small></nav>
<main ref="mainElement" id="main" tabindex="-1">
<div class="toolbar"><div><h1>{{nav.find(([id])=>id===route)?.[1]}}</h1><p class="muted">以假设组织研究，用真实实验记录验证进展</p></div><div class="row"><UiButton v-if="connection" @click="download(data,'flowmaster-workspace.json')">导出工作区</UiButton></div></div>
<template v-if="route==='workspace'">
<div class="cards"><div class="card"><small>研究项目</small><div class="metric">{{data.projects.length}}</div></div><div class="card"><small>研究假设</small><div class="metric">{{data.hypotheses.length}}</div></div><div class="card"><small>已验证假设</small><div class="metric">{{data.hypotheses.filter(h=>h.status==='verified').length}}</div></div><div class="card"><small>实验与分析记录</small><div class="metric">{{data.experiments.length}}</div></div></div>
<div v-if="!connection" class="panel empty"><h2>工作区为空</h2><p>登录后读取真实数据；不会自动加载演示内容</p><UiButton variant="primary" @click="login">登录工作区</UiButton></div>
<div v-else class="workspace">
<aside class="panel"><div class="toolbar"><h2>假设列表</h2><UiButton @click="editHypothesis()" :busy="busy">＋</UiButton></div><select v-model="projectId" aria-label="筛选项目"><option value="">全部项目</option><option v-for="p in data.projects" :key="p.id" :value="p.id">{{p.name}}</option></select><input v-model="search" placeholder="搜索假设" aria-label="搜索假设"><select v-model="status" aria-label="筛选假设状态"><option value="">全部状态</option><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select><div class="list"><button v-for="h in hypotheses" :key="h.id" class="item" :class="{selected:current?.id===h.id}" @click="hypothesisId=h.id;nodeId=''"><strong>{{h.title}}</strong><small>{{projectName(h.projectId)}}</small><br><span class="badge" :class="h.status">{{statusLabel[h.status]}}</span></button><p v-if="!hypotheses.length" class="empty">暂无假设</p></div><UiButton @click="editProject()" :busy="busy">新建项目</UiButton></aside>
<div v-if="current" class="stack"><section class="panel"><div class="toolbar"><div><h2>{{current.title}}</h2><small>{{projectName(current.projectId)}} · 基线：{{current.baseline||'未填写'}}</small></div><div class="row"><UiButton @click="editHypothesis(current)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('hypotheses',current)" :busy="busy">删除</UiButton></div></div><p>{{current.description}}</p></section><FlowCanvas :key="current.id" :hypothesis="current" :selected-id="nodeId" :busy="busy" @select="nodeId=$event" @move="moveNode" @add="addNode" @layout="layout"/></div>
<section v-else class="panel empty"><h2>开始你的研究流程</h2><p>先创建项目，再添加假设与验证节点</p></section>
<aside v-if="nodeDraft&&current" class="panel inspector"><h2>节点详情</h2><form @submit.prevent="run(saveNode)"><UiField label="节点标题"><input v-model="nodeDraft.title" required maxlength="200"></UiField><UiField label="节点类型"><select v-model="nodeDraft.type"><option v-for="(label,value) in nodeTypeLabel" :value="value" :key="value">{{label}}</option></select></UiField><UiField label="状态"><select v-model="nodeDraft.status"><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select></UiField><UiField v-for="[key,label] in nodeFields" :key="key" :label="label"><textarea v-model="nodeDraft[key]" maxlength="16000"/></UiField><UiField label="实验开始时间"><input v-model="nodeDraft.startedAt" maxlength="100"></UiField><UiField label="实际耗时"><input v-model="nodeDraft.duration" maxlength="100"></UiField><UiField label="上游节点" hint="按住 Ctrl / Command 可多选，服务端会拒绝循环依赖"><select v-model="upstream" multiple><option v-for="n in current.nodes.filter(n=>n.id!==nodeDraft.id)" :value="n.id" :key="n.id">{{n.title}}</option></select></UiField><div class="actions"><UiButton type="submit" variant="primary" :busy="busy">保存节点</UiButton></div></form><div class="actions"><UiButton @click="resultForm" :busy="busy">录入实验结果</UiButton><UiButton @click="analyze" :busy="busy">Agent 分析</UiButton><UiButton variant="danger" @click="deleteNode" :busy="busy">删除节点</UiButton></div><hr><h3>该节点的实验记录</h3><button v-for="e in data.experiments.filter(e=>e.hypothesisId===current.id&&e.nodeId===nodeId)" :key="e.id" class="item" @click="showExperiment(e)">{{e.title}} <span class="badge">{{e.source==='agent'?'模型建议':'真实录入'}}</span></button></aside>
<aside v-else class="panel empty">选择一个节点查看详情</aside>
</div>
</template>
<template v-else-if="route==='projects'"><div class="toolbar"><p>组织不同研究方向的假设与资源</p><UiButton variant="primary" @click="editProject()" :busy="busy||!connection">＋ 新建项目</UiButton></div><div class="cards"><article v-for="p in data.projects" :key="p.id" class="card"><h2>{{p.name}}</h2><p>{{p.description}}</p><small>{{data.hypotheses.filter(h=>h.projectId===p.id).length}} 个假设 · 更新于 {{date(p.updatedAt)}}</small><div class="actions"><UiButton @click="openProject(p.id)">打开</UiButton><UiButton @click="editProject(p)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('projects',p)" :busy="busy">删除</UiButton></div></article></div><div v-if="!data.projects.length" class="panel empty">暂无项目，请登录后新建</div></template>
<template v-else-if="route==='experiments'"><div class="toolbar"><input v-model="search" placeholder="搜索实验记录" aria-label="搜索实验记录"><select v-model="status" aria-label="实验状态"><option value="">全部状态</option><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select><UiButton @click="download(experiments,'flowmaster-experiments.json')">导出记录</UiButton></div><div class="panel table-wrap"><table><thead><tr><th>实验 / 分析</th><th>所属假设</th><th>状态</th><th>耗时</th><th>操作</th></tr></thead><tbody><tr v-for="e in experiments" :key="e.id"><td><strong>{{e.title}}</strong><br><small>{{e.source==='agent'?'Agent 建议，不代表实验验证':'手动实验结果'}} · {{date(e.updatedAt)}}</small></td><td>{{hypothesisName(e.hypothesisId)}}</td><td><span class="badge" :class="e.status">{{statusLabel[e.status]}}</span></td><td>{{e.duration||'—'}}</td><td><div class="row"><UiButton @click="showExperiment(e)">详情</UiButton><UiButton @click="editExperiment(e)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('experiments',e)" :busy="busy">删除</UiButton></div></td></tr></tbody></table><p v-if="!experiments.length" class="empty">暂无实验记录；选择流程节点录入结果</p></div></template>
<template v-else-if="route==='resources'"><div class="toolbar"><input v-model="search" placeholder="搜索资源" aria-label="搜索资源"><select v-model="projectId" aria-label="资源项目"><option value="">全部项目</option><option v-for="p in data.projects" :key="p.id" :value="p.id">{{p.name}}</option></select><UiButton variant="primary" @click="editResource()" :busy="busy||!connection">＋ 添加资源</UiButton></div><div class="cards"><article v-for="r in resources" :key="r.id" class="card"><span class="badge">{{resourceLabel[r.type]}}</span><h2>{{r.name}}</h2><p>{{r.description}}</p><small>{{projectName(r.projectId)}}</small><p v-if="safeUrl(r.url)"><a :href="safeUrl(r.url)" target="_blank" rel="noopener noreferrer">打开资源 ↗</a></p><div class="actions"><UiButton @click="editResource(r)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('resources',r)" :busy="busy">删除</UiButton></div></article></div><p v-if="!resources.length" class="panel empty">暂无资源</p></template>
<template v-else-if="route==='api'"><section class="panel stack"><h2>REST API</h2><p>API 前缀 /api/v1，使用 Authorization: Bearer YOUR_TOKEN。管理员、读写和只读 Token 控制操作权限，所有 Token 访问同一个共享工作区。</p><a href="/openapi.json" target="_blank" rel="noopener">查看 / 下载 OpenAPI 规范</a><div class="pre">GET /workspace
GET /projects · /hypotheses · /experiments · /resources
POST /{collection}
GET /{collection}/{id}
PUT /{collection}/{id}（携带 revision）
DELETE /{collection}/{id}
POST /hypotheses/{id}/results
POST /hypotheses/{id}/run
GET /tokens · POST /tokens · DELETE /tokens/{id}
GET /settings/model · PUT /settings/model
POST /settings/model/test</div><p>列表支持 limit、offset、q 和 projectId。写入时若 revision 冲突，请先刷新。模型分析只生成建议，不运行训练。</p></section></template>
<template v-else-if="route==='settings'"><div class="stack"><section class="panel"><h2>工作区连接</h2><p>{{connection?'当前连接：'+(connection.baseUrl||'同域 API'):'尚未登录'}}</p><div class="row"><UiButton @click="login" :busy="busy">{{connection?'切换工作区':'登录工作区'}}</UiButton><UiButton v-if="connection" @click="forget">退出并清除凭据</UiButton></div></section><p v-if="settingsError" class="form-error">{{settingsError}}；模型和 Token 管理需要管理员权限</p><template v-if="connection&&!settingsError"><section class="panel"><div class="toolbar"><h2>模型接口</h2><UiButton @click="configureModel" :busy="busy">配置模型</UiButton></div><p>{{model?.model||'未配置模型'}} · {{model?.baseUrl}}</p><p class="muted">{{model?.hasKey?'Key 已在服务端加密保存':'尚未保存 Key'}}</p><UiButton @click="testModel" :busy="busy||!model?.hasKey">测试连接</UiButton></section><section class="panel"><div class="toolbar"><h2>访问 Token</h2><UiButton @click="createToken" :busy="busy">创建 Token</UiButton></div><div class="table-wrap"><table><thead><tr><th>名称</th><th>前缀</th><th>权限</th><th>到期时间</th><th></th></tr></thead><tbody><tr v-for="t in tokens" :key="t.id"><td>{{t.name}}</td><td>{{t.prefix}}…</td><td>{{t.scope}}</td><td>{{date(t.expiresAt)}}</td><td><UiButton variant="danger" @click="revoke(t)" :busy="busy">撤销</UiButton></td></tr></tbody></table></div></section><section class="panel"><h2>示例研究</h2><p>可选，仅在空工作区中导入示例。</p><UiButton @click="seed" :busy="busy">导入示例</UiButton></section></template></div></template>
</main></div>
<div id="notice" role="status" aria-live="polite">{{notice}}</div>
<UiModal v-if="modal" :title="modal.title" :busy="busy&&modal.submit!==connect" @close="closeModal"><p v-if="modal.description" class="muted">{{modal.description}}</p><p v-if="modal.error" class="form-error">{{modal.error}}</p>
<form v-if="modal.kind==='form'" @submit.prevent="submitModal"><UiField v-for="f in modal.fields" :key="f.key" :label="f.label"><textarea v-if="f.type==='textarea'" v-model="modal.value[f.key]" maxlength="16000"/><select v-else-if="f.type==='select'" v-model="modal.value[f.key]"><option v-for="o in f.options" :key="o.value" :value="o.value">{{o.label}}</option></select><input v-else-if="f.type==='checkbox'" v-model="modal.value[f.key]" type="checkbox"><input v-else v-model="modal.value[f.key]" :type="f.type" :autocomplete="f.type==='password'?'new-password':'off'" :maxlength="f.type==='password'?4096:f.type==='url'?2000:200" :min="f.type==='number'?1:undefined" :max="f.type==='number'?365:undefined" :required="['name','title','token','model'].includes(f.key)"></UiField><div class="actions"><UiButton type="button" @click="closeModal" :busy="busy&&modal.submit!==connect">取消</UiButton><UiButton type="submit" variant="primary" :busy="busy">{{busy?'处理中…':'保存'}}</UiButton></div></form>
<div v-else-if="modal.kind==='confirm'" class="actions"><UiButton @click="modal=null" :busy="busy">取消</UiButton><UiButton variant="primary" @click="submitModal" :busy="busy">确认</UiButton></div>
<div v-else-if="modal.kind==='detail'"><span class="badge" :class="modal.record.status">{{statusLabel[modal.record.status]}}</span><p class="log">{{modal.record.summary}}</p><h3>执行日志</h3><p v-for="(log,index) in modal.record.logs" :key="index" class="log"><small>{{log.time}}</small><br>{{log.message}}</p><UiButton @click="download(modal.record,'experiment.json')">导出此记录</UiButton></div>
<div v-else-if="modal.kind==='token'"><textarea readonly :value="modal.token" aria-label="新建 Token"/><div class="actions"><UiButton @click="modal=null">我已保存，关闭</UiButton></div></div>
</UiModal>
</template>
