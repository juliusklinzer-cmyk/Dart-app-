/* Offline-Cache für die App-Shell. Bei Änderungen CACHE hochzählen. */
var CACHE = 'dart-turnier-v28';
var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/checkout.js',
  './js/auth.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icons/icon-192.webp',
  './icons/icon-512.webp',
  './icons/icon-maskable-512.webp',
  './icons/apple-touch-icon.png',
  './icons/1860.webp',
  './fonts/anton-400.woff2',
  './fonts/barlow-condensed-600.woff2',
  './fonts/barlow-condensed-700.woff2',
  './fonts/barlow-400.woff2',
  './fonts/barlow-600.woff2',
  './fonts/barlow-700.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  /* Die API bleibt aussen vor. Würden wir sie mitcachen, käme nach dem
     Abmelden die alte Antwort von /api/me zurück und der Spielabgleich
     bekäme veraltete Daten – abgesehen davon, dass fremde Spielstände
     nichts im Offline-Cache verloren haben. */
  if (new URL(e.request.url).pathname.indexOf('/api/') === 0) return;

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
