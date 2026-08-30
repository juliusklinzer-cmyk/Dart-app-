/*
 * Spiele vom Server zurueckziehen -- z. B. Testdaten, die beim Ausprobieren
 * entstanden sind. Derselbe Soft-Delete wie DELETE /api/games/:id: das Spiel
 * bekommt deleted_at und eine neue seq, und die Geraete raeumen es beim
 * naechsten Abgleich von selbst aus ihrer Historie.
 *
 *   docker compose exec darts node server/scripts/spiel-zurueckziehen.mjs <spiel-id> [...]
 *
 * Die Spiel-Ids stehen z. B. in der Ausgabe von GET /api/games oder direkt
 * in der games-Tabelle. Nichts wird hart geloescht -- ein Rueckzieher
 * liesse sich notfalls per SQL wieder aufheben (deleted_at auf NULL).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion, nextSeq } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ids = process.argv.slice(2).filter(function (x) { return /^[A-Za-z0-9_-]{4,64}$/.test(x); });

if (!ids.length) {
  console.error('Aufruf: node server/scripts/spiel-zurueckziehen.mjs <spiel-id> [...]');
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));

for (const id of ids) {
  const g = db.prepare('SELECT id, kind, deleted_at FROM games WHERE id = ?').get(id);
  if (!g) {
    console.log(id + ': nicht gefunden');
    continue;
  }
  if (g.deleted_at) {
    console.log(id + ': war schon zurueckgezogen');
    continue;
  }
  transaktion(db, function () {
    db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?')
      .run(new Date().toISOString(), nextSeq(db), id);
  });
  console.log(id + ' (' + g.kind + '): zurueckgezogen');
}

db.close();
