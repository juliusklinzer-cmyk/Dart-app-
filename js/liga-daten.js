/*
 * Liga-Daten der Saison 2026/27: Spielplan, Ergebnisse der Ligaleitung,
 * Teams und der Tabellenstand zum Start. Gemeinsame Quelle fuer die App
 * (js/app.js) und die oeffentliche Webseite (js/webseite.js).
 *
 * Neue Ergebnisse nach jedem Spieltag: in LIGA_SPIELTAGE eintragen.
 */
(function () {
  'use strict';
  /* ================= Liga =================
   * Der Spielplan der Saison 2026/27, fest im Client – er ändert sich nur,
   * wenn der Verband ihn ändert, und dann hier. Die Zusagen („ich bin
   * dabei") liegen auf dem Server, je Termin-Kennung.
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

  /* Alle Spiele eines Spieltags (Ergebnisse der Ligaleitung), von Julius
     nach jedem Spieltag geliefert. Je Spiel: Datum, Heim, Gast, Lokal,
     Einzel und Legs; "partien" sind die 16 Einzel [Heim, Gast, hLegs, gLegs],
     ein * vor dem Namen heisst Gastspieler. Ohne gast = spielfrei,
     verschoben = neuer Termin in tag. Bei unserem eigenen Spiel ergaenzt
     "aufstellung" (heim/gast: die Bogen-Listen H1-H8 bzw. G1-G8) - damit
     laesst sich das Spiel in der App "vom Bogen uebernehmen" (js/app.js,
     ligaNachtragUebernehmen), wenn es am Abend nicht mitgeschrieben wurde. */
  var LIGA_SPIELTAGE = {
    st01: [
      { heim: 'Dart Artists Germering II', gast: null },
      { tag: '2026-10-06', heim: 'd`Haberer 2', gast: 'Voodoo Darters', ort: 'Heuboden', einzel: '8:8', legs: '20:20', partien: [
        ['Stefan Hügel', 'Marlene Czapka', 2, 1], ['Reinhart Boehm', 'Kevin Bauer', 0, 2], ['Rolf Neeb', 'Josef Stahl', 1, 2], ['Walter Majewski', 'Matthias Steinacher', 0, 2],
        ['Stefan Hügel', 'Kevin Bauer', 0, 2], ['Reinhart Boehm', 'Marlene Czapka', 2, 0], ['Rolf Neeb', 'Matthias Steinacher', 2, 1], ['Walter Majewski', 'Josef Stahl', 1, 2],
        ['Rolf Neeb', 'Marlene Czapka', 2, 0], ['Walter Majewski', 'Kevin Bauer', 0, 2], ['Reinhart Boehm', 'Josef Stahl', 2, 0], ['Stefan Hügel', 'Martin Goerlich', 2, 1],
        ['Mani Burgmair', 'Jan Strelow', 1, 2], ['Rolf Neeb', 'Kevin Bauer', 1, 2], ['Stefan Hügel', 'Josef Stahl', 2, 0], ['Reinhart Boehm', 'Martin Goerlich', 2, 1]
      ] },
      { tag: '2026-10-06', heim: 'Blink 180', gast: 'TSV Dachau 1865 4', ort: 'Bar Sehnsucht', einzel: '7:9', legs: '15:20' },
      { tag: '2026-10-07', heim: 'Treff ma nix', gast: 'DCO', ort: 'Fiakerstüberl', einzel: '9:7', legs: '21:17', partien: [
        ['Franz Freinberger', 'Naser Sharifi', 0, 2], ['Ralf Kilian', 'Christos Heuwald', 2, 0], ['Bernhard Hoffmann', 'Luck Heuwald', 2, 0], ['Christian Matejka', '*Michael Rogge', 1, 2],
        ['Franz Freinberger', 'Christos Heuwald', 2, 0], ['Ralf Kilian', 'Naser Sharifi', 0, 2], ['Bernhard Hoffmann', '*Michael Rogge', 2, 0], ['Christian Matejka', 'Luck Heuwald', 2, 0],
        ['Bernhard Hoffmann', 'Naser Sharifi', 2, 1], ['Christian Matejka', 'Christos Heuwald', 2, 1], ['Linda Maier', 'Alex Heuwald', 2, 1], ['Franz Freinberger', '*Michael Rogge', 1, 2],
        ['Sven Albrecht', 'Naser Sharifi', 1, 2], ['Yves Scherer', 'Christos Heuwald', 0, 2], ['Stephan Brunner', 'Alex Heuwald', 2, 0], ['Linda Maier', '*Michael Rogge', 0, 2]
      ], highlights: [{ wer: 'Alex Heuwald', team: 'DCO', was: '1× 180' }] },
      /* Stand zuerst "verschoben", inzwischen gespielt und gewertet (Tabelle
         der Ligaleitung vom 23.10.2026). */
      { tag: '2026-10-16', heim: 'TSV Oberpframmern', gast: 'FT Gern Darts II', ort: 'Gaststätte Anstoss', einzel: '12:4', legs: '26:10' }
    ],
    st02: [
      { heim: 'Voodoo Darters', gast: null },
      { tag: '2026-10-19', heim: 'FT Gern Darts II', gast: 'Treff ma nix', ort: 'Vereinsheim FT Gern', einzel: '3:13', legs: '11:28' },
      { tag: '2026-10-21', heim: 'TSV Dachau 1865 4', gast: 'TSV Oberpframmern', ort: 'TSV 1865 Dachau' },
      /* Unser Spiel, vom Spielberichtsbogen (Cobblers Irish Pub, 23.10.2026).
         aufstellung: die Bogen-Listen H1-H8 / G1-G8, damit der Nachtrag in
         der App dieselben Nummern traegt wie der Papierbogen (G5 Beuscher,
         G6 Schmeiss kamen in Durchgang 3 und 4 fuer G4 bzw. G3). */
      { tag: '2026-10-23', heim: 'Dart Artists Germering II', gast: 'Blink 180', ort: 'Cobblers Irish Pub', einzel: '6:10', legs: '13:22',
        aufstellung: {
          heim: ['Melanie Ziesen', 'Julius Frank', 'Fritz Frank', 'Gerd Stegerer'],
          gast: ['Lenas Becker', 'Dominik Uhl', 'Tobias Thomas', 'Alfred Buchner', 'Dominik Beuscher', 'Michael Schmeiß']
        },
        partien: [
          ['Melanie Ziesen', 'Lenas Becker', 0, 2], ['Julius Frank', 'Dominik Uhl', 2, 0], ['Fritz Frank', 'Tobias Thomas', 0, 2], ['Gerd Stegerer', 'Alfred Buchner', 2, 0],
          ['Melanie Ziesen', 'Dominik Uhl', 0, 2], ['Julius Frank', 'Lenas Becker', 1, 2], ['Fritz Frank', 'Alfred Buchner', 0, 2], ['Gerd Stegerer', 'Tobias Thomas', 0, 2],
          ['Fritz Frank', 'Lenas Becker', 0, 2], ['Gerd Stegerer', 'Dominik Uhl', 2, 0], ['Julius Frank', 'Michael Schmeiß', 2, 1], ['Melanie Ziesen', 'Dominik Beuscher', 0, 2],
          ['Gerd Stegerer', 'Lenas Becker', 2, 1], ['Fritz Frank', 'Dominik Uhl', 0, 2], ['Melanie Ziesen', 'Michael Schmeiß', 0, 2], ['Julius Frank', 'Dominik Beuscher', 2, 0]
        ] }
    ]
  };

  /* Alle Teams unserer Liga - fuer die leere Tabelle vorbefuellt. */
  var LIGA_TEAMS = ['Blink 180', 'TSV Dachau 1865 4', 'Dart Artists Germering II',
    'Voodoo Darters', 'd`Haberer 2', 'DCO', 'Treff ma nix', 'TSV Oberpframmern',
    'FT Gern Darts II'];
  /* Die Ligatabelle wird aus den Ergebnissen aller Spieltage gerechnet
     (LIGA_SPIELTAGE, Eintraege mit einzel und legs). Sieg 2 Punkte,
     Unentschieden 1; Reihenfolge nach Punkten, dann Leg-Differenz, dann
     Einzel-Differenz, dann Name. Liefert { zeilen, spiele, bis }. */
  function tabelleAus(spieltage, teams) {
    var je = {};
    (teams || []).forEach(function (t) { je[t] = { team: t, spiele: 0, g: 0, u: 0, v: 0, lf: 0, la: 0, ef: 0, ea: 0, punkte: 0 }; });
    var zeile = function (t) { if (!je[t]) je[t] = { team: t, spiele: 0, g: 0, u: 0, v: 0, lf: 0, la: 0, ef: 0, ea: 0, punkte: 0 }; return je[t]; };
    var paar = function (x) { var m = /^\s*(\d+)\s*:\s*(\d+)/.exec(String(x || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
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

  window.LIGA_DATEN = { liga: LIGA, spieltage: LIGA_SPIELTAGE, teams: LIGA_TEAMS, tabelleAus: tabelleAus };
})();
