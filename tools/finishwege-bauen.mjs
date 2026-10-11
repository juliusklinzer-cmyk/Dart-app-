/*
 * Liest die Finish-Tabellen aus docs/finishwege/ (je Favorit eine Datei,
 * standard.txt ohne Favorit; je Rest eine Zeile "Rest|3 Darts|2 Darts|1 Dart",
 * Stellwuerfe als "... → N"), prueft sie und schreibt sie als Daten in
 * js/checkout.js zwischen die Marken FINISHWEGE-ANFANG / FINISHWEGE-ENDE.
 *
 *   node tools/finishwege-bauen.mjs
 *
 * Ablage im Solver: je Favorit nur die Zeilen, die vom Standard abweichen;
 * Felder in der Schreibweise des Solvers (T20, S10, D16, 25, BULL), ein
 * Stellwurf endet auf ">N".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'finishwege');
const ZIEL = path.join(ROOT, 'js', 'checkout.js');
const FAVORITEN = [16, 20, 18, 12, 8, 10, 14, 6, 4];

function feld(tok) {
  if (tok === 'Bull') return { label: 'BULL', wert: 50, doppel: true };
  if (tok === '25') return { label: '25', wert: 25, doppel: false };
  let m = /^([TD]?)(\d+)$/.exec(tok);
  if (!m) throw new Error('Unbekanntes Feld: ' + tok);
  const n = Number(m[2]);
  if (n < 1 || n > 20) throw new Error('Unbekanntes Feld: ' + tok);
  if (m[1] === 'T') return { label: 'T' + n, wert: 3 * n, doppel: false };
  if (m[1] === 'D') return { label: 'D' + n, wert: 2 * n, doppel: true };
  return { label: 'S' + n, wert: n, doppel: false };
}

/* "T19 10 → 32" -> { darts: ['T19','S10'], auf: 32 } ; "T20 D20" -> { darts, auf: null } */
function weg(text, rest, darts, wo) {
  const t = text.trim();
  const pf = t.split('→');
  const felder = pf[0].trim().split(/\s+/).map(feld);
  const auf = pf.length > 1 ? Number(pf[1].trim()) : null;
  if (felder.length > darts) throw new Error(wo + ': mehr Darts als in der Hand (' + t + ')');
  const summe = felder.reduce((s, f) => s + f.wert, 0);
  if (auf === null) {
    if (summe !== rest) throw new Error(wo + ': Summe ' + summe + ' statt ' + rest + ' (' + t + ')');
    if (!felder[felder.length - 1].doppel) throw new Error(wo + ': endet nicht auf einem Doppel (' + t + ')');
  } else {
    if (felder.length !== darts) throw new Error(wo + ': Stellwurf braucht alle Darts (' + t + ')');
    if (summe + auf !== rest) throw new Error(wo + ': Stellwurf ' + summe + ' + ' + auf + ' ≠ ' + rest + ' (' + t + ')');
    if (!((auf % 2 === 0 && auf <= 40) || auf === 50 || auf <= 170)) throw new Error(wo + ': Stellwurf auf ' + auf);
  }
  return felder.map((f) => f.label).join(' ') + (auf === null ? '' : ' >' + auf);
}

function lies(name) {
  const zeilen = fs.readFileSync(path.join(DIR, name), 'utf8').split('\n').filter((z) => z.trim() && !z.startsWith('#'));
  const tab = {};
  for (const z of zeilen) {
    const [r, w3, w2, w1] = z.split('|');
    const rest = Number(r);
    if (!(rest >= 2 && rest <= 170)) throw new Error(name + ': Rest ' + r);
    tab[rest] = [weg(w3, rest, 3, name + ' ' + rest + ' (3)'), weg(w2, rest, 2, name + ' ' + rest + ' (2)'), weg(w1, rest, 1, name + ' ' + rest + ' (1)')];
  }
  for (let r = 2; r <= 170; r++) if (!tab[r]) throw new Error(name + ': Rest ' + r + ' fehlt');
  return tab;
}

const standard = lies('standard.txt');
const favoriten = {};
let abweichungen = 0;
for (const d of FAVORITEN) {
  const tab = lies('d' + d + '.txt');
  const diff = {};
  for (let r = 2; r <= 170; r++) {
    if (tab[r].join('|') !== standard[r].join('|')) { diff[r] = tab[r]; abweichungen++; }
  }
  favoriten[d] = diff;
}

const kompakt = (tab) => '{' + Object.keys(tab).map((r) => r + ":'" + tab[r].join('|') + "'").join(',') + '}';
const block = '/* FINISHWEGE-ANFANG - erzeugt von tools/finishwege-bauen.mjs aus docs/finishwege/, nicht von Hand aendern */\n' +
  '  var WEGE_STANDARD = ' + kompakt(standard) + ';\n' +
  '  var WEGE_FAVORIT = {' + FAVORITEN.map((d) => d + ':' + kompakt(favoriten[d])).join(',') + '};\n' +
  '  /* FINISHWEGE-ENDE */';

let js = fs.readFileSync(ZIEL, 'utf8');
const a = js.indexOf('/* FINISHWEGE-ANFANG'), e = js.indexOf('/* FINISHWEGE-ENDE */');
if (a < 0 || e < 0) throw new Error('Marken in js/checkout.js fehlen');
js = js.slice(0, a) + block + js.slice(e + '/* FINISHWEGE-ENDE */'.length);
fs.writeFileSync(ZIEL, js);
console.log('Standard: 169 Reste, Favoriten: ' + FAVORITEN.length + ', abweichende Zeilen: ' + abweichungen + ', Block ' + block.length + ' Zeichen');
