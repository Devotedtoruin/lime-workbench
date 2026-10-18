import { createApp } from 'vue';
import App from './App.vue';
import './styles/base.css';
import './styles/glass.css';
import { initSpotlight } from './lib/spotlight.js';

// Production registers the app-shell worker. Development unregisters any old worker (including
// the pre-Vue v34 shell) so edits are never served from a stale cache.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !('__TAURI_INTERNALS__' in window)) {
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
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
