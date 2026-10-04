<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiButton from "./components/UiButton.vue";
import UiField from "./components/UiField.vue";
import UiModal from "./components/UiModal.vue";
import CollectionPager from "./components/CollectionPager.vue";
import ProjectPicker from "./components/ProjectPicker.vue";
import FlowCanvas from "./components/FlowCanvas.vue";
import NodeOverview from "./components/NodeOverview.vue";
import NodeDrawer from "./components/NodeDrawer.vue";
import { layoutNodes, newNodePosition } from "../../lib/canvas-layout.ts";
import { makeClient, isRequestCancelled } from "../../lib/client.ts";
import { emptyNode, statusLabel, nodeTypeLabel, resourceLabel } from "../../lib/types.ts";
import { useNodeDrafts } from "../../lib/node-drafts.ts";
import { exportWorkspace as workspaceBlob, exportCollection as collectionBlob } from "../../lib/workspace-export.ts";

const clone=value=>JSON.parse(JSON.stringify(value));
const openProject=id=>{projectId.value=id;location.hash="workspace";};
const blank=()=>({projects:[],hypotheses:[],experiments:[],resources:[]});
const blankPage=()=>({ids:[],total:null,nextOffset:null,loading:false,error:"",filters:null,stale:false});
const blankPages=()=>Object.fromEntries(["projects","hypotheses","experiments","resources","nodeExperiments"].map(name=>[name,blankPage()]));
const data=ref(blank()),pages=ref(blankPages()),connection=ref(null),busy=ref(false),notice=ref(""),modal=ref(null);
const projectId=ref(""),hypothesisId=ref(""),nodeId=ref(""),search=ref(""),status=ref(""),projectSearch=ref("");
const tokens=ref([]),settingsError=ref(""),refreshWarning=ref(""),nodeReferencesError=ref("");
const nav=[["workspace","研究工作区"],["projects","项目管理"],["experiments","实验记录"],["resources","资源库"],["mcp","MCP 文档"],["settings","系统设置"]];
const route=ref(resolveRoute()),mainElement=ref(null);
const sidebarOpen=ref(!window.matchMedia("(max-width: 760px)").matches),focused=ref(false),inspectorOpen=ref(false),editingNode=ref(false);
let sidebarBeforeFocus=sidebarOpen.value;
let session=null,api=null,timer,viewTimer,projectTimer,mutationVersion=0,settingsRequest=0;
const pageRequests=Object.fromEntries(Object.keys(blankPages()).map(name=>[name,0]));
const field=(key,label,type="text",options)=>({key,label,type,options});
const statuses=Object.entries(statusLabel).map(([value,label])=>({value,label}));
const projectsById=computed(()=>new Map(data.value.projects.map(p=>[p.id,p])));
const hypothesesById=computed(()=>new Map(data.value.hypotheses.map(h=>[h.id,h])));
const records=(name,kind=name)=>pages.value[name].ids.map(id=>data.value[kind].find(item=>item.id===id)).filter(Boolean);
const projects=computed(()=>records("projects"));
const projectOptions=computed(()=>{
  const ids=[...pages.value.projects.ids,projectId.value,modal.value?.value?.projectId].filter(Boolean);
  return [...new Set(ids)].map(id=>({value:id,label:projectsById.value.get(id)?.name||`项目 ${id}`}));
});
const hypotheses=computed(()=>records("hypotheses"));
const current=computed(()=>hypothesesById.value.get(hypothesisId.value)||hypotheses.value[0]||null);
const selectedNode=computed(()=>current.value?.nodes.find(n=>n.id===nodeId.value)||null);
const nodeExperiments=computed(()=>{
  if(!current.value||!nodeId.value)return [];
  const list=records("nodeExperiments","experiments").filter(e=>e.hypothesisId===current.value.id&&e.nodeId===nodeId.value);
  const selected=data.value.experiments.find(e=>e.id===selectedNode.value?.currentResultId);
  return selected&&!list.some(e=>e.id===selected.id)?[...list,selected]:list;
});
const experiments=computed(()=>records("experiments"));
const resources=computed(()=>records("resources"));
const nodeFields=[["inputs","输入"],["output","输出"],["summary","结果摘要"],["rationale","研究思路"],["method","研究方法"],["conclusion","研究结论"],["nextAction","后续行动"]];
const projectName=id=>projectsById.value.get(id)?.name||`项目 ${id}`;
const hypothesisName=id=>hypothesesById.value.get(id)?.title||`假设 ${id}`;
const date=value=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):"—";
const safeUrl=value=>{try{const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
// Keep fetched records cached independently of visible pages: paging must not
// make useNodeDrafts interpret an off-page hypothesis as a deleted one.
const {nodeDraft,upstream,dirty:nodeDirty,conflicted:nodeConflicted,clear:clearNodeDrafts,acknowledge:acknowledgeNode}=useNodeDrafts(computed(()=>data.value.hypotheses),current,selectedNode);
const upstreamOptions=computed(()=>current.value?.nodes.filter(n=>n.id!==nodeDraft.value?.id)||[]);
watch(route,()=>{focused.value=false;inspectorOpen.value=false;search.value="";status.value="";closeModal();});
watch([route,projectId,search,status],()=>{
  clearTimeout(viewTimer);
  if(connection.value)viewTimer=setTimeout(()=>background(()=>loadView()),200);
});
watch(projectSearch,()=>{
  clearTimeout(projectTimer);
  if(connection.value)projectTimer=setTimeout(()=>background(()=>loadPage("projects")),200);
});
watch(()=>current.value?.id,id=>{if(id)hypothesisId.value=id;nodeId.value="";inspectorOpen.value=false;editingNode.value=false;});
watch([()=>current.value?.id,nodeId,inspectorOpen],()=>{
  if(!connection.value)return;
  if(inspectorOpen.value&&selectedNode.value)background(()=>loadNode());
  else {pageRequests.nodeExperiments++;pages.value.nodeExperiments=blankPage();}
});
watch(focused,(value,previous)=>{if(value){sidebarBeforeFocus=sidebarOpen.value;sidebarOpen.value=false;}else if(previous)sidebarOpen.value=sidebarBeforeFocus;});
watch(()=>selectedNode.value?.id,()=>{editingNode.value=false;if(!selectedNode.value)inspectorOpen.value=false;});

function selectHypothesis(id){hypothesisId.value=id;nodeId.value="";inspectorOpen.value=false;if(window.matchMedia("(max-width: 760px)").matches)sidebarOpen.value=false;}
function openInspector(id){if(nodeId.value!==id)editingNode.value=false;nodeId.value=id;inspectorOpen.value=true;}
function closeInspector(){inspectorOpen.value=false;}
function selectedNodeElement(){return nodeId.value?mainElement.value?.querySelector('[data-node-id="'+CSS.escape(nodeId.value)+'"]'):null;}
function showDescription(){modal.value={kind:"description",title:"研究说明",subject:current.value.title,text:current.value.description};}
async function toggleFocus(value){focused.value=value;await nextTick();mainElement.value?.querySelector(".focus-toggle")?.focus();}
function workspaceKeydown(event){if(event.key!=="Escape"||modal.value||document.querySelector("dialog[open]"))return;if(focused.value){event.preventDefault();toggleFocus(false);}}

function message(text){notice.value=text;clearTimeout(timer);timer=setTimeout(()=>notice.value="",7000);}
async function run(action){if(busy.value)return;busy.value=true;try{await action();}catch(error){if(!isRequestCancelled(error)){message(error.message||"操作失败");if(modal.value)modal.value.error=error.message;}}finally{busy.value=false;}}
function requireApi(){if(!api)throw new Error("请先登录工作区");return api;}
function assertSession(client){if(client!==api)throw new DOMException("Session changed","AbortError");}
function filtersFor(name){
  if(name==="projects")return {q:projectSearch.value.trim()};
  if(name==="nodeExperiments")return {hypothesisId:current.value?.id||"",nodeId:nodeId.value};
  return {q:search.value.trim(),projectId:projectId.value,...(["hypotheses","experiments"].includes(name)?{status:status.value}:{})};
}
function cacheRecords(kind,items){
  const records=new Map(data.value[kind].map(item=>[item.id,item]));
  for(const item of items){
    const previous=records.get(item.id);
    if(!previous||!previous.revision||!item.revision||item.revision>=previous.revision)records.set(item.id,item);
  }
  data.value[kind]=[...records.values()];
}
async function fetchRecords(kind,ids,client=requireApi(),force=false){
  const missing=[...new Set(ids)].filter(id=>id&&(force||!data.value[kind].some(item=>item.id===id)));
  const version=mutationVersion;
  // References are bounded to the visible page/node, with limited concurrency.
  for(let offset=0;offset<missing.length;offset+=5){
    const items=await Promise.all(missing.slice(offset,offset+5).map(id=>client("/"+kind+"/"+encodeURIComponent(id))));
    assertSession(client);if(version!==mutationVersion)return;
    cacheRecords(kind,items);
  }
}
async function loadPage(name,append=false,client=requireApi()){
  assertSession(client);
  const page=pages.value[name],filters=filtersFor(name),key=JSON.stringify(filters),kind=name==="nodeExperiments"?"experiments":name;
  const same=page.filters===key;
  if(append&&page.loading)return;
  if(append&&(!same||page.stale))append=false;
  if(append&&page.nextOffset===null)return;
  const offset=append?page.nextOffset:0,request=++pageRequests[name];
  if(!same){page.ids=[];page.total=null;page.nextOffset=null;if(name==="hypotheses")hypothesisId.value="";}
  page.filters=key;page.loading=true;page.error="";
  const query=new URLSearchParams({limit:"20",offset:String(offset)});
  for(const [key,value] of Object.entries(filters))if(value)query.set(key,value);
  try{
    const result=await client.page("/"+kind+"?"+query);
    assertSession(client);
    if(request!==pageRequests[name]||key!==JSON.stringify(filtersFor(name)))return;
    cacheRecords(kind,result.data);
    page.ids=[...new Set([...(append?page.ids:[]),...result.data.map(item=>item.id)])];
    page.total=result.total;page.nextOffset=result.nextOffset;page.stale=false;
    // Refreshing the first page must not displace a graph selected on a later
    // page. Revalidate that one record rather than refetching every earlier page.
    const selectedId=name==="hypotheses"?hypothesisId.value:"";
    if(selectedId&&!result.data.some(item=>item.id===selectedId)){
      try{
        const selected=await client("/hypotheses/"+encodeURIComponent(selectedId));assertSession(client);
        if(request!==pageRequests[name]||key!==JSON.stringify(filtersFor(name)))return;
        cacheRecords("hypotheses",[selected]);
      }catch(error){
        if(client!==api||request!==pageRequests[name]||key!==JSON.stringify(filtersFor(name)))return;
        if(error.status===404){data.value.hypotheses=data.value.hypotheses.filter(item=>item.id!==selectedId);if(hypothesisId.value===selectedId)hypothesisId.value="";}
        else throw error;
      }
    }
    if(kind==="hypotheses"||kind==="resources")background(()=>fetchRecords("projects",result.data.map(item=>item.projectId),client));
  }catch(error){
    if(client!==api||request!==pageRequests[name]||key!==JSON.stringify(filtersFor(name))||isRequestCancelled(error))return;
    page.error=error.message||"列表加载失败";throw error;
  }finally{if(request===pageRequests[name])page.loading=false;}
}
async function background(action){try{await action();}catch(error){if(!isRequestCancelled(error))message(error.message||"加载失败");}}
async function loadNode(client=requireApi()){
  const h=current.value,n=selectedNode.value;if(!h||!n||!inspectorOpen.value)return;
  const context=h.id+":"+n.id;nodeReferencesError.value="";
  const references=async()=>{
    try{
      if(n.currentResultId&&!pages.value.nodeExperiments.ids.includes(n.currentResultId))await fetchRecords("experiments",[n.currentResultId],client,true);
      const result=data.value.experiments.find(e=>e.id===n.currentResultId);
      await fetchRecords("resources",[...(n.resourceIds||[]),...(result?.resourceIds||[])],client,true);
    }catch(error){if(client===api&&context===current.value?.id+":"+nodeId.value&&!isRequestCancelled(error))nodeReferencesError.value="关联资料加载失败："+error.message;}
  };
  await loadPage("nodeExperiments",false,client);await references();
}
async function loadView(client=requireApi()){
  if(route.value==="workspace"){
    await loadPage("hypotheses",false,client);await nextTick();
    if(inspectorOpen.value)await loadNode(client);
  }else if(["experiments","resources"].includes(route.value))await loadPage(route.value,false,client);
  else if(route.value==="settings")await loadSettings(client);
}
async function refresh(client=requireApi()){
  assertSession(client);clearTimeout(viewTimer);clearTimeout(projectTimer);
  await Promise.all([loadPage("projects",false,client),loadView(client)]);
  assertSession(client);refreshWarning.value="";
}
function invalidatePages(){
  mutationVersion++;
  for(const [name,page] of Object.entries(pages.value)){pageRequests[name]++;page.loading=false;page.stale=true;page.total=null;}
}
function applyMutation(kind,result,{deletedId,created=false}={}){
  invalidatePages();
  if(deletedId){
    data.value[kind]=data.value[kind].filter(item=>item.id!==deletedId);
    for(const [name,page] of Object.entries(pages.value))if((name==="nodeExperiments"?"experiments":name)===kind)page.ids=page.ids.filter(id=>id!==deletedId);
  }else if(result.data?.id){
    cacheRecords(kind,[result.data]);
    if(created){
      for(const name of kind==="experiments"?["experiments","nodeExperiments"]:[kind]){
        const page=pages.value[name],filters=filtersFor(name),item=result.data;
        const matches=(!filters.projectId||(kind==="experiments"?hypothesesById.value.get(item.hypothesisId)?.projectId:item.projectId)===filters.projectId)&&(!filters.status||item.status===filters.status)&&(!filters.hypothesisId||item.hypothesisId===filters.hypothesisId)&&(!filters.nodeId||item.nodeId===filters.nodeId)&&(!filters.q||JSON.stringify(item).toLowerCase().includes(filters.q.toLowerCase()));
        if(page.filters&&matches)page.ids=[item.id,...page.ids.filter(id=>id!==item.id)];
      }
    }
  }
  if(result.affectedHypothesis)cacheRecords("hypotheses",[result.affectedHypothesis]);
  const removed=new Set(result.deletedExperimentIds||[]);
  if(kind==="hypotheses"&&deletedId)for(const item of data.value.experiments)if(item.hypothesisId===deletedId)removed.add(item.id);
  if(removed.size){data.value.experiments=data.value.experiments.filter(item=>!removed.has(item.id));for(const name of ["experiments","nodeExperiments"])pages.value[name].ids=pages.value[name].ids.filter(id=>!removed.has(id));}
}
async function afterMutation(client,label,submittedModal=modal.value){
  assertSession(client);
  if(modal.value===submittedModal)modal.value=null;
  message(label);
  try{await refresh(client);}
  catch(error){if(client===api&&!isRequestCancelled(error)){refreshWarning.value=label+"，但列表刷新失败："+(error.message||"请重试刷新");message(refreshWarning.value);}}
}
function clearConnection(){
  clearNodeDrafts();session?.abort();session=null;api=null;mutationVersion++;settingsRequest++;
  for(const name of Object.keys(pageRequests))pageRequests[name]++;
  clearTimeout(viewTimer);clearTimeout(projectTimer);
  connection.value=null;data.value=blank();pages.value=blankPages();tokens.value=[];nodeId.value="";hypothesisId.value="";projectId.value="";projectSearch.value="";settingsError.value="";refreshWarning.value="";nodeReferencesError.value="";inspectorOpen.value=false;focused.value=false;
  localStorage.removeItem("flowmaster.connection");sessionStorage.removeItem("flowmaster.connection");
}
function forget(){clearConnection();modal.value=null;}
function closeModal(){if(busy.value&&modal.value?.submit===connect)clearConnection();modal.value=null;}
async function connect(value){
  let baseUrl=(value.baseUrl||"").trim().replace(/\/$/,"");
  if(baseUrl){const u=new URL(baseUrl);if(u.username||u.password||u.search||u.hash||!(u.protocol==="https:"||u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))throw new Error("服务地址需要 HTTPS，且不能包含账号、查询参数或片段");}
  const c={baseUrl,token:value.token.trim(),remember:!!value.remember};
  if(!c.token)throw new Error("请输入访问 Token");
  clearConnection();const candidate=new AbortController();session=candidate;api=makeClient(c,candidate.signal);const client=api;
  try{await refresh(client);assertSession(client);connection.value=c;(c.remember?localStorage:sessionStorage).setItem("flowmaster.connection",JSON.stringify(c));message("工作区已连接");}
  catch(error){if(session===candidate)clearConnection();throw error;}
}
function login(){modal.value={kind:"form",title:"登录工作区",description:"填写 FlowMaster 管理员或访问 Token，不是 Cloudflare API Token。默认仅当前浏览器会话保存。",fields:[field("baseUrl","服务地址（同域留空）","url"),field("token","访问 Token","password"),field("remember","在此设备记住登录","checkbox")],value:{baseUrl:connection.value?.baseUrl||"",token:"",remember:false},submit:connect};}
function form(title,fields,value,submit,description=""){modal.value={kind:"form",title,fields,value:clone(value),submit,description,error:""};}
function confirmAction(title,description,submit){modal.value={kind:"confirm",title,description,submit,error:""};}
async function submitModal(){const m=modal.value;await run(async()=>{m.error="";await m.submit(m.value);if(modal.value===m)modal.value=null;});}
async function save(kind,item){
  const client=requireApi(),submittedModal=modal.value,exists=!!item.id;
  const result=await client.mutation("/"+kind+(exists?"/"+encodeURIComponent(item.id):""),{method:exists?"PUT":"POST",body:JSON.stringify(item)});
  assertSession(client);applyMutation(kind,result,{created:!exists});
  if(kind==="hypotheses"&&!exists)hypothesisId.value=result.data.id;
  await afterMutation(client,"已保存",submittedModal);return result.data;
}
function editProject(item){form(item?"编辑项目":"新建项目",[field("name","项目名称"),field("description","项目说明","textarea")],item||{name:"",description:""},v=>save("projects",v));}
function editHypothesis(item){
  if(!data.value.projects.length){message("请先创建项目");return;}
  form(item?"编辑假设":"新建假设",[field("projectId","所属项目","select",projectOptions.value),field("title","假设标题"),field("description","假设说明","textarea"),field("baseline","基线"),field("status","状态","select",statuses)],item||{projectId:projectId.value||data.value.projects[0].id,title:"",description:"",baseline:"",status:"pending",nodes:[],edges:[]},v=>save("hypotheses",v));
}
function editResource(item){
  if(!data.value.projects.length){message("请先创建项目");return;}
  form(item?"编辑资源":"添加资源",[field("projectId","所属项目","select",projectOptions.value),field("name","资源名称"),field("type","类型","select",Object.entries(resourceLabel).map(([value,label])=>({value,label}))),field("url","链接","url"),field("description","说明","textarea")],item||{projectId:projectId.value||data.value.projects[0].id,name:"",type:"document",url:"",description:""},v=>save("resources",v));
}
function remove(kind,item){confirmAction("确认删除","删除后无法从页面恢复。删除假设也会删除其关联实验记录。",async()=>{
  const client=requireApi(),submittedModal=modal.value;
  const result=await client.mutation("/"+kind+"/"+encodeURIComponent(item.id),{method:"DELETE"});
  assertSession(client);applyMutation(kind,result,{deletedId:item.id});await afterMutation(client,"已删除",submittedModal);
});}
function addNode({width}={}){const h=current.value;if(!h)return;form("添加流程节点",[field("title","节点标题"),field("type","节点类型","select",Object.entries(nodeTypeLabel).map(([value,label])=>({value,label})))],{title:"新的验证节点",type:"experiment"},async v=>{const {x,y}=newNodePosition(h.nodes,width);const node={...emptyNode(crypto.randomUUID(),v.title,x,y),type:v.type};await save("hypotheses",{...h,nodes:[...h.nodes,node]});if(current.value?.id===h.id)nodeId.value=node.id;});}
function saveNode(){
  const h=current.value,n=nodeDraft.value;if(!h||!n)return;
  const submitted=clone(n),parents=[...upstream.value];
  const commit=async()=>{
    const client=requireApi(),submittedModal=modal.value;
    const result=await client.mutation("/hypotheses/"+h.id,{method:"PUT",body:JSON.stringify({...h,nodes:h.nodes.map(i=>i.id===submitted.id?submitted:i),edges:[...h.edges.filter(e=>e.target!==submitted.id),...parents.map(source=>({source,target:submitted.id}))]})});
    assertSession(client);acknowledgeNode(h.id,submitted,parents,result.data.nodes.find(i=>i.id===submitted.id));applyMutation("hypotheses",result);await afterMutation(client,"节点已保存",submittedModal);
  };
  if(nodeConflicted.value){confirmAction("确认覆盖冲突字段","服务端也修改了你的草稿字段。确认后使用当前草稿覆盖这些字段；取消可继续核对。",commit);return;}
  return commit();
}
function deleteNode(){const h=current.value,n=selectedNode.value;if(!n)return;confirmAction("删除流程节点","节点和相关连线将被移除，历史实验记录保留。",()=>save("hypotheses",{...h,nodes:h.nodes.filter(i=>i.id!==n.id),edges:h.edges.filter(e=>e.source!==n.id&&e.target!==n.id)}));}
function moveNode(position){run(()=>save("hypotheses",{...current.value,nodes:current.value.nodes.map(n=>n.id===position.id?{...n,x:position.x,y:position.y}:n)}));}
function layout({width,complete}){run(async()=>{const h=current.value;if(!h)return;await save("hypotheses",{...h,nodes:layoutNodes(h.nodes,h.edges,width)});await complete?.();});}
function resultForm(){const h=current.value,n=selectedNode.value;if(!n)return;form("录入实验结果",[field("title","实验标题"),field("status","结果状态","select",statuses),field("duration","实际耗时"),field("summary","结果摘要","textarea")],{nodeId:n.id,title:n.title,status:"pending",duration:"",summary:""},async v=>{const client=requireApi(),submittedModal=modal.value;const result=await client.mutation("/hypotheses/"+h.id+"/results",{method:"POST",body:JSON.stringify(v)});assertSession(client);applyMutation("experiments",result,{created:true});await afterMutation(client,"实验结果已保存",submittedModal);});}
function showExperiment(e){modal.value={kind:"detail",title:e.title,record:e};}
function editExperiment(e){form("编辑实验记录",[field("title","标题"),field("status","状态","select",statuses),field("duration","耗时"),field("summary","摘要","textarea")],e,v=>save("experiments",v),"编辑节点当前采用的实验记录会同步更新节点结果；其他历史记录只更新自身。");}
function download(value,name){const url=URL.createObjectURL(value instanceof Blob?value:new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportWorkspace(){const client=requireApi();message("正在导出完整工作区…");const blob=await workspaceBlob(client);assertSession(client);download(blob,"flowmaster-workspace.json");message("工作区已导出");}
async function exportExperiments(){const client=requireApi();message("正在导出筛选后的全部记录…");const blob=await collectionBlob(client,"experiments",filtersFor("experiments"));assertSession(client);download(blob,"flowmaster-experiments.json");message("实验记录已导出");}
async function loadSettings(client=requireApi()){
  const request=++settingsRequest;settingsError.value="";
  try{const list=await client("/tokens");assertSession(client);if(request===settingsRequest)tokens.value=list;}
  catch(error){if(client!==api||request!==settingsRequest||isRequestCancelled(error))return;settingsError.value=error.message;}
}
function createToken(){form("创建访问 Token",[field("name","名称"),field("scope","权限","select",[{value:"read",label:"只读"},{value:"write",label:"读写"},{value:"admin",label:"管理员"}]),field("expiresInDays","有效天数（1–365）","number")],{name:"",scope:"read",expiresInDays:30},async v=>{
  const client=requireApi();
  const created=await client("/tokens",{method:"POST",body:JSON.stringify({...v,expiresInDays:Number(v.expiresInDays)})});
  assertSession(client);modal.value={kind:"token",title:"请保存新 Token",token:created.token,description:"完整 Token 仅显示这一次。关闭后无法再次查看。"};
  await loadSettings(client);
  if(client===api&&settingsError.value)message("Token 已创建，但列表刷新失败；请先保存新 Token。");
});}
function revoke(t){confirmAction("撤销 Token","使用此 Token 的客户端将立即失去访问权限。",async()=>{
  const client=requireApi(),submittedModal=modal.value;await client("/tokens/"+t.id,{method:"DELETE"});assertSession(client);
  tokens.value=tokens.value.filter(item=>item.id!==t.id);if(modal.value===submittedModal)modal.value=null;message("Token 已撤销");
  await loadSettings(client);if(client===api&&settingsError.value)message("Token 已撤销，但列表刷新失败");
});}
function seed(){confirmAction("导入示例研究","仅允许向空工作区导入，不会覆盖现有数据。",async()=>{
  const client=requireApi(),submittedModal=modal.value;await client("/seed",{method:"POST"});assertSession(client);invalidatePages();await afterMutation(client,"示例已导入",submittedModal);
});}
function resolveRoute(){const hash=location.hash.slice(1),next=hash==="api"?"mcp":hash;return nav.some(([id])=>id===next)?next:"workspace";}
function hashChanged(){route.value=resolveRoute();}
onMounted(()=>{window.addEventListener("hashchange",hashChanged);window.addEventListener("keydown",workspaceKeydown);try{const saved=sessionStorage.getItem("flowmaster.connection")||localStorage.getItem("flowmaster.connection");if(saved)run(()=>connect(JSON.parse(saved)));}catch{forget();}});
onBeforeUnmount(()=>{session?.abort();clearTimeout(timer);clearTimeout(viewTimer);clearTimeout(projectTimer);window.removeEventListener("hashchange",hashChanged);window.removeEventListener("keydown",workspaceKeydown);});
</script>

<template>
<a class="skip" href="#main" @click.prevent="mainElement?.focus()">跳到内容</a>
<header v-show="!focused" class="app-header">
  <a class="brand" href="#workspace"><span class="logo">F</span>FlowMaster</a>
  <nav class="main-nav" aria-label="主导航"><a v-for="[id,label] in nav" :key="id" :href="'#'+id" :class="{active:route===id}" :aria-current="route===id?'page':undefined">{{label}}</a></nav>
  <div id="connection"><span v-if="connection" class="connection-status"><i aria-hidden="true"/>已连接</span><UiButton v-if="connection" @click="run(()=>refresh())" :busy="busy">刷新</UiButton><UiButton v-if="connection" @click="forget">退出</UiButton><UiButton v-else variant="primary" @click="login" :busy="busy">登录工作区</UiButton></div>
</header>
<div class="shell"><main ref="mainElement" id="main" tabindex="-1" :class="{'workbench':route==='workspace','focus-mode':focused}">
<div v-if="refreshWarning" class="refresh-warning" role="alert">{{refreshWarning}} <UiButton @click="run(()=>refresh())" :busy="busy">重试刷新</UiButton></div>
<div v-if="route!=='workspace'" class="toolbar page-heading"><div><h1>{{nav.find(([id])=>id===route)?.[1]}}</h1><p class="muted">以假设组织研究，用真实实验记录验证进展</p></div><UiButton v-if="connection" @click="run(exportWorkspace)" :busy="busy">导出工作区</UiButton></div>
<template v-if="route==='workspace'">
  <div class="workspace-heading">
    <div class="row"><UiButton v-if="connection" class="sidebar-toggle" :aria-expanded="sidebarOpen" aria-controls="hypothesis-list" @click="sidebarOpen=!sidebarOpen"><span aria-hidden="true">☷</span> {{sidebarOpen?'收起列表':'假设列表'}}</UiButton><h1>{{focused?'研究画布':'研究工作区'}}</h1></div>
    <div v-if="!focused" class="workspace-stats" aria-label="当前假设列表"><span><b>{{pages.hypotheses.total??'—'}}</b> 匹配假设</span><span><b>{{hypotheses.length}}</b> 已加载</span></div>
    <UiButton v-if="connection&&!focused" class="export-button" @click="run(exportWorkspace)" :busy="busy">导出</UiButton>
  </div>
  <div v-if="!connection" class="panel empty welcome"><span class="eyebrow">RESEARCH WORKSPACE</span><h2>让每一步研究，都有迹可循</h2><p>登录后在画布中组织假设、连接验证步骤与实验结果。</p><UiButton variant="primary" @click="login">登录工作区</UiButton></div>
  <div v-else class="workspace" :class="{'sidebar-open':sidebarOpen}">
    <aside v-if="sidebarOpen" id="hypothesis-list" class="hypothesis-sidebar" aria-label="假设列表">
      <div class="sidebar-heading"><h2>研究假设 <span>{{pages.hypotheses.total??'—'}}</span></h2><UiButton @click="editHypothesis()" :busy="busy" aria-label="新建假设" title="新建假设">＋</UiButton></div>
      <div class="sidebar-filters"><ProjectPicker v-model="projectId" v-model:search="projectSearch" :options="projectOptions" :page="pages.projects" @more="background(()=>loadPage('projects',true))" @retry="background(()=>loadPage('projects'))"/><input v-model="search" maxlength="200" placeholder="搜索假设…" aria-label="搜索假设"><select v-model="status" aria-label="筛选假设状态"><option value="">全部状态</option><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select></div>
      <div class="hypothesis-items"><button v-for="h in hypotheses" :key="h.id" class="hypothesis-item" :class="{selected:current?.id===h.id}" :aria-current="current?.id===h.id?'true':undefined" :title="h.title" @click="selectHypothesis(h.id)"><span class="hypothesis-project">{{projectName(h.projectId)}}</span><strong>{{h.title}}</strong><span class="item-footer"><span class="badge" :class="h.status">{{statusLabel[h.status]||h.status}}</span><small>{{h.nodes.length}} 节点</small></span></button><p v-if="!hypotheses.length&&!pages.hypotheses.loading" class="empty">暂无匹配的假设</p><CollectionPager :page="pages.hypotheses" :count="hypotheses.length" label="假设分页" @more="background(()=>loadPage('hypotheses',true))" @retry="background(()=>loadPage('hypotheses'))"/></div>
      <div class="sidebar-footer"><UiButton @click="editProject()" :busy="busy">＋ 新建项目</UiButton></div>
    </aside>
    <div v-if="current" class="flow-main">
      <section class="flow-heading" aria-label="当前研究假设">
        <div class="flow-title-row"><div class="flow-title"><div class="flow-breadcrumb"><span>{{projectName(current.projectId)}}</span><span aria-hidden="true">/</span><span>研究流程</span><span class="badge" :class="current.status">{{statusLabel[current.status]||current.status}}</span></div><h2>{{current.title}}</h2></div><div class="flow-actions"><UiButton @click="editHypothesis(current)" :busy="busy">编辑假设</UiButton><details class="hypothesis-menu"><summary aria-label="更多假设操作">•••</summary><div><UiButton variant="danger" @click="remove('hypotheses',current)" :busy="busy">删除假设</UiButton></div></details></div></div>
        <div v-if="!focused&&(current.baseline||current.description)" class="flow-context"><span v-if="current.baseline" class="baseline" :title="current.baseline"><b>基线</b> {{current.baseline}}</span><button v-if="current.description" class="text-button" aria-haspopup="dialog" @click="showDescription">研究说明 ↗</button></div>
      </section>
      <FlowCanvas :key="current.id" :hypothesis="current" :selected-id="nodeId" :busy="busy" :focused="focused" @select="nodeId=$event" @inspect="openInspector" @focus="toggleFocus" @move="moveNode" @add="addNode" @layout="layout"/>
      <button v-if="selectedNode&&!inspectorOpen" class="selected-node-hint" @click="openInspector(nodeId)"><span class="selection-dot"/>已选中：<strong>{{selectedNode.title}}</strong><span>查看详情 →</span></button>
    </div>
    <section v-else class="panel empty"><h2>开始你的研究流程</h2><p>先创建项目，再添加假设与验证节点</p><UiButton @click="editHypothesis()" :busy="busy">＋ 新建假设</UiButton></section>
  </div>
  <NodeDrawer v-if="inspectorOpen&&nodeDraft&&current" :title="editingNode?'编辑节点':'节点详情'" :content-key="nodeId" :return-focus="selectedNodeElement" @close="closeInspector">
    <p v-if="nodeDirty" class="draft-note" role="status">有未保存的草稿。关闭详情或切换节点仍会保留；刷新页面或退出后丢失。<button v-if="!editingNode" class="text-button" @click="editingNode=true">继续编辑 →</button></p>
    <p v-if="nodeConflicted" class="form-error">服务端内容已变化，请核对草稿中的冲突字段后再保存。</p>
    <NodeOverview v-if="!editingNode" :key="current.id+':'+nodeId" :node="selectedNode" :experiments="nodeExperiments" :experiment-total="pages.nodeExperiments.total" :history-loading="pages.nodeExperiments.loading" :resources="data.resources" :node-options="current.nodes" :edges="current.edges" @edit="editingNode=true" @result="resultForm" @history="showExperiment"/>
    <template v-if="!editingNode"><p v-if="nodeReferencesError" class="form-error">{{nodeReferencesError}}</p><CollectionPager :page="pages.nodeExperiments" :count="nodeExperiments.length" label="节点实验记录分页" @more="background(()=>loadPage('nodeExperiments',true))" @retry="background(()=>loadNode())"/></template>
    <form v-if="editingNode" class="node-editor" @submit.prevent="run(saveNode)">
      <div class="editor-heading"><button type="button" class="text-button" @click="editingNode=false">← 返回概览</button><span class="muted">{{nodeDirty?'草稿未保存':'已保存'}}</span></div>
      <UiField label="节点标题"><input v-model="nodeDraft.title" required maxlength="200"></UiField>
      <UiField label="节点类型"><select v-model="nodeDraft.type"><option v-for="(label,value) in nodeTypeLabel" :value="value" :key="value">{{label}}</option></select></UiField>
      <details class="editor-section" open><summary>研究内容 <small>思路 · 方法 · 结论</small></summary><UiField v-for="[key,label] in nodeFields.filter(([key])=>['rationale','method','conclusion','nextAction'].includes(key))" :key="key" :label="label"><textarea v-model="nodeDraft[key]" maxlength="16000"/></UiField></details>
      <details class="editor-section"><summary>输入与输出 <small>数据 · 文件路径</small></summary><UiField v-for="[key,label] in nodeFields.filter(([key])=>['inputs','output'].includes(key))" :key="key" :label="label"><textarea v-model="nodeDraft[key]" maxlength="16000"/></UiField></details>
      <details class="editor-section"><summary>结果与时间</summary><p v-if="selectedNode.currentResultId" class="muted">当前结果由实验记录同步，请通过“录入实验结果”更新。</p><UiField label="状态"><select v-model="nodeDraft.status" :disabled="!!selectedNode.currentResultId"><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select></UiField><UiField label="结果摘要"><textarea v-model="nodeDraft.summary" :disabled="!!selectedNode.currentResultId" maxlength="16000"/></UiField><UiField label="实验开始时间"><input v-model="nodeDraft.startedAt" maxlength="100"></UiField><UiField label="实际耗时"><input v-model="nodeDraft.duration" :disabled="!!selectedNode.currentResultId" maxlength="100"></UiField></details>
      <details class="editor-section"><summary>上游节点 <small>{{upstream.length}} 个连接</small></summary><UiField label="依赖关系" hint="按住 Ctrl / Command 可多选，服务端会拒绝循环依赖"><select v-model="upstream" multiple><option v-for="n in upstreamOptions" :value="n.id" :key="n.id">{{n.title}}</option></select></UiField></details>
      <div class="editor-save"><UiButton type="submit" variant="primary" :busy="busy">保存节点</UiButton><UiButton @click="resultForm" :busy="busy">录入实验结果</UiButton></div>
      <div class="editor-danger"><UiButton variant="danger" @click="deleteNode" :busy="busy">删除节点</UiButton></div>
    </form>
  </NodeDrawer>
</template>
<template v-else-if="route==='projects'"><div class="toolbar"><p>组织不同研究方向的假设与资源</p><input v-model="projectSearch" maxlength="200" placeholder="搜索项目" aria-label="搜索项目"><UiButton variant="primary" @click="editProject()" :busy="busy||!connection">＋ 新建项目</UiButton></div><div class="cards"><article v-for="p in projects" :key="p.id" class="card"><h2>{{p.name}}</h2><p>{{p.description}}</p><small>更新于 {{date(p.updatedAt)}}</small><div class="actions"><UiButton @click="openProject(p.id)">打开</UiButton><UiButton @click="editProject(p)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('projects',p)" :busy="busy">删除</UiButton></div></article></div><div v-if="!projects.length&&!pages.projects.loading" class="panel empty">暂无匹配的项目，请登录后新建</div><CollectionPager v-if="connection" :page="pages.projects" :count="projects.length" label="项目分页" @more="background(()=>loadPage('projects',true))" @retry="background(()=>loadPage('projects'))"/></template>
<template v-else-if="route==='experiments'"><div class="toolbar"><input v-model="search" maxlength="200" placeholder="搜索实验记录" aria-label="搜索实验记录"><ProjectPicker v-model="projectId" v-model:search="projectSearch" :options="projectOptions" :page="pages.projects" @more="background(()=>loadPage('projects',true))" @retry="background(()=>loadPage('projects'))"/><select v-model="status" aria-label="实验状态"><option value="">全部状态</option><option v-for="s in statuses" :value="s.value" :key="s.value">{{s.label}}</option></select><UiButton @click="run(exportExperiments)" :busy="busy||!connection">导出记录</UiButton></div><div class="panel table-wrap"><table><thead><tr><th>实验 / 分析</th><th>所属假设</th><th>状态</th><th>耗时</th><th>操作</th></tr></thead><tbody><tr v-for="e in experiments" :key="e.id"><td><strong>{{e.title}}</strong><br><small>{{e.source==='agent'?'历史模型建议，不代表实验验证':'手动实验结果'}} · {{date(e.updatedAt)}}</small></td><td>{{hypothesisName(e.hypothesisId)}}</td><td><span class="badge" :class="e.status">{{statusLabel[e.status]}}</span></td><td>{{e.duration||'—'}}</td><td><div class="row"><UiButton @click="showExperiment(e)">详情</UiButton><UiButton @click="editExperiment(e)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('experiments',e)" :busy="busy">删除</UiButton></div></td></tr></tbody></table><p v-if="!experiments.length&&!pages.experiments.loading" class="empty">暂无实验记录；选择流程节点录入结果</p></div><CollectionPager v-if="connection" :page="pages.experiments" :count="experiments.length" label="实验记录分页" @more="background(()=>loadPage('experiments',true))" @retry="background(()=>loadPage('experiments'))"/></template>
<template v-else-if="route==='resources'"><div class="toolbar"><input v-model="search" maxlength="200" placeholder="搜索资源" aria-label="搜索资源"><ProjectPicker v-model="projectId" v-model:search="projectSearch" label="资源项目" :options="projectOptions" :page="pages.projects" @more="background(()=>loadPage('projects',true))" @retry="background(()=>loadPage('projects'))"/><UiButton variant="primary" @click="editResource()" :busy="busy||!connection">＋ 添加资源</UiButton></div><div class="cards"><article v-for="r in resources" :key="r.id" class="card"><span class="badge">{{resourceLabel[r.type]}}</span><h2>{{r.name}}</h2><p>{{r.description}}</p><small>{{projectName(r.projectId)}}</small><p v-if="safeUrl(r.url)"><a :href="safeUrl(r.url)" target="_blank" rel="noopener noreferrer">打开资源 ↗</a></p><div class="actions"><UiButton @click="editResource(r)" :busy="busy">编辑</UiButton><UiButton variant="danger" @click="remove('resources',r)" :busy="busy">删除</UiButton></div></article></div><p v-if="!resources.length&&!pages.resources.loading" class="panel empty">暂无资源</p><CollectionPager v-if="connection" :page="pages.resources" :count="resources.length" label="资源分页" @more="background(()=>loadPage('resources',true))" @retry="background(()=>loadPage('resources'))"/></template>
<template v-else-if="route==='mcp'"><section class="panel stack"><h2>MCP 接口</h2><p>连接地址为站点下的 /mcp，使用 Streamable HTTP 和 Authorization: Bearer YOUR_TOKEN。管理员、读写和只读 Token 控制操作权限，所有 Token 访问同一个共享工作区。</p><p>先通过 initialize 协商协议版本 2025-11-25，再发送 notifications/initialized。使用 tools/list 发现工具，使用 tools/call 调用工具；请求需包含 Accept: application/json, text/event-stream 和 MCP-Protocol-Version: 2025-11-25。</p><div class="pre">workspace_get · workspace_seed
projects_list · projects_get · projects_create · projects_update · projects_delete
hypotheses_list · hypotheses_get · hypotheses_create · hypotheses_update · hypotheses_delete
experiments_list · experiments_get · experiments_create · experiments_update · experiments_delete
resources_list · resources_get · resources_create · resources_update · resources_delete
results_create
tokens_list · tokens_create · tokens_revoke</div><p>项目、假设、实验和资源列表支持 limit、offset 和 q；hypotheses_list、experiments_list 和 resources_list 支持 projectId，假设与实验支持 status，实验还支持 hypothesisId 和 nodeId。分页使用返回的 nextOffset，直到其为 null。创建工具接收 data；更新工具接收 id 和含 revision 的 data；results_create 接收 hypothesisId 和实验结果 data。发生 revision 冲突时，请先刷新。</p><p>返回的 structuredContent.data 包含业务结果；工具错误通过 isError 和 structuredContent.error 返回。</p></section></template>
<template v-else-if="route==='settings'"><div class="stack"><section class="panel"><h2>工作区连接</h2><p>{{connection?'当前连接：'+(connection.baseUrl||'同域 MCP'):'尚未登录'}}</p><div class="row"><UiButton @click="login" :busy="busy">{{connection?'切换工作区':'登录工作区'}}</UiButton><UiButton v-if="connection" @click="forget">退出并清除凭据</UiButton></div></section><p v-if="settingsError" class="form-error">{{settingsError}}；Token 管理需要管理员权限</p><template v-if="connection&&!settingsError"><section class="panel"><div class="toolbar"><h2>访问 Token</h2><UiButton @click="createToken" :busy="busy">创建 Token</UiButton></div><div class="table-wrap"><table><thead><tr><th>名称</th><th>前缀</th><th>权限</th><th>到期时间</th><th></th></tr></thead><tbody><tr v-for="t in tokens" :key="t.id"><td>{{t.name}}</td><td>{{t.prefix}}…</td><td>{{t.scope}}</td><td>{{date(t.expiresAt)}}</td><td><UiButton variant="danger" @click="revoke(t)" :busy="busy">撤销</UiButton></td></tr></tbody></table></div></section><section class="panel"><h2>示例研究</h2><p>可选，仅在空工作区中导入示例。</p><UiButton @click="seed" :busy="busy">导入示例</UiButton></section></template></div></template>
</main></div>
<div id="notice" role="status" aria-live="polite">{{notice}}</div>
<UiModal v-if="modal" :title="modal.title" :busy="busy&&modal.submit!==connect" @close="closeModal"><p v-if="modal.description" class="muted">{{modal.description}}</p><p v-if="modal.error" class="form-error">{{modal.error}}</p>
<form v-if="modal.kind==='form'" @submit.prevent="submitModal"><UiField v-for="f in modal.fields" :key="f.key" :label="f.label"><textarea v-if="f.type==='textarea'" v-model="modal.value[f.key]" maxlength="16000"/><ProjectPicker v-else-if="f.key==='projectId'" v-model="modal.value[f.key]" v-model:search="projectSearch" :options="projectOptions" :page="pages.projects" :allow-all="false" label="所属项目" @more="background(()=>loadPage('projects',true))" @retry="background(()=>loadPage('projects'))"/><select v-else-if="f.type==='select'" v-model="modal.value[f.key]"><option v-for="o in f.options" :key="o.value" :value="o.value">{{o.label}}</option></select><input v-else-if="f.type==='checkbox'" v-model="modal.value[f.key]" type="checkbox"><input v-else v-model="modal.value[f.key]" :type="f.type" :autocomplete="f.type==='password'?'new-password':'off'" :maxlength="f.type==='password'?4096:f.type==='url'?2000:200" :min="f.type==='number'?1:undefined" :max="f.type==='number'?365:undefined" :required="['name','title','token'].includes(f.key)"></UiField><div class="actions"><UiButton type="button" @click="closeModal" :busy="busy&&modal.submit!==connect">取消</UiButton><UiButton type="submit" variant="primary" :busy="busy">{{busy?'处理中…':'保存'}}</UiButton></div></form>
<div v-else-if="modal.kind==='confirm'" class="actions"><UiButton @click="modal=null" :busy="busy">取消</UiButton><UiButton variant="primary" @click="submitModal" :busy="busy">确认</UiButton></div>
<div v-else-if="modal.kind==='description'"><h3>{{modal.subject}}</h3><p class="log research-description">{{modal.text}}</p></div>
<div v-else-if="modal.kind==='detail'"><span class="badge" :class="modal.record.status">{{statusLabel[modal.record.status]}}</span><p class="log">{{modal.record.summary}}</p><h3>执行日志</h3><p v-for="(log,index) in modal.record.logs" :key="index" class="log"><small>{{log.time}}</small><br>{{log.message}}</p><UiButton @click="download(modal.record,'experiment.json')">导出此记录</UiButton></div>
<div v-else-if="modal.kind==='token'"><textarea readonly :value="modal.token" aria-label="新建 Token"/><div class="actions"><UiButton @click="modal=null">我已保存，关闭</UiButton></div></div>
</UiModal>
</template>
