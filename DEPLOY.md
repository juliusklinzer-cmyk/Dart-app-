# Bereitstellen

Die App kann auf zwei Arten laufen. Beides ist gültig, such dir aus, was du brauchst.

| | **Nur Dateien** | **Mit Server** |
|---|---|---|
| Was nötig ist | irgendein Webserver | Docker auf einem kleinen VPS |
| Accounts | nein | ja, Anmeldung per Einladungscode |
| Statistik | nur auf dem Gerät, das mitschreibt | bei jedem unter seinem Namen |
| Offline | vollständig | vollständig (Spiele werden nachgereicht) |

Der Spielbetrieb ist in beiden Fällen identisch – die Kontoschicht (`js/auth.js`,
`js/sync.js`) schaltet sich still ab, wenn kein Server antwortet.

---

# Variante A: nur Dateien

Kein Build, kein Node zur Laufzeit, keine Datenbank.

```bash
# auf dem Server
git clone https://github.com/JuliusKlinzer/Dart-app-.git /var/www/darts
cd /var/www/darts && git pull   # später aktualisieren
```

Gebraucht werden `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`
und `sw.js`.

**HTTPS ist Pflicht**, sonst funktionieren Service Worker und damit der
Offline-Betrieb nicht (Ausnahme: `localhost`).

Caddy:

```
darts.deine-domain.de {
    root * /var/www/darts
    file_server
    encode gzip
}
```

nginx:

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

Danach `certbot --nginx -d darts.deine-domain.de`.

**GitHub Pages** tut es genauso: Repo-Einstellungen → Pages → Branch wählen.
Die App läuft dann unter `https://juliusklinzer.github.io/Dart-app-/`.
Der Konto-Knopf bleibt dabei unsichtbar – dort steht kein Server dahinter.

---

# Variante B: mit Server (darts.wirtschaftln.de)

Läuft auf demselben Hetzner-VPS wie Wirtschaftln (CPX12, `178.105.234.52`),
nach demselben Muster wie das Firmengolf-Staging: eigener Container am
gemeinsamen `edge`-Netz, **kein veröffentlichter Port**, der Wirtschaftln-Caddy
ist der einzige Eingang.

Harte Regel wie dort: **Wirtschaftln darf nichts merken.**

### Wo Darts und Wirtschaftln sich berühren – und wo nicht

| | getrennt? | warum |
|---|---|---|
| Container, Images | ja | eigenes Compose-Projekt `dart-turnier`; `--remove-orphans` wirkt nur innerhalb davon |
| Datenbank | ja | eigenes Volume `darts-data`, eigene SQLite-Datei |
| Ports | ja | Darts veröffentlicht **keinen** Port, erreichbar nur über das `edge`-Netz |
| Aufräumen nach dem Deploy | ja | `deploy.sh` löscht nur eigene verwaiste Images, kein hostweites `image prune` |
| **Caddy-Konfiguration** | **nein** | ein Site-Block im Wirtschaftln-Caddyfile – deshalb von Hand (Schritt 4) |
| **DNS-Namen im `edge`-Netz** | **nein** | Docker vergibt den *Dienstnamen* als Alias – siehe Warnung unten |
| **Arbeitsspeicher** | **nein** | 2 GB für alles; darum `mem_limit: 200m` und `cpu_shares: 512` |

Die drei unteren Zeilen sind die, auf die es ankommt.

**DNS-Namen — der Fallstrick, der uns am 24.08.2026 erwischt hat.** Docker
Compose vergibt den **Dienstnamen** als DNS-Alias auf *jedem* Netz, dem der
Dienst beitritt. Der Darts-Dienst hieß zuerst `app` – genauso wie der von
Wirtschaftln. Damit zeigte `app` im gemeinsamen `edge`-Netz plötzlich auf den
Darts-Container, der Wirtschaftln-Caddy landete dort auf Port 3000 (wo nichts
lauscht), und wirtschaftln.de lieferte rund eine Minute lang `502`.

Der Dienst heißt jetzt `darts`. **Vor jedem neuen Dienst am `edge`-Netz prüfen,
welche Namen schon belegt sind:**

```bash
ssh root@178.105.234.52 "docker network inspect edge --format '{{range .Containers}}{{.Name}} {{end}}'"
# und gegenprüfen, wohin ein Name aus Caddys Sicht zeigt:
ssh root@178.105.234.52 "docker exec wirtschaftln-caddy-1 getent hosts app"
```

Belegt sind derzeit: `app`, `caddy` (Wirtschaftln) · `api`, `web`, `fg-api`,
`fg-web` (Firmengolf-Staging) · `darts`, `darts-app` (uns).

**Caddy**: Der Block wird per `caddy reload` eingespielt, nicht per Neustart.
Bei einem Syntaxfehler behält Caddy die alte Konfiguration – trotzdem vorher
`caddy validate` laufen lassen, das kostet zwei Sekunden.

**SSE (Kamera-Kopplung)**: `/api/kamera/.../strom` ist ein Dauerstrom
(Server-Sent Events). Caddy puffert `text/event-stream` von Haus aus nicht,
und der Server schickt alle 25 s ein Lebenszeichen gegen Idle-Timeouts.
Sollte die Kopplung hinter dem Proxy trotzdem abreißen, im Site-Block
`reverse_proxy` ein `flush_interval -1` ergänzen. Beim nächsten Deploy einmal
real prüfen: iPhone koppeln und ~2 Minuten warten – die Verbindung muss
stehen bleiben.

**Speicher**: Wirtschaftln hat in seiner Compose-Datei **kein** Limit gesetzt,
läuft also unbegrenzt. Darts ist auf 200 MB gedeckelt und kann folglich nicht
derjenige sein, der die Kiste vollmacht. Zusammen mit dem Firmengolf-Staging
(900 MB an Limits) sind rund 1,1 GB gebunden, der Rest bleibt Wirtschaftln und
dem Betriebssystem. Das passt, ist aber die Stelle, die man nach dem ersten
Deploy anschaut:

```bash
ssh root@178.105.234.52 "docker stats --no-stream; free -m"
```

Wird es eng, ist der erste Hebel das Firmengolf-Staging – das ist Wegwerf-Testware,
Wirtschaftln und Darts sind es nicht.

## Was dahinter steckt

Ein einziger Node-Prozess (`server/main.mjs`) liefert die Seite **und** die API
aus. Keine Laufzeit-Abhängigkeiten: SQLite steckt seit Node 22.5 in der
Laufzeit (`node:sqlite`), Passwörter macht `node:crypto`.

Der Server kennt **keine Dart-Regeln**. Er nimmt fertige Spiele als JSON
entgegen, merkt sich wer mitgespielt hat, und gibt sie wieder heraus.
Gerechnet wird weiterhin im Browser aus den gespeicherten Würfen.

## Einmalige Einrichtung

**1. DNS.** Die Zone `wirtschaftln.de` liegt bei Hetzner (Nameserver
`ns1.your-server.de`, `ns.second-ns.com`, `ns3.second-ns.de`) — je nach Account
unter **robot.hetzner.com → DNS** oder in der **DNS-Console (dns.hetzner.com)**.

| Typ | Name | Wert |
|---|---|---|
| `A` | `darts` | `178.105.234.52` |
| `AAAA` *(optional)* | `darts` | `2a01:4f8:1c18:c092::1` |

Nur `darts` ins Namensfeld, nicht `darts.wirtschaftln.de` — die Maske hängt die
Zone selbst an, sonst entsteht `darts.wirtschaftln.de.wirtschaftln.de`.

Prüfen, bevor es weitergeht:

```bash
nslookup darts.wirtschaftln.de 8.8.8.8   # muss 178.105.234.52 zeigen
```

Caddy holt das Zertifikat danach selbst. Ein Wildcard-Eintrag existiert nicht
(Stand 24.08.2026), es funkt also nichts dazwischen.

**2. Einladungscode festlegen.**

```bash
npm run invite                  # würfelt einen Code
npm run invite -- dartabend26   # oder einen eigenen
```

Der Code geht an die Kollegen, der ausgegebene Hash auf den Server:

```bash
ssh root@178.105.234.52 "mkdir -p /opt/dart-turnier"
# deploy/env.example als Vorlage, dann:
ssh root@178.105.234.52 "nano /opt/dart-turnier/.env"
```

Den Klartext-Code irgendwo notieren – aus dem Hash lässt er sich nicht
zurückrechnen.

**3. Deployen.**

```bash
bash deploy/deploy.sh
```

Das Skript baut lokal (der 2-GB-Server baut nie selbst), lässt vorher die Tests
laufen, schiebt das Image per SSH rüber und macht eine Rauchprobe. Bis hierher
ist Wirtschaftln nicht angefasst worden — der Container läuft, ist aber von
außen noch nicht erreichbar.

**4. Caddy — der einzige Schritt, der Wirtschaftln berührt.**

Der Site-Block liegt fertig in [`deploy/Caddyfile.snippet`](deploy/Caddyfile.snippet),
**bewusst nicht** automatisch eingetragen: der Wirtschaftln-Caddy ist der einzige
Eingang für `wirtschaftln.de`, eine kaputte Konfiguration nimmt die Seite mit.

Den Block ans Ende von `Wirtschaftln/deploy/Caddyfile` anfügen, hochladen — und
**vor** dem Neuladen prüfen:

```bash
cd ~/projects/Wirtschaftln
rsync -az --exclude node_modules --exclude .next --exclude 'app/data' \
  --exclude .git --exclude 'deploy/.env' ./ root@178.105.234.52:/opt/wirtschaftln/

# Erst validieren …
ssh root@178.105.234.52 "cd /opt/wirtschaftln && \
  docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile"

# … und nur bei "Valid configuration" neu laden:
ssh root@178.105.234.52 "cd /opt/wirtschaftln && \
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile"
```

`caddy reload` tauscht die Konfiguration im laufenden Betrieb — kein Neustart,
keine Unterbrechung für Wirtschaftln. Bei einem Fehler behält Caddy die alte
Konfiguration und die Seite bleibt oben.

Reihenfolge einhalten: DNS (Schritt 1) vor dem Caddy-Block, sonst versucht Caddy
im Minutentakt vergeblich ein Zertifikat zu holen. Wirtschaftln läuft dabei
weiter — Caddy behandelt Zertifikate je Site getrennt — aber die Logs sind dann
unbrauchbar.

## Updates einspielen

```bash
bash deploy/deploy.sh
```

Migrationen laufen beim Start automatisch, jede `.sql`-Datei genau einmal
(Bookkeeping in `migrations`). Die Datenbank liegt im Volume `darts-data` und
übersteht jedes Redeploy.

Bei Änderungen an `css/`, `js/` oder `index.html`: **`CACHE` in `sw.js`
hochzählen** (`v2`, `v3`, …), sonst bekommen installierte Geräte das Update nie.

## Passwort vergessen

Es werden keine Mails verschickt – das läuft über dich:

```bash
ssh root@178.105.234.52 \
  "cd /opt/dart-turnier && docker compose -f compose.yml exec darts \
   node server/scripts/reset-password.mjs kollege@example.de neuesPasswort2026"
```

Alle Geräte dieses Kontos werden dabei abgemeldet.

## Backup (einrichten!)

Die SQLite-Datei läuft im WAL-Modus – **nie** roh kopieren.
`server/scripts/backup.mjs` nutzt `VACUUM INTO` und behält die letzten 14
Stände unter `/data/backups`.

Host-Crontab (`crontab -e`), täglich 04:30 plus Kopie aus dem Container:

```cron
30 4 * * * cd /opt/dart-turnier && docker compose -f compose.yml exec -T darts node server/scripts/backup.mjs && docker cp darts-app:/data/backups ./backups-offsite >> backup.log 2>&1
```

Idealerweise `./backups-offsite` zusätzlich per rsync auf einen anderen Rechner
spiegeln. Profilbilder liegen als Data-URLs mit in der Datenbank, sind also
automatisch mitgesichert.

## Nach jedem Deploy kurz prüfen

1. `docker compose -f /opt/dart-turnier/compose.yml ps` → `darts-app` ist `Up (healthy)`
2. `docker stats --no-stream` → bleibt Luft für Wirtschaftln?
3. https://darts.wirtschaftln.de öffnen → Seite lädt, TLS-Schloss ok
4. Anmelden → Konto-Bildschirm zeigt den eigenen Namen
5. „Jetzt abgleichen" antippen → „Alles auf dem neuesten Stand."
6. https://wirtschaftln.de öffnen → läuft unverändert

## Darts wieder abschalten

Falls die Kiste doch zu eng wird oder etwas klemmt – in dieser Reihenfolge,
Wirtschaftln merkt davon nichts:

```bash
# 1. Container stoppen. Das Volume mit der Datenbank bleibt.
ssh root@178.105.234.52 "cd /opt/dart-turnier && docker compose -f compose.yml down"

# 2. Site-Block aus Wirtschaftln/deploy/Caddyfile entfernen, hochladen, prüfen, neu laden
ssh root@178.105.234.52 "cd /opt/wirtschaftln && \
  docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile && \
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile"
```

Damit ist der Zustand von vorher wiederhergestellt. Die Spieldaten liegen
weiterhin im Volume `dart-turnier_darts-data` und auf jedem Gerät im
`localStorage` – die App läuft dort einfach wieder als lokale App weiter.
Erst `docker volume rm dart-turnier_darts-data` wirft die Serverdaten weg.

## Lokal entwickeln

```bash
npm run invite -- testcode123
DARTS_INVITE_HASH='<der ausgegebene Hash>' npm run server
# http://localhost:3002
```

Cookies sind lokal ohne `Secure` gesetzt, sonst käme die Session über
`http://` nie beim Browser an.

> Unter WSL: den Server **innerhalb** von WSL starten. Über den
> `\\wsl.localhost`-Netzwerkpfad von Windows aus scheitert SQLite am
> Dateisperren (SMB), die Datenbank meldet dann „database is locked".

---

## Auf den Geräten einrichten

Jeder öffnet die Adresse einmal im Browser und wählt im Teilen-Menü
**„Zum Home-Bildschirm"**. Danach startet die App ohne Browserleiste, mit
eigenem Icon, und funktioniert auch ohne Netz.

Wichtig: **Immer dieselbe Adresse benutzen.** Der lokale Spielstand hängt am
Browser und damit an der Adresse – wer mal über die eine und mal über eine
andere URL spielt, hat zwei getrennte Bestände. Bei Variante B gleichen sich
die abgeschlossenen Spiele über den Account zwar wieder ab, das laufende
Turnier aber nicht.
