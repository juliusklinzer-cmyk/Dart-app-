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

Cricket, Round the World, Finisher und das Schnelle Spiel gehen auch **allein** –
als Training gegen sich selbst. Allein wird nicht ausgebullt, es geht direkt los,
und der Spielbildschirm zeigt eine große Karte mit Finish-Vorschlag. Nur das
X01-Turnier braucht mindestens zwei Spieler, es ist ja jeder gegen jeden.

### Schnelles Spiel

Alle ausgewählten Spieler an einem Board, reihum, 501 (oder 301/701) Double Out –
ohne Spielplan. Startpunkte und Einzel-Dart-Grenze teilt es sich mit dem Turnier.
Dazu kommt die **Spieldauer** wie bei einem kleinen Turnier: **First to** oder
**Best of**, und je ein Zähler für **Sätze** und **Legs** (Best of zählt in
Zweierschritten, 1 Satz / 1 Leg ist das alte „wer zuerst auscheckt“). **First to:** Ein
Satz geht an den, der zuerst die Legs hat, das Spiel an den, der zuerst die Sätze hat.
**Best of:** Alle Legs werden gespielt, der Satz geht an den mit den meisten Legs, das
Spiel an den mit den meisten Sätzen – bei Gleichstand (ab drei Spielern) geht es weiter,
bis einer vorne liegt. Der Anwurf wandert Leg für Leg weiter, der Kopf zählt Satz und
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
(50 €) bezahlt ist; „Ich habe eingezahlt“ bzw. beim Kassenwart „Bezahlt“ bucht ihn
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
Künstlernamen). Jedes Einzel trägt seine Scheibe (S1/S2); je zwei Einzel laufen parallel, und jeder Spieler beider Teams spielt genau 2× an S1 und 2× an S2. Ist der Abend durch, wird der **Spielbericht am iPad unterschrieben**: „Unterschreiben“ öffnet nacheinander je einen ganzen Bildschirm für TC Heim und TC Gast (mit dem Finger, „Nochmal“ löscht), danach die Mailadressen (Ligaleitung vorbelegt, die übrigen werden gemerkt). „Senden“ macht aus dem Bogen – genau wie er auf dem Bildschirm steht, mit allen Handkorrekturen und Unterschriften – ein zweiseitiges A4-PDF und öffnet das Teilen-Menü; die Adressen sind dann schon kopiert und werden in der Mail nur eingefügt. Ohne Teilen-Menü (Computer) wird das PDF heruntergeladen und die Mail mit Empfängern geöffnet. Im **Spielbericht** zeigt jede Einzel-Zeile die echte Bogennummer der Spieler: Wer eingewechselt wurde, steht dort als H5–H8 bzw. G5–G8. Bis zur Unterschrift ist jedes Feld anpassbar (auch die Einzel-Bezeichnung), Nachmeldungen und Proteste werden per Tipp auf „ja“ oder „nein“ angekreuzt. Sobald **beide TCs unterschrieben** haben, ist der Bericht **final**: kein Feld lässt sich mehr ändern, oben steht nur noch „Versenden“. **Abschluss:** Nach dem letzten Einzel wird das Ligaspiel nicht beendet. Es kommen zuerst die **Ergebnisse** mit den Highlights beider Teams und je einem **Man of the Day** (meiste gewonnene Einzel, bei Gleichstand der höhere Average), dann geht es zum Spielbericht. Erst wenn der unterschrieben und verschickt ist (oder „Abschließen ohne Senden“), ist das Ligaspiel abgeschlossen: Es wandert ins Archiv, im Spielplan steht der Spieltag als „Abgeschlossen“ mit Endstand, Ergebnissen und Bericht und lässt sich nicht noch einmal starten. Bis dahin bleibt es komplett offen; auch der Spiel-Tab archiviert es nicht still. Ein Spieltag mit archiviertem, aber noch nicht abgeschlossenem Ligaspiel zeigt „Bericht offen“. Im **geteilten Ligaspiel an zwei iPads** geht der Spielerwechsel als geänderter Spielplan an den Server; das andere iPad übernimmt ihn beim nächsten Abgleich, ein dort laufendes oder fertiges Einzel bleibt unberührt. Fertige Einzel, deren Ergebnis wegen eines Funklochs nicht beim Server ankam, reicht die App bei jedem Abgleich nach. **Nachmeldungen** gehen über „Spieler nachmelden“ im Ligaspiel (oder den Knopf auf Seite 2 des Berichts): Team, Nachname, Vorname, U18 ja/nein und w/m/d, danach unterschreibt die Person mit dem Finger. Sie steht dann mit Unterschrift auf Seite 2, „Nachmeldungen: ja“ ist angekreuzt, und sie gehört zum Team (H5–H8 bzw. G5–G8), einsetzbar über „Spieler wechseln“. Jedes Einzel
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
hatte) von selbst; im X01-Turnier und im Schnellen Spiel schaltet sie der ⌨-Knopf
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

**Im Reiter „Rangliste"** sind die Werte nach Spielmodus getrennt – Classic, Cricket
und Round the World haben je eigene Bestenlisten, eigene Rekordtafel und einen eigenen
Spielverlauf:

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
Statistik. Ein Schnelles Spiel über mehrere Legs lässt sich beim Abbrechen mit
„Gespielte Legs behalten“ ohne Sieger übernehmen (Average, 180er, Finishes zählen).

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
