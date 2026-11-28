/*
 * Übungsspiel als Game Day (DRT-100, Julius 28.11.): „Gegen den nächsten
 * Gegner“ im Training simuliert den Spieltag genau so, wie er am Abend
 * läuft – Game Day öffnen, Einstellungen, Scheibe wählen, Wartebereich mit
 * Aufstellung, BEREIT, GAME ON und „LOS GEHT'S“ –, aber als Übungsspiel:
 * eigener Game Day am Server (Kennung …-p), nichts zählt für die Liga, kein
 * öffentlicher Live-Link, der echte Spieltag bleibt unberührt.
 * Zwei iPads, echter Server, zwei Browser.
 *   node tests/ligatag-probe.mjs        (TEST_PORT=… fuer einen anderen Port)
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { hashPassword } from '../server/lib/password.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT) || 38491;
const BASIS = `http://127.0.0.1:${PORT}`;
const CODE = 'probe-test';
const HEUTE = '2026-11-28';            // vor dem 6. Spieltag (09.12., Treff ma nix)
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
  await ctx.addInitScript((tag) => { window.__ligaHeute = tag; window.__ligaAnpfiff = Date.now() + 3600e3; }, HEUTE);
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
  await g.page.locator('#konto-email').fill(name.toLowerCase() + '@probe.test');
  await g.page.locator('#konto-pass').fill('probe-passwort-1');
  await g.page.locator('[data-action="konto-register"]').click();
  await g.page.waitForFunction(() => !document.body.classList.contains('gesperrt'));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-probe-'));
  const dbDatei = path.join(tmp, 'test.db');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DARTS_DB: dbDatei,
      DARTS_INVITE_HASH: hashPassword(CODE), DARTS_SECURE_COOKIES: '0', NODE_ENV: 'test' },
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
        body: JSON.stringify({ invite: CODE, code: CODE, name: n, email: n.toLowerCase() + '@probe.test', password: 'probe-passwort-1' }) });
    }
    const a = await geraet(browser, 'Anton');
    const b = await geraet(browser, 'Berta');
    await registriere(a, 'Anton');
    await registriere(b, 'Berta');
    for (const g of [a, b]) { await g.page.evaluate(() => window.DartKonto.holeRoster()); await warten(300); }

    await gruppe('1. Training › Gegen den nächsten Gegner öffnet den Game Day', async () => {
      for (const g of [a, b]) {
        await g.page.evaluate(() => { const D = window.__dart; D.ui().ligaTab = 'training'; D.setScreen('liga'); });
        await bis(g, () => !!document.querySelector('[data-action="uebung-start"][data-gegner="liga"]'));
      }
      check('im Training steht „Gegen den nächsten Gegner“ mit Treff ma nix',
        /treff ma nix/i.test(await a.page.locator('[data-action="uebung-start"][data-gegner="liga"]').innerText()));
      await a.page.locator('[data-action="uebung-start"][data-gegner="liga"]').click();
      await b.page.locator('[data-action="uebung-start"][data-gegner="liga"]').click();
      check('kein alter Startbildschirm, sondern der Game Day mit „Wo bist du?“',
        await bis(a, () => !!document.querySelector('#overlay.gd .gd-wahl') && window.__dart.ui().overlay.type === 'liga-start' && window.__dart.ui().overlay.tag === true) &&
        await bis(b, () => !!document.querySelector('#overlay.gd .gd-wahl')));
      check('als Probe gekennzeichnet, mit dem Gegner des nächsten Spieltags', await a.page.evaluate(() => {
        const t = window.__dart.state().ligaTag; return !!t && t.probe === true && t.terminId === 'st06' && t.id === 'st06-2026-11-28-p';
      }));
      check('der Game Day sagt, dass es eine Probe ist', /probe|übung/i.test(await a.page.locator('#overlay-card').innerText()));
      await a.page.locator('[data-action="tag-platz"][data-value="S1"]').click();
      check('Scheibe 1 am ersten iPad', await bis(a, () => (window.__dart.state().ligaTag || {}).platz === 'S1'));
      await b.page.locator('[data-action="tag-platz"][data-value="S2"]').click();
      check('Scheibe 2 am zweiten iPad', await bis(b, () => (window.__dart.state().ligaTag || {}).platz === 'S2'));
    });

    await gruppe('2. Wartebereich: Teams aufstellen, Bereit', async () => {
      await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 1);
      await a.page.locator('[data-action="gd-auf"][data-value="wir"]').click();
      await a.page.waitForSelector('.gd-panel');
      const f = a.page.locator('[data-role="liga-voll-vor"]');
      for (let i = 0; i < await f.count(); i++) {
        const id = await f.nth(i).getAttribute('data-id');
        const name = await a.page.evaluate((x) => window.__dart.profile(x).name, id);
        await f.nth(i).fill(name);
        await a.page.locator(`[data-role="liga-voll-nach"][data-id="${id}"]`).fill('Probe');
      }
      await a.page.evaluate(() => document.activeElement && document.activeElement.blur());
      await a.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('Scheibe 1 ist bereit', await bis(a, () => window.__dart.state().ligaTag.bereit));
      await b.page.locator('[data-action="gd-auf"][data-value="gegner"]').click();
      await b.page.waitForSelector('.gd-panel');
      const chips = b.page.locator('.gd-panel [data-action="gd-chip"][data-seite="gegner"]');
      check('der Kader des nächsten Gegners steht als Chips da', (await chips.count()) >= 4, String(await chips.count()));
      for (let i = 0; i < 4; i++) await chips.nth(i).click();
      await b.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('Scheibe 2 ist bereit', await bis(b, () => window.__dart.state().ligaTag.bereit));
      check('beide sehen „Bereit!“ für beide Teams', await bis(a, () => document.querySelectorAll('.gd-team .gd-status.bereit').length === 2, null, 12000) &&
        await bis(b, () => document.querySelectorAll('.gd-team .gd-status.bereit').length === 2, null, 12000));
    });

    await gruppe('3. GAME ON: beide starten als Übungsspiel', async () => {
      await a.page.locator('[data-action="liga-los"]').click();
      check('Scheibe 2 fragt „Kann es losgehen?“', await bis(b, () => !!document.querySelector('.gd-frage-karte [data-action="gd-los"]'), null, 15000));
      await b.page.locator('.gd-frage-karte [data-action="gd-los"]').click();
      check('beide iPads starten mit dem Ausbullen', await bis(a, () => window.__dart.state().screen === 'bulloff', null, 20000) &&
        await bis(b, () => window.__dart.state().screen === 'bulloff', null, 20000));
      const z = await Promise.all([a, b].map((g) => g.page.evaluate(() => { const S = window.__dart.state(); return { sid: S.tour.sid, lg: S.tour.liga, n: S.matches.length, scheibe: S.tour.meineScheibe }; })));
      check('dasselbe geteilte Spiel, 16 Einzel, jedes iPad an seiner Scheibe', z[0].sid && z[0].sid === z[1].sid && z[0].n === 16 && z[0].scheibe === 'S1' && z[1].scheibe === 'S2', JSON.stringify(z.map((x) => [x.sid, x.n, x.scheibe])));
      check('es ist ein Übungsspiel gegen den nächsten Gegner (zählt nicht)', z.every((x) => x.lg.uebung === true && x.lg.terminId === 'st06' && /treff ma nix/i.test(x.lg.gegner)));
      check('kein öffentlicher Live-Link für die Probe', await (async () => {
        const r = await fetch(BASIS + '/api/liga/tabelle'); const j = await r.json(); return !j.live;
      })());
      const d = new DatabaseSync(dbDatei);
      const ids = d.prepare('SELECT id FROM liga_tage').all().map((x) => x.id);
      d.close();
      check('am Server ein eigener Game Day für die Probe, der echte Spieltag bleibt leer', ids.length === 1 && /^st06-2026-11-28-p/.test(ids[0]), ids.join(','));
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
