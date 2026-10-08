/*
 * Sessions — opakes Zufallstoken in einer Tabelle, kein JWT.
 * Vorbild: Wirtschaftln app/src/lib/session.ts.
 *
 * Warum opak statt JWT: ein Token laesst sich sofort ungueltig machen
 * (Logout, Passwortwechsel, gestohlenes Geraet). Bei einem JWT muesste man
 * dafuer trotzdem eine Sperrliste fuehren — dann kann man gleich die
 * Tabelle nehmen.
 */
import { randomBytes } from 'node:crypto';

export const COOKIE = 'darts_session';
/* 90 Tage -- gerechnet ab der letzten Nutzung, nicht ab dem Login: wer die
   App regelmaessig oeffnet, bleibt angemeldet; wer 90 Tage nicht da war,
   meldet sich neu an. */
export const MAX_AGE_DAYS = 90;
/* Aufgefrischt wird hoechstens einmal am Tag -- sonst schriebe jeder
   Poll-Takt in die Datenbank. */
const AUFFRISCHEN_AB_MS = 864e5;

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    new Date(now + MAX_AGE_DAYS * 864e5).toISOString(),
    new Date(now).toISOString()
  );
  return token;
}

export function cookieHeader(token, secure) {
  const teile = [
    COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + MAX_AGE_DAYS * 86400
  ];
  if (secure) teile.push('Secure');
  return teile.join('; ');
}

export function clearCookieHeader(secure) {
  const teile = [COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) teile.push('Secure');
  return teile.join('; ');
}

/* Eingeloggter Nutzer oder null. Abgelaufene Sessions werden gleich entsorgt. */
export function currentUser(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.real_name, u.avatar, u.hue, u.dbl, u.status, u.created_at, u.test, u.sieht_test, u.kassenwart, u.gast_konto, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (row.status !== 'aktiv') return null;
  return row;
}

/*
 * Gleitender Ablauf: ist die Session gueltig und ihr letztes Auffrischen
 * laenger als einen Tag her, bekommt sie wieder volle 90 Tage. Gibt true
 * zurueck, wenn aufgefrischt wurde -- dann soll auch der Browser ein
 * frisches Cookie mit neuer Max-Age bekommen.
 */
export function auffrischen(db, token) {
  if (!token) return false;
  const jetzt = Date.now();
  const neu = new Date(jetzt + MAX_AGE_DAYS * 864e5).toISOString();
  const grenze = new Date(jetzt + MAX_AGE_DAYS * 864e5 - AUFFRISCHEN_AB_MS).toISOString();
  const r = db
    .prepare('UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at < ? AND expires_at > ?' +
      " AND user_id IN (SELECT id FROM users WHERE status = 'aktiv')")
    .run(neu, token, grenze, new Date(jetzt).toISOString());
  return r.changes > 0;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* Nach einem Passwortwechsel: alle anderen Geraete abmelden. */
export function destroyOtherSessions(db, userId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?').run(userId, keepToken || null);
}

export function sweepExpired(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
