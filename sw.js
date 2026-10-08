/* Offline-Cache für die App-Shell. Bei Änderungen CACHE hochzählen. */
var CACHE = 'dart-turnier-v112';
var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/checkout.js',
  './js/sound.js',
  './js/auth.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icons/icon-192.webp',
  './icons/sehnsucht.webp',
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
  e.waitUntil(caches.open(CACHE).then(function (c) {
    /* cache: 'reload' – am Browser-Cache vorbei direkt beim Server holen,
       sonst landet im neuen Cache womöglich noch die alte Fassung. */
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

/*
 * Neue Version: alte Caches weg, sofort übernehmen – und den offenen Seiten
 * Bescheid sagen. Die Seite erfährt das auf zwei Wegen:
 *  1. navigator.serviceWorker 'controllerchange' (durch clients.claim()),
 *  2. eine Nachricht { typ: 'sw-neue-version', cache: 'dart-turnier-vNN' }
 *     an jedes offene Fenster – aber NUR bei einem echten Update (es gab
 *     vorher schon einen älteren Cache), nicht bei der Erstinstallation.
 * Die Seite zeigt dann „Neue Version – neu laden".
 */
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    var alt = keys.filter(function (k) { return k !== CACHE && k.indexOf('dart-turnier-') === 0; });
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }))
      .then(function () { return self.clients.claim(); })
      .then(function () {
        if (!alt.length) return;
        return self.clients.matchAll({ type: 'window' }).then(function (fenster) {
          fenster.forEach(function (f) { f.postMessage({ typ: 'sw-neue-version', cache: CACHE }); });
        });
      });
  }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  /* Die API bleibt aussen vor. Würden wir sie mitcachen, käme nach dem
     Abmelden die alte Antwort von /api/me zurück und der Spielabgleich
     bekäme veraltete Daten – abgesehen davon, dass fremde Spielstände
     nichts im Offline-Cache verloren haben. Der Live-Strom
     (/api/live/:id/strom, text/event-stream) läuft ebenfalls direkt. */
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  var pfad = url.pathname;
  if (pfad.indexOf('/api/') === 0) return;
  if ((e.request.headers.get('accept') || '').indexOf('text/event-stream') >= 0) return;
  /* Die CV-Modelle (mehrere MB, nur fuers iPhone als Linse) gehoeren nicht
     in den Offline-Cache jedes iPads – und die Erkennung selbst auch nicht. */
  if (pfad.indexOf('/modell/') === 0 || pfad.indexOf('linse-cv.js') >= 0) return;

  var navigation = e.request.mode === 'navigate';
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        /* Nur einwandfreie, eigene Antworten merken. Ein 404 oder 500 im
           Cache bliebe sonst dauerhaft kleben – auch nachdem der Server
           längst wieder richtig antwortet. */
        if (res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        /* Offline: Seitenaufrufe bekommen die App-Shell. Ein Skript, ein
           Stylesheet oder ein Bild bekommt dagegen KEIN index.html – das
           wäre für den Browser kaputter Code statt eines klaren Fehlers. */
        if (navigation) return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
