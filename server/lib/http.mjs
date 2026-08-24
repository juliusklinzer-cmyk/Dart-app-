/* Kleine Helfer um node:http — kein Framework, wie im Rest des Projekts. */

export const MAX_BODY = 2 * 1024 * 1024; // ein ganzes Turnier mit allen Wuerfen

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
    out[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
  }
  return out;
}

export function leseJson(req) {
  return new Promise((resolve, reject) => {
    let laenge = 0;
    const stuecke = [];
    req.on('data', (c) => {
      laenge += c.length;
      if (laenge > MAX_BODY) {
        reject(new HttpFehler(413, 'Die Daten sind zu gross.'));
        req.destroy();
        return;
      }
      stuecke.push(c);
    });
    req.on('end', () => {
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
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unbekannt';
}
