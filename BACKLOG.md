# Backlog – Darts App

## In Arbeit

## Wartet auf Julius

- [ ] DRT-026 Doppelquote auch im Tastatur-/Punkte-Modus: beim Checkout zusätzlich „davon aufs Doppel?“ fragen, bei einer Aufnahme ohne Finish auf 50 oder gerade bis 40 kurz „Darts aufs Doppel 0/1/2/3“; aus Rest und Darts allein ist nur der letzte Dart sicher – bitte ja/nein · von:Julius · am:2026-11-10

- [ ] DRT-002 Backup prüfen: auf dem Server `crontab -l` ansehen (läuft `/opt/dart-turnier/backup.sh` täglich 04:30?) und einmal einen Restore nach DEPLOY.md „Backup“ üben · prio:hoch · von:Audit H7/S-M6 · am:2026-11-08
- [ ] DRT-004 Brevo-Schlüssel aus dem Sitzungs-Transkript schwärzen (Befehl steht im Chat vom 08.11.); Erneuern bei Brevo hast du bewusst nicht gewollt · am:2026-11-08
- [ ] DRT-017 iPhone: App einmal vom Home-Bildschirm löschen und neu hinzufügen, damit die Statusleiste ohne Glas-Blur kommt (Meta-Tag ist raus, iOS liest das nur beim Hinzufügen) · prio:hoch · von:Julius · am:2026-11-08

## Offen

- [ ] DRT-025 Training umbauen: Zusagen Bin dabei / Kann nicht plus „Noch keine Antwort“ (kein Unsicher), Übungs-Ligaspiel raus, rechts Trainingsstatistik aus den Zusagen (Abende, wer wie oft dabei, Anteil, Serien, Rekordabend, Ø Leute, Spiele am Dienstag) – Deploy erst nach dem Ligaspiel am 10.11., solange braucht Julius das Übungsspiel zum Proben · von:Julius · am:2026-11-10

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

- [x] DRT-031 Ligaspiel-Start: Spielertypen für beide Teams – Status-Knopf gemeldet / Gastspieler / neu melden je Zeile, „Anderer Name“ ohne Konto bei uns, Kader-Chips mit Gast-Kennung der Ligaleitung, höchstens ein Gastspieler je Team (SWO), Nachmelde-Bogen direkt nach GAME ON bzw. spätestens vor den TC-Unterschriften, „(Gast)“ im Bogen, Gast oder Nachmeldung auch beim spontanen Wechsel · von:Julius · am:2026-11-11 · fertig:2026-11-11
- [x] DRT-032 Spielbericht-Versand: fünf Zeilen mit Rolle, fest sind beide TCs (TC-1/TC-2 laut Ligaleitung, Adresse vom Konto) und die Ligaleitung (spielbericht@steeldart-muenchen.de, laut Bogen V5.2; Udo schreibt selbst von liga@), dazu TC Gegner je Team gemerkt und eine freie Zeile; Liste auf dem Server (GET/PUT /api/liga/empfaenger), für alle Geräte · von:Julius · am:2026-11-11 · fertig:2026-11-11
- [x] DRT-033 Meine Stats als Dashboard: die Karten aus Julius’ Artefakt „Darts Statistik“ (Kennzahlen mit Vergleich, Average-Verlauf mit gleitendem Schnitt und Trend, Form-Ring, Radar, Doppel-Board, Big Scores und Doppelquote je Monat, Modi-Vergleich, Aktivität, Gegnerbilanz, Rekorde) aus den echten Aufnahmen, mit Filtern, Animationen und Tooltips; die bisherigen Karten bleiben darunter · von:Julius · am:2026-11-11 · fertig:2026-11-11
- [x] DRT-029 Schnelles X01 über mehrere Legs: Leg-Dialog mit „Ø Spiel“ und „Spiel beenden & speichern“ (auch im Menü), fertige Legs ohne Sieger ins Archiv, dann Auswertung · von:Julius · am:2026-11-10 · fertig:2026-11-10
- [x] DRT-030 Solo-Session am iPad quer: Rest und letzte Aufnahme mittig als Paar, Eingabefeld klein und Zahl groß, rechts Tabelle Leg | Session | Gesamt und Balken je Leg mit Session- und Gesamt-Linie · von:Julius · am:2026-11-10 · fertig:2026-11-10
- [x] DRT-028 Vorauswahl beim Spielstart: angemeldet nur der eigene Spieler, nach dem ersten Spiel des Abends (8 h) dessen Aufstellung, Ligaspiel: unsere vier; ohne Konto und bei laufendem Spiel unverändert · von:Julius · am:2026-11-10 · fertig:2026-11-10
- [x] DRT-027 Passwort vergessen per Mail-Link: „Passwort vergessen?“ auf der Anmeldeseite, Link an die Konto-Adresse (1 h, einmal, nur Hash gespeichert, 3 je Stunde), Seite „Neues Passwort“ meldet direkt an; Mail-Ausgabe in Datei für Tests (DARTS_MAIL_AUSGABE); Nachtrag: Link greift auch bei noch lebender Sitzung (Michi landete in der Spielerübersicht) · von:Julius · am:2026-11-10 · fertig:2026-11-10

- [x] DRT-024 Spieltag proben und Kader: Kader des Gegners als Chips im Start-Dialog, Probelauf gegen den nächsten Gegner im Übungsspiel (Gäste, Koppeln, Bericht, Mail nur an sich), Übungsspiel geht weiter zum Spielbericht; Liga-Statistik mit den Highlights der Ligaleitung für nachgetragene Spieltage; kein Training am Ligaspiel-Dienstag · von:Julius · am:2026-11-10 · fertig:2026-11-10

- [x] DRT-023 Ligaergebnisse von selbst aktuell: der Server holt stuendlich bei der Ligaleitung nach (server/lib/liga-import.mjs, liga.mjs), liefert die frische liga-sdm.js aus /data aus, Service Worker netzzuerst, App laedt im Liga-Reiter alle 15 Min nach; Tabelle am Computer: Platz-Band links ueber der Tabelle, Stand darunter, rechts rollt die Spalte (Alle Spiele war auf null gequetscht, darunter unerreichbar) · von:Julius · am:2026-11-10 · fertig:2026-11-10

- [x] DRT-022 Spielplan am Handy: Spieltag klappt in der Liste auf (Karte unter der Zeile, vergangene oben, kommende unten); Zusagen als „Bin dabei“ / „Kann nicht“ (Entweder-oder, kein Austragen) mit drei Gruppen Dabei, Kann nicht, Noch keine Antwort; Zeile und Karte ein Kasten, vergangene Spiele mit Sieg/Niederlage statt "Alle Spiele"-Link; Tastatur-Modus quer: letzte und vorletzte Aufnahme rechts neben dem Rest, keine Liste, Eingabefeld hoeher · von:Julius · am:2026-11-09 · fertig:2026-11-09

- [x] DRT-020 Block-2-Entscheidungen (Julius 09.11.): Session-Dialog bleibt bis zum Wegtippen (kein 6-s-Timer), Kachel „Höchstes Finish“ statt Checkout-Quote, kein Hinweis auf der Liga-Karte, iPad-Tasten meldet er bei Bedarf · von:Julius · am:2026-11-08 · fertig:2026-11-09
- [x] DRT-001 Audit 08.11.2026 umsetzen: alle freigegebenen Befunde (Pakete A–F; S3-Erlaubtliste auf Julius' Wunsch wieder raus) · prio:hoch · von:Julius · am:2026-11-08 · fertig:2026-11-08 · quelle:audit-2026-11-08/
- [x] DRT-018 Handy-Block 2: Session-Modus Solo-X01, Solo-Tastatur-Modus mit Statistik, Fernsteuerung hoch als Zeilen, Abstände Punkte-Modus hoch, GAME ON nur am Spieltag, Logo-Abstand oben in der installierten App · prio:hoch · von:Julius · am:2026-11-08 · fertig:2026-11-08
- [x] DRT-019 Tastenfeld: Spieltasten buchen am Touch-Gerät per pointerdown statt click, touch-action none (iPad schluckte Tipps mit rutschendem Finger) · von:Julius · am:2026-11-08 · fertig:2026-11-08
- [x] DRT-021 Solo hochkant und quer: Restzahl so gross wie die Karte erlaubt, linksbuendig, letzte Aufnahme daneben (hochkant) bzw. darunter (quer); Tastentoene nach der pointerdown-Umstellung wieder da (AudioContext wacht erst beim Loslassen auf) · von:Julius · am:2026-11-09 · fertig:2026-11-09
