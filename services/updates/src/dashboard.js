import {createDashboard} from '@riccqi/email-studio/ui';
import {renderEmail} from '@riccqi/email-studio/template';
import {token,hash,hmac,equal,now,email} from './security.js';
import {run,first,all,stmt} from './db.js';
import {sendResend,announcement} from './mail.js';
export const studio=createDashboard({name:'OpenCam',domain:'opencam.app',initial:'O',color:'#d45a0b',sources:'OpenCam website signups and your reviewed starting list.',uncapped:true});
const json=x=>Response.json(x);
const bad=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const cookie=v=>`__Host-opencam_session=${v}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${v?604800:0}`;
export async function dashboardSettings(env){const s=await first(env,'SELECT * FROM dashboard_settings WHERE id=1');return {postal_address:s?.postal_address??env.POSTAL_ADDRESS??'',daily_limit:s?.daily_limit??Number(env.DAILY_SEND_LIMIT||0)};}
export async function dashboardEnv(env){const s=await dashboardSettings(env);return {...env,POSTAL_ADDRESS:s.postal_address,DAILY_SEND_LIMIT:String(s.daily_limit)};}
function draft(d){if(typeof d?.subject!=='string'||d.subject.length>200||/[\r\n]/.test(d.subject)||typeof d.markdown!=='string'||d.markdown.length>12000||typeof d.preheader!=='string'||d.preheader.length>200)bad('Use a subject up to 200 characters and a message up to 12,000 characters.');return d;}
const fingerprint=(d,s)=>hash(JSON.stringify([d.subject,d.markdown,d.preheader,s.postal_address]));
async function identity(req,env){const v=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-opencam_session=([^;]+)/)?.[1];if(!v||v.length>128)return null;const d=hash(v);return (await first(env,'SELECT digest FROM dashboard_sessions WHERE digest=? AND expires_at>?',d,now()))?.digest;}
export async function dashboardAPI(req,env,{body,rate,admin,deps}){
 const u=new URL(req.url),path=u.pathname.slice('/dashboard/api'.length);
 if(req.method!=='GET'&&(req.headers.get('origin')!==u.origin||req.headers.get('x-opencam-dashboard')!=='1'))bad('Reload the dashboard and try again.',403);
 if(path==='/login'&&req.method==='POST'){
  if(!email(env.DASHBOARD_EMAIL))bad('Owner sign-in is not configured.',503);
  if(!await rate(env,'dashboard-login:'+ (req.headers.get('CF-Connecting-IP')||'unknown'),3,600)||!await rate(env,'dashboard-login-global',6,3600))bad('Please wait before requesting another code.',429);
  await run(env,'DELETE FROM dashboard_codes WHERE expires_at<?',now());await run(env,'DELETE FROM dashboard_sessions WHERE expires_at<?',now());
  const id=token(),a=new Uint32Array(1);crypto.getRandomValues(a);const code=String(a[0]%100000000).padStart(8,'0');
  await run(env,'INSERT INTO dashboard_codes(id,digest,expires_at,created_at) VALUES(?,?,?,?)',id,hmac(env.TOKEN_KEY,`${id}/${code}`),now()+600,now());
  const result=await (deps.sendLogin||sendResend)(env,env.DASHBOARD_EMAIL,{subject:'Your OpenCam dashboard sign-in code',text:`Your sign-in code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,html:`<p>Your OpenCam sign-in code is <strong>${code}</strong>. It expires in 10 minutes.</p>`},'login-'+id);
  if(result.status!=='sent')bad('Unable to send a sign-in code. Please try again later.',503);
  return json({id,message:'A sign-in code was sent to opencamapp@gmail.com.'});
 }
 if(path==='/verify'&&req.method==='POST'){
  if(!await rate(env,'dashboard-verify:'+(req.headers.get('CF-Connecting-IP')||'unknown'),20,600))bad('Please wait before trying again.',429);
  const d=await body(req,2048);if(typeof d.id!=='string'||d.id.length>80||!/^\d{8}$/.test(d.code||''))bad('Enter the 8-digit code.');
  const r=await first(env,'UPDATE dashboard_codes SET attempts=attempts+1 WHERE id=? AND used=0 AND attempts<5 AND expires_at>? RETURNING digest',d.id,now());
  if(!r||!equal(r.digest,hmac(env.TOKEN_KEY,`${d.id}/${d.code}`)))bad('Code is invalid or expired.',401);
  if(!await first(env,'UPDATE dashboard_codes SET used=1 WHERE id=? AND used=0 RETURNING id',d.id))bad('Code already used.',401);
  const v=token();await run(env,'INSERT INTO dashboard_sessions VALUES(?,?)',hash(v),now()+604800);return new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':cookie(v)}});
 }
 const who=await identity(req,env);if(!who)bad('Sign in to your OpenCam dashboard.',401);
 const call=(path,data)=>admin(new Request(env.API_ORIGIN+path,{method:data===undefined?'GET':'POST',headers:{authorization:`Bearer ${env.ADMIN_TOKEN}`,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,path,deps);
 if(path==='/logout'&&req.method==='POST'){await run(env,'DELETE FROM dashboard_sessions WHERE digest=?',who);return new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':cookie('')}});}
 const config=await dashboardSettings(env);
 if(path==='/overview'&&req.method==='GET'){
  const campaigns=await all(env,`SELECT d.*,CASE WHEN d.campaign_id IS NULL THEN 'draft' WHEN c.paused=1 THEN 'paused' WHEN SUM(CASE WHEN e.kind='announcement' AND e.status IN ('queued','retry','sending') THEN 1 ELSE 0 END)>0 THEN 'sending' WHEN SUM(CASE WHEN e.kind='announcement' AND e.status IN ('failed','ambiguous') THEN 1 ELSE 0 END)>0 THEN 'needs_review' ELSE 'completed' END state,
  SUM(CASE WHEN e.kind='announcement' THEN 1 ELSE 0 END) total,SUM(CASE WHEN e.kind='announcement' AND e.status='sent' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN e.kind='announcement' AND e.status IN ('queued','retry','sending') THEN 1 ELSE 0 END) remaining,SUM(CASE WHEN e.kind='announcement' AND e.status='skipped' THEN 1 ELSE 0 END) skipped,SUM(CASE WHEN e.kind='announcement' AND e.status IN ('failed','ambiguous') THEN 1 ELSE 0 END) errors FROM dashboard_drafts d LEFT JOIN campaigns c ON c.id=d.campaign_id LEFT JOIN deliveries e ON e.campaign_id=c.id GROUP BY d.id ORDER BY d.created_at DESC LIMIT 100`);
  return json({email:env.DASHBOARD_EMAIL,settings:config,counts:await all(env,'SELECT status,count(*) total FROM subscribers GROUP BY status'),usage:(await first(env,'SELECT count(*) n FROM send_reservations WHERE created_at>?',now()-86400)).n,campaigns});
 }
 if(path==='/contacts'&&req.method==='GET'){
  const q=(u.searchParams.get('q')||'').slice(0,254),status=u.searchParams.get('status')||'',page=Math.max(0,Math.min(10000,Number(u.searchParams.get('page'))||0));
  const where="WHERE (?='' OR status=?) AND instr(email,lower(?))>0",args=[status,status,q];
  return json({total:(await first(env,'SELECT count(*) n FROM subscribers '+where,...args)).n,page,contacts:await all(env,'SELECT id,email,status,source sources,signup_at consent_at FROM subscribers '+where+' ORDER BY signup_at DESC,id LIMIT 50 OFFSET ?',...args,page*50)});
 }
 if(path==='/unsubscribe'&&req.method==='POST'){const d=await body(req);const s=await first(env,'SELECT email FROM subscribers WHERE id=?',String(d.id));if(!s)bad('Subscriber not found.',404);return call('/admin/subscriber',{email:s.email,action:'unsubscribe'});}
 if(path==='/settings'&&req.method==='POST'){
  const d=await body(req);if(typeof d.postal_address!=='string'||!d.postal_address.trim()||d.postal_address.length>500||d.daily_limit!==0)bad('Enter a mailing address. OpenCam uses the Pro plan with no daily cap.');
  await run(env,'INSERT INTO dashboard_settings VALUES(1,?,0) ON CONFLICT(id) DO UPDATE SET postal_address=excluded.postal_address',d.postal_address.trim());return json({ok:true});
 }
 if(path==='/preview'&&req.method==='POST'){
  const d=draft(await body(req));const saved=typeof d.id==='string'?await first(env,'SELECT c.* FROM dashboard_drafts d JOIN campaigns c ON c.id=d.campaign_id WHERE d.id=?',d.id):null;
  return json(renderEmail({...d,postalAddress:saved?.postal_address??config.postal_address,unsubscribeUrl:env.API_ORIGIN+'/unsubscribe?token=PREVIEW_ONLY',brand:{name:'OpenCam',domain:'opencam.app',color:'#d45a0b'}}));
 }
 if(path==='/campaign'&&req.method==='POST'){
  const d=draft(await body(req)),id=d.id||crypto.randomUUID();if(!/^[\w-]{1,80}$/.test(id))bad('Invalid draft ID.');const stamp=new Date().toISOString();
  const result=await first(env,`INSERT INTO dashboard_drafts(id,subject,markdown,preheader,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,markdown=excluded.markdown,preheader=excluded.preheader,updated_at=excluded.updated_at WHERE dashboard_drafts.campaign_id IS NULL RETURNING id`,id,d.subject,d.markdown,d.preheader,stamp,stamp);
  if(!result)bad('A started campaign cannot be edited.',409);return json({id});
 }
 const action=path.match(/^\/campaign\/([\w-]+)\/(test|start|pause|resume)$/);
 if(action&&req.method==='POST'){
  const [,id,verb]=action,d=await first(env,'SELECT * FROM dashboard_drafts WHERE id=?',id);if(!d)bad('Draft not found.',404);
  if(verb==='pause'||verb==='resume'){if(!d.campaign_id)bad('Campaign has not started.');await run(env,'UPDATE campaigns SET paused=? WHERE id=?',verb==='pause'?1:0,d.campaign_id);return json({ok:true});}
  if(d.campaign_id){
   if(verb==='test')bad('This campaign already started.',409);
   const existing=await first(env,'SELECT * FROM campaigns WHERE id=?',d.campaign_id);
   if(existing?.launched_at)return json({ok:true,already_launched:true});
   const retry=await body(req);if(retry.confirmation!==d.subject)bad('Type the exact subject to confirm sending.');
   return call(`/admin/campaigns/${existing.id}/launch`,{confirm_key:existing.version.slice(7)});
  }
  if(!d.subject.trim()||!d.markdown.trim())bad('Add a subject and message first.');
  const data=await body(req),fp=fingerprint(d,config);
  if(verb==='test'){
   const address=email(data.email);if(!(env.TEST_RECIPIENTS||'').split(',').includes(address))bad('Use an approved owner test inbox.',403);
   const c=await(await call('/admin/campaigns',{kind:'update',key:'studio-'+fp,subject:d.subject,notes:d.markdown})).json();
   await run(env,'UPDATE campaigns SET markdown=?,preheader=?,postal_address=? WHERE id=? AND launched_at IS NULL',d.markdown,d.preheader,config.postal_address,c.id);
   const result=await(await call(`/admin/campaigns/${c.id}/test`,{email:address,request_id:token()})).json();
   await run(env,'UPDATE dashboard_drafts SET test_hash=?,test_delivery_id=? WHERE id=? AND campaign_id IS NULL',fp,result.delivery_id,id);return json({ok:true,queued:true});
  }
  if(data.confirmation!==d.subject)bad('Type the exact subject to confirm sending.');
  if(!config.postal_address||!env.RESEND_WEBHOOK_SECRET)bad('Sender and bounce handling must be configured.');
  const test=await first(env,"SELECT campaign_id FROM deliveries WHERE id=? AND kind='test' AND status='sent'",d.test_delivery_id||'');
  if(d.test_hash!==fp||!test)bad('Send a test of this exact draft and footer, wait for delivery, then review it before sending.');
  const c=await first(env,'SELECT * FROM campaigns WHERE id=?',test.campaign_id);
  // Claim the draft before launching. On an interrupted response, repeated start resumes the same campaign.
  const claimed=await first(env,'UPDATE dashboard_drafts SET campaign_id=? WHERE id=? AND campaign_id IS NULL AND subject=? AND markdown=? AND preheader=? AND test_hash=? RETURNING id',c.id,id,d.subject,d.markdown,d.preheader,fp);
  if(!claimed)bad('Draft changed. Reload and review it again.',409);
  const response=await call(`/admin/campaigns/${c.id}/launch`,{confirm_key:c.version.slice(7)});
  if(!response.ok)await run(env,'UPDATE dashboard_drafts SET campaign_id=NULL WHERE id=? AND campaign_id=? AND NOT EXISTS(SELECT 1 FROM campaigns WHERE id=? AND launched_at IS NOT NULL)',id,c.id,c.id);
  return response;
 }
 bad('Not found.',404);
}
