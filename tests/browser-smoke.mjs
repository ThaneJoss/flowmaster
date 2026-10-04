import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { nodeOperationSchemas, schemas } from "../lib/server/validation.ts";
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE);
const origin="http://127.0.0.1:4173";
for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const emptyNode={id:"node1",title:"Smoke node",type:"experiment",status:"pending",progress:"pending",resourceIds:[],currentResultId:null,x:40,y:40,inputs:"",output:"",summary:"",rationale:"",method:"",conclusion:"",nextAction:"",startedAt:"",duration:""};
const data={projects:[{id:"project1",name:"Smoke project",description:"Fixture only",revision:1}],hypotheses:[{id:"hypothesis1",projectId:"project1",title:"Smoke hypothesis",description:"No real data",baseline:"test",status:"pending",nodes:[emptyNode],edges:[],revision:1}],experiments:[{id:"historical1",hypothesisId:"hypothesis1",nodeId:"node1",title:"Historical suggestion",source:"agent",status:"pending",summary:"Retained historical record",duration:"",logs:[],resourceIds:[],recordedAt:"2026-10-02T00:00:00Z",recordedAtInferred:true,revision:1}],resources:[]};
data.projects.push(...Array.from({length:30},(_,i)=>({id:`extra-${i+1}`,name:`Extra project ${i+1}`,description:"",revision:1})));
data.resources.push({id:"resource1",projectId:"project1",name:"Existing evidence",type:"document",url:"https://example.com/evidence",description:"",revision:1});
const tokenList=[];
let failNextProjects=false,failRecords=false,projectsGate=null;
async function bounded(promise,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label+" timed out")),15000))]);}
  finally{clearTimeout(timer);}
}
function delayNextProjects(){
  let release,started,completed;
  const wait=new Promise(resolve=>release=resolve);
  const requested=new Promise(resolve=>started=resolve);
  const finished=new Promise(resolve=>completed=resolve);
  projectsGate={wait,started,completed};
  return {release,requested,finished};
}
function list(kind,args){
  const rows=data[kind].filter(item=>
    (!args.projectId||(kind==="experiments"?data.hypotheses.find(h=>h.id===item.hypothesisId)?.projectId:item.projectId)===args.projectId)&&
    (!args.hypothesisId||item.hypothesisId===args.hypothesisId)&&(!args.nodeId||item.nodeId===args.nodeId)&&
    (!args.status||item.status===args.status)&&(!args.q||[item.name,item.title,item.description,item.summary].some(value=>value?.includes(args.q))));
  const offset=args.offset||0,limit=kind==="experiments"?1:(args.limit||100),items=rows.slice(offset,offset+limit),next=offset+items.length;
  return {data:items,total:rows.length,nextOffset:next<rows.length?next:null};
}
await page.route("**/mcp",async route=>{
  const req=route.request(),rpc=req.postDataJSON();
  assert.equal(req.method(),"POST");
  assert.equal(rpc.jsonrpc,"2.0");
  const result=value=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:value})});
  const payload=value=>result({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value});
  const reply=value=>payload({data:value});
  const failure=(message,status=401)=>{const value={error:{code:status===409?"REVISION_CONFLICT":status===422?"VALIDATION_ERROR":"UNAUTHORIZED",message},status};return result({isError:true,content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value});};
  if(!req.headers().authorization)return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:rpc.id,error:{code:-32001,message:"Unauthorized"}})});
  if(rpc.method==="initialize")return result({protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"FlowMaster",version:"2.0.0"}});
  if(rpc.method==="notifications/initialized")return route.fulfill({status:202,body:""});
  assert.equal(rpc.method,"tools/call");
  const {name,arguments:args}=rpc.params;
  if(name==="projects_list"){
    if(failNextProjects){failNextProjects=false;return failure("Fixture invalid token");}
    const gate=projectsGate;projectsGate=null;
    if(gate){gate.started();await gate.wait;try{return await payload(list("projects",args));}finally{gate.completed();}}
    return payload(list("projects",args));
  }
  if(name==="experiments_list"&&failRecords)return failure("Fixture refresh unavailable",500);
  if(name==="results_create"){
    const current=data.hypotheses.find(item=>item.id===args.hypothesisId),node=current.nodes.find(item=>item.id===args.data.nodeId);
    const record={...args.data,id:"execution1",hypothesisId:current.id,nodeTitle:node.title,source:"manual",revision:1,recordedAt:"2026-10-05T00:00:00Z",recordedAtInferred:false,logs:[]};
    data.experiments.unshift(record);
    Object.assign(node,{currentResultId:record.id,status:record.status,summary:record.summary,duration:record.duration});current.revision++;
    failRecords=true;
    return payload({data:record,affectedHypothesis:current});
  }
  if(name==="tokens_list")return reply(tokenList);
  if(name==="tokens_create"){const t={...args.data,id:"token1",prefix:"fm_test",token:"fixture-token-not-real"};tokenList.push(t);return reply(t);}
  if(name==="tokens_revoke"){const index=tokenList.findIndex(t=>t.id===args.id);if(index!==-1)tokenList.splice(index,1);return reply({deleted:true,id:args.id});}
  if(name==="nodes_update"){
    const operation=nodeOperationSchemas.update.parse(args),index=data.hypotheses.findIndex(h=>h.id===operation.hypothesisId),current=data.hypotheses[index];
    assert.ok(current);
    if(operation.revision!==current.revision)return failure("Fixture revision conflict",409);
    const next={...current,nodes:current.nodes.map(node=>node.id===operation.nodeId?{...node,...operation.patch}:node),edges:operation.upstream===undefined?current.edges:[...current.edges.filter(edge=>edge.target!==operation.nodeId),...operation.upstream.map(source=>({source,target:operation.nodeId}))]};
    const parsed=schemas.hypotheses.safeParse(next);
    if(!parsed.success)return failure(parsed.error.issues.map(issue=>issue.message).join("；"),422);
    data.hypotheses[index]={...parsed.data,id:current.id,revision:current.revision+1};
    return reply(data.hypotheses[index]);
  }
  const [kind,action]=name.split("_");
  if(data[kind]&&action==="list")return payload(list(kind,args));
  if(data[kind]&&action==="get"){const item=data[kind].find(item=>item.id===args.id);assert.ok(item);return reply(item);}
  if(data[kind]&&action==="create"){const item={...args.data,id:`created-${kind}-${data[kind].length}`,revision:1};data[kind].push(item);return reply(item);}
  if(data[kind]&&action==="update"){const index=data[kind].findIndex(item=>item.id===args.id);assert.ok(index!==-1);const item={...data[kind][index],...args.data,id:args.id,revision:data[kind][index].revision+1};data[kind][index]=item;return reply(item);}
  if(data[kind]&&action==="delete"){data[kind]=data[kind].filter(item=>item.id!==args.id);return reply({deleted:true,id:args.id});}
  throw new Error("Unexpected mocked MCP tool: "+name);
});
const navigation=page.getByRole("navigation",{name:"主导航",exact:true});
const settings=async()=>{await navigation.getByRole("link",{name:"连接与设置",exact:true}).click();await page.getByRole("heading",{name:"连接与设置",exact:true}).waitFor();};
const projects=async()=>{await navigation.getByRole("link",{name:"项目",exact:true}).click();await page.getByRole("heading",{name:"项目",exact:true}).waitFor();};
const connectionForm=page.locator(".connection-form");
const login=async token=>{await settings();await connectionForm.getByLabel("访问 Token",{exact:true}).fill(token);await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).click();await page.getByRole("heading",{name:"Smoke project",exact:true}).waitFor();};
const openProject=async()=>{await projects();await page.locator(".project-cards .card").filter({hasText:"Smoke project"}).getByRole("button",{name:"进入项目",exact:true}).click();await page.getByRole("heading",{name:"Smoke hypothesis",exact:true}).waitFor();};
const logout=async()=>{await settings();await page.getByRole("button",{name:"退出并清除凭据",exact:true}).click();await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).waitFor();};
try{
  // Unknown fragments, including the old skip-link target, must render a route.
  for(const hash of ["main","not-a-route"]){
    await page.goto(origin+"/#"+hash);
    await page.getByRole("heading",{name:"项目",exact:true}).waitFor();
    await page.getByRole("heading",{name:"连接你的工作区",exact:true}).waitFor();
  }
  await projects();
  const skip=page.getByRole("link",{name:"跳到内容",exact:true});
  await skip.focus();await skip.press("Enter");
  assert.equal(new URL(page.url()).hash,"#projects");
  assert.equal(await page.evaluate(()=>document.activeElement?.id),"main");
  await page.getByRole("heading",{name:"项目",exact:true}).waitFor();
  await page.reload();
  await page.getByRole("heading",{name:"项目",exact:true}).waitFor();
  await page.getByRole("heading",{name:"连接你的工作区",exact:true}).waitFor();

  // Failed authentication keeps the inline form and input, and allows a retry.
  await settings();
  await connectionForm.getByLabel("访问 Token",{exact:true}).fill("fixture-invalid-token");
  failNextProjects=true;
  await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).click();
  await page.locator("#notice").filter({hasText:"Fixture invalid token"}).waitFor();
  assert.equal(await connectionForm.getByLabel("访问 Token",{exact:true}).inputValue(),"fixture-invalid-token");
  await connectionForm.getByLabel("访问 Token",{exact:true}).fill("fixture-retry-token");
  await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).click();
  await page.getByRole("heading",{name:"Smoke project",exact:true}).waitFor();
  await logout();

  // Inline cancellation and leaving settings replace the former login dialog's dismissals.
  for(const dismiss of ["取消连接","导航","Back"]){
    await projects();await settings();
    await connectionForm.getByLabel("访问 Token",{exact:true}).fill("fixture-cancelled-token");
    const gate=delayNextProjects();
    await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).click();
    await bounded(gate.requested,"Intercepted login request");
    assert.equal(await connectionForm.isVisible(),true);
    assert.equal(await connectionForm.getByRole("button",{name:"正在连接…",exact:true}).isDisabled(),true);
    const aborted=page.waitForEvent("requestfailed",{predicate:request=>new URL(request.url()).pathname==="/mcp"&&request.postDataJSON()?.method==="tools/call"&&request.postDataJSON()?.params?.name==="projects_list"});
    if(dismiss==="Back")await page.goBack();
    else if(dismiss==="导航")await projects();
    else await connectionForm.getByRole("button",{name:dismiss,exact:true}).click();
    await bounded(aborted,"Cancelled login request");
    gate.release();await bounded(gate.finished,"Cancelled login response teardown");
    if(dismiss==="取消连接")await connectionForm.getByRole("button",{name:"连接工作区",exact:true}).waitFor();
    else{
      assert.equal(new URL(page.url()).hash,"#projects");
      await page.getByRole("heading",{name:"连接你的工作区",exact:true}).waitFor();
    }
    assert.deepEqual(await page.evaluate(()=>[localStorage.getItem("flowmaster.connection"),sessionStorage.getItem("flowmaster.connection")]),[null,null]);
    assert.equal(await page.locator(".connection-status").count(),0);
  }

  await login("fixture-admin-token");
  assert.equal(await page.evaluate(()=>localStorage.getItem("flowmaster.connection")),null);
  const projectPages=page.locator('[aria-label="项目分页"]');
  assert.equal(await page.getByRole("heading",{name:"Extra project 30",exact:true}).count(),0);
  await projectPages.getByRole("button",{name:"下一页",exact:true}).click();
  await page.getByRole("heading",{name:"Extra project 30",exact:true}).waitFor();
  await projectPages.getByRole("button",{name:"上一页",exact:true}).click();
  await page.getByRole("heading",{name:"Smoke project",exact:true}).waitFor();
  await openProject();
  await page.locator('.node[data-node-id="node1"]').click();
  const drawer=page.locator(".node-drawer"),dialog=page.locator(".ui-modal");
  await drawer.getByLabel("执行进度",{exact:true}).selectOption("in_progress");
  const resourceSection=drawer.locator("details").filter({has:page.locator("summary").filter({hasText:"关联资料"})});
  await resourceSection.locator("summary").click();
  await resourceSection.getByRole("checkbox",{name:"Existing evidence",exact:true}).check();
  await drawer.getByRole("button",{name:"保存步骤",exact:true}).click();
  await drawer.locator(".unsaved").waitFor({state:"hidden"});
  assert.deepEqual(data.hypotheses[0].nodes[0].resourceIds,["resource1"]);
  assert.equal(data.hypotheses[0].nodes[0].status,"pending");
  await drawer.locator(".record-card").filter({hasText:"Historical suggestion"}).getByText("历史模型建议",{exact:true}).waitFor();
  assert.equal(await drawer.getByRole("button",{name:"设为当前结果",exact:true}).count(),0);

  // A committed execution stays successful when its history refresh fails.
  await drawer.getByRole("button",{name:"记录一次执行",exact:true}).click();
  await dialog.getByLabel("记录标题",{exact:true}).fill("Measured execution");
  await dialog.getByLabel("结果判定",{exact:true}).selectOption("verified");
  await dialog.getByLabel("结果摘要",{exact:true}).fill("Measured evidence");
  await dialog.getByRole("checkbox",{name:"Existing evidence",exact:true}).check();
  await dialog.getByRole("button",{name:"保存执行记录",exact:true}).click();
  await dialog.waitFor({state:"hidden"});
  await drawer.locator(".current-result").getByText("Measured evidence",{exact:true}).waitFor();
  await drawer.locator(".step-history").getByText(/Fixture refresh unavailable/).waitFor();
  assert.equal(data.experiments.filter(item=>item.id==="execution1").length,1);
  assert.equal(await drawer.getByLabel("执行进度",{exact:true}).inputValue(),"in_progress");
  failRecords=false;
  await drawer.locator(".step-history").getByRole("button",{name:"重新读取",exact:true}).click();
  await drawer.locator(".record-card").filter({hasText:"Measured execution"}).waitFor();
  await drawer.locator(".step-history").getByRole("button",{name:"下一页",exact:true}).click();
  await drawer.locator(".record-card").filter({hasText:"Historical suggestion"}).waitFor();
  await drawer.locator(".step-history").getByRole("button",{name:"上一页",exact:true}).click();
  await drawer.locator(".record-card").filter({hasText:"Measured execution"}).waitFor();
  await drawer.getByRole("button",{name:"关闭节点详情",exact:true}).click();
  await page.getByRole("navigation",{name:"项目内容",exact:true}).getByRole("button",{name:"记录",exact:true}).click();
  await page.locator(".record-list").getByRole("button",{name:"下一页",exact:true}).click();
  const historical=page.locator(".record-card").filter({hasText:"Historical suggestion"});
  await historical.getByRole("button",{name:"详情",exact:true}).click();
  await dialog.getByText("Retained historical record",{exact:true}).waitFor();
  await dialog.getByRole("button",{name:"打开所属步骤",exact:true}).click();
  await drawer.getByLabel("步骤标题",{exact:true}).waitFor();
  assert.ok(new URL(page.url()).hash.includes("step=node1"));
  await drawer.getByRole("button",{name:"关闭节点详情",exact:true}).click();

  await projects();
  await page.getByRole("button",{name:"新建项目",exact:true}).click();
  await page.getByRole("dialog").getByLabel("项目名称",{exact:true}).fill("Created project");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Created project",exact:true}).waitFor();
  await openProject();

  await settings();
  await page.getByRole("button",{name:"创建 Token",exact:true}).click();
  await page.getByRole("dialog").getByLabel("名称",{exact:true}).fill("Fixture token");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"请保存新 Token",exact:true}).waitFor();
  await page.getByRole("button",{name:"我已保存，关闭",exact:true}).click();
  assert.equal(tokenList.length,1);
  await openProject();
  await page.getByRole("navigation",{name:"项目内容",exact:true}).getByRole("button",{name:"资料",exact:true}).click();
  await page.getByRole("button",{name:"添加资料",exact:true}).first().click();
  await page.getByRole("dialog").getByLabel("资料名称",{exact:true}).fill("Fixture resource");
  await page.getByRole("dialog").getByLabel("链接",{exact:true}).fill("https://example.com/");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Fixture resource",exact:true}).waitFor();

  await logout();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem("flowmaster.connection")),null);
  assert.deepEqual(errors,[]);
  console.log("PASS: project navigation/pagination, login retry/cancellation, resource selection, independent progress/result, save-refresh separation, token issuance and logout");
}catch(error){
  mkdirSync("test-results",{recursive:true});
  await page.screenshot({path:"test-results/browser-failure.png",fullPage:true});
  throw error;
}finally{
  if(errors.length)console.error(errors);
  await browser.close();
}
