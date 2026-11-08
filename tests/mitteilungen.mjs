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
import { THEMEN, erstelleMitteilungen, berlinZeit } from '../server/lib/mitteilungen.mjs';

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
globalThis.fetch = async (url, opt) => { anfragen.push({ url, opt }); return { status: url.endsWith('/weg') ? 410 : url.endsWith('/verboten') ? 403 : url.endsWith('/kaputt') ? 500 : 201, text: async () => 'x' }; };
const push = erstellePush({ public: keys.public, private: keys.private });
const r1 = await push.sende(abo, { titel: 'T', text: 'x', url: 'https://darts.test', tag: 'zusage' });
const r2 = await push.sende({ endpoint: 'https://push.example.org/weg', keys: abo.keys }, { titel: 'T', text: 'x' });
const r3 = await push.sende({ endpoint: 'https://push.example.org/verboten', keys: abo.keys }, { titel: 'T', text: 'x' });
const r4 = await push.sende({ endpoint: 'https://push.example.org/kaputt', keys: abo.keys }, { titel: 'T', text: 'x' });
const r5 = await push.sende({ endpoint: 'https://push.example.org/kurz', keys: { p256dh: 'a2to', auth: 'eA' } }, { titel: 'T', text: 'x' });
globalThis.fetch = echteFetch;
check('Versand: POST mit aes128gcm, TTL, Topic und VAPID; 201 = ok, 410 = Abo weg', r1.ok && !r1.weg && r2.weg && anfragen[0].opt.headers['Content-Encoding'] === 'aes128gcm' &&
  anfragen[0].opt.headers.Topic === 'zusage' && /^vapid t=/.test(anfragen[0].opt.headers.Authorization) && anfragen[0].opt.body.length > 100);
check('403 = Abo weg (VAPID passt nicht mehr), 500 = Fehler, aber Abo bleibt', r3.weg && !r3.ok && r3.status === 403 && !r4.weg && !r4.ok && r4.status === 500);
check('Abo mit zu kurzen Schluesseln: weg, ohne Anfrage an den Dienst', r5.weg && !r5.ok && /unbrauchbar/.test(r5.grund) && anfragen.length === 4);
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
  pushes.length === 2 && /^ergebnis-[A-Za-z0-9_-]{8}$/.test(pushes[0].n.tag) && db.prepare('SELECT COUNT(*) AS n FROM push_abos').get().n === 1, JSON.stringify({ n, mails: mails.length, pushes: pushes.length, tag: pushes[0] && pushes[0].n.tag }));
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
/* DiensDarts: ein Samstag, drei Tage vor einem Dienstag ohne Ligaspiel (17.11.). */
let samstag = '2026-11-14';
check('Samstag ist ein Samstag', new Date(samstag + 'T12:00:00Z').getUTCDay() === 6);
db.prepare('INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?)').run('tr20261117', 'u_b', jetzt, 'absage');
leer();
n = await Z.trainingErinnerung(samstag);
check('DiensDarts: Anna und Gast-Konto Gabi (ohne Antwort), nicht Bert (hat abgesagt)', n === 2 && mails.map((x) => x.an[0]).sort().join() === 'a@beispiel.de,g@beispiel.de' && /DiensDarts am Di\. 17\.11\.2026/.test(mails[0].betreff));
leer();
check('am Freitag keine Trainings-Erinnerung', (await Z.trainingErinnerung('2026-11-13')) === 0);
check('Samstag vor einem Dienstag mit Ligaspiel (4. Spieltag am 10.11.): kein DiensDarts, keine Erinnerung', st04.tag === '2026-11-10' && (await Z.trainingErinnerung('2026-11-07')) === 0 && mails.length === 0);
/* Tabelle: der 2. Spieltag ist komplett (letztes Spiel 23.10.). Anna bekommt
   sie auch als Mail, damit der Text pruefbar ist. */
Z.setze('u_a', 'tabelle', 'beide');
leer();
n = await Z.tabelleNeu('2026-10-25');
/* Am 25.10. liegen der 1. (letztes Spiel 16.10.) und der 2. Spieltag (23.10.) in den zehn Tagen. */
check('Tabelle nach komplettem Spieltag: an alle als Push (Voreinstellung), mit Platz; Mail nur an Anna', n >= 1 && pushes.some((x) => /Blink 180 auf Platz \d/.test(x.n.titel)) && mails.length >= 1 && mails.every((x) => x.an[0] === 'a@beispiel.de'), JSON.stringify({ n, mails: mails.length, pushes: pushes.length }));
check('Tabellenzeile nennt Spiele, Einzel und Legs getrennt', /^\d+\. .+  \d+ Pkt \(\d+ Spiele, Einzel \d+:\d+, Legs \d+:\d+\)$/m.test(mails[0].text) && /komplett gewertet/.test(mails[0].text), JSON.stringify(mails[0].text.split('\n').find((z) => /Pkt/.test(z))));
leer();
check('nicht nochmal', (await Z.tabelleNeu('2026-10-26')) === 0);
check('zu lange her: nichts', (await Z.tabelleNeu('2026-12-01')) === 0 && mails.length === 0);
/* jobs() mit echter Uhr: Berliner Zeit und Fenster 9-21 Uhr. Zwei Tage vor
   dem 4. Spieltag steht die Zusage-Stufe 2 fuer Anna an - nachts um 1:30
   Berlin (0:30 UTC, Winterzeit) passiert trotzdem nichts, um 9:30 geht sie raus. */
const bz1 = berlinZeit(new Date('2026-07-01T22:30:00Z')), bz2 = berlinZeit(new Date('2026-11-08T00:30:00Z'));
check('berlinZeit: Sommer 22:30 UTC = 2.7. 0 Uhr, Winter 0:30 UTC = 1 Uhr', bz1.tag === '2026-07-02' && bz1.stunde === 0 && bz2.tag === '2026-11-08' && bz2.stunde === 1);
leer();
n = await Z.jobs(new Date(tagMinus(st04.tag, 2) + 'T00:30:00Z'));
check('jobs() um 1:30 Berlin: nichts - auch wenn eine Erinnerung ansteht', n === 0 && mails.length === 0 && pushes.length === 0);
n = await Z.jobs(new Date(tagMinus(st04.tag, 2) + 'T08:30:00Z'));
check('jobs() um 9:30 Berlin buendelt alle vier Jobs (Zusage Stufe 2 fuer Anna)', n >= 1 && mails.some((x) => /bist du dabei/.test(x.betreff) && /in 2 Tagen/.test(x.text)));
leer();
check('jobs() mit Tag als Text: ohne Fenster, aber Stufe 2 ist erledigt', (await Z.jobs(tagMinus(st04.tag, 1))) === 0);

/* Stufen und Datum im Schluessel am 5. Spieltag (24.11.): 3 Tage vorher
   liegt zwischen den Stufen, ein verschobener Spieltag schweigt, und zum
   neuen Datum wird wieder erinnert. */
const st05 = liga.liga.termine.find((t) => t.id === 'st05');
const st05Tag = st05.tag;
leer();
check('3 Tage vorher: keine Stufe (7 ist 4-7, 2 ist 1-2)', (await Z.zusageErinnerung(tagMinus(st05.tag, 3))) === 0);
n = await Z.zusageErinnerung(tagMinus(st05.tag, 7));
check('7 Tage vorher: Anna, Schluessel traegt das Datum', n === 1 && mails.length === 1 && db.prepare('SELECT 1 FROM mitteilung_log WHERE schluessel = ? AND user_id = ?').get('zusage:st05:' + st05.tag + ':7', 'u_a'));
st05.verschoben = true;
leer();
check('verschobener Spieltag: weder Stufe 2 noch "Spieltag morgen" zum alten Datum', (await Z.zusageErinnerung(tagMinus(st05.tag, 2))) === 0 && (await Z.spieltagMorgen(tagMinus(st05.tag, 1))) === 0 && mails.length === 0 && pushes.length === 0);
delete st05.verschoben; st05.tag = '2026-12-01';
leer();
n = await Z.zusageErinnerung(tagMinus(st05.tag, 7));
check('neues Datum: Stufe 7 kommt noch einmal, mit dem neuen Termin', n === 1 && mails.length === 1 && /01\.12\.2026/.test(mails[0].betreff));
check('alte Schreibweise im Log (zusage:<id>:<stufe>) zaehlt als erledigt', (db.prepare('INSERT INTO mitteilung_log (schluessel, user_id, sent_at) VALUES (?, ?, ?)').run('zusage:st05:2', 'u_a', jetzt), (await Z.zusageErinnerung(tagMinus(st05.tag, 2))) === 0));
st05.tag = st05Tag;

/* Tabelle mit verschobenem Spiel: Meldung "ein Spiel verschoben", und das
   Nachholspiel bringt eine zweite Meldung (Schluessel zaehlt die Spiele). */
const rundeX = [
  { tag: '2026-12-09', heim: 'Treff ma nix', gast: 'Blink 180', einzel: '7:9', legs: '18:20' },
  { tag: '2026-12-09', heim: 'DCO', gast: 'Voodoo Darters', einzel: '8:8', legs: '19:19' },
  { tag: '2026-12-09', heim: 'TSV Oberpframmern', gast: 'd`Haberer 2', einzel: '10:6', legs: '21:15' },
  { tag: '2026-12-04', heim: 'FT Gern Darts II', gast: 'DCO', verschoben: true },
  { heim: 'TSV Dachau 1865 4', gast: null }
];
const ligaX = { liga: { team: 'Blink 180', sollSpieler: 4, termine: [{ id: 'st06', nr: 6, tag: '2026-12-09', heim: 'Treff ma nix', gast: 'Blink 180', ort: 'Fiakerstüberl' }] }, spieltage: { st06: rundeX }, teams: liga.teams, tabelleAus: liga.tabelleAus };
const ZX = erstelleMitteilungen({ db, mailer, push: fakePush, liga: ligaX, appUrl: 'https://darts.test' });
leer();
n = await ZX.tabelleNeu('2026-12-10');
check('3 von 4 gewertet: Tabelle geht raus und sagt, dass ein Spiel verschoben ist', n >= 1 && mails.length === 1 && /ist gewertet – ein Spiel ist verschoben/.test(mails[0].text) && !/komplett/.test(mails[0].text));
rundeX[3] = { tag: '2026-12-15', heim: 'FT Gern Darts II', gast: 'DCO', einzel: '9:7', legs: '20:17' };
leer();
n = await ZX.tabelleNeu('2026-12-16');
check('Nachholspiel gespielt: zweite Meldung, jetzt komplett', n >= 1 && mails.length === 1 && /komplett gewertet/.test(mails[0].text));
leer();
check('und danach nicht nochmal', (await ZX.tabelleNeu('2026-12-17')) === 0 && mails.length === 0);
Z.setze('u_a', 'tabelle', 'push');

/* Kasse, Konto, neues Mitglied, Testversand. */
leer();
await Z.kasseBuchung('u_b', { betrag: 2000, text: 'Beitrag', kategorie: 'Mitgliedsbeiträge', datum: '2026-10-30' }, 'Anna');
check('Kasse: Bert hat nur Push und kein Abo - nichts; Anna bekommt nichts, es ist Berts Buchung', mails.length === 0 && pushes.length === 0);
await Z.kasseBuchung('u_a', { betrag: 2000, text: 'Beitrag', kategorie: 'Mitgliedsbeiträge', datum: '2026-10-30' }, 'Bert');
check('Kasse: Anna per Push mit Betrag', pushes.length === 1 && /20,00 €/.test(pushes[0].n.titel));
await Z.kasseBuchung('u_a', { betrag: -500, text: 'Getränke', kategorie: 'Getränke', datum: '2026-10-30' }, 'Bert');
check('zwei Buchungen kurz nacheinander: eigene Push-Kennungen, keine ersetzt die andere', pushes.length === 2 && /^kasse-/.test(pushes[0].n.tag) && pushes[0].n.tag !== pushes[1].n.tag, JSON.stringify(pushes.map((p) => p.n.tag)));
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
check('Mitteilungen tragen die Rundmail-Kennung fuer den Mailer', mails.every((x) => x.mitteilung === true));

/* ---------- 3. Gleichzeitige Meldungen ---------- */
console.log('Mitteilungen: zwei iPads melden gleichzeitig');
/* Beim Ligaspiel pollen alle iPads das geteilte Turnier und melden den
   Anpfiff binnen Sekunden; der erste Versand dauert laenger. Der Mailer
   antwortet deshalb mit Verzoegerung, wie ein echter SMTP-Dialog. */
neu.run('u_c', 'c@beispiel.de', 'Carl', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 0);
neu.run('u_d', 'd@beispiel.de', 'Dora', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 0);
db.prepare('INSERT INTO push_abos (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run('u_c', 'https://push.example.org/carl', 'k', 'a', jetzt);
db.prepare('INSERT INTO push_abos (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)').run('u_d', 'https://push.example.org/dora', 'k', 'a', jetzt);
['u_a', 'u_b', 'u_c', 'u_d'].forEach((id) => Z.setze(id, 'live', 'beide'));
const sofort = mailer.sende;
mailer.sende = async (x) => { await new Promise((r) => setTimeout(r, 15)); mails.push(x); return { gesendet: true }; };
leer();
const live = { termin: 'st05', nr: 5, gegner: 'DCO', heim: true, ort: 'Bar Sehnsucht', link: 'https://darts.test/live.html#st05' };
const [n1, n2] = await Promise.all([Z.ereignis({ id: 'u_a' }, 'live', live), Z.ereignis({ id: 'u_b' }, 'live', live)]);
check('zwei parallele Anpfiffe, vier Konten: genau 4 Mails und 3 Pushes (Bert hat kein Abo), zusammen 4 Treffer', n1 + n2 === 4 && mails.length === 4 && pushes.length === 3 &&
  mails.map((x) => x.an[0]).sort().join() === 'a@beispiel.de,b@beispiel.de,c@beispiel.de,d@beispiel.de', JSON.stringify({ n1, n2, mails: mails.length, pushes: pushes.length }));
/* Scheitert jeder Weg, bleibt der Schluessel frei fuer den naechsten Versuch. */
mailer.sende = async () => { throw new Error('SMTP 451 spaeter nochmal'); };
const pushSofort = fakePush.sende;
fakePush.sende = async () => ({ ok: false, weg: false, status: 500 });
leer();
n = await Z.ereignis({ id: 'u_a' }, 'rekord', { art: 'Höchste Aufnahme', wert: 180, name: 'Bert' });
check('Mail und Push scheitern: 0 Treffer, kein Eintrag im Log', n === 0 && db.prepare("SELECT COUNT(*) AS n FROM mitteilung_log WHERE schluessel LIKE 'rekord:h-chste-aufnahme%'").get().n === 0);
mailer.sende = sofort; fakePush.sende = pushSofort;
n = await Z.ereignis({ id: 'u_a' }, 'rekord', { art: 'Höchste Aufnahme', wert: 180, name: 'Bert' });
check('naechster Versuch geht durch', n >= 2 && mails.length >= 1);

db.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(fehler ? '\n' + fehler + ' Fehler' : '\nAlle Mitteilungs-Tests bestanden');
process.exit(fehler ? 1 : 0);
