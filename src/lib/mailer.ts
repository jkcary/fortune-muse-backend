import { config } from '../config.js';

export interface Mail { to: string; subject: string; text: string }

/** Outbox kept in memory so dev tools and tests can read the latest emails. */
export const devOutbox: Mail[] = [];

export async function sendMail(mail: Mail): Promise<void> {
  if (config.MAIL_TRANSPORT === 'postmark' && config.POSTMARK_TOKEN) {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.POSTMARK_TOKEN },
      body: JSON.stringify({ From: config.MAIL_FROM, To: mail.to, Subject: mail.subject, TextBody: mail.text }),
    });
    if (!res.ok) throw new Error(`Postmark error ${res.status}`);
    return;
  }
  devOutbox.push(mail);
  if (devOutbox.length > 50) devOutbox.shift();
  if (config.NODE_ENV !== 'test') console.log(`\n[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
}
