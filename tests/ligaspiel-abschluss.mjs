/*
 * Abschlusstest Liga-Redesign (DRT-097, Julius 28.11.): ein ganzer Ligaabend
 * an zwei iPads, echter Server, zwei echte Browser - so wie am 09.12. bei
 * Treff ma nix:
 *   Spielplan › GAME DAY › Scheibe waehlen › Aufstellung (Kader-Chips) ›
 *   BEREIT › GAME ON und „LOS GEHT'S“ › alle 16 Einzel mit Ausbullen und
 *   Zaehlen, jedes an seiner Scheibe › gleicher Stand auf beiden iPads ›
 *   Spielende › Spielbericht mit beiden Unterschriften › Live-Ticker und
 *   Liga-Statistik.
 *   node tests/ligaspiel-abschluss.mjs        (TEST_PORT=… fuer einen anderen Port)
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { hashPassword } from '../server/lib/password.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT) || 38471;
const BASIS = `http://127.0.0.1:${PORT}`;
const CODE = 'abschluss-test';
const TAG = '2026-12-09';              // 6. Spieltag, auswaerts bei Treff ma nix
let geprueft = 0, fehler = 0;
function check(name, ok, info) {
  geprueft++;
  if (!ok) fehler++;
  console.log('  ' + (ok ? '✓ ' : '✗ ') + name + (ok || info === undefined ? '' : ' – ' + info));
}
async function gruppe(name, fn) {
  console.log('\n' + name);
  try { await fn(); } catch (e) { check(name + ' (Gruppe abgebrochen)', false, String(e && e.message || e).split('\n').slice(0, 3).join(' ')); }
}
const warten = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = (g, fn, arg, ms) => g.page.waitForFunction(fn, arg, { timeout: ms || 10000, polling: 100 }).then(() => true).catch(() => false);

async function geraet(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript((tag) => { window.__ligaHeute = tag; window.__ligaAnpfiff = Date.now() + 3600e3; }, TAG);
  ctx.setDefaultTimeout(10000);
  const page = await ctx.newPage();
  const g = { name, ctx, page, fehlerLog: [] };
  page.on('pageerror', (e) => g.fehlerLog.push(name + ': ' + e));
  await page.goto(BASIS + '/index.html');
  await page.waitForFunction(() => !!window.__dart);
  return g;
}
async function registriere(g, name) {
  await g.page.waitForSelector('[data-action="konto-tab-register"]');
  await g.page.locator('[data-action="konto-tab-register"]').click();
  await g.page.locator('#konto-invite').fill(CODE);
  await g.page.locator('#konto-name').fill(name);
  await g.page.locator('#konto-email').fill(name.toLowerCase() + '@abschluss.test');
  await g.page.locator('#konto-pass').fill('abschluss-passwort-1');
  await g.page.locator('[data-action="konto-register"]').click();
  await g.page.waitForFunction(() => !document.body.classList.contains('gesperrt'));
}
const zustand = (g) => g.page.evaluate(() => {
  const D = window.__dart, S = D.state(), lg = S.tour && S.tour.liga;
  /* Stand aus den Einzeln: Siege und Legs unserer vier gegen die Gegner. */
  const wir = (lg && lg.wir) || [];
  let wP = 0, sP = 0, wL = 0, sL = 0;
  S.matches.forEach((m) => {
    if (m.done && m.winner) { if (wir.indexOf(m.winner) >= 0) wP++; else sP++; }
    (m.legs || []).forEach((l) => { if (l.winner) { if (wir.indexOf(l.winner) >= 0) wL++; else sL++; } });
  });
  return { screen: S.screen, sid: S.tour && S.tour.sid, n: S.matches.length, fertig: S.matches.filter((m) => m.done).length,
    current: S.current, scheibe: S.tour && S.tour.meineScheibe, stand: [wP, sP, wL, sL].join(':'),
    ov: (D.ui().overlay || {}).type };
});
/* Ein Einzel an diesem Geraet: Ausbullen per Tipp, dann zaehlen. Der Anwurf
   wechselt je Leg; wer anwirft, gewinnt (180, 180, 141 Checkout). Gezaehlt
   wird ueber die Tasten des neuen Liga-Zaehlbilds, wo es da ist. */
async function einzelSpielen(g, mid, perTasten) {
  await g.page.evaluate((id) => window.__dart.action('open-match', { getAttribute: (n) => n === 'data-id' ? id : null }), mid);
  await bis(g, () => window.__dart.state().screen === 'bulloff' || window.__dart.state().screen === 'game');
  if (await g.page.evaluate(() => window.__dart.state().screen === 'bulloff')) {
    await g.page.locator('#screen-bulloff [data-action="pick-starter"]').first().click();
  }
  await bis(g, () => window.__dart.state().screen === 'game');
  const tippen = async (n) => {
    if (perTasten && await g.page.locator('#lz-spiel .lz-tasten button[data-key="ok"]').count()) {
      for (const c of String(n)) await g.page.locator(`#lz-spiel .lz-tasten button[data-key="${c}"]`).click();
      await g.page.locator('#lz-spiel .lz-tasten button[data-key="ok"]').click();
    } else {
      await g.page.evaluate((v) => { window.__dart.ui().input = String(v); window.__dart.submitTotal(); }, n);
    }
  };
  for (let leg = 0; leg < 3; leg++) {
    if (await g.page.evaluate(() => { const m = window.__dart.currentMatch(); return !m || m.done; })) break;
    await tippen(180); await tippen(41); await tippen(180); await tippen(41); await tippen(141);
    /* Checkout: Darts (und Doppel, falls gefragt), dann bestaetigen. */
    await g.page.locator('#overlay-card [data-action="co-darts"]').first().click();
    if (await g.page.locator('#overlay-card [data-action="co-doppel"]').count()) await g.page.locator('#overlay-card [data-action="co-doppel"]').first().click();
    if (await g.page.locator('#overlay-card [data-action="co-ok"]').count()) await g.page.locator('#overlay-card [data-action="co-ok"]').click();
    if (await g.page.locator('#overlay-card [data-action="ov-next-leg"]').count()) await g.page.locator('#overlay-card [data-action="ov-next-leg"]').click();
  }
  const ok = await g.page.evaluate((id) => !!(window.__dart.state().matches.find((m) => m.id === id) || {}).done, mid);
  /* Ergebnis-Dialog schliessen, zurueck zur Uebersicht. */
  await g.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.setScreen('tournament'); });
  return ok;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-abschluss-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DARTS_DB: path.join(tmp, 'test.db'),
      DARTS_INVITE_HASH: hashPassword(CODE), DARTS_SECURE_COOKIES: '0', DARTS_CLAIM_FRIST_MS: '3000', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => { if (!/Hinweis:|Mail .* fehlgeschlagen/.test(String(d))) process.stderr.write('  [server] ' + d); });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(BASIS + '/api/ping'); if (r.ok) break; } catch (e) { /* noch nicht */ }
      await warten(100);
    }
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
    for (const n of ['Cesar', 'Dora', 'Emil']) {
      await fetch(BASIS + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Darts-App': '1' },
        body: JSON.stringify({ invite: CODE, code: CODE, name: n, email: n.toLowerCase() + '@abschluss.test', password: 'abschluss-passwort-1' }) });
    }
    const a = await geraet(browser, 'Anton');
    const b = await geraet(browser, 'Berta');
    await registriere(a, 'Anton');
    await registriere(b, 'Berta');
    for (const g of [a, b]) { await g.page.evaluate(() => window.DartKonto.holeRoster()); await warten(300); }

    await gruppe('1. Spielplan: am Spieltag steht GAME DAY', async () => {
      for (const g of [a, b]) {
        await g.page.evaluate(() => { const D = window.__dart; D.ui().ligaTab = 'plan'; D.setScreen('liga'); });
        await bis(g, () => !!document.querySelector('#liga-karte .lg-gameday-knopf'));
      }
      check('die Spieltag-Karte zeigt den Gegner und GAME DAY', /TREFF MA NIX/i.test(await a.page.locator('#liga-karte').innerText()) &&
        await a.page.locator('#liga-karte .lg-gameday-knopf').isVisible());
      await a.page.locator('#liga-karte .lg-gameday-knopf').click();
      await b.page.locator('#liga-karte .lg-gameday-knopf').click();
      check('beide iPads stehen im Game Day bei „Wo bist du?“', await bis(a, () => !!document.querySelector('#overlay.gd .gd-wahl')) && await bis(b, () => !!document.querySelector('#overlay.gd .gd-wahl')));
      await a.page.locator('[data-action="tag-platz"][data-value="S1"]').click();
      check('Scheibe 1 am ersten iPad', await bis(a, () => (window.__dart.state().ligaTag || {}).platz === 'S1'));
      await b.page.locator('[data-action="tag-platz"][data-value="S2"]').click();
      check('Scheibe 2 am zweiten iPad', await bis(b, () => (window.__dart.state().ligaTag || {}).platz === 'S2'));
    });

    await gruppe('2. Aufstellung und Bereit', async () => {
      await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 1);
      await a.page.locator('[data-action="gd-auf"][data-value="wir"]').click();
      await a.page.waitForSelector('.gd-panel');
      /* Unsere Konten brauchen den vollen Namen fuer den Bogen. */
      const f = a.page.locator('[data-role="liga-voll-vor"]');
      for (let i = 0; i < await f.count(); i++) {
        const id = await f.nth(i).getAttribute('data-id');
        const name = await a.page.evaluate((x) => window.__dart.profile(x).name, id);
        await f.nth(i).fill(name);
        await a.page.locator(`[data-role="liga-voll-nach"][data-id="${id}"]`).fill('Abschluss');
      }
      await a.page.evaluate(() => document.activeElement && document.activeElement.blur());
      const wir = await a.page.evaluate(() => window.__dart.state().ligaTag.d.wir.filter(Boolean).length);
      check('vier eigene Spieler stehen schon drin', wir === 4, String(wir));
      await a.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('Scheibe 1 ist bereit', await bis(a, () => window.__dart.state().ligaTag.bereit));
      await b.page.locator('[data-action="gd-auf"][data-value="gegner"]').click();
      await b.page.waitForSelector('.gd-panel');
      const chips = b.page.locator('.gd-panel [data-action="gd-chip"][data-seite="gegner"]');
      check('der Kader von Treff ma nix steht als Chips da', (await chips.count()) >= 5, String(await chips.count()));
      for (let i = 0; i < 5; i++) await chips.nth(i).click();
      check('vier Gegner und ein Ersatz', await b.page.evaluate(() => { const d = window.__dart.state().ligaTag.d; return d.gegner.filter(Boolean).length === 4 && (d.gegnerE || []).filter(Boolean).length === 1; }));
      await b.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('Scheibe 2 ist bereit', await bis(b, () => window.__dart.state().ligaTag.bereit));
      check('beide sehen „Bereit!“ fuer beide Teams', await bis(a, () => document.querySelectorAll('.gd-team .gd-status.bereit').length === 2, null, 12000) &&
        await bis(b, () => document.querySelectorAll('.gd-team .gd-status.bereit').length === 2, null, 12000));
      check('die Gegner stehen am ersten iPad', await bis(a, () => window.__dart.state().ligaTag.d.gegner.filter(Boolean).length === 4));
    });

    await gruppe('3. GAME ON und LOS GEHT\'S', async () => {
      await a.page.locator('[data-action="liga-los"]').click();
      check('Scheibe 1 wartet auf Scheibe 2', await bis(a, () => /WARTE AUF SCHEIBE 2/.test(document.getElementById('overlay-card').innerText)));
      check('Scheibe 2 fragt „Kann es losgehen?“', await bis(b, () => !!document.querySelector('.gd-frage-karte [data-action="gd-los"]'), null, 15000));
      await b.page.locator('.gd-frage-karte [data-action="gd-los"]').click();
      check('beide iPads starten mit dem Ausbullen ihres ersten Einzels', await bis(a, () => window.__dart.state().screen === 'bulloff', null, 20000) &&
        await bis(b, () => window.__dart.state().screen === 'bulloff', null, 20000));
      const za = await zustand(a), zb = await zustand(b);
      check('dasselbe Ligaspiel mit 16 Einzeln, jedes iPad an seiner Scheibe', za.sid && za.sid === zb.sid && za.n === 16 && za.scheibe === 'S1' && zb.scheibe === 'S2', JSON.stringify([za, zb]));
    });

    await gruppe('4. Alle 16 Einzel, jedes an seiner Scheibe', async () => {
      const plan = await a.page.evaluate(() => window.__dart.state().matches.map((m) => ({ id: m.id, scheibe: m.scheibe, round: m.round })));
      let ok = 0, erste = { a: true, b: true };
      for (const rund of [1, 2, 3, 4]) {
        for (const m of plan.filter((x) => x.round === rund)) {
          const g = m.scheibe === 'S1' ? a : b;
          const k = g === a ? 'a' : 'b';
          if (await einzelSpielen(g, m.id, erste[k])) ok++;
          erste[k] = false;
        }
        /* Nach jedem Durchgang abgleichen - wie die beiden iPads am Abend. */
        await Promise.all([a, b].map((g) => g.page.evaluate(() => window.DartSync.turnier.abgleich(true))));
      }
      check('16 Einzel gespielt (das erste je iPad ueber die Tasten des Zaehlbilds)', ok === 16, String(ok));
      check('beide iPads kennen alle 16 Ergebnisse', await bis(a, () => window.__dart.state().matches.filter((m) => m.done).length === 16, null, 20000) &&
        await bis(b, () => window.__dart.state().matches.filter((m) => m.done).length === 16, null, 20000));
      const za = await zustand(a), zb = await zustand(b);
      check('gleicher Team-Stand auf beiden iPads', za.stand && za.stand === zb.stand, JSON.stringify([za.stand, zb.stand]));
    });

    await gruppe('5. Spielbericht mit beiden Unterschriften', async () => {
      /* Der Bericht des laufenden Ligaspiels (ohne Spieltag = das aktuelle). */
      await a.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.action('liga-bericht', { getAttribute: () => null }); });
      await bis(a, () => window.__dart.state().screen === 'bericht');
      check('der Spielbericht steht', await a.page.locator('#bericht-blatt').isVisible());
      await a.page.locator('#screen-bericht [data-action="bericht-unterschreiben"]').click();
      const malen = async () => {
        await a.page.locator('#signatur').scrollIntoViewIfNeeded();
        const box = await a.page.locator('#signatur').boundingBox();
        await a.page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
        await a.page.mouse.down();
        for (let i = 1; i <= 12; i++) await a.page.mouse.move(box.x + box.width * (0.15 + i * 0.05), box.y + box.height * (0.6 - Math.sin(i) * 0.2));
        await a.page.mouse.up();
      };
      for (const wer of ['TC Heim', 'TC Gast']) {
        await bis(a, () => !!document.getElementById('signatur'));
        await malen();
        await a.page.locator('[data-action="signatur-weiter"]').click();
        await warten(300);
      }
      check('beide Unterschriften stehen im Bericht', await bis(a, () => document.querySelectorAll('#bericht-blatt .b-unterschrift img').length === 2));
      check('der Bericht ist final', await a.page.evaluate(() => document.getElementById('bericht-blatt').classList.contains('final')));
      if (await a.page.locator('[data-action="bericht-ohne-senden"]').count()) await a.page.locator('[data-action="bericht-ohne-senden"]').click();
      check('das Ligaspiel ist abgeschlossen und im Archiv', await bis(a, () => window.__dart.state().history.some((h) => h.liga && h.liga.terminId === 'st06' && h.liga.abgeschlossen), null, 15000));
    });

    await gruppe('6. Live-Ticker und Liga-Statistik', async () => {
      const k = await b.page.evaluate(() => (window.__dart.state().tour || {}).zuschauer || '');
      if (k) {
        const zctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
        const zp = await zctx.newPage();
        await zp.goto(BASIS + '/live.html#' + k);
        await zp.waitForSelector('#ticker', { timeout: 15000 }).catch(() => {});
        check('der Live-Ticker zeigt den Endstand', /16 von 16|Endstand|beendet|fertig/i.test(await zp.locator('body').innerText()), (await zp.locator('body').innerText()).slice(0, 200));
        await zctx.close();
      } else check('der Live-Ticker hat einen Link', false, 'kein Zuschauer-Schluessel');
      await a.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.ui().ligaTab = 'statistik'; D.setScreen('liga'); });
      check('die Liga-Statistik zeigt den 6. Spieltag mit unserem Ergebnis', await bis(a, () => /6\.\s*Spieltag/.test(document.getElementById('liga-statistik').innerText), null, 10000));
      await a.page.evaluate(() => { const D = window.__dart; D.ui().ligaTab = 'plan'; D.render(); });
      check('der Spielplan zeigt das Ergebnis', /Sieg|Niederlage|Remis|\d+\s*:\s*\d+/.test(await a.page.locator('#liga-liste .liga-spieltag[data-id="st06"]').innerText()));
    });

    await gruppe('Fehlerfreiheit', async () => {
      const alle = a.fehlerLog.concat(b.fehlerLog);
      check('keine JS-Fehler', alle.length === 0, alle.join(' | '));
    });
  } finally {
    if (browser) await browser.close();
    proc.kill('SIGTERM');
    await warten(300);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Wegwerf-Ordner */ }
  }
  console.log('\n' + (fehler ? fehler + ' von ' + geprueft + ' Prüfungen fehlgeschlagen' : 'Alle ' + geprueft + ' Prüfungen bestanden'));
  process.exit(fehler ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
