/*
 * App-Icons aus dem Mannschaftslogo erzeugen.
 *
 *   node tools/make-icons.mjs
 *
 * Quelle: assets/blink180.jpeg (das Original, wie es kam).
 * Ziel:   icons/ mit den Groessen, die Android und iOS erwarten.
 *
 * Gerechnet wird im Chromium, den Playwright fuer die Tests ohnehin
 * mitbringt -- damit braucht das Projekt weiterhin keine Bildbibliothek und
 * keine native Abhaengigkeit. Die Icons liegen fertig im Repo; dieses Skript
 * muss nur laufen, wenn sich das Logo aendert.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const QUELLE = path.join(ROOT, 'assets', 'blink180.jpeg');
const ZIEL = path.join(ROOT, 'icons');

/*
 * Reines Schwarz -- genau der Grund, auf dem das Logo selbst steht. Mit dem
 * etwas helleren --bg der App (#0e1116) zeichnete sich beim maskable-Icon ein
 * sichtbares Quadrat um die Grafik ab.
 */
const GRUND = '#000000';

/*
 * Formatwahl: die Vorlage ist ein detailreiches, verrauschtes Artwork. Als
 * PNG (verlustfrei) wird daraus ein halbes Megabyte -- und alles hier landet
 * im Offline-Cache, ist also Teil dessen, was jedes Geraet einmal zieht.
 * WebP drueckt das um Faktor 10, ohne dass man es sieht.
 *
 * PNG bleibt nur dort, wo Kompatibilitaet vorgeht: das apple-touch-icon
 * lesen auch aeltere iOS-Versionen, und die verstehen kein WebP.
 */
const AUFTRAEGE = [
  { datei: 'icon-192.webp', groesse: 192, anteil: 1, typ: 'image/webp' },
  { datei: 'icon-512.webp', groesse: 512, anteil: 1, typ: 'image/webp' },
  /*
   * Maskable: Android schneidet das Icon in eine eigene Form (Kreis, Squircle,
   * Tropfen ...). Sicher ist nur der innere Kreis mit 80 % Durchmesser --
   * deshalb hier verkleinert auf 76 %, sonst saebelt Android den Rand des
   * Logos ab.
   */
  { datei: 'icon-maskable-512.webp', groesse: 512, anteil: 0.76, typ: 'image/webp' },
  // iOS setzt selbst die abgerundeten Ecken und mag weder Transparenz noch WebP.
  { datei: 'apple-touch-icon.png', groesse: 180, anteil: 1, typ: 'image/png' }
];

const QUALITAET = 0.92;

const preinstalled = path.join(
  os.homedir(),
  'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe'
);

if (!fs.existsSync(QUELLE)) {
  console.error('Quellbild fehlt: ' + QUELLE);
  process.exit(1);
}

const datenUrl = 'data:image/jpeg;base64,' + fs.readFileSync(QUELLE).toString('base64');
fs.mkdirSync(ZIEL, { recursive: true });

const browser = await chromium.launch(fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {});
const page = await browser.newPage();

for (const auftrag of AUFTRAEGE) {
  const base64 = await page.evaluate(
    async ({ src, groesse, anteil, grund, typ, qualitaet }) => {
      const bild = new Image();
      bild.src = src;
      await bild.decode();

      const c = document.createElement('canvas');
      c.width = groesse;
      c.height = groesse;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = grund;
      ctx.fillRect(0, 0, groesse, groesse);

      // Quadratisch mittig zuschneiden, dann auf den gewuenschten Anteil
      // der Kachel legen -- so bleibt das Logo rund und unverzerrt.
      const kante = Math.min(bild.naturalWidth, bild.naturalHeight);
      const sx = (bild.naturalWidth - kante) / 2;
      const sy = (bild.naturalHeight - kante) / 2;
      const ziel = Math.round(groesse * anteil);
      const rand = Math.round((groesse - ziel) / 2);
      ctx.drawImage(bild, sx, sy, kante, kante, rand, rand, ziel, ziel);

      return c.toDataURL(typ, qualitaet).split(',')[1];
    },
    { src: datenUrl, groesse: auftrag.groesse, anteil: auftrag.anteil, grund: GRUND, typ: auftrag.typ, qualitaet: QUALITAET }
  );

  const pfad = path.join(ZIEL, auftrag.datei);
  fs.writeFileSync(pfad, Buffer.from(base64, 'base64'));
  console.log(
    auftrag.datei.padEnd(26) +
      auftrag.groesse + '×' + auftrag.groesse +
      '  ' + Math.round(fs.statSync(pfad).size / 1024) + ' KB'
  );
}

await browser.close();
console.log('\nFertig. Nicht vergessen: CACHE in sw.js hochzählen.');
