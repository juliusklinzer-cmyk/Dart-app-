/*
 * Die Erkennung der Linse: iPhone-Kamera schaut aufs Board, dieser Code
 * meldet gesteckte Darts als (Multiplikator, Feld). Erste Ausbaustufe -
 * klassische Bildverarbeitung ohne Maschinenlernen:
 *
 *   Bewegungs-Wache (kleines Graubild, Differenz zum Vorbild)
 *     -> kurzer Ausschlag + Ruhe = Einschlag-Kandidat
 *     -> Standbild gegen Referenzbild differenzieren
 *     -> neuer Fleck = der Dart, Spitze schaetzen
 *     -> Homographie (4 Kalibrierpunkte) rechnet Bildpunkt -> Board-mm
 *     -> Ring + Sektor = Feld, Meldung an js/kamera.js
 *
 * Bewusste Schwaeche dieser Stufe: die Spitze wird aus dem Fleck geschaetzt.
 * Nahe der Draehte (Triple/Double sind nur 8 mm breit) kann das danebenliegen
 * - deshalb traegt jede Meldung eine Konfidenz, und auf dem iPad bleibt
 * Korrigieren/Undo immer moeglich. Jede Korrektur ist zugleich ein
 * beschriftetes Trainingsbild fuer die spaetere Modell-Stufe.
 *
 * Schnittstelle (nutzt js/kamera.js):
 *   window.DartLinse.start(mediaStream, callbacks)
 *     callbacks.dart(mult, num, konfidenz)
 *     callbacks.aufnahmeEnde(grund)   // 'drei' | 'gezogen'
 *     callbacks.status(text)
 *   window.DartLinse.stop()
 *   window.DartLinse.kalibrieren()   // Kalibrier-Ansicht erneut oeffnen
 */
(function () {
  'use strict';

  var SCHLUESSEL = 'dart-turnier-linse-v1';

  /* Masse des Turnierboards in mm, Radius ab Bull-Mitte. */
  var RINGE = { bullD: 6.35, bull: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, doubleOut: 170 };
  var SEKTOREN = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  /* Die vier Kalibrierpunkte: Aussenkante Doppelring an den Drahtgrenzen
     20/1 (oben), 6/10 (rechts), 3/19 (unten), 11/14 (links) - wie bei
     Autodarts. Winkel im Uhrzeigersinn ab 12 Uhr, y zeigt nach oben. */
  var KALIB = [9, 99, 189, 279].map(function (grad) {
    var b = grad * Math.PI / 180;
    return { x: RINGE.doubleOut * Math.sin(b), y: RINGE.doubleOut * Math.cos(b) };
  });
  var KALIB_TEXT = [
    'Doppel-Aussenkante zwischen 20 und 1 (oben)',
    'Doppel-Aussenkante zwischen 6 und 10 (rechts)',
    'Doppel-Aussenkante zwischen 3 und 19 (unten)',
    'Doppel-Aussenkante zwischen 11 und 14 (links)'
  ];

  /* Analyse-Aufloesung: genug fuer 8-mm-Ringe, klein genug fuers iPhone. */
  var ANALYSE_BREIT = 800;
  var WACHE_BREIT = 160;
  var TAKT_MS = 80;             // Bewegungs-Wache
  var RUHE_BILDER = 5;          // ~400 ms Ausschwingen nach einem Ausschlag

  var stream = null;
  var cb = null;
  var video = null;             // eigenes, unsichtbares Video - unabhaengig
                                // vom Vorschau-Video der Oberflaeche
  var laeuft = false;
  var H = null;                 // Bild -> Board (mm)
  var Hinv = null;              // Board -> Bild, fuers Gitter-Overlay
  var punkte = [];              // 4 Kalibrierpunkte in Analyse-Koordinaten
  var roi = null;               // Board-Ausschnitt im Analysebild

  var aCanvas, aCtx, wCanvas, wCtx;
  var referenz = null;          // Graubild des Boards (mit schon gebuchten Darts)
  var leer = null;              // Graubild des leeren Boards
  var vorher = null;            // letztes Wache-Bild
  var dartMaske = null;         // Pixel der bereits erkannten Darts
  var dartsGesteckt = 0;

  var zustand = 'ruhe';
  var ruhigSeit = 0;
  var timer = null;

  /* ================= Mathe: Homographie ================= */

  /* Gauss-Elimination fuer das 8x8-System der 4-Punkt-Homographie. */
  function loese(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) {
      var max = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
      var t = A[i]; A[i] = A[max]; A[max] = t;
      var tb = b[i]; b[i] = b[max]; b[max] = tb;
      if (Math.abs(A[i][i]) < 1e-10) return null;   // Punkte auf einer Linie
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < n; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /* Homographie aus 4 Punktpaaren: von[i] -> nach[i]. */
  function homographie(von, nach) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var p = von[i], q = nach[i];
      A.push([p.x, p.y, 1, 0, 0, 0, -p.x * q.x, -p.y * q.x]); b.push(q.x);
      A.push([0, 0, 0, p.x, p.y, 1, -p.x * q.y, -p.y * q.y]); b.push(q.y);
    }
    var h = loese(A, b);
    return h ? h.concat([1]) : null;
  }

  function anwenden(h, x, y) {
    var w = h[6] * x + h[7] * y + h[8];
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  }

  /* ================= Board-Wertung ================= */

  function wertung(mm) {
    var r = Math.sqrt(mm.x * mm.x + mm.y * mm.y);
    if (r > RINGE.doubleOut + 12) return { mult: 1, num: 0, rand: 99 };   // klar daneben
    if (r <= RINGE.bullD) return { mult: 2, num: 25, rand: RINGE.bullD - r };
    if (r <= RINGE.bull) return { mult: 1, num: 25, rand: Math.min(r - RINGE.bullD, RINGE.bull - r) };
    var grad = Math.atan2(mm.x, mm.y) * 180 / Math.PI;
    if (grad < 0) grad += 360;
    var num = SEKTOREN[Math.floor(((grad + 9) % 360) / 18)];
    if (r > RINGE.doubleOut) return { mult: 1, num: 0, rand: r - RINGE.doubleOut };
    var mult = 1, rand;
    if (r >= RINGE.doubleIn) { mult = 2; rand = Math.min(r - RINGE.doubleIn, RINGE.doubleOut - r); }
    else if (r >= RINGE.tripleIn && r <= RINGE.tripleOut) { mult = 3; rand = Math.min(r - RINGE.tripleIn, RINGE.tripleOut - r); }
    else rand = Math.min(Math.abs(r - RINGE.tripleOut), Math.abs(r - RINGE.tripleIn), Math.abs(RINGE.doubleIn - r), Math.abs(r - RINGE.bull));
    /* Naehe zur Sektorgrenze zaehlt ebenfalls als "auf dem Draht":
       Abstand zum naechsten Draht in Grad (0 = Grenze, 9 = Sektormitte),
       als Bogenlaenge beim Radius des Treffers in mm umgerechnet. */
    var gradAbstand = 9 - Math.abs(((grad + 9) % 18) - 9);
    var winkelMm = gradAbstand * Math.PI / 180 * r;
    return { mult: mult, num: num, rand: Math.min(rand, winkelMm) };
  }

  /* ================= Bilder ================= */

  function grau(ctx, breit, hoch) {
    var d = ctx.getImageData(0, 0, breit, hoch).data;
    var g = new Uint8ClampedArray(breit * hoch);
    for (var i = 0, j = 0; j < g.length; i += 4, j++) {
      g[j] = (d[i] * 3 + d[i + 1] * 4 + d[i + 2]) >> 3;
    }
    return g;
  }

  function schnappschuss(canvas, ctx, breit) {
    var hoch = Math.round(breit * video.videoHeight / video.videoWidth) || 1;
    canvas.width = breit; canvas.height = hoch;
    ctx.drawImage(video, 0, 0, breit, hoch);
    return { g: grau(ctx, breit, hoch), b: breit, h: hoch };
  }

  /* Mittlere Helligkeit im Board-Ausschnitt - fuer den Belichtungsabgleich. */
  function mittel(bild) {
    var s = 0, n = 0;
    for (var y = roi.y0; y < roi.y1; y += 2) {
      for (var x = roi.x0; x < roi.x1; x += 2) { s += bild.g[y * bild.b + x]; n++; }
    }
    return n ? s / n : 128;
  }

  /* Differenz zweier Analysebilder im Board-Ausschnitt, belichtungsbereinigt.
     Liefert die veraenderten Pixel als Maske. */
  function differenz(alt, neu, schwelle) {
    var faktor = mittel(alt) / Math.max(1, mittel(neu));
    var maske = new Uint8Array(neu.b * neu.h);
    var anzahl = 0;
    for (var y = roi.y0; y < roi.y1; y++) {
      for (var x = roi.x0; x < roi.x1; x++) {
        var i = y * neu.b + x;
        var d = neu.g[i] * faktor - alt.g[i];
        if (d > schwelle || d < -schwelle) { maske[i] = 1; anzahl++; }
      }
    }
    return { maske: maske, anzahl: anzahl, b: neu.b, h: neu.h };
  }

  /* Groesster zusammenhaengender Fleck der Maske, der nicht schon zu einem
     frueheren Dart gehoert. Flutfuellung ohne Rekursion. */
  function groessterFleck(diff) {
    var besucht = new Uint8Array(diff.maske.length);
    var bester = null;
    var stapel = [];
    for (var y = roi.y0; y < roi.y1; y++) {
      for (var x = roi.x0; x < roi.x1; x++) {
        var start = y * diff.b + x;
        if (!diff.maske[start] || besucht[start] || (dartMaske && dartMaske[start])) continue;
        var punkteF = [];
        stapel.push(start); besucht[start] = 1;
        while (stapel.length) {
          var i = stapel.pop();
          punkteF.push(i);
          var ix = i % diff.b, iy = (i / diff.b) | 0;
          var nachbarn = [i - 1, i + 1, i - diff.b, i + diff.b];
          for (var k = 0; k < 4; k++) {
            var nIdx = nachbarn[k];
            if (nIdx < 0 || nIdx >= diff.maske.length || besucht[nIdx]) continue;
            var nx = nIdx % diff.b;
            if (Math.abs(nx - ix) > 1) continue;   // Zeilenumbruch
            if (!diff.maske[nIdx] || (dartMaske && dartMaske[nIdx])) continue;
            besucht[nIdx] = 1; stapel.push(nIdx);
          }
        }
        if (!bester || punkteF.length > bester.length) bester = punkteF;
      }
    }
    return bester;
  }

  /* Spitze des Darts schaetzen: Hauptachse des Flecks, davon das Ende, das
     naeher an der Board-Mitte liegt. Beim frontalen Aufbau zeigt der Schaft
     von der Mitte weg - die Spitze ist das mittennaehere Ende. */
  function spitze(fleck, b) {
    var mx = 0, my = 0, i, x, y;
    for (i = 0; i < fleck.length; i++) { mx += fleck[i] % b; my += (fleck[i] / b) | 0; }
    mx /= fleck.length; my /= fleck.length;
    var sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < fleck.length; i++) {
      x = fleck[i] % b - mx; y = ((fleck[i] / b) | 0) - my;
      sxx += x * x; sxy += x * y; syy += y * y;
    }
    /* Eigenvektor der groesseren Eigenwerts der 2x2-Kovarianz. */
    var diff2 = (sxx - syy) / 2;
    var lambda = (sxx + syy) / 2 + Math.sqrt(diff2 * diff2 + sxy * sxy);
    var ax = sxy, ay = lambda - sxx;
    var norm = Math.sqrt(ax * ax + ay * ay);
    if (norm < 1e-6) { ax = 1; ay = 0; } else { ax /= norm; ay /= norm; }
    var minP = 1e9, maxP = -1e9, minI = fleck[0], maxI = fleck[0];
    for (i = 0; i < fleck.length; i++) {
      x = fleck[i] % b; y = (fleck[i] / b) | 0;
      var p = x * ax + y * ay;
      if (p < minP) { minP = p; minI = fleck[i]; }
      if (p > maxP) { maxP = p; maxI = fleck[i]; }
    }
    var mitte = anwenden(Hinv, 0, 0);
    var e1 = { x: minI % b, y: (minI / b) | 0 };
    var e2 = { x: maxI % b, y: (maxI / b) | 0 };
    var d1 = (e1.x - mitte.x) * (e1.x - mitte.x) + (e1.y - mitte.y) * (e1.y - mitte.y);
    var d2 = (e2.x - mitte.x) * (e2.x - mitte.x) + (e2.y - mitte.y) * (e2.y - mitte.y);
    return d1 <= d2 ? e1 : e2;
  }

  /* ================= Zustandsmaschine ================= */

  function tick() {
    if (!laeuft || !video || video.readyState < 2) return;
    var klein = schnappschussWache();
    if (!klein) return;
    if (!vorher) { vorher = klein; return; }
    var bewegung = bewegungsWert(vorher, klein);
    vorher = klein;

    if (zustand === 'ruhe') {
      if (bewegung > 4) { zustand = 'bewegt'; ruhigSeit = 0; }
      return;
    }
    /* bewegt: warten bis das Bild wieder steht (Board schwingt kurz nach). */
    if (bewegung > 2) { ruhigSeit = 0; return; }
    ruhigSeit++;
    if (ruhigSeit < RUHE_BILDER) return;
    zustand = 'ruhe';
    ruhigSeit = 0;
    analysiere();
  }

  var wachRoi = null;
  function schnappschussWache() {
    var s = schnappschuss(wCanvas, wCtx, WACHE_BREIT);
    if (!wachRoi) {
      var f = WACHE_BREIT / ANALYSE_BREIT;
      wachRoi = { x0: Math.max(0, (roi.x0 * f) | 0), x1: Math.min(s.b, (roi.x1 * f) | 0),
                  y0: Math.max(0, (roi.y0 * f) | 0), y1: Math.min(s.h, (roi.y1 * f) | 0) };
    }
    return s;
  }
  function bewegungsWert(alt, neu) {
    var s = 0, n = 0;
    for (var y = wachRoi.y0; y < wachRoi.y1; y++) {
      for (var x = wachRoi.x0; x < wachRoi.x1; x++) {
        var i = y * neu.b + x;
        s += Math.abs(neu.g[i] - alt.g[i]); n++;
      }
    }
    return n ? s / n : 0;
  }

  function analysiere() {
    var bild = schnappschuss(aCanvas, aCtx, ANALYSE_BREIT);
    var roiFlaeche = (roi.x1 - roi.x0) * (roi.y1 - roi.y0);

    /* Stecken Darts und sieht das Board wieder aus wie leer, wurden sie
       gezogen - egal wie schnell der Griff war. Der Vergleich gegen das
       leere Referenzbild ist selbst der Beweis. */
    if (dartsGesteckt > 0) {
      var gegenLeer = differenz(leer, bild, 25);
      if (gegenLeer.anzahl < roiFlaeche * 0.004) {
        dartsGesteckt = 0;
        dartMaske = null;
        referenz = bild;
        leer = bild;
        melde('Board leer - Aufnahme zu Ende.');
        cb.aufnahmeEnde('gezogen');
        return;
      }
    }

    var diff = differenz(referenz, bild, 25);
    if (diff.anzahl < 25) return;                       // Flackern, nichts Neues
    if (diff.anzahl > roiFlaeche * 0.2) {               // Arm/Schatten im Bild
      melde('Bild verdeckt - warte...');
      return;
    }
    if (dartsGesteckt >= 3) {                           // mehr geht nicht
      melde('3 Darts erkannt - bitte ziehen.');
      return;
    }

    var fleck = groessterFleck(diff);
    if (!fleck || fleck.length < 25) return;

    var tip = spitze(fleck, diff.b);
    var mm = anwenden(H, tip.x, tip.y);
    var w = wertung(mm);

    /* Konfidenz: grosser klarer Fleck mitten im Feld = sicher; winzig,
       riesig oder direkt am Draht = unsicher. */
    var k = 0.92;
    if (fleck.length < 60 || fleck.length > roiFlaeche * 0.1) k -= 0.25;
    if (w.rand < 2.5) k -= 0.2;
    if (w.num === 0 && w.rand === 99) k = Math.min(k, 0.6);

    /* Der neue Dart gehoert ab jetzt zum Bestand. */
    dartMaske = dartMaske || new Uint8Array(diff.maske.length);
    for (var i = 0; i < fleck.length; i++) dartMaske[fleck[i]] = 1;
    referenz = bild;
    dartsGesteckt++;

    melde(beschreibe(w) + ' erkannt (' + Math.round(k * 100) + ' %)');
    cb.dart(w.mult, w.num, Math.max(0.3, Math.round(k * 100) / 100));
    if (dartsGesteckt === 3) cb.aufnahmeEnde('drei');
  }

  function beschreibe(w) {
    if (w.num === 0) return 'Miss';
    if (w.num === 25) return w.mult === 2 ? 'Bull' : '25';
    return (w.mult === 3 ? 'T' : w.mult === 2 ? 'D' : '') + w.num;
  }

  function melde(text) {
    if (cb && cb.status) cb.status(text);
  }

  /* ================= Kalibrier-Ansicht ================= */

  var kalibDiv = null;
  var kalibVideo = null;
  var kalibCanvas = null;
  var kalibPunkte = [];   // in Videopixeln

  function kalibrierUi() {
    kalibPunkte = [];
    if (!kalibDiv) {
      kalibDiv = document.createElement('div');
      kalibDiv.id = 'linse-kalib';
      kalibDiv.style.cssText = 'position:fixed;inset:0;z-index:980;background:#000;display:flex;' +
        'flex-direction:column;color:#eef4f9;font-family:inherit';
      document.body.appendChild(kalibDiv);
    }
    kalibDiv.style.display = 'flex';
    kalibDiv.innerHTML =
      '<div style="padding:10px 14px;font-size:15px" id="linse-kalib-text"></div>' +
      '<div style="position:relative;flex:1;min-height:0">' +
        '<video id="linse-kalib-video" playsinline muted autoplay style="position:absolute;inset:0;' +
          'width:100%;height:100%;object-fit:contain"></video>' +
        '<canvas id="linse-kalib-canvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas>' +
      '</div>' +
      '<div style="display:flex;gap:10px;padding:12px 14px">' +
        '<button id="linse-kalib-zurueck" style="flex:1;padding:12px;border-radius:10px;border:1px solid #33475c;' +
          'background:#1a2632;color:#dfe9f2;font-size:15px">Punkt zur&uuml;ck</button>' +
        '<button id="linse-kalib-ok" style="flex:1;padding:12px;border-radius:10px;border:0;' +
          'background:#2f74c0;color:#fff;font-size:15px" disabled>Passt</button>' +
      '</div>';
    kalibVideo = document.getElementById('linse-kalib-video');
    kalibVideo.srcObject = stream;
    var abspielen = kalibVideo.play();
    if (abspielen && abspielen.catch) abspielen.catch(function () { /* ok */ });
    kalibCanvas = document.getElementById('linse-kalib-canvas');
    kalibCanvas.addEventListener('click', kalibTipp);
    document.getElementById('linse-kalib-zurueck').addEventListener('click', function () {
      kalibPunkte.pop();
      kalibZeichnen();
    });
    document.getElementById('linse-kalib-ok').addEventListener('click', kalibFertig);
    kalibZeichnen();
  }

  /* Tipp auf das Bild -> Videopixel. Das Video liegt mit object-fit:contain
     im Rahmen, also erst den schwarzen Rand herausrechnen. */
  function kalibTipp(ev) {
    if (kalibPunkte.length >= 4) return;
    var r = kalibCanvas.getBoundingClientRect();
    var vw = kalibVideo.videoWidth, vh = kalibVideo.videoHeight;
    if (!vw || !vh) return;
    var skala = Math.min(r.width / vw, r.height / vh);
    var dx = (r.width - vw * skala) / 2, dy = (r.height - vh * skala) / 2;
    var x = (ev.clientX - r.left - dx) / skala;
    var y = (ev.clientY - r.top - dy) / skala;
    if (x < 0 || y < 0 || x > vw || y > vh) return;
    kalibPunkte.push({ x: x, y: y });
    kalibZeichnen();
  }

  function kalibZeichnen() {
    var text = document.getElementById('linse-kalib-text');
    if (kalibPunkte.length < 4) {
      text.textContent = 'Tippe Punkt ' + (kalibPunkte.length + 1) + ' von 4: ' + KALIB_TEXT[kalibPunkte.length];
    } else {
      text.textContent = 'Sitzt das Gitter auf dem Board? Sonst "Punkt zurueck".';
    }
    document.getElementById('linse-kalib-ok').disabled = kalibPunkte.length < 4;

    var r = kalibCanvas.getBoundingClientRect();
    kalibCanvas.width = r.width; kalibCanvas.height = r.height;
    var ctx = kalibCanvas.getContext('2d');
    ctx.clearRect(0, 0, r.width, r.height);
    var vw = kalibVideo.videoWidth, vh = kalibVideo.videoHeight;
    if (!vw || !vh) return;
    var skala = Math.min(r.width / vw, r.height / vh);
    var dx = (r.width - vw * skala) / 2, dy = (r.height - vh * skala) / 2;
    var zeige = function (p) { return { x: p.x * skala + dx, y: p.y * skala + dy }; };

    ctx.strokeStyle = '#39d98a'; ctx.fillStyle = '#39d98a'; ctx.lineWidth = 1.5;
    kalibPunkte.forEach(function (p, i) {
      var s = zeige(p);
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y);
      ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10); ctx.stroke();
      ctx.font = '13px sans-serif';
      ctx.fillText(String(i + 1), s.x + 8, s.y - 8);
    });

    if (kalibPunkte.length === 4) {
      var h = homographie(KALIB, kalibPunkte);   // Board -> Videopixel
      if (!h) { text.textContent = 'Die Punkte liegen zu nah beieinander - bitte neu tippen.'; return; }
      ctx.strokeStyle = 'rgba(57,217,138,.85)'; ctx.lineWidth = 1;
      var ringe = [RINGE.bull, RINGE.tripleIn, RINGE.tripleOut, RINGE.doubleIn, RINGE.doubleOut];
      ringe.forEach(function (radius) {
        ctx.beginPath();
        for (var i = 0; i <= 72; i++) {
          var b2 = i / 72 * 2 * Math.PI;
          var p = anwenden(h, radius * Math.sin(b2), radius * Math.cos(b2));
          var s2 = zeige(p);
          if (i === 0) ctx.moveTo(s2.x, s2.y); else ctx.lineTo(s2.x, s2.y);
        }
        ctx.stroke();
      });
      for (var g = 9; g < 360; g += 18) {
        var b3 = g * Math.PI / 180;
        var innen = anwenden(h, RINGE.bull * Math.sin(b3), RINGE.bull * Math.cos(b3));
        var aussen = anwenden(h, RINGE.doubleOut * Math.sin(b3), RINGE.doubleOut * Math.cos(b3));
        var si = zeige(innen), sa = zeige(aussen);
        ctx.beginPath(); ctx.moveTo(si.x, si.y); ctx.lineTo(sa.x, sa.y); ctx.stroke();
      }
    }
  }

  function kalibFertig() {
    /* Punkte von Videopixeln in Analyse-Koordinaten umrechnen und merken. */
    var f = ANALYSE_BREIT / kalibVideo.videoWidth;
    punkte = kalibPunkte.map(function (p) { return { x: p.x * f, y: p.y * f }; });
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify({ punkte: punkte, breite: kalibVideo.videoWidth }));
    } catch (e) { /* dann eben je Sitzung neu */ }
    kalibDiv.style.display = 'none';
    kalibVideo.srcObject = null;
    erkennungAn();
  }

  /* ================= Start / Stopp ================= */

  function erkennungAn() {
    H = homographie(punkte, KALIB);
    Hinv = homographie(KALIB, punkte);
    if (!H || !Hinv) { melde('Kalibrierung unbrauchbar - bitte neu.'); kalibrierUi(); return; }

    /* Board-Ausschnitt: Doppelring in Analyse-Koordinaten, plus Luft fuer
       schraeg steckende Darts. */
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < 72; i++) {
      var b = i / 72 * 2 * Math.PI;
      var p = anwenden(Hinv, (RINGE.doubleOut + 20) * Math.sin(b), (RINGE.doubleOut + 20) * Math.cos(b));
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    var hoch = Math.round(ANALYSE_BREIT * video.videoHeight / video.videoWidth);
    roi = {
      x0: Math.max(0, minX | 0), x1: Math.min(ANALYSE_BREIT, Math.ceil(maxX)),
      y0: Math.max(0, minY | 0), y1: Math.min(hoch, Math.ceil(maxY))
    };
    wachRoi = null;

    referenz = schnappschuss(aCanvas, aCtx, ANALYSE_BREIT);
    leer = referenz;
    vorher = null;
    dartMaske = null;
    dartsGesteckt = 0;
    zustand = 'ruhe';
    laeuft = true;
    if (timer) clearInterval(timer);
    timer = setInterval(tick, TAKT_MS);
    melde('Erkennung laeuft - Board frei lassen beim Start.');
  }

  window.DartLinse = {
    start: function (mediaStream, callbacks) {
      stream = mediaStream;
      cb = callbacks;
      if (!video) {
        video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.muted = true;
        aCanvas = document.createElement('canvas'); aCtx = aCanvas.getContext('2d', { willReadFrequently: true });
        wCanvas = document.createElement('canvas'); wCtx = wCanvas.getContext('2d', { willReadFrequently: true });
      }
      video.srcObject = stream;
      var abspielen = video.play();
      if (abspielen && abspielen.catch) abspielen.catch(function () { /* ok */ });

      var warte = setInterval(function () {
        if (!video.videoWidth) return;
        clearInterval(warte);
        /* Gemerkte Kalibrierung passt nur zur selben Aufloesung/Aufstellung. */
        var alt = null;
        try { alt = JSON.parse(localStorage.getItem(SCHLUESSEL) || 'null'); } catch (e) { /* egal */ }
        if (alt && alt.punkte && alt.punkte.length === 4 && alt.breite === video.videoWidth) {
          punkte = alt.punkte;
          erkennungAn();
        } else {
          kalibrierUi();
        }
      }, 100);
    },
    stop: function () {
      laeuft = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (video) video.srcObject = null;
      if (kalibDiv) kalibDiv.style.display = 'none';
    },
    kalibrieren: function () {
      laeuft = false;
      if (timer) { clearInterval(timer); timer = null; }
      kalibrierUi();
    },
    /* Fuer Tests und die spaetere Modell-Stufe. */
    _intern: { homographie: homographie, anwenden: anwenden, wertung: wertung, KALIB: KALIB }
  };
})();
