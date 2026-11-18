import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(value, status, message) {
  if (!value) throw new HttpError(status, message);
  return value;
}
export function configFrom(env = process.env) {
  const mode = env.APP_MODE || 'local';
  assert(['local', 'test', 'production'].includes(mode), 500, 'APP_MODE invalide.');
  const live = mode === 'production';
  const origin = new URL(env.APP_URL || 'http://localhost:3000');
  const databaseUrl = env.DATABASE_URL;
  const secret = env.APP_SECRET || (live ? '' : randomBytes(48).toString('hex'));
  const stripeKey = env.STRIPE_API_KEY || '';
  const publicCheckout = env.CHECKOUT_ENABLED === 'true';
  const deliveryDays = env.DELIVERY_BUSINESS_DAYS ? integer(env.DELIVERY_BUSINESS_DAYS, 1, 90) : null;
  const adminEmails = (env.ADMIN_EMAILS || '').split(',').filter(Boolean).map(emailAddress);
  const mailMode = env.MAIL_MODE || 'outbox';
  const testRecipients = (env.TEST_EMAIL_ALLOWLIST || '').split(',').filter(Boolean).map(emailAddress);
  const storageDir = resolve(env.MEDIA_DIR || '.runtime/media');
  assert(!live || (origin.protocol === 'https:' && ['makeyourstory.fr','www.makeyourstory.fr'].includes(origin.hostname)
    && databaseUrl && secret.length >= 40 && env.MEDIA_DIR && adminEmails.length && env.HOSTING_NAME),
  500, 'Origine, PostgreSQL, médias persistants, secret, hébergeur et accès administrateur requis en production.');
  assert(!stripeKey || new RegExp(live ? '^[sr]k_live_' : '^(?:[sr]k|rkcs)_test_').test(stripeKey),
    500, 'Mode de la clé Stripe incompatible.');
  assert(['outbox', 'resend', 'ovh'].includes(mailMode) && (!live || mailMode !== 'outbox'), 500, 'Service de messagerie incompatible.');
  assert(mailMode === 'outbox' || (env.MAIL_FROM && (live || testRecipients.length)),
    500, 'Expéditeur et destinataires de test requis.');
  assert(mailMode !== 'resend' || env.RESEND_API_KEY, 500, 'Clé Resend requise.');
  const mailFrom = mailMode === 'ovh' ? emailAddress(env.MAIL_FROM) : env.MAIL_FROM;
  assert(mailMode !== 'ovh' || (mailFrom.endsWith('@makeyourstory.fr') && env.OVH_MAIL_PASSWORD),
    500, 'Boîte SMTP OVH MakeYourStory et mot de passe requis.');
  assert(!publicCheckout || (stripeKey && env.STRIPE_WEBHOOK_SECRET && (!live || (env.TERMS_VERSION && env.CONSUMER_MEDIATOR && httpsUrl(env.CONSUMER_MEDIATOR_URL) && env.ADMIN_NOTIFY_EMAIL && deliveryDays))),
    500, 'Stripe, webhook et informations contractuelles incomplets.');
  return {
    mode, live, origin: origin.origin, databaseUrl, secret, publicCheckout, adminEmails, mailMode,
    port: Number(env.PORT || 3000), storageDir, migrate: !live || env.MIGRATE === 'true',
    databasePath: mode === 'test' ? 'memory://' : resolve(env.LOCAL_DATABASE_PATH || '.runtime/postgresql'),
    stripeKey, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    resendKey: env.RESEND_API_KEY, mailFrom, ovhMailPassword: env.OVH_MAIL_PASSWORD,
    mailAllowlist: testRecipients,
    adminNotify: env.ADMIN_NOTIFY_EMAIL ? emailAddress(env.ADMIN_NOTIFY_EMAIL) : adminEmails[0],
    termsVersion: env.TERMS_VERSION || '2026-11-17',
    mediator: env.CONSUMER_MEDIATOR || '', mediatorUrl: httpsUrl(env.CONSUMER_MEDIATOR_URL),
    hostingName: env.HOSTING_NAME || '',
    proxyHops: Number(env.TRUST_PROXY_HOPS || 0), deliveryDays,
    vatNotice: env.BILLING_VAT_NOTICE || ''
  };
}

export function value(input, max = 200, required = false) {
  const text = typeof input === 'string' ? input.trim() : '';
  assert(text.length <= max && (!required || text.length) && !text.includes('\0'), 400,
    `Vérifiez les champs obligatoires et la limite de ${max} caractères.`);
  return text;
}
export function emailAddress(input) {
  const email = value(input, 254, true).toLowerCase();
  assert(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email), 400, 'Saisissez une adresse e-mail valide.');
  return email;
}
export function uuid(input) {
  assert(typeof input === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input), 404, 'Élément introuvable.');
  return input;
}
export function dateValue(input) {
  if (!input) return null;
  assert(typeof input === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(input), 400, 'Vérifiez la date saisie.');
  const d = new Date(input);
  assert(Number.isFinite(+d) && d.toISOString().slice(0, 10) === input, 400, 'Vérifiez la date saisie.');
  return input;
}
export function integer(input, min, max) {
  const n = Number(input);
  assert(input !== '' && input != null && Number.isInteger(n) && n >= min && n <= max,
    400, `Saisissez un nombre compris entre ${min} et ${max}.`);
  return n;
}
export const checked = (input) => input === 'on' || input === 'oui' || input === true;
export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const mac = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');
export const token = () => randomBytes(32).toString('base64url');
export const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
export function sameToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function httpsUrl(input, hostname) {
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && !url.username && !url.password && (!hostname || url.hostname === hostname)) return url.href;
  } catch { /* Missing external link. */ }
  return null;
}
export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), part.slice(separator + 1)]];
  }));
}
export function privatePage(res) {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'same-origin' });
}
