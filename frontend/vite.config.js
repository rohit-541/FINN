import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public origin for canonical, share and structured-data tags. On Vercel the frontend is
// static files, so __SITE_URL__ is filled in here at build time: SITE_URL, else the project's
// production domain. Off Vercel with no SITE_URL the placeholder is left for the Express server,
// which fills it in when it serves the page.
function siteUrl() {
  const raw = process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (!raw) return process.env.VERCEL ? '' : null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch { return ''; }
}

const fillSiteUrl = () => ({
  name: 'finn-site-url',
  transformIndexHtml(html) {
    const origin = siteUrl();
    return origin == null ? html : html.replaceAll('__SITE_URL__', origin);
  },
});

export default defineConfig({
  plugins: [react(), fillSiteUrl()],
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
