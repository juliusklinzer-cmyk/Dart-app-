/*
 * End-to-End-Test der Turnier-App im echten Browser.
 * Start:  npm test
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
/* Standard: die normale App. TARGET=dart-turnier.html testet den Einzeldatei-Build. */
const BASE = `http://127.0.0.1:${server.address().port}/${process.env.TARGET || 'index.html'}`;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}
function group(name) { console.log(`\n${name}`); }

/* Vorinstalliertes Chromium nutzen, falls die Playwright-Version einen anderen Build erwartet. */
const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
/* Ladefehler werden über die Antworten geprüft; das automatische /favicon.ico
   des Browsers zählt nicht als Fehler der App. */
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
/*
 * `/api/*` ebenfalls nicht: dieser Test läuft absichtlich gegen einen reinen
 * Dateiserver ohne Backend – genau die Lage, die auch bei GitHub Pages
 * herrscht. Die Konto-Schicht fragt einmal nach, bekommt 404 und schaltet
 * sich still ab. Dass die App dabei sauber weiterläuft, ist der Sinn dieses
 * Durchlaufs; geprüft wird es unten über den fehlenden Konto-Knopf.
 */
page.on('response', (r) => {
  const url = r.url();
  if (r.status() < 400) return;
  if (url.endsWith('/favicon.ico') || url.indexOf('/api/') >= 0) return;
  errors.push('HTTP ' + r.status() + ': ' + url);
});

const $ = (sel) => page.locator(sel);
const visible = (sel) => $(sel).isVisible();
const text = (sel) => $(sel).innerText();
/* Knöpfe und Überschriften stehen per CSS in Versalien – innerText gibt sie
   auch so zurück. Für Textprüfungen deshalb kleinschreiben. */
const textKlein = async (sel) => (await $(sel).innerText()).toLowerCase();
const tapText = async (t, scope = 'body') => { await page.locator(`${scope} >> text="${t}"`).first().click(); };

/* Punkte über das Zahlenfeld eingeben (wie am Handy getippt). */
async function typeScore(n) {
  for (const c of String(n)) await page.locator(`.keypad button[data-key="${c}"]`).click();
  if (n <= 18) await page.locator('.keypad button[data-key="ok"]').click();
}
async function dart(label) {
  if (label === 'BULL') return page.locator('[data-bull]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.replace(/^[TDS]/, ''), 10);
  await page.locator(`#mult-row button[data-mult="${mult}"]`).click();
  await page.locator(`#num-grid button[data-num="${num}"]`).click();
}
const rest = (i) => page.locator('.pcard').nth(i).locator('.rest').innerText();
const st = () => page.evaluate(() => window.__dart.standings());

await page.goto(BASE);

group('Setup');
check('Setup-Screen sichtbar', await visible('#screen-setup'));
const names = await page.locator('#roster .nm').allInnerTexts();
check('4 Profile vorbelegt', JSON.stringify(names) === '["Lenas","Tobi","Domi","Julius"]', names.join(','));
check('alle vier für das Turnier ausgewählt', (await page.locator('.roster-item.selected').count()) === 4);
check('501 vorausgewählt', await page.locator('[data-setting="start"] button[data-value="501"]').evaluate((e) => e.classList.contains('active')));

group('Turnierplan');
await page.locator('[data-action="start-game"]').click();
check('Tabelle sichtbar', await visible('#screen-tournament'));
const matchCount = await page.locator('.match-row').count();
check('6 Spiele bei 4 Spielern (jeder gegen jeden)', matchCount === 6, `war ${matchCount}`);
const rounds = await page.locator('.round-label').count();
check('3 Runden', rounds === 3, `war ${rounds}`);
const pairs = await page.evaluate(() => window.__dart.state().matches.map((m) => m.p.slice().sort().join('|')));
check('keine Paarung doppelt', new Set(pairs).size === 6);

group('Bull-Off & Spielstart');
await page.locator('[data-action="next-match"]').click();
check('Bull-Off-Screen', await visible('#screen-bulloff'));
/* Der Button enthält Avatar und Name – nur den Namen lesen. */
const firstName = await page.locator('#bulloff-buttons button').first().locator('span:not(.av)').innerText();
await page.locator('#bulloff-buttons button').first().click();
check('Spiel-Screen', await visible('#screen-game'));
check('beide starten bei 501', (await rest(0)) === '501' && (await rest(1)) === '501');
const activeName = await page.locator('.pcard.active .pname').innerText();
check('Bull-Off-Sieger beginnt', activeName.includes(firstName), `${activeName} vs ${firstName}`);

group('Punkte-Eingabe (abwechselnd)');
await typeScore(180);
check('180 abgezogen -> 321', (await rest(0)) === '321');
check('danach ist der Gegner dran', await page.locator('.pcard').nth(1).evaluate((e) => e.classList.contains('active')));
await typeScore(60);
check('Gegner 501-60 = 441', (await rest(1)) === '441');
check('Anwurf wechselt zurück', await page.locator('.pcard').nth(0).evaluate((e) => e.classList.contains('active')));
await typeScore(180);
check('Rest 141', (await rest(0)) === '141');
check('bei Gegner (441) weiter Punkte-Eingabe', await visible('#pad-total'));
await typeScore(60);
check('Gegner 381', (await rest(1)) === '381');
check('Auto-Umschaltung auf Einzel-Darts bei Rest <= 170', await visible('#pad-darts'));
const hist0 = (await page.locator('#history .col').first().innerText()).replace(/\s+/g, ' ');
check('Wurfverlauf zeigt die eigenen Reste', hist0.includes('Rest 141') && hist0.includes('Rest 321'), hist0);
check('Finish-Vorschlag T20 T19 D12', (await text('#checkout-bar')).replace(/\s+/g, ' ').includes('T20 T19 D12'));

group('Tastenbeschriftung im Einzel-Dart-Modus');
await page.locator('#mult-row button[data-mult="2"]').click();
check('Doppel zeigt weiter die Feldzahl 18 (nicht 36)', (await page.locator('#num-grid button[data-num="18"]').innerText()).replace(/\s/g, '') === 'D18');
await page.locator('#mult-row button[data-mult="3"]').click();
check('Triple zeigt T20 statt 60', (await page.locator('#num-grid button[data-num="20"]').innerText()).replace(/\s/g, '') === 'T20');
await page.locator('#mult-row button[data-mult="1"]').click();
check('Single zeigt die blanke Zahl', (await page.locator('#num-grid button[data-num="20"]').innerText()).trim() === '20');

group('Bust-Regel');
await page.locator('#mode-toggle button[data-mode="total"]').click();
await typeScore(140); // 141 - 140 = 1 -> Bust, Rest bleibt stehen
check('Rest bleibt 141 nach Bust auf 1', (await rest(0)) === '141');
check('Bust beendet die Aufnahme (Gegner ist dran)', await page.locator('.pcard').nth(1).evaluate((e) => e.classList.contains('active')));
await typeScore(60);
check('Gegner 321', (await rest(1)) === '321');

group('Einzel-Darts & Checkout');
check('wieder Einzel-Darts aktiv', await visible('#pad-darts'));
await dart('T20');
check('nach T20 Rest 81', (await rest(0)) === '81');
check('Restvorschlag T19 D12 mit 2 Darts', (await text('#checkout-bar')).replace(/\s+/g, ' ').includes('T19 D12'));
await dart('T19');
check('nach T19 Rest 24', (await rest(0)) === '24');
await dart('S12'); // dritter Dart, kein Finish: Rest 12
check('Rest 12 nach voller Aufnahme', (await rest(0)) === '12');
check('nach 3 Darts ist der Gegner dran', await page.locator('.pcard').nth(1).evaluate((e) => e.classList.contains('active')));
await typeScore(60);

group('Double Out');
await dart('S12'); // 0 ohne Doppel -> Bust
check('Single 12 auf Rest 12 ist Bust (nur Doppel checkt aus)', (await rest(0)) === '12');
check('Bust beendet die Aufnahme sofort', await page.locator('.pcard').nth(1).evaluate((e) => e.classList.contains('active')));
await typeScore(60);
await dart('T20'); // Überwurf
check('Überwurf ist Bust, Rest bleibt 12', (await rest(0)) === '12');
await typeScore(60);
check('Finish-Vorschlag D6', (await text('#checkout-bar')).replace(/\s+/g, ' ').includes('D6'));
await dart('D6');
check('Match-Ende-Overlay mit Glückwunsch', (await visible('#overlay')) && (await text('#overlay-card')).includes('Glückwunsch'));

const table1 = await st();
const winner = table1.find((p) => p.name === firstName);
check('Sieger hat 1 Sieg', winner.won === 1, JSON.stringify(winner));
check('180er gezählt', winner.s180 === 2, String(winner.s180));
check('höchstes Finish 12', winner.highCO === 12, String(winner.highCO));
check('Average = 501 Punkte / geworfene Darts', Math.abs(winner.avg - (501 / winner.darts) * 3) < 0.01, `avg ${winner.avg} bei ${winner.darts} Darts`);

group('Undo');
await page.locator('#overlay-card [data-action="undo"]').click();
check('Rest wieder 12', (await rest(0)) === '12');
check('Match wieder offen', await page.evaluate(() => !window.__dart.currentMatch().done));
await dart('D6');
check('erneut ausgecheckt', (await text('#overlay-card')).includes('Glückwunsch'));

/* Ein Leg im Schnelldurchlauf: Anwerfer checkt mit 180 / 180 / 141 aus. */
async function quickLeg() {
  await typeScore(180); await typeScore(60);   // 321 / 441
  await typeScore(180); await typeScore(60);   // 141 / 381
  await page.locator('#mode-toggle button[data-mode="total"]').click();
  return typeScore(141);
}

group('Checkout über Punkte-Eingabe');
await page.locator('#overlay-card [data-action="ov-next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60);
await typeScore(180); await typeScore(60);
await page.locator('#mode-toggle button[data-mode="total"]').click();
await typeScore(179);
check('179 als unmöglicher Wurf abgelehnt', (await text('#input-error')).includes('nicht möglich'));
await typeScore(141);
check('Checkout-Dialog fragt nach Dart-Anzahl', (await text('#overlay-card')).includes('Mit wie vielen Darts'));
const opts = await page.locator('#overlay-card [data-action="co-darts"]').allInnerTexts();
check('nur 3 Darts möglich für 141', opts.join(',') === '3', opts.join(','));
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
check('Match beendet', (await text('#overlay-card')).includes('Glückwunsch'));

group('Restliches Turnier & Endstand');
for (let i = 0; i < 4; i++) {
  await page.locator('#overlay-card [data-action="ov-next-match"], #overlay-card [data-action="ov-finish"]').first().click();
  if (await visible('#screen-bulloff')) await page.locator('#bulloff-buttons button').nth(i % 2).click();
  await quickLeg();
  await page.locator('#overlay-card [data-action="co-darts"]').first().click();
}
check('Glückwunsch vor der Auswertung', (await text('#overlay-card')).includes('Glückwunsch'));
check('Weg zur Spielstatistik angeboten', (await textKlein('#overlay-card')).includes('spielstatistik'));
await page.locator('#overlay-card [data-action="open-summary"]').click();
check('Spielstatistik sichtbar', await visible('#screen-summary'));
const sumText = await text('#summary-box');
check('Statistik zeigt Sieger und Legs', sumText.includes('gewinnt') && sumText.toLowerCase().includes('legs'));
check('Statistik zeigt Average je Spieler', (await page.locator('#summary-box .sum-card').count()) === 2 && sumText.includes('3-Dart-Average'));
check('Statistik zeigt Doppelquote und bestes Leg', sumText.includes('Doppelquote') && sumText.includes('Bestes Leg'));
check('Hinweis auf Gesamtstatistik', (await text('#summary-box')).includes('Karriere-Statistik'));
await page.locator('#summary-actions [data-action="to-winner"]').click();
check('Sieger-Screen', await visible('#screen-winner'));
check('Podium mit 4 Plätzen', (await page.locator('.podium .p').count()) === 4);
const final = await st();
check('alle 6 Spiele gewertet', final.reduce((a, p) => a + p.won, 0) === 6, JSON.stringify(final.map((p) => `${p.name}:${p.won}`)));
check('Tabelle nach Siegen sortiert', final.every((p, i) => i === 0 || final[i - 1].won >= p.won));

group('Persistenz');
await page.reload();
check('Stand nach Reload erhalten', await visible('#screen-winner'));
const afterReload = await st();
check('Statistik nach Reload identisch', JSON.stringify(afterReload.map((p) => p.won)) === JSON.stringify(final.map((p) => p.won)));

const carr = () => page.evaluate(() => window.__dart.career());
const board = (key) => page.evaluate((k) => window.__dart.ranking(k), key);

group('Karriere-Statistik');
const c1 = await carr();
const champ = Object.values(c1).find((s) => s.name === firstName);
check('Karriere zählt alle Spiele des Turniers', Object.values(c1).reduce((a, s) => a + s.matches, 0) === 12, 'Summe Spielteilnahmen');
check('Average über alle Spiele vorhanden', champ.avg > 0 && champ.darts > 0);
check('First-9-Average berechnet', champ.first9 > 0, String(champ.first9));
check('Doppelquote aus Doppelversuchen', champ.doubleAttempts > 0 && champ.doubleQuote > 0, `${champ.checkouts}/${champ.doubleAttempts}`);
check('180er über alle Spiele gezählt', champ.s180 >= 2, String(champ.s180));
check('100+ Aufnahmen gezählt', champ.tons >= champ.s180);

group('Ranglisten');
await page.locator('#screen-winner [data-action="to-tournament"]').click();
check('Navigation außerhalb des Spiels sichtbar', await visible('#nav'));
await page.locator('#nav [data-screen="boards"]').click();
check('Rangliste sichtbar', await visible('#screen-boards'));
check('Average-Rangliste hat Einträge', (await page.locator('.board-row').count()) > 0);
const avgBoard = await board('avg');
check('Rangliste absteigend sortiert', avgBoard.every((s, i) => i === 0 || avgBoard[i - 1].avg >= s.avg));
await page.locator('[data-action="board"][data-key="s180"]').click();
check('Kategorie 180er wechselbar', (await text('#board-hint')).includes('Triple 20'));
await page.locator('[data-action="board"][data-key="bestLeg"]').click();
const legBoard = await board('bestLeg');
check('Bestes Leg aufsteigend (wenigste Darts zuerst)', legBoard.every((s, i) => i === 0 || legBoard[i - 1].bestLeg <= s.bestLeg));
check('Rekord-Kacheln gefüllt', (await page.locator('.records .rec').count()) === 6);
check('Alle Spiele dokumentiert', (await page.locator('#match-log .log-row').count()) === 6);

group('Spielerprofile');
await page.locator('#nav [data-screen="players"]').click();
check('Spielerliste sichtbar', (await page.locator('.player-card').count()) === 4);
await page.locator('.player-card').first().click();
check('Profil-Detail offen', await visible('#screen-profile'));
const detail = await text('#profile-detail');
check('Profil zeigt Scoring-Werte', detail.includes('3-Dart-Average') && detail.includes('First-9-Average'));
check('Profil zeigt Finishing-Werte', detail.includes('Doppelquote') && detail.includes('Bestes Leg'));
check('Profil listet gespielte Spiele', (await page.locator('#profile-detail .log-row').count()) === 3);

group('Neues Profil anlegen');
await page.locator('#nav [data-screen="players"]').click();
await page.locator('#screen-players [data-action="new-profile"]').click();
await page.locator('[data-role="profile-name"]').fill('Testspieler');
await page.locator('[data-action="save-profile"]').click();
const profileNames = await page.evaluate(() => window.__dart.state().profiles.map((p) => p.name));
check('Profil gespeichert', profileNames.includes('Testspieler'), profileNames.join(','));
check('neues Profil ist für das nächste Turnier ausgewählt', await page.evaluate(() => {
  const s = window.__dart.state();
  return s.lineup.includes(s.profiles.find((p) => p.name === 'Testspieler').id);
}));

group('Turnier abschließen & Archiv');
await page.locator('#nav [data-screen="boards"]').click();
await page.locator('#nav [data-screen="setup"]').click();
check('Turnierscreen des laufenden Turniers', await visible('#screen-tournament'));
await page.locator('[data-action="to-winner"]').click();
await page.locator('[data-action="finish-tournament"]').click();
check('nach Abschluss zurück im Setup', await visible('#screen-setup'));
check('Turnier archiviert', await page.evaluate(() => window.__dart.state().history.length) === 1);
check('kein laufendes Turnier mehr', await page.evaluate(() => window.__dart.state().matches.length) === 0);
const c2 = await carr();
check('Karriere-Werte bleiben nach Archivierung erhalten',
  Object.values(c2).reduce((a, s) => a + s.matches, 0) === 12);
check('Turniersieg gezählt', Object.values(c2).reduce((a, s) => a + s.tourWins, 0) === 1);
await page.reload();
const c3 = await carr();
check('Archiv übersteht Reload', JSON.stringify(Object.values(c3).map((s) => s.matches)) === JSON.stringify(Object.values(c2).map((s) => s.matches)));

/* Cricket: alle Felder liegen als Single-, Double- und Triple-Block bereit. */
async function cDart(label) {
  if (label === 'MISS') return page.locator('#cricket-grid [data-num="0"]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.replace(/^[TDS]/, ''), 10);
  return page.locator(`#cricket-grid button[data-num="${num}"][data-mult="${mult}"]`).click();
}
/* Round the World zeigt nur die eigene Zahl: Single/Double/Triple/Miss. */
async function rDart(label) {
  if (label === 'MISS') return page.locator('#rtw-pad [data-num="0"]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.replace(/^[TDS]/, ''), 10);
  const key = page.locator(`#rtw-pad [data-num="${num}"][data-mult="${mult}"]`);
  if (await key.count()) return key.click();
  return null;   // Zahl steht nicht zur Wahl – das ist der Testfall "falsche Zahl"
}
/* Bull-Off eines Trainings-/Cricket-Spiels bestätigen: bei zwei Spielern per
   Tipp auf den Anfänger, bei mehr über die Reihenfolge-Liste. */
async function bullOffGo() {
  if (await page.locator('[data-action="start-order"]').count()) {
    await page.locator('[data-action="start-order"]').click();
  } else {
    await page.locator('#bulloff-buttons button').first().click();
  }
}
async function reduceLineupToTwo() {
  for (let i = 0; i < 10; i++) {
    const sel = page.locator('.roster-item.selected');
    if ((await sel.count()) <= 2) break;
    await sel.nth(2).click();
  }
}

group('Cricket');
await page.locator('#nav [data-screen="setup"]').click();
await reduceLineupToTwo();
check('zwei Spieler in der Aufstellung', (await page.evaluate(() => window.__dart.state().lineup.length)) === 2);
await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
check('Cricket-Einstellungen sichtbar', await visible('#settings-cricket'));
check('501-Einstellungen ausgeblendet', !(await visible('#settings-501')));
/* Der Knopf heisst in jedem Modus gleich – welcher Modus laeuft, sagt die
   Auswahl darueber, nicht der Knopf. */
check('Startknopf heisst überall gleich', (await textKlein('[data-action="start-game"]')).includes('spiel starten'));
await page.locator('[data-action="start-game"]').click();
check('Bull-Off auch im Cricket', await visible('#screen-bulloff'));
await page.locator('#bulloff-buttons button').first().click();
check('Cricket-Screen', await visible('#screen-cricket'));
check('Board hat 7 Zahlen (20–15 und Bull)', (await page.locator('.cr-num').count()) === 8, 'inkl. Punktezeile');

await cDart('T20');
let cs = await page.evaluate(() => window.__dart.cricketState());
const [pA, pB] = await page.evaluate(() => window.__dart.game().players);
check('Triple schließt eine Zahl sofort (3 Marken)', cs.marks[pA][20] === 3);
check('noch keine Punkte, alle Marken zum Schließen gebraucht', cs.score[pA] === 0);
await cDart('S20');
cs = await page.evaluate(() => window.__dart.cricketState());
check('Treffer auf geschlossene Zahl bringt 20 Punkte', cs.score[pA] === 20, String(cs.score[pA]));
await cDart('T19');
cs = await page.evaluate(() => window.__dart.cricketState());
check('19 ebenfalls zu', cs.marks[pA][19] === 3);
/* Wer vorn liegt, wird an der Punktzahl markiert – aber nur einer, und nur
   wenn ueberhaupt schon Punkte da sind. */
const fuehrend = () => page.evaluate(() => {
  const zellen = [...document.querySelectorAll('#cricket-board .cr-score')];
  return zellen.map((z) => z.classList.contains('fuehrt'));
});
check('genau einer ist vorn', (await fuehrend()).filter(Boolean).length === 1,
  JSON.stringify(await fuehrend()));
check('und zwar der mit den Punkten', (await fuehrend())[0] === true);
check('nach 3 Darts ist der Gegner am Wurf',
  (await text('#cricket-turn')).includes(await page.evaluate((id) => window.__dart.state().profiles.find((p) => p.id === id).name, pB)));

for (const _ of [1, 2, 3]) await cDart('MISS');
await cDart('T18'); await cDart('T17'); await cDart('T16');
for (const _ of [1, 2, 3]) await cDart('MISS');
await cDart('T15');
cs = await page.evaluate(() => window.__dart.cricketState());
check('sechs Zahlen zu, Bull fehlt noch', cs.marks[pA][15] === 3 && cs.marks[pA][25] === 0);
check('Spiel läuft noch, solange Bull offen ist', !(await page.evaluate(() => window.__dart.game().done)));
await cDart('D25');
cs = await page.evaluate(() => window.__dart.cricketState());
check('Doppel-Bull zählt zwei Marken', cs.marks[pA][25] === 2);
await cDart('S25');
check('alles zu und vorne: Sieg', (await text('#overlay-card')).includes('Glückwunsch'));
check('Sieger korrekt', await page.evaluate((id) => window.__dart.game().winner === id, pA));

await page.locator('#overlay-card [data-action="undo-game"]').click();
check('Undo nimmt den letzten Dart zurück', !(await page.evaluate(() => window.__dart.game().done)));
await cDart('S25');
await page.locator('#overlay-card [data-action="open-summary"]').click();
const cSum = await text('#summary-box');
check('Cricket-Statistik zeigt MPR und Marken', cSum.includes('MPR') && cSum.includes('Marken'));
check('Cricket-Statistik zeigt Punkte und Felder', cSum.includes('Punkte') && cSum.includes('Felder zu'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
check('Cricket gespeichert', await page.evaluate(() => window.__dart.state().history.filter((h) => h.kind === 'cricket').length) === 1);
const cCar = await carr();
const cWinner = Object.values(cCar).find((s) => s.id === pA);
const before = Object.values(c1).find((s) => s.id === pA);
check('Cricket-Sieg in der Karriere', cWinner.cricketWins === 1);
check('MPR berechnet', cWinner.mpr > 0, String(cWinner.mpr));
check('Cricket-Darts zählen NICHT in den 501-Average',
  cWinner.darts === before.darts && cWinner.avg === before.avg,
  `${before.darts} -> ${cWinner.darts} Darts`);
check('Cricket verändert die Doppelquote nicht', cWinner.doubleAttempts === before.doubleAttempts);
check('Cricket zählt nicht als 501-Spiel', cWinner.matches === before.matches);

group('Round the World');
await page.locator('[data-action="set-mode"][data-value="rtw"]').click();
check('zwei Spielarten zur Wahl',
  (await page.locator('#settings-rtw [data-setting="rtwBoost"] button').count()) === 2);
check('Boost ist voreingestellt',
  await page.evaluate(() => window.__dart.state().settings.rtwBoost === 1));
await page.locator('[data-action="start-game"]').click();
check('Bull-Off auch im Training', await visible('#screen-bulloff'));
const rtwStarter = await page.locator('#bulloff-buttons button').first().locator('span:not(.av)').innerText();
await page.locator('#bulloff-buttons button').first().click();
check('RTW-Screen', await visible('#screen-rtw'));
check('der Bull-Sieger beginnt', (await text('#rtw-turn')).includes(rtwStarter), await text('#rtw-turn'));
check('alle starten auf der 1', await page.evaluate(() => {
  const s = window.__dart.rtwState();
  return Object.values(s.target).every((t) => t === 1);
}));
const [rA] = await page.evaluate(() => window.__dart.game().players);
const misses = async () => { for (const _ of [1, 2, 3]) await rDart('MISS'); };
const weiter = () => page.locator('#rtw-pad [data-action="end-rtw-visit"]').click();
const rTarget = async () => (await page.evaluate(() => window.__dart.rtwState())).target[rA];

const rGross = () => text('#rtw-pad .rtw-key.gross .z');
check('die eigene Zahl steht groß da', (await rGross()) === '1', await rGross());
check('Fortschritt zeigt die erste von 21 Stationen',
  (await text('#rtw-fortschritt-txt')).includes('Station 1 von 21'), await text('#rtw-fortschritt-txt'));
await rDart('S1');
check('Single rückt ein Feld weiter (1 -> 2)', (await rTarget()) === 2);
check('die große Zahl folgt sofort', (await rGross()) === '2', await rGross());
check('Sprungziel wird angezeigt', (await text('#rtw-pad')).includes('dann 4'));
check('nur die eigene Zahl steht zur Wahl', (await page.locator('#rtw-pad [data-num="9"]').count()) === 0);
await rDart('D2');
check('Double überspringt eine Zahl (2 -> 4)', (await rTarget()) === 4, String(await rTarget()));
await rDart('T4');
check('Triple überspringt zwei Zahlen (4 -> 7)', (await rTarget()) === 7, String(await rTarget()));
/* Getroffen wird selten – deshalb muss eine Aufnahme mit einem Tipp
   abzuschließen sein, statt drei Mal Miss zu verlangen. */
const wurfZahl = () => page.evaluate(() => window.__dart.game().throws.length);
const vorWeiter = await wurfZahl();
await weiter();
check('Weiter verbucht die ganze Aufnahme als Fehlwürfe',
  (await wurfZahl()) === vorWeiter + 3, `${vorWeiter} -> ${await wurfZahl()}`);
await rDart('T7'); await rDart('T10'); await rDart('T13');
check('drei Darts, dann ist der Nächste dran', (await rTarget()) === 16, String(await rTarget()));
const vorRest = await wurfZahl();
await rDart('MISS');
await weiter();
check('Weiter füllt nur die noch offenen Darts auf',
  (await wurfZahl()) === vorRest + 3, `${vorRest} -> ${await wurfZahl()}`);
await rDart('T16'); await rDart('T19');
check('über die 20 hinaus geht es auf Bull', (await rTarget()) === 25, String(await rTarget()));
check('auf Bull steht nur noch Bull oder Miss zur Wahl',
  (await page.locator('#rtw-pad [data-num]').count()) === 2);
check('Bull steht groß da', (await rGross()) === 'Bull', await rGross());
check('Fortschritt zeigt die letzte Station',
  (await text('#rtw-fortschritt-txt')).includes('Station 21 von 21'), await text('#rtw-fortschritt-txt'));
await rDart('MISS');
check('Miss auf Bull ändert nichts', (await rTarget()) === 25);
await misses();
await rDart('S25');
check('nach dem Bull läuft die Runde fair zu Ende',
  !(await page.evaluate(() => window.__dart.game().done)));
check('Hinweis auf die Schlussrunde', (await text('#rtw-turn')).includes('Runde wird zu Ende gespielt'));
check('der fertige Spieler wirft nicht mehr',
  !(await text('#rtw-turn')).includes('Am Wurf ' + (await page.evaluate((id) => window.__dart.state().profiles.find((p) => p.id === id).name, rA))));
await misses();
check('nach der Schlussrunde ist das Spiel beendet', (await text('#overlay-card')).includes('Glückwunsch'));
check('Sieger ist der Bull-Werfer', await page.evaluate((id) => window.__dart.game().winner === id, rA));
await page.locator('#overlay-card [data-action="open-summary"]').click();
const rSum = await text('#summary-box');
check('RTW-Statistik zeigt Darts und Trefferquote', rSum.includes('Trefferquote') && rSum.includes('Gekommen bis'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
const rCar = await carr();
const rWin = Object.values(rCar).find((s) => s.id === rA);
const rBefore = Object.values(cCar).find((s) => s.id === rA);
check('RTW-Sieg gespeichert', rWin.rtwWins === 1);
check('Bestleistung in Darts festgehalten', rWin.rtwBest > 0, String(rWin.rtwBest));
check('Round-the-World-Darts zählen NICHT in den 501-Average',
  rWin.darts === rBefore.darts && rWin.avg === rBefore.avg,
  `${rBefore.darts} -> ${rWin.darts} Darts`);
check('RTW verändert Doppelquote und 501-Bilanz nicht',
  rWin.doubleAttempts === rBefore.doubleAttempts && rWin.matches === rBefore.matches);
check('RTW zählt auch nicht in die Cricket-Werte', rWin.cricketDarts === rBefore.cricketDarts);

group('Statistik nach Spielmodus');
await page.locator('#nav [data-screen="boards"]').click();
check('Classic ist voreingestellt', await page.locator('[data-action="board-mode"][data-value="501"]').evaluate((e) => e.classList.contains('active')));
check('Classic-Kategorien sichtbar', (await page.locator('[data-action="board"][data-key="avg"]').count()) === 1);
check('Cricket-Kategorien nicht in Classic', (await page.locator('[data-action="board"][data-key="mpr"]').count()) === 0);
check('Verlaufsdiagramm für Classic', (await page.locator('#board-chart .chart').count()) === 1);
const lines = await page.locator('#board-chart .chart polyline').count();
check('eine Linie je Spieler', lines >= 2, `${lines} Linien`);
const legend = await page.locator('#board-chart .chart-legend .cl').count();
check('Legende mit Spielerfarben', legend === lines);
const colors = await page.locator('#board-chart .chart polyline').evaluateAll((els) => els.map((e) => e.getAttribute('stroke')));
check('jeder Spieler eine eigene Farbe', new Set(colors).size === colors.length, colors.join(' '));
check('Classic-Verlauf zeigt nur Classic-Spiele', (await text('#log-title')).toLowerCase().includes('classic'));

await page.locator('[data-action="board-mode"][data-value="cricket"]').click();
check('Cricket-Tab aktiv', (await page.locator('[data-action="board"][data-key="mpr"]').count()) === 1);
check('Average-Kategorie nicht bei Cricket', (await page.locator('[data-action="board"][data-key="avg"]').count()) === 0);
check('MPR-Rangliste gefüllt', (await page.locator('.board-row').count()) > 0);
check('Cricket-Verlauf getrennt', (await text('#match-log')).includes('Cricket') && !(await text('#match-log')).includes('Round the World'));

await page.locator('[data-action="board-mode"][data-value="rtw"]').click();
await page.locator('[data-action="board"][data-key="rtwBest"]').click();
check('RTW-Rangliste gefüllt', (await page.locator('.board-row').count()) > 0);
check('kein Diagramm für Round the World', !(await visible('#board-chart')));
check('RTW-Verlauf getrennt', (await text('#match-log')).includes('Round the World'));

await page.locator('[data-action="board-mode"][data-value="501"]').click();
await page.locator('#match-log .log-row').first().click();
check('Spielstatistik aus dem Verlauf abrufbar', await visible('#screen-summary'));
await page.locator('#summary-actions [data-action="summary-back"]').click();
check('Zurück aus der Statistik', await visible('#screen-boards'));

await page.locator('#nav [data-screen="players"]').click();
await page.locator('.player-card').first().click();
/* Überschriften werden per CSS groß gesetzt, daher ohne Groß-/Kleinschreibung prüfen. */
const det = (await text('#profile-detail')).toLowerCase();
check('Profil zeigt Cricket-Werte', det.includes('mpr') && det.includes('marken gesamt'));
check('Profil zeigt Round-the-World-Werte', det.includes('round the world') && det.includes('bestes ergebnis'));

group('Regression: gemeldete Fehler');
/* Frisch anfangen, damit die Prüfungen unabhängig vom bisherigen Verlauf sind. */
await page.evaluate(() => localStorage.clear());
await page.reload();
const ids = () => page.evaluate(() => window.__dart.state().profiles.map((p) => p.id));

// (1) Beendetes Match darf nach einem Reload nicht überschreibbar sein
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await page.locator('#mode-toggle button[data-mode="total"]').click();
await typeScore(141);
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
const winnerBefore = await page.evaluate(() => window.__dart.currentMatch().winner);
await page.reload();
check('Reload nach Matchende landet in der Spielstatistik, nicht im Spiel',
  await visible('#screen-summary'), await page.evaluate(() => window.__dart.state().screen));
check('das beendete Match ist unverändert',
  (await page.evaluate(() => window.__dart.currentMatch().winner)) === winnerBefore);
const dartsBefore = await page.evaluate(() => window.__dart.currentMatch().legs[0].visits.length);
await page.evaluate(() => { window.__dart.state().screen = 'game'; });
await page.reload();
await page.evaluate(() => window.__dart.submitTotal());
check('kein Nachtragen von Würfen in ein beendetes Match',
  (await page.evaluate(() => window.__dart.currentMatch().legs[0].visits.length)) === dartsBefore);

// (2) Einstellungen wirken nicht rückwirkend auf ein laufendes Turnier
await page.locator('#summary-actions [data-action="ov-next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180);
const restBefore = await rest(0);
await page.locator('#screen-game [data-action="to-tournament"]').click();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-setting="start"] button[data-value="301"]').click();
await page.locator('[data-setting="bestOf"] button[data-value="5"]').click();
await page.locator('#nav [data-screen="setup"]').click();
await page.locator('.match-row .go').first().click();
check('Startpunkte-Wechsel verschiebt das laufende Leg nicht', (await rest(0)) === restBefore, `${restBefore} -> ${await rest(0)}`);
check('Legs pro Spiel bleibt für das laufende Turnier gültig',
  !(await text('#game-leg-label')).includes('first to 3'), await text('#game-leg-label'));

// (3) Spieler ausblenden zerstört das laufende Turnier nicht
const standingsBefore = (await st()).length;
const loserId = await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  return m.p[0];
});
await page.evaluate((id) => {
  const s = window.__dart.state();
  s.profiles.find((p) => p.id === id).hidden = true;
  const i = s.lineup.indexOf(id);
  if (i >= 0) s.lineup.splice(i, 1);
}, loserId);
check('Tabelle behält alle Turnierteilnehmer', (await st()).length === standingsBefore, `${standingsBefore} -> ${(await st()).length}`);
await page.evaluate((id) => {
  const s = window.__dart.state();
  s.profiles.find((p) => p.id === id).hidden = false;
  if (s.lineup.indexOf(id) < 0) s.lineup.push(id);
}, loserId);

// (4) Neues Turnier fragt nach, wenn Ergebnisse vorliegen
await page.locator('#screen-game [data-action="to-tournament"]').click();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-action="start-game"]').click();
check('Rückfrage vor dem Verwerfen eines laufenden Turniers',
  (await text('#overlay-card')).includes('Laufendes Turnier beenden'));
await page.locator('#overlay-card [data-action="ov-cancel"]').click();

// (5) Doppeltipp auf die Schnellwahl bucht nur eine Aufnahme
await page.locator('#nav [data-screen="setup"]').click();
await page.locator('.match-row .go').first().click();
await page.waitForTimeout(400);
const visitsBefore = await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length);
await page.locator('[data-quick="60"]').dblclick();
check('Doppeltipp auf die Schnellwahl zählt einmal',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === visitsBefore + 1);

// (6) Multiplikator springt im Cricket zurück auf Single
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('dart-turnier-v1'));
  s.matches = []; s.tour = null; s.current = null; s.screen = 'setup';
  localStorage.setItem('dart-turnier-v1', JSON.stringify(s));
});
await page.reload();
await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('Single-, Double- und Triple-Block vorhanden',
  (await page.locator('#cricket-grid .cg-block').count()) === 4);
check('alle sechs Zahlen je Block', (await page.locator('#cricket-grid button[data-mult="3"]').count()) === 6);
await cDart('T20');
await cDart('S19');
check('Single und Triple ohne Umschalten',
  await page.evaluate(() => {
    const g = window.__dart.game(), st = window.__dart.cricketState();
    return st.marks[g.players[0]][20] === 3 && st.marks[g.players[0]][19] === 1;
  }));
check('MPR steht unter dem Namen', (await text('#cricket-board')).includes('MPR'));

// (7) Beschädigter Speicherstand wirft Profile und Archiv nicht weg
const profileCount = (await ids()).length;
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('dart-turnier-v1'));
  delete s.settings;
  delete s.mode;
  localStorage.setItem('dart-turnier-v1', JSON.stringify(s));
});
await page.reload();
check('unvollständiger Stand wird ergänzt statt verworfen', (await ids()).length === profileCount, `${profileCount} -> ${(await ids()).length}`);

// (8) Kaputter Spielstand bringt den Cricket-Screen nicht zum Absturz
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('dart-turnier-v1'));
  s.screen = 'cricket';
  s.game = { id: 'x', kind: 'cricket', throws: [], done: false };
  localStorage.setItem('dart-turnier-v1', JSON.stringify(s));
});
await page.reload();
check('Spielstand ohne Spielerliste wird verworfen, App bleibt bedienbar', await visible('#screen-setup'));

group('Neue Funktionen aus der Prüfung');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(100); await typeScore(60); await typeScore(140);
check('Wer am Wurf ist, steht im Klartext', (await text('#game-turn')).includes('Am Wurf'));

// Aufnahme nachträglich korrigieren
await page.locator('#history .col').first().locator('.v').last().click();
check('Korrektur-Dialog offen', (await text('#overlay-card')).includes('Aufnahme korrigieren'));
for (const d of ['1', '4', '0']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('korrigierter Wert übernommen',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits[0].s)) === 140);
check('Reststand folgt der Korrektur', (await rest(0)) === String(501 - 140 - 140), await rest(0));
await page.locator('#history .col').first().locator('.v').last().click();
for (const d of ['1', '7', '9']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('unmöglicher Wert wird abgelehnt', (await text('#overlay-card')).includes('nicht möglich'));
for (const d of ['d', 'e', 'l']) await page.locator('[data-editkey="del"]').click();
for (const d of ['5', '0', '0']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('zu hoher Wert wird abgelehnt', (await text('#overlay-card')).includes('Maximal 180'));
await page.locator('#overlay-card [data-action="ov-cancel"]').click();

// Spieler nachtragen und abmelden
await page.locator('#screen-game [data-action="to-tournament"]').click();
const matchesBefore = await page.evaluate(() => window.__dart.state().matches.length);
await page.locator('[data-action="roster-change"]').click();
await page.locator('#overlay-card [data-action="withdraw-player"]').first().click();
const voided = await page.evaluate(() => window.__dart.state().matches.filter((m) => m.void).length);
check('offene Spiele des Abgemeldeten entfallen', voided > 0, String(voided));
check('gespielte Spiele bleiben erhalten',
  (await page.evaluate(() => window.__dart.state().matches.filter((m) => m.done && m.void).length)) === 0);
await page.locator('#overlay-card [data-action="ov-cancel"]').click();
check('Tabelle behält den Abgemeldeten', (await st()).length === 4);
await page.locator('[data-action="roster-change"]').click();
const addable = await page.locator('#overlay-card [data-action="add-player"]').count();
if (addable === 0) {
  await page.locator('#overlay-card [data-action="ov-cancel"]').click();
  await page.locator('#nav [data-screen="players"]').click();
  await page.locator('#screen-players [data-action="new-profile"]').click();
  await page.locator('[data-role="profile-name"]').fill('Nachzügler');
  await page.locator('[data-action="save-profile"]').click();
  await page.locator('#nav [data-screen="setup"]').click();
  await page.locator('[data-action="roster-change"]').click();
}
await page.locator('#overlay-card [data-action="add-player"]').first().click();
await page.locator('#overlay-card [data-action="ov-cancel"]').click();
check('Nachzügler bekommt Spiele gegen alle',
  (await page.evaluate(() => window.__dart.state().matches.length)) > matchesBefore,
  `${matchesBefore} -> ${await page.evaluate(() => window.__dart.state().matches.length)}`);
check('Nachzügler steht in der Tabelle', (await st()).length === 5);

group('Regression: Nebenwirkungen der ersten Korrekturrunde');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();

// Zwei gleiche Aufnahmen kurz nacheinander müssen beide zählen
await page.locator('[data-quick="60"]').click();
await page.waitForTimeout(200);
await page.locator('[data-quick="60"]').click();
check('zwei gleiche Aufnahmen hintereinander zählen beide',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === 2);

// Legzeile folgt dem Turnier, nicht dem Setup
await page.locator('#screen-game [data-action="to-tournament"]').click();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-setting="bestOf"] button[data-value="5"]').click();
await page.locator('#nav [data-screen="setup"]').click();
await page.locator('.match-row .go').first().click();
check('Legzeile zeigt weiter die Turnierregel',
  (await text('#game-leg-label')).includes('Ein Leg'), await text('#game-leg-label'));

// Ergebnis nach dem Overlay noch korrigierbar (Spieler hat schon 60 geworfen)
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await page.locator('#mode-toggle button[data-mode="total"]').click();
await typeScore(81);
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
await page.locator('#overlay-card [data-action="open-summary"]').click();
check('Spielstatistik bietet das Zurücknehmen an',
  (await page.locator('#summary-actions [data-action="reopen-match"]').count()) === 1);
await page.locator('#summary-actions [data-action="reopen-match"]').click();
check('Match ist wieder offen', await page.evaluate(() => !window.__dart.currentMatch().done));
check('das Finish wurde zurückgenommen', (await rest(0)) === '81', await rest(0));

// Dialoge lassen sich per Tipp daneben schließen
await page.locator('#history .col').first().locator('.v').last().click();
check('Korrektur-Dialog offen', await visible('#overlay'));
await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
check('Tipp neben den Dialog schließt ihn', !(await visible('#overlay')));

group('Regression: zweite Prüfungsrunde');
await page.evaluate(() => localStorage.clear());
await page.reload();

// Doppeltipp auf "Nächstes Spiel" darf den Bull-Off nicht überspringen
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').dblclick();
check('Doppeltipp überspringt den Bull-Off nicht', await visible('#screen-bulloff'),
  await page.evaluate(() => window.__dart.state().screen));
await page.locator('#bulloff-buttons button').first().click();

// Doppeltipp auf "Start" im Spielplan darf keine Aufnahme buchen
await page.locator('#screen-game [data-action="to-tournament"]').click();
await page.locator('.match-row .go').first().dblclick();
check('Doppeltipp auf Start bucht keine Aufnahme',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === 0);

// Doppelquote: gleiche Würfe über beide Eingabewege
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
/* Rest 141 -> T20/T19 lassen 24 stehen, der dritte Dart liegt also auf
   einem möglichen Doppel und zählt als Versuch. */
await dart('T20'); await dart('T19'); await dart('S4');
await typeScore(60);
await dart('D10');   // Rest 20, getroffen -> Versuch mit Treffer
const quoteDartWeg = await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  const s = window.__dart.stats();
  return { versuche: s[m.p[0]].doubleAttempts, treffer: s[m.p[0]].doubleHits, quote: s[m.p[0]].doubleQuote };
});
check('Doppelversuche werden dartgenau gezählt',
  quoteDartWeg.versuche === 2 && quoteDartWeg.treffer === 1 && Math.round(quoteDartWeg.quote) === 50,
  JSON.stringify(quoteDartWeg));
const quotePunkteWeg = await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  const leg = m.legs[0];
  // Aufnahme ohne Einzeldarts (wie über die Punkte-Eingabe) einfügen
  leg.visits.push({ p: m.p[1], s: 20, d: 3, b: false, c: false, o: 0 });
  const st = window.__dart.stats();
  return { versuche: st[m.p[1]].doubleAttempts, treffer: st[m.p[1]].doubleHits };
});
check('Punkte-Eingabe erzeugt keine geschätzten Doppelversuche',
  quotePunkteWeg.versuche === 0, JSON.stringify(quotePunkteWeg));

// Obergrenze beim Nachtragen
await page.evaluate(() => {
  const s = window.__dart.state();
  while (s.profiles.length < 15) {
    s.profiles.push({ id: 'x' + s.profiles.length, name: 'Test' + s.profiles.length, avatar: null, hue: 200, created: Date.now() });
  }
  s.tour.players = s.profiles.slice(0, 12).map((p) => p.id);
});
await page.evaluate(() => window.__dart.action('add-player', { getAttribute: () => 'x13' }));
check('Nachtragen achtet die Obergrenze von 12',
  (await page.evaluate(() => window.__dart.state().tour.players.length)) === 12);

group('Aufnahme im Einzel-Dart-Modus abschließen');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
check('Einzel-Darts aktiv', await visible('#pad-darts'));
check('Knopf heißt 0 Punkte, solange nichts geworfen ist',
  (await page.locator('[data-action="end-visit"]').innerText()).includes('0 Punkte'));
await page.locator('[data-action="end-visit"]').click();
check('drei Fehlwürfe in einem Tipp', (await rest(0)) === '141', await rest(0));
check('Aufnahme zählt drei Darts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.slice(-1)[0])).d === 3);
await typeScore(60);
await dart('T20');
check('Knopf heißt Weiter, sobald ein Dart steht',
  (await page.locator('[data-action="end-visit"]').innerText()).includes('Weiter'));
await page.locator('[data-action="end-visit"]').click();
check('angefangene Aufnahme wird übernommen', (await rest(0)) === '81', await rest(0));
check('auch dann drei Darts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.slice(-1)[0])).d === 3);

group('Wurfverlauf über das ganze Match');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('[data-setting="bestOf"] button[data-value="3"]').click();
await page.locator('[data-action="start-game"]').click();
await page.locator('[data-action="next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
/* Leg 1 gewinnen: 180, 180, 141 */
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await page.locator('#mode-toggle button[data-mode="total"]').click();
await typeScore(141);
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await typeScore(100); await typeScore(60); await typeScore(85);
const histText = (await text('#history')).replace(/\s+/g, ' ');
const histLower = histText.toLowerCase();
check('Verlauf zeigt auch das vorige Leg', histLower.includes('leg 1'), histText.slice(0, 120));
check('Leg-Trenner nennt den Ausgang', histLower.includes('gewonnen') || histLower.includes('verloren'));
check('mehr als fünf Aufnahmen sichtbar',
  (await page.locator('#history .v').count()) > 5, String(await page.locator('#history .v').count()));
check('alle Aufnahmen des Matches enthalten',
  (await page.locator('#history .v').count()) ===
  (await page.evaluate(() => window.__dart.currentMatch().legs.reduce((a, l) => a + l.visits.length, 0))));
check('Verlauf ist scrollbar', await page.locator('#history').evaluate((e) => getComputedStyle(e).overflowY === 'auto'));
check('nur das laufende Leg ist korrigierbar',
  (await page.locator('#history .v.tap').count()) === 3,
  String(await page.locator('#history .v.tap').count()));

group('Cricket: Reihenfolge, graue Zahlen, Aufnahme abkürzen');
await page.evaluate(() => localStorage.clear());
await page.reload();
check('vier Spieler in der Aufstellung', (await page.evaluate(() => window.__dart.state().lineup.length)) === 4);
await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
await page.locator('[data-action="start-game"]').click();
check('Bull-Off zeigt die ganze Reihenfolge', (await page.locator('.bo-row').count()) === 4,
  String(await page.locator('.bo-row').count()));
const orderBefore = await page.evaluate(() => window.__dart.game().players.slice());
await page.locator('.bo-row').nth(3).locator('[data-action="order-up"]').click();
const orderAfter = await page.evaluate(() => window.__dart.game().players.slice());
check('Hoch-Button schiebt einen Spieler nach vorn',
  orderAfter[2] === orderBefore[3] && orderAfter[3] === orderBefore[2], orderAfter.join(','));
await page.locator('.bo-row').first().locator('[data-action="order-down"]').click();
const orderAfter2 = await page.evaluate(() => window.__dart.game().players.slice());
check('Runter-Button schiebt einen Spieler zurück', orderAfter2[1] === orderBefore[0], orderAfter2.join(','));
check('erste Reihe kann nicht weiter nach oben',
  await page.locator('.bo-row').first().locator('[data-action="order-up"]').isDisabled());
check('letzte Reihe kann nicht weiter nach unten',
  await page.locator('.bo-row').last().locator('[data-action="order-down"]').isDisabled());
check('Startknopf nennt den ersten Spieler',
  (await text('[data-action="start-order"]')).toLowerCase()
    .includes((await page.evaluate((id) => window.__dart.state().profiles.find((p) => p.id === id).name, orderAfter2[0])).toLowerCase()));
await page.locator('[data-action="start-order"]').click();
check('Cricket startet in der eingestellten Reihenfolge',
  (await visible('#screen-cricket')) &&
  (await page.evaluate(() => window.__dart.gameTurnPlayer())) === orderAfter2[0]);

// Aufnahme abkürzen: ein Tipp statt dreimal Miss
const throwsBefore = await page.evaluate(() => window.__dart.game().throws.length);
await page.locator('#cricket-grid [data-action="end-cricket-visit"]').click();
check('Weiter-Knopf füllt die Aufnahme mit drei Fehlwürfen',
  (await page.evaluate(() => window.__dart.game().throws.length)) === throwsBefore + 3);
check('danach ist der nächste Spieler am Wurf',
  (await page.evaluate(() => window.__dart.gameTurnPlayer())) === orderAfter2[1]);
await cDart('T20');
const throwsMid = await page.evaluate(() => window.__dart.game().throws.length);
await page.locator('#cricket-grid [data-action="end-cricket-visit"]').click();
check('angefangene Aufnahme wird auf drei Darts aufgefüllt',
  (await page.evaluate(() => window.__dart.game().throws.length)) === throwsMid + 2);

// Zahl bei allen zu: ausgegraut
await page.evaluate(() => {
  const g = window.__dart.game();
  g.throws.length = 0;
  g.players.forEach(() => { for (let i = 0; i < 3; i++) g.throws.push({ n: 20, m: 3 }); });
  window.__dart.render();
});
check('20 ist bei allen zu', await page.evaluate(() => {
  const st = window.__dart.cricketState(), g = window.__dart.game();
  return g.players.every((id) => st.marks[id][20] >= 3);
}));
check('geschlossene Zahl ist auf der Tafel ausgegraut',
  (await page.locator('.cr-num.dead').count()) === 1, String(await page.locator('.cr-num.dead').count()));
check('auch die Marken der Zeile sind grau',
  (await page.locator('.cr-mark.dead').count()) === (await page.evaluate(() => window.__dart.game().players.length)));
const deadColor = await page.locator('.cr-num.dead').first().evaluate((e) => getComputedStyle(e).color);
const liveColor = await page.locator('.cr-num:not(.dead)').first().evaluate((e) => getComputedStyle(e).color);
check('graue Zahl unterscheidet sich sichtbar', deadColor !== liveColor, `${deadColor} vs ${liveColor}`);
check('Eingabefelder der toten Zahl sind ebenfalls grau',
  (await page.locator('#cricket-grid button.dim').count()) === 3,
  String(await page.locator('#cricket-grid button.dim').count()));
const cgKey = page.locator('#cricket-grid button[data-mult="3"]').first();
check('Eingabefelder am Handy groß genug zum schnellen Tippen',
  (await cgKey.boundingBox()).height >= 52, String((await cgKey.boundingBox()).height));
await page.setViewportSize({ width: 1194, height: 834 });
await page.waitForTimeout(120);
check('Eingabefelder am iPad deutlich größer',
  (await cgKey.boundingBox()).height >= 70, String((await cgKey.boundingBox()).height));
check('Weiter-Knopf steht neben Miss',
  (await page.locator('#cricket-grid .cg-extra button').count()) === 4);
await page.setViewportSize({ width: 390, height: 844 });

/* ---------- Finisher ---------- */

/* Ein Dart im Finisher. Die Zahlen 1–20 richten sich nach der eingestellten
   Multiplikatorreihe, 25 und Bull haben sie fest am Knopf. */
async function finDart(label) {
  if (label === 'BULL') return page.locator('#fin-pad button[data-num="25"][data-mult="2"]').click();
  if (label === '25') return page.locator('#fin-pad button[data-num="25"][data-mult="1"]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.slice(1), 10);
  await page.locator(`#fin-pad .mult-row button[data-mult="${mult}"]`).click();
  return page.locator(`#fin-pad .num-grid button[data-num="${num}"]`).click();
}

/* Der Solver sagt uns, wie die gezogene Zahl zu treffen ist – so kann der
   Test jede Zufallszahl auschecken, ohne sie vorher zu kennen. */
async function finCheckout() {
  const route = await page.evaluate(() => {
    const g = window.__dart.game();
    const st = window.__dart.finisherState();
    return window.Checkout.suggest(st.rest[g.players[st.turn]], 3 - st.inVisit);
  });
  if (!route) return false;
  for (const label of route) await finDart(label);
  return true;
}

async function finMiss(n) {
  for (let i = 0; i < n; i++) await page.locator('#fin-pad button.miss').click();
}

const finState = () => page.evaluate(() => window.__dart.finisherState());

/* Angefangene Aufnahme zu Ende werfen, damit wieder drei Darts zur Verfügung
   stehen – sonst findet der Solver für den Rest keinen Weg mehr. */
async function finVisitEnde() {
  let st = await finState();
  while (st.inVisit !== 0) {
    await page.locator('#fin-pad button.miss').click();
    st = await finState();
  }
}

/* Eine ganze Runde: der Spieler am Wurf checkt aus, der andere zieht nicht
   nach. Danach ist die Runde entschieden und die nächste Zahl gezogen. */
async function finRundeGewinnen() {
  await finVisitEnde();
  const ok = await finCheckout();
  await finMiss(3);
  return ok;
}

group('Finisher: alle auf dieselbe Zahl');
await page.evaluate(() => window.__dart.setScreen('setup'));
await reduceLineupToTwo();
await page.locator('[data-action="set-mode"][data-value="finisher"]').click();
check('Finisher-Einstellungen sichtbar', await visible('#settings-finisher'));
check('X01-Einstellungen ausgeblendet', !(await visible('#settings-501')));
check('Startknopf unverändert', (await textKlein('[data-action="start-game"]')).includes('spiel starten'));
await page.locator('[data-setting="finisherTo"] button[data-value="3"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('Finisher-Screen', await visible('#screen-finisher'));

let fst = await finState();
const [fA, fB] = await page.evaluate(() => window.__dart.game().players);
check('Zahl liegt zwischen 6 und 120', fst.zahl >= 6 && fst.zahl <= 120, String(fst.zahl));
check('beide starten auf derselben Zahl', fst.rest[fA] === fst.zahl && fst.rest[fB] === fst.zahl);
check('Zahl steht groß auf der Tafel', (await text('#fin-board')).includes(String(fst.zahl)));
check('noch keine Punkte', fst.punkte[fA] === 0 && fst.punkte[fB] === 0);

/*
 * Bust. Die Zielzahl ist zufällig, also braucht es einen Wurf, der bei JEDER
 * Zahl von 6 bis 120 überwirft: T20. Bis 60 liegt er drüber, bei genau 60
 * trifft er null ohne Doppel – auch das ist ein Bust. Über 60 bustet
 * spätestens der zweite.
 *
 * (Vorher stand hier eine gerechnete Zahl, gedeckelt auf 20 – die bustete
 * bei großen Zielzahlen nicht und der Test ging nur mit Glück durch.)
 */
async function t20() {
  await page.locator('#fin-pad .mult-row button[data-mult="3"]').click();
  await page.locator('#fin-pad .num-grid button[data-num="20"]').click();
}
const zielzahl = fst.zahl;
await t20();
if ((await finState()).rest[fA] !== zielzahl) await t20();
fst = await finState();
check('Bust setzt den Rest zurück', fst.rest[fA] === zielzahl, String(fst.rest[fA]) + ' statt ' + zielzahl);
check('die Darts zählen trotzdem', fst.darts[fA] >= 1, String(fst.darts[fA]));
check('nach dem Bust ist der Gegner dran', fst.turn === 1);

await finMiss(3);
fst = await finState();
check('Miss bringt nichts', fst.rest[fB] === fst.zahl);
check('wieder der Erste am Wurf', fst.turn === 0);

check('Spieler A checkt die Zahl', await finCheckout());
fst = await finState();
check('A ist durch', !!fst.fertig[fA]);
check('Runde läuft noch – B war noch nicht dran', !fst.rundeVorbei);
check('B darf gleichziehen', fst.turn === 1);

await finMiss(3);
fst = await finState();
check('Runde vorbei, sobald alle gleich oft dran waren', fst.punkte[fA] === 1);
check('neue Runde mit neuer Zahl', fst.runde === 1 && fst.zahl >= 6 && fst.zahl <= 120);
check('alle wieder auf Anfang', fst.rest[fA] === fst.zahl && fst.rest[fB] === fst.zahl);

group('Finisher: Stechen, wenn beide gleichziehen');
// Beide checken dieselbe Zahl in ihrer ersten Aufnahme aus.
check('A checkt aus', await finCheckout());
await finVisitEnde();
check('B zieht gleich', await finCheckout());
fst = await finState();
const stechenDa = await page.evaluate(() => !!window.__dart.finisherRunde().stechen);
check('beide gefinished, also Stechen', stechenDa);
check('Punkte noch unverändert', fst.punkte[fA] === 1 && fst.punkte[fB] === 0);
check('Stechen steht sichtbar auf dem Schirm', await page.locator('.fin-stechen').isVisible());
/* innerText liefert Überschriften so, wie sie dastehen – und h2 ist per CSS
   in Großbuchstaben. Deshalb ohne Rücksicht auf die Schreibweise prüfen. */
check('mit beiden Namen darin', await page.evaluate((ids) => {
  const t = document.querySelector('.fin-stechen').innerText.toLowerCase();
  return ids.every((n) => t.includes(n.toLowerCase()));
}, await page.evaluate((ids) => ids.map((i) => window.__dart.profile(i).name), [fA, fB])));
check('Zahlenfeld ist gesperrt', (await text('#fin-pad')).includes('Stechen entscheiden'));
await page.locator(`[data-action="fin-stechen"][data-id="${fB}"]`).click();
fst = await finState();
check('der Getippte bekommt den Punkt', fst.punkte[fB] === 1);

group('Finisher: dritte Runde');
check('A gewinnt die dritte Runde', await finRundeGewinnen());
fst = await finState();
check('A führt mit 2 zu 1', fst.punkte[fA] === 2 && fst.punkte[fB] === 1, JSON.stringify(fst.punkte));

/* Undo über eine Rundengrenze hinweg: die frische Runde wird verworfen und
   die entschiedene wieder geöffnet – sonst käme man aus einer neu gezogenen
   Zahl nie mehr zurück. */
group('Finisher: Undo über die Rundengrenze');
const rundeVorher = fst.runde;
await page.locator('#screen-finisher [data-action="undo-game"]').click();
fst = await finState();
check('die frische Runde ist weg', fst.runde === rundeVorher - 1);
check('der Punkt ist zurückgenommen', fst.punkte[fA] === 1);
check('die Runde ist wieder offen',
  !(await page.evaluate(() => !!window.__dart.finisherRunde().sieger)));
check('Spiel läuft weiter', !(await page.evaluate(() => window.__dart.game().done)));

// Die wieder geöffnete Runde zu Ende spielen – A steht ja schon auf null.
await finVisitEnde();
fst = await finState();
check('erneut gewonnen, wieder 2 zu 1', fst.punkte[fA] === 2 && fst.punkte[fB] === 1, JSON.stringify(fst.punkte));

group('Finisher: Spielende');
check('A gewinnt die letzte Runde', await finRundeGewinnen());
fst = await finState();
check('A hat drei Punkte', fst.punkte[fA] === 3, JSON.stringify(fst.punkte));
check('Spiel ist beendet', await page.evaluate(() => window.__dart.game().done));
check('Sieger steht fest', await page.evaluate((id) => window.__dart.game().winner === id, fA));
check('Glückwunsch-Overlay', (await text('#overlay-card')).includes('Glückwunsch'));

await page.locator('#overlay-card [data-action="open-summary"]').click();
const finSum = await text('#summary-box');
check('Auswertung zeigt Punkte und Darts', finSum.includes('Punkte') && finSum.includes('Ø Darts je Finish'));
check('Auswertung listet die Runden', finSum.includes('Runde 1'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
check('Finisher gespeichert',
  (await page.evaluate(() => window.__dart.state().history.filter((h) => h.kind === 'finisher').length)) === 1);

const finCar = await carr();
check('Karriere zählt gewonnene Runden', finCar[fA].finRounds === 3, String(finCar[fA].finRounds));
check('Karriere zählt den Spielsieg', finCar[fA].finWins === 1);
check('auch der Verlierer hat seine Runde', finCar[fB].finRounds === 1, String(finCar[fB].finRounds));
check('zusammen sind es vier Runden', finCar[fA].finRounds + finCar[fB].finRounds === 4);
check('schnellstes Finish ist gesetzt', finCar[fA].finBest > 0);

await page.locator('#nav [data-screen="boards"]').click();
await page.locator('[data-action="board-mode"][data-value="finisher"]').click();
check('Finisher-Rangliste da', (await text('#board-list')).length > 0);
check('kein Diagramm im Finisher', !(await visible('#board-chart')));

/* ---------- Turnier vorzeitig beenden ---------- */

group('Turnier beenden: Gespieltes bleibt, Offenes faellt weg');
await page.evaluate(() => window.__dart.setScreen('setup'));
await page.evaluate(() => {
  const S = window.__dart.state();
  S.lineup = window.__dart.activeProfiles().slice(0, 4).map((p) => p.id);
  S.mode = '501';
  window.__dart.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="501"]').click();
await page.locator('[data-action="start-game"]').click();
await page.waitForTimeout(300);

/* Zwei der sechs Partien zu Ende spielen, die anderen offen lassen. */
const vorher = await page.evaluate(() => {
  const c = window.__dart.career();
  return Object.keys(c).reduce((s, k) => s + c[k].matches, 0);
});
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.matches.slice(0, 2).forEach((m) => {
    m.starter = m.p[0];
    m.legs = [{ starter: m.p[0], visits: [
      { p: m.p[0], s: 180, d: 3, b: false, c: false },
      { p: m.p[1], s: 100, d: 3, b: false, c: false },
      { p: m.p[0], s: 180, d: 3, b: false, c: false },
      { p: m.p[1], s: 100, d: 3, b: false, c: false },
      { p: m.p[0], s: 141, d: 3, b: false, c: true }
    ], winner: m.p[0], start: 501 }];
    m.done = true; m.winner = m.p[0]; m.at = Date.now();
  });
  D.setScreen('tournament');
});
check('zwei Partien fertig, vier offen', await page.evaluate(() =>
  window.__dart.state().matches.filter((m) => m.done).length === 2 &&
  window.__dart.state().matches.filter((m) => !m.done).length === 4));

/* Der Weg dorthin, den Julius sucht: die Fortsetzen-Box im Setup. */
await page.evaluate(() => window.__dart.setScreen('setup'));
check('Fortsetzen-Box ist da', await visible('#resume-box'));
check('und hat einen Beenden-Knopf', await page.locator('#resume-box [data-action="beenden"]').isVisible());
await page.locator('#resume-box [data-action="beenden"]').click();
const rfrage = await textKlein('#overlay-card');
check('fragt vorher nach', rfrage.includes('vorzeitig beenden'));
check('nennt die gespielten Partien', rfrage.includes('2 gespielte spiele'));
check('nennt die offenen', rfrage.includes('4 offenen partien'));
await page.locator('#overlay-card [data-action="ov-reset"]').click();

check('Turnier ist weg', (await page.evaluate(() => window.__dart.state().matches.length)) === 0);
check('zurück im Setup', await visible('#screen-setup'));
const nachher = await page.evaluate(() => {
  const c = window.__dart.career();
  return Object.keys(c).reduce((s, k) => s + c[k].matches, 0);
});
check('die zwei gespielten Partien zaehlen weiter', nachher === vorher + 4, vorher + ' -> ' + nachher);
check('die offenen nicht', nachher !== vorher + 12);

/* ---------- Schnelles Spiel ---------- */

group('Schnelles Spiel: alle gleichzeitig, ein Leg');
/* Vorher merken: in der Karriere stehen schon Siege aus den Tests davor,
   also zaehlt hier die Differenz und nicht der absolute Stand. */
const wonVorher = await page.evaluate(() => {
  const c = window.__dart.career();
  return Object.keys(c).reduce((s, k) => s + c[k].won, 0);
});
await page.evaluate(() => window.__dart.setScreen('setup'));
await page.evaluate(() => {
  const S = window.__dart.state();
  S.lineup = window.__dart.activeProfiles().slice(0, 3).map((p) => p.id);
  window.__dart.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
check('teilt sich die Einstellungen mit dem Turnier', await visible('#settings-501'));
check('kein Legs-Feld – es gibt nur eines', !(await visible('#setting-bestof')));
await page.locator('#settings-501 [data-setting="start"] button[data-value="301"]').click();
/* Für diesen Durchlauf bleibt die Punkte-Eingabe an: sonst schaltet die App
   im Finish-Bereich auf Einzel-Darts um und das Zahlenfeld ist weg. Der
   Umschaltpunkt selbst wird oben im X01-Teil geprüft. */
await page.locator('#settings-501 [data-setting="dartModeFrom"] button[data-value="0"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('läuft auf dem X01-Bildschirm', await visible('#screen-game'));

const qIds = await page.evaluate(() => window.__dart.currentMatch().p);
check('alle drei Spieler auf der Tafel', (await page.locator('#scoreboard .pcard').count()) === 3);
check('alle starten auf 301', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), leg = D.activeLeg(m);
  return m.p.every((id) => D.remainingIn(leg, id) === 301);
}));
check('kein Turnier-Zaehler in der Kopfzeile',
  (await textKlein('#game-match-label')).includes('schnelles spiel'));

/* Reihum: nach drei Darts ist der Naechste dran, nicht wieder der Erste. */
const amWurf = () => page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return D.activePlayer(D.activeLeg(m), m);
});
await typeScore(60);
check('nach der ersten Aufnahme ist Spieler 2 dran', (await amWurf()) === qIds[1]);
await typeScore(60);
check('dann Spieler 3', (await amWurf()) === qIds[2]);
await typeScore(60);
check('danach ist wieder Spieler 1 dran', (await amWurf()) === qIds[0]);

/* Ab drei Spielern sagt der Verlauf dazu, wer geworfen hat – sonst stünden
   dort nur Zahlen, die niemandem zuzuordnen sind. */
const qNamen = await page.evaluate((ids) => ids.map((id) =>
  window.__dart.state().profiles.find((p) => p.id === id).name), qIds);
const qLog = await text('#history');
check('Verlauf ist eine Liste statt Spalten',
  await page.evaluate(() => document.getElementById('history').classList.contains('einspaltig')));
check('jede Aufnahme nennt ihren Werfer',
  qNamen.every((n) => qLog.includes(n)), qLog.replace(/\s+/g, ' ').slice(0, 120));
check('der Verlauf hat eine Zeile je Aufnahme',
  (await page.locator('#history .v').count()) === 3);

/* Spieler 1 checkt aus: 301 - 60 = 241 - 180 = 61 - 41 = 20, dann D10. */
await typeScore(180);
await typeScore(60); await typeScore(60);            // die anderen beiden
await typeScore(41);                                  // Spieler 1 auf Rest 20
await typeScore(60); await typeScore(60);            // die anderen beiden
await typeScore(20);                                  // Finish – App fragt nach den Darts
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
check('Spiel ist entschieden', await page.evaluate(() => window.__dart.currentMatch().done));
check('Sieger ist Spieler 1', await page.evaluate((id) => window.__dart.currentMatch().winner === id, qIds[0]));
check('Glückwunsch-Overlay', (await textKlein('#overlay-card')).includes('glückwunsch'));

await page.locator('#overlay-card [data-action="open-summary"]').click();
const qSum = await text('#summary-box');
check('Auswertung nennt alle drei', qIds.every((id) => qSum.includes('Darts geworfen')));
check('Auswertung nennt den Modus', (await textKlein('#summary-box')).includes('schnelles spiel'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
check('im Archiv gelandet',
  (await page.evaluate(() => window.__dart.state().history.filter((h) => h.kind === 'quick').length)) === 1);

const qCar = await carr();
check('zaehlt als Spiel fuer alle drei', qIds.every((id) => qCar[id].matches >= 1));
const wonNachher = Object.keys(qCar).reduce((s, k) => s + qCar[k].won, 0);
check('genau ein Sieg dazugekommen', wonNachher === wonVorher + 1,
  wonVorher + ' -> ' + wonNachher);
check('der Sieger hat ihn', qCar[qIds[0]].won >= 1);
check('Average wurde gerechnet', qCar[qIds[0]].avg > 0);

/* ---------- Round the World: Spielart Einfach ---------- */

group('Round the World: Einfach zählt nur die Zahl');
const rtwAufbau = async (boost, spieler) => {
  await page.evaluate((n) => {
    const D = window.__dart, S = D.state();
    S.game = null;
    S.lineup = D.activeProfiles().slice(0, n).map((p) => p.id);
    D.setScreen('setup');
  }, spieler);
  await page.locator('[data-action="set-mode"][data-value="rtw"]').click();
  await page.locator('#settings-rtw [data-setting="rtwBoost"] button[data-value="' + boost + '"]').click();
  await page.locator('[data-action="start-game"]').click();
  await page.locator('#bulloff-buttons button').first().click();
};
await rtwAufbau(0, 2);
const eZiel = async () => {
  const [id] = await page.evaluate(() => window.__dart.game().players);
  return (await page.evaluate(() => window.__dart.rtwState())).target[id];
};
check('Einfach steht in der Kopfzeile', (await textKlein('#rtw-sub')).includes('einfach'),
  await text('#rtw-sub'));
check('kein Doppel zur Wahl', (await page.locator('#rtw-pad [data-mult="2"]').count()) === 0);
check('kein Triple zur Wahl', (await page.locator('#rtw-pad [data-mult="3"]').count()) === 0);
check('nur eine Treffer-Taste', (await page.locator("#rtw-pad .rtw-treffer .rtw-key").count()) === 1);
await rDart('S1');
check('ein Treffer rückt genau ein Feld weiter', (await eZiel()) === 2, String(await eZiel()));
/* Der entscheidende Unterschied: derselbe Wurf, der im Boost zwei Felder
   überspringen würde, zählt hier auch nur eins. Getippt wird er über die
   einzige Taste – ein Triple gibt es in dieser Spielart gar nicht. */
await page.evaluate(() => window.__dart.rtwDart(3, 2));
check('auch ein Triple rückt nur ein Feld weiter', (await eZiel()) === 3, String(await eZiel()));
check('die Spielart steht am Spiel, nicht in den Einstellungen',
  await page.evaluate(() => window.__dart.game().boost === false));

/* ---------- Round the World: Stechen bei Gleichstand ---------- */

group('Round the World: Nearest to the Bull bei Gleichstand');
await rtwAufbau(1, 2);
const rtwIds = await page.evaluate(() => window.__dart.game().players);
/* Beide werfen dieselbe Folge: 1-4-7-10-13-16-19-Bull in acht Darts. Damit
   sind sie gleichauf, und der frühere Treffer darf nicht entscheiden.
   Geworfen wird abwechselnd – nach drei Darts ist der Nächste dran. */
const aufnahme = async (...wuerfe) => { for (const w of wuerfe) await rDart(w); };
await aufnahme('T1', 'T4', 'T7');        // Spieler 1 auf 10
await aufnahme('T1', 'T4', 'T7');        // Spieler 2 auf 10
await aufnahme('T10', 'T13', 'T16');     // Spieler 1 auf 19
await aufnahme('T10', 'T13', 'T16');     // Spieler 2 auf 19
await aufnahme('T19', 'S25');            // Spieler 1 fertig, 8 Darts
await aufnahme('T19', 'S25');            // Spieler 2 zieht gleich, 8 Darts
const rtwSt = () => page.evaluate(() => window.__dart.rtwState());
check('beide sind mit acht Darts fertig', await page.evaluate((ids) => {
  const s = window.__dart.rtwState();
  return ids.every((id) => s.finished[id] && s.finished[id].darts === 8);
}, rtwIds), JSON.stringify((await rtwSt()).finished));
check('kein Sieger ohne Stechen', (await rtwSt()).winner === null);
check('das Spiel läuft noch', await page.evaluate(() => !window.__dart.game().done));
check('Stechen wird angeboten', await visible('#rtw-pad .rtw-stechen'));
check('beide stehen zur Wahl', (await page.locator('[data-action="rtw-stechen"]').count()) === 2);
check('die Kopfzeile sagt es auch', (await textKlein('#rtw-turn')).includes('stechen'));
check('geworfen wird nicht mehr', (await page.locator('#rtw-pad [data-num]').count()) === 0);
/* Der Zweite gewinnt – vorher hätte immer der frühere Treffer gewonnen,
   also der Erste. Genau das soll das Stechen aushebeln. */
await page.locator('[data-action="rtw-stechen"][data-id="' + rtwIds[1] + '"]').click();
check('der Angetippte gewinnt',
  await page.evaluate((id) => window.__dart.game().winner === id, rtwIds[1]));
check('und nicht der frühere Treffer',
  await page.evaluate((id) => window.__dart.game().winner !== id, rtwIds[0]));
check('Spiel ist beendet', await page.evaluate(() => window.__dart.game().done));
await page.locator('#overlay-card [data-action="open-summary"]').click();
await page.locator('#summary-actions [data-action="finish-game"]').click();
const stCar = await carr();
check('der Stechen-Sieg zählt in der Karriere',
  Object.values(stCar).find((s) => s.id === rtwIds[1]).rtwWins >= 1);
check('die Spielart liegt im Archiv',
  await page.evaluate(() => window.__dart.state().history[0].boost === true));

group('Ohne Server bleibt es die lokale App');
/* Aus dem laufenden Cricket zurück ins Setup – dort ist die Navigation
   sichtbar, im Spiel wird sie bewusst ausgeblendet. */
await page.evaluate(() => window.__dart.setScreen('setup'));
check('kein Konto-Knopf ohne Backend', await page.locator('#nav-konto').isHidden());
check('keine Konto-Schicht angemeldet', await page.evaluate(() => !window.DartKonto));
check('Statuszeile bleibt unsichtbar', await page.locator('#sync-status').isHidden());
check('Aufstellung funktioniert weiterhin',
  (await page.locator('#roster .roster-item').count()) > 0);
/* Ohne Konto-Schicht raeumt niemand die Startspieler weg -- die App per
   Doppelklick waere sonst beim ersten Oeffnen leer. */
check('die vier Startspieler bleiben ohne Server erhalten',
  await page.evaluate(() => ['Lenas', 'Tobi', 'Domi', 'Julius']
    .every((n) => window.__dart.state().profiles.some((p) => p.name === n))));
check('und niemand ist als Gast markiert',
  await page.evaluate(() => !window.__dart.state().profiles.some((p) => p.gast)));

group('Fehlerfreiheit');
check('keine JS-Fehler', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'Alle Tests bestanden' : failures + ' Test(s) fehlgeschlagen'}`);
process.exit(failures === 0 ? 0 : 1);
