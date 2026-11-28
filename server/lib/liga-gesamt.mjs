/*
 * Liga-Gesamt: die ganze Webseite der Steeldart-Liga München
 * (steeldart-muenchen.de) als ein JSON - fuer die Vorschau-Seite liga.html
 * (nicht oeffentlich, nur fuer Angemeldete, siehe README "Liga-Webseite").
 *
 * Eingelesen werden:
 *  - alle 4er-Ligen, die die Navigation der Startseite nennt (heute 1. bis
 *    5. Liga): Tabelle der Ligaleitung, Spielplan mit Ergebnissen, jeder
 *    Spielbericht (16 Einzel, Highlights), Spielerliste je Mannschaft,
 *  - teams.html (Teamcaptains, Lokal, Telefon, Webseite, Adresse je Team),
 *    lokale.html (alle Spielorte),
 *  - Startseite (Neuigkeiten, kommende Termine), Veranstaltungen,
 *    Regelecke, Downloads und Kontakt.
 *
 * Keine Abhaengigkeiten, Regex-Parsing wie liga-import.mjs (dessen Helfer
 * werden wiederverwendet). Schonend: mit `bekannt` (das letzte Ergebnis)
 * werden Spielberichte, die schon mit 16 Einzeln vorliegen, nie neu
 * geladen, und Mannschafts- und Vereinsseiten nur bei `voll`. Der
 * stuendliche Lauf sind dann 6 Abrufe (Startseite + 5 Ligaseiten) plus
 * neue Spielberichte. Zwischen zwei Abrufen liegt eine kleine Pause.
 *
 * Hart abgebrochen wird nur, wenn keine Liga oder ein Spielplan nicht
 * passt - dann behaelt der Server das alte JSON. Eine kaputte Vereinsseite
 * ist nur eine Warnung; ihr Abschnitt kommt dann aus `bekannt`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BASIS, text, entschluesseln, spielerName, ladenAusNetz,
  spielplanAus, tabelleAusSeite, spielberichtAus, teamAus
} from './liga-import.mjs';

export const VERSION = 1;
/* Rueckfall, falls die Navigation der Startseite nicht lesbar ist. */
const LIGEN_VORGABE = [
  { nr: 1, pfad: '4er-1-liga.html' },
  { nr: 2, pfad: '4er-2-liga.html' },
  { nr: 3, pfad: '4er-3-liga.html' },
  { nr: 4, pfad: '4er-4-liga.html' },
  { nr: 5, pfad: '4er-liga/4er-5-liga.html' }
];

/* ---------- kleine Helfer ---------- */
function absolut(href) {
  const h = entschluesseln(String(href || '').trim());
  if (!h) return null;
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  return BASIS + h.replace(/^\.?\//, '');
}
function isoDatum(de) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(de || '');
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}
/* Der Inhaltsbereich einer Contao-Seite (ohne Kopf, Navigation, Fuss). */
function hauptteil(html) {
  const a = html.indexOf('role="main"');
  if (a < 0) return html;
  const e = html.indexOf('<footer', a);
  return html.slice(a, e > a ? e : undefined);
}
/* Absaetze eines HTML-Stuecks als Textliste. */
function absaetze(html) {
  return [...String(html || '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => text(m[1].replace(/<br\s*\/?>/gi, ' ')))
    .filter((t) => t && !/^Weiterlesen/.test(t));
}

/* ---------- Startseite: Ligen, Neuigkeiten, Termine ---------- */
export function ligenAusStart(html) {
  const ligen = [];
  const re = /<option value="([^"]+)"[^>]*>\s*4er\s*-\s*(\d+)\.\s*Liga\s*<\/option>/g;
  let m;
  while ((m = re.exec(html))) ligen.push({ nr: Number(m[2]), pfad: entschluesseln(m[1]) });
  return ligen;
}
export function startseiteAus(html) {
  const haupt = hauptteil(html);
  const news = [];
  const bre = /<div class="ce_text block">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = bre.exec(haupt))) {
    const t = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[1]);
    const ab = absaetze(m[1]);
    if (t || ab.length) news.push({ titel: t ? text(t[1]) : '', text: ab });
  }
  const willkommen = /<h2 class="ce_headline">([\s\S]*?)<\/h2>/.exec(haupt);
  return { willkommen: willkommen ? text(willkommen[1]) : null, news, termine: termineAus(haupt) };
}
export function termineAus(html) {
  const termine = [];
  const re = /<time datetime="(\d{4}-\d{2}-\d{2})"[^>]*>[\s\S]*?<\/time>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) termine.push({ tag: m[1], titel: text(m[3]), url: absolut(m[2]) });
  return termine;
}

/* ---------- Artikel-Listen (Veranstaltungen, Regelecke) ---------- */
export function artikelAus(html) {
  const liste = [];
  const re = /<article[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(hauptteil(html)))) {
    const t = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[1]);
    if (!t) continue;
    const link = /<p class="more"><a href="([^"]+)"/.exec(m[1]);
    const teaser = absaetze(m[1]).join(' ');
    liste.push({ titel: text(t[1]), teaser: teaser || undefined, url: link ? absolut(link[1]) : undefined });
  }
  return liste;
}

/* ---------- Downloads ---------- */
export function downloadsAus(html) {
  const gruppen = [];
  const re = /<div class="ce_downloads block">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(hauptteil(html)))) {
    const t = /<h\d[^>]*>([\s\S]*?)<\/h\d>/.exec(m[1]);
    const dateien = [...m[1].matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<span class="size">\(([^)]*)\)<\/span><\/a>/g)]
      .map((d) => ({ titel: text(d[2]), groesse: text(d[3]), url: absolut(d[1]) }));
    if (dateien.length) gruppen.push({ titel: t ? text(t[1]) : 'Dateien', dateien });
  }
  return gruppen;
}

/* ---------- Kontakt ---------- */
export function kontaktAus(html) {
  const liste = [];
  const teile = hauptteil(html).split(/<div class="icon-boxes-item/).slice(1);
  for (const t of teile) {
    const rolle = /<h3>([\s\S]*?)<\/h3>/.exec(t);
    if (!rolle) continue;
    const mail = /href="([^"]+)" class="email"/.exec(t);
    const email = mail ? entschluesseln(mail[1]).replace(/^mailto:/i, '') : undefined;
    const name = absaetze(t).filter((x) => x.indexOf('@') < 0 && x !== ' ' && x.trim())[0];
    liste.push({ rolle: text(rolle[1]), name: name ? name.trim() : undefined, email });
  }
  return liste;
}

/* ---------- Spielorte ---------- */
export function lokaleAus(html) {
  const liste = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(hauptteil(html)))) {
    const z = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => text(x[1]));
    if (z.length >= 4 && z[0]) liste.push({ name: z[0], strasse: z[1], plz: z[2], ort: z[3] });
  }
  return liste;
}

/* ---------- teams.html: Captains, Lokal, Telefon, Web je Team ---------- */
export function teamUebersichtAus(html) {
  const teams = {};
  const abschnitte = hauptteil(html).split(/<h2>([^<]*\d+\.\s*Liga[^<]*)<\/h2>/);
  for (let i = 1; i < abschnitte.length; i += 2) {
    const ligaTitel = text(abschnitte[i]);
    const nr = Number((/(\d+)\.\s*Liga/.exec(ligaTitel) || [])[1]) || null;
    const saison = (/(\d{2}\/\d{2})\s*$/.exec(ligaTitel) || [])[1] || null;
    const re = /<tr>\s*<td><a href='mannschaftsseite\/id\/(\d+)\.html'>([\s\S]*?)<\/a><\/td>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = re.exec(abschnitte[i + 1]))) {
      const zellen = [...m[3].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
      const captains = [...(zellen[0] || '').matchAll(/<li>([\s\S]*?)(?=<li>|<\/ul>)/g)]
        .map((x) => text(x[1])).filter(Boolean)
        .map((x) => { const c = /^(TC-\d)\s+(.+)$/.exec(x); return c ? { rolle: c[1], name: c[2] } : { name: x }; });
      const ort = [...(zellen[1] || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
      const t = { id: Number(m[1]), liga: nr, saison, captains };
      for (const o of ort) {
        const tel = /href='tel:([^']+)'/.exec(o);
        if (tel) { t.telefon = text(o); continue; }
        if (!t.lokal) {
          t.lokal = text(o);
          const web = /href='(https?:[^']+)'/.exec(o);
          if (web) t.web = entschluesseln(web[1]);
          continue;
        }
        const adr = text(o).replace(/\s*,\s*/g, ', ');
        if (adr) t.adresse = adr;
      }
      teams[text(m[2])] = t;
    }
  }
  return teams;
}

/* ---------- Eine Liga ---------- */
function bestOf(spieltage) {
  let max = 0;
  for (const st of spieltage) for (const sp of st.spiele) for (const p of sp.partien || []) max = Math.max(max, p[2], p[3]);
  return max >= 3 ? 5 : max === 2 ? 3 : null;
}

/*
 * Der Lauf. opt:
 *   laden(url, datei)  liefert HTML (Netz, Ordner, Test); Vorgabe: Netz
 *   bekannt            letztes Ergebnis (Spielberichte und, ohne voll,
 *                      Mannschafts- und Vereinsseiten werden daraus genommen)
 *   voll               Mannschafts- und Vereinsseiten neu laden
 *   pause              ms zwischen zwei Abrufen (Vorgabe 400, Tests 0)
 *   jetzt              Date fuer den Stand (Tests)
 * Ergebnis: { daten, warnungen, geladen, zusammenfassung }
 */
export async function ligaGesamtLaden(opt) {
  opt = opt || {};
  const laden = opt.laden || ((url) => ladenAusNetz(url));
  const bekannt = opt.bekannt && opt.bekannt.version === VERSION ? opt.bekannt : null;
  const voll = !!opt.voll || !bekannt;
  const pause = opt.pause == null ? 400 : opt.pause;
  const warnungen = [];
  const warne = (t) => warnungen.push(t);
  let geladen = 0;
  const seite = async (url, datei) => {
    if (geladen && pause) await new Promise((r) => setTimeout(r, pause));
    geladen++;
    return laden(url, datei);
  };
  /* Vereinsseiten: Fehler nur als Warnung, dann gilt der alte Abschnitt. */
  const vereinsSeite = async (pfad, lesen, alt) => {
    if (!voll && alt !== undefined) return alt;
    try {
      return lesen(await seite(BASIS + pfad, pfad.replace(/\//g, '_')));
    } catch (e) {
      warne(pfad + ': ' + ((e && e.message) || e));
      return alt;
    }
  };

  const startHtml = await seite(BASIS, 'start.html');
  let ligenListe = ligenAusStart(startHtml);
  if (!ligenListe.length) { warne('Startseite: keine Ligen in der Navigation, nehme 1. bis 5. Liga'); ligenListe = LIGEN_VORGABE; }
  const start = startseiteAus(startHtml);
  const altV = bekannt ? bekannt.verein : {};
  const uebersicht = await vereinsSeite('teams.html', teamUebersichtAus, bekannt ? bekannt.teamUebersicht : undefined) || {};

  /* Bekannte Spielberichte und Mannschaften aus dem letzten Lauf. */
  const alteBerichte = {}, alteTeams = {};
  if (bekannt) {
    for (const l of bekannt.ligen || []) {
      for (const st of l.spieltage || []) for (const sp of st.spiele || []) {
        if (sp.bericht && Array.isArray(sp.partien) && sp.partien.length === 16) alteBerichte[sp.bericht] = sp;
      }
      for (const t of l.teams || []) alteTeams[t.id] = t;
    }
  }

  const ligen = [];
  let berichte = 0, neueBerichte = 0;
  for (const eintrag of ligenListe) {
    const html = await seite(BASIS + eintrag.pfad, 'liga-' + eintrag.nr + '.html');
    const { runden, teamIds } = spielplanAus(html);
    const tabelle = tabelleAusSeite(html);
    if (!tabelle.length) warne(eintrag.nr + '. Liga: keine Tabelle gefunden');
    const spieltage = [];
    for (const id of Object.keys(runden)) {
      const nr = Number(id.slice(2));
      const st = { nr, spiele: [], spielfrei: [] };
      for (const sp of runden[id]) {
        if (!sp.gast) { if (sp.heim) st.spielfrei.push(sp.heim); continue; }
        if (sp.bericht) {
          const alt = alteBerichte[sp.bericht];
          if (alt && alt.heim === sp.heim && alt.gast === sp.gast && alt.einzel === sp.einzel) {
            sp.partien = alt.partien;
            if (alt.highlights) sp.highlights = alt.highlights;
            berichte++;
          } else {
            try {
              const b = spielberichtAus(await seite(BASIS + 'spielberichte/id/' + sp.bericht + '.html', 'sb-' + sp.bericht + '.html'), sp.bericht, warne);
              if (b.partien) { sp.partien = b.partien; berichte++; neueBerichte++; }
              if (b.highlights.length) sp.highlights = b.highlights;
            } catch (e) {
              warne('Spielbericht ' + sp.bericht + ': ' + ((e && e.message) || e));
            }
          }
        }
        st.spiele.push(sp);
      }
      if (!st.spielfrei.length) delete st.spielfrei;
      spieltage.push(st);
    }
    spieltage.sort((a, b) => a.nr - b.nr);

    const teams = [];
    for (const name of Object.keys(teamIds).sort((a, b) => a.localeCompare(b, 'de'))) {
      const id = teamIds[name];
      const u = uebersicht[name] || {};
      let t;
      const alt = alteTeams[id];
      if (!voll && alt && alt.spieler && alt.spieler.length) {
        t = { ...alt };
      } else {
        try {
          t = teamAus(await seite(BASIS + 'mannschaftsseite/id/' + id + '.html', 'team-' + id + '.html'), id, warne);
        } catch (e) {
          warne('Mannschaftsseite ' + id + ': ' + ((e && e.message) || e));
          t = alt ? { ...alt } : { id };
        }
      }
      t.name = name;
      if (u.captains && u.captains.length) t.captains = u.captains;
      /* Lokal, Adresse, Telefon und Webseite gehoeren zusammen: wechselt ein
         Team das Lokal, darf die alte Nummer nicht stehen bleiben (Julius,
         25.11.: DC Lohhof). Ohne Lokal in der Uebersicht bleibt der alte Stand. */
      if (u.lokal) {
        for (const feld of ['lokal', 'adresse', 'telefon', 'web']) {
          if (u[feld]) t[feld] = u[feld];
          else delete t[feld];
        }
      }
      teams.push(t);
    }
    const saison = Object.values(uebersicht).find((x) => x.liga === eintrag.nr && x.saison);
    const liga = {
      nr: eintrag.nr,
      name: eintrag.nr + '. Liga',
      saison: saison ? saison.saison : null,
      url: BASIS + eintrag.pfad,
      bestOf: bestOf(spieltage),
      tabelle,
      spieltage,
      teams
    };
    ligen.push(liga);
  }
  if (!ligen.length) throw new Error('Keine Liga gelesen');

  const verein = {
    willkommen: start.willkommen,
    news: start.news,
    termine: start.termine,
    veranstaltungen: await vereinsSeite('veranstaltungen.html', artikelAus, altV.veranstaltungen),
    regelecke: await vereinsSeite('regelwerk.html', artikelAus, altV.regelecke),
    downloads: await vereinsSeite('download.html', downloadsAus, altV.downloads),
    kontakt: await vereinsSeite('kontakt.html', kontaktAus, altV.kontakt)
  };
  const lokale = await vereinsSeite('lokale.html', lokaleAus, bekannt ? bekannt.lokale : undefined) || [];

  const jetzt = opt.jetzt instanceof Date ? opt.jetzt : new Date();
  const daten = {
    version: VERSION,
    stand: jetzt.toISOString(),
    quelle: BASIS,
    verein,
    lokale,
    teamUebersicht: uebersicht,
    ligen
  };
  const spiele = ligen.reduce((n, l) => n + l.spieltage.reduce((k, st) => k + st.spiele.length, 0), 0);
  const zusammenfassung = ligen.length + ' Ligen, ' + spiele + ' Spiele, ' + berichte + ' Spielberichte (' + neueBerichte + ' neu), ' +
    ligen.reduce((n, l) => n + l.teams.length, 0) + ' Teams, ' + geladen + ' Abrufe' + (voll ? ' (voll)' : '');
  return { daten, warnungen, geladen, zusammenfassung };
}

/* Inhalt ohne Zeitstempel gleich? Dann muss nichts geschrieben werden. */
export function inhaltGleich(a, b) {
  if (!a || !b) return false;
  return JSON.stringify({ ...a, stand: null }) === JSON.stringify({ ...b, stand: null });
}

/* ---------- Datei js/liga-gesamt-daten.js ---------- */
/* JSON mit einer Zeile je Einzel/Spiel statt einer Riesenzeile - so bleiben
   Diffs im Repo lesbar. */
export function datenText(daten) {
  const json = JSON.stringify(daten, null, 1)
    .replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, inner) => '[' + inner.replace(/\s*\n\s*/g, ' ') + ']');
  return '/* Automatisch erzeugt von tools/liga-gesamt.mjs am ' + String(daten.stand).slice(0, 10) + ' aus\n' +
    '   ' + daten.quelle + ' (alle Ligen, Teams, Spielberichte, Vereinsseiten).\n' +
    '   Rueckfall fuer liga.html ohne Server; der Server liefert den stuendlichen\n' +
    '   Stand unter GET /api/liga-gesamt. Nicht von Hand aendern. */\n' +
    'window.LIGA_GESAMT = ' + json + ';\n';
}
export function datenAusText(quelle) {
  try {
    const fenster = {};
    new Function('window', String(quelle || ''))(fenster);
    return fenster.LIGA_GESAMT && typeof fenster.LIGA_GESAMT === 'object' ? fenster.LIGA_GESAMT : null;
  } catch (e) {
    return null;
  }
}

/*
 * Der Dienst fuer server/main.mjs: haelt das aktuelle JSON (Datei neben der
 * Datenbank, sonst die Repo-Fassung js/liga-gesamt-daten.js) und laedt es,
 * wenn `an`, alle `taktMs` neu - einmal am Tag voll.
 */
export function ligaGesamtDienst({ appDir, datenDir, an, taktMs }) {
  const datei = path.join(datenDir, 'liga-gesamt.json');
  let daten = null;
  try { daten = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* noch keine */ }
  if (!daten) {
    try { daten = datenAusText(fs.readFileSync(path.join(appDir, 'js', 'liga-gesamt-daten.js'), 'utf8')); } catch (e) { /* keine */ }
  }
  let vollZuletzt = 0, laeuft = false;
  async function abgleich() {
    if (laeuft) return null;
    laeuft = true;
    const voll = Date.now() - vollZuletzt > 20 * 3600e3;
    try {
      const r = await ligaGesamtLaden({ bekannt: daten, voll });
      if (voll) vollZuletzt = Date.now();
      r.warnungen.forEach((w) => console.warn('[liga-gesamt] ' + w));
      if (!inhaltGleich(r.daten, daten)) {
        daten = r.daten;
        fs.mkdirSync(datenDir, { recursive: true });
        fs.writeFileSync(datei + '.neu', JSON.stringify(daten));
        fs.renameSync(datei + '.neu', datei);
        console.log('[liga-gesamt] neuer Stand: ' + r.zusammenfassung);
        r.geaendert = true;
      }
      return r;
    } catch (e) {
      console.error('[liga-gesamt] Abgleich fehlgeschlagen: ' + ((e && e.message) || e));
      return { fehler: String((e && e.message) || e) };
    } finally {
      laeuft = false;
    }
  }
  if (an) {
    setTimeout(abgleich, 45e3).unref();
    setInterval(abgleich, taktMs || 3600e3).unref();
  }
  return { daten: () => daten, abgleich };
}
