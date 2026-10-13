import {renderEmail} from '@riccqi/email-studio/template';
import { sendOne, sendBatch } from '@riccqi/email-studio/outbox';
import { escape, email } from './security.js';
export function announcement(c, url, postalAddress='') {
  if(c.markdown!=null)return {subject:c.subject,...renderEmail({subject:c.subject,markdown:c.markdown,preheader:c.preheader,postalAddress:c.postal_address??postalAddress,unsubscribeUrl:url,brand:{name:'OpenCam',domain:'opencam.app',color:'#d45a0b'}}),unsubscribe:url};
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
// Delivery rules live in the shared outbox; these keep OpenCam's call signatures.
export const sender = env => ({app:'opencam',from:'OpenCam <richard@opencam.app>',replyTo:email(env.REPLY_TO),apiKey:env.RESEND_API_KEY});
const configured = env => { if (!email(env.REPLY_TO) || !env.RESEND_API_KEY) throw new Error('Sender is not configured'); return sender(env); };
export const sendResend = (env, recipient, message, deliveryId, fetcher = fetch) => sendOne(configured(env), recipient, message, deliveryId, fetcher);
export const sendResendBatch = (env, items, fetcher = fetch) => sendBatch(configured(env), items, fetcher);
