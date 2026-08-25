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
const MAX_AGE_DAYS = 90;

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
      `SELECT u.id, u.email, u.display_name, u.avatar, u.hue, u.dbl, u.status, u.created_at, s.expires_at
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
