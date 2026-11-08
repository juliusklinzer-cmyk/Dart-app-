# Backlog – Darts App

## In Arbeit

- [ ] DRT-001 Audit 08.11.2026 umsetzen: alle freigegebenen Befunde (Pakete A–F) · prio:hoch · bis:2026-11-10 · von:Julius · am:2026-11-08 · quelle:audit-2026-11-08/
  - Server (S1–S9, M3): Rechte, Rate-Limits, Lost-Update-Pfade (S3-Erlaubtliste wieder raus: Gegner-Adresse wird am Spieltag eingetippt, Julius 08.11.)
  - Mitteilungen (M1–M17): Themen, Zeitfenster der Jobs, Push-Abos, Mail-Texte
  - Client (L18–L26, O21–O27, D1, D9, D11): Live-Ende mit seq, Beitritt mitten in der Aufnahme, Live-Strom nach Fehler, Zuschauer-Ticker bei 429, Warteschlange, Gast-Sperren
  - CSS (D2–D19): Tokens, Kontraste, Kompakt-Layouts, Schleier/Barlicht
  - Tests/Build (O20, T-H1, T-H2, T-M1–T-M8, T-N1, T-N5): konto.mjs grün, Gruppen-Kapselung, tests/alle.mjs im Deploy, Einzeldatei-Head aus index.html, Lockfile, env.example, Node ≥ 22.13, Repo-Hygiene, Backlog, OFL, README

## Wartet auf Julius

- [ ] DRT-002 Backup prüfen: auf dem Server `crontab -l` ansehen (läuft `/opt/dart-turnier/backup.sh` täglich 04:30?) und einmal einen Restore nach DEPLOY.md „Backup“ üben · prio:hoch · von:Audit H7/S-M6 · am:2026-11-08
- [ ] DRT-004 Brevo-Schlüssel aus dem Sitzungs-Transkript schwärzen (Befehl steht im Chat vom 08.11.); Erneuern bei Brevo hast du bewusst nicht gewollt · am:2026-11-08
- [ ] DRT-017 iPhone: App einmal vom Home-Bildschirm löschen und neu hinzufügen, damit die Statusleiste ohne Glas-Blur kommt (Meta-Tag ist raus, iOS liest das nur beim Hinzufügen) · prio:hoch · von:Julius · am:2026-11-08

## Offen

- [ ] DRT-018 Handy-Block 2 (Screenshots Julius 08.11.): Session-Modus für Solo-X01 (bei einem Spieler gibt es nur „Session“ statt Leg/Set-Wahl, Leg zu Ende → nächstes sofort, Session-Zahlen über alle Legs, Beenden nach jedem Spiel, zählt als Übung) · prio:hoch · von:Julius · am:2026-11-08
  - Solo quer: ⌨ Tastatur-Modus auch allein, Tastenfeld weg, rechts Eingabefeld + Kacheln (Average, First 9, Darts im Leg, 180er, höchste Aufnahme, Checkout-Quote) + letzte Aufnahmen
  - Fernsteuerung hoch: Spielerkarten als breite Zeilen statt leerer Säulen – Rest groß wie immer, die letzten Würfe in der gewohnten Ansicht
  - Punkte-Modus hoch: Abstand zwischen Kopf und Spielerkarten und zum Rand; Namen bei vier Spielern nicht abschneiden
  - Liga-Karten: „GAME ON“ nur am Spieltag selbst, vorher nur Zusagen/Absagen
- [ ] DRT-005 D16: harte Farb- und Radiuswerte in css/styles.css in Tokens überführen · quelle:audit-2026-11-08 D16 · am:2026-11-08
- [ ] DRT-006 T-N3: die fünf esc()-Kopien (app.js, auth.js, kamera.js, live.js, webseite.js) zusammenlegen, Zuschauer-Rendering live.js/webseite.js teilen · quelle:audit-2026-11-08 T-N3 · am:2026-11-08
- [ ] DRT-007 S3-Ausbau: Betreff und Text der Spielbericht-Mail serverseitig bauen statt aus dem Client übernehmen · quelle:audit-2026-11-08 S3 · am:2026-11-08
- [ ] DRT-008 O28: Zuschauer-Schlüssel beendeter Turniere verfallen lassen (bisher öffentlich lesbar ohne Ende) · quelle:audit-2026-11-08 O28 · am:2026-11-08
- [ ] DRT-009 O29: liveEinzel-Map im Server aufräumen – verwaiste Turniere halten bis 96 KB je Einzel bis zum Neustart · quelle:audit-2026-11-08 O29 · am:2026-11-08
- [ ] DRT-010 O30: kein Pomp beim Entfernen eines fremden Darts · prio:niedrig · quelle:audit-2026-11-08 O30 · am:2026-11-08
- [ ] DRT-011 D-A7/D-B4/D-C3: Kompakt-Layouts (Spielplan, Rangliste, Liga-Karte) auf schmalen Geräten · quelle:audit-2026-11-08 · am:2026-11-08
- [ ] DRT-012 H2: dart-turnier.html im Dockerfile mitliefern bzw. aus dem Image bauen, statt das eingecheckte Artefakt zu kopieren · quelle:audit-2026-11-08 H2 · am:2026-11-08
- [ ] DRT-013 H5: Log-Rotation für den Container (docker logging-Optionen in compose.yml) · quelle:audit-2026-11-08 H5 · am:2026-11-08
- [ ] DRT-014 T2: Stammspieler-Knopf bei laufendem Turnier nicht nur stumm blockieren, sondern ausblenden oder erklären · quelle:audit-2026-11-08 T2 · am:2026-11-08
- [ ] DRT-015 T9: Hinweis im Turnier-Modus, wie man ihn wieder verlässt · quelle:audit-2026-11-08 T9 · am:2026-11-08
- [ ] DRT-016 T12: Namenskappung bei 16 Zeichen sichtbar machen (Zähler oder Hinweis statt stillem maxlength) · prio:niedrig · quelle:audit-2026-11-08 T12 · am:2026-11-08

## Ideen

## Erledigt
