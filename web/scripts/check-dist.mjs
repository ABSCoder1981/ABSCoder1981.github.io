// Post-build QA for dist/: checks the PRD's SEO, content and conversion rules on every page.
// Run after `astro build`: node scripts/check-dist.mjs   (exit code 1 on any failure)
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Prototype pages: checked like every other page, but not part of the 22-page sitemap
const PROTOTYPES = ['/landing'];

const EXPECTED_PAGES = [
  '/', '/services', '/services/buy', '/services/sell', '/services/rentals', '/services/valuation',
  '/services/investment', '/services/legal', '/services/property-management',
  '/kothrud', '/karvenagar', '/warje', '/prabhat-road', '/bavdhan', '/erandwane',
  '/about', '/careers', '/contact', '/projects/sanaswadi-industrial-land', '/privacy', '/terms', '/404',
];

// Claims the audit/PRD say must not appear anywhere
const BANNED = [
  [/Easy Work Real Estate/i, 'agency credit in footer'],
  [/98%/, 'unsourced 98% satisfaction stat'],
  [/500\+/, 'old 500+ clients stat'],
  [/15\+\s*years/i, 'old 15+ years stat'],
  [/25\+/, 'old 25+ years stat'],
  [/direct highway access/i, '"direct highway access" claim'],
  [/100% legal/i, 'unproven "100% legal verified" claim'],
  [/RERA (No|Reg)/i, 'RERA number (not registered)'],
];

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = await walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const fileSet = new Set(files.map((f) => '/' + relative(DIST, f).split(sep).join('/')));

const toRoute = (f) => {
  const r = '/' + relative(DIST, f).split(sep).join('/');
  if (r === '/index.html') return '/';
  return r.replace(/\.html$/, '');
};
const resolves = (path) => {
  const p = path.split('#')[0].split('?')[0];
  if (p === '/' ) return fileSet.has('/index.html');
  return fileSet.has(p) || fileSet.has(`${p}.html`) || fileSet.has(`${p}/index.html`);
};

const errors = [];
const warn = [];
const titles = new Map();
const descs = new Map();
const fail = (route, msg) => errors.push(`${route}: ${msg}`);

const routes = htmlFiles.map(toRoute);
for (const r of EXPECTED_PAGES) if (!routes.includes(r)) fail(r, 'expected page missing');
const sitePages = routes.filter((r) => !PROTOTYPES.includes(r));
if (sitePages.length !== 22) fail('dist', `expected 22 pages, found ${sitePages.length}`);
// Prototypes must never be indexed by search engines
for (const p of PROTOTYPES) {
  const file = htmlFiles.find((f) => toRoute(f) === p);
  if (file && !/<meta name="robots" content="noindex/.test(await readFile(file, 'utf8'))) fail(p, 'prototype page must be noindex');
}

for (const f of htmlFiles) {
  const route = toRoute(f);
  const html = await readFile(f, 'utf8');
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.replace(/&amp;/g, '&');
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1]?.replace(/&amp;/g, '&');
  if (!title) fail(route, 'no <title>');
  else {
    if (title.length >= 60) fail(route, `title ${title.length} chars (must be under 60): ${title}`);
    if (titles.has(title)) fail(route, `duplicate title with ${titles.get(title)}`);
    titles.set(title, route);
  }
  if (!desc) fail(route, 'no meta description');
  else {
    if (desc.length >= 155) fail(route, `description ${desc.length} chars (must be under 155)`);
    if (descs.has(desc)) fail(route, `duplicate description with ${descs.get(desc)}`);
    descs.set(desc, route);
  }

  const h1s = (visible.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) fail(route, `${h1s} <h1> elements (must be exactly 1)`);

  // Imagery rule: only Ashiyana's own photos (local Pune team, clients, plots), never stock or remote images
  for (const [, src] of visible.matchAll(/<(?:img|source)\b[^>]*?\s(?:src|srcset)="([^"]+)"/g)) {
    if (/^(https?:)?\/\//.test(src.trim())) fail(route, `remote/stock image not allowed: ${src.slice(0, 80)}`);
  }
  for (const img of visible.match(/<img\b[^>]*>/g) || []) {
    // Empty alt is minified to a bare `alt` attribute — valid for decorative images
    if (!/\salt(=|\s|>|\/)/.test(img)) fail(route, `img without alt: ${img.slice(0, 100)}`);
    if (/src="[^"]+\.(png)"/.test(img) && !/icon/.test(img)) warn.push(`${route}: PNG <img> ${img.slice(0, 80)}`);
  }

  // Structured data
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      fail(route, 'invalid JSON-LD');
      return {};
    }
  });
  const types = ld.flatMap((b) => [].concat(b['@type'] || []));
  if (!types.includes('RealEstateAgent') || !types.includes('LocalBusiness')) fail(route, 'missing RealEstateAgent + LocalBusiness schema');
  if (/^\/services\/.+/.test(route) && !types.includes('FAQPage')) fail(route, 'service page missing FAQPage schema');
  if (route !== '/' && route !== '/404' && !PROTOTYPES.includes(route) && !types.includes('BreadcrumbList')) fail(route, 'inner page missing BreadcrumbList schema');

  // Conversion: Call + WhatsApp everywhere, canonical, copyright
  if (!html.includes('href="tel:+917499914181"')) fail(route, 'no tel: link');
  if (!/href="https:\/\/wa\.me\/917499914181\?text=/.test(html)) fail(route, 'no WhatsApp link with pre-filled text');
  if (!html.includes('class="mobile-bar"')) fail(route, 'no mobile Call | WhatsApp bar');
  if (!html.includes('© 2026 Ashiyana Real Estate. All rights reserved.')) fail(route, 'footer copyright missing');
  if (!/<link rel="canonical" href="https:\/\/www\.ashiyanarealestate\.in[^"]*"/.test(html)) fail(route, 'canonical missing');
  if (/<iframe/i.test(visible)) fail(route, 'embedded iframe (PRD: map link only)');
  if (/class="topbar/.test(visible)) fail(route, 'top info bar is back (removed on request)');
  if (/fonts\.googleapis|fonts\.gstatic/.test(html)) fail(route, 'Google Fonts call (fonts must be self-hosted)');

  for (const [re, why] of BANNED) if (re.test(visible)) fail(route, `banned content: ${why}`);

  // Forms where the PRD requires them
  const needsForm = route === '/' || route === '/contact' || route.startsWith('/services/') || route === '/projects/sanaswadi-industrial-land' ||
    ['/kothrud', '/karvenagar', '/warje', '/prabhat-road', '/bavdhan', '/erandwane'].includes(route);
  if (needsForm && !html.includes('Send enquiry')) fail(route, 'enquiry form missing');

  // Internal links
  for (const [, href] of visible.matchAll(/href="(\/[^"]*)"/g)) {
    if (href.startsWith('//')) continue;
    if (!resolves(href)) fail(route, `broken internal link ${href}`);
  }
}

// Sitemap + robots
const robots = await readFile(join(DIST, 'robots.txt'), 'utf8').catch(() => '');
if (!/Sitemap: https:\/\/www\.ashiyanarealestate\.in\/sitemap-index\.xml/.test(robots)) fail('robots.txt', 'missing sitemap line');
const sm = await readFile(join(DIST, 'sitemap-0.xml'), 'utf8').catch(() => '');
const smCount = (sm.match(/<loc>/g) || []).length;
if (smCount !== 21) fail('sitemap', `expected 21 URLs (all pages except 404), found ${smCount}`);
if (/404/.test(sm)) fail('sitemap', '404 page listed');

if (warn.length) console.log(`⚠ ${warn.length} warning(s)\n  ` + warn.slice(0, 10).join('\n  '));
if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✔ ${htmlFiles.length} pages checked: titles, descriptions, H1s, alt text, schema, links, CTAs, banned claims, sitemap, robots`);
