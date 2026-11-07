<#
  Medienzeit-Sperrprogramm (Skript-Version)
  =========================================
  Läuft über die Windows-Aufgabenplanung als SYSTEM mit der eingebauten Windows PowerShell.
  Es gibt keine eigene .exe, deshalb blockieren Virenschutzprogramme das Programm nicht.

  Aufgaben:
   - fragt alle ~20 Sekunden beim Server nach (docs/geraete-api.md)
   - meldet Ludwig ab, wenn er nicht darf (WTS-API: WTSLogoffSession)
   - zeigt Meldungen in Ludwigs Sitzung (WTSSendMessage)
   - offline: der zuletzt geladene Plan gilt bis zu "offlineMinutes" weiter

  Hilfsaufrufe (PowerShell als Administrator):
    powershell -ExecutionPolicy Bypass -File "C:\Program Files\Medienzeit\agent.ps1" -Check
    powershell -ExecutionPolicy Bypass -File "C:\Program Files\Medienzeit\agent.ps1" -Sessions

  Kompatibel mit Windows PowerShell 5.1 (Windows 10/11, Home und Pro).
#>
param(
    [switch]$Check,
    [switch]$Sessions
)

$script:Version = '2.0.0'
$script:Title = 'Medienzeit'

# ======================================================================
#  Reine Logik (ohne Windows-Aufrufe, wird unter Linux getestet)
# ======================================================================

function New-AgentState {
    # Wird in state.json gespeichert
    return [pscustomobject]@{
        plan              = @()
        contactServerMs   = [double]0
        contactTick       = [double]0
        contactWall       = [double]0
        offlineMinutes    = 240
        warnMinutes       = 5
        penaltyGrace      = 60
        reloginGrace      = 15
        pauseActive       = 180
        pauseBreak        = 30
        pauseMinutes      = 30
        activeSoFar       = 0
        offlinePauseUntil = [double]0
        events            = @()
        activity          = @()
    }
}

function New-Runtime {
    # Nur im Speicher
    return @{
        pending         = @{}      # SessionId -> @{ at; text }
        prevAllowed     = $false
        warnedFor       = [double]0
        localActiveMs   = [double]0
        lastActiveAt    = [double]0
        lastStepAt      = [double]0
        startedAt       = [double]0
        clockSuspicious = $false
        lastSuccessAt   = [double]0
        enforce         = $true
    }
}

function Get-EstimatedNow {
    param($St, $Rt, [double]$Tick, [double]$Wall)
    if ($St.contactServerMs -le 0) { $Rt.clockSuspicious = $false; return $Wall }
    $byWall = $St.contactServerMs + ($Wall - $St.contactWall)
    if ($Tick -ge $St.contactTick) {
        # vermutlich derselbe Systemstart: monotone Uhr ist maßgeblich, Wanduhr als Gegenprobe
        $byTick = $St.contactServerMs + ($Tick - $St.contactTick)
        $Rt.clockSuspicious = [math]::Abs($byWall - $byTick) -gt 300000
        return $byTick
    }
    # Neustart: monotone Uhr wurde zurückgesetzt, Wanduhr verwenden
    $Rt.clockSuspicious = $false
    return $byWall
}

function Format-Clock {
    param([double]$Ms)
    if (-not $script:Tz) {
        $script:Tz = [TimeZoneInfo]::Local
        foreach ($id in 'W. Europe Standard Time', 'Europe/Zurich') {
            try { $script:Tz = [TimeZoneInfo]::FindSystemTimeZoneById($id); break } catch { }
        }
    }
    $utc = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Ms)
    return [TimeZoneInfo]::ConvertTime($utc, $script:Tz).ToString('HH:mm')
}

function Find-Segment {
    param($Plan, [double]$T)
    foreach ($s in @($Plan)) {
        if ($null -eq $s) { continue }
        if ([double]$s.from -le $T -and $T -lt [double]$s.to) { return $s }
    }
    return $null
}

function Get-AllowedRunEnd {
    # Ende der zusammenhängenden erlaubten Abschnitte ab T
    param($Plan, [double]$T)
    $end = $T
    $segs = @($Plan | Where-Object { $null -ne $_ } | Sort-Object { [double]$_.from })
    foreach ($s in $segs) {
        if ([double]$s.to -le $end) { continue }
        if ([double]$s.from -gt $end) { break }
        if (-not $s.allowed) { break }
        $end = [double]$s.to
    }
    return $end
}

function Test-Online {
    param($St, [double]$Now)
    return ($St.contactServerMs -gt 0) -and (($Now - $St.contactServerMs) -le 90000)
}

function Get-Verdict {
    param($St, $Rt, [double]$Now)
    $offlineMs = [double]$St.offlineMinutes * 60000
    if ($St.contactServerMs -le 0) {
        return @{ allowed = $false; text = 'Noch keine Verbindung zum Server – Laptop gesperrt.'; kind = 'offline'; runEnd = $Now; endText = '' }
    }
    if ($Rt.clockSuspicious) {
        return @{ allowed = $false; text = 'Die Uhrzeit stimmt nicht – Laptop gesperrt, bis der Server wieder erreichbar ist.'; kind = 'offline'; runEnd = $Now; endText = '' }
    }
    $validUntil = $St.contactServerMs + $offlineMs
    if ($Now -ge $validUntil) {
        return @{ allowed = $false; text = 'Keine Verbindung zum Server – Laptop gesperrt.'; kind = 'offline'; runEnd = $Now; endText = '' }
    }
    $online = Test-Online -St $St -Now $Now
    if (-not $online -and $St.offlinePauseUntil -gt $Now) {
        return @{ allowed = $false; text = "Pause bis $(Format-Clock $St.offlinePauseUntil)"; kind = 'pause'; runEnd = $Now; endText = '' }
    }
    $seg = Find-Segment -Plan $St.plan -T $Now
    if ($null -eq $seg) {
        return @{ allowed = $false; text = 'Kein aktueller Plan – Laptop gesperrt.'; kind = 'offline'; runEnd = $Now; endText = '' }
    }
    if (-not $seg.allowed) {
        return @{ allowed = $false; text = [string]$seg.text; kind = [string]$seg.kind; runEnd = $Now; endText = '' }
    }
    $runEnd = Get-AllowedRunEnd -Plan $St.plan -T $Now
    $endText = 'endet die Medienzeit'
    $after = Find-Segment -Plan $St.plan -T $runEnd
    if ($null -ne $after -and $after.kind -eq 'pause') { $endText = 'beginnt eine Pause' }
    elseif ($null -ne $after -and $after.kind -eq 'penalty') { $endText = 'beginnt eine Sperre' }
    if ($validUntil -lt $runEnd) { $runEnd = $validUntil; $endText = 'wird der Laptop gesperrt (keine Verbindung zum Server)' }
    if (-not $online -and $Rt.lastActiveAt -ge ($Now - 5000)) {
        $pauseAt = $Now + ([double]$St.pauseActive * 60000 - $Rt.localActiveMs)
        if ($pauseAt -lt $runEnd) { $runEnd = $pauseAt; $endText = 'beginnt eine Pause' }
    }
    return @{ allowed = $true; text = [string]$seg.text; kind = [string]$seg.kind; runEnd = $runEnd; endText = $endText }
}

function Update-LocalActivity {
    # Aktive Zeit für die Pausenregel offline selbst zählen und für den Server puffern
    param($St, $Rt, [double]$Now, [bool]$Active)
    $dt = 0
    if ($Rt.lastStepAt -gt 0) { $dt = [math]::Min(5000, [math]::Max(0, $Now - $Rt.lastStepAt)) }
    $Rt.lastStepAt = $Now
    $breakMs = [double]$St.pauseBreak * 60000
    if ($Rt.lastActiveAt -gt 0 -and ($Now - $Rt.lastActiveAt) -ge $breakMs) { $Rt.localActiveMs = 0 }
    if (-not $Active) { return }
    $Rt.localActiveMs += $dt
    $Rt.lastActiveAt = $Now
    if (Test-Online -St $St -Now $Now) { return }
    # offline: Aktivität für den Server puffern
    $list = @($St.activity)
    if ($list.Count -gt 0 -and ($Now - [double]$list[-1].to) -le 60000) {
        $list[-1].to = $Now
    } else {
        $list += [pscustomobject]@{ from = $Now; to = $Now }
    }
    if ($list.Count -gt 300) { $list = $list[-300..-1] }
    $St.activity = $list
    # offline: Pausenregel selbst durchsetzen
    if ($Rt.localActiveMs -ge [double]$St.pauseActive * 60000) {
        $St.offlinePauseUntil = $Now + [double]$St.pauseMinutes * 60000
        $Rt.localActiveMs = 0
    }
}

function Add-AgentEvent {
    param($St, [hashtable]$Ev)
    $list = @($St.events) + @([pscustomobject]$Ev)
    if ($list.Count -gt 100) { $list = $list[-100..-1] }
    $St.events = $list
}

function Invoke-Step {
    <#
      Eine Entscheidung pro Sekunde. Gibt Aktionen zurück:
        @{ type = 'message'; session = 3; text = '…' }
        @{ type = 'logoff';  session = 3; text = '…' }
      $ChildSessions: Liste von @{ id; active (angemeldet+entsperrt) }
    #>
    param($St, $Rt, [double]$Now, $ChildSessions)
    $actions = New-Object System.Collections.ArrayList
    $v = Get-Verdict -St $St -Rt $Rt -Now $Now
    $children = @($ChildSessions | Where-Object { $null -ne $_ })

    if (-not $Rt.enforce) { return ,$actions }

    if ($v.allowed) {
        $Rt.pending = @{}
        $left = $v.runEnd - $Now
        $warnMs = [double]$St.warnMinutes * 60000
        $anyActive = @($children | Where-Object { $_.active }).Count -gt 0
        if ($anyActive -and $left -gt 0 -and $left -le $warnMs -and $Rt.warnedFor -ne $v.runEnd) {
            $min = [math]::Max(1, [math]::Ceiling($left / 60000))
            $text = "In $min Minute$(if ($min -ne 1) { 'n' }) $($v.endText) ($(Format-Clock $v.runEnd) Uhr). Bitte jetzt speichern."
            foreach ($c in $children) { [void]$actions.Add(@{ type = 'message'; session = $c.id; text = $text }) }
            $Rt.warnedFor = $v.runEnd
            Add-AgentEvent -St $St -Ev @{ ts = $Now; type = 'warning'; text = $text }
        }
        $Rt.prevAllowed = $true
        return ,$actions
    }

    # Nicht erlaubt
    $foreseen = $Rt.prevAllowed -and $Rt.warnedFor -gt 0 -and $Now -ge ($Rt.warnedFor - 3000) -and $Now -le ($Rt.warnedFor + 120000)
    foreach ($c in $children) {
        $key = [string]$c.id
        if ($Rt.pending.ContainsKey($key)) {
            if ($Now -ge $Rt.pending[$key].at) {
                [void]$actions.Add(@{ type = 'logoff'; session = $c.id; text = $Rt.pending[$key].text })
                Add-AgentEvent -St $St -Ev @{ ts = $Now; type = 'logoff'; text = $Rt.pending[$key].text }
                $Rt.pending.Remove($key)
            }
            continue
        }
        if ($foreseen) {
            [void]$actions.Add(@{ type = 'logoff'; session = $c.id; text = $v.text })
            Add-AgentEvent -St $St -Ev @{ ts = $Now; type = 'logoff'; text = $v.text }
            continue
        }
        if ($Rt.prevAllowed) {
            $grace = [int]$St.penaltyGrace
            $msg = "$($v.text)`n`nDu wirst in $grace Sekunden abgemeldet – bitte jetzt speichern."
        } else {
            $grace = [int]$St.reloginGrace
            $msg = "$($v.text)`n`nDu wirst in $grace Sekunden abgemeldet."
        }
        [void]$actions.Add(@{ type = 'message'; session = $c.id; text = $msg })
        $Rt.pending[$key] = @{ at = $Now + $grace * 1000; text = $v.text }
    }
    # Sitzungen, die nicht mehr da sind, vergessen
    foreach ($k in @($Rt.pending.Keys)) {
        if (-not (@($children | Where-Object { [string]$_.id -eq $k }).Count)) { $Rt.pending.Remove($k) }
    }
    $Rt.prevAllowed = $false
    return ,$actions
}

function Add-OfflineEvent {
    # Vor jeder Anfrage: War der Laptop länger ohne Verbindung, während das Programm lief?
    param($St, $Rt, [double]$Now)
    if ($St.contactServerMs -le 0) { return }
    $from = [math]::Max([double]$St.contactServerMs, [double]$Rt.startedAt)
    if (($Now - $from) -le 90000) { return }
    $list = @($St.events)
    $existing = $list | Where-Object { $_.type -eq 'offline' -and [double]$_.from -eq $from } | Select-Object -First 1
    if ($existing) { $existing.to = $Now; $existing.ts = $Now; $St.events = $list; return }
    Add-AgentEvent -St $St -Ev @{ ts = $Now; type = 'offline'; from = $from; to = $Now }
}

function Update-FromResponse {
    param($St, $Rt, $Resp, [double]$Tick, [double]$Wall)
    if ($null -eq $Resp -or -not $Resp.serverTime) { throw 'Antwort ohne serverTime' }
    $St.plan = @($Resp.segments)
    $St.contactServerMs = [double]$Resp.serverTime
    $St.contactTick = $Tick
    $St.contactWall = $Wall
    if ($Resp.offlineMinutes) { $St.offlineMinutes = [int]$Resp.offlineMinutes }
    if ($Resp.warnMinutes) { $St.warnMinutes = [int]$Resp.warnMinutes }
    if ($Resp.penaltyGraceSeconds) { $St.penaltyGrace = [int]$Resp.penaltyGraceSeconds }
    if ($Resp.reloginGraceSeconds) { $St.reloginGrace = [int]$Resp.reloginGraceSeconds }
    if ($Resp.pause) {
        $St.pauseActive = [int]$Resp.pause.activeMinutes
        $St.pauseBreak = [int]$Resp.pause.breakMinutes
        $St.pauseMinutes = [int]$Resp.pause.pauseMinutes
        $St.activeSoFar = [int]$Resp.pause.activeSoFarMinutes
        $Rt.localActiveMs = [double]$Resp.pause.activeSoFarMinutes * 60000
    }
    $St.offlinePauseUntil = [double]0
    $St.events = @()
    $St.activity = @()
    $Rt.clockSuspicious = $false
    $Rt.lastSuccessAt = [double]$Resp.serverTime
}

function ConvertTo-PollBody {
    param($St, [string]$Session)
    return [ordered]@{
        agentVersion = $script:Version
        session      = $Session
        activity     = @($St.activity | ForEach-Object { @{ from = [double]$_.from; to = [double]$_.to } })
        events       = @($St.events | ForEach-Object {
                $e = @{ ts = [double]$_.ts; type = [string]$_.type }
                if ($_.PSObject.Properties['from']) { $e.from = [double]$_.from }
                if ($_.PSObject.Properties['to']) { $e.to = [double]$_.to }
                if ($_.PSObject.Properties['text']) { $e.text = [string]$_.text }
                $e
            })
    }
}

function Test-ChildName {
    param([string]$Configured, [string]$User, [string]$Domain)
    if (-not $User) { return $false }
    $cfg = $Configured.Trim()
    if ($cfg.Contains('\')) {
        return ("$Domain\$User" -ieq $cfg)
    }
    return ($User -ieq $cfg)
}

# Beim Testen nur die Funktionen laden
if ($env:MEDIENZEIT_LIB_ONLY -eq '1') { return }

# ======================================================================
#  Windows-Teil
# ======================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:Dir = $env:MEDIENZEIT_DIR
if (-not $script:Dir) { $script:Dir = Join-Path $env:ProgramData 'Medienzeit' }
$script:LogPath = Join-Path $script:Dir 'agent.log'
$script:StatePath = Join-Path $script:Dir 'state.json'
$script:ConfigPath = Join-Path $script:Dir 'config.json'

function Write-Log {
    param([string]$Text)
    try {
        if ((Test-Path $script:LogPath) -and (Get-Item $script:LogPath).Length -gt 1MB) {
            Move-Item $script:LogPath "$($script:LogPath).1" -Force
        }
        $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
        Add-Content -Path $script:LogPath -Value $line -Encoding UTF8
    } catch { }
    if ($Check -or $Sessions) { Write-Host $Text }
}

$wtsCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class MedienzeitWts
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WTS_SESSION_INFO { public int SessionId; public IntPtr pWinStationName; public int State; }

    [DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSEnumerateSessionsW")]
    private static extern bool WTSEnumerateSessions(IntPtr h, int r, int v, out IntPtr p, out int c);
    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSQuerySessionInformationW")]
    private static extern bool WTSQuerySessionInformation(IntPtr h, int id, int cls, out IntPtr buf, out int bytes);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr p);
    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSSendMessageW")]
    private static extern bool WTSSendMessage(IntPtr h, int id, string title, int tl, string msg, int ml, int style, int timeout, out int resp, bool wait);
    [DllImport("wtsapi32.dll", SetLastError = true)] private static extern bool WTSLogoffSession(IntPtr h, int id, bool wait);

    public class Session { public int Id; public int State; public string User; public string Domain; public int Flags; }

    private static string Q(int id, int cls)
    {
        IntPtr buf; int bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, id, cls, out buf, out bytes)) return "";
        try { string s = Marshal.PtrToStringUni(buf); return s == null ? "" : s; } finally { WTSFreeMemory(buf); }
    }

    // SessionFlags: 0 = gesperrt, 1 = entsperrt, -1 = unbekannt
    private static int Flags(int id)
    {
        IntPtr buf; int bytes;
        if (!WTSQuerySessionInformation(IntPtr.Zero, id, 25, out buf, out bytes)) return -1;
        try {
            if (bytes < 20 || Marshal.ReadInt32(buf, 0) != 1) return -1;
            return Marshal.ReadInt32(buf, 16);
        } finally { WTSFreeMemory(buf); }
    }

    public static Session[] List()
    {
        var result = new List<Session>();
        IntPtr p; int c;
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out p, out c)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
            for (int i = 0; i < c; i++) {
                var info = (WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(WTS_SESSION_INFO));
                if (info.SessionId == 0 || info.State == 6) continue;
                string user = Q(info.SessionId, 5);
                if (string.IsNullOrEmpty(user)) continue;
                var s = new Session();
                s.Id = info.SessionId; s.State = info.State; s.User = user; s.Domain = Q(info.SessionId, 7); s.Flags = Flags(info.SessionId);
                result.Add(s);
            }
        } finally { WTSFreeMemory(p); }
        return result.ToArray();
    }

    public static bool Message(int id, string title, string text, int timeoutSeconds)
    {
        int resp;
        // MB_OK | MB_ICONWARNING | MB_SYSTEMMODAL | MB_SETFOREGROUND | MB_TOPMOST
        return WTSSendMessage(IntPtr.Zero, id, title, title.Length * 2, text, text.Length * 2, 0x30 | 0x1000 | 0x10000 | 0x40000, timeoutSeconds, out resp, false);
    }

    public static bool Logoff(int id) { return WTSLogoffSession(IntPtr.Zero, id, false); }
}
'@

if (-not ('MedienzeitWts' -as [type])) { Add-Type -TypeDefinition $wtsCode -Language CSharp }

function Get-Tick { return [double][MedienzeitWts]::GetTickCount64() }
function Get-Wall { return [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

function Read-Config {
    if (-not (Test-Path $script:ConfigPath)) { throw "Konfiguration fehlt: $($script:ConfigPath)" }
    $c = Get-Content $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not ($c.serverUrl -match '^https?://')) { throw 'serverUrl fehlt oder ist ungültig.' }
    if (-not $c.deviceToken) { throw 'deviceToken fehlt.' }
    if (-not $c.childAccount) { throw 'childAccount fehlt.' }
    $poll = 20
    if ($c.PSObject.Properties['pollSeconds'] -and $c.pollSeconds) { $poll = [math]::Min(120, [math]::Max(5, [int]$c.pollSeconds)) }
    return @{ serverUrl = ([string]$c.serverUrl).TrimEnd('/'); deviceToken = [string]$c.deviceToken; childAccount = [string]$c.childAccount; pollSeconds = $poll }
}

function Read-State {
    $st = New-AgentState
    if (Test-Path $script:StatePath) {
        try {
            $saved = Get-Content $script:StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $st.PSObject.Properties.Name) {
                if ($saved.PSObject.Properties[$p]) { $st.$p = $saved.$p }
            }
            $st.plan = @($st.plan); $st.events = @($st.events); $st.activity = @($st.activity)
        } catch { Write-Log "state.json unlesbar, starte neu: $($_.Exception.Message)" }
    }
    return $st
}

function Save-State {
    param($St)
    try {
        $tmp = "$($script:StatePath).tmp"
        $St | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path $tmp -Encoding UTF8
        Move-Item $tmp $script:StatePath -Force
    } catch { Write-Log "Speichern fehlgeschlagen: $($_.Exception.Message)" }
}

function Get-ChildSessions {
    param([string]$Account)
    $out = @()
    foreach ($s in [MedienzeitWts]::List()) {
        if (-not (Test-ChildName -Configured $Account -User $s.User -Domain $s.Domain)) { continue }
        # aktiv = verbunden (State 0) und entsperrt (Flags 1)
        $out += @{ id = $s.Id; active = ($s.State -eq 0 -and $s.Flags -eq 1); state = $s.State; flags = $s.Flags }
    }
    return ,$out
}

function Test-ChildIsAdmin {
    param([string]$Account)
    try {
        $sid = (New-Object System.Security.Principal.NTAccount($Account)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch { return $false }
    try {
        $members = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop
        return @($members | Where-Object { $_.SID.Value -eq $sid }).Count -gt 0
    } catch {
        return $false
    }
}

function Invoke-Poll {
    param($Cfg, $St, [string]$Session)
    $body = ConvertTo-PollBody -St $St -Session $Session | ConvertTo-Json -Depth 6 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $resp = Invoke-WebRequest -Uri "$($Cfg.serverUrl)/api/device/poll" -Method Post -UseBasicParsing -TimeoutSec 15 `
        -Headers @{ Authorization = "Bearer $($Cfg.deviceToken)" } -ContentType 'application/json; charset=utf-8' -Body $bytes
    $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    return ($text | ConvertFrom-Json)
}

# ---------------------------------------------------------------- Hilfsaufrufe

if ($Sessions) {
    $cfgName = ''
    try { $cfgName = (Read-Config).childAccount } catch { }
    Write-Host "Angemeldete Sitzungen:"
    foreach ($s in [MedienzeitWts]::List()) {
        $lock = switch ($s.Flags) { 0 { 'gesperrt' } 1 { 'entsperrt' } default { 'unbekannt' } }
        $mark = ''
        if ($cfgName -and (Test-ChildName -Configured $cfgName -User $s.User -Domain $s.Domain)) { $mark = '  <-- Kind-Konto' }
        Write-Host ("  Sitzung {0}: {1}\{2}  Zustand {3}  {4}{5}" -f $s.Id, $s.Domain, $s.User, $s.State, $lock, $mark)
    }
    exit 0
}

if ($Check) {
    Write-Host "Medienzeit-Sperrprogramm $($script:Version)"
    try { $cfg = Read-Config } catch { Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
    Write-Host "Server:     $($cfg.serverUrl)"
    Write-Host "Kind-Konto: $($cfg.childAccount)"
    if (Test-ChildIsAdmin -Account $cfg.childAccount) {
        Write-Host "WARNUNG: Kind-Konto ist Administrator – es wird NICHTS gesperrt!" -ForegroundColor Red
    } else {
        Write-Host "Kind-Konto ist Standardbenutzer." -ForegroundColor Green
    }
    $task = Get-ScheduledTask -TaskName 'Medienzeit' -ErrorAction SilentlyContinue
    if ($task) { Write-Host "Aufgabe 'Medienzeit': $($task.State)" } else { Write-Host "Aufgabe 'Medienzeit' fehlt!" -ForegroundColor Red }
    try {
        $st = New-AgentState
        $r = Invoke-Poll -Cfg $cfg -St $st -Session 'none'
        Write-Host "Server ok." -ForegroundColor Green
        Write-Host "Status jetzt: $($r.text)"
        foreach ($s in @($r.segments)) {
            Write-Host ("  {0}–{1}  {2}" -f (Format-Clock $s.from), (Format-Clock $s.to), $s.text)
        }
        exit 0
    } catch {
        Write-Host "Server NICHT erreichbar: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# ---------------------------------------------------------------- Dauerbetrieb

Write-Log "Medienzeit-Sperrprogramm $($script:Version) startet (PID $PID)."
$cfg = $null
while (-not $cfg) {
    try { $cfg = Read-Config } catch { Write-Log "Konfiguration ungültig: $($_.Exception.Message). Neuer Versuch in 60 s."; Start-Sleep -Seconds 60 }
}

$st = Read-State
$rt = New-Runtime
$rt.startedAt = Get-EstimatedNow -St $st -Rt $rt -Tick (Get-Tick) -Wall (Get-Wall)
Add-AgentEvent -St $st -Ev @{ ts = $rt.startedAt; type = 'started'; text = "Sperrprogramm $($script:Version) gestartet" }

if (Test-ChildIsAdmin -Account $cfg.childAccount) {
    $rt.enforce = $false
    Write-Log "FEHLER: Kind-Konto $($cfg.childAccount) ist Administrator – es wird nichts gesperrt."
    Add-AgentEvent -St $st -Ev @{ ts = $rt.startedAt; type = 'error'; text = 'Kind-Konto ist Administrator – Sperrprogramm sperrt nicht!' }
}

$pollMs = [double]$cfg.pollSeconds * 1000
$nextPoll = [double]0
$nextSave = [double]0
$failCount = 0
$lastDecision = ''

while ($true) {
    try {
        $now = Get-EstimatedNow -St $st -Rt $rt -Tick (Get-Tick) -Wall (Get-Wall)
        $children = Get-ChildSessions -Account $cfg.childAccount
        $sessionState = 'none'
        if (@($children | Where-Object { $_.active }).Count) { $sessionState = 'active' }
        elseif (@($children).Count) { $sessionState = 'locked' }

        if ($now -ge $nextPoll) {
            $nextPoll = $now + $pollMs
            try {
                Add-OfflineEvent -St $st -Rt $rt -Now $now
                $resp = Invoke-Poll -Cfg $cfg -St $st -Session $sessionState
                Update-FromResponse -St $st -Rt $rt -Resp $resp -Tick (Get-Tick) -Wall (Get-Wall)
                if ($failCount -gt 0) { Write-Log "Verbindung wieder da." }
                $failCount = 0
                Save-State -St $st
                $now = Get-EstimatedNow -St $st -Rt $rt -Tick (Get-Tick) -Wall (Get-Wall)
            } catch {
                $failCount++
                if ($failCount -eq 1 -or $failCount % 30 -eq 0) { Write-Log "Server nicht erreichbar ($failCount×): $($_.Exception.Message)" }
            }
        }

        Update-LocalActivity -St $st -Rt $rt -Now $now -Active ($sessionState -eq 'active')
        $actions = Invoke-Step -St $st -Rt $rt -Now $now -ChildSessions $children

        foreach ($a in $actions) {
            if ($a.type -eq 'message') {
                Write-Log "Meldung an Sitzung $($a.session): $($a.text -replace "`n", ' ')"
                [void][MedienzeitWts]::Message([int]$a.session, $script:Title, [string]$a.text, 55)
            } elseif ($a.type -eq 'logoff') {
                Write-Log "Abmeldung Sitzung $($a.session): $($a.text)"
                [void][MedienzeitWts]::Logoff([int]$a.session)
                Save-State -St $st
            }
        }

        $v = Get-Verdict -St $st -Rt $rt -Now $now
        $decision = "$($v.allowed) $($v.text)"
        if ($decision -ne $lastDecision) { Write-Log "Status: $(if ($v.allowed) { 'erlaubt' } else { 'gesperrt' }) – $($v.text)"; $lastDecision = $decision }

        if ($now -ge $nextSave) { Save-State -St $st; $nextSave = $now + 30000 }
    } catch {
        Write-Log "Fehler: $($_.Exception.Message)"
        Start-Sleep -Seconds 4
    }
    Start-Sleep -Milliseconds 1000
}
