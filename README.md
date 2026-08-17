# 🎯 Dart Turnier – 501 Double Out

Schnelle Dart-App für den Abend mit Freunden: 501-Turnier jeder gegen jeden, Cricket
für die ganze Runde und Round the World als Training – mit Finish-Vorschlägen,
dauerhaften Spielerprofilen und Ranglisten. Läuft komplett offline im Browser, ohne
Installation, ohne Account, ohne Server.

## Loslegen

**Am schnellsten:** `index.html` im Browser öffnen (Doppelklick reicht).

**Auf Handy oder iPad als App:** Die Dateien irgendwo hosten (z. B. GitHub Pages:
Repo-Einstellungen → Pages → Branch auswählen), Seite im Browser öffnen und über das
Teilen-Menü „Zum Home-Bildschirm“ hinzufügen. Danach startet sie ohne Browserleiste
wie eine native App und funktioniert auch ohne Internet.

**iPad:** Hoch- und Querformat werden unterstützt. Im Querformat steht der Spielstand
links und das Eingabefeld rechts, sodass nichts gescrollt werden muss und die Tasten
mit dem Daumen erreichbar bleiben; im Hochformat liegt die Eingabe unten. Tasten und
Schrift werden auf Tablets automatisch größer, Doppeltipp-Zoom ist auf Buttons
deaktiviert. Split View funktioniert ebenfalls – bei schmaler Spalte schaltet die App
auf das Handy-Layout um.

Lokal testen: `npm start` (Server auf http://localhost:8080).

**Auf eigener Domain für die ganze Gruppe:** siehe [DEPLOY.md](DEPLOY.md) – Subdomain
mit HTTPS, „Zum Home-Bildschirm“ auf jedem Gerät, Updates per `git pull`.

## Spielmodi

Der Modus wird im Setup gewählt, die Aufstellung gilt für alle drei gleich.

### 501 Turnier (jeder gegen jeden)

Der Hauptmodus, siehe Ablauf und Eingabe unten.

### Cricket

Alle ausgewählten Spieler spielen gleichzeitig an einem Board. Die Zahlen 20, 19, 18,
17, 16, 15 und Bull müssen je dreimal getroffen werden – ein Double zählt zwei
Treffer, ein Triple drei, das einfache Bull einen und das Doppel-Bull zwei. Die
Markierungen stehen wie am Board: `/`, `✕`, `⊗` für zu.

- **Mit Punkten** (Standard): Wer eine Zahl zugemacht hat, sammelt mit weiteren
  Treffern darauf Punkte in Höhe des Feldwerts – aber nur so lange, wie die Zahl bei
  mindestens einem Mitspieler noch offen ist. Gewonnen hat, wer alle sieben Felder zu
  hat **und** dabei mindestens so viele Punkte wie alle anderen hat.
- **Ohne Punkte**: Wer zuerst alle sieben Felder zumacht, gewinnt.

Reihum drei Darts, jeder Dart einzeln eingegeben; der ↺-Button nimmt Dart für Dart
zurück.

### Round the World (Training)

Reihum von der 1 hoch bis zur 20 und zum Schluss Bull. Getroffen wird immer nur die
eigene aktuelle Zahl:

- **Single** – ein Feld weiter
- **Double** – eine Zahl wird übersprungen
- **Triple** – zwei Zahlen werden übersprungen

Wer über die 20 hinausspringt, landet auf Bull. Mit dem Bull-Treffer ist die eigene
Aufnahme beendet, die angefangene Runde wird aber zu Ende gespielt – so ist der
spätere Startplatz nicht benachteiligt. Es gewinnt, wer den Bull mit den wenigsten
Darts getroffen hat, bei Gleichstand der frühere Treffer.
Jeder Spieler hat seinen eigenen Fortschritt, die Anzeige zeigt Ziel, Darts und
Treffer.

Die Eingabe zeigt immer nur die Zahl, die gerade dran ist – als vier große Tasten
(Single, Double, Triple, Miss), jeweils mit dem Hinweis, wohin der Treffer führt
(„weiter auf 7"). Nach jedem Dart springt die Anzeige auf die neue Zahl, nach drei
Darts auf den nächsten Spieler. Auf Bull bleiben nur noch „Bull" und „Miss".

## Ablauf (501 Turnier)

1. **Setup** – Antippen, wer heute mitspielt (2 bis 12 Spieler), Startpunkte und Legs
   pro Spiel wählen. Spieler sind dauerhafte Profile mit Foto, siehe unten.
2. **Spielplan** – Es wird automatisch „jeder gegen jeden“ ausgelost und auf Runden
   verteilt (4 Spieler = 6 Spiele in 3 Runden).
3. **Bull-Off** – Vor jedem Spiel fragt die App, wer näher am Bull war. Dieser Spieler
   wirft im ersten Leg an, danach wird pro Leg abgewechselt.
4. **Spielen** – Eingabe wie unten beschrieben.
5. **Tabelle** – Sortiert nach Siegen, bei Gleichstand nach Leg-Differenz und dann
   nach Average. Sind alle drei Werte gleich, weist der Siegerbildschirm einen
   geteilten Sieg aus.
6. **Nachzügler und Frühgeher** – „Spieler nachtragen oder abmelden" auf der
   Turnierseite ergänzt einen Spieler samt Spielen gegen alle bisherigen Teilnehmer
   oder streicht die offenen Spiele eines Abgemeldeten. Gespielte Ergebnisse bleiben
   in jedem Fall erhalten.

## Eingabe

**Punkte-Modus (Standard):** Die geworfene Gesamtpunktzahl der Aufnahme eintippen
(0–180). Ab 19 wird automatisch übernommen, sobald keine weitere Ziffer mehr passen
kann – ein Tap pro Aufnahme weniger. Für 0–18 bestätigt `OK`. Darüber liegt eine
Schnellwahl mit den häufigsten Werten (26, 41, 45, 60, 81, 85, 100, 140, 180).

**Einzel-Dart-Modus:** Schaltet automatisch um, sobald der Rest im Finish-Bereich
liegt (Standard: ab 170, in den Einstellungen auf 100/180/nie änderbar). Dann wird
Dart für Dart eingegeben: Single/Double/Triple wählen, Zahl tippen – plus `25`,
`Bull 50` und `Miss`. Die Tasten behalten dabei die Feldzahl (18 bleibt 18) und
bekommen ein kleines D bzw. T davor, damit das Zielfeld erkennbar bleibt. Umschalten
geht jederzeit von Hand über „Punkte / Einzel-Darts“.

**Finish-Vorschlag:** Über der Eingabe steht immer der sinnvollste Weg zum Double-Out
für den aktuellen Rest – und zwar passend zu den *noch verfügbaren* Darts der
Aufnahme (nach einem Dart also der beste 2-Dart-Weg). Der nächste Zielwurf ist grün
markiert, im Einzel-Dart-Modus ist die passende Zahl zusätzlich umrandet.

**Regeln, die die App durchsetzt:**
- Double Out: Wer mit einem Single/Triple auf 0 kommt, hat überworfen.
- Bust bei Rest unter 0 oder Rest 1 – der Stand vor der Aufnahme bleibt stehen.
- Bei Eingabe der Gesamtpunktzahl fragt die App bei einem Finish nach, mit wie vielen
  Darts ausgecheckt wurde (nur die tatsächlich möglichen Anzahlen stehen zur Wahl),
  damit der Average stimmt.
- Mit 3 Darts unmögliche Summen (179, 178, 176, 175, 173, 172, 169, 166, 163) werden
  abgelehnt.

**Verlauf, Undo & Korrektur:** Unter dem Spielstand stehen die letzten Aufnahmen
beider Spieler (Bust durchgestrichen mit Grund, Checkout grün). Der ↺-Button oben
rechts nimmt Dart für Dart bzw. Aufnahme für Aufnahme zurück – auch über ein bereits
gewonnenes Leg hinweg. Fällt ein Tippfehler erst später auf, genügt ein Tipp auf die
betroffene Zeile: Der Wert lässt sich direkt korrigieren, solange das Leg damit
schlüssig bleibt.

**Tastatur (am Laptop):** Ziffern, `Enter` = OK, `Backspace` = löschen, `z` = Undo.

## Spielabschluss

Ist ein Spiel entschieden, kommt zuerst der Glückwunsch für den Sieger und danach eine
eigene **Spielstatistik** – für genau dieses Spiel, bevor es weitergeht:

- **501**: Ergebnis in Legs, je Spieler 3-Dart-Average, First 9, beste Aufnahme,
  180/140+/100+, höchstes Finish, Doppelquote mit Treffern/Versuchen, bestes Leg und
  geworfene Darts, dazu jedes Leg einzeln mit Sieger, Darts und Average.
- **Cricket**: MPR, Marken, Punkte, geschlossene Felder und Darts je Spieler.
- **Round the World**: erreichte Zahl, Darts, Treffer und Trefferquote je Spieler.

Von dort geht es direkt weiter zum nächsten Spiel bzw. zur Turnierauswertung, oder das
Trainingsspiel wird gespeichert. Dieselbe Auswertung lässt sich später jederzeit über
den Spielverlauf in der Rangliste wieder öffnen.

## Spielerprofile

Spieler sind dauerhaft: Name und Foto werden einmal angelegt und gelten für jedes
weitere Turnier. Das Foto kommt aus der Fotomediathek oder direkt von der Kamera und
wird auf 220 × 220 Pixel zugeschnitten, damit der Speicher nicht vollläuft; ohne Foto
zeigt die App die Initialen auf einer aus dem Namen abgeleiteten Farbe.

Wer nicht mehr mitspielt, lässt sich **ausblenden** statt löschen — dann verschwindet
er aus der Aufstellung, seine Ergebnisse bleiben aber in Statistik, Ranglisten und
Spielverlauf erhalten.

## Statistik und Ranglisten

Jedes gespielte Spiel wird vollständig gespeichert — mit allen Aufnahmen und, im
Einzel-Dart-Modus, jedem einzelnen Dart. Sämtliche Werte werden daraus neu berechnet,
ein Undo korrigiert also auch die Karrierewerte.

**Im Spielerprofil** (Reiter „Spieler"):

| Bereich | Werte |
|---|---|
| Scoring | 3-Dart-Average, First-9-Average, höchste Aufnahme, 180er, 140–179, 100–139, 60–99, Aufnahmen, geworfene Darts |
| Finishing | Doppelquote, Doppelversuche, Checkouts, höchstes Finish, Finishes ab 100, bestes Leg, Ø Darts je gewonnenem Leg |
| Bilanz | Spiele, Siege/Niederlagen, Siegquote, Legs, Turniere, Turniersiege, Form der letzten Spiele |

Dazu die letzten Spiele mit Gegner, Ergebnis und Datum.

Für Cricket kommt die **MPR** (Marks per Round – getroffene Marken je 3 Darts, das
übliche Cricket-Maß) samt Siegen dazu, für Round the World die Bestleistung in Darts
und die Siege.

**Im Reiter „Rangliste"** sind die Werte nach Spielmodus getrennt – Classic, Cricket
und Round the World haben je eigene Bestenlisten, eigene Rekordtafel und einen eigenen
Spielverlauf:

| Modus | Bestenlisten |
|---|---|
| Classic (301/501) | Average, First 9, Doppelquote, höchstes Finish, 180er, höchste Aufnahme, bestes Leg, 100+ Aufnahmen, Siege, Siegquote, Legs, Turniersiege |
| Cricket | MPR, Siege |
| Round the World | Bestes Ergebnis (Darts), Siege |

Über den Listen zeichnet ein **Verlaufsdiagramm** die Entwicklung über die letzten bis
zu 40 Spiele – eine Linie je Spieler in seiner Farbe, links die Skala, unten die
Spiele. Bei Classic ist es der 3-Dart-Average je Spiel, bei Cricket die MPR je Spiel.
Jeder Spieler hat eine feste Farbe, die auch sein Avatar trägt.

**Die Modi werden strikt getrennt gerechnet.** Average, First 9, Doppelquote, Finishes,
180er und die gesamte 501-Bilanz stammen ausschließlich aus Classic-Spielen (301/501).
Ein Round-the-World-Training, in dem reihum 1, 2 und 3 geworfen werden, taucht dort
also nirgends auf – es zählt nur in die eigene RTW-Auswertung. Genauso fließen
Cricket-Würfe nur in MPR, Marken und Cricket-Siege.

Zwei Definitionen, damit die Zahlen einordbar sind:

- **First-9-Average**: Average der ersten drei Aufnahmen eines Legs, das übliche Maß
  für den Scoring-Antritt.
- **Doppelquote**: getroffene Finishes je Dart, der auf ein *mögliches* Doppel geworfen
  wurde (Rest gerade und ≤ 40 oder genau 50). Gezählt wird ausschließlich, was
  dartgenau erfasst ist – also der Einzel-Dart-Modus, in den die App im Finish-Bereich
  automatisch umschaltet. Aufnahmen, die als Gesamtpunktzahl eingetippt wurden,
  bleiben außen vor: Wie viele der drei Darts dort auf einem Doppel lagen, weiß die
  App nicht, und eine Schätzung würde die Quote vom Eingabeweg abhängig machen statt
  von der Leistung.

Damit Zufallswerte die Listen nicht verzerren, erscheinen Spieler in den
Durchschnitts-Ranglisten erst ab 9 geworfenen Darts bzw. 3 Doppelversuchen.

Ein Turnier wandert per **„Turnier abschließen"** ins Archiv (die letzten 200 bleiben
gespeichert); abgebrochene Turniere behalten ihre bereits gespielten Spiele in der
Statistik.

## Technik

Reines HTML/CSS/JavaScript, kein Build-Schritt, keine Abhängigkeiten zur Laufzeit.
Profile, laufendes Turnier und Archiv liegen in `localStorage` und überstehen Reload
und App-Neustart. Ältere Stände werden beim Laden automatisch auf das aktuelle
Datenmodell gehoben.

| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau aller Screens |
| `css/styles.css` | Styling (Dark, Touch-Ziele ≥ 44 px) |
| `js/checkout.js` | Finish-Solver (Double-Out-Wege für Rest 2–170) |
| `js/app.js` | Turnier-, Cricket- und RTW-Logik, Statistik, Rendering, Persistenz |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation als App |
| `build-single.mjs` | baut `dart-turnier.html` – alles in einer Datei (`npm run build`) |
| `tests/e2e.mjs` | Browser-Tests des kompletten Turnierablaufs |

Der Finish-Solver sucht zuerst den Weg mit den wenigsten Darts und bewertet danach die
Wurfqualität (T20/T19 zuerst, gute Schluss-Doppel wie D20/D16/D12, D2 und Bull nur wenn
nötig). Die Ergebnisse entsprechen der gängigen Checkout-Tabelle, z. B. 170 → T20 T20
Bull, 141 → T20 T19 D12, 121 → T20 T15 D8, 99 → T20 19 D10.

## Tests

```bash
npm install   # einmalig, lädt Playwright
npm test
```

Der Test startet einen echten Chromium, spielt ein komplettes Turnier sowie je eine
Partie Cricket und Round the World durch und prüft Spielplan, Anwurfwechsel, Bust- und
Double-Out-Regeln, Finish-Vorschläge, Undo, Checkout-Abfrage, Tabelle, Cricket-Marken
und -Punkte, die Sprungregeln von Round the World, Karrierewerte, Ranglisten,
Profilverwaltung, Archivierung und Persistenz nach Reload.

`TARGET=dart-turnier.html npm test` prüft dieselben Abläufe im Einzeldatei-Bündel.
