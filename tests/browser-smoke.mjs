import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE);
const origin="http://127.0.0.1:4173";
for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const emptyNode={id:"node1",title:"Smoke node",type:"experiment",status:"pending",x:40,y:40,inputs:"",output:"",summary:"",rationale:"",method:"",conclusion:"",nextAction:"",startedAt:"",duration:""};
const data={projects:[{id:"project1",name:"Smoke project",description:"Fixture only",revision:1}],hypotheses:[{id:"hypothesis1",projectId:"project1",title:"Smoke hypothesis",description:"No real data",baseline:"test",status:"pending",nodes:[emptyNode],edges:[],revision:1}],experiments:[],resources:[]};
const tokenList=[];
await page.route("**/api/v1/**",async route=>{
  const req=route.request(),p=new URL(req.url()).pathname.replace("/api/v1",""),method=req.method();
  const reply=value=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({data:value})});
  if(!req.headers().authorization)return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({error:{message:"Unauthorized"}})});
  if(p==="/workspace")return reply(data);
  if(p==="/settings/model")return reply({baseUrl:"https://model.example/v1",model:"fixture",hasKey:false});
  if(p==="/tokens"&&method==="GET")return reply(tokenList);
  if(p==="/tokens"&&method==="POST"){const b=req.postDataJSON();const t={...b,id:"token1",prefix:"fm_test",token:"fixture-token-not-real"};tokenList.push(t);return reply(t);}
  const [kind,id]=p.slice(1).split("/");
  if(data[kind]&&method==="POST"){const b={...req.postDataJSON(),id:"created-"+Date.now(),revision:1};data[kind].push(b);return reply(b);}
  if(data[kind]&&method==="PUT"){const b={...req.postDataJSON(),revision:2};data[kind]=data[kind].map(x=>x.id===id?b:x);return reply(b);}
  if(data[kind]&&method==="DELETE"){data[kind]=data[kind].filter(x=>x.id!==id);return reply({deleted:true});}
  throw new Error("Unexpected mocked API request: "+method+" "+p);
});
try{
  await page.goto(origin);
  await page.getByRole("heading",{name:"工作区为空",exact:true}).waitFor();
  await page.getByRole("button",{name:"管理员登录",exact:true}).click();
  await page.getByRole("dialog").getByLabel("访问 Token",{exact:true}).fill("fixture-admin-token");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Smoke hypothesis",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem("flowmaster.connection")),null);
  await page.locator(".node").first().click();
  await page.getByLabel("节点标题",{exact:true}).fill("Edited node");
  await page.getByRole("button",{name:"保存节点",exact:true}).click();
  await page.locator(".node").filter({hasText:"Edited node"}).waitFor();
  assert.equal(data.hypotheses[0].nodes[0].title,"Edited node");

  await page.getByRole("link",{name:"项目管理",exact:true}).click();
  await page.getByRole("button",{name:"＋ 新建项目",exact:true}).click();
  await page.getByRole("dialog").getByLabel("项目名称",{exact:true}).fill("Created project");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Created project",exact:true}).waitFor();
  await page.getByRole("link",{name:"研究工作区",exact:true}).click();

  mkdirSync("test-results",{recursive:true});
  await page.screenshot({path:"test-results/vue-desktop.png",fullPage:true});
  await page.getByRole("link",{name:"系统设置",exact:true}).click();
  await page.getByRole("button",{name:"创建 Token",exact:true}).click();
  await page.getByRole("dialog").getByLabel("名称",{exact:true}).fill("Fixture token");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"请保存新 Token",exact:true}).waitFor();
  await page.getByRole("button",{name:"我已保存，关闭",exact:true}).click();
  assert.equal(tokenList.length,1);
  await page.getByRole("link",{name:"资源库",exact:true}).click();
  await page.getByRole("button",{name:"＋ 添加资源",exact:true}).click();
  await page.getByRole("dialog").getByLabel("资源名称",{exact:true}).fill("Fixture resource");
  await page.getByRole("dialog").getByLabel("链接",{exact:true}).fill("https://example.com/");
  await page.getByRole("dialog").getByRole("button",{name:"保存",exact:true}).click();
  await page.getByRole("heading",{name:"Fixture resource",exact:true}).waitFor();

  await page.setViewportSize({width:390,height:844});
  await page.getByRole("link",{name:"研究工作区",exact:true}).click();
  await page.getByRole("heading",{name:"Smoke hypothesis",exact:true}).waitFor();
  await page.screenshot({path:"test-results/vue-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"退出",exact:true}).click();
  await page.getByRole("heading",{name:"工作区为空",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem("flowmaster.connection")),null);
  assert.deepEqual(errors,[]);
  console.log("PASS: Chromium desktop/mobile login, node editing, project/resource creation, Token dialog, navigation and logout with isolated mocked API");
}finally{
  if(errors.length)console.error(errors);
  await browser.close();
}
