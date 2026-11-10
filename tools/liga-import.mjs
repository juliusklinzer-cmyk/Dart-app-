#!/usr/bin/env node
/*
 * Liga-Import von Hand: holt Spielplan, Ergebnisse, alle Spielberichte (16
 * Einzel je Spiel, Highlights) und die Mannschaftsseiten der 4er 5. Liga
 * von steeldart-muenchen.de und schreibt js/liga-sdm.js. Der Kern steckt
 * in server/lib/liga-import.mjs - der Server macht denselben Import
 * stuendlich selbst und liefert die frische Datei aus; dieses Skript ist
 * fuer die Repo-Fassung (Rueckfallebene, Einzeldatei-Buendel, Tests).
 *
 *   node tools/liga-import.mjs              laedt von der Webseite, schreibt js/liga-sdm.js
 *   node tools/liga-import.mjs --pruefen    rechnet Tabelle und Einzelrangliste nach und
 *                                           vergleicht mit den Tabellen der Webseite
 *   node tools/liga-import.mjs --aus ORDNER nimmt gespeicherte Seiten (liga.html,
 *                                           sb-<id>.html, team-<id>.html, einzel.html)
 *   node tools/liga-import.mjs --speichern ORDNER  legt die geladenen Seiten dort ab
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ligaImportieren, ladenAusNetz, tabelleAusSeite, einzelAusSeite, EINZEL_SEITE } from '../server/lib/liga-import.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const ZIEL = join(WURZEL, 'js', 'liga-sdm.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const AUS = opt('--aus');
const SPEICHERN = opt('--speichern');
const PRUEFEN = args.includes('--pruefen');

/* ---------- Laden (Netz oder Ordner) ---------- */
const geladen = new Map();
async function seite(url, datei) {
  if (geladen.has(datei)) return geladen.get(datei);
  let html;
  if (AUS) {
    const p = join(AUS, datei);
    if (!existsSync(p)) throw new Error('Datei fehlt: ' + p);
    html = readFileSync(p, 'utf8');
  } else {
    html = await ladenAusNetz(url);
    if (SPEICHERN) { mkdirSync(SPEICHERN, { recursive: true }); writeFileSync(join(SPEICHERN, datei), html); }
  }
  geladen.set(datei, html);
  return html;
}

/* ---------- Nachrechnen wie die App (fuer --pruefen) ---------- */
function ligaDaten(sdm) {
  const code = readFileSync(join(WURZEL, 'js', 'liga-daten.js'), 'utf8');
  const fenster = { LIGA_SDM: sdm };
  new Function('window', code)(fenster);
  return fenster.LIGA_DATEN;
}

async function haupt() {
  /* Von Hand immer alles neu laden - die Repo-Fassung soll komplett sein. */
  const ergebnis = await ligaImportieren({ laden: seite, voll: true });
  const { sdm, warnungen } = ergebnis;
  warnungen.forEach((w) => console.warn('Warnung: ' + w));

  if (PRUEFEN) {
    const D = ligaDaten(sdm);
    const soll = tabelleAusSeite(ergebnis.ligaHtml);
    const ist = D.tabelleAus(sdm.spieltage, Object.keys(sdm.teams)).zeilen;
    let fehler = 0;
    soll.forEach((s, i) => {
      const z = ist[i];
      const gleich = z && z.team === s.team && z.spiele === s.spiele && z.g === s.g && z.u === s.u && z.v === s.v && z.legs === s.legs && z.einzel === s.einzel && z.punkte === s.punkte;
      if (!gleich) { fehler++; console.log('Tabelle Platz ' + s.platz + ': Webseite ' + JSON.stringify(s) + ' / App ' + JSON.stringify(z)); }
    });
    console.log('Tabelle: ' + soll.length + ' Zeilen verglichen, ' + fehler + ' Abweichungen');
    const einzelSoll = einzelAusSeite(await seite(EINZEL_SEITE, 'einzel.html'));
    const einzelIst = D.einzelranglisteAus(sdm.spieltage);
    /* Gleiche Werte = gleicher Platz; in welcher Reihenfolge die Webseite
       solche Spieler zeigt, ist Zufall. Verglichen wird deshalb je Platz
       die Menge der Zeilen. */
    const schl = (z) => [z.name, z.team, z.legs, z.spiele, z.punkte].join('|');
    const appSchl = (z) => z ? schl({ name: (z.gast ? '*' : '') + z.name, team: z.team, legs: z.legs, spiele: z.spiele, punkte: z.punkte }) : '?';
    let ef = 0;
    for (let i = 0; i < einzelSoll.length;) {
      let j = i;
      while (j < einzelSoll.length && einzelSoll[j].platz === einzelSoll[i].platz) j++;
      const soll = einzelSoll.slice(i, j).map(schl).sort();
      const ist = einzelIst.slice(i, j).map(appSchl).sort();
      if (soll.join(' ; ') !== ist.join(' ; ')) { ef += j - i; console.log('Einzel Platz ' + einzelSoll[i].platz + ': Webseite ' + soll.join(' ; ') + ' / App ' + ist.join(' ; ')); }
      i = j;
    }
    console.log('Einzelrangliste: ' + einzelSoll.length + ' Zeilen verglichen, ' + ef + ' Abweichungen' + (einzelIst.length !== einzelSoll.length ? ' (App hat ' + einzelIst.length + ')' : ''));
  }

  writeFileSync(ZIEL, ergebnis.text);
  console.log('js/liga-sdm.js geschrieben: ' + ergebnis.zusammenfassung + '.');
  if (warnungen.length) {
    console.warn('\n' + warnungen.length + ' Warnung(en):');
    warnungen.forEach((w) => console.warn('  - ' + w));
  }
}

haupt().catch((e) => { console.error('Liga-Import fehlgeschlagen: ' + (e && e.message || e)); process.exit(1); });
