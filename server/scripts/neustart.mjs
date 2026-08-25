/*
 * Sauberer Start vor dem ersten echten Abend.
 *
 *   node server/scripts/neustart.mjs --behalte julius.klinzer@outlook.de
 *   node server/scripts/neustart.mjs --behalte <mail> --wirklich
 *
 * Ohne --wirklich wird nur gezeigt, was passieren wuerde. Loeschen ist nicht
 * rueckgaengig zu machen, also soll man es zweimal tippen muessen.
 *
 * Was passiert:
 *  - Jedes Spiel bekommt einen Grabstein. Nicht geloescht, sondern als
 *    geloescht markiert: nur so erfahren die Geraete beim naechsten Abgleich
 *    davon und raeumen ihre eigene Historie mit auf. Ein hartes DELETE
 *    wuerde die Spiele auf jedem iPad stehen lassen.
 *  - Geteilte Turniere fliegen ganz raus; sie haben keine Grabsteine, aber
 *    ein Geraet fragt sie nur nach, solange es selbst eines fuehrt.
 *  - Alle Konten ausser dem behaltenen werden stillgelegt (status), nicht
 *    geloescht: die Grabsteine verweisen noch auf sie. Stillgelegt heisst,
 *    sie koennen sich nicht mehr anmelden und stehen in keinem Kader mehr.
 *  - Das behaltene Konto bleibt vollstaendig: Name, Bild, Lieblingsdoppel.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion, nextSeq } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));

const args = process.argv.slice(2);
const wirklich = args.includes('--wirklich');
const i = args.indexOf('--behalte');
const behalten = i >= 0 ? String(args[i + 1] || '').trim().toLowerCase() : '';

if (!behalten) {
  console.error('Bitte angeben, wessen Konto bleibt:  --behalte <e-mail>');
  process.exit(1);
}

const bleibt = db.prepare('SELECT * FROM users WHERE email = ?').get(behalten);
if (!bleibt) {
  console.error('Kein Konto mit dieser E-Mail: ' + behalten);
  console.error('Vorhanden: ' + db.prepare('SELECT email FROM users').all().map((u) => u.email).join(', '));
  process.exit(1);
}

const andere = db.prepare("SELECT * FROM users WHERE id != ? AND status = 'aktiv'").all(bleibt.id);
const spiele = db.prepare('SELECT COUNT(*) c FROM games WHERE deleted_at IS NULL').get().c;
const turniere = db.prepare('SELECT COUNT(*) c FROM tournaments').get().c;

console.log('Bleibt:      ' + bleibt.display_name + ' <' + bleibt.email + '>');
console.log('Stillgelegt: ' + (andere.map((u) => u.display_name).join(', ') || '–'));
console.log('Spiele:      ' + spiele + ' bekommen einen Grabstein');
console.log('Turniere:    ' + turniere + ' werden entfernt');

if (!wirklich) {
  console.log('\nNichts geaendert. Zum Ausfuehren nochmal mit --wirklich.');
  db.close();
  process.exit(0);
}

transaktion(db, () => {
  const jetzt = new Date().toISOString();

  /* Grabsteine statt DELETE: jeder Grabstein bekommt eine neue Sequenz und
     erreicht damit jedes Geraet, das seit dem letzten Abgleich zusieht. */
  for (const g of db.prepare('SELECT id FROM games WHERE deleted_at IS NULL').all()) {
    db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?').run(jetzt, nextSeq(db), g.id);
  }

  db.prepare('DELETE FROM tournament_matches').run();
  db.prepare('DELETE FROM tournament_players').run();
  db.prepare('DELETE FROM tournaments').run();

  for (const u of andere) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    db.prepare("UPDATE users SET status = 'stillgelegt' WHERE id = ?").run(u.id);
  }
});

console.log('\nFertig. Die Geraete raeumen ihre Historie beim naechsten Abgleich selbst auf.');
db.close();
