/*
 * Kamera-Relay: vermittelt zwischen dem iPad (Rolle "tisch") und dem iPhone
 * (Rolle "linse") einer laufenden Spielsession. Reine Vermittlung im
 * Arbeitsspeicher -- kein SQLite, kein Video, nur kleine JSON-Ereignisse.
 *
 * Ein Raum lebt unter einem 6-stelligen Code, den das iPad erzeugt. Das
 * mitgeschickte Token schuetzt nur die Neu-Registrierung des Codes (dasselbe
 * iPad darf seinen Raum nach einem Server-Neustart wiederbeleben, ein fremdes
 * nicht). Fuer Ereignisse und Strom reicht der Code selbst als Geheimnis --
 * zusammen mit dem Rate-Limit in der API.
 *
 * Zustellung ist at-least-once: jedes Ereignis bekommt eine Laufnummer (seq)
 * und liegt in einem Ringpuffer. Ein Client, der mit Last-Event-ID
 * wiederkommt, bekommt nachgeliefert, was er verpasst hat; doppelt
 * ankommende Ereignisse sortiert die Gegenseite ueber die seq aus.
 */

const RAUM_TTL = 2 * 3600e3;   // ohne Lebenszeichen verschwindet der Raum
const PUFFER_MAX = 50;         // Ereignisse je Raum fuer die Nachlieferung
const KEEPALIVE_MS = 25e3;     // Kommentarzeile gegen Proxy-/iOS-Timeouts

const raeume = new Map();      // code -> { token, seq, puffer, hoerer, zuletzt }

function raum(code) {
  const r = raeume.get(code);
  if (!r) return null;
  if (Date.now() - r.zuletzt > RAUM_TTL) { schliessen(code); return null; }
  return r;
}

/* Anlegen bzw. Wiederbeleben. Gibt false zurueck, wenn der Code schon einem
   anderen Geraet gehoert (falsches Token). */
export function raumAnlegen(code, token) {
  const r = raeume.get(code);
  if (r && r.token !== token) return false;
  if (r) { r.zuletzt = Date.now(); return true; }
  raeume.set(code, {
    token,
    seq: 0,
    puffer: [],
    hoerer: { tisch: new Set(), linse: new Set() },
    zuletzt: Date.now()
  });
  return true;
}

export function raumOffen(code) {
  return !!raum(code);
}

/* Aktuelle Laufnummer des Raums - der Client gleicht damit sein Wasserzeichen
   ab: faengt der Server nach einem Neustart wieder bei 0 an, wuerde ein hohes
   gemerktes Wasserzeichen sonst alle neuen Ereignisse verschlucken. */
export function raumSeq(code) {
  const r = raum(code);
  return r ? r.seq : 0;
}

/* Ein Ereignis von einer Rolle an die jeweils andere. Gibt die vergebene
   Laufnummer zurueck, oder 0 wenn es den Raum nicht (mehr) gibt. */
export function ereignis(code, von, typ, daten) {
  const r = raum(code);
  if (!r) return 0;
  r.zuletzt = Date.now();
  r.seq += 1;
  const ev = Object.assign({}, daten, { seq: r.seq, von, typ, t: Date.now() });
  r.puffer.push(ev);
  if (r.puffer.length > PUFFER_MAX) r.puffer.shift();
  const an = von === 'tisch' ? 'linse' : 'tisch';
  const zeile = 'id: ' + ev.seq + '\ndata: ' + JSON.stringify(ev) + '\n\n';
  for (const res of r.hoerer[an]) {
    try { res.write(zeile); } catch (e) { r.hoerer[an].delete(res); }
  }
  return r.seq;
}

/* SSE-Strom fuer eine Rolle. Uebernimmt die Response komplett; die API ruft
   danach nichts mehr darauf auf. `abWunsch` kommt als ?ab=-Parameter - ein
   EventSource kann keine eigenen Header setzen, wohl aber eine URL bauen. */
export function anhoeren(code, rolle, req, res, abWunsch) {
  const r = raum(code);
  if (!r) return false;
  r.zuletzt = Date.now();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    // Caddy soll den Strom nicht puffern; ohne Proxy schadet der Header nicht.
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive'
  });
  res.write(': verbunden\n\n');

  /* Verpasstes aus dem Ringpuffer nachliefern -- nur was von der Gegenseite
     kam, die eigenen Ereignisse kennt der Client selbst. */
  const ab = Math.max(Number(req.headers['last-event-id']) || 0, Number(abWunsch) || 0);
  const an = rolle === 'tisch' ? 'linse' : 'tisch';
  for (const ev of r.puffer) {
    if (ev.seq > ab && ev.von === an) {
      res.write('id: ' + ev.seq + '\ndata: ' + JSON.stringify(ev) + '\n\n');
    }
  }

  r.hoerer[rolle].add(res);
  req.on('close', function () {
    const r2 = raeume.get(code);
    if (r2) r2.hoerer[rolle].delete(res);
  });
  return true;
}

function schliessen(code) {
  const r = raeume.get(code);
  if (!r) return;
  for (const rolle of ['tisch', 'linse']) {
    for (const res of r.hoerer[rolle]) {
      try { res.end(); } catch (e) { /* Verbindung war schon weg */ }
    }
  }
  raeume.delete(code);
}

/* Stuendlich aus main.mjs: verwaiste Raeume schliessen. */
export function aufraeumen() {
  const jetzt = Date.now();
  for (const [code, r] of raeume) {
    if (jetzt - r.zuletzt > RAUM_TTL) schliessen(code);
  }
}

/* Lebenszeichen an alle offenen Stroeme -- iOS und Proxys trennen stille
   Verbindungen sonst nach etwa einer Minute. */
const puls = setInterval(function () {
  for (const r of raeume.values()) {
    for (const rolle of ['tisch', 'linse']) {
      for (const res of r.hoerer[rolle]) {
        try { res.write(': ping\n\n'); } catch (e) { r.hoerer[rolle].delete(res); }
      }
    }
  }
}, KEEPALIVE_MS);
puls.unref();
