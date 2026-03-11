/**
 * Service Worker for Campus App PWA
 * 提供離線支援、快取策略、推播通知
 */

const CACHE_VERSION = "v1.0.0";
const STATIC_CACHE = `campus-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `campus-dynamic-${CACHE_VERSION}`;
const API_CACHE = `campus-api-${CACHE_VERSION}`;

// Static assets to cache immediately
const STATIC_ASSETS = [
  "/",
  "/announcements",
  "/cafeteria",
  "/map",
  "/timetable",
  "/grades",
  "/library",
  "/bus",
  "/groups",
  "/login",
  "/offline.html",
  "/manifest.json",
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("[SW] Installing service worker...");
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker...");
  
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key.startsWith("campus-") && 
                           key !== STATIC_CACHE && 
                           key !== DYNAMIC_CACHE &&
                           key !== API_CACHE)
            .map((key) => {
              console.log("[SW] Deleting old cache:", key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - implement caching strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests
  if (url.origin !== location.origin) return;

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets - Cache first, fallback to network
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Pages - Stale while revalidate
  event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
});

// Cache first strategy
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return getOfflinePage();
  }
}

// Network first strategy
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response(JSON.stringify({ error: "Offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Stale while revalidate strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  
  return cached || networkPromise || getOfflinePage();
}

// Check if path is a static asset
function isStaticAsset(pathname) {
  const staticExtensions = [".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2"];
  return staticExtensions.some((ext) => pathname.endsWith(ext));
}

// Get offline page
async function getOfflinePage() {
  const cache = await caches.open(STATIC_CACHE);
  return cache.match("/offline.html") || new Response("Offline", { status: 503 });
}

// Push notification event
self.addEventListener("push", (event) => {
  console.log("[SW] Push notification received");
  
  let data = {
    title: "校園助手",
    body: "您有新的通知",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: "campus-notification",
  };
  
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
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: data.data,
      actions: data.actions || [],
      vibrate: [100, 50, 100],
      requireInteraction: data.requireInteraction || false,
    })
  );
});

// Notification click event
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked");
  
  event.notification.close();
  
  const data = event.notification.data;
  let url = "/";
  
  if (data) {
    switch (data.type) {
      case "announcement":
        url = `/announcements/${data.id}`;
        break;
      case "event":
        url = `/clubs?eventId=${data.id}`;
        break;
      case "grade":
        url = "/grades";
        break;
      case "message":
        url = `/groups?messageId=${data.id}`;
        break;
      default:
        url = data.url || "/";
    }
  }
  
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already an open window
        for (const client of windowClients) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        // Open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Background sync event
self.addEventListener("sync", (event) => {
  console.log("[SW] Background sync:", event.tag);
  
  if (event.tag === "sync-offline-data") {
    event.waitUntil(syncOfflineData());
  }
});

// Sync offline data
async function syncOfflineData() {
  // Implementation would sync any offline-queued data
  console.log("[SW] Syncing offline data...");
}

// Message event - for communication with main thread
self.addEventListener("message", (event) => {
  console.log("[SW] Message received:", event.data);
  
  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data.type === "CACHE_URLS") {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});
