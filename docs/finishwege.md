# Darts Finish-Wege nach Lieblingsdoppel

Checkout-Tabellen für die Checkout Engine (von Julius geliefert, Oktober 2026).
Für jeden Favoriten, den der Spieler in der App wählen kann, steht in
`docs/finishwege/` (je Favorit eine Datei, standard.txt ohne Favorit) jeder Rest von 2 bis 170 mit dem besten Weg bei
3, 2 und 1 Dart in der Hand. Gerechnet für das Referenzprofil „Fortgeschritten“.
Die Spalte „Plan B“ der Originaltabellen (neuer Weg nach Single statt Triple)
ist nicht abgelegt: die App rechnet nach jedem Dart ohnehin neu, das ist die
Spalte „2 Darts“ bzw. „1 Dart“ des neuen Rests.

`node tools/finishwege-bauen.mjs` liest die Tabellen, prüft sie (Summe, Doppel
am Ende, Stellwurf-Ziel) und schreibt sie als Daten in `js/checkout.js`.

## 1. Favoriten in der App

| Favorit | Pfad | Stufe | Wege auf dem Favoriten | Pfadqualität |
|---|---|---|---:|---:|
| D16 | D16 → D8 → D4 → D2 → D1 | Sehr stark | 50 | 32: 58 % |
| D20 | D20 → D10 → D5 | Sehr stark | 68 | 40: 58 % |
| D18 | D18 → D9 | Sehr stark | 59 | 36: 55 % |
| D12 | D12 → D6 → D3 | Stark | 34 | 24: 58 % |
| D8 | D8 → D4 → D2 → D1 | Stark | 23 | 16: 57 % |
| D10 | D10 → D5 | Stark | 22 | 20: 55 % |
| D14 | D14 → D7 | Situativ gut | 41 | 28: 55 % |
| D6 | D6 → D3 | Situativ gut | 8 | 12: 54 % |
| D4 | D4 → D2 → D1 | Situativ gut | 20 | 8: 57 % |
| Kein Favorit | Standardwege | | | |

- Wege auf dem Favoriten: bei so vielen Restzahlen (2 bis 170) endet der
  3-Dart-Weg auf diesem Doppel, wenn es als Favorit gewählt ist.
- Pfadqualität: Checkout-Chance mit 3 Darts ab der Startzahl des Pfads, ohne
  Favoriten-Bonus. Sie zeigt, wie gut der Pfad Fehlwürfe nach innen auffängt:
  32 → 16 → 8 bleibt zweimal gerade, 36 → 18 → 9 nur einmal.
- Ungerade Doppel und Bull (D1, D3 … D19, Bull) sind keine wählbaren
  Favoriten, weil ein Single-Treffer dort immer eine ungerade Zahl hinterlässt.
  Die Engine nutzt sie trotzdem automatisch, wo sie der beste Weg sind
  (zum Beispiel 38 = D19).

## 2. So entsteht jeder Weg

1. Minimale Dartanzahl (hart). Es gelten nur Wege mit der kleinstmöglichen
   Dartzahl ohne Bull. Bull als letzter Dart kommt zusätzlich als Kandidat in
   Frage, wenn er einen Dart spart (50, 101, 104, 107, 110) oder der einzige
   Weg ist (161, 164, 167, 170); ob das Modell ihn dann wählt, entscheidet die
   erwartete Aufnahmenzahl (mit drei Darts bleibt es bei 101 beim Weg T19 12
   D16, mit zweien heißt es T17 Bull).
2. Keine Bogey-Zahl (hart). Der Hauptweg landet nie auf einem Rest ohne
   Finish. Ein Triple, dessen Single-Fehlwurf mit den restlichen 2 Darts keinen
   Finish mehr zulässt, bekommt zusätzlich einen Malus.
3. Lieblingsdoppel. Im Modell trifft der Spieler seinen Favoriten deutlich
   öfter (32 % statt 25 %). Liegt ein Weg auf den Favoriten höchstens 0,02
   Aufnahmen hinter dem rechnerisch besten, gewinnt er. Präferenz, kein Zwang.
   Beispiele: 80 → T16 D16, 92 → T20 D16, 96 → T20 D18, 99 → T19 10 D16.
4. Doppelpfad, 5. Single statt Triple, 6. Nachbarfelder: stecken im
   Treffermodell. Jeder Wurf streut um den Zielpunkt auf einem Board mit
   Originalmaßen; bewertet werden alle Folgen eines Wurfs über die erwartete
   Zahl an Aufnahmen bis zum Finish.
7. Bull nur, wenn sinnvoll: Bull oder 25 als Ziel nur, wenn es mindestens
   0,02 Aufnahmen besser ist als der beste Weg ohne Bull, oder wenn es keinen
   anderen Weg gibt.
8. Neuberechnung nach jedem Dart. Die Spalten „2 Darts“ und „1 Dart“ sind die
   neu gerechneten Wege für den aktuellen Rest.

Zwei Gleichstandsregeln halten die Tabellen nah an gewohnten Finish-Tabellen:
ist der Standardweg praktisch gleich gut (höchstens 0,01 Aufnahmen schlechter),
bleibt er stehen; Finishes ab 100 beginnen mit T20 oder T19, außer ein anderes
Triple ist klar besser.

Beispiel 84: Bull D17. Der Bull-Bereich (25 plus Bull) ist etwa dreimal so groß
wie ein Triple-Feld. Bull lässt 34 (D17), die deutlich wahrscheinlichere 25
lässt 59 (19 D20). Beide Folgezustände sind gut, deshalb schlägt das Zentrum
hier T20 D12.

## 3. Lesehilfe

- T20 Triple 20 · D16 Doppel 16 · 19 Single 19 · 25 Single Bull · Bull 50
  (zählt als Doppel)
- „→ 32“ am Ende eines Wegs: kein Finish mehr möglich, der Weg stellt für die
  nächste Aufnahme Rest 32 (Stellwurf).
- 3 Darts / 2 Darts / 1 Dart: bester Weg, wenn der Spieler noch so viele Darts
  in der Hand hat.

## 4. Bogey-Zahlen

| Darts in der Hand | Kein Finish möglich |
|---|---|
| 3 | 159, 162, 163, 165, 166, 168, 169 und alles über 170 |
| 2 | 99, 102, 103, 105, 106, 108, 109 und alles über 110 |
| 1 | alles außer geraden Zahlen bis 40 und der 50 |

## 5. Treffermodell und Skill-Level

Die Tabellen gelten für „Fortgeschritten“ (Streuung 12 mm: Triple 21 %,
Doppel 25 %, Bull 13 %, 25er-Ring 45 %). Weitere Modellwerte: Lieblingsdoppel
mit 20 % weniger Streuung, Favoriten-Fenster 0,02 Aufnahmen, Standard-Fenster
0,01, Bull-Schwelle 0,02, Malus für Bogey nach Single 0,01. Boardmaße nach
Regelwerk: Bull 6,35 mm, 25er-Ring 15,9 mm, Triple 99 bis 107 mm, Doppel 162
bis 170 mm Radius.

## 6. Tabellen

Siehe `docs/finishwege/`: je Favorit eine Datei (d16.txt … d4.txt, standard.txt
ohne Favorit), je Rest eine Zeile `Rest|3 Darts|2 Darts|1 Dart`.
