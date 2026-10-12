/*
 * Abnahme der Checkout-Engine gegen die Referenzdaten aus
 * docs/finishwege/referenz/checkout_fixtures.json (erzeugt von
 * checkout_referenz.py, Monte Carlo mit einer Million Stichproben).
 *
 *   node tests/checkout-engine.mjs
 *
 * Massstab (Auftrag vom 11.10.2026): mindestens 98 % identische Tabellen-
 * eintraege (3, 2, 1 Dart), jede Abweichung ein Fast-Gleichstand (hoechstens
 * 0,02 nach dem Massstab des Loesers), Average-Tabelle und Kalibrierung
 * ±3 %, Wegbewertung und Alternativen ±0,005.
 *
 * Die Fixtures stammen aus checkout_referenz.py mit SEED 20261011; mit einem
 * anderen Seed verschieben sich die Fast-Gleichstaende, und die Quoten unten
 * koennen um ein bis zwei Punkte wandern. Seedunabhaengig und scharf ist der
 * Treue-Test am Ende: mit dem Trefferbild der Referenz (tests/fixtures/
 * trefferbild-referenz.json) muss der Loeser ihre Tabellen exakt treffen.
 *
 * Die Referenz rechnet mit einer Million Zufallswuerfen; ihr Trefferbild hat
 * dadurch ein Rauschen von etwa 0,0005 je Feld und einen kleinen Versatz
 * (Stichproben-Mittel 0,002 Streuungen neben dem Ziel). Die Engine
 * integriert exakt. Wo zwei Wege naeher als dieses Rauschen beieinander
 * liegen, faellt die Wahl mal so, mal so - die Referenz weicht mit anderem
 * Seed selbst um 0 bis 2 % von sich ab (Checkout-Variante 1,5 bis 3,5 %,
 * Kalibrierung um einen Rasterschritt). Deshalb gilt: alle Tabellen zusammen
 * mindestens 98 %, jede einzelne mindestens 97 %, Checkout-Variante
 * mindestens 96 % bei praktisch gleicher Checkout-Chance (±0,005).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'js', 'checkout-engine.js'));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'finishwege', 'referenz', 'checkout_fixtures.json'), 'utf8'));

let ok = 0, fail = 0;
function check(name, cond, info) {
  if (cond) ok++; else { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}
function gleich(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---- Tabellen je Profil ---------------------------------------------- */
const t0 = Date.now();
let alleTreffer = 0, alleGesamt = 0;
const std = E.tabellenFuerProfil(FX.profile.standard);
const laufzeitStd = Date.now() - t0;
console.log(`Standardprofil gerechnet in ${laufzeitStd} ms`);

for (const name of Object.keys(FX.tabellen)) {
  const prof = FX.profile[name];
  const t = Date.now();
  const erg = name === 'standard' ? std : E.tabellenFuerProfil(prof, { standard: std.standard, ohneCheckout: true });
  const ms = Date.now() - t;
  const soll = FX.tabellen[name];
  let gesamt = 0, treffer = 0;
  const abweichungen = [];
  for (let r = 2; r <= 170; r++) {
    for (const d of [3, 2, 1]) {
      gesamt++;
      const a = erg.tabelle[r][d], b = soll[String(r)][String(d)];
      if (gleich(a.weg, b.weg) && a.bleibt === b.bleibt) treffer++;
      else abweichungen.push({ r, d, ist: a, soll: b });
    }
  }
  const quote = treffer / gesamt;
  alleTreffer += treffer; alleGesamt += gesamt;
  check(`${name}: mindestens 97 % identische Eintraege`, quote >= 0.97, `${treffer}/${gesamt} = ${(quote * 100).toFixed(2)} %`);
  /* Jede Abweichung muss ein Fast-Gleichstand sein: beide Wege mit unserem
     Modell nach dem Massstab des Loesers bewertet (Aufnahmen plus Feinregeln),
     Unterschied hoechstens 0,02. */
  let schlimmste = 0;
  for (const ab of abweichungen) {
    const delta = Math.abs(E.wegWert(erg.L, ab.r, ab.d, ab.ist.weg) - E.wegWert(erg.L, ab.r, ab.d, ab.soll.weg));
    if (delta > schlimmste) schlimmste = delta;
    if (delta > 0.02) console.log(`    ${name} ${ab.r}/${ab.d}: ist ${ab.ist.weg.join(' ')} (${ab.ist.bleibt}) soll ${ab.soll.weg.join(' ')} (${ab.soll.bleibt}) Δ ${delta.toFixed(4)}`);
  }
  check(`${name}: Abweichungen sind Fast-Gleichstaende (≤ 0,02 Aufnahmen)`, schlimmste <= 0.02, `max Δ ${schlimmste.toFixed(4)}`);
  const beispiele = abweichungen.slice(0, 6).map(ab => `${ab.r}/${ab.d} ${ab.ist.weg.join(' ')}${ab.ist.bleibt ? '>' + ab.ist.bleibt : ''} statt ${ab.soll.weg.join(' ')}${ab.soll.bleibt ? '>' + ab.soll.bleibt : ''}`);
  console.log(`  ${name}: ${treffer}/${gesamt} identisch (${(quote * 100).toFixed(2)} %), ${abweichungen.length} Abweichungen, max Δ ${schlimmste.toFixed(4)}, ${ms} ms${beispiele.length ? '\n    ' + beispiele.join('\n    ') : ''}`);

  /* Plan B nur zur Information */
  let planB = 0, planBGesamt = 0;
  for (let r = 2; r <= 170; r++) {
    const a = erg.tabelle[r].planB, b = soll[String(r)].planB;
    if (a || b) { planBGesamt++; if (gleich(a, b)) planB++; }
  }
  console.log(`  ${name}: Plan B ${planB}/${planBGesamt} identisch`);
}

check('alle Tabellen zusammen: mindestens 98 % identische Eintraege', alleTreffer / alleGesamt >= 0.98, `${alleTreffer}/${alleGesamt} = ${(100 * alleTreffer / alleGesamt).toFixed(2)} %`);
console.log(`  alle Tabellen: ${alleTreffer}/${alleGesamt} identisch (${(100 * alleTreffer / alleGesamt).toFixed(2)} %)`);

/* ---- Checkout-Variante (Standardprofil) ------------------------------- */
{
  const soll = FX.tabellen_checkout.standard;
  let gesamt = 0, treffer = 0, schlimmste = 0;
  const abw = [];
  for (let r = 2; r <= 170; r++) for (const d of [3, 2, 1]) {
    gesamt++;
    const a = std.tabelleCheckout[r][d], b = soll[String(r)][String(d)];
    if (gleich(a.weg, b.weg) && a.bleibt === b.bleibt) treffer++;
    else {
      abw.push(`${r}/${d} ${a.weg.join(' ')}${a.bleibt ? '>' + a.bleibt : ''} statt ${b.weg.join(' ')}${b.bleibt ? '>' + b.bleibt : ''}`);
      const ist = E.wegBewerten(std.L, r, d, a.weg), ref = E.wegBewerten(std.L, r, d, b.weg);
      schlimmste = Math.max(schlimmste, Math.abs(ist.checkout - ref.checkout));
    }
  }
  check('checkout-Variante: mindestens 96 % identische Eintraege', treffer / gesamt >= 0.96, `${treffer}/${gesamt}`);
  check('checkout-Variante: Abweichungen haben fast dieselbe Checkout-Chance (≤ 0,005)', schlimmste <= 0.005, `max Δ ${schlimmste.toFixed(4)}`);
  console.log(`  checkout: ${treffer}/${gesamt} identisch, max Δ Chance ${schlimmste.toFixed(4)}${abw.length ? '\n    ' + abw.slice(0, 6).join('\n    ') : ''}`);
}

/* ---- Average-Tabelle --------------------------------------------------- */
for (const z of FX.average_tabelle) {
  const avg = E.averageModell(z.sigma_mm, z.sigma_mm, 400);
  check(`Average bei ${z.sigma_mm} mm: ${z.average} (±3 %)`, Math.abs(avg - z.average) / z.average <= 0.03, avg.toFixed(2));
}

/* ---- Kalibrierung ------------------------------------------------------ */
for (const k of FX.kalibrierung) {
  const t = Date.now();
  const p = E.profilAusTests(k.eingabe);
  const ms = Date.now() - t;
  for (const f of ['sigma_x', 'sigma_y', 'f_triple', 'f_doppel', 'f_bull']) {
    const soll = k.profil[f];
    check(`Kalibrierung avg ${k.eingabe.avg}: ${f} ${soll} (±3 %)`, Math.abs(p[f] - soll) / soll <= 0.03, `${p[f]} (${ms} ms)`);
  }
  check(`Kalibrierung avg ${k.eingabe.avg}: Favoriten uebernommen`, gleich(p.favoriten, k.profil.favoriten));
}

/* ---- Wegbewertung und Alternativen ------------------------------------ */
for (const w of FX.weg_bewertung) {
  const b = E.wegBewerten(std.L, w.rest, w.darts, w.weg);
  check(`Wegbewertung ${w.rest}/${w.darts} ${w.weg.join(' ')}: Aufnahmen ${w.aufnahmen_danach}`, Math.abs(b.aufnahmen - w.aufnahmen_danach) <= 0.005, b.aufnahmen.toFixed(5));
  check(`Wegbewertung ${w.rest}/${w.darts} ${w.weg.join(' ')}: Checkout ${w.checkout}`, Math.abs(b.checkout - w.checkout) <= 0.005, b.checkout.toFixed(5));
}
for (const key of Object.keys(FX.alternativen)) {
  const [r, d] = key.split('_').map(Number);
  const alt = E.alternativen(std.L, r, d);
  const soll = FX.alternativen[key];
  check(`Alternativen ${key}: dieselben drei Wege`, gleich(alt.map(a => a.weg), soll.map(a => a.weg)), alt.map(a => a.weg.join(' ')).join(', ') + ' statt ' + soll.map(a => a.weg.join(' ')).join(', '));
  for (let i = 0; i < Math.min(alt.length, soll.length); i++) {
    check(`Alternativen ${key} #${i + 1}: Aufnahmen ±0,005`, Math.abs(alt[i].aufnahmen - soll[i].aufnahmen_danach) <= 0.005, `${alt[i].aufnahmen.toFixed(5)} statt ${soll[i].aufnahmen_danach}`);
    check(`Alternativen ${key} #${i + 1}: Checkout ±0,005`, Math.abs(alt[i].checkout - soll[i].checkout) <= 0.005, `${alt[i].checkout.toFixed(5)} statt ${soll[i].checkout}`);
  }
}

/* ---- Pruefung eigener Wege -------------------------------------------- */
check('wegPruefen: T20 T20 D20 auf 160 ok', E.wegPruefen(160, 3, ['T20', 'T20', 'D20']).ok);
check('wegPruefen: Single am Ende ist ein Fehler', !E.wegPruefen(40, 3, ['20', '20']).ok);
check('wegPruefen: ueberworfen', E.wegPruefen(40, 3, ['T20']).fehler.includes('überworfen'));
check('wegPruefen: unbekanntes Feld', !E.wegPruefen(40, 3, ['T21']).ok);
check('wegPruefen: ein Dart mehr als noetig warnt', E.wegPruefen(40, 3, ['20', 'D10']).warnungen.length === 1);
const v = E.wegVergleich(std.L, 82, 3, ['T18', 'D14']);
check('wegVergleich: bester Weg auf 82 ist Bull D16', v.besterWeg.join(' ') === 'Bull D16');
check('wegVergleich: T18 D14 auf 82 ist deutlich schlechter (0,089 Aufnahmen mehr)', v.deutlichSchlechter && Math.abs(v.mehrAufnahmen - 0.08919) <= 0.005, JSON.stringify(v));
const v2 = E.wegVergleich(std.L, 127, 3, ['T20', 'T17', 'D8']);
check('wegVergleich: T20 T17 D8 auf 127 ist nicht deutlich schlechter', !v2.deutlichSchlechter && Math.abs(v2.mehrAufnahmen - 0.01291) <= 0.005, JSON.stringify(v2));

/* ---- Treue des Loesers: gleiches Trefferbild, gleiche Tabellen ---------- */
{
  const TB = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'trefferbild-referenz.json'), 'utf8'));
  const Pref = TB.P.map((z) => Float64Array.from(z));
  const L0 = E.loesen(Pref);
  const tab = E.tabelle(L0), tabC = E.tabelle(L0, E.checkoutPolitik(L0));
  let t = 0, tc = 0, n = 0;
  for (let r = 2; r <= 170; r++) for (const d of [3, 2, 1]) {
    n++;
    const a = FX.tabellen.standard[String(r)][String(d)], c = FX.tabellen_checkout.standard[String(r)][String(d)];
    if (gleich(tab[r][d].weg, a.weg) && tab[r][d].bleibt === a.bleibt) t++;
    if (gleich(tabC[r][d].weg, c.weg) && tabC[r][d].bleibt === c.bleibt) tc++;
  }
  check('Treue: mit dem Referenz-Trefferbild sind alle Tabelleneintraege identisch', t === n, `${t}/${n}`);
  check('Treue: auch die Checkout-Variante', tc === n, `${tc}/${n}`);
  /* Favorit D16 mit demselben Trefferbild, nur die Favoriten-Ziele streuen enger: dafuer
     braeuchte es das zweite Referenz-Trefferbild; stattdessen die Wegbewertung exakt. */
  const wb = FX.weg_bewertung[0], b = E.wegBewerten(L0, wb.rest, wb.darts, wb.weg);
  check('Treue: Wegbewertung 127/3 auf fuenf Stellen gleich', Math.abs(b.aufnahmen - wb.aufnahmen_danach) < 1e-5 && Math.abs(b.checkout - wb.checkout) < 1e-5, `${b.aufnahmen} / ${b.checkout}`);
}

/* ---- Eingabepruefung --------------------------------------------------- */
const wirft = (f) => { try { f(); return false; } catch (e) { return String(e.message); } };
check('profil: Streuung 0 wird abgelehnt', /nicht positiv/.test(wirft(() => E.profil({ sigma_x: 0 }))));
check('profil: Favorit 30 wird abgelehnt', /Favorit/.test(wirft(() => E.profil({ favoriten: [30] }))));
check('profilAusTests: ohne Average Fehler', /Average/.test(wirft(() => E.profilAusTests({}))));
check('profilAusTests: Doppel-Ziel 25 wird abgelehnt', /Doppel-Test/.test(wirft(() => E.profilAusTests({ avg: 60, doppel: { ziel: 25, treffer: 3 } }))));
check('profilAusTests: leerer T20-Test zaehlt wie kein Test', E.profilAusTests({ avg: 60, t20: {} }).sigma_x === E.profilAusTests({ avg: 60 }).sigma_x);
check('wegPruefen: ohne Dart eigene Meldung', E.wegPruefen(40, 3, []).fehler[0] === 'kein Dart angegeben');

/* ---- Kompaktformat fuer js/checkout.js --------------------------------- */
const komp = E.kompakt(std.tabelle);
check('kompakt: 101 wie in der Tabelle von checkout.js', komp[101] === 'T19 S12 D16|T17 BULL|T19 >44', komp[101]);
check('kompakt: 170', komp[170] === 'T20 T20 BULL|T20 T19 >53|T20 >110', komp[170]);
check('kompakt: 169 Eintraege', Object.keys(komp).length === 169);

console.log(`\nEngine: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
