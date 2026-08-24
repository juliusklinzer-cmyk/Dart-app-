/*
 * SQLite-Verbindung und Migrationen.
 *
 * Wir nehmen `node:sqlite` -- SQLite ist seit Node 22.5 eingebaut. Damit hat
 * der Server, genau wie die App selbst, KEINE einzige Laufzeit-Abhaengigkeit:
 * nichts zu kompilieren, keine Build-Tools im Docker-Image, kein
 * npm-Audit-Karussell. Preis dafuer: es braucht Node >= 22 (wir pinnen
 * node:24-alpine im Dockerfile).
 *
 * Migrationen laufen beim Start, jede Datei genau einmal, Bookkeeping in
 * `migrations` -- gleiches Vorgehen wie bei Wirtschaftln.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL: gleichzeitiges Lesen waehrend eines Schreibvorgangs. Wichtig, weil
  // sonst der Sync mehrerer Geraete aufeinander wartet.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Ohne busy_timeout wirft SQLite bei paralleler Schreiblast sofort SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM migrations').all().map((r) => r.name));
  const dir = path.join(ROOT, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Migration und ihr Eintrag in einer Transaktion: ein Abbruch mittendrin
    // darf keine halb angewandte Migration als "erledigt" zuruecklassen.
    transaktion(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });
    console.log('Migration angewandt: ' + file);
  }
}

/*
 * Transaktions-Helfer. `node:sqlite` bringt anders als better-sqlite3 keinen
 * eigenen mit, also von Hand -- inklusive Rollback im Fehlerfall.
 *
 * Bewusst ohne Verschachtelung: alles hier ist eine flache Operation, und ein
 * halbherziges SAVEPOINT-Konstrukt waere mehr Risiko als Nutzen.
 */
export function transaktion(db, fn) {
  db.exec('BEGIN');
  try {
    const wert = fn();
    db.exec('COMMIT');
    return wert;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackFehler) {
      // Wenn schon das Rollback scheitert, ist die Verbindung hin -- den
      // urspruenglichen Fehler trotzdem nach oben geben, der ist der wichtige.
    }
    throw e;
  }
}

/* Naechster Sync-Cursor. Steigt bei Einfuegen UND bei Loeschen. */
export function nextSeq(db) {
  return db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'game_seq' RETURNING value").get().value;
}
