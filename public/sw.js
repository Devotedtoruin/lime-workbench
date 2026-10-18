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

const CACHE_VERSION = 'v42';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `lime-workbench-${encodeURIComponent(SCOPE.href)}-`;
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const HOME = new URL('./index.html', SCOPE).href;

// Shell files, resolved against the SW scope so a sub-path deploy (e.g. /lime-workbench/)
// caches the right URLs.
const SHELL = ['./', './index.html', './manifest.webmanifest'].map(p => new URL(p, SCOPE).href);

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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Leave weather, AI and any other third-party request entirely alone.
  if (url.origin !== SCOPE.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(HOME, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(HOME) || await caches.match(SCOPE.href);
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});
