/* Triple service worker.
 * NETWORK-FIRST by design: every load fetches fresh from the network, so a new
 * index.html paste-deploy shows up immediately with no stale-cache trap. The
 * cache is only a fallback for when the device is offline. Cross-origin requests
 * (Supabase, Google Fonts, jsDelivr CDN) are not intercepted at all.
 * Bump CACHE_VERSION any time you want to wipe old offline copies. */
const CACHE_VERSION = 'triple-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Only manage same-origin GETs; let everything else (API, fonts, CDN) pass through.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Stash a copy for offline use.
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      // Offline: serve the cached copy if we have one.
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const root = await caches.match('/');
        if (root) return root;
      }
      throw err;
    }
  })());
});

// ── Push notifications ────────────────────────────────────
// A push payload is JSON: { title, body, url, badge?, tag? }. We must show a
// notification for every push (userVisibleOnly), and we set the app-icon badge.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { title: 'Triple', body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'Triple';
  const options = {
    body: payload.body || '',
    icon: '/icon/icon-192.png',
    badge: '/icon/favicon-48.png',
    data: { url: payload.url || '/' },
    tag: payload.tag || undefined,
    renotify: !!payload.tag
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    try {
      if ('setAppBadge' in self.navigator) {
        if (typeof payload.badge === 'number') await self.navigator.setAppBadge(payload.badge);
        else await self.navigator.setAppBadge();
      }
    } catch (_) {}
  })());
});

// Focus an existing Triple window (navigating it to the target) or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    // Cross-origin destinations (portal deep links) can't reuse an existing
    // Triple window — open them directly in a new one.
    if (/^https?:\/\//i.test(target)) {
      if (self.clients.openWindow) await self.clients.openWindow(target);
      return;
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { await c.navigate(self.location.origin + target); } catch (_) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
