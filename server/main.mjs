/*
 * Der ganze Server: statische Dateien der App + JSON-API, ein Prozess.
 *
 * Bewusst ein einziger Dienst statt Web- und API-Container getrennt --
 * die Kiste hat 2 GB und teilt sie sich schon mit Wirtschaftln und dem
 * Firmengolf-Staging.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.mjs';
import { sweepExpired } from './lib/session.mjs';
import { aufraeumen } from './lib/ratelimit.mjs';
import { createApi } from './api.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.dirname(SERVER_DIR); // Repo-Wurzel: index.html, css/, js/

const PORT = Number(process.env.PORT) || 3002;
const HOST = process.env.HOST || '0.0.0.0';
const DB_DATEI = process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db');

const config = {
  inviteHash: process.env.DARTS_INVITE_HASH || '',
  // Secure-Cookies gehen nur ueber HTTPS. Lokal (http://localhost) muessen sie
  // aus bleiben, sonst kommt die Session nie beim Browser an.
  secureCookies: process.env.DARTS_SECURE_COOKIES === '1' || process.env.NODE_ENV === 'production',
  // Nur hinter Caddy dem X-Forwarded-For trauen -- sonst haengt sich jeder
  // einen erfundenen Header ans Rate-Limit vorbei.
  trustProxy: process.env.DARTS_TRUST_PROXY === '1' || process.env.NODE_ENV === 'production'
};

if (!config.inviteHash) {
  console.warn('WARNUNG: DARTS_INVITE_HASH ist nicht gesetzt -- niemand kann sich registrieren.');
  console.warn('         Code erzeugen mit: npm run invite');
}

const db = openDb(DB_DATEI);
const handleApi = createApi(db, config);

/* ---------- statische Dateien ---------- */

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

/* Was ausgeliefert werden darf. Alles andere im Repo (server/, tests/, .git)
   geht niemanden etwas an. */
const ERLAUBT = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'dart-turnier.html']);
const ERLAUBTE_ORDNER = new Set(['css', 'js', 'icons']);

function statischerPfad(pfad) {
  const rein = decodeURIComponent(pfad).replace(/\/+$/, '') || '/index.html';
  const rel = rein === '/index.html' || rein === '' ? 'index.html' : rein.replace(/^\//, '');
  // Traversal ausschliessen, bevor irgendetwas am Dateisystem passiert.
  if (rel.indexOf('\0') >= 0 || rel.split('/').indexOf('..') >= 0) return null;

  const teile = rel.split('/');
  if (teile.length === 1 && ERLAUBT.has(teile[0])) return path.join(APP_DIR, teile[0]);
  if (teile.length === 2 && ERLAUBTE_ORDNER.has(teile[0])) return path.join(APP_DIR, teile[0], teile[1]);
  return null;
}

function liefereDatei(req, res, datei) {
  let stat;
  try {
    stat = fs.statSync(datei);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }

  // Schwacher ETag aus Groesse + Aenderungszeit: reicht, um beim Nachladen
  // nicht jedes Mal 175 KB durch die Leitung zu schicken.
  const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }

  res.writeHead(200, {
    'Content-Type': TYPEN[path.extname(datei).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    // Die App aktualisiert sich ueber den Service Worker. Ein langer Cache
    // hier wuerde Updates verschlucken.
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(datei).pipe(res);
}

/* ---------- Server ---------- */

const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(function (e) {
      console.error('Unerwarteter Fehler:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"fehler":"Auf dem Server ist etwas schiefgegangen."}');
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }

  const datei = statischerPfad(url.pathname);
  if (!datei) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
  liefereDatei(req, res, datei);
});

/* Stuendlich abgelaufene Sessions und tote Rate-Limit-Eintraege wegraeumen. */
const putzen = setInterval(function () {
  try {
    sweepExpired(db);
    aufraeumen();
  } catch (e) {
    console.error('Aufraeumen fehlgeschlagen:', e);
  }
}, 3600e3);
putzen.unref();

server.listen(PORT, HOST, function () {
  console.log('Dart-Turnier laeuft auf http://' + HOST + ':' + PORT);
  console.log('Datenbank: ' + DB_DATEI);
});

/* Sauber beenden, damit SQLite den WAL-Stand schreibt. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, function () {
    server.close(function () {
      try {
        db.close();
      } catch (e) {
        /* egal, wir gehen sowieso */
      }
      process.exit(0);
    });
    // Falls Verbindungen haengen: nach 5 s trotzdem gehen.
    setTimeout(function () {
      process.exit(0);
    }, 5000).unref();
  });
}
