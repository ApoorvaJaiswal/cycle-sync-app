// Bumped to v2 to force the old cache (which may hold a stale config.js with
// a placeholder client ID) to be discarded on next load.
const CACHE_NAME = 'cycle-sync-v2';

// config.js is deliberately NOT in here -- it holds the Google client ID and
// must always come fresh from the network so a corrected ID is never masked
// by a cached placeholder.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Google's auth script or Calendar API calls -- those
  // must always hit the network directly, never served from cache, or
  // sign-in and sync would silently break.
  if (url.origin !== self.location.origin) {
    return;
  }

  // config.js is network-first: always try to fetch the latest, only fall
  // back to a cached copy if the network is unavailable (offline). This
  // ensures a corrected Google client ID takes effect immediately on reload
  // instead of being overridden by a stale cached version.
  if (url.pathname.endsWith('/config.js') || url.pathname === '/config.js') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else in the shell is cache-first, so the app opens even offline.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
      );
    })
  );
});
