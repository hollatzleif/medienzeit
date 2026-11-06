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

> **Alle Werte sicher aufheben** (z. B. im Passwort-Manager). GitHub zeigt gespeicherte Secrets nie wieder an. Das `DEVICE_TOKEN` brauchst du später am Laptop (Schritt 8), die beiden Link-Tokens für die Links (Schritt 6).

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

### 8. Laptop einrichten: alle Befehle zum Kopieren

**Vorbereitung:** Im Repo auf **Releases → Draft a new release** klicken, als Tag `v1.0.0` eintragen und auf **Publish release** klicken. Die Action „Laptop-Programm bauen“ hängt nach etwa 5 Minuten `medienzeit-laptop.zip` an das Release. Diese Datei auf dem Laptop mit dem **Admin-Konto** in den Ordner *Downloads* herunterladen.

**So geht's:**

- Auf dem Laptop mit dem Admin-Konto angemeldet bleiben.
- **Windows-Taste + X** drücken und dann **„Terminal (Administrator)“** bzw. **„Windows PowerShell (Administrator)“** wählen. Die Frage „Änderungen zulassen?“ mit **Ja** beantworten.
- Die Befehle **der Reihe nach** kopieren: Kasten markieren, mit Rechtsklick ins blaue/schwarze Fenster einfügen und Enter drücken.
- **Das Fenster bis zum Schluss offen lassen**, weil sich die Befehle die Angaben aus Schritt 8.1 merken.

#### 8.1 Angaben eintragen (einmal)

In den drei Zeilen die Werte in Anführungszeichen ersetzen, dann einfügen:

```powershell
$Kind   = "Ludwig"
$Server = "https://medienzeit.DEINE-SUBDOMAIN.workers.dev"
$Token  = "HIER-DAS-DEVICE_TOKEN-EINFÜGEN"
```

`$Kind` ist der Windows-Kontoname von Ludwig. Wer unsicher ist, lässt sich alle Konten anzeigen:

```powershell
Get-LocalUser | Format-Table Name, Enabled, FullName
```

Hat Ludwig ein Microsoft-Konto, steht hier meist eine Kurzform seiner E-Mail-Adresse, z. B. `ludwi`. Genau diesen Namen bei `$Kind` eintragen und die Zeile `$Kind = …` nochmal ausführen.

#### 8.2 Zip entpacken

```powershell
$Ordner = "$env:USERPROFILE\Downloads\medienzeit-laptop"
Expand-Archive -Path "$env:USERPROFILE\Downloads\medienzeit-laptop.zip" -DestinationPath $Ordner -Force
Get-ChildItem $Ordner | Unblock-File
Set-Location $Ordner
```

#### 8.3 Ludwig zum Standard-Benutzer machen

Der Befehl nimmt Ludwig aus der Gruppe der Administratoren. Eine rote Meldung „ist kein Mitglied“ ist gut, dann war er es schon nicht.

```powershell
Remove-LocalGroupMember -SID S-1-5-32-544 -Member $Kind -ErrorAction Continue
Add-LocalGroupMember -SID S-1-5-32-545 -Member $Kind -ErrorAction SilentlyContinue
```

#### 8.4 Sperrprogramm installieren

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl $Server -DeviceToken $Token -ChildAccount $Kind
```

Danach prüfen. Es muss „Kind-Konto ist Standardbenutzer“ und „Server ok“ erscheinen:

```powershell
& 'C:\Program Files\Medienzeit\Medienzeit.Agent.exe' --check
```

In der Eltern-Ansicht steht unter „Laptop“ dann **verbunden**, und im Protokoll erscheint „Sperrprogramm gestartet“.

#### 8.5 Gastkonto und eingebautes Administrator-Konto abschalten

```powershell
Get-LocalUser | Where-Object { $_.SID.Value -like '*-501' } | Disable-LocalUser
```

Das eingebaute Konto „Administrator“ wird nur abgeschaltet, wenn du nicht gerade selbst damit angemeldet bist:

```powershell
$ich = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
Get-LocalUser | Where-Object { $_.SID.Value -like '*-500' -and $_.SID.Value -ne $ich } | Disable-LocalUser
```

#### 8.6 Prüfen, wer Administrator ist

```powershell
Get-LocalGroupMember -SID S-1-5-32-544
```

In der Liste dürfen nur Konten stehen, deren Passwort Ludwig **nicht** kennt. Steht dort ein weiteres Konto, dessen Passwort er kennt, dieses Passwort ändern. Den Befehl dafür so anpassen, dass `NAME` durch den Kontonamen ersetzt ist:

```powershell
Set-LocalUser -Name "NAME" -Password (Read-Host "Neues Passwort" -AsSecureString)
```

Bei einem Microsoft-Konto geht das nicht per Befehl. Dann das Passwort auf <https://account.microsoft.com> ändern.

Bricht `Get-LocalGroupMember` mit einem Fehler ab (passiert manchmal bei Microsoft-Konten), geht es stattdessen so:

```powershell
net localgroup Administratoren
```

#### 8.7 Secure Boot prüfen

```powershell
Confirm-SecureBootUEFI
```

- **True:** alles gut.
- **False** oder eine Fehlermeldung: Secure Boot ist aus. Es wird in Schritt 8.9 im BIOS eingeschaltet.

#### 8.8 Laufwerk verschlüsseln (BitLocker / Geräteverschlüsselung)

Ohne Verschlüsselung kommt man über die Wiederherstellungsumgebung an alle Dateien. Zuerst prüfen, welche Windows-Version läuft und ob schon verschlüsselt ist:

```powershell
(Get-CimInstance Win32_OperatingSystem).Caption
Get-BitLockerVolume -MountPoint "C:" | Format-List VolumeStatus, ProtectionStatus, EncryptionPercentage
```

- Steht dort `FullyEncrypted` und `On`, ist schon alles erledigt. Weiter mit dem Wiederherstellungsschlüssel unten.
- **Windows Pro, noch nicht verschlüsselt:**

  ```powershell
  Add-BitLockerKeyProtector -MountPoint "C:" -RecoveryPasswordProtector
  Enable-BitLocker -MountPoint "C:" -EncryptionMethod XtsAes128 -UsedSpaceOnly -TpmProtector
  ```

  Danach den Laptop einmal neu starten. Die Verschlüsselung läuft dann im Hintergrund weiter.
- **Windows Home:** Hier gibt es nur die „Geräteverschlüsselung“. Diese Einstellungsseite öffnen und einschalten:

  ```powershell
  start ms-settings:deviceencryption
  ```

  Fehlt die Seite, unterstützt der Laptop keine Verschlüsselung. Dann bleibt es beim BIOS-Passwort aus Schritt 8.9.

**Wiederherstellungsschlüssel anzeigen und aufschreiben** (bei Windows Pro). Den Schlüssel sicher bei den Eltern aufbewahren, **nicht** am Laptop:

```powershell
(Get-BitLockerVolume -MountPoint "C:").KeyProtector | Where-Object KeyProtectorType -eq 'RecoveryPassword' | Format-List KeyProtectorId, RecoveryPassword
```

Bei Windows Home liegt der Schlüssel im Microsoft-Konto unter <https://account.microsoft.com/devices/recoverykey>.

#### 8.9 BIOS/UEFI: Passwort, USB-Boot, Secure Boot (geht nur von Hand)

Diese drei Einstellungen liegen in der Firmware des Laptops, dafür gibt es keinen Windows-Befehl. Der Befehl hier startet den Laptop direkt ins BIOS/UEFI. **Vorher alles speichern!**

```powershell
shutdown /r /fw /t 0
```

Die Menüs sehen je nach Hersteller anders aus. Gesucht wird:

1. **Security → Supervisor/Administrator Password** setzen. Notieren und bei den Eltern aufbewahren.
2. **Boot → USB Boot** auf *Disabled* stellen oder die interne SSD an die erste Stelle der Bootreihenfolge setzen.
3. **Secure Boot** auf *Enabled* stellen.
4. Mit **F10** (oder „Save & Exit“) speichern.

Danach Windows wieder starten, mit dem Admin-Konto anmelden und erneut ein Terminal (Administrator) öffnen. Die Angaben aus 8.1 sind nach dem Neustart vergessen, für 8.11 braucht man sie aber nicht.

#### 8.10 Microsoft Family Safety als Sicherheitsnetz

Das geht nur im Browser und nur, wenn Ludwig ein Microsoft-Konto in eurer Familiengruppe hat:

```powershell
start https://family.microsoft.com
```

Bei Ludwig unter **Bildschirmzeit** feste Zeiten großzügiger als in der App einstellen, z. B. 07:00–22:30. Dann greift Family Safety nur, falls das Sperrprogramm einmal ausfällt.

#### 8.11 Abschlusskontrolle

```powershell
Get-Service MedienzeitAgent | Format-List Status, StartType
Get-LocalUser | Format-Table Name, Enabled
Get-LocalGroupMember -SID S-1-5-32-544
Confirm-SecureBootUEFI
Get-BitLockerVolume -MountPoint "C:" | Format-List VolumeStatus, ProtectionStatus
```

Soll-Ergebnis:

- Dienst `Running` / `Automatic`.
- Gast und eingebauter Administrator auf `False`.
- Ludwig steht nicht bei den Administratoren.
- Secure Boot `True`.
- BitLocker `On`. Bei Windows Home kann hier ein Fehler erscheinen, dann zählt die Einstellungsseite aus 8.8.

Danach mit **Ludwigs Konto** anmelden und das Prüfprotokoll in [`agent/README-Agent.md`](agent/README-Agent.md) durchgehen, vor allem die Umgehungsversuche.

> Hinweis: Diese Befehle sind Standard-Windows-Befehle. Auf einem echten Laptop konnte ich sie nicht ausprobieren. Erscheint eine rote Fehlermeldung, die oben nicht erklärt ist: Meldung abfotografieren und nicht weitermachen, sondern erst klären.

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

Die Befehle dazu stehen in Schritt 8. Hier zum Abhaken:

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
| `install.ps1` / `uninstall.ps1` wirklich ausgeführt (nur auf Syntax geprüft) | Schritt 8.4; danach `sc qc MedienzeitAgent` und `--check` |
| Befehle zum Absichern (Gastkonto, Admins, Secure Boot, BitLocker) | Schritt 8.11 Abschlusskontrolle |
| Umgehungsversuche als Ludwig (Dienst stoppen, Task-Manager, Zeitzone, WLAN aus) | Prüfprotokoll, Abschnitt „Umgehungsversuche“ |
| Energiesparmodus / Ruhezustand mitten in der Medienzeit | Prüfprotokoll |
| Echter Deploy auf Cloudflare inkl. Limits | Schritt 5 + 9; im Cloudflare-Dashboard unter *Workers → medienzeit → Metrics* CPU-Zeit ansehen |
| Ferientermine Thurgau 2027/28 (aus öffentlichen Kalendern, nicht amtlich bestätigt) | Schritt 7 |
| Darstellung auf echten iPhones (nur im Browser-Simulator geprüft) | Links auf dem Handy öffnen |
