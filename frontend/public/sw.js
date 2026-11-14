// FINN service worker. Three rules:
//   page      -> network first, cached shell when offline
//   /assets/* -> cache first (Vite fingerprints these, so a cached copy is never stale)
//   GET /api  -> network first, last good answer when offline, so the brief still opens on a train
const VERSION = 'finn-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// clone before anything else: the page starts reading the body as soon as this returns,
// and a body that has been read can no longer be cloned
const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).then((r) => put('/', r)).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => put(request, r))));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    // the analysis endpoint reports a running job; a cached "running" would never finish
    if (url.pathname.endsWith('/analysis')) return;
    e.respondWith(fetch(request).then((r) => put(request, r)).catch(() => caches.match(request).then((hit) => hit || Response.error())));
  }
});
