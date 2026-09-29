#!/usr/bin/env bash
# Dart-Turnier auf den geteilten Wirtschaftln-Server bringen.
#
# Gebaut wird IMMER lokal: der Server hat 2 GB und teilt sie sich schon mit
# Wirtschaftln und dem Firmengolf-Staging -- der soll nicht auch noch
# Docker-Images bauen muessen.
#
# Aufruf aus dem Repo-Wurzelverzeichnis:  bash deploy/deploy.sh
#
# Wohin es geht, steht NICHT im Repo, sondern in einer lokalen `.env` im
# Repo-Wurzelverzeichnis (Vorlage: .env.example) oder in der Umgebung:
#   DARTS_SERVER=root@<server-ip>   (Pflicht)
#   DARTS_ZIEL=/opt/dart-turnier    (optional)
#   DARTS_URL=https://darts.example.de   (optional, nur fuer die Ausgabe)
set -euo pipefail

cd "$(dirname "$0")/.."

# Einzelne Werte aus .env lesen, ohne die Datei als Shell-Skript
# auszufuehren (ein Hash mit $-Zeichen darin wuerde sonst zerlegt).
env_wert() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

SERVER="${DARTS_SERVER:-$(env_wert DARTS_SERVER)}"
ZIEL="${DARTS_ZIEL:-$(env_wert DARTS_ZIEL)}"
ZIEL="${ZIEL:-/opt/dart-turnier}"
URL="${DARTS_URL:-$(env_wert DARTS_URL)}"
URL="${URL:-https://darts.wirtschaftln.de}"
if [ -z "$SERVER" ]; then
  echo "FEHLER: DARTS_SERVER ist nicht gesetzt (z. B. root@<server-ip>)."
  echo "        In .env im Repo-Wurzelverzeichnis eintragen -- Vorlage: .env.example"
  exit 1
fi

echo "── 1/6 Tests ──"
# Nie etwas hochladen, das lokal nicht laeuft.
#
# DARTS_SKIP_TESTS=1 ueberspringt sie -- gedacht fuer den Fall, dass die Tests
# gerade woanders gelaufen sind (z. B. auf der Windows-Seite, wo der
# Playwright-Browser liegt) und hier nur noch deployt werden soll. Bewusst
# laut, damit es nie aus Versehen passiert.
if [ "${DARTS_SKIP_TESTS:-}" = "1" ]; then
  echo "   ÜBERSPRUNGEN (DARTS_SKIP_TESTS=1) -- die Tests müssen anderswo grün gewesen sein!"
else
  node tests/e2e.mjs
  node tests/api.mjs
fi

echo "── 2/6 Einzeldatei-Buendel nachziehen ──"
node build-single.mjs

echo "── 3/6 Image bauen ──"
docker build -f deploy/Dockerfile -t dart-turnier:latest .

echo "── 4/6 Image auf den Server schieben (gzip ueber SSH) ──"
docker save dart-turnier:latest | gzip | ssh "$SERVER" "gunzip | docker load"

echo "── 5/6 Compose-Datei und Backup-Skript synchronisieren ──"
ssh "$SERVER" "mkdir -p $ZIEL"
# WICHTIG: .env ist ausgenommen. Die Secrets liegen NUR auf dem Server, ein
# unbedachtes --delete oder Ueberschreiben wuerde den Einladungscode killen.
rsync -az deploy/compose.yml deploy/backup.sh "$SERVER:$ZIEL/"

echo "── 6/6 Neustart und Rauchprobe ──"
ssh "$SERVER" "test -f $ZIEL/.env || { echo 'FEHLER: $ZIEL/.env fehlt (Vorlage: deploy/env.example)'; exit 1; }"
# --remove-orphans wirkt nur innerhalb des Compose-Projekts "dart-turnier"
# (Docker-Label com.docker.compose.project) -- Wirtschaftln und das
# Firmengolf-Staging sind eigene Projekte und bleiben unberuehrt.
ssh "$SERVER" "cd $ZIEL && docker compose -f compose.yml up -d --remove-orphans"

# Aufraeumen NUR unter unserem eigenen Namen. Ein pauschales
# `docker image prune -f` wuerde hostweit alle unbenutzten Layer wegwerfen,
# auch die von Wirtschaftln -- damit waere dort kein schnelles Zurueck auf
# eine aeltere Version mehr moeglich.
ssh "$SERVER" "docker images dart-turnier --filter dangling=true -q | xargs -r docker rmi >/dev/null 2>&1 || true"
sleep 4
ssh "$SERVER" "docker exec darts-app node -e \"fetch('http://127.0.0.1:3002/api/ping').then(r=>{console.log('ping',r.status);process.exit(r.ok?0:1)})\""

echo
echo "Fertig: $URL"
echo "Danach kurz pruefen:"
echo "  ssh $SERVER 'docker compose -f $ZIEL/compose.yml ps'"
echo "  ssh $SERVER 'docker stats --no-stream'   # bleibt Luft fuer Wirtschaftln?"
