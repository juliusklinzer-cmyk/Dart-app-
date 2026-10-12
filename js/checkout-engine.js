/*
 * Checkout-Engine: Finish-Tabellen aus einem Treffermodell.
 *
 * Portierung von docs/finishwege/referenz/checkout_referenz.py, die fuer
 * Regeln und Konstanten massgeblich bleibt. Jeder Wurf streut normalverteilt
 * um seinen Zielpunkt auf einem Board mit Originalmassen. In jedem Zustand
 * (Rest, Darts in der Hand) waehlt die Engine den Zielpunkt, der die
 * erwartete Zahl an Aufnahmen bis zum Finish minimiert; die Variante
 * "checkout" maximiert stattdessen die Chance, in dieser Aufnahme
 * auszuchecken.
 *
 * Unterschied zur Referenz: das Trefferbild entsteht nicht per Monte Carlo,
 * sondern durch Integration der Normalverteilung auf einem Gitter. Das ist
 * deterministisch, auf jedem Geraet gleich und genauer als die Million
 * Stichproben der Referenz. Abweichungen in den Tabellen gibt es deshalb
 * nur bei Fast-Gleichstaenden.
 *
 * Gerechnet wird einmal im Profil (Web Worker), das Ergebnis ist eine
 * Tabelle je Spieler im Format von js/checkout.js. Diese Datei hat keine
 * DOM-Zugriffe und laeuft in Node, im Worker und im Browser.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* 1. Board (Steeldart, Masse in mm)                                 */
  /* ---------------------------------------------------------------- */

  var ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  var R_BULL = 6.35, R_25 = 15.9, R_T_IN = 99.0, R_T_OUT = 107.0, R_D_IN = 162.0, R_D_OUT = 170.0;

  /* Ergebnis-Indizes: 0 daneben, 1..20 Single, 21..40 Doppel, 41..60 Triple,
     61 = 25, 62 = Bull (50, zaehlt als Doppel) */
  var NO = 63;
  var VAL = new Int32Array(NO), DBL = new Uint8Array(NO);
  (function () {
    for (var n = 1; n <= 20; n++) {
      VAL[n] = n; VAL[20 + n] = 2 * n; DBL[20 + n] = 1; VAL[40 + n] = 3 * n;
    }
    VAL[61] = 25; VAL[62] = 50; DBL[62] = 1;
  })();

  var DEG = 180 / Math.PI;

  /** Ergebnis-Index fuer einen Treffer (x nach rechts, y nach oben, Ursprung Bull). */
  function ergebnis(x, y) {
    var r = Math.sqrt(x * x + y * y);
    if (r > R_D_OUT) return 0;
    if (r <= R_BULL) return 62;
    if (r <= R_25) return 61;
    var phi = (90 - Math.atan2(y, x) * DEG) % 360;
    if (phi < 0) phi += 360;
    var num = ORDER[Math.floor((phi + 9) / 18) % 20];
    if (r > R_T_IN && r <= R_T_OUT) return 40 + num;
    if (r > R_D_IN) return 20 + num;
    return num;
  }

  function winkel(n) { return (90 - 18 * ORDER.indexOf(n)) * Math.PI / 180; }

  /* ---------------------------------------------------------------- */
  /* 2. Zielpunkte (81): Triple, Doppel, Single aussen und innen, Zentrum */
  /* ---------------------------------------------------------------- */

  var AIMS = [], AIM_IDX = {};
  (function () {
    var n, a;
    for (n = 1; n <= 20; n++) { a = winkel(n); AIMS.push({ label: 'T' + n, art: 'T', n: n, x: 103 * Math.cos(a), y: 103 * Math.sin(a) }); }
    for (n = 1; n <= 20; n++) { a = winkel(n); AIMS.push({ label: 'D' + n, art: 'D', n: n, x: 166 * Math.cos(a), y: 166 * Math.sin(a) }); }
    for (n = 1; n <= 20; n++) { a = winkel(n); AIMS.push({ label: 'SO' + n, art: 'S', n: n, x: 134.5 * Math.cos(a), y: 134.5 * Math.sin(a) }); }
    for (n = 1; n <= 20; n++) { a = winkel(n); AIMS.push({ label: 'SI' + n, art: 'S', n: n, x: 57.5 * Math.cos(a), y: 57.5 * Math.sin(a) }); }
    AIMS.push({ label: 'C', art: 'C', n: 25, x: 0, y: 0 });
    for (var i = 0; i < AIMS.length; i++) AIM_IDX[AIMS[i].label] = i;
  })();
  var NA = AIMS.length;
  var C_IDX = AIM_IDX.C;

  /* ---------------------------------------------------------------- */
  /* 3. Spielerprofil                                                  */
  /* ---------------------------------------------------------------- */

  var REFERENZ = {
    sigma_x: 12.0,     // waagrechte Streuung in mm (gilt fuer T20, T19 und Singles)
    sigma_y: 12.0,     // senkrechte Streuung in mm
    f_triple: 1.0,     // Faktor fuer Triples ausser T20 und T19
    f_doppel: 1.0,     // Faktor fuer Doppel, die kein Favorit sind
    f_bull: 1.0,       // Faktor fuer das Zentrum (Bull und 25)
    favoriten: [],     // Doppel-Zahlen der Lieblingsgruppe(n), 25 steht fuer Bull
    f_fav: 0.8,        // Favoriten streuen um diesen Faktor weniger
    ziel: 'aufnahmen'  // "aufnahmen" oder "checkout"
  };

  function profil(p) {
    var out = {};
    for (var k in REFERENZ) out[k] = p && p[k] !== undefined && p[k] !== null ? p[k] : REFERENZ[k];
    out.favoriten = (out.favoriten || []).map(Number);
    ['sigma_x', 'sigma_y', 'f_triple', 'f_doppel', 'f_bull', 'f_fav'].forEach(function (k) {
      out[k] = Number(out[k]);
      if (!(out[k] > 0) || !isFinite(out[k])) throw new Error('Profilwert ' + k + ' fehlt oder ist nicht positiv');
    });
    if (out.sigma_x < 1 || out.sigma_x > 60 || out.sigma_y < 1 || out.sigma_y > 60) throw new Error('Streuung ausserhalb von 1 bis 60 mm');
    if (out.favoriten.some(function (f) { return !(f >= 1 && f <= 20) && f !== 25; })) throw new Error('Favorit muss ein Doppel 1 bis 20 oder 25 (Bull) sein');
    if (out.ziel !== 'aufnahmen' && out.ziel !== 'checkout') throw new Error('Spielweise muss aufnahmen oder checkout sein');
    return out;
  }

  /* Halbierungsketten fuer die Wahl der Lieblingsgruppe */
  var GRUPPEN = {
    D20: [20, 10, 5],
    D16: [16, 8, 4, 2, 1],
    D18: [18, 9],
    D12: [12, 6, 3],
    D14: [14, 7],
    Bull: [25]
  };

  /* ---------------------------------------------------------------- */
  /* 4. Trefferbild: Wahrscheinlichkeit jedes Ergebnisses je Zielpunkt */
  /* ---------------------------------------------------------------- */

  /*
   * Integration: in x ein Gitter aus K Spalten (jede Spalte traegt die exakte
   * Masse ihres Streifens), entlang y exakt ueber die Normalverteilung: die
   * Spalte wird an allen Grenzen (sechs Kreise, zehn Sektorlinien) geteilt,
   * jedes Stueck liegt in genau einem Feld, seine Masse ist eine Differenz
   * der Verteilungsfunktion. Ein reines Punktgitter war an den Sektorlinien
   * um bis zu 0,002 daneben.
   */
  var SPANNE = 4.5;   // Spalten bis 4,5 Streuungen vom Zielpunkt
  var K_FEIN = 1600;  // Spalten je Verteilung (Bull-Rand braucht feine Spalten)
  var RADIEN = [R_BULL, R_25, R_T_IN, R_T_OUT, R_D_IN, R_D_OUT];
  var TANS = [];      // Steigungen der zehn Sektorlinien (9, 27, ... Grad von oben)
  for (var _k = 0; _k < 10; _k++) TANS.push(Math.tan((90 - (9 + 18 * _k)) * Math.PI / 180));

  /* Komplementaere Fehlerfunktion (Chebyshev-Naeherung, relativer Fehler unter 1,2e-7). */
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function Phi(z) { return 0.5 * erfc(-z / Math.SQRT2); }

  var gitterCache = {};
  function gitter(K) {
    if (gitterCache[K]) return gitterCache[K];
    var z = new Float64Array(K), w = new Float64Array(K), h = 2 * SPANNE / K;
    for (var i = 0; i < K; i++) {
      z[i] = -SPANNE + (i + 0.5) * h;
      var lo = i === 0 ? -Infinity : z[i] - h / 2, hi = i === K - 1 ? Infinity : z[i] + h / 2;
      w[i] = (hi === Infinity ? 1 : Phi(hi)) - (lo === -Infinity ? 0 : Phi(lo));
    }
    return (gitterCache[K] = { z: z, w: w });
  }

  /** Ergebnis-Verteilung fuer einen Wurf auf (x, y) mit Streuung sx, sy. */
  function verteilung(x, y, sx, sy, K) {
    var g = gitter(K || K_FEIN), z = g.z, w = g.w, n = z.length;
    var out = new Float64Array(NO), grenzen = new Float64Array(22);
    for (var i = 0; i < n; i++) {
      var xi = x + sx * z[i], wi = w[i], m = 0, k;
      for (k = 0; k < RADIEN.length; k++) {
        var R = RADIEN[k];
        if (Math.abs(xi) < R) { var h = Math.sqrt(R * R - xi * xi); grenzen[m++] = h; grenzen[m++] = -h; }
      }
      for (k = 0; k < TANS.length; k++) grenzen[m++] = xi * TANS[k];
      var ys = grenzen.subarray(0, m).sort();
      var prev = -Infinity, prevPhi = 0;
      for (var j = 0; j <= m; j++) {
        var b = j < m ? ys[j] : Infinity;
        var phiB = j < m ? Phi((b - y) / sy) : 1;
        var masse = phiB - prevPhi;
        if (masse > 0) {
          var mitte = prev === -Infinity ? b - 1 : b === Infinity ? prev + 1 : 0.5 * (prev + b);
          out[ergebnis(xi, mitte)] += wi * masse;
        }
        prev = b; prevPhi = phiB;
      }
    }
    return out;
  }

  function faktor(p, aim) {
    if (aim.art === 'T') return aim.n === 19 || aim.n === 20 ? 1 : p.f_triple;
    if (aim.art === 'D') return p.f_doppel * (p.favoriten.indexOf(aim.n) >= 0 ? p.f_fav : 1);
    if (aim.art === 'C') return p.f_bull * (p.favoriten.indexOf(25) >= 0 ? p.f_fav : 1);
    return 1;
  }

  /** P[a] = Verteilung fuer Zielpunkt a (Array von Float64Array). */
  function trefferbild(p, K) {
    p = profil(p);
    var P = new Array(NA);
    for (var i = 0; i < NA; i++) {
      var f = faktor(p, AIMS[i]);
      P[i] = verteilung(AIMS[i].x, AIMS[i].y, p.sigma_x * f, p.sigma_y * f, K);
    }
    return P;
  }

  /* Duenne Form fuers Rechnen: je Zielpunkt nur die Ergebnisse mit Masse. */
  function duenn(P) {
    var idx = [], val = [];
    for (var a = 0; a < NA; a++) {
      var ii = [], vv = [];
      for (var o = 0; o < NO; o++) if (P[a][o] > 0) { ii.push(o); vv.push(P[a][o]); }
      idx.push(Int32Array.from(ii)); val.push(Float64Array.from(vv));
    }
    return { idx: idx, val: val };
  }

  /* ---------------------------------------------------------------- */
  /* 5. Wege, Finish-Modus, erlaubte Zielpunkte (unabhaengig vom Spieler) */
  /* ---------------------------------------------------------------- */

  var SETUP = [], FIN = [];
  (function () {
    var n;
    for (n = 1; n <= 20; n++) SETUP.push({ label: String(n), wert: n, aims: [AIM_IDX['SO' + n], AIM_IDX['SI' + n]] });
    for (n = 1; n <= 20; n++) SETUP.push({ label: 'T' + n, wert: 3 * n, aims: [AIM_IDX['T' + n]] });
    SETUP.push({ label: '25', wert: 25, aims: [C_IDX] });
    SETUP.push({ label: 'Bull', wert: 50, aims: [C_IDX] });
    for (n = 1; n <= 20; n++) FIN.push({ label: 'D' + n, wert: 2 * n, aims: [AIM_IDX['D' + n]], bull: false });
    FIN.push({ label: 'Bull', wert: 50, aims: [C_IDX], bull: true });
  })();

  /* ROUTES[rest][k] = Liste von { erst: erster Dart (SETUP/FIN-Eintrag), bull } */
  var ROUTES = [];
  (function () {
    var r, k, i, j, f;
    for (r = 0; r <= 170; r++) { ROUTES.push([null, [], [], []]); }
    for (f = 0; f < FIN.length; f++) ROUTES[FIN[f].wert][1].push({ erst: FIN[f], bull: FIN[f].bull });
    for (i = 0; i < SETUP.length; i++) for (f = 0; f < FIN.length; f++) {
      if (SETUP[i].wert + FIN[f].wert <= 170) ROUTES[SETUP[i].wert + FIN[f].wert][2].push({ erst: SETUP[i], bull: FIN[f].bull });
    }
    for (i = 0; i < SETUP.length; i++) for (j = 0; j < SETUP.length; j++) for (f = 0; f < FIN.length; f++) {
      var s = SETUP[i].wert + SETUP[j].wert + FIN[f].wert;
      if (s <= 170) ROUTES[s][3].push({ erst: SETUP[i], bull: FIN[f].bull });
    }
    void k;
  })();

  /** Minimale Dartzahl ohne Bull-Finish (kNB) und mit Bull-Finish (kB). */
  function kMin(r) {
    var kNB = null, kB = null, k, i;
    for (k = 1; k <= 3 && kNB === null; k++) for (i = 0; i < ROUTES[r][k].length; i++) if (!ROUTES[r][k][i].bull) { kNB = k; break; }
    for (k = 1; k <= 3 && kB === null; k++) for (i = 0; i < ROUTES[r][k].length; i++) if (ROUTES[r][k][i].bull) { kB = k; break; }
    return [kNB, kB];
  }

  function finishbar(r, d) {
    if (r < 2 || r > 170 || d <= 0) return false;
    for (var k = 1; k <= d; k++) if (ROUTES[r][k].length) return true;
    return false;
  }

  /* MODE[d][r] = 1: Finish moeglich (nur erste Darts minimaler Wege erlaubt), 0: Stellmodus.
     Regel 1 (hart): wenigste Darts. Bull als Schluss nur, wenn es einen Dart spart oder der einzige Weg ist. */
  var MODE = [null, new Uint8Array(171), new Uint8Array(171), new Uint8Array(171)];
  var MASK = [null, new Uint8Array(171 * NA), new Uint8Array(171 * NA), new Uint8Array(171 * NA)];
  var FIRST25 = [null, new Uint8Array(171), new Uint8Array(171), new Uint8Array(171)];  // "25" unter den ersten Darts?
  (function () {
    function erlauben(d, r, route) {
      for (var i = 0; i < route.erst.aims.length; i++) MASK[d][r * NA + route.erst.aims[i]] = 1;
      if (route.erst.label === '25') FIRST25[d][r] = 1;
    }
    for (var r = 2; r <= 170; r++) {
      var km = kMin(r), kNB = km[0], kB = km[1];
      for (var d = 1; d <= 3; d++) {
        var i, k;
        if (kNB !== null && kNB <= d) {
          for (i = 0; i < ROUTES[r][kNB].length; i++) if (!ROUTES[r][kNB][i].bull) erlauben(d, r, ROUTES[r][kNB][i]);
          for (k = 1; k < kNB; k++) for (i = 0; i < ROUTES[r][k].length; i++) if (ROUTES[r][k][i].bull) erlauben(d, r, ROUTES[r][k][i]);
          MODE[d][r] = 1;
        } else if (kB !== null && kB <= d) {
          for (i = 0; i < ROUTES[r][kB].length; i++) if (ROUTES[r][kB][i].bull) erlauben(d, r, ROUTES[r][kB][i]);
          MODE[d][r] = 1;
        } else {
          for (i = 0; i < NA; i++) {
            var a = AIMS[i];
            if ((a.art === 'S' && a.n <= r - 2) || (a.art === 'T' && 3 * a.n <= r - 2) || (a.art === 'C' && 25 <= r - 2)) MASK[d][r * NA + i] = 1;
          }
          MODE[d][r] = 0;
        }
      }
    }
  })();

  /* Feinregeln (Werte in Aufnahmen) */
  var BULL_DELTA = 0.02;      // Regel 7: Zentrum nur, wenn mindestens so viel besser
  var EPS_FAV = 0.02;         // Regel 3: Weg auf einen Favoriten gewinnt, wenn hoechstens so viel schlechter
  var EPS_STD = 0.01;         // Standardweg bleibt, wenn hoechstens so viel schlechter (nur mit Favoriten)
  var BOGEY_MALUS = 0.01;     // Triple, dessen Single-Fehlwurf mit 2 Darts kein Finish mehr laesst (nur bei 3 Darts)
  var FIRST_DART_PEN = 0.01;  // ab Rest 100 erster Dart T20 oder T19, ausser ein anderes Triple ist klar besser

  var PEN = new Float64Array(NA);  // winziger Gleichstandsbrecher zu vertrauten Zielen
  var BMAL = new Float64Array(171 * NA), FPEN = new Float64Array(171 * NA);
  var ENDCODE_AIM = new Int32Array(NA);  // Doppelzahl bzw. 25 fuer Bull
  var VINT = [null, new Int32Array(171 * NA), new Int32Array(171 * NA), new Int32Array(171 * NA)];
  var FINAIM = [null, new Uint8Array(171 * NA), new Uint8Array(171 * NA), new Uint8Array(171 * NA)];
  (function () {
    var i, r, d, a;
    for (i = 0; i < NA; i++) {
      a = AIMS[i];
      if (a.art === 'T') PEN[i] = a.n === 20 ? 0 : a.n === 19 ? 0.0005 : (a.n >= 16 && a.n <= 18) ? 0.001 : 0.0015;
      else if (a.label.indexOf('SI') === 0) PEN[i] = 0.0002;
      ENDCODE_AIM[i] = a.art === 'D' ? a.n : a.art === 'C' ? 25 : 0;
    }
    for (r = 2; r <= 170; r++) {
      if (MODE[3][r] === 1) for (i = 0; i < NA; i++) {
        a = AIMS[i];
        if (a.art === 'T' && MASK[3][r * NA + i] && !finishbar(r - a.n, 2)) BMAL[r * NA + i] = BOGEY_MALUS;
      }
      if (r >= 100) for (i = 0; i < NA; i++) {
        a = AIMS[i];
        if (a.art === 'T' && a.n !== 19 && a.n !== 20) FPEN[r * NA + i] = FIRST_DART_PEN;
      }
    }
    for (d = 1; d <= 3; d++) for (r = 2; r <= 170; r++) for (i = 0; i < NA; i++) {
      a = AIMS[i];
      var ix = r * NA + i;
      if (a.art === 'T') VINT[d][ix] = 3 * a.n;
      else if (a.art === 'S') VINT[d][ix] = a.n;
      else if (a.art === 'D') { VINT[d][ix] = 2 * a.n; FINAIM[d][ix] = 2 * a.n === r ? 1 : 0; }
      else if (r === 50) { VINT[d][ix] = 50; FINAIM[d][ix] = 1; }
      else if (MODE[d][r] === 1 && !FIRST25[d][r]) VINT[d][ix] = 50;
      else VINT[d][ix] = 25;
    }
  })();

  /* ---------------------------------------------------------------- */
  /* 6. Loesung: erwartete Aufnahmen bis zum Finish minimieren         */
  /* ---------------------------------------------------------------- */

  /*
   * Fuer jeden Startrest S einer Aufnahme (aufsteigend) wird F[S] per
   * Fixpunkt bestimmt, weil ein Bust auf S zurueckfuehrt. In jedem Zustand
   * (s, d) wird der Zielpunkt so gewaehlt:
   *   eff = erwartete weitere Aufnahmen + PEN + (bei 3 Darts: BMAL + FPEN)
   *         + BULL_DELTA fuer das Zentrum
   *   best0 = Minimum von eff ueber die erlaubten Zielpunkte (MASK)
   *   Favoriten: Zielpunkte, deren beabsichtigter Weg auf einem Favoriten
   *     endet und deren eff hoechstens EPS_FAV ueber best0 liegt, bilden
   *     die Kandidaten. Das Zentrum zaehlt nur, wenn best0 schon das Zentrum
   *     ist. Gibt es keinen Kandidaten, sind alle erlaubten Zielpunkte
   *     Kandidaten.
   *   best1 = Minimum von eff ueber die Kandidaten
   *   Standard: liegt der Zielpunkt des Profils ohne Favoriten unter den
   *     Kandidaten und hoechstens EPS_STD ueber best1, bleibt er.
   *
   * Ergebnis: { F, POL, GA, GB, P } mit POL[S][d * (S + 1) + s] = Zielpunkt
   * im Zustand (Rest s, d Darts) einer Aufnahme, die bei S begann; Wert
   * eines Zustands = GA[S][..] + GB[S][..] * F[S].
   */
  function loesen(P, favoriten, polStd, maxS) {
    maxS = maxS || 170;
    var favset = [];
    (favoriten || []).forEach(function (f) { if (favset.indexOf(f) < 0) favset.push(f); });
    var sp = duenn(P), Pidx = sp.idx, Pval = sp.val;
    var F = new Float64Array(maxS + 1);
    var POL = new Array(maxS + 1), GAs = new Array(maxS + 1), GBs = new Array(maxS + 1);
    var A = new Float64Array(NO), B = new Float64Array(NO);
    var eff = new Float64Array(NA), favok = new Uint8Array(NA);

    for (var S = 2; S <= maxS; S++) {
      var S1 = S + 1, n = S - 1;
      var GA = new Float64Array(4 * S1), GB = new Float64Array(4 * S1);
      var pol = new Int16Array(4 * S1), endc = new Int32Array(4 * S1);
      var EA = [null, new Float64Array(n * NA), new Float64Array(n * NA), new Float64Array(n * NA)];
      var EB = [null, new Float64Array(n * NA), new Float64Array(n * NA), new Float64Array(n * NA)];

      /* Erwartungen fuer alle Zielpunkte in Zustand (s, d) aus den Werten der Stufe d - 1. */
      var matrix = function (d) {
        var base = (d - 1) * S1, ea = EA[d], eb = EB[d];
        for (var i = 0; i < n; i++) {
          var s = i + 2, o, a;
          for (o = 0; o < NO; o++) {
            var spv = s - VAL[o];
            if (spv === 0 && DBL[o]) { A[o] = 0; B[o] = 0; }
            else if (spv < 2) { A[o] = 0; B[o] = 1; }
            else { A[o] = GA[base + spv]; B[o] = GB[base + spv]; }
          }
          for (a = 0; a < NA; a++) {
            var idx = Pidx[a], val = Pval[a], x = 0, y = 0;
            for (var k = 0; k < idx.length; k++) { x += A[idx[k]] * val[k]; y += B[idx[k]] * val[k]; }
            ea[i * NA + a] = x; eb[i * NA + a] = y;
          }
        }
      };

      var Fg = S > 2 ? F[S - 1] + 0.3 : 4.0;
      var grund = function () {
        GA.fill(0); GB.fill(0); pol.fill(-1); endc.fill(0);
        for (var s = 2; s < S; s++) GA[s] = F[s];   // Aufnahme vorbei: naechste Aufnahme ab dem Rest
        GB[S] = 1;                                   // nichts gepunktet: wieder ab S
      };
      grund();
      matrix(1);   // Stufe 0 haengt nicht von Fg ab

      for (var iter = 0; iter < 200; iter++) {
        if (iter) grund();
        for (var d = 1; d <= 3; d++) {
          if (d > 1) matrix(d);
          var ea = EA[d], eb = EB[d], base = d * S1, vorher = (d - 1) * S1;
          var maskD = MASK[d], vintD = VINT[d], finD = FINAIM[d], modeD = MODE[d];
          var polS = polStd ? polStd[S] : null;
          for (var i = 0; i < n; i++) {
            var s = i + 2, a, best0 = -1, beff = Infinity;
            for (a = 0; a < NA; a++) {
              if (!maskD[s * NA + a]) { eff[a] = Infinity; continue; }
              var e = ea[i * NA + a] + eb[i * NA + a] * Fg + PEN[a] + (a === C_IDX ? BULL_DELTA : 0);
              if (d === 3) e += BMAL[s * NA + a] + FPEN[s * NA + a];
              eff[a] = e;
              if (e < beff) { beff = e; best0 = a; }
            }
            var anyfav = false;
            if (favset.length) {
              for (a = 0; a < NA; a++) {
                favok[a] = 0;
                if (!maskD[s * NA + a] || (a === C_IDX && best0 !== C_IDX)) continue;
                var vint = vintD[s * NA + a], finm = finD[s * NA + a], ae;
                if (finm) ae = ENDCODE_AIM[a];
                else if (s - vint >= 2) ae = endc[vorher + (s - vint)];
                else ae = 0;
                if (favset.indexOf(ae) >= 0 && eff[a] <= beff + EPS_FAV) { favok[a] = 1; anyfav = true; }
              }
            }
            var best1 = -1, b1 = Infinity;
            for (a = 0; a < NA; a++) {
              var cand = anyfav ? favok[a] : maskD[s * NA + a];
              if (cand && eff[a] < b1) { b1 = eff[a]; best1 = a; }
            }
            var wahl = best1;
            if (polS) {
              var sa = polS[base + s];
              if (sa < 0) sa = 0; else if (sa > NA - 1) sa = NA - 1;
              var saCand = anyfav ? favok[sa] : maskD[s * NA + sa];
              if (saCand && eff[sa] <= b1 + EPS_STD) wahl = sa;
            }
            GA[base + s] = ea[i * NA + wahl];
            GB[base + s] = eb[i * NA + wahl];
            pol[base + s] = wahl;
            var nx = s - vintD[s * NA + wahl];
            var eNext = nx >= 2 ? endc[vorher + nx] : 0;
            endc[base + s] = finD[s * NA + wahl] ? ENDCODE_AIM[wahl] : (modeD[s] === 1 ? eNext : 0);
          }
        }
        var Fnew = (1 + GA[3 * S1 + S]) / (1 - GB[3 * S1 + S]);
        if (Math.abs(Fnew - Fg) < 1e-12) { Fg = Fnew; break; }
        Fg = Fnew;
      }
      F[S] = Fg; POL[S] = pol; GAs[S] = GA; GBs[S] = GB;
    }
    return { P: P, F: F, POL: POL, GA: GAs, GB: GBs };
  }

  /** Label, Wert und ob der Dart finisht, wenn Zielpunkt a wie geplant getroffen wird. */
  function beabsichtigt(a, s, d) {
    var aim = AIMS[a];
    if (aim.art === 'T') return { label: 'T' + aim.n, wert: 3 * aim.n, finish: false };
    if (aim.art === 'S') return { label: String(aim.n), wert: aim.n, finish: false };
    if (aim.art === 'D') return { label: 'D' + aim.n, wert: 2 * aim.n, finish: true };
    if (s === 50) return { label: 'Bull', wert: 50, finish: true };
    if (MODE[d][s] === 1 && !FIRST25[d][s]) return { label: 'Bull', wert: 50, finish: false };
    return { label: '25', wert: 25, finish: false };
  }

  /** Weg ab Rest r mit d Darts (Aufnahme begann bei S). { darts, bleibt } mit bleibt 0 = Finish.
      Bricht bei Rest unter 2 oder fehlender Politik ab (die Referenz liefe weiter, kommt
      dort aber nie hin, weil die Masken keinen Rest 1 oder 0 ohne Finish zulassen). */
  function weg(L, r, d, S, pol) {
    S = S === undefined || S === null ? r : S;
    pol = pol || L.POL[S];
    var S1 = S + 1, steps = [];
    while (d > 0 && r >= 2) {
      var a = pol[d * S1 + r];
      if (a < 0) break;
      var b = beabsichtigt(a, r, d);
      steps.push(b.label);
      r -= b.wert; d--;
      if (b.finish) return { darts: steps, bleibt: 0 };
    }
    return { darts: steps, bleibt: r };
  }

  /** Tabelle: je Rest 3, 2 und 1 Dart sowie Plan B (Single statt Triple bzw. 25 statt Bull). */
  function tabelle(L, polVon) {
    var out = {};
    for (var r = 2; r <= 170; r++) {
      var pol3 = polVon ? polVon(r) : null;
      var w3 = weg(L, r, 3, r, pol3), w2 = weg(L, r, 2, r, pol3), w1 = weg(L, r, 1, r, pol3);
      var pol = pol3 || L.POL[r], first = AIMS[pol[3 * (r + 1) + r]], planB = null;
      if (first.art === 'T' && r - first.n >= 2) {
        var rb = r - first.n, wb = weg(L, rb, 2, r, pol);
        planB = { single: String(first.n), rest: rb, weg: wb.darts, bleibt: wb.bleibt };
      } else if (first.art === 'C' && w3.darts[0] === 'Bull' && r !== 50 && r - 25 >= 2) {
        var rc = r - 25, wc = weg(L, rc, 2, r, pol);
        planB = { single: '25', rest: rc, weg: wc.darts, bleibt: wc.bleibt };
      }
      out[r] = { 3: { weg: w3.darts, bleibt: w3.bleibt }, 2: { weg: w2.darts, bleibt: w2.bleibt }, 1: { weg: w1.darts, bleibt: w1.bleibt }, planB: planB };
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* 7. Zielvariante "checkout": maximale Chance in dieser Aufnahme    */
  /* ---------------------------------------------------------------- */

  /* Liefert eine Funktion polFuer(S): Politik, die die Checkout-Chance der
     Aufnahme maximiert; Gleichstaende (innerhalb tol) entscheidet der
     Aufnahmen-Wert wie in loesen(). */
  function checkoutPolitik(L, tol) {
    tol = tol === undefined ? 0.0005 : tol;
    var P = L.P, sp = duenn(P), Pidx = sp.idx, Pval = sp.val;
    var pf = [new Float64Array(171), new Float64Array(171), new Float64Array(171), new Float64Array(171)];
    var pcv = new Float64Array(NA), eff = new Float64Array(NA), A = new Float64Array(NO), B = new Float64Array(NO);
    var d, s, a, k, o, spv;
    function chance(d, s) {
      for (a = 0; a < NA; a++) {
        var idx = Pidx[a], val = Pval[a], v = 0;
        for (k = 0; k < idx.length; k++) {
          o = idx[k]; spv = s - VAL[o];
          if (spv === 0 && DBL[o]) v += val[k];
          else if (spv >= 2) v += val[k] * pf[d - 1][spv];
        }
        pcv[a] = v;
      }
    }
    for (d = 1; d <= 3; d++) for (s = 2; s <= 170; s++) {
      chance(d, s);
      var m = -1;
      for (a = 0; a < NA; a++) if (MASK[d][s * NA + a] && pcv[a] > m) m = pcv[a];
      pf[d][s] = m;
    }
    return function polFuer(S) {
      var S1 = S + 1, pol = new Int16Array(4 * S1).fill(-1), GA = L.GA[S], GB = L.GB[S], FS = L.F[S];
      for (d = 1; d <= 3; d++) {
        var vorher = (d - 1) * S1;
        for (s = 2; s <= S; s++) {
          chance(d, s);
          for (o = 0; o < NO; o++) {
            spv = s - VAL[o];
            if (spv === 0 && DBL[o]) { A[o] = 0; B[o] = 0; }
            else if (spv < 2) { A[o] = 0; B[o] = 1; }
            else { A[o] = GA[vorher + spv]; B[o] = GB[vorher + spv]; }
          }
          var best = -1;
          for (a = 0; a < NA; a++) if (MASK[d][s * NA + a] && pcv[a] > best) best = pcv[a];
          var wahl = -1, be = Infinity;
          for (a = 0; a < NA; a++) {
            if (!MASK[d][s * NA + a] || pcv[a] < best - tol) continue;
            var idx = Pidx[a], val = Pval[a], x = 0, y = 0;
            for (k = 0; k < idx.length; k++) { x += A[idx[k]] * val[k]; y += B[idx[k]] * val[k]; }
            var e = x + y * FS + PEN[a] + (a === C_IDX ? BULL_DELTA : 0);
            if (d === 3) e += BMAL[s * NA + a] + FPEN[s * NA + a];
            eff[a] = e;
            if (e < be) { be = e; wahl = a; }
          }
          pol[d * S1 + s] = wahl;
        }
      }
      return pol;
    };
  }

  /* ---------------------------------------------------------------- */
  /* 8. Wege bewerten (eigene Eintraege, Top-3-Auswahl)                */
  /* ---------------------------------------------------------------- */

  function tokenAims(t) {
    if (t === 'Bull' || t === '25') return [C_IDX];
    if (t.charAt(0) === 'T' || t.charAt(0) === 'D') return [AIM_IDX[t]];
    return [AIM_IDX['SO' + t], AIM_IDX['SI' + t]];
  }

  function tokenWert(t) {
    if (t === 'Bull') return 50;
    if (t === '25') return 25;
    if (t.charAt(0) === 'T') return 3 * Number(t.slice(1));
    if (t.charAt(0) === 'D') return 2 * Number(t.slice(1));
    return Number(t);
  }

  function kombis(listen) {
    if (!listen.length) return [[]];
    var out = [], rest = kombis(listen.slice(1));
    listen[0].forEach(function (a) { rest.forEach(function (r) { out.push([a].concat(r)); }); });
    return out;
  }

  /*
   * Bewertet einen Weg als Plan: solange die Darts wie geplant fallen, wird
   * der Plan weitergeworfen, nach einem Fehlwurf uebernimmt die berechnete
   * Politik. Ergebnis { aufnahmen: erwartete weitere Aufnahmen nach dieser,
   * checkout: Chance in dieser Aufnahme }. Kleinere Aufnahmen sind besser.
   */
  function wegBewerten(L, r, d, tokens) {
    var S = r, S1 = S + 1, P = L.P, F = L.F, GA = L.GA[S], GB = L.GB[S], pol = L.POL[S];
    var pf = [new Float64Array(S1), new Float64Array(S1), new Float64Array(S1), new Float64Array(S1)];
    var dd, s, o, spv;
    for (dd = 1; dd <= 3; dd++) for (s = 2; s <= S; s++) {
      var p = P[pol[dd * S1 + s]], v = 0;
      for (o = 0; o < NO; o++) {
        if (!p[o]) continue;
        spv = s - VAL[o];
        if (spv === 0 && DBL[o]) v += p[o];
        else if (spv >= 2) v += p[o] * pf[dd - 1][spv];
      }
      pf[dd][s] = v;
    }
    function V(s, dd) { return GA[dd * S1 + s] + GB[dd * S1 + s] * F[S]; }
    var vals = tokens.map(tokenWert), best = null;
    kombis(tokens.map(tokenAims)).forEach(function (combo) {
      function rec(s, dd, k) {
        if (k === null || k >= combo.length) return [V(s, dd), dd > 0 ? pf[dd][s] : 0];
        var p = P[combo[k]], ev = 0, pc = 0;
        for (var o = 0; o < NO; o++) {
          var pr = p[o];
          if (!pr) continue;
          var spo = s - VAL[o];
          if (spo === 0 && DBL[o]) pc += pr;
          else if (spo < 2) ev += pr * F[S];
          else if (dd - 1 === 0) ev += pr * V(spo, 0);
          else {
            var r2 = rec(spo, dd - 1, VAL[o] === vals[k] ? k + 1 : null);
            ev += pr * r2[0]; pc += pr * r2[1];
          }
        }
        return [ev, pc];
      }
      var res = rec(r, d, 0);
      if (!best || res[0] < best[0]) best = res;
    });
    return { aufnahmen: best[0], checkout: best[1] };
  }

  /*
   * Wert eines Wegs nach dem Massstab des Loesers: erwartete Aufnahmen plus
   * die Feinregeln fuer den ersten Dart (PEN, BULL_DELTA, bei 3 Darts Bogey-
   * Malus und T20/T19-Regel). Damit lassen sich zwei Wege so vergleichen,
   * wie loesen() sie verglichen hat.
   */
  function wegWert(L, r, d, tokens) {
    var a = tokenAims(tokens[0])[0], z = PEN[a] + (a === C_IDX ? BULL_DELTA : 0);
    if (d === 3) z += BMAL[r * NA + a] + FPEN[r * NA + a];
    return wegBewerten(L, r, d, tokens).aufnahmen + z;
  }

  /** Die k besten unterschiedlichen Wege fuer (r, d): [{ weg, bleibt, aufnahmen, checkout }]. */
  function alternativen(L, r, d, k) {
    k = k || 3;
    var res = [], seen = {};
    for (var a = 0; a < NA; a++) {
      if (!MASK[d][r * NA + a]) continue;
      var b = beabsichtigt(a, r, d), steps, bleibt;
      if (b.finish) { steps = [b.label]; bleibt = 0; }
      else if (d > 1) { var w = weg(L, r - b.wert, d - 1, r); steps = [b.label].concat(w.darts); bleibt = w.bleibt; }
      else { steps = [b.label]; bleibt = r - b.wert; }
      var key = steps.join(' ');
      if (seen[key]) continue;
      seen[key] = true;
      var bew = wegBewerten(L, r, d, steps);
      res.push({ weg: steps, bleibt: bleibt, aufnahmen: bew.aufnahmen, checkout: bew.checkout });
    }
    res.sort(function (x, y) { return x.aufnahmen - y.aufnahmen; });
    return res.slice(0, k);
  }

  /** Erlaubte Felder: 1 bis 20 (Single), T1 bis T20, D1 bis D20, 25, Bull. */
  function tokenGueltig(t) {
    if (t === '25' || t === 'Bull') return true;
    return /^[TD]?([1-9]|1[0-9]|20)$/.test(t);
  }

  /** Harte Pruefung eines eigenen Eintrags: { ok, fehler, warnungen }. */
  function wegPruefen(r, d, tokens) {
    var fehler = [], warn = [];
    var ungueltig = tokens.filter(function (t) { return !tokenGueltig(t); });
    if (ungueltig.length) return { ok: false, fehler: ['unbekanntes Feld ' + ungueltig.join(', ')], warnungen: [] };
    if (!tokens.length) fehler.push('kein Dart angegeben');
    else if (tokens.length > d) fehler.push('zu viele Darts');
    var rest = r;
    for (var i = 0; i < tokens.length; i++) {
      rest -= tokenWert(tokens[i]);
      var letzter = i === tokens.length - 1;
      if (rest < 0 || rest === 1 || (rest === 0 && !letzter)) { fehler.push('überworfen'); break; }
    }
    if (!fehler.length) {
      var last = tokens[tokens.length - 1];
      if (rest === 0 && !(last === 'Bull' || last.charAt(0) === 'D')) fehler.push('letzter Dart muss ein Doppel oder Bull sein');
      if (rest > 0 && finishbar(r, d)) warn.push('kein Finish, obwohl eins möglich ist');
      var km = kMin(r), ks = km.filter(function (x) { return x !== null; });
      var kmin = ks.length ? Math.min.apply(null, ks) : null;
      if (rest === 0 && kmin && tokens.length > kmin) warn.push('ein Dart mehr als nötig (möglich mit ' + kmin + ')');
    }
    return { ok: !fehler.length, fehler: fehler, warnungen: warn };
  }

  /** Eigener Weg gegen den berechneten besten Weg. */
  function wegVergleich(L, r, d, tokens) {
    var bestSteps = weg(L, r, d).darts;
    var b = wegBewerten(L, r, d, bestSteps), e = wegBewerten(L, r, d, tokens);
    var delta = e.aufnahmen - b.aufnahmen;
    return {
      besterWeg: bestSteps, checkoutBester: b.checkout, checkoutEigen: e.checkout,
      mehrAufnahmen: delta,
      deutlichSchlechter: delta > 0.05 || (b.checkout - e.checkout) > 0.03
    };
  }

  /* ---------------------------------------------------------------- */
  /* 9. Kalibrierung: Average und Wurftests in Profilwerte umrechnen   */
  /* ---------------------------------------------------------------- */

  var PRIOR_SD = 0.25;                   // Vertrauen in den Ausgangswert (log-normal, etwa ±25 %)
  var SIGMA_MIN = 4.0, SIGMA_MAX = 30.0;  // unter etwa 41er Average traegt das Modell nicht mehr
  var T20 = AIMS[AIM_IDX.T20];

  function averageModell(sx, sy, K) {
    var p = verteilung(T20.x, T20.y, sx, sy, K || K_FEIN), s = 0;
    for (var o = 0; o < NO; o++) s += p[o] * VAL[o];
    return 3 * s;
  }

  /** Waagrechte Streuung sx (mit sy = q * sx), bei der das Modell den Average erreicht. */
  function sigmaAusAverage(avg, q, K) {
    q = q || 1;
    var lo = SIGMA_MIN, hi = SIGMA_MAX;
    if (avg >= averageModell(lo, q * lo, K)) return lo;
    if (avg <= averageModell(hi, q * hi, K)) return hi;
    for (var i = 0; i < 40; i++) {
      var mid = 0.5 * (lo + hi);
      if (averageModell(mid, q * mid, K) > avg) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function nachbarn(n) {
    var i = ORDER.indexOf(n);
    return [ORDER[(i + 19) % 20], ORDER[(i + 1) % 20]];
  }

  /** Ergebnis-Indizes je Zaehl-Knopf. Was nicht aufgefuehrt ist, zaehlt als "sonst". */
  function kategorien(test, ziel) {
    var nb, a, b, k = {};
    if (test === 't20') return { treffer: [60], s20: [20, 40], eins: [1, 21, 41], fuenf: [5, 25, 45] };
    if (test === 'doppel') {
      nb = nachbarn(ziel); a = nb[0]; b = nb[1];
      k.treffer = [20 + ziel]; k.innen = [ziel, 40 + ziel]; k.aussen = [0];
      k['nachbar_' + a] = [a, 20 + a, 40 + a]; k['nachbar_' + b] = [b, 20 + b, 40 + b];
      return k;
    }
    if (test === 'bull') return { bull: [62], 25: [61] };
    if (test === 'triple') {
      nb = nachbarn(ziel); a = nb[0]; b = nb[1];
      return { treffer: [40 + ziel], single: [ziel, 20 + ziel], nachbar: [a, 20 + a, 40 + a, b, 20 + b, 40 + b] };
    }
    throw new Error('Unbekannter Test ' + test);
  }

  function loglik(p, kats, zaehler) {
    var ll = 0, restP = 1;
    for (var name in kats) {
      var pk = 0;
      for (var i = 0; i < kats[name].length; i++) pk += p[kats[name][i]];
      restP -= pk;
      ll += (zaehler[name] || 0) * Math.log(Math.max(pk, 1e-6));
    }
    ll += (zaehler.sonst || 0) * Math.log(Math.max(restP, 1e-6));
    return ll;
  }

  function prior(f, f0) { var l = Math.log(f / f0); return -(l * l) / (2 * PRIOR_SD * PRIOR_SD); }

  function logRaster(von, bis, anzahl) {
    var out = [], a = Math.log(von), b = Math.log(bis);
    for (var i = 0; i < anzahl; i++) out.push(Math.exp(a + (b - a) * i / (anzahl - 1)));
    return out;
  }

  /** Average legt die Gesamtstreuung fest, der T20-Test das Verhaeltnis senkrecht zu waagrecht. */
  function leer(o) { return !o || !Object.keys(o).length; }

  function fitStreuung(avg, t20, K) {
    if (leer(t20)) { var s = sigmaAusAverage(avg, 1, K); return [s, s]; }
    var kats = kategorien('t20'), best = null;
    logRaster(0.6, 1 / 0.6, 21).forEach(function (q) {
      var sx = sigmaAusAverage(avg, q, K);
      var p = verteilung(T20.x, T20.y, sx, q * sx, K || K_FEIN);
      var score = loglik(p, kats, t20) + prior(q, 1);
      if (!best || score > best[0]) best = [score, sx, q * sx];
    });
    return [best[1], best[2]];
  }

  function fitFaktor(x, y, sx, sy, kats, zaehler, f0, K) {
    var best = null;
    logRaster(0.4, 2.5, 41).forEach(function (f) {
      var p = verteilung(x, y, sx * f, sy * f, K || K_FEIN);
      var score = loglik(p, kats, zaehler) + prior(f, f0);
      if (!best || score > best[0]) best = [score, f];
    });
    return best[1];
  }

  function rund3(x) { return Math.round(x * 1000) / 1000; }

  /*
   * eingabe: { avg, favoriten, t20, doppel, bull, triple, ziel }
   *   t20:    { treffer, s20, eins, fuenf, sonst }
   *   doppel: { ziel: 16, treffer, innen, aussen, nachbar_7, nachbar_8, sonst }
   *   bull:   { bull, 25, sonst }
   *   triple: { ziel: 16, treffer, single, nachbar, sonst }
   * Jeder Test ist optional. Ohne Test bleibt der Ausgangswert.
   */
  function profilAusTests(e, K) {
    e = e || {};
    var avg = Number(e.avg);
    if (!(avg > 0) || !isFinite(avg)) throw new Error('Average fehlt');
    var fav = (e.favoriten || []).map(Number);
    var st = fitStreuung(avg, e.t20, K), sx = st[0], sy = st[1];
    var fDoppel = 1, fFav = 0.8, fBull = 1, fTriple = 1, g;
    if (!leer(e.doppel)) {
      var z = Number(e.doppel.ziel), istFav = fav.indexOf(z) >= 0;
      if (!(z >= 1 && z <= 20)) throw new Error('Doppel-Test: Ziel muss 1 bis 20 sein');
      var aim = AIMS[AIM_IDX['D' + z]];
      g = fitFaktor(aim.x, aim.y, sx, sy, kategorien('doppel', z), e.doppel, istFav ? 0.8 : 1, K);
      fDoppel = istFav ? g / 0.8 : g;
    }
    if (!leer(e.bull)) {
      var bFav = fav.indexOf(25) >= 0;
      g = fitFaktor(0, 0, sx, sy, kategorien('bull'), e.bull, bFav ? 0.8 : 1, K);
      fBull = bFav ? g / 0.8 : g;
    }
    if (!leer(e.triple)) {
      var zt = Number(e.triple.ziel);
      if (!(zt >= 1 && zt <= 20)) throw new Error('Triple-Test: Ziel muss 1 bis 20 sein');
      var at = AIMS[AIM_IDX['T' + zt]];
      if (zt !== 19 && zt !== 20) fTriple = fitFaktor(at.x, at.y, sx, sy, kategorien('triple', zt), e.triple, 1, K);
    }
    return {
      sigma_x: rund3(sx), sigma_y: rund3(sy), f_triple: rund3(fTriple), f_doppel: rund3(fDoppel), f_bull: rund3(fBull),
      favoriten: fav, f_fav: fFav, ziel: e.ziel || 'aufnahmen'
    };
  }

  /* ---------------------------------------------------------------- */
  /* 10. Komplettlauf fuer ein Profil                                  */
  /* ---------------------------------------------------------------- */

  /** Wie die App rechnet: erst ohne Favoriten (Standard), dann mit Favoriten und Standard-Bindung. */
  function tabellenFuerProfil(p, opts) {
    p = profil(p);
    opts = opts || {};
    var ohne = profil(p); ohne.favoriten = [];
    var Lstd = opts.standard || loesen(trefferbild(ohne, opts.K));
    var L = p.favoriten.length ? loesen(trefferbild(p, opts.K), p.favoriten, Lstd.POL) : Lstd;
    var tab = tabelle(L);
    var tabCheckout = opts.ohneCheckout ? null : tabelle(L, checkoutPolitik(L));
    return { profil: p, L: L, standard: Lstd, tabelle: tab, tabelleCheckout: tabCheckout };
  }

  /* Zeile im Format von js/checkout.js: 'T19 S12 D16|T17 BULL|T19 >44' */
  function feldLabel(t) {
    if (t === 'Bull') return 'BULL';
    if (t === '25' || t.charAt(0) === 'T' || t.charAt(0) === 'D') return t;
    return 'S' + t;
  }
  function kompakt(tab) {
    var out = {};
    for (var r = 2; r <= 170; r++) {
      var z = tab[r];
      if (!z) continue;
      out[r] = [3, 2, 1].map(function (d) {
        var w = z[d].weg.map(feldLabel);
        return (w.join(' ') + (z[d].bleibt ? ' >' + z[d].bleibt : '')).trim();
      }).join('|');
    }
    return out;
  }

  global.CheckoutEngine = {
    ORDER: ORDER, AIMS: AIMS, AIM_IDX: AIM_IDX, VAL: VAL, DBL: DBL, NO: NO, NA: NA,
    GRUPPEN: GRUPPEN, REFERENZ: REFERENZ, profil: profil,
    ergebnis: ergebnis, verteilung: verteilung, trefferbild: trefferbild,
    kMin: kMin, finishbar: finishbar, MODE: MODE, MASK: MASK,
    loesen: loesen, beabsichtigt: beabsichtigt, weg: weg, tabelle: tabelle, checkoutPolitik: checkoutPolitik,
    wegBewerten: wegBewerten, wegWert: wegWert, alternativen: alternativen, tokenGueltig: tokenGueltig, wegPruefen: wegPruefen, wegVergleich: wegVergleich,
    averageModell: averageModell, sigmaAusAverage: sigmaAusAverage, fitStreuung: fitStreuung, kategorien: kategorien, profilAusTests: profilAusTests,
    tabellenFuerProfil: tabellenFuerProfil, kompakt: kompakt
  };
})(typeof self !== 'undefined' ? self : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof self !== 'undefined' ? self : globalThis).CheckoutEngine;
