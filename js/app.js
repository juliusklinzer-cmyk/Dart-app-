/*
 * Dart-Turnier – Jeder gegen jeden, 501 Double Out.
 * Kein Framework, kein Build: State im Speicher, Persistenz via localStorage.
 *
 * Datenmodell (v3, siehe STAND_VERSION und die Migrationskette in ladeStand):
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
  var QUICK_SCORES = [26, 41, 45, 60, 81, 85];

  /* ================= Liga =================
   * Spielplan, Ergebnisse der Ligaleitung und Teams stehen in
   * js/liga-daten.js - die oeffentliche Webseite nutzt dieselben Daten. */
  var LIGA = window.LIGA_DATEN.liga;
  var LIGA_SPIELTAGE = window.LIGA_DATEN.spieltage;

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
  /* Die Grenzen der Scheibe: 170 ist das hoechste Finish mit drei Darts
     (T20 T20 Bull) und damit der Beginn des Finish-Bereichs, 180 die
     hoechste Aufnahme. Die Konstanten stehen dort, wo die Zahl genau das
     bedeutet - nicht bei Winkeln oder Anzeigetexten. */
  var MAX_CHECKOUT = 170;
  var MAX_VISIT = 180;
  /* Die Aufnahme, die den Loewen ruft (1860: SECHZIG!). */
  var FEIER_60 = 60;
  /* Was der Spielberichtsbogen als Highlight abfragt: Finishes ab 100,
     gewonnene 501er-Legs bis 21 Darts (und jeder 180er). */
  var HIGHFINISH_AB = 100;
  var SHORTLEG_BIS = 21;
  /* Version des gespeicherten Stands. Bei jeder Schema-Aenderung hochzaehlen
     und eine Stufe in `migrationen` ergaenzen - nur so greift der Schutz
     "Stand einer neueren Version nicht anfassen" (ladeStand) wirklich. */
  var STAND_VERSION = 3;

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
  /* Session (allein): der Dialog nach dem Leg schliesst sich nach sechs
     Sekunden von selbst - das naechste Leg laeuft laengst, niemand muss
     klicken (Julius: kein "Nochmal?"-Zwang). */
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
  var UI = { input: '', darts: [], mult: 1, modeOverride: null, turnier: false, kamera: false, menu: false, overlay: null, error: '', board: 'won', boardMode: '501', profile: null, summary: null, ligaTab: 'plan', bericht: null };

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
      v: STAND_VERSION,
      screen: 'setup',
      settings: { start: 501, bestOf: 1, dartModeFrom: MAX_CHECKOUT, cricketScoring: 1, finisherTo: 5, rtwBoost: 1, hunterVariante: 0, hunterHandicap: {}, hunterLeben: 1, turnierModus: 0, quickModus: 0, quickSaetze: 1, quickLegs: 1, ton: 1, feiern: 1, tastatur: 0, dartModeMerk: MAX_CHECKOUT },
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
    if (S.game && (S.game.kind === 'quick' || S.game.kind === 'kaiwen')) return 'g:' + S.game.id;
    return S.current ? 'm:' + S.current : null;
  }
  function uiMerken() {
    var ov = UI.overlay && (UI.overlay.type === 'checkout-darts' || UI.overlay.type === 'checkout-doppel' || UI.overlay.type === 'leg-done') ? UI.overlay : null;
    /* `fremd`: die Darts stammen vom Mitspieler (Online-Spiel). Ohne das
       Merkmal waere die Sperre gegen das Loeschen fremder Darts nach einem
       Neuladen weg (fremdeDartsSperre). */
    S.ui = (UI.darts.length || ov) && uiKennung()
      ? { k: uiKennung(), darts: UI.darts.map(function (d) { return { m: d.m, n: d.n, v: d.v }; }), overlay: ov,
          fremd: !!(UI.dartsFremd && UI.darts.length), fremdZeit: UI.dartsFremd ? (UI.dartsFremdZeit || null) : null }
      : null;
  }
  /* Eine Nachmeldung, die nach einem spontanen Wechsel noch offen war,
     als die Seite neu geladen wurde: wieder aufmachen (ohne Unterschrift),
     solange der Spieler auf dem Bogen steht und noch nicht nachgemeldet ist. */
  function nachmeldungWiederherstellen() {
    var no = S.nmOffen;
    if (!no) return;
    var lg = S.tour && S.tour.liga;
    var daTeam = lg && ((lg.heimSpieler || []).indexOf(no.id) >= 0 || (lg.gastSpieler || []).indexOf(no.id) >= 0);
    var schon = lg && (lg.nachmeldungen || []).some(function (n) { return n.id === no.id; });
    if (!lg || !daTeam || schon) { delete S.nmOffen; return; }
    if (UI.overlay) return;
    UI.overlay = { type: 'nachmeldung', draft: { team: no.team, teamFest: true, id: no.id, neuAngelegt: !!no.neuAngelegt,
      wechsel: no.wechsel || null, nach: no.nach || '', vor: no.vor || '', u18: 'nein', g: null }, striche: [] };
  }
  function uiWiederherstellen() {
    var u = S.ui;
    S.ui = null;
    if (!u || u.k !== uiKennung()) return;
    if (S.screen === 'kaiwen') {
      if (u.overlay && u.overlay.type === 'checkout-darts' && u.overlay.kw) UI.overlay = u.overlay;
      return;
    }
    if (S.screen !== 'game') return;
    var m = currentMatch();
    if (!m || m.done) return;
    if (Array.isArray(u.darts) && u.darts.length < 3) {
      UI.darts = u.darts;
      if (u.fremd && UI.darts.length) { UI.dartsFremd = true; UI.dartsFremdZeit = u.fremdZeit || Date.now(); }
    }
    if (u.overlay && (u.overlay.type === 'checkout-darts' || u.overlay.type === 'checkout-doppel') && !UI.darts.length) UI.overlay = u.overlay;
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
      // stillschweigend Daten zu verlieren wäre das Schlimmste. Bei vollem
      // Speicher wird erst Platz geschaffen (speicherEntlasten) - nur wenn
      // auch das nicht reicht, bleibt die Warnung stehen.
      if (speicherEntlasten(e)) { if (saveBroken) saveBroken = false; renderSaveWarning(); }
      else if (!saveBroken) { saveBroken = true; renderSaveWarning(); }
    }
    liveAnstossen();
  }

  /*
   * Speicher voll (QuotaExceeded). Statt aufzugeben in zwei Stufen Platz
   * schaffen und sofort wieder speichern:
   *  1. Den aeltesten Archiv-Eintraegen die Einzeldart-Details (v.k) nehmen.
   *     Die braucht nur die Doppelquote; Average, 180er, Finishes und Legs
   *     bleiben vollstaendig. Spiele, die der Server schon hat, zuerst (dort
   *     liegen die Details weiter) - falls die Online-Schicht das verraet.
   *  2. Das Archiv von hinten kuerzen, bis es passt (nie unter 20 Spiele).
   * `speicherEntlastet` verhindert, dass ein Fehlschlag mitten in der
   * Entlastung noch einmal hier landet - kein Karussell.
   */
  var speicherEntlastet = false;
  var speicherHinweis = '';   // was die Entlastung getan hat (Warn-Balken)
  var MIN_HISTORY_NOTFALL = 20;
  function speicherVoll(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
  }
  function speicherEntlasten(e) {
    if (!speicherVoll(e) || speicherEntlastet || !S || !Array.isArray(S.history) || !S.history.length) return false;
    speicherEntlastet = true;
    var passt = function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); return true; }
      catch (e2) { if (speicherVoll(e2)) return false; throw e2; }
    };
    var gesichert = function (h) {
      return !!(window.DartSync && typeof window.DartSync.hochgeladen === 'function' && window.DartSync.hochgeladen(h.id));
    };
    var detailsWeg = function (h) {
      var n = 0;
      (h.matches || []).forEach(function (m) {
        (m.legs || []).forEach(function (l) {
          (l.visits || []).forEach(function (v) { if (v && v.k) { delete v.k; n++; } });
        });
      });
      return n;
    };
    try {
      /* Stufe 1: aelteste zuerst (das Archiv ist juengste-zuerst sortiert),
         darunter die gesicherten vor den nur lokalen. */
      var reihe = S.history.slice().reverse();
      reihe.sort(function (a, b) { return (gesichert(b) ? 1 : 0) - (gesichert(a) ? 1 : 0); });
      var entfernt = 0, i = 0;
      while (i < reihe.length) {
        /* In Vierteln, nicht je Spiel: jeder Versuch serialisiert den ganzen Stand. */
        var bis = Math.min(reihe.length, i + Math.max(1, Math.ceil(reihe.length / 4)));
        for (; i < bis; i++) entfernt += detailsWeg(reihe[i]);
        if (entfernt && passt()) {
          speicherHinweis = 'Speicher voll – aus ' + plural(i, 'altem Spiel', 'alten Spielen') + ' wurden die Einzeldart-Details entfernt (Average, 180er und Finishes bleiben). Bitte Spiele im Konto sichern.';
          speicherEntlastet = false;
          return true;
        }
      }
      /* Stufe 2: das Archiv kuerzen - in derselben Reihenfolge wie oben
         (aelteste zuerst, gesicherte vor nur lokalen), damit ein Spiel, das
         noch in der Upload-Schlange wartet, als letztes dran ist. Klappt
         auch das nicht, kommt alles zurueck: nichts wird still verloren. */
      var kopie = S.history.slice();
      var vorher = S.history.length;
      var weg = {};
      var r = 0;
      while (S.history.length > MIN_HISTORY_NOTFALL && r < reihe.length) {
        var schritt = Math.max(1, Math.ceil(S.history.length / 10));
        for (var k = 0; k < schritt && r < reihe.length && S.history.length - k > MIN_HISTORY_NOTFALL; r++) {
          if (!weg[reihe[r].id]) { weg[reihe[r].id] = true; k++; }
        }
        S.history = kopie.filter(function (h) { return !weg[h.id]; });
        if (passt()) {
          speicherHinweis = 'Speicher voll – die ' + plural(vorher - S.history.length, 'aelteste Spiel wurde', 'aeltesten Spiele wurden') + ' aus dem Archiv entfernt. Bitte Spiele im Konto sichern.';
          speicherEntlastet = false;
          return true;
        }
      }
      S.history = kopie;
      speicherEntlastet = false;
      return false;
    } catch (e3) {
      speicherEntlastet = false;
      return false;
    }
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
        if (window.DartSync && window.DartSync.live && liveNutzer()) liveEnde(S.game, true);
        else S.offeneEnden.push({ typ: 'live', sid: S.game.online.sid });
      }
      if (S.game.done) {
        /* Entschieden, nur nie gespeichert: das Ergebnis ist echt und kommt
           ins Archiv. */
        archiveGame(S.game);
        weg.push(art + ' (entschieden) wurde gespeichert');
      } else if (entschiedeneLegs(S.game)) {
        /* Angefangen, aber mit fertigen Legs: die gehen wie beim Abbruch
           von Hand ("Gespielte Legs behalten") ohne Sieger in die
           Statistik - Average, 180er und Finishes sind echt geworfen. */
        var fertigeLegs = entschiedeneLegs(S.game);
        archiveGame(S.game, true);
        weg.push(art + ' (angefangen): ' + (fertigeLegs === 1 ? 'das fertige Leg wurde' : 'die ' + fertigeLegs + ' fertigen Legs wurden') + ' gespeichert, das offene verworfen');
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
    if (S.screen !== 'stats' && S.screen !== 'players' && S.screen !== 'profile' && S.screen !== 'liga') S.screen = 'setup';
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

  var saveWarnungText = null;   // der Standardtext aus dem HTML, einmal gemerkt
  function renderSaveWarning() {
    var bar = $('save-warning');
    if (!bar) return;
    if (saveWarnungText === null) saveWarnungText = bar.textContent;
    /* Hat die Entlastung gegriffen, steht ihr Weg im Balken - sonst die
       allgemeine Warnung. Der Hinweis bleibt bis zum naechsten Laden. */
    bar.textContent = saveBroken ? saveWarnungText : speicherHinweis ? '⚠️ ' + speicherHinweis : saveWarnungText;
    bar.classList.toggle('hidden', !saveBroken && !speicherHinweis);
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

  /*
   * Migrationskette: migrationen[n] hebt einen Stand von Version n auf n+1.
   * ladeStand wendet alle Stufen bis STAND_VERSION der Reihe nach an.
   *   1 -> 2: aus den Turnier-Spielern werden dauerhafte Profile (migrate1to2).
   *   2 -> 3: alles, was seit v2 dazukam (Einstellungen fuer Cricket, RTW,
   *           Hunter, Schnelles Spiel, Ton, Tastatur, Liga-Felder) steht
   *           seit Jahren nur als Default beim Laden - jetzt wird es fest in
   *           den Stand geschrieben. Inhaltlich aendert sich nichts, aber
   *           die Versionsnummer stimmt wieder, und ein Zurueckrollen auf
   *           eine aeltere App trifft auf den Schutz in ladeStand.
   */
  var migrationen = {};
  migrationen[1] = migrate1to2;
  migrationen[2] = function (s) { standErgaenzen(s); return s; };

  function ladeStand(raw) {
    try {
      var s = JSON.parse(raw);
      if (!s) return null;
      if (typeof s.v === 'number' && s.v > STAND_VERSION) { ladeProblem = 'neuer'; return null; }
      if (typeof s.v !== 'number' || s.v < 1) return null;
      for (var stufe = s.v; stufe < STAND_VERSION; stufe++) {
        if (typeof migrationen[stufe] !== 'function') return null;
        s = migrationen[stufe](s) || s;
        s.v = stufe + 1;
      }
      if (s.v !== STAND_VERSION || !Array.isArray(s.profiles)) return null;
      /* Auch ein Stand der aktuellen Version wird ergaenzt: ein Feld, das
         bei einer kaputten Speicherung fehlt, ist kein Grund, Profile und
         Archiv zu verwerfen. */
      standErgaenzen(s);
      return s;
    } catch (e) { return null; }
  }

  /* Fehlende Felder nachruesten - die Defaults, die ein Stand der aktuellen
     Version haben muss. Wirft, wenn der Stand grundlegend kaputt ist
     (ladeStand faengt das und sichert den Rohtext). */
  function standErgaenzen(s) {
      if (!Array.isArray(s.history)) s.history = [];
      if (!Array.isArray(s.lineup)) s.lineup = [];
      if (!s.mode) s.mode = '501';
      if (!s.settings || typeof s.settings !== 'object') s.settings = newState().settings;
      if (START_SCORES.indexOf(s.settings.start) < 0) s.settings.start = 501;
      if (s.game === undefined) s.game = null;
      /* Ein Finisher-Spiel ohne Runden kann es nicht geben – ein solcher
         Stand käme aus einer kaputten Speicherung und würde beim Zeichnen
         auffliegen. Lieber verwerfen als abstürzen. */
      if (s.game && s.game.kind === 'finisher' && !Array.isArray(s.game.rounds)) s.game = null;
      if (s.game && s.game.kind === 'kaiwen' && !(Array.isArray(s.game.versuche) && s.game.versuche.length)) s.game = null;
      /* Ein Spiel ohne Spielerliste kann es ebenso wenig geben: jeder
         Spielbildschirm liest sie als Erstes. Ohne Spiel gehoert der
         Bildschirm zurueck ins Setup. (Bis v3 fing das nur der Zufall ab:
         solche Staende kamen ueber den .kaputt-Pfad als frischer Stand.) */
      if (s.game && !Array.isArray(s.game.players) && !Array.isArray(s.game.p)) s.game = null;
      if (!s.game && (SPIEL_SCREENS[s.screen] || s.screen === 'bulloff') && !(Array.isArray(s.matches) && s.matches.length)) s.screen = 'setup';
      if (s.settings.cricketScoring === undefined) s.settings.cricketScoring = 1;
      /* Vor der Wahl gab es nur Boost -- wer von damals kommt, behaelt das. */
      if (s.settings.rtwBoost === undefined) s.settings.rtwBoost = 1;
      if (s.settings.hunterVariante === undefined) s.settings.hunterVariante = 0;
      if (s.settings.hunterLeben === undefined) s.settings.hunterLeben = 1;
      if (!s.settings.hunterHandicap || typeof s.settings.hunterHandicap !== 'object') s.settings.hunterHandicap = {};
      if (FIN_TARGETS.indexOf(s.settings.finisherTo) < 0) s.settings.finisherTo = 5;
      if (s.settings.online === undefined) s.settings.online = 0;
      if (s.settings.ton !== 0) s.settings.ton = 1;
      if (s.settings.feiern !== 0) s.settings.feiern = 1;
      /* Spieldauer des Schnellen Spiels (Saetze/Legs) kam spaeter dazu --
         Altbestand spielt weiter ein Leg. */
      if (s.settings.quickModus !== 1) s.settings.quickModus = 0;
      if (!(s.settings.quickSaetze >= 1)) s.settings.quickSaetze = 1;
      /* Eingabe-Wahl im Setup: Tastatur (Fernsteuerung ab Start) kam mit
         dem neuen Startbild; der Merkwert haelt die Einzel-Dart-Grenze fest,
         solange "Standard" (immer die Aufnahme als Zahl) gewaehlt ist. */
      if (s.settings.tastatur !== 1) s.settings.tastatur = 0;
      if (!(s.settings.dartModeMerk > 0)) s.settings.dartModeMerk = s.settings.dartModeFrom > 0 ? s.settings.dartModeFrom : MAX_CHECKOUT;
      if (!(s.settings.quickLegs >= 1)) s.settings.quickLegs = 1;
      s.profiles.forEach(function (p, i) { if (typeof p.hue !== 'number') p.hue = HUES[i % HUES.length]; });
      /* Lieblingsdoppel -> Lieblingsgruppe (Checkout-Engine, Phase 2). */
      s.profiles.forEach(finishNachruesten);
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
      /* Ein Spieler, der in den Einzeln auf unserer Seite steht, aber in der
         Aufstellung fehlt (nachgetragener Wechsel), kommt dauerhaft hinein -
         siehe ligaUnser(). */
      (s.history || []).forEach(function (h) { if (h && h.liga && Array.isArray(h.matches)) ligaUnsereIds(h); });
      return s;
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
    if (kind === 'quick') return 'Schnelles X01';
    if (kind === 'kaiwen') return 'Kaiwen';
    if (kind === 'hunter') return 'Hunter';
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
  /* SWO-Status eines Spielers im Ligaspiel (Julius, 11.11.): '' = gemeldet,
     'gast' = nicht gemeldeter Gastspieler (hoechstens einer je Team und
     Spiel, hoechstens zwei Einsaetze je Saison), 'neu' = Nachmeldung mit
     Unterschrift auf Seite 2. Steht je Spieler in liga.typen, fuer beide
     Teams - gesetzt beim Start, beim Wechsel und bei der Nachmeldung. */
  var LIGA_TYPEN = ['', 'gast', 'neu'];
  var LIGA_TYP_TEXT = { '': 'gemeldet', gast: 'Gastspieler', neu: 'neu melden' };
  var LIGA_GAST_FEHLER = 'Höchstens ein nicht gemeldeter Gastspieler je Mannschaft und Ligaspiel (SWO) – der zweite muss nachgemeldet werden.';
  function ligaTyp(lg, id) { return (lg && lg.typen && lg.typen[id]) || ''; }
  function ligaTypSetzen(lg, id, typ) {
    if (!lg || !id) return;
    if (!lg.typen) lg.typen = {};
    if (typ) lg.typen[id] = typ; else delete lg.typen[id];
  }
  /* Wie viele nicht gemeldete Gastspieler eine Seite schon hat (ohne `ausser`). */
  function ligaGaeste(lg, seite, ausser) {
    var liste = (seite === 'H' ? lg.heimSpieler : lg.gastSpieler) || [];
    return liste.filter(function (id) { return id !== ausser && ligaTyp(lg, id) === 'gast'; }).length;
  }
  /* Beim Start als "neu melden" eingetragen, aber noch ohne Unterschrift
     auf Seite 2 - die holt die App spaetestens vor den TC-Unterschriften. */
  function ligaNachmeldungenOffen(lg) {
    if (!lg || !lg.typen) return [];
    var da = (lg.nachmeldungen || []).map(function (n) { return n.id; });
    return Object.keys(lg.typen).filter(function (id) { return lg.typen[id] === 'neu' && da.indexOf(id) < 0; });
  }
  function ligaTypKnopfHtml(seite, i, typ) {
    typ = typ || '';
    return '<button type="button" class="ls-typ' + (typ ? ' ' + typ : '') + '" data-action="liga-typ" data-seite="' + seite + '" data-i="' + i + '" ' +
      'aria-label="Status: ' + LIGA_TYP_TEXT[typ] + ', antippen zum Wechseln">' + LIGA_TYP_TEXT[typ] + '</button>';
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
  /* Waehlbare Lieblingsdoppel: die geraden von D20 bis D4 - fuer jedes gibt
     es eine Finish-Tabelle (docs/finishwege/). Ungerade Doppel und Bull sind
     keine Favoriten: ein Single dort laesst immer eine ungerade Zahl. Ein
     altes Profil mit so einem Wert rechnet wie "egal". */
  /* Lieblingsgruppen (Checkout-Engine, Phase 2): der Spieler waehlt keine
     einzelne Doppelzahl mehr, sondern eine Halbierungskette. Die Gruppen
     stehen in p.finish.gruppen (bis zwei, die erste ist die Hauptgruppe);
     p.dbl traegt weiter das Doppel der Hauptgruppe, damit Server und
     aeltere Geraete dieselbe Zahl sehen. Wer "Meine besten Finishes
     ermitteln" durchlaeuft, bekommt in p.finish.tabelle (und
     tabelleCheckout) eine eigene Tabelle im Format von js/checkout.js;
     alle anderen spielen mit der festen Tabelle ihrer Hauptgruppe. */
  var FINISH_GRUPPEN = ['D20', 'D16', 'D18', 'D12', 'D14', 'Bull'];
  var FINISH_KETTE = { D20: [20, 10, 5], D16: [16, 8, 4, 2, 1], D18: [18, 9], D12: [12, 6, 3], D14: [14, 7], Bull: [25] };
  var DOPPEL_WAHL = [20, 16, 18, 12, 14, 25];
  var SPIELWEISEN = { aufnahmen: 'Aufnahmen', checkout: 'Checkout', auto: 'Automatisch' };
  function gruppeAusDoppel(n) {
    n = Number(n);
    for (var i = 0; i < FINISH_GRUPPEN.length; i++) {
      if (FINISH_KETTE[FINISH_GRUPPEN[i]].indexOf(n) >= 0) return FINISH_GRUPPEN[i];
    }
    return null;
  }
  function doppelAusGruppe(g) { return FINISH_KETTE[g] ? FINISH_KETTE[g][0] : null; }
  function finishGruppen(p) {
    var g = p && p.finish && Array.isArray(p.finish.gruppen) ? p.finish.gruppen : [];
    var out = [];
    g.forEach(function (x) { if (FINISH_KETTE[x] && out.indexOf(x) < 0 && out.length < 2) out.push(x); });
    return out;
  }
  /* Favoriten fuer die Engine: alle Doppel beider Ketten, Hauptgruppe zuerst. */
  function finishFavoriten(gruppen) {
    var out = [];
    gruppen.forEach(function (g) { (FINISH_KETTE[g] || []).forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); }); });
    return out;
  }
  /* Gruppen am Spieler setzen. Aendert sich die Wahl, passt eine vorher
     gerechnete Tabelle nicht mehr (sie wurde fuer andere Favoriten
     geloest) und wird verworfen; Average, Tests und Spielweise bleiben,
     damit das Neu-Ermitteln nur ein Knopfdruck ist. Gibt zurueck, ob eine
     Tabelle verworfen wurde. */
  function finishGruppenSetzen(p, gruppen) {
    var neu = [];
    (gruppen || []).forEach(function (g) { if (FINISH_KETTE[g] && neu.indexOf(g) < 0 && neu.length < 2) neu.push(g); });
    var alt = finishGruppen(p);
    if (!p.finish || typeof p.finish !== 'object') p.finish = {};
    p.finish.gruppen = neu;
    p.dbl = neu.length ? doppelAusGruppe(neu[0]) : null;
    var gleich = alt.length === neu.length && alt.every(function (g, i) { return g === neu[i]; });
    if (gleich || !p.finish.tabelle) return false;
    p.finish.tabelle = null;
    p.finish.tabelleCheckout = null;
    p.finish.profil = null;
    p.finish.stand = null;
    return true;
  }
  /* Altbestand: aus dem einzelnen Lieblingsdoppel wird die Gruppe, in deren
     Kette es liegt (8 -> D16, 10 -> D20, 6 -> D12). */
  function finishNachruesten(p) {
    if (!p || typeof p !== 'object') return;
    if (p.finish && typeof p.finish !== 'object') p.finish = null;
    if (!p.finish && p.dbl) {
      var g = gruppeAusDoppel(p.dbl);
      p.finish = { gruppen: g ? [g] : [] };
    }
    if (p.finish) {
      p.finish.gruppen = finishGruppen(p);
      p.dbl = p.finish.gruppen.length ? doppelAusGruppe(p.finish.gruppen[0]) : null;
      if (p.finish.tabelle && typeof p.finish.tabelle !== 'object') p.finish.tabelle = null;
      if (p.finish.tabelleCheckout && typeof p.finish.tabelleCheckout !== 'object') p.finish.tabelleCheckout = null;
      if (p.finish.eigene && typeof p.finish.eigene !== 'object') p.finish.eigene = null;
      if (!SPIELWEISEN[p.finish.spielweise]) p.finish.spielweise = 'aufnahmen';
    } else if (DOPPEL_WAHL.indexOf(p.dbl) < 0) p.dbl = null;
  }
  /* Auswahl im Spieler-Dialog: eine Gruppe (die Hauptgruppe); eine zweite
     gibt es nur im Profil. Der Wert ist das Doppel der Gruppe. */
  function doppelOptionen(gewaehlt) {
    if (DOPPEL_WAHL.indexOf(gewaehlt) < 0) gewaehlt = 0;
    var html = '<option value="0"' + (gewaehlt ? '' : ' selected') + '>egal</option>';
    FINISH_GRUPPEN.forEach(function (g) {
      var n = doppelAusGruppe(g);
      html += '<option value="' + n + '"' + (gewaehlt === n ? ' selected' : '') + '>' + g +
        (FINISH_KETTE[g].length > 1 ? ' (' + FINISH_KETTE[g].join(' · ') + ')' : '') + '</option>';
    });
    return html;
  }

  /* Lieblingsgruppe und eigene Tabelle dessen, der gerade wirft - der
     Vorschlag gilt ihm. Ergebnis { dbl, tabelle } fuer js/checkout.js oder
     null (Standardtabelle). lage.checkout: in dieser Aufnahme zaehlt nur das
     Finish (Spielweise "checkout" immer, "auto" wenn die Lage es verlangt) -
     dann die Checkout-Variante der eigenen Tabelle. */
  function lieblingsDoppel(pid, lage) {
    var p = profile(pid);
    if (!p) return null;
    var f = p.finish || {};
    var dbl = DOPPEL_WAHL.indexOf(p.dbl) >= 0 ? p.dbl : null;
    var checkout = !!(f.tabelle && f.tabelleCheckout && (f.spielweise === 'checkout' || (f.spielweise === 'auto' && lage && lage.checkout)));
    var tab = finishTabelleGemischt(p, f, checkout);
    if (!dbl && !tab) return null;
    return { dbl: dbl, tabelle: tab };
  }
  /* Eigene Eintraege (p.finish.eigene, je Rest '3 Darts|2 Darts|1 Dart' mit
     leeren Teilen fuer "wie gerechnet") liegen ueber der gerechneten bzw.
     festen Tabelle. Das Mischen passiert einmal je Stand, nicht je Aufruf. */
  var finishMischCache = {};
  function finishTabelleGemischt(p, f, checkout) {
    var basis = (checkout ? f.tabelleCheckout : f.tabelle) || null;
    if (basis && typeof basis !== 'object') basis = null;
    var eig = f.eigene && typeof f.eigene === 'object' ? f.eigene : null;
    if (!eig || !Object.keys(eig).length) return basis;
    var dbl = DOPPEL_WAHL.indexOf(p.dbl) >= 0 ? p.dbl : null;
    /* Der Schluessel traegt alles, was in die Mischung eingeht: Grundzeilen
       (Doppel der Hauptgruppe, Stand der Rechnung) und die eigenen Eintraege
       selbst (vom Server kann ein anderer Inhalt mit gleicher Nummer kommen). */
    var key = p.id + '|' + (checkout ? 'c' : 'a') + '|' + (f.stand || 0) + '|' + (f.eigeneNr || 0) + '|' + dbl + '|' + JSON.stringify(eig);
    if (finishMischCache[key]) return finishMischCache[key];
    var out = {};
    if (basis) Object.keys(basis).forEach(function (r) { out[r] = basis[r]; });
    Object.keys(eig).forEach(function (r) {
      var teile = String(eig[r] || '').split('|');
      var grund = (basis && basis[r]) || Checkout.zeileText(Number(r), dbl) || '';
      var gt = grund.split('|');
      out[r] = [0, 1, 2].map(function (i) { return teile[i] || gt[i] || ''; }).join('|');
    });
    if (Object.keys(finishMischCache).length > 24) finishMischCache = {};
    finishMischCache[key] = out;
    return out;
  }
  function finishEigeneAnzahl(p) {
    var e = p && p.finish && p.finish.eigene;
    return e && typeof e === 'object' ? Object.keys(e).filter(function (r) { return /[^|]/.test(String(e[r] || '')); }).length : 0;
  }
  /* Spielweise "auto" im X01: die Checkout-Variante, sobald ein Gegner im
     naechsten Besuch finishen kann oder es das entscheidende Leg ist. */
  function x01Lage(m, leg, active) {
    var checkout = false;
    if (!m || !leg) return { checkout: false };
    m.p.forEach(function (id) {
      if (id === active) return;
      var r = remainingIn(leg, id);
      if (r <= MAX_CHECKOUT && Checkout.possible(r, 3)) checkout = true;
    });
    if (!checkout && m.p.length > 1) {
      /* Entscheidend: im letzten moeglichen Satz steht jeder ein Leg vor dem
         Sieg (bei einem einzigen Leg also immer). satzStand zaehlt die Legs
         je Satz, legsWon ueber alle Saetze hinweg. */
      var ss = satzStand(m);
      var letzterSatz = ss.gewinnSaetze <= 1 || m.p.every(function (id) { return ss.saetze[id] >= ss.gewinnSaetze - 1; });
      if (letzterSatz && m.p.every(function (id) { return ss.legs[id] >= ss.gewinnLegs - 1; })) checkout = true;
    }
    return { checkout: checkout };
  }

  /* Das Kuerzel im Avatar: selbst gewaehlt (bis drei Zeichen) oder aus dem Namen. */
  function kuerzelVon(p) {
    var k = p && typeof p.kuerzel === 'string' ? p.kuerzel.trim().slice(0, 3) : '';
    return k || initials(p ? p.name : '');
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
    var h = typeof p.hue === 'number' ? p.hue : hue(p.id);
    return '<span class="' + c + ' init" style="background:hsl(' + h + ',40%,28%)">' + esc(kuerzelVon(p)) + '</span>';
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
     Schnellen Spiel laesst er sich per Knopf dazuschalten. Allein ist er
     der Tastatur-Modus: Eingabefeld und Statistik-Kacheln statt des
     Tastenfelds (Julius, Handy-Block 2). */
  function turnierErlaubt() {
    if (S.game && S.game.kind === 'quick') return true;
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
    if (daten.zuschauer && S.tour.zuschauer !== daten.zuschauer) {
      S.tour.zuschauer = daten.zuschauer; neu = true;
      /* Anpfiff: der Ticker steht - alle, die nicht da sind, bekommen den Link. */
      if (S.tour.liga && !S.tour.liga.uebung) {
        mitteilungEreignis('live', { termin: S.tour.liga.terminId, nr: S.tour.liga.nr, gegner: S.tour.liga.gegner, heim: !!S.tour.liga.heim,
          ort: ligaOrt(S.tour.liga.terminId), link: location.origin + '/live.html#' + daten.zuschauer });
      }
    }
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

  /* Eine Aufnahme mit 0 Punkten steht in den Listen wie ein Bust: rot,
     durchgestrichen, "Bust" (Julius, 10.11.2026: "0 Enter" soll aussehen wie
     die Minus-Taste). Gespeichert bleibt sie eine 0 - fuer Average und
     Darts zaehlt sie wie bisher. */
  function wieBust(v) { return !!(v && (v.b || (!v.c && Number(v.s) === 0))); }

  function liveNutzer() {
    return window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().id : null;
  }

  /* Vorauswahl beim Spielstart (Julius, 10.11.2026): angemeldet ist erst
     einmal nur der eigene Spieler gewählt. Lief an diesem Abend auf dem
     Gerät schon ein Spiel, gilt dessen Aufstellung weiter (beim Ligaspiel
     unsere vier). Läuft gerade ein Spiel oder Turnier, bleibt alles, wie es
     ist; ohne Konto ebenso. Liefert true, wenn sich die Auswahl geändert hat. */
  var ABEND_MS = 8 * 3600e3;
  function lineupVorbelegen() {
    var ich = liveNutzer();
    if (!ich || !profile(ich)) return false;
    if ((S.game && !S.game.done) || S.matches.length) return false;
    var letztes = null;
    S.history.forEach(function (e) {
      /* `von` tragen nur Einträge, die vom Server kamen - die zählen nicht als Spiel dieses Geräts. */
      if (e && !e.von && Number(e.at) && (!letztes || e.at > letztes.at)) letztes = e;
    });
    var neu = null;
    if (letztes && Date.now() - letztes.at < ABEND_MS) {
      var liste = letztes.liga && Array.isArray(letztes.liga.wir) ? letztes.liga.wir : (letztes.lineup || letztes.players || []);
      neu = liste.filter(function (id) { var p = profile(id); return p && !p.hidden; });
    }
    if (!neu || !neu.length) neu = [ich];
    if (neu.length === S.lineup.length && neu.every(function (id, i) { return S.lineup[i] === id; })) return false;
    S.lineup = neu;
    return true;
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
        if (!v || v.b || (v.s !== MAX_VISIT && v.s !== FEIER_60)) return;
        if (!beste || v.s > beste.s) beste = v;
      });
      if (beste && beste.s === MAX_VISIT) feiere180(beste.p);
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
    if (UI.overlay && (UI.overlay.type === 'checkout-darts' || UI.overlay.type === 'checkout-doppel' || UI.overlay.type === 'edit-visit')) UI.overlay = null;
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
      /* Der andere hat das Leg-Ende zurueckgenommen (Undo): der Dialog
         hier gehoert zu einem Leg, das es nicht mehr gibt. */
      if (wonNeu < wonAlt && UI.overlay && UI.overlay.type === 'leg-done') UI.overlay = null;
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

  function liveEnde(g, ohneKonflikt) {
    if (!g || !g.online || !window.DartSync || !window.DartSync.live) return;
    if (g.online.wartet) return;   // nie beim Server angekommen
    var stand = S.game === g ? liveStand() : null;
    /* Auch ohne eigene ungesendete Aenderung reist die bekannte Version mit:
       liveStand() ist dann null (Hash stimmt), aber der andere kann seit dem
       letzten PUT etwas zurueckgenommen haben. Nur mit `seq` kann der Server
       das merken - sonst schliesst er blind mit dem fremden Stand. */
    if (!stand && S.game === g && g.online.seq) stand = { seq: g.online.seq };
    var p = window.DartSync.live.ende(g.online.sid, stand);
    if (!p || typeof p.then !== 'function') return;
    /* 409: der andere hat nach meinem letzten Stand noch etwas geaendert
       (etwa den Checkout zurueckgenommen). Dann nicht blind zumachen -
       der frische Server-Stand wird wie jeder andere uebernommen, und wer
       beenden wollte, prueft und tippt noch einmal. Andere Fehler schluckt
       die Online-Schicht weiterhin selbst. `ohneKonflikt` (12-h-Aufraeumen):
       ein uraltes Spiel wird nicht wiederbelebt, der Server raeumt es selbst. */
    p.then(null, function (e) {
      if (!e || e.status !== 409 || !e.stand || ohneKonflikt) return;
      liveEndeKonflikt(g, e.stand);
    });
  }
  function liveEndeKonflikt(g, spiel) {
    if (S.game && S.game !== g) return;   // laengst ein neues Spiel angefangen: nicht dazwischenfunken
    if (!S.game) {
      /* Schon ins Archiv geschrieben: der Eintrag traegt den alten Stand -
         weg damit, das Spiel laeuft weiter. */
      S.history = S.history.filter(function (h) { return h.id !== g.id; });
      S.game = g;
      S.screen = spielScreen(g.kind);
      /* Der alte Upload darf nicht stehen bleiben: die naechste Fassung
         ersetzt ihn auf dem Server (sync.js schickt `ersetzen`). */
      if (window.DartSync && typeof window.DartSync.spielZurueckziehen === 'function') window.DartSync.spielZurueckziehen(g.id);
    }
    g.online.seq = 0;   // damit der Server-Stand als neuer gilt (liveUebernehmen prueft seq)
    liveUebernehmen(spiel, true);
    /* War der Server-Stand schon "zu" (der andere hat inzwischen beendet),
       hat liveUebernehmen das Spiel archiviert - dann kein "erneut beenden". */
    if (S.game === g) {
      UI.overlay = { type: 'hinweis', titel: 'Noch nicht beendet',
        text: (spiel.geaendertVonName || 'Dein Mitspieler') + ' hat noch etwas geändert – bitte den Stand prüfen und dann erneut beenden.' };
    }
    save(); render();
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
    /* Die halbfertige Aufnahme des Werfers kommt mit - wie in
       liveUebernehmen gehoert sie in UI.darts, nicht in den Stand: bliebe
       `offen` am Objekt, ginge der naechste PUT ohne sie hinaus (liveText
       laesst den Schluessel weg), und der Werfer saehe seine Darts
       verschwinden. Der Hash ist ueber den Text MIT `offen` gebildet,
       genau wie der naechste eigene liveText ihn wieder liefert. */
    var offen = Array.isArray(neu.offen) ? neu.offen.map(function (d) { return { m: d.m, n: d.n, v: d.v }; }) : [];
    delete neu.offen;
    S.game = neu;
    S.mode = neu.kind;
    /* Aufstellung und Online-Schalter mitnehmen: "Nochmal spielen" soll
       hier dieselben Leute wieder online zusammenbringen. */
    S.lineup = (neu.players || []).slice();
    S.settings.online = 1;
    UI.overlay = null; UI.darts = offen; UI.input = ''; UI.error = ''; UI.mult = 1; UI.menu = false;
    UI.dartsFremd = offen.length > 0; UI.dartsFremdZeit = Date.now();
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
     naechste. "First to N": wer zuerst N Legs hat, hat den Satz. "Best of N"
     (Julius' Wunsch, 10.10.2026): alle N Legs werden gespielt, der mit den
     meisten hat den Satz - bei Gleichstand (ab drei Spielern moeglich) geht
     es weiter, bis einer vorne liegt. Gespeichert wird bestOf (Legs je Satz)
     und saetzeBestOf (Saetze); spieldauer traegt Zaehlweise und Zahlen, wie
     sie eingestellt wurden. */
  function bestOfAus(modus, n) { return modus === 1 ? n : 2 * n - 1; }
  function matchSaetzeZuGewinnen(match) {
    return match && match.saetzeBestOf ? Math.floor(match.saetzeBestOf / 2) + 1 : 1;
  }
  /* Nur fuer Schnelle Spiele gedacht: die tragen bestOf immer selbst. */
  function mehrereLegs(match) {
    return !!match && ((match.bestOf || 1) > 1 || (match.saetzeBestOf || 1) > 1);
  }
  /* Best of im Schnellen Spiel: feste Zahl, alle werden gespielt. Das
     Merkmal `alle` tragen nur Spiele seit dieser Regel - aeltere Best-of-
     Spiele im Archiv rechnen weiter nach "wer zuerst", wie sie gespielt
     wurden, sonst zeigte ihre Auswertung einen anderen Stand als damals. */
  function festeDauer(match) {
    return !!(match && match.spieldauer && match.spieldauer.modus === 1 && match.spieldauer.alle);
  }
  /* Wer allein vorne liegt - bei Gleichstand niemand. */
  function fuehrender(zaehler, ids) {
    var best = null, doppelt = false;
    ids.forEach(function (id) {
      if (best === null || zaehler[id] > zaehler[best]) { best = id; doppelt = false; }
      else if (zaehler[id] === zaehler[best]) doppelt = true;
    });
    return doppelt ? null : best;
  }
  function satzStand(match) {
    var fest = festeDauer(match);
    var gewinnLegs = matchLegsToWin(match);
    var gewinnSaetze = matchSaetzeZuGewinnen(match);
    /* Session (allein, ohne Leg-Ziel): kein Satz wird je voll, also auch
       kein Sieger - die Legs zaehlen einfach weiter. */
    var legsJeSatz = match.session ? Infinity : (match.bestOf || 1), saetzeGesamt = match.saetzeBestOf || 1;
    var saetze = {}, legs = {};
    match.p.forEach(function (id) { saetze[id] = 0; legs[id] = 0; });
    var satzNr = 1, legNr = 1, satzZu = false, sieger = null;
    match.legs.forEach(function (l) {
      if (!l.winner || sieger) return;
      satzZu = false;
      legs[l.winner]++; legNr++;
      /* First to: wer die Legs hat. Best of: nach der festen Zahl Legs der
         mit den meisten - sonst noch ein Leg. */
      var satzSieger = fest
        ? (legNr - 1 >= legsJeSatz ? fuehrender(legs, match.p) : null)
        : (legs[l.winner] >= gewinnLegs ? l.winner : null);
      if (satzSieger) {
        saetze[satzSieger]++;
        satzZu = true;
        var spielSieger = fest
          ? (satzNr >= saetzeGesamt ? fuehrender(saetze, match.p) : null)
          : (saetze[satzSieger] >= gewinnSaetze ? satzSieger : null);
        if (spielSieger) sieger = spielSieger;
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
    if (match.session) return 'Session';
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
  var FEIER_MS = 2500;
  /* Die Sechzig ist kurz: ein Puls („SECH-ZIG", bum-bum), dann wieder weg –
     sie kommt ja auch deutlich öfter als die 180. Genau so lang wie ihre
     Animation (1,2 s): kuerzer abgeraeumt wirkte der Loewe abgehackt und
     klein (Julius, 10.10.2026). Die Feier liegt ohne Klickfang ueber dem
     Bild, das Tastenfeld bleibt die ganze Zeit bedienbar. */
  var SECHZIG_MS = 1500;   // Schlag 0,25 s + zwei Pulse je 0,5 s + Ausblenden

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
  /* Geht ein Dialog auf (Checkout-Frage, Leg-Ende, Hinweis), ist die Feier
     vorbei: sie laege sonst mit Blur und Konfetti ueber der Frage, die
     gerade beantwortet werden soll. */
  function feierAbbrechen() {
    if (feierTimer) { clearTimeout(feierTimer); feierTimer = null; }
    var box = $('feier');
    if (!box || !box.classList.contains('an')) return;
    box.classList.remove('an', 'sechzig');
    box.innerHTML = '';
  }

  /* Aufnahme abschließen und Leg-/Matchstand fortschreiben.
     k = Einzeldarts (nur im Einzel-Dart-Modus vorhanden, für Doppelquote). */
  function commitVisit(score, darts, isCheckout, isBust, k, dd) {
    var m = currentMatch();
    var leg = activeLeg(m);
    var pid = activePlayer(leg, m);
    var visit = { p: pid, s: isBust ? 0 : score, d: darts, b: !!isBust, c: !!isCheckout, o: isBust ? score : 0 };
    if (k && k.length) visit.k = k.map(function (x) { return { m: x.m, n: x.n }; });
    /* Punkte-Eingabe: das Doppel, das zugemacht hat (1..20, 25 = Bull) -
       erfragt oder aus Rest und Dartzahl eindeutig (checkoutBuchen). */
    if (isCheckout && dd && !visit.k) visit.dd = dd;
    leg.visits.push(visit);
    /* Zeitstempel fuer die Drehrad-Animation der letzten Aufnahme (renderGame). */
    UI.aufnahmeZeit = Date.now();

    /* Im Ligaspiel wird nicht gefeiert - der Schreiber ist Schiedsrichter,
       und ein Vollbild-Loewe mitten im Einzel gegen ein fremdes Team waere
       genau die Zwischenaktion, die die SWO dem Schreiber verbietet. */
    var ligaMatch = m.kind !== 'quick' && S.tour && S.tour.liga && !S.tour.liga.uebung;
    // Höher geht es mit drei Darts nicht.
    if (!isBust && score === MAX_VISIT && !ligaMatch) feiere180(pid);
    // Die 60 gehört dem Löwen – bei jeder geworfenen 60 (siehe feiere60).
    else if (!isBust && score === FEIER_60 && !ligaMatch) feiere60(pid);

    UI.input = ''; UI.darts = []; UI.mult = 1; UI.error = '';
    /* "Punkte" von Hand gilt nur fuer diese Aufnahme, danach entscheidet
       wieder "Einzel-Darts ab Rest". Wer dagegen Einzel-Darts waehlt, will
       Dart fuer Dart mitschreiben - das bleibt bis zum Ende der Partie. */
    if (UI.modeOverride !== 'darts') UI.modeOverride = null;

    if (isCheckout) {
      leg.winner = pid;
      var st = satzStand(m);
      if (st.sieger) {
        /* Best of ab drei Spielern: das Spiel gewinnt, wer nach allen Legs
           vorne liegt - nicht zwingend, wer das letzte Leg ausgemacht hat. */
        pid = st.sieger;
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

    if (v > MAX_VISIT) { UI.error = 'Maximal ' + MAX_VISIT; UI.input = ''; render(); return; }
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

  /* ---- Welches Doppel hat zugemacht? (Punkte-Eingabe, Julius 12.11.2026) ----
     Aus Rest vor der Aufnahme und Dartzahl folgt, welche Doppel ueberhaupt
     moeglich waren (Ausschlussverfahren). "Logisch" sind die, die beim
     Wurf auf das Doppel des Rests naheliegen: das Doppel selbst (erster
     Dart vorbei), das halbe nach einem Treffer ins einfache Feld, die nach
     einem Treffer ins Nachbarfeld - sonst das Doppel aus der Finish-Tabelle
     und die Lieblingsdoppel. Alle anderen moeglichen Doppel kommen als
     kleinere Knoepfe darunter. 32 mit 1 Dart fragt nicht: das war D16. */
  var DOPPEL_VORZUG = [16, 20, 8, 10, 12, 18, 4, 6, 14, 2, 25, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  var EIN_DART = (function () {
    var s = { 0: 1, 25: 1, 50: 1 };
    for (var n = 1; n <= 20; n++) { s[n] = 1; s[2 * n] = 1; s[3 * n] = 1; }
    return s;
  })();
  function stellwurfMoeglich(punkte, darts) {
    if (darts <= 0) return punkte === 0;
    if (darts === 1) return !!EIN_DART[punkte];
    for (var a in EIN_DART) if (EIN_DART[punkte - Number(a)]) return true;
    return false;
  }
  function doppelKandidaten(rest, n, favs) {
    var alle = DOPPEL_VORZUG.filter(function (d) { return stellwurfMoeglich(rest - (d === 25 ? 50 : 2 * d), n - 1); });
    var logisch = [];
    var nimm = function (d) { if (alle.indexOf(d) >= 0 && logisch.indexOf(d) < 0) logisch.push(d); };
    if (oneDartFinish(rest)) {
      var ziel = rest === 50 ? 25 : rest / 2;
      nimm(ziel);
      if (n > 1 && ziel <= 20) {
        if (ziel % 2 === 0) nimm(ziel / 2);
        nachbarFelder(ziel).forEach(function (nb) { var d = (rest - nb) / 2; if (d === Math.floor(d) && d >= 1 && d <= 20) nimm(d); });
      }
    } else {
      var weg = window.Checkout ? Checkout.suggest(rest, n, favs && favs.length ? Number(favs[0]) : null) : null;
      var letzt = weg ? weg[weg.length - 1] : '';
      if (letzt === 'BULL') nimm(25);
      else if (letzt.charAt(0) === 'D') nimm(Number(letzt.slice(1)));
      (favs || []).forEach(function (f) { nimm(Number(f)); });
    }
    return { alle: alle, logisch: logisch, andere: alle.filter(function (d) { return logisch.indexOf(d) < 0; }) };
  }
  /* Ohne Einzel-Darts im Ligaspiel wird nicht gefragt (der Schreiber ist
     Schiedsrichter) - sonst ueberall: Turnier, Schnelles X01, Solo. */
  function doppelFrageNoetig(m) {
    if (!m) return false;
    if (m.kind !== 'quick' && S.tour && S.tour.liga) return false;
    return true;
  }
  /* Nach "Mit wie vielen Darts?": das Doppel steht fest, wird erfragt oder
     bleibt offen (Liga). */
  function checkoutBuchen(score, n) {
    var m = currentMatch();
    if (!m || m.done) return;
    var leg = activeLeg(m), pid = activePlayer(leg, m);
    var rest = remainingIn(leg, pid);
    var k = doppelKandidaten(rest, n, finishFavoriten(finishGruppen(profile(pid))));
    if (k.alle.length === 1) { commitVisit(score, n, true, false, null, k.alle[0]); return; }
    if (!k.alle.length || !doppelFrageNoetig(m)) { commitVisit(score, n, true, false); return; }
    UI.overlay = { type: 'checkout-doppel', score: score, n: n, rest: rest, logisch: k.logisch, andere: k.andere };
    save(); render();
  }
  function doppelName(d) { return d === 25 ? 'Bull' : 'D' + d; }

  function pressKey(k) {
    UI.error = '';
    /* Zurueck nimmt erst Ziffern, dann - bei leerem Feld - die letzte
       Aufnahme zurueck: so kommt man mit derselben Taste zum Wurf davor
       und zum vorigen Spieler. */
    if (k === 'del') {
      if (UI.input === '') {
        /* Die zurueckgenommene Aufnahme steht wieder im Feld (Julius):
           weiteres Zurueck loescht sie Ziffer fuer Ziffer, und erst bei
           leerem Feld geht es die naechste Aufnahme zurueck. Nur fuer
           Aufnahmen, die als Punkte getippt wurden - nicht im Board-Modus. */
        var weg = undo();
        if (weg && !weg.k && !UI.turnier && !UI.darts.length) {
          UI.input = String(weg.b ? weg.o : weg.s);
          render();
        }
        return;
      }
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
    if (val > MAX_VISIT) { UI.error = 'Maximal ' + MAX_VISIT; render(); return; }
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
    if (value > MAX_VISIT) return 'Maximal ' + MAX_VISIT + '.';
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
    UI.error = '';   // ein alter Hinweis (z. B. zum Moduswechsel) ist mit der Ruecknahme erledigt
    if (UI.overlay && (UI.overlay.type === 'checkout-darts' || UI.overlay.type === 'checkout-doppel')) { UI.overlay = null; UI.input = ''; render(); return; }
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
    /* Ein nur als Ergebnis eingetragenes Einzel hat keine Aufnahme, die
       sich zuruecknehmen liesse - es wird ueber "aendern" korrigiert. */
    if (m.ergebnis || m.kampflos) { UI.overlay = null; render(); return; }
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
    var weg = leg.visits.pop();
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
    return weg;
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
      bestLeg: null, tournaments: 0, tourWins: 0, ligaTage: 0,
      cricketGames: 0, cricketWins: 0, cricketMarks: 0, cricketDarts: 0,
      rtwGames: 0, rtwWins: 0, rtwBest: null,
      finGames: 0, finWins: 0, finRounds: 0, finDarts: 0, finBest: null, finHigh: 0,
      kwGames: 0, kwVersuche: 0, kwChecks: 0, kwBestSolo: null, kwBestTeam: null,
      huGames: 0, huWins: 0, huFaenge: 0, huDarts: 0, huTreffer: 0, huBest: { normal: null, boost: null, h1: null, h2: null, h3: null },
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
    st.kwQuote = st.kwVersuche ? (st.kwChecks / st.kwVersuche) * 100 : 0;
    st.huQuote = st.huDarts ? (st.huTreffer / st.huDarts) * 100 : 0;
    st.huMpr = st.huDarts ? (st.huTreffer / st.huDarts) * 3 : 0;
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

            /* Doppelquote: im Einzel-Dart-Modus ist jeder Dart bekannt, der
               auf einem Doppel lag. In der Punkte-Eingabe kennt die App seit
               DRT-035 das Finish-Doppel (v.dd): war der Rest vor der Aufnahme
               schon mit einem Dart zu machen, lagen alle Darts der Aufnahme
               auf einem Doppel (der erste auf dem des Rests, die weiteren auf
               dem Finish-Doppel); sonst zaehlt nur der Finish-Dart. Fehlwuerfe
               aufs Doppel in Aufnahmen ohne Finish bleiben dort unbekannt. */
            if (v.k && v.k.length) {
              var r = before;
              for (var i = 0; i < v.k.length; i++) {
                var d = v.k[i];
                if (oneDartFinish(r)) st.doubleAttempts++;
                r -= d.m * d.n;
              }
              if (v.c) st.doubleHits++;
            } else if (v.c && v.dd) {
              st.doubleAttempts += oneDartFinish(before) ? (v.d || 1) : 1;
              st.doubleHits++;
            }

            if (!v.b) {
              st.points += v.s;
              rest[v.p] = before - v.s;
              if (v.s > st.highScore) st.highScore = v.s;
              if (v.s === MAX_VISIT) st.s180++;
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
            /* Ein Leg, das nur als Ergebnis eingetragen wurde (der Gegner hat
               mit seinem System gezaehlt), hat keine Wuerfe: es zaehlt in der
               Leg-Bilanz, aber nicht als Bestes Leg oder Darts je Leg. */
            var mitWuerfen = used > 0;
            /* Das beste Leg ist eine persoenliche Bestmarke und zaehlt auch
               allein - die Leg-Bilanz braucht einen Gegner. */
            if (ist501 && mitWuerfen && (w.bestLeg === null || used < w.bestLeg)) w.bestLeg = used;
            if (!solo) {
              w.legsWon++;
              m.p.forEach(function (pid) { if (pid !== leg.winner) stat(pid).legsLost++; });
              if (ist501 && mitWuerfen) { w.dartsInWonLegs += used; w.legsWon501++; }
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
        /* Ein Ligaspieltag (auch ein Nachtrag) ist kein Turnier: er zaehlt
           als Ligaspieltag, nicht unter "Turniere gespielt". Einen
           Turniersieg gibt es dort ohnehin nicht (archiveTournament). */
        var zaehler = h.liga ? 'ligaTage' : 'tournaments';
        Object.keys(played).forEach(function (id) { if (map[id]) map[id][zaehler]++; });
        if (!h.liga && h.winner && map[h.winner] && played[h.winner]) map[h.winner].tourWins++;
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
      } else if (kind === 'hunter') {
        var huSt = hunterState({ players: h.players, throws: h.throws || [], variante: h.variante, handicap: h.handicap, startPos: h.startPos, leben: h.leben });
        var huKey = hunterSchluessel({ players: h.players, variante: h.variante, handicap: h.handicap });
        h.players.forEach(function (id) {
          var s = map[id];
          if (!s) return;
          s.huGames++;
          s.huFaenge += huSt.faenge[id] || 0;
          s.huDarts += huSt.darts[id] || 0;
          s.huTreffer += huSt.treffer[id] || 0;
          if (h.players.length === 1 && huSt.fertig && (s.huBest[huKey] === null || huSt.fertig.darts < s.huBest[huKey])) s.huBest[huKey] = huSt.fertig.darts;
        });
        if (h.winner && map[h.winner] && h.players.length > 1) map[h.winner].huWins++;
      } else if (kind === 'kaiwen') {
        var kwSt = kaiwenState({ players: h.players, versuche: h.versuche || [] });
        var kwHoch = kaiwenHoechste(h);
        h.players.forEach(function (id) {
          var s = map[id];
          if (!s) return;
          s.kwGames++;
          s.kwVersuche += kwSt.versuche;
          s.kwChecks += kwSt.checksJe[id] || 0;
          if (h.players.length === 1) { if (s.kwBestSolo === null || kwHoch > s.kwBestSolo) s.kwBestSolo = kwHoch; }
          else if (s.kwBestTeam === null || kwHoch > s.kwBestTeam) s.kwBestTeam = kwHoch;
        });
      }
    });
    Object.keys(map).forEach(function (k) {
      map[k].name = pname(k);
      finalize(map[k]);
      map[k].lastResults.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
    return map;
  }

  /* Highlights der Ligaleitung (180er, Shortlegs, Highfinishes aus dem
     Spielbericht auf steeldart-muenchen.de) fuer ein Ligaspiel, dessen Einzel
     die App nur als Ergebnis kennt - der Nachtrag vom Bogen hat keine
     Wuerfe, also auch keinen Average, kein 180, kein bestes Leg. Was die
     Ligaleitung gemeldet hat, kommt so trotzdem in Rangliste und Highlights
     der Saison (Julius, 10.11.: "da kommen nicht alle Spieler vor"). Nur
     fuer Spiele ohne einen einzigen Wurf, sonst zaehlten 180er doppelt.
     Zugeordnet wird ueber die Reihenfolge: Zeile i des Bogens = Einzel i
     des Eintrags; Gegner bekommen keine Kennung, nur Name und Team.
     Liefert [{ id, name, team, s180, shortleg: [], highfinish: [] }]. */
  function ligaBogenHighlights(h) {
    var lg = h && h.liga;
    if (!lg || lg.uebung || !Array.isArray(h.matches) || !h.matches.length) return [];
    var mitWuerfen = h.matches.some(function (m) { return (m.legs || []).some(function (l) { return l.visits && l.visits.length; }); });
    if (mitWuerfen) return [];
    var t = LIGA.termine.filter(function (x) { return x.id === lg.terminId; })[0];
    var sp = t ? ligaBogenEintrag(t) : null;
    if (!sp || !Array.isArray(sp.partien) || !Array.isArray(sp.highlights) || sp.partien.length !== h.matches.length) return [];
    var ohneStern = function (n) { return String(n || '').replace(/^\*/, '').trim(); };
    var idVon = {};
    sp.partien.forEach(function (p, i) {
      var m = h.matches[i];
      if (!m || !m.p) return;
      idVon[ohneStern(p[0])] = m.p[0];
      idVon[ohneStern(p[1])] = m.p[1];
    });
    return sp.highlights.map(function (e) {
      var nm = ohneStern(e.wer);
      return { id: idVon[nm] || null, name: nm, team: e.team || '', s180: Number(e.s180) || 0,
        shortleg: Array.isArray(e.shortleg) ? e.shortleg.slice() : [], highfinish: Array.isArray(e.highfinish) ? e.highfinish.slice() : [] };
    });
  }
  /* Ein gemeldetes Highlight in einen Statistik-Satz rechnen. */
  function statHighlightsDazu(st, e) {
    if (e.s180) { st.s180 += e.s180; if (st.highScore < MAX_VISIT) st.highScore = MAX_VISIT; }
    e.highfinish.forEach(function (f) { f = Number(f) || 0; if (f > st.highCO) st.highCO = f; if (f >= 100) st.highFinishes++; });
    e.shortleg.forEach(function (d) { d = Number(d) || 0; if (d > 0 && (st.bestLeg === null || d < st.bestLeg)) st.bestLeg = d; });
  }

  /* Karriere-Statistik nur über Ligaspiele – für den Liga-Reiter der
     Rangliste. Gleiche Rechnung wie career(), andere Auswahl. */
  function careerLiga() {
    /* Uebungsspiele (DiensDarts) zaehlen nicht in die Liga-Rangliste. */
    var lists = wertbareHistorie().filter(function (h) { return h.liga && !h.liga.uebung && h.matches; })
      .map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length && S.tour && S.tour.liga && !S.tour.liga.uebung && !turnierSchonArchiviert()) lists.push({ matches: S.matches, start: tourStart() });
    var map = collectStats(lists, S.profiles.map(function (p) { return p.id; }));
    /* Nachgetragene Spieltage: die Highlights der Ligaleitung fuer unsere Leute. */
    wertbareHistorie().forEach(function (h) {
      ligaBogenHighlights(h).forEach(function (e) { if (e.id && map[e.id]) statHighlightsDazu(map[e.id], e); });
    });
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
    /* MPR zuerst - das ist die Cricket-Kennzahl (Julius, 12.10.). */
    { mode: 'cricket', key: 'mpr', label: 'MPR', get: function (s) { return s.mpr; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.cricketDarts >= 9; }, hint: 'Marks per Round: getroffene Marken je 3 Darts im Cricket.' },
    { mode: 'cricket', key: 'cricketWins', label: 'Siege', get: function (s) { return s.cricketWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.cricketGames > 0; }, hint: 'Gewonnene Cricket-Spiele.' },
    { mode: 'rtw', key: 'rtwWins', label: 'Siege', get: function (s) { return s.rtwWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.rtwGames > 0; }, hint: 'Gewonnene Round-the-World-Trainings.' },
    { mode: 'rtw', key: 'rtwBest', label: 'Bestes Ergebnis', get: function (s) { return s.rtwBest; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.rtwBest !== null; }, asc: true, hint: 'Wenigste Darts für einen kompletten Durchlauf von der 1 bis Bull.' },
    { mode: 'finisher', key: 'finWins', label: 'Siege', get: function (s) { return s.finWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finGames > 0; }, hint: 'Gewonnene Finisher-Spiele.' },
    { mode: 'finisher', key: 'finAvgDarts', label: 'Ø Darts je Finish', get: function (s) { return s.finAvgDarts; }, fmt: function (v) { return v.toFixed(1); }, min: function (s) { return s.finRounds >= 3; }, asc: true, hint: 'Wie viele Darts du im Schnitt für ein gewonnenes Finish brauchst. Zählt ab 3 gewonnenen Runden.' },
    { mode: 'finisher', key: 'finRounds', label: 'Gewonnene Runden', get: function (s) { return s.finRounds; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finGames > 0; }, hint: 'Jede Runde, in der du als Erster ausgecheckt hast.' },
    { mode: 'finisher', key: 'finBest', label: 'Schnellstes Finish', get: function (s) { return s.finBest; }, fmt: function (v) { return plural(v, 'Dart', 'Darts'); }, min: function (s) { return s.finBest !== null; }, asc: true, hint: 'Wenigste Darts für ein gewonnenes Finish.' },
    { mode: 'finisher', key: 'finHigh', label: 'Höchste Zahl', get: function (s) { return s.finHigh; }, fmt: function (v) { return String(v); }, min: function (s) { return s.finHigh > 0; }, hint: 'Die höchste Zahl, die du in einer Runde als Erster weggemacht hast.' },
    { mode: 'kaiwen', key: 'kwBestTeam', label: 'PB Team', get: function (s) { return s.kwBestTeam; }, fmt: function (v) { return String(v); }, min: function (s) { return s.kwBestTeam !== null; }, hint: 'Die höchste Zahl, die du im Team als Startzahl eines Versuchs erreicht hast.' },
    { mode: 'kaiwen', key: 'kwBestSolo', label: 'PB Solo', get: function (s) { return s.kwBestSolo; }, fmt: function (v) { return String(v); }, min: function (s) { return s.kwBestSolo !== null; }, hint: 'Die höchste Zahl, die du allein erreicht hast.' },
    { mode: 'kaiwen', key: 'kwChecks', label: 'Checks', get: function (s) { return s.kwChecks; }, fmt: function (v) { return String(v); }, min: function (s) { return s.kwGames > 0; }, hint: 'Von dir gecheckte Versuche.' },
    { mode: 'kaiwen', key: 'kwQuote', label: 'Check-Quote', get: function (s) { return s.kwQuote; }, fmt: function (v) { return v.toFixed(0) + ' %'; }, min: function (s) { return s.kwVersuche >= 5; }, hint: 'Deine Checks je gespieltem Versuch. Zählt ab 5 Versuchen.' },
    { mode: 'kaiwen', key: 'kwVersuche', label: 'Versuche', get: function (s) { return s.kwVersuche; }, fmt: function (v) { return String(v); }, min: function (s) { return s.kwGames > 0; }, hint: 'Alle Versuche, an denen du beteiligt warst.' },
    { mode: 'hunter', key: 'huWins', label: 'Siege', get: function (s) { return s.huWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.huGames > 0; }, hint: 'Gewonnene Jagden (als Letzter übrig).' },
    { mode: 'hunter', key: 'huFaenge', label: 'Fänge', get: function (s) { return s.huFaenge; }, fmt: function (v) { return String(v); }, min: function (s) { return s.huGames > 0; }, hint: 'Gefangene Gegner über alle Jagden.' },
    { mode: 'hunter', key: 'huMpr', label: 'MPR', get: function (s) { return s.huMpr; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.huDarts >= 30; }, hint: 'Treffer aufs Zielfeld je 3 Darts. Zählt ab 30 Darts.' },
    { mode: 'hunter', key: 'huQuote', label: 'Trefferquote', get: function (s) { return s.huQuote; }, fmt: function (v) { return v.toFixed(0) + ' %'; }, min: function (s) { return s.huDarts >= 30; }, hint: 'Treffer aufs Zielfeld je Dart. Zählt ab 30 Darts.' },
    { mode: 'hunter', key: 'huBestNormal', label: 'Solo Normal', get: function (s) { return s.huBest.normal; }, fmt: function (v) { return plural(v, 'Dart', 'Darts'); }, min: function (s) { return s.huBest.normal !== null; }, asc: true, hint: 'Wenigste Darts für eine Runde um die Scheibe, Variante Normal.' },
    { mode: 'hunter', key: 'huBestBoost', label: 'Solo Boost', get: function (s) { return s.huBest.boost; }, fmt: function (v) { return plural(v, 'Dart', 'Darts'); }, min: function (s) { return s.huBest.boost !== null; }, asc: true, hint: 'Wenigste Darts für eine Runde um die Scheibe mit Boost.' }
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
    if (g && g.kind === 'kaiwen') return undoKaiwen(g);
    // Das Schnelle Spiel benutzt die Aufnahmen-Logik des X01, also auch
    // deren Undo – Dart für Dart und über Aufnahmen hinweg.
    if (g && g.kind === 'quick') return undo();
    klick();
    if (!g || !g.throws.length) return;
    g.throws.pop();
    /* Auch das Stechen zurueck: sonst staende der Sieger noch fest, obwohl
       der Dart, der den Gleichstand ueberhaupt erzeugt hat, weg ist. */
    g.stechenSieger = null;
    g.done = false; g.winner = null; g.at = null;
    if (g.kind === 'hunter') { delete g.bestNeu; UI.huBlitz = null; UI.huFang = null; }
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
      if (t.bust) bust = true;
      else if (nach === 0 && t.m === 2) { st.rest[pid] = 0; fertig = true; }
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
    klick();
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
    /* Kaiwen hat kein Spielende von selbst: ein laufendes Spiel mit
       geworfenen Aufnahmen wird hier abgeschlossen und gesichert statt
       stillschweigend ueberschrieben (so ging am 13.10. ein Spiel verloren). */
    if (S.game && !S.game.done && S.game.kind === 'kaiwen' && Array.isArray(S.game.versuche) &&
        S.game.versuche.some(function (v) { return v.visits && v.visits.length; })) {
      S.game.done = true; S.game.winner = null; S.game.at = Date.now();
    }
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
    if (kind === 'hunter') {
      /* Variante und Handicap-Stufen stehen am Spiel, nicht in den
         Einstellungen: ein Umschalten mitten im Abend darf keinen schon
         geworfenen Dart anders bewerten. */
      S.game.variante = HUNTER_VARIANTEN[S.settings.hunterVariante] || 'normal';
      /* Leben: so oft darf einer gefangen werden; wer noch eins hat, steigt gegenueber wieder ein. */
      S.game.leben = [3, 5].indexOf(Number(S.settings.hunterLeben)) >= 0 ? Number(S.settings.hunterLeben) : 1;
      if (S.game.variante === 'handicap') {
        S.game.handicap = {};
        S.lineup.forEach(function (id) { var st = Number((S.settings.hunterHandicap || {})[id]); S.game.handicap[id] = st === 2 || st === 3 ? st : 1; });
      }
      UI.huFang = null; UI.huBlitz = null;
    }
    UI.cricketSpalten = null;   // die Cricket-Tafel faengt ohne Einschiebe-Animation an
    UI.finRunde = undefined; UI.finSpiel = null;   // der Finisher wuerfelt die erste Zahl nicht vor
    UI.finFern = false;
    if (kind === 'finisher') {
      S.game.ziel = S.settings.finisherTo;
      S.game.rounds = [];
      neueFinisherRunde(S.game);
    }
    /* Kaiwen: Startzahl 120, die Reihenfolge der Auswahl ist die
       Wurfreihenfolge (kein Ausbullen). */
    if (kind === 'kaiwen') {
      S.game.versuche = [];
      neuerKaiwenVersuch(S.game, KAIWEN_START);
      UI.kwFern = S.settings.tastatur === 1;
      UI.kwDelta = null; UI.kwBanner = null; UI.kwBlitz = null;
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
      /* Dieselbe Legs-Wahl wie im Turnier (1 Leg, Best of 3, Best of 5),
         ein Satz; Best of heisst: alle Legs werden gespielt (festeDauer).
         Allein gibt es kein Leg-Ziel, sondern die Session: Leg um Leg
         weiter, bis "Session beenden" im Menue (Julius, Handy-Block 2) -
         satzStand kennt bei session nie einen Sieger. */
      var qd = S.lineup.length === 1
        ? { modus: 1, saetze: 1, legs: 1, alle: true }
        : { modus: 1, saetze: 1, legs: S.settings.bestOf || 1, alle: true };
      if (S.lineup.length === 1) S.game.session = true;
      S.game.spieldauer = qd;
      S.game.bestOf = bestOfAus(qd.modus, qd.legs);
      S.game.saetzeBestOf = bestOfAus(qd.modus, qd.saetze);
      S.game.starter = S.lineup[0];
      S.game.legs = [];
    }
    UI.mult = 1;
    UI.modeOverride = null;   // neue Partie, neue Handwahl
    UI.overlay = null;
    /* "Tastatur" im Setup: Schnelles Spiel und Finisher starten gleich in
       der Fernsteuerung (allein: im Tastatur-Modus mit Statistik). */
    UI.turnier = kind === 'quick' && S.settings.tastatur === 1;
    if (kind === 'finisher') UI.finFern = S.settings.tastatur === 1;
    // Wie im Turnier wird auch hier ausgeworfen, wer anfängt - ausser
    // allein: gegen sich selbst bullt niemand aus. Das Spiel gilt dann
    // sofort als begonnen, sonst raeumte der Zurueck-Knopf es weg und
    // ein Neustart landete auf dem Bull-Off.
    if (S.lineup.length === 1 || kind === 'kaiwen' || kind === 'hunter') {
      S.game.started = true;
      S.screen = spielScreen(kind);
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
    } else if (g.kind === 'kaiwen') {
      /* Die Versuche (je Startzahl und Aufnahmen) - daraus rechnet sich
         alles: Checks, Quote, Rekorde. Offene Darts gehen nicht mit. */
      eintrag.versuche = g.versuche.map(function (v) { return { zahl: v.zahl, visits: v.visits }; });
      if (g.rekordNeu) eintrag.rekordNeu = g.rekordNeu;
      if (g.pbNeu) eintrag.pbNeu = g.pbNeu;
    } else if (g.kind === 'quick') {
      /* Das Schnelle Spiel wird wie eine Turnierpartie abgelegt – eine
         Match-Liste mit genau einem Eintrag. Dadurch rechnet collectStats()
         Average, First 9, Doppelquote und Rekorde daraus ohne jede
         Sonderbehandlung. */
      /* Eine Session (allein, ohne Leg-Ziel) ist nie "entschieden": sie
         wird mit ihren fertigen Legs abgelegt - ohne Sieger, aber auch
         ohne das Abbruch-Zeichen -, ein offenes Leg faellt weg. Gewertet
         wird sie wie jedes Solo-Spiel (Average, Rekorde, keine Siege). */
      var session = !!g.session;
      if (session) { delete eintrag.abgebrochen; eintrag.session = true; eintrag.winner = null; }
      eintrag.lineup = g.p.slice();
      eintrag.settings = { start: g.start, bestOf: g.bestOf || 1 };
      eintrag.matches = [{
        id: g.id, p: g.p.slice(), starter: g.starter,
        legs: abgebrochen || session ? g.legs.filter(function (l) { return l.winner; }) : g.legs,
        done: !abgebrochen || session, winner: eintrag.winner, at: eintrag.at, start: g.start,
        bestOf: g.bestOf || 1, saetzeBestOf: g.saetzeBestOf || 1, spieldauer: g.spieldauer || null
      }];
      if (session) eintrag.matches[0].session = true;
    } else {
      eintrag.scoring = g.scoring;
      eintrag.throws = g.throws;
      /* Ohne die Spielart liesse sich das Spiel spaeter nicht nachrechnen:
         dieselben Wuerfe ergeben in Einfach und Boost verschiedene
         Zahlenfolgen. Altbestand hat sie nicht und war immer Boost. */
      if (g.kind === 'rtw') eintrag.boost = g.boost !== false;
      if (g.kind === 'hunter') {
        eintrag.variante = g.variante || 'normal';
        if (g.handicap) eintrag.handicap = g.handicap;
        if (g.startPos) eintrag.startPos = g.startPos;
        if (g.leben > 1) eintrag.leben = g.leben;
        if (g.bestNeu) eintrag.bestNeu = g.bestNeu;
      }
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

  /* Die Zahlen einer Solo-Session (oder eines Solo-Spiels) ueber alle
     Legs - fuer die Kacheln im Tastatur-Modus und den Dialog nach dem Leg.
     Bestes Leg hier auch fuer 301/701: es ist die Bestmarke dieser Session,
     kein Karriere-Rekord (den zaehlt collectStats nur aus 501ern). */
  function sessionStat(m) {
    var pid = m.p[0];
    var st = collectStats([{ matches: [{ p: m.p, legs: m.legs }], start: matchStart(m) }], m.p)[pid];
    finalize(st);
    var fertig = m.legs.filter(function (l) { return l.winner; });
    var best = null;
    fertig.forEach(function (l) { var d = dartsInLeg(l, pid); if (d > 0 && (best === null || d < best)) best = d; });
    var letztes = m.legs[m.legs.length - 1];
    var laufend = letztes && !letztes.winner ? letztes : null;
    return { legs: fertig.length, avg: st.avg, darts: st.darts, bestLeg: best, s180: st.s180, highCO: st.highCO,
      highScore: st.highScore, first9: st.first9, first9Darts: st.first9Darts,
      doubleAttempts: st.doubleAttempts, doubleQuote: st.doubleQuote, checkouts: st.checkouts,
      dartsImLeg: laufend ? dartsInLeg(laufend, pid) : 0 };
  }
  /* Die Kacheln dazu: 'dialog' = alles ueber die Session (nach dem Leg),
     'kacheln' = die sechs Werte neben dem Eingabefeld im Tastatur-Modus.
     Statt einer Checkout-Quote (die kennt die App nur aus Einzel-Darts)
     steht dort das hoechste Finish (Julius, 09.11.). */
  function sessionKachelnHTML(m, art) {
    var s = sessionStat(m);
    var f1 = function (x, hat) { return hat ? x.toFixed(1) : '–'; };
    var k = art === 'dialog' ? [
      ['Legs', s.legs], ['Ø', f1(s.avg, s.darts)], ['Bestes Leg', s.bestLeg ? s.bestLeg + ' Darts' : '–'], ['180er', s.s180],
      ['Höchstes Finish', s.highCO || '–'], ['Darts', s.darts], ['Höchste Aufnahme', s.highScore || '–'], ['First 9', f1(s.first9, s.first9Darts)]
    ] : [
      ['Average', f1(s.avg, s.darts)], ['First 9', f1(s.first9, s.first9Darts)], ['Darts im Leg', s.dartsImLeg], ['180er', s.s180],
      ['Höchste Aufnahme', s.highScore || '–'], ['Höchstes Finish', s.highCO || '–']
    ];
    return '<div class="ss-kacheln' + (art === 'dialog' ? ' dialog' : '') + '">' + k.map(function (z) {
      return '<div class="ss"><span>' + z[0] + '</span><b>' + z[1] + '</b></div>';
    }).join('') + '</div>';
  }
  /* Allein im Tastatur-Modus quer: unter dem (kleineren) Eingabefeld die
     Zahlen des laufenden Legs, der Session und aller Spiele nebeneinander,
     dazu der Average je Leg als Balken mit Session- und Gesamt-Linie - so
     sieht man, wie man vom eigenen Schnitt abweicht (Julius, 10.11.2026). */
  var gesamtCache = { key: '', st: null };
  function sessionMehrHTML(m) {
    var pid = m.p[0];
    var start = matchStart(m);
    var statFuer = function (legs) {
      return finalize(collectStats([{ matches: [{ p: m.p, legs: legs }], start: start }], m.p)[pid]);
    };
    var fertig = m.legs.filter(function (l) { return l.winner; });
    var letztes = m.legs[m.legs.length - 1];
    var laufend = letztes && !letztes.winner ? letztes : null;
    var sLeg = statFuer(laufend ? [laufend] : []);
    var sSes = statFuer(m.legs);
    /* Die Karriere rechnet ueber das ganze Archiv - einmal je Stand reicht. */
    var gKey = pid + '|' + S.history.length;
    if (gesamtCache.key !== gKey) { var c = career()[pid]; gesamtCache = { key: gKey, st: c ? finalize(c) : null }; }
    var sGes = gesamtCache.st;
    var f1 = function (s, k, hat) { return s && (hat === undefined ? s.darts : hat) ? s[k].toFixed(1) : '–'; };
    var zahl = function (s, k) { return s && s[k] ? s[k] : '–'; };
    var reihen = [
      ['Ø', f1(sLeg, 'avg'), f1(sSes, 'avg'), f1(sGes, 'avg')],
      ['First 9', f1(sLeg, 'first9', sLeg.first9Darts), f1(sSes, 'first9', sSes.first9Darts), sGes ? f1(sGes, 'first9', sGes.first9Darts) : '–'],
      ['Darts', zahl(sLeg, 'darts'), zahl(sSes, 'darts'), zahl(sGes, 'darts')],
      ['180er', sLeg.s180 || 0, sSes.s180 || 0, sGes ? sGes.s180 || 0 : '–'],
      ['Höchste', zahl(sLeg, 'highScore'), zahl(sSes, 'highScore'), zahl(sGes, 'highScore')],
      ['Finish', zahl(sLeg, 'highCO'), zahl(sSes, 'highCO'), zahl(sGes, 'highCO')]
    ];
    var tabelle = '<table class="ss-tabelle"><thead><tr><th></th><th>Leg</th><th>Session</th><th>Gesamt</th></tr></thead><tbody>' +
      reihen.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>'; }).join('') +
      '</tbody></table>';
    /* Balken: Average je Leg (hoechstens die letzten zwoelf), das laufende
       Leg heller; Linien fuer den Session- und den Gesamt-Schnitt. */
    var legsAvg = fertig.map(function (l, i) { return { nr: i + 1, avg: statFuer([l]).avg, offen: false }; });
    if (laufend && sLeg.darts) legsAvg.push({ nr: fertig.length + 1, avg: sLeg.avg, offen: true });
    legsAvg = legsAvg.slice(-12);
    var chart = '';
    if (legsAvg.length) {
      var W = 320, H = 120, ob = 14, un = 16, li = 6, re = 6;
      var werte = legsAvg.map(function (x) { return x.avg; }).concat([sSes.avg || 0, sGes ? sGes.avg : 0]);
      var maxA = Math.max(60, Math.ceil(Math.max.apply(null, werte) / 20) * 20);
      /* Hoechstens 44 Einheiten je Leg, wenige Balken stehen mittig. */
      var bw = Math.min(44, (W - li - re) / legsAvg.length);
      var links = li + ((W - li - re) - bw * legsAvg.length) / 2;
      var y = function (v) { return ob + (H - ob - un) * (1 - Math.min(v, maxA) / maxA); };
      var balken = legsAvg.map(function (x, i) {
        var bx = links + i * bw + bw * 0.15, mitte = bx + bw * 0.35, oben = y(x.avg);
        return '<rect class="bar' + (x.offen ? ' offen' : '') + '" x="' + bx.toFixed(1) + '" y="' + oben.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(0, H - un - oben).toFixed(1) + '" rx="2"></rect>' +
          '<text class="wert" x="' + mitte.toFixed(1) + '" y="' + (oben - 3).toFixed(1) + '" text-anchor="middle">' + Math.round(x.avg) + '</text>' +
          '<text class="nr" x="' + mitte.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + x.nr + '</text>';
      }).join('');
      var linie = function (v, kl) { return v ? '<line class="' + kl + '" x1="' + li + '" x2="' + (W - re) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"></line>' : ''; };
      chart = '<svg class="ss-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average je Leg">' +
        balken + linie(sSes.avg, 'session') + linie(sGes ? sGes.avg : 0, 'gesamt') + '</svg>';
    }
    var diff = sGes && sGes.darts && sSes.darts ? sSes.avg - sGes.avg : null;
    var legende = '<p class="ss-legende"><i class="session"></i>Session' + (sSes.darts ? ' ' + sSes.avg.toFixed(1) : '') +
      '<i class="gesamt"></i>Gesamt' + (sGes && sGes.darts ? ' ' + sGes.avg.toFixed(1) : '') +
      (diff !== null ? '<b class="' + (diff >= 0 ? 'plus' : 'minus') + '">' + (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(1) + '</b>' : '') + '</p>';
    return '<div class="ss-mehr">' + tabelle + chart + legende + '</div>';
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
      // wissen, gegen wen und an welchem Spieltag das war. Dazu die Namen
      // aller Beteiligten, wie sie HEUTE heissen: die Liga-Auswertung
      // erkennt einen Gegner ueber Team und Namen wieder, und ein spaeter
      // umbenanntes Gastprofil darf denselben Gegner nicht in zwei Zeilen
      // spalten (die Liga-Statistik bevorzugt diese Namen).
      if (S.tour && S.tour.liga) {
        S.history[0].liga = S.tour.liga;
        var namen = {};
        tourPlayers().forEach(function (id) { var pr = profile(id); namen[id] = String(pr.voll || pr.name || '').slice(0, 60); });
        S.history[0].namen = namen;
      }
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
    if (kind === 'cricket' || kind === 'rtw' || kind === 'hunter') return spieler && istListe(g.throws);
    if (kind === 'finisher') return spieler && istListe(g.rounds) && g.rounds.every(function (rd) { return !!rd && istListe(rd.throws); });
    if (kind === 'kaiwen') return spieler && istListe(g.versuche) && g.versuche.every(function (v) { return !!v && typeof v.zahl === 'number' && istListe(v.visits); });
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
          ligaUnsereIds(vorhanden[s.id]);
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
      /* Ein Eintrag, der selbst vom Server kam (`von`), ist eine reine Kopie:
         liefert der Server ihn mit neuer Fassung noch einmal (der Eintragende
         hat ihn nach einem Konflikt ersetzt), wird die Kopie ausgetauscht.
         Eigene Eintraege bleiben, wie sie sind. */
      var alt = vorhanden[s.id];
      var ersetzt = !!(alt && alt.von && s.payload);
      if ((alt && !ersetzt) || !s.payload) return;
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
      if (ersetzt) {
        var stelle = S.history.indexOf(alt);
        if (stelle >= 0) S.history[stelle] = eintrag; else S.history.push(eintrag);
      } else {
        S.history.push(eintrag);
      }
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
  var SCREENS = ['setup', 'tournament', 'stats', 'players', 'profile', 'bulloff', 'game', 'cricket', 'rtw', 'finisher', 'kaiwen', 'hunter', 'summary', 'winner', 'liga', 'bericht', 'konto'];
  var NAV_SCREENS = { setup: 'setup', tournament: 'setup', stats: 'stats', players: 'players', profile: 'players', summary: 'setup', liga: 'liga', konto: 'konto', winner: 'setup' };

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
    var navFor = gesperrt() ? null : (screen === 'winner' && S.tour && S.tour.liga ? 'liga'
      : screen === 'profile' && UI.profile && UI.profile === eigeneKontoId() ? 'konto' : NAV_SCREENS[screen]);
    /* In Setup, Turnier, Rangliste und Liga steht die Navigation als
       Text-Reiter in der Kopfzeile neben der Marke, ueberall sonst wie
       gehabt ueber dem Inhalt. */
    var navEl = $('nav');
    var kopf = screen === 'setup' ? $('setup-kopf') : screen === 'tournament' ? $('turnier-kopf')
      : screen === 'liga' ? $('liga-kopf') : screen === 'stats' ? $('stats-kopf') : screen === 'players' ? $('players-kopf')
      : screen === 'winner' ? $('winner-kopf') : screen === 'profile' ? $('profile-kopf')
      : screen === 'summary' ? $('summary-kopf') : screen === 'konto' ? $('konto-kopf') : null;
    if (kopf && navEl.parentElement !== kopf) kopf.appendChild(navEl);
    else if (!kopf && navEl.parentElement !== document.body) document.body.insertBefore(navEl, $('screen-setup'));
    /* Das •••-Menue gibt es nur in den Spielbildern - ueberall sonst wird
       ein haengengebliebenes Menue (Zurueck-Taste aus dem offenen Menue)
       zugeklappt. */
    var mitMenue = screen === 'game' || screen === 'cricket' || screen === 'rtw' || screen === 'finisher' || screen === 'kaiwen' || screen === 'hunter';
    if (!mitMenue) UI.menu = false;
    /* Beim Betreten der Liga zeigt der Spielplan wieder den naechsten Spieltag. */
    if (screen !== 'liga') { UI.ligaWahl = null; UI.ligaZu = false; }
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
    try { renderInnen(); fokusWiederherstellen(); }
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
    document.body.classList.toggle('fix-spiel', S.screen === 'game' || S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher' || S.screen === 'kaiwen' || S.screen === 'hunter');
    /* Cricket nutzt die ganze Breite - kein Seitenrand, keine Maximalbreite. */
    document.body.classList.toggle('rand-aus', S.screen === 'cricket' || S.screen === 'game' || S.screen === 'rtw' || S.screen === 'finisher' || S.screen === 'kaiwen' || S.screen === 'hunter');
    /* Das Startbild steht am Tablet und quergedrehten Handy fest im Rahmen,
       innen scrollen nur Spielerliste und Einstellungen (body.fix-setup). */
    document.body.classList.toggle('fix-setup', S.screen === 'setup' || S.screen === 'tournament' || S.screen === 'bulloff' ||
      S.screen === 'liga' || S.screen === 'players' || S.screen === 'winner' || S.screen === 'profile' || S.screen === 'summary');
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
    if (S.screen === 'liga' && letzterScreen !== 'liga') { ligaZusagenLaden(); kasseLaden(); }
    letzterScreen = S.screen;
    if (S.screen === 'tournament') renderTournament();
    /* Verlaesst man die Liga, bleibt die Liga-Statistik nicht versteckt im
       DOM - und zwar VOR dem Zeichnen der Statistik: beide teilen sich den
       Beobachter (stBeobachter), ein spaeteres Trennen liesse die frischen
       Karten in .st-wart haengen (Pruefer, 12.11.). */
    if (S.screen !== 'liga' && $('liga-statistik') && $('liga-statistik').innerHTML) { $('liga-statistik').innerHTML = ''; if (stBeobachter) { stBeobachter.disconnect(); stBeobachter = null; } }
    if (S.screen === 'stats') renderStats();
    /* Verlaesst man die Statistik, bleibt ihr Inhalt nicht versteckt im DOM
       (Karten-Kennungen wie #st-avg gibt es auch im Profil). */
    else if ($('stats-main') && $('stats-main').innerHTML) { $('stats-main').innerHTML = ''; if (stBeobachter) { stBeobachter.disconnect(); stBeobachter = null; } }
    if (S.screen !== 'profile' && $('profile-detail').querySelector('.st-dash')) $('profile-detail').innerHTML = '';
    if (S.screen === 'players') renderPlayers();
    if (S.screen === 'profile') { renderProfile(); if (UI.profilPanel === 'foto') fotoZiehenEinrichten(); if (UI.profilPanel === 'stats') { var stF = statsFilter(), stW = $('profile-detail').querySelector('.st-dash'); statsNachRender(stW, ['profil', UI.profile, stF.modus, stF.bereich, stW && stW.getAttribute('data-spiele')].join('|')); } }
    if (S.screen === 'bulloff') renderBullOff();
    if (S.screen === 'game') renderGame();
    if (S.screen === 'cricket') renderCricket();
    if (S.screen === 'rtw') renderRtw();
    if (S.screen === 'finisher') renderFinisher();
    if (S.screen === 'hunter') renderHunter();
    if (S.screen === 'kaiwen') renderKaiwen();
    else if ($('kw-team') && $('kw-team').innerHTML) {
      /* Beim Verlassen den Kaiwen-Bildschirm leeren: seine Felder und
         Kacheln sollen nirgends sonst mitgezaehlt werden. */
      ['kw-team', 'kw-ziel', 'kw-verlauf', 'kw-pad-darts'].forEach(function (id) { $(id).innerHTML = ''; });
    }
    if (S.screen === 'summary') renderSummary();
    if (S.screen === 'winner') renderWinner();
    if (S.screen === 'liga') renderLiga();
    if (S.screen === 'bericht') renderBericht();
    if (S.screen === 'konto' && window.DartKonto) window.DartKonto.render();
    if (S.screen === 'konto') renderKontoFehlschlaege();
    renderSyncStatus();
    renderOverlay();
    planeBotZug();
    hashKontoEinloesen();
  }

  /* Spiele, die die Warteschlange endgueltig abgehakt hat (4xx ausser 429,
     etwa "Mitspieler ist kein bekannter Account" oder ein zu grosser
     Eintrag): sie bleiben nur auf diesem Geraet und tauchten bisher nirgends
     auf. Hier im Konto kurz gelistet, mit dem Servertext als Grund. */
  function renderKontoFehlschlaege() {
    var box = $('konto-fehlschlaege');
    if (!box) return;
    var liste = window.DartSync && typeof window.DartSync.fehlgeschlagen === 'function' ? window.DartSync.fehlgeschlagen() : null;
    if (!liste || !liste.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    var zeilen = liste.slice().reverse().map(function (f) {
      var h = S.history.filter(function (x) { return x && x.id === f.id; })[0];
      var wann = fmtDate(Date.parse(f.zeit) || (h && h.at) || 0) || '–';
      var was = h ? kindName(h.kind || '501') + (h.players || h.lineup ? ' · ' + (h.players || h.lineup).map(pname).join(', ') : '') : 'Spiel ' + f.id;
      return '<div class="pline"><span>' + esc(wann) + ' – ' + esc(was) + '</span><b>' + esc(f.grund || '') + '</b></div>';
    });
    box.innerHTML = '<div class="card"><h2>Nicht hochgeladen</h2>' + zeilen.join('') +
      '<p class="hint">Diese Spiele liegen nur auf diesem Gerät; der Server hat sie abgelehnt.</p>' +
      (typeof window.DartSync.fehlgeschlagenLeeren === 'function'
        ? '<button class="btn ghost full" data-action="konto-fehlschlaege-leeren">Liste leeren</button>' : '') + '</div>';
  }

  /* Aus einer Mitteilungs-Mail (List-Unsubscribe): <app>/#konto fuehrt zu
     den Benachrichtigungs-Einstellungen. Der Hash wird beim Start gelesen
     und gleich entfernt (sonst spraenge jedes Neuladen wieder dorthin); ist
     die Anmeldung noch unterwegs, wartet das Einloesen bis zum ersten
     Zeichnen mit bekanntem Konto. Mehr Hash-Routing gibt es nicht. */
  function hashKontoEinloesen() {
    if (!UI.hashKonto) return;
    if (!(window.DartKonto && window.DartKonto.aktion && eigeneKontoId() && profile(eigeneKontoId()))) return;
    UI.hashKonto = false;
    setTimeout(function () {
      eigenesProfilOeffnen();
      window.DartKonto.aktion('konto-mitteilungen', null);
    }, 0);
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
        '<span class="kt">Willkommen am Board</span>' +
        '<ol class="hint">' +
          '<li><b>Spieler</b> antippen – die Beispielnamen änderst du unter „Spieler“.</li>' +
          '<li><b>Spielart</b> wählen.</li>' +
          '<li><b>GAME ON!</b> – alles bleibt auf diesem Gerät, auch ohne Netz.</li>' +
        '</ol>' +
        '<button class="btn ghost full" data-action="willkommen-weg">Verstanden</button>';
      links.insertBefore(karte, links.firstChild);
    }
  }

  /* ---------- Gast-Dialog: Art des Gastes und Einladung ---------- */

  /* Die Wahl im Gast-Dialog: fuer heute, dauerhaft auf diesem Geraet oder
     (nur fuer Mitglieder) einladen. */
  function gastArtHtml(p, kannEinladen) {
    var wahl = p.einladen && kannEinladen ? 2 : p.dauer ? 1 : 0;
    return '<div class="options gast-art' + (kannEinladen ? ' drei' : '') + '">' +
      '<button data-action="gast-art" data-value="0" class="' + (wahl === 0 ? 'active' : '') + '">Temporär<small>nach 12 Std. weg</small></button>' +
      '<button data-action="gast-art" data-value="1" class="' + (wahl === 1 ? 'active' : '') + '">Dauerhaft<small>nur dieses Gerät</small></button>' +
      (kannEinladen ? '<button data-action="gast-art" data-value="2" class="' + (wahl === 2 ? 'active' : '') + '">Einladen<small>eigenes Konto</small></button>' : '') +
      '</div>';
  }

  /* Der Link zu einem Einladungs-Token: dieselbe Seite mit ?einladung=... -
     js/auth.js liest das beim Start und traegt den Code ein. */
  function einladungLink(token) {
    return location.origin + location.pathname + '?einladung=' + encodeURIComponent(token);
  }

  function einladungAktuell(o) {
    var art = o.einladungArt || 'gast';
    return o.einladungen && o.einladungen[art] ? o.einladungen[art] : null;
  }

  /* QR-Code und Link fuer die gewaehlte Art; ohne Token steht dort "hole". */
  function einladungHtml(o) {
    var art = o.einladungArt || 'gast';
    var e = einladungAktuell(o);
    var qr = '';
    if (e && window.qrcode) {
      try {
        var q = window.qrcode(0, 'M');
        q.addData(e.link);
        q.make();
        qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch (err) { qr = ''; }
    }
    return '<div class="options einladung-art">' +
        '<button data-action="einladung-art" data-value="gast" class="' + (art === 'gast' ? 'active' : '') + '">Gast<small>spielt mit, keine Liga</small></button>' +
        '<button data-action="einladung-art" data-value="mitglied" class="' + (art === 'mitglied' ? 'active' : '') + '">Vereinsmitglied<small>voller Zugang</small></button>' +
      '</div>' +
      (o.einladungFehler ? '<p class="hint fehler" role="alert">' + esc(o.einladungFehler) + '</p>' : '') +
      '<div class="einladung-qr" id="einladung-qr">' + (qr || '<span class="muted">' + (o.einladungFehler ? '–' : 'Hole den Link …') + '</span>') + '</div>' +
      (e ? '<div class="ticker-link" id="einladung-link">' + esc(e.link) + '</div>' : '') +
      '<p class="hint">' + (o.einladungMeldung ? esc(o.einladungMeldung) + ' ' : '') +
        'Mit dem Handy scannen oder den Link schicken – der Einladungscode ist dann schon eingetragen. Gilt 7 Tage, für ein Konto.</p>';
  }

  /* Holt das Token fuer die gewaehlte Art vom Server, einmal je Art. */
  function einladungHolen(o) {
    var art = o.einladungArt || 'gast';
    if (!o.einladungen) o.einladungen = {};
    if (o.einladungen[art] || o.einladungLaedt === art) return;
    if (!(window.DartKonto && window.DartKonto.ruf)) return;
    o.einladungLaedt = art;
    o.einladungFehler = '';
    window.DartKonto.ruf('POST', '/api/einladungen', { art: art }).then(function (d) {
      if (UI.overlay !== o) return;
      o.einladungLaedt = null;
      o.einladungen[art] = { token: d.token, link: einladungLink(d.token) };
      render();
    }).catch(function (e) {
      if (UI.overlay !== o) return;
      o.einladungLaedt = null;
      o.einladungFehler = e && e.message ? e.message : 'Keine Verbindung zum Server.';
      render();
    });
  }

  /* Name und ein Satz je Spielart - steht ueber den Einstellungen. */
  var SPIELART_TEXT = {
    quick: ['Schnelles X01', 'Alle gleichzeitig, wer zuerst auscheckt.'],
    '501': ['X01 Turnier', 'Jeder gegen jeden, Double Out.'],
    cricket: ['Cricket', 'Jede Zahl von 20 bis 15 und Bull dreimal treffen.'],
    rtw: ['Round the World', 'Reihum von 1 bis 20, danach Bull.'],
    finisher: ['Finisher', 'Alle auf derselben Zahl zwischen 6 und 120, Double Out.'],
    kaiwen: ['Kaiwen', 'Allein oder zu zweit: die Zahl in 9 Darts finishen. Check: plus 10, daneben: eins runter.'],
    hunter: ['Hunter', 'Mäusejagd auf der Scheibe: wer den Vordermann einholt, fängt ihn. Der Letzte gewinnt.']
  };

  function renderSetup() {
    renderBeitreten();
    renderWillkommen();
    /* Ohne Konto ist jeder neue Spieler ein ganz normales Profil - "Gast"
       gibt es nur angemeldet (dort haben die Kollegen Konten). */
    var npKnopf = document.querySelector('#karte-spieler [data-action="new-profile"]');
    if (npKnopf) npKnopf.textContent = liveNutzer() ? '+ Gastspieler' : '+ Spieler';
    /* Nur Name und Nummer - die Statistik steht in der Rangliste, nicht in
       der Aufstellung (Entwurf: keine Statistikzeilen). */
    $('roster').innerHTML = rosterReihenfolge().map(function (p) {
      var sel = S.lineup.indexOf(p.id) >= 0;
      return '<div class="roster-item ' + (sel ? 'selected' : '') + '" data-action="toggle-lineup" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
        avatarHTML(p, 'md') +
        '<div class="who"><div class="nm">' + esc(p.name) +
        (p.gast || p.gastKonto ? ' <span class="gast-marke">Gast</span>' : p.test ? ' <span class="gast-marke">Test</span>' : '') + '</div></div>' +
        /* Hier wird nur ausgewaehlt. Das eigene Profil pflegt man im Konto,
           und Gaeste bearbeitet man unter Spieler -- ein Stift neben jedem
           Namen laedt sonst dazu ein, mitten in der Aufstellung an fremden
           Daten zu drehen. */

        '<span class="check">' + (sel ? S.lineup.indexOf(p.id) + 1 : '') + '</span>' +
        '</div>';
    }).join('') || '<p class="hint">Noch keine Spieler angelegt.</p>';
    var anzahlEl = $('roster-anzahl');
    if (anzahlEl) anzahlEl.textContent = S.lineup.length + ' gewählt';

    document.querySelectorAll('[data-setting]').forEach(function (seg) {
      var key = seg.getAttribute('data-setting');
      seg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', Number(b.getAttribute('data-value')) === S.settings[key]);
      });
    });

    $('mode-select').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === S.mode);
    });
    /* Ueber den Einstellungen: der Name der Spielart und ein Satz dazu. */
    var art = SPIELART_TEXT[S.mode] || SPIELART_TEXT['501'];
    var einstTitel = $('einst-titel'), einstHint = $('einst-hint');
    if (einstTitel) einstTitel.textContent = art[0];
    if (einstHint) einstHint.textContent = art[1];

    /* Boards: nur angemeldet und nur im Turnier - ohne Konto gibt es
       niemanden, mit dem man teilen könnte, und im Schnellen Spiel keinen
       Spielplan zum Aufteilen. */
    var kannTeilen = !!(window.DartKonto && window.DartKonto.nutzer()) && S.mode === '501';
    $('setting-geteilt').classList.toggle('hidden', !kannTeilen);
    var geteiltNote = $('geteilt-note');
    if (geteiltNote) geteiltNote.textContent = kannTeilen && S.settings.turnierGeteilt === 1 ? 'Zwei Geräte erfassen parallel – jedes Tablet an seinem Board.' : '';

    /* Spielort: nur angemeldet und nur bei freien Spielen -- das Turnier
       hat seinen eigenen, geteilten Weg. Ohne Konto fehlt die Zeile. */
    var onlineKarte = $('settings-online');
    if (onlineKarte) {
      var kannOnline = !!liveNutzer() && !!(window.DartSync && window.DartSync.live) && !!LIVE_KINDS[S.mode];
      onlineKarte.classList.toggle('hidden', !kannOnline);
      var onlineHint = $('online-hint');
      if (onlineHint) {
        var mitKonto = kannOnline ? liveMitspieler(S.lineup) : [];
        onlineHint.textContent = !kannOnline || S.settings.online !== 1 ? ''
          : mitKonto.length
            ? 'Erscheint bei ' + mitKonto.map(pname).join(', ') + ' unter „Mitspielen“.'
            : 'Dafür braucht es einen Mitspieler mit Konto in der Aufstellung.';
      }
    }
    $('settings-cricket').classList.toggle('hidden', S.mode !== 'cricket');
    $('settings-rtw').classList.toggle('hidden', S.mode !== 'rtw');
    $('settings-finisher').classList.toggle('hidden', S.mode !== 'finisher');
    $('settings-kaiwen').classList.toggle('hidden', S.mode !== 'kaiwen');
    var bald = false;
    $('settings-hunter').classList.toggle('hidden', S.mode !== 'hunter');
    if (S.mode === 'hunter') renderHunterEinstellungen();
    /* Eingabe-Wahl: Tastatur (Fernsteuerung ab Start), Standard (immer die
       Aufnahme als Zahl, Grenze 0) oder Gemischt (ab der Grenze Dart fuer
       Dart). Die Grenze selbst erscheint nur bei Gemischt. */
    var eingabe = S.settings.tastatur === 1 ? 2 : S.settings.dartModeFrom > 0 ? 1 : 0;
    document.querySelectorAll('#screen-setup [data-action="eingabe"]').forEach(function (b) {
      /* Der Finisher kennt kein Gemischt - dort heisst alles ohne Tastatur Standard. */
      var ziel = b.closest('#eingabe-wahl-fin, #eingabe-wahl-kw') ? (eingabe === 2 ? 2 : 0) : eingabe;
      b.classList.toggle('active', Number(b.getAttribute('data-value')) === ziel);
    });
    var dartmode = $('setting-dartmode');
    if (dartmode) dartmode.classList.toggle('hidden', eingabe !== 1);
    /* Ton: zwei Schalter. Feiern (180 und SECHZIG!) gibt es nur im X01. */
    document.querySelectorAll('#settings-ton [data-action="schalter"]').forEach(function (b) {
      var an = S.settings[b.getAttribute('data-key')] !== 0;
      b.classList.toggle('active', an);
      b.setAttribute('aria-pressed', an ? 'true' : 'false');
    });
    var feiernEl = $('setting-feiern');
    if (feiernEl) feiernEl.classList.toggle('hidden', S.mode !== '501' && S.mode !== 'quick' && S.mode !== 'kaiwen');
    /* Turnier und Schnelles Spiel teilen sich die Einstellungen – Startpunkte
       und Einzel-Dart-Grenze gelten für beide. Nur die Legs sind Turniersache;
       zwei getrennte Karten wären zwei Bedienelemente für dieselbe Einstellung. */
    $('settings-501').classList.toggle('hidden', S.mode !== '501' && S.mode !== 'quick');
    /* Legs gelten fuer Turnier und Schnelles X01 gleichermassen - ausser
       allein: dort gibt es kein Leg-Ziel, sondern die Session. */
    var soloSession = S.mode === 'quick' && S.lineup.length === 1;
    $('setting-bestof').classList.toggle('hidden', (S.mode !== '501' && S.mode !== 'quick') || soloSession);
    $('setting-session').classList.toggle('hidden', !soloSession);
    /* Round the World mit Boost: ein Satz dazu, was Boost heisst. */
    var rtwNote = $('rtw-note');
    if (rtwNote) rtwNote.textContent = S.mode === 'rtw' && S.settings.rtwBoost === 1 ? 'Boost: ein Double überspringt eine Zahl, ein Triple zwei.' : '';
    var startKnopf = document.querySelector('[data-action="start-game"]');
    startKnopf.textContent = bald ? 'Regeln folgen' : 'GAME ON!';
    startKnopf.disabled = bald;

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

  /* Man of the Day je Team: die meisten gewonnenen Einzel, dann die bessere
     Leg-Differenz, dann der hoehere 3-Dart-Average - der aber nur, wenn
     beide einen haben (ein Nur-Ergebnis-Einzel hat Average 0, und dann
     entschiede der Eingabeweg statt der Leistung). Bleibt es gleich, ist
     der Titel geteilt: das geht per Mitteilung an alle hinaus, da darf
     nicht still der Erste der Aufstellung gewinnen.
     Ergebnis: der Beste mit `geteilt` (die Gleichauf-Liegenden) und `namen`
     (alle Traeger), oder null. */
  function manOfTheDay(ids, stMap) {
    var kandidaten = ids.map(function (id) { return stMap[id]; }).filter(function (st) { return st && st.matches; });
    if (!kandidaten.length) return null;
    var vergleich = function (a, b) {
      if (a.won !== b.won) return b.won - a.won;
      var ad = a.legsWon - a.legsLost, bd = b.legsWon - b.legsLost;
      if (ad !== bd) return bd - ad;
      if (a.darts && b.darts && a.avg !== b.avg) return b.avg - a.avg;
      return 0;
    };
    kandidaten.sort(vergleich);
    var bester = kandidaten[0];
    var geteilt = kandidaten.slice(1).filter(function (st) { return vergleich(bester, st) === 0; });
    return {
      id: bester.id, name: bester.name, won: bester.won, matches: bester.matches, darts: bester.darts, avg: bester.avg,
      geteilt: geteilt, namen: [bester].concat(geteilt).map(function (st) { return st.name; })
    };
  }
  /* Der Man of the Day als Text fuer die Mitteilung. */
  function manOfTheDayText(mod, nameFn) {
    if (!mod) return '';
    var namen = [mod].concat(mod.geteilt).map(function (st) { return nameFn ? nameFn(st.id) : st.name; });
    return (mod.geteilt.length ? 'geteilt: ' + namen.join(' & ') + ' (je ' : namen[0] + ' (') + plural(mod.won, 'Sieg', 'Siege') + ')';
  }

  /*
   * Alle Highlights, die der Spielberichtsbogen abfragt, je Spieler und je
   * Leg: jeder 180er, jedes Finish ab 100 und jedes gewonnene 501er-Leg bis
   * 21 Darts - nicht nur das beste je Spieler. Die Ligaleitung fuehrt sie
   * als Listen (js/liga-daten.js), der Bogen hat je Zeile eine. Finishes
   * absteigend, Shortlegs aufsteigend sortiert.
   */
  function legHighlights(matches, start, ids) {
    var map = {};
    var eintrag = function (id) { if (!map[id]) map[id] = { s180: 0, finishes: [], shortlegs: [] }; return map[id]; };
    (ids || []).forEach(eintrag);
    (matches || []).forEach(function (m) {
      if (!m || m.kampflos || !Array.isArray(m.legs)) return;
      m.legs.forEach(function (leg) {
        var legVon = leg && typeof leg.start === 'number' ? leg.start : (start || 501);
        (leg.visits || []).forEach(function (v) {
          if (!v || v.b) return;
          if (v.s === MAX_VISIT) eintrag(v.p).s180++;
          if (v.c && v.s >= HIGHFINISH_AB) eintrag(v.p).finishes.push(v.s);
        });
        if (leg.winner && legVon === 501) {
          var darts = dartsInLeg(leg, leg.winner);
          if (darts > 0 && darts <= SHORTLEG_BIS) eintrag(leg.winner).shortlegs.push(darts);
        }
      });
    });
    Object.keys(map).forEach(function (id) {
      map[id].finishes.sort(function (a, b) { return b - a; });
      map[id].shortlegs.sort(function (a, b) { return a - b; });
    });
    return map;
  }

  /* Die Highlights eines Teams (180er, High-Finishes ab 100, Shortlegs bis
     21 Darts) als drei Zeilen mit <b>Rubrik:</b> - jedes Finish und jedes
     Shortleg einzeln. nameFn: ligaName (buergerlich) oder pname. */
  function teamHighlights(ids, hlMap, nameFn) {
    var hl180 = [], hlFin = [], hlLeg = [], zeilen = [];
    ids.forEach(function (id) {
      var h = hlMap[id];
      if (!h) return;
      var nm = esc((nameFn || ligaName)(id));
      if (h.s180 > 0) hl180.push(nm + (h.s180 > 1 ? ' ×' + h.s180 : ''));
      h.finishes.forEach(function (f) { hlFin.push(f + ' ' + nm); });
      h.shortlegs.forEach(function (d) { hlLeg.push(d + ' Darts ' + nm); });
    });
    if (hl180.length) zeilen.push('<b>180er:</b> ' + hl180.join(' · '));
    if (hlFin.length) zeilen.push('<b>High-Finishes:</b> ' + hlFin.join(' · '));
    if (hlLeg.length) zeilen.push('<b>Shortlegs:</b> ' + hlLeg.join(' · '));
    return zeilen;
  }

  /*
   * Unsere Seite eines Einzels. Im Bogen steht links immer Heim, rechts
   * Gast (p = [Heim, Gast]) - deshalb entscheidet die Position, wenn die
   * Aufstellung (liga.wir) einen Spieler nicht kennt: ein nachgetragener
   * Wechsel (1. Spieltag: Konradson statt Michi) stand sonst auf der
   * falschen Seite, sein verlorenes Einzel zaehlte als Sieg (8:8 statt 7:9)
   * und er tauchte in der Liga-Auswertung bei den Gegnern auf. Wer so
   * gefunden wird, kommt gleich in die Aufstellung, damit alle anderen
   * Stellen (Bogen, Bericht) ihn ebenfalls kennen.
   */
  function ligaUnser(lg, m) {
    if (!lg || !m || !m.p) return null;
    if (lg.wir && lg.wir.indexOf(m.p[0]) >= 0) return m.p[0];
    if (lg.wir && lg.wir.indexOf(m.p[1]) >= 0) return m.p[1];
    var id = lg.heim === false ? m.p[1] : m.p[0];
    if (id && lg.wir && lg.wir.indexOf(id) < 0) {
      lg.wir.push(id);
      var liste = lg.heim === false ? lg.gastSpieler : lg.heimSpieler;
      if (Array.isArray(liste) && liste.indexOf(id) < 0) liste.push(id);
    }
    return id;
  }
  /* Alle unsere Spieler eines Ligaspiels (Aufstellung plus alles, was in
     den Einzeln auf unserer Seite steht). */
  function ligaUnsereIds(h) {
    var lg = h.liga, map = {};
    if (!lg) return map;
    (lg.wir || []).forEach(function (id) { map[id] = 1; });
    ((lg.heim === false ? lg.gastSpieler : lg.heimSpieler) || []).forEach(function (id) { map[id] = 1; });
    (h.matches || []).forEach(function (m) { var u = ligaUnser(lg, m); if (u) map[u] = 1; });
    return map;
  }

  /* Punkte (1 je gewonnenem Einzel) fuer ein archiviertes Ligaspiel. */
  function ligaErgebnisAus(h) {
    var lg = h.liga, gewinnLegs = Math.floor(((h.settings && h.settings.bestOf) || 3) / 2) + 1;
    var e = { wirP: 0, sieP: 0, wirS: 0, sieS: 0 };
    (h.matches || []).forEach(function (m) {
      if (!m.done) return;
      var unsere = ligaUnser(lg, m);
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
      var unsere = ligaUnser(lg, m);
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
       High-Finishes ab 100 und Shortlegs bis 21 Darts – nur unsere Seite,
       jedes Leg einzeln (legHighlights). */
    d.hl = teamHighlights(lg.wir, legHighlights(S.matches, tourStart(), lg.wir), pname);
    return d;
  }

  function ligaTeamsHtml(d) {
    /* Gross stehen die PUNKTE (1 je gewonnenem Einzel) - das ist die Wertung, die
       in die Ligatabelle geht. Einzel und Legs stehen darunter. */
    return '<div class="lg-teams">' +
      '<div class="lg-team wir"><div class="lg-zahl">' + d.wirP + '</div>' +
        '<div class="lg-name">' + esc(LIGA.team) + '</div></div>' +
      '<div class="lg-doppel">:</div>' +
      '<div class="lg-team sie"><div class="lg-zahl">' + d.sieP + '</div>' +
        '<div class="lg-name">' + esc(S.tour.liga.gegner) + '</div></div>' +
      '</div>';
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
        plural(tourPlayers().length, 'Spieler', 'Spieler') + ' · ' +
        S.matches.filter(function (m) { return m.done || m.void; }).length + ' von ' + S.matches.length + ' gespielt';

    /* Im Ligaspiel zählt der Team-Stand, keine Einzeltabelle – und statt
       Nachzüglern gibt es den Positionswechsel nach SWO. */
    document.querySelector('#screen-tournament .card.no-pad').classList.toggle('hidden', !!liga);
    var rosterBtn = document.querySelector('[data-action="roster-change"]');
    rosterBtn.textContent = liga ? 'Spieler wechseln (gleiche Position)' : 'Spieler nachtragen oder abmelden';
    $('liga-stand').classList.toggle('hidden', !liga);
    $('liga-bericht-karte').classList.toggle('hidden', !liga);
    $('karte-turnier-statistik').classList.toggle('hidden', !!liga);
    $('spielplan-titel').textContent = liga
      ? 'Spielplan · ' + S.matches.filter(function (m) { return m.done || m.void; }).length + ' von ' + S.matches.length + ' gespielt'
      : 'Spielplan';
    if (liga) {
      /* Entwurf "Ligaspiel" (Okt. 2026): rechts gross der Punktestand mit
         dem Live-Ticker, darunter die Highlights fuer den Spielbericht. */
      var lsd = ligaStandDaten();
      $('liga-stand').innerHTML =
        '<div class="karte-kopf lg-kopf"><h2>Stand · Punkte</h2>' +
          '<button class="btn ghost small lg-ticker" data-action="liga-ticker"><span class="lg-live"><i></i>Live</span>Ticker für Zuschauer</button></div>' +
        ligaTeamsHtml(lsd) +
        '<div class="lg-legs">Einzel ' + lsd.wirS + ':' + lsd.sieS + ' · Legs ' + lsd.wirL + ':' + lsd.sieL + '</div>';
      $('liga-bericht-karte').innerHTML =
        '<h2>Für den Spielbericht</h2>' +
        '<div class="lg-hl-liste">' + (lsd.hl.length ? lsd.hl.map(function (z) {
          var m = /^<b>(.*?):<\/b>\s*(.*)$/.exec(z);
          return '<div class="lg-hl-zeile"><span class="lg-hl-k">' + (m ? m[1] : '') + '</span><span class="lg-hl-v">' + (m ? m[2] : z) + '</span></div>';
        }).join('') : '<p class="hint">Noch nichts: 180er, High-Finishes ab 100 und Shortlegs bis 21 Darts landen hier.</p>') + '</div>' +
        (lsd.fertige === S.matches.length && ligaNochOffen()
          ? '<button class="btn primary start full" data-action="to-winner">Ergebnisse &amp; Spielbericht</button>' : '') +
        '<div class="lg-knoepfe">' +
          '<button class="btn ghost" data-action="liga-nachmelden">Spieler nachmelden</button>' +
          '<button class="btn ghost" data-action="liga-bericht-kurz">Spielbericht ansehen</button></div>';
    }

    $('standings-body').innerHTML = table.map(function (st, i) {
      return '<tr class="' + (i === 0 && st.won > 0 ? 'leader' : '') + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="left name"><span class="cell">' + avatarHTML(profile(st.id), 'sm') + esc(st.name) + '</span></td>' +
        '<td class="wins' + (st.won > 0 ? '' : ' null') + '">' + st.won + '</td>' +
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
      var posA = liga && m.posPaar ? '<span class="posmark h">H' + (m.posPaar[0] + 1) + '</span> ' : '';
      var posB = liga && m.posPaar ? '<span class="posmark g">G' + (m.posPaar[1] + 1) + '</span> ' : '';
      var isNext = next && next.id === m.id;
      var score = m.kampflos
        ? (m.winner === m.p[0] ? legsToWin() + ':0' : '0:' + legsToWin()) + ' w.o.'
        : m.legs.length ? legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) : '–:–';
      /* Zaehlt der Gegner mit seinem System (Modus "Nur Ergebnisse"), wird
         je Einzel nur der Leg-Stand eingetragen - der Knopf dafuer steht
         dann vorn, Mitschreiben in der App bleibt daneben moeglich. */
      var nurErg = !!(liga && S.tour.liga.nurErgebnis);
      var nochOhneWurf = !m.legs.some(function (l) { return l.visits.length > 0; });
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
            : liga && m.ergebnis && m.done
            ? '<button class="go wo" data-action="liga-ergebnis" data-id="' + esc(m.id) + '">ändern</button>'
            : m.done && !m.void ? '<span class="fertig">fertig</span>' : '')
          : m.belegtVon && Date.now() - (m.belegtSeit || Date.now()) > ((S.tour && S.tour.claimFrist) || 10 * 60000)
            ? '<span class="belegt">bei ' + esc(m.belegtVon) + ' hängengeblieben?</span>' +
              '<button class="go" data-action="open-match" data-id="' + esc(m.id) + '">Übernehmen</button>'
          : m.belegtVon ? '<span class="belegt">läuft bei ' + esc(m.belegtVon) + '</span>'
          : nurErg && nochOhneWurf
            ? '<button class="go" data-action="liga-ergebnis" data-id="' + esc(m.id) + '">Ergebnis</button>' +
              '<button class="go wo" data-action="open-match" data-id="' + esc(m.id) + '" ' +
                'title="In der App mitschreiben" aria-label="In der App mitschreiben">Start</button>'
          : '<button class="go" data-action="open-match" data-id="' + esc(m.id) + '">' +
            (m.legs.length ? 'Weiter' : 'Start') + '</button>' +
            (liga && nochOhneWurf
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

  /* Wie eine Kennzahl verlaeuft: Summen (Siege, 180er, ...) laufen ueber
     die Spiele auf, Schnitte (Average, MPR, ...) stehen je Spiel - die
     Legende rechnet sie ueber die gezeigten Spiele -, die Siegquote laeuft
     mit, Bestmarken (Hoechstes Finish, Bestes Leg, ...) stehen je Spiel. */
  var VERLAUF_SUMME = { won: 1, s180: 1, tons: 1, legsWon: 1, tourWins: 1, cricketWins: 1, rtwWins: 1, finWins: 1, finRounds: 1 };
  var VERLAUF_SCHNITT = { avg: ['points', 'darts', 3], first9: ['first9Points', 'first9Darts', 3], doubleQuote: ['doubleHits', 'doubleAttempts', 100], mpr: ['cricketMarks', 'cricketDarts', 3], finAvgDarts: ['finDarts', 'finRounds', 1] };
  var VERLAUF_LAUFEND = { winPct: ['won', 'matches', 100] };

  /* Je Spieler die Statistik jedes einzelnen Spiels, aelteste zuerst. */
  function spielStatistiken(mode, key) {
    var per = {};
    function push(id, st) { if (!per[id]) per[id] = []; per[id].push(st); }
    if (mode === '501' || mode === 'liga') {
      if (key === 'tourWins') {
        /* Turniersiege zaehlen je Turnier, nicht je Spiel. */
        wertbareHistorie().filter(function (h) { return (h.kind || '501') === '501' && !(h.liga && h.liga.uebung) && h.matches; })
          .slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); })
          .forEach(function (h) {
            var dabei = {};
            h.matches.forEach(function (m) { if (m.done) { dabei[m.p[0]] = 1; dabei[m.p[1]] = 1; } });
            Object.keys(dabei).forEach(function (id) { push(id, { tourWins: h.winner === id ? 1 : 0 }); });
          });
        return per;
      }
      var quelle = mode === 'liga' ? alleLigaMatches() : allMatches();
      quelle.slice().reverse().forEach(function (e) {
        if (e.m.kampflos) return;
        /* Nur als Ergebnis eingetragen (keine Wuerfe): im Verlauf gibt es
           dafuer Sieg und Legs, aber keinen Average-Punkt bei null. */
        if (e.m.ergebnis && key !== 'won' && key !== 'legsWon' && key !== 'winPct') return;
        /* Allein am Board gibt es weder Sieg noch Leg-Bilanz - das Spiel
           bekommt in diesen Verlaeufen keinen Punkt. */
        if (e.m.p.length < 2 && (key === 'won' || key === 'legsWon' || key === 'winPct')) return;
        var map = collectStats([{ matches: [e.m], start: e.start }], e.m.p);
        e.m.p.forEach(function (id) { push(id, finalize(map[id])); });
      });
      return per;
    }
    var games = wertbareHistorie().filter(function (h) { return h.kind === mode; }).slice().reverse();
    if (S.game && S.game.kind === mode && S.game.done && !testSpiel(S.game)) games.push(S.game);
    games.forEach(function (h) {
      var sieg = function (id) { return h.players.length > 1 && h.winner === id ? 1 : 0; };   // allein gibt es keinen Sieg
      if (mode === 'cricket') {
        var cs = cricketState({ players: h.players, throws: h.throws, scoring: h.scoring });
        h.players.forEach(function (id) { push(id, { cricketMarks: cs.allMarks[id], cricketDarts: cs.darts[id], cricketWins: sieg(id) }); });
      } else if (mode === 'rtw') {
        var rs = rtwState({ players: h.players, throws: h.throws, boost: h.boost !== false });
        h.players.forEach(function (id) { var fin = rs.finished[id]; push(id, { rtwBest: fin ? fin.darts : null, rtwWins: sieg(id) }); });
      } else if (mode === 'finisher') {
        var st = {};
        h.players.forEach(function (id) { st[id] = { finWins: sieg(id), finRounds: 0, finDarts: 0, finBest: null, finHigh: 0 }; });
        (h.rounds || []).forEach(function (rd) {
          var w = rd.sieger && st[rd.sieger];
          if (!w || !rd.darts) return;
          w.finRounds++; w.finDarts += rd.darts;
          if (w.finBest === null || rd.darts < w.finBest) w.finBest = rd.darts;
          if (rd.zahl > w.finHigh) w.finHigh = rd.zahl;
        });
        h.players.forEach(function (id) { push(id, st[id]); });
      }
    });
    return per;
  }

  /* Je Spieler eine Reihe mit einem Wert pro Spiel zur Kennzahl, älteste
     zuerst; dazu der Wert fuer die Legende ueber die gezeigten Spiele. */
  function verlaufReihen(mode, def) {
    var key = def.key;
    var per = spielStatistiken(mode, key);
    var summe = VERLAUF_SUMME[key], schnitt = VERLAUF_SCHNITT[key], laufend = VERLAUF_LAUFEND[key];
    /* Dieselben Leute wie in der Rangliste: keine Abend-Gaeste, Bots oder
       Testkonten; in der Liga nur unsere Spieler (keine Gegner, keine
       Gast-Konten). */
    var reihen = Object.keys(per).filter(function (id) {
      var p = profile(id);
      return p && !p.hidden && !p.bot && !p.test && (!p.gast || (p.dauer && mode !== 'liga')) && !(mode === 'liga' && p.gastKonto);
    }).map(function (id) {
      var punkte = [], z = 0, n = 0;
      per[id].forEach(function (st) {
        if (summe) { z += st[key] || 0; punkte.push({ v: z }); }
        else if (laufend) { z += st[laufend[0]] || 0; n += st[laufend[1]] || 0; if (n) punkte.push({ v: (z / n) * laufend[2] }); }
        else if (schnitt) { if (st[schnitt[1]]) punkte.push({ v: (st[schnitt[0]] / st[schnitt[1]]) * schnitt[2], z: st[schnitt[0]], n: st[schnitt[1]] }); }
        else if (st[key] !== null && st[key] !== undefined && (def.asc || st[key] > 0)) punkte.push({ v: st[key] });
      });
      var letzte = punkte.slice(-CHART_GAMES);
      if (!letzte.length) return null;
      var mittel, legende;
      if (summe || laufend) { mittel = letzte[letzte.length - 1].v; legende = def.fmt(mittel); }
      else if (schnitt) {
        /* Der echte Durchschnitt ueber die gezeigten Spiele - nicht der
           Mittelwert der Mittelwerte und nicht bloss das letzte Spiel. */
        var zz = sum(letzte, function (x) { return x.z; }), nn = sum(letzte, function (x) { return x.n; });
        mittel = nn ? (zz / nn) * schnitt[2] : 0;
        legende = 'Ø ' + (key === 'doubleQuote' ? def.fmt(mittel) : mittel.toFixed(1));
      } else {
        mittel = letzte.reduce(function (b, x) { return b === null ? x.v : def.asc ? Math.min(b, x.v) : Math.max(b, x.v); }, null);
        legende = def.fmt(mittel);
      }
      return { id: id, name: pname(id), color: playerColor(id), points: letzte.map(function (x) { return x.v; }), mittel: mittel, legende: legende };
    }).filter(Boolean);
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
  /* Der Average-Verlauf (Cricket: MPR) - fuer die Tests. */
  function chartSeries(mode) { return verlaufReihen(mode, boardDef(mode === 'cricket' ? 'mpr' : 'avg')); }

  /* Schlichtes SVG-Liniendiagramm: links die Skala, unten die Spiele. Bei
     "weniger ist besser" (def.asc) steht der kleine Wert oben. */
  function lineChart(series, label, def) {
    var asc = !!(def && def.asc);
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
    var y = function (v) { var a = ((v - lo) / (hi - lo)) * ph; return asc ? T + a : T + ph - a; };
    var ganz = series.every(function (r) { return r.points.every(function (v) { return v % 1 === 0; }); });
    var skala = function (v) { return !ganz && hi - lo < 10 ? v.toFixed(1) : v.toFixed(0); };

    var grid = '';
    for (var g = 0; g <= 3; g++) {
      var val = lo + ((hi - lo) * g) / 3;
      var gy = y(val);
      grid += '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '" stroke="#2a3340" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (gy + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="#8d9aab">' + skala(val) + '</text>';
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
      '<div class="chart-legend">' + series.slice().sort(function (a, b) { return asc ? a.mittel - b.mittel : b.mittel - a.mittel; }).map(function (r) {
        /* Unter der Linie steht der Durchschnitt ueber genau diese Spiele (bei
           weniger als zehn eben ueber die vorhandenen) -- frueher stand hier
           nur das letzte, das las sich wie der Schnitt. */
        return '<span class="cl"><i style="background:' + r.color + '"></i>' + esc(r.name) +
          ' <b>' + (r.legende || 'Ø ' + r.mittel.toFixed(1)) + '</b></span>';
      }).join('') + '</div>';
  }

  /* Rangliste je Spielart (Statistik › Mannschaft › Alle Spielarten): die
     Spielart-Reiter, je Kennzahl eine Bestwert-Karte (antippen waehlt die
     Kennzahl), die Liste aller Spieler, rechts der Verlauf der letzten 10
     Spiele und die Rekorde. "Alle Spiele" oeffnet den Spielverlauf
     anstelle der Spalten. Fuellt die festen Bausteine in #stats-rang. */
  function renderBoards() {
    var mode = UI.boardMode;
    if (!mode || mode === 'liga') mode = UI.boardMode = '501';
    var map = career();
    $('board-mode').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === mode);
    });
    /* Spielverlauf anstelle der Spalten. */
    $('stats-rang').classList.toggle('log', !!UI.boardLog);
    var defs = boardsFor(mode);
    if (!defs.some(function (b) { return b.key === UI.board; })) UI.board = defs[0].key;
    var def = boardDef(UI.board);
    $('board-titel').textContent = def.label + ' · alle Spieler';

    var log = allGamesLog().filter(function (row) { return row.kind === mode; });
    var modeName = mode === '501' ? 'Classic' : kindName(mode);
    $('boards-sub').textContent = log.length
      ? modeName + ' · ' + plural(log.length, 'Spiel', 'Spiele') +
        (mode === '501' ? ' · ' + plural(wertbareHistorie().filter(function (h) { return (h.kind || '501') === '501'; }).length, 'Turnier', 'Turniere') : '')
      : modeName + ' · noch keine Spiele';

    /* Verlauf: folgt der gewaehlten Kennzahl - eine farbige Linie je Spieler. */
    var chartLabel = def.label + (VERLAUF_SUMME[def.key] ? ' gesamt' : '') + ' – letzte ' + CHART_GAMES + (def.key === 'tourWins' ? ' Turniere' : ' Spiele');
    var chart = lineChart(verlaufReihen(mode, def), chartLabel, def);
    $('board-chart').innerHTML = '<h2>' + chartLabel + '</h2>' +
      (chart || '<p class="hint">Ab dem zweiten Spiel wird hier der Verlauf gezeichnet.</p>');

    var rows = ranking(def, map, mode);
    /* Bestwert-Karten: je Kennzahl der beste Wert und wer ihn haelt; die
       angetippte Karte bestimmt Liste und Verlauf. Hoechstens vier nebeneinander. */
    var kacheln = $('board-kacheln');
    kacheln.style.setProperty('--kn', Math.min(4, defs.length));
    kacheln.innerHTML = defs.map(function (b) {
      var top = ranking(b, map, mode)[0];
      return '<button class="bk-kachel' + (b.key === UI.board ? ' active' : '') + '" data-action="board" data-key="' + b.key + '">' +
        '<span class="bk-t">' + b.label + '</span>' +
        '<span class="bk-v">' + (top ? b.fmt(b.get(top)) : '–') + '</span>' +
        '<span class="bk-n">' + (top ? esc(top.name) : 'noch offen') + '</span></button>';
    }).join('');
    /* Platz 1 bis 3 in Medaillenfarbe (Gold, Silber, Bronze), der Beste leuchtet. */
    $('board-list').innerHTML = rows.length ? rows.map(function (st, i) {
      return '<div class="board-row ' + (i === 0 ? 'top' : '') + '" data-action="open-profile" data-id="' + esc(st.id) + '" role="button" tabindex="0">' +
        '<div class="pos' + (i < 3 ? ' m' + (i + 1) : '') + '">' + (i + 1) + '</div>' +
        avatarHTML(profile(st.id), 'sm') +
        '<div class="nm">' + esc(st.name) + '</div>' +
        '<div class="val">' + def.fmt(def.get(st)) + '</div>' +
        '</div>';
    }).join('') : '<div class="board-empty">Dafür fehlen noch Daten.</div>';
    $('board-hint').textContent = def.hint;
    $('board-hint').classList.toggle('hidden', !def.hint);

    /* Rekorde des jeweiligen Modus. */
    var recs = mode === '501' ? [
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
      { k: 'finBest', t: 'Schnellstes Finish' },
      { k: 'finHigh', t: 'Höchste Zahl' },
      { k: 'finWins', t: 'Meiste Siege' }
    ] : mode === 'kaiwen' ? [
      { k: 'kwBestTeam', t: 'PB Team' },
      { k: 'kwBestSolo', t: 'PB Solo' },
      { k: 'kwChecks', t: 'Meiste Checks' }
    ] : mode === 'hunter' ? [
      { k: 'huBestNormal', t: 'Solo Normal' },
      { k: 'huBestBoost', t: 'Solo Boost' },
      { k: 'huFaenge', t: 'Meiste Fänge' }
    ] : [
      { k: 'rtwBest', t: 'Wenigste Darts' },
      { k: 'rtwWins', t: 'Meiste Siege' }
    ];
    /* Kaiwen: zuerst der Rekord der ganzen App (mit Namen), dann die Kacheln. */
    var kwRek = mode === 'kaiwen' ? kaiwenRekord() : null;
    $('records').innerHTML = (kwRek ? '<div class="rec"><div class="rt">Rekord</div><div class="rv">' + kwRek.zahl + '</div>' +
        '<div class="rn">' + (kwRek.namen.length ? esc(kwRek.namen.join(' & ')) : 'Ausgangswert') + '</div></div>' : '') +
      recs.map(function (r) {
      var d = boardDef(r.k);
      var top = ranking(d, map, mode)[0];
      return '<div class="rec">' +
        '<div class="rt">' + r.t + '</div>' +
        '<div class="rv">' + (top ? d.fmt(d.get(top)) : '–') + '</div>' +
        '<div class="rn">' + (top ? esc(top.name) : 'noch offen') + '</div>' +
        '</div>';
    }).join('');

    $('log-title').textContent = mode === '501' ? 'Alle Classic-Spiele'
      : mode === 'cricket' ? 'Alle Cricket-Spiele'
      : mode === 'finisher' ? 'Alle Finisher-Spiele' : mode === 'kaiwen' ? 'Alle Kaiwen-Spiele' : mode === 'hunter' ? 'Alle Jagden' : 'Alle Trainings';
    $('board-log-knopf').textContent = $('log-title').textContent + ' ›';

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
          '<div class="ls">–</div>' +
          '<div class="lp right">' + plural(th.lineup.length, 'Spieler', 'Spieler') + '<span class="a">' + plural(thFertig, 'Spiel', 'Spiele') + ' · Endstand ansehen</span></div>' +
          '<div class="ld">' + fmtDate(th.at) + '</div>' +
          '</div>';
      }
      if (row.kind === 'kaiwen') {
        var kh = row.h;
        var kwLog = kaiwenState({ players: kh.players, versuche: kh.versuche || [] });
        return '<div class="log-row tap" data-action="open-summary" data-kind="kaiwen" data-id="' + esc((kh.id || 'current')) + '" role="button" tabindex="0">' +
          '<div class="lp w">' + kwLog.hoechste + '<span class="a">Kaiwen · höchste Zahl</span></div>' +
          '<div class="ls">' + (kh.rekordNeu ? 'PB' : '–') + '</div>' +
          '<div class="lp right">' + kwLog.checks + ' von ' + kwLog.versuche + ' gecheckt<span class="a">' + kh.players.map(pname).map(esc).join(', ') + '</span></div>' +
          '<div class="ld">' + fmtDate(row.at) + (row.live ? ' · noch nicht gespeichert' : '') + '</div>' +
          '</div>';
      }
      if (row.kind !== '501') {
        var h = row.h;
        var title = h.kind === 'cricket' ? 'Cricket' + (h.scoring ? '' : ' (ohne Punkte)') : kindName(h.kind);
        return '<div class="log-row tap" data-action="open-summary" data-kind="' + esc(h.kind) + '" data-id="' + esc((h.id || 'current')) + '" role="button" tabindex="0">' +
          '<div class="lp w">' + esc(pname(h.winner)) + '<span class="a">' + title + '</span></div>' +
          '<div class="ls">–</div>' +
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
          '<div class="lp right muted">' + (m.session ? 'Session · ' + plural(m.legs.filter(function (l) { return l.winner; }).length, 'Leg', 'Legs') : 'Solo') +
            '<span class="a">' + plural(soloD, 'Dart', 'Darts') + '</span></div>' +
          '<div class="ld">' + fmtDate(m.at || e.at) + '</div>' +
          '</div>';
      }
      if (m.p.length > 2) {
        /* Schnelles Spiel zu dritt oder mehr: Sieger vorn, die anderen
           rechts - eine Zeile "A 1:0 B" wuerde den Rest unterschlagen. */
        var andere = m.p.filter(function (pid) { return pid !== m.winner; });
        return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
          '<div class="lp w">' + esc(pname(m.winner)) + '<span class="a">Ø ' + avgOf(m.winner) + '</span></div>' +
          '<div class="ls">–</div>' +
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

  /* Am Tablet steht rechts die Schnellansicht des angetippten Spielers;
     am Handy (hochkant wie quer) gibt es nur die Liste, ein Tipp oeffnet
     das Profil. */
  function spielerSchnellansicht() {
    return window.matchMedia('(min-width: 700px) and (min-height: 501px)').matches;
  }
  function istGastProfil(p) { return !!(p.gast || p.gastKonto); }
  /* Split View oder Drehen: wechselt das Geraet zwischen Handy- und
     Tablet-Layout, muss die Liste neu entscheiden, was ein Tipp tut. */
  if (window.matchMedia) {
    window.matchMedia('(min-width: 700px) and (min-height: 501px)').addEventListener('change', function () {
      if (S.screen === 'players') render();
    });
    /* Spielplan: am Handy klappt die Karte in der Liste auf, am Tablet
       steht sie links - beim Drehen oder Split View neu entscheiden. */
    window.matchMedia('(max-width: 699px)').addEventListener('change', function () {
      if (S.screen === 'liga') render();
    });
  }

  function renderPlayers() {
    var map = career();
    /* Geloeschte bzw. abgeraeumte Gaeste tauchen hier gar nicht mehr auf –
       ausgeblendete Team-Profile bleiben (ausgegraut) sichtbar, damit man
       sie wieder einblenden kann. */
    var alle = S.profiles.filter(function (p) { return !(p.gast && p.hidden); });
    var filter = UI.spielerFilter || 'alle';
    var liste = alle.filter(function (p) {
      return filter === 'alle' || (filter === 'team' ? !istGastProfil(p) : istGastProfil(p));
    });
    var team = alle.filter(function (p) { return !istGastProfil(p); }).length;
    $('players-sub').textContent = plural(team, 'im Team', 'im Team') + ' · ' + plural(alle.length - team, 'Gast', 'Gäste');
    $('players-filter').querySelectorAll('[data-action="players-filter"]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === filter);
    });
    var schnell = spielerSchnellansicht();
    /* Die Schnellansicht zeigt den angetippten Spieler, sonst den ersten
       der Liste. */
    if (!liste.some(function (p) { return p.id === UI.spielerWahl; })) UI.spielerWahl = liste.length ? liste[0].id : null;
    var marke = function (p) {
      return (p.gast ? '<span class="pc-tag">' + (p.dauer ? 'Gast' : 'Gast · heute') + '</span>'
        : p.gastKonto ? '<span class="pc-tag">Gast-Konto</span>'
        : p.test ? '<span class="pc-tag">Test</span>' : '') +
        (p.hidden ? '<span class="pc-tag">ausgeblendet</span>' : '');
    };
    /* Ein Tipp: am Tablet die Schnellansicht rechts; am Handy das eigene
       Profil, bei allen anderen die Einzelstatistik (Julius, 12.11.: jeder
       sieht nur sein Profil). */
    $('players-list').innerHTML = liste.map(function (p) {
      var st = map[p.id];
      return '<div class="player-card' + (p.hidden ? ' hidden-profile' : '') + (schnell && p.id === UI.spielerWahl ? ' active' : '') +
        '" data-action="' + (schnell ? 'spieler-wahl' : bearbeitbar(p.id) ? 'open-profile' : 'stats-person') + '" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
        avatarHTML(p, 'lg') +
        '<div class="pc-main">' +
          '<div class="pc-name"><span class="pc-nm">' + esc(p.name) + '</span>' + marke(p) + '</div>' +
          '<div class="pc-stats">' +
            '<span>Ø <b>' + (st.darts ? st.avg.toFixed(1) : '–') + '</b></span>' +
            '<span>Siege <b>' + st.won + '</b></span>' +
            '<span>180er <b>' + st.s180 + '</b></span>' +
          '</div>' +
        '</div>' +
        '</div>';
    }).join('') || '<div class="board-empty">Niemand in dieser Auswahl.</div>';
    $('players-schnell').innerHTML = schnell && UI.spielerWahl ? spielerSchnellHtml(profile(UI.spielerWahl), map[UI.spielerWahl]) : '';
    $('players-schnell').classList.toggle('hidden', !(schnell && UI.spielerWahl));
  }

  /* Schnellansicht im Stil der Statistik: Bilanz, die letzten Spiele als
     Pillen, sechs Kennzahl-Kacheln, dann "Statistik ›" (die Einzelstatistik
     des Spielers); Bearbeiten und Ganzes Profil nur, wo man das Profil auch
     pflegen darf (eigenes Konto, Gaeste). */
  function spielerSchnellHtml(p, st) {
    var form = st.lastResults.slice(0, 10).reverse().map(function (r, i) {
      return '<span class="st-pill ' + (r.win ? 'w' : 'l') + '" style="animation-delay:' + (i * 60) + 'ms">' + (r.win ? 'S' : 'N') + '</span>';
    }).join('');
    var F = ST_FARBE, darf = bearbeitbar(p.id);
    return '<div class="ps-kopf">' + avatarHTML(p, 'xl') +
      '<div class="ps-titel"><span class="ps-name">' + esc(p.name) + '</span>' +
        '<span class="ps-bilanz">' + (st.matches
          ? plural(st.won, 'Sieg', 'Siege') + ' · ' + plural(st.lost, 'Niederlage', 'Niederlagen') + ' · ' + st.winPct.toFixed(0) + ' %'
          : 'Noch kein Spiel gespielt') + '</span></div></div>' +
      (form ? '<div class="ps-form"><span class="kt">Letzte Spiele</span><div class="st-pillen">' + form + '</div></div>' : '') +
      stMinis([
        ['Average', st.darts ? st.avg.toFixed(1) : '–', '', F.blau],
        ['First 9', st.first9Darts ? st.first9.toFixed(1) : '–', '', F.lila],
        ['Doppelquote', st.doubleAttempts ? st.doubleQuote.toFixed(1) + ' %' : '–', st.doubleAttempts ? st.doubleHits + ' von ' + st.doubleAttempts : '', F.gruen],
        ['180er', st.s180, st.s140 + '× 140+', F.rot],
        ['Höchstes Finish', st.highCO || '–', '', F.gold],
        ['Bestes Leg', st.bestLeg ? st.bestLeg + ' Darts' : '–']
      ]) +
      '<div class="ps-knoepfe' + (darf ? ' drei' : '') + '">' +
        (darf ? '<button class="btn ghost" data-action="edit-profile" data-id="' + esc(p.id) + '">Bearbeiten</button>' +
          '<button class="btn ghost" data-action="open-profile" data-id="' + esc(p.id) + '">Profil ›</button>' : '') +
        '<button class="btn hell" data-action="stats-person" data-id="' + esc(p.id) + '">Statistik ›</button>' +
      '</div>';
  }

  /* ================= Profil =================
     Entwurf "Profil" (Okt. 2026): oben der Spielerausweis (Bild, Name,
     Status-Chips, Profil bearbeiten, Form der letzten 10), darunter drei
     Kacheln: Finish-Weg mit Lieblingsgruppe und "Meine besten Finishes
     ermitteln", Statistik-Links, und beim eigenen Konto die Konto-Kachel.
     "Meine Stats" oeffnet die ausfuehrlichen Karten als Tafel im Profil. */

  function eigeneKontoId() {
    var n = window.DartKonto && window.DartKonto.nutzer ? window.DartKonto.nutzer() : null;
    return n ? n.id : null;
  }
  function eigenesProfilOeffnen() {
    var id = eigeneKontoId();
    if (!id || !profile(id)) return false;
    UI.profile = id; UI.profilPanel = null; UI.profilGruppenWahl = false;
    S.screen = 'profile'; save(); render();
    return true;
  }
  function monatJahr(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][d.getMonth()] + ' ' + d.getFullYear();
  }

  function renderProfile() {
    var p = profile(UI.profile);
    var st = career()[p.id];
    if (!st) { S.screen = 'players'; render(); return; }
    var darf = bearbeitbar(p.id);
    var eigen = !!eigeneKontoId() && p.id === eigeneKontoId();
    var nutzer = eigen ? window.DartKonto.nutzer() : null;

    var form = st.lastResults.slice(0, 10).reverse().map(function (r) {
      return '<span class="form ' + (r.win ? 'w' : 'l') + '">' + (r.win ? 'S' : 'N') + '</span>';
    }).join('');
    var status = p.gast ? (p.dauer ? 'Gast' : 'Gast · heute') : p.gastKonto ? 'Gast-Konto' : p.test ? 'Testkonto' : p.bot ? 'Bot' : 'Mitglied';
    /* "seit": beim Konto das Anlegedatum vom Server, sonst das des
       Profils - Altbestand ohne brauchbares Datum bleibt ohne Chip. */
    var seitTs = nutzer && nutzer.seit ? Date.parse(nutzer.seit) : p.created;
    var seit = seitTs > Date.UTC(2020, 0, 1) ? monatJahr(seitTs) : '';
    var chips = [];
    if (seit) chips.push('seit ' + seit);
    chips.push(st.matches
      ? plural(st.won, 'Sieg', 'Siege') + ' · ' + plural(st.lost, 'Niederlage', 'Niederlagen')
      : 'Noch kein Spiel gespielt');
    if (st.tourWins) chips.push(plural(st.tourWins, 'Turniersieg', 'Turniersiege'));
    if (p.hidden) chips.push('ausgeblendet');

    var ausweis = '<div class="pa-ausweis">' +
      '<div class="pa-av">' + avatarHTML(p, 'xl') +
        (darf ? '<button class="pa-foto" data-action="profil-foto" aria-label="Foto ändern">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"></path><circle cx="12" cy="13" r="3.4"></circle></svg></button>' : '') +
      '</div>' +
      '<div class="pa-mitte">' +
        '<div class="pa-namen"><span class="pa-name">' + esc(p.name) + '</span>' +
          (p.voll ? '<span class="pa-voll">' + esc(p.voll) + '</span>' : '') + '</div>' +
        '<div class="pa-chips"><span class="pa-chip status">' + status + '</span>' +
          chips.map(function (c) { return '<span class="pa-chip">' + esc(c) + '</span>'; }).join('') + '</div>' +
      '</div>' +
      '<div class="pa-rechts">' +
        (darf ? '<button class="btn pa-btn" data-action="edit-current-profile">Profil bearbeiten</button>' : '<span></span>') +
        (form ? '<div class="pa-form"><span class="kt">Form · letzte 10</span><div class="form-row">' + form + '</div></div>' : '<span></span>') +
      '</div>' +
    '</div>';

    var koerper;
    if (UI.profilPanel === 'foto' && UI.foto) {
      koerper = fotoPanelHtml(p);
    } else if (UI.profilPanel === 'edit' && UI.profilEdit) {
      koerper = profilBearbeitenHtml(p, eigen);
    } else if (UI.profilPanel === 'tabelle') {
      koerper = finishTabelleHtml(p, darf, eigen);
    } else if (UI.profilPanel === 'stats') {
      koerper = '<div class="pa-panel">' +
        '<div class="pa-panel-kopf"><span class="pa-panel-titel">' + (eigen ? 'Meine Stats' : 'Statistik') + '</span>' +
          '<button class="btn hell pa-fertig" data-action="profil-panel-zu">Fertig</button></div>' +
        '<div class="pa-panel-koerper">' + profilStatsHtml(p, st) + '</div></div>';
    } else {
      var linkKachel = function (action, k, t, sub) {
        return '<button class="pa-link" data-action="' + action + '"><span class="kt">' + k + '</span>' +
          '<span class="pa-link-zeile"><span class="pa-link-text"><span class="pa-link-t">' + t + '</span><span class="pa-link-s">' + sub + '</span></span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></span></button>';
      };
      koerper = '<div class="pa-kacheln' + (eigen ? ' drei' : '') + '">' +
        finishKachelHtml(p, st, darf) +
        '<div class="pa-links">' +
          linkKachel('profil-stats', 'Statistik', eigen ? 'Meine Stats' : 'Alle Stats', 'Alle Spielarten · ' + plural(st.matches, 'Spiel', 'Spiele')) +
          linkKachel('profil-liga', 'Liga', 'Liga-Statistik', esc(LIGA.saison || 'Saison')) +
        '</div>' +
        (eigen ? '<div class="pa-kachel pa-konto"><span class="kt">Konto</span>' +
          '<div class="pa-konto-feld"><span>E-Mail</span><b>' + esc(nutzer.email || '') + '</b></div>' +
          /* Benachrichtigungen (Push und Mail je Thema): Dialog aus js/auth.js. */
          '<button class="btn pa-btn" data-action="konto-mitteilungen">Benachrichtigungen</button>' +
          '<div class="pa-konto-luft"></div>' +
          '<button class="btn pa-btn" data-action="konto-passwort">Passwort ändern</button>' +
          '<button class="btn pa-btn leise" data-action="konto-logout">Abmelden</button></div>' : '') +
      '</div>';
    }
    $('profile-detail').innerHTML = ausweis + koerper;
  }

  /* Die Kachel "Finish-Weg": Lieblingsgruppe(n) als Kette, darunter der
     Stand (Standardtabelle oder eigene Tabelle), dann der Knopf zum
     Ermitteln. Antippen der Kette oeffnet die Gruppenwahl. */
  function finishKachelHtml(p, st, darf) {
    var gr = finishGruppen(p), f = p.finish || {};
    var wahl = !!(UI.profilGruppenWahl && darf);
    var tag = darf ? 'button' : 'span';
    var kette = gr.length ? gr.map(function (g, i) {
      return (i ? '<span class="pa-pfeil" aria-hidden="true">›</span>' : '') +
        '<' + tag + ' class="pa-gruppe' + (wahl ? ' active' : '') + '"' + (darf ? ' data-action="profil-gruppen"' : '') + '>' + g +
        '<small>' + FINISH_KETTE[g].join(' · ') + '</small></' + tag + '>';
    }).join('') : '<' + tag + ' class="pa-gruppe leer' + (wahl ? ' active' : '') + '"' + (darf ? ' data-action="profil-gruppen"' : '') + '>egal<small>Standardweg</small></' + tag + '>';
    var pad = wahl ? '<div class="pa-pad">' + FINISH_GRUPPEN.map(function (g) {
      var an = gr.indexOf(g);
      return '<button data-action="profil-gruppe" data-value="' + g + '" class="' + (an === 0 ? 'haupt' : an > 0 ? 'zweit' : '') + '">' + g + '</button>';
    }).join('') + '<button data-action="profil-gruppe" data-value="" class="' + (gr.length ? '' : 'haupt') + '">egal</button></div>' +
      '<p class="pa-text">Bis zu zwei Gruppen, die erste ist die Hauptgruppe. Nochmal antippen nimmt eine Gruppe wieder weg.</p>' : '';
    var stand;
    if (f.tabelle) {
      stand = 'Eigene Tabelle vom ' + fmtDate(f.stand) + ' · Average ' + (f.avg ? String(f.avg).replace('.', ',') : '?') +
        ' · ' + (SPIELWEISEN[f.spielweise] || 'Aufnahmen') + '.';
    } else if (f.avg && darf) {
      stand = 'Lieblingsgruppe geändert: die eigene Tabelle gilt nicht mehr. Bitte neu ermitteln.';
    } else {
      stand = (gr.length ? 'Standardtabelle für ' + gr[0] + '.' : 'Standardtabelle ohne Lieblingsdoppel.') +
        (darf ? ' Antippen zum Ändern. Oder die Tabelle aus Average und Wurftests ermitteln lassen.' : '');
    }
    var nEig = finishEigeneAnzahl(p);
    var knopf = wahl ? '<button class="btn pa-btn hell" data-action="profil-gruppen-ok">OK</button>'
      : (darf ? '<button class="btn pa-btn" data-action="finish-ermitteln">Meine besten Finishes ermitteln</button>' : '') +
        '<button class="btn pa-btn" data-action="profil-tabelle">' + (darf ? 'Finish-Tabelle anpassen' : 'Finish-Tabelle ansehen') +
          '<span class="pa-btn-sub">' + (nEig ? nEig + ' angepasst' : '') + '</span></button>';
    return '<div class="pa-kachel pa-finish">' +
      '<span class="kt">Finish-Weg · Lieblingsgruppe</span>' +
      '<div class="pa-kette">' + kette + '</div>' +
      pad +
      (wahl ? '' : '<p class="pa-text">' + stand + '</p>') +
      '<div class="pa-finish-knoepfe">' + knopf + '</div>' +
    '</div>';
  }

  /* ---------- Profil bearbeiten (Entwurf "Profil bearbeiten", Okt. 2026) ----------
     Eigene Flaeche im Profil statt des Dialogs: links Foto mit "Foto ändern"
     und "Entfernen" sowie die Avatar-Farbe, rechts Spielername, Kürzel,
     Vor- und Nachname, E-Mail (nur beim eigenen Konto) und Wurfhand. */
  function profilBearbeitenStarten(p) {
    var t = vollSplit(p.voll);
    var eigen = !!eigeneKontoId() && p.id === eigeneKontoId();
    var nutzer = eigen ? window.DartKonto.nutzer() : null;
    UI.profilEdit = { name: p.name || '', kuerzel: typeof p.kuerzel === 'string' ? p.kuerzel : '', vor: t.vor, nach: t.nach,
      email: nutzer ? nutzer.email || '' : null, emailAlt: nutzer ? nutzer.email || '' : null, emailPass: '',
      hue: typeof p.hue === 'number' ? p.hue : hue(p.id), wurfhand: p.wurfhand === 'L' || p.wurfhand === 'R' ? p.wurfhand : null,
      avatar: p.avatar || null, fehler: '', doppeltOk: null, laeuft: false };
    UI.profilPanel = 'edit'; UI.profilGruppenWahl = false;
    render();
  }
  function profilBearbeitenHtml(p, eigen) {
    var d = UI.profilEdit;
    var vorschau = { id: p.id, name: d.name || p.name, kuerzel: d.kuerzel, avatar: d.avatar, hue: d.hue };
    var feld = function (role, label, wert, extra) {
      return '<label class="pe-feld"><span class="kt">' + label + '</span>' +
        '<input class="pe-input" type="text" data-role="' + role + '" value="' + esc(wert || '') + '" ' + (extra || '') + '></label>';
    };
    return '<div class="pa-panel pe-panel">' +
      '<div class="pa-panel-kopf"><span class="pa-panel-titel">Profil bearbeiten</span>' +
        '<button class="btn pa-btn" data-action="pe-abbrechen">Abbrechen</button>' +
        '<button class="btn hell pa-fertig" data-action="pe-speichern"' + (d.laeuft ? ' disabled' : '') + '>Speichern</button></div>' +
      (d.fehler ? '<p class="hint fehler pe-fehler" role="alert">' + esc(d.fehler) + '</p>' : '') +
      '<div class="pe-koerper">' +
        '<div class="pe-links">' +
          '<div class="pe-av">' + avatarHTML(vorschau, 'xl') + '</div>' +
          '<div class="pe-foto-knoepfe">' +
            '<button class="btn pa-btn" data-action="pe-foto">Foto ändern</button>' +
            '<button class="btn pa-btn leise" data-action="pe-foto-weg"' + (d.avatar ? '' : ' disabled') + '>Entfernen</button></div>' +
          '<span class="kt">Avatar-Farbe</span>' +
          '<div class="pe-farben">' + HUES.map(function (h) {
            return '<button class="pe-farbe' + (h === d.hue ? ' active' : '') + '" data-action="pe-farbe" data-hue="' + h + '" style="background:hsl(' + h + ',40%,28%)" aria-label="Farbton ' + h + '"></button>';
          }).join('') + '</div>' +
        '</div>' +
        '<div class="pe-rechts">' +
          '<div class="pe-raster">' +
            feld('profile-name', 'Spielername', d.name, 'placeholder="Spielername" maxlength="16" autocomplete="off"') +
            feld('pe-kuerzel', 'Kürzel', d.kuerzel, 'placeholder="' + esc(initials(d.name || p.name)) + '" maxlength="3" autocomplete="off" autocapitalize="characters"') +
            feld('profile-vor', 'Vorname', d.vor, 'placeholder="Vorname" maxlength="30" autocomplete="off"') +
            feld('profile-nach', 'Nachname', d.nach, 'placeholder="Nachname" maxlength="30" autocomplete="off"') +
          '</div>' +
          '<p class="pa-text">Der echte Name steht nur auf Spielberichten und in der Liga.</p>' +
          (eigen ? feld('pe-email', 'E-Mail', d.email, 'placeholder="E-Mail" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"') : '') +
          /* Eine neue E-Mail nimmt der Server nur mit dem aktuellen Passwort
             an. Das Feld steht immer da (Tippen zeichnet nicht neu, sonst
             koennte es nicht erst beim Aendern der Adresse erscheinen) und
             wird nur gebraucht, wenn die Adresse wirklich wechselt. */
          (eigen
            ? '<label class="pe-feld"><span class="kt">Aktuelles Passwort (nur bei neuer E-Mail)</span>' +
              '<input class="pe-input" type="password" data-role="pe-email-pass" value="' + esc(d.emailPass || '') + '" autocomplete="current-password" placeholder="zum Bestätigen der neuen E-Mail"></label>'
            : '') +
          '<div class="pe-feld"><span class="kt">Wurfhand</span><div class="dl-segment pe-hand">' +
            '<button data-action="pe-hand" data-value="R" class="' + (d.wurfhand === 'R' ? 'active' : '') + '">Rechts</button>' +
            '<button data-action="pe-hand" data-value="L" class="' + (d.wurfhand === 'L' ? 'active' : '') + '">Links</button></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function profilBearbeitenSpeichern() {
    var d = UI.profilEdit, p = profile(UI.profile);
    if (!d || !p || !bearbeitbar(p.id)) return;
    var name = (d.name || '').trim();
    if (!name) { d.fehler = 'Bitte einen Namen eingeben.'; render(); return; }
    var doppelt = S.profiles.some(function (x) { return x.id !== p.id && !x.hidden && String(x.name).trim().toLowerCase() === name.toLowerCase(); });
    if (doppelt && d.doppeltOk !== name) {
      d.doppeltOk = name;
      d.fehler = '„' + name + '“ gibt es schon. Nochmal auf Speichern tippen, wenn es wirklich ein zweiter Spieler ist.';
      render(); return;
    }
    var fertig = function () {
      p.name = name;
      p.kuerzel = (d.kuerzel || '').replace(/[\u0000-\u001f<>"'&]/g, '').trim().slice(0, 3) || null;
      p.voll = vollAusTeilen(d.vor, d.nach) || null;
      p.hue = d.hue;
      p.wurfhand = d.wurfhand;
      p.avatar = d.avatar;
      if (window.DartKonto) window.DartKonto.profilGeaendert(p.id);
      UI.profilPanel = null; UI.profilEdit = null;
      save(); render();
    };
    /* E-Mail nur beim eigenen Konto und nur, wenn sie sich aendert: der
       Server prueft Form und Freiheit, erst dann wird gespeichert. */
    var neueMail = d.email === null ? null : (d.email || '').trim();
    if (neueMail !== null && neueMail !== d.emailAlt && window.DartKonto && window.DartKonto.emailAendern) {
      if (!(d.emailPass || '').length) { d.fehler = 'Für eine neue E-Mail bitte das aktuelle Passwort eingeben.'; render(); return; }
      d.laeuft = true; d.fehler = ''; render();
      window.DartKonto.emailAendern(neueMail, d.emailPass).then(function () { d.laeuft = false; fertig(); }, function (err) {
        d.laeuft = false; d.fehler = err && err.message ? err.message : 'Die E-Mail ließ sich nicht ändern.'; render();
      });
      return;
    }
    fertig();
  }

  /* ---------- Foto anpassen (Entwurf "Foto anpassen") ----------
     Links das Bild im Ausschnitt (ziehen zum Verschieben, runder Rahmen),
     rechts Vorschau in drei Groessen, Zoom und die Quellen Kamera / Galerie.
     "Übernehmen" schneidet den Kreis auf 220 × 220 zu - wie bisher readAvatar. */
  var FOTO_MAX = 1200;
  function fotoStarten(avatar, zurueck) {
    UI.foto = { src: avatar || null, nw: 0, nh: 0, zoom: 0, x: 0, y: 0, zurueck: zurueck, laedt: false };
    UI.profilPanel = 'foto';
    if (avatar) fotoMasse(avatar);
    render();
    if (!avatar) $('avatar-input').click();
  }
  function fotoMasse(src) {
    var img = new Image();
    img.onload = function () { if (UI.foto && UI.foto.src === src) { UI.foto.nw = img.naturalWidth; UI.foto.nh = img.naturalHeight; render(); } };
    img.src = src;
  }
  /* Ein gewaehltes Bild einlesen und auf hoechstens FOTO_MAX Pixel bringen,
     damit das Ziehen fluessig bleibt und der Speicher nicht vollläuft. */
  function fotoLaden(file) {
    var reader = new FileReader();
    reader.onload = function () { fotoAusDataUrl(reader.result); };
    reader.readAsDataURL(file);
  }
  function fotoAusDataUrl(dataUrl) {
    var img = new Image();
    img.onload = function () {
      var f = Math.min(1, FOTO_MAX / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * f)), h = Math.max(1, Math.round(img.height * f));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      var src;
      try { src = c.toDataURL('image/jpeg', 0.9); } catch (e) { src = null; }
      if (!UI.foto) return;
      if (!src) { UI.foto.fehler = 'Das Bild ließ sich nicht lesen.'; UI.foto.laedt = false; render(); return; }
      UI.foto.src = src; UI.foto.nw = w; UI.foto.nh = h; UI.foto.zoom = 15; UI.foto.x = 0; UI.foto.y = 0; UI.foto.fehler = ''; UI.foto.laedt = false;
      render();
    };
    img.onerror = function () { if (UI.foto) { UI.foto.fehler = 'Das Bild ließ sich nicht lesen.'; UI.foto.laedt = false; render(); } };
    img.src = dataUrl;
  }
  /* Geometrie des Ausschnitts: Buehne S x S, Bild mit Breite S * k (k aus dem
     Zoom), um (x, y) verschoben; der Kreis hat 82 % der Buehne. */
  function fotoGeometrie(f, S) {
    /* Zoom 0: die kurze Bildseite fuellt den Kreis genau (ein schon
       zugeschnittenes 220er-Foto bleibt so unveraendert), Zoom 100 das
       Zweieinhalbfache. */
    var seiten = f.nw && f.nh ? Math.max(f.nw / f.nh, f.nh / f.nw) : 1;
    var k = 0.82 * seiten * (1 + f.zoom * 0.015);
    var w = S * k, h = f.nw && f.nh ? w * f.nh / f.nw : w;
    if (f.nw && f.nh && f.nh > f.nw) { h = S * k; w = h * f.nw / f.nh; }
    var d = S * 0.82;
    /* Das Bild darf den Kreis nie freigeben. */
    var maxX = Math.max(0, (w - d) / 2), maxY = Math.max(0, (h - d) / 2);
    f.x = Math.max(-maxX, Math.min(maxX, f.x)); f.y = Math.max(-maxY, Math.min(maxY, f.y));
    return { w: w, h: h, d: d, left: S / 2 + f.x - w / 2, top: S / 2 + f.y - h / 2, kreisLeft: (S - d) / 2, kreisTop: (S - d) / 2 };
  }
  function fotoAusschnitt(f, S, groesse) {
    if (!f.src || !f.nw) return null;
    var g = fotoGeometrie(f, S), img = fotoBild(f);
    if (!img) return null;
    var size = groesse || 220, m = size / g.d;
    var c = document.createElement('canvas'); c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#0b0809'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (g.left - g.kreisLeft) * m, (g.top - g.kreisTop) * m, g.w * m, g.h * m);
    try { return c.toDataURL('image/jpeg', 0.82); } catch (e) { return null; }
  }
  var fotoBildCache = { src: null, img: null };
  function fotoBild(f) {
    if (fotoBildCache.src === f.src && fotoBildCache.img && fotoBildCache.img.complete) return fotoBildCache.img;
    var img = new Image();
    /* Sobald das Bild da ist, einmal neu zeichnen - dann stimmt die Vorschau. */
    img.onload = function () { if (UI.foto && UI.foto.src === f.src && S.screen === 'profile') render(); };
    img.src = f.src;
    fotoBildCache = { src: f.src, img: img };
    return img.complete && img.naturalWidth ? img : null;
  }
  function fotoPanelHtml(p) {
    var f = UI.foto;
    var S = 1000;   /* Buehnen-Mass in Promille: alles relativ, die Buehne skaliert per CSS */
    var g = f.src && f.nw ? fotoGeometrie(f, S) : null;
    var vorschau = g ? fotoAusschnitt(f, S, 220) : null;
    var pz = function (v) { return (v / 10).toFixed(2) + '%'; };
    var kreis = function (kl) {
      return '<span class="pf-vor ' + kl + '">' + (vorschau ? '<span class="pf-vor-bild" style="background-image:url(' + vorschau + ')"></span>' : avatarHTML({ id: p.id, name: p.name, kuerzel: p.kuerzel, avatar: null, hue: p.hue }, 'xl')) + '</span>';
    };
    return '<div class="pa-panel pf-panel">' +
      '<div class="pa-panel-kopf"><span class="pa-panel-titel">Foto anpassen</span>' +
        '<button class="btn pa-btn" data-action="foto-abbrechen">Abbrechen</button>' +
        '<button class="btn hell pa-fertig" data-action="foto-ok"' + (g ? '' : ' disabled') + '>Übernehmen</button></div>' +
      (f.fehler ? '<p class="hint fehler pe-fehler" role="alert">' + esc(f.fehler) + '</p>' : '') +
      '<div class="pf-koerper">' +
        '<div class="pf-rahmen"><div class="pf-buehne" id="pf-buehne">' +
          (g ? '<img class="pf-bild" src="' + f.src + '" alt="" draggable="false" style="left:' + pz(g.left) + ';top:' + pz(g.top) + ';width:' + pz(g.w) + ';height:' + pz(g.h) + '">'
            : '<span class="pf-leer">' + (f.laedt ? 'Bild wird geladen …' : 'Noch kein Bild. Unten Kamera oder Galerie wählen.') + '</span>') +
          '<span class="pf-kreis"></span>' +
          (g ? '<span class="pf-tipp">Ziehen zum Verschieben</span>' : '') +
        '</div></div>' +
        '<div class="pf-rechts">' +
          '<span class="kt">Vorschau</span>' +
          '<div class="pf-vorschau">' +
            '<div class="pf-vor-eintrag">' + kreis('gross') + '<span>Profil</span></div>' +
            '<div class="pf-vor-eintrag">' + kreis('mittel') + '<span>Spiel</span></div>' +
            '<div class="pf-vor-eintrag">' + kreis('klein') + '<span>Liste</span></div>' +
          '</div>' +
          '<span class="kt">Zoom</span>' +
          '<div class="pf-zoom">' +
            '<button data-action="foto-zoom" data-d="-10" aria-label="Kleiner"' + (g ? '' : ' disabled') + '>−</button>' +
            '<input type="range" min="0" max="100" step="1" value="' + f.zoom + '" data-role="foto-zoom" aria-label="Zoom"' + (g ? '' : ' disabled') + '>' +
            '<button data-action="foto-zoom" data-d="10" aria-label="Größer"' + (g ? '' : ' disabled') + '>+</button>' +
          '</div>' +
          '<div class="pf-luft"></div>' +
          '<div class="pf-quellen">' +
            '<button class="btn pa-btn" data-action="foto-kamera"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"></path><circle cx="12" cy="13" r="3.4"></circle></svg>Kamera</button>' +
            '<button class="btn pa-btn" data-action="foto-galerie"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="M3.5 16l5-5 4 4 3-3 5 5"></path></svg>Galerie</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  /* Ziehen auf der Buehne: waehrend der Bewegung nur das Bild verschieben,
     neu gezeichnet wird erst beim Loslassen (dann auch die Vorschau). */
  function fotoZiehenEinrichten() {
    var b = $('pf-buehne');
    if (!b || !UI.foto || !UI.foto.src) return;
    var start = null;
    b.addEventListener('pointerdown', function (ev) {
      if (!UI.foto) return;
      start = { px: ev.clientX, py: ev.clientY, x: UI.foto.x, y: UI.foto.y, S: b.clientWidth };
      try { b.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
      ev.preventDefault();
    });
    b.addEventListener('pointermove', function (ev) {
      if (!start || !UI.foto) return;
      var f = UI.foto, S = 1000, sk = S / start.S;
      f.x = start.x + (ev.clientX - start.px) * sk; f.y = start.y + (ev.clientY - start.py) * sk;
      var g = fotoGeometrie(f, S), img = b.querySelector('.pf-bild');
      if (img) { img.style.left = (g.left / 10).toFixed(2) + '%'; img.style.top = (g.top / 10).toFixed(2) + '%'; }
    });
    var ende = function () { if (!start) return; start = null; render(); };
    b.addEventListener('pointerup', ende);
    b.addEventListener('pointercancel', ende);
  }
  function fotoSchliessen() {
    var f = UI.foto;
    UI.foto = null;
    fotoBildCache = { src: null, img: null };
    UI.profilPanel = f && f.zurueck === 'edit' && UI.profilEdit ? 'edit' : null;
    render();
  }
  function fotoUebernehmen() {
    var f = UI.foto, p = profile(UI.profile);
    if (!f || !p) return;
    var bild = fotoAusschnitt(f, 1000, 220);
    if (!bild) { f.fehler = 'Das Bild ließ sich nicht zuschneiden.'; render(); return; }
    if (f.zurueck === 'edit' && UI.profilEdit) { UI.profilEdit.avatar = bild; fotoSchliessen(); return; }
    if (!bearbeitbar(p.id)) return;
    p.avatar = bild;
    if (window.DartKonto) window.DartKonto.profilGeaendert(p.id);
    UI.foto = null; UI.profilPanel = null;
    fotoBildCache = { src: null, img: null };
    save(); render();
  }

  /* ---------- Finish-Tabelle ansehen und anpassen (Phase 3) ----------
     Entwurf "Profil", Tafel "Meine Finish-Tabelle": alle Reste 170 bis 2 mit
     dem Weg fuer drei Darts (Lieblingsdoppel hell), Filter Alle · Angepasst,
     ein Tipp auf den Rest oeffnet den Editor: Darts in der Hand (3, 2, 1),
     drei Felder, Tastenfeld mit Single/Double/Triple, harte Pruefung
     (Summe, Doppel am Ende), Vergleich mit dem besten Weg aus dem Modell
     (Aufnahmen, Checkout-Chance, Warnung bei deutlich schlechter) und die
     Alternativen der Engine. Eigene Eintraege liegen in p.finish.eigene und
     bleiben beim Neu-Ermitteln stehen (Schloss). */
  function tokenAusKompakt(t) { return t === 'BULL' ? 'Bull' : t.charAt(0) === 'S' ? t.slice(1) : t; }
  function tokenKompakt(t) { return t === 'Bull' ? 'BULL' : /^\d+$/.test(t) && t !== '25' ? 'S' + t : t; }
  function tokenWertApp(t) {
    if (t === 'Bull') return 50;
    if (t === '25') return 25;
    var m = t.charAt(0) === 'T' ? 3 : t.charAt(0) === 'D' ? 2 : 1;
    return m * Number(t.replace(/^[TD]/, ''));
  }
  /* Profil fuer Fragen an die Engine: das kalibrierte, sonst das
     Referenzprofil mit dem Lieblingsdoppel (so entstanden die festen Tabellen). */
  function finishEngineProfil(p) {
    var f = p.finish || {};
    if (f.profil && typeof f.profil === 'object') return f.profil;
    var dbl = DOPPEL_WAHL.indexOf(p.dbl) >= 0 ? p.dbl : null;
    return { favoriten: dbl && dbl !== 25 ? [dbl] : [] };
  }
  function tabZustand() {
    if (!UI.tab) UI.tab = { filter: 'alle', rest: null, darts: 3, seg: 'T', slot: 0, entwurf: [], info: null, alts: {} };
    return UI.tab;
  }
  /* Der Weg, der fuer Rest und Darts gerade gilt (eigen oder gerechnet/fest). */
  function tabWegTokens(p, rest, darts) {
    var z = Checkout.suggest(rest, darts, lieblingsDoppel(p.id)) || (Checkout.stellwurf(rest, darts, lieblingsDoppel(p.id)) || {}).darts || [];
    return z.map(tokenAusKompakt);
  }
  function tabEigenerTeil(p, rest, darts) {
    var e = p.finish && p.finish.eigene && p.finish.eigene[rest];
    return e ? (String(e).split('|')[3 - darts] || '') : '';
  }
  function tabRestWaehlen(p, rest) {
    var t = tabZustand();
    t.rest = rest; t.slot = 0; t.seg = 'T'; t.info = null;
    t.entwurf = tabWegTokens(p, rest, t.darts);
    tabInfoHolen(p);
  }
  function tabInfoHolen(p) {
    var t = tabZustand();
    if (!t.rest) return;
    var tokens = t.entwurf.filter(Boolean);
    var profil = finishEngineProfil(p);
    var key = t.rest + '/' + t.darts + '/' + tokens.join(' ');
    var altKey = t.rest + '/' + t.darts;
    t.info = { key: key, laedt: true };
    if (!t.alts[altKey]) {
      t.alts[altKey] = { laedt: true };
      Checkout.fragen({ profil: profil, frage: 'alternativen', rest: t.rest, darts: t.darts, anzahl: 4 }).then(function (a) {
        if (UI.tab !== t) return;
        t.alts[altKey] = { liste: a.alternativen };
        if (S.screen === 'profile' && UI.profilPanel === 'tabelle') render();
      }, function () { if (UI.tab === t) delete t.alts[altKey]; });
    }
    if (!tokens.length) { t.info = { key: key, pruefung: { ok: false, fehler: ['kein Dart angegeben'], warnungen: [] } }; return; }
    Checkout.fragen({ profil: profil, frage: 'vergleich', rest: t.rest, darts: t.darts, tokens: tokens }).then(function (a) {
      if (UI.tab !== t || !t.info || t.info.key !== key) return;
      t.info = { key: key, pruefung: a.pruefung, vergleich: a.vergleich };
      if (S.screen === 'profile' && UI.profilPanel === 'tabelle') render();
    }, function (err) {
      if (UI.tab !== t || !t.info || t.info.key !== key) return;
      t.info = { key: key, fehler: String(err && err.message || err) };
      if (S.screen === 'profile' && UI.profilPanel === 'tabelle') render();
    });
  }
  function tabEigenSpeichern(p, loeschen) {
    var t = tabZustand();
    if (!t.rest || !p.finish) p.finish = p.finish || { gruppen: [] };
    var eig = p.finish.eigene && typeof p.finish.eigene === 'object' ? p.finish.eigene : {};
    var teile = String(eig[t.rest] || '||').split('|');
    while (teile.length < 3) teile.push('');
    if (loeschen) teile[3 - t.darts] = '';
    else {
      var tokens = t.entwurf.filter(Boolean);
      var bleibt = t.rest - tokens.reduce(function (a, x) { return a + tokenWertApp(x); }, 0);
      teile[3 - t.darts] = tokens.map(tokenKompakt).join(' ') + (bleibt > 0 ? ' >' + bleibt : '');
    }
    if (teile.join('|') === '||') delete eig[t.rest]; else eig[t.rest] = teile.join('|');
    p.finish.eigene = eig;
    p.finish.eigeneNr = (p.finish.eigeneNr || 0) + 1;
    if (window.DartKonto) window.DartKonto.profilGeaendert(p.id);
    t.entwurf = tabWegTokens(p, t.rest, t.darts);
    t.info = null;
    tabInfoHolen(p);
    save(); render();
  }
  function prozent(x) { return Math.round(x * 100) + ' %'; }
  function aufn(x) { return x.toFixed(2).replace('.', ','); }

  function finishTabelleHtml(p, darf, eigen) {
    var t = tabZustand();
    var ld = lieblingsDoppel(p.id);
    var favs = finishFavoriten(finishGruppen(p));
    var eig = p.finish && p.finish.eigene && typeof p.finish.eigene === 'object' ? p.finish.eigene : {};
    var nEig = finishEigeneAnzahl(p);
    var farbe = function (tok) {
      var k = tokenKompakt(tok);
      if (k === 'BULL') return favs.indexOf(25) >= 0 ? 'fav' : 'dbl';
      if (k.charAt(0) === 'D') return favs.indexOf(Number(k.slice(1))) >= 0 ? 'fav' : 'dbl';
      return '';
    };
    var tokHtml = function (tok) { return '<span class="ft-tok ' + farbe(tok) + '">' + esc(tok) + '</span>'; };

    /* Liste */
    var zeilen = [];
    for (var r = MAX_CHECKOUT; r >= 2; r--) {
      var hatEigen = /[^|]/.test(String(eig[r] || ''));
      if (t.filter === 'eigene' && !hatEigen) continue;
      var w = Checkout.suggest(r, 3, ld), st = w ? null : Checkout.stellwurf(r, 3, ld);
      var toks = (w || (st && st.darts) || []).map(tokenAusKompakt);
      zeilen.push('<button class="ft-zeile' + (t.rest === r ? ' active' : '') + '" data-action="tab-rest" data-rest="' + r + '">' +
        '<span class="ft-rest">' + r + '</span><span class="ft-weg">' + toks.map(tokHtml).join('') +
        (st && st.auf ? '<span class="ft-tok auf">auf ' + st.auf + '</span>' : '') + '</span>' +
        '<span class="ft-punkt' + (hatEigen ? ' an' : '') + '"></span></button>');
    }

    /* Editor */
    var editor = '';
    if (t.rest) {
      var tokens = t.entwurf.filter(Boolean);
      var info = t.info && t.info.key === t.rest + '/' + t.darts + '/' + tokens.join(' ') ? t.info : null;
      var eigenTeil = tabEigenerTeil(p, t.rest, t.darts);
      var geaendert = tokens.join(' ') !== tabWegTokens(p, t.rest, t.darts).join(' ');
      var pr = info && info.pruefung;
      var checkText, checkKl = '';
      if (!tokens.length) { checkText = 'Felder antippen und den Weg eingeben.'; }
      else if (!info || info.laedt) { checkText = 'Wird geprüft …'; }
      else if (info.fehler) { checkText = info.fehler; checkKl = 'schlecht'; }
      else if (!pr.ok) { checkText = pr.fehler.join(', '); checkKl = 'schlecht'; }
      else {
        var v = info.vergleich;
        var bester = v.besterWeg.join(' '), gleich = bester === tokens.join(' ');
        /* "Deutlich schlechter" richtet sich nach der Spielweise: wer auf
           Aufnahmen spielt, bekommt bei weniger Aufnahmen und kleinerer
           Checkout-Chance nur den Hinweis auf die Chance. */
        var schlechtAufn = v.mehrAufnahmen > 0.05, schlechtCo = (v.checkoutBester - v.checkoutEigen) > 0.03;
        var deutlich = schlechtAufn || ((p.finish || {}).spielweise === 'checkout' && schlechtCo);
        checkText = (pr.warnungen.length ? pr.warnungen.join(', ') + '. ' : '') +
          (gleich ? 'Das ist der beste Weg laut Modell · Checkout ' + prozent(v.checkoutEigen)
            : (v.mehrAufnahmen >= 0 ? '+' : '') + aufn(v.mehrAufnahmen) + ' Aufnahmen gegenüber ' + esc(bester) +
              ' · Checkout ' + prozent(v.checkoutEigen) + ' statt ' + prozent(v.checkoutBester));
        checkKl = deutlich ? 'schlecht' : (schlechtCo || pr.warnungen.length) ? 'mittel' : 'gut';
        if (deutlich) checkText = 'Deutlich schlechter als der beste Weg. ' + checkText;
        else if (schlechtCo && !gleich) checkText = 'Geringere Checkout-Chance als der beste Weg. ' + checkText;
      }
      var slots = '';
      for (var i = 0; i < t.darts; i++) {
        slots += '<button class="ft-slot' + (i === t.slot ? ' active' : '') + (t.entwurf[i] ? '' : ' leer') + '" data-action="tab-slot" data-i="' + i + '">' +
          (t.entwurf[i] ? esc(t.entwurf[i]) : '·') + '</button>';
      }
      var altKey = t.rest + '/' + t.darts, alts = t.alts[altKey];
      var altHtml = !alts ? '' : alts.laedt ? '<span class="ft-alt-laedt">Alternativen werden gerechnet …</span>'
        : (alts.liste || []).map(function (a) {
          var wegT = a.weg.join(' ');
          return '<button class="ft-alt' + (wegT === tokens.join(' ') ? ' active' : '') + '" data-action="tab-alt" data-weg="' + esc(wegT) + '">' +
            '<b>' + esc(wegT) + (a.bleibt ? ' <small>auf ' + a.bleibt + '</small>' : '') + '</b><span>' + aufn(a.aufnahmen) + ' Aufn. · ' + prozent(a.checkout) + '</span></button>';
        }).join('');
      var pad = '';
      for (var n = 1; n <= 20; n++) pad += '<button data-action="tab-pad" data-value="' + (t.seg === 'S' ? n : t.seg + n) + '">' + n + '</button>';
      var bullT = t.seg === 'S' ? '25' : t.seg === 'D' ? 'Bull' : null;
      pad += '<button data-action="tab-pad" data-value="' + (bullT || '') + '"' + (bullT ? '' : ' disabled') + '>' + (bullT || '25') + '</button>';
      pad += '<button data-action="tab-pad" data-value="" class="leer">leer</button>';
      var darfHier = darf;
      editor = '<div class="ft-editor">' +
        '<div class="ft-links">' +
          '<div class="ft-zeile1"><span class="ft-ed-rest">' + t.rest + '</span>' +
            '<div class="dl-segment ft-darts">' + [3, 2, 1].map(function (d) {
              return '<button data-action="tab-darts" data-value="' + d + '" class="' + (t.darts === d ? 'active' : '') + '">' + d + (d === 1 ? ' Dart' : ' Darts') + '</button>';
            }).join('') + '</div></div>' +
          '<div class="ft-slots">' + slots + '</div>' +
          '<p class="ft-check ' + checkKl + '">' + checkText + '</p>' +
          '<div class="ft-alts"><span class="kt">Alternativen laut Modell</span><div class="ft-alt-liste">' + altHtml + '</div></div>' +
          (darfHier ? '<div class="ft-knoepfe">' +
            (eigenTeil ? '<button class="btn pa-btn" data-action="tab-standard">Eigenen Eintrag löschen</button>' : '') +
            '<button class="btn pa-btn hell" data-action="tab-speichern"' + (pr && pr.ok && geaendert ? '' : ' disabled') + '>Übernehmen</button>' +
          '</div>' : '') +
        '</div>' +
        (darfHier ? '<div class="ft-segs">' + [['S', 'Single'], ['D', 'Double'], ['T', 'Triple']].map(function (sg) {
            return '<button data-action="tab-seg" data-value="' + sg[0] + '" class="' + (t.seg === sg[0] ? 'active' : '') + '">' + sg[1] + '</button>';
          }).join('') + '</div>' +
          '<div class="ft-pad">' + pad + '</div>' : '') +
      '</div>';
    }

    return '<div class="pa-panel ft-panel">' +
      '<div class="pa-panel-kopf"><span class="pa-panel-titel">' + (eigen ? 'Meine Finish-Tabelle' : 'Finish-Tabelle') + '</span>' +
        '<div class="dl-segment ft-filter">' +
          '<button data-action="tab-filter" data-value="alle" class="' + (t.filter === 'alle' ? 'active' : '') + '">Alle</button>' +
          '<button data-action="tab-filter" data-value="eigene" class="' + (t.filter === 'eigene' ? 'active' : '') + '">Angepasst' + (nEig ? ' · ' + nEig : '') + '</button></div>' +
        '<button class="btn hell pa-fertig" data-action="profil-panel-zu">Fertig</button></div>' +
      editor +
      '<div class="ft-liste">' + (zeilen.join('') || '<p class="pa-text">Noch kein eigener Eintrag. Einen Rest antippen und den Weg eingeben.</p>') + '</div>' +
    '</div>';
  }

  /* Die ausfuehrlichen Karten (Scoring, Finishing, Bilanz, Cricket, Round
     the World, letzte X01-Spiele) - unveraendert aus dem alten Profil. */
  function profilStatsHtml(p, st) {
    /* Das Dashboard (Filter, Kennzahlen, Diagramme, Liga-Bilanz, weitere
       Spielarten, alle Zahlen) - dasselbe wie im Reiter Statistik › Person. */
    return statsDashboardHtml(p, { st: st });
  }

  /* ================= Spieler-Dashboard („Meine Stats“) =================
     Die Karten aus Julius' Artefakt „Darts Statistik“ (10.11.2026), gespeist
     aus den echten Aufnahmen statt aus Handeingaben: Kennzahlen mit
     Vergleich, Average-Verlauf mit gleitendem Schnitt und Trend, Form,
     Spielerprofil, Doppel-Analyse am Board, Big Scores und Doppelquote je
     Monat, Modi im Vergleich, Aktivitaet, Gegnerbilanz, Rekorde. Alles SVG
     ohne Bibliothek; die Animationen laufen einmal je Auswahl
     (statsNachRender), ein Neuzeichnen aus anderem Anlass steht still. */
  var STATS_MODI = [['alle', 'Alle'], ['liga', 'Liga'], ['turnier', 'Turnier'], ['quick', 'Schnell'], ['solo', 'Solo']];
  var STATS_MODUS_TEXT = { liga: 'Liga', turnier: 'Turnier', quick: 'Schnell', solo: 'Solo' };
  var STATS_BEREICHE = [[10, 'Letzte 10'], [30, 'Letzte 30'], [0, 'Alle Spiele']];
  var ST_FARBE = { blau: '#46aad7', gold: '#ffc14d', gruen: '#4ade80', rot: '#e5484d', lila: '#a78bfa', creme: '#f3e7c9' };
  var ST_BOARD = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  var ST_MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var STATS_TIPS = {};          // Diagramm-Kennung -> Tooltip-Text je Punkt
  var statsAnimiertFuer = '';   // Auswahl, fuer die die Animationen zuletzt liefen
  /* Spielerprofil-Netz: die Mitte jeder Achse ist der Teamschnitt mit Stand
     dieses Tages (Julius, 12.11.2026: "stand heute ein perfektes Sechseck,
     spaeter darf sich das Blaue anpassen"). Spiele ab diesem Tag veraendern
     die Skala nicht mehr, nur noch die Flaechen. */
  var ST_RADAR_STICHTAG = Date.UTC(2026, 10, 13);
  var stCrewSpieleCache = null;  // Spielreihen des Kaders, einmal je Zeichnen

  function statsFilter() {
    if (!UI.statsFilter) UI.statsFilter = { modus: 'alle', bereich: 0 };
    return UI.statsFilter;
  }
  function stFmt(v, dez) { return (v === null || v === undefined || !isFinite(v)) ? '–' : Number(v).toFixed(dez === undefined ? 1 : dez); }
  function stDatum(ts) { var d = new Date(ts); return d.getDate() + '. ' + ST_MONATE[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); }
  function stMonat(ts) { var d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function stMonatText(k) { return ST_MONATE[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(2, 4); }
  function stTag(ts) { var d = new Date(ts); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function stModusText(s) { return (STATS_MODUS_TEXT[s.modus] || '') + (s.gegner ? ' vs. ' + esc(s.gegner) : s.session ? ' · Session' : ''); }

  /* Je Doppel [Treffer, Versuche] eines Spielers in einem Spiel - dieselbe
     Zaehlung wie die Doppelquote (collectStats): ein Dart ist ein Versuch auf
     das Doppel, das der Rest vor ihm erlaubt (50 = Bull), der Finish-Dart
     ein Treffer. Einzel-Darts (v.k) dartgenau; in der Punkte-Eingabe das
     erfragte Finish-Doppel (v.dd), bei einem schon finishbaren Rest gingen
     alle Darts der Aufnahme aufs Doppel. Nur 301er und 501er zaehlen. */
  function doppelJeFeld(m, pid, start) {
    var d = {};
    var zaehl = function (key, treffer) { if (!d[key]) d[key] = [0, 0]; d[key][1]++; if (treffer) d[key][0]++; };
    (m.legs || []).forEach(function (leg) {
      var rest = typeof leg.start === 'number' ? leg.start : (start || 501);
      if (rest !== 501 && rest !== 301) return;
      (leg.visits || []).forEach(function (v) {
        if (v.p !== pid) return;
        if (v.k && v.k.length) {
          var r = rest;
          for (var i = 0; i < v.k.length; i++) {
            if (oneDartFinish(r)) zaehl(r === 50 ? '25' : String(r / 2), v.c && i === v.k.length - 1);
            r -= v.k[i].m * v.k[i].n;
          }
        } else if (v.c && v.dd) {
          var key = String(v.dd), n = v.d || 1;
          if (oneDartFinish(rest) && n > 1) {
            zaehl(rest === 50 ? '25' : String(rest / 2), false);
            for (var j = 2; j < n; j++) zaehl(key, false);
          }
          zaehl(key, true);
        }
        if (!v.b) rest -= v.s;
      });
    });
    return d;
  }

  /* Alle Classic-Spiele eines Spielers, aelteste zuerst: je Spiel Modus,
     Gegner, Legs, Sieg und die Statistik nur dieses Spiels. Dieselbe Auswahl
     wie career()/collectStats: keine Uebung, keine Testspiele, keine
     Kampflosen; Spiele gegen inzwischen geloeschte Profile zaehlen mit. */
  function spielerSpiele(pid) {
    var out = [];
    function nimm(m, start, at, modus, h) {
      if (!m || !m.done || m.kampflos || !m.p || m.p.indexOf(pid) < 0) return;
      var solo = m.p.length < 2;
      var map = collectStats([{ matches: [m], start: start }], m.p);
      var st = finalize(map[pid]);
      /* Ein Schnelles X01 kann mehr als zwei Spieler haben: dann zaehlt jedes
         fremd gewonnene Leg als verloren (wie collectStats), und der Gegner
         ist die ganze Runde. In die Gegnerbilanz kommen nur Duelle. */
      var andere = m.p.filter(function (x) { return x !== pid; });
      var gegnerId = andere.length === 1 ? andere[0] : null;
      var gewertet = (m.legs || []).filter(function (l) { return l.winner; });
      var legs = (m.legs || []).filter(function (l) { return l.winner || (l.visits && l.visits.length); }).length;
      out.push({
        id: m.id, at: m.at || at || 0, modus: solo ? 'solo' : modus, solo: solo, session: !!m.session,
        gegnerId: gegnerId, gegner: solo ? '' : andere.map(pname).join(' / '),
        team: h && h.liga && h.liga.gegner && modus === 'liga' ? String(h.liga.gegner) : '',
        legsWon: solo ? 0 : legsWon(m, pid), legsLost: solo ? 0 : gewertet.filter(function (l) { return l.winner !== pid; }).length, legs: legs,
        /* Ohne Sieger (Schnelles X01 "beenden & speichern") ist es weder
           Sieg noch Niederlage - sonst stimmte die Siegquote nicht. */
        won: solo || !m.winner ? null : m.winner === pid,
        st: st, doppel: doppelJeFeld(m, pid, start)
      });
    }
    if (S.matches.length && !(S.tour && S.tour.liga && S.tour.liga.uebung) && turnierWertbar() && !turnierSchonArchiviert()) {
      var modusLive = S.tour && S.tour.liga ? 'liga' : 'turnier';
      S.matches.forEach(function (m) { nimm(m, tourStart(), m.at, m.kind === 'quick' ? 'quick' : modusLive, S.tour); });
    }
    wertbareHistorie().forEach(function (h) {
      if (h.liga && h.liga.uebung) return;
      var kind = h.kind || '501';
      if (kind !== '501' && kind !== 'quick') return;
      var modus = h.liga ? 'liga' : kind === 'quick' ? 'quick' : 'turnier';
      (h.matches || []).forEach(function (m) { nimm(m, (h.settings && h.settings.start) || 501, h.at, m.kind === 'quick' ? 'quick' : modus, h); });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }
  function statsAuswahl(spiele, f) {
    var g = f.modus === 'alle' ? spiele : spiele.filter(function (s) { return s.modus === f.modus; });
    return f.bereich ? g.slice(-f.bereich) : g;
  }
  /* Summen ueber eine Spielreihe: Average punktgenau (Punkte durch Darts),
     Doppelquote aus Versuchen, Siegquote nur aus Spielen mit Gegner. */
  function statsSumme(spiele) {
    if (!spiele.length) return null;
    var o = { n: spiele.length, points: 0, darts: 0, f9p: 0, f9d: 0, att: 0, hits: 0, matches: 0, siege: 0,
      c100: 0, c140: 0, c180: 0, legs: 0, legsW: 0, legsL: 0, hf: 0, bl: null, avgs: [] };
    spiele.forEach(function (s) {
      var st = s.st;
      o.points += st.points; o.darts += st.darts; o.f9p += st.first9Points; o.f9d += st.first9Darts;
      o.att += st.doubleAttempts; o.hits += st.doubleHits;
      o.c100 += st.s100; o.c140 += st.s140; o.c180 += st.s180;
      o.legs += s.legs; o.legsW += s.legsWon; o.legsL += s.legsLost;
      if (st.highCO > o.hf) o.hf = st.highCO;
      if (st.bestLeg && (o.bl === null || st.bestLeg < o.bl)) o.bl = st.bestLeg;
      if (st.darts) o.avgs.push(st.avg);
      if (s.won !== null) { o.matches++; if (s.won) o.siege++; }
    });
    o.avg = o.darts ? (o.points / o.darts) * 3 : null;
    o.first9 = o.f9d ? (o.f9p / o.f9d) * 3 : null;
    o.dbl = o.att ? (o.hits / o.att) * 100 : null;
    o.win = o.matches ? (o.siege / o.matches) * 100 : null;
    var mittel = o.avgs.length ? o.avgs.reduce(function (a, b) { return a + b; }, 0) / o.avgs.length : 0;
    o.std = o.avgs.length > 1 ? Math.sqrt(o.avgs.reduce(function (a, b) { return a + (b - mittel) * (b - mittel); }, 0) / (o.avgs.length - 1)) : 0;
    o.tonsProLeg = o.legs ? (o.c100 + o.c140 + o.c180) / o.legs : 0;
    return o;
  }

  /* Das Dashboard einer Person. opts.kopf steht ueber den Filter-Chips (im
     Reiter Statistik: Wer-Karte und Spieler-Chips), opts.alle/opts.st sparen
     die doppelte Rechnung, wenn der Aufrufer sie schon hat. */
  function statsDashboardHtml(p, opts) {
    opts = opts || {};
    var f = statsFilter();
    stLigaCache = null; stCrewSpieleCache = null;
    var alle = opts.alle || spielerSpiele(p.id);
    var st = opts.st || career()[p.id] || finalize(emptyStat(p.id));
    var spiele = statsAuswahl(alle, f);
    var zaehl = {};
    alle.forEach(function (s) { zaehl[s.modus] = (zaehl[s.modus] || 0) + 1; });
    var chips = STATS_MODI.map(function (m) {
      var n = m[0] === 'alle' ? alle.length : (zaehl[m[0]] || 0);
      if (m[0] !== 'alle' && !n) return '';
      return '<button type="button" class="st-chip' + (f.modus === m[0] ? ' on' : '') + '" data-action="stats-modus" data-wert="' + m[0] + '">' + m[1] + ' <small>' + n + '</small></button>';
    }).join('') + '<span class="st-sep"></span>' + STATS_BEREICHE.map(function (b) {
      return '<button type="button" class="st-chip' + (f.bereich === b[0] ? ' on' : '') + '" data-action="stats-bereich" data-wert="' + b[0] + '">' + b[1] + '</button>';
    }).join('');
    STATS_TIPS = {};
    /* Reihenfolge fuellt das Raster (3 Spalten am Computer): Average breit,
       dann Form / Profil / Big Scores, Doppel breit, Aktivitaet (2) neben der
       Doppelquote, Gegner breit, Modi neben den Spielarten (2), Liga-Bilanz
       neben den Rekorden (2), alle Zahlen breit. */
    var karten = (!spiele.length ? '<p class="st-leer">Keine Spiele in dieser Auswahl.</p>' :
      stAvgKarte(spiele) + stFormKarte(spiele) + stRadarKarte(p, spiele, f) + stBigKarte(spiele) + stDoppelKarte(p, spiele) +
      stKalenderKarte(alle, f) + stDblTrendKarte(spiele) + stGegnerKarte(spiele) + stModiKarte(alle, f)) +
      stSpielartenKarte(p, st) + stLigaBilanzKarte(p) + (spiele.length ? stRekordKarte(spiele) : '') + stZahlenKarte(p, st);
    return '<div class="st-dash" data-spiele="' + alle.length + '">' + (opts.kopf || '') +
      '<div class="st-chips">' + chips + '</div>' +
      (spiele.length ? stKpisHtml(spiele) : '') +
      '<div class="st-raster">' + karten + '</div></div>';
  }

  /* Sieben Kennzahlen; darunter klein, wie die letzten zehn Spiele gegen
     die davor stehen („vs. letzte 10“, erst ab elf Spielen). Die Zahl steht
     schon am Ziel, das Hochzaehlen (stZaehlen) startet sie bei null. */
  function stKpisHtml(spiele) {
    var s = statsSumme(spiele);
    if (!s) return '';
    var a = spiele.length > 10 ? statsSumme(spiele.slice(-10)) : null, b = a ? statsSumme(spiele.slice(0, -10)) : null;
    function delta(key, dez, kleinerBesser) {
      if (!a || !b || a[key] === null || b[key] === null || a[key] === undefined || b[key] === undefined) return '';
      var d = a[key] - b[key], gut = kleinerBesser ? d < 0 : d > 0;
      var cls = Math.abs(d) < 0.05 ? '' : gut ? 'auf' : 'ab';
      return '<span class="' + cls + '">' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(dez) + '</span> vs. letzte 10';
    }
    var kpis = [
      ['Ø 3-Dart-Average', s.avg, 1, '', ST_FARBE.blau, delta('avg', 1)],
      ['First 9', s.first9, 1, '', ST_FARBE.lila, delta('first9', 1)],
      ['Doppelquote', s.dbl, 1, ' %', ST_FARBE.gruen, s.att ? (delta('dbl', 1) || s.hits + ' von ' + s.att) : ''],
      ['Siegquote', s.win, 0, ' %', ST_FARBE.gold, plural(s.matches, 'Spiel mit Gegner', 'Spiele mit Gegner')],
      ['180er', s.c180, 0, '', ST_FARBE.rot, s.c140 + '× 140+ · ' + s.c100 + '× 100+'],
      ['Höchstes Finish', s.hf || null, 0, '', ST_FARBE.creme, plural(s.n, 'Spiel', 'Spiele') + ' · ' + plural(s.legs, 'Leg', 'Legs')],
      ['Bestes Leg', s.bl, 0, ' Darts', ST_FARBE.gruen, 'kürzestes 501er-Leg']
    ];
    return stKpiHtml(kpis);
  }

  function stKarte(id, titel, sub, inhalt, breit) {
    return '<div class="st-karte' + (breit === 'zwei' ? ' zwei' : breit ? ' breit' : '') + '" id="st-' + id + '"><h3>' + titel + '</h3>' + (sub ? '<p class="st-sub">' + sub + '</p>' : '') + '<div class="st-box">' + inhalt + '</div></div>';
  }
  /* Pfad durch Punkte; null unterbricht die Linie. */
  function stLinie(pts) {
    var d = '', neu = true;
    pts.forEach(function (p) { if (!p) { neu = true; return; } d += (neu ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); neu = false; });
    return d;
  }
  function stQuoteFarbe(q) {
    var stops = [[0, [229, 72, 77]], [0.22, [255, 193, 77]], [0.45, [74, 222, 128]]];
    if (q >= 0.45) return 'rgb(74,222,128)';
    var a = stops[0], b = stops[1];
    if (q > 0.22) { a = stops[1]; b = stops[2]; }
    var t = (q - a[0]) / (b[0] - a[0]);
    return 'rgb(' + a[1].map(function (c, i) { return Math.round(c + (b[1][i] - c) * t); }).join(',') + ')';
  }
  function stMonate(spiele) {
    var m = {};
    spiele.forEach(function (s) { var k = stMonat(s.at); (m[k] = m[k] || []).push(s); });
    return Object.keys(m).sort().map(function (k) { return { k: k, gs: m[k] }; });
  }

  /* Average je Spiel, gleitender Schnitt ueber 5, Trend (kleinste Quadrate),
     First 9 als duenne Linie, bester Punkt in Gold. */
  function stAvgKarte(spiele) {
    var titel = 'Average-Entwicklung', sub = '3-Dart-Average je Spiel, gleitender Schnitt über 5 Spiele und Trendlinie';
    var gs = spiele.filter(function (s) { return s.st.darts > 0; });
    if (gs.length < 2) return stKarte('avg', titel, sub, '<p class="st-leer">Mindestens 2 Spiele mit Würfen nötig.</p>', true);
    /* Am Handy ein schmaleres Bild: das SVG skaliert auf die Kartenbreite,
       bei 640 Einheiten waere die Schrift dort nur halb so gross. */
    var schmal = window.innerWidth < 700;
    var W = schmal ? 380 : 640, H = schmal ? 230 : 250, L = 36, R = 14, T = 18, B = 26, n = gs.length;
    var v = gs.map(function (s) { return s.st.avg; });
    var f9 = gs.map(function (s) { return s.st.first9Darts ? s.st.first9 : null; });
    var roll = v.map(function (_, i) { var t = v.slice(Math.max(0, i - 4), i + 1); return t.reduce(function (a, b) { return a + b; }, 0) / t.length; });
    var alle = v.concat(f9.filter(function (q) { return q !== null; }));
    var lo = Math.floor(Math.min.apply(null, alle) - 3), hi = Math.ceil(Math.max.apply(null, alle) + 3);
    if (hi - lo < 6) hi = lo + 6;
    var x = function (i) { return L + i * (W - L - R) / (n - 1); }, y = function (val) { return T + (hi - val) * (H - T - B) / (hi - lo); };
    var schritt = Math.max(2, Math.round((hi - lo) / 5)), grid = '';
    for (var t = Math.ceil(lo / schritt) * schritt; t <= hi; t += schritt) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="st-gl"/><text x="' + (L - 6) + '" y="' + (y(t) + 3).toFixed(1) + '" text-anchor="end" class="st-ax">' + t + '</text>';
    var achse = [0, Math.floor((n - 1) / 2), n - 1].map(function (i, j) { return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (j === 0 ? 'start' : j === 2 ? 'end' : 'middle') + '" class="st-ax">' + stDatum(gs[i].at) + '</text>'; }).join('');
    var pV = v.map(function (val, i) { return [x(i), y(val)]; });
    var flaeche = '<path d="' + stLinie(pV) + 'L' + x(n - 1).toFixed(1) + ' ' + (H - B) + 'L' + x(0).toFixed(1) + ' ' + (H - B) + 'Z" fill="url(#st-ga)" class="st-fade"/>';
    var f9Pfad = f9.some(function (q) { return q !== null; }) ? '<path d="' + stLinie(f9.map(function (q, i) { return q === null ? null : [x(i), y(q)]; })) + '" fill="none" stroke="' + ST_FARBE.lila + '" stroke-width="1.4" opacity=".55" class="st-draw" style="transition-delay:150ms"/>' : '';
    var mx = (n - 1) / 2, my = v.reduce(function (a, c) { return a + c; }, 0) / n, zae = 0, nen = 0;
    v.forEach(function (val, i) { zae += (i - mx) * (val - my); nen += (i - mx) * (i - mx); });
    var steig = nen ? zae / nen : 0, ab = my - steig * mx, gewinn = steig * (n - 1);
    var best = v.indexOf(Math.max.apply(null, v));
    var punkte = v.map(function (val, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(val).toFixed(1) + '" r="' + (i === best ? 5 : 2.6) + '" fill="' + (i === best ? ST_FARBE.gold : ST_FARBE.blau) + '" stroke="#0d0a0b" stroke-width="1.5" class="st-pt" style="animation-delay:' + Math.round(400 + i * 1400 / n) + 'ms"/>'; }).join('');
    STATS_TIPS.avg = gs.map(function (s, i) { return '<b>' + stDatum(s.at) + '</b> · ' + stModusText(s) + '<br>Ø ' + s.st.avg.toFixed(1) + (s.st.first9Darts ? ' · First 9 ' + s.st.first9.toFixed(1) : '') + '<br>Schnitt (5): ' + roll[i].toFixed(1) + (s.won !== null ? '<br>Legs ' + s.legsWon + ' : ' + s.legsLost : ''); });
    var svg = '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '" data-st-chart="avg" data-l="' + L + '" data-r="' + R + '" data-w="' + W + '" data-n="' + n + '">' +
      '<defs><linearGradient id="st-ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ST_FARBE.blau + '" stop-opacity=".35"/><stop offset="1" stop-color="' + ST_FARBE.blau + '" stop-opacity="0"/></linearGradient></defs>' +
      grid + achse + flaeche + f9Pfad +
      '<path d="' + stLinie(pV) + '" fill="none" stroke="' + ST_FARBE.blau + '" stroke-width="1.6" opacity=".8" class="st-draw"/>' +
      '<path d="M' + x(0).toFixed(1) + ' ' + y(ab).toFixed(1) + 'L' + x(n - 1).toFixed(1) + ' ' + y(ab + steig * (n - 1)).toFixed(1) + '" stroke="' + ST_FARBE.rot + '" stroke-width="1.6" stroke-dasharray="5 5" fill="none" class="st-fade st-trend" style="animation-delay:1.2s"/>' +
      '<path d="' + stLinie(roll.map(function (q, i) { return [x(i), y(q)]; })) + '" fill="none" stroke="' + ST_FARBE.gold + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="st-draw st-glanz" style="transition-delay:300ms"/>' +
      punkte +
      '<text x="' + x(best).toFixed(1) + '" y="' + (y(v[best]) - 10).toFixed(1) + '" text-anchor="' + (x(best) > W - 70 ? 'end' : x(best) < L + 40 ? 'start' : 'middle') + '" fill="' + ST_FARBE.gold + '" font-size="11" font-weight="700" class="st-fade" style="animation-delay:1.6s">Best ' + v[best].toFixed(1) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (T + 4) + '" text-anchor="end" fill="' + (gewinn >= 0 ? ST_FARBE.gruen : ST_FARBE.rot) + '" font-size="12" font-weight="700" class="st-fade" style="animation-delay:1.4s">Trend ' + (gewinn >= 0 ? '+' : '') + gewinn.toFixed(1) + ' Punkte</text>' +
      '<line class="st-cursor" y1="' + T + '" y2="' + (H - B) + '" stroke="#ffffff40" stroke-dasharray="3 3" opacity="0"/>' +
      '<rect x="' + L + '" y="0" width="' + (W - L - R) + '" height="' + H + '" fill="transparent"/></svg>';
    var legende = '<div class="st-legende"><span><i style="background:' + ST_FARBE.blau + '"></i>Ø je Spiel</span><span><i style="background:' + ST_FARBE.gold + '"></i>Gleitender Schnitt (5)</span><span><i style="background:' + ST_FARBE.rot + '"></i>Trend</span><span><i style="background:' + ST_FARBE.lila + '"></i>First 9</span></div>';
    return stKarte('avg', titel, sub, svg + legende, true);
  }

  /* Siegquote als Ring, Bilanz, Serien, die letzten zehn als Pillen. */
  function stFormKarte(spiele) {
    var titel = 'Form & Siegquote', sub = 'Spiele mit Gegner';
    var m = spiele.filter(function (s) { return s.won !== null; });
    if (!m.length) return stKarte('form', titel, sub, '<p class="st-leer">Noch keine Spiele mit Gegner.</p>');
    var siege = m.filter(function (s) { return s.won; }).length, q = siege / m.length, C = 2 * Math.PI * 52;
    var lauf = 0, beste = 0;
    m.forEach(function (s) { if (s.won) { lauf++; if (lauf > beste) beste = lauf; } else lauf = 0; });
    var akt = 0, aktW = null;
    for (var i = m.length - 1; i >= 0; i--) { if (aktW === null) aktW = m[i].won; if (m[i].won === aktW) akt++; else break; }
    var lw = sum(m, function (s) { return s.legsWon; }), ll = sum(m, function (s) { return s.legsLost; });
    var ring = '<svg viewBox="0 0 130 130" class="st-ringsvg"><circle cx="65" cy="65" r="52" fill="none" stroke="#ffffff10" stroke-width="12"/>' +
      '<circle cx="65" cy="65" r="52" fill="none" stroke="' + (q >= 0.5 ? ST_FARBE.gruen : ST_FARBE.gold) + '" stroke-width="12" stroke-linecap="round" transform="rotate(-90 65 65)" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - q)).toFixed(1) + '" class="st-ring" data-voll="' + C.toFixed(1) + '"/>' +
      '<text x="65" y="74" text-anchor="middle" fill="#f2eeee" font-size="28" class="st-ringzahl" data-zahl="' + (q * 100) + '" data-dez="0" data-suf=" %">' + Math.round(q * 100) + ' %</text></svg>';
    var pillen = m.slice(-10).map(function (s, i) {
      var tip = '<b>' + stDatum(s.at) + '</b>' + (s.gegner ? ' vs. ' + esc(s.gegner) : '') + '<br>' + s.legsWon + ' : ' + s.legsLost + (s.st.darts ? ' · Ø ' + s.st.avg.toFixed(1) : '');
      return '<span class="st-pill ' + (s.won ? 'w' : 'l') + '" style="animation-delay:' + (300 + i * 70) + 'ms" data-tip="' + esc(tip) + '">' + (s.won ? 'S' : 'N') + '</span>';
    }).join('');
    var text = '<div class="st-ringtxt"><div class="gross">' + siege + ' : ' + (m.length - siege) + '</div><div>Siege : Niederlagen</div>' +
      '<div class="luft">Legs ' + lw + ' : ' + ll + (lw + ll ? ' (' + Math.round(lw / (lw + ll) * 100) + ' %)' : '') + '</div>' +
      '<div>Aktuell: <b style="color:' + (aktW ? ST_FARBE.gruen : ST_FARBE.rot) + '">' + akt + ' ' + (aktW ? (akt > 1 ? 'Siege' : 'Sieg') : (akt > 1 ? 'Niederlagen' : 'Niederlage')) + ' in Folge</b></div>' +
      '<div>Längste Siegesserie: <b style="color:' + ST_FARBE.gold + '">' + beste + '</b></div></div>';
    return stKarte('form', titel, sub, '<div class="st-ringwrap">' + ring + text + '</div><p class="st-sub">Letzte 10 Spiele</p><div class="st-pillen">' + pillen + '</div>');
  }

  /* Spielreihen aller Kader-Spieler, einmal je Zeichnen. */
  function stCrewSpiele() {
    if (!stCrewSpieleCache) stCrewSpieleCache = statsCrew().map(function (p) { return { p: p, spiele: spielerSpiele(p.id) }; });
    return stCrewSpieleCache;
  }
  /* Die sechs Werte einer Summe: Average, First 9, Doppelquote, Streuung
     der Averages (kleiner ist besser), Big Scores je Leg, Siegquote. */
  var ST_RADAR = [
    ['Scoring', function (s) { return s.avg; }, 30, false, function (v) { return v.toFixed(1); }],
    ['First 9', function (s) { return s.first9; }, 30, false, function (v) { return v.toFixed(1); }],
    ['Doppel', function (s) { return s.dbl; }, 50, false, function (v) { return v.toFixed(1) + ' %'; }],
    ['Konstanz', function (s) { return s.avgs.length > 1 ? s.std : null; }, 14, true, function (v) { return '±' + v.toFixed(1); }],
    ['Big Scores', function (s) { return s.legs ? s.tonsProLeg : null; }, 3, false, function (v) { return v.toFixed(1) + ' je Leg'; }],
    ['Siege', function (s) { return s.win; }, 100, false, function (v) { return v.toFixed(0) + ' %'; }]
  ];
  /* Je Achse der Mittelwert ueber die Spieler (jeder zaehlt gleich). */
  function stRadarMittel(summen) {
    return ST_RADAR.map(function (a) {
      var w = summen.map(function (s) { return s ? a[1](s) : null; }).filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
      return w.length ? w.reduce(function (x, y) { return x + y; }, 0) / w.length : null;
    });
  }
  /* Spieler (rot) gegen den Schnitt der anderen im Team (blau). Die Mitte
     des Netzes ist der Teamschnitt zum Stichtag, die Skala je Achse fest -
     so bleibt sichtbar, wenn sich das Team als Ganzes bewegt. */
  function stRadarKarte(p, spiele, f) {
    var titel = 'Spielerprofil', sub = esc(p.name) + ' in Rot, der Schnitt der anderen im Team in Blau. Netzmitte: Teamschnitt, Stand 12. Nov. 26.';
    if (spiele.length < 2) return stKarte('radar', titel, sub, '<p class="st-leer">Mindestens 2 Spiele nötig.</p>');
    /* Beides ohne den Spieler selbst: so ist der Rest des Teams heute ein
       regelmaessiges Sechseck, und was danach kommt, verschiebt es. */
    var rest = stCrewSpiele().filter(function (r) { return r.p.id !== p.id; });
    var mein = statsSumme(spiele);
    var andere = stRadarMittel(rest.map(function (r) { return statsSumme(statsAuswahl(r.spiele, f)); }));
    var basis = stRadarMittel(rest.map(function (r) { return statsSumme(r.spiele.filter(function (s) { return s.at < ST_RADAR_STICHTAG; })); }));
    var werte = function (vals) {
      return ST_RADAR.map(function (a, i) {
        var v = vals[i], b = basis[i] !== null ? basis[i] : andere[i];
        if (v === null || v === undefined || !isFinite(v)) return 0.5;
        if (b === null) return 0.5;
        var r = 0.5 + (a[3] ? b - v : v - b) / a[2];
        return Math.max(0.06, Math.min(1, r));
      });
    };
    var meinW = ST_RADAR.map(function (a) { return a[1](mein); }), hatAndere = andere.some(function (v) { return v !== null; });
    var L = ST_RADAR.map(function (a) { return a[0]; });
    var W = 340, H = 292, cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 38;
    var ang = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / 6; };
    var pt = function (i, r) { return [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r]; };
    var netz = [0.25, 0.5, 0.75, 1].map(function (f) { return '<polygon points="' + L.map(function (_, i) { return pt(i, R * f).map(function (c) { return c.toFixed(1); }).join(','); }).join(' ') + '" fill="' + (f === 1 ? '#ffffff05' : 'none') + '" stroke="#ffffff14"/>'; }).join('');
    var achsen = L.map(function (l, i) {
      var p = pt(i, R), t = pt(i, R + 20);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="#ffffff14"/>' +
        '<text x="' + t[0].toFixed(1) + '" y="' + (t[1] + 4).toFixed(1) + '" text-anchor="' + (Math.abs(t[0] - cx) < 5 ? 'middle' : t[0] > cx ? 'start' : 'end') + '" fill="#9a8f90" font-size="11" font-weight="600">' + l + '</text>';
    }).join('');
    var reihen = hatAndere ? [[werte(andere), ST_FARBE.blau, 0], [werte(meinW), ST_FARBE.rot, 250]] : [[werte(meinW), ST_FARBE.rot, 0]];
    var flaechen = reihen.map(function (e) {
      var vals = e[0];
      return '<g class="st-growR" style="animation-delay:' + e[2] + 'ms"><polygon points="' + vals.map(function (v, i) { var a = ang(i); return (Math.cos(a) * R * v).toFixed(1) + ',' + (Math.sin(a) * R * v).toFixed(1); }).join(' ') + '" fill="' + e[1] + '" fill-opacity=".18" stroke="' + e[1] + '" stroke-width="2.2" stroke-linejoin="round"/>' +
        vals.map(function (v, i) { var a = ang(i); return '<circle cx="' + (Math.cos(a) * R * v).toFixed(1) + '" cy="' + (Math.sin(a) * R * v).toFixed(1) + '" r="3.2" fill="' + e[1] + '"/>'; }).join('') + '</g>';
    }).join('');
    var fmt = function (i, v) { return v === null || v === undefined || !isFinite(v) ? '–' : ST_RADAR[i][4](v); };
    STATS_TIPS.radar = L.map(function (l, i) {
      return '<b>' + l + '</b><br><span style="color:' + ST_FARBE.rot + '">' + esc(p.name) + ': ' + fmt(i, meinW[i]) + '</span>' +
        (hatAndere ? '<br><span style="color:' + ST_FARBE.blau + '">Rest des Teams: ' + fmt(i, andere[i]) + '</span>' : '') +
        (basis[i] !== null ? '<br>Teamschnitt 12.11.: ' + fmt(i, basis[i]) : '');
    });
    var svg = '<svg class="st-svg st-radar" viewBox="0 0 ' + W + ' ' + H + '" data-st-chart="radar" data-cx="' + cx + '" data-cy="' + cy + '" data-w="' + W + '" data-h="' + H + '">' + netz + achsen + '<g transform="translate(' + cx + ' ' + cy + ')">' + flaechen + '</g></svg>';
    var legende = '<div class="st-legende"><span><i style="background:' + ST_FARBE.rot + '"></i>' + esc(p.name) + '</span>' + (hatAndere ? '<span><i style="background:' + ST_FARBE.blau + '"></i>Rest des Teams</span>' : '') + '</div>';
    return stKarte('radar', titel, sub, svg + legende);
  }

  /* Das Board: der aeussere Ring traegt je Doppel die Quote als Farbe, ★ ist
     die Finish-Kette des Spielers (Lieblingsgruppen aus dem Profil, sonst
     die 16er-Kette). Rechts die neun meistgeworfenen Doppel als Balken. */
  function stDoppelKarte(p, spiele) {
    var d = {};
    spiele.forEach(function (s) { Object.keys(s.doppel).forEach(function (k) { if (!d[k]) d[k] = [0, 0]; d[k][0] += s.doppel[k][0]; d[k][1] += s.doppel[k][1]; }); });
    var keys = Object.keys(d).filter(function (k) { return d[k][1] > 0; });
    var favs = finishFavoriten(finishGruppen(p)).map(String);
    if (!favs.length) favs = ['16', '8', '4', '2', '1'];
    var favText = favs.map(function (k) { return k === '25' ? 'Bull' : 'D' + k; }).join(', ');
    var titel = 'Doppel-Analyse', sub = 'Trefferquote je Doppel in 301 und 501. Grün = stark, Rot = Baustelle. ★ = Finish-Kette ' + favText;
    if (!keys.length) return stKarte('doppel', titel, sub, '<p class="st-leer">Noch kein Dart auf ein Doppel erfasst. Gezählt werden Einzel-Darts und das Finish-Doppel aus der Punkte-Eingabe.</p>', true);
    var size = 320, c = size / 2, R = size / 2 / 1.17;
    var P = function (r, a) { return [c + r * Math.sin(a), c - r * Math.cos(a)]; };
    var fx = function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); };
    var seg = function (r0, r1, a0, a1) { return 'M' + fx(P(r1, a0)) + 'A' + r1.toFixed(1) + ' ' + r1.toFixed(1) + ' 0 0 1 ' + fx(P(r1, a1)) + 'L' + fx(P(r0, a1)) + 'A' + r0.toFixed(1) + ' ' + r0.toFixed(1) + ' 0 0 0 ' + fx(P(r0, a0)) + 'Z'; };
    var felder = '', ringe = '', texte = '', treffer = '';
    ST_BOARD.forEach(function (n, i) {
      var a0 = (i * 18 - 9) * Math.PI / 180, a1 = (i * 18 + 9) * Math.PI / 180, alt = i % 2;
      felder += '<path d="' + seg(R * 0.1, R * 0.58, a0, a1) + '" fill="' + (alt ? '#1e1719' : '#171213') + '"/><path d="' + seg(R * 0.58, R * 0.64, a0, a1) + '" fill="' + (alt ? '#2a3a2f' : '#3a2629') + '"/><path d="' + seg(R * 0.64, R * 0.93, a0, a1) + '" fill="' + (alt ? '#1e1719' : '#171213') + '"/>';
      var v = d[String(n)], q = v && v[1] ? v[0] / v[1] : null, fav = favs.indexOf(String(n)) >= 0;
      ringe += '<path d="' + seg(R * 0.93, R, a0, a1) + '" fill="' + (q === null ? '#2a2224' : stQuoteFarbe(q)) + '" stroke="#0d0a0b" stroke-width=".8" class="st-fade" style="animation-delay:' + (500 + i * 45) + 'ms"/>';
      var tp = P(R * 1.075, (a0 + a1) / 2);
      texte += '<text x="' + tp[0].toFixed(1) + '" y="' + (tp[1] + 4).toFixed(1) + '" text-anchor="middle" fill="' + (fav ? ST_FARBE.gold : '#9fb0c4') + '" font-size="' + (R * 0.085).toFixed(1) + '" font-weight="' + (fav ? 800 : 600) + '">' + n + '</text>';
      treffer += '<path d="' + seg(R * 0.58, R * 1.13, a0, a1) + '" fill="transparent" data-tip="' + esc('<b>D' + n + (fav ? ' ★' : '') + '</b><br>' + (v ? (q * 100).toFixed(1) + ' % (' + v[0] + ' von ' + v[1] + ')' : 'noch nicht geworfen')) + '"/>';
    });
    var bv = d['25'], bq = bv && bv[1] ? bv[0] / bv[1] : null;
    var bull = '<circle cx="' + c + '" cy="' + c + '" r="' + (R * 0.1).toFixed(1) + '" fill="#4ade8055"/>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (R * 0.05).toFixed(1) + '" fill="' + (bq === null ? '#2a2224' : stQuoteFarbe(bq)) + '" stroke="#0d0a0b" class="st-fade" style="animation-delay:1.4s" data-tip="' + esc('<b>Bull</b><br>' + (bv ? (bq * 100).toFixed(1) + ' % (' + bv[0] + ' von ' + bv[1] + ')' : 'noch nicht geworfen')) + '"/>';
    var svg = '<svg class="st-svg st-board" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + c + '" cy="' + c + '" r="' + (R * 1.16).toFixed(1) + '" fill="#110d0e" stroke="#2a2224"/><g class="st-growR st-boardfelder">' + felder + '</g>' + ringe + bull + texte + treffer + '</svg>';
    var sortiert = keys.sort(function (a, b) { return d[b][1] - d[a][1]; }).slice(0, 9);
    var favQ = favs.reduce(function (acc, k) { return [acc[0] + (d[k] ? d[k][0] : 0), acc[1] + (d[k] ? d[k][1] : 0)]; }, [0, 0]);
    var balken = '<div class="st-brow"><div class="t"><b class="fav">★ Finish-Kette gesamt</b><span>' + (favQ[1] ? (favQ[0] / favQ[1] * 100).toFixed(1) + ' % · ' + favQ[0] + '/' + favQ[1] : '–') + '</span></div>' +
      '<div class="st-track"><div class="st-fill" data-w="' + (favQ[1] ? Math.min(100, favQ[0] / favQ[1] * 100 / 0.6).toFixed(1) : 0) + '" style="background:linear-gradient(90deg,' + ST_FARBE.gold + ',#ff9f3d)"></div></div></div>' +
      sortiert.map(function (k) {
        var h = d[k][0], a = d[k][1], q = h / a, fav = favs.indexOf(k) >= 0;
        return '<div class="st-brow"><div class="t"><b class="' + (fav ? 'fav' : '') + '">' + (k === '25' ? 'Bull' : 'D' + k) + (fav ? ' ★' : '') + '</b><span>' + (q * 100).toFixed(1) + ' % · ' + h + '/' + a + '</span></div>' +
          '<div class="st-track"><div class="st-fill" data-w="' + Math.min(100, q * 100 / 0.6).toFixed(1) + '" style="background:' + stQuoteFarbe(q) + '"></div></div></div>';
      }).join('') +
      '<p class="st-note">Balkenlänge: 60 % Quote = voller Balken. Sortiert nach Anzahl Darts.</p>';
    return stKarte('doppel', titel, sub, '<div class="st-dbl"><div class="st-dbl-board">' + svg + '</div><div class="st-dbl-bars">' + balken + '</div></div>', true);
  }

  /* Gestapelte Balken je Monat: 100+, 140+, 180. */
  function stBigKarte(spiele) {
    var titel = 'Big Scores je Monat', sub = 'Aufnahmen 100+, 140+ und 180 je Monat';
    var ms = stMonate(spiele).slice(-8);
    if (!ms.length) return stKarte('big', titel, sub, '<p class="st-leer">Keine Daten.</p>');
    var data = ms.map(function (e) { return { k: e.k, a: sum(e.gs, function (s) { return s.st.s100; }), b: sum(e.gs, function (s) { return s.st.s140; }), c: sum(e.gs, function (s) { return s.st.s180; }), n: e.gs.length }; });
    var W = 340, H = 230, L = 30, R = 8, T = 12, B = 24, max = Math.max(1, Math.max.apply(null, data.map(function (q) { return q.a + q.b + q.c; })));
    var y = function (v) { return T + (1 - v / max) * (H - T - B); }, bw = (W - L - R) / data.length;
    var grid = [0, 0.5, 1].map(function (f) { var v = Math.round(max * f); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="st-gl"/><text x="' + (L - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end" class="st-ax">' + v + '</text>'; }).join('');
    var balken = data.map(function (q, i) {
      var x = L + i * bw + bw * 0.18, ww = bw * 0.64, basis = 0, rects = '';
      [['a', ST_FARBE.blau], ['b', ST_FARBE.gold], ['c', ST_FARBE.rot]].forEach(function (e) {
        if (!q[e[0]]) return;
        rects += '<rect x="' + x.toFixed(1) + '" y="' + y(basis + q[e[0]]).toFixed(1) + '" width="' + ww.toFixed(1) + '" height="' + (y(basis) - y(basis + q[e[0]])).toFixed(1) + '" fill="' + e[1] + '"/>';
        basis += q[e[0]];
      });
      return (rects ? '<g class="st-growY" style="animation-delay:' + (i * 90) + 'ms">' + rects + '</g>' : '') +
        '<text x="' + (x + ww / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="st-ax">' + stMonatText(q.k) + '</text>' +
        '<rect x="' + (L + i * bw).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" data-tip="' + esc('<b>' + stMonatText(q.k) + '</b> · ' + plural(q.n, 'Spiel', 'Spiele') + '<br>100+: ' + q.a + '<br>140+: ' + q.b + '<br>180: ' + q.c) + '"/>';
    }).join('');
    var legende = '<div class="st-legende"><span><i style="background:' + ST_FARBE.blau + '"></i>100 bis 139</span><span><i style="background:' + ST_FARBE.gold + '"></i>140 bis 179</span><span><i style="background:' + ST_FARBE.rot + '"></i>180</span></div>';
    return stKarte('big', titel, sub, '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '">' + grid + balken + '</svg>' + legende);
  }

  /* Doppelquote je Monat als weiche Kurve (Catmull-Rom). */
  function stDblTrendKarte(spiele) {
    var titel = 'Doppelquote im Verlauf', sub = 'Quote je Monat in Prozent';
    var ms = stMonate(spiele).map(function (e) {
      var a = sum(e.gs, function (s) { return s.st.doubleAttempts; }), h = sum(e.gs, function (s) { return s.st.doubleHits; });
      return { k: e.k, q: a ? h / a * 100 : null, a: a, h: h };
    }).filter(function (q) { return q.q !== null; }).slice(-8);
    if (ms.length < 2) return stKarte('dbltrend', titel, sub, '<p class="st-leer">Mindestens 2 Monate mit Doppel-Daten nötig.</p>');
    var W = 340, H = 230, L = 30, R = 14, T = 20, B = 24;
    var max = Math.ceil(Math.max.apply(null, ms.map(function (q) { return q.q; })) / 10) * 10 + 5;
    var min = Math.max(0, Math.floor(Math.min.apply(null, ms.map(function (q) { return q.q; })) / 10) * 10 - 5);
    var x = function (i) { return L + i * (W - L - R) / (ms.length - 1); }, y = function (v) { return T + (max - v) * (H - T - B) / (max - min); };
    var grid = '';
    for (var t = min; t <= max; t += 10) grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="st-gl"/><text x="' + (L - 6) + '" y="' + (y(t) + 3).toFixed(1) + '" text-anchor="end" class="st-ax">' + t + '</text>';
    var pts = ms.map(function (q, i) { return [x(i), y(q.q)]; }), dd = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      dd += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    var punkte = ms.map(function (q, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(q.q).toFixed(1) + '" r="5" fill="#0d0a0b" stroke="' + ST_FARBE.gruen + '" stroke-width="2.5" class="st-pt" style="animation-delay:' + (300 + i * 160) + 'ms"/>' +
        '<text x="' + x(i).toFixed(1) + '" y="' + (y(q.q) - 11).toFixed(1) + '" text-anchor="middle" fill="#f2eeee" font-size="10" font-weight="700" class="st-fade" style="animation-delay:' + (500 + i * 160) + 'ms">' + q.q.toFixed(0) + '</text>' +
        '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="st-ax">' + stMonatText(q.k) + '</text>' +
        '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(q.q).toFixed(1) + '" r="16" fill="transparent" data-tip="' + esc('<b>' + stMonatText(q.k) + '</b><br>' + q.q.toFixed(1) + ' % (' + q.h + ' von ' + q.a + ')') + '"/>';
    }).join('');
    var svg = '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="st-gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ST_FARBE.gruen + '" stop-opacity=".4"/><stop offset="1" stop-color="' + ST_FARBE.gruen + '" stop-opacity="0"/></linearGradient></defs>' + grid +
      '<path d="' + dd + 'L' + x(ms.length - 1).toFixed(1) + ' ' + (H - B) + 'L' + x(0).toFixed(1) + ' ' + (H - B) + 'Z" fill="url(#st-gd)" class="st-fade"/>' +
      '<path d="' + dd + '" fill="none" stroke="' + ST_FARBE.gruen + '" stroke-width="3" stroke-linecap="round" class="st-draw"/>' + punkte + '</svg>';
    return stKarte('dbltrend', titel, sub, svg);
  }

  /* Liga, Turnier, Schnell, Solo nebeneinander - unabhaengig vom Modus-Filter,
     der Zeitraum gilt. */
  function stModiKarte(alle, f) {
    var titel = 'Liga · Turnier · Schnell · Solo';
    var gs = f.bereich ? alle.slice(-f.bereich) : alle;
    var sub = 'Average, Doppelquote und Siegquote je Modus' + (f.bereich ? ' (letzte ' + f.bereich + ' Spiele)' : '');
    var zeilen = STATS_MODI.slice(1).map(function (m) { return { m: m[0], t: m[1], s: statsSumme(gs.filter(function (s) { return s.modus === m[0]; })) }; }).filter(function (r) { return r.s; });
    if (!zeilen.length) return stKarte('modi', titel, sub, '<p class="st-leer">Keine Daten.</p>');
    var maxAvg = Math.max.apply(null, zeilen.map(function (r) { return r.s.avg || 0; })) || 1;
    var farbe = { liga: ST_FARBE.blau, turnier: ST_FARBE.gold, quick: ST_FARBE.gruen, solo: ST_FARBE.lila };
    var html = zeilen.map(function (r) {
      return '<div class="st-mrow"><div class="h">' + r.t + '<span>' + plural(r.s.n, 'Spiel', 'Spiele') + '</span></div>' +
        [['Average', r.s.avg, maxAvg * 1.05, 1, ''], ['Doppel', r.s.dbl, 60, 1, ' %'], ['Siege', r.s.win, 100, 0, ' %']].map(function (e) {
          return '<div class="st-mbar">' + e[0] + '<div class="st-track"><div class="st-fill" data-w="' + (e[1] === null ? 0 : Math.min(100, e[1] / e[2] * 100).toFixed(1)) + '" style="background:' + farbe[r.m] + '"></div></div><b>' + (e[1] === null ? '–' : e[1].toFixed(e[3]) + e[4]) + '</b></div>';
        }).join('') + '</div>';
    }).join('');
    return stKarte('modi', titel, sub, html);
  }

  /* 20 Wochen als Kacheln, je Tag die Zahl der Spiele - der Modus-Filter gilt,
     der Zeitraum nicht. */
  function stKalenderKarte(alle, f) {
    var gs = f.modus === 'alle' ? alle : alle.filter(function (s) { return s.modus === f.modus; });
    var cnt = {};
    gs.forEach(function (s) { var k = stTag(s.at); cnt[k] = (cnt[k] || 0) + 1; });
    /* Breite Karte mit groesseren Kacheln (Julius: "fast noch praesenter"):
       26 Wochen am Computer, 20 am Handy. */
    var schmal = window.innerWidth < 700;
    var wochen = schmal ? 20 : 26, lab = 24, zelle = 14, gap = 3, W = lab + wochen * (zelle + gap), H = 7 * (zelle + gap) + 22;
    var heute = new Date(); heute.setHours(12, 0, 0, 0);
    var dow = (heute.getDay() + 6) % 7;
    var start = new Date(heute.getTime() - ((wochen - 1) * 7 + dow) * 864e5);
    var svg = ['Mo', '', 'Mi', '', 'Fr', '', 'So'].map(function (t, i) { return t ? '<text x="0" y="' + (i * (zelle + gap) + zelle - 2) + '" class="st-ax">' + t + '</text>' : ''; }).join('');
    var letzterM = -1, gesamt = 0, tage = 0;
    for (var wk = 0; wk < wochen; wk++) {
      for (var d = 0; d < 7; d++) {
        var dt = new Date(start.getTime() + (wk * 7 + d) * 864e5);
        if (dt > heute) continue;
        var k = stTag(dt.getTime()), c = cnt[k] || 0;
        gesamt += c; if (c) tage++;
        svg += '<rect x="' + (lab + wk * (zelle + gap)) + '" y="' + (d * (zelle + gap)) + '" width="' + zelle + '" height="' + zelle + '" rx="3" fill="' + (c === 0 ? '#ffffff0a' : c === 1 ? '#e5484d66' : c === 2 ? '#e5484daa' : '#e5484d') + '" class="st-pt" style="animation-delay:' + ((wk + d) * 22) + 'ms"' +
          (c ? ' data-tip="' + esc('<b>' + stDatum(dt.getTime()) + '</b><br>' + plural(c, 'Spiel', 'Spiele')) + '"' : '') + '/>';
        if (d === 0 && dt.getMonth() !== letzterM && dt.getDate() <= 7) { letzterM = dt.getMonth(); svg += '<text x="' + (lab + wk * (zelle + gap)) + '" y="' + (H - 6) + '" class="st-ax">' + ST_MONATE[letzterM] + '</text>'; }
      }
    }
    return stKarte('kalender', 'Aktivität', 'Gespielte Spiele der letzten ' + wochen + ' Wochen', '<svg class="st-svg st-kal" viewBox="0 0 ' + W + ' ' + H + '">' + svg + '</svg>' +
      '<p class="st-note">' + plural(gesamt, 'Spiel', 'Spiele') + ' an ' + plural(tage, 'Tag', 'Tagen') + ', im Schnitt ' + (gesamt / wochen).toFixed(1) + ' je Woche</p>', 'zwei');
  }

  /* Head-to-Head: je Gegner Spiele, Bilanz, Legs, eigener Average, Siegquote. */
  function stGegnerKarte(spiele) {
    var titel = 'Gegnerbilanz', sub = 'Head-to-Head, meistgespielte zuerst';
    var m = spiele.filter(function (s) { return s.won !== null && s.gegnerId; });
    if (!m.length) return stKarte('gegner', titel, sub, '<p class="st-leer">Noch keine Spiele mit Gegner.</p>', true);
    var o = {};
    m.forEach(function (s) {
      var x = o[s.gegnerId];
      if (!x) x = o[s.gegnerId] = { name: s.gegner, team: '', n: 0, w: 0, lw: 0, ll: 0, pts: 0, darts: 0 };
      x.n++; if (s.won) x.w++;
      x.lw += s.legsWon; x.ll += s.legsLost; x.pts += s.st.points; x.darts += s.st.darts;
      if (s.team) x.team = s.team;
    });
    var alleZeilen = Object.keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.n - a.n || b.w - a.w; });
    /* Die zehn haeufigsten, der Rest klappt auf. */
    var offen = !!statsUI().gegnerAlle, zeilen = offen ? alleZeilen : alleZeilen.slice(0, 10);
    var html = '<table class="st-tab"><thead><tr><th>Gegner</th><th class="n">Spiele</th><th class="n">Bilanz</th><th class="n">Legs</th><th class="n">Ø</th><th class="q">Siegquote</th></tr></thead><tbody>' +
      zeilen.map(function (x, i) {
        var q = x.w / x.n * 100, farbe = q >= 50 ? ST_FARBE.gruen : ST_FARBE.rot;
        return '<tr class="st-fade" style="animation-delay:' + (Math.min(i, 12) * 60) + 'ms"><td><b>' + esc(x.name) + '</b>' + (x.team ? '<small>' + esc(x.team) + '</small>' : '') + '</td><td class="n">' + x.n + '</td>' +
          '<td class="n" style="color:' + farbe + '">' + x.w + ' : ' + (x.n - x.w) + '</td><td class="n">' + x.lw + ' : ' + x.ll + '</td><td class="n">' + (x.darts ? (x.pts / x.darts * 3).toFixed(1) : '–') + '</td>' +
          '<td><div class="st-quote"><div class="st-track"><div class="st-fill" data-w="' + q.toFixed(1) + '" style="background:' + farbe + '"></div></div><b style="color:' + farbe + '">' + Math.round(q) + ' %</b></div></td></tr>';
      }).join('') + '</tbody></table>' +
      (alleZeilen.length > 10 ? '<button type="button" class="st-mehr" data-action="stats-gegner-alle">' + (offen ? 'Nur die zehn häufigsten' : 'Alle ' + alleZeilen.length + ' Gegner anzeigen') + '</button>' : '');
    return stKarte('gegner', titel, sub, html, true);
  }

  /* Bestleistungen mit Datum und Gegner. */
  function stRekordKarte(spiele) {
    var best = function (f, kleiner) {
      var k = spiele.filter(function (s) { return f(s) > 0; });
      return k.length ? k.reduce(function (b, s) { return b === null || (kleiner ? f(s) < f(b) : f(s) > f(b)) ? s : b; }, null) : null;
    };
    var ba = best(function (s) { return s.st.darts ? s.st.avg : 0; }), bf = best(function (s) { return s.st.first9Darts ? s.st.first9 : 0; });
    var hf = best(function (s) { return s.st.highCO; }), bl = best(function (s) { return s.st.bestLeg || 0; }, true), m180 = best(function (s) { return s.st.s180; });
    var dq = spiele.filter(function (s) { return s.st.doubleAttempts >= 8; }).sort(function (a, b) { return b.st.doubleQuote - a.st.doubleQuote; })[0];
    var lauf = 0, serie = 0;
    spiele.forEach(function (s) { if (s.won === null) return; if (s.won) { lauf++; if (lauf > serie) serie = lauf; } else lauf = 0; });
    var ges = statsSumme(spiele);
    var wo = function (s) { return s ? stDatum(s.at) + (s.gegner ? ' vs. ' + esc(s.gegner) : ' · ' + (STATS_MODUS_TEXT[s.modus] || '')) : ''; };
    var R = [['Bester Average', ba ? ba.st.avg.toFixed(1) : null, wo(ba)], ['Beste First 9', bf ? bf.st.first9.toFixed(1) : null, wo(bf)], ['Höchstes Finish', hf ? hf.st.highCO : null, wo(hf)],
      ['Kürzestes Leg', bl ? bl.st.bestLeg + ' Darts' : null, wo(bl)], ['Meiste 180 im Spiel', m180 ? m180.st.s180 : null, wo(m180)],
      ['Beste Doppelquote', dq ? dq.st.doubleQuote.toFixed(0) + ' %' : null, dq ? wo(dq) + ' (' + dq.st.doubleHits + '/' + dq.st.doubleAttempts + ')' : ''],
      ['Längste Siegesserie', serie || null, 'Spiele in Folge'], ['Spiele gesamt', spiele.length, plural(ges.legs, 'Leg', 'Legs')]];
    var html = R.map(function (r, i) {
      if (r[1] === null || r[1] === undefined) return '';
      return '<div class="st-rec" style="animation-delay:' + (i * 70) + 'ms"><div class="l">' + r[0] + '</div><div class="v">' + r[1] + '</div><div class="s">' + r[2] + '</div></div>';
    }).join('');
    return stKarte('rekorde', 'Rekorde', 'Bestleistungen in der Auswahl', '<div class="st-recs">' + html + '</div>', 'zwei');
  }

  /* ---- Tooltip und Animationen ---- */
  var stTipEl = null, stHoererDran = false, stTipSeit = 0;
  function stTip() {
    if (!stTipEl) { stTipEl = document.createElement('div'); stTipEl.id = 'st-tip'; document.body.appendChild(stTipEl); }
    return stTipEl;
  }
  function stTipZeigen(html, x, y) {
    var t = stTip();
    t.innerHTML = html; t.classList.add('an'); stTipSeit = Date.now();
    var w = t.offsetWidth, h = t.offsetHeight, l = x + 14, o = y - h - 12;
    if (l + w > window.innerWidth - 8) l = x - w - 14;
    if (l < 8) l = 8;
    if (o < 8) o = y + 16;
    t.style.left = l + 'px'; t.style.top = o + 'px';
  }
  function stTipWeg() {
    if (stTipEl) stTipEl.classList.remove('an');
    var cur = document.querySelectorAll('.st-dash .st-cursor');
    for (var i = 0; i < cur.length; i++) cur[i].setAttribute('opacity', 0);
  }
  /* Ein Zeiger ueber einem Element mit data-tip zeigt dessen Text; ueber dem
     Average-Verlauf den naechsten Punkt, ueber dem Radar die naechste Achse. */
  function stTipZeiger(e) {
    var t = e.target;
    var ziel = t && t.closest ? t.closest('[data-tip], [data-st-chart]') : null;
    if (!ziel || !ziel.closest('.st-dash')) { stTipWeg(); return; }
    if (ziel.hasAttribute('data-tip')) { stTipZeigen(ziel.getAttribute('data-tip'), e.clientX, e.clientY); return; }
    var art = ziel.getAttribute('data-st-chart'), r = ziel.getBoundingClientRect(), tips = STATS_TIPS[art];
    if (!tips || !tips.length || !r.width) return;
    if (art === 'avg') {
      var W = Number(ziel.getAttribute('data-w')), L = Number(ziel.getAttribute('data-l')), R = Number(ziel.getAttribute('data-r')), n = Number(ziel.getAttribute('data-n'));
      var px = (e.clientX - r.left) * (W / r.width);
      var i = Math.max(0, Math.min(n - 1, Math.round((px - L) / ((W - L - R) / (n - 1)))));
      var cur = ziel.querySelector('.st-cursor');
      if (cur) { var cx = L + i * (W - L - R) / (n - 1); cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.setAttribute('opacity', 1); }
      stTipZeigen(tips[i], e.clientX, e.clientY);
    } else if (art === 'radar') {
      var W2 = Number(ziel.getAttribute('data-w')), H2 = Number(ziel.getAttribute('data-h'));
      var qx = (e.clientX - r.left) * (W2 / r.width) - Number(ziel.getAttribute('data-cx')), qy = (e.clientY - r.top) * (H2 / r.height) - Number(ziel.getAttribute('data-cy'));
      var a = Math.atan2(qy, qx) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      stTipZeigen(tips[Math.round(a / (Math.PI / 3)) % 6], e.clientX, e.clientY);
    }
  }
  function stHoererEinrichten() {
    if (stHoererDran) return;
    stHoererDran = true;
    document.addEventListener('pointermove', stTipZeiger, { passive: true });
    document.addEventListener('pointerdown', stTipZeiger, { passive: true });
    /* Scrollen blendet den Tipp aus - ausser er kam gerade erst (ein Tipp
       auf ein Element am Rand rollt es zuerst ins Bild und loest so ein
       Scrollen aus, das den frischen Tipp sonst sofort wieder schliesst). */
    document.addEventListener('scroll', function () { if (Date.now() - stTipSeit > 400) stTipWeg(); }, { passive: true, capture: true });
  }
  /* Zahl zaehlt in 1,3 s von null ans Ziel (kubisch auslaufend). */
  function stZaehlen(el) {
    var ziel = Number(el.getAttribute('data-zahl')), dez = Number(el.getAttribute('data-dez')) || 0, suf = el.getAttribute('data-suf') || '';
    if (!isFinite(ziel)) return;
    var t0 = performance.now(), D = 1300;
    el.textContent = (0).toFixed(dez) + suf;
    requestAnimationFrame(function schritt(t) {
      var p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (ziel * e).toFixed(dez) + suf;
      if (p < 1 && el.isConnected) requestAnimationFrame(schritt);
    });
  }
  /* Nach dem Zeichnen: Linien ziehen sich, Balken wachsen, Ringe fuellen
     sich, Zahlen zaehlen hoch - einmal je Auswahl (key). Alles ausserhalb
     der Karten (Kopf, Chips, Kennzahlen) startet sofort, jede Karte erst,
     wenn sie ins Bild scrollt (IntersectionObserver, .st-wart haelt sie
     bis dahin an). Zeichnet die Seite aus anderem Anlass neu (Abgleich,
     Tick, Aufklappen) oder wuenscht das Geraet weniger Bewegung, steht
     alles sofort am Ziel (.st-still). */
  var stBeobachter = null;
  function statsNachRender(wurzel, key) {
    if (!wurzel) return;
    stHoererEinrichten(); stTipWeg();
    if (stBeobachter) { stBeobachter.disconnect(); stBeobachter = null; }
    var ruhig = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var still = key === statsAnimiertFuer || ruhig;
    statsAnimiertFuer = key;
    var pfade = wurzel.querySelectorAll('path.st-draw'), fuellungen = wurzel.querySelectorAll('.st-fill[data-w]');
    var ringe = wurzel.querySelectorAll('.st-ring'), zahlen = wurzel.querySelectorAll('[data-zahl]');
    var i;
    var ziel = function (el) { el.style.width = el.getAttribute('data-w') + '%'; };
    if (still) {
      wurzel.classList.add('st-still');
      for (i = 0; i < fuellungen.length; i++) ziel(fuellungen[i]);
      return;
    }
    for (i = 0; i < pfade.length; i++) { var len = pfade[i].getTotalLength(); pfade[i].style.strokeDasharray = len; pfade[i].style.strokeDashoffset = len; }
    for (i = 0; i < ringe.length; i++) ringe[i].style.strokeDashoffset = ringe[i].getAttribute('data-voll');
    for (i = 0; i < zahlen.length; i++) zahlen[i].textContent = (0).toFixed(Number(zahlen[i].getAttribute('data-dez')) || 0) + (zahlen[i].getAttribute('data-suf') || '');
    var KARTE = '.st-karte, .st-rang';
    var starten = function (nur) {
      var j;
      for (j = 0; j < zahlen.length; j++) if (nur(zahlen[j])) stZaehlen(zahlen[j]);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!wurzel.isConnected) return;
          var k;
          for (k = 0; k < pfade.length; k++) if (nur(pfade[k])) pfade[k].style.strokeDashoffset = 0;
          for (k = 0; k < ringe.length; k++) if (nur(ringe[k])) ringe[k].style.strokeDashoffset = ringe[k].getAttribute('stroke-dashoffset');
          for (k = 0; k < fuellungen.length; k++) if (nur(fuellungen[k])) ziel(fuellungen[k]);
        });
      });
    };
    var karten = Array.prototype.slice.call(wurzel.querySelectorAll(KARTE));
    starten(function (el) { return !el.closest(KARTE); });
    var inKarte = function (k) { return function (el) { return el.closest(KARTE) === k; }; };
    if (!('IntersectionObserver' in window)) { karten.forEach(function (k) { starten(inKarte(k)); }); return; }
    karten.forEach(function (k) { k.classList.add('st-wart'); });
    stBeobachter = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (!e.isIntersecting) return;
        var k = e.target;
        stBeobachter.unobserve(k);
        k.classList.remove('st-wart');
        starten(inKarte(k));
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    karten.forEach(function (k) { stBeobachter.observe(k); });
  }

  /* ================= Reiter „Statistik“: Person und Mannschaft =================
     Nach dem erweiterten Artefakt „Darts Statistik“ (Julius, 11.11.2026). Der
     Reiter ersetzt „Rang“: oben der Ebenen-Schalter, dann die Person (das
     Dashboard aus dem Profil, dazu Spieler-Chips, Liga-Bilanz, weitere
     Spielarten aufklappbar, alle Zahlen) oder die Mannschaft (Liga: Team-
     Kennzahlen, Spieltag fuer Spieltag, Kader-Beitrag, Tabelle, Bilanz je
     Team, Highlights, Liga-Rangliste aus der Einzelrangliste der Ligaleitung;
     Alle Spielarten: Crew-Kennzahlen, Kader im Vergleich, Team-Form, Big
     Scores, Doppelquote und darunter die Rangliste je Spielart wie bisher).
     Liga-Zahlen kommen aus js/liga-daten.js (Tabelle, Einzelrangliste,
     Highlights aus den Spielberichten), Wuerfe und Averages aus der App. */
  var ST_KZ = [
    ['avg', 'Average', function (s) { return s.avg; }, function (v) { return v.toFixed(1); }, 'Punkte je 3 Darts über alle Spiele.'],
    ['first9', 'First 9', function (s) { return s.first9; }, function (v) { return v.toFixed(1); }, 'Average der ersten 9 Darts eines Legs.'],
    ['dbl', 'Doppelquote', function (s) { return s.dbl; }, function (v) { return v.toFixed(1) + ' %'; }, 'Getroffene Finishes je Dart auf ein mögliches Doppel.'],
    ['win', 'Siegquote', function (s) { return s.win; }, function (v) { return v.toFixed(0) + ' %'; }, 'Anteil gewonnener Spiele mit Gegner.'],
    ['c180', '180er', function (s) { return s.c180; }, function (v) { return String(v); }, 'Maximum: alle drei Darts in die Triple 20.'],
    ['hf', 'Höchstes Finish', function (s) { return s.hf || null; }, function (v) { return String(v); }, 'Der höchste je ausgecheckte Rest.'],
    ['bl', 'Bestes Leg', function (s) { return s.bl; }, function (v) { return v + ' Darts'; }, 'Wenigste Darts für ein gewonnenes 501er-Leg.', true]
  ];
  var ST_LIGA_KZ = [
    ['punkte', 'Punkte', function (z) { return z.punkte; }, function (v) { return String(v); }],
    ['won', 'Siege', function (z) { return z.siege; }, function (v) { return String(v); }],
    ['legs', 'Legs', function (z) { return z.lf; }, function (v) { return String(v); }],
    ['quote', 'Siegquote', function (z) { return z.siege + z.nied >= 2 ? z.siege / (z.siege + z.nied) * 100 : null; }, function (v) { return v.toFixed(0) + ' %'; }]
  ];
  var stLigaCache = null;   // Liga-Daten einmal je Zeichnen

  function statsUI() {
    if (!UI.stats) UI.stats = { ebene: 'person', spieler: null, kader: 'avg', liga: 'punkte', auf: {}, gegnerAlle: false };
    if (!UI.stats.auf) UI.stats.auf = {};
    return UI.stats;
  }
  /* Der Kader: dieselben Leute wie in der Rangliste - keine Bots, keine
     Testkonten, Gaeste nur, wenn sie dauerhaft sind. */
  function statsCrew() { return activeProfiles().filter(function (p) { return !p.bot && !p.test && (!p.gast || p.dauer); }); }
  /* Die gewaehlte Person: die angetippte, sonst das eigene Konto, sonst der Erste. */
  function statsSpieler() {
    var st = statsUI(), crew = statsCrew(), p = null, eig = eigeneKontoId();
    crew.forEach(function (x) { if (x.id === st.spieler) p = x; });
    /* Auch wer nicht im Kader steht (ausgeblendet, Testkonto, Gast von
       heute), hat eine Einzelstatistik, wenn man ihn gezielt antippt. */
    if (!p && st.spieler) S.profiles.forEach(function (x) { if (x.id === st.spieler) p = x; });
    if (!p && eig) crew.forEach(function (x) { if (x.id === eig) p = x; });
    if (!p) p = crew[0] || null;
    if (p) st.spieler = p.id;
    return p;
  }
  /* Von anderswo in die Einzelstatistik eines Spielers springen (Liga-
     Statistik, Kader-Vergleich, Spieler-Liste, Rangliste). */
  function statsPersonOeffnen(pid) {
    var st = statsUI();
    st.ebene = 'person';
    if (pid) st.spieler = pid;
    UI.boardLog = false;
    S.screen = 'stats';
    save(); window.scrollTo(0, 0); render();
  }
  /* Die Liga-Statistik (Mannschaft, gesamte Liga, Gegner) wohnt im Liga-
     Reiter unter "Statistik" (Julius, 12.11.). */
  function ligaStatistikOeffnen(team) {
    UI.ligaTab = 'statistik';
    if (team) UI.ligaTeam = team;
    UI.boardLog = false;
    S.screen = 'liga';
    save(); window.scrollTo(0, 0); render();
  }

  /* ---- Bausteine ---- */
  function stMinis(liste) {
    var h = liste.filter(function (e) { return e && e[1] !== null && e[1] !== undefined && e[1] !== ''; }).map(function (e, i) {
      return '<div class="st-mini" style="animation-delay:' + (i * 50) + 'ms"><span>' + e[0] + '</span><b' + (e[3] ? ' style="color:' + e[3] + '"' : '') + '>' + e[1] + '</b>' + (e[2] ? '<small>' + e[2] + '</small>' : '') + '</div>';
    }).join('');
    return h ? '<div class="st-minis">' + h + '</div>' : '';
  }
  function stBalken(w, farbe) { return '<div class="st-track"><div class="st-fill" data-w="' + Math.max(0, Math.min(100, w || 0)).toFixed(1) + '" style="background:' + farbe + '"></div></div>'; }
  function stChip(action, wert, text, an, extra) {
    return '<button type="button" class="st-chip' + (an ? ' on' : '') + '" data-action="' + action + '" data-wert="' + esc(String(wert)) + '">' + text + (extra || '') + '</button>';
  }
  /* Die Wer-Karte: Profilbild (Person) oder nichts statt eines Symbols. */
  function stWer(art, bild, titel, sub, knopf) {
    var k = art === 'person' ? 'Einzelstatistik' : art === 'liga' ? 'Liga-Statistik' : 'Mannschaft';
    return '<div class="st-wer">' + (bild || '') + '<div class="st-wer-text"><div class="k">' + k + '</div><b>' + titel + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + (knopf || '') + '</div>';
  }
  /* Kennzahl-Kacheln: [Titel, Wert, Dezimalen, Einheit, Farbe, Zeile darunter]. */
  function stKpiHtml(kpis) {
    return '<div class="st-kpis">' + kpis.map(function (k, i) {
      var leer = k[1] === null || k[1] === undefined || !isFinite(k[1]);
      return '<div class="st-kpi" style="--c:' + k[4] + ';animation-delay:' + (i * 60) + 'ms"><span class="l">' + k[0] + '</span>' +
        '<span class="v">' + (leer ? '–' : '<span class="z" data-zahl="' + k[1] + '" data-dez="' + k[2] + '">' + stFmt(k[1], k[2]) + '</span>' + (k[3] ? '<small>' + k[3] + '</small>' : '')) + '</span>' +
        '<span class="d">' + (k[5] || '') + '</span></div>';
    }).join('') + '</div>';
  }
  function stLrow(i, name, sub, wert, farbe) {
    var ini = String(name).split(' ').map(function (x) { return x.charAt(0); }).join('').slice(0, 2).toUpperCase();
    return '<div class="st-lrow"><span class="st-pos' + (i < 3 ? ' m' + (i + 1) : '') + '">' + (i + 1) + '</span><span class="st-av" style="background:' + farbe + '">' + esc(ini) + '</span><span class="nm">' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><span class="val">' + wert + '</span></div>';
  }
  function stName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function stLigaName(p) { return p.voll || p.name; }
  function stPaar(x) { var m = /^\s*(\d+)\s*:\s*(\d+)/.exec(String(x || '')); return m ? [Number(m[1]), Number(m[2])] : null; }
  function stIsoText(iso) { return iso ? String(Number(iso.slice(8, 10))) + '. ' + ST_MONATE[Number(iso.slice(5, 7)) - 1] : ''; }

  /* ---- Liga-Daten (Ligaleitung) ---- */
  function stLigaDaten() {
    if (stLigaCache) return stLigaCache;
    var tab = ligaTabelleBerechnet();
    var er = window.LIGA_DATEN.einzelranglisteAus(LIGA_SPIELTAGE);
    var platz = 0, vorher = null;
    er.forEach(function (z, i) {
      var k = [z.punkte, z.siege - z.nied, z.lf - z.la, z.lf].join('|');
      if (k !== vorher) { platz = i + 1; vorher = k; }
      z.platz = platz;
    });
    var hl = window.LIGA_DATEN.highlightsAus(LIGA_SPIELTAGE);
    var spiele = [];
    Object.keys(LIGA_SPIELTAGE).sort().forEach(function (tid) {
      (LIGA_SPIELTAGE[tid] || []).forEach(function (sp) {
        if (!sp || !sp.heim || !sp.gast || sp.verschoben) return;
        var e = stPaar(sp.einzel);
        if (!e) return;
        spiele.push({ nr: Number(String(tid).replace(/\D/g, '')) || 0, tag: sp.tag || '', heim: sp.heim, gast: sp.gast, e: e, l: stPaar(sp.legs) || [0, 0] });
      });
    });
    var teams = LIGA_TEAMS.filter(function (t) { return t !== LIGA.team; }).sort(function (a, b) { return a.localeCompare(b, 'de'); });
    stLigaCache = { tab: tab, er: er, hl: hl, spiele: spiele, teams: teams };
    return stLigaCache;
  }
  function stTeamSpiele(d, team) {
    return d.spiele.filter(function (s) { return s.heim === team || s.gast === team; }).map(function (s) {
      var h = s.heim === team, ef = h ? s.e[0] : s.e[1], ea = h ? s.e[1] : s.e[0];
      return { nr: s.nr, tag: s.tag, heim: h, gegner: h ? s.gast : s.heim, ef: ef, ea: ea, lf: h ? s.l[0] : s.l[1], la: h ? s.l[1] : s.l[0], pkt: ef > ea ? 2 : ef === ea ? 1 : 0 };
    }).sort(function (a, b) { return (a.tag || '').localeCompare(b.tag || '') || a.nr - b.nr; });
  }
  /* Profil und Einzelrangliste gehoeren zusammen, wenn der ganze Name passt,
     sonst wenn Vor- oder Nachname eindeutig sind - dieselbe Regel wie beim
     Nachtrag vom Bogen (nachtragVorschlag). */
  function stNamenPassen(p, erName) {
    var n = stName(erName), teile = n.split(' '), vor = teile[0], nach = teile[teile.length - 1];
    var voll = stName(p.voll), kurz = stName(p.name), pv = voll.split(' ');
    return { ganz: voll === n || kurz === n, vor: kurz === vor || (pv[0] && pv[0] === vor), nach: pv.length > 1 && pv[pv.length - 1] === nach };
  }
  function stEindeutig(liste, stufe) {
    var ganz = liste.filter(function (x) { return x.t.ganz; });
    if (ganz.length) return ganz[0].x;
    var vor = liste.filter(function (x) { return x.t.vor; });
    if (vor.length === 1) return vor[0].x;
    var nach = liste.filter(function (x) { return x.t.nach; });
    return nach.length === 1 ? nach[0].x : null;
  }
  /* Die Zeile eines unserer Spieler in der Einzelrangliste. */
  function stErZeile(d, p) {
    return stEindeutig(d.er.filter(function (z) { return z.team === LIGA.team; }).map(function (z) { return { x: z, t: stNamenPassen(p, z.name) }; }));
  }
  /* Das Profil zu einem Namen der Einzelrangliste (nur Kader). */
  function stProfilZuName(name) {
    return stEindeutig(statsCrew().map(function (p) { return { x: p, t: stNamenPassen(p, name) }; }));
  }

  /* ---- Person: Seite im Reiter ---- */
  function statsPersonSeiteHtml() {
    var p = statsSpieler();
    if (!p) return '<div class="st-dash" data-spiele="0"><p class="st-leer">Noch keine Spieler angelegt.</p></div>';
    var crew = statsCrew();
    var alle = spielerSpiele(p.id), ges = statsSumme(alle);
    /* Ins Profil nur, wo man es auch bearbeiten darf (eigenes Konto, Gaeste):
       fremde Profile sieht niemand (Julius, 12.11.). */
    var kopf = stWer('person', avatarHTML(p, 'md'), esc(p.name) + (p.id === eigeneKontoId() ? ' <em>(du)</em>' : ''),
      (istGastProfil(p) ? 'Gast' : 'Mitglied ' + esc(LIGA.team)) + ' · ' + plural(ges ? ges.matches : 0, 'Spiel', 'Spiele') + ' mit Gegner',
      bearbeitbar(p.id) ? '<button type="button" class="st-knopf" data-action="open-profile" data-id="' + esc(p.id) + '">Profil ›</button>' : '');
    /* Steht die Person nicht im Kader, bekommt sie vorn ihren eigenen Chip. */
    if (!crew.some(function (x) { return x.id === p.id; })) crew = [p].concat(crew);
    var chips = '<div class="st-chips st-spieler">' + crew.map(function (x) {
      return stChip('stats-spieler', x.id, '<i class="st-dot" style="background:' + playerColor(x.id) + '"></i>' + esc(x.name), x.id === p.id, istGastProfil(x) ? ' <small>Gast</small>' : '');
    }).join('') + '</div>';
    return statsDashboardHtml(p, { kopf: kopf + chips, alle: alle });
  }

  /* ---- Person: Liga-Bilanz ---- */
  function stLigaBilanzKarte(p) {
    var titel = 'Liga-Bilanz', sub = 'Persönlich in der ' + esc(LIGA.saison) + ': Einzelrangliste der Ligaleitung und Würfe aus der App';
    var d = stLigaDaten(), z = stErZeile(d, p), ls = careerLiga()[p.id];
    if (ls && !ls.matches && !ls.darts && !ls.s180 && !ls.highCO) ls = null;
    var n = stName(stLigaName(p));
    var mein = function (l) { return l.filter(function (h) { return h.team === LIGA.team && stName(h.name) === n; }); };
    var h180 = mein(d.hl.s180), hf = mein(d.hl.highfinish), sl = mein(d.hl.shortleg);
    if (!z && !ls) return stKarte('ligabilanz', titel, sub, '<p class="st-leer">Noch kein Einsatz in der Liga.</p>');
    var html = '';
    if (z) {
      html += '<div class="st-platz"><div class="z"><span data-zahl="' + z.platz + '" data-dez="0">' + z.platz + '</span><small>. Platz</small></div>' +
        '<div class="t">von ' + d.er.length + ' Spielern der Liga' + stBalken(d.er.length > 1 ? (d.er.length - z.platz) / (d.er.length - 1) * 100 : 100, 'linear-gradient(90deg,' + ST_FARBE.blau + ',' + ST_FARBE.gruen + ')') + '</div></div>';
    }
    var q = z && z.siege + z.nied ? z.siege / (z.siege + z.nied) * 100 : null;
    var s180 = Math.max(ls ? ls.s180 : 0, sum(h180, function (x) { return x.n; }));
    var hoch = Math.max(ls ? ls.highCO : 0, hf.length ? hf[0].wert : 0);
    var bl = [sl.length ? sl[0].wert : 0, ls && ls.bestLeg ? ls.bestLeg : 0].filter(Boolean);
    bl = bl.length ? Math.min.apply(null, bl) : null;
    html += stMinis([
      z ? ['Punkte', z.punkte, 'Einzelrangliste', ST_FARBE.gold] : null,
      z ? ['Einzel', z.siege + ' : ' + z.nied, q === null ? '' : q.toFixed(0) + ' % gewonnen', q >= 50 ? ST_FARBE.gruen : ST_FARBE.rot] : null,
      z ? ['Legs', z.lf + ' : ' + z.la] : null,
      ls && ls.darts ? ['Liga-Ø', ls.avg.toFixed(1), 'aus der App', ST_FARBE.blau] : null,
      ls && ls.doubleAttempts ? ['Doppelquote', ls.doubleQuote.toFixed(1) + ' %', ls.doubleHits + ' von ' + ls.doubleAttempts, ST_FARBE.gruen] : null,
      s180 ? ['180er', s180, '', ST_FARBE.rot] : null,
      hoch ? ['Höchstes Finish', hoch] : null,
      bl ? ['Bestes Leg', bl + ' Darts'] : null
    ]);
    if (hf.length || sl.length) {
      html += '<p class="st-note">Laut Ligaleitung: ' + [hf.length ? 'Highfinishes ' + hf.map(function (x) { return x.wert; }).join(', ') : '',
        sl.length ? 'Shortlegs ' + sl.map(function (x) { return x.wert + ' Darts'; }).join(', ') : ''].filter(Boolean).join(' · ') + '</p>';
    }
    return stKarte('ligabilanz', titel, sub, html);
  }

  /* ---- Person: weitere Spielarten, aufklappbar ---- */
  /* Die letzten fuenf Spiele einer Spielart mit diesem Spieler. */
  function stArtSpiele(kind, pid) {
    var liste = wertbareHistorie().filter(function (h) { return h.kind === kind && (h.players || []).indexOf(pid) >= 0; });
    if (S.game && S.game.kind === kind && S.game.done && !testSpiel(S.game) && (S.game.players || []).indexOf(pid) >= 0) liste = liste.concat([S.game]);
    liste.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return liste.slice(0, 5).map(function (h) {
      var allein = h.players.length < 2;
      var mit = allein ? 'allein' : h.players.filter(function (id) { return id !== pid; }).map(pname).map(esc).join(', ');
      var ausgang = allein ? '' : (h.winner === pid ? 'Sieg' : h.winner ? 'Niederlage' : 'abgebrochen') + ' · ';
      var erg;
      if (kind === 'rtw') {
        var fin = rtwState({ players: h.players, throws: h.throws, boost: h.boost !== false }).finished[pid];
        erg = fin ? plural(fin.darts, 'Dart', 'Darts') : 'nicht beendet';
      } else if (kind === 'kaiwen') {
        var ks = kaiwenState({ players: h.players, versuche: h.versuche || [] });
        erg = 'Höchste ' + ks.hoechste + ' · ' + ks.checks + ' von ' + ks.versuche + ' gecheckt';
      } else if (kind === 'finisher') {
        erg = ausgang + plural((h.rounds || []).filter(function (r) { return r.sieger === pid; }).length, 'Runde', 'Runden');
      } else if (kind === 'hunter') {
        var hs = hunterState({ players: h.players, throws: h.throws || [], variante: h.variante, handicap: h.handicap, startPos: h.startPos, leben: h.leben });
        erg = ausgang + plural(hs.faenge[pid] || 0, 'Fang', 'Fänge');
      } else {
        var cs = cricketState({ players: h.players, throws: h.throws, scoring: h.scoring });
        erg = ausgang + plural(cs.allMarks[pid] || 0, 'Marke', 'Marken');
      }
      return { at: h.at, erg: erg, mit: mit };
    });
  }
  function stSpielartenKarte(p, st) {
    var titel = 'Weitere Spielarten', sub = 'Cricket, Round the World, Finisher, Kaiwen und Hunter – ein Tipp öffnet die Details';
    var F = ST_FARBE;
    var arten = [
      { k: 'cricket', t: 'Cricket', n: st.cricketGames,
        top: [['Spiele', st.cricketGames], ['Siege', st.cricketWins], ['MPR', st.cricketDarts ? st.mpr.toFixed(1) : '–', 'Marken je 3 Darts', F.blau]],
        mehr: [['Siegquote', st.cricketGames ? Math.round(st.cricketWins / st.cricketGames * 100) + ' %' : '–'], ['Marken gesamt', st.cricketMarks], ['Darts', st.cricketDarts]] },
      { k: 'rtw', t: 'Round the World', n: st.rtwGames,
        top: [['Spiele', st.rtwGames], ['Siege', st.rtwWins], ['Bestes', st.rtwBest ? st.rtwBest + ' Darts' : '–', 'kompletter Durchlauf', F.gold]],
        mehr: [['Siegquote', st.rtwGames ? Math.round(st.rtwWins / st.rtwGames * 100) + ' %' : '–']] },
      { k: 'finisher', t: 'Finisher', n: st.finGames,
        top: [['Spiele', st.finGames], ['Siege', st.finWins], ['Ø Darts', st.finRounds ? st.finAvgDarts.toFixed(1) : '–', 'je Finish', F.gruen]],
        mehr: [['Gewonnene Runden', st.finRounds], ['Schnellstes', st.finBest ? plural(st.finBest, 'Dart', 'Darts') : '–'], ['Höchste Zahl', st.finHigh || '–']] },
      { k: 'kaiwen', t: 'Kaiwen', n: st.kwGames,
        top: [['Spiele', st.kwGames], ['PB Solo', st.kwBestSolo !== null ? st.kwBestSolo : '–', '', F.gold], ['PB Team', st.kwBestTeam !== null ? st.kwBestTeam : '–']],
        mehr: [['Checks', st.kwChecks], ['Versuche', st.kwVersuche], ['Check-Quote', st.kwVersuche ? st.kwQuote.toFixed(0) + ' %' : '–']] },
      { k: 'hunter', t: 'Hunter', n: st.huGames,
        top: [['Spiele', st.huGames], ['Siege', st.huWins], ['Fänge', st.huFaenge, '', F.rot]],
        mehr: [['MPR', st.huDarts ? st.huMpr.toFixed(1) : '–', 'Treffer je 3 Darts'], ['Trefferquote', st.huDarts ? st.huQuote.toFixed(0) + ' %' : '–'],
          ['Solo Normal', st.huBest.normal !== null ? plural(st.huBest.normal, 'Dart', 'Darts') : '–'], ['Solo Boost', st.huBest.boost !== null ? plural(st.huBest.boost, 'Dart', 'Darts') : '–']] }
    ].filter(function (a) { return a.n > 0; });
    if (!arten.length) return stKarte('spielarten', titel, sub, '<p class="st-leer">Noch nichts außer X01 gespielt.</p>', 'zwei');
    var auf = statsUI().auf;
    var html = '<div class="st-arten">' + arten.map(function (a) {
      var offen = !!auf[a.k];
      var letzte = offen ? stArtSpiele(a.k, p.id) : [];
      return '<div class="st-art' + (offen ? ' auf' : '') + '">' +
        '<button type="button" class="st-art-kopf" data-action="stats-art" data-art="' + a.k + '" aria-expanded="' + (offen ? 'true' : 'false') + '">' +
          '<span class="t">' + a.t + '</span><span class="n">' + plural(a.n, 'Spiel', 'Spiele') + '</span><span class="pfeil" aria-hidden="true">›</span></button>' +
        stMinis(a.top) +
        (offen ? '<div class="st-art-mehr">' + stMinis(a.mehr) +
          (letzte.length ? '<div class="st-art-liste"><span class="st-art-titel">Letzte Spiele</span>' + letzte.map(function (l) {
            return '<div class="st-zl"><span>' + stDatum(l.at) + ' · ' + l.mit + '</span><b>' + l.erg + '</b></div>';
          }).join('') + '</div>' : '') + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
    return stKarte('spielarten', titel, sub, html, 'zwei');
  }

  /* ---- Person: alle Zahlen (die frueheren Karten Scoring, Finishing, Bilanz, letzte Spiele) ---- */
  function stZahlenKarte(p, st) {
    var zl = function (a, b) { return '<div class="st-zl"><span>' + a + '</span><b>' + b + '</b></div>'; };
    var gr = function (t, l) { return '<div class="st-zgr"><h4>' + t + '</h4>' + l.join('') + '</div>'; };
    var letzte = allMatches().filter(function (e) { return e.m.p.indexOf(p.id) >= 0; }).slice(0, 6).map(function (e) {
      var m = e.m;
      if (m.p.length < 2) {
        var sd = sum(m.legs, function (l) { return dartsInLeg(l, p.id); });
        return zl(stDatum(m.at || e.at) + ' · ' + (m.session ? 'Session' : 'Solo'), plural(sd, 'Dart', 'Darts'));
      }
      var opp = m.p.filter(function (id) { return id !== p.id; }), win = m.winner === p.id;
      var fremd = opp.length === 1 ? legsWon(m, opp[0]) : m.legs.filter(function (l) { return l.winner && l.winner !== p.id; }).length;
      return zl(stDatum(m.at || e.at) + ' · ' + esc(opp.map(pname).join(' / ')), '<span style="color:' + (win ? ST_FARBE.gruen : ST_FARBE.rot) + '">' + (win ? 'Sieg ' : 'Niederlage ') + legsWon(m, p.id) + ':' + fremd + '</span>');
    });
    return stKarte('zahlen', 'Alle Zahlen', 'Gesamtwerte über sämtliche Classic-Spiele, dazu die letzten Spiele', '<div class="st-zahlen">' +
      gr('Scoring', [zl('3-Dart-Average', st.darts ? st.avg.toFixed(1) : '–'), zl('First-9-Average', st.first9Darts ? st.first9.toFixed(1) : '–'), zl('Höchste Aufnahme', st.highScore || '–'),
        zl('180er', st.s180), zl('140 – 179', st.s140), zl('100 – 139', st.s100), zl('60 – 99', st.s60), zl('Aufnahmen gesamt', st.visits), zl('Darts geworfen', st.darts)]) +
      gr('Finishing', [zl('Doppelquote', st.doubleAttempts ? st.doubleQuote.toFixed(1) + ' %' : '–'), zl('Doppelversuche', st.doubleAttempts), zl('Checkouts', st.checkouts),
        zl('Höchstes Finish', st.highCO || '–'), zl('Finishes ab 100', st.highFinishes), zl('Bestes Leg', st.bestLeg ? st.bestLeg + ' Darts' : '–'),
        zl('Ø Darts je gewonnenem Leg (501)', st.dartsPerLeg ? st.dartsPerLeg.toFixed(1) : '–')]) +
      gr('Bilanz', [zl('Spiele', st.matches), zl('Siege / Niederlagen', st.won + ' / ' + st.lost), zl('Siegquote', st.matches ? st.winPct.toFixed(0) + ' %' : '–'),
        zl('Legs gewonnen / verloren', st.legsWon + ' / ' + st.legsLost), zl('Turniere gespielt', st.tournaments), zl('Turniersiege', st.tourWins)].concat(st.ligaTage ? [zl('Ligaspieltage', st.ligaTage)] : [])) +
      gr('Letzte Spiele', letzte.length ? letzte : ['<p class="st-leer">Noch keine Spiele.</p>']) + '</div>', true);
  }

  /* ---- Mannschaft (Reiter Statistik): die Crew ueber alle Spielarten,
     darunter die Rangliste je Spielart (#stats-rang) ---- */
  function statsTeamSeiteHtml() {
    stCrewSpieleCache = null;
    return '<div class="st-dash st-team" data-spiele="' + wertbareHistorie().length + '">' + stCrewHtml() + '</div>';
  }
  /* ---- Liga-Statistik (Reiter Liga › Statistik): unser Team, die gesamte
     Liga oder ein Gegner ---- */
  function ligaStatistikHtml() {
    stLigaCache = null;
    var d = stLigaDaten();
    var team = UI.ligaTeam || 'wir';
    if (team !== 'wir' && team !== 'alle' && d.teams.indexOf(team) < 0) team = UI.ligaTeam = 'wir';
    var chips = '<div class="st-chips">' + [['wir', LIGA.team], ['alle', 'Gesamte Liga']].concat(d.teams.map(function (t) { return [t, t]; })).map(function (t) {
      return stChip('stats-team', t[0], esc(t[1]), team === t[0]);
    }).join('') + '</div>';
    var inhalt = team === 'alle' ? stLigaGesamtHtml(d) : stLigaTeamHtml(d, team === 'wir' ? LIGA.team : team);
    return '<div class="st-dash st-team" data-spiele="' + wertbareHistorie().length + '">' + chips + inhalt + '</div>';
  }
  function renderLigaStatistik() {
    var wurzel = $('liga-statistik');
    wurzel.innerHTML = ligaStatistikHtml();
    var dash = wurzel.querySelector('.st-dash');
    statsNachRender(dash, ['liga', UI.ligaTeam, statsUI().liga, dash && dash.getAttribute('data-spiele')].join('|'));
  }

  function stTeamKpis(d, name) {
    var zs = d.tab.zeilen, zi = -1;
    zs.forEach(function (z, i) { if (z.team === name) zi = i; });
    var z = zi >= 0 ? zs[zi] : { punkte: 0, g: 0, u: 0, v: 0 };
    var sp = stTeamSpiele(d, name), wir = name === LIGA.team;
    var ef = sum(sp, function (s) { return s.ef; }), ea = sum(sp, function (s) { return s.ea; }), lf = sum(sp, function (s) { return s.lf; }), la = sum(sp, function (s) { return s.la; });
    var s180 = sum(d.hl.s180.filter(function (x) { return x.team === name; }), function (x) { return x.n; });
    var hf = d.hl.highfinish.filter(function (x) { return x.team === name; })[0], sl = d.hl.shortleg.filter(function (x) { return x.team === name; })[0];
    /* Unser Team: Average und Doppelquote aus den Wuerfen der App (nur Ligaspiele). */
    var app = null;
    if (wir) {
      var cl = careerLiga();
      app = { points: 0, darts: 0, hits: 0, att: 0, s180: 0, hf: 0 };
      statsCrew().forEach(function (p) {
        var s = cl[p.id];
        if (!s) return;
        app.points += s.points; app.darts += s.darts; app.hits += s.doubleHits; app.att += s.doubleAttempts; app.s180 += s.s180;
        if (s.highCO > app.hf) app.hf = s.highCO;
      });
    }
    var F = ST_FARBE;
    var kpis = [
      ['Tabellenplatz', zi >= 0 ? zi + 1 : null, 0, '.', F.gold, 'von ' + zs.length + ' Teams'],
      ['Punkte', z.punkte, 0, '', F.creme, z.g + ' S · ' + z.u + ' U · ' + z.v + ' N'],
      ['Einzel-Quote', ef + ea ? ef / (ef + ea) * 100 : null, 0, ' %', F.gruen, ef + ' : ' + ea + ' Einzel'],
      ['Leg-Quote', lf + la ? lf / (lf + la) * 100 : null, 0, ' %', F.blau, lf + ' : ' + la + ' Legs'],
      ['Team-Average', app && app.darts ? app.points / app.darts * 3 : null, 1, '', F.lila, wir ? 'aus den Würfen in der App' : 'nur für unser Team'],
      ['Doppelquote', app && app.att ? app.hits / app.att * 100 : null, 1, ' %', F.gruen, wir ? (app.att ? app.hits + ' von ' + app.att : 'aus den Würfen in der App') : 'nur für unser Team'],
      ['180er', Math.max(s180, app ? app.s180 : 0), 0, '', F.rot, 'Höchstes Finish ' + (Math.max(hf ? hf.wert : 0, app ? app.hf : 0) || '–') + (sl ? ' · Shortleg ' + sl.wert : '')]
    ];
    return { sp: sp, kpis: stKpiHtml(kpis) };
  }
  function stLigaTeamHtml(d, name) {
    var wir = name === LIGA.team, k = stTeamKpis(d, name);
    var h = stWer('liga', '', esc(name), (wir ? 'Unser Team' : 'Gegner') + ' · ' + esc(LIGA.saison) + ' · ' + plural(k.sp.length, 'Spieltag', 'Spieltage') + ' gewertet') + k.kpis;
    h += '<div class="st-raster">' + stSpieltagKarte(k.sp, !wir) + (wir ? '' : stHlKarte(d, name)) + stKaderKarte(d, name) + stTabelleKarte(d, name) + stTeamGegnerKarte(k.sp) + '</div>';
    return h + stLigaRangHtml(d, name);
  }
  function stLigaGesamtHtml(d) {
    var zs = d.tab.zeilen, hl = d.hl, ein = 0, legs = 0;
    zs.forEach(function (z) { var e = stPaar(z.einzel), l = stPaar(z.legs); ein += e ? e[0] : 0; legs += l ? l[0] : 0; });
    var F = ST_FARBE;
    var h = stWer('liga', '', 'Gesamte Liga', esc(LIGA.saison) + ' · ' + zs.length + ' Teams' + (d.tab.bis ? ' · Stand ' + stIsoText(d.tab.bis) : ''));
    h += stKpiHtml([
      ['Teams', zs.length, 0, '', F.creme, d.er.length + ' Spieler im Einsatz'],
      ['Begegnungen', d.spiele.length, 0, '', F.blau, ein + ' Einzel · ' + legs + ' Legs'],
      ['180er', sum(hl.s180, function (x) { return x.n; }), 0, '', F.rot, hl.s180.length ? 'meiste: ' + esc(hl.s180[0].name) : ''],
      ['Höchstes Finish', hl.highfinish.length ? hl.highfinish[0].wert : null, 0, '', F.gold, hl.highfinish.length ? esc(hl.highfinish[0].name) : ''],
      ['Kürzestes Leg', hl.shortleg.length ? hl.shortleg[0].wert : null, 0, ' Darts', F.gruen, hl.shortleg.length ? esc(hl.shortleg[0].name) : ''],
      ['Tabellenführer', zs.length ? zs[0].punkte : null, 0, ' Pkt', F.gold, zs.length ? esc(zs[0].team) : '']
    ]);
    var mP = Math.max.apply(null, [1].concat(d.er.map(function (z) { return z.punkte; })));
    var top = d.er.length ? '<div class="st-kliste">' + d.er.slice(0, 12).map(function (z, i) {
      return '<div class="st-krow' + (z.team === LIGA.team ? ' wir' : '') + '" style="animation-delay:' + (i * 40) + 'ms"><span class="st-krang">' + z.platz + '.</span>' +
        '<span class="st-kname"><b>' + esc(z.name) + (z.gast ? '<span class="st-gast">Gast</span>' : '') + '</b><small>' + esc(z.team) + ' · Einzel ' + z.siege + ':' + z.nied + '</small></span>' +
        stBalken(z.punkte / mP * 100, z.team === LIGA.team ? F.rot : F.blau) + '<span class="st-kwert">' + z.punkte + '</span></div>';
    }).join('') + '</div>' : '<p class="st-leer">Noch kein Spielbericht.</p>';
    h += '<div class="st-raster">' + stTabelleKarte(d, '') + stKarte('einzel', 'Einzelrangliste', 'Die besten 12 der Liga nach Punkten (Sieg = 2 + Leg-Differenz)', top) + stHlKarte(d, '') + '</div>';
    return h + stLigaRangHtml(d, '');
  }

  /* Einzel gewonnen/verloren je Spieltag als Saeulen, Punkte aufsummiert als Linie. */
  function stSpieltagKarte(sp, zwei) {
    var titel = 'Spieltag für Spieltag', sub = 'Einzel gewonnen und verloren je Spieltag, Linie = Punkte aufsummiert';
    if (!sp.length) return stKarte('spieltage', titel, sub, '<p class="st-leer">Noch kein Ergebnis gemeldet.</p>', true);
    var F = ST_FARBE, schmal = window.innerWidth < 700;
    var W = schmal ? 380 : 640, H = schmal ? 230 : 260, L = 28, R = 34, T = 22, B = 34, n = sp.length;
    var mE = Math.max.apply(null, [8].concat(sp.map(function (s) { return Math.max(s.ef, s.ea); })));
    var kum = [], k = 0;
    sp.forEach(function (s) { k += s.pkt; kum.push(k); });
    var mP = Math.max(2, k), bw = (W - L - R) / n;
    var y = function (v) { return T + (1 - v / mE) * (H - T - B); }, yp = function (v) { return T + (1 - v / mP) * (H - T - B); };
    var s = [0, Math.round(mE / 2), mE].map(function (t) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="st-gl"/><text x="' + (L - 6) + '" y="' + (y(t) + 3).toFixed(1) + '" text-anchor="end" class="st-ax">' + t + '</text>'; }).join('') +
      '<text x="' + (W - R + 6) + '" y="' + (yp(mP) + 3).toFixed(1) + '" class="st-ax" style="fill:' + F.gold + '">' + mP + ' Pkt</text>';
    sp.forEach(function (q, i) {
      var m = L + i * bw + bw / 2, w = Math.min(22, bw * 0.3), e = q.pkt === 2 ? ['S', F.gruen] : q.pkt === 1 ? ['U', F.gold] : ['N', F.rot];
      s += '<g class="st-growY" style="animation-delay:' + (i * 80) + 'ms"><rect x="' + (m - w - 1).toFixed(1) + '" y="' + y(q.ef).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (y(0) - y(q.ef)).toFixed(1) + '" rx="3" fill="' + F.gruen + '"/>' +
        '<rect x="' + (m + 1).toFixed(1) + '" y="' + y(q.ea).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (y(0) - y(q.ea)).toFixed(1) + '" rx="3" fill="' + F.rot + '" opacity=".75"/></g>' +
        '<text x="' + m.toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" class="st-ax">' + q.nr + '.</text>' +
        '<text x="' + m.toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="10" font-weight="800" fill="' + e[1] + '">' + e[0] + '</text>' +
        '<rect x="' + (L + i * bw).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B + 20) + '" fill="transparent" data-tip="' + esc('<b>' + q.nr + '. Spieltag · ' + stIsoText(q.tag) + '</b><br>' + (q.heim ? 'Heim' : 'Auswärts') + ' gegen ' + esc(q.gegner) + '<br>Einzel ' + q.ef + ' : ' + q.ea + ' · Legs ' + q.lf + ' : ' + q.la + '<br>Punkte bis hier: ' + kum[i]) + '"/>';
    });
    s += '<path d="' + stLinie(kum.map(function (v, i) { return [L + i * bw + bw / 2, yp(v)]; })) + '" fill="none" stroke="' + F.gold + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="st-draw st-glanz" style="transition-delay:400ms"/>' +
      kum.map(function (v, i) { return '<circle cx="' + (L + i * bw + bw / 2).toFixed(1) + '" cy="' + yp(v).toFixed(1) + '" r="3.6" fill="' + F.gold + '" stroke="#0d0a0b" stroke-width="1.4" class="st-pt" style="animation-delay:' + (700 + i * 90) + 'ms"/>'; }).join('');
    var legende = '<div class="st-legende"><span><i style="background:' + F.gruen + '"></i>Einzel gewonnen</span><span><i style="background:' + F.rot + '"></i>Einzel verloren</span><span><i style="background:' + F.gold + '"></i>Punkte aufsummiert</span></div>';
    return stKarte('spieltage', titel, sub, '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>' + legende, zwei ? 'zwei' : true);
  }
  /* Punkte je Spieler in der Einzelrangliste; bei uns mit dem Liga-Ø aus der App, ein Tipp oeffnet die Person. */
  function stKaderKarte(d, name) {
    var wir = name === LIGA.team, er = d.er.filter(function (z) { return z.team === name; });
    var mP = Math.max.apply(null, [1].concat(er.map(function (z) { return z.punkte; })));
    var cl = wir ? careerLiga() : null;
    var html = er.length ? '<div class="st-kliste">' + er.map(function (z, i) {
      var p = wir ? stProfilZuName(z.name) : null, ls = p && cl ? cl[p.id] : null, q = z.siege + z.nied ? z.siege / (z.siege + z.nied) : 0;
      var innen = '<span class="st-krang">' + z.platz + '.</span><span class="st-kname"><b>' + esc(z.name) + (z.gast ? '<span class="st-gast">Gast</span>' : '') + '</b>' +
        '<small>Einzel ' + z.siege + ' : ' + z.nied + ' · Legs ' + z.lf + ':' + z.la + (ls && ls.darts ? ' · Ø ' + ls.avg.toFixed(1) : '') + '</small></span>' +
        stBalken(z.punkte / mP * 100, stQuoteFarbe(q * 0.6)) + '<span class="st-kwert">' + z.punkte + '</span>';
      return p ? '<button type="button" class="st-krow" style="animation-delay:' + (i * 50) + 'ms" data-action="stats-person" data-wert="' + esc(p.id) + '">' + innen + '</button>'
        : '<div class="st-krow" style="animation-delay:' + (i * 50) + 'ms">' + innen + '</div>';
    }).join('') + '</div>' : '<p class="st-leer">Noch kein Spielbericht.</p>';
    return stKarte('kader', 'Kader-Beitrag', 'Punkte je Spieler in der Einzelrangliste (Sieg = 2 + Leg-Differenz)' + (wir ? ', dazu der Liga-Ø aus der App. Tipp öffnet die Person.' : ''), html);
  }
  function stTabelleKarte(d, name) {
    var zs = d.tab.zeilen, mP = Math.max.apply(null, [1].concat(zs.map(function (z) { return z.punkte; })));
    var html = '<div class="st-kliste">' + zs.map(function (z, i) {
      var an = z.team === name, u = z.team === LIGA.team;
      return '<button type="button" class="st-krow' + (an ? ' an' : '') + (u ? ' wir' : '') + '" style="animation-delay:' + (i * 40) + 'ms" data-action="stats-team" data-wert="' + esc(u ? 'wir' : z.team) + '">' +
        '<span class="st-krang">' + (i + 1) + '.</span><span class="st-kname"><b>' + esc(z.team) + '</b><small>' + z.g + ' S · ' + z.u + ' U · ' + z.v + ' N · Legs ' + esc(z.legs) + '</small></span>' +
        stBalken(z.punkte / mP * 100, an ? ST_FARBE.gold : u ? ST_FARBE.rot : '#5b5153') + '<span class="st-kwert">' + z.punkte + '</span></button>';
    }).join('') + '</div>';
    return stKarte('tabelle', 'Tabelle', 'Punkte aller Teams, berechnet aus den Ergebnissen der Ligaleitung. Tipp wählt das Team.', html);
  }
  function stTeamGegnerKarte(sp) {
    var o = {}, r = [];
    sp.forEach(function (s) {
      if (!o[s.gegner]) { o[s.gegner] = { name: s.gegner, sp: [], ef: 0, ea: 0, lf: 0, la: 0 }; r.push(o[s.gegner]); }
      var x = o[s.gegner];
      x.sp.push(s); x.ef += s.ef; x.ea += s.ea; x.lf += s.lf; x.la += s.la;
    });
    var html = r.length ? '<table class="st-tab"><thead><tr><th>Gegner</th><th>Ergebnisse</th><th class="n">Einzel</th><th class="n">Legs</th><th class="q">Einzel-Quote</th></tr></thead><tbody>' + r.map(function (x, i) {
      var q = x.ef + x.ea ? x.ef / (x.ef + x.ea) * 100 : 0, c = q > 50 ? ST_FARBE.gruen : q === 50 ? ST_FARBE.gold : ST_FARBE.rot;
      return '<tr class="st-fade" style="animation-delay:' + (i * 60) + 'ms"><td><b>' + esc(x.name) + '</b></td><td>' + x.sp.map(function (s) {
        return '<span class="st-erg ' + (s.pkt === 2 ? 'w' : s.pkt ? 'u' : 'l') + '" data-tip="' + esc('<b>' + s.nr + '. Spieltag · ' + stIsoText(s.tag) + '</b><br>' + (s.heim ? 'Heim' : 'Auswärts') + ' · Legs ' + s.lf + ' : ' + s.la) + '">' + s.ef + ':' + s.ea + '</span>';
      }).join('') + '</td><td class="n" style="color:' + c + '">' + x.ef + ' : ' + x.ea + '</td><td class="n">' + x.lf + ' : ' + x.la + '</td><td>' + stBalken(q, c) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="st-leer">Noch keine Begegnung.</p>';
    return stKarte('teamgegner', 'Bilanz gegen jedes Team', 'Jede Begegnung mit Einzel und Legs', html);
  }
  /* 180er, Highfinishes, Shortlegs laut Spielberichten - eines Teams oder der ganzen Liga. */
  function stHlKarte(d, name) {
    var nur = function (l) { return name ? l.filter(function (h) { return h.team === name; }) : l; };
    var g = function (t, l, w) {
      if (!l.length) return '';
      return '<div class="st-art"><span class="st-art-titel">' + t + '</span><div class="st-hl">' + l.slice(0, 6).map(function (h, i) {
        return '<div class="st-hlz' + (h.team === LIGA.team ? ' wir' : '') + '" style="animation-delay:' + (i * 50) + 'ms"><b>' + w(h) + '</b><span>' + esc(h.name) + (name ? '' : '<small>' + esc(h.team) + '</small>') + '</span></div>';
      }).join('') + '</div></div>';
    };
    var inhalt = g('180er', nur(d.hl.s180), function (h) { return h.n + '×'; }) + g('Highfinishes', nur(d.hl.highfinish), function (h) { return h.wert; }) + g('Shortlegs', nur(d.hl.shortleg), function (h) { return h.wert + ' D'; });
    return stKarte('highlights', 'Highlights', 'Laut Spielberichten der Ligaleitung' + (name ? '' : ', ganze Liga'), inhalt || '<p class="st-leer">Noch keine Highlights gemeldet.</p>');
  }
  /* Liga-Rangliste aus der Einzelrangliste: Bestwert-Kacheln je Kennzahl,
     die Liste dazu, rechts die Highlights. */
  function stLigaRangHtml(d, name) {
    var rows = d.er.filter(function (z) { return !name || z.team === name; }), st = statsUI();
    var def = ST_LIGA_KZ.filter(function (k) { return k[0] === st.liga; })[0] || ST_LIGA_KZ[0];
    var sortiert = function (k) { return rows.filter(function (z) { return k[2](z) !== null; }).sort(function (a, b) { return k[2](b) - k[2](a) || a.platz - b.platz; }); };
    var titel = 'Liga-Rangliste' + (name ? (name === LIGA.team ? '' : ' · ' + esc(name)) : ' · ganze Liga');
    return '<div class="st-rang" id="st-ligarang"><div class="st-rang-kopf"><h3>' + titel + '</h3><span>nur Ligaspiele · ' + esc(LIGA.saison) + '</span></div>' +
      '<div class="st-rgrid"><div><div class="st-kacheln">' + ST_LIGA_KZ.map(function (k) {
        var t = sortiert(k)[0];
        return '<button type="button" class="st-kachel' + (k === def ? ' on' : '') + '" data-action="stats-liga" data-wert="' + k[0] + '"><span class="t">' + k[1] + '</span><span class="v">' + (t ? k[3](k[2](t)) : '–') + '</span><span class="n">' + (t ? esc(t.name) : 'noch offen') + '</span></button>';
      }).join('') + '</div>' +
      '<div class="st-liste"><h4><span>' + def[1] + ' · ' + (name ? 'Spieler' : 'alle Spieler') + '</span><span>nur Ligaspiele</span></h4>' +
        (rows.length ? sortiert(def).slice(0, 12).map(function (z, i) { return stLrow(i, z.name, z.team, def[3](def[2](z)), z.team === LIGA.team ? ST_FARBE.rot : '#5b6a7a'); }).join('') : '<p class="st-leer">Noch kein Spielbericht.</p>') +
      '</div></div><div class="st-seite">' + stHlKarte(d, name === LIGA.team ? LIGA.team : name) + '</div></div></div>';
  }

  /* ---- Mannschaft · alle Spielarten (die Crew) ---- */
  function stCrewHtml() {
    var crew = statsCrew();
    var je = crew.map(function (p) { return { p: p, spiele: spielerSpiele(p.id) }; });
    /* Jeder Einsatz zaehlt fuer Average und Co. (ein Duell zweier Crew-Spieler
       steht zweimal drin, je mit den eigenen Wuerfen); fuer Spielzahlen und
       Kalender zaehlt jedes Spiel einmal. */
    var alle = [], gesehen = {};
    je.forEach(function (r) { r.spiele.forEach(function (s) { alle.push(s); }); });
    alle.sort(function (a, b) { return a.at - b.at; });
    var eindeutig = alle.filter(function (s) { if (gesehen[s.id]) return false; gesehen[s.id] = 1; return true; });
    var s = statsSumme(alle), F = ST_FARBE;
    var andere = wertbareHistorie().filter(function (h) {
      return (h.kind || '501') !== '501' && h.kind !== 'quick' && (h.players || []).some(function (id) { return crew.some(function (p) { return p.id === id; }); });
    }).length;
    var h = stWer('team', '', esc(LIGA.team), plural(crew.length, 'Spieler', 'Spieler') + ' im Kader · alle Spielarten: Liga, Turnier, Schnell und Solo');
    if (!s) return h + '<p class="st-leer">Noch keine Spiele.</p>';
    h += stKpiHtml([
      ['Spiele', eindeutig.length + andere, 0, '', F.creme, eindeutig.length + ' X01 · ' + andere + ' andere'],
      ['Team-Average', s.avg, 1, '', F.blau, 'aus ' + Math.round(s.darts) + ' Darts'],
      ['First 9', s.first9, 1, '', F.lila, 'Scoring-Antritt der Crew'],
      ['Doppelquote', s.dbl, 1, ' %', F.gruen, s.att ? s.hits + ' von ' + s.att : ''],
      ['180er', s.c180, 0, '', F.rot, s.c140 + '× 140+ · ' + s.c100 + '× 100+'],
      ['Höchstes Finish', s.hf || null, 0, '', F.gold, s.bl ? 'bestes Leg ' + s.bl + ' Darts' : '']
    ]);
    return h + '<div class="st-raster">' + stKaderVergleichKarte(je) + stKalenderKarte(eindeutig, { modus: 'alle', bereich: 0 }) + stCrewFormKarte(alle, eindeutig) + stBigKarte(alle) + stDblTrendKarte(alle) + '</div>';
  }
  function stKaderVergleichKarte(je) {
    var st = statsUI(), d = ST_KZ.filter(function (k) { return k[0] === st.kader; })[0] || ST_KZ[0];
    var rows = je.map(function (r) { return { p: r.p, s: statsSumme(r.spiele) }; }).filter(function (r) { var v = r.s ? d[2](r.s) : null; return v !== null && v !== undefined && isFinite(v); });
    rows.sort(function (a, b) { return d[5] ? d[2](a.s) - d[2](b.s) : d[2](b.s) - d[2](a.s); });
    var w = rows.map(function (r) { return d[2](r.s); });
    var best = w.length ? (d[5] ? Math.min.apply(null, w) : Math.max.apply(null, w)) : 0;
    var eng = d[0] === 'avg' || d[0] === 'first9', lo = eng && w.length ? Math.min.apply(null, w) - Math.max(2, (best - Math.min.apply(null, w)) * 0.6) : 0;
    var chips = '<div class="st-chips klein">' + ST_KZ.map(function (k) { return stChip('stats-kader', k[0], k[1], k === d); }).join('') + '</div>';
    var liste = rows.length ? '<div class="st-kliste">' + rows.map(function (r, i) {
      var v = d[2](r.s), a = d[5] ? best / v : best - lo ? (v - lo) / (best - lo) : (v > 0 ? 1 : 0);
      return '<button type="button" class="st-krow" style="animation-delay:' + (i * 50) + 'ms" data-action="stats-person" data-wert="' + esc(r.p.id) + '"><span class="st-krang' + (i < 3 ? ' m' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
        '<span class="st-kname"><b><i class="st-dot" style="background:' + playerColor(r.p.id) + '"></i>' + esc(r.p.name) + '</b><small>' + plural(r.s.matches, 'Spiel', 'Spiele') + ' mit Gegner</small></span>' +
        stBalken(a * 100, playerColor(r.p.id)) + '<span class="st-kwert">' + d[3](v) + '</span></button>';
    }).join('') + '</div>' : '<p class="st-leer">Dafür fehlen noch Daten.</p>';
    return stKarte('kadervergleich', 'Kader im Vergleich', d[4] + ' Tipp öffnet die Person.', chips + liste, 'zwei');
  }
  /* Saeulen = X01-Spiele der Crew je Monat, Linie = Team-Average. */
  function stCrewFormKarte(alle, eindeutig) {
    var titel = 'Team-Form je Monat', sub = 'Säulen = X01-Spiele der Crew, Linie = Team-Average';
    var zaehl = {};
    eindeutig.forEach(function (s) { var k = stMonat(s.at); zaehl[k] = (zaehl[k] || 0) + 1; });
    var d = stMonate(alle).slice(-8).map(function (e) {
      var p = sum(e.gs, function (s) { return s.st.points; }), dd = sum(e.gs, function (s) { return s.st.darts; });
      return { k: e.k, n: zaehl[e.k] || 0, avg: dd ? p / dd * 3 : null };
    }).filter(function (q) { return q.avg !== null; });
    if (d.length < 2) return stKarte('crewform', titel, sub, '<p class="st-leer">Mindestens 2 Monate mit Spielen nötig.</p>');
    var F = ST_FARBE, W = 340, H = 230, L = 30, R = 34, T = 16, B = 24;
    var mN = Math.max.apply(null, d.map(function (q) { return q.n; })) || 1, av = d.map(function (q) { return q.avg; });
    var lo = Math.floor(Math.min.apply(null, av) - 3), hi = Math.ceil(Math.max.apply(null, av) + 3), bw = (W - L - R) / d.length;
    if (hi - lo < 6) hi = lo + 6;
    var y = function (v) { return T + (1 - v / mN) * (H - T - B); }, ya = function (v) { return T + (hi - v) * (H - T - B) / (hi - lo); };
    var s = [lo, Math.round((lo + hi) / 2), hi].map(function (t) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ya(t).toFixed(1) + '" y2="' + ya(t).toFixed(1) + '" class="st-gl"/><text x="' + (W - R + 4) + '" y="' + (ya(t) + 3).toFixed(1) + '" class="st-ax" style="fill:' + F.blau + '">' + t + '</text>'; }).join('') +
      '<text x="' + (L - 6) + '" y="' + (y(mN) + 3).toFixed(1) + '" text-anchor="end" class="st-ax">' + mN + '</text>';
    d.forEach(function (q, i) {
      var x = L + i * bw + bw * 0.22, w = bw * 0.56;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y(q.n).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (y(0) - y(q.n)).toFixed(1) + '" rx="4" fill="#ffffff1a" class="st-growY" style="animation-delay:' + (i * 80) + 'ms"/>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="st-ax">' + stMonatText(q.k) + '</text>' +
        '<rect x="' + (L + i * bw).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent" data-tip="' + esc('<b>' + stMonatText(q.k) + '</b><br>' + plural(q.n, 'Spiel', 'Spiele') + '<br>Team-Ø ' + q.avg.toFixed(1)) + '"/>';
    });
    var pts = d.map(function (q, i) { return [L + i * bw + bw / 2, ya(q.avg)]; });
    s += '<path d="' + stLinie(pts) + '" fill="none" stroke="' + F.blau + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="st-draw"/>' +
      pts.map(function (p, i) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="#0d0a0b" stroke="' + F.blau + '" stroke-width="2.2" class="st-pt" style="animation-delay:' + (400 + i * 120) + 'ms"/>'; }).join('');
    return stKarte('crewform', titel, sub, '<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg><div class="st-legende"><span><i style="background:#ffffff33"></i>Spiele</span><span><i style="background:' + F.blau + '"></i>Team-Average</span></div>');
  }

  /* ---- Der Reiter ---- */
  function renderStats() {
    var st = statsUI();
    var ebene = st.ebene === 'team' ? 'team' : 'person';
    var screen = $('screen-stats');
    screen.classList.toggle('st-team', ebene === 'team');
    $('stats-ebene').querySelectorAll('button').forEach(function (b) { var an = b.getAttribute('data-wert') === ebene; b.classList.toggle('on', an); b.setAttribute('aria-selected', an ? 'true' : 'false'); });
    stLigaCache = null;
    /* Die Bestenlisten (Rangliste je Spielart) gehoeren zur Mannschaft. */
    var zeigRang = ebene === 'team';
    $('stats-rang').classList.toggle('hidden', !zeigRang);
    if (!zeigRang) UI.boardLog = false;
    $('stats-main').innerHTML = ebene === 'person' ? statsPersonSeiteHtml() : statsTeamSeiteHtml();
    if (zeigRang) renderBoards();
    var f = statsFilter(), dash = $('stats-main').querySelector('.st-dash');
    /* Kennzahl-Kacheln und Vergleichs-Chips wechseln still (kein neuer Schluessel). */
    statsNachRender(dash, ['stats', ebene, st.spieler, f.modus, f.bereich, dash && dash.getAttribute('data-spiele')].join('|'));
  }

  /* ---------- "Meine besten Finishes ermitteln" ----------
     Vier Schritte: Lieblingsgruppen, Average, Wurftests (je 10 Darts auf
     T20, das Doppel der Hauptgruppe, Bull und T16, alle freiwillig),
     Spielweise. Dann rechnet die Engine (Web Worker) und zeigt, was sich
     gegenueber der bisherigen Tabelle aendert. Erst "Übernehmen" speichert. */
  var BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  var FINISH_TESTS = ['t20', 'doppel', 'bull', 'triple'];
  var FINISH_TRIPLE_ZIEL = 16;
  function nachbarFelder(n) {
    var i = BOARD_ORDER.indexOf(n);
    return [BOARD_ORDER[(i + 19) % 20], BOARD_ORDER[(i + 1) % 20]];
  }
  /* Das Doppel fuer den Doppel-Test: das der Hauptgruppe; ist die Bull,
     das der zweiten Gruppe, sonst D16. */
  function finishDoppelZiel(gruppen) {
    for (var i = 0; i < gruppen.length; i++) if (gruppen[i] !== 'Bull') return doppelAusGruppe(gruppen[i]);
    return 16;
  }
  /* Zaehl-Kategorien je Test, in der Reihenfolge der Anzeige. Die Schluessel
     sind die der Engine (CheckoutEngine.kategorien). */
  function finishTestKategorien(test, gruppen) {
    var nb, z;
    if (test === 't20') return { titel: '10 Darts auf T20', text: 'Wirf 10 Darts auf die Triple 20 und zähle, wo sie landen.', kats: [['treffer', 'T20'], ['s20', '20 oder D20'], ['eins', 'Feld 1 (einfach, Doppel oder Triple)'], ['fuenf', 'Feld 5 (einfach, Doppel oder Triple)'], ['sonst', 'Sonst']] };
    if (test === 'doppel') {
      z = finishDoppelZiel(gruppen); nb = nachbarFelder(z);
      return { titel: '10 Darts auf D' + z, ziel: z, text: 'Wirf 10 Darts auf die Doppel ' + z + '.', kats: [['treffer', 'D' + z], ['innen', z + ' innen (einfach oder Triple)'], ['aussen', 'Draußen, kein Feld'], ['nachbar_' + nb[0], 'Feld ' + nb[0]], ['nachbar_' + nb[1], 'Feld ' + nb[1]], ['sonst', 'Sonst']] };
    }
    if (test === 'bull') return { titel: '10 Darts auf Bull', text: 'Wirf 10 Darts auf das Bull.', kats: [['bull', 'Bull'], ['25', '25'], ['sonst', 'Sonst']] };
    z = FINISH_TRIPLE_ZIEL; nb = nachbarFelder(z);
    return { titel: '10 Darts auf T' + z, ziel: z, text: 'Wirf 10 Darts auf die Triple ' + z + '. Daraus kommt, wie gut dir die kleineren Triple gelingen.', kats: [['treffer', 'T' + z], ['single', z + ' einfach oder D' + z], ['nachbar', 'Feld ' + nb[0] + ' oder ' + nb[1]], ['sonst', 'Sonst']] };
  }
  function finishZaehlerSumme(z) { var n = 0; Object.keys(z || {}).forEach(function (k) { if (k !== 'ziel') n += Number(z[k]) || 0; }); return n; }

  function finishDialogStarten(pid) {
    var p = profile(pid), f = p.finish || {}, st = career()[p.id];
    var tests = {};
    FINISH_TESTS.forEach(function (t) { tests[t] = f.tests && f.tests[t] && typeof f.tests[t] === 'object' ? f.tests[t] : null; });
    var avg = f.avg ? String(f.avg) : (st && st.darts >= MIN_DARTS_FOR_AVG ? st.avg.toFixed(1) : '');
    UI.overlay = { type: 'finish', id: p.id, schritt: 'gruppen', test: 0, zaehler: null,
      draft: { gruppen: finishGruppen(p), avg: avg.replace('.', ','), tests: tests, spielweise: SPIELWEISEN[f.spielweise] ? f.spielweise : 'aufnahmen' },
      avgQuelle: !f.avg && st && st.darts >= MIN_DARTS_FOR_AVG ? plural(st.matches, 'Spiel', 'Spielen') : '' };
    UI.profilGruppenWahl = false;
    render();
  }
  function finishAvgWert(text) {
    var v = parseFloat(String(text || '').replace(',', '.'));
    return isFinite(v) ? Math.round(v * 10) / 10 : NaN;
  }
  function finishTestBetreten(o) {
    var name = FINISH_TESTS[o.test];
    var alt = o.draft.tests[name];
    var tk = finishTestKategorien(name, o.draft.gruppen);
    /* Alte Zaehler nur, wenn sie zum selben Ziel gehoeren (das Doppel
       wechselt mit der Gruppe) und zusammen hoechstens zehn Darts ergeben. */
    if (alt && ((tk.ziel && Number(alt.ziel) !== tk.ziel) || finishZaehlerSumme(ohneZiel(alt)) > 10)) alt = null;
    o.zaehler = {};
    tk.kats.forEach(function (k) { o.zaehler[k[0]] = alt && alt[k[0]] > 0 ? Number(alt[k[0]]) : 0; });
    if (tk.ziel) o.zaehler.ziel = tk.ziel;
  }
  function ohneZiel(z) { var k = {}; Object.keys(z || {}).forEach(function (x) { if (x !== 'ziel') k[x] = z[x]; }); return k; }
  function finishWeiter(o) {
    o.fehler = '';
    if (o.schritt === 'gruppen') { o.schritt = 'average'; return; }
    if (o.schritt === 'average') {
      var a = finishAvgWert(o.draft.avg);
      if (!(a >= 30 && a <= 120)) { o.fehler = 'Bitte einen Average zwischen 30 und 120 eingeben.'; return; }
      o.draft.avg = String(a).replace('.', ',');
      o.schritt = 'tests'; o.test = 0; finishTestBetreten(o); return;
    }
    if (o.schritt === 'tests') {
      var name = FINISH_TESTS[o.test];
      if (finishZaehlerSumme(o.zaehler) !== 10) { o.fehler = 'Bitte alle 10 Darts zählen oder den Test überspringen.'; return; }
      o.draft.tests[name] = o.zaehler;
      finishNaechsterTest(o); return;
    }
    if (o.schritt === 'spielweise') finishRechnen(o);
  }
  function finishNaechsterTest(o) {
    if (o.test < FINISH_TESTS.length - 1) { o.test++; finishTestBetreten(o); }
    else { o.schritt = 'spielweise'; o.zaehler = null; }
  }
  function finishZurueck(o) {
    o.fehler = '';
    if (o.schritt === 'average') o.schritt = 'gruppen';
    else if (o.schritt === 'tests') {
      if (o.test > 0) { o.test--; finishTestBetreten(o); } else o.schritt = 'average';
    } else if (o.schritt === 'spielweise') { o.schritt = 'tests'; o.test = FINISH_TESTS.length - 1; finishTestBetreten(o); }
    else if (o.schritt === 'ergebnis') o.schritt = 'spielweise';
  }
  function finishEingabe(d) {
    var e = { avg: finishAvgWert(d.avg), favoriten: finishFavoriten(d.gruppen), ziel: 'aufnahmen' };
    FINISH_TESTS.forEach(function (t) {
      var z = d.tests[t];
      if (!z || !finishZaehlerSumme(z)) return;
      var kopie = {};
      Object.keys(z).forEach(function (k) { if (k !== 'ziel') kopie[k] = Number(z[k]) || 0; });
      if (t === 'doppel') kopie.ziel = finishDoppelZiel(d.gruppen);
      if (t === 'triple') kopie.ziel = FINISH_TRIPLE_ZIEL;
      e[t] = kopie;
    });
    return e;
  }
  function finishRechnen(o) {
    var p = profile(o.id);
    o.schritt = 'rechnet'; o.fehler = '';
    render();
    Checkout.rechnen({ eingabe: finishEingabe(o.draft) }).then(function (erg) {
      if (UI.overlay !== o) return;
      o.ergebnis = erg;
      o.unterschiede = finishUnterschiede(p, erg, o.draft.spielweise);
      o.schritt = 'ergebnis';
      render();
    }, function (err) {
      if (UI.overlay !== o) return;
      o.schritt = 'spielweise';
      o.fehler = 'Die Berechnung ist fehlgeschlagen: ' + (err && err.message ? err.message : err);
      render();
    });
  }
  /* "Das ändert sich für dich": je Rest der Weg mit drei Darts, bisher
     (eigene Tabelle oder feste Tabelle der Hauptgruppe) gegen neu. */
  function wegText(rest, lieblings) {
    var w = Checkout.suggest(rest, 3, lieblings);
    if (w) return w.join(' ');
    var stw = Checkout.stellwurf(rest, 3, lieblings);
    return stw ? stw.darts.join(' ') + ' >' + stw.auf : '';
  }
  function finishUnterschiede(p, erg, spielweise) {
    /* Gleiche Variante gegen gleiche Variante: wer Checkout spielt, sieht
       die Checkout-Wege bisher gegen neu, sonst die Aufnahmen-Wege. Ohne
       eigene Tabelle ist "bisher" die feste Tabelle der Hauptgruppe. */
    var f = p.finish || {}, co = spielweise === 'checkout';
    var tabelle = co && erg.tabelleCheckout ? erg.tabelleCheckout : erg.tabelle;
    var alt = co ? (f.tabelleCheckout || f.tabelle) : f.tabelle;
    var dbl = DOPPEL_WAHL.indexOf(p.dbl) >= 0 ? p.dbl : null;
    var bisher = dbl || alt ? { dbl: dbl, tabelle: alt && typeof alt === 'object' ? alt : null } : null;
    var out = [];
    for (var r = 2; r <= MAX_CHECKOUT; r++) {
      var neu = String(tabelle[r] || '').split('|')[0];
      var alt = wegText(r, bisher);
      if (neu && alt !== neu) out.push({ rest: r, alt: alt, neu: neu });
    }
    return out;
  }
  function finishUebernehmen(o) {
    var p = profile(o.id), erg = o.ergebnis;
    if (!p || !erg) return;
    finishGruppenSetzen(p, o.draft.gruppen);
    p.finish.avg = finishAvgWert(o.draft.avg);
    p.finish.tests = o.draft.tests;
    p.finish.spielweise = o.draft.spielweise;
    p.finish.profil = erg.profil;
    p.finish.tabelle = erg.tabelle;
    p.finish.tabelleCheckout = erg.tabelleCheckout || null;
    p.finish.stand = Date.now();
    if (window.DartKonto) window.DartKonto.profilGeaendert(p.id);
    UI.overlay = null;
    save(); render();
  }

  function finishDialogHtml(o) {
    var d = o.draft;
    var schrittNr = { gruppen: 1, average: 2, tests: 3, spielweise: 4, rechnet: 4, ergebnis: 4 }[o.schritt];
    var kopf = function (sub) {
      return '<div class="dl-kopf"><h3>Meine besten Finishes</h3><p>' + (schrittNr ? 'Schritt ' + schrittNr + ' von 4 · ' : '') + sub + '</p></div>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '');
    };
    var fuss = function (weiterText, zurueck) {
      return '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        (zurueck ? '<button class="btn ghost" data-action="fi-zurueck">Zurück</button>' : '') +
        (weiterText ? '<button class="btn hell" data-action="fi-weiter">' + weiterText + '</button>' : '') + '</div>';
    };
    if (o.schritt === 'gruppen') {
      return kopf('Welche Doppel magst du? Bis zu zwei Gruppen, die erste ist die Hauptgruppe.') +
        '<div class="fi-gruppen">' + FINISH_GRUPPEN.map(function (g) {
          var an = d.gruppen.indexOf(g);
          return '<button class="dl-wahl' + (an >= 0 ? ' active' : '') + '" data-action="fi-gruppe" data-value="' + g + '">' +
            '<span class="dl-k">' + (an === 0 ? '1' : an === 1 ? '2' : '') + '</span>' +
            '<span class="dl-wer"><b>' + g + '</b><small>' + (FINISH_KETTE[g].length > 1 ? FINISH_KETTE[g].join(' · ') : 'Bull') + '</small></span></button>';
        }).join('') + '</div>' +
        '<p class="dl-note">Ohne Gruppe rechnet die Engine den Standardweg, der nur nach Darts und Chancen geht.</p>' +
        fuss('Weiter', false);
    }
    if (o.schritt === 'average') {
      return kopf('Dein 3-Dart-Average. Er bestimmt, wie eng du streust.') +
        '<div class="fi-avg"><input class="dl-input" type="text" inputmode="decimal" data-role="fi-avg" value="' + esc(d.avg) + '" placeholder="zum Beispiel 55" maxlength="6" aria-label="3-Dart-Average"></div>' +
        '<p class="dl-note">' + (o.avgQuelle ? 'Vorbelegt aus deinen ' + o.avgQuelle + ' in der App. ' : '') +
          'Nimm den Wert, den du bei normalen Spielen wirfst. Du kannst ihn jederzeit ändern.</p>' +
        fuss('Weiter', true);
    }
    if (o.schritt === 'tests') {
      var name = FINISH_TESTS[o.test], tk = finishTestKategorien(name, d.gruppen);
      var summe = finishZaehlerSumme(o.zaehler);
      return kopf('Wurftest ' + (o.test + 1) + ' von ' + FINISH_TESTS.length + ' · ' + tk.titel + '. Freiwillig, macht die Tabelle aber genauer.') +
        '<p class="dl-info">' + tk.text + '</p>' +
        '<div class="fi-zaehler">' + tk.kats.map(function (k) {
          var n = o.zaehler[k[0]] || 0;
          return '<div class="fi-zeile"><span class="fi-label">' + k[1] + '</span>' +
            '<button class="fi-minus" data-action="fi-zaehl" data-kat="' + k[0] + '" data-d="-1" aria-label="weniger"' + (n ? '' : ' disabled') + '>−</button>' +
            '<b class="fi-n">' + n + '</b>' +
            '<button class="fi-plus" data-action="fi-zaehl" data-kat="' + k[0] + '" data-d="1" aria-label="mehr"' + (summe >= 10 ? ' disabled' : '') + '>+</button></div>';
        }).join('') + '</div>' +
        '<p class="dl-info fi-rest">' + (summe >= 10 ? 'Alle 10 Darts gezählt.' : 'Noch ' + plural(10 - summe, 'Dart', 'Darts') + ' zu zählen.') + '</p>' +
        '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
          '<button class="btn ghost" data-action="fi-zurueck">Zurück</button>' +
          '<button class="btn ghost" data-action="fi-test-weg">Überspringen</button>' +
          '<button class="btn hell" data-action="fi-weiter"' + (summe === 10 ? '' : ' disabled') + '>Weiter</button></div>';
    }
    if (o.schritt === 'spielweise') {
      var sw = [
        ['aufnahmen', 'Aufnahmen', 'Möglichst wenige Aufnahmen bis zum Finish. Der normale Weg.'],
        ['checkout', 'Checkout', 'Die höchste Chance, noch in dieser Aufnahme zu finishen, auch wenn es im Schnitt länger dauert.'],
        ['auto', 'Automatisch', 'Checkout, wenn der Gegner im nächsten Besuch finishen kann oder es das entscheidende Leg ist. Sonst Aufnahmen.']
      ];
      return kopf('Wie spielst du deine Finishes?') +
        '<div class="dl-liste">' + sw.map(function (w) {
          return '<button class="dl-wahl' + (d.spielweise === w[0] ? ' active' : '') + '" data-action="fi-spielweise" data-value="' + w[0] + '">' +
            '<span class="dl-wer"><b>' + w[1] + '</b><small>' + w[2] + '</small></span></button>';
        }).join('') + '</div>' +
        fuss('Finishes ermitteln', true);
    }
    if (o.schritt === 'rechnet') {
      return kopf('Die Engine rechnet deine Tabelle.') +
        '<p class="dl-info fi-warte">Einen Moment, das dauert ein paar Sekunden …</p>' +
        '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button></div>';
    }
    if (o.schritt === 'ergebnis') {
      var u = o.unterschiede || [], pr = o.ergebnis.profil;
      var zeige = u.slice(0, 12);
      var werte = 'Streuung ' + Math.round(pr.sigma_x) + ' × ' + Math.round(pr.sigma_y) + ' mm' +
        (pr.f_doppel !== 1 ? ' · Doppel ' + pr.f_doppel.toFixed(2).replace('.', ',') : '') +
        (pr.f_bull !== 1 ? ' · Bull ' + pr.f_bull.toFixed(2).replace('.', ',') : '') +
        (pr.f_triple !== 1 ? ' · Triple ' + pr.f_triple.toFixed(2).replace('.', ',') : '');
      return kopf('Fertig. ' + werte + '.') +
        '<div class="kt">Das ändert sich für dich</div>' +
        (u.length
          ? '<p class="dl-info">' + plural(u.length, 'Rest bekommt', 'Reste bekommen') + ' mit drei Darts einen anderen Weg als bisher' + (d.spielweise === 'checkout' ? ' (Checkout-Wege)' : '') + '.</p>' +
            '<div class="fi-diffs">' + zeige.map(function (x) {
              return '<div class="fi-diff"><span class="fi-rest">' + x.rest + '</span><span class="fi-alt">' + esc(x.alt || '?') + '</span>' +
                '<span class="fi-pfeil" aria-hidden="true">›</span><span class="fi-neu">' + esc(x.neu) + '</span></div>';
            }).join('') + '</div>' +
            (u.length > zeige.length ? '<p class="dl-note">und ' + (u.length - zeige.length) + ' weitere.</p>' : '')
          : '<p class="dl-info">Mit drei Darts bleibt alles wie bisher. Die Tabelle gehört trotzdem dir: Spielweise und Wurftests stecken drin.</p>') +
        (finishEigeneAnzahl(profile(o.id)) ? '<p class="dl-note">' + plural(finishEigeneAnzahl(profile(o.id)), 'eigener Eintrag bleibt', 'eigene Einträge bleiben') + ' wie angepasst stehen.</p>' : '') +
        '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Verwerfen</button>' +
          '<button class="btn ghost" data-action="fi-zurueck">Zurück</button>' +
          '<button class="btn hell" data-action="fi-uebernehmen">Übernehmen</button></div>';
    }
    return '';
  }

  /* ================= Liga-Spielplan ================= */

  var ligaZusagen = null;   // { terminId: [{id, name, hue, status}] } vom Server
  /* "Ich bin dabei" kam nicht beim Server an: sichtbar sagen, statt still
     zu schweigen - sonst glaubt der Spieler, er habe zugesagt, und die
     Erinnerung kommt trotzdem. Die Leiste "Kein Netz" (sync.js) steht
     daneben; hier der Hinweis zur konkreten Handlung. */
  function zusageFehlgeschlagen(e) {
    var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    UI.overlay = { type: 'hinweis', titel: offline ? 'Kein Netz' : 'Zusage nicht gespeichert',
      text: offline
        ? 'Die Zusage kam nicht beim Server an. Sobald wieder Netz da ist, bitte erneut tippen.'
        : 'Der Server hat die Zusage nicht angenommen' + (e && e.message ? ' (' + e.message + ')' : '') + '. Bitte später erneut tippen.' };
    render();
  }
  /* Bild und Farbe zu einer Zusage kommen aus dem Kader (der Server schickt
     keine Fotos mehr mit); kennt das Geraet den Spieler nicht, reichen
     Name und Farbton aus der Antwort. */
  function zusageProfil(a) {
    for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === a.id) return S.profiles[i];
    return { id: a.id, name: a.name, avatar: a.avatar || null, hue: a.hue };
  }
  var ligaTabelleKennung = null;

  var LIGA_TEAMS = window.LIGA_DATEN.teams;
  /* Die Tabelle wird aus den Ergebnissen aller Spieltage gerechnet
     (js/liga-daten.js, LIGA_SPIELTAGE) - nicht mehr von Hand gepflegt. */
  function ligaTabelleBerechnet() { return window.LIGA_DATEN.tabelleAus(LIGA_SPIELTAGE, LIGA_TEAMS); }

  /* Die Ergebnisse der Ligaleitung holt der Server stuendlich neu und
     liefert sie als js/liga-sdm.js aus (server/lib/liga.mjs). Die App laedt
     die Datei beim Start - und, damit ein tagelang offenes iPad nicht beim
     alten Stand bleibt, beim Oeffnen des Liga-Reiters hoechstens alle
     15 Minuten noch einmal nach: als <script>, denn eval erlaubt die CSP
     nicht. Hat sich etwas geaendert, laeuft js/liga-daten.js erneut (es
     mischt LIGA_HAND dazu und gleicht die Termine ab), die drei Bindungen
     hier werden umgehaengt und der Reiter neu gezeichnet. Ohne Server
     (Einzeldatei vom AirDrop) scheitert das Laden still. */
  var ligaGeprueft = 0;
  var ligaSdmKennung = JSON.stringify(window.LIGA_SDM || null);
  function skriptLaden(pfad, dann) {
    var s = document.createElement('script');
    s.src = pfad + '?t=' + Date.now();
    s.onload = function () { s.remove(); dann(); };
    s.onerror = function () { s.remove(); };
    document.head.appendChild(s);
  }
  function ligaDatenPruefen(erzwingen) {
    if (!erzwingen && (Date.now() - ligaGeprueft < 15 * 60e3 || navigator.onLine === false)) return;
    ligaGeprueft = Date.now();
    skriptLaden('js/liga-sdm.js', function () {
      var kennung = JSON.stringify(window.LIGA_SDM || null);
      if (kennung === ligaSdmKennung) return;
      ligaSdmKennung = kennung;
      skriptLaden('js/liga-daten.js', function () {
        if (!window.LIGA_DATEN) return;
        LIGA = window.LIGA_DATEN.liga;
        LIGA_SPIELTAGE = window.LIGA_DATEN.spieltage;
        LIGA_TEAMS = window.LIGA_DATEN.teams;
        ligaTabelleKennung = null;
        if (S.screen === 'liga') render();
      });
    });
  }

  /* DiensDarts: das Dienstags-Training. Der naechste Dienstag ist der
     Termin - am Dienstag selbst gilt noch der heutige Abend. */
  function naechsterDienstag() {
    var d = new Date(heuteISO() + 'T12:00:00');
    d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7));
    /* Dienstag mit Ligaspiel ist kein Training (Julius, 10.11.): dann gilt
       die Woche danach - wie beim Server, der an solchen Dienstagen auch
       keine DiensDarts-Umfrage verschickt. */
    for (var i = 0; i < 8; i++) {
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (!LIGA.termine.some(function (t) { return t.tag === iso && t.gast && !t.verschoben; })) break;
      d.setDate(d.getDate() + 7);
    }
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
    var offen = mitglieder.filter(function (m) { return m.gezahlt < konfig.beitrag; }).length;
    var beitragHtml = mitglieder.length ? '<div class="kasse-beitraege"><div class="karte-kopf"><span class="lk-crew-titel">Gründungsbeitrag ' + euro(konfig.beitrag) + ' pro Kopf</span>' +
      '<span class="kb-offen ' + (offen ? 'gelb' : 'gruen') + '">' + (offen ? offen + ' offen' : 'alle bezahlt') + '</span></div>' +
      '<div class="lt-leute">' + mitglieder.map(function (m) {
        var voll = m.gezahlt >= konfig.beitrag;
        return '<span class="lt-person kb-zeile ' + (voll ? 'voll' : 'offen') + '">' +
          avatarHTML({ id: m.id, name: m.name, avatar: m.avatar, hue: m.hue }, 'sm') +
          '<span class="kb-name">' + esc(m.name) + '</span>' +
          '<span class="kb-status">' + (voll ? '✓' : m.gezahlt > 0 ? euro(m.gezahlt) : 'offen') + '</span>' +
          (!voll && (wart || m.id === ich) ? '<button class="btn ghost small" data-action="kasse-beitrag" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">' + (m.id === ich && !wart ? 'Eingezahlt' : 'Bezahlt') + '</button>' : '') +
          '</span>';
      }).join('') + '</div></div>' : '';

    $('kasse-karte').innerHTML =
      '<div class="liga-karte weiss kasse-stand">' +
        '<div class="lk-kopf"><span class="lk-crew-titel">Kassenstand · Kassenjahr ' + konfig.jahr + '</span>' +
          '<span class="hint">Kasse führt: ' + esc(((d && d.kassenwarte) || []).join(', ') || 'noch offen') + '</span></div>' +
        '<span class="ks-saldo ' + (saldo < 0 ? 'minus' : 'plus') + '">' + euro(saldo) + '</span>' +
        '<div class="ks-drei">' +
          '<div><span class="lk-crew-titel">Anfang</span><b>' + euro(konfig.anfangsbestand) + '</b></div>' +
          '<div><span class="lk-crew-titel">Einnahmen</span><b class="plus">+ ' + euro(summeEin) + '</b></div>' +
          '<div><span class="lk-crew-titel">Ausgaben</span><b class="minus">− ' + euro(summeAus) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="card kasse-erfassen">' +
      (darf
        ? '<div class="kasse-form' + (bearbeite ? ' bearbeiten' : '') + '">' +
            '<h3>' + (bearbeite ? 'Buchung Nr. ' + (eintraege.indexOf(bearbeite) + 1) + ' ändern' : 'Eintragen: Einzahlung oder Ausgabe') + '</h3>' +
            (bearbeite ? '' : '<p class="hint">Jede Einzahlung und jede Ausgabe hier eintragen – sie steht sofort im Kassenbuch. ' +
              (((d && d.kassenwarte) || []).join(', ') || 'Wer die Kasse führt,') + ' prüft und verwaltet die Buchungen.</p>') +
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
            '<div class="kasse-knoepfe">' +
              '<button class="btn hell" data-action="kasse-buchen">' + (bearbeite ? 'Änderung speichern' : 'Buchen') + '</button>' +
              (bearbeite
                ? '<button class="btn ghost" data-action="kasse-edit-abbruch">Abbrechen</button>'
                : konfig.paypal
                  ? '<a class="btn ghost kasse-paypal" href="' + esc(konfig.paypal) + '" target="_blank" rel="noopener">Per PayPal einzahlen</a>'
                  : '<span></span>') +
            '</div>' +
            '<p class="hint" id="kasse-meldung"></p>' +
            (wart ? '<details class="kasse-konfig"><summary>Kassenjahr und Anfangsbestand (Kasse)</summary>' +
              '<div class="zeile">' +
                '<input id="kasse-jahr" type="number" min="2000" max="2100" value="' + konfig.jahr + '" aria-label="Kassenjahr">' +
                '<input id="kasse-anfang" type="text" inputmode="decimal" value="' + (konfig.anfangsbestand / 100).toFixed(2).replace('.', ',') + '" aria-label="Anfangsbestand in Euro">' +
              '</div>' +
              '<button class="btn ghost full" data-action="kasse-konfig">Speichern</button>' +
            '</details>' : '') +
          '</div>'
        : '<h2>Buchung erfassen</h2><p class="hint">Zum Ansehen und Eintragen bitte anmelden.</p>' +
          (konfig.paypal ? '<a class="btn ghost full kasse-paypal" href="' + esc(konfig.paypal) + '" target="_blank" rel="noopener">Per PayPal einzahlen</a>' : '')) +
      '</div>';
    $('kasse-buch').innerHTML =
      '<div class="card kasse-liste">' +
        '<div class="karte-kopf"><h2>Kassenbuch</h2><span class="hint">' + plural(zeilen.length, 'Buchung', 'Buchungen') + '</span></div>' +
        '<div class="kasse-zeilen">' + (zeilen.length ? zeilen.slice().reverse().join('') : '<p class="hint">Noch keine Buchung.</p>') + '</div>' +
      '</div>' +
      (beitragHtml ? '<div class="card kasse-beitraege-karte">' + beitragHtml + '</div>' : '');
  }

  /* Highlights der ganzen Saison (nur unsere Spieler, nur echte Spieltage):
     180er, High-Finishes ab 100 und Shortlegs bis 21 Darts - je mit
     Spieltag und Einzel, wie sie der Bogen abfragt. */
  /* DiensDarts als iCal: ein ganztaegiger Eintrag fuer den naechsten Dienstag. */
  function trainingKalender() {
    var d = naechsterDienstag();
    var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var e = new Date(d.getTime()); e.setDate(e.getDate() + 1);
    var ende = e.getFullYear() + String(e.getMonth() + 1).padStart(2, '0') + String(e.getDate()).padStart(2, '0');
    var zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blink 180//Dart Turnier//DE', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:blink180-' + trainingsTerminId(d) + '@darts.wirtschaftln.de',
      'DTSTAMP:' + iso.replace(/-/g, '') + 'T000000Z', 'DTSTART;VALUE=DATE:' + iso.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + ende,
      'SUMMARY:' + icsText('DiensDarts – Training Blink 180'), 'LOCATION:' + icsText('Bar Sehnsucht'), 'END:VEVENT', 'END:VCALENDAR'];
    var blob = new Blob([zeilen.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'blink180-diensdarts.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>';
  var MAPS_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"></path><path d="M9 4v14M15 6v14"></path></svg>';

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
        avatarHTML(zusageProfil(a), 'sm') +
        '<span class="nm">' + esc(a.name) + '</span></div>';
    };

    var MONATE_K = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    var heute0 = new Date(heuteISO() + 'T12:00:00');
    var d12 = new Date(d.getTime()); d12.setHours(12, 0, 0, 0);
    var tage = Math.round((d12 - heute0) / 86400000);
    var wann = tage <= 0 ? 'heute' : tage === 1 ? 'morgen' : 'in ' + tage + ' Tagen';
    var knopf = function (status, text) {
      return '<button class="btn' + (meine === status ? ' hell aktiv' : ' ghost') + '" ' +
        'data-action="training-zusage" data-tid="' + esc(tid) + '" data-status="' + esc(status) + '">' + text + '</button>';
    };
    var gruppe = function (titel, liste, klasse) {
      if (!liste.length && klasse !== 'gruen') return '';
      return '<div class="dd-gruppe ' + klasse + '"><span class="lk-crew-titel">' + titel + ' · <b class="' + klasse + '">' + liste.length + '</b></span>' +
        '<div class="lt-leute">' + (liste.map(function (a) {
          return '<span class="lt-person">' + avatarHTML({ id: a.id, name: a.name, avatar: a.avatar, hue: a.hue }, 'sm') + esc(a.name) + '</span>';
        }).join('') || '<span class="muted">Noch keine Zusage.</span>') + '</div></div>';
    };
    $('dienstdarts-karte').innerHTML =
      '<div class="lk-kopf"><span class="lk-etikett">Nächstes Training · ' + wann + '</span>' +
        '<span class="lk-icons">' +
          '<a class="icon-btn rund" href="https://maps.apple.com/?q=' + encodeURIComponent('Bar Sehnsucht München') + '" target="_blank" rel="noopener" title="Route in Maps" aria-label="Route in Maps">' + MAPS_SVG + '</a>' +
          '<button class="icon-btn rund" data-action="training-ical" title="In den Kalender" aria-label="In den Kalender">' + KALENDER_SVG + '</button>' +
        '</span></div>' +
      '<div class="dd-kopf"><div class="sehnsucht-logo" role="img" aria-label="Sehnsucht Divebar Munich"></div>' +
        '<div class="dd-titel-block"><span class="dd-name">DiensDarts</span>' +
          '<span class="dd-datum">' + ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ' ' + d.getDate() + '. ' + MONATE_K[d.getMonth()] + '</span>' +
          '<span class="lk-ort">' + PIN_SVG + 'Bar Sehnsucht · jeden Dienstag</span></div></div>' +
      (online
        ? '<div class="dd-antworten">' + knopf('dabei', 'Bin dabei') + knopf('unsicher', 'Unsicher') + knopf('absage', 'Kann nicht') + '</div>'
        : '<p class="hint">Dienstags ist Dart-Training in der Bar Sehnsucht. Zum Abstimmen bitte anmelden.</p>') +
      '<div class="dd-liste">' +
        gruppe('Kommen', dabei, 'gruen') + gruppe('Unsicher', unsicher, 'gelb') + gruppe('Kann nicht', absagen, 'rot') +
      '</div>';

    /* Rechts: das Uebungs-Ligaspiel mit Vorwahl von Gegner und Bot-Staerke. */
    var ug = UI.uebungGegner || 'mittel';
    var wahl = function (aktion, wert, text, klein) {
      return '<button class="' + (ug === wert ? 'active' : '') + '" data-action="' + aktion + '" data-value="' + wert + '">' +
        '<span>' + text + '</span>' + (klein ? '<small>' + klein + '</small>' : '') + '</button>';
    };
    $('uebung-karte').innerHTML =
      '<h2 class="gross">Übungs-Ligaspiel</h2>' +
      '<p class="hint">Der komplette Liga-Ablauf zum Üben: 16 Einzel in Bogen-Reihenfolge, zwei Scheiben, Team-Stand und Spielbericht. Zählt nirgends in die Liga-Wertung.</p>' +
      '<div class="setting"><label>Gegner</label><div class="options">' +
        (ligaNaechsterTermin() ? wahl('uebung-vorwahl', 'liga', 'Nächster Gegner', (function (t) { return t.heim === LIGA.team ? t.gast : t.heim; })(ligaNaechsterTermin())).replace('<button class="', '<button class="breit ') : '') +
        wahl('uebung-vorwahl', 'team', 'Zweites eigenes Team') +
        '<button class="' + (ug !== 'team' && ug !== 'liga' ? 'active' : '') + '" data-action="uebung-vorwahl" data-value="bots"><span>Gegen Bots</span></button>' +
      '</div></div>' +
      (ug !== 'team' && ug !== 'liga'
        ? '<div class="setting"><label>Bot-Stärke</label><div class="options drei">' +
            wahl('uebung-vorwahl', 'leicht', 'Leicht', '≈ 38er-Aufnahmen') + wahl('uebung-vorwahl', 'mittel', 'Mittel', '≈ 52') + wahl('uebung-vorwahl', 'schwer', 'Schwer', '≈ 72') +
          '</div></div>'
        : '') +
      '<div class="luft"></div>' +
      '<button class="btn primary start full" data-action="uebung-start">Übungsspiel aufstellen</button>';
  }

  function renderLigaTabelle() {
    var tab = ligaTabelleBerechnet();
    var ligaStand = window.LIGA_DATEN.stand;
    $('lt-stand').textContent = (tab.spiele
      ? 'Aus ' + plural(tab.spiele, 'Spiel', 'Spielen') + ' berechnet' + (tab.bis ? ', letztes am ' + datumDE(tab.bis) : '') + '.'
      : 'Noch kein Spiel gewertet.') +
      (ligaStand ? ' Ergebnisse der Ligaleitung (steeldart-muenchen.de), geholt am ' + datumDE(ligaStand) + '.' : '');
    /* Rechts neben der Tabelle alle Spiele je Spieltag (Ergebnisse der Ligaleitung). */
    $('lt-runden').innerHTML = ligaRundenAlleHtml();
    renderLigaEinzel();
    renderLigaHighlights();
    var zeilen = tab.zeilen;
    /* Links ueber der Tabelle: unser Platz, Punkte und Legs, Abstand zur Spitze. */
    var platz = -1;
    zeilen.forEach(function (z, i) { if (platz < 0 && z.team === LIGA.team) platz = i; });
    var pz = platz >= 0 ? zeilen[platz] : null;
    var spitze = zeilen[0] ? Number(zeilen[0].punkte) || 0 : 0;
    var abstand = pz ? spitze - (Number(pz.punkte) || 0) : 0;
    $('lt-platz').innerHTML = pz
      ? '<span class="lk-crew-titel">Unser Platz</span><span class="lt-platz-zahl">' + (platz + 1) + '.</span>' +
        '<span class="lt-platz-info">' + plural(Number(pz.punkte) || 0, 'Punkt', 'Punkte') + ' · Legs ' + esc(String(pz.legs || '0:0')).replace(':', ' : ') + '</span>' +
        '<span class="lt-platz-sub">' + (platz === 0 ? 'Tabellenführer' : plural(abstand, 'Punkt', 'Punkte') + ' hinter Platz 1') + '</span>'
      : '';
    var kennung = JSON.stringify(zeilen);
    if (ligaTabelleKennung === kennung && $('lt-tabelle').innerHTML) return;
    ligaTabelleKennung = kennung;

    /* Spalten wie die Tabelle der Ligaleitung: Spiele, gewonnen /
       unentschieden / verloren, Legs, Einzel ("Spiele" 9:7), Punkte. */
    var zelle = function (v) { return '<td>' + esc(v === undefined || v === null ? '' : String(v)) + '</td>'; };
    $('lt-tabelle').innerHTML =
      '<thead><tr><th>#</th><th class="left">Mannschaft</th><th>Sp</th><th>g</th><th>u</th><th>v</th>' +
        '<th>Legs</th><th title="Einzel">Spiele</th><th>Pkt</th></tr></thead>' +
      '<tbody>' + zeilen.map(function (z, i) {
        var wir = z.team === LIGA.team;
        /* Ein Tipp auf die Zeile: Lokal, Spielerliste und alle Spiele des Teams. */
        return '<tr' + (wir ? ' class="leader"' : '') + ' data-action="liga-team-info" data-team="' + esc(z.team || '') + '" role="button" tabindex="0">' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="left name">' + esc(z.team || '') + '</td>' +
          zelle(z.spiele) + zelle(z.g) + zelle(z.u) + zelle(z.v) + zelle(z.legs) + zelle(z.einzel) + zelle(z.punkte) +
          '</tr>';
      }).join('') + '</tbody>';
  }

  /* Die Einzelrangliste der ganzen Liga (alle Spieler aller Teams), wie
     sie die Ligaleitung fuehrt: aus den 16 Einzeln jedes Spielberichts
     (LIGA_DATEN.einzelranglisteAus). Gleiche Werte = gleicher Platz. Erst
     die ersten 15, auf Wunsch alle; unsere Leute hervorgehoben. */
  function renderLigaEinzel() {
    var ziel = $('lt-einzel');
    if (!ziel) return;
    var er = window.LIGA_DATEN.einzelranglisteAus(LIGA_SPIELTAGE);
    if (!er.length) { ziel.innerHTML = '<p class="hint">Noch kein Spielbericht der Ligaleitung.</p>'; return; }
    var KURZ = 15;
    var alle = !!UI.ligaEinzelAlle || er.length <= KURZ;
    var platz = 0, vorher = null;
    var zeilen = er.map(function (z, i) {
      var k = [z.punkte, z.siege - z.nied, z.lf - z.la, z.lf].join('|');
      if (k !== vorher) { platz = i + 1; vorher = k; }
      z.platz = platz;
      return z;
    });
    var meinTeam = LIGA.team;
    ziel.innerHTML =
      '<table class="standings einzel"><thead><tr><th>#</th><th class="left">Spieler</th><th>Legs</th><th>Spiele</th><th>Pkt</th></tr></thead><tbody>' +
      zeilen.slice(0, alle ? zeilen.length : KURZ).map(function (z) {
        return '<tr' + (z.team === meinTeam ? ' class="wir"' : '') + '>' +
          '<td class="rank">' + z.platz + '</td>' +
          '<td class="left name">' + esc(z.name) + (z.gast ? '<small class="gast-marke">Gast</small>' : '') + '<small class="team">' + esc(z.team) + '</small></td>' +
          '<td>' + esc(z.legs) + '</td><td>' + esc(z.spiele) + '</td><td>' + z.punkte + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (er.length > KURZ
        ? '<button class="btn ghost small full lt-mehr" data-action="liga-einzel-alle">' + (UI.ligaEinzelAlle ? 'Nur die ersten ' + KURZ : 'Alle ' + er.length + ' Spieler zeigen') + '</button>'
        : '');
  }

  /* Highlights der ganzen Liga: 180er je Spieler, die kuerzesten Legs,
     die hoechsten Finishes - aus den Spielberichten der Ligaleitung. */
  function renderLigaHighlights() {
    var ziel = $('lt-highlights');
    if (!ziel) return;
    var hl = window.LIGA_DATEN.highlightsAus(LIGA_SPIELTAGE);
    var block = function (titel, liste, wert, leer) {
      return '<div class="lt-hl-block"><span class="lk-crew-titel">' + titel + '</span>' +
        (liste.length
          ? liste.slice(0, 8).map(function (z) {
              return '<div class="lt-hl-zeile' + (z.team === LIGA.team ? ' wir' : '') + '"><span>' + esc(z.name) +
                (z.gast ? '<small class="gast-marke">Gast</small>' : '') + '<small>' + esc(z.team) + '</small></span><b>' + wert(z) + '</b></div>';
            }).join('')
          : '<p class="hint">' + leer + '</p>') + '</div>';
    };
    ziel.innerHTML =
      block('180er', hl.s180, function (z) { return z.n + '×'; }, 'Noch keine 180.') +
      block('Shortlegs', hl.shortleg, function (z) { return z.wert + ' Darts'; }, 'Noch kein Shortleg.') +
      block('Highfinishes', hl.highfinish, function (z) { return String(z.wert); }, 'Noch kein Highfinish gemeldet.');
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
    $('liga-sub').textContent = '5. Liga · ' + LIGA.saison;
    ligaDatenPruefen();

    var tab = UI.ligaTab || 'plan';
    /* Die Kasse ist Vereinssache: Gast-Konten bekommen sie vom Server nicht
       (403) - dann auch keinen Reiter, der ins Leere fuehrt. */
    var ohneKasse = ichBinGastKonto();
    if (ohneKasse && tab === 'kasse') { tab = 'plan'; UI.ligaTab = 'plan'; }
    $('liga-tabs').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
      if (b.getAttribute('data-tab') === 'kasse') b.classList.toggle('hidden', ohneKasse);
    });
    $('liga-plan').classList.toggle('hidden', tab !== 'plan');
    $('liga-training').classList.toggle('hidden', tab !== 'training');
    $('liga-tabelle').classList.toggle('hidden', tab !== 'tabelle');
    $('liga-statistik').classList.toggle('hidden', tab !== 'statistik');
    $('liga-kasse').classList.toggle('hidden', tab !== 'kasse');
    $('liga-regeln').classList.toggle('hidden', tab !== 'regeln');
    /* Die Liga-Statistik bleibt nicht versteckt im DOM (Karten-Kennungen wie
       #st-tabelle gibt es auch im Reiter Statistik). */
    if (tab !== 'statistik' && $('liga-statistik').innerHTML) $('liga-statistik').innerHTML = '';
    if (tab === 'statistik') { renderLigaStatistik(); return; }
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
    var heuteIso = ligaHeuteIso();
    var laeuftId = S.tour && S.tour.liga && !S.tour.liga.uebung ? S.tour.liga.terminId : null;

    /* Zusagen je Termin: wer "dabei" ist. Ohne Server bleibt die Zahl weg. */
    var zusagen = function (t) {
      return ((ligaZusagen && ligaZusagen[t.id]) || []).filter(function (z) { return (z.status || 'dabei') === 'dabei'; });
    };
    /* Farbe der Zusagen: unter vier rot, genau vier gelb, ab fuenf gruen. */
    var ton = function (n) { return n >= 5 ? 'gruen' : n === 4 ? 'gelb' : 'rot'; };

    /* Gewaehlt ist, was angetippt wurde - sonst das laufende Spiel, sonst der
       naechste noch offene Spieltag, sonst der naechste ueberhaupt. */
    var termine = LIGA.termine;
    var wahl = null;
    if (UI.ligaWahl) termine.forEach(function (t) { if (t.id === UI.ligaWahl) wahl = t; });
    if (!wahl && laeuftId) termine.forEach(function (t) { if (!wahl && t.id === laeuftId) wahl = t; });
    if (!wahl) termine.forEach(function (t) { if (!wahl && t.tag && t.tag >= heuteIso && !ligaTerminBelegt(t)) wahl = t; });
    if (!wahl) termine.forEach(function (t) { if (!wahl && t.tag && t.tag >= heuteIso) wahl = t; });
    if (!wahl) termine.slice().reverse().forEach(function (t) { if (!wahl && t.tag) wahl = t; });
    var naechster = null;
    termine.forEach(function (t) { if (!naechster && t.tag && t.tag >= heuteIso && !ligaTerminBelegt(t)) naechster = t; });

    /* Am Handy klappt der gewaehlte Spieltag in der Liste auf: die grosse
       Karte wandert unter seine Zeile - vergangene Spieltage darueber,
       kommende darunter (Julius, 09.11.: "unten anklicken und oben wechselt
       das Feld" war unhandlich). Vor dem Neuzeichnen der Liste muss die
       Karte zurueck in die Spalte, sonst nimmt innerHTML sie mit. */
    var karte = $('liga-karte');
    var spalten = document.querySelector('#liga-plan .liga-spalten');
    if (karte.parentNode !== spalten) spalten.insertBefore(karte, spalten.firstChild);
    karte.classList.remove('in-liste', 'hidden');
    var schmal = !!(window.matchMedia && window.matchMedia('(max-width: 699px)').matches);
    var zugeklappt = schmal && !!UI.ligaZu;

    /* ---- Rechts: alle Spieltage kompakt ---- */
    $('liga-liste').innerHTML = termine.map(function (t) {
      if (!t.tag) {
        return '<div class="liga-spieltag frei"><span class="lt-nr">' + t.nr + '</span>' +
          '<span class="lt-datum"><b>–</b></span><span class="lt-wer"><span class="lt-gegner">Spielfrei</span></span><span class="lt-rechts"></span></div>';
      }
      var daheim = t.heim === LIGA.team;
      var gegner = daheim ? t.gast : t.heim;
      var vorbei = t.tag < heuteIso;
      var h = ligaTerminEintrag(t);
      var live = t.id === laeuftId;
      var rechts = '', rechtsKlasse = '', unten = esc(t.ort);
      if (live) {
        var ld = ligaStandDaten();
        rechts = '● LIVE ' + ld.wirP + ' : ' + ld.sieP; rechtsKlasse = 'live';
        unten = 'Läuft · ' + ld.fertige + ' von ' + S.matches.length + ' Einzeln';
      } else if (h) {
        var e = ligaErgebnisAus(h);
        /* Kein Haken am Ergebnis - der Stand sagt alles (Julius, 12.10.). */
        rechts = ausgangHTML(e.wirP, e.sieP);
        unten = (h.liga.abgeschlossen ? 'Abgeschlossen' : 'Bericht offen') + ' · ' + esc(t.ort);
      } else if (vorbei && ligaBogenEintrag(t)) {
        /* Gespielt, aber nicht in der App: der Stand vom Bogen der Ligaleitung. */
        var bt = String(ligaBogenEintrag(t).einzel).split(':');
        rechts = ausgangHTML(+(daheim ? bt[0] : bt[1]), +(daheim ? bt[1] : bt[0]));
      } else if (!vorbei && ligaZusagen) {
        var n = zusagen(t).length;
        rechts = n + ' / ' + LIGA.sollSpieler; rechtsKlasse = ton(n);
      }
      /* Vergangene Spiele zeigen Stand und Sieg/Niederlage - mehr nicht. Den
         "Alle Spiele"-Link gibt es hier nicht mehr, alle Spiele stehen in der
         Tabelle (Julius, 09.11.). */
      function ausgangHTML(wir, sie) {
        var a = wir > sie ? ['sieg', 'Sieg'] : wir < sie ? ['niederlage', 'Niederlage'] : ['remis', 'Unentschieden'];
        rechtsKlasse = 'fertig ' + a[0];
        return '<span class="lt-stand">' + wir + ' : ' + sie + '</span><small class="lt-ausgang">' + a[1] + '</small>';
      }
      return '<div class="liga-spieltag' + (vorbei && !h ? ' vorbei' : '') + (h ? ' gespielt' : '') + (wahl && !zugeklappt && t.id === wahl.id ? ' wahl' : '') +
        '" data-action="liga-wahl" data-id="' + esc(t.id) + '" role="button" tabindex="0">' +
        '<span class="lt-nr">' + t.nr + '</span>' +
        '<span class="lt-datum"><b>' + t.tag.slice(8, 10) + '.' + t.tag.slice(5, 7) + '.' + t.tag.slice(0, 4) + '</b><small>' + WOCHENTAGE[new Date(t.tag + 'T12:00:00').getDay()].replace('.', '') + '</small></span>' +
        '<span class="lt-wer"><span class="lt-gegner"><span class="lt-ha">' + (daheim ? 'Heim' : 'Ausw.') + '</span>' + esc(gegner) + '</span>' +
          '<span class="lt-unten">' + unten + '</span></span>' +
        '<span class="lt-rechts ' + rechtsKlasse + '">' + (rechts.charAt(0) === '<' ? rechts : '<span>' + rechts + '</span>') + '</span>' +
        '</div>';
    }).join('');

    /* ---- Links: der gewaehlte Spieltag gross ---- */
    if (!wahl || zugeklappt) { karte.innerHTML = ''; karte.className = 'liga-karte' + (zugeklappt ? ' hidden' : ''); return; }
    var t = wahl;
    var daheim = t.heim === LIGA.team;
    var vorbei = t.tag < heuteIso;
    var live = t.id === laeuftId;
    var h = ligaTerminEintrag(t);
    var antworten = (ligaZusagen && ligaZusagen[t.id]) || [];
    var leute = zusagen(t);
    var absagen = antworten.filter(function (a) { return a.status === 'absage'; });
    var meine = null;
    antworten.forEach(function (a) { if (a.id === ich) meine = a.status || 'dabei'; });
    /* Wer hat noch nicht geantwortet? Alle Vereinskonten im Kader, die
       weder zu- noch abgesagt haben - Gast- und Testkonten nicht. */
    var geantwortet = {};
    antworten.forEach(function (a) { geantwortet[a.id] = 1; });
    var offen = S.profiles.filter(function (p) {
      return String(p.id).indexOf('u_') === 0 && !p.hidden && !p.gastKonto && !p.test && !p.bot && !p.gast && !geantwortet[p.id];
    });
    var d = new Date(t.tag + 'T12:00:00');
    var MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    var datumGross = WOCHENTAGE[d.getDay()].replace('.', '') + ' ' + d.getDate() + '. ' + MONATE[d.getMonth()];
    var tage = Math.round((new Date(t.tag + 'T12:00:00') - new Date(heuteIso + 'T12:00:00')) / 86400000);
    var etikett = live ? '' : h ? t.nr + '. Spieltag · gespielt'
      : naechster && naechster.id === t.id ? 'Nächster Spieltag · ' + (tage === 0 ? 'heute' : tage === 1 ? 'morgen' : 'in ' + tage + ' Tagen')
      : vorbei ? t.nr + '. Spieltag · vorbei' : t.nr + '. Spieltag';
    var initialen = function (name) {
      return name.replace(/[`'’]/g, ' ').replace(/[^A-Za-zÄÖÜäöü ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
    };
    var teamBlock = function (name, rolle) {
      var wir = name === LIGA.team;
      return '<div class="lk-team">' +
        (wir ? '<span class="blink-logo" role="img" aria-label="Blink 180"></span>' : '<span class="lk-ini">' + esc(initialen(name)) + '</span>') +
        '<span class="lk-teamname">' + esc(name) + '</span><span class="lk-rolle">' + rolle + '</span></div>';
    };
    var tonKlasse = live ? 'live' : (!h && !vorbei && ligaZusagen ? ton(leute.length) : 'neutral');
    karte.className = 'liga-karte ' + tonKlasse;
    var ld2 = live ? ligaStandDaten() : null;
    var kopfLinks = live
      ? '<span class="lk-live"><i></i>LIVE</span><span class="lk-einzel">Einzel ' + Math.min(ld2.fertige + 1, S.matches.length) + ' von ' + S.matches.length + '</span>'
      : '<span class="lk-etikett">' + etikett + '</span>';
    var mitte = live
      ? '<div class="lk-stand"><span class="lk-punkte">' + ld2.wirP + ' : ' + ld2.sieP + '</span>' +
        '<span class="lk-legs">Punkte · Legs ' + ld2.wirL + ' : ' + ld2.sieL + '</span></div>'
      : '<span class="lk-datum">' + datumGross + '</span>';
    var fuss = '';
    if (live) {
      fuss = '<div class="lk-knoepfe"><button class="btn primary start" data-action="liga-zum-spiel">Zum Ligaspiel</button>' +
        '<button class="btn ghost lk-zuschauen" data-action="liga-ticker"><i></i>Live zuschauen</button></div>';
    } else if (h) {
      var e2 = ligaErgebnisAus(h), zu = !!h.liga.abgeschlossen;
      fuss = '<div class="lk-status ' + (zu ? 'voll' : 'offen') + '">' + (zu ? 'Abgeschlossen · ' : 'Bericht offen · ') + esc(LIGA.team) + ' ' + e2.wirP + ':' + e2.sieP + '</div>' +
        '<div class="lk-knoepfe">' +
          '<button class="btn ghost" data-action="open-summary" data-kind="turnier" data-id="' + esc(h.id) + '">Ergebnisse</button>' +
          '<button class="btn ' + (zu ? 'ghost' : 'primary start') + '" data-action="liga-bericht" data-termin="' + esc(t.id) + '">' + (zu ? 'Spielbericht' : 'Bericht abschließen') + '</button>' +
        '</div>';
    } else if (!ichBinGastKonto() || !vorbei) {
      /* Nichts in der App. Liegt der Bogen der Ligaleitung schon vor
         (gespielt, aber nicht mitgeschrieben), steht das Ergebnis zwar im
         Spielplan - aber erst das Uebernehmen macht daraus das Ligaspiel im
         Archiv, mit Siegen in der Statistik und dem Spielbericht. Das sagt
         die Karte dazu; ein vorbeigegangener Spieltag ohne Bogen laesst sich
         von Hand nachtragen (Start mit "nur Ergebnisse"). */
      var bogen = ligaBogenEintrag(t);
      var bogenStand = '';
      if (bogen && bogen.einzel) {
        var bTeile = String(bogen.einzel).split(':');
        bogenStand = daheim ? bTeile[0] + ':' + bTeile[1] : bTeile[1] + ':' + bTeile[0];
      }
      var erklaerung = '';
      if (bogen && !ichBinGastKonto()) {
        erklaerung = '<div class="lk-status offen">Gespielt · ' + esc(LIGA.team) + ' ' + esc(bogenStand) + ' · noch nicht im Archiv</div>' +
          '<p class="lk-hinweis">Alle 16 Einzel vom Spielbericht liegen vor. Einmal übernehmen, dann zählen Siege und Legs in der Liga-Statistik und der Spielbericht ist da.</p>';
      } else if (vorbei) {
        erklaerung = '<div class="lk-status offen">Vorbei · noch nicht in der App</div>' +
          '<p class="lk-hinweis">Ohne Spiel im Archiv zählt nichts in die Statistik. Von Hand nachtragen heißt: Spiel nachträglich anlegen und je Einzel nur den Leg-Stand antippen.</p>';
      }
      /* Jeder im Team antwortet aktiv: Bin dabei oder Kann nicht - ein
         Entweder-oder. Die gewaehlte Antwort bleibt gedrueckt, ein Tipp auf
         die andere wechselt; ein Tipp auf die eigene tut nichts (Julius,
         09.11.: "Bin dabei abwaehlen" ergab keinen Sinn). */
      var antwortKnopf = function (status, txt) {
        var aktiv = meine === status;
        return '<button class="btn' + (aktiv ? (status === 'absage' ? ' aktiv absage' : ' hell aktiv') : ' ghost') + '" data-action="liga-zusage" data-id="' + esc(t.id) + '" data-status="' + status + '"' +
          (aktiv ? ' aria-pressed="true"' : '') + '>' + txt + '</button>';
      };
      var antwortZeile = !vorbei && online && !ichBinGastKonto()
        ? '<div class="lk-knoepfe lk-antworten">' + antwortKnopf('dabei', 'Bin dabei') + antwortKnopf('absage', 'Kann nicht') + '</div>'
        : '';
      var knoepfe = vorbei
        ? (bogen ? '<button class="btn primary start" data-action="liga-nachtrag" data-id="' + esc(t.id) + '">Spielbericht übernehmen</button>' : '') +
          '<button class="btn ' + (bogen ? 'ghost' : 'primary start') + '" data-action="liga-spiel" data-id="' + esc(t.id) + '">Von Hand nachtragen</button>'
        : (ichBinGastKonto()
            ? '<span class="lk-gast">Als Gast: verfolgen über den Live-Ticker</span>'
            : (bogen ? '<button class="btn hell" data-action="liga-nachtrag" data-id="' + esc(t.id) + '">Spielbericht übernehmen</button>' : '') +
              /* GAME ON nur am Spieltag selbst - vorher stehen hier nur die
                 Zusagen, sonst startet jemand aus Versehen Tage vorher das
                 Ligaspiel (Julius, Handy-Block 2). */
              (t.tag === heuteIso ? '<button class="btn primary start" data-action="liga-spiel" data-id="' + esc(t.id) + '">Game On!</button>' : ''));
      fuss = erklaerung + antwortZeile + '<div class="lk-knoepfe">' + knoepfe + '</div>';
    }
    var person = function (p, klasse) {
      return '<span class="lt-person' + (klasse ? ' ' + klasse : '') + '">' + avatarHTML(zusageProfil(p), 'sm') + esc(p.name) + '</span>';
    };
    /* Drei Gruppen wie beim Training: dabei, kann nicht, noch keine Antwort -
       sonst weiss der Kapitaen nicht, wer abgesagt und wer nur noch nicht
       geschaut hat (Julius, 09.11.). Gespielt oder live: nur noch, wer
       dabei war. */
    var crewHTML = function () {
      var html = '<div class="lk-crew"><span class="lk-crew-titel">Dabei · <b class="' + ton(leute.length) + '">' + leute.length + ' / ' + LIGA.sollSpieler + '</b></span>' +
        '<div class="lt-leute">' + (leute.map(function (p) { return person(p, ''); }).join('') || '<span class="muted">Noch niemand.</span>') + '</div>';
      if (!h && !live) {
        if (absagen.length) {
          html += '<span class="lk-crew-titel">Kann nicht · <b class="rot">' + absagen.length + '</b></span>' +
            '<div class="lt-leute">' + absagen.map(function (p) { return person(p, 'absage'); }).join('') + '</div>';
        }
        if (!vorbei && offen.length) {
          html += '<span class="lk-crew-titel">Noch keine Antwort · <b>' + offen.length + '</b></span>' +
            '<div class="lt-leute leise">' + offen.map(function (p) { return person(p, 'offen'); }).join('') + '</div>';
        }
      }
      return html + '</div>';
    };
    karte.innerHTML =
      '<div class="lk-kopf">' + kopfLinks +
        '<span class="lk-icons">' +
          '<a class="icon-btn rund" href="https://maps.apple.com/?q=' + encodeURIComponent(t.ort) + '" target="_blank" rel="noopener" title="Route in Maps" aria-label="Route in Maps">' +
            '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"></path><path d="M9 4v14M15 6v14"></path></svg></a>' +
          '<button class="icon-btn rund" data-action="liga-ical" data-id="' + esc(t.id) + '" title="Diesen Termin in den Kalender" aria-label="Diesen Termin in den Kalender">' + KALENDER_SVG + '</button>' +
        '</span></div>' +
      mitte +
      '<div class="lk-info"><span class="lk-zeile">' + t.nr + '. Spieltag · ' + (daheim ? 'Heim' : 'Auswärts') + ' · 20:00 Uhr</span>' +
        '<span class="lk-ort"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>' + esc(t.ort) + '</span></div>' +
      '<div class="lk-teams">' + teamBlock(t.heim, 'Heim') + '<span class="lk-vs">VS</span>' + teamBlock(t.gast, 'Gast') + '</div>' +
      '<div class="lk-kurz">' + esc(t.heim) + ' <span>vs</span> ' + esc(t.gast) + '</div>' +
      (ligaZusagen ? crewHTML() : '<div class="lk-crew"></div>') +
      fuss;
    /* Handy: die Karte unter die Zeile des gewaehlten Spieltags. */
    if (schmal) {
      var zeile = $('liga-liste').querySelector('.liga-spieltag[data-id="' + t.id + '"]');
      if (zeile) {
        zeile.insertAdjacentElement('afterend', karte);
        karte.classList.add('in-liste');
        /* Zeile und Karte werden ein Kasten: die Zeile ist der Kopf, die
           Karte haengt ohne Fuge darunter und traegt dieselbe Randfarbe. */
        zeile.classList.add('offen');
        zeile.setAttribute('data-ton', tonKlasse);
      }
    }
  }

  /* Alle Spiele des Spieltags (auch die der anderen Teams): Paarung und
     Ergebnis, Spielfrei gedimmt, Verschobenes mit neuem Datum. Ein Tipp
     zeigt die 16 Einzel; unser eigenes Spiel fuehrt zu den Ergebnissen.
     Steht im Tabellen-Reiter unter der Tabelle und hinter "Alle Spiele"
     in der Spieltage-Liste - nicht in unserer Spieltag-Karte (Julius). */
  function ligaRundenAlleHtml() {
    /* Seit der Spielplan der Ligaleitung komplett vorliegt, gibt es alle 18
       Spieltage: gezeigt werden die mit Ergebnis und der naechste, der Rest
       erst auf "Alle Spieltage" - sonst wird die Karte am Handy endlos. */
    var mitDaten = LIGA.termine.filter(function (t) { return LIGA_SPIELTAGE[t.id] && LIGA_SPIELTAGE[t.id].length; });
    var gespielt = function (t) { return LIGA_SPIELTAGE[t.id].some(function (sp) { return sp.gast && sp.einzel; }); };
    var zeigen = mitDaten;
    if (!UI.ligaRundenAlle) {
      var naechster = false;
      zeigen = mitDaten.filter(function (t) {
        if (gespielt(t)) return true;
        if (naechster) return false;
        naechster = true; return true;
      });
    }
    return zeigen.map(function (t) { return ligaRundeHtml(t, ligaTerminEintrag(t)); }).join('') +
      (zeigen.length < mitDaten.length || UI.ligaRundenAlle
        ? '<button class="btn ghost small full lt-mehr" data-action="liga-runden-alle">' +
          (UI.ligaRundenAlle ? 'Nur gespielte Spieltage' : 'Alle ' + mitDaten.length + ' Spieltage zeigen') + '</button>'
        : '');
  }
  function ligaRundeHtml(t, h) {
    var runde = LIGA_SPIELTAGE[t.id];
    if (!runde || !runde.length) return '';
    return '<div class="lk-runde"><span class="lk-crew-titel">Alle Spiele · ' + t.nr + '. Spieltag</span>' +
      runde.map(function (sp, i) {
        if (!sp.gast) return '<div class="lr-zeile frei"><span class="lr-teams">' + esc(sp.heim) + ' <i>·</i> Spielfrei</span><span class="lr-erg">–</span></div>';
        var wir = sp.heim === LIGA.team || sp.gast === LIGA.team;
        var rechts = sp.verschoben
          ? '<span class="lr-erg verschoben">verschoben' + (sp.tag ? ' · ' + fmtDate(new Date(sp.tag + 'T12:00:00').getTime()).slice(0, 6) : '') + '</span>'
          : sp.einzel ? '<span class="lr-erg"><b>' + esc(sp.einzel) + '</b><small>' + esc(sp.legs || '') + '</small></span>' : '<span class="lr-erg">–</span>';
        var tipp = wir && h ? ' data-action="open-summary" data-kind="turnier" data-id="' + esc(h.id) + '"'
          : sp.partien && sp.partien.length ? ' data-action="liga-partien" data-termin="' + esc(t.id) + '" data-i="' + i + '"' : '';
        return '<div class="lr-zeile' + (wir ? ' wir' : '') + (tipp ? ' tap' : '') + '"' + (tipp ? tipp + ' role="button" tabindex="0"' : '') + '>' +
          '<span class="lr-teams">' + esc(sp.heim) + ' <i>–</i> ' + esc(sp.gast) + '</span>' + rechts + '</div>';
      }).join('') + '</div>';
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
  /* Heute als ISO-Datum. window.__ligaHeute: nur fuer die Tests (fester
     Stichtag), sonst nie gesetzt. */
  function ligaHeuteIso() {
    if (window.__ligaHeute) return window.__ligaHeute;
    var heute = new Date();
    return heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
  }

  /* ================= Nur Ergebnisse / Nachtrag ================= */
  /* Ein Einzel, das nicht in der App mitgeschrieben wurde (der Gegner hat
     mit seinem System gezaehlt, oder es kommt vom Bogen der Ligaleitung):
     der Leg-Stand wird zu Legs ohne Wuerfe, der Sieger im Wechsel mit dem
     Verlierer, den Deckel macht der Sieger drauf (2:1 = Sieger, Verlierer,
     Sieger). Bericht, Stand und Leg-Bilanz rechnen damit wie immer;
     Average, Bestes Leg und Highlights bleiben leer. */
  function ergebnisSetzen(m, h, g, start, at) {
    /* Ohne Sieger (Gleichstand, 0:0, Unsinn) gibt es kein Ergebnis. */
    if (!(h >= 0 && g >= 0) || h === g) return null;
    var sieger = h > g ? m.p[0] : m.p[1], verlierer = h > g ? m.p[1] : m.p[0];
    var restS = Math.max(h, g), restV = Math.min(h, g), siegerDran = true;
    var legs = [];
    while (restS + restV > 0) {
      var wer = (siegerDran && restS > 0) || restV === 0 ? sieger : verlierer;
      if (wer === sieger) restS--; else restV--;
      legs.push({ starter: null, visits: [], winner: wer, start: start || 501, ergebnis: true });
      siegerDran = !siegerDran;
    }
    m.legs = legs;
    m.done = true;
    m.ergebnis = true;
    m.kampflos = false;
    m.winner = sieger;
    m.at = at || Date.now();
    return m;
  }
  /* Unser Spiel eines Spieltags, wie es die Ligaleitung gemeldet hat - mit
     allen 16 Einzeln (LIGA_SPIELTAGE, partien). Nur dann laesst es sich
     in die App uebernehmen. */
  function ligaBogenEintrag(t) {
    var runde = (t && LIGA_SPIELTAGE[t.id]) || [];
    for (var i = 0; i < runde.length; i++) {
      var sp = runde[i];
      if (sp && sp.gast && (sp.heim === LIGA.team || sp.gast === LIGA.team) && !sp.verschoben &&
          Array.isArray(sp.partien) && sp.partien.length === LIGA_EINZEL.length && sp.einzel) return sp;
    }
    return null;
  }
  /* Die Bogen-Liste einer Seite (H1-H8 bzw. G1-G8) aus dem gemeldeten
     Spiel: erst die gepflegte Aufstellung, dann alles, was in den Einzeln
     sonst noch auf dieser Seite steht, in Reihenfolge des Auftretens. */
  function nachtragNamen(sp, heim) {
    var ohneStern = function (n) { return String(n || '').replace(/^\*/, '').trim(); };
    var liste = ((sp.aufstellung && sp.aufstellung[heim ? 'heim' : 'gast']) || []).map(ohneStern).filter(Boolean);
    (sp.partien || []).forEach(function (p) {
      var n = ohneStern(p[heim ? 0 : 1]);
      if (n && liste.indexOf(n) < 0) liste.push(n);
    });
    return liste;
  }
  /* Welches Konto ein Bogen-Name wohl ist: ganzer Name (buergerlich oder
     Anzeigename), sonst eindeutiger Vorname, sonst eindeutiger Nachname.
     Schon vergebene Konten kommen nicht noch einmal. Nichts Eindeutiges =
     leer, das entscheidet dann der Mensch. */
  function nachtragVorschlag(name, vergeben) {
    var norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
    var kader = ligaKader().filter(function (p) { return (vergeben || []).indexOf(p.id) < 0; });
    var n = norm(name), teile = n.split(' '), vor = teile[0], nach = teile[teile.length - 1];
    var treffer = kader.filter(function (p) { return norm(p.voll) === n || norm(p.name) === n; });
    if (treffer.length === 1) return treffer[0].id;
    treffer = kader.filter(function (p) {
      var pv = norm(p.voll).split(' ')[0];
      return norm(p.name) === vor || (pv && pv === vor);
    });
    if (treffer.length === 1) return treffer[0].id;
    treffer = kader.filter(function (p) { var pv = norm(p.voll).split(' '); return pv.length > 1 && pv[pv.length - 1] === nach; });
    if (treffer.length === 1) return treffer[0].id;
    return '';
  }
  /* Der Nachtrag selbst: aus den 16 gemeldeten Einzeln wird ein
     abgeschlossenes Ligaspiel im Archiv - mit Bogen-Listen, Positionen und
     Scheiben wie an einem echten Abend, nur ohne Wuerfe. Die Gegner werden
     Gaeste wie beim Ligaspiel-Start. Der Bericht ist auf Papier laengst bei
     der Ligaleitung, deshalb gilt der Spieltag sofort als abgeschlossen. */
  function ligaNachtragUebernehmen() {
    var o = UI.overlay;
    if (!o || o.type !== 'liga-nachtrag') return;
    var t = o.termin, b = o.bogen, z = o.draft.zuordnung || {};
    if (ligaTerminBelegt(t)) { UI.overlay = null; render(); return; }
    var daheim = b.heim === LIGA.team;
    var unsereNamen = nachtragNamen(b, daheim), ihreNamen = nachtragNamen(b, !daheim);
    var wir = unsereNamen.map(function (nm) { return z[nm] || ''; });
    var kader = ligaKader();
    /* Die Meldung nennt die Zeilen, an denen es haengt - "geht nicht" allein
       hilft am Handy niemandem. */
    var ohne = [], doppelt = [];
    unsereNamen.forEach(function (nm, i) {
      var id = wir[i];
      if (!id || !kader.some(function (p) { return p.id === id; })) ohne.push(nm);
      else if (wir.indexOf(id) !== i) doppelt.push(nm);
    });
    if (ohne.length || doppelt.length) {
      o.fehlt = ohne.concat(doppelt);
      o.fehler = (ohne.length ? 'Noch ohne Spieler: ' + ohne.join(', ') + '. ' : '') +
        (doppelt.length ? 'Doppelt vergeben: ' + doppelt.join(', ') + '. ' : '') +
        'Bitte jedem Namen genau einen eigenen Spieler zuordnen – wer kein Konto hat, bekommt unten in der Liste „neu als Gast anlegen“.';
      render(); return;
    }
    var wirMap = {}, sieMap = {}, sie = [];
    unsereNamen.forEach(function (nm, i) { wirMap[nm] = wir[i]; });
    ihreNamen.forEach(function (nm) {
      var id = ligaGastId(nm, wir.concat(sie));
      sieMap[nm] = id;
      sie.push(id);
    });
    var heimListe = daheim ? wir.slice() : sie.slice();
    var gastListe = daheim ? sie.slice() : wir.slice();
    var heimMap = daheim ? wirMap : sieMap, gastMap = daheim ? sieMap : wirMap;
    var ohneStern = function (n) { return String(n || '').replace(/^\*/, '').trim(); };
    var tag = b.tag || t.tag || '';
    var at = tag ? new Date(tag + 'T20:00:00').getTime() : Date.now();
    var maxLegs = 0;
    b.partien.forEach(function (p) { maxLegs = Math.max(maxLegs, Number(p[2]) || 0, Number(p[3]) || 0); });
    var bestOf = maxLegs >= 3 ? 5 : 3;
    var kaputt = false;
    var matches = b.partien.map(function (p, i) {
      var m = {
        /* Feste Kennungen je Spieltag: tippen zwei Geraete "uebernehmen",
           bevor der Abgleich lief, nimmt der Server den Eintrag nur einmal
           an und das zweite Geraet erkennt ihn beim Abgleich wieder. */
        id: 'nachtrag-' + t.id + '-' + (i + 1), round: Math.floor(i / 4) + 1, p: [heimMap[ohneStern(p[0])], gastMap[ohneStern(p[1])]],
        starter: null, posPaar: LIGA_EINZEL[i].slice(), scheibe: LIGA_SCHEIBEN[i],
        legs: [], done: false, winner: null, at: null
      };
      /* Je Durchgang etwa eine Dreiviertelstunde - nur damit die Einzel im
         Verlauf in Bogen-Reihenfolge stehen. */
      if (!ergebnisSetzen(m, Number(p[2]) || 0, Number(p[3]) || 0, 501, at + Math.floor(i / 4) * 45 * 60000 + (i % 4) * 60000)) kaputt = true;
      return m;
    });
    if (kaputt) {
      o.fehler = 'Der gemeldete Bogen hat ein Einzel ohne Sieger – bitte die Daten in liga-daten.js prüfen.';
      render(); return;
    }
    var eintrag = {
      id: 'nachtrag-' + t.id, at: at,
      lineup: wir.concat(sie),
      settings: { start: 501, bestOf: bestOf },
      matches: matches, winner: null,
      liga: {
        terminId: t.id, nr: t.nr, gegner: daheim ? b.gast : b.heim, heim: daheim,
        wir: wir.slice(), sie: sie.slice(),
        heimSpieler: heimListe, gastSpieler: gastListe,
        posH: heimListe.slice(0, 4), posG: gastListe.slice(0, 4),
        ort: b.ort || t.ort || '', tag: tag,
        /* Keine erfundene Spielzeit - die Felder von/bis bleiben im Bogen leer. */
        finish: false, zeitVon: null, zeitBis: null,
        nurErgebnis: true, nachgetragen: Date.now(), abgeschlossen: Date.now(),
        berichtKreuze: { nachmeldungen: 'nein', proteste: 'nein' }
      }
    };
    S.history.unshift(eintrag);
    S.history.sort(function (a, c) { return (c.at || 0) - (a.at || 0); });
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
    meldeNeuesSpiel(eintrag);
    var e = ligaErgebnisAus(eintrag);
    UI.ligaWahl = t.id;
    UI.overlay = { type: 'hinweis', titel: 'Spieltag übernommen',
      text: t.nr + '. Spieltag gegen ' + eintrag.liga.gegner + ': ' + LIGA.team + ' ' + e.wirP + ':' + e.sieP +
        '. Die 16 Einzel stehen im Archiv und in der Liga-Statistik, der Spieltag gilt als abgeschlossen.' };
    save(); render();
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
      $('bulloff-sub').textContent = 'Alle werfen auf Bull. Wer am nächsten dran war, zuerst antippen.';
      $('bulloff-ctx').textContent = kindName(S.game.kind) + ' · ' + plural(ids.length, 'Spieler', 'Spieler');
      $('screen-bulloff').classList.remove('turnier');
      $('bulloff-buttons').className = 'bulloff-order';
      /* Nichts springt beim Antippen: links bleibt der Platz eines
         Gewaehlten einfach leer (gleiche Groesse, unsichtbar), rechts
         stehen alle Slots von Anfang an, und der Startknopf reserviert
         seinen Platz, bis er gebraucht wird. */
      $('bulloff-buttons').innerHTML =
        '<div class="bo-spalten">' +
          '<div class="bo-spalte"><span class="bo-label">Antippen in Wurf-Reihenfolge</span>' +
          '<div class="bo-wahl">' + ids.map(function (pid) {
            var gewaehlt = reihe.indexOf(pid) >= 0;
            return gewaehlt
              ? '<button class="bo-weg" disabled aria-hidden="true">' +
                avatarHTML(profile(pid), 'sm') +
                '<span class="bo-name">' + esc(pname(pid)) + '</span></button>'
              : '<button data-action="order-pick" data-id="' + esc(pid) + '">' +
                avatarHTML(profile(pid), 'sm') +
                '<span class="bo-name">' + esc(pname(pid)) + '</span></button>';
          }).join('') + '</div></div>' +
          '<div class="bo-spalte"><span class="bo-label">Reihenfolge</span>' +
          '<div class="bo-reihe">' + ids.map(function (_, i) {
            var pid = reihe[i];
            if (!pid) {
              return '<div class="bo-slot"><span class="bo-pos">' + (i + 1) + '</span>' +
                '<span class="bo-frei">–</span></div>';
            }
            var nm = esc(pname(pid));
            return '<button class="bo-row' + (i === 0 ? ' erster' : '') + '" data-action="order-unpick" data-id="' + esc(pid) + '" ' +
              'aria-label="' + nm + ' wieder herausnehmen">' +
              '<span class="bo-pos">' + (i + 1) + '</span>' +
              avatarHTML(profile(pid), 'sm') +
              '<span class="bo-name">' + nm + '</span>' +
              (i === 0 ? '<em class="bo-tag">wirft an</em>' : '') + '</button>';
          }).join('') + '</div></div>' +
        '</div>' +
        /* Der Startknopf steht von Anfang an da: solange noch jemand fehlt,
           sagt er, wie viele - rot wird er erst, wenn alle gewaehlt sind. */
        '<button class="btn primary start full' + (fertig ? '' : ' offen') + '" ' +
          'data-action="start-order"' + (fertig ? '' : ' disabled') + '>' +
          (fertig ? 'GAME ON! · ' + esc(pname(reihe[0])) + ' beginnt' : 'Noch ' + (ids.length - reihe.length) + ' antippen') + '</button>';
      return;
    }

    $('bulloff-sub').textContent = ids.length > 2
      ? 'Wer war am nächsten am Bull? Er beginnt, danach geht es reihum weiter.'
      : 'Wer war näher am Bull? Antippen – der wirft an.';
    /* Rechts oben der Zusammenhang: welches Spiel, welche Spielart. */
    var boM = forGame ? null : currentMatch();
    $('bulloff-ctx').textContent = forGame
      ? kindName(S.game.kind) + ' · ' + plural(ids.length, 'Spieler', 'Spieler')
      : boM ? (S.tour && S.tour.liga ? 'Einzel ' : 'Spiel ') + (S.matches.indexOf(boM) + 1) + ' von ' + S.matches.length : '';
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
    /* Das Etikett unter dem Namen ist ein <em>, kein <span>: Tests und
       Tastatur lesen den Namen als einzigen span neben dem Avatar. */
    $('bulloff-buttons').innerHTML = ids.map(function (pid, i) {
      return '<button data-action="pick-starter" data-id="' + esc(pid) + '"' +
        (i === bWahl ? ' class="wahl"' : '') + '>' +
        avatarHTML(profile(pid), 'md') + '<span>' + esc(ligaName && S.tour && S.tour.liga ? ligaName(pid) : pname(pid)) + '</span>' +
        '<em class="bo-tag">' + (i === bWahl ? 'wirft an' : 'antippen, wenn näher') + '</em></button>';
    }).join('') +
      (amBoard || (S.tour && S.tour.liga) ? '<p class="te-hint"><b>4 / 6</b> wählen &nbsp;&nbsp; <b>Enter</b> der beginnt</p>' : '');
  }

  /* Wer nach dem Aktiven dran ist - fuer die Fernsteuerung (rechts der
     Naechste) und die Kopfzeile ab drei Spielern ("Danach: ..."). */
  function spielerDanach(m, aktiv) {
    var i = m.p.indexOf(aktiv);
    var folge = [];
    for (var k = 1; k < m.p.length; k++) folge.push(m.p[(i + k) % m.p.length]);
    return folge;
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
    var qSt = schnell && (mehrereLegs(m) || m.session) ? satzStand(m) : null;

    var pendingSum = sum(UI.darts, function (d) { return d.v; });
    var restActive = remainingIn(leg, active) - pendingSum;
    var mode = effectiveMode(restActive);
    /* Der Kamera-Modus zeigt die Einzel-Darts-Ansicht: die vom iPhone
       gemeldeten Darts fuellen dieselben Kacheln, das Tastenfeld bleibt
       als Handbetrieb sichtbar. */
    var anzeige = mode === 'kamera' ? 'darts' : mode;
    var fern = anzeige === 'turnier';
    var dartsLeft = anzeige === 'darts' || UI.darts.length ? 3 - UI.darts.length : 3;
    var lage = x01Lage(m, leg, active);
    var route = ohneFinish ? null : Checkout.suggest(restActive, dartsLeft, lieblingsDoppel(active, lage));
    var danach = spielerDanach(m, active);

    /* Kopf: Spiel und Stand. In der Fernsteuerung ab drei Spielern steht
       rechts, wer nach dem Naechsten kommt. */
    var subText;
    if (schnell) {
      $('game-match-label').textContent = 'Schnelles X01' + liveLabel(m);
      subText = m.session
        ? 'Session · Leg ' + qSt.legNr + ' · ' + matchStart(m) + ' DO'
        : qSt
        ? (qSt.gewinnSaetze > 1 ? 'Satz ' + qSt.satzNr + ' · ' : '') + 'Leg ' + (m.done ? qSt.legNr - 1 : qSt.legNr) +
          ' · ' + dauerText(m) + ' · ' + matchStart(m)
        /* Knapp: "2 Spieler · 501 DO" statt "... Double Out" - der volle
           Text war am Handy abgeschnitten ("501 D…"). */
        : plural(m.p.length, 'Spieler', 'Spieler') + ' · ' + matchStart(m) + ' DO';
    } else {
      var idx = S.matches.indexOf(m);
      $('game-match-label').textContent = 'Spiel ' + (idx + 1) + ' von ' + S.matches.length;
      subText = tour().bestOf > 1
        ? 'Leg ' + m.legs.length + ' · Stand ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + ' · ' + plural(legsToWin(), 'Leg', 'Legs') + ' zum Sieg'
        : 'Ein Leg · ' + tourStart() + ' Double Out';
    }
    if (fern && danach.length > 1 && !m.done) {
      subText = 'Danach: ' + danach.slice(1).map(function (id) { return esc(spielerName(id)); }).join(' · ');
      $('game-leg-label').innerHTML = subText;
    } else {
      $('game-leg-label').textContent = subText;
    }
    $('game-turn').innerHTML = m.done
      ? '<b>' + esc(spielerName(m.winner)) + '</b> ' + (m.p.length < 2 ? 'hat ausgemacht' : 'hat gewonnen')
      : '<span class="muted">Am Wurf</span> <b>' + esc(spielerName(active)) + '</b>' +
        '<span class="muted"> · Rest ' + restActive + '</span>';

    /* Kopf-Knoepfe: Fernsteuerung nur mit Gegner, der Wechsel Punkte/
       Einzel-Darts nicht in der Fernsteuerung. */
    $('game-fern').classList.toggle('hidden', !turnierErlaubt());
    $('game-fern').classList.toggle('an', fern);
    $('game-fern').setAttribute('aria-pressed', fern ? 'true' : 'false');
    $('game-swap').classList.toggle('hidden', fern);
    $('game-menu-kamera').classList.toggle('hidden', !window.DartKamera);
    /* "Session beenden" bzw. im Schnellen Spiel ueber mehrere Legs "Spiel
       beenden & speichern", sobald ein Leg entschieden ist. */
    var menuEnde = schnell && (m.session || entschiedeneLegs(S.game) > 0);
    $('game-menu-session').classList.toggle('hidden', !menuEnde);
    $('game-menu-session').textContent = m.session ? 'Session beenden' : 'Spiel beenden & speichern';
    $('game-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('game-menu-overlay'));
    if (UI.menu) {
      $('game-menu-titel').textContent = $('game-match-label').textContent;
      document.querySelector('#game-menu-overlay .game-menu-sub').textContent = $('game-leg-label').textContent;
    }

    /* Die Karten bleiben an ihrem Platz - auch in der Fernsteuerung wandert
       nur die Markierung zum Naechsten (Julius: die Eingabe springt zum
       naechsten Spieler, nicht die Karten). Ab drei Spielern als 2x2. */
    var karten = m.p;
    $('scoreboard').classList.toggle('viele', karten.length > 2);
    $('scoreboard').classList.toggle('solo', m.p.length === 1);
    $('screen-game').classList.toggle('solo', m.p.length === 1);
    $('screen-game').classList.toggle('viele', m.p.length > 2);
    $('scoreboard').style.setProperty('--n', karten.length);

    /* Die letzte Aufnahme jedes Spielers steht klein neben seinem Rest
       ("345 | 60") und bleibt stehen, bis er wieder wirft. Kommt eine neue,
       rutscht die alte wie in einem Drehrad nach unten und verblasst, die
       neue kommt von oben nach. Weil jeder Tastendruck neu zeichnet,
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

    /* Die drei Felder unter dem Rest: in der Punkte-Eingabe und in der
       Fernsteuerung der Finish-Weg (nur, wenn einer ansteht), in Einzel-
       Darts die laufende Aufnahme des Aktiven - leer zu Beginn, jeder
       eingetragene Dart fuellt eine (gruen, wenn er den Vorschlag trifft),
       in Finish-Naehe stehen die restlichen Wuerfe als antippbarer Weg
       darin. Die Zeile behaelt ihre Hoehe, damit nichts springt. */
    function felderHTML(pid, istAktiv) {
      if (m.done) return '<div class="pfelder"></div>';
      /* In der Fernsteuerung stehen die Kacheln nur, solange Einzeldarts
         laufen (z. B. vom Mitspieler im Online-Spiel) - ohne Vorschlagsknoepfe. */
      var nurAnzeige = fern && UI.darts.length > 0;
      if ((anzeige === 'darts' || nurAnzeige) && istAktiv) {
        var kacheln = ['', '', ''];
        var kDbl = ohneFinish ? null : lieblingsDoppel(active, lage);
        var kRest = remainingIn(leg, active);
        var kPlan = ohneFinish ? null : planFuer(kRest, 3, kDbl);
        var kPlanGilt = !!kPlan;
        UI.darts.forEach(function (d, ki) {
          var soll = null;
          if (!ohneFinish) {
            var kEmpf = kPlanGilt && kPlan.darts[ki] ? [kPlan.darts[ki]]
              : (Checkout.suggest(kRest, 3 - ki, kDbl) || (stellwurfFuer(kRest, 3 - ki, kDbl) || {}).darts);
            /* suggest liefert Labels ('T20') - fuer den Vergleich in
               Mult/Zahl zerlegen, wie es auch der Finisher macht. */
            if (kEmpf && kEmpf.length) soll = labelDart(kEmpf[0]);
          }
          var traf = soll && d.n === soll.n && d.m === soll.m;
          if (!traf) kPlanGilt = false;
          kacheln[ki] = '<span class="fk ' + (traf ? 'gut' : 'anders') + '">' +
            (d.n === 0 ? '–' : dartLabel(d)) + '</span>';
          kRest -= d.v;
        });
        /* Was noch zu werfen ist: der Rest des Plans, solange er gilt. */
        var planRest = kPlanGilt && UI.darts.length > 0 && kPlan.darts.length > UI.darts.length
          ? { darts: kPlan.darts.slice(UI.darts.length), auf: kPlan.auf } : null;
        var zeigRoute = planRest ? (planRest.auf === null ? planRest.darts : null) : route;
        if (zeigRoute && !nurAnzeige) {
          for (var kr = 0; kr < zeigRoute.length && UI.darts.length + kr < 3; kr++) {
            /* Die vorgeschlagene Kachel ist zugleich der Bestaetigungsknopf:
               wer die 14 trifft, tippt auf die 14 statt sie im Zahlenfeld zu
               suchen. data-num/data-mult nimmt derselbe Handler wie die
               Zahlentasten. */
            var kSoll = labelDart(zeigRoute[kr]);
            kacheln[UI.darts.length + kr] = '<button type="button" class="fk tipp' + (kr === 0 ? ' jetzt' : '') + '"' +
              ' data-num="' + kSoll.n + '" data-mult="' + kSoll.m + '" aria-label="' + Checkout.pretty(zeigRoute[kr]) + ' getroffen">' +
              Checkout.pretty(zeigRoute[kr]) + '</button>';
          }
        } else if (UI.darts.length < 3 && !ohneFinish && !nurAnzeige) {
          /* Kein Finish mehr mit den restlichen Darts: dann steht der
             Stellwurf aus der Tabelle da (99 mit zwei Darts: T19 10, damit
             32 bleibt) -- gestrichelt, jeder Dart antippbar, am letzten die
             Zahl, auf die er stellt. */
          var kSt = planRest && planRest.auf !== null ? planRest : stellwurfFuer(kRest, 3 - UI.darts.length, kDbl);
          if (kSt) {
            for (var ks = 0; ks < kSt.darts.length && UI.darts.length + ks < 3; ks++) {
              var kStellSoll = labelDart(kSt.darts[ks]);
              var letzter = ks === kSt.darts.length - 1;
              kacheln[UI.darts.length + ks] = '<button type="button" class="fk tipp stellen' + (ks === 0 ? ' jetzt' : '') + '"' +
                ' data-num="' + kStellSoll.n + '" data-mult="' + kStellSoll.m + '" aria-label="Stellwurf ' + Checkout.pretty(kSt.darts[ks]) + ' getroffen' + (letzter ? ', stellt auf ' + kSt.auf : '') + '">' +
                Checkout.pretty(kSt.darts[ks]) + (letzter ? '<span class="fk-auf">auf ' + kSt.auf + '</span>' : '') + '</button>';
            }
          }
        }
        for (var kx = 0; kx < 3; kx++) if (!kacheln[kx]) kacheln[kx] = '<span class="fk leer">–</span>';
        return '<div class="pfelder fin-kacheln" id="game-kacheln">' + kacheln.join('') + '</div>';
      }
      if (anzeige === 'darts') {
        /* Wartende: drei leere Felder, damit alle Karten gleich aufgebaut sind. */
        return '<div class="pfelder"><span class="fk still"></span><span class="fk still"></span><span class="fk still"></span></div>';
      }
      /* Punkte und Fernsteuerung: der Finish-Weg, neutral, keins markiert.
         In der Fernsteuerung sieht auch der Wartende seinen Weg (abgedunkelt),
         so kann er sich auf seine Aufnahme vorbereiten. */
      var weg = null;
      if (!ohneFinish) {
        if (istAktiv) weg = route;
        else if (fern) {
          var wRest = remainingIn(leg, pid);
          weg = wRest >= 2 ? Checkout.suggest(wRest, 3, lieblingsDoppel(pid, x01Lage(m, leg, pid))) : null;
        }
      }
      return '<div class="pfelder pfinish">' + (weg ? weg.map(function (d) {
        return '<span class="fk weg' + (istAktiv ? '' : ' wartet') + '">' + Checkout.pretty(d) + '</span>';
      }).join('') : '') + '</div>';
    }

    /* Die letzten Aufnahmen eines Spielers im laufenden Leg (neueste oben,
       hoechstens n): unten in der Fernsteuerung links und rechts der
       Eingabe (Liga-Vorschrift: sechs), und in der Fernsteuerung am Handy
       hochkant bzw. allein in der Karte selbst (drei) - dort gibt es die
       Listen unten nicht (siehe .pwuerfe im CSS). */
    var histSpalte = function (pid, n) {
      if (!pid) return '';
      var restLauf = legStart(leg);
      var zeilen = [];
      leg.visits.forEach(function (v) {
        if (v.p !== pid) return;
        if (!v.b) restLauf -= v.s;
        zeilen.push('<div class="v ' + (wieBust(v) ? 'bust' : v.c ? 'co' : '') + '">' +
          '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
          '<span class="r">' + (wieBust(v) ? 'Bust' : 'Rest ' + restLauf) + '</span></div>');
      });
      return zeilen.slice(-n).reverse().join('');
    };

    $('scoreboard').innerHTML = karten.map(function (pid, ki) {
      var istAktiv = pid === active;
      var rest = remainingIn(leg, pid) - (istAktiv ? pendingSum : 0);
      var darts = dartsIn(leg, pid) + (istAktiv ? UI.darts.length : 0);
      var scored = matchStart(m) - remainingIn(leg, pid) + (istAktiv ? pendingSum : 0);
      var avg = darts ? (scored / darts * 3).toFixed(1) : '–';
      /* Unter dem Namen: gewonnene Legs (Siege), bei Saetzen der Satzstand,
         und die Darts der laufenden Aufnahme. */
      var meta = [];
      if (schnell && qSt) {
        /* In der Session zaehlen die Legs einfach mit - "Siege" gibt es allein nicht. */
        meta.push((m.session ? 'Legs ' : 'Siege ') + qSt.legs[pid]);
        if (qSt.gewinnSaetze > 1) meta.push('Sätze ' + qSt.saetze[pid]);
      } else if (!schnell) {
        meta.push('Siege ' + legsWon(m, pid));
      }
      meta.push(plural(darts, 'Dart', 'Darts'));

      var letzte = '';
      /* Fernsteuerung: die Aufnahmen stehen in den Listen, die Box bleibt
         leer - ausser allein (Tastatur-Modus), da zeigt sie quer die letzte
         und vorletzte Aufnahme neben dem Rest. */
      var li = fern && m.p.length > 1 ? undefined : letzteIdx[pid];
      if (li !== undefined) {
        var lv = leg.visits[li];
        var frisch = li === neuesteVisit && seitAufnahme >= 0 && seitAufnahme < DREH_MS;
        var verz = frisch ? ' style="animation-delay:-' + seitAufnahme + 'ms"' : '';
        var aenderbar = !lv.c && !m.done;
        /* Die vorletzte Aufnahme: frisch faehrt sie mit der Animation aus
           dem Bild (bzw. im Tastatur-Modus quer eine Zeile tiefer), sonst
           steht sie still - und ist nur dort sichtbar, wo das Layout sie
           zeigt (Tastatur-Modus quer: letzte und vorletzte neben dem Rest). */
        var alt = '';
        if (vorletzteIdx[pid] !== undefined) {
          var av = leg.visits[vorletzteIdx[pid]];
          alt = '<span class="letzte-alt' + (wieBust(av) ? ' bust' : '') + (frisch ? ' neu' : ' still') + '"' + verz + '>' + (av.b ? av.o : av.s) + '</span>';
        }
        /* Ein Tipp auf die Zahl korrigiert die Aufnahme. */
        letzte = '<span class="letzte-box' + (aenderbar ? ' tap' : '') + '"' +
          (aenderbar ? ' data-action="edit-visit" data-i="' + li + '" role="button" tabindex="0" aria-label="Letzte Aufnahme korrigieren"' : '') + '>' +
          alt + '<span class="letzte' + (wieBust(lv) ? ' bust' : '') + (frisch ? ' neu' : '') + '"' + verz + '>' +
          (lv.b ? lv.o : lv.s) + '</span></span>';
      } else {
        /* Ohne Aufnahme bleibt der Platz leer - der Rest steht trotzdem fest. */
        letzte = '<span class="letzte-box ohne"></span>';
      }
      return '<div class="pcard ' + (istAktiv ? 'active' : '') + (fern && pid === danach[0] ? ' naechster' : '') + '">' +
        '<div class="pkopf">' + avatarHTML(profile(pid), 'sm') +
          '<div class="pblock"><span class="pname">' + esc(spielerName(pid)) + '</span>' +
          '<span class="pmeta">' + meta.join(' · ') + '</span></div>' +
          '<span class="pavg">Ø <b>' + avg + '</b></span></div>' +
        '<div class="rest-zeile"><span class="rest">' + rest + '</span>' + letzte + '</div>' +
        (fern ? '<div class="pwuerfe">' + histSpalte(pid, 3) + '</div>' : '') +
        felderHTML(pid, istAktiv || m.p.length === 1) +
        '</div>';
    }).join('');

    /*
     * Wurfverlauf (unsichtbar im Spielbild, sichtbar in der Fernsteuerung
     * bei gedruecktem Shift). Ab drei Spielern eine einzige Liste, neueste
     * Aufnahme oben, mit dem Namen davor.
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
          var danachRest = e.before - v.o;
          grund = danachRest < 0 ? ' · überworfen' : danachRest === 1 ? ' · Rest 1' : danachRest === 0 ? ' · kein Doppel' : '';
        }
        var aenderbar = !v.c && !m.done;
        return '<div class="v ' + (wieBust(v) ? 'bust' : v.c ? 'co' : '') + (aenderbar ? ' tap' : '') + '"' +
          (aenderbar ? ' data-action="edit-visit" data-i="' + e.idx + '" role="button" tabindex="0"' : '') + '>' +
          '<span class="wer">' + esc(pname(v.p)) + '</span>' +
          '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
          '<span class="r">' + (wieBust(v) ? 'Bust' + grund : 'Rest ' + e.rest) + '</span></div>';
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
            rows.push('<div class="v ' + (wieBust(v) ? 'bust' : v.c ? 'co' : '') + (editable ? ' tap' : '') + '"' +
              (editable ? ' data-action="edit-visit" data-i="' + e.idx + '" role="button" tabindex="0"' : '') + '>' +
              '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
              '<span class="r">' + (wieBust(v) ? 'Bust' + why : 'Rest ' + e.rest) + '</span></div>');
          });
        }
        return '<div class="col">' + rows.join('') + '</div>';
      }).join('');
    }

    UI.letzterModus = mode;
    $('pad-total').classList.toggle('hidden', anzeige !== 'total');
    $('pad-darts').classList.toggle('hidden', anzeige !== 'darts');
    $('pad-key').classList.toggle('hidden', !fern);
    /* Die Fernsteuerung stellt den ganzen Bildschirm um: Reste in
       Plakatgroesse, unten die Aufnahmen - das regelt das CSS ueber diese
       Klasse. Beim Verlassen klappt auch eine offene Wurfliste zu. */
    $('screen-game').classList.toggle('turnier', mode === 'turnier');
    if (mode !== 'turnier') $('screen-game').classList.remove('verlauf');

    if (fern) {
      /* Links und rechts der Eingabe die letzten sechs Aufnahmen des
         laufenden Legs (Liga-Vorschrift), neueste oben. Zu zweit links der
         erste, rechts der zweite Spieler (fest wie die Karten); ab dreien
         links wer wirft, rechts wer als Naechstes kommt. Allein (Tastatur-
         Modus) stehen statt der Listen die Statistik-Kacheln und die letzten
         Aufnahmen rechts bzw. unter dem Eingabefeld. */
      var soloFern = m.p.length === 1;
      $('pad-key').classList.toggle('solo', soloFern);
      $('key-solo').classList.toggle('hidden', !soloFern);
      $('key-solo').innerHTML = soloFern
        ? sessionKachelnHTML(m, 'kacheln') + sessionMehrHTML(m) + '<div class="key-liste">' + histSpalte(active, 8) + '</div>' : '';
      $('key-hist-l').innerHTML = soloFern ? '' : histSpalte(m.p.length === 2 ? m.p[0] : active, 6);
      $('key-hist-r').innerHTML = soloFern ? '' : histSpalte(m.p.length === 2 ? m.p[1] : danach[0], 6);
      /* Allein am Handy gibt es keine Tastatur: ein Tipp auf die Anzeige
         holt ueber das versteckte Feld die Zifferntastatur des Systems. */
      var kd = $('key-display');
      if (soloFern) { kd.setAttribute('data-action', 'key-tippen'); kd.setAttribute('role', 'button'); kd.setAttribute('tabindex', '0'); kd.setAttribute('aria-label', 'Aufnahme eintippen'); }
      else { kd.removeAttribute('data-action'); kd.removeAttribute('role'); kd.removeAttribute('tabindex'); kd.removeAttribute('aria-label'); }
      var kiFeld = $('key-input');
      if (kiFeld && kiFeld.value !== UI.input) kiFeld.value = UI.input;
      $('key-error').textContent = UI.error;
      /* Kein Platzhaltertext – leer steht nur der blaue Eingabestrich,
         und sobald Ziffern da sind, stehen nur die Ziffern. */
      $('key-display').innerHTML = UI.input === ''
        ? '<span class="cursor"></span>' : esc(UI.input);
    } else if (anzeige === 'total') {
      $('quick-row').innerHTML = QUICK_SCORES.map(function (q) { return '<button data-quick="' + q + '">' + q + '</button>'; }).join('');
      var disp = $('score-display');
      disp.textContent = UI.input === '' ? '0' : UI.input;
      disp.classList.toggle('empty', UI.input === '');
      $('input-error').textContent = UI.error;
    } else {
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
      /* Oberste Reihe: Double und Triple als Schalter (keiner an = Single),
         Bull und Bull x2. */
      var nums = '<button class="mult' + (UI.mult === 2 ? ' active' : '') + '" data-mult="2" aria-pressed="' + (UI.mult === 2) + '">Double</button>' +
        '<button class="mult' + (UI.mult === 3 ? ' active' : '') + '" data-mult="3" aria-pressed="' + (UI.mult === 3) + '">Triple</button>' +
        '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25">Bull</button>' +
        '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-bull="1">Bull ×2</button>';
      for (var n = 1; n <= 20; n++) {
        nums += '<button data-num="' + n + '" class="' + (n === hlNum ? 'hl' : '') + '">' +
          (prefix ? '<span class="mx">' + prefix + '</span>' : '') + n + '</button>';
      }
      /* Unterste Reihe: Zurueck (letzter Dart bzw. letzte Aufnahme), 0 fuer
         den Fehlwurf, OK schliesst die Aufnahme ab und fuellt die fehlenden
         Darts als Fehlwuerfe auf - dreimal am Doppel vorbei muss nicht
         dreimal getippt werden. */
      nums += '<button class="zurueck" data-action="undo" aria-label="Letzten Dart zurücknehmen">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12H7M11.5 6.5L6 12l5.5 5.5"></path></svg></button>';
      nums += '<button class="miss" data-num="0" aria-label="Fehlwurf">0</button>';
      nums += '<button class="end-visit" data-action="end-visit">OK</button>';
      $('num-grid').innerHTML = nums;
      $('darts-error').textContent = UI.error;
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
    var n = g.players.length;
    var aktIdx = g.players.indexOf(active);
    /* Wer gerade geworfen hat - seine Aufnahme bleibt zum Nachpruefen in
       seiner Karte stehen (gedimmt), bis er wieder dran ist. */
    var vorherId = !g.done && g.throws.length > 0 && g.throws.length % 3 === 0 && n > 1
      ? g.players[(aktIdx - 1 + n) % n] : null;
    /* Ab fuenf Spielern passen nicht alle Spalten aufs Bild: es stehen
       der, der gerade geworfen hat, der am Wurf und die zwei naechsten;
       die uebrigen nennt die Kopfzeile. */
    var spalten = g.players;
    var wartend = [];
    if (n > 4) {
      spalten = [];
      for (var k = -1; k <= 2; k++) spalten.push(g.players[(aktIdx + k + n) % n]);
      for (var w = 3; w < n - 1; w++) wartend.push(g.players[(aktIdx + w) % n]);
    }
    /* Neue Spalte von rechts hereinschieben, wenn die Tafel weiterrueckt. */
    var neuRechts = n > 4 && UI.cricketSpalten && UI.cricketSpalten.indexOf(spalten[spalten.length - 1]) < 0;
    UI.cricketSpalten = spalten.slice();

    var sub = (g.scoring ? 'mit Punkten' : 'ohne Punkte') + ' · ' + n + ' Spieler' +
      (wartend.length ? ' · danach ' + wartend.map(function (id) { return esc(pname(id)); }).join(', ') : '') + esc(liveLabel(g));
    var runde = Math.floor(g.throws.length / (3 * n)) + 1;

    var zu = function (id) {
      return CRICKET_NUMBERS.filter(function (x) { return st.marks[id][x] >= 3; }).length;
    };
    var lead = g.players.slice().sort(function (a, b) {
      return g.scoring ? (st.score[b] - st.score[a]) || (zu(b) - zu(a)) : (zu(b) - zu(a));
    })[0];
    /* „Vorn" heisst nur etwas, wenn ueberhaupt schon etwas passiert ist –
       am Anfang stehen alle auf null, und dann waere der Erste in der Liste
       willkuerlich der Anfuehrer. Und allein fuehrt man nicht. */
    var fuehrt = n > 1 && (g.scoring ? st.score[lead] > 0 : zu(lead) > 0) ? lead : null;

    var dead = {};
    CRICKET_NUMBERS.forEach(function (x) {
      dead[x] = g.players.every(function (id) { return st.marks[id][x] >= 3; });
    });
    var reinKl = function (i) { return neuRechts && i === spalten.length - 1 ? ' rein' : ''; };

    /* Kopfzeile: Menue, je Spieler eine Karte, Luecke, Titel mit Zurueck und Bust. */
    var html = '<button class="xk-btn cr-menu" data-action="game-menu" aria-label="Menü">' + '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g opacity="0.8"><circle cx="3.5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="20.5" cy="12" r="1.8"></circle></g></svg>' + '</button>';
    html += spalten.map(function (id, i) {
      var istAkt = id === active;
      var istVorher = id === vorherId;
      var mpr = st.darts[id] ? (st.allMarks[id] / st.darts[id]) * 3 : 0;
      /* Ohne Punkte zaehlt nur der Fortschritt: die Marken in Prozent (21 = alles zu), klein. */
      var marken = CRICKET_NUMBERS.reduce(function (sum, x) { return sum + Math.min(3, st.marks[id][x]); }, 0);
      var wert = g.scoring ? st.score[id] : Math.round(marken / 21 * 100) + ' %';
      /* An der Aufnahmegrenze (3, 6, 9 ... Darts) liefert gameVisitDarts die
         letzten drei - die gehoeren dem Vorgaenger, nicht dem Aktiven. Nach
         dem Sieg bleibt die Aufnahme des Siegers stehen. */
      var grenze = g.throws.length > 0 && g.throws.length % 3 === 0 && !g.done;
      var darts = istAkt ? (grenze ? [] : visit) : istVorher ? g.throws.slice(-3) : [];
      var kacheln = [0, 1, 2].map(function (k) {
        var d = darts[k];
        return '<span class="ct' + (d ? (istVorher ? ' alt' : '') : ' leer') + '">' + (d ? (d.n === 0 ? '–' : throwLabel(d)) : '') + '</span>';
      }).join('');
      return '<div class="cr-card' + (istAkt ? ' act' : '') + (istVorher ? ' vorher' : '') + reinKl(i) + '">' +
        '<div class="pkopf">' + avatarHTML(profile(id), 'sm') +
          '<div class="pblock"><span class="pname">' + esc(pname(id)) + '</span>' +
          '<span class="pmeta">MPR <b class="cr-mpr">' + (st.darts[id] ? mpr.toFixed(2) : '–') + '</b></span></div></div>' +
        '<div class="cr-pts' + (g.scoring ? '' : ' klein') + (id === fuehrt ? ' fuehrt' : '') + '">' + wert + '</div>' +
        '<div class="cr-tiles">' + kacheln + '</div></div>';
    }).join('');
    html += '<div class="cr-gap"></div>' +
      '<div class="cr-titel">' +
        '<div class="cr-kopf"><span class="cr-h">Cricket</span>' +
        '<span class="cr-sub" id="cricket-sub">' + sub + '</span>' +
        '<span class="cr-runde">Runde ' + runde + '</span></div>' +
        '<div class="cr-top">' +
          '<button class="cr-key zurueck" data-action="undo-game" aria-label="Letzten Dart zurücknehmen">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12H7M11.5 6.5L6 12l5.5 5.5"></path></svg>' + '</button>' +
          /* Nichts getroffen? Ein Tipp beendet die Aufnahme und fuellt die
             fehlenden Darts als Fehlwuerfe auf. */
          '<button class="cr-key bust" data-action="end-cricket-visit">Bust</button>' +
        '</div></div>';

    /* Die Zeilen: Zahl, je Spieler die Marken, Luecke, drei Tasten. */
    /* Hochkant stellt das CSS die Tasten als Block unter die Tafel - dafuer
       tragen sie Spalte (--c) und Reihe (--m) als Variablen mit. */
    html += CRICKET_NUMBERS.map(function (x, xi) {
      var tot = dead[x];
      var pos = function (m) { return ' style="--c:' + (xi + 1) + ';--m:' + m + '"'; };
      var zeile = '<div class="cr-num' + (tot ? ' dead' : '') + '">' + (x === 25 ? 'Bull' : x) + '</div>';
      zeile += spalten.map(function (id, i) {
        var m = st.marks[id][x];
        return '<div class="cr-mark' + (tot ? ' dead' : '') + (id === active ? ' act' : '') + ' m' + m + reinKl(i) + '">' +
          (m === 0 ? '' : m === 1 ? '/' : m === 2 ? '✕' : '⊗') + '</div>';
      }).join('');
      zeile += '<div class="cr-gap"></div>';
      var dim = tot ? ' dim' : '';
      if (x === 25) {
        zeile += '<button class="cr-key bull' + dim + '" data-num="25" data-mult="1"' + pos(1) + '>Bull</button>' +
          '<button class="cr-key bull' + dim + '" data-num="25" data-mult="2"' + pos(2) + '>Bull ×2</button>' +
          '<button class="cr-key miss" data-num="0" data-mult="1"' + pos(3) + '>Miss</button>';
      } else {
        zeile += [1, 2, 3].map(function (mult) {
          return '<button class="cr-key' + dim + '" data-num="' + x + '" data-mult="' + mult + '"' + pos(mult) + '>' +
            (mult > 1 ? '<span class="mx">' + (mult === 3 ? 'T' : 'D') + '</span>' : '') + x + '</button>';
        }).join('');
      }
      return zeile;
    }).join('');

    var grid = $('cricket-grid');
    grid.style.setProperty('--spalten', spalten.length);
    /* Hochkant: jede Spielerspalte darf mehrere Rasterspalten breit sein. */
    grid.style.setProperty('--span', Math.min(4, Math.max(1, Math.floor(5 / spalten.length))));
    grid.classList.toggle('eng', spalten.length >= 4);
    grid.classList.toggle('viele', spalten.length > 2);
    grid.innerHTML = html;

    $('cricket-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (n < 2 ? 'hat alles zu' : 'gewinnt')
      : '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b>';
    $('cricket-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('cricket-menu-overlay'));
    if (UI.menu) document.querySelector('#cricket-menu-overlay .game-menu-sub').textContent = $('cricket-sub').textContent;
  }

  function renderRtw() {
    var g = S.game;
    if (!g || g.kind !== 'rtw') { S.screen = 'setup'; render(); return; }
    var st = rtwState(g);
    var active = g.done ? g.winner : gameTurnPlayer(g);
    var visit = gameVisitDarts(g);
    var n = g.players.length;

    $('rtw-sub').textContent = (g.boost ? 'Boost · Double +2, Triple +3' : 'Einfach · jeder Treffer +1') +
      ' · ' + plural(n, 'Spieler', 'Spieler') + liveLabel(g);
    $('rtw-runde').textContent = 'Runde ' + (Math.floor(g.throws.length / (3 * n)) + 1);
    $('rtw-board').style.setProperty('--zeilen', Math.max(n, 3));
    $('rtw-board').classList.toggle('viele', n > 3);

    /* Wie im Cricket: die fertige Aufnahme des Vorgaengers bleibt gedimmt in
       seiner Zeile stehen, bis er wieder dran ist. */
    var vorherIdx = !g.done && st.inVisit === 0 && g.throws.length > 0 && n > 1 ? -1 : null;
    $('rtw-board').innerHTML = g.players.map(function (id, i) {
      var t = st.target[id];
      var fin = st.finished[id];
      var istAkt = id === active;
      /* 21 Stationen: die 20 Zahlen und der Bull. */
      var doneSteps = fin ? 21 : (t === 25 ? 20 : t - 1);
      var darts = istAkt && !(st.inVisit === 0 && !g.done) ? visit : [];
      var istVorher = false;
      if (st.inVisit === 0 && !g.done && g.throws.length > 0 && g.players[(g.players.indexOf(active) - 1 + n) % n] === id && n > 1) {
        darts = g.throws.slice(-3); istVorher = true;
      }
      if (istAkt && g.done) darts = visit;
      var kacheln = istAkt || istVorher ? [0, 1, 2].map(function (k) {
        var d = darts[k];
        return '<span class="ct' + (d ? (istVorher ? ' alt' : '') + (d.n === 0 ? ' miss' : '') : ' leer') + '">' +
          (d ? (d.n === 0 ? '–' : throwLabel(d)) : '') + '</span>';
      }).join('') : '';
      var meta = plural(st.darts[id], 'Dart', 'Darts') + ' · ' + plural(st.hits[id], 'Treffer', 'Treffer');
      if (istAkt) meta = '<span id="rtw-fortschritt-txt">Station ' + Math.min(doneSteps + 1, 21) + ' von 21 · ' + meta + '</span>';
      return '<div class="rtw-row' + (istAkt ? ' act' : '') + (fin ? ' fin' : '') + (istVorher ? ' vorher' : '') + '">' +
        avatarHTML(profile(id), 'md') +
        '<div class="rw-main">' +
          '<div class="rw-name">' + esc(pname(id)) + '</div>' +
          /* Die Klinge glueht an ihrer Spitze - bei null Stationen gibt es
             keine Spitze, sonst saesse der Lichtpunkt am linken Rand. */
          '<div class="rw-bar"><span class="klinge' + (doneSteps ? '' : ' aus') +
            '" style="width:' + (doneSteps / 21 * 100) + '%"></span></div>' +
          '<div class="rw-sub">' + meta + '</div>' +
        '</div>' +
        '<div class="rw-tiles">' + kacheln + '</div>' +
        '<div class="rw-target' + (t === 25 && !fin ? ' bull' : '') + '">' + (fin ? '✓' : t === 25 ? 'Bull' : t) + '</div>' +
        '</div>';
    }).join('');

    $('rtw-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (n < 2 ? 'ist durch' : 'gewinnt')
      : st.stechen
        ? '<b>Stechen</b> <span class="muted">– der Bull entscheidet</span>'
        : (st.closing ? '<span class="muted">Runde wird zu Ende gespielt · </span>' : '') +
          '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b> <span class="muted">auf</span> <b>' +
          (st.target[active] === 25 ? 'Bull' : st.target[active]) + '</b>';
    $('rtw-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('rtw-menu-overlay'));
    if (UI.menu) document.querySelector('#rtw-menu-overlay .game-menu-sub').textContent = $('rtw-sub').textContent;

    /*
     * Gleich viele Darts – jetzt wirft jeder der Gleichauf einen Dart auf
     * den Bull, und wer am naechsten dran war, wird angetippt. Wie beim
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

    /*
     * Es wird immer nur auf die eigene Zahl geworfen: die Zahl gross, im
     * Boost darunter Double und Triple als gleichwertige Tasten, jede mit
     * dem Hinweis, wohin der Treffer fuehrt. Unten Miss; "Bust" oben rechts
     * verbucht die restlichen Darts der Aufnahme als Fehlwuerfe.
     */
    var target = st.target[active];
    var jump = function (mult) {
      var next = target + mult;
      return next > 20 ? 'dann Bull' : 'dann ' + next;
    };
    var miss = '<div class="rtw-reihe"><button class="rtw-key miss" data-num="0" data-mult="1">' +
      '<span class="k">Miss</span><span class="sub">ein Dart daneben</span></button></div>';
    var treffer;
    if (target === 25) {
      treffer = '<div class="rtw-treffer nur-bull">' +
        '<button class="rtw-key gross bull" data-num="25" data-mult="1">' +
          '<span class="z">Bull</span><span class="sub">Spiel gewonnen</span></button>' +
        '</div>';
    } else if (!g.boost) {
      treffer = '<div class="rtw-treffer nur-zahl">' +
        '<button class="rtw-key gross" data-num="' + target + '" data-mult="1">' +
          '<span class="z">' + target + '</span><span class="sub">' + jump(1) + '</span></button>' +
        '</div>';
    } else {
      treffer = '<div class="rtw-treffer">' +
        '<button class="rtw-key gross" data-num="' + target + '" data-mult="1">' +
          '<span class="z">' + target + '</span><span class="sub">' + jump(1) + '</span></button>' +
        '<button class="rtw-key mult" data-num="' + target + '" data-mult="2">' +
          '<span class="k"><span class="mx">D</span>' + target + '</span><span class="sub">' + jump(2) + '</span></button>' +
        '<button class="rtw-key mult" data-num="' + target + '" data-mult="3">' +
          '<span class="k"><span class="mx">T</span>' + target + '</span><span class="sub">' + jump(3) + '</span></button>' +
        '</div>';
    }
    $('rtw-pad').innerHTML = treffer + miss;
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
          if (e.matches[j].id === id) return { m: e.matches[j], start: (e.settings && e.settings.start) || 501, live: false, quick: e.kind === 'quick', at: e.at };
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
  /* Stellwurf fuer Rest und Darts in der Hand: aus der Finish-Tabelle
     (bis 170), darueber der alte Rechenweg mit einem Dart auf ein gutes
     Doppel. Liefert { darts: ['T19','S10'], auf: 32 } oder null. */
  /* Der Weg zu Beginn einer Aufnahme ist ein Plan: Finish ({ darts, auf: null })
     oder Stellwurf ({ darts, auf }). Solange die Darts wie geplant fallen,
     bleibt der Rest des Plans stehen (128: T20 T16 D10 - nach der T20 nicht
     ploetzlich T20 D4); erst nach einem Fehlwurf wird fuer den neuen Rest
     nachgeschlagen. */
  function planFuer(rest, dartsLeft, dbl) {
    var w = Checkout.suggest(rest, dartsLeft, dbl);
    if (w) return { darts: w, auf: null };
    return stellwurfFuer(rest, dartsLeft, dbl);
  }
  function stellwurfFuer(rest, dartsLeft, dbl) {
    var aus = Checkout.stellwurf(rest, dartsLeft, dbl);
    if (aus) return aus;
    var einer = finisherStellwurf(rest, dbl);
    if (!einer) return null;
    var d = labelDart(einer);
    return { darts: [einer], auf: rest - d.n * d.m };
  }
  function finisherStellwurf(rest, dbl) {
    var ziele = [];
    var d = dbl && typeof dbl === 'object' ? dbl.dbl : dbl;
    if (d && d !== 25) ziele.push(2 * d);
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

  var HAKEN = '<svg class="haken" viewBox="0 0 24 24" aria-label="durch"><path d="M4 12.5l5 5L20 7"></path></svg>';

  /* Eine Aufnahme als Zahl (Fernsteuerung): die Punkte in hoechstens k
     einzelne Darts zerlegen - grosse Felder zuerst, damit der Weg so
     aussieht, wie man ihn wirklich wirft. null, wenn es nicht geht. */
  var DART_WERTE = (function () {
    var w = {};
    for (var n = 1; n <= 20; n++) { w[n] = { n: n, m: 1 }; w[2 * n] = w[2 * n] || { n: n, m: 2 }; w[3 * n] = w[3 * n] || { n: n, m: 3 }; }
    w[25] = { n: 25, m: 1 }; w[50] = { n: 25, m: 2 };
    /* Lieber T20 als D30: fuer jeden Wert das "natuerlichste" Feld. */
    for (var t = 20; t >= 1; t--) { w[3 * t] = { n: t, m: 3 }; }
    /* Bis 20 bleibt es das Single-Feld (3 ist S3, nicht T1). */
    for (var s1 = 1; s1 <= 20; s1++) w[s1] = { n: s1, m: 1 };
    return w;
  })();
  function dartsFuerPunkte(total, k) {
    if (total === 0) return [];
    if (k <= 0) return null;
    var werte = Object.keys(DART_WERTE).map(Number).filter(function (v) { return v <= total; }).sort(function (a, b) { return b - a; });
    for (var i = 0; i < werte.length; i++) {
      var v = werte[i];
      if (v === total) return [DART_WERTE[v]];
      var rest = dartsFuerPunkte(total - v, k - 1);
      if (rest) return [DART_WERTE[v]].concat(rest);
    }
    return null;
  }

  /* Fernsteuerung: die getippte Aufnahme buchen. Kein Finish: die Darts
     werden eingetragen und die Aufnahme mit Fehlwuerfen aufgefuellt. Bust:
     bis zum Dart, der ueberwirft. Finish: wie im X01 die Frage nach der
     Dartzahl. */
  function finisherAufnahmeTippen(total) {
    var g = S.game;
    if (!g || g.kind !== 'finisher' || g.done) return;
    var rd = finisherRunde(g);
    if (rd.stechen) return;
    var st = finisherState(g);
    var pid = g.players[st.turn];
    var rest = st.rest[pid], frei = 3 - st.inVisit;
    if (total > MAX_VISIT || IMPOSSIBLE[total] || !dartsFuerPunkte(total, frei)) {
      UI.error = total + ' ist mit ' + plural(frei, 'Dart', 'Darts') + ' nicht möglich'; UI.input = ''; render(); return;
    }
    var nach = rest - total;
    if (nach === 0) {
      var opts = [];
      for (var k = 1; k <= frei; k++) if (Checkout.possible(rest, k)) opts.push(k);
      if (opts.length) { UI.overlay = { type: 'checkout-darts', score: total, options: opts, fin: true }; save(); render(); return; }
    }
    pomp();
    var darts = dartsFuerPunkte(total, frei);
    var bust = nach < 0 || nach === 1 || nach === 0;
    for (var i = 0; i < darts.length; i++) {
      rd.throws.push({ n: darts[i].n, m: darts[i].m });
      if (bust && finisherState(g).inVisit === 0) break;   // der Dart hat ueberworfen - Schluss
    }
    if (!bust) { var offen = frei - darts.length; for (var o = 0; o < offen; o++) rd.throws.push({ n: 0, m: 0 }); }
    UI.input = ''; UI.error = ''; UI.mult = 1;
    pruefeFinisherRunde(g);
    save(); render();
  }
  /* "-" in der Fernsteuerung: die Aufnahme ist ueberworfen, der Rest bleibt. */
  function finisherUeberworfen() {
    var g = S.game;
    if (!g || g.kind !== 'finisher' || g.done) return;
    var rd = finisherRunde(g);
    if (rd.stechen) return;
    pomp();
    rd.throws.push({ n: 0, m: 0, bust: true });
    UI.input = ''; UI.error = ''; UI.mult = 1;
    pruefeFinisherRunde(g);
    save(); render();
  }
  function finisherFinishBuchen(anz) {
    var g = S.game;
    if (!g || g.kind !== 'finisher' || g.done) return;
    var rd = finisherRunde(g);
    var st = finisherState(g);
    var rest = st.rest[g.players[st.turn]];
    var route = Checkout.suggest(rest, anz);
    if (!route) return;
    pomp();
    for (var m = route.length; m < anz; m++) rd.throws.push({ n: 0, m: 0 });
    route.forEach(function (label) { var d = labelDart(label); rd.throws.push({ n: d.n, m: d.m }); });
    UI.input = ''; UI.error = ''; UI.mult = 1;
    pruefeFinisherRunde(g);
    save(); render();
  }

  /* Die neue Zahl wuerfeln: anderthalb Sekunden rollen Zufallszahlen immer
     langsamer durch, dann landet die echte, kurz darauf fliegt sie in das
     Zahl-Feld oben rechts. Rein Anzeige - der Stand steht laengst fest. */
  var finWuerfelTimer = [];
  function finisherWuerfeln(zahl) {
    var box = $('fin-roller');
    if (!box || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    finWuerfelTimer.forEach(clearTimeout); finWuerfelTimer = [];
    var zahlEl = box.querySelector('.fin-wuerfel-zahl');
    var label = box.querySelector('.fin-roller-label');
    var zufall = function () { return 6 + Math.floor(Math.random() * 115); };
    box.className = 'fin-roller an roll';
    label.textContent = 'Neue Zahl …';
    zahlEl.textContent = zufall();
    var at = function (ms, fn) { finWuerfelTimer.push(setTimeout(fn, ms)); };
    var t = 0, schritt = 45;
    while (t < 1500) { t += schritt; schritt *= 1.12; at(t, function () { zahlEl.textContent = zufall(); }); }
    at(t + 60, function () { zahlEl.textContent = zahl; label.textContent = 'Neue Zahl'; box.className = 'fin-roller an land'; });
    at(t + 760, function () {
      /* Flugziel: das Zahl-Feld, relativ zur Bildmitte. */
      var ziel = $('fin-zahl'), wrap = box.querySelector('.fin-roller-wrap');
      if (ziel && wrap) {
        var z = ziel.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        wrap.style.setProperty('--fx', Math.round(z.left + z.width / 2 - (w.left + w.width / 2)) + 'px');
        wrap.style.setProperty('--fy', Math.round(z.top + z.height / 2 - (w.top + w.height / 2)) + 'px');
      }
      box.className = 'fin-roller an fly';
    });
    at(t + 1360, function () {
      box.className = 'fin-roller';
      var feld = $('fin-zahl') && $('fin-zahl').parentElement;
      if (feld) { feld.classList.remove('ping'); void feld.offsetWidth; feld.classList.add('ping'); }
    });
  }

  function renderFinisher() {
    var g = S.game;
    if (!g || g.kind !== 'finisher') { S.screen = 'setup'; render(); return; }
    var st = finisherState(g);
    var rd = finisherRunde(g);
    var aktiv = g.players[st.turn];
    var n = g.players.length;

    $('fin-sub').textContent = plural(n, 'Spieler', 'Spieler') + ' · Double Out · auf ' + g.ziel + ' Punkte' + liveLabel(g);
    $('fin-runde').textContent = 'Runde ' + (st.runde + 1);
    $('fin-zahl').textContent = st.zahl;
    /* Neue Runde nach einem Finish: die Zahl rollt aus und fliegt in ihr
       Feld. Nicht beim ersten Zeichnen, nicht nach Zurueck, nicht am Ende. */
    if (UI.finRunde !== undefined && UI.finSpiel === g.id && g.rounds.length > UI.finRunde && !g.done) finisherWuerfeln(st.zahl);
    UI.finRunde = g.rounds.length; UI.finSpiel = g.id;

    $('fin-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (n < 2 ? 'hat ausgemacht' : 'hat gewonnen')
      : rd.stechen
        ? '<b>Stechen</b><span class="muted"> – der Bull entscheidet</span>'
        : '<span class="muted">Am Wurf</span> <b>' + esc(pname(aktiv)) + '</b>' +
          '<span class="muted"> · Rest ' + st.rest[aktiv] + '</span>';
    $('fin-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('fin-menu-overlay'));
    if (UI.menu) document.querySelector('#fin-menu-overlay .game-menu-sub').textContent = $('fin-sub').textContent;
    /* Stechen: gleichgezogen, jetzt entscheidet der Bull. Wie beim Anwurf
       wird von Hand getippt, wer naeher dran war – messen kann die App das
       nicht, und am Board sieht man es sofort. */
    $('fin-stechen-overlay').classList.toggle('hidden', !rd.stechen);
    if (rd.stechen) {
      $('fin-stechen-text').textContent = rd.stechen.spieler.map(function (id) { return pname(id); }).join(' und ') +
        ' haben beide gefinished. Einmal auf Bull werfen – wer war näher dran?';
      $('fin-stechen-wahl').innerHTML = rd.stechen.spieler.map(function (id) {
        return '<button class="btn primary" data-action="fin-stechen" data-id="' + esc(id) + '">' + esc(pname(id)) + '</button>';
      }).join('');
    }
    $('screen-finisher').classList.toggle('fern', !!UI.finFern);

    /* Die drei Felder des Spielers am Wurf: geworfen und getroffen wie
       vorgegeben -> gruen; daneben geworfen -> die geworfene Zahl; der
       naechste Wurf hell umrandet; geht kein Finish mehr, steht der
       Stellwurf mit dem Ziel, auf das er stellt. */
    var route = null;
    var kacheln = ['', '', ''];
    if (!g.done && !rd.stechen && !st.fertig[aktiv]) {
      /* Im Finisher hat jeder genau diese drei Darts auf seinen Rest - es
         zaehlt nur die Chance auf das Finish (Checkout-Variante). */
      var dbl = lieblingsDoppel(aktiv, { checkout: true });
      var restLauf = st.restVorVisit;
      var fPlan = planFuer(st.restVorVisit, 3, dbl);
      var fPlanGilt = !!fPlan;
      for (var ki = 0; ki < st.inVisit; ki++) {
        var wurf = st.visit[ki];
        var empf = fPlanGilt && fPlan.darts[ki] ? [fPlan.darts[ki]]
          : (Checkout.suggest(restLauf, 3 - ki, dbl) || (stellwurfFuer(restLauf, 3 - ki, dbl) || {}).darts);
        var soll = empf && empf.length ? labelDart(empf[0]) : null;
        var getroffen = soll && wurf.n === soll.n && wurf.m === soll.m;
        if (!getroffen) fPlanGilt = false;
        kacheln[ki] = '<span class="fk ' + (getroffen ? 'gut' : 'anders') + '">' +
          (wurf.n === 0 ? '–' : dartLabel(wurf)) + '</span>';
        restLauf -= wurf.n * wurf.m;
      }
      var fPlanRest = fPlanGilt && st.inVisit > 0 && fPlan.darts.length > st.inVisit
        ? { darts: fPlan.darts.slice(st.inVisit), auf: fPlan.auf } : null;
      route = fPlanRest ? (fPlanRest.auf === null ? fPlanRest.darts : null) : Checkout.suggest(st.rest[aktiv], 3 - st.inVisit, dbl);
      /* Die vorgeschlagene Kachel ist zugleich die Taste (wie im X01):
         data-num/data-mult nimmt derselbe Handler wie das Zahlenfeld. In
         der Fernsteuerung bleibt sie reine Anzeige. */
      var fTaste = function (d, klasse, innen) {
        var soll = labelDart(d);
        return UI.finFern ? '<span class="fk ' + klasse + '">' + innen + '</span>'
          : '<button type="button" class="fk tipp ' + klasse + '" data-num="' + soll.n + '" data-mult="' + soll.m + '" aria-label="' + Checkout.pretty(d) + ' getroffen">' + innen + '</button>';
      };
      if (route) {
        for (var ri = 0; ri < route.length && st.inVisit + ri < 3; ri++) {
          kacheln[st.inVisit + ri] = fTaste(route[ri], ri === 0 ? 'jetzt' : '', Checkout.pretty(route[ri]));
        }
      } else if (st.inVisit < 3) {
        var stw = fPlanRest && fPlanRest.auf !== null ? fPlanRest : stellwurfFuer(st.rest[aktiv], 3 - st.inVisit, dbl);
        if (stw) {
          for (var si = 0; si < stw.darts.length && st.inVisit + si < 3; si++) {
            kacheln[st.inVisit + si] = fTaste(stw.darts[si], 'stellen' + (si === 0 ? ' jetzt' : ''), Checkout.pretty(stw.darts[si]) +
              (si === stw.darts.length - 1 ? '<span class="fk-auf">auf ' + stw.auf + '</span>' : ''));
          }
        }
      }
    }
    for (var kl = 0; kl < 3; kl++) if (!kacheln[kl]) kacheln[kl] = '<span class="fk leer">–</span>';

    /* Spielerkarten wie im X01: Name, Darts und Aufnahmen, rechts die
       Laserpillen (je Zielpunkt eine, jedes Finish zuendet eine), gross der
       Rest, darunter die drei Felder. Wer durch ist, traegt den Haken. */
    $('fin-board').classList.toggle('viele', n > 2);
    $('fin-board').style.setProperty('--n', n);
    $('fin-board').innerHTML = g.players.map(function (id) {
      var fertig = st.fertig[id];
      var istAkt = id === aktiv && !rd.stechen && !g.done;
      var klassen = ['pcard'];
      if (fertig) klassen.push('fertig');
      else if (istAkt) klassen.push('active');
      var pillen = '';
      for (var fp = 0; fp < g.ziel; fp++) {
        pillen += '<span class="fin-pille' + (fp < (st.punkte[id] || 0) ? ' an' : '') + '"></span>';
      }
      var felder = istAkt && !fertig
        ? '<div class="pfelder" id="fin-hint">' + kacheln.join('') + '</div>'
        : '<div class="pfelder"><span class="fk still"></span><span class="fk still"></span><span class="fk still"></span></div>';
      return '<div class="' + klassen.join(' ') + '">' +
        '<div class="pkopf">' + avatarHTML(profile(id), 'sm') +
          '<div class="pblock"><span class="pname">' + esc(pname(id)) + '</span>' +
          '<span class="pmeta">Darts ' + st.darts[id] + ' · Aufnahmen ' + st.aufnahmen[id] + '</span></div>' +
          '<div class="fin-pillen" role="img" aria-label="' + (st.punkte[id] || 0) + ' von ' + g.ziel + ' Finishes">' + pillen + '</div></div>' +
        '<div class="rest-zeile"><span class="rest">' + (fertig ? HAKEN : st.rest[id]) + '</span></div>' +
        felder +
        '</div>';
    }).join('');

    /* Fernsteuerung: dieselben Karten in Plakatgroesse (fest an ihrem
       Platz), je Spieler der Finish-Weg als Felder, unten die letzten
       Aufnahmen und die Eingabe-Anzeige. */
    if (UI.finFern) {
      $('ff-runde').textContent = 'Runde ' + (st.runde + 1);
      $('ff-sub').textContent = $('fin-sub').textContent;
      $('ff-zahl').textContent = st.zahl;
      $('ff-karten').classList.toggle('viele', n > 2);
      $('ff-karten').innerHTML = g.players.map(function (id) {
        var fertig = st.fertig[id];
        var istAkt = id === aktiv && !rd.stechen && !g.done;
        var pillen = '';
        for (var fp = 0; fp < g.ziel; fp++) pillen += '<span class="fin-pille' + (fp < (st.punkte[id] || 0) ? ' an' : '') + '"></span>';
        var weg = fertig || rd.stechen || g.done ? null
          : Checkout.suggest(st.rest[id], istAkt ? 3 - st.inVisit : 3, lieblingsDoppel(id, { checkout: true }));
        return '<div class="pcard' + (fertig ? ' fertig' : istAkt ? ' active' : '') + '">' +
          '<div class="pkopf">' + avatarHTML(profile(id), 'sm') +
            '<div class="pblock"><span class="pname">' + esc(pname(id)) + '</span>' +
            '<span class="pmeta">Darts ' + st.darts[id] + ' · Aufnahmen ' + st.aufnahmen[id] + '</span></div>' +
            '<div class="fin-pillen">' + pillen + '</div></div>' +
          '<div class="rest-zeile"><span class="rest">' + (fertig ? HAKEN : st.rest[id]) + '</span></div>' +
          '<div class="pfelder pfinish">' + (weg ? weg.map(function (d) {
            return '<span class="fk weg' + (istAkt ? '' : ' wartet') + '">' + Checkout.pretty(d) + '</span>';
          }).join('') : '') + '</div></div>';
      }).join('');
      /* Unten links und rechts die letzten drei Aufnahmen: zu zweit fest
         je Spieler, ab dreien der am Wurf und der Naechste. */
      var aufnahmen = finisherAufnahmen(g, rd);
      var ffListe = function (pid) {
        if (!pid) return '';
        return aufnahmen.filter(function (v) { return v.p === pid; }).slice(-3).reverse().map(function (v) {
          return '<div class="v ' + (v.b ? 'bust' : v.c ? 'co' : '') + '"><span class="s">' +
            (v.c ? 'Finish' : v.b ? 'Bust' : (v.rest + v.s) + ' → ' + v.rest) + '</span><span class="r">' + (v.c || v.b ? '' : v.s) + '</span></div>';
        }).join('');
      };
      var ffNaechster = g.players[(st.turn + 1) % n];
      $('ff-hist-l').innerHTML = ffListe(n === 2 ? g.players[0] : aktiv);
      $('ff-hist-r').innerHTML = ffListe(n === 2 ? g.players[1] : (n > 1 ? ffNaechster : null));
      $('ff-display').innerHTML = UI.input === '' ? '<span class="cursor"></span>' : esc(UI.input);
      $('ff-error').textContent = UI.error;
    }

    /* Zahlenfeld wie im X01: Double/Triple als Schalter, Bull, Bull x2,
       1 bis 20, Zurueck, 0 und OK (fuellt die Aufnahme mit Fehlwuerfen auf). */
    if (rd.stechen) {
      $('fin-pad').innerHTML = '<p class="hint center">Erst das Stechen entscheiden.</p>';
    } else {
      var hl = route ? route[0] : null;
      var hlMult = hl ? (hl.charAt(0) === 'T' ? 3 : hl.charAt(0) === 'D' || hl === 'BULL' ? 2 : 1) : 0;
      var hlNum = hl && hl !== 'BULL' && hl !== '25' && UI.mult === hlMult ? parseInt(hl.slice(1), 10) : null;
      var prefix = UI.mult === 3 ? 'T' : UI.mult === 2 ? 'D' : '';
      var nums = '<button class="mult' + (UI.mult === 2 ? ' active' : '') + '" data-mult="2" aria-pressed="' + (UI.mult === 2) + '">Double</button>' +
        '<button class="mult' + (UI.mult === 3 ? ' active' : '') + '" data-mult="3" aria-pressed="' + (UI.mult === 3) + '">Triple</button>' +
        '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25" data-mult="1">Bull</button>' +
        '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-num="25" data-mult="2">Bull ×2</button>';
      for (var nn = 1; nn <= 20; nn++) {
        nums += '<button data-num="' + nn + '" class="' + (nn === hlNum ? 'hl' : '') + '">' +
          (prefix ? '<span class="mx">' + prefix + '</span>' : '') + nn + '</button>';
      }
      nums += '<button class="zurueck" data-action="undo-game" aria-label="Letzten Dart zurücknehmen">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12H7M11.5 6.5L6 12l5.5 5.5"></path></svg></button>';
      nums += '<button class="miss" data-num="0" data-mult="1" aria-label="Fehlwurf">0</button>';
      nums += '<button class="end-visit" data-action="fin-end-visit">OK</button>';
      $('fin-pad').innerHTML = '<div class="num-grid">' + nums + '</div>';
    }
  }

  /* ================= Kaiwen (Team-Checkout) =================
   * Solo oder zu zweit: die Zahl (Score) in einem Versuch von 9 Darts
   * finishen, Aufnahmen zu je 3 Darts abwechselnd. Check: Zahl +10, Fehl-
   * versuch: Zahl -1. Kein Ende, man hoert auf, wann man will.
   *
   * Ein Versuch ist technisch ein X01-Leg: Start = Zahl, hoechstens drei
   * Aufnahmen im Visit-Format {p, s, d, b, c, o, k}. Bust und Double Out
   * gelten wie im X01. Darts der laufenden Aufnahme stehen in `offen`
   * (ueberstehen einen Neustart). Alles Weitere - Rest, Werfer, Verlauf,
   * Rekorde - wird aus den Versuchen gerechnet; Undo ist ein Wurf weniger.
   * Nach jedem beendeten Versuch wird der naechste gleich angelegt (wie die
   * Finisher-Runde), darum ist der letzte Versuch nie fertig.
   */
  var KAIWEN_START = 120, KAIWEN_MIN = 2;
  function neuerKaiwenVersuch(g, zahl) { g.versuche.push({ zahl: zahl, visits: [], offen: [] }); }
  function kaiwenVersuch(g) { return g.versuche[g.versuche.length - 1]; }

  function kaiwenState(g) {
    var n = g.players.length;
    var st = {
      zahl: KAIWEN_START, rest: KAIWEN_START, restVorVisit: KAIWEN_START, offen: [], visitNr: 0, dartsVersuch: 0,
      turn: 0, startTurn: 0, werfer: g.players[0], naechster: g.players[1 % n],
      versuche: 0, checks: 0, fehl: 0, checksJe: {}, dartsJe: {}, hoechste: KAIWEN_START, verlauf: [], letzte: {}, gruppen: []
    };
    g.players.forEach(function (id) { st.checksJe[id] = 0; st.dartsJe[id] = 0; });
    var zaehler = 0;
    g.versuche.forEach(function (v, vi) {
      var rest = v.zahl, check = false;
      if (v.zahl > st.hoechste) st.hoechste = v.zahl;
      var startTurn = zaehler % n;
      v.visits.forEach(function (vis) {
        zaehler++;
        st.dartsJe[vis.p] += vis.d;
        st.letzte[vis.p] = wieBust(vis) ? 'Bust' : String(vis.s);
        if (vis.b) return;
        rest -= vis.s;
        if (vis.c) { check = true; st.checksJe[vis.p]++; }
      });
      var letzter = vi === g.versuche.length - 1;
      if (!letzter) {
        st.versuche++;
        if (check) st.checks++; else st.fehl++;
        st.verlauf.push({ zahl: v.zahl, check: check });
      } else {
        st.zahl = v.zahl;
        st.restVorVisit = rest;
        st.offen = v.offen || [];
        st.rest = rest - sum(st.offen, function (d) { return d.v; });
        st.visitNr = v.visits.length;
        st.dartsVersuch = sum(v.visits, function (x) { return x.d; }) + st.offen.length;
        st.startTurn = startTurn;
        for (var gi = 0; gi < 3; gi++) {
          var vis2 = v.visits[gi];
          st.gruppen.push({ pid: g.players[(startTurn + gi) % n], darts: vis2 ? vis2.d : (gi === v.visits.length ? st.offen.length : 0), fertig: !!vis2, laeuft: gi === v.visits.length });
        }
      }
    });
    st.turn = zaehler % n;
    st.werfer = g.players[st.turn];
    st.naechster = g.players[(st.turn + 1) % n];
    st.quote = st.versuche ? (st.checks / st.versuche) * 100 : 0;
    return st;
  }

  /* Hoechste erreichte Zahl eines Spiels. */
  function kaiwenHoechste(g) {
    var h = 0;
    (g.versuche || []).forEach(function (v) { if (v.zahl > h) h = v.zahl; });
    return h;
  }
  /* Alle Kaiwen-Spiele, die zaehlen: Archiv plus das laufende. */
  function kaiwenSpiele() {
    var liste = wertbareHistorie().filter(function (h) { return h.kind === 'kaiwen' && Array.isArray(h.versuche); });
    if (S.game && S.game.kind === 'kaiwen' && !testSpiel(S.game)) liste = liste.concat([S.game]);
    return liste;
  }
  /* Persoenlicher Rekord: hoechste Startzahl eines Versuchs, solo und im
     Team getrennt. null, wenn noch nie gespielt. */
  function kaiwenPB(pid, solo) {
    var best = null;
    kaiwenSpiele().forEach(function (g) {
      if (g.players.indexOf(pid) < 0 || (g.players.length === 1) !== !!solo) return;
      var h = kaiwenHoechste(g);
      if (best === null || h > best) best = h;
    });
    return best;
  }
  /* Der Rekord der ganzen App: aus den Spielen gerechnet, dazu der Merker
     in S.rekorde (ueberlebt das Archiv-Limit). */
  function kaiwenRekord() {
    var r = { zahl: KAIWEN_START, namen: [], at: null, id: null };
    var merk = S.rekorde && S.rekorde.kaiwen;
    if (merk && merk.zahl > r.zahl) r = { zahl: merk.zahl, namen: merk.namen || [], at: merk.at || null, id: merk.id || null };
    kaiwenSpiele().forEach(function (g) {
      var h = kaiwenHoechste(g);
      if (h > r.zahl) r = { zahl: h, namen: g.players.map(pname), at: g.at || Date.now(), id: g.id };
    });
    return r;
  }
  /* Nach jedem Versuch (und nach Undo): Rekord-Merker nachziehen. Beim
     ersten Ueberbieten im Spiel das Banner, danach nur ein Aufleuchten. */
  function kaiwenRekordPruefen(g, vorher) {
    if (testSpiel(g)) return;   // Testspieler zaehlen nirgends, auch nicht hier
    var h = kaiwenHoechste(g);
    var merk = S.rekorde && S.rekorde.kaiwen;
    if (merk && merk.id === g.id && h < merk.zahl) {
      /* Undo: der Merker zeigte auf dieses Spiel, die Zahl ist weg. */
      delete S.rekorde.kaiwen;
      var neu = kaiwenRekord();
      if (neu.id) S.rekorde.kaiwen = neu;
      merk = S.rekorde.kaiwen;
    }
    if (vorher && h > vorher.rekord) {
      if (!S.rekorde) S.rekorde = {};
      S.rekorde.kaiwen = { zahl: h, namen: g.players.map(pname), at: Date.now(), id: g.id };
      if (!g.rekordGefeiert) { g.rekordGefeiert = true; UI.kwBanner = { id: g.id, zahl: h, at: Date.now() }; }
      else UI.kwBlitz = { was: 'rekord', at: Date.now() };
      g.rekordNeu = h;
      g.players.forEach(function (pid) { var pbR = vorher.pb[pid]; if (pbR === null || h > pbR) { g.pbNeu = g.pbNeu || {}; g.pbNeu[pid] = h; } });
      setTimeout(function () { if (S.game === g) render(); }, 4300);
      return;
    }
    if (vorher) {
      var solo = g.players.length === 1;
      g.players.forEach(function (pid) {
        var pb = vorher.pb[pid];
        if (pb !== null && h > pb) { UI.kwBlitz = { was: 'pb', pid: pid, at: Date.now() }; g.pbNeu = g.pbNeu || {}; g.pbNeu[pid] = h; }
        else if (pb === null && !solo && h > KAIWEN_START) { g.pbNeu = g.pbNeu || {}; g.pbNeu[pid] = h; }
      });
      if (UI.kwBlitz) setTimeout(function () { if (S.game === g) render(); }, 1600);
    }
  }
  function kaiwenVorher(g) {
    var solo = g.players.length === 1, pb = {};
    g.players.forEach(function (pid) { pb[pid] = kaiwenPB(pid, solo); });
    return { rekord: kaiwenRekord().zahl, pb: pb };
  }

  /* Eine Aufnahme buchen - aus Punkten (3 Darts) oder aus Einzeldarts (k). */
  function kaiwenVisit(g, score, darts, isCheckout, isBust, k) {
    var v = kaiwenVersuch(g);
    var st = kaiwenState(g);
    var vorher = kaiwenVorher(g);
    var vis = { p: st.werfer, s: isBust ? 0 : score, d: darts, b: !!isBust, c: !!isCheckout, o: isBust ? score : 0 };
    if (k && k.length) vis.k = k.map(function (x) { return { m: x.m, n: x.n }; });
    v.visits.push(vis);
    v.offen = [];
    UI.aufnahmeZeit = Date.now();
    if (!isBust && score === MAX_VISIT) feiere180(st.werfer);
    else if (!isBust && score === FEIER_60) feiere60(st.werfer);
    var fertig = isCheckout || v.visits.length >= 3;
    if (fertig) {
      neuerKaiwenVersuch(g, Math.max(KAIWEN_MIN, v.zahl + (isCheckout ? 10 : -1)));
      UI.kwDelta = { wert: isCheckout ? 10 : -1, at: Date.now() };
      kaiwenRekordPruefen(g, vorher);
    }
    UI.input = ''; UI.mult = 1; UI.error = '';
    save(); render();
  }
  /* Punkte-Eingabe: die Aufnahme als Zahl (wie submitTotal im X01). */
  function kaiwenAufnahme() {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen' || g.done || UI.input === '' || settling()) return;
    var v = parseInt(UI.input, 10);
    var st = kaiwenState(g);
    if (v > MAX_VISIT) { UI.error = 'Maximal ' + MAX_VISIT; UI.input = ''; render(); return; }
    if (IMPOSSIBLE[v]) { UI.error = v + ' ist mit 3 Darts nicht möglich'; UI.input = ''; render(); return; }
    if (st.offen.length) { UI.error = 'Die Aufnahme läuft in Einzel-Darts, bitte dort weiter eintragen.'; UI.input = ''; render(); return; }
    pomp();
    var after = st.rest - v;
    if (after < 0 || after === 1) { kaiwenVisit(g, v, 3, false, true); return; }
    if (after === 0) {
      var opts = [];
      for (var n = 1; n <= 3; n++) if (Checkout.possible(st.rest, n)) opts.push(n);
      if (!opts.length) { UI.error = 'Kein gültiges Finish auf Doppel'; UI.input = ''; render(); return; }
      UI.overlay = { type: 'checkout-darts', score: v, options: opts, kw: true };
      save(); render();
      return;
    }
    kaiwenVisit(g, v, 3, false, false);
  }
  function kaiwenKey(k) {
    UI.error = '';
    if (k === 'del') {
      if (UI.input === '') {
        var weg = undoKaiwen(S.game);
        if (weg && !weg.k && kaiwenModus() === 'total') { UI.input = String(weg.b ? weg.o : weg.s); render(); }
        return;
      }
      klick(); UI.input = UI.input.slice(0, -1); render(); return;
    }
    if (k === 'ok') { if (UI.input === '') UI.input = '0'; kaiwenAufnahme(); return; }
    var next = UI.input + k;
    if (next.length > 3) return;
    var val = parseInt(next, 10);
    if (val > MAX_VISIT) { UI.error = 'Maximal ' + MAX_VISIT; render(); return; }
    tipp();
    UI.input = String(val);
    render();
  }
  /* Einzeldart (Board-Tastenfeld oder Tastatur), wie pushDart im X01. */
  function kaiwenDart(mult, num) {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen' || g.done || settling()) return false;
    if (UI.overlay && UI.overlay.type === 'checkout-darts') return false;
    var v = kaiwenVersuch(g);
    var st = kaiwenState(g);
    var value = mult * num;
    v.offen.push({ m: mult, n: num, v: value });
    UI.mult = 1; UI.input = '';
    pomp();
    var after = st.rest - value;
    var thrown = v.offen.length;
    var total = sum(v.offen, function (d) { return d.v; });
    if (after < 0 || after === 1 || (after === 0 && mult !== 2)) { kaiwenVisit(g, total, 3, false, true, v.offen); return true; }
    if (after === 0) { kaiwenVisit(g, total, thrown, true, false, v.offen); return true; }
    if (thrown === 3) { kaiwenVisit(g, total, 3, false, false, v.offen); return true; }
    save(); render();
    return true;
  }
  /* OK in Einzel-Darts: die Aufnahme mit Fehlwuerfen auffuellen. */
  function kaiwenAufnahmeEnde() {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen' || g.done) return;
    var v = kaiwenVersuch(g);
    if (!v.offen.length) { kaiwenDart(1, 0); kaiwenDart(1, 0); kaiwenDart(1, 0); return; }
    while (S.game === g && kaiwenVersuch(g) === v && v.offen.length && v.offen.length < 3) kaiwenDart(1, 0);
  }
  /* Undo: erst ein offener Dart, dann die letzte Aufnahme - auch ueber
     das Ende eines Versuchs hinweg (der leere neue Versuch geht mit weg). */
  function undoKaiwen(g) {
    klick();
    UI.error = '';
    if (UI.overlay && UI.overlay.type === 'checkout-darts') { UI.overlay = null; UI.input = ''; render(); return null; }
    var v = kaiwenVersuch(g);
    if (v.offen.length) { v.offen.pop(); UI.mult = 1; save(); render(); return null; }
    if (!v.visits.length) {
      if (g.versuche.length < 2) { render(); return null; }
      g.versuche.pop();
      v = kaiwenVersuch(g);
    }
    var weg = v.visits.pop();
    g.done = false; g.winner = null; g.at = null;
    UI.kwDelta = null; UI.kwBanner = null; UI.overlay = null; UI.input = ''; UI.mult = 1;
    kaiwenRekordPruefen(g, null);
    if (g.rekordNeu && kaiwenHoechste(g) < g.rekordNeu) { delete g.rekordNeu; delete g.rekordGefeiert; }
    if (g.pbNeu) Object.keys(g.pbNeu).forEach(function (pid) { if (kaiwenHoechste(g) < g.pbNeu[pid]) delete g.pbNeu[pid]; });
    save(); render();
    return weg;
  }
  /* Punkte oder Einzel-Darts: Punkte als Vorgabe, der Wechsel-Knopf
     schaltet fuer dieses Spiel um; angefangene Darts bleiben Darts. */
  function kaiwenModus() {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen') return 'total';
    if (kaiwenVersuch(g).offen.length) return 'darts';
    return g.eingabe || 'total';
  }
  function kaiwenBeenden() {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen') return;
    g.done = true; g.winner = null; g.at = Date.now();
    UI.menu = false; UI.overlay = null;
    UI.summary = { kind: 'kaiwen', id: 'current' };
    S.screen = 'summary';
    save(); render();
  }

  var KW_MENU_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g opacity="0.8"><circle cx="3.5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="20.5" cy="12" r="1.8"></circle></g></svg>';
  var KW_FERN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"></rect><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8"></path></svg>';
  var KW_SWAP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14l-3-3M20 16H6l3 3"></path></svg>';
  var KW_DEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12H7M11.5 6.5L6 12l5.5 5.5"></path></svg>';

  /* Hunter-Einstellungen: bei Handicap je Spieler der Aufstellung eine
     Stufe (Single, Doppel, Triple). */
  function renderHunterEinstellungen() {
    var box = $('hu-handicap');
    if (!box) return;
    var handicap = S.settings.hunterVariante === 2;
    var note = $('hunter-note');
    if (note) note.textContent = S.settings.hunterVariante === 1 ? 'Boost: ein Doppel bringt 2 Felder, ein Triple 3. Wer dabei mehrere Gegner überspringt, fängt alle.'
      : handicap ? 'Handicap: je Spieler zählt jeder Treffer, nur das Doppel oder nur das Triple. Ein Treffer bringt immer 1 Feld.'
      : 'Jeder Treffer im Zielfeld bringt 1 Feld. Einholen reicht: wer das Feld des Vordermanns erreicht, fängt ihn.';
    var lebenBox = $('hu-leben-setting');
    if (lebenBox) lebenBox.classList.toggle('hidden', S.lineup.length < 2);
    box.classList.toggle('hidden', !handicap);
    if (!handicap) { box.innerHTML = ''; return; }
    var stufen = S.settings.hunterHandicap || {};
    box.innerHTML = S.lineup.map(function (id) {
      var st = Number(stufen[id]) === 2 ? 2 : Number(stufen[id]) === 3 ? 3 : 1;
      return '<div class="setting hu-stufe"><label>' + esc(pname(id)) + '</label><div class="options">' +
        [[1, 'Single'], [2, 'Doppel'], [3, 'Triple']].map(function (o) {
          return '<button data-action="hu-handicap" data-id="' + esc(id) + '" data-value="' + o[0] + '" class="' + (st === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div>';
    }).join('') || '<span class="note">Erst Spieler wählen.</span>';
  }
  function renderKaiwen() {
    var g = S.game;
    if (!g || g.kind !== 'kaiwen') { S.screen = 'setup'; render(); return; }
    var st = kaiwenState(g);
    var n = g.players.length, solo = n === 1;
    var modus = kaiwenModus();
    var fern = !!UI.kwFern;
    /* Letzte Aufnahme des Versuchs: danach kommen keine Darts mehr, also
       zaehlt nur noch die Chance auf das Finish (Checkout-Variante). */
    var dbl = lieblingsDoppel(st.werfer, { checkout: st.visitNr === 2 });
    var dartsLeft = 3 - st.offen.length;
    var jetzt = Date.now();
    var rekord = kaiwenRekord();
    var banner = UI.kwBanner && UI.kwBanner.id === g.id && jetzt - UI.kwBanner.at < 4200 ? UI.kwBanner : null;
    var blitz = UI.kwBlitz && jetzt - UI.kwBlitz.at < 1500 ? UI.kwBlitz : null;
    var delta = UI.kwDelta && jetzt - UI.kwDelta.at < 1800 ? UI.kwDelta : null;
    var screen = $('screen-kaiwen');
    screen.classList.toggle('fern', fern);
    screen.classList.toggle('solo', solo);
    screen.classList.toggle('rekord', !!banner);

    /* Kopf: Titel, Untertitel, Rekord. */
    $('kw-sub').textContent = (solo ? 'Solo' : 'Team · ' + n + ' Spieler') + ' · Double Out · 9 Darts je Versuch · Runde ' + (g.done ? st.versuche : st.versuche + 1);
    /* Oben rechts: erst der PB (Solo: des Spielers, Team: der beste der
       Mitspieler), dann der Rekord mit dem Pokal vor der Zahl. */
    var pbOben = null;
    g.players.forEach(function (id) { var v = kaiwenPB(id, solo); if (v !== null && (pbOben === null || v > pbOben)) pbOben = v; });
    var pbBlitzOben = blitz && blitz.was === 'pb' && pbOben !== null && kaiwenPB(blitz.pid, solo) === pbOben;
    $('kw-rekord').innerHTML = '<span class="kw-rek-text kw-pb' + (pbBlitzOben ? ' blitz' : '') + '"><span class="kt">PB ' + (solo ? 'Solo' : 'Team') + '</span>' +
      '<span class="kw-rek-zahl">' + (pbOben === null ? '–' : pbOben) + '</span></span>' +
      '<span class="kw-rek-text"><span class="kt">Rekord' + (rekord.namen.length ? '<span class="kw-rek-namen"> · ' + esc(rekord.namen.join(' & ')) + '</span>' : '') + '</span>' +
      '<span class="kw-rek-zeile"><span class="kw-pokal' + (banner ? ' wackelt' : '') + '" aria-hidden="true">🏆</span>' +
      '<span class="kw-rek-zahl' + (blitz && blitz.was === 'rekord' ? ' blitz' : '') + '">' + rekord.zahl + '</span></span></span>';

    /* Ziel: Score, grosser Rest, 9 Darts in drei Gruppen mit Werfer, Info. */
    var punkte = '';
    st.gruppen.forEach(function (gr, gi) {
      punkte += '<span class="kw-gruppe' + (gr.laeuft ? ' laeuft' : gr.fertig ? ' fertig' : '') + '">';
      for (var d = 0; d < 3; d++) {
        var benutzt = gr.fertig || d < gr.darts;
        var naechster = gr.laeuft && d === gr.darts;
        punkte += '<span class="kw-dot' + (benutzt ? ' weg' : '') + (naechster ? ' jetzt' : '') + '"></span>';
      }
      punkte += '<span class="kw-gruppe-name">' + esc(pname(gr.pid)) + '</span></span>';
    });
    var dartNr = st.dartsVersuch + 1;
    /* Nach dem Versuch pulsieren Score und Rest kurz gruen (Check) oder rot
       (verfehlt), solange noch kein Dart des neuen Versuchs steht. */
    var puls = delta && st.dartsVersuch === 0 && !g.done ? (delta.wert > 0 ? ' erfolg' : ' fehl') : '';
    /* Ein Neuzeichnen im Fenster (Ziffer getippt, Blitz-Timer) baut die Zahl
       neu; die negative Verzoegerung setzt die Animation an der alten Stelle fort. */
    var pulsStil = puls ? ' style="animation-delay:-' + (jetzt - delta.at) + 'ms"' : '';
    $('kw-ziel').innerHTML =
      (banner ? '<span class="kw-banner">🏆 Neuer Rekord · ' + banner.zahl + '</span>' : '') +
      '<div class="kw-score"><span class="kt">Score</span><span class="kw-score-zahl' + (banner ? ' gold' : puls) + '"' + (banner ? '' : pulsStil) + '>' + st.zahl + '</span>' +
        (delta ? '<span class="kw-delta ' + (delta.wert > 0 ? 'plus' : 'minus') + '">' + (delta.wert > 0 ? '+10' : '−1') + '</span>' : '') + '</div>' +
      '<span class="kw-rest' + puls + '"' + pulsStil + '>' + st.rest + '</span>' +
      '<div class="kw-darts">' + punkte + '</div>' +
      '<span class="kw-info">' + (g.done ? 'Spiel beendet'
        : st.dartsVersuch === 0 ? 'Neuer Versuch · 9 Darts · ' + esc(pname(st.werfer)) + ' beginnt'
        : 'Dart ' + dartNr + ' von 9 · ' + esc(pname(st.werfer)) + ' ist dran') +
        (!solo && !g.done ? ' <small>· danach ' + esc(pname(st.naechster)) + '</small>' : '') + '</span>';

    /* Finish-Weg fuer die laufende Aufnahme des Werfers (wie im Finisher):
       Plan-Folgen ueber die offenen Darts, Stellwurf nur, wenn im Versuch
       danach noch Darts kommen. Ueber 170 kein Hinweis. */
    /* In Einzel-Darts ist die vorgeschlagene Kachel zugleich die Taste
       (wie im X01); in der Punkte-Eingabe und der Fernsteuerung nur Anzeige. */
    var kwTaste = function (d, klasse, innen) {
      var soll = labelDart(d);
      return modus !== 'darts' || fern ? '<span class="fk ' + klasse + '">' + innen + '</span>'
        : '<button type="button" class="fk tipp ' + klasse + '" data-num="' + soll.n + '" data-mult="' + soll.m + '" aria-label="' + Checkout.pretty(d) + ' getroffen">' + innen + '</button>';
    };
    var kacheln = ['', '', ''];
    var route = null;
    if (!g.done && st.restVorVisit <= MAX_CHECKOUT) {
      var plan = planFuer(st.restVorVisit, 3, dbl);
      var planGilt = !!plan;
      var restLauf = st.restVorVisit;
      for (var ki = 0; ki < st.offen.length; ki++) {
        var wurf = st.offen[ki];
        var empf = planGilt && plan.darts[ki] ? [plan.darts[ki]]
          : (Checkout.suggest(restLauf, 3 - ki, dbl) || (stellwurfFuer(restLauf, 3 - ki, dbl) || {}).darts);
        var soll = empf && empf.length ? labelDart(empf[0]) : null;
        var getroffen = soll && wurf.n === soll.n && wurf.m === soll.m;
        if (!getroffen) planGilt = false;
        kacheln[ki] = '<span class="fk ' + (getroffen ? 'gut' : 'anders') + '">' + (wurf.n === 0 ? '–' : dartLabel(wurf)) + '</span>';
        restLauf -= wurf.n * wurf.m;
      }
      var planRest = planGilt && st.offen.length > 0 && plan.darts.length > st.offen.length
        ? { darts: plan.darts.slice(st.offen.length), auf: plan.auf } : null;
      route = planRest ? (planRest.auf === null ? planRest.darts : null) : Checkout.suggest(st.rest, dartsLeft, dbl);
      if (route) {
        for (var ri = 0; ri < route.length && st.offen.length + ri < 3; ri++) {
          kacheln[st.offen.length + ri] = kwTaste(route[ri], ri === 0 ? 'jetzt' : '', Checkout.pretty(route[ri]));
        }
      } else if (st.offen.length < 3 && st.visitNr < 2) {
        var stw = planRest && planRest.auf !== null ? planRest : stellwurfFuer(st.rest, dartsLeft, dbl);
        if (stw) {
          for (var si = 0; si < stw.darts.length && st.offen.length + si < 3; si++) {
            kacheln[st.offen.length + si] = kwTaste(stw.darts[si], 'stellen' + (si === 0 ? ' jetzt' : ''), Checkout.pretty(stw.darts[si]) +
              (si === stw.darts.length - 1 ? '<span class="fk-auf">auf ' + stw.auf + '</span>' : ''));
          }
        }
      }
    }
    for (var kl = 0; kl < 3; kl++) if (!kacheln[kl]) kacheln[kl] = '<span class="fk leer">–</span>';

    /* Team: je Spieler Avatar, Name, PB, letzte Aufnahme, drei Felder. */
    var teamHtml = g.players.map(function (id) {
      var aktiv = id === st.werfer && !g.done;
      var pb = kaiwenPB(id, solo);
      var pbBlitz = blitz && blitz.was === 'pb' && blitz.pid === id;
      return '<div class="kw-spieler' + (aktiv ? ' aktiv' : '') + '">' +
        '<div class="kw-sp-kopf">' + avatarHTML(profile(id), 'sm') +
          '<span class="kw-sp-name">' + esc(pname(id)) + '</span>' +
          '<span class="kw-sp-pb' + (pbBlitz ? ' blitz' : '') + '"><span class="kt">PB ' + (solo ? 'Solo' : 'Team') + '</span><b>' + (pb === null ? '–' : pb) + '</b></span>' +
          '<span class="kw-sp-letzte"><span class="kt">zuletzt</span><b>' + esc(st.letzte[id] || '–') + '</b></span></div>' +
        '<div class="pfelder">' + (aktiv ? kacheln.join('') : '<span class="fk still"></span><span class="fk still"></span><span class="fk still"></span>') + '</div>' +
        '</div>';
    }).join('');
    $('kw-team').innerHTML = teamHtml;
    $('kw-team').classList.toggle('zwei', n > 1);

    /* Verlauf: die letzten Versuche als Chips. */
    var chips = st.verlauf.slice(-8).map(function (v) {
      return '<span class="kw-chip ' + (v.check ? 'ok' : 'nein') + '">' + v.zahl + '</span>';
    }).join('');
    $('kw-verlauf').innerHTML = '<span class="kt">Verlauf</span>' + (chips || '<span class="kw-chip leer">noch kein Versuch</span>');

    /* Rechts: Eingabe. Punkte (Tastenfeld) oder Einzel-Darts (Zahlenfeld). */
    $('kw-swap').classList.toggle('an', modus === 'darts');
    $('kw-swap').setAttribute('aria-label', modus === 'darts' ? 'Zur Punkte-Eingabe' : 'Zu Einzel-Darts');
    $('kw-pad-total').classList.toggle('hidden', modus !== 'total');
    $('kw-pad-darts').classList.toggle('hidden', modus !== 'darts');
    $('kw-display').textContent = UI.input === '' ? '0' : UI.input;
    $('kw-error').textContent = UI.error;
    $('kw-quick').innerHTML = QUICK_SCORES.map(function (q) {
      return '<button data-action="kw-quick" data-value="' + q + '">' + q + '</button>';
    }).join('');
    if (modus === 'darts') {
      var hl = route ? route[0] : null;
      var hlMult = hl ? (hl.charAt(0) === 'T' ? 3 : hl.charAt(0) === 'D' || hl === 'BULL' ? 2 : 1) : 0;
      var hlNum = hl && hl !== 'BULL' && hl !== '25' && UI.mult === hlMult ? parseInt(hl.slice(1), 10) : null;
      var prefix = UI.mult === 3 ? 'T' : UI.mult === 2 ? 'D' : '';
      var nums = '<button class="mult' + (UI.mult === 2 ? ' active' : '') + '" data-mult="2" aria-pressed="' + (UI.mult === 2) + '">Double</button>' +
        '<button class="mult' + (UI.mult === 3 ? ' active' : '') + '" data-mult="3" aria-pressed="' + (UI.mult === 3) + '">Triple</button>' +
        '<button class="bull ' + (hl === '25' ? 'hl' : '') + '" data-num="25" data-mult="1">Bull</button>' +
        '<button class="bull ' + (hl === 'BULL' ? 'hl' : '') + '" data-num="25" data-mult="2">Bull ×2</button>';
      for (var nn = 1; nn <= 20; nn++) {
        nums += '<button data-num="' + nn + '" class="' + (nn === hlNum ? 'hl' : '') + '">' + (prefix ? '<span class="mx">' + prefix + '</span>' : '') + nn + '</button>';
      }
      nums += '<button class="zurueck" data-action="undo-game" aria-label="Letzten Dart zurücknehmen">' + KW_DEL_SVG + '</button>';
      nums += '<button class="miss" data-num="0" data-mult="1" aria-label="Fehlwurf">0</button>';
      nums += '<button class="end-visit" data-action="kw-end-visit">OK</button>';
      $('kw-pad-darts').innerHTML = '<div class="num-grid">' + nums + '</div>';
    }
    $('kw-ff-display').innerHTML = UI.input === '' ? '<span class="cursor"></span>' : esc(UI.input);
    var kwV = kaiwenVersuch(g);
    $('kw-verlauf-gross').classList.toggle('hidden', !(fern && UI.kwVerlauf));
    if (fern && UI.kwVerlauf) {
      var kwRest = kwV.zahl;
      $('kw-verlauf-gross').innerHTML = '<span class="kt">Versuch · Start ' + kwV.zahl + '</span>' + (kwV.visits.length ? kwV.visits.map(function (vis, i) {
        kwRest = vis.b ? kwRest : kwRest - vis.s;
        return '<div class="kvg-zeile' + (vis.b ? ' bust' : vis.c ? ' co' : '') + '"><span class="kvg-n">' + (i + 1) + '.</span><span class="kvg-wer">' + esc(pname(vis.p)) + '</span><b>' + (vis.b ? 'Bust' : vis.s) + '</b><span class="kvg-rest">' + (vis.c ? 'Check' : 'Rest ' + kwRest) + '</span></div>';
      }).join('') : '<p class="hint">Noch keine Aufnahme in diesem Versuch.</p>');
    }
    $('kw-ff-error').textContent = UI.error;
    $('kw-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('kw-menu-overlay'));
    if (UI.menu) document.querySelector('#kw-menu-overlay .game-menu-sub').textContent = $('kw-sub').textContent;
  }

  /* ================= Hunter (Maeusejagd auf der Scheibe) =================
   * 1 bis 6 Spieler, je 3 Darts, reihum in Auswahlreihenfolge. Gespielt
   * wird in Board-Reihenfolge im Uhrzeigersinn, Bull spielt keine Rolle.
   * Jeder jagt den, der vor ihm liegt: wer mit einem Dart das Feld eines
   * Gegners erreicht oder ueberspringt, faengt ihn (Boost: alle, die er
   * ueberspringt). Gefangene fliegen raus, der Letzte gewinnt. Allein ist
   * es ein Training: einmal rund um die Scheibe, gezaehlt werden die Darts.
   *
   * Alles wird aus g.throws gerechnet (wie Round the World) - Undo ist ein
   * Wurf weniger, auch ueber einen Fang hinweg. g.startPos (Ring-Indizes)
   * ersetzt die festen Startfelder, fuer Tests und Sonderfaelle.
   */
  var HUNTER_RING = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  /* Feste Startfelder je Spielerzahl (Julius): Spieler 1 immer auf der 20,
     der Rest im Uhrzeigersinn in Auswahlreihenfolge. */
  var HUNTER_START = { 1: [20], 2: [20, 3], 3: [20, 15, 16], 4: [20, 6, 3, 8], 5: [20, 13, 2, 7, 14], 6: [20, 4, 15, 3, 16, 9] };
  var HUNTER_MAX = 6;
  var HUNTER_VARIANTEN = ['normal', 'boost', 'handicap'];
  function hunterRingIndex(zahl) { return HUNTER_RING.indexOf(zahl); }
  function hunterStartPos(g) {
    if (Array.isArray(g.startPos) && g.startPos.length === g.players.length) return g.startPos.slice();
    var felder = HUNTER_START[g.players.length] || HUNTER_START[6];
    return g.players.map(function (id, i) { return hunterRingIndex(felder[i] !== undefined ? felder[i] : 20); });
  }
  function hunterStufe(g, pid) {
    if (g.variante !== 'handicap') return 1;
    var s = g.handicap && g.handicap[pid];
    return s === 2 || s === 3 ? s : 1;
  }
  /* Zaehlt der Dart als Treffer aufs Zielfeld? Stufe 1: jeder Ring, Stufe 2
     nur das Doppel, Stufe 3 nur das Triple. */
  function hunterTrifft(g, pid, t, zielZahl) {
    if (!t.n || t.n !== zielZahl) return false;
    var stufe = hunterStufe(g, pid);
    return stufe === 1 || t.m === stufe;
  }
  function hunterState(g) {
    var n = g.players.length, solo = n === 1;
    var st = { pos: {}, raus: {}, faenge: {}, gefangen: {}, fangLog: [], darts: {}, treffer: {}, schritte: {}, turn: 0, inVisit: 0, visit: [], aktiv: [], winner: null, fertig: null, over: false, letzterFang: null, runde: 1, letzte: {} };
    var leben = solo ? 1 : (Number(g.leben) > 1 ? Number(g.leben) : 1);
    var start = hunterStartPos(g);
    g.players.forEach(function (id, i) { st.pos[id] = start[i]; st.faenge[id] = 0; st.gefangen[id] = 0; st.darts[id] = 0; st.treffer[id] = 0; st.schritte[id] = 0; });
    var turn = 0, inVisit = 0;
    var aktive = function () { return g.players.filter(function (id) { return !st.raus[id]; }); };
    for (var i = 0; i < g.throws.length && !st.over; i++) {
      var t = g.throws[i];
      var pid = g.players[turn];
      st.darts[pid]++;
      st.visit.push(t);
      var ziel = HUNTER_RING[st.pos[pid]];
      if (hunterTrifft(g, pid, t, ziel)) {
        st.treffer[pid]++;
        var felder = g.variante === 'boost' ? t.m : 1;
        if (solo) {
          st.schritte[pid] += felder;
          st.pos[pid] = (st.pos[pid] + felder) % 20;
          if (st.schritte[pid] >= 20) { st.fertig = { darts: st.darts[pid], at: i }; st.pos[pid] = 0; st.over = true; }
        } else {
          /* Abstaende im Uhrzeigersinn zu allen Gegnern vor dem Dart: wer
             hoechstens so weit weg ist, wie gezogen wird, ist gefangen. */
          aktive().forEach(function (o) {
            if (o === pid) return;
            var d = (st.pos[o] - st.pos[pid] + 20) % 20;
            if (d >= 1 && d <= felder) {
              st.faenge[pid]++; st.gefangen[o]++;
              var endgueltig = st.gefangen[o] >= leben;
              /* Mit Leben uebrig steigt der Gefangene gegenueber wieder ein. */
              if (endgueltig) st.raus[o] = { at: i, von: pid, feld: st.pos[o] };
              else st.pos[o] = (st.pos[o] + 10) % 20;
              st.fangLog.push({ at: i, wer: o, von: pid, raus: endgueltig });
              st.letzterFang = { wer: o, von: pid, at: i };
            }
          });
          st.pos[pid] = (st.pos[pid] + felder) % 20;
          if (aktive().length === 1) { st.winner = pid; st.over = true; }
        }
      }
      inVisit++;
      if (st.over) break;
      if (inVisit === 3) {
        st.letzte[pid] = st.visit.map(function (d) { return d.n === 0 ? '–' : throwLabel(d); }).join(' ');
        inVisit = 0; st.visit = [];
        var steps = 0, next = turn;
        do { next = (next + 1) % n; steps++; } while (st.raus[g.players[next]] && steps <= n);
        if (next <= turn) st.runde++;
        turn = next;
      }
    }
    st.turn = turn;
    st.inVisit = inVisit;
    st.aktiv = aktive();
    st.werfer = g.players[turn];
    /* Vordermann (naechster Gegner im Uhrzeigersinn) und Verfolger (der,
       fuer den ich der naechste bin), je mit Abstand in Feldern. */
    st.vorne = null; st.hinten = null;
    if (!solo && !st.over) {
      var me = st.werfer;
      st.aktiv.forEach(function (o) {
        if (o === me) return;
        var dv = (st.pos[o] - st.pos[me] + 20) % 20;
        var dh = (st.pos[me] - st.pos[o] + 20) % 20;
        if (!st.vorne || dv < st.vorne.abstand) st.vorne = { wer: o, abstand: dv };
        if (!st.hinten || dh < st.hinten.abstand) st.hinten = { wer: o, abstand: dh };
      });
    }
    return st;
  }
  function hunterSchluessel(g) {
    return g.variante === 'handicap' ? 'h' + hunterStufe(g, g.players[0]) : g.variante === 'boost' ? 'boost' : 'normal';
  }
  /* Solo-Bestwert eines Spielers je Variante (wenigste Darts), aus Archiv
     und laufendem Spiel. */
  function hunterBest(pid, schluessel, ohneSpiel) {
    var best = null;
    var liste = wertbareHistorie().filter(function (h) { return h.kind === 'hunter' && Array.isArray(h.throws) && h.players.length === 1 && h.players[0] === pid; });
    if (S.game && S.game.kind === 'hunter' && S.game !== ohneSpiel && S.game.players.length === 1 && S.game.players[0] === pid && !testSpiel(S.game)) liste = liste.concat([S.game]);
    liste.forEach(function (h) {
      if (hunterSchluessel(h) !== schluessel) return;
      var st = hunterState({ players: h.players, throws: h.throws, variante: h.variante, handicap: h.handicap });
      if (st.fertig && (best === null || st.fertig.darts < best)) best = st.fertig.darts;
    });
    return best;
  }
  function hunterDart(mult, num) {
    var g = S.game;
    if (!g || g.kind !== 'hunter' || g.done || settling()) return false;
    pomp();
    var m = num === 25 ? (mult === 2 ? 2 : 1) : mult;
    var vorBest = g.players.length === 1 && !testSpiel(g) ? hunterBest(g.players[0], hunterSchluessel(g), g) : null;
    g.throws.push({ n: num, m: num === 0 ? 0 : m });
    UI.mult = 1;
    var st = hunterState(g);
    if (st.letzterFang && st.letzterFang.at === g.throws.length - 1) {
      var fangIdx = g.throws.length - 1;
      UI.huFang = { wer: st.letzterFang.wer, von: st.letzterFang.von, namen: st.fangLog.filter(function (f) { return f.at === fangIdx; }).map(function (f) { return f.wer; }), at: Date.now() };
    }
    if (st.winner) { g.done = true; g.winner = st.winner; g.at = Date.now(); UI.overlay = { type: 'game-done', pid: st.winner }; }
    if (st.fertig) {
      g.done = true; g.winner = g.players[0]; g.at = Date.now();
      if (vorBest === null || st.fertig.darts < vorBest) { g.bestNeu = st.fertig.darts; UI.huBlitz = Date.now(); }
      UI.overlay = { type: 'game-done', pid: g.players[0] };
    }
    save(); render();
    return true;
  }
  function hunterBust() {
    var g = S.game;
    if (!g || g.kind !== 'hunter' || g.done || settling()) return;
    pomp();
    var offen = 3 - hunterState(g).inVisit;
    for (var i = 0; i < offen; i++) g.throws.push({ n: 0, m: 0 });
    UI.mult = 1;
    save(); render();
  }
  function hunterZielText(g, pid, st) {
    var zahl = HUNTER_RING[st.pos[pid]];
    var stufe = hunterStufe(g, pid);
    return (stufe === 2 ? 'D' : stufe === 3 ? 'T' : '') + zahl;
  }

  /* Die Scheibe nach dem Entwurf "Hunter Spiel": klassische Farben (Schwarz,
     Marmor, Rot, Gruen), ein Rand mit Verlauf, die Zahlen innen am Rand und
     der Bull als dunkle Mitte, ueber der das Ziel des Werfers steht.
     Koordinaten: Mitte 0/0, Rand bei 101, Zeichenflaeche bis 124 (aussen
     stehen die Marker). Segment 0 (die 20) oben, dann im Uhrzeigersinn.
     Einmal gebaut, danach nur Klassen. */
  var HU_R = { bull: 40, triI: 58, triA: 64, dblI: 81, dblA: 88, rand: 101, zahl: 94 };
  function huBogen(r1, r2, a0, a1) {
    var p = function (r, a) { var w = (a - 90) * Math.PI / 180; return (r * Math.cos(w)).toFixed(2) + ' ' + (r * Math.sin(w)).toFixed(2); };
    return 'M' + p(r1, a0) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + p(r1, a1) + ' L' + p(r2, a1) + ' A' + r2 + ' ' + r2 + ' 0 0 0 ' + p(r2, a0) + ' Z';
  }
  function hunterScheibeHtml() {
    var html = '<svg class="hu-svg" viewBox="-124 -124 248 248" aria-hidden="true">' +
      '<defs><radialGradient id="huMarmor" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#f6eedb"></stop><stop offset="70%" stop-color="#e9dcbc"></stop><stop offset="100%" stop-color="#d6c39a"></stop></radialGradient>' +
      '<radialGradient id="huRand" cx="50%" cy="50%" r="50%"><stop offset="86%" stop-color="#141414"></stop><stop offset="100%" stop-color="#050505"></stop></radialGradient></defs>' +
      '<circle cx="0" cy="0" r="' + HU_R.rand + '" class="hu-rand"></circle>';
    HUNTER_RING.forEach(function (zahl, i) {
      var a0 = i * 18 - 9, a1 = i * 18 + 9;
      html += '<g class="hu-seg ' + (i % 2 ? 'gruen' : 'rot') + '" data-i="' + i + '">' +
        '<path class="hu-ring single innen" d="' + huBogen(HU_R.bull, HU_R.triI, a0, a1) + '"></path>' +
        '<path class="hu-ring triple" d="' + huBogen(HU_R.triI, HU_R.triA, a0, a1) + '"></path>' +
        '<path class="hu-ring single aussen" d="' + huBogen(HU_R.triA, HU_R.dblI, a0, a1) + '"></path>' +
        '<path class="hu-ring double" d="' + huBogen(HU_R.dblI, HU_R.dblA, a0, a1) + '"></path>' +
        '</g>';
    });
    html += '<circle cx="0" cy="0" r="' + HU_R.bull + '" class="hu-bull"></circle>';
    HUNTER_RING.forEach(function (zahl, i) {
      var w = (i * 18 - 90) * Math.PI / 180;
      html += '<text class="hu-zahl" x="' + (HU_R.zahl * Math.cos(w)).toFixed(2) + '" y="' + (HU_R.zahl * Math.sin(w)).toFixed(2) + '" data-i="' + i + '">' + zahl + '</text>';
    });
    html += '</svg><div class="hu-ziel" id="hu-ziel" aria-live="polite"></div>' +
      '<div class="hu-marker-schicht" id="hu-marker"></div><div class="hu-fang-schicht" id="hu-fang" aria-live="polite"></div>';
    return html;
  }
  function renderHunter() {
    var g = S.game;
    if (!g || g.kind !== 'hunter') { S.screen = 'setup'; render(); return; }
    var st = hunterState(g);
    var n = g.players.length, solo = n === 1;
    var aktiv = g.done ? g.winner : st.werfer;
    var jetzt = Date.now();
    var fang = UI.huFang && jetzt - UI.huFang.at < 2600 ? UI.huFang : null;
    var screen = $('screen-hunter');
    screen.classList.toggle('solo', solo);
    var vName = g.variante === 'boost' ? 'Boost' : g.variante === 'handicap' ? 'Handicap' : 'Normal';
    var vorname = function (id) { return String(pname(id)).trim().split(/\s+/)[0]; };
    var farbe = function (id) { return 'hsl(' + hue(id) + ',55%,52%)'; };

    /* Kopf: Untertitel, rechts die Runde bzw. solo der Bestwert. */
    $('hu-sub').textContent = solo ? 'Training · ' + vName + ' · einmal rund' : vName + ' · ' + n + ' Spieler · ' + st.aktiv.length + ' im Spiel' + (g.leben > 1 ? ' · ' + g.leben + ' Leben' : '');
    var best = solo ? hunterBest(g.players[0], hunterSchluessel(g), g.done ? null : g) : null;
    var bestBlitz = solo && ((g.done && !!g.bestNeu) || (UI.huBlitz && jetzt - UI.huBlitz < 1600));
    $('hu-box').className = 'hu-box' + (solo ? ' solo' : '') + (bestBlitz ? ' blitz' : '');
    $('hu-box').innerHTML = '<span class="kt">' + (solo ? 'Bestwert' : 'Runde') + '</span><b>' + (solo ? (best === null ? '–' : plural(best, 'Dart', 'Darts')) : st.runde) + '</b>';

    /* Scheibe einmal bauen; dann nur das Zielfeld des Werfers markieren. */
    var scheibe = $('hu-scheibe');
    if (!scheibe.querySelector('svg')) scheibe.innerHTML = hunterScheibeHtml();
    var zielIdx = g.done ? -1 : st.pos[aktiv];
    var stufe = g.done ? 1 : hunterStufe(g, aktiv);
    scheibe.querySelectorAll('.hu-seg').forEach(function (seg) {
      var i = Number(seg.getAttribute('data-i'));
      seg.classList.toggle('ziel', i === zielIdx);
      seg.classList.toggle('nur-double', i === zielIdx && stufe === 2);
      seg.classList.toggle('nur-triple', i === zielIdx && stufe === 3);
    });
    scheibe.querySelectorAll('.hu-zahl').forEach(function (z) { z.classList.toggle('ziel', Number(z.getAttribute('data-i')) === zielIdx); });

    /* Ziel in der Mitte: wer wirft, die Zahl (mit D oder T bei Handicap)
       und wen er jagt; solo die Darts und die restlichen Felder. */
    var zielZahl = HUNTER_RING[st.pos[aktiv]];
    var praefix = g.done ? '' : stufe === 2 ? 'D' : stufe === 3 ? 'T' : '';
    var jagd = solo ? 'noch ' + plural(Math.max(0, 20 - st.schritte[aktiv]), 'Feld', 'Felder')
      : st.vorne ? 'Jagt ' + esc(vorname(st.vorne.wer)) + ' · ' + plural(st.vorne.abstand, 'Feld', 'Felder') : '';
    $('hu-ziel').innerHTML = '<span class="kt">' + (g.done ? (solo ? 'Durch' : 'Sieger') : solo ? plural(st.darts[aktiv], 'Dart', 'Darts') : esc(vorname(aktiv))) + '</span>' +
      '<span class="hu-ziel-zahl">' + (g.done ? (solo ? '✓' : '🏆') : (praefix ? '<span class="mx">' + praefix + '</span>' : '') + zielZahl) + '</span>' +
      '<span class="hu-ziel-sub">' + (g.done ? (solo ? plural(st.fertig ? st.fertig.darts : st.darts[aktiv], 'Dart', 'Darts') : esc(pname(g.winner))) : jagd) + '</span>';

    /* Marker: je Spieler ein Element, das bleibt (Bewegung per Transition).
       Mehrere auf einem Feld stehen um je 6,5 Grad versetzt nebeneinander. */
    var schicht = $('hu-marker');
    if (UI.huWinkelSpiel !== g.id) { UI.huWinkelSpiel = g.id; UI.huWinkel = {}; schicht.innerHTML = ''; }
    var gruppen = {};
    g.players.forEach(function (id) { var f = st.raus[id] ? st.raus[id].feld : st.pos[id]; (gruppen[f] = gruppen[f] || []).push(id); });
    g.players.forEach(function (id) {
      var raus = st.raus[id];
      var idx = raus ? raus.feld : st.pos[id];
      var grp = gruppen[idx];
      var ziel = idx * 18 + (grp.indexOf(id) - (grp.length - 1) / 2) * 6.5;
      var el = schicht.querySelector('[data-id="' + id + '"]');
      if (!el) {
        el = document.createElement('div');
        el.className = 'hu-mark';
        el.setAttribute('data-id', id);
        el.innerHTML = '<span class="hu-punkt" style="background:' + farbe(id) + '">' + esc(kuerzelVon(profile(id))) + '</span>';
        schicht.appendChild(el);
      }
      /* Immer den kuerzesten Weg drehen: 342 -> 360 statt zurueck auf 0. */
      var alt = UI.huWinkel[id];
      var winkel = alt === undefined ? ziel : alt + ((((ziel - alt) % 360) + 540) % 360) - 180;
      UI.huWinkel[id] = winkel;
      el.style.setProperty('--w', winkel + 'deg');
      el.classList.toggle('aktiv', id === aktiv && !g.done);
      el.classList.toggle('raus', !!raus);
      var ebenGefangen = !!(fang && fang.namen.indexOf(id) >= 0 && jetzt - fang.at < 1600);
      el.classList.toggle('gefangen', ebenGefangen && !!raus);
      el.classList.toggle('neu', ebenGefangen && !raus);   // mit Leben uebrig: steigt gegenueber wieder ein
      el.classList.toggle('sieger', !!(g.done && g.winner === id && !solo));
    });
    Array.prototype.forEach.call(schicht.querySelectorAll('.hu-mark'), function (el) {
      if (g.players.indexOf(el.getAttribute('data-id')) < 0) el.remove();
    });

    /* Fang-Banner ueber der Scheibe; bleibt stehen, bis es ausgeblendet ist
       (nicht bei jedem Neuzeichnen neu starten). */
    var fangEl = $('hu-fang');
    if (fang) {
      if (fangEl.getAttribute('data-at') !== String(fang.at)) {
        fangEl.setAttribute('data-at', String(fang.at));
        fangEl.innerHTML = '<span class="hu-fang-banner">🎯 ' + esc(vorname(fang.von)) + ' fängt ' + fang.namen.map(function (id) { return esc(vorname(id)); }).join(' und ') + '!</span>';
      }
    } else if (fangEl.innerHTML) { fangEl.innerHTML = ''; fangEl.removeAttribute('data-at'); }

    /* Spielerchips unter der Scheibe: Farbe, Name, Zielfeld, darunter Faenge
       und die letzte Aufnahme; solo Feld und Darts. */
    var liste = $('hu-liste');
    liste.style.setProperty('--n', n);
    liste.classList.toggle('viele', n > 4);
    liste.innerHTML = g.players.map(function (id) {
      var raus = st.raus[id], istAktiv = id === aktiv && !g.done;
      var meta = solo ? 'Feld ' + Math.min(20, st.schritte[id] + 1) + ' von 20 · ' + plural(st.darts[id], 'Dart', 'Darts') + ' · MPR ' + (st.darts[id] ? (st.treffer[id] / st.darts[id] * 3).toFixed(2) : '–')
        : raus ? 'gefangen von ' + esc(vorname(raus.von))
        : (g.variante === 'handicap' ? ['', 'Single', 'Doppel', 'Triple'][hunterStufe(g, id)] + ' · ' : '') + plural(st.faenge[id], 'Fang', 'Fänge') +
          ' · MPR ' + (st.darts[id] ? (st.treffer[id] / st.darts[id] * 3).toFixed(2) : '–') +
          (g.leben > 1 ? ' · ' + new Array(Math.max(0, g.leben - st.gefangen[id]) + 1).join('♥') : '') +
          (st.letzte[id] && !istAktiv ? ' · ' + esc(st.letzte[id]) : '');
      return '<div class="hu-chip' + (istAktiv ? ' aktiv' : '') + (raus ? ' raus' : '') + '">' +
        '<div class="hu-chip-kopf"><span class="hu-chip-farbe" style="background:' + (raus ? '#3a3032' : farbe(id)) + '"></span>' +
        '<span class="hu-chip-name">' + esc(pname(id)) + '</span>' +
        '<span class="hu-chip-ziel">' + (raus ? '' : esc(hunterZielText(g, id, st))) + '</span></div>' +
        '<span class="hu-chip-meta">' + meta + '</span></div>';
    }).join('');

    /* Rechts: die drei Darts der Aufnahme und die Tasten fuers Ziel. Boost:
       Single gross, Doppel und Triple daneben; sonst eine grosse Taste
       (bei Handicap der zaehlende Ring) und Miss. */
    $('hu-visit').innerHTML = [0, 1, 2].map(function (k) {
      var d = st.visit[k];
      return '<span class="ct' + (d ? (d.n === 0 ? ' miss' : '') : (k === st.inVisit && !g.done ? ' jetzt' : ' leer')) + '">' + (d ? (d.n === 0 ? '–' : throwLabel(d)) : '') + '</span>';
    }).join('');
    var pad = '';
    if (!g.done) {
      var dann = function (m) { return 'dann ' + (solo && st.schritte[aktiv] + m >= 20 ? 'Ziel' : HUNTER_RING[(st.pos[aktiv] + m) % 20]); };
      var miss = '<button class="hu-key miss" data-num="0" data-mult="1"><span class="z">Miss</span></button>' +
        '<button class="hu-key bust" data-action="hu-bust"><span class="z">Bust</span></button>';
      if (g.variante === 'boost') {
        pad = '<div class="hu-keys">' +
          '<button class="hu-key gross" data-num="' + zielZahl + '" data-mult="1"><span class="z">' + zielZahl + '</span><span class="sub">+1 · ' + dann(1) + '</span></button>' +
          '<button class="hu-key" data-num="' + zielZahl + '" data-mult="2"><span class="z"><span class="mx">D</span>' + zielZahl + '</span><span class="sub">+2 · ' + dann(2) + '</span></button>' +
          '<button class="hu-key" data-num="' + zielZahl + '" data-mult="3"><span class="z"><span class="mx">T</span>' + zielZahl + '</span><span class="sub">+3 · ' + dann(3) + '</span></button>' +
          miss + '</div>';
      } else {
        pad = '<div class="hu-keys einfach">' +
          '<button class="hu-key gross" data-num="' + zielZahl + '" data-mult="' + stufe + '"><span class="z">' + (praefix ? '<span class="mx">' + praefix + '</span>' : '') + zielZahl + '</span>' +
          '<span class="sub">' + (stufe === 1 ? 'jeder Ring zählt · ' : 'zählt · ') + dann(1) + '</span></button>' + miss + '</div>';
      }
    }
    $('hu-pad').innerHTML = pad;
    $('hu-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> ' + (solo ? 'ist durch' : 'gewinnt')
      : '<span class="muted">Am Wurf</span> <b>' + esc(pname(aktiv)) + '</b> <span class="muted">auf</span> <b>' + esc(hunterZielText(g, aktiv, st)) + '</b>';
    $('hu-menu-overlay').classList.toggle('hidden', !UI.menu);
    menueFokus($('hu-menu-overlay'));
    if (UI.menu) document.querySelector('#hu-menu-overlay .game-menu-sub').textContent = $('hu-sub').textContent;
    if (fang) setTimeout(function () { if (S.game === g) render(); }, 2700);
  }

  /* ================= Spielbericht (SDM-Bogen) ================= */

  /* Woher kommt der Bericht: aus dem laufenden Ligaspiel oder – über den
     Spieltag im Liga-Reiter – aus dem Archiv. */
  function ligaBerichtQuelle() {
    if (UI.bericht) {
      for (var i = 0; i < S.history.length; i++) {
        var h = S.history[i];
        if (h.liga && h.liga.terminId === UI.bericht && h.matches) {
          ligaUnsereIds(h);   // Bogen-Listen vollstaendig, auch nach einem Nachtrag
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
     Finish", „Mark 18-Darter" – jedes Finish und jedes Shortleg in einer
     eigenen Zeile, wie die Ligaleitung sie fuehrt. Der Bogen hat sieben
     Zeilen vorgedruckt; sind es mehr, waechst die Tabelle (hlZeilen in
     renderBericht), statt dass Highlights stumm wegfallen. */
  function berichtHighlights(ids, hlMap) {
    var zeilen = [];
    ids.forEach(function (id) {
      var h = hlMap[id];
      if (!h) return;
      var nm = esc(pname(id));
      if (h.s180 > 0) zeilen.push(nm + ' 180' + (h.s180 > 1 ? ' ×' + h.s180 : ''));
      h.finishes.forEach(function (f) { zeilen.push(nm + ' ' + f + ' Finish'); });
      h.shortlegs.forEach(function (d) { zeilen.push(nm + ' ' + d + '-Darter'); });
    });
    return zeilen;
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
        /* Nicht gemeldeter Gastspieler: so steht es auch auf dem Papierbogen. */
        if (ids[i] && ligaTyp(lg, ids[i]) === 'gast') nach = (nach ? nach + ' ' : '') + '(Gast)';
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

    var hlMap = legHighlights(q.matches, q.start || 501, heimIds.concat(gastIds));
    var hlHeim = berichtHighlights(heimIds, hlMap);
    var hlGast = berichtHighlights(gastIds, hlMap);
    /* Sieben Zeilen wie vorgedruckt - bei mehr Highlights so viele, wie es
       braucht (der Bogen bricht dann um, statt abzuschneiden). */
    var hlZeilen = function (praefix, liste) {
      var zeilen = '';
      for (var i = 0; i < Math.max(7, liste.length); i++) {
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
    UI.overlay = { type: 'nachmeldung', draft: { team: q.liga.heim ? 'H' : 'G', nach: '', vor: '', u18: 'nein', g: null }, striche: [] };
    render();
  }
  /* Die Nachmeldung fuer jemanden, der beim Start als "neu melden" auf dem
     Bogen steht: Team und Name stehen fest, "Spaeter" ist erlaubt - die App
     holt die Unterschrift spaetestens vor denen der Teamcaptains nach. */
  function nachmeldungFuerStart(id, hinweis) {
    var lg = S.tour && S.tour.liga;
    if (!lg || !id) return false;
    var seite = (lg.heimSpieler || []).indexOf(id) >= 0 ? 'H' : 'G';
    var p = profile(id), t = vollSplit(p && (p.voll || p.name));
    var aktiv = document.activeElement;
    if (aktiv && aktiv.blur) aktiv.blur();
    UI.overlay = { type: 'nachmeldung', fehler: hinweis || '', striche: [],
      draft: { team: seite, teamFest: true, id: id, start: true, nach: t.nach || '', vor: t.vor || '', u18: 'nein', g: null } };
    return true;
  }
  function nachmeldungenOffenStarten(hinweis) {
    var offen = ligaNachmeldungenOffen(S.tour && S.tour.liga);
    return offen.length ? nachmeldungFuerStart(offen[0], hinweis) : false;
  }
  /* Beim vorzeitigen Ende: alle noch nicht begonnenen Einzel kampflos fuer
     den Gegner werten (so steht es dann im Spielbericht). */
  function ligaOffeneKampflos() {
    var lg = S.tour && S.tour.liga;
    if (!lg) return;
    S.matches.forEach(function (m) {
      if (m.done || m.void || m.kampflos || m.belegtVon || m.legs.some(function (l) { return l.visits.length > 0; })) return;
      var uns = ligaUnser(lg, m);
      m.done = true; m.kampflos = true;
      m.winner = m.p[0] === uns ? m.p[1] : m.p[0];
      m.at = Date.now(); m.legs = [];
      if (geteiltesTurnier() && window.DartSync && window.DartSync.turnier) window.DartSync.turnier.ergebnis(m);
    });
    if (!lg.zeitBis) lg.zeitBis = Date.now();
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
    /* Nach einem spontanen Wechsel steht die Person schon auf dem Bogen -
       sie belegt keinen neuen Platz. */
    var nSchonDa = !!d.id && nListe.indexOf(d.id) >= 0;
    if (nListe.length >= 8 && !nSchonDa) {
      o.fehler = 'Dieses Team hat schon 8 Spieler auf dem Bogen, mehr erlaubt die SWO pro Ligaspiel nicht.';
      render();
      return;
    }
    /* Die Unterschrift steht gleich im Bogen (Entwurf Ligaspiel). */
    var nPunkte = (o.striche || []).reduce(function (n, st) { return n + st.length; }, 0);
    if (nPunkte < 4) { o.fehler = 'Bitte noch im Feld unterschreiben.'; render(); return; }
    nachmeldungAbschliessen(nq, { team: d.team, nach: d.nach, vor: d.vor, u18: d.u18, g: d.g, id: d.id || null, start: !!d.start }, signaturBild(o));
  }
  /* "Abbrechen" nach einem spontanen Wechsel: ohne Nachmeldung darf der
     Spieler nicht auf dem Bogen stehen - der Wechsel wird zurueckgenommen,
     die ausgewechselte Person kommt auf ihre Position zurueck. */
  function ligaWechselZurueck(d) {
    var lg = S.tour && S.tour.liga;
    var w = d && d.wechsel;
    if (!lg || !w || !d.id) return null;
    var id = d.id;
    /* Spielt das andere iPad schon ein Einzel mit dem Spontanen, laesst sich
       der Wechsel nicht mehr zuruecknehmen - dann bitte nachmelden. */
    if (S.matches.some(function (m) { return m.belegtVon && m.p.indexOf(id) >= 0; })) {
      return 'Ein Einzel mit diesem Spieler läuft schon am anderen Gerät. Bitte die Nachmeldung abschließen.';
    }
    var fehler = ligaWechseln(w.seite, w.pos, w.raus);
    if (fehler) return fehler;
    var benutzt = lg.posH.concat(lg.posG).indexOf(id) >= 0 ||
      S.matches.some(function (m) { return m.p.indexOf(id) >= 0; });
    if (!benutzt) {
      [lg.heimSpieler, lg.gastSpieler, lg.wir, lg.sie, S.tour.players].forEach(function (l) {
        var i = l ? l.indexOf(id) : -1;
        if (i >= 0) l.splice(i, 1);
      });
      /* Das eben erst angelegte Gastprofil ohne ein einziges Spiel geht
         ersatzlos weg (wie bei der Gast-Bereinigung). Ein Gast, den es
         vorher schon gab, bleibt. */
      var p = profile(id);
      if (d.neuAngelegt && p && p.gast && !p.dauer && !letztesSpielAm(id)) S.profiles = S.profiles.filter(function (q) { return q.id !== id; });
    }
    if (S.nmOffen && S.nmOffen.id === id) delete S.nmOffen;
    save();
    if (geteiltesTurnier()) geteiltenPlanSenden();
    return null;
  }
  function nachmeldungAbschliessen(q, person, bild) {
    var lg = q.liga;
    if (!Array.isArray(lg.nachmeldungen)) lg.nachmeldungen = [];
    var voll = (person.vor + ' ' + person.nach).replace(/\s+/g, ' ').trim();
    /* Als Spieler im Team: im Bogen unter H5-H8 bzw. G5-G8 und beim
       Positionswechsel waehlbar (wird am Namen wiedererkannt). */
    var teamListe = person.team === 'H' ? lg.heimSpieler : lg.gastSpieler;
    var andereListe = person.team === 'H' ? lg.gastSpieler : lg.heimSpieler;
    var id = person.id || ligaGastId(voll, []);
    if (andereListe && andereListe.indexOf(id) >= 0) {
      if (UI.overlay && UI.overlay.type === 'nachmeldung') { UI.overlay.fehler = 'Diese Person steht schon im anderen Team auf dem Bogen.'; render(); }
      return;
    }
    var prof = profile(id);
    if (prof) { prof.voll = voll; if (prof.name === voll) prof.name = person.vor.slice(0, 16); }
    if (teamListe && teamListe.indexOf(id) < 0) teamListe.push(id);
    var unsere = (person.team === 'H') === !!lg.heim;
    var seite = unsere ? lg.wir : lg.sie;
    if (seite && seite.indexOf(id) < 0) seite.push(id);
    if (S.tour && S.tour.liga === lg && S.tour.players && S.tour.players.indexOf(id) < 0) S.tour.players.push(id);
    lg.nachmeldungen.push({ team: person.team, nach: person.nach, vor: person.vor, u18: person.u18, g: person.g, unterschrift: bild, id: id });
    ligaTypSetzen(lg, id, 'neu');
    if (S.nmOffen && S.nmOffen.id === id) delete S.nmOffen;
    save();
    berichtNachmeldungenEinsetzen();
    /* Beim Start mehrere "neu melden": gleich der naechste Bogen. */
    if (person.start && S.tour && S.tour.liga === lg && nachmeldungenOffenStarten()) { render(); return; }
    UI.overlay = { type: 'hinweis', titel: voll + ' ist nachgemeldet',
      text: 'Steht jetzt auf Seite 2 des Spielberichts (mit Unterschrift) und im Team' +
        (person.start ? ' und steht in der Aufstellung.' : person.id ? ' und ist eingewechselt.' : geteiltesTurnier() ? '.' : ', über „Spieler wechseln“ einsetzbar.') +
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
  /* Die Empfaenger des Spielberichts (Julius, 11.11.): drei stehen fest -
     unsere beiden Teamcaptains (laut Ligaleitung TC-1/TC-2) und die
     Ligaleitung -, dazu der TC des Gegners, dessen Adresse die App je Team
     behaelt (Rueckspiel, naechste Saison), und eine freie Zeile. Angemeldet
     kommt die Liste vom Server und ist auf allen Geraeten dieselbe; sonst
     gilt, was dieses Geraet zuletzt verschickt hat. */
  function ligaTeamcaptains(team) {
    var info = (window.LIGA_DATEN.teamInfo || {})[team] || {};
    return (info.spieler || []).filter(function (sp) { return /^TC/i.test(String(sp.info || '')); })
      .sort(function (a, b) { return String(a.info).localeCompare(String(b.info)); })
      .slice(0, 2).map(function (sp) { return String(sp.name || '').replace(/^\*/, '').trim(); });
  }
  function berichtEmpfaengerVorlage(lg) {
    var tcs = ligaTeamcaptains(LIGA.team);
    var fest = Array.isArray(S.settings.berichtFest) ? S.settings.berichtFest.slice(0, 3) : [];
    while (fest.length < 3) fest.push('');
    fest = fest.map(function (a) { return String(a || '').trim(); });
    if (!fest[2]) fest[2] = LIGALEITUNG_MAIL;
    var gegner = lg && lg.gegner ? lg.gegner : '';
    return {
      adressen: [fest[0], fest[1], fest[2], (S.settings.gegnerMails || {})[gegner] || '', ''],
      rollen: ['TC ' + LIGA.team + (tcs[0] ? ' · ' + tcs[0] : ''), 'TC ' + LIGA.team + (tcs[1] ? ' · ' + tcs[1] : ' (2)'),
        'Ligaleitung · Udo Kern', 'TC ' + (gegner || 'Gegner'), 'weitere Adresse']
    };
  }
  /* Nach dem Versand merken: die drei festen Zeilen und die Gegner-Adresse
     je Team - hier und, angemeldet, fuer alle auf dem Server. */
  function berichtEmpfaengerMerken(lg, adressen) {
    if (!lg || lg.uebung) return;
    var festNeu = adressen.slice(0, 3).map(function (a) { return String(a || '').trim(); });
    S.settings.berichtFest = festNeu;
    if (!S.settings.gegnerMails) S.settings.gegnerMails = {};
    var gegnerNeu = String(adressen[3] || '').trim();
    if (lg.gegner) { if (gegnerNeu) S.settings.gegnerMails[lg.gegner] = gegnerNeu; else delete S.settings.gegnerMails[lg.gegner]; }
    if (window.DartKonto && window.DartKonto.nutzer()) {
      var merk = { fest: festNeu };
      if (lg.gegner) { merk.gegner = {}; merk.gegner[lg.gegner] = gegnerNeu; }
      window.DartKonto.ruf('PUT', '/api/liga/empfaenger', merk).catch(function () { /* dann eben nur auf diesem Geraet gemerkt */ });
    }
  }
  function berichtVersandOeffnen() {
    var q = ligaBerichtQuelle();
    var lg = q ? q.liga : null;
    var o;
    if (lg && lg.uebung) {
      /* Testlauf (Uebungsspiel): die eigene Adresse statt der Ligaleitung. */
      var eigene = (window.DartKonto && window.DartKonto.nutzer() && window.DartKonto.nutzer().email) || '';
      o = { type: 'bericht-versand', adressen: [eigene, '', ''], rollen: ['deine Adresse', 'weitere Adresse', 'weitere Adresse'], uebung: true };
    } else {
      var vorlage = berichtEmpfaengerVorlage(lg);
      o = { type: 'bericht-versand', adressen: vorlage.adressen, rollen: vorlage.rollen, uebung: false, beruehrt: {} };
      if (window.DartKonto && window.DartKonto.nutzer()) {
        o.laedt = true;
        window.DartKonto.ruf('GET', '/api/liga/empfaenger').then(function (d) {
          if (UI.overlay !== o) return;
          o.laedt = false;
          var fest = Array.isArray(d && d.fest) ? d.fest : [];
          S.settings.berichtFest = [fest[0] || '', fest[1] || '', fest[2] || LIGALEITUNG_MAIL];
          if (!S.settings.gegnerMails) S.settings.gegnerMails = {};
          var gegner = (d && d.gegner) || {};
          Object.keys(gegner).forEach(function (t) { S.settings.gegnerMails[t] = gegner[t]; });
          var neu = berichtEmpfaengerVorlage(lg);
          neu.adressen.forEach(function (a, i) { if (a && !o.beruehrt[i]) o.adressen[i] = a; });
          save(); render();
        }).catch(function () { if (UI.overlay === o) { o.laedt = false; render(); } });
      }
    }
    UI.overlay = o;
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
    /* Wer beim Start "neu melden" war, unterschreibt spaetestens jetzt -
       ohne Nachmeldung darf er nicht auf dem Bogen stehen. */
    var nmOffen = S.tour && S.tour.liga === q.liga ? ligaNachmeldungenOffen(q.liga) : [];
    if (nmOffen.length) {
      nachmeldungFuerStart(nmOffen[0], 'Vor den Unterschriften der Teamcaptains fehlt noch die Nachmeldung von ' + ligaName(nmOffen[0]) + '.');
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
  /* ---------- Mitteilungen an den Server (Push und Mail an alle) ----------
     Das Geraet, das etwas abschliesst, meldet es einmal; der Server baut den
     Text, verteilt nach den Einstellungen und haelt jedes Ereignis je Konto
     auf einmal - auch wenn zwei iPads es melden. */
  function mitteilungEreignis(art, daten) {
    if (!daten || !window.DartKonto || !window.DartKonto.nutzer() || !window.DartKonto.ruf) return;
    window.DartKonto.ruf('POST', '/api/mitteilungen/ereignis', { art: art, daten: daten }).catch(function () { /* nicht kritisch */ });
  }
  function ligaOrt(terminId) {
    var t = LIGA.termine.filter(function (x) { return x.id === terminId; })[0];
    return t && t.ort ? t.ort : '';
  }
  /* Zusammenfassung des laufenden Ligaspiels fuer die Ergebnis-Mitteilung -
     vor dem Archivieren, solange S.matches noch das Spiel sind. */
  function ligaErgebnisDaten(lg) {
    var d = ligaStandDaten();
    if (!d) return null;
    var stMap = stats();
    var mod = manOfTheDay(lg.wir, stMap);
    var einzel = S.matches.map(function (m) {
      var score = m.kampflos ? (m.winner === m.p[0] ? legsToWin() + ':0' : '0:' + legsToWin()) + ' w.o.'
        : m.legs.length ? legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) : '–:–';
      return { h: ligaName(m.p[0]), g: ligaName(m.p[1]), score: score };
    });
    return {
      termin: lg.terminId, nr: lg.nr, gegner: lg.gegner, heim: !!lg.heim, ort: ligaOrt(lg.terminId),
      wirP: d.wirP, sieP: d.sieP, wirS: d.wirS, sieS: d.sieS, wirL: d.wirL, sieL: d.sieL,
      /* Der Server nimmt hoechstens 80 Zeichen bzw. sechs Zeilen an und
         lehnt sonst die ganze Meldung ab - lieber hier kappen. */
      mod: String(manOfTheDayText(mod) || '').slice(0, 80),
      hl: mitteilungsZeilen(d.hl).slice(0, 6),
      einzel: einzel
    };
  }
  /* Die Highlight-Zeilen fuer die Mitteilung: ohne HTML, und keine laenger
     als der Server nimmt (server/lib/mitteilungen.mjs kuerzt jede Zeile auf
     160 Zeichen und nimmt hoechstens sechs). Eine zu lange Rubrik wird an
     den Trennpunkten umgebrochen, die Fortsetzung traegt die Rubrik erneut. */
  var MITTEILUNG_ZEILE_MAX = 150;
  function mitteilungsZeilen(hl) {
    var aus = [];
    hl.forEach(function (z) {
      var m = /^<b>(.*?):<\/b>\s*(.*)$/.exec(String(z));
      var rubrik = m ? m[1] : '', teile = (m ? m[2] : String(z).replace(/<[^>]*>/g, '')).split(' · ');
      var zeile = '';
      teile.forEach(function (t) {
        var naechste = zeile ? zeile + ' · ' + t : (rubrik ? rubrik + ': ' : '') + t;
        if (zeile && naechste.length > MITTEILUNG_ZEILE_MAX) { aus.push(zeile); zeile = (rubrik ? rubrik + ' (weiter): ' : '') + t; }
        else zeile = naechste;
      });
      if (zeile) aus.push(zeile);
    });
    return aus.map(function (z) { return z.replace(/<[^>]*>/g, ''); });
  }
  /* Teamrekorde (nur Konten, nur Liga): hoechstes Finish, hoechste Aufnahme,
     kuerzestes Leg. Beim ersten Lauf nur merken, danach jede Verbesserung
     melden - der Server haelt jeden Rekord auf einmal. */
  function rekordePruefen() {
    var map = careerLiga();
    var arten = [['highCO', 'Höchstes Finish', ''], ['highScore', 'Höchste Aufnahme', ''], ['bestLeg', 'Kürzestes Leg', 'Darts']];
    var best = {};
    Object.keys(map).forEach(function (k) {
      var p = profile(k);
      if (!p || p.gast || p.bot || p.test || p.gastKonto) return;
      arten.forEach(function (a) {
        var v = map[k][a[0]];
        if (!(v > 0)) return;
        var besser = a[0] === 'bestLeg' ? (!best[a[0]] || v < best[a[0]].wert) : (!best[a[0]] || v > best[a[0]].wert);
        if (besser) best[a[0]] = { wert: v, name: map[k].name };
      });
    });
    var alt = S.rekorde || null;
    S.rekorde = best;
    save();
    if (!alt) return;
    arten.forEach(function (a) {
      var n = best[a[0]], o = alt[a[0]];
      if (!n) return;
      var neu = !o || (a[0] === 'bestLeg' ? n.wert < o.wert : n.wert > o.wert);
      if (neu) mitteilungEreignis('rekord', { art: a[1], wert: n.wert, name: n.name, einheit: a[2] });
    });
  }

  function ligaAbschliessen(lg) {
    var q = ligaBerichtQuelle();
    if (q && q.liga === lg && !ligaAllesGespielt(q)) return;   // nie mitten im Abend
    lg.abgeschlossen = Date.now();
    var ergebnis = S.tour && S.tour.liga === lg ? ligaErgebnisDaten(lg) : null;
    if (S.tour && S.tour.liga === lg) {
      UI.bericht = lg.terminId;
      berichtStand = null;
      archiveTournament();
    }
    save();
    if (ergebnis && !lg.uebung) {
      mitteilungEreignis('ergebnis', ergebnis);
      try { rekordePruefen(); } catch (e) { /* Rekorde sind Kuer */ }
    }
  }

  function berichtOhneSendenAbschliessen() {
    var q = ligaBerichtQuelle();
    if (!q) return;
    ligaAbschliessen(q.liga);
    if (!q.liga.uebung) mitteilungEreignis('bericht-offen', { termin: q.liga.terminId, nr: q.liga.nr, gegner: q.liga.gegner });
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
    var lg = q.liga;
    /* Adressen merkt sich die App nur vom echten Spieltag - sonst staende
       nach einem Testlauf die eigene Adresse an Stelle der Ligaleitung. */
    berichtEmpfaengerMerken(lg, o.adressen);
    var heimTeam = lg.heim ? LIGA.team : lg.gegner;
    var gastTeam = lg.heim ? lg.gegner : LIGA.team;
    var datum = lg.tag ? ligaDatum(lg.tag) : fmtDate(q.at || Date.now());
    var betreff = (lg.uebung ? '[Test] ' : '') + 'Spielbericht ' + (lg.nr ? lg.nr + '. Spieltag: ' : '') + heimTeam + ' – ' + gastTeam + ' (' + datum + ')';
    var text = 'Hallo,\n\nanbei der unterschriebene Spielbericht: ' + betreff + '.\n\n' +
      (lg.uebung ? 'Das ist ein Testlauf aus dem Übungsspiel der App – bitte nicht weiterleiten.\n\n' : '') + 'Viele Grüße\n' + LIGA.team;
    var name = ('Spielbericht_' + (lg.nr ? 'Spieltag' + lg.nr + '_' : '') + heimTeam + '_' + gastTeam)
      .replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '_').replace(/_+/g, '_') + '.pdf';
    var pdf = berichtPdf();
    var liste = adressen.join(', ');
    try { if (navigator.clipboard) navigator.clipboard.writeText(liste).catch(function () {}); } catch (e) { /* egal */ }
    /* Mit eingerichtetem Mailversand schickt der Server die Mail samt PDF
       von blink180@ - ohne Teilen-Menue, mit Kopie ins Blink-Postfach. Geht
       das schief, bleibt der Dialog offen und bietet das Teilen-Menue an. */
    if (!o.ohneServer && window.DartKonto && window.DartKonto.nutzer() && window.DartKonto.mailBereit && window.DartKonto.mailBereit()) {
      o.sendet = true; o.fehler = ''; render();
      var leser = new FileReader();
      leser.onload = function () {
        var b64 = String(leser.result || '').split(',')[1] || '';
        window.DartKonto.ruf('POST', '/api/liga/bericht-mail', { an: adressen, betreff: betreff, text: text, pdf: b64, name: name }).then(function (d) {
          o.sendet = false;
          fertig('Die Mail mit dem PDF ist raus, Absender ' + (d && d.von ? d.von : 'blink180@wirtschaftln.de') + ', Kopie im Blink-Postfach.');
        }).catch(function (e) {
          o.sendet = false;
          o.ohneServer = true;
          /* Abgelehnte Adresse (400, Erlaubtliste des Servers: Ligaleitung
             und eigene Adresse): der Servertext nennt die Adresse und
             steht hier wortwoertlich - sonst wuesste niemand, welche. */
          var abgelehnt = e && e.status === 400 && e.message;
          o.fehler = abgelehnt
            ? e.message + ' Bitte die Adresse prüfen – oder unten über das Teilen-Menü schicken.'
            : 'Der Server konnte die Mail nicht schicken (' + (e && e.message ? e.message : 'keine Verbindung') + '). Unten geht es über das Teilen-Menü.';
          render();
        });
      };
      leser.onerror = function () { o.sendet = false; o.fehler = 'Das PDF ließ sich nicht lesen.'; render(); };
      leser.readAsDataURL(pdf);
      return;
    }
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

  /* ================= Spielende der schnellen Spiele (Entwurf "Sieger") =================
   * X01, Cricket, Round the World, Finisher, Hunter und Kaiwen enden auf
   * derselben Buehne wie das Turnier: Pokal und Titel, Podest (Zweiter,
   * Erster hoeher, Dritter), Endstand mit einer Zeile und Kennzahl je
   * Spieler, Highlights, unten "Zum Menue" und "Revanche". Kaiwen zeigt
   * das Team ohne Plaetze. Online steht dazu die eigene Platzierung
   * ("Du"). Die ausfuehrlichen Karten bleiben im Archiv (Spieleliste). */
  function siegerLive() {
    return S.screen === 'summary' && !!UI.summary && UI.summary.id === 'current' && !!S.game && !!S.game.done;
  }
  function siegerSpielDaten(kind, g) {
    var d = { emoji: '🏆', titel: '', sub: '', reihen: [], team: false, label: 'Endstand', hl: [], haupt: 'Revanche' };
    var vn = function (id) { return esc(String(pname(id)).trim().split(/\s+/)[0]); };
    var reihe = function (id, zeile, key) { return { id: id, zeile: zeile, key: key }; };
    var summe = function (obj, ids) { return ids.reduce(function (a, id) { return a + (obj[id] || 0); }, 0); };
    var bester = function (ids, wert) { var b = null; ids.forEach(function (id) { var v = wert(id); if (v !== null && (b === null || v > b.v)) b = { id: id, v: v }; }); return b; };
    var quoteText = function (ids, treffer, darts) {
      var b = bester(ids, function (id) { return darts[id] ? treffer[id] / darts[id] : null; });
      return b ? Math.round(b.v * 100) + ' % ' + vn(b.id) : null;
    };

    if (kind === 'quick') {
      var qm = g.matches ? g.matches[0] : g;
      var qStart = (g.settings && g.settings.start) || g.start || 501;
      var map = collectStats([{ matches: [qm], start: qStart }], qm.p);
      qm.p.forEach(function (id) { finalize(map[id]); });
      var qSolo = qm.p.length < 2;
      var sst = mehrereLegs(qm) ? satzStand(qm) : null;
      var qIds = qm.p.slice().sort(function (a, b) {
        return ((b === qm.winner) - (a === qm.winner)) || (legsWon(qm, b) - legsWon(qm, a)) || (map[b].avg - map[a].avg);
      });
      d.emoji = qSolo ? '🎯' : '🏆';
      d.titel = qm.winner ? esc(pname(qm.winner)) + (qSolo ? ' hat ausgemacht' : ' gewinnt!') : 'Abgebrochen';
      d.sub = 'Schnelles X01 · ' + qStart + ' Double Out · ' + (qSolo ? 'Solo' : sst ? dauerText(qm) : plural(qm.p.length, 'Spieler', 'Spieler')) +
        (!qSolo && qm.p.length === 2 && !sst ? ' · Legs ' + legsWon(qm, qIds[0]) + ':' + legsWon(qm, qIds[1]) : '');
      d.reihen = qIds.map(function (id) {
        var st = map[id];
        return reihe(id, sst ? kurzStand(sst, id) : plural(legsWon(qm, id), 'Leg', 'Legs') + (st.highCO ? ' · Finish ' + st.highCO : ''), 'Ø ' + (st.darts ? st.avg.toFixed(1) : '–'));
      });
      d.hl = turnierHighlights(qIds, map);
      var dq = qIds.filter(function (id) { return map[id].doubleAttempts > 0; }).map(function (id) { return Math.round(map[id].doubleQuote) + ' % ' + vn(id); });
      if (dq.length) d.hl.push(['Doppelquote', dq.join(' · ')]);
      return d;
    }

    var n = g.players.length, solo = n < 2;
    if (kind === 'cricket') {
      var cst = cricketState(g);
      var zu = function (id) { return CRICKET_NUMBERS.filter(function (x) { return cst.marks[id][x] >= 3; }).length; };
      var mpr = function (id) { return cst.darts[id] ? (cst.allMarks[id] / cst.darts[id]) * 3 : 0; };
      var cIds = g.players.slice().sort(function (a, b) {
        return ((b === g.winner) - (a === g.winner)) || (zu(b) - zu(a)) || (cst.score[b] - cst.score[a]) || (mpr(b) - mpr(a));
      });
      d.titel = esc(pname(g.winner)) + (solo ? ' hat alles zu' : ' gewinnt!');
      d.sub = 'Cricket ' + (g.scoring ? 'mit Punkten' : 'ohne Punkte') + ' · ' + plural(n, 'Spieler', 'Spieler');
      d.reihen = cIds.map(function (id) {
        var z = zu(id);
        return reihe(id, (z === 7 ? 'alle Felder zu' : z + ' Felder zu') + (g.scoring ? ' · ' + plural(cst.score[id], 'Punkt', 'Punkte') : ''), 'MPR ' + mpr(id).toFixed(2));
      });
      var bm = bester(cIds, function (id) { return cst.allMarks[id]; });
      var bq = bester(cIds, function (id) { return cst.darts[id] ? mpr(id) : null; });
      if (bm) d.hl.push(['Meiste Marken', bm.v + ' ' + vn(bm.id)]);
      if (bq) d.hl.push(['Höchste MPR', bq.v.toFixed(2) + ' ' + vn(bq.id)]);
      d.hl.push(['Darts gesamt', String(summe(cst.darts, cIds))]);
      return d;
    }

    if (kind === 'rtw') {
      var rst = rtwState(g);
      var durch = function (id) { return id === g.winner || !!rst.finished[id]; };
      var rIds = g.players.slice().sort(function (a, b) {
        return ((b === g.winner) - (a === g.winner)) || (durch(b) - durch(a)) || (rst.target[b] - rst.target[a]) || (rst.darts[a] - rst.darts[b]);
      });
      d.titel = esc(pname(g.winner)) + (solo ? ' ist durch' : ' gewinnt!');
      d.sub = 'Round the World' + (g.boost !== false ? ' · Boost' : '') + ' · bis Bull';
      d.reihen = rIds.map(function (id) {
        var t = rst.target[id];
        return reihe(id, durch(id) ? 'durch mit Bull' : 'steht auf ' + (t === 25 ? 'Bull' : t), plural(rst.darts[id], 'Dart', 'Darts'));
      });
      var rq = quoteText(rIds, rst.hits, rst.darts);
      if (rq) d.hl.push(['Beste Quote', rq]);
      if (g.winner) d.hl.push(['Bis Bull', plural(rst.darts[g.winner], 'Dart', 'Darts') + ' ' + vn(g.winner)]);
      d.hl.push(['Darts gesamt', String(summe(rst.darts, rIds))]);
      return d;
    }

    if (kind === 'finisher') {
      var gew = {}, dsum = {}, best = {}, hoch = {};
      g.players.forEach(function (id) { gew[id] = 0; dsum[id] = 0; best[id] = null; hoch[id] = 0; });
      (g.rounds || []).forEach(function (rd) {
        if (!rd.sieger || !rd.darts || gew[rd.sieger] === undefined) return;
        gew[rd.sieger]++; dsum[rd.sieger] += rd.darts;
        if (best[rd.sieger] === null || rd.darts < best[rd.sieger]) best[rd.sieger] = rd.darts;
        if (rd.zahl > hoch[rd.sieger]) hoch[rd.sieger] = rd.zahl;
      });
      var gespielt = (g.rounds || []).filter(function (rd) { return rd.sieger; }).length;
      var fIds = g.players.slice().sort(function (a, b) {
        return ((b === g.winner) - (a === g.winner)) || (gew[b] - gew[a]) || ((gew[a] ? dsum[a] / gew[a] : 99) - (gew[b] ? dsum[b] / gew[b] : 99));
      });
      d.titel = esc(pname(g.winner)) + (solo ? ' hat ausgemacht' : ' gewinnt!');
      d.sub = 'Finisher · ' + plural(gespielt, 'Runde', 'Runden') + ' · auf ' + g.ziel + ' Punkte';
      d.reihen = fIds.map(function (id) {
        return reihe(id, plural(gew[id], 'Runde', 'Runden') + ' gewonnen', gew[id] ? 'Ø ' + (dsum[id] / gew[id]).toFixed(1) + ' Darts' : '–');
      });
      var fh = bester(fIds, function (id) { return hoch[id] || null; });
      var fs = bester(fIds, function (id) { return best[id] === null ? null : -best[id]; });
      if (fh) d.hl.push(['Höchste Zahl', fh.v + ' ' + vn(fh.id)]);
      if (fs) d.hl.push(['Schnellstes', plural(-fs.v, 'Dart', 'Darts') + ' ' + vn(fs.id)]);
      d.hl.push(['Gespielte Runden', String(gespielt)]);
      return d;
    }

    if (kind === 'hunter') {
      var hst = hunterState({ players: g.players, throws: g.throws || [], variante: g.variante, handicap: g.handicap, startPos: g.startPos, leben: g.leben });
      var hName = g.variante === 'boost' ? 'Boost' : g.variante === 'handicap' ? 'Handicap' : 'Normal';
      var hIds = g.players.slice().sort(function (a, b) {
        var ra = hst.raus[a], rb = hst.raus[b];
        return ((b === g.winner) - (a === g.winner)) || ((!rb) - (!ra)) || ((rb ? rb.at : 0) - (ra ? ra.at : 0)) || (hst.faenge[b] - hst.faenge[a]);
      });
      d.emoji = solo ? '🎯' : '🏆';
      d.titel = solo ? (hst.fertig ? plural(hst.fertig.darts, 'Dart', 'Darts') + ' für die Runde' : 'Runde nicht beendet') : esc(pname(g.winner)) + ' gewinnt die Jagd';
      d.sub = 'Hunter · ' + hName + ' · ' + (solo ? 'Solo' : plural(n, 'Spieler', 'Spieler') + ' · Runde ' + hst.runde + ((g.leben || 1) > 1 ? ' · ' + g.leben + ' Leben' : '')) + (g.bestNeu ? ' · neuer Bestwert' : '');
      d.reihen = hIds.map(function (id) {
        var raus = hst.raus[id], f = hst.faenge[id] || 0;
        var mpr = hst.darts[id] ? (hst.treffer[id] / hst.darts[id]) * 3 : 0;
        return reihe(id, solo ? plural(hst.darts[id], 'Dart', 'Darts')
          : raus ? (f ? plural(f, 'Fang', 'Fänge') + ' · ' : '') + 'gefangen von ' + vn(raus.von)
          : plural(f, 'Fang', 'Fänge') + ' · ' + plural(hst.darts[id], 'Dart', 'Darts'), 'MPR ' + mpr.toFixed(2));
      });
      if (!solo) {
        var fl = hIds.filter(function (id) { return hst.faenge[id] > 0; }).map(function (id) { return hst.faenge[id] + ' ' + vn(id); });
        if (fl.length) d.hl.push(['Fänge', fl.join(' · ')]);
        var doppel = {};
        hst.fangLog.forEach(function (f) { var k = f.at + '\u0001' + f.von; doppel[k] = (doppel[k] || 0) + 1; });
        var dfl = Object.keys(doppel).filter(function (k) { return doppel[k] >= 2; }).map(function (k) { return vn(k.split('\u0001')[1]); });
        if (dfl.length) d.hl.push(['Doppelfang', dfl.join(' · ')]);
      }
      var hm = bester(hIds, function (id) { return hst.darts[id] ? hst.treffer[id] / hst.darts[id] * 3 : null; });
      if (hm) d.hl.push(['Höchste MPR', hm.v.toFixed(2) + ' ' + vn(hm.id)]);
      d.hl.push(['Darts gesamt', String(summe(hst.darts, hIds))]);
      return d;
    }

    /* Kaiwen: kein Sieger, das Team und sein Score. */
    var kst = kaiwenState({ players: g.players, versuche: g.versuche || [] });
    d.team = true; d.label = solo ? 'Spieler' : 'Team'; d.haupt = 'Neuer Versuch';
    d.emoji = g.rekordNeu ? '🏆' : '🔥';
    d.titel = g.rekordNeu ? 'Neuer Rekord: ' + g.rekordNeu : 'Score ' + kst.hoechste;
    d.sub = g.players.map(function (id) { return esc(pname(id)); }).join(' & ') + ' · Kaiwen · ' + (solo ? 'Solo' : 'Team') + ' · ' +
      plural(kst.versuche, 'Versuch', 'Versuche') + ' · ' + plural(kst.checks, 'Check', 'Checks');
    d.reihen = g.players.map(function (id) {
      var pbNeu = g.pbNeu && g.pbNeu[id];
      var pb = pbNeu || kaiwenPB(id, solo);
      return reihe(id, plural(kst.checksJe[id] || 0, 'Check', 'Checks') + ' · ' + plural(kst.dartsJe[id] || 0, 'Dart', 'Darts'), 'PB ' + (pb === null ? '–' : pb) + (pbNeu ? ' neu' : ''));
    });
    var hc = null;
    kst.verlauf.forEach(function (v) { if (v.check && (hc === null || v.zahl > hc)) hc = v.zahl; });
    d.hl.push(['Höchster Check', hc === null ? 'keiner' : String(hc)]);
    var pbs = g.players.filter(function (id) { return g.pbNeu && g.pbNeu[id]; }).map(function (id) { return g.pbNeu[id] + ' ' + vn(id); });
    d.hl.push(['PB ' + (solo ? 'Solo' : 'Team'), pbs.length ? 'neu: ' + pbs.join(' · ') : 'bleibt']);
    var rek = kaiwenRekord();
    d.hl.push(['Rekord', rek.zahl + (rek.namen.length ? ' ' + rek.namen.map(esc).join(' & ') : '')]);
    d.hl.push(['Versuche', kst.versuche + ' · ' + kst.checks + ' geschafft']);
    return d;
  }
  function renderSiegerSpiel(kind, found) {
    var g = found.g;
    var d = siegerSpielDaten(kind, g);
    var n = d.reihen.length;
    /* Allein gespielt: keine Medaille, kein Rang. */
    var medals = n > 1 ? ['🥇', '🥈', '🥉'] : ['', '', ''];
    var order = d.team ? d.reihen.map(function (_, i) { return i; }) : n >= 3 ? [1, 0, 2] : n === 2 ? [1, 0] : [0];
    var hoehe = d.team ? order.map(function () { return '92%'; }) : n >= 3 ? ['78%', '100%', '64%'] : n === 2 ? ['78%', '100%'] : ['100%'];
    /* Online: die eigene Platzierung, Titel aus der eigenen Sicht. */
    var me = g.online ? eigeneKontoId() : null;
    var meIdx = -1;
    if (me && !d.team) d.reihen.forEach(function (r, i) { if (r.id === me) meIdx = i; });
    var du = meIdx >= 0, gewonnen = du && meIdx === 0 && d.reihen[0].id === g.winner;
    var titel = du ? (gewonnen ? 'Du gewinnst!' : meIdx === 1 ? 'Knapp dran!' : 'Nächstes Mal!') : d.titel;
    var sub = du ? (gewonnen ? 'Online · ' : esc(pname(d.reihen[0].id)) + ' gewinnt · ') + d.sub : d.sub;
    var emoji = du && !gewonnen ? '🎯' : d.emoji;
    var duChip = function (idx) { return du && idx === meIdx ? ' <span class="sg-du-chip">Du</span>' : ''; };
    $('summary-box').innerHTML =
      '<div class="sg-titel"><span class="sg-pokal' + (du && !gewonnen ? ' still' : '') + '">' + emoji + '</span><h1>' + titel + '</h1><p>' + sub + '</p>' +
        (du ? '<div class="sg-du' + (gewonnen ? ' sieg' : '') + '"><span class="sg-du-tag">Du</span><b>' + (gewonnen ? 'Platz 1' : 'Platz ' + (meIdx + 1) + ' von ' + n) + '</b>' +
          '<span>' + d.reihen[meIdx].zeile + ' · ' + d.reihen[meIdx].key + '</span></div>' : '') + '</div>' +
      '<div class="sg-koerper">' +
        '<div class="sg-podest n' + order.length + (d.team ? ' team' : '') + '">' + order.map(function (idx, i) {
          var r = d.reihen[idx];
          return '<div class="sg-stufe' + (idx === 0 && !d.team ? ' erster' : '') + '" style="--h:' + hoehe[i] + '">' +
            '<div class="sg-av">' + avatarHTML(profile(r.id), 'lg') + (d.team || !medals[idx] ? '' : '<span class="sg-medal">' + medals[idx] + '</span>') + '</div>' +
            '<span class="sg-name">' + esc(pname(r.id)) + duChip(idx) + '</span>' +
            '<span class="sg-zeile">' + r.zeile + '</span>' +
            '<span class="sg-key">' + r.key + '</span></div>';
        }).join('') + '</div>' +
        '<div class="card sg-endstand"><h2 class="kt">' + d.label + '</h2><div class="sg-liste">' + d.reihen.map(function (r, i) {
          return '<div class="sg-row"><span class="sg-rang">' + (d.team || n < 2 ? '' : (i + 1) + '.') + '</span><span class="sg-nm">' + esc(pname(r.id)) + (du && i === meIdx ? ' <span class="sg-du-chip">Du</span>' : '') + '</span>' +
            '<span class="sg-sub">' + r.zeile + '</span><b>' + r.key + '</b></div>';
        }).join('') + '</div>' +
        '<h2 class="kt sg-abstand">Highlights</h2><div class="sg-hl-liste">' + hlZeilen(d.hl) + '</div></div>' +
      '</div>';
    $('summary-actions').innerHTML = '<div class="sg-aktionen"><div class="sg-knoepfe">' +
      '<button class="btn ghost" data-action="finish-game">Zum Menü</button>' +
      '<button class="btn start-rot" data-action="restart-game">' + d.haupt + '</button></div></div>';
  }

  /* ================= Spielstatistik (Entwurf "Spielstatistik", Okt. 2026) =================
   * Oben das Ergebnis: Art und Meta, in der Mitte der Stand (zu zweit
   * "A 3 : 1 B", sonst "A gewinnt"), rechts der Sieger als Pille. Links
   * alle Werte als Vergleich, je Spieler eine Spalte, der beste Wert je
   * Zeile leuchtet. Rechts der Verlauf (Legs, Spiele, Runden, Felder).
   * Unten links das Zuruecknehmen, rechts weiter; im Archiv steht der
   * Zurueck-Pfeil im Ergebnis. Das Ende eines laufenden schnellen Spiels
   * zeigt stattdessen die Sieger-Buehne (renderSiegerSpiel). */
  var ST_PFEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 12H7M11.5 6.5L6 12l5.5 5.5"></path></svg>';
  function stZahl(s) { var m = /-?\d+(?:[.,]\d+)?/.exec(String(s)); return m ? parseFloat(m[0].replace(',', '.')) : NaN; }
  function statistikHtml(d) {
    var n = d.spieler.length;
    var ergebnis = '<div class="st-ergebnis' + (d.archiv ? ' archiv' : '') + '">' +
      '<div class="st-links"><button class="st-zurueck" data-action="summary-back" aria-label="Zurück">' + ST_PFEIL + '</button>' +
        '<div class="st-art"><span class="kt">' + d.kind + '</span><span class="st-meta">' + d.meta + '</span></div></div>' +
      '<div class="st-stand">' + (d.zwei
        ? '<span class="st-sn' + (d.sieger === d.zwei.a ? ' sieg' : '') + '">' + esc(pname(d.zwei.a)) + '</span><b>' + d.zwei.stand + '</b>' +
          '<span class="st-sn' + (d.sieger === d.zwei.b ? ' sieg' : '') + '">' + esc(pname(d.zwei.b)) + '</span>'
        : '<b class="st-titel">' + d.titel + '</b>') + '</div>' +
      '<div class="st-rechts">' + (d.sieger ? '<span class="st-pille">🏆 ' + esc(pname(d.sieger)) + '</span>' : d.pille ? '<span class="st-pille">' + d.pille + '</span>' : '') + '</div></div>';
    var cols = 'minmax(0, ' + (n <= 2 ? '1.1' : '1.3') + 'fr) repeat(' + n + ', minmax(0, 1fr))';
    var koepfe = d.spieler.map(function (sp) {
      return '<div class="st-sp' + (sp.id === d.sieger ? ' sieg' : '') + '">' + avatarHTML(profile(sp.id), 'md') +
        '<span class="st-sp-name">' + esc(pname(sp.id)) + '</span><span class="st-sp-sub">' + (sp.sub || '') + '</span></div>';
    }).join('');
    var zeilen = d.zeilen.map(function (z) {
      var best = -1;
      if (z.besser && z.v.length > 1) {
        var nums = z.v.map(stZahl), ok = nums.filter(function (x) { return !isNaN(x); });
        if (ok.length > 1) {
          var ziel = z.besser === 'hi' ? Math.max.apply(null, ok) : Math.min.apply(null, ok);
          if (nums.filter(function (x) { return x === ziel; }).length === 1) best = nums.indexOf(ziel);
        }
      }
      return '<div class="st-zeile"><span class="st-k">' + z.k + '</span>' +
        z.v.map(function (v, i) { return '<span class="st-v' + (i === best ? ' best' : '') + '">' + v + '</span>'; }).join('') + '</div>';
    }).join('');
    var vergleich = '<div class="card st-vergleich' + (n <= 2 ? ' zwei' : n > 3 ? ' viele' : '') + '" style="--cols:' + cols + '">' +
      '<div class="st-kopf"><span class="kt">Statistik</span>' + koepfe + '</div><div class="st-zeilen">' + zeilen + '</div></div>';
    var seite = d.seite ? '<div class="card st-verlauf"><span class="kt">' + d.seite.titel + '</span><div class="st-liste">' + (d.seite.eintraege.length ? d.seite.eintraege.map(function (e) {
      return '<div class="st-item' + (e.action ? ' tap' : '') + '"' + (e.action ? ' data-action="' + e.action + '" ' + (e.attrs || '') + ' role="button" tabindex="0"' : '') + '>' +
        '<span class="st-n">' + e.n + '</span><span class="st-wer">' +
        (e.wer ? '<span class="st-punkt" style="background:hsl(' + hue(e.wer) + ',55%,52%)"></span><span class="st-wname">' + esc(pname(e.wer)) + '</span>' : '<span class="st-wname">' + (e.wertext || '') + '</span>') +
        '</span><span class="st-wert">' + e.text + '</span></div>';
    }).join('') : '<p class="hint">Noch nichts.</p>') + '</div><span class="st-note">Die Werte fließen in Karriere-Statistik und Ranglisten ein.</span></div>' : '';
    var a = d.aktionen;
    var aktionen = a ? '<div class="st-aktionen">' +
      (a.fix ? '<button class="btn st-fix" data-action="' + a.fix.action + '"' + (a.fix.attrs || '') + '>' + ST_PFEIL + a.fix.label + '</button>' : '') +
      '<span class="st-luft"></span>' +
      (a.zurueck ? '<button class="btn ghost" data-action="' + a.zurueck.action + '">' + a.zurueck.label + '</button>' : '') +
      (a.haupt ? '<button class="btn start-rot" data-action="' + a.haupt.action + '">' + a.haupt.label + '</button>' : '') + '</div>' : '';
    return { box: ergebnis + '<div class="st-inhalt' + (d.seite ? '' : ' allein') + '">' + vergleich + seite + '</div>', aktionen: aktionen };
  }
  /* Die X01-Zeilen (Turnierspiel, schnelles Spiel, Turnier): eine Spalte je Spieler. */
  function x01Zeilen(stats, mitDoppel) {
    var z = [
      { k: '3-Dart-Average', v: stats.map(function (st) { return st.darts ? st.avg.toFixed(2) : '–'; }), besser: 'hi' },
      { k: 'First 9', v: stats.map(function (st) { return st.first9Darts ? st.first9.toFixed(2) : '–'; }), besser: 'hi' },
      { k: 'Höchste Aufnahme', v: stats.map(function (st) { return st.highScore || '–'; }), besser: 'hi' },
      { k: '180 / 140+ / 100+', v: stats.map(function (st) { return st.s180 + ' / ' + st.s140 + ' / ' + st.s100; }), besser: null },
      { k: 'Höchstes Finish', v: stats.map(function (st) { return st.highCO || '–'; }), besser: 'hi' }
    ];
    if (mitDoppel) z.push({ k: 'Doppelquote', v: stats.map(function (st) { return st.doubleAttempts ? st.doubleQuote.toFixed(0) + ' % (' + st.doubleHits + '/' + st.doubleAttempts + ')' : '–'; }), besser: 'hi' });
    z.push({ k: 'Bestes Leg', v: stats.map(function (st) { return st.bestLeg ? st.bestLeg + ' Darts' : '–'; }), besser: 'lo' });
    z.push({ k: 'Darts geworfen', v: stats.map(function (st) { return String(st.darts); }), besser: null });
    return z;
  }
  /* Der Stand zu zweit: Saetze, wenn welche gespielt werden, sonst Legs. */
  function x01Stand(m) {
    var st = mehrereLegs(m) ? satzStand(m) : null;
    if (st && st.gewinnSaetze > 1) return st.saetze[m.p[0]] + ' : ' + st.saetze[m.p[1]];
    return legsWon(m, m.p[0]) + ' : ' + legsWon(m, m.p[1]);
  }
  function legEintraege(m, start) {
    var out = [];
    m.legs.forEach(function (leg, i) {
      if (!leg.winner) return;
      var dl = dartsInLeg(leg, leg.winner);
      out.push({ n: 'Leg ' + (i + 1), wer: leg.winner, text: dl ? dl + ' Darts · Ø ' + ((start / dl) * 3).toFixed(1) : 'nur Ergebnis' });
    });
    return out;
  }
  function renderSummary() {
    var s = UI.summary;
    var found = s ? findGame(s.kind, s.id) : null;
    if (!found) { S.screen = S.matches.length ? 'tournament' : 'setup'; render(); return; }
    /* Das Ende eines laufenden Spiels: die Sieger-Buehne. Danach (Archiv)
       die Spielstatistik. */
    var live = siegerLive() && found.g && found.live;
    $('screen-summary').classList.toggle('sieger', !!live);
    if (live) { renderSiegerSpiel(s.kind, found); return; }

    var d = null;
    var P = function (nn, e, mm) { return plural(nn, e, mm); };
    var spielAktionen = function (istLive) {
      return istLive ? { zurueck: { label: 'Speichern und beenden', action: 'finish-game' }, haupt: { label: 'Nochmal spielen', action: 'restart-game' } } : null;
    };

    if (s.kind === 'turnier') {
      /* Der Endstand eines gespielten Turniers -- zum Nachschauen aus der Spieleliste. */
      var th = found.h;
      var tStart = (th.settings && th.settings.start) || 501;
      var tTab = turnierTabelle(th);
      var tFertig = th.matches.filter(function (x) { return x.done; });
      d = {
        kind: 'Turnier', archiv: true, aktionen: null,
        meta: fmtDate(th.at) + ' · ' + P((th.lineup || []).length, 'Spieler', 'Spieler') + ' · ' + tStart + ' Double Out' +
          (th.settings && th.settings.bestOf > 1 ? ' · Best of ' + th.settings.bestOf : ' · ein Leg') + ' · ' + P(tFertig.length, 'Spiel', 'Spiele'),
        zwei: null, titel: th.winner ? esc(pname(th.winner)) + ' gewinnt' : 'Turnier', sieger: th.winner || null,
        spieler: tTab.map(function (st) { return { id: st.id, sub: P(st.won, 'Sieg', 'Siege') + ' · ' + st.legsWon + ':' + st.legsLost }; }),
        zeilen: x01Zeilen(tTab, false),
        seite: { titel: 'Spiele', eintraege: tFertig.map(function (x, i) {
          var verlierer = x.p[0] === x.winner ? x.p[1] : x.p[0];
          return { n: 'Sp. ' + (i + 1), wer: x.winner, text: 'gegen ' + esc(pname(verlierer)) + ' · ' + legsWon(x, x.winner) + ':' + legsWon(x, verlierer),
            action: 'open-summary', attrs: 'data-kind="501" data-id="' + esc(x.id) + '"' };
        }) }
      };

    } else if (s.kind === '501') {
      var m = found.m;
      var map = collectStats([{ matches: [m], start: found.start }], m.p);
      m.p.forEach(function (id) { finalize(map[id]); });
      var mSolo = m.p.length < 2;
      var mPos = found.live ? S.matches.indexOf(m) : -1;
      var mLegs = m.legs.filter(function (l) { return l.winner; }).length;
      var mAkt = null;
      if (found.live) {
        mAkt = {
          fix: m.done && !m.ergebnis && !m.kampflos ? { label: 'Letzte Aufnahme zurücknehmen', action: 'reopen-match', attrs: ' data-id="' + esc(m.id) + '"' } : null,
          zurueck: { label: 'Zur Tabelle', action: 'to-tournament' },
          haupt: !allMatchesDone() ? { label: 'Nächstes Spiel', action: 'ov-next-match' } : { label: 'Turnier auswerten', action: 'to-winner' }
        };
      }
      d = {
        kind: 'X01 · ' + (mSolo ? 'Solo' : found.quick ? 'Schnelles Spiel' : found.live ? 'Turnierspiel ' + (mPos + 1) + ' von ' + S.matches.length : 'Turnierspiel'), archiv: !found.live, aktionen: mAkt,
        meta: (found.live ? '' : fmtDate(m.at || found.at) + ' · ') + found.start + ' Double Out · ' + (mehrereLegs(m) ? dauerText(m) : P(mLegs, 'Leg', 'Legs')),
        zwei: !mSolo && m.p.length === 2 ? { a: m.p[0], b: m.p[1], stand: x01Stand(m) } : null,
        titel: m.winner ? esc(pname(m.winner)) + (mSolo ? ' hat ausgemacht' : ' gewinnt') : 'Offen',
        sieger: mSolo ? null : m.winner || null, pille: mSolo ? '🎯 ausgemacht' : null,
        spieler: m.p.map(function (id) { return { id: id, sub: mSolo ? 'ausgecheckt' : P(legsWon(m, id), 'Leg', 'Legs') }; }),
        zeilen: x01Zeilen(m.p.map(function (id) { return map[id]; }), true),
        seite: { titel: 'Legs', eintraege: legEintraege(m, found.start) }
      };

    } else if (s.kind === 'quick') {
      var qg = found.g;
      var qm = qg.matches ? qg.matches[0] : qg;          // archiviert oder noch live
      var qStart = (qg.settings && qg.settings.start) || qg.start || 501;
      var qMap = collectStats([{ matches: [qm], start: qStart }], qm.p);
      qm.p.forEach(function (id) { finalize(qMap[id]); });
      var qLeg = qm.legs[qm.legs.length - 1];
      var qSolo = qm.p.length < 2;
      var qSession = !!(qm.session || qg.session);
      var qSSt = mehrereLegs(qm) ? satzStand(qm) : null;
      d = {
        kind: 'X01 · ' + (qSession ? 'Session' : qSolo ? 'Solo' : 'Schnelles Spiel'), archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(qg.at || qm.at) + ' · ') + qStart + ' Double Out · ' + (qSolo ? 'Solo' : P(qm.p.length, 'Spieler', 'Spieler')) + ' · ' + (qSSt ? dauerText(qm) : P(qm.legs.filter(function (l) { return l.winner; }).length, 'Leg', 'Legs')),
        zwei: !qSolo && qm.p.length === 2 ? { a: qm.p[0], b: qm.p[1], stand: x01Stand(qm) } : null,
        titel: qm.winner ? esc(pname(qm.winner)) + (qSolo ? ' hat ausgemacht' : ' gewinnt') : qSession ? 'Session beendet' : 'Abgebrochen',
        sieger: qSolo ? null : qm.winner || null, pille: qSession ? '🎯 Session' : qSolo ? '🎯 ausgemacht' : null,
        spieler: qm.p.map(function (id) { return { id: id, sub: qSession ? P(legsWon(qm, id), 'Leg', 'Legs') : qSSt ? kurzStand(qSSt, id) : qm.winner === id ? 'ausgecheckt' : 'Rest ' + (qLeg ? remainingIn(qLeg, id) : 0) }; }),
        zeilen: x01Zeilen(qm.p.map(function (id) { return qMap[id]; }), true),
        seite: { titel: 'Legs', eintraege: legEintraege(qm, qStart) }
      };

    } else if (s.kind === 'cricket') {
      var g = found.g;
      var cst = cricketState(g);
      var cZu = function (id) { return CRICKET_NUMBERS.filter(function (nx) { return cst.marks[id][nx] >= 3; }); };
      var cMpr = function (id) { return cst.darts[id] ? (cst.allMarks[id] / cst.darts[id]) * 3 : 0; };
      var cRunden = Math.ceil((g.throws || []).length / (3 * g.players.length));
      var cZeilen = [
        { k: 'MPR', v: g.players.map(function (id) { return cMpr(id).toFixed(2); }), besser: 'hi' },
        { k: 'Marken', v: g.players.map(function (id) { return String(cst.allMarks[id]); }), besser: 'hi' }
      ];
      if (g.scoring) cZeilen.push({ k: 'Punkte', v: g.players.map(function (id) { return String(cst.score[id]); }), besser: 'hi' });
      cZeilen.push({ k: 'Felder zu', v: g.players.map(function (id) { return cZu(id).length + ' / 7'; }), besser: null });
      cZeilen.push({ k: 'Darts', v: g.players.map(function (id) { return String(cst.darts[id]); }), besser: null });
      d = {
        kind: 'Cricket · ' + (g.scoring ? 'mit Punkten' : 'ohne Punkte'), archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(g.at) + ' · ') + P(g.players.length, 'Spieler', 'Spieler') + ' · ' + P(cRunden, 'Runde', 'Runden'),
        zwei: null, titel: esc(pname(g.winner)) + (g.players.length < 2 ? ' hat alles zu' : ' gewinnt'), sieger: g.players.length < 2 ? null : g.winner,
        pille: g.players.length < 2 ? '🎯 alles zu' : null,
        spieler: g.players.map(function (id) { var z = cZu(id).length; return { id: id, sub: z === 7 ? 'alle zu' : z + ' zu' }; }),
        zeilen: cZeilen,
        seite: { titel: 'Felder zu', eintraege: g.players.map(function (id, i) {
          return { n: (i + 1) + '.', wer: id, text: cZu(id).map(function (nx) { return nx === 25 ? 'Bull' : nx; }).join(' · ') || '–' };
        }) }
      };

    } else if (s.kind === 'hunter') {
      var hg = found.g;
      var hst = hunterState({ players: hg.players, throws: hg.throws || [], variante: hg.variante, handicap: hg.handicap, startPos: hg.startPos, leben: hg.leben });
      var hSolo = hg.players.length < 2;
      var hName = hg.variante === 'boost' ? 'Boost' : hg.variante === 'handicap' ? 'Handicap' : 'Normal';
      var hZeilen = [];
      if (!hSolo) hZeilen.push({ k: 'Fänge', v: hg.players.map(function (id) { return String(hst.faenge[id] || 0); }), besser: 'hi' });
      hZeilen.push({ k: 'Darts geworfen', v: hg.players.map(function (id) { return String(hst.darts[id] || 0); }), besser: null });
      hZeilen.push({ k: 'Treffer', v: hg.players.map(function (id) { return String(hst.treffer[id] || 0); }), besser: 'hi' });
      hZeilen.push({ k: 'MPR', v: hg.players.map(function (id) { return hst.darts[id] ? (hst.treffer[id] / hst.darts[id] * 3).toFixed(2) : '–'; }), besser: 'hi' });
      hZeilen.push({ k: 'Trefferquote', v: hg.players.map(function (id) { return hst.darts[id] ? Math.round(hst.treffer[id] / hst.darts[id] * 100) + ' %' : '–'; }), besser: 'hi' });
      if ((hg.leben || 1) > 1 && !hSolo) hZeilen.push({ k: 'Gefangen', v: hg.players.map(function (id) { return (hst.gefangen[id] || 0) + ' von ' + hg.leben; }), besser: null });
      if (hg.variante === 'handicap') hZeilen.push({ k: 'Stufe', v: hg.players.map(function (id) { return ['', 'Single', 'Doppel', 'Triple'][hunterStufe(hg, id)]; }), besser: null });
      var hFaenge = [];
      hst.fangLog.forEach(function (f) { hFaenge.push({ at: f.at, wer: f.von, text: 'fängt ' + esc(pname(f.wer)) + (f.raus ? '' : ' · steigt wieder ein') }); });
      d = {
        kind: 'Hunter · ' + hName, archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(hg.at) + ' · ') + (hSolo ? 'Solo' : P(hg.players.length, 'Spieler', 'Spieler') + ' · ' + P(hst.runde, 'Runde', 'Runden') + ((hg.leben || 1) > 1 ? ' · ' + hg.leben + ' Leben' : '')) + (hg.bestNeu ? ' · neuer Bestwert' : ''),
        zwei: null, titel: hSolo ? (hst.fertig ? P(hst.fertig.darts, 'Dart', 'Darts') + ' für die Runde' : 'Runde nicht beendet') : esc(pname(hg.winner)) + ' gewinnt die Jagd',
        sieger: hSolo ? null : hg.winner, pille: hSolo && hg.bestNeu ? '🏆 Bestwert ' + P(hg.bestNeu, 'Dart', 'Darts') : null,
        spieler: hg.players.map(function (id) { var r = hst.raus[id]; return { id: id, sub: hSolo ? P(hst.darts[id] || 0, 'Dart', 'Darts') : r ? 'gefangen' : hg.winner === id ? 'als Letzter übrig' : 'im Spiel' }; }),
        zeilen: hZeilen,
        seite: hSolo ? null : { titel: 'Fänge', eintraege: hFaenge.map(function (f, i) { return { n: (i + 1) + '.', wer: f.wer, text: f.text }; }) }
      };

    } else if (s.kind === 'kaiwen') {
      var kg = found.g;
      var kst = kaiwenState({ players: kg.players, versuche: kg.versuche || [] });
      var kSolo = kg.players.length < 2;
      d = {
        kind: 'Kaiwen · ' + (kSolo ? 'Solo' : 'Team'), archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(kg.at) + ' · ') + P(kst.versuche, 'Versuch', 'Versuche') + ' · ' + P(kst.checks, 'Check', 'Checks') + (kst.versuche ? ' (' + Math.round(kst.quote) + ' %)' : ''),
        zwei: null, titel: kg.rekordNeu ? 'Neuer Rekord: ' + kg.rekordNeu : 'Score ' + kst.hoechste, sieger: null,
        pille: kg.rekordNeu ? '🏆 Rekord' : '🔥 ' + kst.hoechste,
        spieler: kg.players.map(function (id) { var pbNeu = kg.pbNeu && kg.pbNeu[id]; var pb = pbNeu || kaiwenPB(id, kSolo); return { id: id, sub: 'PB ' + (pb === null ? '–' : pb) + (pbNeu ? ' neu' : '') }; }),
        zeilen: [
          { k: 'Checks', v: kg.players.map(function (id) { return String(kst.checksJe[id] || 0); }), besser: 'hi' },
          { k: 'Darts geworfen', v: kg.players.map(function (id) { return String(kst.dartsJe[id] || 0); }), besser: null },
          { k: 'PB ' + (kSolo ? 'Solo' : 'Team'), v: kg.players.map(function (id) { var pb = (kg.pbNeu && kg.pbNeu[id]) || kaiwenPB(id, kSolo); return pb === null ? '–' : String(pb); }), besser: 'hi' }
        ],
        seite: { titel: 'Versuche', eintraege: kst.verlauf.map(function (v, i) { return { n: 'V' + (i + 1), wer: null, wertext: String(v.zahl), text: v.check ? 'Check ✓' : 'daneben' }; }) }
      };

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
      var gespielt = (fg2.rounds || []).filter(function (rd) { return rd.sieger; });
      d = {
        kind: 'Finisher', archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(fg2.at) + ' · ') + P(gespielt.length, 'Runde', 'Runden') + ' · auf ' + fg2.ziel + ' Punkte · ' + P(fg2.players.length, 'Spieler', 'Spieler'),
        zwei: null, titel: esc(pname(fg2.winner)) + (fg2.players.length < 2 ? ' hat ausgemacht' : ' gewinnt'), sieger: fg2.players.length < 2 ? null : fg2.winner,
        pille: fg2.players.length < 2 ? '🎯 ausgemacht' : null,
        spieler: fg2.players.map(function (id) { return { id: id, sub: P(gewonnen[id], 'Punkt', 'Punkte') }; }),
        zeilen: [
          { k: 'Punkte', v: fg2.players.map(function (id) { return String(gewonnen[id]); }), besser: 'hi' },
          { k: 'Ø Darts je Finish', v: fg2.players.map(function (id) { return gewonnen[id] ? (dartsSum[id] / gewonnen[id]).toFixed(1) : '–'; }), besser: 'lo' },
          { k: 'Schnellstes Finish', v: fg2.players.map(function (id) { return best[id] === null ? '–' : P(best[id], 'Dart', 'Darts'); }), besser: 'lo' },
          { k: 'Höchste Zahl', v: fg2.players.map(function (id) { return hoch[id] ? String(hoch[id]) : '–'; }), besser: 'hi' }
        ],
        seite: { titel: 'Runden', eintraege: (fg2.rounds || []).map(function (rd, i) { return rd.sieger ? { n: 'R' + (i + 1), wer: rd.sieger, text: rd.zahl + ' · ' + P(rd.darts, 'Dart', 'Darts') } : null; }).filter(Boolean) }
      };

    } else {
      var rg = found.g;
      var rst = rtwState(rg);
      var rDurch = function (id) { return rg.winner === id || !!rst.finished[id]; };
      var rBis = function (id) { var t = rst.target[id]; return rDurch(id) ? 'Bull ✓' : (t === 25 ? 'Bull' : String(t)); };
      d = {
        kind: 'Round the World', archiv: !found.live, aktionen: spielAktionen(found.live),
        meta: (found.live ? '' : fmtDate(rg.at) + ' · ') + (rg.boost !== false ? 'Boost · ' : '') + (rg.winner ? P(rst.darts[rg.winner], 'Dart', 'Darts') + ' bis Bull · ' : '') + P(rg.players.length, 'Spieler', 'Spieler'),
        zwei: null, titel: esc(pname(rg.winner)) + (rg.players.length < 2 ? ' ist durch' : ' gewinnt'), sieger: rg.players.length < 2 ? null : rg.winner,
        pille: rg.players.length < 2 ? '🎯 durch' : null,
        spieler: rg.players.map(function (id) { return { id: id, sub: rDurch(id) ? 'Bull ✓' : 'bis ' + rBis(id) }; }),
        zeilen: [
          { k: 'Gekommen bis', v: rg.players.map(rBis), besser: null },
          { k: 'Darts', v: rg.players.map(function (id) { return String(rst.darts[id]); }), besser: null },
          { k: 'Treffer', v: rg.players.map(function (id) { return String(rst.hits[id]); }), besser: 'hi' },
          { k: 'Trefferquote', v: rg.players.map(function (id) { return rst.darts[id] ? Math.round(rst.hits[id] / rst.darts[id] * 100) + ' %' : '–'; }), besser: 'hi' }
        ],
        seite: { titel: 'Weg', eintraege: rg.players.map(function (id, i) { return { n: (i + 1) + '.', wer: id, text: (rDurch(id) ? 'durch' : 'bis ' + rBis(id)) + ' · ' + P(rst.darts[id], 'Dart', 'Darts') }; }) }
      };
    }

    var html = statistikHtml(d);
    $('summary-box').innerHTML = html.box;
    $('summary-actions').innerHTML = html.aktionen;
  }

  /* Highlights eines Turniers fuer den Sieger-Bildschirm: 180er, High-
     Finish, Bestes Leg, Hoechster Average - je mit Namen. */
  function turnierHighlights(ids, stMap) {
    var z = [], h180 = [], fin = null, leg = null, avg = null;
    ids.forEach(function (id) {
      var st = stMap[id];
      if (!st) return;
      if (st.s180 > 0) h180.push(esc(pname(id)) + (st.s180 > 1 ? ' ×' + st.s180 : ''));
      if (st.highCO > 0 && (!fin || st.highCO > fin.v)) fin = { v: st.highCO, id: id };
      if (st.bestLeg && (!leg || st.bestLeg < leg.v)) leg = { v: st.bestLeg, id: id };
      if (st.darts && (!avg || st.avg > avg.v)) avg = { v: st.avg, id: id };
    });
    if (h180.length) z.push(['180er', h180.join(' · ')]);
    if (fin) z.push(['High-Finish', fin.v + ' ' + esc(pname(fin.id))]);
    if (leg) z.push(['Bestes Leg', leg.v + ' Darts ' + esc(pname(leg.id))]);
    if (avg) z.push(['Höchster Ø', avg.v.toFixed(1) + ' ' + esc(pname(avg.id))]);
    return z;
  }
  function hlZeilen(liste) {
    return liste.length ? liste.map(function (z) { return '<div class="sg-hl"><span>' + z[0] + '</span><b>' + z[1] + '</b></div>'; }).join('')
      : '<p class="hint">Keine Highlights.</p>';
  }

  function renderWinner() {
    var abschluss = null;
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
      var wHl = legHighlights(S.matches, tourStart(), tourPlayers());
      var motd = function (ids, team, wir) {
        var b = manOfTheDay(ids, wStats);
        var hl = teamHighlights(ids, wHl).map(function (z) {
          var hm = /^<b>(.*?):<\/b>\s*(.*)$/.exec(z);
          return hm ? [hm[1], hm[2]] : ['', z];
        });
        /* Geteilt: alle Traeger nebeneinander, die Zeile sagt "je". */
        var traeger = b ? [b].concat(b.geteilt) : [];
        return '<div class="card motd' + (wir ? ' wir' : '') + '">' +
          '<div class="motd-team kt">' + esc(team) + ' · <span class="motd-titel">Man of the Day' + (b && b.geteilt.length ? ' – geteilt' : '') + '</span></div>' +
          (b ? '<div class="motd-person">' + traeger.map(function (t) { return avatarHTML(profile(t.id), 'lg'); }).join('') +
              '<div class="motd-wer"><div class="motd-name">' + traeger.map(function (t) { return esc(ligaName(t.id)); }).join(' & ') + '</div>' +
              '<div class="motd-zeile">' + (b.geteilt.length ? 'je ' : '') + plural(b.won, 'Sieg', 'Siege') + ' aus ' + plural(b.matches, 'Einzel', 'Einzeln') +
                (b.geteilt.length ? '' : ' · Ø ' + (b.darts ? b.avg.toFixed(1) : '–')) + '</div></div></div>' : '') +
          '<div class="sg-hl-liste">' + (hl.length ? hlZeilen(hl) : '<p class="hint">Keine Highlights.</p>') + '</div>' +
          '</div>';
      };
      /* Auch das Uebungsspiel geht weiter zum Spielbericht - als Testlauf
         vor dem Spieltag: Unterschriften, PDF und Mail wie am Abend selbst,
         nur vorbelegt mit der eigenen Adresse statt der Ligaleitung und
         ohne Mitteilung ans Team (Julius, 10.11.). */
      var offenBericht = !lw.abgeschlossen;
      $('winner-box').innerHTML =
        '<div class="sg-titel"><span class="sg-pokal">' + emoji + '</span><h1>' + titel + '</h1>' +
          '<p>' + (lw.uebung ? 'Übungsspiel' : lw.nr + '. Spieltag') + ' · ' + esc(LIGA.team) + ' gegen ' + esc(lw.gegner) +
            ' · Einzel ' + lwd.wirS + ':' + lwd.sieS + ' · Legs ' + lwd.wirL + ':' + lwd.sieL + '</p></div>' +
        '<div class="sg-koerper liga">' +
          '<div class="sg-stand"><span class="wir">' + esc(LIGA.team) + '</span><b>' + lwd.wirP + ' : ' + lwd.sieP + '</b><span class="sie">' + esc(lw.gegner) + '</span></div>' +
          '<div class="motd-paar">' + motd(lw.wir, LIGA.team, true) + motd(lw.sie, lw.gegner, false) + '</div>' +
        '</div>' +
        '<div class="sg-aktionen">' + (offenBericht
          ? '<div class="sg-knoepfe"><button class="btn ghost" data-action="liga-bericht">Spielbericht ansehen</button>' +
            '<button class="btn start-rot" data-action="liga-bericht">Weiter zum Spielbericht</button></div>' +
            '<p class="sg-hinweis">' + (lw.uebung
              ? 'Testlauf: Bericht ausfüllen, unterschreiben, verschicken – genau wie am Spieltag. Vorbelegt ist nur deine eigene Adresse, nichts geht an die Ligaleitung, die Adressen werden nicht gemerkt.'
              : 'Abgeschlossen ist das Ligaspiel, sobald der Bericht ausgefüllt, von beiden TCs unterschrieben und verschickt ist.') + '</p>'
          : '<div class="sg-knoepfe"><button class="btn ghost" data-action="to-tournament">Zur Übersicht</button>' +
            (lw.uebung ? '<button class="btn start-rot" data-action="finish-tournament">Übungsspiel abschließen</button>'
              : '<button class="btn ghost" data-action="liga-bericht">Spielbericht ansehen</button>' +
                '<button class="btn start-rot" data-action="finish-tournament">Ligaspiel abschließen</button>') + '</div>') +
        '</div>';
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
    var zeile = function (st) { return plural(st.won, 'Sieg', 'Siege') + ' · Legs ' + st.legsWon + ':' + st.legsLost; };
    var key = function (st) { return 'Ø ' + (st.avg ? st.avg.toFixed(1) : '–'); };
    /* Podest: Zweiter links, Erster in der Mitte und hoeher, Dritter rechts. */
    var podest = (table.length >= 3 ? [1, 0, 2] : [1, 0]).filter(function (i) { return table[i]; });
    var hoehe = table.length >= 3 ? ['78%', '100%', '64%'] : ['78%', '100%'];
    $('winner-box').innerHTML =
      '<div class="sg-titel"><span class="sg-pokal">🏆</span><h1>' + title + '</h1>' +
        '<p>' + plural(table[0].won, 'Spiel', 'Spiele') + ' von ' + seinePartien + ' gewonnen · ' + tourStart() + ' Double Out · ' +
          (tour().bestOf === 1 ? 'ein Leg' : 'Best of ' + tour().bestOf) + '</p></div>' +
      '<div class="sg-koerper">' +
        '<div class="sg-podest n' + podest.length + '">' + podest.map(function (idx, i) {
          var st = table[idx];
          return '<div class="sg-stufe' + (idx === 0 ? ' erster' : '') + '" style="--h:' + hoehe[i] + '">' +
            '<div class="sg-av">' + avatarHTML(profile(st.id), 'lg') + '<span class="sg-medal">' + medals[idx] + '</span></div>' +
            '<span class="sg-name">' + esc(st.name) + '</span>' +
            '<span class="sg-zeile">' + zeile(st) + '</span>' +
            '<span class="sg-key">' + key(st) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="card sg-endstand"><h2 class="kt">Endstand</h2><div class="sg-liste">' + table.map(function (st, i) {
          return '<div class="sg-row"><span class="sg-rang">' + (i + 1) + '.</span><span class="sg-nm">' + esc(st.name) + '</span>' +
            '<span class="sg-sub">' + zeile(st) + '</span><b>' + (st.avg ? st.avg.toFixed(1) : '–') + '</b></div>';
        }).join('') + '</div>' +
        '<h2 class="kt sg-abstand">Highlights</h2><div class="sg-hl-liste">' + hlZeilen(turnierHighlights(tourPlayers(), stats())) + '</div></div>' +
      '</div>' +
      '<div class="sg-aktionen"><div class="sg-knoepfe">' +
        '<button class="btn ghost" data-action="to-tournament">Zur Übersicht</button>' +
        '<button class="btn start-rot" data-action="finish-tournament">Turnier abschließen</button></div></div>';
  }

  /*
   * Dialog-Semantik und Fokus. #overlay traegt role="dialog" und aria-modal
   * im HTML; hier kommt dazu, was sich je Dialog aendert: die Ueberschrift
   * benennt ihn (aria-labelledby), der Rest der Seite ist waehrenddessen
   * inert (keine Tabs, keine Klicks dahinter), der Fokus geht beim Oeffnen
   * ins erste Feld oder auf den ersten Knopf und beim Schliessen zurueck
   * auf das Element, das den Dialog geoeffnet hat.
   *
   * render() zeichnet den offenen Dialog bei jeder Aenderung neu - der
   * Fokus wandert deshalb nur, wenn ein ANDERES Dialog-Objekt aufgeht,
   * nicht bei jedem Neuzeichnen desselben.
   *
   * Dialoge mit eigener Tastenwahl (Leg-Ende, Spielende, Checkout-Frage:
   * Ziffern und Pfeile waehlen, Enter bestaetigt) bekommen den Fokus auf
   * die Karte selbst statt auf einen Knopf - sonst drueckte Enter den
   * fokussierten Knopf UND die Tastenwahl.
   */
  var dialogOffen = null;        // das UI.overlay-Objekt, das zuletzt gezeichnet wurde
  var dialogRueckFokus = null;   // Element, das vor dem Oeffnen den Fokus hatte
  var HAUPTBEREICHE = '#nav, .screen, #save-warning, #sync-status, #lade-hinweis';
  function hintergrundInert(an) {
    var teile = document.querySelectorAll(HAUPTBEREICHE);
    for (var i = 0; i < teile.length; i++) {
      if (an) teile[i].setAttribute('inert', ''); else teile[i].removeAttribute('inert');
    }
  }
  function dialogBeschriften(ov, karte) {
    var kopf = karte.querySelector('h1, h2, h3, h4');
    if (kopf) {
      if (!kopf.id) kopf.id = 'overlay-titel';
      ov.setAttribute('aria-labelledby', kopf.id);
      ov.removeAttribute('aria-label');
    } else {
      ov.removeAttribute('aria-labelledby');
      ov.setAttribute('aria-label', 'Dialog');
    }
  }
  function dialogFokusHinein(karte, typ) {
    /* Am Touch-Geraet kein Textfeld vorab fokussieren: iOS klappt sonst bei
       jedem Dialog die Tastatur aus (Nachmeldung, Versand, Aufstellung).
       Dort reicht der Fokus auf der Karte fuer Esc und Vorlese-Reihenfolge. */
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var ziel = touch ? null : karte.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (!ziel && !touch && !(PFEIL_DIALOGE[typ] || typ === 'checkout-darts')) {
      ziel = karte.querySelector('.btn.primary:not([disabled])') || karte.querySelector('button:not([disabled]), [role="button"], [tabindex="0"]');
    }
    if (!ziel) { karte.setAttribute('tabindex', '-1'); ziel = karte; }
    if (ziel.focus) ziel.focus({ preventScroll: true });
  }
  function dialogGeoeffnet(ov, karte, o) {
    dialogBeschriften(ov, karte);
    if (dialogOffen === o) return;
    var ersterAuf = !dialogOffen;
    dialogOffen = o;
    feierAbbrechen();
    if (ersterAuf) {
      var aktiv = document.activeElement;
      dialogRueckFokus = aktiv && aktiv !== document.body && !ov.contains(aktiv) ? aktiv : null;
      hintergrundInert(true);
    }
    dialogFokusHinein(karte, o.type);
  }
  function dialogGeschlossen() {
    if (!dialogOffen) return;
    dialogOffen = null;
    hintergrundInert(false);
    var zurueck = dialogRueckFokus;
    dialogRueckFokus = null;
    /* Der Knopf von vorhin kann weggezeichnet sein (render baut die
       Bildschirme neu) - dann bleibt der Fokus, wo der Browser ihn laesst. */
    if (zurueck && zurueck.focus && document.contains(zurueck)) zurueck.focus({ preventScroll: true });
  }
  /* Die Spielmenues (role="dialog" im HTML) genauso: beim Aufgehen hinein,
     beim Zugehen zurueck. */
  var menueWarOffen = false, menueRueckFokus = null;
  function menueFokus(el) {
    var auf = !el.classList.contains('hidden');
    if (auf === menueWarOffen) return;
    menueWarOffen = auf;
    if (auf) {
      var aktiv = document.activeElement;
      menueRueckFokus = aktiv && aktiv !== document.body && !el.contains(aktiv) ? aktiv : null;
      var ziel = el.querySelector('button:not([disabled]), [role="button"]');
      if (ziel) ziel.focus({ preventScroll: true });
    } else {
      var zurueck = menueRueckFokus;
      menueRueckFokus = null;
      if (zurueck && zurueck.focus && document.contains(zurueck)) zurueck.focus({ preventScroll: true });
    }
  }

  function renderOverlay() {
    var ov = $('overlay');
    if (!UI.overlay) { ov.classList.add('hidden'); ov.classList.remove('gross', 'vollbild'); dialogGeschlossen(); return; }
    ov.classList.remove('hidden');
    /* Im Turnier-Modus sprechen auch die Dialoge Plakatsprache - der
       Schreiber steht vorn an der Scheibe, gelesen wird vom Oche aus. */
    ov.classList.toggle('gross', UI.turnier && turnierErlaubt() && S.screen === 'game');
    /* Der Start eines Ligaspiels oder Uebungsspiels ist kein Zwischendialog,
       sondern ein eigener Bildschirm: Vollbild im App-Hintergrund. */
    ov.classList.toggle('vollbild', !!VOLLBILD_DIALOGE[UI.overlay.type]);
    ov.classList.toggle('bogen', !!BOGEN_DIALOGE[UI.overlay.type] || (UI.overlay.type === 'confirm-reset' && !!(S.tour && S.tour.liga)));
    ov.classList.toggle('bogen-breit', UI.overlay.type === 'liga-bericht-kurz');
    var o = UI.overlay;
    var html = '';

    if (o.type === 'checkout-darts') {
      var coWahl = (UI.turnier && turnierErlaubt()) || (o.kw && UI.kwFern) ? Math.min(o.wahl || 0, o.options.length - 1) : -1;
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
    } else if (o.type === 'checkout-doppel') {
      var cdKnopf = function (d, kl) { return '<button class="' + kl + '" data-action="co-doppel" data-d="' + d + '">' + doppelName(d) + '</button>'; };
      html = '<h3>Welches Doppel?</h3><p>' + o.rest + ' Rest mit ' + plural(o.n, 'Dart', 'Darts') + ' zugemacht – auf welchem Doppel?</p>' +
        (o.logisch.length ? '<div class="row-btns cd-logisch">' + o.logisch.map(function (d) { return cdKnopf(d, 'btn primary'); }).join('') + '</div>' : '') +
        (o.andere.length ? '<div class="cd-andere">' + o.andere.map(function (d) { return cdKnopf(d, 'btn ghost small'); }).join('') + '</div>' : '') +
        '<button class="btn ghost full" data-action="co-doppel" data-d="0">Weiß nicht</button>';
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
      /* Das eben beendete Leg: das letzte mit Sieger. */
      var ldLeg = m1.legs.filter(function (l) { return l.winner; }).pop();
      if (m1.session) {
        /* Session (allein): das Leg ist durch, das naechste laeuft schon.
           Die Zahlen des Legs und der ganzen Session; der Dialog bleibt, bis
           er weggetippt wird (Julius, 09.11.: kein Zeitlimit), und beenden
           laesst sich die Session hier wie im Menue. */
        var ssLegs = m1.legs.filter(function (l) { return l.winner; }).length;
        var ssDarts = ldLeg ? dartsInLeg(ldLeg, m1.p[0]) : 0;
        html = '<div class="big-emoji">🎯</div><h3>Leg ' + ssLegs + ' in ' + ssDarts + ' Darts</h3>' +
          '<p>Session · ' + plural(ssLegs, 'Leg', 'Legs') + ' gespielt · das nächste läuft</p>' +
          sessionKachelnHTML(m1, 'dialog') +
          '<button class="' + ldKl(0, 'btn primary full') + '" data-action="ov-next-leg">Weiter</button>' +
          '<button class="' + ldKl(1, 'btn ghost full') + '" data-action="undo">Eingabe rückgängig</button>' +
          '<button class="' + ldKl(2, 'btn ghost full') + '" data-action="session-ende">Session beenden</button>' +
          (ldWahl >= 0 ? '<p class="te-hint">8 / 2 · wählen &nbsp;&nbsp; Enter · bestätigen &nbsp;&nbsp; Löschen · direkt zurück</p>' : '');
      } else
      html = '<div class="big-emoji">🎯</div><h3>' + (o.satz ? 'Satz' : 'Leg') + ' an ' + esc(pname(o.pid)) + '</h3>' +
        '<p>Stand: ' + ldStand + '</p>' +
        legStatHTML(m1, ldLeg) +
        '<button class="' + ldKl(0, 'btn primary full') + '" data-action="ov-next-leg">' + (o.satz ? 'Nächster Satz' : 'Nächstes Leg') + '</button>' +
        '<button class="' + ldKl(1, 'btn ghost full') + '" data-action="undo">Eingabe rückgängig</button>' +
        (ldUeb ? '<button class="' + ldKl(2, 'btn ghost full') + '" data-action="to-tournament">' +
          (S.tour && S.tour.liga ? 'Zur Ligaspiel-Übersicht' : 'Zur Turnierübersicht') + '</button>'
          : legDoneDritte(m1) === 'spiel-ende' ? '<button class="' + ldKl(2, 'btn ghost full') + '" data-action="spiel-ende">Spiel beenden &amp; speichern</button>' : '') +
        (ldWahl >= 0 ? '<p class="te-hint">8 / 2 · wählen &nbsp;&nbsp; Enter · bestätigen &nbsp;&nbsp; Löschen · direkt zurück</p>' : '');
    } else if (o.type === 'match-done') {
      var m2 = currentMatch();
      var last = !nextOpenMatch();
      html = '<div class="big-emoji">🏅</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + esc(pname(m2.p[0])) + ' ' + legsWon(m2, m2.p[0]) + ':' + legsWon(m2, m2.p[1]) + ' ' + esc(pname(m2.p[1])) + '</p>' +
        legStatHTML(m2, m2.legs.filter(function (l) { return l.winner; }).pop()) +
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
    } else if (o.type === 'finish') {
      html = finishDialogHtml(o);
    } else if (o.type === 'nachmeldung') {
      var nq = ligaBerichtQuelle();
      var nHeimTeam = nq ? (nq.liga.heim ? LIGA.team : nq.liga.gegner) : 'Heim';
      var nGastTeam = nq ? (nq.liga.heim ? nq.liga.gegner : LIGA.team) : 'Gast';
      var nd = o.draft;
      var nWahl = function (feld, wert, text) {
        return '<button data-action="nm-wahl" data-feld="' + feld + '" data-value="' + wert + '" class="' +
          (nd[feld] === wert ? 'active' : '') + '">' + text + '</button>';
      };
      var nListe = nq ? ((nd.team === 'H' ? nq.liga.heimSpieler : nq.liga.gastSpieler) || []) : [];
      var nIdx = nd.id ? nListe.indexOf(nd.id) : -1;
      var nInfo = nIdx >= 0 ? 'steht als ' + nd.team + (nIdx + 1) + ' auf dem Bogen · ' + nListe.length + ' von 8 Plätzen belegt'
        : nListe.length >= 8 ? 'Alle 8 Plätze belegt'
        : 'wird ' + nd.team + (nListe.length + 1) + ' · ' + nListe.length + ' von 8 Plätzen belegt';
      /* Nach einem spontanen Wechsel steht das Team fest - sonst landete
         dieselbe Person in beiden Teams. */
      var nTeam = nd.teamFest
        ? '<div class="dl-segment"><button type="button" class="active" disabled>' +
            (nd.team === 'H' ? 'Heim · ' + esc(nHeimTeam) : 'Gast · ' + esc(nGastTeam)) + '</button></div>'
        : '<div class="dl-segment">' + nWahl('team', 'H', 'Heim · ' + esc(nHeimTeam)) + nWahl('team', 'G', 'Gast · ' + esc(nGastTeam)) + '</div>';
      html = '<div class="dl-kopf"><h3>Spieler nachmelden</h3>' +
        '<p>' + (nd.start
          ? 'Beim Start als <b>neu melden</b> eingetragen: Mit der Unterschrift kommt die Person auf Seite 2 des Spielberichts. ' +
            '„Später“ geht – spätestens vor den Unterschriften der Teamcaptains muss sie nachgemeldet sein. '
          : 'Für Spieler, die spontan einspringen und noch nie gemeldet waren. Mit Name und Unterschrift kommen sie ' +
            'auf den Spielbericht (H5 bis H8 bzw. G5 bis G8) und sind danach beim Wechsel wählbar. ') +
          'Gebühr: 10 € (U18: 2 €) innerhalb von 14 Tagen.</p></div>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        '<div class="dl-spalten">' +
          '<div class="dl-spalte"><div class="kt">Team</div>' +
            nTeam +
            '<div class="kt">Name</div>' +
            '<input class="dl-input" data-role="nm-vor" maxlength="30" autocomplete="off" value="' + esc(nd.vor) + '" placeholder="Vorname">' +
            '<input class="dl-input" data-role="nm-nach" maxlength="30" autocomplete="off" value="' + esc(nd.nach) + '" placeholder="Nachname">' +
          '</div>' +
          '<div class="dl-spalte"><div class="kt">Unter 18?</div>' +
            '<div class="dl-segment">' + nWahl('u18', 'nein', 'Nein') + nWahl('u18', 'ja', 'Ja') + '</div>' +
            '<div class="kt">Geschlecht</div>' +
            '<div class="dl-segment">' + nWahl('g', 'w', 'w') + nWahl('g', 'm', 'm') + nWahl('g', 'd', 'd') + '</div>' +
            '<p class="dl-info">' + nInfo + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="dl-sig"><div class="dl-sig-kopf"><span class="kt">Unterschrift Spieler</span>' +
          '<button type="button" class="dl-link" data-action="signatur-nochmal">Löschen</button></div>' +
          '<canvas id="signatur" class="signatur" aria-label="Unterschriftsfeld"></canvas>' +
          '<p class="dl-note">Mit der Unterschrift erkennt die Person die SWO und das Datenschutz-Merkblatt der SDM an.</p></div>' +
        '<div class="dl-fuss">' + (nd.wechsel
          ? '<button class="btn ghost" data-action="nm-abbrechen">Wechsel zurücknehmen</button>'
          : '<button class="btn ghost" data-action="ov-cancel">' + (nd.start ? 'Später' : 'Abbrechen') + '</button>') +
        '<button class="btn hell" data-action="nm-weiter">Nachmelden</button></div>';
    } else if (o.type === 'bericht-versand') {
      html = '<h3>Spielbericht versenden' + (o.uebung ? ' · Testlauf' : '') + '</h3>' +
        '<p>' + (o.uebung ? 'Übungsspiel: Die Mail geht nur an die Adressen hier – vorbelegt ist deine eigene, die Ligaleitung bleibt außen vor.'
          : 'Beide Unterschriften sind drin. Unsere Teamcaptains und die Ligaleitung stehen fest; die Adresse des gegnerischen TC merkt sich die App je Team.') + '</p>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        '<div class="liga-start">' + o.adressen.map(function (a, i) {
          var rolle = (o.rollen || [])[i] || (i === 0 ? (o.uebung ? 'deine Adresse' : 'Ligaleitung') : i === 1 ? 'TC Gast' : 'weitere Adresse');
          return '<label class="ls-mail"><small>' + esc(rolle) + (o.rollen && !o.uebung && i < 3 ? ' <em>fest</em>' : '') + '</small>' +
            '<input type="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
            'data-role="bericht-mail" data-i="' + i + '" value="' + esc(a) + '" ' +
            'placeholder="' + esc(rolle) + '"></label>';
        }).join('') + '</div>' +
        (o.laedt ? '<p class="hint">Hole die gemerkten Adressen vom Server …</p>' : '') +
        (!o.ohneServer && window.DartKonto && window.DartKonto.nutzer() && window.DartKonto.mailBereit && window.DartKonto.mailBereit()
          ? '<p class="hint">Der Server schickt die Mail mit dem PDF von <b>blink180@wirtschaftln.de</b>, eine Kopie geht ins Blink-Postfach.</p>'
          : '<p class="hint">Beim Senden öffnet sich das Teilen-Menü mit dem PDF. Dort <b>Mail</b> wählen. ' +
            'Die Adressen sind dann schon kopiert: ins Feld „An“ tippen und <b>Einfügen</b>.</p>') +
        '<div class="row-btns two">' +
          '<button class="btn ghost" data-action="ov-cancel"' + (o.sendet ? ' disabled' : '') + '>Abbrechen</button>' +
          '<button class="btn primary start" data-action="bericht-senden"' + (o.sendet ? ' disabled' : '') + '>' + (o.sendet ? 'Sendet …' : 'Senden') + '</button>' +
        '</div>' +
        (!o.ohneServer && window.DartKonto && window.DartKonto.nutzer() && window.DartKonto.mailBereit && window.DartKonto.mailBereit()
          ? '<button class="btn ghost full" data-action="bericht-senden-teilen">Stattdessen über das Teilen-Menü</button>' : '') +
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
    } else if (o.type === 'liga-runde') {
      var lrT = LIGA.termine.filter(function (x) { return x.id === o.termin; })[0];
      html = !lrT ? '<p>Dazu liegt nichts vor.</p>' :
        '<h3 class="lp-titel">' + lrT.nr + '. Spieltag <span>· alle Spiele</span></h3>' +
        '<p class="lp-sub">' + (lrT.tag ? fmtDate(new Date(lrT.tag + 'T12:00:00').getTime()) : '') + ' · ' + esc(LIGA.saison) + '</p>' +
        ligaRundeHtml(lrT, ligaTerminEintrag(lrT)) +
        '<button class="btn primary full" data-action="ov-cancel">Schließen</button>';
    } else if (o.type === 'liga-bericht-kurz') {
      var bkLg = S.tour && S.tour.liga;
      if (!bkLg) { UI.overlay = null; ov.classList.add('hidden'); return; }
      var bkd = ligaStandDaten();
      var bkZeile = function (k, v) { return '<div class="dl-summe"><span>' + k + '</span><b>' + v + '</b></div>'; };
      html = '<div class="dl-kopf dl-bericht-kopf"><div><h3>Spielbericht</h3>' +
          '<p>5. Liga · ' + (bkLg.uebung ? 'Übungsspiel' : bkLg.nr + '. Spieltag') + ' · ' + (bkLg.heim ? 'Heim' : 'Auswärts') + ' · 20:00 Uhr</p></div>' +
          '<div class="dl-stand"><span>' + esc(LIGA.team) + '</span><b>' + bkd.wirP + ' : ' + bkd.sieP + '</b><span class="g">' + esc(bkLg.gegner) + '</span></div></div>' +
        '<div class="dl-bericht-spalten"><div class="dl-einzel-liste"><div class="kt">Einzel</div>' +
          S.matches.map(function (m) {
            var score = m.kampflos ? (m.winner === m.p[0] ? legsToWin() + ':0' : '0:' + legsToWin()) + ' w.o.'
              : m.legs.length ? legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) : '–:–';
            var pp = m.posPaar || [0, 0];
            return '<div class="dl-einzel' + (m.void ? ' void' : '') + '">' +
              '<span class="dl-k h">H' + (pp[0] + 1) + '</span>' +
              '<span class="n' + (m.winner === m.p[0] ? ' sieg' : m.done ? ' verlor' : '') + '">' + esc(ligaName(m.p[0])) + '</span>' +
              '<b>' + score + '</b>' +
              '<span class="n r' + (m.winner === m.p[1] ? ' sieg' : m.done ? ' verlor' : '') + '">' + esc(ligaName(m.p[1])) + '</span>' +
              '<span class="dl-k g r">G' + (pp[1] + 1) + '</span></div>';
          }).join('') + '</div>' +
          '<div class="dl-bericht-rechts"><div class="kt">Summe</div>' +
            bkZeile('Punkte', bkd.wirP + ' : ' + bkd.sieP) + bkZeile('Einzel', bkd.wirS + ' : ' + bkd.sieS) +
            bkZeile('Legs', bkd.wirL + ' : ' + bkd.sieL) + bkZeile('Gespielt', bkd.fertige + ' von ' + S.matches.length) +
            '<div class="kt dl-abstand">Highlights</div>' +
            (bkd.hl.length ? bkd.hl.map(function (z) {
              var hm = /^<b>(.*?):<\/b>\s*(.*)$/.exec(z);
              return '<div class="dl-hl"><span>' + (hm ? hm[1] : '') + '</span><b>' + (hm ? hm[2] : z) + '</b></div>';
            }).join('') : '<p class="dl-note">Noch keine: 180er, High-Finishes ab 100 und Shortlegs bis 21 Darts.</p>') +
          '</div></div>' +
        '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Schließen</button>' +
        '<button class="btn ghost" data-action="liga-bericht-teilen">Teilen</button>' +
        '<button class="btn hell" data-action="liga-bericht">Bogen und PDF</button></div>';
    } else if (o.type === 'liga-partien') {
      var lpSp = (LIGA_SPIELTAGE[o.termin] || [])[o.i];
      var lpT = LIGA.termine.filter(function (x) { return x.id === o.termin; })[0];
      var lpName = function (n) {
        return String(n).charAt(0) === '*' ? esc(n.slice(1)) + ' <small class="gast-marke">Gast</small>' : esc(n);
      };
      html = !lpSp ? '<p>Dazu liegt nichts vor.</p>' :
        '<h3 class="lp-titel">' + esc(lpSp.heim) + ' <span>–</span> ' + esc(lpSp.gast) + '</h3>' +
        '<p class="lp-sub">' + (lpT ? lpT.nr + '. Spieltag · ' : '') + (lpSp.tag ? fmtDate(new Date(lpSp.tag + 'T12:00:00').getTime()) : '') + (lpSp.ort ? ' · ' + esc(lpSp.ort) : '') + '</p>' +
        '<div class="lp-stand"><b>' + esc(lpSp.einzel || '–') + '</b><span>Einzel · Legs ' + esc(lpSp.legs || '–') + '</span></div>' +
        '<table class="lp-tab"><thead><tr><th>' + esc(lpSp.heim) + '</th><th></th><th>' + esc(lpSp.gast) + '</th></tr></thead><tbody>' +
          (lpSp.partien || []).map(function (p) {
            return '<tr><td class="' + (p[2] > p[3] ? 'sieg' : '') + '">' + lpName(p[0]) + '</td>' +
              '<td class="lp-erg">' + p[2] + ' : ' + p[3] + '</td>' +
              '<td class="' + (p[3] > p[2] ? 'sieg' : '') + '">' + lpName(p[1]) + '</td></tr>';
          }).join('') + '</tbody></table>' +
        (lpSp.highlights && lpSp.highlights.length
          ? '<div class="lp-hl"><span class="lk-crew-titel">Highlights</span>' +
            lpSp.highlights.map(function (x) { return '<div class="lp-hl-zeile"><span>' + esc(x.wer) + ' <small>' + esc(x.team) + '</small></span><b>' + esc(x.was) + '</b></div>'; }).join('') + '</div>'
          : '') +
        '<button class="btn primary full" data-action="ov-cancel">Schließen</button>';
    } else if (o.type === 'liga-team-info') {
      /* Ein Team der Liga: Lokal mit Adresse, Spielerliste (TC = Team-
         Captain) und alle Spiele der Saison; gespielte oeffnen die Einzel. */
      var tiName = o.team;
      var ti = (window.LIGA_DATEN.teamInfo || {})[tiName] || {};
      var tiSpiele = [];
      LIGA.termine.forEach(function (t) {
        (LIGA_SPIELTAGE[t.id] || []).forEach(function (sp, i) {
          if (!sp.gast || (sp.heim !== tiName && sp.gast !== tiName)) return;
          tiSpiele.push({ t: t, i: i, sp: sp });
        });
      });
      var tiZeile = function (x) {
        var daheim = x.sp.heim === tiName;
        var gegner = daheim ? x.sp.gast : x.sp.heim;
        var tipp = x.sp.partien && x.sp.partien.length ? ' data-action="liga-partien" data-termin="' + esc(x.t.id) + '" data-i="' + x.i + '" role="button" tabindex="0"' : '';
        var rechts = x.sp.verschoben ? '<span class="lr-erg verschoben">verschoben</span>'
          : x.sp.einzel ? '<span class="lr-erg"><b>' + esc(x.sp.einzel) + '</b><small>' + esc(x.sp.legs || '') + '</small></span>'
          : '<span class="lr-erg">' + (x.sp.tag ? esc(x.sp.tag.slice(8, 10) + '.' + x.sp.tag.slice(5, 7) + '.') : '–') + '</span>';
        return '<div class="lr-zeile' + (gegner === LIGA.team ? ' wir' : '') + (tipp ? ' tap' : '') + '"' + tipp + '>' +
          '<span class="lr-teams"><small class="ti-nr">' + x.t.nr + '</small>' + (daheim ? '' : '<i>@</i>') + esc(gegner) + '</span>' + rechts + '</div>';
      };
      html = '<h3 class="lp-titel">' + esc(tiName) + '</h3>' +
        '<p class="lp-sub">' + (ti.lokal ? esc(ti.lokal) + (ti.adresse ? ' · ' + esc(ti.adresse) : '') : 'Lokal nicht bekannt') + '</p>' +
        '<span class="ti-titel">Spieler</span>' +
        (ti.spieler && ti.spieler.length
          ? '<ul class="ti-spieler">' + ti.spieler.map(function (p) {
              var gast = String(p.name).charAt(0) === '*';
              return '<li>' + esc(gast ? p.name.slice(1) : p.name) + (p.info ? '<small>' + esc(p.info) + '</small>' : '') + (gast ? '<small class="gast-marke">Gast</small>' : '') + '</li>';
            }).join('') + '</ul>'
          : '<p class="hint">Keine Spielerliste.</p>') +
        '<span class="ti-titel">Spiele</span><div class="ti-spiele">' + tiSpiele.map(tiZeile).join('') + '</div>' +
        '<button class="btn primary full" data-action="ov-cancel">Schließen</button>';
    } else if (o.type === 'mitteilungen') {
      /* Benachrichtigungen: je Thema Push und Mail, nur Push oder aus. Die
         Daten laedt js/auth.js (GET /api/mitteilungen), bis dahin "laedt". */
      var ms = window.DartKonto && window.DartKonto.mitteilungenStand ? window.DartKonto.mitteilungenStand() : null;
      var msMail = window.DartKonto && window.DartKonto.nutzer() ? window.DartKonto.nutzer().email : '';
      if (!ms) {
        html = '<h3>Benachrichtigungen</h3><p class="hint">Lade …</p><button class="btn ghost full" data-action="ov-cancel">Schließen</button>';
      } else {
        var kanalName = { beide: 'Push + Mail', push: 'nur Push', aus: 'aus' };
        var pushZeile = !ms.push ? 'Push ist auf dem Server nicht eingerichtet.'
          : !ms.pushMoeglich ? 'Dieses Gerät kann keine Push-Mitteilungen – am iPhone die App vom Home-Bildschirm öffnen.'
          : ms.pushHier ? 'Push ist auf diesem Gerät an.' : 'Push ist auf diesem Gerät noch aus.';
        html = '<h3>Benachrichtigungen</h3>' +
          '<p class="hint">' + esc(pushZeile) + ' ' + (ms.mail ? 'Mails gehen an ' + esc(msMail) + '.' : 'Mails sind auf dem Server nicht eingerichtet.') + '</p>' +
          (ms.push && ms.pushMoeglich
            ? '<button class="btn ' + (ms.pushHier ? 'ghost' : 'primary') + ' full" data-action="' + (ms.pushHier ? 'konto-push-aus' : 'konto-push-an') + '">' +
              (ms.pushHier ? 'Push auf diesem Gerät ausschalten' : 'Push auf diesem Gerät einschalten') + '</button>'
            : '') +
          '<div class="mt-liste">' + (ms.themen || []).map(function (t) {
            var k = (ms.einstellungen && ms.einstellungen[t.id]) || t.standard;
            return '<div class="mt-zeile"><div class="mt-text"><b>' + esc(t.titel) + '</b><small>' + esc(t.text) + '</small></div>' +
              (t.fest ? '<span class="mt-fest">immer per Mail</span>'
                : '<div class="mt-kanaele">' + ['beide', 'push', 'aus'].map(function (kk) {
                    return '<button class="mt-kanal' + (k === kk ? ' active' : '') + '" data-action="konto-mitteilung-kanal" data-thema="' + esc(t.id) + '" data-kanal="' + kk + '">' + kanalName[kk] + '</button>';
                  }).join('') + '</div>') +
              '</div>';
          }).join('') + '</div>' +
          (o.meldung ? '<p class="hint mt-meldung" role="status">' + esc(o.meldung) + '</p>' : '') +
          '<button class="btn ghost full" data-action="ov-cancel">Schließen</button>';
      }
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
            /* "Anderer Name": jemand ohne Konto - Gastspieler oder neu zu
               melden - mit Vor- und Nachname darunter (Julius, 11.11.). */
            var ltName = ld.wir[i] === '__name';
            var ltN = (ld.wirNamen || [])[i] || {};
            return '<div class="ls-zeile"><span>' + (i + 1) + '</span>' +
              '<select data-role="liga-pos" data-i="' + i + '">' +
              ltProfile.map(function (p) {
                return '<option value="' + p.id + '"' + (ld.wir[i] === p.id ? ' selected' : '') + '>' +
                  esc(p.name) + '</option>';
              }).join('') +
              '<option value="__name"' + (ltName ? ' selected' : '') + '>Anderer Name (Gast oder neu) …</option>' +
              '</select>' + ligaTypKnopfHtml('wir', i, (ld.wirTyp || [])[i]) + '</div>' +
              (ltName
                ? '<div class="ls-zeile ls-unter"><span></span><span class="namen-paar">' +
                  '<input data-role="liga-wir-vor" data-i="' + i + '" maxlength="30" autocomplete="off" value="' + esc(ltN.vor || '') + '" placeholder="Vorname">' +
                  '<input data-role="liga-wir-nach" data-i="' + i + '" maxlength="30" autocomplete="off" value="' + esc(ltN.nach || '') + '" placeholder="Nachname">' +
                  '</span></div>'
                : '');
          }).join('') +
          '<p class="hint">Status antippen: <b>gemeldet</b> → <b>Gastspieler</b> (nicht gemeldet; höchstens einer je Team und Spiel, ab dem dritten Einsatz nachmelden) → ' +
            '<b>neu melden</b> (Nachmeldung mit Unterschrift gleich nach dem Start, 10 €, U18 2 €). Gilt für beide Teams.</p>' +
          ligaGegnerFelderHtml(ltGegner, ld) +
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
          '<div class="ls-titel">Mitschreiben</div>' +
          '<div class="options">' +
            '<button data-action="liga-mitschreiben" data-value="0" class="' + (ld.nurErgebnis ? '' : 'active') + '">in der App</button>' +
            '<button data-action="liga-mitschreiben" data-value="1" class="' + (ld.nurErgebnis ? 'active' : '') + '">nur Ergebnisse</button>' +
          '</div>' +
          '<p class="hint">Nur Ergebnisse: Der Gegner zählt mit seinem System, wir tragen je Einzel nur ' +
            'den Leg-Stand ein – Siege und Legs zählen, Average und Highlights gibt es dann nicht.</p>' +
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
        '<button class="btn primary start" data-action="liga-los">' + (ld.nachtrag ? 'Ergebnisse eintragen' : 'GAME ON!') + '</button></div>';
    } else if (o.type === 'uebung-start') {
      var ud = o.draft;
      var uProfile = activeProfiles();
      var uKannTeilen = !!(window.DartSync && window.DartSync.turnier && window.DartKonto && window.DartKonto.nutzer());
      /* Probelauf: der naechste Gegner laut Spielplan mit seinem Kader -
         Gaeste wie am Spieltag, Ausbullen, beide Scheiben, Koppeln, Bericht
         und Mail nur an sich selbst. Zum Ueben des Ablaufs (Julius, 10.11.). */
      var uTermin = ligaNaechsterTermin();
      var uGegnerTeam = uTermin ? (uTermin.heim === LIGA.team ? uTermin.gast : uTermin.heim) : '';
      if (ud.modus === 'liga' && !uTermin) ud.modus = 'mittel';
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
            (uTermin ? ['liga', 'team', 'leicht', 'mittel', 'schwer'] : ['team', 'leicht', 'mittel', 'schwer']).map(function (g) {
              var txt = g === 'liga' ? esc(uGegnerTeam) + '<small>Probelauf · ' + uTermin.nr + '. Spieltag</small>' : g === 'team' ? 'Team B' : 'Bots ' + g;
              return '<button data-action="uebung-gegner" data-value="' + g + '" class="' +
                (ud.modus === g ? 'active' : '') + (g === 'liga' ? ' breit' : '') + '">' + txt + '</button>';
            }).join('') +
          '</div>' +
          (ud.modus === 'liga'
            ? '<p class="hint">Probelauf wie am Spieltag: Gäste aus dem Kader, Ausbullen, beide Scheiben, auf Wunsch geteilt an zwei iPads – danach Bericht, Unterschriften und Mail nur an dich. Zählt nirgends.</p>'
            : '') +
          '<div class="ls-titel">' + (ud.modus === 'liga' ? esc(LIGA.team) + ' – unsere Positionen' : 'Team A') + '</div>' +
          [0, 1, 2, 3].map(function (i) { return uSelect('liga-pos', ud.wir, i); }).join('') +
          (ud.modus === 'team'
            ? '<div class="ls-titel">Team B</div>' +
              [0, 1, 2, 3].map(function (i) { return uSelect('uebung-sie', ud.sie, i); }).join('')
            : ud.modus === 'liga'
              ? ligaGegnerFelderHtml(uGegnerTeam, ud)
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
          (uKannTeilen && (ud.modus === 'team' || ud.modus === 'liga')
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
              esc(ligaName(kfMatch.p[1])) + ' fehlt</button>' +
            /* Gespielt, aber nicht hier mitgeschrieben (der Gegner hat
               gezaehlt): dann nur den Leg-Stand eintragen. */
            '<button class="btn ghost full" data-action="liga-ergebnis" data-id="' + esc(kfMatch.id) + '">Nur das Ergebnis eintragen</button>') +
        '<button class="btn ghost full" data-action="ov-cancel">Abbrechen</button>';
    } else if (o.type === 'liga-ergebnis') {
      /* Modus "Nur Ergebnisse" (oder ein Einzel, das der Gegner gezaehlt
         hat): der Leg-Stand des Einzels, Heim : Gast, ohne einen Wurf.
         Jede moegliche Endstellung ist ein Knopf, der Sieger steht klein
         darunter. */
      var leM = matchById(o.id);
      if (!leM) { UI.overlay = null; ov.classList.add('hidden'); return; }
      var leWin = legsToWin();
      var leA = ligaName(leM.p[0]), leB = ligaName(leM.p[1]);
      var leVar = [];
      for (var lv = 0; lv < leWin; lv++) leVar.push([leWin, lv]);
      for (var lw2 = leWin - 1; lw2 >= 0; lw2--) leVar.push([lw2, leWin]);
      var leJetzt = leM.ergebnis && leM.done ? legsWon(leM, leM.p[0]) + ':' + legsWon(leM, leM.p[1]) : null;
      var leFest = !!(leM.done && geteiltesTurnier());
      html = '<h3>' + (leJetzt ? 'Ergebnis ändern' : 'Ergebnis eintragen') + '</h3>' +
        '<p class="lerg-paar">' +
          (leM.posPaar ? '<span class="posmark h">H' + (leM.posPaar[0] + 1) + '</span> ' : '') + esc(leA) +
          ' <span class="muted">vs</span> ' +
          (leM.posPaar ? '<span class="posmark g">G' + (leM.posPaar[1] + 1) + '</span> ' : '') + esc(leB) + '</p>' +
        (leFest
          ? '<p class="hint">Im geteilten Spiel lässt sich ein eingetragenes Ergebnis nicht mehr ändern – ' +
            'das andere Gerät hat es bereits übernommen.</p>'
          : '<p class="hint">Legs Heim : Gast, wie auf dem Bogen – ohne Würfe, also ohne Average.</p>' +
            '<div class="lerg-grid">' + leVar.map(function (v) {
              var sieger = v[0] > v[1] ? leA : leB;
              var aktiv = leJetzt === v[0] + ':' + v[1];
              return '<button class="lerg' + (aktiv ? ' active' : '') + '" data-action="liga-ergebnis-setzen" ' +
                'data-id="' + esc(leM.id) + '" data-h="' + v[0] + '" data-g="' + v[1] + '">' +
                '<b>' + v[0] + ' : ' + v[1] + '</b><small>' + esc(sieger) + '</small></button>';
            }).join('') + '</div>' +
            (leJetzt
              ? '<button class="btn ghost full" data-action="liga-ergebnis-zurueck">Ergebnis zurücknehmen</button>'
              : '')) +
        '<button class="btn ghost full" data-action="ov-cancel">' + (leFest ? 'Schließen' : 'Abbrechen') + '</button>';
    } else if (o.type === 'liga-nachtrag') {
      /* Ein Spieltag, den die Ligaleitung schon mit allen 16 Einzeln
         gemeldet hat (LIGA_SPIELTAGE, partien): die Ergebnisse kommen in
         die App, als haetten wir sie am Abend eingetragen. Zu klaeren ist
         nur, welcher Bogen-Name welches Konto ist. */
      var nt = o.termin, nb = o.bogen, nd = o.draft;
      var nDaheim = nb.heim === LIGA.team;
      var nUnsere = nachtragNamen(nb, nDaheim);
      var nKader = ligaKader();
      html = '<h3>Spielbericht übernehmen</h3>' +
        '<p>' + nt.nr + '. Spieltag · ' + esc(nb.heim) + ' vs ' + esc(nb.gast) +
          ' · Einzel ' + esc(nb.einzel) + (nb.legs ? ' · Legs ' + esc(nb.legs) : '') + '</p>' +
        '<p class="hint">Das Ergebnis steht schon im Spielplan. Erst das Übernehmen macht daraus das Ligaspiel ' +
          'im Archiv: mit den 16 Einzeln, Siegen in der Liga-Statistik und dem fertigen Spielbericht.</p>' +
        '<div class="liga-start">' +
          '<div class="ls-titel">Wer ist wer bei ' + esc(LIGA.team) + '</div>' +
          nUnsere.map(function (nm, i) {
            var gewaehlt = nd.zuordnung[nm] || '';
            var offen = (o.fehlt || []).indexOf(nm) >= 0;
            return '<label class="ls-zeile nt"><span>' + (nDaheim ? 'H' : 'G') + (i + 1) + '</span>' +
              '<span class="nt-wer"><small>' + esc(nm) + '</small>' +
              '<select data-role="nachtrag-wer" data-name="' + esc(nm) + '"' + (offen ? ' class="fehlt"' : '') + '>' +
                '<option value=""' + (gewaehlt ? '' : ' selected') + '>– bitte wählen –</option>' +
                nKader.map(function (p) {
                  return '<option value="' + p.id + '"' + (gewaehlt === p.id ? ' selected' : '') + '>' +
                    esc(p.voll || p.name) + '</option>';
                }).join('') +
                /* Kein Konto, kein Profil: als Gast anlegen, damit der Bogen
                   stimmt. In die Liga-Rangliste kommt nur, wer ein Konto hat. */
                '<option value="__neu">+ „' + esc(nm) + '“ neu als Gast anlegen</option>' +
              '</select></span></label>';
          }).join('') +
          '<p class="hint">Die 16 Einzel kommen mit ihrem Leg-Stand vom Spielberichtsbogen – ohne Würfe, ' +
            'also ohne Average und Highlights. Siege und Legs zählen in Liga-Statistik und Rangliste; ' +
            'der Spieltag gilt danach als abgeschlossen. Fehlt jemand in der Liste, lege ihn über den ' +
            'letzten Eintrag als Gast an – in die Rangliste kommt er dann erst mit eigenem Konto.</p>' +
        '</div>' +
        /* Die Meldung steht direkt ueber dem Knopf, der sie ausgeloest hat -
           oben im Dialog wuerde sie am Handy aus dem Bild rutschen. */
        (o.fehler ? '<p class="edit-error nt-fehler">' + esc(o.fehler) + '</p>' : '') +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary start" data-action="liga-nachtrag-los">Übernehmen</button></div>';
    } else if (o.type === 'liga-wechsel') {
      /* Die acht Positionen mit ihrer aktuellen Besetzung – Wechsel je
         Position, wie es die SWO erlaubt. */
      var wlg = S.tour && S.tour.liga;
      if (!wlg) { UI.overlay = null; ov.classList.add('hidden'); return; }
      var wUnsere = wlg.heim ? 'H' : 'G';
      var wHeimTeam = wlg.heim ? LIGA.team : wlg.gegner, wGastTeam = wlg.heim ? wlg.gegner : LIGA.team;
      /* Status je Position: laeuft gerade ein Einzel (auch am anderen
         Geraet), steht das dabei - sonst "gemeldet" bzw. "Gast". */
      var wStatus = function (seite, i) {
        var idx = seite === 'H' ? 0 : 1;
        var laeuft = S.matches.filter(function (m) {
          return m.posPaar && m.posPaar[idx] === i && !m.done && !m.void &&
            (m.belegtVon || m.legs.some(function (l) { return l.visits.length > 0; }));
        })[0];
        if (laeuft) return { t: 'Einzel läuft' + (laeuft.scheibe ? ' auf ' + laeuft.scheibe : ''), hell: true };
        var wTyp = ligaTyp(wlg, (seite === 'H' ? wlg.posH : wlg.posG)[i]);
        return { t: wTyp === 'gast' ? 'Gastspieler' : wTyp === 'neu' ? 'nachgemeldet' : seite === wUnsere ? 'gemeldet' : 'Gast', hell: false };
      };
      var wSpalte = function (seite, titel, posListe) {
        return '<div class="dl-spalte"><div class="kt">' + titel + '</div>' + posListe.map(function (id, i) {
          var st = wStatus(seite, i);
          return '<div class="dl-pos">' +
            '<span class="dl-k ' + (seite === 'H' ? 'h' : 'g') + '">' + seite + (i + 1) + '</span>' +
            '<span class="dl-wer"><b>' + esc(ligaName(id)) + '</b><small' + (st.hell ? ' class="hell"' : '') + '>' + esc(st.t) + '</small></span>' +
            '<button class="btn ghost small" data-action="liga-wechsel-pos" data-seite="' + seite + '" data-pos="' + i + '">Wechseln</button>' +
            '</div>';
        }).join('') + '</div>';
      };
      html = '<div class="dl-kopf"><h3>Spieler wechseln</h3>' +
        '<p>Nur auf derselben Position (SWO §8), höchstens 8 Spieler je Team. Der Wechsel gilt für alle ' +
          'noch nicht begonnenen Einzel der Position, ein angefangenes Einzel spielt sein Spieler zu Ende. ' +
          'Höchstens ein nicht gemeldeter Gastspieler pro Mannschaft.</p></div>' +
        '<div class="dl-spalten">' + wSpalte('H', 'Heim · ' + esc(wHeimTeam), wlg.posH) + wSpalte('G', 'Gast · ' + esc(wGastTeam), wlg.posG) + '</div>' +
        '<div class="dl-fuss"><button class="btn hell" data-action="ov-cancel">Fertig</button></div>';
    } else if (o.type === 'liga-wechsel-zu') {
      var wz = o, wzLg = S.tour && S.tour.liga;
      if (!wzLg) { UI.overlay = null; ov.classList.add('hidden'); return; }
      var wzPosListe = wz.seite === 'H' ? wzLg.posH : wzLg.posG;
      var wzTeam = (wz.seite === 'H' ? wzLg.heimSpieler : wzLg.gastSpieler) || [];
      var wzBesetzt = wzLg.posH.concat(wzLg.posG);
      /* Eigene Seite: der Kader (alle Stammspieler, die nicht auf dem Bogen
         stehen); Gegner: wer schon nachgemeldet ist. Dazu immer die
         spontane Nachmeldung mit Namen. */
      var wzKandidaten = wz.eigene
        ? ligaKader().filter(function (p) { return wzBesetzt.indexOf(p.id) < 0 && !istLigaGegner(p.id); })
        : wzTeam.filter(function (id) { return wzBesetzt.indexOf(id) < 0; }).map(profile).filter(Boolean);
      var wzMap = career();
      var wzKnopf = function (p) {
        var inTeam = wzTeam.indexOf(p.id);
        var st = wzMap[p.id];
        var sub = (st && st.darts ? 'Ø ' + st.avg.toFixed(1) + ' · ' : '') + (inTeam >= 0 ? (wz.eigene ? 'gemeldet' : 'nachgemeldet') : 'Kader');
        return '<button type="button" class="dl-wahl' + (wz.draft.neu === p.id ? ' active' : '') + '" data-action="liga-wechsel-neu" data-id="' + esc(p.id) + '">' +
          '<span class="dl-k h">' + (inTeam >= 0 ? wz.seite + (inTeam + 1) : '') + '</span>' +
          '<span class="dl-wer"><b>' + esc(ligaName(p.id)) + '</b><small>' + esc(sub) + '</small></span></button>';
      };
      html = '<div class="dl-kopf"><h3>Wechsel auf Position ' + wz.seite + (wz.pos + 1) + '</h3>' +
        '<p>Raus: ' + esc(ligaName(wzPosListe[wz.pos])) + '. Der neue Spieler übernimmt alle offenen Einzel von ' + wz.seite + (wz.pos + 1) + '.</p></div>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        (wzKandidaten.length ? '<div class="kt">' + (wz.eigene ? 'Aus dem Kader' : 'Schon auf dem Bogen') + '</div>' +
          '<div class="dl-raster">' + wzKandidaten.map(wzKnopf).join('') + '</div>' : '') +
        '<div class="kt">Oder spontan nachmelden</div>' +
        '<div class="dl-raster">' +
          '<input class="dl-input" data-role="liga-neu-name" maxlength="30" autocomplete="off" value="' + esc(wz.draft.name || '') + '" placeholder="Vorname">' +
          '<input class="dl-input" data-role="liga-neu-nach" maxlength="30" autocomplete="off" value="' + esc(wz.draft.nach || '') + '" placeholder="Nachname">' +
        '</div>' +
        '<div class="dl-segment ls-neu-typ">' +
          '<button type="button" data-action="liga-neu-typ" data-value="neu" class="' + (wz.draft.typ === 'gast' ? '' : 'active') + '">neu melden</button>' +
          '<button type="button" data-action="liga-neu-typ" data-value="gast" class="' + (wz.draft.typ === 'gast' ? 'active' : '') + '">Gastspieler</button>' +
        '</div>' +
        '<p class="dl-note">' + (wz.draft.typ === 'gast'
          ? 'Gastspieler: nicht gemeldet, höchstens einer je Mannschaft und Spiel, höchstens zwei Einsätze je Saison – steht so auf dem Bogen, ohne Unterschrift.'
          : 'Neuer Name kommt als Nachmeldung auf den Spielbericht und unterschreibt nach dem Einwechseln.') + '</p>' +
        '<div class="dl-fuss"><button class="btn ghost" data-action="roster-change">Zurück</button>' +
        '<button class="btn hell" data-action="liga-wechsel-ok">Einwechseln</button></div>';
    } else if (o.type === 'confirm-reset') {
      var offeneSpiele = sum(S.matches, function (m) { return m.done || m.void ? 0 : 1; });
      var fertige = sum(S.matches, function (m) { return m.done ? 1 : 0; });
      if (S.tour && S.tour.liga) {
        var crArt = o.art || 'entfallen';
        var crOpt = function (k, t, s) {
          return '<button type="button" class="dl-wahl' + (crArt === k ? ' active' : '') + '" data-action="reset-art" data-value="' + k + '">' +
            '<span class="dl-wer"><b>' + t + '</b><small>' + s + '</small></span></button>';
        };
        html = '<div class="dl-kopf"><h3>Ligaspiel vorzeitig beenden?</h3>' +
          '<p>' + fertige + ' von ' + S.matches.length + ' Einzel sind gespielt. Wie sollen die ' +
            plural(offeneSpiele, 'offene Einzel', 'offenen Einzel') + ' gewertet werden?</p></div>' +
          '<div class="dl-liste">' +
            crOpt('kampflos', 'Nicht begonnene Einzel kampflos für den Gegner', 'So wird es im Spielbericht gemeldet') +
            crOpt('entfallen', 'Offene Einzel entfallen', 'Nur die gespielten Einzel zählen') +
            crOpt('verwerfen', 'Ligaspiel verwerfen', 'Nichts wird gespeichert') +
          '</div>' +
          '<div class="dl-fuss"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
          '<button class="btn rot" data-action="ov-reset">Beenden</button></div>';
      } else
      html = '<h3>Turnier vorzeitig beenden?</h3>' +
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
      /* Dritte Wahl: einladen. Ein Mitglied (kein Gast-Konto) holt einen
         Link vom Server - als QR-Code zum Scannen oder zum Teilen. Der
         Eingeladene bekommt ein eigenes Konto auf allen Geraeten: als Gast
         (ohne Liga) oder als neues Vereinsmitglied. */
      var kannEinladen = isNew && gastWahl && !ichBinGastKonto() && !!(window.DartKonto && window.DartKonto.ruf);
      var einladen = kannEinladen && !!p.einladen;
      if (einladen) {
        html = '<h3>Einladen</h3>' + gastArtHtml(p, kannEinladen) + einladungHtml(o) +
          '<div class="row-btns two"><button class="btn ghost" data-action="ov-cancel">Schließen</button>' +
          '<button class="btn primary" data-action="einladung-teilen"' + (einladungAktuell(o) ? '' : ' disabled') + '>Link teilen</button></div>';
      } else
      html = '<h3>' + (isNew ? (gastWahl ? 'Gast hinzufügen' : 'Neuer Spieler') : 'Spieler bearbeiten') + '</h3>' +
        (o.fehler ? '<p class="hint fehler" role="alert">' + esc(o.fehler) + '</p>' : '') +
        (gastWahl ? gastArtHtml(p, kannEinladen) : '') +
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
        '<label class="dbl-wahl"><span>Lieblingsgruppe</span>' +
          '<select data-role="profile-double">' + doppelOptionen(p.dbl) + '</select>' +
        '</label>' +
        '<p class="hint">Bei gleich vielen Darts stellt der Finish-Vorschlag auf diese Doppel. ' +
          'Einen Dart mehr kostet es nie. Mehr dazu im Profil unter Finish-Weg.</p>' +
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
        (S.game && S.game.kind === 'quick' && Array.isArray(S.game.legs)
          ? legStatHTML(S.game, S.game.legs.filter(function (l) { return l.winner; }).pop()) : '') +
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
    if (o.type === 'unterschrift' || o.type === 'nachmeldung') signaturVorbereiten();
    var karte = $('overlay-card');
    dialogGeoeffnet(ov, karte, o);
    /* Mit Tastatur: in Dialogen ohne eigene Pfeil-Wahl gleich den
       Hauptknopf markieren, damit immer etwas sichtbar gewaehlt ist. */
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
    var sie, gegnerName, daheim = true;
    if (d.modus === 'liga') {
      /* Probelauf gegen den naechsten Gegner: Gaeste wie beim echten Start. */
      var pTermin = ligaNaechsterTermin();
      if (!pTermin) { o.fehler = 'Kein kommender Spieltag im Plan.'; render(); return; }
      daheim = pTermin.heim === LIGA.team;
      gegnerName = daheim ? pTermin.gast : pTermin.heim;
      var pNamen = [0, 1, 2, 3].map(function (i) { return gegnerVollName(d, i); });
      if ([0, 1, 2, 3].some(function (i) { return !String((d.gegner || [])[i] || '').trim() || !String((d.gegnerNach || [])[i] || '').trim(); })) {
        o.fehler = 'Bitte alle vier Gegner mit Vor- und Nachnamen eintragen – aus dem Kader antippen oder eintippen.';
        render(); return;
      }
      if (pNamen.some(function (n, i) { return pNamen.indexOf(n) !== i; })) {
        o.fehler = 'Zwei Gegner heißen gleich – bitte unterscheidbar machen.';
        render(); return;
      }
      sie = [];
      pNamen.forEach(function (n) { sie.push(ligaGastId(n, wir.concat(sie))); });
    } else if (d.modus === 'team') {
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
          if (!da && p.bot === d.modus && p.name === nm) da = p;
        });
        if (da) return da.id;
        var p = { id: uid(), name: nm, voll: nm, avatar: null, hue: freeHue(), created: Date.now(), gast: true, hidden: true, bot: d.modus };
        S.profiles.push(p);
        return p.id;
      });
      gegnerName = 'Bots (' + d.modus + ')';
    }
    /* Bogen-Listen wie im echten Ligaspiel: im Probelauf auswaerts stehen
       wir als Gast (G1-G4), sonst immer als Heim. */
    var uHeimListe = daheim ? wir.slice() : sie.slice();
    var uGastListe = daheim ? sie.slice() : wir.slice();

    if (S.matches.length) archiveTournament();
    if (S.game && S.game.done) archiveGame(S.game);
    S.game = null;
    S.tour = {
      start: 501, bestOf: d.bestOf, players: wir.concat(sie),
      liga: {
        terminId: 'uebung', nr: 0, gegner: gegnerName, heim: daheim, uebung: true,
        wir: wir, sie: sie,
        heimSpieler: uHeimListe, gastSpieler: uGastListe,
        posH: uHeimListe.slice(0, 4), posG: uGastListe.slice(0, 4),
        ort: 'Bar Sehnsucht', tag: '',
        finish: !!d.finish, zeitVon: Date.now(), zeitBis: null
      }
    };
    S.matches = LIGA_EINZEL.map(function (paar, i) {
      var h = uHeimListe[paar[0]], g = uGastListe[paar[1]];
      return {
        id: uid(), round: Math.floor(i / 4) + 1, p: [h, g],
        /* Gegen Bots wird nicht ausgebullt (die werfen keinen Bull) - der
           eigene Spieler wirft an. Gegen echte Leute wie im Ligaspiel. */
        starter: d.modus === 'team' || d.modus === 'liga' ? null : (daheim ? h : g), posPaar: paar.slice(),
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
    if (d.geteilt && (d.modus === 'team' || d.modus === 'liga') && window.DartSync && window.DartSync.turnier &&
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
    var wirTyp = Array.isArray(d.wirTyp) ? d.wirTyp : [], gegnerTyp = Array.isArray(d.gegnerTyp) ? d.gegnerTyp : [];
    /* "Anderer Name" (Gastspieler oder Nachmeldung ohne Konto): Vor- und
       Nachname wie beim Gegner, daraus wird ein Gast dieses Geraets. */
    var wirNamen = [];
    for (var wi = 0; wi < 4; wi++) {
      if (wir[wi] !== '__name') continue;
      var wn = (d.wirNamen || [])[wi] || {};
      if (!String(wn.vor || '').trim() || !String(wn.nach || '').trim()) {
        o.fehler = 'Position ' + (wi + 1) + ': bitte Vor- und Nachnamen eintragen (SWO: bürgerliche Namen).';
        render(); return;
      }
      wirNamen.push({ i: wi, voll: (String(wn.vor).trim().slice(0, 30) + ' ' + String(wn.nach).trim().slice(0, 30)).replace(/\s+/g, ' ').trim() });
    }
    var wirKonten = wir.filter(function (id) { return id !== '__name'; });
    var doppelt = wirKonten.some(function (id, i) { return wirKonten.indexOf(id) !== i; }) ||
      wirNamen.some(function (n, i) { return wirNamen.some(function (m, j) { return j !== i && m.voll === n.voll; }); });
    if (wir.length < 4 || wir.some(function (id) { return !id; }) || doppelt) {
      o.fehler = 'Bitte vier verschiedene eigene Spieler aufstellen.';
      render(); return;
    }
    if (wirTyp.filter(function (t) { return t === 'gast'; }).length > 1 || gegnerTyp.filter(function (t) { return t === 'gast'; }).length > 1) {
      o.fehler = LIGA_GAST_FEHLER;
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
    wirNamen.forEach(function (n) {
      wir[n.i] = ligaGastId(n.voll, wir.filter(function (id) { return id !== '__name'; }));
    });
    var sie = [];
    namen.forEach(function (n) {
      sie.push(ligaGastId(n, wir.concat(sie)));
    });
    /* Der SWO-Status je Spieler, beide Teams (nur wer nicht "gemeldet" ist). */
    var typen = {};
    wir.forEach(function (id, i) { if (wirTyp[i]) typen[id] = wirTyp[i]; });
    sie.forEach(function (id, i) { if (gegnerTyp[i]) typen[id] = gegnerTyp[i]; });

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
        finish: !!d.finish, zeitVon: Date.now(), zeitBis: null,
        /* Der Gegner zaehlt mit seinem System: je Einzel nur der Leg-Stand. */
        nurErgebnis: !!d.nurErgebnis,
        typen: typen
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
    /* Wer "neu melden" ist, unterschreibt gleich - einer nach dem anderen. */
    nachmeldungenOffenStarten();

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
  /* Der Kader des Gegners laut Ligaleitung (Mannschaftsseite) plus alle,
     die laut Spielberichten schon fuer das Team geworfen haben - als Chips
     im Start-Dialog: ein Tipp traegt den Namen in die naechste freie
     Gegner-Zeile (Vorname / Nachname), ein zweiter nimmt ihn wieder raus.
     Spart das Tippen am Spieltag; neue Gesichter tippt man weiter ein
     (Julius, 10.11.). */
  /* Wen die Ligaleitung im Kader schon als Gast fuehrt ("*Name"). */
  function ligaGegnerKaderGaeste(team) {
    var info = (window.LIGA_DATEN.teamInfo || {})[team] || {};
    return (info.spieler || []).filter(function (s) { return /^\*/.test(String(s.name || '')); })
      .map(function (s) { return String(s.name).replace(/^\*/, '').trim(); });
  }
  function ligaGegnerKader(team) {
    var info = (window.LIGA_DATEN.teamInfo || {})[team] || {};
    var namen = [];
    var dazu = function (n) { n = String(n || '').replace(/^\*/, '').trim(); if (n && namen.indexOf(n) < 0) namen.push(n); };
    (info.spieler || []).forEach(function (s) { dazu(s.name); });
    Object.keys(LIGA_SPIELTAGE).forEach(function (tid) {
      (LIGA_SPIELTAGE[tid] || []).forEach(function (sp) {
        if (!sp || !Array.isArray(sp.partien)) return;
        sp.partien.forEach(function (p) { if (sp.heim === team) dazu(p[0]); if (sp.gast === team) dazu(p[1]); });
      });
    });
    return namen;
  }
  function gegnerVollName(d, i) {
    return (String((d.gegner || [])[i] || '').trim() + ' ' + String((d.gegnerNach || [])[i] || '').trim()).replace(/\s+/g, ' ').trim();
  }
  /* Die vier Gegner-Zeilen (Vor- und Nachname) mit den Kader-Chips darueber -
     im Ligaspiel-Start und im Probelauf des Uebungsspiels dieselben. */
  function ligaGegnerFelderHtml(team, d) {
    var kader = ligaGegnerKader(team);
    var kaderGaeste = ligaGegnerKaderGaeste(team);
    var drin = [0, 1, 2, 3].map(function (i) { return gegnerVollName(d, i); });
    return '<div class="ls-titel">' + esc(team) + ' \u2013 Vor- und Nachname (SWO)</div>' +
      (kader.length
        ? '<div class="chips ls-kader">' + kader.map(function (n) {
            var gast = kaderGaeste.indexOf(n) >= 0;
            return '<button type="button" class="chip' + (drin.indexOf(n) >= 0 ? ' active' : '') + (gast ? ' gast' : '') + '" data-action="liga-gegner-kader" data-name="' + esc(n) + '"' +
              (gast ? ' title="Laut Ligaleitung Gastspieler"' : '') + '>' + esc(n) + '</button>';
          }).join('') + '</div>' +
          '<p class="hint">Kader laut Ligaleitung – antippen füllt die nächste freie Zeile, nochmal tippen nimmt den Namen raus' +
            (kaderGaeste.length ? '; gestrichelt = dort schon als Gastspieler geführt' : '') + '.</p>'
        : '') +
      [0, 1, 2, 3].map(function (i) {
        return '<div class="ls-zeile"><span>' + (i + 1) + '</span>' +
          '<span class="namen-paar">' +
          '<input data-role="liga-gegner" data-i="' + i + '" maxlength="30" ' +
          'value="' + esc((d.gegner || [])[i] || '') + '" placeholder="Vorname">' +
          '<input data-role="liga-gegner-nach" data-i="' + i + '" maxlength="30" ' +
          'value="' + esc((d.gegnerNach || [])[i] || '') + '" placeholder="Nachname">' +
          '</span>' + ligaTypKnopfHtml('gegner', i, (d.gegnerTyp || [])[i]) + '</div>';
      }).join('');
  }
  /* Der naechste Spieltag mit Datum ab heute (heute selbst eingeschlossen). */
  function ligaNaechsterTermin() {
    var heute = heuteISO(), best = null;
    LIGA.termine.forEach(function (t) { if (t.tag && t.tag >= heute && (!best || t.tag < best.tag)) best = t; });
    return best;
  }

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
    if (rest <= MAX_CHECKOUT && Checkout.possible(rest, 3)) {
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
    if (wert > MAX_VISIT) wert = MAX_VISIT;
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
    /* "Tastatur" im Setup: das Turnier beginnt gleich in der Fernsteuerung. */
    UI.turnier = S.settings.tastatur === 1;
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
    UI.input = ''; UI.darts = []; UI.mult = 1; UI.modeOverride = null; UI.error = ''; UI.overlay = null; UI.menu = false;
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
  var SETTLE_ACTIONS = { 'restart-game': 1, 'ov-next-leg': 1, 'co-darts': 1, 'co-doppel': 1 };

  function handleAction(action, el) {
    var screenBefore = S.screen;
    if (SETTLE_ACTIONS[action]) settleUntil = Date.now() + 150;
    /* Jedes Zurueck klingt gleich: Zurueck-Knoepfe und das Zuruecknehmen in
       Spielen, die den Ton nicht selbst haben (X01 und Kaiwen klicken selbst). */
    if (/(^|-)(zurueck|back)($|-)/.test(action)) klick();
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
        UI.boardLog = false;
        /* "Profil" ist das eigene Profil (Spielerausweis, Finish-Weg,
           Konto); nur ohne Anmeldung bleibt es der Anmeldebildschirm. */
        if (target === 'konto' && eigeneKontoId() && profile(eigeneKontoId())) {
          UI.profile = eigeneKontoId(); UI.profilPanel = null; UI.profilGruppenWahl = false;
          target = 'profile';
        }
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
        UI.overlay = { type: 'profile', id: p.id, draft: { name: p.name, avatar: p.avatar, dbl: DOPPEL_WAHL.indexOf(p.dbl) >= 0 ? p.dbl : null, vor: pTeile.vor, nach: pTeile.nach, dauer: !!p.dauer } };
        render();
        break;
      }
      case 'edit-current-profile': {
        var cp = profile(UI.profile);
        /* Entwurf "Profil bearbeiten": eigene Flaeche im Profil. Gaeste
           behalten den Dialog - der kennt Gast-Art und Loeschen. */
        /* Laeuft die Flaeche schon, bleibt der Entwurf stehen. */
        if (UI.profilEdit && (UI.profilPanel === 'edit' || UI.profilPanel === 'foto')) break;
        if (!cp.gast) { profilBearbeitenStarten(cp); break; }
        var cpTeile = vollSplit(cp.voll);
        UI.overlay = { type: 'profile', id: cp.id, draft: { name: cp.name, avatar: cp.avatar, dbl: DOPPEL_WAHL.indexOf(cp.dbl) >= 0 ? cp.dbl : null, vor: cpTeile.vor, nach: cpTeile.nach, dauer: !!cp.dauer } };
        render();
        break;
      }
      /* Flaeche "Profil bearbeiten" */
      case 'pe-abbrechen': UI.profilPanel = null; UI.profilEdit = null; render(); break;
      case 'pe-farbe': if (UI.profilEdit) { UI.profilEdit.hue = Number(el.getAttribute('data-hue')); render(); } break;
      case 'pe-hand': if (UI.profilEdit) { UI.profilEdit.wurfhand = el.getAttribute('data-value') || null; render(); } break;
      case 'pe-foto-weg': if (UI.profilEdit) { UI.profilEdit.avatar = null; render(); } break;
      case 'pe-foto': if (UI.profilEdit) fotoStarten(UI.profilEdit.avatar, 'edit'); break;
      case 'pe-speichern': profilBearbeitenSpeichern(); break;
      /* Flaeche "Foto anpassen" */
      case 'foto-galerie': $('avatar-input').click(); break;
      case 'foto-kamera': $('avatar-kamera').click(); break;
      case 'foto-zoom': if (UI.foto) { UI.foto.zoom = Math.max(0, Math.min(100, UI.foto.zoom + Number(el.getAttribute('data-d')))); render(); } break;
      case 'foto-abbrechen': fotoSchliessen(); break;
      case 'foto-ok': fotoUebernehmen(); break;
      case 'pick-avatar':
        $('avatar-input').click();
        break;
      case 'gast-art':
        if (UI.overlay && UI.overlay.type === 'profile') {
          var gaWert = el.getAttribute('data-value');
          UI.overlay.draft.dauer = gaWert === '1';
          UI.overlay.draft.einladen = gaWert === '2';
          if (gaWert === '2') einladungHolen(UI.overlay);
          render();
        }
        break;
      case 'einladung-art':
        if (UI.overlay && UI.overlay.type === 'profile') {
          UI.overlay.einladungArt = el.getAttribute('data-value') === 'mitglied' ? 'mitglied' : 'gast';
          UI.overlay.einladungMeldung = '';
          einladungHolen(UI.overlay);
          render();
        }
        break;
      case 'einladung-teilen': {
        /* Teilen-Menue des Geraets; ohne eines (Computer) landet der Link
           in der Zwischenablage. */
        var et = UI.overlay && UI.overlay.type === 'profile' ? einladungAktuell(UI.overlay) : null;
        if (!et) break;
        var etOv = UI.overlay;
        var etText = (UI.overlay.einladungArt === 'mitglied' ? 'Einladung zu Blink 180' : 'Einladung zu Blink 180 als Gast') + ': ' + et.link;
        if (navigator.share) {
          navigator.share({ title: 'Blink 180', text: etText, url: et.link }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(et.link).then(function () {
            if (UI.overlay === etOv) { etOv.einladungMeldung = 'Link kopiert.'; render(); }
          }).catch(function () {});
        }
        break;
      }
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
          /* Die Hauptgruppe aus dem Dialog; eine zweite Gruppe (nur im
             Profil waehlbar) bleibt stehen, wenn sie nicht dieselbe ist. */
          var exG = draft.dbl ? gruppeAusDoppel(draft.dbl) : null;
          var exAlt = finishGruppen(ex);
          finishGruppenSetzen(ex, exG ? [exG].concat(exAlt.filter(function (g) { return g !== exG; })).slice(0, 2) : []);
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
          var np = { id: uid(), name: name, avatar: draft.avatar, created: Date.now(), hue: freeHue(), dbl: null, voll: vollAusTeilen(draft.vor, draft.nach) };
          if (draft.dbl && gruppeAusDoppel(draft.dbl)) finishGruppenSetzen(np, [gruppeAusDoppel(draft.dbl)]);
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
        /* Jeder sieht nur sein eigenes Profil (und Gaeste ohne Konto, die
           jeder pflegt); bei allen anderen geht es in die Einzelstatistik
           (Julius, 12.11.). */
        if (!bearbeitbar(el.getAttribute('data-id'))) { statsPersonOeffnen(el.getAttribute('data-id')); break; }
        UI.profile = el.getAttribute('data-id');
        UI.profilPanel = null; UI.profilGruppenWahl = false; UI.tab = null; UI.profilEdit = null; UI.foto = null;
        S.screen = 'profile';
        save(); render();
        break;
      /* Profil: Tafel mit den Statistik-Karten, Liga-Statistik, Gruppenwahl,
         Finish-Ermittlung. */
      /* Kamera-Knopf am Ausweis: derselbe Dialog wie "Profil bearbeiten",
         gleich mit der Fotowahl. */
      case 'profil-foto': {
        var pfP = profile(UI.profile);
        if (!pfP || !bearbeitbar(pfP.id)) break;
        if (pfP.gast) { handleActionInner('edit-current-profile', el); if (UI.overlay && UI.overlay.type === 'profile') $('avatar-input').click(); break; }
        if (UI.profilPanel === 'foto') break;
        /* Mit offener Bearbeiten-Flaeche gehoert das Foto in den Entwurf. */
        if (UI.profilEdit && UI.profilPanel === 'edit') { fotoStarten(UI.profilEdit.avatar, 'edit'); break; }
        fotoStarten(pfP.avatar, null);
        break;
      }
      case 'profil-stats': UI.profilPanel = 'stats'; statsAnimiertFuer = ''; render(); break;
      case 'stats-modus': statsFilter().modus = el.getAttribute('data-wert') || 'alle'; render(); break;
      case 'stats-bereich': statsFilter().bereich = Number(el.getAttribute('data-wert')) || 0; render(); break;
      case 'profil-tabelle': UI.profilPanel = 'tabelle'; UI.tab = null; tabZustand(); render(); break;
      case 'profil-panel-zu': UI.profilPanel = null; UI.tab = null; render(); break;
      /* Finish-Tabelle: Filter, Rest waehlen, Editor */
      case 'tab-filter': tabZustand().filter = el.getAttribute('data-value'); render(); break;
      case 'tab-rest': {
        var trP = profile(UI.profile); if (!trP) break;
        var trR = Number(el.getAttribute('data-rest'));
        if (tabZustand().rest === trR) { tabZustand().rest = null; render(); break; }
        tabRestWaehlen(trP, trR); render();
        break;
      }
      case 'tab-darts': {
        var tdP = profile(UI.profile), tdT = tabZustand(); if (!tdP || !tdT.rest) break;
        tdT.darts = Number(el.getAttribute('data-value')); tdT.slot = 0;
        tdT.entwurf = tabWegTokens(tdP, tdT.rest, tdT.darts); tdT.info = null;
        tabInfoHolen(tdP); render();
        break;
      }
      case 'tab-slot': tabZustand().slot = Number(el.getAttribute('data-i')); render(); break;
      case 'tab-seg': tabZustand().seg = el.getAttribute('data-value'); render(); break;
      case 'tab-pad': {
        var tpP = profile(UI.profile), tpT = tabZustand(); if (!tpP || !tpT.rest || !bearbeitbar(tpP.id)) break;
        var tpV = el.getAttribute('data-value');
        if (!tpV) { tpT.entwurf.splice(tpT.slot, 1); tpT.slot = Math.max(0, Math.min(tpT.slot, tpT.entwurf.length)); }
        else { tpT.entwurf[tpT.slot] = tpV; tpT.slot = Math.min(tpT.darts - 1, tpT.slot + 1); }
        /* Luecken schliessen: ein Weg hat keine leeren Darts in der Mitte. */
        tpT.entwurf = tpT.entwurf.filter(Boolean).slice(0, tpT.darts);
        tpT.slot = Math.min(tpT.slot, tpT.darts - 1);
        tabInfoHolen(tpP); render();
        break;
      }
      case 'tab-alt': {
        var taP = profile(UI.profile), taT = tabZustand(); if (!taP || !taT.rest) break;
        taT.entwurf = el.getAttribute('data-weg').split(' '); taT.slot = 0;
        tabInfoHolen(taP); render();
        break;
      }
      case 'tab-speichern': {
        var tsP = profile(UI.profile); if (!tsP || !bearbeitbar(tsP.id)) break;
        var tsT = tabZustand(), tsTok = tsT.entwurf.filter(Boolean);
        var tsI = tsT.info && tsT.info.key === tsT.rest + '/' + tsT.darts + '/' + tsTok.join(' ') ? tsT.info : null;
        if (!tsI || !tsI.pruefung || !tsI.pruefung.ok) break;
        tabEigenSpeichern(tsP, false);
        break;
      }
      case 'tab-standard': {
        var tstP = profile(UI.profile); if (!tstP || !bearbeitbar(tstP.id)) break;
        tabEigenSpeichern(tstP, true);
        break;
      }
      case 'profil-liga': ligaStatistikOeffnen('wir'); break;
      case 'profil-gruppen': UI.profilGruppenWahl = !UI.profilGruppenWahl; render(); break;
      case 'profil-gruppen-ok': UI.profilGruppenWahl = false; render(); break;
      case 'profil-gruppe': {
        var pgP = profile(UI.profile);
        if (!pgP || !bearbeitbar(pgP.id)) break;
        var pgG = el.getAttribute('data-value'), pgL = finishGruppen(pgP);
        if (!pgG) pgL = [];
        else if (pgL.indexOf(pgG) >= 0) pgL.splice(pgL.indexOf(pgG), 1);
        else if (pgL.length < 2) pgL.push(pgG);
        else pgL[1] = pgG;
        finishGruppenSetzen(pgP, pgL);
        if (window.DartKonto) window.DartKonto.profilGeaendert(pgP.id);
        save(); render();
        break;
      }
      case 'finish-ermitteln':
        if (UI.profile && bearbeitbar(UI.profile)) finishDialogStarten(UI.profile);
        break;
      case 'fi-gruppe': {
        var fgO = UI.overlay; if (!fgO || fgO.type !== 'finish') break;
        var fgG = el.getAttribute('data-value'), fgL = fgO.draft.gruppen;
        if (fgL.indexOf(fgG) >= 0) fgL.splice(fgL.indexOf(fgG), 1);
        else if (fgL.length < 2) fgL.push(fgG);
        else fgL[1] = fgG;
        render();
        break;
      }
      case 'fi-weiter': if (UI.overlay && UI.overlay.type === 'finish') { finishWeiter(UI.overlay); if (UI.overlay && UI.overlay.schritt !== 'rechnet') render(); } break;
      case 'fi-zurueck': if (UI.overlay && UI.overlay.type === 'finish') { finishZurueck(UI.overlay); render(); } break;
      case 'fi-test-weg':
        if (UI.overlay && UI.overlay.type === 'finish' && UI.overlay.schritt === 'tests') {
          UI.overlay.draft.tests[FINISH_TESTS[UI.overlay.test]] = null;
          UI.overlay.fehler = '';
          finishNaechsterTest(UI.overlay); render();
        }
        break;
      case 'fi-zaehl': {
        var fzO = UI.overlay; if (!fzO || fzO.type !== 'finish' || !fzO.zaehler) break;
        var fzK = el.getAttribute('data-kat'), fzD = Number(el.getAttribute('data-d'));
        var fzN = (fzO.zaehler[fzK] || 0) + fzD;
        if (fzN < 0 || (fzD > 0 && finishZaehlerSumme(fzO.zaehler) >= 10)) break;
        fzO.zaehler[fzK] = fzN; fzO.fehler = '';
        render();
        break;
      }
      case 'fi-spielweise': if (UI.overlay && UI.overlay.type === 'finish') { UI.overlay.draft.spielweise = el.getAttribute('data-value'); render(); } break;
      case 'fi-uebernehmen': if (UI.overlay && UI.overlay.type === 'finish') finishUebernehmen(UI.overlay); break;
      /* Spielerliste: Filter und Schnellansicht. */
      case 'players-filter': UI.spielerFilter = el.getAttribute('data-value'); render(); break;
      case 'spieler-wahl': UI.spielerWahl = el.getAttribute('data-id'); render(); break;
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
        S.screen = from === 'stats' || from === 'players' || from === 'liga' ? from
          : S.game && !S.game.done ? S.game.kind
          : S.matches.length ? 'tournament' : 'stats';
        save(); render();
        break;
      }
      case 'board':
        UI.board = el.getAttribute('data-key');
        render();
        break;
      /* Liga-Statistik (Liga › Statistik): das Team wechseln. */
      case 'stats-team':
        UI.ligaTeam = el.getAttribute('data-wert') || 'wir';
        render();
        break;
      case 'stats-ebene': statsUI().ebene = el.getAttribute('data-wert') === 'team' ? 'team' : 'person'; UI.boardLog = false; window.scrollTo(0, 0); render(); break;
      case 'stats-spieler': statsUI().spieler = el.getAttribute('data-wert'); render(); break;
      case 'stats-kader': statsUI().kader = el.getAttribute('data-wert') || 'avg'; render(); break;
      case 'stats-liga': statsUI().liga = el.getAttribute('data-wert') || 'punkte'; render(); break;
      /* Weitere Spielarten: die Details auf- und zuklappen. */
      case 'stats-art': { var stA = el.getAttribute('data-art'), stAuf = statsUI().auf; stAuf[stA] = !stAuf[stA]; render(); break; }
      case 'stats-gegner-alle': statsUI().gegnerAlle = !statsUI().gegnerAlle; render(); break;
      /* Aus Kader-Liste, Vergleich, Liga-Statistik oder Spieler-Liste zur Einzelstatistik. */
      case 'stats-person': statsPersonOeffnen(el.getAttribute('data-wert') || el.getAttribute('data-id')); break;
      case 'board-mode':
        UI.boardMode = el.getAttribute('data-value');
        UI.board = (boardsFor(UI.boardMode)[0] || { key: 'won' }).key;
        UI.boardLog = false;
        render();
        break;
      /* Rangliste: Spielverlauf auf und zu. */
      case 'board-log': UI.boardLog = true; render(); break;
      case 'board-log-zu': UI.boardLog = false; render(); break;
      case 'liga-wahl': {
        var lwId = el.getAttribute('data-id');
        var lwSchmal = !!(window.matchMedia && window.matchMedia('(max-width: 699px)').matches);
        /* Am Handy klappt ein Tipp auf den offenen Spieltag ihn wieder zu;
           die Zeile bleibt im Bild, auch wenn oben eine Karte zugeht. */
        UI.ligaZu = lwSchmal && el.classList.contains('wahl');
        UI.ligaWahl = lwId;
        render();
        if (lwSchmal) {
          var lwZeile = $('liga-liste').querySelector('.liga-spieltag[data-id="' + lwId + '"]');
          if (lwZeile && lwZeile.scrollIntoView) lwZeile.scrollIntoView({ block: 'nearest' });
        }
        break;
      }
      case 'liga-partien':
        UI.overlay = { type: 'liga-partien', termin: el.getAttribute('data-termin'), i: Number(el.getAttribute('data-i')) };
        render();
        break;
      case 'liga-runde':
        UI.overlay = { type: 'liga-runde', termin: el.getAttribute('data-termin') };
        render();
        break;
      case 'liga-team-info':
        UI.overlay = { type: 'liga-team-info', team: el.getAttribute('data-team') };
        render();
        break;
      case 'liga-einzel-alle': UI.ligaEinzelAlle = !UI.ligaEinzelAlle; ligaTabelleKennung = null; render(); break;
      case 'liga-runden-alle': UI.ligaRundenAlle = !UI.ligaRundenAlle; ligaTabelleKennung = null; render(); break;
      case 'set-mode':
        S.mode = el.getAttribute('data-value');
        save(); render();
        break;
      case 'start-game':
        if (S.mode === 'hunter' && S.lineup.length > HUNTER_MAX) {
          UI.overlay = { type: 'hinweis', titel: 'Hunter spielen höchstens sechs', text: 'Bitte in der Aufstellung bis zu sechs Spieler wählen. Die Reihenfolge der Auswahl ist die Wurfreihenfolge.' };
          render(); break;
        }
        if (S.mode === 'kaiwen' && S.lineup.length > 2) {
          UI.overlay = { type: 'hinweis', titel: 'Kaiwen spielen höchstens zwei', text: 'Bitte in der Aufstellung einen oder zwei Spieler wählen. Die Reihenfolge der Auswahl ist die Wurfreihenfolge.' };
          render(); break;
        }
        if (S.mode === '501') startTournament();
        else startGame(S.mode);
        break;
      /* Eingabe-Wahl im Setup (siehe renderSetup): 2 = Tastatur, 0 =
         Standard, 1 = Gemischt. Standard merkt sich die Grenze, damit
         Gemischt sie wiederfindet. */
      case 'eingabe': {
        var ew = Number(el.getAttribute('data-value'));
        S.settings.tastatur = ew === 2 ? 1 : 0;
        /* Im Finisher gibt es nur Tastatur oder nicht - die Einzel-Dart-Grenze
           des X01 bleibt davon unberuehrt. */
        if (el.closest('#eingabe-wahl-fin, #eingabe-wahl-kw')) { save(); render(); break; }
        if (ew === 0 && S.settings.dartModeFrom > 0) { S.settings.dartModeMerk = S.settings.dartModeFrom; S.settings.dartModeFrom = 0; }
        if (ew === 1 && !(S.settings.dartModeFrom > 0)) S.settings.dartModeFrom = S.settings.dartModeMerk > 0 ? S.settings.dartModeMerk : MAX_CHECKOUT;
        save(); render();
        break;
      }
      case 'leave-game':
        UI.menu = false;
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
      case 'hu-bust':
        hunterBust();
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
        UI.menu = false;
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
        UI.boardLog = false;
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
        /* Ein vergangener Spieltag wird nachgetragen: dann sind "nur
           Ergebnisse" die Voreinstellung - gespielt wurde ja schon. */
        var lsNachtrag = lsTermin.tag < ligaHeuteIso();
        UI.overlay = {
          type: 'liga-start', termin: lsTermin,
          /* Best of 3 (unsere 4. Liga) und ohne Finish-Hilfen (WDF 3.08:
             das Doppel wird nicht angesagt) sind die Voreinstellung. */
          draft: { bestOf: 3, wir: lsVorschlag.slice(0, 4), gegner: ['', '', '', ''], gegnerNach: ['', '', '', ''], geteilt: false, finish: false,
            nurErgebnis: lsNachtrag, nachtrag: lsNachtrag }
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
      case 'liga-gegner-kader': {
        /* Kader-Chip: in die naechste freie Gegner-Zeile, oder wieder raus. */
        var kd = UI.overlay && UI.overlay.draft;
        if (!kd || !Array.isArray(kd.gegner)) break;
        if (!Array.isArray(kd.gegnerNach)) kd.gegnerNach = ['', '', '', ''];
        var kName = el.getAttribute('data-name') || '';
        var kDrin = -1, kFrei = -1;
        for (var ki = 0; ki < 4; ki++) {
          if (gegnerVollName(kd, ki) === kName) kDrin = ki;
          if (kFrei < 0 && !gegnerVollName(kd, ki)) kFrei = ki;
        }
        if (!Array.isArray(kd.gegnerTyp)) kd.gegnerTyp = ['', '', '', ''];
        if (kDrin >= 0) { kd.gegner[kDrin] = ''; kd.gegnerNach[kDrin] = ''; kd.gegnerTyp[kDrin] = ''; }
        else if (kFrei >= 0) {
          var kTeile = kName.split(' ');
          kd.gegnerNach[kFrei] = kTeile.length > 1 ? kTeile.pop() : '';
          kd.gegner[kFrei] = kTeile.join(' ');
          /* Wen die Ligaleitung schon als Gast fuehrt, ist auch hier einer. */
          kd.gegnerTyp[kFrei] = el.classList.contains('gast') ? 'gast' : '';
        }
        render();
        break;
      }
      case 'liga-typ': {
        /* Status-Knopf im Start-Dialog: gemeldet -> Gastspieler -> neu melden. */
        var tyD = UI.overlay && UI.overlay.draft;
        if (!tyD) break;
        var tyFeld = el.getAttribute('data-seite') === 'wir' ? 'wirTyp' : 'gegnerTyp';
        if (!Array.isArray(tyD[tyFeld])) tyD[tyFeld] = ['', '', '', ''];
        var tyI = Number(el.getAttribute('data-i'));
        tyD[tyFeld][tyI] = LIGA_TYPEN[(LIGA_TYPEN.indexOf(tyD[tyFeld][tyI] || '') + 1) % LIGA_TYPEN.length];
        UI.overlay.fehler = '';
        render();
        break;
      }
      case 'liga-neu-typ':
        if (UI.overlay && UI.overlay.type === 'liga-wechsel-zu') {
          UI.overlay.draft.typ = el.getAttribute('data-value') === 'gast' ? 'gast' : 'neu';
          UI.overlay.fehler = '';
          render();
        }
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
            modus: UI.uebungGegner || 'mittel', gegner: ['', '', '', ''], gegnerNach: ['', '', '', ''], bestOf: 3, finish: true, geteilt: false,
            wir: utVorschlag.slice(0, 4),
            sie: utVorschlag.slice(4, 8)
          }
        };
        render();
        break;
      }
      case 'uebung-vorwahl':
        UI.uebungGegner = el.getAttribute('data-value') === 'bots' ? (UI.uebungGegner === 'team' || !UI.uebungGegner ? 'mittel' : UI.uebungGegner) : el.getAttribute('data-value');
        render();
        break;
      case 'training-ical': trainingKalender(); break;
      case 'uebung-gegner':
        if (UI.overlay && UI.overlay.type === 'uebung-start') {
          UI.overlay.draft.modus = el.getAttribute('data-value');
          /* Geteilt braucht zwei echte Teams - Bots werfen auf dem einen
             Geraet von selbst. */
          if (UI.overlay.draft.modus !== 'team' && UI.overlay.draft.modus !== 'liga') UI.overlay.draft.geteilt = false;
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
        }).catch(function (e) { zusageFehlgeschlagen(e); });
        break;
      }
      case 'liga-bericht':
        UI.bericht = el.getAttribute('data-termin') || null;
        UI.berichtVon = S.screen;
        UI.overlay = null;   // aus dem Kurz-Bogen heraus: der Dialog geht zu
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
          if (el.getAttribute('data-feld') === 'team' && UI.overlay.draft.teamFest) break;
          UI.overlay.draft[el.getAttribute('data-feld')] = el.getAttribute('data-value');
          UI.overlay.fehler = '';
          render();
        }
        break;
      case 'nm-abbrechen': {
        var nmO = UI.overlay;
        if (!nmO || nmO.type !== 'nachmeldung') break;
        var nmFehler = ligaWechselZurueck(nmO.draft);
        if (nmFehler) { nmO.fehler = nmFehler; render(); break; }
        UI.overlay = { type: 'liga-wechsel' };
        render();
        break;
      }
      case 'nm-weiter':
        nachmeldungWeiter();
        break;
      case 'bericht-unterschreiben':
        berichtUnterschreibenStarten();
        break;
      case 'signatur-nochmal':
        if (UI.overlay && (UI.overlay.type === 'unterschrift' || UI.overlay.type === 'nachmeldung')) { UI.overlay.striche = []; UI.overlay.fehler = ''; render(); }
        break;
      case 'signatur-weiter':
        signaturWeiter();
        break;
      case 'bericht-senden':
        berichtSenden();
        break;
      case 'bericht-senden-teilen':
        if (UI.overlay && UI.overlay.type === 'bericht-versand') { UI.overlay.ohneServer = true; UI.overlay.fehler = ''; }
        berichtSenden();
        break;
      case 'bericht-ohne-senden':
        berichtOhneSendenAbschliessen();
        break;
      case 'liga-zum-spiel':
        S.screen = 'tournament'; save(); render();
        break;
      case 'konto-fehlschlaege-leeren':
        if (window.DartSync && typeof window.DartSync.fehlgeschlagenLeeren === 'function') window.DartSync.fehlgeschlagenLeeren();
        render();
        break;
      case 'liga-zusage': {
        if (!(window.DartSync && window.DartSync.liga && window.DartKonto && window.DartKonto.nutzer())) return;
        var lgTermin = el.getAttribute('data-id');
        /* Bin dabei / Kann nicht: ein Entweder-oder. Die eigene Antwort
           nochmal antippen aendert nichts - austragen gibt es hier nicht,
           wer geantwortet hat, wechselt hoechstens die Antwort. */
        if (el.classList.contains('aktiv')) return;
        var lgStatus = el.getAttribute('data-status');
        window.DartSync.liga.zusage(lgTermin, lgStatus).then(function (z) {
          ligaZusagen = z;
          render();
        }).catch(function (e) { zusageFehlgeschlagen(e); });
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
        if (!UI.overlay || UI.overlay.type !== 'checkout-darts') break;
        var n = Number(el.getAttribute('data-n'));
        var score = UI.overlay.score;
        if (el.blur) el.blur();   // sonst "klickt" ein spaeteres Enter den versteckten Knopf
        var coFin = !!UI.overlay.fin, coKw = !!UI.overlay.kw;
        UI.overlay = null;
        if (coFin) finisherFinishBuchen(n);
        else if (coKw) kaiwenVisit(S.game, score, n, true, false);
        else checkoutBuchen(score, n);
        break;
      }
      case 'co-doppel': {
        if (!UI.overlay || UI.overlay.type !== 'checkout-doppel') break;
        var cdO = UI.overlay, cdD = Number(el.getAttribute('data-d')) || 0;
        if (el.blur) el.blur();
        UI.overlay = null;
        commitVisit(cdO.score, cdO.n, true, false, null, cdD || null);
        break;
      }
      case 'fin-fern':
        UI.menu = false; UI.finFern = true; UI.input = ''; UI.error = '';
        save(); render();
        break;
      case 'fin-fern-aus':
        UI.finFern = false; UI.input = ''; UI.error = '';
        save(); render();
        break;
      case 'kw-fern':
        UI.menu = false; UI.kwFern = true; UI.input = ''; UI.error = '';
        save(); render();
        break;
      case 'kw-fern-aus':
        UI.kwFern = false; UI.kwVerlauf = false; UI.input = ''; UI.error = '';
        save(); render();
        break;
      case 'kw-swap': {
        tipp();
        var kwSt = S.game && S.game.kind === 'kaiwen' ? kaiwenState(S.game) : null;
        if (kwSt && kwSt.offen.length) { UI.error = 'Erst die angefangene Aufnahme fertig werfen oder zurücknehmen.'; render(); break; }
        S.game.eingabe = kaiwenModus() === 'darts' ? 'total' : 'darts';
        UI.input = ''; UI.error = '';
        save(); render();
        break;
      }
      case 'kw-quick':
        if (settling()) break;
        UI.error = ''; UI.input = el.getAttribute('data-value');
        kaiwenAufnahme();
        break;
      case 'kw-end-visit':
        kaiwenAufnahmeEnde();
        break;
        break;
      case 'hu-handicap': {
        tipp();
        if (!S.settings.hunterHandicap || typeof S.settings.hunterHandicap !== 'object') S.settings.hunterHandicap = {};
        S.settings.hunterHandicap[el.getAttribute('data-id')] = Number(el.getAttribute('data-value'));
        save(); render();
        break;
      }
      case 'kw-ende':
        kaiwenBeenden();
        break;
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
      case 'session-ende':
      case 'spiel-ende': {
        /* Session (allein) oder Schnelles Spiel vorzeitig beenden: die
           fertigen Legs kommen ohne Sieger ins Archiv (Average, 180er,
           Finishes zaehlen), dann die Auswertung. Ohne fertiges Leg gibt es
           nichts zu sichern - dann fragt der Abbruch-Dialog. */
        UI.menu = false;
        if (!S.game || S.game.kind !== 'quick') break;
        if (!entschiedeneLegs(S.game)) { UI.overlay = { type: 'confirm-discard-game' }; render(); break; }
        var seId = S.game.id;
        liveEnde(S.game);
        archiveGame(S.game, true);
        S.game = null;
        UI.overlay = null;
        UI.summary = { kind: 'quick', id: seId, from: 'setup' };
        S.screen = 'summary';
        save(); render();
        break;
      }
      case 'key-tippen': {
        /* Allein im Tastatur-Modus: das versteckte Feld bekommt den Fokus,
           damit das Handy seine Zifferntastatur zeigt. */
        var ktFeld = $('key-input');
        if (ktFeld) { ktFeld.value = UI.input; ktFeld.focus(); }
        break;
      }
      case 'schalter': {
        /* Klaenge und Feiern: an oder aus, nichts dazwischen. */
        var sKey = el.getAttribute('data-key');
        S.settings[sKey] = S.settings[sKey] === 0 ? 1 : 0;
        save(); render();
        break;
      }
      case 'willkommen-weg':
        S.settings.willkommenWeg = 1;
        save(); render();
        break;
      case 'ton-an':
        /* Der Tipp hat den Ton schon geweckt (pointerdown in sound.js). */
        setTimeout(function () { tonKnopf(!!liveSpiel()); }, 250);
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
      case 'game-menu':
        UI.menu = true; render();
        break;
      case 'game-menu-zu':
        UI.menu = false; render();
        break;
      case 'game-fern':
        tipp();
        UI.menu = false;
        fernsteuerung(!UI.turnier);
        break;
      case 'game-swap': {
        tipp();
        /* Ein Tipp wechselt zwischen Punkten und Einzel-Darts. */
        var gsJetzt = UI.letzterModus === 'kamera' ? 'darts' : UI.letzterModus;
        waehleEingabemodus(gsJetzt === 'darts' ? 'total' : 'darts');
        break;
      }
      case 'game-kamera':
        UI.menu = false;
        waehleEingabemodus('kamera');
        break;
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
      /* Nur das Ergebnis eines Einzels (Modus "Nur Ergebnisse" oder ein
         Einzel, das der Gegner gezaehlt hat): Leg-Stand ohne Wuerfe. */
      case 'liga-ergebnis': {
        var leM0 = matchById(el.getAttribute('data-id'));
        if (!leM0 || !(S.tour && S.tour.liga) || leM0.void || leM0.belegtVon) break;
        /* Ein hier angefangenes Einzel wird zu Ende gespielt, nicht ueberschrieben. */
        if (!leM0.ergebnis && (leM0.kampflos || leM0.legs.some(function (l) { return l.visits.length > 0; }))) break;
        UI.overlay = { type: 'liga-ergebnis', id: leM0.id };
        render();
        break;
      }
      case 'liga-ergebnis-setzen': {
        var lsM = matchById(el.getAttribute('data-id'));
        if (!lsM || !(S.tour && S.tour.liga) || lsM.void) break;
        if (!lsM.ergebnis && (lsM.kampflos || lsM.legs.some(function (l) { return l.visits.length > 0; }))) break;
        if (lsM.done && geteiltesTurnier()) break;
        var lsH = Number(el.getAttribute('data-h')), lsG = Number(el.getAttribute('data-g'));
        var lsWin = legsToWin();
        if (!(lsH === lsWin && lsG >= 0 && lsG < lsWin) && !(lsG === lsWin && lsH >= 0 && lsH < lsWin)) break;
        ergebnisSetzen(lsM, lsH, lsG, tourStart(), Date.now());
        if (S.tour.liga && !S.tour.liga.zeitBis && !nextOpenMatch()) S.tour.liga.zeitBis = Date.now();
        UI.overlay = null;
        save();
        /* Im geteilten Spiel steht das Ergebnis sofort auch am anderen Geraet. */
        if (geteiltesTurnier() && window.DartSync && window.DartSync.turnier) {
          window.DartSync.turnier.ergebnis(lsM);
        }
        render();
        break;
      }
      case 'liga-ergebnis-zurueck': {
        var lzM = matchById(UI.overlay && UI.overlay.id);
        if (!lzM || !lzM.ergebnis || geteiltesTurnier()) break;
        lzM.done = false;
        lzM.ergebnis = false;
        lzM.winner = null;
        lzM.at = null;
        lzM.legs = [];
        if (S.tour.liga && S.tour.liga.zeitBis && nextOpenMatch()) S.tour.liga.zeitBis = null;
        UI.overlay = null;
        save(); render();
        break;
      }
      case 'liga-mitschreiben':
        if (UI.overlay && UI.overlay.type === 'liga-start') {
          UI.overlay.draft.nurErgebnis = el.getAttribute('data-value') === '1';
          render();
        }
        break;
      /* Ergebnisse eines schon gemeldeten Spieltags vom Bogen der
         Ligaleitung uebernehmen - Zuordnung der Namen zu Konten vorher. */
      case 'liga-nachtrag': {
        if (ichBinGastKonto()) break;
        if ((S.game && !S.game.done) || (S.matches.length && !allMatchesDone())) {
          UI.overlay = { type: 'hinweis', text: 'Es läuft noch ein Spiel oder Turnier – bitte erst abschließen oder beenden.' };
          render();
          break;
        }
        var ntTermin = null;
        LIGA.termine.forEach(function (t) { if (t.id === el.getAttribute('data-id')) ntTermin = t; });
        var ntBogen = ntTermin ? ligaBogenEintrag(ntTermin) : null;
        if (!ntTermin || !ntBogen || ligaTerminBelegt(ntTermin)) break;
        var ntZu = {}, ntVergeben = [];
        nachtragNamen(ntBogen, ntBogen.heim === LIGA.team).forEach(function (nm) {
          var id = nachtragVorschlag(nm, ntVergeben);
          ntZu[nm] = id;
          if (id) ntVergeben.push(id);
        });
        UI.overlay = { type: 'liga-nachtrag', termin: ntTermin, bogen: ntBogen, draft: { zuordnung: ntZu } };
        render();
        break;
      }
      case 'liga-nachtrag-los':
        ligaNachtragUebernehmen();
        break;
      case 'liga-bericht-kurz':
        UI.overlay = { type: 'liga-bericht-kurz' }; render();
        break;
      /* Teilen aus dem Bogen: unterschrieben geht es gleich zum Versand,
         sonst zum Bogen (dort wird unterschrieben). */
      case 'liga-bericht-teilen': {
        UI.bericht = null; UI.berichtVon = S.screen; S.screen = 'bericht';
        UI.overlay = null;
        save(); render();
        var btq = ligaBerichtQuelle();
        if (btq && berichtIstFinal(btq.liga)) { berichtVersandOeffnen(); render(); }
        break;
      }
      case 'liga-wechsel-neu': {
        var lwn = UI.overlay;
        if (!lwn || lwn.type !== 'liga-wechsel-zu') break;
        var lwnId = el.getAttribute('data-id');
        lwn.draft.neu = lwn.draft.neu === lwnId ? '' : lwnId;
        lwn.draft.name = ''; lwn.draft.nach = ''; lwn.fehler = '';
        render();
        break;
      }
      case 'reset-art':
        if (UI.overlay && UI.overlay.type === 'confirm-reset') { UI.overlay.art = el.getAttribute('data-value'); render(); }
        break;
      case 'liga-wechsel-pos': {
        var lwSeite = el.getAttribute('data-seite');
        var lwPos = Number(el.getAttribute('data-pos'));
        var lwLg = S.tour && S.tour.liga;
        if (!lwLg) break;
        var unsere = lwLg.heim ? 'H' : 'G';
        var lwEigene = lwSeite === unsere;
        UI.overlay = {
          type: 'liga-wechsel-zu', seite: lwSeite, pos: lwPos,
          eigene: lwEigene,
          draft: { neu: '', name: '', nach: '' }
        };
        render();
        break;
      }
      case 'liga-wechsel-ok': {
        var lo = UI.overlay;
        if (!lo || lo.type !== 'liga-wechsel-zu') break;
        var loLg = S.tour.liga;
        var neuId, loSpontan = false, loNeuAngelegt = false;
        if (lo.draft.neu) {
          neuId = lo.draft.neu;
        } else {
          var loVor = String(lo.draft.name || '').trim(), loNach = String(lo.draft.nach || '').trim();
          if (!loVor || !loNach) {
            lo.fehler = 'Bitte einen Spieler wählen oder Vor- und Nachnamen eintragen.'; render(); break;
          }
          var loName = (loVor.slice(0, 30) + ' ' + loNach.slice(0, 30)).replace(/\s+/g, ' ').trim();
          /* Nur die AKTIVE Besetzung ausschließen: wer auf der Bank sitzt,
             wird am Namen wiedererkannt und darf zurückwechseln – sonst
             entstünde ein zweites Profil desselben Menschen. */
          var loVorher = S.profiles.length;
          neuId = ligaGastId(loName, loLg.posH.concat(loLg.posG));
          loNeuAngelegt = S.profiles.length > loVorher;
          loSpontan = (loLg.heimSpieler || []).indexOf(neuId) < 0 && (loLg.gastSpieler || []).indexOf(neuId) < 0;
        }
        /* Spontaner Name als Gastspieler (statt Nachmeldung): nur einer je
           Seite, dann ohne Unterschrift auf den Bogen. */
        var loGast = loSpontan && lo.draft.typ === 'gast';
        if (loGast && ligaGaeste(loLg, lo.seite, neuId) >= 1) { lo.fehler = LIGA_GAST_FEHLER; render(); break; }
        var loRaus = (lo.seite === 'H' ? loLg.posH : loLg.posG)[lo.pos];
        var loFehler = ligaWechseln(lo.seite, lo.pos, neuId);
        if (loFehler) { lo.fehler = loFehler; render(); break; }
        if (loGast) {
          ligaTypSetzen(loLg, neuId, 'gast');
          save();
          if (geteiltesTurnier()) geteiltenPlanSenden();
          UI.overlay = { type: 'liga-wechsel' };
          render(); break;
        }
        /* Ein spontan eingewechselter Name ist eine Nachmeldung: gleich
           weiter zu Alter, Geschlecht und Unterschrift fuer den Bogen. Der
           Spieler steht schon auf dem Bogen - das Overlay kennt ihn (id),
           das Team steht fest, und "Abbrechen" nimmt den Wechsel zurueck. */
        if (loSpontan) {
          var loP = profile(neuId), loTeile = vollSplit(loP && loP.voll);
          var loDraft = { team: lo.seite, teamFest: true, id: neuId, neuAngelegt: loNeuAngelegt,
            wechsel: { seite: lo.seite, pos: lo.pos, raus: loRaus },
            nach: loTeile.nach || '', vor: loTeile.vor || '', u18: 'nein', g: null };
          /* Ueberlebt ein Neuladen: ohne Nachmeldung darf niemand auf dem
             Bogen bleiben (nachmeldungWiederherstellen). Nur auf diesem
             Geraet - der Plan des geteilten Spiels traegt es nicht. */
          S.nmOffen = { id: neuId, team: lo.seite, wechsel: loDraft.wechsel, neuAngelegt: loNeuAngelegt, nach: loDraft.nach, vor: loDraft.vor };
          UI.overlay = { type: 'nachmeldung', draft: loDraft, striche: [] };
          save(); render(); break;
        }
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
      case 'ov-reset': {
        var orArt = UI.overlay && UI.overlay.type === 'confirm-reset' ? UI.overlay.art : null;
        if (S.tour && S.tour.liga && orArt === 'verwerfen') {
          /* Nichts speichern: wie ein verworfenes freies Spiel. */
          if (geteiltesTurnier() && window.DartSync && window.DartSync.turnier) window.DartSync.turnier.ende();
          S.matches = []; S.current = null; S.tour = null;
        } else {
          if (S.tour && S.tour.liga && orArt === 'kampflos') ligaOffeneKampflos();
          archiveTournament();
        }
        UI.overlay = null;
        S.screen = 'setup';
        save(); render();
        break;
      }
    }
  }

  /* ================= Events ================= */
  /* Ein Tipp neben den Dialog schließt ihn – außer dort, wo eine Antwort
     nötig ist (Checkout-Abfrage, Spielende). */
  var STICKY_OVERLAYS = { 'checkout-darts': 1, 'checkout-doppel': 1, 'leg-done': 1, 'match-done': 1, 'game-done': 1, 'turnier-ende': 1 };
  /* Vollbild-Dialoge haben keinen "Rand daneben" - ein Tipp auf leere Flaeche
     (oder beim Unterschreiben knapp neben das Feld) schliesst sie nicht. */
  var VOLLBILD_DIALOGE = { 'liga-start': 1, 'uebung-start': 1, 'unterschrift': 1, 'bericht-versand': 1, 'liga-nachtrag': 1, 'mitteilungen': 1 };
  /* Die Dialoge des Ligaspiels (Entwurf Okt. 2026): breite Bogen,
     linksbuendig, mit Spalten - Wechseln, Nachmelden, Beenden, Spielbericht. */
  var BOGEN_DIALOGE = { 'liga-wechsel': 1, 'liga-wechsel-zu': 1, 'nachmeldung': 1, 'liga-bericht-kurz': 1, 'finish': 1 };
  /* Dialoge mit Eingaben und Unterschrift gehen nur ueber ihre Knoepfe zu -
     ein Strich knapp neben dem Feld, Escape oder "Zurueck" wirft sonst
     alles weg (und nach einem spontanen Wechsel bliebe der Spieler ohne
     Nachmeldung auf dem Bogen). */
  var FESTE_DIALOGE = { 'nachmeldung': 1 };
  function bleibtOffen(typ) { return !!(STICKY_OVERLAYS[typ] || VOLLBILD_DIALOGE[typ] || FESTE_DIALOGE[typ]); }
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
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-role') === 'foto-zoom' && UI.foto) render();
  });
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
    if (S.screen === 'kaiwen') return kaiwenDart(mult, num);
    if (S.screen === 'hunter') return hunterDart(mult, num);
    if (S.screen !== 'game') return false;
    if (num === 0) return pushDart(1, 0);
    if (num === 25) return pushDart(mult >= 2 ? 2 : 1, 25);
    return pushDart(mult, num);
  }

  /* Fernsteuerung (Board-Anzeige, Eingabe ueber Tastatur) ein- oder
     ausschalten. Beim Ausschalten entscheidet wieder die Einzel-Dart-Grenze,
     welches Tastenfeld steht - kein Modus wird festgenagelt. */
  function fernsteuerung(an) {
    if (an) { waehleEingabemodus('turnier'); return; }
    if (!UI.turnier) return;
    UI.turnier = false;
    S.settings.turnierModus = 0;
    UI.input = ''; UI.error = ''; UI.modeOverride = null;
    save(); render();
  }

  document.addEventListener('click', function (ev) {
    if (isGhostTap(ev)) return;
    /* Der click zur gerade per pointerdown gebuchten Spieltaste: schon erledigt. */
    if (tasteSchonGetippt && Date.now() - tasteSchonGetipptZeit < 1200 && spielTaste(ev.target) === tasteSchonGetippt) {
      tasteSchonGetippt = null;
      return;
    }
    if (ev.target.id === 'overlay' && UI.overlay && !bleibtOffen(UI.overlay.type)) {
      UI.overlay = null; UI.input = ''; render(); return;
    }
    /* Menue (•••): ein Tipp neben die Karte schliesst es. */
    if (/^(game|cricket|rtw|fin|kw|hu)-menu-overlay$/.test(ev.target.id || '')) { UI.menu = false; render(); return; }
    /* Ein Tipp ins Bild tut in der Fernsteuerung nichts (Julius): das Menue
       oeffnet nur •••, zurueck geht es ueber den ⌨-Knopf oben rechts. */
    var t = ev.target.closest('[data-action]');
    if (t) {
      /* Im Spielbild behaelt kein Knopf den Fokus: ein spaeteres Enter an
         der Tastatur wuerde ihn sonst noch einmal druecken (Wechsel-Knopf,
         versteckte Finish-Frage). */
      if (SPIEL_SCREENS[S.screen] && t.blur && !t.closest('input, select, textarea')) t.blur();
      handleAction(t.getAttribute('data-action'), t); return;
    }

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

    spielTasteTipp(ev.target);
  });

  /*
   * Die Spieltasten (Zahlenfeld, Schnellwahl, Einzel-Darts, Double/Triple)
   * reagieren am Touch-Geraet schon beim Aufsetzen des Fingers (pointerdown),
   * nicht erst beim "click": iOS liefert den click nur, wenn der Finger
   * praktisch still liegt und kein Scroll beginnt - beim schnellen Tippen am
   * iPad gingen so Eingaben verloren (Julius, 08.11.: "muss drei Mal
   * tippen"). Maus und Tastatur bleiben beim click (Doppelausloesung
   * verhindert `tasteSchonGetippt`). Innerhalb des Ghost-Tap-Fensters nach
   * einem Bildschirmwechsel bleibt es beim click mit seiner Doppeltipp-
   * Pruefung. Welche Tasten: nur die im Spielbild, kein Dialog, kein Menue.
   */
  var tasteSchonGetippt = null, tasteSchonGetipptZeit = 0;
  function spielTaste(ziel) {
    if (!ziel || !ziel.closest) return null;
    return ziel.closest('.keypad button, .kw-keys button, [data-quick], .mult-row button, .num-grid button.mult, [data-bull], [data-num]');
  }
  function spielTasteTipp(ziel) {
    var key2 = ziel.closest('.keypad button, .kw-keys button');
    if (key2) { if (S.screen === 'kaiwen') kaiwenKey(key2.getAttribute('data-key')); else pressKey(key2.getAttribute('data-key')); return true; }

    var quick = ziel.closest('[data-quick]');
    if (quick) {
      if (settling() || quickDoubleTap(quick.getAttribute('data-quick'))) return true;
      UI.error = '';
      UI.input = quick.getAttribute('data-quick');
      submitTotal();
      return true;
    }

    var mult = ziel.closest('.mult-row button');
    if (mult) { tipp(); UI.mult = Number(mult.getAttribute('data-mult')); render(); return true; }
    /* Double/Triple im X01-Zahlenfeld sind Schalter: Tipp an, nochmal Tipp
       aus (keiner an heisst Single); sie schliessen sich gegenseitig aus. */
    var schalter = ziel.closest('.num-grid button.mult');
    if (schalter) {
      tipp();
      var sm = Number(schalter.getAttribute('data-mult'));
      UI.mult = UI.mult === sm ? 1 : sm;
      render(); return true;
    }

    var bull = ziel.closest('[data-bull]');
    if (bull) { spielDart(2, 25); return true; }

    var num = ziel.closest('[data-num]');
    if (num) {
      var n2 = Number(num.getAttribute('data-num'));
      var own = num.getAttribute('data-mult');
      spielDart(own ? Number(own) : UI.mult, n2);
      return true;
    }
    return false;
  }
  document.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    if (!ev.isPrimary || ev.button !== 0) return;
    if (UI.overlay || UI.menu) return;
    if (Date.now() <= ghostTapUntil) return;
    var taste = spielTaste(ev.target);
    if (!taste || taste.disabled || !taste.closest('#screen-game, #screen-kaiwen, #screen-finisher')) return;
    tasteSchonGetippt = taste; tasteSchonGetipptZeit = Date.now();
    spielTasteTipp(taste);
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
      /* Was jemand schon angefasst hat, ueberschreibt die Serverliste nicht mehr. */
      if (!UI.overlay.beruehrt) UI.overlay.beruehrt = {};
      UI.overlay.beruehrt[Number(ev.target.getAttribute('data-i'))] = true;
    }
    if (ev.target.getAttribute('data-role') === 'profile-name' && UI.overlay) {
      UI.overlay.draft.name = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'fi-avg' && UI.overlay && UI.overlay.type === 'finish') {
      UI.overlay.draft.avg = ev.target.value;
    }
    /* Flaeche "Profil bearbeiten": dieselben Rollen wie der Dialog, dazu
       Kuerzel und E-Mail. */
    if (UI.profilEdit && !UI.overlay) {
      var peRole = ev.target.getAttribute('data-role');
      if (peRole === 'profile-name') UI.profilEdit.name = ev.target.value;
      if (peRole === 'pe-kuerzel') UI.profilEdit.kuerzel = ev.target.value;
      if (peRole === 'profile-vor') UI.profilEdit.vor = ev.target.value;
      if (peRole === 'profile-nach') UI.profilEdit.nach = ev.target.value;
      if (peRole === 'pe-email') UI.profilEdit.email = ev.target.value;
      if (peRole === 'pe-email-pass') UI.profilEdit.emailPass = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'foto-zoom' && UI.foto) {
      UI.foto.zoom = Number(ev.target.value) || 0;
      var fzB = $('pf-buehne'), fzImg = fzB && fzB.querySelector('.pf-bild');
      if (fzImg) { var fzG = fotoGeometrie(UI.foto, 1000); fzImg.style.left = (fzG.left / 10).toFixed(2) + '%'; fzImg.style.top = (fzG.top / 10).toFixed(2) + '%'; fzImg.style.width = (fzG.w / 10).toFixed(2) + '%'; fzImg.style.height = (fzG.h / 10).toFixed(2) + '%'; }
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
      var lpD = UI.overlay.draft, lpI = Number(ev.target.getAttribute('data-i'));
      var lpWar = lpD.wir[lpI] === '__name', lpWird = ev.target.value === '__name';
      lpD.wir[lpI] = ev.target.value;
      /* "Anderer Name": Namensfelder darunter, als Gastspieler voreingestellt;
         nur dann neu zeichnen (sonst springt die Auswahl unter dem Finger weg). */
      if (lpWird) {
        if (!Array.isArray(lpD.wirTyp)) lpD.wirTyp = ['', '', '', ''];
        if (!lpD.wirTyp[lpI]) lpD.wirTyp[lpI] = 'gast';
      }
      if (lpWar !== lpWird) render();
    }
    if ((ev.target.getAttribute('data-role') === 'liga-wir-vor' || ev.target.getAttribute('data-role') === 'liga-wir-nach') && UI.overlay && UI.overlay.draft) {
      var lwD = UI.overlay.draft, lwI = Number(ev.target.getAttribute('data-i'));
      if (!Array.isArray(lwD.wirNamen)) lwD.wirNamen = [{}, {}, {}, {}];
      if (!lwD.wirNamen[lwI]) lwD.wirNamen[lwI] = {};
      lwD.wirNamen[lwI][ev.target.getAttribute('data-role') === 'liga-wir-vor' ? 'vor' : 'nach'] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'uebung-sie' && UI.overlay && UI.overlay.draft) {
      UI.overlay.draft.sie[Number(ev.target.getAttribute('data-i'))] = ev.target.value;
    }
    if (ev.target.getAttribute('data-role') === 'nachtrag-wer' && UI.overlay && UI.overlay.type === 'liga-nachtrag') {
      var ntName = ev.target.getAttribute('data-name'), ntWert = ev.target.value;
      if (ntWert === '__neu') {
        /* Dauerhafter Gast mit dem Namen vom Bogen - sichtbar in der
           Spielerliste, damit man ihn spaeter einem Konto zuordnen kann. */
        var ntNeu = { id: uid(), name: ntName.slice(0, 30), voll: ntName, avatar: null, hue: freeHue(), created: Date.now(), gast: true, dauer: true };
        S.profiles.push(ntNeu);
        ntWert = ntNeu.id;
        save();
      }
      UI.overlay.draft.zuordnung[ntName] = ntWert;
      if (UI.overlay.fehlt) UI.overlay.fehlt = UI.overlay.fehlt.filter(function (n) { return n !== ntName; });
      render();
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

  function bildGewaehlt(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (UI.profilPanel === 'foto' && UI.foto) { UI.foto.laedt = true; render(); fotoLaden(file); return; }
    if (!UI.overlay) return;
    readAvatar(file, function (dataUrl) {
      if (dataUrl && UI.overlay) { UI.overlay.draft.avatar = dataUrl; render(); }
    });
  }
  $('avatar-input').addEventListener('change', bildGewaehlt);
  if ($('avatar-kamera')) $('avatar-kamera').addEventListener('change', bildGewaehlt);

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
    if (wurf > MAX_VISIT) { UI.error = 'Das wären ' + wurf + ' Punkte – mehr als ' + MAX_VISIT + '.'; UI.input = ''; render(); return; }
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
  /* Kurzstatistik eines Legs fuer die Dialoge nach dem Leg: je Spieler
     Average, Darts, hoechste Aufnahme und Finish - der Leg-Sieger hell. */
  function legStatHTML(m, leg) {
    if (!m || !leg || !leg.visits || !leg.visits.length) return '';
    var st = collectStats([{ matches: [{ p: m.p, legs: [leg] }], start: matchStart(m) }], m.p);
    m.p.forEach(function (id) { finalize(st[id]); });
    var zeilen = [
      ['Ø', function (s) { return s.darts ? s.avg.toFixed(1) : '–'; }],
      ['Darts', function (s) { return s.darts || '–'; }],
      ['Höchste', function (s) { return s.highScore || '–'; }],
      ['Finish', function (s) { return s.highCO || '–'; }]
    ];
    /* Schnelles Spiel ueber mehrere Legs: darunter der Average des ganzen
       Spiels bis hierher - zwischen den Legs sieht man so, wo man steht
       (Julius, 10.11.2026). */
    var fertigeLegs = m.legs.filter(function (l) { return l.winner; });
    if (m.kind === 'quick' && !m.session && fertigeLegs.length && (m.bestOf || 1) > 1) {
      var gesamt = collectStats([{ matches: [{ p: m.p, legs: fertigeLegs }], start: matchStart(m) }], m.p);
      m.p.forEach(function (id) { finalize(gesamt[id]); });
      zeilen.push(['Ø Spiel', function (s, id) { return gesamt[id].darts ? gesamt[id].avg.toFixed(1) : '–'; }]);
    }
    var kl = function (id) { return id === leg.winner ? ' class="sieger"' : ''; };
    return '<table class="leg-stat' + (m.p.length > 2 ? ' viele' : '') + '"><thead><tr><th></th>' +
      m.p.map(function (id) { return '<th' + kl(id) + '>' + esc(pname(id)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      zeilen.map(function (z) {
        return '<tr><th>' + z[0] + '</th>' + m.p.map(function (id) { return '<td' + kl(id) + '>' + z[1](st[id], id) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function legDoneUebersicht() {
    var m = currentMatch();
    return !!(m && m.kind !== 'quick' && !S.game && S.matches.indexOf(m) >= 0);
  }
  /* Der dritte Knopf im Leg-Dialog: Session beenden, zur Turnieruebersicht
     oder - im Schnellen Spiel ueber mehrere Legs - das Spiel vorzeitig
     beenden und die gespielten Legs behalten (Julius, 10.11.2026: nach
     drei Legs bei 1:2 einfach Schluss machen koennen). */
  function legDoneDritte(m) {
    if (!m) return null;
    if (m.session) return 'session-ende';
    if (legDoneUebersicht()) return 'to-tournament';
    if (m.kind === 'quick' && S.game && S.game.id === m.id && entschiedeneLegs(m) > 0) return 'spiel-ende';
    return null;
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
  var ZIFFERN_BLEIBEN = { 'checkout-darts': 1, 'checkout-doppel': 1, 'edit-visit': 1, 'match-done': 1, 'game-done': 1 };
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
      /* Nicht in den Spielbildern - auch nicht hinter dem offenen Menue:
         wer dort aus Gewohnheit eine Aufnahme tippt, soll nichts ausloesen. */
      : S.screen === 'bulloff' || S.screen === 'tournament' || (!!PFEIL_SCREENS[S.screen] && !SPIEL_SCREENS[S.screen]);
    if (!passt) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: pfeil, code: pfeil, bubbles: true, cancelable: true }));
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && UI.overlay && !bleibtOffen(UI.overlay.type)) {
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
    if (ev.key === 'Tab' && !UI.overlay && !UI.menu && S.screen === 'game') {
      ev.preventDefault();
      var mFolge = ['total', 'darts'];
      if (turnierErlaubt()) mFolge.push('turnier');
      if (window.DartKamera) mFolge.push('kamera');
      var mJetzt = mFolge.indexOf(UI.letzterModus) >= 0 ? UI.letzterModus : 'total';
      var mNeu = mFolge[(mFolge.indexOf(mJetzt) + 1) % mFolge.length];
      /* Aus der Fernsteuerung heraus wie der ⌨-Knopf: kein Modus wird
         festgenagelt, die Einzel-Dart-Grenze entscheidet wieder. */
      if (mJetzt === 'turnier' && mNeu === 'total') fernsteuerung(false);
      else waehleEingabemodus(mNeu);
      return;
    }
    /* Esc (bzw. ⌘+. am Magic Keyboard ohne Esc-Taste) beendet den
       Turnier-Modus direkt. */
    var istAusstieg = ev.key === 'Escape' ||
      (ev.key === '.' && (ev.metaKey || ev.ctrlKey));
    if (istAusstieg && !UI.overlay && SPIEL_SCREENS[S.screen] && UI.menu) {
      ev.preventDefault();
      UI.menu = false; render();
      return;
    }
    if (istAusstieg && !UI.overlay && S.screen === 'game' && UI.turnier) {
      ev.preventDefault();
      fernsteuerung(false);
      return;
    }
    /* Auswertung nach dem Spiel: Enter nimmt die Hauptaktion (Weiter bzw.
       Speichern), Esc den Weg zurueck - am Board ohne Maus. */
    if (S.screen === 'summary' && !UI.overlay && (ev.key === 'Enter' || ev.key === 'Escape') &&
        !(ev.target && ev.target.closest && ev.target.closest('button, a, input, select, [role="button"]'))) {
      var saKnoepfe = document.querySelectorAll('#summary-actions [data-action]');
      var saZiel = null;
      if (ev.key === 'Escape') saZiel = document.querySelector('#screen-summary [data-action="summary-back"], #summary-actions [data-action="finish-game"]');
      if (!saZiel) saZiel = document.querySelector('#summary-actions .btn.primary[data-action], #summary-actions .btn.start-rot[data-action]') || saKnoepfe[0];
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
    if (S.screen !== 'game' || UI.overlay || UI.menu) return;
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
    if (S.screen !== 'game' || !UI.turnier || UI.overlay || UI.menu) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    /* Das versteckte Feld des Solo-Tastatur-Modus hat seine eigenen Regeln (unten). */
    if (document.activeElement && document.activeElement.id === 'key-input') return;
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

  /* Solo-Tastatur-Modus am Handy: ein Tipp auf die Anzeige (key-tippen)
     fokussiert dieses versteckte Feld, und das Handy zeigt seine
     Zifferntastatur. Was dort getippt wird, landet in UI.input wie am
     Board; Enter bucht, Loeschen im leeren Feld nimmt die Aufnahme zurueck.
     Eine echte Tastatur laeuft weiter ueber den Handler darueber. */
  (function () {
    var feld = $('key-input');
    if (!feld) return;
    feld.addEventListener('input', function () {
      if (S.screen !== 'game' || !UI.turnier || UI.overlay || UI.menu) { feld.value = UI.input; return; }
      var neu = String(feld.value || '').replace(/\D/g, '').slice(0, 3);
      if (neu !== feld.value) feld.value = neu;
      if (neu === UI.input) return;
      UI.input = neu; UI.error = '';
      render();
    });
    feld.addEventListener('keydown', function (ev) {
      if (S.screen !== 'game' || !UI.turnier || UI.overlay || UI.menu) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (UI.input !== '') { UI.error = ''; ev.eingabeGebucht = true; submitTotal(); }
      } else if (ev.key === 'Backspace' && !feld.value) {
        ev.preventDefault();
        undo();
      } else if (ev.key === 'Escape') {
        feld.blur();
      }
    });
  })();

  /* Finisher-Fernsteuerung: Ziffern in die Anzeige, Enter bucht die
     Aufnahme, Loeschen nimmt erst Ziffern und dann den letzten Dart zurueck,
     Esc fuehrt zur Eingabe zurueck. */
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'finisher' || !UI.finFern || UI.overlay || UI.menu) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var fg = S.game;
    if (!fg || fg.kind !== 'finisher') return;
    if (ev.key === 'Escape') { UI.finFern = false; UI.input = ''; save(); render(); ev.preventDefault(); return; }
    if (fg.done) return;
    /* Clear bucht den eingetippten Rest, Minus einen Bust - wie im X01. */
    if (istRestTaste(ev)) {
      ev.preventDefault();
      if (UI.input === '') { UI.error = 'Erst den Rest eintippen, dann clear.'; render(); return; }
      var fSt = finisherState(fg);
      var fRest = fSt.rest[fg.players[fSt.turn]];
      var fNeu = parseInt(UI.input, 10);
      if (fNeu > fRest) { UI.error = 'Rest ' + fNeu + ' ist mehr als vorher (' + fRest + ').'; UI.input = ''; render(); return; }
      ev.eingabeGebucht = true;
      finisherAufnahmeTippen(fRest - fNeu);
      return;
    }
    if (istUeberworfenTaste(ev)) { ev.preventDefault(); finisherUeberworfen(); return; }
    var zFin = tasteZiffer(ev);
    if (zFin !== null) {
      if (UI.input.length < 3) { UI.input = UI.input === '0' ? zFin : UI.input + zFin; UI.error = ''; render(); }
      ev.preventDefault();
    } else if (ev.key === 'Enter') {
      if (UI.input !== '') { ev.eingabeGebucht = true; finisherAufnahmeTippen(parseInt(UI.input, 10)); }
      ev.preventDefault();
    } else if (ev.key === 'Backspace') {
      if (UI.input) { klick(); UI.input = UI.input.slice(0, -1); UI.error = ''; render(); }
      else undoFinisher(fg);
      ev.preventDefault();
    }
  });

  /* Kaiwen: Ziffern tippen die Aufnahme, Enter bucht sie, Backspace
     loescht bzw. nimmt zurueck, Escape beendet die Fernsteuerung. */
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'kaiwen' || UI.overlay || UI.menu) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var kg = S.game;
    if (!kg || kg.kind !== 'kaiwen') return;
    var at = document.activeElement;
    if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return;
    if (ev.key === 'Escape' && UI.kwFern) { UI.kwFern = false; UI.kwVerlauf = false; UI.input = ''; save(); render(); ev.preventDefault(); return; }
    if (kg.done) return;
    if (ev.key.toLowerCase() === 'z' && !UI.kwFern) { undoKaiwen(kg); ev.preventDefault(); return; }
    if (kaiwenModus() !== 'total') return;
    /* Wie im X01: Clear bucht den eingetippten Rest, Minus einen Bust. */
    if (istRestTaste(ev)) {
      ev.preventDefault();
      if (UI.input === '') { UI.error = 'Erst den Rest eintippen, dann clear.'; render(); return; }
      var kwSt = kaiwenState(kg);
      var kwNeu = parseInt(UI.input, 10);
      if (kwNeu > kwSt.rest) { UI.error = 'Rest ' + kwNeu + ' ist mehr als vorher (' + kwSt.rest + ').'; UI.input = ''; render(); return; }
      UI.input = String(kwSt.rest - kwNeu);
      kaiwenAufnahme();
      return;
    }
    if (istUeberworfenTaste(ev)) {
      ev.preventDefault();
      if (kaiwenState(kg).offen.length) { UI.error = 'Die Aufnahme läuft in Einzel-Darts, bitte dort weiter eintragen.'; render(); return; }
      UI.input = ''; UI.error = ''; pomp();
      kaiwenVisit(kg, 0, 3, false, true);
      return;
    }
    var zKw = tasteZiffer(ev);
    if (zKw !== null) { kaiwenKey(zKw); ev.preventDefault(); }
    else if (ev.key === 'Enter') {
      /* Dieses Enter ist verbraucht: oeffnet es die Finish-Frage, darf der
         Dialog-Handler dahinter sie nicht mit demselben Enter bestaetigen. */
      ev.eingabeGebucht = true; kaiwenKey('ok'); ev.preventDefault();
    }
    else if (ev.key === 'Backspace') { kaiwenKey('del'); ev.preventDefault(); }
  });

  /* Hunter: 1, 2, 3 sind Single, Doppel, Triple aufs Zielfeld, die Leertaste
     ein Miss, Enter ein Bust (der Rest der Aufnahme verfaellt), Backspace
     oder Z nimmt den Dart zurueck. Im Capture-Lauf, damit kein fokussierter
     Knopf die Taste doppelt ausloest; keyup faengt den Klick ab, den die
     Leertaste sonst nachreicht. */
  function hunterTaste(ev) {
    if (S.screen !== 'hunter' || UI.overlay || UI.menu) return null;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return null;
    var at = document.activeElement;
    if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return null;
    if (ev.key === 'Enter') return 'bust';
    if (ev.key === '1' || ev.key === '2' || ev.key === '3') return 'treffer' + ev.key;
    if (ev.key === ' ') return 'miss';
    if (ev.key === 'Backspace' || ev.key.toLowerCase() === 'z') return 'zurueck';
    return null;
  }
  document.addEventListener('keydown', function (ev) {
    var was = hunterTaste(ev);
    if (!was) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (ev.repeat) return;
    if (was === 'zurueck') { handleAction('undo-game', null); return; }
    var hg = S.game;
    if (!hg || hg.kind !== 'hunter' || hg.done) return;
    if (was === 'bust') { hunterBust(); return; }
    if (was === 'miss') { spielDart(1, 0); return; }
    var hZiel = document.querySelector('#hu-pad .hu-key.gross');
    if (hZiel) spielDart(Number(was.slice(-1)), Number(hZiel.getAttribute('data-num')));
  }, true);
  document.addEventListener('keyup', function (ev) { if (hunterTaste(ev)) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);

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

  /* Kaiwen-Fernsteuerung: "+" (oder Shift) zeigt die Aufnahmen des
     laufenden Versuchs gross, solange die Taste gedrueckt bleibt. */
  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'kaiwen' || !UI.kwFern || UI.overlay || UI.menu) return;
    if (!(ev.key === '+' || ev.code === 'NumpadAdd' || ev.key === 'Shift')) return;
    ev.preventDefault();
    if (!UI.kwVerlauf) { UI.kwVerlauf = true; render(); }
  });
  document.addEventListener('keyup', function (ev) {
    if (!UI.kwVerlauf) return;
    if (!(ev.key === '+' || ev.code === 'NumpadAdd' || ev.key === 'Shift')) return;
    UI.kwVerlauf = false; render();
  });
  window.addEventListener('blur', function () { if (UI.kwVerlauf) { UI.kwVerlauf = false; render(); } });
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
    if (!UI.overlay) return;
    /* Im Finisher gilt nur die Finish-Frage der Fernsteuerung - alles
       andere gehoert dem X01-Spielbild. */
    if (S.screen !== 'game' && !(S.screen === 'finisher' && UI.overlay.fin) && !(S.screen === 'kaiwen' && UI.overlay.kw)) return;
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
           Aufnahme (aus einer getippten 5 würde still eine 95). Auch die
           spaeteren Tastatur-Handler (Kaiwen, Finisher) sehen sie nicht. */
        ev.preventDefault(); ev.stopImmediatePropagation();
        var anz = parseInt(zCo, 10);
        if (anz >= 1 && anz <= 3 && ov.options.indexOf(anz) >= 0) {
          var coScore = ov.score, coFin = !!ov.fin, coKw = !!ov.kw;
          UI.overlay = null;
          if (coFin) finisherFinishBuchen(anz); else if (coKw) kaiwenVisit(S.game, coScore, anz, true, false); else commitVisit(coScore, anz, true, false);
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
        if (ov.fin) finisherFinishBuchen(coAnz); else if (ov.kw) kaiwenVisit(S.game, coSc, coAnz, true, false); else commitVisit(coSc, coAnz, true, false);
      } else if (ev.key === 'Backspace') {
        if (ov.kw) undoKaiwen(S.game); else undo();
        ev.preventDefault();
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
      /* Nur ein KNOPF zaehlt - die Dialogkarte selbst traegt den Fokus seit
         D1 immer (dialogFokusHinein), damit Hilfstechnik im Dialog ist. */
      var imDialog = fokus && fokus.closest && fokus.closest('#overlay button, #overlay [role="button"]');
      var ldM = currentMatch();
      var ldN = legDoneDritte(ldM) ? 3 : 2;
      var ldW = Math.min(ov.wahl || 0, ldN - 1);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' ||
          ev.key === 'ArrowRight' || ev.key === 'ArrowLeft' || ev.key === 'Tab') {
        ov.wahl = ev.key === 'Tab' ? (ldW + 1) % ldN
          : (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? Math.min(ldN - 1, ldW + 1) : Math.max(0, ldW - 1);
        render(); ev.preventDefault();
      } else if (ev.key === 'Enter' && !imDialog) {
        ev.preventDefault();
        if (ldW === 1) { undo(); }
        else if (ldW === 2) { handleAction(legDoneDritte(ldM) || 'to-tournament', ev.target); }
        else { UI.overlay = null; render(); }
      } else if (ev.key === 'Backspace' && !imDialog) {
        undo(); ev.preventDefault();
      }
    }
  });

  /* ================= Tastatur ueberall: Pfeile, Enter, Zurueck =================
   *
   * Die Spielbilder haben ihre eigene Tastatur (Ziffern, Enter = OK,
   * Backspace = loeschen), Ausbullen, Turnierplan und die Dialoge nach dem
   * Leg ihre eigene Pfeil-Wahl. Ueberall sonst - Setup, Rangliste, Spieler,
   * Profil, Liga, Konto, Auswertung, und in den Menues - gilt ein
   * gemeinsames Muster wie am Fernseher: die Pfeile springen zum naechsten
   * Knopf in Pfeilrichtung, Enter drueckt ihn, Escape (und Backspace, wo
   * Backspace nichts loescht) geht eine Stufe zurueck: Menue zu, Dialog zu,
   * Reiter zurueck, Bildschirm zurueck, zuletzt ins Setup.
   */
  var SPIEL_SCREENS = { game: 1, cricket: 1, rtw: 1, finisher: 1, kaiwen: 1, hunter: 1 };
  var PFEIL_SCREENS = { setup: 1, tournament: 1, stats: 1, players: 1, profile: 1, liga: 1, konto: 1, summary: 1, winner: 1, bericht: 1 };

  /* In welchem Bereich wandern die Pfeile gerade? Ein offener Dialog oder
     ein offenes Menue schliesst den Rest aus. */
  function pfeilBereich() {
    if (UI.overlay) return $('overlay-card');
    if (UI.menu && SPIEL_SCREENS[S.screen]) return document.querySelector('.game-menu:not(.hidden) .game-menu-karte');
    if (PFEIL_SCREENS[S.screen] && S.screen !== 'tournament') return document.querySelector('.screen.active');
    return null;
  }
  function pfeilSichtbar(el) {
    if (el.disabled || el.closest('.hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function pfeilZiele(bereich) {
    var liste = bereich.querySelectorAll('button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]');
    return Array.prototype.filter.call(liste, pfeilSichtbar);
  }
  /* Der naechste Knopf in Pfeilrichtung: zuerst zaehlt der Abstand in der
     Richtung, dann der seitliche Versatz (dreifach), zuletzt die Mitte. */
  function pfeilNaechstes(ziele, von, richtung) {
    if (!von || ziele.indexOf(von) < 0) {
      /* Ohne Ausgangspunkt: der erste bzw. letzte Knopf - aber nie gleich
         ein roter oder "Spiel verlassen" (ein Enter zu viel waere fatal). */
      var harmlos = ziele.filter(function (el) { return !el.classList.contains('danger') && !el.classList.contains('game-menu-raus'); });
      var liste = harmlos.length ? harmlos : ziele;
      return richtung === 'ArrowUp' || richtung === 'ArrowLeft' ? liste[liste.length - 1] : liste[0];
    }
    var a = von.getBoundingClientRect(), ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    var senkrecht = richtung === 'ArrowUp' || richtung === 'ArrowDown';
    var best = null, bestWert = Infinity;
    ziele.forEach(function (el) {
      if (el === von) return;
      var b = el.getBoundingClientRect(), bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
      var prim, sec;
      if (richtung === 'ArrowDown') { if (by <= ay + 1) return; prim = Math.max(0, b.top - a.bottom); }
      else if (richtung === 'ArrowUp') { if (by >= ay - 1) return; prim = Math.max(0, a.top - b.bottom); }
      else if (richtung === 'ArrowRight') { if (bx <= ax + 1) return; prim = Math.max(0, b.left - a.right); }
      else { if (bx >= ax - 1) return; prim = Math.max(0, a.left - b.right); }
      sec = senkrecht
        ? Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right))
        : Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      var wert = prim + sec * 3 + (senkrecht ? Math.abs(bx - ax) : Math.abs(by - ay)) * 0.15;
      if (wert < bestWert) { bestWert = wert; best = el; }
    });
    return best;
  }
  /* Woran erkennt man denselben Knopf nach dem Neuzeichnen? An Aktion und
     Daten - zur Not am Text. */
  function fokusSchluessel(el) {
    if (!el || el === document.body || !el.getAttribute) return null;
    var teile = ['data-action', 'data-id', 'data-value', 'data-key', 'data-screen', 'data-kind', 'data-tab', 'data-role', 'data-i'].map(function (a) { return el.getAttribute(a) || ''; });
    teile.push(el.id || '');
    teile.push(el.parentElement && el.parentElement.getAttribute ? el.parentElement.getAttribute('data-setting') || '' : '');
    var kern = teile.join('|');
    if (!kern.replace(/\|/g, '')) kern = (el.textContent || '').trim().slice(0, 40);
    return el.tagName + '|' + kern;
  }
  /* Nach dem Zeichnen: war der markierte Knopf gerade ersetzt worden
     (Spieler angetippt, Einstellung gewechselt), kommt die Markierung auf
     seinen Nachfolger - sonst finge man nach jedem Enter wieder vorn an. */
  function fokusWiederherstellen() {
    if (!UI.fokusMerk || !tastaturBetrieb()) return;
    var akt = document.activeElement;
    if (akt && akt !== document.body && akt.isConnected && pfeilSichtbar(akt)) return;
    var bereich = pfeilBereich();
    if (!bereich) return;
    var ziele = pfeilZiele(bereich);
    for (var i = 0; i < ziele.length; i++) {
      if (fokusSchluessel(ziele[i]) === UI.fokusMerk) { ziele[i].focus({ preventScroll: true }); return; }
    }
    UI.fokusMerk = null;
  }
  /* Eine Stufe zurueck. Liefert true, wenn etwas passiert ist. */
  function tastaturZurueck() {
    if (UI.overlay) {
      if (bleibtOffen(UI.overlay.type)) return false;
      UI.overlay = null; UI.input = ''; render(); return true;
    }
    if (SPIEL_SCREENS[S.screen] || S.screen === 'bulloff') return false;
    if (S.screen === 'summary') {
      var sb = document.querySelector('#screen-summary [data-action="summary-back"]');
      if (sb) { handleAction('summary-back', sb); return true; }
      return false;
    }
    if (S.screen === 'stats' && UI.boardLog) { UI.boardLog = false; render(); return true; }
    if (S.screen === 'liga' && (UI.ligaTab || 'plan') !== 'plan') { UI.ligaTab = 'plan'; UI.boardLog = false; render(); return true; }
    if (S.screen === 'liga' && UI.ligaWahl) { UI.ligaWahl = null; render(); return true; }
    if (S.screen === 'profile' && UI.profilPanel === 'foto') { fotoSchliessen(); return true; }
    if (S.screen === 'profile' && UI.profilPanel === 'edit') { UI.profilPanel = null; UI.profilEdit = null; render(); return true; }
    if (S.screen === 'profile' && UI.profilPanel === 'tabelle' && UI.tab && UI.tab.rest) { UI.tab.rest = null; render(); return true; }
    if (S.screen === 'profile' && (UI.profilPanel || UI.profilGruppenWahl)) { UI.profilPanel = null; UI.tab = null; UI.profilGruppenWahl = false; render(); return true; }
    if (S.screen === 'profile') { S.screen = 'players'; save(); render(); return true; }
    if (S.screen === 'konto' && gesperrt()) return false;
    if (S.screen === 'winner' || S.screen === 'bericht' || S.screen === 'setup') return false;
    if (PFEIL_SCREENS[S.screen]) { S.screen = 'setup'; save(); render(); return true; }
    return false;
  }
  window.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var ziel = ev.target;
    var imFeld = ziel && ziel.closest && ziel.closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]');
    var istPfeil = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
    var istZurueck = ev.key === 'Escape' || ev.key === 'Backspace';
    if (!istPfeil && !istZurueck && ev.key !== 'Enter' && ev.key !== ' ') return;
    var bereich = pfeilBereich();
    /* Den markierten Knopf merken - fuer die Zeit nach dem Neuzeichnen. */
    if (bereich && document.activeElement && bereich.contains(document.activeElement)) UI.fokusMerk = fokusSchluessel(document.activeElement);

    if (istZurueck) {
      /* In einem Feld: Backspace loescht, Escape verlaesst das Feld. Ist
         das Feld leer, gibt es nichts zu verlassen - dann schliesst Escape
         gleich den Dialog, statt erst beim zweiten Druck. */
      if (imFeld) {
        if (ev.key === 'Escape') {
          var feldLeer = ziel.tagName === 'SELECT' ? false
            : ziel.isContentEditable ? !String(ziel.textContent || '').trim()
            : !String(ziel.value || '').trim();
          ev.preventDefault(); ev.stopImmediatePropagation();
          if (feldLeer && UI.overlay && !bleibtOffen(UI.overlay.type)) { ziel.blur(); tastaturZurueck(); }
          else ziel.blur();
        }
        return;
      }
      /* Backspace ist in den Spielbildern das Loeschen und bleibt es;
         Escape dort regeln die Spielbilder selbst (Fernsteuerung, Menue). */
      if (ev.key === 'Backspace' && (SPIEL_SCREENS[S.screen] || S.screen === 'bulloff')) return;
      if (ev.key === 'Escape' && SPIEL_SCREENS[S.screen] && !UI.overlay) return;
      /* Dialoge mit eigener Esc-Regel (Spielbilder) bleiben beim alten Weg. */
      if (tastaturZurueck()) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      return;
    }
    if (!bereich) return;
    /* Dialoge nach Leg und Spiel waehlen selbst; die Spielbilder ebenso. */
    if (UI.overlay && (PFEIL_DIALOGE[UI.overlay.type] || UI.overlay.type === 'checkout-darts')) return;
    if (istPfeil) {
      if (imFeld) {
        /* Im Textfeld bewegen links/rechts die Schreibmarke, in einer
           Auswahl alle Pfeile den Wert - nur hoch/runter im Textfeld wandern. */
        var feldArt = ziel.tagName === 'INPUT' ? (ziel.type || 'text') : ziel.tagName.toLowerCase();
        if (feldArt === 'select' || feldArt === 'textarea' || feldArt === 'range' || feldArt === 'number') return;
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') return;
      }
      var ziele = pfeilZiele(bereich);
      if (!ziele.length) return;
      var von = document.activeElement && bereich.contains(document.activeElement) ? document.activeElement : null;
      var naechstes = pfeilNaechstes(ziele, von, ev.key);
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (!naechstes) return;
      naechstes.focus({ preventScroll: true });
      if (naechstes.scrollIntoView) naechstes.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      UI.fokusMerk = fokusSchluessel(naechstes);
      return;
    }
    /* Enter und Leertaste: der Browser drueckt Knoepfe selbst; hier nur
       sicherstellen, dass ohne Markierung nichts Unerwartetes passiert. */
  }, true);

  /* ================= Start ================= */
  S = load() || newState();
  renderLadeHinweis();
  spielUhrStellen();          // Altbestand ohne Startzeit: ab jetzt zaehlen
  altesSpielBeenden();
  /* #konto aus einer Mitteilungs-Mail (siehe hashKontoEinloesen): Hash
     sofort weg, Konto-Bildschirm auf - angemeldet geht es von dort zu den
     Benachrichtigungen, sonst steht wie gewohnt die Anmeldung. */
  if (location.hash === '#konto') {
    UI.hashKonto = true;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* egal */ }
    if (!SPIEL_SCREENS[S.screen] && S.screen !== 'bulloff') S.screen = 'konto';
  }
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
    if (UI.overlay && !bleibtOffen(UI.overlay.type)) {
      UI.overlay = null; UI.input = ''; render(); zurueckFalle(); return;
    }
    if (UI.overlay) { zurueckFalle(); return; }
    if (S.screen === 'summary') {
      var sb = document.querySelector('#screen-summary [data-action="summary-back"]');
      if (sb) handleAction('summary-back', sb);
      zurueckFalle(); return;
    }
    if (S.screen === 'profile') { S.screen = 'players'; save(); render(); zurueckFalle(); return; }
    /* Im Spiel verlaesst ein versehentliches Zurueck nichts. */
    if (SPIEL_SCREENS[S.screen] || S.screen === 'bulloff') { zurueckFalle(); return; }
    if (S.screen !== 'setup') { S.screen = 'setup'; save(); render(); zurueckFalle(); return; }
    /* Setup ohne Dialog: das naechste Zurueck darf die App verlassen. */
  });
  try {
    if (!history.state || !history.state.dart) zurueckFalle();
  } catch (e) { /* egal */ }
  /* Die gemerkte Board-Einstellung zieht beim Start nur mitten im
     Ligaspiel - ein normales Spiel beginnt immer im normalen Bild. */
  UI.turnier = !!(S.settings && S.settings.turnierModus === 1 && S.tour && S.tour.liga) ||
    /* "Tastatur" im Setup: ein laufendes Schnelles Spiel oder Turnier kommt
       nach dem Neustart wieder in der Fernsteuerung hoch. */
    !!(S.settings && S.settings.tastatur === 1 && ((S.game && S.game.kind === 'quick' && S.game.p && S.game.p.length > 1) || (!S.game && S.tour && !S.tour.liga)));
  UI.finFern = !!(S.settings && S.settings.tastatur === 1 && S.game && S.game.kind === 'finisher');
  UI.kwFern = !!(S.settings && S.settings.tastatur === 1 && S.game && S.game.kind === 'kaiwen');
  if (!S.lineup.length) S.lineup = activeProfiles().slice(0, 4).map(function (p) { return p.id; });
  if ((S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher' || S.screen === 'kaiwen' || S.screen === 'hunter') && !S.game) S.screen = 'setup';
  /* Ein angefangenes Schnelles Spiel liegt in S.game, nicht im Spielplan –
     ohne diese Zeile landete man nach einem Neustart im leeren Turnier. */
  if (S.screen === 'game' && S.game && S.game.kind === 'quick' && !S.game.done) S.screen = 'game';
  if (S.game && S.game.kind !== 'quick' && !S.game.started && !S.game.throws.length) S.screen = 'bulloff';
  if (S.game && S.game.kind === 'quick' && !S.game.started) S.screen = 'bulloff';
  if (S.game && S.game.started === undefined) S.game.started = true;   // ältere Stände
  if (S.game && (S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher' || S.screen === 'kaiwen' || S.screen === 'hunter') && S.game.kind !== S.screen) S.screen = spielScreen(S.game.kind);
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
  nachmeldungWiederherstellen();
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
      ligaDatenPruefen: ligaDatenPruefen,
      lineupVorbelegen: lineupVorbelegen,
      ligaTyp: ligaTyp, berichtVersandOeffnen: berichtVersandOeffnen, berichtEmpfaengerMerken: berichtEmpfaengerMerken,
      berichtVersandOeffnen: berichtVersandOeffnen,
      state: function () { return S; },
      ui: function () { return UI; },
      action: handleAction,
      save: save,
      uid: uid,
      esc: esc,
      avatarHTML: avatarHTML,
      profile: profile,
      activeProfiles: activeProfiles,
      lieblingsDoppel: lieblingsDoppel,
      finishGruppen: finishGruppen,
      finishGruppenSetzen: finishGruppenSetzen,
      finishNachruesten: finishNachruesten,
      finishEigeneAnzahl: finishEigeneAnzahl,
      fotoAusDataUrl: fotoAusDataUrl,
      eigenesProfil: eigenesProfilOeffnen,
      freeHue: freeHue,
      HUES: HUES,
      setScreen: function (name) { S.screen = name; save(); render(); },
      ersetzeSpielerIds: ersetzeSpielerIds,
      uebernehmeSpiele: uebernehmeSpiele,
      berichtPdf: berichtPdf,
      einzelVerloren: einzelVerloren,
      planNachreichen: planNachreichen,
      berichtNeu: function () { berichtStand = null; },   // nur fuer Tests
      manOfTheDay: manOfTheDay,                            // nur fuer Tests
      manOfTheDayText: manOfTheDayText,                    // nur fuer Tests
      legHighlights: legHighlights,                        // nur fuer Tests
      ligaErgebnisDaten: ligaErgebnisDaten,                // nur fuer Tests
      mitteilungsZeilen: mitteilungsZeilen,                // nur fuer Tests
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
      ligaErgebnisAus: ligaErgebnisAus,
      allMatches: allMatches,
      ranking: function (key) { return ranking(boardDef(key), career()); },
      remainingIn: remainingIn,
      activeLeg: activeLeg,
      activePlayer: activePlayer,
      satzStand: satzStand,
      pname: pname,
      chartSeries: chartSeries,
      spielerSpiele: spielerSpiele, statsSumme: statsSumme,   // Spieler-Dashboard, fuer die Tests
      statsCrew: statsCrew, careerLiga: careerLiga, doppelKandidaten: doppelKandidaten,
      currentMatch: currentMatch,
      game: function () { return S.game; },
      cricketState: function () { return cricketState(S.game); },
      finisherState: function () { return finisherState(S.game); },
      finisherRunde: function () { return finisherRunde(S.game); },
      kaiwenState: function () { return kaiwenState(S.game); },
      hunterState: function () { return hunterState(S.game); },
      hunterBest: hunterBest,
      spielDart: spielDart,
      kaiwenPB: kaiwenPB,
      kaiwenRekord: kaiwenRekord,
      rtwState: function () { return rtwState(S.game); },
      gameTurnPlayer: function () { return S.game ? gameTurnPlayer(S.game) : null; },
      render: render,
      reset: function () { S = newState(); UI.overlay = null; render(); }
    };
  }
})();
