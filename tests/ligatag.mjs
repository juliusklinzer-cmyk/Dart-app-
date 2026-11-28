/*
 * Game Day (DRT-080): zwei iPads bereiten das Ligaspiel gemeinsam vor und
 * starten zur Anwurfzeit von selbst. Echter Server, zwei echte Browser.
 *   node tests/ligatag.mjs
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/lib/password.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT) || 38461;
const BASIS = `http://127.0.0.1:${PORT}`;
const CODE = 'ligatag-test';
const TAG = '2026-12-09';              // 6. Spieltag, auswaerts bei Treff ma nix
let geprueft = 0, fehler = 0;
function check(name, ok, info) {
  geprueft++;
  if (!ok) fehler++;
  console.log('  ' + (ok ? '✓ ' : '✗ ') + name + (ok || info === undefined ? '' : ' – ' + info));
}
async function gruppe(name, fn) {
  if (process.env.NUR && !name.includes(process.env.NUR)) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { check(name + ' (Gruppe abgebrochen)', false, String(e && e.message || e).split('\n').slice(0, 3).join(' ')); }
}
const warten = (ms) => new Promise((r) => setTimeout(r, ms));
async function bis(g, fn, arg, ms) {
  return g.page.waitForFunction(fn, arg, { timeout: ms || 8000, polling: 100 }).then(() => true).catch(() => false);
}

async function geraet(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript((tag) => {
    window.__ligaHeute = tag;
    window.__ligaAnpfiff = Number(localStorage.getItem('testAnpfiff')) || Date.now() + 3600e3;
  }, TAG);
  ctx.setDefaultTimeout(8000);
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
  await g.page.locator('#konto-email').fill(name.toLowerCase() + '@ligatag.test');
  await g.page.locator('#konto-pass').fill('ligatag-passwort-1');
  await g.page.locator('[data-action="konto-register"]').click();
  await g.page.waitForFunction(() => !document.body.classList.contains('gesperrt'));
}
const leeren = (g) => g.page.evaluate(() => {
  const D = window.__dart, S = D.state();
  if (S.tour && S.tour.sid && window.DartSync) window.DartSync.turnier.endeId(S.tour.sid);
  S.game = null; S.matches = []; S.tour = null; S.current = null; delete S.ligaTag;
  D.ui().overlay = null; D.ui().input = ''; D.ui().darts = []; D.save(); D.setScreen('setup');
});
const anpfiff = (g, inMs) => g.page.evaluate((ms) => { window.__ligaAnpfiff = Date.now() + ms; localStorage.setItem('testAnpfiff', window.__ligaAnpfiff); }, inMs);
const tag = (g) => g.page.evaluate(() => JSON.parse(JSON.stringify(window.__dart.state().ligaTag || null)));
const oeffnen = async (g) => {
  await g.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.setScreen('setup'); });
  await g.page.locator('#beitreten-liste [data-action="tag-oeffnen"]').click();
  await g.page.waitForSelector('.overlay.liga-tag');
  await bis(g, () => window.__dart.state().ligaTag && window.__dart.state().ligaTag.geholt);
};
const platz = async (g, s) => {
  await g.page.locator('[data-action="tag-platz"][data-value="' + s + '"]').click();
  return bis(g, (x) => window.__dart.state().ligaTag.platz === x, s);
};
const vollFuellen = async (g) => {
  const f = g.page.locator('[data-role="liga-voll-vor"]');
  for (let i = 0; i < await f.count(); i++) {
    const id = await f.nth(i).getAttribute('data-id');
    await f.nth(i).fill('Vorn' + id.slice(-3));
    await g.page.locator(`[data-role="liga-voll-nach"][data-id="${id}"]`).fill('Hinten');
  }
};
const gegnerFuellen = async (g, wort) => {
  for (let i = 0; i < 4; i++) {
    await g.page.locator(`[data-role="liga-gegner"][data-i="${i}"]`).fill(wort + i);
    await g.page.locator(`[data-role="liga-gegner-nach"][data-i="${i}"]`).fill('Gegner' + i);
  }
  await g.page.evaluate(() => document.activeElement && document.activeElement.blur());
};
const imBild = (g, sel) => g.page.locator(sel).first().isVisible();

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-ligatag-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DARTS_DB: path.join(tmp, 'test.db'),
      DARTS_INVITE_HASH: hashPassword(CODE), DARTS_SECURE_COOKIES: '0', DARTS_CLAIM_FRIST_MS: '3000', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write('  [server] ' + d));
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(BASIS + '/api/ping'); if (r.ok) break; } catch (e) { /* noch nicht */ }
      await warten(100);
    }
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
    /* Vier eigene Spieler: zwei mit iPad, zwei nur mit Konto. */
    for (const n of ['Cesar', 'Dora', 'Emil']) {
      const r = await fetch(BASIS + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Darts-App': '1' },
        body: JSON.stringify({ invite: CODE, code: CODE, name: n, email: n.toLowerCase() + '@ligatag.test', password: 'ligatag-passwort-1' }) });
      if (!r.ok) console.error('  [test] Konto', n, r.status, await r.text());
    }
    const a = await geraet(browser, 'Anton');
    const b = await geraet(browser, 'Berta');
    await registriere(a, 'Anton');
    await registriere(b, 'Berta');
    for (const g of [a, b]) { await g.page.evaluate(() => window.DartKonto.holeRoster()); await warten(300); }

    await gruppe('Vorbereiten an zwei iPads', async () => {
      await a.page.evaluate(() => window.__dart.setScreen('setup'));
      check('das Startbild zeigt das Ligaspiel von heute', /Treff ma nix/.test(await a.page.locator('#beitreten-liste').innerText()));
      await oeffnen(a);
      check('der Game Day zeigt den Countdown', /^\d+:\d\d(:\d\d)?$/.test((await a.page.locator('.lt-uhr b').innerText()).trim()));
      check('ohne Scheibe wird nichts eingetragen', !(await imBild(a, '[data-role="liga-pos"]')) && !(await imBild(a, '[data-action="liga-los"]')));
      check('Scheibe 1 gewaehlt', await platz(a, 'S1'));
      check('allein traegt das iPad beide Seiten ein', await imBild(a, '[data-role="liga-pos"]') && await imBild(a, '[data-role="liga-gegner"]'));
      await oeffnen(b);
      check('am zweiten iPad steht Scheibe 1 als belegt', /iPad von/.test(await b.page.locator('.lt-plaetze').innerText()));
      check('Scheibe 2 gewaehlt', await platz(b, 'S2'));
      check('Scheibe 2 traegt nur den Gegner ein', !(await imBild(b, '[data-role="liga-pos"]')) && await imBild(b, '[data-role="liga-gegner"]'));
      await bis(a, () => !document.querySelector('#overlay-card [data-role="liga-gegner"]'));
      check('Scheibe 1 nur noch uns', await imBild(a, '[data-role="liga-pos"]') && !(await imBild(a, '[data-role="liga-gegner"]')));
      await gegnerFuellen(b, 'Vorname');
      check('die Gegner stehen am ersten iPad', await bis(a, () => /Vorname3 Gegner3/.test(document.getElementById('overlay-card').innerText)));
      const andere = await a.page.evaluate(() => { const w = window.__dart.state().ligaTag.d.wir; return [w[0], document.querySelector('[data-role="liga-pos"][data-i="0"]').options.length]; });
      check('vier eigene Spieler vorbelegt', andere[0] && andere[1] >= 5, JSON.stringify(andere));
      await a.page.locator('[data-role="liga-pos"][data-i="3"]').selectOption('__name');
      await a.page.locator('[data-role="liga-wir-vor"][data-i="3"]').fill('Gustav');
      await a.page.locator('[data-role="liga-wir-nach"][data-i="3"]').fill('Gastmann');
      await a.page.evaluate(() => document.activeElement.blur());
      check('unser Gastspieler steht am zweiten iPad, mit Status', await bis(b, () => /Gustav Gastmann/.test(document.getElementById('overlay-card').innerText) && /Gastspieler/.test(document.getElementById('overlay-card').innerText)));
      await b.page.locator('[data-action="tag-seite"][data-value="wir"]').click();
      check('Seite umschaltbar: das zweite iPad darf auch uns eintragen', await imBild(b, '[data-role="liga-pos"]'));
      await b.page.locator('[data-action="tag-seite"][data-value="gegner"]').click();
      await a.page.locator('[data-action="tag-bereit"]').click();
      check('ohne vollen Namen kein Bereit', /Vor- und Nachnamen/.test(await a.page.locator('#overlay-card .edit-error').innerText()));
      await vollFuellen(a);
      await a.page.locator('[data-action="tag-bereit"]').click();
      check('Scheibe 1 ist bereit', await bis(a, () => window.__dart.state().ligaTag.bereit));
      check('das sieht auch Scheibe 2', await bis(b, () => /bereit/.test(document.querySelectorAll('.lt-platz')[0].innerText)));
      check('bereit heisst: Aufstellung fest', await bis(a, () => !document.querySelector('#overlay-card [data-role="liga-pos"]')));
      await a.page.locator('[data-action="liga-los"]').click();
      check('zu frueh starten fragt nach', /noch nicht bereit/.test(await a.page.locator('#overlay-card .edit-error').innerText()) && !(await a.page.evaluate(() => window.__dart.state().tour)));
    });

    await gruppe('Neu melden: Unterschrift vor dem Spiel', async () => {
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click();
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click();
      await b.page.locator('[data-action="tag-bereit"]').click();
      check('wer neu zu melden ist, unterschreibt vor „Bereit“', await bis(b, () => (window.__dart.ui().overlay || {}).type === 'nachmeldung'));
      await b.page.locator('[data-action="nm-wahl"][data-feld="g"][data-value="m"]').click();
      await b.page.evaluate(() => { window.__dart.ui().overlay.striche = [[[0.1, 0.5], [0.3, 0.3], [0.5, 0.6], [0.7, 0.4], [0.8, 0.5]]]; });
      await b.page.locator('[data-action="nm-weiter"]').click();
      check('danach ist Scheibe 2 bereit', await bis(b, () => window.__dart.state().ligaTag.bereit));
      check('die Unterschrift ist am ersten iPad', await bis(a, () => { const t = window.__dart.state().ligaTag; return t.nm && t.nm.ng1 && /^data:image/.test(t.nm.ng1.unterschrift); }));
      check('und die Aufstellung sagt es', await bis(a, () => /neu, unterschrieben/.test(document.getElementById('overlay-card').innerText)));
    });

    await gruppe('Neuladen und Netzausfall', async () => {
      await a.page.reload();
      await a.page.waitForFunction(() => !!window.__dart);
      check('nach dem Neuladen steht Scheibe 1 noch, bereit', await bis(a, () => { const t = window.__dart.state().ligaTag; return t && t.platz === 'S1' && t.bereit; }));
      check('das Startbild fuehrt zurueck', await bis(a, () => /Scheibe 1 bereit/.test(document.getElementById('beitreten-liste').innerText)));
      await b.ctx.setOffline(true);
      await b.page.locator('[data-action="tag-aendern"]').click();
      check('ohne Netz sagt Scheibe 2 Bescheid', await bis(b, () => /Keine Verbindung/.test(document.getElementById('overlay-card').innerText)));
      await b.ctx.setOffline(false);
      await b.page.locator('[data-action="tag-aendern"]').click();
      check('mit Netz geht Aendern', await bis(b, () => !window.__dart.state().ligaTag.bereit));
      await b.ctx.setOffline(true);
      await b.page.locator('[data-role="liga-gegner"][data-i="0"]').fill('Offline');
      await b.page.evaluate(() => document.activeElement.blur());
      await warten(1500);
      await b.ctx.setOffline(false);
      check('offline Getipptes kommt mit dem Netz an', await bis(a, () => window.__dart.state().ligaTag.d.gegner[0] === 'Offline', null, 14000));
      await b.page.locator('[data-action="tag-bereit"]').click();
      check('wieder bereit, ohne zweite Unterschrift', await bis(b, () => window.__dart.state().ligaTag.bereit && window.__dart.ui().overlay.type === 'liga-start'));
    });

    await gruppe('20:00: beide Scheiben starten von selbst', async () => {
      await warten(800);
      await a.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.setScreen('setup'); });
      await anpfiff(a, 1200); await anpfiff(b, 1200);
      check('Scheibe 1 steht im ersten Einzel', await bis(a, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && S.screen === 'bulloff'; }, null, 12000));
      check('Scheibe 2 auch', await bis(b, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && S.screen === 'bulloff'; }, null, 15000));
      const lage = (g) => g.page.evaluate(() => {
        const D = window.__dart, S = D.state(), m = S.matches.find((x) => x.id === S.current), lg = S.tour.liga;
        return { sid: S.tour.sid, scheibe: m && m.scheibe, runde: m && m.round, platz: S.tour.meineScheibe, n: S.matches.length, tag: !!S.ligaTag,
          namen: S.tour.players.map((id) => D.profile(id).voll), typen: Object.values(lg.typen).sort(), nm: (lg.nachmeldungen || []).map((n) => n.nach + (n.unterschrift ? '!' : '')),
          heim: lg.heim, hund: lg.heimSpieler.length, nmId: (lg.nachmeldungen || []).length === 1 && lg.sie.indexOf(lg.nachmeldungen[0].id), team: (lg.nachmeldungen || [])[0] && lg.nachmeldungen[0].team };
      });
      const la = await lage(a), lb = await lage(b);
      check('es ist dasselbe Turnier', la.sid && la.sid === lb.sid && la.n === 16, JSON.stringify([la.sid, lb.sid]));
      check('jede Scheibe hat ihr eigenes Einzel im ersten Durchgang', la.scheibe === 'S1' && lb.scheibe === 'S2' && la.runde === 1 && lb.runde === 1, JSON.stringify([la, lb]));
      check('volle Namen auf beiden Geraeten', la.namen.length === 8 && la.namen.every((n) => / /.test(n || '')) && JSON.stringify(la.namen) === JSON.stringify(lb.namen), JSON.stringify([la.namen, lb.namen]));
      check('Gastspieler und Nachmeldung stehen im Spiel', JSON.stringify(la.typen) === JSON.stringify(lb.typen) && la.typen.join() === 'gast,neu', la.typen.join());
      check('die Unterschrift gehoert zum richtigen Gegner, auf beiden Geraeten', la.nm.join() === 'Gegner1!' && lb.nm.join() === 'Gegner1!' && la.nmId === 1 && la.team === 'H' && la.heim === false, JSON.stringify([la.nm, lb.nm, la.nmId, la.team]));
      check('die Vorbereitung ist weg', !la.tag && !lb.tag);
      check('genau ein offenes Turnier', await a.page.evaluate(() => window.DartSync.turnier.offen().then((l) => l.length)) === 1);
    });

    await gruppe('Verworfenes Spiel startet nicht von selbst neu', async () => {
      await leeren(a); await leeren(b);
      await warten(600);
      await oeffnen(a);
      const t = await tag(a);
      check('die Aufstellung ist noch da, die Bereit-Haken sind weg', t.d.gegner[0] === 'Offline' && !t.bereit && !t.turnier, JSON.stringify([t.d.gegner, t.bereit, t.turnier]));
      await warten(2500);
      check('nichts startet ohne Bereit', !(await a.page.evaluate(() => window.__dart.state().tour)));
    });

    await gruppe('Freies Spiel zur Anwurfzeit: warten und hinweisen', async () => {
      await leeren(a); await leeren(b);
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b);
      await bis(a, () => window.__dart.state().ligaTag.platz === 'S1'); await bis(b, () => window.__dart.state().ligaTag.platz === 'S2');
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click();   // neu -> gemeldet
      await warten(1500);
      for (const g of [a, b]) { await g.page.locator('[data-action="tag-bereit"]').click(); await bis(g, () => window.__dart.state().ligaTag.bereit); }
      await a.page.locator('[data-action="tag-zu"][data-spiel="1"]').click();
      check('vom Game Day ins freie Spiel', await a.page.evaluate(() => window.__dart.state().screen === 'setup' && !window.__dart.ui().overlay));
      await a.page.evaluate(() => {
        const D = window.__dart, S = D.state(), ids = S.profiles.slice(0, 2).map((p) => p.id);
        S.game = { id: 'frei1', kind: 'quick', start: 301, bestOf: 3, p: ids, players: ids, starter: ids[0], legs: [{ starter: ids[0], visits: [{ p: ids[0], s: 180, d: 3 }, { p: ids[1], s: 20, d: 3 }, { p: ids[0], s: 121, d: 3, c: true }], winner: ids[0] }], done: false, winner: null, started: true };
        D.setScreen('game');
      });
      await anpfiff(a, 500); await anpfiff(b, 500);
      check('Scheibe 1 bekommt einen Hinweis statt eines Wechsels', await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000));
      check('das freie Spiel laeuft noch', await a.page.evaluate(() => !!window.__dart.state().game && window.__dart.state().screen === 'game'));
      check('Scheibe 2 springt ein und startet', await bis(b, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && S.screen === 'bulloff'; }, null, 25000));
      await a.page.locator('[data-action="ov-cancel"]').click();
      check('„Noch fertig spielen“ laesst das Spiel in Ruhe', await a.page.evaluate(() => !window.__dart.ui().overlay && !!window.__dart.state().game));
      await warten(2500);
      check('und der Hinweis kommt nicht sofort wieder', await a.page.evaluate(() => !window.__dart.ui().overlay));
      await a.page.evaluate(() => { window.__dart.state().ligaTag.ruheBis = 0; });
      check('spaeter erinnert er wieder', await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000));
      await a.page.locator('[data-action="tag-wechseln"]').click();
      check('ein Tipp wechselt ins Ligaspiel an Scheibe 1', await bis(a, () => { const S = window.__dart.state(), m = S.matches.find((x) => x.id === S.current); return S.tour && S.tour.liga && S.screen === 'bulloff' && m.scheibe === 'S1'; }, null, 9000));
      check('das fertige Leg ist gespeichert', await a.page.evaluate(() => { const S = window.__dart.state(); const h = S.history.find((x) => x.id === 'frei1'); return !S.game && !!h && h.matches[0].legs.length === 1; }));
      const sids = [await a.page.evaluate(() => window.__dart.state().tour.sid), await b.page.evaluate(() => window.__dart.state().tour.sid)];
      check('wieder dasselbe Turnier', sids[0] === sids[1]);
    });

    await gruppe('Beide iPads starten im selben Moment', async () => {
      await leeren(a); await leeren(b);
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b);
      await warten(800);
      for (const g of [a, b]) { await g.page.locator('[data-action="tag-bereit"]').click(); await bis(g, () => window.__dart.state().ligaTag.bereit); }
      await bis(a, () => /bereit/.test(document.querySelectorAll('.lt-platz')[1].innerText));
      await a.page.locator('[data-action="liga-los"]').click();
      check('ein heute schon gespieltes Ligaspiel legt der erste Tipp nicht neu an', await bis(a, () => /schon gestartet/.test((window.__dart.ui().overlay || {}).fehler || '')));
      const losDb = new DatabaseSync(path.join(tmp, 'test.db')); losDb.exec('PRAGMA busy_timeout=3000'); losDb.exec('UPDATE liga_tage SET turnier_id = NULL'); losDb.close();
      await warten(300);
      await Promise.all([a, b].map((g) => g.page.evaluate(() => document.querySelector('[data-action="liga-los"]').click())));
      const ok = await Promise.all([a, b].map((g) => bis(g, () => !!window.__dart.state().tour, null, 9000)));
      const s = await Promise.all([a, b].map((g) => g.page.evaluate(() => (window.__dart.state().tour || {}).sid)));
      check('gleichzeitiger Start ergibt ein Turnier', ok[0] && ok[1] && s[0] === s[1], JSON.stringify(s));
      check('genau ein offenes', await b.page.evaluate(() => window.DartSync.turnier.offen().then((l) => l.length)) === 1);
    });

    await gruppe('Rechte und Grenzen am Server', async () => {
      await leeren(a); await leeren(b);
      const ruf = (g, pfad, body) => g.page.evaluate(([p, x]) => window.DartKonto.ruf('POST', p, x).then((d) => ({ s: 200, d })).catch((e) => ({ s: e.status, m: e.message })), [pfad, body]);
      const p = '/api/liga/tag/st06-2026-12-09';
      check('unbekannter Spieltag: 404', (await ruf(a, '/api/liga/tag/st99-2026-12-09', { geraet: 'geraet123' })).s === 404);
      const fremd = await ruf(b, p, { geraet: 'nurschauen', felder: { g0: { vor: 'Boese', nach: 'Absicht', typ: '' } }, seit: 0 });
      check('ohne Scheibe schreibt niemand, und Unterschriften gehen nicht raus', fremd.s === 200 && fremd.d.tag.felder.g0.vor === 'Offline' && !Object.keys(fremd.d.tag.felder).some((k) => k[0] === 'n'), JSON.stringify(Object.keys(fremd.d.tag.felder)));
      check('ohne Scheibe kein Start', (await ruf(b, p + '/start', { geraet: 'nurschauen' })).s === 403);
      const besetzt = await ruf(b, p, { geraet: 'nurschauen', platz: 'S1' });
      check('eine besetzte Scheibe nimmt man nicht aus Versehen', besetzt.d.belegt === true && besetzt.d.tag.meiner === null);
      check('kaputte Felder: 400', (await ruf(a, p, { geraet: 'geraet123', felder: { x: 1 } })).s === 400 && (await ruf(a, p, { geraet: 'geraet123', felder: { nw0: { unterschrift: 'javascript:1' } } })).s === 400);
      const raus = await fetch(BASIS + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Darts-App': '1' }, body: '{}' });
      check('ohne Anmeldung: 401', raus.status === 401, raus.status);
    });

    /* ---- Nachgestellte Ablaeufe aus der Kritik vom 25.11. ---- */
    const db = (fn) => { const d = new DatabaseSync(path.join(tmp, 'test.db')); d.exec('PRAGMA busy_timeout=3000'); try { return fn(d); } finally { d.close(); } };
    const reset = async () => {
      for (const g of [a, b]) await leeren(g);
      await warten(400);
      db((d) => d.exec('DELETE FROM liga_tage'));
      for (const g of [a, b]) { await anpfiff(g, 3600e3); await g.page.evaluate(() => { delete window.__dart.state().ligaTagAb; }); }
    };
    const offene = () => db((d) => d.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE status = 'offen'").get().n);
    const st = (g) => g.page.evaluate(() => { const S = window.__dart.state(), t = S.ligaTag, o = window.__dart.ui().overlay || {}; return { tour: !!S.tour, sid: S.tour && S.tour.sid, geteilt: !!(S.tour && S.tour.geteilt), screen: S.screen, ov: o.type, art: o.art, fehler: o.fehler, platz: t && t.platz, bereit: !!(t && t.bereit), wir: t && t.d.wir, geg: t && t.d.gegner, spiele: S.matches.length, hist: S.history.length }; });
    const bereit = async (g) => { await g.page.locator('[data-action="tag-bereit"]').click(); return bis(g, () => window.__dart.state().ligaTag.bereit); };
    const beide = async () => {
      await reset();
      await oeffnen(a); await platz(a, 'S1'); await oeffnen(b); await platz(b, 'S2');
      await bis(a, () => !document.querySelector('#overlay-card [data-role="liga-gegner"]'));
      await vollFuellen(a); await gegnerFuellen(b, 'Geg');
      await bis(a, () => window.__dart.state().ligaTag.d.gegner[3] === 'Geg3');
    };
    const allein = async () => {
      await reset();
      await oeffnen(a); await platz(a, 'S1'); await warten(400);
      await vollFuellen(a); await gegnerFuellen(a, 'Geg'); await warten(1800);
    };
    const schlafen = (g) => g.page.evaluate(() => { window.__versteckt = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__versteckt }); });
    const wecken = (g) => g.page.evaluate(() => { window.__versteckt = false; document.dispatchEvent(new Event('visibilitychange')); });

    await gruppe('K1: ein frueh geoeffnetes iPad ueberschreibt nichts', async () => {
      await reset();
      await oeffnen(b);
      await oeffnen(a); await platz(a, 'S1'); await warten(600);
      await gegnerFuellen(a, 'Echt');
      const alt = (await st(a)).wir;
      await a.page.locator('[data-role="liga-pos"][data-i="0"]').selectOption(alt[3]);
      await a.page.locator('[data-role="liga-pos"][data-i="3"]').selectOption(alt[0]);
      check('wer nur schaut, sieht die echte Aufstellung', await bis(b, (w) => { const d = window.__dart.state().ligaTag.d; return d.gegner[3] === 'Echt3' && d.wir[0] === w; }, alt[3], 12000));
      await platz(b, 'S2'); await warten(6000);
      const x = await st(a), y = await st(b);
      check('nach dem Waehlen der Scheibe steht auf beiden noch alles', [x, y].every((z) => z.geg.join() === 'Echt0,Echt1,Echt2,Echt3' && z.wir[0] === alt[3] && z.wir[3] === alt[0]), JSON.stringify([x.geg, y.geg, x.wir, y.wir]));
    });
    await gruppe('K2: Neuladen nach 20:00 startet nie am anderen vorbei', async () => {
      await beide(); await bereit(a);
      for (const art of ['langsam', '502']) {
        await a.page.route('**/api/me', async (r) => { if (art === '502') return r.fulfill({ status: 502, body: 'x' }); await warten(4000); await r.continue(); });
        await anpfiff(a, -5000);
        await a.page.reload(); await a.page.waitForFunction(() => !!window.__dart);
        await warten(art === '502' ? 5000 : 7000);
        check('kein eigenes Spiel (/api/me ' + art + ')', !(await st(a)).tour && (await st(a)).platz === 'S1', JSON.stringify(await st(a)));
        await a.page.unroute('**/api/me');
      }
      check('nach 502 erholt es sich ohne Neuladen', await bis(a, () => !!(window.DartKonto && window.DartKonto.nutzer()) && !window.__dart.state().ligaTag.ohneNetz));
      check('mit Verbindung wartet es auf Scheibe 2', await bis(a, () => { const S = window.__dart.state(); return S.ligaTag && S.ligaTag.platz === 'S1' && !S.tour; }));
      check('kein Turnier am Server', offene() === 0);
    });
    await gruppe('K3: kein Start aus altem Stand', async () => {
      await beide(); await bereit(a); await bereit(b);
      await schlafen(b);
      await a.page.locator('[data-action="tag-aendern"]').click(); await bis(a, () => !window.__dart.state().ligaTag.bereit);
      await anpfiff(b, -60e3); await wecken(b);
      await warten(5000);
      check('anderes iPad nicht mehr bereit: nichts startet', !(await st(b)).tour && offene() === 0, JSON.stringify(await st(b)));
      await anpfiff(b, 3600e3); await b.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.render(); });
      await bereit(a); await warten(500);
      await schlafen(b);
      await anpfiff(a, 300);
      await bis(a, () => !!window.__dart.state().tour, null, 15000);
      const sid = (await st(a)).sid;
      check('Scheibe 1 hat gestartet', !!sid);
      await leeren(a); await warten(600);
      await anpfiff(b, -3600e3);
      await b.page.route('**/api/liga/tag/st06-2026-12-09', async (r) => { await warten(2500); await r.continue(); });
      await wecken(b); await warten(7000);
      await b.page.unroute('**/api/liga/tag/st06-2026-12-09');
      check('nach dem Spiel aufgewacht: kein zweites Turnier', !(await st(b)).tour && offene() === 0, JSON.stringify(await st(b)));
    });
    await gruppe('K4: ein anderes laufendes Turnier wird nie beendet', async () => {
      const turnier = (mitSpiel) => a.page.evaluate((m) => {
        const D = window.__dart, S = D.state(), ids = S.profiles.slice(0, 3).map((p) => p.id);
        S.tour = { start: 501, bestOf: 3, players: ids };
        S.matches = [[0, 1], [0, 2], [1, 2]].map((x, i) => ({ id: 'm' + i, round: 1, p: [ids[x[0]], ids[x[1]]], starter: ids[x[0]], legs: i ? [] : [{ starter: ids[0], visits: [{ p: ids[0], s: 60, d: 3 }], winner: null }], done: false, winner: null, at: null }));
        if (m) S.game = { id: 'zw1', zwischendurch: true, kind: 'quick', start: 301, bestOf: 1, p: ids.slice(0, 2), players: ids.slice(0, 2), starter: ids[0], legs: [{ starter: ids[0], visits: [], winner: null }], done: false, winner: null, started: true };
        D.ui().overlay = null; D.save(); D.setScreen(m ? 'game' : 'tournament');
      }, mitSpiel);
      await allein(); await turnier(false); await anpfiff(a, 300);
      check('Hinweis: hier laeuft noch ein Turnier', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'turnier', null, 9000));
      await a.page.locator('[data-action="ov-cancel"]').click();
      await a.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.action('tag-oeffnen', { getAttribute: () => 'st06' }); });
      await bereit(a); await warten(300);
      await a.page.evaluate(() => { const o = window.__dart.ui().overlay; if (o && o.type === 'liga-start') window.__dart.action('liga-los', { getAttribute: () => null }); });
      await warten(1500);
      let x = await st(a);
      check('GAME ON! beendet es nicht', x.spiele === 3 && x.art === 'turnier', JSON.stringify(x));
      await allein(); await bereit(a); await turnier(true); await anpfiff(a, 300);
      await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000);
      x = await st(a);
      check('auch nicht mit einem Spiel zwischendurch', x.art === 'turnier' && x.spiele === 3, JSON.stringify(x));
      await a.page.evaluate(() => window.__dart.action('tag-wechseln', { getAttribute: () => null }));
      await warten(800);
      check('und ein Wechsel geht nicht daran vorbei', (await st(a)).spiele === 3 && await a.page.evaluate(() => !!window.__dart.state().game));
    });
    await gruppe('W1: erst nach dem Start unterschrieben', async () => {
      await beide();
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click();
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click(); await warten(1500);
      await b.page.locator('[data-action="tag-bereit"]').click(); await bis(b, () => (window.__dart.ui().overlay || {}).type === 'nachmeldung');
      await bis(a, () => window.__dart.state().ligaTag.d.gegnerTyp[1] === 'neu');
      await a.page.locator('[data-action="liga-los"]').click(); await warten(300); await a.page.locator('[data-action="liga-los"]').click();
      check('Scheibe 1 startet sofort (zweiter Tipp)', await bis(a, () => !!window.__dart.state().tour, null, 9000));
      await warten(4500);
      await b.page.locator('[data-action="nm-wahl"][data-feld="g"][data-value="m"]').click();
      await b.page.evaluate(() => { window.__dart.ui().overlay.striche = [[[0.1, 0.5], [0.3, 0.3], [0.5, 0.6], [0.7, 0.4], [0.8, 0.5]]]; });
      await b.page.locator('[data-action="nm-weiter"]').click();
      check('Scheibe 2 steigt danach ein', await bis(b, () => !!window.__dart.state().tour, null, 15000));
      check('ihre Unterschrift steht im Spiel', await bis(b, () => (window.__dart.state().tour.liga.nachmeldungen || []).length === 1));
      await a.page.evaluate(() => window.DartSync.turnier.abgleich());
      check('und kommt am ersten iPad an', await bis(a, () => (window.__dart.state().tour.liga.nachmeldungen || []).length === 1, null, 12000));
      const r = db((d) => d.prepare('SELECT plaetze, felder FROM liga_tage').get());
      check('am Server bleiben weder Haken noch Unterschrift', !/"bereit":true/.test(r.plaetze) && !/unterschrift/.test(r.felder), r.plaetze);
    });
    await gruppe('Grosse Unterschrift, abgelehnter Start, heute schon gespielt', async () => {
      await beide();
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click();
      await b.page.locator('.ls-typ[data-seite="gegner"][data-i="1"]').click(); await warten(1200);
      await b.page.locator('[data-action="tag-bereit"]').click(); await bis(b, () => (window.__dart.ui().overlay || {}).type === 'nachmeldung');
      await b.page.locator('[data-action="nm-wahl"][data-feld="g"][data-value="m"]').click();
      await b.page.evaluate(() => {
        const st = [];
        for (let s = 0; s < 14; s++) { const l = []; for (let i = 0; i < 160; i++) l.push([0.04 + i / 175 + 0.02 * Math.sin(i + s), 0.5 + 0.4 * Math.sin(i * 0.9 + s * 1.7)]); st.push(l); }
        window.__dart.ui().overlay.striche = st;
      });
      await b.page.locator('[data-action="nm-weiter"]').click();
      check('auch eine dichte Unterschrift kommt durch', await bis(b, () => window.__dart.state().ligaTag.bereit) && await b.page.evaluate(() => window.__dart.state().ligaTag.nm.ng1.unterschrift.length <= 36000), await b.page.evaluate(() => window.__dart.state().ligaTag.nm.ng1.unterschrift.length));
      await b.page.evaluate(() => { const t = window.__dart.state().ligaTag; t.nm.ng1 = Object.assign({}, t.nm.ng1, { unterschrift: 'data:image/png;base64,' + 'A'.repeat(70000) }); });
      await warten(3000);
      check('lehnt der Server eine ab, laeuft der Abgleich weiter', await bis(b, () => { const t = window.__dart.state().ligaTag; return !t.stoerung && !t.nm.ng1; }, null, 12000));
      await allein(); await bereit(a);
      await a.page.locator('[data-action="tag-zu"]').first().click();
      await a.page.route('**/start', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"fehler":"Genug fuer heute."}' }));
      await anpfiff(a, 300);
      check('lehnt der Server nur den Start ab, steht es da', await bis(a, () => /startet nicht/i.test(document.getElementById('overlay-card').innerText) && /Genug fuer heute/.test(document.getElementById('overlay-card').innerText), null, 15000));
      await a.page.unroute('**/start');
      check('und geht weiter, sobald es wieder darf', await bis(a, () => !!window.__dart.state().tour, null, 25000));
      await leeren(a); await warten(500);
      await anpfiff(a, -3600e3);
      await oeffnen(a); await a.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.setScreen('setup'); });
      await warten(6000);
      check('heute schon gespielt: keine Erinnerung an „Bereit“', !(await st(a)).ov, JSON.stringify(await st(a)));
    });
    await gruppe('W2: „Nur auf diesem iPad“ laesst keinen Haken zurueck', async () => {
      await allein(); await bereit(a);
      await a.page.route('**/api/liga/tag/**', (r) => r.abort());
      await anpfiff(a, 200);
      check('ohne Netz kommt die Frage', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'netz', null, 30000));
      await a.page.locator('[data-action="tag-nur-hier"]').click();
      check('das Spiel laeuft nur hier', await bis(a, () => { const S = window.__dart.state(); return S.tour && !S.tour.geteilt; }));
      await a.page.unroute('**/api/liga/tag/**');
      check('mit Netz faellt der Haken am Server', await bis(a, () => !window.__dart.state().ligaTagAb, null, 15000) && db((d) => d.prepare('SELECT plaetze FROM liga_tage').get().plaetze) === '{}');
      await leeren(a); await oeffnen(a); await warten(9000);
      check('verworfen und Game Day nur geoeffnet: nichts startet', !(await st(a)).tour && offene() === 0, JSON.stringify(await st(a)));
    });
    await gruppe('W3: beide bestaetigen dieselbe Seite', async () => {
      await reset();
      await oeffnen(a); await platz(a, 'S1'); await oeffnen(b); await platz(b, 'S2');
      await bis(a, () => !document.querySelector('#overlay-card [data-role="liga-gegner"]'));
      await vollFuellen(a); await bereit(a);
      await b.page.locator('[data-action="tag-seite"][data-value="wir"]').click(); await vollFuellen(b); await bereit(b);
      check('der Bildschirm sagt, welche Seite fehlt', await bis(b, () => /von Treff ma nix hat noch niemand/.test(document.getElementById('overlay-card').innerText)));
      await anpfiff(a, -20000); await anpfiff(b, -20000); await warten(3000);
      check('es startet nicht', !(await st(a)).tour && !(await st(b)).tour && offene() === 0);
      await b.page.locator('[data-action="tag-zu"]').first().click();
      await b.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.state().ligaTag.ruheBis = Date.now() + 60000; window.__dart.setScreen('players'); });
      await warten(9500);
      check('und der Dialog draengt sich nicht auf', !(await st(b)).ov, JSON.stringify(await st(b)));
    });
    await gruppe('W4: Server lehnt ab (401) - nie stumm', async () => {
      await allein(); await bereit(a);
      await a.page.locator('[data-action="tag-zu"]').first().click();
      await a.page.route('**/api/liga/tag/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"fehler":"Nicht angemeldet."}' }));
      await anpfiff(a, 300);
      check('nach 20:00 kommt ein Hinweis', await bis(a, () => /startet nicht/i.test(document.getElementById('overlay-card').innerText) && (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 30000), JSON.stringify(await st(a)));
      await a.page.unroute('**/api/liga/tag/**');
    });
    await gruppe('W5: offline Getipptes ueberlebt das Neuladen', async () => {
      await allein();
      await a.page.route('**/api/liga/tag/**', (r) => r.abort());
      await a.page.locator('[data-role="liga-gegner"][data-i="0"]').fill('OfflineName'); await a.page.evaluate(() => document.activeElement.blur());
      await warten(2500); await a.page.reload(); await a.page.waitForFunction(() => !!window.__dart);
      check('nach dem Neuladen noch da', (await st(a)).geg[0] === 'OfflineName', JSON.stringify((await st(a)).geg));
      await a.page.unroute('**/api/liga/tag/**');
      check('und kommt am Server an', await (async () => { for (let i = 0; i < 40; i++) { if (db((d) => /OfflineName/.test(d.prepare('SELECT felder FROM liga_tage').get().felder))) return true; await warten(300); } return false; })());
    });
    await gruppe('W6 bis W8: Gaeste und Kontowechsel', async () => {
      await reset(); await oeffnen(a); await platz(a, 'S1');
      const gast = await a.page.evaluate(() => {
        const D = window.__dart, S = D.state();
        S.profiles.push({ id: 'gastfrueh', name: 'Frueh', voll: 'Frueh Gast', gast: true, created: Date.now() - 13 * 3600e3, hue: 1, avatar: null });
        S.ligaTag.d.wir[3] = 'gastfrueh'; D.ui().overlay = null; D.setScreen('setup'); D.setScreen('setup');
        return S.profiles.some((p) => p.id === 'gastfrueh');
      });
      check('ein aufgestellter Gast wird abends nicht aufgeraeumt', gast);
      await a.page.evaluate(() => { window.__dart.state().ligaTag.konto = 'u_jemandanders'; });
      check('nach einem Kontowechsel faengt der Game Day neu an', await bis(a, () => !window.__dart.state().ligaTag, null, 5000));
      await a.page.evaluate(() => { const S = window.__dart.state(); S.profiles = S.profiles.filter((p) => p.id !== 'gastfrueh'); });
    });
    await gruppe('W9: haengende Anfrage sperrt nichts', async () => {
      await allein();
      let haengt = 0;
      await a.page.route('**/api/liga/tag/**', () => { haengt++; });
      await bis(a, () => window.__dart.state().ligaTag.ohneNetz, null, 25000);
      check('nach zehn Sekunden heisst es keine Verbindung', haengt > 0 && await a.page.evaluate(() => !!window.__dart.state().ligaTag.ohneNetz));
      await a.page.unroute('**/api/liga/tag/**');
      check('danach geht es weiter', await bis(a, () => !window.__dart.state().ligaTag.ohneNetz, null, 25000));
      await reset();
    });

    await gruppe('Scheibe tauschen und abmelden', async () => {
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b); await platz(a, 'S1'); await platz(b, 'S2');
      await bis(a, () => /iPad von/.test(document.querySelectorAll('.lt-platz')[1].innerText));
      await a.page.locator('[data-action="tag-platz"][data-value="S2"]').click();
      check('ein Tipp tauscht die Scheiben', await bis(a, () => window.__dart.state().ligaTag.platz === 'S2') && await bis(b, () => window.__dart.state().ligaTag.platz === 'S1', null, 9000));
      await b.page.locator('[data-action="tag-verlassen"]').click();
      check('abgemeldet: Scheibe 1 ist frei', await bis(a, () => /frei/.test(document.querySelectorAll('.lt-platz')[0].innerText), null, 9000));
      check('das verbliebene iPad traegt jetzt beide Seiten ein', await imBild(a, '[data-role="liga-pos"]') && await imBild(a, '[data-role="liga-gegner"]'));
      for (const [w, h] of [[390, 844], [820, 1180], [1180, 820], [320, 640]]) {
        await a.page.setViewportSize({ width: w, height: h });
        await warten(150);
        const eng = await a.page.evaluate(() => { const o = document.getElementById('overlay'); return [o.scrollWidth - o.clientWidth, [...document.querySelectorAll('#overlay-card button, #overlay-card input, #overlay-card select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length]; });
        check('nichts laeuft aus dem Bild bei ' + w + ' × ' + h, eng[0] <= 1 && eng[1] === 0, JSON.stringify(eng));
        if (process.env.BILDER) await a.page.screenshot({ path: path.join(process.env.BILDER, 'ligatag-' + w + '.png'), fullPage: false });
      }
      await a.page.setViewportSize({ width: 1180, height: 820 });
    });

    await gruppe('Ohne Konto: ein Geraet', async () => {
      const c = await browser.newContext({ viewport: { width: 1180, height: 820 } });
      await c.addInitScript((t) => { window.__ligaHeute = t; window.__ligaAnpfiff = Date.now() + 3600e3; }, TAG);
      const pg = await c.newPage();
      const g = { page: pg };
      pg.on('pageerror', (e) => a.fehlerLog.push('allein: ' + e));
      await pg.goto('file://' + path.join(ROOT, 'index.html'));
      await pg.waitForFunction(() => !!window.__dart);
      await pg.evaluate(() => window.__dart.setScreen('setup'));
      await pg.locator('#beitreten-liste [data-action="tag-oeffnen"]').click();
      check('kein Scheiben-Feld ohne Konto', !(await imBild(g, '.lt-plaetze')) && await imBild(g, '[data-role="liga-pos"]'));
      await gegnerFuellen(g, 'Solo');
      await pg.locator('[data-action="tag-bereit"]').click();
      check('bereit', await bis(g, () => window.__dart.state().ligaTag.bereit));
      await pg.evaluate(() => { window.__ligaAnpfiff = Date.now() + 300; });
      check('startet von selbst ins erste Einzel', await bis(g, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && !S.tour.geteilt && S.screen === 'bulloff'; }, null, 9000));
      await c.close();
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
