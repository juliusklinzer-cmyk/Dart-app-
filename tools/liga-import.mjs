#!/usr/bin/env node
/*
 * Liga-Import: holt Spielplan, Ergebnisse, alle Spielberichte (16 Einzel je
 * Spiel, Highlights) und die Mannschaftsseiten (Lokal, Adresse, Spielerliste)
 * der 4er 5. Liga von steeldart-muenchen.de und schreibt js/liga-sdm.js.
 * Die App und die Webseite lesen daraus (js/liga-daten.js mischt noch die
 * von Hand gepflegten Ergaenzungen dazu, z. B. die Bogen-Aufstellung).
 *
 *   node tools/liga-import.mjs              laedt von der Webseite, schreibt js/liga-sdm.js
 *   node tools/liga-import.mjs --pruefen    rechnet Tabelle und Einzelrangliste nach und
 *                                           vergleicht mit den Tabellen der Webseite
 *   node tools/liga-import.mjs --aus ORDNER nimmt gespeicherte Seiten (liga.html,
 *                                           sb-<id>.html, team-<id>.html, einzel.html)
 *   node tools/liga-import.mjs --speichern ORDNER  legt die geladenen Seiten dort ab
 *
 * Keine Abhaengigkeiten: die Seiten sind einfache Tabellen, die Regexe
 * unten reichen. Aendert die Ligaleitung ihr Layout, meldet das Skript
 * "nichts gefunden" statt stillschweigend leere Daten zu schreiben.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const BASIS = 'https://steeldart-muenchen.de/';
const LIGA_SEITE = BASIS + '4er-liga/4er-5-liga.html';
const EINZEL_SEITE = BASIS + '70.html';
const ZIEL = join(WURZEL, 'js', 'liga-sdm.js');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const AUS = opt('--aus');
const SPEICHERN = opt('--speichern');
const PRUEFEN = args.includes('--pruefen');

/* ---------- HTML-Kleinkram ---------- */
const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é' };
function entschluesseln(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTITAETEN ? ENTITAETEN[n] : m));
}
function text(html) {
  return entschluesseln(String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
/* "(2 * Gast) Michael Rogge" (so schreibt es die Ligaleitung) -> "*Michael Rogge",
   wie es die App seit jeher kennt (Stern = Gastspieler). */
function spielerName(roh) {
  const t = text(roh);
  const m = /^\(\s*\d+\s*\*\s*Gast\s*\)\s*(.+)$/.exec(t);
  return m ? '*' + m[1].trim() : t;
}
function isoDatum(de) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(de || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}

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
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Blink 180 Liga-Import)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' fuer ' + url);
    html = await r.text();
    if (SPEICHERN) { mkdirSync(SPEICHERN, { recursive: true }); writeFileSync(join(SPEICHERN, datei), html); }
  }
  geladen.set(datei, html);
  return html;
}

/* ---------- Spielplan ---------- */
function spielplanAus(html) {
  const runden = {};
  const teamIds = {};
  const bloecke = html.split(/<h3>\s*(\d+)\.\s*Spieltag\s*<\/h3>/);
  if (bloecke.length < 3) throw new Error('Spielplan: keine Spieltage gefunden');
  for (let i = 1; i < bloecke.length; i += 2) {
    const nr = Number(bloecke[i]);
    const id = 'st' + String(nr).padStart(2, '0');
    const zeilen = [];
    const re = /<tr class="spiel">([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(bloecke[i + 1]))) {
      const zellen = {};
      const zre = /<td class='spiel ([a-z]+)[^']*'>([\s\S]*?)<\/td>/g;
      let z;
      while ((z = zre.exec(m[1]))) zellen[z[1]] = z[2];
      const heim = text(zellen.home), gast = text(zellen.away);
      const tid = (s) => { const t = /mannschaftsseite\/id\/(\d+)\.html/.exec(s || ''); return t ? Number(t[1]) : null; };
      if (tid(zellen.home)) teamIds[heim] = tid(zellen.home);
      if (tid(zellen.away)) teamIds[gast] = tid(zellen.away);
      if (!gast || /spielfrei/i.test(gast)) { zeilen.push({ heim, gast: null }); continue; }
      const sp = { tag: isoDatum(text(zellen.am)), heim, gast, ort: text(zellen.ort) || undefined };
      const score = text(zellen.score), legs = text(zellen.legs);
      const bericht = /spielberichte\/id\/(\d+)\.html/.exec(zellen.score || '');
      if (/^\d+\s*:\s*\d+$/.test(score)) {
        sp.einzel = score.replace(/\s/g, '');
        if (/^\d+\s*:\s*\d+$/.test(legs)) sp.legs = legs.replace(/\s/g, '');
        if (bericht) sp.bericht = Number(bericht[1]);
      } else if (/verschoben/i.test(legs)) {
        sp.verschoben = true;
      }
      zeilen.push(sp);
    }
    if (!zeilen.length) throw new Error('Spielplan: ' + nr + '. Spieltag ohne Zeilen');
    runden[id] = zeilen;
  }
  return { runden, teamIds };
}

/* Tabelle der Ligaleitung (nur fuer --pruefen). */
function tabelleAusSeite(html) {
  /* Die Tabelle hat keine Ueberschrift: es ist die mit der Kopfzeile Platz / Mannschaft. */
  const kopf = html.indexOf('<th>Platz</th>');
  if (kopf < 0) return [];
  const tab = html.slice(kopf, html.indexOf('</table>', kopf));
  const zeilen = [];
  const re = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(tab))) {
    const z = [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]));
    if (z.length >= 9) zeilen.push({ platz: Number(z[0]), team: z[1], spiele: Number(z[2]), g: Number(z[3]), u: Number(z[4]), v: Number(z[5]), legs: z[6], einzel: z[7], punkte: Number(z[8]) });
  }
  return zeilen;
}
function einzelAusSeite(html) {
  const zeilen = [];
  const re = /<tr>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const z = [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    if (z.length >= 6 && /^\d+$/.test(text(z[0]))) {
      zeilen.push({ platz: Number(text(z[0])), name: spielerName(z[1]), team: text(z[2]), legs: text(z[3]).replace(/\s/g, ''), spiele: text(z[4]).replace(/\s/g, ''), punkte: Number(text(z[5])) });
    }
  }
  return zeilen;
}

/* ---------- Spielbericht: 16 Einzel und Highlights ---------- */
function spielberichtAus(html, id) {
  const partien = [];
  const re = /<tr>\s*<td><span class="(?:winner|loser)">([\s\S]*?)<\/span><\/td>\s*<td><span class="(?:winner|loser)">([\s\S]*?)<\/span><\/td>\s*<td>\s*(\d+)\s*:\s*(\d+)\s*<\/td>/g;
  let m;
  while ((m = re.exec(html))) partien.push([spielerName(m[1]), spielerName(m[2]), Number(m[3]), Number(m[4])]);
  if (partien.length !== 16) throw new Error('Spielbericht ' + id + ': ' + partien.length + ' statt 16 Einzel');
  const highlights = [];
  const ab = html.indexOf('<h2>Highlights</h2>');
  if (ab >= 0) {
    const tab = html.slice(ab, html.indexOf('</table>', ab));
    const hre = /<tr>([\s\S]*?)<\/tr>/g;
    let h;
    while ((h = hre.exec(tab))) {
      const z = [...h[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]));
      if (z.length < 5 || !z[0]) continue;
      const zahlen = (s) => s.split(/[,\s]+/).map(Number).filter((n) => n > 0);
      const e = { wer: spielerName(z[0]), team: z[1] };
      const was = [];
      const n180 = Number(z[2]) || 0;
      if (n180) { e.s180 = n180; was.push(n180 + '× 180'); }
      const sl = zahlen(z[3]);
      if (sl.length) { e.shortleg = sl; was.push('Shortleg ' + sl.join(', ')); }
      const hf = zahlen(z[4]);
      if (hf.length) { e.highfinish = hf; was.push('Highfinish ' + hf.join(', ')); }
      e.was = was.join(' · ');
      if (was.length) highlights.push(e);
    }
  }
  return { partien, highlights };
}

/* ---------- Mannschaftsseite ---------- */
function teamAus(html, id) {
  const lokal = /<h2>Spielort[^<]*<\/h2>\s*<h3>([\s\S]*?)<\/h3>\s*<div class="address">([\s\S]*?)<\/div>/.exec(html);
  const t = { id };
  if (lokal) {
    t.lokal = text(lokal[1]);
    t.adresse = entschluesseln(lokal[2].replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  }
  const ab = html.indexOf('<h2>Spielerliste');
  t.spieler = [];
  if (ab >= 0) {
    const tab = html.slice(ab, html.indexOf('</table>', ab));
    const re = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g;
    let m;
    while ((m = re.exec(tab))) {
      const name = spielerName(m[1]);
      if (!name) continue;
      const s = { name };
      const info = text(m[2]);
      if (info) s.info = info;
      t.spieler.push(s);
    }
  }
  if (!t.spieler.length) throw new Error('Mannschaftsseite ' + id + ': keine Spielerliste');
  return t;
}

/* ---------- Ausgabe als JS ---------- */
function js(v, tiefe) {
  const ein = '  '.repeat(tiefe);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every((x) => typeof x !== 'object' || x === null)) return '[' + v.map((x) => js(x, 0)).join(', ') + ']';
    if (v.every((x) => Array.isArray(x))) return '[\n' + v.map((x) => ein + '  ' + js(x, 0)).join(',\n') + '\n' + ein + ']';
    return '[\n' + v.map((x) => ein + '  ' + js(x, tiefe + 1)).join(',\n') + '\n' + ein + ']';
  }
  if (v && typeof v === 'object') {
    const k = Object.keys(v).filter((x) => v[x] !== undefined);
    if (!k.length) return '{}';
    const kurz = k.every((x) => typeof v[x] !== 'object' || v[x] === null);
    const schl = (x) => (/^[A-Za-z_$][\w$]*$/.test(x) ? x : JSON.stringify(x));
    if (kurz) return '{ ' + k.map((x) => schl(x) + ': ' + js(v[x], 0)).join(', ') + ' }';
    return '{\n' + k.map((x) => ein + '  ' + schl(x) + ': ' + js(v[x], tiefe + 1)).join(',\n') + '\n' + ein + '}';
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  return String(v);
}

/* ---------- Nachrechnen wie die App (fuer --pruefen) ---------- */
function ligaDaten(sdm) {
  const code = readFileSync(join(WURZEL, 'js', 'liga-daten.js'), 'utf8');
  const fenster = { LIGA_SDM: sdm };
  new Function('window', code)(fenster);
  return fenster.LIGA_DATEN;
}

async function haupt() {
  const ligaHtml = await seite(LIGA_SEITE, 'liga.html');
  const { runden, teamIds } = spielplanAus(ligaHtml);
  let berichte = 0;
  for (const id of Object.keys(runden)) {
    for (const sp of runden[id]) {
      if (!sp.bericht) continue;
      const html = await seite(BASIS + 'spielberichte/id/' + sp.bericht + '.html', 'sb-' + sp.bericht + '.html');
      const b = spielberichtAus(html, sp.bericht);
      sp.partien = b.partien;
      if (b.highlights.length) sp.highlights = b.highlights;
      berichte++;
    }
  }
  const teams = {};
  for (const name of Object.keys(teamIds).sort((a, b) => a.localeCompare(b, 'de'))) {
    const id = teamIds[name];
    teams[name] = teamAus(await seite(BASIS + 'mannschaftsseite/id/' + id + '.html', 'team-' + id + '.html'), id);
  }
  const heute = new Date();
  const stand = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
  const sdm = { stand, quelle: LIGA_SEITE, spieltage: runden, teams };

  if (PRUEFEN) {
    const D = ligaDaten(sdm);
    const soll = tabelleAusSeite(ligaHtml);
    const ist = D.tabelleAus(sdm.spieltage, Object.keys(teams)).zeilen;
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

  const kopf = '/* Automatisch erzeugt von tools/liga-import.mjs am ' + stand + ' aus\n' +
    '   ' + LIGA_SEITE + '\n' +
    '   Nicht von Hand aendern - nach jedem Spieltag einfach neu erzeugen:\n' +
    '     node tools/liga-import.mjs\n' +
    '   Von Hand gepflegte Ergaenzungen (z. B. unsere Bogen-Aufstellung) stehen\n' +
    '   in js/liga-daten.js (LIGA_HAND) und werden dort dazugemischt.\n' +
    '   Spielerlisten: "*Name" = Gastspieler (bei der Ligaleitung "(n * Gast)"). */\n';
  writeFileSync(ZIEL, kopf + 'window.LIGA_SDM = ' + js(sdm, 0) + ';\n');
  const spiele = Object.values(runden).flat().filter((s) => s.gast).length;
  const ergebnisse = Object.values(runden).flat().filter((s) => s.einzel).length;
  console.log('js/liga-sdm.js geschrieben: ' + Object.keys(runden).length + ' Spieltage, ' + spiele + ' Spiele, ' +
    ergebnisse + ' mit Ergebnis, ' + berichte + ' Spielberichte, ' + Object.keys(teams).length + ' Teams (Stand ' + stand + ').');
}

haupt().catch((e) => { console.error('Liga-Import fehlgeschlagen: ' + (e && e.message || e)); process.exit(1); });
