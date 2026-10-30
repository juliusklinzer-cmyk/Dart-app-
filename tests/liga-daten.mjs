/*
 * Liga-Daten: Ligaleitung (js/liga-sdm.js, von tools/liga-import.mjs
 * erzeugt) plus Handpflege (LIGA_HAND in js/liga-daten.js), daraus Tabelle,
 * Einzelrangliste und Highlights nach dem Schluessel der Ligaleitung.
 *
 *   node tests/liga-daten.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quelle = (d) => fs.readFileSync(path.join(wurzel, d), 'utf8');
function ladeDaten(sdm) {
  const fenster = { LIGA_SDM: sdm };
  new Function('window', quelle('js/liga-daten.js'))(fenster);
  return fenster.LIGA_DATEN;
}
let fehler = 0;
function check(name, ok) { console.log((ok ? '  ✓ ' : '  ✗ ') + name); if (!ok) fehler++; }

/* ---------- 1. Die echte Datei der Ligaleitung ---------- */
console.log('Liga-Daten: echte Datei');
const echt = {};
new Function('window', quelle('js/liga-sdm.js'))(echt);
const D = ladeDaten(echt.LIGA_SDM);
const runden = Object.values(D.spieltage);
const spiele = runden.flat().filter((s) => s.gast);
check('18 Spieltage, je ein Spielfrei und vier Spiele', runden.length === 18 && runden.every((r) => r.length === 5 && r.filter((s) => !s.gast).length === 1));
check('jedes Spiel mit Ergebnis hat Legs und 16 Einzel', spiele.filter((s) => s.einzel).every((s) => /^\d+:\d+$/.test(s.legs) && Array.isArray(s.partien) && s.partien.length === 16));
check('jedes Einzel nennt zwei Namen und einen Leg-Stand', spiele.flatMap((s) => s.partien || []).every((p) => p[0] && p[1] && p[2] !== p[3]));
check('Blink 180 hat in jedem Spieltag genau ein Spiel oder Spielfrei', runden.every((r) => r.filter((s) => s.heim === 'Blink 180' || s.gast === 'Blink 180').length === 1));
const st03 = D.liga.termine.find((t) => t.id === 'st03');
check('unsere Termine folgen dem Spielplan der Ligaleitung (3. Spieltag bei Voodoo Darters)', st03.tag === '2026-10-26' && st03.heim === 'Voodoo Darters' && st03.gast === 'Blink 180' && st03.ort === 'Heuboden');
check('Spielfrei-Spieltage haben kein Datum', D.liga.termine.filter((t) => !t.tag).map((t) => t.id).join() === 'st09,st18');
const unserSt02 = D.spieltage.st02.find((s) => s.gast === 'Blink 180');
check('LIGA_HAND mischt die Bogen-Aufstellung in unser Spiel des 2. Spieltags', unserSt02 && unserSt02.einzel === '6:10' && unserSt02.partien.length === 16 &&
  unserSt02.aufstellung && unserSt02.aufstellung.gast[4] === 'Dominik Beuscher' && unserSt02.aufstellung.gast[5] === 'Michael Schmeiß');
check('neun Teams mit Lokal und Spielerliste', Object.keys(D.teamInfo).length === 9 && Object.values(D.teamInfo).every((t) => t.lokal && t.spieler.length > 0));
check('Blink 180: Bar Sehnsucht, Spielerliste mit Julius Klinzer', D.teamInfo['Blink 180'].lokal === 'Bar Sehnsucht' && D.teamInfo['Blink 180'].spieler.some((p) => p.name === 'Julius Klinzer'));
check('Stand und Quelle sind vermerkt', /^\d{4}-\d{2}-\d{2}$/.test(D.stand) && /steeldart-muenchen\.de/.test(D.quelle));
const tab = D.tabelleAus(D.spieltage, D.teams);
const gewertet = spiele.filter((s) => s.einzel && !s.verschoben).length;
check('Tabelle: alle neun Teams, Punkte summieren sich auf 2 je gewertetem Spiel', tab.zeilen.length === 9 && tab.spiele === gewertet &&
  tab.zeilen.reduce((a, z) => a + z.punkte, 0) === 2 * gewertet);
const er = D.einzelranglisteAus(D.spieltage);
const berichte = spiele.filter((s) => s.partien).length;
check('Einzelrangliste: 16 Siege je Spielbericht, Punkte fallend', er.reduce((a, z) => a + z.siege, 0) === 16 * berichte &&
  er.every((z, i) => !i || er[i - 1].punkte >= z.punkte));
check('Gastspieler stehen markiert in der Einzelrangliste', er.some((z) => z.gast) && er.every((z) => z.name.charAt(0) !== '*'));

/* ---------- 2. Der Punkteschluessel an einem kleinen Beispiel ---------- */
console.log('Liga-Daten: Schluessel der Ligaleitung');
const fix = {
  stand: '2026-10-30', quelle: 'test',
  spieltage: { st01: [{ heim: 'C', gast: null }, {
    tag: '2026-10-06', heim: 'A', gast: 'B', ort: 'X', einzel: '2:2', legs: '5:5',
    partien: [['Anna', 'Bert', 2, 0], ['Carl', '*Dora', 2, 1], ['Anna', '*Dora', 1, 2], ['Carl', 'Bert', 0, 2]],
    highlights: [{ wer: 'Anna', team: 'A', s180: 2, shortleg: [15], was: '2× 180 · Shortleg 15' }, { wer: '*Dora', team: 'B', highfinish: [120], was: 'Highfinish 120' }]
  }] },
  teams: {}
};
const F = ladeDaten(fix);
const fer = F.einzelranglisteAus(F.spieltage);
const je = {};
fer.forEach((z) => { je[z.name] = z; });
check('Sieger: 2 Punkte plus Leg-Differenz (2:0 = 4, 2:1 = 3); Verlierer: gewonnene Legs (1:2 = 1, 0:2 = 0)',
  je.Anna.punkte === 5 && je.Carl.punkte === 3 && je.Bert.punkte === 4 && je.Dora.punkte === 4);
check('Reihenfolge: Punkte, Spiel-Differenz, Leg-Differenz, gewonnene Legs', fer.map((z) => z.name).join() === 'Anna,Dora,Bert,Carl');
check('Legs und Spiele als Paare, Gast erkannt', je.Anna.legs === '3:2' && je.Anna.spiele === '1:1' && je.Dora.gast === true && je.Bert.gast === false);
const ftab = F.tabelleAus(F.spieltage, ['A', 'B', 'C']);
check('Tabelle: Unentschieden gibt beiden einen Punkt, Team ohne Spiel steht hinten', ftab.zeilen.map((z) => z.team + z.punkte).join() === 'A1,B1,C0' && ftab.zeilen[0].u === 1);
const hl = F.highlightsAus(F.spieltage);
check('Highlights: 180er gezaehlt, Shortleg und Highfinish mit Wert und Gast-Kennung',
  hl.s180[0].name === 'Anna' && hl.s180[0].n === 2 && hl.shortleg[0].wert === 15 && hl.highfinish[0].wert === 120 && hl.highfinish[0].gast === true);
check('Termine ohne Spielplan der Ligaleitung bleiben wie von Hand gepflegt', F.liga.termine.find((t) => t.id === 'st03').heim === 'Voodoo Darters');

console.log(fehler ? '\n' + fehler + ' Fehler' : '\nAlle Liga-Daten-Tests bestanden');
process.exit(fehler ? 1 : 0);
