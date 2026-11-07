<#
.SYNOPSIS
  Installiert das Medienzeit-Sperrprogramm (Skript-Version) über die Windows-Aufgabenplanung.

.DESCRIPTION
  Als Administrator ausführen, im Ordner mit agent.ps1:
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://medienzeit.xyz.workers.dev -DeviceToken XXXX -ChildAccount Ludwig

  Ohne Parameter wird nachgefragt. Gibt es schon eine Konfiguration (auch von der alten .exe-Version),
  kann sie behalten werden.

  Das Skript:
   - entfernt eine alte .exe-Version (Dienst MedienzeitAgent), falls vorhanden
   - kopiert agent.ps1 nach C:\Program Files\Medienzeit
   - schreibt C:\ProgramData\Medienzeit\config.json
   - setzt Zugriffsrechte (nur SYSTEM und Administratoren; Programmordner für Benutzer nur lesen)
   - legt die Aufgabe "Medienzeit" an: läuft als SYSTEM, startet beim Hochfahren,
     wird jede Minute neu gestartet, falls sie nicht läuft
   - startet die Aufgabe und prüft sie
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$DeviceToken,
    [string]$ChildAccount
)

$ErrorActionPreference = 'Stop'
$TaskName     = 'Medienzeit'
$OldService   = 'MedienzeitAgent'
$ProgramDir   = Join-Path $env:ProgramFiles 'Medienzeit'
$DataDir      = Join-Path $env:ProgramData 'Medienzeit'
$TargetScript = Join-Path $ProgramDir 'agent.ps1'
$ConfigPath   = Join-Path $DataDir 'config.json'
$PsExe        = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Write-Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "FEHLER: $text" -ForegroundColor Red; exit 1 }

# --- 1. Administratorrechte ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail "Bitte PowerShell mit 'Als Administrator ausführen' starten."
}

# --- 2. agent.ps1 finden ---
$here = $PSScriptRoot
if (-not $here -and $MyInvocation.MyCommand.Path) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $here) { $here = (Get-Location).Path }
$SourceScript = Join-Path $here 'agent.ps1'
if (-not (Test-Path $SourceScript)) { $SourceScript = Join-Path (Get-Location).Path 'agent.ps1' }
if (-not (Test-Path $SourceScript)) { Fail "agent.ps1 nicht gefunden. Bitte im Ordner mit agent.ps1 ausführen." }
Unblock-File -Path $SourceScript -ErrorAction SilentlyContinue

# --- 3. Angaben ---
$keepConfig = $false
if ((Test-Path $ConfigPath) -and -not $ServerUrl -and -not $DeviceToken -and -not $ChildAccount) {
    $answer = Read-Host "Es gibt schon eine Konfiguration. Behalten? (J/n)"
    if ($answer -eq '' -or $answer -match '^[jJyY]') { $keepConfig = $true }
}

if (-not $keepConfig) {
    Write-Step "Benutzerkonten auf diesem Laptop:"
    Get-LocalUser | Where-Object Enabled | ForEach-Object { Write-Host ("   " + $_.Name + "   (" + $_.FullName + ")") }

    if (-not $ServerUrl)    { $ServerUrl    = Read-Host "Server-Adresse (z. B. https://medienzeit.DEINNAME.workers.dev)" }
    if (-not $DeviceToken)  { $DeviceToken  = Read-Host "Gerät-Token (DEVICE_TOKEN)" }
    if (-not $ChildAccount) { $ChildAccount = Read-Host "Kontoname von Ludwig (aus der Liste oben)" }

    $ServerUrl = $ServerUrl.Trim().TrimEnd('/')
    if ($ServerUrl -notmatch '^https?://') { Fail "Die Server-Adresse muss mit https:// beginnen (z. B. https://medienzeit.DEINNAME.workers.dev)." }
    if (-not $DeviceToken.Trim()) { Fail "Gerät-Token fehlt." }
    if (-not $ChildAccount.Trim()) { Fail "Kontoname fehlt." }

    Write-Step "Prüfe Konto '$ChildAccount' ..."
    $user = Get-LocalUser -Name $ChildAccount -ErrorAction SilentlyContinue
    if (-not $user) { Fail "Lokales Konto '$ChildAccount' gibt es nicht. Bitte den Namen aus der Liste oben nehmen." }
    try {
        $admins = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop
        if ($admins | Where-Object { $_.SID -eq $user.SID }) {
            Fail "'$ChildAccount' ist Administrator! Bitte erst zum Standardbenutzer machen (Anleitung Schritt 8.3)."
        }
        Write-Host "   '$ChildAccount' ist Standardbenutzer. Gut."
    } catch {
        Write-Host "   Hinweis: Administratoren-Gruppe konnte nicht geprüft werden. Bitte selbst prüfen (Schritt 8.6)." -ForegroundColor Yellow
    }
}

# --- 4. Alte Versionen entfernen ---
$old = Get-Service -Name $OldService -ErrorAction SilentlyContinue
if ($old) {
    Write-Step "Entferne alte .exe-Version (Dienst $OldService) ..."
    & sc.exe failure $OldService reset= 0 actions= '""' | Out-Null
    Stop-Service -Name $OldService -Force -ErrorAction SilentlyContinue
    & sc.exe delete $OldService | Out-Null
    foreach ($mode in 'Minimal', 'Network') {
        $key = "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\$OldService"
        if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
    }
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Step "Halte laufende Version an (Update) ..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Medienzeit\agent.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# --- 5. Dateien ---
Write-Step "Kopiere Programm nach $ProgramDir ..."
New-Item -ItemType Directory -Force -Path $ProgramDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Copy-Item -Path $SourceScript -Destination $TargetScript -Force
$oldExe = Join-Path $ProgramDir 'Medienzeit.Agent.exe'
if (Test-Path $oldExe) { Remove-Item $oldExe -Force -ErrorAction SilentlyContinue }
# Zwischenspeicher der alten Version verwerfen (der Plan wird sofort neu geladen)
Remove-Item (Join-Path $DataDir 'state.json') -Force -ErrorAction SilentlyContinue

if (-not $keepConfig) {
    Write-Step "Schreibe Konfiguration ..."
    $config = [ordered]@{
        serverUrl    = $ServerUrl
        deviceToken  = $DeviceToken.Trim()
        childAccount = $ChildAccount.Trim()
        pollSeconds  = 20
    } | ConvertTo-Json
    [IO.File]::WriteAllText($ConfigPath, $config, (New-Object Text.UTF8Encoding($false)))
}

# --- 6. Zugriffsrechte (sprachunabhängig über SIDs) ---
Write-Step "Setze Zugriffsrechte ..."
# Nur der Ordner selbst bekommt feste Rechte (ohne /T!). Die Dateien darin erben sie danach.
# (Früher wurden die Rechte mit /T auch direkt auf die Dateien gesetzt – dabei verloren die Dateien
#  alle Rechte, sogar für Administratoren: "Zugriff verweigert".)
function Set-FolderAcl($dir, [string[]]$grants) {
    & icacls.exe $dir /reset /T /C /Q | Out-Null
    & icacls.exe $dir /inheritance:r /grant:r @grants /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Zugriffsrechte für $dir konnten nicht gesetzt werden." }
    if (Get-ChildItem $dir -Force) {
        & icacls.exe (Join-Path $dir '*') /reset /T /C /Q | Out-Null
    }
}
# Datenordner: nur SYSTEM (S-1-5-18) und Administratoren (S-1-5-32-544)
Set-FolderAcl $DataDir @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
# Programmordner: SYSTEM + Administratoren voll, Benutzer (S-1-5-32-545) nur lesen/ausführen
Set-FolderAcl $ProgramDir @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX')
# Gegenprobe: Administratoren müssen die Dateien lesen können
foreach ($f in Get-ChildItem $ProgramDir, $DataDir -File -Force) {
    try { [IO.File]::OpenRead($f.FullName).Dispose() } catch { Fail "Datei nicht lesbar nach dem Setzen der Rechte: $($f.FullName)" }
}

# --- 7. Aufgabe anlegen ---
Write-Step "Lege Aufgabe '$TaskName' an (läuft als SYSTEM) ..."
$start = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Medienzeit-Sperrprogramm. Setzt den Medien-Vertrag durch. Nicht deaktivieren.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$start</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$PsExe</Command>
      <Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$TargetScript"</Arguments>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null

# --- 8. Starten und prüfen ---
Write-Step "Starte Aufgabe ..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 15
$task = Get-ScheduledTask -TaskName $TaskName
$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Medienzeit\agent.ps1*' }
$log = Join-Path $DataDir 'agent.log'
if (Test-Path $log) {
    Write-Host "Letzte Zeilen aus dem Protokoll:"
    Get-Content $log -Tail 8 -Encoding UTF8 | ForEach-Object { Write-Host "   $_" }
}
if ($task.State -ne 'Running' -or -not $running) {
    Fail "Die Aufgabe läuft nicht (Status: $($task.State)). Siehe Protokoll oben bzw. $log"
}

Write-Host ""
Write-Host "Sperrprogramm läuft." -ForegroundColor Green
Write-Host ""
Write-Host "Prüfen:            powershell -ExecutionPolicy Bypass -File `"$TargetScript`" -Check"
Write-Host "Sitzungen zeigen:  powershell -ExecutionPolicy Bypass -File `"$TargetScript`" -Sessions"
Write-Host ""
Write-Host "Fertig! Bitte jetzt mit Schritt 8.5 der Anleitung weitermachen." -ForegroundColor Green
