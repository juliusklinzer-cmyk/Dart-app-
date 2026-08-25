/*
 * Testdaten: Bilder für die Testspieler und eine gespielte Historie.
 *
 *   node tools/demo.mjs                                    gegen localhost:3002
 *   DEMO_URL=https://darts.wirtschaftln.de node tools/demo.mjs
 *
 * Vorher müssen die Konten existieren:
 *   node server/scripts/demo.mjs
 *
 * Die Spiele werden NICHT als Datenstruktur erfunden, sondern von der App
 * selbst gespielt: das Skript ruft dieselben Funktionen auf, die auch ein
 * Fingertipp auslöst. Nur so sind Averages, Doppelquote und Rekorde
 * hinterher echte Zahlen und keine Fantasie.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.DEMO_URL || 'http://localhost:3002';
const PASSWORT = 'demoabend2026';
const NAMEN = ['Michi', 'Basti', 'Flo', 'Sven', 'Nico', 'Kevin'];
const SPIELE = Number(process.env.DEMO_SPIELE) || 20;

const pre = path.join(
  os.homedir(),
  'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe'
);

/* ---------- Bilder ---------- */

/*
 * Echte Portraits gibt es hier nicht, also erkennbar künstliche: je Spieler
 * ein eigener Farbverlauf mit Dartscheiben-Ringen und den Initialen. Sie
 * sehen nach Bild aus und nicht nach Platzhalter – genau das braucht man,
 * um ein Layout zu beurteilen.
 */
function bildBauen(page, name, hue) {
  return page.evaluate(({ name, hue }) => {
    const s = 220;
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d');

    const g = x.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, 'hsl(' + hue + ', 55%, 44%)');
    g.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ', 60%, 16%)');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);

    x.globalAlpha = 0.16;
    x.strokeStyle = '#ffffff';
    for (let r = 26; r < 160; r += 22) {
      x.lineWidth = r % 44 === 26 ? 9 : 3;
      x.beginPath();
      x.arc(s * 0.7, s * 0.3, r, 0, Math.PI * 2);
      x.stroke();
    }
    x.globalAlpha = 1;

    const init = name.slice(0, 2).toUpperCase();
    x.font = '700 92px "Barlow Condensed", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,0.4)';
    x.fillText(init, s / 2 + 3, s * 0.63 + 3);
    x.fillStyle = '#ffffff';
    x.fillText(init, s / 2, s * 0.63);

    return c.toDataURL('image/jpeg', 0.82);
  }, { name, hue });
}

/* ---------- Anmelden ---------- */

async function anmelden(page, name) {
  await page.goto(URL + '/');
  await page.waitForFunction(() => !!window.__dart);
  if (await page.evaluate(() => !!(window.DartKonto && window.DartKonto.nutzer()))) {
    await page.evaluate(() => window.DartKonto.aktion('konto-logout'));
  }
  await page.waitForSelector('[data-action="konto-login"]', { timeout: 20000 });
  await page.locator('#konto-email').fill(name.toLowerCase() + '@demo.blink180');
  await page.locator('#konto-pass').fill(PASSWORT);
  await page.locator('[data-action="konto-login"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('gesperrt'), null, { timeout: 20000 });
  if (await page.locator('[data-action="konto-zuordnung-speichern"]').count()) {
    await page.locator('[data-action="konto-zuordnung-speichern"]').click();
    await page.waitForTimeout(600);
  }
}

/* ---------- X01-Turnier ---------- */

/*
 * Gespielt über submitTotal(), also genau den Weg, den auch die
 * Punkte-Eingabe nimmt – samt Bust-Regeln und der Rückfrage, mit wie vielen
 * Darts ausgecheckt wurde.
 */
async function spieleTurnier(page, ids, start) {
  await page.evaluate(({ ids, start }) => {
    const D = window.__dart;
    const S = D.state();
    S.lineup = ids.slice();
    S.mode = '501';
    S.settings.start = start;
    S.settings.bestOf = 1;
    D.setScreen('setup');
    D.action('start-game', null);
  }, { ids, start });

  for (let spiel = 0; spiel < 40; spiel++) {
    const offen = await page.evaluate(() => {
      const D = window.__dart;
      const S = D.state();
      const m = S.matches.find((x) => !x.done && !x.void);
      if (!m) return false;
      S.current = m.id;
      m.starter = m.p[Math.random() < 0.5 ? 0 : 1];
      D.ui().overlay = null;
      D.setScreen('game');
      return true;
    });
    if (!offen) break;

    for (let zug = 0; zug < 300; zug++) {
      const weiter = await page.evaluate(() => {
        const D = window.__dart;
        const UI = D.ui();

        if (UI.overlay && UI.overlay.type === 'checkout-darts') {
          const opts = UI.overlay.options;
          D.action('co-darts', { getAttribute: () => String(opts[opts.length - 1]) });
          return true;
        }
        if (UI.overlay) UI.overlay = null;

        const m = D.currentMatch();
        if (!m || m.done) return false;
        const leg = D.activeLeg(m);
        const rest = D.remainingIn(leg, D.activePlayer(leg, m));

        /* Ein Abend im Verein: meist 26 bis 100, ab und zu ein 140er oder
           180er, im Finish-Bereich gezielt aufs Doppel. */
        let wert;
        if (rest <= 40 && rest % 2 === 0 && Math.random() < 0.4) {
          wert = rest;                                  // ausgecheckt
        } else if (rest <= 100) {
          wert = Math.max(0, rest - 2 - Math.floor(Math.random() * Math.min(38, rest - 2)));
        } else {
          const r = Math.random();
          wert = r < 0.04 ? 180 : r < 0.13 ? 140 : r < 0.36 ? 100 : 26 + Math.floor(Math.random() * 70);
        }
        if (wert > rest) wert = 26;
        if (rest - wert === 1) wert = Math.max(0, wert - 3);

        D.ui().input = String(wert);
        D.submitTotal();
        return true;
      });
      if (!weiter) break;
    }

    await page.evaluate(() => {
      const D = window.__dart;
      D.ui().overlay = null;
      D.setScreen('tournament');
    });
  }

  await page.evaluate(() => {
    const D = window.__dart;
    D.ui().overlay = null;
    D.action('finish-tournament', null);
    D.ui().overlay = null;
  });
}

/* ---------- Cricket, Round the World, Finisher ---------- */

async function spieleFrei(page, art, ids) {
  await page.evaluate(({ art, ids }) => {
    const D = window.__dart;
    const S = D.state();
    S.lineup = ids.slice();
    S.mode = art;
    // Kurze Finisher-Spiele, damit ein Demo-Lauf nicht ewig dauert.
    if (art === 'finisher') S.settings.finisherTo = 3;
    D.setScreen('setup');
    D.action('start-game', null);
    const g = D.game();
    if (g) { g.started = true; D.ui().overlay = null; D.setScreen(art); }
  }, { art, ids });

  for (let i = 0; i < 900; i++) {
    const weiter = await page.evaluate((art) => {
      const D = window.__dart;
      const g = D.game();
      if (!g || g.done) return false;
      if (D.ui().overlay) D.ui().overlay = null;

      if (art === 'cricket') {
        const st = D.cricketState();
        const pid = D.gameTurnPlayer();
        const offen = [20, 19, 18, 17, 16, 15, 25].filter((n) => (st.marks[pid][n] || 0) < 3);
        const ziel = offen.length ? offen[0] : 20;
        const r = Math.random();
        if (r < 0.34) D.cricketDart(1, 0);                       // daneben
        else if (ziel === 25) D.cricketDart(r < 0.44 ? 2 : 1, 25);
        else D.cricketDart(r < 0.5 ? 3 : r < 0.66 ? 2 : 1, ziel);
        return true;
      }

      if (art === 'rtw') {
        const st = D.rtwState();
        const ziel = st.target[D.gameTurnPlayer()];
        const r = Math.random();
        if (r < 0.42) D.rtwDart(1, 0);
        else D.rtwDart(r < 0.52 ? 3 : r < 0.68 ? 2 : 1, ziel);
        return true;
      }

      // Finisher: ein offenes Stechen zuerst entscheiden, sonst dreht die
      // Schleife leer – finisherDart() nimmt dann keine Wuerfe an.
      const rd = D.finisherRunde();
      if (rd.stechen) {
        const wer = rd.stechen.spieler[Math.floor(Math.random() * rd.stechen.spieler.length)];
        D.action('fin-stechen', { getAttribute: () => wer });
        return true;
      }
      const st = D.finisherState();
      const rest = st.rest[g.players[st.turn]];
      const weg = window.Checkout.suggest(rest, 3 - st.inVisit);
      if (weg && Math.random() < 0.42) {
        const l = weg[0];
        const m = l === 'BULL' ? 2 : l === '25' ? 1 : l[0] === 'T' ? 3 : l[0] === 'D' ? 2 : 1;
        const n = l === 'BULL' || l === '25' ? 25 : parseInt(l.slice(1), 10);
        D.finisherDart(m, n);
      } else {
        D.finisherDart(1, 0);
      }
      return true;
    }, art);
    if (!weiter) break;
  }

  await page.evaluate(() => {
    const D = window.__dart;
    D.ui().overlay = null;
    D.action('finish-game', null);
    D.ui().overlay = null;
  });
}

/* ---------- Hauptlauf ---------- */

const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 } })).newPage();
page.on('pageerror', (e) => console.log('  [Seite]', String(e).slice(0, 160)));

console.log('Bilder setzen …');
for (const name of NAMEN) {
  await anmelden(page, name);
  const hue = await page.evaluate(() => window.DartKonto.nutzer().hue || 0);
  const bild = await bildBauen(page, name, hue);
  await page.evaluate((b) => window.DartKonto.ruf('PATCH', '/api/me', { avatar: b }), bild);
  console.log('  ' + name);
}

console.log('\nAnmelden und Mitspieler holen …');
await anmelden(page, NAMEN[0]);
await page.evaluate(() => window.DartSync.jetzt());
await page.waitForTimeout(2000);

const ids = await page.evaluate((namen) => {
  const r = window.DartKonto.roster();
  return namen.map((n) => (r.find((x) => x.name === n) || {}).id).filter(Boolean);
}, NAMEN);

if (ids.length < NAMEN.length) {
  console.error('Nur ' + ids.length + ' von ' + NAMEN.length + ' Testspielern gefunden.');
  console.error('Erst laufen lassen: node server/scripts/demo.mjs');
  await browser.close();
  process.exit(1);
}

console.log('\n' + SPIELE + ' Spiele werden gespielt …');
const gruppen = [ids.slice(0, 4), ids.slice(2, 6), [ids[0], ids[2], ids[4], ids[5]]];
for (let i = 0; i < SPIELE; i++) {
  const gruppe = gruppen[i % gruppen.length];
  const art = i % 4 === 0 ? 'turnier' : i % 4 === 1 ? 'cricket' : i % 4 === 2 ? 'rtw' : 'finisher';
  process.stdout.write('  ' + String(i + 1).padStart(2) + '/' + SPIELE + '  ' + art.padEnd(9));
  if (art === 'turnier') await spieleTurnier(page, gruppe, i % 8 === 0 ? 301 : 501);
  else await spieleFrei(page, art, gruppe);
  console.log('Archiv: ' + (await page.evaluate(() => window.__dart.state().history.length)));
}

console.log('\nHochladen …');
await page.evaluate(() => window.DartSync.nachZuordnung());
for (let i = 0; i < 120; i++) {
  if ((await page.evaluate(() => window.DartSync.wartend())) === 0) break;
  await page.waitForTimeout(500);
}
const offen = await page.evaluate(() => window.DartSync.wartend());
console.log(offen === 0 ? 'Alles hochgeladen.' : 'Achtung: ' + offen + ' Spiele hängen noch.');

await browser.close();
