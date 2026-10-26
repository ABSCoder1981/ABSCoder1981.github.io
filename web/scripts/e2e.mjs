// End-to-end smoke test against a running site (dev server, staging or production).
//   BASE_URL=http://localhost:4321 node scripts/e2e.mjs [--shots]
// Uses the locally installed Chrome (CHROME_PATH to override). Checks every page on desktop and
// mobile for console errors and horizontal overflow, then submits the enquiry form for real
// (success path) and with the API blocked (failure path). --shots saves screenshots to e2e-shots/.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = (process.env.BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const SHOTS = process.argv.includes('--shots');
const SUBMIT = !process.argv.includes('--no-submit'); // don't send real enquiries to production by accident
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const PAGES = [
  '/', '/services', '/services/buy', '/services/sell', '/services/rentals', '/services/valuation',
  '/services/investment', '/services/legal', '/services/property-management',
  '/kothrud', '/karvenagar', '/warje', '/prabhat-road', '/bavdhan', '/erandwane',
  '/about', '/careers', '/contact', '/projects/sanaswadi-industrial-land', '/privacy', '/terms', '/this-page-does-not-exist',
];
const VIEWPORTS = {
  desktop: { width: 1366, height: 860 },
  mobile: { width: 375, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const problems = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
if (SHOTS) await mkdir('e2e-shots', { recursive: true });

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  for (const path of PAGES) {
    errors.length = 0;
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const expectStatus = path === '/this-page-does-not-exist' ? 404 : 200;
    if (res.status() !== expectStatus) problems.push(`${vpName} ${path}: HTTP ${res.status()} (expected ${expectStatus})`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${vpName} ${path}: horizontal overflow ${overflow}px`);

    // Tap targets on mobile: every visible link/button at least 44px tall (inline text links excluded)
    if (vpName === 'mobile') {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('a.btn, button, .mobile-bar a, input, select')]
          .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
          .map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)),
      );
      if (small.length) problems.push(`mobile ${path}: tap targets under 44px: ${small.join(', ')}`);
    }

    if (path === '/this-page-does-not-exist') errors.splice(0, errors.length, ...errors.filter((e) => !/status of 404/.test(e)));
    if (errors.length) problems.push(`${vpName} ${path}: console errors: ${errors.join(' | ').slice(0, 300)}`);
    if (SHOTS) {
      const name = path === '/' ? 'home' : path.slice(1).replace(/\//g, '_');
      // scroll through so lazy images load before the full-page capture
      await page.evaluate(async () => {
        document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager'));
        await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      });
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `e2e-shots/${vpName}-${name}.png`, fullPage: true });
    }
  }
  await ctx.close();
}

// --- Enquiry form: success path ---
async function fillForm(page) {
  const form = page.locator('form.ef').first();
  await form.scrollIntoViewIfNeeded();
  await form.locator('input[name="name"]').fill('E2E Test');
  await form.locator('input[name="phone"]').fill('98220 12345');
  return form;
}

if (SUBMIT) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.mobile });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/services/sell?utm_source=e2e&utm_medium=test`, { waitUntil: 'networkidle' });

  // validation: empty submit shows errors and doesn't send
  let requests = 0;
  page.on('request', (r) => r.url().includes('/api/enquiry') && requests++);
  const form = page.locator('form.ef').first();
  await form.scrollIntoViewIfNeeded();
  await form.locator('input[name="phone"]').fill('12345');
  await form.locator('button[type="submit"]').click();
  if (!(await form.locator('.ef__err').first().isVisible())) problems.push('form: validation errors not shown');
  if (requests) problems.push('form: invalid form was sent');

  // pre-set intent on the Sell page
  const checked = await form.locator('input[name="intent"]:checked').getAttribute('value');
  if (checked !== 'sell') problems.push(`form: intent not pre-set to sell on /services/sell (got ${checked})`);

  await fillForm(page);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/enquiry')),
    form.locator('button[type="submit"]').click(),
  ]);
  const sent = JSON.parse(resp.request().postData() || '{}');
  if (resp.status() !== 200) problems.push(`form: API returned ${resp.status()}`);
  if (sent.sourcePage !== '/services/sell') problems.push(`form: sourcePage was ${sent.sourcePage}`);
  if (sent.utm?.utm_source !== 'e2e') problems.push('form: UTM tags not captured');
  if (!sent.submittedAt) problems.push('form: timestamp missing');
  await page.getByText("Thanks, we've received your enquiry").waitFor({ timeout: 5000 }).catch(() => problems.push('form: success message not shown'));
  if (SHOTS) await page.screenshot({ path: 'e2e-shots/form-success.png' });

  // locality pre-set on a locality page
  await page.goto(`${BASE}/warje`, { waitUntil: 'networkidle' });
  const loc = await page.locator('form.ef select[name="locality"]').first().inputValue();
  if (loc !== 'Warje') problems.push(`form: locality not pre-set on /warje (got "${loc}")`);

  // --- failure path: API unreachable → phone + WhatsApp shown ---
  await page.route('**/api/enquiry', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' }));
  await page.goto(`${BASE}/contact`, { waitUntil: 'networkidle' });
  const f2 = await fillForm(page);
  await f2.locator('input[name="intent"][value="buy"]').check({ force: true });
  await f2.locator('button[type="submit"]').click();
  const fail = f2.locator('.ef__fail');
  await fail.waitFor({ timeout: 5000 }).catch(() => problems.push('form: failure message not shown'));
  if (!(await fail.locator('a[href^="tel:"]').count()) || !(await fail.locator('a[href*="wa.me"]').count()))
    problems.push('form: failure state missing phone or WhatsApp');
  if (SHOTS) await fail.screenshot({ path: 'e2e-shots/form-failure.png' });
  await ctx.close();
}

// --- Mobile contact bar never covers content (UI guidelines P0), on a short phone screen ---
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const path of ['/contact', '/services/sell', '/']) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const bar = page.locator('.mobile-bar');
    // 1. Scrolled to the very bottom, the last content (copyright) sits above the bar
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const legal = await page.locator(':is(.footer__legal, .tf__legal) p').first().boundingBox();
    const barBox = await bar.boundingBox();
    if (!legal || !barBox || legal.y + legal.height > barBox.y) problems.push(`mobile bar covers the footer on ${path}`);
    // 2. Keyboard-focused submit button is fully visible above the bar
    const submit = page.locator('form.ef button[type=submit]').first();
    if (await submit.count()) {
      await submit.focus();
      await page.waitForTimeout(250);
      const sb = await submit.boundingBox();
      const bb = await bar.boundingBox();
      if (!sb || !bb || sb.y + sb.height > bb.y) problems.push(`mobile bar covers the submit button on ${path}`);
      // 3. While typing in a field, the bar gets out of the way
      await page.locator('form.ef input[name=name]').first().focus();
      await page.waitForTimeout(350);
      if (await bar.isVisible()) problems.push(`mobile bar stays visible while typing on ${path}`);
      await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    }
  }
  await ctx.close();
}

await browser.close();

if (problems.length) {
  console.error(`✖ ${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`✔ ${PAGES.length} pages × 2 viewports OK; form validation, pre-sets, success and failure paths OK; mobile bar never covers content`);
