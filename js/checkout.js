/*
 * Checkout-Solver für Double-Out.
 * Berechnet den sinnvollsten Finish-Weg für einen Reststand und die Anzahl
 * der noch verfügbaren Darts (1-3). Es wird zuerst nach möglichst wenigen
 * Darts optimiert, danach nach "Wurf-Qualität" (T20/T19 zuerst, gute Doppel
 * am Ende, schlechte Doppel wie D2/D4 werden gemieden).
 */
(function (global) {
  'use strict';

  /** Alle möglichen Felder auf dem Board. */
  function buildFields() {
    var fields = [];
    for (var n = 1; n <= 20; n++) {
      fields.push({ label: 'S' + n, value: n, mult: 1, num: n, double: false });
      fields.push({ label: 'D' + n, value: 2 * n, mult: 2, num: n, double: true });
      fields.push({ label: 'T' + n, value: 3 * n, mult: 3, num: n, double: false });
    }
    fields.push({ label: '25', value: 25, mult: 1, num: 25, double: false });
    fields.push({ label: 'BULL', value: 50, mult: 2, num: 25, double: true });
    return fields;
  }

  var FIELDS = buildFields();

  /* Wie gerne wirft man ein Feld als Punkte-Dart? (kleiner = lieber) */
  function scoringCost(f) {
    if (f.mult === 3) return (20 - f.num) * 1.5;    // T20 = 0 ... T1 = 28.5
    if (f.label === 'BULL') return 15;              // Bull als Punkte-Dart: ungern
    if (f.label === '25') return 20;
    if (f.mult === 1) return 12 + (20 - f.num) * 0.4;
    return 30 + (20 - f.num) * 0.4;                 // Doppel als Punkte-Dart: ungern
  }

  /* Wie gerne steht man auf diesem Doppel? (kleiner = lieber) */
  var DOUBLE_RANK = {
    20: 0, 16: 1, 12: 2, 10: 3, 8: 4, 18: 5, 14: 6,
    6: 9, 4: 12, 2: 18, 25: 13
  };
  /*
   * Das Lieblingsdoppel eines Spielers zaehlt mehr als jede allgemeine
   * Rangfolge: wer D16 sicher trifft, will dorthin gestellt werden, auch
   * wenn D20 "objektiv" das bessere Doppel ist.
   *
   * Der Bonus ist mit Absicht begrenzt (-6). Die Reihenfolge in better()
   * zaehlt zuerst die Darts -- ein Umweg ueber einen zusaetzlichen Dart
   * kommt also nie zustande. Innerhalb derselben Dartzahl gewinnt das
   * Lieblingsdoppel nur, wenn der Punkte-Dart davor nicht mehr als 6
   * Kosteneinheiten schlechter ist. Sonst stuende auf 100 statt T20 D20
   * plötzlich ein krummer Weg nur wegen des Doppels.
   */
  var LIEBLINGS_BONUS = -6;
  function finishCost(f, lieblings) {
    if (lieblings && f.num === lieblings && f.double) return LIEBLINGS_BONUS;
    if (DOUBLE_RANK[f.num] !== undefined) return DOUBLE_RANK[f.num];
    return 12 + (20 - f.num) * 0.2;                 // ungerade Doppel (D19, D17, ...)
  }

  /*
   * Reihenfolge der Kriterien:
   * 1. weniger Darts   2. geringere Kosten
   * 3. besseres Schluss-Doppel   4. höherer erster Dart (T20 vor T19)
   */
  function better(candidate, current, lieblings) {
    if (!current) return true;
    if (candidate.darts.length !== current.darts.length) {
      return candidate.darts.length < current.darts.length;
    }
    if (Math.abs(candidate.cost - current.cost) > 1e-9) return candidate.cost < current.cost;
    var candFinish = finishCostOf(candidate.darts[candidate.darts.length - 1], lieblings);
    var curFinish = finishCostOf(current.darts[current.darts.length - 1], lieblings);
    if (candFinish !== curFinish) return candFinish < curFinish;
    return fieldValue(candidate.darts[0]) > fieldValue(current.darts[0]);
  }

  function finishCostOf(label, lieblings) {
    for (var i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].label === label) return finishCost(FIELDS[i], lieblings);
    }
    return 99;
  }

  var cache = Object.create(null);

  /**
   * Bester Finish-Weg.
   * @param {number} remaining Reststand
   * @param {number} dartsLeft verbleibende Darts dieser Aufnahme (1-3)
   * @returns {{darts: string[], cost: number}|null}
   */
  function best(remaining, dartsLeft, lieblings) {
    if (!(remaining > 1) || remaining > 170 || dartsLeft < 1) return null;
    // Das Lieblingsdoppel gehoert in den Schluessel: sonst bekaeme der
    // naechste Spieler den Weg des vorigen aus dem Zwischenspeicher.
    var key = remaining + ':' + dartsLeft + ':' + (lieblings || 0);
    if (cache[key] !== undefined) return cache[key];

    var result = null;

    // 1 Dart: muss direkt ein Doppel sein.
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      if (f.double && f.value === remaining) {
        var cand = { darts: [f.label], cost: finishCost(f, lieblings) };
        if (better(cand, result, lieblings)) result = cand;
      }
    }
    if (result || dartsLeft === 1) {
      cache[key] = result;
      return result;
    }

    // 2-3 Darts: erster Dart punktet, Rest rekursiv.
    for (var j = 0; j < FIELDS.length; j++) {
      var d = FIELDS[j];
      var rest = remaining - d.value;
      if (rest < 2) continue;
      var sub = best(rest, dartsLeft - 1, lieblings);
      if (!sub) continue;
      var cand2 = { darts: [d.label].concat(sub.darts), cost: scoringCost(d) + sub.cost };
      if (better(cand2, result, lieblings)) result = cand2;
    }
    cache[key] = result;
    return result;
  }

  /** Gibt nur die Wurffolge zurück, z.B. ['T20','T20','BULL'] oder null. */
  /*
   * Ein Stellwurf, den man wirklich wirft: ein Single (grosses Feld), ein
   * hohes Triple oder Bull. Ein T7 oder die 25 nur deshalb anzusagen, weil
   * danach das Lieblingsdoppel steht, waere schlechter Rat -- die trifft
   * niemand absichtlich.
   */
  function vernuenftigerStellwurf(label) {
    var f = null;
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].label === label) f = FIELDS[i];
    if (!f) return false;
    // Bull und die 25 sind als Stellwurf nur dann richtig, wenn der Weg
    // ohnehin dorthin fuehrt -- nicht, um ein Doppel zu erzwingen.
    if (f.num === 25) return false;
    if (f.mult === 1) return true;
    if (f.mult === 3) return f.num >= 15;
    return false;                                   // Doppel als Stellwurf: nein
  }

  /*
   * Der Weg zum Lieblingsdoppel gilt nur, wenn er auch ohne das Doppel
   * vertretbar waere. Sonst bleibt es beim allgemein besten Weg. Die Pruefung
   * steht hier und nicht in der Rekursion: dort muesste sie bei jedem
   * Teilweg mitlaufen, hier reicht sie einmal am fertigen Vorschlag.
   */
  function suggest(remaining, dartsLeft, lieblings) {
    var d = dartsLeft === undefined ? 3 : dartsLeft;
    var ohne = best(remaining, d, null);
    if (!lieblings) return ohne ? ohne.darts : null;
    var mit = best(remaining, d, lieblings);
    if (!mit) return ohne ? ohne.darts : null;
    for (var i = 0; i < mit.darts.length - 1; i++) {
      if (!vernuenftigerStellwurf(mit.darts[i])) return ohne ? ohne.darts : null;
    }
    return mit.darts;
  }

  /** Ist ein Checkout mit genau so vielen Darts möglich? */
  function possible(remaining, dartsLeft) {
    return best(remaining, dartsLeft) !== null;
  }

  /** Kleinste Anzahl Darts, mit der remaining ausgecheckt werden kann (oder null). */
  function minDarts(remaining) {
    for (var n = 1; n <= 3; n++) if (possible(remaining, n)) return n;
    return null;
  }

  /** Wert eines Feld-Labels ('T20' -> 60). */
  function fieldValue(label) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].label === label) return FIELDS[i].value;
    return 0;
  }

  /** Hübsche Anzeige: 'T20' -> 'T20', 'BULL' -> 'Bull', 'S7' -> '7' */
  function pretty(label) {
    if (label === 'BULL') return 'Bull';
    if (label === '25') return '25';
    if (label.charAt(0) === 'S') return label.slice(1);
    return label;
  }

  global.Checkout = {
    suggest: suggest,
    possible: possible,
    minDarts: minDarts,
    fieldValue: fieldValue,
    pretty: pretty,
    FIELDS: FIELDS
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).Checkout;
