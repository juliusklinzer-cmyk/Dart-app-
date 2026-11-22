/* Kleine Helfer um node:http — kein Framework, wie im Rest des Projekts. */

export const MAX_BODY = 2 * 1024 * 1024; // ein ganzes Turnier mit allen Wuerfen
/* Anmelden, Registrieren, Passwort: da stehen ein paar Worte drin, kein
   Turnier. Ein kleines Limit haelt Speicherfresser draussen. */
export const MAX_BODY_KLEIN = 16 * 1024;

export function sendJson(res, code, daten, extraHeader) {
  const text = JSON.stringify(daten);
  const header = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  };
  if (extraHeader) Object.assign(header, extraHeader);
  res.writeHead(code, header);
  res.end(text);
}

/* Fehler immer in derselben Form: { fehler: "Text fuer Julius' Kollegen" } */
export function sendFehler(res, code, text, extraHeader) {
  sendJson(res, code, { fehler: text }, extraHeader);
}

export function leseCookies(req) {
  const roh = req.headers.cookie;
  const out = {};
  if (!roh) return out;
  for (const teil of roh.split(';')) {
    const i = teil.indexOf('=');
    if (i < 0) continue;
    // Ein kaputt kodiertes Cookie (z. B. "%E0%A4%A") ist schlicht keins --
    // sonst wirft decodeURIComponent und der Nutzer saehe einen 500er
    // statt "nicht angemeldet".
    try {
      out[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
    } catch (e) {
      /* ueberspringen */
    }
  }
  return out;
}

export function leseJson(req, maxBytes) {
  const grenze = maxBytes || MAX_BODY;
  return new Promise((resolve, reject) => {
    let laenge = 0;
    let zuGross = false;
    const stuecke = [];
    req.on('data', (c) => {
      if (zuGross) return;           // Rest nur noch verwerfen
      laenge += c.length;
      if (laenge > grenze) {
        /* Nicht sofort die Verbindung kappen: dann kaeme die 413-Antwort
           nie beim Client an, und er hielte das fuer ein Netzproblem.
           Stattdessen antworten (das macht der Aufrufer) und den Rest
           verwerfen -- wer danach weiter Daten schickt, fliegt nach ein
           paar Sekunden raus. */
        zuGross = true;
        stuecke.length = 0;
        reject(new HttpFehler(413, 'Die Daten sind zu gross.'));
        setTimeout(() => { if (!req.complete) req.destroy(); }, 5000).unref();
        return;
      }
      stuecke.push(c);
    });
    req.on('end', () => {
      if (zuGross) return;
      if (!stuecke.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(stuecke).toString('utf8')));
      } catch (e) {
        reject(new HttpFehler(400, 'Die Anfrage war kein gueltiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export class HttpFehler extends Error {
  constructor(code, text) {
    super(text);
    this.code = code;
    this.text = text;
  }
}

/*
 * Client-IP. Hinter Caddy kommt die echte Adresse in X-Forwarded-For; direkt
 * angesprochen (lokal, Tests) nehmen wir die Socket-Adresse. Wir vertrauen dem
 * Header nur, wenn TRUST_PROXY gesetzt ist — sonst koennte sich jeder mit
 * einem erfundenen Header am Rate-Limit vorbeimogeln.
 */
export function clientIp(req, trustProxy) {
  let ip = '';
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) ip = String(xff).split(',')[0].trim();
  }
  return netzVon(ip || req.socket.remoteAddress || 'unbekannt');
}

/* Fuer die Bremsen zaehlt bei IPv6 das ganze /64-Netz: ein Mietserver hat
   davon 2^64 Adressen und koennte sonst jede Bremse umgehen. IPv4 (auch
   als ::ffff:1.2.3.4) bleibt, wie es ist. */
export function netzVon(ip) {
  const a = String(ip);
  if (a.indexOf(':') < 0 || /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(a)) return a;
  let teile = a.split('%')[0].split('::');
  const vorne = teile[0] ? teile[0].split(':') : [];
  const hinten = teile.length > 1 && teile[1] ? teile[1].split(':') : [];
  const voll = teile.length > 1 ? vorne.concat(new Array(Math.max(0, 8 - vorne.length - hinten.length)).fill('0'), hinten) : vorne;
  return voll.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64';
}
