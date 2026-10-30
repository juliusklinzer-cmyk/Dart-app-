/*
 * Mailversand: MIME-Aufbau, der SMTP-Dialog gegen einen eigenen Mini-Server
 * (ohne TLS, nur im Test) und die Erinnerungs-Mails vor dem Spieltag mit
 * einem Mailer, der nur mitschreibt.
 *
 *   node tests/mail.mjs
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mimeBauen, smtpSenden, erstelleMailer, adresse, kodiereKopf, istAdresse } from '../server/lib/mail.mjs';
import { ladeLigaDaten } from '../server/lib/liga.mjs';
import { openDb } from '../server/lib/db.mjs';
import { createApi } from '../server/api.mjs';
import { hashPassword } from '../server/lib/password.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fehler = 0;
function check(name, ok, extra) { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || !extra ? '' : ' ' + extra)); if (!ok) fehler++; }

/* ---------- 1. Adressen, Kopfzeilen, MIME ---------- */
console.log('Mail: Adressen und MIME');
check('Name und Adresse werden getrennt', JSON.stringify(adresse('Blink 180 <Blink180@wirtschaftln.de>')) === JSON.stringify({ name: 'Blink 180', adresse: 'blink180@wirtschaftln.de' }));
check('nackte Adresse bleibt', adresse('dart@wirtschaftln.de').adresse === 'dart@wirtschaftln.de' && adresse('dart@wirtschaftln.de').name === '');
check('Adressform', istAdresse('a.b@c.de') && !istAdresse('kein@mail') && !istAdresse('x y@z.de'));
check('ASCII-Betreff bleibt, Umlaute werden RFC-2047-kodiert', kodiereKopf('Spielbericht 3') === 'Spielbericht 3' && /^=\?UTF-8\?B\?.+\?=$/.test(kodiereKopf('Grüße')));
const pdf = Buffer.from('%PDF-1.4 test');
const mime = mimeBauen({ von: 'Blink 180 <blink180@wirtschaftln.de>', an: ['liga@beispiel.de', 'TC <tc@beispiel.de>'], cc: ['blink180@wirtschaftln.de'], antwortAn: 'blink180@wirtschaftln.de',
  betreff: 'Spielbericht 3. Spieltag: Voodoo Darters – Blink 180', text: 'Hallo,\n\nanbei der Bericht.\n\nViele Grüße\nBlink 180', anhaenge: [{ name: 'Spielbericht_Spieltag3 Voodoo.pdf', typ: 'application/pdf', inhalt: pdf }], id: 'test123' });
check('Kopf: From, To mit zwei Empfaengern, Cc, Reply-To, Message-ID', /^From: Blink 180 <blink180@wirtschaftln.de>\r\n/.test(mime) && /\r\nTo: liga@beispiel.de, TC <tc@beispiel.de>\r\n/.test(mime) && /\r\nCc: blink180@wirtschaftln.de\r\n/.test(mime) && /\r\nReply-To: blink180@wirtschaftln.de\r\n/.test(mime) && /Message-ID: <test123@wirtschaftln.de>/.test(mime));
check('Betreff mit Gedankenstrich ist kodiert', /\r\nSubject: =\?UTF-8\?B\?/.test(mime));
const grenze = /boundary="([^"]+)"/.exec(mime)[1];
check('multipart/mixed mit Text und PDF-Anhang, Abschluss-Grenze', mime.split('--' + grenze + '\r\n').length === 3 && mime.endsWith('--' + grenze + '--\r\n') &&
  /Content-Type: application\/pdf; name="Spielbericht_Spieltag3_Voodoo.pdf"/.test(mime) && /Content-Disposition: attachment; filename="Spielbericht_Spieltag3_Voodoo.pdf"/.test(mime));
check('Text ist Base64 und kommt lesbar zurueck', Buffer.from(/text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+\/=\r\n]+)/.exec(mime)[1].replace(/\r\n/g, ''), 'base64').toString('utf8').includes('Viele Grüße'));
check('Anhang ist Base64 des PDFs', mime.includes(pdf.toString('base64')));
check('nur CRLF als Zeilenende', !/[^\r]\n/.test(mime));

/* ---------- 2. SMTP-Dialog gegen einen Mini-Server ---------- */
console.log('Mail: SMTP-Dialog');
const protokoll = [];
let empfangen = '';
const smtp = net.createServer(function (s) {
  let daten = false;
  s.write('220 test.local ESMTP\r\n');
  let rest = '';
  s.on('data', function (d) {
    rest += d.toString('utf8');
    let i;
    while ((i = rest.indexOf('\r\n')) >= 0) {
      const zeile = rest.slice(0, i); rest = rest.slice(i + 2);
      if (daten) {
        if (zeile === '.') { daten = false; s.write('250 2.0.0 Ok: queued as ABC123\r\n'); }
        else empfangen += zeile + '\r\n';
        continue;
      }
      protokoll.push(zeile);
      if (/^EHLO /.test(zeile)) s.write('250-test.local\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
      else if (zeile === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
      else if (zeile === Buffer.from('brevo-user').toString('base64')) s.write('334 UGFzc3dvcmQ6\r\n');
      else if (zeile === Buffer.from('geheim').toString('base64')) s.write('235 2.7.0 Authentication successful\r\n');
      else if (/^MAIL FROM:/.test(zeile)) s.write('250 2.1.0 Ok\r\n');
      else if (/^RCPT TO:/.test(zeile)) s.write('250 2.1.5 Ok\r\n');
      else if (zeile === 'DATA') { daten = true; s.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
      else if (zeile === 'QUIT') { s.write('221 Bye\r\n'); s.end(); }
      else s.write('500 unbekannt\r\n');
    }
  });
});
await new Promise(function (r) { smtp.listen(0, '127.0.0.1', r); });
const port = smtp.address().port;
const r1 = await smtpSenden({ host: '127.0.0.1', port: port, starttls: false, user: 'brevo-user', pass: 'geheim', von: 'blink180@wirtschaftln.de', an: ['a@beispiel.de', 'b@beispiel.de'],
  daten: 'Subject: Test\r\n\r\nZeile 1\n.Punktzeile\nEnde' });
check('Dialog: EHLO, AUTH LOGIN mit Base64, MAIL FROM, zwei RCPT TO, DATA, QUIT', protokoll.join('|') === ['EHLO darts.wirtschaftln.de', 'AUTH LOGIN', Buffer.from('brevo-user').toString('base64'), Buffer.from('geheim').toString('base64'),
  'MAIL FROM:<blink180@wirtschaftln.de>', 'RCPT TO:<a@beispiel.de>', 'RCPT TO:<b@beispiel.de>', 'DATA', 'QUIT'].join('|'), protokoll.join('|'));
check('Daten: LF wird CRLF, Punktzeile verdoppelt, Antwort kommt zurueck', empfangen === 'Subject: Test\r\n\r\nZeile 1\r\n..Punktzeile\r\nEnde\r\n' && /queued as ABC123/.test(r1.antwort), JSON.stringify(empfangen));
let tlsFehler = null;
try { await smtpSenden({ host: '127.0.0.1', port: port, user: 'x', pass: 'y', von: 'a@b.de', an: ['c@d.de'], daten: 'x' }); } catch (e) { tlsFehler = e; }
check('ohne STARTTLS-Angebot bricht der Versand ab (nie Klartext zu Brevo)', !!tlsFehler && /STARTTLS/.test(tlsFehler.message));
const m2 = erstelleMailer({ user: 'brevo-user', key: 'geheim', host: '127.0.0.1', port: port, starttls: false });
protokoll.length = 0; empfangen = '';
const r2 = await m2.sende({ von: 'liga', an: ['tc@beispiel.de'], cc: ['blink180@wirtschaftln.de'], betreff: 'Hallo', text: 'Text' });
check('Mailer: Absender liga, Empfaenger plus Cc im Umschlag, Antwort gesendet', r2.gesendet && protokoll.includes('MAIL FROM:<blink180@wirtschaftln.de>') && protokoll.includes('RCPT TO:<tc@beispiel.de>') && protokoll.includes('RCPT TO:<blink180@wirtschaftln.de>') && /^From: Blink 180 <blink180@wirtschaftln.de>/m.test(empfangen));
const m3 = erstelleMailer({});
const r3 = await m3.sende({ von: 'app', an: ['x@beispiel.de'], betreff: 'Nichts', text: '' });
check('ohne Zugangsdaten: nicht bereit, Mail wird verworfen statt zu scheitern', !m3.bereit && r3.gesendet === false);
smtp.close();

/* ---------- 3. Erinnerungen vor dem Spieltag ---------- */
console.log('Mail: Erinnerungen vor dem Spieltag');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-mail-'));
const db = openDb(path.join(tmp, 't.db'));
const gesendet = [];
const fake = { bereit: true, absender: { liga: 'Blink 180 <blink180@wirtschaftln.de>', app: 'Dart-App <dart@wirtschaftln.de>' }, sende: async function (m) { gesendet.push(m); return { gesendet: true, id: 'x' }; } };
const liga = ladeLigaDaten(ROOT);
check('Liga-Daten laden im Server (18 Termine)', !!liga && liga.liga.termine.length === 18);
const api = createApi(db, { secureCookies: false, mailer: fake, liga: liga, appUrl: 'https://darts.test' });
const jetzt = new Date().toISOString();
const neu = db.prepare('INSERT INTO users (id, email, display_name, password_hash, hue, status, created_at, gast_konto, test, mail_erinnerung) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)');
neu.run('u_a', 'a@beispiel.de', 'Anna', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 1);
neu.run('u_b', 'b@beispiel.de', 'Bert', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 1);
neu.run('u_c', 'c@beispiel.de', 'Carl', hashPassword('pw'), 'aktiv', jetzt, 0, 0, 0);   // abbestellt
neu.run('u_d', 'd@beispiel.de', 'Dora', hashPassword('pw'), 'aktiv', jetzt, 1, 0, 1);   // Gast-Konto
neu.run('u_e', 'e@beispiel.de', 'Emil', hashPassword('pw'), 'gesperrt', jetzt, 0, 0, 1);
/* Carl hat die Mail abbestellt: seit der Mitteilungszentrale (018) ist das das
   Thema "Zusage" nur als Push - und ohne Push-Abo kommt dann nichts. */
api.mitteilungen.setze('u_c', 'zusage', 'push');
const st04 = liga.liga.termine.find((t) => t.id === 'st04');
db.prepare('INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?)').run('st04', 'u_b', jetzt, 'dabei');
const tagMinus = (iso, tage) => new Date(Date.parse(iso + 'T12:00:00Z') - tage * 86400e3).toISOString().slice(0, 10);
/* Der 4. Spieltag (10.11.) liegt frei: der 3. ist 15 Tage davor, der 5. 14 danach -
   so faellt kein anderer Spieltag in die Fenster. */
let n = await api.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 9));
check('9 Tage vorher: nichts', n === 0 && gesendet.length === 0);
n = await api.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 7));
check('7 Tage vorher (Stufe 7): nur Anna - Bert hat zugesagt, Carl abbestellt, Dora Gast, Emil gesperrt', n === 1 && gesendet.length === 1 && gesendet[0].an[0] === 'a@beispiel.de' && gesendet[0].von === 'liga');
check('die Mail nennt Spieltag, Gegner, Datum, Link und den Stand der Zusagen', /4\. Spieltag/.test(gesendet[0].betreff) && /d`Haberer 2/.test(gesendet[0].text) && /https:\/\/darts\.test/.test(gesendet[0].text) && /Bisher dabei: 1 von 4/.test(gesendet[0].text) && /Anna/.test(gesendet[0].text));
n = await api.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 6));
check('am naechsten Tag nicht nochmal (mail_log)', n === 0 && gesendet.length === 1);
n = await api.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 2));
check('2 Tage vorher (Stufe 2): Anna noch einmal', n === 1 && gesendet.length === 2 && /2 Tagen/.test(gesendet[1].text));
db.prepare('INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?)').run('st05', 'u_a', jetzt, 'dabei');
n = await api.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 1));
check('1 Tag vorher: Stufe 2 schon erledigt, nichts mehr', n === 0);
const ohneMailer = createApi(db, { secureCookies: false, mailer: { bereit: false }, liga: liga });
check('ohne eingerichteten Mailer passiert nichts', (await ohneMailer.mitteilungen.zusageErinnerung(tagMinus(st04.tag, 7))) === 0);
db.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }

console.log(fehler ? '\n' + fehler + ' Fehler' : '\nAlle Mail-Tests bestanden');
process.exit(fehler ? 1 : 0);
