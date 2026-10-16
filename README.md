# Berichtsheft

Digitaler Ausbildungsnachweis (wöchentlich) mit automatischem Vorausfüllen,
Rechtschreib- und Grammatikprüfung, digitaler Unterschrift und PDF-Export.
Eigenständiges Programm unter https://bh-bremen.de

## Was es kann
- **Original-Formular:** Ausgefüllt wird die Vorlage „Ausbildungsnachweis (Berichtsheft) – täglich“ der
  Handelskammer Bremen (`lib/vorlage/`). Die Vorlage bleibt unverändert, Text und Unterschrift kommen darüber.
- **Neuer Wochenbericht** mit einem Tipp: Woche und fortlaufende Nummer werden vorgeschlagen (Nummer änderbar),
  Ausbildungsbereich auswählen (z. B. AW, BBS, Betrieb). Darunter die Liste der eigenen Berichte.
- **Automatisch ausgefüllt:** Name, Ausbildungsjahr, Woche vom/bis, Stunden aus den Einstellungen,
  Berufsschultage und Feiertage (Bremen voreingestellt). Bei „BBS“ wird die ganze Woche als Schule vorbelegt.
- **Speichert von selbst** bei jeder Änderung. Man kann jeden Tag etwas eintragen und erst am Ende der Woche unterschreiben.
- **Rechtschreibung und Grammatik:** LanguageTool auf dem eigenen Server. Vorschläge antippen, „So lassen“ oder
  ins eigene Wörterbuch. Zu langer Text für ein Feld wird angezeigt.
- **Unterschrift** einmal in den Einstellungen hinterlegen. Beim Unterschreiben Datum wählen (heute oder ein anderes),
  die Unterschrift sitzt jedes Mal minimal anders, wie von Hand.
- **PDF** mit festem Namen, Standard `Berichtsheft_{nachname}_NR{nr}` → `Berichtsheft_Witting_NR7.pdf`.
  Am PC (Chrome/Edge) kann ein fester Speicherordner eingestellt werden, am Handy öffnet sich „In Dateien sichern“.
- **Nachträglich bearbeiten:** 90 Tage nach dem Unterschreiben (einstellbar). Korrekturen werden klein im PDF vermerkt.
- **Admin:** Konten anlegen, sperren, Passwort zurücksetzen, alle Berichte sehen, Fristen verlängern,
  Bereiche, Dateiname, Feiertage und vorausgefüllte Texte einstellen.

## Aufbau
- `server.js` – Server ohne Zusatzpakete (Node.js 20 oder neuer)
- `lib/` – Kalender und Feiertage, Ausfüllen der Vorlage, PNG-Leser
- `lib/vorlage/` – leere Vorlage der Handelskammer Bremen (Formularfelder entfernt)
- `public/` – Oberfläche (für Handy und PC)
- `deploy/` – Einrichtung, Updates und Sicherungen auf dem Server

## Lokal testen
`node server.js`, dann http://localhost:8090. Der Einrichtungs-Code steht im Konsolenfenster.

## Server einrichten
`bash /opt/berichtsheft/deploy/setup.sh` (Adresse bh-bremen.de, Feiertage für Bremen voreingestellt)

## Server
- Daten: `/var/lib/berichtsheft/data` (nie im Repository)
- Port intern 3100, Caddy leitet die eigene Adresse dorthin weiter (mit https)
- Rechtschreibprüfung: Dienst `languagetool`, nur lokal auf Port 8081
- Updates von `main` alle 3 Minuten, mit Sicherung vorher und automatischem Zurückspringen
- Protokoll: `/var/log/berichtsheft-update.log`
- Sicherungen: `/var/backups/berichtsheft` (täglich 14 Tage, monatlich 4 Jahre)

## Hinweis zur Unterschrift
Die eingefügte Unterschrift ist ein Bild, keine qualifizierte elektronische Signatur.
Elektronische Ausbildungsnachweise sind nach § 13 BBiG erlaubt. Ob der Betrieb und die Kammer
diese Form annehmen, vorher mit Ausbilder bzw. IHK/HWK klären.
