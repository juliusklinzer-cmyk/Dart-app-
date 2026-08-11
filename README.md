# 🎯 Dart Turnier – 501 Double Out

Schnelle Turnier-App für den Abend mit Freunden: jeder gegen jeden, 501 Double Out,
Finish-Vorschläge und Tabelle. Läuft komplett offline im Browser, ohne Installation,
ohne Account, ohne Server.

## Loslegen

**Am schnellsten:** `index.html` im Browser öffnen (Doppelklick reicht).

**Auf dem Handy als App:** Die Dateien irgendwo hosten (z. B. GitHub Pages:
Repo-Einstellungen → Pages → Branch auswählen), Seite im Handy-Browser öffnen und
„Zum Startbildschirm hinzufügen“. Danach startet sie wie eine native App und
funktioniert auch ohne Internet.

Lokal testen: `npm start` (Server auf http://localhost:8080).

## Ablauf

1. **Setup** – Namen anpassen (Lenas, Tobi, Domi, Julius sind vorbelegt), Startpunkte
   und Legs pro Spiel wählen. Zwischen 2 und 12 Spielern möglich.
2. **Spielplan** – Es wird automatisch „jeder gegen jeden“ ausgelost und auf Runden
   verteilt (4 Spieler = 6 Spiele in 3 Runden).
3. **Bull-Off** – Vor jedem Spiel fragt die App, wer näher am Bull war. Dieser Spieler
   wirft im ersten Leg an, danach wird pro Leg abgewechselt.
4. **Spielen** – Eingabe wie unten beschrieben.
5. **Tabelle** – Sortiert nach Siegen, bei Gleichstand nach Leg-Differenz und dann
   nach Average. Am Ende gibt es einen Siegerbildschirm mit Podium.

## Eingabe

**Punkte-Modus (Standard):** Die geworfene Gesamtpunktzahl der Aufnahme eintippen
(0–180). Ab 19 wird automatisch übernommen, sobald keine weitere Ziffer mehr passen
kann – ein Tap pro Aufnahme weniger. Für 0–18 bestätigt `OK`. Darüber liegt eine
Schnellwahl mit den häufigsten Werten (26, 41, 45, 60, 81, 85, 100, 140, 180).

**Einzel-Dart-Modus:** Schaltet automatisch um, sobald der Rest im Finish-Bereich
liegt (Standard: ab 170, in den Einstellungen auf 100/180/nie änderbar). Dann wird
Dart für Dart eingegeben: Single/Double/Triple wählen, Zahl tippen – plus `25`,
`Bull 50` und `Miss`. Die Zahlen auf den Tasten zeigen direkt den Wert, der gezählt
wird. Umschalten geht jederzeit von Hand über „Punkte / Einzel-Darts“.

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

**Verlauf & Undo:** Unter dem Spielstand stehen die letzten Aufnahmen beider Spieler
(Bust durchgestrichen, Checkout grün). Der ↺-Button oben rechts nimmt Dart für Dart
bzw. Aufnahme für Aufnahme zurück – auch über ein bereits gewonnenes Leg hinweg.

**Tastatur (am Laptop):** Ziffern, `Enter` = OK, `Backspace` = löschen, `z` = Undo.

## Statistik

Pro Spieler: 3-Dart-Average, 180er, 140+, höchstes Finish, bestes Leg (Darts),
Siege/Niederlagen und Leg-Differenz. Alles wird aus den gespeicherten Aufnahmen
berechnet, ein Undo korrigiert die Statistik also automatisch mit.

## Technik

Reines HTML/CSS/JavaScript, kein Build-Schritt, keine Abhängigkeiten zur Laufzeit.
Der Turnierstand liegt in `localStorage` und übersteht Reload und App-Neustart.

| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau aller Screens |
| `css/styles.css` | Styling (Dark, Touch-Ziele ≥ 44 px) |
| `js/checkout.js` | Finish-Solver (Double-Out-Wege für Rest 2–170) |
| `js/app.js` | Turnierlogik, Spiellogik, Rendering, Persistenz |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation als App |
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

Der Test startet einen echten Chromium, spielt ein komplettes Turnier durch und prüft
Spielplan, Anwurfwechsel, Bust- und Double-Out-Regeln, Finish-Vorschläge, Undo,
Checkout-Abfrage, Tabelle und Persistenz nach Reload.
