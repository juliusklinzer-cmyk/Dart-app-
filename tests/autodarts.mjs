/*
 * Autodarts-Anschluss Ende zu Ende, ohne Kameras: ein nachgebauter Board
 * Manager (/api/state wie Autodarts, beide bekannten Formate), die echte
 * Bruecke (tools/autodarts-bruecke/bruecke.mjs) als eigener Prozess und die
 * App im Chromium. Geprueft wird, was Julius am Board erlebt: jeder Dart
 * kommt einzeln und sofort, Ziehen fuellt auf, ein Dialog laesst Darts
 * warten statt sie zu verlieren, ohne Freischaltung sieht niemand etwas.
 *
 *   node tests/autodarts.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. Bruecke als Bibliothek: Formate und Verfolger ---------- */
process.env.AD_BRUECKE_NICHT_STARTEN = '1';
const B = await import('../tools/autodarts-bruecke/bruecke.mjs');
delete process.env.AD_BRUECKE_NICHT_STARTEN;
console.log('\nBrücke: Formate');
check('altes Format T20', JSON.stringify(B.normalizeThrow({ segment: { name: 'T20', number: 20, bed: 'Triple', multiplier: 3 } })) === JSON.stringify({ label: 'T20', m: 3, n: 20, ok: true }));
check('neues Format D16', B.normalizeThrow({ segmentName: 'D16', segmentNumber: 16, multiplier: 2, bed: 'Double' }).label === 'D16');
check('Bull (50) wird D Bull', (({ m, n }) => m === 2 && n === 25)(B.normalizeThrow({ segmentName: 'BULL', segmentNumber: 25, multiplier: 2 })));
check('Outside ist ein Fehlwurf (0)', (({ m, n, ok }) => n === 0 && m === 1 && ok)(B.normalizeThrow({ segmentName: 'M3', segmentNumber: 3, multiplier: 1, bed: 'Outside' })));
check('unlesbar bleibt unlesbar', B.normalizeThrow({ segmentName: 'X9' }).ok === false);
console.log('\nBrücke: Verfolger');
{
  const ev = [];
  const v = B.erstelleVerfolger((typ, d) => ev.push(typ + ':' + (d.label || d.anzahl || '')));
  const st = (status, liste) => v.update(B.normalizeState({ status, throws: liste.map((x) => ({ segmentName: x })) }));
  st('Throw', ['T20']);                      // beim Start lag schon ein Dart: nicht buchen
  check('Darts beim Start werden nicht nachgebucht', ev.length === 0, ev.join(' '));
  st('Takeout in progress', ['T20']); st('Throw', []);
  st('Throw', ['S20']); st('Throw', ['S20']); st('Throw', ['S20', 'T19']);
  check('jeder Dart einzeln und nur einmal', ev.join(' ') === 'ziehen:1 dart:S20 dart:T19', ev.join(' '));
  st('Throw', ['S20', 'D19']);
  check('Autodarts korrigiert einen Dart: korrektur', ev[ev.length - 1] === 'korrektur:D19', ev.join(' '));
  st('Takeout in progress', ['S20']); st('Throw', []);
  check('Ziehen meldet das Ende der Aufnahme', ev[ev.length - 1] === 'ziehen:2', ev.join(' '));
  st('Throw', ['T20', 'T20', 'T20', 'T20']);
  check('ein vierter "Dart" wird nicht gebucht', ev.filter((x) => x === 'dart:T20').length === 3, ev.join(' '));
}

/* ---------- 2. Nachgebauter Board Manager ---------- */
let boardState = { status: 'Throw', event: '', throws: [] };
let neuesFormat = false;
const board = http.createServer((req, res) => {
  if (req.url.startsWith('/api/state')) {
    const t = boardState.throws.map((x) => (neuesFormat
      ? { segmentName: x, segmentNumber: Number(String(x).replace(/\D/g, '')) || 0, multiplier: /^T/.test(x) ? 3 : /^D|BULL/.test(x) ? 2 : 1, bed: x === 'Miss' ? 'Outside' : '' }
      : { segment: { name: x } }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.assign({}, boardState, { throws: t.length ? t : undefined })));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => board.listen(0, '127.0.0.1', r));
const wirf = async (x) => { boardState = { status: boardState.throws.length >= 2 ? 'Takeout' : 'Throw', event: 'Throw detected', throws: boardState.throws.concat([x]) }; await warte(350); };
const ziehe = async () => { boardState = { status: 'Takeout in progress', event: 'Takeout started', throws: boardState.throws }; await warte(250); boardState = { status: 'Throw', event: '', throws: [] }; await warte(350); };

/* ---------- 3. App-Server ---------- */
const app = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const HERKUNFT = `http://127.0.0.1:${app.address().port}`;

/* ---------- 4. Bruecke als Prozess ---------- */
const BR_PORT = 3200 + Math.floor(Math.random() * 500);
const bruecke = spawn(process.execPath, [path.join(ROOT, 'tools/autodarts-bruecke/bruecke.mjs'),
  '--quelle', `http://127.0.0.1:${board.address().port}`, '--port', String(BR_PORT), '--takt', '60', '--leise', '--herkunft', HERKUNFT], { stdio: ['ignore', 'pipe', 'pipe'] });
let brLog = '';
bruecke.stdout.on('data', (d) => { brLog += d; }); bruecke.stderr.on('data', (d) => { brLog += d; });
for (let i = 0; i < 50 && !/auf http/.test(brLog); i++) await warte(100);
check('Brücke startet', /auf http/.test(brLog), brLog);

const preinstalled = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch(fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

try {
  console.log('\nOhne Freischaltung');
  await page.goto(HERKUNFT + '/index.html');
  await page.waitForFunction(() => window.__dart && window.__dart.state());
  await warte(300);
  check('kein Autodarts-Knopf, kein DartAutodarts', (await page.locator('.ad-chip').count()) === 0 && !(await page.evaluate(() => !!window.DartAutodarts)));

  console.log('\nFreigeschaltet, verbunden');
  await page.evaluate((a) => localStorage.setItem('dart-autodarts-v1', JSON.stringify({ frei: false, an: false, adresse: a })), `http://127.0.0.1:${BR_PORT}`);
  await page.goto(HERKUNFT + '/index.html?autodarts=an');
  await page.waitForFunction(() => window.__dart && window.DartAutodarts);
  /* Wie ein echter Mausklick an die Stelle. */
  const tippe = async (sel) => { const r = await page.locator(sel).boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await warte(120); };
  await page.evaluate(() => window.__dart.setScreen('setup'));
  check('aus: kein Knopf oben im Bild', !(await page.locator('.ad-chip').isVisible()));
  check('die Einrichtung steht bei den Einstellungen', await page.locator('#setting-autodarts').isVisible() && /Einrichten/.test(await page.locator('#setting-autodarts').textContent()));
  await tippe('#setting-autodarts [data-action="autodarts-einrichten"]');
  check('Einrichten öffnet die Karte mit den Schritten', await page.locator('.ad-panel').isVisible() && (await page.locator('.ad-schritte li').count()) === 4);
  await page.waitForFunction(() => document.querySelectorAll('.ad-schritte li.ok').length === 3, null, { timeout: 5000 }).catch(() => {});
  check('Brücke, Autodarts und Erkennung grün, Einschalten noch gesperrt (Testwurf fehlt)',
    (await page.locator('.ad-schritte li.ok').count()) === 3 && await page.locator('.ad-panel [data-ad="an"]').isDisabled());
  await wirf('S1');
  await page.waitForFunction(() => document.querySelectorAll('.ad-schritte li.ok').length === 4, null, { timeout: 5000 }).catch(() => {});
  check('Testwurf erkannt, nichts gebucht', (await page.locator('.ad-schritte li.ok').count()) === 4 && (await page.evaluate(() => window.DartAutodarts.zustand().schlange)) === 0);
  await ziehe();
  await tippe('.ad-panel [data-ad="an"]');
  await page.waitForFunction(() => window.DartAutodarts.zustand().verbunden && window.DartAutodarts.zustand().board.verbunden, null, { timeout: 5000 }).catch(() => {});
  check('eingeschaltet: oben steht der Zustand', (await page.locator('.ad-chip').textContent()).includes('bereit'), await page.locator('.ad-chip').textContent());
  await tippe('.ad-panel [data-ad="zu"]');
  check('bei der Eingabe steht nur noch Autodarts', await page.locator('#eingabe-autodarts').isVisible() && !(await page.locator('#eingabe-wahl [data-action="eingabe"]').first().isVisible()));
  check('Freischaltung überlebt Neuladen', await page.evaluate(() => JSON.parse(localStorage.getItem('dart-autodarts-v1')).frei === true));

  /* Schnelles X01, ein Spieler, 501. */
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.game = null; if (!D.activeProfiles().length) D.action('add-demo'); });
  const profile = await page.evaluate(() => window.__dart.activeProfiles().length);
  if (!profile) {
    await page.evaluate(() => { const S = window.__dart.state(); S.profiles = S.profiles || []; S.profiles.push({ id: 'p_ad', name: 'Julius', hue: 0 }); window.__dart.save(); });
  }
  await page.evaluate(() => { const D = window.__dart, S = D.state(); S.lineup = D.activeProfiles().slice(0, 1).map((p) => p.id); S.settings.feiern = 0; S.settings.quickModus = 0; S.settings.quickLegs = 2; D.setScreen('setup'); });
  await page.locator('[data-action="set-mode"][data-value="quick"]').click();
  await page.locator('[data-action="start-game"]').click();
  await warte(400);
  const rest = () => page.evaluate(() => { const D = window.__dart, m = D.currentMatch(), l = D.activeLeg(m); return D.remainingIn(l, D.activePlayer(l, m)) - D.ui().darts.reduce((a, d) => a + d.v, 0); });
  const besuche = () => page.evaluate(() => { const D = window.__dart, l = D.activeLeg(D.currentMatch()); return l.visits.length; });

  const t0 = Date.now();
  await wirf('T20');
  check('erster Dart ist sofort gebucht (Rest 441)', (await rest()) === 441, String(await rest()));
  check('…in unter einer Sekunde', Date.now() - t0 < 1000, (Date.now() - t0) + ' ms');
  await wirf('T20'); await wirf('T20');
  check('drei Darts: 180, Aufnahme gebucht', (await besuche()) === 1 && (await rest()) === 321, (await besuche()) + ' / ' + (await rest()));
  await ziehe();
  check('Ziehen nach drei Darts bucht nichts dazu', (await besuche()) === 1);

  neuesFormat = true;
  await wirf('S20'); await wirf('S1');
  check('neues Format: zwei Darts offen (Rest 300)', (await rest()) === 300 && (await besuche()) === 1);
  await ziehe();
  check('Ziehen nach zwei Darts füllt mit einem Fehlwurf auf', (await besuche()) === 2 && (await rest()) === 300, (await besuche()) + ' / ' + (await rest()));
  const letzte = await page.evaluate(() => { const l = window.__dart.activeLeg(window.__dart.currentMatch()); const v = l.visits[l.visits.length - 1]; return v.k.map((d) => d.m + 'x' + d.n).join(' '); });
  check('…als 0 gebucht', letzte === '1x20 1x1 1x0', letzte);

  /* Offenes Menue: der Dart wartet und wird danach gebucht, nicht verloren. */
  await page.evaluate(() => { window.__dart.ui().menu = true; window.__dart.render(); });
  await wirf('S5');
  check('bei offenem Menü wartet der Dart', (await page.evaluate(() => window.DartAutodarts.zustand().schlange)) === 1 && (await rest()) === 300);
  await page.evaluate(() => { window.__dart.ui().menu = false; window.__dart.render(); });
  await warte(400);
  check('Menü zu: der wartende Dart ist gebucht (Rest 295)', (await rest()) === 295 && (await page.evaluate(() => window.DartAutodarts.zustand().schlange)) === 0, String(await rest()));
  await ziehe();
  check('…und Ziehen füllt diese Aufnahme auf', (await besuche()) === 3 && (await rest()) === 295);

  /* Checkout: Rest auf 40 setzen, D20 beendet das Leg -> Dialog; die Darts
     des naechsten Legs warten, bis der Dialog zu ist. */
  await page.evaluate(() => { const D = window.__dart, l = D.activeLeg(D.currentMatch()); l.visits.push({ p: l.visits[0].p, s: 255, d: 3, b: false, c: false, o: 0 }); D.save(); D.render(); });
  check('Rest 40', (await rest()) === 40, String(await rest()));
  /* Fehlalarm: Autodarts nimmt einen Dart zurueck -> die App auch. */
  await wirf('S20'); await wirf('S7');
  check('zwei Darts offen (Rest 13)', (await rest()) === 13, String(await rest()));
  boardState = { status: 'Throw', event: 'Throw detected', throws: ['S20'] }; await warte(350);
  check('Autodarts nimmt S7 zurück: die App auch (Rest 20)', (await rest()) === 20, String(await rest()));
  await wirf('S10');
  check('der nächste echte Dart zählt als zweiter (Rest 10)', (await rest()) === 10 && (await page.evaluate(() => window.__dart.ui().darts.length)) === 2);
  await ziehe();
  check('Ziehen füllt auf, Rest 10', (await rest()) === 10 && (await page.evaluate(() => window.__dart.ui().darts.length)) === 0);
  /* Bust beim ersten Dart: weitere Darts derselben Aufnahme gehoeren zu nichts. */
  const vorBust = await besuche();
  await wirf('T20');
  check('T20 auf 10 ist Bust, Rest bleibt 10', (await rest()) === 10 && (await besuche()) === vorBust + 1, (await rest()) + ' / ' + (await besuche()));
  await wirf('S5');
  check('der nächste Dart derselben Aufnahme wird nicht gebucht', (await rest()) === 10 && (await page.evaluate(() => window.__dart.ui().darts.length)) === 0);
  await ziehe();
  check('Ziehen füllt danach keine fremde Aufnahme auf', (await besuche()) === vorBust + 1);
  await wirf('D5');
  const ov = await page.evaluate(() => (window.__dart.ui().overlay || {}).type);
  check('D5 checkt: Leg-Dialog offen', ov === 'game-done' || ov === 'leg-done', String(ov));
  check('das Leg ist mit D5 gewonnen', await page.evaluate(() => { const l = window.__dart.currentMatch().legs[0]; const v = l.visits[l.visits.length - 1]; return v.c === true && v.d === 1; }));
  await ziehe();
  /* Bei offenem Leg-Dialog geworfen: wartet, nach "Weiter" im neuen Leg gebucht. */
  await wirf('T20'); await wirf('S19');
  check('zwei Darts (und das Ziehen davor) warten hinter dem Leg-Dialog', (await page.evaluate(() => window.DartAutodarts.zustand().schlange)) === 3);
  await page.locator('#overlay [data-action="ov-next-leg"]').click();
  await warte(700);
  const leg2 = await page.evaluate(() => { const m = window.__dart.currentMatch(); return [m.legs.length, window.__dart.ui().darts.map((d) => d.v).join(',')]; });
  check('nach dem Dialog stehen beide im neuen Leg', leg2[0] === 2 && leg2[1] === '60,19', JSON.stringify(leg2));
  await ziehe();
  check('kein Fehler bis hier', errors.length === 0, errors.join(' | '));

  console.log('\nFehlerfälle');
  board.close(); board.closeAllConnections && board.closeAllConnections();
  await warte(1800);
  check('Autodarts weg: gelb "nicht verbunden"', (await page.locator('.ad-chip').textContent()).includes('Autodarts nicht verbunden'), await page.locator('.ad-chip').textContent());
  bruecke.kill();
  await warte(1500);
  check('Brücke weg: rot "nicht erreichbar"', (await page.locator('.ad-chip').textContent()).includes('nicht erreichbar'), await page.locator('.ad-chip').textContent());
  await page.goto(HERKUNFT + '/index.html?autodarts=aus');
  await page.waitForFunction(() => window.__dart && window.__dart.state());
  await warte(300);
  check('?autodarts=aus nimmt alles wieder weg', (await page.locator('.ad-chip').count()) === 0);
  check('keine Konsolenfehler außer der toten Verbindung', errors.filter((e) => !/EventSource|ERR_CONNECTION|net::/.test(e)).length === 0, errors.join(' | '));
} catch (e) {
  failures++;
  console.log('  ✗ Abbruch', e && e.message);
} finally {
  try { bruecke.kill(); } catch (e) { /* schon weg */ }
  await browser.close();
  app.close(); try { board.close(); } catch (e) { /* zu */ }
}
console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(failures ? 1 : 0);
