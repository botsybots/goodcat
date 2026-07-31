/* Service Worker for Good Cat -- caches the app shell so it works offline
   once loaded, and still handles push notifications as before. */
const CACHE_NAME = 'good-cat-v1';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './date-utils.js',
  './schedule-utils.js',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(()=>{})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the app shell (instant offline load), falling back to the
// network and refreshing the cache in the background so updates still land.
// Anything to /api/ always goes straight to the network -- that data is
// live, never something to serve stale from cache.
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if(res && res.ok && res.type === 'basic'){
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', event => {
  let payload = { title: 'Reminder', body: 'You have a reminder' };
  try { payload = event.data.json(); } catch(e) { if(event.data) payload.body = event.data.text(); }
  const title = payload.title || 'Reminder';
  const options = { body: payload.body || '', data: payload, tag: payload.tag || 'accountability-reminder' };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    for(const client of clientList){ if(client.url && 'focus' in client) return client.focus(); }
    if(self.clients.openWindow) return self.clients.openWindow(self.registration.scope);
  }));
});
