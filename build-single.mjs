/*
 * Baut aus index.html + CSS + JS eine einzelne, in sich geschlossene HTML-Datei.
 * Aufruf: npm run build
 *
 * Erzeugt:
 *   dart-turnier.html        komplette Seite (AirDrop, Mailanhang, USB-Stick)
 *   build/artifact.html      nur der Seiteninhalt, zum Veröffentlichen als Web-Seite
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const base64 = (p) => fs.readFileSync(path.join(ROOT, p)).toString('base64');

/*
 * Schriften und Logo wandern als data:-URL mit in die Datei. Sonst wären es
 * Verweise auf Nachbarordner, die es neben einer per AirDrop verschickten
 * Einzeldatei nicht gibt – die Datei sähe dann nackt aus. Kostet rund 100 KB,
 * dafür ist sie wirklich in sich geschlossen.
 */
const einbetten = (p, typ) => 'data:' + typ + ';base64,' + base64(p);

const css = read('css/styles.css')
  .replace(/url\('\.\.\/fonts\/([^']+)'\)/g,
    (_, datei) => "url('" + einbetten('fonts/' + datei, 'font/woff2') + "')")
  // Das Logo steht als Hintergrundbild genau einmal im CSS – deshalb landet
  // es hier auch nur einmal in der Datei, egal an wie vielen Stellen es
  // angezeigt wird.
  .replace(/url\('\.\.\/icons\/([^']+)'\)/g,
    (_, datei) => "url('" + einbetten('icons/' + datei, 'image/webp') + "')");
// js/kamera.js bleibt bewusst draussen: die Kamera-Kopplung braucht den
// Server als Vermittler - in der Einzeldatei gaebe es nur einen toten Knopf.
const js = [read('js/sound.js'), read('js/checkout.js'), read('js/app.js')]
  // Ohne Nachbardateien gibt es keinen Service Worker zu registrieren.
  .join('\n')
  .replace(/\n\s*if \('serviceWorker' in navigator[\s\S]*?\n\s*\}\n/, '\n');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim()
  .replace(/\n\s*<script src="[^"]+"><\/script>/g, '')
  // Ohne Server gibt es keine Konten. Der Abschnitt bliebe nicht nur tot
  // liegen, er verwiese auch auf ein Logo, das neben der Einzeldatei nicht
  // existiert – das gibt beim Öffnen eine Fehlermeldung in der Konsole.
  .replace(/\n\s*<!-- =+ KONTO =+ -->[\s\S]*?<\/section>/, '')
  .replace(/\n\s*<!--[^>]*js\/auth\.js[\s\S]*?-->/, '')
  // Die Wortmarke behält ihr Logo – als eingebettetes Bild.
  .replace(/src="icons\/icon-192\.webp"/g, 'src="' + einbetten('icons/icon-192.webp', 'image/webp') + '"');

const title = 'Blink 180 – Dart Turnier';
const fragment = [
  `<title>${title}</title>`,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  `<style>\n${css}\n</style>`,
  body,
  `<script>\n${js}\n</script>`
].join('\n');

const page = [
  '<!DOCTYPE html>',
  '<html lang="de">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="theme-color" content="#0e1116">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  fragment.slice(0, fragment.indexOf('<style>')),
  fragment.slice(fragment.indexOf('<style>'), fragment.indexOf('</style>') + 8),
  '</head>',
  '<body>',
  fragment.slice(fragment.indexOf('</style>') + 8).trim(),
  '</body>',
  '</html>'
].join('\n');

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dart-turnier.html'), page);
fs.writeFileSync(path.join(ROOT, 'build/artifact.html'), fragment);

const kb = (s) => Math.round(s.length / 1024) + ' KB';
console.log(`dart-turnier.html   ${kb(page)}`);
console.log(`build/artifact.html ${kb(fragment)}`);
