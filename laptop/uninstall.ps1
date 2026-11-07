<#
.SYNOPSIS
  Entfernt das Medienzeit-Sperrprogramm (Skript-Version und ggf. alte .exe-Version).

.DESCRIPTION
  Als Administrator ausführen:
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
  Mit -RemoveData werden auch Konfiguration, Zwischenspeicher und Protokoll in C:\ProgramData\Medienzeit gelöscht.
#>
[CmdletBinding()]
param(
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$TaskName   = 'Medienzeit'
$OldService = 'MedienzeitAgent'
$ProgramDir = Join-Path $env:ProgramFiles 'Medienzeit'
$DataDir    = Join-Path $env:ProgramData 'Medienzeit'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "FEHLER: Bitte PowerShell mit 'Als Administrator ausführen' starten." -ForegroundColor Red
    exit 1
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Entferne Aufgabe '$TaskName' ..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Medienzeit\agent.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Get-Service -Name $OldService -ErrorAction SilentlyContinue) {
    Write-Host "Entferne alte .exe-Version ..."
    & sc.exe failure $OldService reset= 0 actions= '""' | Out-Null
    Stop-Service -Name $OldService -Force -ErrorAction SilentlyContinue
    & sc.exe delete $OldService | Out-Null
}
foreach ($mode in 'Minimal', 'Network') {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\$mode\$OldService"
    if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
}

if (Test-Path $ProgramDir) {
    Start-Sleep -Seconds 2
    Remove-Item -Path $ProgramDir -Recurse -Force
    Write-Host "Programmordner entfernt."
}

if ($RemoveData -and (Test-Path $DataDir)) {
    Remove-Item -Path $DataDir -Recurse -Force
    Write-Host "Daten (Konfiguration, Zwischenspeicher, Protokoll) entfernt."
} elseif (Test-Path $DataDir) {
    Write-Host "Konfiguration bleibt in $DataDir (mit -RemoveData löschen)."
}

Write-Host "Medienzeit-Sperrprogramm deinstalliert." -ForegroundColor Green
