# Berichtsheft

Digitaler Ausbildungsnachweis (wöchentlich) mit automatischem Vorausfüllen,
Rechtschreib- und Grammatikprüfung, digitaler Unterschrift und PDF-Export.
Eigenständiges Programm unter https://bh-bremen.de

**Privates Hilfsprogramm, nicht offiziell. Kein Angebot der Handelskammer Bremen (IHK) und ohne Verbindung zu Ausbildungsbetrieben.**

## Was es kann
- **Original-Formular:** Ausgefüllt wird die Vorlage „Ausbildungsnachweis (Berichtsheft) – täglich“ der
  Handelskammer Bremen (`lib/vorlage/`). Die Vorlage bleibt unverändert, Text und Unterschrift kommen darüber.
- **Neuer Wochenbericht:** „Diese Woche“, „Nächste Woche“ oder ein beliebiges Datum, die Woche geht immer von
  Montag bis Sonntag. Fortlaufende Nummer (änderbar), Ausbildungsbereich wählen. Darunter die eigenen Berichte.
- **Einstellungen:** Name, Firma, Standort, Lehrjahr (Pflicht), Stunden, Berufsschultage, **Arbeitsorte**
  (Überschrift, Adresse, Bereich-Kürzel, Ausbilder/Geselle) und **Textbausteine**.
- **Beim Schreiben:** ＋ Einfügen (Arbeitsorte/Bausteine an der Cursor-Stelle), ★ Markiertes merken,
  💡 Ideen (aus den eigenen früheren Berichten und der Woche, einfügen oder kopieren), ↶ Rückgängig.
  Speichert bei jeder Änderung, auf jedem Gerät weiter bearbeitbar (Handy schreiben, Tablet herunterladen).
- **Rechtschreibung und Grammatik** mit LanguageTool auf dem eigenen Server, Vorschläge zum Antippen, Wörterbuch.
- **Unterschrift** mit wählbarem Datum, jedes Mal minimal anders gesetzt. PDF `Berichtsheft_Nachname_NRx.pdf`,
  am PC fester Speicherordner, am Handy „In Dateien sichern“. 90 Tage nachträglich bearbeitbar.
- **Konten:** eigener reiner Admin-Zugang plus normale Konten. Admin gibt nur einen Benutzernamen ein und bekommt
  ein kurzes Startpasswort. Beim ersten Anmelden: eigenes Passwort, dann Name, Firma, Standort, Lehrjahr.
- **Admin sieht keine Berichte**, nur Name, Firma, Standort, dabei seit, zuletzt aktiv. Bearbeiten, sperren,
  neues Startpasswort (mit Bestätigung durch Eintippen des Benutzernamens), Bearbeitungsfrist verlängern.
- **Funktionen sperren:** Anmelden, neue Berichte, Schreiben, Rechtschreibprüfung, Ideen, Unterschreiben, PDF
  einzeln vorübergehend abschalten, mit eigenem Hinweistext.
- **Hell/Dunkel**, kurze überspringbare Einführung beim ersten Start, Anleitung über „?“.

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
