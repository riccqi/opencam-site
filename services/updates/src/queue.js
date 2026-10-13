import { drain as drainOutbox } from '@riccqi/email-studio/outbox';
import { now, decrypt, unsubscribeToken } from './security.js';
import { run, all } from './db.js';
import { announcement, sender } from './mail.js';
const ids = rows => JSON.stringify([...new Set(rows)]);
const explicitOptIn = s => ['legacy-form-updates-owner-reviewed-2026-10-13','opencam-updates-single-opt-in-v3'].includes(s.consent_version) && !!s.consent_evidence;

// Turns claimed deliveries into emails with a fixed number of queries per batch.
async function prepare(env, deliveries) {
  const announcements = deliveries.filter(d => d.kind === 'announcement');
  const subscribers = Object.fromEntries((await all(env,'SELECT s.* FROM json_each(?) j JOIN subscribers s ON s.id=j.value',ids(announcements.map(d => d.subscriber_id)))).map(s => [s.id,s]));
  const campaigns = Object.fromEntries((await all(env,'SELECT c.* FROM json_each(?) j JOIN campaigns c ON c.id=j.value',ids(announcements.map(d => d.campaign_id)))).map(c => [c.id,c]));
  const tests = deliveries.filter(d => d.kind === 'test').map(d => ({id:d.id,...decrypt(env,d.payload)}));
  const suppressed = new Set((await all(env,"SELECT s.email FROM json_each(?) j JOIN subscribers s ON s.email=j.value WHERE s.status='suppressed'",ids(tests.map(t => t.recipient)))).map(s => s.email));
  const allowed = (env.TEST_RECIPIENTS || '').split(',').map(s => s.trim().toLowerCase());
  return deliveries.map(d => {
    if (d.kind === 'confirmation') return {skip:'confirmation_disabled'};
    if (d.kind === 'test') {
      const t = tests.find(x => x.id === d.id);
      if (!allowed.includes(t.recipient)) return {skip:'test_not_allowed'};
      return suppressed.has(t.recipient) ? {skip:'recipient_ineligible'} : {recipient:t.recipient,message:t.message};
    }
    if (!env.POSTAL_ADDRESS?.trim()) return {skip:'postal_address_missing'};
    const s = subscribers[d.subscriber_id], c = campaigns[d.campaign_id];
    if (!s || s.status !== 'subscribed') return {skip:'not_subscribed'};
    if (!c?.launched_at) return {skip:'not_launched'};
    if (c.paused) return {hold:true};
    if (!s.confirmed_at && !explicitOptIn(s)) return {skip:'consent_missing'};
    if (c.campaign_type === 'update' && s.consent_version !== 'opencam-updates-2026-10-13-v2' && !explicitOptIn(s)) return {skip:'consent_scope'};
    return {recipient:s.email,message:announcement(c,`${env.API_ORIGIN}/unsubscribe?token=${unsubscribeToken(env,s.id)}`,env.POSTAL_ADDRESS)};
  });
}

export async function drain(env, deps = {}) {
  const t = now();
  await run(env, 'DELETE FROM rate_limits WHERE expires < ?', t);
  await run(env, 'DELETE FROM events WHERE received_at < ?', t-30*86400);
  await run(env, "DELETE FROM subscribers WHERE status='pending' AND last_confirmation_at < ?", t-30*86400);
  if (env.SENDING_ENABLED !== 'true') return;
  return drainOutbox(env, {
    sender: sender(env),
    // Paused or not-yet-enabled campaigns stay queued without being claimed.
    claimable: {sql:"kind!='announcement' OR (?='true' AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=deliveries.campaign_id AND c.paused=0))",args:[env.LIVE_SEND_ENABLED]},
    prepare
  }, deps);
}
