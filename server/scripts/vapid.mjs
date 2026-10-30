/* Erzeugt ein VAPID-Schluesselpaar fuer Web Push. Die beiden Zeilen in die
   .env auf dem Server (/opt/dart-turnier/.env) - nie committen.
     node server/scripts/vapid.mjs */
import { vapidErzeugen } from '../lib/push.mjs';
const k = vapidErzeugen();
console.log('DARTS_VAPID_PUBLIC=' + k.public);
console.log('DARTS_VAPID_PRIVATE=' + k.private);
