#!/usr/bin/env node
/*
 * Autodarts-Bruecke fuer Blink 180 (Test, nur fuer Julius' Rechner).
 *
 * Liest den lokalen Board Manager von Autodarts (http://127.0.0.1:3180/api/state)
 * in kurzem Takt und gibt jeden erkannten Dart SOFORT als Ereignis weiter -
 * nicht erst die ganze Aufnahme nach dem Darts-Ziehen. Die App im Browser
 * (https://darts.wirtschaftln.de) hoert per EventSource auf
 * http://127.0.0.1:3190/ereignisse mit und bucht jeden Dart wie einen Tipp.
 *
 * Warum eine Bruecke und nicht direkt aus der App: der Board Manager sendet
 * keine CORS-Kopfzeilen, eine Webseite darf ihn also nicht lesen. Die Bruecke
 * ist dieselbe Maschine, antwortet mit CORS fuer unsere Seite und glaettet die
 * zwei bekannten Formate von /api/state.
 *
 * Bestands-Code: das Auslesen der Wuerfe (normalizeThrow, parseLabel,
 * isPulling) ist uebernommen aus "autodarts-dartcounter-bridge" von nixuuu,
 * MIT-Lizenz, Copyright (c) 2026 nixuuu,
 * https://github.com/nixuuu/autodarts-dartcounter-bridge (Version 3.6.2).
 * Der Hinweis gehoert zu jeder Weitergabe dieser Datei.
 *
 * Keine Abhaengigkeiten, Node >= 18:
 *   node bruecke.mjs                       Board Manager auf diesem Rechner
 *   node bruecke.mjs --quelle http://192.168.1.50:3180   anderer Rechner/Pi
 *   node bruecke.mjs --demo                ohne Autodarts: Darts tippen (T20, D16, 25, BULL, M, x = ziehen)
 *   node bruecke.mjs --port 3190 --takt 80
 *
 * Ereignisse (text/event-stream, data = JSON):
 *   hallo    { status, darts:[...], quelle }            beim Verbinden
 *   dart     { seq, aufnahme, nr, m, n, label }        ein neuer Dart (nr 1..3)
 *   korrektur{ seq, aufnahme, nr, m, n, label }        Autodarts hat einen Dart nachtraeglich geaendert
 *   entfernt { seq, aufnahme, nr, label }              Autodarts hat einen Dart (Fehlalarm) zurueckgenommen
 *   ziehen   { seq, aufnahme, anzahl }                  Darts werden gezogen (Aufnahme vorbei)
 *   status   { verbunden, board, fehler }               Verbindung/Board-Zustand hat sich geaendert
 */
import http from 'node:http';
import readline from 'node:readline';

const VERSION = '1.0.0';

/* ---------- Argumente ---------- */
function arg(name, vorgabe) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return vorgabe;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const QUELLE = String(arg('quelle', process.env.AD_QUELLE || 'http://127.0.0.1:3180')).replace(/\/+$/, '');
const PORT = Number(arg('port', process.env.AD_PORT || 3190));
const TAKT = Math.max(40, Number(arg('takt', 80)) || 80);
const DEMO = !!arg('demo', false);
const LEISE = !!arg('leise', false);
/* Wer die Ereignisse lesen darf: unsere Seite und lokale Entwicklung. */
const HERKUNFT = new Set(String(arg('herkunft', 'https://darts.wirtschaftln.de,http://localhost:8080,http://127.0.0.1:8080,http://localhost:3002,http://127.0.0.1:3002'))
  .split(',').map((s) => s.trim()).filter(Boolean));

const log = (...a) => { if (!LEISE) console.log(new Date().toLocaleTimeString('de-DE'), ...a); };

/* ================= Uebernommen (MIT, nixuuu) ================= */
function toNum(v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && isFinite(v) ? v : null;
}
export function parseLabel(lbl) {
  const s = String(lbl == null ? '' : lbl).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/^(M\d*|MISS|OUT|OUTSIDE|-)$/.test(s)) return { number: toNum(s.slice(1)) || null, multiplier: 0 };
  if (['BULL', 'DBULL', 'D-BULL', 'DB', 'D25', '50', 'BULLSEYE', 'INNER BULL'].includes(s)) return { number: 25, multiplier: 2 };
  if (['25', 'SB', 'S25', 'SBULL', 'OUTER BULL', 'OUTERBULL'].includes(s)) return { number: 25, multiplier: 1 };
  let m = s.match(/^([SDT])(\d{1,2})$/);
  if (m) {
    const n = parseInt(m[2], 10), mult = { S: 1, D: 2, T: 3 }[m[1]];
    if ((n >= 1 && n <= 20) || (n === 25 && mult < 3)) return { number: n, multiplier: mult };
    return null;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) return { number: n, multiplier: 1 };
  }
  return null;
}
function makeLabel(number, mult) {
  if (mult === 0) return 'M';
  if (number === 25) return mult === 2 ? 'BULL' : '25';
  return ['', 'S', 'D', 'T'][mult] + number;
}
/* Ein Wurf aus /api/state (altes verschachteltes oder neues flaches Format). */
export function normalizeThrow(t) {
  if (t == null) return null;
  if (typeof t === 'string') t = { segmentName: t };
  if (typeof t !== 'object') return null;
  const seg = t.segment && typeof t.segment === 'object' ? t.segment : {};
  const name = [seg.name, t.segmentName, t.name, typeof t.segment === 'string' ? t.segment : undefined]
    .find((v) => typeof v === 'string' && v.trim() !== '');
  let number = toNum(seg.number != null ? seg.number : t.segmentNumber != null ? t.segmentNumber : t.number);
  let mult = toNum(seg.multiplier != null ? seg.multiplier : t.multiplier != null ? t.multiplier : t.segmentMultiplier);
  const bed = String(seg.bed != null ? seg.bed : t.bed != null ? t.bed : t.segmentBed != null ? t.segmentBed : '');
  const parsed = parseLabel(name);
  if (mult === null && parsed) mult = parsed.multiplier;
  if (number === null && parsed) number = parsed.number;
  if (/outside|miss/i.test(bed) || number === 0) mult = 0;
  if (number === 50) { number = 25; mult = 2; }
  if (mult === null || (mult > 0 && number === null)) return { label: name ? String(name) : '?', m: null, n: number, ok: false };
  const valid = mult === 0 || (mult >= 1 && mult <= 3 && ((number >= 1 && number <= 20) || (number === 25 && mult <= 2)));
  return { label: makeLabel(number, mult), m: mult === 0 ? 1 : mult, n: mult === 0 ? 0 : number, ok: valid };
}
function keyOf(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, ''); }
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw.throws) ? raw.throws : Array.isArray(raw.darts) ? raw.darts : null;
  const numThrows = toNum(raw.numThrows);
  return {
    darts: list ? list.map(normalizeThrow).filter(Boolean) : [],
    throwsMissing: !list && numThrows !== null && numThrows > 0,
    status: raw.status == null ? '' : String(raw.status),
    statusKey: keyOf(raw.status),
    eventKey: keyOf(raw.event),
  };
}
/* "Takeout started" / "takeoutInProgress" = es wird gezogen. "Takeout" allein (nach dem 3. Dart) nicht. */
function isPulling(st) {
  const k = [st.statusKey, st.eventKey];
  return (k.includes('takeoutstarted') || k.includes('takeoutinprogress')) && st.eventKey !== 'throwdetected';
}
/* ================= Ende Uebernahme ================= */

/* ---------- Verfolger: aus Schnappschuessen werden Dart-Ereignisse ----------
   Jeder neue Platz in der Wurfliste ist ein Dart und geht sofort raus. Wird
   die Liste leer oder beginnt das Ziehen, ist die Aufnahme vorbei ("ziehen").
   Aendert Autodarts einen schon gemeldeten Dart, kommt "korrektur". */
export function erstelleVerfolger(senden) {
  let aufnahme = 0;
  let gemeldet = [];      // Labels der schon gemeldeten Darts dieser Aufnahme
  let gezogen = false;    // fuer diese Aufnahme schon "ziehen" gemeldet
  let erster = true;
  return {
    update(st) {
      if (!st || st.throwsMissing) return;
      const pulling = isPulling(st);
      if (erster) {
        /* Beim Start liegen schon Darts: die gehoeren zu einer Aufnahme, die
           die App nicht kennt - nicht nachbuchen, nur merken. */
        erster = false;
        gemeldet = st.darts.map((d) => d.label);
        aufnahme = 1;
        gezogen = pulling || !gemeldet.length;
        return;
      }
      if (!st.darts.length || pulling) {
        if (gemeldet.length && !gezogen) { senden('ziehen', { aufnahme, anzahl: gemeldet.length }); gezogen = true; }
        if (!st.darts.length) gemeldet = [];
        return;
      }
      /* Neue Darts nach dem Ziehen: neue Aufnahme. */
      if (gezogen) { aufnahme++; gezogen = false; gemeldet = []; }
      /* Weniger Darts als gemeldet ohne Ziehen: Autodarts hat einen Fehlalarm
         zurueckgenommen - nur merken, die App korrigiert der Spieler selbst. */
      /* Weniger Darts als gemeldet ohne Ziehen: Autodarts hat einen
         Fehlalarm zurueckgenommen. Melden (vom letzten her), damit die App
         den Dart auch zuruecknimmt und die Zaehlung stimmt. */
      if (st.darts.length < gemeldet.length) {
        for (let i = gemeldet.length; i > st.darts.length; i--) senden('entfernt', { aufnahme, nr: i, label: gemeldet[i - 1] });
        gemeldet = gemeldet.slice(0, st.darts.length);
        return;
      }
      st.darts.forEach((d, i) => {
        if (i < gemeldet.length) {
          if (gemeldet[i] !== d.label && d.ok) { gemeldet[i] = d.label; senden('korrektur', { aufnahme, nr: i + 1, m: d.m, n: d.n, label: d.label }); }
          return;
        }
        if (i >= 3) return;   // mehr als drei: Fehlerkennung, nicht buchen
        gemeldet.push(d.label);
        if (d.ok) senden('dart', { aufnahme, nr: i + 1, m: d.m, n: d.n, label: d.label });
        else senden('unbekannt', { aufnahme, nr: i + 1, label: d.label });
      });
    },
  };
}

/* ---------- Ereignis-Server ---------- */
const hoerer = new Set();
let seq = 0;
const letzte = [];        // die letzten 30 Ereignisse, fuer /status
const puffer = [];        // die letzten 200 als fertiger Text, zum Nachliefern (Last-Event-ID)
let zustand = { verbunden: false, board: '', fehler: '', darts: [] };

function senden(typ, daten) {
  const ev = Object.assign({ seq: ++seq, zeit: Date.now() }, daten);
  letzte.push(Object.assign({ typ }, ev)); if (letzte.length > 30) letzte.shift();
  const text = 'event: ' + typ + '\nid: ' + ev.seq + '\ndata: ' + JSON.stringify(ev) + '\n\n';
  puffer.push({ seq: ev.seq, text }); if (puffer.length > 200) puffer.shift();
  for (const res of hoerer) res.write(text);
  if (typ !== 'status') log(typ, daten.label || '', daten.nr ? '(' + daten.nr + '. Dart)' : '', daten.anzahl ? daten.anzahl + ' Darts' : '');
}
function statusSetzen(neu) {
  const vorher = JSON.stringify([zustand.verbunden, zustand.board, zustand.fehler]);
  Object.assign(zustand, neu);
  if (JSON.stringify([zustand.verbunden, zustand.board, zustand.fehler]) !== vorher) {
    senden('status', { verbunden: zustand.verbunden, board: zustand.board, fehler: zustand.fehler });
    if (neu.fehler) log('Board Manager:', neu.fehler); else if (neu.verbunden) log('Board Manager verbunden, Zustand', zustand.board || '?');
  }
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && HERKUNFT.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  /* Chrome/Edge: eine oeffentliche Seite darf an 127.0.0.1 nur, wenn das
     Ziel es ausdruecklich erlaubt (Private/Local Network Access). */
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const pfad = (req.url || '/').split('?')[0];
  if (req.headers.origin && !HERKUNFT.has(req.headers.origin)) { res.writeHead(403); res.end('Herkunft nicht erlaubt'); return; }
  /* Gegen DNS-Rebinding: nur unter der eigenen Adresse antworten. */
  const host = String(req.headers.host || '');
  if (host !== '127.0.0.1:' + PORT && host !== 'localhost:' + PORT) { res.writeHead(403); res.end('Host nicht erlaubt'); return; }
  if (pfad === '/ereignisse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n');
    res.write('event: hallo\ndata: ' + JSON.stringify({ seq, version: VERSION, quelle: DEMO ? 'demo' : QUELLE, verbunden: zustand.verbunden, board: zustand.board, fehler: zustand.fehler }) + '\n\n');
    /* Neuverbindung: was seit der zuletzt gesehenen Nummer kam, nachliefern
       (die App verwirft per Laufnummer, was sie schon hat). */
    const seit = Number(req.headers['last-event-id']);
    if (seit > 0) for (const p of puffer) if (p.seq > seit) res.write(p.text);
    hoerer.add(res);
    req.on('close', () => hoerer.delete(res));
    return;
  }
  if (pfad === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ version: VERSION, quelle: DEMO ? 'demo' : QUELLE, hoerer: hoerer.size, ...zustand, letzte }, null, 2));
    return;
  }
  if (pfad === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Autodarts-Brücke</title><body style="font:16px system-ui;background:#111;color:#eee;padding:20px">' +
      '<h1>Autodarts-Brücke ' + VERSION + '</h1><p>Läuft. Die App verbindet sich mit <code>http://127.0.0.1:' + PORT + '/ereignisse</code>.</p>' +
      '<p><a style="color:#f66" href="/status">Status als JSON</a></p></body>');
    return;
  }
  res.writeHead(404); res.end();
});
setInterval(() => { for (const res of hoerer) res.write(': herzschlag\n\n'); }, 15000).unref();

/* ---------- Quelle: Board Manager abfragen ---------- */
const verfolger = erstelleVerfolger(senden);
let laeuft = false;
async function abfragen() {
  if (laeuft) return;
  laeuft = true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(QUELLE + '/api/state', { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const st = normalizeState(await r.json());
    if (!st) throw new Error('unbekanntes Format');
    zustand.darts = st.darts.map((d) => d.label);
    statusSetzen({ verbunden: true, board: st.status, fehler: st.throwsMissing ? 'Board meldet Würfe, aber ohne Liste (Autodarts-Version prüfen)' : '' });
    verfolger.update(st);
  } catch (e) {
    statusSetzen({ verbunden: false, board: '', fehler: e.name === 'AbortError' ? 'keine Antwort von ' + QUELLE : String(e.message || e) });
  } finally {
    laeuft = false;
  }
}

/* ---------- Demo: Darts von Hand (ohne Kameras testen) ---------- */
function demo() {
  let liste = [];
  let status = 'Throw';
  const schritt = () => verfolger.update(normalizeState({ status, event: '', throws: liste.map((x) => ({ segmentName: x })) }));
  statusSetzen({ verbunden: true, board: 'demo', fehler: '' });
  schritt();
  console.log('Demo: Dart eintippen (T20, D16, S5, 25, BULL, M) und Enter. x = Darts ziehen. q = Ende.');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (zeile) => {
    const z = zeile.trim().toUpperCase();
    if (!z) return;
    if (z === 'Q') process.exit(0);
    if (z === 'X') { status = 'Takeout in progress'; schritt(); liste = []; status = 'Throw'; schritt(); return; }
    if (liste.length >= 3) { console.log('Erst ziehen (x).'); return; }
    if (!parseLabel(z === 'M' ? 'MISS' : z)) { console.log('Unbekannt:', z); return; }
    liste.push(z === 'M' ? 'Miss' : z);
    status = liste.length === 3 ? 'Takeout' : 'Throw';
    schritt();
  });
}

/* Tests importieren nur die Funktionen (AD_BRUECKE_NICHT_STARTEN=1). */
if (process.env.AD_BRUECKE_NICHT_STARTEN !== '1') {
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' ist belegt - läuft die Brücke schon?' : e); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => {
    console.log('Autodarts-Brücke ' + VERSION + ' auf http://127.0.0.1:' + PORT + (DEMO ? ' (Demo)' : ', Quelle ' + QUELLE));
    if (DEMO) demo(); else { abfragen(); setInterval(abfragen, TAKT); }
  });
}
