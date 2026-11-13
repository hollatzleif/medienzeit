# Tests für die Entscheidungslogik des Sperrprogramms (Skript-Version).
# Laufen ohne Windows:  pwsh -NoProfile -File laptop/tests/agent.tests.ps1

$ErrorActionPreference = 'Stop'
$env:MEDIENZEIT_LIB_ONLY = '1'
. (Join-Path $PSScriptRoot '..' 'agent.ps1')

$script:failed = 0
$script:passed = 0
function Assert {
    param([bool]$Cond, [string]$Name)
    if ($Cond) { $script:passed++; Write-Host "  ok   $Name" -ForegroundColor Green }
    else { $script:failed++; Write-Host "  FEHLER  $Name" -ForegroundColor Red }
}

$MIN = 60000
$H = 3600000
$base = [double]1800000000000

function New-Setup {
    param($Plan, [double]$Contact = $base)
    $st = New-AgentState
    $st.plan = @($Plan)
    $st.contactServerMs = $Contact
    $st.contactTick = 1000
    $st.contactWall = $Contact
    $rt = New-Runtime
    $rt.startedAt = $Contact
    return @{ st = $st; rt = $rt }
}
function Seg([double]$From, [double]$To, [bool]$Allowed, [string]$Kind, [string]$Text) {
    [pscustomobject]@{ from = $From; to = $To; allowed = $Allowed; kind = $Kind; text = $Text }
}
$active = @(@{ id = 3; active = $true })
$lockedScreen = @(@{ id = 3; active = $false })

Write-Host "Fall 10: offline"
$s = New-Setup -Plan @((Seg $base ($base + 24 * $H) $true 'allowed' 'Darf bis 21:30'))
$now = Get-EstimatedNow -St $s.st -Rt $s.rt -Tick (1000 + 3 * $H) -Wall ($base + 3 * $H)
Assert ($now -eq $base + 3 * $H) 'Zeit aus monotoner Uhr'
Assert ((Get-Verdict -St $s.st -Rt $s.rt -Now $now).allowed) 'Offline 3 Std. → Plan gilt weiter'
$now = Get-EstimatedNow -St $s.st -Rt $s.rt -Tick (1000 + 5 * $H) -Wall ($base + 5 * $H)
$v = Get-Verdict -St $s.st -Rt $s.rt -Now $now
Assert (-not $v.allowed) 'Offline 5 Std. → gesperrt'
Assert ($v.text -like 'Keine Verbindung*') 'Text: Keine Verbindung'
$v = Get-Verdict -St $s.st -Rt $s.rt -Now ($base + 3 * $H + 56 * $MIN)
Assert ($v.allowed -and $v.runEnd -eq $base + 4 * $H) 'Ende der Offline-Gültigkeit wird vorgewarnt'

Write-Host "Uhr"
$s = New-Setup -Plan @((Seg $base ($base + 24 * $H) $true 'allowed' 'x'))
$now = Get-EstimatedNow -St $s.st -Rt $s.rt -Tick (1000 + 1 * $H) -Wall ($base + 2 * $H)
Assert ($s.rt.clockSuspicious) 'Uhrsprung > 5 Min. erkannt'
Assert (-not (Get-Verdict -St $s.st -Rt $s.rt -Now $now).allowed) 'Bei Uhrsprung gesperrt'
$now = Get-EstimatedNow -St $s.st -Rt $s.rt -Tick 500 -Wall ($base + 2 * $H)
Assert (($now -eq $base + 2 * $H) -and -not $s.rt.clockSuspicious) 'Nach Neustart gilt die Wanduhr'
$s0 = New-Setup -Plan @()
$s0.st.contactServerMs = 0
Assert (-not (Get-Verdict -St $s0.st -Rt $s0.rt -Now $base).allowed) 'Ohne je Kontakt gesperrt'

Write-Host "Vorwarnung und geplantes Ende"
$plan = @((Seg $base ($base + 30 * $MIN) $true 'allowed' 'Darf bis 20:00'), (Seg ($base + 30 * $MIN) ($base + 24 * $H) $false 'schedule' 'Sperrzeit – wieder ab morgen 12:00'))
$s = New-Setup -Plan $plan
$t = $base + 20 * $MIN; $s.st.contactServerMs = $t
$a = Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions $active
Assert ($a.Count -eq 0) '10 Min. vorher: keine Meldung'
$t = $base + 25 * $MIN; $s.st.contactServerMs = $t
$a = Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'message' -and $a[0].text -like 'In 5 Minuten endet die Medienzeit*') '5 Min. vorher: Vorwarnung'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 1000) -ChildSessions $active
Assert ($a.Count -eq 0) 'Vorwarnung nur einmal'
$t = $base + 30 * $MIN; $s.st.contactServerMs = $t
$a = Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'logoff') 'Zum Ende: sofort abmelden'

Write-Host "Neue Strafe (unvorhergesehen)"
$s = New-Setup -Plan @((Seg $base ($base + 5 * $H) $true 'allowed' 'Darf bis 20:00'))
$t = $base + 60 * $MIN; $s.st.contactServerMs = $t
[void](Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions $active)
$s.st.plan = @((Seg $t ($t + $H) $false 'penalty' 'Gesperrt bis 15:30 – Rumschreien (Papa)'))
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 1000) -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'message' -and $a[0].text -like 'Gesperrt bis 15:30*60 Sekunden*') 'Meldung mit Grund und 60 Sekunden'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 59000) -ChildSessions $active
Assert ($a.Count -eq 0) 'Nach 58 s noch keine Abmeldung'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 61000) -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'logoff') 'Nach 60 s Abmeldung'
Assert (@($s.st.events | Where-Object { $_.type -eq 'logoff' }).Count -eq 1) 'Abmeldung wird dem Server gemeldet'

Write-Host "Strafe wird während der Frist aufgehoben"
$s = New-Setup -Plan @((Seg $base ($base + 5 * $H) $true 'allowed' 'Darf'))
$t = $base + 60 * $MIN; $s.st.contactServerMs = $t
[void](Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions $active)
$s.st.plan = @((Seg $t ($t + $H) $false 'penalty' 'Gesperrt'))
[void](Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 1000) -ChildSessions $active)
$s.st.plan = @((Seg $t ($t + 5 * $H) $true 'allowed' 'Darf'))
[void](Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 20000) -ChildSessions $active)
$s.st.plan = @((Seg $t ($t + $H) $false 'penalty' 'Gesperrt'))
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 62000) -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'message') 'Keine Abmeldung, neue Frist beginnt'

Write-Host "Anmeldung während der Sperre"
$s = New-Setup -Plan @((Seg $base ($base + 5 * $H) $false 'schedule' 'Sperrzeit – wieder ab 12:00'))
$t = $base + 10 * $MIN; $s.st.contactServerMs = $t
$a = Invoke-Step -St $s.st -Rt $s.rt -Now $t -ChildSessions @()
Assert ($a.Count -eq 0) 'Niemand angemeldet: nichts zu tun'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 1000) -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].text -like '*15 Sekunden*') 'Anmeldung: Meldung mit 15 Sekunden'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 17000) -ChildSessions $active
Assert ($a.Count -eq 1 -and $a[0].type -eq 'logoff') 'Nach 15 s Abmeldung'
$a = Invoke-Step -St $s.st -Rt $s.rt -Now ($t + 30000) -ChildSessions $lockedScreen
Assert ($a.Count -eq 1 -and $a[0].type -eq 'message') 'Auch gesperrter Bildschirm wird abgemeldet (neue Frist)'

Write-Host "Pausenregel offline"
$s = New-Setup -Plan @((Seg $base ($base + 24 * $H) $true 'allowed' 'Darf'))
$s.st.pauseActive = 180; $s.st.pauseMinutes = 30; $s.st.pauseBreak = 30
$s.rt.localActiveMs = 170 * $MIN
$t = $base + 2 * $H   # offline (letzter Kontakt vor 2 Std.)
$s.rt.lastStepAt = $t; $s.rt.lastActiveAt = $t
$warned = $false
for ($i = 1; $i -le 601; $i++) {
    $now = $t + $i * 1000
    Update-LocalActivity -St $s.st -Rt $s.rt -Now $now -Active $true
    $a = Invoke-Step -St $s.st -Rt $s.rt -Now $now -ChildSessions $active
    if (@($a | Where-Object { $_.type -eq 'message' -and $_.text -like '*beginnt eine Pause*' }).Count) { $warned = $true }
}
Assert $warned 'Vorwarnung vor der Pause'
$v = Get-Verdict -St $s.st -Rt $s.rt -Now ($t + 602000)
Assert ((-not $v.allowed) -and $v.kind -eq 'pause') 'Nach 3 Std. aktiv: Pause'
Assert ($s.st.offlinePauseUntil -gt 0) 'Pause hat ein Ende'
Assert (@($s.st.activity).Count -ge 1) 'Aktivität wird für den Server gepuffert'
$s.rt.localActiveMs = 100 * $MIN; $s.rt.lastActiveAt = $t
Update-LocalActivity -St $s.st -Rt $s.rt -Now ($t + 31 * $MIN) -Active $false
Assert ($s.rt.localActiveMs -eq 0) 'Pause ≥ 30 Min. setzt den Zähler zurück'

Write-Host "Tageskonto offline"
$s = New-Setup -Plan @((Seg $base ($base + 24 * $H) $true 'allowed' 'Darf'))
$s.st.budgetLeftMs = 10 * $MIN
$t = $base + 1 * $H   # offline
$s.rt.lastStepAt = $t; $s.rt.lastActiveAt = $t
$warned = $false
for ($i = 1; $i -le 601; $i++) {
    $now = $t + $i * 1000
    Update-LocalActivity -St $s.st -Rt $s.rt -Now $now -Active $true
    $a = Invoke-Step -St $s.st -Rt $s.rt -Now $now -ChildSessions $active
    if (@($a | Where-Object { $_.type -eq 'message' -and $_.text -like '*Laptop-Zeit für heute aufgebraucht*' }).Count) { $warned = $true }
}
Assert $warned 'Vorwarnung vor Ende des Tageskontos'
$v = Get-Verdict -St $s.st -Rt $s.rt -Now ($t + 602000)
Assert ((-not $v.allowed) -and $v.kind -eq 'budget') 'Tageskonto leer → gesperrt'
$s2 = New-Setup -Plan @((Seg $base ($base + 24 * $H) $true 'allowed' 'Darf'))
$resp2 = [pscustomobject]@{ serverTime = $base; segments = @((Seg $base ($base + $H) $true 'allowed' 'Darf')); budget = [pscustomobject]@{ leftMinutes = 25 } }
Update-FromResponse -St $s2.st -Rt $s2.rt -Resp $resp2 -Tick 1000 -Wall $base
Assert ($s2.st.budgetLeftMs -eq 25 * $MIN) 'Restzeit kommt vom Server'
$resp3 = [pscustomobject]@{ serverTime = $base; segments = @(); budget = [pscustomobject]@{ leftMinutes = $null } }
Update-FromResponse -St $s2.st -Rt $s2.rt -Resp $resp3 -Tick 1000 -Wall $base
Assert ($s2.st.budgetLeftMs -eq -1) 'Ohne Tageskonto: keine Grenze'

Write-Host "Offline-Meldung und Anfrage"
$s = New-Setup -Plan @()
$s.rt.startedAt = $base + 10 * $MIN
Add-OfflineEvent -St $s.st -Rt $s.rt -Now ($base + $H)
Add-OfflineEvent -St $s.st -Rt $s.rt -Now ($base + 2 * $H)
$off = @($s.st.events | Where-Object { $_.type -eq 'offline' })
Assert ($off.Count -eq 1 -and $off[0].from -eq $base + 10 * $MIN -and $off[0].to -eq $base + 2 * $H) 'Offline-Zeitraum ab Programmstart, nur ein Eintrag'
$json = ConvertTo-PollBody -St $s.st -Session 'active' | ConvertTo-Json -Depth 6 -Compress
Assert ($json -like '*"session":"active"*' -and $json -like '*"type":"offline"*') 'Anfrage enthält Sitzung und Ereignisse'
$resp = [pscustomobject]@{ serverTime = $base + 2 * $H; segments = @((Seg ($base + 2 * $H) ($base + 3 * $H) $true 'allowed' 'Darf')); offlineMinutes = 240; warnMinutes = 5; penaltyGraceSeconds = 60; reloginGraceSeconds = 15; pause = [pscustomobject]@{ activeMinutes = 180; breakMinutes = 30; pauseMinutes = 30; activeSoFarMinutes = 42 } }
Update-FromResponse -St $s.st -Rt $s.rt -Resp $resp -Tick 5000 -Wall ($base + 2 * $H)
Assert (@($s.st.events).Count -eq 0 -and $s.rt.localActiveMs -eq 42 * $MIN) 'Nach Antwort: Puffer leer, Zähler vom Server'

Write-Host "Konto-Abgleich"
Assert (Test-ChildName -Configured 'Ludwig' -User 'ludwig' -Domain 'LAPTOP') 'Name ohne Groß/klein'
Assert (-not (Test-ChildName -Configured 'Ludwig' -User 'Leif' -Domain 'LAPTOP')) 'Anderer Name'
Assert (Test-ChildName -Configured 'LAPTOP\Ludwig' -User 'Ludwig' -Domain 'laptop') 'Mit Computername'

Write-Host ""
Write-Host "$($script:passed) ok, $($script:failed) Fehler"
if ($script:failed) { exit 1 }
