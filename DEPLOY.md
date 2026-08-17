# Auf eigener Domain bereitstellen

Die App besteht nur aus statischen Dateien – kein Build, kein Node zur Laufzeit, keine
Datenbank. Für 10–20 Leute reicht ein normaler Webserver.

## Schritt 1: Dateien auf den Server

```bash
# auf dem Server
git clone https://github.com/JuliusKlinzer/Dart-app-.git /var/www/darts
# später aktualisieren:
cd /var/www/darts && git pull
```

Gebraucht werden nur `index.html`, `css/`, `js/`, `icon.svg`, `manifest.webmanifest`
und `sw.js`. Der Rest (Tests, Build-Skript) stört nicht, kann aber weg.

## Schritt 2: Subdomain mit HTTPS

**HTTPS ist Pflicht**, sonst funktionieren Service Worker und damit der Offline-Betrieb
nicht (Ausnahme: `localhost`).

### Variante Caddy (am wenigsten Aufwand)

`/etc/caddy/Caddyfile`:

```
darts.deine-domain.de {
    root * /var/www/darts
    file_server
    encode gzip
}
```

`systemctl reload caddy` – das Zertifikat holt Caddy selbst.

### Variante nginx

```nginx
server {
    listen 80;
    server_name darts.deine-domain.de;
    root /var/www/darts;
    index index.html;

    # Der Service Worker darf nicht im Browser-Cache festhängen,
    # sonst sehen die Geräte Updates erst viel später.
    location = /sw.js {
        add_header Cache-Control "no-cache";
    }
}
```

Danach `certbot --nginx -d darts.deine-domain.de` für das Zertifikat.

## Schritt 3: Auf den Geräten einrichten

Jeder öffnet `https://darts.deine-domain.de` einmal im Browser und wählt im
Teilen-Menü **„Zum Home-Bildschirm"**. Danach startet die App ohne Browserleiste, mit
eigenem Icon, und funktioniert auch ohne Netz.

Wichtig: **Immer dieselbe Adresse benutzen.** Profile und Statistiken liegen im
Speicher des Browsers und hängen an der Adresse – wer mal über die eine und mal über
eine andere URL spielt, hat zwei getrennte Datenbestände.

## Updates ausrollen

Nach einem `git pull` auf dem Server holen sich die Geräte die neue Version beim
nächsten Start. Damit das zuverlässig passiert, in `sw.js` die Zeile

```js
var CACHE = 'dart-turnier-v1';
```

hochzählen (`v2`, `v3`, …). Der alte Cache wird dann automatisch verworfen.

## Datenhaltung heute

Alles liegt in `localStorage` des jeweiligen Geräts: Profile mit Bild, laufendes
Spiel, Archiv aller Spiele. Das heißt:

- Das Gerät, auf dem mitgeschrieben wird, hat die vollständige Statistik.
- Andere Geräte starten mit leerem Stand.
- Browserdaten löschen löscht auch die Statistik.

Wenn alle ihre Zahlen auf dem eigenen Handy sehen sollen, braucht es einen kleinen
Sync-Dienst auf dem Server (ein gemeinsamer Liga-Code, abgeglichen werden nur
abgeschlossene Spiele und Profile – das laufende Spiel bleibt lokal, dadurch gibt es
keine Konflikte). Das ist bewusst noch nicht gebaut.

## Ohne eigenen Server

GitHub Pages tut es genauso: Repo-Einstellungen → Pages → Branch wählen → speichern.
Die App läuft dann unter `https://juliusklinzer.github.io/Dart-app-/`.
