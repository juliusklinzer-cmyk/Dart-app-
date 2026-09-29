#!/usr/bin/env bash
# Taegliche Sicherung auf dem Server -- laeuft auf dem HOST (Crontab), nicht
# im Container. deploy.sh legt es nach /opt/dart-turnier/backup.sh.
#
#   1. im Container: server/scripts/backup.mjs schreibt per VACUUM INTO eine
#      in sich geschlossene Kopie nach /data/backups (letzte 14 Staende),
#   2. auf dem Host: diese Staende nach ./backups-lokal spiegeln -- so
#      ueberleben sie auch ein versehentlich geloeschtes Docker-Volume,
#   3. optional: per rsync auf einen ZWEITEN Rechner (DARTS_BACKUP_OFFSITE).
#      Nur das schuetzt vor dem Totalausfall des Servers.
#
# DARTS_BACKUP_OFFSITE kommt aus der Umgebung oder aus /opt/dart-turnier/.env,
# z. B.  DARTS_BACKUP_OFFSITE=backup@nas.example.de:/volume1/darts/
# Der Host braucht dafuer einen SSH-Schluessel ohne Passphrase fuer das Ziel.
#
# Crontab (crontab -e), taeglich 04:30:
#   30 4 * * * /opt/dart-turnier/backup.sh >> /opt/dart-turnier/backup.log 2>&1
set -euo pipefail

ZIEL="$(cd "$(dirname "$0")" && pwd)"
cd "$ZIEL"

# Nur diesen einen Wert aus .env lesen -- die Datei nicht als Shell-Skript
# ausfuehren, der Einladungs-Hash darin enthaelt $-Zeichen.
OFFSITE="${DARTS_BACKUP_OFFSITE:-}"
if [ -z "$OFFSITE" ] && [ -f .env ]; then
  OFFSITE="$(grep -E '^DARTS_BACKUP_OFFSITE=' .env | tail -n 1 | cut -d= -f2- || true)"
fi

echo "── $(date -Iseconds) Sicherung ──"
docker compose -f compose.yml exec -T darts node server/scripts/backup.mjs

# Spiegeln: erst in einen frischen Ordner, dann austauschen -- so liegt nie
# ein halb kopierter Stand unter backups-lokal.
rm -rf backups-lokal.neu
mkdir -p backups-lokal.neu
docker cp darts-app:/data/backups/. backups-lokal.neu/
rm -rf backups-lokal
mv backups-lokal.neu backups-lokal
echo "Lokal gespiegelt: $(ls backups-lokal | wc -l) Staende unter $ZIEL/backups-lokal"

if [ -n "$OFFSITE" ]; then
  # Ohne --delete: auf dem zweiten Rechner duerfen aeltere Staende liegen
  # bleiben, das ist dort ausdruecklich erwuenscht.
  rsync -az backups-lokal/ "$OFFSITE"
  echo "Offsite kopiert nach: $OFFSITE"
else
  echo "Kein DARTS_BACKUP_OFFSITE gesetzt -- keine Kopie ausser Haus."
fi
