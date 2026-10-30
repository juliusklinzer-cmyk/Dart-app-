/*
 * Die Dienste, die der Server und die Skripte gemeinsam brauchen: Mailer
 * (Brevo), Web Push (VAPID) und der Spielplan der Liga - alles aus der
 * Umgebung, auf dem Server aus /opt/dart-turnier/.env. Hier an einer
 * Stelle, damit server/main.mjs und server/scripts/beispiele.mjs dieselben
 * Vorgaben (Absender, App-Adresse) haben.
 */
import { erstelleMailer } from './mail.mjs';
import { erstellePush } from './push.mjs';
import { ladeLigaDaten } from './liga.mjs';

export function erstelleDienste(env, appDir) {
  // Adresse der App in Mails (Erinnerungen, Knoepfe, Testmail).
  const appUrl = env.DARTS_APP_URL || 'https://darts.wirtschaftln.de';
  /* Mails ueber Brevo (SMTP-Relay, STARTTLS): ohne Zugangsdaten bleibt der
     Mailer stumm, die App zeigt dann keine Mail-Knoepfe. Absender je Anlass
     (Liga: Spielberichte und Erinnerungen; App: alles Allgemeine). */
  const mailer = erstelleMailer({
    user: env.BREVO_SMTP_USER || '',
    key: env.BREVO_SMTP_KEY || '',
    absenderLiga: env.DARTS_MAIL_LIGA || 'Blink 180 <blink180@wirtschaftln.de>',
    absenderApp: env.DARTS_MAIL_APP || 'Dart-App <dart@wirtschaftln.de>',
    appUrl: appUrl
  });
  if (!mailer.bereit) console.warn('Hinweis: BREVO_SMTP_USER/KEY fehlen -- die App verschickt keine Mails.');
  /* Web Push (VAPID): Schluesselpaar mit node server/scripts/vapid.mjs. */
  const push = erstellePush({
    public: env.DARTS_VAPID_PUBLIC || '',
    private: env.DARTS_VAPID_PRIVATE || '',
    kontakt: 'mailto:' + (env.DARTS_MAIL_APP || 'dart@wirtschaftln.de').replace(/^.*<|>.*$/g, '')
  });
  if (!push.bereit) console.warn('Hinweis: DARTS_VAPID_PUBLIC/PRIVATE fehlen -- keine Push-Mitteilungen.');
  /* Spielplan der Liga fuer die Erinnerungen vor dem Spieltag. */
  return { appUrl: appUrl, mailer: mailer, push: push, liga: ladeLigaDaten(appDir) };
}
