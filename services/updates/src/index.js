import {studio,dashboardAPI,dashboardEnv} from './dashboard.js';
import { Buffer } from 'node:buffer';
import { token, hash, hmac, key, email, now, equal, encrypt, escape, unsubscribeToken, verifyResend } from './security.js';
import { stmt, run, first, all } from './db.js';
import { announcement } from './mail.js';
import { drain } from './queue.js';
const CONSENT='opencam-updates-single-opt-in-v3';
const generic={message:'Thanks for subscribing to OpenCam updates. You can unsubscribe anytime.'};
class HttpError extends Error { constructor(status,message) { super(message);this.status=status; } }
const fail=(status,message)=>{throw new HttpError(status,message);};
const json=(data,status=200)=>Response.json(data,{status});
async function rawBody(req,max=32768) {
  const reader=req.body?.getReader();if(!reader) return '';
  let size=0,parts=[];
  for (;;) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'Request too large');}parts.push(value);}
  return Buffer.concat(parts).toString();
}
async function body(req,max=32768) {
  const text=await rawBody(req,max);
  try { return req.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text)); }
  catch {fail(400,'Invalid request');}
}
async function rate(env,id,limit,seconds) {
  const t=now(),bucket=Math.floor(t/seconds);
  const k=hmac(key(env.RATE_KEY),`${id}:${bucket}`);
  const r=await first(env,`INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,k,(bucket+1)*seconds);
  return r.count<=limit;
}
function page(title,content) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | OpenCam</title><style>body{font:18px system-ui;max-width:36rem;margin:10vh auto;padding:1.5rem;line-height:1.6;background:#161616;color:#fff}button{font:inherit;padding:.7rem 1.5rem;border-radius:2rem;cursor:pointer}a{color:#ffb267}button:focus-visible,a:focus-visible{outline:3px solid #ffb267;outline-offset:4px}</style><h1>${escape(title)}</h1>${content}<p><a href="https://opencam.app/privacy/">Privacy policy</a></p></html>`,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
}
async function signup(req,env,deps) {
  if(env.SIGNUPS_ENABLED!=='true') fail(503,'Email signup is not available yet. Please use the existing signup link.');
  if(req.headers.get('origin')!==env.SITE_ORIGIN) fail(403,'Invalid origin');
  if(!await rate(env,`ip:${req.headers.get('CF-Connecting-IP')||'unknown'}`,10,3600)) fail(429,'Too many requests. Please try again later.');
  const b=await body(req,4096),address=email(b.email);
  if(!address)fail(400,'Enter a valid email address.');
  if(b.company)return json(generic,202);
  if(typeof b.turnstile!=='string'||b.turnstile.length>2048)fail(400,'Complete the security check.');
  const verify=await (deps.fetch||fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:b.turnstile,remoteip:req.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(8000)});
  const result=await verify.json();
  if(!result.success||result.hostname!==env.TURNSTILE_HOSTNAME||result.action!=='signup')fail(400,'Security check failed. Please try again.');
  if(!await rate(env,`email:${address}`,3,86400))return json(generic,202);
  const id=token(),t=now();
  const source=['website','app','testflight'].includes(b.source)?b.source:'website';
  const evidence=JSON.stringify({method:'website_single_opt_in',consent_at:t,consent_version:CONSENT,mailbox_confirmed:false});
  // A deliberate signup activates immediately. Suppression and existing consent win.
  // No confirmation token or outbound message is created.
  await run(env,`INSERT INTO subscribers(id,email,status,source,signup_at,consent_version,unsubscribe_hash,last_confirmation_at,consent_evidence)
    VALUES(?,?,'subscribed',?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET
    status='subscribed',source=excluded.source,signup_at=excluded.signup_at,
    consent_version=excluded.consent_version,consent_evidence=excluded.consent_evidence,
    unsubscribed_at=NULL,confirm_hash=NULL,confirm_expires=NULL
    WHERE subscribers.status IN ('pending','unsubscribed')`,id,address,source,t,CONSENT,hash(unsubscribeToken(env,id)),evidence);
  return json(generic,202);
}
async function tokenAction(req,env,action) {
  const url=new URL(req.url);
  if(req.method==='GET') {
    const t=url.searchParams.get('token')||'';
    if(!/^[a-zA-Z0-9_-]{40,128}$/.test(t))return page('Invalid link','<p>Please request a new link.</p>');
    return page(action==='confirm'?'Confirm OpenCam updates':'Unsubscribe from OpenCam updates',`<p>${action==='confirm'?'Receive news, features, announcements, and releases from OpenCam. Unsubscribe anytime.':'Press Unsubscribe to stop OpenCam update emails.'}</p><form method="post" action="/${action}"><input type="hidden" name="token" value="${escape(t)}"><button type="submit">${action==='confirm'?'Confirm':'Unsubscribe'}</button></form>`);
  }
  const b=await body(req,2048),raw=b.token||url.searchParams.get('token')||'';
  if(!/^[a-zA-Z0-9_-]{40,128}$/.test(raw))fail(400,'Invalid link');
  if(action==='confirm') {
    const s=await first(env,`UPDATE subscribers SET status='subscribed',confirmed_at=?,unsubscribed_at=NULL,confirm_hash=NULL,confirm_expires=NULL
      WHERE confirm_hash=? AND confirm_expires>? AND status IN ('pending','unsubscribed') RETURNING id`,now(),hash(raw),now());
    return page(s?'You’re subscribed':'Link expired or already used',s?'<p>You will receive OpenCam updates.</p>':'<p>If you already confirmed, no action is needed. Otherwise, <a href="https://opencam.app/updates/">request a new confirmation</a>.</p>');
  }
  // RFC 8058 POST has the token in the URL and List-Unsubscribe=One-Click in the form body.
  await run(env,`UPDATE subscribers SET status=CASE WHEN status='suppressed' THEN status ELSE 'unsubscribed' END,
    unsubscribed_at=COALESCE(unsubscribed_at,?),confirm_hash=NULL,confirm_expires=NULL WHERE unsubscribe_hash=?`,now(),hash(raw));
  return page('Unsubscribed','<p>You will no longer receive OpenCam updates at this address.</p>');
}
async function events(req,env) {
  const raw=await rawBody(req,131072);
  let verified;
  try {verified=verifyResend(raw,req.headers,env.RESEND_WEBHOOK_SECRET);} catch {fail(403,'Event authentication failed');}
  const {id:eventId,event:e}=verified;
  // A shared Resend account emits events for both apps. Only this sender belongs here.
  const from=String(e.data?.from||'').trim().toLowerCase();
  if(!/^(?:(?:updates|richard)@opencam\.app|opencam\s*<(?:updates|richard)@opencam\.app>)$/.test(from))return json({ok:true,ignored:true});
  if(await first(env,'SELECT id FROM events WHERE id=?',eventId))return json({ok:true});
  const type=e.type;
  const statements=[stmt(env,'INSERT OR IGNORE INTO events VALUES(?,?,?)',eventId,now(),['email.bounced','email.complained','email.suppressed','email.delivered','email.sent','email.failed'].includes(type)?type:'Other')];
  if(['email.bounced','email.complained','email.suppressed'].includes(type)) {
    for(const r of Array.isArray(e.data?.to)?e.data.to:[]) {
      const address=email(r);if(!address)continue;
      const id=token();
      statements.push(stmt(env,`INSERT INTO subscribers(id,email,status,source,signup_at,consent_version,unsubscribe_hash,last_confirmation_at,suppression_reason)
        VALUES(?,?,'suppressed','resend-event',?,'none',?,0,?) ON CONFLICT(email) DO UPDATE SET status='suppressed',suppression_reason=excluded.suppression_reason,confirm_hash=NULL,confirm_expires=NULL`,id,address,now(),hash(unsubscribeToken(env,id)),type.slice(6)));
    }
  }
  const tags=e.data?.tags;
  const deliveryId=Array.isArray(tags)?tags.find(t=>t.name==='delivery_id')?.value:tags?.delivery_id;
  if(['email.sent','email.delivered','email.bounced','email.complained','email.suppressed'].includes(type) && typeof deliveryId==='string' && typeof e.data?.email_id==='string')statements.push(stmt(env,`UPDATE deliveries SET status='sent',message_id=?,error_code=NULL,finished_at=?,payload=NULL WHERE id=? AND status IN ('sending','ambiguous')`,e.data.email_id,now(),deliveryId));
  await env.DB.batch(statements);
  return json({ok:true});
}
const csvCell=v=>`"${String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')}"`;
function campaignInput(b) {
  const kind=b.kind||'release';
  if(!['release','update'].includes(kind))fail(400,'Invalid campaign kind');
  if(kind==='update' && (typeof b.key!=='string'||!/^[a-z0-9][a-z0-9-]{2,79}$/.test(b.key)))fail(400,'Provide a unique update key using lowercase letters, digits and hyphens');
  if(kind==='release' && (typeof b.version!=='string'||!/^\d+\.\d+(?:\.\d+)?$/.test(b.version)))fail(400,'Use the public app version, for example 2.1.0');
  if(typeof b.subject!=='string'||!b.subject.trim()||b.subject.length>200||/[\r\n]/.test(b.subject))fail(400,'Invalid subject');
  if(typeof b.notes!=='string'||!b.notes.trim()||b.notes.length>12000)fail(400,'Provide update text (up to 12000 characters)');
  if(kind==='release' && (typeof b.app_store_url!=='string'||!/^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[a-zA-Z0-9-]+\/)?id6743316690$/.test(b.app_store_url)))fail(400,'Use the public OpenCam App Store URL');
  return {...b,campaign_type:kind,version:kind==='update'?`update:${b.key}`:b.version,app_store_url:kind==='update'?'':b.app_store_url};
}
async function publicRelease(env,c,fetcher) {
  const country=new URL(c.app_store_url).pathname.split('/')[1];
  const r=await fetcher(`https://itunes.apple.com/lookup?id=6743316690&country=${/^[a-z]{2}$/.test(country)?country:'us'}`,{signal:AbortSignal.timeout(10000)});
  if(!r.ok)fail(503,'App Store verification unavailable');
  const app=(await r.json()).results?.find(a=>a.trackId===6743316690);
  if(!app||app.version!==c.version)fail(409,'This exact version is not publicly available in the selected App Store storefront');
}
async function admin(req,env,path,deps) {
  const auth=req.headers.get('authorization')||'';
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!equal(auth,`Bearer ${env.ADMIN_TOKEN}`))fail(401,'Unauthorized');
  const b=req.method==='POST'?await body(req):{};
  if(path==='/admin/counts'&&req.method==='GET')return json(await all(env,'SELECT status,count(*) AS count FROM subscribers GROUP BY status'));
  if(path==='/admin/search'&&req.method==='POST')return json(await all(env,'SELECT id,email,status,source,signup_at,confirmed_at,consent_version,unsubscribed_at,suppression_reason FROM subscribers WHERE email LIKE ? ORDER BY email LIMIT 100',`%${String(b.query||'').slice(0,254)}%`));
  if(path==='/admin/export'&&req.method==='GET') {
    const after=new URL(req.url).searchParams.get('after')||'';
    const rows=await all(env,'SELECT id,email,status,source,signup_at,confirmed_at,consent_version,unsubscribed_at,suppression_reason,consent_evidence FROM subscribers WHERE id>? ORDER BY id LIMIT 500',after);
    const fields=['id','email','status','source','signup_at','confirmed_at','consent_version','unsubscribed_at','suppression_reason','consent_evidence'];
    return new Response([fields.join(','),...rows.map(r=>fields.map(f=>csvCell(r[f])).join(','))].join('\r\n'),{headers:{'content-type':'text/csv','x-next-cursor':rows.length===500?rows.at(-1).id:''}});
  }
  if(path==='/admin/subscriber'&&req.method==='POST') {
    if(!['unsubscribe','suppress','delete'].includes(b.action))fail(400,'Invalid action');
    const s=await first(env,'SELECT id FROM subscribers WHERE email=?',email(b.email)||'');if(!s)fail(404,'Subscriber not found');
    const mutation=b.action==='delete'?stmt(env,'DELETE FROM subscribers WHERE id=?',s.id):stmt(env,`UPDATE subscribers SET status=CASE WHEN status='suppressed' THEN status ELSE ? END,unsubscribed_at=?,suppression_reason=CASE WHEN ?='suppressed' THEN 'admin' ELSE suppression_reason END,confirm_hash=NULL,confirm_expires=NULL WHERE id=?`,b.action==='suppress'?'suppressed':'unsubscribed',now(),b.action==='suppress'?'suppressed':'unsubscribed',s.id);
    await env.DB.batch([mutation,stmt(env,'INSERT INTO admin_audit VALUES(?,?,?,?)',token(),b.action,s.id,now())]);
    return json({ok:true});
  }
  if(path==='/admin/campaigns'&&req.method==='POST') {
    const c=campaignInput(b),id=token();
    await run(env,'INSERT OR IGNORE INTO campaigns(id,version,subject,notes,app_store_url,created_at,campaign_type) VALUES(?,?,?,?,?,?,?)',id,c.version,c.subject,c.notes,c.app_store_url,now(),c.campaign_type);
    const existing=await first(env,'SELECT * FROM campaigns WHERE version=?',c.version);
    if(existing.campaign_type!==c.campaign_type||existing.subject!==c.subject||existing.notes!==c.notes||existing.app_store_url!==c.app_store_url)fail(409,'A different campaign already exists for this version');
    return json(existing);
  }
  const match=path.match(/^\/admin\/campaigns\/([a-zA-Z0-9_-]+)\/(preview|test|launch|status)$/);
  if(match) {
    const c=await first(env,'SELECT * FROM campaigns WHERE id=?',match[1]);if(!c)fail(404,'Campaign not found');
    const action=match[2];
    if(action==='preview'&&req.method==='GET')return json(announcement(c,`${env.API_ORIGIN}/unsubscribe?token=PREVIEW_ONLY`,env.POSTAL_ADDRESS));
    if(action==='status'&&req.method==='GET')return json({campaign:c,counts:await all(env,'SELECT kind,status,count(*) AS count FROM deliveries WHERE campaign_id=? GROUP BY kind,status',c.id),review:await all(env,"SELECT id,status,error_code,message_id FROM deliveries WHERE campaign_id=? AND status IN ('failed','ambiguous') LIMIT 100",c.id)});
    if(action==='test'&&req.method==='POST') {
      const recipient=email(b.email);
      if(!recipient||!(env.TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).includes(recipient))fail(403,'Recipient must be explicitly allowlisted');
      if(typeof b.request_id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(b.request_id))fail(400,'Provide a stable test request_id');
      const id=hash(`${c.id}:${recipient}:${b.request_id}`);
      const preview=announcement(c,`${env.API_ORIGIN}/unsubscribe?token=PREVIEW_ONLY`,env.POSTAL_ADDRESS);preview.subject=`[TEST] ${preview.subject}`;
      await run(env,"INSERT OR IGNORE INTO deliveries(id,campaign_id,kind,payload,available_at) VALUES(?,?,'test',?,?)",id,c.id,encrypt(env,{recipient,message:preview}),now());
      return json({delivery_id:id});
    }
    if(action==='launch'&&req.method==='POST') {
      if(env.LIVE_SEND_ENABLED!=='true'||env.SENDING_ENABLED!=='true')fail(403,'Live sending is disabled');
      if(!env.POSTAL_ADDRESS?.trim())fail(409,'Set the sender business postal address before launching');
      if(c.campaign_type==='update' ? b.confirm_key!==c.version.slice(7) : b.confirm_version!==c.version)fail(400,'Explicit campaign key or version confirmation required');
      if(c.launched_at)return json({id:c.id,already_launched:true});
      if(c.campaign_type==='release')await publicRelease(env,c,deps.fetch||fetch);
      // Snapshot and launch in one transaction; only the first launch can insert recipients.
      await env.DB.batch([
        stmt(env,`INSERT OR IGNORE INTO deliveries(id,campaign_id,subscriber_id,kind,available_at)
          SELECT lower(hex(randomblob(32))),?,id,'announcement',? FROM subscribers
          WHERE status='subscribed' AND (confirmed_at IS NOT NULL OR (consent_version IN ('legacy-form-updates-owner-reviewed-2026-10-13','opencam-updates-single-opt-in-v3') AND consent_evidence IS NOT NULL)) AND (?='release' OR consent_version IN (?,'opencam-updates-2026-10-13-v2','legacy-form-updates-owner-reviewed-2026-10-13')) AND (SELECT launched_at FROM campaigns WHERE id=?) IS NULL`,c.id,now(),c.campaign_type,CONSENT,c.id),
        stmt(env,'UPDATE campaigns SET launched_at=?,public_verified_at=? WHERE id=? AND launched_at IS NULL',now(),c.campaign_type==='release'?now():null,c.id),
        stmt(env,'INSERT INTO admin_audit VALUES(?,?,?,?)',token(),'launch',c.id,now())
      ]);
      return json({id:c.id,launched:true});
    }
  }
  // Manual ambiguity resolution never triggers a resend. Confirm acceptance from Resend events/logs first.
  if(path==='/admin/resolve'&&req.method==='POST') {
    if(!['sent','skipped'].includes(b.status))fail(400,'Resolve to sent or skipped');
    await env.DB.batch([stmt(env,"UPDATE deliveries SET status=?,finished_at=?,error_code='admin_resolved',payload=NULL WHERE id=? AND status='ambiguous'",b.status,now(),b.id),stmt(env,'INSERT INTO admin_audit VALUES(?,?,?,?)',token(),`resolve-${b.status}`,b.id,now())]);
    return json({ok:true});
  }
  fail(404,'Not found');
}
export function createWorker(deps={}) {
  return {
    async fetch(req,env) {
      let response;
      const url=new URL(req.url),path=url.pathname;
      try {
        if(path.startsWith('/dashboard/api/'))response=await dashboardAPI(req,await dashboardEnv(env),{body,rate,admin,deps});
        else if(req.method==='GET'&&['/dashboard','/dashboard/','/dashboard/app.js','/dashboard/style.css'].includes(path)){
          const asset=path.endsWith('.js')?['dashboardScript','text/javascript']:path.endsWith('.css')?['dashboardCSS','text/css']:['dashboardHTML','text/html'];
          response=new Response(studio[asset[0]],{headers:{'content-type':asset[1]+'; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: data:; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
        }
        else if(req.method==='OPTIONS'&&path==='/signup'&&req.headers.get('origin')===env.SITE_ORIGIN)response=new Response(null,{status:204,headers:{'access-control-allow-methods':'POST','access-control-allow-headers':'content-type'}});
        else if(path==='/health'&&req.method==='GET')response=json({ok:true});
        else if(path==='/signup'&&req.method==='POST')response=await signup(req,env,deps);
        else if(['/confirm','/unsubscribe'].includes(path)&&['GET','POST'].includes(req.method))response=await tokenAction(req,env,path.slice(1));
        else if(path==='/events/resend'&&req.method==='POST')response=await events(req,env,deps);
        else if(path.startsWith('/admin/'))response=await admin(req,await dashboardEnv(env),path,deps);
        else response=json({error:'Not found'},404);
      } catch(e) {response=json({error:e instanceof HttpError||path.startsWith('/dashboard/api/')&&Number.isInteger(e.status)?e.message:'Service unavailable. Please try again later.'},e instanceof HttpError||path.startsWith('/dashboard/api/')&&Number.isInteger(e.status)?e.status:503);}
      response.headers.set('cache-control','no-store');response.headers.set('referrer-policy','no-referrer');response.headers.set('x-content-type-options','nosniff');response.headers.set('x-robots-tag','noindex');
      if(path==='/signup'&&req.headers.get('origin')===env.SITE_ORIGIN){response.headers.set('access-control-allow-origin',env.SITE_ORIGIN);response.headers.set('vary','Origin');}
      return response;
    },
    async scheduled(_event,env,ctx) {ctx.waitUntil(dashboardEnv(env).then(config=>drain(config,deps)).catch(()=>{throw new Error('Queue processing failed; inspect protected delivery status');}));}
  };
}
export default createWorker();
