/*
 * Live-Ticker fuer Zuschauer (live.html#<schluessel>).
 *
 * Holt alle vier Sekunden den Stand des geteilten Ligaspiels vom Server
 * (GET /api/zuschauer/<schluessel>, ohne Konto) und zeichnet ihn nach den
 * Entwuerfen vom November 2026 (LsLiveWeb, LsLiveHandy, LsLive als
 * Fernseher, LsLiveErg fuer "nur Ergebnisse") - je nach Bildschirm:
 *
 *   handy  schmaler als 700 px: eine Spalte, scrollt
 *   web    Browser, Laptop, iPad: Stand, laufende Einzel, alle Einzel,
 *          Als Naechstes, Man of the Day, Highlights, Statistik
 *   tv     ab 1600 px Breite und Seitenverhaeltnis 1,6 (oder ?tv=1):
 *          ein fester Bildschirm ohne Scrollen, auf Wunsch Vollbild
 *          (nur Stand und die beiden Scheiben, ?voll=1)
 *
 * Hell/dunkel folgt dem Geraet, ?hell=1 bzw. ?hell=0 legt es fest.
 * Gerechnet wird hier aus den Wuerfen - der Server verwahrt nur. Was nicht
 * da ist (Average ohne Wuerfe, "zuletzt" ohne Aufnahme), bleibt weg.
 * Bei "Live ohne Namen" liefert der Server statt der Namen die Bogen-
 * Kennungen (H1, G5 ...); die stehen dann ueberall, wo sonst Namen stehen.
 */
(function () {
  'use strict';
  var TEAM = 'Blink 180';
  var LIGA_NAME = 'SDM Liga 5';
  var TAKT = 4000, TAKT_MAX = 60000;
  var box = document.getElementById('ticker');
  var wurzel = document.documentElement;
  var suche = location.search || '';
  var schluessel = (location.hash || '').replace(/^#/, '');
  var letzter = null, daten = null, letzteZeit = 0, fehlerZahl = 0, timer = null;
  /* Viele Zuschauer hinter einer IP (Kneipen-WLAN) laufen ins Server-Limit
     (429). Dann den Takt verdoppeln statt stur weiterzufragen; die naechste
     gute Antwort stellt ihn zurueck. */
  var takt = TAKT, gedrosselt = false;
  var ausApp = /[?&]app=1\b/.test(suche);
  var tvWunsch = /[?&]tv=1\b/.test(suche) ? true : /[?&]tv=0\b/.test(suche) ? false : null;
  var voll = /[?&]voll=1\b/.test(suche);
  var layout = null, srText = '';

  /* ---------- Darstellung hell/dunkel ---------- */
  var modusWunsch = /[?&]hell=1\b/.test(suche) ? 'hell' : /[?&]hell=0\b/.test(suche) ? 'dunkel' : null;
  if (modusWunsch) wurzel.setAttribute('data-modus', modusWunsch);
  var dunkelAbfrage = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function istHell() { return modusWunsch ? modusWunsch === 'hell' : !(dunkelAbfrage && dunkelAbfrage.matches); }
  function themaFarbe() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', istHell() ? '#f6f3f1' : '#0d0a0b');
  }
  themaFarbe();
  if (dunkelAbfrage && dunkelAbfrage.addEventListener) dunkelAbfrage.addEventListener('change', themaFarbe);

  /* ---------- Hilfen ---------- */
  /* Zahlen aus dem Spielstand kommen vom Server und landen im Markup -
     was keine Zahl ist, wird 0, statt als Text durchzurutschen. */
  function zahl(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function komma(x, stellen) { return x.toFixed(stellen).replace('.', ','); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  function datum(tag, mitTag) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag || '');
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return (mitTag ? WOCHENTAG[d.getDay()] + ' ' : '') + m[3] + '.' + m[2] + '.' + m[1];
  }
  function icon(pfad, groesse, klasse, strich) {
    return '<svg class="ic' + (klasse ? ' ' + klasse : '') + '" aria-hidden="true" width="' + groesse + '" height="' + groesse +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (strich || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + pfad + '</svg>';
  }
  var IC = {
    kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M13 14h4M7 17h3M13 17h4"/>',
    ergebnisse: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 14h3M8 17h7"/>',
    pfeil: '<path d="m9.5 5 7 7-7 7"/>',
    zurueck: '<path d="m14.5 5-7 7 7 7"/>',
    medaille: '<circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" stroke="none" fill="currentColor">1</text>',
    stern: '<path d="M12 2.5C12.5 8 16 11.5 21.5 12 16 12.5 12.5 16 12 21.5 11.5 16 8 12.5 2.5 12 8 11.5 11.5 8 12 2.5z"/>',
    statistik: '<rect x="3" y="15" width="3.5" height="6" rx=".6"/><rect x="10.25" y="11.5" width="3.5" height="9.5" rx=".6"/><rect x="17.5" y="8" width="3.5" height="13" rx=".6"/><path d="M3.5 10.5 9 6l4 2 6.5-5.2"/><circle cx="20" cy="2.5" r="1" fill="currentColor" stroke="none"/>',
    rekord: '<circle cx="12" cy="15.5" r="5.5"/><path d="M7 2.5h4l1 2.5 1-2.5h4l-3.2 7.6h-3.6Z"/><path d="M12.0 13.2 L12.59 14.69 L14.19 14.79 L12.95 15.81 L13.35 17.36 L12.0 16.5 L10.65 17.36 L11.05 15.81 L9.81 14.79 L11.41 14.69Z" fill="currentColor" stroke="none"/>',
    wechsel: '<circle cx="7.5" cy="7" r="2.4"/><circle cx="16.5" cy="7" r="2.4"/><path d="M3.5 14c1-2 2.4-3 4-3 1.4 0 2.4.6 3.5 2M13 13c1.1-1.4 2.3-2 3.5-2 1.6 0 3 1 4 3M5 18h14l-3-3M19 18l-3 3"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 21v-1.8c0-3 2.9-5 6.5-5s6.5 2 6.5 5V21Z"/>',
    vollAn: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    vollAus: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'
  };

  /* Team-Abzeichen: dieselbe Tabelle wie TEAM_ABZEICHEN in js/app.js
     (Kreis in den Vereinsfarben mit Kuerzel); unser Team traegt das
     Blink-Logo. Wer fehlt, bekommt eins aus Name und Farbton. */
  var ABZEICHEN = {
    'Treff ma nix': ['#1f3b73', '#f2c230', 'TMN'],
    'TSV Oberpframmern': ['#1e6b3a', '#ffffff', 'OBP'],
    'FT Gern Darts II': ['#7a1f2b', '#ffffff', 'FTG'],
    'TSV Dachau 1865 4': ['#0d4f8b', '#ffffff', 'TSV'],
    'Dart Artists Germering II': ['#2b2b2b', '#e8c06a', 'DA'],
    'Voodoo Darters': ['#4a2368', '#c9f24a', 'VD'],
    'd`Haberer 2': ['#7d4a1e', '#f5e6c8', 'HAB']
  };
  function abzeichen(name) {
    var a = ABZEICHEN[name];
    if (a) return a;
    var w = String(name).replace(/[`'’]/g, ' ').replace(/[^A-Za-zÄÖÜäöü0-9 ]/g, '').split(' ').filter(function (x) { return x && !/^\d+$/.test(x); });
    var kz = w.length === 1 ? w[0].slice(0, 3).toUpperCase() : w.slice(0, 3).map(function (x) { return x[0]; }).join('').toUpperCase();
    var h = 0;
    for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360;
    return ['hsl(' + h + ',45%,30%)', '#ffffff', kz || '?'];
  }
  function logo(team, klasse) {
    if (team === TEAM) return '<span class="logo blink ' + klasse + '" role="img" aria-label="Logo ' + esc(team) + '"></span>';
    var a = abzeichen(team);
    var fs = a[2].length > 2 ? 30 : 36;
    return '<svg class="logo ' + klasse + '" viewBox="0 0 120 120" role="img" aria-label="Logo ' + esc(team) + '"><circle cx="60" cy="60" r="58" fill="' + a[0] + '"/>' +
      '<circle cx="60" cy="60" r="50" fill="none" stroke="' + a[1] + '" stroke-width="3"/>' +
      '<text x="60" y="' + (fs > 30 ? 73 : 71) + '" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="' + fs + '" fill="' + a[1] + '">' + esc(a[2]) + '</text></svg>';
  }
  function kuerzel(team) { return team === TEAM ? TEAM : (ABZEICHEN[team] ? ABZEICHEN[team][2] : team); }

  /* ---------- Rechnen ---------- */
  /* Ein Dart auf ein Doppel ist moeglich, wenn der Rest in einem Dart
     ausgecheckt werden kann - so misst die App die Doppelquote. */
  function einDartFinish(rest) { return (rest <= 40 && rest % 2 === 0 && rest > 0) || rest === 50; }
  function rest(start, leg, pid) {
    var r = start;
    (leg ? leg.visits || [] : []).forEach(function (v) { if (v.p === pid && !v.b) r -= zahl(v.s); });
    return r;
  }
  function amWurf(p, m, leg) {
    var starter = (leg && leg.starter) || m.starter || p[0];
    var andere = p[0] === starter ? p[1] : p[0];
    return ((leg && leg.visits) || []).length % 2 === 0 ? starter : andere;
  }
  function dartText(d) {
    var n = zahl(d.n), m = zahl(d.m);
    if (!n || !m) return '0';
    if (n === 25) return m === 2 ? 'Bull' : '25';
    return (m === 3 ? 'T' : m === 2 ? 'D' : '') + n;
  }

  /* Statistik je Spieler aus allen Einzeln des Abends. Kampflose Einzel
     zaehlen wie in der App fuer niemanden (kein Wurf, kein Sieg). */
  function statistik(partien, startT) {
    var st = {};
    function s(id) {
      if (!st[id]) st[id] = { siege: 0, nieder: 0, legsG: 0, legsV: 0, darts: 0, punkte: 0, s180: 0, hoch: 0, finish: 0,
        bestLeg: null, finishes: [], shortlegs: [], dv: 0, dt: 0, avg: 0 };
      return st[id];
    }
    partien.forEach(function (x) {
      var m = x.m;
      x.p.forEach(function (pid) { if (pid) s(pid); });
      if (!m || m.kampflos) return;
      if (x.fertig && x.sieger) x.p.forEach(function (pid) { if (pid === x.sieger) s(pid).siege++; else s(pid).nieder++; });
      var start = zahl(m.start) || startT;
      var mitDoppel = start === 301 || start === 501;
      (m.legs || []).forEach(function (leg) {
        var darts = {}, r = {};
        x.p.forEach(function (pid) { r[pid] = start; });
        (leg.visits || []).forEach(function (v) {
          var a = s(v.p), vd = zahl(v.d), vs = zahl(v.s);
          var vor = r[v.p] === undefined ? start : r[v.p];
          a.darts += vd;
          darts[v.p] = (darts[v.p] || 0) + vd;
          /* Doppelquote wie in der App: mit Einzeldarts (k) jeder Dart auf
             einem moeglichen Doppel, sonst nur das bekannte Finish-Doppel. */
          if (mitDoppel && v.k && v.k.length) {
            var rr = vor;
            v.k.forEach(function (d) { if (einDartFinish(rr)) a.dv++; rr -= zahl(d.m) * zahl(d.n); });
            if (v.c) a.dt++;
          } else if (mitDoppel && v.c && v.dd) {
            a.dv += einDartFinish(vor) ? (vd || 1) : 1;
            a.dt++;
          }
          if (v.b) return;
          r[v.p] = vor - vs;
          a.punkte += vs;
          if (vs > a.hoch) a.hoch = vs;
          if (vs === 180) a.s180++;
          if (v.c) {
            if (vs > a.finish) a.finish = vs;
            if (vs >= 100) a.finishes.push(vs);
          }
        });
        if (leg.winner) {
          x.p.forEach(function (pid) { if (pid === leg.winner) s(pid).legsG++; else s(pid).legsV++; });
          var d = darts[leg.winner];
          if (d) {
            var w = s(leg.winner);
            if (w.bestLeg === null || d < w.bestLeg) w.bestLeg = d;
            if (d <= 21 && start === 501) w.shortlegs.push(d);
          }
        }
      });
    });
    Object.keys(st).forEach(function (id) { var a = st[id]; a.avg = a.darts ? (a.punkte / a.darts) * 3 : 0; });
    return st;
  }

  /* Alles, was die drei Ansichten brauchen, einmal aus dem Server-Stand. */
  function aufbereiten(t) {
    var lg = t.liga || {};
    var namen = t.namen || {};
    var d = {
      lg: lg, istLiga: !!t.liga, ohneNamen: !!(t.ohneNamen || lg.ohneNamen), nurErg: !!lg.nurErgebnis,
      start: zahl(t.start) || 501, bestOf: zahl(t.bestOf) || 3, vorbei: t.status !== 'offen',
      heimTeam: t.liga ? (lg.heim ? TEAM : (lg.gegner || 'Heim')) : 'Heim',
      gastTeam: t.liga ? (lg.heim ? (lg.gegner || 'Gast') : TEAM) : 'Gast'
    };
    d.zumSieg = Math.floor(d.bestOf / 2) + 1;
    d.nm = function (id) { return namen[id] || 'Spieler'; };
    d.kurz = function (id) { return d.ohneNamen ? d.nm(id) : d.nm(id).split(' ')[0]; };
    var liveMap = {};
    (t.live || []).forEach(function (l) { if (l && l.stand) liveMap[l.matchId] = l.stand; });
    d.partien = (t.matches || []).map(function (pm, i) {
      var e = (t.ergebnisse && t.ergebnisse[pm.id]) || null;
      var entfaellt = !!(e && e.void);
      if (entfaellt) e = null;
      var l = e ? null : (liveMap[pm.id] || null);
      var p = (e && e.p && e.p.length === 2 && e.p) || (l && l.p && l.p.length === 2 && l.p) || pm.p || [];
      var m = e || l;
      var x = { nr: i + 1, plan: pm, p: p, ergebnis: e, live: l, m: m, entfaellt: entfaellt,
        scheibe: pm.scheibe ? String(pm.scheibe).replace(/^S/, '') : '' };
      x.fertig = !!(e && e.done);
      x.kampflos = !!(e && e.kampflos);
      x.sieger = x.fertig ? e.winner : null;
      var legs = function (pid) {
        if (!m) return 0;
        if (m.kampflos) return m.winner === pid ? d.zumSieg : 0;
        return (m.legs || []).filter(function (lg2) { return lg2.winner === pid; }).length;
      };
      x.legsA = legs(p[0]); x.legsB = legs(p[1]);
      x.pos = function (i2) { return pm.posPaar ? (i2 ? 'G' : 'H') + (zahl(pm.posPaar[i2]) + 1) : ''; };
      return x;
    });
    d.hp = 0; d.gp = 0; d.hl = 0; d.gl = 0; d.fertig = 0;
    d.partien.forEach(function (x) {
      if (x.m) { d.hl += x.legsA; d.gl += x.legsB; }
      if (x.fertig) {
        d.fertig++;
        if (x.sieger === x.p[0]) d.hp++; else if (x.sieger === x.p[1]) d.gp++;
      }
    });
    /* Laufende Einzel nach Scheibe (S1 vor S2), wie im Entwurf. */
    d.laufen = d.partien.filter(function (x) { return x.live; }).sort(function (a, b) {
      return (a.scheibe || '9').localeCompare(b.scheibe || '9') || (a.nr - b.nr);
    });
    d.st = statistik(d.partien, d.start);

    /* Spieler je Team in Bogen-Reihenfolge (H1, H2 ... wie im Spielplan). */
    d.heimIds = []; d.gastIds = [];
    d.partien.forEach(function (x) {
      if (x.p[0] && d.heimIds.indexOf(x.p[0]) < 0) d.heimIds.push(x.p[0]);
      if (x.p[1] && d.gastIds.indexOf(x.p[1]) < 0) d.gastIds.push(x.p[1]);
    });
    var bogenListe = function (l) { return (Array.isArray(l) ? l : []).map(function (v) { return String(v && typeof v === 'object' ? v.id : v); }); };
    var hB = bogenListe(lg.heimSpieler), gB = bogenListe(lg.gastSpieler);
    var nachBogen = function (ids, liste) {
      return ids.slice().sort(function (a, b) {
        var ia = liste.indexOf(a), ib = liste.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    };
    d.heimIds = nachBogen(d.heimIds, hB); d.gastIds = nachBogen(d.gastIds, gB);

    /* Wechsel: wo auf derselben Position ein anderer Spieler steht als im
       Einzel davor. Die Kennung ist der Platz auf dem Bogen (G5 = erster
       Wechselspieler der Gaeste). */
    d.wechsel = [];
    [0, 1].forEach(function (seite) {
      var liste = seite ? gB : hB, zuletzt = {};
      var kenn = function (id, pos) { var i = liste.indexOf(String(id)); return (seite ? 'G' : 'H') + (i >= 0 ? i + 1 : pos + 1); };
      d.partien.forEach(function (x) {
        if (!x.plan.posPaar || !x.p[seite]) return;
        var pos = zahl(x.plan.posPaar[seite]), id = x.p[seite];
        if (zuletzt[pos] !== undefined && zuletzt[pos] !== id) {
          d.wechsel.push({ seite: seite, rein: id, raus: zuletzt[pos], pos: kenn(zuletzt[pos], pos) + ' → ' + kenn(id, pos) });
        }
        zuletzt[pos] = id;
      });
    });

    /* Als Naechstes: je Scheibe die naechsten zwei offenen Einzel. */
    var jeScheibe = {};
    d.naechste = d.vorbei ? [] : d.partien.filter(function (x) {
      if (x.ergebnis || x.live || x.entfaellt) return false;
      var b = x.scheibe || '';
      jeScheibe[b] = (jeScheibe[b] || 0) + 1;
      return jeScheibe[b] <= (b ? 2 : 4);
    });
    /* Ergebnisse: die zuletzt fertigen zuerst. */
    d.historie = d.partien.filter(function (x) { return x.fertig; }).sort(function (a, b) {
      return (zahl(b.ergebnis.at) - zahl(a.ergebnis.at)) || (b.nr - a.nr);
    });
    return d;
  }

  /* Highlights: 180er, High Finishes ab 100, Shortlegs bis 21 Darts und
     die hoechste Aufnahme ab 140, wenn es keine 180 war. */
  function highlights(d) {
    var z = [];
    var teamVon = function (id) { return d.heimIds.indexOf(id) >= 0 ? d.heimTeam : d.gastTeam; };
    d.heimIds.concat(d.gastIds).forEach(function (id) {
      var a = d.st[id];
      if (!a) return;
      if (a.s180) z.push({ id: id, art: '180er', wert: a.s180 + '×', rang: 0, w: a.s180 });
      a.finishes.forEach(function (f) { z.push({ id: id, art: 'High Finish', wert: String(f), rang: 1, w: f }); });
      a.shortlegs.forEach(function (n) { z.push({ id: id, art: 'Shortleg', wert: n + ' Darts', kurz: n + ' D', rang: 2, w: -n }); });
      if (!a.s180 && a.hoch >= 140) z.push({ id: id, art: 'Höchste Aufnahme', wert: String(a.hoch), rang: 3, w: a.hoch });
    });
    z.sort(function (a, b) { return (a.rang - b.rang) || (b.w - a.w); });
    z.forEach(function (h) { h.name = d.nm(h.id); h.team = kuerzel(teamVon(h.id)); });
    return z;
  }
  /* Rekorde des Abends: je Wert der Beste; was es noch nicht gibt, fehlt. */
  function rekorde(d, mitQuote) {
    var ids = d.heimIds.concat(d.gastIds), z = [];
    var bester = function (wert, gut) {
      var b = null, bw = null;
      ids.forEach(function (id) {
        var a = d.st[id];
        if (!a) return;
        var w = wert(a);
        if (w === null || w === undefined) return;
        if (b === null || gut(w, bw)) { b = id; bw = w; }
      });
      return b === null ? null : { id: b, w: bw };
    };
    var hoeher = function (a, b) { return a > b; };
    var r = bester(function (a) { return a.darts >= 9 ? a.avg : null; }, hoeher);
    if (r) z.push({ id: r.id, art: 'Bester Average', wert: komma(r.w, 1) });
    r = bester(function (a) { return a.hoch || null; }, hoeher);
    if (r) z.push({ id: r.id, art: 'Höchste Aufnahme', wert: String(r.w) });
    r = bester(function (a) { return a.bestLeg; }, function (a, b) { return a < b; });
    if (r) z.push({ id: r.id, art: 'Bestes Leg', wert: r.w + ' D' });
    r = bester(function (a) { return a.finish || null; }, hoeher);
    if (r) z.push({ id: r.id, art: 'Höchstes Finish', wert: String(r.w) });
    if (mitQuote) {
      r = bester(function (a) { return a.dv >= 3 ? a.dt / a.dv : null; }, hoeher);
      if (r) z.push({ id: r.id, art: 'Beste Doppelquote', wert: Math.round(r.w * 100) + ' %' });
    }
    z.forEach(function (h) { h.name = d.nm(h.id); });
    return z;
  }
  /* Man of the Day: meiste Siege, bei Gleichstand der hoehere Average. */
  function manOfTheDay(d, ids) {
    var b = null;
    ids.forEach(function (id) {
      var a = d.st[id];
      if (!a || !(a.siege + a.nieder)) return;
      if (!b || a.siege > d.st[b].siege || (a.siege === d.st[b].siege && a.avg > d.st[b].avg)) b = id;
    });
    return b;
  }

  /* Ein laufendes Einzel fuer die Scheiben-Karte. */
  function liveEinzel(d, x) {
    var m = x.live, legs = m.legs || [];
    var letztes = legs.length ? legs[legs.length - 1] : null;
    var leg = letztes && !letztes.winner ? letztes : null;
    var start = zahl(m.start) || d.start;
    /* Zwischen zwei Legs (das neue ist noch nicht angelegt): das naechste
       wirft der an, der das letzte nicht angeworfen hat. */
    var dran = leg || !letztes || !letztes.starter ? amWurf(x.p, m, leg)
      : (letztes.starter === x.p[0] ? x.p[1] : x.p[0]);
    var wuerfe = m.darts || [];
    var offen = wuerfe.reduce(function (a, w) { return a + zahl(w.v); }, 0);
    var entscheidung = x.legsA === d.zumSieg - 1 && x.legsB === d.zumSieg - 1;
    var spieler = x.p.map(function (pid, i) {
      var zul = null;
      (leg ? leg.visits || [] : []).forEach(function (v) { if (v.p === pid) zul = v; });
      var a = d.st[pid];
      var sub = [];
      if (a && a.darts) sub.push('Ø ' + komma(a.avg, 1));
      if (zul) sub.push('zuletzt ' + (zul.b ? 'Bust' : zahl(zul.s)));
      return { id: pid, pos: x.pos(i), name: d.nm(pid), legs: i ? x.legsB : x.legsA,
        rest: rest(start, leg, pid) - (pid === dran ? offen : 0), dran: pid === dran, sub: sub.join(' · ') };
    });
    var verlauf = (leg ? (leg.visits || []).slice(-4) : []).map(function (v) { return d.kurz(v.p) + ' ' + (v.b ? 'Bust' : zahl(v.s)); });
    if (wuerfe.length) verlauf.push(d.kurz(dran) + ' wirft: ' + wuerfe.map(dartText).join(' '));
    return { x: x, scheibe: x.scheibe, spieler: spieler, verlauf: verlauf.join(' · '),
      info: 'Einzel ' + x.nr + ' · Leg ' + (legs.filter(function (l) { return l.winner; }).length + 1) + (entscheidung ? ' · Entscheidung' : '') };
  }

  /* ---------- Bausteine ---------- */
  function liveSchild(d, klasse) {
    return '<span class="live-schild' + (d.vorbei ? ' aus' : '') + (klasse ? ' ' + klasse : '') + '"><span class="punkt"></span>' + (d.vorbei ? 'ENDSTAND' : 'LIVE') + '</span>';
  }
  function kopfZeile(d, mitDatum) {
    var lg = d.lg, teile = [];
    if (d.istLiga) teile.push(LIGA_NAME);
    if (lg.nr) teile.push(lg.nr + '. Spieltag');
    if (mitDatum && lg.tag) teile.push(datum(lg.tag, true));
    if (lg.ort) teile.push(lg.ort);
    if (d.nurErg) teile.push('nur Ergebnisse');
    return teile.length ? teile.join(' · ') : 'Live-Ticker';
  }
  function titel(text, ic, klasse) {
    return '<h2 class="titel' + (klasse ? ' ' + klasse : '') + '">' + (ic ? icon(IC[ic], 17) : '') + '<span>' + text + '</span></h2>';
  }
  function aktuell() { return '<span class="aktuell"></span>'; }
  function zurueckKnopf() {
    return ausApp ? '<a class="knopf zurueck" href="index.html">' + icon(IC.zurueck, 18) + 'Zurück</a>' : '<span></span>';
  }
  /* Team-Zeile mit Logos und Punktestand (Web, Fernseher, Erg). */
  function teamZeile(d, klasse) {
    var logos = d.istLiga;
    return '<div class="teams ' + klasse + '">' +
      '<span class="team heim"><span class="tnamen"><span class="tn">' + esc(d.heimTeam) + '</span><span class="tr">Heim</span></span>' + (logos ? logo(d.heimTeam, 'tlogo') : '') + '</span>' +
      '<span class="stand-mitte"><span class="zahlen" data-stand><span>' + d.hp + '</span><span class="dp">:</span><span>' + d.gp + '</span></span>' +
        (klasse.indexOf('tv') === 0 ? '<span class="unter">' + d.fertig + ' von ' + d.partien.length + ' Einzel · Legs ' + d.hl + ' : ' + d.gl + '</span>' : '') + '</span>' +
      '<span class="team gast">' + (logos ? logo(d.gastTeam, 'tlogo') : '') + '<span class="tnamen"><span class="tn">' + esc(d.gastTeam) + '</span><span class="tr">Gast</span></span></span>' +
      '</div>';
  }
  /* Scheiben-Karte eines laufenden Einzels (alle Ansichten ausser Vollbild). */
  function scheibenKarte(d, le, mitVerlauf) {
    var kopf = '<div class="b-kopf"><span class="b-titel"><span class="b-scheibe">' + (le.scheibe ? 'Scheibe ' + esc(le.scheibe) : 'Einzel') + '</span>' +
      '<span class="b-info">' + esc(le.info) + '</span></span><span class="b-lab">Legs</span><span class="b-lab">Rest</span></div>';
    var zeilen = le.spieler.map(function (s) {
      return '<div class="b-zeile' + (s.dran ? ' dran' : '') + '"><span class="b-wer"><span class="b-namezeile"><span class="b-punkt"></span>' +
        (d.ohneNamen || !s.pos ? '' : '<span class="b-pos">' + esc(s.pos) + '</span>') + '<span class="b-name">' + esc(s.name) + '</span></span>' +
        (s.sub ? '<span class="b-sub">' + esc(s.sub) + '</span>' : '') + '</span>' +
        '<span class="b-legs">' + s.legs + '</span><span class="b-rest">' + s.rest + '</span></div>';
    }).join('');
    return '<section class="karte live scheibe" data-einzel="' + le.x.nr + '">' + kopf + zeilen +
      (mitVerlauf && le.verlauf ? '<div class="b-verlauf">' + esc(le.verlauf) + '</div>' : '') + '</section>';
  }
  /* Ohne laufendes Einzel: freundlich statt leer. */
  function leerText(d) {
    return d.vorbei ? 'Das Ligaspiel ist beendet.' : 'Gerade läuft kein Einzel – gleich geht es weiter.';
  }
  function nameMitPos(d, x, i, klasse) {
    var n = '<span class="n' + (x.sieger === x.p[i] ? ' w' : '') + '">' + esc(d.nm(x.p[i])) + '</span>';
    var pos = d.ohneNamen || !x.pos(i) ? '' : '<span class="pos">' + esc(x.pos(i)) + '</span>';
    return '<span class="' + klasse + '">' + (i ? pos + n : n + pos) + '</span>';
  }
  function ergText(x, offen) {
    if (x.fertig || x.live) return x.legsA + ' : ' + x.legsB;
    return offen;
  }
  /* Zeile in "Alle Einzel" / "Als Naechstes" (Web). */
  function webZeile(d, x) {
    var chip, chipKl = '';
    if (x.fertig) chip = x.kampflos ? 'W.O.' : 'FERTIG';
    else if (x.live) { chip = 'LIVE' + (x.scheibe ? ' · S' + esc(x.scheibe) : ''); chipKl = ' live'; }
    else if (x.entfaellt) chip = 'ENTFÄLLT';
    else chip = x.scheibe ? 'S' + esc(x.scheibe) : '';
    return '<div class="w-ez"><span class="nr">' + x.nr + '</span>' + nameMitPos(d, x, 0, 'h') +
      '<span class="erg' + (x.fertig || x.live ? '' : ' leise') + '">' + ergText(x, '–') + '</span>' + nameMitPos(d, x, 1, 'g') +
      '<span class="chip' + chipKl + '">' + chip + '</span></div>';
  }
  /* Kurze Zeile fuer Ergebnisse / Als Naechstes (Handy und Fernseher). */
  function kurzZeile(d, x, mitScheibe) {
    var n = function (i) { return '<span class="n' + (i ? ' r' : '') + (x.sieger === x.p[i] ? ' w' : '') + '">' + esc(d.nm(x.p[i])) + '</span>'; };
    return '<div class="k-ez"><span class="nr">' + x.nr + '</span>' + n(0) +
      '<span class="erg' + (x.fertig ? '' : ' leise') + '">' + (x.fertig ? x.legsA + ' : ' + x.legsB : 'vs') + '</span>' + n(1) +
      (mitScheibe ? '<span class="s">' + (x.scheibe ? 'S' + esc(x.scheibe) : '') + '</span>' : '') + '</div>';
  }
  function hlZeile(h, klasse) {
    return '<div class="hl-zeile ' + (klasse || '') + '"><span class="hl-wer"><span class="hl-name">' + esc(h.name) + '</span>' +
      '<span class="hl-art">' + esc(h.art) + (h.team ? ' · ' + esc(h.team) : '') + '</span></span><span class="hl-wert">' + esc(h.wert) + '</span></div>';
  }
  function wechselZeile(d, w) {
    var team = w.seite ? d.gastTeam : d.heimTeam;
    return '<div class="wx-zeile">' + (d.istLiga ? logo(team, 'wlogo') : '<span></span>') +
      '<span class="wx-text"><span class="rein" aria-label="rein">▲</span>' + esc(d.nm(w.rein)) + '<span class="fuer">für</span>' +
      '<span class="raus" aria-label="raus">▼</span><span class="alt">' + esc(d.nm(w.raus)) + '</span></span>' +
      '<span class="wx-pos">' + esc(w.pos) + '</span></div>';
  }
  /* Durchgaenge mit Leg-Staenden (Variante "nur Ergebnisse"). */
  function durchgaenge(d, klasse) {
    var runden = [];
    d.partien.forEach(function (x) {
      var r = x.plan.round || 1;
      if (!runden.length || runden[runden.length - 1].nr !== r) runden.push({ nr: r, einzel: [] });
      runden[runden.length - 1].einzel.push(x);
    });
    return runden.map(function (r) {
      return '<div class="karte ' + klasse + '"><span class="e-titel">Durchgang ' + r.nr + '</span>' + r.einzel.map(function (x) {
        var n = function (i) { return '<span class="n' + (i ? ' r' : '') + (x.sieger === x.p[i] ? ' w' : '') + '">' + esc(d.nm(x.p[i])) + '</span>'; };
        return '<div class="e-ez" data-einzel="' + x.nr + '">' + n(0) + '<span class="erg' + (x.fertig || x.live ? '' : ' leise') + '">' +
          (x.live ? '<span class="laeuft" title="läuft"></span>' : '') + (x.fertig || x.live ? x.legsA + ' : ' + x.legsB : '– : –') + '</span>' + n(1) + '</div>';
      }).join('') + '</div>';
    }).join('');
  }
  function leerZeile(text) { return '<p class="leer">' + text + '</p>'; }

  /* ---------- Web (LsLiveWeb) ---------- */
  function zeichneWeb(d) {
    var h = '<div class="lt lt-web"><header class="w-kopf">' +
      '<span class="w-marke"><span class="logo blink w-logo" role="img" aria-label="Logo Blink 180"></span><span class="w-titel">Live-Ticker</span></span>' +
      '<span class="w-zeile">' + esc(kopfZeile(d, true)) + '</span>' +
      '<span class="w-rechts">' + aktuell() + liveSchild(d) + '</span></header><main class="w-main">';
    var pillen = d.partien.map(function (x) {
      var k = x.fertig ? (x.sieger === x.p[0] ? ' heim' : ' gast') : x.live ? ' live' : '';
      return '<span class="pille' + k + '" title="Einzel ' + x.nr + '"></span>';
    }).join('');
    h += '<section class="w-stand stand">' + teamZeile(d, 'web') +
      (pillen ? '<div class="pillen">' + pillen + '</div>' : '') +
      '<span class="unter">' + d.fertig + ' von ' + d.partien.length + ' Einzel gespielt · Legs ' + d.hl + ' : ' + d.gl + ' · je gewonnenes Einzel 1 Punkt</span></section>';

    if (d.nurErg) {
      h += '<div class="e-runden">' + durchgaenge(d, 'e-runde') + '</div>' + ergUnten(d) + '</main></div>';
      return h;
    }

    h += '<div class="w-live">' + titel(d.laufen.length ? 'Gerade live · ' + d.laufen.length + ' Einzel' : (d.vorbei ? 'Beendet' : 'Gerade live'), null) +
      (d.laufen.length
        ? '<div class="w-scheiben">' + d.laufen.map(function (x) { return scheibenKarte(d, liveEinzel(d, x), true); }).join('') + '</div>'
        : '<section class="karte leise w-leer">' + leerZeile(leerText(d)) + '</section>') + '</div>';

    /* Links alle Einzel, rechts Als Naechstes, Man of the Day, Highlights. */
    var runde = null, liste = '';
    d.partien.forEach(function (x) {
      if (x.plan.round !== runde) { runde = x.plan.round; liste += '<span class="durchgang">Durchgang ' + esc(runde) + '</span>'; }
      liste += webZeile(d, x);
    });
    h += '<div class="w-raster"><section class="karte leise w-liste alle">' + titel('Alle Einzel', 'kalender') + liste + '</section><div class="w-seite">';
    if (d.naechste.length) {
      h += '<section class="karte leise w-liste naechste">' + titel('Als Nächstes', 'pfeil') + d.naechste.map(function (x) { return webZeile(d, x); }).join('') + '</section>';
    }
    var motd = [[d.heimIds, d.heimTeam], [d.gastIds, d.gastTeam]].map(function (z) {
      var b = manOfTheDay(d, z[0]), a = b && d.st[b];
      return '<div class="motd-k"><span class="motd-t">' + esc(z[1]) + '</span>' +
        (b ? '<span class="motd-n">' + esc(d.nm(b)) + '</span><span class="motd-i">' + a.siege + (a.siege === 1 ? ' Sieg' : ' Siege') +
          (a.darts ? ' · Ø ' + komma(a.avg, 1) : '') + '</span>' : '<span class="motd-i">noch offen</span>') + '</div>';
    }).join('');
    h += '<section class="karte leise w-motd">' + titel('Man of the Day' + (d.vorbei ? '' : ' (bisher)'), 'medaille', 'gold') + '<div class="motd">' + motd + '</div></section>';
    var hl = highlights(d).slice(0, 6);
    h += '<section class="karte leise w-hl">' + titel('Highlights', 'stern', 'gold') +
      (hl.length ? hl.map(function (x) { return hlZeile(x, 'web'); }).join('') : leerZeile('Noch keine. 180er, High Finishes und Shortlegs landen hier.')) + '</section>';
    h += '</div></div>';

    /* Statistik des Abends */
    var zeile = function (id) {
      var a = d.st[id] || { siege: 0, nieder: 0, legsG: 0, legsV: 0, darts: 0, avg: 0, s180: 0, finish: 0, bestLeg: null };
      return '<div class="s-zeile"><span class="s-name">' + esc(d.nm(id)) + '</span><span>' + a.siege + ' : ' + a.nieder + '</span>' +
        '<span class="leise">' + a.legsG + ' : ' + a.legsV + '</span><span>' + (a.darts ? komma(a.avg, 1) : '–') + '</span>' +
        '<span class="' + (a.s180 ? 'gold' : 'leise') + '">' + a.s180 + '</span><span class="' + (a.finish >= 100 ? 'gold' : '') + '">' + (a.finish || '–') + '</span>' +
        '<span class="leise">' + (a.bestLeg || '–') + '</span></div>';
    };
    var team = function (name, ids) {
      return '<div class="s-team">' + (d.istLiga ? logo(name, 'slogo') : '') + '<span>' + esc(name) + '</span></div>' + ids.map(zeile).join('');
    };
    h += '<section class="karte leise w-statistik">' + titel('Statistik des Abends', 'statistik') +
      '<div class="s-kopf"><span>Spieler</span><span>Einzel</span><span>Legs</span><span>Ø</span><span>180</span><span>Finish</span><span>Bestes Leg</span></div>' +
      team(d.heimTeam, d.heimIds) + team(d.gastTeam, d.gastIds) + '</section>';
    h += '</main></div>';
    return h;
  }
  /* Unten in "nur Ergebnisse": Highlights und Wechsel nebeneinander. */
  function ergUnten(d) {
    var hl = highlights(d).slice(0, 6);
    return '<section class="karte leise e-unten"><div class="e-spalte">' + titel('Highlights', 'stern', 'gold') +
      (hl.length ? hl.map(function (x) { return hlZeile({ name: x.name, art: x.art, wert: x.wert }, 'erg'); }).join('') : leerZeile('Noch keine.')) + '</div>' +
      '<div class="e-spalte">' + titel('Wechsel', 'wechsel') +
      (d.wechsel.length ? d.wechsel.map(function (w) { return wechselZeile(d, w); }).join('') : leerZeile('Bisher keine.')) + '</div></section>';
  }

  /* ---------- Handy (LsLiveHandy) ---------- */
  function zeichneHandy(d) {
    var lg = d.lg;
    var z1 = [d.istLiga ? LIGA_NAME : 'Live-Ticker'].concat(lg.nr ? [lg.nr + '. Spieltag'] : []).join(' · ');
    var z2 = [lg.ort || ''].concat(d.nurErg ? ['nur Ergebnisse'] : []).filter(Boolean).join(' · ');
    var h = '<div class="lt lt-handy"><header class="h-kopf"><span class="h-zeilen"><span class="h-z1">' + esc(z1) + '</span>' +
      (z2 ? '<span class="h-z2">' + esc(z2) + '</span>' : '') + '</span>' + liveSchild(d) + '</header><main class="h-main">';
    h += '<section class="h-stand stand"><div class="h-teams">' +
      '<span class="h-team">' + (d.istLiga ? logo(d.heimTeam, 'tlogo') : '') + '<span class="tn">' + esc(d.heimTeam) + '</span></span>' +
      '<span class="zahlen" data-stand>' + d.hp + '<span class="dp">:</span>' + d.gp + '</span>' +
      '<span class="h-team">' + (d.istLiga ? logo(d.gastTeam, 'tlogo') : '') + '<span class="tn">' + esc(d.gastTeam) + '</span></span></div>' +
      '<span class="unter">' + d.fertig + ' von ' + d.partien.length + ' Einzel · Legs ' + d.hl + ' : ' + d.gl + '</span></section>';
    var block = function (t, ic, inhalt, klasse) {
      return '<div class="h-block' + (klasse ? ' ' + klasse : '') + '"><h2 class="h-titel">' + icon(IC[ic], 16) + '<span>' + t + '</span></h2>' + inhalt + '</div>';
    };
    if (d.nurErg) {
      var hl = highlights(d).slice(0, 6);
      h += block('Highlights', 'stern', '<div class="karte leise h-karte">' + (hl.length
        ? hl.map(function (x) { return hlZeile({ name: x.name, art: x.art, wert: x.kurz || x.wert }, 'handy'); }).join('')
        : leerZeile('Noch keine.')) + '</div>');
      if (d.wechsel.length) h += block('Wechsel', 'wechsel', '<div class="karte leise h-karte">' + d.wechsel.map(function (w) { return wechselZeile(d, w); }).join('') + '</div>');
      h += block('Alle Einzel', 'person', '<div class="h-runden">' + durchgaenge(d, 'h-runde') + '</div>');
    } else {
      h += d.laufen.length ? d.laufen.map(function (x) { return scheibenKarte(d, liveEinzel(d, x), false); }).join('')
        : '<section class="karte leise h-leer">' + leerZeile(leerText(d)) + '</section>';
      var hist = d.historie.slice(0, 5);
      h += block('Ergebnisse', 'ergebnisse', '<div class="karte leise h-liste">' +
        (hist.length ? hist.map(function (x) { return kurzZeile(d, x, false); }).join('') : leerZeile('Noch kein Einzel fertig.')) + '</div>', 'historie');
      if (d.naechste.length) {
        h += block('Als Nächstes', 'pfeil', '<div class="karte leise h-liste">' + d.naechste.map(function (x) { return kurzZeile(d, x, false); }).join('') + '</div>', 'naechste');
      }
      var rek = rekorde(d, false);
      if (rek.length) h += block('Rekorde des Abends', 'rekord', '<div class="karte leise h-karte">' + rek.map(function (x) { return hlZeile(x, 'handy'); }).join('') + '</div>');
    }
    h += '</main><p class="h-aktuell">' + aktuell() + '</p></div>';
    return h;
  }

  /* ---------- Fernseher (LsLive format tv, LsLiveErg format tv) ---------- */
  /* Zwei feste Plaetze, je Scheibe einer: das laufende Einzel oder, wenn
     die Scheibe frei ist, was dort als Naechstes kommt. */
  function tvPlaetze(d) {
    var plaetze = [];
    var scheiben = [];
    d.partien.forEach(function (x) { if (x.scheibe && scheiben.indexOf(x.scheibe) < 0) scheiben.push(x.scheibe); });
    scheiben.sort();
    scheiben.slice(0, 2).forEach(function (s) {
      var x = d.laufen.filter(function (y) { return y.scheibe === s; })[0];
      plaetze.push({ scheibe: s, x: x || null });
    });
    d.laufen.forEach(function (x) {
      if (plaetze.some(function (p) { return p.x === x; })) return;
      var frei = plaetze.filter(function (p) { return !p.x; })[0];
      if (frei && !x.scheibe) frei.x = x; else if (plaetze.length < 2) plaetze.push({ scheibe: x.scheibe, x: x });
    });
    while (plaetze.length < 2) plaetze.push({ scheibe: '', x: null });
    return plaetze;
  }
  function freieScheibe(d, p, gross) {
    var n = d.naechste.filter(function (x) { return x.scheibe === p.scheibe; })[0];
    var text = d.vorbei ? 'Das Ligaspiel ist beendet.' : n
      ? 'Als Nächstes: Einzel ' + n.nr + ' · ' + d.nm(n.p[0]) + ' – ' + d.nm(n.p[1])
      : 'Gerade frei';
    return '<section class="karte leise scheibe frei' + (gross ? ' v-scheibe' : '') + '"><div class="b-kopf"><span class="b-titel"><span class="b-scheibe">' +
      (p.scheibe ? 'Scheibe ' + esc(p.scheibe) : 'Scheibe') + '</span></span></div><p class="frei-text">' + esc(text) + '</p></section>';
  }
  function vollScheibe(d, le) {
    var seite = function (s, rechts) {
      var sub = (d.ohneNamen ? [] : [s.pos]).concat(s.sub ? [s.sub] : []).filter(Boolean).join(' · ');
      return '<span class="v-wer' + (rechts ? ' r' : '') + (s.dran ? ' dran' : '') + '"><span class="v-namezeile"><span class="b-punkt"></span><span class="v-name">' + esc(s.name) + '</span></span>' +
        (sub ? '<span class="v-sub">' + esc(sub) + '</span>' : '') + '</span>';
    };
    var a = le.spieler[0], b = le.spieler[1];
    return '<section class="karte live scheibe v-scheibe" data-einzel="' + le.x.nr + '"><span class="v-kopf"><span class="b-scheibe">' + (le.scheibe ? 'Scheibe ' + esc(le.scheibe) : 'Einzel') + '</span>' +
      '<span class="b-info">' + esc(le.info) + '</span></span><div class="v-reihe">' + seite(a, false) +
      '<span class="v-rest' + (a.dran ? ' dran' : '') + '">' + a.rest + '</span><span class="v-legs"><span class="v-legzahl">' + a.legs + ' : ' + b.legs + '</span><span class="b-lab">Legs</span></span>' +
      '<span class="v-rest' + (b.dran ? ' dran' : '') + '">' + b.rest + '</span>' + seite(b, true) + '</div></section>';
  }
  function zeichneTv(d) {
    var plaetze = tvPlaetze(d);
    var vollKnopf = function (an) {
      return '<button type="button" class="knopf quadrat" data-aktion="voll" aria-label="' + (an ? 'Vollbild verlassen' : 'Vollbild: nur Stand und die beiden laufenden Einzel') + '" title="' +
        (an ? 'Vollbild verlassen' : 'Vollbild') + '">' + icon(an ? IC.vollAus : IC.vollAn, 20, '', 2.2) + '</button>';
    };
    if (voll && !d.nurErg) {
      return '<div class="lt lt-tv tv-rahmen voll"><div class="v-oben"><span class="t-zeile">' + esc(kopfZeile(d, false)) + aktuell() + '</span>' +
        '<span class="t-rechts">' + liveSchild(d) + vollKnopf(true) + '</span></div>' +
        teamZeile(d, 'tv voll') + '<div class="v-scheiben">' + plaetze.map(function (p) {
          return p.x ? vollScheibe(d, liveEinzel(d, p.x)) : freieScheibe(d, p, true);
        }).join('') + '</div></div>';
    }
    var h = '<div class="lt lt-tv tv-rahmen' + (d.nurErg ? ' erg' : '') + '"><header class="t-kopf">' + zurueckKnopf() +
      '<span class="t-zeile">' + esc(kopfZeile(d, false)) + aktuell() + '</span>' +
      '<span class="t-rechts">' + liveSchild(d) + (d.nurErg ? '' : vollKnopf(false)) + '</span></header><main class="t-main">' + teamZeile(d, 'tv');
    if (d.nurErg) {
      h += '<div class="e-runden">' + durchgaenge(d, 'e-runde') + '</div>' + ergUnten(d) + '</main></div>';
      return h;
    }
    h += '<div class="t-scheiben">' + plaetze.map(function (p) {
      return p.x ? scheibenKarte(d, liveEinzel(d, p.x), false) : freieScheibe(d, p, false);
    }).join('') + '</div>';
    var hist = d.historie.slice(0, 5), rek = rekorde(d, true);
    h += '<section class="karte leise t-unten">' +
      '<div class="t-spalte">' + titel('Ergebnisse', 'ergebnisse') + (hist.length ? hist.map(function (x) { return kurzZeile(d, x, true); }).join('') : leerZeile('Noch kein Einzel fertig.')) + '</div>' +
      '<div class="t-spalte mitte">' + titel('Als Nächstes', 'pfeil') + (d.naechste.length ? d.naechste.map(function (x) { return kurzZeile(d, x, true); }).join('') : leerZeile(d.vorbei ? 'Alle Einzel gespielt.' : 'Nichts mehr offen.')) + '</div>' +
      '<div class="t-spalte">' + titel('Rekorde des Abends', 'rekord', 'gold') + (rek.length ? rek.map(function (x) { return hlZeile(x, 'tv'); }).join('') : leerZeile('Noch keine.')) + '</div>' +
      '</section></main></div>';
    return h;
  }

  /* ---------- Layout und Zeichnen ---------- */
  function welchesLayout() {
    var b = window.innerWidth || document.documentElement.clientWidth, hoehe = window.innerHeight || document.documentElement.clientHeight;
    if (tvWunsch === true) return 'tv';
    if (tvWunsch !== false && b >= 1600 && hoehe > 0 && b / hoehe >= 1.6) return 'tv';
    return b < 700 ? 'handy' : 'web';
  }
  /* Der Fernseher zeigt einen festen Rahmen (Entwurf: 1477 x 830, am
     1920er-Fernseher 1,3-fach), skaliert auf das ganze Fenster. */
  var ZOOM_GEHT = 'zoom' in document.documentElement.style;
  function tvMasse() {
    var r = box.querySelector('.tv-rahmen');
    if (!r) return;
    var b = window.innerWidth, hoehe = window.innerHeight;
    var z = ZOOM_GEHT ? Math.min(b / 1477, hoehe / 830) : 1;
    if (!(z > 0)) z = 1;
    r.style.zoom = ZOOM_GEHT ? String(z) : '';
    r.style.width = (b / z) + 'px';
    r.style.height = (hoehe / z) + 'px';
  }
  function zeichne() {
    if (!daten) return;
    var d = aufbereiten(daten);
    layout = welchesLayout();
    document.body.setAttribute('data-layout', layout);
    box.innerHTML = layout === 'tv' ? zeichneTv(d) : layout === 'handy' ? zeichneHandy(d) : zeichneWeb(d);
    if (layout === 'tv') tvMasse();
    /* Fuer Bildschirmleser nur der Stand, nicht die ganze Seite alle 4 s. */
    var sr = document.getElementById('sr-stand');
    var neu = d.heimTeam + ' ' + d.hp + ' zu ' + d.gp + ' ' + d.gastTeam + (d.vorbei ? ', Endstand' : '');
    if (sr && neu !== srText) { srText = neu; sr.textContent = neu; }
    fussAktualisieren();
  }

  function fussAktualisieren() {
    var s = letzteZeit ? Math.round((Date.now() - letzteZeit) / 1000) : 0;
    var problem = fehlerZahl ? 'Verbindung wird gesucht …' : gedrosselt ? 'Viele Zuschauer – etwas langsamer' : '';
    var text = problem || ('aktualisiert vor ' + s + ' s');
    Array.prototype.forEach.call(box.querySelectorAll('.aktuell'), function (el) {
      el.textContent = layout === 'tv' ? (problem ? ' · ' + problem : '') : text;
      el.classList.toggle('problem', !!problem);
    });
  }

  function taktStellen(neu) {
    if (neu === takt && timer) return;
    takt = neu;
    if (timer) clearInterval(timer);
    timer = setInterval(holen, takt);
  }

  function holen() {
    if (document.hidden) return;
    fetch('/api/zuschauer/' + encodeURIComponent(schluessel), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) { stoppen('Diesen Live-Ticker gibt es nicht (mehr). Bitte den Link prüfen.'); return null; }
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      fehlerZahl = 0;
      letzteZeit = Date.now();
      if (gedrosselt) { gedrosselt = false; taktStellen(TAKT); }
      var text = JSON.stringify(d.turnier);
      if (text !== letzter) { letzter = text; daten = d.turnier || {}; zeichne(); }
      else fussAktualisieren();
    }).catch(function (e) {
      if (e && e.status === 429) {
        /* Der Server ist da, nur ueberlaufen: kein Verbindungsfehler, also
           nicht "Verbindung wird gesucht", sondern langsamer fragen. */
        gedrosselt = true;
        taktStellen(Math.min(takt * 2, TAKT_MAX));
        if (!letzter) box.innerHTML = '<p class="fehler-seite">Viele Zuschauer gerade – der Stand kommt gleich …</p>';
        else fussAktualisieren();
        return;
      }
      fehlerZahl++;
      if (!letzter) box.innerHTML = '<p class="fehler-seite">Keine Verbindung – es wird weiter versucht …</p>';
      else fussAktualisieren();
    });
  }
  function stoppen(text) {
    if (timer) clearInterval(timer);
    timer = null;
    daten = null;
    box.innerHTML = '<p class="fehler-seite">' + esc(text) + '</p>';
  }

  /* Aus der App geoeffnet (?app=1): oben geht es zurueck. Auf dem iPhone hat
     die installierte App keinen Zurueck-Knopf. (Am Fernseher steht der
     Knopf im Kopf, siehe zurueckKnopf.) */
  if (ausApp) {
    var zurueck = document.createElement('a');
    zurueck.className = 'zur-app'; zurueck.href = 'index.html';
    zurueck.innerHTML = icon(IC.zurueck, 18) + 'Zur App';
    document.body.insertBefore(zurueck, document.body.firstChild);
    document.body.classList.add('aus-app');
  }
  document.body.setAttribute('data-layout', welchesLayout());

  /* Vollbild am Fernseher: nur Stand und die beiden Scheiben. */
  box.addEventListener('click', function (e) {
    var k = e.target.closest ? e.target.closest('[data-aktion="voll"]') : null;
    if (!k) return;
    voll = !voll;
    zeichne();
    var neu = box.querySelector('[data-aktion="voll"]');
    if (neu) neu.focus();
  });
  var groesseTimer = null;
  window.addEventListener('resize', function () {
    if (groesseTimer) return;
    groesseTimer = setTimeout(function () {
      groesseTimer = null;
      if (welchesLayout() !== layout) zeichne();
      else if (layout === 'tv') tvMasse();
    }, 120);
  });

  /* Anderer Link im selben Tab (nur der #-Teil aendert sich): neu laden. */
  window.addEventListener('hashchange', function () { location.reload(); });

  if (!/^[A-Za-z0-9_-]{8,40}$/.test(schluessel)) {
    stoppen('Für den Live-Ticker fehlt der Link-Schlüssel. Bitte den ganzen Link aus der App öffnen.');
    return;
  }
  holen();
  taktStellen(TAKT);
  setInterval(fussAktualisieren, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) holen(); });
})();
