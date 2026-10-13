import { escape, email } from './security.js';
export function announcement(c, url, postalAddress='') {
  const heading=c.campaign_type==='update'?c.subject:`OpenCam ${c.version}`;
  const download=c.campaign_type==='update'?'':`\n\nDownload: ${c.app_store_url}`;
  const downloadHtml=c.campaign_type==='update'?'':`<p><a href="${escape(c.app_store_url)}">Get OpenCam on the App Store</a></p>`;
  return {
    subject: c.subject,
    text: `${heading}\n\n${c.notes}${download}\n\nYou requested OpenCam updates.\nUnsubscribe: ${url}\nPrivacy: https://opencam.app/privacy/${postalAddress ? `\n${postalAddress}` : ''}`,
    html: `<h1>${escape(heading)}</h1><p>${escape(c.notes).replace(/\n/g,'<br>')}</p>${downloadHtml}<p>You requested OpenCam updates. <a href="${escape(url)}">Unsubscribe</a> · <a href="https://opencam.app/privacy/">Privacy</a></p>${postalAddress ? `<p>${escape(postalAddress)}</p>` : ''}`,
    unsubscribe: url
  };
}
export function confirmation(env, t) {
  const url = `${env.API_ORIGIN}/confirm?token=${t}`;
  return {subject:'Confirm your OpenCam updates', text:`Confirm your email to receive OpenCam updates:\n${url}\n\nThis link expires in 24 hours. Open the link and press Confirm. If you did not request this, ignore this email.\nPrivacy: https://opencam.app/privacy/`, html:`<h1>Get OpenCam updates</h1><p><a href="${escape(url)}">Review and confirm your subscription</a></p><p>Expires in 24 hours. If you did not request this, ignore this email.</p><p><a href="https://opencam.app/privacy/">Privacy</a></p>`};
}
// Stable provider idempotency key supplements the durable outbox; uncertain sends stay held.
export async function sendResend(env, recipient, message, deliveryId, fetcher = fetch) {
  if (!email(env.REPLY_TO) || !env.RESEND_API_KEY) throw new Error('Sender is not configured');
  const body = JSON.stringify({
    from:'OpenCam <updates@opencam.app>', reply_to:env.REPLY_TO, to:[recipient],
    subject:message.subject, text:message.text, html:message.html,
    tags:[{name:'app',value:'opencam'},{name:'delivery_id',value:deliveryId}],
    ...(message.unsubscribe ? {headers:{'List-Unsubscribe':`<${message.unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}} : {})
  });
  try {
    const r = await fetcher('https://api.resend.com/emails', {method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${env.RESEND_API_KEY}`,'Idempotency-Key':`opencam-${deliveryId}`}, body, signal:AbortSignal.timeout(15000), redirect:'manual'});
    if (r.status === 429) return {status:'retry', code:'throttled'};
    if (r.status >= 500 || r.status === 409) return {status:'ambiguous', code:`resend_${r.status}`};
    if (!r.ok) return {status:'failed', code:`resend_${r.status}`};
    const data = await r.json();
    return data.id ? {status:'sent', messageId:data.id} : {status:'ambiguous',code:'missing_message_id'};
  } catch { return {status:'ambiguous',code:'transport_uncertain'}; }
}
