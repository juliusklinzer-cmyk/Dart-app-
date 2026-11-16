# CLAUDE.md — Dart-Turnier-App

Verbindliche Beschreibung der App ist `README.md`.

## Abschluss

Zusatzschritte für den Skill `abschluss`:
- Branch `claude/darts-tournament-app-i87r85`, Remote `origin` (github.com/JuliusKlinzer/Dart-app-).
- Prüfen: `npm test` muss grün sein. Wurden Spiellogik, Solver, Persistenz, Service Worker
  oder Build berührt, läuft zusätzlich `kritik-reviewer`; Befunde abarbeiten oder bewusst als
  offen benennen.
- Bündel: Nach Änderungen an `index.html`, `css/` oder `js/` `npm run build`, danach
  `TARGET=dart-turnier.html npm test`. `dart-turnier.html` und `build/artifact.html` sind
  eingecheckt und müssen zum Quellstand passen. Neue Assets: in `sw.js` → `ASSETS` eintragen
  und `CACHE` hochzählen.
- Docs: Neuer Spielmodus, neue Regel, neue Datei oder geänderte Bedienung → passenden
  Abschnitt in `README.md` ergänzen.
- Typisch für Julius zu tun: auf dem iPad neu „Zum Home-Bildschirm“ hinzufügen, Seite hart
  neu laden, Testrunde spielen.

## Kritische Prüfpunkte

Für `kritik-reviewer`. Einsetzen vor dem Commit von Änderungen an Spiellogik
(501/Cricket/RTW), Checkout-Solver, Statistik/Rangliste, Persistenz/Migration, Service
Worker oder Single-File-Build.

Kontext: reines HTML/CSS/JavaScript, kein Framework, keine Laufzeit-Abhängigkeiten, läuft
komplett offline. `js/app.js` (Turnier-, Cricket-, RTW-Logik, Statistik, Rendering,
Persistenz), `js/checkout.js` (Finish-Solver), `css/styles.css`, `index.html`, `sw.js` +
`manifest.webmanifest` (Offline), `build-single.mjs` (baut `dart-turnier.html` und
`build/artifact.html`), `tests/e2e.mjs` (Playwright, echter Chromium).

Tests: `npm test`; bei Build-relevanten Änderungen zusätzlich
`npm run build && TARGET=dart-turnier.html npm test`. Fehlerszenarien konkret beschreiben
(„Spieler hat 40 Rest, wirft T20 → …“).

1. **501-Regeln**: Bust-Behandlung (Rest < 0, Rest = 1, Rest 0 ohne Double)
   setzt die Aufnahme vollständig zurück; Double-Out wird erzwungen; die
   Restpunkte nach Bust entsprechen dem Stand VOR der Aufnahme. Anwurfwechsel
   pro Leg und Spielpaarung stimmt.
2. **Cricket**: Marken 20–15 + Bull, Double = 2 / Triple = 3 Treffer, Bull = 1
   und Doppel-Bull = 2. Punkte nur, solange die Zahl bei mindestens einem
   Mitspieler offen ist. Siegbedingung = alle sieben zu UND Punkte ≥ alle
   anderen. Felder, die bei allen zu sind, dürfen nichts mehr bringen und
   müssen ausgegraut sein.
3. **Round the World**: Sprungregeln wie in README beschrieben.
4. **Checkout-Solver** (`js/checkout.js`): deckt Rest 2–170 ab, liefert nie
   einen Weg, der nicht auf einem Double endet, und nie mehr Darts als
   verfügbar. Stichproben gegen die gängige Tabelle: 170 → T20 T20 Bull,
   141 → T20 T19 D12, 121 → T20 T15 D8, 99 → T20 19 D10. Bei
   Solver-Änderungen: mehrere Reste selbst nachrechnen, nicht dem Kommentar
   glauben.
5. **Undo**: macht genau EINEN Schritt rückgängig, über Aufnahmegrenzen und
   Leg-/Spielwechsel hinweg konsistent, und schreibt keine Statistik doppelt.
6. **Persistenz & Migration**: Profile, laufendes Turnier und Archiv liegen in
   `localStorage`. Jede Änderung am Datenmodell braucht eine Migration alter
   Stände. Prüfe aktiv: Lädt ein Stand im ALTEN Format ohne Absturz und ohne
   Datenverlust? Wird eine Versionsnummer mitgeführt?
7. **Statistik/Rangliste**: Average, Karrierewerte und Tabellenplatzierung
   dürfen sich durch Abbruch, Undo oder Archivierung nicht verfälschen. Keine
   Division durch null bei 0 Aufnahmen.
8. **Offline-Konsistenz** — die drei Stellen laufen leicht auseinander:
   - Neue Datei in `js/` oder `css/`? Dann MUSS sie in `sw.js` → `ASSETS` und
     in `build-single.mjs` auftauchen.
   - Geänderte Assets? Dann MUSS `CACHE` in `sw.js` hochgezählt werden, sonst
     bekommen installierte Geräte das Update nie.
   - `build-single.mjs` entfernt die Service-Worker-Registrierung per Regex und
     schneidet `<script src=...>`-Tags heraus — prüfe, ob diese Annahmen nach
     Änderungen an `index.html`/`js/app.js` noch greifen.
9. **Touch/iPad**: Touch-Ziele ≥ 44 px, Hoch- und Querformat, Split View
   (schmale Spalte → Handy-Layout). Kein Doppeltipp-Zoom auf Buttons.
10. **Keine neuen Abhängigkeiten** zur Laufzeit und kein Build-Zwang für den
    Normalbetrieb — `index.html` per Doppelklick muss weiter funktionieren.

## Agents (Prüfer)

Per Symlink in `.claude/agents/`: aus `~/skill-pakete/allgemein/agents/` besucher-tester,
barrierefreiheit-pruefer, performance-pruefer, text-lektor, responsive-pruefer; aus
`~/skill-pakete/webapp/agents/` test-runner, db-migration-pruefer, design-abgleich,
sicherheit-datenschutz; aus `~/skill-pakete/native/agents/` store-release-pruefer.
`kritik-reviewer` ist global. Alle lesen den Steckbrief unten, ermitteln Fehlendes selbst
im Projekt, prüfen nur und ändern nie Code.

## Steckbrief für die Prüfer

| Feld | Wert |
|---|---|
| Marke | „Blink 180 – Dart Turnier“ (Kurzname „Blink 180“) |
| Domain | https://darts.wirtschaftln.de |
| Stack | HTML/CSS/JavaScript ohne Framework: `index.html`, `js/app.js`, `js/checkout.js`, `css/styles.css`, `sw.js` + `manifest.webmanifest` (PWA, offline); Server Node ≥22.13 `server/main.mjs` + `server/api.mjs` |
| Lokal | `npm start` (Port 8080) bzw. `npm run server` (Port 3002); `index.html` geht auch direkt |
| Produktion | LIVE, Docker-Container `darts-app:3002` auf dem Wirtschaftln-Server hinter dessen Caddy; Deploy `bash deploy/deploy.sh` (Tests, Build, Image per SSH, `docker compose up`) |
| Datenbank | SQLite über `node:sqlite` (`server/lib/db.mjs`, `server/data/darts.db`), Migrationen `server/migrations/*.sql`; im Client `localStorage` mit eigener Migrationskette (Datenmodell v3) |
| Native | keine native Hülle, nur PWA |
| Dienste | Brevo-SMTP für Mails, Web Push (VAPID), Liga-Import von steeldart-muenchen.de (`server/lib/liga-import.mjs`) |
| Design | Tokens als CSS-Variablen oben in `css/styles.css` (dazu `css/live.css`, `css/webseite.css`), Schriften Anton, Barlow, Barlow Condensed in `fonts/`; Rot sparsam, „Ausgewählt“ ist weiß |
| Texte | Deutsch, inline in `index.html`, `webseite.html`, `live.html` und `js/*.js` |
| Werkzeuge | `npm test` (Playwright-E2E), `npm run test:alle`, `npm run build`; kein Lint |
| Offene Punkte | `BACKLOG.md` (DRT-…), Audits in `audit-*/` |
