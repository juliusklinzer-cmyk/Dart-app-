/*
 * Durchstich-Test: zwei Accounts, ein gemeinsames Spiel, geteilte Statistik.
 *
 * Aufruf: node tests/konto.mjs
 *
 * Gespielt wird durch die echte Oberflaeche, angemeldet ueber die echten
 * Formulare, abgeglichen ueber den echten Server. Zwei Browser-Kontexte
 * stehen fuer zwei Geraete -- sie teilen sich nichts, auch keinen
 * localStorage.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { hashPassword } from '../server/lib/password.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.TEST_PORT) || 3198;
const BASIS = 'http://127.0.0.1:' + PORT;
const CODE = 'turnier-einladung';

let fehler = 0;
let geprueft = 0;

function group(titel) {
  console.log('\n' + titel);
}
function check(was, bedingung, zusatz) {
  geprueft++;
  if (bedingung) console.log('  ✓ ' + was);
  else {
    fehler++;
    console.log('  ✗ ' + was + (zusatz ? '  ' + zusatz : ''));
  }
}

async function warteAufServer(proc) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Server ist beim Start abgestuerzt.');
    try {
      const res = await fetch(BASIS + '/api/ping');
      if (res.ok) return;
    } catch (e) { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server kam nicht hoch.');
}

/*
 * Ein Geraet: eigener Browser-Kontext, eigener localStorage.
 *
 * `altbestand` simuliert ein Geraet, auf dem schon vor der Anmeldepflicht
 * gespielt wurde -- genau Julius' Lage. Der Stand wird vor dem ersten Laden
 * hineingeschrieben, so wie ihn die App damals hinterlassen haette.
 */
async function geraet(browser, name, altbestand) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (altbestand) {
    await ctx.addInitScript((stand) => {
      localStorage.setItem('dart-turnier-v1', JSON.stringify(stand));
    }, altbestand);
  }
  const page = await ctx.newPage();
  const fehlerLog = [];
  page.on('pageerror', (e) => fehlerLog.push(name + ': ' + e));
  await page.goto(BASIS + '/');
  await page.waitForFunction(() => !!window.__dart);
  return { name, ctx, page, fehlerLog };
}

/* mitZuordnung: nur wenn auf dem Geraet noch Profile mit eigener Historie
   liegen. Auf einem frischen Geraet gibt es nichts zuzuordnen -- die vier
   Startspieler sind dort schon weg, bevor der erste Bildschirm steht. */
async function registriere(g, anzeigename, email, passwort, mitZuordnung) {
  // Kein Klick auf die Navigation noetig: vor der Anmeldung ist sie aus, und
  // der Anmeldebildschirm steht ohnehin schon da.
  await g.page.waitForSelector('[data-action="konto-tab-register"]', { timeout: 10000 });
  await g.page.locator('[data-action="konto-tab-register"]').click();
  await g.page.locator('#konto-invite').fill(CODE);
  await g.page.locator('#konto-name').fill(anzeigename);
  await g.page.locator('#konto-email').fill(email);
  await g.page.locator('#konto-pass').fill(passwort);
  await g.page.locator('[data-action="konto-register"]').click();
  if (mitZuordnung) {
    await g.page.waitForSelector('[data-action="konto-zuordnung-speichern"]', { timeout: 10000 });
  } else {
    // Ohne Zuordnung geht es direkt in die App: die Schranke faellt.
    await g.page.waitForFunction(
      () => !document.body.classList.contains('gesperrt'), null, { timeout: 10000 });
  }
}

async function zuordnungUebernehmen(g) {
  await g.page.locator('[data-action="konto-zuordnung-speichern"]').click();
  await g.page.waitForSelector('[data-action="konto-logout"]', { timeout: 10000 });
}

/* Cricket zu zweit bis zum Sieg des ersten Spielers -- kuerzester echter
   Spielablauf, den die App kennt. */
async function cDart(page, label) {
  if (label === 'MISS') return page.locator('#cricket-grid [data-num="0"]').click();
  const mult = label[0] === 'T' ? 3 : label[0] === 'D' ? 2 : 1;
  const num = parseInt(label.replace(/^[TDS]/, ''), 10);
  return page.locator(`#cricket-grid button[data-num="${num}"][data-mult="${mult}"]`).click();
}

async function spieleCricket(page) {
  await page.locator('[data-action="set-mode"][data-value="cricket"]').click();
  await page.locator('[data-action="start-game"]').click();
  if (await page.locator('[data-action="start-order"]').count()) {
    await page.locator('[data-action="start-order"]').click();
  } else {
    await page.locator('#bulloff-buttons button').first().click();
  }
  await page.waitForSelector('#screen-cricket.active');

  await cDart(page, 'T20'); await cDart(page, 'T19'); await cDart(page, 'T18');
  for (const _ of [1, 2, 3]) await cDart(page, 'MISS');
  await cDart(page, 'T17'); await cDart(page, 'T16'); await cDart(page, 'T15');
  for (const _ of [1, 2, 3]) await cDart(page, 'MISS');
  await cDart(page, 'D25'); await cDart(page, 'S25');

  await page.locator('#overlay-card [data-action="open-summary"]').click();
  await page.locator('#summary-actions [data-action="finish-game"]').click();
}

/* Wartet, bis die Warteschlange leer ist (oder gibt auf). */
async function warteAufUpload(page, sekunden) {
  for (let i = 0; i < sekunden * 10; i++) {
    const offen = await page.evaluate(() => (window.DartSync ? window.DartSync.wartend() : 0));
    if (offen === 0) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-konto-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DARTS_DB: path.join(tmp, 'test.db'),
      DARTS_INVITE_HASH: hashPassword(CODE),
      DARTS_SECURE_COOKIES: '0',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write('  [server] ' + d));

  const preinstalled = path.join(
    os.homedir(),
    'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe'
  );
  let browser;

  try {
    await warteAufServer(proc);
    browser = await chromium.launch(fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});

    const julius = await geraet(browser, 'Julius');
    const tobi = await geraet(browser, 'Tobi');

    group('Ohne Anmeldung kommt niemand in die App');
    await julius.page.waitForSelector('[data-action="konto-login"]', { timeout: 10000 });
    check('Anmeldebildschirm steht sofort da', await julius.page.locator('#screen-konto').isVisible());
    check('Navigation ist aus', await julius.page.locator('#nav').isHidden());
    check('kein Blick aufs Turnier', await julius.page.locator('#screen-setup').isHidden());
    check('kein Blick auf die Rangliste', await julius.page.locator('#screen-boards').isHidden());
    check('kein Blick auf die Spieler', await julius.page.locator('#screen-players').isHidden());
    check('Schranke ist gesetzt', await julius.page.evaluate(() => document.body.classList.contains('gesperrt')));
    check('DartKonto vorhanden', await julius.page.evaluate(() => !!window.DartKonto));
    check('DartSync vorhanden', await julius.page.evaluate(() => !!window.DartSync));

    group('Mannschaftslogo');
    await julius.page.waitForSelector('.konto-logo img');
    check('Logo steht über dem Login', await julius.page.locator('.konto-logo img').isVisible());
    /* `complete` allein reicht nicht – ein kaputtes Bild ist auch "complete".
       naturalWidth > 0 heisst: wirklich dekodiert. Das Bild laedt mit
       decoding="async", also darauf warten statt blind nachzuschauen. */
    const logoDa = await julius.page
      .waitForFunction(() => {
        const i = document.querySelector('.konto-logo img');
        return !!i && i.complete && i.naturalWidth > 0;
      }, null, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check('Logo ist wirklich geladen', logoDa);
    const iconAntwort = await julius.page.evaluate(async () => {
      const res = await fetch('icons/icon-192.webp');
      return { ok: res.ok, typ: res.headers.get('content-type') };
    });
    check('App-Icon wird ausgeliefert', iconAntwort.ok === true);
    check('mit richtigem Inhaltstyp', iconAntwort.typ === 'image/webp', String(iconAntwort.typ));
    const manifest = await julius.page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
    check('Manifest trägt den Mannschaftsnamen', manifest.short_name === 'Blink 180', manifest.short_name);
    check('Manifest hat ein maskable-Icon',
      manifest.icons.some((i) => i.purpose === 'maskable'));

    group('Registrierung mit falschem Code');
    await julius.page.locator('[data-action="konto-tab-register"]').click();
    await julius.page.locator('#konto-invite').fill('falsch');
    await julius.page.locator('#konto-name').fill('Julius');
    await julius.page.locator('#konto-email').fill('julius@example.de');
    await julius.page.locator('#konto-pass').fill('turnierabend2026');
    await julius.page.locator('[data-action="konto-register"]').click();
    await julius.page.waitForTimeout(400);
    check('Fehlermeldung erscheint',
      (await julius.page.locator('#konto-meldung').textContent()).includes('Einladungscode'));
    check('kein Account angelegt', await julius.page.evaluate(() => !window.DartKonto.nutzer()));

    group('Registrierung, beide Geräte');
    /*
     * Die vier Startspieler (Lenas, Tobi, Domi, Julius) sind ein Erbe aus der
     * Zeit ohne Login. Sobald ein Dart-Server antwortet, kommt der Kader von
     * dort – und niemand soll beim ersten Anmelden gefragt werden, welcher
     * von vier Erfundenen er ist.
     */
    check('die Startspieler sind schon vor dem Anmelden weg',
      (await julius.page.evaluate(() => window.__dart.state().profiles.length)) === 0,
      JSON.stringify(await julius.page.evaluate(() =>
        window.__dart.state().profiles.map((p) => p.name))));

    await registriere(julius, 'Julius', 'julius@example.de', 'turnierabend2026');
    check('kein Zuordnungs-Schirm auf einem frischen Gerät',
      (await julius.page.locator('[data-action="konto-zuordnung-speichern"]').count()) === 0);
    const nachher = await julius.page.evaluate(() => window.__dart.state().profiles);
    check('Julius ist jetzt ein Account',
      nachher.some((p) => p.name === 'Julius' && p.id.indexOf('u_') === 0));
    check('kein Profil doppelt',
      new Set(nachher.map((p) => p.id)).size === nachher.length);
    check('nur der eigene Account steht in der Liste', nachher.length === 1,
      'waren: ' + nachher.length);
    check('kein Gast dabei', nachher.filter((p) => p.gast).length === 0);

    group('Nach der Anmeldung ist die App offen');
    check('Schranke ist gefallen',
      !(await julius.page.evaluate(() => document.body.classList.contains('gesperrt'))));
    check('Navigation ist da', await julius.page.locator('#nav').isVisible());
    check('Konto-Knopf sichtbar', await julius.page.locator('#nav-konto').isVisible());
    await julius.page.locator('#nav [data-screen="setup"]').click();
    check('Turnier-Bildschirm erreichbar', await julius.page.locator('#screen-setup').isVisible());

    group('X01 mit 301, 501 und 701');
    check('Modus heisst X01',
      (await julius.page.locator('#mode-select button[data-value="501"] .mt').textContent()).trim() === 'X01 Turnier');
    check('drei Startpunkte zur Wahl',
      (await julius.page.locator('[data-setting="start"] button').count()) === 3);
    await julius.page.locator('[data-setting="start"] button[data-value="701"]').click();
    check('701 laesst sich waehlen',
      (await julius.page.evaluate(() => window.__dart.state().settings.start)) === 701);
    await julius.page.reload();
    await julius.page.waitForFunction(() => !!window.__dart && !document.body.classList.contains('gesperrt'));
    check('701 uebersteht einen Neustart',
      (await julius.page.evaluate(() => window.__dart.state().settings.start)) === 701);
    await julius.page.locator('[data-setting="start"] button[data-value="501"]').click();

    await registriere(tobi, 'Tobi', 'tobi@example.de', 'dreifachzwanzig');
    check('Tobi ist angemeldet',
      await tobi.page.evaluate(() => window.DartKonto.nutzer().name === 'Tobi'));

    group('Kollegen tauchen ohne Neuladen auf');
    // Nach dem Anmelden landet man im Turnier, nicht im Konto – also hin.
    await julius.page.locator('#nav-konto').click();
    await julius.page.evaluate(() => window.DartSync.jetzt());
    await julius.page.waitForTimeout(600);
    check('Julius sieht Tobis Account', await julius.page.evaluate(() =>
      window.DartKonto.roster().some((r) => r.name === 'Tobi')));
    const tobiId = await julius.page.evaluate(() =>
      window.DartKonto.roster().find((r) => r.name === 'Tobi').id);
    const juliusId = await julius.page.evaluate(() => window.DartKonto.nutzer().id);

    /*
     * Der Fehler vom 24.08.2026: Ein hochgeladenes Profilbild war nach dem
     * naechsten Abgleich weg. Es wurde nur lokal gespeichert, und
     * rosterInProfile() hat es danach mit dem leeren Serverwert ueberschrieben.
     */
    group('Profilbild bleibt');
    await julius.page.locator('#nav [data-screen="setup"]').click();
    check('eigenes Profil ist bearbeitbar',
      (await julius.page.locator('.roster-item[data-id="' + juliusId + '"] .edit').count()) === 1);
    check('fremdes Profil nicht',
      (await julius.page.locator('.roster-item[data-id="' + tobiId + '"] .edit').count()) === 0);

    await julius.page.locator('.roster-item[data-id="' + juliusId + '"] .edit').click();
    await julius.page.locator('#avatar-input').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      // 1x1-PNG; readAvatar() skaliert es ohnehin auf 220x220 JPEG.
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
    });
    await julius.page.waitForFunction(() => {
      const o = window.__dart.ui().overlay;
      return o && o.draft && !!o.draft.avatar;
    }, null, { timeout: 10000 });
    await julius.page.locator('[data-action="save-profile"]').click();

    const bildLokal = await julius.page.evaluate((id) => {
      const p = window.__dart.state().profiles.find((x) => x.id === id);
      return p && p.avatar ? p.avatar.slice(0, 22) : null;
    }, juliusId);
    check('Bild ist lokal gespeichert', bildLokal === 'data:image/jpeg;base64', String(bildLokal));

    // Genau der Moment, in dem es vorher verschwunden ist.
    await julius.page.evaluate(() => window.DartSync.jetzt());
    await julius.page.waitForTimeout(1200);
    check('Bild überlebt den Abgleich', await julius.page.evaluate((id) => {
      const p = window.__dart.state().profiles.find((x) => x.id === id);
      return !!(p && p.avatar);
    }, juliusId));

    await julius.page.reload();
    await julius.page.waitForFunction(() => !!window.__dart && !document.body.classList.contains('gesperrt'));
    check('Bild überlebt einen Neustart', await julius.page.evaluate((id) => {
      const p = window.__dart.state().profiles.find((x) => x.id === id);
      return !!(p && p.avatar);
    }, juliusId));

    // Und es liegt wirklich beim Server, nicht nur im Browser.
    check('Bild ist beim Server angekommen', await julius.page.evaluate(async () => {
      const res = await fetch('/api/me', { headers: { 'X-Darts-App': '1' } });
      const d = await res.json();
      return !!(d.nutzer && d.nutzer.avatar);
    }));

    check('Tobi sieht Julius mit Bild', await tobi.page.evaluate(async (id) => {
      await window.DartSync.jetzt();
      const p = window.__dart.state().profiles.find((x) => x.id === id);
      return !!(p && p.avatar);
    }, juliusId));

    group('Julius schreibt für beide mit');
    await julius.page.evaluate(([a, b]) => {
      const S = window.__dart.state();
      S.lineup = [a, b];
      window.__dart.setScreen('setup');
    }, [juliusId, tobiId]);
    check('Aufstellung sind zwei Accounts',
      (await julius.page.evaluate(() => window.__dart.state().lineup)).length === 2);
    await spieleCricket(julius.page);
    check('Spiel liegt im Archiv',
      (await julius.page.evaluate(() => window.__dart.state().history.length)) === 1);
    check('Warteschlange wurde geleert', await warteAufUpload(julius.page, 10));

    group('Tobi bekommt das Spiel auf sein Gerät');
    // Nach dem Anmelden steht man im Turnier, nicht im Konto -- also hin.
    await tobi.page.locator('#nav-konto').click();
    await tobi.page.evaluate(() => window.DartSync.jetzt());
    await tobi.page.waitForTimeout(1200);
    const tobiHist = await tobi.page.evaluate(() => window.__dart.state().history);
    check('Spiel ist angekommen', tobiHist.length === 1, 'Historie: ' + tobiHist.length);
    check('mit allen Würfen', tobiHist[0] && Array.isArray(tobiHist[0].throws) && tobiHist[0].throws.length > 0);
    check('Herkunft ist vermerkt', tobiHist[0] && tobiHist[0].von === 'Julius');
    const tobiCar = await tobi.page.evaluate(() => window.__dart.career());
    check('Tobis Karriere zählt das Spiel', tobiCar[tobiId] && tobiCar[tobiId].cricketGames === 1,
      JSON.stringify(tobiCar[tobiId] && tobiCar[tobiId].cricketGames));
    check('Julius steht bei Tobi als Sieger',
      tobiCar[juliusId] && tobiCar[juliusId].cricketWins === 1);

    group('Ohne Netz wird weitergespielt');
    await julius.ctx.setOffline(true);
    await julius.page.evaluate(([a, b]) => {
      const S = window.__dart.state();
      S.lineup = [a, b];
      window.__dart.setScreen('setup');
    }, [juliusId, tobiId]);
    await spieleCricket(julius.page);
    check('zweites Spiel ist trotzdem gespeichert',
      (await julius.page.evaluate(() => window.__dart.state().history.length)) === 2);
    await julius.page.waitForTimeout(500);
    check('es wartet auf den Upload',
      (await julius.page.evaluate(() => window.DartSync.wartend())) === 1);
    check('die Statuszeile sagt das auch', await julius.page.locator('#sync-status').isVisible());

    await julius.ctx.setOffline(false);
    await julius.page.evaluate(() => window.DartSync.jetzt());
    check('nach der Rückkehr ins Netz geht es raus', await warteAufUpload(julius.page, 15));
    check('Statuszeile verschwindet wieder', await julius.page.locator('#sync-status').isHidden());

    await tobi.page.evaluate(() => window.DartSync.jetzt());
    await tobi.page.waitForTimeout(1200);
    check('auch das nachgereichte Spiel kommt bei Tobi an',
      (await tobi.page.evaluate(() => window.__dart.state().history.length)) === 2);

    group('Abmelden');
    await tobi.page.locator('#nav-konto').click();
    await tobi.page.locator('[data-action="konto-logout"]').click();
    await tobi.page.waitForSelector('[data-action="konto-login"]', { timeout: 10000 });
    check('Tobi ist abgemeldet', await tobi.page.evaluate(() => !window.DartKonto.nutzer()));
    check('die Schranke ist wieder da',
      await tobi.page.evaluate(() => document.body.classList.contains('gesperrt')));
    check('Navigation wieder aus', await tobi.page.locator('#nav').isHidden());
    check('seine Spiele bleiben auf dem Gerät',
      (await tobi.page.evaluate(() => window.__dart.state().history.length)) === 2);
    await tobi.page.reload();
    await tobi.page.waitForSelector('[data-action="konto-login"]', { timeout: 10000 });
    check('nach dem Neustart bleibt zu',
      await tobi.page.evaluate(() => document.body.classList.contains('gesperrt')));

    group('Session übersteht einen Neustart der App');
    await julius.page.reload();
    await julius.page.waitForFunction(() => !!window.DartKonto && !!window.DartKonto.nutzer(), null, { timeout: 10000 });
    check('Julius ist noch angemeldet',
      await julius.page.evaluate(() => window.DartKonto.nutzer().name === 'Julius'));
    check('Zuordnung wird nicht nochmal verlangt',
      (await julius.page.evaluate(() => window.__dart.state().screen)) !== 'zuordnung');
    check('die Startspieler kommen auch nach dem Neustart nicht zurück',
      await julius.page.evaluate(() => !window.__dart.state().profiles
        .some((p) => ['Lenas', 'Domi'].indexOf(p.name) >= 0)));

    /*
     * Ein Gast ist der Besuch von heute Abend: kein Account, gehoert dem
     * Geraet, und nach dem Abend raeumt er sich selbst weg. Wer schon
     * geworfen hat, wird nur ausgeblendet -- geloescht stuende im Archiv
     * "Unbekannt".
     */
    /*
     * Das Lieblingsdoppel gehoert dem Account, nicht dem Geraet. Sonst
     * bekaeme Tobi Julius' Doppel vorgeschlagen, sobald Julius den Abend
     * mitschreibt -- und genau das ist der Normalfall.
     */
    /*
     * Die Doppel-Warnung meldete bisher jede Wiederholung derselben
     * Besetzung -- also den Normalfall. Gemeint war immer nur der Fall, dass
     * zwei Leute denselben Abend aufgeschrieben haben.
     */
    group('Doppel-Warnung nur bei zwei Schreibern');
    const warnung = () => julius.page.evaluate(() => window.DartSync.langText());
    const setzeVerlauf = (eintraege) => julius.page.evaluate((liste) => {
      const S = window.__dart.state();
      S.sicherung = JSON.stringify(S.history);
      S.history = liste;
      window.__dart.save();
    }, eintraege);
    const jetztMs = Date.now();
    /* Vollstaendig geformte Eintraege: career() rechnet ueber die Historie,
       ein Eintrag ohne Wurfliste wuerde beim naechsten Zeichnen krachen. */
    const paar = (vonA, vonB) => [
      { id: 'd1', kind: 'cricket', at: jetztMs, players: ['x', 'y'], scoring: false, throws: [], winner: 'x', von: vonA },
      { id: 'd2', kind: 'cricket', at: jetztMs + 60000, players: ['y', 'x'], scoring: false, throws: [], winner: 'y', von: vonB }
    ].map((e) => (e.von ? e : (delete e.von, e)));

    await setzeVerlauf(paar(null, null));
    check('zwei Partien derselben Leute vom selben Schreiber: keine Warnung',
      !(await warnung()).includes('Achtung'), await warnung());
    await setzeVerlauf(paar(null, 'Tobi'));
    check('einmal selbst, einmal von Tobi: Warnung',
      (await warnung()).includes('Achtung'), await warnung());
    check('und sie sagt, worum es geht',
      (await warnung()).includes('von zwei Leuten aufgeschrieben'), await warnung());
    await setzeVerlauf(paar('Lenas', 'Tobi'));
    check('auch aus der Sicht eines Dritten',
      (await warnung()).includes('Achtung'), await warnung());
    await setzeVerlauf(paar('Tobi', 'Tobi'));
    check('zweimal von Tobi geholt heisst nicht doppelt eingetragen',
      !(await warnung()).includes('Achtung'), await warnung());
    await julius.page.evaluate(() => {
      const S = window.__dart.state();
      S.history = JSON.parse(S.sicherung);
      delete S.sicherung;
      window.__dart.save();
    });
    check('der echte Verlauf ist unversehrt zurueck',
      (await julius.page.evaluate(() => window.__dart.state().history.length)) > 0);

    group('Lieblingsdoppel reist mit dem Account');
    await julius.page.locator('#nav [data-screen="setup"]').click();
    await julius.page.locator('.roster-item[data-id="' + juliusId + '"] .edit').click();
    await julius.page.locator('[data-role="profile-double"]').selectOption('16');
    await julius.page.locator('[data-action="save-profile"]').click();
    await julius.page.waitForTimeout(600);
    check('lokal gesetzt',
      await julius.page.evaluate((id) => window.__dart.profile(id).dbl === 16, juliusId));
    check('und beim Server angekommen', await julius.page.evaluate(async () => {
      const r = await fetch('/api/me', { headers: { 'X-Darts-App': '1' } });
      return (await r.json()).nutzer.dbl === 16;
    }));
    /* Tobis Geraet ist an dieser Stelle abgemeldet – gepruet wird deshalb
       am Kader, den der Server ausliefert. Genau den holt sich jedes andere
       Geraet beim Abgleich. */
    check('es steht im Kader, den alle anderen bekommen', await julius.page.evaluate(async (id) => {
      const r = await fetch('/api/users', { headers: { 'X-Darts-App': '1' } });
      const kader = (await r.json()).nutzer;
      return kader.find((n) => n.id === id).dbl === 16;
    }, juliusId));
    check('Tobis Vorliebe bleibt davon unberuehrt', await julius.page.evaluate(async (id) => {
      const r = await fetch('/api/users', { headers: { 'X-Darts-App': '1' } });
      const kader = (await r.json()).nutzer;
      return kader.filter((n) => n.id !== id).every((n) => !n.dbl);
    }, juliusId));
    check('an einem fremden Profil laesst sie sich nicht aendern',
      (await julius.page.locator('.roster-item[data-id="' + tobiId + '"] .edit').count()) === 0);
    await julius.page.locator('.roster-item[data-id="' + juliusId + '"] .edit').click();
    await julius.page.locator('[data-role="profile-double"]').selectOption('0');
    await julius.page.locator('[data-action="save-profile"]').click();
    await julius.page.waitForTimeout(600);
    check('zuruecksetzen auf "egal" geht auch',
      await julius.page.evaluate((id) => !window.__dart.profile(id).dbl, juliusId));

    group('Gäste');
    await julius.page.locator('#nav [data-screen="setup"]').click();
    await julius.page.locator('#screen-setup [data-action="new-profile"]').click();
    await julius.page.locator('[data-role="profile-name"]').fill('Onkel Heinz');
    await julius.page.locator('[data-action="save-profile"]').click();
    const gastId = await julius.page.evaluate(() =>
      (window.__dart.state().profiles.find((p) => p.name === 'Onkel Heinz') || {}).id);
    check('von Hand angelegt heisst angemeldet: Gast',
      await julius.page.evaluate((id) => !!window.__dart.profile(id).gast, gastId));
    check('Gast trägt ein Abzeichen in der Aufstellung',
      (await julius.page.locator('.roster-item[data-id="' + gastId + '"] .gast-marke').count()) === 1);
    check('der eigene Account nicht',
      (await julius.page.locator('.roster-item[data-id="' + juliusId + '"] .gast-marke').count()) === 0);
    check('Gäste stehen unter den Accounts', await julius.page.evaluate((id) => {
      const ids = [...document.querySelectorAll('.roster-item')].map((e) => e.getAttribute('data-id'));
      return ids[ids.length - 1] === id;
    }, gastId));
    check('ein Gast landet nicht in "Wer ist wer?"',
      (await julius.page.locator('[data-action="konto-zuordnung-speichern"]').count()) === 0);

    await julius.page.locator('.roster-item[data-id="' + gastId + '"] .edit').click();
    check('ein Gast ohne Spiel lässt sich richtig löschen',
      (await julius.page.locator('[data-action="delete-profile"]').count()) === 1);
    await julius.page.locator('[data-action="ov-cancel"]').click();

    /* Abend vorbei: der Gast wurde vor mehr als zwölf Stunden angelegt und
       hat nie geworfen. Beim nächsten Start ist er weg. */
    await julius.page.evaluate((id) => {
      window.__dart.profile(id).created = Date.now() - 20 * 3600 * 1000;
      window.__dart.save();
    }, gastId);
    await julius.page.reload();
    await julius.page.waitForFunction(() => !!window.DartKonto && !!window.DartKonto.nutzer(), null, { timeout: 10000 });
    check('ein Gast ohne Spiel ist am nächsten Tag weg',
      await julius.page.evaluate((id) => !window.__dart.state().profiles.some((p) => p.id === id), gastId));

    /* Derselbe Ablauf, aber der Gast hat mitgespielt: dann darf er nicht
       verschwinden, sonst stuende in der Spielstatistik "Unbekannt". */
    await julius.page.locator('#screen-setup [data-action="new-profile"]').click();
    await julius.page.locator('[data-role="profile-name"]').fill('Tante Erna');
    await julius.page.locator('[data-action="save-profile"]').click();
    const ernaId = await julius.page.evaluate(() => {
      const S = window.__dart.state();
      const p = S.profiles.find((x) => x.name === 'Tante Erna');
      p.created = Date.now() - 20 * 3600 * 1000;
      S.history.unshift({
        id: 'gastspiel', kind: 'cricket', at: Date.now() - 19 * 3600 * 1000,
        players: [p.id], scoring: true, throws: [], winner: p.id
      });
      window.__dart.save();
      return p.id;
    });
    await julius.page.reload();
    await julius.page.waitForFunction(() => !!window.DartKonto && !!window.DartKonto.nutzer(), null, { timeout: 10000 });
    check('ein Gast mit Spiel bleibt erhalten',
      await julius.page.evaluate((id) => !!window.__dart.state().profiles.find((p) => p.id === id), ernaId));
    check('er ist aber ausgeblendet',
      await julius.page.evaluate((id) => window.__dart.profile(id).hidden === true, ernaId));
    check('und steht nicht mehr in der Aufstellung',
      (await julius.page.locator('.roster-item[data-id="' + ernaId + '"]').count()) === 0);
    check('sein Name steht weiterhin in der Historie',
      await julius.page.evaluate((id) => window.__dart.profile(id).name === 'Tante Erna', ernaId));
    // Aufraeumen, damit die folgenden Pruefungen auf ihren Zahlen bleiben.
    await julius.page.evaluate((id) => {
      const S = window.__dart.state();
      S.history = S.history.filter((e) => e.id !== 'gastspiel');
      S.profiles = S.profiles.filter((p) => p.id !== id);
      window.__dart.save();
    }, ernaId);

    /*
     * Das eigentliche Versprechen: was vor der Anmeldepflicht gespielt wurde,
     * geht nicht verloren. Drittes Geraet, auf dem schon ein Spiel liegt --
     * genau die Lage jedes Geraets, das die App vor den Accounts hatte.
     */
    group('Spiele von vor der Anmeldung zaehlen weiter');
    const altbestand = {
      v: 2,
      screen: 'setup',
      settings: { start: 501, bestOf: 1, dartModeFrom: 170, cricketScoring: 1 },
      mode: '501',
      game: null,
      profiles: [
        { id: 'altlena', name: 'Lenas', avatar: null, hue: 145, created: 1 },
        { id: 'alttobi', name: 'Tobi', avatar: null, hue: 210, created: 2 }
      ],
      lineup: [],
      matches: [],
      current: null,
      history: [{
        id: 'altspiel1',
        kind: 'cricket',
        at: Date.now() - 86400000,
        players: ['altlena', 'alttobi'],
        scoring: true,
        // Lenas macht alles zu: 20-15 per Triple, dann Bull. Tobi wirft daneben.
        throws: [
          { n: 20, m: 3 }, { n: 19, m: 3 }, { n: 18, m: 3 },
          { n: 0, m: 0 }, { n: 0, m: 0 }, { n: 0, m: 0 },
          { n: 17, m: 3 }, { n: 16, m: 3 }, { n: 15, m: 3 },
          { n: 0, m: 0 }, { n: 0, m: 0 }, { n: 0, m: 0 },
          { n: 25, m: 2 }, { n: 25, m: 1 }
        ],
        winner: 'altlena'
      }]
    };
    const lenas = await geraet(browser, 'Lenas', altbestand);
    check('Altbestand ist da', (await lenas.page.evaluate(() => window.__dart.state().history.length)) === 1);
    check('aber die App bleibt trotzdem zu',
      await lenas.page.evaluate(() => document.body.classList.contains('gesperrt')));
    check('nichts wartet auf Upload, solange niemand angemeldet ist',
      (await lenas.page.evaluate(() => window.DartSync.wartend())) === 0);

    await registriere(lenas, 'Lenas', 'lenas@example.de', 'einhundertachtzig', true);
    await zuordnungUebernehmen(lenas);
    check('das alte Spiel geht nach der Zuordnung raus', await warteAufUpload(lenas.page, 15));

    await tobi.page.locator('[data-action="konto-login"]').isVisible();
    await tobi.page.locator('#konto-email').fill('tobi@example.de');
    await tobi.page.locator('#konto-pass').fill('dreifachzwanzig');
    await tobi.page.locator('[data-action="konto-login"]').click();
    // Nach dem Anmelden faellt die Schranke und man landet im Turnier –
    // nicht mehr auf dem Konto-Bildschirm.
    await tobi.page.waitForFunction(
      () => !document.body.classList.contains('gesperrt'), null, { timeout: 10000 }
    );
    check('Anmelden bringt direkt in die App', await tobi.page.locator('#screen-setup').isVisible());
    await tobi.page.evaluate(() => window.DartSync.jetzt());
    await tobi.page.waitForTimeout(1500);
    check('Tobi bekommt auch das Spiel von vor Lenas Anmeldung',
      (await tobi.page.evaluate(() => window.__dart.state().history.length)) === 3,
      'Historie: ' + (await tobi.page.evaluate(() => window.__dart.state().history.length)));
    const tobiCar2 = await tobi.page.evaluate(() => window.__dart.career());
    check('und es zaehlt in seiner Karriere',
      tobiCar2[tobiId] && tobiCar2[tobiId].cricketGames === 3,
      String(tobiCar2[tobiId] && tobiCar2[tobiId].cricketGames));

    group('Fehlerfreiheit');
    const alleFehler = julius.fehlerLog.concat(tobi.fehlerLog, lenas.fehlerLog);
    check('keine JS-Fehler', alleFehler.length === 0, alleFehler.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (proc.exitCode === null) proc.kill('SIGKILL');
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) { /* Wegwerf-Verzeichnis */ }
  }

  console.log('\n' + (fehler ? fehler + ' von ' + geprueft + ' Prüfungen fehlgeschlagen' : 'Alle ' + geprueft + ' Prüfungen bestanden'));
  process.exit(fehler ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
