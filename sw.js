const CACHE = 'grow27-v1.47';

// Core files to precache for offline use
const PRECACHE = [
  '/grow27/',
  '/grow27/manifest.json',
  '/grow27/version.json',
  '/grow27/css/style.css',
  '/grow27/css/mobile.css',
  '/grow27/js/markets.js',
  '/grow27/js/app.js',
  '/grow27/icons/icon-32.png',
  '/grow27/icons/icon-192.png',
  '/grow27/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Lazily purge stale caches on every fetch — catches leftovers that the
// activate event missed (e.g. when a tab stayed open across SW updates).
function purgeOldCaches() {
  caches.keys().then(keys =>
    keys.filter(k => k !== CACHE).forEach(k => caches.delete(k))
  );
}

// Fetch strategy:
// - HTML pages: network first, fall back to cache (so refreshes get fresh data)
// - External APIs (prices, weather): network only, no caching (always want live data)
// - Static assets (JS, CSS, icons): cache first, fall back to network
self.addEventListener('fetch', e => {
  purgeOldCaches();
  const url = new URL(e.request.url);

  // Never cache API calls — always go to network
  const isApi =
    url.hostname.includes('stooq.com') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('overpass-api.de') ||
    url.hostname.includes('nominatim.openstreetmap.org');

  if (isApi) {
    e.respondWith(fetch(e.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' }})));
    return;
  }

  // Data files (prices JSON) — network first so updates show immediately
  const isData = url.pathname.includes('/data/prices/');
  if (isData) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML pages — network first
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else — cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});


































