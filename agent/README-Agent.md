# Medienzeit-Sperrprogramm für Windows

Ein Windows-Dienst (`MedienzeitAgent`), der unter SYSTEM läuft. Er fragt alle 20 Sekunden beim Server nach, ob Ludwig gerade darf, und meldet Ludwig ab, wenn nicht. Er nutzt nur die Windows-Terminaldienste-API (läuft auf Home und Pro). In Ludwigs Sitzung läuft kein Hilfsprogramm.

Die Schnittstelle zum Server ist in [`docs/geraete-api.md`](../docs/geraete-api.md) beschrieben.

## Installation (kurz)

1. Auf GitHub unter **Releases** die Datei `medienzeit-laptop.zip` herunterladen und entpacken. Alternativ: **Actions → „Laptop-Programm bauen“ → Run workflow**, dann das Artefakt laden.
2. PowerShell **als Administrator** öffnen und in den entpackten Ordner wechseln.
3. Diesen Befehl ausführen:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

4. Das Skript fragt nach Server-Adresse, Gerät-Token und Ludwigs Kontonamen. Den Kontonamen zeigt es vorher in einer Liste an.

Aktualisieren geht genauso: das neue Zip entpacken und `install.ps1` erneut ausführen. Die Konfiguration bleibt erhalten.

Entfernen:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Mit `-RemoveData` werden auch Konfiguration und Protokoll gelöscht.

## Dateien auf dem Laptop

| Pfad | Inhalt |
| --- | --- |
| `C:\Program Files\Medienzeit\Medienzeit.Agent.exe` | das Programm |
| `C:\ProgramData\Medienzeit\config.json` | Server-Adresse, Gerät-Token, Kind-Konto |
| `C:\ProgramData\Medienzeit\state.json` | Cache: letzter Plan, gepufferte Ereignisse |
| `C:\ProgramData\Medienzeit\agent.log` | Protokoll zur Fehlersuche |

Den Ordner `C:\ProgramData\Medienzeit` dürfen nur SYSTEM und Administratoren lesen.

## Hilfsbefehle (PowerShell als Administrator)

```powershell
& 'C:\Program Files\Medienzeit\Medienzeit.Agent.exe' --check     # Konfiguration, Konto, Server prüfen, Plan anzeigen
& 'C:\Program Files\Medienzeit\Medienzeit.Agent.exe' --sessions  # angemeldete Sitzungen anzeigen
Get-Content C:\ProgramData\Medienzeit\agent.log -Tail 30 -Wait    # Protokoll live mitlesen
```

## Prüfprotokoll auf echter Hardware

Diese Punkte lassen sich nur auf dem echten Laptop prüfen. Am besten mit zwei Geräten arbeiten: Leif am Handy in der Eltern-Ansicht, Ludwigs Konto am Laptop. Jeden Punkt abhaken.

**Grundfunktion**

- [ ] `--check` zeigt „Kind-Konto ist Standardbenutzer“ und „Server ok“.
- [ ] `--sessions` markiert Ludwigs angemeldete Sitzung mit „<-- Kind-Konto“. Bei gesperrtem Bildschirm (Win+L) steht dort „gesperrt“.
- [ ] Im Protokoll der Eltern-Ansicht erscheint „Sperrprogramm gestartet“.

**Sperren**

- [ ] Strafe „Sofort“ eintragen, während Ludwig angemeldet ist und darf. Innerhalb von etwa 20 Sekunden erscheint die Meldung „Gesperrt bis … – Grund (Person) … noch 60 Sekunden“. Nach 60 Sekunden folgt die Abmeldung.
- [ ] Während der Sperre neu anmelden. Die Meldung erscheint sofort, nach 15 Sekunden folgt die Abmeldung.
- [ ] Mit einer Tagesänderung das Ende auf in 7 Minuten setzen. 5 Minuten vorher erscheint die Vorwarnung, zum Ende folgt die Abmeldung ohne weitere Frist.
- [ ] Ein Administratorkonto wird nie abgemeldet, auch nicht während einer Sperre.

**Umgehungsversuche (als Ludwig angemeldet)**

- [ ] `sc stop MedienzeitAgent` in der Eingabeaufforderung führt zu „Zugriff verweigert“.
- [ ] Im Task-Manager „Medienzeit.Agent.exe“ beenden führt zu „Zugriff verweigert“ (der Prozess läuft unter SYSTEM).
- [ ] In „Dienste“ (services.msc) lässt sich der Dienst nicht beenden und nicht auf „Deaktiviert“ stellen.
- [ ] `C:\ProgramData\Medienzeit` lässt sich nicht öffnen (Zugriff verweigert).
- [ ] In `C:\Program Files\Medienzeit` lässt sich nichts löschen oder umbenennen.
- [ ] Die Zeitzone ändern (Einstellungen → Zeit) hat keine Wirkung, alle Zeiten bleiben gleich.
- [ ] WLAN ausschalten: Der Plan gilt bis zu 4 Stunden weiter. Kurz vor Ablauf kommt die Vorwarnung, danach ist der Laptop gesperrt. Nach dem Einschalten erscheint im Protokoll „Laptop lief ohne Verbindung …“. Zum schnelleren Testen in den Einstellungen die Offline-Dauer vorübergehend auf 10 Minuten stellen.
- [ ] Abgesicherter Modus (Umschalt + Neustart → Problembehandlung → Starterweiterte Einstellungen → Starteinstellungen → 4): Während einer Sperre wird Ludwig auch dort abgemeldet. Im abgesicherten Modus ohne Netzwerk gilt der zwischengespeicherte Plan.
- [ ] Ruhezustand oder Energiesparmodus während der Medienzeit, Aufwecken nach dem Ende: Die Abmeldung folgt kurz nach dem Aufwecken.

**Pausenregel** (zum Testen in den Einstellungen z. B. 10 Min. aktiv / 5 Min. Pause einstellen)

- [ ] Nach der eingestellten aktiven Zeit kommt erst die Vorwarnung, dann die Abmeldung, und der Status zeigt „Pause bis …“.
- [ ] Gesperrter Bildschirm (Win+L) zählt nicht als aktiv.

## Technische Hinweise

- **Zeit:** Online gilt die Serverzeit. Dazwischen zählt die monotone Uhr (`GetTickCount64`, läuft auch im Energiesparmodus weiter). Weichen Systemuhr und monotone Uhr um mehr als 5 Minuten voneinander ab, gilt der Plan als ungültig, bis der Server wieder erreichbar ist. Standardbenutzer können die Systemuhr unter Windows nicht stellen, nur die Zeitzone. Die Zeitzone spielt hier keine Rolle.
- **Sperrstatus:** Er kommt aus `WTSSessionInfoEx` (`SessionFlags`: 0 = gesperrt, 1 = entsperrt). Unter Windows 7 waren diese Werte vertauscht. Unterstützt werden nur Windows 10 und 11.
- **Kind-Konto als Administrator:** Ist das Kind-Konto Administrator, sperrt der Dienst absichtlich nichts. Er schreibt dann einen Fehler ins Protokoll und meldet ihn an den Server.
- **Absturz:** Bei einem Absturz startet Windows den Dienst nach 5 Sekunden neu (Wiederherstellungsoptionen).
