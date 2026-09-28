import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const admin='smoke-admin-0123456789-0123456789-0123456789';
const serverRoot=path.resolve('dist/server');
const modulePaths=readdirSync(serverRoot,{recursive:true}).filter(p=>/\.m?js$/.test(p)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const modules=modulePaths.map(p=>({type:'ESModule',path:path.join(serverRoot,p)}));
const mf=new Miniflare({name:'flowmaster-smoke',modules,modulesRoot:serverRoot,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'smoke-db'},bindings:{ADMIN_TOKEN:admin,ENCRYPTION_KEY:'smoke-encryption-0123456789-0123456789-different'},assets:{directory:path.resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,static_routing:{user_worker:['/api/*']}}},cf:false});
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const page=await mf.dispatchFetch('https://flowmaster.example/');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('FlowMaster'));assert.ok(html.includes('假设列表'));assert.ok(!html.includes('Your site is taking shape'));
 const asset=await mf.dispatchFetch('https://flowmaster.example/favicon.svg');assert.equal(asset.status,200);assert.ok((await asset.text()).includes('#2563eb'));
 const unauthorized=await mf.dispatchFetch('https://flowmaster.example/api/v1/workspace');assert.equal(unauthorized.status,401);
 const workspace=await mf.dispatchFetch('https://flowmaster.example/api/v1/workspace',{headers:{Authorization:`Bearer ${admin}`}});assert.equal(workspace.status,200);const data=await workspace.json();assert.deepEqual(data.data,{projects:[],hypotheses:[],experiments:[],resources:[]});
 const seed=await mf.dispatchFetch('https://flowmaster.example/api/v1/seed',{method:'POST',headers:{Authorization:`Bearer ${admin}`}});assert.equal(seed.status,201);
 const result=await mf.dispatchFetch('https://flowmaster.example/api/v1/hypotheses',{headers:{Authorization:`Bearer ${admin}`}});assert.equal(result.status,200);assert.equal((await result.json()).data.length,6);
 const spec=await mf.dispatchFetch('https://flowmaster.example/openapi.json');assert.equal(spec.status,200);assert.equal((await spec.json()).openapi,'3.0.3');
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/ssr.html',html);
 console.log('PASS: compiled Cloudflare Worker renders the UI, serves assets, authenticates API routes and reads/writes D1.');
}finally{await mf.dispose();}
