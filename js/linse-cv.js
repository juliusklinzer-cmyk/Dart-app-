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

  var bewegtSeit = 0;
  var wacheRef = null;     // Wache-Bild vom Stand der letzten Analyse
  var stillAnders = 0;     // Ticks, in denen still etwas Neues im Bild steckt
  function tick() {
    if (!laeuft || !video || video.readyState < 2) return;
    var klein = schnappschussWache();
    if (!klein) return;
    if (!vorher) { vorher = klein; wacheRef = klein; return; }
    var bewegung = bewegungsWert(vorher, klein);
    vorher = klein;

    if (zustand === 'ruhe') {
      /* Schon eine Handvoll wirklich veraenderter Pixel ist ein Ereignis -
         ein Dart ist im Wache-Bild nur ein duenner Strich. */
      if (bewegung > 5) { zustand = 'bewegt'; bewegtSeit = Date.now(); ruhigSeit = 0; return; }
      /* Sicherheitsnetz: entgeht der Wache der kurze Einschlag-Moment,
         steht der Dart trotzdem im Bild - der Vergleich mit dem Stand der
         letzten Analyse findet ihn ein paar Ticks spaeter. Die Analyse
         setzt wacheRef neu, ein Schatten loest also keine Schleife aus. */
      if (wacheRef && bewegungsWert(wacheRef, klein) > 4) {
        stillAnders++;
        if (stillAnders >= 3) { stillAnders = 0; wacheRef = klein; analysiere(); }
      } else {
        stillAnders = 0;
      }
      return;
    }
    /* bewegt: warten bis das Bild wieder steht (Board schwingt kurz nach).
       Kommt es minutenlang nicht zur Ruhe (Rauschen, zuckende Belichtung),
       analysieren wir trotzdem, statt stumm zu haengen. */
    if (bewegung > 3 && Date.now() - bewegtSeit < 8000) { ruhigSeit = 0; return; }
    ruhigSeit++;
    if (ruhigSeit < RUHE_BILDER) return;
    zustand = 'ruhe';
    ruhigSeit = 0;
    stillAnders = 0;
    wacheRef = klein;
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
  /* Wie viele Pixel im Board-Ausschnitt sich WIRKLICH geaendert haben.
     Der Mittelwert taugt hier nichts: ein steckender Dart aendert nur einen
     duennen Strich und ginge im Durchschnitt unter. Vorher wird die
     Belichtungsdrift (iPhone regelt staendig nach) herausgerechnet, sonst
     zaehlt jede Blendenkorrektur als Grossbewegung. */
  function bewegungsWert(alt, neu) {
    var s = 0, n = 0, x, y, i;
    for (y = wachRoi.y0; y < wachRoi.y1; y++) {
      for (x = wachRoi.x0; x < wachRoi.x1; x++) {
        i = y * neu.b + x;
        s += neu.g[i] - alt.g[i]; n++;
      }
    }
    if (!n) return 0;
    var drift = s / n;
    var anders = 0;
    for (y = wachRoi.y0; y < wachRoi.y1; y++) {
      for (x = wachRoi.x0; x < wachRoi.x1; x++) {
        i = y * neu.b + x;
        var d = neu.g[i] - alt.g[i] - drift;
        if (d > 18 || d < -18) anders++;
      }
    }
    return anders;
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

  /* ================= Automatische Board-Erkennung =================
     Statt vier Punkte muehsam anzutippen, findet die Linse das Board selbst:
     Doppel- und Triple-Ring sind rot/gruen - alle farbigen Pixel zusammen
     zeichnen den Umriss des Doppelrings nach. Daran wird eine Ellipse
     gepasst (Mittelpunkt + Form), und der Rot/Gruen-Wechsel alle 18 Grad
     verraet die Drehung. Einzige Annahme: die 20 haengt oben und die Kamera
     ist nicht staerker als ~18 Grad verdreht - auf dem Stativ immer wahr.
     Das Antippen bleibt als Ausweg, wenn Licht oder Board nicht mitspielen. */

  function farbBild() {
    var b = ANALYSE_BREIT;
    var h = Math.round(b * video.videoHeight / video.videoWidth) || 1;
    aCanvas.width = b; aCanvas.height = h;
    aCtx.drawImage(video, 0, 0, b, h);
    var d = aCtx.getImageData(0, 0, b, h).data;
    var maske = new Uint8Array(b * h);   // 0 nichts, 1 rot, 2 gruen
    for (var i = 0, j = 0; j < maske.length; i += 4, j++) {
      var r = d[i], g = d[i + 1], bl = d[i + 2];
      if (r > 70 && r > 1.35 * g && r > 1.35 * bl) maske[j] = 1;
      else if (g > 50 && g > 1.2 * r && g > 1.2 * bl) maske[j] = 2;
    }
    return { maske: maske, b: b, h: h };
  }

  /* Ellipse durch Punkte, kleinste Quadrate ueber die Kegelschnittform
     Ax^2+Bxy+Cy^2+Dx+Ey=1. Vorher auf Schwerpunkt/Streuung normiert, sonst
     ist das Gleichungssystem bei Pixelkoordinaten schlecht konditioniert.
     Ergebnis: Mittelpunkt + symmetrische 2x2-Matrix M, die den Einheitskreis
     auf die Ellipse abbildet. */
  function passeEllipse(pts) {
    var n = pts.length, i;
    if (n < 12) return null;
    var cx0 = 0, cy0 = 0;
    for (i = 0; i < n; i++) { cx0 += pts[i].x; cy0 += pts[i].y; }
    cx0 /= n; cy0 /= n;
    var s0 = 0;
    for (i = 0; i < n; i++) s0 += Math.sqrt((pts[i].x - cx0) * (pts[i].x - cx0) + (pts[i].y - cy0) * (pts[i].y - cy0));
    s0 = s0 / n || 1;

    var NTN = [], NTb = [0, 0, 0, 0, 0], zi, zj;
    for (i = 0; i < 5; i++) NTN.push([0, 0, 0, 0, 0]);
    for (i = 0; i < n; i++) {
      var x = (pts[i].x - cx0) / s0, y = (pts[i].y - cy0) / s0;
      var zeile = [x * x, x * y, y * y, x, y];
      for (zi = 0; zi < 5; zi++) {
        NTb[zi] += zeile[zi];
        for (zj = 0; zj < 5; zj++) NTN[zi][zj] += zeile[zi] * zeile[zj];
      }
    }
    var v = loese(NTN, NTb);
    if (!v) return null;
    var A = v[0], B = v[1], C = v[2], Dk = v[3], E = v[4], F = -1;
    var det = 4 * A * C - B * B;
    if (det <= 1e-9) return null;                       // kein geschlossener Kegelschnitt
    var mx = (B * E - 2 * C * Dk) / det;
    var my = (B * Dk - 2 * A * E) / det;
    var Fc = F + (Dk * mx + E * my) / 2;
    if (-Fc <= 0) return null;
    var N00 = A / -Fc, N01 = B / 2 / -Fc, N11 = C / -Fc;
    var tr2 = (N00 + N11) / 2;
    var dd = Math.sqrt((N00 - N11) * (N00 - N11) / 4 + N01 * N01);
    var l1 = tr2 + dd, l2 = tr2 - dd;
    if (l2 <= 1e-12) return null;
    var a1 = 1 / Math.sqrt(l1), a2 = 1 / Math.sqrt(l2);   // Halbachsen (normiert)
    var ex = N01, ey = l1 - N00;                          // Eigenvektor zu l1
    var el = Math.sqrt(ex * ex + ey * ey);
    if (el < 1e-9) { ex = 1; ey = 0; } else { ex /= el; ey /= el; }
    /* M = V diag(a1,a2) V^T, dann zurueck in Pixel skalieren. */
    var m00 = (ex * ex * a1 + ey * ey * a2) * s0;
    var m01 = (ex * ey * (a1 - a2)) * s0;
    var m11 = (ey * ey * a1 + ex * ex * a2) * s0;
    var rMin = Math.min(a1, a2) * s0, rMax = Math.max(a1, a2) * s0;
    return {
      cx: cx0 + mx * s0, cy: cy0 + my * s0,
      m00: m00, m01: m01, m10: m01, m11: m11,
      rMin: rMin, rMax: rMax
    };
  }

  /* Board-Koordinate (Winkel ab 12 Uhr, Radius in mm) -> Bildpunkt, ueber
     die gepasste Ellipse plus Drehung phi. Das y-Minus ist der Wechsel von
     Board-y (nach oben) zu Bild-y (nach unten). */
  function boardZuBild(ell, phiGrad, thetaGrad, rMm) {
    var t = (thetaGrad + phiGrad) * Math.PI / 180;
    var ux = Math.sin(t), uy = -Math.cos(t);
    var s = rMm / RINGE.doubleOut;
    return {
      x: ell.cx + s * (ell.m00 * ux + ell.m01 * uy),
      y: ell.cy + s * (ell.m10 * ux + ell.m11 * uy)
    };
  }

  /* Drehung finden: rund um Doppel- und Triple-Ring muss rot/gruen im
     18-Grad-Takt zum Sektormuster passen (20er-Sektor = rot). */
  function phaseFinden(fb, ell) {
    var beste = null, besteWert = 0;
    for (var phi = -18; phi < 18; phi += 0.5) {
      var passt = 0, gesamt = 0;
      for (var theta = 0; theta < 360; theta += 2) {
        var erwartet = (Math.floor(((theta + 9) % 360) / 18) % 2 === 0) ? 1 : 2;
        for (var ri = 0; ri < 2; ri++) {
          var p = boardZuBild(ell, phi, theta, ri === 0 ? 103 : 166);
          var px = p.x | 0, py = p.y | 0;
          if (px < 0 || py < 0 || px >= fb.b || py >= fb.h) continue;
          var wert = fb.maske[py * fb.b + px];
          if (!wert) continue;
          gesamt++;
          passt += wert === erwartet ? 1 : -1;
        }
      }
      if (gesamt < 120) continue;                        // Ringe kaum getroffen
      var quote = passt / gesamt;
      if (beste === null || quote > besteWert) { beste = phi; besteWert = quote; }
    }
    /* 0.5 heisst: klar mehr Treffer als Fehltreffer - darunter ist es
       geraten, und geraten kalibrieren wir nicht. */
    if (beste === null || besteWert < 0.5) return null;
    return { phi: beste, guete: besteWert };
  }

  function autoErkennen() {
    if (!video || !video.videoWidth) return null;
    return autoAusMaske(farbBild());
  }

  /* Vom Kamerabild getrennt, damit die Pipeline auch mit einer kuenstlich
     gezeichneten Scheibe pruefbar ist (tests/konto.mjs). */
  function autoAusMaske(fb) {
    var xs = [], ys = [], i, x, y;
    for (y = 0; y < fb.h; y += 2) {
      for (x = 0; x < fb.b; x += 2) if (fb.maske[y * fb.b + x]) { xs.push(x); ys.push(y); }
    }
    if (xs.length < 400) return null;                    // kaum Farbe im Bild

    /* Ausreisser (rotes Plakat, Kleidung) abschuetteln: den Schwerpunkt
       suchen und alles weit Draussenliegende zweimal wegschneiden. */
    var cx = 0, cy = 0;
    for (var runde = 0; runde < 3; runde++) {
      cx = 0; cy = 0;
      for (i = 0; i < xs.length; i++) { cx += xs[i]; cy += ys[i]; }
      cx /= xs.length; cy /= xs.length;
      if (runde === 2) break;
      var radien = [];
      for (i = 0; i < xs.length; i++) radien.push(Math.sqrt((xs[i] - cx) * (xs[i] - cx) + (ys[i] - cy) * (ys[i] - cy)));
      var sortiert = radien.slice().sort(function (a, b) { return a - b; });
      var grenze = sortiert[Math.floor(sortiert.length * 0.88)] * 1.35;
      var nx = [], ny = [];
      for (i = 0; i < xs.length; i++) if (radien[i] <= grenze) { nx.push(xs[i]); ny.push(ys[i]); }
      xs = nx; ys = ny;
      if (xs.length < 400) return null;
    }

    /* Je Winkel-Fach der aeusserste farbige Pixel = Aussenkante Doppelring. */
    var F = 72;
    var randR = new Array(F).fill(0), randP = new Array(F).fill(null);
    for (i = 0; i < xs.length; i++) {
      var w = Math.atan2(ys[i] - cy, xs[i] - cx);
      var fach = (Math.floor((w / (2 * Math.PI)) * F) % F + F) % F;
      var r = Math.sqrt((xs[i] - cx) * (xs[i] - cx) + (ys[i] - cy) * (ys[i] - cy));
      if (r > randR[fach]) { randR[fach] = r; randP[fach] = { x: xs[i], y: ys[i] }; }
    }
    /* Faecher, die deutlich aus der Reihe tanzen (uebersehener Ausreisser
       oder Luecke), fliegen raus - der Median der Nachbarn entscheidet. */
    var kanten = [];
    for (i = 0; i < F; i++) {
      if (!randP[i]) continue;
      var nachbarn = [];
      for (var o = -3; o <= 3; o++) { var idx = (i + o + F) % F; if (randR[idx]) nachbarn.push(randR[idx]); }
      nachbarn.sort(function (a, b) { return a - b; });
      var median = nachbarn[nachbarn.length >> 1];
      if (Math.abs(randR[i] - median) <= median * 0.2) kanten.push(randP[i]);
    }
    if (kanten.length < 44) return null;

    var ell = passeEllipse(kanten);
    if (!ell) return null;
    if (ell.rMin < 60 || ell.rMin / ell.rMax < 0.5) return null;   // zu klein oder zu schraeg
    if (ell.cx < 0 || ell.cy < 0 || ell.cx > fb.b || ell.cy > fb.h) return null;

    var phase = phaseFinden(fb, ell);
    if (!phase) return null;

    var punkte4 = [9, 99, 189, 279].map(function (g) {
      return boardZuBild(ell, phase.phi, g, RINGE.doubleOut);
    });
    return { punkte: punkte4, guete: phase.guete };
  }

  /* ================= Kalibrier-Ansicht ================= */

  var kalibDiv = null;
  var kalibVideo = null;
  var kalibCanvas = null;
  var kalibPunkte = [];      // in Videopixeln
  var kalibModus = 'auto';   // 'auto' erkennt selbst, 'hand' laesst tippen
  var kalibHinweis = '';

  function kalibrierUi() {
    kalibPunkte = [];
    kalibModus = 'auto';
    kalibHinweis = '';
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
        '<button id="linse-kalib-modus" style="flex:1;padding:12px;border-radius:10px;border:1px solid #33475c;' +
          'background:#1a2632;color:#dfe9f2;font-size:15px"></button>' +
        '<button id="linse-kalib-zurueck" style="flex:1;padding:12px;border-radius:10px;border:1px solid #33475c;' +
          'background:#1a2632;color:#dfe9f2;font-size:15px"></button>' +
        '<button id="linse-kalib-ok" style="flex:1;padding:12px;border-radius:10px;border:0;' +
          'background:#2f74c0;color:#fff;font-size:15px" disabled>Passt</button>' +
      '</div>';
    kalibVideo = document.getElementById('linse-kalib-video');
    kalibVideo.srcObject = stream;
    var abspielen = kalibVideo.play();
    if (abspielen && abspielen.catch) abspielen.catch(function () { /* ok */ });
    kalibCanvas = document.getElementById('linse-kalib-canvas');
    kalibCanvas.addEventListener('click', kalibTipp);
    document.getElementById('linse-kalib-modus').addEventListener('click', function () {
      if (kalibModus === 'hand') { kalibModus = 'auto'; autoVersuch(); }
      else { kalibModus = 'hand'; kalibPunkte = []; kalibHinweis = ''; kalibZeichnen(); }
    });
    document.getElementById('linse-kalib-zurueck').addEventListener('click', function () {
      if (kalibModus === 'hand') { kalibPunkte.pop(); kalibZeichnen(); }
      else autoVersuch();
    });
    document.getElementById('linse-kalib-ok').addEventListener('click', kalibFertig);
    kalibZeichnen();
    /* Kurz warten, bis das Vorschaubild steht, dann selbst suchen. */
    setTimeout(autoVersuch, 400);
  }

  /* Automatisch erkennen; klappt es nicht, bleibt das Tippen. Die gefundenen
     Punkte gehen durch exakt denselben Weg wie von Hand getippte - das
     Gitter zur Kontrolle und der "Passt"-Knopf sind dieselben. */
  var autoWarte = 0;
  function autoVersuch() {
    if (kalibModus !== 'auto') return;
    /* Direkt nach dem Einschalten liefert die Kamera noch kein Bild -
       kurz warten statt gleich aufzugeben. */
    if ((!video || !video.videoWidth) && autoWarte < 15) {
      autoWarte++;
      setTimeout(autoVersuch, 300);
      return;
    }
    autoWarte = 0;
    kalibHinweis = '';
    var erg = null;
    try { erg = autoErkennen(); } catch (e) { erg = null; }
    if (erg && video.videoWidth) {
      var f = video.videoWidth / ANALYSE_BREIT;
      kalibPunkte = erg.punkte.map(function (p) { return { x: p.x * f, y: p.y * f }; });
    } else {
      kalibPunkte = [];
      kalibModus = 'hand';
      kalibHinweis = 'Board nicht sicher erkannt (Licht? Abstand?) - bitte die 4 Punkte antippen.';
    }
    kalibZeichnen();
  }

  /* Tipp auf das Bild -> Videopixel. Das Video liegt mit object-fit:contain
     im Rahmen, also erst den schwarzen Rand herausrechnen. */
  function kalibTipp(ev) {
    if (kalibModus !== 'hand' || kalibPunkte.length >= 4) return;
    var r = kalibCanvas.getBoundingClientRect();
    var vw = kalibVideo.videoWidth, vh = kalibVideo.videoHeight;
    if (!vw || !vh) return;
    var skala = Math.min(r.width / vw, r.height / vh);
    var dx = (r.width - vw * skala) / 2, dy = (r.height - vh * skala) / 2;
    var x = (ev.clientX - r.left - dx) / skala;
    var y = (ev.clientY - r.top - dy) / skala;
    if (x < 0 || y < 0 || x > vw || y > vh) return;
    kalibHinweis = '';
    kalibPunkte.push({ x: x, y: y });
    kalibZeichnen();
  }

  function kalibZeichnen() {
    var text = document.getElementById('linse-kalib-text');
    if (kalibHinweis) {
      text.textContent = kalibHinweis;
    } else if (kalibModus === 'auto') {
      text.textContent = kalibPunkte.length === 4
        ? 'Board erkannt - sitzt das gruene Gitter? Dann "Passt".'
        : 'Board wird gesucht...';
    } else if (kalibPunkte.length < 4) {
      text.textContent = 'Tippe Punkt ' + (kalibPunkte.length + 1) + ' von 4: ' + KALIB_TEXT[kalibPunkte.length];
    } else {
      text.textContent = 'Sitzt das Gitter auf dem Board? Sonst "Punkt zurueck".';
    }
    var modusKnopf = document.getElementById('linse-kalib-modus');
    var zurueckKnopf = document.getElementById('linse-kalib-zurueck');
    if (modusKnopf) modusKnopf.textContent = kalibModus === 'hand' ? 'Automatisch' : 'Von Hand';
    if (zurueckKnopf) zurueckKnopf.textContent = kalibModus === 'hand' ? 'Punkt zurueck' : 'Nochmal suchen';
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
    _intern: {
      homographie: homographie, anwenden: anwenden, wertung: wertung, KALIB: KALIB,
      passeEllipse: passeEllipse, boardZuBild: boardZuBild, autoAusMaske: autoAusMaske
    }
  };
})();
