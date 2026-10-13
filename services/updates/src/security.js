import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
export const now = () => Math.floor(Date.now() / 1000);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
export function equal(a, b) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
export function key(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('Missing encryption key');
  return Buffer.from(value, 'hex');
}
export const unsubscribeToken = (env, id) => hmac(key(env.TOKEN_KEY), `unsubscribe:${id}`);
export function encrypt(env, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(env.DATA_KEY), iv);
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decrypt(env, value) {
  const b = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key(env.DATA_KEY), b.subarray(0,12));
  cipher.setAuthTag(b.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString());
}
export function email(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (s.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  const local = s.split('@')[0];
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') ? s : null;
}
export const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function verifyResend(raw, headers, secret) {
  const id=headers.get('svix-id'), timestamp=headers.get('svix-timestamp');
  if (!id || id.length>200 || !/^\d+$/.test(timestamp||'') || Math.abs(now()-Number(timestamp))>300 || !/^whsec_[A-Za-z0-9+/=]+$/.test(secret||'')) throw new Error('Invalid webhook metadata');
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${raw}`).digest();
  const valid=(headers.get('svix-signature')||'').split(' ').some(part=>{
    const [version,signature]=part.split(',');
    if(version!=='v1'||!signature)return false;
    const actual=Buffer.from(signature,'base64');
    return actual.length===expected.length && timingSafeEqual(actual,expected);
  });
  if(!valid)throw new Error('Invalid webhook signature');
  return {id,event:JSON.parse(raw)};
}
