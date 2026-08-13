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
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

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
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push('HTTP ' + r.status() + ': ' + r.url()); });

const $ = (sel) => page.locator(sel);
const visible = (sel) => $(sel).isVisible();
const text = (sel) => $(sel).innerText();
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
const names = await page.locator('#player-list input').evaluateAll((els) => els.map((e) => e.value));
check('4 Spieler vorbelegt', JSON.stringify(names) === '["Lenas","Tobi","Domi","Julius"]', names.join(','));
check('501 vorausgewählt', await page.locator('[data-setting="start"] button[data-value="501"]').evaluate((e) => e.classList.contains('active')));

group('Turnierplan');
await page.locator('[data-action="start-tournament"]').click();
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
const firstName = await page.locator('#bulloff-buttons button').first().innerText();
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
check('Match-Ende-Overlay', (await visible('#overlay')) && (await text('#overlay-card')).includes('gewinnt'));

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
check('erneut ausgecheckt', (await text('#overlay-card')).includes('gewinnt'));

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
check('Match beendet', (await text('#overlay-card')).includes('gewinnt'));

group('Restliches Turnier & Endstand');
for (let i = 0; i < 4; i++) {
  await page.locator('#overlay-card [data-action="ov-next-match"], #overlay-card [data-action="ov-finish"]').first().click();
  if (await visible('#screen-bulloff')) await page.locator('#bulloff-buttons button').nth(i % 2).click();
  await quickLeg();
  await page.locator('#overlay-card [data-action="co-darts"]').first().click();
}
check('letztes Spiel bietet Auswertung', (await text('#overlay-card')).includes('Turnier auswerten'));
await page.locator('#overlay-card [data-action="ov-finish"]').click();
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

group('Fehlerfreiheit');
check('keine JS-Fehler', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'Alle Tests bestanden' : failures + ' Test(s) fehlgeschlagen'}`);
process.exit(failures === 0 ? 0 : 1);
