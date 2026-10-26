// Service worker — offline app shell.
//
// Strategy:
//   - On install, precache the shell (HTML, manifest, icons) so a cold offline launch works.
//     The hashed JS/CSS are picked up on first load and cached then; precaching them here would
//     require a build-time manifest, which this project does not generate.
//   - Navigations: network-first, so a deploy is picked up on the next load. Falling back to the
//     cached shell keeps the app usable offline.
//   - Same-origin assets: cache-first (they are content-hashed, so a stale copy is impossible).
//   - Cross-origin (weather / AI): never intercepted. Those requests must fail loudly rather
//     than be served from a cache that pretends the service is reachable.
//
// Bump CACHE_VERSION on every release. Bumping is what drops the previous cache; without it
// users keep whatever shell they installed first.

const CACHE_VERSION = 'v50';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `lime-workbench-${encodeURIComponent(SCOPE.href)}-`;
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const HOME = new URL('./index.html', SCOPE).href;

// Shell files, resolved against the SW scope so a sub-path deploy (e.g. /lime-workbench/)
// caches the right URLs. `./index.html` is listed first because the navigation fallback reads
// HOME from it: the old order cached `./` first, and on hosts that 301 `./` → `./` (or return a
// bare directory listing) the navigation fallback then missed and offline launches showed
// Response.error(). The manifest is optional and must never block the shell.
const SHELL = ['./index.html', './', './manifest.webmanifest'].map(p => new URL(p, SCOPE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll rejects the whole batch if one entry 404s; add individually so a missing
    // optional file cannot block the install.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// The hashed JS/CSS are not known at install time. Right after activation the page sends the
// current document's own script/stylesheet URLs once, which makes the very first visit
// offline-capable instead of requiring a second controlled load.
self.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return;
  const urls = [...new Set(data.urls)]
    .map(value => {
      try {
        const url = new URL(value, SCOPE);
        return url.origin === SCOPE.origin ? url.href : null;
      } catch { return null; }
    })
    .filter(Boolean)
    .slice(0, 40);
  if (!urls.length) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(urls.map(url => cache.add(url).catch(() => {})));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Leave weather, AI and any other third-party request entirely alone.
  if (url.origin !== SCOPE.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        // A 404 from the host (e.g. an unknown path) must not replace the good shell.
        if (fresh.ok && fresh.type === 'basic') await cache.put(HOME, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await cache.match(HOME) || await cache.match(SCOPE.href);
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      // Opaque (no-cors) responses have status 0 and useless bodies; caching them poisons the
      // cache with entries that can never satisfy a later request.
      if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      return cache.match(request).then(again => again || Response.error());
    }
  })());
});
