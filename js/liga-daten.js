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
     verschoben = neuer Termin in tag. */
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
      { tag: '2026-10-16', heim: 'TSV Oberpframmern', gast: 'FT Gern Darts II', ort: 'Gaststätte Anstoss', verschoben: true }
    ]
  };

  /* Alle Teams unserer Liga - fuer die leere Tabelle vorbefuellt. */
  var LIGA_TEAMS = ['Blink 180', 'TSV Dachau 1865 4', 'Dart Artists Germering II',
    'Voodoo Darters', 'd`Haberer 2', 'DCO', 'Treff ma nix', 'TSV Oberpframmern',
    'FT Gern Darts II'];
  /* Vorbelegung der Tabelle, solange noch niemand auf dem Server gespeichert
     hat: Stand der Ligaleitung nach dem 1. Spieltag (Oktober 2026). */
  var LIGA_TABELLE_START = [
    { team: 'TSV Dachau 1865 4', spiele: 1, g: 1, u: 0, v: 0, legs: '20:15', einzel: '9:7', punkte: 2 },
    { team: 'Treff ma nix', spiele: 1, g: 1, u: 0, v: 0, legs: '21:17', einzel: '9:7', punkte: 2 },
    { team: 'd`Haberer 2', spiele: 1, g: 0, u: 1, v: 0, legs: '20:20', einzel: '8:8', punkte: 1 },
    { team: 'Voodoo Darters', spiele: 1, g: 0, u: 1, v: 0, legs: '20:20', einzel: '8:8', punkte: 1 },
    { team: 'DCO', spiele: 1, g: 0, u: 0, v: 1, legs: '17:21', einzel: '7:9', punkte: 0 },
    { team: 'Blink 180', spiele: 1, g: 0, u: 0, v: 1, legs: '15:20', einzel: '7:9', punkte: 0 },
    { team: 'Dart Artists Germering II', spiele: 0, g: 0, u: 0, v: 0, legs: '0:0', einzel: '0:0', punkte: 0 },
    { team: 'TSV Oberpframmern', spiele: 0, g: 0, u: 0, v: 0, legs: '0:0', einzel: '0:0', punkte: 0 },
    { team: 'FT Gern Darts II', spiele: 0, g: 0, u: 0, v: 0, legs: '0:0', einzel: '0:0', punkte: 0 }
  ];

  window.LIGA_DATEN = { liga: LIGA, spieltage: LIGA_SPIELTAGE, teams: LIGA_TEAMS, tabelleStart: LIGA_TABELLE_START };
})();
