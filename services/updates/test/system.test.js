import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {createWorker} from '../src/index.js';
import {drain} from '../src/queue.js';
import {hash,now,decrypt,encrypt,token,unsubscribeToken,email} from '../src/security.js';
import {sendResend,sendResendBatch,announcement,confirmation} from '../src/mail.js';
function setup(options={}) {
 const db=new DatabaseSync(':memory:');db.exec(['0001_initial.sql','0002_general_updates.sql','0003_dashboard.sql','0004_drop_send_reservations.sql'].map(name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')).join('\n'));
 const DB={prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};}};} };},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const env={DB,POSTAL_ADDRESS:'Test postal address',ADMIN_TOKEN:'a'.repeat(40),TOKEN_KEY:'ab'.repeat(32),DATA_KEY:'cd'.repeat(32),RATE_KEY:'ef'.repeat(32),SITE_ORIGIN:'https://opencam.app',API_ORIGIN:'https://updates-api.opencam.app',RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,7).toString('base64'),SIGNUPS_ENABLED:'true',SENDING_ENABLED:'true',LIVE_SEND_ENABLED:'true',TURNSTILE_SECRET:'test',TURNSTILE_HOSTNAME:'opencam.app',TEST_RECIPIENTS:'delivered@resend.dev',REPLY_TO:'richard@opencam.app',RESEND_API_KEY:'test-key'};
 const fetcher=async(url)=>{
  if(String(url).includes('siteverify'))return Response.json({success:true,hostname:'opencam.app',action:'signup'});
  if(String(url).includes('itunes.apple.com'))return Response.json({results:[{trackId:6743316690,version:'2.1.0'}]});
  throw new Error('Unexpected network call');
 };
 const worker=createWorker({fetch:fetcher,...options});
 const req=(path,data,extra={})=>worker.fetch(new Request(`${env.API_ORIGIN}${path}`,{method:data===undefined?'GET':'POST',headers:{origin:env.SITE_ORIGIN,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1',...(path.startsWith('/admin/')?{authorization:`Bearer ${env.ADMIN_TOKEN}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),...extra}),env);
 const row=(sql,...args)=>db.prepare(sql).get(...args);
 const signup=(address='person@example.com')=>req('/signup',{email:address,turnstile:'valid',source:'app'});
 const confirm=async()=>{const d=row("SELECT * FROM deliveries WHERE kind='confirmation' ORDER BY rowid DESC");const p=decrypt(env,d.payload);const t=p.message.text.match(/token=([a-zA-Z0-9_-]+)/)[1];await req('/confirm',{token:t});return t;};
 const campaign=async()=>{const r=await req('/admin/campaigns',{version:'2.1.0',subject:'OpenCam update',notes:'New things <script>alert(1)</script>',app_store_url:'https://apps.apple.com/us/app/opencam-open-gate-camera/id6743316690'});assert.equal(r.status,200);return (await r.json()).id;};
 const unlock=()=>db.exec('UPDATE send_lock SET next_at=0');
 const legacySignup=async(address='person@example.com')=>{await signup(address);const t=token();db.prepare("UPDATE subscribers SET status='pending',consent_version='opencam-updates-2026-10-13-v2',confirm_hash=?,confirm_expires=?,last_confirmation_at=? WHERE email=?").run(hash(t),now()+86400,now(),address.toLowerCase());const user=row('SELECT id FROM subscribers WHERE email=?',address.toLowerCase());db.prepare("INSERT INTO deliveries(id,subscriber_id,kind,payload,available_at) VALUES(?,?,'confirmation',?,?)").run(token(),user.id,encrypt(env,{recipient:address,message:confirmation(env,t),confirmHash:hash(t)}),now());return t;};
 const queuedTest=async()=>{const id=await campaign();await req(`/admin/campaigns/${id}/test`,{email:'delivered@resend.dev',request_id:token()});};
 return {db,env,req,row,signup,confirm,legacySignup,queuedTest,campaign,unlock,fetcher};
}
test('signup activates immediately without email, is idempotent and preserves suppression',async()=>{
 const x=setup();const r=await x.signup(' Person@Example.com ');assert.equal(r.status,202);const message=await r.text();
 const first=x.row('SELECT * FROM subscribers');assert.equal(first.status,'subscribed');assert.equal(first.source,'app');assert.equal(first.confirmed_at,null);assert.equal(first.confirm_hash,null);assert.equal(JSON.parse(first.consent_evidence).method,'website_single_opt_in');
 assert.equal(await (await x.signup()).text(),message);assert.equal(x.row('SELECT count(*) n FROM subscribers').n,1);assert.equal(x.row('SELECT count(*) n FROM deliveries').n,0);
 x.db.exec("UPDATE subscribers SET status='suppressed'");assert.equal(await (await x.signup()).text(),message);assert.equal(x.row('SELECT status FROM subscribers').status,'suppressed');
 let sends=0;await drain(x.env,{send:async()=>{sends++;throw Error('Signup cannot send email');}});assert.equal(sends,0);
});
test('existing confirmation links remain scanner-safe, expiring and single-use',async()=>{
 const x=setup();const t=await x.legacySignup();await x.req(`/confirm?token=${t}`);assert.equal(x.row('SELECT status FROM subscribers').status,'pending');
 await x.confirm();assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');assert.match(await (await x.req('/confirm',{token:t})).text(),/already used/);
 const y=setup();await y.legacySignup();y.db.exec('UPDATE subscribers SET confirm_expires=0');await y.confirm();await y.req('/confirm',{token:'x'.repeat(43)});assert.equal(y.row('SELECT status FROM subscribers').status,'pending');
});
test('old queued confirmations are skipped without sending or activating pending contacts',async()=>{
 const x=setup();await x.legacySignup();await drain(x.env,{send:async()=>{throw Error('Confirmation must not send');}});assert.equal(x.row('SELECT error_code FROM deliveries').error_code,'confirmation_disabled');assert.equal(x.row('SELECT status FROM subscribers').status,'pending');
});
test('unsubscribe scanner safety, RFC8058 POST, repeated unsubscribe, explicit resubscribe',async()=>{
 const x=setup();await x.signup();const s=x.row('SELECT * FROM subscribers'),t=unsubscribeToken(x.env,s.id);
 await x.req(`/unsubscribe?token=${t}`);assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');
 const headers={'content-type':'application/x-www-form-urlencoded'};
 await x.req(`/unsubscribe?token=${t}`,undefined,{method:'POST',headers,body:'List-Unsubscribe=One-Click'});
 assert.equal(x.row('SELECT status FROM subscribers').status,'unsubscribed');
 await x.req('/unsubscribe',{token:t});x.db.exec('UPDATE subscribers SET last_confirmation_at=0');
 await x.signup();assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');
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
 const x=setup();await x.signup();const id=await x.campaign();
 await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 const c=await x.req('/admin/campaigns',{version:'99.0',subject:'Future',notes:'No',app_store_url:'https://apps.apple.com/us/app/id6743316690'}),cid=(await c.json()).id;
 assert.equal((await x.req(`/admin/campaigns/${cid}/launch`,{confirm_version:'99.0'})).status,409);
 assert.equal((await x.req('/admin/campaigns',{version:'2.1.0',subject:'Different',notes:'No',app_store_url:'https://apps.apple.com/us/app/id6743316690'})).status,409);
});
test('unsubscribe and suppression while queued prevent announcement send',async()=>{
 const x=setup();await x.signup();const id=await x.campaign();await x.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});
 await x.req('/admin/subscriber',{email:'person@example.com',action:'unsubscribe'});
 let sends=0;for(let i=0;i<3;i++){x.unlock();await drain(x.env,{send:async()=>{sends++;return {status:'sent',messageId:'a'};}});}
 assert.equal(sends,0);assert.equal(x.row("SELECT status FROM deliveries WHERE kind='announcement'").status,'skipped');
});
test('accepted sends are recorded and never repeated; the minute lock applies',async()=>{
 const x=setup();await x.queuedTest();let sends=0;const deps={send:async()=>{sends++;return {status:'sent',messageId:'ses-id'};}};
 await drain(x.env,deps);await drain(x.env,deps);assert.equal(sends,1);assert.equal(x.row('SELECT message_id FROM deliveries').message_id,'ses-id');
 await x.queuedTest();await drain(x.env,deps);assert.equal(sends,1);x.unlock();await drain(x.env,deps);assert.equal(sends,2);
});
test('explicit throttling is retried; transport ambiguity is held',async()=>{
 const x=setup();await x.queuedTest();await drain(x.env,{send:async()=>({status:'retry',code:'throttled'})});assert.equal(x.row('SELECT status FROM deliveries').status,'retry');
 x.db.exec('UPDATE deliveries SET available_at=0');x.unlock();await drain(x.env,{send:async()=>({status:'ambiguous',code:'transport_uncertain'})});
 x.unlock();let sends=0;await drain(x.env,{send:async()=>{sends++;return {status:'sent'};}});assert.equal(sends,0);assert.equal(x.row('SELECT status FROM deliveries').status,'ambiguous');
});
test('interrupted sending becomes ambiguous without automatic resend',async()=>{
 const x=setup();await x.queuedTest();x.db.exec("UPDATE deliveries SET status='sending',started_at=0");let sends=0;
 await drain(x.env,{send:async()=>{sends++;return {status:'sent'};}});assert.equal(sends,0);assert.equal(x.row('SELECT status FROM deliveries').status,'ambiguous');
});
function event(env,type='email.bounced',data={}) {
 const payload={type,data:{from:'OpenCam <richard@opencam.app>',to:['person@example.com'],...data}};
 const raw=JSON.stringify(payload),id='event-'+type,timestamp=String(now());
 const signature=createHmac('sha256',Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
 return {payload,extra:{headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`},body:raw}};
}
test('signed Resend bounce/complaint/suppression immediately suppress, replay safe, no reactivation',async()=>{
 for(const type of ['email.bounced','email.complained','email.suppressed']){
 const x=setup();await x.signup();const m=event(x.env,type);
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
 assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');
});
test('shared-account TabTab events cannot modify OpenCam contacts',async()=>{
 const x=setup();await x.signup();const m=event(x.env,'email.bounced',{from:'TabTab <richard@tabtabapp.net>'});
 assert.equal((await x.req('/events/resend',m.payload,m.extra)).status,200);assert.equal(x.row('SELECT status FROM subscribers').status,'subscribed');assert.equal(x.row('SELECT count(*) n FROM events').n,0);
});
test('signed Resend event reconciles ambiguous acceptance with delivery tag',async()=>{
 const x=setup();await x.queuedTest();const d=x.row('SELECT id FROM deliveries');x.db.exec("UPDATE deliveries SET status='ambiguous'");
 const m=event(x.env,'email.delivered',{email_id:'known-id',tags:{delivery_id:d.id}});
 await x.req('/events/resend',m.payload,m.extra);assert.equal(x.row('SELECT status,message_id FROM deliveries').status,'sent');
});
test('test sends are allowlisted/idempotent and do not subscribe recipients',async()=>{
 const x=setup();const id=await x.campaign();assert.equal((await x.req(`/admin/campaigns/${id}/test`,{email:'stranger@example.com',request_id:'request-1'})).status,403);
 for(let i=0;i<2;i++)assert.equal((await x.req(`/admin/campaigns/${id}/test`,{email:'delivered@resend.dev',request_id:'request-1'})).status,200);
 assert.equal(x.row('SELECT count(*) n FROM deliveries').n,1);assert.equal(x.row('SELECT count(*) n FROM subscribers').n,0);
});
test('encrypted outbox, only token hashes in subscriber records, CSV formula defense',async()=>{
 const x=setup();await x.legacySignup('+formula@example.com');const s=x.row('SELECT * FROM subscribers'),d=x.row('SELECT * FROM deliveries');assert.equal(s.confirm_hash.length,64);assert.ok(!d.payload.includes('example.com'));
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

test('general updates need no release, preserve narrow consent and require explicit key',async()=>{
 const x=setup();await x.signup();
 await x.signup('legacy@example.com');
 x.db.exec("UPDATE subscribers SET confirmed_at=1,consent_version='release-updates-2026-10-13' WHERE email='legacy@example.com'");
 const input={kind:'update',key:'community-news-october',subject:'Community news',notes:'An OpenCam update without a release.'};
 const created=await x.req('/admin/campaigns',input);assert.equal(created.status,200);const c=await created.json();
 assert.equal(c.campaign_type,'update');assert.equal(c.app_store_url,'');
 const preview=await (await x.req(`/admin/campaigns/${c.id}/preview`)).json();assert.match(preview.html,/<h1>Community news<\/h1>/);assert.doesNotMatch(preview.text,/Download:|update:community/);
 assert.equal((await x.req(`/admin/campaigns/${c.id}/launch`,{confirm_version:c.version})).status,400);
 assert.equal((await x.req(`/admin/campaigns/${c.id}/launch`,{confirm_key:input.key})).status,200);
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 assert.equal(x.row('SELECT public_verified_at FROM campaigns').public_verified_at,null);
 assert.equal((await x.req(`/admin/campaigns/${c.id}/launch`,{confirm_key:input.key})).status,200);
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 x.db.exec("UPDATE subscribers SET confirmed_at=1,consent_version='release-updates-2026-10-13' WHERE email='person@example.com'; UPDATE deliveries SET status='skipped' WHERE kind='confirmation'");
 await drain(x.env,{send:async()=>{throw Error('Narrow consent must not receive general updates');}});
 assert.equal(x.row("SELECT error_code FROM deliveries WHERE kind='announcement'").error_code,'consent_scope');
});

test('reviewed legacy form consent is sendable without inventing mailbox confirmation',async()=>{
 const x=setup();await x.signup();
 x.db.exec("UPDATE subscribers SET confirmed_at=NULL,consent_version='legacy-form-updates-owner-reviewed-2026-10-13',consent_evidence='{\"method\":\"legacy_form_single_opt_in\"}'");
 const c=await (await x.req('/admin/campaigns',{kind:'update',key:'legacy-update-test',subject:'News',notes:'An update'})).json();
 assert.equal((await x.req(`/admin/campaigns/${c.id}/launch`,{confirm_key:'legacy-update-test'})).status,200);
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 x.db.exec("UPDATE deliveries SET status='skipped' WHERE kind='confirmation'");let sent=0;
 await drain(x.env,{send:async()=>{sent++;return {status:'sent',messageId:'legacy-test'};}});assert.equal(sent,1);
 assert.equal(x.row('SELECT confirmed_at FROM subscribers').confirmed_at,null);
 const y=setup();await y.signup();y.db.exec("UPDATE subscribers SET confirmed_at=NULL,consent_version='legacy-form-updates-owner-reviewed-2026-10-13',consent_evidence=NULL");const id=await y.campaign();await y.req(`/admin/campaigns/${id}/launch`,{confirm_version:'2.1.0'});assert.equal(y.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,0);
});

async function seededCampaign(n) {
 const x=setup();
 const insert=x.db.prepare("INSERT INTO subscribers(id,email,status,source,signup_at,consent_version,unsubscribe_hash,last_confirmation_at,consent_evidence) VALUES(?,?,'subscribed','website',?,'opencam-updates-single-opt-in-v3',?,0,'{\"method\":\"website_single_opt_in\"}')");
 for(let i=0;i<n;i++)insert.run(`sub-${i}`,`person${i}@example.com`,now(),hash(`unsub-${i}`));
 const c=await(await x.req('/admin/campaigns',{kind:'update',key:'batch-test',subject:'News',notes:'Hello'})).json();
 await x.req(`/admin/campaigns/${c.id}/launch`,{confirm_key:'batch-test'});return x;
}
test('1725-person campaign completes in 18 batches with overlap protection and no daily cutoff',async()=>{
 const x=await seededCampaign(1725),seen=new Set(),sizes=[];
 const deps={sendBatch:async(env,items)=>{
  sizes.push(items.length);assert.ok(items.length<=100);
  return sendResendBatch(env,items,async(url,init)=>{
   assert.equal(url,'https://api.resend.com/emails/batch');const body=JSON.parse(init.body);
   for(const item of body){const id=item.tags.find(t=>t.name==='delivery_id').value;assert.ok(!seen.has(id));seen.add(id);assert.equal(item.to.length,1);assert.match(item.headers['List-Unsubscribe'],/unsubscribe/);assert.match(item.text,/Test postal address/);}
   return Response.json({data:body.map(item=>({id:'provider-'+item.tags[1].value}))});
  });
 }};
 for(let i=0;i<18;i++){x.unlock();await Promise.all([drain(x.env,deps),drain(x.env,deps)]);}
 assert.deepEqual(sizes,[...Array(17).fill(100),25]);assert.equal(seen.size,1725);
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='sent'").n,1725);
 x.unlock();await drain(x.env,deps);assert.equal(sizes.length,18);
});
test('batch eligibility and the disabled campaign gate are preserved',async()=>{
 const x=await seededCampaign(5);x.env.LIVE_SEND_ENABLED='false';
 await drain(x.env,{sendBatch:async()=>{throw Error('Disabled campaign');}});
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='queued'").n,5);
 x.env.LIVE_SEND_ENABLED='true';
 x.db.exec("UPDATE subscribers SET status='unsubscribed' WHERE id='sub-0'; UPDATE subscribers SET status='suppressed' WHERE id='sub-1'");
 const sent=[];const deps={sendBatch:async(_env,items)=>{sent.push(...items.map(i=>i.recipient));return items.map(i=>({status:'sent',messageId:i.id}));}};
 for(let i=0;i<5;i++){x.unlock();await drain(x.env,deps);}
 assert.equal(sent.length,3);assert.ok(!sent.includes('person0@example.com'));assert.ok(!sent.includes('person1@example.com'));
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='skipped'").n,2);assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='queued'").n,0);
});
test('batch provider handles throttle, uncertainty, malformed responses and ordered IDs',async()=>{
 const x=setup(),items=[0,1].map(i=>({id:`id-${i}`,recipient:`p${i}@example.com`,message:{subject:'Hi',text:'Hello',html:'Hello'}}));
 let key;
 const fetcher=async(_url,init)=>{if(key)assert.equal(init.headers['Idempotency-Key'],key);key=init.headers['Idempotency-Key'];return Response.json({data:[{id:'a'},{id:'b'}]});};
 assert.deepEqual((await sendResendBatch(x.env,items,fetcher)).map(r=>r.messageId),['a','b']);await sendResendBatch(x.env,items,fetcher);
 for(const [status,expected] of [[429,'retry'],[500,'ambiguous'],[409,'ambiguous'],[422,'failed']])assert.ok((await sendResendBatch(x.env,items,async()=>new Response('',{status}))).every(r=>r.status===expected));
 for(const data of [[{id:'a'}],[{id:'a'},{id:'a'}],[{id:'a'},{}]])assert.ok((await sendResendBatch(x.env,items,async()=>Response.json({data}))).every(r=>r.status==='ambiguous'));
 assert.ok((await sendResendBatch(x.env,items,async()=>{throw Error('timeout');})).every(r=>r.status==='ambiguous'));
});
test('whole-batch throttling retries later and uncertain acceptance never auto-resends',async()=>{
 const x=await seededCampaign(4);
 await drain(x.env,{sendBatch:async(_env,items)=>items.map(()=>({status:'retry',code:'throttled'}))});
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='retry' AND available_at>0").n,4);
 x.unlock();await drain(x.env,{sendBatch:async()=>{throw Error('Backoff must hold');}});
 x.db.exec('UPDATE deliveries SET available_at=0');x.unlock();
 await drain(x.env,{sendBatch:async(_env,items)=>items.map(()=>({status:'ambiguous',code:'transport_uncertain'}))});
 x.unlock();await drain(x.env,{sendBatch:async()=>{throw Error('Uncertain batch must stay held');}});
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE status='ambiguous'").n,4);
});

function dashboardClient(x){const session=token();x.db.prepare('INSERT INTO dashboard_sessions VALUES(?,?)').run(hash(session),now()+3600);return (path,data,extra={})=>x.req('/dashboard/api'+path,data,{headers:{origin:x.env.API_ORIGIN,'content-type':'application/json','x-opencam-dashboard':'1',cookie:'__Host-opencam_session='+session},...extra});}
test('dashboard login is owner-only, bounded, single-use and uses secure sessions',async()=>{
 let code,sent=0;const x=setup({sendLogin:async(env,to,message)=>{assert.equal(to,'opencamapp@gmail.com');code=message.text.match(/\d{8}/)[0];sent++;return {status:'sent'};}});x.env.DASHBOARD_EMAIL='opencamapp@gmail.com';
 const req=(path,data,headers={})=>x.req('/dashboard/api'+path,data,{headers:{origin:x.env.API_ORIGIN,'content-type':'application/json','x-opencam-dashboard':'1',...headers}});
 assert.equal((await req('/overview')).status,401);assert.equal((await req('/login',{}, {origin:'https://evil.example'})).status,403);
 const r=await req('/login',{email:'attacker@example.com'}),d=await r.json();assert.equal(sent,1);
 assert.equal((await req('/verify',{id:d.id,code:'00000000'})).status,401);
 const verified=await req('/verify',{id:d.id,code});assert.equal(verified.status,200);assert.match(verified.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
 const cookie=verified.headers.get('set-cookie').split(';')[0];assert.equal((await req('/overview',undefined,{cookie})).status,200);
 assert.equal((await req('/verify',{id:d.id,code})).status,401);await req('/logout',{}, {cookie});assert.equal((await req('/overview',undefined,{cookie})).status,401);
 for(let i=0;i<5;i++)await req('/login',{});assert.ok(sent<=3);
});
test('dashboard draft, exact tested content, launch, pause, resume and immutable send',async()=>{
 const x=setup(),api=dashboardClient(x);await x.signup();const d={id:'draft-test',subject:'Hello',markdown:'# News\n\n**Hello** [site](https://opencam.app)',preheader:'This week'};
 assert.equal((await api('/campaign',d)).status,200);const preview=await(await api('/preview',d)).json();assert.match(preview.html,/<strong>Hello<\/strong>/);assert.match(preview.html,/OpenCam/);
 assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,400);
 assert.equal((await api('/campaign/'+d.id+'/test',{email:'stranger@example.com'})).status,403);
 assert.equal((await api('/campaign/'+d.id+'/test',{email:'delivered@resend.dev'})).status,200);
 assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,400);
 await drain(x.env,{send:async()=>({status:'sent',messageId:'test-id'})});
 await api('/campaign',{...d,markdown:'Changed'});assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,400);
 await api('/campaign',d);assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:'wrong'})).status,400);
 assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,200);
 assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,200);
 assert.equal(x.row("SELECT count(*) n FROM deliveries WHERE kind='announcement'").n,1);
 assert.equal((await api('/campaign',{...d,subject:'Edit sent'})).status,409);
 await api('/campaign/'+d.id+'/pause',{});x.unlock();await drain(x.env,{send:async()=>{throw Error('Paused');}});
 await api('/campaign/'+d.id+'/resume',{});x.unlock();let sends=0;await drain(x.env,{send:async(_env,_to,message)=>{sends++;assert.match(message.html,/<strong>Hello<\/strong>/);return {status:'sent',messageId:'live-id'};}});assert.equal(sends,1);
 const overview=await(await api('/overview')).json();assert.equal(overview.campaigns[0].state,'completed');assert.equal(overview.campaigns[0].sent,1);
});
test('dashboard footer edits invalidate tests, preview escapes HTML and unsafe links',async()=>{
 const x=setup(),api=dashboardClient(x),d={id:'draft-footer',subject:'<script>x</script>',markdown:'<script>alert(1)</script> [bad](javascript:alert(1))',preheader:'<x>'};await api('/campaign',d);
 const preview=await(await api('/preview',d)).json();assert.ok(!preview.html.includes('<script>'));assert.ok(!preview.html.includes('href="javascript:'));
 await api('/campaign/'+d.id+'/test',{email:'delivered@resend.dev'});await drain(x.env,{send:async()=>({status:'sent',messageId:'test-footer'})});
 await api('/settings',{postal_address:'New address'});assert.equal((await api('/campaign/'+d.id+'/start',{confirmation:d.subject})).status,400);
 assert.equal((await api('/settings',{postal_address:'  '})).status,400);
});

test('shared studio scopes TabTab requests and requires the central owner session',async()=>{
 const x=setup(),api=dashboardClient(x);let calls=[];
 x.env.DASHBOARD_EMAIL='opencamapp@gmail.com';x.env.SHARED_STUDIO_TOKEN='server-only-token';
 x.env.TABTAB_STUDIO={fetch:async req=>{calls.push(req);assert.equal(req.headers.get('authorization'),'Bearer server-only-token');assert.equal(req.headers.get('cookie'),null);assert.equal(req.headers.get('origin'),'https://updates.tabtabapp.net');assert.equal(req.headers.get('x-tabtab-dashboard'),'1');return Response.json({email:'tabtab-owner@example.com',contacts:[{id:'tabtab-only'}],total:1});}};
 assert.equal((await x.req('/dashboard/api/tabtab/overview')).status,401);assert.equal(calls.length,0);
 assert.equal((await api('/tabtab/settings',{}, {headers:{origin:'https://evil.example'}})).status,403);assert.equal(calls.length,0);
 assert.equal((await api('/tabtab/admin/export')).status,404);assert.equal((await api('/tabtab/login',{})).status,404);assert.equal(calls.length,0);
 const overview=await(await api('/tabtab/overview')).json();assert.equal(overview.email,'opencamapp@gmail.com');
 const contacts=await(await api('/tabtab/contacts?q=one%2Btwo&page=2')).json();assert.equal(contacts.contacts[0].id,'tabtab-only');assert.equal(new URL(calls.at(-1).url).searchParams.get('q'),'one+two');
 const before=calls.length;await api('/overview');assert.equal(calls.length,before);
 const d={id:'workspace-test',subject:'TabTab only',markdown:'Hello',preheader:''};assert.equal((await api('/tabtab/campaign',d)).status,200);assert.deepEqual(await calls.at(-1).json(),d);assert.equal(x.row('SELECT COUNT(*) n FROM dashboard_drafts').n,0);
 await api('/logout',{});assert.equal((await api('/tabtab/overview')).status,401);assert.equal((await api('/overview')).status,401);
});

test('shared studio serves workspace-specific assets with one auth endpoint',async()=>{
 const x=setup();
 const html=await(await x.req('/dashboard?app=tabtab')).text();assert.match(html,/app.js\?app=tabtab/);assert.match(html,/aria-current="page">TabTab/);
 const js=await(await x.req('/dashboard/app.js?app=tabtab')).text();new Function(js);assert.match(js,/X-OpenCam-Dashboard/);assert.match(js,/"\/dashboard\/api\/tabtab"/);assert.match(js,/"\/dashboard\/api"/);
 assert.doesNotMatch(html,/server-only-token/);
});

test('subscriber list shows when and how each contact was added, and when they unsubscribed',async()=>{
 const x=setup(),api=dashboardClient(x);await x.signup('new@example.com');
 const listed=async status=>(await(await api('/contacts?q=new&status='+status)).json()).contacts[0];
 const added=await listed('subscribed');assert.equal(added.added_via,'app');assert.match(added.added_at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);assert.equal(added.unsubscribed_at,null);
 await api('/unsubscribe',{id:added.id});
 const gone=await listed('unsubscribed');assert.equal(gone.status,'unsubscribed');assert.match(gone.unsubscribed_at,/^\d{4}-\d\d-\d\dT/);assert.equal(gone.added_at,added.added_at);
 assert.equal((await(await api('/contacts?q=new&status=subscribed')).json()).total,0);
});
