/*
 * Ein Konto restlos loeschen -- gedacht fuer Testkonten:
 *
 *   docker compose exec darts node server/scripts/konto-loeschen.mjs mail@example.de
 *
 * Verweigert, wenn an dem Konto noch aktive (nicht zurueckgezogene) Spiele
 * haengen: erst die Spiele mit spiel-zurueckziehen.mjs wegräumen, dann das
 * Konto. So verschwindet nichts aus der Statistik, ohne dass es jemand
 * gemerkt haette.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [email] = process.argv.slice(2);

if (!email) {
  console.error('Aufruf: node server/scripts/konto-loeschen.mjs <e-mail>');
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const u = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email.trim().toLowerCase());
if (!u) {
  console.error('Kein Konto fuer diese E-Mail.');
  process.exit(1);
}

const aktive = db.prepare(
  'SELECT COUNT(*) n FROM game_players gp JOIN games g ON g.id = gp.game_id ' +
  'WHERE gp.user_id = ? AND g.deleted_at IS NULL'
).get(u.id).n;
if (aktive > 0) {
  console.error(u.display_name + ' hat noch ' + aktive + ' aktive Spiele. ' +
    'Erst mit spiel-zurueckziehen.mjs wegraeumen, dann das Konto loeschen.');
  process.exit(1);
}

transaktion(db, function () {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM liga_zusagen WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM game_players WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM tournament_players WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
});
console.log('Konto geloescht: ' + email + ' (' + u.display_name + ')');
db.close();
