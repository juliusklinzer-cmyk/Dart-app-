/*
 * Liga-Daten der Saison 2026/27: Spielplan, Ergebnisse aller Teams, die
 * 16 Einzel jedes Spiels, Highlights, Mannschaften (Lokal, Spielerliste)
 * und die daraus gerechneten Tabellen. Gemeinsame Quelle fuer die App
 * (js/app.js) und die oeffentliche Webseite (js/webseite.js).
 *
 * Woher die Daten kommen:
 *  - js/liga-sdm.js (window.LIGA_SDM): automatisch von der Seite der
 *    Ligaleitung geholt - "node tools/liga-import.mjs" nach jedem Spieltag.
 *  - LIGA_HAND (unten): was die Webseite nicht weiss, z. B. unsere Bogen-
 *    Aufstellung (H1-H8 / G1-G8) oder ein Ergebnis vom Papierbogen, bevor
 *    die Ligaleitung es eingetragen hat. Wird je Spiel dazugemischt.
 */
(function () {
  'use strict';
  var SDM = window.LIGA_SDM || { spieltage: {}, teams: {} };

  /* ================= Liga =================
   * Unsere 18 Spieltage. Datum, Heim, Gast und Lokal kommen aus dem
   * Spielplan der Ligaleitung (auch Verlegungen), die Liste hier ist die
   * Rueckfallebene ohne js/liga-sdm.js. Die Zusagen („ich bin dabei")
   * liegen auf dem Server, je Termin-Kennung.
   * sollSpieler: so viele braucht ein Spieltag, damit die Aufstellung als
   * vollständig gilt – bei Bedarf hier anpassen. */
  var LIGA = {
    team: 'Blink 180',
    saison: 'Saison 2026/27',
    sollSpieler: 4,
    termine: [
      { id: 'st01', nr: 1, tag: '2026-10-06', heim: 'Blink 180', gast: 'TSV Dachau 1865 4', ort: 'Bar Sehnsucht' },
      { id: 'st02', nr: 2, tag: '2026-10-23', heim: 'Dart Artists Germering II', gast: 'Blink 180', ort: 'Cobblers Irish Pub' },
      { id: 'st03', nr: 3, tag: '2026-10-26', heim: 'Voodoo Darters', gast: 'Blink 180', ort: 'Heuboden' },
      { id: 'st04', nr: 4, tag: '2026-11-10', heim: 'Blink 180', gast: 'd`Haberer 2', ort: 'Bar Sehnsucht' },
      { id: 'st05', nr: 5, tag: '2026-11-24', heim: 'Blink 180', gast: 'DCO', ort: 'Bar Sehnsucht' },
      { id: 'st06', nr: 6, tag: '2026-12-09', heim: 'Treff ma nix', gast: 'Blink 180', ort: 'Fiakerstüberl' },
      { id: 'st07', nr: 7, tag: '2027-01-12', heim: 'Blink 180', gast: 'TSV Oberpframmern', ort: 'Bar Sehnsucht' },
      { id: 'st08', nr: 8, tag: '2027-01-25', heim: 'FT Gern Darts II', gast: 'Blink 180', ort: 'Vereinsheim FT Gern' },
      { id: 'st09', nr: 9, tag: null },
      { id: 'st10', nr: 10, tag: '2027-03-03', heim: 'TSV Dachau 1865 4', gast: 'Blink 180', ort: 'TSV 1865 Dachau' },
      { id: 'st11', nr: 11, tag: '2027-03-16', heim: 'Blink 180', gast: 'Dart Artists Germering II', ort: 'Bar Sehnsucht' },
      { id: 'st12', nr: 12, tag: '2027-04-06', heim: 'Blink 180', gast: 'Voodoo Darters', ort: 'Bar Sehnsucht' },
      { id: 'st13', nr: 13, tag: '2027-04-20', heim: 'd`Haberer 2', gast: 'Blink 180', ort: 'Heuboden' },
      { id: 'st14', nr: 14, tag: '2027-04-30', heim: 'DCO', gast: 'Blink 180', ort: 'Gasthof Gut Keferloh' },
      { id: 'st15', nr: 15, tag: '2027-05-11', heim: 'Blink 180', gast: 'Treff ma nix', ort: 'Bar Sehnsucht' },
      { id: 'st16', nr: 16, tag: '2027-06-04', heim: 'TSV Oberpframmern', gast: 'Blink 180', ort: 'Gaststätte Anstoss' },
      { id: 'st17', nr: 17, tag: '2027-06-08', heim: 'Blink 180', gast: 'FT Gern Darts II', ort: 'Bar Sehnsucht' },
      { id: 'st18', nr: 18, tag: null }
    ]
  };

  /* Von Hand: je Spieltag die Spiele, zu denen wir mehr wissen als die
     Webseite. Gefunden wird ein Spiel ueber heim + gast; alles, was hier
     steht, ueberschreibt bzw. ergaenzt den Eintrag der Ligaleitung. Ein
     Spiel, das die Webseite noch gar nicht hat (Papierbogen vom Abend),
     kommt als ganzer Eintrag dazu: tag, heim, gast, ort, einzel, legs,
     partien (16 x [Heim, Gast, hLegs, gLegs], * = Gast).
     aufstellung: die Bogen-Listen H1-H8 / G1-G8, damit der Nachtrag in der
     App dieselben Nummern traegt wie der Papierbogen - ohne sie zaehlt die
     App die Namen in der Reihenfolge ihres ersten Einzels. */
  var LIGA_HAND = {
    st02: [
      /* Cobblers Irish Pub, 23.10.2026: G5 Beuscher und G6 Schmeiss kamen in
         Durchgang 3 und 4 fuer G4 bzw. G3. */
      { heim: 'Dart Artists Germering II', gast: 'Blink 180',
        aufstellung: {
          /* Nur unsere Seite: die Germeringer stehen bei der Ligaleitung in
             Bogen-Reihenfolge (H1-H4 = die ersten vier Einzel). */
          gast: ['Lenas Becker', 'Dominik Uhl', 'Tobias Thomas', 'Alfred Buchner', 'Dominik Beuscher', 'Michael Schmeiß']
        } }
    ]
  };

  /* Spieltage = Webseite der Ligaleitung + LIGA_HAND. Reihenfolge je
     Spieltag wie bei der Ligaleitung (Spielfrei zuerst, dann nach Datum). */
  function mische(sdmSpieltage, hand) {
    var out = {};
    var ids = {};
    Object.keys(sdmSpieltage || {}).forEach(function (id) { ids[id] = 1; });
    Object.keys(hand || {}).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).sort().forEach(function (id) {
      var zeilen = (sdmSpieltage[id] || []).map(function (sp) {
        var k = {};
        Object.keys(sp).forEach(function (f) { k[f] = sp[f]; });
        return k;
      });
      (hand[id] || []).forEach(function (h) {
        var ziel = null;
        zeilen.forEach(function (z) { if (!ziel && z.heim === h.heim && z.gast === h.gast) ziel = z; });
        if (!ziel) { ziel = {}; zeilen.push(ziel); }
        Object.keys(h).forEach(function (f) { ziel[f] = h[f]; });
      });
      out[id] = zeilen;
    });
    return out;
  }
  var LIGA_SPIELTAGE = mische(SDM.spieltage, LIGA_HAND);

  /* Unsere Termine mit dem Spielplan der Ligaleitung abgleichen: Datum,
     Heim/Gast und Lokal von dort, falls der Spieltag vorliegt. */
  LIGA.termine.forEach(function (t) {
    var runde = LIGA_SPIELTAGE[t.id];
    if (!runde) return;
    var unser = null, frei = false;
    runde.forEach(function (sp) {
      if (sp.heim === LIGA.team && !sp.gast) frei = true;
      if (sp.gast && (sp.heim === LIGA.team || sp.gast === LIGA.team)) unser = sp;
    });
    if (unser) {
      if (unser.tag) t.tag = unser.tag;
      t.heim = unser.heim; t.gast = unser.gast;
      if (unser.ort) t.ort = unser.ort;
      if (unser.verschoben) t.verschoben = true;
    } else if (frei) {
      t.tag = null;
    }
  });

  /* Alle Teams unserer Liga - fuer die leere Tabelle vorbefuellt. */
  var LIGA_TEAMS = ['Blink 180', 'TSV Dachau 1865 4', 'Dart Artists Germering II',
    'Voodoo Darters', 'd`Haberer 2', 'DCO', 'Treff ma nix', 'TSV Oberpframmern',
    'FT Gern Darts II'];
  Object.keys(SDM.teams || {}).forEach(function (t) { if (LIGA_TEAMS.indexOf(t) < 0) LIGA_TEAMS.push(t); });

  var paar = function (x) { var m = /^\s*(\d+)\s*:\s*(\d+)/.exec(String(x || '')); return m ? [Number(m[1]), Number(m[2])] : null; };

  /* Die Ligatabelle wird aus den Ergebnissen aller Spieltage gerechnet
     (LIGA_SPIELTAGE, Eintraege mit einzel und legs). Sieg 2 Punkte,
     Unentschieden 1; Reihenfolge nach Punkten, dann Leg-Differenz, dann
     Einzel-Differenz, dann Name. Liefert { zeilen, spiele, bis }. */
  function tabelleAus(spieltage, teams) {
    var je = {};
    (teams || []).forEach(function (t) { je[t] = { team: t, spiele: 0, g: 0, u: 0, v: 0, lf: 0, la: 0, ef: 0, ea: 0, punkte: 0 }; });
    var zeile = function (t) { if (!je[t]) je[t] = { team: t, spiele: 0, g: 0, u: 0, v: 0, lf: 0, la: 0, ef: 0, ea: 0, punkte: 0 }; return je[t]; };
    var spiele = 0, bis = '';
    Object.keys(spieltage || {}).forEach(function (tid) {
      (spieltage[tid] || []).forEach(function (sp) {
        if (!sp || !sp.heim || !sp.gast || sp.verschoben) return;
        var e = paar(sp.einzel), l = paar(sp.legs) || [0, 0];
        if (!e) return;
        var h = zeile(sp.heim), g = zeile(sp.gast);
        h.spiele++; g.spiele++;
        h.ef += e[0]; h.ea += e[1]; g.ef += e[1]; g.ea += e[0];
        h.lf += l[0]; h.la += l[1]; g.lf += l[1]; g.la += l[0];
        if (e[0] > e[1]) { h.g++; g.v++; h.punkte += 2; }
        else if (e[0] < e[1]) { g.g++; h.v++; g.punkte += 2; }
        else { h.u++; g.u++; h.punkte++; g.punkte++; }
        spiele++;
        if (sp.tag && sp.tag > bis) bis = sp.tag;
      });
    });
    var zeilen = Object.keys(je).map(function (t) { return je[t]; }).sort(function (a, b) {
      /* Bei gleichen Punkten stehen Teams mit Spielen vor Teams ohne (wie
         bei der Ligaleitung), dann Leg- und Einzel-Differenz, dann Name. */
      return b.punkte - a.punkte || (b.spiele > 0) - (a.spiele > 0) || (b.lf - b.la) - (a.lf - a.la) || (b.ef - b.ea) - (a.ef - a.ea) ||
        a.team.toLowerCase().localeCompare(b.team.toLowerCase(), 'de');
    }).map(function (z) {
      return { team: z.team, spiele: z.spiele, g: z.g, u: z.u, v: z.v, legs: z.lf + ':' + z.la, einzel: z.ef + ':' + z.ea, punkte: z.punkte };
    });
    return { zeilen: zeilen, spiele: spiele, bis: bis };
  }

  /* Die Einzelrangliste der Liga, gerechnet aus allen 16er-Spielberichten,
     nach dem Schluessel der Ligaleitung: je Einzel bekommt der Sieger
     2 Punkte plus Leg-Differenz (2:0 = 4, 2:1 = 3), der Verlierer seine
     gewonnenen Legs (1:2 = 1, 0:2 = 0). Reihenfolge: Punkte, Spiel-
     Differenz (Siege minus Niederlagen), Leg-Differenz, gewonnene Legs,
     Name - so sortiert auch die Ligaleitung. Gastspieler ("*Name") bleiben
     drin und sind markiert. Liefert Zeilen { name, team, gast, lf, la,
     siege, nied, legs "lf:la", spiele "siege:nied", punkte }. */
  function einzelranglisteAus(spieltage) {
    var je = {};
    var zeile = function (roh, team) {
      var gast = String(roh).charAt(0) === '*';
      var name = gast ? String(roh).slice(1).trim() : String(roh).trim();
      var k = team + '|' + name;
      if (!je[k]) je[k] = { name: name, team: team, gast: gast, lf: 0, la: 0, siege: 0, nied: 0, punkte: 0 };
      return je[k];
    };
    var buche = function (z, lw, ll) {
      z.lf += lw; z.la += ll;
      if (lw > ll) { z.siege++; z.punkte += 2 + lw - ll; } else { z.nied++; z.punkte += lw; }
    };
    Object.keys(spieltage || {}).forEach(function (tid) {
      (spieltage[tid] || []).forEach(function (sp) {
        if (!sp || !sp.gast || !Array.isArray(sp.partien)) return;
        sp.partien.forEach(function (p) {
          var h = Number(p[2]) || 0, g = Number(p[3]) || 0;
          if (h === g) return;
          buche(zeile(p[0], sp.heim), h, g);
          buche(zeile(p[1], sp.gast), g, h);
        });
      });
    });
    return Object.keys(je).map(function (k) { return je[k]; }).sort(function (a, b) {
      return b.punkte - a.punkte || (b.siege - b.nied) - (a.siege - a.nied) || (b.lf - b.la) - (a.lf - a.la) || b.lf - a.lf ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de');
    }).map(function (z) {
      z.legs = z.lf + ':' + z.la; z.spiele = z.siege + ':' + z.nied;
      return z;
    });
  }

  /* Highlights der ganzen Liga aus den Spielberichten: 180er (Anzahl je
     Spieler), Shortlegs (wenigste Darts zuerst) und Highfinishes (hoechste
     zuerst). Liefert { s180: [{name, team, gast, n}], shortleg: [{name,
     team, gast, wert, tag}], highfinish: [...] }. */
  function highlightsAus(spieltage) {
    var s180 = {}, shortleg = [], highfinish = [];
    var klar = function (roh) { var gast = String(roh).charAt(0) === '*'; return { name: gast ? String(roh).slice(1).trim() : String(roh).trim(), gast: gast }; };
    Object.keys(spieltage || {}).forEach(function (tid) {
      (spieltage[tid] || []).forEach(function (sp) {
        (sp && sp.highlights || []).forEach(function (h) {
          var w = klar(h.wer);
          var team = h.team || '';
          if (h.s180) {
            var k = team + '|' + w.name;
            if (!s180[k]) s180[k] = { name: w.name, team: team, gast: w.gast, n: 0 };
            s180[k].n += Number(h.s180) || 0;
          }
          (h.shortleg || []).forEach(function (v) { shortleg.push({ name: w.name, team: team, gast: w.gast, wert: v, tag: sp.tag }); });
          (h.highfinish || []).forEach(function (v) { highfinish.push({ name: w.name, team: team, gast: w.gast, wert: v, tag: sp.tag }); });
        });
      });
    });
    var nachName = function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de'); };
    return {
      s180: Object.keys(s180).map(function (k) { return s180[k]; }).sort(function (a, b) { return b.n - a.n || nachName(a, b); }),
      shortleg: shortleg.sort(function (a, b) { return a.wert - b.wert || nachName(a, b); }),
      highfinish: highfinish.sort(function (a, b) { return b.wert - a.wert || nachName(a, b); })
    };
  }

  window.LIGA_DATEN = {
    liga: LIGA, spieltage: LIGA_SPIELTAGE, teams: LIGA_TEAMS,
    teamInfo: SDM.teams || {}, stand: SDM.stand || null, quelle: SDM.quelle || null,
    tabelleAus: tabelleAus, einzelranglisteAus: einzelranglisteAus, highlightsAus: highlightsAus
  };
})();
