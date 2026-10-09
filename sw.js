// Service worker: makes the app work offline.
// Strategy is cache-first. On install, every app-shell file below is stored in
// a versioned cache. On each request, the cached copy is returned if there is
// one (so the app opens instantly with no network); otherwise the request goes
// to the network and a successful response is added to the cache for next time.
// Only same-origin GET requests are handled; sync calls to the server (POST,
// different origin) pass straight through untouched.
// Old caches are deleted on activate, so only the current version is kept.
//
// IMPORTANT: bump this string on every deploy that touches any app-shell file
// (index.html, style.css, app.js, manifest.json, icons/apple-touch-icon.png).
// The browser only detects a Service Worker update when sw.js's bytes change —
// if this string is left unchanged, sw.js is byte-identical after a deploy, the
// browser never notices, and users silently stay on old code forever.
const CACHE_NAME = 'second-memory-v57';

// Files pre-cached at install time: everything needed to run with no network.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Install: fill the new cache with the whole app shell, then activate right away.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' bypasses the browser's HTTP cache so a fresh install can never mix old and new files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete caches left over from earlier versions, then take control of open tabs.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache first, network as fallback (see the header comment).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => {});
        }
        return response;
      });
    })
  );
});
