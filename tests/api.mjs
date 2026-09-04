/*
 * Backend-Test: startet den Server gegen eine Wegwerf-Datenbank und prueft
 * Registrierung, Login, Rechte und den Spiel-Austausch zwischen zwei Konten.
 *
 * Aufruf: npm run test:api
 *
 * Kein Browser noetig -- das hier prueft die API, nicht die Oberflaeche.
 */
import { spawn } from 'node:child_process';
import { hashPassword } from '../server/lib/password.mjs';
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
      return { status: res.status, daten };
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
    }
  };
}

async function warteAufServer(proc) {
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('Server ist beim Start abgestuerzt.');
    try {
      const res = await fetch(BASIS + '/api/ping');
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
      payload: { egal: true },
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
    ok(String(r.daten.fehler).includes('Julius'), 'und erfaehrt, wer sie hat');

    r = await julius.ruf('POST', '/api/tournaments/turnier1/matches/m1r1/claim');
    gleich(r.status, 200, 'derselbe darf nochmal -- das ist bloss ein Neuladen');

    r = await tobi.ruf('POST', '/api/tournaments/turnier1/matches/m2r1/claim');
    gleich(r.status, 200, 'die zweite Partie nimmt Tobi');
    const beideDa = r.daten.turnier.partien;
    gleich(beideDa.length, 2, 'beide Partien sind vergeben');

    r = await tobi.ruf('PUT', '/api/tournaments/turnier1/matches/m1r1', {
      result: { winner: tobi_id, legs: [] }
    });
    gleich(r.status, 409, 'ein fremdes Ergebnis wird nicht angenommen');

    r = await julius.ruf('PUT', '/api/tournaments/turnier1/matches/m1r1', {
      result: { id: 'm1r1', winner: julius_id, legs: [{ winner: julius_id, visits: [] }], done: true }
    });
    gleich(r.status, 200, 'sein eigenes schon');

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

    r = await julius.ruf('POST', '/api/tournaments/turnier1/ende');
    gleich(r.daten.turnier.status, 'beendet', 'das Turnier laesst sich beenden');
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

    console.log('\nVereinskasse');
    r = await fremd.ruf('GET', '/api/kasse');
    gleich(r.status, 401, 'ohne Anmeldung bleibt die Kasse zu');
    r = await julius.ruf('GET', '/api/kasse');
    gleich(r.daten.saldo, 0, 'die Kasse beginnt bei null');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 5000, text: 'Startgeld Julius' });
    gleich(r.status, 200, 'Julius zahlt 50 Euro ein');
    gleich(r.daten.saldo, 5000, 'der Bestand rechnet mit');
    r = await tobi.ruf('POST', '/api/kasse', { betrag: -1250, text: 'Neue Flights' });
    gleich(r.daten.saldo, 3750, 'Tobis Ausgabe zieht ab');
    const kasseEintrag = r.daten.eintraege[0];
    ok(kasseEintrag.meins === true && kasseEintrag.betrag === -1250, 'die eigene Buchung ist als meins markiert');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 0, text: 'nix' });
    gleich(r.status, 400, 'null Euro sind keine Buchung');
    r = await julius.ruf('POST', '/api/kasse', { betrag: 100 });
    gleich(r.status, 400, 'ohne Text keine Buchung');
    r = await julius.ruf('DELETE', '/api/kasse/' + kasseEintrag.id);
    gleich(r.status, 403, 'fremde Buchungen loescht niemand');
    r = await tobi.ruf('DELETE', '/api/kasse/' + kasseEintrag.id);
    gleich(r.status, 200, 'die eigene schon');
    gleich(r.daten.saldo, 5000, 'der Bestand stimmt danach wieder');

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
            if (erg.done) break;
            puffer += dec.decode(erg.value, { stream: true });
          }
          return puffer.includes(muster);
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

    console.log('\nStatische Dateien');
    let res = await fetch(BASIS + '/');
    gleich(res.status, 200, 'die App-Seite wird ausgeliefert');
    res = await fetch(BASIS + '/js/app.js');
    gleich(res.status, 200, 'das Skript wird ausgeliefert');
    res = await fetch(BASIS + '/server/main.mjs');
    ok(res.status === 404, 'der Server-Code wird NICHT ausgeliefert');
    res = await fetch(BASIS + '/../package.json');
    ok(res.status === 404 || res.status === 400, 'Ausbruch aus dem Verzeichnis geht nicht');
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
