# Backlog – Darts App

## In Arbeit

## Wartet auf Julius

- [ ] DRT-020 Block 2 am Handy/iPad gegenprüfen und drei Kleinigkeiten entscheiden: (a) Der Session-Dialog nach jedem Leg schließt sich nach 6 s von selbst – passt, oder lieber nur ein kurzes Banner? (b) „Checkout-Quote“ im Tastatur-Modus zeigt „–“ (nur aus Einzeldarts berechenbar) – stattdessen „Checkouts / Legs“? (c) Liga-Karte vor dem Spieltag: Hinweis „GAME ON erscheint am Spieltag“ gewünscht? Dazu: Tastenfeld am iPad – kommen die Tipps jetzt beim ersten Mal an? · von:Julius · am:2026-11-08

- [ ] DRT-002 Backup prüfen: auf dem Server `crontab -l` ansehen (läuft `/opt/dart-turnier/backup.sh` täglich 04:30?) und einmal einen Restore nach DEPLOY.md „Backup“ üben · prio:hoch · von:Audit H7/S-M6 · am:2026-11-08
- [ ] DRT-004 Brevo-Schlüssel aus dem Sitzungs-Transkript schwärzen (Befehl steht im Chat vom 08.11.); Erneuern bei Brevo hast du bewusst nicht gewollt · am:2026-11-08
- [ ] DRT-017 iPhone: App einmal vom Home-Bildschirm löschen und neu hinzufügen, damit die Statusleiste ohne Glas-Blur kommt (Meta-Tag ist raus, iOS liest das nur beim Hinzufügen) · prio:hoch · von:Julius · am:2026-11-08

## Offen

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

- [x] DRT-001 Audit 08.11.2026 umsetzen: alle freigegebenen Befunde (Pakete A–F; S3-Erlaubtliste auf Julius' Wunsch wieder raus) · prio:hoch · von:Julius · am:2026-11-08 · fertig:2026-11-08 · quelle:audit-2026-11-08/
- [x] DRT-018 Handy-Block 2: Session-Modus Solo-X01, Solo-Tastatur-Modus mit Statistik, Fernsteuerung hoch als Zeilen, Abstände Punkte-Modus hoch, GAME ON nur am Spieltag, Logo-Abstand oben in der installierten App · prio:hoch · von:Julius · am:2026-11-08 · fertig:2026-11-08
- [x] DRT-019 Tastenfeld: Spieltasten buchen am Touch-Gerät per pointerdown statt click, touch-action none (iPad schluckte Tipps mit rutschendem Finger) · von:Julius · am:2026-11-08 · fertig:2026-11-08
