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
  function finishCost(f) {
    if (DOUBLE_RANK[f.num] !== undefined) return DOUBLE_RANK[f.num];
    return 12 + (20 - f.num) * 0.2;                 // ungerade Doppel (D19, D17, ...)
  }

  /*
   * Reihenfolge der Kriterien:
   * 1. weniger Darts   2. geringere Kosten
   * 3. besseres Schluss-Doppel   4. höherer erster Dart (T20 vor T19)
   */
  function better(candidate, current) {
    if (!current) return true;
    if (candidate.darts.length !== current.darts.length) {
      return candidate.darts.length < current.darts.length;
    }
    if (Math.abs(candidate.cost - current.cost) > 1e-9) return candidate.cost < current.cost;
    var candFinish = finishCostOf(candidate.darts[candidate.darts.length - 1]);
    var curFinish = finishCostOf(current.darts[current.darts.length - 1]);
    if (candFinish !== curFinish) return candFinish < curFinish;
    return fieldValue(candidate.darts[0]) > fieldValue(current.darts[0]);
  }

  function finishCostOf(label) {
    for (var i = 0; i < FIELDS.length; i++) {
      if (FIELDS[i].label === label) return finishCost(FIELDS[i]);
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
  function best(remaining, dartsLeft) {
    if (!(remaining > 1) || remaining > 170 || dartsLeft < 1) return null;
    var key = remaining + ':' + dartsLeft;
    if (cache[key] !== undefined) return cache[key];

    var result = null;

    // 1 Dart: muss direkt ein Doppel sein.
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      if (f.double && f.value === remaining) {
        var cand = { darts: [f.label], cost: finishCost(f) };
        if (better(cand, result)) result = cand;
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
      var sub = best(rest, dartsLeft - 1);
      if (!sub) continue;
      var cand2 = { darts: [d.label].concat(sub.darts), cost: scoringCost(d) + sub.cost };
      if (better(cand2, result)) result = cand2;
    }
    cache[key] = result;
    return result;
  }

  /** Gibt nur die Wurffolge zurück, z.B. ['T20','T20','BULL'] oder null. */
  function suggest(remaining, dartsLeft) {
    var r = best(remaining, dartsLeft === undefined ? 3 : dartsLeft);
    return r ? r.darts : null;
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
