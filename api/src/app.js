import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

export const INTENTS = {
  buy: { label: 'Buy', leadType: 'buyer' },
  sell: { label: 'Sell', leadType: 'seller' },
  rent: { label: 'Rent or let out', leadType: 'rental' },
  invest: { label: 'Invest', leadType: 'investor' },
};

/** Accepts 98xxxxxxxx, +91 98xxx xxxxx, 098xxxxxxxx. Returns the 10-digit number or null. */
export function normalisePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "New enquiry: Sell · Kothrud · from /services/sell" — filterable by type and page in the inbox. */
export function buildSubject({ intent, locality, sourcePage }) {
  const parts = [INTENTS[intent].label];
  if (locality) parts.push(oneLine(locality));
  parts.push(`from ${oneLine(sourcePage) || '/'}`);
  return `New enquiry: ${parts.join(' · ')}`;
}

export function buildEmail(e, { siteUrl }) {
  const intent = INTENTS[e.intent];
  const utm = Object.entries(e.utm || {})
    .map(([k, v]) => `${k}=${oneLine(v)}`)
    .join(', ');
  const waLink = `https://wa.me/91${e.phone}`;
  const rows = [
    ['Name', e.name],
    ['Mobile', `+91 ${e.phone.slice(0, 5)} ${e.phone.slice(5)}`],
    ['Wants to', intent.label],
    ['Lead type', intent.leadType],
    ['Locality', e.locality || '—'],
    ['Requirement', e.requirement || '—'],
    ['Source page', `${siteUrl}${e.sourcePage}`],
    ['Page title', e.pageTitle || '—'],
    ['UTM tags', utm || '—'],
    ['Submitted', e.submittedAt],
    ['Received', e.receivedAt],
  ];

  const text = [
    `New website enquiry (${intent.leadType})`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Call: tel:+91${e.phone}`,
    `WhatsApp: ${waLink}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0d253d;line-height:1.5">
<h2 style="font-weight:400;margin:0 0 12px">New website enquiry <span style="color:#533afd">(${esc(intent.leadType)})</span></h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="color:#64748d;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('\n')}
</table>
<p style="margin-top:16px">
<a href="tel:+91${esc(e.phone)}" style="background:#533afd;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Call ${esc(e.name)}</a>
&nbsp;<a href="${esc(waLink)}" style="background:#128c4a;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">WhatsApp</a>
</p></body></html>`;

  return { text, html };
}

const enquirySchema = {
  body: {
    type: 'object',
    required: ['name', 'phone', 'intent'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 80 },
      phone: { type: 'string', maxLength: 20 },
      intent: { type: 'string', enum: Object.keys(INTENTS) },
      locality: { type: 'string', maxLength: 60 },
      requirement: { type: 'string', maxLength: 1000 },
      sourcePage: { type: 'string', maxLength: 200 },
      pageTitle: { type: 'string', maxLength: 200 },
      submittedAt: { type: 'string', maxLength: 40 },
      website: { type: 'string', maxLength: 200 }, // honeypot
      utm: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((k) => [k, { type: 'string', maxLength: 100 }]),
        ),
      },
    },
  },
};

/**
 * @param {object} opts
 * @param {{ sendMail: (msg: object) => Promise<unknown> }} opts.mailer  nodemailer transport (or a test double)
 * @param {string} opts.mailTo
 * @param {string} opts.mailFrom
 * @param {string} [opts.siteUrl]
 * @param {number} [opts.rateLimitMax]   enquiries per IP per window (PRD: 5 per hour)
 * @param {string|number} [opts.rateLimitWindow]
 * @param {boolean|string} [opts.trustProxy]  true behind Nginx so the client IP comes from X-Forwarded-For
 */
export async function buildApp({
  mailer,
  mailTo,
  mailFrom,
  siteUrl = 'https://www.ashiyanarealestate.in',
  rateLimitMax = 5,
  rateLimitWindow = '1 hour',
  trustProxy = false,
  logger = false,
}) {
  const app = Fastify({ logger, trustProxy, bodyLimit: 16 * 1024 });

  await app.register(rateLimit, { global: false });

  app.get('/api/health', async () => ({ ok: true }));

  app.post(
    '/api/enquiry',
    {
      schema: enquirySchema,
      config: {
        rateLimit: {
          max: rateLimitMax,
          timeWindow: rateLimitWindow,
          errorResponseBuilder: (_req, ctx) => ({
            statusCode: 429,
            ok: false,
            error: 'rate_limited',
            message: `Too many enquiries. Please try again in ${ctx.after}, or call us.`,
          }),
        },
      },
    },
    async (req, reply) => {
      const b = req.body;

      // Honeypot filled: almost certainly a bot. Pretend success so it doesn't retry.
      if (b.website && b.website.trim() !== '') {
        req.log.warn({ ip: req.ip }, 'honeypot triggered, enquiry dropped');
        return { ok: true };
      }

      const phone = normalisePhone(b.phone);
      if (!phone) return reply.code(400).send({ ok: false, error: 'invalid_phone' });

      const name = oneLine(b.name);
      if (name.length < 2) return reply.code(400).send({ ok: false, error: 'invalid_name' });

      const sourcePage = typeof b.sourcePage === 'string' && b.sourcePage.startsWith('/') ? oneLine(b.sourcePage) : '/';

      const enquiry = {
        name,
        phone,
        intent: b.intent,
        locality: oneLine(b.locality),
        requirement: String(b.requirement ?? '').trim(),
        sourcePage,
        pageTitle: oneLine(b.pageTitle),
        utm: b.utm || {},
        submittedAt: oneLine(b.submittedAt) || '—',
        receivedAt: new Date().toISOString(),
      };

      const { text, html } = buildEmail(enquiry, { siteUrl });
      try {
        await mailer.sendMail({
          from: mailFrom,
          to: mailTo,
          // Staging shares this API; tag its enquiries so they're never mistaken for real leads
          subject: (String(req.headers.host || '').startsWith('staging.') ? '[STAGING] ' : '') + buildSubject(enquiry),
          text,
          html,
        });
      } catch (err) {
        req.log.error({ err }, 'failed to send enquiry email');
        return reply.code(502).send({ ok: false, error: 'send_failed' });
      }

      req.log.info({ intent: enquiry.intent, locality: enquiry.locality, sourcePage }, 'enquiry sent');
      return { ok: true };
    },
  );

  // Schema validation errors → a consistent { ok:false } shape the form understands
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ ok: false, error: 'invalid_request' });
    if (err.statusCode === 429) return reply.code(429).send(err);
    req.log.error({ err }, 'unhandled error');
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ ok: false, error: 'server_error' });
  });

  return app;
}
