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

/* ---------- 3. Der Import-Kern (server/lib/liga-import.mjs) ---------- */
console.log('\nLiga-Import: Beispielseiten der Ligaleitung');
{
  const { ligaImportieren, sdmText, sdmAusText, standAusText, sdmInhaltGleich } = await import('../server/lib/liga-import.mjs');
  const { ligaAktualisieren, ligaDateiWaehlen } = await import('../server/lib/liga.mjs');
  const os = await import('node:os');
  const team = (id, name) => '<a href="mannschaftsseite/id/' + id + '.html">' + name + '</a>';
  const spiel = (am, heim, gast, ort, score, legs) => '<tr class="spiel"><td class=\'spiel am\'>' + am + '</td><td class=\'spiel home\'>' + heim + '</td>' +
    '<td class=\'spiel away\'>' + gast + '</td><td class=\'spiel ort\'>' + ort + '</td><td class=\'spiel score\'>' + score + '</td><td class=\'spiel legs\'>' + legs + '</td></tr>';
  const ligaSeite = (st02Erg) => '<h3>1. Spieltag</h3><table>' +
    spiel('06.10.2026', team(1, 'Alpha'), team(2, 'Beta'), 'Bar', '<a href="spielberichte/id/555.html">9 : 7</a>', '20 : 15') +
    spiel('', team(3, 'Gamma'), 'Spielfrei', '', '', '') + '</table>' +
    '<h3>2. Spieltag</h3><table>' +
    spiel('20.10.2026', team(2, 'Beta'), team(3, 'Gamma'), 'Pub', st02Erg ? '<a href="spielberichte/id/556.html">8 : 8</a>' : '', st02Erg ? '20 : 20' : '') +
    spiel('21.10.2026', team(1, 'Alpha'), team(3, 'Gamma'), 'Bar', '', 'verschoben') + '</table>' +
    '<table><tr><th>Platz</th><th>Mannschaft</th></tr><tr><td>1</td><td>Alpha</td><td>1</td><td>1</td><td>0</td><td>0</td><td>20:15</td><td>9:7</td><td>2</td></tr></table>';
  const einzel = (a, b, x, y) => '<tr><td><span class="winner">' + a + '</span></td><td><span class="loser">' + b + '</span></td><td>' + x + ' : ' + y + '</td></tr>';
  const bericht = (n) => '<table>' + Array.from({ length: n }, (_, i) => einzel('Heim' + (i % 4), i === 3 ? '(2 * Gast) Gast Spieler' : 'Gast' + (i % 4), 2, i % 2)).join('') + '</table>' +
    '<h2>Highlights</h2><table><tr><th>Spieler</th></tr><tr><td>Heim0</td><td>Alpha</td><td>2</td><td>15</td><td>120</td></tr></table>';
  const teamSeite = (lokal, spieler) => '<h2>Spielort</h2><h3>' + lokal + '</h3><div class="address">Strasse 1<br>80000 M&uuml;nchen</div>' +
    '<h2>Spielerliste</h2><table>' + spieler.map((s) => '<tr><td>' + s + '</td><td>' + (s === 'Heim0' ? 'TC' : '') + '</td></tr>').join('') + '</table>';
  const seiten = {
    'liga.html': ligaSeite(false), 'sb-555.html': bericht(16), 'sb-556.html': bericht(15),
    'team-1.html': teamSeite('Bar', ['Heim0', 'Heim1', 'Heim2', 'Heim3']), 'team-2.html': teamSeite('Pub', ['Gast0', 'Gast1']), 'team-3.html': teamSeite('Keller', ['Dritte'])
  };
  const abrufe = [];
  const laden = async (url, datei) => { abrufe.push(datei); if (!(datei in seiten)) throw new Error('unbekannt: ' + datei); return seiten[datei]; };

  const r1 = await ligaImportieren({ laden, voll: true, heute: new Date(2026, 10, 10) });
  check('voll: Spielplan, ein Spielbericht und drei Mannschaftsseiten werden geladen', r1.geladen === 5 && abrufe.join() === 'liga.html,sb-555.html,team-1.html,team-2.html,team-3.html');
  const a1 = r1.sdm.spieltage.st01[0];
  check('Spiel mit Ergebnis: Datum, Ort, Einzel, Legs, Bericht, 16 Partien, Gast mit Stern, Highlights',
    a1.tag === '2026-10-06' && a1.ort === 'Bar' && a1.einzel === '9:7' && a1.legs === '20:15' && a1.bericht === 555 && a1.partien.length === 16 &&
    a1.partien[3][1] === '*Gast Spieler' && a1.highlights[0].s180 === 2 && a1.highlights[0].was === '2× 180 · Shortleg 15 · Highfinish 120');
  check('Spielfrei, offenes Spiel und Verschobenes', r1.sdm.spieltage.st01[1].gast === null && !r1.sdm.spieltage.st02[0].einzel && r1.sdm.spieltage.st02[1].verschoben === true);
  check('Teams mit Lokal, Adresse (Umlaut, Zeilenumbruch als Komma) und Spielerliste (TC)',
    r1.sdm.teams.Alpha.id === 1 && r1.sdm.teams.Alpha.lokal === 'Bar' && r1.sdm.teams.Alpha.adresse === 'Strasse 1, 80000 München' && r1.sdm.teams.Alpha.spieler[0].info === 'TC' && r1.sdm.teams.Gamma.spieler.length === 1);
  check('Stand ist der Tag des Imports, keine Warnungen', r1.sdm.stand === '2026-11-10' && r1.warnungen.length === 0);
  const zurueck = sdmAusText(r1.text);
  check('Dateitext laeuft als Skript und ergibt dasselbe Objekt; Stand lesbar ohne Ausfuehren',
    JSON.stringify(zurueck) === JSON.stringify(r1.sdm) && standAusText(r1.text) === '2026-11-10' && sdmText(r1.sdm) === r1.text);

  abrufe.length = 0;
  const r2 = await ligaImportieren({ laden, bekannt: r1.sdm, heute: new Date(2026, 10, 11) });
  check('mit bekannter Datei: nur der Spielplan wird geladen, Bericht und Teams kommen von vorher',
    r2.geladen === 1 && abrufe.join() === 'liga.html' && r2.sdm.spieltage.st01[0].partien.length === 16 && r2.sdm.teams.Beta.lokal === 'Pub');
  check('gleicher Inhalt trotz neuem Stand', sdmInhaltGleich(r1.sdm, r2.sdm) && r2.sdm.stand === '2026-11-11');

  seiten['liga.html'] = ligaSeite(true);
  abrufe.length = 0;
  const r3 = await ligaImportieren({ laden, bekannt: r1.sdm, heute: new Date(2026, 10, 12) });
  check('neues Ergebnis: nur der neue Spielbericht wird dazugeladen', r3.geladen === 2 && abrufe.join() === 'liga.html,sb-556.html');
  check('15 statt 16 Einzel: Spiel ohne Partien, aber mit Ergebnis und Warnung',
    r3.sdm.spieltage.st02[0].einzel === '8:8' && !r3.sdm.spieltage.st02[0].partien && r3.warnungen.length === 1 && /556/.test(r3.warnungen[0]) && !sdmInhaltGleich(r1.sdm, r3.sdm));
  const defekt = await ligaImportieren({ laden: async () => '<p>Wartungsarbeiten</p>', voll: true }).then(() => null, (e) => e);
  check('ohne Spieltage auf der Seite bricht der Import ab statt leer zu schreiben', defekt && /keine Spieltage/.test(defekt.message));

  /* Der Server-Abgleich: schreibt neben die Datenbank, nur bei Aenderung. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liga-abgleich-'));
  seiten['liga.html'] = ligaSeite(false);
  const appDir = path.join(tmp, 'app');
  fs.mkdirSync(path.join(appDir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'js', 'liga-sdm.js'), r1.text);
  fs.copyFileSync(path.join(wurzel, 'js', 'liga-daten.js'), path.join(appDir, 'js', 'liga-daten.js'));
  const datenDir = path.join(tmp, 'data');
  let g = await ligaAktualisieren({ appDir, datenDir, laden, heute: new Date(2026, 10, 11) });
  check('Abgleich ohne Neues: nichts geschrieben, Repo-Fassung gilt weiter', g.geaendert === false && !fs.existsSync(path.join(datenDir, 'liga-sdm.js')) && ligaDateiWaehlen(appDir, datenDir).quelle === 'repo');
  seiten['liga.html'] = ligaSeite(true);
  g = await ligaAktualisieren({ appDir, datenDir, laden, heute: new Date(2026, 10, 12) });
  const wahl = ligaDateiWaehlen(appDir, datenDir);
  check('Abgleich mit neuem Ergebnis: Datei neben der Datenbank, sie gilt (juengerer Stand)',
    g.geaendert === true && g.stand === '2026-11-12' && wahl.quelle === 'server' && wahl.stand === '2026-11-12' && sdmAusText(fs.readFileSync(wahl.pfad, 'utf8')).spieltage.st02[0].einzel === '8:8');
  g = await ligaAktualisieren({ appDir, datenDir, laden: async () => { throw new Error('Netz weg'); }, heute: new Date(2026, 10, 13) });
  check('Netzfehler: alte Datei bleibt, Fehler wird gemeldet', g.fehler === 'Netz weg' && ligaDateiWaehlen(appDir, datenDir).stand === '2026-11-12');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(fehler ? '\n' + fehler + ' Fehler' : '\nAlle Liga-Daten-Tests bestanden');
process.exit(fehler ? 1 : 0);
