using System.Runtime.Versioning;
using Microsoft.Extensions.Logging;

namespace Medienzeit.Agent;

public sealed record AgentPaths(string Dir);

/// <summary>
/// Der eigentliche Dienst: fragt regelmäßig beim Server an und setzt einmal pro Sekunde die Entscheidung durch.
/// Läuft unter SYSTEM. Kein Hilfsprozess in Ludwigs Sitzung, alles über die WTS-API.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class AgentWorker : BackgroundService
{
    private const string Title = "Medienzeit";

    private readonly ILogger<AgentWorker> _log;
    private readonly string _dir;
    private readonly StateStore _store;
    private readonly Enforcer _enforcer = new();
    private readonly object _gate = new();

    private AgentState _state = new();
    private AgentConfig _cfg = new();
    private ChildAccount? _child;
    private bool _enforce = true;
    private bool _contactInThisProcess;
    private bool _newContact;
    private long _runStartMs;
    private long _lastSaveMs;
    private int _failCount;
    private int _wtsErrors;
    private SessionState _lastSession = SessionState.None;
    private string _lastDecision = "";

    public AgentWorker(ILogger<AgentWorker> log, AgentPaths paths)
    {
        _log = log;
        _dir = paths.Dir;
        _store = new StateStore(_dir);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            _log.LogInformation("Medienzeit-Sperrdienst {Version} startet. Ordner: {Dir}", AgentInfo.Version, _dir);
            _cfg = await LoadConfigAsync(ct);
            _child = new ChildAccount(_cfg.ChildAccount);

            _state = _store.Load(msg => _log.LogWarning("{Msg}", msg));
            var start = Now();
            _runStartMs = start.NowMs;
            OfflineTracker.OnServiceStart(_state);
            Buffers.AddEvent(_state, new AgentEvent { Ts = _runStartMs, Type = "started", Text = $"Sperrprogramm {AgentInfo.Version} gestartet" });

            try
            {
                _log.LogInformation("Kind-Konto {Account}, SID {Sid}", _cfg.ChildAccount, _child.ResolveSid());
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Kind-Konto {Account} wurde nicht gefunden. Sitzungen werden trotzdem per Name erkannt.", _cfg.ChildAccount);
                Buffers.AddEvent(_state, new AgentEvent { Ts = _runStartMs, Type = "error", Text = $"Kind-Konto „{_cfg.ChildAccount}“ nicht gefunden" });
            }

            try
            {
                if (_child.IsLocalAdmin())
                {
                    _enforce = false;
                    _log.LogError("Das Kind-Konto {Account} ist Administrator! Es wird NICHTS gesperrt. Bitte Konto auf Standardbenutzer umstellen und Dienst neu starten.", _cfg.ChildAccount);
                    Buffers.AddEvent(_state, new AgentEvent { Ts = _runStartMs, Type = "error", Text = "Kind-Konto ist Administrator – Sperrprogramm sperrt nicht!" });
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Admin-Prüfung für {Account} nicht möglich.", _cfg.ChildAccount);
            }

            Save(start.NowMs);

            using var client = new ServerClient(_cfg);
            await Task.WhenAll(PollLoopAsync(client, ct), EnforceLoopAsync(ct));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            lock (_gate) Save(Now().NowMs);
        }
        catch (Exception ex)
        {
            // Ein schwerer Fehler beendet den Prozess mit Fehlercode, damit Windows den Dienst neu startet.
            _log.LogCritical(ex, "Unerwarteter Fehler – Dienst beendet sich und wird von Windows neu gestartet.");
            Environment.Exit(1);
        }
    }

    private async Task<AgentConfig> LoadConfigAsync(CancellationToken ct)
    {
        while (true)
        {
            try
            {
                return AgentConfig.Load(_dir);
            }
            catch (Exception ex)
            {
                _log.LogError("Konfiguration ungültig: {Msg}. Neuer Versuch in 60 Sekunden.", ex.Message);
            }
            await Task.Delay(TimeSpan.FromSeconds(60), ct);
        }
    }

    private TimeEstimate Now() => TimeEstimator.Estimate(
        _state.Contact,
        Environment.TickCount64,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        _state.LastAliveWallUtc,
        _contactInThisProcess);

    // ---------------- Server-Abfrage ----------------

    private async Task PollLoopAsync(ServerClient client, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(client, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Fehler bei der Server-Abfrage");
            }
            await Task.Delay(TimeSpan.FromSeconds(_cfg.PollSeconds), ct);
        }
    }

    private async Task PollOnceAsync(ServerClient client, CancellationToken ct)
    {
        PollRequest req;
        int eventCount, activityCount;
        long lastActivityTo;
        lock (_gate)
        {
            req = new PollRequest
            {
                AgentVersion = AgentInfo.Version,
                Session = Json.SessionToWire(_lastSession),
                Activity = _state.PendingActivity.Select(a => new TimeRange { From = a.From, To = a.To }).ToList(),
                Events = _state.PendingEvents.ToList(),
            };
            eventCount = req.Events.Count;
            activityCount = req.Activity.Count;
            lastActivityTo = activityCount > 0 ? req.Activity[^1].To : 0;
        }

        var (resp, error) = await client.PollAsync(req, ct);

        lock (_gate)
        {
            if (resp is not null)
            {
                _state.Contact = new ContactInfo
                {
                    ServerTime = resp.ServerTime,
                    Tick = Environment.TickCount64,
                    WallUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                };
                _contactInThisProcess = true;
                _state.Plan = resp;
                _newContact = true;
                Buffers.AcknowledgeSent(_state, eventCount, activityCount, lastActivityTo);
                OfflineTracker.OnPollSuccess(_state, resp.ServerTime);
                if (_failCount > 0) _log.LogInformation("Verbindung zum Server wieder da (nach {Count} Fehlversuchen).", _failCount);
                _failCount = 0;
                Save(resp.ServerTime);
            }
            else
            {
                OfflineTracker.OnPollFailure(_state, Now().NowMs, _runStartMs);
                if (_failCount % 15 == 0) _log.LogWarning("Server nicht erreichbar: {Error}", error);
                _failCount++;
            }
        }
    }

    // ---------------- Durchsetzen ----------------

    private async Task EnforceLoopAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        do
        {
            try
            {
                EnforceOnce();
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Fehler beim Durchsetzen");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    private void EnforceOnce()
    {
        var sessions = ReadChildSessions();
        var session = Aggregate(sessions);

        EnforcementResult res;
        lock (_gate)
        {
            var est = Now();
            Buffers.RecordActivity(_state, est.NowMs, session == SessionState.Active);
            res = _enforcer.Tick(new EnforcementInput
            {
                NowMs = est.NowMs,
                Session = session,
                Plan = _state.Plan,
                LastContactMs = _state.Contact?.ServerTime,
                ClockSuspicious = est.Suspicious,
                NewContact = _newContact,
            }, _state.Engine);
            _newContact = false;
            _lastSession = session;

            if (_enforce)
            {
                foreach (var a in res.Actions)
                {
                    if (a.Type == ActionType.Warning)
                        Buffers.AddEvent(_state, new AgentEvent { Ts = est.NowMs, Type = "warning", Text = a.Text.Split('\n')[0] });
                    else if (a.Type == ActionType.Logoff)
                        Buffers.AddEvent(_state, new AgentEvent { Ts = est.NowMs, Type = "logoff", Text = a.Text });
                }
            }

            if (est.NowMs - _lastSaveMs > 15_000 || res.Actions.Count > 0) Save(est.NowMs);

            string summary = $"{(res.Decision.Allowed ? "erlaubt" : "gesperrt")}: {res.Decision.Text}";
            if (summary != _lastDecision)
            {
                _log.LogInformation("Status {Summary} (Sitzung: {Session})", summary, session);
                _lastDecision = summary;
            }
        }

        if (!_enforce || res.Actions.Count == 0) return;
        foreach (var a in res.Actions)
        {
            foreach (var s in sessions)
            {
                switch (a.Type)
                {
                    case ActionType.Message:
                    case ActionType.Warning:
                        if (!Wts.SendMessage(s.Id, Title, a.Text, Math.Max(10, a.TimeoutSeconds)))
                            _log.LogWarning("Meldung an Sitzung {Id} fehlgeschlagen.", s.Id);
                        else
                            _log.LogInformation("Meldung an Sitzung {Id}: {Text}", s.Id, a.Text.Replace('\n', ' '));
                        break;
                    case ActionType.Logoff:
                        if (Wts.Logoff(s.Id))
                            _log.LogInformation("Sitzung {Id} abgemeldet: {Text}", s.Id, a.Text);
                        else
                            _log.LogWarning("Abmeldung von Sitzung {Id} fehlgeschlagen.", s.Id);
                        break;
                }
            }
        }
    }

    private List<Wts.SessionInfo> ReadChildSessions()
    {
        try
        {
            var all = Wts.EnumerateSessions();
            _wtsErrors = 0;
            return all.Where(s => _child!.Matches(s.User, s.Domain)).ToList();
        }
        catch (Exception ex)
        {
            if (_wtsErrors++ % 60 == 0) _log.LogError(ex, "Sitzungen konnten nicht gelesen werden.");
            return new List<Wts.SessionInfo>();
        }
    }

    internal static SessionState Aggregate(IReadOnlyCollection<Wts.SessionInfo> sessions)
    {
        if (sessions.Count == 0) return SessionState.None;
        bool active = sessions.Any(s => s.State == Wts.ConnectState.Active && s.Unlocked != false);
        return active ? SessionState.Active : SessionState.Locked;
    }

    private void Save(long nowMs)
    {
        _state.LastAliveMs = nowMs;
        _state.LastAliveWallUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _lastSaveMs = nowMs;
        try
        {
            _store.Save(_state);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "state.json konnte nicht gespeichert werden.");
        }
    }
}
