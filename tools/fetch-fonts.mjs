/*
 * Schriften herunterladen und ins Repo legen.
 *
 *   node tools/fetch-fonts.mjs
 *
 * Warum selbst ausliefern statt von Google einzubinden: die App muss offline
 * laufen, und ein Font-Link an fonts.googleapis.com schickt bei jedem Start
 * die IP jedes Mitspielers an Google. Beides wollen wir nicht.
 *
 * Geholt wird nur die Latin-Teilmenge (U+0000-00FF) -- die deckt Deutsch samt
 * Umlauten und ß vollstaendig ab und ist ein Bruchteil so gross wie der
 * komplette Zeichensatz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ZIEL = path.join(ROOT, 'fonts');

/* Ohne Browser-Kennung liefert Google veraltete Formate statt woff2. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/*
 * Drei Familien, wie im Handoff festgelegt:
 *   Anton             Überschriften und die Hauptaktion
 *   Barlow Condensed  alle großen Zahlen
 *   Barlow            Fließtext und Bedienelemente
 *
 * Barlow ohne 800: der Browser nimmt dafür die 700 – der Unterschied ist
 * kleiner als die 20 KB, die eine vierte Datei jeden Abend kosten würde.
 */
const FAMILIEN = [
  { css: 'Anton', datei: 'anton-400.woff2' },
  { css: 'Barlow+Condensed:wght@600', datei: 'barlow-condensed-600.woff2' },
  { css: 'Barlow+Condensed:wght@700', datei: 'barlow-condensed-700.woff2' },
  { css: 'Barlow:wght@400', datei: 'barlow-400.woff2' },
  { css: 'Barlow:wght@600', datei: 'barlow-600.woff2' },
  { css: 'Barlow:wght@700', datei: 'barlow-700.woff2' }
];

fs.mkdirSync(ZIEL, { recursive: true });

for (const f of FAMILIEN) {
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + f.css + '&display=swap', {
    headers: { 'User-Agent': UA }
  })).text();

  /* Der letzte @font-face-Block ist die Latin-Teilmenge -- Google sortiert
     von exotisch nach latin. Wir suchen ihn ueber seine unicode-range. */
  const bloecke = css.split('@font-face');
  const latin = bloecke.find((b) => b.includes('U+0000-00FF'));
  if (!latin) throw new Error('Keine Latin-Teilmenge gefunden für ' + f.css);
  const url = (latin.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
  if (!url) throw new Error('Keine woff2-Adresse gefunden für ' + f.css);

  const bytes = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  fs.writeFileSync(path.join(ZIEL, f.datei), bytes);
  console.log(f.datei.padEnd(30) + Math.round(bytes.length / 1024) + ' KB');
}

const gesamt = fs.readdirSync(ZIEL).reduce((s, d) => s + fs.statSync(path.join(ZIEL, d)).size, 0);
console.log('\nzusammen ' + Math.round(gesamt / 1024) + ' KB');
console.log('Nicht vergessen: fonts/ in sw.js eintragen und CACHE hochzählen.');
