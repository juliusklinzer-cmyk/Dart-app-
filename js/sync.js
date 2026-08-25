/*
 * Abgleich mit dem Server: fertige Spiele hoch, Spiele der Kollegen runter.
 *
 * Auch diese Datei ist OPTIONAL – ohne sie bleibt die App die lokale App.
 *
 * Offline-first: gespielt wird immer lokal. Ein fertiges Spiel wandert in eine
 * Warteschlange und geht raus, sobald wieder Netz da ist. Deshalb passiert
 * hier nichts, was einen Abend stören könnte: schlägt etwas fehl, bleibt der
 * Eintrag einfach in der Schlange liegen.
 */
(function () {
  'use strict';

  if (location.protocol.indexOf('http') !== 0) return;

  var SCHLUESSEL = 'dart-turnier-sync-v1';
  var TAKT = 60000;          // regelmäßiger Versuch, solange die App offen ist
  var DOPPEL_FENSTER = 30 * 60000;

  var D = null;
  var nutzer = null;
  var laeuft = false;
  var letzterFehler = '';
  /*
   * `hoch` merkt sich, was der Server schon hat. Ohne diese Liste gäbe es zwei
   * Ärgernisse: abgemeldet gespielte Partien blieben für immer in der
   * Warteschlange, und bei jeder Anmeldung würde die komplette Historie erneut
   * angeboten.
   */
  var zustand = { userId: null, cursor: 0, outbox: [], hoch: [] };

  /* ================= eigener kleiner Speicher ================= */

  function laden() {
    try {
      var roh = localStorage.getItem(SCHLUESSEL);
      if (!roh) return;
      var z = JSON.parse(roh);
      if (z && typeof z === 'object') {
        zustand.userId = z.userId || null;
        zustand.cursor = Number(z.cursor) || 0;
        zustand.outbox = Array.isArray(z.outbox) ? z.outbox : [];
        zustand.hoch = Array.isArray(z.hoch) ? z.hoch : [];
      }
    } catch (e) { /* kaputt oder nicht da: wir fangen bei null an */ }
  }

  function sichern() {
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify(zustand));
    } catch (e) {
      // Der Spielstand selbst hat Vorrang; die Warteschlange lebt notfalls
      // nur bis zum Neuladen weiter.
    }
  }

  /* ================= Spiele deuten ================= */

  function istAccount(id) { return String(id).indexOf('u_') === 0; }

  /* Ein Turnier-Eintrag hat `lineup` und `matches`, ein Einzelspiel `players`
     und `throws` – so unterscheidet die App sie auch sonst. */
  function istTurnier(h) { return !!h.lineup; }

  function art(h) { return istTurnier(h) ? 'tournament' : (h.kind || '501'); }

  function beteiligte(h) {
    var ids = istTurnier(h) ? h.lineup : h.players;
    return Array.isArray(ids) ? ids : [];
  }

  function eintragNachId(id) {
    var hist = D.state().history;
    for (var i = 0; i < hist.length; i++) if (hist[i].id === id) return hist[i];
    return null;
  }

  /* Was hochgeladen werden kann: alles mit mindestens einem echten Account,
     das nicht schon oben liegt. Reine Gästerunden bleiben auf dem Gerät –
     da gehört auch nichts hin. */
  function ladbar(h) {
    if (!h || h.von) return false;                    // `von` = kam selbst vom Server
    if (zustand.hoch.indexOf(h.id) >= 0) return false;
    return beteiligte(h).some(istAccount);
  }

  function merkeAlsOben(id) {
    if (zustand.hoch.indexOf(id) < 0) zustand.hoch.push(id);
    // Die Liste darf nicht unbegrenzt wachsen; die Historie ist ohnehin
    // gedeckelt, also reicht dieselbe Größenordnung.
    if (zustand.hoch.length > 600) zustand.hoch.splice(0, zustand.hoch.length - 600);
  }

  function spielerListe(h) {
    return beteiligte(h).map(function (id) {
      if (istAccount(id)) return { userId: id };
      var p = D.profile(id);
      return { guestName: (p && p.name) || 'Gast' };
    });
  }

  /* ================= Warteschlange ================= */

  function neuesSpiel(eintrag) {
    if (!eintrag || !eintrag.id) return;
    // Abgemeldet gespielt? Dann nicht anstellen – beim nächsten Anmelden holt
    // backfill() nach, was dann tatsächlich zu einem Account gehört.
    if (!nutzer) return statusNeu();
    if (!ladbar(eintrag)) return statusNeu();
    if (zustand.outbox.indexOf(eintrag.id) < 0) zustand.outbox.push(eintrag.id);
    sichern();
    // Über jetzt(), nicht hoch(): dort hängt die Fehlerbehandlung dran. Ein
    // fehlgeschlagener Upload darf niemals als Fehler im Spiel landen.
    jetzt();
  }

  /* Alles anstellen, was zu Accounts gehört und noch nicht oben liegt. */
  function backfill() {
    D.state().history.forEach(function (h) {
      if (ladbar(h) && zustand.outbox.indexOf(h.id) < 0) zustand.outbox.push(h.id);
    });
    sichern();
  }

  /* Nach der Zuordnung alter Profile gehören plötzlich viele alte Spiele zu
     Accounts – die sollen mit. */
  function nachZuordnung() {
    backfill();
    jetzt();
  }

  /* ================= Hoch und runter ================= */

  function hoch() {
    if (!nutzer || !zustand.outbox.length) return Promise.resolve(0);
    var offen = zustand.outbox.slice();
    var geschafft = 0;

    // Nacheinander statt alle auf einmal: ein Turnier kann gross sein, und
    // ein schlechtes WLAN mag keine zehn parallelen Uploads.
    return offen.reduce(function (kette, id) {
      return kette.then(function () {
        var h = eintragNachId(id);
        if (!h || !ladbar(h)) {
          entferneAusSchlange(id);
          return;
        }
        return window.DartKonto.ruf('POST', '/api/games', {
          id: h.id,
          kind: art(h),
          at: h.at || Date.now(),
          payload: h,
          players: spielerListe(h)
        }).then(function () {
          geschafft++;
          merkeAlsOben(id);
          entferneAusSchlange(id);
        }).catch(function (e) {
          // 4xx heisst: das schicken wir nie erfolgreich los. Sonst bliebe es
          // für immer in der Schlange und die Statuszeile lügt.
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
            letzterFehler = 'Ein Spiel liess sich nicht hochladen: ' + e.message;
            // Abhaken statt endlos wiederholen – sonst stellt backfill() das
            // Spiel bei jeder Anmeldung erneut an und der Fehler kommt wieder.
            merkeAlsOben(id);
            entferneAusSchlange(id);
          } else {
            throw e;
          }
        });
      });
    }, Promise.resolve()).then(function () {
      return geschafft;
    });
  }

  function entferneAusSchlange(id) {
    var i = zustand.outbox.indexOf(id);
    if (i >= 0) zustand.outbox.splice(i, 1);
    sichern();
  }

  function runter() {
    if (!nutzer) return Promise.resolve(0);
    var gesamt = 0;

    function seite() {
      return window.DartKonto.ruf('GET', '/api/games?since=' + zustand.cursor).then(function (daten) {
        var liste = daten.spiele || [];
        gesamt += D.uebernehmeSpiele(liste);
        if (daten.cursor > zustand.cursor) {
          zustand.cursor = daten.cursor;
          sichern();
        }
        if (daten.mehr) return seite();
      });
    }

    return seite().then(function () { return gesamt; });
  }

  /* Ein voller Durchlauf. Gibt einen Satz zurück, den man anzeigen kann. */
  function jetzt() {
    if (!nutzer) return Promise.resolve('Nicht angemeldet.');
    if (laeuft) return Promise.resolve('Der Abgleich läuft schon.');
    laeuft = true;
    letzterFehler = '';
    var rauf = 0;

    // Das Roster gleich mit: sonst taucht ein Kollege, der sich heute
    // angemeldet hat, erst nach einem Neuladen in der Aufstellung auf.
    return window.DartKonto.holeRoster()
      .then(hoch)
      .then(function (n) { rauf = n; return runter(); })
      .then(function (runterZahl) {
        laeuft = false;
        if (runterZahl) window.__dart.render();
        else statusNeu();
        if (!rauf && !runterZahl) return letzterFehler || 'Alles auf dem neuesten Stand.';
        var teile = [];
        if (rauf) teile.push(rauf === 1 ? '1 Spiel hochgeladen' : rauf + ' Spiele hochgeladen');
        if (runterZahl) teile.push(runterZahl === 1 ? '1 neues Spiel geholt' : runterZahl + ' neue Spiele geholt');
        return teile.join(', ') + '.';
      })
      .catch(function (e) {
        laeuft = false;
        letzterFehler = navigator.onLine
          ? (e && e.message) || 'Der Abgleich hat nicht geklappt.'
          : 'Keine Verbindung – wird nachgeholt.';
        statusNeu();
        return letzterFehler;
      });
  }

  /* ================= Status ================= */

  function statusNeu() {
    var bar = document.getElementById('sync-status');
    if (!bar) return;
    var text = statusText();
    bar.textContent = text;
    bar.classList.toggle('hidden', !text);
  }

  function statusText() {
    if (!nutzer || !zustand.outbox.length) return '';
    var n = zustand.outbox.length;
    return (n === 1 ? '1 Spiel wartet' : n + ' Spiele warten') + ' auf den Upload' +
      (navigator.onLine ? ' …' : ' – kein Netz');
  }

  function langText() {
    if (!nutzer) return '';
    var teile = [];
    if (zustand.outbox.length) {
      teile.push(zustand.outbox.length === 1
        ? '1 Spiel ist noch nicht hochgeladen.'
        : zustand.outbox.length + ' Spiele sind noch nicht hochgeladen.');
    } else {
      teile.push('Alle Spiele sind hochgeladen.');
    }
    var doppel = moeglicheDoppel();
    if (doppel) {
      teile.push(doppel === 1
        ? 'Achtung: 1 Spiel wurde offenbar von zwei Leuten aufgeschrieben – gleiche Besetzung, fast gleiche Zeit. Eins davon lässt sich im Verlauf löschen.'
        : 'Achtung: ' + doppel + ' Spiele wurden offenbar von zwei Leuten aufgeschrieben. Sie zählen sonst doppelt.');
    }
    if (letzterFehler) teile.push(letzterFehler);
    return teile.join(' ');
  }

  /*
   * Schreiben zwei Geräte denselben Abend mit, zählt er doppelt. Verhindern
   * können wir das nicht – aber es auffallen lassen. Wer es eingetragen hat,
   * kann es über die Historie zurückziehen.
   *
   * Entscheidend ist, dass die beiden von VERSCHIEDENEN Leuten stammen.
   * Gleiche Besetzung kurz hintereinander ist sonst der Normalfall: zwei
   * Partien derselben Leute in einer halben Stunde sind kein Doppeleintrag,
   * sondern ein normaler Abend. Vorher hat die Warnung genau das gemeldet
   * und lag damit fast immer daneben.
   *
   * Das Feld `von` steht an jedem Eintrag, der vom Server kam und von jemand
   * anderem aufgeschrieben wurde; an den eigenen steht es nicht. Damit
   * stimmt die Prüfung aus jeder Sicht: bei dem, der selbst mitgeschrieben
   * hat, genauso wie bei einem Dritten, der beide Fassungen geholt hat.
   */
  function schreiber(h) { return h.von || ''; }

  function moeglicheDoppel() {
    var hist = D.state().history;
    var treffer = 0;
    for (var i = 0; i < hist.length; i++) {
      for (var j = i + 1; j < hist.length; j++) {
        var a = hist[i], b = hist[j];
        if (Math.abs((a.at || 0) - (b.at || 0)) > DOPPEL_FENSTER) break;
        if (art(a) !== art(b)) continue;
        if (schreiber(a) === schreiber(b)) continue;   // derselbe hat beide notiert
        var sa = beteiligte(a).slice().sort().join(',');
        var sb = beteiligte(b).slice().sort().join(',');
        if (sa && sa === sb) treffer++;
      }
    }
    return treffer;
  }

  /* ================= An- und Abmelden ================= */

  function angemeldet(neuerNutzer) {
    nutzer = neuerNutzer;
    // Anderer Account auf demselben Gerät: der Cursor des Vorgängers passt
    // nicht, also von vorn holen. Die lokale Historie bleibt – es sind
    // ohnehin die Spiele derselben Runde.
    if (zustand.userId !== nutzer.id) {
      zustand.userId = nutzer.id;
      zustand.cursor = 0;
      sichern();
    }
    backfill();
    jetzt();
  }

  function abgemeldet() {
    nutzer = null;
    statusNeu();
  }

  /* ================= Start ================= */

  function start() {
    D = window.__dart;
    if (!D) return;
    laden();

    window.DartSync = {
      neuesSpiel: neuesSpiel,
      nachZuordnung: nachZuordnung,
      angemeldet: angemeldet,
      abgemeldet: abgemeldet,
      jetzt: jetzt,
      statusText: statusText,
      langText: langText,
      wartend: function () { return zustand.outbox.length; }
    };

    // Wieder online, App wieder im Vordergrund, oder einfach nach einer Weile.
    window.addEventListener('online', function () { jetzt(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) jetzt();
    });
    setInterval(function () {
      if (nutzer && (zustand.outbox.length || !document.hidden)) jetzt();
    }, TAKT);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
