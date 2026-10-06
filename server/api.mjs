/*
 * JSON-API der Dart-App. Alles unter /api.
 *
 * Grundsatz: hier steht KEINE Dart-Regel. Ein Spiel kommt als fertiger
 * Archiv-Eintrag an, wird unveraendert abgelegt und unveraendert wieder
 * herausgegeben. Wer mitgespielt hat, steht zusaetzlich in `game_players` --
 * nur damit man "alle Spiele von X" abfragen kann.
 */
import { randomBytes } from 'node:crypto';
import { nextSeq, transaktion, zaehler } from './lib/db.mjs';
import { hashPassword, verifyPassword, checkPassword, braucheNeuHash } from './lib/password.mjs';
import * as sess from './lib/session.mjs';
import * as limit from './lib/ratelimit.mjs';
import * as relay from './lib/relay.mjs';
import * as livestrom from './lib/livestrom.mjs';
import { sendJson, sendFehler, leseCookies, leseJson, clientIp, HttpFehler, MAX_BODY_KLEIN } from './lib/http.mjs';

const KINDS = new Set(['501', 'cricket', 'rtw', 'finisher', 'tournament']);
const MAX_SPIELER = 16;
const SEITE = 200; // Spiele pro Abruf

/* Kosten eines fehlgeschlagenen Logins simulieren, damit man an der Antwortzeit
   nicht ablesen kann, ob es die E-Mail ueberhaupt gibt. */
const BLIND = hashPassword(randomBytes(16).toString('hex'));

export function createApi(db, config) {
  const secure = !!config.secureCookies;

  /* ---------- kleine Bausteine ---------- */

  function nutzer(req) {
    return sess.currentUser(db, leseCookies(req)[sess.COOKIE]);
  }

  function verlangeNutzer(req) {
    const u = nutzer(req);
    if (!u) throw new HttpFehler(401, 'Nicht angemeldet.');
    return u;
  }

  /* Nach aussen geben wir nie den Passwort-Hash oder fremde E-Mails heraus. */
  function oeffentlich(u) {
    return { id: u.id, name: u.display_name, avatar: u.avatar, hue: u.hue, dbl: u.dbl, voll: u.real_name || null, test: u.test ? true : false };
  }
  function eigenesProfil(u) {
    return { id: u.id, name: u.display_name, email: u.email, avatar: u.avatar, hue: u.hue, dbl: u.dbl, voll: u.real_name || null, seit: u.created_at, kassenwart: u.kassenwart ? true : false };
  }

  function uid(praefix) {
    return praefix + randomBytes(9).toString('base64url');
  }

  /*
   * CSRF: die API spricht ausschliesslich JSON und liegt auf derselben
   * Herkunft wie die Seite. Ein Formular von einer fremden Seite kann diesen
   * Header nicht setzen, ohne dass ein CORS-Preflight dazwischenkommt -- und
   * den beantworten wir nie. Zusammen mit SameSite=Lax reicht das hier.
   */
  function pruefeHerkunft(req) {
    if (req.headers['x-darts-app'] !== '1') {
      throw new HttpFehler(403, 'Diese Anfrage kam nicht aus der App.');
    }
  }

  function pruefeEmail(wert) {
    const e = String(wert || '').trim().toLowerCase();
    if (!e || e.length > 200) throw new HttpFehler(400, 'Bitte eine E-Mail-Adresse angeben.');
    // Bewusst grosszuegig: wir verschicken keine Mails, die Adresse ist nur der
    // Anmeldename. Alles was offensichtlich keine Adresse ist, faellt raus.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
      throw new HttpFehler(400, 'Das sieht nicht nach einer E-Mail-Adresse aus.');
    }
    return e;
  }

  function pruefeName(wert) {
    const n = String(wert || '').trim().replace(/\s+/g, ' ');
    if (n.length < 2) throw new HttpFehler(400, 'Der Anzeigename braucht mindestens 2 Zeichen.');
    if (n.length > 30) throw new HttpFehler(400, 'Der Anzeigename darf hoechstens 30 Zeichen haben.');
    return n;
  }

  /* Avatare sind Data-URLs wie im Client. Fremde URLs waeren ein Weg, die
     IP-Adressen aller Mitspieler abzugreifen -- deshalb nur data:image. */
  /* Streng von vorne bis hinten: nach dem Komma nur Base64-Zeichen. Das
     Bild landet bei allen Kollegen in einem style-Attribut -- ein
     Anfuehrungszeichen oder eine Klammer darin waere ein Einfallstor fuer
     fremdes Skript auf jedem Geraet. */
  const AVATAR_MUSTER = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const AVATAR_MAX = 400000;
  function pruefeAvatar(wert) {
    if (wert == null || wert === '') return null;
    const a = String(wert);
    if (a.length > AVATAR_MAX) throw new HttpFehler(400, 'Das Bild ist zu gross.');
    if (!AVATAR_MUSTER.test(a)) {
      throw new HttpFehler(400, 'Das Bild hat ein unerwartetes Format.');
    }
    return a;
  }

  /*
   * Lieblingsdoppel: 1..20 oder 25 (Bull), sonst NULL fuer "egal". Der Server
   * kennt keine Dart-Regeln -- er prueft nur, dass hier eine Feldzahl steht
   * und nicht irgendein Wert, der spaeter im Client Unsinn ergibt.
   */
  function pruefeDoppel(wert) {
    if (wert === null || wert === undefined || wert === 0 || wert === '') return null;
    const n = Number(wert);
    if (!Number.isInteger(n)) return null;
    return (n >= 1 && n <= 20) || n === 25 ? n : null;
  }

  /* Der buergerliche Name fuer den Spielberichtsbogen: optional, aber wenn,
     dann etwas, das nach Vor- und Nachname aussieht. */
  function pruefeVollName(wert) {
    if (wert === null || wert === undefined || String(wert).trim() === '') return null;
    const n = String(wert).trim().replace(/\s+/g, ' ');
    if (n.length > 60) throw new HttpFehler(400, 'Der Name ist zu lang.');
    return n;
  }

  function pruefeHue(wert) {
    const h = Number(wert);
    return Number.isFinite(h) ? ((Math.round(h) % 360) + 360) % 360 : 0;
  }

  /* Farbe fuer ein neues Konto: der Wunsch des Geraets zaehlt nur, wenn ihn
     noch niemand hat -- sonst der erste freie Ton der Palette, und wenn alle
     vergeben sind, der am seltensten benutzte. Vorher bekam jeder den
     ersten Ton der leeren Geraeteliste, und alle Linien im Diagramm waren gruen. */
  const FARBEN = [145, 210, 40, 355, 275, 175, 320, 90, 25, 250, 120, 300];
  function freieFarbe(wunsch) {
    const zaehl = new Map();
    for (const r of db.prepare("SELECT hue FROM users WHERE status = 'aktiv'").all()) {
      zaehl.set(r.hue, (zaehl.get(r.hue) || 0) + 1);
    }
    if (wunsch && !zaehl.has(wunsch)) return wunsch;
    for (const h of FARBEN) if (!zaehl.has(h)) return h;
    return FARBEN.slice().sort((a, b) => (zaehl.get(a) || 0) - (zaehl.get(b) || 0))[0];
  }

  /* ---------- Konto ---------- */

  async function register(req, res) {
    pruefeHerkunft(req);
    const ip = clientIp(req, config.trustProxy);
    const warte = limit.pruefe('reg:' + ip, 5, 3600e3);
    if (warte) {
      throw new HttpFehler(429, 'Zu viele Registrierungen. Bitte in ' + Math.ceil(warte / 60) + ' Minuten nochmal.');
    }
    limit.zaehle('reg:' + ip, 5, 3600e3);

    const body = await leseJson(req, MAX_BODY_KLEIN);
    if (!config.inviteHash || !verifyPassword(String(body.invite || ''), config.inviteHash)) {
      throw new HttpFehler(403, 'Der Einladungscode stimmt nicht.');
    }
    const email = pruefeEmail(body.email);
    const name = pruefeName(body.name);
    const schwach = checkPassword(body.password);
    if (schwach) throw new HttpFehler(400, schwach);

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpFehler(409, 'Fuer diese E-Mail gibt es schon einen Account. Melde dich einfach an.');
    }

    const id = uid('u_');
    db.prepare(
      'INSERT INTO users (id, email, display_name, password_hash, avatar, hue, status, created_at)' +
        " VALUES (?, ?, ?, ?, NULL, ?, 'aktiv', ?)"
    ).run(id, email, name, hashPassword(body.password), freieFarbe(pruefeHue(body.hue)), new Date().toISOString());

    const token = sess.createSession(db, id);
    limit.loesche('reg:' + ip);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    sendJson(res, 201, { nutzer: eigenesProfil(u) }, { 'Set-Cookie': sess.cookieHeader(token, secure) });
  }

  async function login(req, res) {
    pruefeHerkunft(req);
    const ip = clientIp(req, config.trustProxy);
    const body = await leseJson(req, MAX_BODY_KLEIN);
    const email = String(body.email || '').trim().toLowerCase();
    // Laenger als jede echte Adresse (Registrierung erlaubt 200): gar nicht
    // erst als Schluessel ins Rate-Limit, sonst waere das ein Speicherfresser.
    if (email.length > 200) throw new HttpFehler(400, 'Bitte eine E-Mail-Adresse angeben.');

    const eimer = [
      ['login-ip:' + ip, 10, 900e3],
      ['login-mail:' + email, 5, 900e3]
    ];
    for (const [schluessel, max, fenster] of eimer) {
      const warte = limit.pruefe(schluessel, max, fenster);
      if (warte) {
        throw new HttpFehler(429, 'Zu viele Fehlversuche. Bitte in ' + Math.ceil(warte / 60) + ' Minuten nochmal.');
      }
    }

    const u = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
    // Auch ohne Treffer einmal rechnen: sonst verraet die Antwortzeit, welche
    // Adressen es ueberhaupt gibt.
    const passt = u ? verifyPassword(String(body.password || ''), u.password_hash) : verifyPassword('x', BLIND);

    if (!u || !passt || u.status !== 'aktiv') {
      for (const [schluessel, max, fenster] of eimer) limit.zaehle(schluessel, max, fenster);
      throw new HttpFehler(401, 'E-Mail oder Passwort stimmt nicht.');
    }

    for (const [schluessel] of eimer) limit.loesche(schluessel);
    // Hash aus der Zeit mit kleinerem Arbeitsfaktor: jetzt, wo das Passwort
    // im Klartext vorliegt, still auf den aktuellen Stand bringen.
    if (braucheNeuHash(u.password_hash)) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), u.id);
    }
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    const token = sess.createSession(db, u.id);
    sendJson(res, 200, { nutzer: eigenesProfil(u) }, { 'Set-Cookie': sess.cookieHeader(token, secure) });
  }

  async function logout(req, res) {
    pruefeHerkunft(req);
    sess.destroySession(db, leseCookies(req)[sess.COOKIE]);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sess.clearCookieHeader(secure) });
  }

  async function me(req, res) {
    const u = nutzer(req);
    sendJson(res, 200, { nutzer: u ? eigenesProfil(u) : null });
  }

  /* Anzeigename, Bild und Farbe aendern -- der Client hat dafuer schon eine Maske. */
  async function profilAendern(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req);
    const name = body.name === undefined ? u.display_name : pruefeName(body.name);
    const avatar = body.avatar === undefined ? u.avatar : pruefeAvatar(body.avatar);
    const hue = body.hue === undefined ? u.hue : pruefeHue(body.hue);
    const dbl = body.dbl === undefined ? u.dbl : pruefeDoppel(body.dbl);
    const voll = body.voll === undefined ? u.real_name : pruefeVollName(body.voll);
    db.prepare('UPDATE users SET display_name = ?, avatar = ?, hue = ?, dbl = ?, real_name = ? WHERE id = ?')
      .run(name, avatar, hue, dbl, voll, u.id);
    const frisch = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    sendJson(res, 200, { nutzer: eigenesProfil(frisch) });
  }

  async function passwortAendern(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req, MAX_BODY_KLEIN);
    const voll = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    if (!verifyPassword(String(body.alt || ''), voll.password_hash)) {
      throw new HttpFehler(403, 'Das bisherige Passwort stimmt nicht.');
    }
    const schwach = checkPassword(body.neu);
    if (schwach) throw new HttpFehler(400, schwach);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.neu), u.id);
    // Andere Geraete abmelden: wer das Passwort aendert, will genau das.
    sess.destroyOtherSessions(db, u.id, leseCookies(req)[sess.COOKIE]);
    sendJson(res, 200, { ok: true });
  }

  /* Testkonten sieht, wer sieht_test hat -- und ein Testkonto selbst, sonst
     verloere es beim Anmelden sein eigenes Profil und seine eigenen Spiele. */
  function siehtTest(u) { return u.sieht_test || u.test ? 1 : 0; }

  /* ---------- Mindestform der Spielinhalte ----------
     Der Server rechnet nicht mit, aber er nimmt nur an, was die App auch
     wirklich zeichnen kann. Ein einziger kaputter Eintrag (z. B.
     "matches": null) laege sonst auf jedem Geraet und legte die App dort
     lahm. Kennungen landen im Client in HTML-Attributen -- deshalb duerfen
     sie nur aus harmlosen Zeichen bestehen. */
  const ID_MUSTER = /^[A-Za-z0-9_-]{1,40}$/;
  const KIND_MUSTER = /^[a-z0-9]{1,20}$/;
  const MAX_EINTRAEGE_LISTE = 2000;
  function istId(x) { return typeof x === 'string' && ID_MUSTER.test(x); }
  function istObjekt(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function kaputt(was) { return new HttpFehler(400, 'Der Spielinhalt ist unbrauchbar (' + was + ').'); }
  function idListe(x, was, nullErlaubt) {
    if (!Array.isArray(x) || x.length > 64 || !x.every((v) => istId(v) || (nullErlaubt && v === null))) {
      throw kaputt(was);
    }
  }
  function liste(x, was) {
    if (!Array.isArray(x) || x.length > MAX_EINTRAEGE_LISTE) throw kaputt(was);
  }
  function namensListe(x, was) {
    if (x === undefined || x === null) return;
    if (!istObjekt(x)) throw kaputt(was);
    for (const [k, v] of Object.entries(x)) {
      if (!istId(k) || typeof v !== 'string' || v.length > 60) throw kaputt(was);
    }
  }
  function pruefePartie(m, was) {
    if (!istObjekt(m) || !istId(m.id)) throw kaputt(was + ': Kennung');
    if (m.p !== undefined) idListe(m.p, was + ': Spieler', true);
    if (m.legs !== undefined) liste(m.legs, was + ': Legs');
    if (m.winner !== undefined && m.winner !== null && !istId(m.winner)) throw kaputt(was + ': Sieger');
  }

  /* Ein Archiv-Eintrag, wie archiveGame()/archiveTournament() ihn bauen. */
  function pruefeSpielInhalt(art, p) {
    if (!istObjekt(p)) throw kaputt('kein Objekt');
    if (p.kind !== undefined && (typeof p.kind !== 'string' || !KIND_MUSTER.test(p.kind))) throw kaputt('Spielart');
    if (p.winner !== undefined && p.winner !== null && !istId(p.winner)) throw kaputt('Sieger');
    namensListe(p.namen, 'Namen');
    if (art === 'tournament') {
      idListe(p.lineup, 'Aufstellung');
      liste(p.matches, 'Partien');
      p.matches.forEach((m) => pruefePartie(m, 'Partie'));
      if (p.settings !== undefined && !istObjekt(p.settings)) throw kaputt('Einstellungen');
      return;
    }
    idListe(p.players, 'Spieler');
    if (p.lineup !== undefined) idListe(p.lineup, 'Aufstellung');
    if (art === 'finisher') liste(p.rounds, 'Runden');
    else if (art === 'cricket' || art === 'rtw') liste(p.throws, 'Wuerfe');
    else if (p.throws !== undefined) liste(p.throws, 'Wuerfe');
  }

  /* Spielplan eines geteilten Turniers (planZuMatches im Client). */
  function pruefePlan(plan) {
    if (!istObjekt(plan)) throw new HttpFehler(400, 'Der Spielplan fehlt.');
    if (plan.players !== undefined) idListe(plan.players, 'Spielplan: Spieler');
    liste(plan.matches, 'Spielplan: Partien');
    plan.matches.forEach((m) => pruefePartie(m, 'Spielplan'));
    namensListe(plan.gaeste, 'Spielplan: Gaeste');
  }

  /* Laufender Spielstand (S.game im Client). */
  function pruefeLiveForm(st, kind) {
    if (kind === 'quick') {
      idListe(st.p, 'Spieler');
      liste(st.legs, 'Legs');
    } else {
      idListe(st.players, 'Spieler');
      if (kind === 'finisher') liste(st.rounds, 'Runden');
      else liste(st.throws, 'Wuerfe');
    }
    if (st.winner !== undefined && st.winner !== null && !istId(st.winner)) throw kaputt('Sieger');
  }

  /* ---------- Mengen je Konto ----------
     Niemand spielt 200 Spiele am Tag. Die Grenze schuetzt die Datenbank
     (und damit alle Geraete, die sie abgleichen) vor einem Konto, das
     amok laeuft -- ob aus Bosheit oder wegen eines Fehlers im Client. */
  const MAX_INHALT = 300 * 1024;
  /* Ausnahme: das Archiv eines ganzen Turnierabends. Zehn Spieler jeder gegen
     jeden sind 45 Partien; mit Einzeldarts kommen da gut 350 KB zusammen.
     Das darf nicht an der Grenze fuer ein einzelnes Spiel scheitern. */
  const MAX_TURNIER_ARCHIV = 1024 * 1024;
  const TAG = 864e5;
  const KONTINGENT = {
    spiele: Number(config.kontingentSpiele) || 200,
    live: Number(config.kontingentLive) || 5000
  };
  function kontingentPruefen(u, art) {
    if (limit.pruefe('tag-' + art + ':' + u.id, KONTINGENT[art], TAG)) {
      throw new HttpFehler(429, 'Fuer heute hat dieses Konto genug geschrieben. Morgen geht es weiter.');
    }
  }
  function kontingentZaehlen(u, art) {
    limit.zaehle('tag-' + art + ':' + u.id, KONTINGENT[art], TAG);
  }

  /* Roster: alle aktiven Accounts, damit man Kollegen ins Turnier waehlen kann.
     Testkonten (test = 1) sieht nur, wer sieht_test hat -- fuer alle anderen
     gibt es sie nicht. */
  async function nutzerListe(req, res) {
    const u = verlangeNutzer(req);
    const alle = db
      .prepare(
        "SELECT id, display_name, real_name, avatar, hue, dbl, test FROM users WHERE status = 'aktiv'" +
          ' AND (test = 0 OR ? = 1)' +
          ' ORDER BY display_name COLLATE NOCASE'
      )
      .all(siehtTest(u));
    sendJson(res, 200, { nutzer: alle.map(oeffentlich) });
  }

  /* ---------- Spiele ---------- */

  async function spielHochladen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req, MAX_TURNIER_ARCHIV + 64 * 1024);

    const id = String(body.id || '');
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new HttpFehler(400, 'Die Spiel-Kennung ist unbrauchbar.');
    if (!KINDS.has(String(body.kind))) throw new HttpFehler(400, 'Unbekannte Spielart.');
    if (!body.payload || typeof body.payload !== 'object') throw new HttpFehler(400, 'Der Spielinhalt fehlt.');
    const at = Number(body.at);
    if (!Number.isFinite(at) || at <= 0) throw new HttpFehler(400, 'Der Zeitstempel fehlt.');

    const spieler = Array.isArray(body.players) ? body.players : [];
    if (!spieler.length || spieler.length > MAX_SPIELER) {
      throw new HttpFehler(400, 'Die Besetzung des Spiels ist unbrauchbar.');
    }

    // Schon da? Dann ist das ein wiederholter Versuch aus der Warteschlange --
    // freundlich mit demselben Ergebnis antworten statt zu meckern.
    const da = db.prepare('SELECT seq FROM games WHERE id = ?').get(id);
    if (da) return sendJson(res, 200, { ok: true, seq: da.seq, schonDa: true });

    pruefeSpielInhalt(String(body.kind), body.payload);
    const inhalt = JSON.stringify(body.payload);
    if (inhalt.length > (String(body.kind) === 'tournament' ? MAX_TURNIER_ARCHIV : MAX_INHALT)) {
      throw new HttpFehler(413, 'Das Spiel ist zu gross.');
    }
    kontingentPruefen(u, 'spiele');

    const zeilen = spieler.map(function (p, i) {
      if (p && p.userId) {
        const treffer = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'aktiv'").get(String(p.userId));
        if (!treffer) throw new HttpFehler(400, 'Ein Mitspieler ist kein bekannter Account.');
        return { pos: i, user_id: treffer.id, guest_name: null };
      }
      const gast = String((p && p.guestName) || '').trim();
      if (!gast || gast.length > 30) throw new HttpFehler(400, 'Ein Gastspieler hat keinen brauchbaren Namen.');
      return { pos: i, user_id: null, guest_name: gast };
    });

    const seq = transaktion(db, function () {
      const s = nextSeq(db);
      db.prepare(
        'INSERT INTO games (id, seq, kind, payload, recorded_by, client_at, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, s, String(body.kind), inhalt, u.id, at, new Date().toISOString());
      const einfuegen = db.prepare('INSERT INTO game_players (game_id, pos, user_id, guest_name) VALUES (?, ?, ?, ?)');
      for (const z of zeilen) einfuegen.run(id, z.pos, z.user_id, z.guest_name);
      return s;
    });
    kontingentZaehlen(u, 'spiele');

    sendJson(res, 201, { ok: true, seq });
  }

  /*
   * Alle Spiele, an denen ich beteiligt war oder die ich eingetragen habe,
   * ab dem Cursor. Geloeschte kommen als Grabstein mit, damit sie auf allen
   * Geraeten verschwinden.
   */
  async function spieleHolen(req, res, url) {
    const u = verlangeNutzer(req);
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);

    /* Alle Spiele der Mannschaft, nicht nur die eigenen: Rangliste und
       Statistik muessen auf jedem Geraet dasselbe zeigen - sonst fehlt
       bei Lenas das Spiel, das Wuidara allein geschrieben hat.
       Ausnahme Testspiele (ein Testkonto beteiligt): die bekommt nur, wer
       sieht_test hat. Grabsteine gehen immer raus -- ein frueher verteiltes
       Testspiel muss ueberall wieder verschwinden. */
    const zeilen = db
      .prepare(
        'SELECT g.id, g.seq, g.kind, g.payload, g.client_at, g.deleted_at,' +
          '       g.recorded_by, r.display_name AS recorder_name' +
          '  FROM games g' +
          '  JOIN users r ON r.id = g.recorded_by' +
          ' WHERE g.seq > ?' +
          '   AND (g.deleted_at IS NOT NULL OR ? = 1 OR NOT EXISTS (' +
          '         SELECT 1 FROM game_players gp JOIN users tu ON tu.id = gp.user_id' +
          '          WHERE gp.game_id = g.id AND tu.test = 1))' +
          ' ORDER BY g.seq' +
          ' LIMIT ?'
      )
      .all(since, siehtTest(u), SEITE + 1);

    const mehr = zeilen.length > SEITE;
    const seite = mehr ? zeilen.slice(0, SEITE) : zeilen;

    const spiele = seite.map(function (z) {
      if (z.deleted_at) return { id: z.id, seq: z.seq, geloescht: true };
      return {
        id: z.id,
        seq: z.seq,
        kind: z.kind,
        at: z.client_at,
        payload: JSON.parse(z.payload),
        eingetragenVon: z.recorded_by,
        eingetragenVonName: z.recorder_name
      };
    });

    const cursor = seite.length ? seite[seite.length - 1].seq : since;
    sendJson(res, 200, { spiele, cursor, mehr });
  }

  /* Fehleingaben zurueckziehen. Nur wer das Spiel eingetragen hat, darf das --
     sonst koennte jeder die Statistik der anderen aufraeumen. */
  async function spielLoeschen(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const g = db.prepare('SELECT id, recorded_by, deleted_at FROM games WHERE id = ?').get(id);
    if (!g) throw new HttpFehler(404, 'Dieses Spiel gibt es nicht.');
    if (g.recorded_by !== u.id) {
      throw new HttpFehler(403, 'Nur wer das Spiel eingetragen hat, kann es zurueckziehen.');
    }
    if (g.deleted_at) return sendJson(res, 200, { ok: true, schonWeg: true });

    transaktion(db, function () {
      db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?').run(
        new Date().toISOString(),
        nextSeq(db),
        id
      );
    });
    sendJson(res, 200, { ok: true });
  }

  /* ---------- Geteilte Turniere ---------- */
  /*
   * Ein Turnier, zwei Scheiben, zwei Geraete. Der Server verwahrt den
   * Spielplan und die fertigen Partien -- gerechnet wird weiterhin nur im
   * Client. Seine einzige eigene Aufgabe: dafuer sorgen, dass nicht zwei
   * Geraete dieselbe Partie mitschreiben.
   */

  /* Eine Partie, die jemand beansprucht und dann nicht zu Ende spielt, darf
     das Turnier nicht blockieren. Nach dieser Frist darf sie ein anderer
     uebernehmen -- lang genug fuer eine echte Partie, kurz genug, dass ein
     leergelaufener Akku den Abend nicht aufhaelt. */
  const CLAIM_FRIST = 45 * 60000;

  function turnierId(wert) {
    const id = String(wert || '');
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new HttpFehler(400, 'Die Turnier-Kennung ist unbrauchbar.');
    return id;
  }

  function verlangeTurnier(id) {
    const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (!t) throw new HttpFehler(404, 'Dieses Turnier gibt es nicht.');
    return t;
  }

  /* Nur wer mitspielt, darf mitschreiben. */
  function verlangeTeilnahme(t, u) {
    const da = db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?')
      .get(t.id, u.id);
    if (!da) throw new HttpFehler(403, 'Du spielst in diesem Turnier nicht mit.');
  }

  function partieZeile(r) {
    return {
      matchId: r.match_id,
      claimedBy: r.claimed_by,
      claimedByName: r.claimed_by ? (namen.get(r.claimed_by) || null) : null,
      claimedAt: r.claimed_at,
      result: r.result ? JSON.parse(r.result) : null,
      seq: r.seq
    };
  }

  /* Kleiner Namens-Cache: die Partien-Liste braucht zu jedem Anspruch einen
     Namen, und das sind immer dieselben zehn Leute. */
  const namen = new Map();
  /* Testkonten haben fuer alle, die sie nicht sehen duerfen, keinen Namen --
     wie ueberall sonst auch. */
  function namenLaden(u) {
    namen.clear();
    for (const r of db.prepare('SELECT id, display_name FROM users WHERE test = 0 OR ? = 1').all(u ? siehtTest(u) : 0)) {
      namen.set(r.id, r.display_name);
    }
  }

  function turnierAntwort(t, seit, u) {
    namenLaden(u);
    const zeilen = db
      .prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND seq > ? ORDER BY seq')
      .all(t.id, Number(seit) || 0);
    const hoechste = db
      .prepare('SELECT MAX(seq) AS m FROM tournament_matches WHERE tournament_id = ?')
      .get(t.id).m || 0;
    return {
      id: t.id,
      plan: JSON.parse(t.plan),
      status: t.status,
      angelegtVon: t.created_by,
      angelegtVonName: namen.get(t.created_by) || null,
      partien: zeilen.map(partieZeile),
      cursor: hoechste
    };
  }

  async function turnierAnlegen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req, MAX_INHALT + 64 * 1024);
    const id = turnierId(body.id);
    if (!body.plan || typeof body.plan !== 'object') throw new HttpFehler(400, 'Der Spielplan fehlt.');

    // Schon da? Dann war das ein zweiter Versuch aus der Warteschlange --
    // den Stand bekommt aber nur, wer auch mitspielt.
    const da = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (da) {
      verlangeTeilnahme(da, u);
      return sendJson(res, 200, { turnier: turnierAntwort(da, 0, u), schonDa: true });
    }
    pruefePlan(body.plan);
    const planText = JSON.stringify(body.plan);
    if (planText.length > MAX_INHALT) throw new HttpFehler(413, 'Der Spielplan ist zu gross.');
    kontingentPruefen(u, 'spiele');

    const mitspieler = Array.isArray(body.players) ? body.players : [];
    const konten = [];
    for (const p of mitspieler) {
      const treffer = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'aktiv'").get(String(p));
      if (treffer) konten.push(treffer.id);
    }
    // Der Anlegende gehoert immer dazu, auch wenn er selbst nicht mitwirft --
    // sonst saehe er sein eigenes Turnier nicht mehr.
    if (!konten.includes(u.id)) konten.push(u.id);

    transaktion(db, function () {
      db.prepare('INSERT INTO tournaments (id, plan, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(id, planText, u.id, new Date().toISOString());
      const ins = db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)');
      for (const k of konten) ins.run(id, k);
    });
    kontingentZaehlen(u, 'spiele');
    sendJson(res, 201, { turnier: turnierAntwort(verlangeTurnier(id), 0, u) });
  }

  /* Alle offenen Turniere, an denen ich beteiligt bin. */
  function turniereListe(req, res) {
    const u = verlangeNutzer(req);
    const zeilen = db
      .prepare(
        "SELECT t.* FROM tournaments t JOIN tournament_players p ON p.tournament_id = t.id" +
          " WHERE p.user_id = ? AND t.status = 'offen' ORDER BY t.created_at DESC LIMIT 10"
      )
      .all(u.id);
    sendJson(res, 200, { turniere: zeilen.map((t) => turnierAntwort(t, 0, u)) });
  }

  function turnierHolen(req, res, id, url) {
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(id));
    verlangeTeilnahme(t, u);
    sendJson(res, 200, { turnier: turnierAntwort(t, url.searchParams.get('since'), u) });
  }

  /*
   * Partie beanspruchen. Wer sie hat, schreibt sie mit; bei den anderen
   * steht "laeuft bei X" statt eines Start-Knopfes. Ein zweiter Versuch
   * desselben Geraets ist in Ordnung -- das ist bloss ein Neuladen.
   */
  async function partieBeanspruchen(req, res, treffer) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(treffer[0]));
    verlangeTeilnahme(t, u);
    if (t.status !== 'offen') throw new HttpFehler(409, 'Dieses Turnier ist beendet.');
    const mid = turnierId(treffer[1]);

    const jetzt = Date.now();
    const da = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND match_id = ?')
      .get(t.id, mid);
    if (da && da.result) throw new HttpFehler(409, 'Diese Partie ist schon gespielt.');
    if (da && da.claimed_by && da.claimed_by !== u.id && jetzt - (da.claimed_at || 0) < CLAIM_FRIST) {
      namenLaden(u);
      throw new HttpFehler(409, (namen.get(da.claimed_by) || 'Jemand') + ' schreibt diese Partie gerade mit.');
    }

    transaktion(db, function () {
      const s = zaehler(db, 'tournament_seq');
      db.prepare(
        'INSERT INTO tournament_matches (tournament_id, match_id, claimed_by, claimed_at, seq, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?)' +
          ' ON CONFLICT(tournament_id, match_id) DO UPDATE SET' +
          ' claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at,' +
          ' seq = excluded.seq, updated_at = excluded.updated_at'
      ).run(t.id, mid, u.id, jetzt, s, new Date().toISOString());
    });
    sendJson(res, 200, { turnier: turnierAntwort(t, 0, u) });
  }

  /* Anspruch zurueckgeben, ohne gespielt zu haben (zurueck aus der Partie). */
  async function partieFreigeben(req, res, treffer) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(treffer[0]));
    verlangeTeilnahme(t, u);
    const mid = turnierId(treffer[1]);
    const da = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND match_id = ?')
      .get(t.id, mid);
    // Nur den eigenen Anspruch, und nur solange nichts eingetragen ist.
    if (da && !da.result && da.claimed_by === u.id) {
      transaktion(db, function () {
        const s = zaehler(db, 'tournament_seq');
        db.prepare(
          'UPDATE tournament_matches SET claimed_by = NULL, claimed_at = NULL, seq = ?, updated_at = ?' +
            ' WHERE tournament_id = ? AND match_id = ?'
        ).run(s, new Date().toISOString(), t.id, mid);
      });
    }
    sendJson(res, 200, { turnier: turnierAntwort(t, 0, u) });
  }

  /* Ergebnis eintragen. Wortgleich das, was der Client als Partie fuehrt. */
  async function partieErgebnis(req, res, treffer) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(treffer[0]));
    verlangeTeilnahme(t, u);
    const mid = turnierId(treffer[1]);
    const body = await leseJson(req, MAX_INHALT + 64 * 1024);
    if (!body.result || typeof body.result !== 'object') throw new HttpFehler(400, 'Das Ergebnis fehlt.');

    const da = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND match_id = ?')
      .get(t.id, mid);
    // Fremdes Ergebnis ueberschreiben waere der eine Fall, in dem wirklich
    // etwas verlorenginge -- also nur der, der die Partie beansprucht hat.
    if (da && da.claimed_by && da.claimed_by !== u.id) {
      namenLaden(u);
      throw new HttpFehler(409, (namen.get(da.claimed_by) || 'Jemand') + ' schreibt diese Partie mit.');
    }
    // Das Ergebnis ersetzt im Client die Partie als Ganzes: also muss es
    // auch eine sein -- und zwar genau diese.
    pruefePartie(body.result, 'Ergebnis');
    if (body.result.id !== mid) throw kaputt('Ergebnis gehoert zu einer anderen Partie');
    if (!Array.isArray(body.result.legs)) throw kaputt('Ergebnis ohne Legs');
    const ergebnisText = JSON.stringify(body.result);
    if (ergebnisText.length > MAX_INHALT) throw new HttpFehler(413, 'Das Ergebnis ist zu gross.');
    kontingentPruefen(u, 'spiele');

    transaktion(db, function () {
      const s = zaehler(db, 'tournament_seq');
      db.prepare(
        'INSERT INTO tournament_matches (tournament_id, match_id, claimed_by, claimed_at, result, seq, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
          ' ON CONFLICT(tournament_id, match_id) DO UPDATE SET' +
          ' claimed_by = excluded.claimed_by, result = excluded.result,' +
          ' seq = excluded.seq, updated_at = excluded.updated_at'
      ).run(t.id, mid, u.id, Date.now(), ergebnisText, s, new Date().toISOString());
    });
    kontingentZaehlen(u, 'spiele');
    sendJson(res, 200, { turnier: turnierAntwort(t, 0, u) });
  }

  /* Spielplan eines laufenden geteilten Turniers aendern - fuer den
     Spielerwechsel im Ligaspiel an zwei iPads. Der Plan traegt einen Zaehler
     (planStand): wer gegen einen veralteten Plan schreibt, bekommt 409 mit
     dem aktuellen Stand, statt den Wechsel des anderen Geraets zu
     ueberschreiben. Die Partien selbst (Kennungen, Ergebnisse) bleiben. */
  async function turnierPlanAendern(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(id));
    verlangeTeilnahme(t, u);
    if (t.status !== 'offen') throw new HttpFehler(409, 'Das Turnier ist schon beendet.');
    const body = await leseJson(req, MAX_INHALT + 64 * 1024);
    pruefePlan(body.plan);
    const alt = JSON.parse(t.plan);
    const altStand = Number(alt.planStand) || 0;
    if ((Number(body.basis) || 0) !== altStand) {
      return sendJson(res, 409, { fehler: 'Der Spielplan wurde gerade auf dem anderen Gerät geändert.', turnier: turnierAntwort(t, 0, u) });
    }
    const altIds = (alt.matches || []).map((m) => m.id).sort().join(',');
    const neuIds = body.plan.matches.map((m) => m.id).sort().join(',');
    if (altIds !== neuIds) throw new HttpFehler(400, 'Die Partien des Spielplans duerfen sich nicht aendern.');
    const neu = Object.assign({}, body.plan, { planStand: altStand + 1 });
    const planText = JSON.stringify(neu);
    if (planText.length > MAX_INHALT) throw new HttpFehler(413, 'Der Spielplan ist zu gross.');
    transaktion(db, function () {
      db.prepare('UPDATE tournaments SET plan = ? WHERE id = ?').run(planText, t.id);
      /* Wer neu im Plan steht und ein Konto hat, sieht das Turnier jetzt auch. */
      const ins = db.prepare('INSERT OR IGNORE INTO tournament_players (tournament_id, user_id) VALUES (?, ?)');
      for (const p of Array.isArray(neu.players) ? neu.players : []) {
        const k = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'aktiv'").get(String(p));
        if (k) ins.run(t.id, k.id);
      }
    });
    sendJson(res, 200, { turnier: turnierAntwort(verlangeTurnier(t.id), 0, u) });
  }

  async function turnierBeenden(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(id));
    verlangeTeilnahme(t, u);
    if (t.status === 'offen') {
      db.prepare("UPDATE tournaments SET status = 'beendet', ended_at = ? WHERE id = ?")
        .run(new Date().toISOString(), t.id);
    }
    sendJson(res, 200, { turnier: turnierAntwort(verlangeTurnier(t.id), 0, u) });
  }

  /* ---------- Liga-Zusagen ---------- */
  /*
   * Wer ist beim Spieltag dabei? Die Termine selbst kennt nur der Client
   * (LIGA in js/app.js) -- hier steht je Termin-Kennung nur die Liste der
   * Zusagen. Sichtbar fuer alle Angemeldeten, aendern kann jeder nur die
   * eigene Zusage.
   */

  function ligaTerminId(wert) {
    const id = String(wert || '');
    if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new HttpFehler(400, 'Diesen Spieltag gibt es nicht.');
    return id;
  }

  function ligaAlleZusagen(ich) {
    const zeilen = db.prepare(
      'SELECT z.termin_id, z.status, u.id, u.display_name, u.avatar, u.hue' +
      '  FROM liga_zusagen z JOIN users u ON u.id = z.user_id' +
      ' WHERE (u.test = 0 OR ? = 1)' +
      ' ORDER BY z.created_at'
    ).all(siehtTest(ich));
    const je = {};
    for (const z of zeilen) {
      if (!je[z.termin_id]) je[z.termin_id] = [];
      je[z.termin_id].push({ id: z.id, name: z.display_name, avatar: z.avatar, hue: z.hue, status: z.status || 'dabei' });
    }
    return je;
  }

  async function ligaZusagen(req, res) {
    const u = verlangeNutzer(req);
    sendJson(res, 200, { zusagen: ligaAlleZusagen(u) });
  }

  async function ligaZusageSetzen(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const termin = ligaTerminId(id);
    const daten = await leseJson(req);
    /* Zwei Formen: das alte { dabei: bool } der Spieltage (false loescht)
       und { status: 'dabei'|'unsicher'|'absage' } des Trainings - dort ist
       auch die Absage eine Antwort, die alle sehen sollen. */
    let status = null;
    if (typeof daten.status === 'string') {
      if (['dabei', 'unsicher', 'absage'].indexOf(daten.status) < 0) {
        throw new HttpFehler(400, 'Unbekannter Zusage-Status.');
      }
      status = daten.status;
    } else if (daten.dabei) {
      status = 'dabei';
    }
    if (status) {
      db.prepare(
        'INSERT INTO liga_zusagen (termin_id, user_id, created_at, status) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (termin_id, user_id) DO UPDATE SET status = excluded.status'
      ).run(termin, u.id, new Date().toISOString(), status);
    } else {
      db.prepare('DELETE FROM liga_zusagen WHERE termin_id = ? AND user_id = ?').run(termin, u.id);
    }
    sendJson(res, 200, { zusagen: ligaAlleZusagen(u) });
  }

  /* ---------- Ligatabelle ---------- */
  /* Ein manuell gepflegter JSON-Blob: der Client baut die Tabelle, der
     Server verwahrt nur den letzten Stand. */

  async function ligaTabelleHolen(req, res) {
    verlangeNutzer(req);
    const z = db.prepare('SELECT daten, updated_at FROM liga_tabelle WHERE id = 1').get();
    sendJson(res, 200, z
      ? { tabelle: JSON.parse(z.daten), stand: z.updated_at }
      : { tabelle: null, stand: null });
  }

  async function ligaTabelleSpeichern(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req);
    /* Der Client rechnet mit { zeilen: [...] } - alles andere wuerde beim
       Rendern jeden Reiter zerschiessen, also gar nicht erst annehmen. */
    if (body.tabelle !== null && body.tabelle !== undefined &&
        (typeof body.tabelle !== 'object' || !Array.isArray(body.tabelle.zeilen))) {
      throw new HttpFehler(400, 'Unbrauchbare Tabellendaten.');
    }
    const daten = JSON.stringify(body.tabelle || null);
    if (daten.length > 20000) throw new HttpFehler(400, 'Die Tabelle ist zu gross.');
    db.prepare(
      'INSERT INTO liga_tabelle (id, daten, updated_at, updated_by) VALUES (1, ?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET daten = excluded.daten, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
    ).run(daten, new Date().toISOString(), u.id);
    sendJson(res, 200, { ok: true });
  }

  /* ---------- Vereinskasse ---------- */
  /* Das Kassenbuch wie die Excel-Vorlage der Kassenwartin: jede Buchung mit
     Datum, Beschreibung, Kategorie und Betrag (Cent, positiv = Einnahme),
     dazu Kassenjahr und Anfangsbestand. Alle Angemeldeten sehen das Buch und
     tragen Einzahlungen und Ausgaben direkt ein; eigene Buchungen darf jeder
     wieder loeschen. Der Kassenwart (users.kassenwart) aendert und loescht
     jede Buchung, stellt Kassenjahr und Anfangsbestand ein und bucht
     Beitraege fuer andere. */
  const KASSE_EIN = ['Mitgliedsbeiträge', 'Startgelder Turniere', 'Spenden', 'Sponsoring', 'Sonstige Einnahmen'];
  const KASSE_AUS = ['Turnierkosten', 'Ausrüstung/Dartpfeile', 'Getränke/Verpflegung', 'Raummiete', 'Verbandsgebühren', 'Sonstige Ausgaben'];

  function kasseKonfig() {
    const k = {};
    for (const r of db.prepare('SELECT name, wert FROM kasse_konfig').all()) k[r.name] = r.wert;
    return {
      jahr: Number(k.jahr) || new Date().getFullYear(),
      anfangsbestand: Math.trunc(Number(k.anfangsbestand)) || 0,
      beitrag: Math.trunc(Number(k.beitrag)) || 5000,
      paypal: k.paypal || ''
    };
  }
  function verlangeKassenwart(u) {
    if (!u.kassenwart) throw new HttpFehler(403, 'Nur der Kassenwart darf im Kassenbuch schreiben.');
  }

  async function kasseHolen(req, res) {
    const u = verlangeNutzer(req);
    const konfig = kasseKonfig();
    /* Buchungen von oder fuer Testkonten sieht (und zaehlt) nur, wer
       Testkonten sehen darf. */
    const st = siehtTest(u);
    const OHNE_TEST = ' (? = 1 OR (NOT EXISTS (SELECT 1 FROM users tu WHERE tu.id = k.user_id AND tu.test = 1)' +
      ' AND NOT EXISTS (SELECT 1 FROM users tm WHERE tm.id = k.mitglied AND tm.test = 1)))';
    const zeilen = db.prepare(
      'SELECT k.id, k.betrag, k.text, k.datum, k.kategorie, k.mitglied, k.created_at, k.user_id,' +
      '       u.display_name AS von, m.display_name AS mitglied_name' +
      '  FROM kasse k JOIN users u ON u.id = k.user_id' +
      '  LEFT JOIN users m ON m.id = k.mitglied' +
      ' WHERE' + OHNE_TEST +
      ' ORDER BY k.datum, k.id'
    ).all(st);
    const summe = db.prepare('SELECT COALESCE(SUM(betrag), 0) s FROM kasse k WHERE' + OHNE_TEST).get(st).s;
    /* Gruendungsbeitrag: wer von den aktiven Mitgliedern hat ihn schon
       bezahlt? Summe der Mitgliedsbeitraege je Mitglied. Testkonten
       zaehlen als Mitglieder nicht -- und sehen tut sie ohnehin nur der Tester. */
    const bezahlt = new Map();
    for (const r of db.prepare("SELECT mitglied, SUM(betrag) s, MAX(datum) d FROM kasse WHERE kategorie = 'Mitgliedsbeiträge' AND mitglied IS NOT NULL GROUP BY mitglied").all()) {
      bezahlt.set(r.mitglied, { summe: r.s, datum: r.d });
    }
    const mitglieder = db.prepare(
      "SELECT id, display_name, avatar, hue FROM users WHERE status = 'aktiv' AND test = 0 ORDER BY display_name COLLATE NOCASE"
    ).all().map((m) => ({
      id: m.id, name: m.display_name, avatar: m.avatar, hue: m.hue,
      gezahlt: (bezahlt.get(m.id) || {}).summe || 0,
      am: (bezahlt.get(m.id) || {}).datum || null
    }));
    const kassenwarte = db.prepare("SELECT display_name FROM users WHERE kassenwart = 1 AND status = 'aktiv' AND (test = 0 OR ? = 1) ORDER BY display_name COLLATE NOCASE")
      .all(st).map((r) => r.display_name);
    sendJson(res, 200, {
      saldo: konfig.anfangsbestand + summe,
      summe,
      konfig,
      kassenwarte,
      darfBuchen: true,
      kassenwart: !!u.kassenwart,
      kategorien: { ein: KASSE_EIN, aus: KASSE_AUS },
      mitglieder,
      eintraege: zeilen.map((z) => ({
        id: z.id, betrag: z.betrag, text: z.text, datum: z.datum, kategorie: z.kategorie,
        mitglied: z.mitglied, mitgliedName: z.mitglied_name || null,
        at: z.created_at, von: z.von, meins: z.user_id === u.id
      }))
    });
  }

  function pruefeDatum(wert) {
    const s = String(wert || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? null : s;
  }

  /* Eine Buchung pruefen -- fuer Anlegen und Aendern dieselben Regeln. */
  function pruefeBuchung(body, u) {
    const betrag = Math.trunc(Number(body.betrag));
    if (!Number.isFinite(betrag) || betrag === 0 || Math.abs(betrag) > 1000000) {
      throw new HttpFehler(400, 'Der Betrag ist unbrauchbar.');
    }
    const text = String(body.text || '').trim().slice(0, 80);
    if (!text) throw new HttpFehler(400, 'Wofuer war das? Bitte eine Beschreibung angeben.');
    const kategorie = String(body.kategorie || '').trim();
    const liste = betrag > 0 ? KASSE_EIN : KASSE_AUS;
    if (!liste.includes(kategorie)) throw new HttpFehler(400, 'Bitte eine Kategorie aus der Liste waehlen.');
    const datum = pruefeDatum(body.datum) || new Date().toISOString().slice(0, 10);
    let mitglied = null;
    if (body.mitglied) {
      const m = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'aktiv'").get(String(body.mitglied));
      if (!m) throw new HttpFehler(400, 'Dieses Mitglied gibt es nicht.');
      /* Den Beitrag eines anderen bucht nur der Kassenwart -- den eigenen jeder. */
      if (m.id !== u.id && !u.kassenwart) throw new HttpFehler(403, 'Den Beitrag eines anderen traegt nur der Kassenwart ein.');
      mitglied = m.id;
    }
    return { betrag, text, kategorie, datum, mitglied };
  }

  async function kasseBuchen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const b = pruefeBuchung(await leseJson(req), u);
    db.prepare('INSERT INTO kasse (user_id, betrag, text, datum, kategorie, mitglied, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(u.id, b.betrag, b.text, b.datum, b.kategorie, b.mitglied, new Date().toISOString());
    return kasseHolen(req, res);
  }

  /* Aendern darf nur der Kassenwart -- er verwaltet das Buch. */
  async function kasseAendern(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    verlangeKassenwart(u);
    const z = db.prepare('SELECT id FROM kasse WHERE id = ?').get(Number(id));
    if (!z) throw new HttpFehler(404, 'Diese Buchung gibt es nicht.');
    const b = pruefeBuchung(await leseJson(req), u);
    db.prepare('UPDATE kasse SET betrag = ?, text = ?, datum = ?, kategorie = ?, mitglied = ? WHERE id = ?')
      .run(b.betrag, b.text, b.datum, b.kategorie, b.mitglied, Number(id));
    return kasseHolen(req, res);
  }

  /* Loeschen: die eigene Buchung jeder, jede Buchung der Kassenwart. */
  async function kasseLoeschen(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const z = db.prepare('SELECT id, user_id FROM kasse WHERE id = ?').get(Number(id));
    if (!z) throw new HttpFehler(404, 'Diese Buchung gibt es nicht.');
    if (z.user_id !== u.id && !u.kassenwart) throw new HttpFehler(403, 'Fremde Buchungen loescht nur der Kassenwart.');
    db.prepare('DELETE FROM kasse WHERE id = ?').run(Number(id));
    return kasseHolen(req, res);
  }

  /* Kassenjahr und Anfangsbestand -- die gelben Felder der Vorlage. */
  async function kasseEinstellen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    verlangeKassenwart(u);
    const body = await leseJson(req);
    const setze = db.prepare('INSERT INTO kasse_konfig (name, wert) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET wert = excluded.wert');
    if (body.jahr !== undefined) {
      const jahr = Math.trunc(Number(body.jahr));
      if (jahr < 2000 || jahr > 2100) throw new HttpFehler(400, 'Das Kassenjahr ist unbrauchbar.');
      setze.run('jahr', String(jahr));
    }
    if (body.anfangsbestand !== undefined) {
      const ab = Math.trunc(Number(body.anfangsbestand));
      if (!Number.isFinite(ab) || Math.abs(ab) > 100000000) throw new HttpFehler(400, 'Der Anfangsbestand ist unbrauchbar.');
      setze.run('anfangsbestand', String(ab));
    }
    return kasseHolen(req, res);
  }

  /* ---------- Kamera-Relay ----------
     Vermittelt Ereignisse zwischen iPad ("tisch") und iPhone ("linse").
     Wie ueberall gilt: der Server kennt keine Dart-Regeln. Er prueft nur,
     dass hier ein plausibles Ereignis steht, und reicht es weiter. */

  const KAMERA_TYPEN = {
    linse: new Set(['hallo', 'status', 'dart', 'aufnahmeEnde', 'korrektur']),
    tisch: new Set(['spielstand', 'abgelehnt'])
  };

  function pruefeRaumCode(code) {
    if (!/^[A-Z2-9]{6}$/.test(String(code || ''))) {
      throw new HttpFehler(400, 'Der Raumcode besteht aus 6 Zeichen.');
    }
    return code;
  }

  /* Wer Codes durchprobiert, laeuft ins Limit -- der Code ist das Geheimnis
     des Raums, also darf Raten nicht billig sein. Ereignisse brauchen dagegen
     Luft: der Tisch schickt alle 5 s einen Spielstand, dazu jeder Dart --
     ein Spielabend darf daran nie scheitern. */
  const KAMERA_LIMITS = { raum: 60, strom: 120, ereignis: 2400 };
  function kameraLimit(req, was) {
    const ip = clientIp(req, config.trustProxy);
    const s = 'kamera-' + was + ':' + ip;
    const warte = limit.pruefe(s, KAMERA_LIMITS[was], 600e3);
    if (warte) throw new HttpFehler(429, 'Zu viele Versuche. Bitte ' + warte + ' s warten.');
    limit.zaehle(s, KAMERA_LIMITS[was], 600e3);
  }

  async function kameraRaum(req, res) {
    pruefeHerkunft(req);
    kameraLimit(req, 'raum');
    const body = await leseJson(req);
    const code = pruefeRaumCode(body.code);
    const token = String(body.token || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      throw new HttpFehler(400, 'Das Raum-Token ist unbrauchbar.');
    }
    if (!relay.raumAnlegen(code, token)) {
      throw new HttpFehler(409, 'Dieser Code gehoert schon einem anderen Geraet.');
    }
    /* seq: aktueller Stand des Raums, damit der Client sein Wasserzeichen
       nach einem Server-Neustart zuruecksetzen kann. */
    sendJson(res, 200, { ok: true, code, seq: relay.raumSeq(code) });
  }

  /* SSE: ein EventSource kann keine eigenen Header setzen, deshalb hier ohne
     pruefeHerkunft -- der Raumcode in der URL ist die Eintrittskarte. */
  async function kameraStrom(req, res, code, url) {
    kameraLimit(req, 'strom');
    const rolle = url.searchParams.get('rolle');
    if (rolle !== 'tisch' && rolle !== 'linse') {
      throw new HttpFehler(400, 'Die Rolle fehlt (tisch oder linse).');
    }
    if (!relay.anhoeren(code, rolle, req, res, url.searchParams.get('ab'))) {
      throw new HttpFehler(404, 'Diesen Raum gibt es nicht (mehr).');
    }
  }

  async function kameraEreignis(req, res, code) {
    pruefeHerkunft(req);
    kameraLimit(req, 'ereignis');
    if (!relay.raumOffen(code)) throw new HttpFehler(404, 'Diesen Raum gibt es nicht (mehr).');
    const body = await leseJson(req);
    const von = body.von;
    if (von !== 'tisch' && von !== 'linse') throw new HttpFehler(400, 'Der Absender fehlt.');
    const typ = String(body.typ || '');
    if (!KAMERA_TYPEN[von].has(typ)) throw new HttpFehler(400, 'Dieses Ereignis kennt der Raum nicht.');
    const daten = body.daten && typeof body.daten === 'object' ? body.daten : {};
    if (JSON.stringify(daten).length > 4000) throw new HttpFehler(413, 'Das Ereignis ist zu gross.');
    if (typ === 'dart' || typ === 'korrektur') {
      const mult = Number(daten.mult), num = Number(daten.num);
      if (!Number.isInteger(mult) || mult < 1 || mult > 3 ||
          !Number.isInteger(num) || num < 0 || num > 25 || (num > 20 && num !== 25) ||
          (num === 25 && mult > 2)) {   // Triple-Bull gibt es nicht
        throw new HttpFehler(400, 'So einen Dart gibt es nicht.');
      }
    }
    const seq = relay.ereignis(code, von, typ, daten);
    if (!seq) throw new HttpFehler(404, 'Diesen Raum gibt es nicht (mehr).');
    sendJson(res, 200, { ok: true, seq });
  }

  /* ---------- Online-Spiel ---------- */
  /*
   * Ein Schnelles Spiel oder Finisher an zwei Orten. Der Spielstand liegt
   * als Ganzes hier; jede Aenderung ersetzt ihn komplett und zaehlt `seq`
   * hoch. Wer schreibt, nennt die Version, die er kennt -- stimmt sie nicht
   * mehr, war der andere schneller: 409 samt aktuellem Stand, und der Client
   * uebernimmt den statt ihn zu ueberschreiben.
   *
   * Kein Dart-Wissen: `state` ist das JSON, das der Client als S.game
   * fuehrt. Der Server prueft nur Groesse, Mitgliedschaft und Version.
   */
  const LIVE_KINDS = new Set(['quick', 'finisher', 'cricket', 'rtw']);
  /* Ein Online-Spiel mit Einzeldarts braucht rund 120 Byte je Aufnahme;
     "First to 9" mit vier Spielern kommt weit ueber 128 KB. 256 KB wie
     bisher -- ein Stand, der hier abgewiesen wird, legt das Spiel lahm. */
  const LIVE_MAX_STATE = 256 * 1024;
  const LIVE_FRIST = 24 * 3600e3;

  function verlangeLive(id) {
    const g = db.prepare('SELECT * FROM live_games WHERE id = ?').get(id);
    if (!g) throw new HttpFehler(404, 'Dieses Online-Spiel gibt es nicht.');
    return g;
  }

  function verlangeLiveTeilnahme(g, u) {
    const da = db.prepare('SELECT 1 FROM live_game_players WHERE game_id = ? AND user_id = ?').get(g.id, u.id);
    if (!da) throw new HttpFehler(403, 'Du spielst in diesem Spiel nicht mit.');
  }

  function liveState(wert, id, kind) {
    if (!wert || typeof wert !== 'object' || Array.isArray(wert)) throw new HttpFehler(400, 'Der Spielstand fehlt.');
    // Der Stand muss zu diesem Spiel gehoeren -- sonst koennte ein Mitspieler
    // dem anderen ein anderes Spiel (oder eine andere Spielart) unterschieben.
    if (wert.id !== id || wert.kind !== kind) throw new HttpFehler(400, 'Der Spielstand passt nicht zu diesem Spiel.');
    pruefeLiveForm(wert, kind);
    const text = JSON.stringify(wert);
    if (text.length > LIVE_MAX_STATE) throw new HttpFehler(413, 'Der Spielstand ist zu gross.');
    return text;
  }

  /* Ein Spiel schliessen -- mit Versionssprung, damit jedes Geraet das Ende
     beim naechsten Nachfragen auch bekommt. Optional mit Schlussstand.
     Nur ein noch offenes Spiel: gibt die neue Version zurueck, oder 0, wenn
     es schon zu war (dann bleibt alles, wie es ist). Muss in einer
     Transaktion laufen -- bei 0 rollt der Aufrufer den Zaehler zurueck. */
  function liveSchliessen(id, userId, state) {
    const s = zaehler(db, 'live_seq');
    const jetzt = new Date().toISOString();
    const r = state
      ? db.prepare("UPDATE live_games SET state = ?, status = 'zu', seq = ?, updated_by = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status = 'offen'")
        .run(state, s, userId, jetzt, jetzt, id)
      : db.prepare("UPDATE live_games SET status = 'zu', seq = ?, updated_by = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status = 'offen'")
        .run(s, userId, jetzt, jetzt, id);
    return r.changes ? s : 0;
  }

  /* Antwort. Der Stand selbst kommt nur mit, wenn er neuer ist als das, was
     der Client schon kennt -- der Takt fragt alle paar Sekunden, und meistens
     hat sich nichts getan. */
  function liveAntwort(g, seit, u) {
    namenLaden(u);
    const spieler = db.prepare('SELECT user_id FROM live_game_players WHERE game_id = ?').all(g.id)
      .map((r) => r.user_id);
    const neu = g.seq > (Number(seit) || 0);
    const antwort = {
      id: g.id,
      kind: g.kind,
      status: g.status,
      seq: g.seq,
      angelegtVon: g.created_by,
      angelegtVonName: namen.get(g.created_by) || null,
      geaendertVon: g.updated_by,
      geaendertVonName: g.updated_by ? (namen.get(g.updated_by) || null) : null,
      spieler,
      spielerNamen: spieler.map((id) => namen.get(id) || null),
      at: g.created_at
    };
    if (neu) antwort.state = JSON.parse(g.state);
    return antwort;
  }

  /* Der Konflikt-Pfad: "der andere war schneller", samt dem Stand, der
     jetzt gilt. Genau diese Form erwartet js/sync.js beim 409. */
  function liveKonflikt(res, g, u) {
    namenLaden(u);
    return sendJson(res, 409, {
      fehler: (namen.get(g.updated_by) || 'Jemand') + ' war schneller.',
      spiel: liveAntwort(g, 0, u)
    });
  }

  /* Rollback-Signal innerhalb einer Transaktion: nichts geaendert. */
  const NICHTS = Symbol('nichts');

  async function liveAnlegen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req, LIVE_MAX_STATE + 16 * 1024);
    const id = turnierId(body.id);
    if (!LIVE_KINDS.has(body.kind)) throw new HttpFehler(400, 'Diese Spielart geht nicht online.');

    // Schon da? Dann war das ein zweiter Versuch (Neuladen, Warteschlange).
    const da = db.prepare('SELECT * FROM live_games WHERE id = ?').get(id);
    if (da) {
      verlangeLiveTeilnahme(da, u);
      return sendJson(res, 200, { spiel: liveAntwort(da, 0, u), schonDa: true });
    }
    const state = liveState(body.state, id, body.kind);
    kontingentPruefen(u, 'live');

    const mitspieler = Array.isArray(body.players) ? body.players : [];
    const konten = [];
    for (const p of mitspieler) {
      const treffer = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'aktiv'").get(String(p));
      if (treffer && !konten.includes(treffer.id)) konten.push(treffer.id);
    }
    if (!konten.includes(u.id)) konten.push(u.id);
    if (konten.length < 2) throw new HttpFehler(400, 'Online braucht mindestens einen Mitspieler mit Konto.');

    const jetzt = new Date().toISOString();
    const geschlossen = [];
    transaktion(db, function () {
      // Ein Mensch spielt ein Online-Spiel zur Zeit: was er selbst noch offen
      // hat, ist damit vorbei (liegengeblieben oder "Nochmal spielen").
      for (const alt of db.prepare("SELECT id FROM live_games WHERE created_by = ? AND status = 'offen'").all(u.id)) {
        const s = liveSchliessen(alt.id, u.id, null);
        if (s) geschlossen.push([alt.id, s]);
      }
      const s = zaehler(db, 'live_seq');
      db.prepare(
        'INSERT INTO live_games (id, kind, state, seq, created_by, updated_by, created_at, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, body.kind, state, s, u.id, u.id, jetzt, jetzt);
      const ins = db.prepare('INSERT INTO live_game_players (game_id, user_id) VALUES (?, ?)');
      for (const k of konten) ins.run(id, k);
    });
    kontingentZaehlen(u, 'live');
    for (const [gid, s] of geschlossen) livestrom.melden(gid, s, 'zu');
    sendJson(res, 201, { spiel: liveAntwort(verlangeLive(id), 0, u) });
  }

  /* Alle offenen Online-Spiele, an denen ich beteiligt bin. */
  function liveListe(req, res) {
    const u = verlangeNutzer(req);
    const zeilen = db
      .prepare(
        "SELECT g.* FROM live_games g JOIN live_game_players p ON p.game_id = g.id" +
          " WHERE p.user_id = ? AND g.status = 'offen' ORDER BY g.created_at DESC LIMIT 10"
      )
      .all(u.id);
    // Ohne Stand: die Liste wird im Setup alle paar Sekunden geholt, der
    // Stand kommt erst beim Mitspielen (GET /api/live/:id).
    sendJson(res, 200, { spiele: zeilen.map((g) => liveAntwort(g, g.seq, u)) });
  }

  function liveHolen(req, res, id, url) {
    const u = verlangeNutzer(req);
    const g = verlangeLive(turnierId(id));
    verlangeLiveTeilnahme(g, u);
    sendJson(res, 200, { spiel: liveAntwort(g, url.searchParams.get('since'), u) });
  }

  /*
   * Live-Strom (Server-Sent Events): "es gibt Version N". Anmeldung und
   * Teilnahme wie beim GET oben. Ein EventSource schickt das Session-Cookie
   * mit, kann aber keine eigenen Header setzen -- deshalb wie jeder GET
   * ohne pruefeHerkunft. Vertrag: siehe lib/livestrom.mjs.
   */
  function liveStrom(req, res, id) {
    const u = verlangeNutzer(req);
    const g = verlangeLive(turnierId(id));
    verlangeLiveTeilnahme(g, u);
    const schluessel = 'live-strom:' + u.id;
    // Grosszuegig: EventSource verbindet sich nach jedem Funkloch neu, und
    // ein 429 hier beendet den Strom fuer immer (dann bleibt nur Polling).
    const warte = limit.pruefe(schluessel, 300, 600e3);
    if (warte) throw new HttpFehler(429, 'Zu viele Verbindungen. Bitte ' + warte + ' s warten.');
    limit.zaehle(schluessel, 300, 600e3);
    livestrom.anhoeren(g.id, req, res, g.seq, g.status);
  }

  /* Neuer Stand. Nur gegen die bekannte Version -- sonst 409 mit dem Stand,
     der inzwischen gilt.

     Wichtig: waehrend der Koerper ankommt (await), kann ein zweiter PUT
     komplett durchlaufen. Deshalb entscheidet nicht ein vorher gelesener
     Stand, sondern das UPDATE selbst: es greift nur, wenn `seq` in der
     Datenbank noch die Version ist, gegen die geschrieben wurde. */
  async function liveSchreiben(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const g = verlangeLive(turnierId(id));
    verlangeLiveTeilnahme(g, u);
    if (g.status !== 'offen') throw new HttpFehler(409, 'Dieses Spiel ist beendet.');
    const body = await leseJson(req, LIVE_MAX_STATE + 16 * 1024);
    const state = liveState(body.state, g.id, g.kind);
    const basis = Number(body.seq);
    if (!Number.isFinite(basis)) throw new HttpFehler(400, 'Die Version fehlt.');
    kontingentPruefen(u, 'live');

    let neu = 0;
    try {
      neu = transaktion(db, function () {
        const s = zaehler(db, 'live_seq');
        const r = db.prepare(
          "UPDATE live_games SET state = ?, seq = ?, updated_by = ?, updated_at = ? WHERE id = ? AND seq = ? AND status = 'offen'"
        ).run(state, s, u.id, new Date().toISOString(), g.id, basis);
        if (!r.changes) throw NICHTS;   // Zaehler zurueckrollen
        return s;
      });
    } catch (e) {
      if (e !== NICHTS) throw e;
    }

    const frisch = verlangeLive(g.id);
    if (!neu) {
      if (frisch.status !== 'offen') throw new HttpFehler(409, 'Dieses Spiel ist beendet.');
      return liveKonflikt(res, frisch, u);
    }
    kontingentZaehlen(u, 'live');
    livestrom.melden(g.id, neu, 'offen');
    sendJson(res, 200, { spiel: liveAntwort(frisch, 0, u) });
  }

  /* Zu -- gespeichert oder abgebrochen. Der letzte Stand bleibt abrufbar,
     damit das andere Geraet das Ende noch mitbekommt. War das Spiel schon
     zu (der andere war schneller), bleibt dessen Schlussstand stehen, und
     die Antwort zeigt ihn -- ein zweites "Ende" ist kein Fehler. */
  async function liveEnde(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const g = verlangeLive(turnierId(id));
    verlangeLiveTeilnahme(g, u);
    // Der Schlussstand darf mitkommen -- in einem Rutsch, damit "Speichern"
    // nicht mit dem letzten PUT um die Wette laeuft.
    const body = req.headers['content-length'] && req.headers['content-length'] !== '0'
      ? await leseJson(req, LIVE_MAX_STATE + 16 * 1024) : {};
    const state = body && body.state ? liveState(body.state, g.id, g.kind) : null;
    /* Schickt der Client die Version mit, gegen die sein Schlussstand
       gerechnet ist, gilt dieselbe Regel wie beim PUT: hat der andere
       inzwischen etwas eingetragen (z. B. den Checkout zurueckgenommen),
       wird nicht ueberschrieben, sondern 409 mit dem geltenden Stand.
       Ohne `seq` (aeltere App-Staende) wie bisher. */
    const basis = body && body.seq !== undefined && body.seq !== null ? Number(body.seq) : null;
    if (basis !== null && !Number.isFinite(basis)) throw new HttpFehler(400, 'Die Version fehlt.');
    let neu = 0;
    let konflikt = false;
    try {
      neu = transaktion(db, function () {
        if (state && basis !== null) {
          const jetzt = db.prepare('SELECT seq, status FROM live_games WHERE id = ?').get(g.id);
          if (jetzt.status === 'offen' && jetzt.seq !== basis) { konflikt = true; throw NICHTS; }
        }
        const s = liveSchliessen(g.id, u.id, state);
        if (!s) throw NICHTS;
        return s;
      });
    } catch (e) {
      if (e !== NICHTS) throw e;
    }
    if (konflikt) return liveKonflikt(res, verlangeLive(g.id), u);
    if (neu) livestrom.melden(g.id, neu, 'zu');
    sendJson(res, 200, { spiel: liveAntwort(verlangeLive(g.id), 0, u) });
  }

  /* Vergessene Online-Spiele schliessen sich nach einem Tag von selbst. */
  function liveAufraeumen() {
    const grenze = new Date(Date.now() - LIVE_FRIST).toISOString();
    const geschlossen = [];
    transaktion(db, function () {
      for (const g of db.prepare("SELECT id, created_by FROM live_games WHERE status = 'offen' AND updated_at < ?").all(grenze)) {
        const s = liveSchliessen(g.id, g.created_by, null);
        if (s) geschlossen.push([g.id, s]);
      }
      // Geschlossene Spiele braucht nach einer Woche niemand mehr: der
      // Archiv-Eintrag liegt laengst unter /api/games.
      const weg = new Date(Date.now() - 7 * LIVE_FRIST).toISOString();
      db.prepare("DELETE FROM live_games WHERE status = 'zu' AND updated_at < ?").run(weg);
    });
    for (const [gid, s] of geschlossen) livestrom.melden(gid, s, 'zu');
  }

  /* ---------- Verteiler ---------- */

  const TID = '([A-Za-z0-9_-]{4,64})';

  const routen = [
    ['POST', /^\/api\/register$/, register],
    ['POST', /^\/api\/login$/, login],
    ['POST', /^\/api\/logout$/, logout],
    ['GET', /^\/api\/me$/, me],
    ['PATCH', /^\/api\/me$/, profilAendern],
    ['POST', /^\/api\/password$/, passwortAendern],
    ['GET', /^\/api\/users$/, nutzerListe],
    ['POST', /^\/api\/games$/, spielHochladen],
    ['GET', /^\/api\/games$/, spieleHolen],
    ['DELETE', /^\/api\/games\/([A-Za-z0-9_-]{4,64})$/, spielLoeschen],

    ['GET', /^\/api\/liga\/zusagen$/, ligaZusagen],
    ['GET', /^\/api\/kasse$/, kasseHolen],
    ['POST', /^\/api\/kasse$/, kasseBuchen],
    ['DELETE', /^\/api\/kasse\/(\d{1,12})$/, kasseLoeschen],
    ['PATCH', /^\/api\/kasse\/konfig$/, kasseEinstellen],
    ['PATCH', /^\/api\/kasse\/(\d{1,12})$/, kasseAendern],
    ['GET', /^\/api\/liga\/tabelle$/, ligaTabelleHolen],
    ['PUT', /^\/api\/liga\/tabelle$/, ligaTabelleSpeichern],
    ['PUT', /^\/api\/liga\/zusagen\/([a-z0-9-]{2,40})$/, ligaZusageSetzen],

    ['POST', /^\/api\/tournaments$/, turnierAnlegen],
    ['GET', /^\/api\/tournaments$/, turniereListe],
    ['GET', new RegExp('^\\/api\\/tournaments\\/' + TID + '$'), turnierHolen],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/ende$'), turnierBeenden],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/plan$'), turnierPlanAendern],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '\\/claim$'), partieBeanspruchen],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '\\/frei$'), partieFreigeben],
    ['PUT', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '$'), partieErgebnis],

    ['POST', /^\/api\/live$/, liveAnlegen],
    ['GET', /^\/api\/live$/, liveListe],
    ['GET', new RegExp('^\\/api\\/live\\/' + TID + '$'), liveHolen],
    ['PUT', new RegExp('^\\/api\\/live\\/' + TID + '$'), liveSchreiben],
    ['GET', new RegExp('^\\/api\\/live\\/' + TID + '\\/strom$'), liveStrom],
    ['POST', new RegExp('^\\/api\\/live\\/' + TID + '\\/ende$'), liveEnde]
  ];

  /* Die Kamera-Kopplung ist abgeschaltet (js/kamera.js wird nicht geladen).
     Ihre Routen brauchen keine Anmeldung -- also gibt es sie nur, wenn
     jemand sie ausdruecklich einschaltet: DARTS_KAMERA=1. */
  if (config.kamera) {
    routen.push(
      ['POST', /^\/api\/kamera\/raum$/, kameraRaum],
      ['GET', /^\/api\/kamera\/raum\/([A-Z2-9]{6})\/strom$/, kameraStrom],
      ['POST', /^\/api\/kamera\/raum\/([A-Z2-9]{6})\/ereignis$/, kameraEreignis]
    );
  }

  async function handleApi(req, res, url) {
    if (url.pathname === '/api/ping') return sendJson(res, 200, { ok: true });

    /* Gleitende Session: wer die App benutzt, bleibt angemeldet. Hoechstens
       einmal am Tag gibt es dafuer ein frisches Cookie (und einen
       Schreibvorgang). Login/Logout setzen ihr eigenes Cookie und
       ueberschreiben dieses. */
    const token = leseCookies(req)[sess.COOKIE];
    if (token && sess.auffrischen(db, token)) {
      res.setHeader('Set-Cookie', sess.cookieHeader(token, secure));
    }

    let pfadPasst = false;
    for (const [methode, muster, fn] of routen) {
      const treffer = muster.exec(url.pathname);
      if (!treffer) continue;
      pfadPasst = true;
      if (req.method !== methode) continue;
      try {
        // Alle Fangstellen durchreichen: /api/tournaments/:id/matches/:mid hat
        // zwei. Routen ohne Fangstelle bekommen weiterhin die URL.
        await fn(req, res, treffer.length > 2 ? treffer.slice(1) : (treffer[1] !== undefined ? treffer[1] : url), url);
      } catch (e) {
        if (e instanceof HttpFehler) return sendFehler(res, e.code, e.text);
        console.error('API-Fehler:', e);
        return sendFehler(res, 500, 'Auf dem Server ist etwas schiefgegangen.');
      }
      return;
    }
    if (pfadPasst) return sendFehler(res, 405, 'Diese Methode ist hier nicht vorgesehen.');
    sendFehler(res, 404, 'Diesen Weg gibt es nicht.');
  }
  handleApi.aufraeumen = liveAufraeumen;
  return handleApi;
}
