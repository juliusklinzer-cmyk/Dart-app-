/*
 * Testspieler anlegen – und wieder wegräumen.
 *
 *   node server/scripts/demo.mjs          sechs Testspieler anlegen
 *   node server/scripts/demo.mjs --weg    sie und alle ihre Spiele löschen
 *
 * Auf dem Server:
 *   docker compose -f compose.yml exec darts node server/scripts/demo.mjs
 *
 * Die Konten laufen alle auf @demo.blink180 – daran erkennt das Aufräumen
 * sie wieder, und niemand verwechselt sie mit einem echten Kollegen.
 * Passwort ist bei allen "demoabend2026".
 *
 * Angelegt wird direkt in der Datenbank, nicht über /api/register: die
 * Registrierung ist auf fünf pro Stunde gebremst, und diese Bremse ist
 * genau richtig – sie soll nicht für Testdaten aufgeweicht werden.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion, nextSeq } from '../lib/db.mjs';
import { hashPassword } from '../lib/password.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOMAIN = '@demo.blink180';
const PASSWORT = 'demoabend2026';

/* Farbtöne aus HUES in js/app.js, damit sie sich im Diagramm unterscheiden. */
const SPIELER = [
  { name: 'Michi', hue: 0 },
  { name: 'Basti', hue: 275 },
  { name: 'Flo', hue: 175 },
  { name: 'Sven', hue: 320 },
  { name: 'Nico', hue: 90 },
  { name: 'Kevin', hue: 25 }
];

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));

function alleDemo() {
  return db.prepare("SELECT id, display_name, email FROM users WHERE email LIKE ?").all('%' + DOMAIN);
}

if (process.argv.includes('--weg')) {
  const weg = alleDemo();
  if (!weg.length) {
    console.log('Keine Testspieler da.');
    process.exit(0);
  }
  transaktion(db, () => {
    for (const u of weg) {
      /* Spiele, an denen NUR Testspieler beteiligt waren, verschwinden mit.
         Spiele mit echten Mitspielern bekommen einen Grabstein, damit sie
         auch von deren Geräten wieder runtergehen. */
      const spiele = db
        .prepare('SELECT DISTINCT game_id FROM game_players WHERE user_id = ?')
        .all(u.id)
        .map((r) => r.game_id);
      for (const gid of spiele) {
        const g = db.prepare('SELECT deleted_at FROM games WHERE id = ?').get(gid);
        if (g && !g.deleted_at) {
          db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?')
            .run(new Date().toISOString(), nextSeq(db), gid);
        }
      }
      db.prepare('DELETE FROM games WHERE recorded_by = ?').run(u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }
  });
  console.log('Entfernt: ' + weg.map((u) => u.display_name).join(', '));
  db.close();
  process.exit(0);
}

const schon = alleDemo();
if (schon.length) {
  console.log('Es gibt schon Testspieler: ' + schon.map((u) => u.display_name).join(', '));
  console.log('Erst aufräumen mit: node server/scripts/demo.mjs --weg');
  process.exit(1);
}

const hash = hashPassword(PASSWORT);
transaktion(db, () => {
  for (const s of SPIELER) {
    db.prepare(
      'INSERT INTO users (id, email, display_name, password_hash, avatar, hue, status, created_at)' +
        " VALUES (?, ?, ?, ?, NULL, ?, 'aktiv', ?)"
    ).run(
      'u_' + randomBytes(9).toString('base64url'),
      s.name.toLowerCase() + DOMAIN,
      s.name,
      hash,
      s.hue,
      new Date().toISOString()
    );
  }
});

console.log('Angelegt: ' + SPIELER.map((s) => s.name).join(', '));
console.log('E-Mail:   <name>' + DOMAIN + '   Passwort: ' + PASSWORT);
console.log('\nBilder und Spielhistorie kommen mit: node tools/demo.mjs');
db.close();
