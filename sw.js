// Focus service worker — push delivery only. The app itself has no
// offline/caching needs beyond what GitHub Pages already serves.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* malformed payload — show generic */ }

  const title = data.title || 'Focus';
  const body = data.body || '';
  // Groups occurrences of the same task under one notification "slot" —
  // mirrors nidFor()'s taskId*100+slot scheme in reminders.js so a task
  // firing repeatedly doesn't pile up separate notifications.
  const tag = 'focus-' + Math.floor((data.nid ?? Date.now()) / 100);

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    tag,
  }));
});

// No inline ✓ Done / Snooze actions here — a service worker can't reach
// localStorage, so acting directly on a task would need IndexedDB-backed
// storage (a bigger, separate change). Tapping through opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('.');
    })
  );
});
