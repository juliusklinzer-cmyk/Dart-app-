/*
 * Ein Konto zum Admin machen (oder die Rolle wieder nehmen). Der Admin holt
 * wie die Teamcaptains die Liga-Daten auf Knopfdruck (Liga-Tabelle,
 * POST /api/liga/aktualisieren). Migration 022 setzt Julius.
 *
 *   docker compose exec darts node server/scripts/admin.mjs julius@example.de
 *   docker compose exec darts node server/scripts/admin.mjs --aus julius@example.de
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const aus = args.indexOf('--aus') >= 0;
const email = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];
if (!email) {
  console.error('Aufruf: node server/scripts/admin.mjs [--aus] <email>');
  process.exit(1);
}
const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const u = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email.toLowerCase());
if (!u) { console.error(email + ': kein Konto mit dieser E-Mail.'); process.exit(1); }
db.prepare('UPDATE users SET admin = ? WHERE id = ?').run(aus ? 0 : 1, u.id);
console.log(u.display_name + ': ' + (aus ? 'ist kein Admin mehr' : 'ist jetzt Admin'));
