# Medienzeit für Ludwig

Kleine Familien-App, die Ludwigs Medien-Vertrag automatisch durchsetzt.

- **Eltern-Ansicht** (Handy): Strafen per Klick eintragen, Zeit verlängern, Klausuren eintragen, Protokoll, Einstellungen.
- **Ludwig-Ansicht**: Status mit Countdown, Checkliste abhaken, offene Strafen, Klausuren, Wochenplan, Protokoll.
- **Laptop-Programm**: Windows-Dienst, der Ludwig abmeldet, wenn er nicht darf.

Die App läuft kostenlos auf Cloudflare (Workers + D1). Bei jedem Push auf `main` wird automatisch veröffentlicht.

> **Dieses Repo ist öffentlich.** Hier stehen nie Geheimnisse: Links, Gerät-Token und PINs liegen ausschließlich als **GitHub-Secrets** vor. Der Deploy übergibt sie an Cloudflare.

---

## Einrichtung Schritt für Schritt (für Leif)

Dauer: etwa 30–45 Minuten. Du brauchst einen Computer mit Browser. Für Schritt 8 brauchst du den Laptop und ein Admin-Konto darauf.

### 1. Cloudflare-Konto

1. Auf <https://dash.cloudflare.com/sign-up> ein kostenloses Konto anlegen.
2. Links **Workers & Pages** öffnen. Beim ersten Mal fragt Cloudflare nach einer **workers.dev-Subdomain**, z. B. `hollatz`. Die App ist später unter `https://medienzeit.<subdomain>.workers.dev` erreichbar.
3. Die **Account ID** notieren. Sie steht rechts auf der Übersichtsseite von *Workers & Pages* oder in der Adresszeile (`dash.cloudflare.com/<ACCOUNT_ID>/…`).

### 2. Geheimnisse erzeugen

Du brauchst drei lange Zufallswerte, je 64 Zeichen. Unter Windows in PowerShell erzeugst du jeden so:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Den Befehl dreimal ausführen und notieren als:

| Name | Wofür |
| --- | --- |
| `PARENT_TOKEN` | geheimer Teil des Eltern-Links |
| `LUDWIG_TOKEN` | geheimer Teil von Ludwigs Link |
| `DEVICE_TOKEN` | Ausweis des Laptops gegenüber dem Server |

Dazu kommen die **PINs**. Jede Person bekommt einen vierstelligen Code. Das Format ist eine Zeile, durch Kommas getrennt:

```
Mama:1234,Papa:5678,Leif:2468,Gretja:1357,Enzo:9753
```

Die Namen erscheinen genau so in der App.

### 3. Datenbank (D1) anlegen

1. Im Cloudflare-Dashboard: **Storage & Databases → D1 SQL Database → Create**.
2. Name: `medienzeit`, dann **Create**.
3. Die **Database ID** kopieren (sieht aus wie `a1b2c3d4-…`).
4. Auf GitHub im Repo die Datei `wrangler.jsonc` öffnen, auf den Stift klicken und bei `database_id` die Nullen durch deine ID ersetzen. Unten auf **Commit changes** klicken.

Die Tabellen und Startdaten (Zeiten, Strafenkatalog, Checkliste, Ferien Thurgau) legt der Deploy automatisch an.

### 4. API-Token und GitHub-Secrets

1. In Cloudflare oben rechts auf das Profil-Symbol → **My Profile → API Tokens → Create Token**.
2. Die Vorlage **„Edit Cloudflare Workers“** wählen. Unter *Permissions* eine Zeile hinzufügen: **Account → D1 → Edit**. Bei *Account Resources* dein Konto auswählen, dann **Continue → Create Token**. Den Token kopieren, er wird nur einmal angezeigt.
3. Auf GitHub im Repo: **Settings → Secrets and variables → Actions → New repository secret**. Diese sechs Secrets anlegen:

| Secret | Wert |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | der Token aus 4.2 |
| `CLOUDFLARE_ACCOUNT_ID` | die Account ID aus 1.3 |
| `PARENT_TOKEN` | aus Schritt 2 |
| `LUDWIG_TOKEN` | aus Schritt 2 |
| `DEVICE_TOKEN` | aus Schritt 2 |
| `PINS` | z. B. `Mama:1234,Papa:5678,Leif:2468,Gretja:1357,Enzo:9753` |

### 5. Veröffentlichen

1. Im Repo auf **Actions → „Deploy (Server)“ → Run workflow** klicken.
2. Nach etwa 1–2 Minuten sollten beide Schritte grün sein. Ist einer rot, draufklicken: Die Fehlermeldung sagt auf Deutsch, was fehlt.

Danach geht jeder Push auf `main` automatisch live.

### 6. Links verteilen

- **Eltern:** `https://medienzeit.<subdomain>.workers.dev/e/<PARENT_TOKEN>/`
- **Ludwig:** `https://medienzeit.<subdomain>.workers.dev/l/<LUDWIG_TOKEN>/`

Den Eltern-Link an Mama, Papa, Gretja und Enzo schicken. Am iPhone in Safari öffnen, dann **Teilen → Zum Home-Bildschirm**. Beim ersten Öffnen wählt jede Person ihren Namen, das Handy merkt ihn sich.

**Den Eltern-Link nie auf Ludwigs Laptop oder Handy öffnen**, sonst steht er im Verlauf. Ludwig bekommt nur seinen eigenen Link. Jede andere Adresse liefert eine leere Seite.

### 7. Ferien prüfen

In der Eltern-Ansicht **Einstellungen → Ferien und Feiertage** öffnen. Vorbelegt sind die Thurgauer Schulferien 2026/27 und 2027/28 aus öffentlichen Ferienkalendern sowie die Feiertage 2028. **Bitte mit dem Ferienplan von Ludwigs Sekundarschulgemeinde abgleichen**, denn einzelne Gemeinden weichen ab. Beim 1. Mai 2028 ist unklar, ob schulfrei ist.

### 8. Laptop-Programm installieren

1. Im Repo auf **Releases → Draft a new release** klicken, als Tag `v1.0.0` eintragen und auf **Publish release** klicken. Die Action „Laptop-Programm bauen“ hängt nach etwa 5 Minuten `medienzeit-laptop.zip` an das Release.
2. Auf dem Laptop mit dem **Admin-Konto** anmelden, die Zip herunterladen und entpacken.
3. PowerShell **als Administrator** öffnen, in den entpackten Ordner wechseln und Folgendes ausführen:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://medienzeit.<subdomain>.workers.dev -DeviceToken <DEVICE_TOKEN> -ChildAccount Ludwig
   ```

   `-ChildAccount` ist der Windows-Kontoname von Ludwig. Ohne Parameter fragt das Skript nach den Werten und zeigt die Konten an.
4. Prüfen:

   ```powershell
   & 'C:\Program Files\Medienzeit\Medienzeit.Agent.exe' --check
   ```

   In der Eltern-Ansicht steht unter „Laptop“ dann **verbunden**, und im Protokoll erscheint „Sperrprogramm gestartet“.

Details, Hilfsbefehle und ein Prüfprotokoll zum Abhaken stehen in [`agent/README-Agent.md`](agent/README-Agent.md).

### 9. Testen

1. **Ludwig-Link:** Checkliste abhaken. Ab der frühesten Startzeit (Standard 12:00) bzw. 11:30 an freien Tagen zeigt der Status „Darf bis …“.
2. **Eltern-Link:** Unter **Strafe** z. B. „Türen knallen – 30 Min.“ antippen. Die Vorschau zeigt „Laptop gesperrt bis …“. Bestätigen. Innerhalb von etwa 20 Sekunden erscheint auf dem Laptop die Meldung, nach 60 Sekunden folgt die Abmeldung.
3. In der **Übersicht** bei der Strafe auf **Verringern** tippen, „ganz aufheben“ wählen und die PIN eingeben. Ludwig darf wieder.
4. Das **Prüfprotokoll** in `agent/README-Agent.md` durchgehen (Umgehungsversuche, WLAN aus, abgesicherter Modus).

---

## Alltag

### PIN ändern (z. B. wenn Ludwig eine mitbekommen hat)

1. GitHub → Repo → **Settings → Secrets and variables → Actions** → `PINS` → **Update** → neue Zeile eintragen und speichern.
2. **Actions → „Deploy (Server)“ → Run workflow** klicken. Nach etwa 2 Minuten gilt die neue PIN.

Personen hinzufügen oder entfernen geht genauso.

### Wofür braucht man eine PIN?

| Ohne PIN | Mit PIN der eintragenden Person |
| --- | --- |
| Strafe eintragen | Strafe verringern oder aufheben |
| Klausur/Test eintragen oder löschen | Zeit verlängern oder früher starten (z. B. Guthaben einlösen) |
| | Sonderfreigabe jetzt |
| | Früher Schluss an einem Tag (Sperrzeit verlängern) |
| | Einstellungen |

Nach 5 falschen PINs ist die Person 15 Minuten gesperrt. Innerhalb von 5 Minuten fragt die App nicht erneut nach der PIN.

### Ein Link ist durchgesickert

Im GitHub-Secret `PARENT_TOKEN` bzw. `LUDWIG_TOKEN` einen neuen Wert eintragen (siehe Schritt 2) und **Deploy** starten. Der alte Link zeigt danach nur noch eine leere Seite. Den neuen Link verteilen.

---

## Sicherheits-Checkliste für den Laptop

- [ ] **Ludwig ist Standard-Benutzer**, kein Administrator. Prüfen unter *Einstellungen → Konten → Andere Benutzer*. Das Programm sperrt absichtlich nichts, wenn das Kind-Konto Admin ist.
- [ ] **Kein weiteres Admin-Konto, dessen Passwort Ludwig kennt.** Das Admin-Passwort ist lang und steht nirgends auf einem Zettel am Laptop.
- [ ] **Gastkonto aus.**
- [ ] **BIOS-/UEFI-Passwort** gesetzt, damit Ludwig die Bootreihenfolge nicht ändern kann.
- [ ] **Booten von USB aus** bzw. an letzter Stelle hinter der internen SSD, durch das BIOS-Passwort geschützt.
- [ ] **Secure Boot an.**
- [ ] **Geräteverschlüsselung bzw. BitLocker an.** Sonst kann man über die Wiederherstellungsumgebung (Umschalt + Neustart) an die Dateien. Den Wiederherstellungsschlüssel bei den Eltern aufbewahren.
- [ ] **Microsoft Family Safety als Sicherheitsnetz** mit festen Sperrzeiten behalten, falls das Programm einmal ausfällt. Das funktioniert nur, wenn Ludwig mit einem **Microsoft-Konto** angemeldet ist, das in eurer Familiengruppe ist. Mit einem lokalen Konto geht Family Safety nicht. Die Sperrzeiten großzügiger als in der App einstellen (z. B. 07:00–22:30), sonst kommen sich beide in die Quere.
- [ ] **Eltern-Link nie auf Ludwigs Geräten** öffnen.
- [ ] **iPhone:** Die App steuert es nicht, weil Apples Bildschirmzeit keine Schnittstelle dafür hat. Dort gelten weiter Bildschirmzeit und die Fensterbrett-Regel. Der Status in der App gilt trotzdem auch fürs Handy.

---

## So rechnet die App

Es gibt **keinen Cron-Job**. Bei jeder Anfrage (Laptop alle ~20 s, Ansichten alle 30 s) wird der Zustand aus den gespeicherten Daten neu berechnet (`worker/engine/engine.ts`):

1. **Zeitfenster je Tag:** An Schultagen gilt die früheste Startzeit (Schulschluss, je Wochentag einstellbar), an freien Tagen 11:30. Ende ist 20:00, wenn morgen Schule ist, sonst 21:30. Danach werden Tagesänderungen und „Heute früher Schluss“ in zeitlicher Reihenfolge angewendet.
2. **Checkliste:** Medien gibt es nur, solange alle heute geltenden Punkte abgehakt sind. „Lernstunde“ erscheint, wenn eine Klausur in den nächsten 7 Tagen oder ein Test in den nächsten 3 Tagen ansteht. „Schulranzen“ erscheint, wenn morgen Schule ist. Wird eine Klausur nachmittags eingetragen, gilt die Lernstunde ab dann, nicht rückwirkend.
3. **Pausenregel:** Nach 3 Stunden aktiver Nutzung (angemeldet und entsperrt) ohne 30 Minuten Pause folgen 30 Minuten Zwangspause. Kürzere Unterbrechungen zählen nicht als aktiv, setzen den Zähler aber auch nicht zurück.
4. **Strafen-Warteschlange:** Strafen werden nacheinander abgesessen, in der Reihenfolge des Eintragens. Restminuten laufen **nur** ab, wenn Ludwig ohne die Strafe gerade dürfte, also nicht nachts, nicht bei offener Checkliste und nicht während einer Pause oder Sonderfreigabe. Was heute nicht reicht, läuft morgen am Anfang weiter.
5. **„Heute früher Schluss“:** Die heutige Endzeit rückt nach vorne. Ist weniger Zeit übrig, als die Strafe dauert, ist sofort Schluss, und der Rest wird morgen am Anfang abgezogen. „Übrige Zeit“ zählt ab der frühesten Startzeit, falls die Medienzeit noch nicht begonnen hat.
6. **Sonderfreigabe:** gilt über alles hinweg, auch über Zeitplan, Checkliste, Strafe und Pause. Laufende Strafen pausieren so lange.

Damit die Rechnung kurz bleibt, wird zu jedem Tagesbeginn ein **Zwischenstand** gespeichert. Einstellungsänderungen wirken deshalb nie rückwirkend auf schon abgesessene Strafzeit.

Zeitzone ist überall **Europe/Zurich**, inklusive Sommer- und Winterzeit.

### Gratis-Limits von Cloudflare

| Limit (Workers Free) | Grenze | Verbrauch hier |
| --- | --- | --- |
| Anfragen | 100.000 / Tag | Laptop ~4.300, dazu die Ansichten → unter 10 % |
| CPU pro Anfrage | 10 ms | Zeitberechnung über Intervalle, im Test unter 1 ms |
| D1 gelesene Zeilen | 5 Mio. / Tag | ~50–100 pro Anfrage → unter 10 % |
| D1 geschriebene Zeilen | 100.000 / Tag | ~2 pro Laptop-Abfrage → ~9.000 |

Seit September 2026 schlagen D1-Abfragen im Gratis-Paket fehl, sobald ein Tageslimit überschritten ist. Wir bleiben weit darunter.

### PINs

Die PINs liegen als Cloudflare-Secret vor (über GitHub gesetzt) und werden nicht in der Datenbank gespeichert. Gehasht wird bewusst nicht: Eine vierstellige PIN hätte jeder Rechner trotz Hash in Sekunden durchprobiert. Der eigentliche Schutz sind die Sperre nach 5 Fehlversuchen und der geheime Eltern-Link.

---

## Aufbau des Repos

```
worker/            Cloudflare Worker (TypeScript)
  engine/          Zeitberechnung – reine Funktionen, voll getestet
  index.ts         Routen, geheime Links, 404
  actions.ts       Strafen, PIN-Aktionen, Klausuren, Checkliste
  device.ts        Schnittstelle für den Laptop
public/            Oberfläche (HTML/CSS/JS ohne Build-Schritt)
migrations/        Datenbank-Schema und Startdaten
tests/             Tests der Zeitberechnung (Vitest)
agent/             Windows-Dienst (.NET 8) + Tests
scripts/           install.ps1, uninstall.ps1, Hilfsskript für den Deploy
docs/              Schnittstelle Laptop ↔ Server
.github/workflows/ Deploy (Server) und Laptop-Programm bauen
```

### Lokal entwickeln

```bash
npm install
npm test
```

```bash
npx wrangler d1 migrations apply DB --local
```

Dann eine Datei `.dev.vars` anlegen (steht in `.gitignore`) mit `LUDWIG_TOKEN=…`, `PARENT_TOKEN=…`, `DEVICE_TOKEN=…` und `PINS=Mama:1111,…`. Anschließend:

```bash
npx wrangler dev
```

Laptop-Programm:

```bash
dotnet test agent/Medienzeit.sln
```

---

## Was nicht automatisch getestet werden konnte

| Was | Wie Leif es prüft |
| --- | --- |
| Windows-Dienst auf echter Hardware: Meldungen, Abmeldung, Sperrstatus, SafeBoot, Neustart nach Absturz | Prüfprotokoll in `agent/README-Agent.md` |
| `install.ps1` / `uninstall.ps1` wirklich ausgeführt (nur auf Syntax geprüft) | Schritt 8; danach `sc qc MedienzeitAgent` und `--check` |
| Umgehungsversuche als Ludwig (Dienst stoppen, Task-Manager, Zeitzone, WLAN aus) | Prüfprotokoll, Abschnitt „Umgehungsversuche“ |
| Energiesparmodus / Ruhezustand mitten in der Medienzeit | Prüfprotokoll |
| Echter Deploy auf Cloudflare inkl. Limits | Schritt 5 + 9; im Cloudflare-Dashboard unter *Workers → medienzeit → Metrics* CPU-Zeit ansehen |
| Ferientermine Thurgau 2027/28 (aus öffentlichen Kalendern, nicht amtlich bestätigt) | Schritt 7 |
| Darstellung auf echten iPhones (nur im Browser-Simulator geprüft) | Links auf dem Handy öffnen |
