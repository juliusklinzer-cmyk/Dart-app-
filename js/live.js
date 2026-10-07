/*
 * Live-Ticker fuer Zuschauer (live.html#<schluessel>).
 *
 * Holt alle vier Sekunden den Stand des geteilten Ligaspiels vom Server
 * (GET /api/zuschauer/<schluessel>, ohne Konto) und zeichnet: Team-Stand,
 * die gerade laufenden Einzel mit Restpunkten (LIVE), alle Einzel nach
 * Durchgaengen, Highlights, Man of the Day und die Statistik je Spieler.
 * Gerechnet wird hier aus den Wuerfen - der Server verwahrt nur.
 */
(function () {
  'use strict';
  var TEAM = 'Blink 180';
  var TAKT = 4000;
  var box = document.getElementById('ticker');
  var schluessel = (location.hash || '').replace(/^#/, '');
  var letzter = null, letzteZeit = 0, fehlerZahl = 0, timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function datum(tag) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }

  /* ---------- Rechnen ---------- */
  function legsGewonnen(m, pid) {
    return (m.legs || []).filter(function (l) { return l.winner === pid; }).length;
  }
  /* Rest eines Spielers im laufenden Leg (ohne Bust-Aufnahmen). */
  function rest(start, leg, pid) {
    var r = start;
    (leg ? leg.visits : []).forEach(function (v) { if (v.p === pid && !v.b) r -= v.s; });
    return r;
  }
  function amWurf(m, leg) {
    if (!leg) return null;
    var starter = leg.starter || m.starter || m.p[0];
    var andere = m.p[0] === starter ? m.p[1] : m.p[0];
    return leg.visits.length % 2 === 0 ? starter : andere;
  }

  function statistik(matches, start) {
    var st = {};
    function s(id) {
      if (!st[id]) st[id] = { siege: 0, nieder: 0, legsG: 0, legsV: 0, darts: 0, punkte: 0, s180: 0, s140: 0, s100: 0, finish: 0, bestLeg: null, finishes: [], shortlegs: [] };
      return st[id];
    }
    matches.forEach(function (m) {
      if (!m || !m.p) return;
      m.p.forEach(function (pid) { s(pid); });
      if (m.done && m.winner) {
        m.p.forEach(function (pid) { if (pid === m.winner) s(pid).siege++; else s(pid).nieder++; });
      }
      (m.legs || []).forEach(function (leg) {
        var darts = {};
        (leg.visits || []).forEach(function (v) {
          var x = s(v.p);
          x.darts += v.d || 0;
          darts[v.p] = (darts[v.p] || 0) + (v.d || 0);
          if (v.b) return;
          x.punkte += v.s;
          if (v.s === 180) x.s180++;
          else if (v.s >= 140) x.s140++;
          else if (v.s >= 100) x.s100++;
          if (v.c) {
            if (v.s > x.finish) x.finish = v.s;
            if (v.s >= 100) x.finishes.push(v.s);
          }
        });
        if (leg.winner) {
          m.p.forEach(function (pid) { if (pid === leg.winner) s(pid).legsG++; else s(pid).legsV++; });
          var d = darts[leg.winner];
          if (d) {
            var w = s(leg.winner);
            if (w.bestLeg === null || d < w.bestLeg) w.bestLeg = d;
            if (d <= 21 && start === 501) w.shortlegs.push(d);
          }
        }
      });
    });
    Object.keys(st).forEach(function (id) {
      var x = st[id];
      x.avg = x.darts ? (x.punkte / x.darts) * 3 : 0;
    });
    return st;
  }

  /* ---------- Zeichnen ---------- */
  function zeichne(t) {
    var lg = t.liga || {};
    var namen = t.namen || {};
    var nm = function (id) { return namen[id] || 'Spieler'; };
    var heimTeam = lg.heim ? TEAM : (lg.gegner || 'Heim');
    var gastTeam = lg.heim ? (lg.gegner || 'Gast') : TEAM;
    var liveMap = {};
    (t.live || []).forEach(function (l) { liveMap[l.matchId] = l.stand; });

    /* Jede Partie in ihrer aktuellsten Form: Ergebnis > Livestand > Plan. */
    var partien = (t.matches || []).map(function (pm) {
      var e = t.ergebnisse && t.ergebnisse[pm.id];
      var l = liveMap[pm.id];
      var p = (e && e.p) || (l && l.p) || pm.p;
      return { plan: pm, p: p, ergebnis: e || null, live: e ? null : (l || null) };
    });

    var hp = 0, gp = 0, hl = 0, gl = 0, fertig = 0;
    partien.forEach(function (x) {
      var m = x.ergebnis || x.live;
      if (m) { hl += legsGewonnen(m, x.p[0]); gl += legsGewonnen(m, x.p[1]); }
      if (x.ergebnis && x.ergebnis.done) {
        fertig++;
        if (x.ergebnis.winner === x.p[0]) hp++; else if (x.ergebnis.winner === x.p[1]) gp++;
      }
    });
    var laufen = partien.filter(function (x) { return x.live; });
    var vorbei = t.status !== 'offen';

    var html = '';
    html += '<header class="kopf"><div class="zeile">' +
      esc((lg.nr ? lg.nr + '. Spieltag · ' : '') + (lg.tag ? datum(lg.tag) + ' · ' : '') + (lg.ort || '')) + '</div>' +
      '<div class="status">' + (vorbei
        ? '<span class="punkt aus"></span>Endstand'
        : '<span class="punkt"></span>Live' + (laufen.length ? ' · ' + laufen.length + ' Einzel laufen' : '')) + '</div></header>';

    html += '<section class="stand">' +
      '<div class="team' + (hp > gp ? ' vorn' : '') + '"><div class="name">' + esc(heimTeam) + '</div><div class="zahl">' + hp + '</div></div>' +
      '<div class="doppelpunkt">:</div>' +
      '<div class="team' + (gp > hp ? ' vorn' : '') + '"><div class="name">' + esc(gastTeam) + '</div><div class="zahl">' + gp + '</div></div>' +
      '</section>' +
      '<div class="unter">Einzel ' + fertig + ' von ' + partien.length + ' gespielt · Legs ' + hl + ':' + gl +
        ' · je gewonnenes Einzel 1 Punkt</div>';

    /* Links: Live + Einzel. Rechts: Highlights, Man of the Day, Statistik. */
    var links = '', rechts = '';

    links += '<section class="karte"><h2><span class="punkt' + (laufen.length ? '' : ' aus') + '"></span>Gerade live</h2>';
    if (!laufen.length) {
      links += '<p class="leer">' + (vorbei ? 'Das Ligaspiel ist beendet.' : 'Gerade läuft kein Einzel – gleich geht es weiter.') + '</p>';
    }
    laufen.forEach(function (x) {
      var m = x.live, pm = x.plan;
      var legs = m.legs || [];
      var leg = legs.length && !legs[legs.length - 1].winner ? legs[legs.length - 1] : null;
      var start = m.start || t.start || 501;
      var dran = amWurf({ p: x.p, starter: m.starter }, leg || { starter: null, visits: [] });
      var offen = (m.darts || []).reduce(function (a, d) { return a + (d.v || 0); }, 0);
      links += '<div class="live-einzel"><div class="le-kopf"><span class="live-marke"><span class="punkt"></span>LIVE</span>' +
        '<span>' + (pm.scheibe ? 'Board ' + esc(pm.scheibe.replace('S', '')) + ' · ' : '') + 'Leg ' + (legs.filter(function (l) { return l.winner; }).length + 1) + '</span></div>';
      x.p.forEach(function (pid, i) {
        var r = rest(start, leg, pid) - (pid === dran ? offen : 0);
        var pos = pm.posPaar ? (i === 0 ? 'H' : 'G') + (pm.posPaar[i] + 1) : '';
        links += '<div class="le-spieler"><div class="le-name' + (pid === dran ? ' dran' : '') + '"><span class="pos">' + pos + '</span>' + esc(nm(pid)) + '</div>' +
          '<div class="le-legs">' + legsGewonnen(m, pid) + '</div><div class="le-rest">' + r + '</div></div>';
      });
      var letzte = leg ? leg.visits.slice(-4).map(function (v) { return esc(nm(v.p).split(' ')[0]) + ' ' + (v.b ? 'Bust' : v.s); }) : [];
      if (offen) letzte.push(esc(nm(dran).split(' ')[0]) + ' wirft gerade (' + (m.darts || []).length + ' Dart' + ((m.darts || []).length === 1 ? '' : 's') + ')');
      if (letzte.length) links += '<div class="le-letzte">' + letzte.join(' · ') + '</div>';
      links += '</div>';
    });
    links += '</section>';

    links += '<section class="karte"><h2>Alle Einzel</h2>';
    var runde = null;
    partien.forEach(function (x) {
      var pm = x.plan;
      if (pm.round !== runde) { runde = pm.round; links += '<div class="durchgang">Durchgang ' + runde + '</div>'; }
      var m = x.ergebnis || x.live;
      var a = m ? legsGewonnen(m, x.p[0]) : null, b = m ? legsGewonnen(m, x.p[1]) : null;
      var sieger = x.ergebnis && x.ergebnis.done ? x.ergebnis.winner : null;
      var chip = x.ergebnis && x.ergebnis.done ? '<span class="chip fertig">fertig</span>'
        : x.live ? '<span class="chip live">live</span>' : '<span class="chip">offen</span>';
      links += '<div class="einzel">' +
        '<div class="a' + (sieger === x.p[0] ? ' w' : '') + '">' + esc(nm(x.p[0])) + ' <span class="pos">H' + (pm.posPaar ? pm.posPaar[0] + 1 : '') + '</span></div>' +
        '<div class="erg">' + (m ? a + ':' + b : '–') + '</div>' +
        '<div class="' + (sieger === x.p[1] ? 'w' : '') + '"><span class="pos">G' + (pm.posPaar ? pm.posPaar[1] + 1 : '') + '</span> ' + esc(nm(x.p[1])) + '</div>' +
        chip + '</div>';
    });
    links += '</section>';

    var alle = partien.map(function (x) {
      var m = x.ergebnis || x.live;
      return m ? { p: x.p, legs: m.legs || [], done: !!(x.ergebnis && x.ergebnis.done), winner: x.ergebnis ? x.ergebnis.winner : null } : null;
    }).filter(Boolean);
    var st = statistik(alle, t.start || 501);
    var heimIds = [], gastIds = [];
    partien.forEach(function (x) {
      if (heimIds.indexOf(x.p[0]) < 0) heimIds.push(x.p[0]);
      if (gastIds.indexOf(x.p[1]) < 0) gastIds.push(x.p[1]);
    });

    /* Highlights beider Teams */
    var hlZeilen = function (ids) {
      var z = [];
      var h180 = [], hfin = [], hleg = [];
      ids.forEach(function (id) {
        var x = st[id];
        if (!x) return;
        if (x.s180) h180.push(esc(nm(id)) + (x.s180 > 1 ? ' ×' + x.s180 : ''));
        x.finishes.forEach(function (f) { hfin.push(f + ' ' + esc(nm(id))); });
        x.shortlegs.forEach(function (d) { hleg.push(d + ' Darts ' + esc(nm(id))); });
      });
      if (h180.length) z.push('<div><b>180er:</b> ' + h180.join(' · ') + '</div>');
      if (hfin.length) z.push('<div><b>High-Finishes:</b> ' + hfin.join(' · ') + '</div>');
      if (hleg.length) z.push('<div><b>Shortlegs:</b> ' + hleg.join(' · ') + '</div>');
      return z.length ? z.join('') : '<div class="leer">Noch keine</div>';
    };
    rechts += '<section class="karte hl"><h2>Highlights</h2>' +
      '<div class="durchgang">' + esc(heimTeam) + '</div>' + hlZeilen(heimIds) +
      '<div class="durchgang">' + esc(gastTeam) + '</div>' + hlZeilen(gastIds) + '</section>';

    /* Man of the Day: meiste Siege, bei Gleichstand der hoehere Average */
    var bester = function (ids) {
      var b = null;
      ids.forEach(function (id) {
        var x = st[id];
        if (!x || !(x.siege + x.nieder)) return;
        if (!b || x.siege > st[b].siege || (x.siege === st[b].siege && x.avg > st[b].avg)) b = id;
      });
      return b;
    };
    var motdKarte = function (ids, team) {
      var b = bester(ids);
      return '<div class="k"><div class="t">' + esc(team) + '</div>' +
        (b ? '<div class="n">' + esc(nm(b)) + '</div><div class="d">' + st[b].siege + ' Siege · Ø ' + st[b].avg.toFixed(1) + '</div>'
          : '<div class="d">noch offen</div>') + '</div>';
    };
    rechts += '<section class="karte"><h2>Man of the Day' + (vorbei ? '' : ' (bisher)') + '</h2><div class="motd">' +
      motdKarte(heimIds, heimTeam) + motdKarte(gastIds, gastTeam) + '</div></section>';

    /* Statistik je Spieler */
    var zeile = function (id) {
      var x = st[id] || { siege: 0, nieder: 0, legsG: 0, legsV: 0, avg: 0, s180: 0, finish: 0, bestLeg: null };
      return '<tr><td>' + esc(nm(id)) + '</td><td>' + x.siege + ':' + x.nieder + '</td><td>' + x.legsG + ':' + x.legsV + '</td>' +
        '<td>' + (x.avg ? x.avg.toFixed(1) : '–') + '</td><td>' + x.s180 + '</td><td>' + (x.finish || '–') + '</td><td>' + (x.bestLeg || '–') + '</td></tr>';
    };
    rechts += '<section class="karte"><h2>Statistik</h2><table class="tabelle">' +
      '<tr><th>Spieler</th><th>Einzel</th><th>Legs</th><th>Ø</th><th>180</th><th>Finish</th><th>Bestes Leg</th></tr>' +
      '<tr class="team-zeile"><td colspan="7">' + esc(heimTeam) + '</td></tr>' + heimIds.map(zeile).join('') +
      '<tr class="team-zeile"><td colspan="7">' + esc(gastTeam) + '</td></tr>' + gastIds.map(zeile).join('') +
      '</table></section>';

    html += '<div class="raster"><div>' + links + '</div><div>' + rechts + '</div></div>';
    html += '<div class="fuss" id="fuss"></div>';
    box.innerHTML = html;
    fussAktualisieren();
  }

  function fussAktualisieren() {
    var f = document.getElementById('fuss');
    if (!f) return;
    var s = letzteZeit ? Math.round((Date.now() - letzteZeit) / 1000) : 0;
    f.textContent = (fehlerZahl ? 'Verbindung wird gesucht … · ' : '') +
      'Aktualisiert vor ' + s + ' s · Blink 180 Live-Ticker';
  }

  function holen() {
    if (document.hidden) return;
    fetch('/api/zuschauer/' + encodeURIComponent(schluessel), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) { stoppen('Diesen Live-Ticker gibt es nicht (mehr). Bitte den Link prüfen.'); return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d) return;
      fehlerZahl = 0;
      letzteZeit = Date.now();
      var text = JSON.stringify(d.turnier);
      if (text !== letzter) { letzter = text; zeichne(d.turnier); }
      else fussAktualisieren();
    }).catch(function () {
      fehlerZahl++;
      if (!letzter) box.innerHTML = '<p class="fehler-seite">Keine Verbindung – es wird weiter versucht …</p>';
      else fussAktualisieren();
    });
  }
  function stoppen(text) {
    if (timer) clearInterval(timer);
    timer = null;
    box.innerHTML = '<p class="fehler-seite">' + esc(text) + '</p>';
  }

  /* Anderer Link im selben Tab (nur der #-Teil aendert sich): neu laden. */
  window.addEventListener('hashchange', function () { location.reload(); });

  if (!/^[A-Za-z0-9_-]{8,40}$/.test(schluessel)) {
    stoppen('Für den Live-Ticker fehlt der Link-Schlüssel. Bitte den ganzen Link aus der App öffnen.');
    return;
  }
  holen();
  timer = setInterval(holen, TAKT);
  setInterval(fussAktualisieren, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) holen(); });
})();
