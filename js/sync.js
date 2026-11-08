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
  /*
   * `fehlgeschlagen` haelt fest, was die Schlange endgueltig abgehakt hat
   * (4xx ausser 429). Vorher verschwand so ein Spiel still und lag fuer immer
   * nur auf dem Geraet - der einzige Hinweis war ein Satz im Konto-Langtext,
   * der beim naechsten Abgleich wieder weg war. app.js zeigt die Liste im Konto.
   */
  var FEHLER_MAX = 20;
  var zustand = { userId: null, cursor: 0, outbox: [], hoch: [], alle: true, fehlgeschlagen: [], ersetzen: [] };

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
        zustand.fehlgeschlagen = Array.isArray(z.fehlgeschlagen) ? z.fehlgeschlagen : [];
        zustand.ersetzen = Array.isArray(z.ersetzen) ? z.ersetzen : [];
        if (z.khNachgereicht) zustand.khNachgereicht = z.khNachgereicht;
        /* Frueher lieferte der Server nur die eigenen Spiele. Ein Geraet
           von damals holt einmal alles von vorn - Vorhandenes wird beim
           Einmischen ohnehin uebersprungen. */
        if (z.alle !== true) zustand.cursor = 0;
        zustand.alle = true;
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

  /* Die Namen der Beteiligten reisen im Spielinhalt mit: andere Geraete
     kennen fremde Gastspieler nicht und zeigten sonst "Unbekannt". */
  function mitNamen(h) {
    /* Beim Archivieren festgehaltene Namen (h.namen, voller Name) haben
       Vorrang - die Liga-Auswertung schluesselt Gegner danach (L26). Nur
       fehlende Ids werden aus den Profilen ergaenzt. */
    var namen = {};
    if (h.namen && typeof h.namen === 'object') Object.keys(h.namen).forEach(function (id) { namen[id] = h.namen[id]; });
    beteiligte(h).forEach(function (id) {
      if (namen[id]) return;
      var p = D.profile(id);
      if (p && p.name && p.name !== 'Unbekannt') namen[id] = p.voll || p.name;
    });
    var kopie = {};
    Object.keys(h).forEach(function (k) { kopie[k] = h[k]; });
    kopie.namen = namen;
    return kopie;
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
    /* Kaiwen und Hunter wies der Server bis zum 14.10.2026 als unbekannte
       Spielart ab, und die App hakte sie daraufhin als "oben" ab. Einmalig
       wieder freigeben: der Server nimmt sie jetzt, die Kennung macht das
       Hochladen idempotent. */
    if (!zustand.khNachgereicht) {
      zustand.hoch = zustand.hoch.filter(function (id) {
        var h = eintragNachId(id);
        return !(h && (h.kind === 'kaiwen' || h.kind === 'hunter') && !h.von);
      });
      zustand.khNachgereicht = 1;
    }
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
        var paket = {
          id: h.id,
          kind: art(h),
          at: h.at || Date.now(),
          payload: mitNamen(h),
          players: spielerListe(h)
        };
        if (ersetzenVorgemerkt(id)) paket.ersetzen = true;
        return window.DartKonto.ruf('POST', '/api/games', paket).then(function () {
          geschafft++;
          ersetzenErledigt(id);
          merkeAlsOben(id);
          entferneAusSchlange(id);
        }).catch(function (e) {
          // 4xx heisst: das schicken wir nie erfolgreich los. Sonst bliebe es
          // für immer in der Schlange und die Statuszeile lügt.
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
            letzterFehler = 'Ein Spiel liess sich nicht hochladen: ' + e.message;
            // Abhaken statt endlos wiederholen – sonst stellt backfill() das
            // Spiel bei jeder Anmeldung erneut an und der Fehler kommt wieder.
            // Aber mit Spur: das Konto zeigt, was liegen geblieben ist.
            merkeFehlschlag(id, e);
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

  /* Ein abgehaktes Spiel samt Grund festhalten; dasselbe Spiel steht nur
     einmal drin (der juengste Versuch zaehlt). Gedeckelt, damit der
     Speicher nicht mit uralten Fehlern vollaeuft. */
  function merkeFehlschlag(id, e) {
    zustand.fehlgeschlagen = zustand.fehlgeschlagen.filter(function (f) { return f.id !== id; });
    zustand.fehlgeschlagen.push({
      id: id,
      grund: (e && e.message) || (e && e.status ? 'HTTP ' + e.status : 'Unbekannter Fehler'),
      zeit: new Date().toISOString()
    });
    if (zustand.fehlgeschlagen.length > FEHLER_MAX) {
      zustand.fehlgeschlagen.splice(0, zustand.fehlgeschlagen.length - FEHLER_MAX);
    }
    sichern();
  }

  function fehlgeschlagen() { return zustand.fehlgeschlagen.slice(); }

  function fehlgeschlagenLeeren() {
    zustand.fehlgeschlagen = [];
    sichern();
  }

  /* Liegt das Spiel schon auf dem Server? (Fuer die Speicher-Entlastung in
     app.js: gesicherte Spiele duerfen zuerst ihre Einzeldarts verlieren.) */
  function hochgeladen(id) { return zustand.hoch.indexOf(id) >= 0; }

  /* Ein schon archiviertes Online-Spiel laeuft doch weiter (der Server
     meldete beim Beenden einen Konflikt, O21): der alte Upload gilt nicht
     mehr. Aus Schlange und "oben"-Liste nehmen und vormerken, dass die
     naechste Fassung die erste auf dem Server ersetzen soll. */
  function spielZurueckziehen(id) {
    if (!id) return;
    entferneAusSchlange(id);
    zustand.hoch = zustand.hoch.filter(function (x) { return x !== id; });
    /* Persistent im Sync-Zustand: das Spiel laeuft danach oft noch Minuten,
       ein Neuladen dazwischen darf die Vormerkung nicht vergessen. */
    if (zustand.ersetzen.indexOf(id) < 0) zustand.ersetzen.push(id);
    sichern();
  }
  function ersetzenVorgemerkt(id) { return zustand.ersetzen.indexOf(id) >= 0; }
  function ersetzenErledigt(id) {
    zustand.ersetzen = zustand.ersetzen.filter(function (x) { return x !== id; });
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
        if (D.turnierListeAktualisieren) D.turnierListeAktualisieren();
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
    if (!nutzer) return '';
    var n = zustand.outbox.length;
    /* Ohne Netz immer sichtbar, auch ohne wartende Spiele: der Spieler soll
       wissen, warum Zusage oder Abgleich gerade nicht ankommen - und dass
       nichts verloren geht. */
    if (navigator.onLine === false) {
      return 'Kein Netz – Spiele werden gespeichert und später hochgeladen' +
        (n ? ' (' + (n === 1 ? '1 Spiel wartet' : n + ' Spiele warten') + ')' : '');
    }
    if (!n) return '';
    return (n === 1 ? '1 Spiel wartet' : n + ' Spiele warten') + ' auf den Upload …';
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

  /* ================= Geteiltes Turnier ================= */
  /*
   * Ein Turnier, zwei Scheiben, zwei Geräte. Der Spielplan liegt auf dem
   * Server, die Partien werden dort beansprucht und die Ergebnisse sofort
   * eingetragen – nicht erst am Ende wie beim Turnier auf einem Gerät.
   *
   * Gerechnet wird weiterhin nur hier: der Server bekommt fertige Partien
   * und gibt sie unverändert wieder heraus. Er sorgt allein dafür, dass
   * nicht zwei Geräte dieselbe Partie mitschreiben.
   */
  var TURNIER_TAKT = 8000;
  var turnierTimer = null;

  function turnierRuf(methode, pfad, body) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf(methode, '/api/tournaments' + pfad, body);
  }

  /* Offene Turniere, an denen ich beteiligt bin – für die Liste im Setup. */
  function turniereOffen() {
    if (!nutzer) return Promise.resolve([]);
    return turnierRuf('GET', '').then(function (d) { return d.turniere || []; })
      .catch(function () { return []; });
  }

  function turnierAnlegen(sid, plan, spieler) {
    return turnierRuf('POST', '', { id: sid, plan: plan, players: spieler });
  }

  /*
   * Abgleich. Holt alles seit dem letzten Cursor und übergibt es app.js –
   * die Spiellogik bleibt dort. Gibt zurück, ob sich etwas geändert hat,
   * damit der Aufrufer nur dann neu zeichnet.
   */
  /* Jeder achte Abgleich (etwa einmal pro Minute) holt den GANZEN Stand
     statt nur der Neuigkeiten seit dem Cursor - so heilt sich jede Luecke,
     die ein Funkloch gerissen haben koennte. */
  var turnierRunde = 0;
  function turnierAbgleich(voll) {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid || !nutzer) return Promise.resolve(false);
    turnierRunde++;
    var seit = voll || turnierRunde % 8 === 0 ? 0 : (t.cursor || 0);
    return turnierRuf('GET', '/' + t.sid + '?since=' + seit).then(function (d) {
      var neu = D.uebernehmeTurnier(d.turnier);
      ergebnisseNachreichen();
      if (D.planNachreichen) D.planNachreichen();
      return neu;
    }).catch(function () {
      // Kein Netz oder Server weg: der Abend geht lokal weiter, der nächste
      // Takt holt auf. Nur nicht laut sein – das passiert im Hintergrund.
      return false;
    });
  }

  function turnierBeanspruchen(matchId) {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid) return Promise.resolve(true);
    return turnierRuf('POST', '/' + t.sid + '/matches/' + matchId + '/claim').then(function (d) {
      D.uebernehmeTurnier(d.turnier);
      return true;
    });
  }

  function turnierFreigeben(matchId) {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid) return Promise.resolve();
    return turnierRuf('POST', '/' + t.sid + '/matches/' + matchId + '/frei').then(function (d) {
      D.uebernehmeTurnier(d.turnier);
    }).catch(function () { /* nicht schlimm: der Anspruch verfällt von selbst */ });
  }

  function turnierErgebnis(match) {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid) return Promise.resolve();
    return turnierRuf('PUT', '/' + t.sid + '/matches/' + match.id, { result: match })
      .then(function (d) { match.gemeldet = true; D.uebernehmeTurnier(d.turnier); D.save(); })
      .catch(function (e) {
        /* 409: die Partie gehoert dem anderen Geraet - dessen Ergebnis gilt,
           hier nicht immer wieder anklopfen. Sonst (kein Netz, Server weg)
           reicht der naechste Takt es nach (ergebnisseNachreichen). */
        if (e && e.status === 409) {
          match.gemeldet = 'abgelehnt';
          if (e.daten && e.daten.turnier) D.uebernehmeTurnier(e.daten.turnier);   // das gueltige Ergebnis
          D.save();
        }
      });
  }

  /* Fertige Einzel, die beim Server nie angekommen sind (Funkloch beim
     Checkout), werden bei jedem Abgleich nachgereicht - hoechstens vier auf
     einmal, eins nach dem anderen. */
  var nachreichenLaeuft = false;
  function ergebnisseNachreichen() {
    var t = D.state().tour;
    if (nachreichenLaeuft || !t || !t.geteilt || !t.sid || !nutzer) return;
    var offen = D.state().matches.filter(function (m) { return m.done && !m.gemeldet && !m.void; }).slice(0, 4);
    if (!offen.length) return;
    nachreichenLaeuft = true;
    offen.reduce(function (p, m) { return p.then(function () { return turnierErgebnis(m); }); }, Promise.resolve())
      .then(function () { nachreichenLaeuft = false; }, function () { nachreichenLaeuft = false; });
  }

  function turnierEnde() {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid) return Promise.resolve();
    return turnierRuf('POST', '/' + t.sid + '/ende').catch(function () {});
  }

  /* Nur takten, solange man auch hinschaut: im Turnierbildschirm. Wie beim
     Online-Spiel nur neu starten, wenn sich der Zustand aendert. */
  var turnierTaktAn = false;
  var herzRunde = 0;
  function turnierTakt(an) {
    an = !!an;
    if (an === turnierTaktAn && (turnierTimer || !an)) return;
    turnierTaktAn = an;
    if (turnierTimer) { clearInterval(turnierTimer); turnierTimer = null; }
    if (!an) return;
    turnierTimer = setInterval(function () {
      if (document.hidden) return;
      turnierAbgleich().then(function (neu) { if (neu) D.render(); });
      herzRunde++;
      if (herzRunde % 11 === 0) turnierHerzschlag();
    }, TURNIER_TAKT);
  }

  /* Herzschlag: wer ein Einzel gerade spielt, erneuert seinen Anspruch.
     Hat das andere Geraet die Partie inzwischen uebernommen (weil hier zehn
     Minuten nichts kam), sagt app.js Bescheid. */
  function turnierHerzschlag() {
    var S = D.state(), t = S.tour;
    if (!t || !t.geteilt || !t.sid || !nutzer || !S.current || t.beendet) return;
    var m = S.matches.filter(function (x) { return x.id === S.current; })[0];
    if (!m || m.done || m.korrektur) return;
    /* Lebenszeichen, solange das Einzel hier laeuft: im Spiel, beim
       Ausbullen - oder wenn schon geworfen wurde, auch von einem anderen
       Bildschirm aus. */
    var angefangen = m.legs.some(function (l) { return l.visits.length > 0; });
    if (S.screen !== 'game' && S.screen !== 'bulloff' && !angefangen) return;
    turnierRuf('POST', '/' + t.sid + '/matches/' + m.id + '/claim').then(function (d) {
      D.uebernehmeTurnier(d.turnier);
    }).catch(function (e) {
      if (!e || e.status !== 409) return;
      var grund = e.daten && e.daten.grund;
      if (e.daten && e.daten.turnier) D.uebernehmeTurnier(e.daten.turnier);
      if (D.einzelVerloren) D.einzelVerloren(m.id, e.message, grund);
    });
  }

  /* Sofort abgleichen, wenn das Geraet wieder Netz hat oder aufgeweckt
     wird - nicht erst auf den naechsten Takt warten. */
  function turnierSofort() {
    var t = D.state().tour;
    if (!t || !t.geteilt || !t.sid || !nutzer) return;
    turnierAbgleich(true).then(function (neu) { if (neu) D.render(); });
    turnierHerzschlag();   // gleich melden, ob dieses Einzel noch hier laeuft
  }

  /* ================= Online-Spiel ================= */
  /*
   * Ein Schnelles Spiel oder Finisher an zwei Orten: beide stehen an ihrer
   * Scheibe, telefonieren, und statt dass einer blind mitschreibt, liegt
   * der Spielstand auf dem Server. Beide sehen ihn, beide tragen ein.
   *
   * Der Stand wandert als Ganzes (S.game ohne das online-Feld). Jede
   * Aenderung wird gegen die bekannte Version geschrieben; war der andere
   * schneller, gibt der Server 409 samt neuem Stand -- den uebernimmt
   * app.js dann, statt ihn zu ueberschreiben. Gerechnet wird weiterhin nur
   * im Client, der Server verwahrt bloss.
   */
  var LIVE_TAKT = 2500;          // ohne Live-Verbindung: so oft nachfragen
  var LIVE_TAKT_STROM = 10000;   // mit Live-Verbindung nur noch als Rueckfall
  var liveTimer = null;
  var liveTaktAn = null;         // sid, fuer die gerade getaktet wird (oder null)
  var liveStrom = null;          // EventSource auf /api/live/:id/strom
  var liveStromOffen = false;    // Verbindung steht und liefert
  /* Neuaufbau nach endgueltigem Fehler: erst nach 5 s, dann doppelt so lang
     bis hoechstens eine Minute; eine gelungene Verbindung setzt zurueck. */
  var LIVE_STROM_WARTE = 5000, LIVE_STROM_WARTE_MAX = 60000;
  var liveStromWarte = LIVE_STROM_WARTE;
  var liveStromNeuTimer = null;
  var liveSchreibt = null;   // laufender PUT, damit nicht zwei ueberholen
  var liveDran = false;      // waehrend des PUT kam schon die naechste Aenderung
  var liveStoerung = false;  // letzter Ruf ging schief (kein Netz, Server weg)
  /* Wechsel sofort zeigen: app.js blendet dann "keine Verbindung" gut
     sichtbar ein bzw. wieder aus. */
  function stoerung(wert) {
    if (liveStoerung === wert) return;
    liveStoerung = wert;
    if (D && D.render) setTimeout(D.render, 0);
  }

  function liveRuf(methode, pfad, body, extra) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf(methode, '/api/live' + pfad, body, extra);
  }

  /* Offene Online-Spiele, an denen ich beteiligt bin – für das Setup. */
  function liveOffen() {
    if (!nutzer) return Promise.resolve([]);
    return liveRuf('GET', '').then(function (d) { return d.spiele || []; })
      .catch(function () { return []; });
  }

  function liveAnlegen(id, kind, state, spieler) {
    return liveRuf('POST', '', { id: id, kind: kind, state: state, players: spieler })
      .then(function (d) { return d.spiel; });
  }

  function liveHolen(id, seit) {
    return liveRuf('GET', '/' + id + '?since=' + (seit || 0)).then(function (d) { return d.spiel; });
  }

  /*
   * Eigenen Stand hochschieben. app.js ruft das nach jeder Aenderung; hier
   * wird nur dafuer gesorgt, dass immer genau ein PUT unterwegs ist und der
   * juengste Stand als letzter ankommt.
   */
  function liveSchreiben(eilig) {
    var g = D.state().game;
    if (!g || !g.online || !nutzer) return Promise.resolve(false);
    if (liveSchreibt) { liveDran = true; return liveSchreibt; }
    var stand = D.liveStand();
    if (!stand) return Promise.resolve(false);
    /* keepalive erlauben Browser nur bis 64 KB Body - ein langes Spiel
       geht dann als normale Anfrage raus (und notfalls beim Aufwecken). */
    var mitKeepalive = eilig && stand.text.length < 60000;
    liveSchreibt = liveRuf('PUT', '/' + g.online.sid, { state: stand.state, seq: stand.seq }, mitKeepalive ? { keepalive: true } : undefined)
      .then(function (d) {
        stoerung(false);
        D.liveGeschrieben(d.spiel, stand.text);
        return true;
      }, function (e) {
        if (e && e.status === 409 && e.daten && e.daten.spiel) {
          // Der andere war schneller: sein Stand gilt, meiner ist hinfaellig.
          stoerung(false);
          if (D.liveUebernehmen(e.daten.spiel, true)) D.render();
          return false;
        }
        if (e && e.status === 409) {
          // Beendet: den Schlussstand sofort holen, statt still zu warten --
          // liveUebernehmen zeigt dann, wer gespeichert oder abgebrochen hat.
          stoerung(false);
          setTimeout(function () {
            liveAbgleich().then(function (neu) { if (neu) D.render(); });
          }, 0);
          return false;
        }
        stoerung(true);
        return false;
      })
      .then(function (erg) {
        liveSchreibt = null;
        if (liveDran) { liveDran = false; return liveSchreiben(); }
        return erg;
      });
    return liveSchreibt;
  }

  /* Abgleich: gibt es beim Server einen neueren Stand, uebernimmt ihn app.js. */
  function liveAbgleich() {
    var g = D.state().game;
    if (!g || !g.online || !nutzer) return Promise.resolve(false);
    if (liveSchreibt) return Promise.resolve(false);
    return liveHolen(g.online.sid, g.online.seq || 0).then(function (spiel) {
      stoerung(false);
      return D.liveUebernehmen(spiel, false);
    }).catch(function (e) {
      // 404/403: das Spiel ist weg oder ich gehoere nicht mehr dazu -- lokal
      // weiterspielen, aber nicht mehr nachfragen.
      if (e && (e.status === 404 || e.status === 403)) { D.liveGetrennt(); return true; }
      stoerung(true);
      return false;
    });
  }

  /* Zu -- mit Schlussstand in einem Rutsch, nachdem ein laufender PUT
     durch ist. So kommt "Speichern" nie vor dem letzten Wurf an.

     Die Version (`seq`) reist mit, damit der Schlussstand dieselbe Pruefung
     durchlaeuft wie jeder PUT: hat der andere inzwischen etwas eingetragen
     (etwa den Checkout zurueckgenommen), antwortet der Server 409 mit dem
     geltenden Stand statt ihn zu ueberschreiben. Dann kommt hier ein Fehler
     mit `status: 409` und `stand` (die Spiel-Antwort des Servers) zurueck;
     app.js uebernimmt ihn und entscheidet neu. Alle anderen Fehler bleiben
     wie bisher stumm - das Spiel ist lokal ohnehin fertig. */
  function liveEnde(id, stand) {
    if (!nutzer || !id) return Promise.resolve();
    var vorher = liveSchreibt || Promise.resolve();
    return vorher.catch(function () {}).then(function () {
      var body = {};
      if (stand && stand.state) body.state = stand.state;
      if (stand && stand.seq !== undefined && stand.seq !== null) body.seq = stand.seq;   // auch ohne state: Versionspruefung
      return liveRuf('POST', '/' + id + '/ende', body);
    }).catch(function (e) {
      if (e && e.status === 409 && e.daten && e.daten.spiel) {
        var konflikt = new Error(e.message || 'Der andere war schneller.');
        konflikt.status = 409;
        konflikt.stand = e.daten.spiel;
        throw konflikt;
      }
    });
  }

  /* Ein Durchgang: erst Eigenes loswerden, dann nachsehen, was der andere
     gemacht hat. */
  function liveRunde() {
    var g = D.state().game;
    if (!g || !g.online || g.online.wartet) return Promise.resolve(false);
    var p = D.liveStand() ? liveSchreiben() : Promise.resolve(false);
    return p.then(function () { return liveAbgleich(); })
      .then(function (neu) { if (neu) D.render(); return neu; });
  }

  /*
   * Nur takten, solange ein Online-Spiel laeuft und man es anschaut.
   * render() ruft das bei jedem Zeichnen -- neu gestartet wird aber nur,
   * wenn sich wirklich etwas aendert. Frueher setzte jeder Tastendruck den
   * Takt auf null, und waehrend einer laengeren Eingabe kam nichts herein.
   *
   * Der Server meldet jede Aenderung ueber eine Live-Verbindung
   * (Server-Sent Events). Steht sie, reicht ein langsamer Rueckfall-Takt;
   * ohne sie (alter Server, Funkloch) wird wie bisher alle 2,5 s gefragt.
   */
  function liveTakt(an) {
    var g = D.state().game;
    var sid = an && g && g.online ? g.online.sid : null;
    if (sid === liveTaktAn) return;
    liveTaktAn = sid;
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    liveStromZu();
    if (!sid) return;
    liveStromAuf(sid);
    liveTaktStellen();
  }

  function liveTaktStellen() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(function () {
      if (document.hidden) return;
      liveRunde();
    }, liveStromOffen ? LIVE_TAKT_STROM : LIVE_TAKT);
  }

  function liveStromAuf(sid) {
    if (typeof EventSource === 'undefined') return;
    try {
      liveStrom = new EventSource('/api/live/' + encodeURIComponent(sid) + '/strom', { withCredentials: true });
    } catch (e) { liveStrom = null; return; }
    var quelle = liveStrom;
    quelle.addEventListener('open', function () {
      if (quelle !== liveStrom) return;
      liveStromWarte = LIVE_STROM_WARTE;
      if (!liveStromOffen) { liveStromOffen = true; liveTaktStellen(); }
      // Was waehrend des Verbindungsaufbaus geschah, gleich nachholen.
      liveRunde();
    });
    quelle.addEventListener('stand', function (ev) {
      if (quelle !== liveStrom) return;
      var d = null;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      var g = D.state().game;
      if (!g || !g.online || !d) return;
      if (typeof d.seq === 'number' && d.seq <= (g.online.seq || 0) && d.status !== 'zu') return;
      liveRunde();
    });
    quelle.addEventListener('error', function () {
      if (quelle !== liveStrom) return;
      /* Der Browser versucht es selbst erneut. Bis dahin wieder schnell
         fragen. Antwortet der Server mit einem Fehler (Deploy -> 502, zu
         viele Anfragen -> 429, alter Server ohne Route -> 404), ist die
         Verbindung endgueltig zu und der Browser tut nichts mehr - dann
         bauen wir sie selbst wieder auf, sonst bliebe es fuer den Rest des
         Abends beim 2,5-s-Takt. */
      if (liveStromOffen) { liveStromOffen = false; liveTaktStellen(); }
      if (quelle.readyState === 2) { liveStrom = null; liveStromNeuPlanen(); }
    });
  }

  function liveStromNeuPlanen() {
    if (liveStromNeuTimer || !liveTaktAn) return;
    liveStromNeuTimer = setTimeout(function () {
      liveStromNeuTimer = null;
      /* Im Hintergrund nicht anklopfen - iOS wirft die Verbindung sowieso
         gleich weg; visibilitychange versucht es beim Zurueckkommen. */
      if (document.hidden) return;
      liveStromNeu();
    }, liveStromWarte);
    liveStromWarte = Math.min(liveStromWarte * 2, LIVE_STROM_WARTE_MAX);
  }

  /* Sofort neu aufmachen, falls gerade keine Verbindung steht oder selbst
     neu verbindet (Netz zurueck, App wieder vorn, Backoff abgelaufen). */
  function liveStromNeu() {
    if (!liveTaktAn) return;
    if (liveStrom && liveStrom.readyState !== 2) return;
    if (liveStromNeuTimer) { clearTimeout(liveStromNeuTimer); liveStromNeuTimer = null; }
    liveStromAuf(liveTaktAn);
  }

  function liveStromZu() {
    if (liveStrom) { try { liveStrom.close(); } catch (e) { /* egal */ } }
    liveStrom = null;
    liveStromOffen = false;
    if (liveStromNeuTimer) { clearTimeout(liveStromNeuTimer); liveStromNeuTimer = null; }
    liveStromWarte = LIVE_STROM_WARTE;
  }

  function liveStatus() {
    return { stoerung: liveStoerung, schreibt: !!liveSchreibt, strom: liveStromOffen };
  }

  /* ================= Liga-Zusagen ================= */
  /*
   * Wer ist beim Spieltag dabei? Die Termine kennt der Client (LIGA in
   * js/app.js), der Server verwahrt nur die Zusagen je Termin-Kennung.
   */
  function ligaZusagenHolen() {
    if (!window.DartKonto || !nutzer) return Promise.resolve(null);
    return window.DartKonto.ruf('GET', '/api/liga/zusagen')
      .then(function (d) { return d.zusagen || {}; })
      .catch(function () { return null; });
  }

  function ligaZusageSetzen(terminId, dabei) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    /* dabei: bool (Spieltage) oder Status-String (Training: dabei /
       unsicher / absage; null traegt aus). */
    var body = typeof dabei === 'string' ? { status: dabei }
      : dabei === null ? { dabei: false }
      : { dabei: !!dabei };
    return window.DartKonto.ruf('PUT', '/api/liga/zusagen/' + encodeURIComponent(terminId), body)
      .then(function (d) { return d.zusagen || {}; });
  }

  /* Die Vereinskasse: Kassenbuch mit Bestand, fuer alle dasselbe. */
  function kasseHolen() {
    if (!window.DartKonto || !nutzer) return Promise.resolve(null);
    return window.DartKonto.ruf('GET', '/api/kasse');
  }
  /* daten: { betrag (Cent), text, kategorie, datum (YYYY-MM-DD), mitglied? } */
  function kasseBuchen(daten) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf('POST', '/api/kasse', daten);
  }
  function kasseAendern(id, daten) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf('PATCH', '/api/kasse/' + id, daten);
  }
  function kasseEinstellen(daten) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf('PATCH', '/api/kasse/konfig', daten);
  }
  function kasseLoeschen(id) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf('DELETE', '/api/kasse/' + id);
  }

  /* Die manuell gepflegte Ligatabelle: ein Blob auf dem Server. */
  function ligaTabelleHolen() {
    if (!window.DartKonto || !nutzer) return Promise.resolve(null);
    return window.DartKonto.ruf('GET', '/api/liga/tabelle')
      .then(function (d) { return d.tabelle || null; })
      .catch(function () { return null; });
  }

  function ligaTabelleSpeichern(tabelle) {
    if (!window.DartKonto || !nutzer) return Promise.reject(new Error('Nicht angemeldet.'));
    return window.DartKonto.ruf('PUT', '/api/liga/tabelle', { tabelle: tabelle });
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
      wartend: function () { return zustand.outbox.length; },
      /* Endgueltig abgehakte Uploads: [{ id, grund, zeit }], juengster zuletzt. */
      fehlgeschlagen: fehlgeschlagen,
      fehlgeschlagenLeeren: fehlgeschlagenLeeren,
      hochgeladen: hochgeladen,
      spielZurueckziehen: spielZurueckziehen,
      liga: {
        zusagen: ligaZusagenHolen,
        zusage: ligaZusageSetzen,
        tabelle: ligaTabelleHolen,
        tabelleSpeichern: ligaTabelleSpeichern
      },
      kasse: {
        holen: kasseHolen,
        buchen: kasseBuchen,
        aendern: kasseAendern,
        einstellen: kasseEinstellen,
        loeschen: kasseLoeschen
      },
      turnier: {
        offen: turniereOffen,
        anlegen: turnierAnlegen,
        abgleich: turnierAbgleich,
        beanspruchen: turnierBeanspruchen,
        freigeben: turnierFreigeben,
        ergebnis: turnierErgebnis,
        ende: turnierEnde,
        /* Ein Turnier per Kennung schliessen, das lokal schon weg ist
           (12-Stunden-Grenze beim App-Start). */
        endeId: function (sid) { return turnierRuf('POST', '/' + sid + '/ende').catch(function () {}); },
        /* Geaenderten Plan schicken (Spielerwechsel im geteilten Ligaspiel). */
        planAendern: function (plan, basis) {
          var t = D.state().tour;
          if (!t || !t.geteilt || !t.sid) return Promise.reject(new Error('Kein geteiltes Turnier.'));
          return turnierRuf('POST', '/' + t.sid + '/plan', { plan: plan, basis: basis });
        },
        takt: turnierTakt,
        herzschlag: turnierHerzschlag,
        /* Live-Ticker: laufender Stand des gespielten Einzels (Fehler egal -
           der naechste Wurf schickt ihn wieder). */
        liveStand: function (mid, stand) {
          var t = D.state().tour;
          if (!t || !t.geteilt || !t.sid || !nutzer) return Promise.resolve();
          return turnierRuf('PUT', '/' + t.sid + '/matches/' + mid + '/live', { stand: stand }).catch(function () {});
        }
      },
      live: {
        offen: liveOffen,
        anlegen: liveAnlegen,
        holen: liveHolen,
        schreiben: liveSchreiben,
        abgleich: liveAbgleich,
        ende: liveEnde,
        takt: liveTakt,
        runde: liveRunde,
        status: liveStatus
      }
    };

    // Wieder online, App wieder im Vordergrund, oder einfach nach einer Weile.
    window.addEventListener('online', function () {
      statusNeu();          // die "Kein Netz"-Leiste sofort weg
      jetzt();
      turnierSofort();
      liveStromNeu();
    });
    // Netz weg: die Leiste sofort zeigen, nicht erst beim naechsten Zeichnen.
    window.addEventListener('offline', statusNeu);
    document.addEventListener('visibilitychange', function () {
      var g = D.state().game;
      var online = g && g.online && !g.online.wartet;
      if (document.hidden) {
        /* Gleich wird gesperrt: was noch nicht oben ist, jetzt losschicken
           (keepalive ueberlebt das Einfrieren der Seite), sonst laege die
           Buchung bis zum Aufwecken nur hier. */
        if (online && D.liveStand()) liveSchreiben(true);
        return;
      }
      jetzt();
      turnierSofort();
      /* Zurueck am Handy: sofort nachsehen, nicht erst auf den Takt warten -
         und den Live-Strom wieder aufmachen, falls er im Hintergrund starb. */
      if (online && liveTaktAn) { liveStromNeu(); liveRunde(); }
    });
    setInterval(function () {
      if (nutzer && (zustand.outbox.length || !document.hidden)) jetzt();
    }, TAKT);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
