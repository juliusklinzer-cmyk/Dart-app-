/*
 * Alle Mitteilungs-Themen einmal als Beispiel an ein Konto schicken - Mail
 * und Push, unabhaengig von dessen Einstellungen -, um das Design der Mails
 * anzusehen. Den Knopf dafuer gab es bis 30.10.2026 in der App unter
 * Benachrichtigungen; weg, weil ihn nur Julius braucht und die Spieler
 * nichts testen muessen.
 *
 *   docker compose exec darts node server/scripts/beispiele.mjs julius@example.de
 *
 * Jede Mail steht mit Brevos Antwort im Log, ein Fehler mit Grund.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';
import { erstelleDienste } from '../lib/dienste.mjs';
import { erstelleMitteilungen } from '../lib/mitteilungen.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const email = process.argv[2];
if (!email) {
  console.error('Aufruf: node server/scripts/beispiele.mjs <email>');
  process.exit(1);
}
const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const u = db.prepare('SELECT id, email, display_name FROM users WHERE email = ?').get(email.toLowerCase());
if (!u) { console.error(email + ': kein Konto mit dieser E-Mail.'); process.exit(1); }
const d = erstelleDienste(process.env, path.dirname(SERVER_DIR));
if (!d.mailer.bereit && !d.push.bereit) { console.error('Weder Mail noch Push sind eingerichtet (.env).'); process.exit(1); }
const z = erstelleMitteilungen({ db: db, mailer: d.mailer, push: d.push, liga: d.liga, appUrl: d.appUrl });
const n = await z.testAlle(u);
console.log(n + ' von ' + z.THEMEN.length + ' Beispielen an ' + u.display_name + ' (' + u.email + ') raus.');
db.close();
