// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

const SITE = process.env.SITE_URL || 'https://www.ashiyanarealestate.in';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Clean URLs that match the PRD sitemap: /kothrud, /services/buy (no trailing slash).
  // Nginx serves them with `try_files $uri $uri.html`.
  trailingSlash: 'never',
  devToolbar: { enabled: false },
  build: {
    format: 'file',
    // Inline all CSS (~5 KB gzipped): removes the render-blocking request, which is most of mobile LCP
    inlineStylesheets: 'always',
  },
  integrations: [
    react(),
    sitemap({
      // 404 and the unapproved landing prototype stay out of the sitemap
      filter: (page) => !page.includes('/404') && !page.endsWith('/landing'),
    }),
  ],
  image: {
    responsiveStyles: true,
  },
  vite: {
    server: {
      // In dev, forward the enquiry form to the local API (api/ on port 8787).
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    },
  },
});
