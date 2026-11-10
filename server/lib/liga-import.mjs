/*
 * Liga-Import: Spielplan, Ergebnisse, alle Spielberichte (16 Einzel je
 * Spiel, Highlights) und die Mannschaftsseiten (Lokal, Adresse, Spielerliste)
 * der 4er 5. Liga von steeldart-muenchen.de, als Text fuer js/liga-sdm.js.
 *
 * Zwei Abnehmer:
 *  - tools/liga-import.mjs (von Hand, schreibt js/liga-sdm.js ins Repo und
 *    prueft mit --pruefen gegen die Tabellen der Webseite),
 *  - server/main.mjs (stuendlich, schreibt die Datei neben die Datenbank
 *    und liefert sie statt der Repo-Fassung aus - so stehen Ergebnisse in
 *    App und Webseite, ohne dass jemand deployt).
 *
 * Keine Abhaengigkeiten: die Seiten sind einfache Tabellen, die Regexe
 * reichen. Aendert die Ligaleitung ihr Layout, wirft spielplanAus statt
 * stillschweigend leere Daten zu liefern - der Server behaelt dann die
 * alte Datei, das CLI bricht ab.
 *
 * Hart abgebrochen wird nur, wenn der Spielplan selbst nicht passt. Ein
 * Spielbericht mit 15 Zeilen (kampflos, Tippfehler der Ligaleitung) oder
 * eine Teamseite ohne Spielerliste ist nur eine Warnung: das Spiel kommt
 * ohne `partien`, das Team ohne `spieler` in die Datei.
 *
 * Schonend fuer die Webseite der Ligaleitung: mit `bekannt` (die bisherige
 * Datei) werden Spielberichte, die schon mit 16 Einzeln vorliegen, und
 * Mannschaftsseiten nicht noch einmal geladen - der stuendliche Lauf ist
 * dann ein einziger Abruf, solange nichts Neues eingetragen ist. `voll`
 * laedt alles neu (nachtraegliche Korrekturen der Ligaleitung).
 */

export const BASIS = 'https://steeldart-muenchen.de/';
export const LIGA_SEITE = BASIS + '4er-liga/4er-5-liga.html';
export const EINZEL_SEITE = BASIS + '70.html';

/* ---------- HTML-Kleinkram ---------- */
const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é' };
export function entschluesseln(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTITAETEN ? ENTITAETEN[n] : m));
}
export function text(html) {
  return entschluesseln(String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
/* "(2 * Gast) Michael Rogge" (so schreibt es die Ligaleitung) -> "*Michael Rogge",
   wie es die App seit jeher kennt (Stern = Gastspieler). */
export function spielerName(roh) {
  const t = text(roh);
  const m = /^\(\s*\d+\s*\*\s*Gast\s*\)\s*(.+)$/.exec(t);
  return m ? '*' + m[1].trim() : t;
}
function isoDatum(de) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(de || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}

/* ---------- Laden aus dem Netz ---------- */
export async function ladenAusNetz(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Blink 180 Liga-Import)' },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' fuer ' + url);
  return r.text();
}

/* ---------- Spielplan ---------- */
export function spielplanAus(html) {
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
export function tabelleAusSeite(html) {
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
export function einzelAusSeite(html) {
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
/* partien ist null, wenn der Bericht nicht 16 Einzel hat - der Aufrufer
   laesst das Feld dann weg; Highlights werden trotzdem gelesen. */
export function spielberichtAus(html, id, warne) {
  let partien = [];
  const re = /<tr>\s*<td><span class="(?:winner|loser)">([\s\S]*?)<\/span><\/td>\s*<td><span class="(?:winner|loser)">([\s\S]*?)<\/span><\/td>\s*<td>\s*(\d+)\s*:\s*(\d+)\s*<\/td>/g;
  let m;
  while ((m = re.exec(html))) partien.push([spielerName(m[1]), spielerName(m[2]), Number(m[3]), Number(m[4])]);
  if (partien.length !== 16) {
    if (warne) warne('Spielbericht ' + id + ': ' + partien.length + ' statt 16 Einzel - Spiel kommt ohne Einzel in die Datei');
    partien = null;
  }
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
export function teamAus(html, id, warne) {
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
  if (!t.spieler.length) {
    if (warne) warne('Mannschaftsseite ' + id + ': keine Spielerliste - Team kommt ohne Spieler in die Datei');
    delete t.spieler;
  }
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

/* Der Text von js/liga-sdm.js zu einem LIGA_SDM-Objekt. */
export function sdmText(sdm) {
  const kopf = '/* Automatisch erzeugt von tools/liga-import.mjs am ' + sdm.stand + ' aus\n' +
    '   ' + LIGA_SEITE + '\n' +
    '   Nicht von Hand aendern - nach jedem Spieltag einfach neu erzeugen:\n' +
    '     node tools/liga-import.mjs\n' +
    '   (Der Server macht das stuendlich selbst, server/lib/liga-import.mjs.)\n' +
    '   Von Hand gepflegte Ergaenzungen (z. B. unsere Bogen-Aufstellung) stehen\n' +
    '   in js/liga-daten.js (LIGA_HAND) und werden dort dazugemischt.\n' +
    '   Spielerlisten: "*Name" = Gastspieler (bei der Ligaleitung "(n * Gast)"). */\n';
  return kopf + 'window.LIGA_SDM = ' + js(sdm, 0) + ';\n';
}

/* Umgekehrt: aus dem Text der Datei das Objekt (die Datei haengt es an
   window). Null, wenn der Text nicht laeuft. */
export function sdmAusText(quelle) {
  try {
    const fenster = {};
    new Function('window', String(quelle || ''))(fenster);
    return fenster.LIGA_SDM && typeof fenster.LIGA_SDM === 'object' ? fenster.LIGA_SDM : null;
  } catch (e) {
    return null;
  }
}

/* Der Stand (Tag des Imports) aus dem Dateitext, ohne ihn auszufuehren. */
export function standAusText(quelle) {
  const m = /\bstand:\s*'(\d{4}-\d{2}-\d{2})'/.exec(String(quelle || ''));
  return m ? m[1] : null;
}

/* Inhalt ohne den Import-Tag: gleich, wenn die Ligaleitung nichts
   geaendert hat - dann schreibt der Server die Datei nicht neu. */
export function sdmInhaltGleich(a, b) {
  if (!a || !b) return false;
  const ohneStand = (s) => ({ ...s, stand: null });
  return JSON.stringify(ohneStand(a)) === JSON.stringify(ohneStand(b));
}

function heuteIso(heute) {
  const d = heute instanceof Date ? heute : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/*
 * Der Import. opt:
 *   laden(url, datei)  liefert das HTML (Netz, Ordner, Test); Vorgabe: Netz
 *   bekannt            bisheriges LIGA_SDM - Spielberichte mit 16 Einzeln und
 *                      Mannschaftsseiten daraus werden nicht neu geladen
 *   voll               alles neu laden, auch Bekanntes
 *   heute              Date fuer den Stand (Tests)
 * Ergebnis: { sdm, text, warnungen, geladen (Zahl der Abrufe), zusammenfassung }
 */
export async function ligaImportieren(opt) {
  opt = opt || {};
  const laden = opt.laden || ((url) => ladenAusNetz(url));
  const bekannt = opt.voll ? null : (opt.bekannt || null);
  const warnungen = [];
  const warne = (t) => warnungen.push(t);
  let geladen = 0;
  const seite = async (url, datei) => { geladen++; return laden(url, datei); };

  const ligaHtml = await seite(LIGA_SEITE, 'liga.html');
  const { runden, teamIds } = spielplanAus(ligaHtml);

  /* Bekannte Spielberichte: je Bericht-Nummer das Spiel von damals. */
  const alteBerichte = {};
  if (bekannt && bekannt.spieltage) {
    Object.values(bekannt.spieltage).flat().forEach((sp) => {
      if (sp && sp.bericht && Array.isArray(sp.partien) && sp.partien.length === 16) alteBerichte[sp.bericht] = sp;
    });
  }
  let berichte = 0, neueBerichte = 0;
  for (const id of Object.keys(runden)) {
    for (const sp of runden[id]) {
      if (!sp.bericht) continue;
      const alt = alteBerichte[sp.bericht];
      if (alt && alt.heim === sp.heim && alt.gast === sp.gast && alt.einzel === sp.einzel) {
        sp.partien = alt.partien;
        if (alt.highlights && alt.highlights.length) sp.highlights = alt.highlights;
        berichte++;
        continue;
      }
      const html = await seite(BASIS + 'spielberichte/id/' + sp.bericht + '.html', 'sb-' + sp.bericht + '.html');
      const b = spielberichtAus(html, sp.bericht, warne);
      if (b.partien) { sp.partien = b.partien; berichte++; neueBerichte++; }
      if (b.highlights.length) sp.highlights = b.highlights;
    }
  }
  const teams = {};
  for (const name of Object.keys(teamIds).sort((a, b) => a.localeCompare(b, 'de'))) {
    const id = teamIds[name];
    const alt = bekannt && bekannt.teams && bekannt.teams[name];
    if (alt && alt.id === id && Array.isArray(alt.spieler) && alt.spieler.length) { teams[name] = alt; continue; }
    teams[name] = teamAus(await seite(BASIS + 'mannschaftsseite/id/' + id + '.html', 'team-' + id + '.html'), id, warne);
  }
  const stand = heuteIso(opt.heute);
  const sdm = { stand, quelle: LIGA_SEITE, spieltage: runden, teams };
  const spiele = Object.values(runden).flat().filter((s) => s.gast).length;
  const ergebnisse = Object.values(runden).flat().filter((s) => s.einzel).length;
  const zusammenfassung = Object.keys(runden).length + ' Spieltage, ' + spiele + ' Spiele, ' + ergebnisse + ' mit Ergebnis, ' +
    berichte + ' Spielberichte' + (bekannt ? ' (' + neueBerichte + ' neu geladen)' : '') + ', ' + Object.keys(teams).length + ' Teams (Stand ' + stand + ', ' + geladen + ' Abrufe)';
  return { sdm, text: sdmText(sdm), warnungen, geladen, zusammenfassung, ligaHtml };
}
