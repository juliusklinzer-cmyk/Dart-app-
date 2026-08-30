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
import { hashPassword, verifyPassword, checkPassword } from './lib/password.mjs';
import * as sess from './lib/session.mjs';
import * as limit from './lib/ratelimit.mjs';
import { sendJson, sendFehler, leseCookies, leseJson, clientIp, HttpFehler } from './lib/http.mjs';

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
    return { id: u.id, name: u.display_name, avatar: u.avatar, hue: u.hue, dbl: u.dbl, voll: u.real_name || null };
  }
  function eigenesProfil(u) {
    return { id: u.id, name: u.display_name, email: u.email, avatar: u.avatar, hue: u.hue, dbl: u.dbl, voll: u.real_name || null, seit: u.created_at };
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
  function pruefeAvatar(wert) {
    if (wert == null || wert === '') return null;
    const a = String(wert);
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(a)) {
      throw new HttpFehler(400, 'Das Bild hat ein unerwartetes Format.');
    }
    if (a.length > 400000) throw new HttpFehler(400, 'Das Bild ist zu gross.');
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

  /* ---------- Konto ---------- */

  async function register(req, res) {
    pruefeHerkunft(req);
    const ip = clientIp(req, config.trustProxy);
    const warte = limit.pruefe('reg:' + ip, 5, 3600e3);
    if (warte) {
      throw new HttpFehler(429, 'Zu viele Registrierungen. Bitte in ' + Math.ceil(warte / 60) + ' Minuten nochmal.');
    }
    limit.zaehle('reg:' + ip, 5, 3600e3);

    const body = await leseJson(req);
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
    ).run(id, email, name, hashPassword(body.password), pruefeHue(body.hue), new Date().toISOString());

    const token = sess.createSession(db, id);
    limit.loesche('reg:' + ip);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    sendJson(res, 201, { nutzer: eigenesProfil(u) }, { 'Set-Cookie': sess.cookieHeader(token, secure) });
  }

  async function login(req, res) {
    pruefeHerkunft(req);
    const ip = clientIp(req, config.trustProxy);
    const body = await leseJson(req);
    const email = String(body.email || '').trim().toLowerCase();

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
    const body = await leseJson(req);
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

  /* Roster: alle aktiven Accounts, damit man Kollegen ins Turnier waehlen kann. */
  async function nutzerListe(req, res) {
    verlangeNutzer(req);
    const alle = db
      .prepare(
        "SELECT id, display_name, real_name, avatar, hue, dbl FROM users WHERE status = 'aktiv'" +
          ' ORDER BY display_name COLLATE NOCASE'
      )
      .all();
    sendJson(res, 200, { nutzer: alle.map(oeffentlich) });
  }

  /* ---------- Spiele ---------- */

  async function spielHochladen(req, res) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const body = await leseJson(req);

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

    const inhalt = JSON.stringify(body.payload);

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

    const zeilen = db
      .prepare(
        'SELECT g.id, g.seq, g.kind, g.payload, g.client_at, g.deleted_at,' +
          '       g.recorded_by, r.display_name AS recorder_name' +
          '  FROM games g' +
          '  JOIN users r ON r.id = g.recorded_by' +
          ' WHERE g.seq > ?' +
          '   AND (g.recorded_by = ? OR EXISTS (' +
          '         SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.user_id = ?))' +
          ' ORDER BY g.seq' +
          ' LIMIT ?'
      )
      .all(since, u.id, u.id, SEITE + 1);

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
  function namenLaden() {
    namen.clear();
    for (const r of db.prepare('SELECT id, display_name FROM users').all()) namen.set(r.id, r.display_name);
  }

  function turnierAntwort(t, seit) {
    namenLaden();
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
    const body = await leseJson(req);
    const id = turnierId(body.id);
    if (!body.plan || typeof body.plan !== 'object') throw new HttpFehler(400, 'Der Spielplan fehlt.');

    // Schon da? Dann war das ein zweiter Versuch aus der Warteschlange.
    const da = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
    if (da) return sendJson(res, 200, { turnier: turnierAntwort(da, 0), schonDa: true });

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
        .run(id, JSON.stringify(body.plan), u.id, new Date().toISOString());
      const ins = db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)');
      for (const k of konten) ins.run(id, k);
    });
    sendJson(res, 201, { turnier: turnierAntwort(verlangeTurnier(id), 0) });
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
    sendJson(res, 200, { turniere: zeilen.map((t) => turnierAntwort(t, 0)) });
  }

  function turnierHolen(req, res, id, url) {
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(id));
    verlangeTeilnahme(t, u);
    sendJson(res, 200, { turnier: turnierAntwort(t, url.searchParams.get('since')) });
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
      namenLaden();
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
    sendJson(res, 200, { turnier: turnierAntwort(t, 0) });
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
    sendJson(res, 200, { turnier: turnierAntwort(t, 0) });
  }

  /* Ergebnis eintragen. Wortgleich das, was der Client als Partie fuehrt. */
  async function partieErgebnis(req, res, treffer) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const t = verlangeTurnier(turnierId(treffer[0]));
    verlangeTeilnahme(t, u);
    const mid = turnierId(treffer[1]);
    const body = await leseJson(req);
    if (!body.result || typeof body.result !== 'object') throw new HttpFehler(400, 'Das Ergebnis fehlt.');

    const da = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND match_id = ?')
      .get(t.id, mid);
    // Fremdes Ergebnis ueberschreiben waere der eine Fall, in dem wirklich
    // etwas verlorenginge -- also nur der, der die Partie beansprucht hat.
    if (da && da.claimed_by && da.claimed_by !== u.id) {
      namenLaden();
      throw new HttpFehler(409, (namen.get(da.claimed_by) || 'Jemand') + ' schreibt diese Partie mit.');
    }

    transaktion(db, function () {
      const s = zaehler(db, 'tournament_seq');
      db.prepare(
        'INSERT INTO tournament_matches (tournament_id, match_id, claimed_by, claimed_at, result, seq, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
          ' ON CONFLICT(tournament_id, match_id) DO UPDATE SET' +
          ' claimed_by = excluded.claimed_by, result = excluded.result,' +
          ' seq = excluded.seq, updated_at = excluded.updated_at'
      ).run(t.id, mid, u.id, Date.now(), JSON.stringify(body.result), s, new Date().toISOString());
    });
    sendJson(res, 200, { turnier: turnierAntwort(t, 0) });
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
    sendJson(res, 200, { turnier: turnierAntwort(verlangeTurnier(t.id), 0) });
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

  function ligaAlleZusagen() {
    const zeilen = db.prepare(
      'SELECT z.termin_id, u.id, u.display_name, u.avatar, u.hue' +
      '  FROM liga_zusagen z JOIN users u ON u.id = z.user_id' +
      ' ORDER BY z.created_at'
    ).all();
    const je = {};
    for (const z of zeilen) {
      if (!je[z.termin_id]) je[z.termin_id] = [];
      je[z.termin_id].push({ id: z.id, name: z.display_name, avatar: z.avatar, hue: z.hue });
    }
    return je;
  }

  async function ligaZusagen(req, res) {
    verlangeNutzer(req);
    sendJson(res, 200, { zusagen: ligaAlleZusagen() });
  }

  async function ligaZusageSetzen(req, res, id) {
    pruefeHerkunft(req);
    const u = verlangeNutzer(req);
    const termin = ligaTerminId(id);
    const daten = await leseJson(req);
    if (daten.dabei) {
      db.prepare(
        'INSERT INTO liga_zusagen (termin_id, user_id, created_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (termin_id, user_id) DO NOTHING'
      ).run(termin, u.id, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM liga_zusagen WHERE termin_id = ? AND user_id = ?').run(termin, u.id);
    }
    sendJson(res, 200, { zusagen: ligaAlleZusagen() });
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
    ['GET', /^\/api\/liga\/tabelle$/, ligaTabelleHolen],
    ['PUT', /^\/api\/liga\/tabelle$/, ligaTabelleSpeichern],
    ['PUT', /^\/api\/liga\/zusagen\/([a-z0-9-]{2,40})$/, ligaZusageSetzen],

    ['POST', /^\/api\/tournaments$/, turnierAnlegen],
    ['GET', /^\/api\/tournaments$/, turniereListe],
    ['GET', new RegExp('^\\/api\\/tournaments\\/' + TID + '$'), turnierHolen],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/ende$'), turnierBeenden],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '\\/claim$'), partieBeanspruchen],
    ['POST', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '\\/frei$'), partieFreigeben],
    ['PUT', new RegExp('^\\/api\\/tournaments\\/' + TID + '\\/matches\\/' + TID + '$'), partieErgebnis]
  ];

  return async function handleApi(req, res, url) {
    if (url.pathname === '/api/ping') return sendJson(res, 200, { ok: true });

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
  };
}
