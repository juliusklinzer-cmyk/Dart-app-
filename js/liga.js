/*
 * Liga-Webseite (Vorschau, liga.html): die Seite der Steeldart-Liga
 * Muenchen im Blink-180-Stil - Vorschlag fuer den Liga-Vorstand, nicht
 * oeffentlich (der Server liefert sie nur an Angemeldete aus).
 *
 * Daten: vom Server GET /api/liga-gesamt (stuendlich von
 * steeldart-muenchen.de, server/lib/liga-gesamt.mjs), sonst der
 * Schnappschuss js/liga-gesamt-daten.js (Datei per Doppelklick).
 *
 * Bereiche per Hash: #/ Uebersicht, #/liga/<nr>[/spielplan|spieler|
 * highlights|teams], #/bericht/<id>, #/team/<id>, #/spieler[/<liga>/<team>/<name>],
 * #/teams, #/verein. Alles Abgeleitete (Form, Einzelbilanzen, Highlights)
 * wird hier aus den Spielberichten gerechnet.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var MONATE = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
  var D = null;            // Rohdaten
  var LIGEN = [];          // aufbereitete Ligen
  var BERICHTE = {};       // bericht-id -> { liga, st, sp }
  var TEAMS = {};          // team-id -> { liga, team }

  /* ---------- Kleinkram ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function p2(n) { return String(n).padStart(2, '0'); }
  function heute() {
    if (window.__ligaHeute) return window.__ligaHeute;
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function tagDatum(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; }
  function kurz(iso) { var d = tagDatum(iso); return d ? WT[d.getDay()] + ' ' + p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' : 'offen'; }
  function lang(iso) { var d = tagDatum(iso); return d ? WT[d.getDay()] + ', ' + d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear() : 'Termin offen'; }
  function paar(s) { var m = /^(\d+):(\d+)$/.exec(s || ''); return m ? [+m[1], +m[2]] : null; }
  function klar(roh) { var g = String(roh).charAt(0) === '*'; return { name: g ? String(roh).slice(1).trim() : String(roh).trim(), gast: g }; }
  function quote(a, b) { return a + b ? Math.round(100 * a / (a + b)) + ' %' : '–'; }
  function diff(a, b) { var d = a - b; return (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d); }
  function kodiere(s) { return encodeURIComponent(s).replace(/%20/g, '+'); }
  function dekodiere(s) { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return s; } }
  function karte(adresse, name) { return 'https://maps.apple.com/?q=' + encodeURIComponent((name ? name + ', ' : '') + adresse); }
  var PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>';
  var PFEIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  var RAUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"></path></svg>';

  /* ---------- Aufbereiten ---------- */
  function spielerKey(team, name) { return team + '|' + name; }

  function ligaAufbereiten(l) {
    var L = { roh: l, nr: l.nr, name: l.name, saison: l.saison, bestOf: l.bestOf, url: l.url, teams: l.teams || [], spieltage: l.spieltage || [] };
    L.teamNamen = {};
    L.teams.forEach(function (t) { L.teamNamen[t.name] = t; TEAMS[t.id] = { liga: L, team: t }; });
    L.spiele = [];
    L.spieltage.forEach(function (st) {
      st.spiele.forEach(function (sp) {
        sp._st = st.nr;
        sp._liga = L;
        L.spiele.push(sp);
        if (sp.bericht) BERICHTE[sp.bericht] = { liga: L, st: st, sp: sp };
      });
    });
    /* Tabelle: die der Ligaleitung; fehlt sie, selbst gerechnet. */
    var je = {};
    var zeile = function (t) { return je[t] || (je[t] = { team: t, spiele: 0, g: 0, u: 0, v: 0, lf: 0, la: 0, ef: 0, ea: 0, punkte: 0, form: [] }); };
    L.teams.forEach(function (t) { zeile(t.name); });
    L.spiele.slice().sort(function (a, b) { return (a.tag || '') < (b.tag || '') ? -1 : 1; }).forEach(function (sp) {
      var e = paar(sp.einzel); if (!e || sp.verschoben) return;
      var lg = paar(sp.legs) || [0, 0];
      var h = zeile(sp.heim), g = zeile(sp.gast);
      h.spiele++; g.spiele++;
      h.ef += e[0]; h.ea += e[1]; g.ef += e[1]; g.ea += e[0];
      h.lf += lg[0]; h.la += lg[1]; g.lf += lg[1]; g.la += lg[0];
      if (e[0] > e[1]) { h.g++; g.v++; h.punkte += 2; h.form.push(['S', sp]); g.form.push(['N', sp]); }
      else if (e[0] < e[1]) { g.g++; h.v++; g.punkte += 2; h.form.push(['N', sp]); g.form.push(['S', sp]); }
      else { h.u++; g.u++; h.punkte++; g.punkte++; h.form.push(['U', sp]); g.form.push(['U', sp]); }
    });
    var eigen = Object.keys(je).map(function (k) { return je[k]; }).sort(function (a, b) {
      return b.punkte - a.punkte || (b.lf - b.la) - (a.lf - a.la) || (b.ef - b.ea) - (a.ef - a.ea) || a.team.localeCompare(b.team, 'de');
    });
    var offiziell = (l.tabelle || []).length ? l.tabelle : eigen.map(function (z, i) {
      return { platz: i + 1, team: z.team, spiele: z.spiele, g: z.g, u: z.u, v: z.v, legs: z.lf + ':' + z.la, einzel: z.ef + ':' + z.ea, punkte: z.punkte };
    });
    L.tabelle = offiziell.map(function (z) {
      var x = je[z.team] || { form: [] };
      return Object.assign({}, z, { form: x.form.slice(-5) });
    });
    L.platz = {};
    L.tabelle.forEach(function (z) { L.platz[z.team] = z.platz; });

    /* Einzelbilanzen aus den Spielberichten; Punkte nach dem Schluessel der
       Ligaleitung: Sieger seine Legs plus Leg-Differenz (Best of 3: 2:0 = 4,
       2:1 = 3; Best of 5: 3:0 = 6), Verlierer seine Legs. Gegen alle fuenf
       Einzelranglisten der Seite nachgerechnet. */
    var sp = {};
    var spieler = function (team, roh) {
      var k = klar(roh), key = spielerKey(team, k.name);
      return sp[key] || (sp[key] = { key: key, name: k.name, gast: k.gast, team: team, liga: L, siege: 0, nied: 0, lf: 0, la: 0, punkte: 0, n180: 0, hf: [], sl: [], partien: [], info: '' });
    };
    L.teams.forEach(function (t) { (t.spieler || []).forEach(function (s) { var z = spieler(t.name, s.name); if (s.info) z.info = s.info; }); });
    L.spiele.forEach(function (s) {
      (s.partien || []).forEach(function (p, i) {
        var h = +p[2] || 0, g = +p[3] || 0;
        if (h === g) return;
        var a = spieler(s.heim, p[0]), b = spieler(s.gast, p[1]);
        var buche = function (z, w, v, geg) {
          z.lf += w; z.la += v;
          if (w > v) { z.siege++; z.punkte += 2 * w - v; } else { z.nied++; z.punkte += w; }
          z.partien.push({ sp: s, nr: i + 1, w: w, v: v, gegner: geg });
        };
        buche(a, h, g, b); buche(b, g, h, a);
      });
      (s.highlights || []).forEach(function (e) {
        var z = spieler(e.team, e.wer);
        z.n180 += e.s180 || 0;
        (e.highfinish || []).forEach(function (n) { z.hf.push({ n: n, sp: s }); });
        (e.shortleg || []).forEach(function (n) { z.sl.push({ n: n, sp: s }); });
      });
    });
    L.spieler = Object.keys(sp).map(function (k) { return sp[k]; });
    L.rangliste = L.spieler.filter(function (z) { return z.siege + z.nied > 0; }).sort(function (a, b) {
      return b.punkte - a.punkte || (b.siege - b.nied) - (a.siege - a.nied) || (b.lf - b.la) - (a.lf - a.la) || b.lf - a.lf || a.name.localeCompare(b.name, 'de');
    });
    L.rangliste.forEach(function (z, i) { z.rang = i + 1; });
    L.spielerNach = sp;
    return L;
  }

  function aufbereiten(d) {
    D = d;
    BERICHTE = {}; TEAMS = {};
    LIGEN = (d.ligen || []).map(ligaAufbereiten);
  }
  function liga(nr) { for (var i = 0; i < LIGEN.length; i++) if (String(LIGEN[i].nr) === String(nr)) return LIGEN[i]; return null; }
  function alleSpiele() { return LIGEN.reduce(function (a, l) { return a.concat(l.spiele); }, []); }
  function ligaLabel(L) { return '4er · ' + L.name; }

  /* ---------- Bausteine ---------- */
  function teamLink(L, name, cls) {
    var t = L.teamNamen[name];
    return t ? '<a class="tl ' + (cls || '') + '" href="#/team/' + t.id + '">' + esc(name) + '</a>' : '<span class="tl ' + (cls || '') + '">' + esc(name) + '</span>';
  }
  function spielerLink(z, mitTeam) {
    return '<a class="sl" href="#/spieler/' + z.liga.nr + '/' + kodiere(z.team) + '/' + kodiere(z.name) + '">' + esc(z.name) +
      (z.gast ? ' <span class="gast" title="Gastspieler">Gast</span>' : '') + '</a>' + (mitTeam ? '<span class="sl-team">' + esc(z.team) + '</span>' : '');
  }
  function formHtml(form) {
    if (!form || !form.length) return '<span class="form leer">–</span>';
    return '<span class="form" aria-label="Form">' + form.map(function (f) {
      var t = { S: 'Sieg', U: 'Unentschieden', N: 'Niederlage' }[f[0]];
      return '<i class="f-' + f[0] + '" title="' + t + ': ' + esc(f[1].heim + ' ' + f[1].einzel + ' ' + f[1].gast) + '">' + f[0] + '</i>';
    }).join('') + '</span>';
  }
  /* Eine Spielzeile (Spielplan, Uebersicht, Teamseite). */
  function spielZeile(sp, opt) {
    opt = opt || {};
    var L = sp._liga, e = paar(sp.einzel);
    var hw = e && e[0] > e[1], gw = e && e[1] > e[0];
    var mitte = e ? '<span class="stand">' + e[0] + '<b>:</b>' + e[1] + '</span>' : sp.verschoben ? '<span class="stand offen">versch.</span>' : '<span class="stand offen">–:–</span>';
    var meta = [opt.liga ? L.name : '', opt.mitDatum === false ? '' : kurz(sp.tag), sp.ort || ''].filter(Boolean).map(esc).join(' · ');
    var inhalt =
      '<span class="sz-meta">' + meta + (sp.legs ? '<span class="sz-legs">Legs ' + esc(sp.legs) + '</span>' : '') + '</span>' +
      '<span class="sz-paar"><span class="h' + (hw ? ' w' : '') + '">' + esc(sp.heim) + '</span>' + mitte + '<span class="g' + (gw ? ' w' : '') + '">' + esc(sp.gast) + '</span></span>';
    if (sp.bericht && sp.partien) return '<a class="sz mit-bericht" href="#/bericht/' + sp.bericht + '">' + inhalt + '<span class="sz-pfeil">' + PFEIL + '</span></a>';
    return '<div class="sz">' + inhalt + '<span class="sz-pfeil"></span></div>';
  }
  function kopf(label, titel, unter) {
    return '<header class="bk"><span class="bk-label">' + label + '</span><h1 class="bk-titel">' + titel + '</h1>' + (unter ? '<p class="bk-unter">' + unter + '</p>' : '') + '</header>';
  }
  function leer(t) { return '<p class="leer">' + esc(t) + '</p>'; }

  /* ---------- Uebersicht ---------- */
  function startSeite() {
    var v = D.verein || {};
    var news = (v.news || [])[0];
    var alle = alleSpiele();
    var gespielt = alle.filter(function (s) { return paar(s.einzel); });
    var einzel = gespielt.reduce(function (n, s) { return n + (s.partien ? s.partien.length : 0); }, 0);
    var n180 = LIGEN.reduce(function (n, L) { return n + L.spieler.reduce(function (k, z) { return k + z.n180; }, 0); }, 0);
    var teams = LIGEN.reduce(function (n, L) { return n + L.teams.length; }, 0);
    var h = heute();
    var kommend = alle.filter(function (s) { return !paar(s.einzel) && !s.verschoben && s.tag && s.tag >= h; }).sort(function (a, b) { return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : a._liga.nr - b._liga.nr; });
    var naechsteTage = [];
    kommend.forEach(function (s) { if (naechsteTage.indexOf(s.tag) < 0 && naechsteTage.length < 4) naechsteTage.push(s.tag); });
    var letzte = gespielt.slice().sort(function (a, b) { return (b.tag || '') < (a.tag || '') ? -1 : (b.tag || '') > (a.tag || '') ? 1 : a._liga.nr - b._liga.nr; }).slice(0, 8);
    var saison = (LIGEN[0] && LIGEN[0].saison) ? '20' + LIGEN[0].saison.replace('/', '/20') : '';

    var html = '<section class="held">' +
      '<div class="held-text">' +
        '<span class="bk-label">Steeldart München e.V.' + (saison ? ' · Saison ' + esc(saison) : '') + '</span>' +
        '<h1 class="held-titel">' + esc(news && news.titel ? news.titel : 'Liga-Saison') + '</h1>' +
        (news ? news.text.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') : '') +
      '</div>' +
      '<div class="kacheln">' +
        kachel(LIGEN.length, 'Ligen') + kachel(teams, 'Teams') +
        kachel(gespielt.length + '<small>/' + alle.length + '</small>', 'Spiele') + kachel(einzel, 'Einzel') + kachel(n180, '180er') +
        kachel(spitzenHf(), 'Höchstes Finish') +
      '</div>' +
    '</section>';

    html += '<section class="zwei-spalten">' +
      '<div class="block"><h2 class="titel">Nächste Spiele</h2>' +
        (naechsteTage.length ? naechsteTage.map(function (tag) {
          return '<div class="tag-gruppe"><h3 class="tag-kopf">' + esc(lang(tag)) + '</h3><div class="liste">' +
            kommend.filter(function (s) { return s.tag === tag; }).map(function (s) { return spielZeile(s, { liga: true, mitDatum: false }); }).join('') + '</div></div>';
        }).join('') : leer('Keine offenen Spiele mit Termin.')) +
      '</div>' +
      '<div class="block"><h2 class="titel">Letzte Ergebnisse</h2><div class="liste">' +
        (letzte.length ? letzte.map(function (s) { return spielZeile(s, { liga: true }); }).join('') : leer('Noch keine Ergebnisse.')) +
      '</div></div>' +
    '</section>';

    html += '<section class="block"><h2 class="titel">Tabellenspitze</h2><div class="liga-karten">' +
      LIGEN.map(function (L) {
        return '<a class="liga-karte" href="#/liga/' + L.nr + '">' +
          '<span class="lk-kopf"><span class="lk-name">' + esc(L.name) + '</span><span class="lk-modus">' + (L.bestOf ? 'Best of ' + L.bestOf : '') + '</span></span>' +
          '<ol class="lk-top">' + L.tabelle.slice(0, 3).map(function (z) {
            return '<li><span class="r">' + z.platz + '</span><span class="t">' + esc(z.team) + '</span><span class="p">' + z.punkte + '</span></li>';
          }).join('') + '</ol>' +
          '<span class="lk-mehr">Tabelle, Spielplan, Spieler' + PFEIL + '</span></a>';
      }).join('') + '</div></section>';

    var termine = v.termine || [];
    if (termine.length) {
      html += '<section class="block"><h2 class="titel">Termine</h2><div class="liste">' + termine.map(terminZeile).join('') + '</div></section>';
    }
    return html;
  }
  function kachel(zahl, label) { return '<div class="kachel"><span class="kz">' + zahl + '</span><span class="kl">' + esc(label) + '</span></div>'; }
  function spitzenHf() {
    var max = 0;
    LIGEN.forEach(function (L) { L.spieler.forEach(function (z) { z.hf.forEach(function (h) { if (h.n > max) max = h.n; }); }); });
    return max || '–';
  }
  function terminZeile(t) {
    var d = tagDatum(t.tag);
    return '<a class="termin" href="' + esc(t.url) + '" target="_blank" rel="noopener">' +
      '<span class="wann"><span class="datum">' + (d ? p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' : '') + '</span><span class="wd">' + (d ? WT[d.getDay()] + ' ' + d.getFullYear() : '') + '</span></span>' +
      '<span class="was">' + esc(t.titel) + '</span><span class="raus">' + RAUS + '</span></a>';
  }

  /* ---------- Liga ---------- */
  var REITER = [['tabelle', 'Tabelle'], ['spielplan', 'Spielplan'], ['spieler', 'Spieler'], ['highlights', 'Highlights'], ['teams', 'Teams']];
  function ligaSeite(nr, reiter, extra) {
    var L = liga(nr) || LIGEN[LIGEN.length - 1];
    reiter = reiter || 'tabelle';
    var gespielt = L.spiele.filter(function (s) { return paar(s.einzel); }).length;
    var html = '<div class="liga-wahl" role="tablist" aria-label="Liga">' + LIGEN.map(function (x) {
      return '<a href="#/liga/' + x.nr + (reiter !== 'tabelle' ? '/' + reiter : '') + '" class="chip' + (x === L ? ' an' : '') + '"' + (x === L ? ' aria-current="page"' : '') + '>' + esc(x.name) + '</a>';
    }).join('') + '</div>';
    html += kopf('4er-Liga' + (L.saison ? ' · Saison ' + esc(L.saison) : ''), esc(L.name),
      L.teams.length + ' Teams · ' + gespielt + ' von ' + L.spiele.length + ' Spielen gespielt' + (L.bestOf ? ' · Einzel Best of ' + L.bestOf + ' Legs' : ''));
    html += '<nav class="reiter" aria-label="Ansicht">' + REITER.map(function (r) {
      return '<a href="#/liga/' + L.nr + '/' + r[0] + '" class="' + (r[0] === reiter ? 'an' : '') + '"' + (r[0] === reiter ? ' aria-current="page"' : '') + '>' + r[1] + '</a>';
    }).join('') + '</nav>';
    if (reiter === 'spielplan') html += spielplanHtml(L, extra);
    else if (reiter === 'spieler') html += ranglisteHtml(L);
    else if (reiter === 'highlights') html += highlightsHtml(L);
    else if (reiter === 'teams') html += teamKarten(L);
    else html += tabelleHtml(L);
    return html;
  }

  function tabelleHtml(L) {
    if (!L.tabelle.length) return leer('Noch keine Tabelle.');
    return '<div class="tabelle-rahmen"><table class="tab tab-liga">' +
      '<thead><tr><th class="c-r" scope="col">#</th><th scope="col">Team</th><th class="c-n" scope="col" title="Spiele">Sp.</th><th class="c-n breit" scope="col">G</th><th class="c-n breit" scope="col">U</th><th class="c-n breit" scope="col">V</th>' +
      '<th class="c-n mittel" scope="col">Einzel</th><th class="c-n breit" scope="col">Legs</th><th class="c-n" scope="col" title="Punkte">Pkt.</th><th class="c-form mittel" scope="col">Form</th></tr></thead><tbody>' +
      L.tabelle.map(function (z) {
        var e = paar(z.einzel) || [0, 0];
        var hoch = L.nr > 1 && z.platz <= 2 && Number(z.spiele) > 0;   // Aufstiegsplaetze (SWO Punkt 2), aus der 1. Liga geht es nicht hoeher
        return '<tr' + (hoch ? ' class="aufstieg"' : '') + '><td class="c-r">' + z.platz + '</td><td class="c-team">' + teamLink(L, z.team) + '<span class="schmal unter">' + z.g + '-' + z.u + '-' + z.v + ' · Einzel ' + esc(z.einzel) + '</span></td>' +
          '<td class="c-n">' + z.spiele + '</td><td class="c-n breit">' + z.g + '</td><td class="c-n breit">' + z.u + '</td><td class="c-n breit">' + z.v + '</td>' +
          '<td class="c-n mittel">' + esc(z.einzel) + ' <span class="leise">' + diff(e[0], e[1]) + '</span></td><td class="c-n breit leise">' + esc(z.legs) + '</td>' +
          '<td class="c-n c-pkt">' + z.punkte + '</td><td class="c-form mittel">' + formHtml(z.form) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="notiz">Sieg 2 Punkte, Unentschieden 1. Reihenfolge und Werte wie bei der Ligaleitung; Form = letzte fünf Spiele.' + (L.nr > 1 ? ' Grün: Aufstiegsplätze (regulär Platz 1 und 2).' : '') + '</p>';
  }

  function aktuellerSpieltag(L) {
    var h = heute();
    var offen = L.spieltage.filter(function (st) { return st.spiele.some(function (s) { return !paar(s.einzel) && s.tag && s.tag >= h; }); });
    if (offen.length) {
      /* Der Spieltag mit dem fruehesten offenen Termin. */
      offen.sort(function (a, b) { var t = function (st) { return st.spiele.filter(function (s) { return !paar(s.einzel) && s.tag && s.tag >= h; }).map(function (s) { return s.tag; }).sort()[0]; }; return t(a) < t(b) ? -1 : 1; });
      return offen[0].nr;
    }
    var gesp = L.spieltage.filter(function (st) { return st.spiele.some(function (s) { return paar(s.einzel); }); });
    return gesp.length ? gesp[gesp.length - 1].nr : (L.spieltage[0] || {}).nr;
  }
  function spielplanHtml(L, stNr) {
    var nr = Number(stNr) || aktuellerSpieltag(L);
    var st = L.spieltage.filter(function (x) { return x.nr === nr; })[0] || L.spieltage[0];
    if (!st) return leer('Kein Spielplan.');
    var html = '<div class="st-wahl" aria-label="Spieltag">' + L.spieltage.map(function (x) {
      var fertig = x.spiele.length && x.spiele.every(function (s) { return paar(s.einzel); });
      var teil = x.spiele.some(function (s) { return paar(s.einzel); });
      return '<a href="#/liga/' + L.nr + '/spielplan/' + x.nr + '" class="st' + (x === st ? ' an' : '') + (fertig ? ' fertig' : teil ? ' teil' : '') + '"' + (x === st ? ' aria-current="page"' : '') + ' title="' + x.nr + '. Spieltag">' + x.nr + '</a>';
    }).join('') + '</div>';
    var tage = st.spiele.map(function (s) { return s.tag; }).filter(Boolean).sort();
    html += '<div class="st-kopf"><h2 class="titel">' + st.nr + '. Spieltag</h2><span class="leise">' +
      (tage.length ? esc(kurz(tage[0])) + (tage[tage.length - 1] !== tage[0] ? ' bis ' + esc(kurz(tage[tage.length - 1])) : '') : '') + '</span></div>';
    html += '<div class="liste">' + st.spiele.slice().sort(function (a, b) { return (a.tag || '9') < (b.tag || '9') ? -1 : 1; }).map(function (s) { return spielZeile(s); }).join('') + '</div>';
    if (st.spielfrei && st.spielfrei.length) html += '<p class="notiz">Spielfrei: ' + st.spielfrei.map(esc).join(', ') + '</p>';
    return html;
  }

  function ranglisteHtml(L) {
    if (!L.rangliste.length) return leer('Noch keine Spielberichte.');
    return '<div class="tabelle-rahmen"><table class="tab tab-spieler">' +
      '<thead><tr><th class="c-r" scope="col">#</th><th scope="col">Spieler</th><th class="c-n" scope="col" title="Einzel gewonnen:verloren">Einzel</th><th class="c-n mittel" scope="col">Quote</th><th class="c-n breit" scope="col">Legs</th><th class="c-n breit" scope="col">180</th><th class="c-n breit" scope="col" title="Höchstes Finish">HF</th><th class="c-n" scope="col" title="Punkte der Einzelrangliste">Pkt.</th></tr></thead><tbody>' +
      L.rangliste.map(function (z) {
        var hf = z.hf.reduce(function (m, h) { return Math.max(m, h.n); }, 0);
        return '<tr><td class="c-r">' + z.rang + '</td><td class="c-team">' + spielerLink(z, true) + '</td><td class="c-n">' + z.siege + ':' + z.nied + '</td><td class="c-n mittel">' + quote(z.siege, z.nied) + '</td>' +
          '<td class="c-n breit leise">' + z.lf + ':' + z.la + '</td><td class="c-n breit">' + (z.n180 || '') + '</td><td class="c-n breit">' + (hf || '') + '</td><td class="c-n c-pkt">' + z.punkte + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="notiz">Gerechnet aus allen Spielberichten. Punkte wie in der Einzelrangliste der Ligaleitung: Sieger seine Legs plus Leg-Differenz, Verlierer seine gewonnenen Legs.</p>';
  }

  function highlightsHtml(L) {
    var s180 = L.spieler.filter(function (z) { return z.n180; }).sort(function (a, b) { return b.n180 - a.n180 || a.name.localeCompare(b.name, 'de'); });
    var hf = [], sl = [];
    L.spieler.forEach(function (z) {
      z.hf.forEach(function (h) { hf.push({ z: z, n: h.n, sp: h.sp }); });
      z.sl.forEach(function (h) { sl.push({ z: z, n: h.n, sp: h.sp }); });
    });
    hf.sort(function (a, b) { return b.n - a.n; });
    sl.sort(function (a, b) { return a.n - b.n; });
    var liste = function (titel, zeilen, wert, einheit) {
      return '<div class="hl-karte"><h2 class="titel klein">' + titel + '</h2>' + (zeilen.length ? '<ol class="hl-liste">' + zeilen.slice(0, 12).map(function (x, i) {
        return '<li><span class="r">' + (i + 1) + '</span><span class="w">' + spielerLink(x.z || x, true) + '</span><span class="n">' + wert(x) + (einheit ? '<small>' + einheit + '</small>' : '') + '</span></li>';
      }).join('') + '</ol>' : leer('Noch keine.')) + '</div>';
    };
    return '<div class="hl-raster">' +
      liste('180er', s180, function (z) { return z.n180; }, '×') +
      liste('Highfinishes', hf, function (x) { return x.n; }) +
      liste('Shortlegs', sl, function (x) { return x.n; }, 'Darts') +
      '</div><p class="notiz">Aus den Highlights der Spielberichte; Shortlegs nach Zahl der Darts.</p>';
  }

  function teamKarten(L) {
    return '<div class="team-raster">' + L.teams.slice().sort(function (a, b) { return (L.platz[a.name] || 99) - (L.platz[b.name] || 99); }).map(function (t) {
      var cap = (t.captains || []).map(function (c) { return c.name; }).join(', ');
      return '<a class="team-karte" href="#/team/' + t.id + '">' +
        '<span class="tk-platz">' + (L.platz[t.name] ? L.platz[t.name] + '.' : '') + '</span>' +
        '<span class="tk-name">' + esc(t.name) + '</span>' +
        '<span class="tk-ort">' + PIN + esc(t.lokal || 'Lokal offen') + '</span>' +
        '<span class="tk-info">' + (t.spieler ? t.spieler.length + ' Spieler' : '') + (cap ? ' · TC ' + esc(cap) : '') + '</span>' +
      '</a>';
    }).join('') + '</div>';
  }

  /* ---------- Spielbericht ---------- */
  function berichtSeite(id) {
    var b = BERICHTE[id];
    if (!b || !b.sp.partien) return kopf('Spielbericht', 'Nicht gefunden', 'Diesen Spielbericht gibt es nicht (mehr).');
    var L = b.liga, sp = b.sp, e = paar(sp.einzel) || [0, 0];
    var html = '<a class="zurueck" href="#/liga/' + L.nr + '/spielplan/' + b.st.nr + '">' + esc(L.name) + ' · ' + b.st.nr + '. Spieltag</a>';
    html += '<section class="bericht-kopf">' +
      '<span class="bk-label">Spielbericht · ' + esc(lang(sp.tag)) + (sp.ort ? ' · ' + esc(sp.ort) : '') + '</span>' +
      '<div class="ergebnis-gross">' +
        '<span class="eg-team' + (e[0] > e[1] ? ' w' : '') + '">' + teamLink(L, sp.heim) + '</span>' +
        '<span class="eg-stand">' + e[0] + '<b>:</b>' + e[1] + '</span>' +
        '<span class="eg-team b' + (e[1] > e[0] ? ' w' : '') + '">' + teamLink(L, sp.gast) + '</span>' +
      '</div>' +
      '<p class="bk-unter mitte">Einzel ' + esc(sp.einzel) + (sp.legs ? ' · Legs ' + esc(sp.legs) : '') + '</p>' +
    '</section>';
    html += '<section class="zwei-spalten breit-links"><div class="block"><h2 class="titel klein">Die 16 Einzel</h2><ol class="einzel">' +
      sp.partien.map(function (p, i) {
        var a = klar(p[0]), g = klar(p[1]), hw = p[2] > p[3];
        var za = L.spielerNach[spielerKey(sp.heim, a.name)], zg = L.spielerNach[spielerKey(sp.gast, g.name)];
        return '<li><span class="en">' + (i + 1) + '</span><span class="es h' + (hw ? ' w' : '') + '">' + (za ? spielerLink(za) : esc(a.name)) + '</span>' +
          '<span class="el">' + p[2] + ':' + p[3] + '</span><span class="es g' + (!hw ? ' w' : '') + '">' + (zg ? spielerLink(zg) : esc(g.name)) + '</span></li>';
      }).join('') + '</ol></div>';
    /* Bilanz je Spieler in diesem Spiel */
    var bil = {};
    sp.partien.forEach(function (p) {
      [[sp.heim, p[0], p[2], p[3]], [sp.gast, p[1], p[3], p[2]]].forEach(function (x) {
        var k = klar(x[1]), key = spielerKey(x[0], k.name);
        var z = bil[key] || (bil[key] = { team: x[0], name: k.name, s: 0, n: 0, lf: 0, la: 0 });
        if (x[2] > x[3]) z.s++; else z.n++;
        z.lf += x[2]; z.la += x[3];
      });
    });
    var seite = function (team) {
      return '<div class="bil-team"><h3 class="tag-kopf">' + esc(team) + '</h3>' + Object.keys(bil).map(function (k) { return bil[k]; }).filter(function (z) { return z.team === team; })
        .sort(function (a, b) { return b.s - a.s || (b.lf - b.la) - (a.lf - a.la); }).map(function (z) {
          var voll = L.spielerNach[spielerKey(z.team, z.name)];
          return '<div class="bil"><span>' + (voll ? spielerLink(voll) : esc(z.name)) + '</span><span class="leise">Legs ' + z.lf + ':' + z.la + '</span><b>' + z.s + ':' + z.n + '</b></div>';
        }).join('') + '</div>';
    };
    html += '<div class="block"><h2 class="titel klein">Spieler</h2>' + seite(sp.heim) + seite(sp.gast);
    if (sp.highlights && sp.highlights.length) {
      html += '<h2 class="titel klein abstand">Highlights</h2>' + sp.highlights.map(function (h) {
        var k = klar(h.wer), z = L.spielerNach[spielerKey(h.team, k.name)];
        return '<div class="bil"><span>' + (z ? spielerLink(z) : esc(k.name)) + '</span><span class="hl-was">' + esc(h.was) + '</span></div>';
      }).join('');
    }
    html += '</div></section>';
    html += '<p class="notiz"><a href="https://steeldart-muenchen.de/spielberichte/id/' + encodeURIComponent(id) + '.html" target="_blank" rel="noopener">Original-Spielbericht bei der Ligaleitung' + RAUS + '</a></p>';
    return html;
  }

  /* ---------- Team ---------- */
  function teamSeite(id) {
    var x = TEAMS[id];
    if (!x) return kopf('Team', 'Nicht gefunden', '');
    var L = x.liga, t = x.team;
    var z = L.tabelle.filter(function (r) { return r.team === t.name; })[0];
    var html = '<a class="zurueck" href="#/liga/' + L.nr + '/teams">' + esc(L.name) + ' · Teams</a>';
    html += kopf(esc(L.name) + (z ? ' · Platz ' + z.platz : ''), esc(t.name), z ? z.punkte + ' Punkte · ' + z.g + ' Siege, ' + z.u + ' Unentschieden, ' + z.v + ' Niederlagen · Einzel ' + esc(z.einzel) : '');
    html += '<section class="zwei-spalten breit-rechts">';
    html += '<div class="block"><div class="info-karte">' +
      '<span class="kt">Spielort</span><span class="ik-lokal">' + esc(t.lokal || 'offen') + '</span>' +
      (t.adresse ? '<a class="ik-zeile" href="' + esc(karte(t.adresse, t.lokal)) + '" target="_blank" rel="noopener">' + PIN + esc(t.adresse) + '</a>' : '') +
      (t.telefon ? '<a class="ik-zeile" href="tel:' + esc(t.telefon.replace(/[^+\d]/g, '')) + '">' + esc(t.telefon) + '</a>' : '') +
      (t.web ? '<a class="ik-zeile" href="' + esc(t.web) + '" target="_blank" rel="noopener">' + esc(t.web.replace(/^https?:\/\//, '').replace(/\/$/, '')) + RAUS + '</a>' : '') +
      ((t.captains || []).length ? '<span class="kt abstand">Teamcaptain</span>' + t.captains.map(function (c) { return '<span class="ik-tc">' + (c.rolle ? '<small>' + esc(c.rolle) + '</small>' : '') + esc(c.name) + '</span>'; }).join('') : '') +
      (z ? '<span class="kt abstand">Form</span>' + formHtml(z.form) : '') +
    '</div></div>';
    var kader = L.spieler.filter(function (s) { return s.team === t.name; }).sort(function (a, b) {
      return (b.siege + b.nied > 0) - (a.siege + a.nied > 0) || b.punkte - a.punkte || a.name.localeCompare(b.name, 'de');
    });
    html += '<div class="block"><h2 class="titel klein">Spieler</h2>' + (kader.length ? '<div class="tabelle-rahmen"><table class="tab"><thead><tr><th scope="col">Name</th><th class="c-n" scope="col">Einzel</th><th class="c-n mittel" scope="col">Quote</th><th class="c-n breit" scope="col">Legs</th><th class="c-n" scope="col" title="Platz in der Einzelrangliste">Rang</th></tr></thead><tbody>' +
      kader.map(function (s) {
        var hat = s.siege + s.nied > 0;
        return '<tr><td class="c-team">' + spielerLink(s) + (s.info ? ' <span class="tc">' + esc(s.info) + '</span>' : '') + '</td><td class="c-n">' + (hat ? s.siege + ':' + s.nied : '–') + '</td><td class="c-n mittel">' + (hat ? quote(s.siege, s.nied) : '') + '</td><td class="c-n breit leise">' + (hat ? s.lf + ':' + s.la : '') + '</td><td class="c-n">' + (s.rang || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : leer('Keine Spielerliste.')) + '</div>';
    html += '</section>';
    var spiele = L.spiele.filter(function (s) { return s.heim === t.name || s.gast === t.name; }).sort(function (a, b) { return (a.tag || '9') < (b.tag || '9') ? -1 : 1; });
    html += '<section class="block"><h2 class="titel klein">Spielplan</h2><div class="liste">' + spiele.map(function (s) { return spielZeile(s); }).join('') + '</div></section>';
    return html;
  }

  /* ---------- Spieler ---------- */
  function spielerSuche(q) {
    var html = kopf('Alle Ligen', 'Spieler', 'Einzelbilanzen aus allen Spielberichten der Saison.');
    html += '<div class="suche"><input type="search" id="suche" placeholder="Spieler oder Team suchen" autocomplete="off" value="' + esc(q || '') + '" aria-label="Spieler oder Team suchen"></div><div id="such-ergebnis"></div>';
    return html;
  }
  function suchErgebnis(q) {
    q = String(q || '').trim().toLowerCase();
    var box = $('such-ergebnis');
    if (!box) return;
    if (!q) {
      box.innerHTML = '<div class="hl-raster">' + LIGEN.map(function (L) {
        return '<div class="hl-karte"><h2 class="titel klein"><a href="#/liga/' + L.nr + '/spieler">' + esc(L.name) + '</a></h2><ol class="hl-liste">' + L.rangliste.slice(0, 5).map(function (z) {
          return '<li><span class="r">' + z.rang + '</span><span class="w">' + spielerLink(z, true) + '</span><span class="n">' + z.siege + ':' + z.nied + '</span></li>';
        }).join('') + '</ol></div>';
      }).join('') + '</div>';
      return;
    }
    var treffer = [];
    LIGEN.forEach(function (L) { L.spieler.forEach(function (z) { if (z.name.toLowerCase().indexOf(q) >= 0 || z.team.toLowerCase().indexOf(q) >= 0) treffer.push(z); }); });
    treffer.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    box.innerHTML = treffer.length ? '<div class="tabelle-rahmen"><table class="tab"><thead><tr><th scope="col">Spieler</th><th class="c-n breit" scope="col">Liga</th><th class="c-n" scope="col">Einzel</th><th class="c-n mittel" scope="col">Quote</th></tr></thead><tbody>' +
      treffer.slice(0, 80).map(function (z) {
        var hat = z.siege + z.nied > 0;
        return '<tr><td class="c-team">' + spielerLink(z, true) + '</td><td class="c-n breit leise">' + z.liga.nr + '.</td><td class="c-n">' + (hat ? z.siege + ':' + z.nied : '–') + '</td><td class="c-n mittel">' + (hat ? quote(z.siege, z.nied) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (treffer.length > 80 ? '<p class="notiz">' + (treffer.length - 80) + ' weitere – genauer suchen.</p>' : '')
      : leer('Niemand gefunden.');
  }
  function spielerSeite(nr, team, name) {
    var L = liga(nr), z = L && L.spielerNach[spielerKey(team, name)];
    if (!z) return kopf('Spieler', 'Nicht gefunden', '');
    var t = L.teamNamen[team];
    var html = '<a class="zurueck" href="' + (t ? '#/team/' + t.id : '#/spieler') + '">' + esc(team) + '</a>';
    html += kopf(esc(L.name) + ' · ' + esc(team) + (z.gast ? ' · Gastspieler' : '') + (z.info ? ' · ' + esc(z.info) : ''), esc(z.name), z.rang ? 'Platz ' + z.rang + ' von ' + L.rangliste.length + ' in der Einzelrangliste' : 'Noch kein Einzel in dieser Saison');
    var hf = z.hf.reduce(function (m, h) { return Math.max(m, h.n); }, 0);
    var sl = z.sl.reduce(function (m, h) { return m ? Math.min(m, h.n) : h.n; }, 0);
    html += '<div class="kacheln reihe">' + kachel(z.siege + ':' + z.nied, 'Einzel') + kachel(quote(z.siege, z.nied), 'Quote') + kachel(z.lf + ':' + z.la, 'Legs') +
      kachel(z.punkte, 'Punkte') + (z.n180 ? kachel(z.n180, '180er') : '') + (hf ? kachel(hf, 'Höchstes Finish') : '') + (sl ? kachel(sl, 'Bestes Shortleg') : '') + '</div>';
    if (z.partien.length) {
      html += '<section class="block"><h2 class="titel klein">Alle Einzel</h2><div class="liste">' + z.partien.slice().sort(function (a, b) { return (a.sp.tag || '') < (b.sp.tag || '') ? -1 : 1; }).map(function (p) {
        var s = p.sp, gegTeam = s.heim === team ? s.gast : s.heim, w = p.w > p.v;
        return '<a class="pz" href="#/bericht/' + s.bericht + '"><span class="pz-meta">' + esc(kurz(s.tag)) + ' · ' + esc(gegTeam) + '</span>' +
          '<span class="pz-geg">gegen <b>' + esc(p.gegner.name) + '</b></span><span class="pz-erg' + (w ? ' w' : '') + '">' + p.w + ':' + p.v + '</span></a>';
      }).join('') + '</div></section>';
    }
    return html;
  }

  /* ---------- Teams & Lokale ---------- */
  function teamsSeite() {
    var html = kopf('Alle Ligen', 'Teams &amp; Lokale', LIGEN.reduce(function (n, L) { return n + L.teams.length; }, 0) + ' Teams in ' + LIGEN.length + ' Ligen, ' + (D.lokale || []).length + ' Spielorte.');
    html += LIGEN.map(function (L) { return '<section class="block"><h2 class="titel klein"><a href="#/liga/' + L.nr + '">' + esc(L.name) + '</a></h2>' + teamKarten(L) + '</section>'; }).join('');
    var lokale = D.lokale || [];
    if (lokale.length) {
      var wer = {};
      LIGEN.forEach(function (L) { L.teams.forEach(function (t) { if (t.lokal) (wer[t.lokal] = wer[t.lokal] || []).push(t); }); });
      html += '<section class="block"><h2 class="titel">Spielorte</h2><div class="lokal-raster">' + lokale.map(function (o) {
        var adr = o.strasse + ', ' + o.plz + ' ' + o.ort;
        return '<div class="lokal"><span class="lo-name">' + esc(o.name) + '</span><a class="lo-adr" href="' + esc(karte(adr, o.name)) + '" target="_blank" rel="noopener">' + PIN + esc(adr) + '</a>' +
          '<span class="lo-teams">' + (wer[o.name] || []).map(function (t) { return '<a href="#/team/' + t.id + '">' + esc(t.name) + '</a>'; }).join('') + '</span></div>';
      }).join('') + '</div></section>';
    }
    return html;
  }

  /* ---------- Verein ---------- */
  function vereinSeite() {
    var v = D.verein || {};
    var html = kopf('Steeldart München e.V.', 'Verein', esc(v.willkommen || ''));
    html += '<section class="zwei-spalten">';
    html += '<div class="block"><h2 class="titel klein">Neuigkeiten</h2>' + (v.news || []).map(function (n) {
      return '<article class="text-karte"><h3>' + esc(n.titel) + '</h3>' + n.text.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</article>';
    }).join('') +
      '<h2 class="titel klein abstand">Termine</h2>' + ((v.termine || []).length ? '<div class="liste">' + v.termine.map(terminZeile).join('') + '</div>' : leer('Keine Termine.')) + '</div>';
    html += '<div class="block"><h2 class="titel klein">Kontakt</h2><div class="kontakt">' + (v.kontakt || []).map(function (k) {
      return '<div class="ko"><span class="kt">' + esc(k.rolle) + '</span>' + (k.name ? '<span class="ko-name">' + esc(k.name) + '</span>' : '') +
        (k.email ? '<a href="mailto:' + esc(k.email) + '">' + esc(k.email) + '</a>' : '') + '</div>';
    }).join('') + '</div></div>';
    html += '</section>';
    var artikel = function (titel, liste) {
      if (!liste || !liste.length) return '';
      return '<section class="block"><h2 class="titel klein">' + titel + '</h2><div class="artikel-raster">' + liste.map(function (a) {
        return '<a class="artikel" href="' + esc(a.url || '#') + '" target="_blank" rel="noopener"><span class="ar-titel">' + esc(a.titel) + '</span>' +
          (a.teaser ? '<span class="ar-text">' + esc(a.teaser) + '</span>' : '') + '<span class="ar-mehr">Weiterlesen' + RAUS + '</span></a>';
      }).join('') + '</div></section>';
    };
    html += artikel('Regelecke', v.regelecke);
    html += artikel('Veranstaltungen', v.veranstaltungen);
    if ((v.downloads || []).length) {
      html += '<section class="block"><h2 class="titel klein">Downloads</h2><div class="dl-raster">' + v.downloads.map(function (g) {
        return '<div class="dl-gruppe' + (g.dateien.length > 4 ? ' lang' : '') + '"><span class="kt">' + esc(g.titel) + '</span>' + g.dateien.map(function (f) {
          return '<a class="dl" href="' + esc(f.url) + '" target="_blank" rel="noopener"><span class="dl-pdf">PDF</span><span class="dl-t">' + esc(f.titel.replace(/\.pdf$/i, '').replace(/_/g, ' ')) + '</span><span class="leise">' + esc(f.groesse) + '</span></a>';
        }).join('') + '</div>';
      }).join('') + '</div></section>';
    }
    return html;
  }

  /* ---------- Verteiler ---------- */
  function zeichnen() {
    if (!D) return;
    var teile = location.hash.replace(/^#\/?/, '').split('/').filter(function (x) { return x !== ''; });
    var bereich = teile[0] || 'start';
    var html;
    if (bereich === 'liga') html = ligaSeite(teile[1] || standardLiga(), teile[2], teile[3]);
    else if (bereich === 'bericht') { html = berichtSeite(teile[1]); bereich = 'liga'; }
    else if (bereich === 'team') { html = teamSeite(teile[1]); bereich = 'teams'; }
    else if (bereich === 'teams') html = teamsSeite();
    else if (bereich === 'spieler' && teile.length >= 4) html = spielerSeite(teile[1], dekodiere(teile[2]), dekodiere(teile[3]));
    else if (bereich === 'spieler') html = spielerSuche('');
    else if (bereich === 'verein') html = vereinSeite();
    else { html = startSeite(); bereich = 'start'; }
    var main = $('inhalt');
    main.innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('#haupt-nav a'), function (a) {
      var an = a.getAttribute('data-bereich') === bereich;
      a.classList.toggle('an', an);
      if (an) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var suche = $('suche');
    if (suche) {
      suchErgebnis('');
      suche.addEventListener('input', function () { suchErgebnis(suche.value); });
    }
    var titel = main.querySelector('h1');
    document.title = (titel && bereich !== 'start' ? titel.textContent + ' · ' : '') + 'Steeldart Liga München · Vorschau';
    var stw = main.querySelector('.st-wahl .an');
    if (stw && stw.scrollIntoView) stw.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function standardLiga() {
    /* Unsere Liga zuerst (wer die Vorschau oeffnet, kommt aus der 5.). */
    for (var i = 0; i < LIGEN.length; i++) if (LIGEN[i].teamNamen['Blink 180']) return LIGEN[i].nr;
    return LIGEN.length ? LIGEN[0].nr : 1;
  }
  var letzterHash = null;
  function navigiert() {
    var neu = location.hash;
    var nurSpieltag = letzterHash && /\/spielplan\//.test(neu) && neu.split('/spielplan')[0] === letzterHash.split('/spielplan')[0];
    letzterHash = neu;
    zeichnen();
    if (!nurSpieltag) window.scrollTo(0, 0);
  }

  function start(d, woher) {
    if (!d || !d.ligen || !d.ligen.length) return fehler();
    aufbereiten(d);
    var stand = d.stand ? new Date(d.stand) : null;
    $('fuss-stand').textContent = 'Daten: steeldart-muenchen.de' + (stand && !isNaN(stand) ? ', Stand ' + p2(stand.getDate()) + '.' + p2(stand.getMonth() + 1) + '.' + stand.getFullYear() + ' ' + p2(stand.getHours()) + ':' + p2(stand.getMinutes()) + ' Uhr' : '') + (woher === 'datei' ? ' (Schnappschuss)' : '');
    var s = LIGEN[0] && LIGEN[0].saison;
    if (s) $('marke-sub').textContent = 'Liga · Saison 20' + s.replace('/', '/20');
    letzterHash = location.hash;
    zeichnen();
  }
  function fehler() {
    $('inhalt').innerHTML = kopf('Liga', 'Keine Daten', 'Die Liga-Daten ließen sich nicht laden. Bitte später noch einmal versuchen.');
  }
  function ausDatei() {
    if (window.LIGA_GESAMT) return start(window.LIGA_GESAMT, 'datei');
    var s = document.createElement('script');
    s.src = 'js/liga-gesamt-daten.js';
    s.onload = function () { start(window.LIGA_GESAMT, 'datei'); };
    s.onerror = fehler;
    document.head.appendChild(s);
  }

  window.addEventListener('hashchange', navigiert);
  if (/^https?:$/.test(location.protocol) && window.fetch) {
    fetch('/api/liga-gesamt', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { start(d, 'server'); })
      .catch(ausDatei);
  } else {
    ausDatei();
  }
})();
