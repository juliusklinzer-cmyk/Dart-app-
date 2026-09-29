/*
 * Rate-Limit im Arbeitsspeicher. Der Dienst laeuft als genau ein Prozess,
 * deshalb reicht das — mit einer ehrlichen Einschraenkung: ein Neustart
 * setzt alle Zaehler zurueck. Fuer zehn Kollegen ist das vertretbar; wer
 * gezielt durchprobieren will, braucht trotzdem sehr lange (scrypt).
 */
const eimer = new Map();

/* Obergrenze fuer die Zahl der Eintraege. Ohne sie koennte jemand mit lauter
   verschiedenen Schluesseln (erfundene E-Mails, wechselnde IPs) den Speicher
   des Containers vollschreiben. Die Map merkt sich die Einfuege-Reihenfolge,
   also fliegen die aeltesten zuerst. */
export const MAX_EINTRAEGE = 20000;

function neuerEimer(schluessel, fensterMs, jetzt) {
  if (!eimer.has(schluessel) && eimer.size >= MAX_EINTRAEGE) {
    aufraeumen();
    for (const k of eimer.keys()) {
      if (eimer.size < MAX_EINTRAEGE) break;
      eimer.delete(k);
    }
  }
  const e = { zaehler: 0, bis: jetzt + fensterMs };
  eimer.set(schluessel, e);
  return e;
}

export function anzahl() {
  return eimer.size;
}

/*
 * Erlaubt `limit` Versuche pro `fensterMs`. Gibt die Wartezeit in Sekunden
 * zurueck, wenn gesperrt, sonst 0.
 */
export function pruefe(schluessel, limit, fensterMs) {
  const jetzt = Date.now();
  let e = eimer.get(schluessel);
  if (!e || jetzt > e.bis) e = neuerEimer(schluessel, fensterMs, jetzt);
  if (e.zaehler >= limit) return Math.max(1, Math.ceil((e.bis - jetzt) / 1000));
  return 0;
}

export function zaehle(schluessel, limit, fensterMs) {
  const jetzt = Date.now();
  let e = eimer.get(schluessel);
  if (!e || jetzt > e.bis) e = neuerEimer(schluessel, fensterMs, jetzt);
  e.zaehler += 1;
}

/* Nach erfolgreichem Login: der Zaehler dieses Schluessels ist erledigt. */
export function loesche(schluessel) {
  eimer.delete(schluessel);
}

/* Damit die Map nicht unbegrenzt waechst. */
export function aufraeumen() {
  const jetzt = Date.now();
  for (const [k, e] of eimer) if (jetzt > e.bis) eimer.delete(k);
}
