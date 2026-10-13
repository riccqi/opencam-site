import {build} from 'esbuild';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {decrypt,unsubscribeToken} from '../src/security.js';

test('real workerd + D1: immediate signup without email, one-click unsubscribe, and admin auth',async()=>{
 const bindings={RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,7).toString('base64'),SITE_ORIGIN:'https://opencam.app',API_ORIGIN:'https://updates-api.opencam.app',SIGNUPS_ENABLED:'true',ADMIN_TOKEN:'a'.repeat(40),TOKEN_KEY:'ab'.repeat(32),DATA_KEY:'cd'.repeat(32),RATE_KEY:'ef'.repeat(32),TURNSTILE_SECRET:'test',TURNSTILE_HOSTNAME:'opencam.app'};
 const mf=new Miniflare(convertV4MiniflareOptions({modules:await bundled(readFileSync(new URL('../src/index.js',import.meta.url),'utf8')),modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)),compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings,
  outboundService:async(req)=>{assert.equal(new URL(req.url).host,'challenges.cloudflare.com');return Response.json({success:true,hostname:'opencam.app',action:'signup'});}}));
 try {
  const db=await mf.getD1Database('DB');
  const sql=['0001_initial.sql','0002_general_updates.sql','0003_dashboard.sql'].map(name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')).join('\n');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  const request=(path,data,headers={})=>mf.dispatchFetch(`${bindings.API_ORIGIN}${path}`,{method:data===undefined?'GET':'POST',headers:{origin:bindings.SITE_ORIGIN,'content-type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  let r=await request('/signup',{email:'runtime@example.com',turnstile:'test',source:'testflight'});assert.equal(r.status,202,await r.text());
  assert.equal((await db.prepare('SELECT count(*) n FROM deliveries').first()).n,0);
  assert.equal((await db.prepare('SELECT status FROM subscribers').first()).status,'subscribed');
  assert.equal((await db.prepare('SELECT confirmed_at FROM subscribers').first()).confirmed_at,null);
  const s=await db.prepare('SELECT * FROM subscribers').first();
  r=await mf.dispatchFetch(`${bindings.API_ORIGIN}/unsubscribe?token=${unsubscribeToken(bindings,s.id)}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});assert.equal(r.status,200);assert.equal((await db.prepare('SELECT status FROM subscribers').first()).status,'unsubscribed');
  assert.equal((await request('/admin/counts')).status,401);
  assert.equal((await request('/admin/counts',undefined,{authorization:`Bearer ${bindings.ADMIN_TOKEN}`})).status,200);
 const raw=JSON.stringify({type:'email.complained',data:{from:'OpenCam <updates@opencam.app>',to:['runtime@example.com']}});
 const id='runtime-event',ts=String(Math.floor(Date.now()/1000));
 const sig=createHmac('sha256',Buffer.from(bindings.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(`${id}.${ts}.${raw}`).digest('base64');
 r=await mf.dispatchFetch(`${bindings.API_ORIGIN}/events/resend`,{method:'POST',headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':ts,'svix-signature':`v1,${sig}`},body:raw});
 assert.equal(r.status,200,await r.text());assert.equal((await db.prepare('SELECT status FROM subscribers').first()).status,'suppressed');
 }finally{await mf.dispose();}
});

test('real workerd + D1 drains 100 recipients through one mocked Resend batch request',async()=>{
 let calls=0;
 const root=fileURLToPath(new URL('../src/',import.meta.url));
 const mf=new Miniflare(convertV4MiniflareOptions({modules:await bundled("import {drain} from './queue.js'; export default {async fetch(req,env){await drain(env);return new Response('ok')}};"),modulesRoot:root,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{SENDING_ENABLED:'true',LIVE_SEND_ENABLED:'true',DAILY_SEND_LIMIT:'0',POSTAL_ADDRESS:'Test address',TOKEN_KEY:'ab'.repeat(32),API_ORIGIN:'https://updates-api.opencam.app',REPLY_TO:'richard@opencam.app',RESEND_API_KEY:'fake'},outboundService:async req=>{
  assert.equal(req.url,'https://api.resend.com/emails/batch');calls++;
  const data=await req.json();assert.equal(data.length,100);assert.equal(new Set(data.map(d=>d.to[0])).size,100);
  return Response.json({data:data.map((_,i)=>({id:'mock-'+i}))});
 }}));
 try {
  const db=await mf.getD1Database('DB');
  const sql=['0001_initial.sql','0002_general_updates.sql','0003_dashboard.sql'].map(name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')).join('\n');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  await db.prepare("INSERT INTO campaigns(id,version,subject,notes,app_store_url,created_at,launched_at,campaign_type) VALUES('c','update:runtime','News','Hello','',1,1,'update')").run();
  for(let i=0;i<100;i++)await db.batch([
   db.prepare("INSERT INTO subscribers(id,email,status,source,signup_at,consent_version,unsubscribe_hash,last_confirmation_at,consent_evidence) VALUES(?,?,'subscribed','website',1,'opencam-updates-single-opt-in-v3',?,0,'{}')").bind('s'+i,`p${i}@example.com`,'h'+i),
   db.prepare("INSERT INTO deliveries(id,campaign_id,subscriber_id,kind,available_at) VALUES(?,'c',?,'announcement',0)").bind('d'+i,'s'+i)
  ]);
  assert.equal((await mf.dispatchFetch('https://local.test/')).status,200);
  assert.equal((await db.prepare("SELECT count(*) n FROM deliveries WHERE status='sent'").first()).n,100);
  await mf.dispatchFetch('https://local.test/');assert.equal(calls,1);
 }finally{await mf.dispose();}
});

async function bundled(contents){const result=await build({stdin:{contents,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),sourcefile:'test-worker.js'},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*']});return [{type:'ESModule',path:fileURLToPath(new URL('../src/bundled-test.js',import.meta.url)),contents:result.outputFiles[0].text}];}

test('bundled dashboard browser script routes each workspace to its own API',async()=>{
 const {runInNewContext}=await import('node:vm');
 const mf=new Miniflare(convertV4MiniflareOptions({modules:await bundled(readFileSync(new URL('../src/index.js',import.meta.url),'utf8')),modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)),compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat']}));
 try{
  for(const app of ['opencam','tabtab']){
   const source=await(await mf.dispatchFetch('https://studio.example/dashboard/app.js?app='+app)).text();
   const elements=new Map(),requests=[];
   runInNewContext(source,{document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);},querySelectorAll(){return [];},visibilityState:'visible'},window:{addEventListener(){}},setInterval(){},AbortSignal,fetch(url,options){requests.push({url,options});return new Promise(()=>{});}});
   assert.equal(requests.length,1);assert.equal(requests[0].url,app==='tabtab'?'/dashboard/api/tabtab/overview':'/dashboard/api/overview');assert.equal(requests[0].options.headers['X-OpenCam-Dashboard'],'1');
   elements.get('login-form').onsubmit({preventDefault(){}});
   assert.equal(requests[1].url,'/dashboard/api/login');
  }
 }finally{await mf.dispose();}
});
