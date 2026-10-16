#!/usr/bin/env bash
# Berichtsheft - Einrichtung auf einem Ubuntu-Server.
# Aufruf als root:  bash /opt/berichtsheft/deploy/setup.sh
# Andere Adresse:   DOMAIN=andere-domain.de bash /opt/berichtsheft/deploy/setup.sh
# Kann gefahrlos noch einmal ausgefuehrt werden. Andere Programme auf dem Server werden nicht angefasst.
set -euo pipefail

DOMAIN="${DOMAIN:-bh-bremen.de}"
REPO_DIR=/opt/berichtsheft
BASE_DIR=/var/lib/berichtsheft
DATA_DIR=$BASE_DIR/data
BACKUP_DIR=/var/backups/berichtsheft
LT_DIR=/opt/languagetool
PORT=3100
LT_PORT=8081
CADDY_SITE=/etc/caddy/berichtsheft.caddy

say() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausfuehren."; exit 1; }
[ -f "$REPO_DIR/server.js" ] || { echo "Berichtsheft liegt nicht in $REPO_DIR."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Bitte die Adresse angeben, z. B.:  DOMAIN=berichte.deine-domain.de bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "0/6 Node.js und Caddy pruefen"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git unzip debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
[ -f /etc/caddy/Caddyfile ] || touch /etc/caddy/Caddyfile
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; fi

say "1/6 Benutzer und Ordner anlegen"
id berichtsheft >/dev/null 2>&1 || useradd --system --home "$BASE_DIR" --shell /usr/sbin/nologin berichtsheft
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R berichtsheft:berichtsheft "$BASE_DIR"
chmod 750 "$BASE_DIR"
chmod 700 "$BACKUP_DIR"
chmod -R a+rX "$REPO_DIR"

say "2/6 Rechtschreibpruefung (LanguageTool) einrichten - dauert ein paar Minuten"
apt-get install -y openjdk-21-jre-headless || apt-get install -y openjdk-17-jre-headless
id languagetool >/dev/null 2>&1 || useradd --system --home "$LT_DIR" --shell /usr/sbin/nologin languagetool
if [ ! -f "$LT_DIR/current/languagetool-server.jar" ]; then
  mkdir -p "$LT_DIR"
  TMP=$(mktemp -d)
  curl -fL --retry 3 -o "$TMP/lt.zip" https://languagetool.org/download/LanguageTool-stable.zip
  unzip -q "$TMP/lt.zip" -d "$LT_DIR"
  rm -rf "$TMP"
  LTV=$(ls -d "$LT_DIR"/LanguageTool-* | sort -V | tail -1)
  ln -sfn "$LTV" "$LT_DIR/current"
fi
chown -R languagetool:languagetool "$LT_DIR"
# Speicher an den Server anpassen (andere Programme brauchen auch Platz)
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2500 ]; then LT_MEM=384m; elif [ "$MEM_MB" -lt 5000 ]; then LT_MEM=640m; else LT_MEM=1g; fi
cat > /etc/systemd/system/languagetool.service <<EOF
[Unit]
Description=LanguageTool Rechtschreibpruefung (nur lokal)
After=network.target

[Service]
User=languagetool
Group=languagetool
WorkingDirectory=$LT_DIR/current
ExecStart=/usr/bin/java -Xmx$LT_MEM -cp languagetool-server.jar org.languagetool.server.HTTPServer --port $LT_PORT
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$LT_DIR

[Install]
WantedBy=multi-user.target
EOF

say "3/6 Berichtsheft als Dienst einrichten"
cat > /etc/systemd/system/berichtsheft.service <<EOF
[Unit]
Description=Berichtsheft
After=network-online.target languagetool.service
Wants=network-online.target

[Service]
User=berichtsheft
Group=berichtsheft
WorkingDirectory=$REPO_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=BH_DATA=$DATA_DIR
Environment=BH_SECURE=1
Environment=TRUST_PROXY=1
Environment=LT_URL=http://127.0.0.1:$LT_PORT
ExecStart=/usr/bin/node $REPO_DIR/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$BASE_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

say "4/6 Adresse $DOMAIN bei Caddy eintragen"
cat > "$CADDY_SITE" <<EOF
# Berichtsheft - wird von /opt/berichtsheft/deploy/setup.sh geschrieben
$DOMAIN {
	encode gzip
	header Strict-Transport-Security "max-age=31536000"
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy 127.0.0.1:$PORT
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
grep -qxF "import $CADDY_SITE" /etc/caddy/Caddyfile || printf '\nimport %s\n' "$CADDY_SITE" >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

say "5/6 Updates und Sicherungen einrichten"
install -m 750 "$REPO_DIR/deploy/berichtsheft-update.sh" /usr/local/sbin/berichtsheft-update
install -m 750 "$REPO_DIR/deploy/berichtsheft-backup.sh" /usr/local/sbin/berichtsheft-backup
git config --global --add safe.directory "$REPO_DIR"
cat > /etc/systemd/system/berichtsheft-update.service <<'EOF'
[Unit]
Description=Berichtsheft Update von GitHub holen
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/berichtsheft-update
EOF
cat > /etc/systemd/system/berichtsheft-update.timer <<'EOF'
[Unit]
Description=Alle 3 Minuten nach Berichtsheft-Updates schauen
[Timer]
OnBootSec=3min
OnUnitActiveSec=3min
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/berichtsheft-backup.service <<'EOF'
[Unit]
Description=Berichtsheft taegliche Sicherung
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/berichtsheft-backup
EOF
cat > /etc/systemd/system/berichtsheft-backup.timer <<'EOF'
[Unit]
Description=Berichtsheft jede Nacht sichern
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

say "6/6 Starten"
systemctl daemon-reload
systemctl enable --now languagetool
systemctl enable --now berichtsheft
systemctl restart berichtsheft
systemctl enable --now berichtsheft-update.timer berichtsheft-backup.timer
systemctl reload caddy || systemctl restart caddy

sleep 3
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  say "Fertig! Das Berichtsheft laeuft."
  echo "Adresse: https://$DOMAIN"
  echo "Wichtig: Beim Domain-Anbieter muessen die A-Eintraege fuer $DOMAIN und www.$DOMAIN auf die IP dieses Servers zeigen:"
  curl -fsS -4 https://ifconfig.me 2>/dev/null && echo
  if [ -f "$BASE_DIR/secret/setup-code.txt" ]; then
    echo
    echo "Einrichtungs-Code fuer das Admin-Konto:  $(cat "$BASE_DIR/secret/setup-code.txt")"
  fi
  echo
  echo "Die Rechtschreibpruefung braucht nach dem Start etwa 30 Sekunden, bis sie antwortet."
else
  say "Das Berichtsheft startet nicht. Bitte diese Zeilen an Claude schicken:"
  journalctl -u berichtsheft -n 30 --no-pager
fi
