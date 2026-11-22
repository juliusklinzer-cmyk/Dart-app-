# Autodarts an Blink 180 anschließen (Test, Windows-PC)

Autodarts erkennt die Darts mit den drei Kameras. Die Brücke liest jeden erkannten
Dart sofort aus und gibt ihn an die App im Browser weiter, die ihn wie einen Tipp
bucht. Alles läuft auf demselben PC. Das iPad braucht es dafür nicht.

```
Kameras ──USB──> Autodarts Desktop ──(127.0.0.1:3180)──> Brücke ──(127.0.0.1:3190)──> App im Browser
```

Das MacBook geht nicht: Autodarts Desktop gibt es nur für Windows und Linux.

## Einmal einrichten

1. **Autodarts Desktop** von autodarts.com installieren und starten.
   - Steck jede Kamera an einen eigenen USB-Port am PC, nicht alle an einen Hub.
     Windows macht sonst bei mehreren Kameras Ärger.
   - Im Board Manager die drei Kameras zuordnen. Sobald die Arme montiert sind,
     kalibrieren. Die Kameras sollten etwa 120° auseinander stehen.
   - Anmelden mit deinem Autodarts-Konto, wenn das Programm danach fragt.
2. **Node.js** installieren, die LTS-Version von nodejs.org, mit allen Vorgaben.
   Danach den PC einmal neu starten. Sonst meldet das Fenster später
   „node“ ist nicht als Befehl erkannt.
3. **Den Ordner `tools/autodarts-bruecke`** auf den PC holen.
   - Über GitHub: „Code › Download ZIP“, dann die ZIP mit Rechtsklick › „Alle
     extrahieren“ entpacken und im entpackten Ordner `tools\autodarts-bruecke`
     öffnen. Direkt aus der ZIP heraus starten die Dateien nicht richtig.
   - Oder per USB-Stick.
   - Im Ordner liegen `bruecke.mjs`, `start-windows.bat`, `start-demo-windows.bat`
     und die Lizenzdatei.
   - Warnt Windows beim ersten Doppelklick („Der Computer wurde durch Windows
     geschützt“), wähle „Weitere Informationen“ › „Trotzdem ausführen“.

## Jedes Mal

1. Autodarts Desktop starten. Im Board Manager die Erkennung starten, das ist der
   Knopf „Start“ oben. Unten muss der Zustand auf „Throw“ stehen.
2. Doppelklick auf **`start-windows.bat`**. Im schwarzen Fenster steht dann:
   - `Autodarts-Brücke 1.0.0 auf http://127.0.0.1:3190, Quelle http://127.0.0.1:3180`
   - wenige Augenblicke später `Board Manager verbunden`
   - danach bei jedem Wurf eine Zeile wie `dart T20 (1. Dart)`

   Lass das Fenster offen.
3. In **Chrome oder Edge** die App öffnen und wie immer anmelden. Beim ersten Mal
   diese Adresse aufrufen:
   `https://darts.wirtschaftln.de/index.html?autodarts=an`
   Der Zusatz schaltet den Anschluss nur in diesem Browser frei. Für alle anderen
   bleibt die App, wie sie ist.
4. Oben in der Mitte steht jetzt **„Autodarts aus“**. Antippen, dann auf
   **„Einschalten“** tippen.
   - Der Browser fragt beim ersten Mal, ob die Seite auf Geräte im lokalen
     Netzwerk bzw. auf Apps auf diesem Gerät zugreifen darf. Wähle **Zulassen**.
   - Aus Versehen „Blockieren“ gedrückt? Dann auf das Schloss links in der
     Adresszeile, „Website-Einstellungen“, den Punkt „Lokales Netzwerk“ bzw.
     „Apps auf diesem Gerät“ auf „Zulassen“ stellen und die Seite neu laden.
   - Steht dort **„Autodarts bereit“** mit grünem Punkt, ist alles verbunden.
5. Spiel starten wie immer und werfen.
   - Jeder Dart wird sofort gebucht.
   - Ziehst du die Darts, bevor drei erkannt waren, weil einer herausgefallen ist,
     zählen die fehlenden als daneben.
   - Falsch erkannt? Korrigiere wie gewohnt mit ← und tippe dann den richtigen
     Dart. Ist die Aufnahme schon gebucht, nimmt ← in X01 die ganze Aufnahme zurück.
   - Nach einem Bust oder Finish bucht die App weitere Darts derselben Aufnahme
     nicht mehr. Ein kurzer Hinweis sagt das.
   - Darts, die du wirfst, während ein Dialog offen ist, etwa „Leg gewonnen“,
     warten. Sie werden gebucht, sobald der Dialog zu ist.
   - Lass nur **ein** Browserfenster mit der App offen. Jedes offene Fenster bucht
     mit, auch wenn Autodarts darüber liegt.

## Ohne Kameras ausprobieren

Doppelklick auf **`start-demo-windows.bat`**. Dort tippst du die Darts selbst ein
und drückst jeweils Enter:

| Eingabe | Bedeutung |
|---|---|
| `T20`, `D16`, `S5` | ein Feld |
| `25` | Single Bull |
| `BULL` | Bullseye |
| `M` | daneben |
| `x` | Darts ziehen |

In der App erscheinen die Darts genauso wie später von den Kameras.

## Was der Punkt oben bedeutet

| Anzeige | Bedeutung | Was tun |
|---|---|---|
| grau „Autodarts aus“ | ausgeschaltet | antippen, dann „Einschalten“ |
| rot „Brücke nicht erreichbar“ | das schwarze Fenster läuft nicht | `start-windows.bat` starten |
| gelb „Board Manager fehlt“ | Autodarts läuft nicht, oder die Erkennung ist gestoppt | Autodarts starten, auf „Start“ |
| gelb „Darts ziehen“ | Autodarts wartet auf das Ziehen | Darts ziehen |
| grün „Autodarts bereit“ | alles gut | werfen |

Hakt etwas, tippe `http://127.0.0.1:3190/status` in die Adresszeile des Browsers.
Dort stehen die letzten Ereignisse als Text. Kopier den Inhalt und schick ihn an
Claude, also hier in den Chat.

Die Adresse der Brücke in der Karte bleibt `http://127.0.0.1:3190`. Andere Adressen
lässt die App aus Sicherheitsgründen nicht zu.

## Wenn keine Darts ankommen

Manche Autodarts-Versionen liefern die Würfe lokal nicht mehr aus. Dann steht in
der Karte, die beim Antippen des Punkts aufgeht: „Board meldet Würfe, aber ohne
Liste“. Sag mir dann Bescheid. Der Plan B ist dann der Weg über die
Autodarts-Cloud mit dem fertigen Werkzeug darts-caller, das sich mit deinem
Konto anmeldet.
