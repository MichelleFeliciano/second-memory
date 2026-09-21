// IMPORTANT: bump this string on every deploy that touches any app-shell file
// (index.html, style.css, app.js, manifest.json, icons/apple-touch-icon.png).
// The browser only detects a Service Worker update when sw.js's bytes change —
// if this string is left unchanged, sw.js is byte-identical after a deploy, the
// browser never notices, and users silently stay on old code forever.
const CACHE_NAME = 'second-memory-v3';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)).catch(() => {});
        return response;
      });
    })
  );
});
