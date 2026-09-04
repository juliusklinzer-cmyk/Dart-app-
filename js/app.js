/*
 * Dart-Turnier – Jeder gegen jeden, 501 Double Out.
 * Kein Framework, kein Build: State im Speicher, Persistenz via localStorage.
 *
 * Datenmodell (v2):
 *   profiles  dauerhafte Spieler (Name + Bild), überleben jedes Turnier
 *   lineup    Profil-IDs des laufenden Turniers
 *   matches   Spiele des laufenden Turniers (Legs -> Aufnahmen -> Darts)
 *   history   abgeschlossene Turniere, vollständig mit allen Aufnahmen
 *
 * Alle Statistiken werden aus den gespeicherten Aufnahmen neu berechnet.
 * Dadurch stimmen Karriere-Werte und Ranglisten auch nach einem Undo.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dart-turnier-v1';
  var DEFAULT_PLAYERS = ['Lenas', 'Tobi', 'Domi', 'Julius'];
  /* Startpunkte des X01-Turniers. Der Modus heißt intern weiter '501' –
     das steht so in jedem archivierten Spiel und darf sich nicht ändern. */
  var START_SCORES = [301, 501, 701];
  var FIN_TARGETS = [3, 5, 10];   // Punkte zum Sieg im Finisher
  var QUICK_SCORES = [26, 41, 45, 60, 81, 85, 100, 140, 180];

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
      { id: 'st14', nr: 14, tag: '2027-04-30', heim: 'DCO', gast: 'Blink 180', ort: 'Poseidon Baldham' },
      { id: 'st15', nr: 15, tag: '2027-05-11', heim: 'Blink 180', gast: 'Treff ma nix', ort: 'Bar Sehnsucht' },
      { id: 'st16', nr: 16, tag: '2027-06-04', heim: 'TSV Oberpframmern', gast: 'Blink 180', ort: 'Gaststätte Anstoss' },
      { id: 'st17', nr: 17, tag: '2027-06-08', heim: 'Blink 180', gast: 'FT Gern Darts II', ort: 'Bar Sehnsucht' },
      { id: 'st18', nr: 18, tag: null }
    ]
  };

  /* Die 16 Einzel eines 4er-Ligaspiels, exakt in der Reihenfolge des
     SDM-Spielberichtsbogens (V5.2): H1–G1, H2–G2, H3–G3, H4–G4, H1–G2,
     H2–G1, H3–G4, H4–G3, H3–G1, H4–G2, H2–G3, H1–G4, H4–G1, H3–G2,
     H1–G3, H2–G4. Index 0..3 = Position 1..4, je Paar [Heim, Gast]. */
  var LIGA_EINZEL = [
    [0, 0], [1, 1], [2, 2], [3, 3],
    [0, 1], [1, 0], [2, 3], [3, 2],
    [2, 0], [3, 1], [1, 2], [0, 3],
    [3, 0], [2, 1], [0, 2], [1, 3]
  ];
  /* Die Tabelle der allerersten Fassung (Durchgang 3/4 anders) – nur noch
     für die Migration alter Stände und Berichte aus dem Alt-Archiv. */
  var LIGA_EINZEL_ALT = [
    [0, 0], [1, 1], [2, 2], [3, 3],
    [0, 1], [1, 0], [2, 3], [3, 2],
    [0, 2], [1, 3], [2, 0], [3, 1],
    [0, 3], [1, 2], [2, 1], [3, 0]
  ];
  /* Summen, die mit 3 Darts nicht zu werfen sind. */
  var IMPOSSIBLE = { 163: 1, 166: 1, 169: 1, 172: 1, 173: 1, 175: 1, 176: 1, 178: 1, 179: 1 };
  var MIN_DARTS_FOR_AVG = 9;    // ab wann ein Average in der Rangliste zählt
  var MAX_HISTORY = 500;        // so viele Spiele bleiben archiviert

  var S = null;
  /* Doppeltipp-Schutz, zweifach:
     1. Die Schnellwahl trägt eine ganze Aufnahme ein – zweimal dasselbe
        innerhalb eines Wimpernschlags ist immer ein Fehltipp.
        (Der Zahlenblock ist bewusst ausgenommen: dreimal T20 ist ein 180er.)
     2. Direkt nach einem Menü-Tipp werden Würfe kurz ignoriert, damit der
        zweite Tipp auf „Nochmal spielen" nicht im neuen Spiel landet. */
  var lastQuick = { key: '', at: 0 };
  function quickDoubleTap(key) {
    var now = Date.now();
    // 150 ms: ein prellender Doppeltipp liegt darunter, zwei bewusst
    // getippte Aufnahmen immer darüber.
    if (key === lastQuick.key && now - lastQuick.at < 150) return true;
    lastQuick.key = key;
    lastQuick.at = now;
    return false;
  }
  var settleUntil = 0;
  function settling() { return Date.now() < settleUntil; }

  /* Wechselt durch einen Tipp der Bildschirm, rutscht an dieselbe Stelle ein
     anderes Bedienelement. Ein Nachtipp dorthin ist ein Fehltipp – aber nur
     an genau dieser Stelle, damit bewusste schnelle Bedienung frei bleibt. */
  var ghostTapUntil = 0;
  var turnierEndeTimer = null;
  function armGhostTapGuard() { ghostTapUntil = Date.now() + 400; }
  function isGhostTap(ev) {
    /* `detail >= 2` ist die Doppelklick-Zählung des Browsers: zweite
       Berührung an derselben Stelle in kurzer Folge. Genau das ist der
       Fehltipp, den wir nach einem Bildschirmwechsel abfangen wollen –
       bewusste Einzeltipps bleiben unberührt. */
    if (Date.now() > ghostTapUntil) return false;
    if (!ev.detail || ev.detail < 2) return false;
    ghostTapUntil = 0;
    return true;
  }
  /* turnier: der Turnier-Modus des X01-Bildschirms – Riesenanzeige, Eingabe
     über eine echte Tastatur. Er bleibt über Aufnahmen und Spiele hinweg an,
     bis jemand zurückschaltet (anders als modeOverride, der je Aufnahme gilt).
     kamera: ebenso klebrig – die Darts kommen vom gekoppelten iPhone
     (js/kamera.js), angezeigt wird die Einzel-Darts-Ansicht. */
  var UI = { input: '', darts: [], mult: 1, modeOverride: null, turnier: false, kamera: false, overlay: null, error: '', board: 'won', boardMode: '501', profile: null, summary: null, ligaTab: 'plan', bericht: null };

  /* ================= Helfer ================= */
  function $(id) { return document.getElementById(id); }
  /* Klaenge sind optional - ohne js/sound.js bleibt alles stumm. */
  function pomp() { if (window.DartSound) window.DartSound.pomp(); }
  function klick() { if (window.DartSound) window.DartSound.klick(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function sum(arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f(arr[i]); return t; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
  }

  function newState() {
    return {
      v: 2,
      screen: 'setup',
      settings: { start: 501, bestOf: 1, dartModeFrom: 170, cricketScoring: 1, finisherTo: 5, rtwBoost: 1, turnierModus: 0 },
      mode: '501',
      game: null,
      profiles: DEFAULT_PLAYERS.map(function (n, i) {
        return { id: uid(), name: n, avatar: null, hue: HUES[i % HUES.length], created: Date.now() };
      }),
      lineup: [],
      matches: [],
      current: null,
      history: []
    };
  }

  var saveBroken = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
      if (saveBroken) { saveBroken = false; renderSaveWarning(); }
    } catch (e) {
      // Speicher voll oder privater Modus: der Abend läuft weiter, aber
      // stillschweigend Daten zu verlieren wäre das Schlimmste.
      if (!saveBroken) { saveBroken = true; renderSaveWarning(); }
    }
  }

  function renderSaveWarning() {
    var bar = $('save-warning');
    if (!bar) return;
    bar.classList.toggle('hidden', !saveBroken);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s) return null;
      if (s.v === 1) s = migrate1to2(s);
      if (s.v !== 2 || !Array.isArray(s.profiles)) return null;
      if (!Array.isArray(s.history)) s.history = [];
      if (!Array.isArray(s.lineup)) s.lineup = [];
      if (!s.mode) s.mode = '501';
      if (START_SCORES.indexOf(s.settings.start) < 0) s.settings.start = 501;
      if (s.game === undefined) s.game = null;
      /* Ein Finisher-Spiel ohne Runden kann es nicht geben – ein solcher
         Stand käme aus einer kaputten Speicherung und würde beim Zeichnen
         auffliegen. Lieber verwerfen als abstürzen. */
      if (s.game && s.game.kind === 'finisher' && !Array.isArray(s.game.rounds)) s.game = null;
      if (s.settings.cricketScoring === undefined) s.settings.cricketScoring = 1;
      /* Vor der Wahl gab es nur Boost -- wer von damals kommt, behaelt das. */
      if (s.settings.rtwBoost === undefined) s.settings.rtwBoost = 1;
      if (FIN_TARGETS.indexOf(s.settings.finisherTo) < 0) s.settings.finisherTo = 5;
      s.profiles.forEach(function (p, i) { if (typeof p.hue !== 'number') p.hue = HUES[i % HUES.length]; });
      /* Liga-Stände aus der ersten Fassung (vor dem Bogen-Ausbau) kennen
         posH/posG, die Spielerlisten und die neuen Match-Felder nicht –
         nachrüsten, sonst friert der Wechsel-Dialog die App ein. Die alten
         Matches wurden nach der alten Paarungstabelle angelegt. */
      if (s.tour && s.tour.liga) {
        var lgAlt = s.tour.liga;
        if (!lgAlt.heimSpieler) lgAlt.heimSpieler = (lgAlt.heim ? lgAlt.wir : lgAlt.sie).slice();
        if (!lgAlt.gastSpieler) lgAlt.gastSpieler = (lgAlt.heim ? lgAlt.sie : lgAlt.wir).slice();
        if (!lgAlt.posH) lgAlt.posH = lgAlt.heimSpieler.slice(0, 4);
        if (!lgAlt.posG) lgAlt.posG = lgAlt.gastSpieler.slice(0, 4);
        if (lgAlt.finish === undefined) lgAlt.finish = true;   // lief bisher mit Hilfen
        if (lgAlt.ort === undefined) lgAlt.ort = '';
        if (lgAlt.tag === undefined) lgAlt.tag = '';
        if (lgAlt.zeitVon === undefined) lgAlt.zeitVon = null;
        if (lgAlt.zeitBis === undefined) lgAlt.zeitBis = null;
        if (Array.isArray(s.matches)) {
          s.matches.forEach(function (m, i) {
            if (!m.posPaar && LIGA_EINZEL_ALT[i]) m.posPaar = LIGA_EINZEL_ALT[i].slice();
            if (!m.scheibe) m.scheibe = i % 2 === 0 ? 'S1' : 'S2';
          });
        }
      }
      return s;
    } catch (e) { return null; }
  }

  /* Aus den Turnier-Spielern der ersten Version werden dauerhafte Profile. */
  function migrate1to2(s) {
    return {
      v: 2,
      screen: s.screen === 'game' || s.screen === 'bulloff' ? 'tournament' : s.screen,
      settings: s.settings,
      profiles: (s.players || []).map(function (p) {
        return { id: p.id, name: p.name, avatar: null, created: Date.now() };
      }),
      lineup: (s.players || []).map(function (p) { return p.id; }),
      matches: s.matches || [],
      current: s.current || null,
      history: [],
      mode: '501',
      game: null
    };
  }

  /* ================= Profile ================= */
  function profile(id) {
    for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === id) return S.profiles[i];
    return { id: id, name: 'Unbekannt', avatar: null };
  }
  function pname(id) { return profile(id).name; }

  /* Ein Ort für die Namen der Spielarten – sie tauchen an einem halben Dutzend
     Stellen auf, und eine vergessene wäre sofort sichtbar. */
  /* Das Schnelle Spiel laeuft auf dem X01-Bildschirm, die anderen freien
     Spiele haben je einen eigenen. */
  function spielScreen(kind) { return kind === 'quick' ? 'game' : kind; }

  function kindName(kind) {
    if (kind === 'cricket') return 'Cricket';
    if (kind === 'rtw') return 'Round the World';
    if (kind === 'finisher') return 'Finisher';
    if (kind === 'quick') return 'Schnelles Spiel';
    return 'X01';
  }
  function activeProfiles() { return S.profiles.filter(function (p) { return !p.hidden; }); }

  /* Gastspieler gehören dem Gerät, Accounts ihrem Besitzer. Fremde Accounts
     hier zu ändern hätte keinen Bestand – der nächste Abgleich holt Name und
     Bild ohnehin wieder vom Server. Also gar nicht erst anbieten. */
  function bearbeitbar(id) {
    return !window.DartKonto || window.DartKonto.darfBearbeiten(id);
  }

  /* Wer angemeldet ist, steht oben, danach die anderen Accounts, ganz unten
     die Gäste. Man sucht sich nicht selbst in einer Liste – und man wählt
     sich fast immer mit aus. */
  function rosterReihenfolge() {
    var ich = window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().id : null;
    var liste = activeProfiles().slice();
    /* Wer die App am meisten nutzt, steht oben: Spiele ueber alle Modi,
       bei Gleichstand die Siege - ich selbst ganz vorn, Gaeste ans Ende. */
    var map = career();
    var nutzung = function (id) {
      var s = map[id];
      if (!s) return 0;
      return (s.matches || 0) + (s.cricketGames || 0) + (s.rtwGames || 0) + (s.finGames || 0);
    };
    return liste.sort(function (a, b) {
      if (ich && (a.id === ich) !== (b.id === ich)) return (b.id === ich) - (a.id === ich);
      if ((a.gast ? 1 : 0) !== (b.gast ? 1 : 0)) return (a.gast ? 1 : 0) - (b.gast ? 1 : 0);
      var na = nutzung(a.id), nb = nutzung(b.id);
      if (na !== nb) return nb - na;
      var wa = (map[a.id] || {}).won || 0, wb = (map[b.id] || {}).won || 0;
      if (wa !== wb) return wb - wa;
      return 0;
    });
  }

  /* Wann war dieser Spieler zuletzt dabei? Turniere führen ihre Teilnehmer
     unter lineup, freie Spiele unter players. */
  function letztesSpielAm(id) {
    for (var i = 0; i < S.history.length; i++) {
      var e = S.history[i];
      var teil = e.players || e.lineup || [];
      if (teil.indexOf(id) >= 0) return e.at || 0;
    }
    return 0;
  }

  /*
   * Gäste räumen sich nach dem Abend selbst weg – sonst wächst die
   * Aufstellung mit jedem Besuch. „Weg" heißt ausgeblendet, nicht gelöscht:
   * ihre Spiele stehen im Archiv nur unter der Kennung, ohne das Profil
   * stünde dort „Unbekannt". Wer nie geworfen hat, wird wirklich gelöscht.
   * Kommt der Gast wieder, holt man ihn unter Spieler mit einem Tipp zurück.
   */
  /*
   * Die vier Startspieler (siehe DEFAULT_PLAYERS) stammen aus der Zeit vor
   * dem Login: ohne sie war die App beim ersten Öffnen leer. Sobald es einen
   * Server gibt, kommt der Kader von dort, und sie wären nur noch vier
   * Fremde, nach denen beim Anmelden auch noch gefragt würde. Also weg –
   * aber nur, solange sie nie geworfen haben. Wer eine Historie hat, bleibt
   * und wird wie bisher einem Account zugeordnet.
   *
   * Im Einzeldatei-Bündel gibt es keine Konto-Schicht, die das aufruft:
   * dort behält die App ihre vier Startspieler.
   */
  function platzhalterEntfernen() {
    var weg = S.profiles.filter(function (p) {
      return DEFAULT_PLAYERS.indexOf(p.name) >= 0 &&
        String(p.id).indexOf('u_') !== 0 && !p.gast && !letztesSpielAm(p.id);
    });
    if (!weg.length) return 0;
    var raus = {};
    weg.forEach(function (p) { raus[p.id] = 1; });
    S.profiles = S.profiles.filter(function (p) { return !raus[p.id]; });
    S.lineup = S.lineup.filter(function (id) { return !raus[id]; });
    save();
    return weg.length;
  }

  var GAST_FRIST = 12 * 3600 * 1000;   // ein Abend
  function gaesteAufraeumen() {
    var jetzt = Date.now();
    var geaendert = false;
    S.profiles = S.profiles.filter(function (p) {
      if (!p.gast || p.hidden) return true;
      var zuletzt = letztesSpielAm(p.id);
      if (jetzt - (zuletzt || p.created || jetzt) < GAST_FRIST) return true;
      geaendert = true;
      if (!zuletzt) return false;          // nie gespielt: ersatzlos weg
      p.hidden = true;
      return true;
    });
    if (geaendert) {
      S.lineup = S.lineup.filter(function (id) {
        var p = null;
        for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === id) p = S.profiles[i];
        return p && !p.hidden;
      });
      save();
    }
  }

  /* Auswahlliste fürs Lieblingsdoppel. Oben die, auf die man üblicherweise
     stellt, darunter der Rest – gesucht wird fast immer eines der ersten. */
  var DOPPEL_WAHL = [20, 16, 18, 12, 10, 14, 8, 6, 4, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];
  function doppelOptionen(gewaehlt) {
    var html = '<option value="0"' + (gewaehlt ? '' : ' selected') + '>egal</option>' +
      '<option value="25"' + (gewaehlt === 25 ? ' selected' : '') + '>Bull</option>';
    DOPPEL_WAHL.forEach(function (n) {
      html += '<option value="' + n + '"' + (gewaehlt === n ? ' selected' : '') + '>D' + n + '</option>';
    });
    return html;
  }

  /* Das Lieblingsdoppel dessen, der gerade wirft – der Vorschlag gilt ihm. */
  function lieblingsDoppel(pid) {
    var p = profile(pid);
    return p && p.dbl ? p.dbl : null;
  }

  function initials(name) {
    var parts = String(name).trim().split(/\s+/);
    if (!parts[0]) return '?';
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  /* Feste, gut unterscheidbare Farbtöne – dieselbe Farbe für Avatar,
     Diagramm und Legende, damit ein Spieler überall gleich aussieht. */
  var HUES = [145, 210, 40, 0, 275, 175, 320, 90, 25, 250, 120, 300];
  function hue(id) {
    var p = profile(id);
    if (typeof p.hue === 'number') return p.hue;
    var idx = S.profiles.indexOf(p);
    return HUES[(idx < 0 ? 0 : idx) % HUES.length];
  }
  function playerColor(id) { return 'hsl(' + hue(id) + ',70%,58%)'; }
  /* Erst die noch unbenutzten Farbtöne vergeben, damit sich zwei Spieler
     nicht dieselbe Farbe teilen, solange es freie gibt. */
  function freeHue() {
    var used = {};
    S.profiles.forEach(function (p) { used[p.hue] = 1; });
    for (var i = 0; i < HUES.length; i++) if (!used[HUES[i]]) return HUES[i];
    return HUES[S.profiles.length % HUES.length];
  }
  function avatarHTML(p, cls) {
    var c = 'av ' + (cls || '');
    if (p.avatar) return '<span class="' + c + '" style="background-image:url(' + p.avatar + ')"></span>';
    return '<span class="' + c + ' init" style="background:hsl(' + hue(p.id) + ',40%,28%)">' + esc(initials(p.name)) + '</span>';
  }

  /* Bild auf 220px quadratisch zuschneiden – sonst sprengen Fotos den Speicher. */
  function readAvatar(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var size = 220;
        var canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        var side = Math.min(img.width, img.height);
        canvas.getContext('2d').drawImage(
          img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size
        );
        try { cb(canvas.toDataURL('image/jpeg', 0.82)); } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  /* Ein laufendes Turnier hält seine eigenen Regeln fest. Sonst würde eine
     Änderung im Setup rückwirkend die Reststände eines Legs verschieben. */
  function tour() {
    if (!S.tour) S.tour = { start: S.settings.start, bestOf: S.settings.bestOf, players: S.lineup.slice() };
    return S.tour;
  }
  function tourStart() { return tour().start; }
  function tourPlayers() {
    var t = tour();
    return t.players && t.players.length ? t.players : S.lineup;
  }
  function legsToWin() { return Math.floor(tour().bestOf / 2) + 1; }

  /* ================= Turnierplan ================= */
  /* Kreis-Methode: jeder gegen jeden, gleichmäßig auf Runden verteilt. */
  function buildSchedule(ids) {
    var list = ids.slice();
    if (list.length % 2 === 1) list.push(null);
    var n = list.length;
    var matches = [];
    for (var r = 0; r < n - 1; r++) {
      for (var i = 0; i < n / 2; i++) {
        var a = list[i], b = list[n - 1 - i];
        if (a === null || b === null) continue;
        matches.push({
          id: uid(), round: r + 1, p: r % 2 === 0 ? [a, b] : [b, a],
          starter: null, legs: [], done: false, winner: null, at: null
        });
      }
      list.splice(1, 0, list.pop());
    }
    return matches;
  }

  /* Nachzügler und Frühgeher: Ein laufendes Turnier lässt sich erweitern,
     und wer geht, dessen offene Spiele entfallen – Gespieltes bleibt. */
  function addPlayerToTournament(pid) {
    var t = tour();
    if (t.players.indexOf(pid) >= 0 || t.players.length >= 12) return;
    var lastRound = 0;
    S.matches.forEach(function (m) { if (m.round > lastRound) lastRound = m.round; });
    t.players.forEach(function (other) {
      S.matches.push({
        id: uid(), round: lastRound + 1, p: [other, pid],
        starter: null, legs: [], done: false, winner: null, at: null, added: true
      });
    });
    t.players.push(pid);
    if (S.lineup.indexOf(pid) < 0) S.lineup.push(pid);
    save();
  }

  function withdrawFromTournament(pid) {
    S.matches.forEach(function (m) {
      if (m.done || m.p.indexOf(pid) < 0) return;
      // Bereits geworfene Legs bleiben gewertet – die Partie gilt als
      // abgebrochen, nicht als nie stattgefunden.
      m.void = true;
      m.started = m.legs.some(function (l) { return l.visits.length > 0; });
    });
    save();
  }

  function isPlaying(pid) {
    for (var i = 0; i < S.matches.length; i++) {
      var m = S.matches[i];
      if (!m.void && !m.done && m.p.indexOf(pid) >= 0) return true;
    }
    return false;
  }

  function matchById(id) {
    for (var i = 0; i < S.matches.length; i++) if (S.matches[i].id === id) return S.matches[i];
    return null;
  }

  /* ================= Geteiltes Turnier ================= */
  /*
   * Zwei Scheiben, zwei Geräte, ein Spielplan. Der Plan und die fertigen
   * Partien liegen auf dem Server; gerechnet wird weiterhin nur hier.
   *
   * Diese Funktion ist die einzige Stelle, an der fremde Daten in das eigene
   * Turnier kommen. Sie gibt zurück, ob sich etwas geändert hat – der
   * Hintergrundtakt zeichnet sonst achtmal die Minute ohne Grund neu.
   */
  function geteiltesTurnier() { return S.tour && S.tour.geteilt ? S.tour : null; }

  /* Der Turnier-Modus (Riesenanzeige am Board) gehoert zu Liga-Einzeln -
     dort startet er am Board-iPad von selbst. In normalen Turnieren und im
     Schnellen Spiel laesst er sich per Knopf dazuschalten; nur allein gibt
     es ihn nicht (eine Seite des Bildes bliebe leer). */
  function ligaEinzel() {
    return !!(S.tour && S.tour.liga) && !(S.game && S.game.kind === 'quick');
  }
  function turnierErlaubt() {
    if (S.game && S.game.kind === 'quick') return S.game.p.length > 1;
    return !!S.tour;
  }

  /* Buergerlicher Name als ein String gespeichert, im Formular getrennt:
     das letzte Wort ist der Nachname. */
  function vollSplit(voll) {
    var t = String(voll || '').trim().split(/\s+/).filter(Boolean);
    if (!t.length) return { vor: '', nach: '' };
    var nach = t.length > 1 ? t.pop() : '';
    return { vor: t.join(' '), nach: nach };
  }
  function vollAusTeilen(vor, nach) {
    return (String(vor || '').trim() + ' ' + String(nach || '').trim())
      .replace(/\s+/g, ' ').trim() || null;
  }

  function planZuMatches(plan) {
    return (plan.matches || []).map(function (m) {
      return {
        id: m.id, round: m.round, p: m.p.slice(),
        // Ligaspiele bringen ihren Anwerfer mit (kein Ausbullen), Turniere nicht.
        starter: m.starter || null,
        posPaar: m.posPaar || null, scheibe: m.scheibe || null,
        legs: [], done: false, winner: null, at: null
      };
    });
  }

  function uebernehmeTurnier(daten) {
    if (!daten || !daten.plan) return false;
    var neu = false;

    // Noch nicht dabei: Plan übernehmen. Ein laufendes eigenes Turnier ist an
    // dieser Stelle schon weggeräumt – siehe turnierBeitreten().
    if (!S.tour || S.tour.sid !== daten.id) {
      S.tour = {
        start: daten.plan.start, bestOf: daten.plan.bestOf,
        players: (daten.plan.players || []).slice(),
        geteilt: true, sid: daten.id, cursor: 0,
        angelegtVon: daten.angelegtVonName || null,
        liga: daten.plan.liga || null
      };
      S.matches = planZuMatches(daten.plan);
      S.current = null;
      /* Gaeste aus dem Plan uebernehmen: sie gehoeren dem Geraet, das sie
         angelegt hat, und ohne sie stuende hier ueberall "Unbekannt". */
      var g = daten.plan.gaeste || {};
      Object.keys(g).forEach(function (gid) {
        if (S.profiles.some(function (p) { return p.id === gid; })) return;
        S.profiles.push({
          id: gid, name: g[gid], voll: g[gid], avatar: null, hue: freeHue(),
          created: Date.now(), gast: true
        });
      });
      neu = true;
    }

    var ich = window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().id : null;
    (daten.partien || []).forEach(function (p) {
      var m = matchById(p.matchId);
      if (!m) return;
      if (p.result) {
        /* Ein fertiges Ergebnis gewinnt immer – auch gegen eine Partie, die
           hier gerade offen aussieht. Wer sie beansprucht hatte, hat sie
           gespielt; alles andere wäre ein zweiter Datenstand derselben
           Partie, und genau den soll es nicht geben. */
        if (!m.done || m.at !== p.result.at) {
          S.matches[S.matches.indexOf(m)] = p.result;
          if (S.current === m.id) S.current = null;
          neu = true;
        }
        var fertig = matchById(p.matchId);
        if (fertig && fertig.belegtVon) delete fertig.belegtVon;
        return;
      }
      // Fremder Anspruch: kein Start-Knopf, dafür der Name daneben.
      var von = p.claimedBy && p.claimedBy !== ich ? (p.claimedByName || 'jemandem') : null;
      if ((m.belegtVon || null) !== von) {
        if (von) m.belegtVon = von; else delete m.belegtVon;
        neu = true;
      }
    });

    if (typeof daten.cursor === 'number' && daten.cursor > (S.tour.cursor || 0)) {
      S.tour.cursor = daten.cursor;
    }
    if (daten.status === 'beendet') S.tour.beendet = true;
    /* Kam das letzte Einzel des Ligaspiels vom anderen Gerät, stempelt auch
       dieses Gerät die Endzeit für den Spielberichtsbogen. */
    if (neu && S.tour.liga && !S.tour.liga.zeitBis && S.matches.length && !nextOpenMatch()) {
      S.tour.liga.zeitBis = Date.now();
    }
    if (neu) save();
    return neu;
  }

  /* Einem laufenden Turnier beitreten. Ein eigenes Turnier, das noch läuft,
     wird vorher archiviert – wie beim Start eines neuen. */
  function turnierBeitreten(daten) {
    if (S.matches.length) archiveTournament();
    S.tour = null;
    S.matches = [];
    uebernehmeTurnier(daten);
    S.screen = 'tournament';
    save();
    render();
  }
  /* Ein Schnelles Spiel ist selbst die laufende Partie – dadurch tragen
     Spielbildschirm, Eingabe, Finish-Vorschlag und Undo unveraendert. */
  function currentMatch() {
    if (S.game && S.game.kind === 'quick') return S.game;
    return S.current ? matchById(S.current) : null;
  }
  function nextOpenMatch() {
    for (var i = 0; i < S.matches.length; i++) {
      if (!S.matches[i].done && !S.matches[i].void) return S.matches[i];
    }
    return null;
  }
  function allMatchesDone() { return S.matches.length > 0 && !nextOpenMatch(); }

  /* ================= Leg-Logik ================= */
  function legsWon(match, pid) {
    return sum(match.legs, function (l) { return l.winner === pid ? 1 : 0; });
  }

  function ensureLeg(match) {
    var last = match.legs[match.legs.length - 1];
    if (last && !last.winner) return last;
    if (match.done) return last || null;
    /* Der Anwurf wandert von Leg zu Leg weiter – bei zwei Spielern also im
       Wechsel, im Schnellen Spiel reihum. */
    var idx = match.p.indexOf(match.starter);
    if (idx < 0) idx = 0;
    var starter = match.p[(idx + match.legs.length) % match.p.length];
    var leg = { starter: starter, visits: [], winner: null, start: matchStart(match) };
    match.legs.push(leg);
    return leg;
  }

  /* Ein Schnelles Spiel bringt seine Startpunktzahl selbst mit, eine
     Turnierpartie holt sie aus den Turniereinstellungen. */
  function matchStart(match) {
    return match && typeof match.start === 'number' ? match.start : tourStart();
  }
  function matchLegsToWin(match) {
    return match && match.bestOf ? Math.floor(match.bestOf / 2) + 1 : legsToWin();
  }

  function activeLeg(match) { return match.legs[match.legs.length - 1] || null; }

  /* Die Startpunktzahl steht am Leg selbst. Alte Stände haben sie nicht –
     dort gilt weiter die Turniereinstellung. */
  function legStart(leg) {
    return leg && typeof leg.start === 'number' ? leg.start : tourStart();
  }

  function remainingIn(leg, pid) {
    var rest = legStart(leg);
    for (var i = 0; i < leg.visits.length; i++) {
      var v = leg.visits[i];
      if (v.p === pid && !v.b) rest -= v.s;
    }
    return rest;
  }

  /* Reihum durch die Aufstellung, beginnend beim Anwerfer. Für zwei Spieler
     ist das dasselbe wie vorher, ab drei (Schnelles Spiel) geht es weiter
     im Kreis. */
  function activePlayer(leg, match) {
    var n = match.p.length;
    var start = match.p.indexOf(leg.starter);
    if (start < 0) start = 0;
    return match.p[(start + leg.visits.length) % n];
  }

  function dartsIn(leg, pid) {
    return sum(leg.visits, function (v) { return v.p === pid ? v.d : 0; });
  }

  /* ================= Die 180er-Feier ================= */
  /*
   * Eine 180 ist das Höchste, was drei Darts hergeben, und passiert an einem
   * Abend selten. Also wird sie gefeiert: Konfetti, Blitze, Laserstrahlen,
   * blinkender Name – knapp fünf Sekunden, dann ist wieder Ruhe.
   *
   * Zwei Regeln, die das Ganze harmlos halten:
   * - Die Feier nimmt keine Klicks an. Wer sofort weiterschreiben will, tippt
   *   einfach durch sie hindurch; niemand muss auf das Ende warten.
   * - Sie liegt ausserhalb der Screens, render() fasst sie also nicht an.
   */
  var FEIER_MS = 4600;
  /* Die Sechzig ist kurz: ein Puls („SECH-ZIG", bum-bum), dann wieder weg –
     sie kommt ja auch deutlich öfter als die 180. */
  var SECHZIG_MS = 1200;

  /* Feier anwerfen. Kein display-Umschalten und kein Klassen-Neustart-Trick:
     die Kinder werden je Feier frisch eingesetzt und starten ihre Animationen
     von selbst – das ist der einzige Neustart, den auch Safari immer mitmacht
     (display none→block auf der Blur-Ebene ließ dort Folge-Feiern ausfallen). */
  function feierAnwerfen(box) {
    box.classList.add('an');
  }
  var feierTimer = null;
  var KONFETTI_FARBEN = ['#e5484d', '#46aad7', '#ffc14d', '#f2eeee', '#3fbf7f', '#e763c8', '#ff8a3d'];

  function feiere180(pid) {
    var box = $('feier');
    if (!box) return;
    var ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var teile = '';
    if (!ruhig) {
      // Konfetti: jeder Schnipsel bekommt eigene Bahn, Tempo und Drehung –
      // gleichmässig fallende Rechtecke sähen nach Bildschirmschoner aus.
      for (var i = 0; i < 70; i++) {
        teile += '<i style="left:' + (Math.random() * 100).toFixed(2) + '%;' +
          'background:' + KONFETTI_FARBEN[i % KONFETTI_FARBEN.length] + ';' +
          '--fall:' + (1.7 + Math.random() * 2.1).toFixed(2) + 's;' +
          '--verz:' + (Math.random() * 1.4).toFixed(2) + 's;' +
          '--drift:' + (Math.random() * 160 - 80).toFixed(0) + 'px;' +
          '--dreh:' + (Math.random() * 1080 - 540).toFixed(0) + 'deg;' +
          'width:' + (5 + Math.random() * 7).toFixed(0) + 'px;' +
          'height:' + (9 + Math.random() * 12).toFixed(0) + 'px"></i>';
      }
    }
    var strahlen = '';
    if (!ruhig) for (var s = 0; s < 8; s++) strahlen += '<i style="--dreh:' + (s * 22.5) + 'deg"></i>';

    box.innerHTML =
      '<div class="feier-blitz"></div>' +
      '<div class="feier-strahlen">' + strahlen + '</div>' +
      '<div class="feier-konfetti">' + teile + '</div>' +
      '<div class="feier-mitte">' +
        '<div class="feier-zahl">180</div>' +
        '<div class="feier-name">' + esc(pname(pid)) + '</div>' +
        '<div class="feier-gruss">Gratuliere!</div>' +
      '</div>';

    box.classList.remove('sechzig');   // eine laufende Sechzig tritt zurück
    feierAnwerfen(box);
    if (feierTimer) clearTimeout(feierTimer);
    feierTimer = setTimeout(function () {
      box.classList.remove('an');
      box.innerHTML = '';
      feierTimer = null;
    }, ruhig ? 2000 : FEIER_MS);
  }

  /*
   * Die Sechzig: jede geworfene 60 ruft den Löwen auf den Bildschirm – das
   * 1860-Wappen vor blauen Strahlen, darunter „SECHZIG!". Sie läuft in jedem
   * Modus; fällt sie mit einem Dialog zusammen (60er-Checkout und Leg-Ende),
   * liegt der Dialog darüber – die Feier hat dafür eine eigene, niedrigere
   * Ebene (siehe .feier-sechzig im CSS).
   */
  function feiere60(pid) {
    var box = $('feier');
    if (!box) return;
    var ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var strahlen = '';
    if (!ruhig) for (var s = 0; s < 8; s++) strahlen += '<i style="--dreh:' + (s * 22.5) + 'deg"></i>';

    /* Eigene Ebene unterhalb der Dialoge: checkt jemand mit genau 60 aus,
       stehen Leg-Dialog und Feier gleichzeitig im Bild – der Dialog gewinnt,
       der Löwe leuchtet dahinter. Die 180 bleibt auf der obersten Ebene. */
    box.classList.add('sechzig');
    box.innerHTML =
      '<div class="feier-blitz"></div>' +
      '<div class="feier-strahlen">' + strahlen + '</div>' +
      '<div class="feier-mitte">' +
        '<div class="feier-logo"></div>' +
        '<div class="feier-name">SECHZIG!</div>' +
        '<div class="feier-gruss">' + esc(pname(pid)) + '</div>' +
      '</div>';

    feierAnwerfen(box);
    if (feierTimer) clearTimeout(feierTimer);
    feierTimer = setTimeout(function () {
      box.classList.remove('an', 'sechzig');
      box.innerHTML = '';
      feierTimer = null;
    }, ruhig ? 900 : SECHZIG_MS);
  }

  /* Aufnahme abschließen und Leg-/Matchstand fortschreiben.
     k = Einzeldarts (nur im Einzel-Dart-Modus vorhanden, für Doppelquote). */
  function commitVisit(score, darts, isCheckout, isBust, k) {
    var m = currentMatch();
    var leg = activeLeg(m);
    var pid = activePlayer(leg, m);
    var visit = { p: pid, s: isBust ? 0 : score, d: darts, b: !!isBust, c: !!isCheckout, o: isBust ? score : 0 };
    if (k && k.length) visit.k = k.map(function (x) { return { m: x.m, n: x.n }; });
    leg.visits.push(visit);

    /* Im Ligaspiel wird nicht gefeiert - der Schreiber ist Schiedsrichter,
       und ein Vollbild-Loewe mitten im Einzel gegen ein fremdes Team waere
       genau die Zwischenaktion, die die SWO dem Schreiber verbietet. */
    var ligaMatch = m.kind !== 'quick' && S.tour && S.tour.liga && !S.tour.liga.uebung;
    // Höher geht es mit drei Darts nicht.
    if (!isBust && score === 180 && !ligaMatch) feiere180(pid);
    // Die 60 gehört dem Löwen – bei jeder geworfenen 60 (siehe feiere60).
    else if (!isBust && score === 60 && !ligaMatch) feiere60(pid);

    UI.input = ''; UI.darts = []; UI.mult = 1; UI.modeOverride = null; UI.error = '';

    if (isCheckout) {
      leg.winner = pid;
      if (legsWon(m, pid) >= matchLegsToWin(m)) {
        m.done = true;
        m.winner = pid;
        m.at = Date.now();
        /* Das Schnelle Spiel ist mit dem Checkout vorbei – danach geht es in
           die Auswertung, nicht zum nächsten Spiel eines Spielplans. */
        if (m.kind !== 'quick' && UI.turnier && turnierErlaubt()) {
          /* Am Board: 8 Sekunden gross die Statistik des Einzels, dann die
             naechsten Begegnungen - Enter ueberspringt jederzeit. Ein
             frueherer Timer (Undo + neuer Checkout) wird weggeraeumt,
             sonst verkuerzte er die neue Statistik-Anzeige. */
          UI.overlay = { type: 'turnier-ende', pid: pid, id: m.id, phase: 'stat' };
          if (turnierEndeTimer) clearTimeout(turnierEndeTimer);
          turnierEndeTimer = setTimeout(function () {
            turnierEndeTimer = null;
            if (UI.overlay && UI.overlay.type === 'turnier-ende' && UI.overlay.phase === 'stat') {
              UI.overlay.phase = 'weiter';
              render();
            }
          }, 8000);
        } else {
          UI.overlay = { type: m.kind === 'quick' ? 'game-done' : 'match-done', pid: pid };
        }
        /* Im geteilten Turnier steht die Partie sofort bei allen anderen –
           nicht erst, wenn der ganze Abend vorbei ist. */
        if (geteiltesTurnier() && m.kind !== 'quick' && window.DartSync && window.DartSync.turnier) {
          window.DartSync.turnier.ergebnis(m);
        }
      } else {
        UI.overlay = { type: 'leg-done', pid: pid };
      }
      /* Das letzte Einzel des Ligaspiels stempelt die Endzeit für den
         Spielberichtsbogen. */
      if (m.done && S.tour && S.tour.liga && !S.tour.liga.zeitBis && !nextOpenMatch()) {
        S.tour.liga.zeitBis = Date.now();
      }
    }
    save();
    render();
  }

  /* ================= Eingabe: Gesamtpunkte ================= */
  function submitTotal() {
    if (UI.input === '') return;
    var v = parseInt(UI.input, 10);
    var m = currentMatch();
    if (!m || m.done) return;   // beendetes Spiel nimmt keine Würfe mehr an
    var leg = activeLeg(m);
    var rest = remainingIn(leg, activePlayer(leg, m));

    if (v > 180) { UI.error = 'Maximal 180'; UI.input = ''; render(); return; }
    if (IMPOSSIBLE[v]) { UI.error = v + ' ist mit 3 Darts nicht möglich'; UI.input = ''; render(); return; }

    pomp();
    var after = rest - v;
    if (after < 0 || after === 1) { commitVisit(v, 3, false, true); return; }
    if (after === 0) {
      var opts = [];
      for (var n = 1; n <= 3; n++) if (Checkout.possible(rest, n)) opts.push(n);
      if (!opts.length) { UI.error = 'Kein gültiges Finish auf Doppel'; UI.input = ''; render(); return; }
      UI.overlay = { type: 'checkout-darts', score: v, options: opts };
      render();
      return;
    }
    commitVisit(v, 3, false, false);
  }

  function pressKey(k) {
    UI.error = '';
    if (k === 'del') { klick(); UI.input = UI.input.slice(0, -1); render(); return; }
    if (k === 'ok') {
      /* OK auf leerem Feld ist die No-Score-Aufnahme: 0 Punkte, drei
         Darts - in jedem Modus mit Punkte-Eingabe. */
      if (UI.input === '') UI.input = '0';
      submitTotal(); return;
    }
    var next = UI.input + k;
    if (next.length > 3) return;
    var val = parseInt(next, 10);
    if (val > 180) { UI.error = 'Maximal 180'; render(); return; }
    UI.input = String(val);
    // Sobald keine weitere Ziffer mehr passen kann, direkt übernehmen (spart einen Tap).
    if (val >= 19) { submitTotal(); return; }
    render();
  }

  /* ================= Eingabe: Einzel-Darts ================= */
  function pushDart(mult, num) {
    UI.error = '';
    var m = currentMatch();
    if (!m || m.done || settling()) return false;   // beendet oder gerade erst geöffnet
    var leg = activeLeg(m);
    var pid = activePlayer(leg, m);
    var rest = remainingIn(leg, pid) - sum(UI.darts, function (d) { return d.v; });
    var value = mult * num;

    UI.darts.push({ m: mult, n: num, v: value });
    UI.mult = 1;
    pomp();

    var after = rest - value;
    var thrown = UI.darts.length;
    var total = sum(UI.darts, function (d) { return d.v; });

    if (after < 0 || after === 1 || (after === 0 && mult !== 2)) {
      commitVisit(total, thrown, false, true, UI.darts);
      return true;
    }
    if (after === 0) { commitVisit(total, thrown, true, false, UI.darts); return true; }
    if (thrown === 3) { commitVisit(total, 3, false, false, UI.darts); return true; }
    render();
    return true;
  }

  /* ================= Aufnahme korrigieren =================
     Der häufigste Fehler am Abend ist eine falsch getippte Aufnahme, die
     erst später auffällt. Statt alles dazwischen zurückzunehmen, lässt sich
     der Wert direkt ändern – solange das Leg dadurch schlüssig bleibt. */
  function visitFits(leg, pid) {
    var rest = tourStart();
    for (var i = 0; i < leg.visits.length; i++) {
      var v = leg.visits[i];
      if (v.p !== pid) continue;
      if (v.b) continue;
      var after = rest - v.s;
      if (after < 0 || after === 1) return false;
      if (after === 0 && !v.c) return false;
      if (v.c && after !== 0) return false;
      rest = after;
    }
    return true;
  }

  function applyVisitEdit(idx, value) {
    var m = currentMatch();
    if (!m || m.done) return 'Das Spiel ist beendet.';
    var leg = activeLeg(m);
    var v = leg && leg.visits[idx];
    if (!v) return 'Aufnahme nicht gefunden.';
    if (v.c) return 'Ein Finish lässt sich nicht ändern – dafür bitte zurücknehmen.';
    if (value > 180) return 'Maximal 180.';
    if (IMPOSSIBLE[value]) return value + ' ist mit 3 Darts nicht möglich.';

    var backup = { s: v.s, b: v.b, o: v.o, k: v.k };
    var rest = tourStart();
    leg.visits.forEach(function (x, i) { if (x.p === v.p && i < idx && !x.b) rest -= x.s; });
    var after = rest - value;
    delete v.k;                       // Einzeldarts passen nach der Korrektur nicht mehr
    if (after < 0 || after === 1) { v.s = 0; v.b = true; v.o = value; }
    else if (after === 0) { v.s = backup.s; v.b = backup.b; v.o = backup.o; v.k = backup.k; return 'Ein Finish bitte über den Wurf eingeben.'; }
    else { v.s = value; v.b = false; v.o = 0; }

    if (!visitFits(leg, v.p)) {
      v.s = backup.s; v.b = backup.b; v.o = backup.o; if (backup.k) v.k = backup.k;
      return 'Mit diesem Wert passen die späteren Aufnahmen nicht mehr.';
    }
    save();
    return null;
  }

  /* ================= Undo ================= */
  function undo() {
    klick();
    if (UI.overlay && UI.overlay.type === 'checkout-darts') { UI.overlay = null; UI.input = ''; render(); return; }
    if (UI.darts.length) { UI.darts.pop(); UI.mult = 1; render(); return; }

    var m = currentMatch();
    if (!m) return;
    while (m.legs.length && m.legs[m.legs.length - 1].visits.length === 0) m.legs.pop();
    if (!m.legs.length) { UI.overlay = null; render(); return; }

    var leg = m.legs[m.legs.length - 1];
    leg.visits.pop();
    leg.winner = null;
    m.done = false;
    m.winner = null;
    m.at = null;
    /* Der letzte Checkout des Ligaspiels wurde zurückgenommen: die Endzeit
       auf dem Bogen stimmt dann nicht mehr. */
    if (S.tour && S.tour.liga && S.tour.liga.zeitBis && nextOpenMatch()) {
      S.tour.liga.zeitBis = null;
    }
    UI.overlay = null;
    UI.input = '';
    save();
    render();
  }

  /* ================= Statistik ================= */
  /* Ein Dart-Wurf auf ein Doppel ist möglich, wenn der Rest in einem Dart
     ausgecheckt werden kann – daran wird die Doppelquote gemessen. */
  function oneDartFinish(rest) { return (rest <= 40 && rest % 2 === 0) || rest === 50; }

  function emptyStat(id) {
    return {
      id: id, name: pname(id),
      darts: 0, points: 0, visits: 0,
      matches: 0, won: 0, lost: 0,
      legsWon: 0, legsLost: 0,
      first9Points: 0, first9Darts: 0,
      checkouts: 0, doubleAttempts: 0, doubleHits: 0,
      highCO: 0, highFinishes: 0, highScore: 0,
      s180: 0, s140: 0, s100: 0, s60: 0,
      bestLeg: null, tournaments: 0, tourWins: 0,
      cricketGames: 0, cricketWins: 0, cricketMarks: 0, cricketDarts: 0,
      rtwGames: 0, rtwWins: 0, rtwBest: null,
      finGames: 0, finWins: 0, finRounds: 0, finDarts: 0, finBest: null, finHigh: 0,
      lastResults: []
    };
  }

  function finalize(st) {
    st.avg = st.darts ? (st.points / st.darts) * 3 : 0;
    st.first9 = st.first9Darts ? (st.first9Points / st.first9Darts) * 3 : 0;
    st.doubleQuote = st.doubleAttempts ? (st.doubleHits / st.doubleAttempts) * 100 : 0;
    st.legDiff = st.legsWon - st.legsLost;
    st.legs = st.legsWon + st.legsLost;
    st.winPct = st.matches ? (st.won / st.matches) * 100 : 0;
    st.dartsPerLeg = st.legsWon ? st.dartsInWonLegs / st.legsWon : 0;
    st.tons = st.s100 + st.s140 + st.s180;
    st.mpr = st.cricketDarts ? (st.cricketMarks / st.cricketDarts) * 3 : 0;
    st.finAvgDarts = st.finRounds ? st.finDarts / st.finRounds : 0;
    return st;
  }

  /* Wertet eine Liste von Spielen aus – für ein Turnier genauso wie für die Karriere. */
  function collectStats(matchLists, ids) {
    var map = {};
    ids.forEach(function (id) { map[id] = emptyStat(id); map[id].dartsInWonLegs = 0; });
    function stat(id) {
      if (!map[id]) { map[id] = emptyStat(id); map[id].dartsInWonLegs = 0; }
      return map[id];
    }

    matchLists.forEach(function (entry) {
      var start = entry.start || 501;
      entry.matches.forEach(function (m) {
        if (m.kampflos) return;
        if (m.done) {
          /* Nicht auf zwei Spieler festgelegt: ein Schnelles Spiel hat so
             viele Teilnehmer wie ausgewaehlt wurden. Gewonnen hat einer,
             verloren haben alle anderen. */
          m.p.forEach(function (pid) {
            stat(pid).matches++;
            if (pid === m.winner) { stat(pid).won++; stat(pid).lastResults.push({ at: m.at, win: true }); }
            else { stat(pid).lost++; stat(pid).lastResults.push({ at: m.at, win: false }); }
          });
        }
        m.legs.forEach(function (leg) {
          var rest = {};
          var visitNo = {};
          m.p.forEach(function (pid) { rest[pid] = leg && typeof leg.start === 'number' ? leg.start : start; visitNo[pid] = 0; });

          leg.visits.forEach(function (v) {
            var st = stat(v.p);
            var before = rest[v.p];
            st.darts += v.d;
            st.visits++;

            // Erste 9 Darts eines Legs
            if (visitNo[v.p] < 3) {
              st.first9Darts += v.d;
              st.first9Points += v.b ? 0 : v.s;
            }
            visitNo[v.p]++;

            /* Doppelquote nur aus dartgenau erfassten Aufnahmen: Wie viele
               Darts auf einem Doppel lagen, weiß die App nur im Einzel-Dart-
               Modus. Eine Schätzung für die Punkte-Eingabe hinge sonst am
               Eingabeweg statt an der Leistung – lieber ehrlich weglassen.
               Da die App im Finish-Bereich automatisch umschaltet, sind das
               im Normalbetrieb praktisch alle Finish-Darts. */
            if (v.k && v.k.length) {
              var r = before;
              for (var i = 0; i < v.k.length; i++) {
                var d = v.k[i];
                if (oneDartFinish(r)) st.doubleAttempts++;
                r -= d.m * d.n;
              }
              if (v.c) st.doubleHits++;
            }

            if (!v.b) {
              st.points += v.s;
              rest[v.p] = before - v.s;
              if (v.s > st.highScore) st.highScore = v.s;
              if (v.s === 180) st.s180++;
              else if (v.s >= 140) st.s140++;
              else if (v.s >= 100) st.s100++;
              else if (v.s >= 60) st.s60++;
              if (v.c) {
                st.checkouts++;
                if (v.s > st.highCO) st.highCO = v.s;
                if (v.s >= 100) st.highFinishes++;
              }
            }
          });

          if (leg.winner) {
            var w = stat(leg.winner);
            w.legsWon++;
            var opp = m.p[0] === leg.winner ? m.p[1] : m.p[0];
            stat(opp).legsLost++;
            var used = dartsInLeg(leg, leg.winner);
            w.dartsInWonLegs += used;
            if (w.bestLeg === null || used < w.bestLeg) w.bestLeg = used;
          }
        });
      });
    });

    return map;
  }

  function dartsInLeg(leg, pid) {
    return sum(leg.visits, function (v) { return v.p === pid ? v.d : 0; });
  }

  /* Statistik des laufenden Turniers. */
  function stats() {
    var map = collectStats([{ matches: S.matches, start: tourStart() }], tourPlayers());
    Object.keys(map).forEach(function (k) { finalize(map[k]); });
    return map;
  }

  /* Statistik über alles, was je gespielt wurde (inkl. laufendem Turnier). */
  function career() {
    /* Turniere und Schnelle Spiele liefern beide Match-Listen und fließen
       damit in dieselbe Classic-Auswertung. */
    /* Uebungsspiele (Training gegen Bots oder Team B) zaehlen in keine
       Wertung - Siege gegen leichte Bots waeren sonst beliebig farmbar. */
    var lists = S.history.filter(function (h) {
      if (h.liga && h.liga.uebung) return false;
      return (h.kind || '501') === '501' || h.kind === 'quick';
    }).map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length && !(S.tour && S.tour.liga && S.tour.liga.uebung)) {
      lists.push({ matches: S.matches, start: tourStart() });
    }
    var ids = S.profiles.map(function (p) { return p.id; });
    var map = collectStats(lists, ids);
    var open = S.game && S.game.done ? [S.game] : [];
    S.history.concat(open).forEach(function (h) {
      if (h.liga && h.liga.uebung) return;
      var kind = h.kind || '501';
      if (kind === '501') {
        // Nur wer in diesem Turnier auch gespielt hat, bekommt eine Teilnahme.
        var played = {};
        (h.matches || []).forEach(function (m) {
          if (!m.done) return;
          played[m.p[0]] = 1; played[m.p[1]] = 1;
        });
        Object.keys(played).forEach(function (id) { if (map[id]) map[id].tournaments++; });
        if (h.winner && map[h.winner] && played[h.winner]) map[h.winner].tourWins++;
        return;
      }
      if (kind === 'cricket') {
        var cs = cricketState({ players: h.players, throws: h.throws, scoring: h.scoring });
        h.players.forEach(function (id) {
          if (!map[id]) return;
          map[id].cricketGames++;
          map[id].cricketDarts += cs.darts[id];
          map[id].cricketMarks += cs.allMarks[id];
        });
        if (h.winner && map[h.winner]) map[h.winner].cricketWins++;
      } else if (kind === 'rtw') {
        var rs = rtwState({ players: h.players, throws: h.throws, boost: h.boost !== false });
        h.players.forEach(function (id) {
          if (!map[id]) return;
          map[id].rtwGames++;
          // Jeder komplette Durchlauf zählt für die Bestleistung, nicht nur der Sieg.
          var fin = rs.finished[id];
          if (fin && (map[id].rtwBest === null || fin.darts < map[id].rtwBest)) map[id].rtwBest = fin.darts;
        });
        if (h.winner && map[h.winner]) map[h.winner].rtwWins++;
      } else if (kind === 'finisher') {
        h.players.forEach(function (id) { if (map[id]) map[id].finGames++; });
        // Gezählt wird je gewonnener Runde – da steckt die Leistung drin,
        // nicht im Spielsieg allein.
        (h.rounds || []).forEach(function (rd) {
          var s = rd.sieger && map[rd.sieger];
          if (!s || !rd.darts) return;
          s.finRounds++;
          s.finDarts += rd.darts;
          if (s.finBest === null || rd.darts < s.finBest) s.finBest = rd.darts;
          if (rd.zahl > s.finHigh) s.finHigh = rd.zahl;
        });
        if (h.winner && map[h.winner]) map[h.winner].finWins++;
      }
    });
    Object.keys(map).forEach(function (k) {
      map[k].name = pname(k);
      finalize(map[k]);
      map[k].lastResults.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
    return map;
  }

  /* Karriere-Statistik nur über Ligaspiele – für den Liga-Reiter der
     Rangliste. Gleiche Rechnung wie career(), andere Auswahl. */
  function careerLiga() {
    /* Uebungsspiele (DiensDarts) zaehlen nicht in die Liga-Rangliste. */
    var lists = S.history.filter(function (h) { return h.liga && !h.liga.uebung && h.matches; })
      .map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung) lists.push({ matches: S.matches, start: tourStart() });
    var map = collectStats(lists, S.profiles.map(function (p) { return p.id; }));
    Object.keys(map).forEach(function (k) {
      map[k].name = pname(k);
      finalize(map[k]);
      map[k].lastResults.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
    return map;
  }

  /* Alle fertigen Liga-Einzel, neueste zuerst – fürs Liga-Verlaufsdiagramm. */
  function alleLigaMatches() {
    var out = [];
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung) {
      S.matches.forEach(function (m) {
        if (m.done && knownPlayers(m.p)) out.push({ m: m, at: m.at, live: true });
      });
    }
    S.history.forEach(function (h) {
      if (!h.liga || h.liga.uebung || !h.matches) return;
      h.matches.forEach(function (m) {
        if (m.done && knownPlayers(m.p)) out.push({ m: m, at: h.at });
      });
    });
    out.sort(function (a, b) { return (b.m.at || b.at || 0) - (a.m.at || a.at || 0); });
    return out;
  }

  function standings() {
    var map = stats();
    return tourPlayers().map(function (id) { return map[id]; }).sort(function (a, b) {
      if (b.won !== a.won) return b.won - a.won;
      if (b.legDiff !== a.legDiff) return b.legDiff - a.legDiff;
      if (b.avg !== a.avg) return b.avg - a.avg;
      return a.name.localeCompare(b.name);
    });
  }

  /* ================= Ranglisten ================= */
  var BOARDS = [
    /* Reihenfolge je Modus: Siege zuerst, dann der Average (oder was in
       diesem Modus dafuer steht), dann der Rest. Der erste Eintrag ist auch
       die Voreinstellung beim Moduswechsel -- siehe renderBoards(). */
    { mode: '501', key: 'won', label: 'Siege', get: function (s) { return s.won; }, fmt: function (v) { return String(v); }, min: function (s) { return s.matches > 0; }, hint: 'Gewonnene Spiele über alle Turniere.' },
    { mode: '501', key: 'avg', label: 'Average', unit: '', get: function (s) { return s.avg; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.darts >= MIN_DARTS_FOR_AVG; }, hint: 'Punkte je 3 Darts über alle Spiele. Zählt ab ' + MIN_DARTS_FOR_AVG + ' geworfenen Darts.' },
    { mode: '501', key: 'first9', label: 'First 9', get: function (s) { return s.first9; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.first9Darts >= 9; }, hint: 'Average der ersten 9 Darts eines Legs – das Maß für den Scoring-Antritt.' },
    { mode: '501', key: 'doubleQuote', label: 'Doppelquote', get: function (s) { return s.doubleQuote; }, fmt: function (v) { return v.toFixed(1) + ' %'; }, min: function (s) { return s.doubleAttempts >= 3; }, hint: 'Getroffene Finishes je Dart auf ein mögliches Doppel (Rest 2–40 gerade oder Bull). Zählt ab 3 Versuchen.' },
    { mode: '501', key: 'highCO', label: 'Höchstes Finish', get: function (s) { return s.highCO; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highCO > 0; }, hint: 'Der höchste je ausgecheckte Rest.' },
    { mode: '501', key: 's180', label: '180er', get: function (s) { return s.s180; }, fmt: function (v) { return String(v); }, min: function (s) { return s.s180 > 0; }, hint: 'Maximum – alle drei Darts in die Triple 20.' },
    { mode: '501', key: 'highScore', label: 'Höchste Aufnahme', get: function (s) { return s.highScore; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highScore > 0; }, hint: 'Die beste einzelne Aufnahme aus 3 Darts.' },
    { mode: '501', key: 'bestLeg', label: 'Bestes Leg', get: function (s) { return s.bestLeg; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.bestLeg !== null; }, asc: true, hint: 'Wenigste Darts für ein gewonnenes Leg.' },
    { mode: '501', key: 'tons', label: '100+ Aufnahmen', get: function (s) { return s.tons; }, fmt: function (v) { return String(v); }, min: function (s) { return s.tons > 0; }, hint: 'Alle Aufnahmen ab 100 Punkten (inkl. 140+ und 180).' },
    { mode: '501', key: 'winPct', label: 'Siegquote', get: function (s) { return s.winPct; }, fmt: function (v) { return v.toFixed(0) + ' %'; }, min: function (s) { return s.matches >= 3; }, hint: 'Anteil gewonnener Spiele. Zählt ab 3 Spielen.' },
    { mode: '501', key: 'legsWon', label: 'Legs', get: function (s) { return s.legsWon; }, fmt: function (v) { return String(v); }, min: function (s) { return s.legsWon > 0; }, hint: 'Gewonnene Legs insgesamt.' },
    { mode: '501', key: 'tourWins', label: 'Turniersiege', get: function (s) { return s.tourWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.tourWins > 0; }, hint: 'Gewonnene, abgeschlossene Turniere.' },
    { mode: 'cricket', key: 'cricketWins', label: 'Siege', get: function (s) { return s.cricketWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.cricketGames > 0; }, hint: 'Gewonnene Cricket-Spiele.' },
    { mode: 'cricket', key: 'mpr', label: 'MPR', get: function (s) { return s.mpr; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.cricketDarts >= 9; }, hint: 'Marks per Round: getroffene Marken je 3 Darts im Cricket.' },
    { mode: 'rtw', key: 'rtwWins', label: 'Siege', get: function (s) { return s.rtwWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.rtwGames > 0; }, hint: 'Gewonnene Round-the-World-Trainings.' },
    { mode: 'rtw', key: 'rtwBest', label: 'Bestes Ergebnis', get: function (s) { return s.rtwBest; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.rtwBest !== null; }, asc: true, hint: 'Wenigste Darts für einen kompletten Durchlauf von der 1 bis Bull.' },
    { mode: 'finisher', key: 'finWins', label: 'Siege', get: function (s) { return s.finWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finGames > 0; }, hint: 'Gewonnene Finisher-Spiele.' },
    { mode: 'finisher', key: 'finAvgDarts', label: 'Ø Darts je Finish', get: function (s) { return s.finAvgDarts; }, fmt: function (v) { return v.toFixed(1); }, min: function (s) { return s.finRounds >= 3; }, asc: true, hint: 'Wie viele Darts du im Schnitt für ein gewonnenes Finish brauchst. Zählt ab 3 gewonnenen Runden.' },
    { mode: 'finisher', key: 'finRounds', label: 'Gewonnene Runden', get: function (s) { return s.finRounds; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finGames > 0; }, hint: 'Jede Runde, in der du als Erster ausgecheckt hast.' },
    { mode: 'finisher', key: 'finBest', label: 'Schnellstes Finish', get: function (s) { return s.finBest; }, fmt: function (v) { return plural(v, 'Dart', 'Darts'); }, min: function (s) { return s.finBest !== null; }, asc: true, hint: 'Wenigste Darts für ein gewonnenes Finish.' },
    { mode: 'finisher', key: 'finHigh', label: 'Höchste Zahl', get: function (s) { return s.finHigh; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finHigh > 0; }, hint: 'Die höchste Zahl, die du in einer Runde als Erster weggemacht hast.' }
  ];

  /* Die Liga-Rangliste: dieselben Classic-Kategorien, aber nur über
     Ligaspiele gerechnet. Turniersiege gibt es dort nicht. */
  BOARDS.filter(function (b) { return b.mode === '501' && b.key !== 'tourWins'; })
    .forEach(function (b) {
      var kopie = {};
      Object.keys(b).forEach(function (k) { kopie[k] = b[k]; });
      kopie.mode = 'liga';
      BOARDS.push(kopie);
    });

  function boardDef(key) {
    for (var i = 0; i < BOARDS.length; i++) if (BOARDS[i].key === key) return BOARDS[i];
    return BOARDS[0];
  }
  function boardsFor(mode) {
    return BOARDS.filter(function (b) { return b.mode === mode; });
  }

  function ranking(def, map) {
    var known = {};
    S.profiles.forEach(function (p) { known[p.id] = p; });
    var rows = Object.keys(map).map(function (k) { return map[k]; }).filter(function (s) {
      /* Nur Stammspieler: Gaeste eines Abends (und Bots) gehoeren nicht
         in die Rangliste der Mannschaft - ihre Spiele bleiben im Verlauf. */
      return def.min(s) && known[s.id] && !known[s.id].hidden && !known[s.id].bot && !known[s.id].gast;
    });
    rows.sort(function (a, b) {
      var d = def.asc ? def.get(a) - def.get(b) : def.get(b) - def.get(a);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    return rows;
  }

  /* Alle je gespielten Spiele, neueste zuerst. */
  function knownPlayers(ids) {
    return ids.every(function (id) {
      for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === id) return true;
      return false;
    });
  }

  function allMatches() {
    var out = [];
    if (S.matches.length && !(S.tour && S.tour.liga && S.tour.liga.uebung)) {
      S.matches.forEach(function (m) { if (m.done && knownPlayers(m.p)) out.push({ m: m, start: tourStart(), live: true }); });
    }
    S.history.forEach(function (h) {
      // Cricket, RTW und Finisher haben keine Match-Liste - und
      // Uebungsspiele zaehlen nirgends.
      if (h.liga && h.liga.uebung) return;
      if ((h.kind || '501') !== '501' && h.kind !== 'quick') return;
      h.matches.forEach(function (m) {
        if (m.done && knownPlayers(m.p)) out.push({ m: m, start: (h.settings && h.settings.start) || 501, at: h.at });
      });
    });
    out.sort(function (a, b) { return (b.m.at || b.at || 0) - (a.m.at || a.at || 0); });
    return out;
  }

  /* ================= Cricket ================= */
  var CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25];
  function cricketLabel(n) { return n === 25 ? 'Bull' : String(n); }

  /* Der Zustand wird immer aus der Wurfliste neu aufgebaut – so ist jeder
     Dart einzeln rücknehmbar und nichts kann auseinanderlaufen. */
  function cricketState(g) {
    var st = { marks: {}, score: {}, darts: {}, allMarks: {}, closed: {}, winner: null, winAt: -1 };
    g.players.forEach(function (id) {
      st.marks[id] = {}; st.score[id] = 0; st.darts[id] = 0; st.allMarks[id] = 0;
      CRICKET_NUMBERS.forEach(function (n) { st.marks[id][n] = 0; });
    });

    for (var i = 0; i < g.throws.length; i++) {
      var t = g.throws[i];
      var pid = g.players[Math.floor(i / 3) % g.players.length];
      st.darts[pid]++;
      if (!t.n || CRICKET_NUMBERS.indexOf(t.n) < 0) continue;

      // Ein Feld, das bei allen zu ist, bringt keine Marken mehr (übliche MPR-Zählung).
      var dead = g.players.every(function (o) { return st.marks[o][t.n] >= 3; });
      if (!dead) st.allMarks[pid] += t.m;
      var open = 3 - st.marks[pid][t.n];
      var used = Math.min(t.m, open);
      st.marks[pid][t.n] += used;
      var extra = t.m - used;
      if (extra > 0 && g.scoring) {
        var stillOpen = g.players.some(function (o) { return o !== pid && st.marks[o][t.n] < 3; });
        if (stillOpen) st.score[pid] += extra * t.n;
      }

      if (st.winner === null && hasAllClosed(st, pid)) {
        var best = 0;
        g.players.forEach(function (o) { if (o !== pid && st.score[o] > best) best = st.score[o]; });
        if (!g.scoring || st.score[pid] >= best) { st.winner = pid; st.winAt = i; }
      }
    }
    g.players.forEach(function (id) { st.closed[id] = hasAllClosed(st, id); });
    return st;
  }

  function hasAllClosed(st, pid) {
    for (var i = 0; i < CRICKET_NUMBERS.length; i++) {
      if (st.marks[pid][CRICKET_NUMBERS[i]] < 3) return false;
    }
    return true;
  }

  function cricketDart(mult, num) {
    var g = S.game;
    if (!g || g.done || settling()) return false;
    pomp();
    // Bull: 25 zählt eine Marke, Doppel-Bull zwei.
    var m = num === 25 ? (mult === 2 ? 2 : 1) : mult;
    g.throws.push({ n: num, m: num === 0 ? 0 : m });
    UI.mult = 1;   // wie im 501-Modus: nach jedem Dart zurück auf Single
    var st = cricketState(g);
    if (st.winner) { g.done = true; g.winner = st.winner; g.at = Date.now(); UI.overlay = { type: 'game-done', pid: st.winner }; }
    save(); render();
    return true;
  }

  /* ================= Round the World ================= */
  /* Ziel 1..20, danach Bull (25). Ein Treffer rückt um den Multiplikator vor,
     über die 20 hinaus landet man immer auf Bull. */
  /* Round the World wird Aufnahme für Aufnahme nachgespielt: Wer den Bull
     getroffen hat, wird übersprungen, und die angefangene Runde wird zu Ende
     gespielt, damit der spätere Startplatz nicht benachteiligt ist.
     Es gewinnt, wer den Bull mit den wenigsten Darts trifft; bei Gleichstand
     entscheidet ein Stechen auf Bull. */
  function rtwState(g) {
    var n = g.players.length;
    var st = { target: {}, darts: {}, hits: {}, finished: {}, winner: null, closing: false, turn: 0, visit: [] };
    g.players.forEach(function (id) { st.target[id] = 1; st.darts[id] = 0; st.hits[id] = 0; });

    var turn = 0, inVisit = 0, over = false;
    for (var i = 0; i < g.throws.length && !over; i++) {
      var t = g.throws[i];
      var pid = g.players[turn];
      st.visit.push(t);
      st.darts[pid]++;
      var target = st.target[pid];

      if (t.n && target === 25 && t.n === 25) {
        st.hits[pid]++;
        st.finished[pid] = { darts: st.darts[pid], at: i };
      } else if (t.n && target !== 25 && t.n === target) {
        st.hits[pid]++;
        /* Einfach: nur die Zahl zaehlt, jeder Treffer rueckt genau ein Feld
           weiter. Boost: Double ueberspringt eine Zahl, Triple zwei.
           Die Spielart steht am Spiel, nicht in den Einstellungen -- sonst
           wuerde ein Umschalten mitten im Abend jeden schon geworfenen Dart
           rueckwirkend anders bewerten. */
        var next = target + (g.boost ? t.m : 1);
        st.target[pid] = next > 20 ? 25 : next;
      }

      inVisit++;
      // Mit dem Bull ist die Aufnahme sofort zu Ende – die restlichen Darts
      // der eigenen Aufnahme werden nicht mehr geworfen.
      if (inVisit === 3 || st.finished[pid]) {
        inVisit = 0;
        st.visit = [];
        // Nächsten Spieler suchen, fertige überspringen.
        var steps = 0, wrapped = false, next2 = turn;
        do {
          next2 = (next2 + 1) % n;
          if (next2 === 0) wrapped = true;
          steps++;
        } while (st.finished[g.players[next2]] && steps <= n);
        turn = next2;
        if (Object.keys(st.finished).length && (wrapped || steps > n)) over = true;
      }
    }

    st.turn = turn;
    st.inVisit = inVisit;
    var done = Object.keys(st.finished);
    if (done.length) {
      st.closing = !over;
      if (over) {
        done.sort(function (a, b) {
          var fa = st.finished[a], fb = st.finished[b];
          return fa.darts !== fb.darts ? fa.darts - fb.darts : fa.at - fb.at;
        });
        /*
         * Gleich viele Darts heisst gleich gut. Vorher gewann der frühere
         * Treffer – das ist aber nur der bessere Startplatz, keine Leistung.
         * Also entscheidet der Bull, genau wie im Finisher. Das Ergebnis
         * lässt sich nicht aus den Würfen ableiten und steht deshalb am
         * Spiel, nicht im Zustand.
         */
        var beste = st.finished[done[0]].darts;
        st.gleich = done.filter(function (id) { return st.finished[id].darts === beste; });
        if (st.gleich.length > 1) {
          if (g.stechenSieger && st.gleich.indexOf(g.stechenSieger) >= 0) st.winner = g.stechenSieger;
          else st.stechen = st.gleich;
        } else {
          st.winner = done[0];
        }
      }
    }
    return st;
  }

  function rtwDart(mult, num) {
    var g = S.game;
    if (!g || g.done || settling()) return false;
    // Im Stechen wird nicht mehr eingetragen, sondern entschieden.
    if (rtwState(g).stechen) return false;
    pomp();
    var m = num === 25 ? (mult === 2 ? 2 : 1) : mult;
    g.throws.push({ n: num, m: num === 0 ? 0 : m });
    UI.mult = 1;
    var st = rtwState(g);
    if (st.winner) { g.done = true; g.winner = st.winner; g.at = Date.now(); UI.overlay = { type: 'game-done', pid: st.winner }; }
    save(); render();
    return true;
  }

  /* ================= Gemeinsames für beide Modi ================= */
  function gameTurnPlayer(g) {
    if (g.kind === 'rtw') return g.players[rtwState(g).turn];
    return g.players[Math.floor(g.throws.length / 3) % g.players.length];
  }
  /* Die Darts der laufenden Aufnahme – nach einem Sieg mit dem dritten Dart
     bleibt die Aufnahme sichtbar, statt leer zu wirken. */
  function gameVisitDarts(g) {
    if (g.kind === 'rtw') {
      var st = rtwState(g);
      return st.inVisit === 0 && g.throws.length ? g.throws.slice(-3) : st.visit;
    }
    var startIdx = Math.floor(g.throws.length / 3) * 3;
    if (startIdx === g.throws.length && g.throws.length) startIdx -= 3;
    return g.throws.slice(startIdx);
  }
  function undoGame() {
    var g = S.game;
    if (g && g.kind === 'finisher') return undoFinisher(g);
    // Das Schnelle Spiel benutzt die Aufnahmen-Logik des X01, also auch
    // deren Undo – Dart für Dart und über Aufnahmen hinweg.
    if (g && g.kind === 'quick') return undo();
    if (!g || !g.throws.length) return;
    g.throws.pop();
    /* Auch das Stechen zurueck: sonst staende der Sieger noch fest, obwohl
       der Dart, der den Gleichstand ueberhaupt erzeugt hat, weg ist. */
    g.stechenSieger = null;
    g.done = false; g.winner = null; g.at = null;
    UI.overlay = null;
    UI.mult = 1;
    save(); render();
  }

  /* ================= Finisher =================
   *
   * Alle starten auf derselben Zahl zwischen 6 und 120 und spielen sie ganz
   * normal herunter, Double Out. Kein Scoring-Teil – nur das Finishen, weil
   * genau das im echten Spiel am längsten dauert und deshalb Training braucht.
   *
   * Wer zuerst auscheckt, gewinnt die Runde. Wer in dieser Runde noch nicht
   * dran war, darf noch gleichziehen – deshalb endet eine Runde erst, wenn
   * alle gleich viele Aufnahmen hatten. Schaffen es mehrere, entscheidet ein
   * Stechen auf Bull (von Hand, wie beim Anwurf: werfen und antippen).
   */
  var FIN_MIN = 6, FIN_MAX = 120;

  function zieheFinishZahl(letzte) {
    var z;
    do {
      z = FIN_MIN + Math.floor(Math.random() * (FIN_MAX - FIN_MIN + 1));
    } while (z === letzte);   // zweimal dieselbe Zahl hintereinander wirkt kaputt
    return z;
  }

  function neueFinisherRunde(g) {
    var letzte = g.rounds.length ? g.rounds[g.rounds.length - 1].zahl : 0;
    g.rounds.push({ zahl: zieheFinishZahl(letzte), throws: [], sieger: null, stechen: null, darts: 0 });
  }

  function finisherRunde(g) { return g.rounds[g.rounds.length - 1]; }

  /*
   * Der ganze Spielstand wird aus den gespeicherten Würfen neu gerechnet –
   * wie bei Cricket und RTW. Dadurch ist Undo einfach ein Wurf weniger.
   */
  function finisherState(g) {
    var n = g.players.length;
    var st = {
      punkte: {}, runde: g.rounds.length - 1, zahl: 0,
      rest: {}, darts: {}, aufnahmen: {}, fertig: {},
      turn: 0, inVisit: 0, visit: [], restVorVisit: 0,
      rundeVorbei: false, stechen: null, sieger: null
    };
    g.players.forEach(function (id) { st.punkte[id] = 0; });
    g.rounds.forEach(function (rd) {
      if (rd.sieger && st.punkte[rd.sieger] !== undefined) st.punkte[rd.sieger]++;
    });

    var rd = finisherRunde(g);
    st.zahl = rd.zahl;
    st.stechen = rd.stechen;
    st.sieger = rd.sieger;
    g.players.forEach(function (id) { st.rest[id] = rd.zahl; st.darts[id] = 0; st.aufnahmen[id] = 0; });

    var turn = 0, inVisit = 0, restVorVisit = rd.zahl, visit = [];
    for (var i = 0; i < rd.throws.length; i++) {
      var t = rd.throws[i];
      var pid = g.players[turn];
      if (inVisit === 0) restVorVisit = st.rest[pid];

      st.darts[pid]++;
      visit.push(t);
      inVisit++;

      var nach = st.rest[pid] - t.n * t.m;
      var fertig = false, bust = false;
      // Genau wie im X01: unter null, auf 1 stehen bleiben oder ohne Doppel
      // auf null – alles drei ist ein Bust, die ganze Aufnahme verfällt.
      if (nach === 0 && t.m === 2) { st.rest[pid] = 0; fertig = true; }
      else if (nach < 0 || nach === 1 || nach === 0) bust = true;
      else st.rest[pid] = nach;

      if (fertig) st.fertig[pid] = { darts: st.darts[pid], at: i };
      if (bust) st.rest[pid] = restVorVisit;

      if (fertig || bust || inVisit === 3) {
        st.aufnahmen[pid]++;
        inVisit = 0;
        visit = [];
        // Wer durch ist, wirft nicht mehr – aber die anderen ziehen nach.
        var steps = 0, next = turn;
        do {
          next = (next + 1) % n;
          steps++;
        } while (st.fertig[g.players[next]] && steps <= n);
        turn = next;
      }
    }

    st.turn = turn;
    st.inVisit = inVisit;
    st.visit = visit;
    st.restVorVisit = restVorVisit;

    // Runde vorbei, sobald jemand gefinished hat UND alle gleich oft dran waren.
    if (Object.keys(st.fertig).length) {
      var gleich = true;
      for (var k = 1; k < n; k++) {
        if (st.aufnahmen[g.players[k]] !== st.aufnahmen[g.players[0]]) gleich = false;
      }
      st.rundeVorbei = gleich;
    }
    return st;
  }

  function finisherDart(mult, num) {
    var g = S.game;
    if (!g || g.kind !== 'finisher' || g.done || settling()) return false;
    var rd = finisherRunde(g);
    if (rd.stechen) return false;    // erst das Stechen entscheiden
    pomp();
    rd.throws.push({ n: num, m: num === 0 ? 0 : mult });
    UI.mult = 1;
    pruefeFinisherRunde(g);
    save(); render();
    return true;
  }

  function pruefeFinisherRunde(g) {
    var rd = finisherRunde(g);
    if (rd.sieger || rd.stechen) return;
    var st = finisherState(g);
    if (!st.rundeVorbei) return;
    var fertige = Object.keys(st.fertig);
    if (fertige.length > 1) {
      // Gleichgezogen: das entscheidet der Bull, nicht die Dartzahl.
      rd.stechen = { spieler: fertige };
      return;
    }
    finisherRundeAn(g, fertige[0]);
  }

  function finisherRundeAn(g, sieger) {
    var rd = finisherRunde(g);
    var st = finisherState(g);
    rd.sieger = sieger;
    rd.stechen = null;
    rd.darts = st.fertig[sieger] ? st.fertig[sieger].darts : 0;
    if ((st.punkte[sieger] || 0) + 1 >= g.ziel) {
      g.done = true;
      g.winner = sieger;
      g.at = Date.now();
      UI.overlay = { type: 'game-done', pid: sieger };
    } else {
      neueFinisherRunde(g);
    }
  }

  /* Undo im Finisher: einen Dart zurück. Ist die Runde leer, wird die
     vorherige wieder geöffnet – sonst käme man aus einer frisch gezogenen
     Zahl nie mehr heraus. */
  function undoFinisher(g) {
    var rd = finisherRunde(g);
    if (rd.throws.length) {
      rd.throws.pop();
      rd.stechen = null;
      rd.sieger = null;
      rd.darts = 0;
    } else if (g.rounds.length > 1) {
      g.rounds.pop();
      var vor = finisherRunde(g);
      vor.sieger = null;
      vor.stechen = null;
      vor.darts = 0;
      if (vor.throws.length) vor.throws.pop();
    } else {
      return;
    }
    g.done = false; g.winner = null; g.at = null;
    UI.overlay = null;
    UI.mult = 1;
    save(); render();
  }

  function startGame(kind) {
    // Ein beendetes, noch nicht gespeichertes Spiel zuerst sichern.
    if (S.game && S.game.done) archiveGame(S.game);
    /* Cricket, Round the World und Finisher gehen auch allein – als Training
       gegen sich selbst. Nur ganz ohne Spieler geht nichts. */
    if (!S.lineup.length) { UI.overlay = { type: 'need-players' }; render(); return; }
    S.game = {
      id: uid(), kind: kind, at: null, players: S.lineup.slice(), throws: [],
      scoring: kind === 'cricket' ? S.settings.cricketScoring === 1 : false,
      done: false, winner: null, started: false
    };
    if (kind === 'rtw') S.game.boost = S.settings.rtwBoost === 1;
    if (kind === 'finisher') {
      S.game.ziel = S.settings.finisherTo;
      S.game.rounds = [];
      neueFinisherRunde(S.game);
    }
    /*
     * Schnelles Spiel: kein Turnier, alle an einem Board, ein Leg, wer zuerst
     * auscheckt gewinnt. Es bekommt dieselben Felder wie eine Turnierpartie
     * (p, starter, legs, …) – dadurch laufen Spielbildschirm, Punkte- und
     * Einzel-Dart-Eingabe, Finish-Vorschlag, Undo und Korrektur unveraendert
     * weiter, ohne dass es davon eine zweite Fassung braucht.
     */
    if (kind === 'quick') {
      S.game.p = S.lineup.slice();
      S.game.start = S.settings.start;
      S.game.bestOf = 1;
      S.game.starter = S.lineup[0];
      S.game.legs = [];
    }
    UI.mult = 1;
    UI.overlay = null;
    UI.turnier = false;
    // Wie im Turnier wird auch hier ausgeworfen, wer anfängt - ausser
    // allein: gegen sich selbst bullt niemand aus. Das Spiel gilt dann
    // sofort als begonnen, sonst raeumte der Zurueck-Knopf es weg und
    // ein Neustart landete auf dem Bull-Off.
    if (S.lineup.length === 1) {
      S.game.started = true;
      S.screen = kind === 'cricket' ? 'cricket' : kind === 'rtw' ? 'rtw' : kind === 'finisher' ? 'finisher' : 'game';
    } else {
      UI.bullReihe = [];
      S.screen = 'bulloff';
    }
    save(); render();
  }

  function archiveGame(g) {
    if (!g || !g.done) return;
    for (var i = 0; i < S.history.length; i++) if (S.history[i].id === g.id) return;  // nicht doppelt
    var eintrag = {
      id: g.id || uid(), kind: g.kind, at: g.at || Date.now(),
      players: g.players.slice(), winner: g.winner
    };
    // Finisher speichert Runden statt einer flachen Wurfliste – jede Runde
    // hat ihre eigene Zielzahl, die sich sonst nicht rekonstruieren liesse.
    if (g.kind === 'finisher') {
      eintrag.rounds = g.rounds;
      eintrag.ziel = g.ziel;
    } else if (g.kind === 'quick') {
      /* Das Schnelle Spiel wird wie eine Turnierpartie abgelegt – eine
         Match-Liste mit genau einem Eintrag. Dadurch rechnet collectStats()
         Average, First 9, Doppelquote und Rekorde daraus ohne jede
         Sonderbehandlung. */
      eintrag.lineup = g.p.slice();
      eintrag.settings = { start: g.start };
      eintrag.matches = [{
        id: g.id, p: g.p.slice(), starter: g.starter, legs: g.legs,
        done: true, winner: g.winner, at: eintrag.at, start: g.start
      }];
    } else {
      eintrag.scoring = g.scoring;
      eintrag.throws = g.throws;
      /* Ohne die Spielart liesse sich das Spiel spaeter nicht nachrechnen:
         dieselben Wuerfe ergeben in Einfach und Boost verschiedene
         Zahlenfolgen. Altbestand hat sie nicht und war immer Boost. */
      if (g.kind === 'rtw') eintrag.boost = g.boost !== false;
    }
    S.history.unshift(eintrag);
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
    meldeNeuesSpiel(S.history[0]);
  }

  /* Die Online-Schicht (js/sync.js) ist optional: ohne sie – Einzeldatei-
     Bündel, per Doppelklick geöffnet – passiert hier schlicht nichts. */
  function meldeNeuesSpiel(eintrag) {
    if (window.DartSync && eintrag) window.DartSync.neuesSpiel(eintrag);
  }

  function finishGame() {
    archiveGame(S.game);
    S.game = null;
    UI.overlay = null;
    S.screen = 'setup';
    save(); render();
  }

  /* Verlauf über alle Spielarten, neueste zuerst. */
  function allGamesLog() {
    var out = allMatches().map(function (e) { return { kind: '501', at: e.m.at || e.at, e: e, live: e.live }; });
    var extra = S.history.filter(function (h) { return (h.kind || '501') !== '501'; });
    if (S.game && S.game.done) extra = extra.concat([S.game]);
    extra.forEach(function (h) { out.push({ kind: h.kind, at: h.at, h: h, live: h === S.game }); });
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }

  /* ================= Turnier abschließen ================= */
  function archiveTournament() {
    if (!S.matches.length) return;
    var geteilt = geteiltesTurnier();
    /*
     * Beim geteilten Turnier archivieren beide Geräte dasselbe Turnier. Damit
     * daraus nicht zwei Einträge werden, bekommt der Archiv-Eintrag die
     * Kennung des geteilten Turniers: der Server nimmt dieselbe Kennung nur
     * einmal an, und das andere Gerät erkennt sie beim Abgleich wieder.
     */
    if (geteilt && window.DartSync && window.DartSync.turnier) window.DartSync.turnier.ende();
    var table = standings();
    S.history.unshift({
      id: geteilt && geteilt.sid ? geteilt.sid : uid(), at: Date.now(),
      lineup: tourPlayers().slice(),
      settings: { start: tourStart(), bestOf: tour().bestOf },
      matches: S.matches,
      /* Ein Ligaspiel hat keinen Einzelsieger – sonst bekäme der individuell
         beste der acht (womöglich ein Gegner) einen erfundenen Turniersieg
         in Karriere und Rangliste. */
      winner: allMatchesDone() && table[0] && !(S.tour && S.tour.liga) ? table[0].id : null
    });
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
    // Ligaspiele behalten ihre Team-Daten – die Auswertung soll später noch
    // wissen, gegen wen und an welchem Spieltag das war.
    if (S.tour && S.tour.liga) S.history[0].liga = S.tour.liga;
    meldeNeuesSpiel(S.history[0]);
    S.matches = [];
    S.current = null;
    S.tour = null;
    save();
  }

  /* ================= Für die Online-Schicht ================= */

  /*
   * Lokale Spieler-Kennungen durch die des Servers ersetzen. Nötig genau
   * einmal: beim ersten Anmelden, wenn aus dem lokalen Profil „Tobi" der
   * Account von Tobi wird. Die alte Kennung steckt an vielen Stellen (Profile,
   * Aufstellung, Spielplan, Archiv, laufendes Spiel), deshalb wird der ganze
   * Zustand durchgegangen statt jede Stelle einzeln aufzuzählen – eine
   * vergessene Stelle würde die Historie zerreißen.
   *
   * Kennungen stehen im gespeicherten Zustand immer als Wert, nie als
   * Schlüssel; deshalb reicht das Ersetzen von Zeichenketten.
   */
  function ersetzeSpielerIds(map) {
    function geh(wert) {
      if (typeof wert === 'string') return map[wert] || wert;
      if (Array.isArray(wert)) {
        for (var i = 0; i < wert.length; i++) wert[i] = geh(wert[i]);
        return wert;
      }
      if (wert && typeof wert === 'object') {
        for (var k in wert) if (Object.prototype.hasOwnProperty.call(wert, k)) wert[k] = geh(wert[k]);
        return wert;
      }
      return wert;
    }
    geh(S);

    // Nach dem Ersetzen kann derselbe Spieler zweimal in der Liste stehen:
    // einmal das umbenannte lokale Profil, einmal das vom Server geholte.
    // Der erste Treffer gewinnt, sein Bild bleibt erhalten.
    var gesehen = {};
    S.profiles = S.profiles.filter(function (p) {
      if (gesehen[p.id]) return false;
      gesehen[p.id] = 1;
      return true;
    });
    var inAufstellung = {};
    S.lineup = S.lineup.filter(function (id) {
      if (inAufstellung[id]) return false;
      inAufstellung[id] = 1;
      return true;
    });

    save();
  }

  /*
   * Spiele vom Server in die eigene Historie einmischen. Ein Eintrag ist
   * wortgleich das, was archiveGame()/archiveTournament() erzeugt haben –
   * deshalb rechnet career() damit ohne jede Sonderbehandlung weiter.
   */
  function uebernehmeSpiele(liste) {
    if (!liste || !liste.length) return 0;
    var vorhanden = {};
    S.history.forEach(function (h) { vorhanden[h.id] = h; });
    var geaendert = 0;

    liste.forEach(function (s) {
      if (s.geloescht) {
        if (!vorhanden[s.id]) return;
        S.history = S.history.filter(function (h) { return h.id !== s.id; });
        delete vorhanden[s.id];
        geaendert++;
        return;
      }
      if (vorhanden[s.id] || !s.payload) return;
      var eintrag = s.payload;
      eintrag.id = s.id;
      /* Fremde Gastspieler bekommen ein verstecktes Gastprofil - sonst
         stuende in Verlauf und Bericht "Unbekannt". In Aufstellung,
         Spielerliste und Rangliste tauchen sie nicht auf (gast + hidden). */
      if (eintrag.namen) {
        Object.keys(eintrag.namen).forEach(function (fid) {
          if (S.profiles.some(function (p) { return p.id === fid; })) return;
          S.profiles.push({
            id: fid, name: String(eintrag.namen[fid]).slice(0, 30),
            avatar: null, hue: freeHue(), created: Date.now(),
            gast: true, hidden: true
          });
        });
      }
      // Wer es eingetragen hat, bleibt sichtbar – bei fremden Einträgen ist
      // das die einzige Möglichkeit nachzuvollziehen, wo sie herkommen.
      if (s.eingetragenVonName) eintrag.von = s.eingetragenVonName;
      S.history.push(eintrag);
      vorhanden[s.id] = eintrag;
      geaendert++;
    });

    if (geaendert) {
      S.history.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
      save();
    }
    return geaendert;
  }

  /* ================= Rendering ================= */
  var SCREENS = ['setup', 'tournament', 'boards', 'players', 'profile', 'bulloff', 'game', 'cricket', 'rtw', 'finisher', 'summary', 'winner', 'liga', 'bericht', 'konto'];
  var NAV_SCREENS = { setup: 'setup', tournament: 'setup', boards: 'boards', players: 'players', profile: 'players', summary: 'setup', liga: 'liga', konto: 'konto' };

  /* Solange die Anmeldung aussteht, ist die App zu. Ohne Server (Doppelklick,
     Einzeldatei-Bündel, GitHub Pages) gibt es keine Schranke. */
  function gesperrt() {
    if (window.DartKonto) return window.DartKonto.gesperrt();
    /* Beim allerersten Zeichnen ist die Konto-Schicht noch nicht fertig. Sie
       hat die Schranke aber schon als Klasse am <body> gesetzt, damit hier
       nichts aufblitzt, was niemand sehen soll. */
    return document.body.classList.contains('gesperrt');
  }

  function show(screen) {
    /* `screen-konto` fehlt im Einzeldatei-Bündel – dort gibt es keine Konten.
       Deshalb hier nicht blind zugreifen. */
    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.classList.toggle('active', s === screen);
    });
    /* Der Konto-Knopf erscheint nur, wenn die Seite von einem Server kommt.
       Per Doppelklick geöffnet gibt es niemanden, bei dem man sich anmelden
       könnte – dann wäre der Knopf eine leere Versprechung. */
    var kontoBtn = $('nav-konto');
    if (kontoBtn) kontoBtn.classList.toggle('hidden', !window.DartKonto);
    var navFor = gesperrt() ? null : NAV_SCREENS[screen];
    $('nav').classList.toggle('hidden', !navFor);
    if (navFor) {
      $('nav').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-screen') === navFor);
      });
    }
  }

  function render() {
    /* Vor der Anmeldung gibt es nur den Anmeldebildschirm – kein Blick auf
       Spieler, Ranglisten oder ein laufendes Turnier. */
    if (gesperrt()) {
      show('konto');
      if (window.DartKonto) window.DartKonto.render();
      renderOverlay();
      planeBotZug();
      return;
    }
    show(S.screen);
    /* Am Board nimmt die App die volle Bildschirmbreite ein - die uebliche
       Maximalbreite liesse am grossen iPad schwarze Raender, die den
       Schein des aktiven Spielers hart abschneiden. */
    document.body.classList.toggle('am-board',
      UI.turnier && turnierErlaubt() && (S.screen === 'game' || S.screen === 'bulloff'));
    if (S.screen === 'setup') renderSetup();
    /* Der Hintergrundtakt laeuft nur da, wo man ihn auch sieht: im
       Turnierbildschirm. Sonst fragt die App den ganzen Abend nach Daten,
       die niemand anschaut. */
    if (window.DartSync && window.DartSync.turnier) {
      window.DartSync.turnier.takt(S.screen === 'tournament' && !!geteiltesTurnier());
    }
    if (S.screen === 'setup' && letzterScreen !== 'setup') beitretbareHolen();
    // Zusagen frisch holen, wenn man die Liga-Seite betritt – nicht bei
    // jedem Zeichnen, das wäre eine Anfrage je Tastendruck.
    if (S.screen === 'liga' && letzterScreen !== 'liga') { ligaZusagenLaden(); ligaTabelleLaden(); kasseLaden(); }
    letzterScreen = S.screen;
    if (S.screen === 'tournament') renderTournament();
    if (S.screen === 'boards') renderBoards();
    if (S.screen === 'players') renderPlayers();
    if (S.screen === 'profile') renderProfile();
    if (S.screen === 'bulloff') renderBullOff();
    if (S.screen === 'game') renderGame();
    if (S.screen === 'cricket') renderCricket();
    if (S.screen === 'rtw') renderRtw();
    if (S.screen === 'finisher') renderFinisher();
    if (S.screen === 'summary') renderSummary();
    if (S.screen === 'winner') renderWinner();
    if (S.screen === 'liga') renderLiga();
    if (S.screen === 'bericht') renderBericht();
    if (S.screen === 'konto' && window.DartKonto) window.DartKonto.render();
    renderSyncStatus();
    renderOverlay();
    planeBotZug();
  }

  /* Schmale Zeile über der Navigation: was noch nicht beim Server ist.
     Gleiche Haltung wie renderSaveWarning() – lieber sichtbar als still. */
  function renderSyncStatus() {
    var bar = $('sync-status');
    if (!bar) return;
    var text = window.DartSync ? window.DartSync.statusText() : '';
    bar.textContent = text;
    bar.classList.toggle('hidden', !text);
  }

  /*
   * Geteilte Turniere, an denen ich beteiligt bin. Die Liste wird nicht bei
   * jedem Zeichnen geholt – das wäre bei jedem Tastendruck eine Anfrage.
   * Sie kommt beim Betreten des Setups und nach dem Anmelden.
   */
  var beitretbare = [];
  function beitretbareHolen() {
    if (!window.DartSync || !window.DartSync.turnier) return;
    window.DartSync.turnier.offen().then(function (liste) {
      var eigen = geteiltesTurnier();
      var neu = liste.filter(function (t) { return !eigen || t.id !== eigen.sid; });
      var vorher = beitretbare.map(function (t) { return t.id; }).join(',');
      beitretbare = neu;
      if (vorher !== neu.map(function (t) { return t.id; }).join(',')) render();
    });
  }

  function renderBeitreten() {
    var box = $('beitreten-box');
    if (!box) return;
    box.classList.toggle('hidden', !beitretbare.length);
    $('beitreten-liste').innerHTML = beitretbare.map(function (t) {
      var offen = (t.plan.matches || []).length -
        (t.partien || []).filter(function (p) { return p.result; }).length;
      return '<div class="beitreten-zeile">' +
        '<div class="who"><div class="nm">von ' + esc(t.angelegtVonName || 'jemandem') + '</div>' +
        '<div class="sm">' + plural((t.plan.players || []).length, 'Spieler', 'Spieler') + ' · ' +
        plural(offen, 'Partie offen', 'Partien offen') + '</div></div>' +
        '<button class="btn primary small" data-action="turnier-beitreten" data-id="' + esc(t.id) + '">Mitmachen</button>' +
        '</div>';
    }).join('');
  }

  /* Beim Betreten des Setups einmal nachsehen, ob ein Turnier laeuft --
     nicht bei jedem Zeichnen, das waere eine Anfrage je Tastendruck. */
  var letzterScreen = null;

  function renderSetup() {
    renderBeitreten();
    var map = career();
    $('roster').innerHTML = rosterReihenfolge().map(function (p) {
      var st = map[p.id];
      var sel = S.lineup.indexOf(p.id) >= 0;
      return '<div class="roster-item ' + (sel ? 'selected' : '') + '" data-action="toggle-lineup" data-id="' + p.id + '" role="button" tabindex="0">' +
        avatarHTML(p, 'md') +
        '<div class="who"><div class="nm">' + esc(p.name) +
        (p.gast ? ' <span class="gast-marke">Gast</span>' : '') + '</div>' +
        '<div class="sm">' + (st && st.matches ? 'Ø ' + st.avg.toFixed(1) + ' · ' + plural(st.won, 'Sieg', 'Siege') : 'noch kein Spiel') + '</div></div>' +
        /* Hier wird nur ausgewaehlt. Das eigene Profil pflegt man im Konto,
           und Gaeste bearbeitet man unter Spieler -- ein Stift neben jedem
           Namen laedt sonst dazu ein, mitten in der Aufstellung an fremden
           Daten zu drehen. */

        '<span class="check">✓</span>' +
        '</div>';
    }).join('') || '<p class="hint">Noch keine Spieler angelegt.</p>';

    document.querySelectorAll('[data-setting]').forEach(function (seg) {
      var key = seg.getAttribute('data-setting');
      seg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', Number(b.getAttribute('data-value')) === S.settings[key]);
      });
    });

    $('mode-select').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === S.mode);
    });
    /* Ohne Konto gibt es niemanden, mit dem man teilen könnte – und im
       Schnellen Spiel gibt es keinen Spielplan zum Aufteilen. */
    var kannTeilen = !!(window.DartKonto && window.DartKonto.nutzer()) && S.mode === '501';
    $('setting-geteilt').classList.toggle('hidden', !kannTeilen);

    $('settings-cricket').classList.toggle('hidden', S.mode !== 'cricket');
    $('settings-rtw').classList.toggle('hidden', S.mode !== 'rtw');
    $('settings-finisher').classList.toggle('hidden', S.mode !== 'finisher');
    /* Turnier und Schnelles Spiel teilen sich die Einstellungen – Startpunkte
       und Einzel-Dart-Grenze gelten für beide. Nur die Legs sind Turniersache;
       zwei getrennte Karten wären zwei Bedienelemente für dieselbe Einstellung. */
    $('settings-501').classList.toggle('hidden', S.mode !== '501' && S.mode !== 'quick');
    $('setting-bestof').classList.toggle('hidden', S.mode !== '501');
    document.querySelector('[data-action="start-game"]').textContent = 'Spiel starten';

    var runningGame = !!S.game;
    var running = runningGame || (S.matches.length > 0 && !allMatchesDone());
    $('resume-box').classList.toggle('hidden', !running);
    var resumeBtn = $('resume-box').querySelector('[data-action="resume"]');
    if (runningGame && S.game.done) {
      $('resume-box').querySelector('strong').textContent =
        kindName(S.game.kind) + ' beendet';
      $('resume-info').textContent = 'Sieger: ' + pname(S.game.winner) + ' · Ergebnis noch nicht gespeichert';
      resumeBtn.textContent = 'Ergebnis ansehen';
    } else if (runningGame) {
      $('resume-box').querySelector('strong').textContent = 'Laufendes ' + kindName(S.game.kind);
      /* Das Schnelle Spiel zählt seine Darts in Aufnahmen, die anderen
         Spielarten in einer flachen Wurfliste. */
      var geworfen = S.game.kind === 'quick'
        ? sum(S.game.legs || [], function (l) { return sum(l.visits, function (v) { return v.d; }); })
        : (S.game.throws || []).length;
      $('resume-info').textContent = plural(S.game.players.length, 'Spieler', 'Spieler') + ' · ' +
        plural(geworfen, 'Dart', 'Darts') + ' geworfen';
      resumeBtn.textContent = 'Fortsetzen';
    } else if (running) {
      resumeBtn.textContent = 'Fortsetzen';
      $('resume-box').querySelector('strong').textContent =
        S.tour && S.tour.liga ? 'Laufendes Ligaspiel' : 'Laufendes Turnier';
      var done = sum(S.matches, function (m) { return m.done ? 1 : 0; });
      $('resume-info').textContent = done + ' von ' + plural(S.matches.length, 'Spiel', 'Spielen') + ' gespielt';
    }
  }

  /* Im Liga-Betrieb zaehlt der buergerliche Name (SWO: keine Kuenstlernamen).
     Wer keinen gepflegt hat, steht mit dem Anzeigenamen da. */
  function ligaName(pid) {
    var p = profile(pid);
    return p && p.voll ? p.voll : pname(pid);
  }

  /* Die Punktestaffel der SWO je Einzel: Best of 3: 2:0 = 4:0, 2:1 = 3:1 -
     Best of 5: 3:0 = 6:0, 3:1 = 5:1, 3:2 = 4:2. Kampflos zaehlt wie ein
     glattes Ergebnis. Rueckgabe [Punkte Sieger, Punkte Verlierer]. */
  function ligaPunkte(m, gewinnLegs) {
    if (!m.done) return [0, 0];
    var not = gewinnLegs || legsToWin();
    var verliererLegs = m.kampflos ? 0
      : legsWon(m, m.winner === m.p[0] ? m.p[1] : m.p[0]);
    if (not === 2) return verliererLegs === 0 ? [4, 0] : [3, 1];
    return verliererLegs === 0 ? [6, 0] : verliererLegs === 1 ? [5, 1] : [4, 2];
  }

  /* Team-Stand und Spielbericht-Highlights eines Ligaspiels – gebraucht in
     der Übersicht und auf dem Endstand-Bildschirm. */
  function ligaStandDaten() {
    var lg = S.tour && S.tour.liga;
    if (!lg) return null;
    var d = { wirS: 0, sieS: 0, wirL: 0, sieL: 0, wirP: 0, sieP: 0, fertige: 0, hl: [] };
    S.matches.forEach(function (m) {
      var unsere = lg.wir.indexOf(m.p[0]) >= 0 ? m.p[0] : m.p[1];
      var ihre = m.p[0] === unsere ? m.p[1] : m.p[0];
      /* Ein kampfloses Einzel hat keine echten Legs - fuer Stand und Bogen
         zaehlt es trotzdem als glattes Ergebnis. */
      if (m.kampflos && m.done) {
        if (m.winner === unsere) d.wirL += legsToWin(); else d.sieL += legsToWin();
      } else {
        d.wirL += legsWon(m, unsere);
        d.sieL += legsWon(m, ihre);
      }
      if (m.done) {
        d.fertige++;
        var pkt = ligaPunkte(m);
        if (m.winner === unsere) {
          d.wirS++; d.wirP += pkt[0]; d.sieP += pkt[1];
        } else {
          d.sieS++; d.sieP += pkt[0]; d.wirP += pkt[1];
        }
      }
    });
    /* Die Highlights, die der Spielberichtsbogen abfragt: 180er,
       High-Finishes ab 100 und Shortlegs bis 21 Darts – nur unsere Seite. */
    var stMap = stats();
    var hl180 = [], hlFin = [], hlLeg = [];
    lg.wir.forEach(function (id) {
      var s = stMap[id];
      if (!s) return;
      if (s.s180 > 0) hl180.push(esc(s.name) + (s.s180 > 1 ? ' ×' + s.s180 : ''));
      if (s.highCO >= 100) hlFin.push(s.highCO + ' ' + esc(s.name));
      if (s.bestLeg && s.bestLeg <= 21) hlLeg.push(s.bestLeg + ' Darts ' + esc(s.name));
    });
    if (hl180.length) d.hl.push('<b>180er:</b> ' + hl180.join(' · '));
    if (hlFin.length) d.hl.push('<b>High-Finishes:</b> ' + hlFin.join(' · '));
    if (hlLeg.length) d.hl.push('<b>Shortlegs:</b> ' + hlLeg.join(' · '));
    return d;
  }

  function ligaTeamsHtml(d) {
    /* Gross stehen die PUNKTE nach SWO-Staffel - das ist die Wertung, die
       in die Ligatabelle geht. Einzel und Legs stehen darunter. */
    return '<div class="lg-teams">' +
      '<div class="lg-team"><div class="lg-name">' + esc(LIGA.team) + '</div>' +
        '<div class="lg-zahl">' + d.wirP + '</div></div>' +
      '<div class="lg-doppel">:</div>' +
      '<div class="lg-team"><div class="lg-name">' + esc(S.tour.liga.gegner) + '</div>' +
        '<div class="lg-zahl">' + d.sieP + '</div></div>' +
      '</div>';
  }

  function ligaHighlightsHtml(d) {
    if (!d.hl.length) return '';
    return '<div class="lg-hl"><div class="lg-hl-titel">Für den Spielbericht</div>' +
      d.hl.map(function (z) { return '<div>' + z + '</div>'; }).join('') + '</div>';
  }

  function renderTournament() {
    var liga = S.tour && S.tour.liga ? S.tour.liga : null;
    var kopfH1 = document.querySelector('#screen-tournament .app-header h1');
    if (kopfH1) kopfH1.textContent = liga ? 'Ligaspiel' : 'Turnier';
    document.querySelector('#screen-tournament [data-action="to-setup"]').textContent =
      liga ? 'Ligaspiel verlassen' : 'Turnier verlassen';
    document.querySelector('#screen-tournament [data-action="reset"]').textContent =
      liga ? 'Ligaspiel vorzeitig beenden' : 'Turnier vorzeitig beenden';

    var table = standings();
    $('tournament-format').textContent = liga
      ? (liga.uebung ? 'Übungsspiel' : liga.nr + '. Spieltag · ' + (liga.heim ? 'Heim' : 'Auswärts')) +
        ' gegen ' + liga.gegner + ' · Best of ' + tour().bestOf
      : tourStart() + ' Double Out · ' +
        (tour().bestOf === 1 ? 'ein Leg' : 'Best of ' + tour().bestOf) + ' · ' +
        plural(tourPlayers().length, 'Spieler', 'Spieler');

    /* Im Ligaspiel zählt der Team-Stand, keine Einzeltabelle – und statt
       Nachzüglern gibt es den Positionswechsel nach SWO. */
    document.querySelector('#screen-tournament .card.no-pad').classList.toggle('hidden', !!liga);
    var rosterBtn = document.querySelector('[data-action="roster-change"]');
    rosterBtn.textContent = liga ? 'Spieler wechseln (gleiche Position)' : 'Spieler nachtragen oder abmelden';
    $('liga-stand').classList.toggle('hidden', !liga);
    if (liga) {
      var lsd = ligaStandDaten();
      $('liga-stand').innerHTML =
        ligaTeamsHtml(lsd) +
        '<div class="lg-legs">Einzel ' + lsd.wirS + ':' + lsd.sieS + ' · Legs ' +
          lsd.wirL + ':' + lsd.sieL + ' · ' +
          lsd.fertige + ' von ' + S.matches.length + ' gespielt</div>' +
        ligaHighlightsHtml(lsd) +
        '<button class="btn ghost full" data-action="liga-bericht">Spielbericht ansehen &amp; drucken</button>';
    }

    $('standings-body').innerHTML = table.map(function (st, i) {
      return '<tr class="' + (i === 0 && st.won > 0 ? 'leader' : '') + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="left name"><span class="cell">' + avatarHTML(profile(st.id), 'sm') + esc(st.name) + '</span></td>' +
        '<td class="wins">' + st.won + '</td>' +
        '<td>' + st.lost + '</td>' +
        '<td>' + st.legsWon + ':' + st.legsLost + '</td>' +
        '<td>' + (st.avg ? st.avg.toFixed(1) : '–') + '</td>' +
        '</tr>';
    }).join('');

    var next = nextOpenMatch();
    var html = '';
    var round = 0;
    S.matches.forEach(function (m) {
      if (m.round !== round) {
        round = m.round;
        html += '<div class="round-label">' + (liga ? 'Durchgang ' : 'Runde ') + round + '</div>';
      }
      /* Im Ligaspiel steht die Begegnung wie auf dem Bogen: H1 Name - G1
         Name, mit buergerlichen Namen, wenn gepflegt. */
      var a = liga ? ligaName(m.p[0]) : pname(m.p[0]);
      var b = liga ? ligaName(m.p[1]) : pname(m.p[1]);
      var posA = liga && m.posPaar ? '<span class="posmark">H' + (m.posPaar[0] + 1) + '</span> ' : '';
      var posB = liga && m.posPaar ? '<span class="posmark">G' + (m.posPaar[1] + 1) + '</span> ' : '';
      var isNext = next && next.id === m.id;
      var score = m.kampflos
        ? (m.winner === m.p[0] ? legsToWin() + ':0' : '0:' + legsToWin()) + ' w.o.'
        : m.legs.length ? legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) : '–:–';
      html += '<div class="match-row ' + (m.done ? 'done' : '') + (m.void ? ' void' : '') + ' ' + (isNext ? 'next' : '') + '">' +
        '<div class="pair">' +
          posA + (m.winner === m.p[0] ? '<b>' + esc(a) + '</b>' : esc(a)) + ' <span class="muted">vs</span> ' +
          posB + (m.winner === m.p[1] ? '<b>' + esc(b) + '</b>' : esc(b)) +
        '</div>' +
        (liga && m.scheibe ? '<span class="scheibe">' + m.scheibe + '</span>' : '') +
        '<div class="res">' + (m.void ? (m.started ? 'abgebrochen ' + score : 'entfällt') : score) + '</div>' +
        (m.done || m.void
          ? (liga && m.kampflos
            ? '<button class="go wo" data-action="liga-kampflos" data-id="' + m.id + '">ändern</button>'
            : '')
          : m.belegtVon ? '<span class="belegt">läuft bei ' + esc(m.belegtVon) + '</span>'
          : '<button class="go" data-action="open-match" data-id="' + m.id + '">' +
            (m.legs.length ? 'Weiter' : 'Start') + '</button>' +
            (liga && !m.legs.some(function (l) { return l.visits.length > 0; })
              ? '<button class="go wo" data-action="liga-kampflos" data-id="' + m.id + '" ' +
                'title="Kampflos werten" aria-label="Kampflos werten">w.o.</button>'
              : '')) +
        '</div>';
    });
    $('schedule').innerHTML = html;

    /* Gestartet wird direkt an der Partie - einen "Naechstes Spiel"-Knopf
       gibt es nicht mehr. Nur wenn alles gespielt ist, fuehrt ein Knopf
       zum Endstand. */
    $('turnier-endstand').classList.toggle('hidden', !allMatchesDone());

    var map = stats();
    $('stats-grid').innerHTML = tourPlayers().map(function (id) {
      var st = map[id];
      /* Kopf mit fester Hoehe: Bild oben, Name darunter - so stehen die
         Statistikzeilen aller Spalten auf gleicher Hoehe und lassen sich
         nebeneinander vergleichen, egal wie lang ein Name ist. */
      return '<div class="stat-card">' +
        '<div class="who">' + avatarHTML(profile(id), 'md') +
          '<span class="wer-name">' + esc(st.name) + '</span></div>' +
        '<div class="line"><span>Ø 3 Darts</span><b>' + (st.avg ? st.avg.toFixed(1) : '–') + '</b></div>' +
        '<div class="line"><span>First 9</span><b>' + (st.first9 ? st.first9.toFixed(1) : '–') + '</b></div>' +
        '<div class="line"><span>180er</span><b>' + st.s180 + '</b></div>' +
        '<div class="line"><span>100+</span><b>' + st.tons + '</b></div>' +
        '<div class="line"><span>Finish</span><b>' + (st.highCO || '–') + '</b></div>' +
        '<div class="line"><span>Doppelquote</span><b>' + (st.doubleAttempts ? st.doubleQuote.toFixed(0) + ' %' : '–') + '</b></div>' +
        '<div class="line"><span>Bestes Leg</span><b>' + (st.bestLeg ? st.bestLeg + ' Darts' : '–') + '</b></div>' +
        '</div>';
    }).join('');
  }

  /* ================= Verlaufsdiagramm ================= */
  var CHART_GAMES = 10;

  /* Je Spieler eine Reihe mit einem Wert pro Spiel, älteste zuerst. */
  function chartSeries(mode) {
    var per = {};
    function push(id, value) {
      if (!per[id]) per[id] = [];
      per[id].push(value);
    }

    if (mode === '501' || mode === 'liga') {
      var quelle = mode === 'liga' ? alleLigaMatches() : allMatches();
      quelle.slice().reverse().forEach(function (e) {
        e.m.p.forEach(function (id) {
          var darts = 0, points = 0;
          e.m.legs.forEach(function (leg) {
            leg.visits.forEach(function (v) { if (v.p === id) { darts += v.d; if (!v.b) points += v.s; } });
          });
          if (darts) push(id, (points / darts) * 3);
        });
      });
    } else if (mode === 'cricket') {
      var games = S.history.filter(function (h) { return h.kind === 'cricket'; }).slice().reverse();
      if (S.game && S.game.kind === 'cricket' && S.game.done) games.push(S.game);
      games.forEach(function (h) {
        var cs = cricketState({ players: h.players, throws: h.throws, scoring: h.scoring });
        h.players.forEach(function (id) {
          if (cs.darts[id]) push(id, (cs.allMarks[id] / cs.darts[id]) * 3);
        });
      });
    }

    return Object.keys(per).filter(function (id) { return !profile(id).hidden; }).map(function (id) {
      return { id: id, name: pname(id), color: playerColor(id), points: per[id].slice(-CHART_GAMES) };
    }).filter(function (r) { return r.points.length > 0; });
  }

  /* Schlichtes SVG-Liniendiagramm: links die Skala, unten die Spiele. */
  function lineChart(series, label) {
    var maxN = 0, min = Infinity, max = -Infinity;
    series.forEach(function (r) {
      maxN = Math.max(maxN, r.points.length);
      r.points.forEach(function (v) { min = Math.min(min, v); max = Math.max(max, v); });
    });
    if (!series.length || maxN < 2) return null;

    var pad = (max - min) * 0.15 || 5;
    var lo = Math.max(0, min - pad), hi = max + pad;
    var W = 340, H = 190, L = 36, R = 10, T = 12, B = 26;
    var pw = W - L - R, ph = H - T - B;
    var x = function (i, n) { return L + pw - (n - 1 - i) * (pw / (maxN - 1)); };
    var y = function (v) { return T + ph - ((v - lo) / (hi - lo)) * ph; };

    var grid = '';
    for (var g = 0; g <= 3; g++) {
      var val = lo + ((hi - lo) * g) / 3;
      var gy = y(val);
      grid += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="#2a3340" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#8d9aab">' + val.toFixed(0) + '</text>';
    }

    var lines = series.map(function (r) {
      var n = r.points.length;
      var pts = r.points.map(function (v, i) { return x(i, n).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
      var dots = r.points.map(function (v, i) {
        return '<circle cx="' + x(i, n).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.4" fill="' + r.color + '"/>';
      }).join('');
      return '<polyline points="' + pts + '" fill="none" stroke="' + r.color + '" stroke-width="2.2" ' +
        'stroke-linejoin="round" stroke-linecap="round"/>' + dots;
    }).join('');

    /* Jede Linie zeigt die letzten Spiele DIESES Spielers, rechts das jeweils
       jüngste – die Linien liegen also nicht auf einer gemeinsamen Zeitachse. */
    var axis = '<text x="' + L + '" y="' + (H - 8) + '" font-size="9" fill="#8d9aab">früher</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end" font-size="9" fill="#8d9aab">jeweils letztes Spiel</text>';

    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' +
      grid + lines + axis + '</svg>' +
      '<div class="chart-legend">' + series.map(function (r) {
        var last = r.points[r.points.length - 1];
        return '<span class="cl"><i style="background:' + r.color + '"></i>' + esc(r.name) +
          ' <b>' + last.toFixed(1) + '</b></span>';
      }).join('') + '</div>';
  }

  function renderBoards() {
    var mode = UI.boardMode;
    /* Der Liga-Reiter rechnet dieselben Classic-Werte, aber nur über
       Ligaspiele – eigene Karriere-Karte statt der großen. */
    var map = mode === 'liga' ? careerLiga() : career();
    var defs = boardsFor(mode);
    if (!defs.some(function (b) { return b.key === UI.board; })) UI.board = defs[0].key;
    var def = boardDef(UI.board);

    $('board-mode').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === mode);
    });

    var ligaSpieltage = S.history.filter(function (h) { return h.liga && !h.liga.uebung && h.matches; });
    var log = allGamesLog().filter(function (row) { return row.kind === mode; });
    var modeName = mode === '501' ? 'Classic' : mode === 'liga' ? 'Liga' : kindName(mode);
    $('boards-sub').textContent = mode === 'liga'
      ? (ligaSpieltage.length
        ? 'Liga · ' + plural(ligaSpieltage.length, 'Spieltag', 'Spieltage') + ' · ' + LIGA.saison
        : 'Liga · noch kein Spieltag gespielt')
      : log.length
        ? modeName + ' · ' + plural(log.length, 'Spiel', 'Spiele') +
          (mode === '501' ? ' · ' + plural(S.history.filter(function (h) { return (h.kind || '501') === '501'; }).length, 'Turnier', 'Turniere') : '')
        : modeName + ' · noch keine Spiele';

    /* Verlauf: eine farbige Linie je Spieler. */
    var chartLabel = (mode === '501' || mode === 'liga' ? '3-Dart-Average' : 'MPR') + ' – je Spieler die letzten ' + CHART_GAMES + ' Spiele';
    var chart = mode === 'rtw' ? null : lineChart(chartSeries(mode), chartLabel);
    $('board-chart').classList.toggle('hidden', mode === 'rtw' || mode === 'finisher');
    if (mode !== 'rtw') {
      $('board-chart').innerHTML = '<h2>' + chartLabel + '</h2>' +
        (chart || '<p class="hint">Ab dem zweiten Spiel wird hier der Verlauf gezeichnet.</p>');
    }

    $('board-chips').innerHTML = defs.map(function (b) {
      return '<button class="chip ' + (b.key === UI.board ? 'active' : '') + '" data-action="board" data-key="' + b.key + '">' + b.label + '</button>';
    }).join('');

    var rows = ranking(def, map);
    var medals = ['🥇', '🥈', '🥉'];
    $('board-list').innerHTML = rows.length ? rows.map(function (st, i) {
      return '<div class="board-row ' + (i === 0 ? 'top' : '') + '" data-action="open-profile" data-id="' + st.id + '" role="button" tabindex="0">' +
        '<div class="pos">' + (medals[i] || (i + 1) + '.') + '</div>' +
        avatarHTML(profile(st.id), 'sm') +
        '<div class="nm">' + esc(st.name) + '</div>' +
        '<div class="val">' + def.fmt(def.get(st)) + '</div>' +
        '</div>';
    }).join('') : '<div class="board-empty">Dafür fehlen noch Daten.</div>';
    $('board-hint').textContent = def.hint;

    /* Rekorde des jeweiligen Modus. */
    var recs = mode === '501' || mode === 'liga' ? [
      { k: 'highCO', t: 'Höchstes Finish' },
      { k: 'highScore', t: 'Höchste Aufnahme' },
      { k: 'bestLeg', t: 'Bestes Leg' },
      { k: 'avg', t: 'Bester Average' },
      { k: 's180', t: 'Meiste 180er' },
      { k: 'doubleQuote', t: 'Beste Doppelquote' }
    ] : mode === 'cricket' ? [
      { k: 'mpr', t: 'Beste MPR' },
      { k: 'cricketWins', t: 'Meiste Siege' }
    ] : mode === 'finisher' ? [
      /* Eigene Rekorde – vorher standen hier versehentlich die von
         Round the World („Wenigste Darts" eines ganz anderen Spiels). */
      { k: 'finBest', t: 'Schnellstes Finish' },
      { k: 'finHigh', t: 'Höchste Zahl' },
      { k: 'finWins', t: 'Meiste Siege' }
    ] : [
      { k: 'rtwBest', t: 'Wenigste Darts' },
      { k: 'rtwWins', t: 'Meiste Siege' }
    ];
    $('records').innerHTML = recs.map(function (r) {
      var d = boardDef(r.k);
      var top = ranking(d, map)[0];
      return '<div class="rec">' +
        '<div class="rt">' + r.t + '</div>' +
        '<div class="rv">' + (top ? d.fmt(d.get(top)) : '–') + '</div>' +
        '<div class="rn">' + (top ? esc(top.name) : 'noch offen') + '</div>' +
        '</div>';
    }).join('');

    $('log-title').textContent = mode === '501' ? 'Alle Classic-Spiele'
      : mode === 'liga' ? 'Alle Ligaspiele'
      : mode === 'cricket' ? 'Alle Cricket-Spiele'
      : mode === 'finisher' ? 'Alle Finisher-Spiele' : 'Alle Trainings';

    /* Ligaspiele: eine Zeile je Spieltag mit dem Team-Ergebnis. */
    if (mode === 'liga') {
      var ligaLog = ligaSpieltage.slice();
      if (S.tour && S.tour.liga && S.matches.length) {
        ligaLog.unshift({ liga: S.tour.liga, matches: S.matches, at: Date.now(), live: true });
      }
      $('match-log').innerHTML = ligaLog.map(function (h) {
        /* Gewonnen ist ein Spieltag nach SWO-PUNKTEN - 8:8 nach Einzeln
           kann nach Punkten laengst entschieden sein. */
        var not = Math.floor(((h.settings && h.settings.bestOf) || 3) / 2) + 1;
        var wirS = 0, sieS = 0, wirP = 0, sieP = 0;
        h.matches.forEach(function (m) {
          if (!m.done) return;
          var uns = h.liga.wir.indexOf(m.p[0]) >= 0 ? m.p[0] : m.p[1];
          var pkt = ligaPunkte(m, not);
          if (m.winner === uns) { wirS++; wirP += pkt[0]; sieP += pkt[1]; }
          else { sieS++; sieP += pkt[0]; wirP += pkt[1]; }
        });
        return '<div class="log-row">' +
          '<div class="lp ' + (wirP > sieP ? 'w' : '') + '">' + esc(LIGA.team) +
            '<span class="a">' + h.liga.nr + '. Spieltag · ' + (h.liga.heim ? 'Heim' : 'Auswärts') + '</span></div>' +
          '<div class="ls">' + wirP + ':' + sieP + '</div>' +
          '<div class="lp right ' + (sieP > wirP ? 'w' : '') + '">' + esc(h.liga.gegner) + '</div>' +
          '<div class="ld">' + fmtDate(h.at) + ' · Einzel ' + wirS + ':' + sieS +
            (h.live ? ' · läuft gerade' : '') + '</div>' +
          '</div>';
      }).join('') || '<p class="hint">Noch keine Ligaspiele.</p>';
      return;
    }

    $('match-log').innerHTML = log.slice(0, 30).map(function (row) {
      if (row.kind !== '501') {
        var h = row.h;
        var title = h.kind === 'cricket' ? 'Cricket' + (h.scoring ? '' : ' (ohne Punkte)') : kindName(h.kind);
        return '<div class="log-row tap" data-action="open-summary" data-kind="' + h.kind + '" data-id="' + (h.id || 'current') + '" role="button" tabindex="0">' +
          '<div class="lp w">' + esc(pname(h.winner)) + '<span class="a">' + title + '</span></div>' +
          '<div class="ls">🏆</div>' +
          '<div class="lp right">' + h.players.length + ' Spieler<span class="a">' +
            h.players.filter(function (id) { return id !== h.winner; }).map(pname).map(esc).join(', ') + '</span></div>' +
          '<div class="ld">' + fmtDate(row.at) + (row.live ? ' · noch nicht gespeichert' : '') + '</div>' +
          '</div>';
      }
      var e = row.e;
      var m = e.m;
      var la = legsWon(m, m.p[0]), lb = legsWon(m, m.p[1]);
      var avgOf = function (pid) {
        var d = 0, p = 0;
        m.legs.forEach(function (leg) {
          leg.visits.forEach(function (v) { if (v.p === pid) { d += v.d; if (!v.b) p += v.s; } });
        });
        return d ? ((p / d) * 3).toFixed(1) : '–';
      };
      return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + m.id + '" role="button" tabindex="0">' +
        '<div class="lp ' + (m.winner === m.p[0] ? 'w' : '') + '">' + esc(pname(m.p[0])) + '<span class="a">Ø ' + avgOf(m.p[0]) + '</span></div>' +
        '<div class="ls">' + la + ':' + lb + '</div>' +
        '<div class="lp right ' + (m.winner === m.p[1] ? 'w' : '') + '">' + esc(pname(m.p[1])) + '<span class="a">Ø ' + avgOf(m.p[1]) + '</span></div>' +
        '<div class="ld">' + fmtDate(m.at || e.at) + (e.live ? ' · aktuelles Turnier' : '') + '</div>' +
        '</div>';
    }).join('') || '<p class="hint">Noch keine Spiele.</p>';
  }

  function renderPlayers() {
    var map = career();
    /* Geloeschte bzw. abgeraeumte Gaeste tauchen hier gar nicht mehr auf –
       ausgeblendete Team-Profile bleiben (ausgegraut) sichtbar, damit man
       sie wieder einblenden kann. */
    $('players-list').innerHTML = S.profiles.filter(function (p) {
      return !(p.gast && p.hidden);
    }).map(function (p) {
      var st = map[p.id];
      return '<div class="card player-card ' + (p.hidden ? 'hidden-profile' : '') + '" data-action="open-profile" data-id="' + p.id + '" role="button" tabindex="0">' +
        avatarHTML(p, 'lg') +
        '<div class="pc-main">' +
          '<div class="pc-name">' + esc(p.name) +
            (p.gast ? ' <span class="gast-marke">Gast</span>' : '') +
            (p.hidden ? ' <span class="muted">(ausgeblendet)</span>' : '') + '</div>' +
          '<div class="pc-stats">' +
            '<span>Ø <b>' + (st.darts ? st.avg.toFixed(1) : '–') + '</b></span>' +
            '<span>Siege <b>' + st.won + '</b></span>' +
            '<span>180er <b>' + st.s180 + '</b></span>' +
            '<span>Höchstes Finish <b>' + (st.highCO || '–') + '</b></span>' +
          '</div>' +
        '</div>' +
        '<span class="chev">›</span>' +
        '</div>';
    }).join('');
  }

  function renderProfile() {
    var p = profile(UI.profile);
    var st = career()[p.id];
    var editBtn = document.querySelector('[data-action="edit-current-profile"]');
    if (editBtn) editBtn.classList.toggle('hidden', !bearbeitbar(p.id));
    if (!st) { S.screen = 'players'; render(); return; }

    var form = st.lastResults.slice(0, 8).map(function (r) {
      return '<span class="form ' + (r.win ? 'w' : 'l') + '">' + (r.win ? 'S' : 'N') + '</span>';
    }).join('');

    function line(label, value, hint) {
      return '<div class="pline"><span>' + label + (hint ? ' <i>' + hint + '</i>' : '') + '</span><b>' + value + '</b></div>';
    }

    var mine = allMatches().filter(function (e) { return e.m.p.indexOf(p.id) >= 0; }).slice(0, 15);

    $('profile-detail').innerHTML =
      '<div class="profile-head">' + avatarHTML(p, 'xl') +
        '<div><h1>' + esc(p.name) + '</h1>' +
        (p.voll ? '<div class="muted">' + esc(p.voll) + ' \u00b7 echter Name f\u00fcr die Liga</div>' : '') +
        '<div class="muted">' + (st.matches
          ? plural(st.won, 'Sieg', 'Siege') + ' · ' + plural(st.lost, 'Niederlage', 'Niederlagen') +
            ' · ' + plural(st.tourWins, 'Turniersieg', 'Turniersiege')
          : 'Noch kein Spiel gespielt') + '</div>' +
        (form ? '<div class="form-label">Letzte Spiele</div><div class="form-row">' + form + '</div>' : '') +
        '</div></div>' +

      '<p class="hint">Alle Werte über sämtliche gespielten Classic-Spiele.</p>' +
      '<div class="card"><h2>Scoring</h2>' +
        line('3-Dart-Average', st.darts ? st.avg.toFixed(2) : '–') +
        line('First-9-Average', st.first9Darts ? st.first9.toFixed(2) : '–') +
        line('Höchste Aufnahme', st.highScore || '–') +
        line('180er', st.s180) +
        line('140 – 179', st.s140) +
        line('100 – 139', st.s100) +
        line('60 – 99', st.s60) +
        line('Aufnahmen gesamt', st.visits) +
        line('Darts geworfen', st.darts) +
      '</div>' +

      '<div class="card"><h2>Finishing</h2>' +
        line('Doppelquote', st.doubleAttempts ? st.doubleQuote.toFixed(1) + ' %' : '–', 'Treffer je Wurf auf ein mögliches Doppel') +
        line('Doppelversuche', st.doubleAttempts) +
        line('Checkouts', st.checkouts) +
        line('Höchstes Finish', st.highCO || '–') +
        line('Finishes ab 100', st.highFinishes) +
        line('Bestes Leg', st.bestLeg ? st.bestLeg + ' Darts' : '–') +
        line('Ø Darts je gewonnenem Leg', st.dartsPerLeg ? st.dartsPerLeg.toFixed(1) : '–') +
      '</div>' +

      '<div class="card"><h2>Bilanz</h2>' +
        line('Spiele', st.matches) +
        line('Siege / Niederlagen', st.won + ' / ' + st.lost) +
        line('Siegquote', st.matches ? st.winPct.toFixed(0) + ' %' : '–') +
        line('Legs gewonnen / verloren', st.legsWon + ' / ' + st.legsLost) +
        line('Turniere gespielt', st.tournaments) +
        line('Turniersiege', st.tourWins) +
      '</div>' +

      (st.cricketGames ? '<div class="card"><h2>Cricket</h2>' +
        line('Spiele', st.cricketGames) +
        line('Siege', st.cricketWins) +
        line('MPR', st.cricketDarts ? st.mpr.toFixed(2) : '–', 'Marks per Round – Marken je 3 Darts') +
        line('Marken gesamt', st.cricketMarks) +
      '</div>' : '') +

      (st.rtwGames ? '<div class="card"><h2>Round the World</h2>' +
        line('Spiele', st.rtwGames) +
        line('Siege', st.rtwWins) +
        line('Bestes Ergebnis', st.rtwBest ? st.rtwBest + ' Darts' : '–') +
      '</div>' : '') +

      '<div class="card"><h2>Letzte X01-Spiele</h2>' + (mine.length ? mine.map(function (e) {
        var m = e.m;
        var opp = m.p[0] === p.id ? m.p[1] : m.p[0];
        var win = m.winner === p.id;
        return '<div class="log-row">' +
          '<div class="lp ' + (win ? 'w' : '') + '">' + (win ? 'Sieg' : 'Niederlage') + '</div>' +
          '<div class="ls">' + legsWon(m, p.id) + ':' + legsWon(m, opp) + '</div>' +
          '<div class="lp right">gegen ' + esc(pname(opp)) + '</div>' +
          '<div class="ld">' + fmtDate(m.at || e.at) + (e.live ? ' · aktuelles Turnier' : '') + '</div>' +
          '</div>';
      }).join('') : '<p class="hint">Noch keine Spiele.</p>') + '</div>';
  }

  /* ================= Liga-Spielplan ================= */

  var ligaZusagen = null;   // { terminId: [{id, name, avatar, hue}] } vom Server
  var ligaTabelle = null;   // { zeilen: [{team, spiele, punkte, legs}] } vom Server
  var ligaTabelleKennung = null;
  var ligaTabelleMeldung = '';

  /* Alle Teams unserer Liga - fuer die leere Tabelle vorbefuellt. */
  var LIGA_TEAMS = ['Blink 180', 'TSV Dachau 1865 4', 'Dart Artists Germering II',
    'Voodoo Darters', 'd`Haberer 2', 'DCO', 'Treff ma nix', 'TSV Oberpframmern',
    'FT Gern Darts II'];

  function ligaTabelleLaden() {
    if (!window.DartSync || !window.DartSync.liga || !window.DartSync.liga.tabelle) return;
    window.DartSync.liga.tabelle().then(function (t) {
      if (!t) return;
      ligaTabelle = t;
      if (S.screen === 'liga') render();
    });
  }

  /* DiensDarts: das Dienstags-Training. Der naechste Dienstag ist der
     Termin - am Dienstag selbst gilt noch der heutige Abend. */
  function naechsterDienstag() {
    var d = new Date();
    d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7));
    return d;
  }
  function trainingsTerminId(d) {
    var m = String(d.getMonth() + 1), t = String(d.getDate());
    return 'tr' + d.getFullYear() + (m.length < 2 ? '0' : '') + m + (t.length < 2 ? '0' : '') + t;
  }

  /* ---------- Vereinskasse ---------- */
  var kasseDaten = null;

  function kasseLaden() {
    if (!(window.DartSync && window.DartSync.kasse)) return;
    window.DartSync.kasse.holen().then(function (d) {
      if (!d) return;
      kasseDaten = d;
      if (S.screen === 'liga') render();
    }).catch(function () { /* offline: alter Stand bleibt stehen */ });
  }

  function euro(cent) {
    var v = (cent / 100).toFixed(2).replace('.', ',');
    return v + ' €';
  }

  function renderLigaKasse() {
    var online = !!(window.DartSync && window.DartSync.kasse && window.DartKonto && window.DartKonto.nutzer());
    /* Waehrend jemand mitten in einer Buchung steckt (Fokus im Formular
       ODER schon etwas eingetragen), wird nicht neu gebaut - sonst wischte
       ein Hintergrund-Abgleich Betrag und Auswahl weg. */
    var fokus = document.activeElement;
    if (fokus && fokus.closest && fokus.closest('#kasse-karte')) return;
    var kbAlt = $('kasse-betrag'), ktAlt = $('kasse-text');
    if ((kbAlt && kbAlt.value) || (ktAlt && ktAlt.value)) return;
    var d = kasseDaten;
    var saldo = d ? d.saldo : 0;
    $('kasse-karte').innerHTML =
      '<h2>Vereinskasse</h2>' +
      '<div class="kasse-saldo"><span class="hint">Bestand</span>' +
        '<b class="' + (saldo < 0 ? 'minus' : 'plus') + '">' + euro(saldo) + '</b></div>' +
      (online
        ? '<div class="kasse-form">' +
            '<div class="options" id="kasse-art">' +
              '<button data-action="kasse-art" data-value="ein" class="' + (UI.kasseArt === 'aus' ? '' : 'active') + '">Einzahlung</button>' +
              '<button data-action="kasse-art" data-value="aus" class="' + (UI.kasseArt === 'aus' ? 'active' : '') + '">Ausgabe</button>' +
            '</div>' +
            '<div class="zeile">' +
              '<input id="kasse-betrag" type="text" inputmode="decimal" placeholder="Betrag in €">' +
              '<input id="kasse-text" type="text" maxlength="80" placeholder="Wofür?">' +
            '</div>' +
            '<button class="btn primary full" data-action="kasse-buchen">Buchen</button>' +
            '<p class="hint" id="kasse-meldung"></p>' +
          '</div>'
        : '<p class="hint">Zum Buchen bitte anmelden.</p>') +
      ((d && d.eintraege && d.eintraege.length)
        ? d.eintraege.map(function (e) {
            return '<div class="kasse-eintrag">' +
              avatarHTML({ id: 'k' + e.id, name: e.name, avatar: e.avatar, hue: e.hue }, 'sm') +
              '<div class="was"><div class="txt">' + esc(e.text) + '</div>' +
                '<div class="wer">' + esc(e.name) + ' · ' + fmtDate(Date.parse(e.at)) + '</div></div>' +
              '<span class="betrag ' + (e.betrag < 0 ? 'minus' : 'plus') + '">' +
                (e.betrag > 0 ? '+' : '') + euro(e.betrag) + '</span>' +
              (e.meins ? '<button class="weg" data-action="kasse-weg" data-id="' + e.id + '" aria-label="Buchung löschen">✕</button>' : '') +
              '</div>';
          }).join('')
        : '<p class="hint">Noch keine Buchung.</p>');
  }

  function renderLigaTraining() {
    var d = naechsterDienstag();
    var tid = trainingsTerminId(d);
    var online = !!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer());
    var ich = online ? window.DartKonto.nutzer().id : null;
    var antworten = (ligaZusagen && ligaZusagen[tid]) || [];
    var meine = null;
    antworten.forEach(function (a) { if (a.id === ich) meine = a.status || 'dabei'; });
    var dabei = antworten.filter(function (a) { return (a.status || 'dabei') === 'dabei'; });
    var unsicher = antworten.filter(function (a) { return a.status === 'unsicher'; });
    var absagen = antworten.filter(function (a) { return a.status === 'absage'; });

    var knopf = function (status, text) {
      return '<button class="btn ghost' + (meine === status ? ' aktiv' : '') + '" ' +
        'data-action="training-zusage" data-tid="' + tid + '" data-status="' + status + '">' + text + '</button>';
    };
    var reihe = function (a, leise) {
      return '<div class="dd-reihe' + (leise ? ' leise' : '') + '">' +
        avatarHTML({ id: a.id, name: a.name, avatar: a.avatar, hue: a.hue }, 'sm') +
        '<span class="nm">' + esc(a.name) + '</span></div>';
    };

    $('dienstdarts-karte').innerHTML =
      '<div class="sehnsucht-logo" role="img" aria-label="Sehnsucht Divebar Munich"></div>' +
      '<h2>DiensDarts</h2>' +
      '<p class="hint">Dienstags ist Dart-Training in der Bar Sehnsucht. Nächster Termin: <b>' +
        ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ', ' + fmtDate(d.getTime()) + '</b></p>' +
      (online
        ? '<div class="dd-antworten">' +
            knopf('dabei', 'Bin dabei') +
            knopf('unsicher', 'Unsicher') +
            knopf('absage', 'Kann nicht') +
          '</div>'
        : '<p class="hint">Zum Abstimmen bitte anmelden.</p>') +
      '<div class="dd-liste">' +
        '<div class="dd-titel">' + plural(dabei.length, 'Spieler kommt', 'Spieler kommen') + '</div>' +
        (dabei.map(function (a) { return reihe(a); }).join('') || '<p class="hint">Noch keine Zusage.</p>') +
        (unsicher.length ? '<div class="dd-titel">Unsicher</div>' + unsicher.map(function (a) { return reihe(a, true); }).join('') : '') +
        (absagen.length ? '<div class="dd-titel">Abgesagt</div>' + absagen.map(function (a) { return reihe(a, true); }).join('') : '') +
      '</div>';
  }

  function renderLigaTabelle() {
    var online = !!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer());
    $('lt-speichern').classList.toggle('hidden', !online);
    $('lt-stand').textContent = online
      ? ligaTabelleMeldung
      : 'Zum Speichern für alle bitte anmelden – hier lässt sich nur probeweise tippen.';

    /* Waehrend jemand in einer Zelle tippt, wird nichts neu gebaut - auch
       dann nicht, wenn gerade ein anderer Serverstand hereingekommen ist.
       Sonst verschwaende die Eingabe unter den Fingern. */
    var fokus = document.activeElement;
    if (fokus && fokus.closest && fokus.closest('#lt-tabelle')) return;

    /* Nicht bei jedem Zeichnen neu bauen - Neuaufbau nur bei anderem
       Serverstand (sonst blieben Handkorrekturen nicht stehen). */
    var zeilen = (ligaTabelle && Array.isArray(ligaTabelle.zeilen) && ligaTabelle.zeilen.length)
      ? ligaTabelle.zeilen
      : LIGA_TEAMS.map(function (t) { return { team: t, spiele: '', punkte: '', legs: '' }; });
    var kennung = JSON.stringify(zeilen);
    if (ligaTabelleKennung === kennung && $('lt-tabelle').innerHTML) return;
    ligaTabelleKennung = kennung;

    $('lt-tabelle').innerHTML =
      '<thead><tr><th>#</th><th class="left">Team</th><th>Spiele</th><th>Punkte</th><th>Legs</th></tr></thead>' +
      '<tbody>' + zeilen.map(function (z, i) {
        var wir = z.team === LIGA.team;
        return '<tr' + (wir ? ' class="leader"' : '') + '>' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="left name" contenteditable>' + esc(z.team || '') + '</td>' +
          '<td contenteditable>' + esc(String(z.spiele || '')) + '</td>' +
          '<td contenteditable>' + esc(String(z.punkte || '')) + '</td>' +
          '<td contenteditable>' + esc(String(z.legs || '')) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function ligaZusagenLaden() {
    if (!window.DartSync || !window.DartSync.liga) return;
    window.DartSync.liga.zusagen().then(function (z) {
      if (!z) return;
      ligaZusagen = z;
      if (S.screen === 'liga') render();
    });
  }

  var WOCHENTAGE = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
  function ligaDatum(iso) {
    var d = new Date(iso + 'T12:00:00');
    return WOCHENTAGE[d.getDay()] + ' ' + iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
  }

  function renderLiga() {
    $('liga-sub').textContent = 'Spielplan ' + LIGA.team + ' · ' + LIGA.saison;

    /* Zwei Reiter: der Spielplan und die Regelecke (steht fest im HTML). */
    var tab = UI.ligaTab || 'plan';
    $('liga-tabs').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    $('liga-plan').classList.toggle('hidden', tab !== 'plan');
    $('liga-training').classList.toggle('hidden', tab !== 'training');
    $('liga-tabelle').classList.toggle('hidden', tab !== 'tabelle');
    $('liga-kasse').classList.toggle('hidden', tab !== 'kasse');
    $('liga-regeln').classList.toggle('hidden', tab !== 'regeln');
    if (tab === 'training') { renderLigaTraining(); return; }
    if (tab === 'kasse') { renderLigaKasse(); return; }
    if (tab === 'tabelle') { renderLigaTabelle(); return; }
    if (tab !== 'plan') return;

    /* Ohne Server (Einzeldatei) oder ohne Anmeldung bleibt der Spielplan
       lesbar – nur das Eintragen braucht ein Konto. */
    var online = !!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer());
    var hinweis = $('liga-hinweis');
    hinweis.classList.toggle('hidden', online);
    hinweis.textContent = window.DartKonto
      ? 'Zum Eintragen bitte anmelden – ansehen geht auch so.'
      : 'Eintragen geht nur in der Online-Fassung mit Konto.';

    var ich = online ? window.DartKonto.nutzer().id : null;
    var heute = new Date();
    var heuteIso = heute.getFullYear() + '-' +
      String(heute.getMonth() + 1).padStart(2, '0') + '-' +
      String(heute.getDate()).padStart(2, '0');

    $('liga-liste').innerHTML = LIGA.termine.map(function (t) {
      if (!t.tag) {
        return '<div class="card liga-spieltag frei">' +
          '<div class="lt-kopf"><span class="lt-datum muted">' + t.nr + '. Spieltag</span>' +
          '<span class="lt-nr">Spielfrei</span></div></div>';
      }
      var daheim = t.heim === LIGA.team;
      var vorbei = t.tag < heuteIso;
      var leute = ((ligaZusagen && ligaZusagen[t.id]) || []).filter(function (z) {
        return (z.status || 'dabei') === 'dabei';
      });
      var binDabei = ich ? leute.some(function (p) { return p.id === ich; }) : false;
      var fehlt = LIGA.sollSpieler - leute.length;

      var koepfe = leute.map(function (p) {
        return '<span class="lt-person">' + avatarHTML(p, 'sm') + esc(p.name) + '</span>';
      }).join('');

      return '<div class="card liga-spieltag' + (vorbei ? ' vorbei' : '') + '">' +
        '<div class="lt-kopf">' +
          '<span class="lt-datum">' + ligaDatum(t.tag) + '</span>' +
          '<span class="lt-rechts">' +
            '<span class="lt-nr">' + t.nr + '. Spieltag · ' + (daheim ? 'Heim' : 'Auswärts') + '</span>' +
            '<button class="icon-btn rund lt-cal" data-action="liga-ical" data-id="' + t.id + '" ' +
              'title="Diesen Termin in den Kalender" aria-label="Diesen Termin in den Kalender">📅</button>' +
          '</span>' +
        '</div>' +
        '<div class="lt-paarung">' +
          (daheim ? '<b>' + esc(t.heim) + '</b>' : esc(t.heim)) +
          ' <span class="muted">vs</span> ' +
          (daheim ? esc(t.gast) : '<b>' + esc(t.gast) + '</b>') +
        '</div>' +
        '<div class="lt-ort">' + esc(t.ort) + '</div>' +
        (ligaZusagen
          ? '<div class="lt-leute">' + (koepfe || '<span class="muted">Noch niemand eingetragen.</span>') + '</div>'
          : '') +
        (vorbei ? '' :
          '<div class="lt-fuss">' +
            (ligaZusagen
              ? '<span class="lt-status ' + (fehlt > 0 ? 'offen' : 'voll') + '">' +
                (fehlt > 0
                  ? 'Noch ' + plural(fehlt, 'Spieler', 'Spieler') + ' bis wir vollständig sind'
                  : 'Vollständig – ' + plural(leute.length, 'Spieler', 'Spieler') + ' dabei') +
                '</span>'
              : '<span></span>') +
            '<span class="lt-knoepfe">' +
              (online
                ? '<button class="btn ghost small" data-action="liga-zusage" ' +
                  'data-id="' + t.id + '" data-dabei="' + (binDabei ? '0' : '1') + '">' +
                  (binDabei ? 'Bin raus' : 'Ich bin dabei') + '</button>'
                : '') +
              (S.history.some(function (h) { return h.liga && h.liga.terminId === t.id && h.matches; })
                ? '<button class="btn ghost small" data-action="liga-bericht" data-termin="' + t.id + '">Spielbericht</button>'
                : '') +
              '<button class="btn ghost small" data-action="liga-spiel" data-id="' + t.id + '">Ligaspiel starten</button>' +
            '</span>' +
          '</div>') +
        '</div>';
    }).join('');
  }

  /* Alle Termine als iCal-Datei – ganztägige Einträge, die Anwurfzeit steht
     ja nicht im Spielplan. Rein im Browser gebaut, kein Server nötig. */
  function icsText(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }

  function ligaKalender(nurId) {
    var zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blink 180//Dart Turnier//DE', 'CALSCALE:GREGORIAN'];
    var nummer = null;
    LIGA.termine.forEach(function (t) {
      if (!t.tag) return;
      if (nurId && t.id !== nurId) return;
      if (nurId) nummer = t.nr;
      var d = new Date(t.tag + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      var ende = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      zeilen.push(
        'BEGIN:VEVENT',
        'UID:blink180-' + t.id + '@darts.wirtschaftln.de',
        'DTSTAMP:' + t.tag.replace(/-/g, '') + 'T000000Z',
        'DTSTART;VALUE=DATE:' + t.tag.replace(/-/g, ''),
        'DTEND;VALUE=DATE:' + ende,
        'SUMMARY:' + icsText('Darts ' + t.nr + '. Spieltag: ' + t.heim + ' vs ' + t.gast),
        'LOCATION:' + icsText(t.ort),
        'END:VEVENT'
      );
    });
    zeilen.push('END:VCALENDAR');
    var blob = new Blob([zeilen.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nummer ? 'blink180-spieltag-' + nummer + '.ics' : 'blink180-spielplan.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function renderBullOff() {
    var forGame = S.game && !S.game.started;
    var ids = forGame ? S.game.players : (currentMatch() ? currentMatch().p : null);
    if (!ids) { S.screen = 'tournament'; render(); return; }

    /* Bei mehr als zwei Spielern gibt der Bull-Wurf nicht nur den Anfänger
       vor, sondern die ganze Reihenfolge. Links stehen alle Namen, rechts
       wächst die Reihenfolge: einfach in Wurf-Reihenfolge antippen - wer
       am nächsten am Bull war, zuerst. Kein Hoch- und Runterschieben. */
    if (forGame && ids.length > 2) {
      if (!UI.bullReihe || UI.bullReihe.some(function (id) { return ids.indexOf(id) < 0; })) {
        UI.bullReihe = [];
      }
      var reihe = UI.bullReihe;
      var fertig = reihe.length === ids.length;
      $('bulloff-sub').textContent = 'Alle werfen auf Bull \ud83c\udfaf - dann in Wurf-Reihenfolge antippen: Wer am nächsten dran war, zuerst.';
      $('bulloff-buttons').className = 'bulloff-order';
      /* Nichts springt beim Antippen: links bleibt der Platz eines
         Gewaehlten einfach leer (gleiche Groesse, unsichtbar), rechts
         stehen alle Slots von Anfang an, und der Startknopf reserviert
         seinen Platz, bis er gebraucht wird. */
      $('bulloff-buttons').innerHTML =
        '<div class="bo-spalten">' +
          '<div class="bo-wahl">' + ids.map(function (pid) {
            var gewaehlt = reihe.indexOf(pid) >= 0;
            return gewaehlt
              ? '<button class="bo-weg" disabled aria-hidden="true">' +
                avatarHTML(profile(pid), 'sm') +
                '<span class="bo-name">' + esc(pname(pid)) + '</span></button>'
              : '<button data-action="order-pick" data-id="' + pid + '">' +
                avatarHTML(profile(pid), 'sm') +
                '<span class="bo-name">' + esc(pname(pid)) + '</span></button>';
          }).join('') + '</div>' +
          '<div class="bo-reihe">' + ids.map(function (_, i) {
            var pid = reihe[i];
            if (!pid) {
              return '<div class="bo-slot"><span class="bo-pos">' + (i + 1) + '.</span>' +
                '<span class="bo-frei">–</span></div>';
            }
            var nm = esc(pname(pid));
            return '<button class="bo-row" data-action="order-unpick" data-id="' + pid + '" ' +
              'aria-label="' + nm + ' wieder herausnehmen">' +
              '<span class="bo-pos">' + (i + 1) + '.</span>' +
              avatarHTML(profile(pid), 'sm') +
              '<span class="bo-name">' + nm + '</span></button>';
          }).join('') + '</div>' +
        '</div>' +
        '<button class="btn primary full' + (fertig ? '' : ' unsichtbar') + '" ' +
          'data-action="start-order"' + (fertig ? '' : ' disabled') + '>' +
          (fertig ? esc(pname(reihe[0])) + ' beginnt · Los geht\'s' : '·') + '</button>';
      return;
    }

    $('bulloff-sub').textContent = ids.length > 2
      ? 'Wer war am nächsten am Bull? Er beginnt, danach geht es reihum weiter.'
      : 'Wer war näher am Bull und darf anfangen?';
    /* Am Board laeuft auch das Bullen ueber die Tastatur: Pfeile oder Tab
       wechseln, Enter bestaetigt - und die Felder fuellen den Bildschirm. */
    var amBoard = UI.turnier && turnierErlaubt();
    $('screen-bulloff').classList.toggle('turnier', amBoard);
    var bWahl = amBoard ? Math.min(UI.bullWahl || 0, ids.length - 1) : -1;
    $('bulloff-buttons').className = 'bulloff';
    $('bulloff-buttons').innerHTML = ids.map(function (pid, i) {
      return '<button data-action="pick-starter" data-id="' + pid + '"' +
        (i === bWahl ? ' class="wahl"' : '') + '>' +
        avatarHTML(profile(pid), 'md') + '<span>' + esc(ligaName && S.tour && S.tour.liga ? ligaName(pid) : pname(pid)) + '</span></button>';
    }).join('') +
      (amBoard ? '<p class="te-hint">← → / Tab · wählen &nbsp;&nbsp; Enter · der beginnt</p>' : '');
  }

  function renderGame() {
    var m = currentMatch();
    if (!m) { S.screen = 'tournament'; render(); return; }
    var leg = ensureLeg(m);
    if (!leg) { S.screen = 'tournament'; render(); return; }

    var active = m.done && m.winner ? m.winner : activePlayer(leg, m);
    var schnell = m.kind === 'quick';
    /* Ligaspiel ohne Finish-Hilfen: die App sagt das Doppel nicht an
       (WDF 3.08) – keine Wege, keine Markierungen. Der Rest bleibt
       natürlich stehen, den verlangt die Regel sogar (WDF 3.07). */
    var ohneFinish = !schnell && S.tour && S.tour.liga && !S.tour.liga.finish;
    /* Im Ligaspiel laufen die buergerlichen Namen mit - auch am Board. */
    var spielerName = !schnell && S.tour && S.tour.liga ? ligaName : pname;
    if (schnell) {
      $('game-match-label').textContent = 'Schnelles Spiel';
      $('game-leg-label').textContent = plural(m.p.length, 'Spieler', 'Spieler') + ' · ' +
        matchStart(m) + ' Double Out';
    } else {
      var idx = S.matches.indexOf(m);
      $('game-match-label').textContent = 'Spiel ' + (idx + 1) + ' von ' + S.matches.length;
      $('game-leg-label').textContent = tour().bestOf > 1
        ? 'Leg ' + m.legs.length + ' · Stand ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + ' · ' + plural(legsToWin(), 'Leg', 'Legs') + ' zum Sieg'
        : 'Ein Leg · ' + tourStart() + ' Double Out';
    }

    var pendingSum = sum(UI.darts, function (d) { return d.v; });
    $('game-turn').innerHTML = m.done
      ? '<b>' + esc(spielerName(m.winner)) + '</b> hat gewonnen'
      : '<span class="muted">Am Wurf</span> <b>' + esc(spielerName(active)) + '</b>' +
        '<span class="muted"> · Rest ' + (remainingIn(leg, active) - pendingSum) + '</span>';
    /* Vier Karten in Turniergröße füllen ein Handydisplay allein aus und
       drängen den Verlauf hinter das Zahlenfeld – ab drei Spielern werden
       sie deshalb kompakter. */
    $('scoreboard').classList.toggle('viele', m.p.length > 2);
    $('scoreboard').classList.toggle('solo', m.p.length === 1);
    $('screen-game').classList.toggle('solo', m.p.length === 1);
    $('scoreboard').innerHTML = m.p.map(function (pid) {
      var rest = remainingIn(leg, pid) - (pid === active ? pendingSum : 0);
      var darts = dartsIn(leg, pid) + (pid === active ? UI.darts.length : 0);
      var scored = matchStart(m) - remainingIn(leg, pid) + (pid === active ? pendingSum : 0);
      var avg = darts ? (scored / darts * 3).toFixed(1) : '–';
      var zeile, meta, pfinish = '';
      if (UI.turnier && turnierErlaubt()) {
        /* Was geworfen wurde, steht in den Wurflisten unten links und
           rechts – in der Karte bleibt nur der Leg-Stand. */
        zeile = schnell ? '' : 'Legs ' + legsWon(m, pid);
        meta = '<span>Ø <b>' + avg + '</b></span>';
        /* Der Finish-Weg erscheint, sobald einer ansteht – bei jedem Spieler
           im eigenen Kasten, auch während der andere wirft: so kann man sich
           auf seine Aufnahme vorbereiten. Abgedunkelt, kein Signalrot. */
        var fRoute = !ohneFinish && !m.done && rest >= 2
          ? Checkout.suggest(rest, 3, lieblingsDoppel(pid)) : null;
        pfinish = '<div class="pfinish">' + (fRoute ? fRoute.map(function (d) {
          return '<span class="chip">' + Checkout.pretty(d) + '</span>';
        }).join('') : '') + '</div>';
      } else {
        /* Im Schnellen Spiel gibt es keine Legs zu zählen – dort steht die
           geworfene Dartzahl, die sagt in dem Moment mehr. */
        zeile = schnell ? plural(darts, 'Dart', 'Darts') : 'Legs ' + legsWon(m, pid);
        meta = '<span>Ø <b>' + avg + '</b></span><span>Darts <b>' + darts + '</b></span>';
      }
      return '<div class="pcard ' + (pid === active ? 'active' : '') + '">' +
        '<div class="pname">' + avatarHTML(profile(pid), 'sm') + esc(spielerName(pid)) + '</div>' +
        '<div class="legs">' + zeile + '</div>' +
        '<div class="rest">' + rest + '</div>' +
        '<div class="meta">' + meta + '</div>' + pfinish +
        '</div>';
    }).join('');

    var restActive = remainingIn(leg, active) - pendingSum;
    var mode = effectiveMode(restActive);
    /* Der Kamera-Modus zeigt die Einzel-Darts-Ansicht: die vom iPhone
       gemeldeten Darts fuellen dieselben Kacheln, das Tastenfeld bleibt
       als Handbetrieb sichtbar. Nur der Umschalter markiert "Kamera". */
    var anzeige = mode === 'kamera' ? 'darts' : mode;
    var dartsLeft = anzeige === 'darts' ? 3 - UI.darts.length : 3;
    var route = ohneFinish ? null : Checkout.suggest(restActive, dartsLeft, lieblingsDoppel(active));

    /* Die Finish-Leiste erscheint erst, wenn beim Aktiven wirklich ein
       Finish ansteht - vorher ist "noch kein Finish möglich" nur Rauschen
       und stiehlt dem Verlauf die Zeile. */
    $('checkout-bar').classList.toggle('fern', !route && !ohneFinish && !m.done);
    $('checkout-bar').classList.toggle('aus', !!ohneFinish);

    var whose = esc(spielerName(active));
    if (route) {
      $('checkout-bar').innerHTML = '<span class="label">Finish ' + whose + '</span>' + route.map(function (d, i) {
        return '<span class="chip ' + (i === 0 ? 'first' : '') + '">' + Checkout.pretty(d) + '</span>';
      }).join('');
    } else {
      $('checkout-bar').innerHTML = restActive > 170
        ? '<span class="none">' + whose + ': noch kein Finish möglich</span>'
        : '<span class="none">' + whose + ': kein Finish mit ' + plural(dartsLeft, 'Dart', 'Darts') + '</span>';
    }

    /* Einzel-Darts: drei grosse Kacheln wie im Finisher tragen die laufende
       Aufnahme - leer zu Beginn, jeder eingetragene Dart fuellt eine (gruen,
       wenn er den Vorschlag trifft). In Finish-Naehe stehen die restlichen
       Wuerfe rot bzw. als Weg darin; die Leiste darueber entfaellt dann. */
    var kBox = $('game-kacheln');
    if (anzeige === 'darts' && !m.done) {
      var kacheln = ['', '', ''];
      var kDbl = ohneFinish ? null : lieblingsDoppel(active);
      var kRest = remainingIn(leg, active);
      UI.darts.forEach(function (d, ki) {
        var soll = null;
        if (!ohneFinish) {
          var kEmpf = Checkout.suggest(kRest, 3 - ki, kDbl);
          /* suggest liefert Labels ('T20') - fuer den Vergleich in
             Mult/Zahl zerlegen, wie es auch der Finisher macht. */
          if (kEmpf && kEmpf.length) soll = labelDart(kEmpf[0]);
        }
        var traf = soll && d.n === soll.n && d.m === soll.m;
        kacheln[ki] = '<span class="fk ' + (traf ? 'gut' : 'anders') + '">' +
          (d.n === 0 ? '–' : dartLabel(d)) + '</span>';
        kRest -= d.v;
      });
      if (route) {
        for (var kr = 0; kr < route.length && UI.darts.length + kr < 3; kr++) {
          kacheln[UI.darts.length + kr] = '<span class="fk' + (kr === 0 ? ' jetzt' : '') + '">' +
            Checkout.pretty(route[kr]) + '</span>';
        }
      }
      for (var kx = 0; kx < 3; kx++) if (!kacheln[kx]) kacheln[kx] = '<span class="fk leer">–</span>';
      kBox.innerHTML = kacheln.join('');
      kBox.classList.remove('hidden');
      /* Die Kacheln tragen den Weg selbst - die Leiste waere doppelt. */
      $('checkout-bar').classList.add('fern');
    } else {
      kBox.classList.add('hidden');
    }

    /*
     * Ab drei Spielern (Schnelles Spiel) wird der Verlauf zu einer einzigen
     * Liste, neueste Aufnahme oben, mit dem Namen davor. Vier schmale
     * Spalten nebeneinander wären nur noch Zahlenkolonnen, denen man nicht
     * ansieht, wer sie geworfen hat.
     */
    var vieleSpieler = m.p.length > 2;
    $('history').classList.toggle('einspaltig', vieleSpieler || m.p.length === 1);
    if (vieleSpieler) {
      var lauf = {};
      m.p.forEach(function (pid) { lauf[pid] = legStart(leg); });
      var zeilen = [];
      leg.visits.forEach(function (v, vi) {
        var vorher = lauf[v.p];
        if (!v.b) lauf[v.p] -= v.s;
        zeilen.push({ v: v, before: vorher, rest: lauf[v.p], idx: vi });
      });
      $('history').innerHTML = '<div class="col">' + zeilen.reverse().map(function (e) {
        var v = e.v;
        var grund = '';
        if (v.b) {
          var danach = e.before - v.o;
          grund = danach < 0 ? ' · überworfen' : danach === 1 ? ' · Rest 1' : danach === 0 ? ' · kein Doppel' : '';
        }
        var aenderbar = !v.c && !m.done;
        return '<div class="v ' + (v.b ? 'bust' : v.c ? 'co' : '') + (aenderbar ? ' tap' : '') + '"' +
          (aenderbar ? ' data-action="edit-visit" data-i="' + e.idx + '" role="button" tabindex="0"' : '') + '>' +
          '<span class="wer">' + esc(pname(v.p)) + '</span>' +
          '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
          '<span class="r">' + (v.b ? 'Bust' + grund : 'Rest ' + e.rest) + '</span></div>';
      }).join('') + '</div>';
    } else {

      /* Kompletter Match-Verlauf, neueste Aufnahme oben, mit Leg-Trennern.
         Korrigieren lässt sich nur das laufende Leg – abgeschlossene Legs
         stehen als Beleg da und würden sonst ihr Finish verlieren. */
      $('history').innerHTML = m.p.map(function (pid) {
        var rows = [];
        for (var li = m.legs.length - 1; li >= 0; li--) {
          var lg = m.legs[li];
          var isActiveLeg = lg === leg;
          var restRun = legStart(leg);
          var entries = [];
          lg.visits.forEach(function (v, vi) {
            if (v.p !== pid) return;
            var before = restRun;
            if (!v.b) restRun -= v.s;
            entries.push({ v: v, before: before, rest: restRun, idx: vi });
          });
          if (!entries.length && !isActiveLeg) continue;
          if (m.legs.length > 1) {
            rows.push('<div class="leg-sep">Leg ' + (li + 1) +
              (lg.winner ? (lg.winner === pid ? ' · gewonnen' : ' · verloren') : ' · läuft') + '</div>');
          }
          entries.reverse().forEach(function (e) {
            var v = e.v;
            var why = '';
            if (v.b) {
              var after = e.before - v.o;
              why = after < 0 ? ' · überworfen' : after === 1 ? ' · Rest 1' : after === 0 ? ' · kein Doppel' : '';
            }
            var editable = isActiveLeg && !v.c && !m.done;
            rows.push('<div class="v ' + (v.b ? 'bust' : v.c ? 'co' : '') + (editable ? ' tap' : '') + '"' +
              (editable ? ' data-action="edit-visit" data-i="' + e.idx + '" role="button" tabindex="0"' : '') + '>' +
              '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
              '<span class="r">' + (v.b ? 'Bust' + why : 'Rest ' + e.rest) + '</span></div>');
          });
        }
        return '<div class="col">' + rows.join('') + '</div>';
      }).join('');
    }

    $('visit-darts').classList.toggle('hidden', anzeige !== 'darts');
    $('visit-darts').innerHTML = [0, 1, 2].map(function (i) {
      var d = UI.darts[i];
      return '<div class="d ' + (d ? '' : 'empty') + '">' + (d ? dartLabel(d) : '–') + '</div>';
    }).join('');

    UI.letzterModus = mode;
    $('mode-toggle').querySelectorAll('button').forEach(function (b) {
      var bm = b.getAttribute('data-mode');
      b.classList.toggle('active', bm === mode);
      if (bm === 'turnier') b.classList.toggle('hidden', !turnierErlaubt());
      /* Kamera gibt es nur, wenn die optionale Schicht (js/kamera.js) da ist. */
      if (bm === 'kamera') b.classList.toggle('hidden', !window.DartKamera);
    });
    $('pad-total').classList.toggle('hidden', anzeige !== 'total');
    $('pad-darts').classList.toggle('hidden', anzeige !== 'darts');
    $('pad-key').classList.toggle('hidden', anzeige !== 'turnier');
    /* Der Turnier-Modus stellt den ganzen Bildschirm um: Reste in
       Plakatgröße, kein Verlauf – das regelt das CSS über diese Klasse.
       Beim Verlassen klappt auch eine offene Wurflisten-Ansicht zu. */
    $('screen-game').classList.toggle('turnier', mode === 'turnier');
    if (mode !== 'turnier') $('screen-game').classList.remove('verlauf');

    if (anzeige === 'turnier') {
      /* Links und rechts der Eingabe stehen die Aufnahmen des laufenden Legs
         je Spieler auf seiner Seite, neueste oben – die letzte auch noch mal
         direkt in der Spielerkarte. */
      var histSpalte = function (pid) {
        if (!pid) return '';
        var restLauf = legStart(leg);
        var zeilen = [];
        leg.visits.forEach(function (v) {
          if (v.p !== pid) return;
          if (!v.b) restLauf -= v.s;
          zeilen.push('<div class="v ' + (v.b ? 'bust' : v.c ? 'co' : '') + '">' +
            '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
            '<span class="r">' + (v.b ? 'Bust' : 'Rest ' + restLauf) + '</span></div>');
        });
        // Die letzten fünf Aufnahmen, neueste oben – mehr passt nicht ins
        // Bild, und die Seite soll am Board nie scrollen.
        return zeilen.slice(-5).reverse().join('');
      };
      $('key-hist-l').innerHTML = histSpalte(m.p[0]);
      $('key-hist-r').innerHTML = histSpalte(m.p[1]);
      $('key-error').textContent = UI.error;
      /* Kein Platzhaltertext – leer steht nur der blaue Eingabestrich,
         und sobald Ziffern da sind, stehen nur die Ziffern. */
      $('key-display').innerHTML = UI.input === ''
        ? '<span class="cursor"></span>' : esc(UI.input);
    } else if (anzeige === 'total') {
      $('quick-row').innerHTML = '<button class="miss" data-quick="0">0 Pkt</button>' +
        QUICK_SCORES.map(function (q) { return '<button data-quick="' + q + '">' + q + '</button>'; }).join('');
      var disp = $('score-display');
      disp.textContent = UI.input === '' ? '0' : UI.input;
      disp.classList.toggle('empty', UI.input === '');
      $('input-error').textContent = UI.error;
    } else {
      $('mult-row').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', Number(b.getAttribute('data-mult')) === UI.mult);
      });
      /* Nur markieren, wenn der eingestellte Multiplikator auch zum
         vorgeschlagenen Feld passt – sonst zeigt die Markierung auf D20,
         obwohl T20 gemeint ist. */
      var hl = route ? route[0] : null;
      var hlMult = hl ? (hl.charAt(0) === 'T' ? 3 : hl.charAt(0) === 'D' || hl === 'BULL' ? 2 : 1) : 0;
      var hlNum = hl && hl !== 'BULL' && hl !== '25' && UI.mult === hlMult ? parseInt(hl.slice(1), 10) : null;
      /* Die Feldzahl bleibt immer stehen (18 bleibt 18), davor nur ein
         kleines D/T – sonst ist im Finish nicht auf einen Blick klar,
         welches Feld man gerade trifft. */
      var prefix = UI.mult === 3 ? 'T' : UI.mult === 2 ? 'D' : '';
      var nums = '';
      for (var n = 1; n <= 20; n++) {
        nums += '<button data-num="' + n + '" class="' + (n === hlNum ? 'hl' : '') + '">' +
          (prefix ? '<span class="mx">' + prefix + '</span>' : '') + n + '</button>';
      }
      nums += '<button class="miss" data-num="0">Miss</button>';
      nums += '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25">Bull</button>';
      nums += '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-bull="1">Bull ×2</button>';
      /* Dreimal am Doppel vorbei muss nicht dreimal getippt werden: dieser
         Knopf schließt die Aufnahme ab und füllt die fehlenden Darts als
         Fehlwürfe auf. */
      nums += '<button class="end-visit wide" data-action="end-visit">Weiter ▸</button>';
      $('num-grid').innerHTML = nums;
    }
  }

  function dartLabel(d) {
    if (d.n === 0) return '0';
    if (d.n === 25) return d.m === 2 ? 'Bull' : '25';
    return (d.m === 3 ? 'T' : d.m === 2 ? 'D' : '') + d.n;
  }

  function effectiveMode(rest) {
    if (UI.turnier && turnierErlaubt()) return 'turnier';
    if (UI.kamera && window.DartKamera) return 'kamera';
    if (UI.modeOverride) return UI.modeOverride;
    var t = S.settings.dartModeFrom;
    return (t > 0 && rest <= t) ? 'darts' : 'total';
  }

  function renderCricket() {
    var g = S.game;
    if (!g || g.kind !== 'cricket') { S.screen = 'setup'; render(); return; }
    var st = cricketState(g);
    var active = g.done ? g.winner : gameTurnPlayer(g);
    var visit = gameVisitDarts(g);

    $('cricket-sub').textContent = (g.scoring ? 'mit Punkten' : 'ohne Punkte') + ' · ' + g.players.length + ' Spieler';

    var head = '<div class="cr-cell cr-corner"></div>' + g.players.map(function (id) {
      var mpr = st.darts[id] ? (st.allMarks[id] / st.darts[id]) * 3 : 0;
      return '<div class="cr-cell cr-head ' + (id === active ? 'act' : '') + '">' +
        avatarHTML(profile(id), 'sm') + '<span>' + esc(pname(id)) + '</span>' +
        '<span class="cr-mpr">MPR ' + (st.darts[id] ? mpr.toFixed(2) : '–') + '</span></div>';
    }).join('');

    var rows = CRICKET_NUMBERS.map(function (n) {
      var allClosed = g.players.every(function (id) { return st.marks[id][n] >= 3; });
      return '<div class="cr-cell cr-num ' + (allClosed ? 'dead' : '') + '">' + cricketLabel(n) + '</div>' +
        g.players.map(function (id) {
          var m = st.marks[id][n];
          return '<div class="cr-cell cr-mark ' + (allClosed ? 'dead ' : '') +
            (id === active ? 'act' : '') + ' m' + m + '">' +
            (m === 0 ? '' : m === 1 ? '/' : m === 2 ? '✕' : '⊗') + '</div>';
        }).join('');
    }).join('');

    var zu = function (id) {
      return CRICKET_NUMBERS.filter(function (n) { return st.marks[id][n] >= 3; }).length;
    };
    var lead = g.players.slice().sort(function (a, b) {
      return g.scoring ? (st.score[b] - st.score[a]) || (zu(b) - zu(a)) : (zu(b) - zu(a));
    })[0];
    /* „Vorn" heisst nur etwas, wenn ueberhaupt schon etwas passiert ist –
       am Anfang stehen alle auf null, und dann waere der Erste in der Liste
       willkuerlich der Anfuehrer. Und allein fuehrt man nicht. */
    var fuehrt = g.players.length > 1 && (g.scoring ? st.score[lead] > 0 : zu(lead) > 0)
      ? lead : null;

    var foot = '<div class="cr-cell cr-num">' + (g.scoring ? 'Pkt' : 'Zu') + '</div>' +
      g.players.map(function (id) {
        var val = g.scoring ? st.score[id] : zu(id) + '/7';
        return '<div class="cr-cell cr-score ' + (id === active ? 'act ' : '') +
          (id === fuehrt ? 'fuehrt' : '') + '">' + val + '</div>';
      }).join('');

    $('cricket-board').innerHTML =
      '<div class="cr-grid" style="grid-template-columns:44px repeat(' + g.players.length + ',minmax(52px,1fr))">' +
      head + rows + foot + '</div>';
    $('cricket-legend').innerHTML =
      '<span>/ = 1 · ✕ = 2 · ⊗ = zu</span>' +
      '<span>Grau = bei allen zu, bringt keine Punkte mehr</span>' +
      (g.players.length > 1 ? '<span>Vorn: <b>' + esc(pname(lead)) + '</b></span>' : '');

    $('cricket-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> gewinnt'
      : '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b>';

    /* Nach einer vollen Aufnahme zeigen die Chips noch die Darts des
       Vorgängers (zum Nachprüfen – einen Verlauf gibt es hier nicht).
       Damit sie neben „Am Wurf <Nächster>" nicht wie dessen Würfe aussehen,
       stehen sie gedimmt hinter einem „zuletzt". */
    var crVorher = !g.done && g.throws.length > 0 && g.throws.length % 3 === 0;
    $('cricket-darts').innerHTML = (crVorher ? '<div class="d-vorher">zuletzt</div>' : '') +
      [0, 1, 2].map(function (i) {
        var d = visit[i];
        return '<div class="d ' + (d ? (crVorher ? 'alt' : '') : 'empty') + '">' + (d ? throwLabel(d) : '–') + '</div>';
      }).join('');

    /* Alle Felder auf einen Blick: je ein Block für Single, Double und
       Triple – ein Tipp je Dart, kein Umschalten. */
    var CN = [20, 19, 18, 17, 16, 15];
    var dead = {};
    /* Auch der Bull: er stand bisher nicht in dieser Liste und blieb im
       Eingabefeld hell, obwohl er bei allen zu war und nichts mehr bringt. */
    CRICKET_NUMBERS.forEach(function (n) {
      dead[n] = g.players.every(function (id) { return st.marks[id][n] >= 3; });
    });
    function block(label, mult) {
      return '<div class="cg-block">' +
        '<div class="cg-label">' + label + '</div>' +
        CN.map(function (n) {
          return '<button data-num="' + n + '" data-mult="' + mult + '" class="' + (dead[n] ? 'dim' : '') + '">' +
            (mult > 1 ? '<span class="mx">' + (mult === 3 ? 'T' : 'D') + '</span>' : '') + n + '</button>';
        }).join('') + '</div>';
    }
    $('cricket-grid').innerHTML =
      block('Single', 1) + block('Double', 2) + block('Triple', 3) +
      '<div class="cg-block cg-extra">' +
        '<div class="cg-label">Bull &amp; Rest</div>' +
        '<button class="bull' + (dead[25] ? ' dim' : '') + '" data-num="25" data-mult="1">Bull</button>' +
        '<button class="bull' + (dead[25] ? ' dim' : '') + '" data-num="25" data-mult="2">Bull ×2</button>' +
        '<button class="miss" data-num="0" data-mult="1">Miss</button>' +
        /* Nichts getroffen? Ein Tipp beendet die Aufnahme und füllt die
           fehlenden Darts als Fehlwürfe auf. */
        '<button class="skip" data-action="end-cricket-visit">' +
          (g.throws.length % 3 ? 'Weiter ▸' : 'Nichts ▸') + '</button>' +
      '</div>';
  }

  function renderRtw() {
    var g = S.game;
    if (!g || g.kind !== 'rtw') { S.screen = 'setup'; render(); return; }
    var st = rtwState(g);
    var active = g.done ? g.winner : gameTurnPlayer(g);
    var visit = gameVisitDarts(g);

    $('rtw-sub').textContent = g.boost
      ? 'Boost · Doppel überspringt 1 · Triple überspringt 2'
      : 'Einfach · jeder Treffer rückt ein Feld weiter';

    $('rtw-board').innerHTML = g.players.map(function (id) {
      var t = st.target[id];
      var fin = st.finished[id];
      /* 21 Stationen: die 20 Zahlen und der Bull. */
      var doneSteps = fin ? 21 : (t === 25 ? 20 : t - 1);
      return '<div class="rtw-row ' + (id === active ? 'act' : '') + (fin ? ' fin' : '') + '">' +
        avatarHTML(profile(id), 'md') +
        '<div class="rw-main">' +
          '<div class="rw-name">' + esc(pname(id)) + '</div>' +
          /* Die Klinge glüht an ihrer Spitze – bei null Stationen gibt es
             keine Spitze, sonst säße der Lichtpunkt am linken Rand. */
          '<div class="rw-bar"><span class="klinge' + (doneSteps ? '' : ' aus') +
            '" style="width:' + (doneSteps / 21 * 100) + '%"></span></div>' +
          '<div class="rw-sub">' + plural(st.darts[id], 'Dart', 'Darts') + ' · ' + plural(st.hits[id], 'Treffer', 'Treffer') + '</div>' +
        '</div>' +
        '<div class="rw-target">' + (fin ? '✓' : t === 25 ? 'Bull' : t) + '</div>' +
        '</div>';
    }).join('');

    $('rtw-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> gewinnt'
      : st.stechen
        ? '<b>Stechen</b> <span class="muted">– der Bull entscheidet</span>'
        : (st.closing ? '<span class="muted">Runde wird zu Ende gespielt · </span>' : '') +
          '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b> <span class="muted">auf</span> <b>' +
          (st.target[active] === 25 ? 'Bull' : st.target[active]) + '</b>';

    // Wie im Cricket: die fertige Aufnahme des Vorgängers gedimmt kennzeichnen.
    var rwVorher = !g.done && st.inVisit === 0 && g.throws.length > 0;
    $('rtw-darts').innerHTML = (rwVorher ? '<div class="d-vorher">zuletzt</div>' : '') +
      [0, 1, 2].map(function (i) {
        var d = visit[i];
        return '<div class="d ' + (d ? (rwVorher ? 'alt' : '') : 'empty') + '">' + (d ? throwLabel(d) : '–') + '</div>';
      }).join('');

    /*
     * Es wird immer nur auf die eigene Zahl geworfen. Die drei Treffer, die
     * es dafür gibt, stehen deshalb nebeneinander in einer Reihe: die Zahl
     * breit und groß, Doppel und Triple daneben als gleichwertige Tasten.
     * Untereinander wäre die Zahl ein Plakat und D/T zwei Fußnoten – dabei
     * ist es dieselbe Frage, nur mit drei Antworten.
     *
     * Darunter Miss und „Weiter", das die restlichen Darts der Aufnahme als
     * Fehlwürfe verbucht: getroffen wird meist höchstens einmal, dreimal
     * Miss zu tippen wäre sonst die häufigste Eingabe des Spiels.
     */
    var target = st.target[active];
    var weiter = '<button class="rtw-key skip" data-action="end-rtw-visit">' +
      '<span class="k">' + (st.inVisit ? 'Weiter ▸' : 'Nichts ▸') + '</span>' +
      '<span class="sub">' + plural(3 - st.inVisit, 'Dart', 'Darts') + ' daneben</span></button>';
    var miss = '<button class="rtw-key miss" data-num="0" data-mult="1">' +
      '<span class="k">Miss</span><span class="sub">ein Dart daneben</span></button>';

    var treffer;
    if (target === 25) {
      treffer = '<div class="rtw-treffer nur-bull">' +
        '<button class="rtw-key gross bull" data-num="25" data-mult="1">' +
          '<span class="z">Bull</span><span class="sub">Spiel gewonnen</span></button>' +
        '</div>';
    } else if (!g.boost) {
      /* Einfach: es gibt nur eine Antwort – getroffen oder nicht. Dann
         braucht die Zahl auch keine Nachbarn und nimmt die Breite allein. */
      treffer = '<div class="rtw-treffer nur-zahl">' +
        '<button class="rtw-key gross" data-num="' + target + '" data-mult="1">' +
          '<span class="z">' + target + '</span>' +
          '<span class="sub">' + (target === 20 ? 'dann Bull' : 'dann ' + (target + 1)) + '</span></button>' +
        '</div>';
    } else {
      var jump = function (mult) {
        var next = target + mult;
        return next > 20 ? 'dann Bull' : 'dann ' + next;
      };
      treffer = '<div class="rtw-treffer">' +
        '<button class="rtw-key gross" data-num="' + target + '" data-mult="1">' +
          '<span class="z">' + target + '</span><span class="sub">' + jump(1) + '</span></button>' +
        '<button class="rtw-key mult" data-num="' + target + '" data-mult="2">' +
          '<span class="k">D' + target + '</span><span class="sub">' + jump(2) + '</span></button>' +
        '<button class="rtw-key mult" data-num="' + target + '" data-mult="3">' +
          '<span class="k">T' + target + '</span><span class="sub">' + jump(3) + '</span></button>' +
        '</div>';
    }

    /*
     * Gleich viele Darts – jetzt wirft jeder der Gleichauf einen Dart auf
     * den Bull, und wer am nächsten dran war, wird angetippt. Wie beim
     * Finisher wird das Ergebnis eingetragen, nicht gerechnet: die App sieht
     * das Board nicht.
     */
    if (st.stechen) {
      $('rtw-pad').innerHTML = '<div class="card rtw-stechen"><h2>Nearest to the Bull</h2>' +
        '<p class="hint">' + st.stechen.map(function (id) { return esc(pname(id)); }).join(' und ') +
        ' sind mit <b>' + plural(st.finished[st.stechen[0]].darts, 'Dart', 'Darts') +
        '</b> gleichauf. Jeder wirft einen Dart auf den Bull – wer am nächsten dran ist, gewinnt.</p>' +
        st.stechen.map(function (id) {
          return '<button class="btn full" data-action="rtw-stechen" data-id="' + id + '">' +
            esc(pname(id)) + ' war näher</button>';
        }).join('') + '</div>';
      return;
    }

    $('rtw-pad').innerHTML = rtwFortschritt(st, active) +
      '<div class="rtw-pad-grid ziel">' + treffer +
      '<div class="rtw-reihe">' + miss + weiter + '</div>' +
      '</div>';
  }

  /* Wie weit ist der, der gerade wirft? Die Reihe zeigt alle 21 Stationen –
     die 20 Zahlen und den Bull – und markiert die erledigten. */
  function rtwFortschritt(st, pid) {
    var ziel = st.target[pid];
    var fertig = st.finished[pid] ? 21 : (ziel === 25 ? 20 : ziel - 1);
    var punkte = '';
    for (var i = 0; i < 21; i++) {
      punkte += '<span class="' + (i < fertig ? 'ok' : i === fertig ? 'jetzt' : '') +
        (i === 20 ? ' bull' : '') + '"></span>';
    }
    return '<div class="rtw-fortschritt">' +
      '<div class="pfad">' + punkte + '</div>' +
      '<div class="txt" id="rtw-fortschritt-txt">Station ' + Math.min(fertig + 1, 21) + ' von 21 · ' +
        plural(st.darts[pid], 'Dart', 'Darts') + ' geworfen</div>' +
      '</div>';
  }

  function throwLabel(t) {
    if (!t.n) return '0';
    if (t.n === 25) return t.m === 2 ? 'Bull×2' : 'Bull';
    return (t.m === 3 ? 'T' : t.m === 2 ? 'D' : '') + t.n;
  }

  /* ================= Spielstatistik nach dem Spiel ================= */
  /* Findet ein Spiel im laufenden Turnier oder im Archiv wieder. */
  function findGame(kind, id) {
    if (kind === '501') {
      for (var i = 0; i < S.matches.length; i++) {
        if (S.matches[i].id === id) return { m: S.matches[i], start: tourStart(), live: true };
      }
      for (var h = 0; h < S.history.length; h++) {
        var e = S.history[h];
        if ((e.kind || '501') !== '501') continue;
        for (var j = 0; j < e.matches.length; j++) {
          if (e.matches[j].id === id) return { m: e.matches[j], start: (e.settings && e.settings.start) || 501, live: false };
        }
      }
      return null;
    }
    if (S.game && S.game.done && (id === 'current' || id === S.game.id)) return { g: S.game, live: true };
    for (var k = 0; k < S.history.length; k++) {
      if (S.history[k].id === id) return { g: S.history[k], live: false };
    }
    return null;
  }

  function statRow(label, value, hint) {
    return '<div class="pline"><span>' + label + (hint ? ' <i>' + hint + '</i>' : '') + '</span><b>' + value + '</b></div>';
  }

  /* Die Aufnahmen einer Runde, fürs Protokoll nachgespielt – dieselbe
     Reihum-Logik wie in finisherState(), nur dass hier jede abgeschlossene
     Aufnahme als Zeile herausfällt (wer, wie viel, Rest danach). */
  function finisherAufnahmen(g, rd) {
    var n = g.players.length;
    var rest = {}, fertig = {}, turn = 0, inVisit = 0, restVor = rd.zahl, geworfen = 0;
    g.players.forEach(function (id) { rest[id] = rd.zahl; });
    var visits = [];
    for (var i = 0; i < rd.throws.length; i++) {
      var t = rd.throws[i];
      var pid = g.players[turn];
      if (inVisit === 0) { restVor = rest[pid]; geworfen = 0; }
      geworfen += t.n * t.m;
      inVisit++;
      var nach = rest[pid] - t.n * t.m;
      var co = false, bust = false;
      if (nach === 0 && t.m === 2) { rest[pid] = 0; co = true; }
      else if (nach < 0 || nach === 1 || nach === 0) bust = true;
      else rest[pid] = nach;
      if (co) fertig[pid] = 1;
      if (bust) rest[pid] = restVor;
      if (co || bust || inVisit === 3) {
        visits.push({ p: pid, s: geworfen, b: bust, c: co, rest: rest[pid] });
        inVisit = 0;
        var steps = 0, next = turn;
        do {
          next = (next + 1) % n;
          steps++;
        } while (fertig[g.players[next]] && steps <= n);
        turn = next;
      }
    }
    return visits;
  }

  /* Ein Routen-Label des Solvers ('T20', 'BULL', 'S7') in Multiplikator und
     Feld zerlegen, um es mit einem geworfenen Dart zu vergleichen. */
  function labelDart(label) {
    if (label === 'BULL') return { m: 2, n: 25 };
    if (label === '25') return { m: 1, n: 25 };
    var m = label.charAt(0) === 'T' ? 3 : label.charAt(0) === 'D' ? 2 : 1;
    return { m: m, n: parseInt(label.slice(1), 10) };
  }

  /* Kein Finish mehr mit den restlichen Darts: welcher eine Wurf stellt am
     besten? Bevorzugt aufs Lieblingsdoppel, sonst D16, D20, … – und nur
     Würfe, die man absichtlich wirft: Singles zuerst, dann hohe Triple. */
  function finisherStellwurf(rest, dbl) {
    var ziele = [];
    if (dbl) ziele.push(2 * dbl);
    [32, 40, 24, 20, 16, 36, 12, 8, 4, 2].forEach(function (z) {
      if (ziele.indexOf(z) < 0) ziele.push(z);
    });
    var wuerfe = [];
    for (var n = 20; n >= 1; n--) wuerfe.push({ v: n, label: String(n) });
    for (var t = 20; t >= 15; t--) wuerfe.push({ v: 3 * t, label: 'T' + t });
    for (var zi = 0; zi < ziele.length; zi++) {
      for (var wi = 0; wi < wuerfe.length; wi++) {
        if (rest - wuerfe[wi].v === ziele[zi]) return wuerfe[wi].label;
      }
    }
    return null;
  }

  function renderFinisher() {
    var g = S.game;
    if (!g || g.kind !== 'finisher') { S.screen = 'setup'; render(); return; }
    var st = finisherState(g);
    var rd = finisherRunde(g);
    var aktiv = g.players[st.turn];

    /* Oben im Kopf steht die Zufalls-Finish-Zahl – genau da, wo das Schnelle
       Spiel seine Startpunktzahl zeigt. Der Rundenstand wandert nach unten
       neben die Eingabe. */
    $('fin-sub').textContent = plural(g.players.length, 'Spieler', 'Spieler') + ' · ' + st.zahl + ' Double Out';
    $('fin-runde').textContent = 'Runde ' + (st.runde + 1) + ' · auf ' + g.ziel + ' Punkte';

    $('fin-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> hat gewonnen'
      : rd.stechen
        ? '<b>Stechen</b><span class="muted"> – der Bull entscheidet</span>'
        : '<span class="muted">Am Wurf</span> <b>' + esc(pname(aktiv)) + '</b>' +
          '<span class="muted"> · Rest ' + st.rest[aktiv] + '</span>';

    /* Dieselben Spielerkarten wie im X01: großer Rest, darunter Darts und
       Aufnahmen. Wer durch ist, trägt den Haken statt einer Zahl. */
    $('fin-board').innerHTML = '<div class="scoreboard' + (g.players.length > 2 ? ' viele' : '') + '">' +
      g.players.map(function (id) {
        var fertig = st.fertig[id];
        var klassen = ['pcard'];
        if (fertig) klassen.push('fertig');
        else if (id === aktiv && !rd.stechen && !g.done) klassen.push('active');
        /* Je Zielpunkt eine Pille - jedes Finish zuendet eine im blauen
           Laserlicht. Leuchten alle, ist das Spiel gewonnen. */
        var pillen = '';
        for (var fp = 0; fp < g.ziel; fp++) {
          pillen += '<span class="fin-pille' + (fp < (st.punkte[id] || 0) ? ' an' : '') + '"></span>';
        }
        return '<div class="' + klassen.join(' ') + '">' +
          '<div class="pname">' + avatarHTML(profile(id), 'sm') + esc(pname(id)) + '</div>' +
          '<div class="fin-pillen" role="img" aria-label="' + (st.punkte[id] || 0) + ' von ' + g.ziel + ' Finishes">' + pillen + '</div>' +
          '<div class="rest">' + (fertig ? '✓' : st.rest[id]) + '</div>' +
          '<div class="meta"><span>Darts <b>' + st.darts[id] + '</b></span>' +
            '<span>Aufnahmen <b>' + st.aufnahmen[id] + '</b></span></div>' +
          '</div>';
      }).join('') + '</div>' +
      /* Stechen: gleichgezogen, jetzt entscheidet der Bull. Wie beim Anwurf
         wird von Hand getippt, wer näher dran war – messen kann die App das
         nicht, und am Board sieht man es sofort. */
      (rd.stechen
        ? '<div class="card fin-stechen"><h2>Stechen auf Bull</h2>' +
          '<p class="hint">' + rd.stechen.spieler.map(function (id) { return esc(pname(id)); }).join(' und ') +
          ' haben beide gefinished. Einmal auf Bull werfen – wer war näher dran?</p>' +
          rd.stechen.spieler.map(function (id) {
            return '<button class="btn full" data-action="fin-stechen" data-id="' + id + '">' +
              esc(pname(id)) + '</button>';
          }).join('') + '</div>'
        : '');

    /* Unten immer drei Kacheln – eine je Dart der Aufnahme, ohne Etikett
       (wer dran ist, leuchtet ja). Geworfen und getroffen wie vorgegeben →
       grün; daneben geworfen → die geworfene Zahl; der nächste Wurf → rot;
       geht kein Finish mehr, steht grau der Stellwurf; der Rest ist „–". */
    var kacheln = ['', '', ''];
    if (!g.done && !rd.stechen && !st.fertig[aktiv]) {
      var dbl = lieblingsDoppel(aktiv);
      var restLauf = st.restVorVisit;
      for (var ki = 0; ki < st.inVisit; ki++) {
        var wurf = st.visit[ki];
        var empf = Checkout.suggest(restLauf, 3 - ki, dbl);
        var soll = empf && empf.length ? labelDart(empf[0]) : null;
        var getroffen = soll && wurf.n === soll.n && wurf.m === soll.m;
        kacheln[ki] = '<span class="fk ' + (getroffen ? 'gut' : 'anders') + '">' +
          (wurf.n === 0 ? '–' : dartLabel(wurf)) + '</span>';
        restLauf -= wurf.n * wurf.m;
      }
      var route = Checkout.suggest(st.rest[aktiv], 3 - st.inVisit, dbl);
      if (route) {
        for (var ri = 0; ri < route.length && st.inVisit + ri < 3; ri++) {
          kacheln[st.inVisit + ri] = '<span class="fk' + (ri === 0 ? ' jetzt' : '') + '">' +
            Checkout.pretty(route[ri]) + '</span>';
        }
      } else if (st.inVisit < 3) {
        var stell = finisherStellwurf(st.rest[aktiv], dbl);
        if (stell) kacheln[st.inVisit] = '<span class="fk stellen">' + stell + '</span>';
      }
    }
    for (var kl = 0; kl < 3; kl++) if (!kacheln[kl]) kacheln[kl] = '<span class="fk leer">–</span>';
    $('fin-hint').innerHTML = kacheln.join('');
    /* Beim Stechen sagt schon die gelbe Karte, worum es geht. */
    $('fin-hint').classList.toggle('hidden', !!rd.stechen);

    /* Kein langer Verlauf - die letzte Eingabe reicht: die Pillen in den
       Karten erzaehlen den Stand, mehr braucht der Abend nicht. */
    var letzte = null;
    for (var ri = g.rounds.length - 1; ri >= 0 && !letzte; ri--) {
      var eintraege = finisherAufnahmen(g, g.rounds[ri]);
      if (eintraege.length) letzte = eintraege[eintraege.length - 1];
    }
    $('fin-history').innerHTML = letzte
      ? '<div class="col"><div class="v ' + (letzte.b ? 'bust' : letzte.c ? 'co' : '') + '">' +
        '<span class="wer">' + esc(pname(letzte.p)) + '</span>' +
        '<span class="s">' + letzte.s + '</span>' +
        '<span class="r">' + (letzte.b ? 'Bust' : letzte.c ? 'Finish' : 'Rest ' + letzte.rest) + '</span></div></div>'
      : '';


    // Zahlenfeld: derselbe Aufbau wie im Finish-Bereich des X01.
    if (rd.stechen) {
      $('fin-pad').innerHTML = '<p class="hint center">Erst das Stechen entscheiden.</p>';
    } else {
      /* Das vorgeschlagene Feld wird im Zahlenfeld markiert – aber nur, wenn
         die eingestellte Multiplikatorreihe dazu passt. Sonst zeigte die
         Markierung auf D20, obwohl T20 gemeint ist. */
      var hl = route ? route[0] : null;
      var hlMult = hl ? (hl.charAt(0) === 'T' ? 3 : hl.charAt(0) === 'D' || hl === 'BULL' ? 2 : 1) : 0;
      var hlNum = hl && hl !== 'BULL' && hl !== '25' && UI.mult === hlMult ? parseInt(hl.slice(1), 10) : null;
      var prefix = UI.mult === 3 ? 'T' : UI.mult === 2 ? 'D' : '';
      var nums = '';
      for (var n = 1; n <= 20; n++) {
        nums += '<button data-num="' + n + '" class="' + (n === hlNum ? 'hl' : '') + '">' +
          (prefix ? '<span class="mx">' + prefix + '</span>' : '') + n + '</button>';
      }
      nums += '<button class="miss" data-num="0" data-mult="1">Miss</button>';
      nums += '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25" data-mult="1">Bull</button>';
      nums += '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-num="25" data-mult="2">Bull ×2</button>';
      /* Wie im X01: dreimal am Doppel vorbei muss nicht dreimal getippt
         werden – dieser Knopf füllt die Aufnahme mit Fehlwürfen auf. */
      nums += '<button class="end-visit wide" data-action="fin-end-visit">Weiter ▸</button>';
      $('fin-pad').innerHTML =
        '<div class="mult-row">' +
          '<button data-mult="1" class="' + (UI.mult === 1 ? 'active' : '') + '">Single</button>' +
          '<button data-mult="2" class="' + (UI.mult === 2 ? 'active' : '') + '">Double</button>' +
          '<button data-mult="3" class="' + (UI.mult === 3 ? 'active' : '') + '">Triple</button>' +
        '</div><div class="num-grid">' + nums + '</div>';
    }
  }

  /* ================= Spielbericht (SDM-Bogen) ================= */

  /* Woher kommt der Bericht: aus dem laufenden Ligaspiel oder – über den
     Spieltag im Liga-Reiter – aus dem Archiv. */
  function ligaBerichtQuelle() {
    if (UI.bericht) {
      for (var i = 0; i < S.history.length; i++) {
        var h = S.history[i];
        if (h.liga && h.liga.terminId === UI.bericht && h.matches) {
          return {
            liga: h.liga, matches: h.matches,
            start: (h.settings && h.settings.start) || 501,
            bestOf: (h.settings && h.settings.bestOf) || 3, at: h.at
          };
        }
      }
      return null;
    }
    if (S.tour && S.tour.liga) {
      return { liga: S.tour.liga, matches: S.matches, start: tourStart(), bestOf: tour().bestOf, at: null };
    }
    return null;
  }

  function berichtZeit(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* Eine Highlight-Zeilenliste je Bogen-Seite: „Mark 180 ×2", „Mark 141
     Finish", „Mark 18-Darter" – höchstens 7 Zeilen, wie auf dem Bogen. */
  function berichtHighlights(ids, stM) {
    var zeilen = [];
    ids.forEach(function (id) {
      var s = stM[id];
      if (!s) return;
      if (s.s180 > 0) zeilen.push(esc(s.name) + ' 180' + (s.s180 > 1 ? ' ×' + s.s180 : ''));
      if (s.highCO >= 100) zeilen.push(esc(s.name) + ' ' + s.highCO + ' Finish');
      if (s.bestLeg && s.bestLeg <= 21) zeilen.push(esc(s.name) + ' ' + s.bestLeg + '-Darter');
    });
    return zeilen.slice(0, 7);
  }

  /* Nicht bei jedem Zeichnen neu bauen: der Hintergrund-Abgleich würde
     sonst Handkorrekturen im Blatt kommentarlos wegwischen. Neu gezeichnet
     wird nur, wenn eine andere Quelle dran ist oder Ergebnisse dazukamen. */
  var berichtStand = null;

  function renderBericht() {
    var q = ligaBerichtQuelle();
    if (!q) { S.screen = 'liga'; render(); return; }
    var kennung = (UI.bericht || 'live') + ':' +
      q.matches.filter(function (m) { return m.done; }).length;
    if (berichtStand === kennung && $('bericht-blatt').innerHTML) return;
    berichtStand = kennung;
    var lg = q.liga;
    var heimTeam = lg.heim ? LIGA.team : lg.gegner;
    var gastTeam = lg.heim ? lg.gegner : LIGA.team;
    var heimIds = lg.heimSpieler || (lg.heim ? lg.wir : lg.sie);
    var gastIds = lg.gastSpieler || (lg.heim ? lg.sie : lg.wir);

    var stM = collectStats([{ matches: q.matches, start: q.start }], heimIds.concat(gastIds));
    Object.keys(stM).forEach(function (k) { stM[k].name = pname(k); finalize(stM[k]); });

    /* Spielerzeilen H1–H8 / G1–G8: der Anzeigename steht im Vornamen-Feld,
       der bürgerliche Nachname wird von Hand ergänzt (SWO verlangt ihn). */
    var spielerZeilen = function (praefix, ids) {
      var zeilen = '';
      for (var i = 0; i < 8; i++) {
        var vor = '', nach = '';
        if (ids[i]) {
          var prof = profile(ids[i]);
          if (prof && prof.voll) {
            /* Buergerlicher Name: das letzte Wort ist der Nachname. */
            var teile = prof.voll.trim().split(' ');
            nach = teile.length > 1 ? teile.pop() : '';
            vor = teile.join(' ');
          } else {
            vor = pname(ids[i]);
          }
        }
        zeilen += '<tr' + (i === 3 ? ' class="b-trenn"' : '') + '>' +
          '<th>' + praefix + (i + 1) + '</th>' +
          '<td contenteditable>' + esc(vor) + '</td>' +
          '<td contenteditable>' + esc(nach) + '</td></tr>';
      }
      return zeilen;
    };

    /* Die 16 Einzel in Bogen-Reihenfolge. Links die Legs, rechts die nach
       der SWO-Staffel kumulierten PUNKTE (Best of 3: 2:0 = 4:0, 2:1 = 3:1;
       Best of 5: 6:0 / 5:1 / 4:2) – kumuliert in der Reihenfolge, in der
       die Einzel tatsächlich fertig wurden, wie auf dem handgeführten Bogen. */
    var gewinnLegs = Math.floor((q.bestOf || 3) / 2) + 1;
    var lauf = {}, hp = 0, gp = 0;
    q.matches.filter(function (m) { return m.done; })
      .slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); })
      .forEach(function (m) {
        var pkt = ligaPunkte(m, gewinnLegs);
        if (m.winner === m.p[0]) { hp += pkt[0]; gp += pkt[1]; }
        else { gp += pkt[0]; hp += pkt[1]; }
        lauf[m.id] = hp + ' : ' + gp;
      });
    var heimLegs = 0, gastLegs = 0;
    var einzelZeilen = q.matches.map(function (m, i) {
      // Alt-Archiv ohne posPaar: die Matches entstanden nach der alten Tabelle.
      var paar = m.posPaar || LIGA_EINZEL_ALT[i] || [0, 0];
      var lh, lgs;
      if (m.kampflos && m.done) {
        lh = m.winner === m.p[0] ? gewinnLegs : 0;
        lgs = m.winner === m.p[1] ? gewinnLegs : 0;
      } else {
        lh = legsWon(m, m.p[0]);
        lgs = legsWon(m, m.p[1]);
      }
      heimLegs += lh; gastLegs += lgs;
      return '<tr' + (i % 4 === 3 ? ' class="b-trenn"' : '') + '>' +
        '<th>H' + (paar[0] + 1) + ' – G' + (paar[1] + 1) + '</th>' +
        '<td contenteditable>' + (m.done || m.legs.length
          ? lh + ' : ' + lgs + (m.kampflos ? ' w.o.' : '') : ' : ') + '</td>' +
        '<td contenteditable>' + (m.done && lauf[m.id] ? lauf[m.id] : ' : ') + '</td></tr>';
    }).join('');

    var hlHeim = berichtHighlights(heimIds, stM);
    var hlGast = berichtHighlights(gastIds, stM);
    var hlZeilen = function (praefix, liste) {
      var zeilen = '';
      for (var i = 0; i < 7; i++) {
        zeilen += '<tr><th>' + praefix + '</th><td contenteditable>' + (liste[i] || '') + '</td></tr>';
      }
      return zeilen;
    };

    $('bericht-blatt').innerHTML =
      '<div class="blatt">' +
        '<div class="b-kopf">' +
          '<div class="b-marke"><div class="b-sdm">sdm</div>' +
            '<div class="b-sdm-sub">steeldart münchen</div><div class="b-liga">4er Liga</div></div>' +
          '<div class="b-recht">Der ausgefüllte Spielbericht ist der Ligaleitung unverzüglich zukommen ' +
            'zu lassen. Wird der Spielbericht nicht innerhalb von 3 Werktagen nach dem Spieltag abgesandt, ' +
            'wird das Ligaspiel für das Heimteam mit 0:2 Punkten und 0:16 Spielen als verloren gewertet. ' +
            'Für den Umgang mit den angegebenen personenbezogenen Daten wird auf das Datenschutz-Merkblatt ' +
            'der SDM verwiesen.<br><br>' +
            'Spielleiter: Udo Kern · spielbericht@steeldart-muenchen.de</div>' +
        '</div>' +
        '<div class="b-info">' +
          '<table class="b-tab"><tr><th>Spielort:</th><td contenteditable>' + esc(lg.ort || '') + '</td></tr>' +
          '<tr><th class="b-rot">Spieltag Nr.:</th><td contenteditable>' + lg.nr + '</td></tr>' +
          '<tr><th class="b-schwarz">Heim-Team:</th><td contenteditable>' + esc(heimTeam) + '</td></tr></table>' +
          '<table class="b-tab"><tr><th>Datum:</th><td contenteditable>' +
            (lg.tag ? ligaDatum(lg.tag) : '') + '</td></tr>' +
          '<tr><th>Spielzeit:</th><td><span class="b-zeit">von: <b contenteditable>' + berichtZeit(lg.zeitVon) +
            '</b></span><span class="b-zeit">bis: <b contenteditable>' + berichtZeit(lg.zeitBis) + '</b></span></td></tr>' +
          '<tr><th class="b-schwarz">Gast-Team:</th><td contenteditable>' + esc(gastTeam) + '</td></tr></table>' +
        '</div>' +
        '<div class="b-spalten">' +
          '<table class="b-tab b-spieler"><tr><th>Spieler</th><th>Vorname</th><th>Name</th></tr>' +
            spielerZeilen('H', heimIds) + '</table>' +
          '<table class="b-tab b-spieler"><tr><th>Spieler</th><th>Vorname</th><th>Name</th></tr>' +
            spielerZeilen('G', gastIds) + '</table>' +
        '</div>' +
        '<div class="b-spalten">' +
          '<div>' +
            '<table class="b-tab b-einzel"><tr><th>Einzelspiele</th><th>Legs</th><th>Ergebnis</th></tr>' +
              einzelZeilen + '</table>' +
            '<table class="b-tab b-ende"><tr><th>Endergebnis:</th>' +
              '<td contenteditable>' + heimLegs + ' : ' + gastLegs + '</td>' +
              '<td contenteditable>' + hp + ' : ' + gp + '</td></tr></table>' +
            '<table class="b-tab b-ende"><tr><td contenteditable>Nachmeldungen: ja O&nbsp;&nbsp;nein O</td>' +
              '<td contenteditable>Proteste: ja O&nbsp;&nbsp;nein O</td></tr></table>' +
          '</div>' +
          '<div>' +
            '<div class="b-titel">Highlights Heim:</div>' +
            '<table class="b-tab b-hl">' + hlZeilen('H', hlHeim) + '</table>' +
            '<div class="b-titel">Highlights Gast:</div>' +
            '<table class="b-tab b-hl">' + hlZeilen('G', hlGast) + '</table>' +
            '<p class="b-klein">Eingetragene Spielpositionen sind verbindlich! Ausgewechselte ' +
              'Spieler:innen dürfen nur auf derselben Position wieder eingewechselt werden, jedoch ' +
              'können auf einer Position auch mehrere Spieler:innen eingesetzt werden!</p>' +
          '</div>' +
        '</div>' +
        '<div class="b-spalten">' +
          '<div><div class="b-titel">TC Heim:</div><div class="b-unterschrift" contenteditable></div></div>' +
          '<div><div class="b-titel">TC Gast:</div><div class="b-unterschrift" contenteditable></div></div>' +
        '</div>' +
        '<div class="b-fuss">nach SDM-Spielbericht-4er-V5.2 · Blink-180-App · Seite 1/2</div>' +
      '</div>' +

      /* Seite 2: Nachmeldungen und Proteste, als Leerformular. */
      '<div class="blatt b-seite2">' +
        '<div class="b-titel">Nachmeldungen:</div>' +
        '<table class="b-tab b-nach"><tr><th>Team</th><th>Nachname</th><th>Vorname</th><th>U18?</th><th>w/m/d</th><th>Unterschrift</th></tr>' +
          '<tr><td contenteditable></td><td contenteditable></td><td contenteditable></td><td contenteditable></td><td contenteditable></td><td></td></tr>'.repeat(6) +
        '</table>' +
        '<p class="b-klein">Für eine gültige Nachmeldung müssen alle Felder ausgefüllt sowie die ' +
          'Unterschrift der neu gemeldeten Person geleistet werden. Die Person bestätigt mit der ' +
          'Unterschrift, dass sie damit einverstanden ist, dass ihr Team an Spielen der SDM-Ligen ' +
          'teilnimmt und ihre persönlichen Daten gemäß dem Datenschutz-Merkblatt der SDM verarbeitet ' +
          'werden. Ferner erkennt sie die Sport- und Wettkampfordnung der SDM an. Bei Nachmeldungen ' +
          'ist die Spielergebühr innerhalb von 14 Tagen zu entrichten (10 € je Person, 2 € bei U18 – ' +
          'Steeldart München e.V., Stadtsparkasse München, IBAN DE23 7015 0000 0036 1357 47).</p>' +
        '<div class="b-titel">Proteste und Anmerkungen:</div>' +
        '<div class="b-protest" contenteditable></div>' +
        '<div class="b-fuss">Seite 2/2</div>' +
      '</div>';
  }

  function renderSummary() {
    var s = UI.summary;
    var found = s ? findGame(s.kind, s.id) : null;
    if (!found) { S.screen = S.matches.length ? 'tournament' : 'setup'; render(); return; }

    var box = '';
    var actions = '';
    var note = '<p class="hint center">Diese Werte fließen in Karriere-Statistik und Ranglisten ein.</p>';

    if (s.kind === '501') {
      var m = found.m;
      var map = collectStats([{ matches: [m], start: found.start }], m.p);
      m.p.forEach(function (id) { finalize(map[id]); });

      box = '<div class="sum-head">' +
        '<div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + esc(pname(m.winner)) + ' gewinnt</h2>' +
        '<div class="sum-score">' +
          '<span class="' + (m.winner === m.p[0] ? 'w' : '') + '">' + esc(pname(m.p[0])) + '</span>' +
          '<b>' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + '</b>' +
          '<span class="' + (m.winner === m.p[1] ? 'w' : '') + '">' + esc(pname(m.p[1])) + '</span>' +
        '</div></div>' +

        '<div class="sum-cards">' + m.p.map(function (id) {
          var st = map[id];
          return '<div class="card sum-card ' + (m.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div><div class="nm">' + esc(pname(id)) + '</div>' +
              '<div class="muted">' + st.legsWon + ' Leg' + (st.legsWon === 1 ? '' : 's') + '</div></div></div>' +
            statRow('3-Dart-Average', st.darts ? st.avg.toFixed(2) : '–') +
            statRow('First 9', st.first9Darts ? st.first9.toFixed(2) : '–') +
            statRow('Höchste Aufnahme', st.highScore || '–') +
            statRow('180 / 140+ / 100+', st.s180 + ' / ' + st.s140 + ' / ' + st.s100) +
            statRow('Höchstes Finish', st.highCO || '–') +
            statRow('Doppelquote', st.doubleAttempts ? st.doubleQuote.toFixed(0) + ' % (' + st.checkouts + '/' + st.doubleAttempts + ')' : '–') +
            statRow('Bestes Leg', st.bestLeg ? st.bestLeg + ' Darts' : '–') +
            statRow('Darts geworfen', st.darts) +
            '</div>';
        }).join('') + '</div>' +

        '<div class="card"><h2>Legs</h2>' + m.legs.map(function (leg, i) {
          if (!leg.winner) return '';
          var d = dartsInLeg(leg, leg.winner);
          var pts = found.start;
          return statRow('Leg ' + (i + 1), esc(pname(leg.winner)) + ' · ' + d + ' Darts · Ø ' + ((pts / d) * 3).toFixed(1));
        }).join('') + '</div>' + note;

      var fixBtn = m.done
        ? '<button class="btn ghost full" data-action="reopen-match" data-id="' + m.id + '">Letzte Aufnahme zurücknehmen</button>'
        : '';
      if (found.live && !allMatchesDone()) {
        actions = '<button class="btn primary full big" data-action="ov-next-match">Nächstes Spiel</button>' +
          '<button class="btn ghost full" data-action="to-tournament">Zur Tabelle</button>' + fixBtn;
      } else if (found.live) {
        actions = '<button class="btn primary full big" data-action="to-winner">Turnier auswerten</button>' +
          '<button class="btn ghost full" data-action="to-tournament">Zur Tabelle</button>' + fixBtn;
      } else {
        actions = '<button class="btn ghost full" data-action="summary-back">Zurück</button>';
      }

    } else if (s.kind === 'cricket') {
      var g = found.g;
      var cst = cricketState(g);
      box = '<div class="sum-head"><div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + esc(pname(g.winner)) + ' gewinnt</h2>' +
        '<div class="muted">Cricket ' + (g.scoring ? 'mit Punkten' : 'ohne Punkte') + '</div></div>' +
        '<div class="sum-cards">' + g.players.map(function (id) {
          var closed = CRICKET_NUMBERS.filter(function (n) { return cst.marks[id][n] >= 3; }).length;
          var mpr = cst.darts[id] ? (cst.allMarks[id] / cst.darts[id]) * 3 : 0;
          return '<div class="card sum-card ' + (g.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div class="nm">' + esc(pname(id)) + '</div></div>' +
            statRow('MPR', mpr.toFixed(2), 'Marken je 3 Darts') +
            statRow('Marken', cst.allMarks[id]) +
            (g.scoring ? statRow('Punkte', cst.score[id]) : '') +
            statRow('Felder zu', closed + ' / 7') +
            statRow('Darts', cst.darts[id]) +
            '</div>';
        }).join('') + '</div>' + note;

      actions = found.live
        ? '<button class="btn primary full big" data-action="restart-game">Nochmal spielen</button>' +
          '<button class="btn ghost full" data-action="finish-game">Speichern &amp; beenden</button>'
        : '<button class="btn ghost full" data-action="summary-back">Zurück</button>';

    } else if (s.kind === 'quick') {
      var qg = found.g;
      var qm = qg.matches ? qg.matches[0] : qg;          // archiviert oder noch live
      var qStart = (qg.settings && qg.settings.start) || qg.start || 501;
      var qMap = collectStats([{ matches: [qm], start: qStart }], qm.p);
      qm.p.forEach(function (id) { finalize(qMap[id]); });
      var qLeg = qm.legs[qm.legs.length - 1];

      box = '<div class="sum-head"><div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + esc(pname(qm.winner)) + ' gewinnt</h2>' +
        '<div class="muted">Schnelles Spiel · ' + qStart + ' Double Out · ' +
          plural(qm.p.length, 'Spieler', 'Spieler') + '</div></div>' +
        '<div class="sum-cards">' + qm.p.map(function (id) {
          var st = qMap[id];
          var rest = qLeg ? remainingIn(qLeg, id) : 0;
          return '<div class="card sum-card ' + (qm.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div><div class="nm">' + esc(pname(id)) + '</div>' +
              '<div class="muted">' + (qm.winner === id ? 'ausgecheckt' : 'Rest ' + rest) + '</div></div></div>' +
            statRow('3-Dart-Average', st.darts ? st.avg.toFixed(2) : '–') +
            statRow('First 9', st.first9Darts ? st.first9.toFixed(2) : '–') +
            statRow('Höchste Aufnahme', st.highScore || '–') +
            statRow('180 / 140+ / 100+', st.s180 + ' / ' + st.s140 + ' / ' + st.s100) +
            statRow('Höchstes Finish', st.highCO || '–') +
            statRow('Darts geworfen', st.darts) +
            '</div>';
        }).join('') + '</div>' + note;

      actions = found.live
        ? '<button class="btn primary full big" data-action="restart-game">Nochmal spielen</button>' +
          '<button class="btn ghost full" data-action="finish-game">Speichern &amp; beenden</button>'
        : '<button class="btn ghost full" data-action="summary-back">Zurück</button>';

    } else if (s.kind === 'finisher') {
      var fg2 = found.g;
      var gewonnen = {}, dartsSum = {}, best = {}, hoch = {};
      fg2.players.forEach(function (id) { gewonnen[id] = 0; dartsSum[id] = 0; best[id] = null; hoch[id] = 0; });
      (fg2.rounds || []).forEach(function (rd) {
        if (!rd.sieger || !rd.darts || gewonnen[rd.sieger] === undefined) return;
        gewonnen[rd.sieger]++;
        dartsSum[rd.sieger] += rd.darts;
        if (best[rd.sieger] === null || rd.darts < best[rd.sieger]) best[rd.sieger] = rd.darts;
        if (rd.zahl > hoch[rd.sieger]) hoch[rd.sieger] = rd.zahl;
      });
      var gespielt = (fg2.rounds || []).filter(function (rd) { return rd.sieger; }).length;

      box = '<div class="sum-head"><div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + esc(pname(fg2.winner)) + ' gewinnt</h2>' +
        '<div class="muted">Finisher · ' + plural(gespielt, 'Runde', 'Runden') + ' · auf ' + fg2.ziel + ' Punkte</div></div>' +
        '<div class="sum-cards">' + fg2.players.map(function (id) {
          return '<div class="card sum-card ' + (fg2.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div class="nm">' + esc(pname(id)) + '</div></div>' +
            statRow('Punkte', gewonnen[id]) +
            statRow('Ø Darts je Finish', gewonnen[id] ? (dartsSum[id] / gewonnen[id]).toFixed(1) : '–') +
            statRow('Schnellstes Finish', best[id] === null ? '–' : plural(best[id], 'Dart', 'Darts')) +
            statRow('Höchste Zahl', hoch[id] || '–') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="card"><h2>Runden</h2>' + (fg2.rounds || []).map(function (rd, i) {
          if (!rd.sieger) return '';
          return statRow('Runde ' + (i + 1) + ' · ' + rd.zahl,
            esc(pname(rd.sieger)) + ' · ' + plural(rd.darts, 'Dart', 'Darts'));
        }).join('') + '</div>' + note;

      actions = found.live
        ? '<button class="btn primary full big" data-action="restart-game">Nochmal spielen</button>' +
          '<button class="btn ghost full" data-action="finish-game">Speichern &amp; beenden</button>'
        : '<button class="btn ghost full" data-action="summary-back">Zurück</button>';

    } else {
      var rg = found.g;
      var rst = rtwState(rg);
      box = '<div class="sum-head"><div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + esc(pname(rg.winner)) + ' gewinnt</h2>' +
        '<div class="muted">Round the World · ' + rst.darts[rg.winner] + ' Darts bis Bull</div></div>' +
        '<div class="sum-cards">' + rg.players.map(function (id) {
          var t = rst.target[id];
          return '<div class="card sum-card ' + (rg.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div class="nm">' + esc(pname(id)) + '</div></div>' +
            statRow('Gekommen bis', rg.winner === id ? 'Bull ✓' : (t === 25 ? 'Bull' : t)) +
            statRow('Darts', rst.darts[id]) +
            statRow('Treffer', rst.hits[id]) +
            statRow('Trefferquote', rst.darts[id] ? Math.round(rst.hits[id] / rst.darts[id] * 100) + ' %' : '–') +
            '</div>';
        }).join('') + '</div>' + note;

      actions = found.live
        ? '<button class="btn primary full big" data-action="restart-game">Nochmal spielen</button>' +
          '<button class="btn ghost full" data-action="finish-game">Speichern &amp; beenden</button>'
        : '<button class="btn ghost full" data-action="summary-back">Zurück</button>';
    }

    $('summary-box').innerHTML = box;
    $('summary-actions').innerHTML = actions;
  }

  function renderWinner() {
    var abschluss = document.querySelector('#screen-winner [data-action="finish-tournament"]');
    if (abschluss) {
      abschluss.textContent = S.tour && S.tour.liga ? 'Ligaspiel abschließen' : 'Turnier abschließen';
    }
    /* Ligaspiel: hier gewinnt ein Team, kein Einzelner. Die Highlights
       stehen auch hier – der Bogen wird oft erst nach dem letzten Einzel
       ausgefüllt, und dann soll nichts verschwunden sein. */
    if (S.tour && S.tour.liga) {
      var lw = S.tour.liga;
      var lwd = ligaStandDaten();
      var titel = lwd.wirP > lwd.sieP ? esc(LIGA.team) + ' gewinnt!'
        : lwd.wirP < lwd.sieP ? esc(lw.gegner) + ' gewinnt'
        : 'Unentschieden';
      var emoji = lwd.wirP > lwd.sieP ? '🏆' : lwd.wirP === lwd.sieP ? '🤝' : '🎯';
      $('winner-box').innerHTML =
        '<div style="text-align:center"><div class="big-emoji">' + emoji + '</div>' +
        '<h1>' + titel + '</h1>' +
        '<p class="muted">' + lw.nr + '. Spieltag · ' + esc(LIGA.team) + ' gegen ' + esc(lw.gegner) + '</p>' +
        ligaTeamsHtml(lwd) +
        '<p class="muted">Einzel ' + lwd.wirS + ':' + lwd.sieS + ' · Legs ' + lwd.wirL + ':' + lwd.sieL + '</p></div>' +
        (ligaHighlightsHtml(lwd) ? '<div class="card">' + ligaHighlightsHtml(lwd) + '</div>' : '') +
        '<button class="btn ghost full" data-action="liga-bericht">Spielbericht ansehen &amp; drucken</button>';
      return;
    }

    var table = standings();
    if (!table.length) { S.screen = 'setup'; render(); return; }
    var medals = ['🥇', '🥈', '🥉'];
    /* Bei exaktem Gleichstand gibt es keinen alphabetischen Sieger. */
    var tied = table.filter(function (st) {
      return st.won === table[0].won && st.legDiff === table[0].legDiff &&
        Math.abs(st.avg - table[0].avg) < 0.005;
    });
    var title = tied.length > 1
      ? 'Geteilter Sieg: ' + tied.map(function (st) { return esc(st.name); }).join(' und ')
      : esc(table[0].name) + ' gewinnt!';
    $('winner-box').innerHTML =
      '<div style="text-align:center"><div class="big-emoji">🏆</div>' +
      '<h1>' + title + '</h1>' +
      '<p class="muted">' + plural(table[0].won, 'Spiel', 'Spiele') + ' von ' + (tourPlayers().length - 1) + ' gewonnen</p></div>' +
      '<div class="podium">' + table.map(function (st, i) {
        return '<div class="p ' + (i === 0 ? 'first' : '') + '">' +
          '<div class="medal">' + (medals[i] || (i + 1) + '.') + '</div>' +
          avatarHTML(profile(st.id), 'sm') +
          '<div class="pn">' + esc(st.name) + '</div>' +
          '<div class="pv">' + plural(st.won, 'Sieg', 'Siege') + ' · Legs ' + st.legsWon + ':' + st.legsLost + ' · Ø ' + (st.avg ? st.avg.toFixed(1) : '–') + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  function renderOverlay() {
    var ov = $('overlay');
    if (!UI.overlay) { ov.classList.add('hidden'); ov.classList.remove('gross'); return; }
    ov.classList.remove('hidden');
    /* Im Turnier-Modus sprechen auch die Dialoge Plakatsprache - der
       Schreiber steht vorn an der Scheibe, gelesen wird vom Oche aus. */
    ov.classList.toggle('gross', UI.turnier && turnierErlaubt() && S.screen === 'game');
    var o = UI.overlay;
    var html = '';

    if (o.type === 'checkout-darts') {
      var coWahl = UI.turnier && turnierErlaubt() ? Math.min(o.wahl || 0, o.options.length - 1) : -1;
      html = '<h3>Checkout!</h3><p>Mit wie vielen Darts wurde ' + o.score + ' beendet?</p>' +
        '<div class="row-btns">' + o.options.map(function (n, i) {
          /* Bei Tastatursteuerung ist NUR der gewaehlte Knopf hell - alle
             gleich weiss liesse die Wahl unsichtbar. */
          var coKl = coWahl < 0 ? 'btn primary'
            : i === coWahl ? 'btn primary wahl' : 'btn ghost';
          return '<button class="' + coKl + '" data-action="co-darts" data-n="' + n + '">' + n + '</button>';
        }).join('') + '</div>' +
        '<button class="btn ghost full" data-action="ov-cancel">Abbrechen</button>' +
        (coWahl >= 0 ? '<p class="te-hint">1/2/3 direkt &nbsp;&nbsp; ← → / Tab · wählen &nbsp;&nbsp; Enter · bestätigen</p>' : '');
    } else if (o.type === 'leg-done' || o.type === 'match-done') {
      /* Die laufende Partie kann unter dem Overlay wegfallen: im geteilten
         Turnier traegt ein anderes Geraet vielleicht gerade dasselbe
         Ergebnis ein. Dann gibt es nichts mehr zu zeigen -- Overlay zu,
         statt beim Zeichnen ins Leere zu greifen. */
      if (!currentMatch()) { UI.overlay = null; ov.classList.add('hidden'); return; }
    }

    if (o.type === 'turnier-ende') {
      var tm = matchById(o.id) || currentMatch();
      if (!tm) { UI.overlay = null; ov.classList.add('hidden'); return; }
      /* Im Ligaspiel sprechen auch die Dialoge mit buergerlichen Namen. */
      var teName = S.tour && S.tour.liga ? ligaName : pname;
      if (o.phase === 'stat') {
        /* Die Kurzstatistik des Einzels - nur das, was am Abend zaehlt. */
        var teSt = collectStats([{ matches: [tm], start: matchStart(tm) }], tm.p);
        tm.p.forEach(function (id) { finalize(teSt[id]); });
        html = '<h3>Spiel an ' + esc(teName(o.pid)) + '</h3>' +
          '<p class="te-stand">' + esc(teName(tm.p[0])) + ' <b>' + legsWon(tm, tm.p[0]) + ':' +
            legsWon(tm, tm.p[1]) + '</b> ' + esc(teName(tm.p[1])) + '</p>' +
          '<div class="te-stat">' + tm.p.map(function (id) {
            var s = teSt[id];
            return '<div class="te-spalte' + (id === o.pid ? ' sieger' : '') + '">' +
              '<div class="te-name">' + esc(teName(id)) + '</div>' +
              '<div class="te-wert"><span>Ø</span><b>' + (s.darts ? s.avg.toFixed(1) : '–') + '</b></div>' +
              '<div class="te-wert"><span>180er</span><b>' + s.s180 + '</b></div>' +
              '<div class="te-wert"><span>Finish</span><b>' + (s.highCO || '–') + '</b></div>' +
              '</div>';
          }).join('') + '</div>' +
          '<p class="te-hint">Enter · weiter</p>';
      } else {
        /* Die naechsten Begegnungen, gross - Enter startet die erste. */
        var offene = S.matches.filter(function (x) { return !x.done && !x.void; }).slice(0, 4);
        var liga = S.tour && S.tour.liga;
        var wahl = Math.min(o.wahl || 0, Math.max(0, offene.length - 1));
        if (offene.length) {
          html = '<h3>Nächste Einzel</h3>' +
            '<div class="te-next">' + offene.map(function (x, i) {
              var paar = liga && x.posPaar
                ? 'H' + (x.posPaar[0] + 1) + ' ' + esc(teName(x.p[0])) + ' – G' + (x.posPaar[1] + 1) + ' ' + esc(teName(x.p[1]))
                : esc(teName(x.p[0])) + ' – ' + esc(teName(x.p[1]));
              return '<button class="te-zeile' + (i === wahl ? ' dran' : '') + '" ' +
                'data-action="open-match" data-id="' + x.id + '">' +
                (x.scheibe ? '<span class="te-scheibe">' + x.scheibe + '</span>' : '') +
                '<span>' + paar + '</span></button>';
            }).join('') + '</div>' +
            '<p class="te-hint">↑ ↓ / Tab · wählen &nbsp;&nbsp; Enter · starten &nbsp;&nbsp; Löschen · letzter Dart zurück</p>';
        } else {
          var teD = liga ? ligaStandDaten() : null;
          html = '<h3>' + (liga ? 'Ligaspiel beendet' : 'Alle Spiele beendet') + '</h3>' +
            (teD ? '<p class="te-stand">' + esc(LIGA.team) + ' <b>' + teD.wirP + ':' + teD.sieP + '</b> ' +
              esc(S.tour.liga.gegner) + '</p>' : '') +
            '<button class="btn primary full" data-action="ov-next-match">Zum Endstand</button>' +
            '<p class="te-hint">Enter · Endstand</p>';
        }
      }
    } else if (o.type === 'leg-done') {
      var m1 = currentMatch();
      /* Am Board waehlen die Pfeile zwischen Weiter und Ruecknahme - nur
         die Wahl ist hell und traegt den Ring. */
      var ldWahl = UI.turnier && turnierErlaubt() ? (o.wahl || 0) : -1;
      var ldKl = function (i, sonst) {
        if (ldWahl < 0) return sonst;
        return i === ldWahl ? 'btn primary full wahl' : 'btn ghost full';
      };
      html = '<div class="big-emoji">🎯</div><h3>Leg an ' + esc(pname(o.pid)) + '</h3>' +
        '<p>Stand: ' + legsWon(m1, m1.p[0]) + ':' + legsWon(m1, m1.p[1]) + '</p>' +
        '<button class="' + ldKl(0, 'btn primary full') + '" data-action="ov-next-leg">Nächstes Leg</button>' +
        '<button class="' + ldKl(1, 'btn ghost full') + '" data-action="undo">Eingabe rückgängig</button>' +
        (ldWahl >= 0 ? '<p class="te-hint">↑ ↓ / Tab · wählen &nbsp;&nbsp; Enter · bestätigen &nbsp;&nbsp; Löschen · direkt zurück</p>' : '');
    } else if (o.type === 'match-done') {
      var m2 = currentMatch();
      var last = !nextOpenMatch();
      html = '<div class="big-emoji">🏅</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + esc(pname(m2.p[0])) + ' ' + legsWon(m2, m2.p[0]) + ':' + legsWon(m2, m2.p[1]) + ' ' + esc(pname(m2.p[1])) + '</p>' +
        '<button class="btn primary full" data-action="open-summary" data-kind="501" data-id="' + m2.id + '">Weiter zur Spielstatistik</button>' +
        (last ? '' : '<button class="btn ghost full" data-action="ov-next-match">Direkt zum nächsten Spiel</button>') +
        '<button class="btn ghost full" data-action="undo">Eingabe rückgängig</button>';
    } else if (o.type === 'confirm-discard-game') {
      html = '<h3>' + kindName(S.game ? S.game.kind : '') + ' abbrechen?</h3>' +
        '<p>Das Spiel ist noch nicht entschieden – es gibt also nichts, was in die ' +
        'Statistik gehören würde. Der bisherige Verlauf geht verloren.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Nein, weiterspielen</button>' +
        '<button class="btn danger" data-action="ov-discard-game">Ja, verwerfen</button></div>';
    } else if (o.type === 'warte') {
      html = '<p>' + esc(o.text) + '</p>';
    } else if (o.type === 'hinweis') {
      html = '<h3>Geht gerade nicht</h3><p>' + esc(o.text) + '</p>' +
        '<button class="btn primary full" data-action="ov-hinweis-zu">Verstanden</button>';
    } else if (o.type === 'confirm-beitreten') {
      html = '<h3>Turnier wechseln?</h3>' +
        '<p>Hier läuft noch ein eigenes Turnier mit <b>' +
        plural(o.played, 'gespieltem Spiel', 'gespielten Spielen') + '</b>. ' +
        'Das wird abgeschlossen und wandert in die Rangliste, bevor du beim geteilten mitmachst.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="ov-beitreten">Mitmachen</button></div>';
    } else if (o.type === 'liga-start') {
      /* Aufstellung fürs Ligaspiel: unsere vier Positionen als Auswahl
         (vorbelegt mit den Zusagen des Spieltags), die vier Gegner als
         Namensfelder – sie werden Gäste dieses Geräts. */
      var lt = o.termin, ld = o.draft;
      var ltDaheim = lt.heim === LIGA.team;
      var ltGegner = ltDaheim ? lt.gast : lt.heim;
      var ltProfile = activeProfiles();
      var kannTeilenLiga = !!(window.DartKonto && window.DartKonto.nutzer() &&
        window.DartSync && window.DartSync.turnier);
      html = '<h3>Ligaspiel</h3>' +
        '<p>' + lt.nr + '. Spieltag · ' + esc(lt.heim) + ' vs ' + esc(lt.gast) +
          (lt.ort ? ' · ' + esc(lt.ort) : '') + '</p>' +
        (o.fehler ? '<p class="edit-error">' + esc(o.fehler) + '</p>' : '') +
        '<div class="liga-start">' +
          '<div class="ls-titel">Unsere Positionen</div>' +
          [0, 1, 2, 3].map(function (i) {
            return '<label class="ls-zeile"><span>' + (i + 1) + '</span>' +
              '<select data-role="liga-pos" data-i="' + i + '">' +
              ltProfile.map(function (p) {
                return '<option value="' + p.id + '"' + (ld.wir[i] === p.id ? ' selected' : '') + '>' +
                  esc(p.name) + '</option>';
              }).join('') + '</select></label>';
          }).join('') +
          '<div class="ls-titel">' + esc(ltGegner) + ' \u2013 Vor- und Nachname (SWO)</div>' +
          [0, 1, 2, 3].map(function (i) {
            return '<label class="ls-zeile"><span>' + (i + 1) + '</span>' +
              '<span class="namen-paar">' +
              '<input data-role="liga-gegner" data-i="' + i + '" maxlength="30" ' +
              'value="' + esc(ld.gegner[i]) + '" placeholder="Vorname">' +
              '<input data-role="liga-gegner-nach" data-i="' + i + '" maxlength="30" ' +
              'value="' + esc((ld.gegnerNach || [])[i] || '') + '" placeholder="Nachname">' +
              '</span></label>';
          }).join('') +
          '<div class="ls-titel">Legs je Einzel</div>' +
          '<div class="options">' +
            '<button data-action="liga-bestof" data-value="3" class="' + (ld.bestOf === 3 ? 'active' : '') + '">Best of 3</button>' +
            '<button data-action="liga-bestof" data-value="5" class="' + (ld.bestOf === 5 ? 'active' : '') + '">Best of 5</button>' +
          '</div>' +
          '<div class="ls-titel">Finish-Anzeigen</div>' +
          '<div class="options">' +
            '<button data-action="liga-finish" data-value="0" class="' + (ld.finish ? '' : 'active') + '">ohne</button>' +
            '<button data-action="liga-finish" data-value="1" class="' + (ld.finish ? 'active' : '') + '">mit</button>' +
          '</div>' +
          '<p class="hint">Ohne ist Liga-konform: Der Schreiber darf das benötigte Doppel ' +
            'nicht ansagen (WDF 3.08) – die App zeigt dann keine Finish-Wege.</p>' +
          (kannTeilenLiga
            ? '<div class="ls-titel">An zwei Scheiben</div>' +
              '<div class="options">' +
                '<button data-action="liga-geteilt" data-value="0" class="' + (ld.geteilt ? '' : 'active') + '">ein Gerät</button>' +
                '<button data-action="liga-geteilt" data-value="1" class="' + (ld.geteilt ? 'active' : '') + '">geteilt</button>' +
              '</div>'
            : '') +
        '</div>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="liga-los">Los geht\'s</button></div>';
    } else if (o.type === 'uebung-start') {
      var ud = o.draft;
      var uProfile = activeProfiles();
      var uKannTeilen = !!(window.DartSync && window.DartSync.turnier && window.DartKonto && window.DartKonto.nutzer());
      var uSelect = function (rolle, liste, i) {
        return '<label class="ls-zeile"><span>' + (i + 1) + '</span>' +
          '<select data-role="' + rolle + '" data-i="' + i + '">' +
          uProfile.map(function (p) {
            return '<option value="' + p.id + '"' + (liste[i] === p.id ? ' selected' : '') + '>' +
              esc(p.name) + '</option>';
          }).join('') + '</select></label>';
      };
      html = '<h3>Übungs-Ligaspiel</h3>' +
        (o.fehler ? '<p class="edit-error">' + esc(o.fehler) + '</p>' : '') +
        '<div class="liga-start">' +
          '<div class="ls-titel">Gegner</div>' +
          '<div class="options">' +
            ['team', 'leicht', 'mittel', 'schwer'].map(function (g) {
              var txt = g === 'team' ? 'Team B' : 'Bots ' + g;
              return '<button data-action="uebung-gegner" data-value="' + g + '" class="' +
                (ud.gegner === g ? 'active' : '') + '">' + txt + '</button>';
            }).join('') +
          '</div>' +
          '<div class="ls-titel">Team A</div>' +
          [0, 1, 2, 3].map(function (i) { return uSelect('liga-pos', ud.wir, i); }).join('') +
          (ud.gegner === 'team'
            ? '<div class="ls-titel">Team B</div>' +
              [0, 1, 2, 3].map(function (i) { return uSelect('uebung-sie', ud.sie, i); }).join('')
            : '<p class="hint">Vier Bots treten an – sie werfen von selbst, wenn sie dran sind.</p>') +
          '<div class="ls-titel">Legs je Einzel</div>' +
          '<div class="options">' +
            '<button data-action="liga-bestof" data-value="3" class="' + (ud.bestOf === 3 ? 'active' : '') + '">Best of 3</button>' +
            '<button data-action="liga-bestof" data-value="5" class="' + (ud.bestOf === 5 ? 'active' : '') + '">Best of 5</button>' +
          '</div>' +
          '<div class="ls-titel">Finish-Anzeigen</div>' +
          '<div class="options">' +
            '<button data-action="liga-finish" data-value="0" class="' + (ud.finish ? '' : 'active') + '">ohne</button>' +
            '<button data-action="liga-finish" data-value="1" class="' + (ud.finish ? 'active' : '') + '">mit</button>' +
          '</div>' +
          (uKannTeilen && ud.gegner === 'team'
            ? '<div class="ls-titel">An zwei Scheiben</div>' +
              '<div class="options">' +
                '<button data-action="liga-geteilt" data-value="0" class="' + (ud.geteilt ? '' : 'active') + '">ein Gerät</button>' +
                '<button data-action="liga-geteilt" data-value="1" class="' + (ud.geteilt ? 'active' : '') + '">geteilt</button>' +
              '</div>'
            : '') +
        '</div>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="uebung-los">Training an!</button></div>';
    } else if (o.type === 'liga-kampflos') {
      /* Tritt eine Position nicht an (nur 3 gemeldet, jemand fehlt), wird
         das Einzel kampflos gewertet: volle Legs und Punkte fuer den
         Antretenden, ohne einen einzigen Wurf in der Statistik. */
      var kfMatch = matchById(o.id);
      if (!kfMatch) { UI.overlay = null; ov.classList.add('hidden'); return; }
      html = '<h3>Kampflos werten</h3>' +
        (kfMatch.kampflos
          ? '<p>' + esc(ligaName(kfMatch.winner)) + ' hat dieses Einzel kampflos gewonnen.</p>' +
            (geteiltesTurnier()
              ? '<p class="hint">Im geteilten Spiel lässt sich die Wertung nicht zurücknehmen – ' +
                'das andere Gerät hat sie bereits übernommen.</p>'
              : '<button class="btn ghost full" data-action="liga-kampflos-zurueck">Wertung zurücknehmen</button>')
          : '<p>Wer tritt zu diesem Einzel <b>nicht</b> an? Der andere gewinnt ' +
            legsToWin() + ':0 ohne Würfe (SWO: nicht gestellter Spieler).</p>' +
            '<button class="btn full" data-action="liga-kampflos-wer" data-wer="' + kfMatch.p[0] + '">' +
              esc(ligaName(kfMatch.p[0])) + ' fehlt</button>' +
            '<button class="btn full" data-action="liga-kampflos-wer" data-wer="' + kfMatch.p[1] + '">' +
              esc(ligaName(kfMatch.p[1])) + ' fehlt</button>') +
        '<button class="btn ghost full" data-action="ov-cancel">Abbrechen</button>';
    } else if (o.type === 'liga-wechsel') {
      /* Die acht Positionen mit ihrer aktuellen Besetzung – Wechsel je
         Position, wie es die SWO erlaubt. */
      var wlg = S.tour && S.tour.liga;
      if (!wlg) { UI.overlay = null; ov.classList.add('hidden'); return; }
      var wUnsere = wlg.heim ? 'H' : 'G';
      var wZeile = function (seite, posListe) {
        return posListe.map(function (id, i) {
          return '<div class="rc-row">' +
            '<span class="bo-pos">' + seite + (i + 1) + '</span>' +
            avatarHTML(profile(id), 'sm') +
            '<span class="rc-name">' + esc(pname(id)) +
              (seite === wUnsere ? '' : ' <span class="gast-marke">Gast</span>') + '</span>' +
            '<button class="btn ghost small" data-action="liga-wechsel-pos" ' +
              'data-seite="' + seite + '" data-pos="' + i + '">Wechseln</button>' +
            '</div>';
        }).join('');
      };
      html = '<h3>Spieler wechseln</h3>' +
        '<p class="hint">Nur auf derselben Position (SWO §8), höchstens 8 Spieler je Team. ' +
          'Der Wechsel gilt für alle noch nicht begonnenen Einzel der Position – ' +
          'ein angefangenes Einzel spielt sein Spieler zu Ende. Wer auf einer Position ' +
          'gespielt hat, bleibt auf ihr (Rotation dort ist erlaubt). Höchstens ein nicht ' +
          'gemeldeter Gastspieler pro Mannschaft und Ligaspiel.</p>' +
        '<div class="roster-change">' +
          '<div class="ls-titel">Heim</div>' + wZeile('H', wlg.posH) +
          '<div class="ls-titel">Gast</div>' + wZeile('G', wlg.posG) +
        '</div>' +
        '<button class="btn primary full" data-action="ov-cancel">Fertig</button>';
    } else if (o.type === 'liga-wechsel-zu') {
      var wz = o;
      html = '<h3>Wechsel auf Position ' + wz.seite + (wz.pos + 1) + '</h3>' +
        (o.fehler ? '<p class="edit-error">' + esc(o.fehler) + '</p>' : '') +
        (wz.eigene
          ? '<label class="ls-zeile liga-start"><span>Neu</span>' +
            '<select data-role="liga-neu">' +
            activeProfiles().map(function (p) {
              return '<option value="' + p.id + '"' + (wz.draft.neu === p.id ? ' selected' : '') + '>' +
                esc(p.name) + '</option>';
            }).join('') + '</select></label>'
          : '<label class="ls-zeile liga-start"><span>Neu</span>' +
            '<span class="namen-paar">' +
            '<input data-role="liga-neu-name" maxlength="30" value="' + esc(wz.draft.name) + '" ' +
            'placeholder="Vorname">' +
            '<input data-role="liga-neu-nach" maxlength="30" value="' + esc(wz.draft.nach || '') + '" ' +
            'placeholder="Nachname">' +
            '</span></label>') +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="roster-change">Zurück</button>' +
        '<button class="btn primary" data-action="liga-wechsel-ok">Einwechseln</button></div>';
    } else if (o.type === 'confirm-reset') {
      var offeneSpiele = sum(S.matches, function (m) { return m.done || m.void ? 0 : 1; });
      var fertige = sum(S.matches, function (m) { return m.done ? 1 : 0; });
      html = '<h3>' + (S.tour && S.tour.liga ? 'Ligaspiel' : 'Turnier') + ' vorzeitig beenden?</h3>' +
        '<p><b>' + plural(fertige, 'gespieltes Spiel', 'gespielte Spiele') + '</b> ' +
        (fertige === 1 ? 'bleibt' : 'bleiben') + ' in Statistik und Rangliste. ' +
        'Die <b>' + plural(offeneSpiele, 'offene Partie', 'offenen Partien') + '</b> ' +
        (offeneSpiele === 1 ? 'entfällt' : 'entfallen') + '.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Nein, weiterspielen</button>' +
        '<button class="btn danger" data-action="ov-reset">Ja, beenden</button></div>';
    } else if (o.type === 'profile') {
      var p = o.draft;
      var isNew = !o.id;
      html = '<h3>' + (isNew ? 'Neuer Spieler' : 'Spieler bearbeiten') + '</h3>' +
        '<div class="avatar-edit" data-action="pick-avatar">' +
          avatarHTML({ id: o.id || 'neu', name: p.name || '?', avatar: p.avatar }, 'xl') +
          '<span class="cam">Foto wählen</span>' +
        '</div>' +
        '<input class="name-input" type="text" data-role="profile-name" value="' + esc(p.name) + '" placeholder="Anzeigename" maxlength="16">' +
        /* Der buergerliche Name steht auf dem Liga-Spielbericht - die SWO
           will Vor- und Nachnamen, keine Kuenstlernamen. Gaeste eines
           Abends brauchen das nicht: Foto aus Spass, Name, Lieblingsdoppel
           - fertig. */
        (isNew || (o.id && profile(o.id).gast)
          ? ''
          : '<div class="namen-titel">Echte Namen f\u00fcr die Liga</div>' +
            '<div class="namen-paar">' +
              '<input class="name-input klein" type="text" data-role="profile-vor" value="' + esc(p.vor || '') + '" ' +
                'placeholder="Vorname" maxlength="30">' +
              '<input class="name-input klein" type="text" data-role="profile-nach" value="' + esc(p.nach || '') + '" ' +
                'placeholder="Nachname" maxlength="30">' +
            '</div>') +
        /* Lieblingsdoppel: der Finish-Vorschlag stellt dann bevorzugt darauf.
           Kein Umweg über einen zusätzlichen Dart – nur die Wahl zwischen
           gleich langen Wegen, siehe js/checkout.js. */
        '<label class="dbl-wahl"><span>Lieblingsdoppel</span>' +
          '<select data-role="profile-double">' + doppelOptionen(p.dbl) + '</select>' +
        '</label>' +
        '<p class="hint">Bei gleich vielen Darts stellt der Finish-Vorschlag auf dieses Doppel. ' +
          'Einen Dart mehr kostet es nie.</p>' +
        (p.avatar ? '<button class="btn ghost full" data-action="clear-avatar">Foto entfernen</button>' : '') +
        '<div class="row-btns two"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="save-profile">Speichern</button></div>' +
        (isNew ? '' : (function () {
          var vor = profile(o.id);
          /* Ein Gast, der nie geworfen hat, hängt an nichts – der lässt sich
             wirklich löschen. Sobald Spiele dranhängen, bleibt nur das
             Ausblenden: sonst stünde im Archiv „Unbekannt". */
          var loeschbar = vor.gast && !letztesSpielAm(o.id);
          var imSpielplan = vor.gast && S.tour &&
            S.matches.some(function (m) { return m.p.indexOf(o.id) >= 0; });
          /* Gaeste lassen sich direkt loeschen: ohne Spiele spurlos, mit
             Spielen verschwinden sie aus allen Listen – die Ergebnisse der
             Mitspieler bleiben unangetastet. Nur mitten im laufenden
             Spielplan geht das nicht. */
          if (imSpielplan) {
            return '<p class="hint">' + esc(vor.name) + ' steht im laufenden Spielplan – ' +
              'löschen geht erst, wenn das Spiel beendet ist.</p>';
          }
          return '<button class="btn danger ghost full" data-action="' +
            (vor.gast ? (loeschbar ? 'delete-profile' : 'delete-guest') : 'hide-profile') + '">' +
            (vor.gast ? 'Gast löschen' : vor.hidden ? 'Wieder einblenden' : 'Spieler ausblenden') + '</button>' +
            '<p class="hint">' + (loeschbar
              ? 'Der Gast hat noch kein Spiel – er verschwindet spurlos.'
              : (vor.gast
                ? 'Der Gast verschwindet sofort aus Aufstellung, Spielerliste und Rangliste. Die gespielten Partien bleiben in der Historie der anderen erhalten.'
                : 'Ausgeblendete Spieler tauchen nicht mehr in der Aufstellung auf, ihre Ergebnisse bleiben aber in Statistik und Rangliste erhalten.')) +
            '</p>';
        })());
    } else if (o.type === 'game-done') {
      /* Am Board laeuft auch das Spielende ueber die Tastatur: die Pfeile
         waehlen zwischen Statistik und Ruecknahme, Enter bestaetigt. */
      var gdWahl = UI.turnier && turnierErlaubt() ? (o.wahl || 0) : -1;
      var gdKl = function (i, sonst) {
        if (gdWahl < 0) return sonst;
        return i === gdWahl ? 'btn primary full wahl' : 'btn ghost full';
      };
      html = '<div class="big-emoji">🏆</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + (S.game ? kindName(S.game.kind) : '') + '</p>' +
        '<button class="' + gdKl(0, 'btn primary full') + '" data-action="open-summary" data-kind="' + (S.game ? S.game.kind : 'cricket') + '" data-id="current">Weiter zur Spielstatistik</button>' +
        '<button class="' + gdKl(1, 'btn ghost full') + '" data-action="undo-game">Letzten Dart zurück</button>' +
        (gdWahl >= 0 ? '<p class="te-hint">↑ ↓ / Tab · wählen &nbsp;&nbsp; Enter · bestätigen</p>' : '');
    } else if (o.type === 'roster-change') {
      var inTour = tourPlayers();
      html = '<h3>Spieler im Turnier</h3>' +
        '<p>Nachzügler bekommen Spiele gegen alle bisherigen Teilnehmer. Wer abgemeldet wird, behält seine gespielten Ergebnisse; seine offenen Spiele entfallen.</p>' +
        '<div class="roster-change">' +
        inTour.map(function (id) {
          var out = !isPlaying(id);
          return '<div class="rc-row">' + avatarHTML(profile(id), 'sm') +
            '<span class="rc-name">' + esc(pname(id)) + '</span>' +
            (out ? '<span class="muted">keine offenen Spiele</span>'
                 : '<button class="btn danger ghost small" data-action="withdraw-player" data-id="' + id + '">Abmelden</button>') +
            '</div>';
        }).join('') +
        activeProfiles().filter(function (p) { return inTour.indexOf(p.id) < 0; }).map(function (p) {
          return '<div class="rc-row">' + avatarHTML(p, 'sm') +
            '<span class="rc-name">' + esc(p.name) + '</span>' +
            '<button class="btn small" data-action="add-player" data-id="' + p.id + '">Nachtragen</button>' +
            '</div>';
        }).join('') +
        '</div>' +
        '<button class="btn primary full" data-action="ov-cancel">Fertig</button>';
    } else if (o.type === 'edit-visit') {
      html = '<h3>Aufnahme korrigieren</h3>' +
        '<p>Eingetragen waren <b>' + o.old + '</b> Punkte für ' + esc(pname(o.pid)) + '.</p>' +
        '<div class="edit-value">' + (o.value === '' ? '–' : o.value) + '</div>' +
        (o.error ? '<p class="edit-error">' + esc(o.error) + '</p>' : '') +
        '<div class="keypad edit-pad">' +
          [1,2,3,4,5,6,7,8,9].map(function (n) { return '<button data-editkey="' + n + '">' + n + '</button>'; }).join('') +
          '<button class="fn" data-editkey="del">←</button>' +
          '<button data-editkey="0">0</button>' +
          '<button class="ok" data-editkey="ok">Übernehmen</button>' +
        '</div>' +
        '<button class="btn ghost full" data-action="ov-cancel">Abbrechen</button>';
    } else if (o.type === 'confirm-new-tournament') {
      html = '<h3>Laufendes Turnier beenden?</h3>' +
        '<p>Im aktuellen Turnier ' + (o.played === 1 ? 'ist bereits 1 Spiel' : 'sind bereits ' + o.played + ' Spiele') +
        ' gespielt. Das Turnier wird gewertet und archiviert, dann beginnt ein neues.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Zurück</button>' +
        '<button class="btn primary" data-action="ov-new-tournament">Neues Turnier</button></div>';
    } else if (o.type === 'need-players') {
      html = '<h3>Zu wenig Spieler</h3><p>' +
        (S.mode === '501'
          ? 'Ein Turnier braucht mindestens zwei Spieler – jeder gegen jeden. '
            + 'Zum Üben allein nimm Cricket, Round the World oder Finisher.'
          : 'Wähle mindestens einen Spieler aus.') + '</p>' +
        '<button class="btn primary full" data-action="ov-cancel">Alles klar</button>';
    }
    $('overlay-card').innerHTML = html;
  }

  /* ================= Aktionen ================= */
  /* ================= Ligaspiel =================
   * Der SDM-Spielberichtsbogen als Spielmodus: 16 Einzel (501 Double Out,
   * Best of 3 oder 5) zwischen unseren vier Positionen und den vier des
   * Gegners. Läuft komplett auf dem Turnier-Unterbau – nur der Spielplan
   * ist vorgegeben statt ausgelost, es wird nicht ausgebullt (das erste
   * Leg beginnt der Heimspieler, danach wechselt der Anwurf, SWO §8), und
   * die Übersicht zeigt den Team-Stand statt einer Einzeltabelle.
   */
  /* Das Uebungs-Ligaspiel: derselbe Aufbau wie ein echtes (16 Einzel,
     Scheiben, Bogen), aber terminId 'uebung' und uebung: true - damit
     zaehlt es nirgends in die Liga-Wertung. Gegner sind entweder vier
     eigene Leute (Team B) oder vier Bots einer Staerke. */
  function uebungStarten() {
    var o = UI.overlay;
    if (!o || o.type !== 'uebung-start') return;
    var d = o.draft;
    var wir = d.wir.slice(0, 4);
    if (wir.length < 4 || wir.some(function (id, i) { return wir.indexOf(id) !== i; })) {
      o.fehler = 'Bitte vier verschiedene Spieler für Team A aufstellen.';
      render(); return;
    }
    var sie, gegnerName;
    if (d.gegner === 'team') {
      sie = d.sie.slice(0, 4);
      var alle = wir.concat(sie);
      if (sie.length < 4 || alle.some(function (id, i) { return alle.indexOf(id) !== i; })) {
        o.fehler = 'Bitte vier verschiedene Spieler für Team B – niemand spielt in beiden Teams.';
        render(); return;
      }
      gegnerName = 'Team B';
    } else {
      /* Bots sind versteckte Gaeste: sie tauchen in keiner Aufstellung,
         Spielerliste oder Rangliste auf und werden je Staerke
         wiederverwendet statt jedes Training neu angelegt. */
      sie = BOT_NAMEN.map(function (nm) {
        var da = null;
        S.profiles.forEach(function (p) {
          if (!da && p.bot === d.gegner && p.name === nm) da = p;
        });
        if (da) return da.id;
        var p = { id: uid(), name: nm, voll: nm, avatar: null, hue: freeHue(), created: Date.now(), gast: true, hidden: true, bot: d.gegner };
        S.profiles.push(p);
        return p.id;
      });
      gegnerName = 'Bots (' + d.gegner + ')';
    }

    if (S.matches.length) archiveTournament();
    if (S.game && S.game.done) archiveGame(S.game);
    S.game = null;
    S.tour = {
      start: 501, bestOf: d.bestOf, players: wir.concat(sie),
      liga: {
        terminId: 'uebung', nr: 0, gegner: gegnerName, heim: true, uebung: true,
        wir: wir, sie: sie,
        heimSpieler: wir.slice(), gastSpieler: sie.slice(),
        posH: wir.slice(0, 4), posG: sie.slice(0, 4),
        ort: 'Bar Sehnsucht', tag: '',
        finish: !!d.finish, zeitVon: Date.now(), zeitBis: null
      }
    };
    S.matches = LIGA_EINZEL.map(function (paar, i) {
      var h = wir[paar[0]], g = sie[paar[1]];
      return {
        id: uid(), round: Math.floor(i / 4) + 1, p: [h, g],
        starter: h, posPaar: paar.slice(),
        scheibe: i % 2 === 0 ? 'S1' : 'S2',
        legs: [], done: false, winner: null, at: null
      };
    });
    S.current = null;
    S.lineup = wir.slice();
    UI.overlay = null;
    S.screen = 'tournament';
    /* Geteilt an zwei Geraeten wie das echte Ligaspiel - nur sinnvoll mit
       zwei echten Teams (Bots werfen auf dem einen Geraet von selbst). */
    if (d.geteilt && d.gegner === 'team' && window.DartSync && window.DartSync.turnier &&
        window.DartKonto && window.DartKonto.nutzer()) {
      var usid = uid();
      var uGaeste = {};
      S.tour.players.forEach(function (id) {
        if (String(id).indexOf('u_') !== 0) uGaeste[id] = pname(id);
      });
      var uPlan = {
        start: S.tour.start, bestOf: S.tour.bestOf, players: S.tour.players.slice(),
        gaeste: uGaeste, liga: S.tour.liga,
        matches: S.matches.map(function (m) {
          return { id: m.id, round: m.round, p: m.p.slice(), starter: m.starter, posPaar: m.posPaar, scheibe: m.scheibe };
        })
      };
      S.tour.geteilt = true;
      S.tour.sid = usid;
      S.tour.cursor = 0;
      var uKonten = S.tour.players.filter(function (id) { return String(id).indexOf('u_') === 0; });
      window.DartSync.turnier.anlegen(usid, uPlan, uKonten).catch(function () {
        S.tour.geteilt = false;
        delete S.tour.sid;
        save(); render();
      });
    }
    save(); render();
  }

  function ligaSpielStarten() {
    var o = UI.overlay;
    if (!o || o.type !== 'liga-start') return;
    var d = o.draft, t = o.termin;

    var wir = d.wir.slice(0, 4);
    var doppelt = wir.some(function (id, i) { return wir.indexOf(id) !== i; });
    if (wir.length < 4 || doppelt) {
      o.fehler = 'Bitte vier verschiedene eigene Spieler aufstellen.';
      render(); return;
    }
    var namen = d.gegner.map(function (n, i) {
      return (String(n || '').trim().slice(0, 30) + ' ' +
        String((d.gegnerNach || [])[i] || '').trim().slice(0, 30)).replace(/\s+/g, ' ').trim();
    });
    if (d.gegner.some(function (n, i) {
      return !String(n || '').trim() || !String((d.gegnerNach || [])[i] || '').trim();
    })) {
      o.fehler = 'Bitte alle vier Gegner mit Vor- und Nachnamen eintragen (SWO: bürgerliche Namen).';
      render(); return;
    }
    /* Zwei gleichnamige Gegner würden auf dasselbe Gastprofil fallen und
       ihre Statistik verschmelzen – lieber gleich unterscheidbar machen. */
    if (namen.some(function (n, i) { return namen.indexOf(n) !== i; })) {
      o.fehler = 'Zwei Gegner heißen gleich – bitte unterscheidbar machen (z. B. Nachname dazu).';
      render(); return;
    }

    var daheim = t.heim === LIGA.team;
    var gegnerTeam = daheim ? t.gast : t.heim;
    /* Die Gegner sind Gäste dieses Geräts. Wer schon einmal gegen uns
       geworfen hat, wird am Namen wiedererkannt – aber nie ein Profil, das
       bereits auf unserer Seite aufgestellt ist (sonst spielte jemand gegen
       sich selbst), und Ausgeblendete kommen zurück ins Licht. */
    var sie = [];
    namen.forEach(function (n) {
      sie.push(ligaGastId(n, wir.concat(sie)));
    });

    if (S.matches.length) archiveTournament();
    if (S.game && S.game.done) archiveGame(S.game);
    S.game = null;
    /* heimSpieler/gastSpieler sind die Bogen-Listen H1–H8 bzw. G1–G8 (erst
       die vier Startpositionen, Wechselspieler kommen hinten dazu).
       posH/posG ist die AKTUELLE Besetzung der vier Positionen. */
    var heimListe = daheim ? wir.slice() : sie.slice();
    var gastListe = daheim ? sie.slice() : wir.slice();
    S.tour = {
      start: 501, bestOf: d.bestOf, players: wir.concat(sie),
      liga: {
        terminId: t.id, nr: t.nr, gegner: gegnerTeam, heim: daheim,
        wir: wir, sie: sie,
        heimSpieler: heimListe, gastSpieler: gastListe,
        posH: heimListe.slice(0, 4), posG: gastListe.slice(0, 4),
        ort: t.ort || '', tag: t.tag || '',
        finish: !!d.finish, zeitVon: Date.now(), zeitBis: null
      }
    };
    S.matches = LIGA_EINZEL.map(function (paar, i) {
      var h = heimListe[paar[0]], g = gastListe[paar[1]];
      return {
        id: uid(), round: Math.floor(i / 4) + 1, p: [h, g],
        /* Kein Ausbullen im Ligaspiel: der Heimspieler wirft das erste Leg
           an, jedes weitere Leg wechselt (macht ensureLeg von selbst). */
        starter: h,
        /* Welche Bogen-Positionen hier spielen und auf welcher Scheibe die
           Partie im Doppelbetrieb läuft (zwei nebeneinander je Durchgang). */
        posPaar: paar.slice(),
        scheibe: i % 2 === 0 ? 'S1' : 'S2',
        legs: [], done: false, winner: null, at: null
      };
    });
    S.current = null;
    S.lineup = wir.slice();
    UI.overlay = null;
    S.screen = 'tournament';

    /* Geteilt wie beim Turnier: zwei iPads schreiben – die SWO will ohnehin
       zwei Boards. Der Plan trägt die Liga-Daten und die Anwerfer mit. */
    if (d.geteilt && window.DartSync && window.DartSync.turnier &&
        window.DartKonto && window.DartKonto.nutzer()) {
      var sid = uid();
      var gaeste = {};
      S.tour.players.forEach(function (id) {
        if (String(id).indexOf('u_') !== 0) gaeste[id] = pname(id);
      });
      var plan = {
        start: S.tour.start, bestOf: S.tour.bestOf, players: S.tour.players.slice(),
        gaeste: gaeste, liga: S.tour.liga,
        matches: S.matches.map(function (m) {
          return { id: m.id, round: m.round, p: m.p.slice(), starter: m.starter, posPaar: m.posPaar, scheibe: m.scheibe };
        })
      };
      S.tour.geteilt = true;
      S.tour.sid = sid;
      S.tour.cursor = 0;
      var konten = S.tour.players.filter(function (id) { return String(id).indexOf('u_') === 0; });
      window.DartSync.turnier.anlegen(sid, plan, konten).catch(function () {
        S.tour.geteilt = false;
        delete S.tour.sid;
        save(); render();
      });
    }
    save();
    render();
  }

  /* Gegner-Gast finden oder anlegen: Wiederverwendung per Namensgleichheit,
     aber nie ein Profil, das schon im Spiel steht – und Ausgeblendete
     kommen zurück ins Licht. */
  function ligaGastId(name, ausschluss) {
    var da = null;
    S.profiles.forEach(function (p) {
      if (!da && p.gast && (p.name === name || p.voll === name) && ausschluss.indexOf(p.id) < 0) da = p;
    });
    if (da) {
      da.hidden = false;
      if (!da.voll) da.voll = name;
      return da.id;
    }
    /* Gegner werden mit vollem buergerlichen Namen gefuehrt - so verlangt
       es die SWO fuer den Bogen, und so sind sie eindeutig wiedererkennbar. */
    var neu = { id: uid(), name: name.slice(0, 30), voll: name, avatar: null, hue: freeHue(), created: Date.now(), gast: true };
    S.profiles.push(neu);
    return neu.id;
  }

  /* ---------- Bots fuers Uebungs-Ligaspiel ----------
   * Drei Staerken, modelliert ueber Aufnahme-Mittelwert und eine
   * Checkout-Wahrscheinlichkeit je Besuch. Bots busten nie - sie stellen
   * sich, wie es ein besonnener Spieler auch taete. */
  var BOT_STAERKEN = {
    leicht:  { mittel: 38, streuung: 13, finish: 0.12, finishNah: 0.30 },
    mittel:  { mittel: 52, streuung: 15, finish: 0.22, finishNah: 0.45 },
    schwer:  { mittel: 72, streuung: 18, finish: 0.38, finishNah: 0.62 }
  };
  var BOT_NAMEN = ['Robo Rita', 'Blechbert', 'Dart Vader', 'C-3-Pfeil'];

  function botWurfNormal(mittel, streuung) {
    // Box-Muller reicht fuer Trainingszwecke voellig.
    var u1 = Math.random() || 0.0001, u2 = Math.random();
    return Math.round(mittel + streuung * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }

  /* Ein gueltiger Aufnahmewert: 0..180, kein unmoeglicher Wert, kein Bust
     (hoechstens rest-2 stehen lassen oder exakt finishen). */
  function botAufnahme(rest, staerke) {
    var s = BOT_STAERKEN[staerke] || BOT_STAERKEN.mittel;
    // Finish-Versuch, wenn einer moeglich ist.
    if (rest <= 170 && Checkout.possible(rest, 3)) {
      var p = rest <= 50 ? s.finishNah : s.finish;
      if (Math.random() < p) {
        var darts = 3;
        for (var nd = 1; nd <= 3; nd++) { if (Checkout.possible(rest, nd)) { darts = nd; break; } }
        return { score: rest, darts: darts, checkout: true };
      }
      // Kein Finish: auf ein schoenes Doppel stellen.
      var ziele = [40, 32, 36, 24, 20, 16];
      var ziel = ziele[Math.floor(Math.random() * ziele.length)] + Math.round((Math.random() - 0.5) * 8);
      var stell = rest - Math.max(2, ziel);
      if (stell < 0) stell = 0;
      if (stell > rest - 2) stell = Math.max(0, rest - 2);
      while (stell > 0 && IMPOSSIBLE[stell]) stell--;
      return { score: stell, darts: 3, checkout: false };
    }
    // Scoring: Normalverteilung, gedeckelt, nie in den Bust.
    var wert = botWurfNormal(s.mittel, s.streuung);
    if (wert < 0) wert = 0;
    if (wert > 180) wert = 180;
    if (wert > rest - 2) wert = Math.max(0, rest - 50);
    while (wert > 0 && IMPOSSIBLE[wert]) wert--;
    return { score: wert, darts: 3, checkout: false };
  }

  /* Der Takt: ist im laufenden Einzel ein Bot am Wurf, wirft er nach einer
     kurzen Denkpause von selbst. Geplant wird nach jedem render() - der
     Timer prueft vor dem Wurf, ob die Lage noch dieselbe ist. */
  var botTimer = null;
  function planeBotZug() {
    if (botTimer) return;
    var m = currentMatch();
    if (!m || m.done || S.screen !== 'game' || UI.overlay) return;
    var leg = activeLeg(m);
    if (!leg) return;
    var pid = activePlayer(leg, m);
    var prof = profile(pid);
    if (!prof.bot) return;
    /* Bots werfen ausschliesslich im Uebungsspiel - sollte je einer in
       einem echten Spiel landen, bleibt er stumm. */
    if (!(S.tour && S.tour.liga && S.tour.liga.uebung)) return;
    var kennung = m.id + ':' + leg.visits.length;
    botTimer = setTimeout(function () {
      botTimer = null;
      var m2 = currentMatch();
      if (!m2 || m2.id !== m.id || m2.done || S.screen !== 'game' || UI.overlay) return;
      var leg2 = activeLeg(m2);
      if (!leg2 || m2.id + ':' + leg2.visits.length !== kennung) return;
      var pid2 = activePlayer(leg2, m2);
      if (!profile(pid2).bot) return;
      var rest = remainingIn(leg2, pid2);
      var wurf = botAufnahme(rest, profile(pid2).bot);
      commitVisit(wurf.score, wurf.darts, wurf.checkout, false);
    }, 1200);
  }

  /* ---------- Spielerwechsel im Ligaspiel ----------
   * SWO: Gewechselt wird nur auf derselben Position; wer auf einer Position
   * gespielt hat, darf nur dort wieder eingesetzt werden; je Team höchstens
   * 8 Spieler. Der Wechsel greift für alle noch nicht begonnenen Einzel der
   * Position – Gespieltes bleibt beim alten Spieler. */

  function ligaGespieltePos(pid, seite) {
    var idx = seite === 'H' ? 0 : 1;
    var posn = [];
    S.matches.forEach(function (m) {
      if (!m.posPaar) return;
      var begonnen = m.done || m.legs.some(function (l) { return l.visits.length > 0; });
      if (!begonnen) return;
      if (m.p[idx] === pid && posn.indexOf(m.posPaar[idx]) < 0) posn.push(m.posPaar[idx]);
    });
    return posn;
  }

  function ligaWechseln(seite, pos, neueId) {
    var lg = S.tour && S.tour.liga;
    if (!lg) return 'Kein Ligaspiel.';
    /* Im geteilten Spiel kennt das andere Gerät nur den alten Plan und
       würde das Einzel mit dem alten Spieler mitschreiben – die Stände
       liefen auseinander. Bis der Plan-Abgleich das kann: gesperrt. */
    if (geteiltesTurnier()) {
      return 'Im geteilten Ligaspiel geht der Wechsel noch nicht – bitte auf einem Gerät spielen.';
    }
    var posListe = seite === 'H' ? lg.posH : lg.posG;
    var teamListe = seite === 'H' ? lg.heimSpieler : lg.gastSpieler;
    if (posListe[pos] === neueId) return null;
    /* Niemand steht auf zwei Positionen – und schon gar nicht auf beiden
       Seiten des Bogens. */
    if (lg.posH.indexOf(neueId) >= 0 || lg.posG.indexOf(neueId) >= 0) {
      return 'Dieser Spieler steht schon auf einer Position.';
    }
    var andereListe = seite === 'H' ? lg.gastSpieler : lg.heimSpieler;
    if (andereListe.indexOf(neueId) >= 0) {
      return 'Dieser Spieler gehört zum anderen Team.';
    }
    var gespielt = ligaGespieltePos(neueId, seite);
    if (gespielt.length && gespielt.indexOf(pos) < 0) {
      return 'Laut SWO darf ein Spieler nur auf seiner bisherigen Position (' +
        (gespielt[0] + 1) + ') wieder eingewechselt werden.';
    }
    if (teamListe.indexOf(neueId) < 0) {
      if (teamListe.length >= 8) return 'Mehr als 8 Spieler je Team lässt die SWO nicht zu.';
      teamListe.push(neueId);
    }
    posListe[pos] = neueId;
    if (S.tour.players.indexOf(neueId) < 0) S.tour.players.push(neueId);
    var unsereSeite = lg.heim ? 'H' : 'G';
    if (seite === unsereSeite) {
      if (lg.wir.indexOf(neueId) < 0) lg.wir.push(neueId);
    } else if (lg.sie.indexOf(neueId) < 0) {
      lg.sie.push(neueId);
    }
    var idx = seite === 'H' ? 0 : 1;
    S.matches.forEach(function (m) {
      if (!m.posPaar || m.posPaar[idx] !== pos) return;
      var begonnen = m.done || m.legs.some(function (l) { return l.visits.length > 0; });
      if (begonnen) return;
      m.p[idx] = neueId;
      if (idx === 0) m.starter = neueId;   // der Heimspieler wirft an
    });
    save();
    return null;
  }

  function startTournament(confirmed) {
    if (S.lineup.length < 2) { UI.overlay = { type: 'need-players' }; render(); return; }
    // Ein Turnier mit Ergebnissen wird nie kommentarlos ersetzt.
    var played = sum(S.matches, function (m) { return m.done ? 1 : 0; });
    if (played > 0 && !confirmed) {
      UI.overlay = { type: 'confirm-new-tournament', played: played };
      render();
      return;
    }
    if (S.matches.length) archiveTournament();
    UI.turnier = false;
    S.tour = { start: S.settings.start, bestOf: S.settings.bestOf, players: S.lineup.slice() };
    S.matches = buildSchedule(S.lineup.slice());
    S.current = null;
    S.screen = 'tournament';

    /* Geteilt: der Spielplan geht zum Server, damit die anderen einsteigen
       koennen. Klappt das nicht, laeuft das Turnier eben nur hier -- besser
       als gar nicht zu starten, weil das WLAN gerade hakt. */
    if (S.settings.turnierGeteilt === 1 && window.DartSync && window.DartSync.turnier &&
        window.DartKonto && window.DartKonto.nutzer()) {
      var sid = uid();
      /* Gastspieler gibt es nur auf diesem Geraet. Ohne ihre Namen im Plan
         staende beim Kollegen ueberall "Unbekannt" -- ihre Kennung sagt ihm
         ja nichts. */
      var gaeste = {};
      S.tour.players.forEach(function (id) {
        if (String(id).indexOf('u_') !== 0) gaeste[id] = pname(id);
      });
      var plan = {
        start: S.tour.start, bestOf: S.tour.bestOf, players: S.tour.players.slice(),
        gaeste: gaeste,
        matches: S.matches.map(function (m) { return { id: m.id, round: m.round, p: m.p.slice() }; })
      };
      S.tour.geteilt = true;
      S.tour.sid = sid;
      S.tour.cursor = 0;
      var konten = S.tour.players.filter(function (id) { return String(id).indexOf('u_') === 0; });
      window.DartSync.turnier.anlegen(sid, plan, konten).catch(function () {
        S.tour.geteilt = false;
        delete S.tour.sid;
        save(); render();
      });
    }
    save();
    render();
  }

  function openMatch(id) {
    var m = matchById(id);
    if (!m) return;

    /*
     * Im geteilten Turnier wird die Partie erst beim Server beansprucht.
     * Erst danach geht es aufs Feld – sonst schreiben an zwei Scheiben zwei
     * Leute dieselbe Partie mit und eine der beiden Fassungen ist am Ende
     * für nichts gewesen.
     */
    if (geteiltesTurnier() && window.DartSync && window.DartSync.turnier) {
      UI.overlay = { type: 'warte', text: 'Partie wird übernommen …' };
      render();
      window.DartSync.turnier.beanspruchen(id).then(function () {
        UI.overlay = null;
        oeffneJetzt(id);
      }).catch(function (e) {
        UI.overlay = { type: 'hinweis', text: e && e.message ? e.message : 'Das hat nicht geklappt.' };
        render();
      });
      return;
    }
    oeffneJetzt(id);
  }

  function oeffneJetzt(id) {
    var m = matchById(id);
    if (!m) { render(); return; }
    S.current = id;
    UI.input = ''; UI.darts = []; UI.mult = 1; UI.modeOverride = null; UI.error = ''; UI.overlay = null;
    UI.bullWahl = 0;
    /* Am Board-iPad (Turnier-Modus gemerkt) startet jedes Liga-Einzel
       direkt in der Riesenanzeige. In normalen Turnieren bleibt einfach
       an, was der Spieler zuletzt gewaehlt hat. */
    if (S.tour && S.tour.liga) UI.turnier = S.settings.turnierModus === 1;
    S.screen = m.starter ? 'game' : 'bulloff';
    save();
    render();
  }

  /* Zurück aus einer Partie, in der noch nichts steht: Anspruch zurückgeben,
     damit sie nicht bis zum Ablauf der Frist für alle blockiert ist. */
  function partieVerlassen() {
    var t = geteiltesTurnier();
    if (!t || !S.current || !window.DartSync || !window.DartSync.turnier) return;
    var m = matchById(S.current);
    if (!m || m.done) return;
    var geworfen = m.legs.some(function (l) { return l.visits.length > 0; });
    if (geworfen) return;                     // angefangen bleibt beansprucht
    window.DartSync.turnier.freigeben(m.id);
  }

  /* Nach diesen Tipps erscheint sofort ein Spielfeld unter dem Finger –
     ein nachrutschender zweiter Tipp darf dort kein Wurf werden. */
  var SETTLE_ACTIONS = { 'restart-game': 1, 'ov-next-leg': 1, 'co-darts': 1 };

  function handleAction(action, el) {
    var screenBefore = S.screen;
    if (SETTLE_ACTIONS[action]) settleUntil = Date.now() + 150;
    handleActionInner(action, el);
    // Neuer Bildschirm unter dem Finger: einen nachrutschenden Doppeltipp
    // abfangen, bewusste Eingaben aber sofort wieder annehmen.
    if (S.screen !== screenBefore) armGhostTapGuard();
  }

  function handleActionInner(action, el) {
    /* Alles rund ums Konto gehört der Online-Schicht (js/auth.js). Fehlt sie,
       gibt es auch keine Knöpfe, die das auslösen könnten. */
    if (action.indexOf('konto-') === 0) {
      if (window.DartKonto) window.DartKonto.aktion(action, el);
      return;
    }
    switch (action) {
      case 'nav': {
        var target = el.getAttribute('data-screen');
        // Ein laufendes Spiel führt zurück aufs Board; ein beendetes, noch
        // nicht gespeichertes zeigt sich im Setup als Hinweis-Box.
        if (target === 'setup' && S.game && !S.game.done) target = S.game.kind;
        else if (target === 'setup' && S.matches.length) target = 'tournament';
        S.screen = target;
        save(); render();
        break;
      }
      case 'toggle-lineup': {
        var id = el.getAttribute('data-id');
        var i = S.lineup.indexOf(id);
        if (i >= 0) S.lineup.splice(i, 1);
        else if (S.lineup.length < 12) S.lineup.push(id);
        save(); render();
        break;
      }
      case 'new-profile':
        UI.overlay = { type: 'profile', id: null, draft: { name: '', avatar: null, dbl: null, vor: '', nach: '' } };
        render();
        break;
      case 'edit-profile': {
        var p = profile(el.getAttribute('data-id'));
        var pTeile = vollSplit(p.voll);
        UI.overlay = { type: 'profile', id: p.id, draft: { name: p.name, avatar: p.avatar, dbl: p.dbl || null, vor: pTeile.vor, nach: pTeile.nach } };
        render();
        break;
      }
      case 'edit-current-profile': {
        var cp = profile(UI.profile);
        var cpTeile = vollSplit(cp.voll);
        UI.overlay = { type: 'profile', id: cp.id, draft: { name: cp.name, avatar: cp.avatar, dbl: cp.dbl || null, vor: cpTeile.vor, nach: cpTeile.nach } };
        render();
        break;
      }
      case 'pick-avatar':
        $('avatar-input').click();
        break;
      case 'clear-avatar':
        UI.overlay.draft.avatar = null;
        render();
        break;
      case 'save-profile': {
        var draft = UI.overlay.draft;
        var name = (draft.name || '').trim();
        if (!name) name = 'Spieler ' + (S.profiles.length + 1);
        if (UI.overlay.id) {
          var ex = profile(UI.overlay.id);
          ex.name = name;
          ex.avatar = draft.avatar;
          ex.dbl = draft.dbl || null;
          /* Der Gast-Dialog fragt keine Liga-Namen ab - dann bleibt, was
             da ist (z. B. der Name aus einer Ligaspiel-Aufstellung). */
          if (draft.vor !== undefined || draft.nach !== undefined) {
            ex.voll = vollAusTeilen(draft.vor, draft.nach) || ex.voll || null;
          }
          /* Gehört das Profil zu einem Account, muss die Änderung zum Server –
             sonst überschreibt der nächste Abgleich Bild und Name wieder mit
             dem, was dort steht. */
          if (window.DartKonto) window.DartKonto.profilGeaendert(ex.id);
        } else {
          var np = { id: uid(), name: name, avatar: draft.avatar, created: Date.now(), hue: freeHue(), dbl: draft.dbl || null, voll: vollAusTeilen(draft.vor, draft.nach) };
          /* Angemeldet legt man hier keine Kollegen an – die haben Accounts.
             Wer von Hand dazukommt, ist der Besuch von heute Abend. */
          if (window.DartKonto && window.DartKonto.nutzer()) np.gast = true;
          S.profiles.push(np);
          if (S.lineup.length < 12) S.lineup.push(np.id);
        }
        UI.overlay = null;
        save(); render();
        break;
      }
      /* Nur für Gäste ohne ein einziges Spiel – alles andere hinge an
         Archiv-Einträgen, die dann ins Leere zeigen würden. */
      case 'delete-profile': {
        var dp = profile(UI.overlay.id);
        if (!dp.gast || letztesSpielAm(dp.id)) return;
        S.profiles = S.profiles.filter(function (x) { return x.id !== dp.id; });
        S.lineup = S.lineup.filter(function (x) { return x !== dp.id; });
        UI.overlay = null;
        if (S.screen === 'profile' && UI.profile === dp.id) S.screen = 'players';
        save(); render();
        break;
      }
      /* Gast mit Spielen: kein hartes Loeschen (die Archiv-Eintraege zeigen
         auf seine Id), aber er verschwindet komplett aus der Oberflaeche. */
      case 'delete-guest': {
        var dg = profile(UI.overlay.id);
        if (!dg.gast) return;
        /* Steht der Gast im laufenden Spielplan, wuerde das Loeschen offene
           Einzel verwaisen lassen - erst das Turnier beenden. */
        if (S.tour && S.matches.some(function (m) { return m.p.indexOf(dg.id) >= 0; })) return;
        dg.hidden = true;
        S.lineup = S.lineup.filter(function (x) { return x !== dg.id; });
        UI.overlay = null;
        if (S.screen === 'profile' && UI.profile === dg.id) S.screen = 'players';
        save(); render();
        break;
      }
      case 'hide-profile': {
        var hp = profile(UI.overlay.id);
        hp.hidden = !hp.hidden;
        if (hp.hidden) {
          var li = S.lineup.indexOf(hp.id);
          if (li >= 0) S.lineup.splice(li, 1);
        }
        UI.overlay = null;
        save(); render();
        break;
      }
      case 'open-profile':
        UI.profile = el.getAttribute('data-id');
        S.screen = 'profile';
        save(); render();
        break;
      case 'open-summary':
        UI.summary = { kind: el.getAttribute('data-kind'), id: el.getAttribute('data-id'), from: S.screen };
        UI.overlay = null;
        S.screen = 'summary';
        save(); render();
        break;
      case 'reopen-match': {
        var rid = el.getAttribute('data-id');
        if (!matchById(rid)) return;
        S.current = rid;
        UI.summary = null;
        S.screen = 'game';
        undo();          // hebt das Finish auf und öffnet das Match wieder
        break;
      }
      case 'summary-back': {
        var from = UI.summary && UI.summary.from;
        UI.summary = null;
        S.screen = from === 'boards' || from === 'players' ? from
          : S.game && !S.game.done ? S.game.kind
          : S.matches.length ? 'tournament' : 'boards';
        save(); render();
        break;
      }
      case 'board':
        UI.board = el.getAttribute('data-key');
        render();
        break;
      case 'board-mode':
        UI.boardMode = el.getAttribute('data-value');
        UI.board = boardsFor(UI.boardMode)[0].key;
        render();
        break;
      case 'set-mode':
        S.mode = el.getAttribute('data-value');
        save(); render();
        break;
      case 'start-game':
        if (S.mode === '501') startTournament();
        else startGame(S.mode);
        break;
      case 'leave-game':
        if (S.game && S.game.done) finishGame();
        else { S.screen = 'setup'; UI.overlay = null; save(); render(); }
        break;
      /* Einem geteilten Turnier beitreten. Ein eigenes laufendes Turnier
         wird vorher archiviert – wie beim Start eines neuen auch. */
      case 'turnier-beitreten': {
        var bid = el.getAttribute('data-id');
        var eintrag = null;
        beitretbare.forEach(function (t) { if (t.id === bid) eintrag = t; });
        if (!eintrag) return;
        var gespielt = sum(S.matches, function (m) { return m.done ? 1 : 0; });
        if (gespielt > 0 && !UI.beitrittBestaetigt) {
          UI.overlay = { type: 'confirm-beitreten', played: gespielt, id: bid };
          render();
          return;
        }
        UI.beitrittBestaetigt = false;
        turnierBeitreten(eintrag);
        break;
      }
      case 'ov-beitreten': {
        UI.beitrittBestaetigt = true;
        var oid = UI.overlay && UI.overlay.id;
        UI.overlay = null;
        handleActionInner('turnier-beitreten', { getAttribute: function () { return oid; } });
        break;
      }
      case 'ov-hinweis-zu':
        UI.overlay = null;
        render();
        break;
      case 'rtw-stechen': {
        var rsg = S.game;
        if (!rsg || rsg.kind !== 'rtw' || rsg.done) return;
        var wer = el.getAttribute('data-id');
        var rss = rtwState(rsg);
        // Nur wer wirklich gleichauf ist, kann das Stechen gewinnen.
        if (!rss.stechen || rss.stechen.indexOf(wer) < 0) return;
        rsg.stechenSieger = wer;
        rsg.done = true; rsg.winner = wer; rsg.at = Date.now();
        UI.overlay = { type: 'game-done', pid: wer };
        save(); render();
        break;
      }
      case 'fin-stechen': {
        var fg = S.game;
        if (fg && fg.kind === 'finisher') { finisherRundeAn(fg, el.getAttribute('data-id')); save(); render(); }
        break;
      }
      case 'undo-game':
        undoGame();
        break;
      case 'finish-game':
        finishGame();
        break;
      case 'restart-game': {
        var kind = S.game ? S.game.kind : S.mode;
        finishGame();
        startGame(kind);
        break;
      }
      case 'resume':
        if (S.game && S.game.done) {
          UI.summary = { kind: S.game.kind, id: 'current' };
          S.screen = 'summary';
        } else {
          S.screen = S.game ? spielScreen(S.game.kind) : 'tournament';
        }
        save(); render();
        break;
      case 'to-setup':
        S.screen = 'setup'; save(); render();
        break;
      case 'to-tournament':
        // Aus dem Bull-Off eines Trainingsspiels führt der Weg ins Setup zurück.
        if (S.game && !S.game.started) { S.game = null; S.screen = 'setup'; }
        // Ein Schnelles Spiel gehört zu keinem Spielplan – zurück ins Setup,
        // das laufende Spiel bleibt in der Fortsetzen-Box stehen.
        else if (S.game && S.game.kind === 'quick') S.screen = 'setup';
        else { partieVerlassen(); S.screen = 'tournament'; }
        UI.overlay = null; save(); render();
        break;
      case 'to-winner':
        S.screen = 'winner'; save(); render();
        break;
      case 'finish-tournament':
        archiveTournament();
        S.screen = 'setup';
        save(); render();
        break;
      case 'open-match':
        openMatch(el.getAttribute('data-id'));
        break;
      case 'pick-starter': {
        var pid2 = el.getAttribute('data-id');
        if (S.game && !S.game.started) {
          // Reihenfolge so drehen, dass der Bull-Sieger anfängt.
          var idx2 = S.game.players.indexOf(pid2);
          if (idx2 > 0) S.game.players = S.game.players.slice(idx2).concat(S.game.players.slice(0, idx2));
          /* Das Schnelle Spiel läuft über die Match-Felder p und starter, die
             beim Anlegen kopiert wurden – ohne diesen Abgleich bliebe der
             Bull-Sieger folgenlos und es begänne weiter der Erste der Liste. */
          if (S.game.kind === 'quick') {
            S.game.p = S.game.players.slice();
            S.game.starter = S.game.players[0];
          }
          S.game.started = true;
          S.screen = spielScreen(S.game.kind);
          save(); render();
          break;
        }
        var m = currentMatch();
        if (!m) return;
        m.starter = pid2;
        S.screen = 'game';
        save(); render();
        break;
      }
      case 'end-cricket-visit': {
        var cg = S.game;
        if (!cg || cg.kind !== 'cricket' || cg.done || settling()) return;
        pomp();
        var need = 3 - (cg.throws.length % 3);
        for (var ci = 0; ci < need; ci++) cg.throws.push({ n: 0, m: 0 });
        UI.mult = 1;
        save(); render();
        break;
      }
      /* Round the World: die restlichen Darts der Aufnahme sind daneben.
         Anders als bei Cricket zählt hier nicht die Zahl der Würfe modulo 3 –
         eine Aufnahme endet auch vorzeitig, wenn jemand den Bull trifft.
         Deshalb kommt die Zahl der schon geworfenen Darts aus dem Zustand. */
      case 'end-rtw-visit': {
        var rwg = S.game;
        if (!rwg || rwg.kind !== 'rtw' || rwg.done || settling()) return;
        var offen = 3 - rtwState(rwg).inVisit;
        for (var ri = 0; ri < offen; ri++) rwg.throws.push({ n: 0, m: 0 });
        UI.mult = 1;
        save(); render();
        break;
      }
      /* Finisher: die restlichen Darts der Aufnahme als Fehlwürfe auffüllen –
         dasselbe Abkürzen wie im X01 und im Cricket. */
      case 'fin-end-visit': {
        var fg = S.game;
        if (!fg || fg.kind !== 'finisher' || fg.done || settling()) return;
        var frd = finisherRunde(fg);
        if (frd.stechen) return;
        pomp();
        var offenFin = 3 - finisherState(fg).inVisit;
        for (var fi = 0; fi < offenFin; fi++) frd.throws.push({ n: 0, m: 0 });
        UI.mult = 1;
        pruefeFinisherRunde(fg);
        save(); render();
        break;
      }
      /* Ausbullen ab drei Spielern: antippen reiht ein, der Letzte rueckt
         von selbst nach (ihn anzutippen waere ein Tipp ohne Entscheidung).
         Ein Tipp rechts nimmt einen wieder heraus. */
      case 'order-pick': {
        var opG = S.game;
        if (!opG || opG.started) return;
        var opId = el.getAttribute('data-id');
        if (!UI.bullReihe) UI.bullReihe = [];
        if (UI.bullReihe.indexOf(opId) >= 0) return;
        UI.bullReihe.push(opId);
        var opRest = opG.players.filter(function (id) { return UI.bullReihe.indexOf(id) < 0; });
        if (opRest.length === 1) UI.bullReihe.push(opRest[0]);
        render();
        break;
      }
      case 'order-unpick': {
        var ouId = el.getAttribute('data-id');
        if (!UI.bullReihe) return;
        UI.bullReihe = UI.bullReihe.filter(function (id) { return id !== ouId; });
        render();
        break;
      }
      case 'start-order': {
        var sg = S.game;
        if (!sg || sg.started) return;
        if (!UI.bullReihe || UI.bullReihe.length !== sg.players.length) return;
        sg.players = UI.bullReihe.slice();
        // Siehe pick-starter: die sortierte Reihenfolge muss ins Match.
        if (sg.kind === 'quick') {
          sg.p = sg.players.slice();
          sg.starter = sg.players[0];
        }
        sg.started = true;
        S.screen = spielScreen(sg.kind);
        save(); render();
        break;
      }
      case 'undo':
        undo();
        break;
      case 'liga-ical':
        // Ohne data-id: alle Termine. Mit: nur dieser eine Spieltag.
        ligaKalender(el.getAttribute('data-id') || null);
        break;
      case 'liga-tab':
        UI.ligaTab = el.getAttribute('data-tab');
        render();
        break;
      case 'liga-spiel': {
        /* Ein laufendes Turnier oder Spiel wird nicht kommentarlos ersetzt –
           ein fertiges, nur noch nicht gespeichertes darf aber weichen, das
           archiviert ligaSpielStarten() von selbst. */
        if ((S.game && !S.game.done) || (S.matches.length && !allMatchesDone())) {
          UI.overlay = { type: 'hinweis', text: 'Es läuft noch ein Spiel oder Turnier – bitte erst abschließen oder beenden.' };
          render();
          break;
        }
        var lsTermin = null;
        LIGA.termine.forEach(function (t) { if (t.id === el.getAttribute('data-id')) lsTermin = t; });
        if (!lsTermin || !lsTermin.tag) break;
        /* Aufstellung vorbelegen: erst die Zusagen des Spieltags, dann die
           übrigen Profile, bis vier Positionen stehen. Nur aktive Profile –
           eine versteckte Kennung stünde sonst unsichtbar im Entwurf, während
           die Auswahl einen ganz anderen Namen anzeigt. */
        var lsAktive = activeProfiles();
        var lsVorschlag = ((ligaZusagen && ligaZusagen[lsTermin.id]) || [])
          .filter(function (p) { return (p.status || 'dabei') === 'dabei'; })
          .map(function (p) { return p.id; })
          .filter(function (id) { return lsAktive.some(function (p) { return p.id === id; }); });
        lsAktive.forEach(function (p) {
          if (lsVorschlag.length < 4 && lsVorschlag.indexOf(p.id) < 0) lsVorschlag.push(p.id);
        });
        UI.overlay = {
          type: 'liga-start', termin: lsTermin,
          /* Best of 3 (unsere 4. Liga) und ohne Finish-Hilfen (WDF 3.08:
             das Doppel wird nicht angesagt) sind die Voreinstellung. */
          draft: { bestOf: 3, wir: lsVorschlag.slice(0, 4), gegner: ['', '', '', ''], gegnerNach: ['', '', '', ''], geteilt: false, finish: false }
        };
        render();
        break;
      }
      case 'liga-bestof':
        if (UI.overlay && (UI.overlay.type === 'liga-start' || UI.overlay.type === 'uebung-start')) {
          UI.overlay.draft.bestOf = Number(el.getAttribute('data-value'));
          render();
        }
        break;
      case 'liga-geteilt':
        if (UI.overlay && (UI.overlay.type === 'liga-start' || UI.overlay.type === 'uebung-start')) {
          UI.overlay.draft.geteilt = el.getAttribute('data-value') === '1';
          render();
        }
        break;
      case 'liga-finish':
        if (UI.overlay && (UI.overlay.type === 'liga-start' || UI.overlay.type === 'uebung-start')) {
          UI.overlay.draft.finish = el.getAttribute('data-value') === '1';
          render();
        }
        break;
      case 'liga-los':
        ligaSpielStarten();
        break;
      case 'uebung-start': {
        /* Aufstellung vorbelegen: erst die DiensDarts-Zusagen, dann der
           Rest der aktiven Profile - Team B bekommt die naechsten vier. */
        var utAktive = activeProfiles().filter(function (p) { return !p.bot; });
        var utTid = trainingsTerminId(naechsterDienstag());
        var utVorschlag = ((ligaZusagen && ligaZusagen[utTid]) || [])
          .filter(function (a) { return (a.status || 'dabei') === 'dabei'; })
          .map(function (a) { return a.id; })
          .filter(function (id) { return utAktive.some(function (p) { return p.id === id; }); });
        utAktive.forEach(function (p) {
          if (utVorschlag.indexOf(p.id) < 0) utVorschlag.push(p.id);
        });
        while (utVorschlag.length < 8) utVorschlag.push(utAktive.length ? utAktive[utVorschlag.length % utAktive.length].id : null);
        UI.overlay = {
          type: 'uebung-start',
          draft: {
            gegner: 'mittel', bestOf: 3, finish: true, geteilt: false,
            wir: utVorschlag.slice(0, 4),
            sie: utVorschlag.slice(4, 8)
          }
        };
        render();
        break;
      }
      case 'uebung-gegner':
        if (UI.overlay && UI.overlay.type === 'uebung-start') {
          UI.overlay.draft.gegner = el.getAttribute('data-value');
          /* Geteilt braucht zwei echte Teams - Bots werfen auf dem einen
             Geraet von selbst. */
          if (UI.overlay.draft.gegner !== 'team') UI.overlay.draft.geteilt = false;
          render();
        }
        break;
      case 'uebung-los':
        uebungStarten();
        break;
      case 'kasse-art': {
        /* Die Wahl lebt in UI, nicht nur im DOM - ein Hintergrund-Render
           darf sie nicht auf Einzahlung zuruecksetzen. */
        UI.kasseArt = el.getAttribute('data-value');
        document.querySelectorAll('#kasse-art button').forEach(function (b) {
          b.classList.toggle('active', b === el);
        });
        break;
      }
      case 'kasse-buchen': {
        if (!(window.DartSync && window.DartSync.kasse)) break;
        var kbRoh = String(($('kasse-betrag') || {}).value || '').trim();
        /* Deutsche Schreibweisen: 1.250 und 1.234,56 sind Tausenderpunkte,
           12,50 ist ein Komma-Betrag - nichts davon darf still schrumpfen. */
        if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(kbRoh)) kbRoh = kbRoh.replace(/\./g, '').replace(',', '.');
        else kbRoh = kbRoh.replace(',', '.');
        var kbEuro = parseFloat(kbRoh);
        var kbText = String(($('kasse-text') || {}).value || '').trim();
        var kbMeld = $('kasse-meldung');
        if (!isFinite(kbEuro) || kbEuro <= 0) { if (kbMeld) kbMeld.textContent = 'Bitte einen Betrag über 0 eintragen.'; break; }
        if (!kbText) { if (kbMeld) kbMeld.textContent = 'Wofür war das? Bitte kurz dazuschreiben.'; break; }
        var kbAus = UI.kasseArt === 'aus';
        var kbCent = Math.round(kbEuro * 100) * (kbAus ? -1 : 1);
        window.DartSync.kasse.buchen(kbCent, kbText).then(function (d) {
          kasseDaten = d;
          UI.kasseArt = 'ein';
          if ($('kasse-betrag')) $('kasse-betrag').value = '';
          if ($('kasse-text')) $('kasse-text').value = '';
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          render();
        }).catch(function (e) {
          if (kbMeld) kbMeld.textContent = 'Buchen hat nicht geklappt: ' + e.message;
        });
        break;
      }
      case 'kasse-weg': {
        if (!(window.DartSync && window.DartSync.kasse)) break;
        window.DartSync.kasse.loeschen(el.getAttribute('data-id')).then(function (d) {
          kasseDaten = d;
          render();
        }).catch(function () { /* bleibt stehen */ });
        break;
      }
      case 'training-zusage': {
        if (!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer())) return;
        var tzTid = el.getAttribute('data-tid');
        /* Nochmal auf die eigene Antwort tippen traegt sie wieder aus. */
        var tzStatus = el.classList.contains('aktiv') ? null : el.getAttribute('data-status');
        window.DartSync.liga.zusage(tzTid, tzStatus).then(function (z) {
          ligaZusagen = z;
          render();
        }).catch(function () { /* naechstes Betreten holt den Stand */ });
        break;
      }
      case 'liga-tabelle-speichern': {
        if (!(window.DartSync && window.DartSync.liga && window.DartSync.liga.tabelleSpeichern)) break;
        var ltZeilen = [];
        document.querySelectorAll('#lt-tabelle tbody tr').forEach(function (tr) {
          var z = tr.querySelectorAll('td');
          ltZeilen.push({
            team: z[1].textContent.trim().slice(0, 60),
            spiele: z[2].textContent.trim().slice(0, 12),
            punkte: z[3].textContent.trim().slice(0, 12),
            legs: z[4].textContent.trim().slice(0, 12)
          });
        });
        window.DartSync.liga.tabelleSpeichern({ zeilen: ltZeilen }).then(function () {
          ligaTabelle = { zeilen: ltZeilen };
          ligaTabelleMeldung = 'Gespeichert – alle sehen jetzt diesen Stand.';
          $('lt-stand').textContent = ligaTabelleMeldung;
        }).catch(function () {
          ligaTabelleMeldung = 'Speichern hat nicht geklappt – bitte später nochmal.';
          $('lt-stand').textContent = ligaTabelleMeldung;
        });
        break;
      }
      case 'liga-bericht':
        UI.bericht = el.getAttribute('data-termin') || null;
        UI.berichtVon = S.screen;
        S.screen = 'bericht';
        save(); render();
        break;
      case 'bericht-zurueck':
        S.screen = UI.bericht ? 'liga'
          : UI.berichtVon === 'winner' ? 'winner'
          : S.tour && S.tour.liga ? 'tournament' : 'liga';
        UI.bericht = null;
        save(); render();
        break;
      case 'bericht-drucken':
        window.print();
        break;
      case 'liga-zusage': {
        if (!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer())) return;
        var lgTermin = el.getAttribute('data-id');
        var lgDabei = el.getAttribute('data-dabei') === '1';
        window.DartSync.liga.zusage(lgTermin, lgDabei).then(function (z) {
          ligaZusagen = z;
          render();
        }).catch(function () {
          /* Kein Netz: nichts kaputt – beim nächsten Betreten stimmt es wieder. */
        });
        break;
      }
      case 'end-visit': {
        var em = currentMatch();
        if (!em || em.done) return;
        pomp();
        // Fehlende Darts als Fehlwürfe ergänzen, dann normal verbuchen.
        while (UI.darts.length < 3) UI.darts.push({ m: 1, n: 0, v: 0 });
        var total = sum(UI.darts, function (d) { return d.v; });
        commitVisit(total, 3, false, false, UI.darts);
        break;
      }
      case 'edit-visit': {
        var m3 = currentMatch();
        if (!m3 || m3.done) return;
        var idx = Number(el.getAttribute('data-i'));
        var leg3 = activeLeg(m3);
        var v3 = leg3 && leg3.visits[idx];
        if (!v3) return;
        UI.overlay = { type: 'edit-visit', idx: idx, pid: v3.p, old: v3.b ? v3.o : v3.s, value: '', error: '' };
        render();
        break;
      }
      case 'co-darts': {
        var n = Number(el.getAttribute('data-n'));
        var score = UI.overlay.score;
        UI.overlay = null;
        commitVisit(score, n, true, false);
        break;
      }
      case 'ov-cancel':
        UI.overlay = null; UI.input = ''; render();
        break;
      case 'ov-new-tournament':
        UI.overlay = null;
        startTournament(true);
        break;
      case 'ov-next-leg':
        UI.overlay = null; render();
        break;
      case 'ov-next-match': {
        UI.overlay = null;
        var next = nextOpenMatch();
        if (next) openMatch(next.id); else { S.screen = 'winner'; save(); render(); }
        break;
      }
      case 'roster-change':
        UI.overlay = S.tour && S.tour.liga ? { type: 'liga-wechsel' } : { type: 'roster-change' };
        render();
        break;
      case 'turnier-exit': {
        UI.turnier = false;
        S.settings.turnierModus = 0;
        UI.input = '';
        $('turnier-exit').classList.add('hidden');
        save(); render();
        break;
      }
      case 'liga-kampflos': {
        var kfM = matchById(el.getAttribute('data-id'));
        if (!kfM || !(S.tour && S.tour.liga)) break;
        UI.overlay = { type: 'liga-kampflos', id: kfM.id };
        render();
        break;
      }
      case 'liga-kampflos-wer': {
        var kwM = matchById(UI.overlay && UI.overlay.id);
        if (!kwM || kwM.legs.some(function (l) { return l.visits.length > 0; })) break;
        var nichtDa = el.getAttribute('data-wer');
        kwM.done = true;
        kwM.kampflos = true;
        kwM.winner = kwM.p[0] === nichtDa ? kwM.p[1] : kwM.p[0];
        kwM.at = Date.now();
        kwM.legs = [];
        if (S.tour.liga && !S.tour.liga.zeitBis && !nextOpenMatch()) S.tour.liga.zeitBis = Date.now();
        UI.overlay = null;
        save();
        /* Im geteilten Spiel steht die Wertung sofort auch am anderen
           Geraet - sonst koennte dort jemand das Einzel noch spielen. */
        if (geteiltesTurnier() && window.DartSync && window.DartSync.turnier) {
          window.DartSync.turnier.ergebnis(kwM);
        }
        render();
        break;
      }
      case 'liga-kampflos-zurueck': {
        var kzM = matchById(UI.overlay && UI.overlay.id);
        if (!kzM || !kzM.kampflos || geteiltesTurnier()) break;
        kzM.done = false;
        kzM.kampflos = false;
        kzM.winner = null;
        kzM.at = null;
        if (S.tour.liga && S.tour.liga.zeitBis && nextOpenMatch()) S.tour.liga.zeitBis = null;
        UI.overlay = null;
        save(); render();
        break;
      }
      case 'liga-wechsel-pos': {
        var lwSeite = el.getAttribute('data-seite');
        var lwPos = Number(el.getAttribute('data-pos'));
        var lwLg = S.tour && S.tour.liga;
        if (!lwLg) break;
        var unsere = lwLg.heim ? 'H' : 'G';
        var lwEigene = lwSeite === unsere;
        var lwErste = lwEigene ? (activeProfiles()[0] || {}).id || '' : '';
        UI.overlay = {
          type: 'liga-wechsel-zu', seite: lwSeite, pos: lwPos,
          eigene: lwEigene,
          draft: { neu: lwErste, name: '' }
        };
        render();
        break;
      }
      case 'liga-wechsel-ok': {
        var lo = UI.overlay;
        if (!lo || lo.type !== 'liga-wechsel-zu') break;
        var loLg = S.tour.liga;
        var neuId;
        if (lo.eigene) {
          neuId = lo.draft.neu;
          if (!neuId) { lo.fehler = 'Bitte einen Spieler auswählen.'; render(); break; }
        } else {
          var loName = (String(lo.draft.name || '').trim().slice(0, 30) + ' ' +
            String(lo.draft.nach || '').trim().slice(0, 30)).replace(/\s+/g, ' ').trim();
          if (!String(lo.draft.name || '').trim() || !String(lo.draft.nach || '').trim()) {
            lo.fehler = 'Bitte Vor- und Nachnamen des neuen Gegners eintragen.'; render(); break;
          }
          /* Nur die AKTIVE Besetzung ausschließen: wer auf der Bank sitzt,
             wird am Namen wiedererkannt und darf zurückwechseln – sonst
             entstünde ein zweites Profil desselben Menschen. */
          neuId = ligaGastId(loName, loLg.posH.concat(loLg.posG));
        }
        var loFehler = ligaWechseln(lo.seite, lo.pos, neuId);
        if (loFehler) { lo.fehler = loFehler; render(); break; }
        UI.overlay = { type: 'liga-wechsel' };
        render();
        break;
      }
      case 'add-player':
        addPlayerToTournament(el.getAttribute('data-id'));
        render();
        break;
      case 'withdraw-player':
        withdrawFromTournament(el.getAttribute('data-id'));
        render();
        break;
      case 'reset':
        UI.overlay = { type: 'confirm-reset' }; render();
        break;
      /*
       * „Beenden" in der Fortsetzen-Box. Derselbe Weg wie unten auf der
       * Turnierseite, nur dort, wo man ihn sucht: wer etwas Neues anfangen
       * will, schaut zuerst hier.
       */
      case 'beenden':
        if (S.game && S.game.done) { finishGame(); }
        else if (S.game) { UI.overlay = { type: 'confirm-discard-game' }; render(); }
        else if (S.matches.length) { UI.overlay = { type: 'confirm-reset' }; render(); }
        break;
      /* Ein abgebrochenes freies Spiel hat keinen Sieger und damit nichts,
         was in die Statistik gehören würde – es wird verworfen. */
      case 'ov-discard-game':
        S.game = null;
        UI.overlay = null;
        S.screen = 'setup';
        save(); render();
        break;
      case 'ov-reset':
        archiveTournament();
        UI.overlay = null;
        S.screen = 'setup';
        save(); render();
        break;
    }
  }

  /* ================= Events ================= */
  /* Ein Tipp neben den Dialog schließt ihn – außer dort, wo eine Antwort
     nötig ist (Checkout-Abfrage, Spielende). */
  var STICKY_OVERLAYS = { 'checkout-darts': 1, 'leg-done': 1, 'match-done': 1, 'game-done': 1, 'turnier-ende': 1 };
  /* Druck-Blitz: jede wirklich gedrueckte Taste leuchtet kurz auf. Als
     neu gestartete Animation, nicht nur :active - ein 30-ms-Tipp waere
     sonst unsichtbar, und am Board braucht man die Gewissheit, dass der
     Tipp angekommen ist. Nur fuer Zeigereingaben; Tastatur-Aktionen
     (Turnier-Modus) animieren nie. */
  document.addEventListener('pointerdown', function (ev) {
    if (!ev.target || !ev.target.closest) return;
    /* Was der Ghost-Tap-Schutz gleich verwerfen wird, darf auch nicht
       blitzen - sonst suggeriert das Licht eine Eingabe, die nie zaehlt. */
    if (Date.now() <= ghostTapUntil && ev.detail >= 2) return;
    var taste = ev.target.closest('button');
    if (!taste || taste.disabled) return;
    taste.classList.remove('blitzt');
    void taste.offsetWidth;               // Animation von vorn starten
    taste.classList.add('blitzt');
  }, { capture: true, passive: true });
  document.addEventListener('animationend', function (ev) {
    if (String(ev.animationName).indexOf('tastenblitz') === 0) {
      ev.target.classList.remove('blitzt');
    }
  });

  /* Einen Eingabemodus waehlen - per Knopf oder Tab-Taste. Der Turnier-Modus
     überlebt einen Neustart: der Bildschirm hängt am Board und soll nach dem
     Wiederöffnen nicht neu eingestellt werden. Die Einstellung aendert sich
     nur, wenn der Modus selbst ein- oder ausgeschaltet wird - ein Wechsel
     zwischen Punkte und Einzel-Darts laesst das Board-Gedaechtnis in Ruhe. */
  function waehleEingabemodus(neuerModus) {
    if (neuerModus === 'turnier' && !turnierErlaubt()) return;
    if (neuerModus === 'kamera' && !window.DartKamera) return;
    var turnierVorher = UI.turnier;
    var kameraVorher = UI.kamera;
    UI.turnier = neuerModus === 'turnier';
    UI.kamera = neuerModus === 'kamera';
    UI.modeOverride = UI.turnier || UI.kamera ? null : neuerModus;
    if (UI.turnier) S.settings.turnierModus = 1;
    else if (turnierVorher) { S.settings.turnierModus = 0; UI.input = ''; }
    /* Die Kamera-Schicht koppelt bzw. trennt sich, wenn ihr Modus kommt
       oder geht - app.js kennt nur den Schalter. */
    if (window.DartKamera && UI.kamera !== kameraVorher) window.DartKamera.modus(UI.kamera);
    UI.error = '';
    save(); render();
  }

  /* Ein einzelner Dart, egal woher (Board-Tastenfeld, Tastatur, künftig
     Kamera): je nach Bildschirm die passende Buchung. Bull kennt nur einfach
     (25) und doppelt (50) - steht Double oder Triple an, ist das grosse Bull
     gemeint, nichts wird still verworfen. Gibt zurueck, ob gebucht wurde -
     falsch heisst: falscher Bildschirm, Spiel vorbei oder Schonfrist. */
  function spielDart(mult, num) {
    if (S.screen === 'cricket') return cricketDart(mult, num);
    if (S.screen === 'rtw') return rtwDart(mult, num);
    if (S.screen === 'finisher') return finisherDart(mult, num);
    if (S.screen !== 'game') return false;
    if (num === 0) return pushDart(1, 0);
    if (num === 25) return pushDart(mult >= 2 ? 2 : 1, 25);
    return pushDart(mult, num);
  }

  /* Turnier-Modus ohne Hardware-Tastatur: ein Tipp irgendwo ins Bild zeigt
     fuer ein paar Sekunden den Beenden-Knopf - der einzige Weg zurueck,
     wenn Tab und Esc fehlen (iPad ohne Tastatur). */
  var turnierExitTimer = null;
  function zeigeTurnierExit() {
    var b = $('turnier-exit');
    if (!b) return;
    b.classList.remove('hidden');
    if (turnierExitTimer) clearTimeout(turnierExitTimer);
    turnierExitTimer = setTimeout(function () { b.classList.add('hidden'); }, 4000);
  }

  document.addEventListener('click', function (ev) {
    if (isGhostTap(ev)) return;
    if (ev.target.id === 'overlay' && UI.overlay && !STICKY_OVERLAYS[UI.overlay.type]) {
      UI.overlay = null; UI.input = ''; render(); return;
    }
    if (UI.turnier && turnierErlaubt() && S.screen === 'game' && !UI.overlay &&
        !ev.target.closest('#turnier-exit')) {
      zeigeTurnierExit();
    }
    var t = ev.target.closest('[data-action]');
    if (t) { handleAction(t.getAttribute('data-action'), t); return; }

    var seg = ev.target.closest('[data-setting] button');
    if (seg) {
      var key = seg.parentElement.getAttribute('data-setting');
      S.settings[key] = Number(seg.getAttribute('data-value'));
      save(); render();
      return;
    }

    var modeBtn = ev.target.closest('#mode-toggle button');
    if (modeBtn) {
      waehleEingabemodus(modeBtn.getAttribute('data-mode'));
      return;
    }

    var editKey = ev.target.closest('[data-editkey]');
    if (editKey && UI.overlay && UI.overlay.type === 'edit-visit') {
      var k = editKey.getAttribute('data-editkey');
      if (k === 'del') UI.overlay.value = String(UI.overlay.value).slice(0, -1);
      else if (k === 'ok') {
        if (UI.overlay.value === '') return;
        var err = applyVisitEdit(UI.overlay.idx, parseInt(UI.overlay.value, 10));
        if (err) UI.overlay.error = err; else UI.overlay = null;
      } else if (String(UI.overlay.value + k).length <= 3) {
        UI.overlay.value = String(Number(UI.overlay.value + k));
        UI.overlay.error = '';
      }
      render();
      return;
    }

    var key2 = ev.target.closest('.keypad button');
    if (key2) { pressKey(key2.getAttribute('data-key')); return; }

    var quick = ev.target.closest('[data-quick]');
    if (quick) {
      if (settling() || quickDoubleTap(quick.getAttribute('data-quick'))) return;
      UI.error = '';
      UI.input = quick.getAttribute('data-quick');
      submitTotal();
      return;
    }

    var mult = ev.target.closest('.mult-row button');
    if (mult) { UI.mult = Number(mult.getAttribute('data-mult')); render(); return; }

    var bull = ev.target.closest('[data-bull]');
    if (bull) { spielDart(2, 25); return; }

    var num = ev.target.closest('[data-num]');
    if (num) {
      var n2 = Number(num.getAttribute('data-num'));
      var own = num.getAttribute('data-mult');
      spielDart(own ? Number(own) : UI.mult, n2);
      return;
    }
  });

  /* Name im Profil-Dialog: nur den Entwurf pflegen, nicht neu rendern –
     sonst verliert das Feld beim Tippen den Fokus. */
  document.addEventListener('input', function (ev) {
    if (ev.target.getAttribute('data-role') === 'profile-name' && UI.overlay) {
      UI.overlay.draft.name = ev.target.value;
    }
    /* Lieblingsdoppel: 0 heisst „egal". Auch hier nicht neu zeichnen – der
       Dialog wuerde sonst mitten in der Auswahl unter den Fingern wegspringen. */
    if (ev.target.getAttribute('data-role') === 'profile-double' && UI.overlay) {
      UI.overlay.draft.dbl = Number(ev.target.value) || null;
    }
    if (ev.target.getAttribute('data-role') === 'profile-vor' && UI.overlay) {
      UI.overlay.draft.vor = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'profile-nach' && UI.overlay) {
      UI.overlay.draft.nach = ev.target.value;
    }
    /* Ligaspiel-Aufstellung: Entwurf pflegen, nicht neu zeichnen – sonst
       verlieren die Felder beim Tippen den Fokus. */
    if (ev.target.getAttribute('data-role') === 'liga-gegner' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.gegner[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'liga-gegner-nach' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.gegnerNach[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'liga-pos' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.wir[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'uebung-sie' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.sie[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'liga-neu' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.neu = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'liga-neu-name' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.name = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'liga-neu-nach' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.nach = ev.target.value;
    }
  });

  $('avatar-input').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file || !UI.overlay) return;
    readAvatar(file, function (dataUrl) {
      if (dataUrl && UI.overlay) { UI.overlay.draft.avatar = dataUrl; render(); }
    });
  });

  /* Als Schaltfläche angesagte Elemente müssen auch per Tastatur gehen. */
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && UI.overlay && !STICKY_OVERLAYS[UI.overlay.type]) {
      UI.overlay = null; UI.input = ''; render();
      return;
    }
    /* Tab schaltet die drei Eingabemodi im Kreis durch - dieselben Knoepfe,
       nur per Tastatur: Punkte -> Einzel-Darts -> Turnier -> Punkte (der
       Turnier-Modus haengt nur mit im Kreis, wo es ihn gibt). Ein offener
       Dialog geht vor. */
    /* Ausbullen am Board: Pfeile/Tab wechseln den Kandidaten, Enter
       bestaetigt den Anwerfer. */
    if (S.screen === 'bulloff' && UI.turnier && turnierErlaubt() && !UI.overlay) {
      var bKnoepfe = document.querySelectorAll('#bulloff-buttons [data-action="pick-starter"]');
      if (bKnoepfe.length) {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ||
            ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === 'Tab') {
          ev.preventDefault();
          var bAlt = UI.bullWahl || 0;
          UI.bullWahl = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
            ? Math.max(0, bAlt - 1)
            : ev.key === 'Tab' ? (bAlt + 1) % bKnoepfe.length
            : Math.min(bKnoepfe.length - 1, bAlt + 1);
          render();
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var bZiel = bKnoepfe[Math.min(UI.bullWahl || 0, bKnoepfe.length - 1)];
          if (bZiel) handleAction('pick-starter', bZiel);
          return;
        }
      }
    }
    if (ev.key === 'Tab' && !UI.overlay && S.screen === 'game') {
      ev.preventDefault();
      var mFolge = ['total', 'darts'];
      if (turnierErlaubt()) mFolge.push('turnier');
      if (window.DartKamera) mFolge.push('kamera');
      var mJetzt = mFolge.indexOf(UI.letzterModus) >= 0 ? UI.letzterModus : 'total';
      waehleEingabemodus(mFolge[(mFolge.indexOf(mJetzt) + 1) % mFolge.length]);
      return;
    }
    /* Esc (bzw. ⌘+. am Magic Keyboard ohne Esc-Taste) beendet den
       Turnier-Modus direkt. */
    var istAusstieg = ev.key === 'Escape' ||
      (ev.key === '.' && (ev.metaKey || ev.ctrlKey));
    if (istAusstieg && !UI.overlay && S.screen === 'game' && UI.turnier) {
      ev.preventDefault();
      UI.turnier = false;
      S.settings.turnierModus = 0;
      UI.input = '';
      save(); render();
      return;
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var t = ev.target.closest('[role="button"][data-action]');
    if (!t) return;
    // Solange ein Dialog offen ist, zählt nur, was im Dialog steht.
    if (UI.overlay && !t.closest('#overlay')) return;
    ev.preventDefault();
    handleAction(t.getAttribute('data-action'), t);
  });

  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'game' || UI.overlay) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    var m = currentMatch();
    if (!m) return;
    var leg = activeLeg(m);
    if (!leg) return;
    /* Im Turnier-Modus gehört die Tastatur dem Eingabefeld – ein „z", das
       daneben geht, darf nicht still eine Aufnahme zurücknehmen. Dort ist
       Löschen im leeren Feld der Weg zurück. */
    if (ev.key.toLowerCase() === 'z' && !UI.turnier) { undo(); ev.preventDefault(); return; }
    var rest = remainingIn(leg, activePlayer(leg, m)) - sum(UI.darts, function (d) { return d.v; });
    if (effectiveMode(rest) !== 'total') return;
    if (ev.key >= '0' && ev.key <= '9') { pressKey(ev.key); ev.preventDefault(); }
    else if (ev.key === 'Enter') { pressKey('ok'); ev.preventDefault(); }
    else if (ev.key === 'Backspace') { pressKey('del'); ev.preventDefault(); }
  });

  /* ---------- Turnier-Modus: Eingabe über die Tastatur ----------
     Bewusst OHNE echtes Eingabefeld: ein fokussiertes Feld ruft am iPad die
     System-Tastaturleiste (DE/EN, Pfeile) auf den Schirm. Die Ziffern kommen
     als Tastendrücke direkt an der Seite an und landen in UI.input – dieselbe
     Ablage, aus der auch submitTotal() liest. */
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'game' || !UI.turnier || UI.overlay) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var tm = currentMatch();
    if (!tm || tm.done) return;
    if (ev.key >= '0' && ev.key <= '9') {
      if (UI.input.length < 3) {
        UI.input = UI.input === '0' ? ev.key : UI.input + ev.key;
        UI.error = '';
        render();
      }
      ev.preventDefault();
    } else if (ev.key === 'Enter') {
      /* Markieren: DIESES Enter hat die Aufnahme gebucht - der Overlay-
         Listener weiter unten darf es nicht gleich noch als Bestaetigung
         der frisch geoeffneten Checkout-Frage verstehen. */
      if (UI.input !== '') { UI.error = ''; ev.eingabeGebucht = true; submitTotal(); }
      ev.preventDefault();
    } else if (ev.key === 'Backspace') {
      /* Erst Ziffern löschen, im leeren Zustand die letzte Aufnahme – so
         korrigiert man vom Board aus ohne Maus bis zum vorigen Spieler. */
      if (UI.input) { klick(); UI.input = UI.input.slice(0, -1); UI.error = ''; render(); }
      else undo();
      ev.preventDefault();
    }
  });

  /* Shift gedrückt halten zeigt die Wurfliste des Matches – je Spieler auf
     seiner Seite, alle Legs mit Trennern. Loslassen führt zurück in die
     Spielansicht; verliert das Fenster den Fokus (Alt-Tab), klappt die
     Ansicht ebenfalls zu, sonst bliebe sie hängen. */
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Shift' || S.screen !== 'game' || !UI.turnier) return;
    $('screen-game').classList.add('verlauf');
  });
  document.addEventListener('keyup', function (ev) {
    if (ev.key !== 'Shift') return;
    var sgEl = $('screen-game');
    if (sgEl) sgEl.classList.remove('verlauf');
  });
  window.addEventListener('blur', function () {
    var sgEl = $('screen-game');
    if (sgEl) sgEl.classList.remove('verlauf');
  });

  /* Auch die Abfragen zwischen den Aufnahmen gehen ohne Maus: 1/2/3
     beantworten die Dart-Frage beim Checkout, Enter startet das nächste Leg,
     Löschen nimmt die Eingabe zurück. */
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'game' || !UI.overlay) return;
    var ov = UI.overlay;
    if (ov.type === 'checkout-darts') {
      if (ev.key >= '0' && ev.key <= '9') {
        /* Jede Ziffer wird geschluckt – auch eine falsche. Sonst landet sie
           im weiterhin fokussierten Eingabefeld und klebt vor der nächsten
           Aufnahme (aus einer getippten 5 würde still eine 95). */
        ev.preventDefault();
        var anz = parseInt(ev.key, 10);
        if (anz >= 1 && anz <= 3 && ov.options.indexOf(anz) >= 0) {
          var coScore = ov.score;
          UI.overlay = null;
          commitVisit(coScore, anz, true, false);
        }
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
                 ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'Tab') {
        ev.preventDefault();
        var coAlt = ov.wahl || 0;
        ov.wahl = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
          ? Math.max(0, coAlt - 1)
          : ev.key === 'Tab' ? (coAlt + 1) % ov.options.length
          : Math.min(ov.options.length - 1, coAlt + 1);
        render();
      } else if (ev.key === 'Enter' && !ev.eingabeGebucht) {
        ev.preventDefault();
        var coAnz = ov.options[Math.min(ov.wahl || 0, ov.options.length - 1)];
        var coSc = ov.score;
        UI.overlay = null;
        commitVisit(coSc, coAnz, true, false);
      } else if (ev.key === 'Backspace') {
        undo(); ev.preventDefault();
      }
    } else if (ov.type === 'turnier-ende') {
      var teOffene = S.matches.filter(function (x) { return !x.done && !x.void; }).slice(0, 4);
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (ov.phase === 'stat') { ov.phase = 'weiter'; ov.wahl = 0; render(); }
        else if (teOffene.length) {
          var teWahl = Math.min(ov.wahl || 0, teOffene.length - 1);
          UI.overlay = null;
          openMatch(teOffene[teWahl].id);
        } else {
          handleAction('ov-next-match', ev.target);
        }
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'Tab') && ov.phase === 'weiter') {
        ov.wahl = ev.key === 'Tab'
          ? ((ov.wahl || 0) + 1) % Math.max(1, teOffene.length)
          : Math.min((ov.wahl || 0) + 1, Math.max(0, teOffene.length - 1));
        render(); ev.preventDefault();
      } else if ((ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') && ov.phase === 'weiter') {
        ov.wahl = Math.max((ov.wahl || 0) - 1, 0);
        render(); ev.preventDefault();
      } else if (ev.key === 'Backspace') {
        undo(); ev.preventDefault();
      }
    } else if (ov.type === 'game-done' && UI.turnier && turnierErlaubt()) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Tab') {
        ov.wahl = ev.key === 'Tab' ? 1 - (ov.wahl || 0)
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? 1 : 0;
        render(); ev.preventDefault();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        /* Den markierten Knopf wirklich druecken - er traegt data-kind und
           data-id, die der Handler braucht. */
        var gdKnoepfe = document.querySelectorAll('#overlay-card .btn[data-action]');
        var gdZiel = gdKnoepfe[ov.wahl || 0];
        if (gdZiel) handleAction(gdZiel.getAttribute('data-action'), gdZiel);
      } else if (ev.key === 'Backspace') {
        undo(); ev.preventDefault();
      }
    } else if (ov.type === 'leg-done') {
      /* Steht der Fokus auf einem Knopf im Dialog (per Tab erreicht), gilt
         dessen Beschriftung – Enter darf dann nicht am Knopf vorbei das Leg
         bestätigen, während „Eingabe rückgängig" unter dem Finger liegt. */
      var fokus = document.activeElement;
      var imDialog = fokus && fokus.closest && fokus.closest('#overlay');
      var ldTastatur = UI.turnier && turnierErlaubt();
      if (ldTastatur && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' ||
          ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Tab')) {
        ov.wahl = ev.key === 'Tab' ? 1 - (ov.wahl || 0)
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? 1 : 0;
        render(); ev.preventDefault();
      } else if (ev.key === 'Enter' && !imDialog) {
        ev.preventDefault();
        if (ldTastatur && (ov.wahl || 0) === 1) { undo(); }
        else { UI.overlay = null; render(); }
      } else if (ev.key === 'Backspace' && !imDialog) {
        undo(); ev.preventDefault();
      }
    }
  });

  /* ================= Start ================= */
  S = load() || newState();
  /* Die gemerkte Board-Einstellung zieht beim Start nur mitten im
     Ligaspiel - ein normales Spiel beginnt immer im normalen Bild. */
  UI.turnier = !!(S.settings && S.settings.turnierModus === 1 && S.tour && S.tour.liga);
  if (!S.lineup.length) S.lineup = activeProfiles().slice(0, 4).map(function (p) { return p.id; });
  if ((S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher') && !S.game) S.screen = 'setup';
  /* Ein angefangenes Schnelles Spiel liegt in S.game, nicht im Spielplan –
     ohne diese Zeile landete man nach einem Neustart im leeren Turnier. */
  if (S.screen === 'game' && S.game && S.game.kind === 'quick' && !S.game.done) S.screen = 'game';
  if (S.game && S.game.kind !== 'quick' && !S.game.started && !S.game.throws.length) S.screen = 'bulloff';
  if (S.game && S.game.kind === 'quick' && !S.game.started) S.screen = 'bulloff';
  if (S.game && S.game.started === undefined) S.game.started = true;   // ältere Stände
  if (S.game && (S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher') && S.game.kind !== S.screen) S.screen = spielScreen(S.game.kind);
  /* Ein beendetes Spiel führt zur Auswertung, nicht auf ein totes Board –
     sonst kann man in ein fertiges Match weitertippen. */
  if (S.game && S.game.done) {
    UI.summary = { kind: S.game.kind, id: 'current' };
    S.screen = 'summary';
  }
  if (S.screen === 'game' && currentMatch() && currentMatch().done) {
    UI.summary = { kind: '501', id: currentMatch().id };
    S.screen = 'summary';
  }
  if (S.screen === 'game' && !currentMatch()) S.screen = 'tournament';
  if (S.screen === 'bulloff' && !currentMatch() && !S.game) S.screen = 'tournament';
  if (!S.matches.length && S.screen === 'tournament') S.screen = 'setup';
  if (S.screen === 'profile' && !UI.profile) S.screen = 'players';
  if (S.screen === 'summary' && !UI.summary) S.screen = S.matches.length ? 'tournament' : 'setup';
  render();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline-Cache optional */ });
  }

  // Für Tests unter Node/Headless – und als einzige Andockstelle für die
  // optionale Online-Schicht (js/auth.js, js/sync.js).
  if (typeof window !== 'undefined') {
    window.__dart = {
      state: function () { return S; },
      ui: function () { return UI; },
      action: handleAction,
      save: save,
      uid: uid,
      esc: esc,
      avatarHTML: avatarHTML,
      profile: profile,
      activeProfiles: activeProfiles,
      freeHue: freeHue,
      HUES: HUES,
      setScreen: function (name) { S.screen = name; save(); render(); },
      ersetzeSpielerIds: ersetzeSpielerIds,
      uebernehmeSpiele: uebernehmeSpiele,
      uebernehmeTurnier: uebernehmeTurnier,
      turnierListeAktualisieren: beitretbareHolen,
      turnierBeitreten: turnierBeitreten,
      letztesSpielAm: letztesSpielAm,
      gaesteAufraeumen: gaesteAufraeumen,
      platzhalterEntfernen: platzhalterEntfernen,
      pushDart: pushDart,
      cricketDart: cricketDart,
      rtwDart: rtwDart,
      finisherDart: finisherDart,
      spielDart: spielDart,
      pressKey: pressKey,
      submitTotal: submitTotal,
      undo: undo,
      standings: standings,
      stats: stats,
      career: career,
      allMatches: allMatches,
      ranking: function (key) { return ranking(boardDef(key), career()); },
      remainingIn: remainingIn,
      activeLeg: activeLeg,
      activePlayer: activePlayer,
      currentMatch: currentMatch,
      game: function () { return S.game; },
      cricketState: function () { return cricketState(S.game); },
      finisherState: function () { return finisherState(S.game); },
      finisherRunde: function () { return finisherRunde(S.game); },
      rtwState: function () { return rtwState(S.game); },
      gameTurnPlayer: function () { return S.game ? gameTurnPlayer(S.game) : null; },
      render: render,
      reset: function () { S = newState(); UI.overlay = null; render(); }
    };
  }
})();
