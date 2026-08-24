---
name: abschluss
description: Session-Abschluss für die Dart-App — Tests laufen lassen, Einzeldatei-Bündel neu bauen, Arbeitsstand committen und zu GitHub hochladen, Julius-Zusammenfassung schreiben. Verwenden am Ende einer Arbeitssession oder wenn Julius "/abschluss" sagt bzw. um Sicherung/Zusammenfassung bittet.
---

# Session-Abschluss

Führe diese Schritte in Reihenfolge aus. Branch ist
`claude/darts-tournament-app-i87r85`, Remote ist `origin`
(github.com/JuliusKlinzer/Dart-app-).

1. **Fremde Änderungen einsammeln**: `git fetch origin` und prüfen, ob der
   Remote-Branch neue Commits hat (Julius pusht gelegentlich über VS Code).
   Falls ja: erst integrieren (rebase), nie überschreiben.
2. **Grün machen**: `npm test` muss durchlaufen. Wenn Spiellogik, Solver,
   Persistenz, Service Worker oder Build berührt wurden, zusätzlich den
   `kritik-reviewer` laufen lassen und seine Befunde abarbeiten oder bewusst
   als offen benennen.
3. **Bündel nachziehen**: Wurde an `index.html`, `css/` oder `js/` gearbeitet,
   dann `npm run build` ausführen, damit `dart-turnier.html` und
   `build/artifact.html` zum Quellstand passen — sie sind eingecheckt und
   laufen sonst auseinander. Danach `TARGET=dart-turnier.html npm test`.
   Neue Assets? Vorher prüfen, ob sie in `sw.js` → `ASSETS` stehen und
   `CACHE` hochgezählt wurde.
4. **Lokalen Stand sichern**: `git status` prüfen. Zusammengehörende
   Änderungen als sinnvolle Commits mit deutschen, für Julius verständlichen
   Botschaften committen (er liest die Historie als Projekt-Tagebuch). Keine
   halbfertigen Experimente committen — lieber benennen, was offen bleibt.
5. **README pflegen**: Neuer Spielmodus, neue Regel, neue Datei oder geänderte
   Bedienung? Dann den passenden Abschnitt in `README.md` ergänzen — die
   README ist die verbindliche Beschreibung der App, nicht nur Deko.
6. **Hochladen**: `git push origin claude/darts-tournament-app-i87r85`.
7. **Zusammenfassung für Julius**: 3-6 Sätze, kein Jargon: Was ist heute
   entstanden, was ist entschieden worden, was ist der nächste Schritt, und
   was muss er ggf. selbst tun (auf dem iPad neu „Zum Home-Bildschirm"
   hinzufügen, Seite hart neu laden, Testrunde spielen).
