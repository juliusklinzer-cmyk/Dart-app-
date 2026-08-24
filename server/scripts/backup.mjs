/*
 * Sicherung der Datenbank.
 *
 * SQLite laeuft im WAL-Modus -- die Datei roh zu kopieren ergibt im
 * ungluecklichen Moment einen kaputten Stand. Deshalb ueber VACUUM INTO:
 * das schreibt eine in sich geschlossene, konsistente Kopie, auch waehrend
 * gerade jemand ein Turnier hochlaedt.
 *
 * Aufruf auf dem Server (per Cron):
 *   docker compose exec -T app node server/scripts/backup.mjs
 *
 * Es bleiben die letzten 14 Staende unter /data/backups liegen.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const QUELLE = process.env.DARTS_DB || '/data/darts.db';
const ZIEL_ORDNER = process.env.DARTS_BACKUP_DIR || path.join(path.dirname(QUELLE), 'backups');
const BEHALTEN = 14;

if (!fs.existsSync(QUELLE)) {
  console.error('Keine Datenbank unter ' + QUELLE);
  process.exit(1);
}

fs.mkdirSync(ZIEL_ORDNER, { recursive: true });

const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ziel = path.join(ZIEL_ORDNER, 'darts-' + stempel + '.db');

const db = new DatabaseSync(QUELLE, { readOnly: true });
try {
  // Einfache Anfuehrungszeichen: der Pfad ist ein SQL-Literal.
  db.exec("VACUUM INTO '" + ziel.replace(/'/g, "''") + "'");
} finally {
  db.close();
}

const groesse = Math.round(fs.statSync(ziel).size / 1024);
console.log('Sicherung geschrieben: ' + ziel + ' (' + groesse + ' KB)');

/* Alte Staende wegraeumen -- sonst laeuft irgendwann das Volume voll. */
const alte = fs
  .readdirSync(ZIEL_ORDNER)
  .filter((f) => /^darts-.*\.db$/.test(f))
  .sort();
while (alte.length > BEHALTEN) {
  const weg = alte.shift();
  fs.unlinkSync(path.join(ZIEL_ORDNER, weg));
  console.log('Alte Sicherung entfernt: ' + weg);
}
