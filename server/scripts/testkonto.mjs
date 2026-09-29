/*
 * Ein Konto als Testkonto markieren -- oder festlegen, wer Testkonten sehen
 * darf. Testkonten sind zum Ausprobieren nach einem Deploy da: ihre Spiele
 * bekommt nur, wer sie sehen darf, und auf dessen Geraet zaehlen sie in
 * keine Statistik (Rangliste, Rekorde, Diagramm, Spieleliste).
 *
 *   docker compose exec darts node server/scripts/testkonto.mjs test3@blink180.de
 *   docker compose exec darts node server/scripts/testkonto.mjs --sieht kollege@example.de
 *   docker compose exec darts node server/scripts/testkonto.mjs --aus test3@blink180.de
 *
 * Bisherige Spiele des Kontos werden dabei NICHT zurueckgezogen -- dafuer
 * gibt es spiel-zurueckziehen.mjs. Die beiden Konten "Test Eins" und
 * "Test Zwei" hat Migration 009 bereits markiert und ihre Spiele geloescht.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const sieht = args.indexOf('--sieht') >= 0;
const aus = args.indexOf('--aus') >= 0;
const email = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];

if (!email) {
  console.error('Aufruf: node server/scripts/testkonto.mjs [--sieht] [--aus] <email>');
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const u = db.prepare('SELECT id, display_name, test, sieht_test FROM users WHERE email = ?').get(email.toLowerCase());
if (!u) {
  console.error(email + ': kein Konto mit dieser E-Mail.');
  process.exit(1);
}
const spalte = sieht ? 'sieht_test' : 'test';
db.prepare('UPDATE users SET ' + spalte + ' = ? WHERE id = ?').run(aus ? 0 : 1, u.id);
console.log(u.display_name + ' (' + u.id + '): ' +
  (sieht ? (aus ? 'sieht Testkonten nicht mehr' : 'sieht Testkonten jetzt') : (aus ? 'ist kein Testkonto mehr' : 'ist jetzt ein Testkonto')));
