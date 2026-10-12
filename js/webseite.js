/*
 * Oeffentliche Webseite von Blink 180 (webseite.html, liegt unter /).
 *
 * Ohne Konto: naechster Spieltag mit Countdown, Ligatermine, Ergebnisse
 * und Tabelle aus js/liga-daten.js bzw. vom Server (/api/oeffentlich/liga).
 * Laeuft gerade ein geteiltes Ligaspiel, zeigt die Seite stattdessen den
 * Live-Stand (/api/zuschauer/<schluessel>, wie der Live-Ticker).
 * Mitglieder melden sich oben rechts an und landen in der App (index.html);
 * registrieren geht nur mit Anmeldecode oder Einladungs-Link.
 */
(function () {
  'use strict';
  var DATEN = window.LIGA_DATEN;
  var LIGA = DATEN.liga, SPIELTAGE = DATEN.spieltage, TEAM = LIGA.team;
  var LIGA_NAME = '5. Liga';
  var TAKT_LIVE = 6000, TAKT_RUHE = 60000;
  var WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function p2(v) { return String(v).padStart(2, '0'); }
  function heuteISO() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function datumTeile(tag) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag || '');
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return { kurz: m[3] + '.' + m[2] + '.', wd: WOCHENTAGE[d.getDay()], jahr: m[1] };
  }
  function anpfiff(tag) { return new Date(tag + 'T20:00:00').getTime(); }

  /* ---------- Daten ---------- */
  /* Unser Spiel eines Spieltags aus den Ergebnissen der Ligaleitung. */
  function unserSpiel(t) {
    var liste = SPIELTAGE[t.id] || [];
    for (var i = 0; i < liste.length; i++) {
      var g = liste[i];
      if (g.gast && (g.heim === TEAM || g.gast === TEAM)) return g;
    }
    return null;
  }
  function naechsterTermin() {
    var heute = heuteISO();
    var kommende = LIGA.termine.filter(function (t) { return t.tag && t.tag >= heute && !unserSpiel(t); });
    kommende.sort(function (a, b) { return a.tag < b.tag ? -1 : 1; });
    return kommende[0] || null;
  }
  function daheim(t) { return t.heim === TEAM; }
  function gegner(t) { return daheim(t) ? t.gast : t.heim; }
  function paarung(t) { return esc(t.heim) + ' <span class="vs">vs</span> ' + esc(t.gast); }

  /* ---------- Naechster Spieltag ---------- */
  var cdTimer = null;
  function heldZeichnen(live) {
    var box = $('naechster');
    if (live) { box.classList.add('hidden'); if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } return; }
    box.classList.remove('hidden');
    var t = naechsterTermin();
    if (!t) {
      box.innerHTML = '<div class="held-text"><span class="held-label">' + esc(LIGA_NAME) + '</span>' +
        '<span class="held-datum">Saison vorbei</span><span class="held-leer">Der nächste Spielplan kommt, sobald der Verband ihn verschickt.</span></div>';
      return;
    }
    var d = datumTeile(t.tag);
    box.innerHTML =
      '<div class="held-text">' +
        '<span class="held-label">Nächster Spieltag · ' + esc(LIGA_NAME) + '</span>' +
        '<span class="held-datum">' + esc(d.wd + ' ' + d.kurz) + '</span>' +
        '<span class="held-paar">' + (daheim(t)
          ? '<b>' + esc(TEAM) + '</b> gegen ' + esc(t.gast)
          : esc(t.heim) + ' gegen <b>' + esc(TEAM) + '</b>') + ' · 20:00 Uhr</span>' +
        '<span class="held-ort"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>' + esc(t.ort) + (daheim(t) ? ' · Heimspiel' : ' · Auswärts') + '</span>' +
        '<div class="held-knoepfe">' +
          '<a class="knopf gross" href="https://maps.apple.com/?q=' + encodeURIComponent(t.ort) + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"></path><path d="M9 4v14M15 6v14"></path></svg>Route zum ' + esc(ortKurz(t.ort)) + '</a>' +
          '<button type="button" class="knopf gross" data-action="kalender" data-id="' + esc(t.id) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"></path></svg>In den Kalender</button>' +
        '</div>' +
      '</div>' +
      '<div class="zuschauen" id="zuschauen">' +
        '<span class="kt" id="cd-label">Nächster Spieltag in</span>' +
        '<div class="cd" id="cd">' + ['Tage', 'Std', 'Min', 'Sek'].map(function (k) {
          return '<div class="cd-feld"><span class="cd-zahl">–</span><span class="cd-k">' + k + '</span></div>';
        }).join('') + '</div>' +
        '<p class="cd-sub">' + esc(d.wd + ' ' + d.kurz) + ' · 20:00 · ' + esc(t.heim) + ' gegen ' + esc(t.gast) + '</p>' +
        '<button type="button" class="livescoring" data-action="livescoring"><span class="live-marke"><span class="punkt"></span>Live</span>Livescoring</button>' +
      '</div>';
    var ziel = anpfiff(t.tag);
    var tick = function () {
      var ms = Math.max(0, ziel - Date.now());
      var dd = Math.floor(ms / 864e5); ms -= dd * 864e5;
      var hh = Math.floor(ms / 36e5); ms -= hh * 36e5;
      var mm = Math.floor(ms / 6e4); ms -= mm * 6e4;
      var ss = Math.floor(ms / 1e3);
      var zahlen = $('cd') ? $('cd').querySelectorAll('.cd-zahl') : [];
      if (zahlen.length !== 4) return;
      zahlen[0].textContent = String(dd); zahlen[1].textContent = p2(hh); zahlen[2].textContent = p2(mm); zahlen[3].textContent = p2(ss);
      if (ziel <= Date.now() && $('cd-label')) $('cd-label').textContent = 'Spieltag heute · Anwurf 20:00';
    };
    tick();
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(tick, 1000);
  }
  /* "Route zum Cobblers": der erste eigenstaendige Teil des Lokalnamens. */
  function ortKurz(ort) {
    var t = String(ort || '').split(' ');
    return t.length > 2 ? t[0] : ort;
  }

  /* ---------- Termine ---------- */
  function termineZeichnen(live) {
    var naechster = naechsterTermin();
    var heute = heuteISO();
    $('termine-liste').innerHTML = LIGA.termine.map(function (t) {
      var spiel = unserSpiel(t);
      var vorbei = !!spiel || (t.tag && t.tag < heute);
      var istNaechster = naechster && naechster.id === t.id;
      var d = datumTeile(t.tag);
      var rechts = spiel ? esc(spiel.einzel).replace(':', ' : ') : istNaechster ? (live ? '● Live' : 'nächster') : vorbei ? '' : '';
      var klasse = 'termin' + (vorbei && !istNaechster ? ' vorbei' : '') + (istNaechster ? ' naechster' : '') + (istNaechster && live ? ' live' : '');
      if (!t.tag) {
        return '<div class="' + klasse + '"><span class="wann"><span class="datum">–</span><span class="wd">' + t.nr + '. Spieltag</span></span>' +
          '<span class="was"><span class="paar">Spielfrei</span><span class="ort">Kein Spiel für ' + esc(TEAM) + '</span></span><span class="rechts"></span></div>';
      }
      return '<div class="' + klasse + '" data-termin="' + esc(t.id) + '">' +
        '<span class="wann"><span class="datum">' + esc(d.kurz) + '</span><span class="wd">' + esc(d.wd) + ' · ' + t.nr + '. Spieltag</span></span>' +
        '<span class="was"><span class="paar">' + paarung(t) + '</span>' +
          '<span class="ort">' + esc(t.ort) + (daheim(t) ? ' · Heim' : ' · Auswärts') + ' · 20:00</span></span>' +
        '<span class="rechts">' + rechts + '</span></div>';
    }).join('');
  }

  /* ---------- Ergebnisse (alle Spiele der Liga) ---------- */
  var ergebnisseAlle = false;
  function ergebnisseZeichnen() {
    var liste = [];
    LIGA.termine.forEach(function (t) {
      (SPIELTAGE[t.id] || []).forEach(function (g) {
        if (!g.gast || !g.einzel) return;
        liste.push({ nr: t.nr, tag: g.tag || t.tag, g: g });
      });
    });
    liste.sort(function (a, b) {
      if (a.tag !== b.tag) return a.tag < b.tag ? 1 : -1;
      var au = a.g.heim === TEAM || a.g.gast === TEAM, bu = b.g.heim === TEAM || b.g.gast === TEAM;
      return au === bu ? 0 : au ? -1 : 1;
    });
    var box = $('ergebnisse-liste');
    if (!liste.length) { box.innerHTML = '<p class="notiz">Noch keine Ergebnisse, die Saison geht gerade los.</p>'; return; }
    var zeigen = ergebnisseAlle ? liste : liste.slice(0, 4);
    box.innerHTML = zeigen.map(function (x) {
      var e = String(x.g.einzel).split(':');
      var hs = Number(e[0]), gs = Number(e[1]);
      var d = datumTeile(x.tag);
      return '<div class="ergebnis"><span class="meta">' + x.nr + '. Spieltag · ' + (d ? esc(d.wd + ' ' + d.kurz) : '') + (x.g.ort ? ' · ' + esc(x.g.ort) : '') + '</span>' +
        '<div class="paar"><span class="' + (hs > gs ? 'w' : '') + '">' + esc(x.g.heim) + '</span>' +
        '<span class="stand">' + hs + ' : ' + gs + '</span>' +
        '<span class="' + (gs > hs ? 'w' : '') + '">' + esc(x.g.gast) + '</span></div></div>';
    }).join('') + (liste.length > 4
      ? '<button type="button" class="link mehr" data-action="ergebnisse-mehr">' + (ergebnisseAlle ? 'Weniger anzeigen' : 'Alle ' + liste.length + ' Spiele anzeigen') + '</button>'
      : '');
  }

  /* ---------- Tabelle ---------- */
  /* Aus den Ergebnissen aller Spieltage gerechnet (js/liga-daten.js), wie in der App. */
  function tabelleZeichnen() {
    var tab = DATEN.tabelleAus(DATEN.spieltage, DATEN.teams);
    var zeilen = tab.zeilen;
    $('tabelle-zeilen').innerHTML = zeilen.map(function (z, i) {
      var wir = z.team === TEAM;
      return '<div class="tz' + (wir ? ' wir' : '') + '"><span class="rang">' + (i + 1) + '</span>' +
        '<span class="team">' + esc(z.team) + '</span>' +
        '<span class="mitte">' + esc(z.spiele == null ? '' : z.spiele) + '</span>' +
        '<span class="pkt">' + esc(z.punkte == null ? '' : z.punkte) + '</span>' +
        '<span class="rechts">' + esc(String(z.legs || '0:0')).replace(':', ' : ') + '</span></div>';
    }).join('');
    var d = tab.bis ? datumTeile(tab.bis) : null;
    $('tabelle-stand').textContent = (d ? 'Stand ' + d.kurz + d.jahr + ' · ' : '') + 'aus ' + tab.spiele + ' Spielen berechnet';
  }

  /* ---------- Live-Stand ---------- */
  function legsGewonnen(m, pid) {
    return (m.legs || []).filter(function (l) { return l.winner === pid; }).length;
  }
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
      if (!st[id]) st[id] = { darts: 0, punkte: 0, s180: 0, finishes: [], shortlegs: [], avg: 0 };
      return st[id];
    }
    matches.forEach(function (m) {
      (m.legs || []).forEach(function (leg) {
        var darts = {};
        (leg.visits || []).forEach(function (v) {
          var x = s(v.p);
          x.darts += v.d || 0;
          darts[v.p] = (darts[v.p] || 0) + (v.d || 0);
          if (v.b) return;
          x.punkte += v.s;
          if (v.s === 180) x.s180++;
          if (v.c && v.s >= 100) x.finishes.push(v.s);
        });
        if (leg.winner && darts[leg.winner] && darts[leg.winner] <= 21 && start === 501) s(leg.winner).shortlegs.push(darts[leg.winner]);
      });
    });
    Object.keys(st).forEach(function (id) { var x = st[id]; x.avg = x.darts ? (x.punkte / x.darts) * 3 : 0; });
    return st;
  }
  function liveZeichnen(t) {
    var box = $('live');
    var lg = t.liga || {};
    var namen = t.namen || {};
    var nm = function (id) { return namen[id] || 'Spieler'; };
    var heimTeam = lg.heim ? TEAM : (lg.gegner || 'Heim');
    var gastTeam = lg.heim ? (lg.gegner || 'Gast') : TEAM;
    var liveMap = {};
    (t.live || []).forEach(function (l) { liveMap[l.matchId] = l.stand; });
    var partien = (t.matches || []).map(function (pm) {
      var e = t.ergebnisse && t.ergebnisse[pm.id];
      var l = liveMap[pm.id];
      return { plan: pm, p: (e && e.p) || (l && l.p) || pm.p, ergebnis: e || null, live: e ? null : (l || null) };
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
    var vorbei = t.status !== 'offen';
    var laufen = partien.filter(function (x) { return x.live; });
    var alle = partien.map(function (x) { var m = x.ergebnis || x.live; return m ? { p: x.p, legs: m.legs || [] } : null; }).filter(Boolean);
    var st = statistik(alle, t.start || 501);
    var start = t.start || 501;

    var html = '<div class="live-kopf">' +
      '<span class="live-marke' + (vorbei ? ' aus' : '') + '"><span class="punkt"></span>' + (vorbei ? 'Endstand' : 'Live') + '</span>' +
      '<span class="live-wo">' + esc(LIGA_NAME + (lg.nr ? ' · ' + lg.nr + '. Spieltag' : '') + (lg.ort ? ' · ' + lg.ort : '')) + '</span>' +
      '<span class="live-luft"></span>' +
      '<span class="live-zahl">' + fertig + ' von ' + partien.length + ' Einzeln gespielt</span></div>' +
      '<div class="live-stand"><span class="team a' + (lg.heim ? ' wir' : '') + '">' + esc(heimTeam) + '</span>' +
      '<span class="punkte">' + hp + ' : ' + gp + '</span>' +
      '<span class="team b' + (lg.heim ? '' : ' wir') + '">' + esc(gastTeam) + '</span></div>' +
      '<p class="live-sub">Punkte · Legs ' + hl + ':' + gl + (laufen.length ? ' · ' + laufen.length + (laufen.length === 1 ? ' Einzel läuft' : ' Einzel laufen') : '') + '</p>';

    html += '<div class="live-raster">';
    if (!laufen.length) {
      html += '<p class="live-leer">' + (vorbei ? 'Das Ligaspiel ist beendet.' : 'Gerade läuft kein Einzel, gleich geht es weiter.') + '</p>';
    }
    laufen.forEach(function (x) {
      var m = x.live, pm = x.plan;
      var legs = m.legs || [];
      var leg = legs.length && !legs[legs.length - 1].winner ? legs[legs.length - 1] : null;
      var dran = amWurf({ p: x.p, starter: m.starter }, leg || { starter: null, visits: [] });
      var offen = (m.darts || []).reduce(function (a, d) { return a + (d.v || 0); }, 0);
      html += '<div class="board"><div class="board-kopf"><span>' + (pm.scheibe ? 'Board ' + esc(String(pm.scheibe).replace('S', '')) : 'Board') + '</span>' +
        '<span>Legs ' + legsGewonnen(m, x.p[0]) + ' : ' + legsGewonnen(m, x.p[1]) + '</span></div>';
      x.p.forEach(function (pid, i) {
        var r = rest(m.start || start, leg, pid) - (pid === dran ? offen : 0);
        var pos = pm.posPaar ? (i === 0 ? 'H' : 'G') + (Number(pm.posPaar[i]) + 1) : '';
        var a = st[pid] && st[pid].avg;
        html += '<div class="bs' + (pid === dran ? ' dran' : '') + '"><span class="dot"></span>' +
          '<span class="name"><span class="pos">' + pos + '</span> ' + esc(nm(pid)) + '</span>' +
          '<span class="avg">Ø ' + (a ? a.toFixed(1) : '–') + '</span><span class="rest">' + r + '</span></div>';
      });
      html += '</div>';
    });
    html += '</div>';

    var heute = partien.filter(function (x) { return x.ergebnis && x.ergebnis.done; }).map(function (x) {
      var m = x.ergebnis, pm = x.plan;
      var a = legsGewonnen(m, x.p[0]), b = legsGewonnen(m, x.p[1]);
      var posH = pm.posPaar ? 'H' + (Number(pm.posPaar[0]) + 1) + ' ' : '', posG = pm.posPaar ? 'G' + (Number(pm.posPaar[1]) + 1) + ' ' : '';
      return '<div class="he"><span class="' + (m.winner === x.p[0] ? 'w' : '') + '">' + esc(posH + nm(x.p[0])) + '</span>' +
        '<span class="erg">' + a + ':' + b + '</span>' +
        '<span class="' + (m.winner === x.p[1] ? 'w' : '') + '">' + esc(posG + nm(x.p[1])) + '</span></div>';
    });
    var h180 = [], hfin = [], hleg = [];
    Object.keys(st).forEach(function (id) {
      var x = st[id];
      if (x.s180) h180.push(esc(nm(id)) + (x.s180 > 1 ? ' ×' + x.s180 : ''));
      x.finishes.forEach(function (f) { hfin.push(f + ' ' + esc(nm(id))); });
      x.shortlegs.forEach(function (d) { hleg.push(d + ' Darts ' + esc(nm(id))); });
    });
    var hl2 = [];
    if (h180.length) hl2.push(['180er', h180.join(' · ')]);
    if (hfin.length) hl2.push(['High-Finishes', hfin.join(' · ')]);
    if (hleg.length) hl2.push(['Shortlegs', hleg.join(' · ')]);
    html += '<div class="live-raster">' +
      '<div class="lk"><span class="kt">Ergebnisse heute</span>' + (heute.length ? heute.join('') : '<p class="live-leer">Noch kein Einzel fertig.</p>') + '</div>' +
      '<div class="lk"><span class="kt">Highlights</span>' + (hl2.length
        ? hl2.map(function (z) { return '<div class="hl"><span class="k">' + z[0] + '</span><span class="v">' + z[1] + '</span></div>'; }).join('')
        : '<p class="live-leer">Noch keine. 180er, High-Finishes und Shortlegs landen hier.</p>') + '</div></div>';
    box.innerHTML = html;
    box.classList.toggle('vorbei', vorbei);
    box.classList.remove('hidden');
  }

  /* ---------- Server ---------- */
  var liveSchluessel = null, liveTimer = null, letzterStand = null, liveTakt = TAKT_LIVE;
  function holeJson(pfad, opt) {
    return fetch(pfad, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opt || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.fehler || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }
  function ruf(methode, pfad, body) {
    var opt = { method: methode, headers: { 'X-Darts-App': '1' } };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return holeJson(pfad, opt);
  }
  function ligaHolen() {
    if (document.hidden) return;
    holeJson('/api/oeffentlich/liga').then(function (d) {
      tabelleZeichnen();
      var neu = d.live ? d.live.zuschauer : null;
      if (neu !== liveSchluessel) {
        liveSchluessel = neu; letzterStand = null;
        if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
        if (neu) { liveTakt = TAKT_LIVE; liveTimer = setInterval(liveStandHolen, liveTakt); liveStandHolen(); }
        else { $('live').classList.add('hidden'); heldZeichnen(false); termineZeichnen(false); }
      }
    }).catch(function () { /* ohne Server bleibt der feste Stand stehen */ });
  }
  function liveStandHolen() {
    if (document.hidden || !liveSchluessel) return;
    holeJson('/api/zuschauer/' + encodeURIComponent(liveSchluessel)).then(function (d) {
      if (!d || !d.turnier) return;
      var text = JSON.stringify(d.turnier);
      if (text === letzterStand) return;
      letzterStand = text;
      liveZeichnen(d.turnier);
      heldZeichnen(true);
      termineZeichnen(d.turnier.status === 'offen');
    }).catch(function (e) {
      if (e && e.status === 404) { liveSchluessel = null; if (liveTimer) clearInterval(liveTimer); liveTimer = null; $('live').classList.add('hidden'); heldZeichnen(false); termineZeichnen(false); }
      /* Zu viele Anfragen aus demselben Netz (Kneipen-WLAN): langsamer fragen. */
      if (e && e.status === 429 && liveTakt < 60000) {
        liveTakt = Math.min(liveTakt * 2, 60000);
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = setInterval(liveStandHolen, liveTakt);
      }
    });
  }

  /* ---------- Kalender ---------- */
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
  /* 20:00 Ortszeit als UTC-Zeitstempel: so versteht es jeder Kalender ohne Zeitzonen-Block. */
  function icsZeit(tag, stunde) {
    var d = new Date(tag + 'T' + p2(stunde) + ':00:00');
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function kalender(id) {
    var t = null;
    LIGA.termine.forEach(function (x) { if (x.id === id) t = x; });
    if (!t || !t.tag) return;
    var tag = t.tag.replace(/-/g, '');
    var zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blink 180//Webseite//DE', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:blink180-' + t.id + '@darts.wirtschaftln.de', 'DTSTAMP:' + tag + 'T000000Z',
      'DTSTART:' + icsZeit(t.tag, 20), 'DTEND:' + icsZeit(t.tag, 23),
      'SUMMARY:' + icsText('Darts ' + t.nr + '. Spieltag: ' + t.heim + ' vs ' + t.gast), 'LOCATION:' + icsText(t.ort), 'END:VEVENT', 'END:VCALENDAR'];
    var blob = new Blob([zeilen.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'blink180-spieltag-' + t.nr + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function toast(text) {
    var alt = document.querySelector('.toast');
    if (alt) alt.remove();
    var el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  /* ---------- Anmelden / Registrieren ---------- */

  function loginOeffnen(tab) {
    $('login').classList.remove('hidden');
    loginTab(tab || 'login');
  }
  function loginZu() {
    $('login').classList.add('hidden');
    meldung('');
  }
  function loginTab(tab) {
    var reg = tab === 'register';
    $('form-login').classList.toggle('hidden', reg);
    $('form-register').classList.toggle('hidden', !reg);
    Array.prototype.forEach.call(document.querySelectorAll('.login-tabs button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    meldung('');
    var erstes = (reg ? $('form-register') : $('form-login')).querySelector('input:not([readonly])');
    if (erstes && window.matchMedia('(min-width: 700px)').matches) erstes.focus();
  }
  function meldung(text, ok) {
    var m = $('login-meldung');
    m.textContent = text || '';
    m.classList.toggle('hidden', !text);
    m.classList.toggle('ok', !!ok);
  }
  function zurApp() { location.href = 'index.html'; }
  function anmelden(form) {
    var knopf = form.querySelector('button[type="submit"]');
    knopf.disabled = true; meldung('Anmelden …', true);
    ruf('POST', '/api/login', { email: form.email.value.trim(), password: form.password.value })
      .then(function () { meldung('Angemeldet, die App öffnet sich …', true); zurApp(); })
      .catch(function (e) { meldung(e && e.status ? e.message : 'Keine Verbindung zum Server.'); knopf.disabled = false; });
  }
  function registrieren(form) {
    var knopf = form.querySelector('button[type="submit"]');
    var vor = form.vor.value.trim(), nach = form.nach.value.trim();
    if (!vor || !nach) { meldung('Bitte Vor- und Nachnamen eintragen.'); return; }
    knopf.disabled = true; meldung('Konto wird angelegt …', true);
    ruf('POST', '/api/register', {
      invite: form.code.value.trim(), name: vor, email: form.email.value.trim(),
      password: form.password.value, hue: Math.floor(Math.random() * 360)
    }).then(function () {
      /* Der volle Name steht auf dem Spielberichtsbogen, die App fuehrt ihn im Profil. */
      return ruf('PATCH', '/api/me', { voll: (vor + ' ' + nach).replace(/\s+/g, ' ') }).catch(function () { /* nicht schlimm */ });
    }).then(function () { meldung('Willkommen bei Blink 180, die App öffnet sich …', true); zurApp(); })
      .catch(function (e) { meldung(e && e.status ? e.message : 'Keine Verbindung zum Server.'); knopf.disabled = false; });
  }
  /* ?einladung=TOKEN (QR-Code oder geteilter Link aus der App): gleich das
     Registrieren mit eingetragenem Code oeffnen. */
  function einladungLesen() {
    var m = /[?&]einladung=([A-Za-z0-9_.~%-]+)/.exec(location.search || '');
    if (!m) return;
    var token = decodeURIComponent(m[1]);
    try { history.replaceState(history.state, '', location.pathname + (location.hash || '')); } catch (e) { /* egal */ }
    if (!/^e_[A-Za-z0-9_-]{8,40}$/.test(token)) return;
    $('form-register').code.value = token;
    loginOeffnen('register');
    holeJson('/api/einladungen/' + encodeURIComponent(token)).then(function (d) {
      $('register-hinweis').textContent = d.gueltig
        ? 'Einladung von ' + (d.von || 'der Mannschaft') + (d.art === 'mitglied' ? ' als Vereinsmitglied' : ' als Gast (mitspielen und Statistik, keine Liga)') + '. Leg dir ein Konto an.'
        : 'Dieser Einladungs-Link ist abgelaufen oder schon benutzt. Bitte um einen neuen bitten.';
    }).catch(function () { /* Code bleibt eingetragen, der Server prueft ihn beim Registrieren */ });
  }
  function kontoPruefen() {
    holeJson('/api/me').then(function (d) {
      if (!d || !d.nutzer) return;
      var b = $('nav-anmelden');
      b.textContent = 'Zur App';
      b.setAttribute('data-action', 'zur-app');
    }).catch(function () { /* nicht angemeldet */ });
  }

  /* ---------- Ereignisse ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (ev.target.id === 'login') { loginZu(); return; }
    if (!el) return;
    switch (el.getAttribute('data-action')) {
      case 'login-oeffnen': loginOeffnen('login'); break;
      case 'zur-app': zurApp(); break;
      case 'login-zu': loginZu(); break;
      case 'login-tab': loginTab(el.getAttribute('data-tab')); break;
      case 'passwort-vergessen': meldung('Kein Problem: Sag dem Teamchef Bescheid, er setzt dir ein neues Passwort.', true); break;
      case 'kalender': kalender(el.getAttribute('data-id')); break;
      case 'livescoring':
        if (liveSchluessel) { var lv = $('live'); if (lv) lv.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else toast('Livescoring gibt es am Spieltag ab 20 Uhr hier, direkt vom Board.');
        break;
      case 'ergebnisse-mehr': ergebnisseAlle = !ergebnisseAlle; ergebnisseZeichnen(); break;
    }
  });
  $('form-login').addEventListener('submit', function (ev) { ev.preventDefault(); anmelden(ev.target); });
  $('form-register').addEventListener('submit', function (ev) { ev.preventDefault(); registrieren(ev.target); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('login').classList.contains('hidden')) loginZu();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { ligaHolen(); liveStandHolen(); } });

  /* ---------- Start ---------- */
  heldZeichnen(false);
  termineZeichnen(false);
  ergebnisseZeichnen();
  tabelleZeichnen();
  einladungLesen();
  kontoPruefen();
  ligaHolen();
  setInterval(ligaHolen, TAKT_RUHE);
})();
