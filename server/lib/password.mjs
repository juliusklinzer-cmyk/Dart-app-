/*
 * Passwoerter — bewusst identisch zu Wirtschaftln (app/src/lib/password.ts),
 * damit es nur ein Verfahren gibt, das wir pflegen muessen.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/*
 * Arbeitsfaktor. 2^17 ist die OWASP-Empfehlung fuer scrypt (r = 8, p = 1).
 * Das braucht pro Rechnung 128 * N * r = 128 MB Arbeitsspeicher -- Node
 * erlaubt von sich aus nur 32 MB, deshalb `maxmem`. scryptSync blockiert
 * den einen Prozess, es laeuft also nie mehr als eine Rechnung gleichzeitig;
 * der Container braucht trotzdem genug Luft (compose.yml: mem_limit).
 *
 * Alte Hashes (N = 16384) gelten weiter und werden beim naechsten
 * erfolgreichen Login still neu berechnet (braucheNeuHash).
 */
const N = 2 ** 17;
const KEYLEN = 64;
const N_MAX = 2 ** 20;
const MAXMEM = 192 * 1024 * 1024;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N, maxmem: MAXMEM }).toString('hex');
  return `scrypt$${N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [algo, nStr, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !nStr || !salt || !hash) return false;
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < 2 || n > N_MAX) return false;
  const candidate = scryptSync(password, salt, KEYLEN, { N: n, maxmem: MAXMEM });
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* Stammt der Hash noch aus der Zeit mit kleinerem Arbeitsfaktor? */
export function braucheNeuHash(stored) {
  const [algo, nStr] = String(stored || '').split('$');
  return algo !== 'scrypt' || Number(nStr) < N;
}

/* Die Handvoll Passwoerter, die in jeder Leak-Liste ganz oben stehen. */
const GURKEN = [
  'passwort', 'password', '12345678', '123456789', '1234567890', 'qwertz123',
  'qwerty123', 'dartturnier', 'darts123', 'passwort123', 'password123',
  'letmein123', 'willkommen', 'administrator'
];

/* Gibt null zurueck, wenn das Passwort taugt, sonst den Grund auf Deutsch. */
export function checkPassword(password) {
  const p = String(password || '');
  if (p.length < 6) return 'Das Passwort muss mindestens 6 Zeichen haben.';
  if (p.length > 200) return 'Das Passwort ist zu lang (hoechstens 200 Zeichen).';
  const flach = p.toLowerCase().replace(/\s+/g, '');
  if (GURKEN.indexOf(flach) >= 0) return 'Dieses Passwort ist zu bekannt. Nimm bitte ein anderes.';
  if (/^(.)\1+$/.test(p)) return 'Das Passwort besteht nur aus einem einzigen Zeichen.';
  return null;
}
