/* Lets the app open without internet once it has been loaded.
   Network first, so a new version is picked up whenever the phone is online. */
const CACHE = 'omr-v1';
const FILES = ['./', 'index.html', 'css/style.css', 'js/layout.js', 'js/sheet.js', 'js/scan.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
