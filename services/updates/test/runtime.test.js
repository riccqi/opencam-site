import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {decrypt,unsubscribeToken} from '../src/security.js';

test('real workerd + D1: immediate signup without email, one-click unsubscribe, and admin auth',async()=>{
 const bindings={RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,7).toString('base64'),SITE_ORIGIN:'https://opencam.app',API_ORIGIN:'https://updates-api.opencam.app',SIGNUPS_ENABLED:'true',ADMIN_TOKEN:'a'.repeat(40),TOKEN_KEY:'ab'.repeat(32),DATA_KEY:'cd'.repeat(32),RATE_KEY:'ef'.repeat(32),TURNSTILE_SECRET:'test',TURNSTILE_HOSTNAME:'opencam.app'};
 const mf=new Miniflare(convertV4MiniflareOptions({modules:['index.js','security.js','db.js','queue.js','mail.js'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name,import.meta.url)),contents:readFileSync(new URL('../src/'+name,import.meta.url),'utf8')})),modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)),compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings,
  outboundService:async(req)=>{assert.equal(new URL(req.url).host,'challenges.cloudflare.com');return Response.json({success:true,hostname:'opencam.app',action:'signup'});}}));
 try {
  const db=await mf.getD1Database('DB');
  const sql=['0001_initial.sql','0002_general_updates.sql'].map(name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')).join('\n');
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
