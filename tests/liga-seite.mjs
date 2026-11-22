/*
 * Liga-Webseite (Vorschau, liga.html): nur fuer Angemeldete.
 *
 * Aufruf: node tests/liga-seite.mjs   (npm run test:liga-seite, Teil von test:alle)
 *
 * Startet den echten Server mit leerer Datenbank, prueft, dass Seite, CSS,
 * Skript, Datendatei und GET /api/liga-gesamt ohne Anmeldung 404/401
 * liefern und mit Anmeldung da sind, und rendert die Seite in Chromium bei
 * 390 und 1440 px (Tabelle, Spielplan, Spielbericht, Team, Verein) ohne
 * Konsolenfehler und ohne waagrechten Ueberlauf. Dazu die Parser von
 * server/lib/liga-gesamt.mjs an kleinen HTML-Stuecken.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/lib/password.mjs';
import { teamUebersichtAus, kontaktAus, ligenAusStart, termineAus, downloadsAus, datenAusText } from '../server/lib/liga-gesamt.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.TEST_PORT_LIGA) || 3197;
const BASIS = 'http://127.0.0.1:' + PORT;
const CODE = 'liga-vorschau-code';

let fehler = 0, geprueft = 0;
function check(was, ok, zusatz) {
  geprueft++;
  if (ok) console.log('  ✓ ' + was);
  else { fehler++; console.log('  ✗ ' + was + (zusatz ? '  ' + zusatz : '')); }
}
async function gruppe(titel, fn) {
  console.log('\n' + titel);
  try { await fn(); } catch (e) { check(titel + ' (Gruppe abgebrochen)', false, String((e && e.message) || e).split('\n')[0]); }
}

/* ---------- Parser ---------- */
await gruppe('Parser (liga-gesamt.mjs)', async () => {
  const start = '<option value="4er-1-liga.html" class="">\n 4er - 1.Liga\t</option><option value="69.html">Highlights</option>' +
    '<option value="4er-liga/4er-5-liga.html" class=""> 4er - 5.Liga </option>' +
    '<section role="main"><time datetime="2027-02-20" class="date">20.02.2027</time>\n <a href="eventreader/1759.html" title="x">Stadtmeisterschaft 2027</a></section><footer>';
  const ligen = ligenAusStart(start);
  check('Ligen aus der Navigation', ligen.length === 2 && ligen[1].nr === 5 && ligen[1].pfad === '4er-liga/4er-5-liga.html', JSON.stringify(ligen));
  const t = termineAus(start);
  check('Termine aus der Startseite', t.length === 1 && t[0].tag === '2027-02-20' && /eventreader\/1759/.test(t[0].url), JSON.stringify(t));
  const teams = teamUebersichtAus('<section role="main"><h2>4er - 5.Liga 26/27</h2><table><tbody><tr>\n<td><a href=\'mannschaftsseite/id/262.html\'>Blink 180</a></td>\n<td><ul><li>TC-1 Michael Schmeiß <li>TC-2 Tobias Thomas </ul></td>' +
    '<td><ul><li><a href=\'https://bar.de/\'>Bar Sehnsucht</a></li><li><a href=\'tel:+4989123\'>+4989123</a></li><li>\n Amalienstraße 26,\n 80333 München </li></ul></td></tr></tbody></table></section><footer>');
  const b = teams['Blink 180'];
  check('Teamuebersicht: Captains, Lokal, Telefon, Web, Adresse', b && b.id === 262 && b.liga === 5 && b.saison === '26/27' && b.captains.length === 2 && b.captains[1].name === 'Tobias Thomas' &&
    b.lokal === 'Bar Sehnsucht' && b.web === 'https://bar.de/' && b.telefon === '+4989123' && b.adresse === 'Amalienstraße 26, 80333 München', JSON.stringify(b));
  const k = kontaktAus('<section role="main"><div class="icon-boxes-item x"><h3>Spielleitung Liga</h3><p><p>Udo Kern</p><p><a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;&#108;&#x69;&#103;&#x61;&#64;x.de" class="email">liga</a></p></p></div></section><footer>');
  check('Kontakt mit entschluesselter Mail', k.length === 1 && k[0].name === 'Udo Kern' && k[0].email === 'liga@x.de', JSON.stringify(k));
  const dl = downloadsAus('<section role="main"><div class="ce_downloads block"><h2>Formulare Liga</h2><ul><li><a href="download.html?file=a.pdf&amp;cid=1" type="application/pdf">Spielberichtsbogen <span class="size">(97,1 KiB)</span></a></li></ul></div></section><footer>');
  check('Downloads', dl.length === 1 && dl[0].dateien[0].groesse === '97,1 KiB' && dl[0].dateien[0].url === 'https://steeldart-muenchen.de/download.html?file=a.pdf&cid=1', JSON.stringify(dl));
  const repo = datenAusText(fs.readFileSync(path.join(ROOT, 'js', 'liga-gesamt-daten.js'), 'utf8'));
  check('Schnappschuss js/liga-gesamt-daten.js laeuft und hat Ligen mit Tabelle und Spielberichten',
    repo && repo.ligen.length >= 5 && repo.ligen.every((l) => l.tabelle.length && l.teams.length) && repo.ligen.some((l) => l.spieltage.some((s) => s.spiele.some((x) => x.partien && x.partien.length === 16))));
});

/* ---------- Server ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-liga-'));
/* Vom Server geholter Stand neben der Datenbank geht der Repo-Fassung vor. */
const repoDaten = datenAusText(fs.readFileSync(path.join(ROOT, 'js', 'liga-gesamt-daten.js'), 'utf8'));
fs.writeFileSync(path.join(tmp, 'liga-gesamt.json'), JSON.stringify({ ...repoDaten, marke: 'SERVER-STAND' }));
const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DARTS_DB: path.join(tmp, 'test.db'), DARTS_INVITE_HASH: hashPassword(CODE), DARTS_SECURE_COOKIES: '0', NODE_ENV: 'test', DARTS_LIGA_GESAMT: '0', DARTS_LIGA_IMPORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
});
proc.stdout.on('data', () => {});
proc.stderr.on('data', (d) => process.stderr.write('  [server] ' + d));

async function warte() {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Server ist beim Start abgestuerzt.');
    try { if ((await fetch(BASIS + '/api/ping')).ok) return; } catch (e) { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server kam nicht hoch.');
}

let cookie = null;
let browser = null;
try {
  await warte();

  await gruppe('Ohne Anmeldung kein Zugriff', async () => {
    for (const p of ['/liga.html', '/css/liga.css', '/js/liga.js', '/js/liga-gesamt-daten.js', '/liga%2Ehtml', '/js/liga%2Ejs', '/%6Ciga.html']) {
      const r = await fetch(BASIS + p);
      const t = await r.text();
      check(p + ' liefert 404', r.status === 404 && !/LIGA_GESAMT|<html/i.test(t), 'Status ' + r.status);
    }
    const r = await fetch(BASIS + '/api/liga-gesamt');
    check('/api/liga-gesamt liefert 401', r.status === 401, 'Status ' + r.status);
    const w = await (await fetch(BASIS + '/')).text();
    check('die oeffentliche Webseite verlinkt die Liga-Seite nicht', !/liga\.html|liga-gesamt/.test(w));
  });

  await gruppe('Mit Anmeldung', async () => {
    const r = await fetch(BASIS + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Darts-App': '1' }, body: JSON.stringify({ invite: CODE, email: 'liga@example.de', name: 'Liga', password: 'turnierabend2026' }) });
    const sc = String(r.headers.get('set-cookie') || '');
    cookie = (/darts_session=([^;]+)/.exec(sc) || [])[1];
    check('Konto angelegt, Session-Cookie da', r.ok && !!cookie, 'Status ' + r.status);
    const h = { Cookie: 'darts_session=' + cookie };
    const seite = await fetch(BASIS + '/liga.html', { headers: h });
    const html = await seite.text();
    check('liga.html wird ausgeliefert, mit noindex', seite.status === 200 && /<meta name="robots" content="noindex,nofollow">/.test(html) && /noindex/.test(seite.headers.get('x-robots-tag') || ''));
    for (const p of ['/css/liga.css', '/js/liga.js', '/js/liga-gesamt-daten.js']) {
      check(p + ' wird ausgeliefert', (await fetch(BASIS + p, { headers: h })).status === 200);
    }
    const j = await fetch(BASIS + '/api/liga-gesamt', { headers: h });
    const d = await j.json();
    check('/api/liga-gesamt liefert den Server-Stand (Datei neben der Datenbank)', j.status === 200 && d.marke === 'SERVER-STAND' && d.ligen.length >= 5);
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    check('Liga-Seite steht nicht im Service-Worker-Cache', !/liga\.html|liga\.css|liga\.js|liga-gesamt/.test(sw));
  });

  await gruppe('Darstellung 390 und 1440 px', async () => {
    browser = await chromium.launch();
    for (const breite of [390, 1440]) {
      const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
      await ctx.addCookies([{ name: 'darts_session', value: cookie, url: BASIS }]);
      await ctx.addInitScript(() => { window.__ligaHeute = '2026-11-22'; });
      const page = await ctx.newPage();
      const konsole = [];
      page.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()); });
      page.on('pageerror', (e) => konsole.push(String(e)));
      const ueberlauf = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

      await page.goto(BASIS + '/liga.html');
      await page.waitForSelector('.liga-karte');
      check(breite + ' px: Uebersicht mit allen Ligen', (await page.locator('.liga-karte').count()) >= 5);
      await page.click('#haupt-nav a[data-bereich="liga"]');
      await page.waitForSelector('.tab-liga tbody tr');
      check(breite + ' px: Tabelle der 5. Liga mit 9 Teams', (await page.locator('.tab-liga tbody tr').count()) === 9 && /5\. Liga/i.test(await page.locator('h1').innerText()));
      check(breite + ' px: kein waagrechter Ueberlauf (Tabelle)', !(await ueberlauf()));
      await page.click('.reiter a:has-text("Spielplan")');
      await page.waitForSelector('.st-wahl .st');
      check(breite + ' px: Spielplan mit 18 Spieltagen', (await page.locator('.st-wahl .st').count()) === 18);
      await page.goto(BASIS + '/liga.html#/liga/5/spielplan/1');
      await page.click('a.sz.mit-bericht >> nth=0');
      await page.waitForSelector('.einzel li');
      check(breite + ' px: Spielbericht mit 16 Einzeln', (await page.locator('.einzel li').count()) === 16);
      check(breite + ' px: kein waagrechter Ueberlauf (Spielbericht)', !(await ueberlauf()));
      await page.click('.ergebnis-gross a.tl >> nth=0');
      await page.waitForSelector('.info-karte');
      check(breite + ' px: Teamseite mit Spielort und Spielerliste', (await page.locator('.info-karte .ik-lokal').innerText()).length > 2 && (await page.locator('.tab tbody tr').count()) > 3);
      await page.click('.tab .sl >> nth=0');
      await page.waitForSelector('.kacheln.reihe');
      check(breite + ' px: Spielerseite mit Bilanz', (await page.locator('.kacheln.reihe .kachel').count()) >= 4);
      await page.goto(BASIS + '/liga.html#/verein');
      await page.waitForSelector('.kontakt .ko');
      check(breite + ' px: Verein mit Kontakt und Downloads', (await page.locator('.kontakt .ko').count()) > 2 && (await page.locator('.dl').count()) > 2);
      await page.goto(BASIS + '/liga.html#/spieler');
      await page.fill('#suche', 'Thomas');
      check(breite + ' px: Spielersuche findet', (await page.locator('#such-ergebnis .sl').count()) > 0);
      check(breite + ' px: keine Konsolenfehler', konsole.length === 0, konsole.join(' | '));
      await ctx.close();
    }
  });
} catch (e) {
  check('Liga-Seite (abgebrochen)', false, String((e && e.message) || e));
} finally {
  if (browser) await browser.close();
  proc.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\n' + (geprueft - fehler) + ' von ' + geprueft + ' Pruefungen gruen');
process.exit(fehler ? 1 : 0);
