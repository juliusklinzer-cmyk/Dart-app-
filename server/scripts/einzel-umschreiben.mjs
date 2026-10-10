/*
 * Ein gespieltes Einzel nachtraeglich einem anderen Spieler zuschreiben --
 * fuer den Fall, dass am Abend ein Wechsel nicht eingetragen wurde und das
 * Einzel im Archiv am falschen Mann haengt (1. Spieltag 06.10.2026: H4 - G1
 * spielte der eingewechselte H5).
 *
 *   docker compose exec darts node server/scripts/einzel-umschreiben.mjs <spiel-id> <einzel-id> <alt> <neu> [--ja]
 *
 * <alt> und <neu> sind Konto-Ids (u_...) oder Anzeigenamen (ohne Gross/
 * Kleinschreibung, auch ein Teil reicht, solange er eindeutig ist).
 * Ohne --ja wird nur gezeigt, was passieren wuerde.
 *
 * Was passiert (in einer Transaktion):
 *   - im Archiv-Spiel (games.payload) wird das Einzel umgeschrieben: Spieler,
 *     Anwurf, Sieger und jede Aufnahme des alten Spielers gehoeren dem neuen;
 *   - der neue steht in Aufstellung (lineup), Bogen-Listen (liga.wir/sie,
 *     heimSpieler/gastSpieler) und Namensliste (namen) -- hinter dem alten,
 *     der seine anderen Einzel behaelt;
 *   - stand steigt um 1 und das Spiel bekommt eine neue seq: die Geraete
 *     uebernehmen die Korrektur beim naechsten Abgleich (js/app.js,
 *     uebernehmeSpiele). Bericht und Unterschriften bleiben dort unberuehrt;
 *   - der neue kommt in game_players, damit das Spiel auch auf seinem
 *     Geraet landet;
 *   - liegt dasselbe Ergebnis noch in tournament_matches, wird es ebenso
 *     umgeschrieben, damit nichts Altes zurueckkommt.
 *
 * Nichts wird geloescht. Vorher ein Backup: node server/scripts/backup.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaktion, nextSeq, zaehler } from '../lib/db.mjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const ja = args.includes('--ja');
const [spielId, einzelId, altArg, neuArg] = args.filter((a) => a !== '--ja');

if (!spielId || !einzelId || !altArg || !neuArg) {
  console.error('Aufruf: node server/scripts/einzel-umschreiben.mjs <spiel-id> <einzel-id> <alt> <neu> [--ja]');
  process.exit(1);
}

const db = openDb(process.env.DARTS_DB || path.join(SERVER_DIR, 'data', 'darts.db'));

/* Konto-Id oder Anzeigename -> Konto. Ein Name muss genau ein Konto treffen. */
function konto(wer) {
  const direkt = db.prepare('SELECT id, display_name, test FROM users WHERE id = ?').get(wer);
  if (direkt) return direkt;
  const treffer = db.prepare('SELECT id, display_name, test FROM users WHERE instr(lower(display_name), ?) > 0').all(wer.toLowerCase());
  const genau = treffer.filter((t) => t.display_name.toLowerCase() === wer.toLowerCase());
  if (genau.length === 1) return genau[0];
  if (treffer.length === 1) return treffer[0];
  if (!treffer.length) { console.error('Kein Konto passt zu "' + wer + '".'); process.exit(1); }
  console.error('"' + wer + '" ist nicht eindeutig: ' + treffer.map((t) => t.display_name + ' (' + t.id + ')').join(', '));
  process.exit(1);
}

const alt = konto(altArg);
const neu = konto(neuArg);
if (alt.id === neu.id) { console.error('Alt und neu sind derselbe Spieler.'); process.exit(1); }
/* Ein Testkonto im Spiel versteckt es vor allen, die Testspiele nicht sehen
   (GET /api/games) - das Ligaspiel verschwaende von den meisten Geraeten. */
if (neu.test) { console.error(neu.display_name + ' ist ein Testkonto - das darf nicht in ein echtes Spiel.'); process.exit(1); }

const spiel = db.prepare('SELECT id, kind, seq, payload FROM games WHERE id = ? AND deleted_at IS NULL').get(spielId);
if (!spiel) { console.error('Spiel ' + spielId + ' gibt es nicht (oder es ist zurueckgezogen).'); process.exit(1); }
const pl = JSON.parse(spiel.payload);
if (!Array.isArray(pl.matches)) { console.error('Spiel ' + spielId + ' hat keine Einzel (' + spiel.kind + ').'); process.exit(1); }
const idx = pl.matches.findIndex((m) => m && m.id === einzelId);
if (idx < 0) { console.error('Einzel ' + einzelId + ' steht nicht in Spiel ' + spielId + '.'); process.exit(1); }
const m = pl.matches[idx];
if (!Array.isArray(m.p) || m.p.indexOf(alt.id) < 0) {
  console.error(alt.display_name + ' (' + alt.id + ') hat dieses Einzel nicht gespielt: ' + JSON.stringify(m.p));
  process.exit(1);
}
if (m.p.indexOf(neu.id) >= 0) { console.error(neu.display_name + ' steht schon in diesem Einzel.'); process.exit(1); }

const tausch = (id) => (id === alt.id ? neu.id : id);

/* Das Einzel: Spieler, Anwurf, Sieger, jede Aufnahme. */
function einzelUmschreiben(e) {
  e.p = e.p.map(tausch);
  if (e.starter) e.starter = tausch(e.starter);
  if (e.winner) e.winner = tausch(e.winner);
  (e.legs || []).forEach((l) => {
    if (l.starter) l.starter = tausch(l.starter);
    if (l.winner) l.winner = tausch(l.winner);
    (l.visits || []).forEach((v) => { v.p = tausch(v.p); });
  });
  return e;
}
/* Listen: der neue hinter den alten, der bleibt (seine anderen Einzel). */
function dazu(liste) {
  if (!Array.isArray(liste) || liste.indexOf(alt.id) < 0 || liste.indexOf(neu.id) >= 0) return false;
  liste.splice(liste.indexOf(alt.id) + 1, 0, neu.id);
  return true;
}

const vorher = JSON.stringify({ p: m.p, starter: m.starter, winner: m.winner });
einzelUmschreiben(m);
const listen = [];
if (dazu(pl.lineup)) listen.push('lineup');
if (pl.liga) ['wir', 'sie', 'heimSpieler', 'gastSpieler'].forEach((k) => { if (dazu(pl.liga[k])) listen.push('liga.' + k); });
if (pl.namen && typeof pl.namen === 'object' && !pl.namen[neu.id]) { pl.namen[neu.id] = neu.display_name; listen.push('namen'); }
pl.stand = (Number(pl.stand) || 0) + 1;

const schonDabei = db.prepare('SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?').get(spiel.id, neu.id);
const tm = db.prepare('SELECT result FROM tournament_matches WHERE tournament_id = ? AND match_id = ?').get(spiel.id, einzelId);

console.log('Spiel ' + spiel.id + ' (' + spiel.kind + (pl.liga ? ', Ligaspiel ' + (pl.liga.terminId || '') : '') + '), Einzel ' + einzelId + ' (Nr. ' + (idx + 1) + ')');
console.log('  vorher:  ' + vorher);
console.log('  nachher: ' + JSON.stringify({ p: m.p, starter: m.starter, winner: m.winner }));
console.log('  ' + alt.display_name + ' (' + alt.id + ')  ->  ' + neu.display_name + ' (' + neu.id + ')');
console.log('  Listen ergaenzt: ' + (listen.join(', ') || 'keine') + ' · stand ' + (pl.stand - 1) + ' -> ' + pl.stand);
console.log('  game_players: ' + (schonDabei ? 'steht schon drin' : 'wird eingetragen'));
console.log('  tournament_matches: ' + (tm && tm.result ? 'Ergebnis wird mit umgeschrieben' : 'kein Eintrag'));

if (!ja) {
  console.log('\nNur angeschaut. Mit --ja wird es ausgefuehrt.');
  db.close();
  process.exit(0);
}

transaktion(db, () => {
  db.prepare('UPDATE games SET payload = ?, seq = ? WHERE id = ?').run(JSON.stringify(pl), nextSeq(db), spiel.id);
  if (!schonDabei) {
    const pos = db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS pos FROM game_players WHERE game_id = ?').get(spiel.id).pos;
    db.prepare('INSERT INTO game_players (game_id, pos, user_id, guest_name) VALUES (?, ?, ?, NULL)').run(spiel.id, pos, neu.id);
  }
  if (tm && tm.result) {
    let r;
    try { r = JSON.parse(tm.result); } catch (e) { r = null; }
    if (r && Array.isArray(r.p) && r.p.indexOf(alt.id) >= 0) {
      db.prepare('UPDATE tournament_matches SET result = ?, seq = ?, updated_at = ? WHERE tournament_id = ? AND match_id = ?')
        .run(JSON.stringify(einzelUmschreiben(r)), zaehler(db, 'tournament_seq'), new Date().toISOString(), spiel.id, einzelId);
    }
  }
});
console.log('\nErledigt. Die Geraete uebernehmen die Korrektur beim naechsten Abgleich.');
db.close();
