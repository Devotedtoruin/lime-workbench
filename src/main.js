import { createApp } from 'vue';
import App from './App.vue';
import './styles/base.css';
import './styles/glass.css';
import { initSpotlight } from './lib/spotlight.js';

// Production registers the app-shell worker. Development unregisters any old worker so edits
// are never served from a stale cache.
//
// The URL is resolved relative to the document rather than as '/sw.js': the app must also work
// under a sub-path (https://user.github.io/lime-workbench/), where an absolute path would 404
// and the app would silently lose offline support.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !('__TAURI_INTERNALS__' in window)) {
  if (import.meta.env.PROD) {
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl, { scope: './' }).then(async registration => {
      // Ask the active worker to cache this document's hashed JS/CSS. Install-time precaching
      // cannot know those names, and on the first visit the browser requests them before the
      // worker controls the page.
      await navigator.serviceWorker.ready;
      const urls = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
        .map(element => new URL(element.getAttribute('src') || element.getAttribute('href'), document.baseURI).href)
        .filter(url => url.startsWith(location.origin));
      (registration.active || navigator.serviceWorker.controller)?.postMessage({ type: 'CACHE_URLS', urls });
    }).catch(() => {});
  } else {
    navigator.serviceWorker.getRegistrations?.()
      .then(list => Promise.all(list.map(registration => registration.unregister().catch(() => {}))))
      .then(() => caches?.keys?.())
      .then(keys => Promise.all((keys || []).filter(key => key.startsWith('lime-workbench-')).map(key => caches.delete(key))))
      .catch(() => {});
  }
}

createApp(App).mount('#app');
initSpotlight();
