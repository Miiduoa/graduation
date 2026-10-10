const STATIC_CACHE = 'campus-static-v2';
const PUBLIC_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('campus-') && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only public assets enter persistent storage. Account pages and API data stay on the network.
  if (PUBLIC_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches
        .open(STATIC_CACHE)
        .then(async (cache) => (await cache.match(request)) || fetch(request)),
    );
  } else if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (
          (await cache.match('/offline.html')) ||
          new Response('目前沒有網路連線。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Campus One', body: '你有新的通知' };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      tag: data.tag || 'campus-notification',
      data: data.data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let path = '/';
  switch (data.type) {
    case 'announcement':
      path = `/announcements/${encodeURIComponent(data.id)}`;
      break;
    case 'event':
      path = `/clubs?eventId=${encodeURIComponent(data.id)}`;
      break;
    case 'grade':
      path = '/grades';
      break;
    case 'message':
      path = `/groups?messageId=${encodeURIComponent(data.id)}`;
      break;
    default:
      path = data.url || '/';
  }
  let destination = new URL('/', self.location.origin);
  try {
    const candidate = new URL(path, self.location.origin);
    if (candidate.origin === self.location.origin) destination = candidate;
  } catch {
    /* Open the home page when the notification has an invalid destination. */
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url === destination.href);
      return existing ? existing.focus() : self.clients.openWindow(destination.href);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
