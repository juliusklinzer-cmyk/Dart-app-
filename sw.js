/* Offline-Cache für die App-Shell. Bei Änderungen CACHE hochzählen.
   Nur die App (index.html samt Skripten, Schriften, Icons) liegt vorab im
   Cache – sie soll in der Bar auch ohne Netz starten. Die öffentliche
   Webseite (webseite.html, js/webseite.js, css/webseite.css) und der
   Live-Ticker (live.html, js/live.js, css/live.css) gehören nicht dazu:
   beide leben vom Server (aktuelle Ergebnisse, Event-Stream) und nützen
   offline nichts; der Service Worker wird ohnehin nur von der App
   registriert. */
var CACHE = 'dart-turnier-v177';
var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/liga-sdm.js',
  './js/liga-daten.js',
  './js/app.js',
  './js/checkout.js',
  './js/checkout-engine.js',
  './js/checkout-worker.js',
  './js/sound.js',
  './js/qr.js',
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

/* Push-Mitteilungen vom Server (server/lib/push.mjs): { titel, text, url,
   tag }. tag ist Thema plus Hash des Schluessels (server/lib/mitteilungen.mjs):
   dieselbe Mitteilung ersetzt sich, zwei verschiedene zum selben Thema
   (zwei Kassenbuchungen) bleiben beide stehen. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titel: 'Blink 180', text: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Blink 180', {
    body: d.text || '', icon: './icons/icon-192.webp', badge: './icons/icon-192.webp',
    tag: d.tag || undefined, data: { url: d.url || './' }
  }));
});
/* Ein Tipp auf die Mitteilung soll zur genannten Adresse fuehren - nicht
   nur irgendein offenes Fenster nach vorn holen (dann blieb der Live-Ticker
   zu, sobald die App im Hintergrund offen war). Reihenfolge: ein Fenster,
   das die Adresse schon zeigt (ohne #-Teil verglichen), wird fokussiert und
   bei anderem #-Teil dorthin bewegt; sonst wird ein offenes Fenster auf die
   Adresse geschickt (WindowClient.navigate), und erst ohne Fenster oder
   ohne navigate ein neues geoeffnet. */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var ziel = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  var ohneHash = function (u) { return String(u || '').split('#')[0]; };
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (fenster) {
    var passend = null, irgendeins = null;
    for (var i = 0; i < fenster.length; i++) {
      if (!('focus' in fenster[i])) continue;
      if (!irgendeins) irgendeins = fenster[i];
      if (!passend && ohneHash(fenster[i].url) === ohneHash(ziel)) passend = fenster[i];
    }
    var f = passend || irgendeins;
    if (!f) return self.clients.openWindow(ziel);
    return f.focus().then(function (f2) {
      f2 = f2 || f;
      if (f2.url === ziel) return f2;
      if ('navigate' in f2) return f2.navigate(ziel).catch(function () { return self.clients.openWindow(ziel); });
      return self.clients.openWindow(ziel);
    });
  }));
});
