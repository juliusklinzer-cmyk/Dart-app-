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
  /* Scheibe je Einzel (Index wie LIGA_EINZEL): je zwei Einzel laufen
     gleichzeitig an S1 und S2, und jeder Spieler beider Teams spielt genau
     zweimal an S1 und zweimal an S2. */
  var LIGA_SCHEIBEN = ['S1', 'S2', 'S1', 'S2', 'S1', 'S2', 'S1', 'S2',
    'S2', 'S1', 'S1', 'S2', 'S1', 'S2', 'S2', 'S1'];
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
     bis jemand zurückschaltet. modeOverride: "Punkte" von Hand gilt je
     Aufnahme, "Einzel-Darts" von Hand bis zum Ende der Partie.
     kamera: ebenso klebrig – die Darts kommen vom gekoppelten iPhone
     (js/kamera.js), angezeigt wird die Einzel-Darts-Ansicht. */
  var UI = { input: '', darts: [], mult: 1, modeOverride: null, turnier: false, kamera: false, overlay: null, error: '', board: 'won', boardMode: '501', profile: null, summary: null, ligaTab: 'plan', bericht: null };

  /* ================= Helfer ================= */
  function $(id) { return document.getElementById(id); }
  /* Klaenge sind optional - ohne js/sound.js bleibt alles stumm. */
  /* "Ton & Feiern" im Setup: beides laesst sich abschalten. */
  function tonAn() { return !(S && S.settings && S.settings.ton === 0); }
  function feiernAn() { return !(S && S.settings && S.settings.feiern === 0); }
  function pomp() { if (window.DartSound && tonAn()) window.DartSound.pomp(); }
  function klick() { if (window.DartSound && tonAn()) window.DartSound.klick(); }
  /* Leiser Tastenton fuer Ziffern und Umschalter - Buchungen haben den Pomp. */
  function tipp() { if (window.DartSound && window.DartSound.tipp && tonAn()) window.DartSound.tipp(); }
  /* Zwei Schlaege: im Online-Spiel hat der andere gerade eingetragen. */
  function klopfen() {
    UI.klopfen = Date.now();
    if (!window.DartSound || !tonAn()) return;
    /* Pomp fuer die Buchung des anderen, dann das Klopfen -- jede Eingabe
       ist auf beiden Tablets zu hoeren, nur die Tastentoene bleiben lokal. */
    if (window.DartSound.fremdeEingabe) window.DartSound.fremdeEingabe();
    else if (window.DartSound.klopfen) window.DartSound.klopfen();
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
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
      settings: { start: 501, bestOf: 1, dartModeFrom: 170, cricketScoring: 1, finisherTo: 5, rtwBoost: 1, turnierModus: 0, quickModus: 0, quickSaetze: 1, quickLegs: 1, ton: 1, feiern: 1 },
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
  /* Was nur im Bildschirm lebt, aber einen Neustart ueberstehen soll: die
     angefangene Aufnahme in Einzel-Darts und die offene Checkout- bzw.
     Leg-Ende-Frage. Gilt nur fuer die Partie, zu der es gehoert. */
  function uiKennung() {
    if (S.game && S.game.kind === 'quick') return 'g:' + S.game.id;
    return S.current ? 'm:' + S.current : null;
  }
  function uiMerken() {
    var ov = UI.overlay && (UI.overlay.type === 'checkout-darts' || UI.overlay.type === 'leg-done') ? UI.overlay : null;
    S.ui = (UI.darts.length || ov) && uiKennung()
      ? { k: uiKennung(), darts: UI.darts.map(function (d) { return { m: d.m, n: d.n, v: d.v }; }), overlay: ov }
      : null;
  }
  function uiWiederherstellen() {
    var u = S.ui;
    S.ui = null;
    if (!u || u.k !== uiKennung() || S.screen !== 'game') return;
    var m = currentMatch();
    if (!m || m.done) return;
    if (Array.isArray(u.darts) && u.darts.length < 3) UI.darts = u.darts;
    if (u.overlay && u.overlay.type === 'checkout-darts' && !UI.darts.length) UI.overlay = u.overlay;
    /* Der Leg-Dialog gilt nur, solange das naechste Leg noch nicht begonnen hat. */
    if (u.overlay && u.overlay.type === 'leg-done') {
      var fertig = m.legs.filter(function (l) { return l.winner; });
      var letzt = fertig[fertig.length - 1];
      var offen = m.legs[m.legs.length - 1];
      if (letzt && letzt.winner === u.overlay.pid && (!offen || offen === letzt || !offen.visits.length)) UI.overlay = u.overlay;
    }
  }

  /* Live-Ticker: das spielende Geraet meldet den Stand des laufenden
     Einzels (nach jeder Aufnahme, gebuendelt auf hoechstens einmal pro
     Sekunde). Nur im geteilten Turnier - nur das liegt beim Server. */
  var tickerTimer = null;
  function liveTickerAnstossen() {
    if (tickerTimer || !window.DartSync || !window.DartSync.turnier || !window.DartSync.turnier.liveStand) return;
    if (!S.tour || !S.tour.geteilt || !S.current) return;
    tickerTimer = setTimeout(function () {
      tickerTimer = null;
      var m = S.current ? matchById(S.current) : null;
      if (!m || !geteiltesTurnier()) return;
      window.DartSync.turnier.liveStand(m.id, m.done ? null : {
        p: m.p.slice(), starter: m.starter || null, start: matchStart(m), legs: m.legs,
        darts: UI.darts.map(function (d) { return { m: d.m, n: d.n, v: d.v }; })
      });
    }, 900);
  }

  function save() {
    /* Neuerer Stand im Speicher: nicht drueberschreiben (siehe load). */
    if (ladeSperre) { liveAnstossen(); return; }
    liveTickerAnstossen();
    uiMerken();
    spielUhrStellen();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
      if (saveBroken) { saveBroken = false; renderSaveWarning(); }
    } catch (e) {
      // Speicher voll oder privater Modus: der Abend läuft weiter, aber
      // stillschweigend Daten zu verlieren wäre das Schlimmste.
      if (!saveBroken) { saveBroken = true; renderSaveWarning(); }
    }
    liveAnstossen();
  }

  /*
   * Kein Spiel laeuft ewig: wer die App oeffnet, soll nicht jedes Mal ein
   * altes, halbfertiges Spiel vom letzten Abend vorfinden. Spiel und Turnier
   * bekommen beim ersten Speichern ihren Startzeitpunkt; nach 12 Stunden ist
   * Schluss (siehe altesSpielBeenden).
   */
  var SPIEL_MAX_MS = 12 * 3600 * 1000;
  /* Die Startzeit merkt sich jedes Geraet selbst (nicht im Spielstand, der
     im Online-Spiel mitreist) - so kann eine falsch gehende Uhr beim
     Mitspieler kein Spiel beenden. */
  function spielUhrStellen() {
    if (S.game && (!S.gameSeit || S.gameSeit.id !== S.game.id)) S.gameSeit = { id: S.game.id, seit: Date.now() };
    if (!S.game && S.gameSeit) S.gameSeit = null;
    if (S.tour && S.matches.length && !S.tour.seit) S.tour.seit = Date.now();
  }
  function altesSpielBeenden() {
    var jetzt = Date.now();
    var weg = [];
    var ligaWeg = false;
    if (!Array.isArray(S.offeneEnden)) S.offeneEnden = [];
    if (S.game && S.gameSeit && S.gameSeit.id === S.game.id && jetzt - S.gameSeit.seit > SPIEL_MAX_MS) {
      var art = kindName(S.game.kind);
      /* Beim App-Start steht die Online-Schicht noch nicht: dann merken und
         die Meldung an Server und Mitspieler nachreichen (offeneEndenSenden). */
      if (S.game.online && !S.game.online.wartet) {
        if (window.DartSync && window.DartSync.live && liveNutzer()) liveEnde(S.game);
        else S.offeneEnden.push({ typ: 'live', sid: S.game.online.sid });
      }
      if (S.game.done) {
        /* Entschieden, nur nie gespeichert: das Ergebnis ist echt und kommt
           ins Archiv. */
        archiveGame(S.game);
        weg.push(art + ' (entschieden) wurde gespeichert');
      } else {
        /* Angefangen und liegen geblieben: verworfen, nichts gespeichert. */
        weg.push('das angefangene ' + art + ' wurde beendet und nicht gespeichert');
      }
      S.game = null;
    }
    /* Ein echtes Ligaspiel mit noch offenem Bericht bekommt 36 Stunden - der
       Bogen wird oft erst am naechsten Tag fertig. */
    var tourMax = S.tour && S.tour.liga && !S.tour.liga.uebung ? 36 * 3600 * 1000 : SPIEL_MAX_MS;
    if (S.tour && S.tour.seit && S.matches.length && jetzt - S.tour.seit > tourMax) {
      var warLiga = !!(S.tour.liga && !S.tour.liga.uebung);
      ligaWeg = warLiga;
      if (S.tour.geteilt && S.tour.sid && !(window.DartSync && window.DartSync.turnier && liveNutzer())) {
        S.offeneEnden.push({ typ: 'turnier', sid: S.tour.sid });
      }
      /* Wie "Turnier beenden": fertige Partien bleiben in der Statistik, die
         offenen entfallen. */
      archiveTournament();
      weg.push(warLiga
        ? 'das Ligaspiel liegt jetzt im Archiv (alle Ergebnisse bleiben, der Bericht lässt sich im Spielplan über „Bericht abschließen“ fertigstellen)'
        : 'das Turnier wurde abgeschlossen (fertige Partien bleiben in der Statistik)');
    }
    if (!weg.length) return false;
    if (S.screen !== 'boards' && S.screen !== 'players' && S.screen !== 'profile' && S.screen !== 'liga') S.screen = 'setup';
    UI.darts = []; UI.input = '';
    UI.overlay = { type: 'hinweis', titel: 'Altes Spiel beendet',
      text: (ligaWeg && weg.length === 1 ? 'Länger als 36 Stunden offen: ' : 'Älter als 12 Stunden: ') + weg.join(', ') + '.' };
    save();
    return true;
  }
  /* Nachgereichte Schluss-Meldungen, sobald man angemeldet und online ist. */
  function offeneEndenSenden() {
    if (!Array.isArray(S.offeneEnden) || !S.offeneEnden.length) return;
    if (!window.DartSync || !liveNutzer()) return;
    var liste = S.offeneEnden;
    S.offeneEnden = [];
    liste.forEach(function (e) {
      if (e.typ === 'live' && window.DartSync.live) window.DartSync.live.ende(e.sid, null);
      if (e.typ === 'turnier' && window.DartSync.turnier && window.DartSync.turnier.endeId) window.DartSync.turnier.endeId(e.sid);
    });
    save();
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S && altesSpielBeenden()) render();
  });

  function renderSaveWarning() {
    var bar = $('save-warning');
    if (!bar) return;
    bar.classList.toggle('hidden', !saveBroken);
  }

  /*
   * Ein Stand, der sich nicht lesen laesst (kaputt oder von einer neueren
   * App-Version), wird nicht stillschweigend ueberschrieben: der Rohtext
   * wandert unter STORAGE_KEY + '.kaputt', und oben steht ein Hinweis. Ein
   * Stand aus einer NEUEREN Version wird gar nicht angeruehrt - sonst waeren
   * nach einem Zurueckrollen Profile, Archiv und Turnier weg.
   */
  var ladeProblem = null;   // null | 'kaputt' | 'neuer'
  var ladeSperre = false;   // true: den Speicher nicht ueberschreiben
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var s = ladeStand(raw);
    if (s) return s;
    if (ladeProblem === 'neuer') { ladeSperre = true; return null; }
    ladeProblem = 'kaputt';
    try {
      /* Der erste kaputte Stand bleibt unter .kaputt, jeder spaetere landet
         unter .kaputt-neu - so geht auch ein zweiter nicht verloren. */
      if (!localStorage.getItem(STORAGE_KEY + '.kaputt')) localStorage.setItem(STORAGE_KEY + '.kaputt', raw);
      else if (localStorage.getItem(STORAGE_KEY + '.kaputt') !== raw) localStorage.setItem(STORAGE_KEY + '.kaputt-neu', raw);
    } catch (e) { ladeSperre = true; /* keine Sicherung moeglich: dann wenigstens nicht ueberschreiben */ }
    return null;
  }

  function renderLadeHinweis() {
    if (!ladeProblem) return;
    var bar = $('lade-hinweis');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'lade-hinweis';
      bar.className = 'save-warning';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.textContent = ladeProblem === 'neuer'
      ? '⚠️ Der gespeicherte Stand stammt von einer neueren App-Version und bleibt unangetastet. Bitte die Seite neu laden bzw. die App aktualisieren – bis dahin wird nichts gespeichert.'
      : ladeSperre
        ? '⚠️ Der gespeicherte Stand war beschädigt und ließ sich nicht lesen. Für eine Sicherung fehlt der Platz, deshalb wird er nicht überschrieben – bis dahin wird nichts gespeichert.'
        : '⚠️ Der gespeicherte Stand war beschädigt und ließ sich nicht lesen. Er ist als Sicherung aufgehoben (dart-turnier-v1.kaputt), die App startet frisch.';
  }

  function ladeStand(raw) {
    try {
      var s = JSON.parse(raw);
      if (!s) return null;
      if (typeof s.v === 'number' && s.v > 2) { ladeProblem = 'neuer'; return null; }
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
      if (s.settings.online === undefined) s.settings.online = 0;
      if (s.settings.ton !== 0) s.settings.ton = 1;
      if (s.settings.feiern !== 0) s.settings.feiern = 1;
      /* Spieldauer des Schnellen Spiels (Saetze/Legs) kam spaeter dazu --
         Altbestand spielt weiter ein Leg. */
      if (s.settings.quickModus !== 1) s.settings.quickModus = 0;
      if (!(s.settings.quickSaetze >= 1)) s.settings.quickSaetze = 1;
      if (!(s.settings.quickLegs >= 1)) s.settings.quickLegs = 1;
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

  /* Testspieler (Konto-Flag vom Server, nur fuer den Tester sichtbar): zum
     Ausprobieren nach einem Deploy da. Ein Spiel, an dem einer beteiligt
     war, zaehlt nirgends -- nicht in Karriere, Rangliste, Rekorden, Diagramm
     oder Spieleliste. */
  function istTest(id) { var p = profile(id); return !!(p && p.test); }
  function testSpiel(h) {
    var ids = h.lineup || h.players || (h.p ? h.p : []);
    return ids.some(istTest);
  }
  function wertbareHistorie() { return S.history.filter(function (h) { return !testSpiel(h); }); }
  function turnierWertbar() { return !tourPlayers().some(istTest); }
  /* Ein geteiltes Turnier, das ein anderes Geraet schon abgeschlossen hat,
     liegt hier bereits als Archiv-Eintrag (gleiche Kennung) -- die noch
     offene Kopie darf dann nicht ein zweites Mal in die Statistik. */
  function turnierSchonArchiviert() {
    return !!(S.tour && S.tour.sid && S.history.some(function (h) { return h.id === S.tour.sid; }));
  }

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
  /* Wer fuer UNS im Ligaspiel aufgestellt werden darf: keine Gast-Konten
     (die verfolgen nur) und keine Bots. */
  function ligaKader() { return activeProfiles().filter(function (p) { return !p.gastKonto && !p.bot; }); }
  /* Ein Gegner aus einem Ligaspiel (steht dort auf der anderen Seite)? Der
     wird nicht zum dauerhaften Gast dieses Geraets. */
  function istLigaGegner(id) {
    var listen = S.history.concat(S.tour && S.tour.liga ? [{ liga: S.tour.liga }] : []);
    return listen.some(function (h) { return h.liga && (h.liga.sie || []).indexOf(id) >= 0; });
  }
  /* Ist der angemeldete Nutzer ein Gast-Konto? */
  function ichBinGastKonto() {
    var n = window.DartKonto && window.DartKonto.nutzer && window.DartKonto.nutzer();
    return !!(n && n.gastKonto);
  }

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

  /* Die Aufstellung darf nur enthalten, was auch in der Liste steht: kein
     ausgeblendeter oder geloeschter Spieler, keiner doppelt. Ein Geist in
     der Aufstellung (Gast ausgeblendet, Kennung blieb stehen) waere sonst
     in jedem neuen Spiel dabei, ohne dass man ihn abwaehlen koennte. */
  function bereinigeAufstellung() {
    var gesehen = {};
    var vorher = S.lineup.length;
    S.lineup = S.lineup.filter(function (id) {
      if (gesehen[id]) return false;
      gesehen[id] = 1;
      var p = null;
      for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === id) p = S.profiles[i];
      return !!p && !p.hidden;
    });
    return S.lineup.length !== vorher;
  }

  var GAST_FRIST = 12 * 3600 * 1000;   // ein Abend
  /* Laeuft beim Start der App und jedes Mal, wenn das Setup gezeichnet wird:
     ein Tablet, das tagelang offen bleibt, wuerde sonst nie aufraeumen, und
     der Gast von vorgestern staende weiter in der Aufstellung. Wer mitten
     im laufenden Turnier oder Spiel steht, bleibt -- sonst zeigte der
     Spielplan "Unbekannt". */
  function gaesteAufraeumen() {
    var jetzt = Date.now();
    var geaendert = false;
    var imSpiel = {};
    if (S.matches.length) tourPlayers().forEach(function (id) { imSpiel[id] = 1; });
    if (S.game && S.game.players) S.game.players.forEach(function (id) { imSpiel[id] = 1; });
    S.profiles = S.profiles.filter(function (p) {
      if (!p.gast || p.hidden || p.dauer) return true;   // dauerhafter Gast bleibt
      if (imSpiel[p.id]) return true;
      var zuletzt = letztesSpielAm(p.id);
      /* fristAb: vom dauerhaften wieder zum temporaeren Gast gemacht - die
         12 Stunden laufen ab da, nicht ab seinem letzten Spiel. */
      var ab = Math.max(zuletzt || 0, p.created || 0, p.fristAb || 0) || jetzt;
      if (jetzt - ab < GAST_FRIST) return true;
      geaendert = true;
      if (!zuletzt) return false;          // nie gespielt: ersatzlos weg
      p.hidden = true;
      return true;
    });
    if (bereinigeAufstellung()) geaendert = true;
    if (geaendert) save();
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
  var HUES = [145, 210, 40, 355, 275, 175, 320, 90, 25, 250, 120, 300];
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
  /* Profilbilder kommen auch vom Server (Bilder der Kollegen). Ins HTML darf
     nur, was garantiert ein Bild ist: ein data:-URL aus reinem Base64 --
     darin gibt es weder Anfuehrungszeichen noch Klammern, mit denen jemand
     aus dem style-Attribut ausbrechen koennte. Alles andere: Initialen. */
  var AVATAR_OK = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/;
  function avatarSicher(a) { return typeof a === 'string' && a.length < 400000 && AVATAR_OK.test(a); }
  function avatarHTML(p, cls) {
    var c = 'av ' + (cls || '');
    if (p.avatar && avatarSicher(p.avatar)) return '<span class="' + esc(c) + '" style="background-image:url(' + p.avatar + ')"></span>';
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
        // Ein schon ausgebulltes Einzel bringt seinen Anwerfer mit; sonst wird
        // auf diesem Geraet ausgebullt (seit der SWO 10/2026 auch im Ligaspiel).
        starter: m.starter || null,
        posPaar: m.posPaar || null, scheibe: m.scheibe || null,
        legs: [], done: false, winner: null, at: null
      };
    });
  }

  /* Hat das andere Geraet das geteilte Turnier abgeschlossen und liegt sein
     Archiv-Eintrag schon hier, ist die eigene Kopie erledigt: aufraeumen und
     Bescheid sagen - sonst liefe sie hier als "offen" weiter. */
  function geteiltesTurnierAufraeumen() {
    if (!S.tour || !S.tour.geteilt || !S.tour.sid || !S.tour.beendet) return false;
    var archiv = null;
    S.history.forEach(function (h) { if (h.id === S.tour.sid) archiv = h; });
    if (!archiv) return false;
    /* Nie etwas wegraeumen, das nur hier liegt: hat dieses Geraet ein
       fertiges Einzel, das im Archiv fehlt, bleibt die Kopie stehen. */
    var fehlt = S.matches.some(function (m) {
      if (!m.done) return false;
      var a = (archiv.matches || []).filter(function (x) { return x.id === m.id; })[0];
      return !a || !a.done;
    });
    if (fehlt) return false;
    /* Nie mitten in einem angefangenen Einzel oder einer Korrektur. */
    var laeuft = S.matches.some(function (m) {
      return !m.done && (m.korrektur || m.legs.some(function (l) { return l.visits.length > 0; }));
    });
    if (laeuft) return false;
    var war = S.tour.liga ? 'Das Ligaspiel' : 'Das Turnier';
    S.tour = null; S.matches = []; S.current = null;
    if (['tournament', 'game', 'bulloff', 'winner', 'summary', 'bericht'].indexOf(S.screen) >= 0) {
      S.screen = 'setup';
    }
    UI.overlay = { type: 'hinweis', titel: war + ' ist abgeschlossen',
      text: war + ' wurde auf dem anderen Gerät abgeschlossen. Alle Ergebnisse stehen im Archiv' +
        ' (im Liga-Spielplan unter „Ergebnisse“ und „Spielbericht“).' };
    save();
    return true;
  }

  /* Der Herzschlag sagt: dieses Einzel hat das andere Geraet uebernommen
     (hier kam zehn Minuten lang nichts). */
  function einzelVerloren(matchId, text, grund) {
    if (S.current !== matchId) return;
    if (grund === 'beendet') {
      /* Turnier woanders beendet: hier zu Ende spielen, das Ergebnis wird
         nachgetragen (auch ins Archiv). Nur Bescheid sagen. */
      if (S.tour) S.tour.beendet = true;
      return;
    }
    S.current = null;
    if (S.screen === 'game' || S.screen === 'bulloff') S.screen = 'tournament';
    UI.overlay = { type: 'hinweis', titel: 'Einzel übernommen',
      text: (text || 'Das andere Gerät hat dieses Einzel übernommen.') + ' Das Ergebnis kommt von dort.' };
    save(); render();
  }

  function uebernehmeTurnier(daten, beitritt) {
    if (!daten || !daten.plan) return false;
    var neu = false;
    /* Neu angelegt wird ein Turnier nur beim Beitreten. Eine verspaetete
       Server-Antwort zu einem schon beendeten oder fremden Turnier darf den
       Stand hier nicht ueberschreiben. */
    if (!beitritt && (!S.tour || S.tour.sid !== daten.id)) return false;

    // Noch nicht dabei: Plan übernehmen. Ein laufendes eigenes Turnier ist an
    // dieser Stelle schon weggeräumt – siehe turnierBeitreten().
    if (!S.tour || S.tour.sid !== daten.id) {
      S.tour = {
        start: daten.plan.start, bestOf: daten.plan.bestOf,
        players: (daten.plan.players || []).slice(),
        geteilt: true, sid: daten.id, cursor: 0,
        angelegtVon: daten.angelegtVonName || null,
        liga: daten.plan.liga || null,
        planStand: daten.plan.planStand || 0
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

    /* Spielerwechsel auf dem anderen iPad: neuerer Plan. */
    if (S.tour && S.tour.sid === daten.id && (daten.plan.planStand || 0) > (S.tour.planStand || 0)) {
      if (planAnwenden(daten.plan)) neu = true;
    }

    var ich = window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().id : null;
    (daten.partien || []).forEach(function (p) {
      /* Jede Partie fuer sich: ein unlesbarer Eintrag darf die anderen
         nicht aufhalten. */
      try { if (partieUebernehmen(p)) neu = true; } catch (e) { /* naechster Abgleich */ }
    });
    function partieUebernehmen(p) {
      var neu = false;
      var m = matchById(p.matchId);
      if (!m) return false;
      if (p.result && !partieGueltig(p.result)) return;   // kaputtes Ergebnis nicht uebernehmen
      if (p.result) {
        /* Ein fertiges Ergebnis gewinnt immer – auch gegen eine Partie, die
           hier gerade offen aussieht. Wer sie beansprucht hatte, hat sie
           gespielt; alles andere wäre ein zweiter Datenstand derselben
           Partie, und genau den soll es nicht geben. */
        /* Ausnahme: dieses Geraet hat die eigene, schon gemeldete Partie per
           Zuruecknehmen wieder geoeffnet und korrigiert sie gerade. Dann
           kommt das neue Ergebnis beim naechsten Checkout ohnehin hoch. */
        if (m.korrektur && !m.done && Date.now() - m.korrektur < 15 * 60 * 1000) return neu;
        /* Ein hier fertiges, noch nicht beim Server angekommenes Ergebnis
           (gemeldet false/fehlt) gewinnt, bis es oben ist oder der Server
           es ausdruecklich ablehnt ('abgelehnt') - sonst ueberschriebe der
           volle Abgleich eine Korrektur mit dem alten Stand. */
        if (m.done && m.gemeldet !== true && m.gemeldet !== 'abgelehnt' && m.at !== p.result.at) return neu;
        if (!m.done || m.at !== p.result.at) {
          S.matches[S.matches.indexOf(m)] = p.result;
          if (S.current === m.id) S.current = null;
          neu = true;
        }
        var fertig = matchById(p.matchId);
        if (fertig && fertig.belegtVon) { delete fertig.belegtVon; delete fertig.belegtSeit; }
        if (fertig) fertig.gemeldet = true;   // liegt beim Server - nichts nachzureichen
        return neu;
      }
      // Fremder Anspruch: kein Start-Knopf, dafür der Name daneben.
      var von = p.claimedBy && p.claimedBy !== ich ? (p.claimedByName || 'jemandem') : null;
      if ((m.belegtVon || null) !== von) {
        if (von) m.belegtVon = von; else delete m.belegtVon;
        neu = true;
      }
      /* Seit wann (nach Server-Uhr) - ein Anspruch ohne Lebenszeichen gilt
         nach zehn Minuten als haengengeblieben und darf uebernommen werden. */
      if (von) m.belegtSeit = Date.now() - (typeof p.claimAlter === 'number' ? p.claimAlter : 0);
      else delete m.belegtSeit;
      return neu;
    }

    if (typeof daten.cursor === 'number' && daten.cursor > (S.tour.cursor || 0)) {
      S.tour.cursor = daten.cursor;
    }
    if (typeof daten.claimFrist === 'number') S.tour.claimFrist = daten.claimFrist;
    if (daten.zuschauer && S.tour.zuschauer !== daten.zuschauer) { S.tour.zuschauer = daten.zuschauer; neu = true; }
    if (daten.status === 'beendet') S.tour.beendet = true;
    if (geteiltesTurnierAufraeumen()) neu = true;
    /* Frische Ergebnisse des anderen Geraets sofort ins Bild -- sonst zeigt
       die Tabelle rechts alte Averages, bis irgendetwas anderes neu zeichnet. */
    if (neu) setTimeout(render, 0);
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
    uebernehmeTurnier(daten, true);
    S.screen = 'tournament';
    save();
    render();
  }
  /* ================= Online-Spiel ================= */
  /*
   * Ein Schnelles Spiel oder Finisher an zwei Orten: beide stehen an ihrer
   * Scheibe, telefonieren, und der Spielstand liegt auf dem Server. Beide
   * sehen ihn, beide tragen ein. S.game.online = {sid, seq, hash, mit}
   * merkt, unter welcher Kennung das Spiel dort liegt, welche Version wir
   * kennen und wessen Stand das ist. Alles andere am Spiel bleibt, wie es
   * ist – der Server verwahrt bloss und rechnet nichts.
   */
  /* Alle freien Spiele gehen online -- der Stand wandert bei jeder Spielart
     als Ganzes. Nur das Turnier hat seinen eigenen, geteilten Weg. */
  var LIVE_KINDS = { quick: 1, finisher: 1, cricket: 1, rtw: 1 };

  function liveSpiel() { return S.game && S.game.online ? S.game : null; }

  function liveNutzer() {
    return window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().id : null;
  }

  /* Online geht nur angemeldet, in den Spielarten dafuer und mit
     mindestens einem Mitspieler, der ein Konto hat -- sonst gaebe es
     niemanden, auf dessen Handy das Spiel auftauchen koennte. */
  function liveMitspieler(ids) {
    var ich = liveNutzer();
    return (ids || []).filter(function (id) { return String(id).indexOf('u_') === 0 && id !== ich; });
  }
  function liveMoeglich(kind, ids) {
    return !!(liveNutzer() && window.DartSync && window.DartSync.live && LIVE_KINDS[kind] && liveMitspieler(ids).length);
  }

  /* Der Stand, wie er zum Server geht: das Spiel ohne das online-Feld. */
  function liveText(g) {
    var k = {};
    Object.keys(g).forEach(function (key) { if (key !== 'online' && key !== 'offen') k[key] = g[key]; });
    /* Die halbfertige Aufnahme (Einzel-Darts) geht mit: so sieht das andere
       Tablet jeden Dart sofort -- Rest und Kacheln laufen live mit, nicht
       erst mit der gebuchten Aufnahme. Der Empfaenger legt sie in UI.darts
       und loescht den Schluessel wieder (liveUebernehmen), damit beide
       Seiten denselben Text und damit denselben Hash bilden. */
    if (g === S.game && g.kind === 'quick' && UI.darts.length) {
      k.offen = UI.darts.map(function (d) { return { m: d.m, n: d.n, v: d.v }; });
    }
    return JSON.stringify(k);
  }
  function liveHash(text) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36) + ':' + text.length;
  }

  /* Was noch nicht beim Server ist -- oder null, wenn alles oben ist. */
  function liveStand() {
    var g = liveSpiel();
    if (!g || g.online.wartet) return null;   // noch nicht beim Server angelegt
    var text = liveText(g);
    if (liveHash(text) === g.online.hash) return null;
    return { state: JSON.parse(text), seq: g.online.seq || 0, text: text };
  }

  function liveGeschrieben(spiel, text) {
    var g = liveSpiel();
    if (!g || !spiel || spiel.id !== g.online.sid) return;
    g.online.seq = spiel.seq;
    g.online.hash = liveHash(text);
    save();
  }

  /* Nach jeder Aenderung: kurz sammeln, dann hochschieben. Aus save()
     gerufen, damit keine Stelle im Spiel vergessen werden kann. */
  var liveTimer = null;
  function liveAnstossen() {
    if (!liveSpiel() || !window.DartSync || !window.DartSync.live) return;
    if (liveTimer) return;
    liveTimer = setTimeout(function () {
      liveTimer = null;
      if (liveStand()) window.DartSync.live.schreiben();
    }, 200);
  }

  /* Namen der Mitspieler mitschicken, damit ein Gast von diesem Geraet auf
     dem anderen nicht "Unbekannt" heisst. */
  function liveNamen(ids) {
    var namen = {};
    ids.forEach(function (id) { namen[id] = pname(id); });
    return namen;
  }
  function liveNamenUebernehmen(g) {
    if (!g || !g.namen) return;
    Object.keys(g.namen).forEach(function (fid) {
      if (S.profiles.some(function (p) { return p.id === fid; })) return;
      S.profiles.push({
        id: fid, name: String(g.namen[fid]).slice(0, 30), voll: String(g.namen[fid]).slice(0, 60),
        avatar: null, hue: freeHue(), created: Date.now(),
        gast: true, hidden: true
      });
    });
  }

  function liveMeta(spiel, text) {
    var ich = liveNutzer();
    return {
      sid: spiel.id, seq: spiel.seq, hash: liveHash(text),
      mit: (spiel.spieler || []).filter(function (id) { return id !== ich; })
    };
  }

  /*
   * Der Verlauf eines Spiels als Liste vergleichbarer Eintraege -- jede
   * gebuchte Aufnahme (X01, mit Leg-Nummer) bzw. jeder Wurf (Cricket, RTW,
   * Finisher mit Runden-Nummer). Positionsweise verglichen zeigt das genau,
   * was beim anderen dazugekommen ist, auch ueber Leg-Grenzen, nach einem
   * Undo oder wenn zwischen zwei Abfragen mehrere Aufnahmen lagen.
   */
  function spielVerlauf(g) {
    var out = [];
    if (!g) return out;
    if (Array.isArray(g.legs)) {
      g.legs.forEach(function (l, li) {
        (l.visits || []).forEach(function (v) {
          out.push({ key: li + '|' + v.p + '|' + v.s + '|' + (v.b ? 1 : 0) + '|' + v.d + '|' + (v.c ? 1 : 0) + '|' + (v.o || 0), v: v });
        });
      });
    } else if (Array.isArray(g.rounds)) {
      g.rounds.forEach(function (rd, ri) {
        (rd.throws || []).forEach(function (t) { out.push({ key: ri + '|' + JSON.stringify(t) }); });
        if (rd.sieger) out.push({ key: ri + '|sieger|' + rd.sieger });
      });
    } else if (Array.isArray(g.throws)) {
      g.throws.forEach(function (t) { out.push({ key: JSON.stringify(t) }); });
    }
    return out;
  }
  /* Was im neuen Verlauf nach der ersten Abweichung vom alten steht. */
  function verlaufNeu(alt, neu) {
    var a = spielVerlauf(alt), n = spielVerlauf(neu);
    var i = 0;
    while (i < a.length && i < n.length && a[i].key === n[i].key) i++;
    return { neu: n.slice(i), verloren: a.slice(i), gleich: i === a.length && i === n.length };
  }

  /* Wer ist gerade am Wurf (nur X01-Spiele im Online-Modus)? */
  function liveAmWurf(g) {
    if (!g || !Array.isArray(g.legs) || g.done || !g.legs.length) return null;
    var leg = g.legs[g.legs.length - 1];
    if (leg.winner) return null;
    return activePlayer(leg, g);
  }

  /* Die Darts, die gerade vom Mitspieler kommen: solange er am Wurf ist und
     sie frisch sind, tippt hier niemand dazwischen (Zurueck loeschte sonst
     seine Darts). Nach 45 s ohne Nachricht gibt die Sperre nach, damit ein
     abgestuerztes Handy niemanden festhaelt. */
  function fremdeDartsSperre() {
    var g = liveSpiel();
    if (!g || !UI.darts.length || !UI.dartsFremd) return false;
    if (Date.now() - (UI.dartsFremdZeit || 0) > 45000) return false;
    var am = liveAmWurf(g);
    return !!am && am !== liveNutzer() && String(am).indexOf('u_') === 0;
  }

  /* Protokollstand des Online-Formats. Kommt ein hoeherer herein, laeuft
     beim anderen eine neuere App -- dann lieber Bescheid sagen. */
  var LIVE_VERSION = 1;

  /*
   * Fremder Stand vom Server. Ersetzt das Spiel als Ganzes; halb getippte
   * Eingaben sind danach hinfaellig, denn der andere hat gerade geworfen.
   * Gibt zurueck, ob sich etwas geaendert hat.
   */
  function liveUebernehmen(spiel, konflikt) {
    var g = liveSpiel();
    if (!g || !spiel || spiel.id !== g.online.sid) return false;
    if (!spiel.state || spiel.seq <= (g.online.seq || 0)) return false;
    if (!spielGueltig(spiel.state)) return false;   // kaputter Stand: lieber den eigenen behalten
    var alt = g;
    var neu = spiel.state;
    var text = JSON.stringify(neu);
    var ich = liveNutzer();
    var eigen = !!(spiel.geaendertVon && spiel.geaendertVon === ich);
    var fremd = !!(spiel.geaendertVon && spiel.geaendertVon !== ich);

    /* Mein eigener Stand kommt zurueck (die Abfrage war schneller als die
       Antwort auf meinen PUT, oder die PUT-Antwort ging im Funkloch verloren
       und der naechste PUT bekam 409): nur Version merken. Was ich
       inzwischen weiter getippt habe, bleibt stehen und geht mit dem
       naechsten PUT hoch. Das gilt aber nur, wenn der Stand NICHTS enthaelt,
       was hier fehlt - spielt dasselbe Konto auf einem zweiten Geraet, hat
       das vielleicht gerade eingetragen, und dann wird uebernommen (sonst
       schoeben sich zwei Geraete die Aufnahme endlos gegenseitig weg). */
    var eigenVgl = eigen ? verlaufNeu(alt, neu) : null;
    var eigenOffen = Array.isArray(neu.offen) ? neu.offen.length : 0;
    if (eigen && spiel.status !== 'zu' && !eigenVgl.neu.length && eigenOffen <= UI.darts.length &&
        !(neu.done && !alt.done)) {
      g.online.seq = spiel.seq;
      g.online.hash = liveHash(text);
      save();   // schickt, falls sich lokal inzwischen etwas geaendert hat
      return false;
    }

    neu.online = liveMeta(spiel, text);
    liveNamenUebernehmen(neu);
    if (typeof neu.lv === 'number' && neu.lv > LIVE_VERSION && !UI.liveVersionGemeldet) {
      UI.liveVersionGemeldet = true;
      UI.overlay = { type: 'hinweis', titel: 'Neuere App beim Mitspieler', text: 'Dein Mitspieler nutzt eine neuere Version der App. Bitte lade die Seite neu, damit ihr beide dasselbe seht.' };
    }
    /* Wer gerade wirft, dessen halbfertige Aufnahme uebernehmen wir mit --
       wer als Naechster tippt, tippt auf derselben Aufnahme weiter. */
    var offen = Array.isArray(neu.offen) ? neu.offen.map(function (d) { return { m: d.m, n: d.n, v: d.v }; }) : [];
    delete neu.offen;
    var vgl = verlaufNeu(alt, neu);
    var gebucht = vgl.neu.length > 0 || vgl.verloren.length > 0;

    /* Der andere hat eine 180 oder 60 geworfen: auch hier feiern -- die
       Feier gehoert zum Spiel, nicht zum Geraet, das eintippt. Jede neue
       Aufnahme zaehlt (auch das 60er-Checkout am Leg- oder Matchende), bei
       mehreren gewinnt die hoechste. */
    if (fremd && Array.isArray(neu.legs)) {
      var beste = null;
      /* Nach einer Korrektur weiter vorn im Leg stehen alle spaeteren
         Aufnahmen wieder in vgl.neu - gefeiert wird nur, was es vorher
         wirklich noch nicht gab. */
      var schonDa = {};
      vgl.verloren.forEach(function (e) { schonDa[e.key] = (schonDa[e.key] || 0) + 1; });
      vgl.neu.forEach(function (e) {
        if (schonDa[e.key]) { schonDa[e.key]--; return; }
        var v = e.v;
        if (!v || v.b || (v.s !== 180 && v.s !== 60)) return;
        if (!beste || v.s > beste.s) beste = v;
      });
      if (beste && beste.s === 180) feiere180(beste.p);
      else if (beste) feiere60(beste.p);
    }

    S.game = neu;
    var dartsVorher = UI.darts.length;
    UI.darts = offen; UI.input = ''; UI.error = '';
    UI.dartsFremd = fremd && offen.length > 0;
    UI.dartsFremdZeit = Date.now();
    /* Das Drehrad der letzten Aufnahme laeuft nur bei einer neuen Buchung,
       nicht bei jedem einzelnen Dart des anderen. */
    if (gebucht) UI.aufnahmeZeit = Date.now();
    /* Halbfertige Dialoge beziehen sich auf den alten Stand. */
    if (UI.overlay && (UI.overlay.type === 'checkout-darts' || UI.overlay.type === 'edit-visit')) UI.overlay = null;
    var wer = spiel.geaendertVonName || 'Dein Mitspieler';
    /* Der andere hat gebucht: klopfen, damit man vom Board zum Handy
       schaut. Ein einzelner Dart mitten in der Aufnahme bekommt nur den
       leisen Einschlag -- sonst klopft es bis zu viermal pro Aufnahme. */
    if (fremd) {
      if (gebucht) klopfen();
      else if (offen.length !== dartsVorher && offen.length) pomp();
    }

    if (spiel.status === 'zu') {
      /* Der andere hat gespeichert oder abgebrochen. Gespeichert wird hier
         genauso -- derselbe Eintrag, dieselbe Kennung, der Server kennt ihn
         dann schon. */
      if (neu.done) { archiveGame(neu); UI.overlay = { type: 'hinweis', titel: 'Spiel gespeichert', text: wer + ' hat das Spiel abgeschlossen. Es steht jetzt in der Statistik.' }; }
      else UI.overlay = { type: 'hinweis', titel: 'Spiel abgebrochen', text: wer + ' hat das Online-Spiel abgebrochen.' };
      S.game = null;
      /* Wer gerade die Auswertung anschaut, bleibt dort -- sie zeigt jetzt
         den archivierten Eintrag statt des laufenden Spiels. */
      if (S.screen === 'summary' && neu.done) UI.summary = { kind: neu.kind, id: neu.id };
      else S.screen = 'setup';
      /* "Nochmal spielen" beim anderen legt gleich ein neues Spiel an --
         kurz danach nachsehen, damit der Mitspielen-Knopf sofort da ist. */
      liveNeuesSpielErwarten();
      save();
      return true;
    }

    /* Spielende: der Glueckwunsch ersetzt jeden anderen Dialog. */
    if (neu.done && !alt.done) UI.overlay = { type: 'game-done', pid: neu.winner };
    if (!neu.done && alt.done && UI.overlay && UI.overlay.type === 'game-done') UI.overlay = null;
    /* Leg- oder Satzende beim anderen: hier denselben Dialog zeigen, statt
       kommentarlos auf 501 zu springen. */
    if (!neu.done && Array.isArray(neu.legs) && fremd && neu.kind === 'quick') {
      var wonAlt = (alt.legs || []).filter(function (l) { return l.winner; }).length;
      var wonNeu = neu.legs.filter(function (l) { return l.winner; }).length;
      if (wonNeu > wonAlt && (!UI.overlay || UI.overlay.type === 'hinweis' || UI.overlay.type === 'leg-done')) {
        var lz = neu.legs.filter(function (l) { return l.winner; }).pop();
        UI.overlay = { type: 'leg-done', pid: lz.winner, satz: satzStand(neu).satzZu, fremd: true };
      }
    }
    if (S.screen === 'bulloff' && neu.started) S.screen = spielScreen(neu.kind);
    /* Konflikt: der andere war schneller. Steht meine Eingabe schon in
       seinem Stand (beide haben dieselbe Aufnahme getippt), ist nichts
       verloren -- dann kein "bitte nochmal eintragen", sonst bucht, wer
       folgt, doppelt. */
    if (konflikt && !UI.overlay && vgl.verloren.length) {
      UI.overlay = { type: 'hinweis', titel: 'Der andere war schneller', text: wer + ' hat gerade eingetragen. Deine letzte Eingabe wurde nicht übernommen – bitte prüfen und ggf. nochmal eintragen.' };
    }
    save();
    return true;
  }

  /* Bildschirm wach halten (Screen Wake Lock), solange ein Online-Spiel
     im Bild ist. Der Browser gibt die Sperre beim Wegschalten selbst frei;
     beim Zurueckkommen wird sie neu angefordert. */
  var wachSperre = null, wachSoll = false, wachAnfrage = false;
  function wachHalten(an) {
    wachSoll = !!an;
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    if (wachSoll && !wachSperre && !wachAnfrage && !document.hidden) {
      wachAnfrage = true;
      navigator.wakeLock.request('screen').then(function (l) {
        wachAnfrage = false;
        wachSperre = l;
        l.addEventListener('release', function () { if (wachSperre === l) wachSperre = null; });
        if (!wachSoll) { wachSperre = null; l.release().catch(function () {}); }
      }).catch(function () { wachAnfrage = false; });
    } else if (!wachSoll && wachSperre) {
      var l = wachSperre;
      wachSperre = null;
      l.release().catch(function () {});
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && wachSoll) wachHalten(true);
  });

  /* Ist der Ton gesperrt (iOS nach Neuladen oder dunklem Bildschirm), steht
     im Online-Spiel ein kleiner Knopf "Ton an" -- sonst wartet man
     vergeblich auf das Klopfen. Der Tipp selbst gibt den Ton frei. */
  function tonKnopf(an) {
    var b = $('ton-an');
    var zeigen = an && tonAn() && window.DartSound && window.DartSound.status && !window.DartSound.status();
    if (!zeigen) { if (b) b.classList.add('hidden'); return; }
    if (!b) {
      b = document.createElement('button');
      b.id = 'ton-an';
      b.type = 'button';
      b.className = 'btn small ton-an';
      b.setAttribute('data-action', 'ton-an');
      b.textContent = '🔇 Ton an – einmal antippen';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:60;min-height:44px;';
      document.body.appendChild(b);
    }
    b.classList.remove('hidden');
  }
  document.addEventListener('dart-ton', function () { if (liveSpiel()) tonKnopf(true); });

  /* Keine Verbindung im Online-Spiel: nicht nur klein im Kopf, sondern als
     Leiste oben -- sonst wartet man auf einen Mitspieler, der nichts sieht. */
  function verbindungsHinweis(an) {
    var b = $('live-stoerung');
    if (!an) { if (b) b.classList.add('hidden'); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'live-stoerung';
      b.className = 'save-warning';
      b.setAttribute('role', 'status');
      b.textContent = '📶 Keine Verbindung zum Server – deine Eingaben bleiben hier und werden nachgeschickt, sobald wieder Netz da ist.';
      document.body.insertBefore(b, document.body.firstChild);
    }
    b.classList.remove('hidden');
  }

  /* Nach "zu": in den naechsten Sekunden zweimal nach einem neuen Spiel
     fragen (der andere drueckt oft gleich "Nochmal spielen"). */
  function liveNeuesSpielErwarten() {
    [1500, 4000].forEach(function (ms) {
      setTimeout(function () { if (!liveSpiel()) liveBeitretbareHolen(); }, ms);
    });
  }

  /* Spiel beim Server weg: lokal weiterspielen, nicht mehr nachfragen --
     aber Bescheid sagen, sonst wartet man ewig auf den anderen. */
  function liveGetrennt() {
    var g = liveSpiel();
    if (!g) return;
    delete g.online;
    if (!UI.overlay) UI.overlay = { type: 'hinweis', titel: 'Online-Verbindung beendet', text: 'Dieses Spiel liegt nicht mehr beim Server. Es läuft hier lokal weiter, dein Mitspieler sieht es aber nicht mehr.' };
    save();
  }

  /* " · online mit Tobi" -- und wenn die Verbindung hakt, steht es dabei. */
  function liveLabel(g) {
    if (!g || !g.online) return '';
    var st = window.DartSync && window.DartSync.live ? window.DartSync.live.status() : null;
    var mit = (g.online.mit || []).map(pname).join(', ');
    return ' · online' + (mit ? ' mit ' + mit : '') +
      (g.online.wartet ? ' · wird angelegt …' : st && st.stoerung ? ' · keine Verbindung' : '');
  }

  function liveEnde(g) {
    if (!g || !g.online || !window.DartSync || !window.DartSync.live) return;
    if (g.online.wartet) return;   // nie beim Server angekommen
    var stand = S.game === g ? liveStand() : null;
    window.DartSync.live.ende(g.online.sid, stand);
  }

  /* Neues Spiel online anmelden. Klappt es nicht (kein Netz, Server weg),
     laeuft es still lokal weiter -- wie beim geteilten Turnier. */
  var liveAnmeldungLaeuft = false;
  /* Ohne Netz nicht bei jedem Zeichnen neu anfragen: 5 s Pause zwischen
     den Versuchen, nach dem dritten Fehlschlag ein Hinweis. */
  var liveAnlegenFehler = 0, liveAnlegenNaechster = 0, liveAnlegenTimer = null;
  function liveAnlegen(g) {
    if (liveAnmeldungLaeuft) return Promise.resolve();
    if (Date.now() < liveAnlegenNaechster) return Promise.resolve();
    liveAnmeldungLaeuft = true;
    var konten = liveMitspieler(g.players);
    g.namen = liveNamen(g.players);
    /* Die Formatversion steht im Spiel selbst (nicht erst beim Senden
       angehaengt) -- so bilden alte und neue App denselben Hash. */
    g.lv = LIVE_VERSION;
    var text = liveText(g);
    return window.DartSync.live.anlegen(g.id, g.kind, JSON.parse(text), konten).then(function (spiel) {
      liveAnmeldungLaeuft = false;
      liveAnlegenFehler = 0; liveAnlegenNaechster = 0;
      if (S.game !== g) return;
      g.online = liveMeta(spiel, text);
      save(); render();
      /* Was waehrend der Anmeldung schon eingetippt wurde, geht jetzt hoch. */
      liveAnstossen();
    }).catch(function (e) {
      liveAnmeldungLaeuft = false;
      if (S.game !== g) return;
      /* Kein Netz: spaeter nochmal (render() holt das nach). Abgelehnt:
         lokal weiterspielen und das auch sagen -- der Hinweis im Setup hat
         schliesslich versprochen, dass es beim anderen auftaucht. */
      if (e && e.status && e.status !== 429 && e.status < 500) {
        delete g.online;
        UI.overlay = { type: 'hinweis', titel: 'Nur hier am Gerät', text: 'Das Online-Spiel konnte nicht angelegt werden: ' + (e.message || '') + ' Das Spiel läuft jetzt nur auf diesem Gerät.' };
      } else {
        liveAnlegenFehler++;
        liveAnlegenNaechster = Date.now() + 5000;
        if (liveAnlegenTimer) clearTimeout(liveAnlegenTimer);
        liveAnlegenTimer = setTimeout(function () { liveAnlegenTimer = null; if (liveSpiel() === g) render(); }, 5100);
        if (liveAnlegenFehler === 3 && !UI.overlay) {
          UI.overlay = { type: 'hinweis', titel: 'Noch keine Verbindung', text: 'Das Online-Spiel kommt gerade nicht beim Server an. Ihr könnt schon spielen – sobald wieder Netz da ist, wird es angelegt und dein Mitspieler sieht den Stand.' };
        }
      }
      save(); render();
    });
  }

  /* Einem Online-Spiel beitreten. Ein fertiges eigenes Spiel wird vorher
     gesichert; ein angefangenes fragt vorher nach. */
  function liveBeitreten(spiel) {
    if (!spiel || !spiel.state || !spielGueltig(spiel.state)) return;
    if (S.game && S.game.done) archiveGame(S.game);
    else if (S.game) liveEnde(S.game);   // ein eigenes Online-Spiel wird sauber geschlossen
    var neu = spiel.state;
    var text = JSON.stringify(neu);
    neu.online = liveMeta(spiel, text);
    liveNamenUebernehmen(neu);
    S.game = neu;
    S.mode = neu.kind;
    /* Aufstellung und Online-Schalter mitnehmen: "Nochmal spielen" soll
       hier dieselben Leute wieder online zusammenbringen. */
    S.lineup = (neu.players || []).slice();
    S.settings.online = 1;
    UI.overlay = null; UI.darts = []; UI.input = ''; UI.error = ''; UI.mult = 1;
    UI.turnier = false; UI.bullReihe = [];
    S.screen = neu.started ? spielScreen(neu.kind) : 'bulloff';
    save(); render();
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

  /* ===== Spieldauer: Saetze und Legs im Schnellen Spiel =====
     Ein Schnelles Spiel kann ueber mehrere Legs und Saetze gehen. Die Legs
     bleiben dabei eine flache Liste -- Undo, Statistik und Online-Abgleich
     kennen nichts anderes. Welcher Satz gerade laeuft, wird daraus
     nachgerechnet: sobald einer die Legs fuer den Satz hat, beginnt der
     naechste. "First to N" und "Best of 2N-1" sind dasselbe Ziel; gespeichert
     wird die Best-of-Zahl (bestOf fuer Legs je Satz, saetzeBestOf fuer die
     Saetze), die Schreibweise (spieldauer) nur fuer die Anzeige. */
  var QUICK_MAX = 9;   // hoechstens "First to 9" bzw. "Best of 17"
  function bestOfAus(modus, n) { return modus === 1 ? n : 2 * n - 1; }
  function matchSaetzeZuGewinnen(match) {
    return match && match.saetzeBestOf ? Math.floor(match.saetzeBestOf / 2) + 1 : 1;
  }
  /* Nur fuer Schnelle Spiele gedacht: die tragen bestOf immer selbst. */
  function mehrereLegs(match) {
    return !!match && ((match.bestOf || 1) > 1 || (match.saetzeBestOf || 1) > 1);
  }
  function satzStand(match) {
    var gewinnLegs = matchLegsToWin(match);
    var gewinnSaetze = matchSaetzeZuGewinnen(match);
    var saetze = {}, legs = {};
    match.p.forEach(function (id) { saetze[id] = 0; legs[id] = 0; });
    var satzNr = 1, legNr = 1, satzZu = false, sieger = null;
    match.legs.forEach(function (l) {
      if (!l.winner || sieger) return;
      satzZu = false;
      legs[l.winner]++; legNr++;
      if (legs[l.winner] >= gewinnLegs) {
        saetze[l.winner]++;
        satzZu = true;
        if (saetze[l.winner] >= gewinnSaetze) sieger = l.winner;
        else {
          match.p.forEach(function (id) { legs[id] = 0; });
          satzNr++; legNr = 1;
        }
      }
    });
    return { saetze: saetze, legs: legs, satzNr: satzNr, legNr: legNr, satzZu: satzZu,
      gewinnLegs: gewinnLegs, gewinnSaetze: gewinnSaetze, sieger: sieger };
  }
  /* "First to 2 Sätze à 3 Legs" bzw. "Best of 5 Legs" -- so, wie es
     eingestellt wurde. */
  function dauerText(match) {
    var d = match.spieldauer || { modus: 1, saetze: match.saetzeBestOf || 1, legs: match.bestOf || 1 };
    var w = d.modus === 1 ? 'Best of ' : 'First to ';
    if (matchSaetzeZuGewinnen(match) > 1) return w + d.saetze + ' Sätze à ' + d.legs + (d.legs === 1 ? ' Leg' : ' Legs');
    return w + d.legs + (d.legs === 1 ? ' Leg' : ' Legs');
  }
  /* Stand eines Spielers, kurz: "Sätze 1 · Legs 2" oder nur "Legs 2". */
  function kurzStand(st, pid) {
    return (st.gewinnSaetze > 1 ? 'Sätze ' + st.saetze[pid] + ' · ' : '') + 'Legs ' + st.legs[pid];
  }
  /* Stand aller Spieler: bei zweien "2:1", ab dreien mit Namen. */
  function standZeile(match, st, nurSaetze) {
    st = st || satzStand(match);
    var zeile = function (obj) {
      return match.p.length === 2 ? obj[match.p[0]] + ':' + obj[match.p[1]]
        : match.p.map(function (id) { return esc(pname(id)) + ' ' + obj[id]; }).join(' · ');
    };
    if (nurSaetze) return 'Sätze ' + zeile(st.saetze);
    return (st.gewinnSaetze > 1 ? 'Sätze ' + zeile(st.saetze) + ' · ' : '') + 'Legs ' + zeile(st.legs);
  }

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
     sie kommt ja auch deutlich öfter als die 180. 650 ms, damit das
     Tastenfeld nach der häufigsten Aufnahme des Abends sofort wieder frei ist. */
  var SECHZIG_MS = 650;

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
    if (!box || !feiernAn()) return;
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
    if (!box || !feiernAn()) return;
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
    /* Zeitstempel fuer die Drehrad-Animation der letzten Aufnahme (renderGame). */
    UI.aufnahmeZeit = Date.now();

    /* Im Ligaspiel wird nicht gefeiert - der Schreiber ist Schiedsrichter,
       und ein Vollbild-Loewe mitten im Einzel gegen ein fremdes Team waere
       genau die Zwischenaktion, die die SWO dem Schreiber verbietet. */
    var ligaMatch = m.kind !== 'quick' && S.tour && S.tour.liga && !S.tour.liga.uebung;
    // Höher geht es mit drei Darts nicht.
    if (!isBust && score === 180 && !ligaMatch) feiere180(pid);
    // Die 60 gehört dem Löwen – bei jeder geworfenen 60 (siehe feiere60).
    else if (!isBust && score === 60 && !ligaMatch) feiere60(pid);

    UI.input = ''; UI.darts = []; UI.mult = 1; UI.error = '';
    /* "Punkte" von Hand gilt nur fuer diese Aufnahme, danach entscheidet
       wieder "Einzel-Darts ab Rest". Wer dagegen Einzel-Darts waehlt, will
       Dart fuer Dart mitschreiben - das bleibt bis zum Ende der Partie. */
    if (UI.modeOverride !== 'darts') UI.modeOverride = null;

    if (isCheckout) {
      leg.winner = pid;
      var st = satzStand(m);
      if (st.sieger === pid) {
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
          delete m.korrektur;
          window.DartSync.turnier.ergebnis(m);
        }
      } else {
        /* Ist damit ein ganzer Satz zu, sagt der Dialog das auch. */
        UI.overlay = { type: 'leg-done', pid: pid, satz: st.satzZu };
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
    /* Einzeldarts dieser Aufnahme stehen schon: eine Gesamtzahl daneben
       wuerde sie verwerfen (auch beim Mitspieler im Online-Spiel). */
    if (UI.darts.length) { UI.error = 'Die Aufnahme läuft in Einzel-Darts – bitte dort weiter eintragen.'; UI.input = ''; render(); return; }

    pomp();
    var after = rest - v;
    if (after < 0 || after === 1) { commitVisit(v, 3, false, true); return; }
    if (after === 0) {
      var opts = [];
      for (var n = 1; n <= 3; n++) if (Checkout.possible(rest, n)) opts.push(n);
      if (!opts.length) { UI.error = 'Kein gültiges Finish auf Doppel'; UI.input = ''; render(); return; }
      UI.overlay = { type: 'checkout-darts', score: v, options: opts };
      save();   // die offene Frage uebersteht einen Neustart
      render();
      return;
    }
    commitVisit(v, 3, false, false);
  }

  function pressKey(k) {
    UI.error = '';
    /* Zurueck nimmt erst Ziffern, dann - bei leerem Feld - die letzte
       Aufnahme zurueck: so kommt man mit derselben Taste zum Wurf davor
       und zum vorigen Spieler. */
    if (k === 'del') {
      if (UI.input === '') { undo(); return; }
      klick(); UI.input = UI.input.slice(0, -1); render(); return;
    }
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
    tipp();
    UI.input = String(val);
    /* Keine automatische Uebernahme mehr: jede Aufnahme wird mit OK
       bestaetigt - ein Vertipper bei der dritten Ziffer landete sonst sofort
       im Spiel. */
    render();
  }

  /* ================= Eingabe: Einzel-Darts ================= */
  function pushDart(mult, num) {
    UI.error = '';
    var m = currentMatch();
    if (!m || m.done || settling()) return false;   // beendet oder gerade erst geöffnet
    if (fremdeDartsSperre()) {
      UI.error = spielerName(liveAmWurf(liveSpiel())) + ' trägt gerade selbst ein – warte, bis die Aufnahme gebucht ist.';
      render();
      return false;
    }
    UI.dartsFremd = false;   // ab jetzt ist es meine Aufnahme
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
      /* Ein Bust beendet die Aufnahme: sie zaehlt immer drei Darts - genau
         wie bei der Punkte-Eingabe, sonst haengen Average und Bestes Leg
         vom Eingabeweg ab. */
      commitVisit(total, 3, false, true, UI.darts);
      return true;
    }
    if (after === 0) { commitVisit(total, thrown, true, false, UI.darts); return true; }
    if (thrown === 3) { commitVisit(total, 3, false, false, UI.darts); return true; }
    save();            // uebersteht einen Neustart; schickt den Dart sofort zum anderen Tablet
    render();
    return true;
  }

  /* ================= Aufnahme korrigieren =================
     Der häufigste Fehler am Abend ist eine falsch getippte Aufnahme, die
     erst später auffällt. Statt alles dazwischen zurückzunehmen, lässt sich
     der Wert direkt ändern – solange das Leg dadurch schlüssig bleibt. */
  function visitFits(leg, pid) {
    var rest = legStart(leg);
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

    var backup = { s: v.s, b: v.b, o: v.o, k: v.k, d: v.d };
    var rest = legStart(leg);
    leg.visits.forEach(function (x, i) { if (x.p === v.p && i < idx && !x.b) rest -= x.s; });
    var after = rest - value;
    delete v.k;                       // Einzeldarts passen nach der Korrektur nicht mehr
    v.d = 3;                          // eine korrigierte Aufnahme ist eine volle Aufnahme
    if (after < 0 || after === 1) { v.s = 0; v.b = true; v.o = value; }
    else if (after === 0) { v.s = backup.s; v.b = backup.b; v.o = backup.o; v.k = backup.k; v.d = backup.d; return 'Ein Finish bitte über den Wurf eingeben.'; }
    else { v.s = value; v.b = false; v.o = 0; }

    if (!visitFits(leg, v.p)) {
      v.s = backup.s; v.b = backup.b; v.o = backup.o; v.d = backup.d; if (backup.k) v.k = backup.k;
      return 'Mit diesem Wert passen die späteren Aufnahmen nicht mehr.';
    }
    save();
    return null;
  }

  /* ================= Undo ================= */
  function undo() {
    klick();
    if (UI.overlay && UI.overlay.type === 'checkout-darts') { UI.overlay = null; UI.input = ''; render(); return; }
    if (UI.darts.length) {
      /* Die Darts des Mitspielers, der gerade selbst eintraegt, loescht
         hier niemand versehentlich. */
      if (fremdeDartsSperre()) {
        UI.error = spielerName(liveAmWurf(liveSpiel())) + ' trägt gerade selbst ein.';
        render();
        return;
      }
      UI.darts.pop(); UI.mult = 1; save(); render(); return;
    }

    var m = currentMatch();
    if (!m) return;
    while (m.legs.length && m.legs[m.legs.length - 1].visits.length === 0) m.legs.pop();
    if (!m.legs.length) {
      /* Noch nichts geworfen: Zurueck fuehrt wieder ins Ausbullen - ein
         falsch angetippter Ausbull-Sieger laesst sich so korrigieren. */
      if (m.kind !== 'quick' && m.starter && !m.done && S.screen === 'game') {
        m.starter = null;
        UI.bullWahl = 0; UI.bullTastatur = tastaturBetrieb();
        S.screen = 'bulloff';
        save();
      }
      UI.overlay = null; render(); return;
    }

    var leg = m.legs[m.legs.length - 1];
    leg.visits.pop();
    leg.winner = null;
    /* Im geteilten Turnier ist das Ergebnis schon beim Server: merken, dass
       hier korrigiert wird, sonst holt der Abgleich das alte zurueck. */
    if (m.done && m.kind !== 'quick' && geteiltesTurnier()) { m.korrektur = Date.now(); m.gemeldet = false; }
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
    st.dartsPerLeg = st.legsWon501 ? st.dartsInWonLegs / st.legsWon501 : 0;
    st.tons = st.s100 + st.s140 + st.s180;
    st.mpr = st.cricketDarts ? (st.cricketMarks / st.cricketDarts) * 3 : 0;
    st.finAvgDarts = st.finRounds ? st.finDarts / st.finRounds : 0;
    return st;
  }

  /* Wertet eine Liste von Spielen aus – für ein Turnier genauso wie für die Karriere. */
  function collectStats(matchLists, ids) {
    var map = {};
    ids.forEach(function (id) { map[id] = emptyStat(id); map[id].dartsInWonLegs = 0; map[id].legsWon501 = 0; });
    function stat(id) {
      if (!map[id]) { map[id] = emptyStat(id); map[id].dartsInWonLegs = 0; map[id].legsWon501 = 0; }
      return map[id];
    }

    matchLists.forEach(function (entry) {
      var start = entry.start || 501;
      entry.matches.forEach(function (m) {
        if (m.kampflos) return;
        /* Allein am Board gibt es niemanden zu schlagen: ein Solo-Spiel
           liefert Average, 180er und Finishes, aber weder Sieg noch
           Niederlage noch ein gewonnenes Leg. */
        var solo = m.p.length < 2;
        if (m.done && !solo) {
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
          var legVon = leg && typeof leg.start === 'number' ? leg.start : start;
          /* Bestes Leg und Darts je gewonnenem Leg nur aus 501er-Legs: ein
             301er in sechs Darts ist kein Rekord neben einem 501er in neun.
             Average, 180er, Finishes und die Leg-Bilanz zaehlen weiter fuer alle. */
          var ist501 = legVon === 501;
          m.p.forEach(function (pid) { rest[pid] = legVon; visitNo[pid] = 0; });

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
            var used = dartsInLeg(leg, leg.winner);
            /* Das beste Leg ist eine persoenliche Bestmarke und zaehlt auch
               allein - die Leg-Bilanz braucht einen Gegner. */
            if (ist501 && (w.bestLeg === null || used < w.bestLeg)) w.bestLeg = used;
            if (!solo) {
              w.legsWon++;
              m.p.forEach(function (pid) { if (pid !== leg.winner) stat(pid).legsLost++; });
              if (ist501) { w.dartsInWonLegs += used; w.legsWon501++; }
            }
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
    var wertbar = wertbareHistorie();
    var lists = wertbar.filter(function (h) {
      if (h.liga && h.liga.uebung) return false;
      return (h.kind || '501') === '501' || h.kind === 'quick';
    }).map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length && !(S.tour && S.tour.liga && S.tour.liga.uebung) && turnierWertbar() && !turnierSchonArchiviert()) {
      lists.push({ matches: S.matches, start: tourStart() });
    }
    var ids = S.profiles.map(function (p) { return p.id; });
    var map = collectStats(lists, ids);
    var open = S.game && S.game.done && !testSpiel(S.game) ? [S.game] : [];
    wertbar.concat(open).forEach(function (h) {
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
        if (h.winner && map[h.winner] && h.players.length > 1) map[h.winner].cricketWins++;   // allein gibt es keinen Sieg
      } else if (kind === 'rtw') {
        var rs = rtwState({ players: h.players, throws: h.throws, boost: h.boost !== false });
        h.players.forEach(function (id) {
          if (!map[id]) return;
          map[id].rtwGames++;
          // Jeder komplette Durchlauf zählt für die Bestleistung, nicht nur der Sieg.
          var fin = rs.finished[id];
          if (fin && (map[id].rtwBest === null || fin.darts < map[id].rtwBest)) map[id].rtwBest = fin.darts;
        });
        if (h.winner && map[h.winner] && h.players.length > 1) map[h.winner].rtwWins++;   // allein gibt es keinen Sieg
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
        if (h.winner && map[h.winner] && h.players.length > 1) map[h.winner].finWins++;   // allein gibt es keinen Sieg
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
    var lists = wertbareHistorie().filter(function (h) { return h.liga && !h.liga.uebung && h.matches; })
      .map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung && !turnierSchonArchiviert()) lists.push({ matches: S.matches, start: tourStart() });
    var map = collectStats(lists, S.profiles.map(function (p) { return p.id; }));
    Object.keys(map).forEach(function (k) {
      map[k].name = pname(k);
      finalize(map[k]);
      map[k].lastResults.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
    return map;
  }

  /*
   * Liga-Auswertung ueber alle Teams (nur aus den Spielen, die wir erfasst
   * haben). Unsere Spieler behalten ihre Kennung; jeder Gegner wird
   * automatisch seinem Team zugeordnet und ueber alle Spieltage und Geraete
   * hinweg am Namen wiedererkannt (Schluessel "lg|Team|name"), auch wenn
   * sein Gast-Profil laengst ausgeblendet ist oder auf einem anderen iPad
   * eine andere Kennung hatte.
   */
  function ligaTeamDaten() {
    var quellen = wertbareHistorie().filter(function (h) { return h.liga && !h.liga.uebung && h.matches; })
      .map(function (h) { return { liga: h.liga, matches: h.matches, start: (h.settings && h.settings.start) || 501, namen: h.namen || {} }; });
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung && !turnierSchonArchiviert()) {
      quellen.push({ liga: S.tour.liga, matches: S.matches, start: tourStart(), namen: {} });
    }
    var info = {};       // Schluessel -> { team, name }
    var lists = quellen.map(function (q) {
      var lg = q.liga;
      var unsere = {};
      (lg.wir || []).concat((lg.heim ? lg.heimSpieler : lg.gastSpieler) || []).forEach(function (id) { unsere[id] = 1; });
      var team = lg.gegner || 'Gegner';
      var schluessel = {};
      var key = function (id) {
        if (!id || unsere[id]) return id;
        if (schluessel[id]) return schluessel[id];
        var pr = S.profiles.filter(function (x) { return x.id === id; })[0];
        var nm = String((pr && (pr.voll || pr.name)) || q.namen[id] || 'Unbekannt').trim();
        /* Andere Geraete kennen den Namen nur auf 30 Zeichen gekuerzt (Sync):
           verglichen wird deshalb ueber die ersten 30. */
        var k = 'lg|' + team + '|' + nm.toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
        if (!info[k]) info[k] = { team: team, name: nm };
        schluessel[id] = k;
        return k;
      };
      var matches = q.matches.map(function (m) {
        return {
          p: m.p.map(key), starter: key(m.starter), winner: key(m.winner), done: m.done, at: m.at, kampflos: m.kampflos,
          legs: m.legs.map(function (l) {
            return { starter: key(l.starter), winner: key(l.winner), start: l.start, visits: l.visits.map(function (v) {
              var c = {}; for (var f in v) c[f] = v[f]; c.p = key(v.p); return c;
            }) };
          })
        };
      });
      return { matches: matches, start: q.start };
    });
    var map = collectStats(lists, []);
    Object.keys(map).forEach(function (k) {
      map[k].name = info[k] ? info[k].name : pname(k);
      map[k].team = info[k] ? info[k].team : LIGA.team;
      finalize(map[k]);
    });
    var teams = [];
    Object.keys(info).forEach(function (k) { if (teams.indexOf(info[k].team) < 0) teams.push(info[k].team); });
    teams.sort(function (a, b) { return a.localeCompare(b); });
    return { map: map, teams: teams };
  }

  /* Alle fertigen Liga-Einzel, neueste zuerst – fürs Liga-Verlaufsdiagramm. */
  function alleLigaMatches() {
    var out = [];
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung && !turnierSchonArchiviert()) {
      S.matches.forEach(function (m) {
        if (m.done && knownPlayers(m.p)) out.push({ m: m, at: m.at, live: true });
      });
    }
    wertbareHistorie().forEach(function (h) {
      if (!h.liga || h.liga.uebung || !h.matches) return;
      h.matches.forEach(function (m) {
        if (m.done && knownPlayers(m.p)) out.push({ m: m, at: h.at });
      });
    });
    out.sort(function (a, b) { return (b.m.at || b.at || 0) - (a.m.at || a.at || 0); });
    return out;
  }

  function standingsSort(a, b) {
    if (b.won !== a.won) return b.won - a.won;
    if (b.legDiff !== a.legDiff) return b.legDiff - a.legDiff;
    if (b.avg !== a.avg) return b.avg - a.avg;
    return a.name.localeCompare(b.name);
  }
  function standings() {
    var map = stats();
    return tourPlayers().map(function (id) { return map[id]; }).sort(standingsSort);
  }
  /* Tabelle eines archivierten Turniers -- dieselbe Rechnung wie die
     laufende Tabelle, nur aus dem Archiv-Eintrag. */
  function turnierTabelle(h) {
    var start = (h.settings && h.settings.start) || 501;
    var ids = (h.lineup || []).slice();
    var map = collectStats([{ matches: h.matches, start: start }], ids);
    ids.forEach(function (id) {
      finalize(map[id]);
      map[id].name = pname(id);
      if (typeof map[id].legDiff !== 'number') map[id].legDiff = map[id].legsWon - map[id].legsLost;
    });
    return ids.map(function (id) { return map[id]; }).sort(standingsSort);
  }

  /* ================= Ranglisten ================= */
  var BOARDS = [
    /* Reihenfolge je Modus: Siege zuerst, dann der Average (oder was in
       diesem Modus dafuer steht), dann der Rest. Der erste Eintrag ist auch
       die Voreinstellung beim Moduswechsel -- siehe renderBoards(). */
    { mode: '501', key: 'won', label: 'Siege', get: function (s) { return s.won; }, fmt: function (v) { return String(v); }, min: function (s) { return s.matches > 0; }, hint: '' },
    { mode: '501', key: 'avg', label: 'Average', unit: '', get: function (s) { return s.avg; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.darts >= MIN_DARTS_FOR_AVG; }, hint: 'Punkte je 3 Darts über alle Spiele. Zählt ab ' + MIN_DARTS_FOR_AVG + ' geworfenen Darts.' },
    { mode: '501', key: 'first9', label: 'First 9', get: function (s) { return s.first9; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.first9Darts >= 9; }, hint: 'Average der ersten 9 Darts eines Legs – das Maß für den Scoring-Antritt.' },
    { mode: '501', key: 'doubleQuote', label: 'Doppelquote', get: function (s) { return s.doubleQuote; }, fmt: function (v) { return v.toFixed(1) + ' %'; }, min: function (s) { return s.doubleAttempts >= 3; }, hint: 'Getroffene Finishes je Dart auf ein mögliches Doppel (Rest 2–40 gerade oder Bull). Zählt ab 3 Versuchen.' },
    { mode: '501', key: 'highCO', label: 'Höchstes Finish', get: function (s) { return s.highCO; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highCO > 0; }, hint: 'Der höchste je ausgecheckte Rest.' },
    { mode: '501', key: 's180', label: '180er', get: function (s) { return s.s180; }, fmt: function (v) { return String(v); }, min: function (s) { return s.s180 > 0; }, hint: 'Maximum – alle drei Darts in die Triple 20.' },
    { mode: '501', key: 'highScore', label: 'Höchste Aufnahme', get: function (s) { return s.highScore; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highScore > 0; }, hint: 'Die beste einzelne Aufnahme aus 3 Darts.' },
    { mode: '501', key: 'bestLeg', label: 'Bestes Leg', get: function (s) { return s.bestLeg; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.bestLeg !== null; }, asc: true, hint: 'Wenigste Darts für ein gewonnenes 501er-Leg – 301 und 701 zählen hier nicht.' },
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

  function ranking(def, map, modus) {
    var ligaModus = (modus || def.mode) === 'liga';
    var known = {};
    S.profiles.forEach(function (p) { known[p.id] = p; });
    var rows = Object.keys(map).map(function (k) { return map[k]; }).filter(function (s) {
      /* Nur Stammspieler: Gaeste eines Abends (und Bots) gehoeren nicht
         in die Rangliste der Mannschaft - ihre Spiele bleiben im Verlauf. */
      var kp = known[s.id];
      /* Dauerhafte Gaeste (nur dieses Geraet) zaehlen mit; Gast-Konten in
         allen Ranglisten ausser der Liga. */
      return def.min(s) && kp && !kp.hidden && !kp.bot && (!kp.gast || (kp.dauer && !ligaModus)) && !kp.test &&
        !(ligaModus && kp.gastKonto);
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
    if (S.matches.length && !(S.tour && S.tour.liga && S.tour.liga.uebung) && turnierWertbar() && !turnierSchonArchiviert()) {
      S.matches.forEach(function (m) { if (m.done && knownPlayers(m.p)) out.push({ m: m, start: tourStart(), live: true }); });
    }
    wertbareHistorie().forEach(function (h) {
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
    bereinigeAufstellung();
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
      var qd = { modus: S.settings.quickModus === 1 ? 1 : 0, saetze: S.settings.quickSaetze || 1, legs: S.settings.quickLegs || 1 };
      S.game.spieldauer = qd;
      S.game.bestOf = bestOfAus(qd.modus, qd.legs);
      S.game.saetzeBestOf = bestOfAus(qd.modus, qd.saetze);
      S.game.starter = S.lineup[0];
      S.game.legs = [];
    }
    UI.mult = 1;
    UI.modeOverride = null;   // neue Partie, neue Handwahl
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
    /* Online: Mitspieler mit Konto sehen das Spiel auf ihrem Handy und
       tragen mit ein. Solange die Anmeldung beim Server laeuft, ist das
       online-Feld schon da, damit kein Stand vorbeirutscht. */
    if (S.settings.online === 1 && liveMoeglich(kind, S.lineup)) {
      S.game.online = { sid: S.game.id, seq: 0, hash: '', mit: liveMitspieler(S.lineup), wartet: true };
      liveAnlegen(S.game);
    }
    save(); render();
  }

  /* abgebrochen: ein Schnelles Spiel ueber mehrere Legs, das vor dem Ende
     verlassen wurde - die gespielten Legs zaehlen (Average, 180er, Finishes),
     einen Sieger gibt es nicht. */
  function archiveGame(g, abgebrochen) {
    if (!g || (!g.done && !abgebrochen)) return;
    for (var i = 0; i < S.history.length; i++) if (S.history[i].id === g.id) return;  // nicht doppelt
    var eintrag = {
      id: g.id || uid(), kind: g.kind, at: g.at || Date.now(),
      players: g.players.slice(), winner: abgebrochen ? null : g.winner
    };
    if (abgebrochen) eintrag.abgebrochen = true;
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
      eintrag.settings = { start: g.start, bestOf: g.bestOf || 1 };
      eintrag.matches = [{
        id: g.id, p: g.p.slice(), starter: g.starter,
        legs: abgebrochen ? g.legs.filter(function (l) { return l.winner; }) : g.legs,
        done: !abgebrochen, winner: eintrag.winner, at: eintrag.at, start: g.start,
        bestOf: g.bestOf || 1, saetzeBestOf: g.saetzeBestOf || 1, spieldauer: g.spieldauer || null
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

  /* Steht jemand im laufenden Spiel oder im laufenden Turnier (auch mit
     schon fertigen Partien)? Dann darf sein Profil nicht weg - im Spiel
     stuende sonst "Unbekannt", im Archiv eine Kennung ohne Profil. */
  function profilImEinsatz(id) {
    var imSpiel = S.game && (S.game.p || S.game.players || []).indexOf(id) >= 0;
    var imTurnier = S.matches.some(function (m) { return m.p.indexOf(id) >= 0; });
    return !!(imSpiel || imTurnier);
  }

  /* Die Auswahl nach einem Einzel am Board: alle offenen Partien des
     aktuellen und des naechsten Durchgangs (hoechstens 8). Danach kommt in
     Dialog und Tastatursteuerung noch "Zurueck ins Menue". */
  function naechsteEinzel() {
    var offen = S.matches.filter(function (x) { return !x.done && !x.void; });
    if (!offen.length) return [];
    var ab = Math.min.apply(null, offen.map(function (x) { return x.round || 1; }));
    return offen.filter(function (x) { return (x.round || 1) <= ab + 1; }).slice(0, 8);
  }

  /* Wie viele Legs eines laufenden Schnellen Spiels schon entschieden sind. */
  function entschiedeneLegs(g) {
    if (!g || g.kind !== 'quick' || !Array.isArray(g.legs)) return 0;
    return g.legs.filter(function (l) { return l.winner; }).length;
  }

  function finishGame() {
    liveEnde(S.game);
    archiveGame(S.game);
    S.game = null;
    UI.overlay = null;
    S.screen = 'setup';
    save(); render();
  }

  /* Verlauf über alle Spielarten, neueste zuerst. */
  function allGamesLog() {
    var out = allMatches().map(function (e) { return { kind: '501', at: e.m.at || e.at, e: e, live: e.live }; });
    var extra = wertbareHistorie().filter(function (h) { return (h.kind || '501') !== '501'; });
    if (S.game && S.game.done && !testSpiel(S.game)) extra = extra.concat([S.game]);
    extra.forEach(function (h) { out.push({ kind: h.kind, at: h.at, h: h, live: h === S.game }); });
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }

  /* ================= Turnier abschließen ================= */
  /* Alle, die mit dem Ersten exakt gleichauf liegen (Siege, Leg-Differenz,
     Average). Mehr als einer = geteilter Sieg, dann gibt es keinen
     Turniersieger in der Karriere. */
  function geteilteSpitze(table) {
    if (!table.length) return [];
    return table.filter(function (st) {
      return st.won === table[0].won && st.legDiff === table[0].legDiff &&
        Math.abs(st.avg - table[0].avg) < 0.005;
    });
  }

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
    /* Nichts gespielt (Turnier angelegt und gleich wieder verlassen): kein
       Archiv-Eintrag -- der stuende sonst als leeres Turnier in der Liste.
       Schon archiviert (das andere Geraet war schneller, der Eintrag kam per
       Abgleich): ebenfalls keinen zweiten anlegen. */
    var gespielt = S.matches.some(function (m) {
      return m.done || m.kampflos || m.legs.some(function (l) { return l.visits.length > 0; });
    });
    var schonDa = !!(geteilt && geteilt.sid && S.history.some(function (h) { return h.id === geteilt.sid; }));
    if (gespielt && !schonDa) {
      var table = standings();
      S.history.unshift({
        id: geteilt && geteilt.sid ? geteilt.sid : uid(), at: Date.now(),
        lineup: tourPlayers().slice(),
        settings: { start: tourStart(), bestOf: tour().bestOf },
        matches: S.matches,
        /* Ein Ligaspiel hat keinen Einzelsieger – sonst bekäme der individuell
           beste der acht (womöglich ein Gegner) einen erfundenen Turniersieg
           in Karriere und Rangliste. */
        winner: allMatchesDone() && table[0] && !(S.tour && S.tour.liga) && geteilteSpitze(table).length === 1 ? table[0].id : null
      });
      if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
      // Ligaspiele behalten ihre Team-Daten – die Auswertung soll später noch
      // wissen, gegen wen und an welchem Spieltag das war.
      if (S.tour && S.tour.liga) S.history[0].liga = S.tour.liga;
      meldeNeuesSpiel(S.history[0]);
    }
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
  /*
   * Ein Spielstand von aussen (Server, anderes Geraet) wird vor der
   * Uebernahme grob geprueft: stimmt die Form nicht (z. B. matches: null),
   * bleibt er draussen. Frueher legte ein einziger kaputter Eintrag das
   * Zeichnen auf allen Geraeten dauerhaft lahm.
   */
  var ID_OK = /^[^<>"'&\s\\]{1,80}$/;   // keine Zeichen, mit denen man aus HTML ausbricht
  function istListe(x) { return Array.isArray(x); }
  function partieGueltig(m) {
    return !!m && typeof m === 'object' && istListe(m.p) && m.p.length >= 1 &&
      m.p.every(function (id) { return typeof id === 'string' && ID_OK.test(id); }) &&
      istListe(m.legs) && m.legs.every(function (l) {
        return !!l && istListe(l.visits) && l.visits.every(function (v) {
          return !!v && typeof v.s === 'number' && typeof v.d === 'number' && typeof v.p === 'string';
        });
      });
  }
  function spielGueltig(g) {
    if (!g || typeof g !== 'object') return false;
    var kind = g.kind || '501';
    if (kind === 'quick' && istListe(g.legs)) return partieGueltig(g);   // laufendes Schnelles Spiel
    if (kind === '501' || kind === 'quick') {
      return istListe(g.matches) && g.matches.every(partieGueltig) && (g.lineup === undefined || istListe(g.lineup));
    }
    var spieler = istListe(g.players) && g.players.length >= 1 &&
      g.players.every(function (id) { return typeof id === 'string' && ID_OK.test(id); });
    if (kind === 'cricket' || kind === 'rtw') return spieler && istListe(g.throws);
    if (kind === 'finisher') return spieler && istListe(g.rounds) && g.rounds.every(function (rd) { return !!rd && istListe(rd.throws); });
    return false;
  }

  /*
   * Einmalige Korrekturen an schon unterschriebenen Berichten (auf Julius'
   * ausdruecklichen Wunsch). 1. Spieltag 06.10.2026: das letzte Einzel
   * H4 - G1 spielte der eingewechselte H5 (der Wechsel ging an zwei iPads
   * noch nicht), und Nachmeldungen/Proteste sind "nein". Jede Korrektur
   * laeuft genau einmal je Bericht (Merker im Bericht selbst).
   */
  function einmaligeBerichtKorrekturen() {
    var geaendert = false;
    var liste = S.history.slice();
    if (S.tour && S.tour.liga) liste.push({ liga: S.tour.liga, matches: S.matches });
    liste.forEach(function (h) {
      var lg = h.liga;
      if (!lg || lg.terminId !== 'st01' || lg.korrekturSt01 || !Array.isArray(h.matches)) return;
      var i = -1;
      h.matches.forEach(function (m, k) { if (m.id === 'yn2rfle') i = k; });
      if (i < 0) return;
      if (!lg.berichtFelderKf) lg.berichtFelderKf = {};
      lg.berichtFelderKf['einzel-' + i] = 'H5 – G1';
      lg.berichtKreuze = { nachmeldungen: 'nein', proteste: 'nein' };
      lg.korrekturSt01 = Date.now();
      geaendert = true;
    });
    if (geaendert) { berichtStand = null; save(); }
    return geaendert;
  }

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
      /* Der Server hat ein Archiv nachgetragen (Ergebnis kam nach dem Ende):
         die Partien des vorhandenen Eintrags aktualisieren. */
      if (vorhanden[s.id] && s.payload && (Number(s.payload.stand) || 0) > (Number(vorhanden[s.id].stand) || 0) &&
          Array.isArray(s.payload.matches) && spielGueltig(s.payload)) {
        vorhanden[s.id].matches = s.payload.matches;
        vorhanden[s.id].stand = Number(s.payload.stand) || 0;
        /* Nachtraeglich korrigierte Besetzung (z. B. ein Wechsel, der damals
           nicht eingetragen wurde): Aufstellung und Bogen-Listen mitnehmen.
           Bericht-Korrekturen, Unterschriften usw. bleiben die lokalen. */
        if (Array.isArray(s.payload.lineup)) vorhanden[s.id].lineup = s.payload.lineup.slice();
        var lgNeu = s.payload.liga, lgAlt = vorhanden[s.id].liga;
        if (lgNeu && lgAlt) {
          ['wir', 'sie', 'heimSpieler', 'gastSpieler'].forEach(function (k) {
            if (Array.isArray(lgNeu[k])) lgAlt[k] = lgNeu[k].slice();
          });
        }
        if (s.payload.namen) {
          vorhanden[s.id].namen = s.payload.namen;
          Object.keys(s.payload.namen).forEach(function (fid) {
            if (S.profiles.some(function (p) { return p.id === fid; })) return;
            S.profiles.push({ id: fid, name: String(s.payload.namen[fid]).slice(0, 30), voll: String(s.payload.namen[fid]).slice(0, 60),
              avatar: null, hue: freeHue(), created: Date.now(), gast: true, hidden: true });
          });
        }
        geaendert++;
        return;
      }
      if (vorhanden[s.id] || !s.payload) return;
      if (typeof s.id !== 'string' || !ID_OK.test(s.id) || !spielGueltig(s.payload)) return;   // kaputt: draussen lassen
      var eintrag = s.payload;
      eintrag.id = s.id;
      /* Fremde Gastspieler bekommen ein verstecktes Gastprofil - sonst
         stuende in Verlauf und Bericht "Unbekannt". In Aufstellung,
         Spielerliste und Rangliste tauchen sie nicht auf (gast + hidden). */
      if (eintrag.namen) {
        Object.keys(eintrag.namen).forEach(function (fid) {
          if (S.profiles.some(function (p) { return p.id === fid; })) return;
          S.profiles.push({
            id: fid, name: String(eintrag.namen[fid]).slice(0, 30), voll: String(eintrag.namen[fid]).slice(0, 60),
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
      einmaligeBerichtKorrekturen();
      if (geteiltesTurnierAufraeumen()) setTimeout(render, 0);
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

  /* Wirft das Zeichnen einmal (kaputter Stand, unerwarteter Eintrag), bleibt
     die App bedienbar: eine Leiste sagt Bescheid, der Fehler landet trotzdem
     in der Konsole (und in den Tests). */
  function render() {
    try { renderInnen(); }
    catch (e) {
      var bar = $('render-fehler');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'render-fehler';
        bar.className = 'save-warning';
        bar.textContent = '⚠️ Hier ist etwas schiefgelaufen. Bitte die Seite neu laden – deine Daten bleiben erhalten.';
        document.body.insertBefore(bar, document.body.firstChild);
      }
      setTimeout(function () { throw e; }, 0);
    }
  }

  function renderInnen() {
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
    /* Im Spiel scrollt die Seite am Handy nicht: Spielstand oben fest,
       Eingabefeld unten fest (siehe body.im-spiel in styles.css). */
    document.body.classList.toggle('im-spiel',
      S.screen === 'game' || S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher');
    /* Das X01-Spielbild ist auf jeder Bildschirmgroesse fest im Rahmen
       (siehe body.fix-spiel) - nichts scrollt, weder Seite noch Spielbild. */
    document.body.classList.toggle('fix-spiel', S.screen === 'game');
    if (S.screen === 'setup') { gaesteAufraeumen(); renderSetup(); }
    /* Der Hintergrundtakt laeuft nur da, wo man ihn auch sieht: im
       Turnierbildschirm. Sonst fragt die App den ganzen Abend nach Daten,
       die niemand anschaut. */
    if (window.DartSync && window.DartSync.turnier) {
      /* Ein geteiltes Turnier gleicht sich IMMER ab, egal welcher
         Bildschirm offen ist - auch im Spielbericht oder im Liga-Reiter. */
      window.DartSync.turnier.takt(!!geteiltesTurnier());
    }
    /* Das Online-Spiel taktet, solange man es anschaut -- auch im Bull-Off
       und in der Auswertung, denn dort wartet man auf den anderen. */
    if (window.DartSync && window.DartSync.live) {
      var lg = liveSpiel();
      /* Neu geladen, waehrend das Spiel noch angemeldet wurde: nachholen.
         Der Server kennt die Kennung vielleicht schon -- dann sagt er das. */
      if (lg && lg.online.wartet && !liveAnmeldungLaeuft && liveNutzer()) liveAnlegen(lg);
      var liveSichtbar = !!lg && !lg.online.wartet &&
        (S.screen === spielScreen(lg.kind) || S.screen === 'bulloff' || S.screen === 'summary');
      window.DartSync.live.takt(liveSichtbar);
      /* Wer im Online-Spiel auf den anderen wartet, legt das Handy weg: der
         Bildschirm bleibt an (sonst kein Abgleich, kein Klopfen, keine
         Feier), und die Audio-Sitzung wird offen gehalten. */
      wachHalten(liveSichtbar);
      if (window.DartSound && window.DartSound.halten) window.DartSound.halten(liveSichtbar && tonAn());
      tonKnopf(liveSichtbar);
      var lst = window.DartSync.live.status();
      verbindungsHinweis(liveSichtbar && lst && lst.stoerung);
    }
    offeneEndenSenden();
    if (S.screen === 'setup' && letzterScreen !== 'setup') beitretbareHolen();
    setupTakt(S.screen === 'setup');
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
  var liveBeitretbare = [];
  function beitretbareHolen() {
    if (!window.DartSync || !window.DartSync.turnier) return;
    window.DartSync.turnier.offen().then(function (liste) {
      var eigen = geteiltesTurnier();
      var neu = liste.filter(function (t) { return !eigen || t.id !== eigen.sid; });
      var vorher = beitretbare.map(function (t) { return t.id; }).join(',');
      beitretbare = neu;
      if (vorher !== neu.map(function (t) { return t.id; }).join(',')) render();
    });
    liveBeitretbareHolen();
  }
  function liveBeitretbareHolen() {
    if (!window.DartSync || !window.DartSync.live) return;
    window.DartSync.live.offen().then(function (liste) {
      var eigen = liveSpiel();
      var neu = liste.filter(function (g) { return !eigen || g.id !== eigen.online.sid; });
      var vorher = liveBeitretbare.map(function (g) { return g.id + ':' + g.seq; }).join(',');
      liveBeitretbare = neu;
      if (S.screen === 'setup' && vorher !== neu.map(function (g) { return g.id + ':' + g.seq; }).join(',')) render();
    });
  }

  /* Im Setup alle paar Sekunden nachsehen, ob ein Mitspieler gerade ein
     Online-Spiel aufgemacht hat -- am Telefon heisst es "hab's gestartet",
     und dann soll der Knopf da sein, ohne dass man die Seite neu laedt. */
  var SETUP_TAKT = 6000;
  var setupTimer = null;
  function setupTakt(an) {
    an = !!(an && window.DartSync && window.DartSync.live && liveNutzer());
    if (an === !!setupTimer) return;   // nur bei Zustandswechsel neu starten
    if (setupTimer) { clearInterval(setupTimer); setupTimer = null; }
    if (!an) return;
    setupTimer = setInterval(function () { if (!document.hidden) liveBeitretbareHolen(); }, SETUP_TAKT);
  }

  function renderBeitreten() {
    var box = $('beitreten-box');
    if (!box) return;
    box.classList.toggle('hidden', !beitretbare.length && !liveBeitretbare.length);
    var titel = box.querySelector('h2');
    if (titel) titel.textContent = beitretbare.length ? 'Turnier läuft' : 'Online-Spiel läuft';
    var ich = liveNutzer();
    $('beitreten-liste').innerHTML = liveBeitretbare.map(function (g) {
      var andere = (g.spielerNamen || []).filter(function (n, i) { return g.spieler[i] !== ich && n; });
      return '<div class="beitreten-zeile">' +
        '<div class="who"><div class="nm">' + esc(kindName(g.kind)) + ' von ' + esc(g.angelegtVonName || 'jemandem') + '</div>' +
        '<div class="sm">online · ' + (andere.length ? 'mit ' + esc(andere.join(', ')) : plural((g.spieler || []).length, 'Spieler', 'Spieler')) + '</div></div>' +
        '<button class="btn primary small" data-action="live-beitreten" data-id="' + esc(g.id) + '">Mitspielen</button>' +
        '</div>';
    }).join('') + beitretbare.map(function (t) {
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

  /* Erster Start (noch nie gespielt): eine kleine Karte oben erklaert die
     drei Schritte. Sie blockiert nichts und verschwindet mit "Verstanden"
     fuer immer - wer schon spielt, sieht sie nie. */
  function renderWillkommen() {
    var links = document.querySelector('#screen-setup .setup-links');
    if (!links) return;
    var karte = $('willkommen');
    var zeigen = !S.settings.willkommenWeg && !S.history.length && !S.game && !S.matches.length && !liveNutzer();
    if (!zeigen) { if (karte) karte.remove(); return; }
    if (!karte) {
      karte = document.createElement('div');
      karte.id = 'willkommen';
      karte.className = 'card';
      karte.innerHTML =
        '<h2>Willkommen am Board</h2>' +
        '<ol class="hint">' +
          '<li><b>Wer spielt mit?</b> Spieler antippen – die vier Beispielnamen änderst du unter „Spieler“, neue legst du hier unten an.</li>' +
          '<li><b>Spielmodus</b> wählen: Schnelles Spiel, Turnier jeder gegen jeden, Cricket, Round the World oder Finisher.</li>' +
          '<li><b>GAME ON!</b> tippen – ausbullen, dann trägt jeder seine Aufnahme ein. Alles bleibt auf diesem Gerät gespeichert, auch ohne Netz.</li>' +
        '</ol>' +
        '<button class="btn ghost full" data-action="willkommen-weg">Verstanden</button>';
      links.insertBefore(karte, links.firstChild);
    }
  }

  function renderSetup() {
    renderBeitreten();
    renderWillkommen();
    /* Ohne Konto ist jeder neue Spieler ein ganz normales Profil - "Gast"
       gibt es nur angemeldet (dort haben die Kollegen Konten). */
    var npKnopf = document.querySelector('#karte-spieler [data-action="new-profile"]');
    if (npKnopf) npKnopf.textContent = liveNutzer() ? '+ Gastspieler hinzufügen' : '+ Spieler hinzufügen';
    var map = career();
    $('roster').innerHTML = rosterReihenfolge().map(function (p) {
      var st = map[p.id];
      var sel = S.lineup.indexOf(p.id) >= 0;
      return '<div class="roster-item ' + (sel ? 'selected' : '') + '" data-action="toggle-lineup" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
        avatarHTML(p, 'md') +
        '<div class="who"><div class="nm">' + esc(p.name) +
        (p.gast || p.gastKonto ? ' <span class="gast-marke">Gast</span>' : p.test ? ' <span class="gast-marke">Test</span>' : '') + '</div>' +
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

    /* Online spielen: nur angemeldet und nur bei freien Spielen -- das
       Turnier hat seinen eigenen, geteilten Weg. */
    var onlineKarte = $('settings-online');
    if (onlineKarte) {
      var kannOnline = !!liveNutzer() && !!(window.DartSync && window.DartSync.live) && !!LIVE_KINDS[S.mode];
      /* Ohne Konto (reine Offline-App) gibt es die Funktion nicht - aber ein
         Hinweis, dass es sie gibt, statt dass die Karte spurlos fehlt. */
      var nurHinweis = !liveNutzer() && !!LIVE_KINDS[S.mode];
      onlineKarte.classList.toggle('hidden', !kannOnline && !nurHinweis);
      var onlineOpt = onlineKarte.querySelector('[data-setting="online"]');
      if (onlineOpt) onlineOpt.classList.toggle('hidden', !kannOnline);
      var onlineHint = $('online-hint');
      if (nurHinweis && onlineHint) {
        onlineHint.textContent = 'Mit einem Konto könnt ihr an zwei Scheiben spielen: jeder sieht jeden Wurf auf seinem Handy und trägt selbst ein. Dafür die App über den Vereins-Server öffnen und anmelden.';
      }
      if (kannOnline && onlineHint) {
        var mitKonto = liveMitspieler(S.lineup);
        onlineHint.textContent = S.settings.online !== 1
          ? 'Online heißt: Mitspieler mit Konto sehen das Spiel auf ihrem Handy unter „Mitspielen“, sehen jeden Wurf sofort und können selbst eintragen – fürs Spiel am Telefon an zwei Scheiben.'
          : mitKonto.length
            ? 'Sobald du startest, erscheint das Spiel bei ' + mitKonto.map(pname).join(', ') + ' im Setup unter „Mitspielen“.'
            : 'Dafür braucht es mindestens einen Mitspieler mit Konto in der Aufstellung – sonst läuft das Spiel nur hier.';
      }
    }
    $('settings-cricket').classList.toggle('hidden', S.mode !== 'cricket');
    $('settings-rtw').classList.toggle('hidden', S.mode !== 'rtw');
    $('settings-finisher').classList.toggle('hidden', S.mode !== 'finisher');
    /* Turnier und Schnelles Spiel teilen sich die Einstellungen – Startpunkte
       und Einzel-Dart-Grenze gelten für beide. Nur die Legs sind Turniersache;
       zwei getrennte Karten wären zwei Bedienelemente für dieselbe Einstellung. */
    $('settings-501').classList.toggle('hidden', S.mode !== '501' && S.mode !== 'quick');
    $('setting-bestof').classList.toggle('hidden', S.mode !== '501');
    $('setting-quick-dauer').classList.toggle('hidden', S.mode !== 'quick');
    if (S.mode === 'quick') renderQuickDauer();
    document.querySelector('[data-action="start-game"]').textContent = 'GAME ON!';

    var runningGame = !!S.game;
    var running = runningGame || (S.matches.length > 0 && !allMatchesDone());
    $('resume-box').classList.toggle('hidden', !running);
    var resumeBtn = $('resume-box').querySelector('[data-action="resume"]');
    if (runningGame && S.game.done) {
      $('resume-box').querySelector('strong').textContent =
        kindName(S.game.kind) + ' beendet';
      var soloFertig = S.game.kind === 'quick' && S.game.p && S.game.p.length < 2;
      $('resume-info').textContent = (soloFertig ? 'Solo · ' : 'Sieger: ' + pname(S.game.winner) + ' · ') + 'Ergebnis noch nicht gespeichert';
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

  /* Spieldauer im Setup: First to / Best of, dazu je ein Zaehler fuer
     Saetze und Legs. Bei Best of sind nur ungerade Zahlen sinnvoll, darum
     springt der Zaehler dort in Zweierschritten. */
  function renderQuickDauer() {
    var best = S.settings.quickModus === 1;
    var sz = S.settings.quickSaetze, lg = S.settings.quickLegs;
    $('quick-saetze').textContent = sz === 1 ? '1 Satz' : sz + ' Sätze';
    $('quick-legs').textContent = lg === 1 ? '1 Leg' : lg + ' Legs';
    var max = best ? 2 * QUICK_MAX - 1 : QUICK_MAX;
    document.querySelectorAll('#setting-quick-dauer [data-action="quick-step"]').forEach(function (b) {
      var wert = S.settings[b.getAttribute('data-key')];
      b.disabled = Number(b.getAttribute('data-dir')) < 0 ? wert <= 1 : wert >= max;
    });
    var gewinnLegs = Math.floor(bestOfAus(best ? 1 : 0, lg) / 2) + 1;
    var gewinnSaetze = Math.floor(bestOfAus(best ? 1 : 0, sz) / 2) + 1;
    $('quick-dauer-hint').textContent = sz === 1 && lg === 1
      ? 'Ein Leg – wer zuerst auscheckt, gewinnt.'
      : sz === 1
        ? 'Gewonnen hat, wer zuerst ' + gewinnLegs + ' Legs hat.'
        : 'Ein Satz geht an den, der zuerst ' + plural(gewinnLegs, 'Leg', 'Legs') + ' hat – das Spiel an den, der zuerst ' + plural(gewinnSaetze, 'Satz', 'Sätze') + ' hat.';
  }

  /* Im Liga-Betrieb zaehlt der buergerliche Name (SWO: keine Kuenstlernamen).
     Wer keinen gepflegt hat, steht mit dem Anzeigenamen da. */
  function ligaName(pid) {
    var p = profile(pid);
    return p && p.voll ? p.voll : pname(pid);
  }

  /* Punkte je Einzel: der Sieger bekommt einen Punkt (auch kampflos).
     Rueckgabe [Punkte Sieger, Punkte Verlierer]. */
  function ligaPunkte(m, gewinnLegs) {
    /* So wird in unserer Liga gezaehlt (Ansage am 1. Spieltag): jedes
       gewonnene Einzel bringt dem Sieger EINEN Punkt - egal ob 2:0 oder 2:1.
       (Die Staffel 4:0/3:1 aus der SWO-Wertungstabelle gilt nicht.) */
    if (!m.done) return [0, 0];
    return [1, 0];
  }

  /* Team-Stand und Spielbericht-Highlights eines Ligaspiels – gebraucht in
     der Übersicht und auf dem Endstand-Bildschirm. */
  /* Ein echtes Ligaspiel (kein Uebungsspiel), dessen Bericht noch nicht
     unterschrieben und verschickt ist: es wird nirgends still archiviert -
     erst mit dem Abschluss des Spielberichts ist es fertig. */
  function ligaNochOffen() {
    var lg = S.tour && S.tour.liga;
    return !!(lg && !lg.uebung && !lg.abgeschlossen && !S.tour.beendet && S.matches.length);
  }

  /* Man of the Day je Team: die meisten gewonnenen Einzel, bei Gleichstand
     der hoehere 3-Dart-Average. */
  function manOfTheDay(ids, stMap) {
    var bester = null;
    ids.forEach(function (id) {
      var st = stMap[id];
      if (!st || !st.matches) return;
      if (!bester || st.won > bester.won || (st.won === bester.won && st.avg > bester.avg)) bester = st;
    });
    return bester;
  }

  /* Die Highlights eines Teams (180er, High-Finishes ab 100, Shortlegs bis
     21 Darts) als Zeilen. */
  function teamHighlights(ids, stMap) {
    var hl180 = [], hlFin = [], hlLeg = [], zeilen = [];
    ids.forEach(function (id) {
      var st = stMap[id];
      if (!st) return;
      var nm = esc(ligaName(id));
      if (st.s180 > 0) hl180.push(nm + (st.s180 > 1 ? ' ×' + st.s180 : ''));
      if (st.highCO >= 100) hlFin.push(st.highCO + ' ' + nm);
      if (st.bestLeg && st.bestLeg <= 21) hlLeg.push(st.bestLeg + ' Darts ' + nm);
    });
    if (hl180.length) zeilen.push('<b>180er:</b> ' + hl180.join(' · '));
    if (hlFin.length) zeilen.push('<b>High-Finishes:</b> ' + hlFin.join(' · '));
    if (hlLeg.length) zeilen.push('<b>Shortlegs:</b> ' + hlLeg.join(' · '));
    return zeilen;
  }

  /* Punkte nach SWO-Staffel fuer ein archiviertes Ligaspiel. */
  function ligaErgebnisAus(h) {
    var lg = h.liga, gewinnLegs = Math.floor(((h.settings && h.settings.bestOf) || 3) / 2) + 1;
    var e = { wirP: 0, sieP: 0, wirS: 0, sieS: 0 };
    (h.matches || []).forEach(function (m) {
      if (!m.done) return;
      var unsere = lg.wir.indexOf(m.p[0]) >= 0 ? m.p[0] : m.p[1];
      var pkt = ligaPunkte(m, gewinnLegs);
      if (m.winner === unsere) { e.wirS++; e.wirP += pkt[0]; e.sieP += pkt[1]; }
      else { e.sieS++; e.sieP += pkt[0]; e.wirP += pkt[1]; }
    });
    return e;
  }

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
        (lsd.fertige === S.matches.length && ligaNochOffen()
          ? '<button class="btn primary start full" data-action="to-winner">Ergebnisse &amp; Spielbericht</button>' : '') +
        '<button class="btn ghost full" data-action="liga-ticker">Live-Ticker für Zuschauer</button>' +
        '<button class="btn ghost full" data-action="liga-nachmelden">Spieler nachmelden</button>' +
        '<button class="btn ghost full" data-action="liga-bericht">Spielbericht ansehen</button>';
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
            ? '<button class="go wo" data-action="liga-kampflos" data-id="' + esc(m.id) + '">ändern</button>'
            : '')
          : m.belegtVon && Date.now() - (m.belegtSeit || Date.now()) > ((S.tour && S.tour.claimFrist) || 10 * 60000)
            ? '<span class="belegt">bei ' + esc(m.belegtVon) + ' hängengeblieben?</span>' +
              '<button class="go" data-action="open-match" data-id="' + esc(m.id) + '">Übernehmen</button>'
          : m.belegtVon ? '<span class="belegt">läuft bei ' + esc(m.belegtVon) + '</span>'
          : '<button class="go" data-action="open-match" data-id="' + esc(m.id) + '">' +
            (m.legs.length ? 'Weiter' : 'Start') + '</button>' +
            (liga && !m.legs.some(function (l) { return l.visits.length > 0; })
              ? '<button class="go wo" data-action="liga-kampflos" data-id="' + esc(m.id) + '" ' +
                'title="Kampflos werten" aria-label="Kampflos werten">w.o.</button>'
              : '')) +
        '</div>';
    });
    $('schedule').innerHTML = html;
    /* Per Tastatur gewaehltes Einzel (8/2 bzw. Pfeile, Enter startet). */
    if (UI.planTastatur) {
      var pwKnopf = UI.planWahlId ? document.querySelector('#schedule [data-action="open-match"][data-id="' + UI.planWahlId + '"]') : null;
      if (pwKnopf) pwKnopf.closest('.match-row').classList.add('wahl');
    }

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
    /* Je Spiel der Wert fuer die Linie, dazu Zaehler und Nenner (Punkte
       bzw. Marken und Darts), damit die Legende den echten Durchschnitt
       ueber die gezeigten Spiele rechnen kann -- nicht den Mittelwert der
       Mittelwerte und nicht bloss das letzte Spiel. */
    function push(id, value, z, n) {
      if (!per[id]) per[id] = [];
      per[id].push({ v: value, z: z, n: n });
    }

    if (mode === '501' || mode === 'liga') {
      var quelle = mode === 'liga' ? alleLigaMatches() : allMatches();
      quelle.slice().reverse().forEach(function (e) {
        e.m.p.forEach(function (id) {
          var darts = 0, points = 0;
          e.m.legs.forEach(function (leg) {
            leg.visits.forEach(function (v) { if (v.p === id) { darts += v.d; if (!v.b) points += v.s; } });
          });
          if (darts) push(id, (points / darts) * 3, points, darts);
        });
      });
    } else if (mode === 'cricket') {
      var games = wertbareHistorie().filter(function (h) { return h.kind === 'cricket'; }).slice().reverse();
      if (S.game && S.game.kind === 'cricket' && S.game.done && !testSpiel(S.game)) games.push(S.game);
      games.forEach(function (h) {
        var cs = cricketState({ players: h.players, throws: h.throws, scoring: h.scoring });
        h.players.forEach(function (id) {
          if (cs.darts[id]) push(id, (cs.allMarks[id] / cs.darts[id]) * 3, cs.allMarks[id], cs.darts[id]);
        });
      });
    }

    /* Dieselben Leute wie in der Rangliste: keine Abend-Gaeste, Bots oder
       Testkonten; in der Liga nur unsere Spieler (keine Gegner, keine
       Gast-Konten). */
    var reihen = Object.keys(per).filter(function (id) {
      var p = profile(id);
      return p && !p.hidden && !p.bot && !p.test && (!p.gast || (p.dauer && mode !== 'liga')) && !(mode === 'liga' && p.gastKonto);
    }).map(function (id) {
      var letzte = per[id].slice(-CHART_GAMES);
      var z = sum(letzte, function (x) { return x.z; }), n = sum(letzte, function (x) { return x.n; });
      return {
        id: id, name: pname(id), color: playerColor(id),
        points: letzte.map(function (x) { return x.v; }),
        mittel: n ? (z / n) * 3 : 0
      };
    }).filter(function (r) { return r.points.length > 0; });
    /* Haben zwei Linien denselben Farbton (aeltere Konten kamen alle mit
       derselben Farbe vom Server), bekommt jede Linie im Diagramm eine
       eigene Palettenfarbe -- Linie und Legende bleiben dabei zusammen. */
    var gesehen = {}, doppelt = false;
    reihen.forEach(function (r) { var h = hue(r.id); if (gesehen[h]) doppelt = true; gesehen[h] = 1; });
    if (doppelt) {
      reihen.forEach(function (r, i) { r.color = 'hsl(' + HUES[i % HUES.length] + ',70%,58%)'; });
    }
    return reihen;
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
      /* Bester Schnitt zuerst, schwaechster zuletzt (Average wie MPR: hoeher
         ist besser). */
      '<div class="chart-legend">' + series.slice().sort(function (a, b) { return b.mittel - a.mittel; }).map(function (r) {
        /* Unter der Linie steht der Durchschnitt ueber genau diese Spiele (bei
           weniger als zehn eben ueber die vorhandenen) -- frueher stand hier
           nur das letzte, das las sich wie der Schnitt. */
        return '<span class="cl"><i style="background:' + r.color + '"></i>' + esc(r.name) +
          ' <b>Ø ' + r.mittel.toFixed(1) + '</b></span>';
      }).join('') + '</div>';
  }

  function renderBoards() {
    var mode = UI.boardMode;
    /* Der Liga-Reiter rechnet dieselben Classic-Werte, aber nur über
       Ligaspiele – eigene Karriere-Karte statt der großen. */
    var map = mode === 'liga' ? careerLiga() : career();
    /* Liga: Auswertung je Team - unsere Mannschaft (Voreinstellung), die
       ganze Liga oder ein Gegner, aus allen Spieltagen, die wir erfasst haben. */
    var ligaTeam = mode === 'liga' ? (UI.ligaTeam || 'wir') : 'wir';
    var teamDaten = null;
    if (mode === 'liga') {
      teamDaten = ligaTeamDaten();
      if (!teamDaten.teams.length || (ligaTeam !== 'alle' && ligaTeam !== 'wir' && teamDaten.teams.indexOf(ligaTeam) < 0)) ligaTeam = UI.ligaTeam = 'wir';
    }
    var defs = boardsFor(mode);
    if (!defs.some(function (b) { return b.key === UI.board; })) UI.board = defs[0].key;
    var def = boardDef(UI.board);

    $('board-mode').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === mode);
    });

    var ligaSpieltage = wertbareHistorie().filter(function (h) { return h.liga && !h.liga.uebung && h.matches; });
    var log = allGamesLog().filter(function (row) { return row.kind === mode; });
    var modeName = mode === '501' ? 'Classic' : mode === 'liga' ? 'Liga' : kindName(mode);
    $('boards-sub').textContent = mode === 'liga'
      ? (ligaSpieltage.length
        ? 'Liga · ' + plural(ligaSpieltage.length, 'Spieltag', 'Spieltage') + ' · ' + LIGA.saison
        : 'Liga · noch kein Spieltag gespielt')
      : log.length
        ? modeName + ' · ' + plural(log.length, 'Spiel', 'Spiele') +
          (mode === '501' ? ' · ' + plural(wertbareHistorie().filter(function (h) { return (h.kind || '501') === '501'; }).length, 'Turnier', 'Turniere') : '')
        : modeName + ' · noch keine Spiele';

    /* Verlauf: eine farbige Linie je Spieler. */
    var chartLabel = (mode === '501' || mode === 'liga' ? '3-Dart-Average' : 'MPR') + ' – je Spieler die letzten ' + CHART_GAMES + ' Spiele';
    var chart = mode === 'rtw' ? null : lineChart(chartSeries(mode), chartLabel);
    /* Der Verlauf zeigt unsere Spieler - bei einer anderen Team-Auswahl weg. */
    $('board-chart').classList.toggle('hidden', mode === 'rtw' || mode === 'finisher' || ligaTeam !== 'wir');
    if (mode !== 'rtw') {
      $('board-chart').innerHTML = '<h2>' + chartLabel + '</h2>' +
        (chart || '<p class="hint">Ab dem zweiten Spiel wird hier der Verlauf gezeichnet.</p>');
    }

    $('board-chips').innerHTML = (teamDaten && teamDaten.teams.length
      ? '<div class="liga-team-wahl">' + [['wir', LIGA.team], ['alle', 'Gesamte Liga']].concat(teamDaten.teams.map(function (t) { return [t, t]; }))
          .map(function (t) {
            return '<button class="chip ' + (t[0] === ligaTeam ? 'active' : '') + '" data-action="liga-team" data-team="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
          }).join('') + '</div>'
      : '') + defs.map(function (b) {
      return '<button class="chip ' + (b.key === UI.board ? 'active' : '') + '" data-action="board" data-key="' + b.key + '">' + b.label + '</button>';
    }).join('');

    /* Ranglisten-Zeilen: bei "Gesamte Liga" oder einem Gegner aus der
       Team-Auswertung (Gegner sind dort keine Profile, nur Namen). */
    var teamRanking = function (d) {
      if (ligaTeam === 'wir') return ranking(d, map, mode);
      var unsere = ligaTeam === 'alle' ? ranking(d, teamDaten.map, 'liga').filter(function (st) { return st.team === LIGA.team; }) : [];
      var andere = Object.keys(teamDaten.map).map(function (k) { return teamDaten.map[k]; }).filter(function (st) {
        return st.team !== LIGA.team && (ligaTeam === 'alle' || st.team === ligaTeam) && d.min(st);
      });
      var alle = unsere.concat(andere);
      alle.sort(function (a, b) {
        var x = d.asc ? d.get(a) - d.get(b) : d.get(b) - d.get(a);
        return x !== 0 ? x : a.name.localeCompare(b.name);
      });
      return alle;
    };
    var rows = teamRanking(def);
    var medals = ['🥇', '🥈', '🥉'];
    $('board-list').innerHTML = rows.length ? rows.map(function (st, i) {
      var gegner = String(st.id).indexOf('lg|') === 0;
      return '<div class="board-row ' + (i === 0 ? 'top' : '') + '"' +
        (gegner ? '' : ' data-action="open-profile" data-id="' + esc(st.id) + '" role="button" tabindex="0"') + '>' +
        '<div class="pos">' + (medals[i] || (i + 1) + '.') + '</div>' +
        avatarHTML(gegner ? { id: st.id, name: st.name, hue: 210 } : profile(st.id), 'sm') +
        '<div class="nm">' + esc(st.name) +
          (ligaTeam === 'alle' && st.team ? '<span class="board-team">' + esc(st.team) + '</span>' : '') + '</div>' +
        '<div class="val">' + def.fmt(def.get(st)) + '</div>' +
        '</div>';
    }).join('') : '<div class="board-empty">Dafür fehlen noch Daten.</div>';
    $('board-hint').textContent = def.hint;
    $('board-hint').classList.toggle('hidden', !def.hint);

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
      var top = teamRanking(d)[0];
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
      /* Bei einem gewaehlten Gegner nur die Spieltage gegen ihn. */
      var ligaLog = ligaSpieltage.filter(function (h) { return ligaTeam === 'wir' || ligaTeam === 'alle' || h.liga.gegner === ligaTeam; });
      if (S.tour && S.tour.liga && S.matches.length && (ligaTeam === 'wir' || ligaTeam === 'alle' || S.tour.liga.gegner === ligaTeam)) {
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

    /* Bei Classic steht zu jedem gespielten Turnier eine eigene Zeile: ein
       Tipp oeffnet den Endstand mit allen Averages, wie am Abend am Bildschirm. */
    var logMit = log.slice();
    if (mode === '501') {
      wertbareHistorie().forEach(function (h) {
        if (!h.matches || !h.lineup || h.liga || (h.kind && h.kind !== '501')) return;
        if (!h.matches.some(function (x) { return x.done; })) return;
        logMit.push({ kind: 'turnier', at: h.at, h: h });
      });
      logMit.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    }
    $('match-log').innerHTML = logMit.slice(0, 40).map(function (row) {
      if (row.kind === 'turnier') {
        var th = row.h;
        var thFertig = th.matches.filter(function (x) { return x.done; }).length;
        return '<div class="log-row tap turnier-row" data-action="open-summary" data-kind="turnier" data-id="' + esc(th.id) + '" role="button" tabindex="0">' +
          '<div class="lp w">' + (th.winner ? esc(pname(th.winner)) : 'Turnier') + '<span class="a">' + (th.winner ? 'Turniersieg' : 'kein Sieger') + '</span></div>' +
          '<div class="ls">🏆</div>' +
          '<div class="lp right">' + plural(th.lineup.length, 'Spieler', 'Spieler') + '<span class="a">' + plural(thFertig, 'Spiel', 'Spiele') + ' · Endstand ansehen</span></div>' +
          '<div class="ld">' + fmtDate(th.at) + '</div>' +
          '</div>';
      }
      if (row.kind !== '501') {
        var h = row.h;
        var title = h.kind === 'cricket' ? 'Cricket' + (h.scoring ? '' : ' (ohne Punkte)') : kindName(h.kind);
        return '<div class="log-row tap" data-action="open-summary" data-kind="' + esc(h.kind) + '" data-id="' + esc((h.id || 'current')) + '" role="button" tabindex="0">' +
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
      if (m.p.length < 2) {
        /* Solo-Spiel: niemand hat gewonnen, es gibt nur die Darts bis zum Finish. */
        var soloD = sum(m.legs, function (l) { return dartsInLeg(l, m.p[0]); });
        return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
          '<div class="lp">' + esc(pname(m.p[0])) + '<span class="a">Ø ' + avgOf(m.p[0]) + '</span></div>' +
          '<div class="ls">' + soloD + '</div>' +
          '<div class="lp right muted">Solo<span class="a">' + plural(soloD, 'Dart', 'Darts') + '</span></div>' +
          '<div class="ld">' + fmtDate(m.at || e.at) + '</div>' +
          '</div>';
      }
      if (m.p.length > 2) {
        /* Schnelles Spiel zu dritt oder mehr: Sieger vorn, die anderen
           rechts - eine Zeile "A 1:0 B" wuerde den Rest unterschlagen. */
        var andere = m.p.filter(function (pid) { return pid !== m.winner; });
        return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
          '<div class="lp w">' + esc(pname(m.winner)) + '<span class="a">Ø ' + avgOf(m.winner) + '</span></div>' +
          '<div class="ls">🏆</div>' +
          '<div class="lp right">' + plural(m.p.length, 'Spieler', 'Spieler') + '<span class="a">' + andere.map(pname).map(esc).join(', ') + '</span></div>' +
          '<div class="ld">' + fmtDate(m.at || e.at) + (e.live ? ' · aktuelles Turnier' : '') + '</div>' +
          '</div>';
      }
      return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
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
      return '<div class="card player-card ' + (p.hidden ? 'hidden-profile' : '') + '" data-action="open-profile" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
        avatarHTML(p, 'lg') +
        '<div class="pc-main">' +
          '<div class="pc-name">' + esc(p.name) +
            (p.gast ? ' <span class="gast-marke">' + (p.dauer ? 'Gast' : 'Gast · heute') + '</span>'
              : p.gastKonto ? ' <span class="gast-marke">Gast-Konto</span>'
              : p.test ? ' <span class="gast-marke">Test</span>' : '') +
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
        (p.hidden ? '<div class="muted">Ausgeblendet – taucht nicht in der Aufstellung auf</div>' : '') +
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
        line('Ø Darts je gewonnenem Leg (501)', st.dartsPerLeg ? st.dartsPerLeg.toFixed(1) : '–') +
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
        if (m.p.length < 2) {
          /* Solo-Spiel: kein Gegner, kein Sieg - nur die Darts bis zum Finish. */
          var soloDarts = sum(m.legs, function (l) { return dartsInLeg(l, p.id); });
          return '<div class="log-row">' +
            '<div class="lp">Solo</div>' +
            '<div class="ls">' + plural(soloDarts, 'Dart', 'Darts') + '</div>' +
            '<div class="lp right">' + (m.start || e.start) + ' allein</div>' +
            '<div class="ld">' + fmtDate(m.at || e.at) + '</div>' +
            '</div>';
        }
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
  /* '2026-09-17' -> '17.09.2026' */
  function datumDE(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(s || '');
  }
  function heuteISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* Kategorien wie im Tabellenblatt "Kategorien" der Vorlage. Der Server
     prueft dieselben Listen; hier stehen sie fuer die Auswahl, solange die
     Antwort noch nicht da ist. */
  var KASSE_KAT = {
    ein: ['Mitgliedsbeiträge', 'Startgelder Turniere', 'Spenden', 'Sponsoring', 'Sonstige Einnahmen'],
    aus: ['Turnierkosten', 'Ausrüstung/Dartpfeile', 'Getränke/Verpflegung', 'Raummiete', 'Verbandsgebühren', 'Sonstige Ausgaben']
  };
  /* Deutsche Betragsschreibweise (12,50 / 1.250 / 1.234,56) in Cent. */
  function centAus(roh) {
    roh = String(roh || '').trim();
    if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(roh)) roh = roh.replace(/\./g, '').replace(',', '.');
    else roh = roh.replace(',', '.');
    var e = parseFloat(roh);
    return isFinite(e) ? Math.round(e * 100) : NaN;
  }

  /* Die Kategorienliste zur gewaehlten Art (Einnahme/Ausgabe). */
  function kasseKategorien(art) {
    var d = kasseDaten;
    var k = d && d.kategorien ? d.kategorien : KASSE_KAT;
    return art === 'aus' ? k.aus : k.ein;
  }
  function kasseKategorieWahl(art, gewaehlt) {
    return '<select id="kasse-kategorie">' + kasseKategorien(art).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === gewaehlt ? ' selected' : '') + '>' + esc(k) + '</option>';
    }).join('') + '</select>';
  }

  /* Das Kassenbuch -- aufgebaut wie die Excel-Vorlage der Kassenwartin:
     Kassenjahr, Kassenwart, Anfangsbestand, dann Nr / Datum / Beschreibung /
     Kategorie / Einnahme / Ausgabe / Saldo und unten die Summen. Buchen
     darf nur der Kassenwart; alle anderen sehen das Buch und den
     PayPal-Knopf fuers Vereinskonto. */
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
    var konfig = d && d.konfig ? d.konfig : { jahr: new Date().getFullYear(), anfangsbestand: 0, beitrag: 5000, paypal: '' };
    var saldo = d ? d.saldo : konfig.anfangsbestand;
    /* Eintragen darf jeder Angemeldete; der Kassenwart verwaltet alles. */
    var darf = online;
    var wart = !!(online && d && d.kassenwart);
    var ich = online ? window.DartKonto.nutzer().id : null;
    var bearbeite = UI.kasseEdit || null;
    var art = bearbeite ? (bearbeite.betrag < 0 ? 'aus' : 'ein') : (UI.kasseArt === 'aus' ? 'aus' : 'ein');
    var katWahl = bearbeite ? bearbeite.kategorie : UI.kasseKategorie;
    var eintraege = (d && d.eintraege) || [];
    var summeEin = sum(eintraege, function (e) { return e.betrag > 0 ? e.betrag : 0; });
    var summeAus = sum(eintraege, function (e) { return e.betrag < 0 ? -e.betrag : 0; });

    /* Laufender Saldo wie Spalte G der Vorlage: Anfangsbestand + Einnahmen - Ausgaben. */
    var lauf = konfig.anfangsbestand;
    var zeilen = eintraege.map(function (e, i) {
      lauf += e.betrag;
      return '<div class="kasse-eintrag">' +
        '<div class="nr">' + (i + 1) + '</div>' +
        '<div class="was"><div class="txt">' + esc(e.text) +
          (e.mitgliedName && e.kategorie === 'Mitgliedsbeiträge' && e.text.indexOf(e.mitgliedName) < 0 ? ' <span class="muted">(' + esc(e.mitgliedName) + ')</span>' : '') + '</div>' +
          '<div class="wer">' + datumDE(e.datum) + ' · ' + esc(e.kategorie || '') + (e.von ? ' · gebucht von ' + esc(e.von) : '') + '</div></div>' +
        '<div class="zahlen"><span class="betrag ' + (e.betrag < 0 ? 'minus' : 'plus') + '">' +
          (e.betrag > 0 ? '+' : '−') + euro(Math.abs(e.betrag)) + '</span>' +
          '<span class="saldo">Saldo ' + euro(lauf) + '</span></div>' +
        (wart ? '<button class="weg edit" data-action="kasse-edit" data-id="' + esc(e.id) + '" aria-label="Buchung ändern">✎</button>' : '') +
        (wart || e.meins ? '<button class="weg" data-action="kasse-weg" data-id="' + esc(e.id) + '" aria-label="Buchung löschen">✕</button>' : '') +
        '</div>';
    });

    /* Gruendungsbeitrag je Mitglied: bezahlt oder offen. */
    var mitglieder = (d && d.mitglieder) || [];
    var beitragHtml = mitglieder.length ? '<div class="kasse-beitraege"><h3>Gründungsbeitrag ' + euro(konfig.beitrag) + ' pro Kopf</h3>' +
      mitglieder.map(function (m) {
        var voll = m.gezahlt >= konfig.beitrag;
        return '<div class="kb-zeile ' + (voll ? 'voll' : '') + '">' +
          avatarHTML({ id: m.id, name: m.name, avatar: m.avatar, hue: m.hue }, 'sm') +
          '<span class="kb-name">' + esc(m.name) + '</span>' +
          '<span class="kb-status">' + (voll ? '✓ bezahlt' + (m.am ? ' · ' + datumDE(m.am) : '') : m.gezahlt > 0 ? euro(m.gezahlt) + ' von ' + euro(konfig.beitrag) : 'offen') + '</span>' +
          (!voll && (wart || m.id === ich) ? '<button class="btn ghost small" data-action="kasse-beitrag" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">' + (m.id === ich && !wart ? 'Ich habe eingezahlt' : 'Bezahlt') + '</button>' : '') +
          '</div>';
      }).join('') + '</div>' : '';

    $('kasse-karte').innerHTML =
      '<h2>Kassenbuch</h2>' +
      '<div class="kasse-kopf">' +
        '<span>Kassenjahr <b>' + konfig.jahr + '</b></span>' +
        '<span>Kassenwart/in <b>' + esc(((d && d.kassenwarte) || []).join(', ') || 'noch nicht festgelegt') + '</b></span>' +
        '<span>Anfangsbestand <b>' + euro(konfig.anfangsbestand) + '</b></span>' +
      '</div>' +
      '<div class="kasse-saldo"><span class="hint">Kassenstand</span>' +
        '<b class="' + (saldo < 0 ? 'minus' : 'plus') + '">' + euro(saldo) + '</b>' +
        '<span class="hint">Einnahmen ' + euro(summeEin) + ' · Ausgaben ' + euro(summeAus) + '</span></div>' +
      (konfig.paypal
        ? '<a class="btn primary full kasse-paypal" href="' + esc(konfig.paypal) + '" target="_blank" rel="noopener">Per PayPal ins Vereinskonto einzahlen</a>' +
          '<p class="hint center">Danach die Einzahlung unten eintragen – sie steht sofort im Kassenbuch.</p>'
        : '') +
      beitragHtml +
      (darf
        ? '<div class="kasse-form' + (bearbeite ? ' bearbeiten' : '') + '">' +
            '<h3>' + (bearbeite ? 'Buchung Nr. ' + (eintraege.indexOf(bearbeite) + 1) + ' ändern' : 'Eintragen: Einzahlung oder Ausgabe') + '</h3>' +
            (bearbeite ? '' : '<p class="hint">Jede Einzahlung und jede Ausgabe hier eintragen – sie steht sofort im Kassenbuch. ' +
              (((d && d.kassenwarte) || []).join(', ') || 'Der Kassenwart') + ' prüft und verwaltet die Buchungen.</p>') +
            '<div class="options" id="kasse-art">' +
              '<button data-action="kasse-art" data-value="ein" class="' + (art === 'ein' ? 'active' : '') + '">Einnahme</button>' +
              '<button data-action="kasse-art" data-value="aus" class="' + (art === 'aus' ? 'active' : '') + '">Ausgabe</button>' +
            '</div>' +
            '<div class="zeile">' +
              '<input id="kasse-datum" type="date" value="' + (bearbeite ? bearbeite.datum : heuteISO()) + '" aria-label="Datum">' +
              kasseKategorieWahl(art, katWahl) +
            '</div>' +
            '<div class="zeile">' +
              '<input id="kasse-betrag" type="text" inputmode="decimal" placeholder="Betrag in €"' + (bearbeite ? ' value="' + (Math.abs(bearbeite.betrag) / 100).toFixed(2).replace('.', ',') + '"' : '') + '>' +
              '<input id="kasse-text" type="text" maxlength="80" placeholder="Beschreibung"' + (bearbeite ? ' value="' + esc(bearbeite.text) + '"' : '') + '>' +
            '</div>' +
            '<div id="kasse-mitglied-zeile" class="' + (art === 'ein' && (katWahl || kasseKategorien('ein')[0]) === 'Mitgliedsbeiträge' ? '' : 'hidden') + '">' +
              '<select id="kasse-mitglied"><option value="">Mitglied (für wen ist der Beitrag?)</option>' +
                mitglieder.filter(function (m) { return wart || m.id === ich; }).map(function (m) {
                  return '<option value="' + m.id + '"' + (bearbeite && bearbeite.mitglied === m.id ? ' selected' : (!bearbeite && m.id === ich ? ' selected' : '')) + '>' + esc(m.name) + '</option>';
                }).join('') +
              '</select></div>' +
            '<button class="btn primary full" data-action="kasse-buchen">' + (bearbeite ? 'Änderung speichern' : 'Buchen') + '</button>' +
            (bearbeite ? '<button class="btn ghost full" data-action="kasse-edit-abbruch">Abbrechen</button>' : '') +
            '<p class="hint" id="kasse-meldung"></p>' +
            (wart ? '<details class="kasse-konfig"><summary>Kassenjahr und Anfangsbestand (Kassenwart)</summary>' +
              '<div class="zeile">' +
                '<input id="kasse-jahr" type="number" min="2000" max="2100" value="' + konfig.jahr + '" aria-label="Kassenjahr">' +
                '<input id="kasse-anfang" type="text" inputmode="decimal" value="' + (konfig.anfangsbestand / 100).toFixed(2).replace('.', ',') + '" aria-label="Anfangsbestand in Euro">' +
              '</div>' +
              '<button class="btn ghost full" data-action="kasse-konfig">Speichern</button>' +
            '</details>' : '') +
          '</div>'
        : '<p class="hint">Zum Ansehen und Eintragen bitte anmelden.</p>') +
      '<div class="kasse-liste">' +
        '<div class="kasse-kopfzeile"><span>Nr</span><span>Beschreibung · Datum · Kategorie</span><span>Betrag · Saldo</span></div>' +
        (zeilen.length ? zeilen.join('') : '<p class="hint">Noch keine Buchung.</p>') +
        (zeilen.length ? '<div class="kasse-summen">' +
          '<span>Summe Einnahmen <b>' + euro(summeEin) + '</b></span>' +
          '<span>Summe Ausgaben <b>' + euro(summeAus) + '</b></span>' +
          '<span>Endbestand <b>' + euro(saldo) + '</b></span></div>' : '') +
      '</div>';
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
        'data-action="training-zusage" data-tid="' + esc(tid) + '" data-status="' + esc(status) + '">' + text + '</button>';
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
      : LIGA_TEAMS.map(function (t) { return { team: t }; });
    var kennung = JSON.stringify(zeilen);
    if (ligaTabelleKennung === kennung && $('lt-tabelle').innerHTML) return;
    ligaTabelleKennung = kennung;

    /* Spalten wie die Tabelle der Ligaleitung: Spiele, gewonnen /
       unentschieden / verloren, Legs, Einzel ("Spiele" 9:7), Punkte. */
    var zelle = function (v) { return '<td contenteditable>' + esc(v === undefined || v === null ? '' : String(v)) + '</td>'; };
    $('lt-tabelle').innerHTML =
      '<thead><tr><th>#</th><th class="left">Mannschaft</th><th>Sp</th><th>g</th><th>u</th><th>v</th>' +
        '<th>Legs</th><th title="Einzel">Spiele</th><th>Pkt</th></tr></thead>' +
      '<tbody>' + zeilen.map(function (z, i) {
        var wir = z.team === LIGA.team;
        return '<tr' + (wir ? ' class="leader"' : '') + '>' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="left name" contenteditable>' + esc(z.team || '') + '</td>' +
          zelle(z.spiele) + zelle(z.g) + zelle(z.u) + zelle(z.v) + zelle(z.legs) + zelle(z.einzel) + zelle(z.punkte) +
          '</tr>';
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

  /* Kalender-Symbol als SVG statt Emoji (auf manchen Android-Geraeten Tofu). */
  var KALENDER_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/>' +
    '<path d="M3 10h18M8 3v4M16 3v4"/></svg>';

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
    /* window.__ligaHeute: nur fuer die Tests (fester Stichtag), sonst nie gesetzt. */
    var heuteIso = window.__ligaHeute || (heute.getFullYear() + '-' +
      String(heute.getMonth() + 1).padStart(2, '0') + '-' +
      String(heute.getDate()).padStart(2, '0'));

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
            '<button class="icon-btn rund lt-cal" data-action="liga-ical" data-id="' + esc(t.id) + '" ' +
              'title="Diesen Termin in den Kalender" aria-label="Diesen Termin in den Kalender">' + KALENDER_SVG + '</button>' +
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
        ligaTerminStatus(t, vorbei) +
        (vorbei || ligaTerminBelegt(t) ? '' :
          '<div class="lt-fuss">' +
            (ligaZusagen
              ? '<span class="lt-status ' + (fehlt > 0 ? 'offen' : 'voll') + '">' +
                (fehlt > 0
                  ? 'Noch ' + plural(fehlt, 'Spieler', 'Spieler') + ' bis wir vollständig sind'
                  : 'Vollständig – ' + plural(leute.length, 'Spieler', 'Spieler') + ' dabei') +
                '</span>'
              : '<span></span>') +
            '<span class="lt-knoepfe">' +
              (online && !ichBinGastKonto()
                ? '<button class="btn ghost small" data-action="liga-zusage" ' +
                  'data-id="' + esc(t.id) + '" data-dabei="' + (binDabei ? '0' : '1') + '">' +
                  (binDabei ? 'Bin raus' : 'Ich bin dabei') + '</button>'
                : '') +
              (ichBinGastKonto()
                ? '<span class="muted">Als Gast: verfolgen über den Live-Ticker</span>'
                : '<button class="btn ghost small" data-action="liga-spiel" data-id="' + esc(t.id) + '">Ligaspiel starten</button>') +
            '</span>' +
          '</div>') +
        '</div>';
    }).join('');
  }

  /* Was zu einem Spieltag schon da ist: das laufende Ligaspiel oder ein
     archiviertes (abgeschlossen oder mit offenem Bericht). */
  function ligaTerminEintrag(t) {
    for (var i = 0; i < S.history.length; i++) {
      var h = S.history[i];
      /* Ein Eintrag ohne ein einziges gespieltes Einzel (angelegt und wieder
         verlassen, alte Testlaeufe) ist kein stattgefundenes Ligaspiel - der
         Spieltag bleibt startbar. */
      if (h.liga && !h.liga.uebung && h.liga.terminId === t.id && Array.isArray(h.matches) &&
          h.matches.some(function (m) { return m.done || m.kampflos; })) return h;
    }
    return null;
  }
  function ligaTerminBelegt(t) {
    return !!(S.tour && S.tour.liga && !S.tour.liga.uebung && S.tour.liga.terminId === t.id) || !!ligaTerminEintrag(t);
  }
  /* Laeuft oder lief der Spieltag schon, gibt es keinen Start-Knopf mehr,
     sondern den Stand: laeuft / Bericht offen / abgeschlossen. */
  function ligaTerminStatus(t) {
    if (S.tour && S.tour.liga && !S.tour.liga.uebung && S.tour.liga.terminId === t.id) {
      var d = ligaStandDaten();
      return '<div class="lt-fuss"><span class="lt-status offen">Läuft · ' + d.wirP + ':' + d.sieP +
        ' · ' + d.fertige + ' von ' + S.matches.length + ' Einzeln</span>' +
        '<span class="lt-knoepfe"><button class="btn primary start small" data-action="liga-zum-spiel">Zum Ligaspiel</button></span></div>';
    }
    var h = ligaTerminEintrag(t);
    if (!h) return '';
    var e = ligaErgebnisAus(h);
    var zu = !!h.liga.abgeschlossen;
    return '<div class="lt-fuss"><span class="lt-status ' + (zu ? 'voll' : 'offen') + '">' +
        (zu ? '✓ Abgeschlossen · ' : 'Bericht offen · ') + esc(LIGA.team) + ' ' + e.wirP + ':' + e.sieP + '</span>' +
      '<span class="lt-knoepfe">' +
        '<button class="btn ghost small" data-action="open-summary" data-kind="turnier" data-id="' + esc(h.id) + '">Ergebnisse</button>' +
        '<button class="btn ' + (zu ? 'ghost' : 'primary start') + ' small" data-action="liga-bericht" data-termin="' + esc(t.id) + '">' +
          (zu ? 'Spielbericht' : 'Bericht abschließen') + '</button>' +
      '</span></div>';
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
              : '<button data-action="order-pick" data-id="' + esc(pid) + '">' +
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
            return '<button class="bo-row" data-action="order-unpick" data-id="' + esc(pid) + '" ' +
              'aria-label="' + nm + ' wieder herausnehmen">' +
              '<span class="bo-pos">' + (i + 1) + '.</span>' +
              avatarHTML(profile(pid), 'sm') +
              '<span class="bo-name">' + nm + '</span></button>';
          }).join('') + '</div>' +
        '</div>' +
        '<button class="btn primary start full' + (fertig ? '' : ' unsichtbar') + '" ' +
          'data-action="start-order"' + (fertig ? '' : ' disabled') + '>' +
          (fertig ? 'GAME ON! · ' + esc(pname(reihe[0])) + ' beginnt' : '·') + '</button>';
      return;
    }

    $('bulloff-sub').textContent = ids.length > 2
      ? 'Wer war am nächsten am Bull? Er beginnt, danach geht es reihum weiter.'
      : 'Wer war näher am Bull und darf anfangen?';
    /* Am Board laeuft auch das Bullen ueber die Tastatur: Pfeile oder Tab
       wechseln, Enter bestaetigt - und die Felder fuellen den Bildschirm. */
    var amBoard = UI.turnier && turnierErlaubt();
    $('screen-bulloff').classList.toggle('turnier', amBoard);
    /* Auch ohne Turnier-Modus: wer die Pfeiltasten nimmt, sieht die Wahl
       und bestaetigt mit Enter. */
    /* Markiert ist erst, wenn mit der Tastatur gewaehlt wird - beim
       Antippen bleibt der Bildschirm ohne Markierung. */
    var bWahl = UI.bullTastatur ? Math.min(UI.bullWahl || 0, ids.length) : -1;
    /* Index hinter den Kandidaten = der Zurueck-Knopf ist markiert. */
    var bZk = document.querySelector('#screen-bulloff > [data-action="to-tournament"]');
    if (bZk) bZk.classList.toggle('wahl', bWahl === ids.length);
    $('bulloff-buttons').className = 'bulloff';
    $('bulloff-buttons').innerHTML = ids.map(function (pid, i) {
      return '<button data-action="pick-starter" data-id="' + esc(pid) + '"' +
        (i === bWahl ? ' class="wahl"' : '') + '>' +
        avatarHTML(profile(pid), 'md') + '<span>' + esc(ligaName && S.tour && S.tour.liga ? ligaName(pid) : pname(pid)) + '</span></button>';
    }).join('') +
      (amBoard || (S.tour && S.tour.liga) ? '<p class="te-hint">8 / 2 · wählen &nbsp;&nbsp; Enter · der beginnt</p>' : '');
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
    /* Ueber mehrere Legs oder Saetze zaehlt der Kopf Satz und Leg mit,
       und die Karten zeigen den Stand statt der Dartzahl. */
    var qSt = schnell && mehrereLegs(m) ? satzStand(m) : null;
    if (schnell) {
      $('game-match-label').textContent = 'Schnelles Spiel' + liveLabel(m);
      $('game-leg-label').textContent = qSt
        ? (qSt.gewinnSaetze > 1 ? 'Satz ' + qSt.satzNr + ' · ' : '') + 'Leg ' + (m.done ? qSt.legNr - 1 : qSt.legNr) +
          ' · ' + dauerText(m) + ' · ' + matchStart(m)
        : plural(m.p.length, 'Spieler', 'Spieler') + ' · ' + matchStart(m) + ' Double Out';
    } else {
      var idx = S.matches.indexOf(m);
      $('game-match-label').textContent = 'Spiel ' + (idx + 1) + ' von ' + S.matches.length;
      $('game-leg-label').textContent = tour().bestOf > 1
        ? 'Leg ' + m.legs.length + ' · Stand ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + ' · ' + plural(legsToWin(), 'Leg', 'Legs') + ' zum Sieg'
        : 'Ein Leg · ' + tourStart() + ' Double Out';
    }

    var pendingSum = sum(UI.darts, function (d) { return d.v; });
    $('game-turn').innerHTML = m.done
      ? '<b>' + esc(spielerName(m.winner)) + '</b> ' + (m.p.length < 2 ? 'hat ausgemacht' : 'hat gewonnen')
      : '<span class="muted">Am Wurf</span> <b>' + esc(spielerName(active)) + '</b>' +
        '<span class="muted"> · Rest ' + (remainingIn(leg, active) - pendingSum) + '</span>';
    /* Vier Karten in Turniergröße füllen ein Handydisplay allein aus und
       drängen den Verlauf hinter das Zahlenfeld – ab drei Spielern werden
       sie deshalb kompakter. */
    $('scoreboard').classList.toggle('viele', m.p.length > 2);
    $('scoreboard').classList.toggle('solo', m.p.length === 1);
    $('screen-game').classList.toggle('solo', m.p.length === 1);
    /* Alle Spieler nebeneinander in einer Reihe -- wie ein Scorer am Board. */
    $('scoreboard').style.setProperty('--n', m.p.length);
    /* Die letzte Aufnahme jedes Spielers steht klein neben seinem Rest
       ("345 | 60") und bleibt stehen, bis er wieder wirft. Kommt eine neue,
       rutscht die alte wie in einem Drehrad nach oben und verblasst, die
       neue schiebt von unten nach. Weil jeder Tastendruck neu zeichnet,
       laeuft die Animation mit negativer Verzoegerung an der Stelle weiter,
       an der sie gerade ist -- sonst finge sie jedes Mal von vorn an. */
    var letzteIdx = {}, vorletzteIdx = {};
    leg.visits.forEach(function (v, vi) {
      if (letzteIdx[v.p] !== undefined) vorletzteIdx[v.p] = letzteIdx[v.p];
      letzteIdx[v.p] = vi;
    });
    var neuesteVisit = leg.visits.length - 1;
    var seitAufnahme = Date.now() - (UI.aufnahmeZeit || 0);
    var DREH_MS = 1400;
    $('scoreboard').innerHTML = m.p.map(function (pid) {
      var rest = remainingIn(leg, pid) - (pid === active ? pendingSum : 0);
      var darts = dartsIn(leg, pid) + (pid === active ? UI.darts.length : 0);
      var scored = matchStart(m) - remainingIn(leg, pid) + (pid === active ? pendingSum : 0);
      var avg = darts ? (scored / darts * 3).toFixed(1) : '–';
      var zeile, meta, pfinish = '';
      if (UI.turnier && turnierErlaubt()) {
        /* Was geworfen wurde, steht in den Wurflisten unten links und
           rechts – in der Karte bleibt nur der Leg-Stand. */
        zeile = schnell ? (qSt ? kurzStand(qSt, pid) : '') : 'Legs ' + legsWon(m, pid);
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
        zeile = schnell ? (qSt ? kurzStand(qSt, pid) : plural(darts, 'Dart', 'Darts')) : 'Legs ' + legsWon(m, pid);
        /* Oben im Feld steht nur der Average -- die Dartzahl steht in der
           Zeile unter dem Namen, solange es keine Legs zu zaehlen gibt. */
        meta = '<span>Ø <b>' + avg + '</b></span>';
      }
      var letzte = '';
      var li = letzteIdx[pid];
      if (li !== undefined) {
        var lv = leg.visits[li];
        var frisch = li === neuesteVisit && seitAufnahme >= 0 && seitAufnahme < DREH_MS;
        var verz = frisch ? ' style="animation-delay:-' + seitAufnahme + 'ms"' : '';
        var aenderbar = !lv.c && !m.done;
        var alt = '';
        if (frisch && vorletzteIdx[pid] !== undefined) {
          var av = leg.visits[vorletzteIdx[pid]];
          alt = '<span class="letzte-alt' + (av.b ? ' bust' : '') + '"' + verz + '>' + (av.b ? av.o : av.s) + '</span>';
        }
        /* Ein Tipp auf die Zahl korrigiert die Aufnahme -- das war frueher
           die Aufgabe des Wurfverlaufs. */
        letzte = '<span class="letzte-box' + (aenderbar ? ' tap' : '') + '"' +
          (aenderbar ? ' data-action="edit-visit" data-i="' + li + '" role="button" tabindex="0" aria-label="Letzte Aufnahme korrigieren"' : '') + '>' +
          alt + '<span class="letzte' + (lv.b ? ' bust' : '') + (frisch ? ' neu' : '') + '"' + verz + '>' +
          (lv.b ? lv.o : lv.s) + '</span></span>';
      }
      return '<div class="pcard ' + (pid === active ? 'active' : '') + '">' +
        '<div class="meta">' + meta + '</div>' +
        '<div class="rest-zeile"><span class="rest">' + rest + '</span>' + letzte + '</div>' +
        '<div class="pname">' + avatarHTML(profile(pid), 'sm') + esc(spielerName(pid)) + '</div>' +
        '<div class="legs">' + zeile + '</div>' + pfinish +
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
    /* Im Turnier-Modus stehen die Kacheln nur, solange Einzeldarts laufen
       (z. B. vom Mitspieler im Online-Spiel) - ohne Vorschlagsknoepfe. */
    var nurAnzeige = anzeige === 'turnier';
    if ((anzeige === 'darts' || (nurAnzeige && UI.darts.length)) && !m.done) {
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
      if (route && !nurAnzeige) {
        for (var kr = 0; kr < route.length && UI.darts.length + kr < 3; kr++) {
          /* Die vorgeschlagene Kachel ist zugleich der Bestaetigungsknopf:
             wer die 14 trifft, tippt auf die 14 statt sie im Zahlenfeld zu
             suchen. data-num/data-mult nimmt derselbe Handler wie die
             Zahlentasten. */
          var kSoll = labelDart(route[kr]);
          kacheln[UI.darts.length + kr] = '<button type="button" class="fk tipp' + (kr === 0 ? ' jetzt' : '') + '"' +
            ' data-num="' + kSoll.n + '" data-mult="' + kSoll.m + '" aria-label="' + Checkout.pretty(route[kr]) + ' getroffen">' +
            Checkout.pretty(route[kr]) + '</button>';
        }
      } else if (UI.darts.length < 3 && !ohneFinish && !nurAnzeige) {
        /* Kein Finish mehr mit den restlichen Darts: wie im Finisher steht
           dann der Stellwurf da (42 Rest -> 10, damit 32 bleibt) -- gestrichelt,
           und ebenfalls antippbar. */
        var kStell = finisherStellwurf(kRest, kDbl);
        if (kStell) {
          var kStellSoll = labelDart(kStell);
          kacheln[UI.darts.length] = '<button type="button" class="fk tipp stellen"' +
            ' data-num="' + kStellSoll.n + '" data-mult="' + kStellSoll.m + '" aria-label="Stellwurf ' + kStell + ' getroffen">' +
            kStell + '</button>';
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
      /* Unterste Reihe: links Zurueck (letzter Dart bzw. letzte Aufnahme),
         dann Miss, Bull, Bull x2, rechts Weiter. */
      nums += '<button class="zurueck" data-action="undo" aria-label="Letzten Dart zurücknehmen">‹ Zurück</button>';
      nums += '<button class="miss" data-num="0">Miss</button>';
      nums += '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25">Bull</button>';
      nums += '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-bull="1">Bull ×2</button>';
      /* Dreimal am Doppel vorbei muss nicht dreimal getippt werden: dieser
         Knopf schließt die Aufnahme ab und füllt die fehlenden Darts als
         Fehlwürfe auf. */
      nums += '<button class="end-visit" data-action="end-visit">Weiter ▸</button>';
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
    /* Stehen Darts der laufenden Aufnahme an, zeigt jedes Geraet sie -
       auch das des Mitspielers im Online-Spiel, egal wie es eingestellt ist. */
    if (UI.darts.length) return 'darts';
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

    $('cricket-sub').textContent = (g.scoring ? 'mit Punkten' : 'ohne Punkte') + ' · ' + g.players.length + ' Spieler' + liveLabel(g);

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
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (g.players.length < 2 ? 'hat alles zu' : 'gewinnt')
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
          'Weiter ▸</button>' +
      '</div>';
  }

  function renderRtw() {
    var g = S.game;
    if (!g || g.kind !== 'rtw') { S.screen = 'setup'; render(); return; }
    var st = rtwState(g);
    var active = g.done ? g.winner : gameTurnPlayer(g);
    var visit = gameVisitDarts(g);

    $('rtw-sub').textContent = (g.boost
      ? 'Boost · Doppel überspringt 1 · Triple überspringt 2'
      : 'Einfach · jeder Treffer rückt ein Feld weiter') + liveLabel(g);

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
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (g.players.length < 2 ? 'ist durch' : 'gewinnt')
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
      '<span class="k">Weiter ▸</span>' +
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
          return '<button class="btn full" data-action="rtw-stechen" data-id="' + esc(id) + '">' +
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
    if (kind === 'turnier') {
      for (var t = 0; t < S.history.length; t++) {
        var te = S.history[t];
        if (te.id === id && te.matches && te.lineup) return { h: te, live: false };
      }
      return null;
    }
    if (kind === '501') {
      for (var i = 0; i < S.matches.length; i++) {
        if (S.matches[i].id === id) return { m: S.matches[i], start: tourStart(), live: true };
      }
      for (var h = 0; h < S.history.length; h++) {
        var e = S.history[h];
        // Schnelle Spiele liegen mit ihren Partien genauso im Archiv.
        if ((e.kind || '501') !== '501' && e.kind !== 'quick') continue;
        if (!Array.isArray(e.matches)) continue;
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
    /* Der Solver schreibt 'S14', der Stellwurf nur '14' -- beides ein
       Single. Ohne diese Zeile wurde aus '14' die 4 und aus '5' NaN. */
    if (/^[0-9]+$/.test(label)) return { m: 1, n: parseInt(label, 10) };
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
    $('fin-sub').textContent = plural(g.players.length, 'Spieler', 'Spieler') + ' · ' + st.zahl + ' Double Out' + liveLabel(g);
    $('fin-runde').textContent = 'Runde ' + (st.runde + 1) + ' · auf ' + g.ziel + ' Punkte';

    $('fin-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (g.players.length < 2 ? 'hat ausgemacht' : 'hat gewonnen')
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
            return '<button class="btn full" data-action="fin-stechen" data-id="' + esc(id) + '">' +
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
          /* Buergerlicher Name: das letzte Wort ist der Nachname. Kennt
             dieses Geraet einen Gast nur mit ganzem Namen (er kam vom
             anderen iPad oder aus dem Archiv), wird der genauso getrennt -
             sonst stuende "Max Mustermann" komplett unter Vorname. */
          var ganz = prof && prof.voll ? prof.voll : (prof && prof.gast ? prof.name : '');
          if (ganz && String(ganz).trim().indexOf(' ') > 0) {
            var teile = String(ganz).trim().split(/\s+/);
            var nachTeile = [teile.pop()];
            /* Namenszusaetze gehoeren zum Nachnamen: "Vincent von Frankenberg". */
            while (teile.length > 1 && /^(von|van|vom|zu|zum|zur|de|del|der|den|di|da|la|le|ten|ter)$/i.test(teile[teile.length - 1])) {
              nachTeile.unshift(teile.pop());
            }
            nach = nachTeile.join(' ');
            vor = teile.join(' ');
          } else {
            vor = ganz || pname(ids[i]);
          }
        }
        zeilen += '<tr' + (i === 3 ? ' class="b-trenn"' : '') + '>' +
          '<th>' + praefix + (i + 1) + '</th>' +
          '<td contenteditable>' + esc(vor) + '</td>' +
          '<td contenteditable>' + esc(nach) + '</td></tr>';
      }
      return zeilen;
    };

    /* Die 16 Einzel in Bogen-Reihenfolge. Links die Legs, rechts das
       Ergebnis des Einzels wie auf dem Bogen: 1 : 0 fuer den Heimsieg,
       0 : 1 fuer den Gastsieg. Unten im Endergebnis stehen die Summen. */
    var gewinnLegs = Math.floor((q.bestOf || 3) / 2) + 1;
    var hp = 0, gp = 0;
    var einzelPunkte = function (m) {
      if (!m.done || !m.winner) return ' : ';
      var heimSieg = m.winner === m.p[0];
      if (heimSieg) hp++; else gp++;
      return heimSieg ? '1 : 0' : '0 : 1';
    };
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
        /* Die Bogennummer des Spielers, der das Einzel wirklich spielt: nach
           einem Wechsel steht hier H5 statt H4. Antippbar fuer Korrekturen
           von Hand (eigener Schluessel, damit die Zaehlung der uebrigen
           Felder gleich bleibt). */
        '<th contenteditable data-kf="einzel-' + i + '" data-plan="' + (paar[0] + 1) + '|' + (paar[1] + 1) + '">H' +
          berichtNr(heimIds, m.p[0], paar[0]) + ' – G' + berichtNr(gastIds, m.p[1], paar[1]) + '</th>' +
        '<td contenteditable>' + (m.done || m.legs.length
          ? lh + ' : ' + lgs + (m.kampflos ? ' w.o.' : '') : ' : ') + '</td>' +
        '<td contenteditable>' + einzelPunkte(m) + '</td></tr>';
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
            '<table class="b-tab b-ende"><tr><td contenteditable="false" data-feld="nachmeldungen">' + berichtKreuzHtml(lg, 'nachmeldungen') + '</td>' +
              '<td contenteditable="false" data-feld="proteste">' + berichtKreuzHtml(lg, 'proteste') + '</td></tr></table>' +
          '</div>' +
          '<div>' +
            '<div class="b-titel">Highlights Heim:</div>' +
            '<table class="b-tab b-hl">' + hlZeilen('H', hlHeim) + '</table>' +
            '<div class="b-titel">Highlights Gast:</div>' +
            '<table class="b-tab b-hl">' + hlZeilen('G', hlGast) + '</table>' +
            '<p class="b-klein"><span class="b-wechsel">H5</span> = eingewechselter Spieler (statt der geplanten Position).</p>' +
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
        '<button class="btn ghost small b-nur-schirm" data-action="liga-nachmelden">+ Spieler nachmelden (mit Unterschrift)</button>' +
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
    berichtKorrekturenEinsetzen();
    berichtWechselMarkieren();
    berichtUnterschriftenEinsetzen();
    berichtNachmeldungenEinsetzen();
    berichtFinalisieren();
  }

  /* Handkorrekturen im Bogen bleiben erhalten: jedes geaenderte Feld wird
     (nach seiner Stelle im Bogen) im Ligaspiel gemerkt und beim naechsten
     Aufbau wieder eingesetzt - nach Abschluss, Neuladen oder am naechsten Tag. */
  function berichtFelder() {
    return Array.prototype.slice.call(document.querySelectorAll('#bericht-blatt [contenteditable]:not([data-kf])'));
  }
  function berichtKorrekturenEinsetzen() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    var k = q.liga.berichtKorrekturen;
    if (k) {
      var felder = berichtFelder();
      Object.keys(k).forEach(function (i) {
        if (felder[i] && felder[i].getAttribute('contenteditable') !== 'false') felder[i].textContent = k[i];
      });
    }
    var kf = q.liga.berichtFelderKf || {};
    Object.keys(kf).forEach(function (name) {
      var el = document.querySelector('#bericht-blatt [data-kf="' + name + '"]');
      if (el) el.textContent = kf[name];
    });
  }
  /* Wunsch der Ligaleitung: eingewechselte Spieler im Einzel kenntlich
     machen. Weicht die Bogennummer (auch eine von Hand korrigierte) von der
     geplanten Position ab, wird sie eingekreist - "H5 – G1" statt "H4 – G1". */
  function berichtWechselMarkieren() {
    document.querySelectorAll('#bericht-blatt th[data-plan]').forEach(function (th) {
      var plan = th.getAttribute('data-plan').split('|');
      var t = /^\s*H(\d+)\s*[–-]\s*G(\d+)\s*$/.exec(th.textContent);
      if (!t) return;
      var teil = function (b, nr, soll) {
        return nr === soll ? b + nr : '<span class="b-wechsel">' + b + nr + '</span>';
      };
      th.innerHTML = teil('H', t[1], plan[0]) + ' – ' + teil('G', t[2], plan[1]);
    });
  }
  /* Bogennummer (H1-H8 / G1-G8) eines Spielers: seine Stelle in der
     Bogenliste, sonst die geplante Position. */
  function berichtNr(liste, id, pos) {
    var i = (liste || []).indexOf(id);
    return (i >= 0 ? i : pos) + 1;
  }
  /* Ja/Nein zum Antippen (Nachmeldungen, Proteste). */
  function berichtKreuzHtml(lg, feld) {
    var wahl = (lg.berichtKreuze || {})[feld] || null;
    var box = function (wert) {
      return '<span class="b-kreuz" data-action="bericht-kreuz" data-feld="' + feld + '" data-wert="' + wert + '" role="button" tabindex="0">' +
        wert + ' <span class="b-box">' + (wahl === wert ? 'X' : '&nbsp;') + '</span></span>';
    };
    return (feld === 'nachmeldungen' ? 'Nachmeldungen:' : 'Proteste:') + ' ' + box('ja') + ' ' + box('nein');
  }
  /* Beide TCs haben unterschrieben: der Bericht ist final - nichts laesst
     sich mehr aendern, nur noch versenden. */
  function berichtIstFinal(lg) {
    return !!(lg && lg.unterschriften && lg.unterschriften.heim && lg.unterschriften.gast);
  }
  function berichtFinalisieren() {
    var q = ligaBerichtQuelle();
    var final = !!(q && berichtIstFinal(q.liga));
    var blatt = $('bericht-blatt');
    if (blatt) blatt.classList.toggle('final', final);
    var knopf = document.querySelector('#screen-bericht [data-action="bericht-unterschreiben"]');
    if (knopf) knopf.textContent = final ? 'Versenden' : 'Unterschreiben';
    if (!final) return;
    document.querySelectorAll('#bericht-blatt [contenteditable]').forEach(function (el) {
      el.setAttribute('contenteditable', 'false');
    });
  }
  function berichtKorrekturMerken(el) {
    var q = ligaBerichtQuelle();
    if (!q || berichtIstFinal(q.liga)) return;
    var name = el.getAttribute('data-kf');
    if (name) {
      if (!q.liga.berichtFelderKf) q.liga.berichtFelderKf = {};
      q.liga.berichtFelderKf[name] = el.textContent;
      save();
      return;
    }
    var i = berichtFelder().indexOf(el);
    if (i < 0) return;
    if (!q.liga.berichtKorrekturen) q.liga.berichtKorrekturen = {};
    q.liga.berichtKorrekturen[i] = el.textContent;
    save();
  }

  /* ================= Spielbericht unterschreiben und versenden =================
   * Sind alle Einzel durch, unterschreiben beide Teamcaptains am iPad mit dem
   * Finger (erst Heim, dann Gast, je ein ganzer Bildschirm). Danach werden
   * die Adressen eingetragen, und der Bericht geht als PDF ueber das
   * Teilen-Menue raus (Mail-App, eigenes Konto - kein Mailserver noetig).
   * Das PDF zeigt genau das Blatt auf dem Bildschirm, samt Handkorrekturen.
   */
  var SIGNATUR_OK = /^data:image\/png;base64,[A-Za-z0-9+\/]+=*$/;
  var LIGALEITUNG_MAIL = 'spielbericht@steeldart-muenchen.de';

  function berichtUnterschriftenEinsetzen() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    var u = q.liga.unterschriften || {};
    var felder = document.querySelectorAll('#bericht-blatt .b-unterschrift');
    ['heim', 'gast'].forEach(function (wer, i) {
      var f = felder[i];
      if (!f || !u[wer] || !SIGNATUR_OK.test(u[wer])) return;
      f.innerHTML = '<img alt="Unterschrift TC ' + (wer === 'heim' ? 'Heim' : 'Gast') + '" src="' + u[wer] + '">';
      /* false statt entfernen: die Reihenfolge der Bogenfelder (fuer die
         gemerkten Korrekturen) bleibt so dieselbe. */
      f.setAttribute('contenteditable', 'false');
    });
  }

  /* ---- Nachmeldung: Person anlegen, unterschreiben lassen, in den Bogen ---- */
  function nachmeldungStarten() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    if (berichtIstFinal(q.liga)) {
      UI.overlay = { type: 'hinweis', titel: 'Bericht ist final', text: 'Beide Teamcaptains haben unterschrieben – Nachmeldungen gehen jetzt nicht mehr.' };
      render();
      return;
    }
    var aktiv = document.activeElement;
    if (aktiv && aktiv.blur) aktiv.blur();
    UI.overlay = { type: 'nachmeldung', draft: { team: q.liga.heim ? 'H' : 'G', nach: '', vor: '', u18: null, g: null } };
    render();
  }
  function nachmeldungWeiter() {
    var o = UI.overlay;
    if (!o || o.type !== 'nachmeldung') return;
    var d = o.draft;
    d.nach = String(d.nach || '').trim(); d.vor = String(d.vor || '').trim();
    if (!d.team || !d.nach || !d.vor || !d.u18 || !d.g) {
      o.fehler = 'Bitte alle Felder ausfüllen: Team, Nachname, Vorname, U18 und Geschlecht.';
      render();
      return;
    }
    var nq = ligaBerichtQuelle();
    var nListe = nq ? (d.team === 'H' ? nq.liga.heimSpieler : nq.liga.gastSpieler) || [] : [];
    if (nListe.length >= 8) {
      o.fehler = 'Dieses Team hat schon 8 Spieler auf dem Bogen – mehr erlaubt die SWO pro Ligaspiel nicht.';
      render();
      return;
    }
    UI.overlay = { type: 'unterschrift', wer: 'nachmeldung', person: { team: d.team, nach: d.nach, vor: d.vor, u18: d.u18, g: d.g }, striche: [] };
    render();
  }
  function nachmeldungAbschliessen(q, person, bild) {
    var lg = q.liga;
    if (!Array.isArray(lg.nachmeldungen)) lg.nachmeldungen = [];
    var voll = (person.vor + ' ' + person.nach).replace(/\s+/g, ' ').trim();
    /* Als Spieler im Team: im Bogen unter H5-H8 bzw. G5-G8 und beim
       Positionswechsel waehlbar (wird am Namen wiedererkannt). */
    var teamListe = person.team === 'H' ? lg.heimSpieler : lg.gastSpieler;
    var id = ligaGastId(voll, []);
    var prof = profile(id);
    if (prof) { prof.voll = voll; if (prof.name === voll) prof.name = person.vor.slice(0, 16); }
    if (teamListe && teamListe.indexOf(id) < 0) teamListe.push(id);
    var unsere = (person.team === 'H') === !!lg.heim;
    var seite = unsere ? lg.wir : lg.sie;
    if (seite && seite.indexOf(id) < 0) seite.push(id);
    if (S.tour && S.tour.liga === lg && S.tour.players && S.tour.players.indexOf(id) < 0) S.tour.players.push(id);
    lg.nachmeldungen.push({ team: person.team, nach: person.nach, vor: person.vor, u18: person.u18, g: person.g, unterschrift: bild, id: id });
    save();
    berichtNachmeldungenEinsetzen();
    UI.overlay = { type: 'hinweis', titel: voll + ' ist nachgemeldet',
      text: 'Steht jetzt auf Seite 2 des Spielberichts (mit Unterschrift) und im Team' +
        (geteiltesTurnier() ? '.' : ' – über „Spieler wechseln“ einsetzbar.') +
        ' Gebühr nicht vergessen: ' + (person.u18 === 'ja' ? '2 €' : '10 €') + ' innerhalb von 14 Tagen.' };
    render();
  }
  /* Die Nachmeldungen in den schon gezeichneten Bogen eintragen - ohne ihn
     neu zu zeichnen (sonst waeren Handkorrekturen weg). */
  function berichtNachmeldungenEinsetzen() {
    var q = ligaBerichtQuelle();
    var tab = document.querySelector('#bericht-blatt .b-nach');
    if (!q || !tab) return;
    var lg = q.liga;
    var liste = Array.isArray(lg.nachmeldungen) ? lg.nachmeldungen : [];
    var zeilen = tab.querySelectorAll('tr');
    liste.forEach(function (n, i) {
      var tr = zeilen[i + 1];
      if (!tr || tr.getAttribute('data-nm') === String(i)) return;
      tr.setAttribute('data-nm', String(i));
      var heimTeam = lg.heim ? LIGA.team : lg.gegner, gastTeam = lg.heim ? lg.gegner : LIGA.team;
      var td = tr.querySelectorAll('td');
      var werte = [n.team === 'H' ? heimTeam : gastTeam, n.nach, n.vor, n.u18 === 'ja' ? 'ja' : 'nein', n.g];
      werte.forEach(function (w, k) { if (td[k]) td[k].textContent = w; });
      if (td[5] && n.unterschrift && SIGNATUR_OK.test(n.unterschrift)) {
        td[5].innerHTML = '<img alt="Unterschrift ' + esc(n.vor + ' ' + n.nach) + '" src="' + n.unterschrift + '">';
      }
    });
    var kasten = document.querySelector('#bericht-blatt td[data-feld="nachmeldungen"]');
    if (liste.length) {
      if (!lg.berichtKreuze) lg.berichtKreuze = {};
      lg.berichtKreuze.nachmeldungen = 'ja';
      if (kasten) kasten.innerHTML = berichtKreuzHtml(lg, 'nachmeldungen');
    }
    /* Spielerzeilen H5-H8 / G5-G8: leere Plaetze mit den neuen Namen fuellen. */
    var tabs = document.querySelectorAll('#bericht-blatt .b-spieler');
    [['H', lg.heimSpieler || [], tabs[0]], ['G', lg.gastSpieler || [], tabs[1]]].forEach(function (t) {
      if (!t[2]) return;
      var rows = t[2].querySelectorAll('tr');
      t[1].forEach(function (pid, i) {
        var tr = rows[i + 1];
        if (!tr) return;
        var cells = tr.querySelectorAll('td');
        if (cells.length < 2 || cells[0].textContent.trim() || cells[1].textContent.trim()) return;
        var nm = liste.filter(function (n) { return n.id === pid; })[0];
        if (!nm) return;
        cells[0].textContent = nm.vor; cells[1].textContent = nm.nach;
      });
    });
  }

  /* Die Unterschriftsflaeche. Jeder Strich wird als Liste von Punkten (0..1)
     im Dialog gemerkt - zeichnet die App zwischendurch neu, steht die
     Unterschrift sofort wieder da. */
  var SIGNATUR_TINTE = '#13235b';
  function signaturZeichnen(ctx, striche, w, h, breite) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = SIGNATUR_TINTE; ctx.lineWidth = breite;
    striche.forEach(function (st) {
      if (!st.length) return;
      ctx.beginPath();
      ctx.moveTo(st[0][0] * w, st[0][1] * h);
      if (st.length === 1) ctx.lineTo(st[0][0] * w + 0.1, st[0][1] * h + 0.1);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i][0] * w, st[i][1] * h);
      ctx.stroke();
    });
  }
  function signaturVorbereiten() {
    var c = $('signatur');
    var o = UI.overlay;
    if (!c || !o) return;
    if (!o.striche) o.striche = [];
    var r = c.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    o.ratio = r.height / r.width;
    var ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    signaturZeichnen(ctx, o.striche, r.width, r.height, 3);
    var strich = null;
    var punkt = function (ev) {
      var rr = c.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (ev.clientX - rr.left) / rr.width)), Math.max(0, Math.min(1, (ev.clientY - rr.top) / rr.height))];
    };
    c.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
      strich = [punkt(ev)];
      o.striche.push(strich);
      if (o.fehler) { o.fehler = ''; var fe = document.querySelector('#overlay-card .fehler'); if (fe) fe.remove(); }
      signaturZeichnen(ctx, [strich], r.width, r.height, 3);
    });
    c.addEventListener('pointermove', function (ev) {
      if (!strich) return;
      ev.preventDefault();
      var p = punkt(ev);
      var vor = strich[strich.length - 1];
      strich.push(p);
      signaturZeichnen(ctx, [[vor, p]], r.width, r.height, 3);
    });
    var ende = function () { strich = null; };
    c.addEventListener('pointerup', ende);
    c.addEventListener('pointercancel', ende);
  }
  /* Die Unterschrift als PNG fuer den Bericht: dunkle Tinte auf durchsichtigem
     Grund, auf die Strichbreite zugeschnitten. */
  function signaturBild(o) {
    var w = 900, h = Math.round(w * (o.ratio || 0.4));
    /* Auf die Striche zuschneiden (mit etwas Rand), damit die Unterschrift
       das TC-Feld im Bericht fuellt statt als Kringel in der Ecke zu stehen. */
    var x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    o.striche.forEach(function (st) { st.forEach(function (p) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }); });
    var rand = 14;
    var bx = Math.max(0, Math.floor(x0 * w) - rand), by = Math.max(0, Math.floor(y0 * h) - rand);
    var bw = Math.min(w, Math.ceil(x1 * w) + rand) - bx, bh = Math.min(h, Math.ceil(y1 * h) + rand) - by;
    var c = document.createElement('canvas');
    c.width = Math.max(20, bw); c.height = Math.max(20, bh);
    var ctx = c.getContext('2d');
    ctx.translate(-bx, -by);
    signaturZeichnen(ctx, o.striche, w, h, 6);
    return c.toDataURL('image/png');
  }

  /* Unterschrieben wird erst, wenn alle Einzel gespielt sind - sonst
     schloesse der Abschluss das laufende Ligaspiel mitten im Abend ab. */
  function ligaAllesGespielt(q) {
    return q.matches.every(function (m) { return m.done || m.void; });
  }
  function berichtVersandOeffnen() {
    var gemerkt = Array.isArray(S.settings.berichtMails) ? S.settings.berichtMails.slice(0, 3) : [];
    while (gemerkt.length < 3) gemerkt.push('');
    if (!gemerkt[0]) gemerkt[0] = LIGALEITUNG_MAIL;
    UI.overlay = { type: 'bericht-versand', adressen: gemerkt };
    render();
  }
  function berichtUnterschreibenStarten() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    if (berichtIstFinal(q.liga)) { berichtVersandOeffnen(); return; }
    if (!ligaAllesGespielt(q)) {
      var offen = q.matches.filter(function (m) { return !m.done && !m.void; }).length;
      UI.overlay = { type: 'hinweis', titel: 'Noch nicht fertig',
        text: 'Unterschrieben wird erst, wenn alle Einzel gespielt sind – es ' + (offen === 1 ? 'fehlt noch 1 Einzel' : 'fehlen noch ' + offen + ' Einzel') + '. Den Bogen kannst du schon ausfüllen, Korrekturen bleiben gespeichert.' };
      render();
      return;
    }
    var aktiv = document.activeElement;
    if (aktiv && aktiv.blur) aktiv.blur();
    UI.overlay = { type: 'unterschrift', wer: 'heim', striche: [] };
    render();
  }

  function signaturWeiter() {
    var o = UI.overlay;
    var q = ligaBerichtQuelle();
    if (!o || o.type !== 'unterschrift' || !q) return;
    var punkte = o.striche.reduce(function (n, st) { return n + st.length; }, 0);
    if (punkte < 4) { o.fehler = 'Bitte erst im Feld unterschreiben.'; render(); return; }
    if (o.wer === 'nachmeldung') { nachmeldungAbschliessen(q, o.person, signaturBild(o)); return; }
    if (!q.liga.unterschriften) q.liga.unterschriften = {};
    q.liga.unterschriften[o.wer] = signaturBild(o);
    save();
    berichtUnterschriftenEinsetzen();
    berichtFinalisieren();
    if (o.wer === 'heim') {
      UI.overlay = { type: 'unterschrift', wer: 'gast', striche: [] };
    } else {
      berichtVersandOeffnen();
      return;
    }
    render();
  }

  /* --- Das PDF: die Blaetter vom Bildschirm abgezeichnet ---
     Kein Zusatz-Werkzeug: Kaesten, Linien, Bilder und jedes Wort werden an
     ihrer Bildschirmposition auf eine Leinwand uebertragen, die Leinwand
     wird ein JPEG, die JPEGs werden Seiten eines A4-PDFs. */
  function blattAufLeinwand(blatt) {
    var r0 = blatt.getBoundingClientRect();
    var scale = Math.min(3, 1700 / Math.max(1, r0.width));
    var c = document.createElement('canvas');
    c.width = Math.round(r0.width * scale); c.height = Math.round(r0.height * scale);
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, r0.width, r0.height);
    var leer = /rgba\(0, 0, 0, 0\)|transparent/;
    var nurSchirm = function (el) { return el && el.closest && el.closest('.b-nur-schirm'); };
    var els = Array.prototype.slice.call(blatt.querySelectorAll('*'));
    els.forEach(function (el) {
      if (nurSchirm(el)) return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var r = el.getBoundingClientRect();
      var x = r.left - r0.left, y = r.top - r0.top;
      if (cs.backgroundColor && !leer.test(cs.backgroundColor)) {
        ctx.fillStyle = cs.backgroundColor; ctx.fillRect(x, y, r.width, r.height);
      }
      /* Eingekreiste Bogennummer (Wechsel): im PDF auch rund, nicht eckig. */
      if (el.classList.contains('b-wechsel') && ctx.roundRect) {
        var kw = parseFloat(cs.borderTopWidth) || 1.5;
        ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = kw;
        ctx.beginPath(); ctx.roundRect(x + kw / 2, y + kw / 2, r.width - kw, r.height - kw, r.height / 2); ctx.stroke();
        return;
      }
      [['Top', x, y, x + r.width, y], ['Bottom', x, y + r.height, x + r.width, y + r.height],
       ['Left', x, y, x, y + r.height], ['Right', x + r.width, y, x + r.width, y + r.height]].forEach(function (b) {
        var bw = parseFloat(cs['border' + b[0] + 'Width']);
        if (!bw || cs['border' + b[0] + 'Style'] === 'none' || leer.test(cs['border' + b[0] + 'Color'])) return;
        var halb = bw / 2 * (b[0] === 'Top' || b[0] === 'Left' ? 1 : -1);
        ctx.strokeStyle = cs['border' + b[0] + 'Color']; ctx.lineWidth = bw;
        ctx.beginPath();
        if (b[0] === 'Top' || b[0] === 'Bottom') { ctx.moveTo(b[1], b[2] + halb); ctx.lineTo(b[3], b[4] + halb); }
        else { ctx.moveTo(b[1] + halb, b[2]); ctx.lineTo(b[3] + halb, b[4]); }
        ctx.stroke();
      });
      if (el.tagName === 'IMG' && el.complete && el.naturalWidth) {
        try { ctx.drawImage(el, x, y, r.width, r.height); } catch (e) { /* egal */ }
      }
    });
    var tw = document.createTreeWalker(blatt, NodeFilter.SHOW_TEXT, null, false);
    var range = document.createRange();
    var node;
    while ((node = tw.nextNode())) {
      var t = node.nodeValue;
      if (!t || !t.trim() || nurSchirm(node.parentElement)) continue;
      var pcs = getComputedStyle(node.parentElement);
      if (pcs.display === 'none' || pcs.visibility === 'hidden') continue;
      ctx.font = pcs.fontStyle + ' ' + pcs.fontWeight + ' ' + pcs.fontSize + ' ' + pcs.fontFamily;
      ctx.fillStyle = pcs.color;
      ctx.textBaseline = 'alphabetic';
      var groesse = parseFloat(pcs.fontSize) || 12;
      var re = /\S+/g, m;
      while ((m = re.exec(t))) {
        range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
        var rects = range.getClientRects();
        if (!rects.length) continue;
        var rr = rects[0];
        var wort = pcs.textTransform === 'uppercase' ? m[0].toUpperCase() : m[0];
        var met = ctx.measureText(wort);
        var asc = met.fontBoundingBoxAscent || groesse * 0.8;
        var desc = met.fontBoundingBoxDescent || groesse * 0.2;
        ctx.fillText(wort, rr.left - r0.left, rr.top - r0.top + (rr.height + asc - desc) / 2);
      }
    }
    return c;
  }

  function pdfAusSeiten(seiten) {
    var teile = [], offs = [], laenge = 0;
    var bytes = function (str) { var b = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255; return b; };
    var add = function (x) { var b = typeof x === 'string' ? bytes(x) : x; teile.push(b); laenge += b.length; };
    var obj = function (n, inhalt) { offs[n] = laenge; add(n + ' 0 obj\n'); inhalt.forEach(add); add('\nendobj\n'); };
    add('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    var n = seiten.length;
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, ['<< /Type /Pages /Kids [' + seiten.map(function (_, i) { return (3 + 3 * i) + ' 0 R'; }).join(' ') + '] /Count ' + n + ' >>']);
    seiten.forEach(function (sd, i) {
      var pid = 3 + 3 * i, cid = pid + 1, iid = pid + 2;
      var PW = 595.28, PH = 841.89, rand = 24;
      var f = Math.min((PW - 2 * rand) / sd.w, (PH - 2 * rand) / sd.h);
      var w = sd.w * f, h = sd.h * f, x = (PW - w) / 2, y = PH - rand - h;
      obj(pid, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im' + i + ' ' + iid + ' 0 R >> >> /Contents ' + cid + ' 0 R >>']);
      var strom = 'q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + i + ' Do Q';
      obj(cid, ['<< /Length ' + strom.length + ' >>\nstream\n' + strom + '\nendstream']);
      obj(iid, ['<< /Type /XObject /Subtype /Image /Width ' + sd.w + ' /Height ' + sd.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + sd.jpeg.length + ' >>\nstream\n', sd.jpeg, '\nendstream']);
    });
    var xref = laenge, gesamt = 3 + 3 * n;
    add('xref\n0 ' + gesamt + '\n0000000000 65535 f \n');
    for (var k = 1; k < gesamt; k++) add(('0000000000' + offs[k]).slice(-10) + ' 00000 n \n');
    add('trailer\n<< /Size ' + gesamt + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(teile, { type: 'application/pdf' });
  }

  function berichtPdf() {
    var box = $('bericht-blatt');
    var aktiv = document.activeElement;
    if (aktiv && aktiv.blur) aktiv.blur();
    /* Immer in voller Blattbreite abzeichnen - am Handy waere das Blatt
       sonst schmal und die Schrift im PDF winzig. */
    var alteBreite = box.style.width;
    box.style.width = '820px';
    var seiten = Array.prototype.map.call(box.querySelectorAll('.blatt'), function (blatt) {
      var c = blattAufLeinwand(blatt);
      var roh = atob(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
      var jpeg = new Uint8Array(roh.length);
      for (var i = 0; i < roh.length; i++) jpeg[i] = roh.charCodeAt(i);
      return { w: c.width, h: c.height, jpeg: jpeg };
    });
    box.style.width = alteBreite;
    return pdfAusSeiten(seiten);
  }

  /* Bericht fertig, beide unterschrieben, verschickt: das Ligaspiel ist
     abgeschlossen. Laeuft es noch, wandert es jetzt ins Archiv (mit
     Unterschriften und Nachmeldungen); der Bericht bleibt offen sichtbar. */
  function ligaAbschliessen(lg) {
    var q = ligaBerichtQuelle();
    if (q && q.liga === lg && !ligaAllesGespielt(q)) return;   // nie mitten im Abend
    lg.abgeschlossen = Date.now();
    if (S.tour && S.tour.liga === lg) {
      UI.bericht = lg.terminId;
      berichtStand = null;
      archiveTournament();
    }
    save();
  }

  function berichtOhneSendenAbschliessen() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    ligaAbschliessen(q.liga);
    UI.overlay = { type: 'hinweis', titel: 'Ligaspiel abgeschlossen',
      text: 'Der Bericht ist unterschrieben, aber noch nicht verschickt – bitte selbst an die Ligaleitung schicken (Drucken → PDF). Im Spielplan steht der Spieltag als abgeschlossen.' };
    render();
  }

  function berichtSenden() {
    var o = UI.overlay;
    var q = ligaBerichtQuelle();
    if (!o || o.type !== 'bericht-versand' || !q) return;
    var adressen = o.adressen.map(function (a) { return String(a || '').trim(); })
      .filter(function (a) { return a; });
    var falsch = adressen.filter(function (a) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a); });
    if (!adressen.length || falsch.length) {
      o.fehler = !adressen.length ? 'Bitte mindestens eine Adresse eintragen.' : 'Das sieht nicht nach einer Mailadresse aus: ' + falsch[0];
      render();
      return;
    }
    S.settings.berichtMails = o.adressen.slice(0, 3);
    var lg = q.liga;
    var heimTeam = lg.heim ? LIGA.team : lg.gegner;
    var gastTeam = lg.heim ? lg.gegner : LIGA.team;
    var datum = lg.tag ? ligaDatum(lg.tag) : fmtDate(q.at || Date.now());
    var betreff = 'Spielbericht ' + (lg.nr ? lg.nr + '. Spieltag: ' : '') + heimTeam + ' – ' + gastTeam + ' (' + datum + ')';
    var text = 'Hallo,\n\nanbei der unterschriebene Spielbericht: ' + betreff + '.\n\nViele Grüße\n' + LIGA.team;
    var name = ('Spielbericht_' + (lg.nr ? 'Spieltag' + lg.nr + '_' : '') + heimTeam + '_' + gastTeam)
      .replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '_').replace(/_+/g, '_') + '.pdf';
    var pdf = berichtPdf();
    var liste = adressen.join(', ');
    try { if (navigator.clipboard) navigator.clipboard.writeText(liste).catch(function () {}); } catch (e) { /* egal */ }
    var datei = null;
    try { datei = new File([pdf], name, { type: 'application/pdf' }); } catch (e) { datei = null; }
    var fertig = function (wie) {
      lg.berichtVersandt = Date.now();
      ligaAbschliessen(lg);
      UI.overlay = { type: 'hinweis', titel: 'Ligaspiel abgeschlossen',
        text: wie + ' Empfänger: ' + liste + '. Im Spielplan steht der Spieltag jetzt als abgeschlossen – mit Ergebnissen und Bericht.' };
      render();
    };
    if (datei && navigator.canShare && navigator.canShare({ files: [datei] }) && navigator.share) {
      navigator.share({ files: [datei], title: betreff, text: text }).then(function () {
        fertig('Das PDF ist an die Mail übergeben.');
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;   // im Teilen-Menue abgebrochen: Dialog bleibt
        o.fehler = 'Teilen hat nicht geklappt: ' + (e && e.message ? e.message : 'unbekannter Fehler');
        render();
      });
      return;
    }
    /* Ohne Teilen-Menue (Computer): PDF herunterladen und die Mail mit
       Empfaengern und Betreff oeffnen - das PDF dort anhaengen. */
    var url = URL.createObjectURL(pdf);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    window.location.href = 'mailto:' + adressen.map(encodeURIComponent).join(',') +
      '?subject=' + encodeURIComponent(betreff) + '&body=' + encodeURIComponent(text + '\n\n(PDF liegt in den Downloads: ' + name + ')');
    fertig('Das PDF ist heruntergeladen (' + name + ') und die Mail ist geöffnet – bitte dort anhängen.');
  }

  function renderSummary() {
    var s = UI.summary;
    var found = s ? findGame(s.kind, s.id) : null;
    if (!found) { S.screen = S.matches.length ? 'tournament' : 'setup'; render(); return; }

    var box = '';
    var actions = '';
    var note = '<p class="hint center">Diese Werte fließen in Karriere-Statistik und Ranglisten ein.</p>';

    if (s.kind === 'turnier') {
      /* Der Endstand eines gespielten Turniers, so wie er am Abend auf dem
         Bildschirm stand -- zum Nachschauen aus der Spieleliste. */
      var th = found.h;
      var tStart = (th.settings && th.settings.start) || 501;
      var tTab = turnierTabelle(th);
      var tMedals = ['🥇', '🥈', '🥉'];
      var tFertig = th.matches.filter(function (x) { return x.done; });
      box = '<div class="sum-head"><div class="big-emoji">🏆</div>' +
        '<h2 class="sum-title">' + (th.winner ? esc(pname(th.winner)) + ' gewinnt' : 'Turnier') + '</h2>' +
        '<div class="muted">Turnier · ' + fmtDate(th.at) + ' · ' + plural((th.lineup || []).length, 'Spieler', 'Spieler') +
          ' · ' + tStart + ' Double Out' + (th.settings && th.settings.bestOf > 1 ? ' · Best of ' + th.settings.bestOf : ' · ein Leg') +
          ' · ' + plural(tFertig.length, 'Spiel', 'Spiele') + '</div></div>' +
        '<div class="podium">' + tTab.map(function (st, i) {
          return '<div class="p ' + (i === 0 && st.won > 0 ? 'first' : '') + '">' +
            '<div class="medal">' + (tMedals[i] || (i + 1) + '.') + '</div>' +
            avatarHTML(profile(st.id), 'sm') +
            '<div class="pn">' + esc(st.name) + '</div>' +
            '<div class="pv">' + plural(st.won, 'Sieg', 'Siege') + ' · Legs ' + st.legsWon + ':' + st.legsLost + ' · Ø ' + (st.avg ? st.avg.toFixed(1) : '–') + '</div>' +
            '</div>';
        }).join('') + '</div>' +
        '<div class="sum-cards">' + tTab.map(function (st) {
          return '<div class="card sum-card ' + (th.winner === st.id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(st.id), 'md') +
              '<div><div class="nm">' + esc(st.name) + '</div>' +
              '<div class="muted">' + st.won + ' von ' + st.matches + ' gewonnen</div></div></div>' +
            statRow('3-Dart-Average', st.darts ? st.avg.toFixed(2) : '–') +
            statRow('First 9', st.first9Darts ? st.first9.toFixed(2) : '–') +
            statRow('Höchste Aufnahme', st.highScore || '–') +
            statRow('180 / 140+ / 100+', st.s180 + ' / ' + st.s140 + ' / ' + st.s100) +
            statRow('Höchstes Finish', st.highCO || '–') +
            statRow('Bestes Leg', st.bestLeg ? st.bestLeg + ' Darts' : '–') +
            statRow('Darts geworfen', st.darts) +
            '</div>';
        }).join('') + '</div>' +
        '<div class="card"><h2>Spiele</h2>' + tFertig.map(function (x) {
          return '<div class="pline tap" data-action="open-summary" data-kind="501" data-id="' + esc(x.id) + '" role="button" tabindex="0">' +
            '<span>' + (x.winner === x.p[0] ? '<b>' + esc(pname(x.p[0])) + '</b>' : esc(pname(x.p[0]))) + ' – ' +
            (x.winner === x.p[1] ? '<b>' + esc(pname(x.p[1])) + '</b>' : esc(pname(x.p[1]))) + '</span>' +
            '<b>' + legsWon(x, x.p[0]) + ':' + legsWon(x, x.p[1]) + '</b></div>';
        }).join('') + '</div>' + note;
      actions = '<button class="btn ghost full" data-action="summary-back">Zurück</button>';

    } else if (s.kind === '501') {
      var m = found.m;
      var map = collectStats([{ matches: [m], start: found.start }], m.p);
      m.p.forEach(function (id) { finalize(map[id]); });

      var mSolo = m.p.length < 2;
      box = '<div class="sum-head">' +
        '<div class="big-emoji">' + (mSolo ? '🎯' : '🏆') + '</div>' +
        '<h2 class="sum-title">' + esc(pname(m.winner)) + (mSolo ? ' hat ausgemacht' : ' gewinnt') + '</h2>' +
        (mSolo
          ? '<div class="muted">Schnelles Spiel · ' + found.start + ' Double Out · Solo</div>'
          : m.p.length > 2
          ? '<div class="sum-score">' + m.p.map(function (pid) {
              return '<span class="' + (m.winner === pid ? 'w' : '') + '">' + esc(pname(pid)) + ' <b>' + legsWon(m, pid) + '</b></span>';
            }).join(' · ') + '</div>'
          : '<div class="sum-score zwei">' +
            '<span class="' + (m.winner === m.p[0] ? 'w' : '') + '">' + esc(pname(m.p[0])) + '</span>' +
            '<b>' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + '</b>' +
            '<span class="' + (m.winner === m.p[1] ? 'w' : '') + '">' + esc(pname(m.p[1])) + '</span>' +
          '</div>') +
        '</div>' +

        '<div class="sum-cards">' + m.p.map(function (id) {
          var st = map[id];
          return '<div class="card sum-card ' + (m.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div><div class="nm">' + esc(pname(id)) + '</div>' +
              '<div class="muted">' + (mSolo ? 'ausgecheckt' : st.legsWon + ' Leg' + (st.legsWon === 1 ? '' : 's')) + '</div></div></div>' +
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
        ? '<button class="btn ghost full" data-action="reopen-match" data-id="' + esc(m.id) + '">Letzte Aufnahme zurücknehmen</button>'
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
        '<h2 class="sum-title">' + esc(pname(g.winner)) + (g.players.length < 2 ? ' hat alles zu' : ' gewinnt') + '</h2>' +
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

      var qSolo = qm.p.length < 2;
      var qSSt = mehrereLegs(qm) ? satzStand(qm) : null;
      box = '<div class="sum-head"><div class="big-emoji">' + (qSolo ? '🎯' : '🏆') + '</div>' +
        '<h2 class="sum-title">' + (qm.winner ? esc(pname(qm.winner)) + (qSolo ? ' hat ausgemacht' : ' gewinnt') : 'Abgebrochen – ohne Sieger') + '</h2>' +
        '<div class="muted">Schnelles Spiel · ' + qStart + ' Double Out · ' +
          (qSolo ? 'Solo' : plural(qm.p.length, 'Spieler', 'Spieler')) +
          (qSSt ? ' · ' + dauerText(qm) : '') + '</div>' +
        (qSSt && !qSolo ? '<div class="muted sum-stand">' + standZeile(qm, qSSt) + '</div>' : '') + '</div>' +
        '<div class="sum-cards">' + qm.p.map(function (id) {
          var st = qMap[id];
          var rest = qLeg ? remainingIn(qLeg, id) : 0;
          return '<div class="card sum-card ' + (qm.winner === id ? 'win' : '') + '">' +
            '<div class="sum-who">' + avatarHTML(profile(id), 'md') +
              '<div><div class="nm">' + esc(pname(id)) + '</div>' +
              '<div class="muted">' + (qSSt ? kurzStand(qSSt, id) : qm.winner === id ? 'ausgecheckt' : 'Rest ' + rest) + '</div></div></div>' +
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
        '<h2 class="sum-title">' + esc(pname(fg2.winner)) + (fg2.players.length < 2 ? ' hat ausgemacht' : ' gewinnt') + '</h2>' +
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
        '<h2 class="sum-title">' + esc(pname(rg.winner)) + (rg.players.length < 2 ? ' ist durch' : ' gewinnt') + '</h2>' +
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
      abschluss.textContent = S.tour && S.tour.liga ? 'Übungsspiel abschließen' : 'Turnier abschließen';
      abschluss.classList.remove('hidden');
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
      /* Ergebnisse mit Highlights beider Teams und je einem Man of the Day.
         Danach geht es zum Spielbericht - abgeschlossen ist das Ligaspiel
         erst, wenn er unterschrieben und verschickt ist. */
      var wStats = stats();
      var motd = function (ids, team) {
        var b = manOfTheDay(ids, wStats);
        var hl = teamHighlights(ids, wStats);
        return '<div class="card motd">' +
          '<div class="motd-team">' + esc(team) + '</div>' +
          (b ? '<div class="motd-titel">Man of the Day</div>' +
            '<div class="motd-person">' + avatarHTML(profile(b.id), 'md') +
              '<div><div class="motd-name">' + esc(ligaName(b.id)) + '</div>' +
              '<div class="muted">' + plural(b.won, 'Sieg', 'Siege') + ' aus ' + plural(b.matches, 'Einzel', 'Einzeln') +
                ' · Ø ' + (b.darts ? b.avg.toFixed(1) : '–') + '</div></div></div>' : '') +
          (hl.length ? '<div class="lg-hl">' + hl.map(function (z) { return '<div>' + z + '</div>'; }).join('') + '</div>'
            : '<div class="muted motd-leer">Keine Highlights</div>') +
          '</div>';
      };
      var offenBericht = !lw.uebung && !lw.abgeschlossen;
      $('winner-box').innerHTML =
        '<div style="text-align:center"><div class="big-emoji">' + emoji + '</div>' +
        '<h1>' + titel + '</h1>' +
        '<p class="muted">' + lw.nr + '. Spieltag · ' + esc(LIGA.team) + ' gegen ' + esc(lw.gegner) + '</p>' +
        ligaTeamsHtml(lwd) +
        '<p class="muted">Einzel ' + lwd.wirS + ':' + lwd.sieS + ' · Legs ' + lwd.wirL + ':' + lwd.sieL + '</p></div>' +
        '<div class="motd-paar">' + motd(lw.wir, LIGA.team) + motd(lw.sie, lw.gegner) + '</div>' +
        (offenBericht
          ? '<button class="btn primary start full big" data-action="liga-bericht">Weiter zum Spielbericht</button>' +
            '<p class="hint" style="text-align:center">Abgeschlossen ist das Ligaspiel, sobald der Bericht ' +
              'fertig ausgefüllt, von beiden TCs unterschrieben und verschickt ist.</p>'
          : '<button class="btn ghost full" data-action="liga-bericht">Spielbericht ansehen</button>');
      if (abschluss) abschluss.classList.toggle('hidden', offenBericht);
      return;
    }

    var table = standings();
    if (!table.length) { S.screen = 'setup'; render(); return; }
    var medals = ['🥇', '🥈', '🥉'];
    /* Bei exaktem Gleichstand gibt es keinen alphabetischen Sieger. */
    var tied = geteilteSpitze(table);
    /* Gespielt hat der Sieger so viele Partien, wie tatsaechlich im Plan
       stehen - nach Nachtragen oder Abmelden sind das nicht (Spieler - 1). */
    var seinePartien = S.matches.filter(function (m) {
      return m.p.indexOf(table[0].id) >= 0 && (m.done || m.kampflos);
    }).length;
    var title = tied.length > 1
      ? 'Geteilter Sieg: ' + tied.map(function (st) { return esc(st.name); }).join(' und ')
      : esc(table[0].name) + ' gewinnt!';
    $('winner-box').innerHTML =
      '<div style="text-align:center"><div class="big-emoji">🏆</div>' +
      '<h1>' + title + '</h1>' +
      '<p class="muted">' + plural(table[0].won, 'Spiel', 'Spiele') + ' von ' + seinePartien + ' gewonnen</p></div>' +
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
    if (!UI.overlay) { ov.classList.add('hidden'); ov.classList.remove('gross', 'vollbild'); return; }
    ov.classList.remove('hidden');
    /* Im Turnier-Modus sprechen auch die Dialoge Plakatsprache - der
       Schreiber steht vorn an der Scheibe, gelesen wird vom Oche aus. */
    ov.classList.toggle('gross', UI.turnier && turnierErlaubt() && S.screen === 'game');
    /* Der Start eines Ligaspiels oder Uebungsspiels ist kein Zwischendialog,
       sondern ein eigener Bildschirm: Vollbild im App-Hintergrund. */
    ov.classList.toggle('vollbild', !!VOLLBILD_DIALOGE[UI.overlay.type]);
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
        var offene = naechsteEinzel();
        var liga = S.tour && S.tour.liga;
        /* Index hinter den Partien = "Zurueck ins Menue". */
        var wahl = Math.min(o.wahl || 0, offene.length);
        var mehrereDurchgaenge = offene.some(function (x) { return x.round !== offene[0].round; });
        if (offene.length) {
          var teRunde = null;
          html = '<h3>Nächste Einzel</h3>' +
            '<div class="te-next' + (offene.length > 4 ? ' viele' : '') + '">' + offene.map(function (x, i) {
              var paar = liga && x.posPaar
                ? 'H' + (x.posPaar[0] + 1) + ' ' + esc(teName(x.p[0])) + ' – G' + (x.posPaar[1] + 1) + ' ' + esc(teName(x.p[1]))
                : esc(teName(x.p[0])) + ' – ' + esc(teName(x.p[1]));
              var kopf = '';
              if (mehrereDurchgaenge && x.round !== teRunde) {
                teRunde = x.round;
                kopf = '<div class="te-durchgang">Durchgang ' + x.round + '</div>';
              }
              return kopf + '<button class="te-zeile' + (i === wahl ? ' dran' : '') + '" ' +
                'data-action="open-match" data-id="' + esc(x.id) + '">' +
                (x.scheibe ? '<span class="te-scheibe">' + x.scheibe + '</span>' : '') +
                '<span>' + paar + '</span></button>';
            }).join('') +
            '<button class="te-zeile te-menue' + (wahl === offene.length ? ' dran' : '') + '" data-action="to-tournament">' +
              '<span>Zurück ins Menü</span></button>' +
            '</div>' +
            '<p class="te-hint">↑ ↓ · wählen &nbsp;&nbsp; Enter · starten &nbsp;&nbsp; Löschen · letzter Dart zurück</p>';
        } else {
          var teD = liga ? ligaStandDaten() : null;
          html = '<h3>' + (liga ? 'Alle Einzel gespielt' : 'Alle Spiele beendet') + '</h3>' +
            (teD ? '<p class="te-stand">' + esc(LIGA.team) + ' <b>' + teD.wirP + ':' + teD.sieP + '</b> ' +
              esc(S.tour.liga.gegner) + '</p>' : '') +
            '<button class="btn primary full" data-action="ov-next-match">' +
              (liga ? 'Ergebnisse &amp; Man of the Day' : 'Zum Endstand') + '</button>' +
            '<p class="te-hint">Enter · ' + (liga ? 'Ergebnisse' : 'Endstand') + '</p>';
        }
      }
    } else if (o.type === 'leg-done') {
      var m1 = currentMatch();
      /* Am Board waehlen die Pfeile zwischen Weiter und Ruecknahme - nur
         die Wahl ist hell und traegt den Ring. */
      var ldWahl = (UI.turnier && turnierErlaubt()) || tastaturBetrieb() ? (o.wahl || 0) : -1;
      var ldUeb = legDoneUebersicht();
      var ldKl = function (i, sonst) {
        if (ldWahl < 0) return sonst;
        return i === ldWahl ? 'btn primary full wahl' : 'btn ghost full';
      };
      var ldStand = m1.kind === 'quick'
        ? standZeile(m1, null, !!o.satz)
        : legsWon(m1, m1.p[0]) + ':' + legsWon(m1, m1.p[1]);
      html = '<div class="big-emoji">🎯</div><h3>' + (o.satz ? 'Satz' : 'Leg') + ' an ' + esc(pname(o.pid)) + '</h3>' +
        '<p>Stand: ' + ldStand + '</p>' +
        '<button class="' + ldKl(0, 'btn primary full') + '" data-action="ov-next-leg">' + (o.satz ? 'Nächster Satz' : 'Nächstes Leg') + '</button>' +
        '<button class="' + ldKl(1, 'btn ghost full') + '" data-action="undo">Eingabe rückgängig</button>' +
        (ldUeb ? '<button class="' + ldKl(2, 'btn ghost full') + '" data-action="to-tournament">' +
          (S.tour && S.tour.liga ? 'Zur Ligaspiel-Übersicht' : 'Zur Turnierübersicht') + '</button>' : '') +
        (ldWahl >= 0 ? '<p class="te-hint">8 / 2 · wählen &nbsp;&nbsp; Enter · bestätigen &nbsp;&nbsp; Löschen · direkt zurück</p>' : '');
    } else if (o.type === 'match-done') {
      var m2 = currentMatch();
      var last = !nextOpenMatch();
      html = '<div class="big-emoji">🏅</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + esc(pname(m2.p[0])) + ' ' + legsWon(m2, m2.p[0]) + ':' + legsWon(m2, m2.p[1]) + ' ' + esc(pname(m2.p[1])) + '</p>' +
        '<button class="btn primary full" data-action="open-summary" data-kind="501" data-id="' + esc(m2.id) + '">Weiter zur Spielstatistik</button>' +
        (last ? (S.tour && S.tour.liga ? '<button class="btn primary start full" data-action="ov-next-match">Ergebnisse &amp; Man of the Day</button>' : '')
          : '<button class="btn ghost full" data-action="ov-next-match">Direkt zum nächsten Spiel</button>') +
        '<button class="btn ghost full" data-action="undo">Eingabe rückgängig</button>';
    } else if (o.type === 'unterschrift') {
      var uq = ligaBerichtQuelle();
      var uTeam = '';
      var uHeim = o.wer === 'nachmeldung' ? o.person.team === 'H' : o.wer === 'heim';
      if (uq) uTeam = uHeim === !!uq.liga.heim ? LIGA.team : uq.liga.gegner;
      html = '<h3>' + (o.wer === 'nachmeldung'
          ? 'Unterschrift ' + esc(o.person.vor + ' ' + o.person.nach)
          : 'Unterschrift TC ' + (o.wer === 'heim' ? 'Heim' : 'Gast')) + '</h3>' +
        '<p>' + esc(uTeam) + ' · ' + (o.wer === 'nachmeldung'
          ? 'mit der Unterschrift erkennt die Person die SWO und das Datenschutz-Merkblatt der SDM an'
          : 'mit dem Finger im Feld unterschreiben') + '</p>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        '<canvas id="signatur" class="signatur" aria-label="Unterschriftsfeld"></canvas>' +
        '<div class="row-btns">' +
          '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
          '<button class="btn ghost" data-action="signatur-nochmal">Nochmal</button>' +
          '<button class="btn primary" data-action="signatur-weiter">Weiter</button>' +
        '</div>';
    } else if (o.type === 'team-stand') {
      /* "*" am Ziffernblock: der Zwischenstand gross, dazu was gerade laeuft. */
      var tsd = ligaStandDaten();
      var laufend = S.matches.filter(function (m) {
        return !m.done && !m.void && (m.id === S.current || m.belegtVon ||
          m.legs.some(function (l) { return l.visits.length > 0; }));
      });
      html = '<h3>Zwischenstand</h3>' + (tsd ? '<div class="ts-gross">' + ligaTeamsHtml(tsd) + '</div>' +
        '<div class="lg-legs">Einzel ' + tsd.wirS + ':' + tsd.sieS + ' · Legs ' + tsd.wirL + ':' + tsd.sieL +
          ' · ' + tsd.fertige + ' von ' + S.matches.length + ' gespielt</div>' +
        (laufend.length ? '<div class="ts-laeuft"><div class="lg-hl-titel">Läuft gerade</div>' +
          laufend.map(function (m) {
            return '<div>' + esc(ligaName(m.p[0])) + ' – ' + esc(ligaName(m.p[1])) +
              (m.scheibe ? ' · ' + m.scheibe : '') + ' · ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + '</div>';
          }).join('') + '</div>' : '') : '') +
        '<button class="btn primary full" data-action="ov-cancel">Weiter (* oder Enter)</button>';
    } else if (o.type === 'live-ticker') {
      var lt = S.tour && S.tour.zuschauer;
      var link = lt ? location.origin + '/live.html#' + lt : '';
      html = '<h3>Live-Ticker für Zuschauer</h3>' +
        (lt
          ? '<p>Mit diesem Link sieht jeder den Spielstand live – ohne Konto, nur zum Anschauen: Team-Stand, laufende Einzel, Ergebnisse und Statistik.</p>' +
            '<div class="ticker-link" data-role="ticker-link">' + esc(link) + '</div>' +
            '<div class="row-btns two">' +
              '<button class="btn ghost" data-action="ticker-kopieren">Link kopieren</button>' +
              '<button class="btn primary" data-action="ticker-teilen">Teilen</button>' +
            '</div>'
          : '<p>' + (S.tour && S.tour.geteilt
              ? 'Der Link kommt gleich vom Server – bitte in ein paar Sekunden nochmal öffnen.'
              : 'Den Live-Ticker gibt es für Ligaspiele im Modus „geteilt“ (beim Start des Ligaspiels wählen) – dann liegt der Stand beim Server.') + '</p>') +
        '<button class="btn ghost full" data-action="ov-cancel">Schließen</button>';
    } else if (o.type === 'nachmeldung') {
      var nq = ligaBerichtQuelle();
      var nHeimTeam = nq ? (nq.liga.heim ? LIGA.team : nq.liga.gegner) : 'Heim';
      var nGastTeam = nq ? (nq.liga.heim ? nq.liga.gegner : LIGA.team) : 'Gast';
      var nd = o.draft;
      var nWahl = function (feld, wert, text) {
        return '<button data-action="nm-wahl" data-feld="' + feld + '" data-value="' + wert + '" class="' +
          (nd[feld] === wert ? 'active' : '') + '">' + text + '</button>';
      };
      html = '<h3>Spieler nachmelden</h3>' +
        '<p>Alle Felder ausfüllen, danach unterschreibt die Person. Gebühr: 10 € (U18: 2 €) innerhalb von 14 Tagen.</p>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        '<div class="liga-start">' +
          '<div class="ls-titel">Team</div>' +
          '<div class="options">' + nWahl('team', 'H', esc(nHeimTeam) + ' (Heim)') + nWahl('team', 'G', esc(nGastTeam) + ' (Gast)') + '</div>' +
          '<div class="ls-titel">Name</div>' +
          '<label class="ls-zeile"><input data-role="nm-nach" maxlength="30" autocomplete="off" value="' + esc(nd.nach) + '" placeholder="Nachname"></label>' +
          '<label class="ls-zeile"><input data-role="nm-vor" maxlength="30" autocomplete="off" value="' + esc(nd.vor) + '" placeholder="Vorname"></label>' +
          '<div class="ls-titel">Unter 18?</div>' +
          '<div class="options">' + nWahl('u18', 'ja', 'ja') + nWahl('u18', 'nein', 'nein') + '</div>' +
          '<div class="ls-titel">Geschlecht</div>' +
          '<div class="options">' + nWahl('g', 'w', 'w') + nWahl('g', 'm', 'm') + nWahl('g', 'd', 'd') + '</div>' +
        '</div>' +
        '<div class="row-btns two">' +
          '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
          '<button class="btn primary" data-action="nm-weiter">Weiter zur Unterschrift</button>' +
        '</div>';
    } else if (o.type === 'bericht-versand') {
      html = '<h3>Spielbericht versenden</h3>' +
        '<p>Beide Unterschriften sind drin. An wen geht der Bericht?</p>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        '<div class="liga-start">' + o.adressen.map(function (a, i) {
          return '<label class="ls-zeile"><span>' + (i + 1) + '</span>' +
            '<input type="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
            'data-role="bericht-mail" data-i="' + i + '" value="' + esc(a) + '" ' +
            'placeholder="' + (i === 0 ? 'Ligaleitung' : i === 1 ? 'TC Gast' : 'weitere Adresse') + '"></label>';
        }).join('') + '</div>' +
        '<p class="hint">Beim Senden öffnet sich das Teilen-Menü mit dem PDF. Dort <b>Mail</b> wählen. ' +
          'Die Adressen sind dann schon kopiert: ins Feld „An“ tippen und <b>Einfügen</b>.</p>' +
        '<div class="row-btns two">' +
          '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
          '<button class="btn primary start" data-action="bericht-senden">Senden</button>' +
        '</div>' +
        '<button class="btn ghost full" data-action="bericht-ohne-senden">Abschließen ohne Senden</button>';
    } else if (o.type === 'confirm-discard-game') {
      var dgLegs = entschiedeneLegs(S.game);
      html = '<h3>' + kindName(S.game ? S.game.kind : '') + ' abbrechen?</h3>' +
        (dgLegs
          ? '<p>Das Spiel ist noch nicht entschieden. ' + plural(dgLegs, 'Leg ist', 'Legs sind') + ' schon gespielt – ' +
            'die kannst du ohne Sieger in die Statistik übernehmen (Average, 180er, Finishes) oder verwerfen.</p>' +
            '<button class="btn primary full" data-action="ov-keep-legs">Gespielte Legs behalten</button>' +
            '<div class="row-btns two">' +
            '<button class="btn ghost" data-action="ov-cancel">Weiterspielen</button>' +
            '<button class="btn danger" data-action="ov-discard-game">Alles verwerfen</button></div>'
          : '<p>Das Spiel ist noch nicht entschieden – es gibt also nichts, was in die ' +
            'Statistik gehören würde. Der bisherige Verlauf geht verloren.</p>' +
            '<div class="row-btns two">' +
            '<button class="btn ghost" data-action="ov-cancel">Weiterspielen</button>' +
            '<button class="btn danger" data-action="ov-discard-game">Ja, verwerfen</button></div>');
    } else if (o.type === 'warte') {
      html = '<p>' + esc(o.text) + '</p>';
    } else if (o.type === 'hinweis') {
      html = '<h3>' + esc(o.titel || 'Geht gerade nicht') + '</h3><p>' + esc(o.text) + '</p>' +
        '<button class="btn primary full" data-action="ov-hinweis-zu">Verstanden</button>';
    } else if (o.type === 'confirm-live-beitreten') {
      html = '<h3>' + esc(kindName(o.kind)) + ' online mitspielen?</h3>' +
        '<p>Hier läuft noch ein eigenes, nicht entschiedenes Spiel. Das wird verworfen, ' +
        'wenn du beim Online-Spiel einsteigst.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="ov-live-beitreten">Mitspielen</button></div>';
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
      var ltProfile = ligaKader();
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
        '<button class="btn primary start" data-action="liga-los">GAME ON!</button></div>';
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
        '<button class="btn primary start" data-action="uebung-los">GAME ON!</button></div>';
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
            '<button class="btn full" data-action="liga-kampflos-wer" data-wer="' + esc(kfMatch.p[0]) + '">' +
              esc(ligaName(kfMatch.p[0])) + ' fehlt</button>' +
            '<button class="btn full" data-action="liga-kampflos-wer" data-wer="' + esc(kfMatch.p[1]) + '">' +
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
            ligaKader().map(function (p) {
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
        '<p>' + (fertige
          ? '<b>' + plural(fertige, 'gespieltes Spiel', 'gespielte Spiele') + '</b> ' +
            (fertige === 1 ? 'bleibt' : 'bleiben') + ' in Statistik und Rangliste. '
          : 'Es ist noch kein Spiel fertig, in die Statistik kommt also nichts. ') +
        (offeneSpiele
          ? (offeneSpiele === 1 ? 'Die <b>eine offene Partie</b> wird' : 'Die <b>' + offeneSpiele + ' offenen Partien</b> werden') + ' nicht mehr gespielt.'
          : '') + '</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Weiterspielen</button>' +
        '<button class="btn danger" data-action="ov-reset">Ja, beenden</button></div>';
    } else if (o.type === 'profile') {
      var p = o.draft;
      var isNew = !o.id;
      /* Angemeldet ist jeder neu angelegte Spieler ein Gast (Kollegen haben
         Konten). Zwei Arten: fuer heute Abend (nach 12 Stunden weg) oder
         dauerhaft auf diesem Geraet. Wer ueberall dabei sein soll, legt sich
         mit dem Gast-Code ein eigenes Konto an. */
      var gastWahl = (isNew && window.DartKonto && window.DartKonto.nutzer()) ||
        (!isNew && profile(o.id).gast && !profile(o.id).hidden && !istLigaGegner(o.id));
      html = '<h3>' + (isNew ? (gastWahl ? 'Gast hinzufügen' : 'Neuer Spieler') : 'Spieler bearbeiten') + '</h3>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        (gastWahl
          ? '<div class="options gast-art">' +
              '<button data-action="gast-art" data-value="0" class="' + (p.dauer ? '' : 'active') + '">Temporär<small>nach 12 Std. weg</small></button>' +
              '<button data-action="gast-art" data-value="1" class="' + (p.dauer ? 'active' : '') + '">Dauerhaft<small>nur dieses Gerät</small></button>' +
            '</div>' +
            '<p class="hint">Soll der Gast auf allen Geräten dabei sein, mit eigener Statistik und Training? ' +
              'Dann registriert er sich selbst mit dem Gast-Code – Ligaspiele kann er damit verfolgen, aber nicht mitspielen.</p>'
          : '') +
        '<div class="avatar-edit" data-action="pick-avatar">' +
          avatarHTML({ id: o.id || 'neu', name: p.name || '?', avatar: p.avatar }, 'xl') +
          '<span class="cam">Foto wählen</span>' +
        '</div>' +
        '<input class="name-input" type="text" data-role="profile-name" value="' + esc(p.name) + '" placeholder="Anzeigename (bis 16 Zeichen)" maxlength="16" aria-label="Anzeigename, bis 16 Zeichen">' +
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
          /* Ohne Konto und ohne Spiel haengt ein Profil an nichts - auch ein
             offline angelegter Spieler laesst sich dann wieder loeschen. */
          var ohneKonto = String(o.id).indexOf('u_') !== 0;
          var loeschbar = (vor.gast || ohneKonto) && !letztesSpielAm(o.id) && !profilImEinsatz(o.id);
          var imSpielplan = S.tour && !vor.hidden &&
            S.matches.some(function (m) { return !m.done && !m.void && m.p.indexOf(o.id) >= 0; });
          /* Gaeste lassen sich direkt loeschen: ohne Spiele spurlos, mit
             Spielen verschwinden sie aus allen Listen – die Ergebnisse der
             Mitspieler bleiben unangetastet. Nur mitten im laufenden
             Spielplan geht das nicht. */
          if (imSpielplan) {
            return '<p class="hint">' + esc(vor.name) + ' steht im laufenden Spielplan – ' +
              (vor.gast ? 'löschen' : 'ausblenden') + ' geht erst, wenn das Turnier beendet ist (unter „Turnier“ den Endstand ' +
              'abschließen, oder ' + esc(vor.name) + ' dort über „Spieler im Turnier“ abmelden).' +
              (vor.gast ? ' Danach verschwindet der Gast nach dem Abend von selbst.' : '') + '</p>';
          }
          return '<button class="btn danger ghost full" data-action="' +
            (loeschbar ? 'delete-profile' : vor.gast ? 'delete-guest' : 'hide-profile') + '">' +
            (vor.gast ? (o.loeschenOk ? 'Ja, Gast löschen' : 'Gast löschen')
              : loeschbar ? (o.loeschenOk ? 'Ja, Spieler löschen' : 'Spieler löschen')
              : vor.hidden ? 'Wieder einblenden' : o.hideOk ? 'Ja, ausblenden' : 'Spieler ausblenden') + '</button>' +
            '<p class="hint">' + (loeschbar
              ? (vor.gast ? 'Der Gast' : esc(vor.name)) + ' hat noch kein Spiel – ' + (vor.gast ? 'er verschwindet' : 'das Profil verschwindet') + ' spurlos.'
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
      /* Allein gespielt (in jeder Spielart): kein "gewinnt", sondern ausgemacht. */
      var gdSolo = !!S.game && (S.game.p || S.game.players || []).length < 2;
      html = '<div class="big-emoji">' + (gdSolo ? '🎯' : '🏆') + '</div><h3>' +
        (gdSolo ? 'Ausgemacht, ' : 'Glückwunsch, ') + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + (S.game ? kindName(S.game.kind) : '') +
          (S.game && S.game.kind === 'quick' && !gdSolo && mehrereLegs(S.game) ? ' · ' + standZeile(S.game) : '') + '</p>' +
        '<button class="' + gdKl(0, 'btn primary full') + '" data-action="open-summary" data-kind="' + esc((S.game ? S.game.kind : 'cricket')) + '" data-id="current">Weiter zur Spielstatistik</button>' +
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
                 : '<button class="btn danger ghost small" data-action="withdraw-player" data-id="' + esc(id) + '">Abmelden</button>') +
            '</div>';
        }).join('') +
        activeProfiles().filter(function (p) { return inTour.indexOf(p.id) < 0; }).map(function (p) {
          return '<div class="rc-row">' + avatarHTML(p, 'sm') +
            '<span class="rc-name">' + esc(p.name) + '</span>' +
            '<button class="btn small" data-action="add-player" data-id="' + esc(p.id) + '">Nachtragen</button>' +
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
        '<button class="btn primary full" data-action="ov-cancel">Zurück zur Auswahl</button>';
    }
    $('overlay-card').innerHTML = html;
    if (o.type === 'unterschrift') signaturVorbereiten();
    /* Mit Tastatur: in Dialogen ohne eigene Pfeil-Wahl gleich den
       Hauptknopf markieren, damit immer etwas sichtbar gewaehlt ist. */
    var karte = $('overlay-card');
    if (document.body.classList.contains('tastatur') && !PFEIL_DIALOGE[o.type] && o.type !== 'checkout-darts' &&
        !karte.contains(document.activeElement) && !karte.querySelector('input, select, textarea, canvas')) {
      var erster = karte.querySelector('.btn.primary') || karte.querySelector('button');
      if (erster) erster.focus({ preventScroll: true });
    }
  }

  /* ================= Aktionen ================= */
  /* ================= Ligaspiel =================
   * Der SDM-Spielberichtsbogen als Spielmodus: 16 Einzel (501 Double Out,
   * Best of 3 oder 5) zwischen unseren vier Positionen und den vier des
   * Gegners. Läuft komplett auf dem Turnier-Unterbau – nur der Spielplan
   * ist vorgegeben statt ausgelost, jedes Einzel beginnt mit dem Ausbullen
   * (der Gewinner wirft Leg 1 an, danach wechselt der Anwurf - SWO Punkt 8,
   * Fassung Oktober 2026), und die Übersicht zeigt den Team-Stand statt
   * einer Einzeltabelle.
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
        /* Gegen Bots wird nicht ausgebullt (die werfen keinen Bull) - der
           eigene Spieler wirft an. Gegen echte Leute wie im Ligaspiel. */
        starter: d.gegner === 'team' ? null : h, posPaar: paar.slice(),
        scheibe: LIGA_SCHEIBEN[i],
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
        /* SWO Punkt 8 (Fassung Oktober 2026): „Jedes Spiel beginnt mit dem
           Ausbullen. Der Spieler, der das Ausbullen gewinnt, beginnt das
           erste Leg." Ohne Anwerfer oeffnet die Partie im Bull-Off; jedes
           weitere Leg wechselt (macht ensureLeg von selbst). */
        starter: null,
        /* Welche Bogen-Positionen hier spielen und auf welcher Scheibe die
           Partie im Doppelbetrieb läuft (zwei nebeneinander je Durchgang). */
        posPaar: paar.slice(),
        scheibe: LIGA_SCHEIBEN[i],
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
      if (!da && p.gast && !p.dauer && (p.name === name || p.voll === name) && ausschluss.indexOf(p.id) < 0) da = p;
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

  /* Der Spielplan, wie ihn das geteilte Turnier auf dem Server fuehrt. */
  function planAusStand() {
    var gaeste = {};
    S.tour.players.forEach(function (id) {
      if (String(id).indexOf('u_') !== 0) gaeste[id] = pname(id);
    });
    return {
      start: S.tour.start, bestOf: S.tour.bestOf, players: S.tour.players.slice(),
      gaeste: gaeste, liga: S.tour.liga, planStand: S.tour.planStand || 0,
      matches: S.matches.map(function (m) {
        return { id: m.id, round: m.round, p: m.p.slice(), starter: m.starter, posPaar: m.posPaar, scheibe: m.scheibe };
      })
    };
  }
  /* Immer nur ein Plan unterwegs: ein zweiter Wechsel kurz danach wartet
     und geht mit dem dann aktuellen Planstand raus. Ohne Netz bleibt
     "planOffen" stehen und der naechste Abgleich schickt ihn nach. */
  var planUnterwegs = false, planNochmal = false;
  function geteiltenPlanSenden() {
    var t = geteiltesTurnier();
    if (!t || !window.DartSync || !window.DartSync.turnier || !window.DartSync.turnier.planAendern) return;
    S.tour.planOffen = true; save();
    if (planUnterwegs) { planNochmal = true; return; }
    planUnterwegs = true;
    window.DartSync.turnier.planAendern(planAusStand(), S.tour.planStand || 0).then(function (d) {
      planUnterwegs = false;
      if (d && d.turnier && d.turnier.plan) { S.tour.planStand = d.turnier.plan.planStand || 0; }
      if (planNochmal) { planNochmal = false; save(); geteiltenPlanSenden(); return; }
      delete S.tour.planOffen; save();
    }).catch(function (e) {
      planUnterwegs = false; planNochmal = false;
      if (!e || !e.status) return;   // kein Netz: planOffen bleibt, der Abgleich schickt nach
      delete S.tour.planOffen;
      /* Das andere iPad war schneller: dessen Plan gilt, der Wechsel hier
         muss neu gemacht werden. */
      if (e && e.status === 409 && e.daten && e.daten.turnier) {
        uebernehmeTurnier(e.daten.turnier);
        UI.overlay = { type: 'hinweis', titel: 'Wechsel nicht übernommen',
          text: 'Auf dem anderen iPad wurde gerade auch gewechselt. Bitte den Wechsel hier noch einmal prüfen und ggf. wiederholen.' };
      } else if (e && e.status) {
        UI.overlay = { type: 'hinweis', titel: 'Wechsel nur hier',
          text: 'Der Wechsel kam nicht beim Server an (' + (e && e.message ? e.message : 'kein Netz') + '). Das andere iPad kennt ihn noch nicht – bitte dort ebenfalls wechseln oder gleich nochmal versuchen.' };
      }
      render();
    });
  }
  /* Einen geaenderten Plan vom anderen iPad uebernehmen: Aufstellung und
     Spielerlisten, und die Paarungen der Einzel, die hier noch nicht
     begonnen sind und gerade nicht hier gespielt werden. */
  function planNachreichen() {
    if (S.tour && S.tour.planOffen && !planUnterwegs) geteiltenPlanSenden();
  }
  function planAnwenden(plan) {
    if (!S.tour || !plan) return false;
    var lgNeu = plan.liga, lg = S.tour.liga;
    if (lg && lgNeu) {
      ['posH', 'posG', 'heimSpieler', 'gastSpieler', 'wir', 'sie'].forEach(function (k) {
        if (Array.isArray(lgNeu[k])) lg[k] = lgNeu[k].slice();
      });
    }
    if (Array.isArray(plan.players)) S.tour.players = plan.players.slice();
    var g = plan.gaeste || {};
    Object.keys(g).forEach(function (gid) {
      if (S.profiles.some(function (p) { return p.id === gid; })) return;
      S.profiles.push({ id: gid, name: String(g[gid]).slice(0, 30), voll: g[gid], avatar: null, hue: freeHue(), created: Date.now(), gast: true });
    });
    (plan.matches || []).forEach(function (pm) {
      var m = matchById(pm.id);
      if (!m || m.done || S.current === m.id) return;
      if (m.legs.some(function (l) { return l.visits.length > 0; })) return;
      m.p = pm.p.slice();
      m.starter = pm.starter || null;
      m.legs = [];
    });
    S.tour.planStand = plan.planStand || 0;
    return true;
  }

  function ligaWechseln(seite, pos, neueId) {
    var lg = S.tour && S.tour.liga;
    if (!lg) return 'Kein Ligaspiel.';
    /* Im geteilten Spiel (zwei iPads) geht der Wechsel als geaenderter
       Spielplan an den Server; das andere Geraet uebernimmt ihn beim
       naechsten Abgleich (planAnwenden). Ohne Netz geht das nicht. */
    /* Ohne Netz geht der Wechsel trotzdem: er gilt hier sofort und wird
       nachgereicht, sobald wieder Netz da ist (planOffen). */
    if (geteiltesTurnier() && !(window.DartSync && window.DartSync.turnier && window.DartSync.turnier.planAendern)) {
      return 'Diese App-Version kann im geteilten Ligaspiel nicht wechseln – bitte neu laden.';
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
      /* Spielt das andere iPad dieses Einzel gerade, bleibt es unangetastet. */
      if (m.belegtVon) return;
      var raus = m.p[idx];
      m.p[idx] = neueId;
      /* War der Ausgewechselte schon als Anwerfer ausgebullt, uebernimmt
         der Neue diesen Platz - geworfen ist ja noch nichts. */
      if (m.starter === raus) m.starter = neueId;
      /* Ist nach dem Ausbullen schon das (leere) erste Leg angelegt, wirft
         dort ebenfalls der Neue an. */
      m.legs.forEach(function (l) { if (l.starter === raus) l.starter = neueId; });
    });
    save();
    if (geteiltesTurnier()) geteiltenPlanSenden();
    return null;
  }

  function startTournament(confirmed) {
    bereinigeAufstellung();
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
      var angefangen = m.legs.some(function (l) { return l.visits.length > 0; });
      /* Eine eigene Korrektur (Undo nach Checkout) oder ein hier schon
         angefangenes Einzel im beendeten Turnier: ohne Anspruch weiter. */
      if (m.korrektur || (S.tour.beendet && angefangen)) { oeffneJetzt(id); return; }
      if (S.tour.beendet) {
        UI.overlay = { type: 'hinweis', titel: 'Turnier beendet', text: 'Dieses Turnier wurde auf dem anderen Gerät beendet – neue Einzel lassen sich nicht mehr starten.' };
        render();
        return;
      }
      UI.overlay = { type: 'warte', text: 'Partie wird übernommen …' };
      render();
      window.DartSync.turnier.beanspruchen(id).then(function () {
        UI.overlay = null;
        oeffneJetzt(id);
      }).catch(function (e) {
        /* Kein Netz: trotzdem spielen. Der Anspruch kommt mit dem naechsten
           Herzschlag, das Ergebnis wird nachgereicht. */
        if (!e || !e.status) { UI.overlay = null; oeffneJetzt(id); return; }
        if (e.daten && e.daten.turnier) uebernehmeTurnier(e.daten.turnier);
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
    UI.bullWahl = 0; UI.bullTastatur = tastaturBetrieb();
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
        // spielScreen: das Schnelle Spiel heisst 'quick', sein Bildschirm
        // aber 'game' - der rohe kind-Name liesse die Seite schwarz.
        if (target === 'setup' && S.game && !S.game.done) target = spielScreen(S.game.kind);
        /* Ein fertig gespieltes Turnier, das nie über „Turnier abschließen"
           gegangen ist, hielt den Game-Tab sonst wochenlang in der alten
           Tabelle fest. Es wird jetzt wie beim Abschließen archiviert (der
           Endstand bleibt in der Spieleliste nachschlagbar), und es geht ins
           Setup. Nur ein noch offenes Turnier führt zurück auf den Spielplan. */
        else if (target === 'setup' && S.matches.length && allMatchesDone() && ligaNochOffen()) target = 'winner';
        else if (target === 'setup' && S.matches.length && allMatchesDone()) archiveTournament();
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
        UI.overlay = { type: 'profile', id: p.id, draft: { name: p.name, avatar: p.avatar, dbl: p.dbl || null, vor: pTeile.vor, nach: pTeile.nach, dauer: !!p.dauer } };
        render();
        break;
      }
      case 'edit-current-profile': {
        var cp = profile(UI.profile);
        var cpTeile = vollSplit(cp.voll);
        UI.overlay = { type: 'profile', id: cp.id, draft: { name: cp.name, avatar: cp.avatar, dbl: cp.dbl || null, vor: cpTeile.vor, nach: cpTeile.nach, dauer: !!cp.dauer } };
        render();
        break;
      }
      case 'pick-avatar':
        $('avatar-input').click();
        break;
      case 'gast-art':
        if (UI.overlay && UI.overlay.type === 'profile') { UI.overlay.draft.dauer = el.getAttribute('data-value') === '1'; render(); }
        break;
      case 'clear-avatar':
        UI.overlay.draft.avatar = null;
        render();
        break;
      case 'save-profile': {
        var draft = UI.overlay.draft;
        var name = (draft.name || '').trim();
        /* Ohne Namen kein Profil - frueher entstand still "Spieler 7". */
        if (!name) { UI.overlay.fehler = 'Bitte einen Namen eingeben.'; render(); return; }
        /* Gleicher Name wie ein anderer sichtbarer Spieler: einmal warnen,
           beim zweiten Speichern gilt es (z. B. zwei Tobis). */
        var doppelt = S.profiles.some(function (x) {
          return x.id !== UI.overlay.id && !x.hidden && String(x.name).trim().toLowerCase() === name.toLowerCase();
        });
        if (doppelt && UI.overlay.doppeltOk !== name) {
          UI.overlay.doppeltOk = name;
          UI.overlay.fehler = '„' + name + '“ gibt es schon. Nochmal auf Speichern tippen, wenn es wirklich ein zweiter Spieler ist.';
          render();
          return;
        }
        if (UI.overlay.id) {
          var ex = profile(UI.overlay.id);
          ex.name = name;
          ex.avatar = draft.avatar;
          ex.dbl = draft.dbl || null;
          if (ex.gast) {
            /* Wird ein dauerhafter Gast wieder temporaer, zaehlt die Frist ab jetzt. */
            if (ex.dauer && !draft.dauer) ex.fristAb = Date.now();
            ex.dauer = !!draft.dauer;
          }
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
          if (window.DartKonto && window.DartKonto.nutzer()) { np.gast = true; np.dauer = !!draft.dauer; }
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
        if ((!dp.gast && String(dp.id).indexOf('u_') === 0) || letztesSpielAm(dp.id) || profilImEinsatz(dp.id)) return;
        /* Loeschen fragt einmal nach - der Knopf sitzt direkt unter Speichern. */
        if (!UI.overlay.loeschenOk) { UI.overlay.loeschenOk = true; render(); return; }
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
        if (!UI.overlay.loeschenOk) { UI.overlay.loeschenOk = true; render(); return; }
        /* Steht der Gast im laufenden Spielplan, wuerde das Loeschen offene
           Einzel verwaisen lassen - erst das Turnier beenden. */
        if (S.tour && S.matches.some(function (m) { return !m.done && !m.void && m.p.indexOf(dg.id) >= 0; })) return;
        dg.hidden = true;
        S.lineup = S.lineup.filter(function (x) { return x !== dg.id; });
        /* Steht er noch im (fertigen) Spielplan, bleibt er dort als Kennung --
           aus der Aufstellung eines neuen Turniers ist er raus. */
        if (S.tour && S.tour.players) S.tour.players = S.tour.players.filter(function (x) { return x !== dg.id; });
        UI.overlay = null;
        if (S.screen === 'profile' && UI.profile === dg.id) S.screen = 'players';
        save(); render();
        break;
      }
      case 'hide-profile': {
        var hp = profile(UI.overlay.id);
        /* Wer im laufenden Spielplan steht, bliebe dort als Geist stehen. */
        if (!hp.hidden && S.tour && S.matches.some(function (m) { return !m.done && !m.void && m.p.indexOf(hp.id) >= 0; })) return;
        if (!hp.hidden && !UI.overlay.hideOk) { UI.overlay.hideOk = true; render(); return; }
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
      case 'liga-team':
        UI.ligaTeam = el.getAttribute('data-team');
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
      /* Einem Online-Spiel beitreten. Ein angefangenes eigenes Spiel wuerde
         dabei verworfen -- das fragt die App vorher. */
      case 'live-beitreten': {
        var lid = el.getAttribute('data-id');
        var lsp = null;
        liveBeitretbare.forEach(function (g) { if (g.id === lid) lsp = g; });
        if (!lsp) return;
        if (S.game && !S.game.done && !UI.liveBestaetigt) {
          UI.overlay = { type: 'confirm-live-beitreten', id: lid, kind: lsp.kind };
          render();
          return;
        }
        UI.liveBestaetigt = false;
        liveBeitretbare = liveBeitretbare.filter(function (g) { return g.id !== lid; });
        UI.overlay = { type: 'warte', text: 'Spielstand wird geholt …' };
        render();
        window.DartSync.live.holen(lid, 0).then(function (voll) {
          UI.overlay = null;
          if (voll && voll.status === 'offen' && voll.state) liveBeitreten(voll);
          else { UI.overlay = { type: 'hinweis', text: 'Dieses Online-Spiel ist inzwischen zu.' }; render(); }
        }).catch(function (e) {
          UI.overlay = { type: 'hinweis', text: e && e.message ? e.message : 'Das hat nicht geklappt.' };
          render();
        });
        break;
      }
      case 'ov-live-beitreten': {
        UI.liveBestaetigt = true;
        var lod = UI.overlay && UI.overlay.id;
        UI.overlay = null;
        handleActionInner('live-beitreten', { getAttribute: function () { return lod; } });
        break;
      }
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
        if (!fg || fg.kind !== 'finisher' || fg.done) break;
        /* Nur wer im Stechen steht, kann es gewinnen - ein alter Knopf
           (Doppeltipp, zweites Geraet) darf keine Runde vergeben. */
        var fsRd = finisherRunde(fg);
        var fsWer = el.getAttribute('data-id');
        if (!fsRd.stechen || fsRd.stechen.spieler.indexOf(fsWer) < 0) break;
        finisherRundeAn(fg, fsWer); save(); render();
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
        if (S.game && !S.game.started) { liveEnde(S.game); S.game = null; S.screen = 'setup'; }
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
        /* Ein echtes Ligaspiel schliesst nur der Spielbericht ab. */
        if (ligaNochOffen()) { UI.bericht = null; UI.berichtVon = 'winner'; S.screen = 'bericht'; save(); render(); break; }
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
        if (rtwState(rwg).stechen) return;   // im Stechen gibt es keine Aufnahme aufzufuellen
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
        if (ichBinGastKonto()) {
          UI.overlay = { type: 'hinweis', titel: 'Gast-Konto', text: 'Mit einem Gast-Konto kannst du Ligaspiele über den Live-Ticker verfolgen, aber nicht anlegen oder mitspielen. Training und alle anderen Spiele gehen ganz normal.' };
          render(); break;
        }
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
        var lsAktive = ligaKader();
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
           darf sie nicht auf Einnahme zuruecksetzen. Die Kategorienliste
           wechselt mit, das Mitglied-Feld gibt es nur bei Beitraegen. */
        UI.kasseArt = el.getAttribute('data-value');
        UI.kasseKategorie = null;
        if (UI.kasseEdit) UI.kasseEdit = Object.assign({}, UI.kasseEdit, { betrag: Math.abs(UI.kasseEdit.betrag) * (UI.kasseArt === 'aus' ? -1 : 1) });
        document.querySelectorAll('#kasse-art button').forEach(function (b) {
          b.classList.toggle('active', b === el);
        });
        var kkSel = $('kasse-kategorie');
        if (kkSel) kkSel.outerHTML = kasseKategorieWahl(UI.kasseArt, null);
        var kmZ = $('kasse-mitglied-zeile');
        if (kmZ) kmZ.classList.toggle('hidden', !(UI.kasseArt !== 'aus' && kasseKategorien('ein')[0] === 'Mitgliedsbeiträge'));
        break;
      }
      case 'kasse-buchen': {
        if (!(window.DartSync && window.DartSync.kasse)) break;
        var kbCent = centAus(($('kasse-betrag') || {}).value);
        var kbText = String(($('kasse-text') || {}).value || '').trim();
        var kbMeld = $('kasse-meldung');
        if (!isFinite(kbCent) || kbCent <= 0) { if (kbMeld) kbMeld.textContent = 'Bitte einen Betrag über 0 eintragen.'; break; }
        if (!kbText) { if (kbMeld) kbMeld.textContent = 'Bitte eine Beschreibung dazuschreiben.'; break; }
        var kbAus = UI.kasseArt === 'aus';
        var kbKat = ($('kasse-kategorie') || {}).value || kasseKategorien(kbAus ? 'aus' : 'ein')[0];
        var kbMitglied = ($('kasse-mitglied') || {}).value || null;
        var kbDatum = ($('kasse-datum') || {}).value || heuteISO();
        var kbDaten = {
          betrag: kbCent * (kbAus ? -1 : 1), text: kbText, kategorie: kbKat, datum: kbDatum,
          mitglied: kbKat === 'Mitgliedsbeiträge' ? kbMitglied : null
        };
        (UI.kasseEdit ? window.DartSync.kasse.aendern(UI.kasseEdit.id, kbDaten) : window.DartSync.kasse.buchen(kbDaten)).then(function (d) {
          kasseDaten = d;
          UI.kasseArt = 'ein'; UI.kasseKategorie = null; UI.kasseEdit = null;
          if ($('kasse-betrag')) $('kasse-betrag').value = '';
          if ($('kasse-text')) $('kasse-text').value = '';
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          render();
        }).catch(function (e) {
          if (kbMeld) kbMeld.textContent = 'Buchen hat nicht geklappt: ' + e.message;
        });
        break;
      }
      /* Ein Tipp neben dem Namen: der Gruendungsbeitrag ist bezahlt. */
      case 'kasse-beitrag': {
        if (!(window.DartSync && window.DartSync.kasse) || !kasseDaten) break;
        var kbtId = el.getAttribute('data-id');
        var kbtName = el.getAttribute('data-name') || '';
        var kbtBetrag = (kasseDaten.konfig && kasseDaten.konfig.beitrag) || 5000;
        el.disabled = true;
        window.DartSync.kasse.buchen({
          betrag: kbtBetrag, text: 'Gründungsbeitrag ' + kbtName, kategorie: 'Mitgliedsbeiträge',
          datum: heuteISO(), mitglied: kbtId
        }).then(function (d) { kasseDaten = d; render(); })
          .catch(function () { el.disabled = false; });
        break;
      }
      /* Kassenwart: eine Buchung ins Formular holen und aendern. */
      case 'kasse-edit': {
        if (!kasseDaten) break;
        var keId = Number(el.getAttribute('data-id'));
        var keE = (kasseDaten.eintraege || []).filter(function (e) { return e.id === keId; })[0];
        if (!keE) break;
        UI.kasseEdit = keE;
        UI.kasseArt = keE.betrag < 0 ? 'aus' : 'ein';
        UI.kasseKategorie = keE.kategorie;
        if ($('kasse-betrag')) $('kasse-betrag').value = '';
        if ($('kasse-text')) $('kasse-text').value = '';
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        render();
        var keForm = document.querySelector('.kasse-form');
        if (keForm && keForm.scrollIntoView) keForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'kasse-edit-abbruch': {
        UI.kasseEdit = null; UI.kasseArt = 'ein'; UI.kasseKategorie = null;
        if ($('kasse-betrag')) $('kasse-betrag').value = '';
        if ($('kasse-text')) $('kasse-text').value = '';
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        render();
        break;
      }
      case 'kasse-konfig': {
        if (!(window.DartSync && window.DartSync.kasse)) break;
        var kkJahr = parseInt(($('kasse-jahr') || {}).value, 10);
        var kkAnfang = centAus(($('kasse-anfang') || {}).value);
        var kkMeld = $('kasse-meldung');
        if (!isFinite(kkAnfang)) { if (kkMeld) kkMeld.textContent = 'Der Anfangsbestand ist unbrauchbar.'; break; }
        window.DartSync.kasse.einstellen({ jahr: kkJahr, anfangsbestand: kkAnfang }).then(function (d) {
          kasseDaten = d;
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          render();
        }).catch(function (e) { if (kkMeld) kkMeld.textContent = 'Speichern hat nicht geklappt: ' + e.message; });
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
          var w = function (i) { return z[i].textContent.trim().slice(0, 12); };
          ltZeilen.push({
            team: z[1].textContent.trim().slice(0, 60),
            spiele: w(2), g: w(3), u: w(4), v: w(5), legs: w(6), einzel: w(7), punkte: w(8)
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
      case 'bericht-kreuz': {
        var kq = ligaBerichtQuelle();
        if (!kq || berichtIstFinal(kq.liga)) break;
        var kFeld = el.getAttribute('data-feld');
        if (!kq.liga.berichtKreuze) kq.liga.berichtKreuze = {};
        kq.liga.berichtKreuze[kFeld] = el.getAttribute('data-wert');
        save();
        var kZelle = el.closest('td[data-feld]');
        if (kZelle) kZelle.innerHTML = berichtKreuzHtml(kq.liga, kFeld);
        break;
      }
      case 'liga-ticker':
        if (S.tour && S.tour.geteilt && !S.tour.zuschauer && window.DartSync && window.DartSync.turnier) {
          window.DartSync.turnier.abgleich(true).then(function () { render(); });
        }
        UI.overlay = { type: 'live-ticker' };
        render();
        break;
      case 'ticker-kopieren': {
        var tl = S.tour && S.tour.zuschauer ? location.origin + '/live.html#' + S.tour.zuschauer : '';
        if (tl && navigator.clipboard) navigator.clipboard.writeText(tl).then(function () { el.textContent = 'Kopiert ✓'; }, function () {});
        break;
      }
      case 'ticker-teilen': {
        var tl2 = S.tour && S.tour.zuschauer ? location.origin + '/live.html#' + S.tour.zuschauer : '';
        if (!tl2) break;
        var tTitel = S.tour.liga ? 'Live: ' + LIGA.team + ' – ' + S.tour.liga.gegner : 'Live-Ticker';
        if (navigator.share) navigator.share({ title: tTitel, text: tTitel, url: tl2 }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(tl2).then(function () { el.textContent = 'Kopiert ✓'; }, function () {});
        break;
      }
      case 'liga-nachmelden':
        nachmeldungStarten();
        break;
      case 'nm-wahl':
        if (UI.overlay && UI.overlay.type === 'nachmeldung') {
          UI.overlay.draft[el.getAttribute('data-feld')] = el.getAttribute('data-value');
          UI.overlay.fehler = '';
          render();
        }
        break;
      case 'nm-weiter':
        nachmeldungWeiter();
        break;
      case 'bericht-unterschreiben':
        berichtUnterschreibenStarten();
        break;
      case 'signatur-nochmal':
        if (UI.overlay && UI.overlay.type === 'unterschrift') { UI.overlay.striche = []; UI.overlay.fehler = ''; render(); }
        break;
      case 'signatur-weiter':
        signaturWeiter();
        break;
      case 'bericht-senden':
        berichtSenden();
        break;
      case 'bericht-ohne-senden':
        berichtOhneSendenAbschliessen();
        break;
      case 'liga-zum-spiel':
        S.screen = 'tournament'; save(); render();
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
        UI.overlay = null; save(); render();
        break;
      case 'willkommen-weg':
        S.settings.willkommenWeg = 1;
        save(); render();
        break;
      case 'ton-an':
        /* Der Tipp hat den Ton schon geweckt (pointerdown in sound.js). */
        setTimeout(function () { tonKnopf(!!liveSpiel()); }, 250);
        break;
      case 'quick-step': {
        var qk = el.getAttribute('data-key');
        var qBest = S.settings.quickModus === 1;
        var qSchritt = (qBest ? 2 : 1) * Number(el.getAttribute('data-dir'));
        var qMax = qBest ? 2 * QUICK_MAX - 1 : QUICK_MAX;
        S.settings[qk] = Math.max(1, Math.min(qMax, (S.settings[qk] || 1) + qSchritt));
        save(); render();
        break;
      }
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
        var lwErste = lwEigene ? (ligaKader()[0] || {}).id || '' : '';
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
      case 'ov-keep-legs':
        liveEnde(S.game);
        archiveGame(S.game, true);
        S.game = null;
        UI.overlay = null;
        S.screen = 'setup';
        save(); render();
        break;
      case 'ov-discard-game':
        liveEnde(S.game);
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
  /* Vollbild-Dialoge haben keinen "Rand daneben" - ein Tipp auf leere Flaeche
     (oder beim Unterschreiben knapp neben das Feld) schliesst sie nicht. */
  var VOLLBILD_DIALOGE = { 'liga-start': 1, 'uebung-start': 1, 'unterschrift': 1, 'bericht-versand': 1, 'nachmeldung': 1 };
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
    /* Angefangene Aufnahme in Einzel-Darts: ein Wechsel auf Punkte wuerde
       die gebuchten Darts still verwerfen (Rest 170, S20, dann "100" ->
       70 statt 50). Erst fertig werfen oder zuruecknehmen. */
    if (UI.darts.length && neuerModus !== 'darts' && neuerModus !== 'kamera') {
      UI.error = 'Erst die angefangene Aufnahme fertig werfen oder zurücknehmen.';
      render();
      return;
    }
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
    /* Fuer jede Spielart gleich geprueft und normalisiert: nur echte Felder
       (0-20, 25), Faktor 1-3, und Bull hoechstens doppelt. */
    mult = Number(mult); num = Number(num);
    if (!(num === 25 || (num >= 0 && num <= 20 && num % 1 === 0))) return false;
    if (!(mult === 1 || mult === 2 || mult === 3)) return false;
    if (num === 25 && mult > 2) mult = 2;
    if (num === 0) mult = 1;
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
    if (ev.target.id === 'overlay' && UI.overlay && !STICKY_OVERLAYS[UI.overlay.type] && !VOLLBILD_DIALOGE[UI.overlay.type]) {
      UI.overlay = null; UI.input = ''; render(); return;
    }
    if (UI.turnier && turnierErlaubt() && S.screen === 'game' && !UI.overlay &&
        !ev.target.closest('#turnier-exit')) {
      zeigeTurnierExit();
    }
    var t = ev.target.closest('[data-action]');
    if (t) { handleAction(t.getAttribute('data-action'), t); return; }

    /* Kassenbuch: die Kategorie merken (Hintergrund-Render) und das
       Mitglied-Feld nur bei Mitgliedsbeitraegen zeigen. */
    var kkat = ev.target.closest('#kasse-kategorie');
    if (kkat) {
      UI.kasseKategorie = kkat.value;
      var kmz = $('kasse-mitglied-zeile');
      if (kmz) kmz.classList.toggle('hidden', kkat.value !== 'Mitgliedsbeiträge');
      return;
    }
    var seg = ev.target.closest('[data-setting] button');
    if (seg) {
      var key = seg.parentElement.getAttribute('data-setting');
      var wert = Number(seg.getAttribute('data-value'));
      /* Schreibweise der Spieldauer gewechselt: dasselbe Ziel in der anderen
         Zaehlung -- First to 2 ist Best of 3. */
      if (key === 'quickModus' && wert !== S.settings.quickModus) {
        ['quickSaetze', 'quickLegs'].forEach(function (k) {
          S.settings[k] = wert === 1 ? 2 * S.settings[k] - 1 : Math.floor(S.settings[k] / 2) + 1;
        });
      }
      S.settings[key] = wert;
      save(); render();
      return;
    }

    var modeBtn = ev.target.closest('#mode-toggle button');
    if (modeBtn) {
      tipp();
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
    if (mult) { tipp(); UI.mult = Number(mult.getAttribute('data-mult')); render(); return; }

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
  /* Nach einer Handkorrektur der Einzel-Bezeichnung neu einkreisen. */
  document.addEventListener('focusout', function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest('#bericht-blatt th[data-plan]')) berichtWechselMarkieren();
  });
  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest('#bericht-blatt [contenteditable]')) {
      berichtKorrekturMerken(ev.target.closest('#bericht-blatt [contenteditable]'));
    }
    if ((ev.target.getAttribute('data-role') === 'nm-nach' || ev.target.getAttribute('data-role') === 'nm-vor') &&
        UI.overlay && UI.overlay.type === 'nachmeldung') {
      UI.overlay.draft[ev.target.getAttribute('data-role') === 'nm-nach' ? 'nach' : 'vor'] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'bericht-mail' && UI.overlay && UI.overlay.type === 'bericht-versand') {
      UI.overlay.adressen[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
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
  /*
   * Ziffernblock als Pfeiltasten (Julius' Belegung am Board): 2 = hoch,
   * 8 = runter, 4 = links, 6 = rechts. Das gilt nur dort, wo mit Pfeilen
   * gewaehlt wird und Ziffern sonst nichts bedeuten - beim Ausbullen und in
   * den Dialogen nach Leg, Spiel und Einzel. Bei der Punkte-Eingabe und der
   * Checkout-Frage (1/2/3 Darts) bleiben Ziffern Ziffern. Uebersetzt wird
   * vor allen anderen Tasten-Lauschern, die dann einen echten Pfeil sehen.
   */
  /* "clear" am Ziffernblock: das Getippte ist der neue REST, nicht die
     Punktzahl - bei 50 Rest "8" + clear bucht 42 (so zaehlen viele im
     Finish-Bereich). 0 + clear ist das Checkout; Rest 1 oder weniger als 0
     ist wie immer Bust. */
  function istRestTaste(ev) {
    return ev.key === 'Clear' || ev.key === 'NumLock' || ev.code === 'NumLock' || ev.code === 'NumpadClear';
  }
  function restBuchen() {
    var m = currentMatch();
    if (!m || m.done) return;
    if (UI.input === '') { UI.error = 'Erst den Rest eintippen, dann clear.'; render(); return; }
    var leg = activeLeg(m);
    var rest = remainingIn(leg, activePlayer(leg, m)) - sum(UI.darts, function (d) { return d.v; });
    var neu = parseInt(UI.input, 10);
    if (neu > rest) { UI.error = 'Rest ' + neu + ' ist mehr als vorher (' + rest + ').'; UI.input = ''; render(); return; }
    var wurf = rest - neu;
    if (wurf > 180) { UI.error = 'Das wären ' + wurf + ' Punkte – mehr als 180.'; UI.input = ''; render(); return; }
    UI.input = String(wurf);
    submitTotal();
  }

  /* "-" am Ziffernblock: die Aufnahme ist ueberworfen - zaehlt nicht, der
     Rest bleibt. Was schon getippt war, verfaellt. */
  function istUeberworfenTaste(ev) {
    return ev.key === '-' || ev.code === 'NumpadSubtract';
  }
  function ueberworfenBuchen() {
    var m = currentMatch();
    if (!m || m.done) return;
    if (UI.darts.length) { UI.error = 'Die Aufnahme läuft in Einzel-Darts – bitte dort weiter eintragen.'; render(); return; }
    UI.input = ''; UI.error = '';
    pomp();
    commitVisit(0, 3, false, true);
  }

  /* Leg-Ende im Turnier/Ligaspiel: dritte Wahl "zur Uebersicht" (das Einzel
     bleibt offen und geht dort mit "Weiter" weiter). Im Schnellen Spiel
     gibt es keinen Spielplan. */
  function legDoneUebersicht() {
    var m = currentMatch();
    return !!(m && m.kind !== 'quick' && !S.game && S.matches.indexOf(m) >= 0);
  }

  /* Welche Ziffer meint die Taste? Der Ziffernblock zaehlt immer als Ziffer -
     auch wenn NumLock aus ist und der Browser "Ende", "Pfeil hoch" usw.
     meldet (dann waere am Board sonst keine Zahl angekommen). */
  function tasteZiffer(ev) {
    var m = /^Numpad([0-9])$/.exec(ev.code || '');
    if (m) return m[1];
    return ev.key && ev.key.length === 1 && ev.key >= '0' && ev.key <= '9' ? ev.key : null;
  }

  /* Wie auf dem Ziffernblock am Board (Satechi): 8 oben, 2 unten. Neben den
     Ziffernblock-Codes gelten dort, wo Ziffern nichts bedeuten (Ausbullen,
     Dialoge), auch die Tasten "8/2/4/6" selbst - manche Bluetooth-Bloecke
     melden sich wie die normale Zahlenreihe. */
  var ZIFFERN_PFEILE = { Numpad8: 'ArrowUp', Numpad2: 'ArrowDown', Numpad4: 'ArrowLeft', Numpad6: 'ArrowRight' };
  var ZIFFER_RICHTUNG = { '8': 'ArrowUp', '2': 'ArrowDown', '4': 'ArrowLeft', '6': 'ArrowRight' };
  var PFEIL_DIALOGE = { 'leg-done': 1, 'game-done': 1, 'turnier-ende': 1 };
  /* Nach dem Leg (leg-done) sind 8/2/4/6 Pfeile: dort wird gewaehlt
     (naechstes Leg, Eingabe rueckgaengig, Turnieruebersicht). */
  var ZIFFERN_BLEIBEN = { 'checkout-darts': 1, 'edit-visit': 1, 'match-done': 1, 'game-done': 1 };
  /* Wird mit der Tastatur gearbeitet, ist der gewaehlte Knopf immer
     deutlich markiert (keine Maus, kein Finger am Board). */
  window.addEventListener('keydown', function () { document.body.classList.add('tastatur'); }, true);
  /* Wird gerade mit der Tastatur gearbeitet (letzte Eingabe war eine Taste,
     kein Tipp)? Dann zeigt das naechste Ausbullen die Markierung gleich. */
  function tastaturBetrieb() { return document.body.classList.contains('tastatur'); }
  /* Das gewaehlte Einzel im Turnier-Menue in den sichtbaren Bereich holen. */
  function planWahlZeigen() {
    var z = document.querySelector('#schedule .match-row.wahl');
    if (z && z.scrollIntoView) z.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  /* Touch beim Ausbullen: die Tastatur-Markierung verschwindet (nicht auf
     einem Knopf - der wird ja gerade angetippt und darf nicht neu gezeichnet
     werden, sonst ginge der Tipp verloren). */
  window.addEventListener('pointerdown', function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest('button')) return;
    if (S.screen === 'bulloff' && UI.bullTastatur) { UI.bullTastatur = false; render(); }
    else if (S.screen === 'tournament' && UI.planTastatur) { UI.planTastatur = false; render(); }
  }, true);
  window.addEventListener('pointerdown', function () { document.body.classList.remove('tastatur'); }, true);
  /* "/" am Ziffernblock ist Tab: im Spiel Wechsel der Ansicht, in Dialogen
     und beim Ausbullen die naechste Wahl. */
  window.addEventListener('keydown', function (ev) {
    if (!(ev.key === '/' || ev.code === 'NumpadDivide') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target && ev.target.closest && ev.target.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]')) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
  }, true);
  window.addEventListener('keydown', function (ev) {
    var pfeil = ZIFFERN_PFEILE[ev.code] || ZIFFER_RICHTUNG[ev.key];
    if (!pfeil || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var ziel = ev.target;
    if (ziel && ziel.closest && ziel.closest('input, select, textarea')) return;
    /* Nicht in den Dialogen nach Leg und Spiel: dort tippt der Schreiber oft
       gleich die naechste Aufnahme - eine 6 als Pfeil haette "Eingabe
       rueckgaengig" markiert und Enter den Checkout geloescht. */
    var passt = UI.overlay
      ? !ZIFFERN_BLEIBEN[UI.overlay.type]
      : S.screen === 'bulloff' || S.screen === 'tournament';
    if (!passt) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: pfeil, code: pfeil, bubbles: true, cancelable: true }));
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && UI.overlay && !STICKY_OVERLAYS[UI.overlay.type] && !VOLLBILD_DIALOGE[UI.overlay.type]) {
      UI.overlay = null; UI.input = ''; render();
      return;
    }
    /* Tab schaltet die drei Eingabemodi im Kreis durch - dieselben Knoepfe,
       nur per Tastatur: Punkte -> Einzel-Darts -> Turnier -> Punkte (der
       Turnier-Modus haengt nur mit im Kreis, wo es ihn gibt). Ein offener
       Dialog geht vor. */
    /* Ausbullen am Board: Pfeile/Tab wechseln den Kandidaten, Enter
       bestaetigt den Anwerfer. */
    var bPfeil = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
    /* Turnier-Menue: hoch/runter (8/2) waehlt das naechste Einzel, Enter
       startet es. Die Markierung erscheint erst mit der ersten Taste. */
    if (S.screen === 'tournament' && !UI.overlay && (bPfeil || ev.key === 'Tab' || ev.key === 'Enter') &&
        !(ev.target && ev.target.closest && ev.target.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]'))) {
      var pKnoepfe = Array.prototype.slice.call(document.querySelectorAll('#schedule [data-action="open-match"]'));
      var pFokus = document.activeElement && document.activeElement !== document.body && document.activeElement.closest &&
        document.activeElement.closest('button, a');
      if (pKnoepfe.length && !(ev.key === 'Enter' && pFokus && !UI.planTastatur)) {
        var pIds = pKnoepfe.map(function (k) { return k.getAttribute('data-id'); });
        var pAlt = pIds.indexOf(UI.planWahlId);
        if (!UI.planTastatur || pAlt < 0) {
          var pNext = nextOpenMatch();
          pAlt = pNext && pIds.indexOf(pNext.id) >= 0 ? pIds.indexOf(pNext.id) : 0;
          ev.preventDefault(); ev.stopImmediatePropagation();
          /* Erster Druck (oder die Wahl ist inzwischen vergeben): nur zeigen. */
          UI.planTastatur = true; UI.planWahlId = pIds[pAlt];
          render(); planWahlZeigen();
          return;
        }
        ev.preventDefault(); ev.stopImmediatePropagation();
        if (ev.key === 'Enter') {
          UI.planTastatur = tastaturBetrieb();
          handleAction('open-match', pKnoepfe[pAlt]);
          return;
        }
        var pNeu = ev.key === 'Tab' ? (pAlt + 1) % pIds.length
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? Math.min(pIds.length - 1, pAlt + 1) : Math.max(0, pAlt - 1);
        UI.planWahlId = pIds[pNeu];
        render(); planWahlZeigen();
        return;
      }
    }
    if (S.screen === 'bulloff' && !UI.overlay && (UI.turnier && turnierErlaubt() || UI.bullTastatur || bPfeil || ev.key === 'Tab')) {
      var bKnoepfe = document.querySelectorAll('#bulloff-buttons [data-action="pick-starter"]');
      if (bKnoepfe.length) {
        /* Hinter den Kandidaten steht als letzte Wahl "Zurueck" (Index n):
           runter fuehrt dorthin, hoch wieder zum Kandidaten. Stehen die
           Kandidaten untereinander (Handy), laufen hoch/runter durch sie. */
        var bN = bKnoepfe.length;
        var bZurueck = document.querySelector('#screen-bulloff > [data-action="to-tournament"]');
        var bMax = bZurueck && bZurueck.offsetParent ? bN : bN - 1;
        var bUnter = bN > 1 && bKnoepfe[1].getBoundingClientRect().top > bKnoepfe[0].getBoundingClientRect().top + 5;
        if (bPfeil || ev.key === 'Tab') {
          ev.preventDefault();
          /* Erster Tastendruck: nur die Markierung zeigen (auf dem ersten
             Namen bzw. mit "rechts"/"runter" gleich auf dem naechsten). */
          var bErst = !UI.bullTastatur;
          UI.bullTastatur = true;
          var bAlt = bErst ? 0 : Math.min(UI.bullWahl || 0, bMax);
          if (bErst && (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft')) { UI.bullWahl = 0; render(); return; }
          var bNeu = bAlt;
          if (ev.key === 'Tab') bNeu = (bAlt + 1) % (bMax + 1);
          else if (ev.key === 'ArrowLeft') bNeu = bAlt < bN ? Math.max(0, bAlt - 1) : bAlt;
          else if (ev.key === 'ArrowRight') bNeu = bAlt < bN ? Math.min(bN - 1, bAlt + 1) : bAlt;
          else if (ev.key === 'ArrowDown') bNeu = bUnter ? Math.min(bMax, bAlt + 1) : (bAlt < bN ? bMax : bAlt);
          else if (ev.key === 'ArrowUp') bNeu = bUnter ? Math.max(0, bAlt - 1) : (bAlt >= bN ? (UI.bullWahlVor || 0) : bAlt);
          if (bNeu < bN) UI.bullWahlVor = bNeu;
          UI.bullWahl = bNeu;
          render();
          return;
        }
        if (ev.key === 'Enter' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#screen-bulloff button'))) {
          ev.preventDefault();
          /* Dieses Enter ist verbraucht: sonst kaeme es gleich danach im
             frisch geoeffneten Spielfeld an und buchte dort fuer den
             Bull-Sieger eine 0 - dann waere sofort der andere dran. */
          ev.stopImmediatePropagation();
          /* Ohne sichtbare Markierung waehlt Enter niemanden blind aus -
             es zeigt erst, wer markiert ist. */
          if (!UI.bullTastatur) { UI.bullTastatur = true; UI.bullWahl = 0; render(); return; }
          if ((UI.bullWahl || 0) >= bN && bZurueck) { handleAction('to-tournament', bZurueck); return; }
          var bZiel = bKnoepfe[Math.min(UI.bullWahl || 0, bN - 1)];
          if (bZiel) handleAction('pick-starter', bZiel);
          return;
        }
      }
    }
    /* In allen anderen Dialogen: Pfeile (und der Ziffernblock) wandern von
       Knopf zu Knopf - auch zu "Abbrechen" -, Enter drueckt den markierten.
       Dialoge mit eigener Pfeil-Wahl und Felder/Listen bleiben aussen vor. */
    if (UI.overlay && !PFEIL_DIALOGE[UI.overlay.type] && UI.overlay.type !== 'checkout-darts' &&
        (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' || (ev.key === 'Tab' && !ev.isTrusted)) &&
        !(ev.target && ev.target.closest && ev.target.closest('input, select, textarea'))) {
      var oKnoepfe = Array.prototype.filter.call(
        document.querySelectorAll('#overlay-card button:not([disabled]), #overlay-card [role="button"]'),
        function (b) { return b.offsetParent !== null; });
      if (oKnoepfe.length) {
        ev.preventDefault();
        var oJetzt = oKnoepfe.indexOf(document.activeElement);
        var oVor = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'Tab';
        var oNeu = oJetzt < 0 ? (oVor ? 0 : oKnoepfe.length - 1)
          : (oJetzt + (oVor ? 1 : -1) + oKnoepfe.length) % oKnoepfe.length;
        oKnoepfe[oNeu].focus();
        return;
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
    /* Auswertung nach dem Spiel: Enter nimmt die Hauptaktion (Weiter bzw.
       Speichern), Esc den Weg zurueck - am Board ohne Maus. */
    if (S.screen === 'summary' && !UI.overlay && (ev.key === 'Enter' || ev.key === 'Escape') &&
        !(ev.target && ev.target.closest && ev.target.closest('button, a, input, select, [role="button"]'))) {
      var saKnoepfe = document.querySelectorAll('#summary-actions [data-action]');
      var saZiel = null;
      if (ev.key === 'Escape') saZiel = document.querySelector('#summary-actions [data-action="summary-back"]');
      if (!saZiel) saZiel = document.querySelector('#summary-actions .btn.primary[data-action]') || saKnoepfe[0];
      if (saZiel) { ev.preventDefault(); handleAction(saZiel.getAttribute('data-action'), saZiel); return; }
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
    var zTotal = tasteZiffer(ev);
    if (istRestTaste(ev)) { restBuchen(); ev.preventDefault(); return; }
    if (istUeberworfenTaste(ev)) { ueberworfenBuchen(); ev.preventDefault(); return; }
    if (zTotal !== null) { pressKey(zTotal); ev.preventDefault(); }
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
    var zTurnier = tasteZiffer(ev);
    if (istRestTaste(ev)) { restBuchen(); ev.preventDefault(); return; }
    if (istUeberworfenTaste(ev)) { ueberworfenBuchen(); ev.preventDefault(); return; }
    if (zTurnier !== null) {
      if (UI.input.length < 3) {
        UI.input = UI.input === '0' ? zTurnier : UI.input + zTurnier;
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
  /* "*" am Ziffernblock: Team-Zwischenstand gross ein- und wieder ausblenden. */
  document.addEventListener('keydown', function (ev) {
    if (!(ev.key === '*' || ev.code === 'NumpadMultiply')) return;
    if (!S.tour || !S.tour.liga || (S.screen !== 'game' && S.screen !== 'tournament')) return;
    var at = document.activeElement;
    if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return;
    if (UI.overlay && UI.overlay.type === 'team-stand') { UI.overlay = null; render(); }
    else if (!UI.overlay) { UI.overlay = { type: 'team-stand' }; render(); }
    else return;
    ev.preventDefault();
  });

  document.addEventListener('keydown', function (ev) {
    /* "+" am Ziffernblock zeigt die Liste aller Wuerfe, solange er
       gedrueckt bleibt (wie Shift) - Loslassen fuehrt zurueck. */
    if ((ev.key === '+' || ev.code === 'NumpadAdd') && S.screen === 'game' && UI.turnier && !UI.overlay) {
      ev.preventDefault();
      $('screen-game').classList.add('verlauf');
      return;
    }
    if (ev.key !== 'Shift' || S.screen !== 'game' || !UI.turnier) return;
    $('screen-game').classList.add('verlauf');
  });
  document.addEventListener('keyup', function (ev) {
    if (ev.key !== 'Shift' && ev.key !== '+' && ev.code !== 'NumpadAdd') return;
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
    /* Ziffer im Leg-Ende-Dialog: weiter zum naechsten Leg, und die Ziffer
       beginnt dort gleich die Aufnahme (Turnier-Modus). Nach Spielende wird
       eine Ziffer nur geschluckt - nie zu einer Ruecknahme. */
    var zDialog = tasteZiffer(ev);
    if (zDialog !== null && !(ev.target && ev.target.closest && ev.target.closest('input, select, textarea'))) {
      /* Nach Leg- und Spielende wird eine Ziffer nur geschluckt (8/2/4/6
         kommen im Leg-Ende-Dialog schon als Pfeile an) - nie zu einer
         Ruecknahme oder einem stillen Weiter. */
      if (ov.type === 'leg-done' || ov.type === 'match-done' || ov.type === 'game-done') { ev.preventDefault(); return; }
    }
    if (ov.type === 'checkout-darts') {
      var zCo = tasteZiffer(ev);
      if (zCo !== null) {
        /* Jede Ziffer wird geschluckt – auch eine falsche. Sonst landet sie
           im weiterhin fokussierten Eingabefeld und klebt vor der nächsten
           Aufnahme (aus einer getippten 5 würde still eine 95). */
        ev.preventDefault();
        var anz = parseInt(zCo, 10);
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
      var teOffene = naechsteEinzel();
      /* Waehlbar: die Partien und dahinter "Zurueck ins Menue". */
      var teMax = teOffene.length ? teOffene.length : 0;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (ov.phase === 'stat') { ov.phase = 'weiter'; ov.wahl = 0; render(); }
        else if (teOffene.length) {
          var teWahl = Math.min(ov.wahl || 0, teMax);
          if (teWahl === teOffene.length) { handleAction('to-tournament', ev.target); return; }
          UI.overlay = null;
          openMatch(teOffene[teWahl].id);
        } else {
          handleAction('ov-next-match', ev.target);
        }
      } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'Tab') && ov.phase === 'weiter') {
        ov.wahl = ev.key === 'Tab'
          ? ((ov.wahl || 0) + 1) % (teMax + 1)
          : Math.min((ov.wahl || 0) + 1, teMax);
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
      var ldN = legDoneUebersicht() ? 3 : 2;
      var ldW = Math.min(ov.wahl || 0, ldN - 1);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' ||
          ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Tab') {
        ov.wahl = ev.key === 'Tab' ? (ldW + 1) % ldN
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? Math.min(ldN - 1, ldW + 1) : Math.max(0, ldW - 1);
        render(); ev.preventDefault();
      } else if (ev.key === 'Enter' && !imDialog) {
        ev.preventDefault();
        if (ldW === 1) { undo(); }
        else if (ldW === 2) { handleAction('to-tournament', ev.target); }
        else { UI.overlay = null; render(); }
      } else if (ev.key === 'Backspace' && !imDialog) {
        undo(); ev.preventDefault();
      }
    }
  });

  /* ================= Start ================= */
  S = load() || newState();
  renderLadeHinweis();
  spielUhrStellen();          // Altbestand ohne Startzeit: ab jetzt zaehlen
  altesSpielBeenden();
  einmaligeBerichtKorrekturen();

  /*
   * Die Zurueck-Taste (Android, Browser) verliess frueher die ganze App.
   * Jetzt steht immer ein Eintrag im Verlauf bereit: Zurueck schliesst
   * zuerst einen Dialog, fuehrt dann aus Unterseiten zurueck und bleibt im
   * laufenden Spiel stehen. Erst im Setup ohne Dialog geht es hinaus.
   */
  function zurueckFalle() {
    try { history.pushState({ dart: 1 }, ''); } catch (e) { /* egal */ }
  }
  window.addEventListener('popstate', function () {
    if (UI.overlay && !STICKY_OVERLAYS[UI.overlay.type] && !VOLLBILD_DIALOGE[UI.overlay.type]) {
      UI.overlay = null; UI.input = ''; render(); zurueckFalle(); return;
    }
    if (UI.overlay) { zurueckFalle(); return; }
    if (S.screen === 'summary') {
      var sb = document.querySelector('#summary-actions [data-action="summary-back"]');
      if (sb) handleAction('summary-back', sb);
      zurueckFalle(); return;
    }
    if (S.screen === 'profile') { S.screen = 'players'; save(); render(); zurueckFalle(); return; }
    /* Im Spiel verlaesst ein versehentliches Zurueck nichts. */
    if (S.screen === 'game' || S.screen === 'bulloff' || S.screen === 'cricket' ||
        S.screen === 'rtw' || S.screen === 'finisher') { zurueckFalle(); return; }
    if (S.screen !== 'setup') { S.screen = 'setup'; save(); render(); zurueckFalle(); return; }
    /* Setup ohne Dialog: das naechste Zurueck darf die App verlassen. */
  });
  try {
    if (!history.state || !history.state.dart) zurueckFalle();
  } catch (e) { /* egal */ }
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
  uiWiederherstellen();
  if (S.screen === 'bulloff' && !currentMatch() && !S.game) S.screen = 'tournament';
  if (!S.matches.length && S.screen === 'tournament') S.screen = 'setup';
  if (S.screen === 'profile' && !UI.profile) S.screen = 'players';
  if (S.screen === 'summary' && !UI.summary) S.screen = S.matches.length ? 'tournament' : 'setup';
  /* Selbstheilung: steht im gespeicherten Stand ein Bildschirm, den es
     nicht (mehr) gibt, bliebe die Seite komplett schwarz - dann lieber
     zurueck auf einen Bildschirm, der sicher existiert. */
  if (SCREENS.indexOf(S.screen) < 0) {
    S.screen = S.game && !S.game.done ? spielScreen(S.game.kind) : 'setup';
    if (SCREENS.indexOf(S.screen) < 0) S.screen = 'setup';
  }
  render();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline-Cache optional */ });
    /* Eine neue App-Version ist da (sw.js meldet das nur bei einem echten
       Update): nicht still wechseln, sondern Bescheid sagen - mitten im
       Spiel entscheidet man selbst, wann neu geladen wird. */
    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.typ !== 'sw-neue-version' || $('neue-version')) return;
      var bar = document.createElement('div');
      bar.id = 'neue-version';
      bar.className = 'save-warning';
      bar.setAttribute('role', 'status');
      bar.appendChild(document.createTextNode('✨ Neue Version der App ist da. '));
      var knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'btn small';
      knopf.textContent = 'Neu laden';
      knopf.addEventListener('click', function () { save(); location.reload(); });
      bar.appendChild(knopf);
      document.body.insertBefore(bar, document.body.firstChild);
    });
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
      berichtPdf: berichtPdf,
      einzelVerloren: einzelVerloren,
      planNachreichen: planNachreichen,
      berichtNeu: function () { berichtStand = null; },   // nur fuer Tests
      uebernehmeTurnier: uebernehmeTurnier,
      turnierListeAktualisieren: beitretbareHolen,
      turnierBeitreten: turnierBeitreten,
      liveStand: liveStand,
      liveGeschrieben: liveGeschrieben,
      liveUebernehmen: liveUebernehmen,
      liveGetrennt: liveGetrennt,
      liveBeitreten: liveBeitreten,
      liveBeitretbare: function () { return liveBeitretbare; },
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
      satzStand: satzStand,
      chartSeries: chartSeries,
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
