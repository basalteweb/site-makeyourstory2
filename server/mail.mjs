import { createHash, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { many } from './db.mjs';
import { escapeHtml } from './ui.mjs';

export async function queueMail(db, recipient, kind, content, orderId = null, dedupKey = randomUUID()) {
  if (!recipient) return;
  await db.query(`insert into notifications (recipient,kind,content,order_id,dedup_key)
    values ($1,$2,$3,$4,$5) on conflict (dedup_key) do nothing`, [recipient, kind, content, orderId, dedupKey]);
}

function template({ title, message, link, button }) {
  const e = escapeHtml;
  return `<div style="margin:0;background:#fff3f5;padding:24px;color:#341722;font:16px/1.6 Arial,sans-serif">
    <div style="margin:auto;max-width:560px;background:#fff;padding:28px;border-radius:16px">
      <p style="letter-spacing:.18em;color:#831e46">MAKE YOUR STORY</p>
      <h1 style="font:32px Georgia,serif">${e(title)}</h1><p>${e(message)}</p>
      ${link ? `<p><a style="display:inline-block;background:#831e46;color:white;border-radius:7px;padding:12px 18px" href="${e(link)}">${e(button || 'Ouvrir MakeYourStory')}</a></p>` : ''}
      <p style="border-top:1px solid #ebd7df;padding-top:14px;color:#66364a;font-size:13px">MakeYourStory · BASALTE-WEB</p>
    </div></div>`;
}

export function ovhTransport(config) {
  return nodemailer.createTransport({
    host: 'smtp.mail.ovh.net', port: 465, secure: true,
    auth: { user: config.mailFrom, pass: config.ovhMailPassword },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true
  });
}

async function sendMail(config, transport, row) {
  const { title, message, link } = row.content;
  const content = {
    subject: title, html: template(row.content), text: `${title}\n\n${message}${link ? `\n\n${link}` : ''}`
  };
  if (transport) {
    const key = createHash('sha256').update(row.dedup_key).digest('hex');
    const result = await transport.sendMail({ ...content, from: { name: 'MakeYourStory', address: config.mailFrom },
      to: row.recipient, messageId: `<${key}@makeyourstory.fr>`, signal: AbortSignal.timeout(15000) });
    if (!result.accepted.length) throw new Error('smtp_rejected');
    return result.messageId;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': row.dedup_key },
    body: JSON.stringify({ ...content, from: config.mailFrom, to: [row.recipient] })
  });
  if (!response.ok) throw new Error(`resend_${response.status}`);
  return (await response.json()).id;
}

export async function flushMail(db, config) {
  if (config.mailMode === 'outbox') return;
  const transport = config.mailMode === 'ovh' ? ovhTransport(config) : null;
  // Lease each delivery so parallel workers cannot normally send the same message.
  const rows = await many(db, `update notifications set attempts=attempts+1, next_attempt_at=now()+interval '5 minutes'
    where id in (select id from notifications where sent_at is null and attempts<8 and next_attempt_at<=now()
    order by id limit 15 for update skip locked) returning *`);
  for (const row of rows) {
    const { title, message } = row.content;
    if ((!config.live && !config.mailAllowlist.includes(row.recipient)) ||
        (row.kind === 'login' && Date.now() - new Date(row.created_at).getTime() > 18 * 60 * 1000)) {
      await db.query("update notifications set attempts=8,error_code='suppressed',content=$2 where id=$1",
        [row.id, { title, message }]);
      continue;
    }
    try {
      const providerId = await sendMail(config, transport, row);
      await db.query('update notifications set sent_at=now(),provider_id=$2,error_code=null,content=$3 where id=$1',
        [row.id, providerId, row.kind === 'login' ? { title, message } : row.content]);
    } catch (err) {
      const code = /^resend_\d{3}$/.test(err.message) ? err.message
        : transport && Number.isInteger(err.responseCode) ? `smtp_${err.responseCode}` : 'unavailable';
      await db.query(`update notifications set error_code=$2,next_attempt_at=now()+($3::int*interval '1 minute') where id=$1`,
        [row.id, code, row.kind === 'login' ? 1 : Math.min(60, 2 ** row.attempts)]);
    }
  }
}

export async function pruneData(db) {
  await db.query('delete from login_tokens where expires_at<=now()');
  await db.query('delete from sessions where expires_at<=now()');
  await db.query('delete from rate_limits where expires_at<=now()');
  await db.query("delete from notifications where kind='login' and created_at<now()-interval '24 hours'");
  await db.query(`update responses r set dietary=null,dietary_consent_at=null from events e
    where e.id=r.event_id and r.dietary is not null and (e.event_date is null or e.event_date + 7 < (now() at time zone 'Europe/Paris')::date)`);
}
