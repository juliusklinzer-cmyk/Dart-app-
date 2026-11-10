/*
 * Die Liga-Daten der App (Spielplan mit unseren Terminen, alle Ergebnisse)
 * auch im Server: js/liga-sdm.js und js/liga-daten.js sind Browser-Skripte,
 * die alles an `window` haengen - hier bekommen sie ein leeres Objekt als
 * window. Gebraucht fuer die Erinnerungs-Mails vor dem Spieltag und die
 * Tabellen-Mitteilung (api.mjs, lib/mitteilungen.mjs).
 *
 * Zwei Fassungen von liga-sdm.js kommen in Frage: die aus dem Repo
 * (js/liga-sdm.js, im Image) und die, die der Server selbst stuendlich
 * von der Ligaleitung holt (liga-sdm.js neben der Datenbank, ueberlebt
 * ein Deploy). Es gilt die mit dem juengeren Stand; bei gleichem Tag die
 * vom Server. Dieselbe Wahl trifft main.mjs beim Ausliefern von
 * /js/liga-sdm.js, damit App und Webseite dasselbe sehen wie die Mails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ligaImportieren, sdmAusText, sdmInhaltGleich, standAusText } from './liga-import.mjs';

export const LIGA_DATEI = 'liga-sdm.js';

/* Welche Datei gilt: { pfad, stand, quelle: 'server' | 'repo' } oder null. */
export function ligaDateiWaehlen(appDir, datenDir) {
  const kandidaten = [];
  const repo = path.join(appDir, 'js', LIGA_DATEI);
  if (fs.existsSync(repo)) kandidaten.push({ pfad: repo, quelle: 'repo' });
  if (datenDir) {
    const eigen = path.join(datenDir, LIGA_DATEI);
    if (fs.existsSync(eigen)) kandidaten.unshift({ pfad: eigen, quelle: 'server' });
  }
  let beste = null;
  for (const k of kandidaten) {
    let stand = null;
    try { stand = standAusText(fs.readFileSync(k.pfad, 'utf8')); } catch (e) { continue; }
    if (!stand) continue;
    k.stand = stand;
    if (!beste || k.stand > beste.stand) beste = k;
  }
  return beste;
}

export function ladeLigaDaten(appDir, datenDir) {
  const fenster = {};
  const wahl = ligaDateiWaehlen(appDir, datenDir);
  const dateien = [];
  if (wahl) dateien.push(wahl.pfad);
  dateien.push(path.join(appDir, 'js', 'liga-daten.js'));
  for (const p of dateien) {
    if (!fs.existsSync(p)) continue;
    try {
      new Function('window', fs.readFileSync(p, 'utf8'))(fenster);
    } catch (e) {
      console.error('Liga-Daten (' + p + ') nicht lesbar: ' + (e && e.message));
      return null;
    }
  }
  return fenster.LIGA_DATEN || null;
}

/*
 * Der stuendliche Abgleich mit der Ligaleitung. Liest die geltende Datei
 * als "bekannt" (so werden nur neue Spielberichte geladen), holt den
 * Spielplan und schreibt die Datei neben die Datenbank, wenn sich am
 * Inhalt etwas geaendert hat. Fehler (Netz, Layout der Webseite) lassen
 * die alte Datei stehen und werden nur gemeldet.
 * Ergebnis: { geaendert: bool, stand, zusammenfassung, warnungen } oder
 * { fehler: Text }.
 */
export async function ligaAktualisieren(opt) {
  const appDir = opt.appDir, datenDir = opt.datenDir;
  const ziel = path.join(datenDir, LIGA_DATEI);
  const wahl = ligaDateiWaehlen(appDir, datenDir);
  let bekannt = null;
  if (wahl) { try { bekannt = sdmAusText(fs.readFileSync(wahl.pfad, 'utf8')); } catch (e) { bekannt = null; } }
  let ergebnis;
  try {
    ergebnis = await ligaImportieren({ laden: opt.laden, bekannt, voll: !!opt.voll, heute: opt.heute });
  } catch (e) {
    return { fehler: (e && e.message) || String(e) };
  }
  const geaendert = !sdmInhaltGleich(bekannt, ergebnis.sdm);
  if (geaendert) {
    fs.mkdirSync(datenDir, { recursive: true });
    /* Erst daneben schreiben, dann umbenennen: ein Leser bekommt nie eine
       halbe Datei. */
    const tmp = ziel + '.neu';
    fs.writeFileSync(tmp, ergebnis.text);
    fs.renameSync(tmp, ziel);
  }
  return { geaendert, stand: ergebnis.sdm.stand, zusammenfassung: ergebnis.zusammenfassung, warnungen: ergebnis.warnungen };
}
