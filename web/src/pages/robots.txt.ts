import type { APIRoute } from 'astro';

// robots.txt points at the sitemap generated at build. Staging is additionally
// blocked by an X-Robots-Tag header in its Nginx config.
export const GET: APIRoute = ({ site }) => {
  if (import.meta.env.PUBLIC_NOINDEX === '1') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const sitemap = new URL('sitemap-index.xml', site).href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
