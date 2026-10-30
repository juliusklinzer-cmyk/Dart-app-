/*
 * Mitteilungszentrale: Web-Push-Verschluesselung (RFC 8291) und VAPID
 * (RFC 8292) nachgerechnet, Einstellungen je Thema, die Jobs (DiensDarts,
 * Spieltag morgen, Tabelle), Ereignisse aus der App, Kasse, Konto, neues
 * Mitglied und der Testversand - mit Mailer und Push, die nur mitschreiben.
 *
 *   node tests/mitteilungen.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vapidErzeugen, vapidKopf, verschluessele, erstellePush, vonB64url, b64url } from '../server/lib/push.mjs';
import { ladeLigaDaten } from '../server/lib/liga.mjs';
import { openDb } from '../server/lib/db.mjs';
import { createApi } from '../server/api.mjs';
import { hashPassword } from '../server/lib/password.mjs';
import { THEMEN } from '../server/lib/mitteilungen.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fehler = 0;
function check(name, ok, extra) { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || !extra ? '' : ' ' + extra)); if (!ok) fehler++; }

/* ---------- 1. Push: Verschluesselung und VAPID ---------- */
console.log('Push: aes128gcm und VAPID');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const abo = { endpoint: 'https://push.example.org/abc', keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) } };
const body = verschluessele('{"titel":"Hallo","text":"Grüße"}', abo);
const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), geheim = body.subarray(21 + idlen);
check('Kopf: Salt, rs 4096, 65 Byte Absenderschluessel', rs === 4096 && idlen === 65 && asPub[0] === 4);
const geteilt = ua.computeSecret(asPub);
const hk = (s, ikm, info, l) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, l));
const ikm = hk(auth, geteilt, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32);
const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
dec.setAuthTag(geheim.subarray(geheim.length - 16));
const klar = Buffer.concat([dec.update(geheim.subarray(0, geheim.length - 16)), dec.final()]);
check('der Empfaenger entschluesselt den Text, Abschluss-Byte 0x02', klar.subarray(0, klar.length - 1).toString('utf8') === '{"titel":"Hallo","text":"Grüße"}' && klar[klar.length - 1] === 2);
const b2 = verschluessele('x', abo);
check('jede Nachricht hat eigenen Salt und eigenen Schluessel', !b2.subarray(0, 16).equals(salt) && !b2.subarray(21, 86).equals(asPub));
const keys = vapidErzeugen();
const kopf = vapidKopf(abo.endpoint, keys, 'mailto:dart@wirtschaftln.de');
const m = /^vapid t=([^,]+), k=(.+)$/.exec(kopf);
check('VAPID-Kopf: t=JWT, k=oeffentlicher Schluessel', !!m && m[2] === keys.public);
const [h, p, sig] = m[1].split('.');
const pub = vonB64url(keys.public);
const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }, format: 'jwk' });
check('die ES256-Signatur stimmt, aud ist die Herkunft des Endpunkts', crypto.verify('sha256', Buffer.from(h + '.' + p), { key: pubKey, dsaEncoding: 'ieee-p1363' }, vonB64url(sig)) &&
  JSON.parse(vonB64url(p).toString()).aud === 'https://push.example.org' && JSON.parse(vonB64url(h).toString()).alg === 'ES256');
const echteFetch = globalThis.fetch;
const anfragen = [];
globalThis.fetch = async (url, opt) => { anfragen.push({ url, opt }); return { status: url.endsWith('/weg') ? 410 : 201, text: async () => '' }; };
const push = erstellePush({ public: keys.public, private: keys.private });
const r1 = await push.sende(abo, { titel: 'T', text: 'x', url: 'https://darts.test', tag: 'zusage' });
const r2 = await push.sende({ endpoint: 'https://push.example.org/weg', keys: abo.keys }, { titel: 'T', text: 'x' });
globalThis.fetch = echteFetch;
check('Versand: POST mit aes128gcm, TTL, Topic und VAPID; 201 = ok, 410 = Abo weg', r1.ok && !r1.weg && r2.weg && anfragen[0].opt.headers['Content-Encoding'] === 'aes128gcm' &&
  anfragen[0].opt.headers.Topic === 'zusage' && /^vapid t=/.test(anfragen[0].opt.headers.Authorization) && anfragen[0].opt.body.length > 100);
check('ohne Schluessel nicht bereit', !erstellePush({}).bereit);

/* ---------- 2. Die Zentrale ---------- */
console.log('Mitteilungen: Einstellungen, Jobs, Ereignisse');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-mitt-'));
const db = openDb(path.join(tmp, 't.db'));
const mails = [], pushes = [];
const mailer = { bereit: true, absender: { liga: 'Blink 180 <blink180@wirtschaftln.de>', app: 'Dart-App <dart@wirtschaftln.de>' }, sende: async (x) => { mails.push(x); return { gesendet: true }; } };
const fakePush = { bereit: true, public: 'PUB', sende: async (a, n) => { pushes.push({ endpoint: a.endpoint, n }); return { ok: !/weg/.test(a.endpoint), weg: /weg/.test(a.endpoint) }; } };
const liga = ladeLigaDaten(ROOT);
const api = createApi(db, { secureCookies: false, mailer, push: fakePush, liga, appUrl: 'https://darts.test' });
const Z = api.mitteilungen;
const jetzt = new Date().toISOString();
const neu = db.prepare('INSERT INTO users (id, email, display_name, password_hash, hue, status, created_at, gast_konto, test, kassenwart) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)');
neu.run('u_a', 'a@beispiel.de', 'Anna', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 1);
neu.run('u_b', 'b@beispiel.de', 'Bert', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 0);
neu.run('u_g', 'g@beispiel.de', 'Gabi', hashPassword('pw'), 'aktiv', jetzt, 1, 0, 0);   // Gast-Konto
neu.run('u_t', 't@beispiel.de', 'Tess', hashPassword('pw'), 'aktiv', jetzt, 0, 1, 0);   // Testkonto
db.prepare('INSERT INTO push_abos (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run('u_a', 'https://push.example.org/anna', 'k', 'a', jetzt);
db.prepare('INSERT INTO push_abos (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run('u_a', 'https://push.example.org/anna-weg', 'k', 'a', jetzt);
const leer = () => { mails.length = 0; pushes.length = 0; };

check('elf Themen, Voreinstellungen wie besprochen', THEMEN.length === 11 && Z.einstellungen('u_a').zusage === 'beide' && Z.einstellungen('u_a').rekord === 'push' && Z.einstellungen('u_a').mitglied === 'aus' && Z.einstellungen('u_a').konto === 'mail');
Z.setze('u_b', 'zusage', 'aus'); Z.setze('u_b', 'rekord', 'beide');
check('Einstellungen je Konto', Z.einstellungen('u_b').zusage === 'aus' && Z.einstellungen('u_b').rekord === 'beide' && Z.einstellungen('u_a').zusage === 'beide');
let f = null; try { Z.setze('u_a', 'konto', 'aus'); } catch (e) { f = e; }
check('Konto und Sicherheit laesst sich nicht abschalten', !!f);
f = null; try { Z.setze('u_a', 'zusage', 'telegramm'); } catch (e) { f = e; }
check('unbekannter Kanal wird abgewiesen', !!f);

/* Ereignis: Ergebnis an alle. */
leer();
let n = await Z.ereignis({ id: 'u_a', display_name: 'Anna' }, 'ergebnis', { termin: 'st03', nr: 3, gegner: 'Voodoo Darters', heim: false, ort: 'Heuboden', wirP: 9, sieP: 7, wirS: 9, sieS: 7, wirL: 22, sieL: 22, mod: 'Dominik Uhl (3 Siege)', hl: ['Shortlegs: 17 Darts Dominik Uhl'], einzel: [{ h: 'Kevin Bauer', g: 'Dominik Uhl', score: '1:2' }] });
check('Ergebnis: Anna (beide) Mail + Push, Bert (beide) Mail, Gast und Test nicht; totes Abo geloescht',
  n === 2 && mails.length === 2 && mails.every((x) => x.von === 'liga' && /Sieg am 3\. Spieltag: Blink 180 9 : 7 Voodoo Darters/.test(x.betreff)) &&
  /Man of the Day: Dominik Uhl/.test(mails[0].text) && /Kevin Bauer – Dominik Uhl  1:2/.test(mails[0].text) &&
  mails[0].kicker === 'Unser Ligaergebnis' && mails[0].knopf.text === 'Spielbericht und Statistik' && mails[0].knopf.url === 'https://darts.test' && /^Sieg am 3/.test(mails[0].titel) && /Einzel 9:7/.test(mails[0].vorschau) &&
  pushes.length === 2 && pushes[0].n.tag === 'ergebnis' && db.prepare('SELECT COUNT(*) AS n FROM push_abos').get().n === 1, JSON.stringify({ n, mails: mails.length, pushes: pushes.length }));
leer();
n = await Z.ereignis({ id: 'u_b' }, 'ergebnis', { termin: 'st03', nr: 3, gegner: 'Voodoo Darters', wirP: 9, sieP: 7 });
check('dasselbe Ergebnis vom zweiten iPad geht nicht nochmal raus', n === 0 && mails.length === 0);
leer();
n = await Z.ereignis({ id: 'u_a' }, 'rekord', { art: 'Höchstes Finish', wert: 121, name: 'Lenas' });
check('Rekord: Anna nur Push, Bert Push + Mail (seine Einstellung)', n === 2 && mails.length === 1 && mails[0].an[0] === 'b@beispiel.de' && pushes.length === 1 && /121 – Lenas/.test(pushes[0].n.text));
leer();
n = await Z.ereignis({ id: 'u_a', display_name: 'Anna' }, 'bericht-offen', { termin: 'st03', nr: 3, gegner: 'Voodoo Darters' });
check('Bericht offen: nur an den, der abgeschlossen hat, als Push', n === 1 && pushes.length === 1 && pushes[0].endpoint === 'https://push.example.org/anna' && mails.length === 0);
leer();
f = null; try { await Z.ereignis({ id: 'u_a' }, 'quatsch', {}); } catch (e) { f = e; }
check('unbekanntes Ereignis wird abgewiesen', !!f);
n = await Z.ereignis({ id: 'u_a' }, 'live', { termin: 'st04', nr: 4, gegner: 'd`Haberer 2', heim: true, ort: 'Bar Sehnsucht', link: 'https://darts.test/live.html#abc' });
check('Anpfiff: Push mit Ticker-Link', n === 1 && pushes.length === 1 && pushes[0].n.url === 'https://darts.test/live.html#abc');

/* Jobs. */
const tagMinus = (iso, tage) => new Date(Date.parse(iso + 'T12:00:00Z') - tage * 86400e3).toISOString().slice(0, 10);
const st04 = liga.liga.termine.find((t) => t.id === 'st04');
db.prepare('INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?)').run('st04', 'u_b', jetzt, 'dabei');
leer();
n = await Z.zusageErinnerung(tagMinus(st04.tag, 7));
check('Zusage fehlt: Anna (ohne Zusage) Mail + Push, Bert hat zugesagt, Gast ist kein Ligaspieler', n === 1 && mails.length === 1 && mails[0].an[0] === 'a@beispiel.de' && /Bisher dabei: 1 von 4/.test(mails[0].text) && pushes.length === 1);
leer();
n = await Z.spieltagMorgen(tagMinus(st04.tag, 1));
check('Spieltag morgen: nur an Zugesagte (Bert), als Push, mit Aufstellung', n === 0 || n === 1, JSON.stringify({ n, pushes: pushes.length, mails: mails.length }));
check('Spieltag morgen: Bert hat keine Push-Abos und nur Push eingestellt - also nichts, Anna ohne Zusage bekommt nichts', n === 0 && pushes.length === 0);
Z.setze('u_b', 'spieltag-morgen', 'beide');
db.prepare('DELETE FROM mitteilung_log').run();
leer();
n = await Z.spieltagMorgen(tagMinus(st04.tag, 1));
check('mit Mail eingestellt bekommt Bert die Aufstellung per Mail', n === 1 && mails.length === 1 && /Dabei \(1\): Bert/.test(mails[0].text) && /Morgen 4\. Spieltag gegen d`Haberer 2/.test(mails[0].betreff));
/* DiensDarts: ein Samstag, drei Tage vor dem Dienstag. */
let samstag = '2026-11-07';
check('Samstag ist ein Samstag', new Date(samstag + 'T12:00:00Z').getUTCDay() === 6);
db.prepare('INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?)').run('tr20261110', 'u_b', jetzt, 'absage');
leer();
n = await Z.trainingErinnerung(samstag);
check('DiensDarts: Anna und Gast-Konto Gabi (ohne Antwort), nicht Bert (hat abgesagt)', n === 2 && mails.map((x) => x.an[0]).sort().join() === 'a@beispiel.de,g@beispiel.de' && /DiensDarts am Di\. 10\.11\.2026/.test(mails[0].betreff));
leer();
check('am Freitag keine Trainings-Erinnerung', (await Z.trainingErinnerung('2026-11-06')) === 0);
/* Tabelle: der 2. Spieltag ist komplett (letztes Spiel 23.10.). */
leer();
n = await Z.tabelleNeu('2026-10-25');
check('Tabelle nach komplettem Spieltag: an alle als Push (Voreinstellung), mit Platz', n >= 1 && pushes.some((x) => /Blink 180 auf Platz \d/.test(x.n.titel)) && mails.length === 0);
leer();
check('nicht nochmal', (await Z.tabelleNeu('2026-10-26')) === 0);
check('zu lange her: nichts', (await Z.tabelleNeu('2026-12-01')) === 0 && mails.length === 0);
leer();
n = await Z.jobs(tagMinus(st04.tag, 2));
check('jobs() buendelt alle vier Jobs (Zusage Stufe 2 fuer Anna)', n >= 1 && mails.some((x) => /bist du dabei/.test(x.betreff)));

/* Kasse, Konto, neues Mitglied, Testversand. */
leer();
await Z.kasseBuchung('u_b', { betrag: 2000, text: 'Beitrag', kategorie: 'Mitgliedsbeiträge', datum: '2026-10-30' }, 'Anna');
check('Kasse: Bert hat nur Push und kein Abo - nichts; Anna bekommt nichts, es ist Berts Buchung', mails.length === 0 && pushes.length === 0);
await Z.kasseBuchung('u_a', { betrag: 2000, text: 'Beitrag', kategorie: 'Mitgliedsbeiträge', datum: '2026-10-30' }, 'Bert');
check('Kasse: Anna per Push mit Betrag', pushes.length === 1 && /20,00 €/.test(pushes[0].n.titel));
leer();
await Z.konto({ id: 'u_a', email: 'a@beispiel.de', display_name: 'Anna' }, 'passwort');
check('Konto: immer per Mail vom App-Absender, nie Push', mails.length === 1 && mails[0].von === 'app' && /Passwort/.test(mails[0].betreff) && pushes.length === 0);
leer();
await Z.neuesMitglied({ id: 'u_b', display_name: 'Bert' });
check('neues Mitglied: Voreinstellung aus - nichts', mails.length === 0 && pushes.length === 0);
Z.setze('u_a', 'mitglied', 'beide');
await Z.neuesMitglied({ id: 'u_b', display_name: 'Bert' });
check('eingeschaltet: Anna erfaehrt es, Bert selbst nicht', mails.length === 1 && mails[0].an[0] === 'a@beispiel.de' && pushes.length === 1);
leer();
n = await Z.testAlle({ id: 'u_b', email: 'b@beispiel.de', display_name: 'Bert' });
check('Testversand: alle elf Themen als Mail an Bert, egal wie eingestellt', n === 11 && mails.length === 11 && mails.every((x) => /^\[Test\]/.test(x.betreff)));

db.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(fehler ? '\n' + fehler + ' Fehler' : '\nAlle Mitteilungs-Tests bestanden');
process.exit(fehler ? 1 : 0);
