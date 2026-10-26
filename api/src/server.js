import nodemailer from 'nodemailer';
import { buildApp } from './app.js';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '127.0.0.1';
const MAIL_TO = env.MAIL_TO || 'infoashiyanarealestate@gmail.com';
const MAIL_FROM = env.MAIL_FROM || 'Ashiyana Website <website@ashiyanarealestate.in>';

function createMailer() {
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP_HOST is not set. Copy .env.example to .env and fill in the SMTP settings.');
    }
    // Local development: don't send, just log the message that would have been sent.
    console.warn('[api] SMTP_HOST not set: using a log-only mail transport (development only).');
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true', // true for 465, false for 587 (STARTTLS)
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

const mailer = createMailer();
const devLogger = !env.SMTP_HOST;

const app = await buildApp({
  mailer: devLogger
    ? {
        sendMail: async (msg) => {
          const info = await mailer.sendMail(msg);
          console.log('[api] would send email:\n' + JSON.stringify(JSON.parse(info.message), null, 2));
          return info;
        },
      }
    : mailer,
  mailTo: MAIL_TO,
  mailFrom: MAIL_FROM,
  siteUrl: env.SITE_URL || 'https://www.ashiyanarealestate.in',
  rateLimitMax: Number(env.RATE_LIMIT_MAX || 5),
  trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === 'true' || env.TRUST_PROXY : '127.0.0.1',
  logger: { level: env.LOG_LEVEL || 'info' },
});

if (env.SMTP_HOST) {
  mailer.verify().then(
    () => app.log.info('SMTP connection verified'),
    (err) => app.log.error({ err }, 'SMTP verification failed: enquiries will not be delivered until this is fixed'),
  );
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: PORT, host: HOST });
