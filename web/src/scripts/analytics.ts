/**
 * GA4 with three conversion events: whatsapp_click, call_click, form_submit.
 * Loads only when PUBLIC_GA4_ID is set at build time (rendered as <meta name="ga4-id">),
 * and only after the page is idle, so it never competes with the first paint.
 */
type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: Gtag;
  }
}

const id = document.querySelector<HTMLMetaElement>('meta[name="ga4-id"]')?.content;

if (id) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);

  const load = () => {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 1500);
}

export function track(event: string, params: Record<string, unknown> = {}) {
  window.gtag?.('event', event, { page_path: location.pathname, ...params });
}

document.addEventListener(
  'click',
  (e) => {
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const location_ = a.dataset.cta || 'inline';
    if (href.startsWith('tel:')) track('call_click', { cta_location: location_ });
    else if (href.includes('wa.me/')) track('whatsapp_click', { cta_location: location_ });
  },
  { capture: true },
);

window.addEventListener('ashiyana:lead', (e) => {
  const detail = (e as CustomEvent).detail || {};
  track('form_submit', detail);
});
