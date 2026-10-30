/*
 * Die Liga-Daten der App (Spielplan mit unseren Terminen) auch im Server:
 * js/liga-sdm.js und js/liga-daten.js sind Browser-Skripte, die alles an
 * `window` haengen - hier bekommen sie ein leeres Objekt als window.
 * Gebraucht fuer die Erinnerungs-Mails vor dem Spieltag (api.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';

export function ladeLigaDaten(appDir) {
  const fenster = {};
  for (const datei of ['js/liga-sdm.js', 'js/liga-daten.js']) {
    const p = path.join(appDir, datei);
    if (!fs.existsSync(p)) continue;
    try {
      new Function('window', fs.readFileSync(p, 'utf8'))(fenster);
    } catch (e) {
      console.error('Liga-Daten (' + datei + ') nicht lesbar: ' + (e && e.message));
      return null;
    }
  }
  return fenster.LIGA_DATEN || null;
}
