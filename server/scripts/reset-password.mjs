/*
 * Passwort eines Kollegen zuruecksetzen. Wir verschicken keine Mails, deshalb
 * laeuft "Passwort vergessen" ueber dich:
 *
 *   docker compose exec darts-app node scripts/reset-password.mjs mail@example.de neuesPasswort
 *
 * Alle Geraete dieses Kontos werden dabei abgemeldet.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion } from '../lib/db.mjs';
import { hashPassword, checkPassword } from '../lib/password.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [email, passwort] = process.argv.slice(2);

if (!email || !passwort) {
  console.error('Aufruf: node scripts/reset-password.mjs <e-mail> <neues-passwort>');
  process.exit(1);
}

const schwach = checkPassword(passwort);
if (schwach) {
  console.error(schwach);
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const u = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email.trim().toLowerCase());
if (!u) {
  console.error('Kein Account mit dieser E-Mail.');
  process.exit(1);
}

transaktion(db, function () {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(passwort), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
});

console.log('Passwort fuer ' + u.display_name + ' gesetzt. Alle Geraete wurden abgemeldet.');
db.close();
