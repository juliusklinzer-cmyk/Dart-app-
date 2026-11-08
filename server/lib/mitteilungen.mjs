/*
 * Die Mitteilungszentrale: jedes Thema geht je Konto als Push und Mail,
 * nur Push oder gar nicht raus (Tabelle benachrichtigungen, ohne Zeile
 * gilt die Voreinstellung des Themas). mitteilung_log sorgt dafuer, dass
 * jede Mitteilung je Konto nur einmal rausgeht - gleich, von welchem
 * Geraet oder Lauf sie ausgeloest wurde.
 *
 * Anlaesse:
 *  - Jobs (main.mjs, alle 30 Minuten): Zusage fehlt (7 und 2 Tage vor dem
 *    Spieltag), DiensDarts-Umfrage fehlt (3 Tage vor dem Training), Spieltag
 *    morgen (an die Zugesagten), Tabelle nach einem kompletten Spieltag.
 *  - Ereignisse aus der App (POST /api/mitteilungen/ereignis): unser
 *    Ergebnis, Anpfiff (Live), neuer Rekord, Spielbericht noch offen.
 *  - Aus der API: Kasse (Buchung aufs eigene Konto), Konto (Passwort,
 *    Anmeldung nach langer Pause), neues Mitglied.
 *
 * Die Jobs rechnen in Berliner Zeit (der Container laeuft in UTC) und nur
 * zwischen 9 und 21 Uhr - nachts bleibt das Telefon still. Die Schluessel
 * der Terminjobs tragen das Datum (zusage:<id>:<tag>:<stufe>,
 * morgen:<id>:<tag>, tabelle:<id>:<gewertete Spiele>), damit ein verlegter
 * Spieltag und ein Nachholspiel neu gemeldet werden.
 */
import crypto from 'node:crypto';

export const THEMEN = [
  { id: 'zusage', titel: 'Zusage zum Spieltag fehlt', text: '7 und 2 Tage vor dem Ligaspiel, solange du nicht abgestimmt hast', standard: 'beide', von: 'liga' },
  { id: 'training', titel: 'DiensDarts-Umfrage fehlt', text: '3 Tage vor dem Training, solange du nicht geantwortet hast', standard: 'beide', von: 'liga' },
  { id: 'spieltag-morgen', titel: 'Spieltag morgen', text: 'am Tag davor an alle Zugesagten: Lokal, Uhrzeit, wer dabei ist', standard: 'push', von: 'liga' },
  { id: 'ergebnis', titel: 'Unser Ligaergebnis', text: 'sobald das Ligaspiel abgeschlossen ist: Endstand, alle Einzel, Man of the Day', standard: 'beide', von: 'liga' },
  { id: 'tabelle', titel: 'Tabelle und Ergebnisse der Liga', text: 'nach jedem Spieltag, sobald die Ligaleitung alle Spiele hat', standard: 'push', von: 'liga' },
  { id: 'rekord', titel: 'Neuer Rekord', text: 'höchstes Finish, höchste Aufnahme oder kürzestes Leg im Team', standard: 'push', von: 'liga' },
  { id: 'live', titel: 'Live: unser Spiel läuft', text: 'Anpfiff mit Link zum Ticker', standard: 'push', von: 'liga' },
  { id: 'kasse', titel: 'Kasse', text: 'Buchung auf dein Konto', standard: 'push', von: 'app' },
  { id: 'bericht-offen', titel: 'Spielbericht noch nicht verschickt', text: 'nur an dich, wenn du ohne Senden abgeschlossen hast', standard: 'push', von: 'liga' },
  { id: 'konto', titel: 'Konto und Sicherheit', text: 'Passwort geändert, Anmeldung nach langer Pause – immer per Mail', standard: 'mail', von: 'app', fest: true },
  { id: 'mitglied', titel: 'Neues Mitglied', text: 'jemand hat die Einladung angenommen', standard: 'aus', von: 'app' }
];
export const KANAELE = ['beide', 'push', 'aus'];
const THEMA = {};
THEMEN.forEach(function (t) { THEMA[t.id] = t; });
/* Beschriftung des Knopfs in der HTML-Mail je Thema (Ziel: push.url, sonst die App). */
const KNOPF = {
  zusage: 'Jetzt abstimmen', training: 'Zur Umfrage', 'spieltag-morgen': 'Zum Spieltag', ergebnis: 'Spielbericht und Statistik',
  tabelle: 'Zur Tabelle', rekord: 'Alle Rekorde', live: 'Zum Live-Ticker', kasse: 'Zum Kassenbuch', 'bericht-offen': 'Spielbericht senden',
  konto: 'Zur Dart-App', mitglied: 'Zur Dart-App'
};

const WT = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
function datumDe(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return WT[d.getUTCDay()] + ' ' + iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
}
function isoPlus(iso, tage) {
  return new Date(Date.parse(iso + 'T12:00:00Z') + tage * 86400e3).toISOString().slice(0, 10);
}
function tageBis(heute, tag) {
  return Math.round((Date.parse(tag + 'T12:00:00Z') - Date.parse(heute + 'T12:00:00Z')) / 86400e3);
}
/* Trainingstermin-Kennung wie in js/app.js (trainingsTerminId): 'tr' + JJJJMMTT. */
function trainingsId(iso) { return 'tr' + iso.replace(/-/g, ''); }

/* Tag (JJJJ-MM-TT) und Stunde in Berliner Zeit. Der Container kennt nur UTC,
   und der UTC-Tag wechselt um 1 Uhr (Winter) bzw. 2 Uhr (Sommer) nachts -
   mit toISOString() liefen die Tagesjobs genau dann. */
export function berlinZeit(d) {
  const teile = {};
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d || new Date()).forEach(function (p) { teile[p.type] = p.value; });
  return { tag: teile.year + '-' + teile.month + '-' + teile.day, stunde: Number(teile.hour) };
}
/* Tagesjobs nur tagsueber: ab 9 Uhr, letzter Lauf vor 21 Uhr. */
export const JOB_FENSTER = { von: 9, bis: 21 };

/* Kurzer Hash fuer die Push-Kennung (tag/Topic): gleiche Mitteilung an
   dasselbe Geraet ersetzt sich, zwei verschiedene bleiben beide stehen.
   base64url passt zu Topic (RFC 8030: max. 32 Zeichen aus A-Z a-z 0-9 - _). */
function kurzHash(s) { return crypto.createHash('sha1').update(String(s)).digest('base64url').slice(0, 8); }

export function erstelleMitteilungen(opt) {
  const db = opt.db;
  const mailer = opt.mailer || { bereit: false };
  const push = opt.push || { bereit: false };
  const liga = opt.liga || null;
  const appUrl = opt.appUrl || 'https://darts.wirtschaftln.de';
  const team = (liga && liga.liga && liga.liga.team) || 'Blink 180';
  const soll = (liga && liga.liga && liga.liga.sollSpieler) || 4;

  const qKanal = db.prepare('SELECT kanal FROM benachrichtigungen WHERE user_id = ? AND thema = ?');
  const qAlle = db.prepare('SELECT thema, kanal FROM benachrichtigungen WHERE user_id = ?');
  const qSetze = db.prepare('INSERT INTO benachrichtigungen (user_id, thema, kanal) VALUES (?, ?, ?) ON CONFLICT (user_id, thema) DO UPDATE SET kanal = excluded.kanal');
  const qAbos = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_abos WHERE user_id = ?');
  const qAboWeg = db.prepare('DELETE FROM push_abos WHERE id = ?');
  const qAboOk = db.prepare('UPDATE push_abos SET last_ok_at = ? WHERE id = ?');
  const qSchon = db.prepare('SELECT 1 FROM mitteilung_log WHERE schluessel = ? AND user_id = ?');
  const qLogge = db.prepare('INSERT OR IGNORE INTO mitteilung_log (schluessel, user_id, sent_at) VALUES (?, ?, ?)');
  const qLogWeg = db.prepare('DELETE FROM mitteilung_log WHERE schluessel = ? AND user_id = ?');
  const qMitglieder = db.prepare("SELECT id, email, display_name, gast_konto FROM users WHERE status = 'aktiv' AND test = 0 ORDER BY created_at");
  const qZusage = db.prepare('SELECT status FROM liga_zusagen WHERE termin_id = ? AND user_id = ?');
  const qZugesagt = db.prepare("SELECT u.id, u.email, u.display_name FROM liga_zusagen z JOIN users u ON u.id = z.user_id WHERE z.termin_id = ? AND (z.status IS NULL OR z.status = 'dabei') AND u.test = 0 AND u.status = 'aktiv' ORDER BY z.created_at");

  function kanalVon(userId, themaId) {
    const t = THEMA[themaId];
    if (!t) return 'aus';
    if (t.fest) return t.standard;
    const z = qKanal.get(userId, themaId);
    return z && KANAELE.indexOf(z.kanal) >= 0 ? z.kanal : t.standard;
  }
  function einstellungen(userId) {
    const aus = {};
    THEMEN.forEach(function (t) { aus[t.id] = t.standard; });
    qAlle.all(userId).forEach(function (z) { if (THEMA[z.thema] && !THEMA[z.thema].fest && KANAELE.indexOf(z.kanal) >= 0) aus[z.thema] = z.kanal; });
    return aus;
  }
  function setze(userId, themaId, kanal) {
    const t = THEMA[themaId];
    if (!t || t.fest) throw new Error('Dieses Thema lässt sich nicht umstellen.');
    if (KANAELE.indexOf(kanal) < 0) throw new Error('Unbekannter Kanal.');
    qSetze.run(userId, themaId, kanal);
  }

  /*
   * Eine Mitteilung an ein Konto. inhalt: { betreff, text, push: { titel,
   * text, url }, anhaenge }. schluessel: einmalig je Konto (null = immer).
   * erzwinge: alle Kanaele unabhaengig von der Einstellung (Testversand).
   * alt: fruehere Schreibweisen desselben Schluessels (siehe anAlle).
   * Liefert true, wenn mindestens ein Weg geklappt hat.
   *
   * Der Schluessel wird VOR dem Versand im Log reserviert (INSERT OR
   * IGNORE; changes 0 = ein anderer Aufruf war schneller). Erst pruefen und
   * nach dem Versand loggen liess zwei iPads, die binnen Sekunden dasselbe
   * Ergebnis melden, jede Mitteilung doppelt schicken - der erste Versand
   * dauert mit einer SMTP-Verbindung je Mail laenger als der Abstand der
   * Anfragen. Klappt kein Weg, kommt die Zeile wieder weg, damit der
   * naechste Lauf es noch einmal versuchen kann.
   */
  async function anKonto(u, themaId, inhalt, schluessel, erzwinge, alt) {
    const t = THEMA[themaId];
    if (!t || !u || !u.email) return false;
    const k = erzwinge ? 'beide' : kanalVon(u.id, themaId);
    if (k === 'aus') return false;
    if (schluessel) {
      if (alt && alt.some(function (a) { return qSchon.get(a, u.id); })) return false;
      if (qLogge.run(schluessel, u.id, new Date().toISOString()).changes === 0) return false;
    }
    /* Push-Kennung: Thema plus Hash des Schluessels - nur das Thema liess
       zwei Kassenbuchungen kurz nacheinander zu einer zusammenfallen. Ohne
       Schluessel (Kasse, Konto) ist jede Mitteilung eine eigene. */
    const tag = themaId + '-' + kurzHash(schluessel || (Date.now().toString(36) + Math.random()));
    let ok = false;
    if ((k === 'beide' || k === 'mail') && mailer.bereit && inhalt.betreff) {
      try {
        await mailer.sende({
          von: t.von, an: [u.email], betreff: inhalt.betreff, text: inhalt.text, anhaenge: inhalt.anhaenge,
          titel: String(inhalt.betreff).replace(/^\[Test\]\s*/, ''), kicker: (erzwinge ? 'Beispiel · ' : '') + t.titel,
          knopf: { text: KNOPF[themaId] || 'Zur Dart-App', url: (inhalt.push && inhalt.push.url) || appUrl },
          vorschau: inhalt.push ? inhalt.push.text : '',
          mitteilung: true
        });
        ok = true;
      } catch (e) {
        console.error('[mitteilung] Mail "' + themaId + '" an ' + u.email + ' fehlgeschlagen: ' + (e && e.message));
      }
    }
    if ((k === 'beide' || k === 'push') && push.bereit && inhalt.push) {
      for (const abo of qAbos.all(u.id)) {
        try {
          const r = await push.sende({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } },
            { titel: inhalt.push.titel, text: inhalt.push.text, url: inhalt.push.url || appUrl, tag: tag });
          if (r.weg) qAboWeg.run(abo.id);
          else if (r.ok) { ok = true; qAboOk.run(new Date().toISOString(), abo.id); }
          else console.error('[mitteilung] Push "' + themaId + '" an ' + u.display_name + ': ' + (r.status || '') + ' ' + (r.grund || ''));
        } catch (e) {
          console.error('[mitteilung] Push "' + themaId + '" an ' + u.display_name + ' fehlgeschlagen: ' + (e && e.message));
        }
      }
    }
    if (schluessel && !ok) qLogWeg.run(schluessel, u.id);
    return ok;
  }

  /* An alle Mitglieder (ohne Test-Konten; Gast-Konten nur mit
     filter.mitGaesten). filter.nur(u) waehlt aus, filter.ohne laesst ein
     Konto aus, filter.inhaltJe(u) baut den Text je Empfaenger.
     filter.alt: Schluessel aus der Zeit vor dem Datum im Schluessel
     (Nov. 2026: zusage:<id>:<stufe>, morgen:<id>, tabelle:<id>) - ein
     Spieltag, an den unter dem alten Namen schon erinnert wurde, kommt
     nach dem Update nicht noch einmal. Kann nach der Saison 2026/27 weg. */
  async function anAlle(themaId, inhalt, schluessel, filter) {
    let n = 0;
    filter = filter || {};
    for (const u of qMitglieder.all()) {
      if (u.gast_konto && !filter.mitGaesten) continue;
      if (filter.ohne && filter.ohne === u.id) continue;
      if (filter.nur && !filter.nur(u)) continue;
      if (await anKonto(u, themaId, filter.inhaltJe ? filter.inhaltJe(u) : inhalt, schluessel, false, filter.alt)) n++;
    }
    return n;
  }

  /* ---------- Jobs ---------- */

  function termine() { return liga && liga.liga && Array.isArray(liga.liga.termine) ? liga.liga.termine : []; }
  function terminText(t) {
    const daheim = t.heim === team;
    return { daheim, gegner: daheim ? t.gast : t.heim, datum: datumDe(t.tag), wo: (daheim ? 'Heim' : 'Auswärts') + (t.ort ? ', ' + t.ort : '') };
  }

  /* Zusage fehlt: 4 bis 7 Tage vorher (Stufe 7) und 1 bis 2 Tage vorher
     (Stufe 2). Fenster statt eines festen Tages, damit ein Tag Serverpause
     nichts verschluckt; der Schluessel haelt jede Stufe auf einmal. Die
     Stufe 2 beginnt erst bei 2 Tagen - mit 3 kam "2 Tage vorher" am
     dritten Tag. Verschobene Spieltage (t.verschoben aus js/liga-daten.js,
     t.tag ist dann noch das alte Datum) bleiben aussen vor; steht das neue
     Datum, erinnert der Schluessel mit Datum erneut. */
  async function zusageErinnerung(heute) {
    let n = 0;
    for (const t of termine()) {
      if (!t.tag || !t.gast || t.verschoben) continue;
      const tage = tageBis(heute, t.tag);
      const stufe = tage >= 4 && tage <= 7 ? '7' : tage >= 1 && tage <= 2 ? '2' : null;
      if (!stufe) continue;
      const x = terminText(t);
      const dabei = qZugesagt.all(t.id).length;
      const inhalt = (u) => ({
        betreff: t.nr + '. Spieltag am ' + x.datum + ' gegen ' + x.gegner + ' – bist du dabei?',
        text: 'Hallo ' + u.display_name + ',\n\n' +
          'am ' + x.datum + ' spielt ' + team + ' gegen ' + x.gegner + ' (' + x.wo + ', 20:00 Uhr) – das ist in ' + (tage === 1 ? 'einem Tag' : tage + ' Tagen') + '. ' +
          'Du hast noch nicht abgestimmt, ob du dabei bist.\n\n' +
          'Bitte sag kurz Bescheid: ' + appUrl + ' → Liga → ' + t.nr + '. Spieltag → „Ich bin dabei“.\n\n' +
          'Bisher dabei: ' + dabei + ' von ' + soll + '.\n\n' +
          'Wenn du nicht kannst, brauchst du nichts zu tun. Diese Erinnerung kommt höchstens zweimal je Spieltag; einstellen kannst du das in der App unter Profil → Konto → Benachrichtigungen.\n\n' +
          'Viele Grüße\n' + team,
        push: { titel: 'Bist du dabei? ' + t.nr + '. Spieltag gegen ' + x.gegner, text: x.datum + ' · ' + x.wo + ' · bisher ' + dabei + ' von ' + soll + ' dabei', url: appUrl }
      });
      n += await anAlle('zusage', null, 'zusage:' + t.id + ':' + t.tag + ':' + stufe, { nur: (u) => !qZusage.get(t.id, u.id), inhaltJe: inhalt, alt: ['zusage:' + t.id + ':' + stufe] });
    }
    return n;
  }

  /* DiensDarts: 3 Tage vor dem Dienstag (also am Samstag) an alle, die
     die Umfrage noch nicht beantwortet haben - Gast-Konten trainieren mit.
     Faellt auf den Dienstag ein Ligaspiel, gibt es kein Training und keine
     Umfrage - dann kommt auch keine Erinnerung. */
  async function trainingErinnerung(heute) {
    const d = new Date(heute + 'T12:00:00Z');
    const bisDienstag = (2 - d.getUTCDay() + 7) % 7;
    if (bisDienstag !== 3) return 0;
    const tag = isoPlus(heute, 3);
    if (termine().some((t) => t.tag === tag && t.gast && !t.verschoben)) return 0;
    const tid = trainingsId(tag);
    const inhalt = (u) => ({
      betreff: 'DiensDarts am ' + datumDe(tag) + ' – kommst du?',
      text: 'Hallo ' + u.display_name + ',\n\n' +
        'am ' + datumDe(tag) + ' ist wieder DiensDarts in der Bar Sehnsucht. Du hast in der Umfrage noch nicht geantwortet.\n\n' +
        'Bitte kurz antippen: ' + appUrl + ' → Liga → Training → „Bin dabei“, „Unsicher“ oder „Kann nicht“.\n\n' +
        'Viele Grüße\n' + team,
      push: { titel: 'DiensDarts am Dienstag – kommst du?', text: 'Noch keine Antwort in der Umfrage. Bin dabei, Unsicher oder Kann nicht?', url: appUrl }
    });
    return anAlle('training', null, 'training:' + tid, { mitGaesten: true, nur: (u) => !qZusage.get(tid, u.id), inhaltJe: inhalt });
  }

  /* Spieltag morgen: an alle, die zugesagt haben. */
  async function spieltagMorgen(heute) {
    let n = 0;
    for (const t of termine()) {
      if (!t.tag || !t.gast || t.verschoben || tageBis(heute, t.tag) !== 1) continue;
      const x = terminText(t);
      const zu = qZugesagt.all(t.id);
      const namen = zu.map((u) => u.display_name).join(', ') || 'noch niemand';
      for (const u of zu) {
        const inhalt = {
          betreff: 'Morgen ' + t.nr + '. Spieltag gegen ' + x.gegner,
          text: 'Hallo ' + u.display_name + ',\n\nmorgen, ' + x.datum + ', spielt ' + team + ' gegen ' + x.gegner + ' – ' + x.wo + ', 20:00 Uhr.\n\n' +
            'Dabei (' + zu.length + '): ' + namen + '.\n\nViele Grüße\n' + team,
          push: { titel: 'Morgen: ' + t.nr + '. Spieltag gegen ' + x.gegner, text: x.wo + ' · 20:00 Uhr · dabei: ' + namen, url: appUrl }
        };
        if (await anKonto(u, 'spieltag-morgen', inhalt, 'morgen:' + t.id + ':' + t.tag, false, ['morgen:' + t.id])) n++;
      }
    }
    return n;
  }

  /* Tabelle nach einem Spieltag der Ligaleitung, sobald jedes Spiel ein
     Ergebnis hat oder verschoben ist, nur fuer Spieltage der letzten zehn
     Tage - sonst kaeme beim ersten Lauf die ganze Vergangenheit. Der
     Schluessel zaehlt die gewerteten Spiele mit: ein Nachholspiel macht
     aus 3 von 4 wieder 4 von 4 und loest so eine zweite Meldung aus. */
  async function tabelleNeu(heute) {
    if (!liga || !liga.spieltage || !liga.tabelleAus) return 0;
    let n = 0;
    for (const t of termine()) {
      const runde = liga.spieltage[t.id];
      if (!runde) continue;
      const spiele = runde.filter((s) => s.gast);
      if (!spiele.length || !spiele.every((s) => s.einzel || s.verschoben)) continue;
      const gespielt = spiele.filter((s) => s.einzel);
      if (!gespielt.length) continue;
      const offen = spiele.length - gespielt.length;
      const letzter = gespielt.map((s) => s.tag || '').sort().pop();
      if (!letzter || tageBis(letzter, heute) < 0 || tageBis(letzter, heute) > 10) continue;
      const tab = liga.tabelleAus(liga.spieltage, liga.teams).zeilen;
      const platz = tab.findIndex((z) => z.team === team) + 1;
      /* z.einzel ist das Einzelverhaeltnis (z. B. 22:10), z.spiele die Zahl der Spiele. */
      const zeilen = tab.map((z, i) => (i + 1) + '. ' + z.team + '  ' + z.punkte + ' Pkt (' + z.spiele + ' Spiele, Einzel ' + z.einzel + ', Legs ' + z.legs + ')').join('\n');
      const unser = gespielt.find((s) => s.heim === team || s.gast === team);
      const ergebnisse = gespielt.map((s) => s.heim + ' – ' + s.gast + '  ' + s.einzel + (s.legs ? ' (' + s.legs + ' Legs)' : '')).join('\n');
      const stand = offen ? 'ist gewertet – ' + (offen === 1 ? 'ein Spiel ist' : offen + ' Spiele sind') + ' verschoben' : 'ist komplett gewertet';
      const inhalt = {
        betreff: 'Tabelle nach dem ' + t.nr + '. Spieltag – ' + team + ' auf Platz ' + platz,
        text: 'Hallo zusammen,\n\nder ' + t.nr + '. Spieltag ' + stand + '.\n\nErgebnisse:\n' + ergebnisse + '\n\nTabelle:\n' + zeilen +
          '\n\nAlles im Detail: ' + appUrl + ' → Liga → Tabelle.\n\nViele Grüße\n' + team,
        push: { titel: team + ' auf Platz ' + platz + ' nach dem ' + t.nr + '. Spieltag', text: (unser ? unser.heim + ' – ' + unser.gast + ' ' + unser.einzel + ' · ' : '') + 'Tabelle und Einzelrangliste in der App', url: appUrl }
      };
      n += await anAlle('tabelle', inhalt, 'tabelle:' + t.id + ':' + gespielt.length, { alt: ['tabelle:' + t.id] });
    }
    return n;
  }

  /* Alle Tagesjobs. jetzt: ein Date (die echte Uhr, Vorgabe) - dann gilt
     Berliner Datum und das Fenster 9 bis 21 Uhr, nachts passiert nichts.
     Ein Tag als 'JJJJ-MM-TT' (Tests, Skripte) steht fuer "genau dieser
     Tag", ohne Uhrzeit und ohne Fenster. */
  async function jobs(jetzt) {
    let heute;
    if (typeof jetzt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(jetzt)) {
      heute = jetzt;
    } else {
      const b = berlinZeit(jetzt instanceof Date ? jetzt : new Date());
      if (b.stunde < JOB_FENSTER.von || b.stunde >= JOB_FENSTER.bis) return 0;
      heute = b.tag;
    }
    let n = 0;
    for (const job of [zusageErinnerung, trainingErinnerung, spieltagMorgen, tabelleNeu]) {
      try { n += await job(heute); } catch (e) { console.error('[mitteilung] Job ' + job.name + ' fehlgeschlagen:', e); }
    }
    return n;
  }

  /* ---------- Ereignisse aus der App ---------- */

  const s = (v, max) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 80);
  const z = (v) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) ? Math.max(0, Math.min(999, x)) : 0; };

  async function ereignis(u, art, d) {
    d = d && typeof d === 'object' ? d : {};
    const termin = /^[a-z0-9-]{2,40}$/.test(String(d.termin || '')) ? String(d.termin) : '';
    const nr = z(d.nr), gegner = s(d.gegner, 60) || 'den Gegner';
    const wo = (d.heim ? 'Heim' : 'Auswärts') + (s(d.ort, 60) ? ', ' + s(d.ort, 60) : '');
    if (art === 'ergebnis') {
      if (!termin) throw new Error('Ohne Spieltag kein Ergebnis.');
      const wirP = z(d.wirP), sieP = z(d.sieP);
      const stand = team + ' ' + wirP + ' : ' + sieP + ' ' + gegner;
      const wie = wirP > sieP ? 'Sieg' : wirP < sieP ? 'Niederlage' : 'Unentschieden';
      const einzel = Array.isArray(d.einzel) ? d.einzel.slice(0, 16).map((e) => s(e && e.h, 40) + ' – ' + s(e && e.g, 40) + '  ' + s(e && e.score, 12)).join('\n') : '';
      const hl = Array.isArray(d.hl) ? d.hl.slice(0, 6).map((x) => s(x, 160)).filter(Boolean).join('\n') : '';
      const inhalt = {
        betreff: wie + ' am ' + nr + '. Spieltag: ' + stand,
        text: 'Hallo zusammen,\n\n' + stand + ' (' + wo + ')' + (nr ? ', ' + nr + '. Spieltag' : '') + '.\n' +
          'Einzel ' + z(d.wirS) + ' : ' + z(d.sieS) + ', Legs ' + z(d.wirL) + ' : ' + z(d.sieL) + '.\n' +
          (s(d.mod, 80) ? 'Man of the Day: ' + s(d.mod, 80) + '\n' : '') +
          (hl ? '\nHighlights:\n' + hl + '\n' : '') +
          (einzel ? '\nAlle Einzel:\n' + einzel + '\n' : '') +
          '\nSpielbericht und Statistik: ' + appUrl + '\n\nViele Grüße\n' + team,
        push: { titel: wie + ': ' + stand, text: 'Einzel ' + z(d.wirS) + ':' + z(d.sieS) + ' · Legs ' + z(d.wirL) + ':' + z(d.sieL) + (s(d.mod, 80) ? ' · MotD ' + s(d.mod, 80) : ''), url: appUrl }
      };
      return anAlle('ergebnis', inhalt, 'ergebnis:' + termin);
    }
    if (art === 'live') {
      if (!termin) throw new Error('Ohne Spieltag kein Anpfiff.');
      const link = /^https:\/\/[^\s"'<>]{1,200}$/.test(String(d.link || '')) ? String(d.link) : appUrl;
      const inhalt = {
        betreff: 'Anpfiff: ' + team + ' gegen ' + gegner + (nr ? ' (' + nr + '. Spieltag)' : ''),
        text: 'Hallo zusammen,\n\ngerade geht es los: ' + team + ' gegen ' + gegner + ' (' + wo + ').\n\nLive mitfiebern: ' + link + '\n\nViele Grüße\n' + team,
        push: { titel: 'Anpfiff: ' + team + ' – ' + gegner, text: wo + ' · zum Live-Ticker', url: link }
      };
      return anAlle('live', inhalt, 'live:' + termin);
    }
    if (art === 'rekord') {
      const was = s(d.art, 40), wert = s(d.wert, 12), name = s(d.name, 40), einheit = s(d.einheit, 12);
      if (!was || !wert || !name) throw new Error('Rekord ohne Inhalt.');
      const zeile = was + ': ' + wert + (einheit ? ' ' + einheit : '') + ' – ' + name;
      const inhalt = {
        betreff: 'Neuer Teamrekord – ' + zeile,
        text: 'Hallo zusammen,\n\nneuer Rekord im Team: ' + zeile + '.\n\nAlle Rekorde: ' + appUrl + ' → Liga → Statistik.\n\nViele Grüße\n' + team,
        push: { titel: 'Neuer Rekord: ' + was, text: wert + (einheit ? ' ' + einheit : '') + ' – ' + name, url: appUrl }
      };
      return anAlle('rekord', inhalt, 'rekord:' + was.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ':' + wert + ':' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    }
    if (art === 'bericht-offen') {
      /* Nur an den Ausloeser - die vollstaendige Zeile mit E-Mail aus der DB. */
      u = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(u.id) || u;
      const inhalt = {
        betreff: 'Spielbericht ' + (nr ? nr + '. Spieltag ' : '') + 'noch nicht verschickt',
        text: 'Hallo ' + u.display_name + ',\n\ndas Ligaspiel gegen ' + gegner + ' ist abgeschlossen, der Spielbericht aber noch nicht verschickt. Bitte an die Ligaleitung schicken: ' + appUrl + ' → Liga → Spieltag → Spielbericht.\n\nViele Grüße\n' + team,
        push: { titel: 'Spielbericht noch nicht verschickt', text: 'Gegen ' + gegner + ' – bitte an die Ligaleitung schicken', url: appUrl }
      };
      return (await anKonto(u, 'bericht-offen', inhalt, termin ? 'bericht-offen:' + termin + ':' + u.id : null)) ? 1 : 0;
    }
    throw new Error('Unbekanntes Ereignis.');
  }

  /* ---------- Aus der API ---------- */

  async function kasseBuchung(mitgliedId, buchung, vonName) {
    const u = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(mitgliedId);
    if (!u) return false;
    const betrag = (buchung.betrag / 100).toFixed(2).replace('.', ',') + ' €';
    return anKonto(u, 'kasse', {
      betreff: 'Kasse: ' + betrag + ' – ' + s(buchung.text, 80),
      text: 'Hallo ' + u.display_name + ',\n\n' + (vonName ? vonName + ' hat' : 'es wurde') + ' auf dein Konto gebucht: ' + betrag + ' – ' + s(buchung.text, 80) + ' (' + s(buchung.kategorie, 40) + ', ' + s(buchung.datum, 10) + ').\n\nKassenbuch: ' + appUrl + ' → Liga → Kasse.\n\nViele Grüße\n' + team,
      push: { titel: 'Kasse: ' + betrag, text: s(buchung.text, 80) + (vonName ? ' · von ' + vonName : ''), url: appUrl }
    }, null);
  }

  async function konto(u, was) {
    const texte = {
      passwort: { betreff: 'Dein Passwort wurde geändert', text: 'Hallo ' + u.display_name + ',\n\ndas Passwort deines Dart-App-Kontos wurde gerade geändert; andere Geräte sind abgemeldet.\n\nWarst du das nicht, antworte sofort auf diese Mail.\n\nDart-App' },
      anmeldung: { betreff: 'Neue Anmeldung in der Dart-App', text: 'Hallo ' + u.display_name + ',\n\ndein Konto wurde gerade nach längerer Pause wieder angemeldet.\n\nWarst du das nicht, ändere dein Passwort in der App (Profil → Konto) und antworte auf diese Mail.\n\nDart-App' }
    };
    const t = texte[was];
    if (!t) return false;
    return anKonto(u, 'konto', { betreff: t.betreff, text: t.text }, null);
  }

  async function neuesMitglied(neu) {
    const inhalt = {
      betreff: 'Neu im Team: ' + s(neu.display_name, 40),
      text: 'Hallo zusammen,\n\n' + s(neu.display_name, 40) + ' hat die Einladung angenommen und ist jetzt in der Dart-App dabei.\n\nViele Grüße\n' + team,
      push: { titel: 'Neu im Team: ' + s(neu.display_name, 40), text: 'hat die Einladung angenommen', url: appUrl }
    };
    return anAlle('mitglied', inhalt, 'mitglied:' + neu.id, { ohne: neu.id });
  }

  /* ---------- Testversand: jedes Thema einmal an ein Konto ---------- */
  async function testAlle(u) {
    const t = termine().find((x) => x.tag && x.gast) || { id: 'st04', nr: 4, tag: '2026-11-10', heim: team, gast: 'd`Haberer 2', ort: 'Bar Sehnsucht' };
    const x = terminText(t);
    const beispiele = [
      ['zusage', { betreff: '[Test] ' + t.nr + '. Spieltag am ' + x.datum + ' gegen ' + x.gegner + ' – bist du dabei?', text: 'Hallo ' + u.display_name + ',\n\nso sieht die Erinnerung aus, wenn du 7 bzw. 2 Tage vor dem Spieltag noch nicht abgestimmt hast.\n\nBisher dabei: 3 von 4.\n\nViele Grüße\n' + team, push: { titel: '[Test] Bist du dabei? ' + t.nr + '. Spieltag gegen ' + x.gegner, text: x.datum + ' · ' + x.wo + ' · bisher 3 von 4 dabei', url: appUrl } }],
      ['training', { betreff: '[Test] DiensDarts am Dienstag – kommst du?', text: 'Hallo ' + u.display_name + ',\n\nso sieht die Erinnerung aus, wenn du am Samstag die Umfrage fürs Training noch nicht beantwortet hast.\n\nViele Grüße\n' + team, push: { titel: '[Test] DiensDarts am Dienstag – kommst du?', text: 'Noch keine Antwort in der Umfrage', url: appUrl } }],
      ['spieltag-morgen', { betreff: '[Test] Morgen ' + t.nr + '. Spieltag gegen ' + x.gegner, text: 'Hallo ' + u.display_name + ',\n\nmorgen, ' + x.datum + ', spielt ' + team + ' gegen ' + x.gegner + ' – ' + x.wo + ', 20:00 Uhr.\n\nDabei (4): Lenas, Tobi, Domi, Julius.\n\nViele Grüße\n' + team, push: { titel: '[Test] Morgen: ' + t.nr + '. Spieltag gegen ' + x.gegner, text: x.wo + ' · 20:00 Uhr · dabei: Lenas, Tobi, Domi, Julius', url: appUrl } }],
      ['ergebnis', { betreff: '[Test] Sieg am 3. Spieltag: ' + team + ' 9 : 7 Voodoo Darters', text: 'Hallo zusammen,\n\n' + team + ' 9 : 7 Voodoo Darters (Auswärts, Heuboden), 3. Spieltag.\nEinzel 9 : 7, Legs 22 : 22.\nMan of the Day: Dominik Uhl (3 Siege)\n\nHighlights:\nShortlegs: 17 Darts Dominik Uhl · 20 Darts Lenas Becker\n\nAlle Einzel:\nKevin Bauer – Dominik Uhl  1:2\nMartin Appelon – Tobias Thomas  1:2\n…\n\nSpielbericht und Statistik: ' + appUrl + '\n\nViele Grüße\n' + team, push: { titel: '[Test] Sieg: ' + team + ' 9 : 7 Voodoo Darters', text: 'Einzel 9:7 · Legs 22:22 · MotD Dominik Uhl', url: appUrl } }],
      ['tabelle', { betreff: '[Test] Tabelle nach dem 3. Spieltag – ' + team + ' auf Platz 3', text: 'Hallo zusammen,\n\nder 3. Spieltag ist komplett gewertet.\n\nErgebnisse:\nVoodoo Darters – ' + team + '  7:9 (22:22 Legs)\nTreff ma nix – Dart Artists Germering II  10:6\n\nTabelle:\n1. Treff ma nix  4 Pkt (2 Spiele)\n2. d`Haberer 2  4 Pkt (2 Spiele)\n3. ' + team + '  4 Pkt (2 Spiele)\n…\n\nAlles im Detail: ' + appUrl + ' → Liga → Tabelle.\n\nViele Grüße\n' + team, push: { titel: '[Test] ' + team + ' auf Platz 3 nach dem 3. Spieltag', text: 'Tabelle und Einzelrangliste in der App', url: appUrl } }],
      ['rekord', { betreff: '[Test] Neuer Teamrekord – Höchstes Finish: 121 – Lenas', text: 'Hallo zusammen,\n\nneuer Rekord im Team: Höchstes Finish: 121 – Lenas.\n\nViele Grüße\n' + team, push: { titel: '[Test] Neuer Rekord: Höchstes Finish', text: '121 – Lenas', url: appUrl } }],
      ['live', { betreff: '[Test] Anpfiff: ' + team + ' gegen ' + x.gegner, text: 'Hallo zusammen,\n\ngerade geht es los: ' + team + ' gegen ' + x.gegner + ' (' + x.wo + ').\n\nLive mitfiebern: ' + appUrl + '/live.html\n\nViele Grüße\n' + team, push: { titel: '[Test] Anpfiff: ' + team + ' – ' + x.gegner, text: x.wo + ' · zum Live-Ticker', url: appUrl } }],
      ['kasse', { betreff: '[Test] Kasse: 20,00 € – Mitgliedsbeitrag', text: 'Hallo ' + u.display_name + ',\n\nder Kassenwart hat auf dein Konto gebucht: 20,00 € – Mitgliedsbeitrag (Mitgliedsbeiträge).\n\nViele Grüße\n' + team, push: { titel: '[Test] Kasse: 20,00 €', text: 'Mitgliedsbeitrag · vom Kassenwart', url: appUrl } }],
      ['bericht-offen', { betreff: '[Test] Spielbericht 3. Spieltag noch nicht verschickt', text: 'Hallo ' + u.display_name + ',\n\ndas Ligaspiel ist abgeschlossen, der Spielbericht aber noch nicht verschickt. Bitte an die Ligaleitung schicken.\n\nViele Grüße\n' + team, push: { titel: '[Test] Spielbericht noch nicht verschickt', text: 'Bitte an die Ligaleitung schicken', url: appUrl } }],
      ['konto', { betreff: '[Test] Dein Passwort wurde geändert', text: 'Hallo ' + u.display_name + ',\n\nso sieht der Sicherheitshinweis aus, wenn dein Passwort geändert wurde oder du dich nach langer Pause anmeldest.\n\nDart-App' }],
      ['mitglied', { betreff: '[Test] Neu im Team: Max Mustermann', text: 'Hallo zusammen,\n\nMax Mustermann hat die Einladung angenommen und ist jetzt in der Dart-App dabei.\n\nViele Grüße\n' + team, push: { titel: '[Test] Neu im Team: Max Mustermann', text: 'hat die Einladung angenommen', url: appUrl } }]
    ];
    let n = 0;
    for (const [thema, inhalt] of beispiele) {
      if (await anKonto(u, thema, inhalt, null, true)) n++;
    }
    return n;
  }

  return {
    THEMEN, KANAELE, einstellungen, setze, kanalVon, anKonto, anAlle,
    jobs, zusageErinnerung, trainingErinnerung, spieltagMorgen, tabelleNeu,
    ereignis, kasseBuchung, konto, neuesMitglied, testAlle,
    abos: (userId) => qAbos.all(userId).map((a) => ({ id: a.id, endpoint: a.endpoint })),
    pushBereit: !!push.bereit, mailBereit: !!mailer.bereit, vapid: push.public || ''
  };
}
