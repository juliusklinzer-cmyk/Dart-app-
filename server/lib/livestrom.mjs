/*
 * Live-Strom fuer Online-Spiele: Server-Sent Events, gleiches Muster wie das
 * Kamera-Relay (relay.mjs), nur viel schlichter. Der Strom traegt KEINEN
 * Spielstand, nur die Nachricht "es gibt Version N" -- den Stand holt sich
 * das Geraet dann wie gewohnt ueber GET /api/live/:id. So bleibt die
 * Rechte- und Datenpruefung an genau einer Stelle, und ein verpasstes
 * Ereignis richtet keinen Schaden an: der naechste Abgleich holt alles.
 *
 * Vertrag (der Client baut genau darauf):
 *
 *   event: stand
 *   data: {"seq":N,"status":"offen"|"zu"}
 *
 * - einmal direkt nach dem Verbinden (aktueller Stand, damit ein Geraet
 *   nach einem Funkloch sofort merkt, ob es etwas verpasst hat),
 * - danach nach jedem erfolgreichen PUT und jedem Ende des Spiels.
 * Dazu alle 25 s eine Kommentarzeile ": ping" gegen Proxy- und iOS-Timeouts.
 *
 * Reine Vermittlung im Arbeitsspeicher. Ein Neustart des Servers trennt
 * alle Stroeme; EventSource verbindet sich von selbst neu.
 */

// Nur die Tests drehen den Takt herunter, damit sie nicht 25 s warten.
const KEEPALIVE_MS = Number(process.env.DARTS_SSE_PULS_MS) || 25e3;
export const MAX_HOERER = 8;   // je Spiel -- zwei Handys, ein paar Neulader

const hoerer = new Map();      // spielId -> Set<res>

function zeile(seq, status) {
  return 'event: stand\ndata: ' + JSON.stringify({ seq, status }) + '\n\n';
}

/*
 * Strom oeffnen. Uebernimmt die Response komplett. Ist das Spiel schon voll
 * belegt, fliegt die aelteste Verbindung raus: meist ist das ein Geraet, das
 * neu geladen hat und dessen alte Verbindung noch nicht als tot erkannt ist.
 */
export function anhoeren(spielId, req, res, seq, status) {
  let set = hoerer.get(spielId);
  if (!set) {
    set = new Set();
    hoerer.set(spielId, set);
  }
  while (set.size >= MAX_HOERER) {
    const aelteste = set.values().next().value;
    set.delete(aelteste);
    try { aelteste.end(); } catch (e) { /* war schon weg */ }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive'
  });
  res.write(': verbunden\n\n');
  res.write(zeile(seq, status));

  set.add(res);
  const weg = function () {
    const s = hoerer.get(spielId);
    if (!s) return;
    s.delete(res);
    if (!s.size) hoerer.delete(spielId);
  };
  req.on('close', weg);
  res.on('close', weg);
}

/* Nach jedem erfolgreichen Schreiben: alle Hoerer dieses Spiels anstossen. */
export function melden(spielId, seq, status) {
  const set = hoerer.get(spielId);
  if (!set) return 0;
  const text = zeile(seq, status);
  for (const res of set) {
    try { res.write(text); } catch (e) { set.delete(res); }
  }
  return set.size;
}

export function anzahl(spielId) {
  const set = hoerer.get(spielId);
  return set ? set.size : 0;
}

const puls = setInterval(function () {
  for (const set of hoerer.values()) {
    for (const res of set) {
      try { res.write(': ping\n\n'); } catch (e) { set.delete(res); }
    }
  }
}, KEEPALIVE_MS);
puls.unref();
