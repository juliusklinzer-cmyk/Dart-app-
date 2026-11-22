/*
 * Ein einzelnes Konto entfernen.
 *
 *   node server/scripts/konto-weg.mjs --mail tester@example.de
 *   node server/scripts/konto-weg.mjs --mail tester@example.de --wirklich
 *
 * Ohne --wirklich wird nur gezeigt, was passieren wuerde.
 *
 * Loescht wie der Knopf in der App (server/lib/konto-loeschen.mjs):
 * Stammdaten leer, Spiele ohne andere Konten weg, Spiele mit anderen
 * Konten bleiben und zeigen „Ehemaliges Mitglied“.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';
import { kontoLoeschen } from '../lib/konto-loeschen.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));

const args = process.argv.slice(2);
const wirklich = args.includes('--wirklich');
const i = args.indexOf('--mail');
const mail = i >= 0 ? String(args[i + 1] || '').trim().toLowerCase() : '';

if (!mail) {
  console.error('Bitte angeben, welches Konto weg soll:  --mail <e-mail>');
  process.exit(1);
}

const u = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
if (!u) {
  console.error('Kein Konto mit dieser E-Mail: ' + mail);
  process.exit(1);
}

const beteiligt = db.prepare('SELECT COUNT(*) c FROM game_players WHERE user_id = ?').get(u.id).c;
const eingetragen = db.prepare('SELECT COUNT(*) c FROM games WHERE recorded_by = ?').get(u.id).c;

console.log('Konto:    ' + u.display_name + ' <' + u.email + '> (' + u.status + ')');
console.log('Spiele:   beteiligt an ' + beteiligt + ', eingetragen ' + eingetragen);
console.log('Vorgehen: Stammdaten loeschen, Spiele ohne andere Konten weg, gemeinsame Spiele bleiben als „Ehemaliges Mitglied“');

if (!wirklich) {
  console.log('\nNichts geaendert. Zum Ausfuehren nochmal mit --wirklich.');
  db.close();
  process.exit(0);
}

const r = kontoLoeschen(db, u.id);
console.log('Spiele weg: ' + r.grabsteine + ', gemeinsame Spiele behalten: ' + r.geteilt + ', Kontozeile ' + (r.ganz ? 'geloescht' : 'geleert'));
console.log('\nFertig. Die Geraete raeumen das Profil beim naechsten Abgleich weg.');
db.close();
