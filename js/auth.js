/*
 * Konto-Schicht: Anmelden, Registrieren, Roster, Zuordnung alter Profile.
 *
 * Diese Datei ist OPTIONAL. Ohne Server – Einzeldatei-Bündel, index.html per
 * Doppelklick – meldet sie sich gar nicht erst an, und die App läuft wie
 * bisher rein lokal weiter. Deshalb steht hier auch keine Spiellogik.
 *
 * Angedockt wird ausschließlich über window.__dart (siehe js/app.js).
 */
(function () {
  'use strict';

  // Ohne Server gibt es niemanden, bei dem man sich anmelden könnte.
  if (location.protocol.indexOf('http') !== 0) return;

  var D = null;                    // Brücke zu app.js
  var nutzer = null;               // angemeldeter Account oder null
  var roster = [];                 // alle Accounts
  var ansicht = 'login';           // login | register | konto | passwort | zuordnung
  var meldung = '';                // Fehler- oder Erfolgstext
  var meldungArt = 'fehler';
  var beschaeftigt = false;
  var profilOffen = false;         // eigenes Profil geaendert, aber noch nicht hochgeladen
  var gesperrtFlag = false;        // Anmeldung noetig, bevor die App benutzbar ist

  var SICHERUNG = 'dart-turnier-vor-anmeldung';

  /* ================= Server ================= */

  function ruf(methode, pfad, body) {
    var opt = {
      method: methode,
      headers: { 'X-Darts-App': '1' },
      // Ohne credentials schickt der Browser das Session-Cookie nicht mit,
      // wenn die Seite von einer anderen Herkunft geladen wurde.
      credentials: 'same-origin'
    };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(pfad, opt).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (daten) {
        if (!res.ok) {
          var e = new Error(daten.fehler || 'Der Server hat die Anfrage abgelehnt.');
          e.status = res.status;
          throw e;
        }
        return daten;
      });
    });
  }

  /* ================= Profile und Roster ================= */

  function istAccount(id) { return String(id).indexOf('u_') === 0; }

  /* Nur das eigene Profil und Gastspieler lassen sich hier ändern. */
  function darfBearbeiten(id) {
    if (!istAccount(id)) return true;
    return !!nutzer && id === nutzer.id;
  }

  /*
   * Eigenes Profil geändert (Name, Bild, Farbe). Muss zum Server, sonst
   * überschreibt der nächste Abgleich die Änderung wieder mit dem alten Stand.
   * Solange das nicht durch ist, gilt der lokale Stand – siehe profilOffen.
   */
  function profilGeaendert(id) {
    if (!nutzer || id !== nutzer.id) return;
    profilOffen = true;
    sichereProfil().catch(function () {
      /* Kein Netz: bleibt offen und geht beim nächsten Abgleich raus. */
    });
  }

  function sichereProfil() {
    if (!nutzer) return Promise.resolve();
    var p = D.profile(nutzer.id);
    if (!p) return Promise.resolve();
    return ruf('PATCH', '/api/me', { name: p.name, avatar: p.avatar, hue: p.hue, dbl: p.dbl || null }).then(function (daten) {
      nutzer = daten.nutzer;
      profilOffen = false;
    });
  }

  /* Jeder Account braucht ein Profil, sonst taucht er in Aufstellung und
     Rangliste nicht auf – career() zählt nur über S.profiles. */
  function rosterInProfile() {
    var S = D.state();
    var nachId = {};
    S.profiles.forEach(function (p) { nachId[p.id] = p; });

    roster.forEach(function (r) {
      var p = nachId[r.id];
      if (p) {
        // Eigenes Profil mit noch nicht hochgeladener Änderung: der lokale
        // Stand ist der neuere und darf nicht plattgemacht werden.
        if (profilOffen && nutzer && r.id === nutzer.id) return;
        p.name = r.name;
        p.avatar = r.avatar;
        if (typeof r.hue === 'number' && r.hue) p.hue = r.hue;
        // Das Lieblingsdoppel gehoert dem Account, nicht dem Geraet: so gilt
        // es auch, wenn ein Kollege den Abend auf seinem iPad mitschreibt.
        p.dbl = r.dbl || null;
        p.hidden = false;
      } else {
        S.profiles.push({
          id: r.id, name: r.name, avatar: r.avatar,
          hue: typeof r.hue === 'number' && r.hue ? r.hue : D.freeHue(),
          dbl: r.dbl || null,
          created: Date.now()
        });
      }
    });
    D.save();
  }

  /* Lokale Profile, zu denen wir noch nicht wissen, wer das ist. */
  function offeneZuordnung() {
    return D.state().profiles.filter(function (p) {
      return !istAccount(p.id) && !p.gast && !p.hidden;
    });
  }

  function holeRoster() {
    // Erst die eigene offene Aenderung hochschicken, dann den Stand holen --
    // sonst holt man sich den alten Namen zurueck, den man gerade geaendert hat.
    var vorlauf = profilOffen ? sichereProfil().catch(function () {}) : Promise.resolve();
    return vorlauf.then(function () {
      return ruf('GET', '/api/users');
    }).then(function (daten) {
      roster = daten.nutzer || [];
      rosterInProfile();
    });
  }

  /* ================= Anmeldezustand ================= */

  function nachAnmeldung(neuerNutzer) {
    nutzer = neuerNutzer;
    setzeSchranke(false);
    merkeServer(nutzer);
    return holeRoster().then(function () {
      if (window.DartSync) window.DartSync.angemeldet(nutzer);
      if (offeneZuordnung().length) {
        // Erst klären, wer wer ist – danach geht es in die App.
        ansicht = 'zuordnung';
        letzterSchluessel = null;
        D.setScreen('konto');
      } else {
        // Ganz normaler Anmeldevorgang: nach dem Anmelden ist man drin.
        ansicht = 'konto';
        letzterSchluessel = null;
        D.setScreen('setup');
      }
    });
  }

  function abmelden() {
    // Erst die Schranke setzen, dann rendern – sonst blitzt die App kurz auf.
    function zurueckZurAnmeldung() {
      nutzer = null;
      roster = [];
      setzeSchranke(true);
      merkeServer(null);
      if (window.DartSync) window.DartSync.abgemeldet();
      ansicht = 'login';
      setzeMeldung('Du bist abgemeldet. Deine Spiele bleiben auf diesem Gerät gespeichert.', 'ok');
      neuZeichnen();
    }
    return ruf('POST', '/api/logout').then(zurueckZurAnmeldung).catch(function () {
      // Ohne Netz lässt sich die Session serverseitig nicht beenden. Auf
      // diesem Gerät abmelden ist trotzdem richtig – der Server räumt die
      // Session spätestens nach 90 Tagen selbst weg.
      zurueckZurAnmeldung();
    });
  }

  /* ================= Zuordnung alter Profile ================= */

  /*
   * Beim ersten Anmelden zeigt die Historie noch auf lokale Kennungen. Wer
   * hier einem Account zugeordnet wird, dessen Vergangenheit wandert mit –
   * einmalig und unumkehrbar, deshalb vorher eine Sicherung wegschreiben.
   */
  function zuordnungSpeichern(box) {
    var map = {};
    var gaeste = [];
    box.querySelectorAll('select[data-profil]').forEach(function (sel) {
      var lokal = sel.getAttribute('data-profil');
      if (sel.value === 'gast') gaeste.push(lokal);
      else if (sel.value) map[lokal] = sel.value;
    });

    // Denselben Account zweimal zu vergeben würde zwei Historien
    // ineinanderschieben, die nicht zusammengehören.
    var belegt = {};
    for (var lokal in map) {
      if (belegt[map[lokal]]) {
        setzeMeldung('Ein Account kann nur einem Profil zugeordnet werden. Bitte nochmal prüfen.', 'fehler');
        neuZeichnen(true);
        return;
      }
      belegt[map[lokal]] = 1;
    }

    try {
      localStorage.setItem(SICHERUNG, localStorage.getItem('dart-turnier-v1') || '');
    } catch (e) {
      // Kein Platz für die Sicherung: dann lieber nichts umschreiben.
      setzeMeldung('Es liess sich keine Sicherung anlegen. Bitte Speicherplatz freigeben.', 'fehler');
      neuZeichnen(true);
      return;
    }

    gaeste.forEach(function (id) {
      var p = D.profile(id);
      if (p) p.gast = true;
    });
    if (Object.keys(map).length) D.ersetzeSpielerIds(map);
    D.save();

    ansicht = 'konto';
    setzeMeldung('Zuordnung gespeichert. Deine bisherigen Spiele zählen jetzt auf die Accounts.', 'ok');
    // Die zugeordneten Spiele gehören jetzt Accounts – also hochladen.
    if (window.DartSync) window.DartSync.nachZuordnung();
    neuZeichnen();
  }

  /* ================= Zeichnen ================= */

  function setzeMeldung(text, art) {
    meldung = text;
    meldungArt = art || 'fehler';
  }

  function esc(s) { return D.esc(String(s == null ? '' : s)); }

  /*
   * Was die Ansicht ausmacht – und ausdrücklich NICHT `beschaeftigt`: sonst
   * würde das Formular beim Absenden neu aufgebaut und die eingetippten
   * Felder wären leer, bevor sie ausgelesen sind.
   */
  function ansichtSchluessel() {
    return ansicht + '|' + (nutzer ? nutzer.id : '-') + '|' + roster.length;
  }

  function feld(id, label, typ, hinweis) {
    return '<label class="konto-feld"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" type="' + typ + '" autocapitalize="none" autocorrect="off" spellcheck="false"' +
      (hinweis ? ' placeholder="' + esc(hinweis) + '"' : '') + '></label>';
  }

  function htmlLogin() {
    return '<div class="card konto-karte">' +
      '<div class="konto-tabs">' +
        '<button class="' + (ansicht === 'login' ? 'active' : '') + '" data-action="konto-tab-login">Anmelden</button>' +
        '<button class="' + (ansicht === 'register' ? 'active' : '') + '" data-action="konto-tab-register">Neu hier</button>' +
      '</div>' +
      (ansicht === 'register'
        ? '<p class="hint">Du brauchst den Einladungscode aus der Gruppe.</p>' +
          feld('konto-invite', 'Einladungscode', 'text') +
          feld('konto-name', 'Anzeigename', 'text', 'wie dich alle nennen') +
          feld('konto-email', 'E-Mail', 'email') +
          feld('konto-pass', 'Passwort', 'password', 'mindestens 10 Zeichen') +
          '<button class="btn primary full" data-action="konto-register">Account anlegen</button>'
        : feld('konto-email', 'E-Mail', 'email') +
          feld('konto-pass', 'Passwort', 'password') +
          '<button class="btn primary full" data-action="konto-login">Anmelden</button>') +
      '<p class="hint">Einmal angemeldet, läuft die App auch ohne Netz weiter – ' +
        'die Spiele werden nachgereicht, sobald wieder Empfang da ist.</p>' +
      '</div>';
  }

  function htmlZuordnung() {
    var offen = offeneZuordnung();
    var frei = roster.slice();
    var zeilen = offen.map(function (p) {
      var opt = ['<option value="gast">— bleibt Gastspieler —</option>'];
      frei.forEach(function (r) {
        // Sich selbst schlägt man als Erstes vor: gleicher Name, gleiche Person.
        var passt = r.name.toLowerCase() === p.name.toLowerCase();
        opt.push('<option value="' + esc(r.id) + '"' + (passt ? ' selected' : '') + '>' + esc(r.name) + '</option>');
      });
      return '<div class="zuordnung-zeile">' +
        D.avatarHTML(p, 'sm') +
        '<div class="who"><div class="nm">' + esc(p.name) + '</div>' +
        '<div class="sm">lokales Profil</div></div>' +
        '<select data-profil="' + esc(p.id) + '">' + opt.join('') + '</select>' +
        '</div>';
    }).join('');

    return '<div class="card konto-karte">' +
      '<h2>Wer ist wer?</h2>' +
      '<p class="hint">Auf diesem Gerät gibt es Spieler aus der Zeit vor der Anmeldung. ' +
      'Ordne sie den Accounts zu, dann zählen ihre bisherigen Spiele dort weiter. ' +
      'Wer keinen Account hat, bleibt Gastspieler – das geht weiterhin.</p>' +
      zeilen +
      '<p class="hint">Das lässt sich später nicht mehr ändern. Eine Sicherung des ' +
      'jetzigen Standes wird vorher angelegt.</p>' +
      '<button class="btn primary full" data-action="konto-zuordnung-speichern">Zuordnung übernehmen</button>' +
      '</div>';
  }

  function htmlKonto() {
    var offen = offeneZuordnung().length;
    var syncText = window.DartSync ? window.DartSync.langText() : '';
    return '<div class="card konto-karte">' +
      '<div class="konto-kopf">' +
        D.avatarHTML(D.profile(nutzer.id), 'md') +
        '<div class="who"><div class="nm">' + esc(nutzer.name) + '</div>' +
        '<div class="sm">' + esc(nutzer.email) + '</div></div>' +
      '</div>' +
      (syncText ? '<p class="hint">' + esc(syncText) + '</p>' : '') +
      '<button class="btn full" data-action="konto-sync">Jetzt abgleichen</button>' +
      (offen ? '<button class="btn full" data-action="konto-zuordnen">Alte Profile zuordnen (' + offen + ')</button>' : '') +
      '<button class="btn ghost full" data-action="konto-passwort">Passwort ändern</button>' +
      '<button class="btn ghost full" data-action="konto-logout">Abmelden</button>' +
      '</div>' +
      '<div class="card konto-karte">' +
        '<h2>Mitspieler</h2>' +
        '<p class="hint">Alle, die sich angemeldet haben. Du kannst sie im Turnier ' +
        'auswählen und für sie mitschreiben.</p>' +
        (roster.map(function (r) {
          return '<div class="zuordnung-zeile">' + D.avatarHTML(D.profile(r.id), 'sm') +
            '<div class="who"><div class="nm">' + esc(r.name) + '</div></div></div>';
        }).join('') || '<p class="hint">Noch niemand sonst.</p>') +
      '</div>';
  }

  function htmlPasswort() {
    return '<div class="card konto-karte">' +
      '<h2>Passwort ändern</h2>' +
      feld('konto-pass-alt', 'Bisheriges Passwort', 'password') +
      feld('konto-pass-neu', 'Neues Passwort', 'password', 'mindestens 10 Zeichen') +
      '<p class="hint">Deine anderen Geräte werden dabei abgemeldet.</p>' +
      '<button class="btn primary full" data-action="konto-passwort-speichern">Speichern</button>' +
      '<button class="btn ghost full" data-action="konto-zurueck">Zurück</button>' +
      '</div>';
  }

  var letzterSchluessel = null;

  function render() {
    var box = document.getElementById('konto-inhalt');
    if (!box) return;
    var schluessel = ansichtSchluessel();
    // Nur neu aufbauen, wenn sich die Ansicht wirklich ändert – sonst wären
    // halb getippte Passwörter nach jedem render() weg.
    if (schluessel !== letzterSchluessel) {
      letzterSchluessel = schluessel;
      var inhalt = nutzer
        ? (ansicht === 'zuordnung' ? htmlZuordnung() : ansicht === 'passwort' ? htmlPasswort() : htmlKonto())
        : htmlLogin();
      box.innerHTML = '<p id="konto-meldung" class="konto-meldung hidden"></p>' + inhalt;
    }
    var m = document.getElementById('konto-meldung');
    if (m) {
      m.textContent = meldung;
      m.className = 'konto-meldung ' + meldungArt + (meldung ? '' : ' hidden');
    }
  }

  /*
   * `nurKonto` zeichnet nur diesen Bildschirm neu. Ohne das Flag geht der
   * Auftrag an app.js – nötig, wenn sich auch anderswo etwas geändert hat
   * (Nav-Knopf, Aufstellung im Setup, Rangliste).
   */
  function neuZeichnen(nurKonto) {
    letzterSchluessel = null;
    if (nurKonto) render();
    else window.__dart.render();
  }

  function wert(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  /* ================= Aktionen ================= */

  function fehlerZeigen(e) {
    setzeMeldung(e && e.message ? e.message : 'Keine Verbindung zum Server.', 'fehler');
    beschaeftigt = false;
    neuZeichnen(true);
  }

  function aktion(name, el) {
    if (beschaeftigt) return;
    switch (name) {
      case 'konto-tab-login':
        ansicht = 'login'; setzeMeldung(''); neuZeichnen(true); break;
      case 'konto-tab-register':
        ansicht = 'register'; setzeMeldung(''); neuZeichnen(true); break;
      case 'konto-zurueck':
        ansicht = 'konto'; setzeMeldung(''); neuZeichnen(true); break;
      case 'konto-zuordnen':
        ansicht = 'zuordnung'; setzeMeldung(''); neuZeichnen(true); break;

      case 'konto-login': {
        // Erst lesen, dann zeichnen – nie umgekehrt.
        var anmeldung = { email: wert('konto-email'), password: wert('konto-pass') };
        beschaeftigt = true; setzeMeldung('Melde an …', 'ok'); render();
        ruf('POST', '/api/login', anmeldung)
          .then(function (daten) {
            beschaeftigt = false;
            setzeMeldung('');
            return nachAnmeldung(daten.nutzer);
          })
          .catch(fehlerZeigen);
        break;
      }

      case 'konto-register': {
        var anmeldedaten = {
          invite: wert('konto-invite'),
          name: wert('konto-name'),
          email: wert('konto-email'),
          password: wert('konto-pass'),
          hue: D.freeHue()
        };
        beschaeftigt = true; setzeMeldung('Lege den Account an …', 'ok'); render();
        ruf('POST', '/api/register', anmeldedaten)
          .then(function (daten) {
            beschaeftigt = false;
            setzeMeldung('');
            return nachAnmeldung(daten.nutzer);
          })
          .catch(fehlerZeigen);
        break;
      }

      case 'konto-logout':
        beschaeftigt = true;
        abmelden().catch(fehlerZeigen).then(function () { beschaeftigt = false; });
        break;

      case 'konto-passwort':
        ansicht = 'passwort'; setzeMeldung(''); neuZeichnen(true); break;

      case 'konto-passwort-speichern':
        beschaeftigt = true;
        ruf('POST', '/api/password', { alt: wert('konto-pass-alt'), neu: wert('konto-pass-neu') })
          .then(function () {
            beschaeftigt = false;
            ansicht = 'konto';
            setzeMeldung('Passwort geändert. Andere Geräte wurden abgemeldet.', 'ok');
            neuZeichnen(true);
          })
          .catch(fehlerZeigen);
        break;

      case 'konto-zuordnung-speichern':
        zuordnungSpeichern(document.getElementById('konto-inhalt'));
        break;

      case 'konto-sync':
        if (!window.DartSync) return;
        setzeMeldung('Gleiche ab …', 'ok'); render();
        window.DartSync.jetzt().then(function (bericht) {
          setzeMeldung(bericht, 'ok');
          letzterSchluessel = null;
          render();
        }).catch(fehlerZeigen);
        break;
    }
  }

  /* ================= Anmeldeschranke ================= */

  /*
   * Wer hier landet, muss sich anmelden, bevor die App benutzbar ist.
   *
   * Der Haken daran ist der Offline-Betrieb: in der Kneipe darf die App nicht
   * aussperren, nur weil das WLAN weg ist. Deshalb merken wir uns zwei Dinge
   * dauerhaft — dass hinter dieser Adresse ein Dart-Server steht, und wer
   * zuletzt angemeldet war. Daraus ergeben sich vier Fälle:
   *
   *   Server antwortet, Session gültig   -> rein
   *   Server antwortet, keine Session    -> Schranke
   *   Server kennt /api/me nicht (404)   -> gar kein Dart-Server, rein lokal
   *                                         (GitHub Pages, Variante A)
   *   Kein Netz                          -> war schon mal angemeldet? rein.
   *                                         Sonst Schranke mit Hinweis.
   */
  var MERKER = 'dart-turnier-konto';

  function merkerLesen() {
    try {
      var m = JSON.parse(localStorage.getItem(MERKER) || '{}');
      return m && typeof m === 'object' ? m : {};
    } catch (e) { return {}; }
  }

  function merkerSchreiben(m) {
    try { localStorage.setItem(MERKER, JSON.stringify(m)); } catch (e) { /* egal */ }
  }

  function merkeServer(angemeldeter) {
    merkerSchreiben({ serverBekannt: true, nutzer: angemeldeter || null });
  }

  function gesperrt() { return gesperrtFlag; }

  function setzeSchranke(an) {
    gesperrtFlag = an;
    document.body.classList.toggle('gesperrt', an);
  }

  /*
   * Es gibt einen Dart-Server. Damit kommt der Kader von dort, und die vier
   * Startspieler aus der lokalen Zeit haben ausgedient – die räumt app.js
   * weg, solange sie nie geworfen haben. Gleichzeitig verabschieden sich
   * Gäste, deren Abend vorbei ist.
   */
  function aufraeumen() {
    if (!D) return;
    D.platzhalterEntfernen();
    D.gaesteAufraeumen();
  }

  function anmelden() {
    aufraeumen();
    window.DartKonto = {
      render: render,
      aktion: aktion,
      ruf: ruf,
      nutzer: function () { return nutzer; },
      roster: function () { return roster; },
      holeRoster: holeRoster,
      darfBearbeiten: darfBearbeiten,
      profilGeaendert: profilGeaendert,
      gesperrt: gesperrt
    };
  }

  /* ================= Start ================= */

  function start() {
    D = window.__dart;
    if (!D) return;

    ruf('GET', '/api/me').then(function (daten) {
      anmelden();
      merkeServer(daten.nutzer);
      if (daten.nutzer) {
        setzeSchranke(false);
        nachAnmeldung(daten.nutzer);
      } else {
        setzeSchranke(true);
        ansicht = 'login';
        window.__dart.render();
      }
    }).catch(function (e) {
      if (e && e.status) {
        // Der Server antwortet, kennt aber /api/me nicht. Also steht hier gar
        // kein Dart-Server – die App bleibt die rein lokale App, ohne Hinweis.
        return;
      }
      // Netzwerkfehler. Ob das eine Schranke rechtfertigt, weiß nur der Merker.
      var m = merkerLesen();
      if (!m.serverBekannt) return;   // nie einen Server gesehen: lokal weiter

      anmelden();
      if (m.nutzer) {
        // War angemeldet. Der Abend läuft weiter, der Abgleich holt später auf.
        setzeSchranke(false);
        nutzer = m.nutzer;
        if (window.DartSync) window.DartSync.angemeldet(nutzer);
        window.__dart.render();
      } else {
        setzeSchranke(true);
        ansicht = 'login';
        setzeMeldung('Keine Verbindung. Zum Anmelden brauchst du einmal Netz.', 'fehler');
        window.__dart.render();
      }
    });
  }

  /*
   * Vorentscheidung, noch bevor app.js zum ersten Mal zeichnet: Wer beim
   * letzten Mal einen Dart-Server gesehen hat und nicht angemeldet war,
   * bekommt sofort die Schranke. Ohne das blitzt die App eine halbe Sekunde
   * lang auf, bis /api/me geantwortet hat.
   *
   * Der Server-Check korrigiert das gleich darauf in beide Richtungen.
   */
  var vorab = merkerLesen();
  if (vorab.serverBekannt && !vorab.nutzer) setzeSchranke(true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
