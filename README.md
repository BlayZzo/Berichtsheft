# Berichtsheft

Digitaler Ausbildungsnachweis (wöchentlich) mit automatischem Vorausfüllen,
Rechtschreib- und Grammatikprüfung, digitaler Unterschrift und PDF-Export.
Eigenständiges Programm unter https://bh-bremen.de

## Was es kann
- **Admin** legt Konten an (vorläufiges Passwort, beim ersten Anmelden muss ein eigenes gewählt werden),
  sperrt Konten, setzt Passwörter zurück, sieht alle Berichte und kann Bearbeitungsfristen verlängern.
- **Blanko-Vorlage** (Admin > Vorlage): Überschrift, Untertitel, Spalten, Hinweistext, Beschriftung der
  Unterschriften und vorausgefüllte Texte je Tagesart. Mit PDF-Vorschau.
- **Automatisch ausgefüllt:** Name, Beruf, Betrieb, Ausbilder, Kalenderwoche, Datum von/bis,
  laufende Nummer (Woche des Ausbildungsbeginns = Nr. 1), Ausbildungsjahr, Berufsschultage,
  gesetzliche Feiertage des Bundeslands, Stunden.
- **Rechtschreibung und Grammatik:** LanguageTool läuft auf dem eigenen Server, die Texte verlassen ihn nicht.
  Fehler werden beim Schreiben angezeigt, Vorschläge per Antippen übernommen, Fachwörter ins eigene Wörterbuch.
- **Unterschrift** einmal in den Einstellungen zeichnen oder als Foto hochladen. Beim Abschließen
  wird sie mit Datum in den Bericht gesetzt. Jedes PDF trägt eine Prüfsumme.
- **PDF** mit einstellbarem Dateinamen, z. B. `{vorname}_{nachname}_Nr{nr3}` → `Max_Muster_Nr007.pdf`.
- **Nachträglich bearbeiten:** nach dem Abschließen 90 Tage lang (einstellbar). Korrekturen werden im PDF vermerkt,
  die vorherige Fassung bleibt gespeichert. Danach ist der Bericht gesperrt, bleibt aber herunterladbar.

## Aufbau
- `server.js` – Server ohne Zusatzpakete (Node.js 20 oder neuer)
- `lib/` – Kalender und Feiertage, PDF-Erzeugung, PNG-Leser
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
