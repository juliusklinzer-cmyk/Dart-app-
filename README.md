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

**iPad:** Hoch- und Querformat werden unterstützt. Im Querformat steht der Spielstand
links und das Eingabefeld rechts; das Spielbild ist **fest im Rahmen** – nichts
scrollt aus dem Bild, nur der Wurfverlauf scrollt in seinem eigenen Kasten, und
die getippte Zahl leuchtet groß über den Tasten. Im Hochformat liegt die Eingabe unten. Tasten und
Schrift werden auf Tablets automatisch größer, Doppeltipp-Zoom ist auf Buttons
deaktiviert. Split View funktioniert ebenfalls – bei schmaler Spalte schaltet die App
auf das Handy-Layout um.

Lokal testen: `npm start` (Server auf http://localhost:8080).

**Auf eigener Domain für die ganze Gruppe:** siehe [DEPLOY.md](DEPLOY.md) – Subdomain
mit HTTPS, „Zum Home-Bildschirm“ auf jedem Gerät, Updates per `git pull`.

## Spielmodi

Der Modus wird im Setup gewählt, die Aufstellung gilt für alle vier gleich.

Cricket, Round the World, Finisher und das Schnelle Spiel gehen auch **allein** –
als Training gegen sich selbst. Allein wird nicht ausgebullt, es geht direkt los,
und der Spielbildschirm zeigt eine große Karte mit Finish-Vorschlag und dem Verlauf
mittig darunter. Nur das X01-Turnier braucht mindestens zwei Spieler, es ist ja
jeder gegen jeden.

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

Die Eingabe zeigt **alle Felder gleichzeitig**: je ein Block für Single, Double und
Triple mit den Zahlen 20 bis 15, dazu Bull, Doppel-Bull, Miss und ein
**Weiter ▸**-Knopf, der die Aufnahme sofort beendet und die fehlenden Darts als
Fehlwürfe verbucht – praktisch, wenn jemand gar nichts getroffen hat. Ein Tipp je Dart,
kein Umschalten. Eine Zahl, die bei **allen** Spielern zu ist, bringt nichts mehr und
wird deshalb auf der Tafel und in den Eingabeblöcken grau ausgegraut. Über jeder Spalte
der Tafel steht die aktuelle **MPR**, der ↺-Button nimmt Dart für Dart zurück.

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

Auch hier wird vorher der Anwerfer ausgeworfen. Die Eingabe zeigt immer nur die Zahl,
die gerade dran ist – als vier große Tasten
(Single, Double, Triple, Miss), jeweils mit dem Hinweis, wohin der Treffer führt
(„weiter auf 7"). Nach jedem Dart springt die Anzeige auf die neue Zahl, nach drei
Darts auf den nächsten Spieler. Auf Bull bleiben nur noch „Bull" und „Miss".

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

Der Bildschirm ist derselbe Aufbau wie im Schnellen Spiel: oben im Kopf steht die
gezogene Finish-Zahl (dort, wo sonst die Startpunktzahl steht), darunter die
Spielerkarten mit großem Rest, Punktestand, Darts und Aufnahmen, dann Finish-Leiste
und der Verlauf der Aufnahmen mit Rundentrennern. Wer durch ist, trägt einen Haken
statt einer Zahl. Das Zahlenfeld ist das des X01 – inklusive **„Weiter ▸"**, das eine
Aufnahme mit Fehlwürfen auffüllt. Der ↺-Button nimmt Dart für Dart zurück – und über
eine Rundengrenze hinweg auch eine schon entschiedene Runde samt gezogener Zahl.

Statt einer Punktezeile trägt jede Spielerkarte **Laserpillen**: je Zielpunkt
eine, jedes Finish zündet eine im blauen Licht – leuchten alle, ist gewonnen.
Der lange Verlauf ist einer einzigen Zeile mit der letzten Eingabe gewichen.

In der Rangliste zählt der Modus **gewonnene Runden**, **Ø Darts je Finish**, das
schnellste Finish und die höchste weggemachte Zahl.

## Liga-Spielplan

Der Reiter **Liga** zeigt den Spielplan der Saison (fest im Client, `LIGA` in
`js/app.js`): je Spieltag Datum, Paarung mit Heim-/Auswärts-Kennung und Lokal,
Spielfrei-Runden inklusive. **„In den Kalender"** lädt alle Termine als
iCal-Datei (ganztägig – eine Anwurfzeit steht nicht im Plan). Angemeldete
Spieler können sich je Spieltag **eintragen**: Wer zugesagt hat, steht mit Bild
und Namen am Termin, darunter steht, wie viele noch fehlen, bis die Aufstellung
vollständig ist (`LIGA.sollSpieler`, derzeit 4). Die Zusagen liegen auf dem
Server und sind für alle gleich; ohne Server bleibt der Spielplan lesbar, nur
das Eintragen entfällt. Vergangene Spieltage rücken gedimmt nach hinten.
Der Reiter **Tabelle** ist die von Hand gepflegte Ligatabelle: alle neun Teams
vorbefüllt, jede Zelle (Team, Spiele, Punkte, Legs) antippbar; **„Tabelle
speichern"** legt den Stand auf dem Server ab, sodass alle Angemeldeten
dieselbe Tabelle sehen (`PUT /api/liga/tabelle`).

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

Der Reiter **Kasse** ist die **Vereinskasse**: ein simples Kassenbuch für alle
Angemeldeten – Einzahlung oder Ausgabe mit Betrag und Text erfassen, der
Bestand rechnet sich von selbst, jede Buchung zeigt Urheber und Datum, eigene
Buchungen lassen sich löschen (`/api/kasse`).

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
Künstlernamen). Jedes Einzel trägt seine Scheibe (S1/S2). Es wird **nicht
ausgebullt**: das erste Leg beginnt der Heimspieler, danach wechselt der
Anwurf (SWO §8). Die Übersicht zeigt den **Team-Stand** – groß die **Punkte
nach SWO-Staffel** (Best of 3: 2:0 = 4:0 und 2:1 = 3:1; Best of 5: 6:0 / 5:1
/ 4:2), darunter Einzel und Legs – und die **Highlights** für den Bogen
(180er, High-Finishes ab 100, Shortlegs bis 21 Darts). Die 60er- und
180er-Feiern bleiben im Ligaspiel aus – mitten im Einzel gegen ein fremdes
Team wäre der Löwe fehl am Platz.

Tritt eine Position nicht an (nur drei gemeldet), wertet der **w.o.-Knopf**
am Einzel es **kampflos**: der Anwesende gewinnt 2:0 (bzw. 3:0) mit vollen
Punkten nach Staffel – in der persönlichen Statistik und Rangliste zählt das
Einzel gar nicht (kein Wurf, kein Sieg, keine Niederlage). Über **„ändern"**
lässt sich die Wertung zurücknehmen; im geteilten Spiel wandert sie sofort
auf das andere Gerät und ist dort nicht mehr rückholbar.

**Spielerwechsel** gibt es nach SWO: nur auf derselben Position, höchstens
8 Spieler je Team, der Wechsel greift für alle noch nicht begonnenen Einzel
der Position (im geteilten Spiel derzeit gesperrt). Der **Spielbericht** –
Udos Bogen als Blatt – füllt sich automatisch (Teams, Spieler H1–H8/G1–G8
mit Vor- und Nachname aus dem bürgerlichen Namen, Legs je Einzel – kampflose
mit **w.o.** –, rechts die laufend kumulierten SWO-Punkte, Endergebnis als
Legs und Punkte, Spielzeit, Highlights je Seite), jede
Zelle lässt sich antippen und korrigieren, und **„Drucken"** gibt Seite 1
plus das Nachmelde-/Protest-Leerformular als Seite 2 aus. Nach dem Abschluss
bleibt der Bericht über den Spieltag im Liga-Reiter abrufbar. In der
**Rangliste** gibt es den Reiter **„Liga"**: dieselben Classic-Kategorien
(Average, First 9, Doppelquote, …), gerechnet nur über Ligaspiele, mit
Spieltag-Log und Rekorden. Im Regeln-Reiter der Liga-Seite stehen dazu ein
FAQ für Neue und Udos Regelecke.

Die **Turnier-Übersicht** zeigt links den Spielplan (gestartet wird direkt an
der Partie – einen „Nächstes Spiel"-Knopf gibt es nicht mehr; erst wenn alles
gespielt ist, erscheint „Endstand ansehen"), rechts Tabelle und
Turnier-Statistik. Spielerwechsel und vorzeitiges Beenden wohnen unten im
Spielplan-Kasten.

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
(0–180). Ab 19 wird automatisch übernommen, sobald keine weitere Ziffer mehr passen
kann – ein Tap pro Aufnahme weniger. Für 0–18 bestätigt `OK`. Darüber liegt eine
Schnellwahl mit den häufigsten Werten (26, 41, 45, 60, 81, 85, 100, 140, 180).

**Einzel-Dart-Modus:** Schaltet automatisch um, sobald der Rest im Finish-Bereich
liegt (Standard: ab 170, in den Einstellungen auf 100/180/nie änderbar). Dann wird
Dart für Dart eingegeben: Single/Double/Triple wählen, Zahl tippen – plus `25`,
`Bull` und `Miss`. Die Tasten behalten dabei die Feldzahl (18 bleibt 18) und
bekommen ein kleines D bzw. T davor, damit das Zielfeld erkennbar bleibt. Umschalten
geht jederzeit von Hand über die Knöpfe über der Eingabe:
**Punkte / Einzel-Darts / Turnier / Kamera** – direkt anklickbar, und mit der
**Tab-Taste** schaltet die Tastatur durch dieselben Modi im Kreis.
Der Turnier-Knopf verschwindet nur, wenn jemand allein spielt; der
Kamera-Knopf erscheint nur mit Server (siehe [Kamera-Kopplung](#kamera-kopplung-linse)).

Rechts unten sitzt **„Weiter ▸"**: Er schließt die Aufnahme mit einem Tipp ab und
füllt die fehlenden Darts als Fehlwürfe auf – wer dreimal am Doppel vorbeiwirft,
tippt einmal statt dreimal „Miss", und die Dart-Zahl (und damit der Average) stimmt.
Die laufende Aufnahme steht dabei in **drei großen Kacheln** wie im Finisher: leer zu
Beginn, jeder eingetragene Dart füllt eine (grün, wenn er den Finish-Vorschlag
trifft); in Finish-Nähe zeigen die restlichen Kacheln rot den Weg – die
Finish-Leiste entfällt dort. Unten heißen die Bull-Tasten einheitlich **Bull**
(25) und **Bull ×2** (50), gelb wie überall.

**Turnier-Modus:** Die Riesenanzeige für den Bildschirm, der vorn am Board hängt.
In **Liga-Einzeln** öffnet er sich am Board-iPad (das ihn einmal an hatte) von
selbst; im X01-Turnier und im Schnellen Spiel schaltet ihn der dritte Knopf bewusst
dazu – automatisch startet dort nichts. Allein gibt es ihn nicht. Die Reste beider Spieler stehen
in Plakatgröße (wer nicht dran ist, tritt leicht zurück), der Finish-Weg erscheint
groß im Feld des Spielers am Wurf, sobald einer möglich ist, und unten stehen die
letzten fünf Aufnahmen je Spieler neben einer großen Eingabe-Anzeige. Es gibt kein
Eingabefeld und keine Knöpfe – deshalb blendet das iPad auch keine
Tastatur-Systemleiste ein, und die Seite scrollt nie. Alles läuft über die Tastatur:
**Ziffern** tippen, **Enter** bucht, **Löschen** nimmt erst Ziffern und dann
Aufnahmen zurück (auch über den Spielerwechsel hinweg), die Checkout-Abfrage
beantworten **1/2/3**, das nächste Leg startet **Enter**, und **Shift** gedrückt
halten zeigt die große Wurfliste (bis 13 Zeilen je Seite). **Tab** schaltet zum
nächsten Modus weiter (aus dem Turnier-Modus also zurück zu Punkte), **Esc**
(am Magic Keyboard ohne Esc-Taste auch **⌘+.**) beendet ihn direkt – und er
überlebt einen Neustart. Das **ganze Einzel läuft über die Tastatur**, und
alle Anzeigen sind auf die Distanz vom Oche (~3 m) ausgelegt: Spielername,
Legs und Ø stehen groß in der Karte, die Dialoge sprechen Plakatgröße.
Nach einem Leg: **Enter** startet das nächste, **Löschen** nimmt die Eingabe
zurück; auch am Spielende wählen die **Pfeiltasten** zwischen Statistik und
„Letzten Dart zurück", Enter bestätigt. Das **Ausbullen** füllt am Board den
ganzen Bildschirm (Pfeile wählen, Enter bestimmt den Anwerfer), die
**Checkout-Frage** geht mit 1/2/3 oder Pfeilen + Enter, und die App nimmt am
Board die volle Gerätebreite ein – kein schwarzer Rand, der den Schein
abschneidet. Alle Dialoge füllen dabei den **ganzen Bildschirm** in maximaler
Schrift. Nach dem Einzel erscheint **8 Sekunden groß die Kurzstatistik**
(Ø, 180er, höchstes Finish beider Spieler) – Enter überspringt –, danach die
**nächsten Begegnungen in groß**: mit den **Pfeiltasten** wird gewählt (die
gewählte leuchtet), **Enter** startet sie direkt wieder in der Riesenanzeige.
Eine eigene Statistik-Seite gibt es im Turnier-Modus nicht. Auf einem Gerät ohne Tastatur zeigt ein Tipp irgendwo
ins Bild für ein paar Sekunden den Knopf **„Turnier-Modus beenden"** – der
Notausgang, damit niemand ohne Tab und Esc gefangen sitzt.

**Klang:** Jede gebuchte Eingabe klingt wie ein Pfeil, der ins Board schlägt –
**„Pomp"** (Julius' eigene Aufnahme, eingebettet in `js/sound.js`): beim
Einzel-Dart je gesetztem Pfeil (auch Double/Triple-Wahl), bei der
Punkte-Eingabe je Buchung (OK, Auto-Übernahme, Schnellwahl, Enter am Board),
im Cricket, Round the World und Finisher je Feld, und einmal beim
„Weiter ▸". Jede **Rücknahme klickt** stattdessen trocken. Der Ton startet
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

**Verlauf, Undo & Korrektur:** Unter dem Spielstand stehen die letzten Aufnahmen
beider Spieler (Bust durchgestrichen mit Grund, Checkout grün). Der ↺-Button oben
rechts nimmt Dart für Dart bzw. Aufnahme für Aufnahme zurück – auch über ein bereits
gewonnenes Leg hinweg. Fällt ein Tippfehler erst später auf, genügt ein Tipp auf die
betroffene Zeile: Der Wert lässt sich direkt korrigieren, solange das Leg damit
schlüssig bleibt.

**Tastatur (am Laptop):** Ziffern, `Enter` = OK, `Backspace` = löschen, `z` = Undo.

## Kamera-Kopplung (Linse)

Der vierte Eingabemodus: ein **iPhone auf dem Stativ vor dem Board** meldet die
Würfe, das iPad bucht sie. Es fließen nur winzige JSON-Ereignisse über den eigenen
Server (nie Video), deshalb gibt es den Kamera-Knopf nur, wenn die App vom Server
läuft – die Einzeldatei und GitHub Pages bleiben unverändert.

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

Neben dem Anzeigenamen nimmt das Profil unter „Echte Namen für die Liga" **Vor-
und Nachnamen** auf (zwei Felder nebeneinander) – sie erscheinen überall im
Liga-Kontext (Spielplan, Spielbildschirm, Spielbericht), damit auf dem Bogen
nichts nachgetragen werden muss. Das Profil zeigt den echten Namen unter dem
Anzeigenamen; gepflegt wird alles über **Bearbeiten** (im Konto oder am Profil).
Auch die **Gegner** eines Ligaspiels werden mit Vor- und Nachnamen erfasst –
die SWO verlangt bürgerliche Namen auf dem Bogen.

Wer nicht mehr mitspielt, lässt sich **ausblenden** statt löschen — dann verschwindet
er aus der Aufstellung, seine Ergebnisse bleiben aber in Statistik, Ranglisten und
Spielverlauf erhalten. **Gäste** lassen sich dagegen jederzeit direkt
**löschen**: ohne Spiele spurlos, mit Spielen verschwinden sie sofort aus
Spielerliste, Aufstellung und Rangliste – die Partien der Mitspieler bleiben
in der Historie.

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

- **Registrieren** geht mit einem Einladungscode, den du in die Gruppe schickst.
  Keine Bestätigungsmail, kein fremder Dienst. Wer sein Passwort vergisst, wendet
  sich an dich (siehe DEPLOY.md).
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
und App-Neustart. Ältere Stände werden beim Laden automatisch auf das aktuelle
Datenmodell gehoben.

| Datei | Inhalt |
|---|---|
| `index.html` | Aufbau aller Screens |
| `css/styles.css` | Styling (Dark, Touch-Ziele ≥ 44 px) |
| `js/checkout.js` | Finish-Solver (Double-Out-Wege für Rest 2–170) |
| `js/app.js` | Turnier-, Cricket- und RTW-Logik, Statistik, Rendering, Persistenz |
| `js/auth.js` | *optional:* Anmelden, Roster, Zuordnung alter Profile |
| `js/sync.js` | *optional:* Warteschlange, Hoch- und Runterladen von Spielen |
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

Für die Kontoschicht kommen zwei Durchläufe dazu:

```bash
npm run test:api     # Server allein: Registrierung, Rechte, Rate-Limit, Grabsteine
npm run test:konto   # zwei Browser, zwei Accounts, ein gemeinsames Spiel
npm run test:alle    # alle drei nacheinander
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
