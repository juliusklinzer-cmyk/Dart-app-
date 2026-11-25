/*
 * Autodarts-Anschluss (Test, Julius 22.11.2026): erkannte Darts kommen von
 * der Autodarts-Bruecke auf demselben Rechner (tools/autodarts-bruecke,
 * http://127.0.0.1:3190/ereignisse) und werden wie ein Tipp gebucht - jeder
 * Dart sofort, nicht erst die ganze Aufnahme.
 *
 * Nur freigeschaltet sichtbar: einmal die App mit ?autodarts=an oeffnen
 * (gilt fuer diesen Browser), ?autodarts=aus nimmt es wieder weg. Ohne
 * Freischaltung tut diese Datei nichts - fuer alle anderen bleibt die App
 * exakt wie sie ist.
 *
 * Buchen nur ueber window.__dart.spielDart (dieselben Pruefungen wie ein
 * Tipp). Ist gerade ein Dialog offen (Leg gewonnen, Checkout-Frage), warten
 * die Darts kurz in einer Schlange und werden gebucht, sobald er zu ist.
 * Werden die Darts gezogen, bevor drei erkannt waren, fuellt die App die
 * Aufnahme mit Fehlwuerfen auf. Jedes Ereignis traegt eine Laufnummer der
 * Bruecke; doppelt Ankommendes (Neuverbindung) wird verworfen.
 */
(function () {
  'use strict';

  var SCHLUESSEL = 'dart-autodarts-v1';
  var VORGABE = 'http://127.0.0.1:3190';
  var SCHLANGE_MAX_MS = 20000;   // aelter wartende Darts verfallen (gehoeren zu nichts mehr)

  var cfg = laden();
  try {
    var q = new URLSearchParams(location.search).get('autodarts');
    if (q === 'an') { cfg.frei = true; speichern(); }
    if (q === 'aus') { cfg.frei = false; cfg.an = false; speichern(); }
  } catch (e) { /* alter Browser */ }
  if (!cfg.frei) return;

  var D = null;
  var strom = null;
  var verbunden = false;     // EventSource offen
  var board = { verbunden: false, board: '', fehler: '' };
  var letzteSeq = 0;
  var brueckeVersion = '';
  var schlange = [];         // { typ: 'dart'|'ziehen', m, n, label, at }
  var verlauf = [];          // die letzten Darts fuer die Anzeige
  var neuTimer = null;
  var panelAuf = false;

  /* geprueft: an diesem Geraet kam schon einmal ein erkannter Dart an
     (Testwurf beim Einrichten) - erst dann laesst es sich einschalten. */
  function laden() {
    try {
      var z = JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}');
      return { frei: !!z.frei, an: !!z.an, geprueft: !!z.geprueft || !!z.an, adresse: typeof z.adresse === 'string' && z.adresse ? z.adresse : VORGABE };
    } catch (e) { return { frei: false, an: false, geprueft: false, adresse: VORGABE }; }
  }
  function speichern() {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(cfg)); } catch (e) { /* privat */ }
  }

  /* ================= Verbindung ================= */
  /* Verbunden wird, wenn Autodarts an ist oder gerade eingerichtet wird. */
  function verbinden() {
    trennen();
    if (!cfg.an && !panelAuf) { zeichnen(); return; }
    try {
      strom = new EventSource(cfg.adresse.replace(/\/+$/, '') + '/ereignisse');
    } catch (e) { board.fehler = 'Adresse ungültig'; zeichnen(); return; }
    strom.onopen = function () { verbunden = true; zeichnen(); };
    strom.onerror = function () {
      verbunden = false; zeichnen();
      /* EventSource versucht es selbst wieder; ist sie endgueltig zu, neu aufbauen. */
      if (strom && strom.readyState === 2 && !neuTimer) neuTimer = setTimeout(function () { neuTimer = null; verbinden(); }, 3000);
    };
    strom.addEventListener('hallo', function (e) {
      var d = json(e); if (!d) return;
      brueckeVersion = d.version || '';
      /* Die Bruecke wurde neu gestartet: ihre Laufnummern beginnen bei 0. */
      if (typeof d.seq === 'number' && d.seq < letzteSeq) letzteSeq = d.seq;
      board = { verbunden: !!d.verbunden, board: d.board || '', fehler: d.fehler || '' };
      zeichnen();
    });
    strom.addEventListener('status', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      board = { verbunden: !!d.verbunden, board: d.board || '', fehler: d.fehler || '' };
      zeichnen();
    });
    strom.addEventListener('dart', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      verlauf.push(d.label); if (verlauf.length > 6) verlauf.shift();
      /* Beim Einrichten (noch aus): nur der Testwurf, gebucht wird nichts. */
      if (!cfg.an) { if (!cfg.geprueft) { cfg.geprueft = true; speichern(); } zeichnen(); return; }
      schlange.push({ typ: 'dart', a: d.aufnahme, nr: d.nr, m: Number(d.m), n: Number(d.n), label: d.label, at: Date.now() });
      abarbeiten();
    });
    strom.addEventListener('ziehen', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      if (!cfg.an) { verlauf.push('|'); if (verlauf.length > 6) verlauf.shift(); zeichnen(); return; }
      schlange.push({ typ: 'ziehen', a: d.aufnahme, at: Date.now() });
      verlauf.push('|'); if (verlauf.length > 6) verlauf.shift();
      abarbeiten();
    });
    strom.addEventListener('entfernt', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      if (!cfg.an) return;
      schlange.push({ typ: 'entfernt', a: d.aufnahme, nr: d.nr, label: d.label, at: Date.now() });
      abarbeiten();
    });
    strom.addEventListener('korrektur', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      hinweis('Autodarts hat Dart ' + d.nr + ' auf ' + d.label + ' korrigiert – bitte prüfen.');
    });
    strom.addEventListener('unbekannt', function (e) {
      var d = json(e); if (!d || !neu(d)) return;
      hinweis('Dart ' + d.nr + ' nicht lesbar (' + d.label + ') – bitte von Hand eintragen.');
    });
    zeichnen();
  }
  function trennen() {
    if (strom) { try { strom.close(); } catch (e) { /* egal */ } }
    strom = null; verbunden = false;
    if (neuTimer) { clearTimeout(neuTimer); neuTimer = null; }
  }
  function json(e) { try { return JSON.parse(e.data); } catch (x) { return null; } }
  function neu(d) {
    if (typeof d.seq !== 'number') return true;
    if (d.seq <= letzteSeq) return false;
    letzteSeq = d.seq;
    return true;
  }

  /* ================= Buchen =================
     Jede Aufnahme der Bruecke (Nummer a) wird an genau eine Aufnahme der App
     gebunden: an die, die beim ersten Dart von a offen ist (ihr Schluessel).
     Ist diese App-Aufnahme vorbei (Bust, Finish, drei Darts, neues Leg),
     gehoeren weitere Darts von a zu nichts mehr - sie werden verworfen statt
     dem naechsten Spieler gebucht. Ziehen fuellt nur die gebundene Aufnahme
     auf. Ein offener Dialog/Menue sperrt; solange die Sperre steht, altern
     wartende Darts nicht (verfallen erst 20 s nach ihrem Ende, mit Hinweis). */
  var bindung = null;   // { a, schluessel }
  function gesperrt(ui) { return !!(ui.overlay || ui.menu); }
  function abarbeiten() {
    if (!D) return;
    var jetzt = Date.now();
    var ui = D.ui();
    if (gesperrt(ui)) { schlange.forEach(function (x) { x.at = jetzt; }); zeichnen(); return; }
    /* Auch ein verdecktes Fenster bucht (Autodarts Desktop liegt am selben
       PC oft darueber). Deshalb: nur EIN Fenster mit der App offen lassen. */
    while (schlange.length) {
      ui = D.ui();
      if (gesperrt(ui)) { schlange.forEach(function (x) { x.at = jetzt; }); break; }
      var x = schlange[0];
      if (jetzt - x.at > SCHLANGE_MAX_MS) { schlange.shift(); if (x.typ === 'dart') hinweis(x.label + ' kam zu spät und ist nicht gebucht.'); continue; }
      var gebunden = bindung && bindung.a === x.a;
      var schluessel = D.aufnahmeSchluessel();
      if (x.typ === 'ziehen') {
        schlange.shift();
        if (gebunden && bindung.schluessel === schluessel) D.aufnahmeAuffuellen();
        if (gebunden) bindung = null;
        continue;
      }
      if (x.typ === 'entfernt') {
        schlange.shift();
        if (gebunden && bindung.schluessel === schluessel && D.offeneAufnahme() === x.nr) {
          D.letztenDartZurueck();
          hinweis('Autodarts hat Dart ' + x.nr + ' zurückgenommen – in der App auch.');
        } else hinweis('Autodarts hat Dart ' + x.nr + ' zurückgenommen – bitte prüfen.');
        continue;
      }
      /* Dart */
      if (D.offeneAufnahme() < 0 || !schluessel) { schlange.shift(); hinweis('Kein Spiel am Wurf – ' + x.label + ' nicht gebucht.'); continue; }
      if (gebunden && bindung.schluessel !== schluessel) {
        schlange.shift();
        hinweis('Aufnahme ist schon vorbei – ' + x.label + ' nicht gebucht.');
        continue;
      }
      if (!gebunden) bindung = { a: x.a, schluessel: schluessel };
      /* Ein angefangener Punktewert im Feld wuerde sonst neben den Darts stehen. */
      ui.input = '';
      var ok = D.spielDart(x.m, x.n);
      if (!ok) {
        /* Schonfrist (Dialog gerade zu, Bildschirmwechsel): gleich nochmal. */
        if (jetzt - x.at < 1500) { setTimeout(abarbeiten, 120); break; }
        schlange.shift();
        hinweis(x.label + ' konnte nicht gebucht werden.');
        continue;
      }
      schlange.shift();
      /* Weiterer Dart derselben Aufnahme der Bruecke? Nur wenn die App-Aufnahme noch laeuft. */
      bindung.schluessel = D.aufnahmeSchluessel() === schluessel ? schluessel : bindung.schluessel + '#vorbei';
    }
    zeichnen();
  }
  setInterval(function () { if (schlange.length) abarbeiten(); }, 120);

  /* ================= Anzeige ================= */
  var chip = null, panel = null, hinweisBox = null, hinweisTimer = null;
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function aufbauen() {
    var stil = el('style');
    stil.textContent =
      '.ad-chip{position:fixed;left:0;right:0;margin:0 auto;width:max-content;top:4px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:6px 12px;opacity:.9;border-radius:999px;' +
      'background:rgba(20,16,17,.92);border:1px solid #3a3032;color:#e8e2e2;font:600 13px/1 var(--font-cond,system-ui);letter-spacing:.04em;cursor:pointer;min-height:30px;white-space:nowrap}' +
      '.ad-chip i{width:10px;height:10px;border-radius:50%;background:#666;flex:none}.ad-chip.gruen i{background:#3ccf7a}.ad-chip.gelb i{background:#e6b93a}.ad-chip.rot i{background:#e5484d}' +
      '.ad-chip .ad-v{opacity:.75;font-weight:500}' +
      '.ad-panel{position:fixed;left:0;right:0;margin:0 auto;top:42px;z-index:2147483001;width:min(360px,calc(100vw - 20px));padding:16px;border-radius:16px;background:#151112;border:1px solid #3a3032;color:#e8e2e2;font:15px/1.4 var(--font-body,system-ui);box-shadow:0 12px 40px rgba(0,0,0,.5)}' +
      '.ad-panel h3{margin:0 0 8px;font:700 18px var(--font-cond,system-ui);letter-spacing:.03em}.ad-panel p{margin:6px 0;color:#bdb4b4}.ad-panel label{display:block;margin:10px 0 4px;font-size:13px;color:#9a8f90}' +
      '.ad-panel input{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #3a3032;background:#0e0b0c;color:#fff;font:15px ui-monospace,monospace}' +
      '.ad-panel .ad-zeile{display:flex;gap:8px;margin-top:12px}.ad-panel button{flex:1;min-height:44px;border-radius:12px;border:1px solid #3a3032;background:#221b1d;color:#fff;font:700 15px var(--font-cond,system-ui);cursor:pointer}' +
      '.ad-panel button.an{background:#f2eeee;color:#111}.ad-panel button:disabled{opacity:.4;cursor:default}.ad-panel code{font-size:13px;color:#e8e2e2}' +
      '.ad-chip[hidden]{display:none}.ad-schritte{list-style:none;margin:12px 0;padding:0;display:flex;flex-direction:column;gap:8px}' +
      '.ad-schritte li{display:flex;gap:10px;align-items:flex-start}.ad-schritte i{flex:none;width:22px;height:22px;border-radius:50%;border:2px solid #3a3032;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:13px;color:#06140b}' +
      '.ad-schritte li.ok i{background:#3ccf7a;border-color:#3ccf7a}.ad-schritte b{display:block;font-weight:600;color:#e8e2e2}.ad-schritte small{display:block;color:#9a8f90;font-size:13px}' +
      '.ad-klein{font-size:13px}.ad-mehr{margin-top:12px}.ad-mehr summary{cursor:pointer;color:#9a8f90;font-size:13px;min-height:32px}' +
      '.ad-hinweis{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483002;max-width:min(520px,calc(100vw - 32px));padding:10px 14px;border-radius:12px;background:#2a1d1f;border:1px solid #e5484d;color:#fff;font:600 14px/1.35 var(--font-body,system-ui)}' +
      '.ad-hinweis[hidden]{display:none}';
    document.head.appendChild(stil);
    chip = el('button', 'ad-chip'); chip.type = 'button'; chip.setAttribute('aria-label', 'Autodarts');
    chip.addEventListener('click', function () { if (panelAuf) schliessen(); else oeffnen(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panelAuf) schliessen(); });
    panel = el('div', 'ad-panel'); panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Autodarts');
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ad]'); if (!b) return;
      var was = b.getAttribute('data-ad');
      if (was === 'an') {
        if (!cfg.an && !schritte().every(function (x) { return x.ok; })) return;
        cfg.an = !cfg.an; speichern(); verbinden();
        if (window.__dart) window.__dart.render();
      }
      if (was === 'speichern') { var i = panel.querySelector('input'); cfg.adresse = (i.value || VORGABE).trim(); speichern(); verbinden(); }
      if (was === 'zu') { schliessen(); return; }
      zeichnen();
    });
    hinweisBox = el('div', 'ad-hinweis'); hinweisBox.hidden = true; hinweisBox.setAttribute('role', 'status');
    document.body.appendChild(chip); document.body.appendChild(panel); document.body.appendChild(hinweisBox);
  }
  function hinweis(text) {
    if (!hinweisBox) return;
    hinweisBox.textContent = text; hinweisBox.hidden = false;
    if (hinweisTimer) clearTimeout(hinweisTimer);
    hinweisTimer = setTimeout(function () { hinweisBox.hidden = true; }, 4500);
  }
  function lage() {
    if (!verbunden) return { farbe: 'rot', text: 'Brücke nicht erreichbar', mehr: 'Läuft das Fenster der Brücke? Hat der Browser den Zugriff auf dieses Gerät erlaubt (Schloss links in der Adresszeile › Website-Einstellungen)?' };
    if (!board.verbunden) return { farbe: 'gelb', text: 'Autodarts nicht verbunden', mehr: 'Autodarts Desktop starten und dort die Erkennung starten.' };
    var b = (board.board || '').toLowerCase();
    if (/takeout/.test(b)) return { farbe: 'gelb', text: 'Pfeile ziehen' };
    if (!/throw|takeout/.test(b)) return { farbe: 'gelb', text: 'Erkennung gestoppt', mehr: 'In Autodarts Desktop die Erkennung starten.' };
    return { farbe: 'gruen', text: 'Autodarts bereit' };
  }
  /* Die vier Schritte der Einrichtung, jeweils erledigt oder nicht. */
  function schritte() {
    var b = (board.board || '').toLowerCase();
    return [
      { ok: verbunden, text: 'Brücke läuft', mehr: 'start-windows.bat im Ordner Autodarts-Bruecke starten.' },
      { ok: verbunden && board.verbunden, text: 'Autodarts Desktop verbunden', mehr: 'Autodarts Desktop starten.' },
      { ok: verbunden && board.verbunden && /throw|takeout/.test(b), text: 'Erkennung läuft und ist kalibriert', mehr: 'In Autodarts kalibrieren (alle drei Rahmen grün) und die Erkennung starten.' },
      { ok: cfg.geprueft, text: 'Testwurf erkannt', mehr: 'Einen Dart werfen. Er wird beim Einrichten nicht gebucht.' }
    ];
  }
  function zeichnen() {
    if (!chip) return;
    var l = lage();
    /* Im Spiel nur, wenn Autodarts an ist: der Zustand, klein oben. */
    chip.hidden = !cfg.an;
    chip.className = 'ad-chip ' + l.farbe;
    var letzte = verlauf.slice(-3).filter(function (x) { return x !== '|'; }).join(' ');
    chip.innerHTML = '<i></i><span>' + esc(l.text) + '</span>' + (letzte ? '<span class="ad-v">' + esc(letzte) + '</span>' : '') +
      (schlange.length ? '<span class="ad-v">· ' + schlange.length + ' wartet</span>' : '');
    panel.hidden = !panelAuf;
    if (window.__dart && window.__dart.state && window.__dart.state().screen === 'setup' && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) {
      var zeile = document.getElementById('setting-autodarts');
      var text = cfg.an ? l.text : 'aus';
      if (zeile && zeile.getAttribute('data-stand') !== text) window.__dart.render();
    }
    if (!panelAuf) return;
    var fokus = document.activeElement && panel.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (fokus) return;   // nicht unter dem Tippen neu zeichnen
    var st = schritte(), fertig = st.every(function (x) { return x.ok; });
    panel.innerHTML = '<h3>Autodarts an diesem Gerät</h3>' +
      '<p>' + (cfg.an ? 'Eingeschaltet: jedes Spiel an diesem Gerät zählt über die Kameras. Von Hand nur noch korrigieren.'
        : 'Die Kameras erkennen jeden Dart, die App bucht ihn. Erst wenn alles grün ist, lässt es sich einschalten.') + '</p>' +
      '<ol class="ad-schritte">' + st.map(function (x) {
        return '<li class="' + (x.ok ? 'ok' : '') + '"><i aria-hidden="true">' + (x.ok ? '✓' : '') + '</i><span><b>' + esc(x.text) + '</b>' + (x.ok ? '' : '<small>' + esc(x.mehr) + '</small>') + '</span></li>';
      }).join('') + '</ol>' +
      (verlauf.length ? '<p class="ad-klein">Zuletzt erkannt: <code>' + esc(verlauf.join(' ')) + '</code></p>' : '') +
      '<div class="ad-zeile">' +
        (cfg.an ? '<button type="button" data-ad="an">Ausschalten</button>'
          : '<button type="button" data-ad="an" class="an"' + (fertig ? '' : ' disabled') + '>Einschalten</button>') +
        '<button type="button" data-ad="zu">Schließen</button></div>' +
      '<details class="ad-mehr"><summary>Adresse der Brücke</summary><input id="ad-adresse" value="' + esc(cfg.adresse) + '" spellcheck="false" autocomplete="off" aria-label="Adresse der Brücke">' +
        '<div class="ad-zeile"><button type="button" data-ad="speichern">Verbinden</button></div><p class="ad-klein">Brücke ' + (brueckeVersion ? esc(brueckeVersion) : '–') + '</p></details>';
  }
  function oeffnen() {
    panelAuf = true;
    if (!strom) verbinden(); else zeichnen();
    var b = panel.querySelector('button:not([disabled])');
    if (b) b.focus();
  }
  function schliessen() {
    panelAuf = false;
    if (!cfg.an) trennen();
    zeichnen();
  }

  /* ================= Start ================= */
  function start() {
    D = window.__dart;
    if (!D || !D.spielDart || !D.offeneAufnahme || !D.aufnahmeSchluessel) { setTimeout(start, 200); return; }
    aufbauen();
    verbinden();
  }
  window.DartAutodarts = {
    zustand: function () { return { an: cfg.an, geprueft: cfg.geprueft, verbunden: verbunden, board: board, schlange: schlange.length, letzteSeq: letzteSeq, verlauf: verlauf.slice() }; },
    verbinden: verbinden,
    /* Fuer app.js: ist Autodarts an diesem Geraet an, und wie steht es? */
    an: function () { return cfg.an; },
    lage: function () { return cfg.an ? lage() : { farbe: '', text: 'aus' }; },
    oeffnen: function () { if (panel) oeffnen(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
