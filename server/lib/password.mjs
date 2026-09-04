/*
 * Passwoerter — bewusst identisch zu Wirtschaftln (app/src/lib/password.ts),
 * damit es nur ein Verfahren gibt, das wir pflegen muessen.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N }).toString('hex');
  return `scrypt$${N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [algo, nStr, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !nStr || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEYLEN, { N: Number(nStr) });
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
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
