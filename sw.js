/* צלחת — service worker. The app shell and the food database are cached so
   logging works with no signal. deploy.py stamps 5286704a with a content hash,
   so every deploy that changes a file gets a fresh cache. On localhost it
   goes network-first so edits show up on reload. */
const VERSION = '5286704a';
const CACHE = 'mom-' + VERSION;
const ASSETS = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  ...['app.css', 'config.js', 'db.js', 'search.js', 'calc.js', 'parse.js', 'ai.js', 'cloud.js', 'app.js', 'screens.js']
    .map((f) => f + '?v=' + VERSION)];
const OPTIONAL = ['foods.json?v=' + VERSION, 'seed.json?v=' + VERSION];
const DEV = self.location.hostname === 'localhost';   // 127.0.0.1 = test the real caching

/* Every install fetch bypasses the browser's HTTP cache (and the page gets a
   unique URL), otherwise a new version can store the previous index.html
   and the phone stays on the old app until the next deploy. */
async function fresh(cache, url, keys) {
  const resp = await fetch(new Request(url, { cache: 'reload' }));
  if (!resp.ok) throw new Error(url + ' ' + resp.status);
  const list = keys || [url];
  for (let i = 0; i < list.length; i++) await cache.put(list[i], i === list.length - 1 ? resp : resp.clone());
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await fresh(c, 'index.html?v=' + VERSION, ['index.html', './']);
    await Promise.all(ASSETS.map((u) => fresh(c, u)));
    await Promise.all(OPTIONAL.map((u) => fresh(c, u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('mom-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;   // Open Food Facts, the Worker: always straight to the network
  }
  if (DEV) { e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))); return; }
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
    if (resp.ok) { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return resp;
  })));
});

async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then((resp) => { if (resp.ok || resp.type === 'opaque') c.put(req, resp.clone()); return resp; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'צלחת', {
    body: data.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he',
    tag: data.tag || 'tzalahat', renotify: false, data: { url: data.url || './#/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url ? e.notification.data.url : './#/', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate(target); }
    }
    return self.clients.openWindow(target);
  })());
});
