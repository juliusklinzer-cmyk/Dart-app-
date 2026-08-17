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
  var QUICK_SCORES = [26, 41, 45, 60, 81, 85, 100, 140, 180];
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
    if (key === lastQuick.key && now - lastQuick.at < 400) return true;
    lastQuick.key = key;
    lastQuick.at = now;
    return false;
  }
  var settleUntil = 0;
  function settling() { return Date.now() < settleUntil; }
  var UI = { input: '', darts: [], mult: 1, modeOverride: null, overlay: null, error: '', board: 'avg', boardMode: '501', profile: null, summary: null };

  /* ================= Helfer ================= */
  function $(id) { return document.getElementById(id); }
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
      settings: { start: 501, bestOf: 1, dartModeFrom: 170, cricketScoring: 1 },
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
      if (s.settings.start !== 301 && s.settings.start !== 501) s.settings.start = 501;
      if (s.game === undefined) s.game = null;
      if (s.settings.cricketScoring === undefined) s.settings.cricketScoring = 1;
      s.profiles.forEach(function (p, i) { if (typeof p.hue !== 'number') p.hue = HUES[i % HUES.length]; });
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
  function activeProfiles() { return S.profiles.filter(function (p) { return !p.hidden; }); }

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

  function matchById(id) {
    for (var i = 0; i < S.matches.length; i++) if (S.matches[i].id === id) return S.matches[i];
    return null;
  }
  function currentMatch() { return S.current ? matchById(S.current) : null; }
  function nextOpenMatch() {
    for (var i = 0; i < S.matches.length; i++) if (!S.matches[i].done) return S.matches[i];
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
    var other = match.p[0] === match.starter ? match.p[1] : match.p[0];
    var starter = match.legs.length % 2 === 0 ? match.starter : other;
    var leg = { starter: starter, visits: [], winner: null };
    match.legs.push(leg);
    return leg;
  }

  function activeLeg(match) { return match.legs[match.legs.length - 1] || null; }

  function remainingIn(leg, pid) {
    var rest = tourStart();
    for (var i = 0; i < leg.visits.length; i++) {
      var v = leg.visits[i];
      if (v.p === pid && !v.b) rest -= v.s;
    }
    return rest;
  }

  function activePlayer(leg, match) {
    var other = match.p[0] === leg.starter ? match.p[1] : match.p[0];
    return leg.visits.length % 2 === 0 ? leg.starter : other;
  }

  function dartsIn(leg, pid) {
    return sum(leg.visits, function (v) { return v.p === pid ? v.d : 0; });
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

    UI.input = ''; UI.darts = []; UI.mult = 1; UI.modeOverride = null; UI.error = '';

    if (isCheckout) {
      leg.winner = pid;
      if (legsWon(m, pid) >= legsToWin()) {
        m.done = true;
        m.winner = pid;
        m.at = Date.now();
        UI.overlay = { type: 'match-done', pid: pid };
      } else {
        UI.overlay = { type: 'leg-done', pid: pid };
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
    if (k === 'del') { UI.input = UI.input.slice(0, -1); render(); return; }
    if (k === 'ok') { submitTotal(); return; }
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
    if (!m || m.done || settling()) return;   // beendet oder gerade erst geöffnet
    var leg = activeLeg(m);
    var pid = activePlayer(leg, m);
    var rest = remainingIn(leg, pid) - sum(UI.darts, function (d) { return d.v; });
    var value = mult * num;

    UI.darts.push({ m: mult, n: num, v: value });
    UI.mult = 1;

    var after = rest - value;
    var thrown = UI.darts.length;
    var total = sum(UI.darts, function (d) { return d.v; });

    if (after < 0 || after === 1 || (after === 0 && mult !== 2)) {
      commitVisit(total, thrown, false, true, UI.darts);
      return;
    }
    if (after === 0) { commitVisit(total, thrown, true, false, UI.darts); return; }
    if (thrown === 3) { commitVisit(total, 3, false, false, UI.darts); return; }
    render();
  }

  /* ================= Undo ================= */
  function undo() {
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
      checkouts: 0, doubleAttempts: 0,
      highCO: 0, highFinishes: 0, highScore: 0,
      s180: 0, s140: 0, s100: 0, s60: 0,
      bestLeg: null, tournaments: 0, tourWins: 0,
      cricketGames: 0, cricketWins: 0, cricketMarks: 0, cricketDarts: 0,
      rtwGames: 0, rtwWins: 0, rtwBest: null,
      lastResults: []
    };
  }

  function finalize(st) {
    st.avg = st.darts ? (st.points / st.darts) * 3 : 0;
    st.first9 = st.first9Darts ? (st.first9Points / st.first9Darts) * 3 : 0;
    st.doubleQuote = st.doubleAttempts ? (st.checkouts / st.doubleAttempts) * 100 : 0;
    st.legDiff = st.legsWon - st.legsLost;
    st.legs = st.legsWon + st.legsLost;
    st.winPct = st.matches ? (st.won / st.matches) * 100 : 0;
    st.dartsPerLeg = st.legsWon ? st.dartsInWonLegs / st.legsWon : 0;
    st.tons = st.s100 + st.s140 + st.s180;
    st.mpr = st.cricketDarts ? (st.cricketMarks / st.cricketDarts) * 3 : 0;
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
        if (m.done) {
          stat(m.p[0]).matches++; stat(m.p[1]).matches++;
          stat(m.winner).won++;
          var loser = m.winner === m.p[0] ? m.p[1] : m.p[0];
          stat(loser).lost++;
          stat(m.winner).lastResults.push({ at: m.at, win: true });
          stat(loser).lastResults.push({ at: m.at, win: false });
        }
        m.legs.forEach(function (leg) {
          var rest = {};
          rest[m.p[0]] = start; rest[m.p[1]] = start;
          var visitNo = {};
          visitNo[m.p[0]] = 0; visitNo[m.p[1]] = 0;

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

            /* Doppelversuche: jeder Dart, der auf ein mögliches Doppel geworfen
               wurde. Im Einzel-Dart-Modus dartgenau; bei der Punkte-Eingabe
               zählen die Darts der Aufnahme, sobald sie auf einem Doppel-Rest
               begonnen hat – sonst hinge die Quote am Eingabeweg. */
            if (v.k && v.k.length) {
              var r = before;
              for (var i = 0; i < v.k.length; i++) {
                var d = v.k[i];
                if (oneDartFinish(r)) st.doubleAttempts++;
                r -= d.m * d.n;
              }
            } else if (oneDartFinish(before)) {
              st.doubleAttempts += v.d;
            } else if (v.c) {
              st.doubleAttempts += v.d;
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
    var lists = S.history.filter(function (h) { return (h.kind || '501') === '501'; })
      .map(function (h) { return { matches: h.matches, start: (h.settings && h.settings.start) || 501 }; });
    if (S.matches.length) lists.push({ matches: S.matches, start: tourStart() });
    var ids = S.profiles.map(function (p) { return p.id; });
    var map = collectStats(lists, ids);
    var open = S.game && S.game.done ? [S.game] : [];
    S.history.concat(open).forEach(function (h) {
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
        var rs = rtwState({ players: h.players, throws: h.throws });
        h.players.forEach(function (id) { if (map[id]) map[id].rtwGames++; });
        if (h.winner && map[h.winner]) {
          map[h.winner].rtwWins++;
          var used = rs.darts[h.winner];
          if (map[h.winner].rtwBest === null || used < map[h.winner].rtwBest) map[h.winner].rtwBest = used;
        }
      }
    });
    Object.keys(map).forEach(function (k) {
      map[k].name = pname(k);
      finalize(map[k]);
      map[k].lastResults.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    });
    return map;
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
    { mode: '501', key: 'avg', label: 'Average', unit: '', get: function (s) { return s.avg; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.darts >= MIN_DARTS_FOR_AVG; }, hint: 'Punkte je 3 Darts über alle Spiele. Zählt ab ' + MIN_DARTS_FOR_AVG + ' geworfenen Darts.' },
    { mode: '501', key: 'first9', label: 'First 9', get: function (s) { return s.first9; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.first9Darts >= 9; }, hint: 'Average der ersten 9 Darts eines Legs – das Maß für den Scoring-Antritt.' },
    { mode: '501', key: 'doubleQuote', label: 'Doppelquote', get: function (s) { return s.doubleQuote; }, fmt: function (v) { return v.toFixed(1) + ' %'; }, min: function (s) { return s.doubleAttempts >= 3; }, hint: 'Getroffene Finishes je Dart auf ein mögliches Doppel (Rest 2–40 gerade oder Bull). Zählt ab 3 Versuchen.' },
    { mode: '501', key: 'highCO', label: 'Höchstes Finish', get: function (s) { return s.highCO; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highCO > 0; }, hint: 'Der höchste je ausgecheckte Rest.' },
    { mode: '501', key: 's180', label: '180er', get: function (s) { return s.s180; }, fmt: function (v) { return String(v); }, min: function (s) { return s.s180 > 0; }, hint: 'Maximum – alle drei Darts in die Triple 20.' },
    { mode: '501', key: 'highScore', label: 'Höchste Aufnahme', get: function (s) { return s.highScore; }, fmt: function (v) { return String(v); }, min: function (s) { return s.highScore > 0; }, hint: 'Die beste einzelne Aufnahme aus 3 Darts.' },
    { mode: '501', key: 'bestLeg', label: 'Bestes Leg', get: function (s) { return s.bestLeg; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.bestLeg !== null; }, asc: true, hint: 'Wenigste Darts für ein gewonnenes Leg.' },
    { mode: '501', key: 'tons', label: '100+ Aufnahmen', get: function (s) { return s.tons; }, fmt: function (v) { return String(v); }, min: function (s) { return s.tons > 0; }, hint: 'Alle Aufnahmen ab 100 Punkten (inkl. 140+ und 180).' },
    { mode: '501', key: 'won', label: 'Siege', get: function (s) { return s.won; }, fmt: function (v) { return String(v); }, min: function (s) { return s.matches > 0; }, hint: 'Gewonnene Spiele über alle Turniere.' },
    { mode: '501', key: 'winPct', label: 'Siegquote', get: function (s) { return s.winPct; }, fmt: function (v) { return v.toFixed(0) + ' %'; }, min: function (s) { return s.matches >= 3; }, hint: 'Anteil gewonnener Spiele. Zählt ab 3 Spielen.' },
    { mode: '501', key: 'legsWon', label: 'Legs', get: function (s) { return s.legsWon; }, fmt: function (v) { return String(v); }, min: function (s) { return s.legsWon > 0; }, hint: 'Gewonnene Legs insgesamt.' },
    { mode: '501', key: 'tourWins', label: 'Turniersiege', get: function (s) { return s.tourWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.tourWins > 0; }, hint: 'Gewonnene, abgeschlossene Turniere.' },
    { mode: 'cricket', key: 'mpr', label: 'MPR', get: function (s) { return s.mpr; }, fmt: function (v) { return v.toFixed(2); }, min: function (s) { return s.cricketDarts >= 9; }, hint: 'Marks per Round: getroffene Marken je 3 Darts im Cricket.' },
    { mode: 'cricket', key: 'cricketWins', label: 'Siege', get: function (s) { return s.cricketWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.cricketGames > 0; }, hint: 'Gewonnene Cricket-Spiele.' },
    { mode: 'rtw', key: 'rtwBest', label: 'Bestes Ergebnis', get: function (s) { return s.rtwBest; }, fmt: function (v) { return v + ' Darts'; }, min: function (s) { return s.rtwBest !== null; }, asc: true, hint: 'Wenigste Darts für einen kompletten Durchlauf von der 1 bis Bull.' },
    { mode: 'rtw', key: 'rtwWins', label: 'Siege', get: function (s) { return s.rtwWins; }, fmt: function (v) { return String(v); }, min: function (s) { return s.rtwGames > 0; }, hint: 'Gewonnene Round-the-World-Trainings.' }
  ];

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
      return def.min(s) && known[s.id] && !known[s.id].hidden;
    });
    rows.sort(function (a, b) {
      var d = def.asc ? def.get(a) - def.get(b) : def.get(b) - def.get(a);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    return rows;
  }

  /* Alle je gespielten Spiele, neueste zuerst. */
  function allMatches() {
    var out = [];
    if (S.matches.length) {
      S.matches.forEach(function (m) { if (m.done) out.push({ m: m, start: tourStart(), live: true }); });
    }
    S.history.forEach(function (h) {
      if ((h.kind || '501') !== '501') return;   // Cricket/RTW haben keine Match-Liste
      h.matches.forEach(function (m) { if (m.done) out.push({ m: m, start: (h.settings && h.settings.start) || 501, at: h.at }); });
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
    if (!g || g.done || settling()) return;
    // Bull: 25 zählt eine Marke, Doppel-Bull zwei.
    var m = num === 25 ? (mult === 2 ? 2 : 1) : mult;
    g.throws.push({ n: num, m: num === 0 ? 0 : m });
    UI.mult = 1;   // wie im 501-Modus: nach jedem Dart zurück auf Single
    var st = cricketState(g);
    if (st.winner) { g.done = true; g.winner = st.winner; g.at = Date.now(); UI.overlay = { type: 'game-done', pid: st.winner }; }
    save(); render();
  }

  /* ================= Round the World ================= */
  /* Ziel 1..20, danach Bull (25). Ein Treffer rückt um den Multiplikator vor,
     über die 20 hinaus landet man immer auf Bull. */
  function rtwState(g) {
    var st = { target: {}, darts: {}, hits: {}, winner: null };
    g.players.forEach(function (id) { st.target[id] = 1; st.darts[id] = 0; st.hits[id] = 0; });

    for (var i = 0; i < g.throws.length; i++) {
      var t = g.throws[i];
      var pid = g.players[Math.floor(i / 3) % g.players.length];
      st.darts[pid]++;
      var target = st.target[pid];
      if (!t.n) continue;

      if (target === 25) {
        if (t.n === 25) { st.hits[pid]++; if (st.winner === null) st.winner = pid; }
        continue;
      }
      if (t.n !== target) continue;
      st.hits[pid]++;
      var next = target + t.m;
      st.target[pid] = next > 20 ? 25 : next;
    }
    return st;
  }

  function rtwDart(mult, num) {
    var g = S.game;
    if (!g || g.done || settling()) return;
    var m = num === 25 ? (mult === 2 ? 2 : 1) : mult;
    g.throws.push({ n: num, m: num === 0 ? 0 : m });
    UI.mult = 1;
    var st = rtwState(g);
    if (st.winner) { g.done = true; g.winner = st.winner; g.at = Date.now(); UI.overlay = { type: 'game-done', pid: st.winner }; }
    save(); render();
  }

  /* ================= Gemeinsames für beide Modi ================= */
  function gameTurnPlayer(g) {
    return g.players[Math.floor(g.throws.length / 3) % g.players.length];
  }
  function gameVisitDarts(g) {
    return g.throws.slice(Math.floor(g.throws.length / 3) * 3);
  }
  function undoGame() {
    var g = S.game;
    if (!g || !g.throws.length) return;
    g.throws.pop();
    g.done = false; g.winner = null; g.at = null;
    UI.overlay = null;
    UI.mult = 1;
    save(); render();
  }

  function startGame(kind) {
    // Ein beendetes, noch nicht gespeichertes Spiel zuerst sichern.
    if (S.game && S.game.done) archiveGame(S.game);
    if (S.lineup.length < 2 && kind === 'cricket') { UI.overlay = { type: 'need-players' }; render(); return; }
    if (!S.lineup.length) { UI.overlay = { type: 'need-players' }; render(); return; }
    S.game = {
      id: uid(), kind: kind, at: null, players: S.lineup.slice(), throws: [],
      scoring: kind === 'cricket' ? S.settings.cricketScoring === 1 : false,
      done: false, winner: null
    };
    UI.mult = 1;
    UI.overlay = null;
    S.screen = kind;
    save(); render();
  }

  function archiveGame(g) {
    if (!g || !g.done) return;
    for (var i = 0; i < S.history.length; i++) if (S.history[i].id === g.id) return;  // nicht doppelt
    S.history.unshift({
      id: g.id || uid(), kind: g.kind, at: g.at || Date.now(),
      players: g.players.slice(), scoring: g.scoring, throws: g.throws, winner: g.winner
    });
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
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
    var table = standings();
    S.history.unshift({
      id: uid(), at: Date.now(),
      lineup: tourPlayers().slice(),
      settings: { start: tourStart(), bestOf: tour().bestOf },
      matches: S.matches,
      winner: allMatchesDone() && table[0] ? table[0].id : null
    });
    if (S.history.length > MAX_HISTORY) S.history.length = MAX_HISTORY;
    S.matches = [];
    S.current = null;
    S.tour = null;
    save();
  }

  /* ================= Rendering ================= */
  var SCREENS = ['setup', 'tournament', 'boards', 'players', 'profile', 'bulloff', 'game', 'cricket', 'rtw', 'summary', 'winner'];
  var NAV_SCREENS = { setup: 'setup', tournament: 'setup', boards: 'boards', players: 'players', profile: 'players' };

  function show(screen) {
    SCREENS.forEach(function (s) { $('screen-' + s).classList.toggle('active', s === screen); });
    var navFor = NAV_SCREENS[screen];
    $('nav').classList.toggle('hidden', !navFor);
    if (navFor) {
      $('nav').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-screen') === navFor);
      });
    }
  }

  function render() {
    show(S.screen);
    if (S.screen === 'setup') renderSetup();
    if (S.screen === 'tournament') renderTournament();
    if (S.screen === 'boards') renderBoards();
    if (S.screen === 'players') renderPlayers();
    if (S.screen === 'profile') renderProfile();
    if (S.screen === 'bulloff') renderBullOff();
    if (S.screen === 'game') renderGame();
    if (S.screen === 'cricket') renderCricket();
    if (S.screen === 'rtw') renderRtw();
    if (S.screen === 'summary') renderSummary();
    if (S.screen === 'winner') renderWinner();
    renderOverlay();
  }

  function renderSetup() {
    var map = career();
    $('roster').innerHTML = activeProfiles().map(function (p) {
      var st = map[p.id];
      var sel = S.lineup.indexOf(p.id) >= 0;
      return '<div class="roster-item ' + (sel ? 'selected' : '') + '" data-action="toggle-lineup" data-id="' + p.id + '" role="button" tabindex="0">' +
        avatarHTML(p, 'md') +
        '<div class="who"><div class="nm">' + esc(p.name) + '</div>' +
        '<div class="sm">' + (st && st.matches ? 'Ø ' + st.avg.toFixed(1) + ' · ' + st.won + ' Siege' : 'noch kein Spiel') + '</div></div>' +
        '<button class="edit" data-action="edit-profile" data-id="' + p.id + '" aria-label="Bearbeiten">✎</button>' +
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
    $('settings-501').classList.toggle('hidden', S.mode !== '501');
    $('settings-cricket').classList.toggle('hidden', S.mode !== 'cricket');
    $('settings-rtw').classList.toggle('hidden', S.mode !== 'rtw');
    document.querySelector('[data-action="start-game"]').textContent =
      S.mode === 'cricket' ? 'Cricket starten' : S.mode === 'rtw' ? 'Round the World starten' : 'Turnier starten';

    var runningGame = !!S.game;
    var running = runningGame || (S.matches.length > 0 && !allMatchesDone());
    $('resume-box').classList.toggle('hidden', !running);
    var resumeBtn = $('resume-box').querySelector('[data-action="resume"]');
    if (runningGame && S.game.done) {
      $('resume-box').querySelector('strong').textContent =
        (S.game.kind === 'cricket' ? 'Cricket' : 'Round the World') + ' beendet';
      $('resume-info').textContent = 'Sieger: ' + pname(S.game.winner) + ' · Ergebnis noch nicht gespeichert';
      resumeBtn.textContent = 'Ergebnis ansehen';
    } else if (runningGame) {
      $('resume-box').querySelector('strong').textContent = S.game.kind === 'cricket' ? 'Laufendes Cricket' : 'Laufendes Training';
      $('resume-info').textContent = S.game.players.length + ' Spieler · ' + S.game.throws.length + ' Darts geworfen';
      resumeBtn.textContent = 'Fortsetzen';
    } else if (running) {
      resumeBtn.textContent = 'Fortsetzen';
      $('resume-box').querySelector('strong').textContent = 'Laufendes Turnier';
      var done = sum(S.matches, function (m) { return m.done ? 1 : 0; });
      $('resume-info').textContent = done + ' von ' + S.matches.length + ' Spielen gespielt';
    }
  }

  function renderTournament() {
    var table = standings();
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
      if (m.round !== round) { round = m.round; html += '<div class="round-label">Runde ' + round + '</div>'; }
      var a = pname(m.p[0]), b = pname(m.p[1]);
      var isNext = next && next.id === m.id;
      var score = m.legs.length ? legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) : '–:–';
      html += '<div class="match-row ' + (m.done ? 'done' : '') + ' ' + (isNext ? 'next' : '') + '">' +
        '<div class="pair">' +
          (m.winner === m.p[0] ? '<b>' + esc(a) + '</b>' : esc(a)) + ' <span class="muted">vs</span> ' +
          (m.winner === m.p[1] ? '<b>' + esc(b) + '</b>' : esc(b)) +
        '</div>' +
        '<div class="res">' + score + '</div>' +
        (m.done ? '' : '<button class="go" data-action="open-match" data-id="' + m.id + '">' +
          (m.legs.length ? 'weiter' : 'start') + '</button>') +
        '</div>';
    });
    $('schedule').innerHTML = html;

    var btn = document.querySelector('#screen-tournament [data-action="next-match"], #screen-tournament [data-action="to-winner"]');
    if (allMatchesDone()) {
      btn.textContent = 'Endstand ansehen';
      btn.setAttribute('data-action', 'to-winner');
    } else {
      btn.textContent = next ? 'Nächstes Spiel: ' + pname(next.p[0]) + ' vs ' + pname(next.p[1]) : 'Nächstes Spiel';
      btn.setAttribute('data-action', 'next-match');
    }

    var map = stats();
    $('stats-grid').innerHTML = tourPlayers().map(function (id) {
      var st = map[id];
      return '<div class="stat-card">' +
        '<div class="who">' + avatarHTML(profile(id), 'sm') + esc(st.name) + '</div>' +
        '<div class="line"><span>Ø 3 Darts</span><b>' + (st.avg ? st.avg.toFixed(1) : '–') + '</b></div>' +
        '<div class="line"><span>First 9</span><b>' + (st.first9 ? st.first9.toFixed(1) : '–') + '</b></div>' +
        '<div class="line"><span>180er</span><b>' + st.s180 + '</b></div>' +
        '<div class="line"><span>100+</span><b>' + st.tons + '</b></div>' +
        '<div class="line"><span>Höchstes Finish</span><b>' + (st.highCO || '–') + '</b></div>' +
        '<div class="line"><span>Doppelquote</span><b>' + (st.doubleAttempts ? st.doubleQuote.toFixed(0) + ' %' : '–') + '</b></div>' +
        '<div class="line"><span>Bestes Leg</span><b>' + (st.bestLeg ? st.bestLeg + ' Darts' : '–') + '</b></div>' +
        '</div>';
    }).join('');
  }

  /* ================= Verlaufsdiagramm ================= */
  var CHART_GAMES = 40;

  /* Je Spieler eine Reihe mit einem Wert pro Spiel, älteste zuerst. */
  function chartSeries(mode) {
    var per = {};
    function push(id, value) {
      if (!per[id]) per[id] = [];
      per[id].push(value);
    }

    if (mode === '501') {
      allMatches().slice().reverse().forEach(function (e) {
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
    var map = career();
    var mode = UI.boardMode;
    var defs = boardsFor(mode);
    if (!defs.some(function (b) { return b.key === UI.board; })) UI.board = defs[0].key;
    var def = boardDef(UI.board);

    $('board-mode').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-value') === mode);
    });

    var log = allGamesLog().filter(function (row) { return row.kind === mode; });
    var modeName = mode === '501' ? 'Classic' : mode === 'cricket' ? 'Cricket' : 'Round the World';
    $('boards-sub').textContent = log.length
      ? modeName + ' · ' + log.length + ' Spiel' + (log.length === 1 ? '' : 'e') +
        (mode === '501' ? ' · ' + S.history.filter(function (h) { return (h.kind || '501') === '501'; }).length + ' Turniere' : '')
      : modeName + ' · noch keine Spiele';

    /* Verlauf: eine farbige Linie je Spieler. */
    var chartLabel = (mode === '501' ? '3-Dart-Average' : 'MPR') + ' – je Spieler die letzten ' + CHART_GAMES + ' Spiele';
    var chart = mode === 'rtw' ? null : lineChart(chartSeries(mode), chartLabel);
    $('board-chart').classList.toggle('hidden', mode === 'rtw');
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
      return '<div class="board-row ' + (i === 0 ? 'top' : '') + '" data-action="open-profile" data-id="' + st.id + '">' +
        '<div class="pos">' + (medals[i] || (i + 1) + '.') + '</div>' +
        avatarHTML(profile(st.id), 'sm') +
        '<div class="nm">' + esc(st.name) + '</div>' +
        '<div class="val">' + def.fmt(def.get(st)) + '</div>' +
        '</div>';
    }).join('') : '<div class="board-empty">Dafür fehlen noch Daten.</div>';
    $('board-hint').textContent = def.hint;

    /* Rekorde des jeweiligen Modus. */
    var recs = mode === '501' ? [
      { k: 'highCO', t: 'Höchstes Finish' },
      { k: 'highScore', t: 'Höchste Aufnahme' },
      { k: 'bestLeg', t: 'Kürzestes Leg' },
      { k: 'avg', t: 'Bester Average' },
      { k: 's180', t: 'Meiste 180er' },
      { k: 'doubleQuote', t: 'Beste Doppelquote' }
    ] : mode === 'cricket' ? [
      { k: 'mpr', t: 'Beste MPR' },
      { k: 'cricketWins', t: 'Meiste Siege' }
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
      : mode === 'cricket' ? 'Alle Cricket-Spiele' : 'Alle Trainings';
    $('match-log').innerHTML = log.slice(0, 30).map(function (row) {
      if (row.kind !== '501') {
        var h = row.h;
        var title = h.kind === 'cricket' ? 'Cricket' + (h.scoring ? '' : ' (ohne Punkte)') : 'Round the World';
        return '<div class="log-row tap" data-action="open-summary" data-kind="' + h.kind + '" data-id="' + (h.id || 'current') + '">' +
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
      return '<div class="log-row tap" data-action="open-summary" data-kind="501" data-id="' + m.id + '">' +
        '<div class="lp ' + (m.winner === m.p[0] ? 'w' : '') + '">' + esc(pname(m.p[0])) + '<span class="a">Ø ' + avgOf(m.p[0]) + '</span></div>' +
        '<div class="ls">' + la + ':' + lb + '</div>' +
        '<div class="lp right ' + (m.winner === m.p[1] ? 'w' : '') + '">' + esc(pname(m.p[1])) + '<span class="a">Ø ' + avgOf(m.p[1]) + '</span></div>' +
        '<div class="ld">' + fmtDate(m.at || e.at) + (e.live ? ' · aktuelles Turnier' : '') + '</div>' +
        '</div>';
    }).join('') || '<p class="hint">Noch keine Spiele.</p>';
  }

  function renderPlayers() {
    var map = career();
    $('players-list').innerHTML = S.profiles.map(function (p) {
      var st = map[p.id];
      return '<div class="card player-card ' + (p.hidden ? 'hidden-profile' : '') + '" data-action="open-profile" data-id="' + p.id + '">' +
        avatarHTML(p, 'lg') +
        '<div class="pc-main">' +
          '<div class="pc-name">' + esc(p.name) + (p.hidden ? ' <span class="muted">(ausgeblendet)</span>' : '') + '</div>' +
          '<div class="pc-stats">' +
            '<span>Ø <b>' + (st.darts ? st.avg.toFixed(1) : '–') + '</b></span>' +
            '<span>Siege <b>' + st.won + '</b></span>' +
            '<span>180er <b>' + st.s180 + '</b></span>' +
            '<span>Bestes Finish <b>' + (st.highCO || '–') + '</b></span>' +
          '</div>' +
        '</div>' +
        '<span class="chev">›</span>' +
        '</div>';
    }).join('');
  }

  function renderProfile() {
    var p = profile(UI.profile);
    var st = career()[p.id];
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
        '<div class="muted">' + (st.matches
          ? plural(st.won, 'Sieg', 'Siege') + ' · ' + plural(st.lost, 'Niederlage', 'Niederlagen') +
            ' · ' + plural(st.tourWins, 'Turniersieg', 'Turniersiege')
          : 'Noch kein Spiel gespielt') + '</div>' +
        '<div class="form-row">' + form + '</div></div></div>' +

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

      '<div class="card"><h2>Letzte 501-Spiele</h2>' + (mine.length ? mine.map(function (e) {
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

  function renderBullOff() {
    var m = currentMatch();
    if (!m) { S.screen = 'tournament'; render(); return; }
    $('bulloff-buttons').innerHTML = m.p.map(function (pid) {
      return '<button data-action="pick-starter" data-id="' + pid + '">' +
        avatarHTML(profile(pid), 'md') + '<span>' + esc(pname(pid)) + '</span></button>';
    }).join('');
  }

  function renderGame() {
    var m = currentMatch();
    if (!m) { S.screen = 'tournament'; render(); return; }
    var leg = ensureLeg(m);
    if (!leg) { S.screen = 'tournament'; render(); return; }

    var active = m.done && m.winner ? m.winner : activePlayer(leg, m);
    var idx = S.matches.indexOf(m);
    $('game-match-label').textContent = 'Spiel ' + (idx + 1) + ' von ' + S.matches.length;
    $('game-leg-label').textContent = S.settings.bestOf > 1
      ? 'Leg ' + m.legs.length + ' · Stand ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + ' (first to ' + legsToWin() + ')'
      : 'Ein Leg · ' + tourStart() + ' Double Out';

    var pendingSum = sum(UI.darts, function (d) { return d.v; });
    $('scoreboard').innerHTML = m.p.map(function (pid) {
      var rest = remainingIn(leg, pid) - (pid === active ? pendingSum : 0);
      var darts = dartsIn(leg, pid) + (pid === active ? UI.darts.length : 0);
      var scored = tourStart() - remainingIn(leg, pid) + (pid === active ? pendingSum : 0);
      var avg = darts ? (scored / darts * 3).toFixed(1) : '–';
      return '<div class="pcard ' + (pid === active ? 'active' : '') + '">' +
        '<div class="pname">' + avatarHTML(profile(pid), 'sm') + esc(pname(pid)) + '</div>' +
        '<div class="legs">Legs ' + legsWon(m, pid) + '</div>' +
        '<div class="rest">' + rest + '</div>' +
        '<div class="meta"><span>Ø <b>' + avg + '</b></span><span>Darts <b>' + darts + '</b></span></div>' +
        '</div>';
    }).join('');

    var restActive = remainingIn(leg, active) - pendingSum;
    var mode = effectiveMode(restActive);
    var dartsLeft = mode === 'darts' ? 3 - UI.darts.length : 3;
    var route = Checkout.suggest(restActive, dartsLeft);

    if (route) {
      $('checkout-bar').innerHTML = '<span class="label">Finish</span>' + route.map(function (d, i) {
        return '<span class="chip ' + (i === 0 ? 'first' : '') + '">' + Checkout.pretty(d) + '</span>';
      }).join('');
    } else {
      $('checkout-bar').innerHTML = restActive > 170
        ? '<span class="none">Noch kein Finish möglich</span>'
        : '<span class="none">Kein Finish mit ' + dartsLeft + ' Dart' + (dartsLeft > 1 ? 's' : '') + '</span>';
    }

    $('history').innerHTML = m.p.map(function (pid) {
      var rowRest = tourStart();
      var rows = [];
      leg.visits.forEach(function (v) {
        if (v.p !== pid) return;
        if (!v.b) rowRest -= v.s;
        rows.push('<div class="v ' + (v.b ? 'bust' : v.c ? 'co' : '') + '">' +
          '<span class="s">' + (v.b ? v.o : v.s) + '</span>' +
          '<span class="r">' + (v.b ? 'Bust' : 'Rest ' + rowRest) + '</span></div>');
      });
      return '<div class="col">' + rows.reverse().slice(0, 5).join('') + '</div>';
    }).join('');

    $('visit-darts').classList.toggle('hidden', mode !== 'darts');
    $('visit-darts').innerHTML = [0, 1, 2].map(function (i) {
      var d = UI.darts[i];
      return '<div class="d ' + (d ? '' : 'empty') + '">' + (d ? dartLabel(d) : '–') + '</div>';
    }).join('');

    $('mode-toggle').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    $('pad-total').classList.toggle('hidden', mode !== 'total');
    $('pad-darts').classList.toggle('hidden', mode !== 'darts');

    if (mode === 'total') {
      $('quick-row').innerHTML = '<button class="miss" data-quick="0">0</button>' +
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
      nums += '<button class="miss wide" data-num="0">Miss</button>';
      nums += '<button data-num="25" class="' + (hl === '25' ? 'hl' : '') + '">25</button>';
      nums += '<button class="bull wide ' + (hl === 'BULL' ? 'hl' : '') + '" data-bull="1">Bull 50</button>';
      $('num-grid').innerHTML = nums;
    }
  }

  function dartLabel(d) {
    if (d.n === 0) return '0';
    if (d.n === 25) return d.m === 2 ? 'Bull' : '25';
    return (d.m === 3 ? 'T' : d.m === 2 ? 'D' : '') + d.n;
  }

  function effectiveMode(rest) {
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
      return '<div class="cr-cell cr-head ' + (id === active ? 'act' : '') + '">' +
        avatarHTML(profile(id), 'sm') + '<span>' + esc(pname(id)) + '</span></div>';
    }).join('');

    var rows = CRICKET_NUMBERS.map(function (n) {
      var allClosed = g.players.every(function (id) { return st.marks[id][n] >= 3; });
      return '<div class="cr-cell cr-num ' + (allClosed ? 'dead' : '') + '">' + cricketLabel(n) + '</div>' +
        g.players.map(function (id) {
          var m = st.marks[id][n];
          return '<div class="cr-cell cr-mark ' + (id === active ? 'act' : '') + ' m' + m + '">' +
            (m === 0 ? '' : m === 1 ? '/' : m === 2 ? '✕' : '⊗') + '</div>';
        }).join('');
    }).join('');

    var foot = '<div class="cr-cell cr-num">' + (g.scoring ? 'Pkt' : 'Zu') + '</div>' +
      g.players.map(function (id) {
        var val = g.scoring ? st.score[id] : CRICKET_NUMBERS.filter(function (n) { return st.marks[id][n] >= 3; }).length + '/7';
        return '<div class="cr-cell cr-score ' + (id === active ? 'act' : '') + '">' + val + '</div>';
      }).join('');

    $('cricket-board').innerHTML =
      '<div class="cr-grid" style="grid-template-columns:44px repeat(' + g.players.length + ',minmax(52px,1fr))">' +
      head + rows + foot + '</div>';

    $('cricket-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> gewinnt'
      : '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b>';

    $('cricket-darts').innerHTML = [0, 1, 2].map(function (i) {
      var d = visit[i];
      return '<div class="d ' + (d ? '' : 'empty') + '">' + (d ? throwLabel(d) : '–') + '</div>';
    }).join('');

    $('cricket-mult').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', Number(b.getAttribute('data-mult')) === UI.mult);
    });

    var prefix = UI.mult === 3 ? 'T' : UI.mult === 2 ? 'D' : '';
    $('cricket-grid').innerHTML = [20, 19, 18, 17, 16, 15].map(function (n) {
      var closedForAll = g.players.every(function (id) { return st.marks[id][n] >= 3; });
      return '<button data-num="' + n + '" class="' + (closedForAll ? 'dim' : '') + '">' +
        (prefix ? '<span class="mx">' + prefix + '</span>' : '') + n + '</button>';
    }).join('') +
      '<button class="bull" data-num="25">' + (UI.mult === 2 ? 'Bull ×2' : 'Bull') + '</button>' +
      '<button class="miss wide" data-num="0">Miss</button>';
  }

  function renderRtw() {
    var g = S.game;
    if (!g || g.kind !== 'rtw') { S.screen = 'setup'; render(); return; }
    var st = rtwState(g);
    var active = g.done ? g.winner : gameTurnPlayer(g);
    var visit = gameVisitDarts(g);

    $('rtw-sub').textContent = 'Single = 1 weiter · Double = 2 · Triple = 3';

    $('rtw-board').innerHTML = g.players.map(function (id) {
      var t = st.target[id];
      var done = t === 25 ? 20 : t - 1;
      return '<div class="rtw-row ' + (id === active ? 'act' : '') + '">' +
        avatarHTML(profile(id), 'md') +
        '<div class="rw-main">' +
          '<div class="rw-name">' + esc(pname(id)) + '</div>' +
          '<div class="rw-bar"><span style="width:' + (done / 20 * 100) + '%"></span></div>' +
          '<div class="rw-sub">' + st.darts[id] + ' Darts · ' + st.hits[id] + ' Treffer</div>' +
        '</div>' +
        '<div class="rw-target">' + (t === 25 ? 'Bull' : t) + '</div>' +
        '</div>';
    }).join('');

    $('rtw-turn').innerHTML = g.done
      ? '<b>' + esc(pname(g.winner)) + '</b> gewinnt'
      : '<span class="muted">Am Wurf</span> <b>' + esc(pname(active)) + '</b> <span class="muted">auf</span> <b>' +
        (st.target[active] === 25 ? 'Bull' : st.target[active]) + '</b>';

    $('rtw-darts').innerHTML = [0, 1, 2].map(function (i) {
      var d = visit[i];
      return '<div class="d ' + (d ? '' : 'empty') + '">' + (d ? throwLabel(d) : '–') + '</div>';
    }).join('');

    /* Es wird immer nur auf die eigene aktuelle Zahl geworfen – deshalb nur
       diese eine Zahl zeigen, dafür groß und mit dem jeweiligen Sprung. */
    var target = st.target[active];
    if (target === 25) {
      $('rtw-pad').innerHTML =
        '<div class="rtw-pad-grid bull">' +
        '<button class="rtw-key bull" data-num="25" data-mult="1"><span class="k">Bull</span><span class="sub">Spiel gewonnen</span></button>' +
        '<button class="rtw-key miss" data-num="0" data-mult="1"><span class="k">Miss</span><span class="sub">daneben</span></button>' +
        '</div>';
    } else {
      var jump = function (mult) {
        var next = target + mult;
        return next > 20 ? 'weiter auf Bull' : 'weiter auf ' + next;
      };
      $('rtw-pad').innerHTML = '<div class="rtw-pad-grid">' +
        '<button class="rtw-key" data-num="' + target + '" data-mult="1"><span class="k">Single ' + target + '</span><span class="sub">' + jump(1) + '</span></button>' +
        '<button class="rtw-key" data-num="' + target + '" data-mult="2"><span class="k">Double ' + target + '</span><span class="sub">' + jump(2) + '</span></button>' +
        '<button class="rtw-key" data-num="' + target + '" data-mult="3"><span class="k">Triple ' + target + '</span><span class="sub">' + jump(3) + '</span></button>' +
        '<button class="rtw-key miss" data-num="0" data-mult="1"><span class="k">Miss</span><span class="sub">daneben</span></button>' +
        '</div>';
    }
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
            statRow('Beste Aufnahme', st.highScore || '–') +
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

      if (found.live && !allMatchesDone()) {
        actions = '<button class="btn primary full big" data-action="ov-next-match">Nächstes Spiel</button>' +
          '<button class="btn ghost full" data-action="to-tournament">Zur Tabelle</button>';
      } else if (found.live) {
        actions = '<button class="btn primary full big" data-action="to-winner">Turnier auswerten</button>' +
          '<button class="btn ghost full" data-action="to-tournament">Zur Tabelle</button>';
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
    var table = standings();
    if (!table.length) { S.screen = 'setup'; render(); return; }
    var medals = ['🥇', '🥈', '🥉'];
    $('winner-box').innerHTML =
      '<div style="text-align:center"><div class="big-emoji">🏆</div>' +
      '<h1>' + esc(table[0].name) + ' gewinnt!</h1>' +
      '<p class="muted">' + plural(table[0].won, 'Spiel', 'Spiele') + ' von ' + (tourPlayers().length - 1) + ' gewonnen</p></div>' +
      '<div class="podium">' + table.map(function (st, i) {
        return '<div class="p ' + (i === 0 ? 'first' : '') + '">' +
          '<div class="medal">' + (medals[i] || (i + 1) + '.') + '</div>' +
          avatarHTML(profile(st.id), 'sm') +
          '<div class="pn">' + esc(st.name) + '</div>' +
          '<div class="pv">' + st.won + ' Siege · Legs ' + st.legsWon + ':' + st.legsLost + ' · Ø ' + (st.avg ? st.avg.toFixed(1) : '–') + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  function renderOverlay() {
    var ov = $('overlay');
    if (!UI.overlay) { ov.classList.add('hidden'); return; }
    ov.classList.remove('hidden');
    var o = UI.overlay;
    var html = '';

    if (o.type === 'checkout-darts') {
      html = '<h3>Checkout!</h3><p>Mit wie vielen Darts wurde ' + o.score + ' beendet?</p>' +
        '<div class="row-btns">' + o.options.map(function (n) {
          return '<button class="btn primary" data-action="co-darts" data-n="' + n + '">' + n + '</button>';
        }).join('') + '</div>' +
        '<button class="btn ghost full" data-action="ov-cancel">Abbrechen</button>';
    } else if (o.type === 'leg-done') {
      var m1 = currentMatch();
      html = '<div class="big-emoji">🎯</div><h3>Leg an ' + esc(pname(o.pid)) + '</h3>' +
        '<p>Stand: ' + legsWon(m1, m1.p[0]) + ':' + legsWon(m1, m1.p[1]) + '</p>' +
        '<button class="btn primary full" data-action="ov-next-leg">Nächstes Leg</button>' +
        '<button class="btn ghost full" data-action="undo">Eingabe rückgängig</button>';
    } else if (o.type === 'match-done') {
      var m2 = currentMatch();
      var last = !nextOpenMatch();
      html = '<div class="big-emoji">🏅</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + esc(pname(m2.p[0])) + ' ' + legsWon(m2, m2.p[0]) + ':' + legsWon(m2, m2.p[1]) + ' ' + esc(pname(m2.p[1])) + '</p>' +
        '<button class="btn primary full" data-action="open-summary" data-kind="501" data-id="' + m2.id + '">Weiter zur Spielstatistik</button>' +
        (last ? '' : '<button class="btn ghost full" data-action="ov-next-match">Direkt zum nächsten Spiel</button>') +
        '<button class="btn ghost full" data-action="undo">Eingabe rückgängig</button>';
    } else if (o.type === 'confirm-reset') {
      html = '<h3>Turnier abbrechen?</h3>' +
        '<p>Die bereits gespielten Spiele bleiben in Statistik und Rangliste erhalten.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Weiterspielen</button>' +
        '<button class="btn danger" data-action="ov-reset">Abbrechen</button></div>';
    } else if (o.type === 'profile') {
      var p = o.draft;
      var isNew = !o.id;
      html = '<h3>' + (isNew ? 'Neuer Spieler' : 'Spieler bearbeiten') + '</h3>' +
        '<div class="avatar-edit" data-action="pick-avatar">' +
          avatarHTML({ id: o.id || 'neu', name: p.name || '?', avatar: p.avatar }, 'xl') +
          '<span class="cam">Foto wählen</span>' +
        '</div>' +
        '<input class="name-input" type="text" data-role="profile-name" value="' + esc(p.name) + '" placeholder="Name" maxlength="16">' +
        (p.avatar ? '<button class="btn ghost full" data-action="clear-avatar">Foto entfernen</button>' : '') +
        '<div class="row-btns two"><button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn primary" data-action="save-profile">Speichern</button></div>' +
        (isNew ? '' : '<button class="btn danger ghost full" data-action="hide-profile">' +
          (profile(o.id).hidden ? 'Wieder einblenden' : 'Spieler ausblenden') + '</button>' +
          '<p class="hint">Ausgeblendete Spieler tauchen nicht mehr in der Aufstellung auf, ihre Ergebnisse bleiben aber in Statistik und Rangliste erhalten.</p>');
    } else if (o.type === 'game-done') {
      html = '<div class="big-emoji">🏆</div><h3>Glückwunsch, ' + esc(pname(o.pid)) + '!</h3>' +
        '<p>' + (S.game && S.game.kind === 'cricket' ? 'Cricket' : 'Round the World') + '</p>' +
        '<button class="btn primary full" data-action="open-summary" data-kind="' + (S.game ? S.game.kind : 'cricket') + '" data-id="current">Weiter zur Spielstatistik</button>' +
        '<button class="btn ghost full" data-action="undo-game">Letzten Dart zurück</button>';
    } else if (o.type === 'confirm-new-tournament') {
      html = '<h3>Laufendes Turnier beenden?</h3>' +
        '<p>Im aktuellen Turnier ' + (o.played === 1 ? 'ist bereits 1 Spiel' : 'sind bereits ' + o.played + ' Spiele') +
        ' gespielt. Das Turnier wird gewertet und archiviert, dann beginnt ein neues.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Zurück</button>' +
        '<button class="btn primary" data-action="ov-new-tournament">Neues Turnier</button></div>';
    } else if (o.type === 'need-players') {
      html = '<h3>Zu wenig Spieler</h3><p>Wähle mindestens zwei Spieler für das Turnier aus.</p>' +
        '<button class="btn primary full" data-action="ov-cancel">Alles klar</button>';
    }
    $('overlay-card').innerHTML = html;
  }

  /* ================= Aktionen ================= */
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
    S.tour = { start: S.settings.start, bestOf: S.settings.bestOf, players: S.lineup.slice() };
    S.matches = buildSchedule(S.lineup.slice());
    S.current = null;
    S.screen = 'tournament';
    save();
    render();
  }

  function openMatch(id) {
    var m = matchById(id);
    if (!m) return;
    S.current = id;
    UI.input = ''; UI.darts = []; UI.mult = 1; UI.modeOverride = null; UI.error = ''; UI.overlay = null;
    S.screen = m.starter ? 'game' : 'bulloff';
    save();
    render();
  }

  /* Nach diesen Tipps erscheint sofort ein Spielfeld unter dem Finger –
     ein nachrutschender zweiter Tipp darf dort kein Wurf werden. */
  var SETTLE_ACTIONS = { 'restart-game': 1, 'ov-next-leg': 1, 'co-darts': 1 };

  function handleAction(action, el) {
    if (SETTLE_ACTIONS[action]) settleUntil = Date.now() + 300;
    switch (action) {
      case 'nav': {
        var target = el.getAttribute('data-screen');
        // Solange ein Spiel läuft, führt "Turnier" dorthin zurück.
        if (target === 'setup' && S.game && S.game.done) {
          UI.summary = { kind: S.game.kind, id: 'current' };
          target = 'summary';
        } else if (target === 'setup' && S.game) target = S.game.kind;
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
        UI.overlay = { type: 'profile', id: null, draft: { name: '', avatar: null } };
        render();
        break;
      case 'edit-profile': {
        var p = profile(el.getAttribute('data-id'));
        UI.overlay = { type: 'profile', id: p.id, draft: { name: p.name, avatar: p.avatar } };
        render();
        break;
      }
      case 'edit-current-profile': {
        var cp = profile(UI.profile);
        UI.overlay = { type: 'profile', id: cp.id, draft: { name: cp.name, avatar: cp.avatar } };
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
        } else {
          var np = { id: uid(), name: name, avatar: draft.avatar, created: Date.now(), hue: freeHue() };
          S.profiles.push(np);
          if (S.lineup.length < 12) S.lineup.push(np.id);
        }
        UI.overlay = null;
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
        UI.summary = { kind: el.getAttribute('data-kind'), id: el.getAttribute('data-id') };
        UI.overlay = null;
        S.screen = 'summary';
        save(); render();
        break;
      case 'summary-back':
        UI.summary = null;
        S.screen = S.game ? S.game.kind : (S.matches.length ? 'tournament' : 'boards');
        save(); render();
        break;
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
          S.screen = S.game ? S.game.kind : 'tournament';
        }
        save(); render();
        break;
      case 'to-setup':
        S.screen = 'setup'; save(); render();
        break;
      case 'to-tournament':
        S.screen = 'tournament'; UI.overlay = null; save(); render();
        break;
      case 'to-winner':
        S.screen = 'winner'; save(); render();
        break;
      case 'finish-tournament':
        archiveTournament();
        S.screen = 'setup';
        save(); render();
        break;
      case 'next-match': {
        var nm = nextOpenMatch();
        if (nm) openMatch(nm.id);
        break;
      }
      case 'open-match':
        openMatch(el.getAttribute('data-id'));
        break;
      case 'pick-starter': {
        var m = currentMatch();
        if (!m) return;
        m.starter = el.getAttribute('data-id');
        S.screen = 'game';
        save(); render();
        break;
      }
      case 'undo':
        undo();
        break;
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
      case 'ov-to-table':
        UI.overlay = null; S.screen = 'tournament'; save(); render();
        break;
      case 'ov-finish':
        UI.overlay = null; S.screen = 'winner'; save(); render();
        break;
      case 'reset':
        UI.overlay = { type: 'confirm-reset' }; render();
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
  document.addEventListener('click', function (ev) {
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
    if (modeBtn) { UI.modeOverride = modeBtn.getAttribute('data-mode'); UI.error = ''; render(); return; }

    var key2 = ev.target.closest('.keypad button');
    if (key2) { pressKey(key2.getAttribute('data-key')); return; }

    var quick = ev.target.closest('[data-quick]');
    if (quick) {
      if (quickDoubleTap(quick.getAttribute('data-quick'))) return;
      UI.input = quick.getAttribute('data-quick');
      submitTotal();
      return;
    }

    var mult = ev.target.closest('.mult-row button');
    if (mult) { UI.mult = Number(mult.getAttribute('data-mult')); render(); return; }

    var bull = ev.target.closest('[data-bull]');
    if (bull) { pushDart(2, 25); return; }

    var num = ev.target.closest('[data-num]');
    if (num) {
      var n2 = Number(num.getAttribute('data-num'));
      var own = num.getAttribute('data-mult');
      if (S.screen === 'cricket') { cricketDart(own ? Number(own) : UI.mult, n2); return; }
      if (S.screen === 'rtw') { rtwDart(own ? Number(own) : UI.mult, n2); return; }
      if (n2 === 0) pushDart(1, 0);
      else if (n2 === 25) pushDart(1, 25);
      else pushDart(UI.mult, n2);
      return;
    }
  });

  /* Name im Profil-Dialog: nur den Entwurf pflegen, nicht neu rendern –
     sonst verliert das Feld beim Tippen den Fokus. */
  document.addEventListener('input', function (ev) {
    if (ev.target.getAttribute('data-role') === 'profile-name' && UI.overlay) {
      UI.overlay.draft.name = ev.target.value;
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

  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'game' || UI.overlay) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    var m = currentMatch();
    if (!m) return;
    var leg = activeLeg(m);
    if (!leg) return;
    if (ev.key.toLowerCase() === 'z') { undo(); ev.preventDefault(); return; }
    var rest = remainingIn(leg, activePlayer(leg, m)) - sum(UI.darts, function (d) { return d.v; });
    if (effectiveMode(rest) !== 'total') return;
    if (ev.key >= '0' && ev.key <= '9') { pressKey(ev.key); ev.preventDefault(); }
    else if (ev.key === 'Enter') { pressKey('ok'); ev.preventDefault(); }
    else if (ev.key === 'Backspace') { pressKey('del'); ev.preventDefault(); }
  });

  /* ================= Start ================= */
  S = load() || newState();
  if (!S.lineup.length) S.lineup = activeProfiles().slice(0, 4).map(function (p) { return p.id; });
  if ((S.screen === 'cricket' || S.screen === 'rtw') && !S.game) S.screen = 'setup';
  if (S.game && (S.screen === 'cricket' || S.screen === 'rtw') && S.game.kind !== S.screen) S.screen = S.game.kind;
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
  if (S.screen === 'bulloff' && !currentMatch()) S.screen = 'tournament';
  if (!S.matches.length && S.screen === 'tournament') S.screen = 'setup';
  if (S.screen === 'profile' && !UI.profile) S.screen = 'players';
  if (S.screen === 'summary' && !UI.summary) S.screen = S.matches.length ? 'tournament' : 'setup';
  render();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline-Cache optional */ });
  }

  // Für Tests unter Node/Headless
  if (typeof window !== 'undefined') {
    window.__dart = {
      state: function () { return S; },
      ui: function () { return UI; },
      action: handleAction,
      pushDart: pushDart,
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
      rtwState: function () { return rtwState(S.game); },
      reset: function () { S = newState(); UI.overlay = null; render(); }
    };
  }
})();
