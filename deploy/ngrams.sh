#!/usr/bin/env bash
# Berichtsheft - bessere Rechtschreibpruefung mit Wortstatistik (n-Gramme) fuer Deutsch.
# Erkennt dann z. B. das/dass, seid/seit, wider/wieder, Gross-/Kleinschreibung im Zusammenhang besser.
# Braucht ca. 5 GB freien Platz (Download 1,7 GB, entpackt ca. 3 GB). Einmalig ausfuehren:
#   bash /opt/berichtsheft/deploy/ngrams.sh
set -euo pipefail
DIR=/opt/languagetool/ngrams
UNIT=/etc/systemd/system/languagetool.service
[ "$(id -u)" = 0 ] || { echo "Bitte als root ausfuehren."; exit 1; }

FREE_GB=$(df --output=avail -BG /opt | tail -1 | tr -dc 0-9)
if [ "$FREE_GB" -lt 6 ]; then echo "Zu wenig Platz: nur ${FREE_GB} GB frei, gebraucht werden etwa 6 GB."; exit 1; fi

if [ ! -d "$DIR/de" ]; then
  echo "Lade die deutsche Wortstatistik (1,7 GB). Das dauert ein paar Minuten ..."
  mkdir -p "$DIR"
  curl -fL --retry 3 -o "$DIR/de.zip" https://languagetool.org/download/ngram-data/ngrams-de-20150819.zip
  echo "Entpacken ..."
  unzip -q "$DIR/de.zip" -d "$DIR"
  rm -f "$DIR/de.zip"
  chown -R languagetool:languagetool "$DIR"
fi

if ! grep -q -- '--languageModel' "$UNIT"; then
  sed -i "s#org.languagetool.server.HTTPServer --port#org.languagetool.server.HTTPServer --languageModel $DIR --port#" "$UNIT"
fi
systemctl daemon-reload
systemctl restart languagetool
echo "Fertig. Die Rechtschreibpruefung nutzt jetzt die Wortstatistik. Nach etwa einer Minute ist sie wieder bereit."
