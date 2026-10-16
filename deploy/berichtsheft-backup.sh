#!/usr/bin/env bash
# Berichtsheft - naechtliche Sicherung.
# Taegliche Sicherungen bleiben 14 Tage, Monatssicherungen 4 Jahre
# (Ausbildungsnachweise werden fuer die Abschlusspruefung und danach noch gebraucht).
set -euo pipefail

BASE=/var/lib/berichtsheft
BACKUP=/var/backups/berichtsheft
DAY=$(date +%F)

tar -czf "$BACKUP/taeglich-$DAY.tar.gz" -C "$BASE" data
chmod 600 "$BACKUP/taeglich-$DAY.tar.gz"
if [ "$(date +%d)" = "01" ]; then
  cp "$BACKUP/taeglich-$DAY.tar.gz" "$BACKUP/monatlich-$(date +%Y-%m).tar.gz"
fi

find "$BACKUP" -name 'taeglich-*.tar.gz' -mtime +14 -delete
find "$BACKUP" -name 'vor-update-*.tar.gz' -mtime +14 -delete
find "$BACKUP" -name 'monatlich-*.tar.gz' -mtime +1461 -delete
