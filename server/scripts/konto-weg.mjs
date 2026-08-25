/*
 * Ein einzelnes Konto entfernen.
 *
 *   node server/scripts/konto-weg.mjs --mail tester@example.de
 *   node server/scripts/konto-weg.mjs --mail tester@example.de --wirklich
 *
 * Ohne --wirklich wird nur gezeigt, was passieren wuerde.
 *
 * Wie geloescht wird, haengt daran, ob an dem Konto Spiele haengen:
 *  - keine Spiele  -> das Konto verschwindet ganz.
 *  - mit Spielen   -> seine Spiele bekommen Grabsteine (damit sie auch von
 *                     den Geraeten der Mitspieler runtergehen), und das
 *                     Konto wird stillgelegt statt geloescht: die Grabsteine
 *                     verweisen noch darauf.
 *
 * Stillgelegt heisst in beiden Faellen: keine Anmeldung mehr, in keinem
 * Kader mehr, und die Geraete raeumen das Profil beim naechsten Abgleich weg.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion, nextSeq } from '../lib/db.mjs';

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
  console.error('Vorhanden: ' + db.prepare('SELECT email FROM users').all().map((x) => x.email).join(', '));
  process.exit(1);
}

const beteiligt = db.prepare('SELECT COUNT(*) c FROM game_players WHERE user_id = ?').get(u.id).c;
const eingetragen = db.prepare('SELECT COUNT(*) c FROM games WHERE recorded_by = ?').get(u.id).c;
const hartWeg = beteiligt === 0 && eingetragen === 0;

console.log('Konto:    ' + u.display_name + ' <' + u.email + '> (' + u.status + ')');
console.log('Spiele:   beteiligt an ' + beteiligt + ', eingetragen ' + eingetragen);
console.log('Vorgehen: ' + (hartWeg ? 'komplett entfernen' : 'Spiele mit Grabstein, Konto stilllegen'));

if (!wirklich) {
  console.log('\nNichts geaendert. Zum Ausfuehren nochmal mit --wirklich.');
  db.close();
  process.exit(0);
}

transaktion(db, () => {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM tournament_players WHERE user_id = ?').run(u.id);

  if (hartWeg) {
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    return;
  }

  const jetzt = new Date().toISOString();
  const spiele = db
    .prepare(
      'SELECT DISTINCT g.id FROM games g LEFT JOIN game_players p ON p.game_id = g.id' +
        ' WHERE g.deleted_at IS NULL AND (g.recorded_by = ? OR p.user_id = ?)'
    )
    .all(u.id, u.id);
  for (const g of spiele) {
    db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?').run(jetzt, nextSeq(db), g.id);
  }
  db.prepare("UPDATE users SET status = 'stillgelegt' WHERE id = ?").run(u.id);
});

console.log('\nFertig. Die Geraete raeumen das Profil beim naechsten Abgleich weg.');
db.close();
