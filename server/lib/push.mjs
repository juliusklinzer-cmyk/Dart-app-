/*
 * Web Push ohne Abhaengigkeit: VAPID (RFC 8292, ES256-JWT) und die
 * Verschluesselung der Nachricht (RFC 8291, aes128gcm) mit node:crypto.
 *
 * Schluesselpaar einmalig erzeugen: node server/scripts/vapid.mjs - die
 * beiden Werte kommen als DARTS_VAPID_PUBLIC / DARTS_VAPID_PRIVATE in die
 * .env auf dem Server. Aendert sich das Paar, sind alle Push-Abos ungueltig.
 *
 * Ein Abo kommt vom Browser (PushSubscription.toJSON()): endpoint, keys.p256dh
 * (oeffentlicher Schluessel des Browsers, 65 Bytes), keys.auth (16 Bytes).
 */
import crypto from 'node:crypto';

export function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
export function vonB64url(s) { return Buffer.from(String(s || ''), 'base64url'); }

/* Neues VAPID-Schluesselpaar: { public, private } als base64url. */
export function vapidErzeugen() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { public: b64url(ecdh.getPublicKey()), private: b64url(ecdh.getPrivateKey()) };
}

/* ES256-JWT fuer die Push-Dienste (Google, Apple, Mozilla): aud = Herkunft
   des Endpunkts, 12 Stunden gueltig. */
export function vapidKopf(endpoint, keys, kontakt) {
  const pub = vonB64url(keys.public);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID: oeffentlicher Schluessel unbrauchbar');
  const priv = vonB64url(keys.private);
  const schluessel = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)), d: b64url(priv) },
    format: 'jwk'
  });
  const aud = new URL(endpoint).origin;
  const kopf = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const inhalt = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: kontakt || 'mailto:dart@wirtschaftln.de' }));
  const sig = crypto.sign('sha256', Buffer.from(kopf + '.' + inhalt), { key: schluessel, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + kopf + '.' + inhalt + '.' + b64url(sig) + ', k=' + keys.public;
}

function hkdf(salt, ikm, info, laenge) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, laenge));
}

/* Nachricht fuer ein Abo verschluesseln (aes128gcm). Liefert den fertigen
   Body; der Empfaenger rechnet mit seinem privaten Schluessel denselben
   Inhaltsschluessel. */
export function verschluessele(text, abo, optionen) {
  const uaPublic = vonB64url(abo.keys.p256dh);
  const auth = vonB64url(abo.keys.auth);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error('Push-Abo unbrauchbar (Schluessel)');
  const ecdh = crypto.createECDH('prime256v1');
  if (optionen && optionen.privat) ecdh.setPrivateKey(optionen.privat); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const geteilt = ecdh.computeSecret(uaPublic);
  const salt = (optionen && optionen.salt) || crypto.randomBytes(16);
  const ikm = hkdf(auth, geteilt, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const klar = Buffer.concat([Buffer.from(String(text), 'utf8'), Buffer.from([2])]);   // 0x02 = letzter Datensatz
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const geheim = Buffer.concat([cipher.update(klar), cipher.final(), cipher.getAuthTag()]);
  const kopf = Buffer.alloc(21);
  salt.copy(kopf, 0);
  kopf.writeUInt32BE(4096, 16);
  kopf[20] = asPublic.length;
  return Buffer.concat([kopf, asPublic, geheim]);
}

/*
 * Der Push-Dienst der App. cfg: { public, private, kontakt }. Ohne
 * Schluessel nicht "bereit". sende(abo, nachricht) schickt { titel, text,
 * url, tag } als JSON; Antwort { ok, weg } - weg = das Abo gibt es nicht
 * mehr (404/410), der Aufrufer loescht es dann.
 */
export function erstellePush(cfg) {
  cfg = cfg || {};
  const bereit = !!(cfg.public && cfg.private);
  async function sende(abo, nachricht, optionen) {
    if (!bereit) return { ok: false, weg: false, grund: 'nicht eingerichtet' };
    const body = verschluessele(JSON.stringify(nachricht), abo);
    const kopf = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: String((optionen && optionen.ttl) || 86400),
      Urgency: (optionen && optionen.urgency) || 'normal',
      Authorization: vapidKopf(abo.endpoint, cfg, cfg.kontakt)
    };
    if (nachricht && nachricht.tag) kopf.Topic = String(nachricht.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    const r = await fetch(abo.endpoint, { method: 'POST', headers: kopf, body, signal: AbortSignal.timeout(15000) });
    if (r.status === 404 || r.status === 410) return { ok: false, weg: true, status: r.status };
    if (r.status >= 200 && r.status < 300) return { ok: true, weg: false, status: r.status };
    const t = await r.text().catch(function () { return ''; });
    return { ok: false, weg: false, status: r.status, grund: t.slice(0, 200) };
  }
  return { bereit, sende, public: cfg.public || '' };
}
