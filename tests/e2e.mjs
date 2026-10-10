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
/* Navigation: in der Rangliste steckt sie hinter dem Logo - erst das
   Menue oeffnen, dann den Reiter antippen. */
/* Die Liga-Auswertung wohnt im Statistik-Reiter der Liga-Seite. */
async function ligaStatistik() {
  await navTo('liga');
  await page.locator('#liga-tabs button[data-tab="statistik"]').click();
}
async function navTo(screen) {
  if ((await page.locator('.screen.active [data-action="logo-menu"]').count()) && !(await visible('#logo-menu-overlay'))) {
    await page.locator('.screen.active [data-action="logo-menu"]').click();
  }
  await page.locator('#nav [data-screen="' + screen + '"]').click();
}
const tapText = async (t, scope = 'body') => { await page.locator(`${scope} >> text="${t}"`).first().click(); };

/* Punkte über das Zahlenfeld eingeben (wie am Handy getippt). */
async function typeScore(n) {
  for (const c of String(n)) await page.locator(`.keypad button[data-key="${c}"]`).click();
  /* Jede Aufnahme wird mit OK bestaetigt -- keine automatische Uebernahme. */
  await page.locator('.keypad button[data-key="ok"]').click();
}
/* Double und Triple sind Schalter im Zahlenfeld: Tipp an, nochmal Tipp aus
   (keiner an heisst Single). */
async function setMult(mult) {
  const ist = await page.evaluate(() => window.__dart.ui().mult);
  if (ist === mult) return;
  if (mult === 1) await page.locator(`#num-grid button.mult[data-mult="${ist}"]`).click();
  else await page.locator(`#num-grid button.mult[data-mult="${mult}"]`).click();
}
async function dart(label) {
  if (label === 'BULL') return page.locator('[data-bull]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.replace(/^[TDS]/, ''), 10);
  await setMult(mult);
  await page.locator(`#num-grid button[data-num="${num}"]`).click();
}
/* Eingabemodus ueber die Kopf-Knoepfe: ⌨ schaltet die Fernsteuerung, ⇄
   wechselt zwischen Punkten und Einzel-Darts. */
async function modus(ziel) {
  if (ziel === 'turnier') { if (!(await visible('#pad-key'))) await page.locator('#game-fern').click(); return; }
  if (await visible('#pad-key')) await page.locator('#game-fern').click();
  const ist = (await visible('#pad-darts')) ? 'darts' : 'total';
  if (ist !== ziel) await page.locator('#game-swap').click();
}
/* Spiel verlassen geht ueber das Menue (•••). */
async function spielVerlassen() {
  await page.locator('#game-menu').click();
  await page.locator('#game-menu-overlay [data-action="to-tournament"]').click();
}
const rest = (i) => page.locator('.pcard').nth(i).locator('.rest').innerText();
const st = () => page.evaluate(() => window.__dart.standings());

/* Fester Stichtag fuer den Liga-Spielplan: der 1. Spieltag (Heim gegen Dachau)
   ist in den Tests immer der naechste - egal, wann sie laufen. */
await page.addInitScript(() => { window.__ligaHeute = "2026-10-01"; });
await page.goto(BASE);

group('Setup');
check('Setup-Screen sichtbar', await visible('#screen-setup'));
const names = await page.locator('#roster .nm').allInnerTexts();
check('4 Profile vorbelegt', JSON.stringify(names) === '["Lenas","Tobi","Domi","Julius"]', names.join(','));
check('alle vier für das Turnier ausgewählt', (await page.locator('.roster-item.selected').count()) === 4);
check('501 vorausgewählt', await page.locator('[data-setting="start"] button[data-value="501"]').evaluate((e) => e.classList.contains('active')));

group('Setup: Startbild nach Entwurf');
check('Navigation steht in der Kopfzeile neben der Marke', (await page.locator('#setup-kopf #nav').count()) === 1);
check('die Nummer im Kreis ist die Reihenfolge der Auswahl',
  (await page.locator('.roster-item.selected .check').allInnerTexts()).map((t) => t.trim()).join('') === '1234');
check('Zaehler: 4 ausgewählt', (await text('#roster-anzahl')).trim() === '4 ausgewählt');
check('Eingabe: Gemischt ist voreingestellt, mit Grenze 170',
  (await page.locator('#eingabe-wahl button[data-value="1"]').evaluate((e) => e.classList.contains('active'))) &&
  (await visible('#setting-dartmode')));
await page.locator('#eingabe-wahl button[data-value="0"]').click();
check('Standard: keine Grenze mehr, Einzel-Darts-Zeile weg',
  (await page.evaluate(() => window.__dart.state().settings.dartModeFrom)) === 0 && !(await visible('#setting-dartmode')));
await page.locator('#eingabe-wahl button[data-value="1"]').click();
check('Gemischt findet die Grenze wieder', (await page.evaluate(() => window.__dart.state().settings.dartModeFrom)) === 170);
await page.locator('#eingabe-wahl button[data-value="2"]').click();
check('Tastatur gemerkt', (await page.evaluate(() => window.__dart.state().settings.tastatur)) === 1);
await page.locator('#eingabe-wahl button[data-value="1"]').click();
await page.locator('[data-action="set-mode"][data-value="kaiwen"]').click();
check('Kaiwen: Regeln folgen, kein Start', (await page.locator('[data-action="start-game"]').isDisabled()) &&
  (await textKlein('[data-action="start-game"]')).includes('regeln folgen') && (await visible('#settings-kaiwen')));
await page.locator('[data-action="set-mode"][data-value="501"]').click();
check('zurueck im X01: GAME ON!', !(await page.locator('[data-action="start-game"]').isDisabled()));

group('Turnierplan');
await page.locator('[data-action="start-game"]').click();
check('Tabelle sichtbar', await visible('#screen-tournament'));
check('Navigation steht in der Kopfzeile des Turniers', (await page.locator('#turnier-kopf #nav').count()) === 1);
const matchCount = await page.locator('.match-row').count();
check('6 Spiele bei 4 Spielern (jeder gegen jeden)', matchCount === 6, `war ${matchCount}`);
const rounds = await page.locator('.round-label').count();
check('3 Runden', rounds === 3, `war ${rounds}`);
const pairs = await page.evaluate(() => window.__dart.state().matches.map((m) => m.p.slice().sort().join('|')));
check('keine Paarung doppelt', new Set(pairs).size === 6);

group('Bull-Off & Spielstart');
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
check('Bull-Off-Screen', await visible('#screen-bulloff'));
check('rechts oben der Zusammenhang: Spiel 1 von 6', (await text('#bulloff-ctx')).trim() === 'Spiel 1 von 6');
check('beide Karten tragen ihr Etikett', (await page.locator('#bulloff-buttons button .bo-tag').count()) === 2);
/* Der Button enthält Avatar und Name – nur den Namen lesen. */
const firstName = await page.locator('#bulloff-buttons button').first().locator('span:not(.av)').innerText();
await page.locator('#bulloff-buttons button').first().click();
check('Spiel-Screen', await visible('#screen-game'));
check('beide starten bei 501', (await rest(0)) === '501' && (await rest(1)) === '501');
const activeName = await page.locator('.pcard.active .pname').innerText();
check('Bull-Off-Sieger beginnt', activeName.toLowerCase().includes(firstName.toLowerCase()), `${activeName} vs ${firstName}`);

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
check('Finish-Vorschlag T20 T19 D12 steht in den grossen Kacheln',
  (await text('#game-kacheln')).replace(/\s+/g, ' ').includes('T20 T19 D12'));
check('keine Leiste mehr - die Kacheln in der Karte tragen den Weg',
  (await page.locator('#checkout-bar').count()) === 0 && (await page.locator('.pcard.active #game-kacheln').count()) === 1);
check('der naechste Wurf ist markiert', await page.evaluate(() =>
  document.querySelector('#game-kacheln .fk.jetzt').textContent.trim() === 'T20'));

group('Tastenbeschriftung im Einzel-Dart-Modus');
await setMult(2);
check('Doppel zeigt weiter die Feldzahl 18 (nicht 36)', (await page.locator('#num-grid button[data-num="18"]').innerText()).replace(/\s/g, '') === 'D18');
await setMult(3);
check('Triple zeigt T20 statt 60', (await page.locator('#num-grid button[data-num="20"]').innerText()).replace(/\s/g, '') === 'T20');
await setMult(1);
check('Single zeigt die blanke Zahl', (await page.locator('#num-grid button[data-num="20"]').innerText()).trim() === '20');

group('Bust-Regel');
await modus('total');
await typeScore(140); // 141 - 140 = 1 -> Bust, Rest bleibt stehen
check('Rest bleibt 141 nach Bust auf 1', (await rest(0)) === '141');
check('Bust beendet die Aufnahme (Gegner ist dran)', await page.locator('.pcard').nth(1).evaluate((e) => e.classList.contains('active')));
await typeScore(60);
check('Gegner 321', (await rest(1)) === '321');

group('Einzel-Darts & Checkout');
check('wieder Einzel-Darts aktiv', await visible('#pad-darts'));
/* Die Kacheln beginnen leer und fuellen sich Dart fuer Dart. */
check('drei leere Kacheln vor dem ersten Dart',
  (await page.locator('#game-kacheln .fk.leer').count()) +
  (await page.locator('#game-kacheln .fk.jetzt').count()) +
  (await page.locator('#game-kacheln .fk:not(.leer):not(.jetzt)').count()) === 3);
await dart('T20');
check('nach T20 Rest 81', (await rest(0)) === '81');
check('der getroffene Vorschlag fuellt die erste Kachel gruen', await page.evaluate(() => {
  const k = document.querySelectorAll('#game-kacheln .fk');
  return k[0].classList.contains('gut') && k[0].textContent.trim() === 'T20';
}));
check('Restvorschlag T19 D12 in den Kacheln', (await text('#game-kacheln')).replace(/\s+/g, ' ').includes('T19 D12'));
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
check('Finish-Vorschlag D6 in den Kacheln', (await text('#game-kacheln')).replace(/\s+/g, ' ').includes('D6'));
await dart('D6');
check('Match-Ende-Overlay mit Glückwunsch', (await visible('#overlay')) && (await text('#overlay-card')).includes('Glückwunsch'));

const table1 = await st();
const winner = table1.find((p) => p.name.toLowerCase() === firstName.toLowerCase());   // die Ausbull-Knoepfe stehen in Versalien
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
  await modus('total');
  return typeScore(141);
}

group('Checkout über Punkte-Eingabe');
await page.locator('#overlay-card [data-action="ov-next-match"]').click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60);
await typeScore(180); await typeScore(60);
await modus('total');
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
check('das Ergebnis steht genau mittig, auch bei ungleich langen Namen', await page.evaluate(() => {
  const z = document.querySelector('#summary-box .sum-score.zwei');
  z.firstElementChild.textContent = 'Vincent von Frankenberg';
  const b = z.querySelector('b').getBoundingClientRect(), r = z.getBoundingClientRect();
  return Math.abs((b.left + b.width / 2) - (r.left + r.width / 2)) < 2;
}));
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
const champ = Object.values(c1).find((s) => s.name.toLowerCase() === firstName.toLowerCase());
check('Karriere zählt alle Spiele des Turniers', Object.values(c1).reduce((a, s) => a + s.matches, 0) === 12, 'Summe Spielteilnahmen');
check('Average über alle Spiele vorhanden', champ.avg > 0 && champ.darts > 0);
check('First-9-Average berechnet', champ.first9 > 0, String(champ.first9));
check('Doppelquote aus Doppelversuchen', champ.doubleAttempts > 0 && champ.doubleQuote > 0, `${champ.checkouts}/${champ.doubleAttempts}`);
check('180er über alle Spiele gezählt', champ.s180 >= 2, String(champ.s180));
check('100+ Aufnahmen gezählt', champ.tons >= champ.s180);

group('Ranglisten');
await page.locator('#screen-winner [data-action="to-tournament"]').click();
check('Navigation außerhalb des Spiels sichtbar', await visible('#nav'));
check('Navigation durchgehend deutsch: Spiel · Liga · Rang · Spieler', (await page.locator('#nav button:not(.hidden)').allInnerTexts())
  .map((t) => t.trim().toLowerCase()).join('|') === 'spiel|liga|rang|spieler');
await navTo('boards');
check('Rangliste sichtbar', await visible('#screen-boards'));
check('die Navigation steckt hinter dem Logo - zu, bis man tippt', (await page.locator('#logo-menu-panel #nav').count()) === 1 && !(await visible('#logo-menu-overlay')));
await page.locator('.screen.active [data-action="logo-menu"]').click();
check('ein Tipp aufs Logo oeffnet das Menue', await visible('#logo-menu-overlay'));
await page.mouse.click(page.viewportSize().width - 8, page.viewportSize().height - 8);
check('ein Tipp daneben schliesst es wieder', !(await visible('#logo-menu-overlay')));
check('Platz 1 bis 3 tragen Medaillenfarbe', (await page.locator('#board-list .board-row .pos.m1').count()) === 1);
check('der Spielverlauf ist zu, bis man ihn oeffnet', !(await visible('#match-log')));
await page.locator('#board-log-knopf').click();
check('Alle Spiele oeffnet den Verlauf anstelle der Spalten', (await visible('#match-log')) && !(await visible('#board-list')));
await page.locator('[data-action="board-log-zu"]').click();
check('zurueck zur Rangliste', await visible('#board-list'));
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
await navTo('players');
check('Spielerliste sichtbar', (await page.locator('.player-card').count()) === 4);
await page.locator('.player-card').first().click();
check('Profil-Detail offen', await visible('#screen-profile'));
const detail = await text('#profile-detail');
check('Profil zeigt Scoring-Werte', detail.includes('3-Dart-Average') && detail.includes('First-9-Average'));
check('Profil zeigt Finishing-Werte', detail.includes('Doppelquote') && detail.includes('Bestes Leg'));
check('Profil listet gespielte Spiele', (await page.locator('#profile-detail .log-row').count()) === 3);

group('Neues Profil anlegen');
await navTo('players');
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
/* Ein fertig gespieltes Turnier darf den Spiel-Reiter nicht in der alten
   Tabelle festhalten: der Tipp auf "Spiel" archiviert es und zeigt das Setup. */
await navTo('boards');
await navTo('setup');
check('Spiel-Reiter bei fertigem Turnier: Setup statt alter Tabelle', await visible('#screen-setup'));
check('fertiges Turnier beim Verlassen archiviert', await page.evaluate(() => window.__dart.state().history.length) === 1);
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
/* Liga-Einzel: seit der SWO 10/2026 wird ausgebullt. In den Tests gewinnt
   der Heimspieler (erster Knopf), damit die Pruefungen dahinter gleich bleiben. */
async function ligaAusbullen() {
  if (!(await visible('#screen-bulloff'))) return false;
  await page.locator('#bulloff-buttons [data-action="pick-starter"]').first().click();
  await page.waitForTimeout(150);
  return true;
}

async function bullOffGo() {
  if (!(await visible('#screen-bulloff'))) return;   // allein wird nicht ausgebullt
  /* Ab drei Spielern: Namen links in Wurf-Reihenfolge antippen (der letzte
     rueckt von selbst nach), dann starten. Bei zweien: direkter Tipp. */
  if (await page.locator('.bo-spalten').count()) {
    while (await page.locator('[data-action="order-pick"]').count()) {
      await page.locator('[data-action="order-pick"]').first().click();
    }
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
await navTo('setup');
await reduceLineupToTwo();
check('zwei Spieler in der Aufstellung', (await page.evaluate(() => window.__dart.state().lineup.length)) === 2);
await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
check('Cricket-Einstellungen sichtbar', await visible('#settings-cricket'));
check('501-Einstellungen ausgeblendet', !(await visible('#settings-501')));
/* Der Knopf heisst in jedem Modus gleich – welcher Modus laeuft, sagt die
   Auswahl darueber, nicht der Knopf. */
check('Startknopf heisst überall gleich', (await textKlein('[data-action="start-game"]')).includes('game on!'));
await page.locator('[data-action="start-game"]').click();
check('Bull-Off auch im Cricket', await visible('#screen-bulloff'));
await page.locator('#bulloff-buttons button').first().click();
check('Cricket-Screen', await visible('#screen-cricket'));
check('Board hat 7 Zahlen (20–15 und Bull)', (await page.locator('.cr-num').count()) === 7, String(await page.locator('.cr-num').count()));
check('Menue, Zurueck und Bust stehen in der Kopfzeile der Tafel',
  (await visible('#cricket-grid .cr-menu')) && (await visible('#cricket-grid [data-action="undo-game"]')) && (await textKlein('#cricket-grid .bust')) === 'bust');

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
  const zellen = [...document.querySelectorAll('#cricket-board .cr-pts')];
  return zellen.map((z) => z.classList.contains('fuehrt'));
});
check('genau einer ist vorn', (await fuehrend()).filter(Boolean).length === 1,
  JSON.stringify(await fuehrend()));
check('und zwar der mit den Punkten', (await fuehrend())[0] === true);
check('nach 3 Darts ist der Gegner am Wurf - seine Karte leuchtet',
  (await textKlein('#cricket-grid .cr-card.act .pname')).includes((await page.evaluate((id) => window.__dart.state().profiles.find((p) => p.id === id).name, pB)).toLowerCase()));
check('die Aufnahme des Vorgaengers bleibt gedimmt in seiner Karte stehen',
  (await text('#cricket-grid .cr-card.vorher .cr-tiles')).replace(/\s+/g, ' ').trim() === 'T20 20 T19');
check('Punkte stehen gross in der Karte', (await text('#cricket-grid .cr-card.vorher .cr-pts')).trim() === '20');
check('der Spieler am Wurf hat noch leere Kacheln - nicht die Darts des Vorgaengers',
  (await text('#cricket-grid .cr-card.act .cr-tiles')).trim() === '' && (await page.locator('#cricket-grid .cr-card.act .ct.leer').count()) === 3);
check('Zurueck-Taste auch hochkant mindestens 44 px breit',
  (await page.locator('#cricket-grid .cr-top .zurueck').boundingBox()).width >= 44);

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
check('der Bull-Sieger beginnt', (await textKlein('#rtw-turn')).includes(rtwStarter.toLowerCase()), await text('#rtw-turn'));
check('alle starten auf der 1', await page.evaluate(() => {
  const s = window.__dart.rtwState();
  return Object.values(s.target).every((t) => t === 1);
}));
const [rA] = await page.evaluate(() => window.__dart.game().players);
const misses = async () => { for (const _ of [1, 2, 3]) await rDart('MISS'); };
const weiter = () => page.locator('#screen-rtw [data-action="end-rtw-visit"]').click();   // "Bust" oben rechts
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
await navTo('boards');
check('Classic ist voreingestellt', await page.locator('[data-action="board-mode"][data-value="501"]').evaluate((e) => e.classList.contains('active')));
check('Classic-Kategorien sichtbar', (await page.locator('[data-action="board"][data-key="avg"]').count()) === 1);
/* In jedem Modus stehen Siege vorn, dann der Average -- und was vorn steht,
   ist auch das, was beim Moduswechsel als Erstes gezeigt wird. */
const kategorien = async () => page.evaluate(() =>
  [...document.querySelectorAll('#board-chips .chip')].map((c) => c.textContent.trim()));
check('Siege stehen an erster Stelle', (await kategorien())[0] === 'Siege', (await kategorien()).join(' | '));
check('danach der Average', (await kategorien())[1] === 'Average');
check('und Siege ist voreingestellt',
  await page.locator('[data-action="board"][data-key="won"]').evaluate((e) => e.classList.contains('active')));
check('nur der Erste leuchtet - Name und Zahl, keine Klinge mehr', await page.evaluate(() => {
  const erste = document.querySelector('#board-list .board-row');
  if (!erste) return true;                       // ohne Daten gibt es nichts zu kroenen
  return erste.classList.contains('top') &&
    getComputedStyle(erste, '::after').content === 'none' &&
    getComputedStyle(erste.querySelector('.nm')).textShadow !== 'none';
}));
check('Cricket-Kategorien nicht in Classic', (await page.locator('[data-action="board"][data-key="mpr"]').count()) === 0);
check('Verlaufsdiagramm für Classic', (await page.locator('#board-chart .chart').count()) === 1);
const lines = await page.locator('#board-chart .chart polyline').count();
check('eine Linie je Spieler', lines >= 2, `${lines} Linien`);
const legend = await page.locator('#board-chart .chart-legend .cl').count();
check('unter dem Diagramm steht der beste Schnitt zuerst, der schwaechste zuletzt', await page.evaluate(() => {
  const w = [...document.querySelectorAll('#board-chart .chart-legend .cl b')].map((e) => parseFloat(e.textContent.replace('Ø', '')));
  return w.length > 0 && w.every((v, i) => i === 0 || w[i - 1] >= v);
}));
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
await page.locator('#board-log-knopf').click();
await page.locator('#match-log .log-row').first().click();
check('Spielstatistik aus dem Verlauf abrufbar', await visible('#screen-summary'));
await page.locator('#summary-actions [data-action="summary-back"]').click();
check('Zurück aus der Statistik', await visible('#screen-boards'));

await navTo('players');
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
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await modus('total');
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
await spielVerlassen();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-setting="start"] button[data-value="301"]').click();
await page.locator('[data-setting="bestOf"] button[data-value="5"]').click();
await navTo('setup');
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
await spielVerlassen();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-action="start-game"]').click();
check('Rückfrage vor dem Verwerfen eines laufenden Turniers',
  (await text('#overlay-card')).includes('Laufendes Turnier beenden'));
await page.locator('#overlay-card [data-action="ov-cancel"]').click();

// (5) Doppeltipp auf die Schnellwahl bucht nur eine Aufnahme
await navTo('setup');
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
check('je Zahl drei Tasten: Single, Double, Triple - direkt neben der Zeile',
  (await page.locator('#cricket-grid .cr-key[data-mult="1"]').count()) === 8 && (await page.locator('#cricket-grid .cr-key[data-mult="2"]').count()) === 7);   // Single: 6 Zahlen, Bull, Miss
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
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(100); await typeScore(60); await typeScore(140);
check('keine doppelte Am-Wurf-Zeile - die leuchtende Kachel sagt es selbst',
  await page.locator('#game-turn').isHidden());

// Aufnahme nachträglich korrigieren: ein Tipp auf die letzte Aufnahme neben dem Rest
check('der Wurfverlauf ist aus dem Spielbild verschwunden', !(await page.locator('#history').isVisible()));
check('die letzte Aufnahme steht neben dem Rest',
  (await page.locator('.pcard').first().locator('.letzte').innerText()) === '140');
await page.locator('.pcard').first().locator('.letzte-box.tap').click();
check('Korrektur-Dialog offen', (await text('#overlay-card')).includes('Aufnahme korrigieren'));
for (const d of ['1', '2', '0']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('korrigierter Wert übernommen',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits[2].s)) === 120);
check('Reststand folgt der Korrektur', (await rest(0)) === String(501 - 100 - 120), await rest(0));
check('die kleine Zahl zeigt den korrigierten Wert',
  (await page.locator('.pcard').first().locator('.letzte').innerText()) === '120');
await page.locator('.pcard').first().locator('.letzte-box.tap').click();
for (const d of ['1', '7', '9']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('unmöglicher Wert wird abgelehnt', (await text('#overlay-card')).includes('nicht möglich'));
for (const d of ['d', 'e', 'l']) await page.locator('[data-editkey="del"]').click();
for (const d of ['5', '0', '0']) await page.locator(`[data-editkey="${d}"]`).click();
await page.locator('[data-editkey="ok"]').click();
check('zu hoher Wert wird abgelehnt', (await text('#overlay-card')).includes('Maximal 180'));
await page.locator('#overlay-card [data-action="ov-cancel"]').click();

// Spieler nachtragen und abmelden
await spielVerlassen();
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
  await navTo('players');
  await page.locator('#screen-players [data-action="new-profile"]').click();
  await page.locator('[data-role="profile-name"]').fill('Nachzügler');
  await page.locator('[data-action="save-profile"]').click();
  await navTo('setup');
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
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons button').first().click();

// Zwei gleiche Aufnahmen kurz nacheinander müssen beide zählen
await page.locator('[data-quick="60"]').click();
await page.waitForTimeout(200);
await page.locator('[data-quick="60"]').click();
check('zwei gleiche Aufnahmen hintereinander zählen beide',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === 2);

// Legzeile folgt dem Turnier, nicht dem Setup
await spielVerlassen();
await page.locator('[data-action="to-setup"]').click();
await page.locator('[data-setting="bestOf"] button[data-value="5"]').click();
await navTo('setup');
await page.locator('.match-row .go').first().click();
check('Legzeile zeigt weiter die Turnierregel',
  (await text('#game-leg-label')).includes('Ein Leg'), await text('#game-leg-label'));

// Ergebnis nach dem Overlay noch korrigierbar (Spieler hat schon 60 geworfen)
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await modus('total');
await typeScore(81);
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
await page.locator('#overlay-card [data-action="open-summary"]').click();
check('Spielstatistik bietet das Zurücknehmen an',
  (await page.locator('#summary-actions [data-action="reopen-match"]').count()) === 1);
await page.locator('#summary-actions [data-action="reopen-match"]').click();
check('Match ist wieder offen', await page.evaluate(() => !window.__dart.currentMatch().done));
check('das Finish wurde zurückgenommen', (await rest(0)) === '81', await rest(0));

// Dialoge lassen sich per Tipp daneben schließen
await page.locator('.pcard').first().locator('.letzte-box.tap').click();
check('Korrektur-Dialog offen', await visible('#overlay'));
await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
check('Tipp neben den Dialog schließt ihn', !(await visible('#overlay')));

group('Regression: zweite Prüfungsrunde');
await page.evaluate(() => localStorage.clear());
await page.reload();

// Doppeltipp auf "Nächstes Spiel" darf den Bull-Off nicht überspringen
await page.locator('[data-action="start-game"]').click();
await page.locator('#schedule .match-row .go:not(.wo)').first().dblclick();
check('Doppeltipp überspringt den Bull-Off nicht', await visible('#screen-bulloff'),
  await page.evaluate(() => window.__dart.state().screen));
await page.locator('#bulloff-buttons button').first().click();

// Doppeltipp auf "Start" im Spielplan darf keine Aufnahme buchen
await spielVerlassen();
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
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons button').first().click();
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
check('Einzel-Darts aktiv', await visible('#pad-darts'));
check('Knopf heißt immer OK - auch ohne geworfenen Dart',
  (await page.locator('[data-action="end-visit"]').innerText()).trim() === 'OK');
await page.locator('[data-action="end-visit"]').click();
check('drei Fehlwürfe in einem Tipp', (await rest(0)) === '141', await rest(0));
check('Aufnahme zählt drei Darts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.slice(-1)[0])).d === 3);
await typeScore(60);
await dart('T20');
check('Knopf heißt OK, sobald ein Dart steht',
  (await page.locator('[data-action="end-visit"]').innerText()).trim() === 'OK');
await page.locator('[data-action="end-visit"]').click();
check('angefangene Aufnahme wird übernommen', (await rest(0)) === '81', await rest(0));
check('auch dann drei Darts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.slice(-1)[0])).d === 3);

group('Wurfverlauf über das ganze Match');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('[data-setting="bestOf"] button[data-value="3"]').click();
await page.locator('[data-action="start-game"]').click();
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons button').first().click();
/* Leg 1 gewinnen: 180, 180, 141 */
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);
await modus('total');
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
check('Bull-Off zeigt links alle vier zur Wahl - ohne Nummern',
  (await page.locator('.bo-wahl [data-action="order-pick"]').count()) === 4 &&
  (await page.locator('.bo-wahl .bo-pos').count()) === 0);
check('rechts warten vier leere nummerierte Slots',
  (await page.locator('.bo-reihe .bo-row').count()) === 0 &&
  (await page.locator('.bo-reihe .bo-slot').count()) === 4);
const alleIds = await page.evaluate(() => window.__dart.game().players.slice());
/* Der Naechste am Bull wird zuerst angetippt: hier der Vierte, dann der
   Zweite - danach zwei Erstbeste. Der letzte rueckt von selbst nach. */
const wahlHoehe = await page.locator('.bo-wahl').evaluate((e) => e.getBoundingClientRect().height);
await page.locator(`[data-action="order-pick"][data-id="${alleIds[3]}"]`).click();
check('der Angetippte steht rechts als 1.', await page.evaluate((id) =>
  window.__dart.ui().bullReihe[0] === id, alleIds[3]));
check('der Erste leuchtet mit „wirft an“', (await page.locator('.bo-reihe .bo-row.erster .bo-tag').count()) === 1);
check('der Startknopf zaehlt: Noch 3 antippen', (await textKlein('[data-action="start-order"]')).includes('noch 3'));
check('links bleibt sein Platz leer - nichts rueckt nach', await page.evaluate((h) => {
  const w = document.querySelector('.bo-wahl');
  return Math.abs(w.getBoundingClientRect().height - h) < 2 &&
    w.querySelectorAll('.bo-weg').length === 1;
}, wahlHoehe));
await page.locator(`[data-action="order-pick"][data-id="${alleIds[1]}"]`).click();
check('der zweite Tipp reiht als 2. ein', await page.evaluate((id) =>
  window.__dart.ui().bullReihe[1] === id, alleIds[1]));
/* Ein Fehltipp laesst sich rechts wieder herausnehmen. */
await page.locator(`.bo-reihe [data-action="order-unpick"][data-id="${alleIds[1]}"]`).click();
check('ein Tipp rechts nimmt den Spieler wieder heraus', await page.evaluate(() =>
  window.__dart.ui().bullReihe.length === 1));
await page.locator(`[data-action="order-pick"][data-id="${alleIds[1]}"]`).click();
await page.locator(`[data-action="order-pick"][data-id="${alleIds[0]}"]`).click();
check('der letzte Spieler rueckt von selbst nach', await page.evaluate(() =>
  window.__dart.ui().bullReihe.length === 4));
const cOrder = await page.evaluate(() => window.__dart.ui().bullReihe.slice());
check('Startknopf nennt den ersten Spieler',
  (await text('[data-action="start-order"]')).toLowerCase()
    .includes((await page.evaluate((id) => window.__dart.state().profiles.find((p) => p.id === id).name, cOrder[0])).toLowerCase()));
await page.locator('[data-action="start-order"]').click();
check('Cricket startet in der angetippten Reihenfolge',
  (await visible('#screen-cricket')) &&
  (await page.evaluate(() => window.__dart.gameTurnPlayer())) === cOrder[0]);

// Aufnahme abkürzen: ein Tipp statt dreimal Miss
const throwsBefore = await page.evaluate(() => window.__dart.game().throws.length);
await page.locator('#cricket-grid [data-action="end-cricket-visit"]').click();
check('Weiter-Knopf füllt die Aufnahme mit drei Fehlwürfen',
  (await page.evaluate(() => window.__dart.game().throws.length)) === throwsBefore + 3);
check('danach ist der nächste Spieler am Wurf',
  (await page.evaluate(() => window.__dart.gameTurnPlayer())) === cOrder[1]);
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
/* Der Bull war von dieser Regel ausgenommen und blieb im Eingabefeld hell,
   obwohl er bei allen zu war und nichts mehr bringt. */
await page.evaluate(() => {
  const g = window.__dart.game();
  g.throws.length = 0;
  g.players.forEach(() => { for (let i = 0; i < 3; i++) g.throws.push({ n: 25, m: 2 }); });
  window.__dart.render();
});
check('Bull ist bei allen zu', await page.evaluate(() => {
  const st = window.__dart.cricketState(), g = window.__dart.game();
  return g.players.every((id) => st.marks[id][25] >= 3);
}));
check('auch der Bull wird im Eingabefeld ausgegraut',
  (await page.locator('#cricket-grid button.bull.dim').count()) === 2,
  String(await page.locator('#cricket-grid button.bull.dim').count()));
const bullTot = await page.locator('#cricket-grid button.bull.dim').first()
  .evaluate((e) => getComputedStyle(e).color);
check('und zwar sichtbar, nicht nur als Klasse',
  bullTot === deadColor, bullTot + ' vs ' + deadColor);

const cgKey = page.locator('#cricket-grid button[data-mult="3"]').first();
check('Eingabefelder am Handy groß genug zum schnellen Tippen',
  (await cgKey.boundingBox()).height >= 52, String((await cgKey.boundingBox()).height));
await page.setViewportSize({ width: 1194, height: 834 });
await page.waitForTimeout(120);
check('Eingabefelder am iPad deutlich größer',
  (await cgKey.boundingBox()).height >= 70, String((await cgKey.boundingBox()).height));
check('Bull-Zeile: Bull, Bull x2, Miss',
  (await page.locator('#cricket-grid button[data-num="25"], #cricket-grid button[data-num="0"]').count()) === 3);
/* Menue (•••): Spiel verlassen oder weiterspielen. */
await page.locator('#cricket-grid .cr-menu').click();
check('••• oeffnet das Cricket-Menue', (await visible('#cricket-menu-overlay')) && (await textKlein('#cricket-menu-overlay')).includes('spiel verlassen'));
await page.keyboard.press('Escape');
check('Esc schliesst es', !(await visible('#cricket-menu-overlay')));
await page.setViewportSize({ width: 390, height: 844 });

/* ---------- Finisher ---------- */

/* Ein Dart im Finisher. Die Zahlen 1–20 richten sich nach der eingestellten
   Multiplikatorreihe, 25 und Bull haben sie fest am Knopf. */
/* Double und Triple sind auch hier Schalter (Tipp an, nochmal Tipp aus). */
async function finSetMult(mult) {
  const ist = await page.evaluate(() => window.__dart.ui().mult);
  if (ist === mult) return;
  if (mult === 1) await page.locator(`#fin-pad .num-grid button.mult[data-mult="${ist}"]`).click();
  else await page.locator(`#fin-pad .num-grid button.mult[data-mult="${mult}"]`).click();
}
async function finDart(label) {
  if (label === 'BULL') return page.locator('#fin-pad button[data-num="25"][data-mult="2"]').click();
  if (label === '25') return page.locator('#fin-pad button[data-num="25"][data-mult="1"]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.slice(1), 10);
  await finSetMult(mult);
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
check('Startknopf unverändert', (await textKlein('[data-action="start-game"]')).includes('game on!'));
await page.locator('[data-setting="finisherTo"] button[data-value="3"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('Finisher-Screen', await visible('#screen-finisher'));

let fst = await finState();
const [fA, fB] = await page.evaluate(() => window.__dart.game().players);
check('Zahl liegt zwischen 6 und 120', fst.zahl >= 6 && fst.zahl <= 120, String(fst.zahl));
check('beide starten auf derselben Zahl', fst.rest[fA] === fst.zahl && fst.rest[fB] === fst.zahl);
check('Zahl steht groß im Kasten und als Rest auf den Karten', (await text('#fin-zahl')).trim() === String(fst.zahl) && (await text('#fin-board')).includes(String(fst.zahl)));
check('Menue, Info und Runde stehen rechts oben', (await visible('#screen-finisher .fin-kopf .fin-menu')) && (await textKlein('#fin-runde')).includes('runde 1'));
check('je Zielpunkt eine Pille in der Karte, anfangs keine an', await page.evaluate(() => {
  const karten = document.querySelectorAll('#fin-board .pcard');
  const ziel = window.__dart.game().ziel;
  return [...karten].every((k) => k.querySelectorAll('.fin-pille').length === ziel) &&
    document.querySelectorAll('#fin-board .fin-pille.an').length === 0;
}));
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
  await finSetMult(3);
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
check('das Finish zuendet eine Laserpille beim Sieger', await page.evaluate((id) => {
  const karten = [...document.querySelectorAll('#fin-board .pcard')];
  const meine = karten[window.__dart.game().players.indexOf(id)];
  return meine.querySelectorAll('.fin-pille.an').length === 1;
}, fA));
check('neue Runde mit neuer Zahl', fst.runde === 1 && fst.zahl >= 6 && fst.zahl <= 120);
check('die neue Zahl rollt in der Mitte aus', await page.evaluate(() => document.getElementById('fin-roller').classList.contains('an')));
await page.waitForTimeout(3200);
check('und ist danach wieder weg - das Zahl-Feld hat sie', await page.evaluate(() =>
  !document.getElementById('fin-roller').classList.contains('an') && document.getElementById('fin-zahl').textContent === String(window.__dart.finisherState().zahl)));
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
check('Stechen steht sichtbar als Dialog auf dem Schirm', await page.locator('.fin-stechen').isVisible());
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

await navTo('boards');
await page.locator('[data-action="board-mode"][data-value="finisher"]').click();
check('Finisher-Rangliste da', (await text('#board-list')).length > 0);
check('kein Diagramm im Finisher', !(await visible('#board-chart')));

/* ---------- Finisher: die drei Kacheln ---------- */

group('Finisher: drei Kacheln zeigen den Weg');
await page.evaluate(() => window.__dart.setScreen('setup'));
await page.locator('[data-action="set-mode"][data-value="finisher"]').click();
await page.locator('[data-action="start-game"]').click();
await page.locator('#bulloff-buttons button').first().click();
/* Fester Wert statt Zufall, damit die Prüfungen deterministisch sind. */
await page.evaluate(() => { window.__dart.finisherRunde().zahl = 39; window.__dart.render(); });
check('es stehen immer drei Kacheln da', (await page.locator('#fin-hint .fk').count()) === 3);
check('die nächste zu werfende ist rot',
  await page.locator('#fin-hint .fk').first().evaluate((e) => e.classList.contains('jetzt')));
check('ohne FINISH-Etikett – der Spieler leuchtet ja',
  !(await text('#fin-hint')).toLowerCase().includes('finish'));
check('keine Wurf-Chips mehr über dem Zahlenfeld',
  (await page.locator('#fin-darts').count()) === 0);

/* Der empfohlene erste Wurf wird geworfen: die Kachel wird grün. */
await page.evaluate(() => {
  const l = window.Checkout.suggest(39, 3, null)[0];
  const m = l === 'BULL' ? 2 : l[0] === 'T' ? 3 : l[0] === 'D' ? 2 : 1;
  const n = l === 'BULL' || l === '25' ? 25 : parseInt(l.replace(/\D/g, ''), 10);
  window.__dart.finisherDart(m, n);
});
check('getroffen wie vorgegeben wird grün',
  (await page.locator('#fin-hint .fk.gut').count()) === 1);
check('und die nächste Kachel ist jetzt rot',
  await page.locator('#fin-hint .fk').nth(1).evaluate((e) => e.classList.contains('jetzt')));

/* Zwei Fehlwürfe: der letzte Dart kann 39 nicht finishen – grauer Stellwurf. */
await page.locator('#screen-finisher [data-action="undo-game"]').click();
await page.evaluate(() => {
  const rd = window.__dart.finisherRunde();
  rd.throws.push({ n: 0, m: 0 }, { n: 0, m: 0 });
  window.__dart.render();
});
check('Fehlwürfe stehen als – in den Kacheln',
  (await page.locator('#fin-hint .fk.anders').count()) === 2 &&
  (await page.locator('#fin-hint .fk.anders').first().innerText()).trim() === '–');
check('der letzte Dart kann nicht finishen: grauer Stellwurf 7 (auf D16)',
  /^7\s+auf \d+$/.test((await page.locator('#fin-hint .fk.stellen').innerText()).trim()));

group('Finisher: Fernsteuerung - die Aufnahme als Zahl, Weg und Finish-Frage');
await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id); S.mode = 'finisher'; D.save(); D.setScreen('setup'); });
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await page.evaluate(() => { window.__dart.finisherRunde().zahl = 100; window.__dart.render(); });
const [ffA] = await page.evaluate(() => window.__dart.game().players);
await page.locator('#screen-finisher .fin-menu').first().click();
await page.locator('#fin-menu-overlay [data-action="fin-fern"]').click();
check('die Fernsteuerung steht: Karten, Zahl, Eingabe-Anzeige', (await visible('#fin-fern')) && (await text('#ff-zahl')).trim() === '100' &&
  (await page.locator('#ff-display .cursor').count()) === 1 && !(await visible('#fin-pad')));
check('der Finish-Weg steht in der Karte am Wurf', (await text('#ff-karten .pcard.active .pfinish')).includes('T20'));
await page.keyboard.type('60'); await page.keyboard.press('Enter');
check('60 getippt: Rest 40, die Aufnahme ist durch', await page.evaluate((id) => {
  const st = window.__dart.finisherState(); return st.rest[id] === 40 && st.aufnahmen[id] === 1;
}, ffA));
check('die Liste unten zeigt 100 → 40', (await text('#ff-hist-l')).includes('100 → 40'));
await page.keyboard.type('90'); await page.keyboard.press('Enter');   // Gegner: 100 -> 10
await page.keyboard.type('40'); await page.keyboard.press('Enter');
check('Finish getippt: die Frage nach der Dartzahl', (await text('#overlay-card')).includes('wie vielen Darts'));
await page.keyboard.press('1');
check('ein Dart: D20, Spieler A ist durch', await page.evaluate((id) => !!window.__dart.finisherState().fertig[id], ffA));
await page.keyboard.type('5'); await page.keyboard.press('Enter');     // Gegner: 10 -> 5 = Bust? nein: Rest 5 bleibt (ohne Doppel kein Finish, 5 ist regulaer)
check('nach der Runde rollt die neue Zahl', await page.evaluate(() => window.__dart.finisherState().runde === 1));
await page.keyboard.press('Escape');
check('Esc fuehrt zur Eingabe zurueck', !(await visible('#fin-fern')) && (await visible('#fin-pad')));
await page.waitForTimeout(3200);
await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; D.save(); D.setScreen('setup'); });
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  D.setScreen('setup');
});

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
const bestVorher = await page.evaluate(() => {
  const c = window.__dart.career();
  return Object.keys(c).map((k) => c[k].bestLeg);
});
await page.evaluate(() => window.__dart.setScreen('setup'));
await page.evaluate(() => {
  const S = window.__dart.state();
  S.lineup = window.__dart.activeProfiles().slice(0, 3).map((p) => p.id);
  window.__dart.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
check('teilt sich die Einstellungen mit dem Turnier', await visible('#settings-501'));
/* Ohne Server gibt es kein Konto und damit niemanden, mit dem man online
   spielen koennte -- die Karte bleibt weg. */
check('ohne Server keine Online-Umschalter, nur ein Hinweis auf die Funktion',
  !(await visible('#settings-online [data-setting="online"]')) &&
  (!(await visible('#settings-online')) || (await text('#online-hint')).includes('Konto')));
check('kein Legs-Feld – es gibt nur eines', !(await visible('#setting-bestof')));
await page.locator('#settings-501 [data-setting="start"] button[data-value="301"]').click();
/* Für diesen Durchlauf bleibt die Punkte-Eingabe an: sonst schaltet die App
   im Finish-Bereich auf Einzel-Darts um und das Zahlenfeld ist weg. Der
   Umschaltpunkt selbst wird oben im X01-Teil geprüft. */
await page.locator('#settings-501 [data-action="eingabe"][data-value="0"]').click();
await page.locator('[data-action="start-game"]').click();
/* Das Ausbullen muss im Spiel ankommen: die sortierte Reihenfolge steht
   hinterher auch im Match (p und starter) – nicht nur in der Bull-Off-Liste.
   Genau das war kaputt: die Wahl wurde angezeigt, aber es begann trotzdem
   immer der Erste der Aufstellung. */
{
  const qIds0 = await page.evaluate(() => window.__dart.game().players.slice());
  await page.locator(`[data-action="order-pick"][data-id="${qIds0[2]}"]`).click();
  await page.locator(`[data-action="order-pick"][data-id="${qIds0[0]}"]`).click();
}
const qOrder = await page.evaluate(() => window.__dart.ui().bullReihe.slice());
await bullOffGo();
check('läuft auf dem X01-Bildschirm', await visible('#screen-game'));
check('die ausgebullte Reihenfolge gilt im Spiel', await page.evaluate((order) => {
  const m = window.__dart.currentMatch();
  return JSON.stringify(m.p) === JSON.stringify(order) && m.starter === order[0];
}, qOrder));
check('der Ausbull-Sieger ist am Wurf', await page.evaluate((id) => {
  const D = window.__dart, m = D.currentMatch();
  return D.activePlayer(D.activeLeg(m), m) === id;
}, qOrder[0]));

const qIds = await page.evaluate(() => window.__dart.currentMatch().p);
check('alle drei Spieler auf der Tafel', (await page.locator('#scoreboard .pcard').count()) === 3);
check('alle starten auf 301', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), leg = D.activeLeg(m);
  return m.p.every((id) => D.remainingIn(leg, id) === 301);
}));
check('kein Turnier-Zaehler in der Kopfzeile',
  (await textKlein('#game-match-label')).includes('schnelles spiel'));
/* Ab drei Spielern am Handy erscheint die Finish-Leiste erst, wenn beim
   Aktiven ein Finish ansteht – vorher stiehlt sie dem Verlauf die Zeile. */
check('ohne Finish bleiben die Felder des Spielers am Wurf leer', (await page.locator('#scoreboard .pcard.active .pfelder .fk').count()) === 0);

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

/* Statt eines Wurfverlaufs steht bei jedem Spieler seine letzte Aufnahme
   klein neben dem Rest -- alle drei Felder nebeneinander in einer Reihe. */
check('jeder Spieler zeigt seine letzte Aufnahme neben dem Rest',
  (await page.locator('#scoreboard .pcard .letzte').count()) === 3 &&
  (await page.locator('#scoreboard .pcard .letzte').allInnerTexts()).every((x) => x === '60'));
check('drei Spieler stehen in einer Reihe',
  await page.evaluate(() => getComputedStyle(document.getElementById('scoreboard')).gridTemplateColumns.split(' ').length === 3));
check('kein Wurfverlauf mehr im Spielbild', !(await page.locator('#history').isVisible()));

/* Spieler 1 checkt aus: 301 - 60 = 241 - 180 = 61 - 41 = 20, dann D10. */
await typeScore(180);
await typeScore(60); await typeScore(60);            // die anderen beiden
check('sobald ein Finish ansteht, steht er in den Feldern des Spielers am Wurf',
  (await page.locator('.pcard.active .pfinish .fk.weg').count()) > 0);
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
check('ein 301er-Leg aendert das beste Leg nicht', await page.evaluate((vorher) => {
  const c = window.__dart.career();
  return Object.keys(c).every((k, i) => c[k].bestLeg === vorher[i]);
}, bestVorher));

/* ---------- Schnelles Spiel über Sätze und Legs ---------- */

group('Schnelles Spiel: First to 2 Sätze à 2 Legs');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
check('Spieldauer-Einstellung nur im Schnellen Spiel sichtbar', await visible('#setting-quick-dauer'));
await page.locator('#settings-501 [data-setting="start"] button[data-value="301"]').click();
await page.locator('#settings-501 [data-action="eingabe"][data-value="0"]').click();
await page.locator('[data-setting="quickModus"] button[data-value="0"]').click();
/* Auf 1 Satz / 1 Leg zurueck, egal was vorher stand. */
while (!(await page.locator('[data-action="quick-step"][data-key="quickLegs"][data-dir="-1"]').isDisabled())) {
  await page.locator('[data-action="quick-step"][data-key="quickLegs"][data-dir="-1"]').click();
}
while (!(await page.locator('[data-action="quick-step"][data-key="quickSaetze"][data-dir="-1"]').isDisabled())) {
  await page.locator('[data-action="quick-step"][data-key="quickSaetze"][data-dir="-1"]').click();
}
check('Grundstellung: 1 Satz, 1 Leg', (await text('#quick-saetze')) === '1 Satz' && (await text('#quick-legs')) === '1 Leg');
await page.locator('[data-action="quick-step"][data-key="quickLegs"][data-dir="1"]').click();
await page.locator('[data-action="quick-step"][data-key="quickSaetze"][data-dir="1"]').click();
check('Zaehler: 2 Sätze, 2 Legs', (await text('#quick-saetze')) === '2 Sätze' && (await text('#quick-legs')) === '2 Legs');
check('Hinweis erklärt Satz und Spiel', (await textKlein('#quick-dauer-hint')).includes('satz'));
/* Best of rechnet dasselbe Ziel um: First to 2 = Best of 3 -- und zurueck. */
await page.locator('[data-setting="quickModus"] button[data-value="1"]').click();
check('Best of: aus First to 2 wird Best of 3', (await text('#quick-legs')) === '3 Legs' && (await text('#quick-saetze')) === '3 Sätze');
await page.locator('[data-action="quick-step"][data-key="quickLegs"][data-dir="1"]').click();
check('Best of zaehlt in Zweierschritten', (await text('#quick-legs')) === '5 Legs');
await page.locator('[data-setting="quickModus"] button[data-value="0"]').click();
check('zurueck zu First to: 3 Legs, 2 Sätze', (await text('#quick-legs')) === '3 Legs' && (await text('#quick-saetze')) === '2 Sätze');
await page.locator('[data-action="quick-step"][data-key="quickLegs"][data-dir="-1"]').click();
check('wieder 2 Legs', (await text('#quick-legs')) === '2 Legs');

await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('läuft auf dem X01-Bildschirm', await visible('#screen-game'));
const [sA, sB] = await page.evaluate(() => window.__dart.currentMatch().p);
check('Spiel kennt sein Ziel: Best-of-3-Legs je Satz, Best-of-3-Sätze', await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  return m.bestOf === 3 && m.saetzeBestOf === 3 && m.spieldauer.modus === 0;
}));
check('Kopfzeile zaehlt Satz und Leg', (await textKlein('#game-leg-label')).includes('satz 1') &&
  (await textKlein('#game-leg-label')).includes('leg 1') && (await textKlein('#game-leg-label')).includes('first to 2 sätze'));

/* Ein Leg auf 301 fuer einen bestimmten Spieler: 180, (Gegner 60), 121. */
const dranId = () => page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return D.activePlayer(D.activeLeg(m), m);
});
async function legFuer(ziel) {
  if ((await dranId()) !== ziel) await typeScore(60);
  await typeScore(180); await typeScore(60); await typeScore(121);
  await page.locator('#overlay-card [data-action="co-darts"]').first().click();
}
const stand = () => page.evaluate(() => window.__dart.satzStand(window.__dart.currentMatch()));

await legFuer(sA);
check('Leg 1 an A: Dialog sagt Leg, nicht Satz', (await textKlein('#overlay-card')).includes('leg an') &&
  (await textKlein('#overlay-card')).includes('legs 1:0'));
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
check('Karte von A zeigt Siege 1', (await page.locator('.pcard').first().locator('.pmeta').innerText()).includes('Siege 1'));
check('Kopfzeile: Leg 2', (await textKlein('#game-leg-label')).includes('leg 2'));
check('der Anwurf wechselt', (await dranId()) === sB);

await legFuer(sA);
check('Satz 1 an A', (await textKlein('#overlay-card')).includes('satz an') &&
  (await textKlein('#overlay-card')).includes('sätze 1:0'), await textKlein('#overlay-card'));
check('Knopf heisst Nächster Satz', (await textKlein('#overlay-card [data-action="ov-next-leg"]')).includes('satz'));
check('Spiel läuft weiter', await page.evaluate(() => !window.__dart.currentMatch().done));
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
check('Kopfzeile: Satz 2, Leg 1', (await textKlein('#game-leg-label')).includes('satz 2') &&
  (await textKlein('#game-leg-label')).includes('leg 1'));
{
  const s2 = await stand();
  check('Legs im neuen Satz bei 0:0', s2.legs[sA] === 0 && s2.legs[sB] === 0 && s2.saetze[sA] === 1);
}

await legFuer(sB);
check('Leg an B: Sätze 1:0 · Legs 0:1', (await textKlein('#overlay-card')).includes('sätze 1:0') &&
  (await textKlein('#overlay-card')).includes('legs 0:1'), await textKlein('#overlay-card'));
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuer(sA);
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuer(sA);
check('zweiter Satz entscheidet das Spiel', await page.evaluate(() => window.__dart.currentMatch().done));
check('Glückwunsch mit Satzstand', (await textKlein('#overlay-card')).includes('glückwunsch') &&
  (await textKlein('#overlay-card')).includes('sätze 2:0'), await textKlein('#overlay-card'));
check('fünf Legs gespielt', (await page.evaluate(() => window.__dart.currentMatch().legs.length)) === 5);

/* Zurücknehmen oeffnet das Spiel wieder -- der Satzstand rechnet sich neu. */
await page.locator('#overlay-card [data-action="undo-game"]').click();
check('nach Rücknahme wieder offen', await page.evaluate(() => !window.__dart.currentMatch().done));
{
  const s3 = await stand();
  check('Satzstand nach Rücknahme 1:0, Legs 1:1', s3.saetze[sA] === 1 && s3.legs[sA] === 1 && s3.legs[sB] === 1);
}
await typeScore(121);
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
check('Checkout erneut: Spiel entschieden', await page.evaluate(() => window.__dart.currentMatch().done));

await page.locator('#overlay-card [data-action="open-summary"]').click();
check('Auswertung nennt die Spieldauer und den Stand', (await textKlein('#summary-box')).includes('first to 2 sätze') &&
  (await textKlein('#summary-box')).includes('sätze 2:0'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
check('im Archiv mit Satzregel', await page.evaluate(() => {
  const h = window.__dart.state().history.find((x) => x.kind === 'quick' && x.matches[0].saetzeBestOf === 3);
  return !!h && h.matches[0].legs.length === 5 && h.matches[0].bestOf === 3;
}));
/* Zurueck auf ein Leg -- die folgenden Gruppen spielen das Schnelle Spiel
   wie bisher, und die Einstellung bleibt sonst im Speicher haengen. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.settings.quickSaetze = 1; S.settings.quickLegs = 1; D.save();
});

/* ---------- Best of: alle Legs werden gespielt, Kurzstatistik nach jedem Leg ---------- */

group('Schnelles Spiel: Best of 3 Legs spielt alle drei Legs');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  S.settings.quickModus = 1; S.settings.quickSaetze = 1; S.settings.quickLegs = 3;
  D.save(); D.setScreen('setup');
});
check('Hinweis: alle 3 Legs werden gespielt', (await textKlein('#quick-dauer-hint')).includes('alle 3 legs'));
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
const [bA, bB] = await page.evaluate(() => window.__dart.currentMatch().p);
check('Spiel traegt Best of 3 mit Merkmal "alle Legs"', await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  return m.bestOf === 3 && m.spieldauer.modus === 1 && m.spieldauer.alle === true;
}));
check('altes Best-of-Spiel ohne Merkmal rechnet wie damals: 2:0 ist entschieden', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  const alt = { p: m.p, bestOf: 3, saetzeBestOf: 1, spieldauer: { modus: 1, saetze: 1, legs: 3 },
    legs: [{ winner: m.p[0], visits: [] }, { winner: m.p[0], visits: [] }] };
  return D.satzStand(alt).sieger === m.p[0];
}));
await legFuer(bA);
check('Dialog nach Leg 1 zeigt die Kurzstatistik des Legs', (await page.locator('#overlay-card .leg-stat').count()) === 1 &&
  (await textKlein('#overlay-card .leg-stat')).includes('finish') && (await textKlein('#overlay-card .leg-stat')).includes('121'));
check('Leg-Sieger ist markiert', (await page.locator('#overlay-card .leg-stat thead th.sieger').innerText()) ===
  (await page.evaluate((id) => window.__dart.pname(id), bA)));
check('Statistik steht ueber den Knoepfen', await page.evaluate(() => {
  const st = document.querySelector('#overlay-card .leg-stat'), btn = document.querySelector('#overlay-card [data-action="ov-next-leg"]');
  return !!st && !!btn && (st.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuer(bA);
check('2:0 beendet Best of 3 NICHT - das dritte Leg wird gespielt', await page.evaluate(() => !window.__dart.currentMatch().done) &&
  (await textKlein('#overlay-card')).includes('leg an'), await textKlein('#overlay-card'));
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
check('Kopfzeile: Leg 3', (await textKlein('#game-leg-label')).includes('leg 3'));
await legFuer(bB);
check('nach drei Legs entschieden: 2:1 fuer A', await page.evaluate((a) => {
  const m = window.__dart.currentMatch(); return m.done && m.winner === a && m.legs.length === 3;
}, bA));
check('Glückwunsch an A mit Kurzstatistik des letzten Legs', (await textKlein('#overlay-card')).includes('glückwunsch, ' +
  (await page.evaluate((id) => window.__dart.pname(id), bA)).toLowerCase()) && (await page.locator('#overlay-card .leg-stat').count()) === 1);
await page.locator('#overlay-card [data-action="open-summary"]').click();
await page.locator('#summary-actions [data-action="finish-game"]').click();

group('Best of mit drei Spielern: Gleichstand nach allen Legs -> noch ein Leg, Sieger ist der Fuehrende');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 3).map((p) => p.id);
  S.settings.quickModus = 1; S.settings.quickSaetze = 1; S.settings.quickLegs = 3;
  D.save(); D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
const drei = await page.evaluate(() => window.__dart.currentMatch().p);
check('drei Spieler am Board', drei.length === 3);
/* Ein Leg (301) fuer einen bestimmten der drei: die anderen werfen 26. */
async function legFuerDrei(ziel) {
  while ((await dranId()) !== ziel) await typeScore(26);
  await typeScore(180); await typeScore(26); await typeScore(26); await typeScore(121);
  await page.locator('#overlay-card [data-action="co-darts"]').first().click();
}
await legFuerDrei(drei[0]); await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuerDrei(drei[1]); await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuerDrei(drei[2]);
check('1:1:1 nach drei Legs: noch nicht entschieden', await page.evaluate(() => !window.__dart.currentMatch().done));
check('Statistik mit drei Spalten', (await page.locator('#overlay-card .leg-stat.viele thead th').count()) === 4);
await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuerDrei(drei[1]);
check('viertes Leg entscheidet: Sieger ist der Fuehrende', await page.evaluate((b) => {
  const m = window.__dart.currentMatch(); return m.done && m.winner === b && m.legs.length === 4;
}, drei[1]));
await page.locator('#overlay-card [data-action="open-summary"]').click();
await page.locator('#summary-actions [data-action="finish-game"]').click();

group('Best of ab drei Spielern: das letzte Leg macht nicht automatisch den Sieger');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 3).map((p) => p.id);
  S.settings.quickModus = 1; S.settings.quickSaetze = 1; S.settings.quickLegs = 3;
  D.save(); D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
const drei2 = await page.evaluate(() => window.__dart.currentMatch().p);
await legFuerDrei(drei2[0]); await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuerDrei(drei2[0]); await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
await legFuerDrei(drei2[2]);
check('A 2, C 1: Spiel vorbei, Sieger A - obwohl C das letzte Leg ausgemacht hat', await page.evaluate((a) => {
  const m = window.__dart.currentMatch(); return m.done && m.winner === a;
}, drei2[0]) && (await textKlein('#overlay-card')).includes('glückwunsch, ' + (await page.evaluate((id) => window.__dart.pname(id), drei2[0])).toLowerCase()));
await page.locator('#overlay-card [data-action="open-summary"]').click();
await page.locator('#summary-actions [data-action="finish-game"]').click();

/* Zurueck auf First to / ein Leg -- die folgenden Gruppen spielen das
   Schnelle Spiel wie bisher, und die Einstellung bleibt sonst im Speicher. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.settings.quickModus = 0; S.settings.quickSaetze = 1; S.settings.quickLegs = 1; D.save();
});

/* ---------- Turnier-Modus: nur im Ligaspiel, Umschalten per Zyklus-Taste ---------- */

group('Modus-Knoepfe: Punkte, Einzel-Darts und Turnier direkt klickbar');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  S.mode = 'quick';
  S.settings.start = 501;   // fruehere Gruppen spielen 301 - hier zaehlt 501
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await page.locator('#bulloff-buttons button').first().click();
check('Menue, Fernsteuerung und Wechsel stehen oben - auch im Schnellen Spiel',
  (await visible('#game-menu')) && (await visible('#game-fern')) && (await visible('#game-swap')));
check('Punkte ist aktiv', await visible('#pad-total'));
/* Die Sechzig ruft den Loewen - im normalen Spiel, nicht in der Liga. */
await typeScore(60);
await page.waitForTimeout(100);
check('die Sechzig ruft den Loewen', (await page.locator('.feier .feier-logo').count()) === 1 &&
  (await text('.feier')).includes('SECHZIG'));
check('die Sechzig liegt unter der Dialog-Ebene', await page.evaluate(() => {
  const f = document.getElementById('feier');
  return f.classList.contains('sechzig') && parseInt(getComputedStyle(f).zIndex, 10) < 50;
}));
await page.evaluate(() => {
  const f = document.getElementById('feier');
  f.classList.remove('an', 'sechzig');
  f.innerHTML = '';
});
/* Eine vom Liga-Abend uebrig gebliebene Board-Einstellung startet das
   Schnelle Spiel NICHT automatisch in der Riesenanzeige - und ein Wechsel
   zwischen Punkte und Einzel-Darts loescht sie auch nicht. */
await page.evaluate(() => {
  const D = window.__dart;
  D.state().settings.turnierModus = 1;
  D.setScreen('game');
});
check('trotz gemerkter Board-Einstellung startet das Schnelle Spiel normal',
  (await visible('#pad-total')) &&
  await page.evaluate(() => document.getElementById('scoreboard').innerText.includes('Darts')));
await modus('darts');
check('ein Tipp wechselt auf Einzel-Darts', await visible('#pad-darts'));
check('und die Board-Einstellung ueberlebt den Wechsel',
  await page.evaluate(() => window.__dart.state().settings.turnierModus === 1));
await modus('total');
check('zurueck zu Punkte', await visible('#pad-total'));
/* Der Turnier-Knopf schaltet die Riesenanzeige bewusst auch hier ein. */
await modus('turnier');
check('Turnier-Modus auch im Schnellen Spiel per Knopf', await visible('#pad-key'));
await page.keyboard.press('Tab');
check('Tab schaltet aus dem Turnier-Modus weiter zu Punkte', await visible('#pad-total'));
/* Tab wandert durch alle drei Modi - wie ein Klick auf den naechsten Knopf. */
await page.keyboard.press('Tab');
check('Tab: Punkte -> Einzel-Darts', await visible('#pad-darts'));
await page.keyboard.press('Tab');
check('Tab: Einzel-Darts -> Turnier', await visible('#pad-key'));
await page.keyboard.press('Tab');
check('Tab: Turnier -> wieder Punkte', await visible('#pad-total'));
/* Spielende am Board: Pfeile waehlen zwischen Statistik und Ruecknahme,
   Enter bestaetigt - auch das Schnelle Spiel laeuft ohne Bildschirm-Tipp. */
await modus('turnier');
const tippeQ = async (z) => { await page.keyboard.type(z); await page.keyboard.press('Enter'); };
await tippeQ('180'); await tippeQ('180'); await tippeQ('180'); await tippeQ('180');
await tippeQ('141');
await page.keyboard.press('3');
check('das Spielende markiert die erste Wahl', await page.evaluate(() => {
  const o = window.__dart.ui().overlay;
  return !!(o && o.type === 'game-done' && document.querySelector('#overlay-card .btn.wahl') &&
    document.querySelector('#overlay-card .btn.wahl').textContent.includes('Spielstatistik'));
}));
await page.keyboard.press('ArrowDown');
check('Pfeil runter waehlt "Letzten Dart zurueck"', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('zurück')));
await page.keyboard.press('Enter');
check('Enter bestaetigt: der Checkout ist zurueckgenommen', await page.evaluate(() =>
  !window.__dart.ui().overlay && !window.__dart.state().game.done));
await tippeQ('141');
await page.keyboard.press('3');
await page.keyboard.press('Enter');
check('Enter oeffnet die Spielstatistik', await visible('#screen-summary'));

await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.settings.turnierModus = 0;
  D.ui().turnier = false;
  D.setScreen('setup');
});

group('Allein spielen: kein Ausbullen, eine grosse Karte');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = [D.activeProfiles()[0].id];
  S.mode = 'quick';
  S.settings.start = 501;
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
check('direkt im Spiel - gegen sich selbst bullt niemand aus', await visible('#screen-game'));
check('eine grosse Karte statt einer halb leeren Zweierreihe', await page.evaluate(() =>
  document.getElementById('scoreboard').classList.contains('solo') &&
  document.querySelectorAll('#scoreboard .pcard').length === 1));
check('der Verlauf steht mittig in einer Spalte', await page.evaluate(() =>
  document.getElementById('screen-game').classList.contains('solo')));
check('allein gibt es keinen Fernsteuerungs-Knopf',
  await page.locator('#game-fern').isHidden());
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
check('Tab pendelt allein nur zwischen Punkte und Einzel-Darts', await visible('#pad-total'));
/* Der Zurueck-Knopf verspricht "Stand bleibt erhalten" - auch allein. */
await page.evaluate(() => { window.__dart.ui().input = '60'; window.__dart.submitTotal(); });
await spielVerlassen();
check('zurueck fuehrt ins Setup und das Spiel bleibt stehen',
  (await visible('#screen-setup')) && await page.evaluate(() => !!window.__dart.state().game));
check('die Fortsetzen-Box bietet es an', await visible('#resume-box'));
await page.locator('[data-action="resume"]').click();
check('Fortsetzen fuehrt zurueck ins Spiel mit dem alten Stand',
  (await visible('#screen-game')) && (await rest(0)) === '441', await rest(0));
/* OK auf leerem Feld bucht die No-Score-Aufnahme. */
{
  const visitsVorher = await page.evaluate(() => {
    const D = window.__dart; return D.activeLeg(D.currentMatch()).visits.length;
  });
  await page.locator('.keypad button[data-key="ok"]').click();
  check('leeres OK bucht 0 Punkte mit drei Darts', await page.evaluate((n) => {
    const D = window.__dart, leg = D.activeLeg(D.currentMatch());
    const v = leg.visits[leg.visits.length - 1];
    return leg.visits.length === n + 1 && v.s === 0 && v.d === 3;
  }, visitsVorher));
  check('der Rest bleibt unveraendert', (await rest(0)) === '441');
}

/* Allein ausmachen ist kein Sieg: niemand wurde geschlagen. Average und
   Rekorde zaehlen trotzdem - nur die Bilanz (Siege/Niederlagen/Legs) nicht. */
const soloId = await page.evaluate(() => window.__dart.currentMatch().p[0]);
const soloVorher = await page.evaluate((id) => {
  const c = window.__dart.career()[id];
  return { won: c.won, lost: c.lost, matches: c.matches, legsWon: c.legsWon, darts: c.darts, form: c.lastResults.length };
}, soloId);
await page.evaluate(() => { window.__dart.state().settings.dartModeFrom = 0; });
await typeScore(180); await typeScore(180);           // 441 -> 261 -> 81
await modus('total');
await typeScore(81);                                   // Finish
await page.locator('#overlay-card [data-action="co-darts"]').first().click();
check('Solo-Spiel ist ausgemacht', await page.evaluate(() => window.__dart.currentMatch().done));
check('kein Glueckwunsch zum Sieg, sondern zum Ausmachen',
  (await textKlein('#overlay-card')).includes('ausgemacht') && !(await textKlein('#overlay-card')).includes('glückwunsch'));
await page.locator('#overlay-card [data-action="open-summary"]').click();
check('Auswertung sagt nicht "gewinnt"',
  (await textKlein('#summary-box')).includes('ausgemacht') && !(await textKlein('#summary-box')).includes('gewinnt'));
await page.locator('#summary-actions [data-action="finish-game"]').click();
const soloNachher = await page.evaluate((id) => {
  const c = window.__dart.career()[id];
  return { won: c.won, lost: c.lost, matches: c.matches, legsWon: c.legsWon, darts: c.darts, form: c.lastResults.length };
}, soloId);
check('Solo zaehlt nicht als Sieg', soloNachher.won === soloVorher.won, soloVorher.won + ' -> ' + soloNachher.won);
check('Solo zaehlt nicht als Spiel in der Bilanz', soloNachher.matches === soloVorher.matches);
check('Solo bringt kein gewonnenes Leg', soloNachher.legsWon === soloVorher.legsWon);
check('Solo taucht nicht in der Form auf', soloNachher.form === soloVorher.form);
check('die Darts zaehlen aber fuer den Average', soloNachher.darts > soloVorher.darts);
await page.evaluate((id) => { window.__dart.setScreen('players'); }, soloId);
await page.locator(`#players-list [data-id="${soloId}"]`).first().click();
const soloProfil = await text('#profile-detail');
check('das Profil listet das Solo-Spiel ohne Sieg und ohne Gegner',
  soloProfil.includes('Solo') && !soloProfil.includes('gegen undefined'), soloProfil.slice(0, 200));

await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 4).map((p) => p.id);
  /* Der Solo-Sechziger hat den Loewen gerufen - Buehne freimachen, damit
     der "keine Feier im Ligaspiel"-Check gleich nicht die alte Feier sieht. */
  const f = document.getElementById('feier');
  f.classList.remove('an', 'sechzig');
  f.innerHTML = '';
  D.setScreen('setup');
});

group('Turnier-Modus: Anzeige am Board, Eingabe per Tastatur - im Liga-Einzel');
await navTo('liga');
await page.locator('#liga-plan [data-action="liga-spiel"]').first().click();
for (let i = 0; i < 4; i++) {
  await page.locator(`[data-role="liga-gegner"][data-i="${i}"]`).fill('Probe');
  await page.locator(`[data-role="liga-gegner-nach"][data-i="${i}"]`).fill('Gegner' + (i + 1));
}
/* Mit Finish-Anzeigen - der Finish-Weg im Spielerfeld gehoert zum Test. */
await page.locator('[data-action="liga-finish"][data-value="1"]').click();
await page.locator('[data-action="liga-los"]').click();
check('das Ligaspiel steht', await visible('#screen-tournament'));
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
check('das Liga-Einzel beginnt mit dem Ausbullen (SWO 10/2026)', await visible('#screen-bulloff'));
await ligaAusbullen();
check('das Einzel oeffnet mit Wechsel- und Fernsteuerungs-Knopf', (await visible('#game-swap')) && (await visible('#game-fern')));
await modus('turnier');
check('Tastatur-Feld sichtbar', await visible('#pad-key'));
check('Zahlenfeld und Einzel-Darts weg', !(await visible('#pad-total')) && !(await visible('#pad-darts')));
check('der Wechsel-Knopf ist weg, die Fernsteuerung leuchtet - Esc fuehrt zurueck',
  !(await visible('#game-swap')) && await page.locator('#game-fern').evaluate((e) => e.classList.contains('an')));
check('Verlauf ausgeblendet', !(await page.locator('#history').isVisible()));
check('keine mittlere Finish-Leiste - der Finish steht im Spielerfeld',
  (await page.locator('#checkout-bar').count()) === 0);
check('wer nicht dran ist, tritt leicht zurueck', await page.evaluate(() => {
  const o = parseFloat(getComputedStyle(document.querySelector('.pcard:not(.active)')).opacity);
  return o >= 0.79 && o < 1;
}));
check('Rest steht in Plakatgroesse', await page.locator('.pcard .rest').first()
  .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) > 60));
check('die Eingabe-Anzeige steht bereit (kein echtes Feld, keine iPad-Leiste)',
  (await visible('#key-display')) &&
  (await page.evaluate(() => !document.querySelector('#pad-key input'))));
check('kein Ruecknahme-Knopf im Kopf - zurueck geht ueber Loeschen',
  (await page.locator('#screen-game .game-header [data-action="undo"]').count()) === 0);
check('die Seite fuellt genau den Bildschirm, nichts scrollt',
  await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));

/* Eintippen wie am Liga-Abend: Zahl, Enter. Es wirft der Heimspieler an. */
check('leer steht nur der blaue Eingabestrich',
  (await page.locator('#key-display .cursor').count()) === 1);
await page.keyboard.type('60');
check('die Anzeige zeigt gross, was getippt wurde', (await text('#key-display')).trim() === '60');
check('und der Strich ist beim Tippen weg',
  (await page.locator('#key-display .cursor').count()) === 0);
await page.keyboard.press('Enter');
check('Aufnahme gebucht: 501 - 60 = 441', (await rest(0)) === '441', await rest(0));
check('die Karte zeigt Schnitt, Siege und Darts', await page.evaluate(() => {
  const t = document.getElementById('scoreboard').innerText;
  return t.includes('\u00d8') && t.includes('Siege') && t.includes('Darts');
}));
/* Fernsteuerung: die Karten bleiben stehen - links der Heimspieler mit
   seiner 60 neben dem Rest, die Markierung wandert zum Gast rechts. Die
   Liste unter dem Heimspieler zeigt nur die Aufnahmen davor - noch keine. */
check('die Karten bleiben stehen: links Heim, rechts wirft jetzt der Gast - kein Drehrad neben dem Rest', await page.evaluate(() => {
  const k = document.querySelectorAll('#scoreboard .pcard');
  return k.length === 2 && !k[0].classList.contains('active') && k[1].classList.contains('active') &&
    !k[0].querySelector('.letzte') && !k[1].querySelector('.letzte');
}));
check('die Liste unter dem Heimspieler zeigt seine 60 (die letzten sechs, inklusive der letzten)',
  (await text('#key-hist-l')).includes('60') && (await text('#key-hist-l')).includes('Rest 441'));
check('keine Sechzig-Feier im Ligaspiel - auch nicht am Board', await page.evaluate(() =>
  !document.getElementById('feier').classList.contains('an')));

/* Loeschen im leeren Feld: zurueck zum letzten Spieler. */
await page.keyboard.press('Backspace');
check('leeres Feld + Loeschen nimmt die Aufnahme zurueck', (await rest(0)) === '501', await rest(0));

/* Unmoegliche Aufnahme: Fehler erscheint unter dem Feld. */
await page.keyboard.type('179');
await page.keyboard.press('Enter');
check('unmoegliche Zahl wird abgewiesen', (await text('#key-error')).includes('nicht möglich'));

await page.keyboard.type('45');
await page.keyboard.press('Enter');
check('der Modus bleibt nach der Aufnahme an', await visible('#pad-key'));
check('45 gebucht', (await rest(0)) === '456', await rest(0));

/* Shift gedrueckt halten: die Wurfliste, je Spieler auf seiner Seite. */
await page.keyboard.down('Shift');
check('Shift zeigt die Wurfliste', await page.locator('#history').isVisible());
check('mit den Aufnahmen beider Seiten', (await page.locator('#history .col').count()) === 2);
await page.keyboard.up('Shift');
check('Loslassen fuehrt in die Spielansicht zurueck', !(await page.locator('#history').isVisible()));

/* Zurueck in den normalen Modus: Tab - und ohne Esc-Taste (Magic Keyboard
   am iPad) geht auch Cmd+. als Apple-Escape. */
await page.keyboard.press('Tab');
check('Tab fuehrt in den normalen Modus zurueck', await visible('#pad-total'));
await modus('turnier');
await page.keyboard.press('Meta+.');
check('Cmd+. beendet den Turnier-Modus ebenfalls', await visible('#pad-total'));
await modus('turnier');
check('und der Weg zurueck steht wieder', await visible('#pad-key'));

/* Ein Tipp ins Bild tut nichts - das Menue oeffnet nur •••; ohne Tastatur
   fuehrt der ⌨-Knopf im Kopf zurueck. */
await page.locator('#scoreboard').click({ position: { x: 60, y: 60 } });
check('ein Tipp ins Bild oeffnet KEIN Menue', !(await visible('#game-menu-overlay')) && (await visible('#pad-key')));
await page.locator('#game-menu').click();
check('••• oeffnet es', await visible('#game-menu-overlay'));
await page.locator('#game-menu-overlay [data-action="game-menu-zu"]').click();
check('Weiterspielen schliesst es wieder', !(await visible('#game-menu-overlay')));
await page.locator('#game-fern').click();
check('der ⌨-Knopf beendet die Fernsteuerung', await visible('#pad-total'));
await modus('turnier');
check('und auch danach steht der Weg zurueck', await visible('#pad-key'));

/* Der Modus ueberlebt den Neustart - der Bildschirm haengt ja fest am Board.
   Nach dem Laden steht die Uebersicht; das naechste Liga-Einzel oeffnet
   direkt in der Riesenanzeige. */
await page.reload();
check('Turnier-Modus uebersteht den Neustart', await visible('#pad-key'));
check('und die Eingabe-Anzeige steht wieder bereit', await visible('#key-display'));
/* Auch der Weg ueber die Uebersicht: am Board-iPad (Modus gemerkt) oeffnet
   ein Liga-Einzel direkt in der Riesenanzeige. */
await page.evaluate(() => window.__dart.setScreen('tournament'));
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await ligaAusbullen();
check('das Liga-Einzel oeffnet nach dem Ausbullen im Turnier-Modus', await visible('#pad-key'));
/* Ziffernblock tippt Zahlen - auch mit NumLock aus (Playwright simuliert
   genau das: Numpad6 meldet dann "Pfeil rechts"). */
await page.keyboard.press('Numpad6'); await page.keyboard.press('Numpad0');
check('der Ziffernblock tippt im Turnier-Modus Zahlen, auch ohne NumLock',
  await page.evaluate(() => window.__dart.ui().input === '60'), await page.evaluate(() => window.__dart.ui().input));
await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');

/* Checkout am Board: die Dart-Frage wird mit 1/2/3 beantwortet - und eine
   verirrte Ziffer darf die Eingabe nicht veraendern, sonst wuerde aus der
   naechsten 5 still eine 95. */
const tippe = async (z) => { await page.keyboard.type(z); await page.keyboard.press('Enter'); };
await tippe('100');   // Gast -> 401
await tippe('180');   // Heim 456 -> 276
await tippe('100');   // Gast -> 301
await tippe('140');   // Heim -> 136
await tippe('140');   // Gast -> 161
await tippe('96');    // Heim -> 40
await tippe('60');    // Gast -> 101
check('der Finish-Weg steht im Kasten - auch beim Wartenden', await page.evaluate(() => {
  // Heim (40, am Wurf) sieht sein D20 - und der Gast (101, wartet) seinen Weg.
  const aktiv = document.querySelector('.pcard.active .pfinish').innerText;
  const wartend = document.querySelector('.pcard:not(.active) .pfinish').innerText;
  return aktiv.includes('D20') && wartend.trim() !== '';
}));
await tippe('40');    // Heim checkt aus - Abfrage nach den Darts
check('Checkout-Abfrage steht', (await text('#overlay-card')).includes('wie vielen Darts'));
await page.keyboard.press('9');   // daneben getippt - darf nichts tun
check('verirrte Ziffer veraendert die Eingabe nicht',
  await page.evaluate(() => window.__dart.ui().input === '40'));
check('die Abfrage steht noch', (await text('#overlay-card')).includes('wie vielen Darts'));
await page.keyboard.press('1');
check('Taste 1 bucht den Checkout mit einem Dart', await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  const co = m.legs[0].visits.filter((x) => x.c)[0];
  return !m.done && co && co.d === 1;
}));

group('Turnier-Modus: das ganze Einzel per Tastatur zu Ende');
check('das Leg-Ende steht in Plakatgroesse', await page.evaluate(() => {
  const ov = document.getElementById('overlay');
  return ov.classList.contains('gross') &&
    document.getElementById('overlay-card').textContent.includes('Leg an');
}));
check('Naechstes Leg ist als Wahl markiert', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('Nächstes Leg')));
await page.keyboard.press('ArrowDown');
check('Pfeil runter waehlt die Ruecknahme', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('rückgängig')));
await page.keyboard.press('ArrowUp');
check('Pfeil hoch fuehrt zurueck zu Naechstes Leg', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('Nächstes Leg')));
await page.keyboard.press('Numpad2');
check('Ziffernblock 2 waehlt nach dem Leg die Ruecknahme (statt still weiterzumachen)', await page.evaluate(() =>
  window.__dart.ui().overlay && window.__dart.ui().overlay.type === 'leg-done' &&
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('rückgängig')));
await page.keyboard.press('Numpad2');
check('noch einmal 2: "Zur Ligaspiel-Übersicht" bzw. Turnieruebersicht', await page.evaluate(() =>
  /bersicht/.test(document.querySelector('#overlay-card .btn.wahl').textContent)));
await page.keyboard.press('5');
check('andere Ziffern werden geschluckt', await page.evaluate(() =>
  window.__dart.ui().overlay && window.__dart.ui().overlay.type === 'leg-done' && window.__dart.ui().input === ''));
await page.keyboard.press('Numpad8');
await page.keyboard.press('Numpad8');
check('8 fuehrt wieder hoch zu Naechstes Leg', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.includes('Nächstes Leg')));
await page.keyboard.press('Enter');
check('Enter startet das naechste Leg', await page.evaluate(() =>
  !window.__dart.ui().overlay && window.__dart.currentMatch().legs.length === 2));
/* Leg 2 wirft der Gast an - der Heimspieler gewinnt es und damit das Match. */
await tippe('60');    // Gast
await tippe('180');   // Heim -> 321
await tippe('60');    // Gast
await tippe('180');   // Heim -> 141
await tippe('60');    // Gast
await tippe('141');   // Heim checkt - Dart-Frage
await page.keyboard.press('3');
check('das Einzel ist entschieden - erst kommt gross die Statistik', await page.evaluate(() => {
  const o = window.__dart.ui().overlay;
  return window.__dart.currentMatch().done &&
    o && o.type === 'turnier-ende' && o.phase === 'stat';
}));
check('mit Namen, Average und 180ern beider Spieler', await page.evaluate(() => {
  const t = document.getElementById('overlay-card').textContent;
  return t.includes('Spiel an') && t.includes('180er') && t.includes('Ø');
}));
await page.keyboard.press('Enter');
check('Enter blendet die naechsten Einzel gross ein', await page.evaluate(() => {
  const o = window.__dart.ui().overlay;
  const t = document.getElementById('overlay-card').textContent;
  return o && o.phase === 'weiter' && t.includes('Nächste Einzel') && t.includes('H2');
}));
check('die erste Begegnung leuchtet als naechste',
  (await page.locator('.te-zeile.dran').count()) === 1);
check('der Dialog fuellt den ganzen Bildschirm', await page.evaluate(() => {
  const r = document.getElementById('overlay-card').getBoundingClientRect();
  return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
}), await page.evaluate(() => {
  const r = document.getElementById('overlay-card').getBoundingClientRect();
  return JSON.stringify({ w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight });
}));
/* Mit den Pfeiltasten laesst sich eine andere Partie waehlen. */
await page.keyboard.press('ArrowDown');
check('Pfeil runter waehlt die zweite Begegnung', await page.evaluate(() =>
  document.querySelectorAll('.te-zeile')[1].classList.contains('dran')));
await page.keyboard.press('ArrowUp');
check('Pfeil hoch fuehrt zurueck zur ersten', await page.evaluate(() =>
  document.querySelectorAll('.te-zeile')[0].classList.contains('dran')));
check('unten steht "Zurück ins Menü"', await page.evaluate(() =>
  !!document.querySelector('#overlay-card .te-zeile.te-menue[data-action="to-tournament"]')));
await page.keyboard.press('Enter');
/* Seit der SWO 10/2026 kommt vor jedem Einzel das Ausbullen - am Board
   ebenfalls per Enter bestaetigt. */
check('Enter oeffnet das naechste Einzel mit dem Ausbullen', await visible('#screen-bulloff'));
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('Enter startet das naechste Einzel direkt in der Riesenanzeige',
  (await visible('#pad-key')) && await page.evaluate(() => {
    const m = window.__dart.currentMatch();
    return m && !m.done && m.legs.length === 1;
  }));

/* Aufraeumen fuer die naechsten Gruppen: das Probe-Ligaspiel restlos weg. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  D.ui().overlay = null;
  D.ui().turnier = false;
  S.settings.turnierModus = 0;
  S.tour = null; S.matches = []; S.current = null; S.game = null;
  S.history = S.history.filter((h) => !h.liga);
  S.profiles = S.profiles.filter((p) => !(p.gast && (p.voll || '').indexOf('Probe ') === 0));
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.setScreen('setup');
});

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
/* Wenn es nur eine Antwort gibt, nimmt sie die ganze Breite – sonst stuende
   sie in der Spalte, die im Boost fuer die Zahl neben D und T reserviert ist. */
check('und die nimmt die volle Breite', await page.evaluate(() => {
  const block = document.querySelector('#rtw-pad .rtw-treffer');
  const taste = block.querySelector('.rtw-key');
  return Math.abs(block.getBoundingClientRect().width - taste.getBoundingClientRect().width) < 1;
}));
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

/* ---------- Die 180er-Feier ---------- */

group('180: die Feier');
/* In den Gruppen davor faellt auch schon mal eine 180 – erst abwarten, bis
   die Buehne wieder frei ist, sonst prueft man die falsche Feier. */
await page.waitForFunction(() => !document.getElementById('feier').classList.contains('an'),
  null, { timeout: 6000 });
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
await page.locator('#settings-501 [data-setting="start"] button[data-value="501"]').click();
await page.locator('#settings-501 [data-action="eingabe"][data-value="0"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('vor der 180 ist es still', !(await page.evaluate(() =>
  document.getElementById('feier').classList.contains('an'))));
await typeScore(140);
check('140 ist keine Feier wert', !(await page.evaluate(() =>
  document.getElementById('feier').classList.contains('an'))));
await typeScore(180);   // der zweite Spieler
/* Der Neustart der Feier gönnt sich eine Frame-Pause (Safari-Fix) –
   deshalb kurz warten statt sofort nachzusehen. */
await page.waitForFunction(() => document.getElementById('feier').classList.contains('an'),
  null, { timeout: 2000 });
check('die Feier läuft', true);
const feierText = await text('#feier');
check('die 180 steht gross da', feierText.includes('180'));
/* Die Anzeige schreibt den Namen gross (text-transform), im Profil steht er
   normal – also ohne Ruecksicht auf die Schreibweise vergleichen. */
const werferName = await page.evaluate((id) =>
  window.__dart.state().profiles.find((p) => p.id === id).name,
  await page.evaluate(() => window.__dart.currentMatch().p[1]));
check('mit dem Namen des Werfers',
  feierText.toLowerCase().includes(werferName.toLowerCase()),
  feierText.replace(/\s+/g, ' ') + ' | gesucht: ' + werferName);
check('und einer Gratulation', feierText.toLowerCase().includes('gratuliere'));
check('Konfetti fliegt', (await page.locator('#feier .feier-konfetti i').count()) > 40);
check('Laserstrahlen auch', (await page.locator('#feier .feier-strahlen i').count()) === 8);
/*
 * Der wichtigste Test von allen: die Feier legt sich ueber den ganzen
 * Bildschirm, darf aber keinen einzigen Tipp schlucken. Wer sofort
 * weiterschreiben will, soll nicht fuenf Sekunden warten muessen.
 */
check('sie nimmt keine Klicks an', await page.evaluate(() => {
  const e = document.elementFromPoint(innerWidth / 2, innerHeight * 0.5);
  return !!e && !e.closest('#feier');
}));
const vorWurf = await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length);
await typeScore(60);
check('und man kann waehrenddessen weiterschreiben',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === vorWurf + 1);
/* Hoechstens fuenf Sekunden – danach ist wieder Ruhe. */
await page.waitForFunction(() => !document.getElementById('feier').classList.contains('an'),
  null, { timeout: 6000 });
check('nach spaetestens fuenf Sekunden ist Schluss', true);
check('und der Bildschirm ist wieder leer',
  (await page.evaluate(() => document.getElementById('feier').innerHTML)) === '');
check('der Wurf selbst ist ganz normal verbucht', await page.evaluate((id) => {
  const D = window.__dart, m = D.currentMatch();
  return D.activeLeg(m).visits.some((v) => v.p === id && v.s === 180);
}, await page.evaluate(() => window.__dart.currentMatch().p[1])));

/*
 * Ein Ueberwurf ist keine 180, auch wenn 180 dasteht: die Punkte zaehlen
 * nicht. Also wird auch nicht gefeiert. Spieler 2 steht nach zwei 180ern
 * auf 141 – der dritte kann gar nicht mehr aufgehen.
 */
const feierAn = () => page.evaluate(() => document.getElementById('feier').classList.contains('an'));
await typeScore(60);        // Spieler 1
await typeScore(180);       // Spieler 2 auf 141, feiert nochmal
await page.waitForFunction(() => !document.getElementById('feier').classList.contains('an'),
  null, { timeout: 6000 });
await typeScore(60);        // Spieler 1 – feiert inzwischen selbst den Löwen
/* Erst die Sechzig abklingen lassen: gleich soll geprüft werden, dass der
   BUST nicht gefeiert wird – nicht die 60 von eben. */
await page.waitForFunction(() => !document.getElementById('feier').classList.contains('an'),
  null, { timeout: 6000 });
const restVorBust = await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), leg = D.activeLeg(m);
  return D.remainingIn(leg, D.activePlayer(leg, m));
});
check('der Werfer steht unter 180, kann also nur ueberwerfen',
  restVorBust < 180, String(restVorBust));
await typeScore(180);
check('der Ueberwurf ist als Bust verbucht', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), leg = D.activeLeg(m);
  return leg.visits[leg.visits.length - 1].b === true;
}));
check('und wird nicht gefeiert', !(await feierAn()));

/* ---------- Farben im Einzel-Dart-Zahlenfeld ---------- */

group('Einzel-Darts: D und T sind blau, der Finish-Vorschlag bleibt rot');
await modus('darts');
await setMult(3);
const farben = await page.evaluate(() => {
  const wurzel = getComputedStyle(document.documentElement);
  const nimm = (v) => wurzel.getPropertyValue(v).trim();
  const alsRgb = (c) => { const d = document.createElement('div');
    d.style.color = c; document.body.appendChild(d);
    const r = getComputedStyle(d).color; d.remove(); return r; };
  return {
    mx: getComputedStyle(document.querySelector('#num-grid .mx')).color,
    laser: alsRgb(nimm('--laser-hell')),
    akzent: alsRgb(nimm('--accent'))
  };
});
check('das T vor der Feldzahl ist blau', farben.mx === farben.laser,
  farben.mx + ' vs ' + farben.laser);
check('und ausdruecklich nicht mehr rot', farben.mx !== farben.akzent);
await setMult(2);
check('beim Doppel steht ein D da', (await text('#num-grid')).includes('D'));
/* Der Finish-Vorschlag war nie gemeint und bleibt, wie er war. Ob gerade ein
   Finish moeglich ist, haengt am Spielstand – deshalb wird die Regel an
   einem eingesetzten Chip gemessen statt an einem zufaellig vorhandenen. */
/* Der Finish-Weg in der Karte ist neutral - kein Feld ist rot (Entwurf 10/2026). */
const chipFarbe = await page.evaluate(() => {
  const zeile = document.querySelector('.pcard.active .pfelder');
  const probe = document.createElement('span');
  probe.className = 'fk weg';
  zeile.appendChild(probe);
  const f = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return f;
});
check('die Finish-Felder sind neutral, nicht rot', (() => {
  const [r, g, b] = chipFarbe.match(/\d+/g).map(Number);
  return r < 80 && Math.abs(r - g) < 20 && Math.abs(r - b) < 20;
})(), chipFarbe);
await setMult(1);

/* ---------- Lieblingsdoppel ---------- */

group('Lieblingsdoppel: der Finish-Vorschlag stellt darauf');
/* Erst der Rechenkern allein – so ist bei einem Fehlschlag sofort klar, ob
   die Regel falsch ist oder nur die Anzeige. */
const weg = (rest, dbl) => page.evaluate(([r, d]) => window.Checkout.suggest(r, 3, d).join(' '), [rest, dbl]);
check('ohne Vorliebe bleibt alles wie bisher', (await weg(140, null)) === 'T20 T20 D10', await weg(140, null));
check('mit D16 wird auf D16 gestellt', (await weg(140, 16)) === 'T20 T16 D16', await weg(140, 16));
check('auch beim kleinen Rest (41)', (await weg(41, 16)) === 'S9 D16', await weg(41, 16));
check('Bull-Liebhaber bekommen den Bull', (await weg(60, 25)) === 'S10 BULL', await weg(60, 25));
/* Gleich gute Wege aufs selbe Doppel: lieber T19 und eine grosse Zahl als
   T20 und ein Stellwurf auf die kleinen Felder unten. */
check('99 auf D16: T19 10 D16 statt T20 7 D16', (await weg(99, 16)) === 'T19 S10 D16', await weg(99, 16));
check('das Doppel bleibt dabei das Lieblingsdoppel (108 auf D20)', (await weg(108, 20)).endsWith('D20'), await weg(108, 20));
/* Die Grenze: mehr Darts darf es nie kosten, und ein krummer Stellwurf
   wie T7 oder die 25 wird nicht angesagt, nur um das Doppel zu erreichen. */
check('nie ein Dart mehr', await page.evaluate(() => {
  for (let r = 2; r <= 170; r++) {
    const a = window.Checkout.suggest(r, 3);
    if (!a) continue;
    for (const d of [20, 18, 16, 12, 10, 8, 25]) {
      const b = window.Checkout.suggest(r, 3, d);
      if (b.length !== a.length) return false;
    }
  }
  return true;
}));
/* Nur die Wege, die WEGEN des Lieblingsdoppels abweichen, muessen sich an
   die Stellwurf-Regel halten. Der allgemeine Weg darf weiter T14 oder T13
   ansagen (62 und 63 gehen nun mal so) – daran aendert eine Vorliebe nichts. */
check('kein krummer Stellwurf, nur um das Doppel zu erreichen', await page.evaluate(() => {
  const schlecht = (w) => w === '25' || w[0] === 'D' || (w[0] === 'T' && Number(w.slice(1)) < 15);
  for (let r = 2; r <= 170; r++) {
    const a = window.Checkout.suggest(r, 3);
    if (!a) continue;
    for (const d of [20, 18, 16, 12, 10, 8, 25]) {
      const b = window.Checkout.suggest(r, 3, d);
      if (b.join() === a.join()) continue;          // unveraendert: nicht unser Fall
      if (b.slice(0, -1).some(schlecht)) return r + ' D' + d + ': ' + b.join(' ');
    }
  }
  return true;
}) === true);

// Und jetzt durch die Oberflaeche: einstellen, speichern, im Spiel sehen.
await page.evaluate(() => window.__dart.setScreen('setup'));
const dblId = await page.evaluate(() => window.__dart.activeProfiles()[0].id);
/* Ohne Server gibt es kein Konto -- den Profil-Dialog erreicht man hier
   ueber die Spielerliste. */
await page.evaluate(() => window.__dart.setScreen('players'));
await page.locator('.player-card[data-id="' + dblId + '"]').click();
await page.locator('[data-action="edit-current-profile"]').click();
check('das Profil bietet ein Lieblingsdoppel an',
  (await page.locator('[data-role="profile-double"]').count()) === 1);
check('voreingestellt ist "egal"',
  (await page.locator('[data-role="profile-double"]').inputValue()) === '0');
await page.locator('[data-role="profile-double"]').selectOption('16');
await page.locator('[data-action="save-profile"]').click();
check('die Wahl steht im Profil',
  await page.evaluate((id) => window.__dart.profile(id).dbl === 16, dblId));
await page.reload();
await page.waitForFunction(() => !!window.__dart);
check('und ueberlebt einen Neustart',
  await page.evaluate((id) => window.__dart.profile(id).dbl === 16, dblId));

await page.evaluate((id) => {
  const D = window.__dart, S = D.state();
  S.game = null;
  S.lineup = [id];
  D.setScreen('setup');
}, dblId);
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
await page.locator('#settings-501 [data-setting="start"] button[data-value="301"]').click();
await page.locator('#settings-501 [data-action="eingabe"][data-value="0"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await typeScore(161);   // 301 - 161 = 140
check('die Felder zeigen den Weg auf das Lieblingsdoppel',
  (await text('.pcard.active .pfinish')).includes('D16'), await text('.pcard.active .pfinish'));
check('und nicht mehr den allgemeinen',
  !(await text('.pcard.active .pfinish')).includes('D10'), await text('.pcard.active .pfinish'));
/* Zurueck auf "egal", damit die folgenden Gruppen ihren gewohnten Stand haben. */
await page.evaluate((id) => { window.__dart.profile(id).dbl = null; window.__dart.save(); }, dblId);

group('Liga: Spielplan, Kalender, Zusagen-Hinweis');
/* Das Trainingsspiel der Gruppe davor verwerfen – im Spiel ist die
   Navigation ja ausgeblendet. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null;
  D.setScreen('setup');
});
await navTo('liga');
check('Liga-Seite oeffnet sich', await visible('#screen-liga'));
check('Kopf nennt Team und Saison', (await text('#liga-sub')).includes('Blink 180'));
check('18 Spieltage stehen im Plan', (await page.locator('.liga-spieltag').count()) === 18,
  String(await page.locator('.liga-spieltag').count()));
check('zwei davon sind spielfrei', (await page.locator('.liga-spieltag.frei').count()) === 2);
const ersterSpieltag = await page.locator('.liga-spieltag:not(.frei)').first().innerText();
check('der erste Spieltag traegt Datum, Gegner und Ort',
  ersterSpieltag.includes('06.10.2026') && ersterSpieltag.includes('TSV Dachau') &&
  ersterSpieltag.includes('Bar Sehnsucht'), ersterSpieltag.replace(/\s+/g, ' ').slice(0, 80));
check('Heimspiele sind als Heim markiert', ersterSpieltag.toLowerCase().includes('heim'));
check('der Kalender-Knopf fuer alle Termine sitzt ueber der Liste',
  (await page.locator('#screen-liga [data-action="liga-ical"]:not([data-id])').count()) === 1);
check('der gewaehlte Spieltag hat sein eigenes Kalender-Icon',
  (await page.locator('#liga-karte [data-action="liga-ical"][data-id]').count()) === 1);
check('links steht gross der naechste Spieltag mit Datum, Gegner und Team',
  (await textKlein('#liga-karte')).includes('nächster spieltag') && (await textKlein('#liga-karte')).includes('spieltag ·') &&
  (await page.locator('#liga-karte .lk-teams .blink-logo').count()) === 1);
await page.locator('#liga-tabs button[data-tab="training"]').click();
check('Training: DiensDarts links, Uebungsspiel mit Gegner-Vorwahl rechts',
  (await textKlein('#dienstdarts-karte')).includes('diensdarts') && (await page.locator('#uebung-karte [data-action="uebung-vorwahl"][data-value="mittel"].active').count()) === 1);
await page.locator('#liga-tabs button[data-tab="tabelle"]').click();
check('Tabelle: rechts unser Platz', (await textKlein('#lt-platz')).includes('unser platz') && (await text('#lt-platz')).includes('.'));
await page.locator('#liga-tabs button[data-tab="plan"]').click();
/* Ohne Server gibt es keine Konten – der Plan bleibt lesbar, das
   Eintragen erklaert sich per Hinweis. */
check('ohne Konto gibt es keinen Eintragen-Knopf',
  (await page.locator('[data-action="liga-zusage"]').count()) === 0);
/* Die iCal-Datei selbst: das Kopf-Icon laedt alle Termine. */
const [ical] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#screen-liga [data-action="liga-ical"]:not([data-id])').click()
]);
check('die iCal-Datei heisst nach dem Team',
  ical.suggestedFilename() === 'blink180-spielplan.ics');
const icalPfad = await ical.path();
const icalInhalt = fs.readFileSync(icalPfad, 'utf8');
check('sie enthaelt 16 Termine', (icalInhalt.match(/BEGIN:VEVENT/g) || []).length === 16);
check('mit Datum und Ort des ersten Spieltags',
  icalInhalt.includes('DTSTART;VALUE=DATE:20261006') && icalInhalt.includes('Bar Sehnsucht'));
/* Das Icon am einzelnen Termin laedt nur diesen einen - ein Tipp rechts
   zeigt den Spieltag links gross. */
await page.locator('#liga-liste [data-action="liga-wahl"][data-id="st02"]').click();
check('ein Tipp auf einen Spieltag zeigt ihn links gross', (await text('#liga-karte')).includes('Germering'));
await page.locator('#liga-liste [data-action="liga-wahl"][data-id="st01"]').click();
const [einzel] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#liga-karte [data-action="liga-ical"][data-id="st01"]').click()
]);
check('ein Termin allein heisst nach seinem Spieltag',
  einzel.suggestedFilename() === 'blink180-spieltag-1.ics');
check('und enthaelt genau einen Eintrag',
  (fs.readFileSync(await einzel.path(), 'utf8').match(/BEGIN:VEVENT/g) || []).length === 1);

/* Der Regeln-Reiter: Udos Regelecke, aufklappbar. */
await page.locator('#liga-tabs button[data-tab="regeln"]').click();
check('der Regeln-Reiter zeigt die Regelecke',
  (await visible('#liga-regeln')) && !(await visible('#liga-plan')));
check('mit FAQ und Regelecke zum Aufklappen', (await page.locator('#liga-regeln details').count()) === 14,
  String(await page.locator('#liga-regeln details').count()));
check('das FAQ beantwortet die Grundfragen', await page.evaluate(() => {
  const t = document.getElementById('liga-regeln').textContent;
  return t.includes('16 Einzel') && t.replace(/\s+/g, ' ').includes('Jedes Spiel beginnt mit dem') && t.includes('N01') &&
    t.includes('Schiedsrichter') && t.includes('Bust') && t.includes('Gastspieler');
}));
check('darunter der Schreiber und das Score-Nachfragen', await page.evaluate(() => {
  // textContent statt innerText: zugeklappte <details> verstecken ihren Text.
  const t = document.getElementById('liga-regeln').textContent;
  return t.includes('Schreiber') && t.includes('40 Rest') && t.includes('wurffertige Haltung');
}));
check('und die Regelwerke sind verlinkt',
  (await page.locator('#liga-regeln .regel-links a').count()) === 3);
await page.locator('#liga-tabs button[data-tab="plan"]').click();
check('zurueck zum Spielplan', await visible('#liga-plan'));

group('DiensDarts und Uebungs-Ligaspiel gegen Bots');
await page.locator('#liga-tabs button[data-tab="training"]').click();
check('der Trainings-Reiter oeffnet sich',
  (await visible('#liga-training')) && !(await visible('#liga-plan')));
check('DiensDarts nennt Dienstag und die Sehnsucht', await page.evaluate(() => {
  const t = document.getElementById('dienstdarts-karte').textContent;
  return t.includes('DiensDarts') && t.includes('Dienstag') && t.includes('Sehnsucht');
}));
check('das Sehnsucht-Logo haengt an der Karte',
  (await page.locator('#dienstdarts-karte .sehnsucht-logo').count()) === 1);
check('ohne Konto verweist die Umfrage auf die Anmeldung',
  (await text('#dienstdarts-karte')).includes('anmelden'));

/* Das Uebungsspiel gegen Bots: kompletter Liga-Ablauf, aber ohne Wertung. */
await page.locator('[data-action="uebung-start"]').click();
check('der Aufstellungs-Dialog oeffnet sich', (await text('#overlay-card')).includes('Übungs-Ligaspiel'));
check('Bots mittel sind vorgewaehlt', await page.evaluate(() =>
  document.querySelector('[data-action="uebung-gegner"][data-value="mittel"]').classList.contains('active')));
await page.locator('[data-action="uebung-los"]').click();
check('das Uebungsspiel steht wie ein Ligaspiel', (await visible('#screen-tournament')) &&
  await page.evaluate(() => {
    const S = window.__dart.state();
    return S.tour.liga && S.tour.liga.uebung && S.matches.length === 16 &&
      S.matches[0].scheibe === 'S1' && S.matches[1].scheibe === 'S2';
  }));
check('vier Bots stehen als Gegner bereit', await page.evaluate(() =>
  window.__dart.state().profiles.filter((p) => p.bot === 'mittel').length === 4));
check('der Team-Stand ist da wie im echten Ligaspiel', await visible('#liga-stand'));

/* Erstes Einzel: der Mensch wirft, dann wirft der Bot von selbst. */
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.evaluate(() => { window.__dart.ui().input = '60'; window.__dart.submitTotal(); });
check('nach dem Menschen ist der Bot dran', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return D.profile(D.activePlayer(D.activeLeg(m), m)).bot === 'mittel';
}));
await page.waitForFunction(() => {
  const D = window.__dart, m = D.currentMatch();
  return D.activeLeg(m).visits.length >= 2;
}, null, { timeout: 5000 });
check('der Bot hat eine gueltige Aufnahme gebucht', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  const v = D.activeLeg(m).visits[1];
  return v.s >= 0 && v.s <= 180 && !v.b;
}));
check('und der Mensch ist wieder am Wurf', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return !D.profile(D.activePlayer(D.activeLeg(m), m)).bot;
}));

/* Abbrechen: das Uebungsspiel landet im Archiv, zaehlt aber nirgends
   in der Liga-Wertung. */
await spielVerlassen();
await page.locator('[data-action="reset"]').click();
await page.locator('[data-action="ov-reset"]').click();
check('das Uebungsspiel liegt als solches im Archiv', await page.evaluate(() =>
  window.__dart.state().history.some((h) => h.liga && h.liga.uebung)));
await ligaStatistik();
check('die Liga-Rangliste zaehlt das Uebungsspiel nicht',
  (await text('#boards-sub')).includes('noch kein Spieltag'));
/* Aufraeumen: Archiv-Eintrag und Bots weg. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.history = S.history.filter((h) => !(h.liga && h.liga.uebung));
  S.profiles = S.profiles.filter((p) => !p.bot);
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.ui().boardMode = '501';
  D.setScreen('liga');
});
await page.locator('#liga-tabs button[data-tab="plan"]').click();

group('Liga-Tabelle: eigener Reiter, von Hand gepflegt');
await page.locator('#liga-tabs button[data-tab="tabelle"]').click();
check('der Tabellen-Reiter oeffnet sich',
  (await visible('#liga-tabelle')) && !(await visible('#liga-plan')));
check('alle neun Teams der Liga stehen vorbefuellt drin',
  (await page.locator('#lt-tabelle tbody tr').count()) === 9,
  String(await page.locator('#lt-tabelle tbody tr').count()));
check('Blink 180 ist hervorgehoben', await page.evaluate(() => {
  const tr = document.querySelector('#lt-tabelle tr.leader');
  return !!tr && tr.textContent.includes('Blink 180');
}));
check('jede Zeile laesst sich Feld fuer Feld ausfuellen',
  (await page.locator('#lt-tabelle td[contenteditable]').count()) === 72);
check('mit den Spalten der Ligaleitung (Sp, g, u, v, Legs, Spiele, Pkt)', await page.evaluate(() =>
  [...document.querySelectorAll('#lt-tabelle thead th')].map((th) => th.textContent).join(',') === '#,Mannschaft,Sp,g,u,v,Legs,Spiele,Pkt'));
check('ohne Konto gibt es keinen Speichern-Knopf', await page.locator('#lt-speichern').isHidden());
check('dafuer den Hinweis, sich anzumelden', (await text('#lt-stand')).includes('anmelden'));
await page.locator('#liga-tabs button[data-tab="plan"]').click();

group('Buergerlicher Name im Profil');
await navTo('players');
await page.locator('#players-list .player-card:has-text("Lenas")').click();
await page.locator('[data-action="edit-current-profile"]').click();
check('das Profil hat je ein Feld fuer Vor- und Nachnamen',
  (await page.locator('[data-role="profile-vor"]').count()) === 1 &&
  (await page.locator('[data-role="profile-nach"]').count()) === 1);
await page.locator('[data-role="profile-vor"]').fill('Lena');
await page.locator('[data-role="profile-nach"]').fill('Musterfrau');
await page.locator('[data-action="save-profile"]').click();
check('der volle Name ist gespeichert', await page.evaluate(() =>
  window.__dart.state().profiles.find((p) => p.name === 'Lenas').voll === 'Lena Musterfrau'));
await navTo('liga');

/* ---------- Ligaspiel-Modus: der Spielberichtsbogen als Spielplan ---------- */

group('Ligaspiel: 16 Einzel nach Spielberichtsbogen');
await page.locator('#liga-plan [data-action="liga-spiel"]').first().click();
check('die Aufstellung oeffnet sich', (await text('#overlay-card')).includes('Ligaspiel'));
check('unsere vier Positionen sind vorbelegt',
  (await page.locator('[data-role="liga-pos"]').count()) === 4);
/* Ohne Gegner geht es nicht los. */
await page.locator('[data-action="liga-los"]').click();
check('ohne Gegnernamen gibt es eine Ansage', (await text('#overlay-card')).includes('vier Gegner'));
for (let i = 0; i < 4; i++) {
  await page.locator(`[data-role="liga-gegner"][data-i="${i}"]`).fill('Dachau');
  await page.locator(`[data-role="liga-gegner-nach"][data-i="${i}"]`).fill(String(i + 1));
}
await page.locator('[data-action="liga-los"]').click();
check('das Ligaspiel steht', await visible('#screen-tournament'));
check('der Kopf sagt Ligaspiel', (await text('#screen-tournament h1')).toLowerCase().includes('ligaspiel'));
check('16 Einzel in 4 Durchgaengen', await page.evaluate(() => {
  const M = window.__dart.state().matches;
  return M.length === 16 && M.filter((m) => m.round === 4).length === 4;
}));
check('der Team-Stand steht statt der Tabelle',
  (await visible('#liga-stand')) && !(await page.locator('#screen-tournament .standings').isVisible()));
check('die Gegner sind als Gaeste angelegt', await page.evaluate(() => {
  return window.__dart.state().profiles.filter((p) => p.gast && p.name.indexOf('Dachau ') === 0).length === 4;
}));
check('jede Begegnung traegt ihre H/G-Kennungen',
  (await page.locator('#schedule .posmark').count()) === 32,
  String(await page.locator('#schedule .posmark').count()));
check('im Liga-Kontext steht der buergerliche Name statt des Spitznamens',
  (await text('#schedule')).includes('Lena Musterfrau'));

/* Erstes Einzel: es wird ausgebullt (SWO Punkt 8, Oktober 2026) -
   hier gewinnt der Heimspieler das Ausbullen und wirft an. */
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
check('erst das Ausbullen, noch kein Anwerfer', (await visible('#screen-bulloff')) &&
  await page.evaluate(() => !window.__dart.currentMatch().starter));
await ligaAusbullen();
check('danach auf dem Spielbildschirm', await visible('#screen-game'));
check('der Gewinner des Ausbullens wirft das erste Leg an', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return m.starter === m.p[0] && D.activePlayer(D.activeLeg(m), m) === m.p[0];
}));
/* Ein Einzel im Schnelldurchlauf: der Anwurf wechselt je Leg, also gewinnt
   immer der Anwerfer – Heim, Gast, Heim: 2:1 fuer unseren Spieler. */
const visit = (n) => page.evaluate((v) => {
  window.__dart.ui().input = String(v);
  window.__dart.submitTotal();
}, n);
for (let leg = 0; leg < 3; leg++) {
  await visit(180);
  if (leg === 0) {
    check('keine 180er-Feier mitten im Ligaspiel',
      await page.evaluate(() => !document.querySelector('.feier.an')));
  }
  await visit(41);
  await visit(180); await visit(41);
  await visit(141);
  await page.locator('#overlay-card [data-action="co-darts"]').first().click();
  if (await page.locator('#overlay-card [data-action="ov-next-leg"]').count()) {
    await page.locator('#overlay-card [data-action="ov-next-leg"]').click();
  }
}
check('das Einzel ist entschieden', await page.evaluate(() => window.__dart.currentMatch().done));
check('unser Heimspieler hat es 2:1 gewonnen', await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  return m.winner === m.p[0];
}));
/* Zurueck zur Uebersicht (ueber die Statistik, wie am Abend auch). */
await page.locator('#overlay-card [data-action="open-summary"]').click();
await page.locator('[data-action="summary-back"]').click();
check('der Team-Stand zaehlt 1:0 und Legs 2:1', await page.evaluate(() => {
  const t = document.getElementById('liga-stand').innerText.replace(/\s+/g, ' ');
  return t.includes('Legs 2:1') && t.includes('1 von 16');
}));
check('die 180er stehen fuer den Spielbericht bereit', await page.evaluate(() => {
  const el = document.getElementById('liga-stand');
  return el.innerText.includes('180er');
}));
check('gross stehen die Punkte: ein gewonnenes Einzel = 1:0', await page.evaluate(() => {
  const z = [...document.querySelectorAll('#liga-stand .lg-zahl')].map((e) => e.textContent.trim());
  return z.join(':') === '1:0';
}));
await page.keyboard.press('NumpadMultiply');
check('"*" zeigt im Ligaspiel den Zwischenstand gross', await page.evaluate(() => {
  const o = window.__dart.ui().overlay; const t = document.getElementById('overlay-card').textContent;
  return !!o && o.type === 'team-stand' && t.includes('Zwischenstand') && t.includes('1 von 16 gespielt');
}));
await page.keyboard.press('NumpadMultiply');
check('nochmal "*" blendet ihn aus', await page.evaluate(() => !window.__dart.ui().overlay));
check('jedes Einzel traegt seine Scheibe', await page.evaluate(() => {
  const M = window.__dart.state().matches;
  return M[0].scheibe === 'S1' && M[1].scheibe === 'S2';
}));

group('Kampflos nach SWO: nicht gestellter Spieler');
check('offene Einzel bieten den w.o.-Knopf an',
  (await page.locator('#schedule .go.wo').count()) === 15,
  String(await page.locator('#schedule .go.wo').count()));
await page.locator('#schedule .go.wo').first().click();
check('der Dialog fragt, wer nicht antritt', (await text('#overlay-card')).includes('Kampflos'));
/* Der Gast (zweiter Knopf) fehlt - unser Heimspieler gewinnt 2:0 ohne Wurf. */
await page.locator('[data-action="liga-kampflos-wer"]').nth(1).click();
check('das Einzel ist ohne einen einzigen Wurf gewertet', await page.evaluate(() => {
  const m = window.__dart.state().matches.find((x) => x.kampflos);
  return !!m && m.done && m.legs.length === 0;
}));
check('der Stand zaehlt es voll: 2:0 Punkte und Legs 4:1', await page.evaluate(() => {
  const z = [...document.querySelectorAll('#liga-stand .lg-zahl')].map((e) => e.textContent.trim());
  const t = document.getElementById('liga-stand').innerText.replace(/\s+/g, ' ');
  return z.join(':') === '2:0' && t.includes('Legs 4:1');
}));
check('am gewerteten Einzel steht jetzt aendern', (await text('#schedule')).includes('ändern'));
/* Und die Wertung laesst sich zuruecknehmen ... */
await page.locator('#schedule .go.wo').first().click();
await page.locator('[data-action="liga-kampflos-zurueck"]').click();
check('zurueckgenommen: wieder 1:0 Punkte und das Einzel offen', await page.evaluate(() => {
  const z = [...document.querySelectorAll('#liga-stand .lg-zahl')].map((e) => e.textContent.trim());
  return z.join(':') === '1:0' && !window.__dart.state().matches.some((x) => x.kampflos);
}));
/* ... und fuer den Spielbericht gleich wieder eintragen. */
await page.locator('#schedule .go.wo').first().click();
await page.locator('[data-action="liga-kampflos-wer"]').nth(1).click();

/* Ohne Finish-Hilfen (Voreinstellung): im Einzel gibt es keine Finish-Leiste –
   der Schreiber darf das Doppel ja nicht ansagen (WDF 3.08). */
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await ligaAusbullen();
check('Liga-konform: keine Finish-Felder im Einzel', (await page.locator('#scoreboard .pcard .pfelder .fk').count()) === 0);
await spielVerlassen();
/* Das Oeffnen hat ein leeres Leg angelegt - der w.o.-Knopf muss bleiben,
   solange kein echter Wurf gefallen ist (15 = 14 offene + 1x aendern). */
check('ein nur angetipptes Einzel behaelt den w.o.-Knopf',
  (await page.locator('#schedule .go.wo').count()) === 15,
  String(await page.locator('#schedule .go.wo').count()));

/* Spielerwechsel: nur auf derselben Position, Gegner als neuer Gast. */
await page.locator('[data-action="roster-change"]').click();
check('der Wechsel-Dialog zeigt alle acht Positionen',
  (await page.locator('#overlay-card [data-action="liga-wechsel-pos"]').count()) === 8);
await page.locator('[data-action="liga-wechsel-pos"][data-seite="G"][data-pos="1"]').click();
await page.locator('[data-role="liga-neu-name"]').fill('Dachau');
await page.locator('[data-role="liga-neu-nach"]').fill('Ersatz');
await page.locator('[data-action="liga-wechsel-ok"]').click();
check('der Ersatz steht auf G2 und das Team zaehlt fuenf', await page.evaluate(() => {
  const lg = window.__dart.state().tour.liga;
  return window.__dart.profile(lg.posG[1]).name === 'Dachau Ersatz' && lg.gastSpieler.length === 5;
}));
check('alle offenen G2-Einzel gehoeren jetzt dem Ersatz', await page.evaluate(() => {
  const S = window.__dart.state();
  return S.matches
    .filter((m) => m.posPaar && m.posPaar[1] === 1 && !m.done && !m.legs.some((l) => l.visits.length))
    .every((m) => window.__dart.profile(m.p[1]).name === 'Dachau Ersatz');
}));
await page.locator('#overlay-card [data-action="ov-cancel"]').click();

/* Der Spielbericht: Udos Bogen, automatisch befuellt und korrigierbar. */
await page.locator('[data-action="liga-bericht"]').click();
check('der Spielbericht oeffnet sich', await visible('#screen-bericht'));
check('nach einem Wechsel steht die echte Bogennummer im Einzel (G5 statt G2)', await page.evaluate(() =>
  document.getElementById('bericht-blatt').textContent.includes('– G5')));
check('die eingewechselte Nummer ist eingekreist (Wunsch Ligaleitung), die anderen nicht', await page.evaluate(() => {
  const k = [...document.querySelectorAll('#bericht-blatt th[data-plan] .b-wechsel')].map((e) => e.textContent);
  return k.length > 0 && k.every((t) => t === 'G5') && !!document.querySelector('#bericht-blatt .b-klein .b-wechsel');
}));
check('auch eine Handkorrektur der Einzel-Bezeichnung wird eingekreist', await page.evaluate(() => {
  const th = document.querySelector('#bericht-blatt th[data-plan="1|1"]');
  th.focus(); th.textContent = 'H5 – G1'; th.dispatchEvent(new Event('input', { bubbles: true })); th.blur();
  const ok = th.querySelectorAll('.b-wechsel').length === 1 && th.querySelector('.b-wechsel').textContent === 'H5';
  th.focus(); th.textContent = 'H1 – G1'; th.dispatchEvent(new Event('input', { bubbles: true })); th.blur();
  return ok && !th.querySelector('.b-wechsel');
}));
check('mit den 16 Einzeln in Bogen-Reihenfolge', await page.evaluate(() => {
  const t = document.getElementById('bericht-blatt').textContent;
  return t.includes('H1 – G1') && t.includes('H3 – G1') && t.includes('H2 – G4');
}));
check('Ergebnis je Einzel wie auf dem Bogen: 1 : 0 / 0 : 1, Summe im Endergebnis', await page.evaluate(() => {
  const D = window.__dart, M = D.state().matches;
  const zeilen = [...document.querySelectorAll('.b-einzel tr')].slice(1);
  const ok = M.every((m, i) => {
    const erg = zeilen[i].querySelectorAll('td')[1].textContent.trim();
    if (!m.done) return erg === ':';
    return erg === (m.winner === m.p[0] ? '1 : 0' : '0 : 1');
  });
  const h = M.filter((m) => m.done && m.winner === m.p[0]).length, g = M.filter((m) => m.done && m.winner === m.p[1]).length;
  const ende = document.querySelectorAll('.b-ende td')[1].textContent.trim();
  return ok && ende === h + ' : ' + g && M.some((m) => m.done);
}));
check('jeder Spieler beider Teams spielt 2x an S1 und 2x an S2', await page.evaluate(() => {
  const M = window.__dart.state().matches;
  return [0, 1].every((s) => [0, 1, 2, 3].every((p) =>
    M.filter((m) => m.posPaar[s] === p && m.scheibe === 'S1').length === 2 &&
    M.filter((m) => m.posPaar[s] === p && m.scheibe === 'S2').length === 2));
}));
check('das kampflose Einzel traegt den w.o.-Vermerk', await page.evaluate(() => {
  const t = document.getElementById('bericht-blatt').textContent.replace(/\s+/g, ' ');
  return t.includes('2 : 0 w.o.');
}));
check('der Nachname aus dem Profil steht getrennt im Bogen', await page.evaluate(() => {
  const t = document.getElementById('bericht-blatt').textContent;
  return t.includes('Musterfrau');
}));
check('die Highlights stehen in Udos Form', await page.evaluate(() => {
  const t = document.getElementById('bericht-blatt').textContent;
  return t.includes('Lenas 180') && t.includes('141 Finish');
}));
check('das Blatt laesst sich Feld fuer Feld korrigieren',
  (await page.locator('#bericht-blatt [contenteditable]').count()) > 40);

group('Spielbericht: beide TCs unterschreiben am iPad, dann Versand als PDF');
{
  const malen = async () => {
    const box = await page.locator('#signatur').boundingBox();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.15 + i * 0.05), box.y + box.height * (0.6 - Math.sin(i) * 0.2));
    await page.mouse.up();
  };
  check('oben steht Unterschreiben statt Drucken',
    await visible('#screen-bericht [data-action="bericht-unterschreiben"]'));
  await page.locator('#screen-bericht [data-action="bericht-unterschreiben"]').click();
  check('mit offenen Einzeln wird noch nicht unterschrieben', (await text('#overlay-card')).includes('Noch nicht fertig'));
  await page.locator('#overlay-card [data-action="ov-hinweis-zu"]').click();
  /* Fuer den Rest des Tests: die offenen Einzel als entfallen markieren. */
  await page.evaluate(() => { window.__dart.state().matches.forEach((m) => { if (!m.done) m.void = 'test'; }); });
  await page.locator('#screen-bericht [data-action="bericht-unterschreiben"]').click();
  check('ganzer Bildschirm fuer TC Heim mit Unterschriftsfeld',
    (await text('#overlay-card h3')).includes('TC Heim') && await visible('#signatur') &&
    await page.evaluate(() => document.getElementById('overlay').classList.contains('vollbild')));
  await page.locator('[data-action="signatur-weiter"]').click();
  check('ohne Unterschrift geht es nicht weiter', (await text('#overlay-card')).includes('Bitte erst im Feld unterschreiben'));
  await malen();
  await page.locator('[data-action="signatur-nochmal"]').click();
  check('Nochmal leert das Feld', await page.evaluate(() => window.__dart.ui().overlay.striche.length === 0));
  await malen();
  await page.locator('[data-action="signatur-weiter"]').click();
  check('danach TC Gast', (await text('#overlay-card h3')).includes('TC Gast'));
  await malen();
  await page.locator('[data-action="signatur-weiter"]').click();
  check('dann die Mailadressen, die Ligaleitung ist vorbelegt', await page.evaluate(() =>
    document.querySelector('[data-role="bericht-mail"][data-i="0"]').value === 'spielbericht@steeldart-muenchen.de'));
  check('beide Unterschriften stehen im Bericht',
    (await page.locator('#bericht-blatt .b-unterschrift img').count()) === 2);
  await page.locator('[data-role="bericht-mail"][data-i="1"]').fill('kein-mail');
  await page.locator('[data-action="bericht-senden"]').click();
  check('eine falsche Adresse wird abgefangen', (await text('#overlay-card')).includes('nicht nach einer Mailadresse'));
  await page.locator('#overlay-card [data-action="ov-cancel"]').click();

  /* Nach beiden Unterschriften ist der Bericht final. */
  check('nach beiden Unterschriften ist der Bericht final: kein Feld mehr aenderbar', await page.evaluate(() =>
    document.getElementById('bericht-blatt').classList.contains('final') &&
    document.querySelectorAll('#bericht-blatt [contenteditable="true"], #bericht-blatt [contenteditable=""]').length === 0));
  check('oben steht jetzt "Versenden"', (await textKlein('#screen-bericht [data-action="bericht-unterschreiben"]')).includes('versenden'));
  check('kein Nachmelden mehr im finalen Bericht', !(await visible('#bericht-blatt [data-action="liga-nachmelden"]')));
  /* Fuer die naechsten Pruefungen: Unterschriften zuruecksetzen. */
  await page.evaluate(() => {
    const D = window.__dart; delete D.state().tour.liga.unterschriften; D.berichtNeu(); D.save(); D.setScreen('bericht');
  });
  check('ohne Unterschriften ist wieder jedes Feld aenderbar', await page.evaluate(() =>
    !document.getElementById('bericht-blatt').classList.contains('final') &&
    document.querySelectorAll('#bericht-blatt th[contenteditable][data-kf]').length === 16));
  await page.locator('#bericht-blatt [data-kf="einzel-15"]').click();
  await page.keyboard.press('End'); await page.keyboard.type(' (H5)');
  await page.locator('#bericht-blatt [data-action="bericht-kreuz"][data-feld="proteste"][data-wert="nein"]').click();
  check('Ja/Nein laesst sich ankreuzen', (await text('#bericht-blatt td[data-feld="proteste"]')).replace(/\s+/g, ' ').includes('nein X'));
  await page.evaluate(() => { const D = window.__dart; D.berichtNeu(); D.setScreen('bericht'); });
  check('Einzel-Bezeichnung und Kreuz bleiben nach dem Neuaufbau', (await text('#bericht-blatt [data-kf="einzel-15"]')).includes('(H5)') &&
    (await text('#bericht-blatt td[data-feld="proteste"]')).replace(/\s+/g, ' ').includes('nein X'));

  /* Nachmeldung: Formular, Unterschrift, dann steht sie auf Seite 2 und im Team. */
  await page.locator('#bericht-blatt [data-action="liga-nachmelden"]').click();
  check('Nachmelden oeffnet ein ganzes Formular', (await text('#overlay-card h3')).includes('Spieler nachmelden') &&
    await page.evaluate(() => document.getElementById('overlay').classList.contains('vollbild')));
  await page.locator('[data-action="nm-weiter"]').click();
  check('unvollstaendig geht es nicht weiter', (await text('#overlay-card')).includes('Bitte alle Felder'));
  await page.locator('[data-role="nm-nach"]').fill('Neumann');
  await page.locator('[data-role="nm-vor"]').fill('Nora');
  await page.locator('[data-action="nm-wahl"][data-feld="u18"][data-value="nein"]').click();
  await page.locator('[data-action="nm-wahl"][data-feld="g"][data-value="w"]').click();
  await page.locator('[data-action="nm-weiter"]').click();
  check('danach unterschreibt die nachgemeldete Person', (await text('#overlay-card h3')).includes('Nora Neumann'));
  await malen();
  await page.locator('[data-action="signatur-weiter"]').click();
  check('die Nachmeldung steht mit Unterschrift auf Seite 2', await page.evaluate(() => {
    const t = document.querySelector('#bericht-blatt .b-nach').textContent;
    return t.includes('Neumann') && t.includes('Nora') && !!document.querySelector('#bericht-blatt .b-nach td img');
  }));
  check('und "Nachmeldungen: ja" ist angekreuzt', (await text('#bericht-blatt td[data-feld="nachmeldungen"]')).replace(/\s+/g, ' ').includes('ja X'));
  check('und sie gehoert jetzt zum Team', await page.evaluate(() => {
    const D = window.__dart, S = D.state(), lg = S.tour.liga;
    const liste = lg.heim ? lg.heimSpieler : lg.gastSpieler;
    return liste.some((id) => (D.profile(id) || {}).voll === 'Nora Neumann');
  }));
  await page.locator('#overlay-card [data-action="ov-hinweis-zu"]').click();
  const pdf = await page.evaluate(async () => {
    const b = window.__dart.berichtPdf();
    const t = new TextDecoder('latin1').decode(new Uint8Array(await b.arrayBuffer()));
    return { start: t.slice(0, 5), seiten: (t.match(/\/Type \/Page\b/g) || []).length, groesse: b.size, ende: t.trim().endsWith('%%EOF') };
  });
  check('das PDF hat beide Seiten des Bogens', pdf.start === '%PDF-' && pdf.seiten === 2 && pdf.ende && pdf.groesse > 20000, JSON.stringify(pdf));
  /* Die Test-Nachmeldung wieder wegraeumen - spaetere Pruefungen erwarten
     einen Stand ohne Gaeste. */
  await page.evaluate(() => {
    const D = window.__dart, S = D.state(), lg = S.tour.liga;
    S.matches.forEach((m) => { if (m.void === 'test') delete m.void; });
    delete lg.unterschriften; delete lg.berichtKorrekturen; delete lg.berichtFelderKf; delete lg.berichtKreuze;
    const nora = S.profiles.filter((p) => p.voll === 'Nora Neumann').map((p) => p.id);
    ['heimSpieler', 'gastSpieler', 'wir', 'sie'].forEach((k) => { lg[k] = lg[k].filter((id) => nora.indexOf(id) < 0); });
    S.tour.players = S.tour.players.filter((id) => nora.indexOf(id) < 0);
    S.profiles = S.profiles.filter((p) => nora.indexOf(p.id) < 0);
    delete lg.nachmeldungen;
    D.save();
  });
}
await page.locator('[data-action="bericht-zurueck"]').click();
check('zurueck im Ligaspiel', await visible('#screen-tournament'));

/* Vorzeitig beenden: das gespielte Einzel wandert als Ligaspiel ins Archiv. */
await page.locator('[data-action="reset"]').click();
await page.locator('[data-action="ov-reset"]').click();
check('das Ligaspiel liegt im Archiv', await page.evaluate(() =>
  window.__dart.state().history.filter((h) => h.liga).length === 1));

group('Liga-Rangliste: Classic-Werte nur aus Ligaspielen');
await ligaStatistik();
check('der Liga-Reiter steht in der Rangliste', (await text('#boards-sub')).includes('Spieltag'));
check('mit den Classic-Kategorien, aber ohne Turniersiege', await page.evaluate(() => {
  const t = document.getElementById('board-chips').innerText;
  return t.includes('Siege') && t.includes('Average') && !t.includes('Turniersiege');
}));
check('Lenas fuehrt mit ihrem Liga-Sieg',
  (await page.locator('#board-list .board-row').first().innerText()).includes('Lenas'));
check('das Ligaspiel steht im Spieltag-Log', await page.evaluate(() => {
  const t = document.getElementById('match-log').innerText;
  /* Zwei gewertete Einzel: das gespielte und das kampflose. */
  return t.includes('2:0') && t.includes('TSV Dachau');
}));
check('die Rekorde kommen aus dem Ligaspiel', (await text('#records')).includes('141'));

check('Team-Auswahl: unsere Mannschaft, Gesamte Liga und der Gegner', await page.evaluate(() => {
  const t = [...document.querySelectorAll('.liga-team-wahl [data-action="liga-team"]')].map((b) => b.textContent);
  return t[0] === 'Blink 180' && t[1] === 'Gesamte Liga' && t.some((x) => x.includes('TSV Dachau'));
}));
await page.locator('.liga-team-wahl [data-team="alle"]').click();
check('Gesamte Liga: Gegner stehen mit ihrem Team in der Rangliste (auch ausgeblendete Gaeste)', await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const h = S.history.find((x) => x.liga && !x.liga.uebung);
  const gegnerNamen = h.liga.sie.map((id) => { const p = S.profiles.find((x) => x.id === id); return p && (p.voll || p.name); }).filter(Boolean);
  const rows = [...document.querySelectorAll('#board-list .board-row')].map((r) => r.innerText);
  return gegnerNamen.length > 0 && rows.some((r) => gegnerNamen.some((n) => r.includes(n)) && r.includes('TSV Dachau'));
}));
check('der Verlauf (unsere Spieler) ist dabei ausgeblendet', await page.evaluate(() => document.getElementById('board-chart').classList.contains('hidden')));
await page.locator('.liga-team-wahl [data-team="TSV Dachau 1865 4"]').click().catch(() => {});
check('nur der Gegner: keine eigenen Spieler in der Liste', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#board-list .board-row')];
  return rows.length > 0 && rows.every((r) => !r.getAttribute('data-action'));
}));
await page.locator('.liga-team-wahl [data-team="wir"]').click();

group('Gaeste: temporaer, dauerhaft, Gast-Konto');
{
  const r = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const echt = window.DartKonto;
    window.DartKonto = new Proxy({ nutzer: () => ({ id: 'u_ich' }) }, { get: (t, k) => (k in t ? t[k] : () => null) });
    D.setScreen('setup');
    D.action('new-profile');
    const t = document.getElementById('overlay-card').innerText;
    const wahl = document.querySelectorAll('[data-action="gast-art"]').length === 2 && t.includes('Temporär') && t.includes('Dauerhaft');
    D.ui().overlay.draft.name = 'Dauergast';
    D.ui().overlay.draft.dauer = true;
    D.action('save-profile');
    D.action('new-profile');
    D.ui().overlay.draft.name = 'Kurzgast';
    D.action('save-profile');
    window.DartKonto = echt;
    const dg = S.profiles.find((p) => p.name === 'Dauergast'), kg = S.profiles.find((p) => p.name === 'Kurzgast');
    // 13 Stunden spaeter
    dg.created = kg.created = Date.now() - 13 * 3600e3;
    D.gaesteAufraeumen();
    /* Dauerhaft -> temporaer: die 12 Stunden laufen ab jetzt. */
    D.ui().overlay = { type: 'profile', id: dg.id, draft: { name: dg.name, avatar: null, dbl: null, dauer: false } };
    D.action('save-profile');
    D.gaesteAufraeumen();
    const nochDa = S.profiles.some((p) => p.id === dg.id && !p.hidden);
    dg.dauer = true;
    return { nochDa, wahl, dauer: !!(dg && dg.gast && dg.dauer), dgDa: S.profiles.some((p) => p.name === 'Dauergast' && !p.hidden), kgWeg: !S.profiles.some((p) => p.name === 'Kurzgast') };
  });
  check('angemeldet fragt der Dialog: temporaer oder dauerhaft', r.wahl);
  check('der dauerhafte Gast wird so gespeichert', r.dauer);
  check('nach 12 Stunden bleibt der dauerhafte Gast', r.dgDa);
  check('der temporaere Gast (ohne Spiel) ist weg', r.kgWeg);
  check('wieder auf temporaer gestellt: bleibt noch 12 Stunden', r.nochDa);
}
{
  const r = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.profiles.push({ id: 'u_gastkonto', name: 'Besuchskonto', avatar: null, hue: 30, created: Date.now(), gastKonto: true });
    const echt = window.DartKonto;
    window.DartKonto = new Proxy({ nutzer: () => ({ id: 'u_gastkonto', gastKonto: true }) }, { get: (t, k) => (k in t ? t[k] : () => null) });
    D.setScreen('liga'); D.ui().ligaTab = 'plan'; D.render();
    const plan = document.getElementById('liga-plan').innerHTML;
    const keinStart = !plan.includes('data-action="liga-spiel"') && plan.includes('Live-Ticker');
    window.DartKonto = echt; D.render();
    return { keinStart };
  });
  check('ein Gast-Konto sieht keinen "Ligaspiel starten"-Knopf, sondern den Hinweis auf den Live-Ticker', r.keinStart);
  const imKader = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const alt = { game: S.game, matches: S.matches, tour: S.tour, current: S.current };
    S.game = null; S.matches = []; S.tour = null; S.current = null;
    D.setScreen('liga'); D.ui().ligaTab = 'plan'; D.render();
    const knopf = document.querySelector('#liga-plan [data-action="liga-spiel"]');
    D.action('liga-spiel', knopf);
    const o = D.ui().overlay;
    const html = document.getElementById('overlay-card').innerHTML;
    D.ui().overlay = null;
    Object.assign(S, alt); D.render();
    return !!o && o.type === 'liga-start' && !html.includes('Besuchskonto') && html.includes('Lenas');
  });
  check('in der Ligaspiel-Aufstellung steht kein Gast-Konto zur Wahl', imKader);
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.profiles = S.profiles.filter((p) => p.name !== 'Dauergast' && p.name !== 'Besuchskonto');
    S.lineup = S.lineup.filter((id) => S.profiles.some((p) => p.id === id));
    D.save(); D.setScreen('setup');
  });
}

group('Archiv-Nachtrag vom Server: Einzel und Besetzung (nachgetragener Wechsel)');
{
  const r = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const h = S.history.find((x) => x.liga && !x.liga.uebung);
    const alt = JSON.parse(JSON.stringify(h));
    const m = h.matches.find((x) => x.done && !x.kampflos);
    const ersatz = { id: 'u_ersatz', name: 'Ersatz', avatar: null, hue: 50, created: Date.now() };
    S.profiles.push(ersatz);
    const raus = m.p.find((id) => h.liga.wir.indexOf(id) >= 0);
    const payload = JSON.parse(JSON.stringify(h));
    const tausch = (id) => (id === raus ? ersatz.id : id);
    const pm = payload.matches.find((x) => x.id === m.id);
    pm.p = pm.p.map(tausch); pm.starter = tausch(pm.starter); pm.winner = tausch(pm.winner);
    pm.legs.forEach((l) => { l.starter = tausch(l.starter); l.winner = tausch(l.winner); l.visits.forEach((v) => { v.p = tausch(v.p); }); });
    payload.liga.wir = payload.liga.wir.concat([ersatz.id]);
    payload.liga.heimSpieler = (payload.liga.heimSpieler || payload.liga.wir).concat([ersatz.id]);
    payload.liga.berichtFelderKf = { kaputt: 'vom Server' };
    payload.stand = (h.stand || 0) + 1;
    h.liga.berichtFelderKf = { lokal: 'bleibt' };
    D.uebernehmeSpiele([{ id: h.id, payload }]);
    const neu = S.history.find((x) => x.id === h.id);
    const nm = neu.matches.find((x) => x.id === m.id);
    const ok = nm.p.indexOf(ersatz.id) >= 0 && nm.p.indexOf(raus) < 0 && neu.liga.wir.indexOf(ersatz.id) >= 0 &&
      neu.liga.berichtFelderKf.lokal === 'bleibt' && !neu.liga.berichtFelderKf.kaputt;
    S.history[S.history.indexOf(neu)] = alt;
    S.profiles = S.profiles.filter((p) => p.id !== 'u_ersatz'); D.save();
    return ok;
  });
  check('das Einzel haengt am eingewechselten Spieler, Bericht-Korrekturen bleiben lokal', r);
}

group('Rangliste nur mit Stammspielern, Aufstellung nach Nutzung');
await page.evaluate(() => { window.__dart.ui().boardMode = '501'; window.__dart.setScreen('boards'); });
check('kein Gast steht in der Rangliste', await page.evaluate(() => {
  const S = window.__dart.state();
  const gaeste = S.profiles.filter((p) => p.gast).map((p) => p.name);
  const t = document.getElementById('board-list').innerText;
  return gaeste.every((n) => !t.includes(n));
}));
await page.evaluate(() => window.__dart.setScreen('setup'));
check('die Aufstellung sortiert Vielspieler nach oben und Gaeste ans Ende',
  await page.evaluate(() => {
    const S = window.__dart.state();
    const reihen = [...document.querySelectorAll('#roster .roster-item')];
    const gastAb = reihen.findIndex((r) => r.querySelector('.gast-marke'));
    // Nach dem Gast-Marker darf kein Stammspieler mehr kommen.
    return gastAb === -1 || reihen.slice(gastAb).every((r) => r.querySelector('.gast-marke'));
  }));
/* Neuer Gast: schlanker Dialog ohne Liga-Namen, Lieblingsdoppel bleibt. */
await page.locator('#screen-setup [data-action="new-profile"]').click();
check('der Gast-Dialog fragt keine Liga-Namen ab',
  (await page.locator('[data-role="profile-vor"]').count()) === 0 &&
  (await page.locator('[data-role="profile-name"]').count()) === 1);
check('das Lieblingsdoppel wird weiter abgefragt',
  (await page.locator('[data-role="profile-double"]').count()) === 1);
await page.locator('[data-action="ov-cancel"]').click();

group('Neuer Spieler: kein leerer, doppelter Name nur mit Bestaetigung');
{
  const anzahl = await page.evaluate(() => window.__dart.state().profiles.length);
  await page.locator('#screen-setup [data-action="new-profile"]').click();
  await page.locator('[data-role="profile-name"]').fill('   ');
  await page.locator('[data-action="save-profile"]').click();
  check('leerer Name wird nicht gespeichert, der Dialog sagt warum',
    (await text('#overlay-card')).includes('Bitte einen Namen eingeben') &&
    (await page.evaluate(() => window.__dart.state().profiles.length)) === anzahl);
  const vorhanden = await page.evaluate(() => window.__dart.activeProfiles()[0].name);
  await page.locator('[data-role="profile-name"]').fill(vorhanden);
  await page.locator('[data-action="save-profile"]').click();
  check('doppelter Name: erst ein Hinweis', (await text('#overlay-card')).includes('gibt es schon') &&
    (await page.evaluate(() => window.__dart.state().profiles.length)) === anzahl);
  await page.locator('[data-action="save-profile"]').click();
  check('beim zweiten Speichern gilt es', (await page.evaluate(() => window.__dart.state().profiles.length)) === anzahl + 1);
  /* Den eben angelegten Doppelgaenger gleich wieder loswerden. */
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const neu = S.profiles[S.profiles.length - 1];
    S.profiles = S.profiles.filter((x) => x.id !== neu.id);
    S.lineup = S.lineup.filter((x) => x !== neu.id);
    D.save(); D.setScreen('setup');
  });
}

group('Wer gerade spielt, laesst sich nicht loeschen');
{
  const erg = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.profiles.push({ id: 'offline_neu', name: 'Neuling', avatar: null, hue: 4, created: Date.now() });
    S.game = { id: 'lauf1', kind: 'cricket', players: ['offline_neu', D.activeProfiles()[0].id], throws: [], scoring: true, done: false, winner: null, started: true, at: null };
    D.save();
    D.ui().overlay = { type: 'profile', id: 'offline_neu', draft: { name: 'Neuling', avatar: null, dbl: null, vor: '', nach: '' } };
    D.render();
    const knopf = document.querySelector('#overlay-card [data-action="delete-profile"]');
    S.game = null;
    S.profiles = S.profiles.filter((p) => p.id !== 'offline_neu');
    D.ui().overlay = null; D.save(); D.setScreen('setup');
    return !!knopf;
  });
  check('kein Loeschen-Knopf fuer einen Spieler im laufenden Spiel', erg === false);
}

group('Gast direkt loeschen');
await page.evaluate(() => window.__dart.setScreen('players'));
check('der Dachauer Gast steht in der Spielerliste', (await text('#players-list')).includes('Dachau 1'));
await page.locator('#players-list .player-card:has-text("Dachau 1")').click();
await page.locator('[data-action="edit-current-profile"]').click();
check('der Dialog bietet direktes Loeschen an',
  (await page.locator('[data-action="delete-guest"]').count()) === 1);
await page.locator('[data-action="delete-guest"]').click();
check('Loeschen fragt einmal nach', (await text('#overlay-card')).includes('Ja, Gast löschen'));
await page.locator('[data-action="delete-guest"]').click();
check('der Gast ist sofort aus der Spielerliste verschwunden',
  !(await text('#players-list')).includes('Dachau 1'));
check('seine Einzel bleiben in der Historie erhalten', await page.evaluate(() => {
  const h = window.__dart.state().history.find((x) => x.liga);
  return !!h && h.matches.some((m) => m.done);
}));
await navTo('boards');
check('aus der Rangliste ist er ebenfalls raus', !(await text('#board-list')).includes('Dachau 1'));

/* Aufraeumen fuer die folgenden Gruppen – Liga-Archiv und Dachauer Gaeste
   verschwinden wieder, der Rest der Suite rechnet ohne sie. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.history = S.history.filter((h) => !h.liga);
  S.profiles = S.profiles.filter((p) => !(p.gast && p.name.indexOf('Dachau') === 0));
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.ui().boardMode = '501';
  D.setScreen('setup');
});

group('Ausbullen per Tastatur OHNE Turnier-Modus: der Bull-Sieger beginnt');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 2).map((p) => p.id);
  S.mode = '501'; S.settings.start = 501; S.settings.bestOf = 3;
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await page.evaluate(() => { window.__dart.ui().turnier = false; window.__dart.render(); });
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.keyboard.press('Numpad6');
await page.keyboard.press('NumpadEnter');
check('Spieler 2 gewinnt das Bullen und ist dran - ohne geschenkte 0-Aufnahme', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), l = D.activeLeg(m);
  return D.state().screen === 'game' && m.starter === m.p[1] && l.visits.length === 0 &&
    D.state().matches[0].legs[0].starter === m.p[1];
}));

group('Turnier-Menue: naechstes Einzel per Tastatur waehlen und starten');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 3).map((p) => p.id);
  S.mode = '501'; S.settings.start = 501; S.settings.bestOf = 1;
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
check('ohne Tastendruck ist im Spielplan nichts markiert', await page.evaluate(() => !document.querySelector('#schedule .match-row.wahl')));
await page.keyboard.press('Numpad2');
const planWahl = () => page.evaluate(() => {
  const z = document.querySelector('#schedule .match-row.wahl');
  return z ? [...document.querySelectorAll('#schedule .match-row')].indexOf(z) : -1;
});
check('erster Druck markiert das naechste offene Einzel', (await planWahl()) === 0);
await page.keyboard.press('Numpad2');
check('2 geht ein Einzel weiter runter', (await planWahl()) === 1);
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
check('am Ende bleibt die Wahl stehen', (await planWahl()) === 2);
await page.keyboard.press('Numpad8');
check('8 geht wieder hoch', (await planWahl()) === 1);
await page.keyboard.press('NumpadEnter');
check('Enter startet das gewaehlte Einzel (Ausbullen)', await page.evaluate(() => {
  const S = window.__dart.state(); return S.screen === 'bulloff' && S.current === S.matches[1].id;
}));
await page.locator('#screen-bulloff > [data-action="to-tournament"]').click();
check('zurueck im Spielplan', await page.evaluate(() => window.__dart.state().screen === 'tournament'));

group('Ausbullen und Checkout am Board per Tastatur');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 2).map((p) => p.id);
  S.mode = '501'; S.settings.start = 501; S.settings.bestOf = 1;
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await page.evaluate(() => { window.__dart.ui().turnier = true; window.__dart.render && window.__dart.render(); });
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
check('das Ausbullen traegt den Board-Zuschnitt', await page.evaluate(() =>
  document.getElementById('screen-bulloff').classList.contains('turnier')));
check('ohne Tastendruck ist niemand markiert (Touch-Betrieb)', await page.evaluate(() =>
  !document.querySelector('#screen-bulloff .wahl')));
check('die Wahl ist auch ohne Turnier-Modus SICHTBAR markiert (Rahmen)', await page.evaluate(() => {
  const D = window.__dart; D.ui().turnier = false; D.ui().bullTastatur = true; D.render();
  const el = document.querySelector('#bulloff-buttons button.wahl');
  const st = el && getComputedStyle(el);
  const ok = !!st && st.outlineStyle === 'solid' && parseFloat(st.outlineWidth) >= 2;
  D.ui().turnier = true; D.render();
  return ok;
}));
await page.locator('#bulloff-sub').click();
check('Antippen neben die Knoepfe nimmt die Markierung wieder weg', await page.evaluate(() =>
  !document.querySelector('#screen-bulloff .wahl')));
await page.keyboard.press('ArrowRight');
check('Pfeil rechts wechselt den Kandidaten', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[1].classList.contains('wahl')));
/* Ziffernblock als Pfeile (Belegung am Board): 4 = links, 6 = rechts. */
await page.keyboard.press('Numpad4');
check('Ziffernblock 4 wirkt wie Pfeil links', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[0].classList.contains('wahl')));
await page.keyboard.press('Numpad6');
check('Ziffernblock 6 wirkt wie Pfeil rechts', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[1].classList.contains('wahl')));
await page.keyboard.press('ArrowDown');
check('Pfeil runter markiert "Zurück" unter den Namen', await page.evaluate(() =>
  document.querySelector('#screen-bulloff > [data-action="to-tournament"]').classList.contains('wahl')));
await page.keyboard.press('ArrowUp');
check('Pfeil hoch fuehrt wieder zum Namen', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[1].classList.contains('wahl') &&
  !document.querySelector('#screen-bulloff > [data-action="to-tournament"]').classList.contains('wahl')));
/* Satechi-Ziffernblock: 8 = hoch, 2 = runter, "/" = Tab. */
await page.keyboard.press('Numpad2');
check('Ziffernblock 2 fuehrt runter auf "Zurück"', await page.evaluate(() =>
  document.querySelector('#screen-bulloff > [data-action="to-tournament"]').classList.contains('wahl')));
await page.keyboard.press('Numpad8');
check('Ziffernblock 8 fuehrt wieder hoch zum Namen', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[1].classList.contains('wahl')));
await page.keyboard.press('NumpadDivide');
await page.keyboard.press('NumpadDivide');
await page.keyboard.press('NumpadDivide');
check('"/" springt wie Tab weiter (3x: Zurueck, erster, zweiter Name)', await page.evaluate(() =>
  document.querySelectorAll('#bulloff-buttons button')[1].classList.contains('wahl')));
await page.keyboard.press('Enter');
check('Enter setzt den Anwerfer und startet in der Riesenanzeige',
  (await visible('#pad-key')) && await page.evaluate(() => {
    const m = window.__dart.currentMatch();
    return m.starter === m.p[1];
  }));
/* Beim Tippen wackelt nichts: Eingabefeld und Karten behalten ihre Hoehe. */
{
  const masse = () => page.evaluate(() => ['#key-display', '#screen-game .pcard', '#screen-game .input-area']
    .map((s) => Math.round(document.querySelector(s).getBoundingClientRect().height)).join(','));
  const vorher = await masse();
  await page.keyboard.type('41');
  check('die erste Ziffer aendert keine Hoehe (Eingabefeld, Karten)', (await masse()) === vorher, vorher + ' -> ' + (await masse()));
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
}
/* "clear" bucht den REST: 501 Rest, "321" + clear = 180 geworfen. */
await page.keyboard.type('321'); await page.keyboard.press('NumLock');
check('"clear" bucht das Getippte als Rest (321 Rest = 180 geworfen)', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch(), l = D.activeLeg(m);
  return l.visits.length === 1 && l.visits[0].s === 180;
}));
await page.keyboard.press('Backspace');   // leeres Feld: Aufnahme zurueck
check('und laesst sich wie jede Aufnahme zuruecknehmen', await page.evaluate(() =>
  window.__dart.activeLeg(window.__dart.currentMatch()).visits.length === 0));
await page.keyboard.type('45'); await page.keyboard.press('NumpadSubtract');
check('"-" bucht ueberworfen: zaehlt nicht, Rest bleibt, Getipptes verfaellt', await page.evaluate(() => {
  const D = window.__dart, l = D.activeLeg(D.currentMatch());
  return l.visits.length === 1 && l.visits[0].b === true && l.visits[0].s === 0 && D.ui().input === '';
}));
await page.keyboard.press('Backspace');
check('und laesst sich zuruecknehmen', await page.evaluate(() =>
  window.__dart.activeLeg(window.__dart.currentMatch()).visits.length === 0));
await page.keyboard.press('NumpadMultiply');
check('"*" ausserhalb der Liga tut nichts', await page.evaluate(() => !window.__dart.ui().overlay));
await page.keyboard.down('NumpadAdd');
check('"+" gedrueckt halten zeigt die Liste aller Wuerfe', await page.evaluate(() => document.getElementById('screen-game').classList.contains('verlauf')));
await page.keyboard.up('NumpadAdd');
check('Loslassen fuehrt zurueck', await page.evaluate(() => !document.getElementById('screen-game').classList.contains('verlauf')));
/* Auf Rest 40 spielen, dann die Dart-Frage mit Pfeilen beantworten. */
{
  const tp = async (z) => { await page.keyboard.type(z); await page.keyboard.press('Enter'); };
  await tp('180'); await tp('60'); await tp('180'); await tp('60'); await tp('101'); await tp('60');
  await tp('40');
}
check('die Dart-Frage markiert die erste Antwort', await page.evaluate(() => {
  const o = window.__dart.ui().overlay;
  return o && o.type === 'checkout-darts' &&
    document.querySelector('#overlay-card .btn.wahl').textContent.trim() === '1';
}));
await page.keyboard.press('ArrowRight');
check('Pfeil rechts waehlt 2 Darts', await page.evaluate(() =>
  document.querySelector('#overlay-card .btn.wahl').textContent.trim() === '2'));
await page.keyboard.press('Enter');
check('Enter bucht den Checkout mit 2 Darts', await page.evaluate(() => {
  const m = window.__dart.currentMatch();
  const co = m.legs[0].visits.filter((x) => x.c)[0];
  return m.done && co && co.d === 2;
}));
check('danach uebernimmt die grosse Endsequenz', await page.evaluate(() => {
  const o = window.__dart.ui().overlay;
  return o && o.type === 'turnier-ende' && o.phase === 'stat';
}));
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
check('ohne offene Spiele fuehrt Enter zum Endstand', await visible('#screen-winner'));
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.matches = []; S.tour = null; S.current = null; S.game = null;
  S.settings.turnierModus = 0; D.ui().turnier = false;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.setScreen('setup');
});

group('spielDart bucht in jedem Modus');
/* Die zentrale Weiche fuer alle Dart-Quellen (Board-Tasten, Tastatur,
   kuenftig Kamera): je Bildschirm die passende Buchung, die Rueckgabe sagt,
   ob gebucht wurde. */
check('auf dem Setup-Bildschirm wird nichts gebucht',
  (await page.evaluate(() => window.__dart.spielDart(3, 20))) === false);
/* X01 */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 2).map((p) => p.id);
  S.mode = '501'; S.settings.start = 501; S.settings.bestOf = 1;
  D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await page.locator('#schedule .match-row .go:not(.wo)').first().click();
await page.locator('#bulloff-buttons [data-action="pick-starter"]').first().click();
await page.waitForTimeout(200);   // Schonfrist nach dem Start verstreichen lassen
check('spielDart bucht die T20 im X01', await page.evaluate(() =>
  window.__dart.spielDart(3, 20) === true &&
  window.__dart.ui().darts.length === 1 && window.__dart.ui().darts[0].v === 60));
check('Triple aufs Bull heisst grosses Bull (50)', await page.evaluate(() =>
  window.__dart.spielDart(3, 25) === true && window.__dart.ui().darts[1].v === 50));
/* Cricket */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await page.waitForTimeout(200);
check('spielDart bucht im Cricket', await page.evaluate(() =>
  window.__dart.spielDart(3, 20) === true &&
  window.__dart.game().throws.length === 1 && window.__dart.game().throws[0].m === 3));
/* Round the World */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="rtw"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await page.waitForTimeout(200);
check('spielDart bucht im Round the World', await page.evaluate(() =>
  window.__dart.spielDart(1, 1) === true && window.__dart.game().throws.length === 1));
/* Finisher */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="finisher"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await page.waitForTimeout(200);
check('spielDart bucht im Finisher', await page.evaluate(() =>
  window.__dart.spielDart(1, 0) === true &&
  window.__dart.finisherRunde().throws.length === 1));
/* Aufraeumen: die folgenden Gruppen rechnen mit vier Spielern im 501. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.mode = '501';
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.setScreen('setup');
});

group('Spiel-Reiter findet zurueck ins Schnelle Spiel');
/* Der Nav-Handler sprang frueher auf S.game.kind - beim Schnellen Spiel
   heisst der aber 'quick', diesen Bildschirm gibt es nicht, und die Seite
   blieb schwarz (gespeichert sogar ueber den Neustart hinweg). */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null; S.current = null;
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 2).map((p) => p.id);
  D.setScreen('setup');
});
await page.locator('[data-action="set-mode"][data-value="quick"]').click();
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('das Schnelle Spiel laeuft', await visible('#screen-game'));
await page.evaluate(() => window.__dart.setScreen('players'));
await page.locator('#players-list .player-card').first().click();
check('das Profil ist offen', await visible('#screen-profile'));
await navTo('setup');
check('der Spiel-Reiter fuehrt zurueck aufs Board', await visible('#screen-game'));
check('und kein Bildschirm bleibt schwarz', await page.evaluate(() =>
  !!document.querySelector('.screen.active')));
/* Selbstheilung: ein kaputt gespeicherter Bildschirmname darf die App nach
   dem Neustart nicht schwarz lassen. */
await page.evaluate(() => {
  window.__dart.state().screen = 'kaputt';
  window.__dart.save();
});
await page.reload();
check('nach Neustart mit kaputtem Bildschirm laeuft das Spiel weiter',
  await visible('#screen-game'),
  await page.evaluate(() => window.__dart.state().screen));
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.mode = '501';
  S.lineup = D.activeProfiles().filter((p) => !p.gast).slice(0, 4).map((p) => p.id);
  D.setScreen('setup');
});

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

/* ---------- Testspieler zaehlen nirgends ---------- */
group('Testspieler: Spiele mit ihnen bleiben aus der Statistik');
{
  /* Ein Spieler mit gespielten Partien wird zum Testkonto erklaert (das Flag
     setzt sonst der Server im Roster): seine Spiele fallen aus Karriere,
     Rangliste und Spieleliste, die der anderen bleiben. */
  const vorher = await page.evaluate(() => {
    const D = window.__dart, c = D.career();
    const id = Object.keys(c).find((k) => c[k].matches > 0);
    const spiele = D.allMatches().length;
    return { id, matches: c[id].matches, spiele, rang: D.ranking('won').map((r) => r.id) };
  });
  const nachher = await page.evaluate((id) => {
    const D = window.__dart, S = D.state();
    S.profiles.find((p) => p.id === id).test = true;
    const c = D.career();
    const out = { matches: c[id].matches, spiele: D.allMatches().length, rang: D.ranking('won').map((r) => r.id),
      andere: Object.keys(c).filter((k) => k !== id && c[k].matches > 0).length };
    S.profiles.find((p) => p.id === id).test = false;
    return out;
  }, vorher.id);
  check('vorher hatte der Spieler Partien', vorher.matches > 0);
  check('als Testspieler zaehlt keine einzige mehr', nachher.matches === 0, String(nachher.matches));
  check('die Spieleliste verliert genau seine Spiele', nachher.spiele < vorher.spiele);
  check('er steht nicht mehr in der Rangliste', nachher.rang.indexOf(vorher.id) < 0 && vorher.rang.indexOf(vorher.id) >= 0);
  check('das Flag zurueck: alles wie vorher', (await page.evaluate((id) => window.__dart.career()[id].matches, vorher.id)) === vorher.matches);
}

/* ---------- Eingabe: OK immer, Zurueck bis zum Wurf davor, Kachel als Taste ---------- */
group('Eingabe: nichts wird automatisch uebernommen');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  S.mode = 'quick';
  S.settings.start = 501; S.settings.dartModeFrom = 170;
  S.settings.quickSaetze = 1; S.settings.quickLegs = 1;
  D.save(); D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
check('Menue, Fernsteuerung und Wechsel stehen oben im Kopf',
  (await visible('#screen-game .game-header #game-menu')) && (await visible('#screen-game .game-header #game-swap')));
check('die Seite ist im Spiel fest (body ohne Scrollen)',
  await page.evaluate(() => document.body.classList.contains('fix-spiel') && getComputedStyle(document.body).overflow === 'hidden'));
for (const c of ['1', '8', '0']) await page.locator(`.keypad button[data-key="${c}"]`).click();
check('drei Ziffern werden nicht von selbst gebucht', (await rest(0)) === '501' && (await text('#score-display')) === '180');
await page.locator('.keypad button[data-key="ok"]').click();
check('erst OK bucht die 180', (await rest(0)) === '321');
await typeScore(60);
check('Spieler 2 hat 441', (await rest(1)) === '441');
await page.locator('.keypad button[data-key="del"]').click();
check('Zurueck bei leerem Feld nimmt die letzte Aufnahme zurueck', (await rest(1)) === '501');
check('die zurueckgenommene 60 steht wieder im Feld', (await text('#score-display')) === '60');
await page.locator('.keypad button[data-key="del"]').click();
check('weiteres Zurueck loescht Ziffer fuer Ziffer', (await text('#score-display')) === '6' && (await rest(1)) === '501');
await page.locator('.keypad button[data-key="del"]').click();
check('Feld leer, Stand unveraendert', (await text('#score-display')) === '0' && (await rest(1)) === '501');
check('und Spieler 2 ist wieder am Wurf', await page.evaluate(() => {
  const D = window.__dart, m = D.currentMatch();
  return D.activePlayer(D.activeLeg(m), m) === m.p[1];
}));
await typeScore(60);                                  // Spieler 2: 441
await typeScore(180);                                 // Spieler 1: 141 -> Finish-Bereich
await typeScore(60);                                  // Spieler 2: 381
check('Spieler 1 steht bei 141 im Einzel-Dart-Modus', (await rest(0)) === '141' && await visible('#pad-darts'));
check('Double/Triple stehen im Zahlenfeld, so hoch wie eine Zahlentaste', await page.evaluate(() => {
  const b = document.querySelector('#num-grid button.mult'), n = document.querySelector('#num-grid button[data-num="5"]');
  return Math.abs(b.getBoundingClientRect().height - n.getBoundingClientRect().height) < 1;
}));
check('Double ist ein Schalter: an, aus - Triple schliesst Double aus', await page.evaluate(() => window.__dart.ui().mult === 1)
  && (await setMult(2), await page.evaluate(() => window.__dart.ui().mult === 2))
  && (await page.locator('#num-grid button.mult[data-mult="2"]').click(), await page.evaluate(() => window.__dart.ui().mult === 1))
  && (await setMult(2), await setMult(3), await page.evaluate(() => window.__dart.ui().mult === 3 &&
      !document.querySelector('#num-grid button.mult[data-mult="2"]').classList.contains('active')))
  && (await setMult(1), true));
const kachel = page.locator('#game-kacheln .fk.tipp').first();
check('die vorgeschlagene Kachel ist eine Taste', (await kachel.count()) === 1 && (await kachel.innerText()).trim() === 'T20');
await kachel.click();
check('Tipp auf die Kachel bucht den Dart', await page.evaluate(() => {
  const d = window.__dart.ui().darts;
  return d.length === 1 && d[0].m === 3 && d[0].n === 20;
}));
check('Rest laeuft mit: 81', (await rest(0)) === '81');
check('Kachel-Taste ist nicht blau, sondern im ruhigen Weiss der Felder', await page.evaluate(() => {
  const b = document.querySelector('#game-kacheln .fk.tipp:not(.jetzt)');
  const probe = document.createElement('span'); probe.style.color = getComputedStyle(document.getElementById('screen-game')).getPropertyValue('--ruhig').trim();
  document.body.appendChild(probe); const ruhig = getComputedStyle(probe).color; probe.remove();
  return getComputedStyle(b).color === ruhig && getComputedStyle(b).fontWeight === '700';
}));
/* 81 mit zwei Darts geht (T19 D12); nach einer T20 bleiben 21 mit einem Dart --
   kein Finish, also steht der Stellwurf da: die 1 laesst 20. Ein Single ohne
   Buchstaben davor -- genau der Fall, der frueher NaN buchte. */
await dart('T20');
check('kein Finish mehr: Stellwurf in der letzten Kachel - mit dem Ziel, auf das er stellt',
  (await page.locator('#game-kacheln .fk.stellen').count()) === 1 &&
  /^1\s+auf 20$/.test((await page.locator('#game-kacheln .fk.stellen').innerText()).trim()),
  await text('#game-kacheln'));
check('Double, Triple und Zurueck heben sich von den Zahlentasten ab', await page.evaluate(() => {
  const z = getComputedStyle(document.querySelector('#num-grid button[data-num="5"]')).backgroundColor;
  const d = getComputedStyle(document.querySelector('#num-grid button.mult[data-mult="2"]')).backgroundColor;
  const r = getComputedStyle(document.querySelector('#num-grid button.zurueck')).backgroundColor;
  return z !== d && d === r;
}));
check('nur der Rest am Wurf leuchtet weiss, Name und Tasten sind ruhiger', await page.evaluate(() => {
  const hell = (sel) => getComputedStyle(document.querySelector(sel)).color.match(/\d+/g).map(Number);
  const rest = hell('.pcard.active .rest'), name = hell('.pcard.active .pname'), taste = hell('#num-grid button[data-num="5"]');
  return rest[0] === 255 && name[0] < 240 && taste[0] < 240;
}));
await page.locator('#game-kacheln .fk.stellen').click();
check('Tipp auf den Stellwurf bucht eine saubere 1 (kein NaN), Aufnahme zu Ende',
  (await rest(0)) === '20' && !(await text('#scoreboard')).includes('NaN'), await rest(0));
check('die letzte Aufnahme steht als 121 am Spieler',
  (await page.locator('.pcard').first().locator('.letzte').innerText()) === '121');
await modus('darts');
await page.locator('#num-grid button.zurueck').click();
check('Zurueck links im Zahlenfeld nimmt die ganze Aufnahme zurueck',
  (await page.evaluate(() => window.__dart.ui().darts.length)) === 0 && (await rest(0)) === '141', await rest(0));
check('unterste Reihe: Zurueck, 0 und OK in einer Zeile, OK doppelt breit', await page.evaluate(() => {
  const z = document.querySelector('#num-grid button.zurueck').getBoundingClientRect();
  const n = document.querySelector('#num-grid button.miss').getBoundingClientRect();
  const w = document.querySelector('#num-grid button.end-visit').getBoundingClientRect();
  return Math.abs(z.top - w.top) < 1 && Math.abs(n.top - w.top) < 1 && w.width > n.width * 1.8;
}));
check('Fehlwurf heisst 0 und ist rot', await page.evaluate(() => {
  const b = document.querySelector('#num-grid button.miss');
  const [r, g] = getComputedStyle(b).color.match(/\d+/g).map(Number);
  return b.textContent.trim() === '0' && r > 200 && g < 120;
}));
check('die drei Kopf-Knoepfe sind gleich hoch', await page.evaluate(() => {
  const h = [...document.querySelectorAll('.game-header .xk-btn:not(.hidden)')].map((b) => b.offsetHeight);   // offsetHeight: ohne die Tipp-Animation (blitzt)
  return h.length === 3 && Math.max(...h) - Math.min(...h) <= 1;
}), await page.evaluate(() => [...document.querySelectorAll('.game-header .xk-btn')].map((b) => b.id + ':' + b.className + ':' + b.getBoundingClientRect().height).join(' ')));
check('OK-Tasten sind hell, nicht rot', await page.evaluate(() => {
  const f = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor.match(/\d+/g).map(Number);
  const [r, g, b] = f('#num-grid button.end-visit');
  return r > 150 && Math.abs(r - g) < 20 && Math.abs(r - b) < 20;
}));
/* Menue (•••): Spiel verlassen oder weiterspielen, Esc und ein Tipp daneben schliessen. */
await page.locator('#game-menu').click();
check('••• oeffnet das Menue mit Spiel und Stand', (await visible('#game-menu-overlay')) &&
  (await textKlein('#game-menu-overlay')).includes('schnelles spiel') && (await textKlein('#game-menu-overlay')).includes('spiel verlassen'));
await page.keyboard.press('Escape');
check('Esc schliesst das Menue', !(await visible('#game-menu-overlay')));
await page.locator('#game-menu').click();
await page.locator('#game-menu-overlay').click({ position: { x: 10, y: 10 } });
check('ein Tipp neben die Karte schliesst es auch', !(await visible('#game-menu-overlay')));
await page.locator('#game-menu').click();
await page.locator('#game-menu-overlay [data-action="to-tournament"]').click();
check('Spiel verlassen fuehrt ins Setup, das Spiel bleibt stehen', (await visible('#screen-setup')) &&
  await page.evaluate(() => !!window.__dart.state().game && !window.__dart.ui().menu));
await page.locator('[data-action="resume"]').click();
check('zurueck im Spiel, Rest unveraendert', (await visible('#screen-game')) && (await rest(0)) === '141');
/* ⇄ mit angefangener Aufnahme: der Hinweis steht sichtbar im Einzel-Dart-Feld. */
await dart('T20');   // 141 -> 81, die Aufnahme laeuft
await page.locator('#game-swap').click();
check('⇄ bei angefangener Aufnahme: sichtbarer Hinweis, das Feld bleibt',
  (await visible('#pad-darts')) && (await text('#darts-error')).includes('angefangene Aufnahme'), await text('#darts-error'));
await page.locator('#num-grid button.zurueck').click();
check('Zurueck nimmt den Dart, der Hinweis ist weg', (await rest(0)) === '141' && (await text('#darts-error')).trim() === '');
/* Ein offenes Menue sperrt die Tastatur - nichts wird dahinter gebucht oder zurueckgenommen. */
await page.locator('#game-menu').click();
const vorMenu = await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length);
await page.keyboard.press('z');
check('z (Ruecknahme) tut hinter dem offenen Menue nichts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === vorMenu && (await visible('#game-menu-overlay')));
await page.keyboard.press('Escape');
await modus('turnier');
await page.locator('#game-menu').click();
check('••• oeffnet das Menue in der Fernsteuerung', await visible('#game-menu-overlay'));
await page.keyboard.type('41'); await page.keyboard.press('Enter');
check('auch die Fernsteuerung bucht hinter dem Menue nichts',
  (await page.evaluate(() => window.__dart.activeLeg(window.__dart.currentMatch()).visits.length)) === vorMenu &&
  (await page.evaluate(() => window.__dart.ui().input === '')));
await page.keyboard.press('Escape');
check('Esc schliesst erst das Menue, die Fernsteuerung bleibt', !(await visible('#game-menu-overlay')) && (await visible('#pad-key')));
/* Online-Spiel am Board: die vom Handy kommenden Darts stehen in den Feldern - ohne Vorschlagsknoepfe. */
await page.evaluate(() => { const D = window.__dart; D.ui().darts = [{ m: 3, n: 20, v: 60 }, { m: 1, n: 20, v: 20 }]; D.render(); });
check('die Fernsteuerung zeigt laufende Einzel-Darts in der Karte',
  (await page.locator('.pcard.active #game-kacheln .fk').count()) === 3 &&
  (await text('.pcard.active #game-kacheln')).includes('T20') &&
  (await page.locator('.pcard.active #game-kacheln .fk.tipp').count()) === 0, await text('.pcard.active #game-kacheln'));
await page.evaluate(() => { window.__dart.ui().darts = []; window.__dart.render(); });
await page.keyboard.press('Escape');
check('das zweite Esc beendet die Fernsteuerung', !(await visible('#pad-key')));
check('Zahlentasten der Einzel-Darts liegen ganz im Bild', await page.evaluate(() => {
  const r = document.querySelector('#num-grid button:last-child').getBoundingClientRect();
  return r.bottom <= window.innerHeight + 0.5;
}));
await page.evaluate(() => { window.__dart.ui().modeOverride = null; });
await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; D.save(); D.setScreen('setup'); });

/* ---------- Online: einzelne Darts live, Feier auf allen Geraeten ---------- */
group('Online-Spiel: halbfertige Aufnahme geht mit, Feier bei allen');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null;
  S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
  S.mode = 'quick';
  S.settings.start = 501; S.settings.dartModeFrom = 170;
  S.settings.quickSaetze = 1; S.settings.quickLegs = 1;
  D.ui().modeOverride = null;
  D.save(); D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
await bullOffGo();
await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);   // 141 / 381
/* Das Spiel wird nachtraeglich zum Online-Spiel erklaert (angelegt, Hash leer). */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game.online = { sid: S.game.id, seq: 3, hash: '', mit: [], wartet: false };
  D.save();
});
await page.locator('#game-kacheln .fk.tipp').first().click();     // T20 -> 81 offen
check('der einzelne Dart steht im Stand fuer den Server', await page.evaluate(() => {
  const st = window.__dart.liveStand();
  return !!st && Array.isArray(st.state.offen) && st.state.offen.length === 1 && st.state.offen[0].v === 60;
}));
/* Der andere schickt seinen Stand: eine offene 19 statt der D20. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  fremd.offen = [{ m: 1, n: 19, v: 19 }];
  D.liveUebernehmen({ id: S.game.id, seq: 4, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' });
  D.render();
});
check('die offene Aufnahme des anderen ist uebernommen', await page.evaluate(() => {
  const d = window.__dart.ui().darts;
  return d.length === 1 && d[0].n === 19 && !('offen' in window.__dart.state().game);
}));
check('der Rest laeuft live mit: 141 - 19 = 122', (await rest(0)) === '122');
check('nach der Uebernahme ist nichts mehr hochzuladen (gleicher Hash)',
  (await page.evaluate(() => window.__dart.liveStand())) === null);
/* Der andere bucht eine 180: auch hier wird gefeiert. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  const leg = fremd.legs[fremd.legs.length - 1];
  const p = D.activePlayer(D.activeLeg(S.game), S.game);
  leg.visits.push({ p, s: 60, d: 3, b: false, c: false, o: 0 });
  leg.visits.push({ p: fremd.p.find((x) => x !== p), s: 180, d: 3, b: false, c: false, o: 0 });
  D.liveUebernehmen({ id: S.game.id, seq: 5, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' });
  D.render();
});
check('die 180 des anderen wird auch hier gefeiert', (await text('#feier')).includes('180'));

/* Zwei Aufnahmen zwischen zwei Abfragen: die 60 steckt nicht in der
   allerletzten, wird aber trotzdem gefeiert (positionsweiser Vergleich). */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  document.getElementById('feier').innerHTML = '';
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  const leg = fremd.legs[fremd.legs.length - 1];
  const p = D.activePlayer(D.activeLeg(S.game), S.game);
  const q = fremd.p.find((x) => x !== p);
  leg.visits.push({ p, s: 60, d: 3, b: false, c: false, o: 0 });
  leg.visits.push({ p: q, s: 45, d: 3, b: false, c: false, o: 0 });
  D.liveUebernehmen({ id: S.game.id, seq: 6, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' });
  D.render();
});
check('eine 60 vor der letzten Aufnahme wird auch gefeiert', (await text('#feier')).includes('SECHZIG'));

/* Konflikt, bei dem der andere genau dieselbe Aufnahme eingetragen hat:
   kein "bitte nochmal eintragen" (das waere eine Doppelbuchung). */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  D.ui().overlay = null;
  const p = D.activePlayer(D.activeLeg(S.game), S.game);
  S.game.legs[S.game.legs.length - 1].visits.push({ p, s: 26, d: 3, b: false, c: false, o: 0 });
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  D.liveUebernehmen({ id: S.game.id, seq: 7, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' }, true);
  D.render();
});
check('Konflikt mit derselben Aufnahme: kein Nochmal-eintragen-Dialog',
  await page.evaluate(() => !window.__dart.ui().overlay));
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  const p = D.activePlayer(D.activeLeg(S.game), S.game);
  S.game.legs[S.game.legs.length - 1].visits.push({ p, s: 41, d: 3, b: false, c: false, o: 0 });
  fremd.legs[fremd.legs.length - 1].visits.push({ p, s: 85, d: 3, b: false, c: false, o: 0 });
  D.liveUebernehmen({ id: S.game.id, seq: 8, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' }, true);
  D.render();
});
check('Konflikt mit abweichender Aufnahme: Hinweis erscheint',
  await page.evaluate(() => { const o = window.__dart.ui().overlay; return !!o && o.type === 'hinweis'; }));

/* Der eigene Stand kommt per Abfrage zurueck, waehrend hier schon weiter
   getippt wird: die laufende Eingabe bleibt stehen. */
{
  const erg = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    D.ui().overlay = null;
    const echt = window.DartKonto;
    window.DartKonto = Object.assign({}, echt || {}, { nutzer: () => ({ id: 'u_ich' }) });
    const eigen = JSON.parse(JSON.stringify(S.game));
    delete eigen.online;
    D.ui().input = '4';
    const visits = S.game.legs[S.game.legs.length - 1].visits.length;
    D.liveUebernehmen({ id: S.game.id, seq: 9, state: eigen, geaendertVon: 'u_ich', geaendertVonName: 'Ich' });
    const out = { input: D.ui().input, seq: S.game.online.seq, visits: S.game.legs[S.game.legs.length - 1].visits.length === visits };
    window.DartKonto = echt;
    return out;
  });
  check('eigener Stand aus der Abfrage loescht die laufende Eingabe nicht', erg.input === '4' && erg.seq === 9 && erg.visits, JSON.stringify(erg));
}
/* Dasselbe Konto auf einem zweiten Geraet hat eingetragen: der Stand bringt
   etwas mit, das hier fehlt - dann wird er uebernommen (sonst schoeben sich
   zwei Geraete die Aufnahme endlos gegenseitig weg). */
{
  const erg = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const echt = window.DartKonto;
    window.DartKonto = Object.assign({}, echt || {}, { nutzer: () => ({ id: 'u_ich' }) });
    const zweit = JSON.parse(JSON.stringify(S.game));
    delete zweit.online;
    const p = D.activePlayer(D.activeLeg(S.game), S.game);
    zweit.legs[zweit.legs.length - 1].visits.push({ p, s: 100, d: 3, b: false, c: false, o: 0 });
    const vorher = S.game.legs[S.game.legs.length - 1].visits.length;
    D.liveUebernehmen({ id: S.game.id, seq: 9.5, state: zweit, geaendertVon: 'u_ich', geaendertVonName: 'Ich' });
    const nachher = D.state().game.legs[D.state().game.legs.length - 1].visits.length;
    window.DartKonto = echt;
    return { vorher, nachher };
  });
  check('Eintrag vom zweiten eigenen Geraet wird uebernommen', erg.nachher === erg.vorher + 1, JSON.stringify(erg));
}
/* Der andere korrigiert eine fruehere Aufnahme; eine spaetere 60 steht
   schon im Leg - sie wird nicht ein zweites Mal gefeiert. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const leg = S.game.legs[S.game.legs.length - 1];
  const p = D.activePlayer(leg, S.game);
  leg.visits.push({ p, s: 45, d: 3, b: false, c: false, o: 0 });
  leg.visits.push({ p: S.game.p.find((x) => x !== p), s: 60, d: 3, b: false, c: false, o: 0 });
  D.save();
  document.getElementById('feier').innerHTML = '';
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  const fl = fremd.legs[fremd.legs.length - 1];
  fl.visits[fl.visits.length - 2].s = 41;
  D.liveUebernehmen({ id: S.game.id, seq: 9.7, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' });
  D.render();
});
check('eine Korrektur weiter vorn feiert die spaetere 60 nicht nochmal', !(await text('#feier')).includes('SECHZIG'));

/* Spielende beim anderen ersetzt jeden offenen Dialog. */
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  D.ui().input = '';
  D.ui().overlay = { type: 'hinweis', titel: 'x', text: 'y' };
  const fremd = JSON.parse(JSON.stringify(S.game));
  delete fremd.online;
  const leg = fremd.legs[fremd.legs.length - 1];
  leg.winner = fremd.p[0]; fremd.done = true; fremd.winner = fremd.p[0]; fremd.at = Date.now();
  D.liveUebernehmen({ id: S.game.id, seq: 10, state: fremd, geaendertVon: 'u_fremd', geaendertVonName: 'Tobi' });
  D.render();
});
check('Spielende beim anderen zeigt den Glueckwunsch, auch ueber einem Hinweis',
  await page.evaluate(() => { const o = window.__dart.ui().overlay; return !!o && o.type === 'game-done'; }));
await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; D.ui().overlay = null; D.save(); D.setScreen('setup'); });

/* ---------- Jedes Format: Tastenfeld ganz im Bild, nichts scrollt ---------- */
group('Spielbild passt auf jedes Format ohne Scrollen');
{
  const vorher = page.viewportSize();
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id); S.mode = 'quick';
    S.settings.start = 501; S.settings.dartModeFrom = 170; D.ui().modeOverride = null; D.save(); D.setScreen('setup');
  });
  await page.locator('[data-action="start-game"]').click();
  await bullOffGo();
  await typeScore(180); await typeScore(60); await typeScore(180); await typeScore(60);   // 141: Einzel-Darts
  const formate = [[1280, 800], [1024, 600], [800, 1280], [1194, 834], [360, 640], [412, 915], [844, 390]];
  for (const [w, h] of formate) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const lage = await page.evaluate(() => {
      const unten = (sel) => document.querySelector(sel).getBoundingClientRect().bottom;
      return {
        darts: unten('#num-grid button:last-child'),
        seite: document.documentElement.scrollHeight <= window.innerHeight + 1 && document.body.scrollHeight <= window.innerHeight + 1,
        tasteH: document.querySelector('#num-grid button').getBoundingClientRect().height,
        innen: window.innerHeight
      };
    });
    check(w + 'x' + h + ': Einzel-Dart-Tasten ganz im Bild, Seite scrollt nicht',
      lage.darts <= lage.innen + 0.5 && lage.seite && lage.tasteH >= 28,
      JSON.stringify(lage));
    await modus('total');
    const okLage = await page.evaluate(() => ({
      ok: document.querySelector('.keypad button[data-key="ok"]').getBoundingClientRect().bottom, innen: window.innerHeight,
      tasteH: document.querySelector('.keypad button[data-key="5"]').getBoundingClientRect().height
    }));
    check(w + 'x' + h + ': OK-Taste ganz im Bild', okLage.ok <= okLage.innen + 0.5 && okLage.tasteH >= 28, JSON.stringify(okLage));
    await modus('darts');
  }
  await page.setViewportSize(vorher);
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; D.save(); D.setScreen('setup'); });
}

/* ---------- Gaeste raeumen sich auch im laufenden Betrieb weg ---------- */
group('Gaeste: weg nach dem Abend, aber nie mitten im Turnier');
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null;
  const alt = Date.now() - 13 * 3600 * 1000;
  S.profiles.push({ id: 'gast_alt', name: 'Laura', gast: true, avatar: null, hue: 3, created: alt });
  S.lineup = [D.activeProfiles()[0].id, 'gast_alt'];
  D.save(); D.setScreen('boards');
});
await page.evaluate(() => window.__dart.setScreen('setup'));
check('ein Gast von gestern ohne Spiel verschwindet beim Betreten des Setups', await page.evaluate(() => {
  const S = window.__dart.state();
  return !S.profiles.some((p) => p.id === 'gast_alt') && S.lineup.indexOf('gast_alt') < 0;
}));
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  const alt = Date.now() - 13 * 3600 * 1000;
  /* Der Gast kommt frisch an den Abend, das Turnier laeuft dann ueber die Frist hinaus. */
  S.profiles.push({ id: 'gast_turnier', name: 'Laura', gast: true, avatar: null, hue: 3, created: Date.now() });
  S.lineup = [D.activeProfiles()[0].id, D.activeProfiles()[1].id, 'gast_turnier'];
  S.mode = '501';
  D.save(); D.setScreen('setup');
});
await page.locator('[data-action="start-game"]').click();
check('Turnier mit dem Gast laeuft', await page.evaluate(() => window.__dart.state().matches.length > 0));
await page.evaluate(() => {
  const p = window.__dart.state().profiles.find((x) => x.id === 'gast_turnier');
  p.created = Date.now() - 13 * 3600 * 1000;
  window.__dart.save();
});
await page.evaluate(() => window.__dart.setScreen('setup'));
check('im laufenden Turnier bleibt der alte Gast sichtbar', await page.evaluate(() => {
  const p = window.__dart.state().profiles.find((x) => x.id === 'gast_turnier');
  return !!p && !p.hidden;
}));
await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.matches = []; S.tour = null; S.current = null;
  S.profiles = S.profiles.filter((p) => p.id !== 'gast_turnier');
  S.lineup = S.lineup.filter((id) => id !== 'gast_turnier');
  D.save(); D.setScreen('setup');
});

group('Diagramm: jede Linie eine eigene Farbe, auch wenn alle Profile denselben Ton haben');
{
  const farben = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const alt = S.profiles.map((p) => p.hue);
    S.profiles.forEach((p) => { p.hue = 145; });
    const reihen = D.chartSeries('501');
    S.profiles.forEach((p, i) => { p.hue = alt[i]; });
    return reihen.map((r) => r.color);
  });
  check('Linien unterscheiden sich trotz gleicher Profilfarbe', farben.length < 2 || new Set(farben).size === farben.length, JSON.stringify(farben));
}

group('Diagramm-Legende: Durchschnitt der gezeigten Spiele');
await page.evaluate(() => { window.__dart.ui().boardMode = '501'; window.__dart.setScreen('boards'); });
check('unter dem Diagramm steht ein Ø ohne Spielzahl', await page.evaluate(() => {
  const l = document.querySelector('#board-chart .chart-legend');
  return !!l && /Ø\s*\d/.test(l.textContent) && !/Spiel/.test(l.textContent);
}));
check('der Ø ist der Durchschnitt ueber die Spiele, nicht der letzte Wert', await page.evaluate(() => {
  const D = window.__dart;
  const s = D.chartSeries ? D.chartSeries('501') : null;
  if (!s || !s.length) return true;
  const r = s.find((x) => x.points.length >= 2) || s[0];
  const last = r.points[r.points.length - 1];
  const legende = document.querySelector('#board-chart .chart-legend').textContent;
  return legende.indexOf('Ø ' + r.mittel.toFixed(1)) >= 0 && (r.points.length < 2 || Math.abs(r.mittel - last) < 0.05 || legende.indexOf('Ø ' + last.toFixed(1)) < 0 || r.mittel.toFixed(1) === last.toFixed(1));
}));

/* ---------- Turnier-Auswertung und keine Doppelzaehlung ---------- */
group('Turnier: Endstand nachschauen, geteiltes Turnier zaehlt nur einmal');
const tVor = await page.evaluate(() => {
  const D = window.__dart, S = D.state();
  S.game = null; S.matches = []; S.tour = null;
  const ids = D.activeProfiles().slice(0, 3).map((p) => p.id);
  const v = (p, s, c) => ({ p, s, d: 3, b: false, c: !!c, o: 0 });
  const leg = (a, b, sieger) => sieger === a
    ? { starter: a, visits: [v(a, 180), v(b, 60), v(a, 180), v(b, 60), v(a, 141, true)], winner: a, start: 501 }
    : { starter: a, visits: [v(a, 60), v(b, 180), v(a, 60), v(b, 180), v(a, 60), v(b, 141, true)], winner: b, start: 501 };
  const mk = (id, a, b, sieger) => ({ id, round: 1, p: [a, b], starter: a, legs: [leg(a, b, sieger)], done: true, winner: sieger, at: Date.now() - 3600e3 });
  const matches = [mk('tm1', ids[0], ids[1], ids[0]), mk('tm2', ids[1], ids[2], ids[1]), mk('tm3', ids[0], ids[2], ids[0])];
  S.history.unshift({ id: 'turnier_x', at: Date.now() - 3600e3, lineup: ids, settings: { start: 501, bestOf: 1 }, matches, winner: ids[0] });
  D.save();
  const c = D.career();
  return { ids, won: ids.map((id) => c[id].won), avg: ids.map((id) => +c[id].avg.toFixed(2)) };
});
await page.evaluate(() => { window.__dart.ui().boardMode = '501'; window.__dart.setScreen('boards'); });
check('in der Spieleliste steht eine Turnierzeile', (await page.locator('#match-log .turnier-row').count()) >= 1);
await page.locator('#board-log-knopf').click();
await page.locator('#match-log .turnier-row[data-id="turnier_x"]').click();
check('Turnier-Endstand oeffnet sich', await visible('#screen-summary') && (await textKlein('#summary-box')).includes('turnier'));
check('drei Plaetze mit Siegen und Ø', (await page.locator('#summary-box .podium .p').count()) === 3 &&
  (await page.locator('#summary-box .podium .p').first().innerText()).includes('2 Siege'));
check('Ø des Siegers stimmt mit der Karte ueberein', await page.evaluate(() => {
  const p = document.querySelector('#summary-box .podium .p .pv').textContent;
  const karte = document.querySelector('#summary-box .sum-card .pline b').textContent;
  return p.includes('Ø ' + (+karte).toFixed(1));
}));
check('die einzelnen Spiele sind aufgelistet', (await page.locator('#summary-box .pline.tap').count()) === 3);
await page.locator('#summary-box .pline.tap').first().click();
check('ein Spiel daraus laesst sich oeffnen', (await textKlein('#summary-box')).includes('3-dart-average') && !(await textKlein('#summary-box')).includes('endstand'));

/* Dasselbe Turnier laeuft hier noch als geteilte Kopie (anderes Geraet hat
   abgeschlossen): es darf nicht doppelt zaehlen -- und das Abschliessen hier
   legt keinen zweiten Eintrag an. */
const tDoppel = await page.evaluate((vor) => {
  const D = window.__dart, S = D.state();
  const h = S.history.find((x) => x.id === 'turnier_x');
  S.tour = { start: 501, bestOf: 1, players: vor.ids.slice(), geteilt: true, sid: 'turnier_x', cursor: 5, beendet: true };
  S.matches = JSON.parse(JSON.stringify(h.matches));
  D.save();
  const c = D.career();
  const won = vor.ids.map((id) => c[id].won);
  D.action('finish-tournament');
  const c2 = D.career();
  return { won, wonNach: vor.ids.map((id) => c2[id].won), eintraege: S.history.filter((x) => x.id === 'turnier_x').length, tour: S.tour, matches: S.matches.length };
}, tVor);
check('laufende Kopie eines archivierten Turniers zaehlt nicht doppelt', JSON.stringify(tDoppel.won) === JSON.stringify(tVor.won), JSON.stringify(tDoppel));
check('Abschliessen legt keinen zweiten Eintrag an und raeumt auf', tDoppel.eintraege === 1 && tDoppel.tour === null && tDoppel.matches === 0 &&
  JSON.stringify(tDoppel.wonNach) === JSON.stringify(tVor.won), JSON.stringify(tDoppel));

/* Ein Turnier, in dem nichts gespielt wurde, hinterlaesst keinen Eintrag. */
const tLeer = await page.evaluate((vor) => {
  const D = window.__dart, S = D.state();
  const n = S.history.length;
  S.lineup = vor.ids.slice(); S.mode = '501'; D.save(); D.setScreen('setup');
  D.action('start-game');
  const laeuft = S.matches.length;
  D.action('finish-tournament');
  return { laeuft, n, nach: S.history.length };
}, tVor);
check('leeres Turnier wird nicht archiviert', tLeer.laeuft === 3 && tLeer.nach === tLeer.n, JSON.stringify(tLeer));
await page.evaluate(() => { const D = window.__dart, S = D.state(); S.history = S.history.filter((x) => x.id !== 'turnier_x'); D.save(); D.setScreen('setup'); });

/* ---------- Geist in der Aufstellung ---------- */
group('Aufstellung: ausgeblendeter Gast kann nicht mitspielen');
{
  const g = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.matches = []; S.tour = null;
    const ids = D.activeProfiles().slice(0, 2).map((p) => p.id);
    /* Ausgeblendeter Gast, dessen Kennung in der Aufstellung haengen blieb -- doppelt. */
    S.profiles.push({ id: 'geist', name: 'Laura', gast: true, hidden: true, avatar: null, hue: 2, created: Date.now() });
    S.lineup = [ids[0], 'geist', ids[1], 'geist'];
    S.mode = 'quick'; S.settings.quickSaetze = 1; S.settings.quickLegs = 1;
    D.save(); D.setScreen('setup');
    return { ids, lineup: S.lineup.slice() };
  });
  check('beim Betreten des Setups ist der Geist aus der Aufstellung', g.lineup.length === 2 && g.lineup.indexOf('geist') < 0, JSON.stringify(g.lineup));
  await page.evaluate(() => { const S = window.__dart.state(); S.lineup.push('geist'); window.__dart.save(); });
  await page.locator('[data-action="start-game"]').click();
  await bullOffGo();
  check('auch beim Start eines Spiels bleibt er draussen', await page.evaluate(() => {
    const g2 = window.__dart.game();
    return !!g2 && g2.players.length === 2 && g2.players.indexOf('geist') < 0;
  }));
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.profiles = S.profiles.filter((p) => p.id !== 'geist'); D.save(); D.setScreen('setup');
  });
}

/* ---------- Ton & Feiern abschaltbar ---------- */
group('Ton & Feiern: Feiern lassen sich abschalten');
{
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.matches = []; S.tour = null;
    S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
    S.mode = 'quick'; S.settings.quickSaetze = 1; S.settings.quickLegs = 1; S.settings.dartModeFrom = 170;
    D.save(); D.setScreen('setup');
  });
  check('die Karte Ton & Feiern steht im Setup', await visible('#settings-ton'));
  await page.locator('#settings-ton [data-setting="feiern"] [data-value="0"]').click();
  check('Feiern aus ist gespeichert', await page.evaluate(() => window.__dart.state().settings.feiern === 0));
  await page.locator('[data-action="start-game"]').click();
  await bullOffGo();
  await page.evaluate(() => { document.getElementById('feier').innerHTML = ''; });
  await typeScore(60);
  check('mit Feiern aus bleibt die 60 ohne Loewe', !(await text('#feier')).includes('SECHZIG'));
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.settings.feiern = 1; S.game = null; D.save(); D.setScreen('setup');
  });
}

/* ---------- Zurueck-Taste ---------- */
group('Zurueck-Taste verlaesst die App nicht aus Versehen');
{
  await navTo('boards');
  await page.goBack();
  await page.waitForTimeout(150);
  check('Zurueck aus der Rangliste fuehrt ins Setup', await page.evaluate(() => window.__dart.state().screen === 'setup'));
  check('die Seite ist noch da', page.url().startsWith('http'));
  await page.locator('#screen-setup [data-action="new-profile"]').click();
  await page.goBack();
  await page.waitForTimeout(150);
  check('Zurueck schliesst zuerst einen offenen Dialog', await page.evaluate(() => !window.__dart.ui().overlay));
}

/* ---------- Kein Spiel laeuft laenger als 12 Stunden ---------- */
group('Altes Spiel: nach 12 Stunden beendet, nicht gespeichert');
{
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.matches = []; S.tour = null;
    S.lineup = D.activeProfiles().slice(0, 2).map((p) => p.id);
    S.mode = 'quick'; S.settings.quickSaetze = 1; S.settings.quickLegs = 1;
    D.save(); D.setScreen('setup');
  });
  await page.locator('[data-action="start-game"]').click();
  await bullOffGo();
  await typeScore(100);
  const vorher = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const hatUhr = !!S.gameSeit && S.gameSeit.id === S.game.id && typeof S.gameSeit.seit === 'number' && !('seit' in S.game);
    S.gameSeit.seit = Date.now() - 13 * 3600 * 1000;
    D.save();
    return { hatUhr, archiv: S.history.length };
  });
  check('ein neues Spiel bekommt seinen Startzeitpunkt', vorher.hatUhr);
  await page.reload();
  await page.waitForTimeout(300);
  const nachher = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const o = D.ui().overlay;
    return { game: S.game, screen: S.screen, archiv: S.history.length, hinweis: !!o && o.type === 'hinweis' };
  });
  check('nach 13 Stunden ist das angefangene Spiel weg', nachher.game === null && nachher.screen === 'setup', JSON.stringify(nachher));
  check('und es wurde nicht gespeichert', nachher.archiv === vorher.archiv);
  check('ein Hinweis sagt, was passiert ist', nachher.hinweis && (await text('#overlay-card')).includes('12 Stunden'));
  await page.locator('[data-action="ov-hinweis-zu"]').click();

  /* Ein frisches Spiel bleibt natuerlich stehen. */
  await page.locator('[data-action="start-game"]').click();
  await bullOffGo();
  await typeScore(60);
  await page.reload();
  await page.waitForTimeout(300);
  check('ein Spiel von eben ueberlebt das Neuladen', await page.evaluate(() => !!window.__dart.state().game));
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; D.ui().overlay = null; D.save(); D.setScreen('setup'); });
}

group('Erster Start: Willkommen-Karte');
{
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    window.__archivMerker = S.history; S.history = []; S.game = null; S.matches = []; S.tour = null;
    delete S.settings.willkommenWeg;
    D.save(); D.setScreen('setup');
  });
  check('ohne ein einziges Spiel erklaert eine Karte die drei Schritte', await visible('#willkommen'));
  await page.locator('[data-action="willkommen-weg"]').click();
  check('Verstanden blendet sie fuer immer aus', !(await visible('#willkommen')) &&
    await page.evaluate(() => window.__dart.state().settings.willkommenWeg === 1));
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.history = window.__archivMerker; D.save(); D.setScreen('setup'); });
}

/* ---------- Ligaspiel: Ergebnisse, Bericht, erst dann abgeschlossen ---------- */
group('Ligaspiel endet erst mit dem unterschriebenen Bericht');
{
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; S.matches = []; S.tour = null; S.current = null; D.ui().overlay = null; D.save(); D.setScreen('liga'); });
  await page.locator('#liga-plan [data-action="liga-spiel"]').first().click();
  for (let i = 0; i < 4; i++) {
    await page.locator(`[data-role="liga-gegner"][data-i="${i}"]`).fill('Abschluss' + i);
    await page.locator(`[data-role="liga-gegner-nach"][data-i="${i}"]`).fill('Test' + i);
  }
  await page.locator('[data-action="liga-los"]').click();
  const termin = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.matches.forEach((m) => {
      m.starter = m.p[0];
      m.legs = [{ starter: m.p[0], visits: [], winner: m.p[0] }, { starter: m.p[1], visits: [], winner: m.p[0] }];
      m.done = true; m.winner = m.p[0]; m.at = Date.now();
    });
    D.save(); D.setScreen('tournament');
    return S.tour.liga.terminId;
  });
  check('alle Einzel gespielt: der Weg geht zu Ergebnissen und Bericht',
    await visible('#liga-stand [data-action="to-winner"]'));
  await navTo('setup');
  check('der Spiel-Tab beendet das Ligaspiel nicht, sondern zeigt die Ergebnisse',
    (await visible('#screen-winner')) && await page.evaluate(() => window.__dart.state().matches.length === 16));
  check('Man of the Day fuer beide Teams', (await page.locator('#winner-box .motd .motd-titel').count()) === 2);
  check('kein "Ligaspiel abschliessen" ohne Bericht', !(await visible('#screen-winner [data-action="finish-tournament"]')));
  await page.locator('#winner-box [data-action="liga-bericht"]').click();
  check('weiter zum Spielbericht', await visible('#screen-bericht'));
  await page.locator('#bericht-blatt td[contenteditable]').nth(2).click();
  await page.keyboard.type('Handkorrektur');
  await page.evaluate(() => {
    const D = window.__dart;
    D.ui().overlay = { type: 'bericht-versand', adressen: ['spielbericht@steeldart-muenchen.de', '', ''] };
    D.render();
  });
  await page.locator('[data-action="bericht-ohne-senden"]').click();
  const nach = await page.evaluate((t) => {
    const S = window.__dart.state();
    const h = S.history.find((x) => x.liga && x.liga.terminId === t);
    return { laeuft: S.matches.length, archiv: !!h, zu: !!(h && h.liga.abgeschlossen) };
  }, termin);
  check('danach ist das Ligaspiel abgeschlossen und archiviert', nach.laeuft === 0 && nach.archiv && nach.zu, JSON.stringify(nach));
  check('der Bericht bleibt sichtbar', await visible('#screen-bericht'));
  check('Handkorrekturen im Bogen ueberstehen den Abschluss', (await text('#bericht-blatt')).includes('Handkorrektur'));
  await page.locator('#overlay-card [data-action="ov-hinweis-zu"]').click();
  await page.evaluate(() => window.__dart.setScreen('liga'));
  check('rechts in der Liste steht der Spieltag als abgeschlossen',
    (await page.locator('#liga-liste .liga-spieltag').first().innerText()).includes('Abgeschlossen'));
  await page.locator('#liga-liste [data-action="liga-wahl"][data-id="' + termin + '"]').click();
  const karte = page.locator('#liga-karte');
  check('links steht der Spieltag als abgeschlossen', (await karte.innerText()).includes('Abgeschlossen'));
  check('und laesst sich nicht nochmal starten', (await karte.locator('[data-action="liga-spiel"]').count()) === 0);
  await page.evaluate(() => { window.__dart.ui().bericht = null; });
  check('Ergebnisse und Bericht bleiben einsehbar',
    (await karte.locator('[data-action="open-summary"]').count()) === 1 && (await karte.locator('[data-action="liga-bericht"]').count()) === 1);
  /* Ein alter Eintrag ohne gespieltes Einzel sperrt den Spieltag nicht. */
  const startbar = await page.evaluate((t) => {
    const D = window.__dart, S = D.state();
    const h = S.history.find((x) => x.liga && x.liga.terminId === t);
    h.matches.forEach((m) => { m.done = false; m.winner = null; m.legs = []; });
    D.save(); D.setScreen('liga');
    return !!document.querySelector('#liga-plan [data-action="liga-spiel"]');
  }, termin);
  check('ein Eintrag ohne gespieltes Einzel laesst den Spieltag startbar', startbar);
  await page.evaluate((t) => {
    const D = window.__dart, S = D.state();
    S.history = S.history.filter((x) => !(x.liga && x.liga.terminId === t));
    S.profiles = S.profiles.filter((p) => !(p.voll || '').startsWith('Abschluss'));
    D.save(); D.setScreen('setup');
  }, termin);
}

group('Einmalige Korrektur: Spielbericht 1. Spieltag');
{
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.game = null; S.matches = []; S.tour = null; S.current = null; D.ui().overlay = null;
    const ids = D.activeProfiles().slice(0, 4).map((p) => p.id);
    S.profiles.push({ id: 'k_g1', name: 'Gast Eins', voll: 'Gast Eins', gast: true, avatar: null, hue: 5, created: Date.now() });
    const matches = [];
    for (let i = 0; i < 16; i++) {
      const id = i === 12 ? 'yn2rfle' : 'k' + i;
      matches.push({ id, round: Math.floor(i / 4) + 1, p: [ids[i % 4], 'k_g1'], posPaar: i === 12 ? [3, 0] : [i % 4, 0], starter: ids[i % 4],
        legs: [{ starter: ids[i % 4], visits: [], winner: ids[i % 4] }, { starter: 'k_g1', visits: [], winner: ids[i % 4] }], done: true, winner: ids[i % 4], at: Date.now() - 1000 * (16 - i) });
    }
    const sig = document.createElement('canvas'); sig.width = 20; sig.height = 10;
    const bild = sig.toDataURL('image/png');
    S.history.unshift({ id: 'vdmmbu0', at: Date.now(), lineup: ids.concat(['k_g1']), settings: { start: 501, bestOf: 3 }, matches, winner: null,
      liga: { terminId: 'st01', nr: 1, gegner: 'TSV Dachau 1865 4', heim: true, wir: ids, sie: ['k_g1'], heimSpieler: ids, gastSpieler: ['k_g1'],
        posH: ids, posG: ['k_g1'], ort: 'Bar Sehnsucht', tag: '2026-10-06', abgeschlossen: Date.now(), unterschriften: { heim: bild, gast: bild } } });
    D.save();
  });
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const D = window.__dart; D.ui().bericht = 'st01'; D.berichtNeu(); D.setScreen('bericht'); });
  const k = await page.evaluate(() => ({
    zeile: (document.querySelector('#bericht-blatt [data-kf="einzel-12"]') || {}).textContent,
    nach: document.querySelector('#bericht-blatt td[data-feld="nachmeldungen"]').textContent.replace(/\s+/g, ' '),
    prot: document.querySelector('#bericht-blatt td[data-feld="proteste"]').textContent.replace(/\s+/g, ' '),
    final: document.getElementById('bericht-blatt').classList.contains('final'),
    einmal: !!window.__dart.state().history.find((h) => h.id === 'vdmmbu0').liga.korrekturSt01
  }));
  check('im unterschriebenen Bericht steht jetzt H5 – G1', k.zeile === 'H5 – G1', JSON.stringify(k));
  /* Ein Gast, den dieses Geraet nur mit ganzem Namen kennt (kam vom anderen
     iPad), steht trotzdem getrennt in Vorname und Name. */
  const gastZeile = await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    const p = S.profiles.find((x) => x.id === 'k_g1'); delete p.voll; p.name = 'Vincent von Frankenberg';
    D.berichtNeu(); D.setScreen('bericht');
    const zellen = document.querySelectorAll('#bericht-blatt .b-spieler')[1].querySelectorAll('tr')[1].querySelectorAll('td');
    return [zellen[0].textContent, zellen[1].textContent];
  });
  check('Gastnamen stehen getrennt in Vorname und Name (auch mit "von")', gastZeile[0] === 'Vincent' && gastZeile[1] === 'von Frankenberg', JSON.stringify(gastZeile));
  check('Nachmeldungen und Proteste: nein angekreuzt', k.nach.includes('nein X') && k.prot.includes('nein X'), JSON.stringify(k));
  check('der Bericht bleibt final und die Korrektur laeuft nur einmal', k.final && k.einmal, JSON.stringify(k));
  await page.evaluate(() => {
    const D = window.__dart, S = D.state();
    S.history = S.history.filter((h) => h.id !== 'vdmmbu0');
    S.profiles = S.profiles.filter((p) => p.id !== 'k_g1');
    D.ui().bericht = null; D.save(); D.setScreen('setup');
  });
}

group('Fehlerfreiheit');
check('keine JS-Fehler', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'Alle Tests bestanden' : failures + ' Test(s) fehlgeschlagen'}`);
process.exit(failures === 0 ? 0 : 1);
