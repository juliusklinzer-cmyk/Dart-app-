/*
 * Dart-Turnier – Jeder gegen jeden, 501 Double Out.
 * Kein Framework, kein Build: State im Speicher, Persistenz via localStorage.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dart-turnier-v1';
  var DEFAULT_PLAYERS = ['Lenas', 'Tobi', 'Domi', 'Julius'];
  var QUICK_SCORES = [26, 41, 45, 60, 81, 85, 100, 140, 180];
  /* Summen, die mit 3 Darts nicht zu werfen sind. */
  var IMPOSSIBLE = { 163: 1, 166: 1, 169: 1, 172: 1, 173: 1, 175: 1, 176: 1, 178: 1, 179: 1 };

  var S = null;
  var UI = { input: '', darts: [], mult: 1, modeOverride: null, overlay: null, error: '' };

  /* ================= Helfer ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function sum(arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f(arr[i]); return t; }

  function newState() {
    return {
      v: 1,
      screen: 'setup',
      settings: { start: 501, bestOf: 1, dartModeFrom: 170 },
      players: DEFAULT_PLAYERS.map(function (n) { return { id: uid(), name: n }; }),
      matches: [],
      current: null
    };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* Speicher voll / privater Modus */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.players)) return null;
      return s;
    } catch (e) { return null; }
  }

  function player(id) {
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === id) return S.players[i];
    return { id: id, name: '?' };
  }
  function pname(id) { return player(id).name; }
  function legsToWin() { return Math.floor(S.settings.bestOf / 2) + 1; }

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
          id: uid(),
          round: r + 1,
          p: r % 2 === 0 ? [a, b] : [b, a],
          starter: null,
          legs: [],
          done: false,
          winner: null
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
    var rest = S.settings.start;
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

  /* Aufnahme abschließen und Leg-/Matchstand fortschreiben. */
  function commitVisit(score, darts, isCheckout, isBust) {
    var m = currentMatch();
    var leg = activeLeg(m);
    var pid = activePlayer(leg, m);
    leg.visits.push({ p: pid, s: isBust ? 0 : score, d: darts, b: !!isBust, c: !!isCheckout, o: isBust ? score : 0 });

    UI.input = '';
    UI.darts = [];
    UI.mult = 1;
    UI.modeOverride = null;
    UI.error = '';

    if (isCheckout) {
      leg.winner = pid;
      if (legsWon(m, pid) >= legsToWin()) {
        m.done = true;
        m.winner = pid;
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
      commitVisit(total, thrown, false, true);
      return;
    }
    if (after === 0) { commitVisit(total, thrown, true, false); return; }
    if (thrown === 3) { commitVisit(total, 3, false, false); return; }
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
    UI.overlay = null;
    UI.input = '';
    save();
    render();
  }

  /* ================= Statistik ================= */
  function stats() {
    var map = {};
    S.players.forEach(function (p) {
      map[p.id] = {
        id: p.id, name: p.name, darts: 0, points: 0, legsWon: 0, legsLost: 0,
        won: 0, lost: 0, played: 0, s180: 0, s140: 0, highCO: 0, bestLeg: null
      };
    });
    S.matches.forEach(function (m) {
      if (m.done) {
        map[m.p[0]].played++; map[m.p[1]].played++;
        if (map[m.winner]) map[m.winner].won++;
        var loser = m.winner === m.p[0] ? m.p[1] : m.p[0];
        if (map[loser]) map[loser].lost++;
      }
      m.legs.forEach(function (leg) {
        leg.visits.forEach(function (v) {
          var st = map[v.p];
          if (!st) return;
          st.darts += v.d;
          if (!v.b) {
            st.points += v.s;
            if (v.s === 180) st.s180++;
            else if (v.s >= 140) st.s140++;
            if (v.c && v.s > st.highCO) st.highCO = v.s;
          }
        });
        if (leg.winner && map[leg.winner]) {
          map[leg.winner].legsWon++;
          var opp = m.p[0] === leg.winner ? m.p[1] : m.p[0];
          if (map[opp]) map[opp].legsLost++;
          var d = dartsIn(leg, leg.winner);
          if (map[leg.winner].bestLeg === null || d < map[leg.winner].bestLeg) map[leg.winner].bestLeg = d;
        }
      });
    });
    Object.keys(map).forEach(function (k) {
      var st = map[k];
      st.avg = st.darts ? (st.points / st.darts) * 3 : 0;
      st.legDiff = st.legsWon - st.legsLost;
    });
    return map;
  }

  function standings() {
    var map = stats();
    return S.players.map(function (p) { return map[p.id]; }).sort(function (a, b) {
      if (b.won !== a.won) return b.won - a.won;
      if (b.legDiff !== a.legDiff) return b.legDiff - a.legDiff;
      if (b.avg !== a.avg) return b.avg - a.avg;
      return a.name.localeCompare(b.name);
    });
  }

  /* ================= Rendering ================= */
  function show(screen) {
    ['setup', 'tournament', 'bulloff', 'game', 'winner'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === screen);
    });
  }

  function render() {
    show(S.screen);
    if (S.screen === 'setup') renderSetup();
    if (S.screen === 'tournament') renderTournament();
    if (S.screen === 'bulloff') renderBullOff();
    if (S.screen === 'game') renderGame();
    if (S.screen === 'winner') renderWinner();
    renderOverlay();
  }

  function renderSetup() {
    var list = $('player-list');
    list.innerHTML = S.players.map(function (p, i) {
      return '<div class="player-row" data-pid="' + p.id + '">' +
        '<div class="idx">' + (i + 1) + '</div>' +
        '<input type="text" value="' + esc(p.name) + '" placeholder="Name" maxlength="14" data-role="pname">' +
        (S.players.length > 2 ? '<button class="rm" data-action="rm-player" aria-label="Entfernen">×</button>' : '') +
        '</div>';
    }).join('');

    document.querySelectorAll('.segmented[data-setting]').forEach(function (seg) {
      var key = seg.getAttribute('data-setting');
      seg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', Number(b.getAttribute('data-value')) === S.settings[key]);
      });
    });

    var running = S.matches.length > 0 && !allMatchesDone();
    $('resume-box').classList.toggle('hidden', !running);
    if (running) {
      var done = sum(S.matches, function (m) { return m.done ? 1 : 0; });
      $('resume-info').textContent = done + ' von ' + S.matches.length + ' Spielen gespielt';
    }
  }

  function renderTournament() {
    var table = standings();
    $('standings-body').innerHTML = table.map(function (st, i) {
      return '<tr class="' + (i === 0 && st.won > 0 ? 'leader' : '') + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="left name">' + esc(st.name) + '</td>' +
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

    var btn = document.querySelector('[data-action="next-match"]');
    if (allMatchesDone()) {
      btn.textContent = 'Endstand ansehen';
      btn.setAttribute('data-action', 'to-winner');
    } else {
      btn.textContent = next ? 'Nächstes Spiel: ' + pname(next.p[0]) + ' vs ' + pname(next.p[1]) : 'Nächstes Spiel';
      btn.setAttribute('data-action', 'next-match');
    }

    var map = stats();
    $('stats-grid').innerHTML = S.players.map(function (p) {
      var st = map[p.id];
      return '<div class="stat-card">' +
        '<div class="who">' + esc(p.name) + '</div>' +
        '<div class="line"><span>Ø 3 Darts</span><b>' + (st.avg ? st.avg.toFixed(1) : '–') + '</b></div>' +
        '<div class="line"><span>180er</span><b>' + st.s180 + '</b></div>' +
        '<div class="line"><span>140+</span><b>' + st.s140 + '</b></div>' +
        '<div class="line"><span>Höchstes Finish</span><b>' + (st.highCO || '–') + '</b></div>' +
        '<div class="line"><span>Bestes Leg</span><b>' + (st.bestLeg ? st.bestLeg + ' Darts' : '–') + '</b></div>' +
        '</div>';
    }).join('');
  }

  function renderBullOff() {
    var m = currentMatch();
    if (!m) { S.screen = 'tournament'; render(); return; }
    $('bulloff-buttons').innerHTML = m.p.map(function (pid) {
      return '<button data-action="pick-starter" data-id="' + pid + '">' + esc(pname(pid)) + '</button>';
    }).join('');
  }

  function renderGame() {
    var m = currentMatch();
    if (!m) { S.screen = 'tournament'; render(); return; }
    var leg = ensureLeg(m);
    if (!leg) { S.screen = 'tournament'; render(); return; }

    var active = activePlayer(leg, m);
    var idx = S.matches.indexOf(m);
    $('game-match-label').textContent = 'Spiel ' + (idx + 1) + ' von ' + S.matches.length;
    $('game-leg-label').textContent = S.settings.bestOf > 1
      ? 'Leg ' + m.legs.length + ' · Stand ' + legsWon(m, m.p[0]) + ':' + legsWon(m, m.p[1]) + ' (first to ' + legsToWin() + ')'
      : 'Ein Leg · ' + S.settings.start + ' Double Out';

    var pendingSum = sum(UI.darts, function (d) { return d.v; });
    $('scoreboard').innerHTML = m.p.map(function (pid) {
      var rest = remainingIn(leg, pid) - (pid === active ? pendingSum : 0);
      var darts = dartsIn(leg, pid) + (pid === active ? UI.darts.length : 0);
      var scored = S.settings.start - remainingIn(leg, pid) + (pid === active ? pendingSum : 0);
      var avg = darts ? (scored / darts * 3).toFixed(1) : '–';
      return '<div class="pcard ' + (pid === active ? 'active' : '') + '">' +
        '<div class="pname">' + (pid === active ? '<span class="arrow">▸</span>' : '') + esc(pname(pid)) + '</div>' +
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
      var rowRest = S.settings.start;
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

  function renderWinner() {
    var table = standings();
    var medals = ['🥇', '🥈', '🥉'];
    $('winner-box').innerHTML =
      '<div style="text-align:center"><div class="big-emoji">🏆</div>' +
      '<h1>' + esc(table[0].name) + ' gewinnt!</h1>' +
      '<p class="muted">' + table[0].won + ' von ' + (S.players.length - 1) + ' Spielen gewonnen</p></div>' +
      '<div class="podium">' + table.map(function (st, i) {
        return '<div class="p ' + (i === 0 ? 'first' : '') + '">' +
          '<div class="medal">' + (medals[i] || (i + 1) + '.') + '</div>' +
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
      html = '<div class="big-emoji">🏅</div><h3>' + esc(pname(o.pid)) + ' gewinnt</h3>' +
        '<p>' + esc(pname(m2.p[0])) + ' ' + legsWon(m2, m2.p[0]) + ':' + legsWon(m2, m2.p[1]) + ' ' + esc(pname(m2.p[1])) + '</p>' +
        (last
          ? '<button class="btn primary full" data-action="ov-finish">Turnier auswerten</button>'
          : '<button class="btn primary full" data-action="ov-next-match">Nächstes Spiel</button>') +
        '<button class="btn ghost full" data-action="ov-to-table">Zur Tabelle</button>' +
        '<button class="btn ghost full" data-action="undo">Eingabe rückgängig</button>';
    } else if (o.type === 'confirm-reset') {
      html = '<h3>Turnier zurücksetzen?</h3><p>Alle Ergebnisse und Statistiken gehen verloren.</p>' +
        '<div class="row-btns two">' +
        '<button class="btn ghost" data-action="ov-cancel">Abbrechen</button>' +
        '<button class="btn danger" data-action="ov-reset">Zurücksetzen</button></div>';
    }
    $('overlay-card').innerHTML = html;
  }

  /* ================= Aktionen ================= */
  function startTournament() {
    document.querySelectorAll('#player-list .player-row').forEach(function (row) {
      var p = player(row.getAttribute('data-pid'));
      var val = row.querySelector('[data-role="pname"]').value.trim();
      if (val) p.name = val;
    });
    var names = {};
    S.players.forEach(function (p, i) {
      if (!p.name) p.name = 'Spieler ' + (i + 1);
      if (names[p.name]) p.name = p.name + ' ' + (i + 1);
      names[p.name] = 1;
    });
    S.matches = buildSchedule(S.players.map(function (p) { return p.id; }));
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

  function handleAction(action, el) {
    switch (action) {
      case 'add-player':
        if (S.players.length >= 12) return;
        S.players.push({ id: uid(), name: 'Spieler ' + (S.players.length + 1) });
        save(); render();
        break;
      case 'rm-player': {
        var pid = el.closest('.player-row').getAttribute('data-pid');
        if (S.players.length <= 2) return;
        S.players = S.players.filter(function (p) { return p.id !== pid; });
        save(); render();
        break;
      }
      case 'start-tournament':
        startTournament();
        break;
      case 'resume':
        S.screen = 'tournament'; save(); render();
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
      case 'ov-reset': {
        var keep = S.players.map(function (p) { return { id: uid(), name: p.name }; });
        var settings = S.settings;
        S = newState();
        S.players = keep;
        S.settings = settings;
        UI.overlay = null;
        save(); render();
        break;
      }
    }
  }

  /* ================= Events ================= */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (t) { handleAction(t.getAttribute('data-action'), t); return; }

    var seg = ev.target.closest('.segmented[data-setting] button');
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
    if (quick) { UI.input = quick.getAttribute('data-quick'); submitTotal(); return; }

    var mult = ev.target.closest('#mult-row button');
    if (mult) { UI.mult = Number(mult.getAttribute('data-mult')); render(); return; }

    var bull = ev.target.closest('[data-bull]');
    if (bull) { pushDart(2, 25); return; }

    var num = ev.target.closest('[data-num]');
    if (num) {
      var n2 = Number(num.getAttribute('data-num'));
      if (n2 === 0) pushDart(1, 0);
      else if (n2 === 25) pushDart(1, 25);
      else pushDart(UI.mult, n2);
      return;
    }
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.getAttribute('data-role') === 'pname') {
      var pid = ev.target.closest('.player-row').getAttribute('data-pid');
      player(pid).name = ev.target.value;
      save();
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (S.screen !== 'game' || UI.overlay) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    var m = currentMatch();
    if (!m) return;
    var leg = activeLeg(m);
    if (!leg) return;
    var rest = remainingIn(leg, activePlayer(leg, m)) - sum(UI.darts, function (d) { return d.v; });
    if (effectiveMode(rest) !== 'total') return;
    if (ev.key >= '0' && ev.key <= '9') { pressKey(ev.key); ev.preventDefault(); }
    else if (ev.key === 'Enter') { pressKey('ok'); ev.preventDefault(); }
    else if (ev.key === 'Backspace') { pressKey('del'); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'z') { undo(); ev.preventDefault(); }
  });

  /* ================= Start ================= */
  S = load() || newState();
  if (S.screen === 'game' && !currentMatch()) S.screen = 'tournament';
  if (S.screen === 'bulloff' && !currentMatch()) S.screen = 'tournament';
  if (!S.matches.length && S.screen === 'tournament') S.screen = 'setup';
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
      remainingIn: remainingIn,
      activeLeg: activeLeg,
      activePlayer: activePlayer,
      currentMatch: currentMatch,
      reset: function () { S = newState(); UI = { input: '', darts: [], mult: 1, modeOverride: null, overlay: null, error: '' }; render(); }
    };
  }
})();
