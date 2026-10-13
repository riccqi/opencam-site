import { now, decrypt, unsubscribeToken, token } from './security.js';
import { run, first, all, stmt } from './db.js';
import { sendResendBatch, announcement } from './mail.js';
export async function drain(env, deps = {}) {
  const t = now();
  // No automatic retry after a crash in the send/record gap.
  await run(env, "UPDATE deliveries SET status='ambiguous',error_code='interrupted',payload=NULL WHERE status='sending' AND started_at < ?", t-300);
  await run(env, 'DELETE FROM rate_limits WHERE expires < ?', t);
  await run(env, 'DELETE FROM send_reservations WHERE created_at < ?', t-86400);
  await run(env, 'DELETE FROM events WHERE received_at < ?', t-30*86400);
  await run(env, "UPDATE deliveries SET payload=NULL WHERE finished_at < ?", t-86400);
  await run(env, "DELETE FROM subscribers WHERE status='pending' AND last_confirmation_at < ?", t-30*86400);
  if (env.SENDING_ENABLED !== 'true') return;
  // One atomic batch claim per minute across overlapping cron invocations.
  const reserved = await first(env,'UPDATE send_lock SET next_at=? WHERE id=1 AND next_at<=? RETURNING id',t+60,t);
  if (!reserved) return;
  const cap=Number(env.DAILY_SEND_LIMIT ?? 0);
  if (!Number.isSafeInteger(cap) || cap<0) throw new Error('Invalid daily send limit');
  const used=cap ? (await first(env,'SELECT count(*) n FROM send_reservations WHERE created_at>?',t-86400)).n : 0;
  const limit=cap ? Math.max(0,Math.min(100,cap-used)) : 100;
  if (!limit) return;
  const deliveries=await all(env,`UPDATE deliveries SET status='sending',started_at=?,attempts=attempts+1 WHERE id IN (
    SELECT id FROM deliveries WHERE status IN ('queued','retry') AND available_at<=?
    AND (kind!='announcement' OR (?='true' AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=deliveries.campaign_id AND c.paused=0))) ORDER BY available_at,id LIMIT ?
    ) AND status IN ('queued','retry') RETURNING *`,t,t,env.LIVE_SEND_ENABLED,limit);
  const prepared=[];
  for(const d of deliveries) {
    const item=await prepare(env,d,t);
    if(item) prepared.push({...item,id:d.id,delivery:d});
  }
  // Recheck every recipient after preparation, immediately before provider handoff.
  const ready=[];
  for(const item of prepared) {
    const current=await first(env,'SELECT status FROM subscribers WHERE email=?',item.recipient);
    if(current?.status==='suppressed'||(item.delivery.kind==='announcement'&&current?.status!=='subscribed')) {
      await run(env,"UPDATE deliveries SET status='skipped',error_code='recipient_ineligible',finished_at=?,payload=NULL WHERE id=? AND status='sending'",now(),item.id);
    } else if(item.delivery.kind==='announcement'&&(await first(env,'SELECT paused FROM campaigns WHERE id=?',item.delivery.campaign_id))?.paused){await run(env,"UPDATE deliveries SET status='queued' WHERE id=? AND status='sending'",item.id);}
    else ready.push(item);
  }
  if(!ready.length)return;
  ready.sort((a,b)=>a.id.localeCompare(b.id));
  await env.DB.batch(ready.map(()=>stmt(env,'INSERT INTO send_reservations VALUES(?,?)',token(),now())));
  const results=deps.send ? await Promise.all(ready.map(i=>deps.send(env,i.recipient,i.message,i.id)))
    : await (deps.sendBatch || sendResendBatch)(env,ready);
  await env.DB.batch(ready.map((item,i)=>{
    const d=item.delivery,result=results[i]||{status:'ambiguous',code:'missing_batch_result'};
    const status=result.status==='retry'&&d.attempts>=5?'failed':result.status;
    return stmt(env,`UPDATE deliveries SET status=?,message_id=?,error_code=?,available_at=?,finished_at=?,payload=CASE WHEN ?='retry' THEN payload ELSE NULL END WHERE id=? AND status='sending'`,
      status,result.messageId||null,result.code||null,now()+Math.min(3600,60*2**d.attempts),status==='retry'?null:now(),status,d.id);
  }));
}
async function prepare(env,d,t) {
  let recipient, message;
  const skip = async code => { await run(env,"UPDATE deliveries SET status='skipped',error_code=?,finished_at=?,payload=NULL WHERE id=? AND status='sending'",code,t,d.id); return null; };
  if (d.kind === 'announcement') {
    if(!env.POSTAL_ADDRESS?.trim())return skip('postal_address_missing');
    const s = await first(env,'SELECT * FROM subscribers WHERE id=?',d.subscriber_id);
    if (!s || s.status !== 'subscribed') return skip('not_subscribed');
    const c = await first(env,'SELECT * FROM campaigns WHERE id=? AND launched_at IS NOT NULL',d.campaign_id);
    if (!c) return skip('not_launched');
    if(c.paused){await run(env,"UPDATE deliveries SET status='queued' WHERE id=? AND status='sending'",d.id);return null;}
    const explicitOptIn=['legacy-form-updates-owner-reviewed-2026-10-13','opencam-updates-single-opt-in-v3'].includes(s.consent_version) && !!s.consent_evidence;
    if(!s.confirmed_at && !explicitOptIn)return skip('consent_missing');
    if(c.campaign_type==='update' && s.consent_version!=='opencam-updates-2026-10-13-v2' && !explicitOptIn)return skip('consent_scope');
    recipient=s.email; message=announcement(c,`${env.API_ORIGIN}/unsubscribe?token=${unsubscribeToken(env,s.id)}`,env.POSTAL_ADDRESS);
  } else {
    if (d.kind === 'confirmation') return skip('confirmation_disabled');
    const payload=decrypt(env,d.payload);
    recipient=payload.recipient; message=payload.message;
  }
  if (d.kind==='test' && !(env.TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).includes(recipient)) return skip('test_not_allowed');
  return {recipient,message};
}
