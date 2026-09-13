const CACHE = 'tme-aquarium-v1.0.1-upgrade-2';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=384eca1a9632',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/project-mark.svg',
  './src/app.js?v=1.0.1-upgrade-2',
  './src/charts.js?v=1.0.1-upgrade-2',
  './src/evidence.js?v=1.0.1-upgrade-2',
  './src/renderer.js?v=1.0.1-upgrade-2',
  './src/rng.js?v=1.0.1-upgrade-2',
  './src/scenarios.js?v=1.0.1-upgrade-2',
  './src/simulation.js?v=1.0.1-upgrade-2',
  './src/simulation.worker.js?v=1.0.1-upgrade-2',
  './src/state.js?v=1.0.1-upgrade-2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    }),
  );
});
