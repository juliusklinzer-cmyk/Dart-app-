/*
 * Wer gerade spielt oder zuletzt gespielt hat - ein Blick in die Server-DB,
 * ohne SQL zu tippen: offene Live-Spiele (mit Namen), offene geteilte
 * Turniere, die letzten gespeicherten Spiele und frische Anmeldungen.
 *
 *   docker compose exec darts node server/scripts/aktivitaet.mjs          # letzte 24 Stunden
 *   docker compose exec darts node server/scripts/aktivitaet.mjs 72       # letzte 72 Stunden
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stunden = Number(process.argv[2]) || 24;
const seit = new Date(Date.now() - stunden * 3600e3).toISOString();
const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));
const name = {};
db.prepare('SELECT id, display_name FROM users').all().forEach(function (u) { name[u.id] = u.display_name; });
function wann(iso) { return iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '?'; }

const live = db.prepare("SELECT id, status, created_by, created_at, updated_at FROM live_games WHERE status = 'offen' ORDER BY updated_at DESC").all();
console.log('Offene Live-Spiele: ' + live.length);
live.forEach(function (g) {
  const wer = db.prepare('SELECT user_id FROM live_game_players WHERE game_id = ?').all(g.id).map(function (p) { return name[p.user_id] || p.user_id; });
  console.log('  ' + wann(g.updated_at) + '  ' + wer.join(', ') + '  (angelegt ' + wann(g.created_at) + ' von ' + (name[g.created_by] || '?') + ')');
});

const turniere = db.prepare("SELECT id, created_by, created_at FROM tournaments WHERE status = 'offen' ORDER BY created_at DESC").all();
console.log('Offene geteilte Turniere: ' + turniere.length);
turniere.forEach(function (t) { console.log('  ' + wann(t.created_at) + '  von ' + (name[t.created_by] || '?')); });

const spiele = db.prepare('SELECT kind, recorded_by, created_at FROM games WHERE deleted_at IS NULL AND created_at > ? ORDER BY created_at DESC').all(seit);
console.log('Gespeicherte Spiele in den letzten ' + stunden + ' h: ' + spiele.length);
spiele.slice(0, 20).forEach(function (s) { console.log('  ' + wann(s.created_at) + '  ' + s.kind + '  von ' + (name[s.recorded_by] || '?')); });

const sitzungen = db.prepare('SELECT user_id, created_at FROM sessions WHERE created_at > ? ORDER BY created_at DESC').all(seit);
console.log('Neue Anmeldungen in den letzten ' + stunden + ' h: ' + sitzungen.length);
sitzungen.slice(0, 20).forEach(function (s) { console.log('  ' + wann(s.created_at) + '  ' + (name[s.user_id] || '?')); });
db.close();
