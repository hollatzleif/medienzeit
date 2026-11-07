<#
.SYNOPSIS
  Entfernt das Medienzeit-Sperrprogramm.

.DESCRIPTION
  Als Administrator ausführen:
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
  Mit -RemoveData werden auch Konfiguration, Cache und Protokoll in C:\ProgramData\Medienzeit gelöscht.
#>
[CmdletBinding()]
param(
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'MedienzeitAgent'
$ProgramDir  = Join-Path $env:ProgramFiles 'Medienzeit'
$DataDir     = Join-Path $env:ProgramData 'Medienzeit'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "FEHLER: Bitte PowerShell mit 'Als Administrator ausführen' starten." -ForegroundColor Red
    exit 1
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Halte Dienst an ..."
    & sc.exe failure $ServiceName reset= 0 actions= '""' | Out-Null
    if ($svc.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) } catch { }
    }
    Write-Host "Lösche Dienst ..."
    & sc.exe delete $ServiceName | Out-Null
} else {
    Write-Host "Dienst $ServiceName ist nicht installiert."
}

foreach ($mode in 'Minimal', 'Network') {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\$ServiceName"
    if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force; Write-Host "SafeBoot-Eintrag ($mode) entfernt." }
}

if (Test-Path $ProgramDir) {
    Start-Sleep -Seconds 2
    Remove-Item -Path $ProgramDir -Recurse -Force
    Write-Host "Programmordner entfernt."
}

if ($RemoveData -and (Test-Path $DataDir)) {
    Remove-Item -Path $DataDir -Recurse -Force
    Write-Host "Daten (Konfiguration, Cache, Protokoll) entfernt."
} elseif (Test-Path $DataDir) {
    Write-Host "Konfiguration bleibt in $DataDir (mit -RemoveData löschen)."
}

Write-Host "Medienzeit-Sperrprogramm deinstalliert." -ForegroundColor Green
