/*
 * Finish-Wege für Double-Out.
 *
 * Die Wege kommen seit Oktober 2026 aus festen Tabellen (docs/finishwege/,
 * von Julius geliefert, gerechnet mit einem Treffermodell fuer das Profil
 * "Fortgeschritten"): je Lieblingsdoppel (D16, D20, D18, D12, D8, D10, D14,
 * D6, D4) und ohne Favorit fuer jeden Rest von 2 bis 170 der beste Weg mit
 * 3, 2 und 1 Dart in der Hand - und wo kein Finish mehr geht, der Stellwurf
 * samt der Zahl, auf die er stellt. tools/finishwege-bauen.mjs schreibt die
 * Tabellen in den Block unten; im Solver stehen je Favorit nur die Zeilen,
 * die vom Standard abweichen.
 *
 * Der Rechenkern darunter (best/possible/minDarts) bleibt fuer die Frage,
 * ob ein Rest mit n Darts ueberhaupt zu finishen ist - das brauchen
 * Statistik (Doppelversuche) und der Finish-Dialog.
 *
 * Eigene Tabelle je Spieler: statt der Doppelzahl darf ueberall ein Objekt
 * { dbl, tabelle } stehen. tabelle kommt aus der Checkout-Engine
 * (js/checkout-engine.js, im Profil einmal gerechnet und gespeichert) im
 * selben Zeilenformat wie unten; was dort fehlt, faellt auf die festen
 * Tabellen zurueck. rechnen() stoesst die Engine im Web Worker an.
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
    /* Gleich lang, gleiches Schlussdoppel, fast gleich gut: dann lieber
       kein Stellwurf auf eine kleine Zahl (99 auf D16: T19 S10 statt T20 S7)
       - die grossen Felder oben trifft man sicherer. Nur als Feinschliff,
       die Wahl des Doppels bleibt davon unberuehrt. */
    var obenAn = function (r) {
      return r.darts.slice(0, -1).some(function (x) { return x === 'T20' || x === 'T19'; });
    };
    if (candidate.darts[candidate.darts.length - 1] === current.darts[current.darts.length - 1] &&
        obenAn(candidate) && obenAn(current) &&
        Math.abs(candidate.cost - current.cost) < 1) {
      var candKlein = kleinerStellwurf(candidate.darts), curKlein = kleinerStellwurf(current.darts);
      if (candKlein !== curKlein) return !candKlein;
    }
    if (Math.abs(candidate.cost - current.cost) > 1e-9) return candidate.cost < current.cost;
    var candFinish = finishCostOf(candidate.darts[candidate.darts.length - 1], lieblings);
    var curFinish = finishCostOf(current.darts[current.darts.length - 1], lieblings);
    if (candFinish !== curFinish) return candFinish < curFinish;
    return fieldValue(candidate.darts[0]) > fieldValue(current.darts[0]);
  }

  /* Steht vor dem Doppel ein Single unter 10? */
  function kleinerStellwurf(darts) {
    for (var i = 0; i < darts.length - 1; i++) {
      var m = /^S(\d+)$/.exec(darts[i]);
      if (m && Number(m[1]) < 10) return true;
    }
    return false;
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

  /* FINISHWEGE-ANFANG - erzeugt von tools/finishwege-bauen.mjs aus docs/finishwege/, nicht von Hand aendern */
  var WEGE_STANDARD = {2:'D1|D1|D1',3:'S1 D1|S1 D1|S1 >2',4:'D2|D2|D2',5:'S1 D2|S1 D2|S1 >4',6:'D3|D3|D3',7:'S3 D2|S3 D2|S3 >4',8:'D4|D4|D4',9:'S1 D4|S1 D4|S1 >8',10:'D5|D5|D5',11:'S3 D4|S3 D4|S3 >8',12:'D6|D6|D6',13:'S5 D4|S5 D4|S5 >8',14:'D7|D7|D7',15:'S7 D4|S7 D4|S7 >8',16:'D8|D8|D8',17:'S1 D8|S1 D8|S1 >16',18:'D9|D9|D9',19:'S3 D8|S3 D8|S3 >16',20:'D10|D10|D10',21:'S5 D8|S5 D8|S5 >16',22:'D11|D11|D11',23:'S7 D8|S7 D8|S7 >16',24:'D12|D12|D12',25:'S9 D8|S9 D8|S9 >16',26:'D13|D13|D13',27:'S11 D8|S11 D8|S11 >16',28:'D14|D14|D14',29:'S13 D8|S13 D8|S13 >16',30:'D15|D15|D15',31:'S15 D8|S15 D8|S15 >16',32:'D16|D16|D16',33:'S1 D16|S1 D16|S1 >32',34:'D17|D17|D17',35:'S3 D16|S3 D16|S3 >32',36:'D18|D18|D18',37:'S5 D16|S5 D16|S5 >32',38:'D19|D19|D19',39:'S7 D16|S7 D16|S7 >32',40:'D20|D20|D20',41:'S9 D16|S9 D16|S9 >32',42:'S10 D16|S10 D16|S10 >32',43:'S11 D16|S11 D16|S11 >32',44:'S12 D16|S12 D16|S12 >32',45:'S13 D16|S13 D16|S13 >32',46:'S14 D16|S14 D16|S14 >32',47:'S15 D16|S15 D16|S15 >32',48:'S16 D16|S16 D16|S16 >32',49:'S17 D16|S17 D16|S17 >32',50:'S18 D16|S18 D16|BULL',51:'S19 D16|S19 D16|S19 >32',52:'S20 D16|S20 D16|S20 >32',53:'S13 D20|S13 D20|S13 >40',54:'S14 D20|S14 D20|S14 >40',55:'S15 D20|S15 D20|S15 >40',56:'S16 D20|S16 D20|S16 >40',57:'S17 D20|S17 D20|S17 >40',58:'S18 D20|S18 D20|S18 >40',59:'S19 D20|S19 D20|S19 >40',60:'S20 D20|S20 D20|S20 >40',61:'25 D18|25 D18|T15 >16',62:'T10 D16|T10 D16|T10 >32',63:'T13 D12|25 D19|T13 >24',64:'T16 D8|T16 D8|T16 >16',65:'25 D20|25 D20|T11 >32',66:'T14 D12|T14 D12|T14 >24',67:'T17 D8|T17 D8|T17 >16',68:'T16 D10|T20 D4|T16 >20',69:'T11 D18|T19 D6|S19 >50',70:'T18 D8|T18 D8|T18 >16',71:'T13 D16|T13 D16|T13 >32',72:'T16 D12|T16 D12|S20 >52',73:'T19 D8|T19 D8|T19 >16',74:'T14 D16|T14 D16|T14 >32',75:'T17 D12|T17 D12|T17 >24',76:'T20 D8|T20 D8|T20 >16',77:'T19 D10|T19 D10|T19 >20',78:'T18 D12|T18 D12|T18 >24',79:'T19 D11|T19 D11|S20 >59',80:'T20 D10|T20 D10|T20 >20',81:'T19 D12|T19 D12|T19 >24',82:'BULL D16|T14 D20|25 >57',83:'T17 D16|T17 D16|T17 >32',84:'BULL D17|T20 D12|25 >59',85:'T15 D20|T15 D20|25 >60',86:'T18 D16|T18 D16|T18 >32',87:'T17 D18|T17 D18|T17 >36',88:'T16 D20|T16 D20|T16 >40',89:'T19 D16|T19 D16|T19 >32',90:'T18 D18|T18 D18|T18 >36',91:'T17 D20|T17 D20|T17 >40',92:'T20 D16|T20 D16|T20 >32',93:'T19 D18|T19 D18|T19 >36',94:'T18 D20|T18 D20|T18 >40',95:'T19 D19|T19 D19|T19 >38',96:'T20 D18|T20 D18|T20 >36',97:'T19 D20|T19 D20|T19 >40',98:'T20 D19|T20 D19|T20 >38',99:'T19 S10 D16|T19 S10 >32|T19 >42',100:'T20 D20|T20 D20|T20 >40',101:'T19 S12 D16|T17 BULL|T19 >44',102:'T19 S13 D16|T20 S10 >32|T20 >42',103:'T19 S14 D16|T19 S14 >32|T19 >46',104:'T19 S15 D16|T18 BULL|T20 >44',105:'T19 S16 D16|T20 S13 >32|T19 >48',106:'T20 S14 D16|T20 S14 >32|T20 >46',107:'T19 S18 D16|T19 BULL|T19 >50',108:'T19 S19 D16|T19 S19 >32|T19 >51',109:'T20 S17 D16|T20 S17 >32|T20 >49',110:'T20 S18 D16|T20 BULL|T19 >53',111:'T19 S14 D20|T20 S19 >32|T20 >51',112:'T20 S20 D16|T20 S20 >32|T20 >52',113:'T20 S13 D20|T20 S13 >40|T20 >53',114:'T20 S14 D20|T20 S14 >40|T20 >54',115:'T19 S18 D20|T19 S18 >40|T19 >58',116:'T19 S19 D20|T19 S19 >40|T19 >59',117:'T20 S17 D20|T20 S17 >40|T20 >57',118:'T20 S18 D20|T20 S18 >40|T20 >58',119:'T19 T10 D16|T20 S19 >40|T20 >59',120:'T20 S20 D20|T20 S20 >40|T20 >60',121:'T19 T16 D8|T20 T15 >16|T20 >61',122:'T19 25 D20|T20 T10 >32|T19 >65',123:'T20 T13 D12|T19 T14 >24|T19 >66',124:'T20 T16 D8|T20 T16 >16|T19 >67',125:'T20 25 D20|T20 T11 >32|T20 >65',126:'T19 T19 D6|T20 T14 >24|T20 >66',127:'T19 T18 D8|T19 T18 >16|T19 >70',128:'T20 T16 D10|T20 T16 >20|T20 >68',129:'T20 T19 D6|T20 S19 >50|T20 >69',130:'T20 T18 D8|T19 T19 >16|T19 >73',131:'T19 T14 D16|T19 T14 >32|T19 >74',132:'T20 T16 D12|T20 S20 >52|T20 >72',133:'T20 T19 D8|T20 T19 >16|T20 >73',134:'T20 T14 D16|T20 T14 >32|T20 >74',135:'T19 T18 D12|T19 T18 >24|T19 >78',136:'T20 T20 D8|T20 T20 >16|T20 >76',137:'T20 T19 D10|T20 T19 >20|T20 >77',138:'T20 T18 D12|T20 T18 >24|T20 >78',139:'T19 T14 D20|T19 25 >57|T19 >82',140:'T20 T20 D10|T20 T20 >20|T20 >80',141:'T20 T19 D12|T19 25 >59|T19 >84',142:'T20 T14 D20|T20 25 >57|T20 >82',143:'T19 T18 D16|T19 T18 >32|T20 >83',144:'T20 T20 D12|T20 25 >59|T20 >84',145:'T20 T15 D20|T20 25 >60|T20 >85',146:'T19 T19 D16|T19 T19 >32|T19 >89',147:'T20 T17 D18|T20 T17 >36|T20 >87',148:'T20 T16 D20|T20 T16 >40|T20 >88',149:'T20 T19 D16|T20 T19 >32|T20 >89',150:'T19 T19 D18|T19 T19 >36|T19 >93',151:'T20 T17 D20|T20 T17 >40|T20 >91',152:'T20 T20 D16|T20 T20 >32|T20 >92',153:'T20 T19 D18|T20 T19 >36|T20 >93',154:'T20 T18 D20|T20 T18 >40|T20 >94',155:'T20 T19 D19|T20 T19 >38|T20 >95',156:'T20 T20 D18|T20 T20 >36|T20 >96',157:'T20 T19 D20|T20 T19 >40|T20 >97',158:'T20 T20 D19|T20 T20 >38|T20 >98',159:'T20 T19 S10 >32|T20 T19 >42|T20 >99',160:'T20 T20 D20|T20 T20 >40|T20 >100',161:'T20 T17 BULL|T20 T19 >44|T20 >101',162:'T20 T20 S10 >32|T20 T20 >42|T20 >102',163:'T20 T19 S14 >32|T20 T19 >46|T20 >103',164:'T19 T19 BULL|T20 T20 >44|T20 >104',165:'T20 T20 S13 >32|T20 T19 >48|T19 >108',166:'T20 T20 S14 >32|T20 T20 >46|T20 >106',167:'T20 T19 BULL|T20 T19 >50|T20 >107',168:'T20 T19 S19 >32|T20 T19 >51|T20 >108',169:'T20 T20 S17 >32|T20 T20 >49|T20 >109',170:'T20 T20 BULL|T20 T19 >53|T20 >110'};
  var WEGE_FAVORIT = {16:{59:'S19 D20|S19 D20|T9 >32',61:'T15 D8|T15 D8|T15 >16',63:'T13 D12|T11 D15|S11 >52',65:'T19 D4|25 D20|S19 >46',66:'T14 D12|T14 D12|S14 >52',67:'T17 D8|T15 D11|S19 >48',68:'T16 D10|T20 D4|S16 >52',69:'T19 D6|T17 D9|S19 >50',70:'T18 D8|T18 D8|S19 >51',71:'T19 D7|T13 D16|S19 >52',72:'T20 D6|T20 D6|S20 >52',75:'T17 D12|T13 D18|25 >50',76:'T20 D8|T20 D8|25 >51',77:'T15 D16|T15 D16|T15 >32',78:'T18 D12|T14 D18|T18 >24',80:'T16 D16|T16 D16|T16 >32',84:'BULL D17|T16 D18|T20 >24',85:'T15 D20|T15 D20|T15 >40',91:'T17 D20|T19 D17|T17 >40',94:'T18 D20|T18 D20|T20 >34',103:'T20 S11 D16|T20 S11 >32|T20 >43',104:'T18 S18 D16|T18 BULL|T18 >50',105:'T19 S16 D16|T19 S16 >32|T19 >48',110:'T20 S18 D16|T20 BULL|T20 >50',111:'T20 S19 D16|T20 S19 >32|T20 >51',116:'T19 S19 D20|T19 T9 >32|T19 >59',118:'T20 S18 D20|T20 S18 >40|T19 >61',119:'T19 T10 D16|T20 T9 >32|T20 >59',121:'T19 T16 D8|T20 T15 >16|T19 >64',122:'T20 T10 D16|T20 T10 >32|T20 >62',123:'T20 T11 D15|T19 S14 >52|T19 >66',125:'T20 T19 D4|T20 S19 >46|T20 >65',126:'T20 T14 D12|T20 S14 >52|T20 >66',127:'T19 T18 D8|T19 S19 >51|T19 >70',128:'T19 T13 D16|T20 S16 >52|T20 >68',129:'T20 T17 D9|T20 S19 >50|T20 >69',130:'T20 T18 D8|T20 S19 >51|T20 >70',132:'T20 T20 D6|T20 S20 >52|T20 >72',135:'T19 T14 D18|T19 T18 >24|T19 >78',136:'T20 T20 D8|T20 25 >51|T20 >76',137:'T20 T15 D16|T20 T15 >32|T20 >77',138:'T19 T19 D12|T19 T19 >24|T20 >78',140:'T20 T16 D16|T20 T16 >32|T20 >80',141:'T20 T19 D12|T19 T20 >24|T19 >84',144:'T20 T16 D18|T20 T20 >24|T20 >84',145:'T20 T15 D20|T20 T15 >40|T20 >85',151:'T20 T19 D17|T20 T17 >40|T20 >91',154:'T20 T18 D20|T20 T20 >34|T20 >94',156:'T20 T20 D18|T20 T20 >36|T19 >99',158:'T20 T20 D19|T19 T19 >44|T20 >98',163:'T20 T20 S11 >32|T20 T20 >43|T20 >103',164:'T19 T19 BULL|T20 T18 >50|T20 >104',165:'T19 T19 S19 >32|T19 T19 >51|T19 >108',170:'T20 T20 BULL|T20 T20 >50|T20 >110'},20:{41:'S1 D20|S1 D20|S1 >40',42:'S2 D20|S2 D20|S2 >40',43:'S3 D20|S3 D20|S3 >40',44:'S4 D20|S4 D20|S4 >40',45:'S5 D20|S5 D20|S5 >40',46:'S6 D20|S6 D20|S6 >40',47:'S7 D20|S7 D20|S7 >40',48:'S8 D20|S8 D20|S8 >40',49:'S9 D20|S9 D20|S9 >40',50:'S10 D20|S10 D20|BULL',51:'S11 D20|S11 D20|S11 >40',52:'S12 D20|S12 D20|S12 >40',61:'T7 D20|T7 D20|T7 >40',63:'T13 D12|T9 D18|T13 >24',64:'T8 D20|T8 D20|T8 >40',67:'T9 D20|T9 D20|T9 >40',68:'T12 D16|T12 D16|T12 >32',69:'T11 D18|T11 D18|S14 >55',70:'T10 D20|T10 D20|T10 >40',75:'T17 D12|T17 D12|S19 >56',77:'T19 D10|T19 D10|S19 >58',78:'T18 D12|T18 D12|S19 >59',80:'T20 D10|T20 D10|S20 >60',81:'T19 D12|T19 D12|25 >56',83:'T17 D16|T17 D16|25 >58',90:'BULL D20|T18 D18|25 >65',99:'T19 S2 D20|T19 S2 >40|T19 >42',101:'T19 S4 D20|T17 BULL|T19 >44',102:'T20 S2 D20|T20 S2 >40|T20 >42',103:'T19 S6 D20|T19 S6 >40|T19 >46',104:'T19 S7 D20|T18 BULL|T20 >44',105:'T20 S5 D20|T20 S5 >40|T20 >45',106:'T20 S6 D20|T20 S6 >40|T20 >46',107:'T19 S10 D20|T19 BULL|T19 >50',108:'T19 S11 D20|T19 S11 >40|T19 >51',109:'T20 S9 D20|T20 S9 >40|T20 >49',110:'T19 S13 D20|T20 BULL|T19 >53',111:'T20 S11 D20|T20 S11 >40|T20 >51',112:'T20 S12 D20|T20 S12 >40|T20 >52',113:'T19 S16 D20|T19 S16 >40|T19 >56',119:'T20 S19 D20|T20 S19 >40|T20 >59',121:'T19 T8 D20|T20 T7 >40|T20 >61',123:'T20 T9 D18|T19 T14 >24|T19 >66',124:'T19 T9 D20|T20 T8 >40|T19 >67',126:'T19 T11 D18|T19 S14 >55|T19 >69',127:'T19 T10 D20|T19 T10 >40|T19 >70',128:'T20 T12 D16|T20 T12 >32|T20 >68',129:'T20 T11 D18|T20 S14 >55|T20 >69',130:'T20 T10 D20|T19 T19 >16|T20 >70',135:'T19 T18 D12|T19 S19 >59|T19 >78',137:'T20 T19 D10|T20 S19 >58|T20 >77',138:'T20 T18 D12|T20 S19 >59|T20 >78',140:'T20 T20 D10|T20 S20 >60|T20 >80',143:'T19 T18 D16|T19 T18 >32|T19 >86',150:'T19 T19 D18|T20 25 >65|T19 >93',159:'T20 T19 S2 >40|T20 T19 >42|T20 >99',162:'T20 T20 S2 >40|T20 T20 >42|T20 >102',163:'T20 T19 S6 >40|T20 T19 >46|T20 >103',165:'T20 T20 S5 >40|T20 T20 >45|T19 >108',166:'T20 T20 S6 >40|T20 T20 >46|T20 >106',168:'T20 T19 S11 >40|T20 T19 >51|T20 >108',169:'T20 T20 S9 >40|T20 T20 >49|T20 >109'},18:{37:'S1 D18|S1 D18|S1 >36',39:'S3 D18|S3 D18|S3 >36',41:'S5 D18|S5 D18|S5 >36',42:'S6 D18|S6 D18|S6 >36',43:'S7 D18|S7 D18|S7 >36',44:'S8 D18|S8 D18|S8 >36',45:'S9 D18|S9 D18|S9 >36',46:'S10 D18|S10 D18|S10 >36',47:'S11 D18|S11 D18|S11 >36',48:'S12 D18|S12 D18|S12 >36',49:'S13 D18|S13 D18|S13 >36',50:'S14 D18|S14 D18|BULL',51:'S15 D18|S15 D18|S15 >36',52:'S16 D18|S16 D18|S16 >36',53:'S17 D18|S17 D18|S17 >36',54:'S18 D18|S18 D18|S18 >36',55:'S19 D18|S19 D18|S19 >36',56:'S20 D18|S20 D18|S20 >36',61:'25 D18|25 D18|25 >36',63:'T9 D18|T9 D18|T9 >36',65:'T11 D16|25 D20|T11 >32',66:'T10 D18|T10 D18|T10 >36',68:'T12 D16|T12 D16|T12 >32',69:'T11 D18|T11 D18|S19 >50',71:'T17 D10|T13 D16|S19 >52',72:'T16 D12|T12 D18|S20 >52',74:'T18 D10|T14 D16|S18 >56',75:'T19 D9|T19 D9|S19 >56',78:'T18 D12|T14 D18|T18 >24',81:'T15 D18|T15 D18|T15 >36',84:'T16 D18|T16 D18|T16 >36',85:'T15 D20|T15 D20|T19 >28',99:'T19 S6 D18|T19 S6 >36|T19 >42',101:'T20 S5 D18|T17 BULL|T19 >44',102:'T19 S9 D18|T20 S6 >36|T20 >42',103:'T19 S10 D18|T19 S10 >36|T19 >46',104:'T20 S8 D18|T18 BULL|T20 >44',105:'T19 S12 D18|T20 S9 >36|T19 >48',106:'T20 S10 D18|T20 S10 >36|T20 >46',107:'T19 S14 D18|T19 BULL|T20 >47',108:'T19 S15 D18|T19 S15 >36|T19 >51',109:'T20 S13 D18|T20 S13 >36|T20 >49',110:'T20 S14 D18|T20 BULL|T20 >50',111:'T19 S18 D18|T19 S18 >36|T19 >54',112:'T19 S19 D18|T20 S16 >36|T19 >55',113:'T20 S17 D18|T20 S17 >36|T20 >53',114:'T20 S18 D18|T20 S18 >36|T20 >54',115:'T20 S19 D18|T19 S18 >40|T19 >58',116:'T20 S20 D18|T20 S20 >36|T20 >56',121:'25 T20 D18|T20 25 >36|T20 >61',123:'T20 T9 D18|T19 T10 >36|T19 >66',126:'T19 T11 D18|T20 T10 >36|T20 >66',128:'T20 T12 D16|T20 T12 >32|T20 >68',129:'T20 T11 D18|T20 S19 >50|T20 >69',131:'T19 T14 D16|T19 S18 >56|T19 >74',132:'T20 T12 D18|T20 S20 >52|T20 >72',134:'T20 T14 D16|T20 S18 >56|T20 >74',135:'T19 T14 D18|T19 T18 >24|T19 >78',138:'T20 T14 D18|T20 T18 >24|T20 >78',141:'T20 T15 D18|T19 T16 >36|T20 >81',143:'T19 T18 D16|T20 T17 >32|T20 >83',144:'T20 T16 D18|T20 T16 >36|T20 >84',145:'T20 T15 D20|T20 T19 >28|T20 >85',159:'T20 T19 S6 >36|T20 T19 >42|T20 >99',162:'T20 T20 S6 >36|T20 T20 >42|T20 >102',163:'T20 T19 S10 >36|T20 T19 >46|T20 >103',165:'T20 T20 S9 >36|T20 T19 >48|T19 >108',166:'T20 T20 S10 >36|T20 T20 >46|T20 >106',167:'T20 T19 BULL|T20 T20 >47|T20 >107',168:'T20 T19 S15 >36|T20 T19 >51|T20 >108',169:'T20 T20 S13 >36|T20 T20 >49|T20 >109',170:'T20 T20 BULL|T20 T20 >50|T20 >110'},12:{25:'S1 D12|S1 D12|S1 >24',27:'S3 D12|S3 D12|S3 >24',29:'S5 D12|S5 D12|S5 >24',31:'S7 D12|S7 D12|S7 >24',33:'S9 D12|S9 D12|S1 >32',35:'S11 D12|S11 D12|S3 >32',37:'S13 D12|S13 D12|S5 >32',39:'S15 D12|S15 D12|S7 >32',41:'S17 D12|S17 D12|S9 >32',42:'S18 D12|S18 D12|S10 >32',43:'S19 D12|S19 D12|S11 >32',44:'S20 D12|S20 D12|S12 >32',63:'T13 D12|T13 D12|T13 >24',69:'T15 D12|T15 D12|T15 >24',72:'T16 D12|T16 D12|T16 >24',84:'T20 D12|T20 D12|T20 >24',99:'T19 S18 D12|T19 S10 >32|T19 >42',101:'T20 S17 D12|T17 BULL|T19 >44',102:'T20 S18 D12|T20 S10 >32|T20 >42',103:'T20 S19 D12|T19 S14 >32|T19 >46',104:'T20 S20 D12|T18 BULL|T20 >44',110:'T20 S18 D16|T20 BULL|T20 >50',124:'T20 T16 D8|T20 T16 >16|T20 >64',126:'T19 T15 D12|T20 T14 >24|T20 >66',127:'T20 T17 D8|T19 T18 >16|T19 >70',129:'T20 T15 D12|T20 T15 >24|T20 >69',132:'T20 T16 D12|T20 T16 >24|T20 >72',141:'T20 T19 D12|T19 T20 >24|T19 >84',143:'T19 T18 D16|T20 T17 >32|T20 >83',144:'T20 T20 D12|T20 T20 >24|T20 >84',170:'T20 T20 BULL|T20 T20 >50|T20 >110'},8:{33:'S17 D8|S17 D8|S17 >16',35:'S19 D8|S19 D8|S3 >32',61:'T15 D8|T15 D8|T15 >16',65:'25 D20|25 D20|S19 >46',68:'T16 D10|T20 D4|S20 >48',69:'T19 D6|T19 D6|S19 >50',71:'T13 D16|T19 D7|S19 >52',72:'T20 D6|T20 D6|S20 >52',75:'T17 D12|T17 D12|25 >50',77:'T19 D10|T15 D16|T19 >20',78:'T18 D12|T14 D18|T18 >24',80:'T20 D10|T16 D16|T16 >32',84:'BULL D17|T20 D12|T20 >24',85:'T15 D20|T15 D20|T15 >40',88:'T18 D17|T16 D20|T18 >34',90:'T20 D15|T18 D18|T20 >30',91:'T17 D20|T19 D17|T17 >40',94:'T18 D20|T20 D17|T18 >40',110:'T20 S18 D16|T20 BULL|T20 >50',122:'T20 T10 D16|T20 T10 >32|T19 >65',125:'T20 25 D20|T20 S19 >46|T20 >65',128:'T20 T16 D10|T20 S20 >48|T20 >68',130:'T20 T18 D8|T20 T18 >16|T20 >70',132:'T20 T20 D6|T20 S20 >52|T20 >72',135:'T19 T14 D18|T20 25 >50|T19 >78',137:'T20 T15 D16|T20 T19 >20|T20 >77',138:'T20 T14 D18|T20 T18 >24|T20 >78',140:'T20 T16 D16|T20 T16 >32|T20 >80',141:'T20 T19 D12|T19 T20 >24|T19 >84',144:'T20 T20 D12|T20 T20 >24|T20 >84',145:'T20 T15 D20|T20 T15 >40|T20 >85',148:'T20 T16 D20|T20 T18 >34|T20 >88',150:'T19 T19 D18|T19 T19 >36|T20 >90',151:'T20 T19 D17|T20 T17 >40|T20 >91',154:'T20 T20 D17|T20 T18 >40|T20 >94',165:'T19 T19 S19 >32|T19 T19 >51|T19 >108',170:'T20 T20 BULL|T20 T20 >50|T20 >110'},10:{21:'S1 D10|S1 D10|S1 >20',23:'S3 D10|S3 D10|S3 >20',25:'S5 D10|S5 D10|S5 >20',27:'S7 D10|S7 D10|S7 >20',29:'S9 D10|S9 D10|S9 >20',31:'S11 D10|S11 D10|S11 >20',33:'S13 D10|S13 D10|S1 >32',37:'S17 D10|S17 D10|S5 >32',39:'S19 D10|S19 D10|S7 >32',41:'S1 D20|S1 D20|S1 >40',42:'S2 D20|S10 D16|S2 >40',43:'S3 D20|S3 D20|S3 >40',44:'S4 D20|S4 D20|S4 >40',45:'S5 D20|S5 D20|S5 >40',46:'S6 D20|S6 D20|S6 >40',47:'S7 D20|S7 D20|S7 >40',48:'S8 D20|S8 D20|S8 >40',49:'S9 D20|S9 D20|S9 >40',50:'S10 D20|S10 D20|BULL',51:'S11 D20|S11 D20|S11 >40',52:'S12 D20|S12 D20|S12 >40',61:'T7 D20|25 D18|T15 >16',62:'T14 D10|T14 D10|T10 >32',67:'T9 D20|T9 D20|T9 >40',68:'T16 D10|T16 D10|T16 >20',69:'T11 D18|T11 D18|T11 >36',70:'T10 D20|T10 D20|T10 >40',71:'T13 D16|T17 D10|T13 >32',72:'T16 D12|T16 D12|T16 >24',74:'T18 D10|T18 D10|T14 >32',75:'T17 D12|T17 D12|S19 >56',78:'T18 D12|T18 D12|S19 >59',81:'T19 D12|T19 D12|25 >56',83:'T17 D16|T17 D16|25 >58',84:'BULL D17|BULL D17|25 >59',90:'T18 D18|T18 D18|25 >65',98:'T20 D19|T20 D19|T18 >44',99:'T19 S10 D16|T19 S2 >40|T19 >42',101:'T19 S4 D20|T17 BULL|T19 >44',102:'T20 S10 D16|T20 S2 >40|T20 >42',103:'T19 S6 D20|T19 S6 >40|T19 >46',104:'T19 S7 D20|T18 BULL|T20 >44',105:'T19 S8 D20|T20 S5 >40|25 >80',106:'T20 S6 D20|T20 S6 >40|T20 >46',107:'T19 S10 D20|T19 BULL|T19 >50',108:'T19 S11 D20|T19 S11 >40|T19 >51',109:'T20 S9 D20|T20 S9 >40|T20 >49',110:'T19 S13 D20|T20 BULL|T19 >53',111:'T19 S14 D20|T20 S11 >40|T20 >51',112:'T20 S12 D20|T20 S12 >40|T20 >52',113:'T20 S13 D20|T19 S16 >40|T19 >56',119:'T19 T14 D10|T20 S19 >40|T20 >59',121:'T19 T8 D20|T20 T15 >16|T20 >61',122:'T20 T14 D10|T20 T10 >32|T19 >65',124:'T19 T9 D20|T19 T9 >40|T19 >67',126:'T19 T11 D18|T19 T11 >36|T19 >69',127:'T19 T10 D20|T19 T10 >40|T19 >70',129:'T20 T11 D18|T20 T11 >36|T20 >69',130:'T20 T10 D20|T19 T19 >16|T20 >70',131:'T19 T18 D10|T19 T14 >32|T19 >74',132:'T20 T16 D12|T20 T16 >24|T20 >72',134:'T20 T18 D10|T20 T14 >32|T20 >74',135:'T19 T18 D12|T19 S19 >59|T19 >78',138:'T20 T18 D12|T20 S19 >59|T20 >78',144:'T20 BULL D17|T20 25 >59|T20 >84',150:'T19 T19 D18|T20 25 >65|T19 >93',158:'T20 T20 D19|T20 T18 >44|T20 >98',159:'T20 T19 S2 >40|T20 T19 >42|T20 >99',162:'T20 T20 S2 >40|T20 T20 >42|T20 >102',163:'T20 T19 S6 >40|T20 T19 >46|T20 >103',165:'T20 T20 S5 >40|T20 25 >80|T19 >108',166:'T20 T20 S6 >40|T20 T20 >46|T20 >106',168:'T20 T19 S11 >40|T20 T19 >51|T20 >108',169:'T20 T20 S9 >40|T20 T20 >49|T20 >109'},14:{29:'S1 D14|S1 D14|S1 >28',31:'S3 D14|S3 D14|S3 >28',33:'S5 D14|S5 D14|S1 >32',35:'S7 D14|S7 D14|S3 >32',37:'S9 D14|S9 D14|S5 >32',39:'S11 D14|S11 D14|S7 >32',41:'S13 D14|S13 D14|S9 >32',42:'S14 D14|S14 D14|S10 >32',43:'S15 D14|S15 D14|S11 >32',44:'S16 D14|S16 D14|S12 >32',45:'S17 D14|S17 D14|S13 >32',46:'S18 D14|S18 D14|S14 >32',47:'S19 D14|S19 D14|S15 >32',48:'S20 D14|S20 D14|S16 >32',61:'T11 D14|T11 D14|T11 >28',64:'T12 D14|T12 D14|T16 >16',67:'T13 D14|T17 D8|T17 >16',70:'T14 D14|T14 D14|T18 >16',73:'T15 D14|T15 D14|T19 >16',76:'T16 D14|T16 D14|T16 >28',82:'BULL D16|T18 D14|25 >57',85:'T19 D14|T19 D14|T19 >28',88:'T20 D14|T20 D14|T20 >28',99:'T19 S14 D14|T19 S10 >32|T19 >42',101:'T19 S16 D14|T17 BULL|T19 >44',102:'T19 S17 D14|T20 S10 >32|T20 >42',103:'T19 S18 D14|T19 S14 >32|T19 >46',104:'T19 S19 D14|T18 BULL|T20 >44',105:'T19 S20 D14|T20 S13 >32|T19 >48',106:'T20 S18 D14|T20 S14 >32|T20 >46',108:'T20 S20 D14|T19 S19 >32|T19 >51',121:'T19 T12 D14|T20 T11 >28|T20 >61',124:'T20 T12 D14|T20 T16 >16|T20 >64',127:'T19 T14 D14|T19 T18 >16|T19 >70',130:'T20 T14 D14|T19 T19 >16|T19 >73',133:'T20 T15 D14|T20 T19 >16|T20 >73',136:'T20 T16 D14|T20 T16 >28|T20 >76',139:'T19 T18 D14|T19 25 >57|T19 >82',142:'T20 T18 D14|T20 25 >57|T20 >82',145:'T20 T19 D14|T20 T19 >28|T20 >85',148:'T20 T20 D14|T20 T20 >28|T20 >88'},6:{13:'S1 D6|S1 D6|S1 >12',15:'S3 D6|S3 D6|S7 >8',17:'S1 D8|S5 D6|S1 >16',21:'S5 D8|S9 D6|S5 >16',27:'S3 D12|S3 D12|S3 >24',29:'S5 D12|S17 D6|S5 >24',31:'S7 D12|S19 D6|S7 >24',63:'T13 D12|T13 D12|T13 >24',69:'T19 D6|T19 D6|T19 >12',72:'T20 D6|T20 D6|S20 >52',84:'BULL D17|T20 D12|T20 >24',101:'T20 S9 D16|T17 BULL|T19 >44',110:'T20 S18 D16|T20 BULL|T20 >50',129:'T20 T19 D6|T20 T19 >12|T20 >69',132:'T20 T20 D6|T20 S20 >52|T20 >72',141:'T20 T19 D12|T19 T20 >24|T19 >84',144:'T20 T20 D12|T20 T20 >24|T20 >84',170:'T20 T20 BULL|T20 T20 >50|T20 >110'},4:{17:'S9 D4|S9 D4|S1 >16',19:'S11 D4|S11 D4|S3 >16',21:'S13 D4|S13 D4|S5 >16',23:'S15 D4|S15 D4|S7 >16',25:'S17 D4|S17 D4|S9 >16',27:'S19 D4|S19 D4|S11 >16',53:'S17 D18|S13 D20|S13 >40',55:'S19 D18|S15 D20|S15 >40',56:'T16 D4|T16 D4|T16 >8',62:'T10 D16|T18 D4|T10 >32',65:'T19 D4|T19 D4|T19 >8',68:'T20 D4|T20 D4|T20 >8',71:'T13 D16|T13 D16|S19 >52',72:'T16 D12|T20 D6|S20 >52',75:'T19 D9|T19 D9|T19 >18',79:'T19 D11|T19 D11|T19 >22',80:'T20 D10|T16 D16|T20 >20',84:'T16 D18|T16 D18|T16 >36',88:'T20 D14|T16 D20|T20 >28',90:'T20 D15|T18 D18|T20 >30',105:'T19 S16 D16|T19 S16 >32|T19 >48',110:'T20 S18 D16|T20 BULL|T20 >50',113:'T19 T16 D4|T20 S13 >40|T20 >53',116:'T20 T16 D4|T20 T16 >8|T20 >56',119:'T19 T18 D4|T20 S19 >40|T20 >59',122:'T19 T19 D4|T20 T10 >32|T19 >65',123:'T20 25 D19|T19 T14 >24|T19 >66',125:'T20 T19 D4|T20 T19 >8|T20 >65',128:'T20 T20 D4|T20 T20 >8|T20 >68',130:'T20 T18 D8|T20 T18 >16|T20 >70',140:'T20 T16 D16|T20 T20 >20|T20 >80',141:'T20 T19 D12|T19 T16 >36|T19 >84',144:'T20 T16 D18|T20 T16 >36|T20 >84',148:'T20 T16 D20|T20 T20 >28|T20 >88',165:'T20 T19 S16 >32|T20 T19 >48|T19 >108',170:'T20 T20 BULL|T20 T20 >50|T20 >110'}};
  /* FINISHWEGE-ENDE */

  /* Waehlbare Favoriten: gerade Doppel von D4 bis D20 (D2 nicht). Alles
     andere (Bull, ungerade, alte Profile) rechnet wie ohne Favorit. */
  function favorit(lieblings) {
    return lieblings && WEGE_FAVORIT[lieblings] ? lieblings : null;
  }

  /* Die Tabellenzeile zu Rest und Darts in der Hand: Felder in Solver-
     Schreibweise, bei einem Stellwurf dazu die Zahl, auf die er stellt.
     lieblings: Doppelzahl oder { dbl, tabelle } (eigene Tabelle zuerst). */
  function zeile(remaining, dartsLeft, lieblings) {
    var d = dartsLeft === undefined ? 3 : dartsLeft;
    if (!(remaining >= 2) || remaining > 170 || d < 1 || d > 3) return null;
    var eigen = lieblings && typeof lieblings === 'object' ? lieblings : null;
    var fav = favorit(eigen ? eigen.dbl : lieblings);
    var reihe = (eigen && eigen.tabelle && eigen.tabelle[remaining]) ||
      (fav && WEGE_FAVORIT[fav][remaining]) || WEGE_STANDARD[remaining];
    if (!reihe) return null;
    var text = reihe.split('|')[3 - d];
    var teile = text.split(' ');
    var auf = null;
    if (teile[teile.length - 1].charAt(0) === '>') auf = Number(teile.pop().slice(1));
    return { darts: teile, auf: auf };
  }

  /** Finish-Weg als Wurffolge, z.B. ['T20','T20','BULL'] - null, wenn mit
      so vielen Darts kein Finish geht (dann siehe stellwurf). */
  function suggest(remaining, dartsLeft, lieblings) {
    var z = zeile(remaining, dartsLeft, lieblings);
    return z && z.auf === null ? z.darts : null;
  }

  /** Geht kein Finish: der Stellwurf aus der Tabelle - die Darts dieser
      Aufnahme und die Zahl, auf die sie stellen ({ darts, auf }). */
  function stellwurf(remaining, dartsLeft, lieblings) {
    var z = zeile(remaining, dartsLeft, lieblings);
    return z && z.auf !== null ? z : null;
  }

  /*
   * Tabellen fuer ein Profil rechnen lassen - im Web Worker, damit die
   * Oberflaeche nicht steht. auftrag = { profil } oder { eingabe } (siehe
   * js/checkout-worker.js). Liefert ein Promise auf { profil, tabelle,
   * tabelleCheckout, ms }. In der Einzeldatei kommt der Worker aus dem
   * eingebetteten Quelltext; wo kein Worker geht, rechnet die Engine direkt,
   * sofern sie auf der Seite liegt.
   */
  var workerUrl = null;
  function engineWorker() {
    if (typeof Worker === 'undefined') return null;
    try {
      if (global.__CHECKOUT_ENGINE_SRC) {
        if (!workerUrl) {
          workerUrl = URL.createObjectURL(new Blob([global.__CHECKOUT_ENGINE_SRC, '\n', global.__CHECKOUT_WORKER_SRC], { type: 'text/javascript' }));
        }
        return new Worker(workerUrl);
      }
      return new Worker('js/checkout-worker.js');
    } catch (e) { return null; }
  }
  function rechnenDirekt(auftrag) {
    var E = global.CheckoutEngine;
    if (!E) throw new Error('Checkout-Engine nicht geladen');
    var t = Date.now();
    var p = auftrag.eingabe ? E.profilAusTests(auftrag.eingabe) : E.profil(auftrag.profil);
    var erg = E.tabellenFuerProfil(p);
    return { id: auftrag.id, profil: p, tabelle: E.kompakt(erg.tabelle), tabelleCheckout: E.kompakt(erg.tabelleCheckout), ms: Date.now() - t };
  }
  function rechnen(auftrag) {
    return new Promise(function (resolve, reject) {
      var w = engineWorker();
      if (!w) {
        try { resolve(rechnenDirekt(auftrag)); } catch (e) { reject(e); }
        return;
      }
      var fertig = false;
      /* Ein haengender Worker darf das Promise nicht ewig offen lassen. */
      var uhr = setTimeout(function () {
        if (fertig) return;
        fertig = true; w.terminate();
        reject(new Error('Die Berechnung hat zu lange gedauert'));
      }, 60000);
      w.onmessage = function (ev) {
        if (fertig) return;
        fertig = true; clearTimeout(uhr); w.terminate();
        if (ev.data && ev.data.fehler) reject(new Error(ev.data.fehler)); else resolve(ev.data);
      };
      w.onerror = function (e) {
        if (fertig) return;
        fertig = true; clearTimeout(uhr); w.terminate();
        if (e && e.preventDefault) e.preventDefault();
        try { resolve(rechnenDirekt(auftrag)); } catch (x) { reject(x); }
      };
      w.postMessage(auftrag);
    });
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
    stellwurf: stellwurf,
    favorit: favorit,
    rechnen: rechnen,
    possible: possible,
    minDarts: minDarts,
    fieldValue: fieldValue,
    pretty: pretty,
    FIELDS: FIELDS
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).Checkout;
