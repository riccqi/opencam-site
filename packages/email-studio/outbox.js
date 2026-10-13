// Shared Resend delivery queue for OpenCam and TabTab. Each app keeps its own D1
// database and contacts; this module owns the sending rules. A cron run claims up to
// 100 due deliveries, the app turns each into an email (or skips/holds it), and they go
// to Resend in one batch request. Throttling retries with backoff; any outcome where
// Resend may have accepted the email is held as 'ambiguous' and never resent
// automatically. Resend Pro has no daily cap, so nothing here budgets per day.
//
// Required tables: deliveries(id TEXT PRIMARY KEY, campaign_id, kind, payload,
// status ('queued','sending','sent','retry','failed','ambiguous','skipped'), attempts,
// available_at, started_at, finished_at, message_id, error_code) plus any app-owned
// columns, and send_lock(id=1, next_at). Times are Unix seconds.

export const BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 5;
const now = () => Math.floor(Date.now() / 1000);
const encoder = new TextEncoder();
async function sha256(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

// sender: {app, from, replyTo, apiKey}
function resendEmail(sender, {id, recipient, message}) {
  return {
    from: sender.from, reply_to: sender.replyTo, to: [recipient],
    subject: message.subject, text: message.text, html: message.html,
    tags: [{name: 'app', value: sender.app}, ...(id ? [{name: 'delivery_id', value: id}] : [])],
    ...(message.unsubscribe ? {headers: {'List-Unsubscribe': `<${message.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'}} : {})
  };
}
async function post(sender, path, body, key, fetcher) {
  if (!sender.apiKey || !sender.from) throw new Error('Sender is not configured');
  return fetcher(`https://api.resend.com${path}`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${sender.apiKey}`, 'Idempotency-Key': key}, body, signal: AbortSignal.timeout(15000), redirect: 'manual'});
}
function failure(status) {
  if (status === 429) return {status: 'retry', code: 'throttled'};
  if (status >= 500 || status === 409) return {status: 'ambiguous', code: `resend_${status}`};
  return {status: 'failed', code: `resend_${status}`};
}

// One email now (sign-in codes, tests). Returns {status:'sent'|'retry'|'failed'|'ambiguous', messageId?, code?}.
export async function sendOne(sender, recipient, message, key, fetcher = fetch) {
  try {
    const r = await post(sender, '/emails', JSON.stringify(resendEmail(sender, {recipient, message})), `${sender.app}-${key}`, fetcher);
    if (!r.ok) return failure(r.status);
    const data = await r.json();
    return data.id ? {status: 'sent', messageId: data.id} : {status: 'ambiguous', code: 'missing_message_id'};
  } catch (e) {
    if (e.message === 'Sender is not configured') throw e;
    return {status: 'ambiguous', code: 'transport_uncertain'};
  }
}

// Up to 100 emails in one request. The idempotency key covers the exact ordered payload.
export async function sendBatch(sender, items, fetcher = fetch) {
  if (!items.length || items.length > BATCH_SIZE) throw new Error(`Batch must contain 1–${BATCH_SIZE} emails`);
  const body = JSON.stringify(items.map(item => resendEmail(sender, item)));
  const all = result => items.map(() => result);
  try {
    const r = await post(sender, '/emails/batch', body, `${sender.app}-batch-${await sha256(body)}`, fetcher);
    if (!r.ok) return all(failure(r.status));
    const {data} = await r.json();
    if (!Array.isArray(data) || data.length !== items.length || data.some(d => typeof d?.id !== 'string' || !d.id) || new Set(data.map(d => d.id)).size !== data.length) return all({status: 'ambiguous', code: 'invalid_batch_response'});
    return data.map(d => ({status: 'sent', messageId: d.id}));
  } catch (e) {
    if (e.message === 'Sender is not configured') throw e;
    return all({status: 'ambiguous', code: 'transport_uncertain'});
  }
}

const json = rows => JSON.stringify(rows);
// app: {sender, claimable?: {sql, args}, prepare(env, deliveries) -> [{recipient,message}|{skip:code}|{hold:true}]}
// deps (tests): {send(env, recipient, message, id)} per email, or {sendBatch(env, items)}.
export async function drain(env, app, deps = {}) {
  const t = now(), DB = env.DB;
  // A crash between handoff and recording leaves 'sending'; never retry it automatically.
  await DB.prepare("UPDATE deliveries SET status='ambiguous',error_code='interrupted',payload=NULL WHERE status='sending' AND started_at<?").bind(t - 300).run();
  await DB.prepare('UPDATE deliveries SET payload=NULL WHERE finished_at<? AND payload IS NOT NULL').bind(t - 86400).run();
  // One batch per minute across overlapping cron invocations (50s tolerates cron jitter).
  if (!await DB.prepare('UPDATE send_lock SET next_at=? WHERE id=1 AND next_at<=? RETURNING id').bind(t + 50, t).first()) return {claimed: 0};
  const filter = app.claimable || {sql: '1', args: []};
  const claimed = (await DB.prepare(`UPDATE deliveries SET status='sending',started_at=?,attempts=attempts+1 WHERE id IN (
    SELECT id FROM deliveries WHERE status IN ('queued','retry') AND available_at<=? AND (${filter.sql}) ORDER BY available_at,id LIMIT ?
    ) AND status IN ('queued','retry') RETURNING *`).bind(t, t, ...filter.args, BATCH_SIZE).all()).results;
  if (!claimed.length) return {claimed: 0};
  const prepared = await app.prepare(env, claimed), skipped = [], held = [], ready = [];
  claimed.forEach((d, i) => {
    const p = prepared[i] || {skip: 'not_prepared'};
    if (p.hold) held.push(d.id);
    else if (p.skip) skipped.push({id: d.id, code: p.skip});
    else ready.push({id: d.id, recipient: p.recipient, message: p.message, delivery: d});
  });
  if (skipped.length) await DB.prepare(`UPDATE deliveries SET status='skipped',error_code=json_extract(j.value,'$.code'),finished_at=?,payload=NULL
    FROM json_each(?) j WHERE deliveries.id=json_extract(j.value,'$.id') AND deliveries.status='sending'`).bind(t, json(skipped)).run();
  if (held.length) await DB.prepare("UPDATE deliveries SET status='queued',attempts=attempts-1 WHERE status='sending' AND id IN (SELECT value FROM json_each(?))").bind(json(held)).run();
  if (!ready.length) return {claimed: claimed.length, sent: 0};
  ready.sort((a, b) => a.id.localeCompare(b.id));
  const results = deps.send ? await Promise.all(ready.map(i => deps.send(env, i.recipient, i.message, i.id)))
    : await (deps.sendBatch ? deps.sendBatch(env, ready) : sendBatch(app.sender, ready, deps.fetch || fetch));
  const t2 = now(), outcomes = ready.map((item, i) => {
    const r = results[i] || {status: 'ambiguous', code: 'missing_batch_result'};
    const status = r.status === 'retry' && item.delivery.attempts >= MAX_ATTEMPTS ? 'failed' : r.status;
    return {id: item.id, status, message_id: r.messageId || null, code: r.code || null, available_at: t2 + Math.min(3600, 60 * 2 ** item.delivery.attempts), finished_at: status === 'retry' ? null : t2};
  });
  await DB.prepare(`UPDATE deliveries SET status=json_extract(j.value,'$.status'),message_id=json_extract(j.value,'$.message_id'),error_code=json_extract(j.value,'$.code'),
    available_at=json_extract(j.value,'$.available_at'),finished_at=json_extract(j.value,'$.finished_at'),payload=CASE WHEN json_extract(j.value,'$.status')='retry' THEN payload ELSE NULL END
    FROM json_each(?) j WHERE deliveries.id=json_extract(j.value,'$.id') AND deliveries.status='sending'`).bind(json(outcomes)).run();
  return {claimed: claimed.length, sent: outcomes.filter(o => o.status === 'sent').length};
}

// Resend webhook: a sent/delivered/bounce event proves acceptance, so it settles a held delivery.
export function reconcileStatement(env, event) {
  const tags = event?.data?.tags;
  const id = Array.isArray(tags) ? tags.find(t => t?.name === 'delivery_id')?.value : tags?.delivery_id;
  if (!['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.suppressed'].includes(event?.type) || typeof id !== 'string' || typeof event.data?.email_id !== 'string') return null;
  return env.DB.prepare("UPDATE deliveries SET status='sent',message_id=?,error_code=NULL,finished_at=?,payload=NULL WHERE id=? AND status IN ('sending','ambiguous')").bind(event.data.email_id, now(), id);
}

// Emails handed to Resend in the last 24 hours (for the dashboard).
export async function sentLastDay(env) {
  return (await env.DB.prepare("SELECT count(*) n FROM deliveries WHERE started_at>? AND status IN ('sent','sending','ambiguous','failed')").bind(now() - 86400).first()).n;
}
