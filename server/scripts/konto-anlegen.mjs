/*
 * Ein Konto direkt anlegen -- z. B. Testkonten, ohne den Einladungscode
 * durch die App zu tragen:
 *
 *   docker compose exec darts node server/scripts/konto-anlegen.mjs mail@example.de "Anzeigename" passwort
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';
import { hashPassword, checkPassword } from '../lib/password.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [email, name, passwort] = process.argv.slice(2);

if (!email || !name || !passwort) {
  console.error('Aufruf: node server/scripts/konto-anlegen.mjs <e-mail> <anzeigename> <passwort>');
  process.exit(1);
}
const schwach = checkPassword(passwort);
if (schwach) {
  console.error(schwach);
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const mail = email.trim().toLowerCase();
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) {
  console.error('Fuer ' + mail + ' gibt es schon ein Konto.');
  process.exit(1);
}
const id = 'u_' + randomBytes(9).toString('base64url');
db.prepare(
  'INSERT INTO users (id, email, display_name, password_hash, avatar, hue, status, created_at)' +
  " VALUES (?, ?, ?, ?, NULL, ?, 'aktiv', ?)"
).run(id, mail, String(name).trim(), hashPassword(passwort), Math.floor(Math.random() * 360), new Date().toISOString());
console.log('Konto angelegt: ' + mail + ' (' + name + ', ' + id + ')');
db.close();
