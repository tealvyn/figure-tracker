const CACHE_VERSION = 'figure-tracker-v25';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/api.js',
  './js/main.js',
  './js/i18n.js',
  './js/state.js',
  './js/ui.js',
  './js/utils.js',
  './icons/favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-48.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

const OPTIONAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await Promise.all(OPTIONAL_ASSETS.map(url => cache.add(url).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return caches.match('./index.html');
      }
    })());
    return;
  }

  const isLocalAsset = url.origin === location.origin;
  const isFreshFirstAsset = isLocalAsset && /\.(?:html?|css|js)$/i.test(url.pathname);

  if (isFreshFirstAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      } catch {
        return caches.match(request);
      }
    })());
    return;
  }

  if (isLocalAsset || OPTIONAL_ASSETS.includes(request.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
      return response;
    })());
  }
});








