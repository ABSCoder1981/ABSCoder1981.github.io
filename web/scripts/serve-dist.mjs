// Local stand-in for the production Nginx config, for testing the built site:
//   clean URLs (try_files $uri $uri.html $uri/index.html), 404.html with status 404,
//   long cache on /_astro/*, and /api/* proxied to the enquiry API on 127.0.0.1:8787.
// Usage: node scripts/serve-dist.mjs [port]   (default 4322)
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.argv[2] || 4322);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const up = request({ host: '127.0.0.1', port: 8787, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"ok":false,"error":"api_unreachable"}');
    });
    return req.pipe(up);
  }
  // Old Shopify URLs → 301, as in Nginx
  const redirects = { '/pages/contact': '/contact', '/pages/sanaswadi-landing-page': '/projects/sanaswadi-industrial-land', '/blogs/news': '/' };
  if (redirects[url.pathname]) {
    res.writeHead(301, { location: redirects[url.pathname] });
    return res.end();
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const base = join(ROOT, rel);
  if (!base.startsWith(ROOT.replace(/[/\\]$/, ''))) return res.writeHead(400).end();
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    if (await isFile(candidate)) {
      const headers = { 'content-type': TYPES[extname(candidate)] || 'application/octet-stream' };
      if (url.pathname.startsWith('/_astro/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
      let body = await readFile(candidate);
      // gzip text like Nginx does, so Lighthouse numbers are realistic
      if (/text|javascript|json|xml|svg|manifest/.test(headers['content-type']) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        body = gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(200, headers);
      return res.end(body);
    }
  }
  res.writeHead(404, { 'content-type': TYPES['.html'] });
  res.end(await readFile(join(ROOT, '404.html')));
}).listen(PORT, () => console.log(`dist served at http://localhost:${PORT}`));
