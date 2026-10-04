import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE);
const origin="http://127.0.0.1:4173";
for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const modal=title=>page.getByRole("dialog",{name:title,exact:true});
const loginDialog=modal("登录工作区");
const loginButton=page.locator("#connection").getByRole("button",{name:"登录工作区",exact:true});
const emptyNode={id:"node1",title:"Smoke node",type:"experiment",status:"pending",x:40,y:40,inputs:"",output:"",summary:"",rationale:"",method:"",conclusion:"",nextAction:"",startedAt:"",duration:""};
const data={projects:[{id:"project1",name:"Smoke project",description:"Fixture only",revision:1}],hypotheses:[{id:"hypothesis1",projectId:"project1",title:"Smoke hypothesis",description:"No real data",baseline:"test",status:"pending",nodes:[emptyNode],edges:[],revision:1}],experiments:[{id:"historical1",hypothesisId:"hypothesis1",nodeId:"node1",title:"Historical suggestion",source:"agent",status:"pending",summary:"Retained historical record",duration:"",logs:[],revision:1}],resources:[]};
data.projects.push(...Array.from({length:20},(_,i)=>({id:`extra-${i+1}`,name:`Extra project ${i+1}`,description:"",revision:1})));
const tokenList=[];
let failNextPage=false,failNextRefresh=false,pageGate=null;
async function bounded(promise,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label+" timed out")),15000))]);}
  finally{clearTimeout(timer);}
}
function delayNextPage(){
  let release,started,completed;
  const wait=new Promise(resolve=>release=resolve);
  const requested=new Promise(resolve=>started=resolve);
  const finished=new Promise(resolve=>completed=resolve);
  pageGate={wait,started,completed};
  return {release,requested,finished};
}
await page.route("**/mcp",async route=>{
  const req=route.request(),rpc=req.postDataJSON();
  assert.equal(req.method(),"POST");
  assert.equal(rpc.jsonrpc,"2.0");
  const result=value=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:value})});
  const reply=(value,meta={})=>{const payload={data:value,...meta};return result({content:[{type:"text",text:JSON.stringify(payload)}],structuredContent:payload});};
  const failure=(message,status=401)=>{const payload={error:{code:status===401?"UNAUTHORIZED":"INTERNAL_ERROR",message},status};return result({isError:true,content:[{type:"text",text:JSON.stringify(payload)}],structuredContent:payload});};
  if(!req.headers().authorization)return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:rpc.id,error:{code:-32001,message:"Unauthorized"}})});
  if(rpc.method==="initialize")return result({protocolVersion:"2025-11-25",capabilities:{tools:{}},serverInfo:{name:"FlowMaster",version:"2.0.0"}});
  if(rpc.method==="notifications/initialized")return route.fulfill({status:202,body:""});
  assert.equal(rpc.method,"tools/call");
  const {name,arguments:args}=rpc.params;
  const [kind,action]=name.split("_");
  if(data[kind]&&action==="list"){
    if(failNextPage){failNextPage=false;return failure("Fixture invalid token");}
    if(failNextRefresh){failNextRefresh=false;return failure("Fixture refresh unavailable",500);}
    const records=data[kind].filter(item=>{
      const projectId=kind==="experiments"?data.hypotheses.find(h=>h.id===item.hypothesisId)?.projectId:kind==="projects"?item.id:item.projectId;
      return (!args.projectId||projectId===args.projectId)&&(!args.status||item.status===args.status)
        &&(!args.q||JSON.stringify(item).toLowerCase().includes(args.q.toLowerCase()))
        &&(kind!=="experiments"||(!args.hypothesisId||item.hypothesisId===args.hypothesisId)&&(!args.nodeId||item.nodeId===args.nodeId));
    });
    const offset=args.offset||0,limit=args.limit||50;
    const items=records.slice(offset,offset+limit),next=offset+items.length;
    const respond=()=>reply(items,{total:records.length,nextOffset:next<records.length?next:null});
    const gate=pageGate;pageGate=null;
    if(gate){gate.started();await gate.wait;try{return await respond();}finally{gate.completed();}}
    return respond();
  }
  if(data[kind]&&action==="get")return reply(data[kind].find(item=>item.id===args.id));
  if(name==="tokens_list")return reply(tokenList);
  if(name==="tokens_create"){const t={...args.data,id:"token1",prefix:"fm_test",token:"fixture-token-not-real"};tokenList.push(t);return reply(t);}
  if(name==="tokens_revoke"){const index=tokenList.findIndex(t=>t.id===args.id);if(index!==-1)tokenList.splice(index,1);return reply({deleted:true});}
  if(data[kind]&&action==="create"){const b={...args.data,id:"created-"+Date.now(),revision:1};data[kind].unshift(b);return reply(b);}
  if(data[kind]&&action==="update"){const b={...args.data,id:args.id,revision:2};data[kind]=data[kind].map(x=>x.id===args.id?b:x);return reply(b);}
  if(data[kind]&&action==="delete"){data[kind]=data[kind].filter(x=>x.id!==args.id);return reply({deleted:true});}
  throw new Error("Unexpected mocked MCP tool: "+name);
});
try{
  await page.goto(origin+"/#not-a-route");
  await page.getByRole("heading",{name:"研究工作区",exact:true}).waitFor();
  await page.getByRole("heading",{name:"让每一步研究，都有迹可循",exact:true}).waitFor();
  await page.getByRole("link",{name:"项目管理",exact:true}).click();
  await page.getByRole("heading",{name:"项目管理",exact:true}).waitFor();
  const skip=page.getByRole("link",{name:"跳到内容",exact:true});
  await skip.focus();await skip.press("Enter");
  assert.equal(new URL(page.url()).hash,"#projects");
  assert.equal(await page.evaluate(()=>document.activeElement?.id),"main");
  await page.getByRole("heading",{name:"项目管理",exact:true}).waitFor();
  await page.reload();
  await page.getByRole("heading",{name:"项目管理",exact:true}).waitFor();
  await page.getByRole("link",{name:"研究工作区",exact:true}).click();
  await page.getByRole("heading",{name:"让每一步研究，都有迹可循",exact:true}).waitFor();

  // Failed authentication keeps the form and input, and allows a retry.
  await loginButton.click();
  await loginDialog.getByLabel("访问 Token",{exact:true}).fill("fixture-invalid-token");
  failNextPage=true;
  await loginDialog.getByRole("button",{name:"保存",exact:true}).click();
  await loginDialog.getByText("Fixture invalid token",{exact:true}).waitFor();
  assert.equal(await loginDialog.getByLabel("访问 Token",{exact:true}).inputValue(),"fixture-invalid-token");
  await loginDialog.getByLabel("访问 Token",{exact:true}).fill("fixture-retry-token");
  await loginDialog.getByRole("button",{name:"保存",exact:true}).click();
  await loginDialog.waitFor({state:"hidden"});
  await page.getByRole("heading",{name:"Smoke hypothesis",exact:true}).waitFor();
  await page.getByRole("button",{name:"退出",exact:true}).click();
  await page.getByRole("heading",{name:"让每一步研究，都有迹可循",exact:true}).waitFor();

  // Closing an in-flight login must abort it and prevent a late reconnection.
  for(const dismiss of ["取消","Escape","Back"]){
    if(dismiss==="Back"){
      await page.getByRole("link",{name:"项目管理",exact:true}).click();
      await page.getByRole("heading",{name:"项目管理",exact:true}).waitFor();
      await page.getByRole("link",{name:"系统设置",exact:true}).click();
      await page.getByRole("heading",{name:"系统设置",exact:true}).waitFor();
    }
    await loginButton.click();
    await loginDialog.getByLabel("访问 Token",{exact:true}).fill("fixture-cancelled-token");
    const gate=delayNextPage();
    await loginDialog.getByRole("button",{name:"保存",exact:true}).click();
    await bounded(gate.requested,"Intercepted login request");
    assert.equal(await loginDialog.isVisible(),true);
    assert.equal(await loginDialog.getByRole("button",{name:"处理中…",exact:true}).isDisabled(),true);
    const aborted=page.waitForEvent("requestfailed",{predicate:request=>new URL(request.url()).pathname==="/mcp"&&request.postDataJSON()?.method==="tools/call"&&request.postDataJSON()?.params?.name?.endsWith("_list")});
    if(dismiss==="Escape")await page.keyboard.press("Escape");
    else if(dismiss==="Back")await page.goBack();
    else await loginDialog.getByRole("button",{name:dismiss,exact:true}).click();
    await loginDialog.waitFor({state:"hidden"});
    await aborted;
    gate.release();await bounded(gate.finished,"Cancelled login response teardown");
    await page.waitForFunction(()=>[...document.querySelectorAll("#connection button")].some(button=>button.textContent.trim()==="登录工作区"&&!button.disabled));
    assert.deepEqual(await page.evaluate(()=>[localStorage.getItem("flowmaster.connection"),sessionStorage.getItem("flowmaster.connection")]),[null,null]);
    assert.equal(await page.locator(".connection-status").count(),0);
    if(dismiss==="Back"){
      assert.equal(new URL(page.url()).hash,"#projects");
      await page.getByRole("heading",{name:"项目管理",exact:true}).waitFor();
      await page.getByRole("link",{name:"研究工作区",exact:true}).click();
    }
  }

  await loginButton.click();
  await loginDialog.getByLabel("访问 Token",{exact:true}).fill("fixture-admin-token");
  await loginDialog.getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Smoke hypothesis",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem("flowmaster.connection")),null);
  await page.getByRole("link",{name:"实验记录",exact:true}).click();
  const historical=page.getByRole("row").filter({hasText:"Historical suggestion"});
  await historical.getByText("历史模型建议",{exact:false}).waitFor();
  await historical.getByRole("button",{name:"详情",exact:true}).click();
  await modal("Historical suggestion").getByText("Retained historical record",{exact:true}).waitFor();
  await modal("Historical suggestion").getByRole("button",{name:"关闭",exact:true}).click();

  await page.getByRole("link",{name:"项目管理",exact:true}).click();
  await page.getByText("已加载 20 / 共 21",{exact:false}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Extra project 20",exact:true}).count(),0);
  await page.getByRole("button",{name:"加载更多",exact:true}).click();
  await page.getByRole("heading",{name:"Extra project 20",exact:true}).waitFor();
  await page.getByRole("button",{name:"＋ 新建项目",exact:true}).click();
  await modal("新建项目").getByLabel("项目名称",{exact:true}).fill("Created project");
  await modal("新建项目").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Created project",exact:true}).waitFor();
  await page.getByRole("link",{name:"系统设置",exact:true}).click();
  await page.getByRole("button",{name:"创建 Token",exact:true}).click();
  await modal("创建访问 Token").getByLabel("名称",{exact:true}).fill("Fixture token");
  await modal("创建访问 Token").getByRole("button",{name:"保存",exact:true}).click();
  await modal("请保存新 Token").getByRole("heading",{name:"请保存新 Token",exact:true}).waitFor();
  await modal("请保存新 Token").getByRole("button",{name:"我已保存，关闭",exact:true}).click();
  assert.equal(tokenList.length,1);
  await page.getByRole("link",{name:"资源库",exact:true}).click();
  await page.getByRole("button",{name:"＋ 添加资源",exact:true}).click();
  await modal("添加资源").getByLabel("资源名称",{exact:true}).fill("Fixture resource");
  await modal("添加资源").getByLabel("链接",{exact:true}).fill("https://example.com/");
  failNextRefresh=true;
  await modal("添加资源").getByRole("button",{name:"保存",exact:true}).click();
  await modal("添加资源").waitFor({state:"hidden"});
  await page.locator("#notice").filter({hasText:"已保存，但列表刷新失败：Fixture refresh unavailable"}).waitFor();
  assert.equal(data.resources.filter(item=>item.name==="Fixture resource").length,1);
  await page.getByRole("button",{name:"刷新",exact:true}).click();
  await page.getByRole("heading",{name:"Fixture resource",exact:true}).waitFor();

  await page.getByRole("button",{name:"退出",exact:true}).click();
  await loginButton.waitFor({state:"visible"});
  await page.getByRole("heading",{name:"Fixture resource",exact:true}).waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem("flowmaster.connection")),null);
  assert.deepEqual(errors,[]);
  console.log("PASS: MCP login retry/cancellation, accessible routing, history, pagination, save/refresh separation, token issuance and logout");
}catch(error){
  mkdirSync("test-results",{recursive:true});
  await page.screenshot({path:"test-results/browser-failure.png",fullPage:true});
  throw error;
}finally{
  if(errors.length)console.error(errors);
  await browser.close();
}
