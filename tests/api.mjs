/*
 * Backend-Test: startet den Server gegen eine Wegwerf-Datenbank und prueft
 * Registrierung, Login, Rechte und den Spiel-Austausch zwischen zwei Konten.
 *
 * Aufruf: npm run test:api
 *
 * Kein Browser noetig -- das hier prueft die API, nicht die Oberflaeche.
 */
import { spawn } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import http from 'node:http';
import { hashPassword } from '../server/lib/password.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.TEST_PORT) || 3199;
const BASIS = 'http://127.0.0.1:' + PORT;
const CODE = 'turnier-einladung';

let fehler = 0;
let geprueft = 0;

function ok(bedingung, was) {
  geprueft++;
  if (bedingung) {
    console.log('  ok   ' + was);
  } else {
    fehler++;
    console.log('  FEHL ' + was);
  }
}

function gleich(ist, soll, was) {
  ok(ist === soll, was + (ist === soll ? '' : ' (war: ' + JSON.stringify(ist) + ', erwartet: ' + JSON.stringify(soll) + ')'));
}

/* Ein Geraet: haelt sein eigenes Cookie, so wie ein Browser das taete. */
function geraet(name) {
  let cookie = '';
  return {
    name,
    async ruf(methode, pfad, body) {
      const kopf = { 'X-Darts-App': '1' };
      if (cookie) kopf.Cookie = cookie;
      if (body !== undefined) kopf['Content-Type'] = 'application/json';
      const res = await fetch(BASIS + pfad, {
        method: methode,
        headers: kopf,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const gesetzt = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of gesetzt) {
        const paar = c.split(';')[0];
        if (paar.endsWith('=')) cookie = '';
        else cookie = paar;
      }
      let daten = null;
      try {
        daten = await res.json();
      } catch (e) {
        /* manche Antworten haben keinen Koerper */
      }
      return { status: res.status, daten, kopf: res.headers };
    },
    /* Absichtlich ohne den App-Header -- so sieht eine Anfrage von fremder Seite aus. */
    async rufOhneHeader(methode, pfad, body) {
      const kopf = {};
      if (cookie) kopf.Cookie = cookie;
      if (body !== undefined) kopf['Content-Type'] = 'application/json';
      const res = await fetch(BASIS + pfad, {
        method: methode,
        headers: kopf,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: res.status };
    },
    setzeCookie(wert) {
      cookie = wert;
    },
    cookie() {
      return cookie;
    }
  };
}

/*
 * Ein PUT, dessen Koerper langsam ankommt -- wie ueber schlechten Mobilfunk.
 * Die erste Haelfte geht sofort raus, der Rest erst mit fertig().
 */
function langsamerPut(pfad, cookie, body) {
  const text = JSON.stringify(body);
  const halb = Math.floor(text.length / 2);
  let antwort;
  const req = http.request({
    host: '127.0.0.1', port: PORT, path: pfad, method: 'PUT',
    headers: { 'X-Darts-App': '1', Cookie: cookie, 'Content-Type': 'application/json' }
  });
  const fertigAntwort = new Promise((resolve, reject) => {
    req.on('response', (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let daten = null;
        try { daten = JSON.parse(d); } catch (e) { /* leer */ }
        resolve({ status: res.statusCode, daten });
      });
    });
    req.on('error', reject);
  });
  req.write(text.slice(0, halb));
  return {
    fertig() {
      req.end(text.slice(halb));
      antwort = antwort || fertigAntwort;
      return antwort;
    }
  };
}

async function warteAufServer(proc, basis) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Server ist beim Start abgestuerzt.');
    try {
      const res = await fetch((basis || BASIS) + '/api/ping');
      if (res.ok) return;
    } catch (e) {
      /* noch nicht da */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server kam nicht hoch.');
}

/* Ein Spiel-Payload, wie ihn der Client archiviert (gekuerzt, aber echt geformt). */
function spielPayload(spielerIds) {
  return {
    id: 'testspiel',
    kind: '501',
    at: Date.now(),
    players: spielerIds,
    scoring: 1,
    throws: [{ p: 0, darts: [60, 60, 60] }],
    winner: spielerIds[0]
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-test-'));
  const dbDatei = path.join(tmp, 'test.db');

  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DARTS_DB: dbDatei,
      DARTS_INVITE_HASH: hashPassword(CODE),
      DARTS_SECURE_COOKIES: '0',
      // Das Kamera-Relay ist in Betrieb abgeschaltet; hier wird es mitgeprueft.
      DARTS_KAMERA: '1',
      // Kleine Tagesgrenze fuer Online-Spiele, damit der Test nicht 5000
      // Schreibvorgaenge braucht. Die Spiele-Grenze bleibt bei 200.
      DARTS_KONTINGENT_LIVE: '60',
      // Lebenszeichen im Live-Strom alle 300 ms statt alle 25 s.
      DARTS_SSE_PULS_MS: '300',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write('  [server] ' + d));

  try {
    await warteAufServer(proc);

    const julius = geraet('Julius');
    const tobi = geraet('Tobi');
    const fremd = geraet('Fremder');

    console.log('\nRegistrierung');
    let r = await julius.ruf('POST', '/api/register', {
      invite: 'falscher-code',
      email: 'julius@example.de',
      name: 'Julius',
      password: 'turnierabend2026'
    });
    gleich(r.status, 403, 'falscher Einladungscode wird abgewiesen');

    r = await julius.ruf('POST', '/api/register', {
      invite: CODE,
      email: 'julius@example.de',
      name: 'Julius',
      password: 'kurz'
    });
    gleich(r.status, 400, 'zu kurzes Passwort wird abgewiesen');

    r = await julius.ruf('POST', '/api/register', {
      invite: CODE,
      email: 'keine-mail',
      name: 'Julius',
      password: 'turnierabend2026'
    });
    gleich(r.status, 400, 'unbrauchbare E-Mail wird abgewiesen');

    r = await julius.ruf('POST', '/api/register', {
      invite: CODE,
      email: 'Julius@Example.de',
      name: 'Julius',
      password: 'turnierabend2026'
    });
    gleich(r.status, 201, 'Registrierung mit richtigem Code klappt');
    const julius_id = r.daten.nutzer.id;
    const julius_hue = r.daten.nutzer.hue;
    gleich(r.daten.nutzer.email, 'julius@example.de', 'E-Mail wird kleingeschrieben gespeichert');
    ok(!('password_hash' in r.daten.nutzer), 'der Passwort-Hash wird nie herausgegeben');

    r = await fremd.ruf('POST', '/api/register', {
      invite: CODE,
      email: 'julius@example.de',
      name: 'Doppelgaenger',
      password: 'turnierabend2026'
    });
    gleich(r.status, 409, 'dieselbe E-Mail ein zweites Mal wird abgewiesen');

    r = await tobi.ruf('POST', '/api/register', {
      invite: CODE,
      email: 'tobi@example.de',
      name: 'Tobi',
      password: 'dreifachzwanzig'
    });
    gleich(r.status, 201, 'zweiter Kollege kann sich registrieren');
    const tobi_id = r.daten.nutzer.id;
    ok(typeof r.daten.nutzer.hue === 'number' && r.daten.nutzer.hue !== julius_hue,
      'der zweite Kollege bekommt eine andere Farbe als der erste (' + julius_hue + ' / ' + r.daten.nutzer.hue + ')');

    console.log('\nSession');
    r = await julius.ruf('GET', '/api/me');
    gleich(r.daten.nutzer && r.daten.nutzer.id, julius_id, 'Session gilt direkt nach der Registrierung');

    r = await fremd.ruf('GET', '/api/me');
    gleich(r.daten.nutzer, null, 'ohne Session ist niemand angemeldet');

    r = await fremd.ruf('GET', '/api/users');
    gleich(r.status, 401, 'das Roster ist ohne Anmeldung gesperrt');

    fremd.setzeCookie('darts_session=' + 'f'.repeat(64));
    r = await fremd.ruf('GET', '/api/me');
    gleich(r.daten.nutzer, null, 'ein erfundenes Session-Token gilt nicht');
    fremd.setzeCookie('');

    console.log('\nCSRF-Schutz');
    r = await julius.rufOhneHeader('POST', '/api/logout');
    gleich(r.status, 403, 'schreibende Anfrage ohne App-Header wird abgewiesen');

    console.log('\nRoster');
    r = await julius.ruf('GET', '/api/users');
    gleich(r.status, 200, 'Roster ist angemeldet abrufbar');
    gleich(r.daten.nutzer.length, 2, 'beide Kollegen stehen im Roster');
    ok(
      r.daten.nutzer.every((n) => !('email' in n)),
      'im Roster stehen keine fremden E-Mail-Adressen'
    );

    console.log('\nSpiel hochladen');
    const spiel = spielPayload([julius_id, tobi_id]);
    r = await julius.ruf('POST', '/api/games', {
      id: spiel.id,
      kind: '501',
      at: spiel.at,
      payload: spiel,
      players: [{ userId: julius_id }, { userId: tobi_id }]
    });
    gleich(r.status, 201, 'Julius traegt ein Spiel fuer beide ein');
    const ersteSeq = r.daten.seq;

    r = await julius.ruf('POST', '/api/games', {
      id: spiel.id,
      kind: '501',
      at: spiel.at,
      payload: spiel,
      players: [{ userId: julius_id }, { userId: tobi_id }]
    });
    gleich(r.status, 200, 'dasselbe Spiel nochmal schicken ist harmlos');
    ok(r.daten.schonDa === true, 'der Server erkennt den Wiederholungsversuch');
    gleich(r.daten.seq, ersteSeq, 'der Cursor bleibt dabei gleich');

    r = await julius.ruf('POST', '/api/games', {
      id: 'gastspiel',
      kind: 'cricket',
      at: Date.now(),
      payload: { id: 'gastspiel', kind: 'cricket', players: [julius_id, 'gast1'], scoring: 1, throws: [], winner: julius_id },
      players: [{ userId: julius_id }, { guestName: 'Zufallsgast' }]
    });
    gleich(r.status, 201, 'Spiel mit einem Gastspieler klappt');

    r = await julius.ruf('POST', '/api/games', {
      id: 'kaputt',
      kind: 'schachmatt',
      at: Date.now(),
      payload: { egal: true },
      players: [{ userId: julius_id }]
    });
    gleich(r.status, 400, 'unbekannte Spielart wird abgewiesen');

    r = await julius.ruf('POST', '/api/games', {
      id: 'kaputt2',
      kind: '501',
      at: Date.now(),
      payload: { egal: true },
      players: [{ userId: 'u_gibtesnicht' }]
    });
    gleich(r.status, 400, 'unbekannter Mitspieler wird abgewiesen');

    console.log('\nAlle sehen alle Spiele der Mannschaft');
    r = await tobi.ruf('GET', '/api/games?since=0');
    gleich(r.status, 200, 'Tobi kann die Spiele abrufen');
    gleich(r.daten.spiele.length, 2, 'Tobi sieht auch das Gastspiel, in dem er nicht stand');
    gleich(r.daten.spiele[0].id, spiel.id, 'es ist das richtige Spiel');
    gleich(r.daten.spiele[0].eingetragenVonName, 'Julius', 'Tobi sieht, wer es eingetragen hat');
    ok(r.daten.spiele[0].payload.throws.length === 1, 'der Spielinhalt kommt unveraendert an');

    r = await julius.ruf('GET', '/api/games?since=0');
    gleich(r.daten.spiele.length, 2, 'Julius sieht beide von ihm eingetragenen Spiele');

    r = await tobi.ruf('GET', '/api/games?since=0');
    const tobiCursor = r.daten.cursor;
    r = await tobi.ruf('GET', '/api/games?since=' + tobiCursor);
    gleich(r.daten.spiele.length, 0, 'mit gesetztem Cursor kommt nichts doppelt');

    console.log('\nLoeschen');
    r = await tobi.ruf('DELETE', '/api/games/' + spiel.id);
    gleich(r.status, 403, 'Tobi darf ein fremdes Spiel nicht loeschen');

    r = await julius.ruf('DELETE', '/api/games/' + spiel.id);
    gleich(r.status, 200, 'Julius darf sein eigenes Spiel zurueckziehen');

    r = await tobi.ruf('GET', '/api/games?since=' + tobiCursor);
    gleich(r.daten.spiele.length, 1, 'die Loeschung erreicht Tobis Geraet');
    ok(r.daten.spiele[0].geloescht === true, 'sie kommt als Grabstein an');

    console.log('\nLogin und Abmelden');
    r = await julius.ruf('POST', '/api/logout');
    gleich(r.status, 200, 'Abmelden klappt');
    r = await julius.ruf('GET', '/api/me');
    gleich(r.daten.nutzer, null, 'nach dem Abmelden gilt die Session nicht mehr');

    r = await julius.ruf('POST', '/api/login', { email: 'julius@example.de', password: 'falsch' });
    gleich(r.status, 401, 'falsches Passwort wird abgewiesen');

    r = await julius.ruf('POST', '/api/login', { email: 'JULIUS@example.de', password: 'turnierabend2026' });
    gleich(r.status, 200, 'Login klappt, Gross-/Kleinschreibung der E-Mail egal');

    console.log('\nPasswort aendern');
    r = await julius.ruf('POST', '/api/password', { alt: 'falsch', neu: 'neuespasswort2026' });
    gleich(r.status, 403, 'ohne das bisherige Passwort geht nichts');

    r = await julius.ruf('POST', '/api/password', { alt: 'turnierabend2026', neu: 'kurz' });
    gleich(r.status, 400, 'ein zu kurzes neues Passwort wird abgewiesen');

    r = await julius.ruf('POST', '/api/password', { alt: 'turnierabend2026', neu: 'neuespasswort2026' });
    gleich(r.status, 200, 'Passwortwechsel klappt');

    r = await julius.ruf('GET', '/api/me');
    ok(r.daten.nutzer !== null, 'das eigene Geraet bleibt nach dem Wechsel angemeldet');

    console.log('\nProfil');
    r = await julius.ruf('PATCH', '/api/me', { name: 'Julius K.', hue: 200 });
    gleich(r.status, 200, 'Anzeigename und Farbe lassen sich aendern');
    gleich(r.daten.nutzer.name, 'Julius K.', 'der neue Name kommt zurueck');

    r = await julius.ruf('PATCH', '/api/me', { avatar: 'https://beispiel.de/bild.png' });
    gleich(r.status, 400, 'ein fremd gehostetes Bild wird abgewiesen');

    /* Das Lieblingsdoppel gehoert dem Account, nicht dem Geraet -- sonst
       gaelte es nicht, wenn ein Kollege den Abend mitschreibt. */
    r = await julius.ruf('PATCH', '/api/me', { dbl: 16 });
    gleich(r.daten.nutzer.dbl, 16, 'Lieblingsdoppel laesst sich setzen');
    r = await julius.ruf('GET', '/api/users');
    gleich(r.daten.nutzer.find((n) => n.id === julius_id).dbl, 16,
      'und steht auch im Kader, den die anderen sehen');
    r = await julius.ruf('PATCH', '/api/me', { name: 'Julius K.' });
    gleich(r.daten.nutzer.dbl, 16, 'eine Namensaenderung laesst es unangetastet');
    r = await julius.ruf('PATCH', '/api/me', { dbl: 25 });
    gleich(r.daten.nutzer.dbl, 25, 'Bull geht auch');
    r = await julius.ruf('PATCH', '/api/me', { dbl: 21 });
    gleich(r.daten.nutzer.dbl, null, 'ein Feld, das es nicht gibt, wird zu "egal"');
    r = await julius.ruf('PATCH', '/api/me', { dbl: 'T20' });
    gleich(r.daten.nutzer.dbl, null, 'und Unsinn ebenfalls');
    r = await julius.ruf('PATCH', '/api/me', { dbl: 20 });
    gleich(r.daten.nutzer.dbl, 20, 'zurueck auf D20');

    /*
     * Geteiltes Turnier: zwei Scheiben, zwei Geraete, ein Spielplan. Der
     * Server verwahrt nur -- seine einzige eigene Aufgabe ist, dass nicht
     * zwei Leute dieselbe Partie mitschreiben.
     */
    console.log('\nGeteiltes Turnier');
    const plan = {
      start: 501,
      bestOf: 1,
      players: [julius_id, tobi_id],
      matches: [
        { id: 'm1r1', round: 1, p: [julius_id, tobi_id] },
        { id: 'm2r1', round: 1, p: [tobi_id, julius_id] }
      ]
    };
    r = await julius.ruf('POST', '/api/tournaments', {
      id: 'turnier1', plan, players: [julius_id, tobi_id]
    });
    gleich(r.status, 201, 'Julius legt ein geteiltes Turnier an');
    gleich(r.daten.turnier.plan.matches.length, 2, 'der Spielplan kommt zurueck');

    r = await julius.ruf('POST', '/api/tournaments', { id: 'turnier1', plan, players: [julius_id] });
    gleich(r.status, 200, 'ein zweiter Versuch mit derselben Kennung meckert nicht');
    ok(r.daten.schonDa === true, 'sondern sagt, dass es das schon gibt');

    r = await tobi.ruf('GET', '/api/tournaments');
    gleich(r.daten.turniere.length, 1, 'Tobi sieht das Turnier, ohne dass ihn jemand einladen muss');
    gleich(r.daten.turniere[0].id, 'turnier1', 'und zwar genau dieses');

    r = await fremd.ruf('GET', '/api/tournaments');
    gleich(r.status, 401, 'ohne Anmeldung sieht man gar nichts');

    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m1r1/claim');
    gleich(r.status, 200, 'Julius beansprucht die erste Partie');
    r = await tobi.ruf('POST', '/api/tournaments/turnier1/matches/m1r1/claim');
    gleich(r.status, 409, 'Tobi kann dieselbe Partie nicht auch beanspruchen');
    gleich(r.daten.grund, 'belegt', 'Grund: belegt');
    ok(String(r.daten.fehler).includes('Julius'), 'und erfaehrt, wer sie hat');

    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m1r1/claim');
    gleich(r.status, 200, 'derselbe darf nochmal -- das ist bloss ein Neuladen');

    r = await tobi.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/claim');
    gleich(r.status, 200, 'die zweite Partie nimmt Tobi');
    const beideDa = r.daten.turnier.partien;
    gleich(beideDa.length, 2, 'beide Partien sind vergeben');

    r = await julius.ruf('PUT', '/api/tournaments/turnier1/matches/m1r1', {
      result: { id: 'm1r1', p: [julius_id, tobi_id], winner: julius_id, legs: [{ winner: julius_id, visits: [] }], done: true }
    });
    gleich(r.status, 200, 'Julius traegt sein Ergebnis ein');

    r = await tobi.ruf('PUT', '/api/tournaments/turnier1/matches/m1r1', {
      result: { id: 'm1r1', p: [julius_id, tobi_id], winner: tobi_id, legs: [{ winner: tobi_id, visits: [] }], done: true }
    });
    gleich(r.status, 409, 'ein vorhandenes Ergebnis eines anderen wird nicht ueberschrieben');
    gleich(r.daten.grund, 'gespielt', 'mit dem Grund "schon gespielt"');
    ok(r.daten.turnier && r.daten.turnier.partien.find((p) => p.matchId === 'm1r1').result.winner === julius_id, 'und dem gueltigen Stand');

    r = await tobi.ruf('GET', '/api/tournaments/turnier1');
    const m1 = r.daten.turnier.partien.find((p) => p.matchId === 'm1r1');
    ok(m1 && m1.result && m1.result.winner === julius_id, 'Tobi sieht Julius Ergebnis');
    const cursor = r.daten.turnier.cursor;
    r = await tobi.ruf('GET', '/api/tournaments/turnier1?since=' + cursor);
    gleich(r.daten.turnier.partien.length, 0, 'mit Cursor kommt nur Neues');

    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/frei');
    gleich(r.status, 200, 'freigeben eines fremden Anspruchs laeuft ins Leere');
    r = await tobi.ruf('GET', '/api/tournaments/turnier1');
    const m2 = r.daten.turnier.partien.find((p) => p.matchId === 'm2r1');
    ok(m2 && m2.claimedBy === tobi_id, 'Tobis Anspruch steht noch');

    r = await tobi.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/frei');
    gleich(r.status, 200, 'den eigenen darf man zurueckgeben');
    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/claim');
    gleich(r.status, 200, 'danach ist die Partie wieder frei');

    /* Spielerwechsel an zwei Geraeten: der Plan aendert sich mit Zaehler. */
    const plan2 = JSON.parse(JSON.stringify(plan));
    plan2.matches[1].p = [tobi_id, 'gastx'];
    plan2.gaeste = { gastx: 'Ersatz Mann' };
    r = await fremd.ruf('POST', '/api/tournaments/turnier1/plan', { plan: plan2, basis: 0 });
    gleich(r.status, 401, 'Plan aendern geht nur angemeldet');
    r = await tobi.ruf('POST', '/api/tournaments/turnier1/plan', { plan: plan2, basis: 0 });
    gleich(r.status, 200, 'ein Mitspieler darf den Plan aendern (Wechsel)');
    gleich(r.daten.turnier.plan.planStand, 1, 'der Plan zaehlt dabei hoch');
    gleich(r.daten.turnier.plan.matches[1].p[1], 'gastx', 'und traegt den neuen Spieler');
    r = await julius.ruf('POST', '/api/tournaments/turnier1/plan', { plan: plan2, basis: 0 });
    gleich(r.status, 409, 'wer gegen einen alten Plan schreibt, bekommt 409');
    ok(r.daten.turnier && r.daten.turnier.plan.planStand === 1, 'samt dem aktuellen Plan');
    const plan3 = JSON.parse(JSON.stringify(plan2));
    plan3.matches = [plan3.matches[0]];
    r = await julius.ruf('POST', '/api/tournaments/turnier1/plan', { plan: plan3, basis: 1 });
    gleich(r.status, 400, 'Partien duerfen dabei nicht verschwinden');
    r = await julius.ruf('GET', '/api/tournaments/turnier1');
    ok(r.daten.turnier.partien.find((p) => p.matchId === 'm1r1').result.winner === julius_id, 'das fertige Ergebnis bleibt unberuehrt');

    /* Ergebnis nach dem Ende (Funkloch beim Checkout): es landet auch im
       Archiv des Turniers, und das Archiv bekommt einen hoeheren Stand. */
    r = await julius.ruf('POST', '/api/games', {
      id: 'turnier1', kind: 'tournament', at: Date.now(),
      payload: { id: 'turnier1', kind: '501', at: Date.now(), lineup: [julius_id, tobi_id], settings: { start: 501, bestOf: 1 },
        matches: [
          { id: 'm1r1', p: [julius_id, tobi_id], legs: [{ winner: julius_id, visits: [] }], done: true, winner: julius_id },
          { id: 'm2r1', p: [tobi_id, julius_id], legs: [], done: false }
        ], winner: null },
      players: [{ userId: julius_id }, { userId: tobi_id }]
    });
    ok(r.status === 200 || r.status === 201, 'das Archiv des Turniers liegt beim Server');

    r = await julius.ruf('POST', '/api/tournaments/turnier1/ende');
    gleich(r.daten.turnier.status, 'beendet', 'das Turnier laesst sich beenden');
    r = await julius.ruf('POST', '/api/tournaments/turnier1/plan', { plan: plan2, basis: 1 });
    gleich(r.status, 409, 'ein beendetes Turnier aendert keinen Plan mehr');
    r = await tobi.ruf('PUT', '/api/tournaments/turnier1/matches/m2r1', {
      result: { id: 'm2r1', p: [tobi_id, julius_id], winner: tobi_id, legs: [{ winner: tobi_id, visits: [] }], done: true }
    });
    gleich(r.status, 200, 'ein spaetes Ergebnis wird nach dem Ende noch angenommen');
    r = await tobi.ruf('GET', '/api/games?since=0');
    const archiv1 = (r.daten.spiele || r.daten.games || []).find((g) => g.id === 'turnier1');
    ok(archiv1 && archiv1.payload.stand === 1 && archiv1.payload.matches[1].done === true && archiv1.payload.matches[1].winner === tobi_id,
      'und im Archiv nachgetragen (stand 1, Partie fertig)');
    r = await tobi.ruf('GET', '/api/tournaments');
    gleich(r.daten.turniere.length, 0, 'danach steht es nicht mehr zum Beitreten');
    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/claim');
    gleich(r.status, 409, 'und es wird nichts mehr beansprucht');

    console.log('\nLiga-Zusagen');
    r = await fremd.ruf('GET', '/api/liga/zusagen');
    gleich(r.status, 401, 'ohne Anmeldung gibt es keine Zusagen');
    r = await julius.ruf('GET', '/api/liga/zusagen');
    gleich(r.status, 200, 'angemeldet schon');
    ok(r.daten.zusagen && Object.keys(r.daten.zusagen).length === 0, 'anfangs ist niemand eingetragen');

    r = await julius.ruf('PUT', '/api/liga/zusagen/st01', { dabei: true });
    gleich(r.status, 200, 'Julius traegt sich fuer den 1. Spieltag ein');
    gleich(r.daten.zusagen.st01.length, 1, 'und steht in der Liste');
    ok(r.daten.zusagen.st01[0].name && !r.daten.zusagen.st01[0].email, 'mit Namen, ohne E-Mail');

    r = await julius.ruf('PUT', '/api/liga/zusagen/st01', { dabei: true });
    gleich(r.daten.zusagen.st01.length, 1, 'doppelt eintragen zaehlt nicht doppelt');

    r = await tobi.ruf('PUT', '/api/liga/zusagen/st01', { dabei: true });
    gleich(r.daten.zusagen.st01.length, 2, 'Tobi kommt dazu');
    r = await tobi.ruf('GET', '/api/liga/zusagen');
    gleich(r.daten.zusagen.st01.length, 2, 'beide sehen dieselbe Liste');

    r = await julius.ruf('PUT', '/api/liga/zusagen/st01', { dabei: false });
    gleich(r.daten.zusagen.st01.length, 1, 'austragen entfernt nur die eigene Zusage');
    gleich(r.daten.zusagen.st01[0].name, 'Tobi', 'Tobi bleibt drin');

    r = await fremd.ruf('PUT', '/api/liga/zusagen/st01', { dabei: true });
    gleich(r.status, 401, 'ohne Anmeldung traegt sich niemand ein');
    r = await julius.ruf('PUT', '/api/liga/zusagen/BOESE!!', { dabei: true });
    ok(r.status === 400 || r.status === 404, 'kaputte Termin-Kennungen werden abgewiesen');

    console.log('\nBürgerlicher Name');
    r = await julius.ruf('PATCH', '/api/me', { voll: '  Julius Klinzer  ' });
    gleich(r.status, 200, 'der volle Name laesst sich am Profil speichern');
    gleich(r.daten.nutzer.voll, 'Julius Klinzer', 'und kommt geputzt zurueck');
    r = await tobi.ruf('GET', '/api/users');
    {
      const jU = r.daten.nutzer.find((n) => n.id === julius_id);
      gleich(jU && jU.voll, 'Julius Klinzer', 'andere sehen den vollen Namen in der Mannschaftsliste');
    }
    r = await julius.ruf('PATCH', '/api/me', { voll: '' });
    gleich(r.daten.nutzer.voll, null, 'leerer Eintrag loescht den vollen Namen wieder');
    r = await julius.ruf('PATCH', '/api/me', { voll: 'x'.repeat(61) });
    gleich(r.status, 400, 'ueberlange Namen werden abgewiesen');

    console.log('\nLiga-Tabelle');
    r = await fremd.ruf('GET', '/api/liga/tabelle');
    gleich(r.status, 401, 'ohne Anmeldung gibt es keine Tabelle');
    r = await julius.ruf('GET', '/api/liga/tabelle');
    gleich(r.status, 200, 'angemeldet schon');
    gleich(r.daten.tabelle, null, 'anfangs ist noch nichts eingetragen');
    r = await julius.ruf('PUT', '/api/liga/tabelle', {
      tabelle: { zeilen: [{ team: 'Blink 180', spiele: '1', punkte: '4', legs: '4:0' }] }
    });
    gleich(r.status, 200, 'Julius speichert einen Tabellenstand');
    r = await tobi.ruf('GET', '/api/liga/tabelle');
    gleich(r.daten.tabelle && r.daten.tabelle.zeilen[0].punkte, '4', 'Tobi sieht denselben Stand');
    r = await tobi.ruf('PUT', '/api/liga/tabelle', {
      tabelle: { zeilen: [{ team: 'Blink 180', spiele: '2', punkte: '8', legs: '8:0' }] }
    });
    gleich(r.status, 200, 'Tobi ueberschreibt ihn');
    r = await julius.ruf('GET', '/api/liga/tabelle');
    gleich(r.daten.tabelle.zeilen[0].punkte, '8', 'und Julius sieht die neue Fassung');
    r = await julius.ruf('PUT', '/api/liga/tabelle', { tabelle: { blob: 'x'.repeat(30000) } });
    gleich(r.status, 400, 'zu grosse Datenpakete werden abgewiesen');
    r = await fremd.ruf('PUT', '/api/liga/tabelle', { tabelle: {} });
    gleich(r.status, 401, 'ohne Anmeldung speichert niemand');

    console.log('\nTrainings-Zusagen mit Status');
    r = await julius.ruf('PUT', '/api/liga/zusagen/tr20260908', { status: 'unsicher' });
    gleich(r.status, 200, 'Julius meldet sich unsicher zum Training');
    gleich(r.daten.zusagen.tr20260908[0].status, 'unsicher', 'der Status kommt in der Liste an');
    r = await julius.ruf('PUT', '/api/liga/zusagen/tr20260908', { status: 'dabei' });
    gleich(r.daten.zusagen.tr20260908[0].status, 'dabei', 'umentscheiden ueberschreibt den Status');
    r = await tobi.ruf('PUT', '/api/liga/zusagen/tr20260908', { status: 'absage' });
    gleich(r.daten.zusagen.tr20260908.length, 2, 'auch eine Absage ist eine sichtbare Antwort');
    r = await julius.ruf('PUT', '/api/liga/zusagen/tr20260908', { status: 'vielleicht-spaeter' });
    gleich(r.status, 400, 'erfundene Status werden abgewiesen');
    r = await julius.ruf('GET', '/api/liga/zusagen');
    ok(r.daten.zusagen.st01.every((z) => z.status === 'dabei'),
      'alte Spieltag-Zusagen gelten weiter als dabei');

    console.log('\nVereinskasse (Kassenbuch)');
    r = await fremd.ruf('GET', '/api/kasse');
    gleich(r.status, 401, 'ohne Anmeldung bleibt die Kasse zu');
    r = await julius.ruf('GET', '/api/kasse');
    gleich(r.daten.saldo, 0, 'die Kasse beginnt bei null');
    ok(r.daten.kassenwart === false && r.daten.konfig && r.daten.konfig.paypal.indexOf('paypal.com') > 0,
      'Julius ist (noch) kein Kassenwart -- der PayPal-Link ist fuer alle da');
    r = await tobi.ruf('POST', '/api/kasse', { betrag: 1000, text: 'Startgeld Tobi', kategorie: 'Startgelder Turniere', datum: '2026-08-30' });
    gleich(r.status, 200, 'jeder Angemeldete traegt eine Einzahlung ein');
    gleich(r.daten.saldo, 1000, 'sie steht sofort im Kassenbuch');
    const tobisBuchung = r.daten.eintraege[0];
    r = await tobi.ruf('POST', '/api/kasse', { betrag: 5000, text: 'Beitrag Julius', kategorie: 'Mitgliedsbeiträge', datum: '2026-08-30', mitglied: julius_id });
    gleich(r.status, 403, 'den Beitrag eines anderen bucht nur der Kassenwart');
    r = await tobi.ruf('PATCH', '/api/kasse/' + tobisBuchung.id, { betrag: 2000, text: 'Startgeld Tobi', kategorie: 'Startgelder Turniere', datum: '2026-08-30' });
    gleich(r.status, 403, 'aendern darf nur der Kassenwart');
    r = await tobi.ruf('DELETE', '/api/kasse/' + tobisBuchung.id);
    gleich(r.status, 200, 'die eigene Buchung darf jeder wieder loeschen');
    gleich(r.daten.saldo, 0, 'und der Bestand stimmt wieder');
    {
      const direkt = new DatabaseSync(dbDatei);
      direkt.exec("UPDATE users SET kassenwart = 1 WHERE email = 'julius@example.de'");
      direkt.close();
    }
    r = await julius.ruf('GET', '/api/kasse');
    ok(r.daten.kassenwart === true && r.daten.kassenwarte.some((n) => n.indexOf('Julius') === 0), 'als Kassenwart steht Julius im Kopf des Buchs');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 5000, text: 'Gründungsbeitrag Tobi', kategorie: 'Mitgliedsbeiträge', datum: '2026-09-01', mitglied: tobi_id });
    gleich(r.status, 200, 'Julius bucht Tobis Gruendungsbeitrag');
    gleich(r.daten.saldo, 5000, 'der Bestand rechnet mit');
    ok(r.daten.mitglieder.find((m) => m.id === tobi_id).gezahlt === 5000 && r.daten.mitglieder.find((m) => m.id === julius_id).gezahlt === 0,
      'Tobi gilt als bezahlt, Julius als offen');
    r = await julius.ruf('POST', '/api/kasse', { betrag: -1250, text: 'Neue Flights', kategorie: 'Ausrüstung/Dartpfeile', datum: '2026-09-02' });
    gleich(r.daten.saldo, 3750, 'eine Ausgabe zieht ab');
    const kasseEintrag = r.daten.eintraege[r.daten.eintraege.length - 1];
    ok(kasseEintrag.betrag === -1250 && kasseEintrag.kategorie === 'Ausrüstung/Dartpfeile' && kasseEintrag.datum === '2026-09-02', 'die Buchung traegt Kategorie und Datum');
    r = await julius.ruf('POST', '/api/kasse', { betrag: -500, text: 'Bier', kategorie: 'Spenden', datum: '2026-09-02' });
    gleich(r.status, 400, 'eine Einnahme-Kategorie passt nicht zu einer Ausgabe');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 0, text: 'nix', kategorie: 'Spenden' });
    gleich(r.status, 400, 'null Euro sind keine Buchung');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 100, kategorie: 'Spenden' });
    gleich(r.status, 400, 'ohne Text keine Buchung');
    r = await julius.ruf('PATCH', '/api/kasse/konfig', { anfangsbestand: 10000, jahr: 2026 });
    gleich(r.status, 200, 'der Kassenwart setzt den Anfangsbestand');
    gleich(r.daten.saldo, 13750, 'der Kassenstand rechnet den Anfangsbestand mit');
    r = await tobi.ruf('PATCH', '/api/kasse/konfig', { anfangsbestand: 0 });
    gleich(r.status, 403, 'sonst niemand');
    r = await julius.ruf('PATCH', '/api/kasse/' + kasseEintrag.id, { betrag: -1500, text: 'Neue Flights (Rechnung)', kategorie: 'Ausrüstung/Dartpfeile', datum: '2026-09-03' });
    gleich(r.status, 200, 'der Kassenwart aendert eine Buchung');
    gleich(r.daten.saldo, 13500, 'der neue Betrag zaehlt');
    ok(r.daten.eintraege.some((e) => e.id === kasseEintrag.id && e.datum === '2026-09-03' && e.text === 'Neue Flights (Rechnung)'), 'Datum und Text sind geaendert');
    r = await tobi.ruf('DELETE', '/api/kasse/' + kasseEintrag.id);
    gleich(r.status, 403, 'fremde Buchungen loescht nur der Kassenwart');
    r = await julius.ruf('DELETE', '/api/kasse/' + kasseEintrag.id);
    gleich(r.status, 200, 'der Kassenwart loescht auch fremde Buchungen');
    gleich(r.daten.saldo, 15000, 'der Bestand stimmt danach wieder');

    console.log('\nRate-Limit');
    let gesperrt = false;
    for (let i = 0; i < 8; i++) {
      const a = await tobi.ruf('POST', '/api/login', { email: 'tobi@example.de', password: 'immerfalsch' });
      if (a.status === 429) {
        gesperrt = true;
        break;
      }
    }
    ok(gesperrt, 'nach mehreren Fehlversuchen wird der Login gesperrt');

    console.log('\nKamera-Relay');
    const RAUM = 'TESTQ2';
    const TOKEN = 'testtoken12345678';
    r = await julius.ruf('POST', '/api/kamera/raum', { code: RAUM, token: TOKEN });
    gleich(r.status, 200, 'das iPad registriert seinen Raum');
    ok(typeof r.daten.seq === 'number', 'die Antwort traegt den Zaehlerstand des Raums');
    r = await julius.ruf('POST', '/api/kamera/raum', { code: RAUM, token: TOKEN });
    gleich(r.status, 200, 'derselbe Raum laesst sich mit dem eigenen Token wiederbeleben');
    r = await tobi.ruf('POST', '/api/kamera/raum', { code: RAUM, token: 'fremdesToken1234' });
    gleich(r.status, 409, 'ein fremdes Geraet bekommt den Code nicht');
    r = await julius.rufOhneHeader('POST', '/api/kamera/raum', { code: RAUM, token: TOKEN });
    gleich(r.status, 403, 'ohne App-Header wird kein Raum angelegt');
    r = await julius.ruf('POST', '/api/kamera/raum', { code: 'klein1', token: TOKEN });
    gleich(r.status, 400, 'Kleinbuchstaben sind kein Raumcode');
    r = await julius.ruf('POST', '/api/kamera/raum/' + RAUM + '/ereignis',
      { von: 'linse', typ: 'dart', daten: { mult: 5, num: 20 } });
    gleich(r.status, 400, 'eine fuenffache 20 gibt es nicht');
    r = await julius.ruf('POST', '/api/kamera/raum/' + RAUM + '/ereignis',
      { von: 'linse', typ: 'dart', daten: { mult: 3, num: 25 } });
    gleich(r.status, 400, 'Triple-Bull gibt es auch nicht');
    r = await julius.ruf('POST', '/api/kamera/raum/' + RAUM + '/ereignis',
      { von: 'linse', typ: 'spielstand', daten: {} });
    gleich(r.status, 400, 'die Linse darf keinen Spielstand melden');
    r = await julius.ruf('POST', '/api/kamera/raum/FEHLTX/ereignis',
      { von: 'linse', typ: 'dart', daten: { mult: 3, num: 20 } });
    gleich(r.status, 404, 'ein unbekannter Raum nimmt nichts an');

    /* SSE: der Tisch lauscht, die Linse meldet eine T20. Gelesen wird ueber
       den rohen Body-Strom -- genau das tut auch der EventSource im Browser. */
    const sseLeser = (antwort) => {
      const leser = antwort.body.getReader();
      const dec = new TextDecoder();
      let puffer = '';
      let leseVorgang = null;
      let zu = false;
      return {
        async bis(muster, ms) {
          const ende = Date.now() + ms;
          while (!puffer.includes(muster) && Date.now() < ende) {
            if (!leseVorgang) leseVorgang = leser.read().catch(() => ({ done: true }));
            const erg = await Promise.race([
              leseVorgang,
              new Promise((res) => setTimeout(() => res(undefined), 200))
            ]);
            if (erg === undefined) continue;   // nur der Wecker: weiter warten
            leseVorgang = null;
            if (erg.done) { zu = true; break; }
            puffer += dec.decode(erg.value, { stream: true });
          }
          return puffer.includes(muster);
        },
        /* Wartet, bis der Server den Strom schliesst. */
        async bisZu(ms) {
          await this.bis('\u0000nie-gesendet\u0000', ms);
          return zu;
        },
        get text() { return puffer; }
      };
    };

    const ac1 = new AbortController();
    const strom1 = await fetch(BASIS + '/api/kamera/raum/' + RAUM + '/strom?rolle=tisch', { signal: ac1.signal });
    gleich(strom1.status, 200, 'der Ereignis-Strom oeffnet');
    const tisch1 = sseLeser(strom1);
    ok(await tisch1.bis(': verbunden', 3000), 'und meldet sich');
    r = await tobi.ruf('POST', '/api/kamera/raum/' + RAUM + '/ereignis',
      { von: 'linse', typ: 'dart', daten: { mult: 3, num: 20, konfidenz: 1 } });
    gleich(r.status, 200, 'die Linse meldet eine T20');
    ok(await tisch1.bis('"typ":"dart"', 3000), 'der Tisch bekommt sie zugestellt');
    ok(tisch1.text.includes('"mult":3') && tisch1.text.includes('"num":20'),
      'mit Multiplikator und Feld');
    ac1.abort();

    /* Neuverbinden nach WLAN-Schluckauf: mit Last-Event-ID kommt Verpasstes
       aus dem Ringpuffer nach. */
    const ac2 = new AbortController();
    const strom2 = await fetch(BASIS + '/api/kamera/raum/' + RAUM + '/strom?rolle=tisch', {
      headers: { 'Last-Event-ID': '0' }, signal: ac2.signal
    });
    const tisch2 = sseLeser(strom2);
    ok(await tisch2.bis('"typ":"dart"', 3000), 'nach dem Neuverbinden kommt der Dart aus dem Puffer');
    ac2.abort();

    /* Mit ?ab= (Wasserzeichen des Clients) bleibt schon Verarbeitetes im
       Puffer - genau der Riegel gegen Doppelbuchung nach einem iPad-Reload. */
    const ac3 = new AbortController();
    const strom3 = await fetch(BASIS + '/api/kamera/raum/' + RAUM + '/strom?rolle=tisch&ab=999', { signal: ac3.signal });
    const tisch3 = sseLeser(strom3);
    ok(await tisch3.bis(': verbunden', 3000), 'der Strom mit Wasserzeichen oeffnet');
    ok(!(await tisch3.bis('"typ":"dart"', 1200)), 'liefert den alten Dart aber nicht noch einmal');
    ac3.abort();

    r = await fetch(BASIS + '/api/kamera/raum/' + RAUM + '/strom');
    gleich(r.status, 400, 'ohne Rolle gibt es keinen Strom');

    console.log('\nOnline-Spiel');
    /* Zwei Freunde an zwei Scheiben: der Spielstand liegt als Ganzes beim
       Server, beide sehen ihn, beide schreiben -- gegen die Version, die
       sie kennen. */
    const stand1 = { id: 'live1', kind: 'quick', p: [julius_id, tobi_id], legs: [], started: false };
    r = await julius.ruf('POST', '/api/live', { id: 'live0', kind: 'quick', state: Object.assign({}, stand1, { id: 'live0' }), players: [julius_id, tobi_id] });
    gleich(r.status, 201, 'ein liegengebliebenes Online-Spiel von Julius');
    r = await julius.ruf('POST', '/api/live', { id: 'live1', kind: 'quick', state: stand1, players: [julius_id, tobi_id] });
    gleich(r.status, 201, 'Julius legt ein Online-Spiel an');
    gleich(r.daten.spiel.seq > 0, true, 'es hat eine Versionsnummer');
    gleich(r.daten.spiel.state.kind, 'quick', 'und den Stand, wie er hingeschickt wurde');
    const liveSeq1 = r.daten.spiel.seq;
    r = await julius.ruf('GET', '/api/live/live0');
    gleich(r.daten.spiel.status, 'zu', 'das liegengebliebene ist damit zu -- ein Mensch, ein Online-Spiel');

    r = await julius.ruf('POST', '/api/live', { id: 'live1', kind: 'quick', state: stand1, players: [julius_id] });
    gleich(r.status, 200, 'ein zweiter Versuch mit derselben Kennung meckert nicht');
    ok(r.daten.schonDa === true, 'sondern sagt, dass es das schon gibt');

    r = await julius.ruf('POST', '/api/live', { id: 'live2', kind: 'quick', state: stand1, players: [] });
    gleich(r.status, 400, 'ohne Mitspieler mit Konto gibt es kein Online-Spiel');
    r = await julius.ruf('POST', '/api/live', { id: 'live3', kind: '501', state: stand1, players: [tobi_id] });
    gleich(r.status, 400, 'ein Turnier geht nicht als Online-Spiel');
    r = await julius.ruf('POST', '/api/live', { id: 'live4', kind: 'quick', state: stand1, players: [tobi_id] });
    gleich(r.status, 400, 'ein Stand mit fremder Kennung wird abgelehnt');

    r = await tobi.ruf('GET', '/api/live');
    gleich(r.daten.spiele.length, 1, 'Tobi sieht das Spiel, ohne dass ihn jemand einladen muss');
    ok(String(r.daten.spiele[0].angelegtVonName).startsWith('Julius'), 'mit dem Namen dessen, der es angelegt hat');
    ok(r.daten.spiele[0].spielerNamen.includes('Tobi'), 'und den Namen der Mitspieler');
    ok(r.daten.spiele[0].state === undefined, 'die Liste kommt ohne Stand -- den holt man beim Mitspielen');
    r = await fremd.ruf('GET', '/api/live');
    gleich(r.status, 401, 'ohne Anmeldung sieht niemand Online-Spiele');
    r = await fremd.ruf('GET', '/api/live/live1');
    gleich(r.status, 401, 'und abrufen geht auch nicht');

    r = await tobi.ruf('GET', '/api/live/live1?since=' + liveSeq1);
    gleich(r.status, 200, 'Tobi fragt nach Neuem seit seiner Version');
    ok(r.daten.spiel.state === undefined, 'und bekommt keinen Stand, wenn es nichts Neues gibt');

    const stand2 = Object.assign({}, stand1, { started: true, legs: [{ visits: [{ p: julius_id, s: 60, d: 3 }] }] });
    r = await tobi.ruf('PUT', '/api/live/live1', { state: stand2, seq: liveSeq1 });
    gleich(r.status, 200, 'Tobi traegt eine Aufnahme ein');
    const liveSeq2 = r.daten.spiel.seq;
    ok(liveSeq2 > liveSeq1, 'die Version steigt');
    gleich(r.daten.spiel.geaendertVonName, 'Tobi', 'und der Server weiss, wer es war');

    r = await julius.ruf('PUT', '/api/live/live1', { state: stand1, seq: liveSeq1 });
    gleich(r.status, 409, 'Julius schreibt gegen die alte Version und wird abgewiesen');
    ok(String(r.daten.fehler).includes('Tobi'), 'mit dem Namen dessen, der schneller war');
    gleich(r.daten.spiel.state.legs[0].visits.length, 1, 'und bekommt den gueltigen Stand gleich mit');

    r = await julius.ruf('GET', '/api/live/live1?since=' + liveSeq1);
    gleich(r.daten.spiel.state.legs[0].visits[0].s, 60, 'beim Nachfragen kommt Tobis Aufnahme an');

    r = await fremd.ruf('PUT', '/api/live/live1', { state: stand2, seq: liveSeq2 });
    gleich(r.status, 401, 'ohne Anmeldung schreibt niemand mit');
    r = await julius.rufOhneHeader('PUT', '/api/live/live1', { state: stand2, seq: liveSeq2 });
    gleich(r.status, 403, 'und ohne App-Kennzeichen geht es auch nicht');

    const stand3 = Object.assign({}, stand2, { done: true, winner: julius_id });
    r = await julius.ruf('POST', '/api/live/live1/ende', { state: stand3 });
    gleich(r.status, 200, 'Julius schliesst das Spiel mit dem Schlussstand');
    gleich(r.daten.spiel.status, 'zu', 'es ist zu');
    gleich(r.daten.spiel.state.done, true, 'und der Schlussstand ist der letzte');
    r = await tobi.ruf('GET', '/api/live');
    gleich(r.daten.spiele.length, 0, 'und steht bei Tobi nicht mehr zum Mitspielen');
    r = await tobi.ruf('GET', '/api/live/live1?since=' + liveSeq2);
    gleich(r.daten.spiel.status, 'zu', 'aber Tobi erfaehrt beim Nachfragen vom Ende');
    ok(!!r.daten.spiel.state, 'samt Schlussstand');
    r = await tobi.ruf('PUT', '/api/live/live1', { state: stand2, seq: r.daten.spiel.seq });
    gleich(r.status, 409, 'in ein geschlossenes Spiel schreibt niemand mehr');

    console.log('\nTestkonten');
    const tester = geraet('Tester');
    r = await tester.ruf('POST', '/api/register', {
      invite: CODE, email: 'tester@example.de', name: 'Test Eins', password: 'nurzumtesten26'
    });
    gleich(r.status, 201, 'ein Testkonto wird wie jedes andere registriert');
    const tester_id = r.daten.nutzer.id;
    /* Die Flags setzt niemand ueber die API -- sie kommen per Migration bzw.
       von Hand in die Datenbank. */
    {
      const direkt = new DatabaseSync(dbDatei);
      direkt.exec("UPDATE users SET test = 1 WHERE email = 'tester@example.de'");
      direkt.exec("UPDATE users SET sieht_test = 1 WHERE email = 'julius@example.de'");
      direkt.close();
    }
    r = await tobi.ruf('GET', '/api/users');
    ok(!r.daten.nutzer.some((n) => n.id === tester_id), 'Tobi sieht das Testkonto nicht im Roster');
    r = await tester.ruf('GET', '/api/users');
    ok(r.daten.nutzer.some((n) => n.id === tester_id), 'das Testkonto sieht sich selbst -- sonst verloere es sein Profil');
    r = await julius.ruf('GET', '/api/users');
    const testEintrag = r.daten.nutzer.find((n) => n.id === tester_id);
    ok(!!testEintrag && testEintrag.test === true, 'Julius sieht es -- als Testkonto markiert');
    ok(r.daten.nutzer.find((n) => n.id === tobi_id).test === false, 'echte Konten tragen die Marke nicht');

    r = await tobi.ruf('GET', '/api/games?since=0');
    const vorTest = r.daten.cursor;
    const testspiel = spielPayload([julius_id, tester_id]);
    testspiel.id = 'testspiel-mit-tester';
    r = await julius.ruf('POST', '/api/games', {
      id: testspiel.id, kind: '501', at: testspiel.at, payload: testspiel,
      players: [{ userId: julius_id }, { userId: tester_id }]
    });
    gleich(r.status, 201, 'Julius traegt ein Spiel mit dem Testkonto ein');
    r = await tobi.ruf('GET', '/api/games?since=' + vorTest);
    ok(!r.daten.spiele.some((s) => s.id === testspiel.id), 'bei Tobi laeuft das Testspiel nie ein');
    r = await julius.ruf('GET', '/api/games?since=' + vorTest);
    ok(r.daten.spiele.some((s) => s.id === testspiel.id), 'bei Julius schon');
    r = await tester.ruf('GET', '/api/games?since=' + vorTest);
    ok(r.daten.spiele.some((s) => s.id === testspiel.id), 'und beim Testkonto selbst');
    r = await julius.ruf('DELETE', '/api/games/' + testspiel.id);
    gleich(r.status, 200, 'und er kann es zurueckziehen');
    r = await tobi.ruf('GET', '/api/games?since=' + vorTest);
    ok(r.daten.spiele.some((s) => s.id === testspiel.id && s.geloescht === true),
      'der Grabstein erreicht trotzdem alle -- frueher verteilte Testspiele verschwinden so');

    /* ================= Haertung (Audit 28.09.2026) ================= */

    console.log('\nProfilbild: nur echte Bilder (S1)');
    const XSS_BILD = 'data:image/png;base64,x")"></span><img src=x onerror=alert(1)>';
    r = await tobi.ruf('PATCH', '/api/me', { avatar: XSS_BILD });
    gleich(r.status, 400, 'ein Bild mit eingeschmuggeltem HTML wird abgewiesen');
    r = await tobi.ruf('PATCH', '/api/me', { avatar: 'data:image/png;base64,iVBORw0KGgo=")' });
    gleich(r.status, 400, 'auch Anfuehrungszeichen und Klammern nach dem Base64 fliegen raus');
    r = await tobi.ruf('PATCH', '/api/me', { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' });
    gleich(r.status, 400, 'SVG (kann Skript enthalten) ist kein erlaubtes Bildformat');
    r = await tobi.ruf('PATCH', '/api/me', { avatar: 'data:image/png;base64,' + 'A'.repeat(400001) });
    gleich(r.status, 400, 'ueberlange Bilder werden abgewiesen');
    r = await tobi.ruf('PATCH', '/api/me', { avatar: 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=' });
    gleich(r.status, 200, 'ein echtes kleines WebP geht durch');
    r = await julius.ruf('GET', '/api/users');
    ok(r.daten.nutzer.every((n) => n.avatar === null || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(n.avatar)),
      'im Kader stehen nur saubere Bilder');

    console.log('\nAnmeldung: kleine Pakete, gedeckeltes Rate-Limit (S2)');
    r = await fremd.ruf('POST', '/api/login', { email: 'x'.repeat(5000) + '@example.de', password: 'egal123' });
    gleich(r.status, 400, 'eine riesige E-Mail beim Login wird sofort abgewiesen');
    r = await fremd.ruf('POST', '/api/login', { email: 'a@example.de', password: 'p'.repeat(20000) });
    gleich(r.status, 413, 'ein Login-Paket ueber 16 KB wird abgewiesen');
    r = await fremd.ruf('POST', '/api/register', { invite: CODE, email: 'b@example.de', name: 'Bert', password: 'p'.repeat(20000) });
    gleich(r.status, 413, 'eine Registrierung ueber 16 KB ebenso');
    r = await julius.ruf('POST', '/api/password', { alt: 'x', neu: 'p'.repeat(20000) });
    gleich(r.status, 413, 'und ein Passwortwechsel ueber 16 KB auch');
    {
      const rl = await import('../server/lib/ratelimit.mjs');
      for (let i = 0; i < rl.MAX_EINTRAEGE + 500; i++) rl.zaehle('flut:' + i, 5, 60e3);
      ok(rl.anzahl() <= rl.MAX_EINTRAEGE, 'die Rate-Limit-Tabelle waechst nie ueber ' + rl.MAX_EINTRAEGE + ' Eintraege');
      ok(rl.pruefe('flut:' + (rl.MAX_EINTRAEGE + 499), 1, 60e3) > 0, 'die juengsten Eintraege bleiben dabei erhalten');
    }

    console.log('\nKaputtes Cookie (S-N4)');
    fremd.setzeCookie('darts_session=%E0%A4%A');
    r = await fremd.ruf('GET', '/api/users');
    gleich(r.status, 401, 'ein kaputt kodiertes Cookie ergibt 401 statt 500');
    r = await fremd.ruf('GET', '/api/me');
    ok(r.status === 200 && r.daten.nutzer === null, 'und /api/me sagt schlicht: niemand angemeldet');
    fremd.setzeCookie('');

    console.log('\nPasswort-Hashes: staerker, alte werden still erneuert (S-N3)');
    {
      const pw = await import('../server/lib/password.mjs');
      const h = pw.hashPassword('einhundertachtzig');
      ok(h.startsWith('scrypt$131072$'), 'neue Hashes rechnen mit N = 2^17');
      ok(pw.verifyPassword('einhundertachtzig', h) && !pw.verifyPassword('falsch', h), 'und lassen sich pruefen');
      ok(pw.braucheNeuHash('scrypt$16384$aa$bb') && !pw.braucheNeuHash(h), 'alte Hashes werden als veraltet erkannt');
    }
    const altkonto = geraet('Altkonto');
    r = await altkonto.ruf('POST', '/api/register', { invite: CODE, email: 'alt@example.de', name: 'Alt Konto', password: 'altespasswort26' });
    gleich(r.status, 201, 'ein weiteres Konto fuer die Hash-Pruefung');
    {
      const salz = 'a1b2c3d4e5f6a7b8';
      const alt = 'scrypt$16384$' + salz + '$' + scryptSync('altespasswort26', salz, 64, { N: 16384 }).toString('hex');
      const direkt = new DatabaseSync(dbDatei);
      direkt.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(alt, 'alt@example.de');
      direkt.close();
    }
    r = await altkonto.ruf('POST', '/api/login', { email: 'alt@example.de', password: 'altespasswort26' });
    gleich(r.status, 200, 'mit einem alten Hash klappt der Login weiterhin');
    {
      const direkt = new DatabaseSync(dbDatei);
      const neu = direkt.prepare('SELECT password_hash FROM users WHERE email = ?').get('alt@example.de').password_hash;
      direkt.close();
      ok(neu.startsWith('scrypt$131072$'), 'und danach liegt ein neuer, staerkerer Hash in der Datenbank');
    }
    r = await altkonto.ruf('POST', '/api/logout');
    r = await altkonto.ruf('POST', '/api/login', { email: 'alt@example.de', password: 'altespasswort26' });
    gleich(r.status, 200, 'mit dem neuen Hash geht es genauso');

    console.log('\nGleitende Sessions (S-N2)');
    {
      const token = altkonto.cookie().split('=')[1];
      const bald = new Date(Date.now() + 10 * 864e5).toISOString();
      const direkt = new DatabaseSync(dbDatei);
      direkt.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(bald, token);
      direkt.close();
      r = await altkonto.ruf('GET', '/api/me');
      const gesetzt = r.kopf.getSetCookie ? r.kopf.getSetCookie() : [];
      ok(gesetzt.some((c) => c.startsWith('darts_session=' + token) && c.includes('Max-Age=' + 90 * 86400)),
        'eine Session, die bald ablaeuft, bekommt bei Benutzung ein frisches Cookie');
      const direkt2 = new DatabaseSync(dbDatei);
      const ablauf = direkt2.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token).expires_at;
      direkt2.close();
      ok(Date.parse(ablauf) > Date.now() + 89 * 864e5, 'und laeuft wieder volle 90 Tage ab jetzt');
      r = await altkonto.ruf('GET', '/api/me');
      const nochmal = r.kopf.getSetCookie ? r.kopf.getSetCookie() : [];
      ok(!nochmal.length, 'gleich danach wird nicht schon wieder geschrieben (hoechstens einmal am Tag)');
      const alt = new Date(Date.now() - 1000).toISOString();
      const direkt3 = new DatabaseSync(dbDatei);
      direkt3.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(alt, token);
      direkt3.close();
      r = await altkonto.ruf('GET', '/api/users');
      gleich(r.status, 401, 'eine abgelaufene Session wird nicht wiederbelebt');
    }

    console.log('\nTurnier: "schon da" nur fuer Mitspieler (S-M1)');
    r = await tester.ruf('POST', '/api/tournaments', { id: 'turnier1', plan, players: [tester_id] });
    gleich(r.status, 403, 'wer nicht mitspielt, bekommt den fremden Turnierstand nicht');
    ok(!r.daten.turnier, 'auch nicht als Beigabe zur Fehlermeldung');

    console.log('\nMindestform der Spielinhalte (S-M2)');
    const spielMit = (id, kind, payload) => julius.ruf('POST', '/api/games', {
      id, kind, at: Date.now(), payload, players: [{ userId: julius_id }, { userId: tobi_id }]
    });
    r = await spielMit('kaputt3', 'tournament', { id: 'kaputt3', lineup: [julius_id, tobi_id], matches: null });
    gleich(r.status, 400, 'ein Turnier mit "matches": null wird abgewiesen');
    r = await spielMit('kaputt4', 'tournament', { lineup: [julius_id, tobi_id], matches: [{ id: 'm1"><img src=x onerror=alert(1)>', p: [julius_id, tobi_id], legs: [] }] });
    gleich(r.status, 400, 'eine Partie-Kennung mit HTML darin wird abgewiesen');
    r = await spielMit('kaputt5', 'cricket', { kind: 'cricket" onmouseover="x', players: [julius_id, tobi_id], throws: [] });
    gleich(r.status, 400, 'eine Spielart mit HTML darin wird abgewiesen');
    r = await spielMit('kaputt6', 'cricket', { kind: 'cricket', players: [julius_id, tobi_id] });
    gleich(r.status, 400, 'Cricket ohne Wurfliste wird abgewiesen');
    r = await spielMit('kaputt7', 'finisher', { kind: 'finisher', players: [julius_id], rounds: 'viele' });
    gleich(r.status, 400, 'Finisher ohne Rundenliste wird abgewiesen');
    r = await spielMit('kaputt8', '501', { players: 'Julius', throws: [] });
    gleich(r.status, 400, 'eine Spielerliste, die keine Liste ist, wird abgewiesen');
    r = await spielMit('kaputt9', 'rtw', { kind: 'rtw', players: [julius_id], throws: [], namen: { '"><b>': 'x' } });
    gleich(r.status, 400, 'fremde Namen mit kaputter Kennung werden abgewiesen');
    r = await spielMit('schnell1', 'tournament', {
      id: 'schnell1', kind: 'quick', at: Date.now(), players: [julius_id, tobi_id], winner: julius_id,
      lineup: [julius_id, tobi_id], settings: { start: 501, bestOf: 1 },
      matches: [{ id: 'schnell1', p: [julius_id, tobi_id], starter: julius_id, legs: [{ visits: [] }], done: true, winner: julius_id }],
      namen: { [julius_id]: 'Julius K.', [tobi_id]: 'Tobi' }
    });
    gleich(r.status, 201, 'ein Schnelles Spiel, wie die App es ablegt, geht durch');
    r = await spielMit('finish1', 'finisher', { id: 'finish1', kind: 'finisher', players: [julius_id], rounds: [], ziel: 60, winner: julius_id });
    gleich(r.status, 201, 'ein Finisher, wie die App ihn ablegt, geht durch');
    r = await julius.ruf('POST', '/api/tournaments', { id: 'turnier9', plan: { players: [julius_id, tobi_id], matches: null }, players: [tobi_id] });
    gleich(r.status, 400, 'ein Spielplan ohne Partienliste wird abgewiesen');
    r = await julius.ruf('POST', '/api/tournaments', {
      id: 'turnier2', players: [tobi_id],
      plan: { start: 501, bestOf: 1, players: [julius_id, tobi_id], matches: [{ id: 'a1a1', round: 1, p: [julius_id, tobi_id] }], gaeste: {} }
    });
    gleich(r.status, 201, 'ein ordentlicher Spielplan geht durch');
    r = await julius.ruf('PUT', '/api/tournaments/turnier2/matches/a1a1', { result: { id: 'b2b2', p: [julius_id, tobi_id], legs: [] } });
    gleich(r.status, 400, 'ein Ergebnis fuer eine andere Partie wird abgewiesen');
    r = await julius.ruf('PUT', '/api/tournaments/turnier2/matches/a1a1', { result: { id: 'a1a1', p: [julius_id, tobi_id], legs: null } });
    gleich(r.status, 400, 'ein Ergebnis ohne Legs auch');
    r = await julius.ruf('PUT', '/api/tournaments/turnier2/matches/a1a1', { result: { id: 'a1a1', p: [julius_id, tobi_id], legs: [], done: true, winner: julius_id } });
    gleich(r.status, 200, 'ein ordentliches Ergebnis geht durch');
    r = await julius.ruf('POST', '/api/live', { id: 'live6', kind: 'quick', state: { id: 'live6', kind: 'quick', p: [julius_id, '<b>'], legs: [] }, players: [tobi_id] });
    gleich(r.status, 400, 'ein Online-Stand mit kaputter Spieler-Kennung wird abgewiesen');
    r = await julius.ruf('POST', '/api/live', { id: 'live6', kind: 'cricket', state: { id: 'live6', kind: 'cricket', players: [julius_id, tobi_id] }, players: [tobi_id] });
    gleich(r.status, 400, 'ein Cricket-Stand ohne Wurfliste auch');

    console.log('\nTestkonten bleiben ueberall unsichtbar (S-M5)');
    r = await tester.ruf('PUT', '/api/liga/zusagen/st02', { dabei: true });
    gleich(r.status, 200, 'das Testkonto sagt fuer einen Spieltag zu');
    r = await tobi.ruf('GET', '/api/liga/zusagen');
    ok(!(r.daten.zusagen.st02 || []).length, 'Tobi sieht die Zusage des Testkontos nicht');
    r = await julius.ruf('GET', '/api/liga/zusagen');
    ok((r.daten.zusagen.st02 || []).some((z) => z.id === tester_id), 'Julius (darf Testkonten sehen) schon');
    r = await tobi.ruf('GET', '/api/kasse');
    const saldoVorher = r.daten.saldo;
    r = await tester.ruf('POST', '/api/kasse', { betrag: 777, text: 'Testbuchung', kategorie: 'Spenden', datum: '2026-09-10' });
    gleich(r.status, 200, 'das Testkonto bucht etwas in die Kasse');
    r = await tobi.ruf('GET', '/api/kasse');
    ok(!r.daten.eintraege.some((e) => e.text === 'Testbuchung'), 'Tobi sieht die Testbuchung nicht');
    gleich(r.daten.saldo, saldoVorher, 'und sein Kassenstand bleibt unberuehrt');
    r = await julius.ruf('GET', '/api/kasse');
    ok(r.daten.eintraege.some((e) => e.text === 'Testbuchung'), 'Julius sieht sie');
    r = await tester.ruf('POST', '/api/tournaments', {
      id: 'testturnier', players: [tobi_id],
      plan: { players: [tester_id, tobi_id], matches: [{ id: 't1', round: 1, p: [tester_id, tobi_id] }] }
    });
    gleich(r.status, 201, 'das Testkonto legt ein Turnier mit Tobi an');
    r = await tobi.ruf('GET', '/api/tournaments/testturnier');
    gleich(r.daten.turnier.angelegtVonName, null, 'Tobi bekommt den Namen des Testkontos nicht geliefert');

    console.log('\nMengen je Konto (S-M7)');
    const viel = geraet('Vielspieler');
    r = await viel.ruf('POST', '/api/register', { invite: CODE, email: 'viel@example.de', name: 'Vielspieler', password: 'jedentagzweihundert' });
    gleich(r.status, 201, 'ein Konto fuer die Mengenpruefung');
    const viel_id = r.daten.nutzer.id;
    const gross = spielPayload([viel_id, tobi_id]);
    gross.id = 'riesig';
    gross.throws = [{ p: 0, darts: [60, 60, 60], notiz: 'x'.repeat(310 * 1024) }];
    r = await viel.ruf('POST', '/api/games', { id: 'riesig', kind: '501', at: Date.now(), payload: gross, players: [{ userId: viel_id }] });
    gleich(r.status, 413, 'ein Spiel ueber 300 KB wird abgewiesen');
    {
      /* Ein grosser Turnierabend: 45 Partien mit Einzeldarts, rund 400 KB. */
      const visite = { p: viel_id, s: 60, d: 3, b: false, c: false, o: 0, k: [{ m: 1, n: 20 }, { m: 1, n: 20 }, { m: 1, n: 20 }] };
      const partien = [];
      for (let i = 0; i < 45; i++) {
        partien.push({ id: 'gm' + i, p: [viel_id, tobi_id], legs: [0, 1, 2].map(() => ({ visits: Array(30).fill(visite) })), done: true, winner: viel_id });
      }
      const abend = { id: 'grossabend', at: Date.now(), lineup: [viel_id, tobi_id], settings: { start: 501, bestOf: 3 }, matches: partien, winner: viel_id };
      ok(JSON.stringify(abend).length > 300 * 1024, 'der Turnierabend ist tatsaechlich groesser als 300 KB');
      r = await viel.ruf('POST', '/api/games', { id: 'grossabend', kind: 'tournament', at: Date.now(), payload: abend, players: [{ userId: viel_id }, { userId: tobi_id }] });
      gleich(r.status, 201, 'das Archiv eines grossen Turnierabends passt trotzdem (Grenze dort 1 MB)');
    }
    let angenommen = 0;
    let letzter = 0;
    for (let i = 0; i < 201; i++) {
      const p = spielPayload([viel_id, tobi_id]);
      p.id = 'viel' + i;
      const a = await viel.ruf('POST', '/api/games', { id: p.id, kind: '501', at: Date.now(), payload: p, players: [{ userId: viel_id }] });
      if (a.status === 201) angenommen++;
      letzter = a.status;
    }
    gleich(angenommen, 199, 'zusammen mit dem Turnierabend nimmt der Server 200 Spiele an einem Tag an');
    gleich(letzter, 429, 'das 201. nicht mehr');
    r = await viel.ruf('POST', '/api/games', { id: 'viel0', kind: '501', at: Date.now(), payload: spielPayload([viel_id]), players: [{ userId: viel_id }] });
    gleich(r.status, 200, 'eine Wiederholung eines schon angenommenen Spiels meckert trotzdem nicht');
    r = await viel.ruf('POST', '/api/tournaments', { id: 'vielturnier', plan: { matches: [] }, players: [tobi_id] });
    gleich(r.status, 429, 'auch ein Turnier zaehlt in dieselbe Tagesgrenze');
    r = await tobi.ruf('POST', '/api/live', { id: 'vielonline', kind: 'quick', state: { id: 'vielonline', kind: 'quick', p: [tobi_id, viel_id], legs: [] }, players: [viel_id] });
    gleich(r.status, 201, 'Tobi legt ein Online-Spiel mit dem Vielspieler an');
    let liveSeq = r.daten.spiel.seq;
    let liveOk = 0;
    let liveLetzter = 0;
    for (let i = 0; i < 61; i++) {
      const a = await viel.ruf('PUT', '/api/live/vielonline', { state: { id: 'vielonline', kind: 'quick', p: [tobi_id, viel_id], legs: [], n: i }, seq: liveSeq });
      liveLetzter = a.status;
      if (a.status !== 200) break;
      liveOk++;
      liveSeq = a.daten.spiel.seq;
    }
    gleich(liveOk, 60, 'Online-Zuege laufen bis zur (im Test kleinen) Tagesgrenze durch');
    gleich(liveLetzter, 429, 'danach ist fuer heute Schluss');
    r = await tobi.ruf('PUT', '/api/live/vielonline', { state: { id: 'vielonline', kind: 'quick', p: [tobi_id, viel_id], legs: [], notiz: 'x'.repeat(260 * 1024) }, seq: liveSeq });
    gleich(r.status, 413, 'ein Online-Stand ueber 256 KB wird abgewiesen');
    r = await tobi.ruf('POST', '/api/live/vielonline/ende');

    console.log('\nOnline-Spiel: kein stilles Ueberschreiben (O1)');
    const standA = { id: 'live5', kind: 'quick', p: [julius_id, tobi_id], legs: [], started: true };
    r = await julius.ruf('POST', '/api/live', { id: 'live5', kind: 'quick', state: standA, players: [tobi_id] });
    gleich(r.status, 201, 'Julius legt ein neues Online-Spiel an');
    const basis5 = r.daten.spiel.seq;

    /* Live-Strom von Tobi schon jetzt oeffnen: er soll alles mitbekommen. */
    const acT = new AbortController();
    const stromT = await fetch(BASIS + '/api/live/live5/strom', { headers: { Cookie: tobi.cookie() }, signal: acT.signal });
    gleich(stromT.status, 200, 'Tobis Live-Strom oeffnet');
    ok(String(stromT.headers.get('content-type')).startsWith('text/event-stream'), 'als Server-Sent Events');
    const leserT = sseLeser(stromT);
    ok(await leserT.bis('event: stand\ndata: {"seq":' + basis5 + ',"status":"offen"}\n\n', 3000),
      'gleich zu Beginn kommt der aktuelle Stand (seq ' + basis5 + ', offen)');

    /* Julius' PUT kommt langsam an (Mobilfunk): der Koerper tropft. In der
       Zwischenzeit schreibt Tobi gegen dieselbe Version -- und ist fertig. */
    const langsam = langsamerPut('/api/live/live5', julius.cookie(),
      { state: Object.assign({}, standA, { legs: [{ visits: [{ p: julius_id, s: 100, d: 3 }] }] }), seq: basis5 });
    await new Promise((res) => setTimeout(res, 150));
    r = await tobi.ruf('PUT', '/api/live/live5', { state: Object.assign({}, standA, { legs: [{ visits: [{ p: tobi_id, s: 45, d: 3 }] }] }), seq: basis5 });
    gleich(r.status, 200, 'Tobi schreibt gegen die Version ' + basis5 + ' und ist zuerst fertig');
    const seqTobi = r.daten.spiel.seq;
    ok(await leserT.bis('event: stand\ndata: {"seq":' + seqTobi + ',"status":"offen"}\n\n', 3000),
      'der Live-Strom meldet die neue Version sofort');
    const a5 = await langsam.fertig();
    gleich(a5.status, 409, 'Julius\' langsamer PUT gegen dieselbe alte Version bekommt 409 statt still zu ueberschreiben');
    ok(String(a5.daten.fehler).includes('Tobi'), 'mit dem Namen dessen, der schneller war');
    ok(a5.daten.spiel && a5.daten.spiel.seq === seqTobi && a5.daten.spiel.state.legs[0].visits[0].p === tobi_id,
      'und mit Tobis Stand -- dieselbe Form wie beim bisherigen Konflikt');
    r = await tobi.ruf('GET', '/api/live/live5');
    gleich(r.daten.spiel.state.legs[0].visits[0].s, 45, 'auf dem Server steht Tobis Aufnahme, nichts ist verloren');
    gleich(r.daten.spiel.seq, seqTobi, 'und die Version ist genau einmal gestiegen');

    console.log('\nLive-Strom (O9)');
    ok(await leserT.bis(': ping', 2000), 'der Strom schickt regelmaessig ein Lebenszeichen');
    r = await fetch(BASIS + '/api/live/live5/strom');
    gleich(r.status, 401, 'ohne Anmeldung gibt es keinen Strom');
    r = await fetch(BASIS + '/api/live/live5/strom', { headers: { Cookie: tester.cookie() } });
    gleich(r.status, 403, 'wer nicht mitspielt, bekommt keinen Strom');
    r = await fetch(BASIS + '/api/live/gibtsnicht/strom', { headers: { Cookie: tobi.cookie() } });
    gleich(r.status, 404, 'fuer ein unbekanntes Spiel auch nicht');

    /* Obergrenze: 8 Hoerer je Spiel. Der neunte verdraengt den aeltesten. */
    const weitere = [];
    for (let i = 0; i < 8; i++) {
      const ac = new AbortController();
      const st = await fetch(BASIS + '/api/live/live5/strom', { headers: { Cookie: julius.cookie() }, signal: ac.signal });
      weitere.push({ ac, leser: sseLeser(st), status: st.status });
    }
    ok(weitere.every((w) => w.status === 200), 'acht weitere Hoerer duerfen sich verbinden');
    ok(await leserT.bisZu(3000), 'der aelteste (Tobis erster) wird dabei sauber geschlossen');

    const standEnde = Object.assign({}, standA, { done: true, winner: tobi_id, legs: [{ visits: [{ p: tobi_id, s: 45, d: 3 }] }] });
    r = await tobi.ruf('POST', '/api/live/live5/ende', { state: standEnde });
    gleich(r.status, 200, 'Tobi beendet das Spiel mit Schlussstand');
    const seqEnde = r.daten.spiel.seq;
    ok(await weitere[7].leser.bis('event: stand\ndata: {"seq":' + seqEnde + ',"status":"zu"}\n\n', 3000),
      'alle Hoerer erfahren vom Ende (status zu)');
    r = await julius.ruf('POST', '/api/live/live5/ende', { state: Object.assign({}, standA, { done: true, winner: julius_id }) });
    gleich(r.status, 200, 'ein zweites Ende (Julius war langsamer) ist kein Fehler');
    gleich(r.daten.spiel.state.winner, tobi_id, 'ueberschreibt aber Tobis Schlussstand nicht');
    gleich(r.daten.spiel.seq, seqEnde, 'und die Version bleibt stehen');
    for (const w of weitere) w.ac.abort();
    acT.abort();

    /* Ende mit Version: der Schlussstand darf eine juengere Eingabe des
       anderen nicht ueberschreiben (Undo des Checkouts kurz vor "Speichern"). */
    r = await julius.ruf('POST', '/api/live', { id: 'live7', kind: 'quick', state: Object.assign({}, standA, { id: 'live7' }), players: [tobi_id] });
    const basis7 = r.daten.spiel.seq;
    r = await tobi.ruf('PUT', '/api/live/live7', { state: Object.assign({}, standA, { id: 'live7', undo: true }), seq: basis7 });
    gleich(r.status, 200, 'Tobi nimmt etwas zurueck (neue Version)');
    const seq7 = r.daten.spiel.seq;
    r = await julius.ruf('POST', '/api/live/live7/ende', { state: Object.assign({}, standA, { id: 'live7', done: true, winner: julius_id }), seq: basis7 });
    gleich(r.status, 409, 'Julius\' Speichern gegen die alte Version wird abgewiesen');
    ok(r.daten.spiel && r.daten.spiel.seq === seq7 && r.daten.spiel.state.undo === true && r.daten.spiel.status === 'offen',
      'mit Tobis Stand in der gewohnten Konflikt-Form -- das Spiel bleibt offen');
    r = await julius.ruf('POST', '/api/live/live7/ende', { state: Object.assign({}, standA, { id: 'live7', done: true, winner: julius_id }), seq: seq7 });
    gleich(r.status, 200, 'gegen die aktuelle Version klappt das Ende');

    console.log('\nStatische Dateien');
    let res = await fetch(BASIS + '/');
    gleich(res.status, 200, 'die App-Seite wird ausgeliefert');
    res = await fetch(BASIS + '/js/app.js');
    gleich(res.status, 200, 'das Skript wird ausgeliefert');
    res = await fetch(BASIS + '/server/main.mjs');
    ok(res.status === 404, 'der Server-Code wird NICHT ausgeliefert');
    res = await fetch(BASIS + '/../package.json');
    ok(res.status === 404 || res.status === 400, 'Ausbruch aus dem Verzeichnis geht nicht');

    console.log('\nSicherheits-Header (S-M3)');
    res = await fetch(BASIS + '/');
    {
      const csp = String(res.headers.get('content-security-policy'));
      ok(/script-src 'self';/.test(csp), 'die App-Seite erlaubt nur eigene Skripte, keine Inline-Skripte');
      ok(csp.includes("frame-ancestors 'none'") && csp.includes("default-src 'self'"), 'und laesst sich nicht in fremde Seiten einbetten');
      gleich(res.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options steht auf DENY');
      gleich(res.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options steht auf nosniff');
      gleich(res.headers.get('referrer-policy'), 'same-origin', 'Referrer-Policy steht auf same-origin');
    }
    res = await fetch(BASIS + '/api/ping');
    ok(String(res.headers.get('content-security-policy')).includes("default-src 'self'"), 'auch API-Antworten tragen die Header');
    res = await fetch(BASIS + '/dart-turnier.html');
    if (res.status === 200) {
      ok(/script-src 'self' 'unsafe-inline'/.test(String(res.headers.get('content-security-policy'))),
        'das Einzeldatei-Buendel darf sein eingebettetes Skript ausfuehren');
    }
    const html = await (await fetch(BASIS + '/')).text();
    ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html enthaelt kein Inline-Skript, das die CSP blockieren wuerde');
    ok(!/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'und keine Inline-Event-Handler');

    console.log('\nKamera-Relay nur mit Schalter (S-N1)');
    {
      const PORT2 = PORT + 50;
      const basis2 = 'http://127.0.0.1:' + PORT2;
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-test2-'));
      const proc2 = spawn(process.execPath, [path.join(ROOT, 'server', 'main.mjs')], {
        env: { ...process.env, PORT: String(PORT2), HOST: '127.0.0.1', DARTS_DB: path.join(tmp2, 't.db'),
          DARTS_INVITE_HASH: hashPassword(CODE), DARTS_KAMERA: '', NODE_ENV: 'test' },
        stdio: ['ignore', 'ignore', 'ignore']
      });
      try {
        await warteAufServer(proc2, basis2);
        const a = await fetch(basis2 + '/api/kamera/raum', {
          method: 'POST', headers: { 'X-Darts-App': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'TESTQ2', token: 'testtoken12345678' })
        });
        gleich(a.status, 404, 'ohne DARTS_KAMERA=1 gibt es keinen Kamera-Raum');
        const b = await fetch(basis2 + '/api/kamera/raum/TESTQ2/strom?rolle=tisch');
        gleich(b.status, 404, 'und keinen Kamera-Strom');
      } finally {
        proc2.kill('SIGTERM');
        await new Promise((r2) => setTimeout(r2, 300));
        if (proc2.exitCode === null) proc2.kill('SIGKILL');
        try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) { /* egal */ }
      }
    }
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (proc.exitCode === null) proc.kill('SIGKILL');
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* Wegwerf-Verzeichnis, egal */
    }
  }

  console.log('\n' + (fehler ? fehler + ' von ' + geprueft + ' Pruefungen FEHLGESCHLAGEN' : 'Alle ' + geprueft + ' Pruefungen bestanden'));
  process.exit(fehler ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
