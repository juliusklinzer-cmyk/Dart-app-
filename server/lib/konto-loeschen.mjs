/*
 * Ein Konto loeschen (Art. 17 DSGVO), fuer das Server-Skript und den Knopf
 * in der App.
 *
 * Grundsatz: alles, was die Person ausmacht, verschwindet; was den anderen
 * gehoert, bleibt.
 *  - Stammdaten (E-Mail, Name, buergerlicher Name, Bild, Passwort-Hash,
 *    Kuerzel, Wurfhand, Finish-Profil) werden geleert.
 *  - Sitzungen, Push-Abos, Mitteilungs-Einstellungen und -Protokolle,
 *    Passwort-Links und Zusagen werden geloescht.
 *  - Spiele, die sie selbst eingetragen hat und an denen kein anderes Konto
 *    beteiligt war, bekommen einen Grabstein und verschwinden auf allen
 *    Geraeten. Was ein anderer eingetragen hat, gehoert dem und bleibt.
 *  - In allen uebrigen Spielen wird ihr Name im mitgereisten `namen` durch
 *    „Ehemaliges Mitglied“ ersetzt.
 *  - Spiele mit anderen Konten bleiben (sonst fehlten den Mitspielern ihre
 *    Legs). Dort steht nur noch die Kennung, die App zeigt
 *    „Ehemaliges Mitglied“.
 *  - Haengt gar nichts mehr am Konto, verschwindet auch die Zeile selbst.
 *
 * Kassenbuch-Eintraege bleiben (Nachweis der Mannschaftskasse), zeigen aber
 * ebenfalls nur noch „Ehemaliges Mitglied“.
 */
import { transaktion, nextSeq } from './db.mjs';

export const EHEMALIG = 'Ehemaliges Mitglied';

export function kontoLoeschen(db, userId) {
  const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
  if (!u) return { ok: false, grund: 'unbekannt' };

  return transaktion(db, () => {
    const jetzt = new Date().toISOString();

    for (const t of ['sessions', 'push_abos', 'benachrichtigungen', 'mitteilung_log', 'mail_log',
      'passwort_resets', 'liga_zusagen']) {
      db.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').run(userId);
    }
    /* Offene Turniere: aus der Teilnehmerliste raus. Beendete behalten ihn,
       ihr Archiv verweist ohnehin nur auf die Kennung. */
    db.prepare(
      "DELETE FROM tournament_players WHERE user_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE status = 'offen')"
    ).run(userId);
    db.prepare('UPDATE tournament_matches SET claimed_by = NULL WHERE claimed_by = ?').run(userId);
    db.prepare('DELETE FROM einladungen WHERE created_by = ? AND used_at IS NULL').run(userId);

    /* Selbst eingetragene Spiele ohne andere Konten: Grabstein. */
    const allein = db.prepare(
      'SELECT g.id FROM games g WHERE g.deleted_at IS NULL AND g.recorded_by = ?' +
        ' AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.user_id IS NOT NULL AND p.user_id <> ?)'
    ).all(userId, userId);
    let grabsteine = 0;
    for (const g of allein) {
      db.prepare('UPDATE games SET deleted_at = ?, seq = ? WHERE id = ?').run(jetzt, nextSeq(db), g.id);
      grabsteine++;
    }
    /* Uebrige Spiele: den mitgereisten Namen ersetzen. Kein neuer Cursor
       noetig - neue Geraete bekommen die bereinigte Fassung, vorhandene
       ersetzen den Namen ueber `ehemalige` in /api/users. */
    const mitIhr = db.prepare(
      'SELECT g.id, g.payload FROM games g WHERE g.deleted_at IS NULL' +
        ' AND (g.recorded_by = ? OR EXISTS (SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.user_id = ?))'
    ).all(userId, userId);
    for (const g of mitIhr) {
      let pl;
      try { pl = JSON.parse(g.payload); } catch (e) { continue; }
      if (pl && pl.namen && typeof pl.namen === 'object' && userId in pl.namen) {
        pl.namen[userId] = EHEMALIG;
        db.prepare('UPDATE games SET payload = ? WHERE id = ?').run(JSON.stringify(pl), g.id);
      }
    }
    /* Als fester Empfaenger der Spielberichte hinterlegt? Dann raus. */
    const fest = db.prepare("SELECT wert FROM liga_empfaenger WHERE schluessel = 'fest'").get();
    if (fest && u.email) {
      try {
        const liste = JSON.parse(fest.wert);
        if (Array.isArray(liste) && liste.some((a) => String(a).toLowerCase() === u.email)) {
          db.prepare("UPDATE liga_empfaenger SET wert = ? WHERE schluessel = 'fest'")
            .run(JSON.stringify(liste.map((a) => (String(a).toLowerCase() === u.email ? '' : a))));
        }
      } catch (e) { /* kaputter Eintrag: lassen */ }
    }
    const geteilt = db.prepare(
      'SELECT COUNT(DISTINCT g.id) c FROM games g WHERE g.deleted_at IS NULL' +
        ' AND (g.recorded_by = ? OR EXISTS (SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.user_id = ?))'
    ).get(userId, userId).c;

    /* Ganz weg, wenn nichts mehr darauf verweist (Grabsteine zaehlen mit:
       recorded_by ist NOT NULL). Sonst bleibt eine leere Huelle. */
    try {
      db.exec('SAVEPOINT konto_weg');
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      db.exec('RELEASE konto_weg');
      return { ok: true, ganz: true, grabsteine, geteilt };
    } catch (e) {
      db.exec('ROLLBACK TO konto_weg');
      db.exec('RELEASE konto_weg');
    }
    db.prepare(
      "UPDATE users SET email = ?, display_name = ?, real_name = NULL, avatar = NULL, password_hash = '!', dbl = NULL," +
        " finish = NULL, kuerzel = NULL, wurfhand = NULL, last_login_at = NULL, kassenwart = 0, mail_erinnerung = 0," +
        " status = 'geloescht' WHERE id = ?"
    ).run('geloescht:' + userId, EHEMALIG, userId);   // ohne @: kann niemand registrieren
    return { ok: true, ganz: false, grabsteine, geteilt };
  });
}
