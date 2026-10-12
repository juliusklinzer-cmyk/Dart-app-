/*
 * Rechnet Finish-Tabellen im Hintergrund (Web Worker), damit die Oberflaeche
 * waehrend der ein bis zwei Sekunden nicht steht. Auftrag per postMessage:
 *   { id, profil }    Profil wie CheckoutEngine.REFERENZ (Favoriten, Streuung)
 *   { id, eingabe }   Average, Lieblingsgruppen und Wurftests, aus denen
 *                     erst das Profil kalibriert wird
 * Antwort: { id, profil, tabelle, tabelleCheckout, ms } mit den Tabellen im
 * Format von js/checkout.js (je Rest '3 Darts|2 Darts|1 Dart'), bei einem
 * Fehler { id, fehler }.
 *
 * Im Einzeldatei-Buendel laeuft derselbe Code als Blob-Worker; build-single.mjs
 * entfernt dafuer die importScripts-Zeile und stellt die Engine voran.
 */
importScripts('checkout-engine.js');

self.onmessage = function (ev) {
  var d = ev.data || {};
  try {
    var t = Date.now();
    var p = d.eingabe ? CheckoutEngine.profilAusTests(d.eingabe) : CheckoutEngine.profil(d.profil);
    var erg = CheckoutEngine.tabellenFuerProfil(p);
    self.postMessage({
      id: d.id, profil: p,
      tabelle: CheckoutEngine.kompakt(erg.tabelle),
      tabelleCheckout: CheckoutEngine.kompakt(erg.tabelleCheckout),
      ms: Date.now() - t
    });
  } catch (e) {
    self.postMessage({ id: d.id, fehler: String(e && e.message || e) });
  }
};
