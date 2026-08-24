/*
 * Einladungscode erzeugen bzw. in die Form bringen, die in DARTS_INVITE_HASH
 * gehoert. Der Code selbst wird nirgends gespeichert -- nur sein Hash.
 *
 *   npm run invite               zufaelligen Code wuerfeln
 *   npm run invite -- meincode   eigenen Code nehmen
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../lib/password.mjs';

const eigener = process.argv[2];
// Ohne aehnlich aussehende Zeichen (0/O, 1/l) -- der Code wird abgetippt.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function wuerfeln() {
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s.slice(0, 6) + '-' + s.slice(6, 12);
}

const code = eigener || wuerfeln();
if (eigener && eigener.length < 6) {
  console.error('Der Code sollte mindestens 6 Zeichen haben.');
  process.exit(1);
}

console.log('');
console.log('Einladungscode (den gibst du deinen Kollegen):');
console.log('   ' + code);
console.log('');
console.log('Diese Zeile gehoert in deploy/.env auf dem Server:');
console.log('   DARTS_INVITE_HASH=' + hashPassword(code));
console.log('');
console.log('Der Code laesst sich aus dem Hash nicht zurueckrechnen -- also');
console.log('irgendwo notieren, sonst musst du einen neuen erzeugen.');
