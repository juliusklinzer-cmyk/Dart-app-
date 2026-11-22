#!/usr/bin/env node
/*
 * Liga-Gesamt von Hand: liest die ganze Seite der Steeldart-Liga München
 * (alle Ligen, Teams, Spielberichte, Vereinsseiten) und schreibt einen
 * Schnappschuss als js/liga-gesamt-daten.js - die Rueckfallebene fuer
 * liga.html ohne Server. Der Kern steckt in server/lib/liga-gesamt.mjs;
 * der Server holt denselben Stand stuendlich selbst.
 *
 *   node tools/liga-gesamt.mjs                 laedt von der Webseite (schonend:
 *                                              Spielberichte aus der bisherigen
 *                                              Datei werden nicht neu geladen)
 *   node tools/liga-gesamt.mjs --voll          auch Bekanntes neu laden
 *   node tools/liga-gesamt.mjs --cache ORDNER  geladene Seiten dort ablegen und beim
 *                                              naechsten Lauf von dort nehmen
 *   node tools/liga-gesamt.mjs --nur-cache ORDNER  nichts laden, nur den Ordner lesen
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ligaGesamtLaden, datenText, datenAusText } from '../server/lib/liga-gesamt.mjs';
import { ladenAusNetz } from '../server/lib/liga-import.mjs';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = join(WURZEL, 'js', 'liga-gesamt-daten.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const NUR = opt('--nur-cache');
const CACHE = NUR || opt('--cache');
const VOLL = args.includes('--voll') || !!CACHE;

async function laden(url, datei) {
  const p = CACHE ? join(CACHE, datei) : null;
  if (p && existsSync(p)) return readFileSync(p, 'utf8');
  if (NUR) throw new Error('Datei fehlt im Cache: ' + p);
  const html = await ladenAusNetz(url);
  if (p) { mkdirSync(CACHE, { recursive: true }); writeFileSync(p, html); }
  return html;
}

let bekannt = null;
try { bekannt = datenAusText(readFileSync(ZIEL, 'utf8')); } catch (e) { /* erste Datei */ }

const r = await ligaGesamtLaden({ laden, bekannt, voll: VOLL, pause: NUR ? 0 : 400 });
r.warnungen.forEach((w) => console.warn('Warnung: ' + w));
writeFileSync(ZIEL, datenText(r.daten));
console.log('js/liga-gesamt-daten.js geschrieben: ' + r.zusammenfassung);
