/* Service Worker for Accountability App */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
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
    if(self.clients.openWindow) return self.clients.openWindow('/');
  }));
});
