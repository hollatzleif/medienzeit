# Geräte-Schnittstelle (Laptop ↔ Server)

Alle Zeiten sind **Millisekunden seit 1970 (UTC)**. Der Laptop fragt etwa alle 20 Sekunden an.

## `POST /api/device/poll`

Header: `Authorization: Bearer <DEVICE_TOKEN>`, `Content-Type: application/json`

### Anfrage

```json
{
  "agentVersion": "1.0.0",
  "session": "active",
  "activity": [{ "from": 1762430000000, "to": 1762430600000 }],
  "events": [
    { "ts": 1762430000000, "type": "started" },
    { "ts": 1762430000000, "type": "offline", "from": 1762420000000, "to": 1762430000000 },
    { "ts": 1762430000000, "type": "logoff", "text": "Gesperrt bis 15:30 – Rumschreien (Papa)" },
    { "ts": 1762430000000, "type": "warning", "text": "In 5 Minuten endet die Medienzeit." },
    { "ts": 1762430000000, "type": "error", "text": "…" }
  ]
}
```

- `session`: Zustand der Sitzung des Kind-Kontos **jetzt**:
  - `none`: nicht angemeldet
  - `active`: angemeldet und entsperrt
  - `locked`: angemeldet, aber Bildschirm gesperrt oder Sitzung getrennt
- `activity`: Zeiträume aktiver Nutzung, die der Laptop offline gesammelt und noch nicht gemeldet hat. Online genügt `session`. Der Server führt beides zusammen.
- `events`: noch nicht gemeldete Ereignisse. Der Laptop puffert sie, bis eine Anfrage erfolgreich war.
  - `started`: Dienst gestartet
  - `offline`: Laptop lief, hatte aber keine Verbindung (`from` = letzter erfolgreicher Kontakt, `to` = Wiederverbindung)
  - `logoff`: Ludwig wurde abgemeldet
  - `warning`: Vorwarnung angezeigt
  - `error`: Fehler

### Antwort `200`

```json
{
  "serverTime": 1762430000000,
  "allowed": false,
  "text": "Gesperrt bis 15:30 – Rumschreien (Papa)",
  "kind": "penalty",
  "lockId": "p:42",
  "segments": [
    { "from": 1762430000000, "to": 1762435400000, "allowed": false, "kind": "penalty", "text": "Gesperrt bis 15:30 – Rumschreien (Papa)" },
    { "from": 1762435400000, "to": 1762452000000, "allowed": true, "kind": "allowed", "text": "Darf bis 20:00" }
  ],
  "offlineMinutes": 240,
  "warnMinutes": 5,
  "penaltyGraceSeconds": 60,
  "reloginGraceSeconds": 15,
  "budget": { "leftMinutes": 95 },
  "pause": { "activeMinutes": 180, "breakMinutes": 30, "pauseMinutes": 30, "activeSoFarMinutes": 42 }
}
```

- `kind`: `allowed`, `grant` (Sonderfreigabe), `penalty`, `pause`, `budget` (Tageskonto leer), `checklist`, `schedule` (Sperrzeit) oder `offline`.
- `lockId`: Kennung des Sperrgrunds. Ändert sie sich, ist eine neue Sperre entstanden, zum Beispiel eine neue Strafe.
- `segments`: lückenloser Plan von `serverTime` bis `serverTime + 24 h`. Er ist **vorsichtig gerechnet**: An künftigen Tagen gilt die Checkliste als offen. Ist Ludwig gerade aktiv, steht die fällige Pause aus der Pausenregel als Abschnitt `pause` drin, berechnet für den Fall, dass er durchgehend weiterspielt. So kommt die Vorwarnung rechtzeitig.
- `budget.leftMinutes`: restliche Laptop-Zeit heute (Tageskonto), `null` = keine Grenze. Offline zählt der Laptop selbst herunter und sperrt bei 0. Online steht das Ende bei laufender Nutzung als Abschnitt `budget` im Plan.
- `pause.activeSoFarMinutes`: aktive Minuten seit der letzten Pause von mindestens `breakMinutes`. Offline zählt der Laptop von diesem Wert aus selbst weiter und erzwingt die Pause dann selbst.

### Fehler

- `401`/`404`: falsches Token. Der Laptop behandelt das wie „keine Verbindung“.

## Verhalten des Laptops (Kurzfassung)

1. **Online:** Es gilt die Antwort des Servers. Die aktuelle Zeit ist `serverTime` plus die seither vergangene monotone Zeit (`Environment.TickCount64`).
2. **Offline:** Es gilt der zuletzt geladene Plan (`segments`), solange seit dem letzten Kontakt weniger als `offlineMinutes` vergangen sind. Danach ist der Laptop gesperrt („Keine Verbindung zum Server – Laptop gesperrt“). Springt die Systemuhr gegenüber der monotonen Uhr um mehr als 5 Minuten, gilt das als offline-abgelaufen.
3. **Übergang erlaubt → gesperrt:**
   - Wurde dieser Übergang vorhergesehen und die Vorwarnung `warnMinutes` vorher gezeigt, wird zum Zeitpunkt abgemeldet.
   - Sonst (z. B. eine neue Strafe) erscheint sofort eine Meldung mit dem Grund. Nach `penaltyGraceSeconds` wird abgemeldet.
4. **Anmeldung während einer Sperre:** sofort eine Meldung, nach `reloginGraceSeconds` Abmeldung.
5. **Vorwarnung:** `warnMinutes` vor jedem vorhergesehenen Ende eines erlaubten Abschnitts.
