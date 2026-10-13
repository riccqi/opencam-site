import { now, decrypt, unsubscribeToken, hash, token } from './security.js';
import { run, first, stmt } from './db.js';
import { sendResend, announcement } from './mail.js';
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
  // One global send slot per minute, with a rolling 24-hour ceiling. Includes confirmations/tests.
  const reserved = await first(env, `UPDATE send_lock SET next_at=? WHERE id=1 AND next_at<=?
    AND (SELECT count(*) FROM send_reservations WHERE created_at>?) < ? RETURNING id`, t+60,t,t-86400,Math.max(0,Number(env.DAILY_SEND_LIMIT)||0));
  if (!reserved) return;
  const d = await first(env, `UPDATE deliveries SET status='sending',started_at=?,attempts=attempts+1 WHERE id=(
    SELECT id FROM deliveries WHERE status IN ('queued','retry') AND available_at<=?
    AND (kind!='announcement' OR ?='true') ORDER BY CASE kind WHEN 'confirmation' THEN 0 ELSE 1 END,available_at,id LIMIT 1
    ) AND status IN ('queued','retry') RETURNING *`,t,t,env.LIVE_SEND_ENABLED);
  if (!d) return;
  await run(env,'INSERT INTO send_reservations VALUES(?,?)',token(),t);
  let recipient, message;
  const skip = code => run(env,"UPDATE deliveries SET status='skipped',error_code=?,finished_at=?,payload=NULL WHERE id=? AND status='sending'",code,t,d.id);
  if (d.kind === 'announcement') {
    if(!env.POSTAL_ADDRESS?.trim())return skip('postal_address_missing');
    const s = await first(env,'SELECT * FROM subscribers WHERE id=?',d.subscriber_id);
    if (!s || s.status !== 'subscribed') return skip('not_subscribed');
    const c = await first(env,'SELECT * FROM campaigns WHERE id=? AND launched_at IS NOT NULL',d.campaign_id);
    if (!c) return skip('not_launched');
    if(c.campaign_type==='update' && s.consent_version!=='opencam-updates-2026-10-13-v2')return skip('consent_scope');
    recipient=s.email; message=announcement(c,`${env.API_ORIGIN}/unsubscribe?token=${unsubscribeToken(env,s.id)}`,env.POSTAL_ADDRESS);
  } else {
    const payload=decrypt(env,d.payload);
    recipient=payload.recipient; message=payload.message;
    if (d.kind === 'confirmation') {
      const s = await first(env,'SELECT * FROM subscribers WHERE id=?',d.subscriber_id);
      if (!s || s.status === 'suppressed' || s.status === 'subscribed' || s.confirm_hash !== payload.confirmHash || s.confirm_expires <= t) return skip('confirmation_obsolete');
    }
  }
  // Last DB read before provider invocation; a provider handoff already in progress cannot be recalled.
  const current=await first(env,'SELECT status FROM subscribers WHERE email=?',recipient);
  if (current?.status === 'suppressed' || (d.kind==='announcement' && current?.status!=='subscribed')) return skip('recipient_ineligible');
  if (d.kind==='test' && !(env.TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).includes(recipient)) return skip('test_not_allowed');
  const result=await (deps.send || sendResend)(env,recipient,message,d.id);
  const status=result.status==='retry' && d.attempts>=5 ? 'failed' : result.status;
  await run(env,`UPDATE deliveries SET status=?,message_id=?,error_code=?,available_at=?,finished_at=?,payload=CASE WHEN ?='retry' THEN payload ELSE NULL END WHERE id=? AND status='sending'`,
    status,result.messageId||null,result.code||null,t+Math.min(3600,60*2**d.attempts),status==='retry'?null:now(),status,d.id);
}
