/*
 * Kamera-Kopplung ("Linse"): ein iPhone verbindet sich mit der laufenden
 * Spielsession auf dem iPad und liefert Darts zu - in dieser Ausbaustufe
 * noch per Fern-Tastenfeld, spaeter erkennt die iPhone-Kamera die Wuerfe
 * selbst. Es fliessen nur kleine JSON-Ereignisse ueber den Server
 * (SSE + POST), nie Video.
 *
 * Auch diese Datei ist OPTIONAL - ohne sie (Einzeldatei-Build) oder ohne
 * Server bleibt die App exakt wie sie ist. Sie dockt wie js/sync.js nur
 * an window.__dart an; app.js zeigt den Kamera-Modus erst, wenn
 * window.DartKamera existiert.
 *
 * Rollen: "tisch" = das iPad, auf dem das Spiel laeuft und gebucht wird.
 *         "linse" = das iPhone am Stativ, das Darts meldet.
 * Beide Seiten sprechen denselben Raum an, den das iPad unter einem
 * 6-stelligen Code registriert. Zustellung ist at-least-once, jedes
 * Ereignis traegt eine Laufnummer - doppelt Angekommenes wird verworfen.
 */
(function () {
  'use strict';

  if (location.protocol.indexOf('http') !== 0) return;

  var SCHLUESSEL = 'dart-turnier-kamera-v1';
  /* Ohne 0/O/1/I - der Code wird am Board laut vorgelesen und abgetippt. */
  var ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var STAND_TAKT = 5000;     // Spielstand ans iPhone, auch ohne Anlass
  var LINSE_WEG = 30000;     // solange kein Lebenszeichen: "getrennt" anzeigen

  var D = null;
  /* letzteSeq: Wasserzeichen der verarbeiteten Ereignisse. Es wird mit dem
     Raum gespeichert, damit ein neu geladenes iPad die Ringpuffer-Nachlieferung
     nicht als frische Darts doppelt bucht - und beim Registrieren mit dem
     Server abgeglichen, falls der nach einem Neustart wieder bei 0 zaehlt. */
  var raum = { code: '', token: '', letzteSeq: 0 };
  var rolle = null;          // 'tisch' oder 'linse', je nachdem wer wir sind
  var aktiv = false;         // Kamera-Modus auf dem iPad eingeschaltet
  var strom = null;          // EventSource
  var verbunden = false;
  var linseDa = 0;           // letztes Lebenszeichen der Gegenseite (Tisch-Sicht)
  var linseSeq = 0;          // Wasserzeichen der Linse (nur je Sitzung)
  var neuTimer = null;       // geplanter Neuaufbau nach endgueltig totem Strom
  var standTimer = null;
  var linseMult = 1;         // gewaehlter Multiplikator auf dem iPhone
  var linseStand = null;     // letzter Spielstand vom Tisch
  var linseNotiz = '';       // kurze Rueckmeldung ("abgelehnt")
  var medien = null;         // MediaStream der iPhone-Kamera
  var wach = null;           // WakeLock, damit das iPhone am Stativ anbleibt
  var kameraFehler = '';
  var cvAktiv = false;       // Erkennung (js/linse-cv.js) laeuft
  var cvStatus = '';
  var KONFIDENZ_AB = 0.8;    // darunter bucht der Tisch nicht automatisch

  /* ================= kleiner Speicher ================= */

  function laden() {
    try {
      var z = JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}');
      if (z && typeof z === 'object') {
        raum.code = typeof z.code === 'string' ? z.code : '';
        raum.token = typeof z.token === 'string' ? z.token : '';
        raum.letzteSeq = Number(z.letzteSeq) || 0;
      }
    } catch (e) { /* kaputt oder leer: neuer Raum beim Koppeln */ }
  }
  function sichern() {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(raum)); } catch (e) { /* dann eben nicht */ }
  }

  function zufall(laenge, zeichen) {
    var werte = new Uint32Array(laenge);
    (window.crypto || window.msCrypto).getRandomValues(werte);
    var s = '';
    for (var i = 0; i < laenge; i++) s += zeichen[werte[i] % zeichen.length];
    return s;
  }

  function ruf(methode, pfad, body) {
    return fetch(pfad, {
      method: methode,
      headers: body
        ? { 'Content-Type': 'application/json', 'X-Darts-App': '1' }
        : { 'X-Darts-App': '1' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    }).then(function (antwort) {
      return antwort.json().catch(function () { return {}; }).then(function (daten) {
        if (!antwort.ok) {
          var f = new Error(daten.fehler || 'HTTP ' + antwort.status);
          f.status = antwort.status;
          throw f;
        }
        return daten;
      });
    });
  }

  function sende(typ, daten) {
    if (!raum.code || !rolle) return Promise.resolve();
    return ruf('POST', '/api/kamera/raum/' + raum.code + '/ereignis', {
      von: rolle, typ: typ, daten: daten || {}
    }).catch(function () { /* naechster Takt bringt den Stand ohnehin neu */ });
  }

  /* ================= gemeinsamer Strom ================= */

  function stromAuf(alsRolle, aufEreignis) {
    stromZu();
    rolle = alsRolle;
    var ab = alsRolle === 'tisch' ? raum.letzteSeq : linseSeq;
    strom = new EventSource('/api/kamera/raum/' + raum.code + '/strom?rolle=' + alsRolle + '&ab=' + ab);
    strom.onopen = function () { verbunden = true; zeichne(); };
    strom.onerror = function () { verbunden = false; zeichne(); planeNeuaufbau(); };
    strom.onmessage = function (ev) {
      var daten;
      try { daten = JSON.parse(ev.data); } catch (e) { return; }
      var seq = daten && Number(daten.seq) || 0;
      /* Zustellung ist at-least-once: alles bis zum Wasserzeichen ist schon
         verarbeitet (auch ueber einen Neustart der Seite hinweg). */
      if (rolle === 'tisch') {
        if (seq <= raum.letzteSeq) return;
        raum.letzteSeq = seq;
        sichern();
      } else {
        if (seq <= linseSeq) return;
        linseSeq = seq;
      }
      aufEreignis(daten);
    };
  }

  /* Ein EventSource verbindet sich selbst neu - aber nicht, wenn der Server
     mit einem Fehler geantwortet hat (Neustart: Raum weg -> 404). Dann hilft
     nur, den Raum neu zu registrieren und frisch aufzumachen. */
  function planeNeuaufbau() {
    if (neuTimer) return;
    neuTimer = setTimeout(function () {
      neuTimer = null;
      if (strom && strom.readyState !== 2) return;   // er verbindet noch selbst
      if (rolle === 'tisch' && aktiv) tischStart();
      else if (rolle === 'linse' && linseOffen) linseVerbinden(raum.code);
    }, 7000);
  }
  function stromZu() {
    if (strom) { try { strom.close(); } catch (e) { /* war schon zu */ } }
    strom = null;
    verbunden = false;
  }

  /* iOS wirft stille Verbindungen im Hintergrund weg; beim Zurueckkommen
     haengt der EventSource dann tot herum. Einmal neu aufmachen. Auch der
     Wake Lock geht beim Tab-Wechsel verloren und muss neu angefordert werden. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (medien) wachhalten();
    if (!strom || strom.readyState !== 2) return;
    if (rolle === 'tisch' && aktiv) tischStart();
    if (rolle === 'linse') linseVerbinden(raum.code);
  });

  /* ================= iPhone-Kamera (Vorschau) =================
     Die Erkennung selbst kommt in js/linse-cv.js - hier steht nur, was das
     Stativ braucht: Rueckkamera an, Bildschirm anlassen, sauber wieder aus. */

  function kameraAn() {
    if (medien) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      kameraFehler = 'Dieser Browser gibt die Kamera nicht frei.';
      zeichne();
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      medien = s;
      kameraFehler = '';
      wachhalten();
      zoomEinrichten();
      zeichne();
    }).catch(function (e) {
      kameraFehler = e && e.name === 'NotAllowedError'
        ? 'Kamera-Zugriff abgelehnt. In den Safari-Einstellungen fuer diese Seite erlauben.'
        : 'Die Kamera liess sich nicht starten.';
      zeichne();
    });
  }

  function kameraAus() {
    if (medien) {
      medien.getTracks().forEach(function (t) { t.stop(); });
      medien = null;
    }
    zoomInfo = null;
    if (wach) {
      try { wach.release(); } catch (e) { /* war schon frei */ }
      wach = null;
    }
  }

  /* ================= Zoom =================
     Neuere iPhones stehen mit der Standardlinse recht weit weg vom Board -
     wo der Browser echten Kamera-Zoom anbietet, gibt es einen Regler. Nach
     einer Zoom-Aenderung stimmt die Kalibrierung nicht mehr; sie wird
     verworfen und (laeuft die Erkennung) gleich neu angestossen - dank
     automatischer Board-Erkennung ist das nur ein "Passt"-Tipp. */

  var zoomInfo = null;
  var zoomWert = 1;

  function zoomEinrichten() {
    zoomInfo = null;
    var spur = medien && medien.getVideoTracks()[0];
    if (!spur || !spur.getCapabilities) return;
    var kann = spur.getCapabilities();
    if (!kann.zoom || !(kann.zoom.max > kann.zoom.min)) return;
    zoomInfo = {
      min: kann.zoom.min,
      max: Math.min(kann.zoom.max, 6),
      schritt: kann.zoom.step || 0.1
    };
    var gemerkt = NaN;
    try { gemerkt = Number(localStorage.getItem(SCHLUESSEL + '-zoom')); } catch (e) { /* egal */ }
    if (gemerkt >= zoomInfo.min && gemerkt <= zoomInfo.max) {
      zoomWert = gemerkt;
      zoomAnwenden(gemerkt);
    } else {
      var stand = spur.getSettings ? spur.getSettings() : {};
      zoomWert = typeof stand.zoom === 'number' ? stand.zoom : zoomInfo.min;
    }
  }

  function zoomAnwenden(wert) {
    zoomWert = wert;
    var spur = medien && medien.getVideoTracks()[0];
    if (!spur) return;
    spur.applyConstraints({ advanced: [{ zoom: wert }] }).catch(function () { /* Linse mag nicht */ });
    try { localStorage.setItem(SCHLUESSEL + '-zoom', String(wert)); } catch (e) { /* egal */ }
  }

  function zoomFertig() {
    /* Regler losgelassen: alte Kalibrierung passt nicht mehr zum Bild. */
    try { localStorage.removeItem('dart-turnier-linse-v1'); } catch (e) { /* egal */ }
    if (cvAktiv && window.DartLinse) window.DartLinse.kalibrieren();
  }

  function wachhalten() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen')
      .then(function (w) { wach = w; })
      .catch(function () { /* dann eben Hinweis aufs Ladekabel */ });
  }

  /* ================= Erkennung (js/linse-cv.js, lazy) =================
     Die CV-Datei ist gross genug, dass sie nur die Linse laedt - das iPad
     und die Einzeldatei bekommen sie nie zu sehen. */

  function erkennungLaden() {
    return new Promise(function (fertig, kaputt) {
      if (window.DartLinse) return fertig();
      var s = document.createElement('script');
      s.src = 'js/linse-cv.js';
      s.onload = function () { fertig(); };
      s.onerror = function () { kaputt(new Error('linse-cv.js fehlt')); };
      document.head.appendChild(s);
    });
  }

  function erkennungAn() {
    if (!medien) { kameraAn(); return; }
    erkennungLaden().then(function () {
      cvAktiv = true;
      cvStatus = 'Erkennung startet...';
      window.DartLinse.start(medien, {
        dart: function (mult, num, konfidenz) {
          sende('dart', { mult: mult, num: num, konfidenz: konfidenz });
        },
        aufnahmeEnde: function (grund) { sende('aufnahmeEnde', { grund: grund }); },
        status: function (text) { cvStatus = text; zeichne(); }
      });
      zeichne();
    }).catch(function () {
      cvStatus = 'Die Erkennung liess sich nicht laden.';
      zeichne();
    });
  }

  function erkennungAus() {
    if (window.DartLinse && cvAktiv) window.DartLinse.stop();
    cvAktiv = false;
    cvStatus = '';
  }

  /* ================= Rolle Tisch (iPad) ================= */

  function tischStart() {
    if (!raum.code || !raum.token) {
      raum.code = zufall(6, ZEICHEN);
      raum.token = zufall(24, ZEICHEN + 'abcdefghijklmnopqrstuvwxyz');
      sichern();
    }
    ruf('POST', '/api/kamera/raum', { code: raum.code, token: raum.token })
      .then(function (daten) {
        /* Server-Neustart: der Raum zaehlt wieder von vorn. Ohne Abgleich
           wuerde das alte Wasserzeichen alle neuen Darts verschlucken. */
        if (daten && typeof daten.seq === 'number' && daten.seq < raum.letzteSeq) {
          raum.letzteSeq = daten.seq;
          sichern();
        }
        stromAuf('tisch', tischEreignis);
        if (standTimer) clearInterval(standTimer);
        standTimer = setInterval(function () {
          if (aktiv && verbunden && !document.hidden) sendeStand();
        }, STAND_TAKT);
        zeichne();
      })
      .catch(function (f) {
        /* 409: der Code gehoert einem anderen Geraet (Kollision oder alter
           Server-Stand) - dann eben ein frischer Code. */
        if (f && f.status === 409) {
          raum.code = '';
          raum.token = '';
          raum.letzteSeq = 0;
          sichern();
          tischStart();
          return;
        }
        verbunden = false;
        zeichne();
      });
  }

  function tischStop() {
    stromZu();
    rolle = null;
    if (standTimer) { clearInterval(standTimer); standTimer = null; }
    linseDa = 0;
    zeichne();
  }

  function tischEreignis(ev) {
    linseDa = Date.now();
    if (ev.typ === 'dart') {
      /* Unsichere Erkennungen bucht der Tisch nicht - die Linse zeigt es an,
         am Board wird von Hand nachgetragen (oder gleich neu geworfen).
         Bewusst !(>=): ein Ereignis OHNE Konfidenz gilt als unsicher. */
      if (!(Number(ev.konfidenz) >= KONFIDENZ_AB)) {
        sende('abgelehnt', { fuer: ev.seq, grund: 'Zu unsicher erkannt - bitte am iPad eintragen.' });
        sendeStand();
        return;
      }
      /* Ein offener Dialog blockiert die Handeingabe ueber das DOM - fuer
         Kamera-Darts muss derselbe Riegel hier stehen, sonst landet ein
         Phantom-Dart im gerade gewonnenen Leg. */
      if (D.ui().overlay) {
        sende('abgelehnt', { fuer: ev.seq, grund: ablehnGrund() });
        sendeStand();
        return;
      }
      var ok = D.spielDart(Number(ev.mult), Number(ev.num));
      if (!ok) sende('abgelehnt', { fuer: ev.seq, grund: ablehnGrund() });
      sendeStand();
      return;
    }
    if (ev.typ === 'hallo' || ev.typ === 'status') { sendeStand(); zeichne(); }
  }

  function ablehnGrund() {
    var S = D.state();
    if (S.screen !== 'game' && S.screen !== 'cricket' && S.screen !== 'rtw' && S.screen !== 'finisher') {
      return 'Auf dem iPad laeuft gerade kein Spiel.';
    }
    if (D.ui().overlay) return 'Auf dem iPad ist ein Dialog offen.';
    return 'Der Dart konnte nicht gebucht werden.';
  }

  function summe(darts) {
    var s = 0;
    for (var i = 0; i < darts.length; i++) s += darts[i].v;
    return s;
  }

  function spielstand() {
    var S = D.state();
    if (S.screen === 'game') {
      var m = D.currentMatch();
      if (m) {
        var leg = D.activeLeg(m);
        var pid = D.activePlayer(leg, m);
        var p = D.profile(pid);
        var ui = D.ui();
        return {
          screen: 'game',
          name: p ? p.name : '',
          rest: D.remainingIn(leg, pid) - summe(ui.darts),
          aufnahme: ui.darts.map(function (d) { return { m: d.m, n: d.n }; }),
          fertig: !!m.done
        };
      }
    }
    if (S.screen === 'cricket' || S.screen === 'rtw' || S.screen === 'finisher') {
      var g = D.game();
      var aktivId = g && !g.done ? D.gameTurnPlayer() : null;
      var prof = aktivId ? D.profile(aktivId) : null;
      return { screen: S.screen, name: prof ? prof.name : '', fertig: !!(g && g.done) };
    }
    return { screen: S.screen };
  }

  function sendeStand() {
    sende('spielstand', spielstand());
  }

  /* ================= Rolle Linse (iPhone) ================= */

  function linseVerbinden(code) {
    if (raum.code !== code) linseSeq = 0;   // neuer Raum, frisches Wasserzeichen
    raum.code = code;
    ruf('GET', '/api/ping')
      .then(function () {
        stromAuf('linse', linseEreignis);
        sende('hallo', { geraet: 'browser' });
        zeichne();
      })
      .catch(function () { linseNotiz = 'Keine Verbindung zum Server.'; zeichne(); });
  }

  function linseEreignis(ev) {
    /* Die Notiz ("abgelehnt") bleibt stehen, bis der naechste Dart gemeldet
       wird - der Spielstand kommt alle paar Sekunden und wuerde sie sonst
       wegwischen, bevor sie jemand liest. */
    if (ev.typ === 'spielstand') { linseStand = ev; zeichne(); }
    if (ev.typ === 'abgelehnt') { linseNotiz = String(ev.grund || 'Der Dart wurde nicht gebucht.'); zeichne(); }
  }

  function linseDart(mult, num) {
    linseNotiz = '';
    sende('dart', { mult: mult, num: num, konfidenz: 1 });
    linseMult = 1;
    zeichne();
  }

  /* ================= Oberflaeche =================
     Eigenes Markup, eigenes CSS - app.js und styles.css bleiben unberuehrt.
     Der Tisch bekommt nur einen Status-Chip plus Koppel-Dialog, die Linse
     eine Vollbild-Ansicht ueber allem. */

  var css = '' +
    '#kamera-chip{position:fixed;right:10px;bottom:10px;z-index:900;background:#1c2733;color:#dfe9f2;' +
    'border:1px solid #3b4d61;border-radius:20px;padding:6px 14px;font-size:14px;cursor:pointer;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.4)}' +
    '#kamera-chip.gut{border-color:#2f8f5b}' +
    '#kamera-chip.hidden,#kamera-dialog.hidden,#kamera-linse.hidden{display:none}' +
    '#kamera-dialog{position:fixed;inset:0;z-index:950;background:rgba(10,15,20,.82);display:flex;' +
    'align-items:center;justify-content:center}' +
    '#kamera-dialog .box{background:#16202b;border:1px solid #3b4d61;border-radius:14px;padding:26px 30px;' +
    'max-width:440px;text-align:center;color:#dfe9f2}' +
    '#kamera-dialog .code{font-size:44px;letter-spacing:10px;font-weight:700;margin:14px 0;color:#fff}' +
    '#kamera-dialog p{margin:8px 0;font-size:15px;line-height:1.45;color:#aebfcf}' +
    '#kamera-dialog button{margin-top:14px;background:#2c3e50;color:#fff;border:0;border-radius:9px;' +
    'padding:10px 22px;font-size:15px;cursor:pointer}' +
    '#kamera-linse{position:fixed;inset:0;z-index:960;background:#0d141b;color:#eef4f9;display:flex;' +
    'flex-direction:column;padding:14px;box-sizing:border-box;overflow:auto;' +
    '-webkit-user-select:none;user-select:none}' +
    '#kamera-linse h2{margin:0 0 4px;font-size:18px}' +
    '#kamera-linse .status{font-size:13px;color:#8fa3b5;margin-bottom:10px}' +
    '#kamera-linse .cam{margin-bottom:12px}' +
    '#kamera-linse .cam video{width:100%;max-height:48vh;border-radius:12px;background:#000;display:block;' +
    'object-fit:contain}' +
    '#kamera-linse .zoom{display:flex;align-items:center;gap:10px;margin-top:8px;color:#9fb4c6;font-size:14px}' +
    '#kamera-linse .zoom input{flex:1;accent-color:#2f74c0}' +
    '#kamera-linse .cam .cam-an{width:100%;padding:12px 0;font-size:16px;border-radius:10px;' +
    'border:1px dashed #33475c;background:#121b25;color:#9fb4c6}' +
    '#kamera-linse .cam-hinweis{font-size:12px;color:#7d93a8;margin-top:4px}' +
    '#kamera-linse .cam-hinweis.warn{color:#ff9d76}' +
    '#kamera-linse .cam-hinweis.cv{color:#39d98a;font-size:14px}' +
    '#kamera-linse .cam-zeile{display:flex;gap:8px;margin-top:8px}' +
    '#kamera-linse .cam-zeile button{flex:1;padding:10px 0;font-size:15px;border-radius:10px;' +
    'border:1px solid #33475c;background:#1a2632;color:#dfe9f2}' +
    '#kamera-linse .stand{background:#16202b;border:1px solid #2c3c4d;border-radius:12px;padding:12px 14px;' +
    'margin-bottom:12px;min-height:56px}' +
    '#kamera-linse .stand .wer{font-size:15px;color:#9fb4c6}' +
    '#kamera-linse .stand .rest{font-size:34px;font-weight:700}' +
    '#kamera-linse .stand .darts{font-size:15px;color:#9fb4c6;margin-top:2px}' +
    '#kamera-linse .notiz{color:#ff9d76;font-size:14px;min-height:18px;margin-bottom:8px}' +
    '#kamera-linse .mrow{display:flex;gap:8px;margin-bottom:10px}' +
    '#kamera-linse .mrow button{flex:1;padding:12px 0;font-size:16px;border-radius:10px;border:1px solid #33475c;' +
    'background:#1a2632;color:#dfe9f2}' +
    '#kamera-linse .mrow button.an{background:#2f74c0;border-color:#2f74c0;color:#fff}' +
    '#kamera-linse .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}' +
    '#kamera-linse .grid button{padding:14px 0;font-size:18px;border-radius:10px;border:1px solid #33475c;' +
    'background:#1a2632;color:#eef4f9}' +
    '#kamera-linse .grid button.breit{grid-column:span 2}' +
    '#kamera-linse .fuss{margin-top:auto;padding-top:12px;display:flex;justify-content:space-between;align-items:center}' +
    '#kamera-linse .fuss button{background:none;border:0;color:#8fa3b5;font-size:14px;padding:8px}' +
    '#kamera-linse input{width:100%;box-sizing:border-box;font-size:28px;letter-spacing:8px;text-align:center;' +
    'text-transform:uppercase;padding:12px;border-radius:10px;border:1px solid #33475c;background:#1a2632;color:#fff}' +
    '#kamera-linse .verbinden{margin-top:12px;width:100%;padding:14px 0;font-size:17px;border-radius:10px;' +
    'border:0;background:#2f74c0;color:#fff}';

  var wurzel = null;   // Container fuer Chip + Dialog + Linse

  function bauen() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    wurzel = document.createElement('div');
    wurzel.innerHTML =
      '<div id="kamera-chip" class="hidden"></div>' +
      '<div id="kamera-dialog" class="hidden"></div>' +
      '<div id="kamera-linse" class="hidden"></div>';
    document.body.appendChild(wurzel);

    document.getElementById('kamera-chip').addEventListener('click', function () {
      dialogOffen = true; zeichne();
    });
    wurzel.addEventListener('click', klick);
  }

  var dialogOffen = false;
  var linseOffen = false;
  var linseSchluessel = '';   // Bauplan der Linsen-Ansicht, gegen Neubau-Flackern

  function klick(ev) {
    var t = ev.target.closest('[data-kamera]');
    if (!t) return;
    var was = t.getAttribute('data-kamera');
    if (was === 'dialog-zu') { dialogOffen = false; zeichne(); }
    else if (was === 'kamera-an') { kameraAn(); }
    else if (was === 'cv-an') { erkennungAn(); }
    else if (was === 'cv-kalib') { if (window.DartLinse) window.DartLinse.kalibrieren(); }
    else if (was === 'cv-aus') { erkennungAus(); zeichne(); }
    else if (was === 'linse-zu') {
      linseOffen = false;
      stromZu();
      erkennungAus();
      kameraAus();
      rolle = null;
      linseStand = null;
      if (location.hash.indexOf('#kamera') === 0) {
        history.replaceState(null, '', location.pathname + location.search);
      }
      zeichne();
    } else if (was === 'verbinden') {
      var feld = document.getElementById('kamera-code');
      var code = (feld && feld.value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
      if (code.length !== 6) { linseNotiz = 'Der Code hat 6 Zeichen.'; zeichne(); return; }
      linseNotiz = '';
      linseVerbinden(code);
    } else if (was === 'mult') {
      linseMult = Number(t.getAttribute('data-m'));
      zeichne();
    } else if (was === 'dart') {
      var num = Number(t.getAttribute('data-n'));
      var mult = Number(t.getAttribute('data-m') || linseMult);
      linseDart(mult, num);
    }
  }

  function zeichne() {
    if (!wurzel) return;
    var chip = document.getElementById('kamera-chip');
    var dialog = document.getElementById('kamera-dialog');
    var linse = document.getElementById('kamera-linse');

    /* --- Tisch: Chip + Koppel-Dialog --- */
    var linseFrisch = linseDa && Date.now() - linseDa < LINSE_WEG;
    if (aktiv) {
      chip.classList.remove('hidden');
      chip.classList.toggle('gut', verbunden && linseFrisch);
      chip.textContent = !verbunden
        ? '📷 Kamera: keine Verbindung zum Server'
        : linseFrisch ? '📷 iPhone verbunden · ' + raum.code
        : '📷 Wartet auf das iPhone · Code ' + raum.code;
    } else {
      chip.classList.add('hidden');
    }

    if (aktiv && dialogOffen) {
      dialog.classList.remove('hidden');
      dialog.innerHTML =
        '<div class="box">' +
          '<h3>iPhone koppeln</h3>' +
          '<p>Auf dem iPhone <b>' + esc(location.host) + '</b> im Safari &ouml;ffnen,<br>' +
          'unten &bdquo;Als Kamera koppeln&ldquo; w&auml;hlen und diesen Code eintippen:</p>' +
          '<div class="code">' + (raum.code ? esc(raum.code) : '&hellip;') + '</div>' +
          '<p>' + (verbunden && linseFrisch ? 'Das iPhone ist verbunden.' : 'Es wartet&hellip;') + '</p>' +
          '<button data-kamera="dialog-zu">Fertig</button>' +
        '</div>';
    } else {
      dialog.classList.add('hidden');
      dialog.innerHTML = '';
    }

    /* --- Linse: Vollbild ---
       Das Geruest wird NUR neu gebaut, wenn sich der Aufbau wirklich aendert
       (Kamera an/aus, Zoom da/nicht da, Erkennung an/aus). Jedes Ereignis
       laesst sonst nur Texte wandern - wuerde das <video> jedes Mal neu
       erzeugt, flackerte die Vorschau im Takt des Spielstands. */
    if (linseOffen) {
      linse.classList.remove('hidden');
      var ansicht = rolle === 'linse' ? 'spiel' : 'koppeln';
      var schluessel = ansicht + ':' + (medien ? 1 : 0) + ':' + (zoomInfo ? 1 : 0) + ':' +
        (cvAktiv ? 1 : 0) + ':' + (kameraFehler ? 1 : 0);
      if (schluessel !== linseSchluessel) {
        linseSchluessel = schluessel;
        linse.innerHTML = ansicht === 'spiel' ? linseSpielHtml() : linseKoppelHtml();
        var v = document.getElementById('kamera-video');
        if (v && medien) {
          v.srcObject = medien;
          var abspielen = v.play();
          if (abspielen && abspielen.catch) abspielen.catch(function () { /* Autoplay-Zicken */ });
        }
        /* Der Zoom-Regler lebt ausserhalb des Klick-Handlers: waehrend des
           Ziehens nur anwenden und Anzeige nachfuehren (kein zeichne(), sonst
           springt der Regler unterm Finger weg), erst beim Loslassen die
           Kalibrierung erneuern. */
        var z = document.getElementById('kamera-zoom');
        if (z) {
          z.oninput = function () {
            var wert = Number(this.value);
            zoomAnwenden(wert);
            var anzeige = document.getElementById('kamera-zoom-wert');
            if (anzeige) anzeige.innerHTML = wert.toFixed(1) + '&times;';
          };
          z.onchange = zoomFertig;
        }
      }
      if (ansicht === 'spiel') linseFelder();
    } else {
      linse.classList.add('hidden');
      if (linseSchluessel) { linse.innerHTML = ''; linseSchluessel = ''; }
    }
  }

  function linseKoppelHtml() {
    return '<h2>Als Kamera koppeln</h2>' +
      '<div class="status">Der Code steht auf dem iPad (Kamera-Modus im Spiel w&auml;hlen).</div>' +
      '<input id="kamera-code" maxlength="6" autocomplete="off" autocapitalize="characters" ' +
        'placeholder="CODE" value="' + esc(raum.code || '') + '">' +
      '<div class="notiz">' + esc(linseNotiz) + '</div>' +
      '<button class="verbinden" data-kamera="verbinden">Verbinden</button>' +
      '<div class="fuss"><button data-kamera="linse-zu">Zur&uuml;ck zur App</button></div>';
  }

  /* Das stabile Geruest der Linsen-Ansicht. Alles, was sich im Betrieb
     aendert (Status, Spielstand, Notiz, Tastenbeschriftung), bekommt eine
     Kennung und wird von linseFelder() an Ort und Stelle aktualisiert. */
  function linseSpielHtml() {
    var multRow = [1, 2, 3].map(function (m) {
      return '<button data-kamera="mult" data-m="' + m + '">' +
        (m === 1 ? 'Single' : m === 2 ? 'Double' : 'Triple') + '</button>';
    }).join('');

    var tasten = '';
    for (var n = 1; n <= 20; n++) {
      tasten += '<button data-kamera="dart" data-n="' + n + '">' + n + '</button>';
    }
    tasten += '<button data-kamera="dart" data-n="25" data-m="1">25</button>';
    tasten += '<button data-kamera="dart" data-n="25" data-m="2" class="breit">Bull</button>';
    tasten += '<button data-kamera="dart" data-n="0" data-m="1" class="breit">Miss</button>';

    /* Kamera-Vorschau frueh anbieten: das Stativ laesst sich so schon
       ausrichten, auch wenn die Erkennung erst spaeter dazukommt. */
    var cam;
    if (!medien) {
      cam = '<button class="cam-an" data-kamera="kamera-an">📷 Kamera einschalten</button>' +
        (kameraFehler ? '<div class="cam-hinweis warn">' + esc(kameraFehler) + '</div>' : '');
    } else {
      cam = '<video id="kamera-video" playsinline muted autoplay></video>' +
        (zoomInfo
          ? '<div class="zoom">🔍 <input id="kamera-zoom" type="range" min="' + zoomInfo.min +
            '" max="' + zoomInfo.max + '" step="' + zoomInfo.schritt + '" value="' + zoomWert + '">' +
            '<span id="kamera-zoom-wert">' + zoomWert.toFixed(1) + '&times;</span></div>'
          : '') +
        '<div class="cam-zeile">' +
          (cvAktiv
            ? '<button data-kamera="cv-kalib">Neu kalibrieren</button>' +
              '<button data-kamera="cv-aus">Erkennung aus</button>'
            : '<button data-kamera="cv-an">🎯 Erkennung starten</button>') +
        '</div>' +
        '<div class="cam-hinweis cv" id="linse-cv-status"></div>' +
        '<div class="cam-hinweis">Bildschirm bleibt an &ndash; Ladekabel empfohlen.</div>';
    }

    return '<h2>Fern-Eingabe &middot; Raum ' + esc(raum.code) + '</h2>' +
      '<div class="status" id="linse-status"></div>' +
      '<div class="cam">' + cam + '</div>' +
      '<div class="stand" id="linse-stand"></div>' +
      '<div class="notiz" id="linse-notiz"></div>' +
      '<div class="mrow">' + multRow + '</div>' +
      '<div class="grid">' + tasten + '</div>' +
      '<div class="fuss"><button data-kamera="linse-zu">Trennen und zur&uuml;ck</button></div>';
  }

  function linseFelder() {
    var statusEl = document.getElementById('linse-status');
    if (statusEl) statusEl.textContent = verbunden ? 'Verbunden mit dem iPad' : 'Getrennt - verbindet neu...';

    var cvEl = document.getElementById('linse-cv-status');
    if (cvEl) cvEl.textContent = cvStatus;

    var notizEl = document.getElementById('linse-notiz');
    if (notizEl) notizEl.textContent = linseNotiz;

    var standEl = document.getElementById('linse-stand');
    if (standEl) {
      var st = linseStand, stand;
      if (!verbunden) {
        stand = '<div class="wer">Verbindung wird aufgebaut&hellip;</div>';
      } else if (!st) {
        stand = '<div class="wer">Verbunden &ndash; wartet auf den Spielstand&hellip;</div>';
      } else if (st.screen === 'game') {
        /* Zahlen erzwingen: der Spielstand kommt uebers Netz und geht in
           innerHTML - hier darf nie ein String durchrutschen. */
        var darts = (st.aufnahme || []).map(function (d) {
          var n = Number(d.n) || 0, m = Number(d.m) || 1;
          return n === 0 ? '&ndash;' : (m === 3 ? 'T' : m === 2 ? 'D' : '') + (n === 25 && m === 2 ? 'Bull' : n);
        }).join(' &middot; ');
        stand = '<div class="wer">' + esc(st.name || '') + (st.fertig ? ' &middot; Spiel vorbei' : ' ist dran') + '</div>' +
          '<div class="rest">' + esc(String(st.rest != null ? st.rest : '')) + '</div>' +
          '<div class="darts">' + (darts || 'Aufnahme: noch kein Dart') + '</div>';
      } else if (st.screen === 'cricket' || st.screen === 'rtw' || st.screen === 'finisher') {
        stand = '<div class="wer">' + esc(st.name || '') + (st.fertig ? ' &middot; Spiel vorbei' : ' ist dran') + '</div>' +
          '<div class="darts">' + (st.screen === 'cricket' ? 'Cricket' : st.screen === 'rtw' ? 'Round the World' : 'Finisher') + '</div>';
      } else {
        stand = '<div class="wer">Auf dem iPad l&auml;uft gerade kein Spiel.</div>';
      }
      if (standEl.getAttribute('data-stand') !== stand) {
        standEl.setAttribute('data-stand', stand);
        standEl.innerHTML = stand;
      }
    }

    var wurzelEl = document.getElementById('kamera-linse');
    var multKnoepfe = wurzelEl.querySelectorAll('[data-kamera="mult"]');
    for (var i = 0; i < multKnoepfe.length; i++) {
      multKnoepfe[i].classList.toggle('an', Number(multKnoepfe[i].getAttribute('data-m')) === linseMult);
    }
    var praefix = linseMult === 3 ? 'T' : linseMult === 2 ? 'D' : '';
    var zahlKnoepfe = wurzelEl.querySelectorAll('[data-kamera="dart"]:not([data-m])');
    for (var k = 0; k < zahlKnoepfe.length; k++) {
      zahlKnoepfe[k].textContent = praefix + zahlKnoepfe[k].getAttribute('data-n');
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================= Start ================= */

  function start() {
    D = window.__dart;
    if (!D || !D.spielDart) return;   // App zu alt oder nicht geladen
    laden();
    bauen();

    window.DartKamera = {
      /* app.js ruft das beim Umschalten des Eingabemodus. */
      modus: function (an) {
        aktiv = !!an;
        if (an) { dialogOffen = true; tischStart(); }
        else tischStop();
        zeichne();
      },
      /* Fuer die Linsen-Seite: Vollbild oeffnen (Knopf im Setup / #kamera). */
      linse: function (code) {
        linseOffen = true;
        if (code) linseVerbinden(code);
        zeichne();
      },
      verbunden: function () { return verbunden; }
    };

    /* Einstieg auf dem iPhone: #kamera oder #kamera=CODE in der Adresse. */
    var h = location.hash.match(/^#kamera(?:=([A-Z2-9]{6}))?$/i);
    if (h) window.DartKamera.linse(h[1] ? h[1].toUpperCase() : '');

    /* Diskreter Einstieg unten im Setup-Bildschirm. */
    var setup = document.getElementById('screen-setup');
    if (setup) {
      var k = document.createElement('p');
      k.style.cssText = 'text-align:center;margin:18px 0 6px';
      k.innerHTML = '<button data-kamera="linse-auf" style="background:none;border:0;' +
        'color:#7d93a8;font-size:14px;text-decoration:underline;cursor:pointer">' +
        '📷 Dieses Ger&auml;t als Kamera / Fern-Eingabe koppeln</button>';
      k.addEventListener('click', function () { window.DartKamera.linse(''); });
      setup.appendChild(k);
    }
  }

  /* Erst wenn der Server wirklich da ist - per Doppelklick geoeffnet oder auf
     GitHub Pages gibt es kein /api, und dann soll die App unveraendert
     bleiben (kein Kamera-Knopf, nichts). */
  function anmelden() {
    fetch('/api/ping', { headers: { 'X-Darts-App': '1' } })
      .then(function (a) { return a.ok ? a.json() : Promise.reject(); })
      .then(function () { start(); })
      .catch(function () { /* kein Server: still bleiben */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', anmelden);
  else anmelden();
})();
