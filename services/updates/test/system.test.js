import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {createWorker} from '../src/index.js';
import {drain} from '../src/queue.js';
import {hash,now,decrypt,unsubscribeToken,email} from '../src/security.js';
import {sendResend,announcement} from '../src/mail.js';
function setup() {
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};}};} };},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const env={DB,POSTAL_ADDRESS:'Test postal address',ADMIN_TOKEN:'a'.repeat(40),TOKEN_KEY:'ab'.repeat(32),DATA_KEY:'cd'.repeat(32),RATE_KEY:'ef'.repeat(32),SITE_ORIGIN:'https://opencam.app',API_ORIGIN:'https://updates-api.opencam.app',RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,7).toString('base64'),SIGNUPS_ENABLED:'true',SENDING_ENABLED:'true',LIVE_SEND_ENABLED:'true',DAILY_SEND_LIMIT:'100',TURNSTILE_SECRET:'test',TURNSTILE_HOSTNAME:'opencam.app',TEST_RECIPIENTS:'delivered@resend.dev',REPLY_TO:'richard@opencam.app',RESEND_API_KEY:'test-key'};
 const fetcher=async(url)=>{
  if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'opencam.app',action:'signup'});
  if(String(url).includes('itunes.apple.com'))return Response.json({results:[{trackId:6743316690,version:'2.1.0'}]});
  throw new Error('Unexpected network call');
 };
 const worker=createWorker({fetch:fetcher});
 const req=(path,data,extra={})=>worker.fetch(new Request(`${env.API_ORIGIN}${path}`,{method:data===undefined?'GET':'POST',headers:{origin:env.SITE_ORIGIN,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1',...(path.startsWith('/admin/')?{authorization:`Bearer ${env.ADMIN_TOKEN}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),...extra}),env);
 const row=(sql,...args)=>db.prepare(sql).get(...args);
 const signup=(address='person@example.com')=>req('/signup',{email:address,turnstile:'valid',source:'app'});
 const confirm=async()=>{const d=row("SELECT * FROM deliveries WHERE kind='confirmation' ORDER BY rowid DESC");const p=decrypt(env,d.payload);const t=p.message.text.match(/token=([a-zA-Z0-9_-]+)/)[1];await req('/confirm',{token:t});return t;};
 const campaign=async()=>{const r=await req('/admin/campaigns',{version:'2.1.0',subject:'OpenCam update',notes:'New things <script>alert(1)</script>',app_store_url:'https://apps.apple.com/us/app/opencam-open-gate-camera/id6743316690'});assert.equal(r.status,200);return (await r.json()).id;};
 const unlock=()=>db.exec('UPDATE send_lock SET next_at=0');
 return {db,env,req,row,signup,confirm,campaign,unlock,fetcher};
}
test('double opt-in, scanner GET, duplicate signup, token reuse and non-enumerating responses',async()=>{
 const x=setup();const r=await x.signup(' Person@Example.com ');assert.equal(r.status,202);
 const original=await r.text();const t=decrypt(x.env,x.row('SELECT payload FROM deliveries').payload).message.text.match(/token=([\w-]+)/)[1];
 await x.req(`/confirm?token=${t}`);assert.equal(x.row('SELECT status FROM subscribers').status,'pending');
 await x.confirm();assert.equal(x.row('SELECT status,source FROM subscribers').status,'subscribed');assert.equal(x.row('SELECT source FROM subscribers').source,'app');
 assert.equal(await (await x.signup()).text(),original);assert.equal(x.row('SELECT count(*) AS n FROM deliveries').n,1);
 const again=await x.req('/confirm',{token:t});assert.match(await again.text(),/already used/);
});
test('expired and forged tokens never confirm',async()=>{const x=setup();await x.signup();x.db.exec('UPDATE subscribers SET confirm_expires=0');await x.confirm();assert.equal(x.row('SELECT status FROM subscribers').status,'pending');await x.req('/confirm',{token:'x'.repeat(43)});assert.equal(x.row('SELECT status FROM subscribers').status,'pending');});
test('unsubscribe scanner safety, RFC8058 POST, repeated unsubscribe, explicit resubscribe',async()=>{
 const x=setup();await x.signup();await x.confirm();const s=x.row('SELECT * FROM subscribers'),t=unsubscribeToken(x.env,s.id);
 await x.req(`/unsubscribe?token=${t}`);assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');
 const headers={'content-type':'application/x-www-form-urlencoded'};
 await x.req(`/unsubscribe?token=${t}`,undefined,{method:'POST',headers,body:'List-Unsubscribe=One-Click'});
 assert.equal(x.row('SELECT status FROM subscribers').status,'unsubscribed');
 await x.req('/unsubscribe',{token:t});x.db.exec('UPDATE subscribers SET last_confirmation_at=0');
 await x.signup();assert.equal(x.row('SELECT status FROM subscribers').status,'unsubscribed');await x.confirm();assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');
});
test('bot, origin, invalid input and global IP limits',async()=>{
 const x=setup();assert.equal((await x.req('/signup',{email:'bad',turnstile:'yes'})).status,400);
 assert.equal((await x.req('/signup',{email:'x@example.com',company:'robot',turnstile:'yes'})).status,202);assert.equal(x.row('SELECT count(*) n FROM subscribers').n,0);
 assert.equal((await x.req('/signup',{email:'x@example.com',turnstile:'yes'},{headers:{origin:'https://evil.example','content-type':'application/json'}})).status,403);
 for(let i=0;i<12;i++)await x.signup(`p${i}@example.com`);
 assert.equal((await x.signup()).status,429);
});
test('failed Turnstile and oversized requests are rejected',async()=>{
 const x=setup();const w=createWorker({fetch:async()=>Response.json({success:false})});
 const r=await w.fetch(new Request(x.env.API_ORIGIN+'/signup',{method:'POST',headers:{origin:x.env.SITE_ORIGIN,'content-type':'application/json'},body:JSON.stringify({email:'x@example.com',turnstile:'bad'})}),x.env);assert.equal(r.status,400);
 assert.equal((await x.req('/signup',{email:'x@example.com',extra:'x'.repeat(5000)})).status,413);
});
test('admin routes require bearer; public routes do not expose addresses',async()=>{
 const x=setup();await x.signup();const r=await x.req('/admin/counts',undefined,{headers:{}});assert.equal(r.status,401);
 assert.equal((await x.req('/subscribers')).status,404);assert.equal((await x.req('/admin/counts')).status,200);
 assert.equal((await x.req('/admin/search',{query:'person'})).status,200);
});
test('launch is atomic, idempotent, and requires a public App Store version',async()=>{
 const x=setup();await x.signup();await x.confirm();const id=await x.campaign();
 await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 const c=await x.req('/admin/campaigns',{version:'99.0',subject:'Future',notes:'No',app_store_url:'https://apps.apple.com/us/app/id6743316690'}),cid=(await c.json()).id;
 assert.equal((await x.req(`/admin/campaigns/${cid}/launch`,{confirm_version:'99.0'})).status,409);
 assert.equal((await x.req('/admin/campaigns',{version:'2.1.0',subject:'Different',notes:'No',app_store_url:'https://apps.apple.com/us/app/id6743316690'})).status,409);
});
test('unsubscribe and suppression while queued prevent announcement send',async()=>{
 const x=setup();await x.signup();await x.confirm();const id=await x.campaign();await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});
 await x.req('/admin/subscriber',{email:'person@example.com',action:'unsubscribe'});
 let sends=0;for(let i=0;i<3;i++){x.unlock();await drain(x.env,{send:async()=>{sends++;return {status:'sent',messageId:'a'};}});}
 assert.equal(sends,0);assert.equal(x.row("SELECT status FROM deliveries WHERE kind='announcement'").status,'skipped');
});
test('accepted sends are recorded and never repeated; rolling quota and minute lock apply',async()=>{
 const x=setup();await x.signup();let sends=0;const deps={send:async()=>{sends++;return {status:'sent',messageId:'ses-id'};}};
 await drain(x.env,deps);await drain(x.env,deps);assert.equal(sends,1);assert.equal(x.row('SELECT message_id FROM deliveries').message_id,'ses-id');
 await x.signup('another@example.com');x.unlock();x.env.DAILY_SEND_LIMIT='1';await drain(x.env,deps);assert.equal(sends,1);
});
test('explicit throttling is retried; transport ambiguity is held',async()=>{
 const x=setup();await x.signup();await drain(x.env,{send:async()=>({status:'retry',code:'throttled'})});assert.equal(x.row('SELECT status FROM deliveries').status,'retry');
 x.db.exec('UPDATE deliveries SET available_at=0');x.unlock();await drain(x.env,{send:async()=>({status:'ambiguous',code:'transport_uncertain'})});
 x.unlock();let sends=0;await drain(x.env,{send:async()=>{sends++;return {status:'sent'};}});assert.equal(sends,0);assert.equal(x.row('SELECT status FROM deliveries').status,'ambiguous');
});
test('interrupted sending becomes ambiguous without automatic resend',async()=>{
 const x=setup();await x.signup();x.db.exec("UPDATE deliveries SET status='sending',started_at=0");let sends=0;
 await drain(x.env,{send:async()=>{sends++;return {status:'sent'};}});assert.equal(sends,0);assert.equal(x.row('SELECT status FROM deliveries').status,'ambiguous');
});
function event(env,type='email.bounced',data={}) {
 const payload={type,data:{from:'OpenCam <updates@opencam.app>',to:['person@example.com'],...data}};
 const raw=JSON.stringify(payload),id='event-'+type,timestamp=String(now());
 const signature=createHmac('sha256',Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
 return {payload,extra:{headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`},body:raw}};
}
test('signed Resend bounce/complaint/suppression immediately suppress, replay safe, no reactivation',async()=>{
 for(const type of ['email.bounced','email.complained','email.suppressed']){
 const x=setup();await x.signup();await x.confirm();const m=event(x.env,type);
 assert.equal((await x.req('/events/resend',m.payload,m.extra)).status,200);
 assert.equal(x.row('SELECT status FROM subscribers').status,'suppressed');await x.req('/events/resend',m.payload,m.extra);assert.equal(x.row('SELECT count(*) n FROM events').n,1);
 x.db.exec('UPDATE subscribers SET last_confirmation_at=0');await x.signup();assert.equal(x.row('SELECT status FROM subscribers').status,'suppressed');
 }
});
test('forged signature, stale timestamp, and modified raw body are rejected',async()=>{
 const x=setup();await x.signup();
 for(const change of [{'svix-signature':'v1,AAAA'},{'svix-timestamp':'1'},{'svix-id':'different'}]){
 const m=event(x.env);m.extra.headers={...m.extra.headers,...change};assert.equal((await x.req('/events/resend',m.payload,m.extra)).status,403);}
 const m=event(x.env);m.extra.body+=' ';assert.equal((await x.req('/events/resend',m.payload,m.extra)).status,403);
 assert.equal(x.row('SELECT status FROM subscribers').status,'pending');
});
test('shared-account TabTab events cannot modify OpenCam contacts',async()=>{
 const x=setup();await x.signup();const m=event(x.env,'email.bounced',{from:'TabTab <updates@tabtabapp.net>'});
 assert.equal((await x.req('/events/resend',m.payload,m.extra)).status,200);assert.equal(x.row('SELECT status FROM subscribers').status,'pending');assert.equal(x.row('SELECT count(*) n FROM events').n,0);
});
test('signed Resend event reconciles ambiguous acceptance with delivery tag',async()=>{
 const x=setup();await x.signup();const d=x.row('SELECT id FROM deliveries');x.db.exec("UPDATE deliveries SET status='ambiguous'");
 const m=event(x.env,'email.delivered',{email_id:'known-id',tags:{delivery_id:d.id}});
 await x.req('/events/resend',m.payload,m.extra);assert.equal(x.row('SELECT status,message_id FROM deliveries').status,'sent');
});
test('test sends are allowlisted/idempotent and do not subscribe recipients',async()=>{
 const x=setup();const id=await x.campaign();assert.equal((await x.req(`/admin/campaigns/${id}/test`,{email:'stranger@example.com',request_id:'request-1'})).status,403);
 for(let i=0;i<2;i++)assert.equal((await x.req(`/admin/campaigns/${id}/test`,{email:'delivered@resend.dev',request_id:'request-1'})).status,200);
 assert.equal(x.row('SELECT count(*) n FROM deliveries').n,1);assert.equal(x.row('SELECT count(*) n FROM subscribers').n,0);
});
test('encrypted outbox, only token hashes in subscriber records, CSV formula defense',async()=>{
 const x=setup();await x.signup('+formula@example.com');const s=x.row('SELECT * FROM subscribers'),d=x.row('SELECT * FROM deliveries');assert.equal(s.confirm_hash.length,64);assert.ok(!d.payload.includes('example.com'));
 const csv=await (await x.req('/admin/export')).text();assert.match(csv,/"'\+formula@example.com"/);
});
test('Resend idempotency, unsubscribe headers, escaping and ambiguous provider responses',async()=>{
 const x=setup();const c={version:'2.1.0',subject:'Release',notes:'<script>bad</script>',app_store_url:'https://apps.apple.com/us/app/id6743316690'};
 const message=announcement(c,`${x.env.API_ORIGIN}/unsubscribe?token=abcdef`);assert.ok(!message.html.includes('<script>'));
 let sentBody;
 const result=await sendResend(x.env,'person@example.com',message,'delivery-id',async(url,init)=>{assert.equal(init.headers.authorization,'Bearer test-key');assert.equal(init.headers['Idempotency-Key'],'opencam-delivery-id');assert.equal(url,'https://api.resend.com/emails');sentBody=JSON.parse(init.body);return Response.json({id:'abc'});});
 assert.equal(result.status,'sent');assert.deepEqual(Object.keys(sentBody.headers),['List-Unsubscribe','List-Unsubscribe-Post']);
 assert.equal((await sendResend(x.env,'person@example.com',message,'id',async()=>{throw new Error('timeout');})).status,'ambiguous');
 assert.equal((await sendResend(x.env,'person@example.com',message,'id',async()=>new Response('',{status:429}))).status,'retry');
 assert.equal((await sendResend(x.env,'person@example.com',message,'id',async()=>new Response('',{status:500}))).status,'ambiguous');
});
test('malformed email rejects injection without removing plus tags',()=>{assert.equal(email('a+b@example.com'),'a+b@example.com');for(const s of ['a\nb@example.com','.a@example.com','a..b@example.com','a@-bad.com','a@example..com'])assert.equal(email(s),null);});

test('release launch requires a configured sender postal address',async()=>{const x=setup();const id=await x.campaign();delete x.env.POSTAL_ADDRESS;assert.equal((await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'})).status,409);});
