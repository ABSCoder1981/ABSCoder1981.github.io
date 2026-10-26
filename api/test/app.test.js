import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, normalisePhone, buildSubject } from '../src/app.js';

function fakeMailer({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    sendMail: async (msg) => {
      if (fail) throw new Error('SMTP down');
      sent.push(msg);
      return { messageId: 'test' };
    },
  };
}

const valid = {
  name: 'Asha Deshpande',
  phone: '+91 98220 12345',
  intent: 'sell',
  locality: 'Kothrud',
  requirement: '2 BHK, 950 sq ft',
  sourcePage: '/services/sell',
  pageTitle: 'Sell Your Flat in Kothrud, Pune · Ashiyana',
  utm: { utm_source: 'google', utm_medium: 'organic' },
  submittedAt: '2026-10-21T10:00:00.000Z',
  website: '',
};

async function setup(opts = {}) {
  const mailer = fakeMailer(opts);
  const app = await buildApp({ mailer, mailTo: 'to@example.com', mailFrom: 'from@example.com', ...opts });
  return { app, mailer };
}

const post = (app, payload, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url: '/api/enquiry', payload, remoteAddress: ip });

test('normalisePhone accepts Indian mobile formats and rejects others', () => {
  assert.equal(normalisePhone('9822012345'), '9822012345');
  assert.equal(normalisePhone('+91 98220 12345'), '9822012345');
  assert.equal(normalisePhone('09822012345'), '9822012345');
  assert.equal(normalisePhone('919822012345'), '9822012345');
  assert.equal(normalisePhone('1234567890'), null); // must start 6-9
  assert.equal(normalisePhone('98220'), null);
  assert.equal(normalisePhone(''), null);
});

test('subject follows "New enquiry: Type · Locality · from /page"', () => {
  assert.equal(buildSubject({ intent: 'sell', locality: 'Kothrud', sourcePage: '/sell' }), 'New enquiry: Sell · Kothrud · from /sell');
  assert.equal(buildSubject({ intent: 'buy', locality: '', sourcePage: '/' }), 'New enquiry: Buy · from /');
  assert.equal(buildSubject({ intent: 'rent', locality: 'Warje\r\nBcc: x@y.z', sourcePage: '/warje' }), 'New enquiry: Rent or let out · Warje Bcc: x@y.z · from /warje');
});

test('valid enquiry is emailed with type, locality, source page and UTM tags', async () => {
  const { app, mailer } = await setup();
  const res = await post(app, valid);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(mailer.sent.length, 1);
  const msg = mailer.sent[0];
  assert.equal(msg.to, 'to@example.com');
  assert.equal(msg.subject, 'New enquiry: Sell · Kothrud · from /services/sell');
  assert.match(msg.text, /Mobile: \+91 98220 12345/);
  assert.match(msg.text, /Lead type: seller/);
  assert.match(msg.text, /utm_source=google, utm_medium=organic/);
  assert.match(msg.text, /Source page: https:\/\/www\.ashiyanarealestate\.in\/services\/sell/);
  assert.match(msg.html, /wa\.me\/919822012345/);
});

test('HTML in the requirement is escaped in the email', async () => {
  const { app, mailer } = await setup();
  await post(app, { ...valid, requirement: '<script>alert(1)</script>' });
  assert.doesNotMatch(mailer.sent[0].html, /<script>/);
  assert.match(mailer.sent[0].html, /&lt;script&gt;/);
});

test('rejects an invalid phone number', async () => {
  const { app, mailer } = await setup();
  const res = await post(app, { ...valid, phone: '12345' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'invalid_phone');
  assert.equal(mailer.sent.length, 0);
});

test('rejects missing name or unknown intent', async () => {
  const { app } = await setup();
  assert.equal((await post(app, { ...valid, name: '' })).statusCode, 400);
  assert.equal((await post(app, { ...valid, intent: 'steal' })).statusCode, 400);
  const { name, ...noName } = valid;
  assert.equal((await post(app, noName)).statusCode, 400);
});

test('honeypot submissions get a fake success and no email', async () => {
  const { app, mailer } = await setup();
  const res = await post(app, { ...valid, website: 'http://spam.example' });
  assert.equal(res.statusCode, 200);
  assert.equal(mailer.sent.length, 0);
});

test('SMTP failure returns 502 so the page can show phone and WhatsApp', async () => {
  const { app } = await setup({ fail: true });
  const res = await post(app, valid);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { ok: false, error: 'send_failed' });
});

test('rate limit: 5 enquiries per IP per hour, other IPs unaffected', async () => {
  const { app, mailer } = await setup();
  for (let i = 0; i < 5; i++) assert.equal((await post(app, valid, '10.0.0.9')).statusCode, 200);
  const blocked = await post(app, valid, '10.0.0.9');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error, 'rate_limited');
  assert.equal((await post(app, valid, '10.0.0.10')).statusCode, 200);
  assert.equal(mailer.sent.length, 6);
});

test('a non-path sourcePage is replaced with "/"', async () => {
  const { app, mailer } = await setup();
  await post(app, { ...valid, sourcePage: 'https://evil.example' });
  assert.match(mailer.sent[0].subject, /from \/$/);
});

test('enquiries from the staging host are tagged [STAGING]', async () => {
  const { app, mailer } = await setup();
  await app.inject({ method: 'POST', url: '/api/enquiry', payload: valid, headers: { host: 'staging.ashiyanarealestate.in' } });
  assert.ok(mailer.sent[0].subject.startsWith('[STAGING] New enquiry: Sell'), mailer.sent[0].subject);
});

test('health check', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.deepEqual(res.json(), { ok: true });
});
