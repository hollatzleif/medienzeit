<#
.SYNOPSIS
  Installiert das Medienzeit-Sperrprogramm als Windows-Dienst.

.DESCRIPTION
  Als Administrator ausführen, z. B.:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  oder mit Parametern:
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl https://medienzeit.example.workers.dev -DeviceToken XXXX -ChildAccount Ludwig

  Das Skript:
   - kopiert Medienzeit.Agent.exe nach C:\Program Files\Medienzeit
   - schreibt C:\ProgramData\Medienzeit\config.json
   - setzt Zugriffsrechte (nur SYSTEM und Administratoren; Programmordner für Benutzer nur lesen)
   - richtet den Dienst MedienzeitAgent ein (Autostart, Neustart nach Absturz)
   - registriert den Dienst für den abgesicherten Modus
   - startet den Dienst und prüft ihn
#>
[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$DeviceToken,
    [string]$ChildAccount,
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'

# Ordner des Skripts bestimmen ($PSScriptRoot ist bei manchen Aufrufen leer)
if (-not $ExePath) {
    $ScriptDir = $PSScriptRoot
    if (-not $ScriptDir -and $MyInvocation.MyCommand.Path) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
    if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
    $ExePath = Join-Path $ScriptDir 'Medienzeit.Agent.exe'
    if (-not (Test-Path $ExePath)) { $ExePath = Join-Path (Get-Location).Path 'Medienzeit.Agent.exe' }
}
$ServiceName = 'MedienzeitAgent'
$ProgramDir  = Join-Path $env:ProgramFiles 'Medienzeit'
$DataDir     = Join-Path $env:ProgramData 'Medienzeit'
$TargetExe   = Join-Path $ProgramDir 'Medienzeit.Agent.exe'
$ConfigPath  = Join-Path $DataDir 'config.json'

function Write-Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "FEHLER: $text" -ForegroundColor Red; exit 1 }

# --- 1. Administratorrechte ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail "Bitte PowerShell mit 'Als Administrator ausführen' starten."
}

if (-not (Test-Path $ExePath)) { Fail "Medienzeit.Agent.exe nicht gefunden: $ExePath" }
Unblock-File -Path $ExePath -ErrorAction SilentlyContinue

# --- 2. Angaben abfragen ---
$keepConfig = $false
if ((Test-Path $ConfigPath) -and -not $ServerUrl -and -not $DeviceToken -and -not $ChildAccount) {
    $answer = Read-Host "Es gibt schon eine Konfiguration. Behalten? (J/n)"
    if ($answer -eq '' -or $answer -match '^[jJyY]') { $keepConfig = $true }
}

if (-not $keepConfig) {
    Write-Step "Lokale Benutzerkonten auf diesem Laptop:"
    Get-LocalUser | Where-Object Enabled | ForEach-Object { Write-Host ("   " + $_.Name + "   (" + $_.FullName + ")") }

    if (-not $ServerUrl)    { $ServerUrl    = Read-Host "Server-Adresse (z. B. https://medienzeit.DEINNAME.workers.dev)" }
    if (-not $DeviceToken)  { $DeviceToken  = Read-Host "Gerät-Token (DEVICE_TOKEN)" }
    if (-not $ChildAccount) { $ChildAccount = Read-Host "Kontoname von Ludwig (aus der Liste oben)" }

    $ServerUrl = $ServerUrl.Trim().TrimEnd('/')
    if ($ServerUrl -notmatch '^https?://') { Fail "Die Server-Adresse muss mit https:// beginnen." }
    if (-not $DeviceToken.Trim()) { Fail "Gerät-Token fehlt." }
    if (-not $ChildAccount.Trim()) { Fail "Kontoname fehlt." }

    # --- 3. Kind-Konto prüfen ---
    Write-Step "Prüfe Konto '$ChildAccount' ..."
    $user = Get-LocalUser -Name $ChildAccount -ErrorAction SilentlyContinue
    if (-not $user) { Fail "Lokales Konto '$ChildAccount' gibt es nicht." }
    try {
        $admins = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop
        if ($admins | Where-Object { $_.SID -eq $user.SID }) {
            Fail "'$ChildAccount' ist Administrator! Bitte erst in den Einstellungen zum Standardbenutzer machen."
        }
        Write-Host "   '$ChildAccount' ist Standardbenutzer. Gut."
    } catch {
        Write-Host "   Hinweis: Administratoren-Gruppe konnte nicht geprüft werden ($($_.Exception.Message)). Bitte selbst prüfen!" -ForegroundColor Yellow
    }
}

# --- 4. Alten Dienst anhalten (Update) ---
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Step "Vorhandenen Dienst anhalten (Update) ..."
    if ($existing.Status -ne 'Stopped') {
        & sc.exe failure $ServiceName reset= 0 actions= '""' | Out-Null   # damit Windows ihn nicht sofort neu startet
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        (Get-Service $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
}

# --- 5. Dateien und Ordner ---
Write-Step "Kopiere Programm nach $ProgramDir ..."
New-Item -ItemType Directory -Force -Path $ProgramDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Copy-Item -Path $ExePath -Destination $TargetExe -Force

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
# Datenordner: nur SYSTEM (S-1-5-18) und Administratoren (S-1-5-32-544)
& icacls.exe $DataDir /reset /T /C /Q | Out-Null
& icacls.exe $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Zugriffsrechte für $DataDir konnten nicht gesetzt werden." }
& icacls.exe $DataDir /setowner '*S-1-5-32-544' /T /C /Q | Out-Null

# Programmordner: SYSTEM + Administratoren voll, Benutzer (S-1-5-32-545) nur lesen/ausführen
& icacls.exe $ProgramDir /reset /T /C /Q | Out-Null
& icacls.exe $ProgramDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Zugriffsrechte für $ProgramDir konnten nicht gesetzt werden." }

# --- 7. Dienst einrichten ---
Write-Step "Richte Dienst $ServiceName ein ..."
if (-not $existing) {
    New-Service -Name $ServiceName `
        -BinaryPathName "`"$TargetExe`"" `
        -DisplayName 'Medienzeit Sperrdienst' `
        -Description 'Setzt den Medien-Vertrag durch (Medienzeit-App). Nicht deaktivieren.' `
        -StartupType Automatic | Out-Null
} else {
    & sc.exe config $ServiceName binPath= "`"$TargetExe`"" start= auto obj= LocalSystem | Out-Null
}
# Neustart nach Absturz: sofort nach 5 s, 5 s, 30 s; Zähler nach 1 Tag zurücksetzen
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null
# Rechte am Dienst: Benutzer dürfen ihn nur abfragen, nicht starten/stoppen/ändern
& sc.exe sdset $ServiceName 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWLOCRRC;;;AU)' | Out-Null

# --- 8. Abgesicherter Modus ---
Write-Step "Registriere Dienst für den abgesicherten Modus ..."
foreach ($mode in 'Minimal', 'Network') {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\$ServiceName"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(default)' -Value 'Service'
}

# --- 9. Starten und prüfen ---
Write-Step "Starte Dienst ..."
Start-Service -Name $ServiceName
Start-Sleep -Seconds 8
$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne 'Running') { Fail "Der Dienst läuft nicht (Status: $($svc.Status)). Siehe $DataDir\agent.log" }

Write-Host ""
Write-Host "Dienst läuft." -ForegroundColor Green
$log = Join-Path $DataDir 'agent.log'
if (Test-Path $log) {
    Write-Host "Letzte Zeilen aus dem Protokoll:"
    Get-Content $log -Tail 8 | ForEach-Object { Write-Host "   $_" }
}
Write-Host ""
Write-Host "Verbindungstest:  & '$TargetExe' --check"
Write-Host "Sitzungen zeigen: & '$TargetExe' --sessions"
Write-Host ""
Write-Host "Fertig! Bitte jetzt das Prüfprotokoll aus der Anleitung durchgehen." -ForegroundColor Green
