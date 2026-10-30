# 🎯 Blink 180 – Dart Turnier

Schnelle Dart-App für den Abend mit der Mannschaft: X01-Turnier jeder gegen jeden,
Cricket für die ganze Runde, Round the World als Training und **Finisher** als
gezieltes Finish-Training – mit Finish-Vorschlägen, dauerhaften Spielerprofilen und
Ranglisten.

Läuft komplett offline im Browser, ohne Installation. Wahlweise ganz ohne Server auf
dem eigenen Gerät – oder mit Anmeldung, dann hat jeder seine eigene Karriere, egal auf
wessen iPad mitgeschrieben wurde (siehe [Anmelden und gemeinsam spielen](#anmelden-und-gemeinsam-spielen)).

## Loslegen

**Am schnellsten:** `index.html` im Browser öffnen (Doppelklick reicht).

**Auf Handy oder iPad als App:** Die Dateien irgendwo hosten (z. B. GitHub Pages:
Repo-Einstellungen → Pages → Branch auswählen), Seite im Browser öffnen und über das
Teilen-Menü „Zum Home-Bildschirm“ hinzufügen. Danach startet sie ohne Browserleiste
wie eine native App und funktioniert auch ohne Internet.

**iPad:** Hoch- und Querformat werden unterstützt. Das X01-Spielbild ist
**Querformat zuerst** gebaut (Entwurf „X01 Redesign“, Oktober 2026): links die
Spieler untereinander (ab drei Spielern im 2×2-Raster), rechts die Eingabe, beides in
voller Höhe – auf dem iPad Pro, dem iPad mini und am Handy quer dieselbe Anordnung,
alle Maße wachsen mit der Höhe des Bildschirms. Hochkant am Handy stehen die Spieler
oben und das Zahlenfeld darunter. Das Spielbild ist **fest im Rahmen** – auf jedem
Format, nichts scrollt aus dem Bild, im Notfall werden die Tasten flacher. Tasten und
Schrift werden auf Tablets automatisch größer, Doppeltipp-Zoom ist auf Buttons
deaktiviert. Split View funktioniert ebenfalls – bei schmaler Spalte schaltet die App
auf das Handy-Layout um.

Lokal testen: `npm start` (Server auf http://localhost:8080).

**Auf eigener Domain für die ganze Gruppe:** siehe [DEPLOY.md](DEPLOY.md) – Subdomain
mit HTTPS, „Zum Home-Bildschirm“ auf jedem Gerät, Updates per `git pull`.

## Spielmodi

Der Modus wird im Setup gewählt, die Aufstellung gilt für alle vier gleich.

**Das Startbild** (Entwurf „Setup Redesign“, zweite Fassung Oktober 2026) ist
aufgeräumt: eine Schrift für Inhalte, kleine graue Überschriften, Flächen ohne
Rahmen, keine Leuchteffekte und keine Statistikzeilen. Oben die Marke, rechts die
Navigation als schlanke Text-Reiter (der aktive mit rotem Strich); darunter drei
Spalten – **Spieler** (zwei Spalten, die Zahl im Kreis ist die Reihenfolge der
Auswahl, also die Wurf-Reihenfolge; „N gewählt“ zählt mit), **Spielart** (nur die
Namen) und rechts die **Einstellungen**: oben der Name der Spielart mit einem
Satz dazu, dann die Zeilen, ganz unten GAME ON (dunkel mit rotem Rand). Ausgewählt
heißt überall dasselbe: weißer Rand bei Spielern und Spielart, hellere Fläche mit
weißem Ring bei Optionen. Angemeldet kommt im Turnier die Zeile **Boards** (1 oder
2 Boards = geteiltes Turnier) dazu, bei den freien Spielen **Spielort** (Lokal /
Online); ohne Konto fehlen beide. **Ton** sind zwei Schalter: Klänge und Feiern.
Am Tablet und am quergedrehten Handy steht das Bild fest im Rahmen, innen scrollen
nur Spielerliste und Einstellungen; am quergedrehten Handy rücken die
Beschriftungen neben die Optionen und werden kurz (Start, Bo3, Std., Mix); hochkant
am Handy steht alles untereinander. Bei X01, Schnellem X01 und Finisher fragt
**„Eingabe“**: *Tastatur* (Sinnbild) startet gleich in der Fernsteuerung
(Board-iPad), *Standard* nimmt immer die Aufnahme als Zahl, *Gemischt* schaltet ab
der gewählten Restpunktzahl auf Einzel-Darts um. Im Spiel lässt sich jederzeit
wechseln. **Kaiwen** und **Hunter** stehen schon in der Spielart-Liste – ihre Regeln
folgen, bis dahin lässt sich dort nichts starten.

Cricket, Round the World, Finisher und das Schnelle X01 gehen auch **allein** –
als Training gegen sich selbst. Allein wird nicht ausgebullt, es geht direkt los,
und der Spielbildschirm zeigt eine große Karte mit Finish-Vorschlag. Nur das
X01-Turnier braucht mindestens zwei Spieler, es ist ja jeder gegen jeden.

### Schnelles X01

Alle ausgewählten Spieler an einem Board, reihum, 501 (oder 301/701) Double Out –
ohne Spielplan. Startpunkte und Einzel-Dart-Grenze teilt es sich mit dem Turnier.
**Legs** wählt man wie im Turnier: **1 Leg**, **Best of 3** oder **Best of 5** –
alle Legs werden gespielt, gewonnen hat, wer die meisten hat (bei Gleichstand ab drei
Spielern geht es weiter, bis einer vorne liegt). Ältere Spiele mit Sätzen aus der
früheren Spieldauer-Einstellung bleiben im Archiv lesbar. Der Anwurf wandert Leg für Leg weiter, der Kopf zählt Satz und
Leg mit, die Spielerfelder zeigen den Stand, und am Ende eines Satzes sagt der Dialog
„Satz an …“. Nach jedem Leg zeigt der Dialog eine **Kurzstatistik des Legs** (Average,
Darts, höchste Aufnahme, Finish je Spieler) direkt über „Nächstes Leg“ – ebenso nach
dem letzten Leg beim Glückwunsch. In der
Statistik zählt das ganze Spiel als ein Sieg, jedes Leg fließt in Average und
Rekorde ein. Die Einstellung bleibt gespeichert, bis sie geändert wird.

### X01 Turnier (jeder gegen jeden)

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

Vor dem Spiel wird wie im Turnier ausgeworfen. Bei zwei Spielern reicht ein Tipp auf
den Anfänger; ab drei Spielern legt der Bull-Wurf die **ganze Reihenfolge** fest –
dafür steht jeder Teilnehmer in einer Zeile und lässt sich mit ▲/▼ verschieben, dann
startet das Spiel mit einem Tipp.

Das Spielbild ist **eine Tafel** (Entwurf „Cricket Redesign“, Oktober 2026, dieselbe
Sprache wie das X01): links die Zahlen 20 bis 15 und Bull, je Spieler eine Spalte –
oben seine Karte mit **Punkten** (ohne Punkte-Modus stattdessen klein der Fortschritt in
Prozent der 21 Marken), **MPR** und den
drei Darts der laufenden Aufnahme (die Aufnahme des Vorgängers bleibt gedimmt in seiner
Karte stehen), darunter die Marken (/, ✕, ⊗; zu = blau leuchtend) –, und **rechts neben
jeder Zeile die Tasten** Single, Double und Triple für genau diese Zahl, in der Bull-Zeile
Bull, Bull ×2 und Miss. Ein Tipp je Dart, kein Umschalten. Oben links öffnet **•••** das
Menü (Spiel verlassen / Weiterspielen), oben rechts nehmen **←** den letzten Dart zurück
und **Bust** beendet die Aufnahme sofort und verbucht die fehlenden Darts als Fehlwürfe –
praktisch, wenn jemand gar nichts getroffen hat. Dazwischen stehen Spielart, Spielerzahl
und die Runde. Eine Zahl, die bei **allen** Spielern zu ist, bringt nichts mehr und wird
auf der Tafel grau, ihre Tasten grau und gestrichelt. Wer vorn liegt, trägt ein kleines
Dreieck an den Punkten. Ab **fünf Spielern** stehen vier Spalten auf der Tafel – wer
gerade geworfen hat, wer am Wurf ist und die zwei nächsten –, die neue Spalte schiebt
von rechts herein, und die Kopfzeile nennt, wer danach kommt.

### Round the World (Training)

Reihum von der 1 hoch bis zur 20 und zum Schluss Bull. Getroffen wird immer nur die
eigene aktuelle Zahl:

- **Single** – ein Feld weiter
- **Double** – eine Zahl wird übersprungen
- **Triple** – zwei Zahlen werden übersprungen

Wer über die 20 hinausspringt, landet auf Bull. Mit dem Bull-Treffer ist die eigene
Aufnahme beendet, die angefangene Runde wird aber zu Ende gespielt – so ist der
spätere Startplatz nicht benachteiligt. Es gewinnt, wer den Bull mit den wenigsten
Darts getroffen hat. Brauchen mehrere gleich wenige Darts, entscheidet ein Stechen:
jeder wirft einen Dart auf den Bull, wer am nächsten dran ist, gewinnt.
Das Spielbild (Entwurf „Round the World“, Oktober 2026, dieselbe Sprache wie Cricket):
links je Spieler eine Zeile mit Avatar, Name, **Laser-Fortschritt** über die 21
Stationen, Darts und Treffern, beim Spieler am Wurf die drei Darts der Aufnahme, und
rechts groß die **Zielzahl**. Rechts oben ••• (Menü: Spiel verlassen / Weiterspielen),
Spielart, Spielerzahl und Runde, darunter **←** (letzter Dart zurück) und **Bust**
(die restlichen Darts der Aufnahme als Fehlwürfe verbuchen).

Auch hier wird vorher der Anwerfer ausgeworfen. Die Eingabe zeigt immer nur die Zahl,
die gerade dran ist: groß und hell umrandet die Zahl selbst, im Boost darunter Double
und Triple, unten Miss – jede Taste mit dem Hinweis, wohin der Treffer führt („dann 7“).
Nach jedem Dart springt die Anzeige auf die neue Zahl, nach drei Darts auf den nächsten
Spieler. Auf Bull bleiben nur noch „Bull“ und „Miss“.

### Finisher (Finish-Training)

Der Modus für genau den Teil, der im echten Spiel am längsten dauert: das Auschecken.

Die App zieht jede Runde eine **Zufallszahl zwischen 6 und 120**. Alle Spieler starten
auf derselben Zahl und spielen sie ganz normal herunter – Double Out, Bust-Regeln wie
im X01. Kein Scoring-Teil, nur Finishen.

- Wer zuerst auscheckt, gewinnt die Runde.
- **Wer in dieser Runde noch nicht dran war, darf gleichziehen.** Eine Runde endet
  erst, wenn alle gleich viele Aufnahmen hatten – der spätere Startplatz ist also
  nicht benachteiligt.
- Checken mehrere in derselben Runde aus, entscheidet ein **Stechen auf Bull**: einmal
  werfen, und wer näher dran war, wird angetippt (messen kann die App das nicht, am
  Board sieht man es sofort).
- Gespielt wird auf 3, 5 oder 10 Punkte.

Der Bildschirm ist der des X01 in Einzel-Darts (Entwurf „Finisher“, Oktober 2026),
ohne Kopfleiste: links die Spielerkarten mit großem Rest, Darts und Aufnahmen, oben
rechts in der Karte die **Laserpillen** (je Zielpunkt eine, jedes Finish zündet eine im
blauen Licht – leuchten alle, ist gewonnen) und darunter die drei Felder der laufenden
Aufnahme (Treffer grün, der nächste Wurf hell umrandet, ohne Finish der Stellwurf mit
„auf …“). Wer durch ist, trägt einen Haken statt einer Zahl. Rechts oben ••• (Menü:
Spiel verlassen / Weiterspielen), Spielerzahl, Zielpunkte und Runde, daneben im
Kasten die **gezogene Zahl** – nach jedem Finish **rollt die neue Zahl** in der Mitte
des Bildes aus und fliegt in ihr Feld; darunter das Einzel-Darts-Feld des X01 mit Double/Triple
als Schalter, Bull, Bull ×2, 1 bis 20, **←** (Dart für Dart zurück – über eine
Rundengrenze hinweg auch eine schon entschiedene Runde samt gezogener Zahl), **0**
und **OK** (füllt die Aufnahme mit Fehlwürfen auf). Unter ••• schaltet **Fernsteuerung**
auf die Board-Anzeige: die Karten in Plakatgröße mit dem Finish-Weg jedes Spielers,
unten die letzten Aufnahmen und eine große Eingabe-Anzeige. Getippt wird wie im X01
die **Aufnahme als Zahl** (85, Enter) – die App trägt die passenden Darts ein und
füllt mit Fehlwürfen auf; wer bustet, bustet; beim Finish fragt sie nach der Dartzahl
(1/2/3). Löschen nimmt Ziffern und dann Darts zurück, **⇄** oben rechts oder Esc
führen zur Eingabe zurück. Checken mehrere in derselben Runde aus, fragt ein Dialog,
wer beim Stechen näher am Bull war.

In der Rangliste zählt der Modus **gewonnene Runden**, **Ø Darts je Finish**, das
schnellste Finish und die höchste weggemachte Zahl.

## Liga-Spielplan

Welche Seite eines Einzels unsere ist, entscheidet im Zweifel die Bogen-Position
(links Heim, rechts Gast) – ein nachgetragener Wechsel, der in der Aufstellung
fehlt, zählt damit richtig und wird in die Aufstellung übernommen (1. Spieltag:
Konradson statt Michi stand sonst auf der falschen Seite, 8:8 statt 7:9).

Der Reiter **Liga** (Entwurf „Liga · Spielplan“, Oktober 2026) trägt denselben
Kopf wie überall: der des Setups (Marke, Navigation als Text-Reiter), darunter
die Liga-Zeile mit Saison und den Reitern Spielplan · Training · Tabelle ·
Statistik · Kasse · Regeln. Die große Spieltag-Karte zeigt alles ohne Scrollen –
„Mannschaft gegen Mannschaft“ ist bewusst klein gehalten, damit mindestens zwei
Reihen Teilnehmer Platz haben (Julius, Oktober 2026). Der Spielplan der Saison
steht fest im Client (`LIGA` in `js/liga-daten.js`, gemeinsam mit der Webseite). **Links groß der nächste Spieltag**
(oder der angetippte): Datum, Spieltag, Heim/Auswärts, 20:00 Uhr, Lokal mit Pin,
oben rechts Route in Maps und „in den Kalender“, darunter Heim gegen Gast mit Logo
bzw. Team-Kürzel, dann **Team · n / 4** mit allen, die zugesagt haben, und unten
„Ich bin dabei“ / „Bin raus“ neben **GAME ON!** (startet das Ligaspiel). Die
Zusagen färben die Karte: unter 4 rot, genau 4 gelb, ab 5 grün. **Läuft das
Ligaspiel**, wird die Karte zum LIVE-Schild mit Punktestand, Legs, „Zum Ligaspiel“
und „Live zuschauen“ (Ticker). Gespielte Spieltage zeigen Ergebnis, „Ergebnisse“
und „Spielbericht“. **Rechts alle Spieltage** kompakt: Nummer, Datum, Gegner, Lokal,
rechts das Ergebnis (gespielt), die Zusagen (2 / 4) oder LIVE; ein Tipp zeigt den
Spieltag links groß, Spielfrei-Runden gedimmt. **„Alle in den Kalender“** lädt alle
Termine als iCal-Datei (ganztägig). Die Zusagen liegen auf dem Server und sind für
alle gleich; ohne Server bleibt der Spielplan lesbar, nur das Eintragen entfällt.
Am Tablet steht das Bild fest im Rahmen, die Liste scrollt innen; am Handy quer
bleibt nur die große Karte. Die übrigen Reiter folgen demselben Aufbau (links groß,
rechts die Liste, am Handy untereinander): **Training** zeigt links DiensDarts
(nächster Dienstag, Bar Sehnsucht mit Maps und Kalender, Abstimmung „Bin dabei /
Unsicher / Kann nicht“ und wer kommt) und rechts das Übungs-Ligaspiel mit Vorwahl
„Zweites eigenes Team“ oder „Gegen Bots“ samt Bot-Stärke. **Tabelle** zeigt links die
Ligatabelle, rechts groß unseren Platz mit Punkten, Legs und Abstand zur Spitze. **Statistik** ist die Liga-Auswertung (dieselben Kategorien und
das Spieltag-Log wie früher der Liga-Knopf der Rangliste, nur über Ligaspiele
gerechnet) mit der Team-Auswahl als Chips oben und rechts den **Highlights der
Saison** (180er, High-Finishes ab 100, Shortlegs bis 21 Darts, je mit Spieltag und
Einzel) – in der Rangliste gibt es den Liga-Knopf nicht mehr. **Kasse** zeigt links
den Kassenstand (Anfang, Einnahmen, Ausgaben) und „Buchung erfassen“, rechts das
Kassenbuch und die Gründungsbeiträge als Chips. **Regeln** stehen in zwei Spalten
(FAQ für Neue, Udos Regelecke) als aufklappbare Karten.
Der Reiter **Tabelle** rechnet die Ligatabelle aus den Ergebnissen aller Spieltage
(`LIGA_SPIELTAGE` in `js/liga-daten.js`, `LIGA_DATEN.tabelleAus`): Sieg 2 Punkte,
Unentschieden 1, Reihenfolge nach Punkten, Leg-Differenz, Einzel-Differenz, Name.
Alle neun Teams stehen drin, auch ohne Spiel. Die Webseite rechnet dieselbe Tabelle.
Nichts wird mehr von Hand gepflegt; der alte Server-Stand (`PUT /api/liga/tabelle`)
bleibt ungenutzt.

**Alle Spiele des Spieltags:** Im Reiter **Tabelle** stehen rechts neben der
Ligatabelle (Karte „Alle Spiele“) je Spieltag die Paarungen aller Teams mit Ergebnis (Einzel, dahinter Legs),
Spielfrei gedimmt, Verschobenes mit neuem Datum; in der Spieltage-Liste führt
„Alle Spiele ›“ in einer gespielten Zeile zum selben Überblick als Dialog. Unsere
Spieltag-Karte bleibt frei davon (Julius). Unser eigenes Spiel ist umrandet und
führt zu den Ergebnissen. Ein Tipp auf ein fremdes Spiel öffnet die
16 Einzel wie auf dem Spielberichtsbogen (Gastspieler gekennzeichnet, Sieger
hervorgehoben) samt Highlights. Gezeigt werden die Spieltage mit Ergebnis und der
nächste; „Alle 18 Spieltage zeigen“ klappt den Rest auf.

**Daten der Ligaleitung:** Spielplan, Ergebnisse, alle Spielberichte (16 Einzel,
Highlights) und die Mannschaftsseiten (Lokal, Adresse, Spielerliste) kommen von
steeldart-muenchen.de. `node tools/liga-import.mjs` holt sie und schreibt
`js/liga-sdm.js` (`window.LIGA_SDM`); mit `--pruefen` rechnet das Skript Tabelle und
Einzelrangliste nach und vergleicht Zeile für Zeile mit der Webseite (`npm run liga`).
`js/liga-daten.js` mischt dazu, was die Webseite nicht weiß (`LIGA_HAND`: unsere
Bogen-Aufstellung H1–H8/G1–G8, notfalls ein Ergebnis vom Papierbogen, bevor es die
Ligaleitung hat) und gleicht unsere Termine mit dem Spielplan ab (Verlegungen).
Nach jedem Spieltag: Import laufen lassen, Bündel bauen, `CACHE` in `sw.js` hochzählen.

Im Reiter **Tabelle** stehen darunter die **Einzelrangliste** der ganzen Liga
(alle Spieler aller Teams, Schlüssel der Ligaleitung: Sieger 2 Punkte plus
Leg-Differenz, also 2:0 = 4 und 2:1 = 3, Verlierer seine gewonnenen Legs; Reihenfolge
Punkte, Spiel-Differenz, Leg-Differenz; gleiche Werte = gleicher Platz; erst 15,
dann alle; unsere Leute hervorgehoben, Gäste markiert) und die **Highlights** der
Liga (180er je Spieler, kürzeste Legs, höchste Finishes). Ein Tipp auf ein Team in
der Ligatabelle öffnet Lokal mit Adresse, Spielerliste (TC = Team-Captain) und alle
Spiele des Teams; gespielte führen zu den 16 Einzeln. Liegt unser eigenes Spiel bei
der Ligaleitung vor, bietet die Spieltag-Karte „Spielbericht übernehmen“ von selbst an.

**Mails und Push aus der App (Benachrichtigungen):** Der Server verschickt Mails über
Brevo (SMTP-Relay mit STARTTLS, eigener kleiner Client in `server/lib/mail.mjs`, keine
Abhängigkeit) und Push-Mitteilungen per Web Push (VAPID und aes128gcm selbst gerechnet in
`server/lib/push.mjs`; der Service Worker zeigt sie an, ein Tipp öffnet die App). Zwei
Mail-Absender: **blink180@wirtschaftln.de** für alles rund um die Liga und
**dart@wirtschaftln.de** für Allgemeines. Zugangsdaten und Schlüssel nur in der `.env` auf
dem Server (`BREVO_SMTP_USER`, `BREVO_SMTP_KEY`, `DARTS_VAPID_PUBLIC`,
`DARTS_VAPID_PRIVATE` aus `node server/scripts/vapid.mjs`; siehe `deploy/env.example`).
Ohne sie bleibt der Server stumm, die App zeigt es im Dialog an.

Jede Mail geht als Text **und** als HTML im Look der App raus (multipart/alternative):
schwarze Karte mit rotem Balken, Logo und Wortmarke, Kicker in Rot (das Thema), Titel in
Anton, heller Knopf („Jetzt abstimmen“, „Zum Live-Ticker“ …). Nichts wird doppelt gepflegt:
`textZuHtml()` in `server/lib/mail.mjs` baut das HTML aus dem Text – Leerzeile = Absatz, ein
Absatz, dessen erste Zeile mit „:“ endet, wird zur Liste mit Überschrift, zwei Leerzeichen in
einer Listenzeile trennen Name (links) und Ergebnis (rechts, fett), Links werden anklickbar.
Der Text bleibt die Wahrheit und reicht jedem Leser, der HTML abschaltet.

Die **Mitteilungszentrale** (`server/lib/mitteilungen.mjs`) verteilt elf Themen, jedes je
Konto als **Push + Mail, nur Push oder aus** (Profil → Konto → **Benachrichtigungen**; dort
auch „Push auf diesem Gerät einschalten“ – am iPhone nur in der installierten App – und
„Alle Beispiele an mich senden“). Voreinstellungen: Zusage zum Spieltag fehlt (7 und 2
Tage vorher) und DiensDarts-Umfrage fehlt (3 Tage vorher, Samstag; Gast-Konten dabei):
Push + Mail. Unser Ligaergebnis (beim Abschluss des Ligaspiels: Endstand, alle Einzel,
Man of the Day, Highlights): Push + Mail. Spieltag morgen (an die Zugesagten, mit
Aufstellung), Tabelle nach komplettem Spieltag der Ligaleitung, neuer Teamrekord
(höchstes Finish, höchste Aufnahme, kürzestes Leg – erkannt auf dem Gerät, das das
Ligaspiel abschließt), Anpfiff mit Ticker-Link, Kasse (Buchung auf dein Konto) und
Spielbericht noch nicht verschickt (nur an den Auslöser): nur Push. Konto und Sicherheit
(Passwort geändert, Anmeldung nach über 30 Tagen Pause): immer per Mail. Neues Mitglied:
aus. Jede Mitteilung geht je Konto nur einmal raus (`mitteilung_log`), auch wenn zwei
iPads dasselbe melden; die Jobs laufen alle 30 Minuten (`handleApi.erinnerungen`), die
Termine kommen aus `js/liga-daten.js` (`server/lib/liga.mjs`). Ereignisse aus der App:
`POST /api/mitteilungen/ereignis`. Tests: `npm run test:mail`, `npm run test:mitteilungen`.

Der Reiter **Training** ist das Dienstagszuhause: **DiensDarts** – Dart-Training
jeden Dienstag in der Bar Sehnsucht (mit Logo). Eine Umfrage fragt je Termin
**Bin dabei / Unsicher / Kann nicht** ab (serverweit, mit Bild und Namen aller,
die kommen). Darunter startet das **Übungs-Ligaspiel**: der komplette
Liga-Ablauf – 16 Einzel in Bogen-Reihenfolge, zwei Scheiben, Team-Stand,
Spielbericht – gegen ein zweites eigenes Team **oder gegen Bots** in drei
Stärken (leicht ≈ 38er-Aufnahmen, mittel ≈ 52, schwer ≈ 72; Bots stellen sich
auf Doppel, busten nie und werfen nach kurzer Denkpause von selbst – und nur
im Übungsspiel, nirgendwo sonst). Übungsspiele zählen in **keine** Wertung,
weder Liga noch Classic – Siege gegen leichte Bots wären sonst farmbar; die
Bots sind versteckte Gastprofile und erscheinen in keiner Aufstellung oder
Rangliste. Im Training darf der Löwe übrigens brüllen – nur das echte
Ligaspiel bleibt feierfrei.

Der Reiter **Kasse** ist das **Kassenbuch des Vereins**, aufgebaut wie die
Excel-Vorlage der Kassenwartin: Kassenjahr, Kassenwart/in und Anfangsbestand im
Kopf, darunter der Kassenstand mit Summe Einnahmen und Ausgaben, dann jede Buchung
mit Nr., Datum, Beschreibung, Kategorie (die Kategorienliste der Vorlage: Mitglieds-
beiträge, Startgelder, Spenden, Sponsoring, Sonstige Einnahmen bzw. Turnierkosten,
Ausrüstung/Dartpfeile, Getränke/Verpflegung, Raummiete, Verbandsgebühren, Sonstige
Ausgaben), Betrag und laufendem Saldo, unten die Summen und der Endbestand.
**Jeder Angemeldete trägt Einzahlungen und Ausgaben direkt ein** – sie stehen sofort
im Kassenbuch, eigene Buchungen darf man wieder löschen. **Der Kassenwart** (Rolle
auf dem Server, siehe DEPLOY.md) **verwaltet alles**: jede Buchung ändern (✎) oder
löschen, Kassenjahr und Anfangsbestand einstellen, Beiträge für andere buchen. Für
alle steht der Knopf **„Per PayPal ins Vereinskonto einzahlen“** (der PayPal-Pool
des Vereins) da. Die Liste **Gründungsbeitrag** zeigt je Mitglied, ob der Beitrag
(50 €) bezahlt ist (Gast-Konten zahlen keinen Beitrag und fehlen in der Liste); „Ich habe eingezahlt“ bzw. beim Kassenwart „Bezahlt“ bucht ihn
mit Datum als Mitgliedsbeitrag (`/api/kasse`).

## Ligaspiel (SDM-Spielberichtsbogen)

Von jedem Spieltag im Liga-Reiter lässt sich mit **„Ligaspiel starten"** der
Spielabend nach SDM-Spielberichtsbogen aufsetzen: unsere vier **Positionen**
(vorbelegt mit den Zusagen des Termins), die vier Gegner als Namen (sie werden
Gäste dieses Geräts und beim nächsten Aufeinandertreffen wiedererkannt), Best
of 3 oder 5, **Finish-Anzeigen an oder aus** (aus ist Liga-konform, WDF 3.08) –
und auf Wunsch **geteilt an zwei Scheiben**, wie es die SWO ohnehin verlangt.
Der Spielplan sind die **16 Einzel in vier Durchgängen, exakt in der
Reihenfolge des Spielberichtsbogens** (`LIGA_EINZEL`); jede Begegnung steht
als **H1 Name – G1 Name** da, und im Liga-Kontext erscheint der
**bürgerliche Name** aus dem Profil statt des Spitznamens (die SWO will keine
Künstlernamen). Jedes Einzel trägt seine Scheibe (S1/S2); je zwei Einzel laufen parallel, und jeder Spieler beider Teams spielt genau 2× an S1 und 2× an S2. Ist der Abend durch, wird der **Spielbericht am iPad unterschrieben**: „Unterschreiben“ öffnet nacheinander je einen ganzen Bildschirm für TC Heim und TC Gast (mit dem Finger, „Nochmal“ löscht), danach die Mailadressen (Ligaleitung vorbelegt, die übrigen werden gemerkt). „Senden“ macht aus dem Bogen – genau wie er auf dem Bildschirm steht, mit allen Handkorrekturen und Unterschriften – ein zweiseitiges A4-PDF und öffnet das Teilen-Menü; die Adressen sind dann schon kopiert und werden in der Mail nur eingefügt. Ohne Teilen-Menü (Computer) wird das PDF heruntergeladen und die Mail mit Empfängern geöffnet. Ist auf dem Server der **Mailversand** eingerichtet (siehe „Mails aus der App“), schickt „Senden“ die Mail mit dem PDF direkt vom Server: Absender blink180@wirtschaftln.de, Kopie ins Blink-Postfach, ohne Teilen-Menü; schlägt das fehl, bleibt der Dialog offen und bietet das Teilen-Menü an. Im **Spielbericht** zeigt jede Einzel-Zeile die echte Bogennummer der Spieler: Wer eingewechselt wurde, steht dort als H5–H8 bzw. G5–G8. Bis zur Unterschrift ist jedes Feld anpassbar (auch die Einzel-Bezeichnung), Nachmeldungen und Proteste werden per Tipp auf „ja“ oder „nein“ angekreuzt. Sobald **beide TCs unterschrieben** haben, ist der Bericht **final**: kein Feld lässt sich mehr ändern, oben steht nur noch „Versenden“. **Abschluss:** Nach dem letzten Einzel wird das Ligaspiel nicht beendet. Es kommen zuerst die **Ergebnisse** mit den Highlights beider Teams und je einem **Man of the Day** (meiste gewonnene Einzel, bei Gleichstand der höhere Average), dann geht es zum Spielbericht. Erst wenn der unterschrieben und verschickt ist (oder „Abschließen ohne Senden“), ist das Ligaspiel abgeschlossen: Es wandert ins Archiv, im Spielplan steht der Spieltag als „Abgeschlossen“ mit Endstand, Ergebnissen und Bericht und lässt sich nicht noch einmal starten. Bis dahin bleibt es komplett offen; auch der Spiel-Tab archiviert es nicht still. Ein Spieltag mit archiviertem, aber noch nicht abgeschlossenem Ligaspiel zeigt „Bericht offen“. Im **geteilten Ligaspiel an zwei iPads** geht der Spielerwechsel als geänderter Spielplan an den Server; das andere iPad übernimmt ihn beim nächsten Abgleich, ein dort laufendes oder fertiges Einzel bleibt unberührt. Fertige Einzel, deren Ergebnis wegen eines Funklochs nicht beim Server ankam, reicht die App bei jedem Abgleich nach. **Nachmeldungen** gehen über „Spieler nachmelden“ im Ligaspiel (oder den Knopf auf Seite 2 des Berichts): Team, Nachname, Vorname, U18 ja/nein und w/m/d, danach unterschreibt die Person mit dem Finger. Sie steht dann mit Unterschrift auf Seite 2, „Nachmeldungen: ja“ ist angekreuzt, und sie gehört zum Team (H5–H8 bzw. G5–G8), einsetzbar über „Spieler wechseln“. Jedes Einzel
**beginnt mit dem Ausbullen** (SWO Punkt 8, Fassung Oktober 2026): der
Gewinner wirft Leg 1 an, danach wechselt der Anwurf. Im Übungs-Ligaspiel gegen
Bots wirft der eigene Spieler ohne Ausbullen an. Die Übersicht zeigt den **Team-Stand** – groß die **Punkte
als Summe der gewonnenen Einzel** (jedes gewonnene Einzel = 1 Punkt, egal ob 2:0 oder 2:1), darunter Einzel und Legs – und die **Highlights** für den Bogen
(180er, High-Finishes ab 100, Shortlegs bis 21 Darts). Die 60er- und
180er-Feiern bleiben im Ligaspiel aus – mitten im Einzel gegen ein fremdes
Team wäre der Löwe fehl am Platz.

Tritt eine Position nicht an (nur drei gemeldet), wertet der **w.o.-Knopf**
am Einzel es **kampflos**: der Anwesende gewinnt 2:0 (bzw. 3:0) mit vollen
Punkten nach Staffel – in der persönlichen Statistik und Rangliste zählt das
Einzel gar nicht (kein Wurf, kein Sieg, keine Niederlage). Über **„ändern"**
lässt sich die Wertung zurücknehmen; im geteilten Spiel wandert sie sofort
auf das andere Gerät und ist dort nicht mehr rückholbar.

**Nur Ergebnisse** (Oktober 2026): Zählt der Gegner mit seinem eigenen System,
wird beim Start unter **Mitschreiben** „nur Ergebnisse“ gewählt. Dann trägt
jedes Einzel in der Übersicht vorn den Knopf **Ergebnis**: ein Tipp, und die
möglichen Leg-Stände stehen als Kacheln da (Bo3: 2:0, 2:1, 1:2, 0:2 – Heim :
Gast wie auf dem Bogen, der Sieger klein darunter). Das Einzel ist damit fertig,
„ändern“ öffnet die Kacheln noch einmal, „Ergebnis zurücknehmen“ macht es wieder
offen (im geteilten Spiel nicht mehr, sobald das andere Gerät es hat). Die Legs
stehen ohne Würfe im Archiv: Siege, Niederlagen und die Leg-Bilanz zählen in
Liga-Statistik und Rangliste, Average, Bestes Leg, Darts je Leg und Highlights
gibt es für solche Einzel nicht (im Verlauf bekommen sie keinen Average-Punkt).
Mitschreiben in der App bleibt daneben möglich („Start“ klein rechts), und
umgekehrt lässt sich in jedem Ligaspiel ein Einzel, das der Gegner gezählt hat,
über **w.o. → „Nur das Ergebnis eintragen“** nachtragen. Bericht, Stand und
Endstand rechnen mit beidem wie immer.

**Nachtragen:** Ein vergangener Spieltag ohne Ligaspiel in der App zeigt auf
seiner Karte eine Statuszeile („Gespielt · Blink 180 10:6 · noch nicht im
Archiv“) mit dem Hinweis, dass erst das Übernehmen Siege in die Statistik und
den Spielbericht bringt – die Zahlen im Spielplan und in der Tabelle kommen ja
nur von der Ligaleitung. Dazu **„Von Hand nachtragen“** – das ist der normale
Start mit „nur Ergebnisse“ vorgewählt – und, sobald die Ligaleitung alle 16
Einzel gemeldet hat (`LIGA_SPIELTAGE` mit `partien`, dazu `aufstellung` für
die Bogen-Listen), **„Spielbericht übernehmen“**: ein Dialog ordnet jedem Bogen-Namen unserer Seite
ein Konto zu (ganzer Name, eindeutiger Vor- oder Nachname werden vorgeschlagen;
wer kein Konto hat, wird über den letzten Eintrag der Liste als dauerhafter Gast
angelegt – in die Liga-Rangliste kommt er erst mit Konto). Der Dialog ist ein
Vollbild wie der Ligaspiel-Start; fehlt eine Zuordnung, nennt die Meldung direkt
über „Übernehmen“ die offenen Namen und markiert ihre Zeilen rot,
die Gegner werden Gäste wie beim Ligaspiel-Start, und mit „Übernehmen“ liegt
das Ligaspiel abgeschlossen im Archiv – 16 Einzel mit Leg-Stand, Positionen,
Scheiben und Bogen-Nummern (G5/G6 für Eingewechselte), Bericht mit
„Nachmeldungen: nein“, angemeldet geht es wie jedes Spiel an den Server. Der
2. Spieltag (Cobblers Irish Pub, 23.10.2026, 10:6 für uns) wurde so
nachgetragen.

**Spielerwechsel** gibt es nach SWO: nur auf derselben Position, höchstens
8 Spieler je Team, der Wechsel greift für alle noch nicht begonnenen Einzel
der Position (im geteilten Spiel derzeit gesperrt). Der **Spielbericht** –
Udos Bogen als Blatt – füllt sich automatisch (Teams, Spieler H1–H8/G1–G8
mit Vor- und Nachname aus dem bürgerlichen Namen, Legs je Einzel – kampflose
mit **w.o.** –, rechts das Ergebnis je Einzel wie auf dem Bogen – 1 : 0 oder 0 : 1 –,
Endergebnis als Summe der Legs und Punkte, Spielzeit, Highlights je Seite), jede
Zelle lässt sich antippen und korrigieren, und **„Drucken"** gibt Seite 1
plus das Nachmelde-/Protest-Leerformular als Seite 2 aus. Nach dem Abschluss
bleibt der Bericht über den Spieltag im Liga-Reiter abrufbar. In der
Liga-Seite gibt es den Reiter **„Statistik"** (Entwurf „Liga“, Oktober 2026):
Team-Auswahl (Blink 180, Gesamte Liga, jeder Gegner), dann wie in der Rangliste
die Bestwert-Karten und die Liste aller Spieler („nur Ligaspiele“) – dieselben
Classic-Kategorien, gerechnet nur über Ligaspiele – und rechts die **Highlights
der Saison** mit Pokal: 180er, High-Finishes ab 100 und Shortlegs bis 21 Darts
als Kacheln zu zweit (Wert, Name, Spieltag und Einzel), dazu das Spieltag-Log. Im Regeln-Reiter der Liga-Seite stehen dazu ein
FAQ für Neue und Udos Regelecke.

Die **Turnier-Übersicht** (Entwurf „Turnier Redesign“, überarbeitet Oktober 2026)
trägt dieselbe Kopfleiste wie das Setup, darunter die Titelzeile mit Format,
Spielerzahl und „N von M gespielt“ sowie „Turnier verlassen“. Links der Spielplan
nach Runden in flachen Zeilen: die nächste Partie ist hell umrandet und hat den
roten „Start“- bzw. „Weiter“-Knopf, offene haben dunkle „Start“-Knöpfe, fertige
treten zurück (Sieger fett, „fertig“). Gestartet wird direkt an der Partie – einen
„Nächstes Spiel“-Knopf gibt es nicht; erst wenn alles gespielt ist, erscheint
„Endstand ansehen“. Rechts oben die Tabelle (Siege weiß leuchtend, 0 gedimmt),
darunter die Turnier-Statistik je Spieler in drei Spalten. Im **Ligaspiel** (Entwurf „Ligaspiel“, Oktober 2026)
heißt die Spielplan-Karte „Spielplan · N von 16 gespielt“, die Zeilen tragen H1 bis
H4 (hell) gegen G1 bis G4 (gedeckt), die Scheibe als Schild, „läuft bei …“ für Partien
am anderen Gerät und einen leisen w.o.-Knopf; rechts steht groß der Punktestand der
Teams mit dem Live-Ticker-Knopf (rotes LIVE-Schild), darunter „Für den Spielbericht“
mit 180ern, High-Finishes und Shortlegs als Zeilen sowie „Spieler nachmelden“ und
„Spielbericht ansehen“ (die Turnier-Statistik entfällt dort). Die vier Dialoge des Ligaspiels sind
breite Bogen nach demselben Entwurf: **Spieler wechseln** (Heim und Gast in zwei
Spalten mit Status „gemeldet“, „Einzel läuft auf S1“ oder „Gast“; dann „Wechsel auf
Position H2“ mit Kacheln aus dem Kader bzw. den schon nachgemeldeten Gästen und der
spontanen Nachmeldung per Vor- und Nachname, die gleich zur Nachmeldung mit
Unterschrift führt: der Spieler steht dann schon auf dem Bogen, das Team liegt fest,
„Wechsel zurücknehmen“ setzt die alte Besetzung wieder ein), **Spieler nachmelden**
(Team, Name, U18, Geschlecht, Platz auf dem Bogen und das Unterschriftsfeld in einem
Bogen; der Dialog geht nur über seine Knöpfe zu, ein Strich neben das Feld oder die
Zurück-Taste wirft nichts weg, und nach einem Neuladen steht er wieder da, solange der
Spontane noch nicht nachgemeldet ist), **Ligaspiel vorzeitig beenden?** (nicht begonnene
Einzel kampflos für den Gegner, offene Einzel entfallen oder Ligaspiel verwerfen; ein
Einzel, das das andere iPad gerade spielt, bleibt unangetastet) und der **Spielbericht** in Kurzfassung (alle Einzel, Summe, Highlights,
„Teilen“ und „Bogen und PDF“ führen zum vollen Bogen).

Der **Sieger-Bildschirm** (Entwurf „Sieger“, Oktober 2026) trägt den Setup-Kopf,
darunter Pokal und „X gewinnt!“. Im Turnier steht das Podest (Zweiter links, Erster
in der Mitte und höher, Dritter rechts, mit Medaille, Siegen, Legs und Average)
neben Endstand und Highlights (180er, High-Finish, Bestes Leg, Höchster Ø); im
Ligaspiel der Punktestand groß und je Team der Man of the Day mit Highlights. Unten
„Zur Übersicht“ und der rote Hauptknopf (Turnier abschließen bzw. Weiter zum
Spielbericht). Am Handy quer entfällt die Endstand-Karte. Spielerwechsel und vorzeitiges Beenden wohnen unten im Spielplan-Kasten.
Am Tablet steht alles fest im Rahmen, der Spielplan scrollt innen; am Handy quer
entfällt die Turnier-Statistik.

Das **Ausbullen** (Entwurf „Ausbullen“, Oktober 2026) ist auf allen Spielarten
gleich: „Zurück“ oben links, Zielscheibe und Titel mittig, rechts oben der
Zusammenhang („Spiel 3 von 6“, „Cricket · 4 Spieler“). Zu zweit stehen zwei große
Karten – antippen, der wirft an (weißer Rahmen, blauer Schein, „wirft an“). Ab drei
Spielern links alle Namen in Wurf-Reihenfolge antippen, rechts füllt sich die
Reihenfolge, ein Tipp rechts nimmt wieder heraus; der Erste leuchtet, der Startknopf
zählt mit („Noch 2 antippen“) und wird rot, sobald alle stehen. In der Fernsteuerung
dieselben Karten in Plakatgröße, Auswahl per 4/6 und Enter.

Die vorgeschlagenen Felder in der Karte des Werfers sind zugleich Tasten: Antippen bucht
den Dart wie im X01 (in der Fernsteuerung nur Anzeige). Dasselbe gilt für Kaiwen in der
Einzel-Dart-Eingabe.
In der Fernsteuerung bucht die Clear-Taste den eingetippten Rest und Minus einen Bust,
genau wie im X01.

### Kaiwen (Team-Checkout)

Allein oder zu zweit (Entwurf „Kaiwen“, Oktober 2026): die **Zahl** (zum Start 120)
in einem **Versuch von 9 Darts** finishen, Aufnahmen zu je 3 Darts abwechselnd, solo
wirft einer alle drei. Double Out und Bust wie im X01: Rest unter 0, Rest 1 oder Rest 0
ohne Doppel ist ein Bust, der Rest geht auf den Stand vor der Aufnahme zurück, die
Darts der Aufnahme sind verbraucht, der Nächste macht weiter. **Check: Zahl plus 10**
(übrige Darts verfallen), **nach 9 Darts ohne Finish: Zahl eins runter** (Untergrenze
2). Die Reihenfolge läuft über alle Versuche durch: wirft A, B, A, beginnt B den nächsten
Versuch, und nach einem frühen Check von A startet B die neue Zahl. Mehr als zwei in
der Aufstellung sperrt den Start mit Hinweis. Das Spiel hat kein Ende; „Spiel beenden
und auswerten“ im Menü zeigt die Zusammenfassung (höchste Zahl, Versuche, Checks und
Quote, Checks je Spieler, ob PB oder Rekord gefallen sind) und speichert.

Der Bildschirm zeigt Score und groß den Rest, die 9 Darts des Versuchs als drei
Gruppen mit dem Namen des jeweiligen Werfers, das Team mit PB, letzter Aufnahme (nur die
Zahl, auch beim Finish) und
dem Finish-Weg beim Werfer (Lieblingsdoppel, Darts in der Aufnahme, bis 170; der
Stellwurf nur, wenn im Versuch noch Darts folgen), den Verlauf als grüne und rote Chips
(nur die Zahl; die Runde steht im Untertitel) und rechts die
Eingabe: Punkte (Tastenfeld, Schnellwahl, Finish-Frage nach der Dartzahl, auch per
Tasten 1/2/3) oder Einzel-Darts (Wechsel-Knopf, die Wahl bleibt fürs Spiel), dazu die
Fernsteuerung mit Tastatureingabe (wie im X01: Clear bucht den eingetippten Rest, Minus
einen Bust, Plus oder Shift gedrückt zeigt die Aufnahmen des Versuchs groß). Testspieler setzen weder Rekord noch PB. In der
Rangliste steht der App-Rekord mit Namen in der Rekorde-Karte, die Spiele-Liste nennt
höchste Zahl und Checks. Nach jedem
Versuch steht kurz „+10“ oder „−1“ am Score. Undo wie im X01, auch über das
Versuchsende hinweg; der Stand übersteht ein Neuladen.

**Rekord und PB:** Der Rekord der ganzen App ist die höchste Startzahl, die je ein
Versuch erreicht hat (Ausgangswert 120), mit Namen und Datum; er wird aus allen
gespeicherten Kaiwen-Spielen (also auf allen Geräten mit Konto) und dem laufenden
Spiel gerechnet, ein Merker in `S.rekorde.kaiwen` überlebt das Archiv-Limit. Beim
ersten Überbieten im Spiel gibt es Banner und wackelnden Pokal, danach nur ein
Aufleuchten der Rekordzahl. Nach jedem Versuch pulsieren Score und Rest kurz grün
(Check) oder rot (verfehlt). Oben rechts steht im Kasten erst der PB (solo der des
Spielers, im Team der beste der Mitspieler), dann der Rekord mit dem Pokal vor der Zahl.
Jeder Spieler hat einen PB solo und einen im Team (steht
in seiner Karte, leuchtet beim Überbieten; fällt zugleich der Rekord, läuft nur die
Rekord-Animation). Undo nimmt Rekord und PB mit zurück. In der Rangliste gibt es die
Kacheln PB Team, PB Solo, Checks, Check-Quote (ab 5 Versuchen) und Versuche.

### Hunter (Mäusejagd auf der Scheibe)

1 bis 6 Spieler, je 3 Darts, reihum in Auswahlreihenfolge (kein Ausbullen). Gespielt
wird in **Board-Reihenfolge im Uhrzeigersinn** (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3,
19, 7, 16, 8, 11, 14, 9, 12, 5, dann wieder 20), der Bull spielt keine Rolle. Die
**Startfelder** liegen fest: 2 Spieler 20 und 3 · 3 Spieler 20, 15, 16 · 4 Spieler 20,
6, 3, 8 · 5 Spieler 20, 13, 2, 7, 14 · 6 Spieler 20, 4, 15, 3, 16, 9 (Spieler 1 immer
auf der 20). Das Startfeld ist das erste Ziel; ein Treffer rückt weiter, schon der
nächste Dart geht aufs neue Ziel. **Jeder jagt den Vordermann:** Einholen reicht, wer
das Feld eines Gegners vor sich erreicht oder überspringt, fängt ihn (mit Boost alle,
die er überspringt). Gefangene fliegen raus und stehen ausgegraut auf der Scheibe, der
Fänger wirft seine Aufnahme zu Ende, der Letzte gewinnt (zu zweit entscheidet mit einem
Leben der erste Fang). Varianten beim Start: **Normal** (jeder Treffer 1 Feld), **Boost** (Single 1,
Doppel 2, Triple 3 Felder), **Handicap** (je Spieler eine Stufe: jeder Treffer, nur das
Doppel oder nur das Triple zählt, immer 1 Feld). Dazu die **Leben** (1, 3 oder 5): so
oft darf einer gefangen werden; wer gefangen wird und noch Leben hat, steigt auf der
gegenüberliegenden Seite der Scheibe (10 Felder weiter) wieder ein, erst der letzte
Fang wirft ihn raus. **Solo** ist ein Training: einmal rund
um die Scheibe von der 20 zurück auf die 20, gezählt werden die Darts, der Bestwert je
Spieler und Variante leuchtet bei Verbesserung auf.

Der Bildschirm folgt dem Entwurf „Hunter Spiel“: links der Kopf (Menü, Variante,
Spieler, wie viele im Spiel sind, rechts die Runde bzw. solo der Bestwert, der bei
Verbesserung leuchtet), darunter die Scheibe als Spielfeld in klassischen Farben (SVG,
20 Segmente, Zahlen innen am Rand). Das Zielfeld des Werfers leuchtet blau, bei Handicap
nur der zählende Ring; in der Mitte stehen der Werfer, groß sein Ziel („17“, „D17“,
„T17“) und wen er jagt („Jagt Anna · 3 Felder“, solo „noch 8 Felder“). Die Spieler sitzen
als farbige Marker mit Kürzel außen am Rand (auf einem Feld versetzt nebeneinander,
Bewegung als Animation, der Werfer größer mit weißem Ring, Gefangene grau), ein Fang
poppt als Banner über der Scheibe auf („Julius fängt Anna!“). Unter der Scheibe je
Spieler ein Chip mit Farbe, Name, Zielfeld, Fängen, MPR (Treffer je 3 Darts, live) und letzter
Aufnahme (solo Feld, Darts und MPR), bei mehreren Leben die restlichen als Herzen. Rechts Zurück und die drei Darts der Aufnahme, darunter die Tasten fürs
aktuelle Ziel: Boost mit Single groß, Doppel (+2) und Triple (+3), jeweils mit dem
Feld danach; Normal und Handicap mit einer großen Taste („jeder Ring zählt“ bzw. der
zählende Ring), dazu „Miss“ und „Bust“ (der Rest der Aufnahme verfällt, der Nächste ist
dran). Eine Aufnahme endet nach drei Darts oder mit Bust. Tastatur: 1, 2, 3 sind Single,
Doppel, Triple aufs Zielfeld, die Leertaste ein Miss, Enter ein Bust, Backspace oder Z
nimmt den Dart zurück. Undo dartweise, auch über einen Fang hinweg; der Stand
übersteht ein
Neuladen. Die Zusammenfassung nennt Gewinner, Fänge, Darts und Trefferquote je Spieler;
in der Rangliste stehen Siege, Fänge, MPR (Treffer je 3 Darts, ab 30 Darts), Trefferquote (ab 30 Darts), Solo Normal und
Solo Boost.

## Ablauf (X01 Turnier)

1. **Setup** – Antippen, wer heute mitspielt (2 bis 12 Spieler), Startpunkte (301/501/701) und Legs
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
(0–180) und mit `OK` bestätigen – immer, es wird nichts automatisch übernommen.
`←` löscht die letzte Ziffer; bei leerem Feld nimmt es die letzte Aufnahme zurück,
also zum Wurf davor und zum vorigen Spieler. Oben steht groß die getippte Zahl,
darunter eine Schnellwahl mit den häufigsten Werten (26, 41, 45, 60, 81, 85), die
sofort bucht. Steht beim Spieler am Wurf ein Finish an, zeigen die **drei Felder in
seiner Karte** den Weg (z. B. T20 T19 D12) – neutral, keins ist markiert; ohne
Finish bleiben die Felder leer.

**Einzel-Dart-Modus:** Schaltet automatisch um, sobald der Rest im Finish-Bereich
liegt (Standard: ab 170, in den Einstellungen auf 100/180/nie änderbar). Dann wird
Dart für Dart eingegeben: **Double** oder **Triple** sind Schalter oben im Zahlenfeld
(Tipp an, nochmal Tipp aus – keiner an heißt Single, sie schließen sich gegenseitig
aus), dann die Zahl tippen – plus `Bull`, `Bull ×2` und `0` für den Fehlwurf. Die
Tasten behalten dabei die Feldzahl (18 bleibt 18) und
bekommen ein kleines D bzw. T davor, damit das Zielfeld erkennbar bleibt. Die
vorgeschlagenen Kacheln sind zugleich Tasten: Wer die angesagte 14 trifft, tippt
einfach auf die Kachel „14“, statt sie im Zahlenfeld zu suchen. Geht mit den
restlichen Darts kein Finish mehr, steht in der nächsten Kachel gestrichelt der
**Stellwurf** wie im Finisher (42 Rest → „10“, damit 32 bleibt) – auch antippbar.

**Kopfleiste:** Links **•••** öffnet das Menü (Spiel und Stand, **Spiel verlassen**
oder **Weiterspielen** – ein Tipp daneben oder Esc schließt es). In der Mitte stehen
Spiel und Stand. Rechts **⌨** schaltet die Fernsteuerung (Board-Anzeige, siehe
unten) ein und aus – das Zeichen leuchtet blau, solange sie läuft –, und **⇄**
wechselt mit einem Tipp zwischen Punkten und Einzel-Darts. Die **Tab-Taste**
schaltet dieselben Modi im Kreis durch. Der ⌨-Knopf fehlt, wenn jemand allein
spielt; die Kamera erscheint im Menü nur mit Server (siehe
[Kamera-Kopplung](#kamera-kopplung-linse)). Einen Rücknahme-Knopf im Kopf gibt es
nicht mehr – zurück geht es über **←** im Tastenfeld.

Links unten im Zahlenfeld sitzt **←** (letzter Dart bzw. letzte Aufnahme zurück),
daneben **0** (Fehlwurf, rot) und rechts das helle **OK**: Es schließt die Aufnahme
mit einem Tipp ab und füllt die fehlenden Darts als Fehlwürfe auf – wer dreimal am
Doppel vorbeiwirft, tippt einmal statt dreimal „0", und die Dart-Zahl (und damit der
Average) stimmt. Die laufende Aufnahme steht dabei in den **drei Feldern der Karte**
des Spielers am Wurf: leer zu Beginn, jeder eingetragene Dart füllt eines (grün, wenn
er den Finish-Vorschlag trifft); in Finish-Nähe zeigen die restlichen Felder den Weg,
das nächste Ziel hell umrandet – die Wartenden haben drei leere Felder. Die
Bull-Tasten heißen einheitlich **Bull** (25) und **Bull ×2** (50), gelb wie überall.

**Fernsteuerung (Turnier-Modus):** Die Riesenanzeige für den Bildschirm, der vorn
am Board hängt. In **Liga-Einzeln** öffnet sie sich am Board-iPad (das sie einmal an
hatte) von selbst; im X01-Turnier und im Schnellen X01 schaltet sie der ⌨-Knopf
bewusst dazu – automatisch startet dort nichts. Allein gibt es sie nicht. Die
Karten **bleiben an ihrem Platz** (zu zweit nebeneinander, ab drei Spielern im
2×2-Raster) – nach jeder Aufnahme wandert nur die Markierung zum Nächsten, und ab
drei Spielern nennt die Kopfzeile, wer danach kommt („Danach: Toni · Sepp“). Die
Reste stehen in Plakatgröße (wer nicht dran ist, tritt leicht zurück), der
Finish-Weg erscheint groß in den Feldern des Spielers am Wurf, sobald einer möglich
ist (der Wartende sieht seinen abgedunkelt). Der Rest steht allein und mittig in der
Karte – ohne die kleine letzte Aufnahme daneben –, und unten stehen links und rechts
die **letzten sechs Aufnahmen** je Spieler (Liga-Vorschrift; zu zweit fest links der
erste, rechts der zweite; ab dreien links wer wirft, rechts der Nächste) neben einer
großen Eingabe-Anzeige. Es gibt kein Eingabefeld und keine Tasten – deshalb blendet das iPad auch keine
Tastatur-Systemleiste ein, und die Seite scrollt nie. Alles läuft über die Tastatur:
**Ziffern** tippen, **Enter** bucht, **Löschen** nimmt erst Ziffern und dann
Aufnahmen zurück (auch über den Spielerwechsel hinweg), die Checkout-Abfrage
beantworten **1/2/3**, das nächste Leg startet **Enter**, und **Shift** gedrückt
halten zeigt die große Wurfliste (bis 13 Zeilen je Seite). **Tab** schaltet zum
nächsten Modus weiter (aus dem Turnier-Modus also zurück zu Punkte), **Esc**
(am Magic Keyboard ohne Esc-Taste auch **⌘+.**) beendet ihn direkt – und er
überlebt einen Neustart. **Ziffernblock ohne Pfeiltasten** (z. B. Satechi):
**8/2/4/6** = hoch/runter/links/rechts überall dort, wo Ziffern nichts zählen
(Dialoge, Ausbullen, nächstes Einzel), **/** = Tab, **+** gedrückt halten = Liste aller Würfe, **clear** = Rest buchen (Rest 50, „8“ + clear = 42 geworfen),
**-** = überworfen, **\*** = Team-Zwischenstand groß ein/aus (nur Ligaspiel); die
gewählte Schaltfläche ist bei Tastaturbedienung immer markiert. Das **ganze Einzel läuft über die Tastatur**, und
alle Anzeigen sind auf die Distanz vom Oche (~3 m) ausgelegt: Spielername,
Legs und Ø stehen groß in der Karte, die Dialoge sprechen Plakatgröße.
Nach einem Leg: **Enter** startet das nächste, **Löschen** nimmt die Eingabe
zurück; auch am Spielende wählen die **Pfeiltasten** zwischen Statistik und
„Letzten Dart zurück", Enter bestätigt. Auf dem **Ziffernblock** wirken dort, wo mit Pfeilen gewählt wird (Ausbullen, Leg-, Spiel- und Einzel-Ende), **2 = hoch, 8 = runter, 4 = links, 6 = rechts**; bei der Punkte-Eingabe und der Checkout-Frage bleiben es Ziffern. Das **Ausbullen** füllt am Board den
ganzen Bildschirm (Pfeile wählen, Enter bestimmt den Anwerfer), die
**Checkout-Frage** geht mit 1/2/3 oder Pfeilen + Enter, und die App nimmt am
Board die volle Gerätebreite ein – kein schwarzer Rand, der den Schein
abschneidet. Alle Dialoge füllen dabei den **ganzen Bildschirm** in maximaler
Schrift. Nach dem Einzel erscheint **8 Sekunden groß die Kurzstatistik**
(Ø, 180er, höchstes Finish beider Spieler) – Enter überspringt –, danach die
**nächsten Begegnungen in groß**: mit den **Pfeiltasten** wird gewählt (die
gewählte leuchtet), **Enter** startet sie direkt wieder in der Riesenanzeige.
Eine eigene Statistik-Seite gibt es in der Fernsteuerung nicht. Ein Tipp ins Bild tut
nichts; das Menü öffnet nur •••, und der ⌨-Knopf oben rechts beendet die
Fernsteuerung – damit niemand ohne Tab und Esc gefangen sitzt.

**Klang:** Jede gebuchte Eingabe klingt wie ein Pfeil, der ins Board schlägt –
**„Pomp"** (Julius' eigene Aufnahme, eingebettet in `js/sound.js`): beim
Einzel-Dart je gesetztem Pfeil (auch Double/Triple-Wahl), bei der
Punkte-Eingabe je Buchung (OK, Schnellwahl, Enter am Board),
im Cricket, Round the World und Finisher je Feld, und einmal beim
„OK" der Einzel-Darts. Jeder Tipp auf eine Ziffer, den Umschalter oder Double/Triple
gibt einen **ganz leisen, weichen Tastenton**; jede **Rücknahme gleitet** sanft
nach unten statt zu klicken. Im Online-Spiel klingt die Buchung des anderen auf
dem eigenen Tablet ebenfalls als Pomp, gefolgt vom Klopfen – die Tastentöne
bleiben lokal. War das Tablet zwischendurch dunkel, wacht der Ton von selbst
wieder auf. Im Online-Spiel geht außerdem **jeder einzelne Dart** der
Einzel-Dart-Eingabe sofort an die anderen Geräte: Rest und Kacheln laufen dort
live mit, und wer als Nächster tippt, tippt auf derselben Aufnahme weiter. Eine
**180 oder 60 des anderen wird auf allen Geräten gefeiert**, nicht nur auf dem,
das eintippt – auch wenn zwischen zwei Abfragen mehrere Aufnahmen lagen, beim
60er-Checkout und am Matchende. Geklopft wird **einmal je gebuchter Aufnahme**;
ein einzelner Dart des anderen gibt nur den leisen Einschlag. Die Einzeldarts
des anderen stehen **immer** in den drei Kacheln, egal ob das eigene Gerät auf
Punkte, Einzel-Darts oder Turnier steht – und solange er selbst einträgt,
kann hier niemand seine Darts versehentlich zurücknehmen.

Damit der Wartende nichts verpasst, hält die App im Online-Spiel den
**Bildschirm an** und die Audio-Sitzung offen; beim Aufwecken wird sofort
abgeglichen. Ist der Ton trotzdem gesperrt (iOS nach Neuladen), steht unten
der Knopf **„🔇 Ton an – einmal antippen"**. Fehlt die Verbindung, sagt es eine
Leiste oben, statt nur klein im Kopf. Der Server meldet jede Änderung sofort
über eine Live-Verbindung; nur wenn die nicht steht, fragt die App alle 2,5 s
nach. Haben beide gleichzeitig dieselbe Aufnahme getippt, bleibt sie einmal
stehen – ein „bitte nochmal eintragen" kommt nur, wenn die eigene Eingabe
wirklich fehlt.

**Ton & Feiern** lassen sich im Setup abschalten (Klänge und die Feiern für
180 und SECHZIG!, Standard: beides an). Der Ton startet
nach der ersten Berührung (iOS gibt Audio erst nach einer Geste frei);
Browser ohne AAC bekommen einen synthetischen Ersatzschlag.

**Tastgefühl:** Jede gedrückte Taste **blitzt kurz hell auf** – auch bei
einem 30-Millisekunden-Tipp. So ist am Board immer klar, ob die Eingabe
angekommen ist; wer eine Taste hält, sieht sie erhellt stehen. Dialoge
blenden sanft ein statt aufzupoppen (unter 200 ms, bei reduzierter
Bewegung nur als Farbwechsel).

**Ausbullen ab drei Spielern:** Links stehen alle Namen 🎯, rechts wächst
die Wurf-Reihenfolge – einfach in der Reihenfolge antippen, in der geworfen
wird (wer am nächsten am Bull war, zuerst). Der letzte rückt von selbst
nach, ein Tipp rechts nimmt einen wieder heraus.

**Die Sechzig:** Wirft jemand genau **60**, kommt der Löwe – das 1860-Wappen vor
blauen Strahlen, darunter „SECHZIG!". In jedem Eingabemodus; fällt die Feier mit
einem Dialog zusammen (60er-Checkout), bleibt der Dialog obenauf.

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

**Spielerfeld, Undo & Korrektur:** Jeder Spieler hat eine Karte: oben Avatar, Name
(eine Zeile, bei Überlänge mit Ellipse) und darunter klein **Siege · Sätze · Darts**
(gewonnene Legs, Satzstand nur im Satz-Modus, Darts im laufenden Leg), rechts oben
der Ø. Darunter groß der **Rest**, fest in der Mitte, und rechts daneben **klein die
letzte Aufnahme** („345 | 60“, Bust rot durchgestrichen). Wirft er wieder, rutscht die
alte Zahl wie in einem Drehrad nach unten und verblasst, die neue kommt von oben nach.
Einen Wurfverlauf gibt es im Spielbild nicht mehr – in der Fernsteuerung zeigt ihn
weiterhin Shift. **←** im Tastenfeld nimmt Dart für Dart bzw. Aufnahme für Aufnahme
zurück – auch über ein bereits gewonnenes Leg hinweg. Fällt ein Tippfehler an der
letzten Aufnahme erst später auf, genügt ein Tipp auf die kleine Zahl: Der Wert lässt
sich direkt korrigieren, solange das Leg damit schlüssig bleibt.

**Tastatur (am Laptop):** Ziffern, `Enter` = OK, `Backspace` = löschen, `z` = Undo.

## Kamera-Kopplung (Linse)

Der vierte Eingabemodus: ein **iPhone auf dem Stativ vor dem Board** meldet die
Würfe, das iPad bucht sie. Es fließen nur winzige JSON-Ereignisse über den eigenen
Server (nie Video), deshalb gibt es den Kamera-Knopf nur, wenn die App vom Server
läuft – die Einzeldatei und GitHub Pages bleiben unverändert.

> **Zurzeit abgeschaltet** (seit 07.09.2026): `js/kamera.js` wird in `index.html`
> nicht geladen, und die Relay-Routen des Servers gibt es nur mit der
> Umgebungsvariable `DARTS_KAMERA=1`. Zum Wiedereinschalten beides zurückdrehen.

**Koppeln:** Im Spiel den Modus **Kamera** wählen – das iPad zeigt einen
6-stelligen Code. Auf dem iPhone dieselbe Adresse im Safari öffnen (nicht als
Homescreen-App – dort ist der Kamerazugriff auf iOS wackelig), unten im Setup
**„Dieses Gerät als Kamera / Fern-Eingabe koppeln"** antippen und den Code
eintippen. Die Kopplung überlebt Server-Neustarts und WLAN-Schluckauf: verpasste
Würfe kommen aus einem Puffer nach, doppelt zugestellte werden aussortiert.

**Fern-Eingabe (heute):** Das iPhone zeigt groß, wer dran ist, den Rest und die
laufende Aufnahme – und ein Dart-Tastenfeld. Jeder Tipp landet über denselben Weg
im Spiel wie am iPad selbst, inklusive aller Prüfungen und Undo. Läuft in allen
Modi (X01, Cricket, Round the World, Finisher).

**Kamera-Erkennung (erste Stufe):** Auf dem iPhone **Kamera einschalten** (der
Bildschirm bleibt per Wake Lock an – Ladekabel empfohlen). Bietet das Gerät
echten Kamera-Zoom an, erscheint unter dem Bild ein **Zoom-Regler** – so füllt
das Board auch aus größerem Abstand das Bild. Dann **Erkennung starten**: Die
Linse sucht die Scheibe **selbst** – die rot/grünen Ringe verraten Umriss und
Drehung – und legt ein grünes Gitter darüber; ein Tipp auf **Passt** genügt.
Nur wenn Licht oder Winkel nicht mitspielen, fällt sie auf das Antippen der vier
Doppel-Außenkanten zurück. Danach erkennt sie Einschläge per Differenzbild:
Kamera fest ausrichten (frontal, leicht seitlich versetzt, ~1 m, gleichmäßiges
Licht – Ringlicht ideal) und das Board beim Start frei lassen. Unsicher
Erkanntes (nah am Draht, seltsamer Fleck) bucht das iPad **nicht** automatisch,
sondern meldet es ans iPhone – dann von Hand nachtragen. Nach dem Ziehen der
Darts erkennt die Linse das leere Board und meldet das Aufnahme-Ende. Wandert
das Stativ oder ändert sich der Zoom, kalibriert sie sich neu – ein
„Passt"-Tipp, fertig.

Diese Stufe ist bewusst ohne Maschinenlernen gebaut (null Zusatz-Download); an
den 8-mm-Ringen wird sie sich irren. Der ↺-Button und die Zeilen-Korrektur
bleiben deshalb Teil des Spiels – und liefern nebenbei die Trainingsdaten für
die spätere Modell-Stufe.

## Spielabschluss

Ist ein Spiel entschieden, kommt zuerst der Glückwunsch für den Sieger (mit „Letzten
Dart zurück“). Danach folgt für die schnellen Spiele das **Spielende nach dem Entwurf
„Sieger“**: Pokal und Titel, das Podest (Zweiter links, Erster höher in der Mitte,
Dritter rechts), daneben der Endstand mit einer Zeile und Kennzahl je Spieler und die
Highlights, unten „Zum Menü“ (speichert) und „Revanche“ (gleiches Spiel noch einmal).

- **Schnelles X01**: Legs und höchstes Finish, Ø; Highlights 180er, High-Finish,
  bestes Leg, höchster Ø, Doppelquote.
- **Cricket**: Felder zu und Punkte, MPR; meiste Marken, höchste MPR, Darts gesamt.
- **Round the World**: durch mit Bull bzw. erreichte Zahl, Darts; beste Quote, Darts
  bis Bull, Darts gesamt.
- **Finisher**: gewonnene Runden, Ø Darts je Finish; höchste Zahl, schnellstes Finish,
  gespielte Runden.
- **Hunter**: Fänge und Darts bzw. „gefangen von“, Trefferquote; Fänge, Doppelfang,
  beste Quote, Darts gesamt.
- **Kaiwen**: kein Sieger, sondern „Score N“ mit dem Team (Checks, Darts, PB);
  höchster Check, PB, Rekord, Versuche; der rote Knopf heißt „Neuer Versuch“.
- **Online** (geteiltes Spiel mit eigenem Konto): Titel aus eigener Sicht („Du
  gewinnst!“, „Knapp dran!“, „Nächstes Mal!“) und die eigene Platzierung als Pille.

Die **Spielstatistik** (nach dem Entwurf „Spielstatistik“) gibt es für Turnierspiele
direkt nach dem Spiel und für jedes gespeicherte Spiel aus der Spieleliste: oben das
Ergebnis als Karte (Spielart und Daten links, in der Mitte der Stand „A 3 : 1 B“ bzw.
„A gewinnt“, rechts der Sieger als Pille; im Archiv der Zurück-Pfeil), darunter alle Werte
als Vergleich mit einer Spalte je Spieler, der beste Wert einer Zeile leuchtet (501:
3-Dart-Average, First 9, höchste Aufnahme, 180/140+/100+, höchstes Finish, Doppelquote,
bestes Leg, Darts; Cricket: MPR, Marken, Punkte, Felder zu, Darts; RTW: erreichte Zahl,
Darts, Treffer, Quote; Finisher: Punkte, Ø Darts, schnellstes Finish, höchste Zahl;
Hunter: Fänge, Darts, Treffer, Quote; Kaiwen: Checks, Darts, PB), rechts der Verlauf (Legs,
Spiele eines Turniers zum Antippen, Runden, Felder, Fänge, Versuche). Im Turnierspiel
stehen unten „Letzte Aufnahme zurücknehmen“, „Zur Tabelle“ und „Nächstes Spiel“ bzw.
„Turnier auswerten“. Der Kopf mit der Navigation ist derselbe wie überall, auch im
Konto.

Von dort geht es direkt weiter zum nächsten Spiel bzw. zur Turnierauswertung, oder das
Trainingsspiel wird gespeichert. Dieselbe Auswertung lässt sich später jederzeit über
den Spielverlauf in der Rangliste wieder öffnen.

## Spielerprofile

**Der Reiter „Spieler"** (Entwurf „Crew Redesign“, Oktober 2026) trägt den Kopf des
Setups; darunter steht „N im Team · M Gäste“ mit den Filtern **Alle · Team ·
Gäste** und „+ Spieler“. Links alle Spieler als ruhige Karten mit Ø, Siegen und
180ern (Gäste, Gast-Konten, Test und Ausgeblendete tragen eine kleine Marke),
am Tablet rechts die **Schnellansicht** des angetippten Spielers: Bilanz, die
letzten Spiele als S/N, sechs Kennzahlen (Average, First 9, Höchstes Finish,
180er, Doppelquote, Bestes Leg) sowie „Bearbeiten“ und „Ganzes Profil ›“. Am
Handy (hochkant wie quer) gibt es nur die Liste, ein Tipp öffnet das Profil.

**Das Profil** (Entwurf „Profil“, Oktober 2026) trägt denselben Kopf: oben der
**Spielerausweis** (Foto mit Kamera-Knopf, Name in Plakatschrift, echter Name,
Chips für Status, „seit“, Bilanz und Turniersiege, „Profil bearbeiten“, die Form
der letzten zehn Spiele), darunter drei Kacheln: **Finish-Weg · Lieblingsgruppe**
(siehe Checkout-Engine unten), die Links **Statistik** („Meine Stats“ legt die
ausführlichen Karten Scoring, Finishing, Bilanz, Cricket, Round the World und
letzte X01-Spiele als Tafel über die Kacheln, „Fertig“ schließt sie) und
**Liga-Statistik**, und beim eigenen Konto die **Konto-Kachel** (E-Mail, Passwort
ändern, Abmelden). Der Reiter **Profil** öffnet das eigene Profil; fremde Profile
erreicht man über die Spielerliste. Am Tablet steht alles fest im Rahmen, am Handy
scrollt die Seite.

**Profil bearbeiten** (Entwurf Oktober 2026) ist eine eigene Fläche im Profil:
links das Foto mit „Foto ändern“ und „Entfernen“ und die **Avatar-Farbe** (zwölf
Töne), rechts Spielername, **Kürzel** (bis drei Zeichen, sonst aus dem Namen),
Vor- und Nachname, beim eigenen Konto die **E-Mail** (Anmeldename, der Server prüft
Form und Freiheit) und die **Wurfhand**. „Speichern“ übernimmt alles auf einmal;
Gäste behalten den kleinen Dialog mit Gast-Art und Löschen. **Foto anpassen**
(Kamera-Knopf am Ausweis oder „Foto ändern“): das Bild liegt im Ausschnitt, ziehen
verschiebt es, Zoom per Schieber oder Plus/Minus, rechts die Vorschau in den drei
Größen Profil, Spiel und Liste; „Kamera“ öffnet am Gerät die Kamera, „Galerie“ die
Fotos. „Übernehmen“ schneidet den Kreis auf 220 × 220 zu.

Spieler sind dauerhaft: Name und Foto werden einmal angelegt und gelten für jedes
weitere Turnier. Das Foto kommt aus der Fotomediathek oder direkt von der Kamera und
wird auf 220 × 220 Pixel zugeschnitten, damit der Speicher nicht vollläuft; ohne Foto
zeigt die App die Initialen auf einer aus dem Namen abgeleiteten Farbe.

Neben dem Anzeigenamen nimmt das Profil unter „Echte Namen für die Liga" **Vor-
und Nachnamen** auf (zwei Felder nebeneinander) – sie erscheinen überall im
Liga-Kontext (Spielplan, Spielbildschirm, Spielbericht), damit auf dem Bogen
nichts nachgetragen werden muss. Das Profil zeigt den echten Namen unter dem
Anzeigenamen; gepflegt wird alles über **Bearbeiten** (im Konto oder am Profil).
Auch die **Gegner** eines Ligaspiels werden mit Vor- und Nachnamen erfasst –
die SWO verlangt bürgerliche Namen auf dem Bogen.

Wer nicht mehr mitspielt, lässt sich **ausblenden** statt löschen — dann verschwindet
er aus der Aufstellung, seine Ergebnisse bleiben aber in Statistik, Ranglisten und
Spielverlauf erhalten. Ausblenden und Löschen fragen einmal nach; wer im
laufenden Spielplan steht, lässt sich erst nach dem Turnier (oder nach dem
Abmelden über „Spieler im Turnier") ausblenden. Ein neuer Spieler braucht einen
Namen (bis 16 Zeichen); gibt es den Namen schon, fragt die App einmal nach.
Ohne Konto heißt der Knopf „+ Spieler hinzufügen", und ein solches Profil ohne
Spiel lässt sich auch wieder löschen. **Gäste** lassen sich dagegen jederzeit direkt
**löschen**: ohne Spiele spurlos, mit Spielen verschwinden sie sofort aus
Spielerliste, Aufstellung und Rangliste – die Partien der Mitspieler bleiben
in der Historie. Von selbst räumen sich Gäste **nach dem Abend** weg (zwölf
Stunden nach ihrem letzten Spiel): Wer nie geworfen hat, verschwindet ganz, wer
gespielt hat, wird ausgeblendet. Das passiert beim Öffnen der App und jedes Mal,
wenn das Setup gezeigt wird – auch auf einem Tablet, das tagelang offen bleibt.
Steht der Gast noch in einem laufenden Turnier, bleibt er, bis das Turnier
beendet ist; solange lässt er sich auch nicht löschen.

**Gast einladen** (nur angemeldet, nicht mit Gast-Konto): „+ Gastspieler“ fragt
*Temporär* (nach 12 Stunden weg), *Dauerhaft* (nur dieses Gerät) oder **Einladen**.
Einladen holt vom Server einen Link, der als **QR-Code** im Dialog steht und sich
über **Link teilen** verschicken lässt (Teilen-Menü des Geräts, am Computer in die
Zwischenablage). Zur Wahl steht **Gast** (eigenes Konto auf allen Geräten, spielt
mit und hat seine Statistik, aber keine Liga) oder **Vereinsmitglied** (voller
Zugang). Wer den Code scannt oder den Link öffnet, landet direkt beim Registrieren
– „Einladung von … als Gast“ –, der Einladungscode ist schon drin, es fehlen nur
Name, E-Mail und Passwort. Ein Link gilt **sieben Tage und für genau ein Konto**;
der eigentliche Einladungscode wandert dabei nie mit (siehe
`server/migrations/014_einladungen.sql`, `POST /api/einladungen`).

## Statistik und Ranglisten

Jedes gespielte Spiel wird vollständig gespeichert — mit allen Aufnahmen und, im
Einzel-Dart-Modus, jedem einzelnen Dart. Sämtliche Werte werden daraus neu berechnet,
ein Undo korrigiert also auch die Karrierewerte.

**Testspieler zählen nirgends.** Konten, die auf dem Server als Testkonto markiert
sind (Marke „Test“ in der Spielerliste), gibt es nur für den, der sie sehen darf –
alle anderen bekommen weder die Spieler noch ihre Spiele. Und auch bei ihm fließt
kein Spiel mit Testbeteiligung in Karriere, Rangliste, Rekorde, Diagramm oder
Spieleliste. So lässt sich nach einem Update am echten Server ausprobieren, ohne
die Statistik der Mannschaft zu berühren (siehe [DEPLOY.md](DEPLOY.md#testkonten)).

**Im Spielerprofil** (Reiter „Spieler"):

| Bereich | Werte |
|---|---|
| Scoring | 3-Dart-Average, First-9-Average, höchste Aufnahme, 180er, 140–179, 100–139, 60–99, Aufnahmen, geworfene Darts |
| Finishing | Doppelquote, Doppelversuche, Checkouts, höchstes Finish, Finishes ab 100, bestes Leg, Ø Darts je gewonnenem Leg (beide nur aus 501er-Legs – ein 301er in sechs Darts ist kein Rekord) |
| Bilanz | Spiele, Siege/Niederlagen, Siegquote, Legs, Turniere, Turniersiege, Form der letzten Spiele |

Dazu die letzten Spiele mit Gegner, Ergebnis und Datum.

**Turniere nachschauen:** In der Spieleliste unter Classic steht zu jedem gespielten
Turnier eine eigene Zeile (🏆). Ein Tipp öffnet den **Endstand** wie am Abend auf dem
Bildschirm: Plätze mit Siegen, Legs und Ø, je Spieler die Turnierwerte (Average,
First 9, höchste Aufnahme, 180/140+/100+, höchstes Finish, bestes Leg), darunter
alle Spiele zum Anklicken. Jedes Spiel eines Turniers zählt als Sieg bzw. Niederlage
für die Beteiligten und fließt mit allen Würfen in Average und Rekorde ein. Ein
geteiltes Turnier („An zwei Scheiben“) zählt dabei genau einmal – auch wenn ein
anderes Gerät es abgeschlossen hat und die eigene Kopie noch offen ist.

Für Cricket kommt die **MPR** (Marks per Round – getroffene Marken je 3 Darts, das
übliche Cricket-Maß) samt Siegen dazu, für Round the World die Bestleistung in Darts
und die Siege.

**Im Reiter „Rang"** (Entwurf „Rangliste Redesign“, zweite Fassung, Oktober 2026)
trägt die Seite den Kopf des Setups: Marke links, die Navigation als Text-Reiter
rechts (das frühere Logo-Menü gibt es nicht mehr). Darunter die Spielart mit
Spielzahl und die Spielart-Reiter – Classic, Cricket, RTW, Finisher sowie Kaiwen
und Hunter („Coming soon“, bis die Spiele da sind); die Liga-Auswertung steht im
Reiter „Statistik“ der Liga-Seite. Links die **Bestwert-Karten**: je Kennzahl der
beste Wert und wer ihn hält; ein Tipp auf eine Karte zeigt darunter die Liste
aller Spieler zu dieser Kennzahl (Platz 1 bis 3 in Gold, Silber und Bronze, der
Beste leuchtet). Rechts **der Verlauf der letzten 10 Spiele zur gewählten
Kennzahl** – Siege, 180er, 100+ Aufnahmen, Legs und Turniersiege laufen dabei
auf („… gesamt“), Averages stehen je Spiel (die Legende nennt den Schnitt über
die gezeigten Spiele), Bestmarken je Spiel, bei „weniger ist besser“ (Bestes Leg,
RTW, Finisher) steht der kleine Wert oben – und die **Rekorde** mit Pokal.
„Alle Spiele ›“ öffnet den Spielverlauf anstelle der Spalten, „‹ Rangliste“ führt
zurück. Am Tablet steht das Bild fest im Rahmen, die Liste scrollt innen; am Handy
wischen die Bestwert-Karten seitlich, quer entfallen Verlauf und Rekorde, hochkant
steht alles untereinander. Die Werte sind nach
Spielmodus getrennt – Classic, Cricket und Round the World haben je eigene
Bestenlisten, eigene Rekordtafel und einen eigenen Spielverlauf:

| Modus | Bestenlisten |
|---|---|
| Classic (301/501) | Average, First 9, Doppelquote, höchstes Finish, 180er, höchste Aufnahme, bestes Leg, 100+ Aufnahmen, Siege, Siegquote, Legs, Turniersiege |
| Cricket | MPR, Siege |
| Round the World | Bestes Ergebnis (Darts), Siege |

Über den Listen zeichnet ein **Verlaufsdiagramm** die Entwicklung über die letzten bis
zu 10 Spiele – eine Linie je Spieler in seiner Farbe, links die Skala, unten die
Spiele. Bei Classic ist es der 3-Dart-Average je Spiel, bei Cricket die MPR je Spiel. Unter dem Diagramm stehen die Spieler nach ihrem Schnitt über diese Spiele sortiert: der beste zuerst, der schwächste zuletzt.
Unter dem Diagramm steht je Spieler der **Durchschnitt über genau diese Spiele**
(Punkte durch Darts, nicht der Mittelwert der Einzelwerte) – bei weniger als
zehn Spielen über die vorhandenen.
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

Ein Turnier wandert per **„Turnier abschließen"** ins Archiv (die letzten 500 Spiele und Turniere bleiben
gespeichert); abgebrochene Turniere behalten ihre bereits gespielten Spiele in der
Statistik. Ein Schnelles X01 über mehrere Legs lässt sich beim Abbrechen mit
„Gespielte Legs behalten“ ohne Sieger übernehmen (Average, 180er, Finishes zählen).

## Öffentliche Webseite

Unter der Wurzel des Servers (`/`, Datei `webseite.html` mit `css/webseite.css`
und `js/webseite.js`) liegt seit Oktober 2026 die öffentliche Seite im App-Stil
(Entwurf „Webseite“); die App selbst bleibt unter `/index.html` (so steht es als
`start_url` im Manifest, installierte Geräte merken nichts). Ohne Konto sieht man:

- **Nächster Spieltag** groß mit Datum, Paarung, Lokal, „Route zum …“ (Apple
  Maps) und „In den Kalender“ (ICS, 20:00 bis 23:00 Uhr), daneben der
  **Countdown** bis zum Anwurf um 20:00 und der Livescoring-Knopf.
- **Am Spieltag stattdessen der Live-Stand**: sobald ein geteiltes Ligaspiel
  läuft (`GET /api/oeffentlich/liga` liefert den Zuschauer-Schlüssel), zeigt die
  Seite wie der Live-Ticker den Punktestand, die laufenden Boards mit Rest und
  Average, „Ergebnisse heute“ und Highlights (alle 4 s neu). Ein beendetes Spiel
  bleibt sechs Stunden als Endstand stehen; Übungsspiele zählen nicht.
- **Ligatermine** (alle 18, gespielte mit Ergebnis, der nächste hervorgehoben,
  spielfreie als solche), **Ergebnisse** aller Spiele der Liga (aus
  `LIGA_SPIELTAGE`) und die **Tabelle**, wie sie die Mannschaft in der App
  pflegt (vom Server, sonst der Stand zum Saisonstart).
- **Anmelden** oben rechts (wer schon angemeldet ist, sieht „Zur App“): E-Mail
  und Passwort führen in die App; **Registrieren nur mit Anmeldecode** (Vor- und
  Nachname, der volle Name landet im Profil). Ein Einladungs-Link aus der App
  (`?einladung=…`) öffnet das Registrieren mit eingetragenem Code.

Der Endpunkt gibt keine Namen, Aufstellungen oder Berichte heraus, nur Tabelle,
Spieltag-Kennung und den Zuschauer-Schlüssel. Kontakt, Impressum und
Datenschutz fehlen auf der Seite noch (Texte stehen aus).

## Anmelden und gemeinsam spielen

Wird die App von einem Server mit Kontoschicht ausgeliefert (siehe
[DEPLOY.md](DEPLOY.md), Variante B), erscheint der Reiter **Profil**. Dann hat jeder
seine eigene Karriere, egal auf wessen Gerät mitgeschrieben wurde – und **alle
Angemeldeten sehen alle Spiele der Mannschaft**: auch das Solo-Training eines
Kollegen zählt auf jedem Gerät in Statistik und Rangliste gleich (die Namen
fremder Gastspieler reisen mit; solche Gäste erscheinen nur im Verlauf, nicht
in Aufstellung oder Rangliste). Ältere Geräte holen beim nächsten Öffnen einmal
alles nach.

**Anmelden ist ein Angebot, keine Hürde.** Ohne Account läuft alles wie bisher, nur
eben nur auf diesem Gerät. Ohne Server – Datei per Doppelklick, Einzeldatei-Bündel,
GitHub Pages – ist der Reiter gar nicht erst da.

- **Registrieren** geht mit einem Einladungscode, den du in die Gruppe schickst –
  oder über einen **Einladungs-Link** aus dem Gast-Dialog (QR-Code oder Teilen),
  dann ist der Code schon eingetragen. Keine Bestätigungsmail, kein fremder
  Dienst. Wer sein Passwort vergisst, wendet sich an dich (siehe DEPLOY.md).
- **Beim ersten Anmelden** fragt die App einmalig, wer wer ist: die Spieler, die es
  auf dem Gerät schon gab, lassen sich den Accounts zuordnen. Ihre bisherigen Spiele
  zählen dann dort weiter. Wer keinen Account hat, bleibt **Gastspieler** – das geht
  unverändert, Gäste tauchen nur nirgendwo sonst auf.
- **Für andere mitschreiben** ist der Normalfall: du meldest dich an, wählst deine
  Kollegen aus der Liste und spielst das Turnier ab. Am Ende landet das Ergebnis in
  der Karriere jedes Beteiligten, auch wenn die an dem Abend gar nichts angefasst
  haben. In der Historie steht, wer es eingetragen hat.
- **Ohne Netz** ändert sich nichts. Das Turnier läuft lokal weiter, fertige Spiele
  stellen sich in eine Warteschlange, und sobald wieder Verbindung da ist, gehen sie
  raus. Eine schmale Zeile über der Navigation sagt, wie viele noch warten.

Was der Server **nicht** tut: rechnen. Er speichert fertige Spiele und gibt sie
wieder heraus – Averages, Doppelquote und Ranglisten entstehen weiterhin im Browser
aus den gespeicherten Würfen. Dadurch gibt es die Spielregeln nur an einer Stelle.

Zwei Dinge, die man wissen sollte:

- Wer ein Spiel einträgt, kann die Werte der anderen beeinflussen. Bei zehn Leuten,
  die sich kennen, ist das die pragmatische Lösung; wer sich vertippt hat, kann sein
  eigenes Spiel zurückziehen.
- Schreiben zwei Geräte **denselben** Abend mit, entstehen zwei Spiele und die Werte
  zählen doppelt. Die App weist im Konto-Bildschirm darauf hin, wenn sie so etwas
  sieht (gleiche Besetzung, keine halbe Stunde auseinander).

## Technik

Reines HTML/CSS/JavaScript, kein Build-Schritt, keine Abhängigkeiten zur Laufzeit.
Profile, laufendes Turnier und Archiv liegen in `localStorage` und überstehen Reload
und App-Neustart – auch eine angefangene Aufnahme in Einzel-Darts und eine
offene Checkout- oder Leg-Ende-Frage. Ältere Stände werden beim Laden
automatisch auf das aktuelle Datenmodell gehoben. Ein beschädigter Stand wird
nicht überschrieben, sondern unter `dart-turnier-v1.kaputt` gesichert (mit
Hinweis oben); ein Stand einer neueren App-Version bleibt unangetastet.

**Kein Spiel läuft ewig:** Ein angefangenes Spiel ist höchstens **12 Stunden**
aktiv. Danach wird es beim nächsten Öffnen beendet und **nicht gespeichert**
(ein Hinweis sagt das). Ein schon entschiedenes, nur nie gespeichertes Spiel
kommt dagegen ins Archiv, und ein Turnier wird wie mit „Turnier beenden"
abgeschlossen: fertige Partien bleiben in der Statistik, offene entfallen.

Gibt es eine **neue Version** der App, erscheint oben „Neue Version der App ist
da – Neu laden"; gewechselt wird erst, wenn man tippt.

Die **Zurück-Taste** (Android, Browser) schließt zuerst einen offenen Dialog und
führt aus Unterseiten zurück ins Setup; im laufenden Spiel bleibt sie ohne
Wirkung. Erst im Setup verlässt ein weiteres Zurück die App.

**Die ganze App geht mit Pfeiltasten, Enter und Zurück** – auch in den Menüs.
Außerhalb der Spielbilder (Setup, Rangliste, Spieler, Profil, Liga mit allen
Reitern, Konto, Auswertung) und in jedem Dialog und Menü springen die **Pfeile**
zum nächsten Knopf in Pfeilrichtung, wie am Fernseher; der markierte Knopf
leuchtet, sobald eine Taste gedrückt wurde. **Enter** drückt ihn, und die
Markierung bleibt nach dem Neuzeichnen auf demselben Knopf (Spieler nacheinander
anwählen geht also mit Enter, Enter, Enter). **Escape** geht eine Stufe zurück:
Menü zu, Dialog zu, Liga-Reiter zurück zum Spielplan, Profil zurück zur Liste,
sonst ins Setup – im Setup passiert nichts mehr. **Backspace** tut dasselbe,
außer in den Spielbildern (dort bleibt es das Löschen) und in Textfeldern (dort
löscht es ein Zeichen; Escape verlässt dort erst das Feld). Die Navigation
steht auf jeder Seite als Text-Reiter im Kopf und ist mit den Pfeilen erreichbar.
Auf dem **Ziffernblock** gelten dort **8/2/4/6** als Pfeile. Turnierplan,
Ausbullen und die Dialoge nach Leg und Spiel behalten ihre eigene Pfeil-Wahl.

| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau aller Screens |
| `css/styles.css` | Styling (Dark, Touch-Ziele ≥ 44 px) |
| `js/checkout.js` | Finish-Wege aus Tabellen (Rest 2–170 je Lieblingsdoppel, Stellwürfe), eigene Spieler-Tabellen, plus Rechenkern „ist ein Finish möglich“ |
| `js/checkout-engine.js`, `js/checkout-worker.js` | Checkout-Engine: rechnet aus einem Treffermodell je Spieler eine eigene Finish-Tabelle (im Web Worker); Referenz und Testdaten unter `docs/finishwege/referenz/` |
| `docs/finishwege/`, `tools/finishwege-bauen.mjs` | Quelle der Finish-Tabellen und der Generator, der sie in checkout.js schreibt |
| `js/liga-sdm.js`, `tools/liga-import.mjs` | Daten der Ligaleitung (Spielplan, Ergebnisse, Spielberichte, Teams), automatisch von steeldart-muenchen.de geholt |
| `js/liga-daten.js` | mischt Ligaleitung und Handpflege (`LIGA_HAND`), rechnet Tabelle, Einzelrangliste, Highlights (App und Webseite) |
| `js/app.js` | Turnier-, Cricket- und RTW-Logik, Statistik, Rendering, Persistenz |
| `js/auth.js` | *optional:* Anmelden, Roster, Zuordnung alter Profile, Einladungs-Link |
| `js/qr.js` | *optional:* QR-Code für den Einladungs-Link (qrcode-generator, MIT) |
| `js/sync.js` | *optional:* Warteschlange, Hoch- und Runterladen von Spielen |
| `server/lib/mail.mjs`, `server/lib/push.mjs`, `server/lib/mitteilungen.mjs`, `server/lib/liga.mjs` | Mails über Brevo (eigener SMTP-Client), Web Push (VAPID, aes128gcm), die Mitteilungszentrale (elf Themen, je Konto Push/Mail/aus) und die Liga-Daten im Server |
| `js/kamera.js` | *optional:* Kamera-Kopplung – iPhone als Linse, iPad bucht (SSE) |
| `js/linse-cv.js` | *optional:* die Erkennung selbst – Kalibrierung, Differenzbild, Wertung |
| `server/` | *optional:* Node + SQLite – Accounts, geteilte Historie, Kamera-Relay |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation als App |
| `icons/` | App-Icons aus dem Mannschaftslogo (WebP, dazu ein PNG für iOS) |
| `assets/blink180.jpeg` | das Logo im Original – Quelle für die Icons |
| `tools/make-icons.mjs` | erzeugt `icons/` neu, falls sich das Logo ändert |
| `build-single.mjs` | baut `dart-turnier.html` – alles in einer Datei (`npm run build`) |
| `tests/e2e.mjs` | Browser-Tests des kompletten Turnierablaufs |
| `tests/api.mjs`, `tests/konto.mjs` | Tests der Kontoschicht |

Die `optional`-Zeilen heißen genau das: `js/auth.js`, `js/sync.js` und
`js/kamera.js` docken über `window.__dart` an und melden sich gar nicht erst an,
wenn kein Server antwortet. `js/app.js` ruft sie nur über `window.DartKonto` /
`window.DartSync` / `window.DartKamera` auf, falls vorhanden. Deshalb funktionieren `index.html` per Doppelklick und das
Einzeldatei-Bündel unverändert weiter – ohne Konto, ohne Netz, ohne Fehlermeldung.

Der Server bringt **keine** npm-Abhängigkeit mit: SQLite steckt seit Node 22.5 in
der Laufzeit (`node:sqlite`), Passwörter macht `node:crypto` (scrypt). Sessions sind
zufällige Tokens in einer Tabelle, das Cookie ist `HttpOnly`, `Secure` und
`SameSite=Lax`.

### Logo und Icons

Das Mannschaftslogo steht als App-Icon auf dem Home-Bildschirm und über dem Login.
Neues Logo nach `assets/blink180.jpeg` legen, dann:

```bash
node tools/make-icons.mjs      # danach CACHE in sw.js hochzählen!
```

Gerechnet wird im Chromium, den Playwright für die Tests ohnehin mitbringt – das
Projekt braucht also weiterhin keine Bildbibliothek. Erzeugt werden 192er und 512er
in WebP, eine `maskable`-Fassung (auf 76 % verkleinert, weil Android das Icon in eine
eigene Form schneidet und nur der innere Kreis sicher ist) und ein 180er PNG für iOS,
das kein WebP liest. WebP statt PNG, weil das verrauschte Artwork verlustfrei rund
900 KB wiegt und alles davon im Offline-Cache landet – so sind es 250 KB.

### Anstrich

Die Gestaltung folgt dem Handoff in
[Dart App Rebranding/README.md](Dart%20App%20Rebranding/README.md): warmes
Schwarz, ein Rot, viel Weiß, dazu ein blauer Lichtschein wie das Barlicht der
Location. Alle Farben hängen an wenigen Variablen ganz oben in
`css/styles.css`.

Zwei Regeln, an denen der Look hängt:

- **Rot ist sparsam.** Es gehört dem Finish-Chip, den Siegen, den Rekorden und
  der Punkteingabe – sonst nichts. Überall verteilt schreit es nur.
- **„Ausgewählt" ist weiß**, nicht rot: Karten und Zeilen bekommen eine weiße
  Kante auf leicht aufgehellter Fläche, Navigation und Filter eine weiße
  Füllung.

Drei Schriften: **Anton** für Überschriften und die Hauptaktion, **Barlow
Condensed** für alle großen Zahlen, **Barlow** für Fließtext. Sie liegen unter
`fonts/` und werden selbst ausgeliefert – ein Google-Fonts-Link würde den
Offline-Betrieb brechen und bei jedem Start die IP jedes Mitspielers an Google
schicken. Nur die Latin-Teilmenge, zusammen 128 KB. Neu holen mit
`node tools/fetch-fonts.mjs`, danach `CACHE` in `sw.js` hochzählen.

**Finish-Wege** kommen seit Oktober 2026 aus festen Tabellen (`docs/finishwege/`,
Beschreibung in `docs/finishwege.md`): je Lieblingsdoppel (D16, D20, D18, D12, D8,
D10, D14, D6, D4) und ohne Favorit steht für jeden Rest von 2 bis 170 der beste Weg mit
3, 2 und 1 Dart in der Hand – gerechnet mit einem Treffermodell (Streuung um den
Zielpunkt, Profil „Fortgeschritten“): wenigste Darts zuerst (ohne Bull gerechnet, ein
kürzerer Bull-Weg ist nur Kandidat), keine Bogey-Reste, das
Lieblingsdoppel gewinnt, wenn sein Weg höchstens 0,02 Aufnahmen schlechter ist (so
wird 80 → T16 D16, 92 → T20 D16, 99 → T19 10 D16), Bull nur, wo es klar besser ist
(84 → Bull D17). Nach jedem Dart wird mit dem neuen Rest nachgeschlagen. Geht kein
Finish mehr, steht aus derselben Tabelle der **Stellwurf** mit der Zahl, auf die er
stellt (99 mit zwei Darts: T19 10 auf 32; 21 mit einem Dart: 5 auf 16). Der Weg zu
Beginn der Aufnahme ist ein Plan: solange die Darts wie angesagt fallen, bleibt der
Rest des Plans stehen (128: T20 T16 D10 auch nach der T20), erst ein Fehlwurf lässt
für den neuen Rest nachschlagen.
`node tools/finishwege-bauen.mjs` prüft die Tabellen (Summe, Doppel am Ende,
Stellwurf-Ziel) und schreibt sie in `js/checkout.js`; der alte Rechenkern dort
beantwortet nur noch, ob ein Rest mit n Darts überhaupt zu finishen ist. Gewählt
wird seit der Checkout-Engine keine einzelne Doppelzahl mehr, sondern eine
**Lieblingsgruppe** (Halbierungskette D20 · 10 · 5, D16 · 8 · 4 · 2 · 1, D18 · 9,
D12 · 6 · 3, D14 · 7 oder Bull), bis zu zwei je Spieler, die erste ist die
Hauptgruppe. Ohne eigene Tabelle gilt die feste Tabelle des Doppels der
Hauptgruppe (Bull: die Standardtabelle). Ein altes Lieblingsdoppel wird beim Laden
in die Gruppe seiner Kette übersetzt (8 → D16, 10 → D20, 6 → D12).

### Checkout-Engine (eigene Tabelle je Spieler)

`js/checkout-engine.js` ist die Portierung der Referenz
`docs/finishwege/referenz/checkout_referenz.py` (maßgeblich für Regeln und
Konstanten) nach JavaScript. Sie rechnet aus einem **Treffermodell** die komplette
Finish-Tabelle für einen Spieler: jeder Wurf streut normalverteilt um seinen Zielpunkt
(81 Zielpunkte: Triple, Doppel, Single außen und innen, Zentrum) auf einem Board mit
Originalmaßen; in jedem Zustand (Rest, Darts in der Hand) wird der Zielpunkt gewählt,
der die erwartete Zahl an Aufnahmen bis zum Finish minimiert (Variante „checkout“:
maximale Chance, in dieser Aufnahme auszuchecken). Das Profil besteht aus Streuung
waagrecht und senkrecht, Faktoren für Triple, Doppel und Bull, Lieblingsgruppen
(D20 → D10 → D5, D16 → D8 → D4 → D2 → D1, D18 → D9, D12 → D6 → D3, D14 → D7, Bull)
und der Spielweise. Aus Average und Wurftests (je zehn Darts auf T20, ein Doppel,
Bull, ein Triple) kalibriert die Engine das Profil. Das Trefferbild entsteht nicht
per Monte Carlo wie in der Referenz, sondern durch Integration der Normalverteilung
(je Spalte exakt entlang y), ist also deterministisch und auf jedem Gerät gleich.
Mit dem Referenzprofil „Fortgeschritten“ (12 mm Streuung) ergeben sich die festen
Tabellen oben; wo zwei Wege näher beieinander liegen als das Rauschen der Referenz
(etwa ein Prozent der Einträge), kann die Wahl anders ausfallen.

Gerechnet wird einmal auf Wunsch im Profil, im Web Worker (`js/checkout-worker.js`,
im Einzeldatei-Bündel als Blob-Worker aus dem eingebetteten Quelltext; rund eine
Sekunde). Das Ergebnis ist eine Tabelle im Format der festen Tabellen, die beim
Spieler gespeichert wird; `Checkout.suggest`/`stellwurf` nehmen statt der
Doppelzahl ein Objekt `{ dbl, tabelle }` und greifen zuerst auf die eigene Zeile zu,
Lücken füllen die festen Tabellen. Wer keine eigene Tabelle rechnet, spielt mit der
Standardtabelle seiner Hauptgruppe. `npm run test:engine` prüft die Engine
gegen `checkout_fixtures.json` (Tabellen aller Referenzprofile, Checkout-Variante,
Average-Tabelle, Kalibrierung, Wegbewertung, Alternativen).

**Im Profil** (Kachel „Finish-Weg · Lieblingsgruppe“, Phase 2): die Kette der
Gruppe(n) antippen öffnet die Gruppenwahl (bis zwei, die erste ist die Hauptgruppe;
eine andere Wahl verwirft eine schon gerechnete Tabelle, Average und Tests bleiben).
**„Meine besten Finishes ermitteln“** führt in vier Schritten durch den Dialog:
Lieblingsgruppen, Average (vorbelegt aus den gespielten Spielen, änderbar, 30 bis
120), vier freiwillige **Wurftests** mit je zehn Darts (T20 mit den Zählern T20 /
20 oder D20 / Feld 1 / Feld 5 / Sonst; das Doppel der Hauptgruppe mit Treffer /
innen / draußen / beide Nachbarfelder / Sonst; Bull mit Bull / 25 / Sonst; T16 mit
Treffer / einfach oder Doppel / Nachbarn / Sonst, jeweils mit Plus und Minus bis
genau zehn, „Überspringen“ lässt den Test weg) und die **Spielweise**: *Aufnahmen*
(wenigste Aufnahmen bis zum Finish), *Checkout* (höchste Chance, in dieser Aufnahme
zu finishen) oder *Automatisch* (Checkout, sobald ein Gegner im nächsten Besuch
finishen kann oder es das entscheidende Leg ist, im Kaiwen in der letzten Aufnahme
eines Versuchs, im Finisher immer). Dann rechnet die Engine beide Varianten und zeigt
**„Das ändert sich für dich“**: je Rest der Weg mit drei Darts bisher gegen neu (die
ersten zwölf, dazu die Zahl der weiteren). Erst „Übernehmen“ speichert alles am
Spieler (`p.finish = { gruppen, avg, tests, spielweise, profil, tabelle,
tabelleCheckout, stand }`, `p.dbl` bleibt das Doppel der Hauptgruppe); mit Konto geht
es per `PATCH /api/me` (`finish`, Spalte `users.finish` als JSON, Migration
`015_finish_profil.sql`, der Server prüft nur Form und Größe, höchstens 64 KB) zum
Server und kommt mit dem Kader auf jedes Gerät. Die Kachel nennt danach Datum,
Average und Spielweise der eigenen Tabelle.

**Finish-Tabelle anpassen** (Phase 3, Tafel „Meine Finish-Tabelle“ im Profil):
alle Reste von 170 bis 2 mit dem Weg für drei Darts (Lieblingsdoppel hell, Stellwürfe
mit „auf N“), Filter **Alle · Angepasst**. Ein Tipp auf den Rest öffnet den Editor:
Darts in der Hand (3, 2, 1), die Felder des Wegs, Tastenfeld mit Single/Double/Triple,
25 und Bull. Jede Eingabe wird hart geprüft (Summe, Doppel oder Bull am Ende, nicht
mehr Darts als in der Hand) und vom Modell mit dem besten Weg verglichen: Aufnahmen
mehr oder weniger, Checkout-Chance beider Wege, Warnung „Deutlich schlechter“ (mehr
als 0,05 Aufnahmen oder 3 Prozentpunkte Checkout schlechter) oder „kein Finish,
obwohl eins möglich ist“; übernehmen darf man trotzdem. Darunter die **Alternativen
laut Modell** (die besten Wege mit Aufnahmen und Chance, antippen übernimmt sie).
„Übernehmen“ legt den eigenen Eintrag nur für diese Dartzahl an
(`p.finish.eigene[rest] = '3 Darts|2 Darts|1 Dart'`, leere Teile heißen „wie
gerechnet“), „Eigenen Eintrag löschen“ nimmt ihn wieder weg. Eigene Einträge liegen
über der gerechneten wie der festen Tabelle und über beiden Spielweise-Varianten und
bleiben beim Neu-Ermitteln und beim Gruppenwechsel stehen (Schloss; der Dialog sagt,
wie viele). Die Fragen an das Modell beantwortet ein dauerhafter Worker
(`Checkout.fragen`, Lösung je Profil im Speicher: die erste Frage dauert eine Sekunde,
jede weitere ist sofort da; Spieler ohne eigene Tabelle bekommen das Referenzprofil
ihres Lieblingsdoppels). Im Spiel gilt der eigene Weg als Plan wie jeder andere:
solange die Darts fallen wie angesagt, bleibt er stehen.

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

Für die Kontoschicht kommen zwei Durchläufe dazu:

```bash
npm run test:engine  # Checkout-Engine gegen die Referenzdaten (Node, ohne Browser)
npm run test:api     # Server allein: Registrierung, Rechte, Rate-Limit, Grabsteine
npm run test:konto   # zwei Browser, zwei Accounts, ein gemeinsames Spiel
npm run test:alle    # alle vier nacheinander
```

`test:konto` startet den echten Server gegen eine Wegwerf-Datenbank, registriert zwei
Konten über die echten Formulare, spielt eine Partie Cricket durch und prüft, dass sie
auf dem zweiten Gerät in der Karriere landet – inklusive Zwischenstopp mit
abgeschaltetem Netz.

`npm test` läuft dabei bewusst **ohne** Server: dass die App dann sauber als lokale
App weiterläuft (kein Konto-Knopf, keine Fehlermeldung), wird dort mitgeprüft.

## Testdaten

Zum Ausprobieren des Layouts mit realistischem Inhalt – sechs Testspieler mit Bild
und einer gespielten Historie:

```bash
node server/scripts/demo.mjs        # sechs Konten anlegen (@demo.blink180)
node tools/demo.mjs                 # Bilder setzen und 20 Spiele durchspielen
node server/scripts/demo.mjs --weg  # alles wieder entfernen
```

Die Spiele werden **nicht als Datenstruktur erfunden**, sondern von der App selbst
gespielt: das Skript ruft dieselben Funktionen auf, die auch ein Fingertipp auslöst.
Nur so sind Averages, Doppelquote und Rekorde hinterher echte Zahlen.

Auf dem Server läuft das Anlegen über den Container:

```bash
docker compose -f compose.yml exec darts node server/scripts/demo.mjs
DEMO_URL=https://darts.wirtschaftln.de node tools/demo.mjs
```

Die Konten laufen alle auf `@demo.blink180` – daran erkennt `--weg` sie wieder,
und niemand verwechselt sie mit einem echten Kollegen.

Für Aufräumarbeiten am echten Server gibt es drei Verwaltungs-Skripte
(im Container per `docker compose exec darts node …` aufrufen):

```bash
node server/scripts/konto-anlegen.mjs <e-mail> <anzeigename> <passwort>
node server/scripts/spiel-zurueckziehen.mjs <spiel-id> [...]   # Soft-Delete, Geräte räumen nach
node server/scripts/konto-loeschen.mjs <e-mail>                # verweigert bei aktiven Spielen
```
