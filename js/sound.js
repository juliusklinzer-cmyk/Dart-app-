/*
 * Die Klangschicht: der Pfeil-Einschlag ("Pomp") fuer jede gebuchte
 * Eingabe und ein trockener Klick fuer jede Ruecknahme. Der Einschlag ist
 * Julius' eigene Aufnahme, als Base64 eingebettet - so spielt sie offline,
 * im Einzeldatei-Buendel und ohne extra Netzanfrage. Kann der Browser das
 * AAC nicht dekodieren (seltene Chromium-Builds), springt ein per WebAudio
 * synthetisierter dumpfer Schlag ein.
 *
 * iOS gibt Ton erst nach einer Nutzergeste frei - der erste Tipp oder
 * Tastendruck weckt den AudioContext, ab dann klingt jede Eingabe.
 */
(function () {
  'use strict';
  var DATEN = 'data:audio/mp4;base64,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';
  var ctx = null;
  var pomp = null;
  var zuletzt = 0;

  function weckauf() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return; }
      lade();
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* egal */ } }
  }

  function lade() {
    try {
      var roh = atob(DATEN.split(',')[1]);
      var bytes = new Uint8Array(roh.length);
      for (var i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
      // Callback-Form: Safari kann die Promise-Variante lange nicht.
      ctx.decodeAudioData(bytes.buffer, function (b) { pomp = b; }, function () { pomp = null; });
    } catch (e) { pomp = null; }
  }

  /* "Weiter" fuellt drei Darts in einem Rutsch auf - ein Einschlag reicht,
     sonst wird aus dem Pomp ein Brummen. */
  function darfSpielen() {
    if (!ctx || ctx.state !== 'running') return false;
    var jetzt = ctx.currentTime;
    if (jetzt - zuletzt < 0.06) return false;
    zuletzt = jetzt;
    return true;
  }

  function spielePomp() {
    if (!darfSpielen()) return;
    if (pomp) {
      var q = ctx.createBufferSource();
      q.buffer = pomp;
      var g = ctx.createGain();
      g.gain.value = 0.9;
      q.connect(g); g.connect(ctx.destination);
      q.start();
      return;
    }
    /* Ersatzschlag: fallender Sinus (Korpus) plus kurzes Rauschen (Spitze). */
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    var og = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(ctx.destination);
    o.start(t); o.stop(t + 0.13);
    var puffer = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    var d = puffer.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    var r = ctx.createBufferSource();
    r.buffer = puffer;
    var rg = ctx.createGain();
    rg.gain.value = 0.25;
    r.connect(rg); rg.connect(ctx.destination);
    r.start(t);
  }

  function spieleKlick() {
    if (!darfSpielen()) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1900, t);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.04);
  }

  document.addEventListener('pointerdown', weckauf, { capture: true, passive: true });
  document.addEventListener('keydown', weckauf, true);

  window.DartSound = { pomp: spielePomp, klick: spieleKlick };
})();
