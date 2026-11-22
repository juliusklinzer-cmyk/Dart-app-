# Datenschutz-Bestandsaufnahme Blink 180 – Dart Turnier

Stand 22.11.2026. Diese Liste ist aus dem Code und der Serverkonfiguration ermittelt,
nicht aus Annahmen. Sie ist die Grundlage für `datenschutz.html` und `impressum.html`.
Ändert sich eine der hier genannten Stellen, muss die Erklärung mitgezogen werden.

Geprüft wurden `server/main.mjs`, `server/api.mjs`, `server/lib/*.mjs`,
`server/migrations/*.sql`, `server/scripts/*.mjs`, `deploy/*`, `js/auth.js`,
`js/sync.js`, `js/app.js` (nur Speicher), `js/webseite.js`, `js/live.js`, `sw.js`,
`index.html`, `webseite.html`, `live.html` und `css/*.css`. Am 22.11.2026 wurde
außerdem auf dem Server nur gelesen: Docker-Logeinstellungen, der Caddy-Site-Block,
die Crontab und die Hetzner-Metadaten.

## 1. Hosting und Infrastruktur

| Punkt | Befund | Quelle |
|---|---|---|
| Server | Hetzner Cloud CPX12, Rechenzentrum **nbg1-dc3 (Nürnberg)**, Region eu-central. Der Server ist geteilt mit Wirtschaftln und dem Firmengolf-Staging. | `deploy/compose.yml`, Hetzner-Metadaten |
| Anbieter | Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen. Als Auftragsverarbeiter braucht es einen AVV mit Hetzner (in der Hetzner-Konsole abschließbar). **Ob er abgeschlossen ist, steht nicht im Repo.** | |
| Eingang | Caddy-Reverse-Proxy (Container `wirtschaftln-caddy-1`) terminiert TLS und reicht an `darts-app:3002` weiter. Zertifikate kommen automatisch von Let's Encrypt (Caddy-Standard). | `deploy/Caddyfile.snippet` |
| Caddy-Zugriffslog | **Keins.** Der Site-Block hat keine `log`-Direktive, und das Caddyfile im Container hat weder einen globalen Block noch `log`. Caddy schreibt dann keine Zugriffsprotokolle. | am Server geprüft |
| Node-Server-Log | Kein Zugriffslog. `console.log/error` schreibt nur Start, Liga-Abgleich, Mitteilungszahlen und Fehler. **Ausnahme:** schlägt eine Mail fehl, steht die **Empfängeradresse im Log** (`[mail] Passwort-Link an … fehlgeschlagen`, `Hinweis E-Mail-Wechsel an …`). | `server/api.mjs` |
| Log-Aufbewahrung | Docker `json-file` **ohne Rotation** (kein `/etc/docker/daemon.json`, keine `logging`-Optionen). Das Log lebt so lange wie der Container. Jedes Deploy erzeugt einen neuen Container, das alte Log ist dann weg. Zwischen zwei Deploys wächst es unbegrenzt, ist aber klein, weil es kein Zugriffslog gibt. | am Server geprüft |
| Sicherheits-Header | Die CSP erlaubt nur `'self'` (Skripte, Stile, Schriften, Verbindungen) und Bilder als `data:`/`blob:`. Der Browser lädt also **nichts von fremden Servern**. HSTS, nosniff, `X-Frame-Options: DENY` und `Referrer-Policy` sind gesetzt. Dazu kommt `X-Robots-Tag: noindex, nofollow` für die ganze Domain. | `server/main.mjs`, Caddy-Snippet |

## 2. Daten im Browser (localStorage, Service Worker, Cookie)

| Speicher | Inhalt | Zweck / Dauer |
|---|---|---|
| Cookie `darts_session` | opakes Zufallstoken (32 Bytes hex), `HttpOnly`, `SameSite=Lax`, `Secure`, `Max-Age` 90 Tage. Die Frist gleitet und wird höchstens einmal am Tag erneuert. | Anmeldung. Server-Tabelle `sessions` speichert Token, Konto, Ablauf und Anlage, **keine IP und keinen User-Agent**. Abgelaufene Sessions räumt der Server stündlich weg. |
| `dart-turnier-v1` | der ganze App-Stand: Profile (Name, Bild, Farbe, Lieblingsdoppel …), laufendes Turnier, Archiv, Einstellungen. Ist man angemeldet, liegen hier auch **Spiele und Profile der ganzen Mannschaft**. | Offline-Betrieb. Bleibt, bis der Nutzer die Website-Daten löscht. Das Abmelden leert ihn **nicht**. |
| `dart-turnier-v1.kaputt`, `.kaputt-neu` | Kopie eines nicht lesbaren Stands | Datenrettung |
| `dart-turnier-vor-anmeldung` | Sicherung des Stands vor der ersten Zuordnung | Datenrettung |
| `dart-turnier-sync-v1` | Konto-ID, Abgleich-Cursor, Warteschlange noch nicht hochgeladener Spiele, abgelehnte Uploads | Offline-Nachreichen |
| `dart-turnier-konto` | ob ein Server bekannt ist, dazu das angemeldete Konto (eigenes Profil inkl. E-Mail). Beim Abmelden wird der Kontoeintrag geleert. | Start ohne Netz |
| `dart-turnier-profil-offen` | Merker „Profil noch nicht hochgeladen“ | |
| `dart-turnier-kamera-v1`, `-linse-v1` | Kopplungsraum, Kalibrierung | nur mit Kamera-Schicht, die **nicht geladen** wird |
| Service Worker `sw.js` | Cache `dart-turnier-vNNN` mit App-Dateien. Die API wird nie gecacht. Andere gleich-originige GET-Antworten (z. B. Webseite, Impressum) landen beim ersten Abruf im Cache. | Offline-Start. Wird nur von der App registriert, gilt dann für die ganze Herkunft. |
| Push-Abo | Wer Mitteilungen einschaltet, gibt im Browser die Erlaubnis. Der Browser legt dann ein Abo beim Push-Dienst seines Herstellers an. | siehe Abschnitt 5 |

Die öffentliche Webseite (`js/webseite.js`) und der Live-Ticker (`js/live.js`) schreiben
**nichts** in den Speicher und setzen kein Cookie. Das Session-Cookie setzt erst die
Anmeldung. Es gibt keine Tracking- oder Analysewerkzeuge und keine Einwilligungsabfrage,
weil nichts Einwilligungspflichtiges gespeichert wird (§ 25 Abs. 2 Nr. 2 TDDDG).

## 3. Konten und Profile (Server, SQLite `/data/darts.db`)

Tabelle `users`:

| Feld | Pflicht? | Wer sieht es |
|---|---|---|
| E-Mail | ja (Anmeldename) | nur das Konto selbst. **Ausnahme:** Die E-Mails der zwei Teamcaptains (über den vollen Namen mit der Teamliste der Ligaleitung abgeglichen) liefert `GET /api/liga/empfaenger` an **alle Angemeldeten, auch an Gast-Konten**. |
| Anzeigename | ja | alle Angemeldeten. Öffentlich im Live-Ticker, siehe Abschnitt 6. |
| voller Name (`real_name`) | freiwillig in der App. Die Registrierung über die **Webseite verlangt Vor- und Nachnamen**. | alle Angemeldeten (für den Spielberichtsbogen) |
| Profilbild (Data-URL, max. ca. 400 KB) | freiwillig | alle Angemeldeten |
| Farbe, Lieblingsdoppel, Finish-Tabelle, Kürzel, Wurfhand (R/L) | freiwillig | alle Angemeldeten |
| Passwort-Hash (scrypt) | ja | niemand |
| `created_at`, `last_login_at` | automatisch | das Konto selbst (`seit`). `last_login_at` steuert die Sicherheitsmail nach mehr als 30 Tagen Pause. |
| Rollen: `gast_konto`, `kassenwart`, `test`, `sieht_test`, `status` | automatisch / Admin | |

Weitere personenbezogene Tabellen:

- `games` + `game_players`: jedes Spiel mit allen Würfen als JSON. Dazu, wer eingetragen
  hat, und die Namen von Gastspielern ohne Konto (frei eingetippt). **Sichtbar für alle
  Angemeldeten** (Mitglieder und Gast-Konten), weil Statistik und Rangliste auf jedem
  Gerät gleich sein sollen. Löschen setzt nur `deleted_at` (Grabstein), **die Daten
  bleiben in der Zeile**.
- `tournaments`, `tournament_players`, `tournament_matches`: geteilte Turniere und
  Ligaspiele samt Bogen-Daten (Aufstellung, Nachmeldungen, Korrekturen,
  **Unterschriften**). Kein automatisches Löschen.
- `live_games`: Online-Spiele. Offene werden nach einem Tag geschlossen, geschlossene
  nach 7 Tagen gelöscht.
- `liga_zusagen`: wer bei welchem Spieltag/Training dabei ist. Sichtbar für alle Angemeldeten.
- `kasse`: Kassenbuch mit Buchungen, wer gebucht hat und bei Beiträgen, welches Mitglied
  gezahlt hat. Sichtbar für alle Mitglieder (nicht für Gast-Konten). Kein Löschen.
  Dazu ein **PayPal-Pool-Link** (nur ein Link, die App lädt nichts von PayPal).
- `liga_tabelle`: Ligatabelle, öffentlich über `/api/oeffentlich/liga`.
- `liga_empfaenger`: feste Bericht-Empfänger und **E-Mail-Adressen gegnerischer
  Teamcaptains** (Dritte), einmal eingetippt und dauerhaft gespeichert.
- `einladungen`: Token, Ersteller, Nutzer. 30 Tage nach Ablauf gelöscht.
- `passwort_resets`: SHA-256 des Tokens, gilt 1 h. Einen Tag nach Ablauf gelöscht.
- `benachrichtigungen`, `push_abos` (Endpunkt, Schlüssel, **User-Agent gekürzt auf 120
  Zeichen**, Anlage, letzter Erfolg), `mail_log`, `mitteilung_log`: Mitteilungs-
  einstellungen und das Protokoll gegen Doppelversand. Die Logs werden **nie
  gelöscht**, solange das Konto besteht.

**Konto löschen:** In der App gibt es dafür **keinen Knopf**, und es gibt keinen
API-Endpunkt. Julius löscht mit `server/scripts/konto-weg.mjs`. Ohne Spiele wird das
Konto komplett gelöscht. Mit Spielen werden alle beteiligten Spiele (**auch die der
Mitspieler**) zu Grabsteinen, und das Konto wird nur **stillgelegt**. E-Mail, Name,
Bild, voller Name und Passwort-Hash bleiben dann in der Datenbank. Für einen
Löschantrag nach Art. 17 DSGVO reicht das so nicht.

## 4. Registrierung, Anmeldung, Ratelimit (IP-Adressen)

- Registrierung nur mit Einladungscode oder Einladungs-Link.
- IP-Adressen (hinter Caddy aus `X-Forwarded-For`) werden **nur im Arbeitsspeicher**
  als Ratelimit-Zähler gehalten (`server/lib/ratelimit.mjs`): Registrierung 1 h,
  Anmeldung 15 min (IP und IP+E-Mail), Passwort-Reset 15 min/1 h,
  Einladung ansehen 1 h, Zuschauer/öffentliche Liga 10 min. Stündliches Aufräumen,
  ein Neustart löscht alles, höchstens 20 000 Einträge. Die IP wird **nicht
  gespeichert** und nicht geloggt.

## 5. Dienste Dritter

| Dienst | Was geht hin | Wann | Anmerkung |
|---|---|---|---|
| **Brevo** (Sendinblue SAS, 106 boulevard Haussmann, 75008 Paris) | Empfängeradresse, Name in der Anrede, Mailinhalt, bei Spielberichten das PDF (volle Namen, Ergebnisse, Unterschriften) | Passwort-Link, Sicherheitshinweise (Passwort geändert, E-Mail geändert, Anmeldung nach Pause), Erinnerungen und Mitteilungen je nach Einstellung (einige standardmäßig an: Zusage fehlt, Training, Ergebnis), Spielbericht an Ligaleitung und Captains, Testmail | SMTP `smtp-relay.brevo.com:587` mit STARTTLS. Auftragsverarbeitung (Brevo-AVV steht in deren AGB). **Ob in Brevo Öffnungs- und Klick-Tracking für Transaktionsmails aktiv ist, lässt sich im Code nicht sehen.** Die Mails enthalten ein Logo von `darts.wirtschaftln.de` und keinen eigenen Zählpixel. |
| Microsoft (Postfächer `blink180@`, `dart@wirtschaftln.de`) | Antworten auf Mails, Kopie jedes Spielberichts (CC an den Liga-Absender) | | Exchange Online. **Ob ein AVV dafür besteht, gehört zu Wirtschaftln/Visionpunch.** |
| **Web-Push-Dienste**: Apple (`*.push.apple.com`), Google FCM (`fcm.googleapis.com`), Mozilla (`*.push.services.mozilla.com`), Microsoft WNS (`*.notify.windows.com`) | Endpunkt des Geräts, **Ende-zu-Ende-verschlüsselter** Inhalt (RFC 8291, aes128gcm), Zeitpunkt, Größe, Gültigkeit 24 h, VAPID-Kontakt `dart@wirtschaftln.de` | nur wenn der Nutzer Mitteilungen erlaubt | Welcher Dienst, bestimmt der Browser des Nutzers. Die Anbieter sitzen (Konzernmütter) in den USA. Der Dienst kann den Inhalt nicht lesen. |
| **steeldart-muenchen.de** (Ligaleitung) | Der Server ruft **stündlich** öffentliche Seiten ab (Spielplan, Spielberichte, Teamseiten). Der User-Agent ist `Blink 180 Liga-Import`, es werden keine Nutzerdaten gesendet. | Produktion | Ergebnis: `liga-sdm.js` mit **Namen aller Ligaspieler** (alle Teams, Einzelergebnisse, Teamlisten, TC-Kennzeichen). Die Datei ist **öffentlich abrufbar** unter `/js/liga-sdm.js` (ebenso `/js/liga-daten.js`). Die Webseite zeigt daraus Ergebnisse und Tabelle, aber keine Einzelnamen. |
| Let's Encrypt | nichts Personenbezogenes (Zertifikatsanfragen von Caddy) | | |
| Apple Maps | nur ein **Link** („Route zum Lokal“). Es wird nichts geladen, bevor man ihn antippt. | | |
| Externe Links (SDM, DDV, WDF, PayPal-Pool) | reine Links | | |
| Schriften | **lokal** aus `/fonts/` (Anton, Barlow, Barlow Condensed, OFL). Kein Google-Fonts-Abruf, die CSP würde ihn auch blockieren. | | |
| CDNs | keine | | |

## 6. Öffentlich ohne Anmeldung

- `/` (Webseite): Spielplan, Ergebnisse, Tabelle. Läuft gerade ein Ligaspiel (oder
  ist es höchstens 6 h beendet), gibt `/api/oeffentlich/liga` den
  **Zuschauer-Schlüssel** heraus. Die Webseite zeigt dann den Live-Stand mit Namen.
- `/api/zuschauer/<schlüssel>` und `live.html#<schlüssel>`: **Anzeigenamen** der
  Konten, eingetippte **Namen der Gegner/Gäste**, Paarungen, Ergebnisse, Legs,
  laufender Rest und Average. Keine Unterschriften und keine Bogen-Korrekturen.
  Der Schlüssel eines Ligaspiels ist während des Spiels über die Webseite für jeden
  sichtbar. Er **verfällt nie** (offen als DRT-008), ein späterer Abruf mit bekanntem
  Link zeigt also weiter alles.
- `/api/einladungen/<token>`: Anzeigename des Einladenden.
- `/api/passwort-neu/<token>`: Anzeigename, nur mit gültigem Token.

## 7. Kamera

Die Kamera-Kopplung („Linse“) ist abgeschaltet: `js/kamera.js` wird nicht geladen,
die Relay-Routen gibt es nur mit `DARTS_KAMERA=1`, und das ist nicht gesetzt.
Übrig bleibt `<input type="file" capture="user">` fürs Profilbild. Das Foto wird im
Browser zugeschnitten und als Profilbild gespeichert, sonst geht nichts an den Server.

## 7a. In Arbeit (anderer Agent, Stand 22.11. nicht live)

- `js/autodarts.js` und `tools/autodarts-bruecke/`: Die App holt erkannte Darts von
  einer Brücke auf demselben Rechner (`http://127.0.0.1:3190`) oder im lokalen Netz.
  Die CSP bekommt dafür `connect-src http://127.0.0.1:* http://localhost:*`. Das
  läuft nur nach Freischalten mit `?autodarts=an` (localStorage `dart-autodarts-v1`),
  und es geht kein fremder Server mit. Nach dem Livegang braucht die Erklärung
  höchstens einen Satz, wenn die Brücke selbst eine Cloud anspricht (bisher nicht).
- `server/lib/liga-gesamt.mjs` und `liga.html`: Die ganze Liga-Webseite wird
  importiert, **inkl. Teamcaptains, Telefon und Adresse je Team**, nur für Angemeldete.
  Abschnitt „Liga-Import“ der Erklärung ist allgemein formuliert und deckt das ab.

## 8. Sicherungen

`deploy/backup.sh` läuft per Crontab **täglich um 04:45** (am Server geprüft).
`VACUUM INTO` legt eine vollständige Kopie der Datenbank an (inkl. Profilbilder,
E-Mails, Passwort-Hashes). Die **letzten 14 Stände** liegen im Volume
`/data/backups`, gespiegelt nach `/opt/dart-turnier/backups-lokal`, beides auf
demselben Server. `DARTS_BACKUP_OFFSITE` ist **nicht gesetzt**, es gibt also keine
Kopie außer Haus. Gelöschte Daten verschwinden damit spätestens nach 14 Tagen auch
aus den Sicherungen.

## 9. Was überrascht / Risiken

1. **Keine echte Löschung:** kein Selbstlöschen, und `konto-weg.mjs` legt Konten mit
   Spielen nur still, die Stammdaten bleiben. Spiel-Grabsteine behalten die Würfe.
   Dazu reißt das Löschen eines Kontos die Spiele aller Mitspieler mit.
2. **Captain-E-Mails für alle sichtbar**, auch für Gast-Konten (`/api/liga/empfaenger`).
   Gegner-Captain-Adressen werden dauerhaft gespeichert.
3. **Liga-Spielernamen aller Teams öffentlich** als `/js/liga-sdm.js`. Sie kommen aus
   einer öffentlichen Quelle, `noindex` ist gesetzt.
4. **Zuschauer-Schlüssel laufender Ligaspiele öffentlich** über die Webseite und ohne
   Verfall. Wer ihn hat, sieht Namen und Ergebnisse dauerhaft.
5. **Gemeinsame iPads:** Abmelden leert den App-Stand nicht (nur den Kontoeintrag).
   Die Mannschaftsdaten (Spiele, Profile mit Bildern und vollen Namen) bleiben auf
   dem Gerät, die App sagt das beim Abmelden auch so.
6. **Mailadressen im Container-Log** bei Versandfehlern. Das Log hat keine Rotation,
   wird aber mit jedem Deploy neu angelegt.
7. **Brevo-Tracking** unklar (Kontoeinstellung).
8. Der Webseiten-Fuß verlinkt `steeldartliga-muenchen.de`, die Ligadaten kommen von
   `steeldart-muenchen.de`. Das ist vermutlich ein Tippfehler im Link (nicht
   datenschutzrelevant).
9. `mail_log`, `mitteilung_log`, Kassenbuch, Turniere und Spiele haben keine
   Löschfrist. Sie leben so lange wie das Konto bzw. die Mannschaft.
