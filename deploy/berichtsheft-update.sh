#!/usr/bin/env bash
# Berichtsheft - holt neue Versionen von GitHub. Laeuft alle 3 Minuten.
# Vor jedem Update werden die Daten gesichert. Startet die neue Version nicht, geht es automatisch zurueck.
set -euo pipefail

REPO=/opt/berichtsheft
BASE=/var/lib/berichtsheft
BACKUP=/var/backups/berichtsheft
LOG=/var/log/berichtsheft-update.log
HEALTH=http://127.0.0.1:3100/api/health
CADDY_SITE=/etc/caddy/berichtsheft.caddy

exec 9>/run/berichtsheft-update.lock
flock -n 9 || exit 0

# Falls die Caddy-Einstellung neu geschrieben wurde (z. B. durch die Zeus-OS-Einrichtung): Eintrag wiederherstellen
if [ -f "$CADDY_SITE" ] && ! grep -qxF "import $CADDY_SITE" /etc/caddy/Caddyfile; then
  printf '\nimport %s\n' "$CADDY_SITE" >> /etc/caddy/Caddyfile
  systemctl reload caddy && echo "$(date +%F_%H%M%S) Caddy-Eintrag wiederhergestellt" >> "$LOG"
fi

cd "$REPO"
git fetch --quiet origin main
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse origin/main)
[ "$OLD" = "$NEW" ] && exit 0

TS=$(date +%F_%H%M%S)
echo "$TS Update ${OLD:0:7} -> ${NEW:0:7}" >> "$LOG"
SNAP="$BACKUP/vor-update-$TS.tar.gz"
tar -czf "$SNAP" -C "$BASE" data
chmod 600 "$SNAP"

git reset --quiet --hard "$NEW"
chmod -R a+rX "$REPO"
systemctl restart berichtsheft

for _ in $(seq 1 25); do
  sleep 1
  if curl -fsS "$HEALTH" >/dev/null 2>&1; then
    echo "$TS ok" >> "$LOG"
    exit 0
  fi
done

echo "$TS FEHLER: neue Version startet nicht. Zurueck auf ${OLD:0:7} und Daten von vor dem Update." >> "$LOG"
systemctl stop berichtsheft
git reset --quiet --hard "$OLD"
rm -rf "$BASE/data.kaputt"
mv "$BASE/data" "$BASE/data.kaputt"
tar -xzf "$SNAP" -C "$BASE"
chown -R berichtsheft:berichtsheft "$BASE/data"
systemctl start berichtsheft
exit 1
