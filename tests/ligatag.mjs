/*
 * Game Day (DRT-080, Redesign Nov. 2026 DRT-097): zwei iPads bereiten das
 * Ligaspiel gemeinsam vor; GAME ON an einer Scheibe, die andere bestaetigt,
 * dann starten beide. Nichts startet mehr von selbst. Echter Server, zwei
 * echte Browser.
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
const ov = (g) => g.page.evaluate(() => (window.__dart.ui().overlay || {}));
const oeffnen = async (g) => {
  await g.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.setScreen('setup'); });
  await g.page.locator('#beitreten-liste [data-action="tag-oeffnen"]').click();
  await g.page.waitForSelector('#overlay.gd');
  await bis(g, () => window.__dart.state().ligaTag && window.__dart.state().ligaTag.geholt);
};
/* Den Game Day wieder vorne haben (nach Hinweisen oder Unterschrift). */
const vorne = (g) => g.page.evaluate(() => {
  const D = window.__dart, o = D.ui().overlay, t = D.state().ligaTag;
  if (o && o.type === 'liga-start' && o.tag) { if (o.panel) { o.panel = null; D.render(); } return; }
  D.ui().overlay = null; D.action('tag-oeffnen', { getAttribute: () => t.terminId });
});
const platz = async (g, s) => {
  await g.page.locator('[data-action="tag-platz"][data-value="' + s + '"]').click();
  return bis(g, (x) => window.__dart.state().ligaTag.platz === x, s);
};
const meineSeite = (g) => g.page.evaluate(() => { const t = window.__dart.state().ligaTag; return t.seite || (t.platz === 'S2' ? 'gegner' : 'wir'); });
/* Das Fenster "Aufstellung" einer Seite oeffnen. */
const auf = async (g, seite) => {
  await vorne(g);
  if (await g.page.locator('.gd-panel').count()) {
    if (await g.page.evaluate((s) => (window.__dart.ui().overlay || {}).seite === s, seite)) return;
    await g.page.locator('.gd-panel [data-action="gd-panel-zu"]').click();
  }
  await g.page.locator('[data-action="gd-auf"][data-value="' + seite + '"]').click();
  await g.page.waitForSelector('.gd-panel');
};
const neuerSpieler = async (g, name, status) => {
  await g.page.locator('.gd-panel [data-action="gd-panel"][data-value="neu"]').click();
  await g.page.locator('[data-role="gd-neu-name"]').fill(name);
  if (status === 'neu') await g.page.locator('[data-action="gd-neu-wahl"][data-feld="status"][data-value="neu"]').click();
  await g.page.locator('[data-action="gd-neu-hinzu"]').click();
  await g.page.waitForSelector('.gd-panel');
};
const vollFuellen = async (g) => {
  await auf(g, 'wir');
  const f = g.page.locator('[data-role="liga-voll-vor"]');
  for (let i = 0; i < await f.count(); i++) {
    const id = await f.nth(i).getAttribute('data-id');
    await f.nth(i).fill('Vorn' + id.slice(-3));
    await g.page.locator(`[data-role="liga-voll-nach"][data-id="${id}"]`).fill('Hinten');
  }
  await g.page.evaluate(() => document.activeElement && document.activeElement.blur());
};
/* Vier Gegner ueber "+ Spieler" (der neue Spieler ist zuerst Gastspieler;
   zwei Tipps auf den Status machen ihn wieder zum gemeldeten). */
const gegnerFuellen = async (g, wort) => {
  await auf(g, 'gegner');
  for (let i = 0; i < 4; i++) {
    await neuerSpieler(g, wort + i + ' Gegner' + i);
    await typ(g, 'gegner', i); await typ(g, 'gegner', i);
  }
};
/* Position i einer Seite neu besetzen (raus, dann neuer Spieler in die Luecke). */
const ersetzen = async (g, seite, i, name) => {
  await auf(g, seite);
  await g.page.locator(`.gd-panel [data-action="gd-raus"][data-seite="${seite}"][data-i="${i}"]`).click();
  await neuerSpieler(g, name);
  /* Gegner sind gemeldet (zwei Tipps), unser neuer Mann bleibt Gastspieler. */
  if (seite === 'gegner') { await typ(g, 'gegner', i); await typ(g, 'gegner', i); }
};
const typ = (g, seite, i) => g.page.locator(`.gd-panel [data-action="gd-typ"][data-seite="${seite}"][data-i="${i}"]`).click();
const imBild = (g, sel) => g.page.locator(sel).first().isVisible();
const bereitTippen = async (g) => { await auf(g, await meineSeite(g)); await g.page.locator('.gd-panel [data-action="tag-bereit"]').click(); };
const unterschreiben = async (g, dicht) => {
  await bis(g, () => (window.__dart.ui().overlay || {}).type === 'nachmeldung');
  await g.page.locator('[data-action="nm-wahl"][data-feld="g"][data-value="m"]').click();
  await g.page.evaluate((d) => {
    let st = [[[0.1, 0.5], [0.3, 0.3], [0.5, 0.6], [0.7, 0.4], [0.8, 0.5]]];
    if (d) { st = []; for (let s = 0; s < 14; s++) { const l = []; for (let i = 0; i < 160; i++) l.push([0.04 + i / 175 + 0.02 * Math.sin(i + s), 0.5 + 0.4 * Math.sin(i * 0.9 + s * 1.7)]); st.push(l); } }
    window.__dart.ui().overlay.striche = st;
  }, !!dicht);
  await g.page.locator('[data-action="nm-weiter"]').click();
};
const imSpiel = (g, ms) => bis(g, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && S.screen === 'bulloff'; }, null, ms || 15000);

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
      check('zuerst: Wo bist du? Scheibe 1, Scheibe 2 oder Zuschauer', /WO BIST DU/.test(await a.page.locator('#overlay-card').innerText()) &&
        (await a.page.locator('[data-action="tag-platz"]').count()) === 2 && (await a.page.locator('[data-action="gd-zuschauer"]').count()) === 1);
      check('ohne Scheibe wird nichts eingetragen', !(await imBild(a, '[data-action="gd-auf"]')) && !(await imBild(a, '[data-action="liga-los"]')));
      check('Scheibe 1 gewaehlt', await platz(a, 'S1'));
      check('der Game Day zeigt den Countdown bis 20:00', /^−?\d+:\d\d(:\d\d)?$/.test((await a.page.locator('[data-gd-uhr]').innerText()).trim()) && /bis zum Anwurf/.test(await a.page.locator('.gd-uhr').innerText()));
      check('allein traegt das iPad beide Seiten ein', (await a.page.locator('[data-action="gd-auf"]').count()) === 2);
      await oeffnen(b);
      check('am zweiten iPad steht Scheibe 1 als belegt', /iPad von/.test(await b.page.locator('.gd-wahl-drei').innerText()));
      check('Scheibe 2 gewaehlt', await platz(b, 'S2'));
      check('Scheibe 2 traegt nur den Gegner ein', (await b.page.locator('[data-action="gd-auf"]').count()) === 1 && await imBild(b, '[data-action="gd-auf"][data-value="gegner"]'));
      check('Scheibe 1 nur noch uns', await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 1 && !!document.querySelector('[data-action="gd-auf"][data-value="wir"]')));
      await gegnerFuellen(b, 'Vorname');
      check('die Gegner stehen am ersten iPad', await bis(a, () => /Vorname3 Gegner3/.test(document.getElementById('overlay-card').innerText)));
      const t = await tag(a);
      await auf(a, 'wir');
      const chips = await a.page.locator('.gd-panel [data-action="gd-chip"][data-seite="wir"]').count();
      check('vier eigene Spieler vorbelegt, der Kader steht als Chips da', t.d.wir.filter(Boolean).length === 4 && chips >= 5, JSON.stringify([t.d.wir, chips]));
      await ersetzen(a, 'wir', 3, 'Gustav Gastmann');
      check('unser Gastspieler steht am zweiten iPad, mit Status', await bis(b, () => { const d = window.__dart.state().ligaTag.d; return d.wir[3] === '__name' && d.wirNamen[3].vor === 'Gustav' && d.wirTyp[3] === 'gast'; }) &&
        await bis(b, () => /Gustav Gastmann/.test(document.getElementById('overlay-card').innerText)));
      await a.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('ohne vollen Namen kein Bereit', await bis(a, () => /Vor- und Nachnamen/.test((document.querySelector('.gd-fehler') || {}).innerText || '')));
      await vollFuellen(a);
      await a.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('Scheibe 1 ist bereit', await bis(a, () => window.__dart.state().ligaTag.bereit));
      check('das sieht auch Scheibe 2', await bis(b, () => !!document.querySelector('.gd-team .gd-status.bereit')));
      check('bereit heisst: das Fenster ist zu', await bis(a, () => !document.querySelector('.gd-panel')));
      check('GAME ON erst, wenn beide bereit sind', !(await imBild(a, '[data-action="liga-los"]')));
    });

    await gruppe('Neu melden: Unterschrift vor dem Spiel', async () => {
      await auf(b, 'gegner');
      await typ(b, 'gegner', 1); await typ(b, 'gegner', 1);
      check('der Status wechselt: gemeldet, Gastspieler, neu melden', await bis(b, () => window.__dart.state().ligaTag.d.gegnerTyp[1] === 'neu'));
      await b.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('wer neu zu melden ist, unterschreibt vor „Bereit“', await bis(b, () => (window.__dart.ui().overlay || {}).type === 'nachmeldung'));
      await unterschreiben(b);
      check('danach ist Scheibe 2 bereit', await bis(b, () => window.__dart.state().ligaTag.bereit));
      check('die Unterschrift ist am ersten iPad', await bis(a, () => { const t = window.__dart.state().ligaTag; return t.nm && t.nm.ng1 && /^data:image/.test(t.nm.ng1.unterschrift); }));
      check('und die Aufstellung sagt es', await bis(a, () => window.__dart.state().ligaTag.d.gegnerTyp[1] === 'neu'));
      await vorne(a); await vorne(b);
      check('beide bereit: GAME ON steht an beiden Scheiben', await bis(a, () => !!document.querySelector('[data-action="liga-los"]')) && await bis(b, () => !!document.querySelector('[data-action="liga-los"]')));
    });

    await gruppe('Neuladen und Netzausfall', async () => {
      await a.page.reload();
      await a.page.waitForFunction(() => !!window.__dart);
      check('nach dem Neuladen steht Scheibe 1 noch, bereit', await bis(a, () => { const t = window.__dart.state().ligaTag; return t && t.platz === 'S1' && t.bereit; }));
      check('das Startbild fuehrt zurueck', await bis(a, () => /Scheibe 1 bereit/.test(document.getElementById('beitreten-liste').innerText)));
      await b.ctx.setOffline(true);
      await vorne(b);
      await b.page.locator('[data-action="gd-auf"][data-value="gegner"]').click();
      check('ohne Netz sagt Scheibe 2 Bescheid', await bis(b, () => /Keine Verbindung/.test(document.getElementById('overlay-card').innerText)));
      await b.ctx.setOffline(false);
      await b.page.evaluate(() => { const o = window.__dart.ui().overlay; o.panel = null; window.__dart.render(); });
      await b.page.locator('[data-action="gd-auf"][data-value="gegner"]').click();
      check('mit Netz geht Aendern', await bis(b, () => !window.__dart.state().ligaTag.bereit));
      await b.ctx.setOffline(true);
      await ersetzen(b, 'gegner', 0, 'Offline Mensch');
      await warten(1500);
      await b.ctx.setOffline(false);
      check('offline Getipptes kommt mit dem Netz an', await bis(a, () => window.__dart.state().ligaTag.d.gegner[0] === 'Offline', null, 14000));
      await b.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('wieder bereit, ohne zweite Unterschrift', await bis(b, () => window.__dart.state().ligaTag.bereit && window.__dart.ui().overlay.type === 'liga-start'));
    });

    await gruppe('20:00: nichts startet von selbst, GAME ON mit Bestaetigung', async () => {
      await warten(800);
      await a.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.setScreen('setup'); });
      await anpfiff(a, 1200); await anpfiff(b, 1200);
      await warten(4500);
      check('um 20:00 startet nichts von selbst', !(await a.page.evaluate(() => !!window.__dart.state().tour)) && !(await b.page.evaluate(() => !!window.__dart.state().tour)));
      check('wer nicht am Game Day ist, bekommt den Hinweis zum Anwurf', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'anwurf', null, 12000),
        JSON.stringify(await a.page.evaluate(() => { const t = window.__dart.state().ligaTag; return { art: (window.__dart.ui().overlay || {}).art, bereit: t && t.bereit, plaetze: t && t.plaetze }; })));
      await a.page.locator('#overlay-card [data-action="tag-oeffnen"]').click();
      await a.page.waitForSelector('#overlay.gd');
      check('nach 20:00: GAME ON gross und die Uhr ueber der Zeit', await imBild(a, '.gd-gameon.gross') && /über der Zeit/.test(await a.page.locator('.gd-uhr').innerText()));
      await a.page.locator('[data-action="liga-los"]').click();
      check('GAME ON wartet auf die andere Scheibe', await bis(a, () => /WARTE AUF SCHEIBE 2/.test(document.getElementById('overlay-card').innerText)) && !(await a.page.evaluate(() => !!window.__dart.state().tour)));
      check('Scheibe 2 fragt: Kann es losgehen?', await bis(b, () => /KANN ES LOSGEHEN/.test(document.getElementById('overlay-card').innerText), null, 12000));
      await b.page.locator('.gd-frage-karte [data-action="gd-gameon-ab"]').click();
      check('„Noch nicht“: Scheibe 1 hat wieder GAME ON', await bis(a, () => !!document.querySelector('[data-action="liga-los"]') && !/WARTE AUF/.test(document.getElementById('overlay-card').innerText), null, 12000));
      await a.page.locator('[data-action="liga-los"]').click();
      await bis(b, () => !!document.querySelector('.gd-frage-karte [data-action="gd-los"]'), null, 12000);
      await b.page.locator('.gd-frage-karte [data-action="gd-los"]').click();
      check('LOS GEHT\'S: Scheibe 2 steht im ersten Einzel', await imSpiel(b));
      check('Scheibe 1 auch', await imSpiel(a));
      const lage = (g) => g.page.evaluate(() => {
        const D = window.__dart, S = D.state(), m = S.matches.find((x) => x.id === S.current), lg = S.tour.liga;
        return { sid: S.tour.sid, scheibe: m && m.scheibe, runde: m && m.round, platz: S.tour.meineScheibe, n: S.matches.length, tag: !!S.ligaTag,
          namen: S.tour.players.map((id) => D.profile(id).voll), typen: Object.values(lg.typen).sort(), nm: (lg.nachmeldungen || []).map((n) => n.nach + (n.unterschrift ? '!' : '')),
          heim: lg.heim, nmId: (lg.nachmeldungen || []).length === 1 && lg.sie.indexOf(lg.nachmeldungen[0].id), team: (lg.nachmeldungen || [])[0] && lg.nachmeldungen[0].team };
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

    /* ---- Hilfen fuer die nachgestellten Ablaeufe ---- */
    const db = (fn) => { const d = new DatabaseSync(path.join(tmp, 'test.db')); d.exec('PRAGMA busy_timeout=3000'); try { return fn(d); } finally { d.close(); } };
    const reset = async () => {
      for (const g of [a, b]) await leeren(g);
      await warten(400);
      db((d) => d.exec('DELETE FROM liga_tage'));
      for (const g of [a, b]) { await anpfiff(g, 3600e3); await g.page.evaluate(() => { delete window.__dart.state().ligaTagAb; }); }
    };
    const offene = () => db((d) => d.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE status = 'offen'").get().n);
    const st = (g) => g.page.evaluate(() => { const S = window.__dart.state(), t = S.ligaTag, o = window.__dart.ui().overlay || {}; return { tour: !!S.tour, sid: S.tour && S.tour.sid, geteilt: !!(S.tour && S.tour.geteilt), screen: S.screen, ov: o.type, art: o.art, fehler: o.fehler, platz: t && t.platz, bereit: !!(t && t.bereit), wir: t && t.d.wir, geg: t && t.d.gegner, spiele: S.matches.length, hist: S.history.length }; });
    const bereit = async (g) => { await bereitTippen(g); return bis(g, () => window.__dart.state().ligaTag.bereit); };
    const beide = async () => {
      await reset();
      await oeffnen(a); await platz(a, 'S1'); await oeffnen(b); await platz(b, 'S2');
      await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 1);
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
    const gameOn = async (von, zu) => {
      await vorne(von); await von.page.locator('[data-action="liga-los"]').click();
      await bis(zu, () => !!document.querySelector('[data-action="gd-los"]') || (window.__dart.ui().overlay || {}).art === 'gameon', null, 12000);
      if ((await ov(zu)).art === 'gameon') { await zu.page.locator('#overlay-card [data-action="tag-oeffnen"]').click(); await bis(zu, () => !!document.querySelector('[data-action="gd-los"]')); }
      await zu.page.locator('[data-action="gd-los"]').click();
    };

    await gruppe('Verworfenes Spiel startet nicht von selbst neu', async () => {
      await leeren(a); await leeren(b);
      await warten(600);
      await oeffnen(a);
      const t = await tag(a);
      check('die Aufstellung ist noch da, die Bereit-Haken sind weg', t.d.gegner[0] === 'Offline' && !t.bereit && !t.turnier, JSON.stringify([t.d.gegner, t.bereit, t.turnier]));
      await warten(2500);
      check('nichts startet ohne Bereit', !(await a.page.evaluate(() => window.__dart.state().tour)));
      const r = db((d) => d.prepare('SELECT plaetze, felder FROM liga_tage').get());
      check('am Server bleiben weder Haken, GAME ON noch Unterschrift', !/"bereit":true/.test(r.plaetze) && !/"gameOn":[1-9]/.test(r.plaetze) && !/unterschrift/.test(r.felder), r.plaetze);
    });

    await gruppe('Freies Spiel zur Anwurfzeit: hinweisen, nichts beenden', async () => {
      await leeren(a); await leeren(b);
      /* Heute schon gespielt (Gruppe davor) - ohne das hiesse GAME ON "nochmal tippen". */
      db((d) => d.exec('UPDATE liga_tage SET turnier_id = NULL'));
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b);
      await bis(a, () => window.__dart.state().ligaTag.platz === 'S1'); await bis(b, () => window.__dart.state().ligaTag.platz === 'S2');
      await auf(b, 'gegner'); await typ(b, 'gegner', 1);   // neu -> gemeldet
      await warten(1500);
      for (const g of [a, b]) await bereit(g);
      await vorne(a);
      await a.page.locator('[data-action="gd-panel"][data-value="ein"]').click();
      await a.page.locator('[data-action="tag-zu"][data-spiel="1"]').click();
      check('vom Game Day ins freie Spiel (Einstellungen: Einwerfen)', await a.page.evaluate(() => window.__dart.state().screen === 'setup' && !window.__dart.ui().overlay));
      await a.page.evaluate(() => {
        const D = window.__dart, S = D.state(), ids = S.profiles.slice(0, 2).map((p) => p.id);
        S.game = { id: 'frei1', kind: 'quick', start: 301, bestOf: 3, p: ids, players: ids, starter: ids[0], legs: [{ starter: ids[0], visits: [{ p: ids[0], s: 180, d: 3 }, { p: ids[1], s: 20, d: 3 }, { p: ids[0], s: 121, d: 3, c: true }], winner: ids[0] }], done: false, winner: null, started: true };
        D.setScreen('game');
      });
      await anpfiff(a, 500); await anpfiff(b, 500);
      check('Scheibe 1 bekommt einen Hinweis statt eines Wechsels', await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000));
      check('das freie Spiel laeuft noch', await a.page.evaluate(() => !!window.__dart.state().game && window.__dart.state().screen === 'game'));
      await a.page.locator('[data-action="ov-cancel"]').click();
      check('„Gleich“ laesst das Spiel in Ruhe', await a.page.evaluate(() => !window.__dart.ui().overlay && !!window.__dart.state().game));
      await warten(2500);
      check('und der Hinweis kommt nicht sofort wieder', await a.page.evaluate(() => !window.__dart.ui().overlay));
      await vorne(b); await b.page.locator('[data-action="liga-los"]').click();
      await a.page.evaluate(() => { window.__dart.state().ligaTag.ruheBis = 0; });
      check('GAME ON an Scheibe 2: Scheibe 1 bekommt die Frage als Hinweis', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'gameon', null, 12000));
      await a.page.locator('#overlay-card [data-action="tag-oeffnen"]').click();
      await bis(a, () => !!document.querySelector('[data-action="gd-los"]'));
      await a.page.locator('[data-action="gd-los"]').click();
      check('bestaetigt: das freie Spiel wird nicht still beendet', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'jetzt', null, 12000) && await a.page.evaluate(() => !!window.__dart.state().game));
      check('Scheibe 2 steigt ein', await imSpiel(b, 25000));
      await a.page.locator('[data-action="tag-wechseln"]').click();
      check('ein Tipp wechselt ins Ligaspiel an Scheibe 1', await bis(a, () => { const S = window.__dart.state(), m = S.matches.find((x) => x.id === S.current); return S.tour && S.tour.liga && S.screen === 'bulloff' && m.scheibe === 'S1'; }, null, 9000));
      check('das fertige Leg ist gespeichert', await a.page.evaluate(() => { const S = window.__dart.state(); const h = S.history.find((x) => x.id === 'frei1'); return !S.game && !!h && h.matches[0].legs.length === 1; }));
      const sids = [await a.page.evaluate(() => window.__dart.state().tour.sid), await b.page.evaluate(() => window.__dart.state().tour.sid)];
      check('wieder dasselbe Turnier', sids[0] === sids[1]);
    });

    await gruppe('Beide druecken GAME ON im selben Moment', async () => {
      await leeren(a); await leeren(b);
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b);
      await warten(800);
      for (const g of [a, b]) await bereit(g);
      await vorne(a); await vorne(b);
      await gameOn(a, b);
      check('ein heute schon gespieltes Ligaspiel legt die Bestaetigung nicht neu an', await bis(b, () => /schon gestartet/.test((window.__dart.ui().overlay || {}).fehler || ''), null, 12000));
      const losDb = new DatabaseSync(path.join(tmp, 'test.db')); losDb.exec('PRAGMA busy_timeout=3000'); losDb.exec('UPDATE liga_tage SET turnier_id = NULL'); losDb.close();
      await a.page.evaluate(() => window.__dart.action('gd-gameon-ab', { getAttribute: () => null }));
      await warten(1500);
      await vorne(a); await vorne(b);
      await Promise.all([a, b].map((g) => g.page.evaluate(() => document.querySelector('[data-action="liga-los"]').click())));
      const ok = await Promise.all([a, b].map((g) => bis(g, () => !!window.__dart.state().tour, null, 20000)));
      const s = await Promise.all([a, b].map((g) => g.page.evaluate(() => (window.__dart.state().tour || {}).sid)));
      check('gleichzeitiges GAME ON: Scheibe 1 startet, ein Turnier', ok[0] && ok[1] && s[0] === s[1], JSON.stringify(s));
      check('genau ein offenes', await b.page.evaluate(() => window.DartSync.turnier.offen().then((l) => l.length)) === 1);
    });

    await gruppe('Rechte und Grenzen am Server', async () => {
      await leeren(a); await leeren(b);
      const ruf = (g, pfad, body) => g.page.evaluate(([p, x]) => window.DartKonto.ruf('POST', p, x).then((d) => ({ s: 200, d })).catch((e) => ({ s: e.status, m: e.message })), [pfad, body]);
      const p = '/api/liga/tag/st06-2026-12-09';
      check('unbekannter Spieltag: 404', (await ruf(a, '/api/liga/tag/st99-2026-12-09', { geraet: 'geraet123' })).s === 404);
      const fremd = await ruf(b, p, { geraet: 'nurschauen', felder: { g0: { vor: 'Boese', nach: 'Absicht', typ: '' } }, seit: 0 });
      check('ohne Scheibe schreibt niemand, und Unterschriften gehen nicht raus', fremd.s === 200 && fremd.d.tag.felder.g0.vor !== 'Boese' && !Object.keys(fremd.d.tag.felder).some((k) => k[0] === 'n'), JSON.stringify(Object.keys(fremd.d.tag.felder)));
      check('ohne Scheibe kein Start', (await ruf(b, p + '/start', { geraet: 'nurschauen' })).s === 403);
      const besetzt = await ruf(b, p, { geraet: 'nurschauen', platz: 'S1' });
      check('eine besetzte Scheibe nimmt man nicht aus Versehen', besetzt.d.belegt === true && besetzt.d.tag.meiner === null);
      check('kaputte Felder: 400', (await ruf(a, p, { geraet: 'geraet123', felder: { x: 1 } })).s === 400 && (await ruf(a, p, { geraet: 'geraet123', felder: { nw0: { unterschrift: 'javascript:1' } } })).s === 400 &&
        (await ruf(a, p, { geraet: 'geraet123', felder: { w8: { id: '', vor: 'x', nach: 'y' } } })).s === 400 && (await ruf(a, p, { geraet: 'geraet123', felder: { nw5: { unterschrift: 'x' } } })).s === 400);
      const g7 = await ruf(b, p, { geraet: 'probe-s2-geraet', platz: 'S2', uebernehmen: true, felder: { g7: { vor: 'Ersatz', nach: 'Acht', typ: 'gast' } } });
      const g7b = g7.s === 200 ? await ruf(b, p, { geraet: 'probe-s2-geraet', felder: { g7: { vor: 'Ersatz', nach: 'Acht', typ: 'gast' } } }) : g7;
      check('Ersatz bis Position 8 geht', g7b.s === 200 && !!(g7b.d && g7b.d.tag.felder.g7) && g7b.d.tag.felder.g7.vor === 'Ersatz', JSON.stringify([g7.s, g7.m, g7b.d && g7b.d.tag && g7b.d.tag.felder.g7]));
      const goOhne = await ruf(b, p, { geraet: 'probe-s2-geraet', gameOn: true });
      check('GAME ON ohne Bereit zaehlt nicht', goOhne.s === 200 && !!goOhne.d && !(goOhne.d.tag.plaetze.S2 || {}).gameOn, JSON.stringify([goOhne.s, goOhne.m]));
      await ruf(b, p, { geraet: 'probe-s2-geraet', platz: 'keiner' });
      const raus = await fetch(BASIS + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Darts-App': '1' }, body: '{}' });
      check('ohne Anmeldung: 401', raus.status === 401, raus.status);
    });

    await gruppe('K1: ein frueh geoeffnetes iPad ueberschreibt nichts', async () => {
      await reset();
      await oeffnen(b);
      await oeffnen(a); await platz(a, 'S1'); await warten(600);
      await gegnerFuellen(a, 'Echt');
      const alt = (await st(a)).wir;
      await auf(a, 'wir');
      await a.page.locator('.gd-panel [data-action="gd-raus"][data-seite="wir"][data-i="0"]').click();
      await a.page.locator('.gd-panel [data-action="gd-raus"][data-seite="wir"][data-i="3"]').click();
      await a.page.locator(`.gd-panel [data-action="gd-chip"][data-id="${alt[3]}"]`).click();
      await a.page.locator(`.gd-panel [data-action="gd-chip"][data-id="${alt[0]}"]`).click();
      check('wer nur schaut, sieht die echte Aufstellung', await bis(b, (w) => { const d = window.__dart.state().ligaTag.d; return d.gegner[3] === 'Echt3' && d.wir[0] === w; }, alt[3], 12000));
      await vorne(b); await platz(b, 'S2'); await warten(6000);
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
    await gruppe('K3: geaenderte Aufstellung nimmt GAME ON zurueck', async () => {
      await beide(); await bereit(a); await bereit(b);
      await vorne(a); await a.page.locator('[data-action="liga-los"]').click();
      await bis(b, () => !!document.querySelector('[data-action="gd-los"]') || (window.__dart.ui().overlay || {}).art === 'gameon', null, 12000);
      await schlafen(b);
      await a.page.evaluate(() => window.__dart.action('gd-gameon-ab', { getAttribute: () => null }));
      await vorne(a); await a.page.locator('[data-action="gd-auf"][data-value="wir"]').click();
      await bis(a, () => !window.__dart.state().ligaTag.bereit);
      await anpfiff(b, -60e3); await wecken(b);
      await warten(5000);
      check('anderes iPad nicht mehr bereit: nichts startet, keine Frage mehr', !(await st(b)).tour && offene() === 0 && !(await b.page.evaluate(() => !!document.querySelector('.gd-frage-karte'))), JSON.stringify(await st(b)));
      const r = db((d) => d.prepare('SELECT plaetze FROM liga_tage').get());
      check('am Server steht kein GAME ON mehr', !/"gameOn":[1-9]/.test(r.plaetze), r.plaetze);
    });
    await gruppe('K4: ein anderes laufendes Turnier wird nie beendet', async () => {
      const turnier = (mitSpiel) => a.page.evaluate((m) => {
        const D = window.__dart, S = D.state(), ids = S.profiles.slice(0, 3).map((p) => p.id);
        S.tour = { start: 501, bestOf: 3, players: ids };
        S.matches = [[0, 1], [0, 2], [1, 2]].map((x, i) => ({ id: 'm' + i, round: 1, p: [ids[x[0]], ids[x[1]]], starter: ids[x[0]], legs: i ? [] : [{ starter: ids[0], visits: [{ p: ids[0], s: 60, d: 3 }], winner: null }], done: false, winner: null, at: null }));
        if (m) S.game = { id: 'zw1', zwischendurch: true, kind: 'quick', start: 301, bestOf: 1, p: ids.slice(0, 2), players: ids.slice(0, 2), starter: ids[0], legs: [{ starter: ids[0], visits: [], winner: null }], done: false, winner: null, started: true };
        D.ui().overlay = null; D.save(); D.setScreen(m ? 'game' : 'tournament');
      }, mitSpiel);
      await allein(); await bereit(a); await turnier(false); await anpfiff(a, 300);
      check('um 20:00 ein Hinweis, kein Start', await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000) && (await st(a)).spiele === 3);
      await a.page.locator('[data-action="ov-cancel"]').click();
      await a.page.evaluate(() => { const D = window.__dart; D.ui().overlay = null; D.action('tag-oeffnen', { getAttribute: () => 'st06' }); });
      await a.page.locator('[data-action="liga-los"]').click();
      await warten(1500);
      let x = await st(a);
      check('GAME ON beendet es nicht', x.spiele === 3 && x.art === 'turnier', JSON.stringify(x));
      await allein(); await bereit(a); await turnier(true); await anpfiff(a, 300);
      await bis(a, () => (window.__dart.ui().overlay || {}).type === 'ligatag-hinweis', null, 9000);
      x = await st(a);
      check('auch nicht mit einem Spiel zwischendurch', x.ov === 'ligatag-hinweis' && x.spiele === 3, JSON.stringify(x));
      await a.page.evaluate(() => window.__dart.action('tag-wechseln', { getAttribute: () => null }));
      await warten(800);
      check('und ein Wechsel geht nicht daran vorbei', (await st(a)).spiele === 3 && await a.page.evaluate(() => !!window.__dart.state().game));
    });
    await gruppe('Grosse Unterschrift, abgelehnter Start, heute schon gespielt', async () => {
      await beide();
      await auf(b, 'gegner'); await typ(b, 'gegner', 1); await typ(b, 'gegner', 1); await warten(1200);
      await b.page.locator('.gd-panel [data-action="tag-bereit"]').click();
      await unterschreiben(b, true);
      check('auch eine dichte Unterschrift kommt durch', await bis(b, () => window.__dart.state().ligaTag.bereit) && await b.page.evaluate(() => window.__dart.state().ligaTag.nm.ng1.unterschrift.length <= 36000), await b.page.evaluate(() => window.__dart.state().ligaTag.nm.ng1.unterschrift.length));
      await b.page.evaluate(() => { const t = window.__dart.state().ligaTag; t.nm.ng1 = Object.assign({}, t.nm.ng1, { unterschrift: 'data:image/png;base64,' + 'A'.repeat(70000) }); });
      await warten(3000);
      check('lehnt der Server eine ab, laeuft der Abgleich weiter', await bis(b, () => { const t = window.__dart.state().ligaTag; return !t.stoerung && !t.nm.ng1; }, null, 12000));
      await allein(); await bereit(a);
      await a.page.route('**/start', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"fehler":"Genug fuer heute."}' }));
      await vorne(a); await a.page.locator('[data-action="liga-los"]').click();
      check('lehnt der Server den Start ab, steht es da', await bis(a, () => /Genug fuer heute/.test(document.getElementById('overlay-card').innerText), null, 15000));
      await a.page.unroute('**/start');
      await vorne(a); await a.page.locator('[data-action="liga-los"]').click();
      if (await a.page.locator('[data-action="liga-los"]').count()) await a.page.locator('[data-action="liga-los"]').first().click().catch(() => {});
      check('und geht, sobald es wieder darf', await bis(a, () => !!window.__dart.state().tour, null, 25000));
      await leeren(a); await warten(500);
      await anpfiff(a, -3600e3);
      await oeffnen(a); await a.page.evaluate(() => { window.__dart.ui().overlay = null; window.__dart.setScreen('setup'); });
      await warten(6000);
      check('heute schon gespielt: keine Erinnerung an „Bereit“', !(await st(a)).ov, JSON.stringify(await st(a)));
    });
    await gruppe('W2: „Nur auf diesem iPad“ laesst keinen Haken zurueck', async () => {
      await allein(); await bereit(a);
      await a.page.route('**/api/liga/tag/**', (r) => r.abort());
      try {
      await anpfiff(a, 200);
      /* Seit dem Redesign startet nichts von selbst: GAME ON ohne Netz fragt. */
      await vorne(a); await a.page.locator('[data-action="liga-los"]').click();
      check('ohne Netz fragt GAME ON: weiter versuchen oder nur auf diesem iPad', await bis(a, () => (window.__dart.ui().overlay || {}).art === 'netz', null, 30000));
      await a.page.locator('[data-action="tag-nur-hier"]').click();
      check('das Spiel laeuft nur hier', await bis(a, () => { const S = window.__dart.state(); return S.tour && !S.tour.geteilt; }));
      } finally { await a.page.unroute('**/api/liga/tag/**'); }
      check('mit Netz faellt der Haken am Server', await bis(a, () => !window.__dart.state().ligaTagAb, null, 15000) && db((d) => d.prepare('SELECT plaetze FROM liga_tage').get().plaetze) === '{}');
      await leeren(a); await oeffnen(a); await warten(9000);
      check('verworfen und Game Day nur geoeffnet: nichts startet', !(await st(a)).tour && offene() === 0, JSON.stringify(await st(a)));
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
      await ersetzen(a, 'gegner', 0, 'OfflineName Gegner0');
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

    await gruppe('Abmelden, Ersatz, Einstellungen und Bildschirmgroessen', async () => {
      await anpfiff(a, 3600e3); await anpfiff(b, 3600e3);
      await oeffnen(a); await oeffnen(b); await platz(a, 'S1'); await platz(b, 'S2');
      await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 1);
      await auf(b, 'gegner');
      for (let i = 0; i < 5; i++) await neuerSpieler(b, 'Spieler' + i + ' Ersatzprobe');
      check('der fuenfte Gegner steht als Ersatz G5/H5 und kommt am anderen iPad an', await bis(a, () => { const d = window.__dart.state().ligaTag.d; return (d.gegnerE || [])[0] === 'Spieler4'; }, null, 12000) &&
        await bis(a, () => /ERSATZ/.test(document.getElementById('overlay-card').innerText)));
      await vorne(a);
      await a.page.locator('[data-action="gd-panel"][data-value="ein"]').click();
      await a.page.locator('[data-action="gd-opt"][data-k="live"][data-value="anonym"]').click();
      check('Einstellung „Live ohne Namen“ kommt an Scheibe 2 an', await bis(b, () => window.__dart.state().ligaTag.d.ohneNamen === true, null, 12000));
      await vorne(b);
      await b.page.locator('[data-action="gd-panel"][data-value="ein"]').click();
      check('an Scheibe 2 sind die Einstellungen nur zum Nachsehen', (await b.page.locator('.gd-ein-karte .gd-seg button:disabled').count()) >= 8);
      await b.page.locator('.gd-ein-karte [data-action="tag-verlassen"]').click();
      check('abgemeldet: Scheibe 2 ist frei, das verbliebene iPad traegt beide Seiten ein', await bis(a, () => document.querySelectorAll('[data-action="gd-auf"]').length === 2, null, 12000));
      await vorne(a);
      for (const [w, h] of [[390, 844], [820, 1180], [1180, 820], [320, 640]]) {
        await a.page.setViewportSize({ width: w, height: h });
        await warten(150);
        const eng = await a.page.evaluate(() => { const o = document.getElementById('overlay-card'); return [o.scrollWidth - o.clientWidth, [...document.querySelectorAll('#overlay-card button, #overlay-card input, #overlay-card select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length]; });
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
      check('keine Scheiben-Wahl ohne Konto: gleich die Seite, beide Teams hier', !(await imBild(g, '.gd-wahl')) && (await pg.locator('[data-action="gd-auf"]').count()) === 2);
      await gegnerFuellen(g, 'Solo');
      await pg.locator('.gd-panel [data-action="tag-bereit"]').click();
      check('bereit', await bis(g, () => window.__dart.state().ligaTag.bereit));
      await vorne(g);
      await pg.locator('[data-action="liga-los"]').click();
      check('GAME ON startet allein sofort ins erste Einzel', await bis(g, () => { const S = window.__dart.state(); return S.tour && S.tour.liga && !S.tour.geteilt && S.screen === 'bulloff'; }, null, 9000));
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
